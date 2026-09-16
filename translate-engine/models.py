"""Model loading, conversion, and the bounded in-memory cache.

Models are pulled from Hugging Face and converted to CTranslate2 int8 on first
use, then cached on disk in MODEL_DIR so every later start is instant. int8
matters here: this runs on a 7GB box shared with every other Quarc app, and it
costs roughly a third the RAM of the same model under PyTorch.

Only MAX_LOADED_MODELS stay resident at once (LRU) so a user wandering through
the language list can't slowly push the host into swap.
"""

import os
import re
import threading
from collections import OrderedDict

import ctranslate2
from transformers import AutoTokenizer

import languages

MODEL_DIR = os.environ.get("MODEL_DIR", "/models")
CT2_DIR = os.path.join(MODEL_DIR, "ct2")
HF_CACHE = os.path.join(MODEL_DIR, "hf")
MAX_LOADED_MODELS = int(os.environ.get("MAX_LOADED_MODELS", "2"))
THREADS = int(os.environ.get("TRANSLATE_THREADS", "4"))

os.environ.setdefault("HF_HOME", HF_CACHE)

# Sentence-level models degrade badly on whole paragraphs, and silently
# truncate past their token limit — so split, translate as a batch, rejoin.
MAX_CHUNK_CHARS = 400
# Maximum input text length to prevent abuse
MAX_INPUT_CHARS = 5000
_SENTENCE_END = re.compile(r"(?<=[.!?…])\s+")
# For CJK text without spaces, we need a fallback split point
_CJK_CHAR = re.compile(r"[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af\u1100-\u11ff]")

_lock = threading.Lock()
_loaded = OrderedDict()  # hf_model_id -> (translator, tokenizer)


def _safe_dir(model_id):
    return os.path.join(CT2_DIR, model_id.replace("/", "__"))


def _ensure_converted(model_id):
    """Download + convert to CTranslate2 int8. No-op once it's on disk."""
    out_dir = _safe_dir(model_id)
    if os.path.isdir(out_dir) and os.listdir(out_dir):
        return out_dir

    # Imported lazily: torch is only needed to convert, never to serve, so a
    # warm container never pays its import cost.
    from ctranslate2.converters import TransformersConverter

    os.makedirs(CT2_DIR, exist_ok=True)
    tmp_dir = out_dir + ".tmp"
    
    try:
        converter = TransformersConverter(model_id, load_as_float16=False)
        converter.convert(tmp_dir, quantization="int8", force=True)
        os.rename(tmp_dir, out_dir)  # atomic: a killed conversion can't look done
        return out_dir
    except Exception:
        # Clean up temporary directory on failure
        import shutil
        if os.path.exists(tmp_dir):
            shutil.rmtree(tmp_dir, ignore_errors=True)
        raise


def _load(model_id):
    """Return (translator, tokenizer), loading and evicting as needed."""
    # First check without lock (fast path for cache hits)
    with _lock:
        if model_id in _loaded:
            _loaded.move_to_end(model_id)
            return _loaded[model_id]
        
        # Mark as loading to prevent duplicate conversions
        # Use a sentinel value to indicate loading is in progress
        _loaded[model_id] = None  # Sentinel for "loading"
    
    # Conversion and load happen outside the lock — they can take minutes on a
    # cold model, and holding the lock would stall unrelated language pairs.
    try:
        ct2_path = _ensure_converted(model_id)
        translator = ctranslate2.Translator(
            ct2_path,
            device="cpu",
            compute_type="int8",
            inter_threads=1,
            intra_threads=THREADS,
        )
        tokenizer = AutoTokenizer.from_pretrained(model_id, cache_dir=HF_CACHE)
        
        with _lock:
            # Check again - another request might have loaded it while we were converting
            if _loaded[model_id] is not None:
                # Another request won, use their result
                _loaded.move_to_end(model_id)
                # Clean up our loaded model since it wasn't used
                del translator
                return _loaded[model_id]
            
            # Store the loaded model
            _loaded[model_id] = (translator, tokenizer)
            _loaded.move_to_end(model_id)
            
            # Evict old models if over limit
            while len(_loaded) > MAX_LOADED_MODELS:
                _, (old_translator, _) = _loaded.popitem(last=False)
                del old_translator
            
            return _loaded[model_id]
    except Exception:
        # Clean up the sentinel on error
        with _lock:
            if model_id in _loaded and _loaded[model_id] is None:
                del _loaded[model_id]
        raise


def split_chunks(text):
    """Split into translatable chunks, remembering the line structure.

    Returns (chunks, layout) where layout is a list of lines, each a list of
    indices into chunks — so blank lines and paragraph breaks survive.
    """
    chunks = []
    layout = []
    for line in text.split("\n"):
        indices = []
        if line.strip():
            for sentence in _SENTENCE_END.split(line):
                sentence = sentence.strip()
                if not sentence:
                    continue
                # A single sentence longer than the model comfortably handles
                # gets hard-split on character boundaries rather than truncated.
                while len(sentence) > MAX_CHUNK_CHARS:
                    # Try to find a space to split on (for languages with spaces)
                    cut = sentence.rfind(" ", 0, MAX_CHUNK_CHARS)
                    if cut <= 0:
                        # No space found (e.g., CJK text), split at MAX_CHUNK_CHARS
                        cut = MAX_CHUNK_CHARS
                    indices.append(len(chunks))
                    chunks.append(sentence[:cut])
                    sentence = sentence[cut:].lstrip()
                if sentence:
                    indices.append(len(chunks))
                    chunks.append(sentence)
        layout.append(indices)
    return chunks, layout


def _rejoin(translated, layout):
    return "\n".join(" ".join(translated[i] for i in line) for line in layout)


def translate(text, source, target):
    """Translate `text` from `source` to `target` (both ISO-639-1 codes)."""
    # Validate input length to prevent abuse and match backend limit
    if len(text) > MAX_INPUT_CHARS:
        raise ValueError(f"Text exceeds maximum length of {MAX_INPUT_CHARS} characters")
    
    chunks, layout = split_chunks(text)
    if not chunks:
        return text

    dedicated = languages.DEDICATED_MODELS.get((source, target))
    model_id = dedicated or languages.NLLB_MODEL
    translator, tokenizer = _load(model_id)

    if dedicated:
        batch = [tokenizer.convert_ids_to_tokens(tokenizer.encode(c)) for c in chunks]
        results = translator.translate_batch(batch, beam_size=4, max_batch_size=8)
        target_prefix_len = 0
    else:
        tokenizer.src_lang = languages.nllb_code(source)
        batch = [tokenizer.convert_ids_to_tokens(tokenizer.encode(c)) for c in chunks]
        target_token = languages.nllb_code(target)
        results = translator.translate_batch(
            batch,
            beam_size=4,
            max_batch_size=8,
            target_prefix=[[target_token]] * len(batch),
        )
        target_prefix_len = 1

    out = []
    for result in results:
        tokens = result.hypotheses[0][target_prefix_len:]
        out.append(tokenizer.decode(tokenizer.convert_tokens_to_ids(tokens), skip_special_tokens=True))

    return _rejoin(out, layout)


def warm(source, target):
    """Preload a pair so the first real translation isn't the one that waits."""
    model_id = languages.DEDICATED_MODELS.get((source, target)) or languages.NLLB_MODEL
    _load(model_id)


def loaded_models():
    with _lock:
        return list(_loaded.keys())

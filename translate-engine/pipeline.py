"""translate(text, source, target) — the whole job, start to finish.

    detect → plan the route → take the text apart (lines → sentences) →
    protect URLs/emails → run the model(s) → put protected spans and capitals
    back → put the lines back together exactly as they were.
"""

import logging
import os
import re
import threading
import time

import config
import detect as detection
import languages
import routes
import textproc
from store import Loaded, ModelNotReady

log = logging.getLogger("pipeline")


class TranslateError(Exception):
    def __init__(self, code, message, status=400):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status


# ── real model loading and running (the only code that touches CTranslate2) ──


def load_ctranslate2(spec, dest):
    import ctranslate2
    from transformers import AutoTokenizer

    translator = ctranslate2.Translator(dest, device="cpu", compute_type="int8", inter_threads=1, intra_threads=config.THREADS)
    tokenizer = AutoTokenizer.from_pretrained(os.path.join(dest, "tokenizer"))
    size_mb = max(spec.size_mb // 2, os.path.getsize(os.path.join(dest, "model.bin")) // (1024 * 1024))
    return _make_loaded(spec, translator, tokenizer, size_mb)


def _make_loaded(spec, translator, tokenizer, size_mb):
    return Loaded(spec=spec, translator=translator, tokenizer=tokenizer, size_mb=size_mb)


def _encode(loaded, text, source):
    """Text → the list of tokens the model reads (not touching shared tokenizer state: requests run in parallel)."""
    tok = loaded.tokenizer
    if loaded.spec.kind == "nllb":
        return [languages.nllb_code(source), *tok.tokenize(text), "</s>"]
    return tok.convert_ids_to_tokens(tok.encode(text))


def _decode(loaded, tokens, target):
    tok = loaded.tokenizer
    if loaded.spec.kind == "nllb":
        tokens = tokens[1:]  # the target-language tag the model starts with
        return tok.decode(tok.convert_tokens_to_ids(tokens), skip_special_tokens=True, clean_up_tokenization_spaces=True)
    return tok.decode(tok.convert_tokens_to_ids(tokens), skip_special_tokens=True)


def run_model(loaded, texts, source, target):
    """One batch of sentences through one model."""
    batch = [_encode(loaded, t, source) for t in texts]
    longest = max(len(b) for b in batch)
    if loaded.spec.kind == "nllb":
        results = loaded.translator.translate_batch(
            batch,
            beam_size=4,
            max_batch_size=16,
            target_prefix=[[languages.nllb_code(target)]] * len(batch),
            # NLLB repeats itself ("Thank you so much! Thank you!"); measured fix.
            repetition_penalty=1.2,
            max_decoding_length=min(400, int(longest * 3) + 16),
        )
    else:
        results = loaded.translator.translate_batch(
            batch, beam_size=4, max_batch_size=16, max_decoding_length=min(400, int(longest * 2.5) + 16)
        )
    return [_decode(loaded, r.hypotheses[0], target) for r in results]


def run_model_nbest(loaded, texts, source, target, n):
    """The `n` best renderings of each sentence (beam-search n-best) → per sentence, a list of strings."""
    batch = [_encode(loaded, t, source) for t in texts]
    longest = max(len(b) for b in batch)
    beam = max(n + 2, 6)
    if loaded.spec.kind == "nllb":
        results = loaded.translator.translate_batch(
            batch,
            beam_size=beam,
            num_hypotheses=n,
            max_batch_size=8,
            target_prefix=[[languages.nllb_code(target)]] * len(batch),
            repetition_penalty=1.2,
            max_decoding_length=min(400, int(longest * 3) + 16),
        )
    else:
        results = loaded.translator.translate_batch(
            batch, beam_size=beam, num_hypotheses=n, max_batch_size=8, max_decoding_length=min(400, int(longest * 2.5) + 16)
        )
    return [[_decode(loaded, h, target) for h in r.hypotheses] for r in results]


# ── the engine ───────────────────────────────────────────────────────────────

MAX_ALTERNATIVE_CHARS = 600
_KEY_JUNK = re.compile(r"[\W_]+", re.UNICODE)


def _same_as(a, b):
    """Two renderings that differ only in case, spacing or punctuation are not alternatives."""
    return _KEY_JUNK.sub("", a).casefold() == _KEY_JUNK.sub("", b).casefold()


class Engine:
    def __init__(self, store, run=run_model, detector=detection.detect, concurrency=None, run_nbest=run_model_nbest):
        self.store = store
        self.run = run
        self.run_nbest = run_nbest
        self.detector = detector
        self._slots = threading.BoundedSemaphore(concurrency or config.CONCURRENCY)

    # -- public ---------------------------------------------------------------

    def detect(self, text):
        return self.detector(text[:2000])

    def prepare(self, pairs, priority=0):
        """Starts fetching what these pairs need. priority 0 = a person is waiting, 1 = background."""
        started = []
        for source, target in pairs:
            source, target = languages.normalize(source), languages.normalize(target)
            if not source or not target or source == target:
                continue
            for step in routes.plan(source, target):
                entry = self.store.ensure(step.model, priority=priority)
                started.append({"model": step.model.key, "state": entry.state})
        return started

    def translate(self, text, source, target):
        if not isinstance(text, str) or not text.strip():
            return {"translatedText": "", "detectedLanguage": None, "route": None}
        if len(text) > config.MAX_INPUT_CHARS:
            raise TranslateError("text_too_long", f"Text exceeds {config.MAX_INPUT_CHARS} characters")

        target = languages.normalize(target)
        if not target:
            raise TranslateError("unsupported_language", "Unsupported target language")

        started = time.time()
        detected = self.detect(text)
        if source in (None, "", "auto"):
            source = detected["language"]
        else:
            source = languages.normalize(source)
            if not source:
                raise TranslateError("unsupported_language", "Unsupported source language")

        detected_out = {"language": detected["language"], "confidence": detected["confidence"]}
        if source == target:
            return {"translatedText": text, "detectedLanguage": detected_out, "route": {"models": [], "pivot": False}}

        steps = routes.plan(source, target)
        # Ask for every model first so a two-step route fetches both at once, then fail if any is missing.
        entries = [self.store.ensure(step.model, priority=0) for step in steps]
        for step, entry in zip(steps, entries):
            if entry.state != "ready":
                raise ModelNotReady(step.model, entry.state, entry.pct)

        translated, segments, units = self._translate_text(text, source, target, steps)
        return {
            "translatedText": translated,
            # The same text cut into pieces: `u` is an index into `units` for a translated sentence (the app
            # lets you tap it to see alternatives) and None for layout (line breaks, bullets, spaces).
            # "".join(piece["t"]) == translatedText.
            "segments": segments,
            "units": units,
            "detectedLanguage": detected_out,
            "route": {"models": [s.model.key for s in steps], "pivot": len(steps) > 1, "ms": int((time.time() - started) * 1000)},
        }

    def alternatives(self, text, source, target, n=4):
        """Other good translations of ONE sentence (the user tapped it): the model's n-best, cleaned like a
        normal translation (links kept, capitals restored) with near-duplicates removed. Best first."""
        text = (text or "").strip()
        if not text:
            return {"alternatives": []}
        if len(text) > MAX_ALTERNATIVE_CHARS:
            raise TranslateError("text_too_long", f"Alternatives are for one sentence (max {MAX_ALTERNATIVE_CHARS} characters)")
        target = languages.normalize(target)
        if not target:
            raise TranslateError("unsupported_language", "Unsupported target language")
        if source in (None, "", "auto"):
            source = self.detect(text)["language"]
        else:
            source = languages.normalize(source)
            if not source:
                raise TranslateError("unsupported_language", "Unsupported source language")
        if source == target:
            return {"alternatives": []}

        n = max(2, min(int(n or 4), 6))
        steps = routes.plan(source, target)
        entries = [self.store.ensure(step.model, priority=0) for step in steps]
        for step, entry in zip(steps, entries):
            if entry.state != "ready":
                raise ModelNotReady(step.model, entry.state, entry.pct)

        shouting = textproc.is_shouting(text)
        work = textproc.lower_for(text, source) if shouting else text
        work, spans = textproc.protect(work)
        if not textproc.has_letters_besides_tokens(work):
            return {"alternatives": []}

        with self._slots:
            texts = [work]
            for step in steps[:-1]:  # a route through English: the first leg is taken as it is, only the last varies
                with self.store.use(step.model) as loaded:
                    texts = self.run(loaded, texts, step.source, step.target)
            last = steps[-1]
            with self.store.use(last.model) as loaded:
                hypotheses = self.run_nbest(loaded, texts, last.source, last.target, n)[0]

        out = []
        for hypothesis in hypotheses:
            restored = textproc.restore(hypothesis, spans)
            if restored is None:
                continue  # this variant lost a protected link/email: not offered
            candidate = self._finish(restored, target, shouting)
            if candidate.strip() and not any(_same_as(candidate, seen) for seen in out):
                out.append(candidate)
        return {"alternatives": out[:n]}

    # -- internals ------------------------------------------------------------

    def _translate_text(self, text, source, target, steps):
        lines = textproc.parse_lines(text)

        # 1. Units: (original sentence) per line; identical sentences are translated once.
        unique, index = [], {}
        for line in lines:
            if not line.body.strip():
                continue
            for sentence in textproc.sentences_of(line.body):
                if sentence not in index:
                    index[sentence] = len(unique)
                    unique.append(sentence)
                line.units.append(index[sentence])

        # 2. Prepare each unique sentence for the model.
        prepared = []  # (text for the model | None to skip, spans, shouting)
        for sentence in unique:
            shouting = textproc.is_shouting(sentence)
            work = textproc.lower_for(sentence, source) if shouting else sentence
            work, spans = textproc.protect(work)
            if not textproc.has_letters_besides_tokens(work):
                prepared.append((None, spans, shouting))  # nothing to translate: a bare URL, a number…
            else:
                prepared.append((work, spans, shouting))

        pending = [i for i, p in enumerate(prepared) if p[0] is not None]
        results = {}
        if pending:
            out = self._through(steps, [prepared[i][0] for i in pending])
            results = dict(zip(pending, out))

        # 3. Put protected spans and capitals back; a sentence whose spans got lost is redone unprotected.
        finals = []
        redo = []
        for i, sentence in enumerate(unique):
            work, spans, shouting = prepared[i]
            if work is None:
                finals.append(sentence)
                continue
            restored = textproc.restore(results[i], spans)
            if restored is None:
                finals.append(None)
                redo.append(i)
                continue
            finals.append(self._finish(restored, target, shouting))
        if redo:
            again = self._through(steps, [textproc.lower_for(unique[i], source) if prepared[i][2] else unique[i] for i in redo])
            for i, text_out in zip(redo, again):
                finals[i] = self._finish(text_out, target, prepared[i][2])

        # 4. Lay the lines out again, exactly like the original — as text, and as tappable pieces.
        segments, units = [], []
        sep = textproc.sentence_separator(target)
        for number, line in enumerate(lines):
            if number:
                segments.append({"t": "\n", "u": None})
            if line.indent + line.marker:
                segments.append({"t": line.indent + line.marker, "u": None})
            if line.units:
                for k, u in enumerate(line.units):
                    if k and sep:
                        segments.append({"t": sep, "u": None})
                    units.append({"src": unique[u], "out": finals[u], "alt": prepared[u][0] is not None})
                    segments.append({"t": finals[u], "u": len(units) - 1})
            elif line.body:
                segments.append({"t": line.body, "u": None})
            if line.trail:
                segments.append({"t": line.trail, "u": None})
        return "".join(s["t"] for s in segments), segments, units

    @staticmethod
    def _finish(text, target, shouting):
        text = textproc.tidy(text, target)
        return textproc.upper_for(text, target) if shouting else text

    def _through(self, steps, texts):
        """Runs `texts` through each step in turn (two for a pivot route)."""
        with self._slots:  # a few translations at once; the rest queue instead of fighting over the CPUs
            for step in steps:
                with self.store.use(step.model) as loaded:
                    texts = self.run(loaded, texts, step.source, step.target)
        return texts

"""Language detection.

Statistical detectors alone confuse related languages and are unreliable on
short text. So the guess is narrowed in steps that cannot be wrong:

 1. Which writing system is the text in? Greek letters → Greek, Hangul → Korean,
    kana → Japanese, Hebrew → Hebrew… Only Latin, Cyrillic and Arabic script
    are shared by several languages.
 2. Letters that exist in only one language (ğ ı İ in Turkish/Azerbaijani,
    ї є ґ in Ukrainian, پ چ ژ گ in Persian, ٹ ڈ ڑ in Urdu) cut the candidates further.
 3. Only among what is left does the statistical model (py3langid) choose, and
    its confidence is lowered for very short text, so the app only second-guesses
    the user's chosen language when it is really sure.
"""

import re
import unicodedata

import languages

try:  # pragma: no cover - exercised in the container; tests inject a stub
    from py3langid.langid import MODEL_FILE, LanguageIdentifier

    _identifier = LanguageIdentifier.from_pickled_model(MODEL_FILE, norm_probs=True)
    # Only languages the app can translate, and only ones this model knows
    # (nb/nn are Norwegian; normalize() folds them into "no").
    _identifier.set_languages(sorted((set(languages.LANGUAGES) | {"nb", "nn"}) & set(_identifier.nb_classes)))
except Exception:  # noqa: BLE001 - detection must never take the engine down
    _identifier = None

_SCRIPT_RANGES = [
    ("latin", [(0x0041, 0x024F), (0x1E00, 0x1EFF)]),
    ("cyrillic", [(0x0400, 0x052F)]),
    ("arabic", [(0x0600, 0x06FF), (0x0750, 0x077F), (0xFB50, 0xFDFF), (0xFE70, 0xFEFF)]),
    ("hebrew", [(0x0590, 0x05FF)]),
    ("greek", [(0x0370, 0x03FF), (0x1F00, 0x1FFF)]),
    ("devanagari", [(0x0900, 0x097F)]),
    ("bengali", [(0x0980, 0x09FF)]),
    ("gurmukhi", [(0x0A00, 0x0A7F)]),
    ("gujarati", [(0x0A80, 0x0AFF)]),
    ("tamil", [(0x0B80, 0x0BFF)]),
    ("telugu", [(0x0C00, 0x0C7F)]),
    ("malayalam", [(0x0D00, 0x0D7F)]),
    ("thai", [(0x0E00, 0x0E7F)]),
    ("georgian", [(0x10A0, 0x10FF)]),
    ("hangul", [(0x1100, 0x11FF), (0x3130, 0x318F), (0xAC00, 0xD7AF)]),
    ("kana", [(0x3040, 0x30FF), (0x31F0, 0x31FF)]),
    ("han", [(0x3400, 0x4DBF), (0x4E00, 0x9FFF), (0xF900, 0xFAFF)]),
    ("armenian", [(0x0530, 0x058F)]),
]

# Letters that point at one language (or two) within a shared script.
_MARKERS = [
    ("latin", re.compile("[ğıİ]"), ["tr", "az"]),
    ("latin", re.compile("[əƏ]"), ["az"]),
    ("cyrillic", re.compile("[їєґЇЄҐ]"), ["uk"]),
    ("cyrillic", re.compile("[ўЎ]"), ["be"]),
    ("cyrillic", re.compile("[әғқңөұүһӘҒҚҢӨҰҮҺ]"), ["kk"]),
    ("cyrillic", re.compile("[ђћљњџЂЋЉЊЏ]"), ["sr"]),
    ("cyrillic", re.compile("[ѓќѕЃЌЅ]"), ["mk"]),
    ("arabic", re.compile("[پچژگ]"), ["fa"]),
    ("arabic", re.compile("[ٹڈڑںےھ]"), ["ur"]),
]

_NOISE = re.compile(r"(?:https?://|www\.)\S+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+|@\w+|#\w+|\d+")


def _script_of(ch):
    cp = ord(ch)
    for name, ranges in _SCRIPT_RANGES:
        for lo, hi in ranges:
            if lo <= cp <= hi:
                return name
    return None


def script_counts(text):
    counts = {}
    for ch in text:
        if ch.isalpha():
            script = _script_of(ch)
            if script:
                counts[script] = counts.get(script, 0) + 1
    return counts


def _statistical(text, candidates):
    """Most likely of `candidates` per py3langid → [(code, probability)], sums to 1."""
    if _identifier is None or len(candidates) == 1:
        return [(c, 1.0 / len(candidates)) for c in candidates]
    scores = {}
    for code, prob in _identifier.rank(text):
        norm = languages.normalize(code)
        if norm in candidates:
            scores[norm] = scores.get(norm, 0.0) + float(prob)
    if not scores:
        return [(c, 1.0 / len(candidates)) for c in candidates]
    total = sum(scores.values()) or 1.0
    return sorted(((c, s / total) for c, s in scores.items()), key=lambda kv: -kv[1])


def detect(text):
    """→ {"language", "confidence", "candidates": [{"language","confidence"}…]}.

    Falls back to English with confidence 0 when there is nothing to go on.
    """
    cleaned = _NOISE.sub(" ", unicodedata.normalize("NFC", text or ""))
    counts = script_counts(cleaned)
    letters = sum(counts.values())
    if not letters:
        return {"language": "en", "confidence": 0.0, "candidates": []}

    # Kana means Japanese even when most characters are kanji; Hangul means Korean.
    if counts.get("kana", 0) and counts.get("kana", 0) + counts.get("han", 0) >= letters * 0.5:
        return _single("ja", letters)
    dominant = max(counts, key=counts.get)
    if dominant == "han":
        return _single("zh", letters)

    candidates = [c for c in languages.with_script(dominant)]
    if not candidates:
        return {"language": "en", "confidence": 0.0, "candidates": []}

    # Turkish typed without Turkish letters: statistics call `bugun hava cok guzel` Dutch, so ask the
    # Turkish word list instead (restore the letters; are the words real Turkish?).
    if dominant == "latin" and "tr" in candidates:
        try:
            import turkish

            if turkish.ascii_turkish_evidence(cleaned) >= 0.75:
                return {"language": "tr", "confidence": 0.8, "candidates": [{"language": "tr", "confidence": 0.8}]}
        except Exception:  # noqa: BLE001 - detection must never take the engine down
            pass

    for script, pattern, only in _MARKERS:
        if script == dominant and pattern.search(cleaned):
            narrowed = [c for c in only if c in candidates]
            if narrowed:
                candidates = narrowed
                break

    ranked = _statistical(cleaned, candidates) if len(candidates) > 1 else [(candidates[0], 1.0)]
    # Short text is genuinely ambiguous ("Hotel", "Taxi"): don't claim certainty.
    certainty = min(1.0, letters / 24.0) if len(candidates) > 1 else min(1.0, 0.6 + letters / 10.0)
    top, prob = ranked[0]
    return {
        "language": top,
        "confidence": round(prob * certainty, 4),
        "candidates": [{"language": c, "confidence": round(p * certainty, 4)} for c, p in ranked[:3]],
    }


def _single(code, letters):
    conf = round(min(1.0, 0.6 + letters / 10.0), 4)
    return {"language": code, "confidence": conf, "candidates": [{"language": code, "confidence": conf}]}

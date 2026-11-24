"""suggest(text, source) → "Did you mean …?"

  1. Which language? The user's choice if they made one; otherwise detection — but only if
     it is confident, and with one exception: text with no Turkish letters that turns into
     real Turkish words once they are restored is Turkish whatever the detector says
     (`bugun hava cok guzel` reads as Dutch to it).
  2. Turkish: restore ç ğ ı ö ş ü, then fix remaining typos.
  3. Other languages: missing accents and typos from frequency lists.

The answer is a whole corrected text plus `segments` (so the app can show which words
changed) and `changes`. Nothing is ever applied automatically.
"""

import config
import languages
import spelling
import textproc
import turkish

# Detection below this is not trusted to pick a spell-checking language.
MIN_DETECT_CONFIDENCE = 0.6
# Evidence (share of real Turkish words after restoring letters) to treat unlabelled text as Turkish.
MIN_TURKISH_EVIDENCE = 0.75


def _spans(text):
    """Ranges that must never be touched: URLs, emails, @handles, `code`."""
    return [(m.start(), m.end()) for m in textproc._PROTECT.finditer(text)]  # noqa: SLF001


def _resolve_language(text, source, detector):
    """→ (language code or None, evidence of ASCII Turkish)."""
    evidence = 0.0
    explicit = languages.normalize(source) if source and source != "auto" else None
    if explicit:
        return explicit, 0.0
    # Waits for the one-time load if a request beats the start-up warm-up: the app never blocks on suggestions.
    if turkish.ensure_loaded():
        evidence = turkish.ascii_turkish_evidence(text)
        if evidence >= MIN_TURKISH_EVIDENCE:
            return "tr", evidence
    found = detector(text)
    if found["confidence"] >= MIN_DETECT_CONFIDENCE:
        return found["language"], evidence
    # Not sure (typos confuse the detector: "helo how are yuo todya" reads as Italian): let the word lists vote.
    guess = _by_vocabulary(text, [c["language"] for c in found.get("candidates", [])] + ["en"])
    return guess, evidence


def _by_vocabulary(text, candidates):
    """The candidate language whose word list knows the most words of `text` — if it clearly wins."""
    words = [w.lower() for w in spelling.TOKEN_RE.findall(text) if len(w) >= 2 and "'" not in w]
    if len(words) < 3:
        return None
    scores = []
    for lang in dict.fromkeys(c for c in candidates if c in config.SPELL_LANGS and c != "tr"):
        lex = spelling.LEXICONS.get(lang)
        if lex:
            known = sum(1 for w in words if lex.freq(w) >= spelling.TUNING.known_min)
            scores.append((known / len(words), lang))
    scores.sort(reverse=True)
    if not scores or scores[0][0] < 0.5:
        return None
    if len(scores) > 1 and scores[0][0] - scores[1][0] < 0.15:
        return None  # too close to call: say nothing rather than guess
    return scores[0][1]


def _keep_real_words(original, restored):
    """Take a restored word only if it IS a Turkish word. Inside a typo'd word the restorer is guessing
    (`evvimizin` → `evvımızın`), and a wrong guess would hide the typo from the spell-check below."""
    out = list(original)
    for m in spelling.TOKEN_RE.finditer(original):
        new = restored[m.start() : m.end()]
        if new == m.group(0):
            continue
        root = new.replace("’", "'").split("'")[0]  # Istanbul'a → check İstanbul
        if turkish.is_valid(root):
            out[m.start() : m.end()] = list(new)
    return "".join(out)


def _turkish_pass(text, restore_letters, spans):
    """Returns (final text, {start: (old, new)}) for Turkish."""
    masked, saved = textproc.protect(text)
    base = text
    if restore_letters:
        restored = turkish.deasciify(masked)
        back = textproc.restore(restored, saved)
        if back is not None and len(back) == len(text):
            base = _keep_real_words(text, back)
    replacements = {}
    ed_budget = 40
    for m in spelling.TOKEN_RE.finditer(base):
        token = m.group(0)
        if any(a <= m.start() < b for a, b in spans) or not spelling.is_candidate_token(token, base, m.start()):
            continue
        word = turkish.lower(token)
        if turkish.is_valid(word):
            continue
        ed_budget -= 1
        if ed_budget < 0:
            break
        e1 = spelling.edits1(word, turkish.ALPHABET)
        best, best_f = spelling._best(e1, turkish.candidate_freq, 3e-6, e1)  # noqa: SLF001
        if best:
            replacements[m.start()] = (token, spelling._match_case(token, best))  # noqa: SLF001
    return base, replacements


def _build(original, base, replacements):
    """Final text + segments + changes from the original, the letter-restored base and the typo fixes."""
    pieces, changes = [], []
    cursor = 0
    for m in spelling.TOKEN_RE.finditer(base):
        new = replacements.get(m.start(), (None, m.group(0)))[1]
        old = original[m.start() : m.end()]
        if new == old:
            continue
        if m.start() > cursor:
            pieces.append({"t": base[cursor : m.start()], "changed": False})
        pieces.append({"t": new, "changed": True})
        changes.append({"from": old, "to": new})
        cursor = m.end()
    if cursor < len(base):
        pieces.append({"t": base[cursor:], "changed": False})

    # tokens replaced with a different length shift later offsets only in the text, which is
    # rebuilt from pieces, so nothing else needs adjusting
    final = "".join(p["t"] for p in pieces)
    return final, pieces, changes


def suggest(text, source="auto", detector=None):
    """→ {"language": str | None, "suggestion": {...} | None}"""
    empty = {"language": None, "suggestion": None}
    if not config.SUGGEST_ENABLED or not isinstance(text, str):
        return empty
    text = text[: config.MAX_INPUT_CHARS]
    if len(text.strip()) < 3:
        return empty

    if detector is None:
        import detect as detection

        detector = detection.detect

    lang, evidence = _resolve_language(text, source, detector)
    if lang is None or lang not in config.SPELL_LANGS:
        return {"language": lang, "suggestion": None}

    spans = _spans(text)
    if lang == "tr":
        if not turkish.ensure_loaded():
            return {"language": lang, "suggestion": None}
        # Restoring letters is always worth trying for Turkish: it changes nothing if there is nothing to restore.
        base, replacements = _turkish_pass(text, restore_letters=True, spans=spans)
    else:
        base, replacements = text, spelling.check(
            text, lang, spans, known_elsewhere=_known_in_english if lang != "en" else None
        )

    final, pieces, changes = _build(text, base, replacements)
    if not changes or final == text:
        return {"language": lang, "suggestion": None}

    kind = "diacritics" if lang == "tr" and not replacements else "spelling"
    if lang == "tr" and replacements and base != text:
        kind = "both"
    if lang != "tr" and all(spelling.fold(c["from"]) == spelling.fold(c["to"]) for c in changes):
        kind = "diacritics"
    return {
        "language": lang,
        "suggestion": {"text": final, "kind": kind, "segments": pieces, "changes": changes[:50], "count": len(changes), "evidence": evidence or None},
    }


def _known_in_english(word):
    lex = spelling.LEXICONS.get("en")
    return bool(lex and lex.freq(word) >= spelling.TUNING.known_min)


def warm():
    """Load what the first suggestion would otherwise wait for (called in the background at start-up)."""
    if not config.SUGGEST_ENABLED:
        return
    turkish.ensure_loaded()
    spelling.LEXICONS.get("en")

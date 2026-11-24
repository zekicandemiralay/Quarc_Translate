"""Typo and missing-accent suggestions from word-frequency lists.

Design choices, all driven by "a wrong suggestion is worse than a missed typo":

  * a word is only touched if it is rare/unknown AND a candidate one edit away is far
    more frequent (hundreds of times) — web-derived lists contain typos themselves
    ("helo" is in them), so "is it in the list?" alone is not enough;
  * names, acronyms, camelCase, capitalised words, words with digits or apostrophes,
    URLs/emails and anything shorter than 3 letters are never touched;
  * candidates are generated at query time (Norvig-style edits) and looked up in the
    list: no precomputed index, so a language costs ~15 MB, not ~200 MB;
  * missing accents (`cafe`→`café`, `uber`→`über`) are a separate, safer step.

Data: wordfreq (Robyn Speer), word-frequency lists, CC BY-SA 4.0.
"""

import logging
import re
import threading
import unicodedata
from collections import OrderedDict
from dataclasses import dataclass

import config

log = logging.getLogger("spelling")

# apostrophes inside a word keep it one token (don't, Ankara'da); such tokens are never "corrected"
TOKEN_RE = re.compile(r"[^\W\d_]+(?:['’][^\W\d_]+)*", re.UNICODE)


@dataclass(frozen=True)
class Tuning:
    known_min: float = 3e-7  # at/above this a word is considered fine as it stands
    rare_max: float = 3e-6  # …unless it is below this AND a very likely slip of a far commoner word:
    rare_ratio: float = 600.0  # (tier B: "recieve" is in web lists, "receive" is 600x more common)
    rare_cand_min: float = 2e-5
    rare_weight: float = 1.0  # only the unmistakable slips for a listed word: missing letter, swap, doubled letter
    margin: float = 1.8  # the best candidate must beat the runner-up by this factor, or the word is ambiguous (helo: hello/help)
    cand_min: float = 3e-6  # a replacement must be at least this common…
    ratio: float = 150.0  # …and this many times more common than the original
    ed2_ratio: float = 1500.0  # two edits away: a much stronger signal is needed
    ed2_min_len: int = 7
    fold_ratio: float = 40.0  # restoring accents is safer than guessing a typo
    min_len: int = 3
    max_checked: int = 60  # unknown words examined per request (CPU guard)
    max_ed2: int = 3


TUNING = Tuning()

_FOLD_MAP = str.maketrans({"ß": "ss", "ı": "i", "ø": "o", "æ": "ae", "œ": "oe", "ł": "l", "đ": "d", "ð": "d", "þ": "th"})


def fold(word):
    """cafe/café → cafe: lower-case, accents removed."""
    decomposed = unicodedata.normalize("NFD", word.lower().translate(_FOLD_MAP))
    return "".join(c for c in decomposed if not unicodedata.combining(c))


class Lexicon:
    """A word → frequency table for one language."""

    def __init__(self, lang, freqs, alphabet=None):
        self.lang = lang
        self.freqs = freqs
        if alphabet is None:
            counts = {}
            for w, f in freqs.items():
                if f >= 1e-6:
                    for c in w:
                        counts[c] = counts.get(c, 0) + 1
            alphabet = "".join(sorted(c for c, n in counts.items() if n >= 40))
        self.alphabet = alphabet
        self._fold = None

    def freq(self, word):
        return self.freqs.get(word, 0.0)

    def fold_index(self):
        """fold(word) → [(word with accents, freq)], only for words whose folded form differs."""
        if self._fold is None:
            index = {}
            for w, f in self.freqs.items():
                folded = fold(w)
                if folded != w and f >= 1e-7:
                    index.setdefault(folded, []).append((w, f))
            for options in index.values():
                options.sort(key=lambda x: -x[1])
            self._fold = index
        return self._fold


def _usable(word):
    return 2 <= len(word) <= 24 and word.isalpha()


def _load_wordfreq(lang):
    import wordfreq

    source = {"no": "nb"}.get(lang, lang)
    freqs = wordfreq.get_frequency_dict(source, wordlist="large")
    top = sorted(((w, f) for w, f in freqs.items() if _usable(w)), key=lambda x: -x[1])[: config.SPELL_TOP_WORDS]
    return Lexicon(lang, dict(top))


class LexiconCache:
    """A few languages are kept loaded (least recently used go first)."""

    def __init__(self, loader, max_size):
        self._loader, self._max = loader, max_size
        self._items = OrderedDict()
        self._lock = threading.Lock()

    def get(self, lang):
        with self._lock:
            if lang in self._items:
                self._items.move_to_end(lang)
                return self._items[lang]
        try:
            lex = self._loader(lang)
        except Exception:  # noqa: BLE001 - no list for this language: no suggestions, not an error
            log.warning("no word list for %s", lang)
            lex = None
        with self._lock:
            self._items[lang] = lex
            self._items.move_to_end(lang)
            while len(self._items) > self._max:
                self._items.popitem(last=False)
        return lex


LEXICONS = LexiconCache(_load_wordfreq, config.SPELL_MAX_DICTS)


# ── candidates ───────────────────────────────────────────────────────────────


# Keys next to each other on a QWERTY keyboard: a slip lands on a neighbour far more often than on a random key.
_NEAR = {
    "q": "wa", "w": "qes", "e": "wrd", "r": "etf", "t": "ryg", "y": "tuh", "u": "yij", "i": "uok", "o": "ipl", "p": "ol",
    "a": "qsz", "s": "awdx", "d": "sefc", "f": "drgv", "g": "fthb", "h": "gyjn", "j": "hukm", "k": "jil", "l": "kop",
    "z": "asx", "x": "zsdc", "c": "xdfv", "v": "cfgb", "b": "vghn", "n": "bhjm", "m": "njk",
}
# How likely each slip is, relative to the others (a missing letter and swapped neighbours are the classics).
W_MISSING, W_SWAP, W_DOUBLE, W_NEAR_KEY, W_EXTRA, W_OTHER_KEY = 1.0, 1.0, 1.0, 0.9, 0.6, 0.25


def edits1(word, alphabet):
    """{candidate: likelihood weight} for every word one slip away from `word`."""
    out = {}

    def add(cand, weight):
        if cand != word and weight > out.get(cand, 0.0):
            out[cand] = weight

    for i in range(len(word) + 1):
        left, right = word[:i], word[i:]
        if right:
            doubled = (len(right) > 1 and right[0] == right[1]) or (left[-1:] == right[0])
            add(left + right[1:], W_DOUBLE if doubled else W_EXTRA)  # a letter too many was typed
            for c in alphabet:
                near = c in _NEAR.get(right[0], "")
                add(left + c + right[1:], W_NEAR_KEY if near else W_OTHER_KEY)  # wrong key
        if len(right) > 1:
            add(left + right[1] + right[0] + right[2:], W_SWAP)  # two letters swapped
        for c in alphabet:
            add(left + c + right, W_MISSING)  # a letter was left out
    return out


def edits2(word, alphabet):
    return {e2 for e1 in edits1(word, alphabet) for e2 in edits1(e1, alphabet)}


def _best(words, freq_of, min_freq, weights=None, margin=None):
    """The likeliest candidate: frequency, scaled by how plausible the slip is. Returns (word, frequency).

    If the runner-up is nearly as likely (`thn` → then/than, `helo` → hello/help) the word is ambiguous and
    nothing is returned: guessing between two real words is right about half the time."""
    margin = TUNING.margin if margin is None else margin
    best, best_score, best_f, second_score = None, 0.0, 0.0, 0.0
    for w in words:
        f = freq_of(w)
        if f < min_freq:
            continue
        score = f * ((weights[w] ** 3) if weights else 1.0)  # cubed: how typo-like the slip is must outweigh raw frequency
        if score > best_score:
            best, second_score, best_score, best_f = w, best_score, score, f
        elif score > second_score:
            second_score = score
    if best is not None and second_score and best_score < margin * second_score:
        return None, 0.0
    return best, best_f


def _match_case(original, replacement):
    if original.isupper() and len(original) > 1:
        return replacement.upper()
    if original[:1].isupper():
        return replacement[:1].upper() + replacement[1:]
    return replacement


# ── the checker ──────────────────────────────────────────────────────────────


def is_candidate_token(token, text, start):
    """Only plain lower-case words are ever corrected. A Capitalised word might be a name (Zeki → Zei would be
    absurd), so it is left alone even at the start of a sentence: a missed typo costs nothing."""
    if len(token) < TUNING.min_len or "'" in token or "’" in token:
        return False
    return token.islower()


def correct_token(word, lex, known_elsewhere=None, ed2_budget=None):
    """The better spelling of one lower-case word, or None."""
    t = TUNING
    f_word = lex.freq(word)
    if f_word >= t.rare_max:
        return None
    if known_elsewhere and known_elsewhere(word):
        return None  # a word of another language we know (English words inside German text…)
    floor = max(f_word, 1e-9)
    if f_word >= t.known_min:  # tier B: listed, but only just
        e1 = edits1(word, lex.alphabet)
        likely = {w: wt for w, wt in e1.items() if wt >= t.rare_weight}
        cand, f = _best(likely, lex.freq, t.rare_cand_min, likely)
        return cand if cand and f >= t.rare_ratio * floor else None

    # 1. missing accents: the safest guess
    options = lex.fold_index().get(word)
    if options:
        cand, f = options[0]
        if f >= t.cand_min and f >= t.fold_ratio * floor:
            return cand

    # 2. one edit away
    e1 = edits1(word, lex.alphabet)
    cand, f = _best(e1, lex.freq, t.cand_min, e1)
    if cand and f >= t.ratio * floor:
        return cand

    # 3. two edits, long words only, and only a few per request
    if len(word) >= t.ed2_min_len and (ed2_budget is None or ed2_budget[0] > 0):
        if ed2_budget is not None:
            ed2_budget[0] -= 1
        cand, f = _best(edits2(word, lex.alphabet), lex.freq, t.cand_min * 3)
        if cand and f >= t.ed2_ratio * floor:
            return cand
    return None


def check(text, lang, skip_ranges=(), lexicon=None, known_elsewhere=None):
    """{start: (old, new)} for every word of `text` that looks misspelled."""
    lex = lexicon if lexicon is not None else LEXICONS.get(lang)
    if lex is None:
        return {}
    found = {}
    ed2_budget = [TUNING.max_ed2]
    checked = 0
    for m in TOKEN_RE.finditer(text):
        token = m.group(0)
        if any(a <= m.start() < b for a, b in skip_ranges):
            continue
        if not is_candidate_token(token, text, m.start()):
            continue
        # identifiers and codes (wrold2, file_name, abc123) are not prose
        before, after = text[m.start() - 1 : m.start()], text[m.end() : m.end() + 1]
        if before.isdigit() or before == "_" or after.isdigit() or after == "_":
            continue
        lower = token.lower()
        if lex.freq(lower) >= TUNING.rare_max:
            continue
        checked += 1
        if checked > TUNING.max_checked:
            break
        better = correct_token(lower, lex, known_elsewhere, ed2_budget)
        if better and better != lower:
            found[m.start()] = (token, _match_case(token, better))
    return found

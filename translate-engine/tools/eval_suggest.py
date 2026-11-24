"""Measures the "did you mean" suggestions on tools/eval_data.py.

    python tools/eval_suggest.py            # everything
    python tools/eval_suggest.py -v         # also list every false positive / miss

Three questions, in order of importance:
  1. FALSE POSITIVES  — on correct text, how many words does it wrongly want to change?
  2. LETTERS          — Turkish typed without ç ğ ı ö ş ü: how much comes back right?
  3. TYPOS            — injected keyboard typos: how many are fixed to the intended word?
"""

import os
import random
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import suggest  # noqa: E402
import spelling  # noqa: E402
import turkish  # noqa: E402
from tools.eval_data import CORPORA, TR  # noqa: E402

VERBOSE = "-v" in sys.argv
WORD = re.compile(r"[^\W\d_]+(?:['’][^\W\d_]+)*", re.UNICODE)

NEIGHBOURS = {
    "q": "wa", "w": "qes", "e": "wrd", "r": "etf", "t": "ryg", "y": "tuh", "u": "yij", "i": "uok", "o": "ipl", "p": "ol",
    "a": "qsz", "s": "awdx", "d": "sefc", "f": "drgv", "g": "fthb", "h": "gyjn", "j": "hukm", "k": "jil", "l": "kop",
    "z": "asx", "x": "zsdc", "c": "xdfv", "v": "cfgb", "b": "vghn", "n": "bhjm", "m": "njk",
}


def strip_turkish(text):
    return text.translate(str.maketrans("çğıöşüÇĞİÖŞÜ", "cgiosuCGIOSU"))


def inject_typo(word, rng):
    op = rng.choice(["delete", "swap", "double", "replace", "insert"])
    i = rng.randrange(1, len(word) - 1)  # not the first letter: people rarely get that wrong
    if op == "delete":
        return word[:i] + word[i + 1 :]
    if op == "swap":
        return word[:i] + word[i + 1] + word[i] + word[i + 2 :]
    if op == "double":
        return word[:i] + word[i] + word[i:]
    near = NEIGHBOURS.get(word[i].lower(), "")
    if not near:
        return word[:i] + word[i + 1 :]
    c = rng.choice(near)
    return word[:i] + c + word[i + 1 :] if op == "replace" else word[:i] + c + word[i:]


def words_of(text):
    return WORD.findall(text)


def run_suggest(text, lang):
    out = suggest.suggest(text, source=lang)
    return out["suggestion"]


def main():
    t0 = time.time()
    turkish.ensure_loaded()
    print(f"engine ready ({time.time() - t0:.1f}s)\n")

    # 1. false positives on correct text -----------------------------------------------------------
    print("== 1. FALSE POSITIVES on correct text (every word here is right)")
    print(f"{'lang':5}{'sentences':>10}{'words':>8}{'changed sent.':>15}{'changed words':>15}{'  rate':>9}")
    total_words = total_fp = 0
    for lang, corpus in CORPORA.items():
        fp_words, fp_sent, words = [], 0, 0
        for sentence in corpus:
            words += len(words_of(sentence))
            s = run_suggest(sentence, lang)
            if s:
                fp_sent += 1
                fp_words += [(c["from"], c["to"]) for c in s["changes"]]
        total_words += words
        total_fp += len(fp_words)
        print(f"{lang:5}{len(corpus):>10}{words:>8}{fp_sent:>15}{len(fp_words):>15}{100 * len(fp_words) / max(words, 1):>8.2f}%")
        if VERBOSE and fp_words:
            print("      ", fp_words)
    print(f"{'ALL':5}{'':>10}{total_words:>8}{'':>15}{total_fp:>15}{100 * total_fp / total_words:>8.2f}%\n")

    # 2. Turkish letters ----------------------------------------------------------------------------
    print("== 2. TURKISH LETTERS: the corpus with ç ğ ı ö ş ü removed")
    ok_words = n_words = exact = auto_hits = changed_needed = 0
    misses = []
    for original in TR:
        stripped = strip_turkish(original)
        if stripped == original:
            continue
        changed_needed += 1
        # as the user would meet it: language left on "detect"
        ev = turkish.ascii_turkish_evidence(stripped)
        s = suggest.suggest(stripped, source="auto")
        if s["suggestion"] and s["language"] == "tr":
            auto_hits += 1
        s_tr = run_suggest(stripped, "tr")
        fixed = s_tr["text"] if s_tr else stripped
        a, b = words_of(fixed), words_of(original)
        n = len(b)
        good = sum(1 for x, y in zip(a, b) if x == y)
        ok_words += good
        n_words += n
        exact += fixed == original
        if fixed != original:
            misses.append((original, fixed))
    print(f"  sentences needing restoration : {changed_needed}")
    print(f"  offered when language = auto  : {auto_hits} ({100 * auto_hits / changed_needed:.0f}%)")
    print(f"  words restored correctly      : {ok_words}/{n_words} ({100 * ok_words / n_words:.1f}%)")
    print(f"  sentences restored exactly    : {exact}/{changed_needed} ({100 * exact / changed_needed:.0f}%)")
    if VERBOSE:
        for original, fixed in misses[:25]:
            diff = [(x, y) for x, y in zip(words_of(fixed), words_of(original)) if x != y]
            print("   miss:", diff)
    print()

    # 2b. does the ASCII-Turkish test leak into other languages? ----------------------------------
    print("== 2b. ASCII-TURKISH TEST must NOT fire on other languages (it would hijack language detection)")
    for lang, corpus in CORPORA.items():
        if lang == "tr":
            continue
        for variant, fn in (("as written", lambda s: s), ("lower-case, no accents", lambda s: spelling.fold(s))):
            fired = [s for s in corpus if turkish.ascii_turkish_evidence(fn(s)) >= suggest.MIN_TURKISH_EVIDENCE]
            print(f"  {lang} {variant:24} fired on {len(fired)}/{len(corpus)}", fired[:2] if fired and VERBOSE else "")
    print()

    # 3. typos -----------------------------------------------------------------------------------
    print("== 3. TYPOS: injected keyboard typos (1-2 per sentence, words of 4+ letters, lower-case)")
    print(f"{'lang':5}{'typos':>7}{'fixed':>8}{'wrong word':>12}{'not offered':>13}{'  recall':>10}")
    rng = random.Random(20261124)
    for lang, corpus in CORPORA.items():
        typos = fixed = wrong = 0
        examples, missed = [], []
        for sentence in corpus:
            for _ in range(2):
                tokens = list(WORD.finditer(sentence))
                eligible = [m for m in tokens if len(m.group(0)) >= 4 and m.group(0).islower() and "'" not in m.group(0)]
                if not eligible:
                    continue
                m = rng.choice(eligible)
                bad = inject_typo(m.group(0), rng)
                if bad == m.group(0):
                    continue
                typo_sentence = sentence[: m.start()] + bad + sentence[m.end() :]
                typos += 1
                s = run_suggest(typo_sentence, lang)
                got = None
                if s:
                    for c in s["changes"]:
                        if c["from"] == bad:
                            got = c["to"]
                if got is None:
                    missed.append((bad, m.group(0)))
                if got == m.group(0):
                    fixed += 1
                elif got is not None:
                    wrong += 1
                    examples.append((bad, m.group(0), got))
        print(f"{lang:5}{typos:>7}{fixed:>8}{wrong:>12}{typos - fixed - wrong:>13}{100 * fixed / max(typos, 1):>9.0f}%")
        if VERBOSE and examples:
            print("      wrong:", examples[:8])
        if VERBOSE and missed:
            print("      not offered:", missed[:10])


if __name__ == "__main__":
    main()

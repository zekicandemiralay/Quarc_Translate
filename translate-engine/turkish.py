"""Turkish: restoring letters typed without them, and knowing what a Turkish word is.

People on a foreign keyboard write `bugun hava cok guzel`. Restoring `ç ğ ı ö ş ü`
is done by Zemberek's deasciifier (context-aware: it picks `işe` vs `ise` from the
neighbouring words; 0.5-3 ms a sentence, ~30 MB). Its heavy parts — the morphological
analyzer (+180 MB, 30 s start) and the spell checker (+330 MB, needs NumPy 1.x) — are
NOT used; they would cost more RAM than this feature is worth on a shared box.

Spell-checking Turkish needs to know that `evlerimizdekilerden` is a word although no
list contains it. So "is this a Turkish word?" is answered permissively: a word is
valid if it is in a list of ~63k attested forms, OR it is a root from Zemberek's
67k-entry lexicon followed by a chain of Turkish suffixes. Being permissive is the
right bias: a missed typo costs nothing, a correct word flagged as wrong is annoying.
"""

import importlib.util
import logging
import os
import re
import threading

log = logging.getLogger("turkish")

ALPHABET = "abcçdefgğhıijklmnoöprsştuüvyz"
_TR_SPECIFIC = set("çğışöüÇĞİŞÖÜ")  # letters that exist only in Turkish (and Azerbaijani)

_lock = threading.Lock()
_state = {"loaded": False, "failed": False, "deasciifier": None, "stems": None, "forms": None, "common": None}


def lower(text):
    """Turkish lower-casing: I → ı, İ → i."""
    return text.replace("I", "ı").replace("İ", "i").lower()


def has_turkish_letters(text):
    return any(c in _TR_SPECIFIC for c in text)


# ── loading ──────────────────────────────────────────────────────────────────


def _lexicon_path():
    spec = importlib.util.find_spec("zemberek")  # located without importing it (importing takes seconds)
    if not spec or not spec.submodule_search_locations:
        return None
    return os.path.join(list(spec.submodule_search_locations)[0], "resources", "lexicon.csv")


def _soft_variants(stem):
    """Roots change when a vowel follows: kitap→kitab, çocuk→çocuğ, ağaç→ağac, kanat→kanad."""
    out = set()
    if stem.endswith("p"):
        out.add(stem[:-1] + "b")
    elif stem.endswith("ç"):
        out.add(stem[:-1] + "c")
    elif stem.endswith("t"):
        out.add(stem[:-1] + "d")
    elif stem.endswith("k"):
        out.add(stem[:-1] + "ğ")
        if stem.endswith("nk"):
            out.add(stem[:-2] + "ng")
    return out


def _load_stems():
    path = _lexicon_path()
    stems = set()
    if not path or not os.path.isfile(path):
        return stems
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            cols = line.rstrip("\n").split("\t")
            if len(cols) < 4:
                continue
            stem = lower(cols[2])
            if len(stem) < 2 or not stem.replace("'", "").isalpha():
                continue
            stems.add(stem)
            attrs = cols[-1] if len(cols) > 8 else ""
            stems.update(_soft_variants(stem))
            if "LastVowelDrop" in attrs and len(stem) > 3:  # burun → burn(u)
                for i in range(len(stem) - 1, 0, -1):
                    if stem[i] in "aeıioöuü":
                        stems.add(stem[:i] + stem[i + 1 :])
                        break
            if cols[3] == "Verb" and stem[-1] in "ae" and len(stem) > 2:  # ara → ar(ıyor)
                stems.add(stem[:-1])
    stems.update(("di", "yi"))  # de- → di-yor, ye- → yi-yor
    return stems


def _load_forms():
    import wordfreq

    forms = {}
    for word, freq in wordfreq.get_frequency_dict("tr", wordlist="small").items():
        if len(word) >= 2 and word.isalpha() and freq > 0:
            forms[word] = freq
    return forms


def _common_roots(stems, forms):
    """Roots that people demonstrably use: the root, or its infinitive, is itself a listed word.
    (The lexicon also holds thousands of obscure proper nouns and abbreviations; as a root they make
    nonsense look like Turkish.)"""
    common = set()
    for f in forms:
        if len(f) >= 3:
            common.add(f)
            if f.endswith(("mak", "mek")):
                common.add(f[:-3])
            common.update(_soft_variants(f))
    return {s for s in common if s in stems or any(s in v for v in ())} | {s for s in common if len(s) >= 3 and s in stems}


def ensure_loaded():
    """Loads the deasciifier, root lexicon and word forms. Slow once (seconds); safe to call from anywhere."""
    if _state["loaded"] or _state["failed"]:
        return _state["loaded"]
    with _lock:
        if _state["loaded"] or _state["failed"]:
            return _state["loaded"]
        try:
            from zemberek.normalization.deasciifier.deasciifier import Deasciifier

            _state["deasciifier"] = Deasciifier
            _state["stems"] = _load_stems()
            _state["forms"] = _load_forms()
            _state["common"] = _common_roots(_state["stems"], _state["forms"])
            _state["loaded"] = True
            log.info("turkish ready: %d roots, %d forms", len(_state["stems"]), len(_state["forms"]))
        except Exception:  # noqa: BLE001 - suggestions are optional; the engine must keep translating
            log.exception("Turkish suggestions unavailable")
            _state["failed"] = True
    return _state["loaded"]


def ready():
    """True once loading has finished (never blocks)."""
    return _state["loaded"]


# ── what is a Turkish word ───────────────────────────────────────────────────

# Suffix allomorphs, after vowel harmony and with buffer consonants (y/n/s/ş) included.
# Not a grammar: a permissive inventory, so that root + any plausible chain counts as a word.
_SUFFIX_PARTS = """
lar ler ları leri ım im um üm m ın in un ün n ı i u ü sı si su sü ımız imiz umuz ümüz mız miz muz müz ınız iniz unuz ünüz
nız niz nuz nüz yı yi yu yü nı ni nu nü a e ya ye na ne da de ta te nda nde dan den tan ten ndan nden nın nin nun nün
la le yla yle ca ce ça çe yım yim yum yüm sın sin sun sün ız iz uz üz sınız siniz sunuz sünüz ki dır dir dur dür tır tir tur tür
dı di du dü tı ti tu tü mış miş muş müş ydı ydi ydu ydü ymış ymiş ymuş ymüş ysa yse sa se ysan ysen
lık lik luk lük lı li lu lü sız siz suz süz cı ci cu cü çı çi çu çü cık cik cuk cük çık çik çuk çük laş leş lan len
mak mek ma me maz mez mı mi mu mü yor ıyor iyor uyor üyor r ar er ır ir ur ür acak ecek yacak yecek acağ eceğ yacağ yeceğ
malı meli ıp ip up üp yıp yip yup yüp arak erek yarak yerek ınca ince unca ünce yınca yince ken yken dık dik duk dük tık tik tuk tük
ış iş uş üş ıl il ul ül ıştır ıştir ıştur ıştür t dır ar er ır ir ur ür ıcı ici ucu ücü ıcı gın gin gun gün gı gi gu gü
ğ ğı ği ğu ğü ğa ğe ğın ğin ğun ğün ğımız ğimiz ğumuz ğümüz ğınız ğiniz ğunuz ğünüz
dığ diğ duğ düğ tığ tiğ tuğ tüğ ık ik uk ük acağ eceğ ıl il sal sel msı msi imsi ımsı
""".split()
_SUFFIX_RE = re.compile("(?:" + "|".join(sorted(set(_SUFFIX_PARTS), key=len, reverse=True)) + "){0,6}")


# Two-letter roots are only trusted for the handful of very common ones; otherwise `ge` + `ecek` would
# make the typo "geecek" a word.
_SHORT_ROOTS = {"ol", "al", "de", "ye", "ay", "ev", "el", "et", "ek", "ak", "iç", "ön", "uç", "iş", "su", "ne", "ya", "ve", "bu", "şu", "ki", "mi", "ad"}


def is_valid(word):
    """Permissive: an attested form, or a known root followed by a chain of Turkish suffixes."""
    word = lower(word)
    if not ensure_loaded():
        return True  # unknown territory: never claim a word is wrong
    if word in _state["forms"] or word in _state["stems"]:
        return True
    stems = _state["stems"]
    for i in range(len(word) - 1, 1, -1):
        stem = word[:i]
        if stem in stems and (i >= 3 or stem in _SHORT_ROOTS) and _SUFFIX_RE.fullmatch(word[i:]):
            return True
    return False


# Inflection only, in the order Turkish stacks it (no derivation): used to decide whether a word we have
# never seen listed is good enough to SUGGEST. Nouns: plural, possessive, case, copula. Verbs: negation,
# tense/aspect, person.
_POSS = "ım|im|um|üm|ın|in|un|ün|ı|i|u|ü|sı|si|su|sü|ımız|imiz|umuz|ümüz|ınız|iniz|unuz|ünüz|ları|leri|m|n"
_CASE = "yı|yi|yu|yü|nı|ni|nu|nü|ı|i|u|ü|a|e|ya|ye|na|ne|da|de|ta|te|nda|nde|dan|den|tan|ten|ndan|nden|ın|in|un|ün|nın|nin|nun|nün|yla|yle|la|le|ca|ce"
_COPULA = "yım|yim|yum|yüm|sın|sin|sun|sün|dır|dir|dur|dür|tır|tir|tur|tür|ız|iz|uz|üz|ki"
_TENSE = (
    "ıyor|iyor|uyor|üyor|yor|dı|di|du|dü|tı|ti|tu|tü|mış|miş|muş|müş|acak|ecek|yacak|yecek|"
    "ar|er|ır|ir|ur|ür|malı|meli|sa|se|ıp|ip|up|üp|arak|erek|ınca|ince|a|e|ya|ye|mak|mek"
)
_PERSON = "m|n|k|ım|im|um|üm|sın|sin|sun|sün|ız|iz|uz|üz|nız|niz|nuz|nüz|sınız|siniz|sunuz|sünüz|lar|ler|dı|di|du|dü|mış|miş|muş|müş|ydı|ydi|ydu|ydü"
_STRICT_NOUN = re.compile(f"(?:lar|ler)?(?:{_POSS})?(?:{_CASE})?(?:{_COPULA})?")
_STRICT_VERB = re.compile(f"(?:ma|me)?(?:{_TENSE})?(?:{_PERSON})?(?:{_PERSON})?")

_BACK, _FRONT = set("aıou"), set("eiöü")


def _harmonic(stem, tail):
    """Do the vowels of the suffixes follow the stem's vowel harmony (back/front)? -yor is the one exception."""
    vowels = [c for c in stem if c in _BACK or c in _FRONT]
    if not vowels:
        return False
    prev = vowels[-1]
    tail = tail.replace("yor", "y_r")  # its 'o' is back after a front stem: skip it
    for c in tail:
        if c in _BACK or c in _FRONT:
            if (prev in _BACK) != (c in _BACK):
                return False
            prev = c
    return True


def is_plausible_form(word):
    """Stricter than is_valid: a real root, 4+ letters, a short suffix chain with vowel harmony.
    Used to decide whether a word we have never seen listed is good enough to SUGGEST."""
    word = lower(word)
    if not ensure_loaded():
        return False
    if word in _state["forms"]:
        return True
    common = _state["common"]
    for i in range(len(word) - 1, 3, -1):
        stem, tail = word[:i], word[i:]
        if stem in common and len(tail) <= 11 and (not tail or (_harmonic(stem, tail) and (_STRICT_NOUN.fullmatch(tail) or _STRICT_VERB.fullmatch(tail)))):
            return True
    return False


# A plausible word that is not among the attested forms is still a fair guess for a correction,
# just a less likely one than a form people are known to write.
RARE_FORM_FREQ = 3.2e-6


def candidate_freq(word):
    """Frequency used to rank a correction candidate; 0 if it is not a (plausible) Turkish word."""
    f = form_freq(word)
    if f:
        return f
    return RARE_FORM_FREQ if len(word) >= 5 and is_plausible_form(word) else 0.0


def form_freq(word):
    ensure_loaded()
    forms = _state["forms"] or {}
    return forms.get(lower(word), 0.0)


# ── restoring letters ────────────────────────────────────────────────────────

_TOKEN = re.compile(r"[^\W\d_]+", re.UNICODE)


# The only changes the deasciifier is trusted to make: a plain letter gaining its Turkish form.
_ADDS = {"c": "ç", "g": "ğ", "i": "ı", "o": "ö", "s": "ş", "u": "ü", "C": "Ç", "G": "Ğ", "I": "İ", "O": "Ö", "S": "Ş", "U": "Ü"}


def deasciify(text):
    """'bugun hava cok guzel' -> 'bugün hava çok güzel'. Same length, same layout; letters are only ADDED.

    The deasciifier also *removes* accents where its context model disagrees (it turned a typo'd
    'krıldı' into 'krildi'); everything that is not a plain letter gaining its Turkish form is
    therefore thrown away, so text that is already right can only stay right.
    """
    if not ensure_loaded():
        return text
    try:
        restored = _state["deasciifier"](text).convert_to_turkish()
    except Exception:  # noqa: BLE001
        log.exception("deasciify failed")
        return text
    if len(restored) != len(text):
        return text
    return "".join(r if (r != o and _ADDS.get(o) == r) else o for o, r in zip(text, restored))


def ascii_turkish_evidence(text):
    """How strongly `text` looks like Turkish typed without Turkish letters, 0..1.

    Language detection is unreliable here (`bugun hava cok guzel` reads as Dutch), so the
    test is on the words themselves: restore the letters, and see how many of the words are
    real Turkish. Zero if the text already has Turkish letters, is too short, or the
    restoration changed nothing.
    """
    if has_turkish_letters(text) or not ready():
        return 0.0
    words = _TOKEN.findall(text)
    if len(words) < 2:
        return 0.0
    restored = deasciify(text)
    if restored == text:
        return 0.0
    new_words = _TOKEN.findall(restored)
    changed = sum(1 for a, b in zip(words, new_words) if a != b)
    if not changed:
        return 0.0
    # STRICT test (attested form, or a well-attested root with real inflection): the permissive is_valid would
    # call "jumps" and "lazy" Turkish and read English as Turkish.
    valid = sum(1 for w in new_words if len(w) >= 2 and is_plausible_form(w))
    turkish_share = valid / len(new_words)

    # Turkish web text is full of English words, so "these look Turkish" is not enough: the text must look
    # clearly MORE Turkish than English (as typed, before restoring letters).
    try:
        import spelling

        english = spelling.LEXICONS.get("en")
        if english:
            lowered = [w.lower() for w in words if len(w) >= 2]
            english_share = sum(1 for w in lowered if english.freq(w) >= spelling.TUNING.known_min) / max(len(lowered), 1)
            if turkish_share - english_share < 0.35:
                return 0.0
    except Exception:  # noqa: BLE001 - without the English list, fall back to the Turkish test alone
        pass
    return round(turkish_share, 3)

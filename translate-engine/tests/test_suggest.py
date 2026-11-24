"""'Did you mean…': Turkish letters, typos, accents. Uses the real Zemberek deasciifier and the real
word lists (both are in requirements.txt), plus small fake lexicons for the rule-level cases."""

import pytest

import detect
import spelling
import suggest
import turkish
from spelling import Lexicon


@pytest.fixture(scope="module", autouse=True)
def _loaded():
    assert turkish.ensure_loaded(), "Zemberek data must be installed"


def text_of(result):
    return result["suggestion"]["text"] if result["suggestion"] else None


# ── Turkish letters ──────────────────────────────────────────────────────────


def test_restores_turkish_letters():
    assert turkish.deasciify("bugun hava cok guzel ve ben parka gidiyorum") == "bugün hava çok güzel ve ben parka gidiyorum"
    assert turkish.deasciify("Mudur hasta oldugu icin toplanti ertelendi") == "Müdür hasta olduğu için toplantı ertelendi"


def test_chooses_by_context_ise_or_işe():
    assert "işe gitmem" in turkish.deasciify("Yarin sabah erken kalkip ise gitmem gerekiyor")
    assert "ise" in turkish.deasciify("Hava guzel ise parka gidelim")  # a real 'ise' (if) stays


def test_only_ever_adds_letters():
    # The deasciifier on its own turns a typo'd "krıldı" into "krildi"; we must never remove an accent.
    assert turkish.deasciify("krıldı") == "krıldı"
    correct = "Çocuklar bahçede oynarken annesi mutfakta yemek hazırlıyordu."
    assert turkish.deasciify(correct) == correct


def test_keeps_layout_and_length():
    text = "bugun cok guzel\n\n  yarin da  \tiyi"
    out = turkish.deasciify(text)
    assert len(out) == len(text)
    assert out.count("\n") == 2 and out.split("\n")[2].startswith("  ")


def test_evidence_that_text_is_ascii_turkish():
    assert turkish.ascii_turkish_evidence("bugun hava cok guzel ve ben parka gidiyorum") >= 0.9
    assert turkish.ascii_turkish_evidence("kapi acik kaldi") >= 0.9
    assert turkish.ascii_turkish_evidence("The quick brown fox jumps over the lazy dog") == 0.0
    assert turkish.ascii_turkish_evidence("Ich habe gestern einen langen Spaziergang gemacht") < 0.75
    assert turkish.ascii_turkish_evidence("bugün hava çok güzel") == 0.0  # already has its letters
    assert turkish.ascii_turkish_evidence("hello") == 0.0  # one word proves nothing


@pytest.mark.parametrize(
    "ascii_text,expected",
    [
        ("bugun hava cok guzel ve ben parka gidiyorum", "bugün hava çok güzel ve ben parka gidiyorum"),
        ("Mudur hasta oldugu icin toplanti ertelendi", "Müdür hasta olduğu için toplantı ertelendi"),
        ("merhaba nasilsin bugun ne yapiyorsun", "merhaba nasılsın bugün ne yapıyorsun"),
        ("kapi acik kaldi", "kapı açık kaldı"),
    ],
)
def test_offered_when_the_language_is_left_on_detect(ascii_text, expected):
    # The statistical detector calls these Dutch / Estonian / Indonesian; the Turkish word list knows better.
    result = suggest.suggest(ascii_text, "auto")
    assert result["language"] == "tr"
    assert text_of(result) == expected
    assert result["suggestion"]["kind"] == "diacritics"


def test_detection_itself_now_says_turkish_for_ascii_turkish():
    assert detect.detect("bugun hava cok guzel ve ben parka gidiyorum")["language"] == "tr"
    assert detect.detect("The quick brown fox jumps over the lazy dog near the river bank.")["language"] == "en"


def test_correct_turkish_is_left_alone():
    for s in ["Bugün hava çok güzel, parka gidip bir kitap okumak istiyorum.", "Ankara'dan İstanbul'a giden son tren saat kaçta kalkıyor?"]:
        assert suggest.suggest(s, "tr")["suggestion"] is None


def test_urls_and_emails_are_never_touched():
    out = text_of(suggest.suggest("bak https://www.cok-guzel.com/yarin ve yaz ali@cok-guzel.com cok guzel", "tr"))
    assert "https://www.cok-guzel.com/yarin" in out and "ali@cok-guzel.com" in out
    assert out.endswith("çok güzel")


def test_istanbul_with_an_apostrophe_gets_its_capital_dotted_I():
    assert text_of(suggest.suggest("Istanbul'a gidiyorum", "tr")) == "İstanbul'a gidiyorum"


def test_turkish_typos_are_fixed_conservatively():
    assert text_of(suggest.suggest("merhab nasılsın", "tr")) == "merhaba nasılsın"
    assert text_of(suggest.suggest("bugün çok güzell bir gün", "tr")) == "bugün çok güzel bir gün"
    # valid, heavily inflected words are NOT typos:
    for s in ["evlerimizdekilerden bahsediyordum", "gidemeyeceklerdi çünkü yağmur yağıyordu", "Zeki'nin telefonumdaki uygulamaları"]:
        assert suggest.suggest(s, "tr")["suggestion"] is None, s


# ── the suggestion's shape ───────────────────────────────────────────────────


def test_segments_rebuild_the_text_and_mark_what_changed():
    s = suggest.suggest("bugun cok guzel\nyarin da", "tr")["suggestion"]
    assert "".join(p["t"] for p in s["segments"]) == s["text"] == "bugün çok güzel\nyarın da"
    assert [p["t"] for p in s["segments"] if p["changed"]] == ["bugün", "çok", "güzel", "yarın"]
    assert s["changes"] == [{"from": "bugun", "to": "bugün"}, {"from": "cok", "to": "çok"}, {"from": "guzel", "to": "güzel"}, {"from": "yarin", "to": "yarın"}]
    assert s["count"] == 4


def test_nothing_to_suggest_for_tiny_or_empty_input():
    for s in ["", "  ", "ab", None]:
        assert suggest.suggest(s, "en")["suggestion"] is None


def test_can_be_switched_off(monkeypatch):
    monkeypatch.setattr(suggest.config, "SUGGEST_ENABLED", False)
    assert suggest.suggest("bugun cok guzel", "tr")["suggestion"] is None


# ── typos in other languages ─────────────────────────────────────────────────


def test_english_typos():
    out = suggest.suggest("Hello wrold, this is a tset", "en")["suggestion"]
    assert out["text"] == "Hello world, this is a test"
    assert out["kind"] == "spelling"
    assert text_of(suggest.suggest("Thanks for your quick replly, I will chek the document tomorow", "en")) == "Thanks for your quick reply, I will check the document tomorrow"
    assert text_of(suggest.suggest("don't forget teh keys", "en")) == "don't forget the keys"


def test_a_typo_in_the_middle_keeps_the_layout():
    s = "line one with a mistkae\n\nline three is fine\nand a secnd one"
    assert text_of(suggest.suggest(s, "en")) == "line one with a mistake\n\nline three is fine\nand a second one"


def test_the_slip_that_is_likelier_wins_over_the_commoner_word():
    # "replly" is "reply" with a doubled letter, not "really" with a wrong key
    assert "reply" in text_of(suggest.suggest("thanks for the quick replly", "en"))


def test_german_and_spanish():
    assert text_of(suggest.suggest("ich habe gestern eienn langen spaziergang gemacht", "de")) == "ich habe gestern einen langen spaziergang gemacht"
    assert text_of(suggest.suggest("Quiero resevar una mesa para esta noche", "es")) == "Quiero reservar una mesa para esta noche"


def test_language_left_on_detect_is_found_from_the_words():
    # typos make the statistical detector unsure (it says Italian, 0.58); the English word list votes
    result = suggest.suggest("helo how are yuo todya", "auto")
    assert result["language"] == "en"
    assert text_of(result) == "helo how are you today"


def test_names_acronyms_and_borrowed_words_are_left_alone():
    for s in ["Zeki and Maria are flying to Lisbn on Fridy", "HELO WORLD", "Our iPhone app crashed after the latest iOS update"]:
        assert suggest.suggest(s, "en")["suggestion"] is None, s


def test_precision_guard_on_1600_correct_words():
    """Every word in these corpora is right. Any suggestion is a regression: a wrong 'correction' is worse
    than a missed typo. (tools/eval_suggest.py prints the same measurement with recall.)"""
    from tools.eval_data import CORPORA

    wrongly_changed = []
    for lang, corpus in CORPORA.items():
        for sentence in corpus:
            s = suggest.suggest(sentence, lang)["suggestion"]
            if s:
                wrongly_changed.append((lang, sentence, s["changes"]))
    assert wrongly_changed == []


# ── the rules, with small fake word lists ────────────────────────────────────


def fake(freqs, lang="en"):
    return Lexicon(lang, freqs, alphabet="abcdefghijklmnopqrstuvwxyzé")


WORDS = {"hello": 1e-4, "world": 1e-4, "the": 1e-2, "then": 1e-3, "than": 1e-3, "cafe": 2e-7, "café": 3e-5, "dealing": 5e-4, "deadline": 1e-4,
         "tomorrow": 1e-4, "tomorow": 8e-7, "receive": 5e-5, "name": 1e-3, "names": 1e-3}


def run(text, **kw):
    return spelling.check(text, "en", lexicon=fake(WORDS), **kw)


def test_rule_unknown_word_with_a_far_commoner_neighbour():
    assert run("hello wrold") == {6: ("wrold", "world")}


def test_rule_known_words_are_never_touched():
    assert run("hello world the then") == {}


def test_rule_capitalised_words_and_acronyms_are_skipped():
    assert run("Wrold") == {} and run("WROLD") == {} and run("iPhone wrold") == {7: ("wrold", "world")}


def test_rule_apostrophes_digits_and_short_words_are_skipped():
    assert run("wrold's") == {} and run("wr") == {} and run("wrold2") == {}


def test_rule_protected_ranges_are_skipped():
    assert run("hello wrold", skip_ranges=[(6, 11)]) == {}


def test_rule_missing_accent_is_restored_when_the_accented_word_is_far_commoner():
    assert spelling.check("un cafe", "fr", lexicon=fake(WORDS, "fr")) == {3: ("cafe", "café")}


def test_rule_a_listed_but_rare_word_needs_a_much_commoner_classic_slip():
    # "tomorow" is listed in web text (tier B): fixed only if "tomorrow" is 600x commoner AND it is a classic slip
    assert run("see you tomorow") == {}  # 8e-7 vs 1e-4 = 125x: leave it
    far_commoner = dict(WORDS, tomorow=4e-7, tomorrow=1e-3)  # 2500x
    assert spelling.check("see you tomorow", "en", lexicon=fake(far_commoner)) == {8: ("tomorow", "tomorrow")}


def test_rule_case_is_kept():
    assert spelling._match_case("Wrold", "world") == "World"  # noqa: SLF001
    assert spelling._match_case("WROLD", "world") == "WORLD"  # noqa: SLF001


def test_rule_edit_weights_prefer_missing_letters_and_swaps():
    e = spelling.edits1("dealine", "abcdefghijklmnopqrstuvwxyz")
    assert e["deadline"] == 1.0  # a letter left out
    assert e["dealing"] < 0.5  # a random wrong key
    assert spelling.edits1("teh", "abc")["the"] == 1.0  # swapped
    assert spelling.edits1("replly", "abc")["reply"] == 1.0  # doubled letter


def test_rule_cpu_guard_limits_how_many_unknown_words_are_examined(monkeypatch):
    monkeypatch.setattr(spelling, "TUNING", spelling.Tuning(max_checked=2))
    found = run("wrold wrold wrold wrold")
    assert len(found) == 2


def test_rule_a_language_without_a_word_list_gives_no_suggestions():
    assert spelling.check("hello wrold", "xx") == {}

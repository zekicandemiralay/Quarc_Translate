"""The pipeline with a fake "model", so what is under test is everything we wrote
around the model: layout, protection, capitals, routing, errors."""

from contextlib import contextmanager
from types import SimpleNamespace

import pytest

import config
import pipeline
from store import ModelNotReady


class FakeStore:
    def __init__(self, ready=True):
        self.ready = ready
        self.ensured = []

    def ensure(self, spec, priority=1):
        self.ensured.append(spec.key)
        return SimpleNamespace(state="ready" if self.ready else "downloading", pct=12)

    @contextmanager
    def use(self, spec):
        yield SimpleNamespace(spec=spec)


class Recorder:
    """Stands in for the model: tags every sentence with the language pair it went through."""

    def __init__(self, transform=None):
        self.calls = []
        self.transform = transform

    def __call__(self, loaded, texts, source, target):
        self.calls.append((loaded.spec.key, source, target, list(texts)))
        if self.transform:
            return [self.transform(t, source, target, len(self.calls)) for t in texts]
        return [f"[{target}] {t}" for t in texts]


def make(run=None, store=None, detector=None):
    store = store or FakeStore()
    run = run or Recorder()
    detector = detector or (lambda text: {"language": "en", "confidence": 0.99, "candidates": []})
    return pipeline.Engine(store, run=run, detector=detector), run, store


def test_layout_is_kept_exactly_blank_lines_indent_bullets_trailing_space():
    engine, _run, _ = make()
    text = "Dear Sir,\n\nThank you. Please reply.\n  - one\n  - two  \n\nBye"
    out = engine.translate(text, "en", "tr")["translatedText"]
    assert out.split("\n") == [
        "[tr] Dear Sir,",
        "",
        "[tr] Thank you. [tr] Please reply.",
        "  - [tr] one",
        "  - [tr] two  ",
        "",
        "[tr] Bye",
    ]


def test_identical_sentences_are_translated_once():
    engine, run, _ = make()
    engine.translate("Yes.\nYes.\nNo.\nYes.", "en", "tr")
    sent = run.calls[0][3]
    assert sorted(sent) == ["No.", "Yes."]


def test_the_model_never_sees_blank_lines_or_list_markers():
    engine, run, _ = make()
    engine.translate("- Milk\n\n- Eggs", "en", "tr")
    assert run.calls[0][3] == ["Milk", "Eggs"]


def test_emails_and_links_are_protected_from_the_model():
    def corrupt(text, _s, _t, _n):
        return text.replace("support@example.com", "Destek@example.com")  # what tc-big really did

    engine, run, _ = make(Recorder(corrupt))
    out = engine.translate("Contact support@example.com or https://example.com/help?id=42 today.", "en", "tr")["translatedText"]
    assert out == "Contact support@example.com or https://example.com/help?id=42 today."
    assert "support@" not in run.calls[0][3][0], "the model saw a placeholder, not the address"


def test_a_lost_placeholder_makes_that_sentence_be_redone_unprotected():
    def lose_first_time(text, _s, _t, n):
        return text.replace("QZ0", "") if n == 1 else f"[ok] {text}"

    engine, run, _ = make(Recorder(lose_first_time))
    out = engine.translate("Mail a@b.org now.", "en", "tr")["translatedText"]
    assert out == "[ok] Mail a@b.org now."
    assert len(run.calls) == 2


def test_a_sentence_that_is_only_a_link_or_a_number_is_not_sent_to_the_model():
    engine, run, _ = make()
    out = engine.translate("https://example.com/x\nHello there", "en", "tr")["translatedText"]
    assert out == "https://example.com/x\n[tr] Hello there"
    assert run.calls[0][3] == ["Hello there"]


def test_all_caps_is_translated_as_a_normal_sentence_and_shouted_back():
    engine, run, _ = make(Recorder(lambda t, *_: t))
    out = engine.translate("DO NOT OPEN THE DOOR", "en", "tr")["translatedText"]
    assert run.calls[0][3] == ["Do not open the door"]
    assert out == "DO NOT OPEN THE DOOR"

    engine, _run, _ = make(Recorder(lambda *_: "kapıyı açmayın"))
    assert engine.translate("DO NOT OPEN THE DOOR", "en", "tr")["translatedText"] == "KAPIYI AÇMAYIN"


def test_chinese_and_japanese_are_joined_without_spaces():
    engine, _run, _ = make(Recorder(lambda t, s, tgt, n: {"Hello.": "你好。", "Bye.": "再见。"}[t]))
    assert engine.translate("Hello. Bye.", "en", "zh")["translatedText"] == "你好。再见。"


def test_a_route_through_english_runs_two_models_in_order():
    engine, run, store = make()
    result = engine.translate("Guten Tag.", "de", "tr")
    assert [(c[0], c[1], c[2]) for c in run.calls] == [("opus-mt-de-en", "de", "en"), ("opus-mt-tc-big-en-tr", "en", "tr")]
    assert run.calls[1][3] == ["[en] Guten Tag."], "the second model gets the first one's output"
    assert result["translatedText"] == "[tr] [en] Guten Tag."
    assert result["route"]["pivot"] is True
    assert result["route"]["models"] == ["opus-mt-de-en", "opus-mt-tc-big-en-tr"]


def test_same_language_returns_the_text_and_touches_no_model():
    engine, run, store = make()
    result = engine.translate("Merhaba", "tr", "tr")
    assert result["translatedText"] == "Merhaba"
    assert run.calls == [] and store.ensured == []


def test_auto_uses_the_detected_language_and_reports_it():
    detector = lambda text: {"language": "de", "confidence": 0.93, "candidates": []}
    engine, run, _ = make(detector=detector)
    result = engine.translate("Guten Tag", "auto", "en")
    assert run.calls[0][1] == "de"
    assert result["detectedLanguage"] == {"language": "de", "confidence": 0.93}


def test_a_model_that_is_still_downloading_raises_with_progress_and_queues_every_leg():
    engine, run, store = make(store=FakeStore(ready=False))
    with pytest.raises(ModelNotReady) as info:
        engine.translate("Guten Tag", "de", "tr")
    assert info.value.stage == "downloading" and info.value.pct == 12
    assert set(store.ensured) == {"opus-mt-de-en", "opus-mt-tc-big-en-tr"}, "both halves start downloading at once"
    assert run.calls == []


def test_empty_unsupported_and_oversized_input():
    engine, _run, _ = make()
    assert engine.translate("   \n ", "en", "tr")["translatedText"] == ""
    with pytest.raises(pipeline.TranslateError) as e:
        engine.translate("hi", "en", "xx")
    assert e.value.code == "unsupported_language"
    with pytest.raises(pipeline.TranslateError) as e:
        engine.translate("hi", "xx", "en")
    assert e.value.code == "unsupported_language"
    with pytest.raises(pipeline.TranslateError) as e:
        engine.translate("a" * (config.MAX_INPUT_CHARS + 1), "en", "tr")
    assert e.value.code == "text_too_long"


def test_region_codes_and_case_are_accepted():
    engine, run, _ = make()
    engine.translate("Hello", "EN-us", "TR")
    assert (run.calls[0][1], run.calls[0][2]) == ("en", "tr")


def test_prepare_queues_pairs_and_ignores_nonsense():
    engine, _run, store = make()
    started = engine.prepare([("de", "tr"), ("en", "en"), ("xx", "tr"), ("auto", "tr")])
    assert [s["model"] for s in started] == ["opus-mt-de-en", "opus-mt-tc-big-en-tr"]
    assert store.ensured == ["opus-mt-de-en", "opus-mt-tc-big-en-tr"]


# ── tappable sentences and alternatives ──────────────────────────────────────


def test_segments_rebuild_the_translation_exactly_and_mark_each_sentence():
    engine, _run, _ = make()
    text = "Dear Sir,\n\nThank you. Please reply.\n  - one\n  - two  \nBye"
    out = engine.translate(text, "en", "tr")
    assert "".join(s["t"] for s in out["segments"]) == out["translatedText"]
    sentences = [out["units"][s["u"]] for s in out["segments"] if s["u"] is not None]
    assert [u["src"] for u in sentences] == ["Dear Sir,", "Thank you.", "Please reply.", "one", "two", "Bye"]
    assert [u["out"] for u in sentences][1] == "[tr] Thank you."
    # layout is NOT part of any sentence
    assert all(s["u"] is None for s in out["segments"] if s["t"].strip() in ("", "-") or s["t"] == "  - ")


def test_a_sentence_that_was_not_translated_is_marked_so():
    engine, _run, _ = make()
    out = engine.translate("https://example.com/x\nHello there", "en", "tr")
    flags = {u["src"]: u["alt"] for u in out["units"]}
    assert flags == {"https://example.com/x": False, "Hello there": True}


def test_repeated_sentences_get_their_own_unit_each_time():
    engine, _run, _ = make()
    out = engine.translate("Yes. Yes.", "en", "tr")
    assert [u["src"] for u in out["units"]] == ["Yes.", "Yes."]
    assert sum(1 for s in out["segments"] if s["u"] is not None) == 2


def test_chinese_output_has_no_spaces_between_sentence_segments():
    engine, _run, _ = make(Recorder(lambda t, s, tgt, n: {"Hello.": "你好。", "Bye.": "再见。"}[t]))
    out = engine.translate("Hello. Bye.", "en", "zh")
    assert [s["t"] for s in out["segments"]] == ["你好。", "再见。"]


class NBest:
    """A fake n-best runner: the model's candidates for each sentence, best first."""

    def __init__(self, table):
        self.table, self.calls = table, []

    def __call__(self, loaded, texts, source, target, n):
        self.calls.append((loaded.spec.key, source, target, list(texts), n))
        return [self.table.get(t, [f"[{target}] {t}"]) for t in texts]


def make_alt(table):
    nbest = NBest(table)
    store = FakeStore()
    engine = pipeline.Engine(store, run=Recorder(), detector=lambda t: {"language": "en", "confidence": 0.99, "candidates": []}, run_nbest=nbest)
    return engine, nbest, store


def test_alternatives_are_the_models_other_candidates_best_first():
    engine, nbest, _ = make_alt({"Good morning, how are you?": ["Günaydın, nasılsın?", "Günaydın, nasılsınız?", "Sabah şerifleriniz hayrolsun, nasılsın?"]})
    out = engine.alternatives("Good morning, how are you?", "en", "tr", n=3)
    assert out["alternatives"] == ["Günaydın, nasılsın?", "Günaydın, nasılsınız?", "Sabah şerifleriniz hayrolsun, nasılsın?"]
    assert nbest.calls[0][4] == 3


def test_near_duplicates_are_not_alternatives():
    engine, _n, _ = make_alt({"Hi there": ["Merhaba.", "merhaba", "Merhaba!", "Selam"]})
    assert engine.alternatives("Hi there", "en", "tr")["alternatives"] == ["Merhaba.", "Selam"]


def test_alternatives_keep_links_and_drop_variants_that_lost_them():
    # the model sees a placeholder; a variant that drops it must not be offered
    engine, _n, _ = make_alt({"Write to QZ0 now": ["QZ0 adresine yazın", "şimdi yazın", "Şimdi QZ0 adresine yazın"]})
    out = engine.alternatives("Write to me@x.org now", "en", "tr")["alternatives"]
    assert out == ["me@x.org adresine yazın", "Şimdi me@x.org adresine yazın"]


def test_alternatives_of_shouting_stay_shouting():
    engine, _n, _ = make_alt({"Do not open the door": ["Kapıyı açma", "Kapıyı açmayın"]})
    assert engine.alternatives("DO NOT OPEN THE DOOR", "en", "tr")["alternatives"] == ["KAPIYI AÇMA", "KAPIYI AÇMAYIN"]


def test_alternatives_through_english_vary_only_the_last_leg():
    engine, nbest, store = make_alt({"[en] Guten Tag": ["Iyi gunler", "Merhaba"]})
    engine.run = Recorder()  # the first leg runs normally: de -> en
    out = engine.alternatives("Guten Tag", "de", "tr")["alternatives"]
    assert out == ["Iyi gunler", "Merhaba"]
    assert nbest.calls[0][1:3] == ("en", "tr"), "only the English -> Turkish leg is n-best"


def test_alternatives_edge_cases():
    engine, nbest, _ = make_alt({})
    assert engine.alternatives("   ", "en", "tr") == {"alternatives": []}
    assert engine.alternatives("Hello", "tr", "tr") == {"alternatives": []}
    assert engine.alternatives("https://example.com/x", "en", "tr") == {"alternatives": []}
    assert nbest.calls == []
    with pytest.raises(pipeline.TranslateError) as e:
        engine.alternatives("x" * 700, "en", "tr")
    assert e.value.code == "text_too_long"
    with pytest.raises(pipeline.TranslateError) as e:
        engine.alternatives("Hello", "en", "xx")
    assert e.value.code == "unsupported_language"


def test_alternatives_wait_for_a_model_that_is_still_downloading():
    engine = pipeline.Engine(FakeStore(ready=False), run=Recorder(), detector=lambda t: {"language": "en", "confidence": 0.9, "candidates": []}, run_nbest=NBest({}))
    with pytest.raises(ModelNotReady):
        engine.alternatives("Hello there", "en", "tr")

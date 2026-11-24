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

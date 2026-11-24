import re

import pytest

import config
import languages
import routes


def keys(source, target):
    return [(s.model.key, s.source, s.target) for s in routes.plan(source, target)]


def test_a_pair_with_a_dedicated_model_uses_it_directly():
    assert keys("tr", "en") == [("opus-mt-tc-big-tr-en", "tr", "en")]
    assert keys("en", "de") == [("opus-mt-en-de", "en", "de")]


def test_two_dedicated_halves_are_chained_through_english():
    assert keys("de", "tr") == [("opus-mt-de-en", "de", "en"), ("opus-mt-tc-big-en-tr", "en", "tr")]
    assert keys("tr", "fr") == [("opus-mt-tc-big-tr-en", "tr", "en"), ("opus-mt-tc-big-en-fr", "en", "fr")]


def test_everything_else_goes_to_the_general_model():
    assert [s.model.kind for s in routes.plan("tr", "ka")] == ["nllb"]
    assert [s.model.kind for s in routes.plan("ja", "tr")] == ["nllb"]  # no dedicated ja→en half
    steps = routes.plan("ka", "tr")
    assert (steps[0].source, steps[0].target) == ("ka", "tr")


def test_pivot_can_be_switched_off(monkeypatch):
    monkeypatch.setattr(config, "PIVOT", "off")
    assert [s.model.kind for s in routes.plan("de", "tr")] == ["nllb"]


def test_the_general_model_size_is_a_setting(monkeypatch):
    monkeypatch.setattr(config, "NLLB_SIZE", "600M")
    assert routes.plan("ka", "tr")[0].model.key == "nllb-200-distilled-600M"
    monkeypatch.setattr(config, "NLLB_SIZE", "1.3B")
    assert routes.plan("ka", "tr")[0].model.key == "nllb-200-distilled-1.3B"
    monkeypatch.setattr(config, "NLLB_SIZE", "garbage")
    assert routes.plan("ka", "tr")[0].model.key == "nllb-200-distilled-1.3B"


def test_every_model_is_pinned_to_an_exact_revision():
    for spec in routes.all_specs().values():
        assert re.fullmatch(r"[0-9a-f]{40}", spec.revision), spec.key
        if spec.kind == "nllb":
            assert re.fullmatch(r"[0-9a-f]{40}", spec.tokenizer_revision), spec.key


def test_dedicated_pairs_only_involve_registered_languages():
    for source, target in routes.DEDICATED:
        assert languages.is_supported(source) and languages.is_supported(target)
        assert "en" in (source, target)  # the pivot logic relies on this


def test_every_language_can_be_planned_both_ways():
    for code in languages.LANGUAGES:
        if code != "en":
            assert routes.plan(code, "en") and routes.plan("en", code)


def test_languages_registry_is_consistent():
    codes = list(languages.LANGUAGES)
    assert len(codes) == len(set(codes))
    nllb = [l.nllb for l in languages.LANGUAGES.values()]
    assert len(nllb) == len(set(nllb)), "two languages share an NLLB code"
    assert all(re.fullmatch(r"[a-z]{3}_[A-Z][a-z]{3}", c) for c in nllb)


def test_normalize_understands_regions_aliases_and_case():
    assert languages.normalize("EN") == "en"
    assert languages.normalize("en-US") == "en"
    assert languages.normalize("zh_CN") == "zh"
    assert languages.normalize("nb") == "no"
    assert languages.normalize("iw") == "he"
    assert languages.normalize("xx") is None
    assert languages.normalize(None) is None
    assert languages.normalize(5) is None

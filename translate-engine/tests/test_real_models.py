"""End to end with the REAL models: downloads the pinned revisions through the
production provisioning code, then translates. Skipped unless asked for (≈2 GB
of downloads, a few minutes):

    QUARC_REAL_MODELS=1 python -m pytest tests/test_real_models.py -v -s

Set QUARC_REAL_MODELS_DIR to keep the models between runs.
"""

import os
import re
import time

import pytest

pytestmark = pytest.mark.skipif(not os.environ.get("QUARC_REAL_MODELS"), reason="set QUARC_REAL_MODELS=1 to run (downloads ~2 GB)")

import config
import pipeline
import routes
from store import ModelStore


@pytest.fixture(scope="module")
def engine(tmp_path_factory):
    root = os.environ.get("QUARC_REAL_MODELS_DIR") or str(tmp_path_factory.mktemp("models"))
    store = ModelStore(root, ram_mb=6000, max_models=0, loader=pipeline.load_ctranslate2, min_free_disk_mb=500)
    eng = pipeline.Engine(store)
    eng.prepare([("tr", "en"), ("en", "tr"), ("de", "en"), ("en", "de"), ("en", "ka")])

    deadline = time.time() + 40 * 60
    wanted = [s.model for pair in [("tr", "en"), ("en", "tr"), ("de", "en"), ("en", "de"), ("en", "ka")] for s in routes.plan(*pair)]
    while time.time() < deadline:
        entries = [store.ensure(m) for m in wanted]
        failed = [e.error for e in entries if e.state == "failed"]
        assert not failed, failed
        if all(e.state == "ready" for e in entries):
            break
        time.sleep(2)
    else:
        raise AssertionError("models did not become ready in time")
    return eng


def tr(engine, text, source, target):
    return engine.translate(text, source, target)


def test_turkish_to_english_reads_naturally(engine):
    out = tr(engine, "Lütfen bana tren istasyonuna nasıl gideceğimi söyleyebilir misiniz?", "tr", "en")["translatedText"]
    assert "train station" in out.lower(), out


def test_english_to_turkish(engine):
    out = tr(engine, "Thank you very much!", "en", "tr")["translatedText"]
    assert "teşekkür" in out.lower(), out


def test_a_pasted_email_keeps_its_paragraphs_and_bullets(engine):
    text = "Dear Mr. Yilmaz,\n\nThank you for your email. We will reply soon.\n\n- the invoice\n- the contract\n\nBest regards,\nAnna"
    result = tr(engine, text, "en", "tr")["translatedText"]
    lines = result.split("\n")
    src = text.split("\n")
    assert len(lines) == len(src), result
    assert [i for i, l in enumerate(lines) if not l.strip()] == [i for i, l in enumerate(src) if not l.strip()]
    assert lines[4].startswith("- ") and lines[5].startswith("- "), lines
    assert lines[0].lower().startswith("sayın"), lines[0]


def test_an_email_address_and_a_link_survive_the_model(engine):
    text = "Contact us at support@example.com or visit https://www.example.com/help-center?id=42 for more details."
    out = tr(engine, text, "en", "tr")["translatedText"]
    assert "support@example.com" in out, out  # tc-big used to turn this into Destek@example.com
    assert "https://www.example.com/help-center?id=42" in out, out


def test_german_to_turkish_goes_through_english(engine):
    result = tr(engine, "Ich möchte einen Tisch für zwei Personen reservieren.", "de", "tr")
    assert result["route"]["pivot"] is True
    assert "masa" in result["translatedText"].lower(), result


def test_the_general_model_covers_languages_without_a_dedicated_one(engine):
    result = tr(engine, "Thank you so much! I will see you tomorrow.", "en", "ka")
    out = result["translatedText"]
    assert re.search(r"[Ⴀ-ჿ]", out), out  # Georgian script
    assert result["route"]["models"][0].startswith("nllb")
    assert " ." not in out and " ," not in out, out  # NLLB's spaced punctuation is cleaned
    assert out.count("მადლობა") <= 2, out  # no "Thank you! Thank you!" echo


def test_all_caps_stays_all_caps(engine):
    out = tr(engine, "WARNING: DO NOT OPEN THE DOOR WHILE THE MACHINE IS RUNNING", "en", "tr")["translatedText"]
    assert out == out.upper() and "UYARI" in out, out


def test_auto_detect_end_to_end(engine):
    result = tr(engine, "Günaydın, bugün hava çok güzel ve ben parka gidiyorum.", "auto", "en")
    assert result["detectedLanguage"]["language"] == "tr"
    assert "park" in result["translatedText"].lower()


def test_a_long_text_is_translated_whole(engine):
    sentence = "The meeting has been postponed until next Thursday because the manager is ill. "
    result = tr(engine, sentence * 30, "en", "tr")
    assert result["translatedText"].count("toplantı") >= 25, result["translatedText"][:200]


def test_nllb_manual_tokenisation_matches_the_library(engine):
    """_encode builds the token list without mutating the shared tokenizer (requests run in parallel);
    it must equal what the library's own encode() produces."""
    spec = routes.general_model()
    with engine.store.use(spec) as loaded:
        tok = loaded.tokenizer
        for text, lang in [("Hello, how are you?", "en"), ("Bugün hava çok güzel.", "tr")]:
            tok.src_lang = routes.languages.nllb_code(lang)
            assert pipeline._encode(loaded, text, lang) == tok.convert_ids_to_tokens(tok.encode(text))

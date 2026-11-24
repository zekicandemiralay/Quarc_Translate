from contextlib import contextmanager
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

import pipeline
import service
from store import ModelFailed, ModelNotReady
from routes import general_model


class StubStore:
    state = "ready"

    def ensure(self, spec, priority=1):
        return SimpleNamespace(state=self.state, pct=40)

    @contextmanager
    def use(self, spec):
        yield SimpleNamespace(spec=spec)

    def snapshot(self, specs=()):
        return {
            "models": [
                {"key": "m1", "label": "m1", "repo": "x/m1", "state": "loaded", "pct": None, "error": None, "sizeMb": 100},
                {"key": "m2", "label": "m2", "repo": "x/m2", "state": "downloading", "pct": 37, "error": None, "sizeMb": 100},
                {"key": "m3", "label": "m3", "repo": "x/m3", "state": "failed", "pct": None, "error": "boom", "sizeMb": 100},
            ],
            "ramUsedMb": 100,
            "ramBudgetMb": 2600,
            "queued": 1,
        }

    def loaded_keys(self):
        return ["m1"]


@pytest.fixture
def client():
    store = StubStore()
    engine = pipeline.Engine(store, run=lambda loaded, texts, s, t: [f"[{t}] {x}" for x in texts], detector=lambda t: {"language": "en", "confidence": 0.9, "candidates": []})
    return TestClient(service.create_app(engine=engine, store=store, warm=False)), engine, store


def test_translate_roundtrip(client):
    c, *_ = client
    r = c.post("/translate", json={"q": "Hello.\nWorld.", "source": "en", "target": "tr"})
    assert r.status_code == 200
    body = r.json()
    assert body["translatedText"] == "[tr] Hello.\n[tr] World."
    assert body["detectedLanguage"]["language"] == "en"


def test_a_model_that_is_downloading_is_a_503_with_everything_the_app_needs(client):
    c, engine, store = client
    store.state = "downloading"
    r = c.post("/translate", json={"q": "Hello", "source": "en", "target": "tr"})
    assert r.status_code == 503
    detail = r.json()["detail"]
    assert detail["code"] == "model_preparing"
    assert detail["stage"] == "downloading" and detail["pct"] == 40
    assert detail["model"] == "opus-mt-tc-big-en-tr"
    assert detail["retryAfter"] >= 1
    assert r.headers["retry-after"] == "3"


def test_a_failed_model_is_a_502_not_a_hang(client):
    c, engine, _ = client
    engine.translate = lambda *a, **k: (_ for _ in ()).throw(ModelFailed(general_model(), "disk full"))
    r = c.post("/translate", json={"q": "Hello", "source": "en", "target": "ka"})
    assert r.status_code == 502
    assert r.json()["detail"]["code"] == "model_failed"
    assert r.json()["detail"]["message"] == "disk full"


def test_bad_input_is_a_clean_4xx(client):
    c, *_ = client
    assert c.post("/translate", json={"q": "x", "target": "xx"}).json()["detail"]["code"] == "unsupported_language"
    assert c.post("/translate", json={"q": "x" * 7000, "source": "en", "target": "tr"}).json()["detail"]["code"] == "text_too_long"
    assert c.post("/translate", json={"target": "tr"}).status_code == 422


def test_languages_payload_is_what_the_app_expects(client):
    c, *_ = client
    langs = c.get("/languages").json()
    tr = next(l for l in langs if l["code"] == "tr")
    assert tr == {"code": "tr", "name": "Türkçe", "nameEn": "Turkish", "rtl": False}
    assert next(l for l in langs if l["code"] == "ar")["rtl"] is True
    assert len(langs) >= 50


def test_detect_endpoint(client):
    c, *_ = client
    assert c.post("/detect", json={"q": "hello there"}).json()["language"] == "en"


def test_health_summarises_models_for_check_sh(client):
    c, *_ = client
    h = c.get("/health").json()
    assert h["ok"] is True
    assert h["loaded"] == ["m1"]
    assert h["preparing"] == [{"key": "m2", "state": "downloading", "pct": 37}]
    assert h["failed"] == [{"key": "m3", "error": "boom"}]
    assert h["ramBudgetMb"] == 2600


def test_models_endpoint_lists_routes_and_the_general_model(client):
    c, *_ = client
    m = c.get("/models").json()
    assert m["generalModel"].startswith("nllb")
    assert m["routes"]["tr"] == {"toEnglish": "dedicated", "fromEnglish": "dedicated"}
    assert m["routes"]["ka"] == {"toEnglish": "general", "fromEnglish": "general"}


def test_prepare_endpoint_queues_models(client):
    c, *_ = client
    r = c.post("/models/prepare", json={"pairs": [["en", "de"], ["de", "tr"]]}).json()
    assert [q["model"] for q in r["queued"]] == ["opus-mt-en-de", "opus-mt-de-en", "opus-mt-tc-big-en-tr"]

"""HTTP layer of the engine. Internal service: only the `backend` container
talks to it, so there is no authentication here (it is not published to the host).

A model that is still being fetched is never a hang or a crash: the answer is
503 {"code": "model_preparing", "stage": …, "retryAfter": …} and the app shows
"preparing the language pack" and tries again.
"""

import logging
import threading
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

import config
import languages
import pipeline
import routes
from store import ModelFailed, ModelNotReady, ModelStore

log = logging.getLogger("service")


class TranslateRequest(BaseModel):
    q: str
    source: str = "auto"
    target: str
    format: str = "text"  # accepted for compatibility with the LibreTranslate shape; text only


class DetectRequest(BaseModel):
    q: str


class PrepareRequest(BaseModel):
    pairs: list[list[str]] = Field(default_factory=list, max_length=20)


def _error(status, code, message, **extra):
    return JSONResponse(status_code=status, content={"detail": {"code": code, "message": message, **extra}})


def build_store():
    return ModelStore(
        config.MODEL_DIR,
        ram_mb=config.MODEL_RAM_MB,
        max_models=config.MAX_LOADED_MODELS,
        loader=pipeline.load_ctranslate2,
        min_free_disk_mb=config.MIN_FREE_DISK_MB,
    )


def _warm_up(engine, store):
    """Fetch the configured pairs in the background, then load the first one into RAM so
    the first real translation doesn't pay for it."""
    pairs = []
    for item in config.PREPARE_ON_START:
        parts = item.replace("-", ":").split(":")
        if len(parts) == 2 and languages.is_supported(parts[0]) and languages.is_supported(parts[1]):
            pairs.append((parts[0], parts[1]))
    if not pairs:
        return
    engine.prepare(pairs, priority=1)

    first = routes.plan(*[languages.normalize(c) for c in pairs[0]])
    deadline = time.time() + 6 * 3600
    while time.time() < deadline:
        entries = [store.ensure(step.model, priority=1) for step in first]
        if all(e.state == "ready" for e in entries):
            for step in first:
                try:
                    with store.use(step.model):
                        pass
                except Exception:  # noqa: BLE001 - warming is a nicety
                    log.exception("could not warm %s", step.model.key)
            log.info("warm: %s", ", ".join(s.model.key for s in first))
            return
        if any(e.state == "failed" for e in entries):
            log.warning("warm-up skipped: %s", "; ".join(e.error for e in entries if e.error))
            return
        time.sleep(3)


def create_app(engine=None, store=None, warm=True):
    store = store or build_store()
    engine = engine or pipeline.Engine(store)

    @asynccontextmanager
    async def lifespan(_app):
        if warm:
            threading.Thread(target=_warm_up, args=(engine, store), name="warm-up", daemon=True).start()
        yield

    app = FastAPI(title="Quarc Translate engine", version=config.VERSION, lifespan=lifespan)

    @app.get("/health")
    def health():
        snap = store.snapshot()
        states = [m["state"] for m in snap["models"]]
        return {
            "ok": True,
            "service": "quarc-translate-engine",
            "version": config.VERSION,
            "loaded": store.loaded_keys(),
            "ready": [m["key"] for m in snap["models"] if m["state"] in ("ready", "loaded")],
            "preparing": [
                {"key": m["key"], "state": m["state"], "pct": m["pct"]}
                for m in snap["models"]
                if m["state"] in ("queued", "downloading", "converting", "finalizing")
            ],
            "failed": [{"key": m["key"], "error": m["error"]} for m in snap["models"] if m["state"] == "failed"],
            "ramUsedMb": snap["ramUsedMb"],
            "ramBudgetMb": snap["ramBudgetMb"],
            "busy": states.count("downloading") + states.count("converting"),
        }

    @app.get("/languages")
    def list_languages():
        return languages.language_list()

    @app.post("/detect")
    def detect(payload: DetectRequest):
        return engine.detect(payload.q)

    @app.get("/models")
    def models():
        snap = store.snapshot(routes.all_specs().values())
        snap["routes"] = routes.routes_summary()
        snap["generalModel"] = routes.general_model().key
        return snap

    @app.post("/models/prepare")
    def prepare(payload: PrepareRequest):
        return {"queued": engine.prepare([tuple(p[:2]) for p in payload.pairs if len(p) >= 2])}

    @app.post("/translate")
    def translate(payload: TranslateRequest):
        try:
            return engine.translate(payload.q, payload.source, payload.target)
        except ModelNotReady as exc:
            pair = f"{payload.source}-{payload.target}"
            response = _error(
                503,
                "model_preparing",
                str(exc),
                model=exc.spec.key,
                stage=exc.stage,
                pct=exc.pct,
                pair=pair,
                retryAfter=3 if exc.stage != "queued" else 5,
            )
            response.headers["Retry-After"] = "3"
            return response
        except ModelFailed as exc:
            return _error(502, "model_failed", exc.message, model=exc.spec.key)
        except pipeline.TranslateError as exc:
            return _error(exc.status, exc.code, exc.message)

    return app

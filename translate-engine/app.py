"""Quarc Translate engine.

Speaks the same HTTP contract LibreTranslate did (`GET /languages`,
`POST /translate` returning `translatedText` + `detectedLanguage`), so the Node
backend and the frontend needed no changes when this replaced it — only the
models behind it got better.

Internal service: only the `backend` container talks to it, so there is no auth
here, exactly as with the LibreTranslate container it replaced.
"""

import asyncio
import logging
import os

from fastapi import FastAPI, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

import languages
import models

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("engine")

app = FastAPI(title="Quarc Translate engine")

# Restricting the identifier to languages we can actually translate stops
# confident nonsense like detecting Turkish text as some unsupported language.
try:
    from py3langid.langid import MODEL_FILE, LanguageIdentifier

    _identifier = LanguageIdentifier.from_pickled_model(MODEL_FILE, norm_probs=True)
    _identifier.set_languages([c for c in languages.LANGUAGES])
except Exception:  # pragma: no cover - detection is a nice-to-have, not fatal
    log.exception("language identifier unavailable; auto-detect will fall back to English")
    _identifier = None


class TranslateRequest(BaseModel):
    q: str
    source: str = "auto"
    target: str
    format: str = "text"


class DetectRequest(BaseModel):
    q: str


@app.get("/health")
def health():
    return {"ok": True, "service": "quarc-translate-engine", "loaded": models.loaded_models()}


@app.get("/languages")
def list_languages():
    return languages.language_list()


def detect(text):
    if not _identifier:
        return "en", 0.0
    code, confidence = _identifier.classify(text)
    if not languages.is_supported(code):
        return "en", float(confidence)
    return code, float(confidence)


@app.post("/detect")
def detect_endpoint(payload: DetectRequest):
    code, confidence = detect(payload.q)
    return [{"language": code, "confidence": confidence}]


@app.post("/translate")
async def translate(payload: TranslateRequest):
    text = payload.q or ""
    if not text.strip():
        return {"translatedText": ""}

    source = payload.source
    detected = None
    if source == "auto":
        source, confidence = detect(text)
        detected = {"language": source, "confidence": confidence}

    if not languages.is_supported(source):
        source = "en"
    if not languages.is_supported(payload.target):
        raise HTTPException(status_code=400, detail=f"Unsupported target language: {payload.target}")

    if source == payload.target:
        result = text
    else:
        # Translation is CPU-bound and blocking; keep it off the event loop so
        # concurrent requests queue instead of stalling the whole process.
        result = await run_in_threadpool(models.translate, text, source, payload.target)

    response = {"translatedText": result}
    if detected:
        response["detectedLanguage"] = detected
    return response


async def _warm(pair):
    try:
        source, target = pair.split(":")
        log.info("warming %s -> %s in the background", source, target)
        await run_in_threadpool(models.warm, source, target)
        log.info("warmed %s -> %s", source, target)
    except Exception:
        log.exception("could not warm %s (first request will convert instead)", pair)


@app.on_event("startup")
async def warm_default_pair():
    """Preload one pair so the first translation isn't the one that waits.

    Turkish<->English by default — the pair this app mostly exists for. Set
    WARM_PAIR="" to skip (useful when RAM is tight and you'd rather pay the
    cost on first use).

    Deliberately fire-and-forget: a cold first run downloads and converts a
    model, which takes minutes. Awaiting it here would keep uvicorn from
    accepting connections that whole time, so /health and /languages would
    look down and check.sh would report a dead engine.
    """
    pair = os.environ.get("WARM_PAIR", "tr:en")
    if pair:
        asyncio.create_task(_warm(pair))

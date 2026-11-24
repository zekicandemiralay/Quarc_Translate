"""Every setting the engine reads from the environment, in one place."""

import os


def _int(name, default):
    try:
        return int(os.environ.get(name, "").strip() or default)
    except ValueError:
        return default


def _list(name, default=""):
    raw = os.environ.get(name)
    raw = default if raw is None else raw
    return [part.strip() for part in raw.split(",") if part.strip()]


VERSION = "2.0.0"

# Where downloaded + converted models live (a Docker volume in production).
MODEL_DIR = os.environ.get("MODEL_DIR", "/models")

# CPU threads for one translation, and how many translations may run at once.
THREADS = _int("TRANSLATE_THREADS", 4)
CONCURRENCY = _int("TRANSLATE_CONCURRENCY", 2)

# RAM the loaded models may use together (MB). Least-recently-used models are
# unloaded past it. The general model (NLLB) is ~1.5 GB, a dedicated pair 0.1-0.3 GB.
# MAX_LOADED_MODELS (the old setting) still works as a hard cap on the count.
MODEL_RAM_MB = _int("MODEL_RAM_MB", 2600)
MAX_LOADED_MODELS = _int("MAX_LOADED_MODELS", 0)  # 0 = only the RAM budget decides

# "1.3B" (better, ~1.5 GB RAM, slower) or "600M" (lighter) for every pair that has no dedicated model.
NLLB_SIZE = os.environ.get("NLLB_MODEL", "1.3B").upper().replace("NLLB-200-DISTILLED-", "")

# Translate pairs that have no direct dedicated model through English when both
# halves do ("auto"), or always use the general model ("off").
PIVOT = os.environ.get("PIVOT", "auto").lower()

# Downloaded in the background right after start, so nobody waits later.
# Pairs as "tr:en,en:tr". The first one is also loaded into RAM.
# WARM_PAIR is the old name for a single pair.
_prepare_default = os.environ.get("WARM_PAIR") if os.environ.get("WARM_PAIR") is not None else "tr:en,en:tr,en:de,de:en"
PREPARE_ON_START = _list("PREPARE_ON_START", _prepare_default)

MAX_INPUT_CHARS = _int("MAX_INPUT_CHARS", 6000)

# "Did you mean…" suggestions: Turkish letters typed without Turkish letters, typos, missing accents.
# Turkish uses its own lexicon; the others use word-frequency lists (~15 MB each, loaded on first use).
SUGGEST_ENABLED = os.environ.get("SUGGEST", "on").lower() not in ("off", "0", "false", "no")
SPELL_LANGS = _list("SPELL_LANGS", "tr,en,de,fr,es,it,pt,nl,sv,pl,ca,cs,fi,ru,uk,no")
SPELL_MAX_DICTS = _int("SPELL_MAX_DICTS", 4)  # word lists kept in RAM at once (least recently used go first)
SPELL_TOP_WORDS = _int("SPELL_TOP_WORDS", 150000)  # words kept per language

# Never start a download when less than this (MB) would be left on the volume.
MIN_FREE_DISK_MB = _int("MIN_FREE_DISK_MB", 1500)

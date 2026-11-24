"""The model store: what is on disk, what is in RAM, and what is being fetched.

What the previous engine got wrong, and what replaces it:

  * Concurrent requests for a model that was still loading crashed (a `None`
    placeholder was handed out as if it were the model). Now every model has its
    own load lock: the second caller waits for the first and shares its result.
  * A model could be unloaded while a translation was still using it. Now a model
    in use is never evicted.
  * First use of a language pair held the HTTP request open for minutes until
    it timed out. Now a missing model is queued for download in the background
    and the request answers at once with "model_preparing" + its progress; the
    app shows that and retries.
  * Several downloads/conversions at once could exhaust RAM. Now one runs at a
    time (a priority queue: what a person is waiting for goes first).
  * A crash mid-download left half a model that looked finished. Now models are
    built in a temp folder and only a finished one gets the marker file.
"""

import itertools
import logging
import os
import queue
import shutil
import threading
import time
from collections import OrderedDict
from contextlib import contextmanager
from dataclasses import dataclass, field

import provision as provisioning

log = logging.getLogger("store")

RETRY_FAILED_AFTER_S = 60  # a failed download is not retried more often than this


class ModelNotReady(Exception):
    """The model is being fetched; the caller should tell the user and retry shortly."""

    def __init__(self, spec, stage, pct):
        super().__init__(f"{spec.label or spec.key} is being prepared ({stage})")
        self.spec, self.stage, self.pct = spec, stage, pct


class ModelFailed(Exception):
    """The model could not be fetched or loaded; `message` says why."""

    def __init__(self, spec, message):
        super().__init__(message)
        self.spec, self.message = spec, message


@dataclass
class Entry:
    spec: object
    state: str = "absent"  # absent | queued | downloading | converting | finalizing | ready | failed
    pct: object = None
    error: str = ""
    changed: float = field(default_factory=time.time)

    def set(self, state, pct=None, error=""):
        self.state, self.pct, self.error, self.changed = state, pct, error, time.time()


@dataclass
class Loaded:
    spec: object
    translator: object
    tokenizer: object
    size_mb: int
    in_use: int = 0


def disk_free_mb(path):
    try:
        return shutil.disk_usage(path).free // (1024 * 1024)
    except OSError:
        return 10**9


class ModelStore:
    def __init__(self, root, ram_mb, max_models, loader, provisioner=provisioning.provision, min_free_disk_mb=0):
        self.root = os.path.join(root, "ct2")
        os.makedirs(self.root, exist_ok=True)
        self.ram_mb, self.max_models = ram_mb, max_models
        self.loader, self.provisioner, self.min_free_disk_mb = loader, provisioner, min_free_disk_mb

        self._lock = threading.RLock()
        self._entries = {}  # key -> Entry
        self._loaded = OrderedDict()  # key -> Loaded, least recently used first
        self._load_locks = {}  # key -> Lock
        self._queue = queue.PriorityQueue()
        self._seq = itertools.count()
        self._worker = None

        self._cleanup_leftovers()

    # ── disk ─────────────────────────────────────────────────────────────────

    def dest(self, spec):
        return os.path.join(self.root, spec.key)

    def _cleanup_leftovers(self):
        """A crash during a download leaves `<name>.tmp`; it is garbage, never a model."""
        for name in os.listdir(self.root):
            if name.endswith(".tmp"):
                shutil.rmtree(os.path.join(self.root, name), ignore_errors=True)

    def _entry(self, spec):
        with self._lock:
            entry = self._entries.get(spec.key)
            if entry is None:
                entry = Entry(spec)
                if provisioning.is_ready(self.dest(spec)):
                    entry.state = "ready"
                self._entries[spec.key] = entry
            return entry

    # ── asking for models ───────────────────────────────────────────────────

    def ensure(self, spec, priority=1):
        """Makes sure `spec` is on its way to disk. 0 = a person is waiting, 1 = background."""
        with self._lock:
            entry = self._entry(spec)
            if entry.state == "ready" and not provisioning.is_ready(self.dest(spec)):
                entry.set("absent")  # someone deleted it from the volume
            if entry.state == "absent" or (entry.state == "failed" and time.time() - entry.changed > RETRY_FAILED_AFTER_S):
                free = disk_free_mb(self.root)
                if free < self.min_free_disk_mb + spec.size_mb * 2:
                    entry.set("failed", error=f"Not enough disk space for this language ({free} MB free)")
                    return entry
                entry.set("queued")
                self._queue.put((priority, next(self._seq), spec.key))
                self._start_worker()
            return entry

    def _start_worker(self):
        if self._worker is None or not self._worker.is_alive():
            self._worker = threading.Thread(target=self._work, name="model-provisioner", daemon=True)
            self._worker.start()

    def _work(self):
        while True:
            try:
                _prio, _seq, key = self._queue.get(timeout=5)
            except queue.Empty:
                with self._lock:
                    if self._queue.empty():
                        self._worker = None
                        return
                continue
            with self._lock:
                entry = self._entries[key]
                if entry.state != "queued":
                    continue
            spec = entry.spec

            def report(stage, pct=None, entry=entry):
                with self._lock:
                    entry.state, entry.pct, entry.changed = stage, pct, time.time()

            try:
                log.info("preparing %s (%s)", spec.key, spec.repo)
                started = time.time()
                self.provisioner(spec, self.dest(spec), report)
                with self._lock:
                    entry.set("ready")
                log.info("%s ready in %.0fs", spec.key, time.time() - started)
            except BaseException as exc:  # noqa: BLE001 - one bad download must not kill the worker
                log.exception("could not prepare %s", spec.key)
                with self._lock:
                    entry.set("failed", error=f"{type(exc).__name__}: {exc}"[:300])

    # ── using models ────────────────────────────────────────────────────────

    @contextmanager
    def use(self, spec):
        """Yields a loaded model that will not be unloaded while the block runs."""
        loaded = self._acquire(spec)
        try:
            yield loaded
        finally:
            with self._lock:
                loaded.in_use -= 1
                self._evict_locked()

    def _acquire(self, spec):
        entry = self.ensure(spec, priority=0)
        if entry.state == "failed":
            raise ModelFailed(spec, entry.error)
        if entry.state != "ready":
            raise ModelNotReady(spec, entry.state, entry.pct)

        with self._lock:
            hit = self._loaded.get(spec.key)
            if hit:
                self._loaded.move_to_end(spec.key)
                hit.in_use += 1
                return hit
            gate = self._load_locks.setdefault(spec.key, threading.Lock())

        # One thread loads; everyone else wanting the same model waits here and then finds it loaded.
        with gate:
            with self._lock:
                hit = self._loaded.get(spec.key)
                if hit:
                    self._loaded.move_to_end(spec.key)
                    hit.in_use += 1
                    return hit
            try:
                loaded = self.loader(spec, self.dest(spec))
            except Exception as exc:  # noqa: BLE001
                # Unreadable files: throw them away so the next request fetches a clean copy.
                log.exception("could not load %s; discarding it", spec.key)
                shutil.rmtree(self.dest(spec), ignore_errors=True)
                with self._lock:
                    entry.set("failed", error=f"Could not load the model: {exc}"[:300])
                raise ModelFailed(spec, entry.error) from exc
            with self._lock:
                loaded.in_use += 1
                self._loaded[spec.key] = loaded
                self._loaded.move_to_end(spec.key)
                self._evict_locked(keep=spec.key)
            return loaded

    def _evict_locked(self, keep=None):
        def over():
            total = sum(m.size_mb for m in self._loaded.values())
            return (total > self.ram_mb) or (self.max_models and len(self._loaded) > self.max_models)

        while len(self._loaded) > 1 and over():
            victim = next((k for k, m in self._loaded.items() if m.in_use == 0 and k != keep), None)
            if victim is None:
                return  # everything is busy: allow a temporary overshoot rather than break a translation
            gone = self._loaded.pop(victim)
            log.info("unloading %s (RAM %d/%d MB)", victim, sum(m.size_mb for m in self._loaded.values()), self.ram_mb)
            unload = getattr(gone.translator, "unload_model", None)
            if unload:
                try:
                    unload()
                except Exception:  # noqa: BLE001
                    pass

    # ── looking ─────────────────────────────────────────────────────────────

    def loaded_keys(self):
        with self._lock:
            return list(self._loaded)

    def snapshot(self, specs=()):
        """Everything the status page shows."""
        with self._lock:
            for spec in specs:
                self._entry(spec)
            rows = []
            for key, entry in self._entries.items():
                rows.append(
                    {
                        "key": key,
                        "label": entry.spec.label or key,
                        "repo": entry.spec.repo,
                        "state": "loaded" if key in self._loaded else entry.state,
                        "pct": entry.pct,
                        "error": entry.error or None,
                        "sizeMb": entry.spec.size_mb,
                    }
                )
            return {
                "models": rows,
                "ramUsedMb": sum(m.size_mb for m in self._loaded.values()),
                "ramBudgetMb": self.ram_mb,
                "queued": self._queue.qsize(),
            }

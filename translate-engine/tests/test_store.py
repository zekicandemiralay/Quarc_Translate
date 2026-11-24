"""The model store under the conditions that broke the old engine: concurrent
first use, eviction while busy, half-finished downloads, a failing download."""

import os
import threading
import time

import pytest

import provision
import store as store_mod
from routes import ModelSpec
from store import Loaded, ModelFailed, ModelNotReady, ModelStore


def spec(key, mb=100):
    return ModelSpec(key=key, kind="marian", repo=f"x/{key}", revision="0" * 40, obtain="convert", size_mb=mb, label=key)


class Lab:
    """A store wired to a fake provisioner and a fake loader that record what happens."""

    def __init__(self, tmp_path, ram_mb=1000, max_models=0, provision_delay=0.0, load_delay=0.0):
        self.provisioned, self.loads, self.unloads = [], [], []
        self.fail_provision = set()
        self.fail_load = set()
        self.provision_delay, self.load_delay = provision_delay, load_delay
        self.gate = None
        self.store = ModelStore(str(tmp_path), ram_mb, max_models, loader=self._load, provisioner=self._provision)

    def _provision(self, sp, dest, report):
        report("downloading", 10)
        if self.gate:
            self.gate.wait(5)
        time.sleep(self.provision_delay)
        if sp.key in self.fail_provision:
            raise RuntimeError("network down")
        os.makedirs(dest, exist_ok=True)
        for name in ("model.bin", provision.MARKER):
            open(os.path.join(dest, name), "w").close()
        self.provisioned.append(sp.key)

    def _load(self, sp, dest):
        time.sleep(self.load_delay)
        if sp.key in self.fail_load:
            raise RuntimeError("corrupt model.bin")
        self.loads.append(sp.key)

        class T:
            def unload_model(inner):
                self.unloads.append(sp.key)

        return Loaded(spec=sp, translator=T(), tokenizer=object(), size_mb=sp.size_mb)

    def wait_ready(self, sp, timeout=5):
        end = time.time() + timeout
        while time.time() < end:
            if self.store.ensure(sp).state == "ready":
                return
            time.sleep(0.01)
        raise AssertionError(f"{sp.key} never became ready: {self.store.ensure(sp).state}")


def test_a_missing_model_is_queued_and_the_caller_is_told_instead_of_waiting(tmp_path):
    lab = Lab(tmp_path)
    lab.gate = threading.Event()
    sp = spec("a")
    with pytest.raises(ModelNotReady) as info:
        with lab.store.use(sp):
            pass
    assert info.value.spec is sp
    assert info.value.stage in ("queued", "downloading")
    lab.gate.set()
    lab.wait_ready(sp)
    with lab.store.use(sp) as loaded:
        assert loaded.spec is sp


def test_concurrent_first_use_loads_the_model_exactly_once(tmp_path):
    """The old engine handed a None placeholder to the second request and crashed."""
    lab = Lab(tmp_path, load_delay=0.15)
    sp = spec("a")
    lab.store.ensure(sp)
    lab.wait_ready(sp)
    results, errors = [], []

    def user():
        try:
            with lab.store.use(sp) as loaded:
                results.append(loaded)
                time.sleep(0.02)
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)

    threads = [threading.Thread(target=user) for _ in range(12)]
    [t.start() for t in threads]
    [t.join(10) for t in threads]
    assert not errors
    assert len(results) == 12
    assert len({id(r) for r in results}) == 1
    assert lab.loads == ["a"]


def test_downloads_run_one_at_a_time_and_a_waiting_person_jumps_the_queue(tmp_path):
    lab = Lab(tmp_path)
    lab.gate = threading.Event()
    first, background, person = spec("first"), spec("background"), spec("person")
    lab.store.ensure(first, priority=1)
    time.sleep(0.05)  # the worker is now inside `first`
    lab.store.ensure(background, priority=1)
    lab.store.ensure(person, priority=0)
    lab.gate.set()
    for sp in (first, background, person):
        lab.wait_ready(sp)
    assert lab.provisioned == ["first", "person", "background"]


def test_models_over_the_ram_budget_are_unloaded_least_recently_used_first(tmp_path):
    lab = Lab(tmp_path, ram_mb=250)
    a, b, c = spec("a", 100), spec("b", 100), spec("c", 100)
    for sp in (a, b, c):
        lab.store.ensure(sp)
        lab.wait_ready(sp)
    for sp in (a, b):
        with lab.store.use(sp):
            pass
    with lab.store.use(a):  # a is now the most recent
        pass
    with lab.store.use(c):
        pass
    assert lab.unloads == ["b"]
    assert set(lab.store.loaded_keys()) == {"a", "c"}


def test_a_model_in_use_is_never_unloaded(tmp_path):
    lab = Lab(tmp_path, ram_mb=150)
    a, b = spec("a", 100), spec("b", 100)
    for sp in (a, b):
        lab.store.ensure(sp)
        lab.wait_ready(sp)
    with lab.store.use(a):
        with lab.store.use(b):
            assert lab.unloads == [], "both are busy: allow a temporary overshoot rather than break a translation"
            assert set(lab.store.loaded_keys()) == {"a", "b"}
    # once both are idle the budget is enforced again
    with lab.store.use(b):
        pass
    assert len(lab.store.loaded_keys()) == 1


def test_the_old_max_models_setting_still_caps_the_count(tmp_path):
    lab = Lab(tmp_path, ram_mb=10_000, max_models=1)
    a, b = spec("a"), spec("b")
    for sp in (a, b):
        lab.store.ensure(sp)
        lab.wait_ready(sp)
    with lab.store.use(a):
        pass
    with lab.store.use(b):
        pass
    assert lab.store.loaded_keys() == ["b"]


def test_a_failed_download_is_reported_not_retried_in_a_loop(tmp_path, monkeypatch):
    lab = Lab(tmp_path)
    lab.fail_provision.add("a")
    sp = spec("a")
    lab.store.ensure(sp)
    end = time.time() + 5
    while time.time() < end and lab.store.ensure(sp).state != "failed":
        time.sleep(0.01)
    with pytest.raises(ModelFailed) as info:
        with lab.store.use(sp):
            pass
    assert "network down" in info.value.message
    # asking again straight away does not hammer the network...
    before = len(lab.provisioned)
    lab.store.ensure(sp)
    time.sleep(0.1)
    assert lab.store.ensure(sp).state == "failed"
    assert len(lab.provisioned) == before
    # ...but after the cool-down it tries again, and recovers.
    lab.fail_provision.clear()
    monkeypatch.setattr(store_mod, "RETRY_FAILED_AFTER_S", 0)
    lab.wait_ready(sp)


def test_a_corrupt_model_is_thrown_away_and_fetched_again(tmp_path, monkeypatch):
    lab = Lab(tmp_path)
    sp = spec("a")
    lab.store.ensure(sp)
    lab.wait_ready(sp)
    lab.fail_load.add("a")
    with pytest.raises(ModelFailed):
        with lab.store.use(sp):
            pass
    assert not os.path.exists(lab.store.dest(sp)), "the unreadable files are deleted"
    lab.fail_load.clear()
    monkeypatch.setattr(store_mod, "RETRY_FAILED_AFTER_S", 0)
    lab.wait_ready(sp)
    with lab.store.use(sp):
        pass
    assert lab.provisioned.count("a") == 2


def test_leftovers_of_a_crashed_download_are_cleaned_and_never_trusted(tmp_path):
    root = tmp_path / "ct2"
    (root / "half.tmp").mkdir(parents=True)
    (root / "half.tmp" / "model.bin").write_text("partial")
    (root / "nomarker").mkdir()
    (root / "nomarker" / "model.bin").write_text("no marker file: not finished")
    lab = Lab(tmp_path)
    assert not (root / "half.tmp").exists()
    assert not provision.is_ready(str(root / "nomarker")), "no marker file = not finished"
    sp = spec("nomarker")
    assert lab.store.ensure(sp).state != "ready", "an unmarked folder must not be trusted"
    lab.wait_ready(sp)
    assert lab.provisioned == ["nomarker"], "it was downloaded again"


def test_a_model_already_on_disk_is_ready_without_downloading(tmp_path):
    dest = tmp_path / "ct2" / "a"
    dest.mkdir(parents=True)
    (dest / "model.bin").write_text("x")
    (dest / provision.MARKER).write_text("{}")
    lab = Lab(tmp_path)
    assert lab.store.ensure(spec("a")).state == "ready"
    with lab.store.use(spec("a")):
        pass
    assert lab.provisioned == []


def test_a_model_deleted_from_the_volume_is_fetched_again(tmp_path):
    lab = Lab(tmp_path)
    sp = spec("a")
    lab.store.ensure(sp)
    lab.wait_ready(sp)
    import shutil

    shutil.rmtree(lab.store.dest(sp))
    assert lab.store.ensure(sp).state in ("queued", "downloading", "ready")
    lab.wait_ready(sp)
    assert lab.provisioned.count("a") == 2


def test_no_disk_space_is_a_clear_error_before_anything_is_downloaded(tmp_path, monkeypatch):
    lab = Lab(tmp_path)
    monkeypatch.setattr(store_mod, "disk_free_mb", lambda _p: 50)
    entry = lab.store.ensure(spec("big", 500))
    assert entry.state == "failed"
    assert "disk space" in entry.error
    assert lab.provisioned == []


def test_snapshot_describes_everything_for_the_status_page(tmp_path):
    lab = Lab(tmp_path, ram_mb=900)
    sp = spec("a")
    lab.store.ensure(sp)
    lab.wait_ready(sp)
    with lab.store.use(sp):
        pass
    snap = lab.store.snapshot()
    assert snap["ramBudgetMb"] == 900
    assert snap["ramUsedMb"] == 100
    assert snap["models"][0]["state"] == "loaded"
    assert snap["models"][0]["key"] == "a"

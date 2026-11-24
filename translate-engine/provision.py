"""Getting a model onto disk, ready to load.

Two ways, both producing the same layout (`<dest>/model.bin` + the
CTranslate2 files + `<dest>/tokenizer/` + a `quarc.json` marker written LAST):

  prebuilt  the CTranslate2 int8 files are downloaded as they are (NLLB). No
            conversion, so no PyTorch and no multi-gigabyte RAM spike — the
            old engine converted `facebook/nllb-…` itself, which needs 2.5-5.5 GB
            of download and several GB of RAM on a box that also runs 8 other apps.
  convert   the original Marian model is downloaded and converted to int8
            (~1.2 GB peak, ~25 s). PyTorch is only imported here.

Everything is built in `<dest>.tmp` and renamed into place at the very end, so
a crash or a restart can never leave something that looks finished.
"""

import json
import os
import shutil
import threading
import time

MARKER = "quarc.json"

_TOKENIZER_FILES = ["*.json", "*.spm", "*.model", "vocab*", "*.txt"]
_NLLB_TOKENIZER_FILES = ["sentencepiece.bpe.model", "tokenizer.json", "tokenizer_config.json", "special_tokens_map.json"]


def is_ready(dest):
    return os.path.isfile(os.path.join(dest, MARKER)) and os.path.isfile(os.path.join(dest, "model.bin"))


def dir_size(path):
    total = 0
    for root, _dirs, files in os.walk(path):
        for name in files:
            try:
                total += os.path.getsize(os.path.join(root, name))
            except OSError:
                pass
    return total


class _Watch:
    """Reports download progress by watching the folder grow."""

    def __init__(self, path, expected, report):
        self.path, self.expected, self.report = path, expected, report
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)

    def _run(self):
        while not self._stop.wait(1.0):
            if self.expected:
                pct = min(99, int(dir_size(self.path) * 100 / self.expected))
                self.report("downloading", pct)

    def __enter__(self):
        self._thread.start()
        return self

    def __exit__(self, *_exc):
        self._stop.set()


def _expected_bytes(api, repo, revision, keep):
    """Best effort: how many bytes will be downloaded (None if the Hub won't say)."""
    try:
        info = api.model_info(repo, revision=revision, files_metadata=True)
        return sum((s.size or 0) for s in info.siblings if keep(s.rfilename)) or None
    except Exception:  # noqa: BLE001
        return None


def provision(spec, dest, report):
    """Download/convert `spec` into `dest`. `report(stage, pct)` is called as it goes."""
    from huggingface_hub import HfApi, snapshot_download  # imported late: not needed once everything is on disk

    api = HfApi()
    tmp = dest + ".tmp"
    shutil.rmtree(tmp, ignore_errors=True)
    os.makedirs(tmp)
    started = time.time()
    try:
        if spec.obtain == "prebuilt":
            report("downloading", 0)
            expected = _expected_bytes(api, spec.repo, spec.revision, lambda name: True)
            with _Watch(tmp, expected, report):
                snapshot_download(spec.repo, revision=spec.revision, local_dir=tmp)
                snapshot_download(
                    spec.tokenizer_repo,
                    revision=spec.tokenizer_revision,
                    local_dir=os.path.join(tmp, "tokenizer"),
                    allow_patterns=_NLLB_TOKENIZER_FILES,
                )
        else:
            _convert(api, snapshot_download, spec, tmp, report)

        # Prove the files are usable *now*, not at the first user request.
        report("finalizing", None)
        if not os.path.isfile(os.path.join(tmp, "model.bin")):
            raise RuntimeError(f"{spec.key}: model.bin missing after download")
        if not os.path.isdir(os.path.join(tmp, "tokenizer")):
            raise RuntimeError(f"{spec.key}: tokenizer missing after download")

        with open(os.path.join(tmp, MARKER), "w", encoding="utf-8") as fh:
            json.dump(
                {
                    "key": spec.key,
                    "repo": spec.repo,
                    "revision": spec.revision,
                    "obtain": spec.obtain,
                    "seconds": round(time.time() - started, 1),
                    "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                },
                fh,
            )
        shutil.rmtree(dest, ignore_errors=True)
        os.rename(tmp, dest)  # atomic on the same volume: a half-finished model is never visible
    except BaseException:
        shutil.rmtree(tmp, ignore_errors=True)
        raise


def _convert(api, snapshot_download, spec, tmp, report):
    source = os.path.join(tmp, "source")
    files = set(api.list_repo_files(spec.repo, revision=spec.revision))
    weights = "model.safetensors" if "model.safetensors" in files else "pytorch_model.bin"

    report("downloading", 0)
    keep = lambda name: name == weights or any(_match(name, pat) for pat in _TOKENIZER_FILES)  # noqa: E731
    expected = _expected_bytes(api, spec.repo, spec.revision, keep)
    with _Watch(source, expected, report):
        snapshot_download(spec.repo, revision=spec.revision, local_dir=source, allow_patterns=[weights, *_TOKENIZER_FILES])

    report("converting", None)
    from ctranslate2.converters import TransformersConverter  # pulls in PyTorch: only needed here
    from transformers import AutoTokenizer

    out = os.path.join(tmp, "converted")
    TransformersConverter(source).convert(out, quantization="int8", force=True)
    AutoTokenizer.from_pretrained(source).save_pretrained(os.path.join(out, "tokenizer"))

    # Promote the converted files to the top level of tmp and drop the (large) original.
    shutil.rmtree(source, ignore_errors=True)
    for name in os.listdir(out):
        shutil.move(os.path.join(out, name), os.path.join(tmp, name))
    os.rmdir(out)


def _match(name, pattern):
    from fnmatch import fnmatch

    return fnmatch(name, pattern)

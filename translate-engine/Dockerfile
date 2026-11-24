FROM python:3.11-slim

WORKDIR /app

# CPU-only torch. The default index pulls the CUDA build (~2GB of driver
# libraries this machine has no GPU for), so pin the CPU wheel index.
COPY requirements.txt ./
RUN pip install --no-cache-dir \
      --extra-index-url https://download.pytorch.org/whl/cpu \
      -r requirements.txt

# CTranslate2's published wheel ships a library that requests an executable
# stack. Kernels that refuse it fail the import outright:
#   ImportError: libctranslate2-<hash>.so.4.5.0: cannot enable executable
#   stack as shared object requires: Invalid argument
# ...which crash-loops the container. Clear the flag, then prove the library
# actually loads — `docker build` runs on the same kernel as the container, so
# this turns a production crash-loop into an honest build failure.
COPY fix_execstack.py ./
RUN find /usr/local/lib/python3.11/site-packages -path '*ctranslate2*' -name '*.so*' \
      -exec python fix_execstack.py {} + \
    && python -c "import ctranslate2; print('ctranslate2', ctranslate2.__version__, 'loaded OK')"

# Everything the engine runs (config, languages, routes + pinned model revisions,
# text processing, detection, model store, provisioning, pipeline, service).
COPY *.py ./

# Fail the build, not the container, if the engine itself cannot start — or if the data the
# "did you mean" suggestions need (Turkish lexicon, word lists) is missing from the image.
RUN python -c "import service, routes, detect; print('engine imports OK;', len(routes.DEDICATED), 'dedicated pairs')" \
    && python -c "import turkish, spelling; assert turkish.ensure_loaded(), 'Turkish data missing'; assert spelling.LEXICONS.get('en'), 'English word list missing'; print('suggestion data OK')"

# Models are downloaded (and converted) on first use into this volume, not baked
# into the image — keeps the image small and lets you change which languages
# you actually use without a rebuild.
ENV MODEL_DIR=/models \
    HF_HOME=/models/hf \
    HF_HUB_DISABLE_TELEMETRY=1 \
    TOKENIZERS_PARALLELISM=false \
    PYTHONUNBUFFERED=1
VOLUME ["/models"]

EXPOSE 5000
# One process: the model store (what is loaded, what is downloading) lives in memory.
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "5000", "--workers", "1", "--timeout-keep-alive", "30"]

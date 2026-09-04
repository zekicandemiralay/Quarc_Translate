FROM python:3.11-slim

WORKDIR /app

# CPU-only torch. The default index pulls the CUDA build (~2GB of driver
# libraries this machine has no GPU for), so pin the CPU wheel index.
COPY requirements.txt ./
RUN pip install --no-cache-dir \
      --extra-index-url https://download.pytorch.org/whl/cpu \
      -r requirements.txt

COPY *.py ./

# Models are downloaded and converted on first use into this volume, not baked
# into the image — keeps the image small and lets you change which languages
# you actually use without a rebuild.
ENV MODEL_DIR=/models
VOLUME ["/models"]

EXPOSE 5000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "5000"]

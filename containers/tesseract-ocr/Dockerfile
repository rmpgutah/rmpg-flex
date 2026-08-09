# ============================================================
# RMPG Flex — Custom Tesseract OCR sidecar
# ============================================================
# Self-hosted, fine-tuned Tesseract OCR — data-sovereignty motivated
# (see docs/superpowers/specs/2026-08-08-custom-tesseract-ocr-design.md).
# Runs as a Cloudflare Container behind the rmpg-flex-api Worker.
#
#   GET  /health   — tool + model readiness probe
#   POST /ocr      — multipart image upload → extracted text
#
# The fine-tuned .traineddata file at containers/tesseract-ocr/model/
# is fetched from R2 by a deploy-time step (.github/workflows/deploy.yml,
# "Fetch Tesseract model" step) BEFORE this Dockerfile's build runs — it
# is never committed to git. If no custom model has been trained yet,
# that step copies the stock English model instead, so this container
# always builds even before fine-tuning has happened.
#
# Target arch must be linux/amd64 (Cloudflare Containers requirement).
# ============================================================

FROM python:3.12-slim-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
        tesseract-ocr \
        tesseract-ocr-eng \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py .

# Custom fine-tuned model (or the stock-English fallback copy — see
# header comment). Placed under the standard tessdata directory Tesseract
# searches by default, under the language code "rmpg" so callers select
# it explicitly via `-l rmpg` rather than silently changing the default
# "eng" behavior other tools on this box might rely on.
COPY model/rmpg.traineddata /usr/share/tesseract-ocr/5/tessdata/rmpg.traineddata

RUN useradd --system --no-create-home --shell /usr/sbin/nologin tesseractocr \
    && chown -R tesseractocr:tesseractocr /app
USER tesseractocr

EXPOSE 8080

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]

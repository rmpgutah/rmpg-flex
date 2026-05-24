# ============================================================
# RMPG Flex — PDF Tools sidecar (qpdf + pdftotext + ocrmypdf)
# ============================================================
# Runs as a Cloudflare Container behind the rmpg-flex-api Worker.
# Provides the three operations that can't run inside the Worker
# runtime because they shell out to native binaries:
#   - POST /encrypt        → qpdf (PDF encryption with permission flags)
#   - POST /extract-text   → pdftotext + optional ocrmypdf fallback
#   - GET  /health         → tool version probe
#
# Target arch must be linux/amd64 (Cloudflare Containers requirement).
# Built and pushed by `wrangler deploy` when the [[containers]] block
# references this Dockerfile path.
# ============================================================

FROM python:3.12-slim-bookworm

# Native tools:
#   qpdf            — PDF encryption / permission flags (see CLAUDE.md gotcha #34)
#   poppler-utils   — provides /usr/bin/pdftotext
#   tesseract-ocr   — OCR engine ocrmypdf invokes
#   ghostscript     — required by ocrmypdf for PDF/A normalization
#   pngquant        — image optimization for ocrmypdf
#   unpaper         — page cleanup (deskew etc); ocrmypdf optional dep
# Cleanup apt lists in the same RUN layer so we don't bloat the image.
RUN apt-get update && apt-get install -y --no-install-recommends \
        qpdf \
        poppler-utils \
        tesseract-ocr \
        tesseract-ocr-eng \
        ghostscript \
        pngquant \
        unpaper \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python deps in a separate layer so subsequent server.py edits don't
# invalidate the slow pip install layer.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py .

# Drop root for runtime. The container only needs write access to /tmp
# (which is world-writable by default) for the temporary PDFs the
# endpoints stream through. No persistent state lives in the container.
RUN useradd --system --no-create-home --shell /usr/sbin/nologin pdftools \
    && chown -R pdftools:pdftools /app
USER pdftools

# Port the Worker container binding forwards traffic to. Must match
# `defaultPort` in server/src/containers/pdfToolsContainer.ts.
EXPOSE 8080

# Single uvicorn worker is fine — Cloudflare scales by adding more
# container instances via the max_instances config, not by adding
# workers inside one container. Multiple workers inside would compete
# for the limited CPU slice (basic = 1/4 vCPU).
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]

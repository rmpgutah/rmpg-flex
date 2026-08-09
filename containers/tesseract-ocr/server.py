"""
RMPG Flex — Custom Tesseract OCR sidecar (FastAPI)

Two endpoints, both stateless:
  GET  /health   — tesseract version + custom-model presence probe
  POST /ocr      — multipart image upload, returns extracted text

The Worker (src/routes/tesseractOcr.ts) proxies requests here via the
Cloudflare Container binding. Auth is handled at the Worker layer — by
the time a request reaches this server, it's already JWT-authenticated
and role-gated.

Container-side runs unauthenticated by design: the only network path TO
it is through the Worker fetch handler.
"""

import logging
import shutil
import subprocess
import tempfile
from contextlib import contextmanager
from typing import Iterator

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse

app = FastAPI(title="rmpg-tesseract-ocr", version="1.0.0")
logger = logging.getLogger(__name__)

MAX_UPLOAD_BYTES = 16 * 1024 * 1024  # 16 MB — matches the vision-tier cap elsewhere in this pipeline.
TESSDATA_DIR = "/usr/share/tesseract-ocr/5/tessdata"
CUSTOM_LANG = "rmpg"


@contextmanager
def temp_workdir() -> Iterator[str]:
    workdir = tempfile.mkdtemp(prefix="tesseractocr-")
    try:
        yield workdir
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


async def save_upload(file: UploadFile, dest_path: str) -> int:
    total = 0
    with open(dest_path, "wb") as out:
        while chunk := await file.read(1024 * 1024):
            total += len(chunk)
            if total > MAX_UPLOAD_BYTES:
                raise HTTPException(status_code=413, detail="image too large (max 16MB)")
            out.write(chunk)
    return total


@app.get("/health")
def health():
    try:
        version = subprocess.run(
            ["tesseract", "--version"], capture_output=True, text=True, timeout=5
        ).stdout.splitlines()[0]
    except Exception as e:
        return JSONResponse(status_code=503, content={"status": "unavailable", "detail": str(e)})

    import os
    custom_model_present = os.path.exists(f"{TESSDATA_DIR}/{CUSTOM_LANG}.traineddata")
    return {"status": "ok", "tesseract_version": version, "custom_model_present": custom_model_present}


@app.post("/ocr")
async def ocr(image: UploadFile = File(...)):
    with temp_workdir() as workdir:
        input_path = f"{workdir}/input"
        output_base = f"{workdir}/output"
        await save_upload(image, input_path)

        try:
            subprocess.run(
                ["tesseract", input_path, output_base, "-l", CUSTOM_LANG],
                capture_output=True, text=True, timeout=30, check=True,
            )
        except subprocess.CalledProcessError as e:
            logger.error("tesseract failed: %s", e.stderr)
            raise HTTPException(status_code=500, detail="OCR processing failed") from e
        except subprocess.TimeoutExpired as e:
            raise HTTPException(status_code=504, detail="OCR processing timed out") from e

        with open(f"{output_base}.txt", "r", encoding="utf-8") as f:
            text = f.read()

    return {"text": text}

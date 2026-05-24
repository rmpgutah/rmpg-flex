"""
RMPG Flex — PDF Tools sidecar (FastAPI)

Three endpoints, all stateless:
  GET  /health           — tool versions + readiness probe
  POST /encrypt          — qpdf-driven PDF encryption with permission flags
  POST /extract-text     — pdftotext, optionally falls back to ocrmypdf OCR

The Worker (server/src/routes/pdfTools-worker.ts and documentIntake-worker.ts)
proxies multipart requests here via the Cloudflare Container binding. Auth is
handled at the Worker layer — by the time a request reaches this server, it's
already JWT-authenticated and role-gated.

Container-side runs unauthenticated by design: the only network path TO it is
through the Worker fetch handler.
"""

import base64
import os
import secrets
import shutil
import subprocess
import tempfile
from contextlib import contextmanager
from typing import Iterator, Optional

import ocrmypdf
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse

app = FastAPI(title="rmpg-pdf-tools", version="1.0.0")

# Size cap matches the existing client-side PDF editor limit. Cloudflare
# Container disk on the `basic` instance is 4 GB, but holding a 50 MB PDF in
# /tmp during encryption is the upper bound we care about for memory pressure.
MAX_UPLOAD_BYTES = 50 * 1024 * 1024  # 50 MB


@contextmanager
def temp_workdir() -> Iterator[str]:
    """Spool the request through a unique /tmp dir we clean up unconditionally.

    Using a per-request directory means concurrent requests can't collide on
    the same input/output filenames, and a single shutil.rmtree at exit cleans
    every intermediate file qpdf/ocrmypdf may have created (sidecar files,
    failed-conversion stubs, etc).
    """
    workdir = tempfile.mkdtemp(prefix="pdftools-")
    try:
        yield workdir
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


async def save_upload(file: UploadFile, dest_path: str) -> int:
    """Stream uploaded bytes to disk, enforcing MAX_UPLOAD_BYTES.

    Returns the total byte count. Raises HTTPException(413) on overflow.
    """
    total = 0
    with open(dest_path, "wb") as f:
        while chunk := await file.read(1024 * 1024):  # 1 MiB chunks
            total += len(chunk)
            if total > MAX_UPLOAD_BYTES:
                raise HTTPException(
                    status_code=413,
                    detail=f"File too large — max {MAX_UPLOAD_BYTES // 1024 // 1024} MB",
                )
            f.write(chunk)
    return total


# ─────────────────────────────────────────────────────────────────
# GET /health
# ─────────────────────────────────────────────────────────────────
@app.get("/health")
async def health() -> dict:
    """Report tool readiness + versions.

    Worker /api/pdf-tools/health and /api/document-intake/health proxy to
    this. Caller uses the version strings to surface 'OCR available' /
    'encryption available' chips in the admin UI.
    """
    def _version(cmd: list[str]) -> Optional[str]:
        try:
            return subprocess.check_output(cmd, stderr=subprocess.STDOUT, timeout=5).decode().strip().split("\n")[0]
        except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired):
            return None

    return {
        "status": "ok",
        "tools": {
            "qpdf": _version(["qpdf", "--version"]),
            "pdftotext": _version(["pdftotext", "-v"]),
            "tesseract": _version(["tesseract", "--version"]),
            "ocrmypdf": ocrmypdf.__version__,
        },
        "limits": {"max_upload_mb": MAX_UPLOAD_BYTES // 1024 // 1024},
    }


# ─────────────────────────────────────────────────────────────────
# POST /encrypt
# ─────────────────────────────────────────────────────────────────
# qpdf flag reference: https://qpdf.readthedocs.io/en/stable/cli.html#option-encrypt
#
# Permission flag meanings (when restrict_flags are NOT in the allow set):
#   print=full|low|none
#   modify=all|annotate|form|assembly|none
#   extract=y|n           — copy text / images out
#   accessibility=y|n     — screen-reader access
#   useAes=y              — always AES-256 (default for new PDFs)
@app.post("/encrypt")
async def encrypt(
    pdf: UploadFile = File(...),
    user_password: str = Form(""),
    owner_password: Optional[str] = Form(None),
    print_perm: str = Form("full"),
    modify_perm: str = Form("all"),
    extract: bool = Form(True),
    accessibility: bool = Form(True),
    fill_forms: bool = Form(True),
    key_length: int = Form(256),  # 256 (AES-256) or 128 (AES-128)
) -> JSONResponse:
    """Encrypt a PDF with the requested passwords + permission flags.

    Returns JSON containing the base64-encoded encrypted PDF plus the
    generated owner password (if the caller didn't supply one). Worker
    decodes and streams the bytes back to the browser.

    A JSON envelope (rather than raw bytes) lets us return the
    auto-generated owner password alongside the file in one round-trip,
    matching the legacy /api/pdf-tools/encrypt contract on the VPS.
    """
    if key_length not in (128, 256):
        raise HTTPException(400, "key_length must be 128 or 256")
    if print_perm not in ("full", "low", "none"):
        raise HTTPException(400, "print_perm must be full|low|none")
    if modify_perm not in ("all", "annotate", "form", "assembly", "none"):
        raise HTTPException(400, "modify_perm must be all|annotate|form|assembly|none")

    # Auto-generate a strong owner password if caller didn't supply one.
    # Matches the legacy server behavior — surfaces in the response so the
    # admin UI can show it as a one-time recovery secret.
    generated_owner = False
    if not owner_password:
        owner_password = base64.urlsafe_b64encode(secrets.token_bytes(24)).decode().rstrip("=")
        generated_owner = True

    with temp_workdir() as workdir:
        in_path = os.path.join(workdir, "in.pdf")
        out_path = os.path.join(workdir, "out.pdf")
        await save_upload(pdf, in_path)

        cmd = [
            "qpdf", "--encrypt",
            user_password, owner_password, str(key_length),
            "--print=" + print_perm,
            "--modify=" + modify_perm,
            "--extract=" + ("y" if extract else "n"),
            "--accessibility=" + ("y" if accessibility else "n"),
            "--form=" + ("y" if fill_forms else "n"),
            "--use-aes=y",
            "--", in_path, out_path,
        ]

        try:
            subprocess.run(cmd, check=True, capture_output=True, timeout=60)
        except subprocess.CalledProcessError as e:
            # qpdf exit code 3 = warnings, output may still be valid.
            # Anything else = real failure.
            if e.returncode != 3 or not os.path.exists(out_path):
                raise HTTPException(
                    500,
                    f"qpdf failed (exit {e.returncode}): {e.stderr.decode(errors='replace')[:500]}",
                )
        except subprocess.TimeoutExpired:
            raise HTTPException(504, "qpdf timed out after 60s")

        with open(out_path, "rb") as f:
            encrypted_bytes = f.read()

    return JSONResponse({
        "ok": True,
        "pdf_base64": base64.b64encode(encrypted_bytes).decode(),
        "owner_password": owner_password if generated_owner else None,
        "size_bytes": len(encrypted_bytes),
    })


# ─────────────────────────────────────────────────────────────────
# POST /extract-text
# ─────────────────────────────────────────────────────────────────
# Strategy (matches CLAUDE.md gotcha #47 — "OCR is a fallback, not a
# replacement"):
#   1. Run pdftotext first.
#   2. If the result is empty/sparse AND force_ocr is not explicitly off,
#      run ocrmypdf to add an invisible text layer, then pdftotext again.
#   3. Adopt the OCR output only if it produces MORE text than the original
#      pdftotext result — corrupt OCR can never make extraction worse.
SPARSE_TEXT_THRESHOLD = 50  # chars; below this we assume the PDF is image-only


def _run_pdftotext(in_pdf: str, out_txt: str, timeout: int = 30) -> str:
    """Shell out to pdftotext; return the extracted text (may be empty)."""
    try:
        subprocess.run(
            ["pdftotext", "-layout", in_pdf, out_txt],
            check=True, capture_output=True, timeout=timeout,
        )
    except subprocess.CalledProcessError as e:
        raise HTTPException(500, f"pdftotext failed: {e.stderr.decode(errors='replace')[:500]}")
    except subprocess.TimeoutExpired:
        raise HTTPException(504, "pdftotext timed out")
    with open(out_txt, encoding="utf-8", errors="replace") as f:
        return f.read()


@app.post("/extract-text")
async def extract_text(
    pdf: UploadFile = File(...),
    force_ocr: Optional[bool] = Form(None),
    ocr_timeout_seconds: int = Form(120),
) -> dict:
    """Extract text from a PDF, falling back to OCR on image-only documents.

    force_ocr semantics:
      None (default) — auto-detect: OCR only if pdftotext output is sparse
      True           — always run OCR (caller knows it's a scan)
      False          — never run OCR (caller wants only born-digital text)

    Returns: { text, char_count, page_count, ocr_used, ocr_skipped_reason? }
    """
    with temp_workdir() as workdir:
        in_path = os.path.join(workdir, "in.pdf")
        txt_path = os.path.join(workdir, "out.txt")
        await save_upload(pdf, in_path)

        # Pass 1: pdftotext on the original
        text = _run_pdftotext(in_path, txt_path)
        char_count = len(text.strip())

        # Decide whether to OCR
        ocr_used = False
        ocr_skipped_reason: Optional[str] = None
        should_ocr = False
        if force_ocr is True:
            should_ocr = True
        elif force_ocr is False:
            ocr_skipped_reason = "force_ocr=false"
        elif char_count < SPARSE_TEXT_THRESHOLD:
            should_ocr = True
        else:
            ocr_skipped_reason = f"sufficient text already ({char_count} chars)"

        if should_ocr:
            ocr_path = os.path.join(workdir, "ocr.pdf")
            ocr_txt_path = os.path.join(workdir, "ocr.txt")
            try:
                ocrmypdf.ocr(
                    in_path, ocr_path,
                    skip_text=True,        # don't re-OCR pages that already have text
                    rotate_pages=True,
                    deskew=True,
                    progress_bar=False,
                    use_threads=True,
                    optimize=0,            # don't waste CPU optimizing — we discard the OCR PDF
                )
                ocr_text = _run_pdftotext(ocr_path, ocr_txt_path)
                ocr_char_count = len(ocr_text.strip())
                # Only adopt OCR if it produced MORE text than the original
                if ocr_char_count > char_count:
                    text = ocr_text
                    char_count = ocr_char_count
                    ocr_used = True
                else:
                    ocr_skipped_reason = "OCR didn't improve extraction"
            except (ocrmypdf.exceptions.MissingDependencyError, ocrmypdf.exceptions.PriorOcrFoundError) as e:
                ocr_skipped_reason = f"ocrmypdf: {type(e).__name__}: {e}"
            except Exception as e:  # noqa: BLE001 — surface as JSON, don't 500
                ocr_skipped_reason = f"ocrmypdf failed: {type(e).__name__}: {str(e)[:200]}"

        # Page count via pdftotext side-channel: count form-feed characters
        # in the layout-mode output. Faster than re-shelling pdfinfo.
        page_count = text.count("\f") if text else 0

        return {
            "text": text,
            "char_count": char_count,
            "page_count": page_count,
            "ocr_used": ocr_used,
            "ocr_skipped_reason": ocr_skipped_reason,
        }

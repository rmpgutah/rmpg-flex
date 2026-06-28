# PDF Tools — Cloudflare Container sidecar

FastAPI server bundled with `qpdf`, `pdftotext` (poppler-utils), and
`ocrmypdf` (Tesseract). Runs as a Cloudflare Container behind the
`rmpg-flex-api` Worker. The Worker proxies authenticated multipart
requests here for operations that need native binaries.

## Endpoints

| Method | Path             | Body                          | Returns |
|--------|------------------|-------------------------------|---------|
| GET    | `/health`        | —                             | `{status, tools, limits}` |
| POST   | `/encrypt`       | multipart: `pdf` + form flags | JSON envelope with base64'd encrypted PDF + owner password |
| POST   | `/extract-text`  | multipart: `pdf` + form opts  | `{text, char_count, page_count, ocr_used, ocr_skipped_reason?}` |

Authentication is handled at the Worker layer (`server/src/routes/pdfTools-worker.ts`,
`server/src/routes/documentIntake-worker.ts`). The container itself has
no auth — the only reachable network path is through the Worker fetch
handler via the `PDF_TOOLS` Durable Object binding.

## Local dev

Build:

```bash
docker build -t rmpg-pdf-tools containers/pdf-tools/
```

Run:

```bash
docker run --rm -p 8080:8080 rmpg-pdf-tools
```

Test:

```bash
curl http://localhost:8080/health | jq

# Encrypt
curl -X POST http://localhost:8080/encrypt \
  -F "pdf=@some.pdf" \
  -F "user_password=" \
  -F "print_perm=low" \
  -F "modify_perm=none" \
  | jq '.owner_password, .size_bytes'

# Extract text (auto-OCR on image-only PDFs)
curl -X POST http://localhost:8080/extract-text \
  -F "pdf=@scan.pdf" \
  | jq '.char_count, .ocr_used'
```

## Deploy

The container is built and pushed by `wrangler deploy` running in CI
(`.github/workflows/deploy.yml`). The `[[containers]]` block in
`server/wrangler.toml` references this directory's Dockerfile.

**Docker is required at deploy time.** GitHub Actions runners have
Docker. Local `wrangler deploy --dry-run` needs Docker Desktop
running, or pass `--containers-rollout=none` to skip the container
build (Worker code still validates).

## Instance type

Currently `basic` (1/4 vCPU, 1 GiB RAM, 4 GB disk). Tuning options:

- **OCR is slow / queueing**: bump to `standard-1` (1/2 vCPU, 4 GiB,
  8 GB disk) in `server/wrangler.toml` `[[containers]]`.
- **Spend is too high**: lower `max_instances` from 3 to 1 if concurrency
  is not a real workload.
- **Cold starts hurt UX**: raise `sleepAfter` in
  `server/src/containers/pdfToolsContainer.ts` from `5m` to `30m` —
  trades idle memory cost for warm-start latency.

Pricing: CPU is billed only on *active* usage (Cloudflare Nov 2025
change), so an idle container costs only memory + disk.

## Why one container for both qpdf and OCR

They share the same native dependency stack (Linux, poppler, ghostscript)
and the same workload shape (stateless PDF transforms). Splitting them
would double the cold-start surface, double the image build cost, and
not improve isolation in any way that matters — both are read-only
on the input PDF, no shared state.

If `iped` (Java forensic suite, ~3 GB image) gets added later, that
WILL be its own container — different image, different scaling profile,
different security surface.

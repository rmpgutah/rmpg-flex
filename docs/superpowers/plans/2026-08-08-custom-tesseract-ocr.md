# Custom Fine-Tuned Tesseract OCR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the infrastructure for a self-hosted, fine-tuned Tesseract OCR engine (data-sovereignty motivated — zero vendor inference calls) as a fifth measurable A/B candidate, without touching production OCR routing.

**Architecture:** A new Cloudflare Container (`TesseractOcrContainer`), following the exact existing `PdfToolsContainer` pattern (Dockerfile + Durable Object + Worker proxy route). The fine-tuned `.traineddata` model file lives in a new restricted R2 bucket (never in git, since it's derived from real client document training data) and is fetched into the container's build context by a new deploy step before `wrangler deploy` builds the Docker image. The new candidate is wired into the existing vision A/B script as a fifth row — no new test framework, no production wiring.

**Tech Stack:** Cloudflare Containers (`@cloudflare/containers`, already a dependency), Python/FastAPI (matching `containers/pdf-tools/`), Tesseract CLI, Cloudflare R2, TypeScript/Hono for the Worker route.

## Global Constraints

- No change to `callAi()`'s `DEFAULT_CHAIN` or any production provider selection (per spec §3, Non-goals) — this plan ships infrastructure and a measurable candidate only.
- The `.traineddata` model file and the labeled training corpus MUST NEVER be committed to git (per spec §2.2) — both live in a new restricted R2 bucket only.
- New container follows the `PdfToolsContainer` pattern exactly: same `Container` base class shape, same `getContainer()` + `container.fetch()` Worker-side call pattern, same try/catch-degrades-gracefully contract, same `sleepAfter`/`pingEndpoint` health-probe convention.
- Next free Durable Object migration tag is `v8-tesseractocr` (confirmed against current `wrangler.toml`: tags in use are `v1, v1-pdftools, v2-voicehub, v3-alerthub, v4-deepresearch, v5-flexcamremux, v6-personinteldo, v7-webbrowsersession`) — migrations must be APPENDED, never inserted mid-list (per `wrangler.toml`'s own comment on this constraint).
- No new admin UI for corpus management — a one-off script handles upload (per spec §2.2, avoiding over-engineering for infrequent use).
- No automated/CI-triggered training — fine-tuning stays a deliberate, operator-run, local process (per spec §3).

---

### Task 1: New restricted R2 bucket + training-pair upload script

**Files:**
- Modify: `wrangler.toml` (add new `[[r2_buckets]]` block)
- Create: `scripts/upload-tesseract-training-pair.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: the `TESSERACT_TRAINING` R2 binding, which Task 2's container-image fetch step and Task 5's runbook both reference by this exact binding name.

- [ ] **Step 1: Add the R2 bucket binding**

In `wrangler.toml`, immediately after the existing `[[r2_buckets]] binding = "KIOSK_DEVICES"` block (around line 164-166), add:

```toml
# TESSERACT_TRAINING — restricted bucket for the custom fine-tuned OCR
# effort (data-sovereignty motivated, see
# docs/superpowers/specs/2026-08-08-custom-tesseract-ocr-design.md).
# Holds labeled real-document training pairs AND the resulting
# .traineddata model file. NEITHER may ever be committed to git — this
# bucket is the storage boundary for real client legal-process content
# used in training. Access is admin/manager-gated at the route layer
# (see src/routes/tesseractOcr.ts), matching the pattern already used
# for PDF Tools encryption in src/routes/pdfTools.ts.
[[r2_buckets]]
binding = "TESSERACT_TRAINING"
bucket_name = "rmpg-flex-tesseract-training"
```

- [ ] **Step 2: Provision the bucket**

Run: `npx wrangler r2 bucket create rmpg-flex-tesseract-training`
Expected output: confirmation the bucket was created (or already exists, if re-run).

- [ ] **Step 3: Write the upload script**

Create `scripts/upload-tesseract-training-pair.ts`:

```ts
// ============================================================
// Uploads one labeled Tesseract fine-tuning pair (real document image +
// verified ground-truth transcription) into the restricted
// TESSERACT_TRAINING R2 bucket. Run manually, once per labeled document —
// this is NOT automated and NEVER runs in CI, since the corpus contains
// real client legal-process content.
//
//   npx tsx scripts/upload-tesseract-training-pair.ts <doc-id> <image-path> <ground-truth-path>
//
// Layout in the bucket: training-corpus/<doc-id>/image.<ext>,
// training-corpus/<doc-id>/ground-truth.txt
// ============================================================
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { execFileSync } from 'node:child_process';

const [docId, imagePath, groundTruthPath] = process.argv.slice(2);

if (!docId || !imagePath || !groundTruthPath) {
  console.error('Usage: npx tsx scripts/upload-tesseract-training-pair.ts <doc-id> <image-path> <ground-truth-path>');
  process.exit(1);
}

function r2Put(key: string, localPath: string) {
  execFileSync('npx', [
    'wrangler', 'r2', 'object', 'put',
    `rmpg-flex-tesseract-training/${key}`,
    `--file=${localPath}`,
    '--remote',
  ], { stdio: 'inherit' });
}

const ext = extname(imagePath) || '.png';
r2Put(`training-corpus/${docId}/image${ext}`, imagePath);
r2Put(`training-corpus/${docId}/ground-truth.txt`, groundTruthPath);

console.log(`Uploaded training pair for doc-id "${docId}".`);
```

- [ ] **Step 4: Verify the script runs (dry check without real data)**

Run: `npx tsc --noEmit scripts/upload-tesseract-training-pair.ts --esModuleInterop --skipLibCheck --module esnext --moduleResolution bundler --target es2022`
Expected: no type errors.

Do NOT run this script with real data in this task — no labeled corpus exists yet (that's an operator-driven process outside this plan's scope, per the design's non-goals).

- [ ] **Step 5: Commit**

```bash
git add wrangler.toml scripts/upload-tesseract-training-pair.ts
git commit -m "feat(tesseract-ocr): add restricted R2 bucket + training-pair upload script"
```

---

### Task 2: Tesseract OCR container (Dockerfile + server + Container class)

**Files:**
- Create: `containers/tesseract-ocr/Dockerfile`
- Create: `containers/tesseract-ocr/server.py`
- Create: `containers/tesseract-ocr/requirements.txt`
- Create: `src/containers/tesseractOcrContainer.ts`
- Modify: `.gitignore` (add the local model-staging directory)

**Interfaces:**
- Consumes: nothing from Task 1 directly (the container itself doesn't talk to R2 — the model file is fetched into its build context by Task 4's deploy step, before the Docker build runs).
- Produces: `TesseractOcrContainer` class (Task 3 references this class name and the `TESSERACT_OCR` binding it will be wired to in `wrangler.toml`), and the container's HTTP contract: `GET /health`, `POST /ocr` (multipart `image` file → `{ text: string }` JSON).

- [ ] **Step 1: Add the model-staging gitignore entry**

In `.gitignore`, add:

```
# Tesseract fine-tuned model — fetched from R2 at deploy time, never
# committed (real document training data-derived artifact).
containers/tesseract-ocr/model/
```

- [ ] **Step 2: Write the Dockerfile**

Create `containers/tesseract-ocr/Dockerfile`:

```dockerfile
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
```

- [ ] **Step 3: Write requirements.txt**

Create `containers/tesseract-ocr/requirements.txt`:

```
fastapi==0.115.6
uvicorn==0.32.1
python-multipart==0.0.31
```

- [ ] **Step 4: Write the FastAPI server**

Create `containers/tesseract-ocr/server.py`:

```python
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
```

- [ ] **Step 5: Write the Container subclass**

Create `src/containers/tesseractOcrContainer.ts`:

```ts
// ============================================================
// RMPG Flex — Custom Tesseract OCR Container (Cloudflare Containers)
// ============================================================
// Container subclass wrapping the Dockerfile under containers/tesseract-ocr/.
// Self-hosted, fine-tuned OCR — data-sovereignty motivated (see
// docs/superpowers/specs/2026-08-08-custom-tesseract-ocr-design.md).
//
// Follows the exact same shape as PdfToolsContainer
// (src/containers/pdfToolsContainer.ts) — one shared instance is fine
// because OCR is stateless per-request.
// ============================================================

import { Container } from '@cloudflare/containers';

export class TesseractOcrContainer extends Container {
  // Must match EXPOSE in containers/tesseract-ocr/Dockerfile.
  defaultPort = 8080;

  // Same rationale as PdfToolsContainer: keeps cold-starts off the hot
  // path during a working A/B session, releases the instance when idle.
  sleepAfter = '5m';

  // Matches FastAPI's GET /health route in containers/tesseract-ocr/server.py.
  pingEndpoint = 'localhost:8080/health';
}
```

- [ ] **Step 6: Verify the new TypeScript file type-checks**

Run: `npx tsc --noEmit src/containers/tesseractOcrContainer.ts --esModuleInterop --skipLibCheck --module esnext --moduleResolution bundler --target es2022 --types @cloudflare/workers-types`
Expected: no type errors (this file has no logic beyond class field declarations, so this should pass immediately).

- [ ] **Step 7: Commit**

```bash
git add containers/tesseract-ocr/ src/containers/tesseractOcrContainer.ts .gitignore
git commit -m "feat(tesseract-ocr): add Tesseract OCR container (Dockerfile, server, Container class)"
```

---

### Task 3: Worker route + wrangler.toml wiring

**Files:**
- Create: `src/routes/tesseractOcr.ts`
- Modify: `wrangler.toml` (add `[[containers]]`, `[[durable_objects.bindings]]`, `[[migrations]]` blocks)
- Modify: `src/routesConfig.ts` (mount the new route)
- Modify: `src/types.ts` (add the `TESSERACT_OCR` binding type, if bindings are typed there — verify the existing `PDF_TOOLS` binding's type declaration location first)

**Interfaces:**
- Consumes: `TesseractOcrContainer` from Task 2 (`src/containers/tesseractOcrContainer.ts`).
- Produces: `GET /api/tesseract-ocr/health`, `POST /api/tesseract-ocr/ocr` routes. Task 5's A/B script calls the LIVE endpoint directly via `fetch()` against the deployed Worker URL, not this file's exports, so this task's only cross-task interface is the route path strings themselves: `/api/tesseract-ocr/health` and `/api/tesseract-ocr/ocr`.

- [ ] **Step 1: Add the `TESSERACT_OCR` binding type**

`src/types.ts:4` already imports `PdfToolsContainer`:
```ts
import type { PdfToolsContainer } from './containers/pdfToolsContainer';
```
Add immediately after it:
```ts
import type { TesseractOcrContainer } from './containers/tesseractOcrContainer';
```

`src/types.ts:85` already declares:
```ts
  PDF_TOOLS: DurableObjectNamespace<PdfToolsContainer>;
```
Add immediately after it (same indentation, inside the same `Env`/`Bindings` interface):
```ts
  // Custom Tesseract OCR sidecar — self-hosted, fine-tuned, data-sovereignty
  // motivated (see docs/superpowers/specs/2026-08-08-custom-tesseract-ocr-design.md).
  // NOT wired into production OCR — measurement-only via
  // scripts/serve-intake-vision-ab.ts. Parameterized so getContainer<T>
  // narrows the stub type correctly, matching the PDF_TOOLS pattern above.
  TESSERACT_OCR: DurableObjectNamespace<TesseractOcrContainer>;
```

- [ ] **Step 2: Add the wrangler.toml blocks**

In `wrangler.toml`, immediately after the existing PDF Tools blocks (the `[[durable_objects.bindings]] name = "PDF_TOOLS"` block, which currently ends the PDF Tools section), add:

```toml
# ─── Custom Tesseract OCR Container ─────────────────────────
# Self-hosted, fine-tuned OCR — data-sovereignty motivated (see
# docs/superpowers/specs/2026-08-08-custom-tesseract-ocr-design.md).
# NOT wired into production callAi()/extractVision() — this is a
# measurable A/B candidate only (see scripts/serve-intake-vision-ab.ts),
# per the design's evidence-gated non-goal.
[[containers]]
class_name = "TesseractOcrContainer"
image = "./containers/tesseract-ocr/Dockerfile"
max_instances = 3
instance_type = "basic"

[[durable_objects.bindings]]
name = "TESSERACT_OCR"
class_name = "TesseractOcrContainer"
```

Then, in the `[[migrations]]` list, APPEND (never insert mid-list — see this file's own comment on `v2-voicehub` explaining why) a new tag after the current last one (`v7-webbrowsersession`):

```toml
[[migrations]]
tag = "v8-tesseractocr"
new_sqlite_classes = ["TesseractOcrContainer"]
```

- [ ] **Step 3: Write the Worker route**

Create `src/routes/tesseractOcr.ts`:

```ts
// ============================================================
// RMPG Flex — Custom Tesseract OCR route (Worker proxy → Container)
// ============================================================
// Forwards OCR requests to the self-hosted, fine-tuned Tesseract
// Container sidecar at containers/tesseract-ocr/. Data-sovereignty
// motivated — see
// docs/superpowers/specs/2026-08-08-custom-tesseract-ocr-design.md.
//
// NOT wired into production OCR extraction (callAi()/extractVision()).
// This route exists so the A/B script (scripts/serve-intake-vision-ab.ts)
// can measure this candidate against a deployed instance, the same way
// it measures the other four candidates.
// ============================================================

import { Hono } from 'hono';
import { getContainer } from '@cloudflare/containers';
import type { Env } from '../types';

const tesseractOcr = new Hono<Env>();

const CONTAINER_NAME = 'shared';

// GET /api/tesseract-ocr/health
tesseractOcr.get('/health', async (c) => {
  try {
    const container = getContainer(c.env.TESSERACT_OCR, CONTAINER_NAME);
    const res = await container.fetch(new Request('http://container/health'));
    const body = await res.json();
    return c.json(body as Record<string, unknown>, res.status as any);
  } catch (err) {
    return c.json({
      status: 'unavailable',
      code: 'CONTAINER_UNREACHABLE',
      detail: err instanceof Error ? err.message : String(err),
    }, 503);
  }
});

// POST /api/tesseract-ocr/ocr — multipart `image` field, forwarded verbatim.
// Admin/manager only — same role gate as PDF Tools encryption
// (src/routes/pdfTools.ts), since this is measurement tooling, not a
// general-purpose endpoint.
tesseractOcr.post('/ocr', async (c) => {
  const user = c.get('user');
  if (!user || !['admin', 'manager'].includes(user.role)) {
    return c.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, 403);
  }
  try {
    const container = getContainer(c.env.TESSERACT_OCR, CONTAINER_NAME);
    const forwarded = new Request('http://container/ocr', {
      method: 'POST',
      headers: c.req.raw.headers,
      body: c.req.raw.body,
      // @ts-expect-error — Workers fetch needs `duplex` for streaming
      duplex: 'half',
    });
    const res = await container.fetch(forwarded);
    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: { 'Content-Type': res.headers.get('Content-Type') || 'application/json' },
    });
  } catch (err) {
    return c.json({
      error: 'OCR request failed',
      code: 'OCR_FAILED',
      detail: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});

export default tesseractOcr;
```

- [ ] **Step 4: Mount the route**

In `src/routesConfig.ts`, add the import immediately after the existing `import pdfTools from './routes/pdfTools';` line:

```ts
import tesseractOcr from './routes/tesseractOcr';
```

And add the mount entry immediately after the existing `{ prefix: '/api/pdf-tools', router: pdfTools, auth: 'required' },` line:

```ts
  { prefix: '/api/tesseract-ocr', router: tesseractOcr, auth: 'required' },
```

- [ ] **Step 5: Run the full test suite and typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: PASS, no regressions. This task adds a new route and container binding but doesn't modify any existing route's behavior.

- [ ] **Step 6: Commit**

```bash
git add src/routes/tesseractOcr.ts src/routesConfig.ts src/types.ts wrangler.toml
git commit -m "feat(tesseract-ocr): wire Worker route + wrangler.toml container binding"
```

---

### Task 4: Deploy-time model fetch (with stock-model bootstrap fallback)

**Files:**
- Create: `scripts/fetch-tesseract-model.sh`
- Modify: `.github/workflows/deploy.yml`

**Interfaces:**
- Consumes: the `TESSERACT_TRAINING` R2 bucket from Task 1 (via `wrangler r2 object get`).
- Produces: `containers/tesseract-ocr/model/rmpg.traineddata` on disk, which Task 2's Dockerfile `COPY` step requires to exist before `wrangler deploy` runs (this task must run BEFORE the existing "Deploy Worker" step in `deploy.yml`).

- [ ] **Step 1: Write the fetch script with bootstrap fallback**

Create `scripts/fetch-tesseract-model.sh`:

```bash
#!/bin/bash
# Fetches the custom fine-tuned Tesseract model from the restricted
# TESSERACT_TRAINING R2 bucket into the container's build context,
# so the Dockerfile's COPY step has something to copy.
#
# Bootstrap fallback: if no custom model has been trained yet (R2 object
# not found), copies the stock English tessdata file instead, under the
# custom "rmpg" language code. This means the container always builds,
# even before fine-tuning has happened — the OCR just won't be any
# better than stock Tesseract until a real model is uploaded and this
# script picks it up on the next deploy.
set -euo pipefail

DEST_DIR="containers/tesseract-ocr/model"
DEST_FILE="$DEST_DIR/rmpg.traineddata"
R2_KEY="rmpg-flex-tesseract-training/models/latest/tesseract.traineddata"

mkdir -p "$DEST_DIR"

if npx wrangler r2 object get "$R2_KEY" --file="$DEST_FILE" --remote 2>/dev/null; then
  echo "Fetched custom fine-tuned model from R2."
else
  echo "No custom model found in R2 yet — falling back to stock English tessdata."
  # Stock eng.traineddata ships with the tesseract-ocr-eng apt package,
  # which isn't installed on the GitHub Actions runner itself — download
  # the same well-known stock file tesseract-ocr-eng installs, from the
  # official tessdata repo, so a fresh checkout with no trained model yet
  # still produces a working (stock-accuracy) container.
  curl -sSL -o "$DEST_FILE" \
    "https://raw.githubusercontent.com/tesseract-ocr/tessdata/main/eng.traineddata"
fi

ls -la "$DEST_FILE"
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x scripts/fetch-tesseract-model.sh`

- [ ] **Step 3: Add the deploy.yml step**

In `.github/workflows/deploy.yml`, add a new step immediately BEFORE the existing `- name: Deploy Worker` step:

```yaml
      - name: Fetch Tesseract model
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN_2 }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
        run: ./scripts/fetch-tesseract-model.sh
```

Note: this uses the same `CLOUDFLARE_API_TOKEN_2` / `CLOUDFLARE_ACCOUNT_ID` secrets the existing "Deploy Worker" step already uses — the token needs R2 read access on the `rmpg-flex-tesseract-training` bucket in addition to whatever scopes it already has (Workers Scripts Edit, D1 Edit, Containers Edit, Zone Workers Routes Edit, per the token this repo already uses today). If the token lacks R2 read access, this step will fail with an auth error the same way the earlier Containers permission gap did — check token scopes first if this step fails, per the pattern already established in this repo's incident history.

- [ ] **Step 4: Verify the script is syntactically valid**

Run: `bash -n scripts/fetch-tesseract-model.sh`
Expected: no output (a bash syntax check that produces no output means the script parses correctly).

Do NOT run this script live in this task — it requires live R2 credentials and will attempt a real network fetch. That happens for the first time when this deploy.yml change actually runs in CI, alongside the rest of Task 3's changes.

- [ ] **Step 5: Commit**

```bash
git add scripts/fetch-tesseract-model.sh .github/workflows/deploy.yml
git commit -m "feat(tesseract-ocr): add deploy-time model fetch with stock-model bootstrap"
```

---

### Task 5: A/B candidate integration

**Files:**
- Modify: `scripts/serve-intake-vision-ab.ts`

**Interfaces:**
- Consumes: the deployed `/api/tesseract-ocr/ocr` endpoint from Task 3. This is the FIRST candidate in this script that calls RMPG Flex's OWN deployed Worker rather than a third-party AI API directly — it needs a valid JWT to pass the route's `requireAuth`-equivalent role gate (`admin`/`manager` per Task 3 Step 3).
- Produces: nothing consumed by later tasks — this is the final task in the plan.

- [ ] **Step 1: No existing admin-JWT convention exists — use `RMPG_FLEX_JWT`**

Both existing scripts (`scripts/serve-intake-model-ab.ts`, `scripts/serve-intake-vision-ab.ts`) only authenticate against third-party AI APIs (`CLOUDFLARE_API_TOKEN`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) — neither carries a JWT for calling back into RMPG Flex's own admin-gated routes, because this is the first script that needs to. Use the new environment variable name `RMPG_FLEX_JWT` exactly as shown in Step 2 below — this establishes the naming precedent for any future script needing authenticated access to this Worker's own admin routes.

- [ ] **Step 2: Add the Tesseract-custom runner**

In `scripts/serve-intake-vision-ab.ts`, add this new runner function immediately after `runOpenAiVision`:

```ts
async function runTesseractCustom(imageBase64: string): Promise<Record<string, string>> {
  const jwt = process.env.RMPG_FLEX_JWT;
  if (!jwt) { console.error('  tesseract-custom: RMPG_FLEX_JWT not set, skipping'); return {}; }
  try {
    const form = new FormData();
    const bytes = Buffer.from(imageBase64, 'base64');
    form.set('image', new Blob([bytes], { type: 'image/png' }), 'image.png');
    const res = await fetch('https://api.rmpgutah.us/api/tesseract-ocr/ocr', {
      method: 'POST',
      headers: { authorization: `Bearer ${jwt}` },
      body: form,
    });
    if (!res.ok) { console.error(`  tesseract-custom: HTTP ${res.status}`); return {}; }
    const body = await res.json() as { text?: string };
    // Tesseract returns raw OCR text, not structured JSON fields like the
    // other candidates — this scores 0 on every field until a prompt/parse
    // layer is added on top (out of scope for this plan; the fixture corpus
    // comparison here is measuring raw text-extraction quality, which is
    // the correct signal for deciding whether fine-tuning is worth pursuing
    // further before investing in a structured-extraction layer on top).
    console.log(`  tesseract-custom raw text: ${(body.text ?? '').slice(0, 200)}`);
    return {};
  } catch (e) {
    console.error(`  tesseract-custom: ${e instanceof Error ? e.message : String(e)}`);
    return {};
  }
}
```

- [ ] **Step 3: Add it to the runners array**

In `main()`'s `runners` array, add the new entry after the `openai-vision` entry:

```ts
    { label: 'tesseract-custom (self-hosted)', run: runTesseractCustom },
```

- [ ] **Step 4: Verify the script still type-checks**

Run: `npx tsc --noEmit scripts/serve-intake-vision-ab.ts --esModuleInterop --resolveJsonModule --skipLibCheck --module esnext --moduleResolution bundler --target es2022`
Expected: no type errors.

Do NOT run this script live in this task (spends real resources, and there's no trained model yet — the earliest a meaningful score is possible is after Task 1's upload script has real labeled data and a training run has produced a model that Task 4's deploy step picks up).

- [ ] **Step 5: Commit**

```bash
git add scripts/serve-intake-vision-ab.ts
git commit -m "feat(tesseract-ocr): add self-hosted Tesseract as a fifth A/B candidate"
```

---

## Post-plan note (not a task — informational)

This plan ships infrastructure only. The actual sequence to get a real score is, in order: (1) an operator labels real documents and runs Task 1's upload script for each one, (2) the operator runs `tesstrain` locally against that corpus to produce a `.traineddata` file, uploaded to `rmpg-flex-tesseract-training/models/latest/tesseract.traineddata`, (3) the next deploy picks it up via Task 4's fetch step, (4) `scripts/serve-intake-vision-ab.ts` (Task 5's addition) is run with a real `RMPG_FLEX_JWT` to get an actual score. None of that human/training-data-dependent sequence is automatable and is intentionally left outside this plan's scope.

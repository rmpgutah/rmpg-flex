# AI Trinity Program — Design Spec

**Date:** 2026-06-22
**Author:** Christopher Zamora (with Claude)
**Status:** Draft for review
**Related memory:** [[project-overwatch-deep-research]], [[project-systemwide-runtime-sweep]]

---

## 1. Why this exists

Three new admin keys were pasted into [client/src/pages/admin/AdminIntegrationsTab.tsx](client/src/pages/admin/AdminIntegrationsTab.tsx) on 2026-06-21 but no Worker code reads them:

- `openai_api_key` (sk-proj-…, 164 chars)
- `replicate_api_key` (40 chars)
- `huggingface_api_key` (37 chars, `hf_…`)

The admin UI already saves them to `system_config` via `PUT /api/admin/third-party-keys`. The gap is purely backend wiring. This spec defines how each provider plugs into the existing stack without breaking the Anthropic-first invariants Deep Research and OCR rely on today.

A 4th item — a corrupted `mapbox_username` value (a wrangler command got pasted into that field) — is bundled because it's trivial and would silently corrupt Mapbox Studio URLs the moment that field gets consumed.

## 2. Scope

### In-program (this spec)

| ID | Feature | Provider | Sister to |
|----|---------|----------|-----------|
| **A1** | `callAi()` smart fallback chain (Claude → OpenAI → Workers AI) | OpenAI | [src/utils/anthropic.ts](src/utils/anthropic.ts) |
| **A2** | Semantic search across CFS / incidents / persons | HuggingFace | none (new) |
| **A3** | Named-entity auto-extract in incident narratives | HuggingFace | A1 (refines extracted entities) |
| **A4** | Document classifier on PDF intake | HuggingFace | [src/utils/serveIntakeExtract.ts](src/utils/serveIntakeExtract.ts) |
| **A5** | Face similarity on persons | Replicate | NSOPW imports ([[project-nsopw-nationwide-sor]]) |
| **A6** | Plate-crop super-resolution before OCR | Replicate | [src/utils/roboflowAlpr.ts](src/utils/roboflowAlpr.ts) |
| **A7** | Whisper audio transcription (body-cam) | Replicate | Evidence pipeline |
| **A8** | BOLO image generation | Replicate | Comms BOLO board |
| **E**  | Fix corrupted `mapbox_username` D1 value | — | one-line SQL |

### Out of scope

- Per-page provider toggle UI (user explicitly chose "transparent fallback" over user-facing provider choice)
- Cost-tier routing (deferred — would require per-call cost classification; revisit after A1 ships and we see actual usage)
- Embedding storage in Pinecone (we use D1 + Vectorize for A2 — see §6)
- Streaming responses (all calls are request/response; streaming is a separate program)
- Replicate fine-tuning (we only call hosted public models)

### Ship-tonight subset

- **E** — `UPDATE system_config SET config_value = 'chzamo' WHERE config_key = 'mapbox_username'` (operator confirms username first)
- **A1** — `callAi()` helper + OpenAI provider module + refactor 8 existing Anthropic consumers to use the helper

**A2 through A8** are documented here for shared architecture but implemented as follow-up PRs.

## 3. Shared architecture

### 3.1 The "callAi" router (A1)

```
┌─────────────┐    primary
│ callAi(env) │──────────────→  Anthropic Claude  ─── ok ──→ return text
└─────────────┘   present?       (anthropic.ts)
       │
       │ missing OR 401/402/429-credit/5xx
       ▼
   try OpenAI ───── present? ──→ GPT-4o-mini  ──── ok ──→ return text
       │
       │ missing OR 401/402/429-credit/5xx
       ▼
   Workers AI ─── always present ─→ llama-3.3-70b-fp8-fast ──→ return text
```

**File:** `src/utils/callAi.ts` — single export `callAi(env, opts)` and `callAiVision(env, opts)`.

**Type contract:**

```ts
export interface AiCallOpts {
  system?: string;
  text: string;
  image?: { base64: string; mediaType: string };
  maxTokens?: number;
  /** When set, only providers in this list are tried.
   *  Default = ['claude','openai','workers-ai'] in that order. */
  providers?: Array<'claude' | 'openai' | 'workers-ai'>;
}

export interface AiCallResult {
  text: string;
  provider: 'claude' | 'openai' | 'workers-ai';
  model: string;
  /** Whether the call fell back from a higher-priority provider. */
  fellBack: boolean;
}
```

**Error classification** — fall back from provider P to P+1 when:
- P's key is missing from `system_config`
- HTTP 401/403 (bad key, no permission)
- HTTP 402 (out of credit / quota)
- HTTP 429 with `credit|balance|fund|billing|quota` in the body (mirrors `diagnoseAnthropicError`)
- HTTP 5xx after one retry with 1s backoff

Do NOT fall back on:
- HTTP 400 (bad request — same payload will fail on the next provider too; surface the error)
- HTTP 429 without credit hint (transient rate-limit — retry once, then surface)
- Network errors after one retry (surface the error)

**Logging:** every fallback decision writes one row to `audit_log` via `recordAudit()` with `event_type='AI_FALLBACK'`, `details={ from, to, reason }`. This makes the cost-anomaly questions answerable later ("how often is Claude actually being used vs OpenAI?").

### 3.2 New utility files (one per provider)

Mirror the [src/utils/anthropic.ts](src/utils/anthropic.ts) shape — ~130 LOC each:

```
src/utils/openai.ts        → getOpenAiKey, callOpenAi, diagnoseOpenAiError
src/utils/huggingface.ts   → getHfKey, callHfEmbedding, callHfNer, callHfClassify
src/utils/replicate.ts     → getReplicateKey, runReplicateModel, pollPrediction
src/utils/callAi.ts        → callAi (the router from §3.1)
```

Each helper:
- Reads its key from `system_config` (same `queryFirst` pattern as `getAnthropicKey`)
- Returns `null` for the key when unset (caller decides what to do)
- Throws on non-2xx with a `<Provider> <status>: <body-snippet>` message that the diagnose-fn can parse

### 3.3 No new env bindings required

Only `system_config` reads — no `wrangler.toml` changes, no new secrets to provision. Workers AI binding `AI` already exists.

## 4. Per-feature designs

### A1 — Smart fallback (ship tonight)

**Consumers to refactor:**

| File | Current call | After A1 |
|------|--------------|----------|
| [src/utils/researchEngine.ts:16](src/utils/researchEngine.ts) | `await callClaude(key, opts)` | `await callAi(env, opts)` |
| [src/utils/visionExtract.ts:25](src/utils/visionExtract.ts) | `callClaude` (vision) | `callAiVision(env, opts)` |
| [src/utils/intelLlm.ts:31](src/utils/intelLlm.ts) | `callClaude` | `callAi` |
| [src/utils/serveIntakeExtract.ts:511,540](src/utils/serveIntakeExtract.ts) | `callClaude` | `callAi` |
| [src/routes/intelAi.ts:100,124](src/routes/intelAi.ts) | `callClaude` | `callAi` |
| [src/routes/ocr.ts:62](src/routes/ocr.ts) | `callClaude` | `callAiVision` |
| [src/routes/admin.ts:990](src/routes/admin.ts) (the "Test Claude" probe) | `callClaude` | KEEP `callClaude` directly — this endpoint specifically tests Claude, not the chain |
| [src/routes/pdfEngine.ts:13](src/routes/pdfEngine.ts) | only imports `bytesToBase64` | no change |

**Test-button parity:** the existing `POST /admin/third-party-keys/anthropic_api_key/test` button stays Claude-specific. A new `openai_api_key/test` button mirrors it — extended in `ALLOWED_THIRD_PARTY_KEYS` whitelist and the `key !== 'anthropic_api_key'` guard in [src/routes/admin.ts](src/routes/admin.ts).

**Behavioral invariants:**

1. **Backwards compat** — if `openai_api_key` is unset, behavior is byte-identical to today (Claude → Workers AI), no change for existing users.
2. **No regressions for Deep Research** — the `researchEngine.ts` orchestration already handles a null Claude key by falling back to Workers AI; we just insert OpenAI as a middle tier. The interface to consumers stays identical.
3. **Vision parity** — OpenAI's `gpt-4o` supports vision (base64 image inputs in messages), so `callAiVision` is symmetric to `callClaude`'s vision support. Workers AI uses `@cf/meta/llama-3.2-11b-vision-instruct` as the vision fallback (already used in OCR pipeline).

### A2 — HuggingFace embeddings → semantic search (follow-up PR)

**New table** (migration `0150_semantic_vectors.sql`):

```sql
CREATE TABLE IF NOT EXISTS semantic_vectors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,           -- 'cfs' | 'incident' | 'person' | 'case'
  entity_id INTEGER NOT NULL,
  embedding_model TEXT NOT NULL,       -- 'all-MiniLM-L6-v2' (384-d)
  vector BLOB NOT NULL,                -- Float32Array, 384 * 4 = 1536 bytes
  source_hash TEXT NOT NULL,           -- hash of source text (skip re-embed if unchanged)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_semantic_vectors_entity ON semantic_vectors(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS ix_semantic_vectors_hash ON semantic_vectors(source_hash);
```

**Why D1 not Vectorize:** at our scale (~10K CFS rows, ~5K incidents, ~3K persons), brute-force cosine over 384-d vectors in JS is <100ms per query. Vectorize adds another binding + cost + cold-start latency we don't need yet. Revisit if we cross 100K rows.

**Indexing:** new cron `*/15 * * * *` checks for un-embedded or stale rows (source_hash mismatch), embeds via HF Inference API in batches of 32, writes back. Bounded to 500 rows per tick to stay within Worker CPU budget.

**Search endpoint:** `POST /api/search/semantic` — `{ query, types?, limit? }` → embeds the query once, scores all stored vectors, returns top-K with entity refs.

**UI surface:** a new "Semantic search" toggle in the existing global search bar. Off by default; opt-in per session.

### A3 — HuggingFace NER → entity auto-extract (follow-up PR)

**Trigger:** "Auto-link entities" button on incident composer. Calls HF `dbmdz/bert-large-cased-finetuned-conll03-english` (or comparable) on narrative text → returns spans tagged PER/ORG/LOC/MISC → fuzzy-matches against `persons` / `businesses` / `properties` tables → presents matches for officer confirm.

**Why an explicit button, not auto:** false positives in NER are wrong-link risks (officer narrative "John spoke with the suspect" should NOT auto-link to John Doe in persons). Officer review keeps the audit trail clean.

**Sister to A1:** if HF key is missing, fall back to Claude via `callAi()` with a prompt asking for the same JSON extraction shape.

### A4 — Document classifier on PDF intake (follow-up PR)

**Use:** as `serveIntakeExtract.ts` processes an uploaded PDF, run an HF text-classification model over the first 500 chars to predict {court_order, citation, will, serve_packet, contract, other}. Pre-populates the document type dropdown in the intake UI.

**Model:** a generic `facebook/bart-large-mnli` zero-shot classifier with our custom labels — no fine-tuning needed; HF's free tier supports it.

**Sister to existing Claude OCR:** runs in parallel, not replacing. Claude does extraction; HF does typing.

### A5 — Replicate face similarity (follow-up PR)

**New table** (migration `0151_face_vectors.sql`):

```sql
CREATE TABLE IF NOT EXISTS face_vectors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  photo_url TEXT NOT NULL,              -- R2 path to source photo
  embedding BLOB NOT NULL,              -- 512-d float32 = 2048 bytes
  model TEXT NOT NULL,                  -- 'serengil/deepface-facenet512'
  detected_box TEXT,                    -- JSON {x,y,w,h} bounding box
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_face_vectors_person ON face_vectors(person_id);
```

**Indexing:** when a person photo is uploaded (existing R2 `field-photos/` hook), enqueue a Replicate prediction. Webhook URL = `https://api.rmpgutah.us/api/replicate/face-callback`. On completion, persist the 512-d vector.

**Search:** `POST /api/persons/face-search` — upload a query face crop → embed → cosine-rank against `face_vectors` → return top-10 person matches with confidence scores. Surfaces in PersonDetail "Find similar faces" + Forensics module.

**Why webhook not polling:** Replicate predictions take 5-30s. Polling burns Worker CPU; webhook returns CPU to zero while waiting. NSOPW integration already wires R2 callbacks; same pattern.

### A6 — Plate-crop super-resolution (follow-up PR)

**Slot in:** [src/utils/roboflowAlpr.ts](src/utils/roboflowAlpr.ts) — after the vehicle-detection step returns a plate bbox, but before OCR, if the crop is <100×30 px, send to Replicate `nightmareai/real-esrgan` for 4× upscale, then OCR the upscaled crop.

**Cost guard:** skip super-res when input crop is already ≥150×45 px. ~70% of dashcam plate crops are below that threshold based on observed `alpr_captures` data.

**Trust scoring:** the `captureTrust()` seam ([[project-dashcam-alpr-false-confidence]]) gets a new factor `super_res_applied: bool` so the trust badge reflects whether the read came from an upscaled image.

### A7 — Whisper audio transcription (follow-up PR)

**Use:** new "Transcribe audio" button on evidence file rows where mime starts with `audio/`. Calls Replicate `openai/whisper:large-v3` with the R2-presigned URL of the audio file. Webhook callback persists transcript + word-level timestamps to a new `evidence_transcripts` table.

**Why not Workers AI Whisper:** `@cf/openai/whisper` has 25 MB input cap and English-only on free tier. Body-cam recordings routinely exceed that. Replicate handles up to 100 MB and multi-language.

### A8 — BOLO image generation (follow-up PR)

**Use:** "Generate BOLO graphic" button on a BOLO record → composites suspect/vehicle/incident details into a Stable Diffusion prompt → Replicate returns a 1024×1024 poster image → uploads to R2 → attaches to the BOLO.

**Lowest priority** of the 8 — included for completeness but expected to be implemented last (and possibly cancelled if A5/A6 prove higher leverage).

### E — Mapbox username D1 fix (ship tonight)

```sql
-- One-time correction. Current value is a wrangler shell command that was pasted
-- into the field by mistake (length 119, starts 'npx wrangler d1 exec').
-- Correct username = 'chzamo7', confirmed by base64-decoding the existing
-- mapbox_access_token JWT payload: pk.eyJ1IjoiY2h6YW1vNyJ9... → {"u":"chzamo7"}.
UPDATE system_config
SET config_value = 'chzamo7',
    updated_at = datetime('now')
WHERE config_key = 'mapbox_username' AND is_active = 1;
```

Apply via `mcp__cloudflare__d1_database_query`.

## 5. Data flow examples (A1)

### Happy path — Claude wins
```
ocr.ts → callAiVision(env, {text, image})
       → readKey('anthropic_api_key') → present
       → callClaude(...) → 200 OK
       → return {text, provider:'claude', model:'opus-4-8', fellBack:false}
```

### Fallback path — Claude over credit
```
researchEngine.ts → callAi(env, {text:'…'})
                 → callClaude(...) → 429 "credit"
                 → diagnoseAnthropicError → out-of-credit
                 → recordAudit('AI_FALLBACK', {from:'claude', to:'openai', reason:'no-credit'})
                 → readKey('openai_api_key') → present
                 → callOpenAi(...) → 200 OK
                 → return {text, provider:'openai', model:'gpt-4o-mini', fellBack:true}
```

### Floor path — all paid providers absent
```
intelAi.ts → callAi(env, {text:'…'})
          → readKey('anthropic_api_key') → null
          → readKey('openai_api_key') → null
          → env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {prompt})
          → return {text, provider:'workers-ai', model:'llama-3.3-70b', fellBack:true}
```

## 6. Testing strategy

### Unit (vitest, manual)
Following the [tests/roboflowAlpr.test.ts](tests/roboflowAlpr.test.ts) precedent — Worker tests live under `tests/` and are **runnable manually** but do NOT gate CI yet (per CLAUDE.md "Adding vitest for `/src/` with Miniflare is tracked as Phase 2 tech debt"):

- `tests/callAi.test.ts` — table-driven: input (which keys present, what errors) → expected (which provider answered, fellBack flag). Mock `fetch` and `env.AI.run`. Run via `npx vitest run tests/callAi.test.ts`.
- `tests/openai.test.ts` — `diagnoseOpenAiError` against fixture error bodies (no network — pure-function tests).
- For follow-up PRs: `tests/huggingface.test.ts`, `tests/replicate.test.ts`.

### CI gates (what actually fails the PR)
- `worker-typecheck` (`npm run typecheck`) — must compile clean
- `client-typecheck` — must compile clean (only matters if A1 touches client; A1 does not)
- `client-tests` (`vitest` on `client/`) — must pass

The pre-push husky hook (`.husky/pre-push`) mirrors these.

### Manual smoke after ship
- With all 3 keys set: `POST /admin/third-party-keys/anthropic_api_key/test` → 200 ok=true.
- New: `POST /admin/third-party-keys/openai_api_key/test` → 200 ok=true.
- After deliberately revoking the Anthropic key in admin: `POST /api/intel-ai/ask` with a test prompt → still returns answer; new `provider` field in response = `'openai'`.
- Both paid keys unset (revoke both via admin): same call returns with `provider:'workers-ai'`, `fellBack:true`.
- Tail `audit_log` for `AI_FALLBACK` rows to confirm the router decisions match expectations.

## 7. Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| OpenAI sk-proj keys have project scope — might 403 on models not enabled in that project | `diagnoseOpenAiError` distinguishes 403-model-not-allowed from 403-bad-key; falls back to Workers AI on the former |
| Vision quality differs between providers — OCR accuracy could silently regress | A1 ships with vision routed to Claude only by default; OpenAI vision opted in via `providers:['claude','openai']` per call site |
| Audit log volume from `AI_FALLBACK` events could grow large | Sample at 1/10 once we see steady-state volume; log only the first fallback per request (not retry storms) |
| HF free tier rate-limits (~1k req/day) could brick A2 indexing cron | Cron checks remaining quota header and exits early on rate-limit; degrades to "stale embeddings" gracefully |
| Replicate webhook signing — without verification, anyone can spoof a face match | All Replicate routes verify the `Webhook-Signature` HMAC against a new `REPLICATE_WEBHOOK_SECRET` (env, not D1, since it's truly secret-like) |
| Worker CPU budget on cosine search over 10K vectors | Bench during A2 implementation; if >50ms, page into Vectorize (separate spec) |

## 8. Deferred / explicitly NOT in scope

- Streaming AI responses (separate program)
- Per-user AI provider preference (the user picked transparent fallback)
- Cost analytics dashboard (revisit after 30 days of `AI_FALLBACK` data)
- Migrating Anthropic-specific test button to "test all providers" (one-button-per-provider is fine for now)
- Embeddings of dashcam frame contents (image embedding is a separate program from text)

## 9. Implementation order

| PR | Includes | Migration |
|----|----------|-----------|
| **PR1 (tonight)** | E + A1: mapbox fix + `callAi.ts` + `openai.ts` + refactor 8 consumers + `openai_api_key/test` button + tests | none |
| PR2 | A2: `semantic_vectors` table + indexing cron + search endpoint + UI toggle | 0150 |
| PR3 | A3: NER button on incident composer | none |
| PR4 | A4: document classifier in PDF intake | none |
| PR5 | A5: `face_vectors` table + Replicate face callback + "Find similar faces" UI | 0151 |
| PR6 | A6: plate-crop super-res in roboflowAlpr.ts | none |
| PR7 | A7: Whisper transcription on evidence audio | new `evidence_transcripts` table |
| PR8 | A8 (optional): BOLO image gen | none |

Each PR is independently shippable; later PRs only depend on A1 being live.

---

## Open questions before implementation

1. ~~**Mapbox username confirmation**~~ — RESOLVED. Decoded `mapbox_access_token` JWT payload to confirm `chzamo7`. Baked into §4.E.
2. **OpenAI default model** — `gpt-4o-mini` (cheapest, ~$0.15/1M input) vs `gpt-4o` (most capable, ~$2.50/1M). Recommendation: `gpt-4o-mini` default with `openai_model` system_config override (mirrors how `anthropic_model` works today). Override would be settable via admin or directly in D1.
3. **Vision call routing** — when Claude vision is unavailable, should the chain try OpenAI's `gpt-4o` vision, or skip straight to Workers AI's `@cf/meta/llama-3.2-11b-vision-instruct`? Recommendation: try OpenAI vision (it's high-quality and parity-priced for vision) but document that OCR consumers can pin `providers: ['claude','workers-ai']` if they want to skip OpenAI specifically for vision.

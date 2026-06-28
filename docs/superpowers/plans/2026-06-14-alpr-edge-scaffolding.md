# ALPR Edge Scaffolding Implementation Plan (spec B, buildable subset)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Lay the rails for the future on-device vision-LoRA: an HMAC-verified `/api/alpr/edge` webhook that feeds an edge ALPR read into the existing trust layer as a voter, a `model_registry` for adapter provenance, and an offline dataset-builder that turns confirmed dossier captures into LoRA training JSONL.

**Architecture:** The edge device (Jetson) signs a structured ALPR record (HMAC-SHA256, mirroring `edge/flex_edge/signer.py`) and POSTs it. The Worker verifies the signature with Web Crypto, then routes the read through the same `plateTrust` + `vehicle_capture_photos` path built for spec A — the edge read is just another source/voter. The dataset builder and registry are offline/config only.

**Tech Stack:** Hono on Workers, Web Crypto (`crypto.subtle`), D1, vitest, tsx (offline script).

**Depends on:** spec A (`src/utils/plateTrust.ts`, `vehicle_capture_photos`) — this branch is stacked on `claude/lucid-haslett-e97ab6`.

---

### Task 1: `edgeHmac.ts` — Web Crypto HMAC verify (TDD)

**Files:** Create `src/utils/edgeHmac.ts`; Test `tests/edgeHmac.test.ts`

- [ ] **Step 1: Failing test**

```ts
// tests/edgeHmac.test.ts
import { describe, it, expect } from 'vitest';
import { signEdgePayload, verifyEdgeSignature } from '../src/utils/edgeHmac';

describe('edge HMAC', () => {
  const secret = 'test-secret';
  it('verifies a signature it produced (roundtrip)', async () => {
    const ts = 1_700_000_000;
    const body = '{"plate":"5KJH345"}';
    const sig = await signEdgePayload(secret, ts, body);
    expect(sig.startsWith('sha256=')).toBe(true);
    const ok = await verifyEdgeSignature({ secret, timestamp: ts, body, signature: sig, nowSec: ts + 10 });
    expect(ok).toBe(true);
  });
  it('rejects a tampered body', async () => {
    const ts = 1_700_000_000;
    const sig = await signEdgePayload(secret, ts, 'a');
    expect(await verifyEdgeSignature({ secret, timestamp: ts, body: 'b', signature: sig, nowSec: ts })).toBe(false);
  });
  it('rejects a stale timestamp (outside replay window)', async () => {
    const ts = 1_700_000_000;
    const sig = await signEdgePayload(secret, ts, 'a');
    expect(await verifyEdgeSignature({ secret, timestamp: ts, body: 'a', signature: sig, nowSec: ts + 10_000 })).toBe(false);
  });
});
```

- [ ] **Step 2: Run → FAIL** `npx vitest run tests/edgeHmac.test.ts`

- [ ] **Step 3: Implement**

```ts
// src/utils/edgeHmac.ts
// HMAC-SHA256 signed-body contract matching edge/flex_edge/signer.py:
//   payload = `${timestamp}\n${body}` ; sig = "sha256=" + hex(HMAC) ; ±REPLAY_WINDOW_SEC.
export const REPLAY_WINDOW_SEC = 300;

async function hmacHex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function signEdgePayload(secret: string, timestamp: number, body: string): Promise<string> {
  return 'sha256=' + (await hmacHex(secret, `${timestamp}\n${body}`));
}

/** Constant-time-ish compare of equal-length hex strings. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyEdgeSignature(args: {
  secret: string; timestamp: number; body: string; signature: string; nowSec: number;
}): Promise<boolean> {
  if (!args.signature?.startsWith('sha256=')) return false;
  if (Math.abs(args.nowSec - args.timestamp) > REPLAY_WINDOW_SEC) return false;
  const expected = await signEdgePayload(args.secret, args.timestamp, args.body);
  return safeEqual(expected, args.signature);
}
```

- [ ] **Step 4: Run → PASS** `npx vitest run tests/edgeHmac.test.ts`
- [ ] **Step 5: Commit** `git add src/utils/edgeHmac.ts tests/edgeHmac.test.ts && git commit -m "feat(alpr): edge HMAC verify (Web Crypto, matches signer.py contract)"`

---

### Task 2: `POST /api/alpr/edge` — verified edge read → trust voter

**Files:** Modify `src/routes/alpr.ts`

- [ ] **Step 1: Add the route** (read the file to match real imports `getDb`, `query`, `execute`, `ensureAlprSchema`, `trustScore`, `screenVehicle`, and the `vehicle_capture_photos` insert shape from spec A)

```ts
import { verifyEdgeSignature } from '../utils/edgeHmac';

// Edge device (Jetson vision-LoRA) posts a structured ALPR record. HMAC-verified,
// then routed through the same trust path as every other source (source_type='edge_lora').
app.post('/edge', async (c) => {
  const secret = c.env.ALPR_EDGE_SECRET;
  if (!secret) return c.json({ error: 'edge ingest not configured' }, 503);
  const ts = Number(c.req.header('X-Edge-Timestamp'));
  const sig = c.req.header('X-Edge-Signature') ?? '';
  const body = await c.req.text();
  const nowSec = Math.floor(Date.now() / 1000);
  if (!ts || !(await verifyEdgeSignature({ secret, timestamp: ts, body, signature: sig, nowSec })))
    return c.json({ error: 'bad signature' }, 401);

  const rec = JSON.parse(body) as {
    plate?: string; state?: string; make?: string; model?: string; year?: string;
    color?: string; type?: string; plate_confidence?: number; device_id?: string;
  };
  if (!rec.plate) return c.json({ error: 'no plate' }, 400);

  const db = getDb(c.env); await ensureAlprSchema(db);
  const trust = trustScore({ reads: [rec.plate], modelPct: rec.plate_confidence });
  const PACKAGE_GATE = 0.80; const canonical = trust.canonical || rec.plate;
  await screenVehicle(db, { plate: canonical });
  let photoRowId: number | null = null;
  if (trust.trustScore >= PACKAGE_GATE) {
    const r = await execute(db,
      `INSERT INTO vehicle_capture_photos
        (capture_id, canonical_plate, raw_reads_json, variants_json, read_count,
         consensus_ratio, trust_score, trust_basis, source_type, asserted, created_at)
       VALUES (NULL,?,?,?,?,?,?,?,?,?,datetime('now'))`,
      [canonical, JSON.stringify([rec.plate]), JSON.stringify(trust.variants), trust.readCount,
       trust.consensusRatio, trust.trustScore, trust.basis, 'edge_lora', 0]);
    photoRowId = r.meta.last_row_id as number;
  }
  return c.json({ success: true, canonical_plate: canonical, trust_score: trust.trustScore,
                  trust_basis: trust.basis, photo_row_id: photoRowId });
});
```

- [ ] **Step 2: Typecheck** `npm run typecheck` → zero new errors
- [ ] **Step 3: Commit** `git add src/routes/alpr.ts && git commit -m "feat(alpr): /api/alpr/edge HMAC webhook feeds edge reads into the trust layer"`

> Add `ALPR_EDGE_SECRET` to the edge signer's secret + `wrangler secret put ALPR_EDGE_SECRET` at deploy. Document the header names (`X-Edge-Timestamp`/`X-Edge-Signature`) for the future `edge/flex_edge/alpr.py`.

---

### Task 3: `model_registry` — adapter provenance

**Files:** Create `migrations/0119_model_registry.sql`; Modify `src/routes/alpr.ts` (GET/PUT)

- [ ] **Step 1: Migration**

```sql
-- 0119_model_registry.sql — which trained adapter is live per target + its eval metric.
CREATE TABLE IF NOT EXISTS model_registry (
  target TEXT PRIMARY KEY,              -- 'plate' | 'state' | 'mmy' | 'color' | 'type'
  adapter_version TEXT,
  base_model TEXT,
  holdout_metric REAL,                  -- e.g. exact-match / accuracy on held-out set
  beats_baseline INTEGER DEFAULT 0,
  promoted_at TEXT,
  notes TEXT
);
```

- [ ] **Step 2: Endpoints** (in `src/routes/alpr.ts`)

```ts
app.get('/models', async (c) => {
  const db = getDb(c.env);
  await execute(db, `CREATE TABLE IF NOT EXISTS model_registry (target TEXT PRIMARY KEY, adapter_version TEXT, base_model TEXT, holdout_metric REAL, beats_baseline INTEGER DEFAULT 0, promoted_at TEXT, notes TEXT)`);
  return c.json({ models: await query(db, `SELECT * FROM model_registry ORDER BY target`) });
});
app.put('/models/:target', async (c) => {
  const db = getDb(c.env); const target = c.req.param('target');
  const b = await c.req.json();
  await execute(db, `CREATE TABLE IF NOT EXISTS model_registry (target TEXT PRIMARY KEY, adapter_version TEXT, base_model TEXT, holdout_metric REAL, beats_baseline INTEGER DEFAULT 0, promoted_at TEXT, notes TEXT)`);
  await execute(db,
    `INSERT INTO model_registry (target, adapter_version, base_model, holdout_metric, beats_baseline, promoted_at, notes)
     VALUES (?,?,?,?,?,datetime('now'),?)
     ON CONFLICT(target) DO UPDATE SET adapter_version=excluded.adapter_version, base_model=excluded.base_model,
       holdout_metric=excluded.holdout_metric, beats_baseline=excluded.beats_baseline, promoted_at=excluded.promoted_at, notes=excluded.notes`,
    [target, b.adapter_version ?? null, b.base_model ?? null, b.holdout_metric ?? null, b.beats_baseline ? 1 : 0, b.notes ?? null]);
  return c.json({ success: true });
});
```

- [ ] **Step 3: Typecheck → PASS; Commit** `git add migrations/0119_model_registry.sql src/routes/alpr.ts && git commit -m "feat(alpr): model_registry for trained-adapter provenance"`

---

### Task 4: Offline dataset builder (schema + reader)

**Files:** Create `training/build-dataset-alpr.ts`

- [ ] **Step 1: Implement** the JSONL builder. Input is a JSON export of confirmed packages (operator runs `wrangler d1 export` / the D1 API and saves `training/data-alpr/packages.json`); each entry pairs a local crop image path with ground-truth labels. Output `training/dist-alpr/train.jsonl` + `val.jsonl`.

```ts
// training/build-dataset-alpr.ts
// Build vision-LoRA SFT data from confirmed dossier captures.
// In:  training/data-alpr/packages.json  — [{ image: 'crops/<id>.jpg', target: {
//        plate, state, make, model, year, color, type } }]   (asserted reads only)
// Out: training/dist-alpr/{train,val}.jsonl — one row per image:
//        { messages:[{role:'user', content:[{type:'image', image:<path>},
//          {type:'text', text:<INSTRUCTION>}]}, {role:'assistant', content:<JSON target>}] }
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const INSTRUCTION = 'Read the license plate and identify the vehicle. Respond ONLY with JSON: {"plate","state","make","model","year","color","type"}.';

export interface AlprExample { image: string; target: Record<string, string>; }

export function toChatRow(ex: AlprExample) {
  return {
    messages: [
      { role: 'user', content: [{ type: 'image', image: ex.image }, { type: 'text', text: INSTRUCTION }] },
      { role: 'assistant', content: JSON.stringify(ex.target) },
    ],
  };
}

/** Deterministic train/val split by a stable hash of the image path. */
export function isVal(imagePath: string): boolean {
  let h = 0; for (const ch of imagePath) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h) % 5 === 0; // ~20% val
}

function main() {
  const inPath = join(HERE, 'data-alpr', 'packages.json');
  if (!existsSync(inPath)) { console.error('No packages.json — export confirmed captures first.'); process.exit(1); }
  const examples: AlprExample[] = JSON.parse(readFileSync(inPath, 'utf8'));
  const outDir = join(HERE, 'dist-alpr'); mkdirSync(outDir, { recursive: true });
  const train: string[] = []; const val: string[] = [];
  for (const ex of examples) (isVal(ex.image) ? val : train).push(JSON.stringify(toChatRow(ex)));
  writeFileSync(join(outDir, 'train.jsonl'), train.join('\n'));
  writeFileSync(join(outDir, 'val.jsonl'), val.join('\n'));
  console.log(`Wrote ${train.length} train / ${val.length} val rows.`);
}
if (import.meta.url === `file://${process.argv[1]}`) main();
```

- [ ] **Step 2: Test the pure helpers** `training/build-dataset-alpr.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { toChatRow, isVal } from './build-dataset-alpr';

describe('alpr dataset builder', () => {
  it('shapes a chat row with image + JSON target', () => {
    const row = toChatRow({ image: 'crops/1.jpg', target: { plate: '5KJH345', state: 'CA' } });
    expect(row.messages[0].content[0]).toEqual({ type: 'image', image: 'crops/1.jpg' });
    expect(JSON.parse(row.messages[1].content as string).plate).toBe('5KJH345');
  });
  it('splits deterministically', () => {
    expect(isVal('crops/1.jpg')).toBe(isVal('crops/1.jpg'));
  });
});
```

- [ ] **Step 3: Run → PASS** `npx vitest run training/build-dataset-alpr.test.ts`
- [ ] **Step 4: Commit** `git add training/build-dataset-alpr.ts training/build-dataset-alpr.test.ts && git commit -m "feat(alpr): offline vision-LoRA dataset builder from dossier captures"`

---

### Task 5: SW + wrap
- [ ] No client change → no SW bump needed. Confirm full gate: `npm run typecheck && npx vitest run tests/edgeHmac.test.ts training/build-dataset-alpr.test.ts`.

> **Post-merge:** apply `0119_model_registry.sql` to live D1 `785de7ae`; `wrangler secret put ALPR_EDGE_SECRET`.

## Self-Review
- Coverage: edge webhook contract (T1/T2), trust-voter wiring (T2), model_registry provenance (T3), dataset builder (T4). The hardware spike + actual training are out of scope (gated, per spec B).
- HMAC contract matches `signer.py` (`{ts}\n{body}`, `sha256=`, ±300s).
- Types consistent: `verifyEdgeSignature`/`signEdgePayload` (T1) used in T2; `toChatRow`/`isVal` (T4) tested.

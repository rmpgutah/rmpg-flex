# Crypto-Agility Versioning + Audit Trail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tag every signed PDF/evidence bundle with an explicit `algorithmVersion`, and automatically
log the first time each distinct signing key set is observed to a new `crypto_key_events` D1 table
— a real audit trail of when the signing scheme changed, with zero operator action required.

**Architecture:** `src/utils/pdfSign.ts`'s `getSigningKeys()` fires a fire-and-forget, `INSERT OR
IGNORE`-guarded D1 write the moment it derives a genuinely new key set (a cache-miss), mirroring
`src/utils/logger.ts`'s existing `logErrorToDb()` pattern exactly. `signTriple()` gains an
`algorithmVersion` field on its return value and an optional `ctx` parameter so the audit write can
be `waitUntil`-wrapped by callers that have one. The version tag threads through the same client
consumers the prior triple-algorithm-signing plan touched.

**Tech Stack:** D1 (SQLite), the existing `ExecCtx`-minimal-interface pattern already established
in `src/utils/logger.ts` — no new dependency.

## Global Constraints

- **Never change `deriveEd25519Seed()`'s formula, or anything about what gets signed.** This plan
  only adds observability on top of the existing (unchanged) triple-algorithm signing.
- **`crypto_key_events` has NO operator-identity or QRNG-used columns.** Nothing in this plan's
  automatic-capture mechanism can genuinely populate them — a column that would sit permanently
  `NULL` is a defect, not a design choice.
- **The audit write must NEVER block or fail a real signing request.** Every D1 error inside
  `logCryptoKeyEvent` is caught and swallowed; a missing table, a D1 outage, or any other failure
  must never propagate to the caller.
- **`first_observed_at` uses `datetime('now')` (UTC)** — not `datetime('now','localtime')` like
  the older `webauthn_credentials` table. Do not copy that table's convention.
- **`algorithmVersion` is the literal type `'pdf-sig-v2'`** everywhere it appears (`pdfSign.ts`,
  `pdfIntegrity.ts`, `sidecar.ts`) — not a generic `string` — so a typo or drift is a compile error.
- No new HTTP route. No retroactive backfill of `crypto_key_events`.

---

## File Map

| File | Change |
|---|---|
| `migrations/0192_crypto_key_events.sql` | New — the audit table |
| `src/utils/pdfSign.ts` | Add `ExecCtx`, `logCryptoKeyEvent`, `ALGORITHM_VERSION` const; wire into `getSigningKeys()`; add `algorithmVersion` to `PdfSignTripleResult`/`signTriple()` |
| `src/routes/pdfTools.ts` | Pass `c.executionCtx` to `signTriple()` |
| `src/routes/flexcam.ts` | Pass `c.executionCtx` to `signTriple()` |
| `client/src/utils/pdfIntegrity.ts` | Add `algorithmVersion` to `PdfSignatureBundle` + `fetchPdfSignature()` |
| `client/src/utils/pdf/v2/engine/sidecar.ts` | Add `algorithmVersion` to `SidecarSignature` |
| `client/src/utils/pdf/v2DispatchAdapter.ts` | Pass `algorithmVersion` through sidecar construction |
| `tests/pdfSign.test.ts` | New tests for `logCryptoKeyEvent`; extended assertions for `algorithmVersion` |
| `client/src/utils/__tests__/pdfIntegrity.test.ts` | Extended assertions for `algorithmVersion` |

---

### Task 1: `crypto_key_events` migration

**Files:**
- Create: `migrations/0192_crypto_key_events.sql`

**Interfaces:**
- Produces: the `crypto_key_events` table Task 2's `logCryptoKeyEvent()` writes to.

- [ ] **Step 1: Create the migration**

Create `migrations/0192_crypto_key_events.sql`:

```sql
-- 0192 — crypto_key_events: automatic audit trail of when the PDF/evidence
-- signing key set (Ed25519 + ML-DSA-87 + SLH-DSA-256f, algorithm_version
-- 'pdf-sig-v2') changes. Populated by src/utils/pdfSign.ts's
-- getSigningKeys() the first time it derives a given key_id — INSERT OR
-- IGNORE makes this safe under concurrent isolate cold-starts racing to
-- log the same new key after a real secret rotation.
--
-- No operator-identity or QRNG-used columns: nothing observing this event
-- automatically can populate them. See
-- docs/superpowers/specs/2026-07-18-crypto-agility-audit-trail-design.md.
CREATE TABLE IF NOT EXISTS crypto_key_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key_id TEXT NOT NULL UNIQUE,
  algorithm_version TEXT NOT NULL,
  algorithms TEXT NOT NULL,        -- JSON array, e.g. ["Ed25519","ML-DSA-87","SLH-DSA-256f"]
  first_observed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_crypto_key_events_first_observed ON crypto_key_events(first_observed_at);
```

- [ ] **Step 2: Apply it locally**

Run: `npm run migrate:local`
Expected: exits 0. This applies every migration (including the new one) to a fresh local D1 —
it will re-apply already-tracked migrations idempotently and add this one.

- [ ] **Step 3: Verify the table exists with the right schema**

Run:
```bash
npx wrangler d1 execute rmpg-flex --local --command "SELECT sql FROM sqlite_master WHERE name='crypto_key_events'"
```
Expected: prints the `CREATE TABLE` statement from Step 1, confirming the migration applied and
the schema matches.

- [ ] **Step 4: Commit**

```bash
git add migrations/0192_crypto_key_events.sql
git commit -m "feat(db): add crypto_key_events audit table (migration 0192)"
```

---

### Task 2: `logCryptoKeyEvent` — automatic first-observation write

**Files:**
- Modify: `src/utils/pdfSign.ts`
- Test: `tests/pdfSign.test.ts`

**Interfaces:**
- Consumes: `crypto_key_events` table (Task 1).
- Produces: `getSigningKeys(env: Bindings, ctx?: ExecCtx)` — grows an optional 2nd parameter.
  Internal `logCryptoKeyEvent(db: D1Database, keyId: string, ctx?: ExecCtx): Promise<void>`
  (not exported — Task 3 exercises it indirectly through `signTriple()`, which is the public API).

- [ ] **Step 1: Write the failing tests**

Add to `tests/pdfSign.test.ts`:

```ts
describe('logCryptoKeyEvent (via signTriple cache-miss)', () => {
  function makeMockDb() {
    const run = vi.fn(async () => ({ success: true }));
    const bind = vi.fn(() => ({ run }));
    const prepare = vi.fn(() => ({ bind }));
    return { prepare, bind, run };
  }

  it('logs a crypto_key_events INSERT OR IGNORE on the first call for a new secret', async () => {
    const mockDb = makeMockDb();
    const env = { JWT_SECRET: 'audit-test-secret-1', DB: mockDb } as unknown as Bindings;
    await signTriple(env, 'x', 'y', 'a'.repeat(64));
    expect(mockDb.prepare).toHaveBeenCalledTimes(1);
    expect(mockDb.prepare.mock.calls[0][0]).toContain('INSERT OR IGNORE INTO crypto_key_events');
    expect(mockDb.bind).toHaveBeenCalledWith(
      expect.any(String),
      'pdf-sig-v2',
      JSON.stringify(['Ed25519', 'ML-DSA-87', 'SLH-DSA-256f']),
    );
    expect(mockDb.run).toHaveBeenCalledTimes(1);
  });

  it('does NOT log again on a second signTriple call with the same secret (cache-hit)', async () => {
    const mockDb = makeMockDb();
    const env = { JWT_SECRET: 'audit-test-secret-2', DB: mockDb } as unknown as Bindings;
    await signTriple(env, 'x', 'y', 'a'.repeat(64));
    await signTriple(env, 'x', 'y', 'b'.repeat(64));
    expect(mockDb.prepare).toHaveBeenCalledTimes(1);
  });

  it('swallows a D1 failure without throwing or failing the signing call', async () => {
    const failingDb = {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({ run: vi.fn(async () => { throw new Error('D1 down'); }) })),
      })),
    };
    const env = { JWT_SECRET: 'audit-test-secret-3', DB: failingDb } as unknown as Bindings;
    const result = await signTriple(env, 'x', 'y', 'a'.repeat(64));
    expect(result.ed25519.signature).toBeTruthy();
  });

  it('waitUntil-wraps the audit write when a ctx is provided', async () => {
    const mockDb = makeMockDb();
    const waitUntil = vi.fn();
    const env = { JWT_SECRET: 'audit-test-secret-4', DB: mockDb } as unknown as Bindings;
    await signTriple(env, 'x', 'y', 'a'.repeat(64), { waitUntil });
    expect(waitUntil).toHaveBeenCalledTimes(1);
  });

  it('runs without a DB binding at all (existing tests with no DB in their env stub must keep passing)', async () => {
    const env = { JWT_SECRET: 'audit-test-secret-5' } as unknown as Bindings;
    const result = await signTriple(env, 'x', 'y', 'a'.repeat(64));
    expect(result.ed25519.signature).toBeTruthy();
  });
});
```

Add `vi` to the existing `import { describe, it, expect } from 'vitest';` line at the top of the
file, making it `import { describe, it, expect, vi } from 'vitest';`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/pdfSign.test.ts`
Expected: FAIL — `signTriple` doesn't accept a 5th `ctx` parameter yet, and no D1 write happens.

- [ ] **Step 3: Implement**

In `src/utils/pdfSign.ts`, add after the existing `base64UrlToBytes` function (before
`deriveHkdfSeed`):

```ts
// Minimal shape (not the full @cloudflare/workers-types ExecutionContext) —
// avoids a generic-param mismatch, mirrors src/utils/logger.ts's logErrorToDb.
interface ExecCtx {
  waitUntil(p: Promise<unknown>): void;
}

const ALGORITHM_VERSION = 'pdf-sig-v2';
const SIGNING_ALGORITHMS = ['Ed25519', 'ML-DSA-87', 'SLH-DSA-256f'];

/** Log the first time a given signing key set is observed, to
 *  crypto_key_events — an automatic audit trail of when the key changed.
 *  INSERT OR IGNORE (key_id UNIQUE) makes this race-safe under concurrent
 *  isolate cold-starts. Never throws — a missing table or D1 outage must
 *  never block or fail an actual signing request. Mirrors
 *  src/utils/logger.ts's logErrorToDb() exactly. */
async function logCryptoKeyEvent(db: D1Database, keyId: string, ctx?: ExecCtx): Promise<void> {
  const work = (async () => {
    try {
      await db.prepare(
        'INSERT OR IGNORE INTO crypto_key_events (key_id, algorithm_version, algorithms) VALUES (?, ?, ?)',
      ).bind(keyId, ALGORITHM_VERSION, JSON.stringify(SIGNING_ALGORITHMS)).run();
    } catch {
      // Table may not exist yet (migration not applied), or a D1 hiccup —
      // audit logging must never block or fail an actual signing request.
    }
  })();
  if (ctx) {
    ctx.waitUntil(work);
  } else {
    void work;
  }
}
```

Change `getSigningKeys`'s signature and cache-miss branch:

```ts
async function getSigningKeys(env: Bindings, ctx?: ExecCtx): Promise<{
  ed25519Key: CryptoKey; keyId: string; ed25519PublicKey: Uint8Array;
  mlDsaPublicKey: Uint8Array; mlDsaSecretKey: Uint8Array;
  slhDsaPublicKey: Uint8Array; slhDsaSecretKey: Uint8Array;
}> {
```

(only the parameter list changes — add `, ctx?: ExecCtx` — the body up through the cache-hit
`return` is otherwise unchanged). Then, immediately before the final `return { ...cachedKeys,
keyId };` at the end of the function (after the `cachedKeys = { ... };` assignment), add:

```ts
  logCryptoKeyEvent(env.DB, keyId, ctx);
```

- [ ] **Step 4: Thread `ctx` through `signTriple`'s call to `getSigningKeys`**

Change `signTriple`'s first line from `const keys = await getSigningKeys(env);` to
`const keys = await getSigningKeys(env, ctx);` — this requires `signTriple` itself to accept
`ctx` as a parameter, which Task 3 adds formally to its public signature. For THIS task only,
temporarily add a bare `ctx?: ExecCtx` 5th parameter to `signTriple`'s existing signature line
(without yet adding `algorithmVersion` to its return value — that's Task 3):

```ts
export async function signTriple(
  env: Bindings, formKey: string, caseNumber: string, payloadHash: string, ctx?: ExecCtx,
): Promise<PdfSignTripleResult> {
  const keys = await getSigningKeys(env, ctx);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/pdfSign.test.ts`
Expected: PASS (all tests, including the 5 new ones and every pre-existing test — the pre-existing
tests have no `DB` in their env stubs, and per the "runs without a DB binding at all" test above,
that's fine: `logCryptoKeyEvent` throws synchronously on `undefined.prepare(...)`, which its own
`try/catch` swallows).

- [ ] **Step 6: Commit**

```bash
git add src/utils/pdfSign.ts tests/pdfSign.test.ts
git commit -m "feat(pdf-sign): log crypto_key_events on first observation of a new key"
```

---

### Task 3: `algorithmVersion` on `PdfSignTripleResult`

**Files:**
- Modify: `src/utils/pdfSign.ts`
- Test: `tests/pdfSign.test.ts`

**Interfaces:**
- Produces: `PdfSignTripleResult` gains `algorithmVersion: 'pdf-sig-v2';`. `signTriple()`'s return
  object includes it. This is what Task 5 (`pdfIntegrity.ts`) parses from the HTTP response.

- [ ] **Step 1: Extend the existing failing test**

In `tests/pdfSign.test.ts`, find the `signTriple` describe block's
`'produces three independently-verifiable signatures over the same message'` test. Add this
assertion right after the existing `expect(result.keyId).toMatch(/^[0-9a-f]{16}$/);` line:

```ts
    expect(result.algorithmVersion).toBe('pdf-sig-v2');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/pdfSign.test.ts`
Expected: FAIL — `result.algorithmVersion` is `undefined`.

- [ ] **Step 3: Implement**

In `src/utils/pdfSign.ts`, add `algorithmVersion` to the `PdfSignTripleResult` interface:

```ts
export interface PdfSignTripleResult {
  algorithmVersion: 'pdf-sig-v2';
  signedAt: string;
  keyId: string;
  ed25519: AlgorithmSignature;
  mlDsa87: AlgorithmSignature;
  slhDsa256f: AlgorithmSignature;
}
```

And add it to `signTriple()`'s return object:

```ts
  return {
    algorithmVersion: ALGORITHM_VERSION,
    signedAt: new Date().toISOString(), // new-date-ok
    keyId: keys.keyId,
    ed25519: { signature: bytesToBase64(new Uint8Array(ed25519SigBuf)), publicKey: bytesToBase64(keys.ed25519PublicKey) },
    mlDsa87: { signature: bytesToBase64(mlDsaSig), publicKey: bytesToBase64(keys.mlDsaPublicKey) },
    slhDsa256f: { signature: bytesToBase64(slhDsaSig), publicKey: bytesToBase64(keys.slhDsaPublicKey) },
  };
```

(Reuses the `ALGORITHM_VERSION` constant Task 2 already defined — do not re-type the literal
string a second time.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/pdfSign.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/pdfSign.ts tests/pdfSign.test.ts
git commit -m "feat(pdf-sign): tag signed bundles with algorithmVersion 'pdf-sig-v2'"
```

---

### Task 4: Route call sites pass `c.executionCtx`

**Files:**
- Modify: `src/routes/pdfTools.ts`
- Modify: `src/routes/flexcam.ts`

**Interfaces:**
- Consumes: `signTriple`'s `ctx` parameter (Task 2).

- [ ] **Step 1: Implement**

In `src/routes/pdfTools.ts`, change:
```ts
    const signed = await signTriple(c.env, formKey, caseNumber, payloadHash);
```
to:
```ts
    const signed = await signTriple(c.env, formKey, caseNumber, payloadHash, c.executionCtx);
```

In `src/routes/flexcam.ts`, change:
```ts
  const signed = await signTriple(c.env, `flexcam:${req.evidence_number ?? id}`, caseRef ? `${caseRef.entity_type}:${caseRef.entity_id}` : '', payloadHash);
```
to:
```ts
  const signed = await signTriple(c.env, `flexcam:${req.evidence_number ?? id}`, caseRef ? `${caseRef.entity_type}:${caseRef.entity_id}` : '', payloadHash, c.executionCtx);
```

- [ ] **Step 2: Verify the Worker typechecks and tests pass**

Run: `npm run typecheck`
Expected: PASS.

Run: `npm test`
Expected: PASS (all tests, including `tests/pdfSign.test.ts`).

- [ ] **Step 3: Commit**

```bash
git add src/routes/pdfTools.ts src/routes/flexcam.ts
git commit -m "feat(pdf-tools,flexcam): waitUntil-wrap the crypto_key_events audit write"
```

---

### Task 5: `algorithmVersion` on client `PdfSignatureBundle`

**Files:**
- Modify: `client/src/utils/pdfIntegrity.ts`
- Modify: `client/src/utils/__tests__/pdfIntegrity.test.ts`

**Interfaces:**
- Produces: `PdfSignatureBundle` gains `algorithmVersion: 'pdf-sig-v2';`. This is what Task 7
  (`v2DispatchAdapter.ts`) reads via `signResp.algorithmVersion`.

- [ ] **Step 1: Update the failing tests**

In `client/src/utils/__tests__/pdfIntegrity.test.ts`, update the `'signature round-trips'` test's
bundle literal to add `algorithmVersion: 'pdf-sig-v2' as const,` as its first property:

```ts
  it('signature round-trips', () => {
    const bundle = {
      algorithmVersion: 'pdf-sig-v2' as const,
      signedAt: '2026-04-01T00:00:00Z',
      keyId: 'abcd1234',
      ed25519: { signature: 'edSigB64', publicKey: 'edPubB64' },
      mlDsa87: { signature: 'mlSigB64', publicKey: 'mlPubB64' },
      slhDsa256f: { signature: 'slhSigB64', publicKey: 'slhPubB64' },
    };
    setActiveSignature(bundle);
    expect(getActiveSignature()).toEqual(bundle);
    clearActiveSignature();
    expect(getActiveSignature()).toBeUndefined();
  });
```

Update the `'parses a 200 response into a PdfSignatureBundle'` test's `serverBody` and expected
result to include `algorithmVersion`:

```ts
  it('parses a 200 response into a PdfSignatureBundle', async () => {
    const serverBody = {
      algorithmVersion: 'pdf-sig-v2',
      signedAt: '2026-04-01T00:00:00Z',
      keyId: 'abcd1234',
      ed25519: { signature: 'edSigB64', publicKey: 'edPubB64' },
      mlDsa87: { signature: 'mlSigB64', publicKey: 'mlPubB64' },
      slhDsa256f: { signature: 'slhSigB64', publicKey: 'slhPubB64' },
      formKey: 'incident', caseNumber: 'INC-1', payloadHash: 'a'.repeat(64),
    };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify(serverBody),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )));
    const result = await fetchPdfSignature('incident', 'INC-1', 'a'.repeat(64));
    expect(result).toEqual({
      algorithmVersion: serverBody.algorithmVersion,
      signedAt: serverBody.signedAt,
      keyId: serverBody.keyId,
      ed25519: serverBody.ed25519,
      mlDsa87: serverBody.mlDsa87,
      slhDsa256f: serverBody.slhDsa256f,
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd client && npx vitest run src/utils/__tests__/pdfIntegrity.test.ts`
Expected: FAIL — `PdfSignatureBundle` doesn't have `algorithmVersion` yet, so the `as const`
literal doesn't structurally match, and `fetchPdfSignature`'s constructed object won't include it.

- [ ] **Step 3: Implement**

In `client/src/utils/pdfIntegrity.ts`, add `algorithmVersion` to the `PdfSignatureBundle`
interface:

```ts
export interface PdfSignatureBundle {
  algorithmVersion: 'pdf-sig-v2';
  signedAt: string;
  keyId: string;
  ed25519: AlgorithmSignature;
  mlDsa87: AlgorithmSignature;
  slhDsa256f: AlgorithmSignature;
}
```

And add it to `fetchPdfSignature()`'s return construction:

```ts
    return {
      algorithmVersion: json.algorithmVersion,
      signedAt: json.signedAt,
      keyId: json.keyId,
      ed25519: json.ed25519,
      mlDsa87: json.mlDsa87,
      slhDsa256f: json.slhDsa256f,
    };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd client && npx vitest run src/utils/__tests__/pdfIntegrity.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add client/src/utils/pdfIntegrity.ts client/src/utils/__tests__/pdfIntegrity.test.ts
git commit -m "feat(pdf-integrity): PdfSignatureBundle carries algorithmVersion"
```

---

### Task 6: `algorithmVersion` on `SidecarSignature`

**Files:**
- Modify: `client/src/utils/pdf/v2/engine/sidecar.ts`

**Interfaces:**
- Produces: `SidecarSignature` gains `algorithmVersion: 'pdf-sig-v2';`. This is what Task 7
  constructs and embeds into the PDF sidecar.

- [ ] **Step 1: Implement**

In `client/src/utils/pdf/v2/engine/sidecar.ts`, add `algorithmVersion` to the `SidecarSignature`
interface:

```ts
export interface SidecarSignature {
  algorithmVersion: 'pdf-sig-v2';
  ed25519: { signature: string; publicKey: string };
  mlDsa87: { signature: string; publicKey: string };
  slhDsa256f: { signature: string; publicKey: string };
  signedAt: string;
  payloadHash: string;
}
```

- [ ] **Step 2: Run existing sidecar tests to confirm nothing broke**

Run: `cd client && npx vitest run "src/utils/pdf/v2/engine/__tests__/sidecar.test.ts" "src/utils/pdf/v2/engine/__tests__/multiCopy.sidecar.test.ts"`
Expected: PASS — this is a type-only change; these tests don't construct `SidecarSignature`
literals directly (confirmed during the prior triple-algorithm-signing plan).

- [ ] **Step 3: Commit**

```bash
git add client/src/utils/pdf/v2/engine/sidecar.ts
git commit -m "feat(sidecar): SidecarSignature carries algorithmVersion"
```

---

### Task 7: Thread `algorithmVersion` through `v2DispatchAdapter.ts`

**Files:**
- Modify: `client/src/utils/pdf/v2DispatchAdapter.ts`

**Interfaces:**
- Consumes: `PdfSignatureBundle.algorithmVersion` (Task 5), `SidecarSignature.algorithmVersion`
  (Task 6).

- [ ] **Step 1: Implement**

In `client/src/utils/pdf/v2DispatchAdapter.ts`, find `prepareCitationDispatch()`'s
`sidecarOptions` construction:

```ts
  const sidecarOptions = {
    schemaId: 'citation',
    caseNumber,
    signature: signResp
      ? {
          ed25519: signResp.ed25519,
          mlDsa87: signResp.mlDsa87,
          slhDsa256f: signResp.slhDsa256f,
          signedAt: signResp.signedAt,
          payloadHash: hash,
        }
      : undefined,
  };
```

Add `algorithmVersion: signResp.algorithmVersion,` as the first property inside the `signResp ? {
... }` object:

```ts
  const sidecarOptions = {
    schemaId: 'citation',
    caseNumber,
    signature: signResp
      ? {
          algorithmVersion: signResp.algorithmVersion,
          ed25519: signResp.ed25519,
          mlDsa87: signResp.mlDsa87,
          slhDsa256f: signResp.slhDsa256f,
          signedAt: signResp.signedAt,
          payloadHash: hash,
        }
      : undefined,
  };
```

- [ ] **Step 2: Verify the client typechecks**

Run: `cd client && npx tsc --noEmit`
Expected: PASS (this command is slow — 2+ minutes, may get auto-backgrounded by the harness; wait
for it, don't treat it as stuck).

- [ ] **Step 3: Commit**

```bash
git add client/src/utils/pdf/v2DispatchAdapter.ts
git commit -m "feat(v2-dispatch): thread algorithmVersion into sidecar construction"
```

---

### Task 8: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Worker typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 2: Worker test suite**

Run: `npm test`
Expected: PASS, including all `tests/pdfSign.test.ts` cases (the new `logCryptoKeyEvent` tests and
the extended `algorithmVersion` assertion).

- [ ] **Step 3: Client typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Client test suite**

Run: `cd client && npx vitest run`
Expected: PASS, including the updated `pdfIntegrity.test.ts` and unchanged `sidecar.test.ts`.

- [ ] **Step 5: Client build**

Run: `cd client && npx vite build`
Expected: PASS.

- [ ] **Step 6: Confirm the migration is present and correctly numbered**

Run: `ls migrations/ | grep -E "^019[0-9]" | sort`
Expected: `0192_crypto_key_events.sql` appears, and no other file already claims `0192`.

- [ ] **Step 7: Confirm no other consumer of `PdfSignatureBundle`/`SidecarSignature` was missed**

Run:
```bash
grep -rn "PdfSignatureBundle\|SidecarSignature" client/src --include="*.ts" --include="*.tsx" | grep -v __tests__ | grep -v node_modules
```
Expected: every match is inside `pdfIntegrity.ts`, `pdfGenerator.ts` (the dormant trailer — reads
the type but doesn't construct a literal, so it needs no change), `sidecar.ts`, or
`v2DispatchAdapter.ts`. If a new, unhandled consumer turns up, add a task to update it before
merging.

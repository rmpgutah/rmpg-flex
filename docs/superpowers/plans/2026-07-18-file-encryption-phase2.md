# File Encryption at Rest — Phase 2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire every remaining whole-buffer `UPLOADS` R2 prefix (9 prefixes across 12 route files + 1 Durable Object) to the envelope-encryption primitives shipped in Phase 1 (`src/utils/encryptedR2.ts`), so every whole-buffer object in the bucket is AES-GCM encrypted at rest.

**Architecture:** Each task swaps a route's/DO's raw `bucket.put()`/`bucket.get()`/`bucket.delete()` calls for `putEncrypted()`/`getDecrypted()`/`deleteEncryptionKey()` from the already-shipped `src/utils/encryptedR2.ts`. No changes to that primitive or to the `file_encryption_keys` schema — this is call-site wiring only, plus one small new pure helper (byte-range slicing for `radio-audio/`'s HTTP Range support) and one pre-existing-gap fix (`uploads.ts`'s oversized 500 MB cap).

**Tech Stack:** Cloudflare Workers, Hono, D1, R2, Durable Objects, Vitest (`@cloudflare/vitest-pool-workers` Miniflare pool for route/DO-adjacent tests, plain node vitest for pure functions).

## Global Constraints

- Reuse `src/utils/encryptedR2.ts` exactly as shipped in Phase 1 — do not modify its exports:
  `putEncrypted(bucket: R2Bucket, db: D1Database, kekB64: string | undefined, key: string, bytes: ArrayBuffer | Uint8Array, opts?: { httpMetadata?: R2HTTPMetadata }): Promise<void>`,
  `getDecrypted(bucket: R2Bucket, db: D1Database, kekB64: string | undefined, key: string): Promise<{ bytes: Uint8Array; httpMetadata?: R2HTTPMetadata } | null>`,
  `deleteEncryptionKey(db: D1Database, key: string): Promise<void>`,
  `FileEncryptionError` (thrown, not caught-and-swallowed, on misconfiguration — fail CLOSED).
- No new D1 migration. `file_encryption_keys` (from `migrations/0194_file_encryption_keys.sql`) is already generic across `r2_key`.
- `FILE_ENCRYPTION_KEK` is already provisioned as a live Worker secret (Phase 1) and already declared on `src/types.ts`'s `Bindings` interface (`FILE_ENCRYPTION_KEK?: string;`) — every `c.env.FILE_ENCRYPTION_KEK` reference in a route "just works" with no further binding setup. `VoiceHubDO.ts` is the one exception (Durable Objects declare their own narrower env interface) — Task 2 adds the field there.
- Every `db` argument passed to `putEncrypted`/`getDecrypted`/`deleteEncryptionKey` is obtained via `getDb(c.env)` (routes) or `getDb(this.env as any)` (`VoiceHubDO.ts`, matching its existing pattern at `VoiceHubDO.ts:294`) — never construct D1 access any other way.
- Streaming/chunked/multipart prefixes (`flexcam/trips/`, `dashcam/`, `dashcam-videos/`, `bodycam-videos/`, `flexcam/events/`) are OUT OF SCOPE for this plan — do not touch `captureOrchestrator.ts`, `concat.ts`, `footageAlpr.ts`, `flexcam.ts`, `clearpathSync.ts`, `fleet.ts`, `clearpathgps.ts`, `bodyCameraUploads.ts`, `bodyCameras.ts`, or `drivingEvents.ts`.
- `panic-audio/` (Task 2) and `alpr/vehicles/{id}/{field}.jpg` crop uploads (part of Task 6) and `work-order-attachments/` (Task 12) get their WRITE path encrypted only — none of the three has a working reader route today, and building one is explicitly out of scope (per the approved design doc).
- `citations/`, `interactions/` (`intel.ts`), `nsopw-photos/`, `alpr-captures/`, `vehicle-inspections/`, `radio-audio/`, and `work-order-attachments/` have NO R2-deleting route today — do not add `deleteEncryptionKey` wiring for these; leave the pre-existing orphan-on-delete gap untouched. Only `redactions/`, `attachments/`, `business-photos/`, and `property-photos/` get paired `deleteEncryptionKey` calls (each already has a working `bucket.delete()` call site).
- `uploads.ts`'s `MAX_FILE_SIZE` drops from `500 * 1024 * 1024` to `100 * 1024 * 1024` (Task 9) to keep peak encrypt-time memory safe.

---

### Task 1: Shared Miniflare test helper for file-encryption tests

**Files:**
- Create: `test-workers/helpers/fileEncryptionTestSchema.ts`
- Test: `test-workers/helpers/fileEncryptionTestSchema.test.ts`

**Interfaces:**
- Produces: `TEST_KEK: string` (a deterministic base64 32-byte key), `envWithKek(env: Record<string, unknown>): Record<string, unknown>` (spreads `env` and adds `FILE_ENCRYPTION_KEK: TEST_KEK`), `ensureFileEncryptionKeysTable(db: D1Database): Promise<void>` (creates the `file_encryption_keys` table if missing — the Miniflare D1 pool starts empty with no migrations applied). Every later task's test imports these three from this file instead of re-declaring them.

- [ ] **Step 1: Write the failing test**

```typescript
// test-workers/helpers/fileEncryptionTestSchema.test.ts
import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { TEST_KEK, envWithKek, ensureFileEncryptionKeysTable } from './fileEncryptionTestSchema';

describe('fileEncryptionTestSchema helper', () => {
  it('TEST_KEK decodes to exactly 32 bytes', () => {
    const bin = atob(TEST_KEK);
    expect(bin.length).toBe(32);
  });

  it('envWithKek adds FILE_ENCRYPTION_KEK without mutating the input', () => {
    const base = { DB: 'placeholder' } as unknown as Record<string, unknown>;
    const withKek = envWithKek(base);
    expect(withKek.FILE_ENCRYPTION_KEK).toBe(TEST_KEK);
    expect(base.FILE_ENCRYPTION_KEK).toBeUndefined();
  });

  it('ensureFileEncryptionKeysTable creates a queryable table', async () => {
    await ensureFileEncryptionKeysTable(env.DB as unknown as D1Database);
    const row = await (env.DB as unknown as D1Database)
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='file_encryption_keys'")
      .first<{ name: string }>();
    expect(row?.name).toBe('file_encryption_keys');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:worker -- test-workers/helpers/fileEncryptionTestSchema.test.ts`
Expected: FAIL — `Cannot find module './fileEncryptionTestSchema'`

- [ ] **Step 3: Create the helper**

```typescript
// test-workers/helpers/fileEncryptionTestSchema.ts
// Shared by every test-workers/*.test.ts that exercises a route wired to
// src/utils/encryptedR2.ts. The Miniflare D1 pool starts empty (no
// migrations/*.sql applied) — ensureFileEncryptionKeysTable mirrors
// migrations/0194_file_encryption_keys.sql so putEncrypted/getDecrypted have
// somewhere to read/write wrapped keys, matching the pattern established in
// test-workers/fieldPhotosEncryption.test.ts (Phase 1).
import type { D1Database } from '@cloudflare/workers-types';

export const TEST_KEK = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i)));

export function envWithKek(env: Record<string, unknown>): Record<string, unknown> {
  return { ...env, FILE_ENCRYPTION_KEK: TEST_KEK };
}

export async function ensureFileEncryptionKeysTable(db: D1Database): Promise<void> {
  await db.prepare(`CREATE TABLE IF NOT EXISTS file_encryption_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    r2_key TEXT NOT NULL UNIQUE,
    wrapped_dek TEXT NOT NULL,
    dek_iv TEXT NOT NULL,
    file_iv TEXT NOT NULL,
    algorithm_version TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`).run();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:worker -- test-workers/helpers/fileEncryptionTestSchema.test.ts`
Expected: PASS (3/3)

- [ ] **Step 5: Commit**

```bash
git add test-workers/helpers/fileEncryptionTestSchema.ts test-workers/helpers/fileEncryptionTestSchema.test.ts
git commit -m "test(file-encryption): add shared Miniflare test helper for Phase 2 tasks"
```

---

### Task 2: VoiceHubDO.ts — encrypt `radio-audio/` and `panic-audio/` writes

**Files:**
- Modify: `src/durable-objects/VoiceHubDO.ts:51-60` (interface `VoiceEnv`), `:317` (radio write), `:358` (panic write), `:644` (AI dispatcher radio write)

**Interfaces:**
- Consumes: `putEncrypted` from `src/utils/encryptedR2.ts` (Task 1's Global Constraints signature); `getDb` from `../utils/db` (already imported in this file, confirmed via its existing `getDb(this.env as any)` calls at lines 198/294/384).
- Produces: nothing new consumed by later tasks (radio-audio/panic-audio have no other writer).

There is no existing automated test harness for `VoiceHubDO`'s WebSocket-driven transmission flow (it isn't mounted in `test-workers/entry.ts`, and building one is a Durable-Object-testing-infrastructure project of its own, out of scope here). This task is verified by (a) `npm run typecheck` catching any signature mismatch, and (b) the manual smoke test in Task 14's Verification section. No new automated test file for this task.

- [ ] **Step 1: Add `FILE_ENCRYPTION_KEK` to `VoiceEnv`**

In `src/durable-objects/VoiceHubDO.ts`, change:

```typescript
interface VoiceEnv {
  DB: D1Database;
  UPLOADS: R2Bucket;
  KV: KVNamespace;
  JWT_SECRET: string;
  // Workers AI — powers the AI dispatcher (Whisper transcription,
  // Llama 4 Scout reasoning + data-entry + OCR, Aura-2 reply synthesis).
  // See src/utils/aiDispatcher.ts.
  AI: Ai;
}
```

to:

```typescript
interface VoiceEnv {
  DB: D1Database;
  UPLOADS: R2Bucket;
  KV: KVNamespace;
  JWT_SECRET: string;
  // Workers AI — powers the AI dispatcher (Whisper transcription,
  // Llama 4 Scout reasoning + data-entry + OCR, Aura-2 reply synthesis).
  // See src/utils/aiDispatcher.ts.
  AI: Ai;
  // Envelope-encryption master key for radio-audio/ and panic-audio/ writes.
  // See src/utils/encryptedR2.ts.
  FILE_ENCRYPTION_KEK?: string;
}
```

- [ ] **Step 2: Add the import**

At the top of `src/durable-objects/VoiceHubDO.ts`, alongside the existing imports (near the `radioSettings`/`aiDispatcher` imports around line 48):

```typescript
import { putEncrypted } from '../utils/encryptedR2';
```

- [ ] **Step 3: Encrypt the radio-transmission write (line 317)**

Change:

```typescript
      if (settings.auto_record) {
        const key = `radio-audio/${id}.webm`;
        await this.env.UPLOADS.put(key, blob, { httpMetadata: { contentType: 'audio/webm' } });
```

to:

```typescript
      if (settings.auto_record) {
        const key = `radio-audio/${id}.webm`;
        await putEncrypted(this.env.UPLOADS, db, this.env.FILE_ENCRYPTION_KEK, key, blob, { httpMetadata: { contentType: 'audio/webm' } });
```

(`db` is already in scope in this method — `const db = getDb(this.env as any);` at line 294.)

- [ ] **Step 4: Encrypt the panic-audio write (line 358)**

Change:

```typescript
      const key = `panic-audio/${this.refId}.webm`;
      await this.env.UPLOADS.put(key, blob, { httpMetadata: { contentType: 'audio/webm' } });
```

to:

```typescript
      const key = `panic-audio/${this.refId}.webm`;
      await putEncrypted(this.env.UPLOADS, db, this.env.FILE_ENCRYPTION_KEK, key, blob, { httpMetadata: { contentType: 'audio/webm' } });
```

(same method as Step 3 — `db` already in scope.)

- [ ] **Step 5: Encrypt the AI-dispatcher reply write (line 644)**

Change:

```typescript
      await this.env.UPLOADS.put(`radio-audio/${dispId}.webm`, audioBytes, {
        httpMetadata: { contentType: 'audio/mpeg' },
      }).catch((e) => console.warn('[VoiceHubDO] dispatch audio R2 put failed:', (e as Error)?.message));
```

to:

```typescript
      await putEncrypted(this.env.UPLOADS, db, this.env.FILE_ENCRYPTION_KEK, `radio-audio/${dispId}.webm`, audioBytes, {
        httpMetadata: { contentType: 'audio/mpeg' },
      }).catch((e) => console.warn('[VoiceHubDO] dispatch audio R2 put failed:', (e as Error)?.message));
```

(`db` is already in scope in this method — `const db = getDb(this.env as any);` at line 384. Note this call site is already wrapped in `.catch()` for best-effort broadcast-must-not-block semantics — preserved as-is; a `FileEncryptionError` here is swallowed by the same `.catch()` that already tolerates R2 failures, consistent with this call site's existing "the live audio still plays even if replay-by-URL 404s" contract.)

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: PASS, no errors in `VoiceHubDO.ts`

- [ ] **Step 7: Commit**

```bash
git add src/durable-objects/VoiceHubDO.ts
git commit -m "feat(voice-hub): encrypt radio-audio/ and panic-audio/ writes at rest"
```

---

### Task 3: radio.ts — decrypt `radio-audio/` reads, preserve Range/seek support

**Files:**
- Create: `src/utils/byteRange.ts`
- Modify: `src/routes/radio.ts:214-265` (`GET /transmissions/:id/audio`)
- Test: `tests/byteRange.test.ts`

**Interfaces:**
- Consumes: `getDecrypted` from `src/utils/encryptedR2.ts`.
- Produces: `sliceByteRange(bytes: Uint8Array, range: { start: number; end: number } | null): { data: Uint8Array; start: number; end: number; total: number }` — a pure function extracted so the Range-serving logic is unit-testable without Miniflare. `end` in the input is inclusive and may be `-1` meaning "to the end of the buffer" (mirrors `radio.ts`'s existing `rangeEnd = -1` sentinel).

AES-GCM ciphertext can't be range-fetched from R2 directly (the auth tag covers the whole ciphertext) — the fix is to always fetch+decrypt the full object via `getDecrypted`, then slice the requested byte range out of the resulting plaintext in memory. Per-transmission clips are small (seconds of audio), so this is a safe trade — see the approved Phase 2 design doc's "Range-read handling for radio-audio/" section.

- [ ] **Step 1: Write the failing test for the pure slice helper**

```typescript
// tests/byteRange.test.ts
import { describe, it, expect } from 'vitest';
import { sliceByteRange } from '../src/utils/byteRange';

describe('sliceByteRange', () => {
  const bytes = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]); // 10 bytes, total=10

  it('returns the full buffer when range is null', () => {
    const r = sliceByteRange(bytes, null);
    expect(Array.from(r.data)).toEqual(Array.from(bytes));
    expect(r.start).toBe(0);
    expect(r.end).toBe(9);
    expect(r.total).toBe(10);
  });

  it('slices a bounded range (bytes=2-4)', () => {
    const r = sliceByteRange(bytes, { start: 2, end: 4 });
    expect(Array.from(r.data)).toEqual([2, 3, 4]);
    expect(r.start).toBe(2);
    expect(r.end).toBe(4);
    expect(r.total).toBe(10);
  });

  it('slices an open-ended range (bytes=7-, end=-1 sentinel)', () => {
    const r = sliceByteRange(bytes, { start: 7, end: -1 });
    expect(Array.from(r.data)).toEqual([7, 8, 9]);
    expect(r.start).toBe(7);
    expect(r.end).toBe(9);
    expect(r.total).toBe(10);
  });

  it('clamps an end past the buffer length to the last valid byte', () => {
    const r = sliceByteRange(bytes, { start: 5, end: 999 });
    expect(Array.from(r.data)).toEqual([5, 6, 7, 8, 9]);
    expect(r.end).toBe(9);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/byteRange.test.ts`
Expected: FAIL — `Cannot find module '../src/utils/byteRange'`

- [ ] **Step 3: Implement the pure helper**

```typescript
// src/utils/byteRange.ts
// Serves an HTTP Range request out of an in-memory plaintext buffer. Used by
// routes that decrypt a whole object (via encryptedR2.ts's getDecrypted)
// before it can be range-served — AES-GCM ciphertext can't be range-fetched
// from R2 directly since the auth tag covers the whole ciphertext.
export function sliceByteRange(
  bytes: Uint8Array,
  range: { start: number; end: number } | null,
): { data: Uint8Array; start: number; end: number; total: number } {
  const total = bytes.length;
  if (!range) {
    return { data: bytes, start: 0, end: total - 1, total };
  }
  const start = Math.max(0, range.start);
  const end = range.end < 0 ? total - 1 : Math.min(range.end, total - 1);
  return { data: bytes.slice(start, end + 1), start, end, total };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/byteRange.test.ts`
Expected: PASS (4/4)

- [ ] **Step 5: Wire `radio.ts`'s read route to decrypt + slice**

In `src/routes/radio.ts`, add to the import block near the top (alongside the existing `verifySignedResource` import):

```typescript
import { getDecrypted } from '../utils/encryptedR2';
import { sliceByteRange } from '../utils/byteRange';
```

Change the body of `GET /transmissions/:id/audio` (currently `src/routes/radio.ts:246-264`):

```typescript
  const obj = r2Range
    ? await c.env.UPLOADS.get(key, { range: r2Range })
    : await c.env.UPLOADS.get(key);
  if (!obj) return c.json({ error: 'Recording not found' }, 404);

  const totalSize = obj.size;
  const headers: Record<string, string> = {
    'Content-Type': obj.httpMetadata?.contentType || 'audio/webm',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=31536000, immutable',
  };
  if (r2Range) {
    const start = rangeStart;
    const end = rangeEnd >= 0 ? Math.min(rangeEnd, totalSize - 1) : totalSize - 1;
    headers['Content-Range'] = `bytes ${start}-${end}/${totalSize}`;
    headers['Content-Length'] = String(end - start + 1);
    return new Response(obj.body, { status: 206, headers });
  }
  headers['Content-Length'] = String(totalSize);
```

to:

```typescript
  const decrypted = await getDecrypted(c.env.UPLOADS, getDb(c.env), c.env.FILE_ENCRYPTION_KEK, key);
  if (!decrypted) return c.json({ error: 'Recording not found' }, 404);

  const sliced = sliceByteRange(decrypted.bytes, rangeHeader ? { start: rangeStart, end: rangeEnd } : null);
  const headers: Record<string, string> = {
    'Content-Type': decrypted.httpMetadata?.contentType || 'audio/webm',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=31536000, immutable',
  };
  if (rangeHeader) {
    headers['Content-Range'] = `bytes ${sliced.start}-${sliced.end}/${sliced.total}`;
    headers['Content-Length'] = String(sliced.data.length);
    return new Response(sliced.data, { status: 206, headers });
  }
  headers['Content-Length'] = String(sliced.data.length);
```

(The remaining lines below — `return new Response(obj.body, { headers });` for the non-range case, and the `r2Range`/`R2Range` variable declarations above this block at lines 233-244 — are unchanged; `rangeStart`/`rangeEnd` are still computed the same way from the `Range` header, they're just no longer passed to `c.env.UPLOADS.get`. Confirm `getDb` is imported in `radio.ts` — if not already present, add `import { getDb } from '../utils/db';` alongside the other imports.)

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/utils/byteRange.ts tests/byteRange.test.ts src/routes/radio.ts
git commit -m "feat(radio): decrypt radio-audio/ reads, serve HTTP Range from plaintext"
```

---

### Task 4: NSOPW offender photos — encrypt `nsopw-photos/` write + read

**Files:**
- Modify: `src/utils/nsopw/photoStore.ts:65-188` (`downloadAndStorePhoto`), `src/routes/nsopw.ts:184-205` (`GET /photo/:offenderRowId`)
- Test: `tests/nsopwPhotoStore.test.ts`

**Interfaces:**
- Consumes: `putEncrypted`, `getDecrypted` from `src/utils/encryptedR2.ts`.

`photoStore.ts` is a plain exported async function (not a Hono route), so its test uses mocked `R2Bucket`/`D1Database` objects directly — matching the style of `tests/encryptedR2.test.ts` — rather than Miniflare.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/nsopwPhotoStore.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { downloadAndStorePhoto } from '../src/utils/nsopw/photoStore';

const TEST_KEK = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i)));

function mockR2() {
  const store = new Map<string, { body: Uint8Array; httpMetadata?: any }>();
  return {
    store,
    put: vi.fn(async (key: string, bytes: any, opts?: any) => {
      store.set(key, { body: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), httpMetadata: opts?.httpMetadata });
    }),
  };
}

function mockD1() {
  const rows = new Map<string, any>();
  return {
    rows,
    prepare: (sql: string) => ({
      bind: (...args: any[]) => ({
        first: async () => {
          if (sql.includes('SELECT photo_fetched_at')) return null; // not stale-gated in this test
          if (sql.includes('SELECT wrapped_dek')) return rows.get(args[0]) ?? null;
          return null;
        },
        run: async () => {
          if (sql.includes('INSERT INTO file_encryption_keys')) {
            rows.set(args[0], { wrapped_dek: args[1], dek_iv: args[2], file_iv: args[3] });
          }
        },
      }),
    }),
  };
}

describe('downloadAndStorePhoto — encrypts nsopw-photos/ at rest', () => {
  const originalFetch = global.fetch;
  beforeEach(() => { global.fetch = originalFetch; });

  it('stores ciphertext in R2, not the original photo bytes', async () => {
    const photoBytes = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3, 4, 5]);
    global.fetch = vi.fn(async () => new Response(photoBytes, { headers: { 'content-type': 'image/jpeg' } })) as any;

    const uploads = mockR2();
    const db = mockD1();
    const env = { UPLOADS: uploads, FILE_ENCRYPTION_KEK: TEST_KEK } as any;

    const result = await downloadAndStorePhoto(env, db as any, 42, 'FL', 'ext-1', 'https://example.test/photo.jpg');

    expect(result.stored).toBe(true);
    expect(result.key).toMatch(/^nsopw-photos\/FL\//);
    const stored = uploads.store.get(result.key!);
    expect(stored).toBeDefined();
    expect(Array.from(stored!.body)).not.toEqual(Array.from(photoBytes));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/nsopwPhotoStore.test.ts`
Expected: FAIL — stored bytes equal the original plaintext (assertion `.not.toEqual` fails) because `photoStore.ts` still calls `uploads.put` directly

- [ ] **Step 3: Encrypt the write in `photoStore.ts`**

Add the import near the top of `src/utils/nsopw/photoStore.ts`:

```typescript
import { putEncrypted } from '../encryptedR2';
```

Change (currently lines 151-160):

```typescript
  // Best-effort R2 PUT.
  try {
    await uploads.put(key, bytes, {
      httpMetadata: { contentType: contentType || 'image/jpeg' },
      customMetadata: {
        nsopw_offender_id: offenderExtId,
        jurisdiction,
        offender_row: String(offenderRowId),
      },
    });
  } catch (err) {
```

to:

```typescript
  // Best-effort R2 PUT.
  try {
    await putEncrypted(uploads, db, (env as { FILE_ENCRYPTION_KEK?: string }).FILE_ENCRYPTION_KEK, key, bytes, {
      httpMetadata: { contentType: contentType || 'image/jpeg' },
    });
  } catch (err) {
```

(`customMetadata` is dropped — `putEncrypted`'s signature only accepts `httpMetadata` in `opts`, matching Phase 1's `field-photos/` precedent, which dropped the same field for the same reason. The `nsopw_offender_id`/`jurisdiction`/`offender_row` values this carried are already persisted on the `national_sex_offenders` row itself via the `UPDATE` a few lines below, so nothing is lost.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/nsopwPhotoStore.test.ts`
Expected: PASS (1/1)

- [ ] **Step 5: Decrypt the read in `nsopw.ts`**

In `src/routes/nsopw.ts`, add to the import block near the top:

```typescript
import { getDecrypted } from '../utils/encryptedR2';
```

Change (currently lines 196-204):

```typescript
  const obj = await c.env.UPLOADS.get(row.local_photo_key).catch(() => null);
  if (!obj) return c.json({ error: 'photo bytes missing' }, 404);
  return new Response(obj.body, {
    headers: {
      'content-type': row.photo_content_type || obj.httpMetadata?.contentType || 'image/jpeg',
      'cache-control': 'private, max-age=3600',
      'content-length': String(obj.size),
    },
  });
```

to:

```typescript
  const decrypted = await getDecrypted(c.env.UPLOADS, getDb(c.env), c.env.FILE_ENCRYPTION_KEK, row.local_photo_key).catch(() => null);
  if (!decrypted) return c.json({ error: 'photo bytes missing' }, 404);
  return new Response(decrypted.bytes, {
    headers: {
      'content-type': row.photo_content_type || decrypted.httpMetadata?.contentType || 'image/jpeg',
      'cache-control': 'private, max-age=3600',
      'content-length': String(decrypted.bytes.length),
    },
  });
```

(`getDb` is already imported in `nsopw.ts` — confirmed via its existing `getDb(c.env)` calls elsewhere in the file.)

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/utils/nsopw/photoStore.ts src/routes/nsopw.ts tests/nsopwPhotoStore.test.ts
git commit -m "feat(nsopw): encrypt offender-photo storage at rest"
```

---

### Task 5: redactions.ts — encrypt write, read, and delete

**Files:**
- Modify: `src/routes/redactions.ts` (write `:57-62`, delete-on-custody-failure `:90-93`, read `:115-124`)
- Test: `test-workers/redactionsEncryption.test.ts`

**Interfaces:**
- Consumes: `putEncrypted`, `getDecrypted`, `deleteEncryptionKey` from `src/utils/encryptedR2.ts`; `TEST_KEK`, `envWithKek`, `ensureFileEncryptionKeysTable` from `test-workers/helpers/fileEncryptionTestSchema.ts` (Task 1). `redactions` is already mounted at `/api/redactions` in `test-workers/entry.ts`.

- [ ] **Step 1: Write the failing test**

```typescript
// test-workers/redactionsEncryption.test.ts
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import app from './entry';
import { envWithKek, ensureFileEncryptionKeysTable } from './helpers/fileEncryptionTestSchema';

describe('redactions upload/download — envelope encryption', () => {
  beforeAll(async () => {
    await ensureFileEncryptionKeysTable(env.DB as unknown as import('@cloudflare/workers-types').D1Database);
  });

  it('stores ciphertext in R2 and streams back the original bytes', async () => {
    const testEnv = envWithKek(env as unknown as Record<string, unknown>);
    const original = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

    const form = new FormData();
    form.append('video', new File([original], 'redacted.mp4', { type: 'video/mp4' }));
    form.append('metadata', JSON.stringify({ event_id: 1, kinds: ['face'], region_count: 1 }));

    const uploadRes = await app.request('/api/redactions', { method: 'POST', body: form }, testEnv);
    expect(uploadRes.status).toBe(200);
    const body = await uploadRes.json() as { id: number; r2_key: string };
    expect(body.r2_key).toMatch(/^redactions\/.+\.mp4$/);

    const raw = await (testEnv as any).UPLOADS.get(body.r2_key);
    const rawBytes = new Uint8Array(await raw!.arrayBuffer());
    expect(Array.from(rawBytes)).not.toEqual(Array.from(original));

    const downloadRes = await app.request(`/api/redactions/${body.id}/download`, {}, testEnv);
    expect(downloadRes.status).toBe(200);
    const downloadedBytes = new Uint8Array(await downloadRes.arrayBuffer());
    expect(Array.from(downloadedBytes)).toEqual(Array.from(original));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:worker -- test-workers/redactionsEncryption.test.ts`
Expected: FAIL — `rawBytes` equals `original` (route still writes plaintext)

- [ ] **Step 3: Wire the route**

At the top of `src/routes/redactions.ts`, change:

```typescript
import { getDb, execute, query, queryFirst, columnExists } from '../utils/db';
```

to:

```typescript
import { getDb, execute, query, queryFirst, columnExists } from '../utils/db';
import { putEncrypted, getDecrypted, deleteEncryptionKey } from '../utils/encryptedR2';
```

Change the write (currently lines 57-62):

```typescript
  const r2Key = `redactions/${crypto.randomUUID()}.${fmt.ext}`;
  try {
    await c.env.UPLOADS.put(r2Key, await file.arrayBuffer(), { httpMetadata: { contentType: fmt.contentType } });
  } catch (err: any) {
    return c.json({ error: `storage failed: ${err?.message ?? 'unknown'}` }, 502);
  }
```

to:

```typescript
  const r2Key = `redactions/${crypto.randomUUID()}.${fmt.ext}`;
  try {
    await putEncrypted(c.env.UPLOADS, db, c.env.FILE_ENCRYPTION_KEK, r2Key, await file.arrayBuffer(), { httpMetadata: { contentType: fmt.contentType } });
  } catch (err: any) {
    return c.json({ error: `storage failed: ${err?.message ?? 'unknown'}` }, 502);
  }
```

Change the custody-row-failed rollback delete (currently lines 90-93):

```typescript
  } catch (err: any) {
    // Custody row failed — don't leave the MP4 orphaned in R2 with no record.
    try { await c.env.UPLOADS.delete(r2Key); } catch { /* best-effort */ }
    return c.json({ error: 'custody record failed: ' + (err?.message ?? 'unknown') }, 502);
  }
```

to:

```typescript
  } catch (err: any) {
    // Custody row failed — don't leave the MP4 orphaned in R2 with no record.
    try { await c.env.UPLOADS.delete(r2Key); } catch { /* best-effort */ }
    try { await deleteEncryptionKey(db, r2Key); } catch { /* best-effort */ }
    return c.json({ error: 'custody record failed: ' + (err?.message ?? 'unknown') }, 502);
  }
```

Change the read (currently lines 120-124):

```typescript
  const obj = await c.env.UPLOADS.get(row.r2_key);
  if (!obj) return c.json({ error: 'File missing from storage' }, 404);
  const ext = row.r2_key.toLowerCase().endsWith('.webm') ? 'webm' : 'mp4';
  const contentType = obj.httpMetadata?.contentType || (ext === 'webm' ? 'video/webm' : 'video/mp4');
  return new Response(obj.body, { headers: { 'Content-Type': contentType, 'Content-Disposition': `attachment; filename="redacted-${c.req.param('id')}.${ext}"` } });
```

to:

```typescript
  const decrypted = await getDecrypted(c.env.UPLOADS, db, c.env.FILE_ENCRYPTION_KEK, row.r2_key);
  if (!decrypted) return c.json({ error: 'File missing from storage' }, 404);
  const ext = row.r2_key.toLowerCase().endsWith('.webm') ? 'webm' : 'mp4';
  const contentType = decrypted.httpMetadata?.contentType || (ext === 'webm' ? 'video/webm' : 'video/mp4');
  return new Response(decrypted.bytes, { headers: { 'Content-Type': contentType, 'Content-Disposition': `attachment; filename="redacted-${c.req.param('id')}.${ext}"` } });
```

(`db` is already in scope in the read handler — `const db = getDb(c.env);` is the first line of `redactions.get('/:id/download', ...)`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:worker -- test-workers/redactionsEncryption.test.ts`
Expected: PASS (1/1)

- [ ] **Step 5: Commit**

```bash
git add src/routes/redactions.ts test-workers/redactionsEncryption.test.ts
git commit -m "feat(redactions): encrypt redacted-video storage at rest"
```

---

### Task 6: alpr.ts — encrypt `alpr-captures/` write+read and `alpr/vehicles/` crop writes

**Files:**
- Modify: `src/routes/alpr.ts:28` (import), `:507-511` (capture write), `:975-986` (`GET /image/*`), `:1007-1008` (crop upload write)
- Test: `test-workers/alprCapturesEncryption.test.ts`

**Interfaces:**
- Consumes: `getDecrypted` added alongside the already-imported `putEncrypted`, `FileEncryptionError` (`alpr.ts:28`, from Phase 1's Task 4).

- [ ] **Step 1: Write the failing test**

```typescript
// test-workers/alprCapturesEncryption.test.ts
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import app from './entry';
import { envWithKek, ensureFileEncryptionKeysTable } from './helpers/fileEncryptionTestSchema';

describe('alpr-captures/ — envelope encryption for unattached captures', () => {
  beforeAll(async () => {
    await ensureFileEncryptionKeysTable(env.DB as unknown as import('@cloudflare/workers-types').D1Database);
  });

  it('encrypts an unattached capture (no call_id/incident_id) and serves it back decrypted', async () => {
    const testEnv = envWithKek(env as unknown as Record<string, unknown>);
    const original = new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2, 1]);

    const form = new FormData();
    form.append('image', new File([original], 'plate.jpg', { type: 'image/jpeg' }));

    const res = await app.request('/api/alpr/capture', { method: 'POST', body: form }, testEnv);
    expect(res.status).toBe(200);
    const body = await res.json() as { image_url?: string | null };
    expect(body.image_url).toBeTruthy();

    const key = String(body.image_url).replace(/^.*\/image\//, '');
    expect(key).toMatch(/^alpr-captures\//);

    const raw = await (testEnv as any).UPLOADS.get(key);
    const rawBytes = new Uint8Array(await raw!.arrayBuffer());
    expect(Array.from(rawBytes)).not.toEqual(Array.from(original));

    const imgRes = await app.request(`/api/alpr/image/${key}`, {}, testEnv);
    expect(imgRes.status).toBe(200);
    const servedBytes = new Uint8Array(await imgRes.arrayBuffer());
    expect(Array.from(servedBytes)).toEqual(Array.from(original));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:worker -- test-workers/alprCapturesEncryption.test.ts`
Expected: FAIL — `rawBytes` equals `original`

(Confirmed the response carries `image_url: imageUrlFor(imageKey)` — `alpr.ts:607` — so the test's field name is correct as written.)

- [ ] **Step 3: Wire the route**

Change the import (currently `src/routes/alpr.ts:28`):

```typescript
import { putEncrypted, FileEncryptionError } from '../utils/encryptedR2';
```

to:

```typescript
import { putEncrypted, getDecrypted, FileEncryptionError } from '../utils/encryptedR2';
```

Change the capture write (currently lines 507-511):

```typescript
  try {
    if (attachToCall) {
      await putEncrypted(c.env.UPLOADS, db, c.env.FILE_ENCRYPTION_KEK, imageKey, bytes, { httpMetadata: { contentType } });
    } else {
      await c.env.UPLOADS.put(imageKey, bytes, { httpMetadata: { contentType } });
    }
  } catch (err: any) {
```

to:

```typescript
  try {
    await putEncrypted(c.env.UPLOADS, db, c.env.FILE_ENCRYPTION_KEK, imageKey, bytes, { httpMetadata: { contentType } });
  } catch (err: any) {
```

(Both branches now call the same `putEncrypted` — the `attachToCall ? FIELD_PHOTO_PREFIX : ALPR_PREFIX` split above this block already picks the right key prefix; only the destination prefix differs, not the encryption path, now that both `field-photos/` and `alpr-captures/` are encrypted.)

Change the read (currently lines 975-986):

```typescript
alpr.get('/image/*', operational, async (c) => {
  const key = c.req.path.replace(/^.*\/image\//, '');
  if (!key.startsWith(ALPR_PREFIX) || key.includes('..')) return c.json({ error: 'Invalid key' }, 400);
  const obj = await c.env.UPLOADS.get(key);
  if (!obj) return c.json({ error: 'Not found' }, 404);
  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType || 'image/jpeg',
      'Cache-Control': 'private, max-age=86400',
    },
  });
});
```

to:

```typescript
alpr.get('/image/*', operational, async (c) => {
  const key = c.req.path.replace(/^.*\/image\//, '');
  if (!key.startsWith(ALPR_PREFIX) || key.includes('..')) return c.json({ error: 'Invalid key' }, 400);
  const decrypted = await getDecrypted(c.env.UPLOADS, getDb(c.env), c.env.FILE_ENCRYPTION_KEK, key);
  if (!decrypted) return c.json({ error: 'Not found' }, 404);
  return new Response(decrypted.bytes, {
    headers: {
      'Content-Type': decrypted.httpMetadata?.contentType || 'image/jpeg',
      'Cache-Control': 'private, max-age=86400',
    },
  });
});
```

Change the crop upload write (currently lines 1007-1008):

```typescript
      const key = `alpr/vehicles/${id}/${field}.jpg`;
      await c.env.UPLOADS.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: 'image/jpeg' } });
```

to:

```typescript
      const key = `alpr/vehicles/${id}/${field}.jpg`;
      await putEncrypted(c.env.UPLOADS, db, c.env.FILE_ENCRYPTION_KEK, key, await file.arrayBuffer(), { httpMetadata: { contentType: 'image/jpeg' } });
```

(`db` is already in scope in this handler — `const db = getDb(c.env);` at line 992, per the earlier read of this file.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:worker -- test-workers/alprCapturesEncryption.test.ts`
Expected: PASS (1/1)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/routes/alpr.ts test-workers/alprCapturesEncryption.test.ts
git commit -m "feat(alpr): encrypt alpr-captures/ and alpr/vehicles/ crop writes at rest"
```

---

### Task 7: intel.ts — encrypt `interactions/` chunk write+read

**Files:**
- Modify: `src/routes/intel.ts` (import, `:677` write, `:720` read)
- Modify: `test-workers/entry.ts` (mount `intel` router)
- Test: `test-workers/intelInteractionsEncryption.test.ts`

**Interfaces:**
- Consumes: `putEncrypted`, `getDecrypted` from `src/utils/encryptedR2.ts`; `chunkKey`, `parseSeq` (already imported in `intel.ts` from `../utils/intelRecording`).

- [ ] **Step 1: Mount the router**

In `test-workers/entry.ts`, add the import and route:

```typescript
import intel from '../src/routes/intel';
```

```typescript
app.route('/api/intel', intel);
```

- [ ] **Step 2: Write the failing test**

```typescript
// test-workers/intelInteractionsEncryption.test.ts
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import app from './entry';
import { envWithKek, ensureFileEncryptionKeysTable } from './helpers/fileEncryptionTestSchema';

describe('interactions/ chunk storage — envelope encryption', () => {
  beforeAll(async () => {
    await ensureFileEncryptionKeysTable(env.DB as unknown as import('@cloudflare/workers-types').D1Database);
    await (env.DB as unknown as import('@cloudflare/workers-types').D1Database).prepare(
      `CREATE TABLE IF NOT EXISTS interaction_recordings (
        id INTEGER PRIMARY KEY AUTOINCREMENT, officer_id INTEGER, location_text TEXT, lat REAL, lng REAL,
        linked_fi_id INTEGER, linked_call_id INTEGER, notes TEXT, mime TEXT, status TEXT,
        chunk_count INTEGER DEFAULT 0, duration_sec INTEGER, ended_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
    ).run();
  });

  it('stores a chunk as ciphertext and streams back the original bytes', async () => {
    const testEnv = envWithKek(env as unknown as Record<string, unknown>);

    const createRes = await app.request('/api/intel/recordings', { method: 'POST', body: JSON.stringify({}), headers: { 'content-type': 'application/json' } }, testEnv);
    expect(createRes.status).toBe(200);
    const { id } = await createRes.json() as { id: number };

    const original = new Uint8Array([11, 22, 33, 44, 55]);
    const chunkRes = await app.request(`/api/intel/recordings/${id}/chunk?seq=0`, { method: 'PUT', body: original }, testEnv);
    expect(chunkRes.status).toBe(200);

    const key = `interactions/${id}/0.webm`; // matches chunkKey(id, seq) in src/utils/intelRecording.ts
    const raw = await (testEnv as any).UPLOADS.get(key);
    if (raw) {
      const rawBytes = new Uint8Array(await raw.arrayBuffer());
      expect(Array.from(rawBytes)).not.toEqual(Array.from(original));
    }

    const readRes = await app.request(`/api/intel/recordings/${id}/chunk/0`, {}, testEnv);
    expect(readRes.status).toBe(200);
    const readBytes = new Uint8Array(await readRes.arrayBuffer());
    expect(Array.from(readBytes)).toEqual(Array.from(original));
  });
});
```

(Before finalizing, read `src/utils/intelRecording.ts`'s `chunkKey(id, seq)` implementation to confirm the exact key format the test asserts against — the `raw` lookup is written defensively with an `if (raw)` guard in case the literal format differs, but the decrypt-round-trip assertion via the read route is the test's real proof and doesn't depend on knowing the exact key string.)

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:worker -- test-workers/intelInteractionsEncryption.test.ts`
Expected: FAIL — decrypted read returns 404 or plaintext-equals-plaintext (route still uses raw `bucket.put`/`bucket.get`)

- [ ] **Step 4: Wire the route**

Add to `src/routes/intel.ts`'s import block (alongside `chunkKey, parseSeq`):

```typescript
import { putEncrypted, getDecrypted } from '../utils/encryptedR2';
```

Change the chunk write (currently lines 665-684, the relevant line is 677):

```typescript
    await (c.env as any).UPLOADS.put(chunkKey(id, seq), body, { httpMetadata: { contentType: rec.mime || 'audio/webm' } });
```

to:

```typescript
    await putEncrypted(c.env.UPLOADS, db, c.env.FILE_ENCRYPTION_KEK, chunkKey(id, seq), body, { httpMetadata: { contentType: rec.mime || 'audio/webm' } });
```

Change the chunk read (currently lines 714-728, the relevant lines are 720-724):

```typescript
    const obj = await (c.env as any).UPLOADS.get(chunkKey(id, seq));
    if (!obj) return c.json({ error: 'chunk not found' }, 404);
    const rec = await queryFirst<{ mime: string | null }>(db, 'SELECT mime FROM interaction_recordings WHERE id = ?', id).catch(() => null);
    const mime = obj.httpMetadata?.contentType || rec?.mime || 'audio/webm';
    return new Response(obj.body, { headers: { 'content-type': mime, 'cache-control': 'private, max-age=3600' } });
```

to:

```typescript
    const decrypted = await getDecrypted(c.env.UPLOADS, db, c.env.FILE_ENCRYPTION_KEK, chunkKey(id, seq));
    if (!decrypted) return c.json({ error: 'chunk not found' }, 404);
    const rec = await queryFirst<{ mime: string | null }>(db, 'SELECT mime FROM interaction_recordings WHERE id = ?', id).catch(() => null);
    const mime = decrypted.httpMetadata?.contentType || rec?.mime || 'audio/webm';
    return new Response(decrypted.bytes, { headers: { 'content-type': mime, 'cache-control': 'private, max-age=3600' } });
```

(`db` is already in scope in both handlers — `const db = getDb(c.env);` is the first line of both `intel.put('/recordings/:id/chunk', ...)` and `intel.get('/recordings/:id/chunk/:seq', ...)`.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:worker -- test-workers/intelInteractionsEncryption.test.ts`
Expected: PASS (1/1)

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/routes/intel.ts test-workers/entry.ts test-workers/intelInteractionsEncryption.test.ts
git commit -m "feat(intel): encrypt interactions/ recording chunks at rest"
```

---

### Task 8: citations.ts — encrypt citation PDF write+read

**Files:**
- Modify: `src/routes/citations.ts` (import, `:555-563` write, `:641-664` read)
- Modify: `test-workers/entry.ts` (mount `citations` router)
- Test: `test-workers/citationsEncryption.test.ts`

**Interfaces:**
- Consumes: `putEncrypted`, `getDecrypted` from `src/utils/encryptedR2.ts`.

- [ ] **Step 1: Mount the router**

In `test-workers/entry.ts`, add:

```typescript
import citations from '../src/routes/citations';
```

```typescript
app.route('/api/citations', citations);
```

- [ ] **Step 2: Write the failing test**

```typescript
// test-workers/citationsEncryption.test.ts
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import app from './entry';
import { envWithKek, ensureFileEncryptionKeysTable } from './helpers/fileEncryptionTestSchema';

describe('citations/ PDF copies — envelope encryption', () => {
  beforeAll(async () => {
    const db = env.DB as unknown as import('@cloudflare/workers-types').D1Database;
    await ensureFileEncryptionKeysTable(db);
    await db.prepare(`CREATE TABLE IF NOT EXISTS citations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, citation_number TEXT
    )`).run();
    await db.prepare(`INSERT INTO citations (id, citation_number) VALUES (1, 'C-1001')`).run();
  });

  it('stores an uploaded copy as ciphertext and serves it back decrypted', async () => {
    const testEnv = envWithKek(env as unknown as Record<string, unknown>);
    const original = new Uint8Array([0x25, 0x50, 0x44, 0x46, 1, 2, 3]); // fake %PDF-ish bytes

    const form = new FormData();
    form.append('court', new File([original], 'court.pdf', { type: 'application/pdf' }));

    const uploadRes = await app.request('/api/citations/1/copies', { method: 'POST', body: form }, testEnv);
    expect(uploadRes.status).toBe(201);

    const key = 'citations/1/court.pdf';
    const raw = await (testEnv as any).UPLOADS.get(key);
    const rawBytes = new Uint8Array(await raw!.arrayBuffer());
    expect(Array.from(rawBytes)).not.toEqual(Array.from(original));

    const readRes = await app.request('/api/citations/1/copies/court', {}, testEnv);
    expect(readRes.status).toBe(200);
    const readBytes = new Uint8Array(await readRes.arrayBuffer());
    expect(Array.from(readBytes)).toEqual(Array.from(original));
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:worker -- test-workers/citationsEncryption.test.ts`
Expected: FAIL — `rawBytes` equals `original`

- [ ] **Step 4: Wire the route**

Add to `src/routes/citations.ts`'s import block:

```typescript
import { putEncrypted, getDecrypted } from '../utils/encryptedR2';
```

Change the write (currently lines 555-563):

```typescript
      const key = `citations/${id}/${kind}.pdf`;
      try {
        await c.env.UPLOADS.put(key, bytes, {
          httpMetadata: { contentType: 'application/pdf' },
        });
        uploaded[kind] = key;
      } catch (err: any) {
        errors.push(`${kind}: R2 put failed: ${err?.message || 'unknown'}`);
      }
```

to:

```typescript
      const key = `citations/${id}/${kind}.pdf`;
      try {
        await putEncrypted(c.env.UPLOADS, db, c.env.FILE_ENCRYPTION_KEK, key, bytes, {
          httpMetadata: { contentType: 'application/pdf' },
        });
        uploaded[kind] = key;
      } catch (err: any) {
        errors.push(`${kind}: R2 put failed: ${err?.message || 'unknown'}`);
      }
```

(`db` is already in scope — `const db = getDb(c.env);` at line 522, the top of `citations.post('/:id/copies', ...)`.)

Change the read (currently lines 641-664, add `db` and swap the get):

```typescript
citations.get('/:id/copies/:kind', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'officer', 'supervisor', 'dispatcher');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const id = parseInt(c.req.param('id'), 10);
    const kind = c.req.param('kind') as CitationCopyKind;
    if (isNaN(id)) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
    if (!CITATION_COPY_KINDS.includes(kind)) {
      return c.json({ error: 'Invalid copy kind', code: 'INVALID_KIND' }, 400);
    }
    const key = `citations/${id}/${kind}.pdf`;
    const obj = await c.env.UPLOADS.get(key);
    if (!obj) return c.json({ error: 'Copy not found', code: 'NOT_FOUND' }, 404);
    return new Response(obj.body, {
```

to:

```typescript
citations.get('/:id/copies/:kind', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'officer', 'supervisor', 'dispatcher');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    const kind = c.req.param('kind') as CitationCopyKind;
    if (isNaN(id)) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
    if (!CITATION_COPY_KINDS.includes(kind)) {
      return c.json({ error: 'Invalid copy kind', code: 'INVALID_KIND' }, 400);
    }
    const key = `citations/${id}/${kind}.pdf`;
    const decrypted = await getDecrypted(c.env.UPLOADS, db, c.env.FILE_ENCRYPTION_KEK, key);
    if (!decrypted) return c.json({ error: 'Copy not found', code: 'NOT_FOUND' }, 404);
    return new Response(decrypted.bytes, {
```

(the remaining `headers: {...}` object below is unchanged.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:worker -- test-workers/citationsEncryption.test.ts`
Expected: PASS (1/1)

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/routes/citations.ts test-workers/entry.ts test-workers/citationsEncryption.test.ts
git commit -m "feat(citations): encrypt citation PDF copies at rest"
```

---

### Task 9: uploads.ts — encrypt `attachments/`, wire delete, lower the size cap

**Files:**
- Modify: `src/routes/uploads.ts` (import, `MAX_FILE_SIZE:31`, writes `:307`/`:374`/`:414`, reads `:180`/`:205`/`:228`, delete `:473`)
- Modify: `test-workers/entry.ts` (mount `uploads` router)
- Test: `test-workers/uploadsEncryption.test.ts`

**Interfaces:**
- Consumes: `putEncrypted`, `getDecrypted`, `deleteEncryptionKey` from `src/utils/encryptedR2.ts`.

- [ ] **Step 1: Mount the router**

In `test-workers/entry.ts`, add:

```typescript
import uploads from '../src/routes/uploads';
```

```typescript
app.route('/api/uploads', uploads);
```

`uploads.ts` does NOT use the harness's injected `c.set('user', ...)` — it has its own module-private `resolveAuth(c)` (confirmed at `uploads.ts:99-119`) that requires a real signed JWT, either via `Authorization: Bearer <token>` or a `?token=` query param, verified with `jwtVerify(token, env.JWT_SECRET)` (`uploads.ts:83`, using `jose`). The payload must carry `user_id` or `userId` (required — `resolveAuth` returns `null` without it) and must NOT have `type: 'refresh'`. The test below mints a real token via `hono/jwt`'s `sign()`, matching the pattern already established in `test-workers/auth.test.ts`'s `mintAccessToken` helper, and sets a known `JWT_SECRET` on the test env so `jwtVerify` can check it.

- [ ] **Step 2: Write the failing test**

```typescript
// test-workers/uploadsEncryption.test.ts
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { sign } from 'hono/jwt';
import app from './entry';
import { envWithKek, ensureFileEncryptionKeysTable } from './helpers/fileEncryptionTestSchema';

const JWT_SECRET = 'test-jwt-secret-do-not-use-in-prod';

async function mintToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return sign({ user_id: 1, username: 'test-officer', role: 'admin', iat: now, exp: now + 900, type: 'access' }, JWT_SECRET);
}

describe('attachments/ — envelope encryption', () => {
  beforeAll(async () => {
    const db = env.DB as unknown as import('@cloudflare/workers-types').D1Database;
    await ensureFileEncryptionKeysTable(db);
    await db.prepare(`CREATE TABLE IF NOT EXISTS attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT, file_id TEXT UNIQUE, original_name TEXT, stored_name TEXT,
      file_path TEXT, mime_type TEXT, file_size INTEGER, entity_type TEXT, entity_id INTEGER,
      folder_id INTEGER, uploaded_by INTEGER, uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`).run();
    await db.prepare(`CREATE TABLE IF NOT EXISTS activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, action TEXT, entity_type TEXT,
      entity_id INTEGER, details TEXT, ip_address TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`).run();
  });

  it('stores ciphertext, serves decrypted bytes, and removes the key row on delete', async () => {
    const testEnv = { ...envWithKek(env as unknown as Record<string, unknown>), JWT_SECRET };
    const token = await mintToken();
    const authHeaders = { authorization: `Bearer ${token}` };
    const original = new Uint8Array([1, 2, 3, 4, 5]);

    const form = new FormData();
    form.append('files', new File([original], 'note.txt', { type: 'text/plain' }));

    const uploadRes = await app.request('/api/uploads', { method: 'POST', headers: authHeaders, body: form }, testEnv);
    expect(uploadRes.status).toBe(201);
    const [row] = await uploadRes.json() as Array<{ file_id: string; file_path: string }>;

    const raw = await (testEnv as any).UPLOADS.get(row.file_path);
    const rawBytes = new Uint8Array(await raw!.arrayBuffer());
    expect(Array.from(rawBytes)).not.toEqual(Array.from(original));

    const downloadRes = await app.request(`/api/uploads/${row.file_id}/download`, { headers: authHeaders }, testEnv);
    expect(downloadRes.status).toBe(200);
    const downloadedBytes = new Uint8Array(await downloadRes.arrayBuffer());
    expect(Array.from(downloadedBytes)).toEqual(Array.from(original));

    const db = env.DB as unknown as import('@cloudflare/workers-types').D1Database;
    const beforeDelete = await db.prepare('SELECT 1 FROM file_encryption_keys WHERE r2_key = ?').bind(row.file_path).first();
    expect(beforeDelete).toBeTruthy();

    const deleteRes = await app.request(`/api/uploads/${row.file_id}`, { method: 'DELETE', headers: authHeaders }, testEnv);
    expect(deleteRes.status).toBeLessThan(300);

    const afterDelete = await db.prepare('SELECT 1 FROM file_encryption_keys WHERE r2_key = ?').bind(row.file_path).first();
    expect(afterDelete).toBeNull();
  });

  it('rejects a file larger than 100 MB', async () => {
    const testEnv = { ...envWithKek(env as unknown as Record<string, unknown>), JWT_SECRET };
    const token = await mintToken();
    const oversized = new Uint8Array(100 * 1024 * 1024 + 1);
    const form = new FormData();
    form.append('files', new File([oversized], 'huge.bin', { type: 'text/plain' }));
    const res = await app.request('/api/uploads', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form }, testEnv);
    expect(res.status).toBe(400);
  });
});
```

(Confirmed the delete route is `uploads.delete('/:fileId', ...)` at `uploads.ts:455` — the test's request path/method are correct as written.)

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:worker -- test-workers/uploadsEncryption.test.ts`
Expected: FAIL — both the encryption assertion and the 100 MB cap assertion fail against the current plaintext/500 MB code

- [ ] **Step 4: Wire the route**

Add to `src/routes/uploads.ts`'s import block:

```typescript
import { putEncrypted, getDecrypted, deleteEncryptionKey } from '../utils/encryptedR2';
```

Change the size cap (currently line 31):

```typescript
const MAX_FILE_SIZE = 500 * 1024 * 1024;
```

to:

```typescript
const MAX_FILE_SIZE = 100 * 1024 * 1024;
```

Change the three reads (`thumbnail`, `download`, and the bare `GET /:fileId` — currently lines 180/183, 205/208, 228/231, each following the identical `const obj = await c.env.UPLOADS.get(att.file_path); if (!obj) ...; const data = await obj.arrayBuffer();` shape) to the identical replacement in all three places:

```typescript
    const obj = await c.env.UPLOADS.get(att.file_path);
    if (!obj) return c.json({ error: 'File not found in storage', code: 'FILE_NOT_FOUND_ON' }, 404);

    const data = await obj.arrayBuffer();
```

becomes:

```typescript
    const decrypted = await getDecrypted(c.env.UPLOADS, db, c.env.FILE_ENCRYPTION_KEK, att.file_path);
    if (!decrypted) return c.json({ error: 'File not found in storage', code: 'FILE_NOT_FOUND_ON' }, 404);

    const data = decrypted.bytes;
```

(`db` is already in scope in all three handlers — each starts with `const db = getDb(c.env);`. `c.body(data)` below each of these three blocks accepts a `Uint8Array` the same as an `ArrayBuffer`, so no further change is needed there.)

Change the upload write (currently lines 302-309):

```typescript
      const fileId = crypto.randomUUID();
      const ext = extFor(file.name, file.type);
      const r2Key = `attachments/${fileId}${ext}`;
      const buffer = await file.arrayBuffer();

      await c.env.UPLOADS.put(r2Key, buffer, {
        httpMetadata: { contentType: file.type || 'application/octet-stream' },
      });
```

to:

```typescript
      const fileId = crypto.randomUUID();
      const ext = extFor(file.name, file.type);
      const r2Key = `attachments/${fileId}${ext}`;
      const buffer = await file.arrayBuffer();

      await putEncrypted(c.env.UPLOADS, db, c.env.FILE_ENCRYPTION_KEK, r2Key, buffer, {
        httpMetadata: { contentType: file.type || 'application/octet-stream' },
      });
```

Change the blank-file-create write (currently lines 374-376):

```typescript
    await c.env.UPLOADS.put(r2Key, new Uint8Array(0), {
      httpMetadata: { contentType: mimeType },
    });
```

to:

```typescript
    await putEncrypted(c.env.UPLOADS, db, c.env.FILE_ENCRYPTION_KEK, r2Key, new Uint8Array(0), {
      httpMetadata: { contentType: mimeType },
    });
```

Change the text-editor-save write (currently lines 414-416):

```typescript
    await c.env.UPLOADS.put(att.file_path, encoded, {
      httpMetadata: { contentType: att.mime_type || 'text/plain' },
    });
```

to:

```typescript
    await putEncrypted(c.env.UPLOADS, db, c.env.FILE_ENCRYPTION_KEK, att.file_path, encoded, {
      httpMetadata: { contentType: att.mime_type || 'text/plain' },
    });
```

Change the delete (currently line 473 — read the surrounding `DELETE` handler in `src/routes/uploads.ts` around line 460-480 to confirm `db` is already in scope there, matching every other handler in this file; it is expected to be, per the file's consistent pattern):

```typescript
    try { await c.env.UPLOADS.delete(att.file_path); } catch { /* non-fatal */ }
```

to:

```typescript
    try { await c.env.UPLOADS.delete(att.file_path); } catch { /* non-fatal */ }
    try { await deleteEncryptionKey(db, att.file_path); } catch { /* non-fatal */ }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:worker -- test-workers/uploadsEncryption.test.ts`
Expected: PASS (2/2)

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/routes/uploads.ts test-workers/entry.ts test-workers/uploadsEncryption.test.ts
git commit -m "feat(uploads): encrypt attachments/ at rest, wire delete, lower cap to 100 MB"
```

---

### Task 10: inspections.ts — encrypt `vehicle-inspections/` write+read

**Files:**
- Modify: `src/routes/inspections.ts` (import, `:248` write, `:267` read)
- Modify: `test-workers/entry.ts` (mount `inspections` router)
- Test: `test-workers/inspectionsEncryption.test.ts`

**Interfaces:**
- Consumes: `putEncrypted`, `getDecrypted` from `src/utils/encryptedR2.ts`.

- [ ] **Step 1: Mount the router**

In `test-workers/entry.ts`, add:

```typescript
import inspections from '../src/routes/inspections';
```

```typescript
app.route('/api/inspections', inspections);
```

`inspections.ts`'s photo routes are token-gated via `resolveToken(db, token)` (`inspections.ts:41-45`), which queries the real `time_entries` table directly — `SELECT id, officer_id, vehicle_id, unit_id, clock_in, clock_out, qr_token, starting_mileage, ending_mileage FROM time_entries WHERE qr_token = ? AND clock_out IS NULL LIMIT 1` — not a separate token table. The base schema is `migrations/0001_initial_schema.sql`'s `time_entries` (`officer_id`/`clock_in` `NOT NULL`), plus columns added by later migrations: `starting_mileage`, `ending_mileage`, `total_miles`, `qr_token`, `clock_in_local`, `clock_out_local`, `break_start_local`, `unit_id`, `vehicle_id` (all nullable). The test below creates the full real shape and inserts one open (`clock_out IS NULL`) row with a `qr_token` set.

- [ ] **Step 2: Write the failing test**

```typescript
// test-workers/inspectionsEncryption.test.ts
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import app from './entry';
import { envWithKek, ensureFileEncryptionKeysTable } from './helpers/fileEncryptionTestSchema';

const TOKEN = 'test-shift-token-0001';

describe('vehicle-inspections/ — envelope encryption', () => {
  let entryId: number;

  beforeAll(async () => {
    const db = env.DB as unknown as import('@cloudflare/workers-types').D1Database;
    await ensureFileEncryptionKeysTable(db);
    await db.prepare(`CREATE TABLE IF NOT EXISTS time_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      officer_id INTEGER NOT NULL,
      schedule_id INTEGER,
      clock_in TEXT NOT NULL,
      clock_out TEXT,
      clock_in_latitude REAL,
      clock_in_longitude REAL,
      total_hours REAL,
      break_start TEXT,
      break_minutes REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      starting_mileage REAL, ending_mileage REAL, total_miles REAL, qr_token TEXT,
      clock_in_local TEXT, clock_out_local TEXT, break_start_local TEXT,
      unit_id INTEGER, vehicle_id INTEGER
    )`).run();
    await db.prepare(`CREATE TABLE IF NOT EXISTS vehicle_inspections (
      id INTEGER PRIMARY KEY AUTOINCREMENT, time_entry_id INTEGER, phase TEXT, completed_at TEXT
    )`).run();
    const res = await db.prepare(
      `INSERT INTO time_entries (officer_id, clock_in, qr_token) VALUES (1, datetime('now'), ?)`,
    ).bind(TOKEN).run();
    entryId = Number(res.meta.last_row_id);
  });

  it('stores an uploaded inspection photo as ciphertext and streams it back decrypted', async () => {
    const testEnv = envWithKek(env as unknown as Record<string, unknown>);
    const original = new Uint8Array([1, 1, 2, 3, 5, 8, 13]);

    const uploadRes = await app.request(
      `/api/inspections/by-token/${TOKEN}/photos?phase=pre&slot=front`,
      { method: 'POST', body: original, headers: { 'content-type': 'image/jpeg' } },
      testEnv,
    );
    expect(uploadRes.status).toBe(200);
    const { key } = await uploadRes.json() as { key: string };
    expect(key).toMatch(/^vehicle-inspections\//);

    const raw = await (testEnv as any).UPLOADS.get(key);
    const rawBytes = new Uint8Array(await raw!.arrayBuffer());
    expect(Array.from(rawBytes)).not.toEqual(Array.from(original));

    const readRes = await app.request(`/api/inspections/by-token/${TOKEN}/photo?key=${encodeURIComponent(key)}`, {}, testEnv);
    expect(readRes.status).toBe(200);
    const readBytes = new Uint8Array(await readRes.arrayBuffer());
    expect(Array.from(readBytes)).toEqual(Array.from(original));
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:worker -- test-workers/inspectionsEncryption.test.ts`
Expected: FAIL — `rawBytes` equals `original` (route still writes plaintext). If instead the upload request itself doesn't return 200, re-check the `time_entries` fixture row against `resolveToken`'s query before proceeding — the schema above was verified directly against `migrations/0001_initial_schema.sql` plus every later `ALTER TABLE time_entries ADD COLUMN` migration, but confirm no further migration has changed it since this plan was written.

- [ ] **Step 4: Wire the route**

Add to `src/routes/inspections.ts`'s import block:

```typescript
import { putEncrypted, getDecrypted } from '../utils/encryptedR2';
```

Change the write (currently lines 242-248):

```typescript
    const body = await c.req.arrayBuffer();
    if (!body || body.byteLength === 0) return c.json({ error: 'Empty upload', code: 'EMPTY' }, 400);
    if (body.byteLength > 6_000_000) return c.json({ error: 'Photo too large (>6MB after resize?)', code: 'TOO_LARGE' }, 413);

    const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
    const key = `vehicle-inspections/${entry.id}/${phase}/${slot}-${crypto.randomUUID()}.${ext}`;
    await c.env.UPLOADS.put(key, body, { httpMetadata: { contentType } });
```

to:

```typescript
    const body = await c.req.arrayBuffer();
    if (!body || body.byteLength === 0) return c.json({ error: 'Empty upload', code: 'EMPTY' }, 400);
    if (body.byteLength > 6_000_000) return c.json({ error: 'Photo too large (>6MB after resize?)', code: 'TOO_LARGE' }, 413);

    const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
    const key = `vehicle-inspections/${entry.id}/${phase}/${slot}-${crypto.randomUUID()}.${ext}`;
    await putEncrypted(c.env.UPLOADS, db, c.env.FILE_ENCRYPTION_KEK, key, body, { httpMetadata: { contentType } });
```

Change the read (currently lines 264-274):

```typescript
    const obj = await c.env.UPLOADS.get(key);
    if (!obj) return c.json({ error: 'Photo not found' }, 404);
    return new Response(obj.body, {
      headers: {
        'Content-Type': obj.httpMetadata?.contentType || 'image/jpeg',
        'Cache-Control': 'private, max-age=300',
      },
    });
```

to:

```typescript
    const decrypted = await getDecrypted(c.env.UPLOADS, db, c.env.FILE_ENCRYPTION_KEK, key);
    if (!decrypted) return c.json({ error: 'Photo not found' }, 404);
    return new Response(decrypted.bytes, {
      headers: {
        'Content-Type': decrypted.httpMetadata?.contentType || 'image/jpeg',
        'Cache-Control': 'private, max-age=300',
      },
    });
```

(`db` is already in scope in both handlers — `const db = getDb(c.env);` is the first line of both `inspections.post('/by-token/:token/photos', ...)` and `inspections.get('/by-token/:token/photo', ...)`.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:worker -- test-workers/inspectionsEncryption.test.ts`
Expected: PASS (1/1)

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/routes/inspections.ts test-workers/entry.ts test-workers/inspectionsEncryption.test.ts
git commit -m "feat(inspections): encrypt vehicle-inspections/ photos at rest"
```

---

### Task 11: business/photos.ts + property/photos.ts — encrypt write+read+delete (both, symmetric change)

**Files:**
- Modify: `src/routes/business/photos.ts` (import, `:54` read, `:155-159` write, `:198-199` delete)
- Modify: `src/routes/property/photos.ts` (import, `:45` read, `:137-141` write, `:177-178` delete)
- Modify: `test-workers/entry.ts` (mount both routers, if not already mounted — `businessPhotosKind.test.ts` and `propertyPhotos.test.ts` already exist under `test-workers/`, so check `test-workers/entry.ts` first; these routers may already be mounted)
- Test: `test-workers/businessPropertyPhotosEncryption.test.ts`

**Interfaces:**
- Consumes: `putEncrypted`, `getDecrypted`, `deleteEncryptionKey` from `src/utils/encryptedR2.ts`.

Both files are line-for-line structural mirrors of each other (the `property/photos.ts` header comment says as much explicitly: "Mirrors src/routes/business/photos.ts exactly"), so this task makes the identical three-site change to both in one pass.

- [ ] **Step 1: Confirm/add router mounts**

Check `test-workers/entry.ts` for existing `business/photos` and `property/photos` mounts (the existing `test-workers/businessPhotosKind.test.ts` and `test-workers/propertyPhotos.test.ts` files suggest they may already be mounted). If either is missing, add:

```typescript
import businessPhotos from '../src/routes/business/photos';
import propertyPhotos from '../src/routes/property/photos';
```

```typescript
app.route('/api/business-photos', businessPhotos);
app.route('/api/property-photos', propertyPhotos);
```

- [ ] **Step 2: Write the failing test**

```typescript
// test-workers/businessPropertyPhotosEncryption.test.ts
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import app from './entry';
import { envWithKek, ensureFileEncryptionKeysTable } from './helpers/fileEncryptionTestSchema';

describe.each([
  { label: 'business', base: '/api/business-photos', table: 'businesses', idField: 'business_id' },
  { label: 'property', base: '/api/property-photos', table: 'properties', idField: 'property_id' },
])('$label-photos/ — envelope encryption', ({ base, table, idField }) => {
  beforeAll(async () => {
    const db = env.DB as unknown as import('@cloudflare/workers-types').D1Database;
    await ensureFileEncryptionKeysTable(db);
    await db.prepare(`CREATE TABLE IF NOT EXISTS ${table} (id INTEGER PRIMARY KEY AUTOINCREMENT)`).run();
    await db.prepare(`INSERT INTO ${table} (id) VALUES (1)`).run();
    await db.prepare(`CREATE TABLE IF NOT EXISTS ${table === 'businesses' ? 'business_photos' : 'property_photos'} (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ${idField} INTEGER, url TEXT, caption TEXT, category TEXT,
      kind TEXT, uploaded_by INTEGER, uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`).run();
  });

  it('stores ciphertext, serves decrypted bytes, and removes the key row on delete', async () => {
    const testEnv = envWithKek(env as unknown as Record<string, unknown>);
    const original = new Uint8Array([5, 4, 3, 2, 1]);

    const form = new FormData();
    form.append('photo', new File([original], 'p.jpg', { type: 'image/jpeg' }));
    form.append(idField, '1');
    form.append('category', 'other');

    const uploadRes = await app.request(base, { method: 'POST', body: form }, testEnv);
    expect(uploadRes.status).toBe(201);
    const row = await uploadRes.json() as { id: number; url: string };
    const r2Key = row.url.replace(`${base}/file/`, '');

    const raw = await (testEnv as any).UPLOADS.get(r2Key);
    const rawBytes = new Uint8Array(await raw!.arrayBuffer());
    expect(Array.from(rawBytes)).not.toEqual(Array.from(original));

    const readRes = await app.request(row.url, {}, testEnv);
    expect(readRes.status).toBe(200);
    const readBytes = new Uint8Array(await readRes.arrayBuffer());
    expect(Array.from(readBytes)).toEqual(Array.from(original));

    const deleteRes = await app.request(`${base}/${row.id}`, { method: 'DELETE' }, testEnv);
    expect(deleteRes.status).toBe(204);

    const db = env.DB as unknown as import('@cloudflare/workers-types').D1Database;
    const keyRow = await db.prepare('SELECT 1 FROM file_encryption_keys WHERE r2_key = ?').bind(r2Key).first();
    expect(keyRow).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:worker -- test-workers/businessPropertyPhotosEncryption.test.ts`
Expected: FAIL — `rawBytes` equals `original` for both `business` and `property` cases

- [ ] **Step 4: Wire both routes (identical change, applied to each file)**

Add to each file's import block (`src/routes/business/photos.ts` and `src/routes/property/photos.ts`):

```typescript
import { putEncrypted, getDecrypted, deleteEncryptionKey } from '../../utils/encryptedR2';
```

Change the read in `business/photos.ts` (currently lines 48-64) — same shape in `property/photos.ts` (lines 39-56):

```typescript
    const obj = await c.env.UPLOADS.get(key);
    if (!obj) return c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404);

    // arrayBuffer + c.body sidesteps the @cloudflare/workers-types vs
    // lib.dom ReadableStream/Headers type collision. Photos cap at
    // 10 MB so buffering is fine.
    const data = await obj.arrayBuffer();
    c.header('Content-Type', obj.httpMetadata?.contentType || 'application/octet-stream');
    c.header('Cache-Control', 'private, max-age=300');
    c.header('etag', obj.httpEtag);
    return c.body(data);
```

to:

```typescript
    const decrypted = await getDecrypted(c.env.UPLOADS, getDb(c.env), c.env.FILE_ENCRYPTION_KEK, key);
    if (!decrypted) return c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404);

    c.header('Content-Type', decrypted.httpMetadata?.contentType || 'application/octet-stream');
    c.header('Cache-Control', 'private, max-age=300');
    return c.body(decrypted.bytes);
```

(the `etag` header is dropped — `getDecrypted`'s return shape has no `httpEtag` equivalent, unlike the raw `R2Object`; this is a minor, acceptable loss of a caching optimization, not a functional regression, matching how Phase 1's `field-photos/` read path already omits it.)

Change the write in `business/photos.ts` (currently lines 153-159) — same shape in `property/photos.ts` (lines 137-141):

```typescript
    const r2Key = `business-photos/${crypto.randomUUID()}${extFor(photo)}`;
    const buffer = await photo.arrayBuffer();
    await c.env.UPLOADS.put(r2Key, buffer, {
      httpMetadata: { contentType: photo.type || 'application/octet-stream' },
    });
```

to:

```typescript
    const r2Key = `business-photos/${crypto.randomUUID()}${extFor(photo)}`;
    const buffer = await photo.arrayBuffer();
    await putEncrypted(c.env.UPLOADS, db, c.env.FILE_ENCRYPTION_KEK, r2Key, buffer, {
      httpMetadata: { contentType: photo.type || 'application/octet-stream' },
    });
```

(`property/photos.ts`'s equivalent uses `property-photos/` as the key prefix — same change otherwise. `db` is already in scope in both write handlers — `const db = getDb(c.env);` is present near the top of both `POST /` handlers.)

Change the delete in `business/photos.ts` (currently lines 198-199) — same shape in `property/photos.ts` (lines 177-178):

```typescript
    if (r2Key && r2Key.startsWith('business-photos/')) {
      try { await c.env.UPLOADS.delete(r2Key); } catch { /* non-fatal */ }
    }
```

to:

```typescript
    if (r2Key && r2Key.startsWith('business-photos/')) {
      try { await c.env.UPLOADS.delete(r2Key); } catch { /* non-fatal */ }
      try { await deleteEncryptionKey(db, r2Key); } catch { /* non-fatal */ }
    }
```

(`property/photos.ts`'s equivalent guards on `'property-photos/'`. `db` is already in scope in both delete handlers — `const db = getDb(c.env);` is the first line of both `DELETE /:photoId` handlers.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:worker -- test-workers/businessPropertyPhotosEncryption.test.ts`
Expected: PASS (2/2 — one per `describe.each` case)

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/routes/business/photos.ts src/routes/property/photos.ts test-workers/entry.ts test-workers/businessPropertyPhotosEncryption.test.ts
git commit -m "feat(photos): encrypt business-photos/ and property-photos/ at rest"
```

---

### Task 12: workOrders.ts — encrypt `work-order-attachments/` write (no reader exists)

**Files:**
- Modify: `src/routes/workOrders.ts` (import, `:619-624` write)
- Modify: `test-workers/entry.ts` (mount `wo` router — check the actual export name in `workOrders.ts`)
- Test: `test-workers/workOrderAttachmentsEncryption.test.ts`

**Interfaces:**
- Consumes: `putEncrypted` from `src/utils/encryptedR2.ts`.

No reader route exists for `work-order-attachments/` anywhere in the codebase (confirmed by grepping every route file for `work_order_attachments`/`work-order-attachments` — only the `POST /:id/attachments` write and a metadata-only `SELECT id, filename, mime, size_bytes, ...` list query exist, neither of which streams file bytes back). Per the approved design doc, this write-only prefix gets its write encrypted for defense-in-depth; building a reader is out of scope. This task's test therefore verifies encryption directly via `getDecrypted` (proving the stored object round-trips correctly) rather than via a route, since no route exists to prove it through.

- [ ] **Step 1: Mount the router**

`src/routes/workOrders.ts` exports `wo` as its default export (`workOrders.ts:938`). In `test-workers/entry.ts` add:

```typescript
import workOrders from '../src/routes/workOrders';
```

```typescript
app.route('/api/work-orders', workOrders);
```

- [ ] **Step 2: Write the failing test**

```typescript
// test-workers/workOrderAttachmentsEncryption.test.ts
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import app from './entry';
import { getDecrypted } from '../src/utils/encryptedR2';
import { envWithKek, TEST_KEK, ensureFileEncryptionKeysTable } from './helpers/fileEncryptionTestSchema';

describe('work-order-attachments/ — envelope encryption (write-only, no reader route)', () => {
  beforeAll(async () => {
    const db = env.DB as unknown as import('@cloudflare/workers-types').D1Database;
    await ensureFileEncryptionKeysTable(db);
    await db.prepare(`CREATE TABLE IF NOT EXISTS work_orders (id INTEGER PRIMARY KEY AUTOINCREMENT)`).run();
    await db.prepare(`INSERT INTO work_orders (id) VALUES (1)`).run();
    await db.prepare(`CREATE TABLE IF NOT EXISTS work_order_attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT, work_order_id INTEGER, r2_key TEXT, filename TEXT,
      mime TEXT, size_bytes INTEGER, uploaded_by INTEGER, uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`).run();
  });

  it('stores ciphertext in R2 that getDecrypted can round-trip', async () => {
    const testEnv = envWithKek(env as unknown as Record<string, unknown>);
    const original = new Uint8Array([7, 6, 5, 4, 3]);

    const form = new FormData();
    form.append('file', new File([original], 'invoice.pdf', { type: 'application/pdf' }));

    const uploadRes = await app.request('/api/work-orders/1/attachments', { method: 'POST', body: form }, testEnv);
    expect(uploadRes.status).toBe(201);
    const { data } = await uploadRes.json() as { data: { id: number } };

    const db = env.DB as unknown as import('@cloudflare/workers-types').D1Database;
    const row = await db.prepare('SELECT r2_key FROM work_order_attachments WHERE id = ?').bind(data.id).first<{ r2_key: string }>();
    expect(row?.r2_key).toMatch(/^work-order-attachments\//);

    const raw = await (testEnv as any).UPLOADS.get(row!.r2_key);
    const rawBytes = new Uint8Array(await raw!.arrayBuffer());
    expect(Array.from(rawBytes)).not.toEqual(Array.from(original));

    const decrypted = await getDecrypted(testEnv.UPLOADS as any, db, TEST_KEK, row!.r2_key);
    expect(decrypted).not.toBeNull();
    expect(Array.from(decrypted!.bytes)).toEqual(Array.from(original));
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:worker -- test-workers/workOrderAttachmentsEncryption.test.ts`
Expected: FAIL — `rawBytes` equals `original`, and `getDecrypted` returns `null` (no `file_encryption_keys` row was written)

- [ ] **Step 4: Wire the route**

Add to `src/routes/workOrders.ts`'s import block:

```typescript
import { putEncrypted } from '../utils/encryptedR2';
```

Change the write (currently lines 619-624):

```typescript
    const buf = await file.arrayBuffer();
    const r2Key = `work-order-attachments/${id}/${Date.now()}_${filename}`;
    await uploads.put(r2Key, buf, {
      httpMetadata: { contentType: mime },
      customMetadata: { workOrderId: String(id), uploadedBy: String(userId) },
    });
```

to:

```typescript
    const buf = await file.arrayBuffer();
    const r2Key = `work-order-attachments/${id}/${Date.now()}_${filename}`;
    await putEncrypted(uploads, db, c.env.FILE_ENCRYPTION_KEK, r2Key, buf, {
      httpMetadata: { contentType: mime },
    });
```

(`customMetadata` is dropped for the same reason as Task 4's `photoStore.ts` — `putEncrypted` only accepts `httpMetadata`. `workOrderId`/`uploadedBy` are already persisted as real columns on the `work_order_attachments` row a few lines below (`work_order_id`, `uploaded_by`), so nothing is lost. `db` is already in scope — `const db = getDb(c.env);` at line 600, the top of this handler.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:worker -- test-workers/workOrderAttachmentsEncryption.test.ts`
Expected: PASS (1/1)

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/routes/workOrders.ts test-workers/entry.ts test-workers/workOrderAttachmentsEncryption.test.ts
git commit -m "feat(work-orders): encrypt work-order-attachments/ writes at rest"
```

---

### Task 13: serveIntake.ts — encrypt `serve-intake/` write (buffer instead of stream) + both reads

**Files:**
- Modify: `src/routes/serveIntake.ts` (import, `:256-268` `storeToR2`, `:1097` read, `:1121` read)
- Modify: `test-workers/entry.ts` (mount `si` router — check the actual export name)
- Test: `test-workers/serveIntakeEncryption.test.ts`

**Interfaces:**
- Consumes: `putEncrypted`, `getDecrypted` from `src/utils/encryptedR2.ts`.

`storeToR2` currently writes via `file.stream()` directly into `bucket.put()` — a true streaming write, unlike every other Phase 2 prefix. `putEncrypted` requires a fully-buffered `ArrayBuffer | Uint8Array`. This is safe to change to whole-buffer here specifically because uploads are already hard-capped at `MAX_UPLOAD_BYTES = 25 * 1024 * 1024` (25 MB, `serveIntake.ts:185`) — well under the codebase's established 100 MB whole-buffer-safety ceiling — so buffering the whole file before encrypting introduces no new memory risk. (This is the opposite of `flexcam/events/`'s `drivingEvents.ts`, which has no comparable size guarantee and stays correctly excluded from this phase.)

- [ ] **Step 1: Mount the router**

`src/routes/serveIntake.ts` exports `si` as its default export (`serveIntake.ts:2424`). In `test-workers/entry.ts` add:

```typescript
import serveIntake from '../src/routes/serveIntake';
```

```typescript
app.route('/api/serve-intake', serveIntake);
```

(`serveIntake.ts` imports `getContainer` from `@cloudflare/containers` and calls Workers AI / Claude for OCR — mounting the router should still succeed at the module level even without those services configured, mirroring how `alpr.ts` already mounts fine in this same file despite needing `AI`/`ROBOFLOW_API_KEY`; only the specific `storeToR2`-exercising route under test needs to actually execute cleanly, not every handler in the file. If mounting fails at import time, that's a signal this assumption was wrong — investigate rather than working around it.)

- [ ] **Step 2: Write the failing test**

```typescript
// test-workers/serveIntakeEncryption.test.ts
import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { getDecrypted } from '../src/utils/encryptedR2';
import { envWithKek, TEST_KEK, ensureFileEncryptionKeysTable } from './helpers/fileEncryptionTestSchema';

// storeToR2 is not exported from serveIntake.ts (it's a module-private helper
// called only from the /upload route, which itself requires substantial DB
// fixture setup — serve_queue, serve_intake_documents, role middleware, and
// AI-dependent extraction that isn't mocked in this test harness). Testing
// the R2 write behavior directly against the real UPLOADS/DB bindings proves
// the encryption contract without needing the full /upload pipeline. Before
// this task is done, read serveIntake.ts's storeToR2 signature (env, file,
// uploaderId) to confirm this test still matches it after Step 4's edit.
describe('serve-intake/ storage — envelope encryption (direct storeToR2 contract check)', () => {
  it('a file written the way storeToR2 will write it round-trips through getDecrypted', async () => {
    await ensureFileEncryptionKeysTable(env.DB as unknown as import('@cloudflare/workers-types').D1Database);
    const testEnv = envWithKek(env as unknown as Record<string, unknown>);
    const { putEncrypted } = await import('../src/utils/encryptedR2');

    const original = new Uint8Array([2, 4, 6, 8, 10]);
    const key = 'serve-intake/1/test-doc.pdf';
    await putEncrypted(testEnv.UPLOADS as any, env.DB as any, TEST_KEK, key, original, { httpMetadata: { contentType: 'application/pdf' } });

    const raw = await (testEnv as any).UPLOADS.get(key);
    const rawBytes = new Uint8Array(await raw!.arrayBuffer());
    expect(Array.from(rawBytes)).not.toEqual(Array.from(original));

    const decrypted = await getDecrypted(testEnv.UPLOADS as any, env.DB as any, TEST_KEK, key);
    expect(Array.from(decrypted!.bytes)).toEqual(Array.from(original));
  });
});
```

This task's real proof that `storeToR2` itself calls `putEncrypted` correctly (not just that `putEncrypted` works, which Phase 1 already covers in `tests/encryptedR2.test.ts`) is a code-level check, not a route-level one — Step 4 below shows the exact diff, and `npm run typecheck` (Step 6) will fail if the call signature is wrong.

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:worker -- test-workers/serveIntakeEncryption.test.ts`
Expected: FAIL — `rawBytes` equals `original` (this test calls `putEncrypted` directly, so it will actually PASS immediately since `encryptedR2.ts` already works from Phase 1; re-read this step once Step 2 is written — if it passes before Step 4, that is expected and fine, since this test's purpose is a smoke check on the primitive's usage shape, not a red/green gate on `serveIntake.ts` itself. Proceed to Step 4 regardless.)

- [ ] **Step 4: Wire `storeToR2`**

Add to `src/routes/serveIntake.ts`'s import block:

```typescript
import { putEncrypted, getDecrypted } from '../utils/encryptedR2';
```

Change `storeToR2` (currently lines 256-268):

```typescript
async function storeToR2(env: Env['Bindings'], file: File, uploaderId: number | null): Promise<string> {
  const ts = Date.now();
  const safeName = (file.name || 'upload').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  const key = `serve-intake/${uploaderId ?? 'anon'}/${ts}-${crypto.randomUUID().slice(0, 8)}-${safeName}`;
  await env.UPLOADS.put(key, file.stream(), {
    httpMetadata: { contentType: file.type || 'application/octet-stream' },
    customMetadata: {
      original_name: file.name || '',
      uploaded_by: String(uploaderId ?? ''),
    },
  });
  return key;
}
```

to:

```typescript
async function storeToR2(env: Env['Bindings'], file: File, uploaderId: number | null): Promise<string> {
  const ts = Date.now();
  const safeName = (file.name || 'upload').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  const key = `serve-intake/${uploaderId ?? 'anon'}/${ts}-${crypto.randomUUID().slice(0, 8)}-${safeName}`;
  await putEncrypted(env.UPLOADS, getDb(env), env.FILE_ENCRYPTION_KEK, key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type || 'application/octet-stream' },
  });
  return key;
}
```

(Files are capped at `MAX_UPLOAD_BYTES = 25 * 1024 * 1024` per this file's `scanDocumentHandler` size check — safe to buffer whole, see the task's rationale above. `customMetadata` is dropped for the same reason as Tasks 4 and 12; `original_name`/`uploaded_by` are already captured elsewhere in the intake commit flow via `commitIntake`'s own DB writes.)

Change the read at line 1097 (inside `GET /documents/:docId/file`):

```typescript
  const obj = await c.env.UPLOADS.get(doc.r2_key);
  if (!obj) return c.json({ error: 'File missing in R2' }, 404);
  return new Response(obj.body, {
    headers: {
      'Content-Type': doc.file_type || 'application/octet-stream',
      'Content-Disposition': `inline; filename="${(doc.file_name || 'document').replace(/"/g, '')}"`,
      'Cache-Control': 'private, max-age=300',
    },
  });
```

to:

```typescript
  const decrypted = await getDecrypted(c.env.UPLOADS, db, c.env.FILE_ENCRYPTION_KEK, doc.r2_key);
  if (!decrypted) return c.json({ error: 'File missing in R2' }, 404);
  return new Response(decrypted.bytes, {
    headers: {
      'Content-Type': doc.file_type || 'application/octet-stream',
      'Content-Disposition': `inline; filename="${(doc.file_name || 'document').replace(/"/g, '')}"`,
      'Cache-Control': 'private, max-age=300',
    },
  });
```

(`db` is already in scope — `const db = getDb(c.env);` at line 1090.)

Change the read at line 1121 (inside `reprocessDocument`):

```typescript
  if (isImage(doc.file_type) && doc.r2_key) {
    const obj = await c.env.UPLOADS.get(doc.r2_key);
    if (obj) extraction = await ocrImage(c.env, new Uint8Array(await obj.arrayBuffer()), doc.file_type).catch(() => null);
  } else if ((doc.raw_text || '').trim().length >= 20) {
```

to:

```typescript
  if (isImage(doc.file_type) && doc.r2_key) {
    const decrypted = await getDecrypted(c.env.UPLOADS, db, c.env.FILE_ENCRYPTION_KEK, doc.r2_key);
    if (decrypted) extraction = await ocrImage(c.env, decrypted.bytes, doc.file_type).catch(() => null);
  } else if ((doc.raw_text || '').trim().length >= 20) {
```

(`db` is already in scope — `const db = getDb(c.env);` at line 1118, the top of `reprocessDocument`.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:worker -- test-workers/serveIntakeEncryption.test.ts`
Expected: PASS (1/1)

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/routes/serveIntake.ts test-workers/entry.ts test-workers/serveIntakeEncryption.test.ts
git commit -m "feat(serve-intake): encrypt serve-intake/ documents at rest"
```

---

## Final Verification (after all 13 tasks)

- [ ] Run the full test suite: `npm test` (node vitest, `tests/**`) — expect all passing, no regressions in `tests/encryptedR2.test.ts` or any pre-existing test.
- [ ] Run the Worker test suite: `npm run test:worker` (Miniflare, `test-workers/**`) — expect all passing, including every new file from Tasks 1/5/6/7/8/9/10/11/12/13.
- [ ] Run `npm run typecheck` (Worker) and `cd client && npx tsc --noEmit` (client — should be unaffected, this plan touches no client files) — both clean.
- [ ] Manual smoke test (documented, not scripted, per the approved design doc): with a live/local Worker running, key or simulate a radio transmission and confirm it still records, and that playback (including seeking/scrubbing) still works correctly after Tasks 2 and 3's changes. This is the one prefix without automated write-path test coverage (no Durable Object test harness exists in this codebase).
- [ ] Grep for any remaining unencrypted `UPLOADS.put`/`UPLOADS.get`/`UPLOADS.delete` call site within this plan's 9 in-scope prefixes to confirm nothing was missed: `grep -rn "UPLOADS\.\(put\|get\|delete\)" src/ --include=*.ts | grep -v "encryptedR2.ts\|flexcam\|dashcam\|drivingEvents\|bodyCamera\|clearpathSync\|clearpathgps\|fleet.ts\|concat.ts\|footageAlpr"` — every remaining hit should be inside a task's already-modified file (meaning it's a call this plan intentionally left alone, e.g. a `.list()` or a prefix genuinely out of scope) or a genuine gap to fix before calling Phase 2 done.

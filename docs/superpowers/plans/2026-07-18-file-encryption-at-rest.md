# File Encryption at Rest (Phase 1: field-photos) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reusable envelope-encryption wrapper around R2 access, and pilot it on the
`field-photos/` R2 prefix — the only two files that actually write/read that prefix
(`fieldPhotos.ts`, and one conditional write in `alpr.ts`).

**Architecture:** Each file gets a fresh random 256-bit Data Encryption Key (DEK), AES-GCM-wrapped
by a master `FILE_ENCRYPTION_KEK` Worker secret and stored in a new `file_encryption_keys` D1
table (never in R2 metadata). `src/utils/encryptedR2.ts` exposes `putEncrypted`/`getDecrypted`/
`deleteEncryptionKey` as drop-in replacements for `R2Bucket.put()`/`.get()`/`.delete()`, so the
encryption step is structurally unavoidable rather than a convention callers must remember.

**Tech Stack:** WebCrypto (`crypto.subtle`) AES-GCM, matching the existing pattern in
`src/utils/cpgCrypto.ts`. No new dependency.

## Global Constraints

- **Encryption failures must fail CLOSED, not open.** If `FILE_ENCRYPTION_KEK` is missing or
  malformed, `putEncrypted`/`getDecrypted` must throw (a typed `FileEncryptionError`, mirroring
  `cpgCrypto.ts`'s `CpgCryptoError`) — never silently store/serve plaintext. This is the opposite
  of `pdfSign.ts`'s graceful-fallback-to-JWT_SECRET pattern; that pattern is safe for signing
  (degrading gracefully doesn't create a new vulnerability), this is not (silently skipping
  encryption would defeat the entire feature without anyone noticing).
- **Two independent, freshly-random IVs per file** — one for wrapping the DEK, one for encrypting
  the file content. Never reuse an IV across the two operations.
- **Wrapped keys live in D1 (`file_encryption_keys`), never in R2 object metadata.**
- **Scope is exactly two call sites**: `fieldPhotos.ts`'s upload/stream/delete, and
  `alpr.ts:507`'s conditional write ONLY when it targets `field-photos/` (i.e. `attachToCall` is
  true). `alpr.ts:972` and `alpr.ts:1002` target different prefixes (`alpr-captures/`,
  `alpr/vehicles/`) and must NOT be touched.
- **No streaming/chunked encryption** — every object in this scope is well under the 100MB
  Workers-isolate-safe ceiling already established elsewhere in this codebase (field photos cap
  at 12MB via `fieldPhotos.ts`'s existing `MAX_SIZE`).
- `algorithm_version` column value is the literal string `'file-enc-v1'` everywhere it appears.

---

## File Map

| File | Change |
|---|---|
| `migrations/0194_file_encryption_keys.sql` | New — the wrapped-key table |
| `src/types.ts` | Add `FILE_ENCRYPTION_KEK?: string;` to `Bindings` |
| `src/utils/encryptedR2.ts` | New — the envelope-encryption wrapper |
| `tests/encryptedR2.test.ts` | New — unit tests with mocked R2/D1 |
| `src/routes/fieldPhotos.ts` | Upload/stream/delete switch to the wrapper |
| `src/routes/alpr.ts` | Line 507's conditional write switches to the wrapper |
| `test-workers/entry.ts` | Mount `fieldPhotos` router for the integration test |
| `test-workers/fieldPhotosEncryption.test.ts` | New — Miniflare end-to-end test |

---

### Task 1: `file_encryption_keys` migration

**Files:**
- Create: `migrations/0194_file_encryption_keys.sql`

**Interfaces:**
- Produces: the table Task 2's `encryptedR2.ts` reads/writes.

- [ ] **Step 1: Create the migration**

Create `migrations/0194_file_encryption_keys.sql`:

```sql
-- 0194 — file_encryption_keys: envelope-encryption wrapped keys for R2 objects
-- protected by src/utils/encryptedR2.ts. Each row holds one file's AES-GCM-wrapped
-- Data Encryption Key (DEK), wrapped by the FILE_ENCRYPTION_KEK Worker secret.
-- Deleting a row ("crypto-shredding") permanently destroys that file's decryptability
-- without needing to guarantee the underlying R2 bytes are gone.
-- See docs/superpowers/specs/2026-07-18-file-encryption-at-rest-design.md.
CREATE TABLE IF NOT EXISTS file_encryption_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  r2_key TEXT NOT NULL UNIQUE,
  wrapped_dek TEXT NOT NULL,       -- base64 AES-GCM ciphertext of the DEK
  dek_iv TEXT NOT NULL,            -- base64, IV used to wrap the DEK
  file_iv TEXT NOT NULL,           -- base64, IV used to encrypt the file content itself
  algorithm_version TEXT NOT NULL, -- literal 'file-enc-v1' today
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

- [ ] **Step 2: Apply it locally**

Run: `npm run migrate:local`
Expected: exits 0.

- [ ] **Step 3: Verify the table exists with the right schema**

Run:
```bash
npx wrangler d1 execute rmpg-flex --local --command "SELECT sql FROM sqlite_master WHERE name='file_encryption_keys'"
```
Expected: prints the `CREATE TABLE` statement from Step 1.

- [ ] **Step 4: Commit**

```bash
git add migrations/0194_file_encryption_keys.sql
git commit -m "feat(db): add file_encryption_keys table (migration 0194)"
```

---

### Task 2: `encryptedR2.ts` — the envelope-encryption wrapper

**Files:**
- Modify: `src/types.ts`
- Create: `src/utils/encryptedR2.ts`
- Test: `tests/encryptedR2.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export class FileEncryptionError extends Error {}
  export async function putEncrypted(bucket: R2Bucket, db: D1Database, kekB64: string | undefined, key: string, bytes: ArrayBuffer | Uint8Array, opts?: { httpMetadata?: R2HTTPMetadata }): Promise<void>
  export async function getDecrypted(bucket: R2Bucket, db: D1Database, kekB64: string | undefined, key: string): Promise<{ bytes: Uint8Array; httpMetadata?: R2HTTPMetadata } | null>
  export async function deleteEncryptionKey(db: D1Database, key: string): Promise<void>
  ```
  `getDecrypted` returns `null` when the R2 object doesn't exist OR when no `file_encryption_keys`
  row exists for it (object present but un-decryptable — e.g. already crypto-shredded).
  `putEncrypted`/`getDecrypted` throw `FileEncryptionError` when `kekB64` is missing or doesn't
  decode to 32 bytes.

- [ ] **Step 1: Add the Bindings field**

In `src/types.ts`, find the `Bindings` type's `PDF_SIGNING_KEY?: string;` line and add directly
after it:

```ts
  // Master Key-Encryption-Key for envelope-encrypted R2 storage (src/utils/encryptedR2.ts).
  // Wraps a fresh random per-file Data Encryption Key for each protected upload. Base64 of
  // 32 random bytes — provision via:
  //   node scripts/generate-quantum-key.mjs 32 | wrangler secret put FILE_ENCRYPTION_KEK
  FILE_ENCRYPTION_KEK?: string;
```

- [ ] **Step 2: Write the failing tests**

Create `tests/encryptedR2.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { putEncrypted, getDecrypted, deleteEncryptionKey, FileEncryptionError } from '../src/utils/encryptedR2';

// A deterministic base64 32-byte KEK for tests.
const KEK = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i)));

function makeMockBucket() {
  const store = new Map<string, { data: ArrayBuffer; httpMetadata?: { contentType?: string } }>();
  return {
    bucket: {
      async put(key: string, data: ArrayBuffer | Uint8Array, opts?: { httpMetadata?: { contentType?: string } }) {
        const buf = data instanceof Uint8Array ? data.slice().buffer : data;
        store.set(key, { data: buf, httpMetadata: opts?.httpMetadata });
      },
      async get(key: string) {
        const entry = store.get(key);
        if (!entry) return null;
        return { arrayBuffer: async () => entry.data, httpMetadata: entry.httpMetadata };
      },
    } as any,
    store,
  };
}

function makeMockDb() {
  const rows = new Map<string, { wrapped_dek: string; dek_iv: string; file_iv: string }>();
  return {
    db: {
      prepare(sql: string) {
        return {
          bind(...args: unknown[]) {
            return {
              async run() {
                if (sql.includes('INSERT INTO file_encryption_keys')) {
                  const [r2_key, wrapped_dek, dek_iv, file_iv] = args as string[];
                  rows.set(r2_key, { wrapped_dek, dek_iv, file_iv });
                } else if (sql.includes('DELETE FROM file_encryption_keys')) {
                  rows.delete(args[0] as string);
                }
                return { success: true };
              },
              async first() {
                return rows.get(args[0] as string) ?? null;
              },
            };
          },
        };
      },
    } as any,
    rows,
  };
}

describe('encryptedR2', () => {
  it('round-trips: putEncrypted then getDecrypted returns the original bytes', async () => {
    const { bucket } = makeMockBucket();
    const { db } = makeMockDb();
    const original = new TextEncoder().encode('hello evidence photo bytes');
    await putEncrypted(bucket, db, KEK, 'field-photos/a.jpg', original, { httpMetadata: { contentType: 'image/jpeg' } });
    const result = await getDecrypted(bucket, db, KEK, 'field-photos/a.jpg');
    expect(result).not.toBeNull();
    expect(new TextDecoder().decode(result!.bytes)).toBe('hello evidence photo bytes');
    expect(result!.httpMetadata?.contentType).toBe('image/jpeg');
  });

  it('stores ciphertext in R2, not plaintext', async () => {
    const { bucket, store } = makeMockBucket();
    const { db } = makeMockDb();
    const original = new TextEncoder().encode('sensitive content');
    await putEncrypted(bucket, db, KEK, 'field-photos/b.jpg', original);
    const stored = new Uint8Array(store.get('field-photos/b.jpg')!.data);
    expect(new TextDecoder().decode(stored)).not.toContain('sensitive content');
  });

  it('two files with identical plaintext produce different ciphertext (fresh DEK per file)', async () => {
    const { bucket, store } = makeMockBucket();
    const { db } = makeMockDb();
    const original = new TextEncoder().encode('same content both times');
    await putEncrypted(bucket, db, KEK, 'field-photos/c1.jpg', original);
    await putEncrypted(bucket, db, KEK, 'field-photos/c2.jpg', original);
    const c1 = new Uint8Array(store.get('field-photos/c1.jpg')!.data);
    const c2 = new Uint8Array(store.get('field-photos/c2.jpg')!.data);
    expect(Array.from(c1)).not.toEqual(Array.from(c2));
  });

  it('crypto-shredding: deleting the D1 row makes the file permanently undecryptable even though the R2 object still exists', async () => {
    const { bucket, store } = makeMockBucket();
    const { db } = makeMockDb();
    await putEncrypted(bucket, db, KEK, 'field-photos/d.jpg', new TextEncoder().encode('shred me'));
    await deleteEncryptionKey(db, 'field-photos/d.jpg');
    expect(store.has('field-photos/d.jpg')).toBe(true); // R2 object untouched
    const result = await getDecrypted(bucket, db, KEK, 'field-photos/d.jpg');
    expect(result).toBeNull(); // but undecryptable
  });

  it('getDecrypted returns null for a key that was never stored', async () => {
    const { bucket } = makeMockBucket();
    const { db } = makeMockDb();
    expect(await getDecrypted(bucket, db, KEK, 'field-photos/never-existed.jpg')).toBeNull();
  });

  it('throws FileEncryptionError when the KEK is missing', async () => {
    const { bucket } = makeMockBucket();
    const { db } = makeMockDb();
    await expect(putEncrypted(bucket, db, undefined, 'field-photos/e.jpg', new Uint8Array([1, 2, 3])))
      .rejects.toBeInstanceOf(FileEncryptionError);
  });

  it('throws FileEncryptionError when the KEK is the wrong length', async () => {
    const { bucket } = makeMockBucket();
    const { db } = makeMockDb();
    await expect(putEncrypted(bucket, db, btoa('too-short'), 'field-photos/f.jpg', new Uint8Array([1, 2, 3])))
      .rejects.toBeInstanceOf(FileEncryptionError);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/encryptedR2.test.ts`
Expected: FAIL — `src/utils/encryptedR2.ts` doesn't exist yet.

- [ ] **Step 4: Implement**

Create `src/utils/encryptedR2.ts`:

```ts
// ============================================================
// RMPG Flex — Envelope-encrypted R2 access
// ============================================================
// Wraps R2Bucket.put()/.get() so every consumer of a protected prefix gets
// AES-GCM encryption at rest automatically — the encryption step is
// structurally unavoidable rather than a convention callers must remember.
//
// Envelope model: each file gets a fresh random 256-bit Data Encryption Key
// (DEK). The DEK is itself AES-GCM-wrapped by a master Key-Encryption-Key
// (env.FILE_ENCRYPTION_KEK, a Worker secret) and stored in the
// file_encryption_keys D1 table alongside the file's R2 key — never in R2
// object metadata. Deleting that D1 row ("crypto-shredding") permanently
// destroys access to that one file without touching any other file or the
// R2 object itself.
//
// Fails CLOSED: a missing/malformed KEK throws FileEncryptionError rather
// than silently storing/serving plaintext — unlike src/utils/pdfSign.ts's
// graceful JWT_SECRET fallback, silently skipping encryption here would
// defeat the whole feature without anyone noticing.
//
// See docs/superpowers/specs/2026-07-18-file-encryption-at-rest-design.md.
// ============================================================

export class FileEncryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileEncryptionError';
  }
}

const ALGORITHM_VERSION = 'file-enc-v1';

function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importKek(kekB64: string | undefined): Promise<CryptoKey> {
  if (!kekB64) {
    throw new FileEncryptionError('FILE_ENCRYPTION_KEK is not set (wrangler secret put FILE_ENCRYPTION_KEK)');
  }
  let raw: Uint8Array;
  try {
    raw = base64ToBytes(kekB64.trim());
  } catch {
    throw new FileEncryptionError('FILE_ENCRYPTION_KEK is not valid base64');
  }
  if (raw.length !== 32) {
    throw new FileEncryptionError(`FILE_ENCRYPTION_KEK must decode to 32 bytes (got ${raw.length})`);
  }
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

interface EncryptionKeyRow {
  wrapped_dek: string;
  dek_iv: string;
  file_iv: string;
}

/** Encrypt `bytes` with a fresh random per-file DEK, wrap the DEK with the
 *  KEK, write the ciphertext to R2 and the wrapped key to D1. */
export async function putEncrypted(
  bucket: R2Bucket,
  db: D1Database,
  kekB64: string | undefined,
  key: string,
  bytes: ArrayBuffer | Uint8Array,
  opts?: { httpMetadata?: R2HTTPMetadata },
): Promise<void> {
  const kek = await importKek(kekB64);

  const dekRaw = crypto.getRandomValues(new Uint8Array(32));
  const dek = await crypto.subtle.importKey('raw', dekRaw, { name: 'AES-GCM' }, false, ['encrypt']);

  const plainBytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const fileIv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: fileIv }, dek, plainBytes);

  const dekIv = crypto.getRandomValues(new Uint8Array(12));
  const wrappedDek = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: dekIv }, kek, dekRaw);

  await bucket.put(key, ciphertext, opts);
  await db.prepare(
    'INSERT INTO file_encryption_keys (r2_key, wrapped_dek, dek_iv, file_iv, algorithm_version) VALUES (?, ?, ?, ?, ?)',
  ).bind(
    key,
    bytesToBase64(new Uint8Array(wrappedDek)),
    bytesToBase64(dekIv),
    bytesToBase64(fileIv),
    ALGORITHM_VERSION,
  ).run();
}

/** Fetch and decrypt a file. Returns null if the R2 object doesn't exist,
 *  or if it exists but has no file_encryption_keys row (e.g. already
 *  crypto-shredded) — either way, there's nothing decryptable to return. */
export async function getDecrypted(
  bucket: R2Bucket,
  db: D1Database,
  kekB64: string | undefined,
  key: string,
): Promise<{ bytes: Uint8Array; httpMetadata?: R2HTTPMetadata } | null> {
  const obj = await bucket.get(key);
  if (!obj) return null;

  const row = await db.prepare(
    'SELECT wrapped_dek, dek_iv, file_iv FROM file_encryption_keys WHERE r2_key = ?',
  ).bind(key).first<EncryptionKeyRow>();
  if (!row) return null;

  const kek = await importKek(kekB64);
  const dekRaw = new Uint8Array(await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(row.dek_iv) }, kek, base64ToBytes(row.wrapped_dek),
  ));
  const dek = await crypto.subtle.importKey('raw', dekRaw, { name: 'AES-GCM' }, false, ['decrypt']);

  const ciphertext = await obj.arrayBuffer();
  const plainBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(row.file_iv) }, dek, ciphertext,
  );

  return { bytes: new Uint8Array(plainBuf), httpMetadata: obj.httpMetadata };
}

/** Crypto-shred: permanently destroy the ability to decrypt one file,
 *  without touching the R2 object or any other file's key. */
export async function deleteEncryptionKey(db: D1Database, key: string): Promise<void> {
  await db.prepare('DELETE FROM file_encryption_keys WHERE r2_key = ?').bind(key).run();
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/encryptedR2.test.ts`
Expected: PASS (all 7 tests).

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/utils/encryptedR2.ts tests/encryptedR2.test.ts
git commit -m "feat(encrypted-r2): add envelope-encryption wrapper for R2 access"
```

---

### Task 3: Wire `fieldPhotos.ts` to the encrypted wrapper

**Files:**
- Modify: `src/routes/fieldPhotos.ts`

**Interfaces:**
- Consumes: `putEncrypted`, `getDecrypted`, `deleteEncryptionKey` (Task 2).

- [ ] **Step 1: Implement**

In `src/routes/fieldPhotos.ts`, add the import (with the other imports at the top):

```ts
import { putEncrypted, getDecrypted, deleteEncryptionKey } from '../utils/encryptedR2';
```

Replace the upload block — currently `const db = getDb(c.env);` is declared AFTER the R2 put; it
needs to move above so it can be reused for `putEncrypted` too (calling `getDb(c.env)` twice would
work but is needless duplication). Currently:
```ts
  await c.env.UPLOADS.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type },
  });

  const db = getDb(c.env);
  await ensureTable(db);
```
becomes:
```ts
  const db = getDb(c.env);
  await putEncrypted(c.env.UPLOADS, db, c.env.FILE_ENCRYPTION_KEK, key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type },
  });

  await ensureTable(db);
```

Replace the `GET /file/*` handler body (currently):
```ts
fieldPhotos.get('/file/*', async (c) => {
  const key = c.req.path.replace(/^.*\/file\//, '');
  if (!key.startsWith('field-photos/') || key.includes('..')) {
    return c.json({ error: 'Invalid key' }, 400);
  }
  const obj = await c.env.UPLOADS.get(key);
  if (!obj) return c.json({ error: 'Not found' }, 404);
  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType || 'image/jpeg',
      'Cache-Control': 'private, max-age=3600',
    },
  });
});
```
with:
```ts
fieldPhotos.get('/file/*', async (c) => {
  const key = c.req.path.replace(/^.*\/file\//, '');
  if (!key.startsWith('field-photos/') || key.includes('..')) {
    return c.json({ error: 'Invalid key' }, 400);
  }
  const result = await getDecrypted(c.env.UPLOADS, getDb(c.env), c.env.FILE_ENCRYPTION_KEK, key);
  if (!result) return c.json({ error: 'Not found' }, 404);
  return new Response(result.bytes, {
    headers: {
      'Content-Type': result.httpMetadata?.contentType || 'image/jpeg',
      'Cache-Control': 'private, max-age=3600',
    },
  });
});
```

Update the `DELETE /:id` handler — add the encryption-key cleanup right after the existing R2
delete line. Currently:
```ts
  await c.env.UPLOADS.delete(row.r2_key);
  await execute(db, 'DELETE FROM field_photos WHERE id = ?', id);
```
becomes:
```ts
  await c.env.UPLOADS.delete(row.r2_key);
  await deleteEncryptionKey(db, row.r2_key);
  await execute(db, 'DELETE FROM field_photos WHERE id = ?', id);
```

- [ ] **Step 2: Verify the Worker typechecks**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/routes/fieldPhotos.ts
git commit -m "feat(field-photos): encrypt uploads at rest via encryptedR2"
```

---

### Task 4: Wire `alpr.ts`'s conditional field-photos write

**Files:**
- Modify: `src/routes/alpr.ts`

**Interfaces:**
- Consumes: `putEncrypted` (Task 2).

- [ ] **Step 1: Implement**

In `src/routes/alpr.ts`, add `putEncrypted` to the encryptedR2 import (create it if not already
imported — check the top of the file first; if `getDb` or similar is already imported from
`../utils/db`, add the new import as its own line):

```ts
import { putEncrypted } from '../utils/encryptedR2';
```

Replace the write at the site identified in the design doc (currently):
```ts
  let imageStored = true;
  try {
    await c.env.UPLOADS.put(imageKey, bytes, { httpMetadata: { contentType } });
  } catch (err: any) {
    imageStored = false;
    console.error('[alpr] R2 image put failed:', err?.message);
  }
```
with:
```ts
  let imageStored = true;
  try {
    if (attachToCall) {
      await putEncrypted(c.env.UPLOADS, db, c.env.FILE_ENCRYPTION_KEK, imageKey, bytes, { httpMetadata: { contentType } });
    } else {
      await c.env.UPLOADS.put(imageKey, bytes, { httpMetadata: { contentType } });
    }
  } catch (err: any) {
    imageStored = false;
    console.error('[alpr] R2 image put failed:', err?.message);
  }
```

(`db` is already in scope in this handler — it's used a few lines below for the `field_photos`
INSERT; do not redeclare it.)

**Do NOT touch** `alpr.ts:972` (`GET /image/*`, serves `alpr-captures/` only) or `alpr.ts:1002`
(crop upload, writes `alpr/vehicles/`) — neither touches `field-photos/`.

- [ ] **Step 2: Verify the Worker typechecks and tests pass**

Run: `npm run typecheck`
Expected: PASS.

Run: `npm test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/routes/alpr.ts
git commit -m "feat(alpr): encrypt call-attached captures written to field-photos/"
```

---

### Task 5: Miniflare integration test

**Files:**
- Modify: `test-workers/entry.ts`
- Create: `test-workers/fieldPhotosEncryption.test.ts`

**Interfaces:**
- Consumes: the real `fieldPhotos` router (Task 3), real Miniflare D1/R2/KV bindings.

- [ ] **Step 1: Mount `fieldPhotos` in the test entry**

In `test-workers/entry.ts`, add the import (with the other route imports):

```ts
import fieldPhotos from '../src/routes/fieldPhotos';
```

And mount it (with the other `app.route(...)` calls):

```ts
app.route('/api/field-photos', fieldPhotos);
```

- [ ] **Step 2: Write the failing test**

Create `test-workers/fieldPhotosEncryption.test.ts`:

```ts
import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import app from './entry';

// A deterministic base64 32-byte KEK for tests.
const KEK = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i)));

function envWithKek() {
  return { ...(env as unknown as Record<string, unknown>), FILE_ENCRYPTION_KEK: KEK };
}

describe('field-photos upload/stream/delete — end-to-end with real R2/D1', () => {
  it('uploads, streams back the original bytes, and stores ciphertext in R2', async () => {
    const testEnv = envWithKek();

    const form = new FormData();
    const original = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3, 4, 5]); // fake JPEG-ish bytes
    form.append('photo', new File([original], 'scene.jpg', { type: 'image/jpeg' }));

    const uploadRes = await app.request('/api/field-photos', { method: 'POST', body: form }, testEnv);
    expect(uploadRes.status).toBe(201);
    const uploadBody = await uploadRes.json() as { r2_key: string; url: string };
    expect(uploadBody.r2_key).toMatch(/^field-photos\/.+\.jpg$/);

    // The raw R2 object must NOT be the original plaintext bytes.
    const raw = await (testEnv as any).UPLOADS.get(uploadBody.r2_key);
    const rawBytes = new Uint8Array(await raw!.arrayBuffer());
    expect(Array.from(rawBytes)).not.toEqual(Array.from(original));

    // Streaming through the API must return the original bytes exactly.
    const streamRes = await app.request(`/api/field-photos/file/${uploadBody.r2_key}`, {}, testEnv);
    expect(streamRes.status).toBe(200);
    const streamedBytes = new Uint8Array(await streamRes.arrayBuffer());
    expect(Array.from(streamedBytes)).toEqual(Array.from(original));
  });

  it('returns 500-class failure (not silently-unencrypted upload) when FILE_ENCRYPTION_KEK is unset', async () => {
    const testEnv = { ...(env as unknown as Record<string, unknown>) }; // no FILE_ENCRYPTION_KEK
    const form = new FormData();
    form.append('photo', new File([new Uint8Array([1, 2, 3])], 'x.jpg', { type: 'image/jpeg' }));
    const res = await app.request('/api/field-photos', { method: 'POST', body: form }, testEnv);
    expect(res.status).toBeGreaterThanOrEqual(500);
  });
});
```

This task is integration verification of Tasks 1-4's already-implemented behavior, not new-feature
TDD — there is no meaningful RED state to drive here (the encryption behavior this test checks
already exists by the time this task runs). Run it once and expect a direct PASS.

- [ ] **Step 3: Run the test**

Run: `npx vitest run -c vitest.workers.config.mts test-workers/fieldPhotosEncryption.test.ts`
Expected: PASS (both tests). If either fails, that's a real regression in Tasks 1-4's
implementation — fix the implementation, not this test.

- [ ] **Step 4: Commit**

```bash
git add test-workers/entry.ts test-workers/fieldPhotosEncryption.test.ts
git commit -m "test(field-photos): add Miniflare end-to-end encryption test"
```

---

### Task 6: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Worker typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 2: Worker unit test suite**

Run: `npm test`
Expected: PASS, including `tests/encryptedR2.test.ts`.

- [ ] **Step 3: Worker Miniflare test suite**

Run: `npm run test:worker`
Expected: PASS, including `test-workers/fieldPhotosEncryption.test.ts` and all pre-existing
Miniflare tests (confirms mounting `fieldPhotos` in `test-workers/entry.ts` didn't break anything
else in that shared test entry).

- [ ] **Step 4: Confirm migration numbering**

Run: `ls migrations/ | grep -E "^0194" | sort`
Expected: only `0194_file_encryption_keys.sql`.

- [ ] **Step 5: Manual smoke-test note (document, do not script)**

This step is a manual reminder for whoever deploys this, not an automated check: after deploying
to a real environment with `FILE_ENCRYPTION_KEK` provisioned, perform one real ALPR capture
attached to a call (via the mobile `/field-camera?alpr=1` flow or the ALPR test harness) and
confirm the resulting photo opens correctly in that call's photo gallery — this exercises
`alpr.ts:507`'s conditional encrypted write end-to-end in a way the Miniflare test (Task 5,
`fieldPhotos.ts` only) doesn't cover.

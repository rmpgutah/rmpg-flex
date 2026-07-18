# R2 Presigned Direct-Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the browser upload large files straight to Cloudflare R2 over its S3-compatible API (bypassing the Worker's ~128MB memory ceiling), for both the general attachments uploader and a new admin-only map-data file manager.

**Architecture:** A shared `src/utils/r2Presign.ts` helper (built on `aws4fetch`) signs short-lived presigned PUT URLs for two R2 buckets — `rmpg-flex-uploads` (attachments, existing `UPLOADS` binding) and `system-essentials` (map data, existing `MAP_DATA` binding). The Worker never touches the file bytes: it only issues the presigned URL and, for attachments, records metadata after the client confirms the upload landed. Small attachment files keep using the existing Worker-proxied multipart upload unchanged.

**Tech Stack:** Hono (Worker routes), `aws4fetch` (SigV4 signing), Cloudflare R2 (S3-compatible API), D1 (`attachments` table, unchanged schema), KV (transient presign metadata), React + `XMLHttpRequest` (client upload with progress).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-18-r2-presigned-direct-upload-design.md` — read it before starting; every task below implements one of its sections.
- No D1 migration — schema is untouched (attachments unchanged, map-data has no table).
- `POST /api/uploads` (existing multipart route) and body-cam's chunked upload are NOT modified.
- Presigned-URL credentials (`R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`) are optional Worker secrets — every new endpoint that needs them must return `200 { ok: false, code: 'not_configured' }` when unset, never crash (per this repo's `feedback-503-not-configured-anti-pattern` convention).
- New R2-touching admin routes (`/api/admin/map-data/*`) must be admin-only, checked per-handler with the same local `requireRole(c, ...roles)` pattern already used in `src/routes/admin.ts` and `src/routes/cloudflare.ts` — do NOT rely on the public `/api/map-data` mount.
- Run `npm run typecheck` (root) after any `/src/` change and `cd client && npx tsc --noEmit` after any `/client/src/` change, per this repo's CI gates.

---

### Task 1: Shared R2 presign utility

**Files:**
- Create: `src/utils/r2Presign.ts`
- Modify: `src/types.ts` (add `R2_ACCESS_KEY_ID?`, `R2_SECRET_ACCESS_KEY?`, `R2_ACCOUNT_ID?` to `Bindings`)
- Modify: `wrangler.toml` (add `R2_ACCOUNT_ID` var)
- Test: `tests/r2Presign.test.ts`

**Interfaces:**
- Produces: `r2CredentialsConfigured(env: PresignEnv): boolean`, `presignPutUrl(env: PresignEnv, bucket: string, key: string, expiresInSeconds?: number): Promise<string>`, `export interface PresignEnv { R2_ACCESS_KEY_ID?: string; R2_SECRET_ACCESS_KEY?: string; R2_ACCOUNT_ID?: string }` — Tasks 2 and 5 both import these three names from `../utils/r2Presign`.

- [ ] **Step 1: Install `aws4fetch`**

Run: `npm install aws4fetch`
Expected: `package.json` "dependencies" gains an `aws4fetch` entry; `package-lock.json` updates.

- [ ] **Step 2: Add R2 credential fields to `Bindings`**

In `src/types.ts`, immediately after the `DOWNLOADS: R2Bucket;` line (inside the `DOWNLOADS` binding's block, before `JWT_SECRET: string;`), add:

```ts
  // R2 S3-API credentials for presigned direct uploads (src/utils/r2Presign.ts).
  // Optional — presign routes return `{ ok:false, code:'not_configured' }` when
  // unset instead of crashing. Set via `wrangler secret put R2_ACCESS_KEY_ID`
  // and `wrangler secret put R2_SECRET_ACCESS_KEY` (never committed).
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  // Cloudflare account id — not secret, also set as a plain var below.
  R2_ACCOUNT_ID?: string;
```

- [ ] **Step 3: Add `R2_ACCOUNT_ID` to `wrangler.toml`**

In `wrangler.toml`, inside the `[vars]` block, right after the `SERVER_TIMEZONE = "America/Denver"` line, add:

```toml
# Cloudflare account id (from the R2 S3-compatible endpoint host) — not
# secret. Used by src/utils/r2Presign.ts to build the presigned-PUT host
# for both R2 buckets (rmpg-flex-uploads, system-essentials).
R2_ACCOUNT_ID = "5caa95c5789f4fc4ed3934b2a2c29ed4"
```

- [ ] **Step 4: Write the failing test**

Create `tests/r2Presign.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { presignPutUrl, r2CredentialsConfigured } from '../src/utils/r2Presign';

describe('r2CredentialsConfigured', () => {
  it('returns false when any credential is missing', () => {
    expect(r2CredentialsConfigured({})).toBe(false);
    expect(r2CredentialsConfigured({ R2_ACCESS_KEY_ID: 'a' })).toBe(false);
    expect(r2CredentialsConfigured({ R2_ACCESS_KEY_ID: 'a', R2_SECRET_ACCESS_KEY: 'b' })).toBe(false);
  });

  it('returns true when all three are set', () => {
    expect(r2CredentialsConfigured({
      R2_ACCESS_KEY_ID: 'a', R2_SECRET_ACCESS_KEY: 'b', R2_ACCOUNT_ID: 'c',
    })).toBe(true);
  });
});

describe('presignPutUrl', () => {
  const env = {
    R2_ACCESS_KEY_ID: 'test-key',
    R2_SECRET_ACCESS_KEY: 'test-secret',
    R2_ACCOUNT_ID: 'abc123',
  };

  it('throws when credentials are not configured', async () => {
    await expect(presignPutUrl({}, 'my-bucket', 'foo.txt')).rejects.toThrow('not configured');
  });

  it('returns a signed URL scoped to the bucket and key, expiring in 900s by default', async () => {
    const url = await presignPutUrl(env, 'my-bucket', 'attachments/abc.jpg');
    expect(url.startsWith('https://abc123.r2.cloudflarestorage.com/my-bucket/attachments/abc.jpg')).toBe(true);
    expect(url).toContain('X-Amz-Signature=');
    expect(url).toContain('X-Amz-Expires=900');
  });

  it('URL-encodes special characters in the key', async () => {
    const url = await presignPutUrl(env, 'my-bucket', 'Map Overlay Database/my file.geojson');
    expect(url).toContain('Map%20Overlay%20Database/my%20file.geojson');
  });

  it('respects a custom expiry', async () => {
    const url = await presignPutUrl(env, 'my-bucket', 'k', 60);
    expect(url).toContain('X-Amz-Expires=60');
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npx vitest run tests/r2Presign.test.ts`
Expected: FAIL — `Cannot find module '../src/utils/r2Presign'`.

- [ ] **Step 6: Write the implementation**

Create `src/utils/r2Presign.ts`:

```ts
// ============================================================
// RMPG Flex — R2 presigned-PUT signer (shared)
// ============================================================
// Signs short-lived presigned PUT URLs against R2's S3-compatible API so
// the browser can upload large files directly to R2, bypassing the
// Worker's memory/CPU limits entirely. Used by:
//   - src/routes/uploads.ts        (attachments bucket: rmpg-flex-uploads)
//   - src/routes/adminMapData.ts   (map-data bucket: system-essentials)
//
// Both buckets share one R2 API token (Access Key ID + Secret Access Key,
// created in the R2 bucket settings page, scoped to both buckets) stored
// as Worker secrets — never committed, never pasted into chat. See the
// design spec's "Operator setup" section for how to provision them.
// ============================================================

import { AwsClient } from 'aws4fetch';

export interface PresignEnv {
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_ACCOUNT_ID?: string;
}

const DEFAULT_EXPIRES_SECONDS = 900;

export function r2CredentialsConfigured(env: PresignEnv): boolean {
  return Boolean(env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_ACCOUNT_ID);
}

// R2 object keys can contain spaces and other characters that must be
// percent-encoded per path segment (but NOT the `/` separators themselves).
function encodeR2Key(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/');
}

/**
 * Returns a presigned PUT URL for `bucket`/`key`, valid for
 * `expiresInSeconds` (default 900 = 15 minutes). Throws if R2 credentials
 * are not configured — callers should check `r2CredentialsConfigured()`
 * first and return a `not_configured` response instead of letting this
 * throw reach the client as a 500.
 */
export async function presignPutUrl(
  env: PresignEnv,
  bucket: string,
  key: string,
  expiresInSeconds: number = DEFAULT_EXPIRES_SECONDS,
): Promise<string> {
  if (!r2CredentialsConfigured(env)) {
    throw new Error('R2 presign credentials not configured');
  }

  const client = new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID!,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
    service: 's3',
    region: 'auto',
  });

  const url = new URL(
    `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${bucket}/${encodeR2Key(key)}`,
  );
  url.searchParams.set('X-Amz-Expires', String(expiresInSeconds));

  const signed = await client.sign(url.toString(), {
    method: 'PUT',
    aws: { signQuery: true },
  });

  return signed.url;
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run tests/r2Presign.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json src/utils/r2Presign.ts src/types.ts wrangler.toml tests/r2Presign.test.ts
git commit -m "Add shared R2 presigned-PUT signer (aws4fetch)"
```

---

### Task 2: Attachments presign + complete routes

**Files:**
- Modify: `src/routes/uploads.ts`
- Test: `tests/uploadsPresign.test.ts`

**Interfaces:**
- Consumes: `presignPutUrl`, `r2CredentialsConfigured` from `../utils/r2Presign` (Task 1); `resolveAuth(c)`, `extFor(name, type)`, `ALLOWED_MIME`, `ensureDefaultDocumentsFolder(db, userId)` — all already defined/imported in `uploads.ts`.
- Produces: `POST /api/uploads/presign` → `{ file_id: string, upload_url: string, key: string }`; `POST /api/uploads/presign/:fileId/complete` → the created `attachments` row (same shape as the existing `POST /api/uploads` response). Task 4 (client) calls both by these exact paths/shapes.

- [ ] **Step 1: Write the failing test**

Create `tests/uploadsPresign.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { SignJWT } from 'jose';
import uploads from '../src/routes/uploads';
import { recordingDb } from './helpers/fakeD1';

const JWT_SECRET = 'test-secret';

async function makeToken(userId = 1, role = 'officer') {
  return new SignJWT({ user_id: userId, username: 'tester', role, full_name: 'Test User' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

function makeFakeKv() {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => { store.set(key, value); },
    delete: async (key: string) => { store.delete(key); },
  } as unknown as KVNamespace;
}

function makeFakeUploadsBucket(headSize: number | null) {
  return {
    head: async (_key: string) => (headSize != null ? { size: headSize } : null),
  } as unknown as R2Bucket;
}

function baseEnv(kv: ReturnType<typeof makeFakeKv>, bucket: ReturnType<typeof makeFakeUploadsBucket>, db: D1Database) {
  return {
    DB: db,
    KV: kv,
    UPLOADS: bucket,
    JWT_SECRET,
    R2_ACCESS_KEY_ID: 'key',
    R2_SECRET_ACCESS_KEY: 'secret',
    R2_ACCOUNT_ID: 'acct123',
  } as any;
}

describe('POST /presign', () => {
  it('requires auth', async () => {
    const res = await uploads.request('/presign', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: 'a.jpg', contentType: 'image/jpeg', size: 100 }),
    }, baseEnv(makeFakeKv(), makeFakeUploadsBucket(null), recordingDb().db));
    expect(res.status).toBe(401);
  });

  it('rejects a disallowed content type', async () => {
    const token = await makeToken();
    const res = await uploads.request('/presign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ filename: 'a.exe', contentType: 'application/x-msdownload', size: 100 }),
    }, baseEnv(makeFakeKv(), makeFakeUploadsBucket(null), recordingDb().db));
    expect(res.status).toBe(400);
  });

  it('returns a presigned URL for a valid request', async () => {
    const token = await makeToken();
    const res = await uploads.request('/presign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ filename: 'video.mp4', contentType: 'video/mp4', size: 50_000_000 }),
    }, baseEnv(makeFakeKv(), makeFakeUploadsBucket(null), recordingDb().db));
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.file_id).toBeTruthy();
    expect(body.upload_url).toContain('acct123.r2.cloudflarestorage.com/rmpg-flex-uploads/');
    expect(body.key).toContain('attachments/');
  });

  it('returns not_configured when R2 credentials are unset', async () => {
    const token = await makeToken();
    const env = baseEnv(makeFakeKv(), makeFakeUploadsBucket(null), recordingDb().db);
    delete env.R2_ACCESS_KEY_ID;
    const res = await uploads.request('/presign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ filename: 'video.mp4', contentType: 'video/mp4', size: 50_000_000 }),
    }, env);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body).toEqual({ ok: false, code: 'not_configured' });
  });
});

describe('POST /presign/:fileId/complete', () => {
  it('404s (410) when the presign session is missing or expired', async () => {
    const token = await makeToken();
    const res = await uploads.request('/presign/does-not-exist/complete', {
      method: 'POST', headers: { Authorization: `Bearer ${token}` },
    }, baseEnv(makeFakeKv(), makeFakeUploadsBucket(null), recordingDb().db));
    expect(res.status).toBe(410);
  });

  it('inserts an attachments row on a successful full round-trip', async () => {
    const token = await makeToken(7, 'officer');
    const kv = makeFakeKv();
    const { db, calls } = recordingDb();

    const presignRes = await uploads.request('/presign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ filename: 'report.pdf', contentType: 'application/pdf', size: 1234 }),
    }, baseEnv(kv, makeFakeUploadsBucket(null), db));
    const { file_id: fileId } = await presignRes.json() as any;

    const completeRes = await uploads.request(`/presign/${fileId}/complete`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` },
    }, baseEnv(kv, makeFakeUploadsBucket(1234), db));

    expect(completeRes.status).toBe(201);
    expect(calls.some((c) => /INSERT INTO attachments/.test(c.sql))).toBe(true);
  });

  it('400s when the object never landed in R2', async () => {
    const token = await makeToken();
    const kv = makeFakeKv();
    const db = recordingDb().db;

    const presignRes = await uploads.request('/presign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ filename: 'report.pdf', contentType: 'application/pdf', size: 1234 }),
    }, baseEnv(kv, makeFakeUploadsBucket(null), db));
    const { file_id: fileId } = await presignRes.json() as any;

    const completeRes = await uploads.request(`/presign/${fileId}/complete`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` },
    }, baseEnv(kv, makeFakeUploadsBucket(null), db));
    expect(completeRes.status).toBe(400);
  });

  it('400s on a size mismatch', async () => {
    const token = await makeToken();
    const kv = makeFakeKv();
    const db = recordingDb().db;

    const presignRes = await uploads.request('/presign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ filename: 'report.pdf', contentType: 'application/pdf', size: 1234 }),
    }, baseEnv(kv, makeFakeUploadsBucket(null), db));
    const { file_id: fileId } = await presignRes.json() as any;

    const completeRes = await uploads.request(`/presign/${fileId}/complete`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` },
    }, baseEnv(kv, makeFakeUploadsBucket(999), db));
    expect(completeRes.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/uploadsPresign.test.ts`
Expected: FAIL — 404s from `uploads.request('/presign', ...)` (route doesn't exist yet).

- [ ] **Step 3: Write the implementation**

In `src/routes/uploads.ts`, add these imports at the top, alongside the existing ones:

```ts
import { presignPutUrl, r2CredentialsConfigured } from '../utils/r2Presign';
```

Add these constants near the top of the file, after `const MAX_FILE_SIZE = 500 * 1024 * 1024;`:

```ts
const UPLOADS_BUCKET_NAME = 'rmpg-flex-uploads';
const PRESIGN_MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024; // 2 GB — single-PUT ceiling
const PRESIGN_TTL_SECONDS = 1800; // 30 min — KV metadata TTL and presigned-URL expiry
const PRESIGN_KV_PREFIX = 'upload-presign:';

interface PresignMeta {
  r2Key: string;
  filename: string;
  contentType: string;
  size: number;
  entityType: string | null;
  entityId: number | null;
  folderId: number | null;
  userId: number;
}
```

Add these two routes right before `uploads.post('/create', ...)` (i.e. after the existing `uploads.post('/', ...)` handler ends):

```ts
uploads.post('/presign', async (c) => {
  try {
    const auth = await resolveAuth(c);
    if (!auth || !auth.userId) return c.json({ error: 'Authentication required' }, 401);

    if (!r2CredentialsConfigured(c.env)) {
      return c.json({ ok: false, code: 'not_configured' });
    }

    const body = await c.req.json<{
      filename?: string; contentType?: string; size?: number;
      entity_type?: string; entity_id?: number | string; folder_id?: number | string;
    }>().catch(() => null);
    if (!body) return c.json({ error: 'Invalid JSON body' }, 400);

    const filename = String(body.filename || '').trim();
    const contentType = String(body.contentType || '').trim();
    const size = Number(body.size);
    if (!filename) return c.json({ error: 'filename is required' }, 400);
    if (!ALLOWED_MIME.has(contentType)) {
      return c.json({ error: `File type ${contentType} is not allowed` }, 400);
    }
    if (!Number.isFinite(size) || size <= 0) {
      return c.json({ error: 'size must be positive' }, 400);
    }
    if (size > PRESIGN_MAX_FILE_SIZE) {
      return c.json({ error: `File too large — max ${PRESIGN_MAX_FILE_SIZE / 1024 / 1024} MB`, code: 'FILE_TOO_LARGE' }, 400);
    }

    const fileId = crypto.randomUUID();
    const ext = extFor(filename, contentType);
    const r2Key = `attachments/${fileId}${ext}`;

    const entityType = body.entity_type ? String(body.entity_type) : null;
    const entityIdRaw = body.entity_id != null ? String(body.entity_id) : null;
    const entityId = entityIdRaw ? parseInt(entityIdRaw, 10) : null;
    const folderIdRaw = body.folder_id != null ? String(body.folder_id) : null;
    const folderId = folderIdRaw && /^\d+$/.test(folderIdRaw) ? parseInt(folderIdRaw, 10) : null;

    const meta: PresignMeta = {
      r2Key, filename, contentType, size,
      entityType, entityId, folderId, userId: auth.userId,
    };
    await c.env.KV.put(`${PRESIGN_KV_PREFIX}${fileId}`, JSON.stringify(meta), {
      expirationTtl: PRESIGN_TTL_SECONDS,
    });

    const uploadUrl = await presignPutUrl(c.env, UPLOADS_BUCKET_NAME, r2Key, PRESIGN_TTL_SECONDS);

    return c.json({ file_id: fileId, upload_url: uploadUrl, key: r2Key });
  } catch (err) {
    console.error('Presign upload error:', err);
    return c.json({ error: 'Failed to create upload URL', code: 'PRESIGN_ERROR' }, 500);
  }
});

uploads.post('/presign/:fileId/complete', async (c) => {
  try {
    const auth = await resolveAuth(c);
    if (!auth || !auth.userId) return c.json({ error: 'Authentication required' }, 401);

    const fileId = c.req.param('fileId');
    const raw = await c.env.KV.get(`${PRESIGN_KV_PREFIX}${fileId}`);
    if (!raw) return c.json({ error: 'Upload session not found or expired', code: 'PRESIGN_EXPIRED' }, 410);
    const meta = JSON.parse(raw) as PresignMeta;

    if (meta.userId !== auth.userId) {
      return c.json({ error: 'Not authorized to complete this upload' }, 403);
    }

    const head = await c.env.UPLOADS.head(meta.r2Key);
    if (!head) {
      return c.json({ error: 'File was not found in storage — upload may have failed', code: 'UPLOAD_NOT_FOUND' }, 400);
    }
    if (head.size !== meta.size) {
      return c.json({
        error: 'Uploaded file size does not match the presigned request',
        code: 'SIZE_MISMATCH', expected: meta.size, actual: head.size,
      }, 400);
    }

    const db = getDb(c.env);

    let effectiveFolderId = meta.folderId;
    if (effectiveFolderId == null && meta.entityType == null) {
      try {
        effectiveFolderId = await ensureDefaultDocumentsFolder(db, auth.userId);
      } catch (e) {
        console.warn('[uploads] default documents folder resolve failed', e);
      }
    }

    const storedName = meta.r2Key.split('/').pop() || meta.r2Key;
    await execute(
      db,
      `INSERT INTO attachments (file_id, original_name, stored_name, file_path, mime_type, file_size, entity_type, entity_id, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      fileId, meta.filename, storedName, meta.r2Key, meta.contentType, meta.size,
      meta.entityType, meta.entityId, auth.userId,
    );

    if (effectiveFolderId != null) {
      try {
        await execute(db, 'UPDATE attachments SET folder_id = ? WHERE file_id = ?', effectiveFolderId, fileId);
      } catch (e) {
        console.warn('Upload: folder placement failed for', fileId, e);
      }
    }

    await c.env.KV.delete(`${PRESIGN_KV_PREFIX}${fileId}`).catch(() => undefined);

    await execute(
      db,
      `INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
       VALUES (?, 'file_uploaded', ?, ?, ?, ?)`,
      auth.userId,
      meta.entityType || 'attachment',
      meta.entityId,
      `Uploaded file: ${meta.filename}`,
      c.req.header('CF-Connecting-IP') || 'unknown',
    );

    const row = await queryFirst<any>(db, 'SELECT * FROM attachments WHERE file_id = ?', fileId);
    return c.json(row, 201);
  } catch (err) {
    console.error('Complete presigned upload error:', err);
    return c.json({ error: 'Failed to finalize upload', code: 'COMPLETE_UPLOAD_ERROR' }, 500);
  }
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/uploadsPresign.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/routes/uploads.ts tests/uploadsPresign.test.ts
git commit -m "Add presigned direct-to-R2 upload endpoints for attachments"
```

---

### Task 3: Client `putFileDirect` transport

**Files:**
- Modify: `client/src/utils/uploadWithProgress.ts`
- Test: `client/src/utils/__tests__/putFileDirect.test.ts`

**Interfaces:**
- Produces: `putFileDirect(url: string, file: File, onProgress?: (progress: UploadProgress) => void, signal?: AbortSignal): Promise<void>` — Task 4 imports this from `../utils/uploadWithProgress`.

- [ ] **Step 1: Write the failing test**

Create `client/src/utils/__tests__/putFileDirect.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { putFileDirect } from '../uploadWithProgress';

class FakeXHR {
  static instances: FakeXHR[] = [];
  method = '';
  url = '';
  status = 0;
  upload: { onprogress: ((e: any) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  headers: Record<string, string> = {};
  body: any = null;

  open(method: string, url: string) { this.method = method; this.url = url; FakeXHR.instances.push(this); }
  setRequestHeader(name: string, value: string) { this.headers[name] = value; }
  send(body: any) { this.body = body; }
  abort() { this.onabort?.(); }
}

describe('putFileDirect', () => {
  beforeEach(() => {
    FakeXHR.instances.length = 0;
    vi.stubGlobal('XMLHttpRequest', FakeXHR as unknown as typeof XMLHttpRequest);
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('PUTs the raw file with a Content-Type header and no Authorization header', async () => {
    const file = new File(['hello'], 'a.txt', { type: 'text/plain' });
    const promise = putFileDirect('https://example.r2.cloudflarestorage.com/bucket/key?sig=abc', file);
    const xhr = FakeXHR.instances[0];
    xhr.status = 200;
    xhr.onload?.();
    await expect(promise).resolves.toBeUndefined();
    expect(xhr.method).toBe('PUT');
    expect(xhr.headers['Content-Type']).toBe('text/plain');
    expect(xhr.headers['Authorization']).toBeUndefined();
    expect(xhr.body).toBe(file);
  });

  it('rejects on a non-2xx status', async () => {
    const file = new File(['x'], 'a.txt', { type: 'text/plain' });
    const promise = putFileDirect('https://x', file);
    const xhr = FakeXHR.instances[0];
    xhr.status = 500;
    xhr.onload?.();
    await expect(promise).rejects.toThrow(/500/);
  });

  it('reports progress with phase "uploading"', async () => {
    const file = new File(['x'], 'a.txt', { type: 'text/plain' });
    const onProgress = vi.fn();
    const promise = putFileDirect('https://x', file, onProgress);
    const xhr = FakeXHR.instances[0];
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 });
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ phase: 'uploading', percent: 50 }));
    xhr.status = 200;
    xhr.onload?.();
    await promise;
  });

  it('rejects with AbortError on network error', async () => {
    const file = new File(['x'], 'a.txt', { type: 'text/plain' });
    const promise = putFileDirect('https://x', file);
    const xhr = FakeXHR.instances[0];
    xhr.onerror?.();
    await expect(promise).rejects.toThrow(/Network error/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/utils/__tests__/putFileDirect.test.ts`
Expected: FAIL — `putFileDirect is not exported from '../uploadWithProgress'`.

- [ ] **Step 3: Write the implementation**

In `client/src/utils/uploadWithProgress.ts`, add this function after `uploadWithProgress` (before the `// ─── Format Helpers ──────────────────────────` section):

```ts
/**
 * PUT raw file bytes to a presigned URL (R2 direct upload) with progress
 * tracking. Unlike uploadWithProgress, this sends the raw file body (not
 * FormData) and never attaches an Authorization header — the presigned
 * URL's own signature is the auth; the target is a foreign origin
 * (*.r2.cloudflarestorage.com), not this app's API.
 */
export function putFileDirect(
  url: string,
  file: File,
  onProgress?: (progress: UploadProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const startTime = Date.now();

    if (signal) {
      if (signal.aborted) {
        reject(new DOMException('Upload aborted', 'AbortError'));
        return;
      }
      signal.addEventListener('abort', () => xhr.abort());
    }

    xhr.upload.onprogress = (e: ProgressEvent) => {
      if (!onProgress || !e.lengthComputable) return;
      const elapsed = (Date.now() - startTime) / 1000;
      const speed = elapsed > 0 ? e.loaded / elapsed : 0;
      const remaining = speed > 0 ? (e.total - e.loaded) / speed : 0;
      onProgress({
        loaded: e.loaded,
        total: e.total,
        percent: Math.round((e.loaded / e.total) * 100),
        speed,
        eta: remaining,
        phase: 'uploading',
      });
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.({ loaded: file.size, total: file.size, percent: 100, speed: 0, eta: 0, phase: 'done' });
        resolve();
      } else {
        onProgress?.({ loaded: 0, total: 0, percent: 0, speed: 0, eta: 0, phase: 'error' });
        reject(new Error(`Direct upload failed with status ${xhr.status}`));
      }
    };

    xhr.onerror = () => {
      onProgress?.({ loaded: 0, total: 0, percent: 0, speed: 0, eta: 0, phase: 'error' });
      reject(new Error('Network error during direct upload'));
    };

    xhr.onabort = () => {
      onProgress?.({ loaded: 0, total: 0, percent: 0, speed: 0, eta: 0, phase: 'error' });
      reject(new DOMException('Upload aborted', 'AbortError'));
    };

    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.send(file);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/utils/__tests__/putFileDirect.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add client/src/utils/uploadWithProgress.ts client/src/utils/__tests__/putFileDirect.test.ts
git commit -m "Add putFileDirect: raw XHR PUT transport for presigned R2 uploads"
```

---

### Task 4: Client `apiUploadFileDirect` + threshold routing

**Files:**
- Modify: `client/src/hooks/useApi.ts`
- Modify: `client/src/hooks/__tests__/apiUploadFiles.test.ts` (add 1 case)
- Test: `client/src/hooks/__tests__/apiUploadFileDirect.test.ts`

**Interfaces:**
- Consumes: `putFileDirect` from `../utils/uploadWithProgress` (Task 3); `POST /api/uploads/presign` and `POST /api/uploads/presign/:fileId/complete` (Task 2).
- Produces: `apiUploadFileDirect(file: File, entityType?: string, entityId?: string | number, onProgress?: (progress: UploadProgress) => void): Promise<any>`. `apiUploadFiles` and `apiUploadFilesWithProgress` keep their existing exported signatures — only their internal routing changes (files over 20MB go through `apiUploadFileDirect`).

- [ ] **Step 1: Write the failing tests**

Create `client/src/hooks/__tests__/apiUploadFileDirect.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiUploadFileDirect } from '../useApi';
import * as uploadWithProgress from '../../utils/uploadWithProgress';

vi.mock('../../utils/actionChimes', () => ({ chimeForApiSuccess: () => {}, nackForApiFailure: () => {} }));

const file = () => new File(['x'.repeat(30 * 1024 * 1024)], 'clip.mp4', { type: 'video/mp4' });

describe('apiUploadFileDirect', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let putSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    localStorage.setItem('rmpg_token', 'test-token');
    putSpy = vi.spyOn(uploadWithProgress, 'putFileDirect').mockResolvedValue(undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    putSpy.mockRestore();
  });

  it('presigns, PUTs directly, then completes — in that order', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        file_id: 'abc-123', upload_url: 'https://acct.r2.cloudflarestorage.com/bucket/key', key: 'attachments/abc-123.mp4',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ file_id: 'abc-123', original_name: 'clip.mp4' }), {
        status: 201, headers: { 'Content-Type': 'application/json' },
      }));

    const result = await apiUploadFileDirect(file(), 'bodycam_video', 42);

    expect(result).toEqual({ file_id: 'abc-123', original_name: 'clip.mp4' });
    expect(fetchMock).toHaveBeenNthCalledWith(1, expect.stringContaining('/api/uploads/presign'), expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, expect.stringContaining('/api/uploads/presign/abc-123/complete'), expect.objectContaining({ method: 'POST' }));
    expect(putSpy).toHaveBeenCalledWith('https://acct.r2.cloudflarestorage.com/bucket/key', expect.any(File), undefined);
  });

  it('propagates a PUT failure without calling complete', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      file_id: 'abc-123', upload_url: 'https://acct.r2.cloudflarestorage.com/bucket/key', key: 'attachments/abc-123.mp4',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    putSpy.mockRejectedValueOnce(new Error('Direct upload failed with status 500'));

    await expect(apiUploadFileDirect(file())).rejects.toThrow(/Direct upload failed/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
```

Add this case to the existing `client/src/hooks/__tests__/apiUploadFiles.test.ts` (append inside the top-level `describe('apiUploadFiles auto-retry', ...)` block, after the last existing `it(...)`):

```ts
  it('routes a file over the direct-upload threshold through presign, not /api/uploads', async () => {
    const bigFile = new File(['x'.repeat(21 * 1024 * 1024)], 'big.mp4', { type: 'video/mp4' });
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        file_id: 'big-1', upload_url: 'https://acct.r2.cloudflarestorage.com/bucket/key', key: 'attachments/big-1.mp4',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ file_id: 'big-1', original_name: 'big.mp4' }), {
        status: 201, headers: { 'Content-Type': 'application/json' },
      }));

    const putSpy = vi.spyOn(await import('../../utils/uploadWithProgress'), 'putFileDirect').mockResolvedValue(undefined);
    const out = await apiUploadFiles([bigFile]);

    expect(out).toEqual([{ file_id: 'big-1', original_name: 'big.mp4' }]);
    expect(fetchMock.mock.calls.every(([u]) => !String(u).endsWith('/api/uploads') || String(u).includes('presign'))).toBe(true);
    putSpy.mockRestore();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd client && npx vitest run src/hooks/__tests__/apiUploadFileDirect.test.ts src/hooks/__tests__/apiUploadFiles.test.ts`
Expected: FAIL — `apiUploadFileDirect is not exported from '../useApi'`.

- [ ] **Step 3: Write the implementation**

In `client/src/hooks/useApi.ts`, add this import at the top alongside the existing `uploadWithProgress` import:

```ts
import { uploadWithProgress, putFileDirect } from '../utils/uploadWithProgress';
```

(This replaces the existing `import { uploadWithProgress } from '../utils/uploadWithProgress';` line — add `putFileDirect` to the same import.)

Add this constant near `DEFAULT_FETCH_TIMEOUT_MS` (top of file):

```ts
// Files at or below this size go through the existing Worker-proxied
// multipart upload (POST /api/uploads); files above it go straight to R2
// via a presigned PUT, bypassing the Worker's memory ceiling. Matches the
// design spec's threshold — see docs/superpowers/specs/2026-07-18-r2-presigned-direct-upload-design.md.
const DIRECT_UPLOAD_THRESHOLD_BYTES = 20 * 1024 * 1024; // 20 MB
```

Add these two new exported functions right before `export async function apiUploadFiles(` :

```ts
async function presignAttachmentUpload(
  file: File,
  entityType?: string,
  entityId?: string | number,
): Promise<{ file_id: string; upload_url: string; key: string }> {
  return apiFetch('/uploads/presign', {
    method: 'POST',
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type || 'application/octet-stream',
      size: file.size,
      entity_type: entityType,
      entity_id: entityId,
    }),
  });
}

async function completeAttachmentUpload(fileId: string): Promise<any> {
  return apiFetch(`/uploads/presign/${fileId}/complete`, { method: 'POST', body: '{}' });
}

/** Upload one large file straight to R2 via a presigned PUT (see design spec). */
export async function apiUploadFileDirect(
  file: File,
  entityType?: string,
  entityId?: string | number,
  onProgress?: (progress: UploadProgress) => void,
): Promise<any> {
  const { file_id: fileId, upload_url: uploadUrl } = await presignAttachmentUpload(file, entityType, entityId);
  await putFileDirect(uploadUrl, file, onProgress);
  return completeAttachmentUpload(fileId);
}
```

Now rename the existing `apiUploadFiles` body to a private helper and make `apiUploadFiles` dispatch by size. Replace:

```ts
export async function apiUploadFiles(
  files: File[],
  entityType?: string,
  entityId?: string | number,
  opts?: UploadOptions,
): Promise<any[]> {
```

with:

```ts
async function apiUploadFilesMultipart(
  files: File[],
  entityType?: string,
  entityId?: string | number,
  opts?: UploadOptions,
): Promise<any[]> {
```

(Leave the rest of that function's body untouched.) Then, immediately after that function's closing `}`, add the new public `apiUploadFiles`:

```ts
export async function apiUploadFiles(
  files: File[],
  entityType?: string,
  entityId?: string | number,
  opts?: UploadOptions,
): Promise<any[]> {
  const smallFiles = files.filter((f) => f.size <= DIRECT_UPLOAD_THRESHOLD_BYTES);
  const largeFiles = files.filter((f) => f.size > DIRECT_UPLOAD_THRESHOLD_BYTES);

  const results: any[] = [];
  if (smallFiles.length > 0) {
    results.push(...await apiUploadFilesMultipart(smallFiles, entityType, entityId, opts));
  }
  for (const file of largeFiles) {
    results.push(await apiUploadFileDirect(file, entityType, entityId));
  }
  return results;
}
```

Finally, in `apiUploadFilesWithProgress`, replace the `for` loop body so it branches per-file:

```ts
  // Upload files one at a time so progress tracks per-file
  for (let i = 0; i < files.length; i++) {
    const file = files[i];

    if (file.size > DIRECT_UPLOAD_THRESHOLD_BYTES) {
      const result = await apiUploadFileDirect(file, entityType, entityId, (progress) => onProgress(progress, i, files.length));
      results.push(result);
      continue;
    }

    const formData = new FormData();
    formData.append('files', file);
    if (entityType) formData.append('entity_type', entityType);
    if (entityId) formData.append('entity_id', String(entityId));

    const result = await uploadWithProgress(
      '/api/uploads',
      formData,
      token,
      (progress) => onProgress(progress, i, files.length),
    );

    // Server returns an array of uploaded file records
    if (Array.isArray(result)) {
      results.push(...result);
    } else {
      results.push(result);
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd client && npx vitest run src/hooks/__tests__/apiUploadFileDirect.test.ts src/hooks/__tests__/apiUploadFiles.test.ts`
Expected: PASS (all cases, including the pre-existing retry tests — small files must still go through the unchanged multipart path).

- [ ] **Step 5: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add client/src/hooks/useApi.ts client/src/hooks/__tests__/apiUploadFileDirect.test.ts client/src/hooks/__tests__/apiUploadFiles.test.ts
git commit -m "Route large attachment uploads through presigned direct-to-R2 PUT"
```

---

### Task 5: Admin map-data backend routes

**Files:**
- Create: `src/routes/adminMapData.ts`
- Modify: `src/routesConfig.ts`
- Test: `tests/adminMapData.test.ts`

**Interfaces:**
- Consumes: `presignPutUrl`, `r2CredentialsConfigured` from `../utils/r2Presign` (Task 1).
- Produces: `GET /api/admin/map-data/files` → `{ files: { key, size, uploaded }[] }`; `POST /api/admin/map-data/presign` → `{ upload_url: string, key: string }`; `DELETE /api/admin/map-data/files/:key` → `{ ok: true }`. Task 6 (client tab) calls all three by these exact paths/shapes.

- [ ] **Step 1: Write the failing test**

Create `tests/adminMapData.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import adminMapData from '../src/routes/adminMapData';
import type { Env } from '../src/types';

function buildApp(role: string | null, opts: {
  files?: { key: string; size: number; uploaded: string }[];
  r2Configured?: boolean;
} = {}) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    if (role) c.set('user', { id: 1, username: 'tester', role, full_name: 'Test' });
    await next();
  });
  app.route('/api/admin/map-data', adminMapData);

  const bucket = {
    list: async () => ({ objects: opts.files ?? [] }),
    delete: async (_key: string) => undefined,
  } as any;

  const env: any = { MAP_DATA: bucket };
  if (opts.r2Configured !== false) {
    env.R2_ACCESS_KEY_ID = 'key';
    env.R2_SECRET_ACCESS_KEY = 'secret';
    env.R2_ACCOUNT_ID = 'acct';
  }

  return (path: string, init?: RequestInit) => app.request(path, init, env);
}

describe('GET /api/admin/map-data/files', () => {
  it('rejects a non-admin role', async () => {
    const request = buildApp('manager');
    const res = await request('/api/admin/map-data/files');
    expect(res.status).toBe(403);
  });

  it('rejects an unauthenticated request', async () => {
    const request = buildApp(null);
    const res = await request('/api/admin/map-data/files');
    expect(res.status).toBe(403);
  });

  it('lists files for an admin', async () => {
    const request = buildApp('admin', {
      files: [{ key: 'tiles/utah.pmtiles', size: 12345, uploaded: '2026-07-18T00:00:00Z' }],
    });
    const res = await request('/api/admin/map-data/files');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.files).toHaveLength(1);
    expect(body.files[0].key).toBe('tiles/utah.pmtiles');
  });
});

describe('POST /api/admin/map-data/presign', () => {
  it('rejects a key outside the allowed prefixes', async () => {
    const request = buildApp('admin');
    const res = await request('/api/admin/map-data/presign', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'secrets/oops.txt', contentType: 'text/plain', size: 100 }),
    });
    expect(res.status).toBe(400);
  });

  it('returns a presigned URL for an allowed key', async () => {
    const request = buildApp('admin');
    const res = await request('/api/admin/map-data/presign', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'tiles/utah.pmtiles', contentType: 'application/octet-stream', size: 500_000_000 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.upload_url).toContain('acct.r2.cloudflarestorage.com/system-essentials/tiles/utah.pmtiles');
  });

  it('returns not_configured when R2 credentials are unset', async () => {
    const request = buildApp('admin', { r2Configured: false });
    const res = await request('/api/admin/map-data/presign', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'tiles/utah.pmtiles', contentType: 'application/octet-stream', size: 100 }),
    });
    const body = await res.json() as any;
    expect(body).toEqual({ ok: false, code: 'not_configured' });
  });
});

describe('DELETE /api/admin/map-data/files/:key', () => {
  it('rejects a non-admin role', async () => {
    const request = buildApp('officer');
    const res = await request('/api/admin/map-data/files/tiles/utah.pmtiles', { method: 'DELETE' });
    expect(res.status).toBe(403);
  });

  it('deletes an allowed key for an admin', async () => {
    const request = buildApp('admin');
    const res = await request('/api/admin/map-data/files/tiles/utah.pmtiles', { method: 'DELETE' });
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/adminMapData.test.ts`
Expected: FAIL — `Cannot find module '../src/routes/adminMapData'`.

- [ ] **Step 3: Write the implementation**

Create `src/routes/adminMapData.ts`:

```ts
// ============================================================
// RMPG Flex — Admin map-data (system-essentials) file manager
// ============================================================
// Lets an admin list/upload/delete objects in the system-essentials R2
// bucket (bound as MAP_DATA) from the app instead of `wrangler`/dashboard.
// Mounted at /api/admin/map-data with auth: 'required' in routesConfig.ts
// — unlike the public /api/map-data tile-serving router (src/routes/
// mapData.ts), every handler here ALSO checks for the admin role, since
// that prefix stays public for tile-serving.
//
// Uploads go through the same presigned-PUT pattern as the attachments
// flow (src/routes/uploads.ts) via src/utils/r2Presign.ts, but there's no
// DB row to create afterward — MAP_DATA objects have no metadata table —
// so there's no "complete" endpoint; the client just re-fetches GET /files.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { presignPutUrl, r2CredentialsConfigured } from '../utils/r2Presign';

const adminMapData = new Hono<Env>();

const BUCKET_NAME = 'system-essentials';
const ALLOWED_PREFIXES = ['Map Overlay Database/', 'tiles/'];
const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024; // 2 GB
const PRESIGN_EXPIRES_SECONDS = 1800; // 30 min

function requireRole(
  c: { get: (k: 'user') => { role: string } | undefined },
  ...roles: string[]
): string | null {
  const u = c.get('user');
  if (!u || !roles.includes(u.role)) return 'Insufficient role';
  return null;
}

function isAllowedKey(key: string): boolean {
  return ALLOWED_PREFIXES.some((p) => key.startsWith(p)) && !key.includes('..');
}

adminMapData.get('/files', async (c) => {
  const denied = requireRole(c, 'admin');
  if (denied) return c.json({ error: denied }, 403);

  try {
    const objects = await c.env.MAP_DATA.list();
    const files = objects.objects.map((o: any) => ({
      key: o.key,
      size: o.size,
      uploaded: o.uploaded,
    }));
    return c.json({ files });
  } catch (err) {
    console.error('GET /admin/map-data/files failed:', err);
    return c.json({ error: 'Failed to list files' }, 500);
  }
});

adminMapData.post('/presign', async (c) => {
  const denied = requireRole(c, 'admin');
  if (denied) return c.json({ error: denied }, 403);

  if (!r2CredentialsConfigured(c.env)) {
    return c.json({ ok: false, code: 'not_configured' });
  }

  const body = await c.req.json<{ key?: string; contentType?: string; size?: number }>().catch(() => null);
  if (!body) return c.json({ error: 'Invalid JSON body' }, 400);

  const key = String(body.key || '').trim();
  const size = Number(body.size);
  if (!key) return c.json({ error: 'key is required' }, 400);
  if (!isAllowedKey(key)) {
    return c.json({ error: `key must start with one of: ${ALLOWED_PREFIXES.join(', ')}` }, 400);
  }
  if (!Number.isFinite(size) || size <= 0) {
    return c.json({ error: 'size must be positive' }, 400);
  }
  if (size > MAX_FILE_SIZE) {
    return c.json({ error: `File too large — max ${MAX_FILE_SIZE / 1024 / 1024} MB` }, 400);
  }

  try {
    const uploadUrl = await presignPutUrl(c.env, BUCKET_NAME, key, PRESIGN_EXPIRES_SECONDS);
    return c.json({ upload_url: uploadUrl, key });
  } catch (err) {
    console.error('POST /admin/map-data/presign failed:', err);
    return c.json({ error: 'Failed to create upload URL' }, 500);
  }
});

adminMapData.delete('/files/:key{[\\s\\S]*}', async (c) => {
  const denied = requireRole(c, 'admin');
  if (denied) return c.json({ error: denied }, 403);

  const key = decodeURIComponent(c.req.param('key'));
  if (!isAllowedKey(key)) {
    return c.json({ error: `key must start with one of: ${ALLOWED_PREFIXES.join(', ')}` }, 400);
  }

  try {
    await c.env.MAP_DATA.delete(key);
    return c.json({ ok: true });
  } catch (err) {
    console.error('DELETE /admin/map-data/files failed:', err);
    return c.json({ error: 'Failed to delete file' }, 500);
  }
});

export default adminMapData;
```

Now wire it into `src/routesConfig.ts`. Add the import near the other admin route imports (around the `import adminDev from './routes/adminDev';` line):

```ts
import adminMapData from './routes/adminMapData';
```

Add the registry entry near the other `/api/admin/*` sub-prefixes (around the `{ prefix: '/api/admin/settings', router: adminSettings, auth: 'required' },` line):

```ts
  { prefix: '/api/admin/map-data', router: adminMapData, auth: 'required' },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/adminMapData.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/routes/adminMapData.ts src/routesConfig.ts tests/adminMapData.test.ts
git commit -m "Add admin-only map-data (system-essentials) file manager routes"
```

---

### Task 6: Admin map-data client tab

**Files:**
- Create: `client/src/pages/admin/AdminMapDataTab.tsx`
- Modify: `client/src/pages/AdminPage.tsx`

**Interfaces:**
- Consumes: `apiFetch` from `../../hooks/useApi`; `putFileDirect` from `../../utils/uploadWithProgress` (Task 3); `useToast` from `../../components/ToastProvider`; backend routes from Task 5 (`GET /admin/map-data/files`, `POST /admin/map-data/presign`, `DELETE /admin/map-data/files/:key`).
- Produces: `export default function AdminMapDataTab()` — a self-contained component (no required props), mounted in `AdminPage.tsx`.

- [ ] **Step 1: Write the component**

Create `client/src/pages/admin/AdminMapDataTab.tsx`:

```tsx
// ============================================================
// RMPG Flex — Admin → Map Data tab
// ------------------------------------------------------------
// Lists/uploads/deletes objects in the system-essentials R2 bucket
// (map overlays + PMTiles tile archives) via the admin-only routes in
// src/routes/adminMapData.ts. Uploads go straight to R2 via a presigned
// PUT (src/utils/r2Presign.ts) — the Worker never buffers the file.
// ============================================================
import { useState, useEffect, useCallback, useRef } from 'react';
import { Map, Upload, Trash2, RefreshCw } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { putFileDirect, formatBytes } from '../../utils/uploadWithProgress';
import { useToast } from '../../components/ToastProvider';

interface MapDataFile {
  key: string;
  size: number;
  uploaded: string;
}

type DestPrefix = 'Map Overlay Database/' | 'tiles/';

export default function AdminMapDataTab() {
  const { addToast } = useToast();
  const [files, setFiles] = useState<MapDataFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [destPrefix, setDestPrefix] = useState<DestPrefix>('Map Overlay Database/');
  const [uploading, setUploading] = useState(false);
  const [uploadPercent, setUploadPercent] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    setLoading(true);
    return apiFetch<{ files: MapDataFile[] }>('/admin/map-data/files')
      .then((r) => setFiles(Array.isArray(r?.files) ? r.files : []))
      .catch(() => addToast('Failed to load map-data files', 'error'))
      .finally(() => setLoading(false));
  }, [addToast]);

  useEffect(() => { load(); }, [load]);

  const uploadFile = useCallback(async (file: File) => {
    setUploading(true);
    setUploadPercent(0);
    try {
      const key = `${destPrefix}${file.name}`;
      const presign = await apiFetch<{ ok?: boolean; code?: string; upload_url?: string }>(
        '/admin/map-data/presign',
        { method: 'POST', body: JSON.stringify({ key, contentType: file.type || 'application/octet-stream', size: file.size }) },
      );
      if (presign.ok === false) {
        addToast('R2 direct-upload credentials are not configured yet.', 'error');
        return;
      }
      await putFileDirect(presign.upload_url as string, file, (p) => setUploadPercent(p.percent));
      addToast(`Uploaded ${file.name}`, 'success');
      await load();
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Upload failed', 'error');
    } finally {
      setUploading(false);
      setUploadPercent(0);
    }
  }, [destPrefix, addToast, load]);

  const deleteFile = useCallback((key: string) => {
    if (!confirm(`Delete ${key}? This cannot be undone.`)) return;
    apiFetch(`/admin/map-data/files/${encodeURIComponent(key)}`, { method: 'DELETE' })
      .then(() => load())
      .catch((e) => addToast(e instanceof Error ? e.message : 'Delete failed', 'error'));
  }, [load, addToast]);

  return (
    <div className="p-3 space-y-4">
      <div className="panel-beveled p-3 bg-surface-base">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-[9px] text-rmpg-400 uppercase font-bold tracking-wider flex items-center gap-1.5">
            <Map className="w-3 h-3" /> Map Data Files ({files.length})
          </h4>
          <button
            onClick={() => load()}
            aria-label="Refresh file list"
            className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold rounded bg-surface-sunken hover:bg-rmpg-700 text-rmpg-100"
          >
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
        </div>

        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) uploadFile(f);
          }}
          className={`flex items-center gap-2 p-3 mb-3 rounded border border-dashed ${dragOver ? 'border-brand-400 bg-surface-sunken' : 'border-border-default'}`}
        >
          <select
            className="input-dark"
            value={destPrefix}
            onChange={(e) => setDestPrefix(e.target.value as DestPrefix)}
            disabled={uploading}
          >
            <option value="Map Overlay Database/">Overlay</option>
            <option value="tiles/">Tile archive</option>
          </select>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold rounded bg-brand-700 hover:bg-brand-600 text-white disabled:opacity-50"
          >
            <Upload className="w-3 h-3" /> {uploading ? `Uploading… ${uploadPercent}%` : 'Choose file (or drop it here)'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = ''; }}
          />
        </div>

        {loading ? (
          <div className="text-[10px] text-rmpg-500 p-2">Loading…</div>
        ) : files.length === 0 ? (
          <div className="text-[10px] text-rmpg-500 p-2">No map-data files on file.</div>
        ) : (
          <div className="space-y-0.5 max-h-[400px] overflow-y-auto">
            {files.map((f) => (
              <div key={f.key} className="flex items-center justify-between px-2 py-1 bg-surface-sunken rounded text-[10px]">
                <span className="font-mono text-rmpg-100 flex-1 truncate">{f.key}</span>
                <span className="text-rmpg-400 w-20 text-right">{formatBytes(f.size)}</span>
                <span className="text-rmpg-500 w-32 text-right">{(f.uploaded || '').slice(0, 10)}</span>
                <button
                  onClick={() => deleteFile(f.key)}
                  aria-label={`Delete ${f.key}`}
                  className="p-1 ml-2 hover:text-red-400"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire the tab into `AdminPage.tsx`**

Add the import, right after `import AdminMapSettingsTab from './admin/AdminMapSettingsTab';`:

```ts
import AdminMapDataTab from './admin/AdminMapDataTab';
```

Add `'map_data_files'` to the `TabId` union (the long `type TabId = '...' | 'map_settings' | ...` line) — insert it directly after `'map_settings'`:

```ts
'map_settings' | 'map_data_files' | 'radio' | ...
```

Add `'map_data_files'` to the `VALID_TABS` array, directly after `'map_settings'`:

```ts
'map_settings', 'map_data_files', 'radio', ...
```

Add the tab entry to the `System` category's `tabs` array, directly after `{ id: 'map_settings', label: 'Map Settings', icon: Map },`:

```tsx
{ id: 'map_data_files', label: 'Map Data Files', icon: Map },
```

Add the render block, directly after the `{activeTab === 'map_settings' && ( ... )}` block (find it by searching for `AdminMapSettingsTab` in the render section):

```tsx
{activeTab === 'map_data_files' && (
  <AdminMapDataTab />
)}
```

- [ ] **Step 3: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/admin/AdminMapDataTab.tsx client/src/pages/AdminPage.tsx
git commit -m "Add admin Map Data Files tab (list/upload/delete via presigned R2)"
```

---

### Task 7: Operator setup — R2 API token, secrets, CORS

**Files:**
- Create: `scripts/r2-cors-policy.json` (checked in — it's a config artifact, not a secret)

This task requires you (the operator) to act — the assistant cannot create Cloudflare account credentials or paste secret values.

- [ ] **Step 1: Create the R2 API token**

In the R2 bucket settings page (`https://dash.cloudflare.com/5caa95c5789f4fc4ed3934b2a2c29ed4/r2/default/buckets/rmpg-flex-uploads/settings` → "Manage API tokens" → "Create API token"), create ONE token scoped to both `rmpg-flex-uploads` and `system-essentials` with **Object Read & Write** permission. Copy the Access Key ID and Secret Access Key it shows once — they are never shown again.

- [ ] **Step 2: Set the secrets**

In a terminal (not in chat), run:

```bash
npx wrangler secret put R2_ACCESS_KEY_ID
npx wrangler secret put R2_SECRET_ACCESS_KEY
```

Paste each value when prompted.

- [ ] **Step 3: Write the CORS policy file**

Create `scripts/r2-cors-policy.json`:

```json
{
  "rules": [
    {
      "allowed": {
        "origins": ["https://rmpgutah.us", "http://localhost:5173"],
        "methods": ["PUT", "GET", "HEAD"],
        "headers": ["Content-Type"]
      },
      "maxAgeSeconds": 3600
    }
  ]
}
```

(Note: this is Cloudflare's native R2 CORS schema — `{ rules: [{ allowed: { origins, methods, headers } }] }` — NOT the S3 XML-CORS shape (`AllowedOrigins`/`AllowedMethods`). `wrangler r2 bucket cors set` rejects the S3 shape with "must contain a 'rules' array.")

- [ ] **Step 4: Apply CORS to both buckets**

Run:

```bash
npx wrangler r2 bucket cors set rmpg-flex-uploads --file scripts/r2-cors-policy.json
npx wrangler r2 bucket cors set system-essentials --file scripts/r2-cors-policy.json
```

Expected: both commands print a success confirmation. Verify with:

```bash
npx wrangler r2 bucket cors list rmpg-flex-uploads
npx wrangler r2 bucket cors list system-essentials
```

Expected: both show the rule from Step 3.

- [ ] **Step 5: Deploy so the Worker picks up the new secrets**

The secrets take effect on the next deploy (`git push origin main` per this repo's deploy flow) — `wrangler secret put` applies immediately to the live Worker without a redeploy, but confirm via Task 8 below regardless.

- [ ] **Step 6: Commit the CORS policy file**

```bash
git add scripts/r2-cors-policy.json
git commit -m "Add R2 CORS policy for presigned direct-upload buckets"
```

---

### Task 8: End-to-end verification

This task has no code changes — it's the manual verification pass required before calling this feature done, per this repo's "start the dev server and use the feature" rule for UI changes. Requires Task 7 to be complete (live R2 credentials + CORS) for the direct-PUT step to actually reach R2; without it you can still verify the `not_configured` fallback behaves correctly.

- [ ] **Step 1: Start both dev servers**

Run: `npm run dev` (Worker, port 8787) and `cd client && npm run dev` (Vite, port 5173) — both in the background, or via the project's preview tooling.

- [ ] **Step 2: Verify attachments direct-upload**

Log in, open any page using `FileAttachments.tsx` (e.g. a person record's Documents section), and attach a file **over 20MB** (any local video file works). In the browser's Network tab, confirm:
- A `POST /api/uploads/presign` request (200, returns `upload_url`).
- A `PUT` request to `*.r2.cloudflarestorage.com/rmpg-flex-uploads/attachments/...` (200/201) — NOT `POST /api/uploads`.
- A `POST /api/uploads/presign/<id>/complete` request (201).
- The file appears in the attachments list and can be downloaded/previewed afterward.

Then attach a file **under 20MB** and confirm it still goes through `POST /api/uploads` exactly as before (no regression).

- [ ] **Step 3: Verify admin map-data upload**

Log in as an admin, open Admin → Map Data Files, upload a small test file as an "Overlay". Confirm:
- It appears in the file list after upload.
- `GET /api/map-data/Map%20Overlay%20Database/<filename>` (the existing public route) serves it back.
- Delete it from the tab and confirm it disappears from the list.

Log in as a non-admin role and confirm the tab either doesn't render meaningfully or every API call 403s (the actual security boundary is the backend role check from Task 5, already covered by tests — this step just confirms the UI doesn't crash for a non-admin session).

- [ ] **Step 4: Verify the `not_configured` fallback (only if testing before Task 7)**

If R2 secrets aren't set yet, confirm: attachment uploads over 20MB fail gracefully with a clear error (not a silent hang), and the admin Map Data Files tab's upload shows the "R2 direct-upload credentials are not configured yet." toast instead of crashing.

- [ ] **Step 5: Run the full test suite one more time**

Run: `npm test` (root) and `cd client && npx vitest run`
Expected: all green, including every test added in Tasks 1–5.

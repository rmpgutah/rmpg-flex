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

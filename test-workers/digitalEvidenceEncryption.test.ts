import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import app from './entry';
import { envWithKek, ensureFileEncryptionKeysTable } from './helpers/fileEncryptionTestSchema';

type D1 = import('@cloudflare/workers-types').D1Database;

describe('digital evidence upload/stream — envelope encryption', () => {
  beforeAll(async () => {
    await ensureFileEncryptionKeysTable(env.DB as unknown as D1);
  });

  it('stores ciphertext and streams original bytes by id and by r2 key', async () => {
    const testEnv = envWithKek(env as unknown as Record<string, unknown>);
    const original = new Uint8Array([0xff, 0xd8, 0xff, 10, 11, 12]);
    const form = new FormData();
    form.append('file', new File([original], 'scene.jpg', { type: 'image/jpeg' }));
    form.append('filename', 'scene.jpg');
    form.append('evidence_type', 'photo');

    const uploadRes = await app.request('/api/evidence/digital', { method: 'POST', body: form }, testEnv);
    expect(uploadRes.status).toBe(200);
    const body = await uploadRes.json() as { item: { id: number; r2_key: string; url: string } };
    expect(body.item.r2_key).toMatch(/^digital-evidence\/.+\.jpg$/);
    expect(body.item.url).toBe(`/api/evidence/digital/${body.item.id}/file`);

    const raw = await (testEnv as any).UPLOADS.get(body.item.r2_key);
    const rawBytes = new Uint8Array(await raw!.arrayBuffer());
    expect(Array.from(rawBytes)).not.toEqual(Array.from(original));

    const byId = await app.request(`/api/evidence/digital/${body.item.id}/file`, {}, testEnv);
    expect(byId.status).toBe(200);
    expect(Array.from(new Uint8Array(await byId.arrayBuffer()))).toEqual(Array.from(original));

    const byKey = await app.request(`/api/evidence/digital/file/${body.item.r2_key}`, {}, testEnv);
    expect(byKey.status).toBe(200);
    expect(Array.from(new Uint8Array(await byKey.arrayBuffer()))).toEqual(Array.from(original));
  });

  it('does not swallow a missing encryption key as a 200 placeholder', async () => {
    const testEnv = envWithKek(env as unknown as Record<string, unknown>);
    const res = await app.request('/api/evidence/digital/999999/file', {}, testEnv);
    expect(res.status).toBe(404);
  });
});

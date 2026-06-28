// test-workers/redactions.test.ts
// Miniflare route smoke test for POST /api/redactions: a client-produced redacted
// MP4 + metadata is stored to R2 + a video_redactions custody row, then listed and
// downloaded back. Runs against real Miniflare D1/R2 bindings.
import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import app from './entry';

describe('POST /api/redactions — stores the redacted MP4 + custody row', () => {
  it('persists the file to R2 and a custody record, then lists + downloads it', async () => {
    const fd = new FormData();
    fd.append('video', new Blob([new Uint8Array([0, 0, 0, 24])], { type: 'video/mp4' }), 'redacted.mp4');
    fd.append('metadata', JSON.stringify({ event_id: 42, kinds: ['face', 'license_plate'], region_count: 3, style: 'blur' }));

    const res = await app.request('/api/redactions', { method: 'POST', body: fd }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { id: number; download_url: string };
    expect(body.id).toBeGreaterThan(0);

    const list = await app.request('/api/redactions?event_id=42', {}, env as unknown as Record<string, unknown>);
    const listBody = await list.json() as { redactions: Array<{ id: number; kinds: string; region_count: number }> };
    expect(listBody.redactions[0].kinds).toContain('face');
    expect(listBody.redactions[0].region_count).toBe(3);

    const dl = await app.request(body.download_url, {}, env as unknown as Record<string, unknown>);
    expect(dl.status).toBe(200);
    expect(dl.headers.get('content-type')).toBe('video/mp4');
  });
});

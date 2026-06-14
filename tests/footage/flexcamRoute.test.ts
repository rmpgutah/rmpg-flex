// tests/footage/flexcamRoute.test.ts
import { describe, it, expect } from 'vitest';
import flexcam from '../../src/routes/flexcam';

describe('flexcam route', () => {
  it('rejects a request with an invalid window', async () => {
    const res = await flexcam.request('/request', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ asset_id: 136022, from: 100, to: 100 }),
    }, { DB: makeStubDb(), UPLOADS: {} } as any);
    expect(res.status).toBe(400);
  });
});

describe('flexcam evidence', () => {
  it('unlock without a reason → not 200 (auth guard or 400)', async () => {
    const res = await flexcam.request('/footage/1/unlock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
      { DB: makeStubDb(), UPLOADS: {} } as any);
    expect(res.status).not.toBe(200);
  });
});

function makeStubDb() {
  const stmt = { bind: () => stmt, all: async () => ({ results: [] }), first: async () => null, run: async () => ({ meta: {} }) };
  return { prepare: () => stmt } as any;
}

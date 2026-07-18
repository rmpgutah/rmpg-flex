import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

import assessorApp from '../src/routes/assessor';

function fakeDb(overrideValue: string | null = null) {
  return {
    prepare: (sql: string) => ({
      run: async () => ({ meta: { changes: 1 } }),
      first: async () => (sql.includes('pragma_table_info') ? { 1: 1 } : null),
      all: async () => ({ results: [] }),
      bind: (..._args: any[]) => ({
        run: async () => ({ meta: { changes: 1 } }),
        first: async () => {
          if (sql.includes('jurisdiction_override')) return { jurisdiction_override: overrideValue };
          if (sql.includes('pragma_table_info')) return { 1: 1 };
          return null;
        },
        all: async () => ({ results: [] }),
      }),
    }),
  };
}

function buildTestApp() {
  const wrapper = new Hono<{ Bindings: any; Variables: any }>();
  wrapper.use('*', async (c, next) => {
    c.set('user', { id: 1, role: 'admin', username: 'admin', full_name: 'Admin' });
    c.set('userId', 1);
    await next();
  });
  wrapper.route('/', assessorApp);
  return wrapper;
}

describe('GET /jurisdiction', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resolves the county for an address with no record context', async () => {
    const app = buildTestApp();
    const env = { DB: fakeDb(), KV: { get: async () => null, put: async () => {} } };
    const req = new Request('http://localhost/jurisdiction?address=' + encodeURIComponent('100 E Center St, American Fork, UT 84003'));
    const res = await app.fetch(req, env as any);
    const body = await res.json() as any;
    expect(body.resolved_county).toBe('utah');
    expect(body.effective_county).toBe('utah');
    expect(body.label).toBe('Utah County');
    expect(body.manual_url).toContain('utahcounty.gov');
  });

  it('honors a stored override for the record', async () => {
    const app = buildTestApp();
    const env = { DB: fakeDb('tooele'), KV: { get: async () => null, put: async () => {} } };
    const address = '100 E Center St, American Fork, UT 84003';
    const req = new Request(
      `http://localhost/jurisdiction?address=${encodeURIComponent(address)}&record_type=business&record_id=1`,
    );
    const res = await app.fetch(req, env as any);
    const body = await res.json() as any;
    expect(body.resolved_county).toBe('utah');
    expect(body.override).toBe('tooele');
    expect(body.effective_county).toBe('tooele');
    expect(body.label).toBe('Tooele County');
  });
});

describe('POST /jurisdiction', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sets a valid override', async () => {
    const app = buildTestApp();
    const env = { DB: fakeDb(), KV: { get: async () => null, put: async () => {} } };
    const req = new Request('http://localhost/jurisdiction', {
      method: 'POST',
      body: JSON.stringify({ record_type: 'business', record_id: 1, county: 'summit' }),
    });
    const res = await app.fetch(req, env as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
    expect(body.county).toBe('summit');
  });

  it('rejects an invalid county value', async () => {
    const app = buildTestApp();
    const env = { DB: fakeDb(), KV: { get: async () => null, put: async () => {} } };
    const req = new Request('http://localhost/jurisdiction', {
      method: 'POST',
      body: JSON.stringify({ record_type: 'business', record_id: 1, county: 'davis' }),
    });
    const res = await app.fetch(req, env as any);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.code).toBe('invalid_county');
  });

  it('allows clearing an override with county: null', async () => {
    const app = buildTestApp();
    const env = { DB: fakeDb(), KV: { get: async () => null, put: async () => {} } };
    const req = new Request('http://localhost/jurisdiction', {
      method: 'POST',
      body: JSON.stringify({ record_type: 'business', record_id: 1, county: null }),
    });
    const res = await app.fetch(req, env as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.county).toBeNull();
  });
});

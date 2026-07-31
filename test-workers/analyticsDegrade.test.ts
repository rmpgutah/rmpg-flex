// test-workers/analyticsDegrade.test.ts
// ============================================================
// How /api/analytics/* responds when R2 SQL rejects the request.
// ------------------------------------------------------------
// Regression cover for a live incident (2026-07-31): a stale R2_SQL_TOKEN
// predating the lakehouse build returned "Unauthenticated." from R2 SQL. The
// config guard in runR2Sql only short-circuits when the warehouse OR the token
// is absent, so once R2_ANALYTICS_WAREHOUSE was set the call went out for real
// and six analytics endpoints flipped from an honest 503 to a misleading
// 500 db_error — which apiFetch then RETRIED, doubling the red console errors.
//
// A rejected credential and a not-yet-created table are both stable
// CONFIGURATION states: retrying cannot fix either. They must degrade to
// 200 { ok:false, code:'not_configured' } like any unprovisioned integration.
// A genuine upstream 5xx must still surface as db_error — the point is accurate
// classification, not blanket suppression, so that case is asserted too.
import { env } from 'cloudflare:test';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Hono } from 'hono';
import analytics from '../src/routes/analytics';

type TestUser = { id: number; role: string; username: string };

function appWithUser(user: TestUser) {
  const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: TestUser; userId: number } }>();
  app.use('*', async (c, next) => {
    c.set('user', user);
    c.set('userId', user.id);
    await next();
  });
  app.route('/api/analytics', analytics);
  return app;
}

/** Env with BOTH config values present — this is the state that stops the
 *  config guard from short-circuiting and lets the R2 SQL call actually run. */
function configuredEnv(): Record<string, unknown> {
  return {
    ...(env as unknown as Record<string, unknown>),
    R2_ANALYTICS_WAREHOUSE: 'acct123_rmpg-flex-analytics',
    R2_SQL_TOKEN: 'stale-token-value',
  };
}

function stubR2Sql(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })),
  );
}

async function callTrends() {
  const app = appWithUser({ id: 1, role: 'officer', username: 'test-officer' });
  const res = await app.request('/api/analytics/cfs/trends?days=7', { method: 'GET' }, configuredEnv());
  return { res, body: await res.json() as any };
}

describe('/api/analytics degradation on R2 SQL failures', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('401 Unauthenticated degrades to 200 not_configured, not a 500', async () => {
    // The exact live shape: R2 SQL replied 401 with "Unauthenticated."
    stubR2Sql(401, { errors: [{ message: 'Unauthenticated.' }] });
    const { res, body } = await callTrends();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: false, skipped: true, code: 'not_configured' });
    // The hint must name the actual remedy, since "not_configured" alone would
    // read as "secret unset" when in fact the secret is present but rejected.
    expect(String(body.hint)).toMatch(/R2_SQL_TOKEN/);
  });

  it('403 Forbidden degrades the same way', async () => {
    stubR2Sql(403, { error: 'Forbidden' });
    const { res, body } = await callTrends();
    expect(res.status).toBe(200);
    expect(body.code).toBe('not_configured');
  });

  it('classifies an auth failure by MESSAGE even when the status is not 401/403', async () => {
    // Pins the message-matching arm specifically; R2 SQL has been observed
    // returning auth errors under a non-401 status.
    stubR2Sql(400, { errors: [{ message: 'Unauthenticated.' }] });
    const { res, body } = await callTrends();
    expect(res.status).toBe(200);
    expect(body.code).toBe('not_configured');
  });

  it('a missing Iceberg table degrades to not_configured pointing at the lakehouse script', async () => {
    stubR2Sql(404, { errors: [{ message: 'table default.flex_events does not exist' }] });
    const { res, body } = await callTrends();
    expect(res.status).toBe(200);
    expect(body.code).toBe('not_configured');
    expect(String(body.hint)).toMatch(/finish-lakehouse/);
  });

  it('a genuine upstream 5xx STILL surfaces as an error — not blanket-suppressed', async () => {
    // This is the guard against over-correcting: a real outage must not be
    // laundered into a cheerful 200.
    stubR2Sql(500, { error: 'internal error' });
    const { res, body } = await callTrends();
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(body.code).not.toBe('not_configured');
  });

  it('still reports not_configured when the warehouse var itself is unset', async () => {
    // The original behaviour must be preserved: no warehouse => no call at all.
    const app = appWithUser({ id: 1, role: 'officer', username: 'test-officer' });
    const bare = { ...(env as unknown as Record<string, unknown>) };
    delete bare.R2_ANALYTICS_WAREHOUSE;
    delete bare.R2_SQL_TOKEN;
    const res = await app.request('/api/analytics/cfs/trends?days=7', { method: 'GET' }, bare);
    expect(res.status).toBe(200);
    expect((await res.json() as any).code).toBe('not_configured');
  });
});

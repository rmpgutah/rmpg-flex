// Route-level tests (Miniflare/workerd) for /api/dialer/* — the native
// softphone proxy. Upstream dispatch-app is stubbed via globalThis.fetch.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { execute } from '../src/utils/db';
import dialerVoice from '../src/routes/dialerVoice';

type User = { id: number; role: string; username: string; full_name: string };
function makeApp(user: User) {
  const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: User; userId: number } }>();
  app.use('*', async (c, next) => { c.set('user', user); c.set('userId', user.id); await next(); });
  app.onError((err, c) => c.json({ error: err instanceof Error ? err.message : String(err) }, 500));
  app.route('/api/dialer', dialerVoice);
  return app;
}
const db = () => (env as unknown as { DB: D1Database }).DB;
const E = () => ({ ...(env as unknown as Record<string, unknown>), DIAL_CONNECT_SERVICE_KEY: 'svc-key', DIAL_CONNECT_API_BASE: 'https://dialer.test' });
const linked: User = { id: 41, role: 'dispatcher', username: 'linked', full_name: 'Linked User' };
const unlinked: User = { id: 42, role: 'dispatcher', username: 'nolink', full_name: 'No Link' };

beforeAll(async () => {
  await execute(db(), `CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT, role TEXT, status TEXT, dialer_oidc_sub TEXT)`);
  await execute(db(), `INSERT OR REPLACE INTO users (id, username, role, status, dialer_oidc_sub) VALUES (41, 'linked', 'dispatcher', 'active', 'cuid_abc')`);
  await execute(db(), `INSERT OR REPLACE INTO users (id, username, role, status, dialer_oidc_sub) VALUES (42, 'nolink', 'dispatcher', 'active', NULL)`);
});
afterEach(() => vi.unstubAllGlobals());

describe('POST /api/dialer/token', () => {
  it('forwards to dispatch-app with the service headers and dispatcher identity', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ token: 'jwt', identity: 'dispatcher_cuid_abc', userId: 'cuid_abc', expiresAt: '2030-01-01T00:00:00.000Z' }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await makeApp(linked).request('/api/dialer/token', { method: 'POST' }, E());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ token: 'jwt', identity: 'dispatcher_cuid_abc', expiresAt: '2030-01-01T00:00:00.000Z' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://dialer.test/api/voice/token');
    const h = new Headers(init.headers);
    expect(h.get('x-rmpg-service-key')).toBe('svc-key');
    expect(h.get('x-rmpg-dispatcher-id')).toBe('cuid_abc');
  });

  it('returns 409 dialer_unlinked when the user has no dialer_oidc_sub', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = await makeApp(unlinked).request('/api/dialer/token', { method: 'POST' }, E());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'Your account is not linked to Dial Connect', code: 'dialer_unlinked' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 503 dialer_unreachable when upstream fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })));
    const res = await makeApp(linked).request('/api/dialer/token', { method: 'POST' }, E());
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe('dialer_unreachable');
  });

  it('returns 403 dialer_forbidden when upstream rejects the service actor', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })));
    const res = await makeApp(linked).request('/api/dialer/token', { method: 'POST' }, E());
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('dialer_forbidden');
  });

  it('reports not_configured (200) when the service key is unset', async () => {
    const res = await makeApp(linked).request('/api/dialer/token', { method: 'POST' }, { ...(env as unknown as Record<string, unknown>), DIAL_CONNECT_SERVICE_KEY: undefined });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, code: 'not_configured' });
  });
});

describe('presence', () => {
  it('POST /presence/heartbeat forwards and returns ok', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await makeApp(linked).request('/api/dialer/presence/heartbeat', { method: 'POST' }, E());
    expect(res.status).toBe(200);
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe('https://dialer.test/api/voice/presence/heartbeat');
  });
  it('GET /presence passes the upstream list through', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([{ id: 'x', name: 'Other', agency: 'all', dnd: false }]), { status: 200 })));
    const res = await makeApp(linked).request('/api/dialer/presence', {}, E());
    expect(await res.json()).toEqual([{ id: 'x', name: 'Other', agency: 'all', dnd: false }]);
  });
});

describe('call controls', () => {
  it('forwards hold with a validated body', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: 'held' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await makeApp(linked).request('/api/dialer/voice/hold', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ callSid: 'CA1', hold: true }),
    }, E());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'held' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://dialer.test/api/voice/hold');
    expect(JSON.parse(String(init.body))).toEqual({ callSid: 'CA1', hold: true });
  });

  it('rejects an invalid body before calling upstream', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = await makeApp(linked).request('/api/dialer/voice/recording', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ callSid: 'CA1', action: 'pause' }),
    }, E());
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('normalizes the conference phone number to E.164', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: 'added' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await makeApp(linked).request('/api/dialer/voice/conference/add', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ callSid: 'CA1', phoneNumber: '(801) 555-1212' }),
    }, E());
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ callSid: 'CA1', phoneNumber: '+18015551212' });
  });

  it('passes upstream 4xx through unchanged', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'No active conference for this call' }), { status: 400 })));
    const res = await makeApp(linked).request('/api/dialer/voice/transfer', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ callSid: 'CA1', targetDispatcherId: 'cuid_other' }),
    }, E());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('No active conference for this call');
  });
});

describe('DND', () => {
  it('GET /dnd relays the upstream flag', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ dnd: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await makeApp(linked).request('/api/dialer/dnd', {}, E());
    expect(await res.json()).toEqual({ dnd: true });
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe('https://dialer.test/api/users/me/dnd');
  });

  it('PATCH /dnd validates and forwards as PATCH', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ dnd: false }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await makeApp(linked).request('/api/dialer/dnd', {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dnd: false }),
    }, E());
    expect(res.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({ dnd: false });
    const bad = await makeApp(linked).request('/api/dialer/dnd', {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dnd: 'yes' }),
    }, E());
    expect(bad.status).toBe(400);
  });
});

describe('GET /api/dialer/stream', () => {
  it('returns the upstream event stream body untouched', async () => {
    const body = ': connected\n\ndata: {"type":"call_status"}\n\n';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })));
    const res = await makeApp(linked).request('/api/dialer/stream', {}, E());
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(await res.text()).toBe(body);
  });
});

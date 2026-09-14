// Native softphone proxy: RMPG Flex hosts the Twilio Voice client; tokens,
// presence, call controls and the event stream are forwarded server-to-server
// to dispatch-app (Worker `dialer`) as the linked dispatcher.
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../types';
import { getDb, queryFirst, ensureDialerOidcColumns } from '../utils/db';
import { requireRole } from '../middleware/auth';
import { log } from '../utils/logger';

const DEFAULT_BASE = 'https://rmpgutah.us/dialer';
const UPSTREAM_TIMEOUT_MS = 8_000;

const dialerVoice = new Hono<Env>();
dialerVoice.use('*', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'));

export async function resolveDispatcherSub(db: D1Database, userId: number): Promise<string | null> {
  await ensureDialerOidcColumns(db);
  const row = await queryFirst<{ dialer_oidc_sub: string | null }>(
    db, 'SELECT dialer_oidc_sub FROM users WHERE id = ?', userId,
  );
  return row?.dialer_oidc_sub || null;
}

type Ctx = Context<Env>;

function unlinked(c: Ctx) {
  return c.json({ error: 'Your account is not linked to Dial Connect', code: 'dialer_unlinked' }, 409);
}

// Forwards to dispatch-app. Returns the upstream Response on 2xx/4xx (caller
// decides), or a Flex error Response for unreachable/forbidden.
export async function upstream(
  c: Ctx,
  sub: string,
  path: string,
  init: { method: 'GET' | 'POST' | 'PUT'; body?: unknown; stream?: boolean } = { method: 'GET' },
): Promise<Response> {
  const base = (c.env.DIAL_CONNECT_API_BASE || DEFAULT_BASE).replace(/\/$/, '');
  const headers: Record<string, string> = {
    'x-rmpg-service-key': c.env.DIAL_CONNECT_SERVICE_KEY || '',
    'x-rmpg-dispatcher-id': sub,
    accept: init.stream ? 'text/event-stream' : 'application/json',
  };
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  const controller = new AbortController();
  const timer = init.stream ? null : setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method: init.method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: init.stream ? undefined : controller.signal,
    });
  } catch (err) {
    log.error('[dialer] upstream fetch failed', { path }, err as Error);
    return c.json({ error: 'Dial Connect is unreachable', code: 'dialer_unreachable' }, 503);
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (res.status === 401 || res.status === 403) {
    const details = await res.text().catch(() => '');
    return c.json({ error: 'Dial Connect rejected this dispatcher', code: 'dialer_forbidden', details }, 403);
  }
  if (res.status >= 500) {
    log.error('[dialer] upstream error', { path, status: res.status });
    return c.json({ error: 'Dial Connect is unreachable', code: 'dialer_unreachable' }, 503);
  }
  return res;
}

async function withSub(c: Ctx): Promise<{ sub: string } | { res: Response }> {
  if (!c.env.DIAL_CONNECT_SERVICE_KEY) return { res: c.json({ ok: false, code: 'not_configured' }, 200) };
  const sub = await resolveDispatcherSub(getDb(c.env), c.get('userId'));
  if (!sub) return { res: unlinked(c) };
  return { sub };
}

// Re-emit an upstream JSON body with the same status (2xx/4xx pass-through).
async function relay(c: Ctx, res: Response): Promise<Response> {
  const text = await res.text();
  return new Response(text, { status: res.status, headers: { 'content-type': res.headers.get('content-type') || 'application/json' } });
}

dialerVoice.post('/token', async (c) => {
  const r = await withSub(c);
  if ('res' in r) return r.res;
  const res = await upstream(c, r.sub, '/api/voice/token', { method: 'POST' });
  if (!res.ok) return relay(c, res);
  const body = await res.json() as { token: string; identity: string; expiresAt?: string };
  return c.json({ token: body.token, identity: body.identity, expiresAt: body.expiresAt ?? new Date(Date.now() + 3600_000).toISOString() });
});

dialerVoice.post('/presence/heartbeat', async (c) => {
  const r = await withSub(c);
  if ('res' in r) return r.res;
  const res = await upstream(c, r.sub, '/api/voice/presence/heartbeat', { method: 'POST' });
  if (!res.ok) return relay(c, res);
  return c.json({ ok: true });
});

dialerVoice.get('/presence', async (c) => {
  const r = await withSub(c);
  if ('res' in r) return r.res;
  return relay(c, await upstream(c, r.sub, '/api/voice/presence'));
});

export default dialerVoice;

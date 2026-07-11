// ============================================================
// Cloudflare platform integration (admin)
// ============================================================
// Surfaces the app's own Cloudflare account telemetry (D1 / R2 / KV /
// Workers / zone) and a cache-purge control, by calling the Cloudflare
// REST API v4 with an ADMIN-CONFIGURED token.
//
// ⚠️ SECURITY: the token is NEVER hardcoded or committed. An admin pastes
// their own LEAST-PRIVILEGE token via PUT /config; it is stored in
// system_config (masked on read) and read here at call time. Recommended
// token scopes (read-only + cache purge), per the resource accessed:
//   • Account Analytics: Read   • Workers Scripts: Read
//   • D1: Read   • Workers R2 Storage: Read   • Workers KV Storage: Read
//   • Zone → Cache Purge: Purge  (only if cache-purge is used)
// Do NOT grant Account/Zone *edit* or token-management scopes — a token
// the running Worker holds is an account-takeover surface if exploited.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, queryFirst, execute } from '../utils/db';

import { dbErrorResponse } from '../utils/dbErrors';
const cloudflare = new Hono<Env>();

const CF_API = 'https://api.cloudflare.com/client/v4';

function requireRole(
  c: { get: (k: 'user') => { role: string } | undefined },
  ...roles: string[]
): string | null {
  const u = c.get('user');
  if (!u || !roles.includes(u.role)) return 'Insufficient role';
  return null;
}

async function cfg(db: ReturnType<typeof getDb>, key: string): Promise<string> {
  const r = await queryFirst<{ config_value: string }>(
    db, `SELECT config_value FROM system_config WHERE config_key = ? ORDER BY id DESC LIMIT 1`, key);
  return (r?.config_value || '').trim();
}

async function setCfg(db: ReturnType<typeof getDb>, key: string, value: string): Promise<void> {
  const r = await execute(db,
    `UPDATE system_config SET config_value = ?, updated_at = datetime('now') WHERE config_key = ?`, value, key);
  if (!r.meta.changes) {
    await execute(db,
      `INSERT INTO system_config (config_key, config_value, category) VALUES (?, ?, 'integrations')`, key, value);
  }
}

function mask(v: string): string {
  if (!v) return '';
  return v.length <= 8 ? '••••' : `${v.slice(0, 4)}••••${v.slice(-4)}`;
}

// Read creds + call the CF API with a timeout. Returns { ok, status, json }.
async function cfFetch(token: string, path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; json: any }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const resp = await fetch(`${CF_API}${path}`, {
      ...init,
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers || {}) },
      signal: ctrl.signal,
    });
    const json = await resp.json().catch(() => ({}));
    return { ok: resp.ok, status: resp.status, json };
  } finally { clearTimeout(t); }
}

// ── GET /config — what's configured (token masked) ──────────
cloudflare.get('/config', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const token = await cfg(db, 'cf_api_token');
    return c.json({
      account_id: await cfg(db, 'cf_account_id'),
      zone_id: await cfg(db, 'cf_zone_id'),
      token_set: !!token,
      token_mask: mask(token),
    });
  } catch (err) {
    return dbErrorResponse(c, err, 'Failed to read config');
  }
});

// ── PUT /config — admin sets their own token + ids ──────────
cloudflare.put('/config', async (c) => {
  const denied = requireRole(c, 'admin');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const b = await c.req.json<Record<string, any>>();
    const written: string[] = [];
    for (const k of ['cf_api_token', 'cf_account_id', 'cf_zone_id'] as const) {
      if (b[k] === undefined) continue;        // absent = leave unchanged
      await setCfg(db, k, String(b[k] ?? '').trim());
      written.push(k);
    }
    try {
      await execute(db,
        `INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
         VALUES (?, 'cf_config_update', 'cloudflare', 0, ?, 'worker')`,
        (c.get('userId') as number) ?? null,
        `Updated Cloudflare config: ${written.map(k => k === 'cf_api_token' ? 'token' : k).join(', ')}`);
    } catch { /* audit best-effort */ }
    return c.json({ success: true, updated: written });
  } catch (err) {
    return dbErrorResponse(c, err, 'Failed to save config');
  }
});

// ── GET /status — verify the token + account name ───────────
cloudflare.get('/status', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const token = await cfg(db, 'cf_api_token');
    const accountId = await cfg(db, 'cf_account_id');
    if (!token) return c.json({ configured: false });

    const verify = await cfFetch(token, '/user/tokens/verify');
    let accountName = '';
    if (accountId) {
      const acct = await cfFetch(token, `/accounts/${accountId}`);
      accountName = acct.json?.result?.name || '';
    }
    return c.json({
      configured: true,
      token_valid: verify.ok && verify.json?.result?.status === 'active',
      token_status: verify.json?.result?.status || 'unknown',
      account_id: accountId,
      account_name: accountName,
    });
  } catch (err) {
    return c.json({ configured: true, token_valid: false, error: err instanceof Error ? err.message : String(err) });
  }
});

// ── GET /resources — D1 / R2 / KV inventory for the account ──
cloudflare.get('/resources', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const token = await cfg(db, 'cf_api_token');
    const accountId = await cfg(db, 'cf_account_id');
    if (!token || !accountId) return c.json({ configured: false, d1: [], r2: [], kv: [], workers: [], pages: [] });

    // Each call soft-fails to [] so one missing scope doesn't blank the panel.
    const soft = async (path: string, pick: (r: any) => any[]) => {
      try { const r = await cfFetch(token, path); return r.ok ? pick(r.json) : []; } catch { return []; }
    };
    const [d1, r2, kv, workers, pages] = await Promise.all([
      soft(`/accounts/${accountId}/d1/database`, j => (j.result || []).map((x: any) => ({ name: x.name, uuid: x.uuid, size: x.file_size }))),
      soft(`/accounts/${accountId}/r2/buckets`, j => (j.result?.buckets || []).map((x: any) => ({ name: x.name, created: x.creation_date }))),
      soft(`/accounts/${accountId}/storage/kv/namespaces`, j => (j.result || []).map((x: any) => ({ id: x.id, title: x.title }))),
      soft(`/accounts/${accountId}/workers/scripts`, j => (j.result || []).map((x: any) => ({ id: x.id, modified: x.modified_on }))),
      soft(`/accounts/${accountId}/pages/projects`, j => (j.result || []).map((x: any) => ({ name: x.name, domain: (x.domains || [])[0] || x.subdomain || '' }))),
    ]);
    return c.json({ configured: true, d1, r2, kv, workers, pages });
  } catch (err) {
    return c.json({ configured: false, d1: [], r2: [], kv: [], workers: [], error: err instanceof Error ? err.message : String(err) }, 200);
  }
});

// ── POST /purge-cache — purge the zone cache (everything) ────
cloudflare.post('/purge-cache', async (c) => {
  const denied = requireRole(c, 'admin');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const token = await cfg(db, 'cf_api_token');
    const zoneId = await cfg(db, 'cf_zone_id');
    if (!token || !zoneId) return c.json({ error: 'Token + zone id required', code: 'NOT_CONFIGURED' }, 400);

    const body = await c.req.json<{ files?: string[] }>().catch(() => ({} as { files?: string[] }));
    const purge = body.files && body.files.length
      ? { files: body.files.slice(0, 30) }
      : { purge_everything: true };
    const r = await cfFetch(token, `/zones/${zoneId}/purge_cache`, { method: 'POST', body: JSON.stringify(purge) });
    try {
      await execute(db,
        `INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
         VALUES (?, 'cf_cache_purge', 'cloudflare', 0, ?, 'worker')`,
        (c.get('userId') as number) ?? null,
        body.files?.length ? `Purged ${body.files.length} URL(s)` : 'Purged everything');
    } catch { /* audit best-effort */ }
    if (!r.ok) return c.json({ success: false, error: r.json?.errors?.[0]?.message || `HTTP ${r.status}` }, 502);
    return c.json({ success: true });
  } catch (err) {
    return c.json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

export default cloudflare;

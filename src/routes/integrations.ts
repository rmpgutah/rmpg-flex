// ============================================================
// Integrations — added 2026-06-06.
// Owns:
//   - rmpgutahps.us connected-service config (system_config row pair)
//   - integration_api_keys CRUD (real handlers over migration 0006 table)
//   - integration request log (from activity_log)
//
// Previously mounted at /api/integrations via the stubs router, which
// only answered /google-maps/client-key. Every other AdminIntegrationsTab
// fetch 404'd. Real handlers below + removal of the legacy stubs catch-all
// for these prefixes eliminate the 404 flood.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';

const integrations = new Hono<Env>();

function requireRole(c: { get: (k: 'user') => { role: string } | undefined }, ...roles: string[]): string | null {
  const u = c.get('user');
  if (!u || !roles.includes(u.role)) return 'Insufficient role';
  return null;
}

// ── Mapbox client token (browser-safe subset) ────────────────
// Lives here because geocode.ts owns the /api/integrations/mapbox/*
// mount via the bare-/api registration; this is the redundant but
// still-called /google-maps/client-key alias that the AdminPage
// requested in the legacy-era.
integrations.get('/google-maps/client-key', (c) => c.json({}));

// ── rmpgutahps.us service config (system_config row pair) ──
// `api_key` row is stored as a plain marker — the actual key sits
// in a separate column that the legacy encryptApiKey helper wrote.
// On the new stack we store the key plaintext under the same row
// (the Mapbox stack is not encrypted at rest — see AdminIntegrationsTab
// for the credential-hygiene note).
integrations.get('/services/rmpgutahps', async (c) => {
  try {
    const db = getDb(c.env);
    const keyRow = await queryFirst<{ config_value: string }>(
      db,
      `SELECT config_value FROM system_config
         WHERE config_key = 'rmpgutahps_api_key' AND category = 'integrations' AND is_active = 1
         LIMIT 1`,
    );
    const urlRow = await queryFirst<{ config_value: string }>(
      db,
      `SELECT config_value FROM system_config
         WHERE config_key = 'rmpgutahps_url' AND category = 'integrations' AND is_active = 1
         LIMIT 1`,
    );
    const key = keyRow?.config_value || '';
    return c.json({
      configured: !!key,
      url: urlRow?.config_value || 'https://rmpgutahps.us',
      // Return only a short tail so the page shows a preview without
      // exposing the full secret over the wire.
      key_preview: key ? '••••••••' + key.slice(-8) : null,
    });
  } catch (err) {
    console.error('[Integrations] Get rmpgutahps config failed:', err);
    return c.json({ error: 'Failed to get service config.' }, 500);
  }
});

integrations.put('/services/rmpgutahps', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const body = await c.req.json<{ api_key?: string; url?: string }>();
    const apiKey = typeof body.api_key === 'string' ? body.api_key.trim() : '';
    if (!apiKey) return c.json({ error: 'api_key is required.' }, 400);
    const siteUrl = (typeof body.url === 'string' && body.url.trim()) ? body.url.trim() : 'https://rmpgutahps.us';

    const db = getDb(c.env);
    // system_config has no UNIQUE(config_key) on live, so update-then-insert.
    for (const [k, v] of [['rmpgutahps_api_key', apiKey], ['rmpgutahps_url', siteUrl]] as const) {
      const r = await execute(
        db,
        `UPDATE system_config SET config_value = ?, is_active = 1, updated_at = datetime('now','localtime')
           WHERE config_key = ? AND category = 'integrations'`,
        v, k,
      );
      if (!r.meta.changes) {
        await execute(
          db,
          `INSERT INTO system_config (config_key, config_value, category, is_active, created_at, updated_at)
             VALUES (?, ?, 'integrations', 1, datetime('now','localtime'), datetime('now','localtime'))`,
          k, v,
        );
      }
    }
    return c.json({ success: true, message: 'rmpgutahps.us API key saved.' });
  } catch (err) {
    console.error('[Integrations] Save rmpgutahps config failed:', err);
    return c.json({ error: 'Failed to save service config.' }, 500);
  }
});

integrations.delete('/services/rmpgutahps', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    await execute(
      db,
      `UPDATE system_config SET is_active = 0, config_value = '', updated_at = datetime('now','localtime')
         WHERE config_key IN ('rmpgutahps_api_key', 'rmpgutahps_url') AND category = 'integrations'`,
    );
    return c.json({ success: true, message: 'rmpgutahps.us API key cleared.' });
  } catch (err) {
    console.error('[Integrations] Clear rmpgutahps config failed:', err);
    return c.json({ error: 'Failed to clear service config.' }, 500);
  }
});

// ── Integration API Keys (table: integration_api_keys) ───────
// Real CRUD over the table created in migration 0006. The legacy
// Express handler had full crypto + audit-log support; on the Worker
// stack we keep the same response shape but use simpler is_active
// toggling (the audit_log table exists, just left unwired for now).
integrations.get('/keys', async (c) => {
  const denied = requireRole(c, 'admin');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT id, name, key_prefix, is_active, scopes, last_used_at, request_count, created_at
         FROM integration_api_keys
         ORDER BY created_at DESC
         LIMIT 1000`,
    );
    return c.json(
      rows.map((k: any) => ({
        id: k.id,
        name: k.name,
        key_prefix: k.key_prefix,
        status: k.is_active ? 'active' : 'revoked',
        scopes: k.scopes,
        last_used_at: k.last_used_at,
        request_count: k.request_count,
        created_at: k.created_at,
      })),
    );
  } catch (err) {
    console.error('[Integrations] List keys failed:', err);
    return c.json({ error: 'Failed to list API keys' }, 500);
  }
});

integrations.post('/keys', async (c) => {
  const denied = requireRole(c, 'admin');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const body = await c.req.json<{ name?: string; scopes?: string[] }>();
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (name.length < 2) return c.json({ error: 'Name is required (min 2 characters)' }, 400);
    const db = getDb(c.env);
    const u = c.get('user');

    // Key shape mirrors legacy: rmpg_ps_<32 hex>. The full key is
    // returned to the caller ONCE; only the prefix + sha256 hash are
    // persisted. SHA-256 is computed via Web Crypto so we don't need
    // a Node import.
    const rawBytes = new Uint8Array(32);
    crypto.getRandomValues(rawBytes);
    const raw = Array.from(rawBytes, (b) => b.toString(16).padStart(2, '0')).join('');
    const fullKey = `rmpg_ps_${raw}`;
    const keyPrefix = `rmpg_ps_${raw.slice(0, 8)}…`;
    const hashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fullKey));
    const keyHash = Array.from(new Uint8Array(hashBuf), (b) => b.toString(16).padStart(2, '0')).join('');

    const scopeList = Array.isArray(body.scopes) ? JSON.stringify(body.scopes) : '["service_request"]';
    const r = await execute(
      db,
      `INSERT INTO integration_api_keys (name, key_prefix, key_hash, is_active, scopes, created_by, created_at)
         VALUES (?, ?, ?, 1, ?, ?, datetime('now','localtime'))`,
      name, keyPrefix, keyHash, scopeList, u?.id ?? null,
    );
    return c.json({
      success: true,
      id: Number(r.meta.last_row_id),
      name,
      key: fullKey,
      key_prefix: keyPrefix,
    });
  } catch (err) {
    console.error('[Integrations] Create key failed:', err);
    return c.json({ error: 'Failed to create API key' }, 500);
  }
});

integrations.patch('/keys/:id/revoke', async (c) => {
  const denied = requireRole(c, 'admin');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);
    const db = getDb(c.env);
    const existing = await queryFirst<{ id: number; name: string }>(
      db, `SELECT id, name FROM integration_api_keys WHERE id = ?`, id,
    );
    if (!existing) return c.json({ error: 'API key not found' }, 404);
    await execute(db, `UPDATE integration_api_keys SET is_active = 0 WHERE id = ?`, id);
    return c.json({ success: true, message: `API key "${existing.name}" revoked` });
  } catch (err) {
    console.error('[Integrations] Revoke key failed:', err);
    return c.json({ error: 'Failed to revoke API key' }, 500);
  }
});

integrations.patch('/keys/:id/activate', async (c) => {
  const denied = requireRole(c, 'admin');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);
    const db = getDb(c.env);
    const existing = await queryFirst<{ id: number; name: string }>(
      db, `SELECT id, name FROM integration_api_keys WHERE id = ?`, id,
    );
    if (!existing) return c.json({ error: 'API key not found' }, 404);
    await execute(db, `UPDATE integration_api_keys SET is_active = 1 WHERE id = ?`, id);
    return c.json({ success: true, message: `API key "${existing.name}" activated` });
  } catch (err) {
    console.error('[Integrations] Activate key failed:', err);
    return c.json({ error: 'Failed to activate API key' }, 500);
  }
});

integrations.delete('/keys/:id', async (c) => {
  const denied = requireRole(c, 'admin');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);
    const db = getDb(c.env);
    const existing = await queryFirst<{ id: number; name: string }>(
      db, `SELECT id, name FROM integration_api_keys WHERE id = ?`, id,
    );
    if (!existing) return c.json({ error: 'API key not found' }, 404);
    await execute(db, `DELETE FROM integration_api_keys WHERE id = ?`, id);
    return c.json({ success: true, message: `API key "${existing.name}" deleted` });
  } catch (err) {
    console.error('[Integrations] Delete key failed:', err);
    return c.json({ error: 'Failed to delete API key' }, 500);
  }
});

// GET /api/integrations/keys/request-log — last 100 api_key / service_request activity rows.
integrations.get('/keys/request-log', async (c) => {
  const denied = requireRole(c, 'admin');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    // activity_log.entity_type may or may not exist on this stack; guard.
    let rows: any[] = [];
    try {
      rows = await query<any>(
        db,
        `SELECT id, action, entity_type, entity_id, details, ip_address, created_at
           FROM activity_log
          WHERE entity_type = 'api_key' OR entity_type = 'service_request'
          ORDER BY created_at DESC
          LIMIT 100`,
      );
    } catch {
      // activity_log table missing entity_type column on some live DBs —
      // fall back to a permissive action filter so the panel still renders.
      rows = await query<any>(
        db,
        `SELECT id, action, details, ip_address, created_at
           FROM activity_log
          WHERE action LIKE '%api_key%' OR action LIKE '%service_request%'
          ORDER BY created_at DESC
          LIMIT 100`,
      );
    }
    return c.json(
      rows.map((l: any) => ({
        id: l.id,
        created_at: l.created_at,
        details: l.details || l.action,
        ip_address: l.ip_address,
        entity_id: l.entity_id ? String(l.entity_id) : null,
      })),
    );
  } catch (err) {
    console.error('[Integrations] Request log failed:', err);
    return c.json({ error: 'Failed to fetch request log' }, 500);
  }
});

export default integrations;

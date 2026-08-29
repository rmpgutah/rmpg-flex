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
import { sha256Hex } from '../utils/apiKeys';
import { requireApiKeyScope } from '../middleware/apiKeyAuth';
import { log } from '../utils/logger';
import { parseDialConnectRecordingIngest, upsertDialConnectRecording } from '../utils/dialConnectRecordings';

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
        `UPDATE system_config SET config_value = ?, is_active = 1, updated_at = datetime('now')
           WHERE config_key = ? AND category = 'integrations'`,
        v, k,
      );
      if (!r.meta.changes) {
        await execute(
          db,
          `INSERT INTO system_config (config_key, config_value, category, is_active, created_at, updated_at)
             VALUES (?, ?, 'integrations', 1, datetime('now'), datetime('now'))`,
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
      `UPDATE system_config SET is_active = 0, config_value = '', updated_at = datetime('now')
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
    const keyHash = await sha256Hex(fullKey);

    const scopeList = Array.isArray(body.scopes) ? JSON.stringify(body.scopes) : '["service_request"]';
    const r = await execute(
      db,
      `INSERT INTO integration_api_keys (name, key_prefix, key_hash, is_active, scopes, created_by, created_at)
         VALUES (?, ?, ?, 1, ?, ?, datetime('now'))`,
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

// ── Dial Connect → calls_for_service push ────────────────────
// POST /api/integrations/calls-for-service
//
// Auth: NOT the JWT authMiddleware (Dial Connect is a separate service, no
// human session) — gated by requireApiKeyScope('service_request') below,
// over the integration_api_keys table (migration 0006). The exact path is
// carved out of authMiddleware's isPublicAuthBypass() in src/middleware/auth.ts
// so the JWT check never runs first (same pattern as the Fleet.io webhook).
//
// Field-mapping decisions (see also migrations/0184_cfs_ext_external_source_system.sql):
//   - priority: 1|2|3 → 'P1'|'P2'|'P3'. Never emits 'P4' (that's a manual
//     dispatcher downgrade path, not something an inbound intake call uses).
//   - status: open→pending, dispatched→dispatched, on_scene→onscene,
//     resolved→cleared, closed→closed (calls_for_service.status CHECK values).
//   - incidentType passes straight through into the free-text incident_type
//     column (no CHECK constraint on that column).
//   - source: the calls_for_service.source CHECK constraint
//     ('phone','radio','alarm','walk_in','email','patrol','online','dispatch',
//     'panic','servemanager','intake','other') does NOT include 'dial_connect',
//     and changing a CHECK requires the risky full-table rebuild that was
//     reverted in migration 0040 (see that file's header). So we store
//     source='other' on the base row and the real system name
//     ('dial_connect') on calls_for_service_ext.external_source_system
//     (migration 0184) instead — same "push overflow off the capped base
//     table" pattern as every other _ext column.
//   - dispatcher_id / case_id / client_id / contract_id / property_id: all
//     nullable with no FK requirement on calls_for_service, so they're left
//     NULL for an API-pushed call with no human dispatcher yet — no
//     placeholder needed.
//   - call_number: generated with the same CFS{YY}-{NNNNN} scheme
//     src/routes/dispatch/calls.ts uses for manually-created calls, so
//     Dial Connect calls sort into the same per-year sequence.
//   - created_at / status default: left to the column defaults
//     (datetime('now') / 'pending', respectively — though status
//     is always explicit here since it's a required input).
const VALID_INCIDENT_TYPES = new Set(['process_service', 'consultation', 'security', 'other']);
const VALID_STATUSES = new Set(['open', 'dispatched', 'on_scene', 'resolved', 'closed']);
const STATUS_MAP: Record<string, string> = {
  open: 'pending',
  dispatched: 'dispatched',
  on_scene: 'onscene',
  resolved: 'cleared',
  closed: 'closed',
};
const PRIORITY_MAP: Record<number, string> = { 1: 'P1', 2: 'P2', 3: 'P3' };

interface CallsForServiceRequestBody {
  locationAddress?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  incidentType?: unknown;
  priority?: unknown;
  status?: unknown;
  notes?: unknown;
  callerName?: unknown;
  callerPhone?: unknown;
}

integrations.post('/calls-for-service', requireApiKeyScope('service_request'), async (c) => {
  try {
    const body = await c.req.json<CallsForServiceRequestBody>().catch(() => ({}) as CallsForServiceRequestBody);

    const locationAddress = typeof body.locationAddress === 'string' ? body.locationAddress.trim() : '';
    if (!locationAddress) {
      return c.json({ error: 'locationAddress is required' }, 400);
    }

    const incidentType = typeof body.incidentType === 'string' ? body.incidentType : '';
    if (!VALID_INCIDENT_TYPES.has(incidentType)) {
      return c.json({ error: `incidentType must be one of: ${[...VALID_INCIDENT_TYPES].join(', ')}` }, 400);
    }

    const priorityNum = typeof body.priority === 'number' ? body.priority : Number(body.priority);
    if (!Number.isInteger(priorityNum) || !(priorityNum in PRIORITY_MAP)) {
      return c.json({ error: 'priority must be one of: 1, 2, 3' }, 400);
    }
    const priority = PRIORITY_MAP[priorityNum];

    const status = typeof body.status === 'string' ? body.status : '';
    if (!VALID_STATUSES.has(status)) {
      return c.json({ error: `status must be one of: ${[...VALID_STATUSES].join(', ')}` }, 400);
    }
    const mappedStatus = STATUS_MAP[status];

    const latitude = body.latitude != null && body.latitude !== '' ? Number(body.latitude) : null;
    if (latitude != null && !Number.isFinite(latitude)) {
      return c.json({ error: 'latitude must be a number' }, 400);
    }
    const longitude = body.longitude != null && body.longitude !== '' ? Number(body.longitude) : null;
    if (longitude != null && !Number.isFinite(longitude)) {
      return c.json({ error: 'longitude must be a number' }, 400);
    }

    const notes = typeof body.notes === 'string' ? body.notes : null;
    const callerName = typeof body.callerName === 'string' ? body.callerName : null;
    const callerPhone = typeof body.callerPhone === 'string' ? body.callerPhone : null;

    const db = getDb(c.env);

    // Same CFS{YY}-{NNNNN} per-year sequence as src/routes/dispatch/calls.ts
    // (see that file's `nextCallNumber` for the read-max-then-increment /
    // non-atomic caveat — identical tradeoff applies here).
    const year = new Date().getFullYear().toString().slice(-2);
    const prefix = `CFS${year}-`;
    const [{ max }] = await query<{ max: string | null }>(
      db,
      `SELECT MAX(call_number) as max FROM calls_for_service WHERE call_number LIKE ?`,
      `${prefix}%`,
    );
    const seq = max ? String(parseInt(max.slice(prefix.length), 10) + 1).padStart(5, '0') : '00001';
    const callNumber = `${prefix}${seq}`;

    const result = await execute(
      db,
      `INSERT INTO calls_for_service
         (call_number, incident_type, priority, status, caller_name, caller_phone,
          location_address, latitude, longitude, notes, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'other')`,
      callNumber, incidentType, priority, mappedStatus, callerName, callerPhone,
      locationAddress, latitude, longitude, notes,
    );
    const id = Number(result.meta.last_row_id);

    await execute(
      db,
      `INSERT INTO calls_for_service_ext (id, external_source_system) VALUES (?, 'dial_connect')`,
      id,
    );

    return c.json({ id, call_number: callNumber }, 201);
  } catch (err) {
    console.error('[Integrations] Create calls-for-service failed:', err);
    return c.json({ error: 'Failed to create call for service' }, 500);
  }
});

// ── Dial Connect ← calls_for_service read ─────────────────────
// GET /api/integrations/calls-for-service?callerPhone=...
//
// Separate scope from the write route (service_request) on purpose:
// service_request_read only lets a key look up existing CFS rows, never
// create them. Same requireApiKeyScope middleware, same auth model as the
// POST handler above (no human JWT session).
integrations.get('/calls-for-service', requireApiKeyScope('service_request_read'), async (c) => {
  try {
    const callerPhone = c.req.query('callerPhone');
    if (!callerPhone || !callerPhone.trim()) {
      return c.json({ error: 'callerPhone query parameter is required' }, 400);
    }

    const db = getDb(c.env);
    const row = await queryFirst<{
      id: number;
      call_number: string;
      status: string;
      incident_type: string;
      priority: string;
      created_at: string;
    }>(
      db,
      `SELECT id, call_number, status, incident_type, priority, created_at
       FROM calls_for_service
       WHERE caller_phone = ?
       ORDER BY created_at DESC
       LIMIT 1`,
      callerPhone,
    );

    if (!row) {
      return c.json({ error: 'No calls for service found for this caller' }, 404);
    }

    return c.json({
      id: row.id,
      callNumber: row.call_number,
      status: row.status,
      incidentType: row.incident_type,
      priority: row.priority,
      createdAt: row.created_at,
    });
  } catch (err) {
    console.error('[Integrations] Lookup calls-for-service failed:', err);
    return c.json({ error: 'Failed to look up calls for service' }, 500);
  }
});

// ── Dial Connect → recordings + transcripts ─────────────────
// POST /api/integrations/dial-connect-recordings
//
// Same auth model as the CFS push: JWT bypass + requireApiKeyScope('service_request').
// Existing Dial Connect keys already carry that scope, so recordings start landing
// as soon as Dial Connect POSTs — no new key issuance required.
integrations.post('/dial-connect-recordings', requireApiKeyScope('service_request'), async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = parseDialConnectRecordingIngest(body);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const authHeader = c.req.header('Authorization');
  const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;
  try {
    const result = await upsertDialConnectRecording({
      db: getDb(c.env),
      uploads: c.env.UPLOADS,
      env: c.env,
      ingest: parsed.value,
      source: 'dial_connect',
      audioFetchBearer: bearer,
    });
    return c.json({ ok: true, ...result }, result.created ? 201 : 200);
  } catch (err) {
    log.error('Dial Connect recording ingest failed', { recordingSid: parsed.value.recordingSid }, err);
    return c.json({ error: 'Failed to store recording' }, 500);
  }
});

export default integrations;

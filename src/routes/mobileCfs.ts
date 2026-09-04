// ============================================================
// Mobile CFS — PSO field workflow over a QR-token scoped session.
// Ported from legacy/server-vps/src/routes/mobileCfs.ts (the Worker had only
// stubs). Flow: dispatcher/officer generates a QR token for a PSO Client
// Request call (printed on the PSO PDF) -> field officer scans it on their
// phone -> /challenge shows the call -> /auth (badge + token) mints a scoped
// 30-day JWT -> /status, /narrative, /pso update the call from the field.
//
// Two routers: `cfsQr` mounts at /api/cfs (normal auth) for token issuance +
// admin override; `mobileCfs` mounts at /api/mobile (public) — challenge/auth
// are unauthenticated (the phone has no session yet) and the mutations are
// gated by the scoped 'pso-mobile' token, NOT the normal JWT.
//
// Cap-aware writes: PSO fields (pso_attempt_number, process_*) live on
// calls_for_service_ext (base is at the D1 100-col cap); status/notes/stamps
// are on the base table.
// ============================================================

import { Hono } from 'hono';
import { SignJWT, jwtVerify } from 'jose';
import type { Env } from '../types';
import { getDb, queryFirst, execute, columnExists } from '../utils/db';
import { recordAudit } from '../utils/auditLog';
import { requireRole } from '../middleware/auth';
import { rateLimitAllow } from '../utils/rateLimit';
import { log } from '../utils/logger';

const PUBLIC_APP_URL = 'https://rmpgutah.us';

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function bestEffortAudit(c: any, userId: number | null, action: string, entityId: number, details: unknown) {
  // Routes through the central audit seam (audit_log + flex_events analytics).
  await recordAudit(c, { action, entityType: 'calls_for_service', entityId, details, actorId: userId });
}

interface MobileAuth { userId: number; username: string; role: string; callId: number }

// Verify the scoped mobile token and confirm it's bound to the :id call.
// Rate limiting shares the same bucket format as apiRateLimit
// (src/middleware/rateLimit.ts) — a user active on both the desktop app
// and the mobile PSO flow shares one budget. Returning null on a
// rate-limit hit (rather than a distinct response) keeps this function's
// existing MobileAuth | null contract unchanged; callers already treat
// null as "auth required" per their existing 401 handling.
async function verifyMobile(c: any): Promise<MobileAuth | null> {
  const header = c.req.header('authorization');
  const token = header && header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  try {
    const secret = new TextEncoder().encode(c.env.JWT_SECRET as string);
    const { payload } = await jwtVerify(token, secret);
    if (payload.scope !== 'pso-mobile' || !payload.callId || !payload.userId) return null;
    const paramId = parseInt(String(c.req.param('id') || ''), 10);
    if (paramId && paramId !== payload.callId) return null;
    const userId = Number(payload.userId);
    const allowed = await rateLimitAllow(c.env.KV, `api:user:${userId}`, 600, 300);
    if (!allowed) {
      log.warn('Mobile API rate limit exceeded', { userId });
      return null;
    }
    return {
      userId, username: String(payload.username ?? ''),
      role: String(payload.role ?? ''), callId: Number(payload.callId),
    };
  } catch { return null; }
}

// ── /api/cfs (normal auth) ──────────────────────────────────
export const cfsQr = new Hono<Env>();

// POST /api/cfs/:id/qr-token — issue a single-dispatch QR token. The client
// renders the QR PNG from `url` for the PSO PDF (Worker can't rasterize).
cfsQr.post('/:id/qr-token', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), async (c) => {
  try {
    const callId = parseInt(c.req.param('id') || '', 10);
    if (!callId) return c.json({ error: 'Invalid call id' }, 400);
    const db = getDb(c.env);
    const call = await queryFirst<{ id: number; incident_type: string }>(db,
      'SELECT id, incident_type FROM calls_for_service WHERE id = ?', callId);
    if (!call) return c.json({ error: 'Call not found' }, 404);
    if (call.incident_type !== 'pso_client_request') {
      return c.json({ error: 'QR tokens are only issued for PSO Client Request dispatches' }, 400);
    }
    const user = c.get('user') as { id: number } | undefined;
    const token = randomToken();
    await execute(db,
      `INSERT INTO pso_qr_tokens (call_id, token, scans_used, max_scans, created_by, created_at)
       VALUES (?, ?, 0, 5, ?, datetime('now'))`,
      callId, token, user?.id ?? null);
    const url = `${PUBLIC_APP_URL}/m/cfs/${callId}?t=${token}`;
    await bestEffortAudit(c, user?.id ?? null, 'QR_TOKEN_CREATE', callId, { call_id: callId });
    return c.json({ token, url });
  } catch (err) {
    console.error('qr-token create failed:', err);
    return c.json({ error: 'Failed to create QR token' }, 500);
  }
});

// POST /api/cfs/:id/qr/override — admin: reset | override | revoke the latest token.
cfsQr.post('/:id/qr/override', requireRole('admin'), async (c) => {
  try {
    const callId = parseInt(c.req.param('id') || '', 10);
    const { action } = await c.req.json<{ action?: string }>().catch(() => ({ action: '' }));
    const db = getDb(c.env);
    const tok = await queryFirst<{ id: number }>(db,
      'SELECT id FROM pso_qr_tokens WHERE call_id = ? ORDER BY id DESC LIMIT 1', callId);
    if (!tok) return c.json({ error: 'No QR token for this call' }, 404);
    if (action === 'reset') await execute(db, 'UPDATE pso_qr_tokens SET scans_used = 0 WHERE id = ?', tok.id);
    else if (action === 'override') await execute(db, 'UPDATE pso_qr_tokens SET admin_override = 1 WHERE id = ?', tok.id);
    else if (action === 'revoke') await execute(db, "UPDATE pso_qr_tokens SET revoked_at = datetime('now') WHERE id = ?", tok.id);
    else return c.json({ error: 'action must be reset | override | revoke' }, 400);
    const user = c.get('user') as { id: number } | undefined;
    await bestEffortAudit(c, user?.id ?? null, 'QR_TOKEN_OVERRIDE', callId, { action, call_id: callId });
    return c.json({ success: true });
  } catch (err) {
    console.error('qr override failed:', err);
    return c.json({ error: 'Override failed' }, 500);
  }
});

// ── /api/mobile (public mount) ──────────────────────────────
export const mobileCfs = new Hono<Env>();

// Shared: load + validate a token row for a call.
async function loadToken(c: any, callId: number, token: string) {
  return queryFirst<{ id: number; call_id: number; scans_used: number; max_scans: number; admin_override: number; revoked_at: string | null }>(
    getDb(c.env),
    `SELECT id, call_id, scans_used, max_scans, admin_override, revoked_at
       FROM pso_qr_tokens WHERE token = ? AND call_id = ?`, token, callId);
}

// GET /api/mobile/cfs/:id/challenge?t= — verify token (no scan increment), return call summary.
mobileCfs.get('/cfs/:id/challenge', async (c) => {
  try {
    const callId = parseInt(c.req.param('id') || '', 10);
    const token = c.req.query('t') || '';
    if (!callId || !token) return c.json({ error: 'Missing call id or token' }, 400);
    const row = await loadToken(c, callId, token);
    if (!row) return c.json({ error: 'Unknown QR token' }, 404);
    if (row.revoked_at) return c.json({ error: 'QR token has been revoked' }, 403);
    if (!row.admin_override && row.scans_used >= row.max_scans) {
      return c.json({ error: 'QR scan limit reached; ask an admin to reissue or override' }, 403);
    }
    const call = await queryFirst<Record<string, unknown>>(getDb(c.env),
      `SELECT c.id, c.call_number, c.incident_type, c.location_address AS location,
              e.pso_service_type, c.contract_id, c.status, c.priority, c.created_at,
              e.pso_attempt_number, e.process_service_result, e.process_served_to
         FROM calls_for_service c
         LEFT JOIN calls_for_service_ext e ON e.id = c.id
        WHERE c.id = ?`, callId);
    if (!call) return c.json({ error: 'Call not found' }, 404);
    if (call.incident_type !== 'pso_client_request') return c.json({ error: 'Not a PSO Client Request dispatch' }, 400);
    return c.json({
      call,
      scans_remaining: row.admin_override ? null : Math.max(0, row.max_scans - row.scans_used),
      admin_override: !!row.admin_override,
    });
  } catch (err) {
    console.error('mobile challenge failed:', err);
    return c.json({ error: 'Challenge failed' }, 500);
  }
});

// POST /api/mobile/cfs/:id/auth — body {token, user_id(badge)}; increments scans, mints scoped JWT.
mobileCfs.post('/cfs/:id/auth', async (c) => {
  try {
    const callId = parseInt(c.req.param('id') || '', 10);
    const { token, user_id } = await c.req.json<{ token?: string; user_id?: string | number }>().catch(() => ({} as { token?: string; user_id?: string | number }));
    const userIdNum = parseInt(String(user_id ?? ''), 10);
    if (!callId || !token || !userIdNum) return c.json({ error: 'Missing call id, token, or user_id' }, 400);
    const db = getDb(c.env);
    const row = await loadToken(c, callId, token);
    if (!row) return c.json({ error: 'Unknown QR token' }, 404);
    if (row.revoked_at) return c.json({ error: 'QR token has been revoked' }, 403);
    if (!row.admin_override && row.scans_used >= row.max_scans) return c.json({ error: 'QR scan limit reached' }, 403);
    // Officers enter their badge number; employee_id is accepted as the
    // documented alternate. The `OR id = ?` fallback that used to be here was
    // removed: this endpoint is unauthenticated (it's gated only by a QR token
    // PRINTED on paperwork handed to clients and served parties), so a raw
    // `users.id` lookup let anyone holding that paper mint a session as an
    // arbitrary user — `user_id: 1` reliably resolves to the first/admin row,
    // whereas badge numbers at least have to be known and don't line up with
    // small integers.
    const badgeStr = String(userIdNum);
    const user = await queryFirst<{ id: number; username: string; role: string; full_name: string; status: string }>(db,
      `SELECT id, username, role, full_name, status FROM users
        WHERE badge_number = ? OR employee_id = ? LIMIT 1`, badgeStr, badgeStr);
    if (!user) return c.json({ error: 'User ID not recognized' }, 404);
    if (user.status && user.status !== 'active') return c.json({ error: `User is ${user.status}` }, 403);
    if (!row.admin_override) {
      await execute(db, `UPDATE pso_qr_tokens SET scans_used = scans_used + 1, last_scanned_at = datetime('now'), last_scanned_by = ? WHERE id = ?`, userIdNum, row.id);
    } else {
      await execute(db, `UPDATE pso_qr_tokens SET last_scanned_at = datetime('now'), last_scanned_by = ? WHERE id = ?`, userIdNum, row.id);
    }
    const secret = new TextEncoder().encode(c.env.JWT_SECRET as string);
    // 12h, not the original 30d: this is a single-shift field session minted
    // from a printed QR code. A month-long bearer derived from paperwork that
    // outlives the call is a standing credential, and the token is only useful
    // for the duration of the on-scene work anyway.
    const scopedToken = await new SignJWT({ userId: user.id, username: user.username, role: user.role, scope: 'pso-mobile', callId })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('12h').sign(secret);
    await bestEffortAudit(c, user.id, 'MOBILE_AUTH', callId, { user_id: userIdNum });
    return c.json({
      token: scopedToken,
      user: { id: user.id, username: user.username, full_name: user.full_name, role: user.role },
      call_id: callId,
      scans_remaining: row.admin_override ? null : Math.max(0, row.max_scans - (row.scans_used + 1)),
    });
  } catch (err) {
    console.error('mobile auth failed:', err);
    return c.json({ error: 'Auth failed' }, 500);
  }
});

const STATUS_STAMP: Record<string, string> = {
  dispatched: 'dispatched_at', enroute: 'enroute_at', onscene: 'onscene_at', cleared: 'cleared_at', closed: 'closed_at',
};

// POST /api/mobile/cfs/:id/status — scoped; update status + stamp.
mobileCfs.post('/cfs/:id/status', async (c) => {
  const auth = await verifyMobile(c);
  if (!auth) return c.json({ error: 'Mobile authentication required' }, 401);
  try {
    const { status } = await c.req.json<{ status?: string }>().catch(() => ({} as { status?: string }));
    const col = status ? STATUS_STAMP[status] : undefined;
    if (!status || !col) return c.json({ error: 'Invalid status' }, 400);
    const db = getDb(c.env);
    await execute(db,
      `UPDATE calls_for_service SET status = ?, ${col} = COALESCE(${col}, datetime('now')), updated_at = datetime('now') WHERE id = ?`,
      status, auth.callId);
    const updated = await queryFirst<Record<string, unknown>>(db,
      `SELECT id, call_number, incident_type, status, location_address, location_city,
              priority, officer_id, unit_id, notes,
              dispatched_at, enroute_at, onscene_at, cleared_at, closed_at,
              created_at, updated_at
       FROM calls_for_service WHERE id = ?`, auth.callId);
    await bestEffortAudit(c, auth.userId, 'MOBILE_STATUS', auth.callId, { status, source: 'pso-mobile' });
    // Mirror terminal status → serve_queue (same as the desktop path in extensions.ts PUT /:id/status).
    // The crosslink self-skips for non-PSO calls, so we can fire unconditionally.
    const TERMINAL_STATUSES = new Set(['cleared', 'closed', 'cancelled']);
    if (TERMINAL_STATUSES.has(status)) {
      const { crossLinkPsoCloseToServe } = await import('../utils/psoServeCrosslink');
      c.executionCtx.waitUntil(
        crossLinkPsoCloseToServe(db, auth.callId, { actorUserId: auth.userId }).catch(err =>
          console.error('[pso-crosslink] mobile terminal status crosslink failed:', err)
        )
      );
    }
    return c.json({ success: true, call: updated });
  } catch (err) {
    console.error('mobile status update failed:', err);
    return c.json({ error: 'Status update failed' }, 500);
  }
});

// POST /api/mobile/cfs/:id/narrative — scoped; append a note to the JSON notes array.
mobileCfs.post('/cfs/:id/narrative', async (c) => {
  const auth = await verifyMobile(c);
  if (!auth) return c.json({ error: 'Mobile authentication required' }, 401);
  try {
    const { content } = await c.req.json<{ content?: string }>().catch(() => ({} as { content?: string }));
    if (!content || !String(content).trim()) return c.json({ error: 'Narrative cannot be empty' }, 400);
    const db = getDb(c.env);
    const existing = await queryFirst<{ notes: string | null }>(db, 'SELECT notes FROM calls_for_service WHERE id = ?', auth.callId);
    let notes: unknown[] = [];
    try { const parsed = JSON.parse(existing?.notes || '[]'); if (Array.isArray(parsed)) notes = parsed; } catch { /* reset on corrupt */ }
    notes.push({
      id: crypto.randomUUID(),
      text: String(content).trim(),
      author: `PSO MOBILE / ${auth.username}`,
      timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
      type: 'pso_mobile_narrative',
    });
    await execute(db, "UPDATE calls_for_service SET notes = ?, updated_at = datetime('now') WHERE id = ?", JSON.stringify(notes), auth.callId);
    await bestEffortAudit(c, auth.userId, 'MOBILE_NARRATIVE', auth.callId, { source: 'pso-mobile' });
    return c.json({ success: true });
  } catch (err) {
    console.error('mobile narrative failed:', err);
    return c.json({ error: 'Narrative update failed' }, 500);
  }
});

// PSO field edits route to calls_for_service_ext (base is at the col cap).
const PSO_FIELDS: Array<[string, string]> = [
  ['pso_attempt_number', 'pso_attempt_number'],
  ['pso_result', 'process_service_result'],
  ['process_served_to', 'process_served_to'],
  ['process_served_at', 'process_served_at'],
  ['process_service_address', 'process_served_address'],
];

// POST /api/mobile/cfs/:id/pso — scoped; update PSO fields on the ext table.
mobileCfs.post('/cfs/:id/pso', async (c) => {
  const auth = await verifyMobile(c);
  if (!auth) return c.json({ error: 'Mobile authentication required' }, 401);
  try {
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const [key, col] of PSO_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(body, key)) { sets.push(`${col} = ?`); vals.push(body[key] ?? null); }
    }
    if (sets.length === 0) return c.json({ error: 'No updatable fields provided' }, 400);
    const db = getDb(c.env);
    await execute(db, 'INSERT OR IGNORE INTO calls_for_service_ext (id) VALUES (?)', auth.callId);
    await execute(db, `UPDATE calls_for_service_ext SET ${sets.join(', ')} WHERE id = ?`, ...vals, auth.callId);
    await execute(db, "UPDATE calls_for_service SET updated_at = datetime('now') WHERE id = ?", auth.callId);
    // The PSO fields just written live on the ext table (base is at the
    // column cap) — merge it in, or the response's `call` never reflects
    // what was just saved and the mobile UI has nothing to redisplay.
    const updatedBase = await queryFirst<Record<string, unknown>>(db,
      `SELECT id, call_number, incident_type, status, location_address, location_city,
              priority, officer_id, unit_id, notes,
              dispatched_at, enroute_at, onscene_at, cleared_at, closed_at,
              created_at, updated_at
       FROM calls_for_service WHERE id = ?`, auth.callId);
    const updatedExt = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM calls_for_service_ext WHERE id = ?', auth.callId);
    const updated = { ...(updatedBase || {}), ...(updatedExt || {}) };
    await bestEffortAudit(c, auth.userId, 'MOBILE_PSO', auth.callId, { fields: sets, source: 'pso-mobile' });

    // Mirror a result submission to the linked serve_queue in real time so
    // the ServePage stays in sync during active service — before the CFS
    // reaches a terminal status that would trigger the full crosslink.
    // Only fires when pso_result is present in the submission (not on every
    // ext field update like address or attempt counter increments).
    const rawResult = body.pso_result as string | undefined;
    if (rawResult) {
      // Map mobile UI values to serve_attempts CHECK enum values.
      const RESULT_MAP: Record<string, string> = {
        served: 'served', sub_served: 'sub_served', not_home: 'no_answer',
        refused: 'refused', bad_address: 'bad_address',
      };
      const legacyResult = RESULT_MAP[rawResult] ?? 'other';
      const isServed = legacyResult === 'served' || legacyResult === 'sub_served';

      c.executionCtx.waitUntil((async () => {
        try {
          const qRow = await queryFirst<{ id: number; attempt_count: number; status: string }>(
            db, 'SELECT id, attempt_count, status FROM serve_queue WHERE call_id = ?', auth.callId,
          );
          if (!qRow) return; // no linked queue row yet; crosslink creates it on terminal status
          const nextNum = (Number(qRow.attempt_count) || 0) + 1;
          const newStatus = isServed ? 'served' : nextNum >= 3 ? 'failed' : 'attempted';
          const noteText = `[Mobile PSO] ${rawResult}${body.process_served_to ? ` → ${body.process_served_to}` : ''}`;
          const hasDispositionCol = await columnExists(db, 'serve_attempts', 'disposition_code');
          if (hasDispositionCol) {
            await execute(db,
              `INSERT INTO serve_attempts
                 (serve_queue_id, attempt_number, officer_id, result, disposition_code, notes, attempt_type)
               VALUES (?, ?, ?, ?, NULL, ?, ?)`,
              qRow.id, nextNum, auth.userId, legacyResult, noteText,
              isServed ? 'personal' : 'failed');
          } else {
            await execute(db,
              `INSERT INTO serve_attempts
                 (serve_queue_id, attempt_number, officer_id, result, notes, attempt_type)
               VALUES (?, ?, ?, ?, ?, ?)`,
              qRow.id, nextNum, auth.userId, legacyResult, noteText,
              isServed ? 'personal' : 'failed');
          }
          await execute(db,
            `UPDATE serve_queue SET attempt_count = ?, status = ?, updated_at = datetime('now') WHERE id = ?`,
            nextNum, newStatus, qRow.id);
        } catch (err) {
          console.error('[pso-mobile] serve_queue attempt mirror failed:', err);
        }
      })());
    }

    return c.json({ success: true, call: updated });
  } catch (err) {
    console.error('mobile pso edit failed:', err);
    return c.json({ error: 'PSO edit failed' }, 500);
  }
});

export default mobileCfs;

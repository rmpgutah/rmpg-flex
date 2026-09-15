// ============================================================
// RMPG Flex — SafeWatch inbound alert ingest + triage
// ------------------------------------------------------------
// Integration with github.com/achalif/team3-safewatch.
//
// INBOUND ONLY. SafeWatch pushes resident-submitted community
// reports and aggregated third-party feed items into RMPG Flex.
// Nothing about RMPG operations — calls, units, persons, warrants —
// is ever sent outbound. There is deliberately no publisher here.
//
// Two routers, mounted at two prefixes with different auth:
//   safewatchIngest  -> /api/safewatch/ingest   (public, HMAC-gated)
//   safewatchTriage  -> /api/safewatch-alerts   (JWT, role-gated)
//
// They are split because the ingest endpoint must be reachable
// without a JWT (a server-to-server push carries no user), while the
// triage surface must not be. Mounting one router at a public prefix
// would expose the listing too — see src/index.ts, which applies
// authMiddleware per REGISTERED PREFIX, not per handler. (The comment
// at src/routes/community.ts:143 claiming its POST /tips is public is
// wrong for exactly this reason: /api/community is auth:'required'.)
//
// Auth model matches src/routes/deliveriesWebhook.ts: HMAC-SHA256
// over the raw body, hex, header `x-rmpg-flex-hmac-sha256`, secret
// SAFEWATCH_WEBHOOK_SECRET. Unset -> 200 not_configured.
//
// SafeWatch content is UNTRUSTED PUBLIC INPUT. It lands quarantined
// in safewatch_alerts and is NEVER auto-promoted into
// calls_for_service / public_tips / investigative_tips. Promotion is
// a deliberate act by a supervisor via POST /:id/promote.
//
// Migration: 0291_safewatch_alerts.sql (also reconciled at runtime).
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { hmacSha256Hex, constantTimeEquals } from './fleetioWebhook';
import { parseSafewatchAlert, type SafewatchAlertPayload } from '../utils/safewatchAlert';
import { getDb, query, queryFirst, execute } from '../utils/db';
import { notConfigured } from '../utils/notConfigured';
import { log } from '../utils/logger';

const safewatchIngest = new Hono<Env>();
const safewatchTriage = new Hono<Env>();

/** Largest raw body accepted. A community report is a paragraph; anything
 *  past this is abuse or a caller bug, and we reject before parsing. */
const MAX_BODY_BYTES = 64 * 1024;

/** Severities that page a dispatcher on arrival. 'info' lands silently in
 *  the triage queue — a live notification for every routine resident report
 *  would train dispatchers to ignore the channel. */
const NOTIFY_SEVERITIES = new Set(['advisory', 'urgent']);

const TRIAGE_READ = ['admin', 'manager', 'supervisor', 'dispatcher', 'officer'];
const TRIAGE_WRITE = ['admin', 'manager', 'supervisor'];

function requireRole(c: { get: (k: 'user') => { role: string } | undefined }, roles: string[]): string | null {
  const u = c.get('user');
  if (!u || !roles.includes(u.role)) return 'Insufficient role';
  return null;
}

// Runtime reconciliation, same pattern as src/routes/alpr.ts: the route
// works even if 0291 has not landed yet. Cheap and idempotent.
async function ensureSafewatchTable(db: D1Database): Promise<void> {
  await execute(db, `CREATE TABLE IF NOT EXISTS safewatch_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    external_id TEXT NOT NULL,
    source_kind TEXT NOT NULL DEFAULT 'community' CHECK(source_kind IN ('community','feed')),
    source TEXT NOT NULL DEFAULT 'safewatch',
    alert_type TEXT,
    severity TEXT NOT NULL DEFAULT 'info' CHECK(severity IN ('info','advisory','urgent')),
    headline TEXT NOT NULL,
    body TEXT,
    location_text TEXT,
    latitude REAL,
    longitude REAL,
    reporter_contact TEXT,
    occurred_at TEXT,
    received_at TEXT NOT NULL DEFAULT (datetime('now')),
    status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','reviewed','promoted','dismissed')),
    reviewed_by INTEGER,
    reviewed_at TEXT,
    promoted_tip_id INTEGER,
    raw_payload TEXT NOT NULL
  )`);
  await execute(db, `CREATE UNIQUE INDEX IF NOT EXISTS idx_safewatch_alerts_ext
    ON safewatch_alerts(source, external_id)`);
  await execute(db, `CREATE INDEX IF NOT EXISTS idx_safewatch_alerts_status
    ON safewatch_alerts(status, received_at DESC)`);
  await execute(db, `CREATE INDEX IF NOT EXISTS idx_safewatch_alerts_kind
    ON safewatch_alerts(source_kind, received_at DESC)`);
}

// Single statement keyed on the UNIQUE (source, external_id) index, so two
// concurrent deliveries of the same alert converge on ONE row instead of
// one of them hitting the index violation. Same reasoning as
// dialerConnect.ts's upsertCall() — a check-then-insert here would either
// double-insert or 500 under a retry storm.
//
// Triage columns (status / reviewed_by / reviewed_at / promoted_tip_id) are
// absent from the DO UPDATE list on purpose: a redelivery must not reset a
// row a supervisor has already dismissed or promoted.
async function upsertAlert(db: D1Database, p: SafewatchAlertPayload, raw: string): Promise<number> {
  await execute(db,
    `INSERT INTO safewatch_alerts
       (external_id, source_kind, source, alert_type, severity, headline, body,
        location_text, latitude, longitude, reporter_contact, occurred_at, raw_payload)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source, external_id) DO UPDATE SET
       source_kind = excluded.source_kind,
       alert_type = excluded.alert_type,
       severity = excluded.severity,
       headline = excluded.headline,
       body = excluded.body,
       location_text = excluded.location_text,
       latitude = excluded.latitude,
       longitude = excluded.longitude,
       reporter_contact = excluded.reporter_contact,
       occurred_at = excluded.occurred_at,
       raw_payload = excluded.raw_payload`,
    p.externalId, p.sourceKind, p.source, p.alertType, p.severity, p.headline, p.body,
    p.locationText, p.latitude, p.longitude, p.reporterContact, p.occurredAt, raw);

  const row = await queryFirst<{ id: number; status: string }>(db,
    `SELECT id, status FROM safewatch_alerts WHERE source = ? AND external_id = ?`,
    p.source, p.externalId);
  return row?.id ?? 0;
}

// Fan out a live notification to on-duty dispatch staff. Bounded by LIMIT so
// the INSERT count can never grow with the user table, and wrapped by the
// caller so a notification failure never fails the ingest.
async function notifyDispatch(db: D1Database, alertId: number, p: SafewatchAlertPayload): Promise<number> {
  const recipients = await query<{ id: number }>(db,
    `SELECT id FROM users
     WHERE role IN ('dispatcher','supervisor','manager','admin')
       AND COALESCE(status, 'active') = 'active'
     LIMIT 50`);
  if (recipients.length === 0) return 0;

  const priority = p.severity === 'urgent' ? 'high' : 'normal';
  const where = p.locationText ? ` — ${p.locationText}` : '';
  const title = `SAFEWATCH ${p.severity.toUpperCase()}: ${p.headline}`;
  const message = `Unverified ${p.sourceKind === 'feed' ? `feed item (${p.source})` : 'community report'}${where}. `
    + `Review in the SafeWatch queue before acting.`;

  // One statement per recipient rather than a multi-row VALUES list: 8 bound
  // params x 50 recipients would blow D1's 100-bound-parameter cap.
  for (const r of recipients) {
    await execute(db,
      `INSERT INTO notifications (type, priority, title, message, entity_type, entity_id, user_id, is_read, created_at)
       VALUES ('safewatch_alert', ?, ?, ?, 'safewatch_alert', ?, ?, 0, datetime('now'))`,
      priority, title, message, alertId, r.id);
  }
  return recipients.length;
}

// ─── Ingest (public prefix, HMAC-gated) ──────────────────────
safewatchIngest.post('/', async (c) => {
  const secret = (c.env as Record<string, unknown>).SAFEWATCH_WEBHOOK_SECRET as string | undefined;
  if (!secret) return notConfigured(c, 'safewatch_webhook_secret_unset');

  const rawBody = await c.req.text();
  if (rawBody.length > MAX_BODY_BYTES) {
    return c.json({ ok: false, error: 'Payload too large' }, 413);
  }

  const header = c.req.header('x-rmpg-flex-hmac-sha256');
  if (!header) return c.json({ ok: false, error: 'Missing signature' }, 401);
  const expected = await hmacSha256Hex(secret, rawBody);
  if (!constantTimeEquals(header.toLowerCase(), expected.toLowerCase())) {
    return c.json({ ok: false, error: 'Invalid signature' }, 401);
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON' }, 400);
  }

  const parsed = parseSafewatchAlert(parsedBody);
  if (!parsed.ok) return c.json({ ok: false, error: parsed.error }, 400);

  const db = getDb(c.env);
  try {
    await ensureSafewatchTable(db);
    const id = await upsertAlert(db, parsed.payload, rawBody);

    let notified = 0;
    if (NOTIFY_SEVERITIES.has(parsed.payload.severity)) {
      // A notification failure must not fail the ingest — the alert is
      // already durably stored and visible in the triage queue.
      try {
        notified = await notifyDispatch(db, id, parsed.payload);
      } catch (err) {
        log.error('safewatch notify failed', { alertId: id },
          err instanceof Error ? err : new Error(String(err)));
      }
    }
    return c.json({ ok: true, alert_id: id, notified }, 201);
  } catch (err) {
    log.error('safewatch ingest failed',
      { externalId: parsed.payload.externalId, source: parsed.payload.source },
      err instanceof Error ? err : new Error(String(err)));
    return c.json({ ok: false, error: 'Internal error' }, 500);
  }
});

// ─── Triage (authenticated prefix) ───────────────────────────
safewatchTriage.get('/', async (c) => {
  const denied = requireRole(c, TRIAGE_READ);
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    await ensureSafewatchTable(db);
    const status = c.req.query('status');
    const sourceKind = c.req.query('source_kind');
    const conditions: string[] = ['1=1']; const params: unknown[] = [];
    if (status) { conditions.push('status = ?'); params.push(status); }
    if (sourceKind) { conditions.push('source_kind = ?'); params.push(sourceKind); }
    const rows = await query<Record<string, unknown>>(db,
      `SELECT id, external_id, source_kind, source, alert_type, severity, headline, body,
              location_text, latitude, longitude, reporter_contact, occurred_at, received_at,
              status, reviewed_by, reviewed_at, promoted_tip_id
       FROM safewatch_alerts WHERE ${conditions.join(' AND ')}
       ORDER BY received_at DESC LIMIT 500`, ...params);
    const stats = await queryFirst<Record<string, number>>(db, `
      SELECT
        SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) AS new_alerts,
        SUM(CASE WHEN status = 'reviewed' THEN 1 ELSE 0 END) AS reviewed,
        SUM(CASE WHEN status = 'promoted' THEN 1 ELSE 0 END) AS promoted,
        SUM(CASE WHEN status = 'dismissed' THEN 1 ELSE 0 END) AS dismissed
      FROM safewatch_alerts`);
    return c.json({
      data: rows,
      stats: {
        new_alerts: stats?.new_alerts ?? 0, reviewed: stats?.reviewed ?? 0,
        promoted: stats?.promoted ?? 0, dismissed: stats?.dismissed ?? 0,
      },
    });
  } catch (err) {
    log.error('GET / failed', { src: 'src/routes/safewatch.ts' }, err);
    return c.json({ error: 'Failed to list SafeWatch alerts' }, 500);
  }
});

// PATCH /:id — triage state only. 'promoted' is NOT settable here; it is
// set exclusively by the promote endpoint, so the flag can never claim a
// public_tips row that does not exist.
safewatchTriage.patch('/:id', async (c) => {
  const denied = requireRole(c, TRIAGE_WRITE);
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    await ensureSafewatchTable(db);
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isInteger(id)) return c.json({ error: 'Invalid id' }, 400);
    const b = await c.req.json<Record<string, unknown>>();
    const status = typeof b.status === 'string' ? b.status : null;
    if (!status || !['new', 'reviewed', 'dismissed'].includes(status)) {
      return c.json({ error: "status must be one of: new, reviewed, dismissed" }, 400);
    }
    const user = c.get('user');
    await execute(db,
      `UPDATE safewatch_alerts SET status = ?, reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?`,
      status, user?.id ?? null, id);
    const updated = await queryFirst<Record<string, unknown>>(db,
      'SELECT * FROM safewatch_alerts WHERE id = ?', id);
    if (!updated) return c.json({ error: 'Not found' }, 404);
    return c.json({ data: updated });
  } catch (err) {
    log.error('PATCH /:id failed', { src: 'src/routes/safewatch.ts' }, err);
    return c.json({ error: 'Failed to update SafeWatch alert' }, 500);
  }
});

// POST /:id/promote — the deliberate human act that moves untrusted
// SafeWatch content into an RMPG record. Creates a public_tips row (NOT a
// call for service): a resident report still has to be worked like any
// other tip before it becomes dispatchable.
safewatchTriage.post('/:id/promote', async (c) => {
  const denied = requireRole(c, TRIAGE_WRITE);
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    await ensureSafewatchTable(db);
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isInteger(id)) return c.json({ error: 'Invalid id' }, 400);

    const alert = await queryFirst<{
      id: number; headline: string; body: string | null; location_text: string | null;
      severity: string; source_kind: string; source: string; alert_type: string | null;
      status: string; promoted_tip_id: number | null;
    }>(db, 'SELECT * FROM safewatch_alerts WHERE id = ?', id);
    if (!alert) return c.json({ error: 'Not found' }, 404);
    if (alert.promoted_tip_id) {
      // Already promoted — return the existing tip rather than creating a
      // second one from a double-click.
      return c.json({ data: alert, tip_id: alert.promoted_tip_id, created: false });
    }

    const yy = String(new Date().getFullYear()).slice(-2);
    const prefix = `TIP-${yy}-`;
    const last = await queryFirst<{ tip_number: string }>(db,
      'SELECT tip_number FROM public_tips WHERE tip_number LIKE ? ORDER BY id DESC LIMIT 1', `${prefix}%`);
    let next = 1;
    if (last?.tip_number) {
      const m = last.tip_number.match(/^TIP-\d{2}-(\d+)$/);
      if (m) next = parseInt(m[1], 10) + 1;
    }
    const tipNumber = `${prefix}${String(next).padStart(4, '0')}`;

    const tipText = [alert.headline, alert.body].filter(Boolean).join('\n\n')
      + `\n\n[Promoted from SafeWatch ${alert.source_kind} alert #${alert.id}, source: ${alert.source}]`;
    const priority = alert.severity === 'urgent' ? 'high' : 'normal';

    const inserted = await execute(db,
      `INSERT INTO public_tips (tip_number, is_anonymous, tip_text, category, location, priority)
       VALUES (?, 1, ?, ?, ?, ?)`,
      tipNumber, tipText, alert.alert_type, alert.location_text, priority);
    const tipId = Number(inserted.meta.last_row_id);

    const user = c.get('user');
    await execute(db,
      `UPDATE safewatch_alerts
       SET status = 'promoted', promoted_tip_id = ?, reviewed_by = ?, reviewed_at = datetime('now')
       WHERE id = ?`, tipId, user?.id ?? null, id);

    const updated = await queryFirst<Record<string, unknown>>(db,
      'SELECT * FROM safewatch_alerts WHERE id = ?', id);
    return c.json({ data: updated, tip_id: tipId, tip_number: tipNumber, created: true }, 201);
  } catch (err) {
    log.error('POST /:id/promote failed', { src: 'src/routes/safewatch.ts' }, err);
    return c.json({ error: 'Failed to promote SafeWatch alert' }, 500);
  }
});

export { safewatchTriage };
export default safewatchIngest;

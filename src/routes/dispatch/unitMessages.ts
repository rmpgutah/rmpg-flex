// ============================================================
// Dispatch — Unit Message Log
// POST /api/dispatch/units/:id/messages  — log a dispatcher→unit msg
// GET  /api/dispatch/units/:id/messages  — retrieve thread
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../../types';
import { getDb, query, execute } from '../../utils/db';
import { log } from '../../utils/logger';
import { requireRole } from '../../middleware/auth';

const unitMessages = new Hono<Env>();

async function reconcile(db: import('@cloudflare/workers-types').D1Database) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS unit_messages (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    unit_id      INTEGER NOT NULL,
    call_id      INTEGER,
    direction    TEXT    NOT NULL DEFAULT 'dispatch',
    message_text TEXT    NOT NULL,
    sent_by      INTEGER,
    sent_at      TEXT    NOT NULL DEFAULT (datetime('now'))
  )`).run();
  // Index for fast thread retrieval
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_unit_messages_unit_sent
    ON unit_messages (unit_id, sent_at)`).run();
}

// POST /api/dispatch/units/:id/messages
unitMessages.post('/:id/messages',
  requireRole('officer', 'dispatcher', 'supervisor', 'manager', 'admin'),
  async (c) => {
  const db = getDb(c.env);
  await reconcile(db);

  const unitId = Number(c.req.param('id'));
  if (!unitId) return c.json({ ok: false, error: 'invalid unit id' }, 400);

  let body: { message_text?: string; call_id?: number; direction?: string };
  try { body = await c.req.json(); } catch { return c.json({ ok: false, error: 'invalid JSON' }, 400); }

  const { message_text, call_id, direction = 'dispatch' } = body;
  if (!message_text?.trim()) return c.json({ ok: false, error: 'message_text is required' }, 400);
  if (!['dispatch', 'unit'].includes(direction)) {
    return c.json({ ok: false, error: 'direction must be dispatch or unit' }, 400);
  }

  const sentBy = c.get('userId') as number | undefined;
  const res = await execute(db,
    `INSERT INTO unit_messages (unit_id, call_id, direction, message_text, sent_by)
     VALUES (?, ?, ?, ?, ?)`,
    unitId, call_id ?? null, direction, message_text.trim(), sentBy ?? null);

  log.info('[unit-messages] logged message', { unit_id: unitId, id: res.meta.last_row_id });
  return c.json({ ok: true, id: res.meta.last_row_id });
});

// GET /api/dispatch/units/:id/messages?call_id=&limit=50
unitMessages.get('/:id/messages',
  requireRole('officer', 'dispatcher', 'supervisor', 'manager', 'admin'),
  async (c) => {
  const db = getDb(c.env);
  await reconcile(db);

  const unitId = Number(c.req.param('id'));
  if (!unitId) return c.json({ ok: false, error: 'invalid unit id' }, 400);

  const callIdRaw = c.req.query('call_id');
  const callId = callIdRaw ? Number(callIdRaw) : null;
  const limit = Math.min(Number(c.req.query('limit') ?? '50'), 200);

  let rows: Record<string, unknown>[];
  if (callId) {
    rows = await query<Record<string, unknown>>(db,
      `SELECT um.*, u.full_name AS sender_name, u.call_sign AS sender_call_sign
         FROM unit_messages um
         LEFT JOIN users u ON u.id = um.sent_by
         WHERE um.unit_id = ? AND um.call_id = ?
         ORDER BY um.sent_at DESC
         LIMIT ?`,
      unitId, callId, limit);
  } else {
    rows = await query<Record<string, unknown>>(db,
      `SELECT um.*, u.full_name AS sender_name, u.call_sign AS sender_call_sign
         FROM unit_messages um
         LEFT JOIN users u ON u.id = um.sent_by
         WHERE um.unit_id = ?
         ORDER BY um.sent_at DESC
         LIMIT ?`,
      unitId, limit);
  }

  return c.json({ ok: true, messages: rows.reverse() });
});

export default unitMessages;

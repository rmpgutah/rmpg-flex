// ============================================================
// MDT link — phone ↔ in-vehicle desktop MDT message channel.
// ============================================================
// Generalizes the dl_scan_relay pattern into a typed, bidirectional,
// per-officer message bus. Both ends POLL (the live /api/ws is on the legacy
// worker and rewrite broadcasts are dead — polling is the reliable channel).
//
//   POST /api/mdt/send    {to:'mdt'|'phone', type, payload}   queue a message
//   GET  /api/mdt/inbox?endpoint=phone|mdt   pull+consume my messages, report link
//   GET  /api/mdt/status?endpoint=phone|mdt  is my counterpart online?
//
// Messages auto-expire (consumed, or older than 1h). Presence is a last-poll
// timestamp per (user, endpoint); the counterpart is "online" if it polled
// within MDT_ONLINE_WINDOW_SECONDS.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute, executeInChunks } from '../utils/db';
import {
  validateMdtSend, counterpartEndpoint, inboxDirectionFor, normalizeEndpoint,
  MDT_ONLINE_WINDOW_SECONDS,
} from '../utils/mdtMessage';

const mdt = new Hono<Env>();

// Module-level flag — D1 DDL runs at most once per isolate cold-start, not
// on every 8-second poll (Workers reuse isolates across requests; the tables
// are verified live in D1 and don't need re-checking after the first call).
let tablesReady = false;

async function ensureTables(db: ReturnType<typeof getDb>) {
  if (tablesReady) return;
  await execute(db, `CREATE TABLE IF NOT EXISTS mdt_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    direction TEXT NOT NULL,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    unit_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    consumed_at TEXT
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS mdt_presence (
    user_id INTEGER NOT NULL,
    endpoint TEXT NOT NULL,
    last_seen TEXT NOT NULL,
    PRIMARY KEY (user_id, endpoint)
  )`);
  tablesReady = true;
}

// Seconds since a presence row's last_seen, computed in SQLite (UTC-safe).
async function counterpartOnline(db: ReturnType<typeof getDb>, userId: number, endpoint: string): Promise<boolean> {
  const other = counterpartEndpoint(endpoint);
  const row = await queryFirst<{ age: number }>(db,
    `SELECT (strftime('%s','now') - strftime('%s', last_seen)) AS age
       FROM mdt_presence WHERE user_id = ? AND endpoint = ?`, userId, other);
  return row != null && Number(row.age) < MDT_ONLINE_WINDOW_SECONDS;
}

// POST /send — queue a message for the other end.
mdt.post('/send', async (c) => {
  const userId = c.get('userId') as number;
  const v = validateMdtSend(await c.req.json().catch(() => ({})));
  if (!v.ok) return c.json({ error: v.error, code: 'MDT_BAD_SEND' }, 400);
  const db = getDb(c.env);
  await ensureTables(db);
  // Bound the table — drop consumed + anything older than an hour.
  await execute(db, `DELETE FROM mdt_messages WHERE consumed_at IS NOT NULL OR created_at < datetime('now','-1 hour')`);
  const r = await execute(db,
    `INSERT INTO mdt_messages (user_id, direction, type, payload) VALUES (?, ?, ?, ?)`,
    userId, v.value.direction, v.value.type, JSON.stringify(v.value.payload));
  return c.json({ success: true, id: r.meta.last_row_id }, 201);
});

// GET /inbox — pull + consume my pending messages, refresh my presence, and
// report whether my counterpart is online.
mdt.get('/inbox', async (c) => {
  const userId = c.get('userId') as number;
  const endpoint = normalizeEndpoint(c.req.query('endpoint'));
  const db = getDb(c.env);
  await ensureTables(db);

  // Record this poll as my presence. INSERT OR REPLACE is atomic on the
  // composite primary key — a separate DELETE+INSERT here raced under Worker
  // cold-start latency (an overlapping poll could pass the DELETE and then
  // collide on the INSERT, throwing a PK constraint error → 500).
  await execute(db, `INSERT OR REPLACE INTO mdt_presence (user_id, endpoint, last_seen) VALUES (?, ?, datetime('now'))`, userId, endpoint);

  const dir = inboxDirectionFor(endpoint);
  const rows = await query<{ id: number; type: string; payload: string; created_at: string }>(db,
    `SELECT id, type, payload, created_at FROM mdt_messages
      WHERE user_id = ? AND direction = ? AND consumed_at IS NULL
      ORDER BY id ASC LIMIT 50`, userId, dir);
  if (rows.length) {
    const ids = rows.map((r) => r.id);
    await executeInChunks(db, ids,
      (ph) => `UPDATE mdt_messages SET consumed_at = datetime('now') WHERE id IN (${ph})`);
  }

  const messages = rows.map((r) => ({
    id: r.id, type: r.type, created_at: r.created_at,
    payload: ((): unknown => { try { return JSON.parse(r.payload); } catch { return {}; } })(),
  }));
  return c.json({ messages, counterpart_online: await counterpartOnline(db, userId, endpoint) });
});

// GET /status — link status without consuming messages.
mdt.get('/status', async (c) => {
  const userId = c.get('userId') as number;
  const endpoint = normalizeEndpoint(c.req.query('endpoint'));
  const db = getDb(c.env);
  await ensureTables(db);
  return c.json({
    endpoint,
    counterpart: counterpartEndpoint(endpoint),
    counterpart_online: await counterpartOnline(db, userId, endpoint),
  });
});

export default mdt;

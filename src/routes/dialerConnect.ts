// ============================================================
// Dial Connect — recordings, transcripts, voicemail, call history
// Mounted at /api/dialer-connect (auth required) plus
// /api/dialer-connect/ingest (public, HMAC via DIAL_CONNECT_WEBHOOK_SECRET).
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute, executeInChunks, columnExists } from '../utils/db';
import { putEncrypted, getDecrypted, FileEncryptionError } from '../utils/encryptedR2';
import { requireRole } from '../middleware/auth';
import { containsAnyClause } from '../utils/searchText';
import { log } from '../utils/logger';
import {
  normalizeDialNumber,
  last10Digits,
  classifyVmUrgency,
  isPresenceStatus,
  isCallDirection,
  isCallStatus,
  isVmUrgency,
  parseTagList,
  serializeTags,
  callsToCsv,
  voicemailsToCsv,
  timingSafeEqual,
  DISPOSITIONS,
  assertMinFunctions,
  isAllowedRecordingSourceUrl,
} from '../utils/dialerConnect';

const operational = requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher');

const dialerConnect = new Hono<Env>();
export const dialerConnectIngest = new Hono<Env>();

const CALLS_DDL = `CREATE TABLE IF NOT EXISTS dialer_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_sid TEXT, direction TEXT NOT NULL DEFAULT 'outbound',
  from_number TEXT, to_number TEXT, from_name TEXT, to_name TEXT,
  agent_user_id INTEGER, agent_name TEXT,
  status TEXT NOT NULL DEFAULT 'completed',
  started_at TEXT, ended_at TEXT, duration_seconds INTEGER,
  disposition TEXT, notes TEXT, tags TEXT, starred INTEGER NOT NULL DEFAULT 0,
  call_id INTEGER, person_id INTEGER,
  recording_r2_key TEXT, recording_content_type TEXT, recording_bytes INTEGER,
  recording_source_url TEXT, transcript TEXT, transcript_confidence REAL,
  transcript_status TEXT DEFAULT 'none', callback_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
)`;

const VM_DDL = `CREATE TABLE IF NOT EXISTS dialer_voicemails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_sid TEXT, from_number TEXT, from_name TEXT, to_number TEXT, mailbox TEXT,
  duration_seconds INTEGER, recording_r2_key TEXT, recording_content_type TEXT,
  recording_bytes INTEGER, recording_source_url TEXT, transcript TEXT,
  transcript_status TEXT DEFAULT 'none', urgency TEXT NOT NULL DEFAULT 'normal',
  is_read INTEGER NOT NULL DEFAULT 0, starred INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0, assigned_user_id INTEGER, assigned_name TEXT,
  call_id INTEGER, person_id INTEGER, notes TEXT, heard_at TEXT, received_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
)`;

let _schemaReady = false;
async function ensureSchema(db: ReturnType<typeof getDb>): Promise<void> {
  if (_schemaReady) return;
  await execute(db, CALLS_DDL);
  await execute(db, VM_DDL);
  await execute(db, `CREATE TABLE IF NOT EXISTS dialer_speed_dials (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
    label TEXT NOT NULL, number TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS dialer_presence (
    user_id INTEGER PRIMARY KEY, status TEXT NOT NULL DEFAULT 'available',
    message TEXT, updated_at TEXT DEFAULT (datetime('now'))
  )`);
  await execute(db, `CREATE UNIQUE INDEX IF NOT EXISTS idx_dialer_calls_sid
    ON dialer_calls(call_sid) WHERE call_sid IS NOT NULL AND TRIM(call_sid) != ''`);
  await execute(db, `CREATE INDEX IF NOT EXISTS idx_dialer_calls_started ON dialer_calls(started_at)`);
  await execute(db, `CREATE INDEX IF NOT EXISTS idx_dialer_vm_received ON dialer_voicemails(received_at)`);
  _schemaReady = true;
}

const CALL_EXTRAS: Array<[string, string]> = [
  ['recording_source_url', 'TEXT'], ['callback_at', 'TEXT'], ['person_id', 'INTEGER'],
];
async function reconcileCallCols(db: ReturnType<typeof getDb>) {
  for (const [col, typ] of CALL_EXTRAS) {
    if (!(await columnExists(db, 'dialer_calls', col))) {
      await execute(db, `ALTER TABLE dialer_calls ADD COLUMN ${col} ${typ}`);
    }
  }
}

type Actor = { id: number; username: string; role: string; full_name: string };

function actorOf(c: { get: (k: 'user') => Actor | undefined }): Actor | null {
  return c.get('user') ?? null;
}

interface IngestCall {
  callSid?: string; call_sid?: string;
  direction?: string;
  from?: string; from_number?: string;
  to?: string; to_number?: string;
  fromName?: string; from_name?: string;
  toName?: string; to_name?: string;
  status?: string;
  startedAt?: string; started_at?: string;
  endedAt?: string; ended_at?: string;
  durationSeconds?: number; duration_seconds?: number;
  transcript?: string;
  recordingUrl?: string; recording_url?: string;
  agentName?: string; agent_name?: string;
}

function ingestFields(body: IngestCall) {
  const callSid = String(body.callSid || body.call_sid || '').trim() || null;
  const direction = isCallDirection(body.direction) ? body.direction : 'inbound';
  const status = isCallStatus(body.status) ? body.status : 'completed';
  const fromNumber = normalizeDialNumber(body.from || body.from_number);
  const toNumber = normalizeDialNumber(body.to || body.to_number);
  return {
    callSid,
    direction,
    status,
    fromNumber: fromNumber || null,
    toNumber: toNumber || null,
    fromName: body.fromName || body.from_name || null,
    toName: body.toName || body.to_name || null,
    startedAt: body.startedAt || body.started_at || null,
    endedAt: body.endedAt || body.ended_at || null,
    duration: Number.isFinite(Number(body.durationSeconds ?? body.duration_seconds))
      ? Number(body.durationSeconds ?? body.duration_seconds) : null,
    transcript: body.transcript ? String(body.transcript) : null,
    recordingUrl: body.recordingUrl || body.recording_url || null,
    agentName: body.agentName || body.agent_name || null,
  };
}

async function upsertCall(
  db: ReturnType<typeof getDb>,
  body: IngestCall,
  agent?: { id: number; name: string } | null,
) {
  const f = ingestFields(body);
  const transcriptStatus = f.transcript ? 'ready' : 'none';
  if (f.callSid) {
    const existing = await queryFirst<{ id: number }>(db, 'SELECT id FROM dialer_calls WHERE call_sid = ?', f.callSid);
    if (existing) {
      await execute(db, `UPDATE dialer_calls SET
        direction=COALESCE(?, direction), status=?, from_number=COALESCE(?, from_number),
        to_number=COALESCE(?, to_number), from_name=COALESCE(?, from_name),
        to_name=COALESCE(?, to_name), started_at=COALESCE(?, started_at),
        ended_at=COALESCE(?, ended_at), duration_seconds=COALESCE(?, duration_seconds),
        transcript=COALESCE(?, transcript),
        transcript_status=CASE WHEN ? IS NOT NULL THEN 'ready' ELSE transcript_status END,
        recording_source_url=COALESCE(?, recording_source_url),
        agent_name=COALESCE(?, agent_name),
        agent_user_id=COALESCE(?, agent_user_id),
        updated_at=datetime('now')
        WHERE id=?`,
        f.direction, f.status, f.fromNumber, f.toNumber, f.fromName, f.toName,
        f.startedAt, f.endedAt, f.duration, f.transcript, f.transcript,
        f.recordingUrl, f.agentName ?? agent?.name ?? null, agent?.id ?? null,
        existing.id,
      );
      return existing.id;
    }
  }
  const res = await execute(db, `INSERT INTO dialer_calls (
    call_sid, direction, from_number, to_number, from_name, to_name,
    agent_user_id, agent_name, status, started_at, ended_at, duration_seconds,
    recording_source_url, transcript, transcript_status
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    f.callSid, f.direction, f.fromNumber, f.toNumber, f.fromName, f.toName,
    agent?.id ?? null, f.agentName ?? agent?.name ?? null, f.status,
    f.startedAt ?? new Date().toISOString(), f.endedAt, f.duration,
    f.recordingUrl, f.transcript, transcriptStatus,
  );
  return Number(res.meta.last_row_id);
}

async function insertVoicemail(db: ReturnType<typeof getDb>, body: IngestCall & {
  mailbox?: string; urgency?: string; notes?: string;
}) {
  const f = ingestFields(body);
  const urgency = isVmUrgency(body.urgency) ? body.urgency : classifyVmUrgency(f.transcript);
  const res = await execute(db, `INSERT INTO dialer_voicemails (
    call_sid, from_number, from_name, to_number, mailbox, duration_seconds,
    recording_source_url, transcript, transcript_status, urgency, received_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    f.callSid, f.fromNumber, f.fromName, f.toNumber, body.mailbox ?? null, f.duration,
    f.recordingUrl, f.transcript, f.transcript ? 'ready' : 'none', urgency,
    f.startedAt ?? new Date().toISOString(),
  );
  return Number(res.meta.last_row_id);
}

function verifyIngestSecret(c: { env: Env['Bindings']; req: { header: (n: string) => string | undefined } }): boolean {
  const secret = c.env.DIAL_CONNECT_WEBHOOK_SECRET;
  if (!secret) return false;
  const header = c.req.header('Authorization') || c.req.header('X-Dial-Connect-Secret') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : header.replace(/^Token\s+/i, '');
  return timingSafeEqual(token, secret);
}

dialerConnectIngest.post('/', async (c) => {
  if (!verifyIngestSecret(c)) return c.json({ error: 'Unauthorized' }, 401);
  const db = getDb(c.env);
  await ensureSchema(db);
  await reconcileCallCols(db);
  try {
    const body = await c.req.json<IngestCall & { type?: string }>();
    const type = body.type || 'call';
    if (type === 'voicemail') {
      const id = await insertVoicemail(db, body);
      return c.json({ ok: true, id, kind: 'voicemail' }, 201);
    }
    const id = await upsertCall(db, body);
    if (body.status === 'voicemail' || type === 'call_and_voicemail') {
      await insertVoicemail(db, body);
    }
    return c.json({ ok: true, id, kind: 'call' }, 201);
  } catch (err) {
    log.error('dialer-connect ingest failed', {}, err as Error);
    return c.json({ error: 'Ingest failed' }, 500);
  }
});

dialerConnect.use('*', operational);

dialerConnect.get('/functions', (c) => {
  return c.json(assertMinFunctions());
});

dialerConnect.post('/events', async (c) => {
  const db = getDb(c.env);
  await ensureSchema(db);
  const user = actorOf(c);
  const body = await c.req.json<IngestCall & { type?: string }>();
  const type = body.type || 'call_status';
  const agent = user ? { id: user.id, name: user.full_name || user.username } : null;
  if (type === 'voicemail' || type === 'voicemail_ready') {
    const id = await insertVoicemail(db, body);
    return c.json({ ok: true, id, kind: 'voicemail' }, 201);
  }
  const id = await upsertCall(db, body, agent);
  return c.json({ ok: true, id, kind: 'call' }, 201);
});

dialerConnect.get('/calls', async (c) => {
  const db = getDb(c.env);
  await ensureSchema(db);
  const q = (c.req.query('q') || '').trim();
  const direction = c.req.query('direction') || '';
  const status = c.req.query('status') || '';
  const missed = c.req.query('missed') === '1';
  const from = c.req.query('from') || '';
  const to = c.req.query('to') || '';
  const starred = c.req.query('starred') === '1';
  const limit = Math.min(500, Math.max(1, Number(c.req.query('limit')) || 200));

  const where: string[] = ['1=1'];
  const binds: unknown[] = [];
  if (isCallDirection(direction)) { where.push('direction = ?'); binds.push(direction); }
  if (isCallStatus(status)) { where.push('status = ?'); binds.push(status); }
  if (missed) { where.push("status IN ('missed','failed','busy')"); }
  if (starred) { where.push('starred = 1'); }
  if (from) { where.push('started_at >= ?'); binds.push(from); }
  if (to) { where.push('started_at <= ?'); binds.push(to.includes(' ') ? to : `${to} 23:59:59`); }
  if (q) {
    const digits = last10Digits(q);
    const text = containsAnyClause(['from_name', 'to_name', 'agent_name', 'notes', 'transcript', 'from_number', 'to_number']);
    if (digits.length >= 4) {
      where.push(`(${text.sql} OR instr(replace(ifnull(from_number,''),'+',''), ?) > 0 OR instr(replace(ifnull(to_number,''),'+',''), ?) > 0)`);
      binds.push(...text.binds(q), digits, digits);
    } else {
      where.push(text.sql);
      binds.push(...text.binds(q));
    }
  }

  const rows = await query(db,
    `SELECT * FROM dialer_calls WHERE ${where.join(' AND ')} ORDER BY datetime(COALESCE(started_at, created_at)) DESC LIMIT ?`,
    ...binds, limit,
  );
  return c.json({ data: rows });
});

dialerConnect.get('/calls/summary', async (c) => {
  const db = getDb(c.env);
  await ensureSchema(db);
  const from = c.req.query('from') || '';
  const to = c.req.query('to') || '';
  const extra: string[] = [];
  const binds: unknown[] = [];
  if (from) { extra.push('AND started_at >= ?'); binds.push(from); }
  if (to) { extra.push('AND started_at <= ?'); binds.push(to.includes(' ') ? to : `${to} 23:59:59`); }
  const row = await queryFirst<{
    total: number; inbound: number; outbound: number; missed: number; recorded: number;
    avg_duration: number | null;
  }>(db, `SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN direction='inbound' THEN 1 ELSE 0 END) AS inbound,
      SUM(CASE WHEN direction='outbound' THEN 1 ELSE 0 END) AS outbound,
      SUM(CASE WHEN status IN ('missed','failed','busy') THEN 1 ELSE 0 END) AS missed,
      SUM(CASE WHEN recording_r2_key IS NOT NULL OR recording_source_url IS NOT NULL THEN 1 ELSE 0 END) AS recorded,
      AVG(duration_seconds) AS avg_duration
    FROM dialer_calls WHERE 1=1 ${extra.join(' ')}`, ...binds);
  return c.json({ data: row });
});

dialerConnect.get('/calls/export.csv', async (c) => {
  const db = getDb(c.env);
  await ensureSchema(db);
  const q = (c.req.query('q') || '').trim();
  const direction = c.req.query('direction') || '';
  const missed = c.req.query('missed') === '1';
  const from = c.req.query('from') || '';
  const to = c.req.query('to') || '';
  const starred = c.req.query('starred') === '1';
  const where: string[] = ['1=1'];
  const binds: unknown[] = [];
  if (isCallDirection(direction)) { where.push('direction = ?'); binds.push(direction); }
  if (missed) { where.push("status IN ('missed','failed','busy')"); }
  if (starred) { where.push('starred = 1'); }
  if (from) { where.push('started_at >= ?'); binds.push(from); }
  if (to) { where.push('started_at <= ?'); binds.push(to.includes(' ') ? to : `${to} 23:59:59`); }
  if (q) {
    const digits = last10Digits(q);
    const text = containsAnyClause(['from_name', 'to_name', 'agent_name', 'notes', 'transcript', 'from_number', 'to_number']);
    if (digits.length >= 4) {
      where.push(`(${text.sql} OR instr(replace(ifnull(from_number,''),'+',''), ?) > 0 OR instr(replace(ifnull(to_number,''),'+',''), ?) > 0)`);
      binds.push(...text.binds(q), digits, digits);
    } else {
      where.push(text.sql);
      binds.push(...text.binds(q));
    }
  }
  const rows = await query<Record<string, unknown>>(db,
    `SELECT id, call_sid, direction, status, from_number, to_number, from_name, to_name,
            agent_name, started_at, ended_at, duration_seconds, disposition, starred, call_id, notes
     FROM dialer_calls WHERE ${where.join(' AND ')}
     ORDER BY datetime(COALESCE(started_at, created_at)) DESC LIMIT 2000`,
    ...binds);
  const csv = callsToCsv(rows);
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="dialer-call-history.csv"',
    },
  });
});

dialerConnect.get('/calls/:id', async (c) => {
  const db = getDb(c.env);
  await ensureSchema(db);
  const id = Number(c.req.param('id'));
  const row = await queryFirst(db, 'SELECT * FROM dialer_calls WHERE id = ?', id);
  if (!row) return c.json({ error: 'Not found' }, 404);
  return c.json({ data: row });
});

dialerConnect.post('/calls', async (c) => {
  const db = getDb(c.env);
  await ensureSchema(db);
  const user = actorOf(c);
  const body = await c.req.json<IngestCall>();
  const id = await upsertCall(db, body, user ? { id: user.id, name: user.full_name || user.username } : null);
  const row = await queryFirst(db, 'SELECT * FROM dialer_calls WHERE id = ?', id);
  return c.json({ data: row }, 201);
});

dialerConnect.patch('/calls/:id', async (c) => {
  const db = getDb(c.env);
  await ensureSchema(db);
  const id = Number(c.req.param('id'));
  const existing = await queryFirst<{ id: number; tags: string | null }>(db, 'SELECT id, tags FROM dialer_calls WHERE id = ?', id);
  if (!existing) return c.json({ error: 'Not found' }, 404);
  const body = await c.req.json<{
    notes?: string; disposition?: string; starred?: number | boolean;
    call_id?: number | null; person_id?: number | null; tags?: string[] | string;
    callback_at?: string | null; transcript?: string;
  }>();
  const tags = Array.isArray(body.tags) ? serializeTags(body.tags)
    : typeof body.tags === 'string' ? serializeTags(parseTagList(body.tags))
    : undefined;
  const starred = body.starred === undefined ? undefined : (body.starred ? 1 : 0);
  await execute(db, `UPDATE dialer_calls SET
    notes = COALESCE(?, notes),
    disposition = COALESCE(?, disposition),
    starred = COALESCE(?, starred),
    call_id = CASE WHEN ? IS NOT NULL THEN ? ELSE call_id END,
    person_id = CASE WHEN ? IS NOT NULL THEN ? ELSE person_id END,
    tags = COALESCE(?, tags),
    callback_at = COALESCE(?, callback_at),
    transcript = COALESCE(?, transcript),
    transcript_status = CASE WHEN ? IS NOT NULL THEN 'ready' ELSE transcript_status END,
    updated_at = datetime('now')
    WHERE id = ?`,
    body.notes ?? null,
    body.disposition && DISPOSITIONS.includes(body.disposition as typeof DISPOSITIONS[number]) ? body.disposition : null,
    starred ?? null,
    body.call_id === undefined ? null : 1, body.call_id ?? null,
    body.person_id === undefined ? null : 1, body.person_id ?? null,
    tags ?? null,
    body.callback_at ?? null,
    body.transcript ?? null,
    body.transcript ?? null,
    id,
  );
  const row = await queryFirst(db, 'SELECT * FROM dialer_calls WHERE id = ?', id);
  return c.json({ data: row });
});

dialerConnect.get('/voicemails', async (c) => {
  const db = getDb(c.env);
  await ensureSchema(db);
  const q = (c.req.query('q') || '').trim();
  const unread = c.req.query('unread') === '1';
  const starred = c.req.query('starred') === '1';
  const archived = c.req.query('archived') === '1';
  const urgency = c.req.query('urgency') || '';
  const limit = Math.min(500, Math.max(1, Number(c.req.query('limit')) || 200));
  const where: string[] = [archived ? 'archived = 1' : 'archived = 0'];
  const binds: unknown[] = [];
  if (unread) where.push('is_read = 0');
  if (starred) where.push('starred = 1');
  if (isVmUrgency(urgency)) { where.push('urgency = ?'); binds.push(urgency); }
  if (q) {
    const text = containsAnyClause(['from_name', 'from_number', 'transcript', 'notes', 'mailbox']);
    where.push(text.sql);
    binds.push(...text.binds(q));
  }
  const rows = await query(db,
    `SELECT * FROM dialer_voicemails WHERE ${where.join(' AND ')}
     ORDER BY datetime(COALESCE(received_at, created_at)) DESC LIMIT ?`,
    ...binds, limit,
  );
  return c.json({ data: rows });
});

dialerConnect.get('/voicemails/summary', async (c) => {
  const db = getDb(c.env);
  await ensureSchema(db);
  const row = await queryFirst<{ unread: number; total: number; urgent: number }>(db, `SELECT
      SUM(CASE WHEN is_read = 0 AND archived = 0 THEN 1 ELSE 0 END) AS unread,
      SUM(CASE WHEN archived = 0 THEN 1 ELSE 0 END) AS total,
      SUM(CASE WHEN archived = 0 AND urgency IN ('urgent','emergency') THEN 1 ELSE 0 END) AS urgent
    FROM dialer_voicemails`);
  return c.json({ data: row });
});

dialerConnect.get('/voicemails/export.csv', async (c) => {
  const db = getDb(c.env);
  await ensureSchema(db);
  const archived = c.req.query('archived') === '1';
  const rows = await query<Record<string, unknown>>(db,
    `SELECT id, call_sid, from_number, from_name, to_number, mailbox, duration_seconds,
            urgency, is_read, starred, archived, assigned_name, received_at, call_id, notes, transcript
     FROM dialer_voicemails WHERE archived = ?
     ORDER BY datetime(COALESCE(received_at, created_at)) DESC LIMIT 2000`,
    archived ? 1 : 0,
  );
  return new Response(voicemailsToCsv(rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="dialer-voicemail.csv"',
    },
  });
});

dialerConnect.post('/voicemails', async (c) => {
  const db = getDb(c.env);
  await ensureSchema(db);
  const body = await c.req.json<IngestCall & { mailbox?: string; urgency?: string }>();
  const id = await insertVoicemail(db, body);
  const row = await queryFirst(db, 'SELECT * FROM dialer_voicemails WHERE id = ?', id);
  return c.json({ data: row }, 201);
});

dialerConnect.patch('/voicemails/:id', async (c) => {
  const db = getDb(c.env);
  await ensureSchema(db);
  const id = Number(c.req.param('id'));
  const existing = await queryFirst(db, 'SELECT id FROM dialer_voicemails WHERE id = ?', id);
  if (!existing) return c.json({ error: 'Not found' }, 404);
  const body = await c.req.json<{
    is_read?: boolean | number; starred?: boolean | number; archived?: boolean | number;
    assigned_user_id?: number | null; assigned_name?: string | null;
    notes?: string; urgency?: string; call_id?: number | null; person_id?: number | null;
    transcript?: string;
  }>();
  const isRead = body.is_read === undefined ? undefined : (body.is_read ? 1 : 0);
  const heardAt = isRead === 1 ? new Date().toISOString() : null;
  await execute(db, `UPDATE dialer_voicemails SET
    is_read = COALESCE(?, is_read),
    heard_at = COALESCE(?, heard_at),
    starred = COALESCE(?, starred),
    archived = COALESCE(?, archived),
    assigned_user_id = COALESCE(?, assigned_user_id),
    assigned_name = COALESCE(?, assigned_name),
    notes = COALESCE(?, notes),
    urgency = COALESCE(?, urgency),
    call_id = COALESCE(?, call_id),
    person_id = COALESCE(?, person_id),
    transcript = COALESCE(?, transcript),
    transcript_status = CASE WHEN ? IS NOT NULL THEN 'ready' ELSE transcript_status END,
    updated_at = datetime('now')
    WHERE id = ?`,
    isRead ?? null, heardAt,
    body.starred === undefined ? null : (body.starred ? 1 : 0),
    body.archived === undefined ? null : (body.archived ? 1 : 0),
    body.assigned_user_id ?? null, body.assigned_name ?? null,
    body.notes ?? null,
    isVmUrgency(body.urgency) ? body.urgency : null,
    body.call_id ?? null, body.person_id ?? null,
    body.transcript ?? null, body.transcript ?? null,
    id,
  );
  const row = await queryFirst(db, 'SELECT * FROM dialer_voicemails WHERE id = ?', id);
  return c.json({ data: row });
});

dialerConnect.post('/voicemails/bulk-heard', async (c) => {
  const db = getDb(c.env);
  await ensureSchema(db);
  const body = await c.req.json<{ ids?: number[] }>();
  const ids = (body.ids || []).map(Number).filter((n) => Number.isFinite(n));
  if (ids.length === 0) return c.json({ updated: 0 });
  const updated = await executeInChunks(db, ids,
    (ph) => `UPDATE dialer_voicemails SET is_read=1, heard_at=datetime('now'), updated_at=datetime('now') WHERE id IN (${ph})`);
  return c.json({ updated });
});

dialerConnect.get('/speed-dials', async (c) => {
  const db = getDb(c.env);
  await ensureSchema(db);
  const user = actorOf(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  const rows = await query(db,
    'SELECT * FROM dialer_speed_dials WHERE user_id = ? ORDER BY sort_order ASC, id ASC', user.id);
  return c.json({ data: rows });
});

dialerConnect.post('/speed-dials', async (c) => {
  const db = getDb(c.env);
  await ensureSchema(db);
  const user = actorOf(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  const body = await c.req.json<{ label?: string; number?: string }>();
  const label = String(body.label || '').trim();
  const number = normalizeDialNumber(body.number || '');
  if (!label || !number) return c.json({ error: 'label and number required' }, 400);
  const res = await execute(db,
    'INSERT INTO dialer_speed_dials (user_id, label, number) VALUES (?,?,?)', user.id, label, number);
  const row = await queryFirst(db, 'SELECT * FROM dialer_speed_dials WHERE id = ?', res.meta.last_row_id);
  return c.json({ data: row }, 201);
});

dialerConnect.delete('/speed-dials/:id', async (c) => {
  const db = getDb(c.env);
  await ensureSchema(db);
  const user = actorOf(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  const id = Number(c.req.param('id'));
  await execute(db, 'DELETE FROM dialer_speed_dials WHERE id = ? AND user_id = ?', id, user.id);
  return c.json({ ok: true });
});

dialerConnect.get('/presence', async (c) => {
  const db = getDb(c.env);
  await ensureSchema(db);
  const rows = await query(db, `SELECT p.user_id, p.status, p.message, p.updated_at,
      u.full_name AS name FROM dialer_presence p
      LEFT JOIN users u ON u.id = p.user_id
      ORDER BY p.updated_at DESC LIMIT 100`);
  return c.json({ data: rows });
});

dialerConnect.put('/presence', async (c) => {
  const db = getDb(c.env);
  await ensureSchema(db);
  const user = actorOf(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  const body = await c.req.json<{ status?: string; message?: string }>();
  if (!isPresenceStatus(body.status)) return c.json({ error: 'Invalid presence' }, 400);
  await execute(db, `INSERT INTO dialer_presence (user_id, status, message, updated_at)
    VALUES (?,?,?,datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET status=excluded.status, message=excluded.message, updated_at=datetime('now')`,
    user.id, body.status, body.message ?? null);
  return c.json({ ok: true, status: body.status });
});

dialerConnect.get('/lookup', async (c) => {
  const db = getDb(c.env);
  const raw = c.req.query('number') || '';
  const digits = last10Digits(raw);
  if (digits.length < 7) return c.json({ data: [] });
  const rows = await query<{ id: number; first_name: string | null; last_name: string | null; phone: string | null }>(
    db,
    `SELECT id, first_name, last_name, phone FROM persons
     WHERE instr(replace(replace(replace(ifnull(phone,''),'-',''),' ',''),'+',''), ?) > 0
     LIMIT 8`,
    digits,
  );
  return c.json({ data: rows });
});

const AUDIO_MAX = 25 * 1024 * 1024;

async function storeAudio(
  c: { env: Env['Bindings'] },
  kind: 'call' | 'vm',
  id: number,
  file: File,
) {
  if (!c.env.UPLOADS) throw new Error('uploads_unavailable');
  if (file.size > AUDIO_MAX) throw new Error('too_large');
  const type = file.type || 'audio/mpeg';
  if (!type.startsWith('audio/') && type !== 'application/octet-stream') throw new Error('not_audio');
  const buf = new Uint8Array(await file.arrayBuffer());
  const key = `dialer-connect/${kind}/${id}/${Date.now()}`;
  const db = getDb(c.env);
  await putEncrypted(c.env.UPLOADS, db, c.env, key, buf, {
    httpMetadata: { contentType: type },
  });
  if (kind === 'call') {
    await execute(db, `UPDATE dialer_calls SET recording_r2_key=?, recording_content_type=?, recording_bytes=?, updated_at=datetime('now') WHERE id=?`,
      key, type, buf.byteLength, id);
  } else {
    await execute(db, `UPDATE dialer_voicemails SET recording_r2_key=?, recording_content_type=?, recording_bytes=?, updated_at=datetime('now') WHERE id=?`,
      key, type, buf.byteLength, id);
  }
  return key;
}

dialerConnect.post('/calls/:id/recording', async (c) => {
  const db = getDb(c.env);
  await ensureSchema(db);
  const id = Number(c.req.param('id'));
  const row = await queryFirst(db, 'SELECT id FROM dialer_calls WHERE id = ?', id);
  if (!row) return c.json({ error: 'Not found' }, 404);
  const form = await c.req.parseBody();
  const file = form.audio ?? form.file ?? form.recording;
  if (!(file instanceof File)) return c.json({ error: 'audio file required' }, 400);
  try {
    const key = await storeAudio(c, 'call', id, file);
    return c.json({ ok: true, key });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'upload_failed';
    if (msg === 'too_large') return c.json({ error: 'File too large', maxBytes: AUDIO_MAX }, 413);
    if (msg === 'not_audio') return c.json({ error: 'Not an audio file' }, 415);
    if (err instanceof FileEncryptionError) return c.json({ error: 'Encryption unavailable' }, 503);
    log.error('dialer recording upload failed', {}, err as Error);
    return c.json({ error: 'Upload failed' }, 500);
  }
});

dialerConnect.post('/voicemails/:id/recording', async (c) => {
  const db = getDb(c.env);
  await ensureSchema(db);
  const id = Number(c.req.param('id'));
  const row = await queryFirst(db, 'SELECT id FROM dialer_voicemails WHERE id = ?', id);
  if (!row) return c.json({ error: 'Not found' }, 404);
  const form = await c.req.parseBody();
  const file = form.audio ?? form.file ?? form.recording;
  if (!(file instanceof File)) return c.json({ error: 'audio file required' }, 400);
  try {
    const key = await storeAudio(c, 'vm', id, file);
    return c.json({ ok: true, key });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'upload_failed';
    if (msg === 'too_large') return c.json({ error: 'File too large', maxBytes: AUDIO_MAX }, 413);
    log.error('dialer vm upload failed', {}, err as Error);
    return c.json({ error: 'Upload failed' }, 500);
  }
});

async function serveAudio(
  c: { env: Env['Bindings']; json: (b: unknown, s?: 404 | 503) => Response },
  kind: 'call' | 'vm',
  id: number,
) {
  const db = getDb(c.env);
  const table = kind === 'call' ? 'dialer_calls' : 'dialer_voicemails';
  const row = await queryFirst<{
    recording_r2_key: string | null;
    recording_content_type: string | null;
    recording_source_url: string | null;
  }>(
    db, `SELECT recording_r2_key, recording_content_type, recording_source_url FROM ${table} WHERE id = ?`, id,
  );
  if (!row) return c.json({ error: 'Not found' }, 404);
  if (row.recording_r2_key) {
    if (!c.env.UPLOADS) return c.json({ error: 'Storage unavailable' }, 503);
    try {
      const decrypted = await getDecrypted(c.env.UPLOADS, db, c.env, row.recording_r2_key);
      if (!decrypted) return c.json({ error: 'Recording missing' }, 404);
      const bytes = decrypted.bytes;
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      return new Response(copy, {
        headers: {
          'Content-Type': row.recording_content_type || 'audio/mpeg',
          'Content-Disposition': `attachment; filename="dialer-${kind}-${id}.mp3"`,
          'Cache-Control': 'private, no-store',
        },
      });
    } catch (err) {
      if (err instanceof FileEncryptionError) return c.json({ error: 'Decrypt failed' }, 503);
      throw err;
    }
  }
  if (isAllowedRecordingSourceUrl(row.recording_source_url)) {
    try {
      const upstream = await fetch(row.recording_source_url!, { redirect: 'follow' });
      if (!upstream.ok) return c.json({ error: 'Recording unavailable' }, 404);
      const buf = await upstream.arrayBuffer();
      const type = row.recording_content_type
        || upstream.headers.get('content-type')
        || 'audio/mpeg';
      return new Response(buf, {
        headers: {
          'Content-Type': type,
          'Content-Disposition': `attachment; filename="dialer-${kind}-${id}.mp3"`,
          'Cache-Control': 'private, no-store',
        },
      });
    } catch (err) {
      log.error('dialer source-url audio proxy failed', { kind, id }, err as Error);
      return c.json({ error: 'Recording unavailable' }, 404);
    }
  }
  return c.json({ error: 'No recording' }, 404);
}

dialerConnect.get('/calls/:id/audio', async (c) => {
  await ensureSchema(getDb(c.env));
  return serveAudio(c, 'call', Number(c.req.param('id')));
});

dialerConnect.get('/voicemails/:id/audio', async (c) => {
  await ensureSchema(getDb(c.env));
  return serveAudio(c, 'vm', Number(c.req.param('id')));
});

export default dialerConnect;

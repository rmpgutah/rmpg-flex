// Dial Connect history import — copies every dispatch-app record (calls,
// voicemails, callbacks, contacts, SMS) into the /dialer-connect archive.
// Spec: docs/superpowers/specs/2026-09-14-dial-connect-history-import-design.md
//
// Idempotent: every row is keyed by dispatch_app_id (the dispatch-app primary
// key), so re-running updates in place. Recordings/voicemails get a
// recording_source_url pointing at dispatch-app's service-key-authenticated
// export, and the existing */30 mirror cron copies the bytes into encrypted R2.
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute, columnExists } from '../utils/db';
import { requireRole } from '../middleware/auth';
import { log } from '../utils/logger';
import { normalizeDialNumber, type CallStatus } from '../utils/dialerConnect';

const DEFAULT_BASE = 'https://rmpgutah.us/dialer';
const PAGE_LIMIT = 500;
const FETCH_TIMEOUT_MS = 20_000;

export interface ExportCall {
  id: string;
  twilioCallSid: string | null;
  direction: 'inbound' | 'outbound' | string;
  status: string;
  callerNumber: string;
  callerName: string | null;
  receivedAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  dispositionCode: string | null;
  notes: string | null;
  transcript: string | null;
  aiTranscript: string | null;
  aiSummary: string | null;
  incidentId: string | null;
  callerIdBlocked: boolean;
  ivrDigits: string | null;
  deletedAt: string | null;
  deleteReason: string | null;
  handledBy: { id: string; name: string | null; email: string | null } | null;
  recordingUrl: string | null;
  voicemailUrl: string | null;
}
export interface ExportCallback { id: string; phoneNumber: string; note: string | null; scheduledFor: string; incidentId: string | null; createdById: string; completed: boolean; createdAt: string }
export interface ExportContact { id: string; name: string; phoneNumber: string; isFavorite: boolean; ownerId: string; createdAt: string }
export interface ExportSmsMessage { id: string; conversationId: string; direction: string; body: string; twilioSid: string | null; status: string; createdAt: string }
export interface ExportSmsConversation { id: string; phoneNumber: string; updatedAt: string; createdAt: string; messages: ExportSmsMessage[] }
export interface ExportUser { id: string; name: string; email: string | null }
export interface ExportPage {
  exportedAt: string;
  calls: ExportCall[];
  callbacks: ExportCallback[];
  contacts: ExportContact[];
  smsConversations: ExportSmsConversation[];
  users: ExportUser[];
  nextCursor: string | null;
}

export interface ImportTally {
  calls: number; voicemails: number; callbacks: number; contacts: number;
  smsConversations: number; smsMessages: number;
  skipped: Array<{ entity: string; id: string; reason: string }>;
  pages: number;
}

/** dispatch-app CallStatus → Flex CallStatus. */
export function mapCallStatus(status: string, endedAt: string | null): CallStatus {
  switch (status) {
    case 'no_answer': return 'missed';
    case 'failed': return 'failed';
    case 'completed': return 'completed';
    case 'in_progress': return endedAt ? 'completed' : 'in_progress';
    case 'ringing': return endedAt ? 'missed' : 'ringing';
    default: return 'completed';
  }
}

/** Flex's D1 base is naive UTC "YYYY-MM-DD HH:MM:SS"; keep imported ISO instants as ISO (UTC). */
function iso(v: string | null | undefined): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function isDialConnectExportUrl(base: string, url: string | null | undefined): boolean {
  if (!url) return false;
  return url.startsWith(`${base.replace(/\/$/, '')}/api/export/audio/`);
}

let _schemaReady = false;
export async function ensureImportSchema(db: D1Database): Promise<void> {
  if (_schemaReady) return;
  for (const table of ['dialer_calls', 'dialer_voicemails'] as const) {
    if (!(await columnExists(db, table, 'dispatch_app_id'))) {
      await execute(db, `ALTER TABLE ${table} ADD COLUMN dispatch_app_id TEXT`);
    }
    await execute(db, `CREATE UNIQUE INDEX IF NOT EXISTS idx_${table}_dispatch_app_id ON ${table}(dispatch_app_id) WHERE dispatch_app_id IS NOT NULL`);
  }
  await execute(db, `CREATE TABLE IF NOT EXISTS dialer_callbacks (
    id INTEGER PRIMARY KEY AUTOINCREMENT, dispatch_app_id TEXT UNIQUE, phone_number TEXT NOT NULL, note TEXT,
    scheduled_for TEXT NOT NULL, completed INTEGER NOT NULL DEFAULT 0, created_by_name TEXT, incident_ref TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  await execute(db, `CREATE TABLE IF NOT EXISTS dialer_contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, dispatch_app_id TEXT UNIQUE, name TEXT NOT NULL, phone_number TEXT NOT NULL,
    is_favorite INTEGER NOT NULL DEFAULT 0, owner_name TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  await execute(db, `CREATE TABLE IF NOT EXISTS dialer_sms_conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, dispatch_app_id TEXT UNIQUE, phone_number TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')), created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  await execute(db, `CREATE TABLE IF NOT EXISTS dialer_sms_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, dispatch_app_id TEXT UNIQUE,
    conversation_id INTEGER NOT NULL REFERENCES dialer_sms_conversations(id) ON DELETE CASCADE,
    direction TEXT NOT NULL, body TEXT NOT NULL, twilio_sid TEXT, status TEXT, sent_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  _schemaReady = true;
}

async function fetchPage(base: string, key: string, cursor: string | null): Promise<ExportPage> {
  const url = new URL(`${base.replace(/\/$/, '')}/api/export/history`);
  url.searchParams.set('limit', String(PAGE_LIMIT));
  if (cursor) url.searchParams.set('cursor', cursor);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), { headers: { 'x-rmpg-service-key': key, accept: 'application/json' }, signal: ctrl.signal });
    if (res.status === 401 || res.status === 403) throw Object.assign(new Error('Dial Connect rejected the service key'), { code: 'dialer_forbidden' });
    if (!res.ok) throw Object.assign(new Error(`Dial Connect export HTTP ${res.status}`), { code: 'dialer_unreachable' });
    return await res.json() as ExportPage;
  } catch (err) {
    if ((err as { code?: string }).code) throw err;
    throw Object.assign(new Error('Dial Connect is unreachable'), { code: 'dialer_unreachable' });
  } finally {
    clearTimeout(timer);
  }
}

function tagsFor(call: ExportCall): string {
  const tags = ['dial-connect-import'];
  if (call.deletedAt) tags.push('dc-deleted');
  if (call.callerIdBlocked) tags.push('caller-id-blocked');
  return JSON.stringify(tags);
}

function notesFor(call: ExportCall): string | null {
  const parts: string[] = [];
  if (call.notes) parts.push(call.notes);
  if (call.aiSummary) parts.push(`AI summary: ${call.aiSummary}`);
  if (call.ivrDigits) parts.push(`IVR: ${call.ivrDigits}`);
  if (call.deletedAt) parts.push(`Deleted in Dial Connect ${call.deletedAt}${call.deleteReason ? ` — ${call.deleteReason}` : ''}`);
  return parts.length ? parts.join('\n') : null;
}

export async function importCall(db: D1Database, call: ExportCall): Promise<void> {
  const outbound = call.direction === 'outbound';
  const number = normalizeDialNumber(call.callerNumber) || call.callerNumber;
  const status = mapCallStatus(call.status, call.endedAt);
  const transcript = call.transcript ?? call.aiTranscript ?? null;
  const startedAt = iso(call.receivedAt) ?? new Date().toISOString();
  const endedAt = iso(call.endedAt);
  const agentName = call.handledBy?.name ?? null;
  const existing = await queryFirst<{ id: number }>(
    db, `SELECT id FROM dialer_calls WHERE dispatch_app_id = ? OR (call_sid IS NOT NULL AND call_sid = ?) LIMIT 1`,
    call.id, call.twilioCallSid ?? '',
  );
  if (existing) {
    // Preserve anything a Flex user has since edited (disposition/notes/tags/starred) — fill blanks only.
    await execute(db, `UPDATE dialer_calls SET
        dispatch_app_id = ?, call_sid = COALESCE(call_sid, ?), direction = ?, status = ?,
        from_number = COALESCE(from_number, ?), to_number = COALESCE(to_number, ?),
        from_name = COALESCE(from_name, ?), to_name = COALESCE(to_name, ?),
        agent_name = COALESCE(agent_name, ?), started_at = COALESCE(started_at, ?), ended_at = COALESCE(ended_at, ?),
        duration_seconds = COALESCE(duration_seconds, ?), disposition = COALESCE(disposition, ?),
        notes = COALESCE(notes, ?), transcript = COALESCE(transcript, ?),
        transcript_status = CASE WHEN transcript IS NULL AND ? IS NOT NULL THEN 'ready' ELSE transcript_status END,
        -- A row archived live by the bridge carries the bare Twilio URL, which the
        -- mirror can never fetch (Basic auth). Until the bytes are in R2, prefer the
        -- authenticated export URL so the cron can actually copy the recording.
        recording_source_url = CASE WHEN recording_r2_key IS NULL AND ? IS NOT NULL THEN ? ELSE COALESCE(recording_source_url, ?) END,
        tags = COALESCE(tags, ?), updated_at = datetime('now')
      WHERE id = ?`,
      call.id, call.twilioCallSid, outbound ? 'outbound' : 'inbound', status,
      outbound ? null : number, outbound ? number : null,
      outbound ? null : call.callerName, outbound ? call.callerName : null,
      agentName, startedAt, endedAt,
      call.durationSeconds, call.dispositionCode, notesFor(call), transcript, transcript,
      call.recordingUrl, call.recordingUrl, call.recordingUrl, tagsFor(call), existing.id,
    );
  } else {
    await execute(db, `INSERT INTO dialer_calls (
        dispatch_app_id, call_sid, direction, from_number, to_number, from_name, to_name, agent_name,
        status, started_at, ended_at, duration_seconds, disposition, notes, tags,
        recording_source_url, transcript, transcript_status
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      call.id, call.twilioCallSid, outbound ? 'outbound' : 'inbound',
      outbound ? null : number, outbound ? number : null,
      outbound ? null : call.callerName, outbound ? call.callerName : null, agentName,
      status, startedAt, endedAt, call.durationSeconds, call.dispositionCode, notesFor(call), tagsFor(call),
      call.recordingUrl, transcript, transcript ? 'ready' : 'none',
    );
  }
}

export async function importVoicemail(db: D1Database, call: ExportCall): Promise<boolean> {
  if (!call.voicemailUrl) return false;
  const number = normalizeDialNumber(call.callerNumber) || call.callerNumber;
  const receivedAt = iso(call.receivedAt) ?? new Date().toISOString();
  const existing = await queryFirst<{ id: number }>(db, 'SELECT id FROM dialer_voicemails WHERE dispatch_app_id = ?', call.id);
  if (existing) {
    await execute(db, `UPDATE dialer_voicemails SET
        call_sid = COALESCE(call_sid, ?), from_number = COALESCE(from_number, ?), from_name = COALESCE(from_name, ?),
        duration_seconds = COALESCE(duration_seconds, ?),
        recording_source_url = CASE WHEN recording_r2_key IS NULL THEN ? ELSE COALESCE(recording_source_url, ?) END,
        transcript = COALESCE(transcript, ?), notes = COALESCE(notes, ?), updated_at = datetime('now')
      WHERE id = ?`,
      call.twilioCallSid, number, call.callerName, call.durationSeconds, call.voicemailUrl, call.voicemailUrl,
      call.transcript ?? call.aiTranscript, notesFor(call), existing.id);
    return true;
  }
  await execute(db, `INSERT INTO dialer_voicemails (
      dispatch_app_id, call_sid, from_number, from_name, mailbox, duration_seconds,
      recording_source_url, transcript, transcript_status, urgency, is_read, received_at, notes
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    call.id, call.twilioCallSid, number, call.callerName, 'dial-connect', call.durationSeconds,
    call.voicemailUrl, call.transcript ?? call.aiTranscript, (call.transcript ?? call.aiTranscript) ? 'ready' : 'none',
    'normal', 1, receivedAt, notesFor(call));
  return true;
}

export async function importCallback(db: D1Database, cb: ExportCallback, users: Map<string, string>): Promise<void> {
  await execute(db, `INSERT INTO dialer_callbacks (dispatch_app_id, phone_number, note, scheduled_for, completed, created_by_name, incident_ref, created_at)
      VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(dispatch_app_id) DO UPDATE SET
        phone_number = excluded.phone_number, note = COALESCE(dialer_callbacks.note, excluded.note),
        scheduled_for = excluded.scheduled_for, completed = MAX(dialer_callbacks.completed, excluded.completed),
        created_by_name = COALESCE(dialer_callbacks.created_by_name, excluded.created_by_name), updated_at = datetime('now')`,
    cb.id, normalizeDialNumber(cb.phoneNumber) || cb.phoneNumber, cb.note, iso(cb.scheduledFor) ?? cb.scheduledFor,
    cb.completed ? 1 : 0, users.get(cb.createdById) ?? null, cb.incidentId, iso(cb.createdAt) ?? new Date().toISOString());
}

export async function importContact(db: D1Database, c: ExportContact, users: Map<string, string>): Promise<void> {
  await execute(db, `INSERT INTO dialer_contacts (dispatch_app_id, name, phone_number, is_favorite, owner_name, created_at)
      VALUES (?,?,?,?,?,?)
      ON CONFLICT(dispatch_app_id) DO UPDATE SET
        name = excluded.name, phone_number = excluded.phone_number, is_favorite = excluded.is_favorite,
        owner_name = COALESCE(dialer_contacts.owner_name, excluded.owner_name)`,
    c.id, c.name, normalizeDialNumber(c.phoneNumber) || c.phoneNumber, c.isFavorite ? 1 : 0,
    users.get(c.ownerId) ?? null, iso(c.createdAt) ?? new Date().toISOString());
}

export async function importSmsConversation(db: D1Database, conv: ExportSmsConversation): Promise<number> {
  await execute(db, `INSERT INTO dialer_sms_conversations (dispatch_app_id, phone_number, updated_at, created_at)
      VALUES (?,?,?,?)
      ON CONFLICT(dispatch_app_id) DO UPDATE SET phone_number = excluded.phone_number, updated_at = excluded.updated_at`,
    conv.id, normalizeDialNumber(conv.phoneNumber) || conv.phoneNumber,
    iso(conv.updatedAt) ?? new Date().toISOString(), iso(conv.createdAt) ?? new Date().toISOString());
  const row = await queryFirst<{ id: number }>(db, 'SELECT id FROM dialer_sms_conversations WHERE dispatch_app_id = ?', conv.id);
  const convId = Number(row?.id ?? 0);
  let count = 0;
  for (const m of conv.messages ?? []) {
    await execute(db, `INSERT INTO dialer_sms_messages (dispatch_app_id, conversation_id, direction, body, twilio_sid, status, sent_at)
        VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(dispatch_app_id) DO UPDATE SET status = excluded.status, twilio_sid = COALESCE(dialer_sms_messages.twilio_sid, excluded.twilio_sid)`,
      m.id, convId, m.direction, m.body, m.twilioSid, m.status, iso(m.createdAt) ?? new Date().toISOString());
    count += 1;
  }
  return count;
}

export async function runImport(env: Env['Bindings'], base: string, key: string): Promise<ImportTally> {
  const db = getDb(env);
  await ensureImportSchema(db);
  const tally: ImportTally = { calls: 0, voicemails: 0, callbacks: 0, contacts: 0, smsConversations: 0, smsMessages: 0, skipped: [], pages: 0 };
  const users = new Map<string, string>();
  let cursor: string | null = null;
  do {
    const page: ExportPage = await fetchPage(base, key, cursor);
    tally.pages += 1;
    for (const u of page.users ?? []) users.set(u.id, u.name);
    for (const call of page.calls ?? []) {
      try { await importCall(db, call); tally.calls += 1; }
      catch (err) { tally.skipped.push({ entity: 'call', id: call.id, reason: (err as Error).message }); continue; }
      try { if (await importVoicemail(db, call)) tally.voicemails += 1; }
      catch (err) { tally.skipped.push({ entity: 'voicemail', id: call.id, reason: (err as Error).message }); }
    }
    for (const cb of page.callbacks ?? []) {
      try { await importCallback(db, cb, users); tally.callbacks += 1; }
      catch (err) { tally.skipped.push({ entity: 'callback', id: cb.id, reason: (err as Error).message }); }
    }
    for (const c of page.contacts ?? []) {
      try { await importContact(db, c, users); tally.contacts += 1; }
      catch (err) { tally.skipped.push({ entity: 'contact', id: c.id, reason: (err as Error).message }); }
    }
    for (const conv of page.smsConversations ?? []) {
      try { tally.smsMessages += await importSmsConversation(db, conv); tally.smsConversations += 1; }
      catch (err) { tally.skipped.push({ entity: 'sms', id: conv.id, reason: (err as Error).message }); }
    }
    cursor = page.nextCursor;
  } while (cursor);
  log.info('[dialer-import] complete', { ...tally, skipped: tally.skipped.length });
  return tally;
}

const dialerConnectImport = new Hono<Env>();
dialerConnectImport.use('*', requireRole('admin', 'manager'));

dialerConnectImport.post('/dial-connect', async (c: Context<Env>) => {
  const key = c.env.DIAL_CONNECT_SERVICE_KEY;
  if (!key) return c.json({ ok: false, code: 'not_configured' }, 200);
  const base = c.env.DIAL_CONNECT_API_BASE || DEFAULT_BASE;
  try {
    const tally = await runImport(c.env, base, key);
    return c.json({ ok: true, ...tally });
  } catch (err) {
    const e = err as Error & { code?: string };
    log.error('[dialer-import] failed', {}, e);
    if (e.code === 'dialer_forbidden') return c.json({ error: e.message, code: e.code }, 403);
    return c.json({ error: e.message, code: e.code ?? 'dialer_unreachable' }, 503);
  }
});

dialerConnectImport.get('/dial-connect/status', async (c: Context<Env>) => {
  const db = getDb(c.env);
  await ensureImportSchema(db);
  const [calls, vms, pending] = await Promise.all([
    queryFirst<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM dialer_calls WHERE dispatch_app_id IS NOT NULL'),
    queryFirst<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM dialer_voicemails WHERE dispatch_app_id IS NOT NULL'),
    query<{ t: string; n: number }>(db, `SELECT 'call' AS t, COUNT(*) AS n FROM dialer_calls WHERE recording_source_url IS NOT NULL AND recording_r2_key IS NULL
      UNION ALL SELECT 'vm', COUNT(*) FROM dialer_voicemails WHERE recording_source_url IS NOT NULL AND recording_r2_key IS NULL`),
  ]);
  return c.json({
    importedCalls: Number(calls?.n ?? 0),
    importedVoicemails: Number(vms?.n ?? 0),
    copiesPending: Object.fromEntries(pending.map((r) => [r.t, Number(r.n)])),
  });
});

export default dialerConnectImport;

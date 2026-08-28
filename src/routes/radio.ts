// ============================================================
// RMPG Flex — Radio Console (Cloudflare Worker)
// ============================================================
// Backs the RadioPage at client/src/pages/radio/. Tables in
// migrations/0038_radio.sql:
//   radio_channels       — operator-visible channels
//   radio_transmissions  — append-only TX log
//   radio_recordings     — per-user saved/bookmarked tx
//
// Endpoints:
//   GET    /channels                          list active (?include_archived=1 for all)
//   POST   /channels                          admin/manager/supervisor
//   PATCH  /channels/:id
//   DELETE /channels/:id                      soft-delete (archived_at)
//   GET    /transmissions                     ?channel_id ?range ?min_duration ?q ?limit
//   POST   /transmissions                     log a tx (caller is implicit user)
//   DELETE /transmissions/:id                 admin/manager only
//   GET    /recordings                        caller's saved tx
//   POST   /recordings                        save/bookmark a tx
//   PATCH  /recordings/:id                    label/notes/loop points
//   DELETE /recordings/:id
//   GET    /stats                             sparkline (24h hourly) + heatmap (7d x 24h)
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';
import { verifySignedResource } from '../utils/signedAccess';
import { getDecrypted } from '../utils/encryptedR2';
import { sliceByteRange, rangeNotSatisfiableInit } from '../utils/byteRange';
import {
  ocrImage,
  ocrExtractStructured,
  lookupFromOcr,
  decideDispatcherReply,
  phraseLookupReply,
  synthesizeDispatcherVoice,
  bytesToBase64,
  type DispatcherTurn,
} from '../utils/aiDispatcher';
import { gatherAwareness, runLookup, runAction, VERBATIM_LOOKUPS } from '../utils/dispatcherAwareness';
import { getRadioSettings, setRadioSettings, RADIO_SETTING_DEFAULTS, RADIO_SETTING_OPTIONS } from '../utils/radioSettings';
import { generateIncidentNarrative, generateShiftSummary } from '../utils/aiReports';
import type { Bindings } from '../types';
import { denverDateExpr, denverNowDateExpr } from '../utils/denverTime';

const rt = new Hono<Env>();

const ALLOWED_RANGES = new Set(['all', 'today', 'h24', 'week', 'month']);

function rangeClause(range: string | undefined): { sql: string; args: unknown[] } {
  if (!range || range === 'all' || !ALLOWED_RANGES.has(range)) return { sql: '', args: [] };
  // SQLite datetime() math in TEXT comparison form — same shape as the
  // other route files (patrol/audit) so query plans stay consistent.
  if (range === 'today') return { sql: ` AND ${denverDateExpr('transmitted_at')} = ${denverNowDateExpr()}`, args: [] };
  if (range === 'h24')   return { sql: " AND transmitted_at >= datetime('now','-1 day')", args: [] };
  if (range === 'week')  return { sql: " AND transmitted_at >= datetime('now','-7 days')", args: [] };
  if (range === 'month') return { sql: " AND transmitted_at >= datetime('now','-30 days')", args: [] };
  return { sql: '', args: [] };
}

function requireRole(c: { get: (k: 'user') => { role: string } | undefined }, ...roles: string[]): string | null {
  const u = c.get('user');
  if (!u || !roles.includes(u.role)) return 'Insufficient role';
  return null;
}

// ── Channels ──────────────────────────────────────────────────

rt.get('/channels', async (c) => {
  const includeArchived = c.req.query('include_archived') === '1';
  const sql = `SELECT c.*,
                 (SELECT COUNT(*) FROM radio_transmissions t WHERE t.channel_id = c.id) AS tx_count,
                 (SELECT MAX(transmitted_at) FROM radio_transmissions t WHERE t.channel_id = c.id) AS last_tx_at
                 FROM radio_channels c
                 ${includeArchived ? '' : 'WHERE archived_at IS NULL'}
                 ORDER BY sort_order ASC, id ASC`;
  return c.json(await query(getDb(c.env), sql));
});

rt.post('/channels', async (c) => {
  const err = requireRole(c, 'admin', 'manager', 'supervisor');
  if (err) return c.json({ error: err }, 403);
  const body = await c.req.json().catch(() => ({} as any));
  const name = (body.name || '').trim();
  if (!name) return c.json({ error: 'name required' }, 400);
  const user = c.get('user') as { id: number } | undefined;
  const db = getDb(c.env);
  const result = await execute(
    db,
    `INSERT INTO radio_channels (name, description, frequency, talkgroup, color, sort_order, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    name,
    body.description || null,
    body.frequency || null,
    body.talkgroup || null,
    body.color || null,
    Number.isFinite(body.sort_order) ? body.sort_order : 0,
    user?.id ?? null,
  );
  const id = Number(result.meta.last_row_id);
  const channel = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM radio_channels WHERE id = ?', id);
  return c.json({ success: true, id, channel });
});

rt.patch('/channels/:id', async (c) => {
  const err = requireRole(c, 'admin', 'manager', 'supervisor');
  if (err) return c.json({ error: err }, 403);
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const body = await c.req.json().catch(() => ({} as any));
  const fields: string[] = [];
  const args: unknown[] = [];
  for (const k of ['name', 'description', 'frequency', 'talkgroup', 'color', 'sort_order'] as const) {
    if (k in body) { fields.push(`${k} = ?`); args.push(body[k]); }
  }
  if (!fields.length) return c.json({ error: 'no updatable fields' }, 400);
  args.push(id);
  const db = getDb(c.env);
  await execute(db, `UPDATE radio_channels SET ${fields.join(', ')} WHERE id = ?`, ...args);
  const channel = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM radio_channels WHERE id = ?', id);
  return c.json({ success: true });
});

rt.delete('/channels/:id', async (c) => {
  const err = requireRole(c, 'admin', 'manager', 'supervisor');
  if (err) return c.json({ error: err }, 403);
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  // Soft-delete — keeps transmission FK pointers valid for audit.
  await execute(
    getDb(c.env),
    "UPDATE radio_channels SET archived_at = datetime('now') WHERE id = ? AND archived_at IS NULL",
    id,
  );
  return c.json({ success: true });
});

// ── Transmissions ─────────────────────────────────────────────

rt.get('/transmissions', async (c) => {
  const channelId = c.req.query('channel_id');
  const range = c.req.query('range');
  const minDur = parseFloat(c.req.query('min_duration') || '0');
  const q = (c.req.query('q') || '').trim();
  const limit = Math.min(parseInt(c.req.query('limit') || '200', 10) || 200, 1000);

  const where: string[] = ['1=1'];
  const args: unknown[] = [];
  if (channelId) { where.push('channel_id = ?'); args.push(parseInt(channelId, 10)); }
  if (minDur > 0) { where.push('duration_seconds >= ?'); args.push(minDur); }
  if (q) {
    // Server-side coarse filter only — the client's matchesSearch()
    // helper does the boolean OR/negation parsing on the page. We
    // narrow first to keep payloads small.
    where.push('(transcript LIKE ? OR unit_label LIKE ? OR tags LIKE ?)');
    const safe = q.replace(/[%_]/g, '').slice(0, 48); // D1 LIKE cap: pattern >50 chars silently returns nothing
    const like = `%${safe}%`;
    args.push(like, like, like);
  }
  const rc = rangeClause(range);
  const sql = `SELECT t.*, c.name AS channel_name, u.full_name AS user_name
                 FROM radio_transmissions t
                 LEFT JOIN radio_channels c ON c.id = t.channel_id
                 LEFT JOIN users u ON u.id = t.user_id
                 WHERE ${where.join(' AND ')} ${rc.sql}
                 ORDER BY transmitted_at DESC LIMIT ?`;
  return c.json(await query(getDb(c.env), sql, ...args, ...rc.args, limit));
});

rt.post('/transmissions', async (c) => {
  const body = await c.req.json().catch(() => ({} as any));
  const channelId = parseInt(body.channel_id, 10);
  if (!Number.isFinite(channelId)) return c.json({ error: 'channel_id required' }, 400);
  const user = c.get('user') as { id: number } | undefined;
  const db = getDb(c.env);
  const result = await execute(
    db,
    `INSERT INTO radio_transmissions
       (channel_id, user_id, unit_label, duration_seconds, transcript, audio_url, priority, tags, call_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    channelId,
    user?.id ?? null,
    body.unit_label || null,
    Number.isFinite(body.duration_seconds) ? body.duration_seconds : 0,
    body.transcript || null,
    body.audio_url || null,
    Number.isFinite(body.priority) ? body.priority : 0,
    body.tags ? (typeof body.tags === 'string' ? body.tags : JSON.stringify(body.tags)) : null,
    Number.isFinite(body.call_id) ? body.call_id : null,
  );
  const id = Number(result.meta.last_row_id);

  // Fetch the joined row so the WS payload matches what GET /transmissions
  // returns — subscribers can prepend directly without a re-fetch.
  const transmission = await queryFirst<Record<string, unknown>>(
    db,
    `SELECT t.*, c.name AS channel_name, u.full_name AS user_name
       FROM radio_transmissions t
       LEFT JOIN radio_channels c ON c.id = t.channel_id
       LEFT JOIN users u ON u.id = t.user_id
       WHERE t.id = ?`,
    id,
  );
  return c.json({ success: true, id, transmission });
});

rt.delete('/transmissions/:id', async (c) => {
  const err = requireRole(c, 'admin', 'manager');
  if (err) return c.json({ error: err }, 403);
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  await execute(getDb(c.env), 'DELETE FROM radio_transmissions WHERE id = ?', id);
  return c.json({ success: true });
});

// GET /transmissions/:id/audio — stream the recorded clip from R2.
// VoiceHubDO stores each transmission's WebM at radio-audio/<id>.webm
// and writes audio_url = this path, so the lookup is a pure id→key map.
// Range support lets the <audio> element seek (mirrors bodycam stream).
rt.get('/transmissions/:id/audio', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);

  // authMiddleware passes GET media paths through when the request carries
  // sig/exp instead of a token — in that case no `user` is set and WE are
  // the verification point. A JWT-authenticated request has `user` set.
  if (!c.get('user')) {
    const signedOk = await verifySignedResource(c.env.JWT_SECRET, 'radio', String(id), {
      sig: c.req.query('sig'), exp: c.req.query('exp'), nonce: c.req.query('nonce'),
    });
    if (!signedOk) return c.json({ error: 'Authentication required' }, 401);
  }
  const key = `radio-audio/${id}.webm`;

  const rangeHeader = c.req.header('Range');
  let r2Range: R2Range | undefined;
  let rangeStart = 0;
  let rangeEnd = -1;
  if (rangeHeader) {
    const m = rangeHeader.trim().match(/^bytes=(\d+)-(\d*)$/);
    if (m) {
      rangeStart = Number(m[1]);
      rangeEnd = m[2] ? Number(m[2]) : -1;
      r2Range = rangeEnd >= 0 ? { offset: rangeStart, length: rangeEnd - rangeStart + 1 } : { offset: rangeStart };
    }
  }

  const decrypted = await getDecrypted(c.env.UPLOADS, getDb(c.env), c.env, key);

  // getDecrypted() returns null both for "object never existed" and for
  // "object exists, no file_encryption_keys row" — the latter is exactly
  // what every radio-audio/ object looks like today, since VoiceHubDO only
  // started calling putEncrypted in a previous task on this branch. Fall
  // back to a raw R2 read so historical recordings stay servable instead of
  // permanently 404ing (same pattern as fieldPhotos.ts's `GET /file/*`).
  let bytes: Uint8Array;
  let contentType: string | undefined;
  if (decrypted) {
    bytes = decrypted.bytes;
    contentType = decrypted.httpMetadata?.contentType;
  } else {
    const legacy = await c.env.UPLOADS.get(key);
    if (!legacy) return c.json({ error: 'Recording not found' }, 404);
    bytes = new Uint8Array(await legacy.arrayBuffer());
    contentType = legacy.httpMetadata?.contentType;
  }

  // Only treat the Range header as present if it actually matched the
  // supported `bytes=start-end` / `bytes=start-` form. RFC 7233: an
  // unparseable Range header must be treated as absent — plain 200, full
  // body, no Content-Range — not a 206 with a bogus 0-{total-1} range.
  // Unlike the R2-backed streams, this path decrypts into memory and slices,
  // so a bad range can't throw — but sliceByteRange() clamps, so "bytes=100-50"
  // used to return a 206 with an empty body and a nonsensical
  // "Content-Range: bytes 100-50/<total>". Answer 416 instead, matching the
  // other range-serving routes.
  if (r2Range && (rangeStart >= bytes.length || (rangeEnd >= 0 && rangeStart > rangeEnd))) {
    const init = rangeNotSatisfiableInit(bytes.length);
    return c.json(init.body, init.status, init.headers);
  }
  const sliced = sliceByteRange(bytes, r2Range ? { start: rangeStart, end: rangeEnd } : null);
  const headers: Record<string, string> = {
    'Content-Type': contentType || 'audio/webm',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=31536000, immutable',
  };
  if (r2Range) {
    headers['Content-Range'] = `bytes ${sliced.start}-${sliced.end}/${sliced.total}`;
    headers['Content-Length'] = String(sliced.data.length);
    return new Response(sliced.data, { status: 206, headers });
  }
  headers['Content-Length'] = String(sliced.data.length);
  return new Response(sliced.data, { status: 200, headers });
});

// ── Recordings (per-user bookmarks) ───────────────────────────

rt.get('/recordings', async (c) => {
  const user = c.get('user') as { id: number } | undefined;
  if (!user) return c.json([]);
  const rows = await query(
    getDb(c.env),
    `SELECT r.*, t.transcript, t.transmitted_at, t.duration_seconds, t.channel_id,
            c.name AS channel_name
       FROM radio_recordings r
       JOIN radio_transmissions t ON t.id = r.transmission_id
       LEFT JOIN radio_channels c ON c.id = t.channel_id
       WHERE r.user_id = ?
       ORDER BY r.created_at DESC`,
    user.id,
  );
  return c.json(rows);
});

rt.post('/recordings', async (c) => {
  const user = c.get('user') as { id: number } | undefined;
  if (!user) return c.json({ error: 'unauthenticated' }, 401);
  const body = await c.req.json().catch(() => ({} as any));
  const txId = parseInt(body.transmission_id, 10);
  if (!Number.isFinite(txId)) return c.json({ error: 'transmission_id required' }, 400);
  // Verify the tx exists so we fail fast with 404 instead of a FK error.
  const tx = await queryFirst<{ id: number }>(getDb(c.env), 'SELECT id FROM radio_transmissions WHERE id = ?', txId);
  if (!tx) return c.json({ error: 'transmission not found' }, 404);
  const result = await execute(
    getDb(c.env),
    `INSERT INTO radio_recordings (transmission_id, user_id, label, notes, color, bookmark_seconds, loop_start_seconds, loop_end_seconds)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    txId,
    user.id,
    body.label || null,
    body.notes || null,
    body.color || null,
    Number.isFinite(body.bookmark_seconds) ? body.bookmark_seconds : null,
    Number.isFinite(body.loop_start_seconds) ? body.loop_start_seconds : null,
    Number.isFinite(body.loop_end_seconds) ? body.loop_end_seconds : null,
  );
  return c.json({ success: true, id: result.meta.last_row_id });
});

rt.patch('/recordings/:id', async (c) => {
  const user = c.get('user') as { id: number } | undefined;
  if (!user) return c.json({ error: 'unauthenticated' }, 401);
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const body = await c.req.json().catch(() => ({} as any));
  const fields: string[] = [];
  const args: unknown[] = [];
  for (const k of ['label', 'notes', 'color', 'bookmark_seconds', 'loop_start_seconds', 'loop_end_seconds'] as const) {
    if (k in body) { fields.push(`${k} = ?`); args.push(body[k]); }
  }
  if (!fields.length) return c.json({ error: 'no updatable fields' }, 400);
  args.push(id, user.id);
  await execute(getDb(c.env), `UPDATE radio_recordings SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`, ...args);
  return c.json({ success: true });
});

rt.delete('/recordings/:id', async (c) => {
  const user = c.get('user') as { id: number } | undefined;
  if (!user) return c.json({ error: 'unauthenticated' }, 401);
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  await execute(getDb(c.env), 'DELETE FROM radio_recordings WHERE id = ? AND user_id = ?', id, user.id);
  return c.json({ success: true });
});

// ── Stats (sparkline + heatmap) ───────────────────────────────

rt.get('/stats', async (c) => {
  const db = getDb(c.env);
  // Sparkline: 24 hourly buckets for the trailing 24h. Returned as a
  // fixed-length array (index = hours-ago, 0 = now) so the client can
  // index without a date parse on each entry.
  const hourly = await query<{ hours_ago: number; n: number }>(
    db,
    `SELECT CAST((strftime('%s','now') - strftime('%s', transmitted_at)) / 3600 AS INTEGER) AS hours_ago,
            COUNT(*) AS n
       FROM radio_transmissions
       WHERE transmitted_at >= datetime('now','-1 day')
       GROUP BY hours_ago`,
  );
  const sparkline = Array.from({ length: 24 }, (_, i) => hourly.find((r) => r.hours_ago === i)?.n ?? 0);

  // Heatmap: 7 days x 24 hours, oldest-first row order (Mon..Sun
  // is the client's `labels` array). dow values from strftime are
  // 0=Sun..6=Sat — remap to 0=Mon..6=Sun client-side.
  const cells = await query<{ dow: number; hour: number; n: number }>(
    db,
    `SELECT CAST(strftime('%w', transmitted_at) AS INTEGER) AS dow,
            CAST(strftime('%H', transmitted_at) AS INTEGER) AS hour,
            COUNT(*) AS n
       FROM radio_transmissions
       WHERE transmitted_at >= datetime('now','-7 days')
       GROUP BY dow, hour`,
  );
  const heatmap: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const row of cells) {
    const monIndex = (row.dow + 6) % 7;
    heatmap[monIndex][row.hour] = row.n;
  }

  const totals = await queryFirst<{ today: number; week: number; all: number }>(
    db,
    // `all` is a SQL reserved word — it MUST be a quoted identifier or
    // SQLite throws `near "all": syntax error`. The double quotes keep
    // the result column named `all` (the client reads totals.all).
    `SELECT
       SUM(CASE WHEN ${denverDateExpr('transmitted_at')} = ${denverNowDateExpr()} THEN 1 ELSE 0 END) AS today,
       SUM(CASE WHEN transmitted_at >= datetime('now','-7 days') THEN 1 ELSE 0 END) AS week,
       COUNT(*) AS "all" FROM radio_transmissions`,
  );

  // SUM over an empty/zero-match set is NULL, not 0 — coalesce so the
  // STATS tab never renders "null".
  return c.json({
    sparkline,
    heatmap,
    totals: {
      today: totals?.today ?? 0,
      week: totals?.week ?? 0,
      all: totals?.all ?? 0,
    },
  });
});

// ============================================================
// POST /dispatcher/ocr — image → dispatcher (OCR + data entry)
// ============================================================
// The radio relay carries audio only, so a unit who wants the dispatcher to
// READ an image (a driver's license, a plate, a registration, a document)
// sends it here. The dispatcher OCRs it, then runs the SAME brain the radio
// uses — so it can read the document back, run a wants/plate check off it,
// or file a call from it (data entry), exactly like a spoken transmission.
//
// multipart/form-data:
//   image        (File, required) — the photo/scan
//   transcript   (string, opt)    — what the unit also said ("run this guy")
//   unit         (string, opt)    — the unit's call-sign (for grounding)
//   channel_id   (number, opt)    — channel for the awareness snapshot
//   speak        ("1", opt)       — also synthesize the reply audio (base64)
//
// Returns the OCR text, the dispatcher's spoken reply, the routed intent,
// and any lookup/action it performed. Best-effort throughout — a model miss
// degrades to a clear message, never a 500.
rt.post('/dispatcher/ocr', async (c) => {
  const form = await c.req.formData().catch(() => null);
  // Duck-type the upload (matches serveIntake.ts) — the Workers types here
  // surface FormDataEntryValue as string, so cast and check for arrayBuffer.
  const file = (form?.get('image') ?? null) as File | null;
  if (!file || typeof file.arrayBuffer !== 'function' || file.size === 0) {
    return c.json({ error: 'multipart field "image" (a file) is required' }, 400);
  }
  const image = new Uint8Array(await file.arrayBuffer());

  const db = getDb(c.env);
  const unit = (form?.get('unit') as string | null)?.trim() || null;

  // 1. OCR — read AND STRUCTURE the image (doc type + runnable identifiers).
  //    Falls back to plain-text OCR if structuring fails, so behavior never
  //    regresses below the old endpoint.
  const extraction = await ocrExtractStructured(c.env.AI, image).catch(() => null);
  const ocrText = extraction?.rawText || (await ocrImage(c.env.AI, image).catch(() => null));
  if (!ocrText) {
    return c.json({ success: false, error: 'No legible text found in the image.' }, 200);
  }

  // 1a. AUTO-CHAIN — if the image yielded a plate / VIN / name, run THAT CAD
  //     check now (deterministically), so the dispatcher reads the hit back in
  //     this same turn instead of relying on the model to chain it. The result
  //     is fed into the turn as a CAD AUTO-CHECK block (see buildUserPrompt).
  let autoCheck: string | null = null;
  let record: import('../utils/dispatcherAwareness').RecordRef | null = null;
  let performed: string | null = null;
  const autoReq = extraction ? lookupFromOcr(extraction) : null;
  if (autoReq) {
    const r = await runLookup(c.env as unknown as Bindings, db, autoReq, { speaker: unit }).catch(() => null);
    if (r) {
      autoCheck = r.text;
      if (r.record) record = r.record;
      performed = `auto_lookup:${autoReq.type}`;
    }
  }

  const transcript = (form?.get('transcript') as string | null)?.trim()
    || 'Dispatch, I am sending you an image — read it and advise.';
  const channelIdRaw = form?.get('channel_id');
  const channelId = channelIdRaw ? Number(channelIdRaw) : 0;

  // 2. Ground the turn in the live board, exactly like the radio path.
  const awareness = await gatherAwareness(db, channelId, unit)
    .catch(() => 'No active CAD activity on the board.');
  const channel = channelId
    ? await queryFirst<{ name: string }>(db, 'SELECT name FROM radio_channels WHERE id = ?', channelId).catch(() => null)
    : null;
  const turn: DispatcherTurn = {
    transcript,
    speaker: unit,
    channelName: channel?.name ?? null,
    recent: [],
    awareness,
    ocrText,
    autoCheck,
  };

  // Structured payload the client UI can render (doc type + extracted fields).
  const structured = extraction
    ? { docType: extraction.docType, fields: extraction.fields }
    : { docType: 'unknown' as const, fields: {} };

  // 3. Reason — the brain may answer, read the auto-check back, run another
  //    lookup, or file a write.
  const decision = await decideDispatcherReply(c.env.AI, turn);
  if (!decision) {
    // No model reply — but if we auto-ran a check, hand that back so the unit
    // still gets the answer the image asked for.
    return c.json({
      success: true, ocrText, structured, autoCheck, record, performed,
      reply: autoCheck ?? '', intent: autoCheck ? 'lookup_request' : 'unclear',
      note: autoCheck ? undefined : 'Dispatcher had no reply.',
    });
  }

  let reply = decision.reply;

  if (decision.lookup) {
    const result = await runLookup(
      c.env as unknown as Bindings, db, decision.lookup, { speaker: unit, channelId },
    ).catch(() => null);
    if (result) {
      // Verbatim lookups (location/eta/call_status/closest_unit/say-again)
      // already speak a complete line; record checks get re-phrased through the
      // persona (mirrors VoiceHubDO.runDispatcher).
      reply = VERBATIM_LOOKUPS.has(decision.lookup.type)
        ? result.text
        : await phraseLookupReply(c.env.AI, turn, decision.lookup, result.text);
      if (result.record) record = result.record;
      performed = `lookup:${decision.lookup.type}`;
    }
  }
  if (decision.action) {
    const issuer = c.get('user') as { id: number } | undefined;
    const written = await runAction(
      c.env as unknown as Bindings, db, decision.action,
      { issuedBy: issuer?.id ?? null },
    ).catch(() => null);
    if (written) {
      reply = written.spoken;
      performed = written.summary;
    } else {
      // Honesty: a refused/failed write must not read back as success.
      reply = decision.action.type === 'set_unit_status'
        ? 'Unable to log that status — an unrecognized call-sign or unclear status.'
        : decision.action.type === 'create_bolo'
          ? 'Unable to put that BOLO out — the BOLO details are required.'
          : 'Unable to start that call — a location and nature of the call are required.';
      performed = `action_refused:${decision.action.type}`;
    }
  }

  // 4. Optionally synthesize the spoken reply (Aura-2 → MP3 base64).
  let audio: string | null = null;
  if ((form?.get('speak') as string | null) === '1' && reply.trim()) {
    const bytes = await synthesizeDispatcherVoice(c.env.AI, reply).catch(() => null);
    if (bytes) audio = bytesToBase64(bytes);
  }

  return c.json({
    success: true,
    ocrText,
    structured,
    autoCheck,
    reply,
    intent: decision.intent,
    lookup: decision.lookup ?? null,
    action: decision.action ?? null,
    record,
    performed,
    audio,
  });
});

// ============================================================
// Radio / AI-Dispatcher settings (org-wide, live)
// ============================================================
// GET  /settings — read the merged settings (any logged-in user; the operator
//                  console reflects them). Also returns the defaults + option
//                  lists so the admin UI can render without hardcoding.
// PUT  /settings — admin/manager/supervisor only; persists a partial patch and
//                  echoes the merged result. VoiceHubDO + aiDispatcher read
//                  these on each dispatch, so changes are live.

rt.get('/settings', async (c) => {
  const db = getDb(c.env);
  const settings = await getRadioSettings(db);
  // `options` are the canonical dropdown lists — the UI renders from these so
  // the worker stays the single source of truth for voices/tabs/etc.
  return c.json({ settings, defaults: RADIO_SETTING_DEFAULTS, options: RADIO_SETTING_OPTIONS });
});

rt.put('/settings', async (c) => {
  const roleErr = requireRole(c, 'admin', 'manager', 'supervisor');
  if (roleErr) return c.json({ error: roleErr }, 403);
  const db = getDb(c.env);
  const patch = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!patch || typeof patch !== 'object') {
    return c.json({ error: 'Body must be a JSON object of setting key/values' }, 400);
  }

  const settings = await setRadioSettings(db, patch);

  // Keep radio_channels.is_default in sync when the default channel changes —
  // the operator picker reads is_default, so this makes the setting real.
  if ('default_channel_id' in patch) {
    const id = settings.default_channel_id;
    try {
      await execute(db, `UPDATE radio_channels SET is_default = 0 WHERE is_default = 1`);
      if (id != null) {
        await execute(db, `UPDATE radio_channels SET is_default = 1 WHERE id = ?`, id);
      }
    } catch (err) {
      console.warn('[radio.settings] is_default sync failed:', (err as Error)?.message);
    }
  }

  return c.json({ settings });
});

// ============================================================
// AI reports — incident narrative + shift summary
// ============================================================
// Grounded LLM writeups from real CAD data (see src/utils/aiReports.ts). Any
// logged-in user may generate; the model only rewrites the facts it's given.

// POST /ai/incident-narrative  body: { call_id } or { call_number }
// Returns a drafted narrative for the call + the radio traffic logged during it.
rt.post('/ai/incident-narrative', async (c) => {
  const body = await c.req.json<{ call_id?: number; call_number?: string }>().catch(() => null);
  const db = getDb(c.env);
  const call = body?.call_id
    ? await queryFirst<Record<string, unknown>>(
        db,
        `SELECT call_number, incident_type, priority, status, location_address, description, notes,
                disposition, unit_call_signs, caller_name, created_at, cleared_at
         FROM calls_for_service WHERE id = ? LIMIT 1`, body.call_id)
    : body?.call_number
      ? await queryFirst<Record<string, unknown>>(
          db,
          `SELECT call_number, incident_type, priority, status, location_address, description, notes,
                  disposition, unit_call_signs, caller_name, created_at, cleared_at
           FROM calls_for_service WHERE UPPER(call_number) = UPPER(?) LIMIT 1`, body.call_number)
      : null;
  if (!call) return c.json({ error: 'call_id or call_number required (and must exist)' }, 400);

  // Radio traffic logged while the call was active (received → cleared/now).
  const start = (call.created_at as string) || null;
  const end = (call.cleared_at as string) || null;
  const tx = start
    ? await query<{ unit_label: string | null; transcript: string | null; transmitted_at: string | null }>(
        db,
        `SELECT unit_label, transcript, transmitted_at FROM radio_transmissions
         WHERE transcript IS NOT NULL AND datetime(transmitted_at) >= datetime(?)
           AND datetime(transmitted_at) <= datetime(${end ? '?' : "'now'"})
         ORDER BY datetime(transmitted_at) ASC LIMIT 40`,
        ...(end ? [start, end] : [start]),
      ).catch(() => [])
    : [];

  const narrative = await generateIncidentNarrative(c.env.AI, {
    call: call as any,
    transmissions: tx.map((t) => ({ unit: t.unit_label, text: t.transcript || '', at: t.transmitted_at })),
  });
  if (!narrative) return c.json({ error: 'Narrative generation failed — try again.' }, 502);
  return c.json({ call_number: call.call_number, narrative });
});

// GET /ai/shift-summary?unit=12-Adam&hours=12
rt.get('/ai/shift-summary', async (c) => {
  const unit = (c.req.query('unit') || '').trim();
  if (!unit) return c.json({ error: 'unit query parameter required' }, 400);
  const hours = Math.min(Math.max(parseInt(c.req.query('hours') || '12', 10) || 12, 1), 72);
  const db = getDb(c.env);
  const since = `-${hours} hours`;

  const calls = await query<{ call_number: string | null; incident_type: string | null; disposition: string | null; status: string | null }>(
    db,
    `SELECT call_number, incident_type, disposition, status FROM calls_for_service
     WHERE (unit_call_signs LIKE ? OR COALESCE(responding_officer,'') LIKE ?)
       AND datetime(created_at) >= datetime('now', ?)
     ORDER BY datetime(created_at) DESC LIMIT 50`,
    `%${unit.slice(0, 48)}%`, `%${unit.slice(0, 48)}%`, since,
  ).catch(() => []);

  const txRow = await queryFirst<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM radio_transmissions
     WHERE UPPER(unit_label) = UPPER(?) AND datetime(transmitted_at) >= datetime('now', ?)`,
    unit, since,
  ).catch(() => ({ n: 0 }));

  const unitRow = await queryFirst<{ status: string | null }>(
    db, 'SELECT status FROM units WHERE UPPER(call_sign) = UPPER(?) LIMIT 1', unit,
  ).catch(() => null);

  const summary = await generateShiftSummary(c.env.AI, {
    unit, hours,
    calls,
    transmissionCount: txRow?.n ?? 0,
    statuses: unitRow?.status ? [unitRow.status] : [],
  });
  if (!summary) return c.json({ error: 'Shift summary generation failed — try again.' }, 502);
  return c.json({ unit, hours, summary, stats: { calls: calls.length, transmissions: txRow?.n ?? 0 } });
});

export default rt;

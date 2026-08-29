// ============================================================
// Dial Connect recordings — officer/dispatcher JWT surface
// ============================================================
// GET  /api/dial-connect-recordings           list
// GET  /api/dial-connect-recordings/:id       detail + transcript
// GET  /api/dial-connect-recordings/:id/audio encrypted R2 download
// POST /api/dial-connect-recordings           CAD iframe ingest (JWT)
//
// Machine ingest from Dial Connect itself is POST
// /api/integrations/dial-connect-recordings (API key) — see integrations.ts.

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst } from '../utils/db';
import { getDecrypted } from '../utils/encryptedR2';
import { recordAudit } from '../utils/auditLog';
import { log } from '../utils/logger';
import {
  ensureDialConnectRecordingsTable,
  parseDialConnectRecordingIngest,
  publicRecordingDetail,
  publicRecordingSummary,
  upsertDialConnectRecording,
  type DialConnectRecordingRow,
} from '../utils/dialConnectRecordings';

const dialConnectRecordings = new Hono<Env>();

dialConnectRecordings.use('*', async (c, next) => {
  const user = c.get('user') as { role: string } | undefined;
  if (!user) return c.json({ error: 'Authentication required' }, 401);
  if (user.role === 'client_viewer') return c.json({ error: 'Forbidden' }, 403);
  await next();
});

dialConnectRecordings.get('/', async (c) => {
  const db = getDb(c.env);
  await ensureDialConnectRecordingsTable(db);
  const q = (c.req.query('q') || '').trim().slice(0, 40);
  const like = q ? `%${q.replace(/%/g, '').replace(/_/g, '')}%` : null;
  const rows = like
    ? await query<DialConnectRecordingRow>(
      db,
      `SELECT * FROM dial_connect_recordings
        WHERE from_number LIKE ? OR to_number LIKE ? OR call_sid LIKE ? OR recording_sid LIKE ?
        ORDER BY COALESCE(started_at, ingested_at) DESC LIMIT 200`,
      like, like, like, like,
    )
    : await query<DialConnectRecordingRow>(
      db,
      `SELECT * FROM dial_connect_recordings
        ORDER BY COALESCE(started_at, ingested_at) DESC LIMIT 200`,
    );
  return c.json(rows.map(publicRecordingSummary));
});

dialConnectRecordings.get('/:id/audio', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id < 1) return c.json({ error: 'Invalid id' }, 400);
  const db = getDb(c.env);
  const row = await queryFirst<DialConnectRecordingRow>(
    db, 'SELECT * FROM dial_connect_recordings WHERE id = ?', id,
  );
  if (!row?.audio_r2_key) return c.json({ error: 'Recording audio not found' }, 404);

  const decrypted = await getDecrypted(c.env.UPLOADS, db, c.env, row.audio_r2_key);
  if (!decrypted) return c.json({ error: 'Recording audio not found' }, 404);

  await recordAudit(c, {
    action: 'DIAL_CONNECT_RECORDING_DOWNLOAD',
    entityType: 'dial_connect_recording',
    entityId: id,
    details: { recording_sid: row.recording_sid },
  });

  const ext = row.audio_r2_key.includes('.') ? row.audio_r2_key.slice(row.audio_r2_key.lastIndexOf('.') + 1) : 'audio';
  const filename = `dial-connect-${row.recording_sid}.${ext}`;
  return new Response(decrypted.bytes, {
    status: 200,
    headers: {
      'Content-Type': decrypted.httpMetadata?.contentType || row.audio_content_type || 'audio/mpeg',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  });
});

dialConnectRecordings.get('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id < 1) return c.json({ error: 'Invalid id' }, 400);
  const db = getDb(c.env);
  await ensureDialConnectRecordingsTable(db);
  const row = await queryFirst<DialConnectRecordingRow>(
    db, 'SELECT * FROM dial_connect_recordings WHERE id = ?', id,
  );
  if (!row) return c.json({ error: 'Not found' }, 404);
  return c.json(publicRecordingDetail(row));
});

dialConnectRecordings.post('/', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = parseDialConnectRecordingIngest(body);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  try {
    const result = await upsertDialConnectRecording({
      db: getDb(c.env),
      uploads: c.env.UPLOADS,
      env: c.env,
      ingest: parsed.value,
      source: 'cad_iframe',
    });
    return c.json({ ok: true, ...result }, result.created ? 201 : 200);
  } catch (err) {
    log.error('Dial Connect recording ingest failed', { recordingSid: parsed.value.recordingSid }, err);
    return c.json({ error: 'Failed to store recording' }, 500);
  }
});

export default dialConnectRecordings;

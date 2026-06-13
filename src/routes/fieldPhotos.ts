// ============================================================
// RMPG Flex — field_photos (Cloudflare Worker, R2-backed)
// ============================================================
// Evidence/scene photos captured by officers through the mobile
// camera portal (/field-camera). The client burns the data
// overlay (timestamp, officer, unit, GPS, RMPG watermark) into
// the JPEG before upload, so the stored object IS the
// court-ready stamped image — there is no "clean" original to
// dispute. The row carries the same metadata in queryable form.
//
// Files live in UPLOADS R2 under `field-photos/`. Streaming is
// authorized through the Worker (same posture as
// business-photos): scene photos may show victims, juveniles,
// or client interiors — never expose the bucket publicly.
//
// Endpoints:
//   POST /            multipart {photo, lat?, lng?, call_id?, notes?}
//   GET  /            ?officer_id=&call_id=&from=&to=&limit=
//   GET  /file/:key+  stream bytes from R2 (prefix-validated)
//   DELETE /:id       admin/manager/supervisor only (audited)
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';

const fieldPhotos = new Hono<Env>();

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_SIZE = 12 * 1024 * 1024; // 12 MB — stamped JPEGs from phones run large

// Idempotent table bootstrap — the live D1 gets the table on first write
// (mirrors the Worker boot-reconciler pattern; D1 migrations have the
// continue-on-error caveat documented in CLAUDE.md).
async function ensureTable(db: ReturnType<typeof getDb>) {
  await execute(db, `CREATE TABLE IF NOT EXISTS field_photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    officer_id INTEGER NOT NULL,
    call_id INTEGER,
    incident_id INTEGER,
    r2_key TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    latitude REAL,
    longitude REAL,
    notes TEXT,
    taken_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  )`);
  // D1 has no IF NOT EXISTS on ADD COLUMN — swallow the re-apply error so the
  // column self-heals on tables created before incident linkage existed.
  try { await execute(db, `ALTER TABLE field_photos ADD COLUMN incident_id INTEGER`); } catch { /* column exists */ }
}

// POST / — multipart upload. The photo arrives already stamped.
fieldPhotos.post('/', async (c) => {
  const user = c.get('user') as { id: number } | undefined;
  if (!user) return c.json({ error: 'Unauthenticated' }, 401);
  const form = await c.req.formData().catch(() => null);
  if (!form) return c.json({ error: 'multipart form required' }, 400);
  const fileEntry = form.get('photo') as unknown;
  // Workers' FormDataEntryValue is string | File; the TS lib in this project
  // types get() narrowly, so go through unknown and duck-check.
  const file = fileEntry && typeof fileEntry === 'object' && 'arrayBuffer' in (fileEntry as object)
    ? (fileEntry as File)
    : null;
  if (!file) return c.json({ error: 'photo file required' }, 400);
  if (!ALLOWED_MIME.has(file.type)) return c.json({ error: `Unsupported type ${file.type}` }, 400);
  if (file.size > MAX_SIZE) return c.json({ error: 'File too large (12 MB max)' }, 400);

  const latRaw = form.get('lat'); const lngRaw = form.get('lng');
  const lat = latRaw != null && latRaw !== '' ? parseFloat(String(latRaw)) : null;
  const lng = lngRaw != null && lngRaw !== '' ? parseFloat(String(lngRaw)) : null;
  const callIdRaw = form.get('call_id');
  const callId = callIdRaw != null && callIdRaw !== '' ? parseInt(String(callIdRaw), 10) : null;
  const incidentIdRaw = form.get('incident_id');
  const incidentId = incidentIdRaw != null && incidentIdRaw !== '' ? parseInt(String(incidentIdRaw), 10) : null;
  const notes = form.get('notes') != null ? String(form.get('notes')).slice(0, 2000) : null;

  const ext = file.type === 'image/png' ? '.png' : file.type === 'image/webp' ? '.webp' : '.jpg';
  const key = `field-photos/${crypto.randomUUID()}${ext}`;

  await c.env.UPLOADS.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type },
  });

  const db = getDb(c.env);
  await ensureTable(db);
  const r = await execute(db,
    `INSERT INTO field_photos (officer_id, call_id, incident_id, r2_key, content_type, size_bytes, latitude, longitude, notes)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    user.id, Number.isFinite(callId as number) ? callId : null,
    Number.isFinite(incidentId as number) ? incidentId : null,
    key, file.type, file.size,
    Number.isFinite(lat as number) ? lat : null, Number.isFinite(lng as number) ? lng : null, notes,
  );
  return c.json({
    success: true, id: r.meta.last_row_id, r2_key: key,
    url: `/api/field-photos/file/${key}`,
  }, 201);
});

// GET / — list (filterable)
fieldPhotos.get('/', async (c) => {
  const db = getDb(c.env);
  await ensureTable(db);
  const { officer_id, call_id, incident_id, from, to, limit } = c.req.query();
  const where: string[] = [];
  const p: unknown[] = [];
  if (officer_id) { where.push('p.officer_id = ?'); p.push(parseInt(officer_id, 10)); }
  if (call_id) { where.push('p.call_id = ?'); p.push(parseInt(call_id, 10)); }
  if (incident_id) { where.push('p.incident_id = ?'); p.push(parseInt(incident_id, 10)); }
  if (from) { where.push('p.taken_at >= ?'); p.push(String(from).replace('T', ' ')); }
  if (to) { where.push('p.taken_at <= ?'); p.push(String(to).replace('T', ' ')); }
  const rows = await query<Record<string, unknown>>(db, `
    SELECT p.id, p.officer_id, u.full_name AS officer_name, p.call_id, p.incident_id,
           c.call_number, p.r2_key, p.content_type, p.size_bytes,
           p.latitude, p.longitude, p.notes, p.taken_at
      FROM field_photos p
      LEFT JOIN users u ON u.id = p.officer_id
      LEFT JOIN calls_for_service c ON c.id = p.call_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY p.taken_at DESC
     LIMIT ?`, ...p, Math.min(parseInt(limit || '100', 10) || 100, 500));
  return c.json(rows.map(r => ({ ...r, url: `/api/field-photos/file/${r.r2_key}` })));
});

// GET /file/field-photos/<uuid>.<ext> — stream from R2.
// :key is multi-segment, so use a wildcard route + manual prefix check.
fieldPhotos.get('/file/*', async (c) => {
  const key = c.req.path.replace(/^.*\/file\//, '');
  if (!key.startsWith('field-photos/') || key.includes('..')) {
    return c.json({ error: 'Invalid key' }, 400);
  }
  const obj = await c.env.UPLOADS.get(key);
  if (!obj) return c.json({ error: 'Not found' }, 404);
  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType || 'image/jpeg',
      'Cache-Control': 'private, max-age=3600',
    },
  });
});

// DELETE /:id — supervisors and above only; audited. Evidence photos
// should rarely be deleted; the audit row preserves who and why.
fieldPhotos.delete('/:id', async (c) => {
  const user = c.get('user') as { id: number; role: string } | undefined;
  if (!user) return c.json({ error: 'Unauthenticated' }, 401);
  if (!['admin', 'manager', 'supervisor'].includes(user.role)) {
    return c.json({ error: 'Admin / manager / supervisor only' }, 403);
  }
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const db = getDb(c.env);
  const row = await queryFirst<{ r2_key: string; officer_id: number }>(
    db, 'SELECT r2_key, officer_id FROM field_photos WHERE id = ?', id);
  if (!row) return c.json({ error: 'Not found' }, 404);
  await c.env.UPLOADS.delete(row.r2_key);
  await execute(db, 'DELETE FROM field_photos WHERE id = ?', id);
  await execute(db,
    `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details, created_at)
     VALUES (?, 'FIELD_PHOTO_DELETE', 'field_photo', ?, ?, datetime('now'))`,
    user.id, id, `Deleted field photo ${row.r2_key} (officer ${row.officer_id})`);
  return c.json({ success: true });
});

export default fieldPhotos;

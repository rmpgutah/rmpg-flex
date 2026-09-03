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
import { recordAudit } from '../utils/auditLog';
import { putEncrypted, getDecrypted, deleteEncryptionKey } from '../utils/encryptedR2';
import { mergeExif, parseImageExif } from '../utils/imageExif';

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
    taken_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
  const bytes = await file.arrayBuffer();
  const evidence = mergeExif(
    { latitude: lat, longitude: lng, taken_at: form.get('taken_at') ? String(form.get('taken_at')) : null },
    parseImageExif(new Uint8Array(bytes)),
  );

  const db = getDb(c.env);
  await putEncrypted(c.env.UPLOADS, db, c.env, key, bytes, {
    httpMetadata: { contentType: file.type },
  });

  await ensureTable(db);
  const r = await execute(db,
    `INSERT INTO field_photos (officer_id, call_id, incident_id, r2_key, content_type, size_bytes, latitude, longitude, notes, taken_at)
     VALUES (?,?,?,?,?,?,?,?,?, COALESCE(?, datetime('now')))`,
    user.id, Number.isFinite(callId as number) ? callId : null,
    Number.isFinite(incidentId as number) ? incidentId : null,
    key, file.type, file.size,
    evidence.latitude ?? null, evidence.longitude ?? null, notes,
    evidence.taken_at ?? null,
  );
  return c.json({
    success: true, id: r.meta.last_row_id, r2_key: key,
    url: `/api/field-photos/file/${key}`,
  }, 201);
});

// GET / — list (filterable)
fieldPhotos.get('/', async (c) => {
  const u = c.get('user') as { role: string } | undefined;
  if (!u || ['contract_manager', 'client_viewer'].includes(u.role))
    return c.json({ error: 'Insufficient role', code: 'FORBIDDEN' }, 403);
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
  // Auth: this path matches authMiddleware's media predicate
  // (`/field-photos/file/`), so a header-less GET carrying sig+exp is
  // forwarded here WITHOUT the signature being checked. Nothing in this
  // handler used to check it either, which made every scene photo — the
  // header below notes these may show victims, juveniles, or client
  // interiors — readable by anyone holding or guessing an object key, and
  // made the `exp` parameter meaningless (a signed URL never expired).
  //
  // The client renders these through authedImageUrl(), which appends the
  // session token, so requiring a real session preserves every caller.
  const user = c.get('user') as { id?: number } | undefined;
  if (!user) return c.json({ error: 'Authentication required' }, 401);

  const key = c.req.path.replace(/^.*\/file\//, '');
  if (!key.startsWith('field-photos/') || key.includes('..')) {
    return c.json({ error: 'Invalid key' }, 400);
  }
  const result = await getDecrypted(c.env.UPLOADS, getDb(c.env), c.env, key);
  if (result) {
    return new Response(result.bytes, {
      headers: {
        'Content-Type': result.httpMetadata?.contentType || 'image/jpeg',
        'Cache-Control': 'private, max-age=3600',
      },
    });
  }
  // getDecrypted() returns null both for "object never existed" and for a
  // genuinely crypto-shredded object with no key row -- neither is
  // distinguishable here from a LEGACY object uploaded before this feature
  // shipped (also "object exists, no key row"). Fall back to serving the
  // raw R2 bytes as-is. Safe today because no code path does standalone
  // crypto-shredding: this file's own DELETE handler (below) always removes
  // the R2 object and its key row together, so "object present, row absent"
  // can currently only mean "predates encryption," never "was shredded."
  const legacy = await c.env.UPLOADS.get(key);
  if (!legacy) return c.json({ error: 'Not found' }, 404);
  return new Response(legacy.body, {
    headers: {
      'Content-Type': legacy.httpMetadata?.contentType || 'image/jpeg',
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
  await deleteEncryptionKey(db, row.r2_key);
  await execute(db, 'DELETE FROM field_photos WHERE id = ?', id);
  await recordAudit(c, { action: 'FIELD_PHOTO_DELETE', entityType: 'field_photo', entityId: id, details: `Deleted field photo ${row.r2_key} (officer ${row.officer_id})`, actorId: user.id });
  return c.json({ success: true });
});

export default fieldPhotos;

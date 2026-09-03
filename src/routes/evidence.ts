// ============================================================
// RMPG Flex — Secure Evidence chain-of-custody manifests
// ============================================================
// Each secure capture from the iOS evidence camera files a manifest here: the
// SHA-256 of the ORIGINAL frame (also burned into the photo's pixels), its
// classification, exhibit sequence, officer, GPS, and capture time. The stored
// photo is therefore self-verifying — recompute the hash and check it against
// the burned-in fingerprint and this manifest.
//
//   POST /                file a manifest          -> {data}
//   GET  /                list (newest first)      -> {data}
//   GET  /verify/:sha256  confirm a hash is filed  -> {verified, match?}
// ============================================================

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';
import { emitAnalytics, flexEvent } from '../utils/analytics';
import { normalizeClassification, validateManifest, evidenceNumber, shortHash } from '../utils/evidence';
import { putEncrypted, getDecrypted, FileEncryptionError } from '../utils/encryptedR2';

const OFFICER_STORAGE_UNAVAILABLE = 'File storage is temporarily unavailable. Contact a supervisor.';

function isDigitalEvidenceKey(key: string): boolean {
  return key.startsWith('digital-evidence/') && !key.includes('..');
}

async function streamDigitalEvidenceFile(
  c: Context<Env>,
  r2Key: string,
  mime?: string | null,
  filename?: string | null,
): Promise<Response> {
  if (!isDigitalEvidenceKey(r2Key)) return c.json({ error: 'Invalid key' }, 400);
  try {
    const decrypted = await getDecrypted(c.env.UPLOADS, getDb(c.env), c.env, r2Key);
    if (decrypted) {
      const headers: Record<string, string> = {
        'Content-Type': decrypted.httpMetadata?.contentType || mime || 'application/octet-stream',
        'Cache-Control': 'private, max-age=300',
      };
      if (filename) headers['Content-Disposition'] = `inline; filename="${filename.replace(/"/g, '')}"`;
      return new Response(decrypted.bytes, { headers });
    }
  } catch (err) {
    if (err instanceof FileEncryptionError) {
      return c.json({ error: OFFICER_STORAGE_UNAVAILABLE, code: 'ENCRYPTION_FAILED' }, 503);
    }
    throw err;
  }
  const legacy = await c.env.UPLOADS?.get(r2Key);
  if (!legacy) return c.json({ error: 'Not found' }, 404);
  const headers = new Headers();
  legacy.writeHttpMetadata(headers);
  headers.set('Cache-Control', 'private, max-age=300');
  if (filename) headers.set('Content-Disposition', `inline; filename="${filename.replace(/"/g, '')}"`);
  if (mime && !headers.has('Content-Type')) headers.set('Content-Type', mime);
  return new Response(legacy.body, { headers });
}

const evidence = new Hono<Env>();

async function ensureTable(db: ReturnType<typeof getDb>): Promise<void> {
  await execute(db, `CREATE TABLE IF NOT EXISTS evidence_manifests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    evidence_number TEXT,
    sha256 TEXT NOT NULL,
    classification TEXT NOT NULL DEFAULT 'EVIDENCE',
    sequence INTEGER,
    officer_id INTEGER,
    officer_name TEXT,
    badge TEXT,
    unit TEXT,
    case_ref TEXT,
    gps_lat REAL,
    gps_lng REAL,
    device_id TEXT,
    mime TEXT,
    captured_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await execute(db, `CREATE INDEX IF NOT EXISTS idx_evidence_sha ON evidence_manifests(sha256)`);
}

// Role allow-list for filing a manifest. Audit 2026-06-21 caught that
// ANY authenticated user could forge manifests with arbitrary sha256
// + officer_name + badge + case_ref. Restricted to roles that can
// legitimately be present at an evidence event.
// 2026-06-22 softened: dispatcher is added — during an in-progress
// CAD call, the dispatcher commonly files on-behalf-of when a unit's
// iOS app is offline or the field officer is mid-pursuit. The
// officer_id is still forced from the JWT (dispatchers can't claim to
// BE the field officer), so a dispatcher manifest will carry
// officer_id=<dispatcher's id> in the audit trail.
const EVIDENCE_FILE_ROLES = new Set(['admin', 'manager', 'supervisor', 'officer', 'dispatcher']);

// POST / — file a manifest.
evidence.post('/', async (c): Promise<Response> => {
  // Role gate. Reject before reading the body — we don't want to even
  // parse user-controlled payloads when the caller has no business
  // filing custody entries.
  const user = c.get('user') as { id?: number; role?: string } | undefined;
  if (!user || !user.role || !EVIDENCE_FILE_ROLES.has(user.role)) {
    return c.json({ error: 'Insufficient role to file an evidence manifest' }, 403);
  }

  const db = getDb(c.env);
  await ensureTable(db);
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const check = validateManifest(body);
  if (!check.ok) return c.json({ error: check.error }, 400);

  // officer_id is ALWAYS the authenticated user — never the body. The
  // previous version trusted body.officer_id which let a forged
  // manifest claim any officer was at the scene.
  const userId = (c.get('userId') as number | undefined) ?? user.id ?? null;
  const year = new Date().getFullYear();
  const countRow = await queryFirst<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM evidence_manifests WHERE strftime('%Y', created_at) = ?`,
    String(year),
  ).catch(() => ({ n: 0 }) as { n: number });
  const evNumber = evidenceNumber(year, (countRow?.n ?? 0) + 1);

  const sha = String((body as Record<string, unknown>).sha256 ?? '');
  const res = await execute(
    db,
    `INSERT INTO evidence_manifests
       (evidence_number, sha256, classification, sequence, officer_id, officer_name,
        badge, unit, case_ref, gps_lat, gps_lng, device_id, mime, captured_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    evNumber,
    sha,
    normalizeClassification((body as Record<string, unknown>).classification),
    Number((body as Record<string, unknown>).sequence ?? 0) || 0,
    userId,
    String((body as Record<string, unknown>).officer_name ?? ''),
    String((body as Record<string, unknown>).badge ?? ''),
    String((body as Record<string, unknown>).unit ?? ''),
    String((body as Record<string, unknown>).case_ref ?? ''),
    (body as Record<string, unknown>).gps_lat ?? null,
    (body as Record<string, unknown>).gps_lng ?? null,
    String((body as Record<string, unknown>).device_id ?? ''),
    String((body as Record<string, unknown>).mime ?? 'image/jpeg'),
    String((body as Record<string, unknown>).captured_at ?? ''),
  );
  // Analytics lakehouse: evidence-logged event (best-effort, fire-and-forget).
  emitAnalytics(c, c.env.EVENTS, [flexEvent({
    event_type: 'evidence_logged', occurred_at: new Date().toISOString(),
    actor_id: userId, entity_type: 'evidence', entity_id: Number(res.meta?.last_row_id) || null,
    lat: (body as Record<string, unknown>).gps_lat, lng: (body as Record<string, unknown>).gps_lng,
    label: evNumber, category: 'evidence',
    payload: {
      classification: String((body as Record<string, unknown>).classification ?? ''),
      case_ref: String((body as Record<string, unknown>).case_ref ?? ''),
    },
  })]);

  return c.json({
    data: { id: res.meta?.last_row_id, evidence_number: evNumber, sha256: sha, short_hash: shortHash(sha) },
  });
});

// GET / — list newest first.
evidence.get('/', async (c): Promise<Response> => {
  const db = getDb(c.env);
  await ensureTable(db);
  const limit = Math.min(parseInt(c.req.query('limit') || '100', 10) || 100, 500);
  const rows = await query<Record<string, unknown>>(
    db,
    `SELECT * FROM evidence_manifests ORDER BY id DESC LIMIT ?`,
    limit,
  ).catch(() => [] as Record<string, unknown>[]);
  return c.json({ data: rows });
});

async function ensureDigitalEvidenceTables(db: ReturnType<typeof getDb>): Promise<void> {
  await execute(db, `CREATE TABLE IF NOT EXISTS digital_evidence (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    original_filename TEXT,
    evidence_type TEXT NOT NULL DEFAULT 'photo',
    mime_type TEXT,
    file_size INTEGER DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending_review',
    case_id INTEGER,
    call_id INTEGER,
    case_number TEXT,
    call_number TEXT,
    officer_id INTEGER,
    officer_name TEXT,
    uploaded_by INTEGER,
    uploaded_by_name TEXT,
    r2_key TEXT,
    url TEXT,
    thumbnail_url TEXT,
    description TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS digital_evidence_custody (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    evidence_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    actor_name TEXT,
    actor_id INTEGER,
    timestamp TEXT NOT NULL DEFAULT (datetime('now')),
    notes TEXT
  )`);
}

// GET /pending — items requiring action/review (for Desktop widget & dashboard)
evidence.get('/pending', async (c): Promise<Response> => {
  const db = getDb(c.env);
  await ensureDigitalEvidenceTables(db);
  const rows = await query<Record<string, unknown>>(
    db,
    `SELECT id, filename, original_filename, evidence_type, mime_type, file_size, status,
            case_id, call_id, case_number, call_number, officer_id, officer_name,
            created_at, description
       FROM digital_evidence
      WHERE status = 'pending_review'
      ORDER BY id DESC LIMIT 50`,
  ).catch(() => [] as Record<string, unknown>[]);
  return c.json({ data: rows });
});

// GET /digital — list digital evidence (photos, videos, audio, screenshots)
evidence.get('/digital', async (c): Promise<Response> => {
  const db = getDb(c.env);
  await ensureDigitalEvidenceTables(db);
  const typeFilter = c.req.query('type');
  const limit = Math.min(parseInt(c.req.query('limit') || '200', 10) || 200, 500);

  let sql = `SELECT * FROM digital_evidence`;
  const params: unknown[] = [];
  if (typeFilter && typeFilter !== 'all') {
    sql += ` WHERE evidence_type = ?`;
    params.push(typeFilter);
  }
  sql += ` ORDER BY id DESC LIMIT ?`;
  params.push(limit);

  const rows = await query<Record<string, unknown>>(db, sql, ...params).catch(() => [] as Record<string, unknown>[]);
  return c.json({ items: rows });
});

// POST /digital — upload new digital evidence file
evidence.post('/digital', async (c): Promise<Response> => {
  const user = c.get('user') as { id?: number; full_name?: string; username?: string; role?: string } | undefined;
  const userId = (c.get('userId') as number | undefined) ?? user?.id ?? null;
  const userName = user?.full_name ?? user?.username ?? 'Officer';

  const db = getDb(c.env);
  await ensureDigitalEvidenceTables(db);

  let filename = 'evidence_file';
  let evidenceType = 'photo';
  let mimeType = 'application/octet-stream';
  let fileSize = 0;
  let caseId: number | null = null;
  let callId: number | null = null;
  let description: string | null = null;
  let fileBytes: Uint8Array | null = null;

  try {
    const formData = await c.req.formData();
    const fileEntry = formData.get('file');
    filename = (formData.get('filename') as string) || (fileEntry instanceof File ? fileEntry.name : 'file');
    evidenceType = (formData.get('evidence_type') as string) || 'photo';
    const cId = formData.get('case_id');
    if (cId) caseId = parseInt(String(cId), 10) || null;
    const clId = formData.get('call_id');
    if (clId) callId = parseInt(String(clId), 10) || null;
    description = (formData.get('description') as string) || null;

    if (fileEntry instanceof File) {
      mimeType = fileEntry.type || 'application/octet-stream';
      fileSize = fileEntry.size;
      const buf = await fileEntry.arrayBuffer();
      fileBytes = new Uint8Array(buf);
    }
  } catch {
    const json = await c.req.json().catch(() => ({}) as Record<string, unknown>);
    filename = String(json.filename ?? 'file');
    evidenceType = String(json.evidence_type ?? 'photo');
    caseId = json.case_id ? Number(json.case_id) : null;
    callId = json.call_id ? Number(json.call_id) : null;
    description = json.description ? String(json.description) : null;
  }

  const ext = filename.split('.').pop()?.toLowerCase() ?? 'bin';
  const r2Key = `digital-evidence/${crypto.randomUUID()}.${ext}`;

  if (fileBytes && c.env.UPLOADS) {
    try {
      await putEncrypted(c.env.UPLOADS, db, c.env, r2Key, fileBytes, {
        httpMetadata: { contentType: mimeType },
      });
    } catch (err) {
      if (err instanceof FileEncryptionError) {
        return c.json({ error: OFFICER_STORAGE_UNAVAILABLE, code: 'ENCRYPTION_FAILED' }, 503);
      }
      throw err;
    }
  }

  const res = await execute(
    db,
    `INSERT INTO digital_evidence
       (filename, original_filename, evidence_type, mime_type, file_size, status,
        case_id, call_id, officer_id, officer_name, uploaded_by, uploaded_by_name,
        r2_key, url, description)
     VALUES (?, ?, ?, ?, ?, 'pending_review', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    filename,
    filename,
    evidenceType,
    mimeType,
    fileSize,
    caseId,
    callId,
    userId,
    userName,
    userId,
    userName,
    r2Key,
    '',
    description,
  );

  const newId = Number(res.meta?.last_row_id) || Date.now();
  const fileUrl = `/api/evidence/digital/${newId}/file`;
  await execute(db, `UPDATE digital_evidence SET url = ? WHERE id = ?`, fileUrl, newId);

  await execute(
    db,
    `INSERT INTO digital_evidence_custody (evidence_id, action, actor_name, actor_id, notes)
     VALUES (?, 'uploaded', ?, ?, ?)`,
    newId,
    userName,
    userId,
    `Initial file upload: ${filename}`,
  ).catch(() => {});

  return c.json({
    item: {
      id: newId,
      filename,
      original_filename: filename,
      evidence_type: evidenceType,
      mime_type: mimeType,
      file_size: fileSize,
      status: 'pending_review',
      case_id: caseId,
      call_id: callId,
      officer_id: userId,
      officer_name: userName,
      uploaded_by: userId,
      uploaded_by_name: userName,
      r2_key: r2Key,
      url: fileUrl,
      description,
      created_at: new Date().toISOString(),
    },
  });
});

// GET /digital/file/* — stream by R2 key (legacy stored URLs)
evidence.get('/digital/file/*', async (c): Promise<Response> => {
  const user = c.get('user') as { id?: number } | undefined;
  if (!user) return c.json({ error: 'Authentication required' }, 401);
  const r2Key = decodeURIComponent(c.req.path.replace(/^.*\/file\//, ''));
  return streamDigitalEvidenceFile(c, r2Key);
});

// GET /digital/:id/file — stream evidence media file by row id
evidence.get('/digital/:id/file', async (c): Promise<Response> => {
  const user = c.get('user') as { id?: number } | undefined;
  if (!user) return c.json({ error: 'Authentication required' }, 401);
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
  const db = getDb(c.env);
  await ensureDigitalEvidenceTables(db);
  const row = await queryFirst<{ r2_key: string | null; mime_type: string | null; filename: string | null; original_filename: string | null }>(
    db,
    `SELECT r2_key, mime_type, filename, original_filename FROM digital_evidence WHERE id = ?`,
    id,
  );
  if (!row?.r2_key) return c.json({ error: 'Not found' }, 404);
  return streamDigitalEvidenceFile(c, row.r2_key, row.mime_type, row.original_filename || row.filename);
});

// GET /digital/:id/custody — get chain of custody log entries
evidence.get('/digital/:id/custody', async (c): Promise<Response> => {
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
  const db = getDb(c.env);
  await ensureDigitalEvidenceTables(db);
  const rows = await query<Record<string, unknown>>(
    db,
    `SELECT id, evidence_id, action, actor_name, actor_id, timestamp, notes
       FROM digital_evidence_custody
      WHERE evidence_id = ?
      ORDER BY id ASC`,
    id,
  ).catch(() => [] as Record<string, unknown>[]);
  return c.json(rows);
});

// POST /digital/:id/seal — seal evidence item
evidence.post('/digital/:id/seal', async (c): Promise<Response> => {
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
  const user = c.get('user') as { id?: number; full_name?: string; username?: string } | undefined;
  const userId = (c.get('userId') as number | undefined) ?? user?.id ?? null;
  const userName = user?.full_name ?? user?.username ?? 'Officer';

  const db = getDb(c.env);
  await ensureDigitalEvidenceTables(db);

  const existing = await queryFirst<{ id: number }>(db, 'SELECT id FROM digital_evidence WHERE id = ?', id);
  if (!existing) return c.json({ error: 'Evidence not found' }, 404);

  const r = await execute(
    db,
    `UPDATE digital_evidence SET status = 'sealed', updated_at = datetime('now') WHERE id = ?`,
    id,
  );
  if (!r.meta.changes) return c.json({ error: 'Evidence not found' }, 404);

  await execute(
    db,
    `INSERT INTO digital_evidence_custody (evidence_id, action, actor_name, actor_id, notes)
     VALUES (?, 'sealed', ?, ?, 'Evidence sealed by authorized officer')`,
    id,
    userName,
    userId,
  ).catch(() => {});

  return c.json({ success: true, status: 'sealed' });
});

// POST /digital/:id/release — release sealed evidence item
evidence.post('/digital/:id/release', async (c): Promise<Response> => {
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
  const user = c.get('user') as { id?: number; full_name?: string; username?: string } | undefined;
  const userId = (c.get('userId') as number | undefined) ?? user?.id ?? null;
  const userName = user?.full_name ?? user?.username ?? 'Officer';

  const db = getDb(c.env);
  await ensureDigitalEvidenceTables(db);

  const existing = await queryFirst<{ id: number }>(db, 'SELECT id FROM digital_evidence WHERE id = ?', id);
  if (!existing) return c.json({ error: 'Evidence not found' }, 404);

  const r = await execute(
    db,
    `UPDATE digital_evidence SET status = 'released', updated_at = datetime('now') WHERE id = ?`,
    id,
  );
  if (!r.meta.changes) return c.json({ error: 'Evidence not found' }, 404);

  await execute(
    db,
    `INSERT INTO digital_evidence_custody (evidence_id, action, actor_name, actor_id, notes)
     VALUES (?, 'released', ?, ?, 'Evidence released by authorized officer')`,
    id,
    userName,
    userId,
  ).catch(() => {});

  return c.json({ success: true, status: 'released' });
});

// GET /verify/:sha256 — confirm a (full or 16-char prefix) hash was filed.
evidence.get('/verify/:sha256', async (c): Promise<Response> => {
  const db = getDb(c.env);
  await ensureTable(db);
  const sha = c.req.param('sha256');
  // D1 caps LIKE patterns at 50 chars — a full 64-char SHA-256 plus '%' would
  // throw and the catch would report {verified:false} for genuinely-filed
  // evidence. Full hashes match exactly; the LIKE prefix path is only for the
  // short (16-char) prefix form.
  const match = await queryFirst<Record<string, unknown>>(
    db,
    sha.length > 48
      ? `SELECT id, evidence_number, sha256, classification, captured_at
           FROM evidence_manifests WHERE sha256 = ? ORDER BY id DESC LIMIT 1`
      : `SELECT id, evidence_number, sha256, classification, captured_at
           FROM evidence_manifests WHERE sha256 = ? OR sha256 LIKE ? ORDER BY id DESC LIMIT 1`,
    ...(sha.length > 48 ? [sha] : [sha, `${sha}%`]),
  ).catch(() => null);
  return c.json({ verified: !!match, match: match ?? null });
});

export default evidence;

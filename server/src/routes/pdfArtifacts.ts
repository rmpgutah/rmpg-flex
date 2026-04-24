// ============================================================
// PDF v2 Artifacts Route
//
// Stores rendered PDFs produced by the v2 engine and attaches them
// to case/incident/warrant/evidence records. The blob is written
// to disk at <uploads>/pdf/<form_type>/<YYYY>/<MM>/<sha256>.pdf
// (content-addressed, so identical bytes dedupe automatically);
// only the blob_path + SHA-256 hash are stored in SQLite.
// ============================================================

import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import multer from 'multer';
import { getDb } from '../models/database';
import { authenticateToken } from '../middleware/auth';
import { apiRateLimit } from '../middleware/rateLimiter';
import { auditLog } from '../utils/auditLogger';

const VALID_RECORD_TYPES = new Set(['case', 'incident', 'warrant', 'evidence']);

function uploadsDir(): string {
  return process.env.RMPG_UPLOADS_DIR
    ? path.join(process.env.RMPG_UPLOADS_DIR, 'pdf')
    : path.join(process.cwd(), 'uploads', 'pdf');
}

// Use multer.memoryStorage so we can hash before writing to disk
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB cap
});

const router = Router();
router.use(apiRateLimit);
router.use(authenticateToken);

router.post('/', upload.single('pdf'), (req: Request, res: Response) => {
  const { form_type, form_version, record_type, record_id, title } = req.body ?? {};
  if (!form_type || !form_version || !record_type || !record_id) {
    return res.status(400).json({ error: 'form_type, form_version, record_type, record_id required' });
  }
  if (!VALID_RECORD_TYPES.has(record_type)) {
    return res.status(400).json({ error: 'invalid record_type' });
  }
  if (!req.file) {
    return res.status(400).json({ error: 'pdf file required (field name: pdf)' });
  }

  const buffer = req.file.buffer;
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  // form_type comes from req.body — restrict to safe chars before joining
  // to prevent path traversal, then verify the final path stays inside
  // uploadsDir (CodeQL js/http-to-file-access #2759).
  const safeFormType = String(form_type).replace(/[^a-z0-9_-]/gi, '').slice(0, 64);
  if (!safeFormType) {
    return res.status(400).json({ error: 'invalid form_type' });
  }
  const root = uploadsDir();
  const dir = path.join(root, safeFormType, yyyy, mm);
  const resolvedDir = path.resolve(dir);
  if (!resolvedDir.startsWith(path.resolve(root) + path.sep)) {
    return res.status(400).json({ error: 'invalid path' });
  }
  fs.mkdirSync(resolvedDir, { recursive: true });
  const blobPath = path.join(resolvedDir, `${sha256}.pdf`);
  // Atomic create-if-missing — the prior fs.existsSync + fs.writeFileSync
  // pattern was a TOCTOU race (CodeQL js/file-system-race #2760). Using
  // wx fails if the file exists, which we treat as "already deduped".
  try {
    fs.writeFileSync(blobPath, buffer, { flag: 'wx' });
  } catch (err: any) {
    if (err?.code !== 'EEXIST') throw err;
  }

  const db = getDb();
  const userId = req.user?.userId ?? 0;
  const result = db.prepare(`
    INSERT INTO pdf_artifacts
      (form_type, form_version, record_type, record_id, blob_path, sha256, created_at, created_by, title)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    form_type, form_version, record_type, Number(record_id),
    blobPath, sha256, now.toISOString(), userId, title ?? null,
  );
  const id = result.lastInsertRowid as number;

  auditLog(req, 'pdf_artifact_created', 'pdf_artifact', id,
    `form=${form_type} record=${record_type}:${record_id} sha=${sha256.slice(0, 12)}`);

  return res.json({ success: true, id, sha256, blob_path: blobPath });
});

router.get('/', (req: Request, res: Response) => {
  const { record_type, record_id } = req.query;
  if (!record_type || !record_id) {
    return res.status(400).json({ error: 'record_type and record_id required' });
  }
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, form_type, form_version, record_type, record_id,
           blob_path, sha256, created_at, created_by, title
    FROM pdf_artifacts
    WHERE record_type = ? AND record_id = ?
    ORDER BY created_at DESC
  `).all(String(record_type), Number(record_id));
  return res.json(rows);
});

router.get('/:id/blob', (req: Request, res: Response) => {
  const db = getDb();
  const row = db.prepare('SELECT blob_path FROM pdf_artifacts WHERE id = ?')
    .get(Number(req.params.id)) as { blob_path?: string } | undefined;
  if (!row?.blob_path || !fs.existsSync(row.blob_path)) {
    return res.status(404).json({ error: 'not found' });
  }
  // Security: ensure resolved path is within expected uploads directory
  const baseDir = path.resolve(process.cwd(), 'uploads', 'pdf');
  const resolved = path.resolve(row.blob_path);
  if (!resolved.startsWith(baseDir + path.sep) && resolved !== baseDir) {
    return res.status(403).json({ error: 'forbidden' });
  }
  res.setHeader('Content-Type', 'application/pdf');
  return fs.createReadStream(resolved).pipe(res);
});

export default router;

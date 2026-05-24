// ============================================================
// business_photos routes (Task 1.15)
// Multi-photo support for businesses (storefront / interior /
// exterior / parking / other reference photos) backed by a
// multipart upload pipeline. Files land in
//   <RMPG_UPLOADS_DIR>/business-photos/<uuid>.<ext>
// and the relative URL is stored in the business_photos.url
// column for serving via the static /uploads middleware.
// ============================================================

import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { paramStr } from '../utils/reqHelpers';
import { auditLog } from '../utils/auditLogger';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VALID_CATEGORIES = ['storefront', 'interior', 'exterior', 'parking', 'other'];
const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

function getUploadsRoot(): string {
  return process.env.RMPG_UPLOADS_DIR || path.resolve(__dirname, '../../uploads');
}

function getPhotoDir(): string {
  const dir = path.join(getUploadsRoot(), 'business-photos');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, getPhotoDir()),
  filename: (_req, file, cb) => {
    let ext = path.extname(file.originalname || '').toLowerCase();
    if (ext === '.jpg') ext = '.jpg';
    if (!ext) {
      // Fall back to mime-derived extension
      if (file.mimetype === 'image/png') ext = '.png';
      else if (file.mimetype === 'image/jpeg') ext = '.jpg';
      else if (file.mimetype === 'image/webp') ext = '.webp';
    }
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_SIZE, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Invalid file type — must be PNG, JPEG, or WEBP'));
  },
});

const router = Router();
router.use(authenticateToken);

// GET /api/business-photos/:businessId — list photos newest first
router.get('/:businessId',
  requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer', 'client_viewer', 'human_resources', 'contract_manager'),
  (req: Request, res: Response) => {
    try {
      const businessId = parseInt(paramStr(req.params.businessId as string | string[] | undefined), 10);
      const db = getDb();
      const rows = db.prepare(
        'SELECT * FROM business_photos WHERE business_id = ? ORDER BY uploaded_at DESC, id DESC',
      ).all(businessId);
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to load business photos: ' + err.message });
    }
  },
);

// POST /api/business-photos — multipart upload
// Wraps multer in a custom invoker so file-validation / size errors can be
// turned into 400 responses (multer's default would surface them as 500
// via the global error handler).
router.post('/',
  requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'),
  (req: Request, res: Response, next: NextFunction) => {
    upload.single('photo')(req, res, (err: any) => {
      if (err) {
        return res.status(400).json({ error: err.message || 'Upload rejected' });
      }
      next();
    });
  },
  (req: Request, res: Response) => {
    // Path-traversal guard for the cleanup path: even though multer's
    // diskStorage builds req.file.path from a crypto.randomUUID(), the
    // filename callback derives the extension from the client-supplied
    // originalname/mimetype. Re-anchor to the photo directory and refuse
    // to unlink anything that resolves outside it (CodeQL js/path-injection).
    const photoDirResolved = path.resolve(getPhotoDir());
    const safeUnlink = (p: string) => {
      const resolved = path.resolve(photoDirResolved, path.basename(p));
      if (resolved.startsWith(photoDirResolved + path.sep)) {
        try { fs.unlinkSync(resolved); } catch { /* swallow */ }
      }
    };
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'photo file is required' });
      }
      const { business_id, category, caption } = req.body;
      const cleanup = () => safeUnlink(req.file!.path);

      if (!business_id) {
        cleanup();
        return res.status(400).json({ error: 'business_id required' });
      }
      if (!category || !VALID_CATEGORIES.includes(String(category))) {
        cleanup();
        return res.status(400).json({ error: 'Invalid category', allowed: VALID_CATEGORIES });
      }

      const db = getDb();
      const biz = db.prepare('SELECT id FROM businesses WHERE id = ?').get(business_id);
      if (!biz) {
        cleanup();
        return res.status(404).json({ error: 'Business not found' });
      }

      const url = `/uploads/business-photos/${path.basename(req.file.path)}`;
      const userId = (req as any).user?.userId ?? null;
      const result = db.prepare(`
        INSERT INTO business_photos (business_id, url, caption, category, uploaded_by)
        VALUES (?, ?, ?, ?, ?)
      `).run(parseInt(String(business_id), 10), url, caption || null, String(category), userId);
      const row = db.prepare('SELECT * FROM business_photos WHERE id = ?').get(result.lastInsertRowid);
      auditLog(req, 'CREATE', 'business_photo', Number(result.lastInsertRowid), null, row);
      return res.status(201).json(row);
    } catch (err: any) {
      if (req.file) safeUnlink(req.file.path);
      return res.status(500).json({ error: 'Failed to upload photo: ' + err.message });
    }
  },
);

// DELETE /api/business-photos/:photoId — removes row + on-disk file
router.delete('/:photoId',
  requireRole('admin', 'manager', 'supervisor'),
  (req: Request, res: Response) => {
    try {
      const id = parseInt(paramStr(req.params.photoId as string | string[] | undefined), 10);
      const db = getDb();
      const before = db.prepare('SELECT * FROM business_photos WHERE id = ?').get(id) as any;
      if (!before) {
        res.status(404).json({ error: 'Photo not found' });
        return;
      }
      // Resolve filesystem path from stored url. url looks like
      //   /uploads/business-photos/<uuid>.png
      // We strip the /uploads/ prefix and rejoin under the configured root.
      const relative = String(before.url || '').replace(/^\/uploads\//, '');
      const filePath = path.join(getUploadsRoot(), relative);
      // Path-traversal guard: ensure the resolved path stays inside the
      // business-photos directory.
      const photoDir = path.resolve(getPhotoDir());
      const resolved = path.resolve(filePath);
      if (resolved === photoDir || resolved.startsWith(photoDir + path.sep)) {
        try { if (fs.existsSync(resolved)) fs.unlinkSync(resolved); } catch { /* swallow */ }
      }
      db.prepare('DELETE FROM business_photos WHERE id = ?').run(id);
      auditLog(req, 'DELETE', 'business_photo', id, before, null);
      res.status(204).send();
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to delete photo: ' + err.message });
    }
  },
);

export default router;

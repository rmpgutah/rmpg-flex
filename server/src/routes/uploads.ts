import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import { getDb } from '../models/database';
import { authenticateToken, requireRole, type JwtPayload } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimiter';
import { validateParamId } from '../middleware/sanitize';
import { auditLog } from '../utils/auditLogger';
import { broadcast } from '../utils/websocket';
import config from '../config';

// Rate limiter for file uploads — prevent abuse/DoS via large uploads
const uploadRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  maxRequests: 30,           // 30 uploads per 5 minutes per user
  keyGenerator: (req) => `upload:${req.user?.userId || req.ip || 'unknown'}`,
  message: 'Too many file uploads. Please try again later.',
});

/** Sanitize a filename for safe use in Content-Disposition headers.
 *  Strips CRLF, null bytes, double quotes, and non-printable chars
 *  to prevent header injection / response splitting attacks. */
function safeContentDisposition(type: 'inline' | 'attachment', filename: string): string {
  const safe = filename.replace(/[\r\n\0"]/g, '_').replace(/[^\x20-\x7E]/g, '_');
  return `${type}; filename="${safe}"`;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Use RMPG_UPLOADS_DIR env var if provided (set by Electron desktop app for
// writable user-data location), otherwise fall back to project-relative path
const UPLOAD_DIR = process.env.RMPG_UPLOADS_DIR || path.resolve(__dirname, '../../uploads');

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

/** Resolve file path and verify it stays within UPLOAD_DIR to prevent path traversal.
 *  Uses fs.realpathSync on the parent dir to defeat symlink-based escapes. */
function safeFilePath(relativePath: string): string | null {
  // Block null bytes which can truncate paths in some OS APIs
  if (relativePath.includes('\0')) return null;
  const resolved = path.resolve(UPLOAD_DIR, relativePath);
  const rel = path.relative(UPLOAD_DIR, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  // For existing files, verify the real path (after symlink resolution) stays within UPLOAD_DIR
  try {
    const realUploadDir = fs.realpathSync(UPLOAD_DIR);
    const parentDir = path.dirname(resolved);
    if (fs.existsSync(parentDir)) {
      const realParent = fs.realpathSync(parentDir);
      if (!realParent.startsWith(realUploadDir)) return null;
    }
  } catch { /* parent doesn't exist yet — will be created during upload */ }
  return resolved;
}

// Allowed MIME types
const ALLOWED_TYPES = new Set([
  // Images
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/tiff',
  // Documents
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain', 'text/csv',
  // Video
  'video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm', 'video/x-matroska',
  // Audio
  'audio/mpeg', 'audio/wav', 'audio/ogg',
]);

// Magic bytes for file type verification — prevents MIME spoofing
// Maps file extensions to their expected magic byte signatures
const MAGIC_BYTES: Record<string, { offset: number; bytes: number[] }[]> = {
  '.jpg':  [{ offset: 0, bytes: [0xFF, 0xD8, 0xFF] }],
  '.jpeg': [{ offset: 0, bytes: [0xFF, 0xD8, 0xFF] }],
  '.png':  [{ offset: 0, bytes: [0x89, 0x50, 0x4E, 0x47] }],
  '.gif':  [{ offset: 0, bytes: [0x47, 0x49, 0x46, 0x38] }],
  '.pdf':  [{ offset: 0, bytes: [0x25, 0x50, 0x44, 0x46] }],
  '.webp': [{ offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] }],
  '.mp4':  [{ offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] }],
  '.zip':  [{ offset: 0, bytes: [0x50, 0x4B, 0x03, 0x04] }],
  '.docx': [{ offset: 0, bytes: [0x50, 0x4B, 0x03, 0x04] }], // OOXML is a ZIP
  '.xlsx': [{ offset: 0, bytes: [0x50, 0x4B, 0x03, 0x04] }],
  '.doc':  [{ offset: 0, bytes: [0xD0, 0xCF, 0x11, 0xE0] }], // OLE2
  '.xls':  [{ offset: 0, bytes: [0xD0, 0xCF, 0x11, 0xE0] }],
  '.wav':  [{ offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] }],
  '.mp3':  [{ offset: 0, bytes: [0xFF, 0xFB] }, { offset: 0, bytes: [0x49, 0x44, 0x33] }], // MPEG frame or ID3
  '.bmp':  [{ offset: 0, bytes: [0x42, 0x4D] }],
  '.tiff': [{ offset: 0, bytes: [0x49, 0x49, 0x2A, 0x00] }, { offset: 0, bytes: [0x4D, 0x4D, 0x00, 0x2A] }], // Little-endian or Big-endian TIFF
  '.tif':  [{ offset: 0, bytes: [0x49, 0x49, 0x2A, 0x00] }, { offset: 0, bytes: [0x4D, 0x4D, 0x00, 0x2A] }],
  '.webm': [{ offset: 0, bytes: [0x1A, 0x45, 0xDF, 0xA3] }], // EBML/Matroska
  '.mkv':  [{ offset: 0, bytes: [0x1A, 0x45, 0xDF, 0xA3] }],
  '.mov':  [{ offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] }, { offset: 4, bytes: [0x6D, 0x6F, 0x6F, 0x76] }], // ftyp or moov atom
  '.avi':  [{ offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] }], // RIFF container (same as WAV)
  '.ogg':  [{ offset: 0, bytes: [0x4F, 0x67, 0x67, 0x53] }], // OggS
};

/** Verify that a file's actual content matches its claimed extension */
// Extensions that are plain text — no magic bytes to verify
const TEXT_EXTENSIONS = new Set(['.txt', '.csv']);

function verifyMagicBytes(filePath: string, ext: string): boolean {
  const lowerExt = ext.toLowerCase();
  // Plain text files have no magic bytes — allow if extension is in the text set
  if (TEXT_EXTENSIONS.has(lowerExt)) return true;
  const signatures = MAGIC_BYTES[lowerExt];
  if (!signatures) {
    // Unknown extension with no known signature — reject for safety
    console.warn(`[Uploads] Rejected file with unrecognized extension: ${ext}`);
    return false;
  }
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(16);
    fs.readSync(fd, buf, 0, 16, 0);
    fs.closeSync(fd);
    return signatures.some(sig =>
      sig.bytes.every((b, i) => buf[sig.offset + i] === b)
    );
  } catch {
    return false; // Can't read file — fail closed
  }
}

const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB

// Configure multer storage
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    // Organize by year/month subdirectories
    const now = new Date();
    const subDir = path.join(UPLOAD_DIR, `${now.getFullYear()}`, String(now.getMonth() + 1).padStart(2, '0'));
    if (!fs.existsSync(subDir)) {
      fs.mkdirSync(subDir, { recursive: true });
    }
    cb(null, subDir);
  },
  filename: (_req, file, cb) => {
    // Generate a unique filename while preserving extension
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueName = `${crypto.randomUUID()}${ext}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} is not allowed`));
    }
  },
});

// ─── HMAC-based file access signing (session-independent, 24h TTL) ────
// Generates a signature that authorises read-only access to a single file
// without requiring a valid JWT session.  This prevents TOKEN_EXPIRED
// errors when viewing photos/documents across sessions or computers.

function signFileAccess(fileId: string, ttlSeconds = 86400): { sig: string; exp: number } {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const data = `file:${fileId}:${exp}`;
  const sig = crypto.createHmac('sha256', config.jwt.secret).update(data).digest('hex');
  return { sig, exp };
}

function verifyFileAccess(fileId: string, sig: string, exp: number): boolean {
  if (Date.now() / 1000 > exp) return false;
  const data = `file:${fileId}:${exp}`;
  const expected = crypto.createHmac('sha256', config.jwt.secret).update(data).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

// Auth middleware that accepts:
//   1. HMAC file signature (?sig=...&exp=...) — preferred, session-independent
//   2. Authorization: Bearer <jwt>             — standard header auth
//   3. ?token=<jwt>                            — legacy query-param auth for img/iframe/a
function authenticateTokenOrQuery(req: Request, res: Response, next: NextFunction): void {
  // ── 1. Check for HMAC file signature (longest-lived, most reliable) ──
  const sigParam = typeof req.query.sig === 'string' ? req.query.sig : null;
  const expParam = typeof req.query.exp === 'string' ? parseInt(req.query.exp, 10) : null;

  if (sigParam && expParam) {
    const fileId = req.params.fileId as string;
    if (fileId && verifyFileAccess(fileId, sigParam, expParam)) {
      // Signed access verified — minimal user context for read-only serving
      req.user = { userId: 0, username: 'signed-access', role: 'viewer', fullName: 'Signed Access' };
      next();
      return;
    }
    res.status(403).json({ error: 'Invalid or expired file signature' });
    return;
  }

  // ── 2. Standard Authorization header ──
  const authHeader = req.headers['authorization'];
  const headerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;

  // ── 3. Legacy ?token= query parameter (for img/iframe/a tags) ──
  const queryToken = typeof req.query.token === 'string' ? req.query.token : null;

  const token = headerToken || queryToken;

  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  try {
    // Verify with iss/aud claims for consistency with main authenticateToken
    const JWT_VERIFY_OPTIONS = { issuer: 'rmpg-flex', audience: 'rmpg-flex-api' };
    let decoded: JwtPayload;
    try {
      decoded = jwt.verify(token, config.jwt.secret, JWT_VERIFY_OPTIONS) as JwtPayload;
    } catch (strictErr: any) {
      // Legacy token backward compat — enforce strict validation after 2026-04-15
      if (strictErr.message?.includes('jwt issuer invalid') || strictErr.message?.includes('jwt audience invalid')) {
        decoded = jwt.verify(token, config.jwt.secret) as JwtPayload;
      } else {
        throw strictErr;
      }
    }
    // Block refresh and mfa_pending tokens — only access tokens should serve files
    if (decoded.type === 'refresh' || decoded.type === 'mfa_pending') {
      res.status(403).json({ error: 'Invalid token type' });
      return;
    }
    req.user = decoded;
    next();
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') {
      res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
    } else {
      res.status(403).json({ error: 'Invalid or expired token' });
    }
  }
}

const router = Router();

// ─── GET /api/uploads/entity/:type/:id ─── List files for entity ───
// (Must be before /:fileId catch-all to avoid route conflict)
// Each attachment now includes `access_sig` + `access_exp` for session-independent file URLs.
router.get('/entity/:type/:id', validateParamId, authenticateToken, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const attachments = db.prepare(`
      SELECT a.*, u.full_name as uploader_name
      FROM attachments a
      LEFT JOIN users u ON a.uploaded_by = u.id
      WHERE a.entity_type = ? AND a.entity_id = ?
      ORDER BY a.created_at DESC
    `).all(String(req.params.type), parseInt(String(req.params.id), 10));

    // Enrich each attachment with an HMAC-signed access token (24h TTL)
    const enriched = (attachments as any[]).map((att) => {
      const { sig, exp } = signFileAccess(att.file_id);
      return { ...att, access_sig: sig, access_exp: exp };
    });

    res.json(enriched);
  } catch (error: any) {
    console.error('List attachments error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/uploads/sign/:fileId ─── Get a fresh signed URL for a file ───
// Used by the client to get a new signature when the previous one expires
// (e.g. a page has been open > 24h and the user clicks download)
router.get('/sign/:fileId', authenticateToken, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const attachment = db.prepare('SELECT file_id FROM attachments WHERE file_id = ?').get(req.params.fileId) as any;

    if (!attachment) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    const { sig, exp } = signFileAccess(req.params.fileId as string);
    res.json({ sig, exp, file_id: req.params.fileId });
  } catch (error: any) {
    console.error('Sign file error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// File-serving routes use flexible auth (header OR query param)
// This allows <img src="...">, <iframe src="...">, and <a href="..."> to work

// ─── GET /api/uploads/:fileId ─── Serve/inline a file ───
router.get('/:fileId', authenticateTokenOrQuery, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const attachment = db.prepare('SELECT * FROM attachments WHERE file_id = ?').get(req.params.fileId) as any;

    if (!attachment) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    const filePath = safeFilePath(attachment.file_path);
    if (!filePath) { res.status(403).json({ error: 'Invalid file path' }); return; }
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'File not found on disk' });
      return;
    }

    // Set appropriate headers
    res.set('Content-Type', attachment.mime_type);
    res.set('Content-Disposition', safeContentDisposition('inline', attachment.original_name));
    res.set('Content-Length', String(attachment.file_size));
    // Allow browser caching for 5 minutes
    res.set('Cache-Control', 'private, max-age=300');

    res.sendFile(filePath);
  } catch (error: any) {
    console.error('Download error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Download failed' });
  }
});

// ─── GET /api/uploads/:fileId/download ─── Force download ───
router.get('/:fileId/download', authenticateTokenOrQuery, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const attachment = db.prepare('SELECT * FROM attachments WHERE file_id = ?').get(req.params.fileId) as any;

    if (!attachment) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    const filePath = safeFilePath(attachment.file_path);
    if (!filePath) { res.status(403).json({ error: 'Invalid file path' }); return; }
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'File not found on disk' });
      return;
    }

    res.set('Content-Type', 'application/octet-stream');
    res.set('Content-Disposition', safeContentDisposition('attachment', attachment.original_name));
    res.sendFile(filePath);
  } catch (error: any) {
    console.error('Download error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Download failed' });
  }
});

// ─── GET /api/uploads/:fileId/thumbnail ─── Serve image thumbnail (same as inline but with aggressive caching) ───
router.get('/:fileId/thumbnail', authenticateTokenOrQuery, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const attachment = db.prepare('SELECT * FROM attachments WHERE file_id = ?').get(req.params.fileId) as any;

    if (!attachment) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    // Only serve images as thumbnails
    if (!attachment.mime_type.startsWith('image/')) {
      res.status(400).json({ error: 'Not an image' });
      return;
    }

    const filePath = safeFilePath(attachment.file_path);
    if (!filePath) { res.status(403).json({ error: 'Invalid file path' }); return; }
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'File not found on disk' });
      return;
    }

    res.set('Content-Type', attachment.mime_type);
    res.set('Content-Disposition', safeContentDisposition('inline', attachment.original_name));
    res.set('Content-Length', String(attachment.file_size));
    res.set('Cache-Control', 'private, max-age=600');

    res.sendFile(filePath);
  } catch (error: any) {
    console.error('Thumbnail error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Thumbnail failed' });
  }
});

// ── All routes below require standard header auth ──
router.use(authenticateToken);

// ─── POST /api/uploads ─── Upload one or more files ───
router.post('/', uploadRateLimit, upload.array('files', 10), (req: Request, res: Response) => {
  try {
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      res.status(400).json({ error: 'No files provided' });
      return;
    }

    const { entity_type, entity_id } = req.body;
    const db = getDb();
    const results: any[] = [];

    for (const file of files) {
      // Verify magic bytes match claimed file type — prevents MIME spoofing attacks
      const ext = path.extname(file.originalname).toLowerCase();
      if (!verifyMagicBytes(file.path, ext)) {
        // Delete the suspicious file immediately
        try { fs.unlinkSync(file.path); } catch { /* best effort */ }
        console.warn(`[Upload] BLOCKED — magic byte mismatch for ${file.originalname} (ext=${ext}) from user ${req.user!.userId}`);
        auditLog(req, 'BLOCK', 'attachment', 0, `Blocked upload: ${file.originalname} — magic byte mismatch (ext=${ext})`);
        res.status(400).json({ error: `File "${file.originalname}" content does not match its file type` });
        return;
      }

      // Store path relative to uploads dir
      const relativePath = path.relative(UPLOAD_DIR, file.path);

      const result = db.prepare(`
        INSERT INTO attachments (
          file_id, original_name, stored_name, file_path, mime_type, file_size,
          entity_type, entity_id, uploaded_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        crypto.randomUUID(),
        file.originalname,
        file.filename,
        relativePath,
        file.mimetype,
        file.size,
        entity_type || null,
        entity_id ? parseInt(entity_id, 10) : null,
        req.user!.userId,
      );

      const attachment = db.prepare('SELECT * FROM attachments WHERE id = ?').get(Number(result.lastInsertRowid));
      if (attachment) results.push(attachment);
    }

    // Log the upload
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'file_uploaded', ?, ?, ?, ?)
    `).run(
      req.user!.userId,
      entity_type || 'attachment',
      entity_id ? parseInt(entity_id, 10) : null,
      `Uploaded ${files.length} file(s): ${files.map(f => f.originalname).join(', ')}`,
      req.ip || 'unknown',
    );

    broadcast('records', 'upload:created', { count: results.length, entity_type, entity_id });
    res.status(201).json(results);
  } catch (error: any) {
    console.error('Upload error:', error?.message || 'Unknown error');
    if (error.message?.includes('not allowed')) {
      res.status(400).json({ error: 'File type not allowed' });
    } else {
      res.status(500).json({ error: 'Upload failed' });
    }
  }
});

// ─── PUT /api/uploads/:fileId/link ─── Link file to entity ───
router.put('/:fileId/link', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { entity_type, entity_id } = req.body;

    if (!entity_type || !entity_id) {
      res.status(400).json({ error: 'entity_type and entity_id are required' });
      return;
    }

    const result = db.prepare(`
      UPDATE attachments SET entity_type = ?, entity_id = ? WHERE file_id = ?
    `).run(entity_type, parseInt(entity_id, 10), req.params.fileId);

    if (result.changes === 0) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    const attachment = db.prepare('SELECT * FROM attachments WHERE file_id = ?').get(req.params.fileId);

    // Audit log: file reassignment
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'file_linked', 'attachment', ?, ?, ?)
    `).run(
      req.user!.userId,
      req.params.fileId,
      `Linked file to ${entity_type} #${entity_id}`,
      req.ip || 'unknown',
    );

    res.json(attachment);
  } catch (error: any) {
    console.error('Link attachment error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── DELETE /api/uploads/:fileId ─── Delete a file ───
router.delete('/:fileId', authenticateToken, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const attachment = db.prepare('SELECT * FROM attachments WHERE file_id = ?').get(req.params.fileId) as any;

    if (!attachment) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    // Ownership check: only the uploader or admin/manager can delete files
    const userRole = req.user!.role;
    if (attachment.uploaded_by !== req.user!.userId && !['admin', 'manager'].includes(userRole)) {
      res.status(403).json({ error: 'Not authorized to delete this file' });
      return;
    }

    // Delete file from disk (validate path to prevent traversal)
    const filePath = safeFilePath(attachment.file_path);
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    // Delete record
    db.prepare('DELETE FROM attachments WHERE file_id = ?').run(req.params.fileId);

    // Log deletion
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'file_deleted', ?, ?, ?, ?)
    `).run(
      req.user!.userId,
      attachment.entity_type || 'attachment',
      attachment.entity_id,
      `Deleted file: ${attachment.original_name}`,
      req.ip || 'unknown',
    );

    res.json({ message: 'File deleted' });
  } catch (error: any) {
    console.error('Delete attachment error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

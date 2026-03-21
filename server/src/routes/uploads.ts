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
import config from '../config';

// Rate limiter for file uploads — prevent abuse/DoS via large uploads
const uploadRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  maxRequests: 600,          // 600 per 5 min — supports chunked parallel uploads
  keyGenerator: (req) => `upload:${req.user?.userId || req.ip || 'unknown'}`,
  message: 'Too many file uploads. Please try again later.',
});

/** Sanitize a filename for safe use in Content-Disposition headers.
 *  Strips CRLF, null bytes, double quotes, backslashes, and non-printable chars
 *  to prevent header injection / response splitting attacks. */
function safeContentDisposition(type: 'inline' | 'attachment', filename: string): string {
  const safe = filename.replace(/[\r\n\0"\\]/g, '_').replace(/[^\x20-\x7E]/g, '_');
  return `${type}; filename="${safe}"`;
}

/** Set security headers on all file-serving responses to prevent uploaded files
 *  from being interpreted as executable content by the browser. */
function setFileSecurityHeaders(res: Response): void {
  res.set('X-Content-Type-Options', 'nosniff');
  // Prevent uploaded files from being framed (clickjacking via uploaded HTML)
  res.set('X-Frame-Options', 'DENY');
  // Strict CSP for served files — no scripts, no styles, images only from self
  res.set('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'none'; script-src 'none'");
  // Prevent served files from opening popups or navigating the parent window
  res.set('Cross-Origin-Resource-Policy', 'same-origin');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('X-Download-Options', 'noopen');
  res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
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
// NOTE: image/svg+xml is intentionally EXCLUDED — SVG files can contain embedded
// <script> tags and event handlers that execute in the browser context (XSS vector).
const ALLOWED_TYPES = new Set([
  // Images (raster only — no SVG)
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

// Dangerous extensions that must NEVER be uploaded regardless of MIME type
const BLOCKED_EXTENSIONS = new Set([
  '.svg', '.html', '.htm', '.xhtml', '.xml',    // XSS vectors
  '.js', '.mjs', '.cjs', '.ts', '.jsx', '.tsx',  // Script files
  '.php', '.phtml', '.phar', '.php5', '.php7',   // PHP variants
  '.asp', '.aspx', '.jsp', '.jspx',              // Server-side scripting
  '.cgi', '.wsgi', '.pl', '.py', '.rb',          // CGI/scripting
  '.sh', '.bash', '.zsh', '.fish',               // Shell scripts
  '.bat', '.cmd', '.ps1', '.vbs', '.vbe',        // Windows scripting
  '.exe', '.dll', '.so', '.dylib',               // Binary executables
  '.com', '.scr', '.msi', '.msp',                // Windows executables
  '.hta', '.htaccess', '.htpasswd',              // Server config / HTML apps
  '.shtml', '.shtm',                              // Server-side includes
]);

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
  let fd: number | null = null;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(16);
    fs.readSync(fd, buf, 0, 16, 0);
    return signatures.some(sig =>
      sig.bytes.every((b, i) => buf[sig.offset + i] === b)
    );
  } catch {
    return false; // Can't read file — fail closed
  } finally {
    if (fd !== null) try { fs.closeSync(fd); } catch { /* ignore close error */ }
  }
}

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

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
    // Sanitize originalname to strip path separators and null bytes that could
    // bypass path.extname() and create files with unexpected paths
    const safeName = file.originalname.replace(/[\0/\\]/g, '_');
    const ext = path.extname(safeName).toLowerCase();
    const uniqueName = `${crypto.randomUUID()}${ext}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    // Reject filenames with path traversal, null bytes, or executable extensions
    const name = file.originalname;
    if (name.includes('\0') || name.includes('../') || name.includes('..\\')) {
      cb(new Error('Invalid filename: path traversal detected'));
      return;
    }
    const ext = path.extname(name).toLowerCase();
    if (BLOCKED_EXTENSIONS.has(ext)) {
      cb(new Error(`File extension ${ext} is not allowed`));
      return;
    }
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

function signFileAccess(fileId: string, ttlSeconds = 86400): { sig: string; exp: number; nonce: string } {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  // Include a random nonce so each signature is unique — prevents signature caching/prediction
  const nonce = crypto.randomBytes(8).toString('hex');
  const data = `file:${fileId}:${exp}:${nonce}`;
  const sig = crypto.createHmac('sha256', config.jwt.secret).update(data).digest('hex');
  return { sig, exp, nonce };
}

function verifyFileAccess(fileId: string, sig: string, exp: number, nonce?: string): boolean {
  if (Date.now() / 1000 > exp) return false;
  // Support both new (with nonce) and legacy (without nonce) signatures during migration
  const data = nonce ? `file:${fileId}:${exp}:${nonce}` : `file:${fileId}:${exp}`;
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

  const nonceParam = typeof req.query.nonce === 'string' ? req.query.nonce : undefined;

  if (sigParam && expParam) {
    const fileId = req.params.fileId as string;
    if (fileId && verifyFileAccess(fileId, sigParam, expParam, nonceParam)) {
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
    const JWT_VERIFY_OPTIONS = { issuer: 'rmpg-flex', audience: 'rmpg-flex-api', algorithms: ['HS256'] as jwt.Algorithm[] };
    let decoded: JwtPayload;
    try {
      decoded = jwt.verify(token, config.jwt.secret, JWT_VERIFY_OPTIONS) as JwtPayload;
    } catch (strictErr: any) {
      // Legacy token backward compat — enforce strict validation after 2026-04-15
      if (strictErr.message?.includes('jwt issuer invalid') || strictErr.message?.includes('jwt audience invalid')) {
        if (Date.now() >= new Date('2026-04-15T00:00:00Z').getTime()) {
          res.status(401).json({ error: 'Token format no longer accepted. Please log in again.', code: 'TOKEN_LEGACY_REJECTED' });
          return;
        }
        decoded = jwt.verify(token, config.jwt.secret, { algorithms: ['HS256'] }) as JwtPayload;
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

// Rate limiter for file downloads — prevent bulk data exfiltration via file enumeration
const downloadRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  maxRequests: 500,          // 500 per 5 min — supports Range requests + bulk access
  keyGenerator: (req) => `download:${req.user?.userId || req.ip || 'unknown'}`,
  message: 'Too many file download requests. Please try again later.',
});

const router = Router();

// Validate fileId params as UUID format (all file IDs are crypto.randomUUID())
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
router.param('fileId', (req: Request, res: Response, next: Function) => {
  if (!UUID_RE.test(String(req.params.fileId))) {
    res.status(400).json({ error: 'Invalid file ID format' });
    return;
  }
  next();
});

// ─── GET /api/uploads/entity/:type/:id ─── List files for entity ───
// (Must be before /:fileId catch-all to avoid route conflict)
// Each attachment now includes `access_sig` + `access_exp` for session-independent file URLs.
router.get('/entity/:type/:id', validateParamId, authenticateToken, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const entityType = String(req.params.type);
    const entityId = parseInt(String(req.params.id), 10);

    // Validate entity type against allowlist
    const VALID_ENTITY_TYPES = ['incident', 'person', 'vehicle', 'case', 'evidence', 'warrant', 'citation', 'arrest', 'call', 'training', 'company_document'];
    if (!VALID_ENTITY_TYPES.includes(entityType)) {
      res.status(400).json({ error: 'Invalid entity type' });
      return;
    }

    // Role-based access: restrict sensitive entity attachments to privileged roles
    const privilegedRoles = ['admin', 'manager', 'supervisor'];
    const isPrivileged = privilegedRoles.includes(req.user!.role);
    const sensitiveTypes = ['evidence', 'warrant', 'arrest'];
    if (sensitiveTypes.includes(entityType) && !isPrivileged) {
      res.status(403).json({ error: 'Insufficient permissions to access these attachments' });
      return;
    }

    const attachments = db.prepare(`
      SELECT a.*, u.full_name as uploader_name
      FROM attachments a
      LEFT JOIN users u ON a.uploaded_by = u.id
      WHERE a.entity_type = ? AND a.entity_id = ?
      ORDER BY a.created_at DESC
    `).all(entityType, entityId);

    // Enrich each attachment with an HMAC-signed access token (24h TTL)
    const enriched = (attachments as any[]).map((att) => {
      const { sig, exp, nonce } = signFileAccess(att.file_id);
      return { ...att, access_sig: sig, access_exp: exp, access_nonce: nonce };
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
    const attachment = db.prepare(
      'SELECT file_id, entity_type, entity_id, uploaded_by FROM attachments WHERE file_id = ?'
    ).get(req.params.fileId) as any;

    if (!attachment) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    // Ownership check: only the uploader, admin, manager, or supervisor can sign files
    const userRole = req.user!.role;
    const isPrivileged = ['admin', 'manager', 'supervisor'].includes(userRole);
    if (attachment.uploaded_by !== req.user!.userId && !isPrivileged) {
      res.status(403).json({ error: 'Not authorized to access this file' });
      return;
    }

    const { sig, exp, nonce } = signFileAccess(req.params.fileId as string);
    res.json({ sig, exp, nonce, file_id: req.params.fileId });
  } catch (error: any) {
    console.error('Sign file error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// File-serving routes use flexible auth (header OR query param)
// This allows <img src="...">, <iframe src="...">, and <a href="..."> to work

/** Range-aware streaming file server (HTTP 206 Partial Content support). */
function serveFileWithRange(
  req: Request, res: Response,
  filePath: string, mimeType: string, disposition: 'inline' | 'attachment', originalName: string,
  cacheControl = 'private, max-age=300',
): void {
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  setFileSecurityHeaders(res);
  res.set('Accept-Ranges', 'bytes');
  res.set('Cache-Control', cacheControl);

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

    if (isNaN(start) || isNaN(end) || start < 0 || end >= fileSize || start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` });
      res.end();
      return;
    }

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Content-Length': end - start + 1,
      'Content-Type': mimeType,
      'Content-Disposition': safeContentDisposition(disposition, originalName),
    });
    const stream = fs.createReadStream(filePath, { start, end, highWaterMark: 1024 * 1024 });
    stream.on('error', (err) => { console.error('Stream error:', err?.message); res.destroy(); });
    stream.pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': mimeType,
      'Content-Disposition': safeContentDisposition(disposition, originalName),
    });
    const stream = fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 });
    stream.on('error', (err) => { console.error('Stream error:', err?.message); res.destroy(); });
    stream.pipe(res);
  }
}

// ─── GET /api/uploads/:fileId ─── Serve/inline (Range-aware) ───
router.get('/:fileId', downloadRateLimit, authenticateTokenOrQuery, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const attachment = db.prepare('SELECT * FROM attachments WHERE file_id = ?').get(req.params.fileId) as any;
    if (!attachment) { res.status(404).json({ error: 'File not found' }); return; }
    const filePath = safeFilePath(attachment.file_path);
    if (!filePath) { res.status(403).json({ error: 'Invalid file path' }); return; }
    if (!fs.existsSync(filePath)) { res.status(404).json({ error: 'File not found on disk' }); return; }
    const serveMime = ALLOWED_TYPES.has(attachment.mime_type) ? attachment.mime_type : 'application/octet-stream';
    serveFileWithRange(req, res, filePath, serveMime, 'inline', attachment.original_name);
  } catch (error: any) {
    console.error('Download error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Download failed' });
  }
});

// ─── GET /api/uploads/:fileId/download ─── Force download (Range-aware) ───
router.get('/:fileId/download', downloadRateLimit, authenticateTokenOrQuery, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const attachment = db.prepare('SELECT * FROM attachments WHERE file_id = ?').get(req.params.fileId) as any;
    if (!attachment) { res.status(404).json({ error: 'File not found' }); return; }
    const filePath = safeFilePath(attachment.file_path);
    if (!filePath) { res.status(403).json({ error: 'Invalid file path' }); return; }
    if (!fs.existsSync(filePath)) { res.status(404).json({ error: 'File not found on disk' }); return; }
    serveFileWithRange(req, res, filePath, 'application/octet-stream', 'attachment', attachment.original_name);
  } catch (error: any) {
    console.error('Download error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Download failed' });
  }
});

// ─── GET /api/uploads/:fileId/thumbnail ─── Thumbnail (Range-aware, immutable cache) ───
router.get('/:fileId/thumbnail', authenticateTokenOrQuery, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const attachment = db.prepare('SELECT * FROM attachments WHERE file_id = ?').get(req.params.fileId) as any;
    if (!attachment) { res.status(404).json({ error: 'File not found' }); return; }
    if (!attachment.mime_type.startsWith('image/')) { res.status(400).json({ error: 'Not an image' }); return; }
    const filePath = safeFilePath(attachment.file_path);
    if (!filePath) { res.status(403).json({ error: 'Invalid file path' }); return; }
    if (!fs.existsSync(filePath)) { res.status(404).json({ error: 'File not found on disk' }); return; }
    serveFileWithRange(req, res, filePath, attachment.mime_type, 'inline', attachment.original_name, 'private, max-age=600, immutable');
  } catch (error: any) {
    console.error('Thumbnail error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Thumbnail failed' });
  }
});

// ── All routes below require standard header auth ──
router.use(authenticateToken);

// Allowed entity types for file attachments — prevents data pollution
const ALLOWED_ENTITY_TYPES = new Set([
  'incident', 'person', 'vehicle', 'call', 'warrant', 'citation', 'arrest',
  'field_interview', 'trespass_order', 'case', 'code_enforcement', 'report',
  'fleet', 'patrol', 'serve', 'invoice', 'dar', 'personnel', 'bodycam',
  'company_document', 'evidence', 'training', 'attachment', 'crm_lead',
  'crm_proposal', 'connection', 'offender', 'property',
]);

// ─── Chunked Upload System (parallel workers, resumable) ────────────
const CHUNK_SIZE = 25 * 1024 * 1024; // 25MB chunks — less overhead, faster throughput
const CHUNK_DIR = path.join(UPLOAD_DIR, '.chunks');
if (!fs.existsSync(CHUNK_DIR)) fs.mkdirSync(CHUNK_DIR, { recursive: true });

const activeChunkedUploads = new Map<string, {
  userId: number; originalName: string; mimeType: string;
  totalSize: number; totalChunks: number; receivedChunks: Set<number>;
  entityType?: string; entityId?: number; createdAt: number;
}>();

// Purge stale uploads every 30 min
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [id, info] of activeChunkedUploads) {
    if (info.createdAt < cutoff) {
      activeChunkedUploads.delete(id);
      try { fs.rmSync(path.join(CHUNK_DIR, id), { recursive: true, force: true }); } catch { /* */ }
    }
  }
}, 30 * 60 * 1000);

const chunkStorage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const dir = path.join(CHUNK_DIR, req.params.uploadId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, _file, cb) => cb(null, `chunk-${req.params.chunkIndex}`),
});
const chunkUpload = multer({ storage: chunkStorage, limits: { fileSize: CHUNK_SIZE + 1024 } });

// POST /api/uploads/chunked/init
router.post('/chunked/init', uploadRateLimit, (req: Request, res: Response) => {
  try {
    const { fileName, fileSize, mimeType, totalChunks, entityType, entityId } = req.body;
    if (!fileName || !fileSize || !totalChunks) { res.status(400).json({ error: 'fileName, fileSize, totalChunks required' }); return; }
    if (fileSize > MAX_FILE_SIZE) { res.status(400).json({ error: 'File too large (max 100 MB)' }); return; }
    if (entityType && !ALLOWED_ENTITY_TYPES.has(entityType)) { res.status(400).json({ error: 'Invalid entity_type' }); return; }
    const ext = path.extname(fileName).toLowerCase();
    if (BLOCKED_EXTENSIONS.has(ext)) { res.status(400).json({ error: `File type "${ext}" not allowed` }); return; }
    if (mimeType && !ALLOWED_TYPES.has(mimeType)) { res.status(400).json({ error: `MIME type ${mimeType} not allowed` }); return; }

    const uploadId = crypto.randomUUID();
    activeChunkedUploads.set(uploadId, {
      userId: req.user!.userId, originalName: fileName, mimeType: mimeType || 'application/octet-stream',
      totalSize: fileSize, totalChunks, receivedChunks: new Set(),
      entityType: entityType || undefined, entityId: entityId ? parseInt(entityId, 10) : undefined,
      createdAt: Date.now(),
    });
    fs.mkdirSync(path.join(CHUNK_DIR, uploadId), { recursive: true });
    res.status(201).json({ uploadId, chunkSize: CHUNK_SIZE });
  } catch (error: any) { console.error('Chunked init error:', error?.message); res.status(500).json({ error: 'Failed to initialize upload' }); }
});

// POST /api/uploads/chunked/:uploadId/:chunkIndex
router.post('/chunked/:uploadId/:chunkIndex', uploadRateLimit, chunkUpload.single('chunk'), (req: Request, res: Response) => {
  try {
    const info = activeChunkedUploads.get(req.params.uploadId);
    if (!info) { res.status(404).json({ error: 'Upload session not found' }); return; }
    if (info.userId !== req.user!.userId) { res.status(403).json({ error: 'Not authorized' }); return; }
    const idx = parseInt(req.params.chunkIndex, 10);
    if (isNaN(idx) || idx < 0 || idx >= info.totalChunks) { res.status(400).json({ error: 'Invalid chunk index' }); return; }
    info.receivedChunks.add(idx);
    res.json({ received: idx, total: info.totalChunks, remaining: info.totalChunks - info.receivedChunks.size });
  } catch (error: any) { console.error('Chunk error:', error?.message); res.status(500).json({ error: 'Chunk upload failed' }); }
});

// POST /api/uploads/chunked/:uploadId/finalize
router.post('/chunked/:uploadId/finalize', (req: Request, res: Response) => {
  try {
    const info = activeChunkedUploads.get(req.params.uploadId);
    if (!info) { res.status(404).json({ error: 'Upload session not found' }); return; }
    if (info.userId !== req.user!.userId) { res.status(403).json({ error: 'Not authorized' }); return; }
    if (info.receivedChunks.size !== info.totalChunks) {
      const missing: number[] = [];
      for (let i = 0; i < info.totalChunks; i++) { if (!info.receivedChunks.has(i)) missing.push(i); }
      res.status(400).json({ error: 'Missing chunks', missing }); return;
    }
    const now = new Date();
    const destDir = path.join(UPLOAD_DIR, `${now.getFullYear()}`, String(now.getMonth() + 1).padStart(2, '0'));
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    const ext = path.extname(info.originalName).toLowerCase();
    const finalName = `${crypto.randomUUID()}${ext}`;
    const finalPath = path.join(destDir, finalName);
    const chunkDir = path.join(CHUNK_DIR, req.params.uploadId);

    const writeStream = fs.createWriteStream(finalPath);
    for (let i = 0; i < info.totalChunks; i++) {
      writeStream.write(fs.readFileSync(path.join(chunkDir, `chunk-${i}`)));
    }
    writeStream.end();
    writeStream.on('finish', () => {
      if (!verifyMagicBytes(finalPath, ext)) {
        try { fs.unlinkSync(finalPath); } catch { /* */ }
        try { fs.rmSync(chunkDir, { recursive: true, force: true }); } catch { /* */ }
        activeChunkedUploads.delete(req.params.uploadId);
        res.status(400).json({ error: 'File content does not match type' }); return;
      }
      const actualSize = fs.statSync(finalPath).size;
      const db = getDb();
      const fileId = crypto.randomUUID();
      db.prepare(`INSERT INTO attachments (file_id,original_name,stored_name,file_path,mime_type,file_size,entity_type,entity_id,uploaded_by) VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(fileId, info.originalName, finalName, path.relative(UPLOAD_DIR, finalPath), info.mimeType, actualSize, info.entityType || null, info.entityId || null, info.userId);
      const attachment = db.prepare('SELECT * FROM attachments WHERE file_id = ?').get(fileId);
      db.prepare(`INSERT INTO activity_log (user_id,action,entity_type,entity_id,details,ip_address) VALUES (?,'file_uploaded',?,?,?,?)`)
        .run(info.userId, info.entityType || 'attachment', info.entityId || null, `Uploaded (chunked): ${info.originalName}`, req.ip || 'unknown');
      try { fs.rmSync(chunkDir, { recursive: true, force: true }); } catch { /* */ }
      activeChunkedUploads.delete(req.params.uploadId);
      res.status(201).json(attachment);
    });
    writeStream.on('error', (err) => { console.error('Reassembly error:', err?.message); res.status(500).json({ error: 'Finalize failed' }); });
  } catch (error: any) { console.error('Finalize error:', error?.message); res.status(500).json({ error: 'Finalize failed' }); }
});

// ─── POST /api/uploads ─── Upload one or more files (single-request) ───
router.post('/', uploadRateLimit, upload.array('files', 10), (req: Request, res: Response) => {
  try {
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      res.status(400).json({ error: 'No files provided' });
      return;
    }

    const { entity_type, entity_id } = req.body;

    // Validate entity_type against allowlist if provided
    if (entity_type && !ALLOWED_ENTITY_TYPES.has(entity_type)) {
      // Clean up uploaded files before rejecting
      for (const file of files) {
        try { fs.unlinkSync(file.path); } catch { /* best effort */ }
      }
      res.status(400).json({ error: 'Invalid entity_type' });
      return;
    }
    const db = getDb();
    const results: any[] = [];

    for (const file of files) {
      // Reject zero-byte and suspiciously small files
      if (file.size === 0) {
        try { fs.unlinkSync(file.path); } catch { /* best effort */ }
        res.status(400).json({ error: `File "${file.originalname}" is empty` });
        return;
      }

      // Check for dangerous file extensions that could execute code
      const ext = path.extname(file.originalname).toLowerCase();

      // Block double-extension attacks (e.g., "image.php.jpg" where inner ext is dangerous)
      const nameParts = file.originalname.toLowerCase().split('.');
      if (nameParts.length > 2) {
        const innerExt = '.' + nameParts[nameParts.length - 2];
        if (BLOCKED_EXTENSIONS.has(innerExt)) {
          try { fs.unlinkSync(file.path); } catch { /* best effort */ }
          console.warn(`[Upload] BLOCKED — double extension attack: ${file.originalname} from user ${req.user!.userId}`);
          auditLog(req, 'BLOCK', 'attachment', 0, `Blocked upload: ${file.originalname} — double extension attack`);
          res.status(400).json({ error: `Suspicious filename rejected for security reasons` });
          return;
        }
      }

      if (BLOCKED_EXTENSIONS.has(ext)) {
        try { fs.unlinkSync(file.path); } catch { /* best effort */ }
        console.warn(`[Upload] BLOCKED — dangerous extension ${ext} from user ${req.user!.userId}`);
        auditLog(req, 'BLOCK', 'attachment', 0, `Blocked upload: ${file.originalname} — dangerous extension ${ext}`);
        res.status(400).json({ error: `File type "${ext}" is not allowed for security reasons` });
        return;
      }

      // Verify magic bytes match claimed file type — prevents MIME spoofing attacks
      if (!verifyMagicBytes(file.path, ext)) {
        // Delete the suspicious file immediately
        try { fs.unlinkSync(file.path); } catch { /* best effort */ }
        console.warn(`[Upload] BLOCKED — magic byte mismatch for ${file.originalname} (ext=${ext}) from user ${req.user!.userId}`);
        auditLog(req, 'BLOCK', 'attachment', 0, `Blocked upload: ${file.originalname} — magic byte mismatch (ext=${ext})`);
        res.status(400).json({ error: `File "${file.originalname}" content does not match its file type` });
        return;
      }

      // ── Virus scan hook point ──────────────────────────
      // If VIRUS_SCAN_CMD is set (e.g., "clamscan --no-summary"),
      // run it against the uploaded file before accepting it.
      // Exit code 0 = clean, non-zero = infected or error.
      // SECURITY: Only whitelisted scanner binaries are allowed to prevent
      // command injection via environment variable manipulation.
      const virusScanCmd = process.env.VIRUS_SCAN_CMD;
      const ALLOWED_SCANNERS = new Set(['clamscan', 'clamdscan', 'freshclam', '/usr/bin/clamscan', '/usr/bin/clamdscan', '/usr/local/bin/clamscan']);
      if (virusScanCmd) {
        try {
          const { execFileSync } = require('child_process');
          const parts = virusScanCmd.split(' ').filter(Boolean);
          const cmd = parts[0];
          // Validate the scanner binary against whitelist to prevent command injection
          if (!ALLOWED_SCANNERS.has(cmd)) {
            console.error(`[Upload] BLOCKED — VIRUS_SCAN_CMD uses non-whitelisted binary: ${cmd}`);
            try { fs.unlinkSync(file.path); } catch { /* best effort */ }
            res.status(500).json({ error: 'Server security scan misconfigured' });
            return;
          }
          // Validate scanner arguments: reject args that look like path traversal or shell tricks
          const args = parts.slice(1);
          const SAFE_ARG_RE = /^--?[a-zA-Z0-9][a-zA-Z0-9_=-]*$/;
          for (const arg of args) {
            if (!SAFE_ARG_RE.test(arg)) {
              console.error(`[Upload] BLOCKED — VIRUS_SCAN_CMD contains unsafe argument: ${arg}`);
              try { fs.unlinkSync(file.path); } catch { /* best effort */ }
              res.status(500).json({ error: 'Server security scan misconfigured' });
              return;
            }
          }
          execFileSync(cmd, [...args, file.path], { timeout: 30_000, stdio: 'pipe' });
        } catch (scanErr: any) {
          // Non-zero exit = infected or scan error — reject the file
          try { fs.unlinkSync(file.path); } catch { /* best effort */ }
          console.warn(`[Upload] QUARANTINED — virus scan failed for ${file.originalname} from user ${req.user!.userId}: ${scanErr.message}`);
          auditLog(req, 'BLOCK', 'attachment', 0, `Quarantined upload: ${file.originalname} — virus scan failure`);
          res.status(400).json({ error: 'File rejected by security scan' });
          return;
        }
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

      const attachment = db.prepare('SELECT * FROM attachments WHERE id = ?').get(result.lastInsertRowid);
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

    // Validate entity_type against allowlist
    if (!ALLOWED_ENTITY_TYPES.has(entity_type)) {
      res.status(400).json({ error: 'Invalid entity_type' });
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

    // Ownership check: only the uploader or admin/manager/supervisor can delete files
    const userRole = req.user!.role;
    const isPrivileged = ['admin', 'manager', 'supervisor'].includes(userRole);
    if (attachment.uploaded_by !== req.user!.userId && !isPrivileged) {
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

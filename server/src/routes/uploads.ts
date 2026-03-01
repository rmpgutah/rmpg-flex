import express, { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import { getDb } from '../models/database';
import { authenticateToken, type JwtPayload } from '../middleware/auth';
import config from '../config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Use RMPG_UPLOADS_DIR env var if provided (set by Electron desktop app for
// writable user-data location), otherwise fall back to project-relative path
const UPLOAD_DIR = process.env.RMPG_UPLOADS_DIR || path.resolve(__dirname, '../../uploads');

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

/** Resolve file path and verify it stays within UPLOAD_DIR to prevent path traversal */
function safeFilePath(relativePath: string): string | null {
  const resolved = path.resolve(UPLOAD_DIR, relativePath);
  if (!resolved.startsWith(UPLOAD_DIR)) return null;
  return resolved;
}

// Allowed MIME types
const ALLOWED_TYPES = new Set([
  // Images (including iPhone HEIC/HEIF)
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/tiff',
  'image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence',
  // Documents
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain', 'text/csv',
  // Video (body camera + common formats)
  'video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm',
  'video/x-matroska', 'video/3gpp', 'video/x-ms-wmv', 'video/mpeg',
  'video/x-flv', 'video/ts',
  // Audio
  'audio/mpeg', 'audio/wav', 'audio/ogg',
]);

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

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

function signFileAccess(fileId: string, ttlSeconds = 31536000): { sig: string; exp: number } {
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
    const fileId = req.params.fileId;
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
    const decoded = jwt.verify(token, config.jwt.secret) as JwtPayload;
    if (decoded.type === 'refresh') {
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
router.get('/entity/:type/:id', authenticateToken, (req: Request, res: Response) => {
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
    console.error('List attachments error:', error);
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

    const { sig, exp } = signFileAccess(req.params.fileId);
    res.json({ sig, exp, file_id: req.params.fileId });
  } catch (error: any) {
    console.error('Sign file error:', error);
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
    res.set('Content-Disposition', `inline; filename="${attachment.original_name}"`);
    res.set('Content-Length', String(attachment.file_size));
    // Allow browser caching for 5 minutes
    res.set('Cache-Control', 'private, max-age=300');

    res.sendFile(filePath);
  } catch (error: any) {
    console.error('Download error:', error);
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
    res.set('Content-Disposition', `attachment; filename="${attachment.original_name}"`);
    res.sendFile(filePath);
  } catch (error: any) {
    console.error('Download error:', error);
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
    res.set('Content-Disposition', `inline; filename="${attachment.original_name}"`);
    res.set('Content-Length', String(attachment.file_size));
    res.set('Cache-Control', 'private, max-age=600');

    res.sendFile(filePath);
  } catch (error: any) {
    console.error('Thumbnail error:', error);
    res.status(500).json({ error: 'Thumbnail failed' });
  }
});

// ── All routes below require standard header auth ──
router.use(authenticateToken);

// ============================================================
// CHUNKED UPLOAD — for large files (body camera video, etc.)
// 3-phase: init → chunks → complete
// ============================================================

const CHUNK_DIR = path.join(UPLOAD_DIR, '.chunks');
if (!fs.existsSync(CHUNK_DIR)) fs.mkdirSync(CHUNK_DIR, { recursive: true });

// Raw body parser for chunk data (up to 6MB per chunk)
const rawParser = express.raw({ type: 'application/octet-stream', limit: '6mb' });

// ─── POST /api/uploads/chunked/init ─── Start a chunked upload session ───
router.post('/chunked/init', (req: Request, res: Response) => {
  try {
    const { filename, fileSize, mimeType, totalChunks, entity_type, entity_id } = req.body;

    if (!filename || !fileSize || !totalChunks) {
      res.status(400).json({ error: 'filename, fileSize, and totalChunks are required' });
      return;
    }

    // Validate mime type if provided
    if (mimeType && !ALLOWED_TYPES.has(mimeType)) {
      res.status(400).json({ error: `File type ${mimeType} is not allowed` });
      return;
    }

    // Max 4GB for chunked uploads (body camera video can be large)
    const maxChunkedSize = 4 * 1024 * 1024 * 1024;
    if (fileSize > maxChunkedSize) {
      res.status(400).json({ error: 'File exceeds maximum size of 4 GB' });
      return;
    }

    const uploadId = crypto.randomUUID();
    const sessionDir = path.join(CHUNK_DIR, uploadId);
    fs.mkdirSync(sessionDir, { recursive: true });

    // Write metadata
    fs.writeFileSync(path.join(sessionDir, '_meta.json'), JSON.stringify({
      uploadId,
      filename,
      fileSize,
      mimeType: mimeType || 'application/octet-stream',
      totalChunks,
      entity_type: entity_type || null,
      entity_id: entity_id || null,
      userId: req.user!.userId,
      receivedChunks: [],
      startedAt: new Date().toISOString(),
    }));

    res.json({ uploadId, totalChunks });
  } catch (error: any) {
    console.error('Chunked init error:', error);
    res.status(500).json({ error: 'Failed to initialize upload' });
  }
});

// ─── POST /api/uploads/chunked/:uploadId/:chunkIndex ─── Upload a single chunk ───
router.post('/chunked/:uploadId/:chunkIndex', rawParser, (req: Request, res: Response) => {
  try {
    const { uploadId, chunkIndex } = req.params;
    const idx = parseInt(chunkIndex, 10);

    // Validate session directory exists
    const sessionDir = path.join(CHUNK_DIR, uploadId);
    if (!sessionDir.startsWith(CHUNK_DIR) || !fs.existsSync(sessionDir)) {
      res.status(404).json({ error: 'Upload session not found' });
      return;
    }

    const metaPath = path.join(sessionDir, '_meta.json');
    if (!fs.existsSync(metaPath)) {
      res.status(404).json({ error: 'Upload session metadata not found' });
      return;
    }

    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));

    if (idx < 0 || idx >= meta.totalChunks) {
      res.status(400).json({ error: `Invalid chunk index ${idx} (total: ${meta.totalChunks})` });
      return;
    }

    // Write chunk data
    const chunkPath = path.join(sessionDir, `chunk_${String(idx).padStart(6, '0')}`);
    fs.writeFileSync(chunkPath, req.body);

    // Update received chunks
    if (!meta.receivedChunks.includes(idx)) {
      meta.receivedChunks.push(idx);
      meta.receivedChunks.sort((a: number, b: number) => a - b);
      fs.writeFileSync(metaPath, JSON.stringify(meta));
    }

    res.json({
      chunkIndex: idx,
      received: meta.receivedChunks.length,
      total: meta.totalChunks,
    });
  } catch (error: any) {
    console.error('Chunk upload error:', error);
    res.status(500).json({ error: 'Failed to upload chunk' });
  }
});

// ─── POST /api/uploads/chunked/:uploadId/complete ─── Reassemble and finalize ───
router.post('/chunked/:uploadId/complete', (req: Request, res: Response) => {
  try {
    const { uploadId } = req.params;
    const sessionDir = path.join(CHUNK_DIR, uploadId);
    if (!sessionDir.startsWith(CHUNK_DIR) || !fs.existsSync(sessionDir)) {
      res.status(404).json({ error: 'Upload session not found' });
      return;
    }

    const metaPath = path.join(sessionDir, '_meta.json');
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));

    // Verify all chunks received
    if (meta.receivedChunks.length !== meta.totalChunks) {
      res.status(400).json({
        error: `Missing chunks: received ${meta.receivedChunks.length} of ${meta.totalChunks}`,
        received: meta.receivedChunks,
      });
      return;
    }

    // Create destination directory (year/month)
    const now = new Date();
    const subDir = path.join(UPLOAD_DIR, `${now.getFullYear()}`, String(now.getMonth() + 1).padStart(2, '0'));
    if (!fs.existsSync(subDir)) fs.mkdirSync(subDir, { recursive: true });

    // Unique filename preserving extension
    const ext = path.extname(meta.filename).toLowerCase();
    const storedName = `${crypto.randomUUID()}${ext}`;
    const finalPath = path.join(subDir, storedName);

    // Reassemble chunks sequentially
    const writeStream = fs.createWriteStream(finalPath);
    for (let i = 0; i < meta.totalChunks; i++) {
      const chunkPath = path.join(sessionDir, `chunk_${String(i).padStart(6, '0')}`);
      if (!fs.existsSync(chunkPath)) {
        writeStream.close();
        fs.unlinkSync(finalPath);
        res.status(500).json({ error: `Chunk ${i} missing during reassembly` });
        return;
      }
      const chunkData = fs.readFileSync(chunkPath);
      writeStream.write(chunkData);
    }
    writeStream.end();

    // Wait for write to finish, then create DB record
    writeStream.on('finish', () => {
      try {
        const db = getDb();
        const relativePath = path.relative(UPLOAD_DIR, finalPath);
        const fileId = crypto.randomUUID();
        const actualSize = fs.statSync(finalPath).size;

        db.prepare(`
          INSERT INTO attachments (
            file_id, original_name, stored_name, file_path, mime_type, file_size,
            entity_type, entity_id, uploaded_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          fileId,
          meta.filename,
          storedName,
          relativePath,
          meta.mimeType,
          actualSize,
          meta.entity_type,
          meta.entity_id ? parseInt(meta.entity_id, 10) : null,
          meta.userId,
        );

        const attachment = db.prepare('SELECT * FROM attachments WHERE file_id = ?').get(fileId);

        // Log the upload
        db.prepare(`
          INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
          VALUES (?, 'file_uploaded_chunked', ?, ?, ?, ?)
        `).run(
          meta.userId,
          meta.entity_type || 'attachment',
          meta.entity_id ? parseInt(meta.entity_id, 10) : null,
          `Chunked upload: ${meta.filename} (${(actualSize / 1024 / 1024).toFixed(1)} MB, ${meta.totalChunks} chunks)`,
          req.ip || 'unknown',
        );

        // Clean up chunk directory
        try {
          fs.rmSync(sessionDir, { recursive: true, force: true });
        } catch { /* ignore cleanup errors */ }

        // Generate HMAC-signed access URL
        const { sig, exp } = signFileAccess(fileId);

        res.json({ ...(attachment as any), access_sig: sig, access_exp: exp });
      } catch (dbErr: any) {
        console.error('Chunked complete DB error:', dbErr);
        res.status(500).json({ error: 'File reassembled but database insert failed' });
      }
    });

    writeStream.on('error', (err) => {
      console.error('Chunked reassembly write error:', err);
      res.status(500).json({ error: 'File reassembly failed' });
    });
  } catch (error: any) {
    console.error('Chunked complete error:', error);
    res.status(500).json({ error: 'Failed to complete upload' });
  }
});

// ─── GET /api/uploads/chunked/:uploadId/status ─── Check upload progress ───
router.get('/chunked/:uploadId/status', (req: Request, res: Response) => {
  try {
    const sessionDir = path.join(CHUNK_DIR, req.params.uploadId);
    if (!sessionDir.startsWith(CHUNK_DIR) || !fs.existsSync(sessionDir)) {
      res.status(404).json({ error: 'Upload session not found' });
      return;
    }
    const meta = JSON.parse(fs.readFileSync(path.join(sessionDir, '_meta.json'), 'utf-8'));
    res.json({
      uploadId: req.params.uploadId,
      filename: meta.filename,
      received: meta.receivedChunks.length,
      total: meta.totalChunks,
      complete: meta.receivedChunks.length === meta.totalChunks,
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to check upload status' });
  }
});

// ─── POST /api/uploads ─── Upload one or more files ───
router.post('/', upload.array('files', 10), (req: Request, res: Response) => {
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
      results.push(attachment);
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
    console.error('Upload error:', error);
    if (error.message?.includes('not allowed')) {
      res.status(400).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Upload failed' });
    }
  }
});

// ─── PUT /api/uploads/:fileId/link ─── Link file to entity ───
router.put('/:fileId/link', (req: Request, res: Response) => {
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
    res.json(attachment);
  } catch (error: any) {
    console.error('Link attachment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── DELETE /api/uploads/:fileId ─── Delete a file ───
router.delete('/:fileId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const attachment = db.prepare('SELECT * FROM attachments WHERE file_id = ?').get(req.params.fileId) as any;

    if (!attachment) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    // Delete file from disk
    const filePath = path.join(UPLOAD_DIR, attachment.file_path);
    if (fs.existsSync(filePath)) {
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
    console.error('Delete attachment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

// ============================================================
// RMPG Flex — Dash Camera Videos API
// CRUD, upload, streaming, and ClearPathGPS webhook ingest
// for in-car (MVR) video footage.
// ============================================================

import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { localNow } from '../utils/timeUtils';
import { escapeLike } from '../middleware/sanitize';
import { auditLog } from '../utils/auditLogger';
import { broadcast } from '../utils/websocket';
import { burnVideoWithProgress } from '../utils/videoOverlay';
import { validateParamId, validateNumericParams } from '../middleware/sanitize';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

// ── Upload directory ──────────────────────────────────────────
const DASHCAM_DIR = process.env.RMPG_UPLOADS_DIR
  ? path.join(process.env.RMPG_UPLOADS_DIR, 'dashcam')
  : path.resolve(__dirname, '../../uploads/dashcam');

/** Resolve a relative file path safely within DASHCAM_DIR — returns null if traversal detected */
function safeDashcamPath(relativePath: string): string | null {
  const resolved = path.resolve(DASHCAM_DIR, path.normalize(relativePath));
  const rel = path.relative(DASHCAM_DIR, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return resolved;
}

if (!fs.existsSync(DASHCAM_DIR)) {
  fs.mkdirSync(DASHCAM_DIR, { recursive: true });
}

// Multer storage — save to dashcam directory with unique filenames
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, DASHCAM_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.mp4';
    const unique = crypto.randomBytes(8).toString('hex');
    cb(null, `dashcam_${Date.now()}_${unique}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 * 1024 }, // 10 GB max
  fileFilter: (_req, file, cb) => {
    const allowed = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm', 'video/x-matroska'];
    if (allowed.includes(file.mimetype) || file.originalname.match(/\.(mp4|mov|avi|webm|mkv)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Only video files are allowed (MP4, MOV, AVI, WebM, MKV)'));
    }
  },
});

// Separate upload config for webhook — stricter size limit (500 MB)
const webhookUpload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm', 'video/x-matroska'];
    if (allowed.includes(file.mimetype) || file.originalname.match(/\.(mp4|mov|avi|webm|mkv)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Only video files are allowed'));
    }
  },
});

// ============================================================
// GET /api/fleet/dashcam-videos — List all dash cam videos
// ============================================================
router.get('/', authenticateToken, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { vehicle_id, unit_id, case_number, search, limit: limitStr, offset: offsetStr } = req.query;
    const limit = Math.min(parseInt(String(limitStr), 10) || 50, 500);
    const offset = Math.max(0, Math.min(parseInt(String(offsetStr), 10) || 0, 10000));

    let query = `
      SELECT v.*,
        COALESCE(fv.vehicle_number, fv_unit.vehicle_number) as vehicle_number,
        COALESCE(fv.make, fv_unit.make) as vehicle_make,
        COALESCE(fv.model, fv_unit.model) as vehicle_model,
        COALESCE(fv.year, fv_unit.year) as vehicle_year,
        u.call_sign as unit_call_sign
      FROM dashcam_videos v
      LEFT JOIN fleet_vehicles fv ON v.vehicle_id = fv.id
      LEFT JOIN units u ON v.unit_id = u.id
      LEFT JOIN fleet_vehicles fv_unit ON fv_unit.assigned_unit_id = v.unit_id AND v.vehicle_id IS NULL
      WHERE 1=1
    `;
    const params: any[] = [];

    if (vehicle_id) { query += ' AND (v.vehicle_id = ? OR fv_unit.id = ?)'; params.push(vehicle_id, vehicle_id); }
    if (unit_id) { query += ' AND v.unit_id = ?'; params.push(unit_id); }
    if (case_number) { query += ' AND v.case_number = ?'; params.push(case_number); }
    if (search) {
      const q = `%${escapeLike(String(search))}%`;
      query += " AND (v.title LIKE ? ESCAPE '\\' OR v.case_number LIKE ? ESCAPE '\\' OR v.address LIKE ? ESCAPE '\\' OR COALESCE(fv.vehicle_number, fv_unit.vehicle_number) LIKE ? ESCAPE '\\' OR u.call_sign LIKE ? ESCAPE '\\')";
      params.push(q, q, q, q, q);
    }

    query += ' ORDER BY v.recorded_at DESC, v.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const videos = db.prepare(query).all(...params);
    const total = (db.prepare('SELECT COUNT(*) as cnt FROM dashcam_videos').get() as any)?.cnt || 0;

    res.json({ videos, total });
  } catch (error: any) {
    console.error('List dashcam videos error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// GET /api/fleet/dashcam-videos/:id — Single video detail
// ============================================================
router.get('/:id', validateParamId, authenticateToken, requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const video = db.prepare(`
      SELECT v.*,
        COALESCE(fv.vehicle_number, fv_unit.vehicle_number) as vehicle_number,
        COALESCE(fv.make, fv_unit.make) as vehicle_make,
        COALESCE(fv.model, fv_unit.model) as vehicle_model,
        COALESCE(fv.year, fv_unit.year) as vehicle_year,
        COALESCE(fv.color, fv_unit.color) as vehicle_color,
        COALESCE(fv.plate_number, fv_unit.plate_number) as vehicle_plate,
        COALESCE(fv.plate_state, fv_unit.plate_state) as vehicle_plate_state,
        u.call_sign as unit_call_sign,
        u.status as unit_status,
        usr.full_name as officer_name,
        usr.badge_number as officer_badge,
        usr.rank as officer_rank
      FROM dashcam_videos v
      LEFT JOIN fleet_vehicles fv ON v.vehicle_id = fv.id
      LEFT JOIN units u ON v.unit_id = u.id
      LEFT JOIN fleet_vehicles fv_unit ON fv_unit.assigned_unit_id = v.unit_id AND v.vehicle_id IS NULL
      LEFT JOIN users usr ON u.officer_id = usr.id
      WHERE v.id = ?
    `).get(req.params.id);

    if (!video) {
      res.status(404).json({ error: 'Video not found' });
      return;
    }

    // Include linked entities and audit trail for detail page
    const links = db.prepare('SELECT * FROM dashcam_video_links WHERE video_id = ? ORDER BY created_at DESC').all(req.params.id);
    const auditTrail = db.prepare(
      "SELECT * FROM audit_log WHERE entity_type = 'dashcam_video' AND CAST(entity_id AS TEXT) = ? ORDER BY created_at DESC LIMIT 50"
    ).all(String(req.params.id));

    res.json({ ...(video as any), links, audit_trail: auditTrail });
  } catch (error: any) {
    console.error('Get dashcam video error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// GET /api/fleet/dashcam-videos/:id/neighbors — Previous/Next video
// ============================================================
router.get('/:id/neighbors', validateParamId, authenticateToken, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const video = db.prepare('SELECT id, recorded_at FROM dashcam_videos WHERE id = ?').get(req.params.id) as any;
    if (!video) {
      res.status(404).json({ error: 'Video not found' });
      return;
    }

    const prev = db.prepare(
      'SELECT id, title FROM dashcam_videos WHERE recorded_at < ? OR (recorded_at = ? AND id < ?) ORDER BY recorded_at DESC, id DESC LIMIT 1'
    ).get(video.recorded_at || '', video.recorded_at || '', video.id) as any;

    const next = db.prepare(
      'SELECT id, title FROM dashcam_videos WHERE recorded_at > ? OR (recorded_at = ? AND id > ?) ORDER BY recorded_at ASC, id ASC LIMIT 1'
    ).get(video.recorded_at || '', video.recorded_at || '', video.id) as any;

    res.json({ prev: prev || null, next: next || null });
  } catch (error: any) {
    console.error('Get dashcam neighbors error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// POST /api/fleet/dashcam-videos — Upload a new dash cam video
// ============================================================
router.post('/', authenticateToken, requireRole('admin', 'manager', 'supervisor', 'officer'), upload.fields([{ name: 'video', maxCount: 1 }, { name: 'thumbnail', maxCount: 1 }]), (req: Request, res: Response) => {
  try {
    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
    const videoFile = files?.['video']?.[0];
    const thumbnailFile = files?.['thumbnail']?.[0];

    if (!videoFile) {
      // Cleanup thumbnail if uploaded without video
      if (thumbnailFile && fs.existsSync(thumbnailFile.path)) fs.unlinkSync(thumbnailFile.path);
      res.status(400).json({ error: 'No video file uploaded' });
      return;
    }

    const db = getDb();
    const now = localNow();
    const {
      title, vehicle_id, unit_id, recorded_at, case_number,
      classification, speed_mph, latitude, longitude, address, notes,
      duration_seconds,
    } = req.body;

    if (!title) {
      // Cleanup uploaded files
      fs.unlinkSync(videoFile.path);
      if (thumbnailFile && fs.existsSync(thumbnailFile.path)) fs.unlinkSync(thumbnailFile.path);
      res.status(400).json({ error: 'Title is required' });
      return;
    }

    // Auto-resolve vehicle_id from unit's assigned fleet vehicle if not provided
    let resolvedVehicleId = vehicle_id || null;
    if (!resolvedVehicleId && unit_id) {
      const fv = db.prepare('SELECT id FROM fleet_vehicles WHERE assigned_unit_id = ?').get(unit_id) as any;
      if (fv) resolvedVehicleId = fv.id;
    }

    const user = req.user!;

    const result = db.prepare(`
      INSERT INTO dashcam_videos
        (vehicle_id, unit_id, title, file_path, file_size, duration_seconds, mime_type,
         recorded_at, case_number, classification, speed_mph, latitude, longitude, address,
         notes, source, uploaded_by, thumbnail_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'upload', ?, ?, ?, ?)
    `).run(
      resolvedVehicleId,
      unit_id || null,
      title,
      videoFile.filename,
      videoFile.size,
      duration_seconds ? parseInt(String(duration_seconds), 10) : null,
      videoFile.mimetype || 'video/mp4',
      recorded_at || null,
      case_number || null,
      classification || 'routine',
      speed_mph ? parseFloat(String(speed_mph)) : null,
      latitude ? parseFloat(String(latitude)) : null,
      longitude ? parseFloat(String(longitude)) : null,
      address || null,
      notes || null,
      user?.username || 'system',
      thumbnailFile ? thumbnailFile.filename : null,
      now, now,
    );

    const id = result.lastInsertRowid;

    auditLog(req, 'dashcam_uploaded', 'dashcam_video', Number(id), `Uploaded dash cam video: ${title}`);
    broadcast('fleet', 'dashcam_uploaded', { id, title });

    res.json({ success: true, id });
  } catch (error: any) {
    console.error('Upload dashcam video error:', error?.message || 'Unknown error');
    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
    const videoFile = files?.['video']?.[0];
    const thumbnailFile = files?.['thumbnail']?.[0];
    if (videoFile && fs.existsSync(videoFile.path)) fs.unlinkSync(videoFile.path);
    if (thumbnailFile && fs.existsSync(thumbnailFile.path)) fs.unlinkSync(thumbnailFile.path);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// PUT /api/fleet/dashcam-videos/:id — Update video metadata
// ============================================================
router.put('/:id', validateParamId, authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid video ID' }); return; }
    const existing = db.prepare('SELECT * FROM dashcam_videos WHERE id = ?').get(id) as any;
    if (!existing) {
      res.status(404).json({ error: 'Video not found' });
      return;
    }

    const {
      title, vehicle_id, unit_id, recorded_at, case_number,
      classification, speed_mph, latitude, longitude, address, notes,
    } = req.body;

    db.prepare(`
      UPDATE dashcam_videos SET
        title = COALESCE(?, title),
        vehicle_id = ?,
        unit_id = ?,
        recorded_at = COALESCE(?, recorded_at),
        case_number = ?,
        classification = COALESCE(?, classification),
        speed_mph = ?,
        latitude = ?,
        longitude = ?,
        address = ?,
        notes = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      title || null,
      vehicle_id ?? existing.vehicle_id,
      unit_id ?? existing.unit_id,
      recorded_at || null,
      case_number ?? existing.case_number,
      classification || null,
      speed_mph != null ? parseFloat(String(speed_mph)) : existing.speed_mph,
      latitude != null ? parseFloat(String(latitude)) : existing.latitude,
      longitude != null ? parseFloat(String(longitude)) : existing.longitude,
      address ?? existing.address,
      notes ?? existing.notes,
      localNow(),
      id,
    );

    auditLog(req, 'dashcam_updated', 'dashcam_video', id, `Updated dash cam video: ${title || existing.title}`);
    broadcast('fleet', 'dashcam_updated', { id });

    res.json({ success: true });
  } catch (error: any) {
    console.error('Update dashcam video error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// DELETE /api/fleet/dashcam-videos/:id — Delete video + file
// ============================================================
router.delete('/:id', validateParamId, authenticateToken, requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid video ID' }); return; }
    const video = db.prepare('SELECT * FROM dashcam_videos WHERE id = ?').get(id) as any;
    if (!video) {
      res.status(404).json({ error: 'Video not found' });
      return;
    }

    // Delete file from disk — verify path is contained within DASHCAM_DIR
    const filePath = safeDashcamPath(video.file_path);
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    db.prepare('DELETE FROM dashcam_videos WHERE id = ?').run(id);

    auditLog(req, 'dashcam_deleted', 'dashcam_video', id, `Deleted dash cam video: ${video.title}`);
    broadcast('fleet', 'dashcam_deleted', { id });

    res.json({ success: true });
  } catch (error: any) {
    console.error('Delete dashcam video error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// GET /api/fleet/dashcam-videos/:id/stream — Stream with Range
// ============================================================
router.get('/:id/stream', validateParamId, (req: Request, res: Response, next) => {
  // Accept token from query string for <video> elements (can't set Authorization header)
  if (!req.headers['authorization'] && typeof req.query.token === 'string' && req.query.token.length < 2048) {
    req.headers['authorization'] = `Bearer ${req.query.token}`;
  }
  next();
}, authenticateToken, requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const video = db.prepare('SELECT * FROM dashcam_videos WHERE id = ?').get(req.params.id) as any;
    if (!video) {
      res.status(404).json({ error: 'Video not found' });
      return;
    }

    // Prevent path traversal: resolve within DASHCAM_DIR and verify containment
    const filePath = safeDashcamPath(video.file_path);
    if (!filePath || !fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Video file not found on disk' });
      return;
    }

    // Security headers: prevent caching of sensitive video content, block embedding
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Content-Disposition', 'inline');
    res.set('Referrer-Policy', 'no-referrer');

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (isNaN(start) || isNaN(end) || start < 0 || end >= fileSize || start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` });
        res.end();
        return;
      }

      const chunkSize = end - start + 1;

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': video.mime_type || 'video/mp4',
      });
      const stream = fs.createReadStream(filePath, { start, end });
      stream.on('error', (err) => { console.error('Dashcam stream error:', err?.message || 'Unknown error'); res.destroy(); });
      stream.pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': video.mime_type || 'video/mp4',
      });
      const stream = fs.createReadStream(filePath);
      stream.on('error', (err) => { console.error('Dashcam stream error:', err?.message || 'Unknown error'); res.destroy(); });
      stream.pipe(res);
    }
  } catch (error: any) {
    console.error('Stream dashcam video error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// GET /api/fleet/dashcam-videos/:id/links — List linked entities
// ============================================================
router.get('/:id/links', validateParamId, authenticateToken, requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const videoId = parseInt(String(req.params.id), 10);
    if (isNaN(videoId)) { res.status(400).json({ error: 'Invalid video ID' }); return; }

    const links = db.prepare(`
      SELECT * FROM dashcam_video_links WHERE video_id = ? ORDER BY created_at DESC
    `).all(videoId);

    res.json(links);
  } catch (error: any) {
    console.error('List dashcam video links error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// POST /api/fleet/dashcam-videos/:id/links — Link video to entity
// ============================================================
router.post('/:id/links', validateParamId, authenticateToken, requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const videoId = parseInt(String(req.params.id), 10);
    if (isNaN(videoId)) { res.status(400).json({ error: 'Invalid video ID' }); return; }
    const { entity_type, entity_id, notes } = req.body;
    const user = req.user!;

    if (!entity_type || !entity_id) {
      res.status(400).json({ error: 'entity_type and entity_id are required' });
      return;
    }

    const validTypes = ['call', 'incident', 'case', 'warrant', 'citation'];
    if (!validTypes.includes(entity_type)) {
      res.status(400).json({ error: `entity_type must be one of: ${validTypes.join(', ')}` });
      return;
    }

    // Check video exists
    const video = db.prepare('SELECT id, title FROM dashcam_videos WHERE id = ?').get(videoId) as any;
    if (!video) {
      res.status(404).json({ error: 'Video not found' });
      return;
    }

    // Check duplicate
    const existing = db.prepare(
      'SELECT id FROM dashcam_video_links WHERE video_id = ? AND entity_type = ? AND entity_id = ?'
    ).get(videoId, entity_type, entity_id);
    if (existing) {
      res.status(409).json({ error: 'This link already exists' });
      return;
    }

    const result = db.prepare(`
      INSERT INTO dashcam_video_links (video_id, entity_type, entity_id, linked_by, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(videoId, entity_type, entity_id, user?.username || 'unknown', notes || null, localNow());

    auditLog(req, 'dashcam_linked', 'dashcam_video_link', Number(result.lastInsertRowid),
      `Linked video "${video.title}" to ${entity_type} #${entity_id}`);
    broadcast('fleet', 'dashcam_linked', { video_id: videoId, entity_type, entity_id });

    res.json({ success: true, id: result.lastInsertRowid });
  } catch (error: any) {
    console.error('Link dashcam video error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// DELETE /api/fleet/dashcam-videos/:id/links/:linkId — Remove link
// ============================================================
router.delete('/:id/links/:linkId', validateNumericParams('id', 'linkId'), authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const linkId = parseInt(String(req.params.linkId), 10);
    if (isNaN(linkId)) { res.status(400).json({ error: 'Invalid link ID' }); return; }

    const link = db.prepare('SELECT * FROM dashcam_video_links WHERE id = ?').get(linkId) as any;
    if (!link) {
      res.status(404).json({ error: 'Link not found' });
      return;
    }

    db.prepare('DELETE FROM dashcam_video_links WHERE id = ?').run(linkId);

    auditLog(req, 'dashcam_unlinked', 'dashcam_video_link', linkId,
      `Removed ${link.entity_type} #${link.entity_id} link from video #${link.video_id}`);
    broadcast('fleet', 'dashcam_unlinked', { video_id: link.video_id, entity_type: link.entity_type, entity_id: link.entity_id });

    res.json({ success: true });
  } catch (error: any) {
    console.error('Unlink dashcam video error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// POST /api/fleet/dashcam-videos/webhook/clearpathgps
// ClearPathGPS video event webhook — accepts video file uploads
// triggered by ClearPath GPS camera events (hard brake, impact, etc.)
// ============================================================
router.post('/webhook/clearpathgps', webhookUpload.single('video'), (req: Request, res: Response) => {
  try {
    const db = getDb();

    // ── IP Allowlist for webhook callers ──────────────────
    // If CLEARPATHGPS_WEBHOOK_IPS is set, only accept requests from those IPs.
    // Format: comma-separated CIDR or IP addresses (e.g., "1.2.3.4,5.6.7.0/24")
    const allowedIps = process.env.CLEARPATHGPS_WEBHOOK_IPS;
    if (allowedIps) {
      const clientIp = req.ip || '';
      const allowed = allowedIps.split(',').map(s => s.trim()).filter(Boolean);
      if (!allowed.some(ip => clientIp === ip || clientIp.startsWith(ip.replace(/\/\d+$/, '')))) {
        console.warn(`[DASHCAM] Webhook rejected: IP ${clientIp} not in allowlist`);
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
    }

    // Validate webhook secret (required — reject if not configured)
    const webhookSecret = process.env.CLEARPATHGPS_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error('[DASHCAM] Webhook rejected: CLEARPATHGPS_WEBHOOK_SECRET not configured');
      res.status(503).json({ error: 'Webhook not configured' });
      return;
    }
    const providedSecret = String(req.headers['x-webhook-secret'] || req.body?.webhook_secret || '');
    if (!providedSecret || providedSecret.length !== webhookSecret.length ||
        !crypto.timingSafeEqual(Buffer.from(providedSecret), Buffer.from(webhookSecret))) {
      console.warn(`[DASHCAM] Webhook rejected: invalid secret from IP ${req.ip}`);
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const {
      device_id, device_name, event_type, event_timestamp,
      speed_mph, latitude, longitude, address, heading,
      unit_call_sign, vehicle_number,
    } = req.body;

    // Validate and sanitize webhook input — external data must be bounded
    const safeStr = (v: any, maxLen: number): string | null =>
      typeof v === 'string' ? v.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').slice(0, maxLen) : null;
    const safeDevice = safeStr(device_id, 100);
    const safeDeviceName = safeStr(device_name, 200);
    const safeEventType = safeStr(event_type, 100);
    const safeEventTs = safeStr(event_timestamp, 50);
    const safeAddress = safeStr(address, 500);
    const safeCallSign = safeStr(unit_call_sign, 50);
    const safeVehicleNum = safeStr(vehicle_number, 50);
    const safeLat = latitude != null ? parseFloat(String(latitude)) : null;
    const safeLon = longitude != null ? parseFloat(String(longitude)) : null;
    const safeSpeed = speed_mph != null ? parseFloat(String(speed_mph)) : null;
    if ((safeLat != null && (isNaN(safeLat) || safeLat < -90 || safeLat > 90)) ||
        (safeLon != null && (isNaN(safeLon) || safeLon < -180 || safeLon > 180)) ||
        (safeSpeed != null && (isNaN(safeSpeed) || safeSpeed < 0 || safeSpeed > 999))) {
      res.status(400).json({ error: 'Invalid numeric values' });
      return;
    }

    // Resolve unit from device mapping or call sign
    let unitId: number | null = null;
    let vehicleId: number | null = null;

    if (safeDevice) {
      const mapping = db.prepare(
        'SELECT unit_id FROM cpg_device_mappings WHERE cpg_device_id = ? AND is_active = 1'
      ).get(safeDevice) as any;
      if (mapping) unitId = mapping.unit_id;
    }

    if (!unitId && safeCallSign) {
      const unit = db.prepare('SELECT id FROM units WHERE call_sign = ?').get(safeCallSign) as any;
      if (unit) unitId = unit.id;
    }

    if (safeVehicleNum) {
      const vehicle = db.prepare('SELECT id FROM fleet_vehicles WHERE vehicle_number = ?').get(safeVehicleNum) as any;
      if (vehicle) vehicleId = vehicle.id;
    } else if (unitId) {
      // Resolve vehicle from fleet_vehicles assigned to this unit
      const fv = db.prepare('SELECT id FROM fleet_vehicles WHERE assigned_unit_id = ?').get(unitId) as any;
      if (fv) vehicleId = fv.id;
    }

    const now = localNow();
    const title = `${safeEventType || 'camera_event'} — ${safeDeviceName || safeDevice || 'ClearPathGPS'} — ${safeEventTs || now}`;

    if (req.file) {
      // Video file was uploaded with the webhook
      const result = db.prepare(`
        INSERT INTO dashcam_videos
          (vehicle_id, unit_id, title, file_path, file_size, mime_type,
           recorded_at, speed_mph, latitude, longitude, address,
           notes, source, uploaded_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'clearpathgps', 'webhook', ?, ?)
      `).run(
        vehicleId,
        unitId,
        title,
        req.file.filename,
        req.file.size,
        req.file.mimetype || 'video/mp4',
        safeEventTs || now,
        safeSpeed,
        safeLat,
        safeLon,
        safeAddress,
        `Auto-captured: ${event_type || 'camera_event'}. Device: ${device_name || device_id || 'unknown'}`,
        now, now,
      );

      const videoId = result.lastInsertRowid;

      broadcast('fleet', 'dashcam_uploaded', {
        id: videoId,
        title,
        source: 'clearpathgps',
        event_type: safeEventType,
      });

      console.log(`[ClearPathGPS Webhook] Video saved: id=${videoId}, event=${safeEventType}, device=${safeDeviceName || safeDevice}`);
      res.json({ success: true, video_id: videoId });
    } else {
      // No video file — just log the event
      console.log(`[ClearPathGPS Webhook] Event received (no video): event=${safeEventType}, device=${safeDeviceName || safeDevice}`);
      res.json({ success: true, message: 'Event received, no video file attached' });
    }
  } catch (error: any) {
    console.error('ClearPathGPS webhook error:', error?.message || 'Unknown error');
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// POST /api/fleet/dashcam-videos/:id/burn — Trigger HUD burn
// ============================================================
router.post('/:id/burn', validateParamId, authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid video ID' }); return; }

    const video = db.prepare(`
      SELECT v.*, u.call_sign as unit_call_sign,
        fv.vehicle_number, fv.year as vehicle_year, fv.make as vehicle_make, fv.model as vehicle_model
      FROM dashcam_videos v
      LEFT JOIN units u ON v.unit_id = u.id
      LEFT JOIN fleet_vehicles fv ON v.vehicle_id = fv.id
      WHERE v.id = ?
    `).get(id) as any;

    if (!video) {
      res.status(404).json({ error: 'Video not found' });
      return;
    }

    // Verify file exists on disk
    const filePath = safeDashcamPath(video.file_path);
    if (!filePath || !fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Video file not found on disk' });
      return;
    }

    if (video.burn_status === 'processing') {
      res.status(409).json({ error: 'Burn already in progress' });
      return;
    }

    // Set initial burn status
    db.prepare('UPDATE dashcam_videos SET burn_status = ?, burn_progress = 0, burn_error = NULL, updated_at = ? WHERE id = ?')
      .run('processing', localNow(), id);

    auditLog(req, 'dashcam_burn_started', 'dashcam_video', id, `Started HUD burn for: ${video.title}`);

    // Build vehicle description
    const vehParts = [video.vehicle_year, video.vehicle_make, video.vehicle_model].filter(Boolean);
    const vehicleDescription = vehParts.length > 0 ? vehParts.join(' ') : undefined;

    // Build output path — same dir, _burned suffix
    const ext = path.extname(filePath);
    const base = path.basename(filePath, ext);
    const outputPath = path.join(path.dirname(filePath), `${base}_burned${ext || '.mp4'}`);

    // Start burn in background (fire-and-forget)
    (async () => {
      try {
        await burnVideoWithProgress(
          filePath,
          outputPath,
          {
            agencyName: 'Rocky Mountain Protective Group',
            unitCallSign: video.unit_call_sign || undefined,
            vehicleDescription,
            caseNumber: video.case_number || undefined,
            classification: video.classification || undefined,
            recordedAt: video.recorded_at || undefined,
            speed: video.speed_mph != null ? video.speed_mph : undefined,
            latitude: video.latitude != null ? video.latitude : undefined,
            longitude: video.longitude != null ? video.longitude : undefined,
          },
          (percent: number) => {
            try {
              db.prepare('UPDATE dashcam_videos SET burn_progress = ?, updated_at = ? WHERE id = ?')
                .run(percent, localNow(), id);
              broadcast('fleet', 'dashcam_burn_progress', { id, progress: percent });
            } catch (e) { /* ignore DB errors during progress */ }
          }
        );

        // Verify output
        if (!fs.existsSync(outputPath)) {
          throw new Error('Burned output file was not created');
        }

        const burnedFilename = path.basename(outputPath);
        db.prepare('UPDATE dashcam_videos SET burn_status = ?, burn_progress = 100, burned_file_path = ?, burn_error = NULL, updated_at = ? WHERE id = ?')
          .run('complete', burnedFilename, localNow(), id);
        broadcast('fleet', 'dashcam_burn_progress', { id, progress: 100, status: 'complete' });
        console.log(`[Burn] Video ${id} burn complete: ${burnedFilename}`);
      } catch (err: any) {
        const errorMsg = err.message?.slice(0, 500) || 'Unknown error';
        console.error(`[Burn] Video ${id} burn failed:`, errorMsg);
        try {
          db.prepare('UPDATE dashcam_videos SET burn_status = ?, burn_error = ?, updated_at = ? WHERE id = ?')
            .run('error', errorMsg, localNow(), id);
          broadcast('fleet', 'dashcam_burn_progress', { id, progress: 0, status: 'error', error: errorMsg });
        } catch { /* ignore */ }
      }
    })();

    res.json({ success: true, message: 'Burn started' });
  } catch (error: any) {
    console.error('Burn dashcam video error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// GET /api/fleet/dashcam-videos/:id/download-burned — Download burned copy
// ============================================================
router.get('/:id/download-burned', validateParamId, (req: Request, res: Response, next) => {
  if (!req.headers['authorization'] && typeof req.query.token === 'string' && req.query.token.length < 2048) {
    req.headers['authorization'] = `Bearer ${req.query.token}`;
  }
  next();
}, authenticateToken, requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const video = db.prepare('SELECT * FROM dashcam_videos WHERE id = ?').get(req.params.id) as any;
    if (!video) {
      res.status(404).json({ error: 'Video not found' });
      return;
    }

    if (!video.burned_file_path) {
      res.status(404).json({ error: 'No burned copy available' });
      return;
    }

    const filePath = safeDashcamPath(video.burned_file_path);
    if (!filePath || !fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Burned file not found on disk' });
      return;
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;
    const filename = `${video.title || 'dashcam'}_burned${path.extname(filePath)}`;

    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Content-Disposition', `attachment; filename="${filename.replace(/"/g, '_')}"`);
    res.set('Referrer-Policy', 'no-referrer');

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (isNaN(start) || isNaN(end) || start < 0 || end >= fileSize || start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` });
        res.end();
        return;
      }

      const chunkSize = end - start + 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': video.mime_type || 'video/mp4',
      });
      const stream = fs.createReadStream(filePath, { start, end });
      stream.on('error', (err) => { console.error('Burned stream error:', err?.message || 'Unknown error'); res.destroy(); });
      stream.pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': video.mime_type || 'video/mp4',
      });
      const stream = fs.createReadStream(filePath);
      stream.on('error', (err) => { console.error('Burned stream error:', err?.message || 'Unknown error'); res.destroy(); });
      stream.pipe(res);
    }
  } catch (error: any) {
    console.error('Download burned video error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// GET /api/fleet/dashcam-videos/:id/thumbnail — Serve thumbnail
// ============================================================
router.get('/:id/thumbnail', validateParamId, (req: Request, res: Response, next) => {
  if (!req.headers['authorization'] && typeof req.query.token === 'string' && req.query.token.length < 2048) {
    req.headers['authorization'] = `Bearer ${req.query.token}`;
  }
  next();
}, authenticateToken, requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const video = db.prepare('SELECT id, thumbnail_path FROM dashcam_videos WHERE id = ?').get(req.params.id) as any;
    if (!video) {
      res.status(404).json({ error: 'Video not found' });
      return;
    }

    if (!video.thumbnail_path) {
      res.status(404).json({ error: 'No thumbnail available' });
      return;
    }

    const filePath = safeDashcamPath(video.thumbnail_path);
    if (!filePath || !fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Thumbnail file not found on disk' });
      return;
    }

    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'private, max-age=3600');
    res.set('X-Content-Type-Options', 'nosniff');
    fs.createReadStream(filePath).pipe(res);
  } catch (error: any) {
    console.error('Get thumbnail error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// POST /api/fleet/dashcam-videos/:id/thumbnail — Upload thumbnail
// ============================================================
const thumbnailUpload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB max
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png'];
    if (allowed.includes(file.mimetype) || file.originalname.match(/\.(jpg|jpeg|png)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG and PNG images are allowed'));
    }
  },
});

router.post('/:id/thumbnail', validateParamId, authenticateToken, requireRole('admin', 'manager', 'supervisor', 'officer'), thumbnailUpload.single('thumbnail'), (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No thumbnail file uploaded' });
      return;
    }

    const db = getDb();
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid video ID' }); return; }

    const video = db.prepare('SELECT id, title FROM dashcam_videos WHERE id = ?').get(id) as any;
    if (!video) {
      // Cleanup uploaded file
      fs.unlinkSync(req.file.path);
      res.status(404).json({ error: 'Video not found' });
      return;
    }

    // Rename to consistent pattern
    const thumbFilename = `thumbnail_${id}_${Date.now()}.jpg`;
    const thumbPath = path.join(DASHCAM_DIR, thumbFilename);
    fs.renameSync(req.file.path, thumbPath);

    db.prepare('UPDATE dashcam_videos SET thumbnail_path = ?, updated_at = ? WHERE id = ?')
      .run(thumbFilename, localNow(), id);

    auditLog(req, 'dashcam_thumbnail_uploaded', 'dashcam_video', id, `Uploaded thumbnail for: ${video.title}`);

    res.json({ success: true });
  } catch (error: any) {
    console.error('Upload thumbnail error:', error?.message || 'Unknown error');
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

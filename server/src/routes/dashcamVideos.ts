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
import { validateParamId, validateParamIdMiddleware } from '../middleware/sanitize';
import { sendCsv } from '../utils/csvExport';

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
    console.error('[DashcamVideos] list videos error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to list videos', code: 'DASHCAMVIDEOS_LIST_VIDEOS_ERROR' });
  }
});

// ============================================================
// GET /api/fleet/dashcam-videos/:id — Single video detail
// ============================================================
router.get('/:id', validateParamIdMiddleware, authenticateToken, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const video = db.prepare(`
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
      WHERE v.id = ?
    `).get(req.params.id);

    if (!video) {
      res.status(404).json({ error: 'Video not found', code: 'VIDEO_NOT_FOUND' });
      return;
    }
    res.json(video);
  } catch (error: any) {
    console.error('[DashcamVideos] get video error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to get video', code: 'DASHCAMVIDEOS_GET_VIDEO_ERROR' });
  }
});

// ============================================================
// POST /api/fleet/dashcam-videos — Upload a new dash cam video
// ============================================================
router.post('/', authenticateToken, requireRole('admin', 'manager', 'supervisor', 'officer'), upload.single('video'), (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No video file uploaded', code: 'NO_VIDEO_FILE_UPLOADED' });
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
      // Cleanup uploaded file
      fs.unlinkSync(req.file.path);
      res.status(400).json({ error: 'Title is required', code: 'TITLE_IS_REQUIRED' });
      return;
    }

    // Validate title length
    if (typeof title !== 'string' || title.length > 500) {
      fs.unlinkSync(req.file.path);
      res.status(400).json({ error: 'Title must be 500 characters or less', code: 'TITLE_MUST_BE_500' });
      return;
    }

    // Validate classification whitelist
    const validClassifications = ['routine', 'evidence', 'incident', 'training', 'other'];
    if (classification && !validClassifications.includes(classification)) {
      fs.unlinkSync(req.file.path);
      res.status(400).json({ error: `Classification must be one of: ${validClassifications.join(', ')}` });
      return;
    }

    // Validate GPS coordinates if provided
    if (latitude != null) {
      const lat = parseFloat(String(latitude));
      if (isNaN(lat) || lat < -90 || lat > 90) {
        fs.unlinkSync(req.file.path);
        res.status(400).json({ error: 'latitude must be between -90 and 90', code: 'LATITUDE_MUST_BE_BETWEEN' });
        return;
      }
    }
    if (longitude != null) {
      const lng = parseFloat(String(longitude));
      if (isNaN(lng) || lng < -180 || lng > 180) {
        fs.unlinkSync(req.file.path);
        res.status(400).json({ error: 'longitude must be between -180 and 180', code: 'LONGITUDE_MUST_BE_BETWEEN' });
        return;
      }
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
         notes, source, uploaded_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'upload', ?, ?, ?)
    `).run(
      resolvedVehicleId,
      unit_id || null,
      title,
      req.file.filename,
      req.file.size,
      duration_seconds ? parseInt(String(duration_seconds), 10) : null,
      req.file.mimetype || 'video/mp4',
      recorded_at || null,
      case_number || null,
      classification || 'routine',
      speed_mph ? parseFloat(String(speed_mph)) : null,
      latitude ? parseFloat(String(latitude)) : null,
      longitude ? parseFloat(String(longitude)) : null,
      address || null,
      notes || null,
      user?.username || 'system',
      now, now,
    );

    const id = Number(result.lastInsertRowid);

    auditLog(req, 'dashcam_uploaded', 'dashcam_video', Number(id), `Uploaded dash cam video: ${title}`);
    broadcast('fleet', 'dashcam_uploaded', { id, title });

    res.json({ success: true, id });
  } catch (error: any) {
    console.error('[DashcamVideos] upload video error:', error?.message || 'Unknown error');
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' });
  }
});

// ============================================================
// PUT /api/fleet/dashcam-videos/:id — Update video metadata
// ============================================================
router.put('/:id', validateParamIdMiddleware, authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid video ID', code: 'INVALID_VIDEO_ID' }); return; }
    const existing = db.prepare('SELECT * FROM dashcam_videos WHERE id = ?').get(id) as any;
    if (!existing) {
      res.status(404).json({ error: 'Video not found', code: 'VIDEO_NOT_FOUND' });
      return;
    }

    const {
      title, vehicle_id, unit_id, recorded_at, case_number,
      classification, speed_mph, latitude, longitude, address, notes,
    } = req.body;

    // Validate fields if provided
    if (title !== undefined && (typeof title !== 'string' || title.length > 500)) {
      res.status(400).json({ error: 'Title must be 500 characters or less', code: 'TITLE_MUST_BE_500' });
      return;
    }
    const validClassifications = ['routine', 'evidence', 'incident', 'training', 'other'];
    if (classification && !validClassifications.includes(classification)) {
      res.status(400).json({ error: `Classification must be one of: ${validClassifications.join(', ')}` });
      return;
    }
    if (notes !== undefined && notes !== null && typeof notes === 'string' && notes.length > 10000) {
      res.status(400).json({ error: 'Notes must be 10000 characters or less', code: 'NOTES_MUST_BE_10000' });
      return;
    }

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
    console.error('[DashcamVideos] update video error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to update video', code: 'DASHCAMVIDEOS_UPDATE_VIDEO_ERROR' });
  }
});

// ============================================================
// DELETE /api/fleet/dashcam-videos/:id — Delete video + file
// ============================================================
router.delete('/:id', validateParamIdMiddleware, authenticateToken, requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid video ID', code: 'INVALID_VIDEO_ID' }); return; }
    const video = db.prepare('SELECT * FROM dashcam_videos WHERE id = ?').get(id) as any;
    if (!video) {
      res.status(404).json({ error: 'Video not found', code: 'VIDEO_NOT_FOUND' });
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
    console.error('[DashcamVideos] delete video error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to delete video', code: 'DASHCAMVIDEOS_DELETE_VIDEO_ERROR' });
  }
});

// ============================================================
// GET /api/fleet/dashcam-videos/:id/stream — Stream with Range
// ============================================================
router.get('/:id/stream', validateParamIdMiddleware, (req: Request, res: Response, next) => {
  // Accept token from query string for <video> elements (can't set Authorization header)
  if (!req.headers['authorization'] && typeof req.query.token === 'string' && req.query.token.length < 2048) {
    req.headers['authorization'] = `Bearer ${req.query.token}`;
  }
  next();
}, authenticateToken, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const video = db.prepare('SELECT * FROM dashcam_videos WHERE id = ?').get(req.params.id) as any;
    if (!video) {
      res.status(404).json({ error: 'Video not found', code: 'VIDEO_NOT_FOUND' });
      return;
    }

    // Prevent path traversal: resolve within DASHCAM_DIR and verify containment
    const filePath = safeDashcamPath(video.file_path);
    if (!filePath || !fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Video file not found on disk', code: 'VIDEO_FILE_NOT_FOUND' });
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
      stream.on('error', (err) => { console.error('[DashcamVideos] stream error:', err?.message || 'Unknown error'); res.destroy(); });
      stream.pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': video.mime_type || 'video/mp4',
      });
      const stream = fs.createReadStream(filePath);
      stream.on('error', (err) => { console.error('[DashcamVideos] stream error:', err?.message || 'Unknown error'); res.destroy(); });
      stream.pipe(res);
    }
  } catch (error: any) {
    console.error('[DashcamVideos] stream video error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to stream video', code: 'DASHCAMVIDEOS_STREAM_VIDEO_ERROR' });
  }
});

// ============================================================
// GET /api/fleet/dashcam-videos/:id/links — List linked entities
// ============================================================
router.get('/:id/links', validateParamIdMiddleware, authenticateToken, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const videoId = parseInt(String(req.params.id), 10);
    if (isNaN(videoId)) { res.status(400).json({ error: 'Invalid video ID', code: 'INVALID_VIDEO_ID' }); return; }

    const links = db.prepare(`
      SELECT * FROM dashcam_video_links WHERE video_id = ? ORDER BY created_at DESC
    
      LIMIT 1000
    `).all(videoId);

    res.json(links);
  } catch (error: any) {
    console.error('[DashcamVideos] list video links error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to list video links', code: 'DASHCAMVIDEOS_LIST_VIDEO_LINKS' });
  }
});

// ============================================================
// POST /api/fleet/dashcam-videos/:id/links — Link video to entity
// ============================================================
router.post('/:id/links', validateParamIdMiddleware, authenticateToken, requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const videoId = parseInt(String(req.params.id), 10);
    if (isNaN(videoId)) { res.status(400).json({ error: 'Invalid video ID', code: 'INVALID_VIDEO_ID' }); return; }
    const { entity_type, entity_id, notes } = req.body;
    const user = req.user!;

    if (!entity_type || !entity_id) {
      res.status(400).json({ error: 'entity_type and entity_id are required', code: 'ENTITYTYPE_AND_ENTITYID_ARE' });
      return;
    }

    // Validate entity_id is a positive integer
    const parsedEntityId = parseInt(String(entity_id), 10);
    if (isNaN(parsedEntityId) || parsedEntityId <= 0) {
      res.status(400).json({ error: 'entity_id must be a positive integer', code: 'ENTITYID_MUST_BE_A' });
      return;
    }

    // Validate notes length
    if (notes !== undefined && notes !== null && (typeof notes !== 'string' || notes.length > 2000)) {
      res.status(400).json({ error: 'notes must be 2000 characters or less', code: 'NOTES_MUST_BE_2000' });
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
      res.status(404).json({ error: 'Video not found', code: 'VIDEO_NOT_FOUND' });
      return;
    }

    // Check duplicate
    const existing = db.prepare(
      'SELECT id FROM dashcam_video_links WHERE video_id = ? AND entity_type = ? AND entity_id = ?'
    ).get(videoId, entity_type, entity_id);
    if (existing) {
      res.status(409).json({ error: 'This link already exists', code: 'THIS_LINK_ALREADY_EXISTS' });
      return;
    }

    const result = db.prepare(`
      INSERT INTO dashcam_video_links (video_id, entity_type, entity_id, linked_by, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(videoId, entity_type, entity_id, user?.username || 'unknown', notes || null, localNow());

    auditLog(req, 'dashcam_linked', 'dashcam_video_link', Number(result.lastInsertRowid),
      `Linked video "${video.title}" to ${entity_type} #${entity_id}`);
    broadcast('fleet', 'dashcam_linked', { video_id: videoId, entity_type, entity_id });

    res.json({ success: true, id: Number(result.lastInsertRowid) });
  } catch (error: any) {
    console.error('[DashcamVideos] link video error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to link video', code: 'DASHCAMVIDEOS_LINK_VIDEO_ERROR' });
  }
});

// ============================================================
// DELETE /api/fleet/dashcam-videos/:id/links/:linkId — Remove link
// ============================================================
router.delete('/:id/links/:linkId', validateParamIdMiddleware, authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const linkId = parseInt(String(req.params.linkId), 10);
    if (isNaN(linkId)) { res.status(400).json({ error: 'Invalid link ID', code: 'INVALID_LINK_ID' }); return; }

    const link = db.prepare('SELECT * FROM dashcam_video_links WHERE id = ?').get(linkId) as any;
    if (!link) {
      res.status(404).json({ error: 'Link not found', code: 'LINK_NOT_FOUND' });
      return;
    }

    db.prepare('DELETE FROM dashcam_video_links WHERE id = ?').run(linkId);

    auditLog(req, 'dashcam_unlinked', 'dashcam_video_link', linkId,
      `Removed ${link.entity_type} #${link.entity_id} link from video #${link.video_id}`);
    broadcast('fleet', 'dashcam_unlinked', { video_id: link.video_id, entity_type: link.entity_type, entity_id: link.entity_id });

    res.json({ success: true });
  } catch (error: any) {
    console.error('[DashcamVideos] unlink video error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to unlink video', code: 'DASHCAMVIDEOS_UNLINK_VIDEO_ERROR' });
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

    // Validate webhook secret (required — reject if not configured)
    const webhookSecret = process.env.CLEARPATHGPS_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error('[DASHCAM] Webhook rejected: CLEARPATHGPS_WEBHOOK_SECRET not configured');
      res.status(503).json({ error: 'Webhook not configured', code: 'WEBHOOK_NOT_CONFIGURED' });
      return;
    }
    const providedSecret = String(req.headers['x-webhook-secret'] || req.body?.webhook_secret || '');
    if (!providedSecret || providedSecret.length !== webhookSecret.length ||
        !crypto.timingSafeEqual(Buffer.from(providedSecret), Buffer.from(webhookSecret))) {
      res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
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
      res.status(400).json({ error: 'Invalid numeric values', code: 'INVALID_NUMERIC_VALUES' });
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

      const videoId = Number(result.lastInsertRowid);

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
    console.error('[DashcamVideos] webhook error:', error?.message || 'Unknown error');
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 1: Automatic Incident Correlation
// Links dashcam videos to calls/incidents by matching
// time window and GPS proximity.
// ════════════════════════════════════════════════════════════
router.get('/:id/auto-correlate', validateParamIdMiddleware, authenticateToken, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const videoId = parseInt(String(req.params.id), 10);
    if (isNaN(videoId)) { res.status(400).json({ error: 'Invalid video ID' }); return; }

    const video = db.prepare('SELECT * FROM dashcam_videos WHERE id = ?').get(videoId) as any;
    if (!video) { res.status(404).json({ error: 'Video not found' }); return; }

    const correlations: any[] = [];
    const recordedAt = video.recorded_at || video.created_at;

    if (recordedAt) {
      // Find calls within +/- 30 minutes of the video recording time
      const callsNearby = db.prepare(`
        SELECT id, call_number, incident_type, status, location_address, latitude, longitude, created_at
        FROM calls_for_service
        WHERE ABS(CAST((julianday(created_at) - julianday(?)) * 24 * 60 AS INTEGER)) <= 30
        ORDER BY ABS(julianday(created_at) - julianday(?))
        LIMIT 10
      `).all(recordedAt, recordedAt) as any[];

      for (const call of callsNearby) {
        let distance_km: number | null = null;
        if (video.latitude && video.longitude && call.latitude && call.longitude) {
          const R = 6371;
          const dLat = (call.latitude - video.latitude) * Math.PI / 180;
          const dLng = (call.longitude - video.longitude) * Math.PI / 180;
          const a = Math.sin(dLat / 2) ** 2 + Math.cos(video.latitude * Math.PI / 180) * Math.cos(call.latitude * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
          distance_km = Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 100) / 100;
        }

        correlations.push({
          entity_type: 'call',
          entity_id: call.id,
          identifier: call.call_number,
          type: call.incident_type,
          location: call.location_address,
          time: call.created_at,
          distance_km,
          confidence: distance_km !== null && distance_km < 0.5 ? 'high' : distance_km !== null && distance_km < 2 ? 'medium' : 'low',
        });
      }

      // Find incidents in the same time window
      const incidentsNearby = db.prepare(`
        SELECT id, incident_number, incident_type, status, location_address, latitude, longitude, created_at
        FROM incidents
        WHERE ABS(CAST((julianday(created_at) - julianday(?)) * 24 * 60 AS INTEGER)) <= 30
        ORDER BY ABS(julianday(created_at) - julianday(?))
        LIMIT 10
      `).all(recordedAt, recordedAt) as any[];

      for (const inc of incidentsNearby) {
        correlations.push({
          entity_type: 'incident',
          entity_id: inc.id,
          identifier: inc.incident_number,
          type: inc.incident_type,
          location: inc.location_address,
          time: inc.created_at,
          distance_km: null,
          confidence: 'medium',
        });
      }
    }

    // Sort by confidence (high first)
    const order: Record<string, number> = { high: 0, medium: 1, low: 2 };
    correlations.sort((a, b) => (order[a.confidence] || 2) - (order[b.confidence] || 2));

    res.json({ video_id: videoId, correlations });
  } catch (error: any) {
    console.error('[DashcamVideos] auto-correlate error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to auto-correlate', code: 'DASHCAM_AUTOCORRELATE_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 2: Video Quality Monitoring
// Returns video quality statistics (resolution proxy from file
// size, missing metadata, corrupt files).
// ════════════════════════════════════════════════════════════
router.get('/quality/report', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (_req: Request, res: Response) => {
  try {
    const db = getDb();

    // Videos with missing critical metadata
    const missingMetadata = db.prepare(`
      SELECT id, title, recorded_at, created_at,
        CASE
          WHEN recorded_at IS NULL THEN 'missing_recorded_at'
          WHEN duration_seconds IS NULL OR duration_seconds = 0 THEN 'missing_duration'
          WHEN file_size IS NULL OR file_size = 0 THEN 'missing_file_size'
          WHEN latitude IS NULL AND longitude IS NULL THEN 'missing_gps'
          ELSE 'ok'
        END as issue
      FROM dashcam_videos
      WHERE recorded_at IS NULL OR duration_seconds IS NULL OR duration_seconds = 0
        OR file_size IS NULL OR file_size = 0
      ORDER BY created_at DESC
      LIMIT 50
    `).all() as any[];

    // Average file size per minute (quality proxy)
    const qualityStats = db.prepare(`
      SELECT
        COUNT(*) as total_videos,
        AVG(file_size) as avg_file_size,
        AVG(CASE WHEN duration_seconds > 0 THEN file_size * 1.0 / duration_seconds ELSE NULL END) as avg_bytes_per_second,
        MIN(file_size) as min_file_size,
        MAX(file_size) as max_file_size,
        SUM(file_size) as total_storage_bytes,
        AVG(duration_seconds) as avg_duration_seconds
      FROM dashcam_videos
      WHERE file_size > 0
    `).get() as any;

    // Videos by source
    const bySource = db.prepare(`
      SELECT source, COUNT(*) as count, SUM(file_size) as total_bytes,
        AVG(duration_seconds) as avg_duration
      FROM dashcam_videos GROUP BY source
    `).all() as any[];

    // Very small files (potentially corrupt or incomplete)
    const suspiciouslySmall = db.prepare(`
      SELECT id, title, file_size, duration_seconds, created_at
      FROM dashcam_videos
      WHERE file_size > 0 AND file_size < 50000
      ORDER BY created_at DESC LIMIT 20
    `).all() as any[];

    res.json({
      total_videos: qualityStats?.total_videos || 0,
      avg_file_size_mb: qualityStats?.avg_file_size ? Math.round(qualityStats.avg_file_size / 1024 / 1024 * 10) / 10 : 0,
      avg_bitrate_kbps: qualityStats?.avg_bytes_per_second ? Math.round(qualityStats.avg_bytes_per_second * 8 / 1024) : 0,
      total_storage_gb: qualityStats?.total_storage_bytes ? Math.round(qualityStats.total_storage_bytes / 1024 / 1024 / 1024 * 100) / 100 : 0,
      missing_metadata: missingMetadata,
      missing_metadata_count: missingMetadata.length,
      suspiciously_small: suspiciouslySmall,
      by_source: bySource,
    });
  } catch (error: any) {
    console.error('[DashcamVideos] quality report error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to get quality report', code: 'DASHCAM_QUALITY_REPORT_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 3: Storage Usage Tracking
// Returns storage usage breakdown by vehicle, unit, source,
// and classification with trend data.
// ════════════════════════════════════════════════════════════
router.get('/storage/usage', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (_req: Request, res: Response) => {
  try {
    const db = getDb();

    // Total storage used
    const total = db.prepare(`
      SELECT COUNT(*) as count, COALESCE(SUM(file_size), 0) as total_bytes
      FROM dashcam_videos
    `).get() as any;

    // By classification
    const byClassification = db.prepare(`
      SELECT classification, COUNT(*) as count, COALESCE(SUM(file_size), 0) as total_bytes
      FROM dashcam_videos GROUP BY classification ORDER BY total_bytes DESC
    `).all() as any[];

    // By vehicle
    const byVehicle = db.prepare(`
      SELECT COALESCE(fv.vehicle_number, 'Unassigned') as vehicle,
        COUNT(*) as count, COALESCE(SUM(v.file_size), 0) as total_bytes
      FROM dashcam_videos v
      LEFT JOIN fleet_vehicles fv ON v.vehicle_id = fv.id
      GROUP BY v.vehicle_id ORDER BY total_bytes DESC LIMIT 20
    `).all() as any[];

    // Monthly trend (last 12 months)
    const monthlyTrend = db.prepare(`
      SELECT strftime('%Y-%m', created_at) as month,
        COUNT(*) as count, COALESCE(SUM(file_size), 0) as total_bytes
      FROM dashcam_videos
      WHERE created_at >= datetime('now', '-12 months')
      GROUP BY month ORDER BY month
    `).all() as any[];

    // Disk usage check
    let diskInfo: any = null;
    try {
      const stats = fs.statfsSync(DASHCAM_DIR);
      diskInfo = {
        total_gb: Math.round((stats.bsize * stats.blocks) / 1024 / 1024 / 1024 * 100) / 100,
        free_gb: Math.round((stats.bsize * stats.bfree) / 1024 / 1024 / 1024 * 100) / 100,
        used_pct: Math.round((1 - stats.bfree / stats.blocks) * 100),
      };
    } catch { /* statfs may not be available */ }

    res.json({
      total_videos: total.count,
      total_storage_gb: Math.round(total.total_bytes / 1024 / 1024 / 1024 * 100) / 100,
      by_classification: byClassification.map((c: any) => ({
        ...c,
        total_gb: Math.round(c.total_bytes / 1024 / 1024 / 1024 * 100) / 100,
      })),
      by_vehicle: byVehicle.map((v: any) => ({
        ...v,
        total_gb: Math.round(v.total_bytes / 1024 / 1024 / 1024 * 100) / 100,
      })),
      monthly_trend: monthlyTrend.map((m: any) => ({
        ...m,
        total_gb: Math.round(m.total_bytes / 1024 / 1024 / 1024 * 100) / 100,
      })),
      disk: diskInfo,
    });
  } catch (error: any) {
    console.error('[DashcamVideos] storage usage error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to get storage usage', code: 'DASHCAM_STORAGE_USAGE_ERROR' });
  }
});

// ─── CSV EXPORT ──────────────────────────────────────────

// GET /api/fleet/dashcam-videos/export/csv — Export dashcam video metadata
router.get('/export/csv', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT v.id, v.title, v.file_size, v.duration_seconds, v.mime_type,
        v.recorded_at, v.case_number, v.classification, v.speed_mph,
        v.latitude, v.longitude, v.address, v.source, v.uploaded_by,
        v.notes, v.created_at,
        fv.vehicle_number, u.call_sign as unit_call_sign
      FROM dashcam_videos v
      LEFT JOIN fleet_vehicles fv ON v.vehicle_id = fv.id
      LEFT JOIN units u ON v.unit_id = u.id
      ORDER BY v.recorded_at DESC LIMIT 10000
    `).all();
    sendCsv(res, 'dashcam_videos_export.csv', [
      { key: 'id', header: 'ID' },
      { key: 'title', header: 'Title' },
      { key: 'vehicle_number', header: 'Vehicle' },
      { key: 'unit_call_sign', header: 'Unit' },
      { key: 'recorded_at', header: 'Recorded At' },
      { key: 'case_number', header: 'Case Number' },
      { key: 'classification', header: 'Classification' },
      { key: 'duration_seconds', header: 'Duration (sec)' },
      { key: 'file_size', header: 'File Size (bytes)' },
      { key: 'speed_mph', header: 'Speed (mph)' },
      { key: 'latitude', header: 'Latitude' },
      { key: 'longitude', header: 'Longitude' },
      { key: 'address', header: 'Address' },
      { key: 'source', header: 'Source' },
      { key: 'uploaded_by', header: 'Uploaded By' },
      { key: 'notes', header: 'Notes' },
      { key: 'created_at', header: 'Created At' },
    ], rows);
  } catch (error: any) {
    res.status(500).json({ error: 'Export failed', code: 'EXPORT_FAILED' });
  }
});

// POST /api/fleet/dashcam-videos/:id/burn — Queue HUD burn for a video
router.post('/:id/burn', authenticateToken, requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid video ID' }); return; }
    db.prepare("UPDATE dashcam_videos SET burn_status = 'pending', updated_at = datetime('now') WHERE id = ?").run(id);
    res.json({ success: true, message: 'HUD burn queued' });
  } catch (error: any) {
    console.error('Dashcam burn error:', error);
    res.status(500).json({ error: 'Failed to queue burn', code: 'DASHCAM_BURN_ERROR' });
  }
});

export default router;

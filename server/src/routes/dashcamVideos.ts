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
import { auditLog } from '../utils/auditLogger';
import { broadcast } from '../utils/websocket';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

// ── Upload directory ──────────────────────────────────────────
const DASHCAM_DIR = process.env.RMPG_UPLOADS_DIR
  ? path.join(process.env.RMPG_UPLOADS_DIR, 'dashcam')
  : path.resolve(__dirname, '../../uploads/dashcam');

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

// ============================================================
// GET /api/fleet/dashcam-videos — List all dash cam videos
// ============================================================
router.get('/', authenticateToken, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { vehicle_id, unit_id, case_number, search, limit: limitStr, offset: offsetStr } = req.query;
    const limit = Math.min(parseInt(String(limitStr), 10) || 50, 500);
    const offset = parseInt(String(offsetStr), 10) || 0;

    let query = `
      SELECT v.*,
        fv.vehicle_number, fv.make as vehicle_make, fv.model as vehicle_model, fv.year as vehicle_year,
        u.call_sign as unit_call_sign
      FROM dashcam_videos v
      LEFT JOIN fleet_vehicles fv ON v.vehicle_id = fv.id
      LEFT JOIN units u ON v.unit_id = u.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (vehicle_id) { query += ' AND v.vehicle_id = ?'; params.push(vehicle_id); }
    if (unit_id) { query += ' AND v.unit_id = ?'; params.push(unit_id); }
    if (case_number) { query += ' AND v.case_number = ?'; params.push(case_number); }
    if (search) {
      const q = `%${String(search)}%`;
      query += ' AND (v.title LIKE ? OR v.case_number LIKE ? OR v.address LIKE ? OR fv.vehicle_number LIKE ? OR u.call_sign LIKE ?)';
      params.push(q, q, q, q, q);
    }

    query += ' ORDER BY v.recorded_at DESC, v.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const videos = db.prepare(query).all(...params);
    const total = (db.prepare('SELECT COUNT(*) as cnt FROM dashcam_videos').get() as any)?.cnt || 0;

    res.json({ videos, total });
  } catch (error: any) {
    console.error('List dashcam videos error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// GET /api/fleet/dashcam-videos/:id — Single video detail
// ============================================================
router.get('/:id', authenticateToken, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const video = db.prepare(`
      SELECT v.*,
        fv.vehicle_number, fv.make as vehicle_make, fv.model as vehicle_model, fv.year as vehicle_year,
        u.call_sign as unit_call_sign
      FROM dashcam_videos v
      LEFT JOIN fleet_vehicles fv ON v.vehicle_id = fv.id
      LEFT JOIN units u ON v.unit_id = u.id
      WHERE v.id = ?
    `).get(req.params.id);

    if (!video) {
      res.status(404).json({ error: 'Video not found' });
      return;
    }
    res.json(video);
  } catch (error: any) {
    console.error('Get dashcam video error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// POST /api/fleet/dashcam-videos — Upload a new dash cam video
// ============================================================
router.post('/', authenticateToken, requireRole('admin', 'manager', 'supervisor', 'officer'), upload.single('video'), (req: Request, res: Response) => {
  try {
    if (!req.file) {
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
      // Cleanup uploaded file
      fs.unlinkSync(req.file.path);
      res.status(400).json({ error: 'Title is required' });
      return;
    }

    const user = (req as any).user;

    const result = db.prepare(`
      INSERT INTO dashcam_videos
        (vehicle_id, unit_id, title, file_path, file_size, duration_seconds, mime_type,
         recorded_at, case_number, classification, speed_mph, latitude, longitude, address,
         notes, source, uploaded_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'upload', ?, ?, ?)
    `).run(
      vehicle_id || null,
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

    const id = result.lastInsertRowid;

    auditLog(req, 'dashcam_uploaded', 'dashcam_video', Number(id), `Uploaded dash cam video: ${title}`);
    broadcast('fleet', 'dashcam_uploaded', { id, title });

    res.json({ success: true, id });
  } catch (error: any) {
    console.error('Upload dashcam video error:', error);
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// PUT /api/fleet/dashcam-videos/:id — Update video metadata
// ============================================================
router.put('/:id', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(String(req.params.id), 10);
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
    console.error('Update dashcam video error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// DELETE /api/fleet/dashcam-videos/:id — Delete video + file
// ============================================================
router.delete('/:id', authenticateToken, requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(String(req.params.id), 10);
    const video = db.prepare('SELECT * FROM dashcam_videos WHERE id = ?').get(id) as any;
    if (!video) {
      res.status(404).json({ error: 'Video not found' });
      return;
    }

    // Delete file from disk
    const filePath = path.resolve(DASHCAM_DIR, video.file_path);
    if (filePath.startsWith(DASHCAM_DIR) && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    db.prepare('DELETE FROM dashcam_videos WHERE id = ?').run(id);

    auditLog(req, 'dashcam_deleted', 'dashcam_video', id, `Deleted dash cam video: ${video.title}`);
    broadcast('fleet', 'dashcam_deleted', { id });

    res.json({ success: true });
  } catch (error: any) {
    console.error('Delete dashcam video error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// GET /api/fleet/dashcam-videos/:id/stream — Stream with Range
// ============================================================
router.get('/:id/stream', (req: Request, res: Response, next) => {
  // Accept token from query string for <video> elements
  if (!req.headers['authorization'] && req.query.token) {
    req.headers['authorization'] = `Bearer ${req.query.token}`;
  }
  next();
}, authenticateToken, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const video = db.prepare('SELECT * FROM dashcam_videos WHERE id = ?').get(req.params.id) as any;
    if (!video) {
      res.status(404).json({ error: 'Video not found' });
      return;
    }

    const filePath = path.resolve(DASHCAM_DIR, video.file_path);
    if (!filePath.startsWith(DASHCAM_DIR) || !fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Video file not found on disk' });
      return;
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': video.mime_type || 'video/mp4',
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': video.mime_type || 'video/mp4',
      });
      fs.createReadStream(filePath).pipe(res);
    }
  } catch (error: any) {
    console.error('Stream dashcam video error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// POST /api/fleet/dashcam-videos/webhook/clearpathgps
// ClearPathGPS video event webhook — accepts video file uploads
// triggered by ClearPath GPS camera events (hard brake, impact, etc.)
// ============================================================
router.post('/webhook/clearpathgps', upload.single('video'), (req: Request, res: Response) => {
  try {
    const db = getDb();

    // Validate webhook secret if configured
    const webhookSecret = process.env.CLEARPATHGPS_WEBHOOK_SECRET;
    if (webhookSecret) {
      const providedSecret = req.headers['x-webhook-secret'] || req.body?.webhook_secret;
      if (providedSecret !== webhookSecret) {
        res.status(401).json({ error: 'Invalid webhook secret' });
        return;
      }
    }

    const {
      device_id, device_name, event_type, event_timestamp,
      speed_mph, latitude, longitude, address, heading,
      unit_call_sign, vehicle_number,
    } = req.body;

    // Resolve unit from device mapping or call sign
    let unitId: number | null = null;
    let vehicleId: number | null = null;

    if (device_id) {
      const mapping = db.prepare(
        'SELECT unit_id FROM cpg_device_mappings WHERE cpg_device_id = ? AND is_active = 1'
      ).get(device_id) as any;
      if (mapping) unitId = mapping.unit_id;
    }

    if (!unitId && unit_call_sign) {
      const unit = db.prepare('SELECT id FROM units WHERE call_sign = ?').get(unit_call_sign) as any;
      if (unit) unitId = unit.id;
    }

    if (vehicle_number) {
      const vehicle = db.prepare('SELECT id FROM fleet_vehicles WHERE vehicle_number = ?').get(vehicle_number) as any;
      if (vehicle) vehicleId = vehicle.id;
    } else if (unitId) {
      // Try to find vehicle assigned to this unit
      const assignment = db.prepare(
        'SELECT vehicle_id FROM fleet_assignments WHERE unit_id = ? AND status = ? ORDER BY assigned_at DESC LIMIT 1'
      ).get(unitId, 'active') as any;
      if (assignment) vehicleId = assignment.vehicle_id;
    }

    const now = localNow();
    const title = `${event_type || 'camera_event'} — ${device_name || device_id || 'ClearPathGPS'} — ${event_timestamp || now}`;

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
        event_timestamp || now,
        speed_mph ? parseFloat(String(speed_mph)) : null,
        latitude ? parseFloat(String(latitude)) : null,
        longitude ? parseFloat(String(longitude)) : null,
        address || null,
        `Auto-captured: ${event_type || 'camera_event'}. Device: ${device_name || device_id || 'unknown'}`,
        now, now,
      );

      const videoId = result.lastInsertRowid;

      broadcast('fleet', 'dashcam_uploaded', {
        id: videoId,
        title,
        source: 'clearpathgps',
        event_type,
      });

      console.log(`[ClearPathGPS Webhook] Video saved: id=${videoId}, event=${event_type}, device=${device_name || device_id}`);
      res.json({ success: true, video_id: videoId });
    } else {
      // No video file — just log the event
      console.log(`[ClearPathGPS Webhook] Event received (no video): event=${event_type}, device=${device_name || device_id}`);
      res.json({ success: true, message: 'Event received, no video file attached' });
    }
  } catch (error: any) {
    console.error('ClearPathGPS webhook error:', error);
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

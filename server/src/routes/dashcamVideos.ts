// ============================================================
// RMPG Flex — Dash Camera Video Routes
// ============================================================
// CRUD + streaming for dashcam video clips.
// Supports manual uploads and GPS-synced footage.
// Follows the same patterns as bodycam routes in personnel.ts.

import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { localNow } from '../utils/timeUtils';
import os from 'os';
import { probeVideo, buildDashcamFilter, burnOverlay, generateDashcamSourceFile } from '../utils/videoBurner';

const execAsync = promisify(exec);

// ── Upload directory ────────────────────────────────────────

const __filename_d = fileURLToPath(import.meta.url);
const __dirname_d = path.dirname(__filename_d);
const DASHCAM_DIR = process.env.RMPG_UPLOADS_DIR
  ? path.join(process.env.RMPG_UPLOADS_DIR, 'dashcam')
  : path.resolve(__dirname_d, '../../uploads/dashcam');

if (!fs.existsSync(DASHCAM_DIR)) {
  fs.mkdirSync(DASHCAM_DIR, { recursive: true });
}

const VIDEO_MIME_TYPES = new Set([
  'video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm', 'video/x-matroska',
]);

const dashcamStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const now = new Date();
    const subDir = path.join(DASHCAM_DIR, `${now.getFullYear()}`, String(now.getMonth() + 1).padStart(2, '0'));
    if (!fs.existsSync(subDir)) fs.mkdirSync(subDir, { recursive: true });
    cb(null, subDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

const dashcamUpload = multer({
  storage: dashcamStorage,
  fileFilter: (_req, file, cb) => {
    if (VIDEO_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} is not allowed. Accepted: MP4, MOV, AVI, WebM`));
    }
  },
});

/** Extract video duration using ffprobe. */
async function extractVideoDuration(filePath: string): Promise<number | null> {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of csv=p=0 "${filePath}"`,
      { timeout: 30000 }
    );
    const seconds = parseFloat(stdout.trim());
    return isFinite(seconds) ? Math.round(seconds) : null;
  } catch {
    return null;
  }
}

// ── Router ──────────────────────────────────────────────────

const router = Router();

// Promote ?token= to Authorization header (video elements can't set headers)
router.use((req: Request, _res: Response, next: NextFunction) => {
  if (!req.headers['authorization'] && req.query.token) {
    req.headers['authorization'] = `Bearer ${req.query.token}`;
  }
  next();
});

router.use(authenticateToken);

// ============================================================
// GET /api/dashcam-videos — List with filters
// ============================================================
router.get('/dashcam-videos', requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const {
      officer_id, unit_id, cpg_device_id, event_type,
      classification, case_number, source, from, to,
      limit: limitStr,
    } = req.query;
    const limit = Math.min(parseInt(limitStr as string, 10) || 200, 500);

    let query = `
      SELECT v.*,
        u.full_name as officer_name,
        un.call_sign,
        m.cpg_display_name as device_name
      FROM dashcam_videos v
      LEFT JOIN users u ON v.officer_id = u.id
      LEFT JOIN units un ON v.unit_id = un.id
      LEFT JOIN cpg_device_mappings m ON v.cpg_device_id = m.cpg_device_id AND m.is_active = 1
      WHERE 1=1
    `;
    const params: any[] = [];

    if (officer_id) { query += ' AND v.officer_id = ?'; params.push(officer_id); }
    if (unit_id) { query += ' AND v.unit_id = ?'; params.push(unit_id); }
    if (cpg_device_id) { query += ' AND v.cpg_device_id = ?'; params.push(cpg_device_id); }
    if (event_type) { query += ' AND v.event_type = ?'; params.push(event_type); }
    if (classification) { query += ' AND v.classification = ?'; params.push(classification); }
    if (case_number) { query += ' AND v.case_number = ?'; params.push(case_number); }
    if (source) { query += ' AND v.source = ?'; params.push(source); }
    if (from) { query += ' AND v.recorded_at >= ?'; params.push(from); }
    if (to) { query += ' AND v.recorded_at <= ?'; params.push(to); }

    query += ' ORDER BY v.created_at DESC LIMIT ?';
    params.push(limit);

    const videos = db.prepare(query).all(...params);
    res.json({ videos });
  } catch (error: any) {
    console.error('List dashcam videos error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// GET /api/dashcam-videos/by-officer/:officerId
// Must be BEFORE /:videoId to prevent route collision
// ============================================================
router.get('/dashcam-videos/by-officer/:officerId', requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const officerId = parseInt(req.params.officerId, 10);
    if (isNaN(officerId)) { res.status(400).json({ error: 'Invalid officer ID' }); return; }

    // Find all units for this officer
    const units = db.prepare('SELECT id FROM units WHERE officer_id = ?').all(officerId) as { id: number }[];
    const unitIds = units.map(u => u.id);

    // Build WHERE: officer_id matches OR unit_id in their units
    let whereClause = 'v.officer_id = ?';
    const params: any[] = [officerId];

    if (unitIds.length > 0) {
      const placeholders = unitIds.map(() => '?').join(',');
      whereClause = `(v.officer_id = ? OR v.unit_id IN (${placeholders}))`;
      params.push(...unitIds);
    }

    const videos = db.prepare(`
      SELECT v.*,
        u.full_name as officer_name,
        un.call_sign,
        m.cpg_display_name as device_name
      FROM dashcam_videos v
      LEFT JOIN users u ON v.officer_id = u.id
      LEFT JOIN units un ON v.unit_id = un.id
      LEFT JOIN cpg_device_mappings m ON v.cpg_device_id = m.cpg_device_id AND m.is_active = 1
      WHERE ${whereClause}
      ORDER BY v.created_at DESC
      LIMIT 200
    `).all(...params);

    res.json({ videos });
  } catch (error: any) {
    console.error('Get officer dashcam videos error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// DELETE /api/dashcam-videos/bulk — Bulk delete
// Must be BEFORE /:videoId to prevent route collision
// ============================================================
router.delete('/dashcam-videos/bulk', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { videoIds } = req.body;
    if (!Array.isArray(videoIds) || videoIds.length === 0 || videoIds.length > 100) {
      res.status(400).json({ error: 'videoIds must be an array (1-100 items)' });
      return;
    }

    const placeholders = videoIds.map(() => '?').join(',');
    const videos = db.prepare(
      `SELECT id, file_path, source FROM dashcam_videos WHERE id IN (${placeholders})`
    ).all(...videoIds) as any[];

    let filesDeleted = 0;
    for (const v of videos) {
      if (v.file_path) {
        const fullPath = path.resolve(DASHCAM_DIR, v.file_path);
        const relCheck = path.relative(DASHCAM_DIR, fullPath);
        if (!relCheck.startsWith('..') && fs.existsSync(fullPath)) {
          try { fs.unlinkSync(fullPath); filesDeleted++; } catch { /* skip */ }
        }
      }
    }

    // Reset video_synced flag on linked dashcam_events so they can be re-synced
    const eventPlaceholders = videos.filter((v: any) => v.source !== 'manual' && v.cpg_event_id).map(() => '?').join(',');
    const eventIds = videos.filter((v: any) => v.source !== 'manual' && v.cpg_event_id).map((v: any) => v.cpg_event_id);
    if (eventIds.length > 0) {
      db.prepare(`UPDATE dashcam_events SET video_synced = 0 WHERE id IN (${eventPlaceholders})`).run(...eventIds);
    }

    db.prepare(`DELETE FROM dashcam_videos WHERE id IN (${placeholders})`).run(...videoIds);

    db.prepare(
      "INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, 'dashcam_videos_bulk_delete', 'dashcam_video', 0, ?, ?)"
    ).run(req.user!.userId, `Deleted ${videos.length} video(s), ${filesDeleted} file(s)`, req.ip || 'unknown');

    res.json({ deleted: videos.length, files_deleted: filesDeleted });
  } catch (error: any) {
    console.error('Bulk delete dashcam videos error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// PUT /api/dashcam-videos/bulk — Bulk update classification/retention
// Must be BEFORE /:videoId to prevent route collision
// ============================================================
router.put('/dashcam-videos/bulk', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { videoIds, classification, retention_status } = req.body;
    if (!Array.isArray(videoIds) || videoIds.length === 0 || videoIds.length > 100) {
      res.status(400).json({ error: 'videoIds must be an array (1-100 items)' });
      return;
    }

    const now = localNow();
    const placeholders = videoIds.map(() => '?').join(',');
    const updates: string[] = [];
    const vals: any[] = [];

    if (classification) { updates.push('classification = ?'); vals.push(classification); }
    if (retention_status) { updates.push('retention_status = ?'); vals.push(retention_status); }
    updates.push('updated_at = ?'); vals.push(now);

    if (updates.length <= 1) {
      res.status(400).json({ error: 'Provide classification or retention_status' });
      return;
    }

    db.prepare(
      `UPDATE dashcam_videos SET ${updates.join(', ')} WHERE id IN (${placeholders})`
    ).run(...vals, ...videoIds);

    res.json({ updated: videoIds.length });
  } catch (error: any) {
    console.error('Bulk update dashcam videos error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// POST /api/dashcam-videos/sync — Force CPG data pull
// ============================================================
router.post('/dashcam-videos/sync', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();

    // Find events with video_available=1 that haven't been synced yet
    const unsyncedEvents = db.prepare(`
      SELECT d.*, u.call_sign, usr.full_name as officer_name, usr.id as resolved_officer_id,
        m.cpg_display_name as device_name
      FROM dashcam_events d
      LEFT JOIN units u ON d.unit_id = u.id
      LEFT JOIN users usr ON u.officer_id = usr.id
      LEFT JOIN cpg_device_mappings m ON d.cpg_device_id = m.cpg_device_id AND m.is_active = 1
      WHERE d.video_available = 1 AND (d.video_synced IS NULL OR d.video_synced = 0)
      ORDER BY d.event_timestamp DESC
      LIMIT 200
    `).all() as any[];

    let synced = 0;
    let errors = 0;
    let newVideos = 0;

    const insertVideo = db.prepare(`
      INSERT INTO dashcam_videos (source, cpg_event_id, cpg_video_url, officer_id, unit_id, cpg_device_id,
        title, file_size, recorded_at, event_type, latitude, longitude, heading, speed_mph, address,
        classification, uploaded_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, 'routine', 'system', ?, ?)
    `);

    const markSynced = db.prepare('UPDATE dashcam_events SET video_synced = 1 WHERE id = ?');

    const syncTransaction = db.transaction(() => {
      for (const evt of unsyncedEvents) {
        try {
          // Check if a dashcam_videos record already exists for this event
          const existing = db.prepare(
            'SELECT id FROM dashcam_videos WHERE cpg_event_id = ?'
          ).get(evt.id);

          if (existing) {
            markSynced.run(evt.id);
            synced++;
            continue;
          }

          // Try to extract video URL from raw data
          let videoUrl: string | null = null;
          if (evt.cpg_raw_data) {
            try {
              const rawData = JSON.parse(evt.cpg_raw_data);
              const VIDEO_URL_KEYS = [
                'videoUrl', 'video_url', 'clipUrl', 'clip_url',
                'mediaUrl', 'media_url', 'videoLink', 'video_link',
                'recordingUrl', 'recording_url', 'footageUrl', 'footage_url',
              ];
              for (const key of VIDEO_URL_KEYS) {
                const val = rawData[key];
                if (typeof val === 'string' && (val.startsWith('http://') || val.startsWith('https://'))) {
                  videoUrl = val;
                  break;
                }
              }
            } catch { /* invalid JSON — skip */ }
          }

          // Also check the video_url column directly
          if (!videoUrl && evt.video_url) {
            videoUrl = evt.video_url;
          }

          // Create a dashcam video record (as cpg_proxy if URL found, else cpg_sync placeholder)
          const source = videoUrl ? 'cpg_proxy' : 'cpg_sync';
          const eventLabel = (evt.event_type || 'event').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
          const title = `${eventLabel} — ${evt.call_sign || evt.device_name || 'Unit'} — ${
            new Date(evt.event_timestamp).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
          }`;

          insertVideo.run(
            source, evt.id, videoUrl || null,
            evt.resolved_officer_id || null, evt.unit_id || null, evt.cpg_device_id,
            title,
            evt.event_timestamp, evt.event_type,
            evt.latitude, evt.longitude, evt.heading, evt.speed_mph,
            evt.address,
            now, now,
          );

          markSynced.run(evt.id);
          synced++;
          newVideos++;
        } catch (e: any) {
          console.error(`Dashcam sync error for event ${evt.id}:`, e.message);
          errors++;
        }
      }
    });

    syncTransaction();

    db.prepare(
      "INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, 'dashcam_video_sync', 'dashcam_video', 0, ?, ?)"
    ).run(req.user!.userId, `Synced ${synced}, new ${newVideos}, errors ${errors}`, req.ip || 'unknown');

    res.json({ synced, new_videos: newVideos, errors, total_unsynced: unsyncedEvents.length });
  } catch (error: any) {
    console.error('Dashcam video sync error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// GET /api/dashcam-videos/:videoId — Single video metadata
// ============================================================
router.get('/dashcam-videos/:videoId', requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const video = db.prepare(`
      SELECT v.*,
        u.full_name as officer_name,
        un.call_sign,
        m.cpg_display_name as device_name
      FROM dashcam_videos v
      LEFT JOIN users u ON v.officer_id = u.id
      LEFT JOIN units un ON v.unit_id = un.id
      LEFT JOIN cpg_device_mappings m ON v.cpg_device_id = m.cpg_device_id AND m.is_active = 1
      WHERE v.id = ?
    `).get(req.params.videoId);

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
// GET /api/dashcam-videos/:videoId/stream — Stream with range support
// ============================================================
router.get('/dashcam-videos/:videoId/stream', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const video = db.prepare('SELECT * FROM dashcam_videos WHERE id = ?').get(req.params.videoId) as any;
    if (!video) {
      res.status(404).json({ error: 'Video not found' });
      return;
    }

    // For local files (manual upload or cpg_sync with downloaded file)
    if (video.file_path) {
      const filePath = path.resolve(DASHCAM_DIR, video.file_path);
      const relCheck = path.relative(DASHCAM_DIR, filePath);
      if (relCheck.startsWith('..') || !fs.existsSync(filePath)) {
        console.warn(`[dashcam] Video ${video.id} file missing: ${filePath}`);
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
          'Accept-Ranges': 'bytes',
          'Content-Length': fileSize,
          'Content-Type': video.mime_type || 'video/mp4',
        });

        fs.createReadStream(filePath).pipe(res);
      }
      return;
    }

    // For proxy mode (cpg_video_url only, no local file)
    if (video.cpg_video_url) {
      // Redirect to the CPG URL — the client will handle it
      res.redirect(video.cpg_video_url);
      return;
    }

    // No file and no URL — video record exists but media not available
    res.status(404).json({ error: 'Video media not available. The video event was recorded but the footage has not been downloaded.' });
  } catch (error: any) {
    console.error('Stream dashcam video error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// GET /api/dashcam-videos/:videoId/download-burned — Download with burned overlay
// ============================================================
// FFmpeg renders the dashcam HUD (timestamp, speed, GPS, officer)
// permanently into the video pixels for evidence-quality downloads.

router.get('/dashcam-videos/:videoId/download-burned', async (req: Request, res: Response) => {
  req.setTimeout(600000);   // 10 min for FFmpeg
  res.setTimeout(600000);

  let tempPath = '';
  try {
    const db = getDb();

    // Look up video + officer + unit
    const video = db.prepare(`
      SELECT dv.*,
             u.full_name AS officer_name, u.first_name, u.last_name,
             un.call_sign
      FROM dashcam_videos dv
      LEFT JOIN users u ON dv.officer_id = u.id
      LEFT JOIN units un ON dv.unit_id = un.id
      WHERE dv.id = ?
    `).get(req.params.videoId) as any;

    if (!video) {
      res.status(404).json({ error: 'Video not found' });
      return;
    }

    // Must have a local file — can't burn overlay on proxy-only videos
    if (!video.file_path) {
      res.status(400).json({ error: 'Cannot burn overlay on proxy-only videos. Download the video locally first.' });
      return;
    }

    const filePath = path.resolve(DASHCAM_DIR, video.file_path);
    const relCheck = path.relative(DASHCAM_DIR, filePath);
    if (relCheck.startsWith('..') || !fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Video file not found on disk' });
      return;
    }

    // Probe video dimensions
    const probe = await probeVideo(filePath);

    // Build dashcam overlay filter
    const officerName = video.officer_name || [video.first_name, video.last_name].filter(Boolean).join(' ') || '';
    const filter = buildDashcamFilter(probe.width, probe.height, {
      officerName,
      callSign: video.call_sign || '',
      speedMph: video.speed_mph ?? null,
      heading: video.heading ?? null,
      address: video.address || '',
      latitude: video.latitude ?? null,
      longitude: video.longitude ?? null,
      recordedAt: video.recorded_at || null,
    });

    // Create temp output
    tempPath = path.join(os.tmpdir(), `rmpg_burn_dash_${video.id}_${Date.now()}.mp4`);

    // Burn overlay
    await burnOverlay(filePath, tempPath, filter);

    // Build download filename
    const datePart = video.recorded_at
      ? new Date(video.recorded_at).toISOString().slice(0, 10).replace(/-/g, '')
      : 'undated';
    const safeName = (officerName || 'Unknown').replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30);
    const unitTag = video.call_sign ? `_${video.call_sign.replace(/[^a-zA-Z0-9]/g, '')}` : '';
    const downloadName = `Dashcam_${safeName}${unitTag}_${datePart}.mp4`;

    // Stream burned file
    const stat = fs.statSync(tempPath);
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);

    const stream = fs.createReadStream(tempPath);
    stream.pipe(res);
    stream.on('end', () => {
      try { fs.unlinkSync(tempPath); } catch { /* ignore */ }
    });
    stream.on('error', () => {
      try { fs.unlinkSync(tempPath); } catch { /* ignore */ }
    });
  } catch (error: any) {
    console.error('Burn dashcam overlay error:', error);
    if (tempPath) {
      try { fs.unlinkSync(tempPath); } catch { /* ignore */ }
    }
    if (!res.headersSent) {
      res.status(500).json({ error: `Overlay burn failed: ${error.message}` });
    }
  }
});

// ============================================================
// POST /api/dashcam-videos — Manual upload
// ============================================================
router.post('/dashcam-videos', requireRole('admin'), (req: Request, res: Response) => {
  req.setTimeout(600000);
  res.setTimeout(600000);

  // Pre-flight: verify upload directory
  try {
    if (!fs.existsSync(DASHCAM_DIR)) fs.mkdirSync(DASHCAM_DIR, { recursive: true });
    fs.accessSync(DASHCAM_DIR, fs.constants.W_OK);
  } catch (dirErr: any) {
    console.error('Dashcam upload dir not writable:', DASHCAM_DIR, dirErr);
    res.status(503).json({ error: `Upload storage is unavailable: ${dirErr.message}` });
    return;
  }

  try {
    dashcamUpload.single('video')(req, res, (multerErr: any) => {
      if (multerErr) {
        console.error('Dashcam multer error:', multerErr?.message, multerErr?.code);
        res.status(400).json({ error: multerErr.message || 'Upload failed' });
        return;
      }

      try {
        const db = getDb();
        const file = req.file;
        if (!file) {
          res.status(400).json({ error: 'No video file provided' });
          return;
        }

        const { title, officer_id, unit_id, cpg_device_id, event_type,
                duration_seconds, recorded_at, case_number, classification,
                notes, latitude, longitude, heading, speed_mph, address } = req.body;

        if (!title) {
          if (file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
          res.status(400).json({ error: 'title is required' });
          return;
        }

        const diskStat = fs.statSync(file.path);
        const verifiedSize = diskStat.size;
        const relativePath = path.relative(DASHCAM_DIR, file.path);

        // Validate file was saved within DASHCAM_DIR
        if (relativePath.startsWith('..')) {
          if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
          res.status(400).json({ error: 'Upload path validation failed' });
          return;
        }

        const now = localNow();

        const result = db.prepare(`
          INSERT INTO dashcam_videos (source, officer_id, unit_id, cpg_device_id, title,
            file_path, file_size, duration_seconds, mime_type, recorded_at, event_type,
            latitude, longitude, heading, speed_mph, address,
            case_number, classification, notes, uploaded_by, created_at, updated_at)
          VALUES ('manual', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          officer_id || null, unit_id || null, cpg_device_id || null,
          title, relativePath, verifiedSize,
          duration_seconds || null, file.mimetype,
          recorded_at || now, event_type || null,
          latitude || null, longitude || null, heading || null, speed_mph || null, address || null,
          case_number || null, classification || 'routine', notes || null,
          String(req.user!.userId), now, now,
        );

        const videoId = result.lastInsertRowid;

        const video = db.prepare(`
          SELECT v.*,
            u.full_name as officer_name,
            un.call_sign,
            m.cpg_display_name as device_name
          FROM dashcam_videos v
          LEFT JOIN users u ON v.officer_id = u.id
          LEFT JOIN units un ON v.unit_id = un.id
          LEFT JOIN cpg_device_mappings m ON v.cpg_device_id = m.cpg_device_id AND m.is_active = 1
          WHERE v.id = ?
        `).get(videoId);

        // Fire-and-forget: extract actual duration with ffprobe
        const fullFilePath = path.resolve(DASHCAM_DIR, relativePath);
        extractVideoDuration(fullFilePath).then((probedDuration) => {
          if (probedDuration != null) {
            try {
              const dbInner = getDb();
              dbInner.prepare('UPDATE dashcam_videos SET duration_seconds = ?, updated_at = ? WHERE id = ?')
                .run(probedDuration, localNow(), videoId);
            } catch (e: any) {
              console.warn('ffprobe duration update failed:', e?.message);
            }
          }
        }).catch(() => { /* ffprobe not available */ });

        db.prepare(
          "INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, 'dashcam_video_uploaded', 'dashcam_video', ?, ?, ?)"
        ).run(req.user!.userId, videoId, `Uploaded: ${title}`, req.ip || 'unknown');

        // Fire-and-forget: generate source.txt sidecar with metadata + video specs
        const joinedVideo = video as any;
        generateDashcamSourceFile(fullFilePath, {
          videoId: Number(videoId),
          title,
          source: 'manual',
          officerName: joinedVideo?.officer_name || '',
          callSign: joinedVideo?.call_sign || '',
          deviceName: joinedVideo?.device_name || '',
          fileName: path.basename(file.path),
          fileSize: verifiedSize,
          mimeType: file.mimetype,
          durationSeconds: duration_seconds ? parseInt(duration_seconds) : null,
          recordedAt: recorded_at || null,
          eventType: event_type || null,
          latitude: latitude ? parseFloat(latitude) : null,
          longitude: longitude ? parseFloat(longitude) : null,
          heading: heading ? parseFloat(heading) : null,
          speedMph: speed_mph ? parseFloat(speed_mph) : null,
          address: address || '',
          caseNumber: case_number || '',
          classification: classification || 'routine',
          retentionStatus: 'active',
          notes: notes || '',
          uploadedBy: req.user!.username || String(req.user!.userId),
          uploadedAt: now,
        }).catch(err => console.warn('Source file generation failed:', err?.message));

        res.status(201).json(video);
      } catch (error: any) {
        console.error('Upload dashcam video DB error:', error?.message, error?.stack);
        res.status(500).json({ error: `Upload processing failed: ${error?.message || 'Internal server error'}` });
      }
    });
  } catch (outerErr: any) {
    console.error('Dashcam upload outer error:', outerErr?.message);
    if (!res.headersSent) {
      res.status(500).json({ error: `Upload failed: ${outerErr?.message || 'Internal server error'}` });
    }
  }
});

// ============================================================
// PUT /api/dashcam-videos/:videoId — Update metadata
// ============================================================
router.put('/dashcam-videos/:videoId', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT id FROM dashcam_videos WHERE id = ?').get(req.params.videoId) as any;
    if (!existing) {
      res.status(404).json({ error: 'Video not found' });
      return;
    }

    const { title, classification, retention_status, case_number, notes, event_type, recorded_at, duration_seconds, speed_mph, address } = req.body;
    const now = localNow();

    const updates: string[] = [];
    const vals: any[] = [];

    if (title !== undefined) { updates.push('title = ?'); vals.push(title); }
    if (classification !== undefined) { updates.push('classification = ?'); vals.push(classification); }
    if (retention_status !== undefined) { updates.push('retention_status = ?'); vals.push(retention_status); }
    if (case_number !== undefined) { updates.push('case_number = ?'); vals.push(case_number); }
    if (notes !== undefined) { updates.push('notes = ?'); vals.push(notes); }
    if (event_type !== undefined) { updates.push('event_type = ?'); vals.push(event_type); }
    if (recorded_at !== undefined) { updates.push('recorded_at = ?'); vals.push(recorded_at); }
    if (duration_seconds !== undefined) { updates.push('duration_seconds = ?'); vals.push(duration_seconds); }
    if (speed_mph !== undefined) { updates.push('speed_mph = ?'); vals.push(speed_mph || null); }
    if (address !== undefined) { updates.push('address = ?'); vals.push(address || null); }

    updates.push('updated_at = ?'); vals.push(now);
    vals.push(req.params.videoId);

    db.prepare(`UPDATE dashcam_videos SET ${updates.join(', ')} WHERE id = ?`).run(...vals);

    const video = db.prepare(`
      SELECT v.*,
        u.full_name as officer_name,
        un.call_sign,
        m.cpg_display_name as device_name
      FROM dashcam_videos v
      LEFT JOIN users u ON v.officer_id = u.id
      LEFT JOIN units un ON v.unit_id = un.id
      LEFT JOIN cpg_device_mappings m ON v.cpg_device_id = m.cpg_device_id AND m.is_active = 1
      WHERE v.id = ?
    `).get(req.params.videoId);

    res.json(video);
  } catch (error: any) {
    console.error('Update dashcam video error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// DELETE /api/dashcam-videos/:videoId — Delete video + file
// ============================================================
router.delete('/dashcam-videos/:videoId', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const video = db.prepare('SELECT * FROM dashcam_videos WHERE id = ?').get(req.params.videoId) as any;
    if (!video) {
      res.status(404).json({ error: 'Video not found' });
      return;
    }

    // Delete file from disk if it exists
    if (video.file_path) {
      const fullPath = path.resolve(DASHCAM_DIR, video.file_path);
      const relCheck = path.relative(DASHCAM_DIR, fullPath);
      if (!relCheck.startsWith('..') && fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
      }
    }

    // Reset video_synced flag on linked dashcam_event so it can be re-synced
    if (video.cpg_event_id && video.source !== 'manual') {
      db.prepare('UPDATE dashcam_events SET video_synced = 0 WHERE id = ?').run(video.cpg_event_id);
    }

    db.prepare('DELETE FROM dashcam_videos WHERE id = ?').run(video.id);

    db.prepare(
      "INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, 'dashcam_video_deleted', 'dashcam_video', ?, ?, ?)"
    ).run(req.user!.userId, video.id, `Deleted: ${video.title}`, req.ip || 'unknown');

    res.json({ message: 'Video deleted' });
  } catch (error: any) {
    console.error('Delete dashcam video error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

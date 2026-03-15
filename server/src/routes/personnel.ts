import { Router, Request, Response, NextFunction } from 'express';
import bcryptjs from 'bcryptjs';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { localNow, localToday } from '../utils/timeUtils';
import { queueOverlayProcessing, type BodyCamOverlayConfig } from '../utils/videoOverlay';

const execAsync = promisify(exec);

/** Extract video duration using ffprobe. Returns seconds or null if ffmpeg not available. */
async function extractVideoDuration(filePath: string): Promise<number | null> {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of csv=p=0 "${filePath}"`,
      { timeout: 30000 }
    );
    const seconds = parseFloat(stdout.trim());
    return isFinite(seconds) ? Math.round(seconds) : null;
  } catch {
    return null; // ffprobe not installed or failed
  }
}

const __filename_p = fileURLToPath(import.meta.url);
const __dirname_p = path.dirname(__filename_p);
const BODYCAM_DIR = process.env.RMPG_UPLOADS_DIR
  ? path.join(process.env.RMPG_UPLOADS_DIR, 'bodycam')
  : path.resolve(__dirname_p, '../../uploads/bodycam');

if (!fs.existsSync(BODYCAM_DIR)) {
  fs.mkdirSync(BODYCAM_DIR, { recursive: true });
}

const VIDEO_MIME_TYPES = new Set([
  'video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm', 'video/x-matroska',
]);

const bodycamStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const now = new Date();
    const subDir = path.join(BODYCAM_DIR, `${now.getFullYear()}`, String(now.getMonth() + 1).padStart(2, '0'));
    if (!fs.existsSync(subDir)) fs.mkdirSync(subDir, { recursive: true });
    cb(null, subDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

const bodycamUpload = multer({
  storage: bodycamStorage,
  limits: { fileSize: 10 * 1024 * 1024 * 1024 }, // 10 GB max per file
  fileFilter: (_req, file, cb) => {
    if (VIDEO_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} is not allowed. Accepted: MP4, MOV, AVI, WebM`));
    }
  },
});

// Chunked upload storage — raw binary chunks saved to temp dir
const CHUNK_DIR = path.resolve(BODYCAM_DIR, '_chunks');
if (!fs.existsSync(CHUNK_DIR)) fs.mkdirSync(CHUNK_DIR, { recursive: true });
const CHUNK_SIZE = 10 * 1024 * 1024; // 10 MB chunk size

const chunkUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, CHUNK_DIR),
    filename: (_req, _file, cb) => cb(null, `chunk_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`),
  }),
  limits: { fileSize: CHUNK_SIZE + 1024 * 1024 }, // chunk + 1MB safety margin
});

const router = Router();

// Promote query-string token to Authorization header BEFORE authenticateToken runs.
// <video> elements can't set custom headers, so the VideoPlayer passes the JWT as
// ?token=... on the streaming URL. This middleware promotes it so authenticateToken
// can validate it normally. Scoped to video streaming routes ONLY to limit attack surface.
router.use((req: Request, res: Response, next: NextFunction) => {
  const isVideoRoute = /\/(bodycam-videos|body-cameras)\//.test(req.path)
    && /(stream|download|thumbnail)/.test(req.path);
  if (!req.headers['authorization'] && req.query.token && isVideoRoute) {
    req.headers['authorization'] = `Bearer ${req.query.token}`;
  }
  next();
});

router.use(authenticateToken);

// ─── USERS / OFFICERS ─────────────────────────────────

// GET /api/personnel - List all personnel
// Restricted to sworn/dispatch/command roles — contract_manager must NOT see officer PII
router.get('/', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { role, status, archived } = req.query;

    let whereClause = 'WHERE 1=1';
    const params: any[] = [];

    if (role) {
      whereClause += ' AND role = ?';
      params.push(role);
    }
    if (status) {
      whereClause += ' AND status = ?';
      params.push(status);
    }

    // Archive filter
    if (archived === 'true') {
      whereClause += ' AND archived_at IS NOT NULL';
    } else if (archived !== 'all') {
      whereClause += ' AND archived_at IS NULL';
    }

    const users = db.prepare(`
      SELECT u.id, u.username, u.full_name, u.first_name, u.last_name, u.middle_name, u.email, u.role,
        u.badge_number, u.phone, u.status, u.avatar_url, u.rank, u.department, u.address, u.city, u.state, u.zip,
        u.date_of_birth, u.hire_date, u.termination_date, u.shift_preference,
        u.dl_number, u.dl_state, u.dl_expiry, u.blood_type, u.allergies, u.uniform_size,
        u.emergency_contact_name, u.emergency_contact_phone, u.emergency_contact_relationship,
        u.employee_id, u.certifications, u.notes, u.profile_image,
        u.login_count, u.last_login_at,
        u.totp_enabled, u.totp_setup_required, u.password_expires_at, u.force_password_change, u.password_changed_at,
        u.created_at, u.updated_at,
        un.call_sign as unit_call_sign
      FROM users u
      LEFT JOIN units un ON un.officer_id = u.id
      ${whereClause.replace(/\bstatus\b/g, 'u.status').replace(/\brole\b/g, 'u.role').replace(/\barchived_at\b/g, 'u.archived_at')}
      ORDER BY u.full_name
    `).all(...params);

    res.json(users);
  } catch (error: any) {
    console.error('Get personnel error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/personnel/:id - Get user details
router.get('/:id', (req: Request, res: Response, next) => {
  try {
    // Check for route conflicts with sub-paths handled by mountScheduleRoutes
    const subPaths = ['schedules', 'time', 'credentials', 'training', 'training-requirements', 'deployments', 'coverage-gaps', 'analytics', 'activity', 'equipment', 'body-cameras', 'bodycam-videos'];
    if (subPaths.includes(String(req.params.id))) {
      return next('route');
    }

    const db = getDb();
    const user = db.prepare(`
      SELECT id, username, full_name, first_name, last_name, middle_name, email, role, badge_number, phone, status, avatar_url,
        rank, department, address, city, state, zip, date_of_birth, hire_date, termination_date,
        shift_preference, dl_number, dl_state, dl_expiry, blood_type, allergies, uniform_size,
        emergency_contact_name, emergency_contact_phone, emergency_contact_relationship,
        created_at, updated_at
      FROM users WHERE id = ?
    `).get(req.params.id) as any;

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Get associated unit
    const unit = db.prepare('SELECT * FROM units WHERE officer_id = ?').get(user.id);

    // Get credentials
    const credentials = db.prepare('SELECT * FROM credentials WHERE officer_id = ? ORDER BY credential_type').all(user.id);

    // Get current schedule
    const today = localToday();
    const todaySchedule = db.prepare(`
      SELECT s.*, p.name as property_name
      FROM schedules s
      LEFT JOIN properties p ON s.property_id = p.id
      WHERE s.officer_id = ? AND s.shift_date = ?
    `).all(user.id, today);

    // Get active time entry
    const activeTimeEntry = db.prepare(`
      SELECT * FROM time_entries WHERE officer_id = ? AND status = 'active' ORDER BY clock_in DESC LIMIT 1
    `).get(user.id);

    res.json({
      ...user,
      unit,
      credentials,
      todaySchedule,
      activeTimeEntry,
    });
  } catch (error: any) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/personnel - Create user (admin/manager only)
router.post('/', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const {
      username, password, full_name, email, role, badge_number, phone,
      first_name, last_name, middle_name, rank, department,
      address, city, state, zip, date_of_birth, hire_date, termination_date,
      shift_preference, dl_number, dl_state, dl_expiry, blood_type,
      allergies, uniform_size,
      emergency_contact_name, emergency_contact_phone, emergency_contact_relationship,
      employee_id, certifications, notes, profile_image,
    } = req.body;

    if (!username || !password || !full_name || !role) {
      res.status(400).json({ error: 'username, password, full_name, and role are required' });
      return;
    }

    // Validate role against allowlist
    const VALID_ROLES = ['admin', 'manager', 'supervisor', 'officer', 'dispatcher', 'contract_manager'];
    if (!VALID_ROLES.includes(role)) {
      res.status(400).json({ error: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}` });
      return;
    }
    // Only admins can create admin accounts
    if (role === 'admin' && req.user!.role !== 'admin') {
      res.status(403).json({ error: 'Only admins can create admin accounts' });
      return;
    }

    // Check username uniqueness
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) {
      res.status(409).json({ error: 'Username already exists' });
      return;
    }

    const passwordHash = bcryptjs.hashSync(password, 10);

    // Derive first_name/last_name from full_name if not provided
    const nameParts = (full_name || '').split(' ');
    const derivedFirst = first_name || nameParts[0] || '';
    const derivedLast = last_name || nameParts.slice(1).join(' ') || '';

    const result = db.prepare(`
      INSERT INTO users (username, password_hash, full_name, first_name, last_name, email, role, badge_number, phone,
        middle_name, rank, department, address, city, state, zip,
        date_of_birth, hire_date, termination_date, shift_preference,
        dl_number, dl_state, dl_expiry, blood_type, allergies, uniform_size,
        emergency_contact_name, emergency_contact_phone, emergency_contact_relationship,
        employee_id, certifications, notes, profile_image, last_password_change, must_change_password)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?, ?, 1)
    `).run(
      username, passwordHash, full_name, derivedFirst, derivedLast,
      email || null, role, badge_number || null, phone || null,
      middle_name || null, rank || null, department || null,
      address || null, city || null, state || null, zip || null,
      date_of_birth || null, hire_date || null, termination_date || null, shift_preference || null,
      dl_number || null, dl_state || null, dl_expiry || null, blood_type || null,
      allergies || null, uniform_size || null,
      emergency_contact_name || null, emergency_contact_phone || null, emergency_contact_relationship || null,
      employee_id || null, certifications || null, notes || null, profile_image || null,
      localNow()
    );

    const user = db.prepare(`
      SELECT id, username, full_name, first_name, last_name, middle_name, email, role,
        badge_number, phone, status, avatar_url, rank, department, address, city, state, zip,
        date_of_birth, hire_date, termination_date, shift_preference,
        dl_number, dl_state, dl_expiry, blood_type, allergies, uniform_size,
        emergency_contact_name, emergency_contact_phone, emergency_contact_relationship,
        employee_id, certifications, notes, profile_image,
        created_at, updated_at
      FROM users WHERE id = ?
    `).get(result.lastInsertRowid);

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'user_created', 'user', ?, ?, ?)
    `).run(req.user!.userId, result.lastInsertRowid, `Created user: ${username} (${role})`, req.ip || 'unknown');

    res.status(201).json(user);
  } catch (error: any) {
    console.error('Create user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/personnel/:id - Update user
router.put('/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id) as any;
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Validate role against allowlist if provided
    const VALID_ROLES = ['admin', 'manager', 'supervisor', 'officer', 'dispatcher', 'contract_manager'];
    if (req.body.role && !VALID_ROLES.includes(req.body.role)) {
      res.status(400).json({ error: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}` });
      return;
    }
    // Only admins can assign the admin role; prevent self-role-modification
    if (req.body.role) {
      if (req.body.role === 'admin' && req.user!.role !== 'admin') {
        res.status(403).json({ error: 'Only admins can assign the admin role' });
        return;
      }
      if (String(req.params.id) === String(req.user!.userId)) {
        res.status(403).json({ error: 'Cannot change your own role' });
        return;
      }
    }

    // Build dynamic SET clause — only update fields explicitly provided in the body.
    // This allows clearing fields by sending empty string (stored as null).
    const bodyKeys = Object.keys(req.body);
    const updatableFields = [
      'full_name', 'first_name', 'last_name', 'email', 'role', 'badge_number',
      'phone', 'status', 'middle_name', 'rank', 'department',
      'address', 'city', 'state', 'zip', 'date_of_birth', 'hire_date',
      'termination_date', 'shift_preference', 'dl_number', 'dl_state', 'dl_expiry',
      'blood_type', 'allergies', 'uniform_size',
      'emergency_contact_name', 'emergency_contact_phone', 'emergency_contact_relationship',
      'employee_id', 'certifications', 'notes', 'profile_image',
    ];

    const setClauses: string[] = [];
    const setValues: any[] = [];
    for (const field of updatableFields) {
      if (bodyKeys.includes(field)) {
        setClauses.push(`${field} = ?`);
        const val = req.body[field];
        setValues.push(val === '' ? null : val ?? null);
      }
    }

    // ── Admin password reset (not in updatableFields — needs bcrypt) ──
    const passwordChanged = !!(req.body.password && typeof req.body.password === 'string' && req.body.password.trim());
    if (passwordChanged) {
      const hash = bcryptjs.hashSync(req.body.password.trim(), 10);
      setClauses.push('password_hash = ?');
      setValues.push(hash);
      setClauses.push('last_password_change = ?');
      setValues.push(localNow());
      // Force the user to change their password on next login
      setClauses.push('must_change_password = ?');
      setValues.push(1);
    }

    if (setClauses.length > 0) {
      setClauses.push("updated_at = ?");
      setValues.push(localNow());
      setValues.push(req.params.id);
      db.prepare(`UPDATE users SET ${setClauses.join(', ')} WHERE id = ?`).run(...setValues);
    }

    // ── Invalidate sessions on password reset or account suspension ──
    const statusChanged = bodyKeys.includes('status') && req.body.status !== user.status;
    if (passwordChanged || (statusChanged && req.body.status !== 'active')) {
      db.prepare('UPDATE sessions SET is_active = 0 WHERE user_id = ?').run(req.params.id);
    }

    const updated = db.prepare(`
      SELECT id, username, full_name, first_name, last_name, middle_name, email, role,
        badge_number, phone, status, avatar_url, rank, department, address, city, state, zip,
        date_of_birth, hire_date, termination_date, shift_preference,
        dl_number, dl_state, dl_expiry, blood_type, allergies, uniform_size,
        emergency_contact_name, emergency_contact_phone, emergency_contact_relationship,
        employee_id, certifications, notes, profile_image,
        created_at, updated_at
      FROM users WHERE id = ?
    `).get(req.params.id);

    res.json(updated);
  } catch (error: any) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/personnel/:id - Soft-delete (terminate) user
router.delete('/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id) as any;
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    if (user.status === 'terminated') {
      res.status(400).json({ error: 'User is already terminated' });
      return;
    }

    const delTx = db.transaction(() => {
      db.prepare(`
        UPDATE users SET status = 'terminated', termination_date = ?, updated_at = ?
        WHERE id = ?
      `).run(localNow(), localNow(), req.params.id);
      // Invalidate all active sessions for terminated user
      db.prepare('UPDATE sessions SET is_active = 0 WHERE user_id = ?').run(req.params.id);
      // Free assigned units
      db.prepare('UPDATE units SET officer_id = NULL, status = \'off_duty\' WHERE officer_id = ?').run(req.params.id);
      // Log activity
      db.prepare(`
        INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, 'user_terminated', 'user', ?, ?, ?)
      `).run(req.user!.userId, req.params.id, `Terminated user: ${user.full_name || user.username}`, req.ip || 'unknown');
    });
    delTx();

    res.json({ success: true, id: req.params.id });
  } catch (error: any) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/personnel/:id/archive - Archive terminated user
router.post('/:id/archive', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id) as any;
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }
    if (user.status !== 'terminated') {
      res.status(400).json({ error: 'Only terminated users can be archived' }); return;
    }
    if (user.archived_at) { res.status(400).json({ error: 'User is already archived' }); return; }

    const now = localNow();
    db.prepare('UPDATE users SET archived_at = ? WHERE id = ?').run(now, user.id);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'user_archived', 'user', ?, ?, ?)`).run(
      req.user!.userId, user.id, `Archived user: ${user.full_name}`, req.ip || 'unknown');

    const updated = db.prepare(`
      SELECT id, username, full_name, first_name, last_name, email, role, badge_number, phone, status, archived_at, created_at, updated_at
      FROM users WHERE id = ?
    `).get(user.id);
    res.json(updated);
  } catch (error: any) {
    console.error('Archive user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/personnel/:id/unarchive
router.post('/:id/unarchive', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id) as any;
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }
    if (!user.archived_at) { res.status(400).json({ error: 'User is not archived' }); return; }

    db.prepare('UPDATE users SET archived_at = NULL WHERE id = ?').run(user.id);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'user_unarchived', 'user', ?, ?, ?)`).run(
      req.user!.userId, user.id, `Unarchived user: ${user.full_name}`, req.ip || 'unknown');

    const updated = db.prepare(`
      SELECT id, username, full_name, first_name, last_name, email, role, badge_number, phone, status, archived_at, created_at, updated_at
      FROM users WHERE id = ?
    `).get(user.id);
    res.json(updated);
  } catch (error: any) {
    console.error('Unarchive user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── BODYCAM VIDEO STREAMING ─────────────────────────
// Must live on this router (not parentRouter) because app.use('/api/personnel', router)
// intercepts the path first. The blanket router.use() above handles token promotion
// and authenticateToken, so no additional auth middleware needed here.

router.get('/bodycam-videos/:videoId/stream', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const video = db.prepare('SELECT * FROM bodycam_videos WHERE id = ?').get(req.params.videoId) as any;
    if (!video) {
      res.status(404).json({ error: 'Video not found' });
      return;
    }

    // Serve processed (overlaid) file if available, otherwise original
    const servePath = (video.overlay_status === 'complete' && video.processed_file_path)
      ? path.resolve(BODYCAM_DIR, video.processed_file_path)
      : path.resolve(BODYCAM_DIR, video.file_path);

    const filePath = fs.existsSync(servePath) ? servePath : path.resolve(BODYCAM_DIR, video.file_path);

    if (!filePath.startsWith(BODYCAM_DIR) || !fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Video file not found on disk' });
      return;
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const mimeType = filePath.endsWith('.mp4') ? 'video/mp4' : (video.mime_type || 'video/mp4');
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
        'Content-Type': mimeType,
      });

      const stream = fs.createReadStream(filePath, { start, end });
      stream.on('error', (err) => { console.error('Bodycam stream error:', err); res.destroy(); });
      stream.pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': mimeType,
      });

      const stream = fs.createReadStream(filePath);
      stream.on('error', (err) => { console.error('Bodycam stream error:', err); res.destroy(); });
      stream.pipe(res);
    }
  } catch (error: any) {
    console.error('Stream bodycam video error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/personnel/bodycam-videos/:videoId/download — Force-download with overlay ──
router.get('/bodycam-videos/:videoId/download', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const video = db.prepare('SELECT * FROM bodycam_videos WHERE id = ?').get(req.params.videoId) as any;
    if (!video) {
      res.status(404).json({ error: 'Video not found' });
      return;
    }

    const servePath = (video.overlay_status === 'complete' && video.processed_file_path)
      ? path.resolve(BODYCAM_DIR, video.processed_file_path)
      : path.resolve(BODYCAM_DIR, video.file_path);

    const filePath = fs.existsSync(servePath) ? servePath : path.resolve(BODYCAM_DIR, video.file_path);

    if (!filePath.startsWith(BODYCAM_DIR) || !fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Video file not found on disk' });
      return;
    }

    const stat = fs.statSync(filePath);
    const safeTitle = (video.title || `bodycam_${video.id}`).replace(/[^a-zA-Z0-9_\-. ]/g, '_');
    res.writeHead(200, {
      'Content-Type': 'video/mp4',
      'Content-Length': stat.size,
      'Content-Disposition': `attachment; filename="BWC_${safeTitle}.mp4"`,
    });
    fs.createReadStream(filePath).pipe(res);
  } catch (error: any) {
    console.error('Download bodycam video error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── SCHEDULES / TIME / CREDENTIALS ──────────────────
// These routes are handled via mountScheduleRoutes() in index.ts
// to avoid /:id route conflicts in this sub-router.

export default router;

// We export schedule and time routes separately for cleaner organization
export function mountScheduleRoutes(parentRouter: Router): void {
  // GET /api/personnel/schedules
  parentRouter.get('/personnel/schedules', authenticateToken, (req: Request, res: Response) => {
    try {
      const db = getDb();
      const { officerId, propertyId, startDate, endDate, status } = req.query;

      let whereClause = 'WHERE 1=1';
      const params: any[] = [];

      if (officerId) {
        whereClause += ' AND s.officer_id = ?';
        params.push(officerId);
      }
      if (propertyId) {
        whereClause += ' AND s.property_id = ?';
        params.push(propertyId);
      }
      if (startDate) {
        whereClause += ' AND s.shift_date >= ?';
        params.push(startDate);
      }
      if (endDate) {
        whereClause += ' AND s.shift_date <= ?';
        params.push(endDate);
      }
      if (status) {
        whereClause += ' AND s.status = ?';
        params.push(status);
      }

      // If officer, only show their own schedules
      if (req.user!.role === 'officer') {
        whereClause += ' AND s.officer_id = ?';
        params.push(req.user!.userId);
      }

      const schedules = db.prepare(`
        SELECT s.*, u.full_name as officer_name, u.badge_number, p.name as property_name
        FROM schedules s
        LEFT JOIN users u ON s.officer_id = u.id
        LEFT JOIN properties p ON s.property_id = p.id
        ${whereClause}
        ORDER BY s.shift_date, s.start_time
      `).all(...params);

      res.json(schedules);
    } catch (error: any) {
      console.error('Get schedules error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/personnel/schedules
  parentRouter.post('/personnel/schedules', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const { officer_id, property_id, shift_date, start_time, end_time, notes } = req.body;

      if (!officer_id || !shift_date || !start_time || !end_time) {
        res.status(400).json({ error: 'officer_id, shift_date, start_time, and end_time are required' });
        return;
      }

      const result = db.prepare(`
        INSERT INTO schedules (officer_id, property_id, shift_date, start_time, end_time, notes)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(officer_id, property_id || null, shift_date, start_time, end_time, notes || null);

      const schedule = db.prepare(`
        SELECT s.*, u.full_name as officer_name, p.name as property_name
        FROM schedules s
        LEFT JOIN users u ON s.officer_id = u.id
        LEFT JOIN properties p ON s.property_id = p.id
        WHERE s.id = ?
      `).get(result.lastInsertRowid);

      res.status(201).json(schedule);
    } catch (error: any) {
      console.error('Create schedule error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/personnel/time/clock-in
  parentRouter.post('/personnel/time/clock-in', authenticateToken, (req: Request, res: Response) => {
    try {
      const db = getDb();
      const { officer_id, latitude, longitude, schedule_id } = req.body;

      // Allow supervisors/admins/dispatchers to clock in other officers; officers can only clock themselves
      const targetId = officer_id || req.user!.userId;
      const isSelf = String(targetId) === String(req.user!.userId);
      if (!isSelf && !['admin', 'manager', 'supervisor', 'dispatcher'].includes(req.user!.role)) {
        res.status(403).json({ error: 'You can only clock in yourself' });
        return;
      }

      // Check if already clocked in
      const activeEntry = db.prepare(`
        SELECT * FROM time_entries WHERE officer_id = ? AND status IN ('active', 'on_break')
      `).get(targetId) as any;

      if (activeEntry) {
        res.status(400).json({ error: 'Already clocked in', activeEntry });
        return;
      }

      const now = localNow();

      const result = db.prepare(`
        INSERT INTO time_entries (officer_id, schedule_id, clock_in, clock_in_latitude, clock_in_longitude)
        VALUES (?, ?, ?, ?, ?)
      `).run(targetId, schedule_id || null, now, latitude ?? null, longitude ?? null);

      // Update schedule status if linked
      if (schedule_id) {
        db.prepare("UPDATE schedules SET status = 'active' WHERE id = ?").run(schedule_id);
      }

      const officerName = (db.prepare('SELECT full_name FROM users WHERE id = ?').get(targetId) as any)?.full_name || targetId;
      db.prepare(`
        INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, 'clock_in', 'time_entry', ?, ?, ?)
      `).run(req.user!.userId, result.lastInsertRowid, isSelf ? 'Clocked in' : `Clocked in ${officerName}`, req.ip || 'unknown');

      const entry = db.prepare(`
        SELECT t.*, u.full_name as officer_name, u.badge_number
        FROM time_entries t LEFT JOIN users u ON t.officer_id = u.id WHERE t.id = ?
      `).get(result.lastInsertRowid);
      res.status(201).json(entry);
    } catch (error: any) {
      console.error('Clock in error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/personnel/time/clock-out
  parentRouter.post('/personnel/time/clock-out', authenticateToken, (req: Request, res: Response) => {
    try {
      const db = getDb();
      const { officer_id } = req.body;

      // Allow supervisors/admins/dispatchers to clock out other officers
      const targetId = officer_id || req.user!.userId;
      const isSelf = String(targetId) === String(req.user!.userId);
      if (!isSelf && !['admin', 'manager', 'supervisor', 'dispatcher'].includes(req.user!.role)) {
        res.status(403).json({ error: 'You can only clock out yourself' });
        return;
      }

      const activeEntry = db.prepare(`
        SELECT * FROM time_entries WHERE officer_id = ? AND status IN ('active', 'on_break') ORDER BY clock_in DESC LIMIT 1
      `).get(targetId) as any;

      if (!activeEntry) {
        res.status(400).json({ error: 'Not currently clocked in' });
        return;
      }

      const now = localNow();

      // If on break, end the break first and accumulate break minutes
      let breakMins = Number(activeEntry.break_minutes) || 0;
      if (activeEntry.status === 'on_break' && activeEntry.break_start) {
        const breakStart = new Date(activeEntry.break_start.replace(' ', 'T'));
        const breakEnd = new Date(now.replace(' ', 'T'));
        breakMins += Math.round(((breakEnd.getTime() - breakStart.getTime()) / 60000) * 10000) / 10000;
      }

      // Calculate total hours (subtract break time) — preserve 4 decimal precision
      const clockIn = new Date(activeEntry.clock_in.replace(' ', 'T'));
      const clockOut = new Date(now.replace(' ', 'T'));
      const rawHours = (clockOut.getTime() - clockIn.getTime()) / 3600000;
      const totalHours = Math.max(0, Math.round((rawHours - breakMins / 60) * 10000) / 10000);

      db.prepare(`
        UPDATE time_entries SET clock_out = ?, total_hours = ?, break_minutes = ?, break_start = NULL, status = 'completed' WHERE id = ?
      `).run(now, totalHours, breakMins, activeEntry.id);

      // Update schedule status if linked
      if (activeEntry.schedule_id) {
        db.prepare("UPDATE schedules SET status = 'completed' WHERE id = ?").run(activeEntry.schedule_id);
      }

      const officerName = (db.prepare('SELECT full_name FROM users WHERE id = ?').get(targetId) as any)?.full_name || targetId;
      db.prepare(`
        INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, 'clock_out', 'time_entry', ?, ?, ?)
      `).run(req.user!.userId, activeEntry.id, isSelf ? `Clocked out. Total: ${totalHours}h` : `Clocked out ${officerName}. Total: ${totalHours}h`, req.ip || 'unknown');

      const entry = db.prepare(`
        SELECT t.*, u.full_name as officer_name, u.badge_number
        FROM time_entries t LEFT JOIN users u ON t.officer_id = u.id WHERE t.id = ?
      `).get(activeEntry.id);
      res.json(entry);
    } catch (error: any) {
      console.error('Clock out error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/personnel/time/start-break
  parentRouter.post('/personnel/time/start-break', authenticateToken, (req: Request, res: Response) => {
    try {
      const db = getDb();
      const { officer_id } = req.body;
      const targetId = officer_id || req.user!.userId;
      const isSelf = String(targetId) === String(req.user!.userId);
      if (!isSelf && !['admin', 'manager', 'supervisor', 'dispatcher'].includes(req.user!.role)) {
        res.status(403).json({ error: 'Insufficient permissions' });
        return;
      }

      const activeEntry = db.prepare(`
        SELECT * FROM time_entries WHERE officer_id = ? AND status = 'active' ORDER BY clock_in DESC LIMIT 1
      `).get(targetId) as any;

      if (!activeEntry) {
        res.status(400).json({ error: 'Not currently clocked in (or already on break)' });
        return;
      }

      const now = localNow();
      db.prepare(`UPDATE time_entries SET status = 'on_break', break_start = ? WHERE id = ?`).run(now, activeEntry.id);

      db.prepare(`
        INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, 'break_start', 'time_entry', ?, 'Started break', ?)
      `).run(req.user!.userId, activeEntry.id, req.ip || 'unknown');

      const entry = db.prepare(`
        SELECT t.*, u.full_name as officer_name, u.badge_number
        FROM time_entries t LEFT JOIN users u ON t.officer_id = u.id WHERE t.id = ?
      `).get(activeEntry.id);
      res.json(entry);
    } catch (error: any) {
      console.error('Start break error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/personnel/time/end-break
  parentRouter.post('/personnel/time/end-break', authenticateToken, (req: Request, res: Response) => {
    try {
      const db = getDb();
      const { officer_id } = req.body;
      const targetId = officer_id || req.user!.userId;
      const isSelf = String(targetId) === String(req.user!.userId);
      if (!isSelf && !['admin', 'manager', 'supervisor', 'dispatcher'].includes(req.user!.role)) {
        res.status(403).json({ error: 'Insufficient permissions' });
        return;
      }

      const breakEntry = db.prepare(`
        SELECT * FROM time_entries WHERE officer_id = ? AND status = 'on_break' ORDER BY clock_in DESC LIMIT 1
      `).get(targetId) as any;

      if (!breakEntry) {
        res.status(400).json({ error: 'Not currently on break' });
        return;
      }

      const now = localNow();
      let breakMins = Number(breakEntry.break_minutes) || 0;
      if (breakEntry.break_start) {
        const breakStart = new Date(breakEntry.break_start.replace(' ', 'T'));
        const breakEnd = new Date(now.replace(' ', 'T'));
        breakMins += Math.round(((breakEnd.getTime() - breakStart.getTime()) / 60000) * 100) / 100;
      }

      db.prepare(`UPDATE time_entries SET status = 'active', break_start = NULL, break_minutes = ? WHERE id = ?`).run(breakMins, breakEntry.id);

      db.prepare(`
        INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, 'break_end', 'time_entry', ?, ?, ?)
      `).run(req.user!.userId, breakEntry.id, `Ended break. Break: ${breakMins.toFixed(0)}min`, req.ip || 'unknown');

      const entry = db.prepare(`
        SELECT t.*, u.full_name as officer_name, u.badge_number
        FROM time_entries t LEFT JOIN users u ON t.officer_id = u.id WHERE t.id = ?
      `).get(breakEntry.id);
      res.json(entry);
    } catch (error: any) {
      console.error('End break error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/personnel/credentials/:officerId
  parentRouter.get('/personnel/credentials/:officerId', authenticateToken, (req: Request, res: Response) => {
    try {
      const db = getDb();
      const credentials = db.prepare(`
        SELECT c.*, u.full_name as officer_name
        FROM credentials c
        LEFT JOIN users u ON c.officer_id = u.id
        WHERE c.officer_id = ?
        ORDER BY c.credential_type
      `).all(req.params.officerId);

      res.json(credentials);
    } catch (error: any) {
      console.error('Get credentials error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/personnel/time - List all time entries
  parentRouter.get('/personnel/time', authenticateToken, (req: Request, res: Response) => {
    try {
      const db = getDb();
      const { status, date } = req.query;

      let whereClause = 'WHERE 1=1';
      const params: any[] = [];

      if (status) {
        whereClause += ' AND t.status = ?';
        params.push(status);
      }
      if (date) {
        whereClause += ' AND DATE(t.clock_in) = ?';
        params.push(date);
      }

      if (req.user!.role === 'officer') {
        whereClause += ' AND t.officer_id = ?';
        params.push(req.user!.userId);
      }

      const entries = db.prepare(`
        SELECT t.*, u.full_name as officer_name, u.badge_number
        FROM time_entries t
        LEFT JOIN users u ON t.officer_id = u.id
        ${whereClause}
        ORDER BY t.clock_in DESC
        LIMIT 100
      `).all(...params);

      res.json(entries);
    } catch (error: any) {
      console.error('Get time entries error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // PUT /api/personnel/time/:id - Edit a time entry (punch correction)
  parentRouter.put('/personnel/time/:id', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const entry = db.prepare('SELECT * FROM time_entries WHERE id = ?').get(req.params.id) as any;
      if (!entry) {
        res.status(404).json({ error: 'Time entry not found' });
        return;
      }

      const { clock_in, clock_out } = req.body;
      if (!clock_in) {
        res.status(400).json({ error: 'clock_in is required' });
        return;
      }

      // Recalculate total hours
      let totalHours: number | null = null;
      if (clock_out) {
        const start = new Date(clock_in).getTime();
        const end = new Date(clock_out).getTime();
        totalHours = Math.round(((end - start) / (1000 * 60 * 60)) * 10000) / 10000;
        if (totalHours < 0) totalHours = 0;
      }

      const newStatus = clock_out ? 'completed' : 'active';

      db.prepare(`
        UPDATE time_entries SET clock_in = ?, clock_out = ?, total_hours = ?, status = 'edited'
        WHERE id = ?
      `).run(clock_in, clock_out || null, totalHours, req.params.id);

      db.prepare(`
        INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, 'time_entry_edited', 'time_entry', ?, ?, ?)
      `).run(req.user!.userId, req.params.id, `Edited time entry for officer ${entry.officer_id}`, req.ip || 'unknown');

      const updated = db.prepare(`
        SELECT t.*, u.full_name as officer_name, u.badge_number
        FROM time_entries t
        LEFT JOIN users u ON t.officer_id = u.id
        WHERE t.id = ?
      `).get(req.params.id);

      res.json(updated);
    } catch (error: any) {
      console.error('Edit time entry error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // DELETE /api/personnel/time/:id - Delete time entry (admin/manager only)
  parentRouter.delete('/personnel/time/:id', authenticateToken, requireRole('admin', 'manager'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const entry = db.prepare('SELECT * FROM time_entries WHERE id = ?').get(req.params.id) as any;
      if (!entry) {
        res.status(404).json({ error: 'Time entry not found' });
        return;
      }

      db.prepare('DELETE FROM time_entries WHERE id = ?').run(req.params.id);

      db.prepare(`
        INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, 'time_entry_deleted', 'time_entry', ?, ?, ?)
      `).run(req.user!.userId, req.params.id, `Deleted time entry for officer ${entry.officer_id}`, req.ip || 'unknown');

      res.json({ success: true, id: req.params.id });
    } catch (error: any) {
      console.error('Delete time entry error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/personnel/credentials - List all credentials
  parentRouter.get('/personnel/credentials', authenticateToken, (req: Request, res: Response) => {
    try {
      const db = getDb();
      const credentials = db.prepare(`
        SELECT c.*, u.full_name as officer_name, u.badge_number
        FROM credentials c
        LEFT JOIN users u ON c.officer_id = u.id
        ORDER BY c.expiry_date ASC
      `).all();

      res.json(credentials);
    } catch (error: any) {
      console.error('Get all credentials error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/personnel/credentials
  parentRouter.post('/personnel/credentials', authenticateToken, requireRole('admin', 'manager'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const { officer_id, credential_type, credential_number, issued_date, expiry_date, notes } = req.body;

      if (!officer_id || !credential_type) {
        res.status(400).json({ error: 'officer_id and credential_type are required' });
        return;
      }

      const result = db.prepare(`
        INSERT INTO credentials (officer_id, credential_type, credential_number, issued_date, expiry_date, notes)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(officer_id, credential_type, credential_number || null, issued_date || null, expiry_date || null, notes || null);

      const credential = db.prepare('SELECT * FROM credentials WHERE id = ?').get(result.lastInsertRowid);
      res.status(201).json(credential);
    } catch (error: any) {
      console.error('Create credential error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // PUT /api/personnel/credentials/:id - Update credential
  parentRouter.put('/personnel/credentials/:id', authenticateToken, requireRole('admin', 'manager'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const existing = db.prepare('SELECT * FROM credentials WHERE id = ?').get(req.params.id) as any;
      if (!existing) {
        res.status(404).json({ error: 'Credential not found' });
        return;
      }

      const credFields = ['credential_type', 'credential_number', 'issuing_authority', 'issued_date', 'expiry_date', 'notes'];
      const credBodyKeys = Object.keys(req.body);
      const credSet: string[] = [];
      const credVals: any[] = [];
      for (const f of credFields) {
        if (credBodyKeys.includes(f)) {
          credSet.push(`${f} = ?`);
          const v = req.body[f];
          credVals.push(v === '' ? null : v ?? null);
        }
      }
      if (credSet.length > 0) {
        credVals.push(req.params.id);
        db.prepare(`UPDATE credentials SET ${credSet.join(', ')} WHERE id = ?`).run(...credVals);
      }

      const credential = db.prepare(`
        SELECT c.*, u.full_name as officer_name
        FROM credentials c
        LEFT JOIN users u ON c.officer_id = u.id
        WHERE c.id = ?
      `).get(req.params.id);

      res.json(credential);
    } catch (error: any) {
      console.error('Update credential error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // DELETE /api/personnel/credentials/:id - Delete credential
  parentRouter.delete('/personnel/credentials/:id', authenticateToken, requireRole('admin', 'manager'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const existing = db.prepare('SELECT * FROM credentials WHERE id = ?').get(req.params.id) as any;
      if (!existing) {
        res.status(404).json({ error: 'Credential not found' });
        return;
      }

      db.prepare('DELETE FROM credentials WHERE id = ?').run(req.params.id);

      db.prepare(`
        INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, 'credential_deleted', 'credential', ?, ?, ?)
      `).run(req.user!.userId, req.params.id, `Deleted credential: ${existing.credential_type} for officer ${existing.officer_id}`, req.ip || 'unknown');

      res.json({ message: 'Credential deleted' });
    } catch (error: any) {
      console.error('Delete credential error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/personnel/credentials/:id/archive
  parentRouter.post('/personnel/credentials/:id/archive', authenticateToken, requireRole('admin', 'manager'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const cred = db.prepare('SELECT * FROM credentials WHERE id = ?').get(req.params.id) as any;
      if (!cred) { res.status(404).json({ error: 'Credential not found' }); return; }
      if (cred.archived_at) { res.status(400).json({ error: 'Already archived' }); return; }
      const now = localNow();
      db.prepare('UPDATE credentials SET archived_at = ? WHERE id = ?').run(now, cred.id);
      const updated = db.prepare('SELECT * FROM credentials WHERE id = ?').get(cred.id);
      res.json(updated);
    } catch (error: any) {
      console.error('Archive credential error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/personnel/credentials/:id/unarchive
  parentRouter.post('/personnel/credentials/:id/unarchive', authenticateToken, requireRole('admin', 'manager'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const cred = db.prepare('SELECT * FROM credentials WHERE id = ?').get(req.params.id) as any;
      if (!cred) { res.status(404).json({ error: 'Credential not found' }); return; }
      if (!cred.archived_at) { res.status(400).json({ error: 'Not archived' }); return; }
      db.prepare('UPDATE credentials SET archived_at = NULL WHERE id = ?').run(cred.id);
      const updated = db.prepare('SELECT * FROM credentials WHERE id = ?').get(cred.id);
      res.json(updated);
    } catch (error: any) {
      console.error('Unarchive credential error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/personnel/activity/:userId - User-specific activity log
  parentRouter.get('/personnel/activity/:userId', authenticateToken, (req: Request, res: Response) => {
    try {
      const db = getDb();
      const limit = parseInt(req.query.limit as string, 10) || 50;

      const activity = db.prepare(`
        SELECT al.*, u.full_name as user_name, u.badge_number
        FROM activity_log al
        LEFT JOIN users u ON al.user_id = u.id
        WHERE al.user_id = ?
        ORDER BY al.created_at DESC
        LIMIT ?
      `).all(req.params.userId, limit);

      res.json(activity);
    } catch (error: any) {
      console.error('Get user activity error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // DELETE /api/personnel/schedules/:id - Delete schedule
  parentRouter.delete('/personnel/schedules/:id', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const existing = db.prepare('SELECT * FROM schedules WHERE id = ?').get(req.params.id) as any;
      if (!existing) {
        res.status(404).json({ error: 'Schedule not found' });
        return;
      }

      db.prepare('DELETE FROM schedules WHERE id = ?').run(req.params.id);
      res.json({ message: 'Schedule deleted' });
    } catch (error: any) {
      console.error('Delete schedule error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // PUT /api/personnel/schedules/:id - Update schedule
  parentRouter.put('/personnel/schedules/:id', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const existing = db.prepare('SELECT * FROM schedules WHERE id = ?').get(req.params.id) as any;
      if (!existing) {
        res.status(404).json({ error: 'Schedule not found' });
        return;
      }

      const schedFields = ['officer_id', 'property_id', 'shift_date', 'start_time', 'end_time', 'status', 'notes'];
      const schedBodyKeys = Object.keys(req.body);
      const schedSet: string[] = [];
      const schedVals: any[] = [];
      for (const f of schedFields) {
        if (schedBodyKeys.includes(f)) {
          schedSet.push(`${f} = ?`);
          const v = req.body[f];
          schedVals.push(v === '' ? null : v ?? null);
        }
      }
      if (schedSet.length > 0) {
        schedVals.push(req.params.id);
        db.prepare(`UPDATE schedules SET ${schedSet.join(', ')} WHERE id = ?`).run(...schedVals);
      }

      const schedule = db.prepare(`
        SELECT s.*, u.full_name as officer_name, p.name as property_name
        FROM schedules s
        LEFT JOIN users u ON s.officer_id = u.id
        LEFT JOIN properties p ON s.property_id = p.id
        WHERE s.id = ?
      `).get(req.params.id);

      res.json(schedule);
    } catch (error: any) {
      console.error('Update schedule error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/personnel/schedules/:id/archive
  parentRouter.post('/personnel/schedules/:id/archive', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const schedule = db.prepare('SELECT * FROM schedules WHERE id = ?').get(req.params.id) as any;
      if (!schedule) { res.status(404).json({ error: 'Schedule not found' }); return; }
      if (schedule.archived_at) { res.status(400).json({ error: 'Already archived' }); return; }
      const now = localNow();
      db.prepare('UPDATE schedules SET archived_at = ? WHERE id = ?').run(now, schedule.id);
      const updated = db.prepare('SELECT * FROM schedules WHERE id = ?').get(schedule.id);
      res.json(updated);
    } catch (error: any) {
      console.error('Archive schedule error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/personnel/schedules/:id/unarchive
  parentRouter.post('/personnel/schedules/:id/unarchive', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const schedule = db.prepare('SELECT * FROM schedules WHERE id = ?').get(req.params.id) as any;
      if (!schedule) { res.status(404).json({ error: 'Schedule not found' }); return; }
      if (!schedule.archived_at) { res.status(400).json({ error: 'Not archived' }); return; }
      db.prepare('UPDATE schedules SET archived_at = NULL WHERE id = ?').run(schedule.id);
      const updated = db.prepare('SELECT * FROM schedules WHERE id = ?').get(schedule.id);
      res.json(updated);
    } catch (error: any) {
      console.error('Unarchive schedule error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── TRAINING ────────────────────────────────────────

  // GET /api/personnel/training - List all training records
  parentRouter.get('/personnel/training', authenticateToken, (req: Request, res: Response) => {
    try {
      const db = getDb();
      const records = db.prepare(`
        SELECT t.*, u.full_name as officer_name, u.badge_number
        FROM training_records t
        LEFT JOIN users u ON t.officer_id = u.id
        ORDER BY t.completed_date DESC, t.created_at DESC
      `).all();
      res.json(records);
    } catch (error: any) {
      console.error('Get training records error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/personnel/training-requirements - List required trainings
  parentRouter.get('/personnel/training-requirements', authenticateToken, (req: Request, res: Response) => {
    try {
      const db = getDb();
      const requirements = db.prepare('SELECT * FROM training_requirements ORDER BY course_name').all();
      res.json(requirements.map((r: any) => ({
        ...r,
        required_for_roles: (() => { try { return typeof r.required_for_roles === 'string' ? JSON.parse(r.required_for_roles) : r.required_for_roles; } catch { return []; } })(),
        is_mandatory: !!r.is_mandatory,
      })));
    } catch (error: any) {
      console.error('Get training requirements error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/personnel/training-requirements - Create requirement
  parentRouter.post('/personnel/training-requirements', authenticateToken, requireRole('admin', 'manager'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const { course_name, category, required_for_roles, renewal_period_months, minimum_hours, is_mandatory, description } = req.body;
      if (!course_name) { res.status(400).json({ error: 'course_name is required' }); return; }

      const result = db.prepare(`
        INSERT INTO training_requirements (course_name, category, required_for_roles, renewal_period_months, minimum_hours, is_mandatory, description)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        course_name,
        category || 'other',
        JSON.stringify(required_for_roles || []),
        renewal_period_months ?? null,
        minimum_hours ?? 0,
        is_mandatory ? 1 : 0,
        description || null,
      );

      const requirement = db.prepare('SELECT * FROM training_requirements WHERE id = ?').get(result.lastInsertRowid) as any;
      res.status(201).json({
        ...requirement,
        required_for_roles: typeof requirement.required_for_roles === 'string' ? JSON.parse(requirement.required_for_roles) : requirement.required_for_roles,
        is_mandatory: !!requirement.is_mandatory,
      });
    } catch (error: any) {
      console.error('Create training requirement error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // PUT /api/personnel/training-requirements/:id - Update requirement
  parentRouter.put('/personnel/training-requirements/:id', authenticateToken, requireRole('admin', 'manager'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const existing = db.prepare('SELECT * FROM training_requirements WHERE id = ?').get(req.params.id) as any;
      if (!existing) { res.status(404).json({ error: 'Requirement not found' }); return; }

      const fields = ['course_name', 'category', 'required_for_roles', 'renewal_period_months', 'minimum_hours', 'is_mandatory', 'description'];
      const sets: string[] = [];
      const vals: any[] = [];
      for (const f of fields) {
        if (f in req.body) {
          sets.push(`${f} = ?`);
          if (f === 'required_for_roles') vals.push(JSON.stringify(req.body[f] || []));
          else if (f === 'is_mandatory') vals.push(req.body[f] ? 1 : 0);
          else vals.push(req.body[f] ?? null);
        }
      }
      if (sets.length > 0) {
        vals.push(req.params.id);
        db.prepare(`UPDATE training_requirements SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
      }

      const updated = db.prepare('SELECT * FROM training_requirements WHERE id = ?').get(req.params.id) as any;
      res.json({
        ...updated,
        required_for_roles: typeof updated.required_for_roles === 'string' ? JSON.parse(updated.required_for_roles) : updated.required_for_roles,
        is_mandatory: !!updated.is_mandatory,
      });
    } catch (error: any) {
      console.error('Update training requirement error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // DELETE /api/personnel/training-requirements/:id - Delete requirement
  parentRouter.delete('/personnel/training-requirements/:id', authenticateToken, requireRole('admin', 'manager'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const existing = db.prepare('SELECT * FROM training_requirements WHERE id = ?').get(req.params.id) as any;
      if (!existing) { res.status(404).json({ error: 'Requirement not found' }); return; }

      db.prepare('DELETE FROM training_requirements WHERE id = ?').run(req.params.id);
      res.json({ message: 'Requirement deleted' });
    } catch (error: any) {
      console.error('Delete training requirement error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/personnel/training/:officerId - Officer-specific training
  parentRouter.get('/personnel/training/:officerId', authenticateToken, (req: Request, res: Response) => {
    try {
      const db = getDb();
      const records = db.prepare(`
        SELECT t.*, u.full_name as officer_name
        FROM training_records t
        LEFT JOIN users u ON t.officer_id = u.id
        WHERE t.officer_id = ?
        ORDER BY t.completed_date DESC, t.created_at DESC
      `).all(req.params.officerId);
      res.json(records);
    } catch (error: any) {
      console.error('Get officer training error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/personnel/training - Create training record
  parentRouter.post('/personnel/training', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const { officer_id, course_name, category, provider, completed_date, expiry_date, score, hours, certificate_number, status, notes } = req.body;

      if (!officer_id || !course_name) {
        res.status(400).json({ error: 'officer_id and course_name are required' });
        return;
      }

      const result = db.prepare(`
        INSERT INTO training_records (officer_id, course_name, category, provider, completed_date, expiry_date, score, hours, certificate_number, status, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        officer_id, course_name, category || 'other', provider || null,
        completed_date || null, expiry_date || null, score ?? null, hours ?? 0,
        certificate_number || null, status || 'scheduled', notes || null,
      );

      const record = db.prepare(`
        SELECT t.*, u.full_name as officer_name
        FROM training_records t
        LEFT JOIN users u ON t.officer_id = u.id
        WHERE t.id = ?
      `).get(result.lastInsertRowid);

      res.status(201).json(record);
    } catch (error: any) {
      console.error('Create training record error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // PUT /api/personnel/training/:id - Update training record
  parentRouter.put('/personnel/training/:id', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const existing = db.prepare('SELECT * FROM training_records WHERE id = ?').get(req.params.id) as any;
      if (!existing) {
        res.status(404).json({ error: 'Training record not found' });
        return;
      }

      const trainFields = ['course_name', 'category', 'provider', 'completed_date', 'expiry_date', 'score', 'hours', 'certificate_number', 'status', 'notes'];
      const trainBodyKeys = Object.keys(req.body);
      const trainSet: string[] = [];
      const trainVals: any[] = [];
      for (const f of trainFields) {
        if (trainBodyKeys.includes(f)) {
          trainSet.push(`${f} = ?`);
          const v = req.body[f];
          trainVals.push(v === '' ? null : v ?? null);
        }
      }
      if (trainSet.length > 0) {
        trainSet.push("updated_at = ?");
        trainVals.push(localNow());
        trainVals.push(req.params.id);
        db.prepare(`UPDATE training_records SET ${trainSet.join(', ')} WHERE id = ?`).run(...trainVals);
      }

      const record = db.prepare(`
        SELECT t.*, u.full_name as officer_name
        FROM training_records t
        LEFT JOIN users u ON t.officer_id = u.id
        WHERE t.id = ?
      `).get(req.params.id);

      res.json(record);
    } catch (error: any) {
      console.error('Update training record error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // DELETE /api/personnel/training/:id - Delete training record
  parentRouter.delete('/personnel/training/:id', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const existing = db.prepare('SELECT * FROM training_records WHERE id = ?').get(req.params.id) as any;
      if (!existing) {
        res.status(404).json({ error: 'Training record not found' });
        return;
      }

      db.prepare('DELETE FROM training_records WHERE id = ?').run(req.params.id);
      res.json({ message: 'Training record deleted' });
    } catch (error: any) {
      console.error('Delete training record error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/personnel/training/:id/archive
  parentRouter.post('/personnel/training/:id/archive', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const record = db.prepare('SELECT * FROM training_records WHERE id = ?').get(req.params.id) as any;
      if (!record) { res.status(404).json({ error: 'Training record not found' }); return; }
      if (record.archived_at) { res.status(400).json({ error: 'Already archived' }); return; }
      const now = localNow();
      db.prepare('UPDATE training_records SET archived_at = ? WHERE id = ?').run(now, record.id);
      const updated = db.prepare('SELECT * FROM training_records WHERE id = ?').get(record.id);
      res.json(updated);
    } catch (error: any) {
      console.error('Archive training record error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/personnel/training/:id/unarchive
  parentRouter.post('/personnel/training/:id/unarchive', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const record = db.prepare('SELECT * FROM training_records WHERE id = ?').get(req.params.id) as any;
      if (!record) { res.status(404).json({ error: 'Training record not found' }); return; }
      if (!record.archived_at) { res.status(400).json({ error: 'Not archived' }); return; }
      db.prepare('UPDATE training_records SET archived_at = NULL WHERE id = ?').run(record.id);
      const updated = db.prepare('SELECT * FROM training_records WHERE id = ?').get(record.id);
      res.json(updated);
    } catch (error: any) {
      console.error('Unarchive training record error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── DEPLOYMENTS ─────────────────────────────────────

  // GET /api/personnel/deployments - List all deployments
  parentRouter.get('/personnel/deployments', authenticateToken, (req: Request, res: Response) => {
    try {
      const db = getDb();
      const { status } = req.query;

      let whereClause = 'WHERE 1=1';
      const params: any[] = [];

      if (status) {
        whereClause += ' AND d.status = ?';
        params.push(status);
      }

      const deployments = db.prepare(`
        SELECT d.*, u.full_name as officer_name, u.badge_number, p.name as property_name, c.name as client_name
        FROM deployments d
        LEFT JOIN users u ON d.officer_id = u.id
        LEFT JOIN properties p ON d.property_id = p.id
        LEFT JOIN clients c ON p.client_id = c.id
        ${whereClause}
        ORDER BY d.start_date DESC
      `).all(...params);

      res.json(deployments);
    } catch (error: any) {
      console.error('Get deployments error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/personnel/deployments/officer/:officerId - Officer-specific deployments
  parentRouter.get('/personnel/deployments/officer/:officerId', authenticateToken, (req: Request, res: Response) => {
    try {
      const db = getDb();
      const deployments = db.prepare(`
        SELECT d.*, u.full_name as officer_name, p.name as property_name, c.name as client_name
        FROM deployments d
        LEFT JOIN users u ON d.officer_id = u.id
        LEFT JOIN properties p ON d.property_id = p.id
        LEFT JOIN clients c ON p.client_id = c.id
        WHERE d.officer_id = ?
        ORDER BY d.start_date DESC
      `).all(req.params.officerId);
      res.json(deployments);
    } catch (error: any) {
      console.error('Get officer deployments error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/personnel/deployments - Create deployment
  parentRouter.post('/personnel/deployments', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const { officer_id, property_id, position, start_date, end_date, status, hours_per_week, notes } = req.body;

      if (!officer_id || !property_id || !start_date) {
        res.status(400).json({ error: 'officer_id, property_id, and start_date are required' });
        return;
      }

      const result = db.prepare(`
        INSERT INTO deployments (officer_id, property_id, position, start_date, end_date, status, hours_per_week, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        officer_id, property_id, position || 'Patrol', start_date,
        end_date || null, status || 'active', hours_per_week ?? null, notes || null,
      );

      const deployment = db.prepare(`
        SELECT d.*, u.full_name as officer_name, p.name as property_name, c.name as client_name
        FROM deployments d
        LEFT JOIN users u ON d.officer_id = u.id
        LEFT JOIN properties p ON d.property_id = p.id
        LEFT JOIN clients c ON p.client_id = c.id
        WHERE d.id = ?
      `).get(result.lastInsertRowid);

      res.status(201).json(deployment);
    } catch (error: any) {
      console.error('Create deployment error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // PUT /api/personnel/deployments/:id - Update deployment
  parentRouter.put('/personnel/deployments/:id', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const existing = db.prepare('SELECT * FROM deployments WHERE id = ?').get(req.params.id) as any;
      if (!existing) {
        res.status(404).json({ error: 'Deployment not found' });
        return;
      }

      const deployFields = ['officer_id', 'property_id', 'position', 'start_date', 'end_date', 'status', 'hours_per_week', 'notes'];
      const deployBodyKeys = Object.keys(req.body);
      const deploySet: string[] = [];
      const deployVals: any[] = [];
      for (const f of deployFields) {
        if (deployBodyKeys.includes(f)) {
          deploySet.push(`${f} = ?`);
          const v = req.body[f];
          deployVals.push(v === '' ? null : v ?? null);
        }
      }
      if (deploySet.length > 0) {
        deploySet.push("updated_at = ?");
        deployVals.push(localNow());
        deployVals.push(req.params.id);
        db.prepare(`UPDATE deployments SET ${deploySet.join(', ')} WHERE id = ?`).run(...deployVals);
      }

      const deployment = db.prepare(`
        SELECT d.*, u.full_name as officer_name, p.name as property_name, c.name as client_name
        FROM deployments d
        LEFT JOIN users u ON d.officer_id = u.id
        LEFT JOIN properties p ON d.property_id = p.id
        LEFT JOIN clients c ON p.client_id = c.id
        WHERE d.id = ?
      `).get(req.params.id);

      res.json(deployment);
    } catch (error: any) {
      console.error('Update deployment error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // DELETE /api/personnel/deployments/:id - Delete deployment
  parentRouter.delete('/personnel/deployments/:id', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const existing = db.prepare('SELECT * FROM deployments WHERE id = ?').get(req.params.id) as any;
      if (!existing) {
        res.status(404).json({ error: 'Deployment not found' });
        return;
      }

      db.prepare('DELETE FROM deployments WHERE id = ?').run(req.params.id);
      res.json({ message: 'Deployment deleted' });
    } catch (error: any) {
      console.error('Delete deployment error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/personnel/deployments/:id/archive
  parentRouter.post('/personnel/deployments/:id/archive', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const dep = db.prepare('SELECT * FROM deployments WHERE id = ?').get(req.params.id) as any;
      if (!dep) { res.status(404).json({ error: 'Deployment not found' }); return; }
      if (dep.archived_at) { res.status(400).json({ error: 'Already archived' }); return; }
      const now = localNow();
      db.prepare('UPDATE deployments SET archived_at = ? WHERE id = ?').run(now, dep.id);
      const updated = db.prepare(`
        SELECT d.*, u.full_name as officer_name, p.name as property_name, c.name as client_name
        FROM deployments d LEFT JOIN users u ON d.officer_id = u.id
        LEFT JOIN properties p ON d.property_id = p.id LEFT JOIN clients c ON p.client_id = c.id
        WHERE d.id = ?
      `).get(dep.id);
      res.json(updated);
    } catch (error: any) {
      console.error('Archive deployment error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/personnel/deployments/:id/unarchive
  parentRouter.post('/personnel/deployments/:id/unarchive', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const dep = db.prepare('SELECT * FROM deployments WHERE id = ?').get(req.params.id) as any;
      if (!dep) { res.status(404).json({ error: 'Deployment not found' }); return; }
      if (!dep.archived_at) { res.status(400).json({ error: 'Not archived' }); return; }
      db.prepare('UPDATE deployments SET archived_at = NULL WHERE id = ?').run(dep.id);
      const updated = db.prepare(`
        SELECT d.*, u.full_name as officer_name, p.name as property_name, c.name as client_name
        FROM deployments d LEFT JOIN users u ON d.officer_id = u.id
        LEFT JOIN properties p ON d.property_id = p.id LEFT JOIN clients c ON p.client_id = c.id
        WHERE d.id = ?
      `).get(dep.id);
      res.json(updated);
    } catch (error: any) {
      console.error('Unarchive deployment error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── OFFICER EQUIPMENT ─────────────────────────────────

  // GET /api/personnel/equipment - List all equipment with officer name
  parentRouter.get('/personnel/equipment', authenticateToken, (req: Request, res: Response) => {
    try {
      const db = getDb();
      const { type, status } = req.query;

      let whereClause = 'WHERE 1=1';
      const params: any[] = [];

      if (type) {
        whereClause += ' AND e.equipment_type = ?';
        params.push(type);
      }
      if (status) {
        whereClause += ' AND e.status = ?';
        params.push(status);
      }

      const equipment = db.prepare(`
        SELECT e.*, u.full_name as officer_name
        FROM officer_equipment e
        LEFT JOIN users u ON e.officer_id = u.id
        ${whereClause}
        ORDER BY e.created_at DESC
      `).all(...params);

      res.json(equipment);
    } catch (error: any) {
      console.error('Get equipment error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/personnel/:id/equipment - Get equipment for a specific officer
  parentRouter.get('/personnel/:id/equipment', authenticateToken, (req: Request, res: Response) => {
    try {
      const db = getDb();
      const equipment = db.prepare(`
        SELECT * FROM officer_equipment WHERE officer_id = ? ORDER BY status, equipment_type
      `).all(req.params.id);

      res.json(equipment);
    } catch (error: any) {
      console.error('Get officer equipment error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/personnel/:id/equipment - Create equipment record
  parentRouter.post('/personnel/:id/equipment', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const officer_id = req.params.id;
      const { equipment_type, make, model, serial_number, asset_tag, condition, status, issued_date, returned_date, notes } = req.body;

      if (!equipment_type) {
        res.status(400).json({ error: 'equipment_type is required' });
        return;
      }

      const result = db.prepare(`
        INSERT INTO officer_equipment (officer_id, equipment_type, make, model, serial_number, asset_tag, condition, status, issued_date, returned_date, notes, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        officer_id, equipment_type, make || null, model || null,
        serial_number || null, asset_tag || null, condition || 'good',
        status || 'issued', issued_date || null, returned_date || null,
        notes || null, req.user!.userId
      );

      const equipment = db.prepare(`
        SELECT e.*, u.full_name as officer_name
        FROM officer_equipment e
        LEFT JOIN users u ON e.officer_id = u.id
        WHERE e.id = ?
      `).get(result.lastInsertRowid);

      res.status(201).json(equipment);
    } catch (error: any) {
      console.error('Create equipment error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // PUT /api/personnel/equipment/:equipId - Update equipment record
  parentRouter.put('/personnel/equipment/:equipId', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const existing = db.prepare('SELECT * FROM officer_equipment WHERE id = ?').get(req.params.equipId) as any;
      if (!existing) {
        res.status(404).json({ error: 'Equipment record not found' });
        return;
      }

      const equipFields = ['equipment_type', 'make', 'model', 'serial_number', 'asset_tag', 'condition', 'status', 'issued_date', 'returned_date', 'notes'];
      const equipBodyKeys = Object.keys(req.body);
      const equipSet: string[] = [];
      const equipVals: any[] = [];
      for (const f of equipFields) {
        if (equipBodyKeys.includes(f)) {
          equipSet.push(`${f} = ?`);
          const v = req.body[f];
          equipVals.push(v === '' ? null : v ?? null);
        }
      }
      if (equipSet.length > 0) {
        equipSet.push("updated_at = ?");
        equipVals.push(localNow());
        equipVals.push(req.params.equipId);
        db.prepare(`UPDATE officer_equipment SET ${equipSet.join(', ')} WHERE id = ?`).run(...equipVals);
      }

      const equipment = db.prepare(`
        SELECT e.*, u.full_name as officer_name
        FROM officer_equipment e
        LEFT JOIN users u ON e.officer_id = u.id
        WHERE e.id = ?
      `).get(req.params.equipId);

      res.json(equipment);
    } catch (error: any) {
      console.error('Update equipment error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // DELETE /api/personnel/equipment/:equipId - Delete equipment record
  parentRouter.delete('/personnel/equipment/:equipId', authenticateToken, requireRole('admin', 'manager'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const existing = db.prepare('SELECT * FROM officer_equipment WHERE id = ?').get(req.params.equipId) as any;
      if (!existing) {
        res.status(404).json({ error: 'Equipment record not found' });
        return;
      }

      db.prepare('DELETE FROM officer_equipment WHERE id = ?').run(req.params.equipId);

      db.prepare(`
        INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, 'equipment_deleted', 'equipment', ?, ?, ?)
      `).run(req.user!.userId, req.params.equipId, `Deleted equipment: ${existing.equipment_type} for officer ${existing.officer_id}`, req.ip || 'unknown');

      res.json({ message: 'Equipment record deleted' });
    } catch (error: any) {
      console.error('Delete equipment error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── BODY CAMERAS ──────────────────────────────────────

  // GET /api/personnel/body-cameras - List all body cameras
  parentRouter.get('/personnel/body-cameras', authenticateToken, (req: Request, res: Response) => {
    try {
      const db = getDb();
      const { status } = req.query;
      let whereClause = 'WHERE 1=1';
      const params: any[] = [];
      if (status) { whereClause += ' AND c.status = ?'; params.push(status); }

      const cameras = db.prepare(`
        SELECT c.*, u.full_name as officer_name
        FROM body_cameras c
        LEFT JOIN users u ON c.officer_id = u.id
        ${whereClause}
        ORDER BY c.status, c.camera_id
      `).all(...params);

      res.json(cameras);
    } catch (error: any) {
      console.error('Get body cameras error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/personnel/:id/body-cameras - Get cameras for specific officer
  parentRouter.get('/personnel/:id/body-cameras', authenticateToken, (req: Request, res: Response) => {
    try {
      const db = getDb();
      const cameras = db.prepare(`
        SELECT * FROM body_cameras WHERE officer_id = ? ORDER BY status, camera_id
      `).all(req.params.id);
      res.json(cameras);
    } catch (error: any) {
      console.error('Get officer body cameras error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/personnel/body-cameras - Create body camera
  parentRouter.post('/personnel/body-cameras', authenticateToken, requireRole('admin'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const { officer_id, camera_id, make, model, firmware_version, storage_capacity_gb, status, condition, assigned_at, notes } = req.body;

      if (!camera_id) {
        res.status(400).json({ error: 'camera_id (serial number) is required' });
        return;
      }
      if (!officer_id) {
        res.status(400).json({ error: 'officer_id is required' });
        return;
      }

      const result = db.prepare(`
        INSERT INTO body_cameras (officer_id, camera_id, make, model, firmware_version, storage_capacity_gb, status, condition, assigned_at, notes, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        officer_id, camera_id, make || null, model || null,
        firmware_version || null, storage_capacity_gb || 32,
        status || 'assigned', condition || 'good',
        assigned_at || localNow(), notes || null, req.user!.userId
      );

      const camera = db.prepare(`
        SELECT c.*, u.full_name as officer_name
        FROM body_cameras c
        LEFT JOIN users u ON c.officer_id = u.id
        WHERE c.id = ?
      `).get(result.lastInsertRowid);

      res.status(201).json(camera);
    } catch (error: any) {
      if (error.message?.includes('UNIQUE constraint')) {
        res.status(409).json({ error: 'A camera with that serial number already exists' });
        return;
      }
      console.error('Create body camera error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // PUT /api/personnel/body-cameras/:cameraId - Update body camera
  parentRouter.put('/personnel/body-cameras/:cameraId', authenticateToken, requireRole('admin'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const existing = db.prepare('SELECT * FROM body_cameras WHERE id = ?').get(req.params.cameraId) as any;
      if (!existing) {
        res.status(404).json({ error: 'Body camera not found' });
        return;
      }

      const fields = ['officer_id', 'camera_id', 'make', 'model', 'firmware_version', 'storage_capacity_gb', 'status', 'condition', 'assigned_at', 'returned_at', 'notes'];
      const bodyKeys = Object.keys(req.body);
      const setClauses: string[] = [];
      const vals: any[] = [];
      for (const f of fields) {
        if (bodyKeys.includes(f)) {
          setClauses.push(`${f} = ?`);
          const v = req.body[f];
          vals.push(v === '' ? null : v ?? null);
        }
      }
      if (setClauses.length > 0) {
        setClauses.push('updated_at = ?');
        vals.push(localNow());
        vals.push(req.params.cameraId);
        db.prepare(`UPDATE body_cameras SET ${setClauses.join(', ')} WHERE id = ?`).run(...vals);
      }

      const camera = db.prepare(`
        SELECT c.*, u.full_name as officer_name
        FROM body_cameras c
        LEFT JOIN users u ON c.officer_id = u.id
        WHERE c.id = ?
      `).get(req.params.cameraId);

      res.json(camera);
    } catch (error: any) {
      console.error('Update body camera error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // DELETE /api/personnel/body-cameras/:cameraId - Delete body camera
  parentRouter.delete('/personnel/body-cameras/:cameraId', authenticateToken, requireRole('admin'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const existing = db.prepare('SELECT * FROM body_cameras WHERE id = ?').get(req.params.cameraId) as any;
      if (!existing) {
        res.status(404).json({ error: 'Body camera not found' });
        return;
      }

      // Delete associated videos and their files
      const videos = db.prepare('SELECT * FROM bodycam_videos WHERE camera_id = ?').all(req.params.cameraId) as any[];
      for (const vid of videos) {
        const filePath = path.resolve(BODYCAM_DIR, vid.file_path);
        if (filePath.startsWith(BODYCAM_DIR) && fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }
      db.prepare('DELETE FROM bodycam_videos WHERE camera_id = ?').run(req.params.cameraId);
      db.prepare('DELETE FROM body_cameras WHERE id = ?').run(req.params.cameraId);

      res.json({ message: 'Body camera and associated videos deleted' });
    } catch (error: any) {
      console.error('Delete body camera error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── BODY CAMERA VIDEOS ───────────────────────────────

  // GET /api/personnel/bodycam-videos - List all videos
  parentRouter.get('/personnel/bodycam-videos', authenticateToken, (req: Request, res: Response) => {
    try {
      const db = getDb();
      const { officer_id, camera_id, classification, case_number } = req.query;
      let whereClause = 'WHERE 1=1';
      const params: any[] = [];
      if (officer_id) { whereClause += ' AND v.officer_id = ?'; params.push(officer_id); }
      if (camera_id) { whereClause += ' AND v.camera_id = ?'; params.push(camera_id); }
      if (classification) { whereClause += ' AND v.classification = ?'; params.push(classification); }
      if (case_number) { whereClause += ' AND v.case_number = ?'; params.push(case_number); }

      const videos = db.prepare(`
        SELECT v.*, u.full_name as officer_name, c.camera_id as camera_serial
        FROM bodycam_videos v
        LEFT JOIN users u ON v.officer_id = u.id
        LEFT JOIN body_cameras c ON v.camera_id = c.id
        ${whereClause}
        ORDER BY v.created_at DESC
      `).all(...params);

      res.json(videos);
    } catch (error: any) {
      console.error('Get bodycam videos error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── BULK OPERATIONS (must be BEFORE /:videoId param routes) ────

  // DELETE /api/personnel/bodycam-videos/bulk - Bulk delete videos
  parentRouter.delete('/personnel/bodycam-videos/bulk', authenticateToken, requireRole('admin'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const { videoIds } = req.body;
      if (!Array.isArray(videoIds) || videoIds.length === 0) {
        res.status(400).json({ error: 'videoIds array required' });
        return;
      }

      const results = { deleted: 0, errors: 0 };
      const deleteTransaction = db.transaction(() => {
        for (const id of videoIds.slice(0, 100)) {
          const video = db.prepare('SELECT * FROM bodycam_videos WHERE id = ?').get(id) as any;
          if (!video) { results.errors++; continue; }
          // Delete file from disk
          const filePath = path.resolve(BODYCAM_DIR, video.file_path);
          if (filePath.startsWith(BODYCAM_DIR) && fs.existsSync(filePath)) {
            try { fs.unlinkSync(filePath); } catch { results.errors++; }
          }
          db.prepare('DELETE FROM bodycam_videos WHERE id = ?').run(id);
          results.deleted++;
        }
      });
      deleteTransaction();
      res.json(results);
    } catch (error: any) {
      console.error('Bulk delete bodycam videos error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // PUT /api/personnel/bodycam-videos/bulk - Bulk update video metadata
  parentRouter.put('/personnel/bodycam-videos/bulk', authenticateToken, requireRole('admin'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const { videoIds, classification, retention_status } = req.body;
      if (!Array.isArray(videoIds) || videoIds.length === 0) {
        res.status(400).json({ error: 'videoIds array required' });
        return;
      }

      const setClauses: string[] = [];
      const vals: any[] = [];
      if (classification) { setClauses.push('classification = ?'); vals.push(classification); }
      if (retention_status) { setClauses.push('retention_status = ?'); vals.push(retention_status); }
      if (setClauses.length === 0) {
        res.status(400).json({ error: 'At least one field to update is required (classification, retention_status)' });
        return;
      }
      setClauses.push('updated_at = ?');
      vals.push(localNow());

      const placeholders = videoIds.slice(0, 100).map(() => '?').join(',');
      const stmt = db.prepare(`UPDATE bodycam_videos SET ${setClauses.join(', ')} WHERE id IN (${placeholders})`);
      stmt.run(...vals, ...videoIds.slice(0, 100));

      res.json({ updated: Math.min(videoIds.length, 100) });
    } catch (error: any) {
      console.error('Bulk update bodycam videos error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // DELETE /api/personnel/body-cameras/bulk - Bulk delete cameras + associated videos
  parentRouter.delete('/personnel/body-cameras/bulk', authenticateToken, requireRole('admin'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const { cameraIds } = req.body;
      if (!Array.isArray(cameraIds) || cameraIds.length === 0) {
        res.status(400).json({ error: 'cameraIds array required' });
        return;
      }

      const results = { deleted: 0, videosDeleted: 0, errors: 0 };
      const deleteTransaction = db.transaction(() => {
        for (const camId of cameraIds.slice(0, 50)) {
          const cam = db.prepare('SELECT * FROM body_cameras WHERE id = ?').get(camId) as any;
          if (!cam) { results.errors++; continue; }

          // Delete associated video files from disk
          const videos = db.prepare('SELECT * FROM bodycam_videos WHERE camera_id = ?').all(camId) as any[];
          for (const vid of videos) {
            const filePath = path.resolve(BODYCAM_DIR, vid.file_path);
            if (filePath.startsWith(BODYCAM_DIR) && fs.existsSync(filePath)) {
              try { fs.unlinkSync(filePath); } catch { /* ok */ }
            }
            results.videosDeleted++;
          }
          db.prepare('DELETE FROM bodycam_videos WHERE camera_id = ?').run(camId);
          db.prepare('DELETE FROM body_cameras WHERE id = ?').run(camId);
          results.deleted++;
        }
      });
      deleteTransaction();
      res.json(results);
    } catch (error: any) {
      console.error('Bulk delete body cameras error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/personnel/:id/bodycam-videos - Get videos for specific officer
  parentRouter.get('/personnel/:id/bodycam-videos', authenticateToken, (req: Request, res: Response) => {
    try {
      const db = getDb();
      const videos = db.prepare(`
        SELECT v.*, c.camera_id as camera_serial
        FROM bodycam_videos v
        LEFT JOIN body_cameras c ON v.camera_id = c.id
        WHERE v.officer_id = ?
        ORDER BY v.created_at DESC
      `).all(req.params.id);
      res.json(videos);
    } catch (error: any) {
      console.error('Get officer bodycam videos error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ────────────────────────────────────────────────────────────
  // Chunked Upload API — for reliable large file uploads
  // ────────────────────────────────────────────────────────────

  // POST /api/personnel/bodycam-videos/upload-init — Start a chunked upload session
  parentRouter.post('/personnel/bodycam-videos/upload-init', authenticateToken, requireRole('admin'), (req: Request, res: Response) => {
    try {
      const { fileName, fileSize, totalChunks, mimeType } = req.body;
      if (!fileName || !fileSize || !totalChunks) {
        res.status(400).json({ error: 'fileName, fileSize, and totalChunks are required' });
        return;
      }
      const uploadId = crypto.randomUUID();
      const sessionDir = path.join(CHUNK_DIR, uploadId);
      fs.mkdirSync(sessionDir, { recursive: true });

      // Write session metadata
      const meta = { uploadId, fileName, fileSize, totalChunks, mimeType: mimeType || 'video/mp4', receivedChunks: 0, createdAt: Date.now() };
      fs.writeFileSync(path.join(sessionDir, '_meta.json'), JSON.stringify(meta));

      console.log(`[Bodycam] Chunked upload initialized: ${uploadId}, file=${fileName}, size=${fileSize}, chunks=${totalChunks}`);
      res.json({ uploadId, chunkSize: CHUNK_SIZE });
    } catch (error: any) {
      console.error('Upload init error:', error);
      res.status(500).json({ error: 'Failed to initialize upload' });
    }
  });

  // POST /api/personnel/bodycam-videos/upload-chunk — Upload a single chunk
  parentRouter.post('/personnel/bodycam-videos/upload-chunk', authenticateToken, requireRole('admin'), (req: Request, res: Response) => {
    req.setTimeout(120000); // 2 min per chunk
    res.setTimeout(120000);

    chunkUpload.single('chunk')(req, res, (multerErr: any) => {
      if (multerErr) {
        console.error('Chunk upload multer error:', multerErr?.message);
        res.status(400).json({ error: multerErr.message || 'Chunk upload failed' });
        return;
      }

      try {
        const { uploadId: rawUploadId, chunkIndex } = req.body;
        const uploadId = rawUploadId ? path.basename(String(rawUploadId)) : '';
        if (!uploadId || uploadId !== rawUploadId || chunkIndex == null || !req.file) {
          if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
          res.status(400).json({ error: 'uploadId, chunkIndex, and chunk file are required' });
          return;
        }

        const sessionDir = path.join(CHUNK_DIR, uploadId);
        const metaPath = path.join(sessionDir, '_meta.json');
        if (!fs.existsSync(metaPath)) {
          if (req.file.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
          res.status(404).json({ error: 'Upload session not found or expired' });
          return;
        }

        // Move chunk file into session directory
        const idx = parseInt(String(chunkIndex), 10);
        const chunkDest = path.join(sessionDir, `chunk_${String(idx).padStart(6, '0')}`);
        fs.renameSync(req.file.path, chunkDest);

        // Update meta
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        meta.receivedChunks = (meta.receivedChunks || 0) + 1;
        fs.writeFileSync(metaPath, JSON.stringify(meta));

        res.json({ success: true, chunkIndex: idx, received: meta.receivedChunks, total: meta.totalChunks });
      } catch (error: any) {
        console.error('Chunk upload error:', error);
        if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.status(500).json({ error: 'Failed to process chunk' });
      }
    });
  });

  // POST /api/personnel/bodycam-videos/upload-complete — Finalize chunked upload
  parentRouter.post('/personnel/bodycam-videos/upload-complete', authenticateToken, requireRole('admin'), async (req: Request, res: Response) => {
    req.setTimeout(600000); // 10 min for reassembly
    res.setTimeout(600000);

    try {
      const db = getDb();
      const { uploadId: rawFinUploadId, camera_id, officer_id, title, duration_seconds, recorded_at, case_number, classification, notes } = req.body;
      // Sanitize uploadId to prevent path traversal
      const uploadId = rawFinUploadId ? path.basename(String(rawFinUploadId)) : '';

      if (!uploadId || uploadId !== rawFinUploadId || !camera_id || !officer_id || !title) {
        res.status(400).json({ error: 'uploadId, camera_id, officer_id, and title are required' });
        return;
      }

      const sessionDir = path.join(CHUNK_DIR, uploadId);
      const metaPath = path.join(sessionDir, '_meta.json');
      if (!fs.existsSync(metaPath)) {
        res.status(404).json({ error: 'Upload session not found or expired' });
        return;
      }

      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      const totalChunks = parseInt(String(meta.totalChunks), 10);

      // Verify all chunks are present
      for (let i = 0; i < totalChunks; i++) {
        const chunkPath = path.join(sessionDir, `chunk_${String(i).padStart(6, '0')}`);
        if (!fs.existsSync(chunkPath)) {
          res.status(400).json({ error: `Missing chunk ${i} of ${totalChunks}` });
          return;
        }
      }

      // Reassemble file
      const now = new Date();
      const destDir = path.join(BODYCAM_DIR, `${now.getFullYear()}`, String(now.getMonth() + 1).padStart(2, '0'));
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

      const ext = path.extname(meta.fileName).toLowerCase() || '.mp4';
      const finalFileName = `${crypto.randomUUID()}${ext}`;
      const finalPath = path.join(destDir, finalFileName);

      console.log(`[Bodycam] Reassembling ${totalChunks} chunks → ${finalPath}`);
      const writeStream = fs.createWriteStream(finalPath);
      for (let i = 0; i < totalChunks; i++) {
        const chunkPath = path.join(sessionDir, `chunk_${String(i).padStart(6, '0')}`);
        const chunkData = fs.readFileSync(chunkPath);
        writeStream.write(chunkData);
      }
      await new Promise<void>((resolve, reject) => {
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
        writeStream.end();
      });

      // Verify final file
      const diskStat = fs.statSync(finalPath);
      const verifiedSize = diskStat.size;
      console.log(`[Bodycam] Reassembly complete: ${verifiedSize} bytes`);

      const relativePath = path.relative(BODYCAM_DIR, finalPath);
      const user = (req as any).user;

      const result = db.prepare(`
        INSERT INTO bodycam_videos (camera_id, officer_id, title, file_path, file_size, duration_seconds, mime_type, recorded_at, case_number, classification, notes, uploaded_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        camera_id, officer_id, title, relativePath, verifiedSize,
        duration_seconds || null, meta.mimeType || 'video/mp4',
        recorded_at || localNow(), case_number || null,
        classification || 'routine', notes || null, String(user?.userId || 'system')
      );

      const videoId = result.lastInsertRowid;

      // Clean up chunk session
      try {
        fs.rmSync(sessionDir, { recursive: true, force: true });
      } catch { /* best effort */ }

      // Fire-and-forget: extract actual duration with ffprobe
      extractVideoDuration(finalPath).then((probedDuration) => {
        if (probedDuration != null) {
          try {
            const dbInner = getDb();
            dbInner.prepare('UPDATE bodycam_videos SET duration_seconds = ?, updated_at = ? WHERE id = ?')
              .run(probedDuration, localNow(), videoId);
          } catch (e: any) {
            console.warn('ffprobe duration update failed:', e?.message);
          }
        }
      }).catch(() => {});

      const video = db.prepare(`
        SELECT v.*, u.full_name as officer_name, c.camera_id as camera_serial
        FROM bodycam_videos v
        LEFT JOIN users u ON v.officer_id = u.id
        LEFT JOIN body_cameras c ON v.camera_id = c.id
        WHERE v.id = ?
      `).get(videoId);

      console.log(`[Bodycam] Chunked upload complete: id=${videoId}, title=${title}, size=${verifiedSize}`);
      res.status(201).json(video);
    } catch (error: any) {
      console.error('Upload complete error:', error?.message, error?.stack);
      res.status(500).json({ error: `Upload finalization failed: ${error?.message || 'Internal server error'}` });
    }
  });

  // DELETE /api/personnel/bodycam-videos/upload-abort/:uploadId — Cancel a chunked upload
  parentRouter.delete('/personnel/bodycam-videos/upload-abort/:uploadId', authenticateToken, requireRole('admin'), (req: Request, res: Response) => {
    try {
      // Sanitize uploadId to prevent path traversal (e.g. ../../)
      const uploadId = path.basename(req.params.uploadId as string);
      if (!uploadId || uploadId !== req.params.uploadId) {
        res.status(400).json({ error: 'Invalid upload ID' });
        return;
      }
      const sessionDir = path.join(CHUNK_DIR, uploadId);
      if (fs.existsSync(sessionDir)) {
        fs.rmSync(sessionDir, { recursive: true, force: true });
      }
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to abort upload' });
    }
  });

  // POST /api/personnel/bodycam-videos - Upload video (legacy single-file upload)
  parentRouter.post('/personnel/bodycam-videos', authenticateToken, requireRole('admin'), (req: Request, res: Response) => {
    // Increase timeout for large video uploads (10 minutes)
    req.setTimeout(600000);
    res.setTimeout(600000);

    // Pre-flight: verify upload directory is writable
    try {
      if (!fs.existsSync(BODYCAM_DIR)) {
        fs.mkdirSync(BODYCAM_DIR, { recursive: true });
      }
      fs.accessSync(BODYCAM_DIR, fs.constants.W_OK);
    } catch (dirErr: any) {
      console.error('Bodycam upload dir not writable:', BODYCAM_DIR, dirErr);
      res.status(503).json({ error: `Upload storage is unavailable: ${dirErr.message}` });
      return;
    }

    try {
      bodycamUpload.single('video')(req, res, (multerErr: any) => {
        if (multerErr) {
          console.error('Multer upload error:', multerErr?.message, multerErr?.code, multerErr?.stack);
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

          const { camera_id, officer_id, title, duration_seconds, recorded_at, case_number, classification, notes } = req.body;

          if (!camera_id || !officer_id || !title) {
            if (file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
            res.status(400).json({ error: 'camera_id, officer_id, and title are required' });
            return;
          }

          // Verify file size against disk (authoritative) vs multer (reported)
          const diskStat = fs.statSync(file.path);
          const verifiedSize = diskStat.size;
          if (verifiedSize !== file.size) {
            console.warn(`Bodycam size mismatch: multer=${file.size}, disk=${verifiedSize}. Using disk size.`);
          }

          const relativePath = path.relative(BODYCAM_DIR, file.path);

          const result = db.prepare(`
            INSERT INTO bodycam_videos (camera_id, officer_id, title, file_path, file_size, duration_seconds, mime_type, recorded_at, case_number, classification, notes, uploaded_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            camera_id, officer_id, title, relativePath, verifiedSize,
            duration_seconds || null, file.mimetype,
            recorded_at || localNow(), case_number || null,
            classification || 'routine', notes || null, String(req.user!.userId)
          );

          const videoId = result.lastInsertRowid;

          const video = db.prepare(`
            SELECT v.*, u.full_name as officer_name, c.camera_id as camera_serial
            FROM bodycam_videos v
            LEFT JOIN users u ON v.officer_id = u.id
            LEFT JOIN body_cameras c ON v.camera_id = c.id
            WHERE v.id = ?
          `).get(videoId);

          // Fire-and-forget: extract actual duration with ffprobe and update DB
          const fullFilePath = path.resolve(BODYCAM_DIR, relativePath);
          extractVideoDuration(fullFilePath).then((probedDuration) => {
            if (probedDuration != null) {
              try {
                const dbInner = getDb();
                dbInner.prepare('UPDATE bodycam_videos SET duration_seconds = ?, updated_at = ? WHERE id = ?')
                  .run(probedDuration, localNow(), videoId);
              } catch (e: any) {
                console.warn('ffprobe duration update failed:', e?.message);
              }
            }
          }).catch(() => { /* ffprobe not available — client value used */ });

          // Fire-and-forget: queue overlay burn via FFmpeg
          const videoRecord = video as any;
          const overlayConfig: BodyCamOverlayConfig = {
            type: 'bodycam',
            officerName: videoRecord?.officer_name || 'UNKNOWN',
            badgeNumber: (db.prepare('SELECT badge_number FROM users WHERE id = ?').get(officer_id) as any)?.badge_number || '',
            cameraSerial: videoRecord?.camera_serial || '',
            recordedAtUnix: Math.floor(new Date(recorded_at || Date.now()).getTime() / 1000),
            caseNumber: case_number || '',
            classification: (classification || 'routine').toUpperCase(),
          };
          queueOverlayProcessing(videoId, 'bodycam', fullFilePath, overlayConfig);

          res.status(201).json(video);
        } catch (error: any) {
          console.error('Upload bodycam video DB error:', error?.message, error?.stack);
          res.status(500).json({ error: `Upload processing failed: ${error?.message || 'Internal server error'}` });
        }
      });
    } catch (outerErr: any) {
      console.error('Bodycam upload outer error:', outerErr?.message, outerErr?.stack);
      if (!res.headersSent) {
        res.status(500).json({ error: `Upload failed: ${outerErr?.message || 'Internal server error'}` });
      }
    }
  });

  // PUT /api/personnel/bodycam-videos/:videoId - Update video metadata
  parentRouter.put('/personnel/bodycam-videos/:videoId', authenticateToken, requireRole('admin'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const existing = db.prepare('SELECT * FROM bodycam_videos WHERE id = ?').get(req.params.videoId) as any;
      if (!existing) {
        res.status(404).json({ error: 'Video not found' });
        return;
      }

      const fields = ['title', 'recorded_at', 'case_number', 'classification', 'retention_status', 'notes', 'duration_seconds'];
      const bodyKeys = Object.keys(req.body);
      const setClauses: string[] = [];
      const vals: any[] = [];
      for (const f of fields) {
        if (bodyKeys.includes(f)) {
          setClauses.push(`${f} = ?`);
          const v = req.body[f];
          vals.push(v === '' ? null : v ?? null);
        }
      }
      if (setClauses.length > 0) {
        setClauses.push('updated_at = ?');
        vals.push(localNow());
        vals.push(req.params.videoId);
        db.prepare(`UPDATE bodycam_videos SET ${setClauses.join(', ')} WHERE id = ?`).run(...vals);
      }

      const video = db.prepare(`
        SELECT v.*, u.full_name as officer_name, c.camera_id as camera_serial
        FROM bodycam_videos v
        LEFT JOIN users u ON v.officer_id = u.id
        LEFT JOIN body_cameras c ON v.camera_id = c.id
        WHERE v.id = ?
      `).get(req.params.videoId);

      res.json(video);
    } catch (error: any) {
      console.error('Update bodycam video error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/personnel/bodycam-videos/reprobe - Re-extract duration & verify file_size for all videos with null duration
  parentRouter.post('/personnel/bodycam-videos/reprobe', authenticateToken, requireRole('admin'), async (req: Request, res: Response) => {
    try {
      const db = getDb();
      const videos = db.prepare('SELECT id, file_path, file_size, duration_seconds FROM bodycam_videos WHERE duration_seconds IS NULL OR duration_seconds = 0').all() as any[];
      let updated = 0;
      let sizeFixed = 0;
      for (const vid of videos) {
        const fullPath = path.resolve(BODYCAM_DIR, vid.file_path);
        if (!fs.existsSync(fullPath)) continue;
        // Verify / fix file_size from actual file
        const stat = fs.statSync(fullPath);
        if (stat.size !== vid.file_size) {
          db.prepare('UPDATE bodycam_videos SET file_size = ?, updated_at = ? WHERE id = ?').run(stat.size, localNow(), vid.id);
          sizeFixed++;
        }
        // Extract duration via ffprobe
        const dur = await extractVideoDuration(fullPath);
        if (dur != null) {
          db.prepare('UPDATE bodycam_videos SET duration_seconds = ?, updated_at = ? WHERE id = ?').run(dur, localNow(), vid.id);
          updated++;
        }
      }
      res.json({ total: videos.length, duration_updated: updated, size_fixed: sizeFixed });
    } catch (error: any) {
      console.error('Reprobe bodycam videos error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // DELETE /api/personnel/bodycam-videos/:videoId - Delete video + file
  parentRouter.delete('/personnel/bodycam-videos/:videoId', authenticateToken, requireRole('admin'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const existing = db.prepare('SELECT * FROM bodycam_videos WHERE id = ?').get(req.params.videoId) as any;
      if (!existing) {
        res.status(404).json({ error: 'Video not found' });
        return;
      }

      // Delete original file from disk
      const filePath = path.resolve(BODYCAM_DIR, existing.file_path);
      if (filePath.startsWith(BODYCAM_DIR) && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      // Delete processed overlay file if it exists
      if (existing.processed_file_path) {
        const processedPath = path.resolve(BODYCAM_DIR, existing.processed_file_path);
        if (processedPath.startsWith(BODYCAM_DIR) && fs.existsSync(processedPath)) {
          fs.unlinkSync(processedPath);
        }
      }

      db.prepare('DELETE FROM bodycam_videos WHERE id = ?').run(req.params.videoId);
      res.json({ message: 'Video deleted' });
    } catch (error: any) {
      console.error('Delete bodycam video error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/personnel/bodycam-videos/:videoId/stream - Stream video with Range support
  // Accept token from query string for <video> elements that can't set Authorization headers
  parentRouter.get('/personnel/bodycam-videos/:videoId/stream', (req: Request, res: Response, next) => {
    if (!req.headers['authorization'] && req.query.token) {
      req.headers['authorization'] = `Bearer ${req.query.token}`;
    }
    next();
  }, authenticateToken, (req: Request, res: Response) => {
    try {
      const db = getDb();
      const video = db.prepare('SELECT * FROM bodycam_videos WHERE id = ?').get(req.params.videoId) as any;
      if (!video) {
        res.status(404).json({ error: 'Video not found' });
        return;
      }

      // Serve processed (overlaid) file if available, otherwise original
      const servePath = (video.overlay_status === 'complete' && video.processed_file_path)
        ? path.resolve(BODYCAM_DIR, video.processed_file_path)
        : path.resolve(BODYCAM_DIR, video.file_path);

      const filePath = fs.existsSync(servePath) ? servePath : path.resolve(BODYCAM_DIR, video.file_path);

      if (!filePath.startsWith(BODYCAM_DIR) || !fs.existsSync(filePath)) {
        res.status(404).json({ error: 'Video file not found on disk' });
        return;
      }

      const stat = fs.statSync(filePath);
      const fileSize = stat.size;
      const mimeType = filePath.endsWith('.mp4') ? 'video/mp4' : (video.mime_type || 'video/mp4');
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
          'Content-Type': mimeType,
        });

        const stream = fs.createReadStream(filePath, { start, end });
        stream.on('error', (err) => { console.error('Bodycam stream error:', err); res.destroy(); });
        stream.pipe(res);
      } else {
        res.writeHead(200, {
          'Content-Length': fileSize,
          'Content-Type': mimeType,
        });

        const stream = fs.createReadStream(filePath);
        stream.on('error', (err) => { console.error('Bodycam stream error:', err); res.destroy(); });
        stream.pipe(res);
      }
    } catch (error: any) {
      console.error('Stream bodycam video error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/personnel/bodycam-videos/:videoId/reprocess - Re-queue overlay processing (admin)
  parentRouter.post('/personnel/bodycam-videos/:videoId/reprocess', authenticateToken, requireRole('admin'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const video = db.prepare(`
        SELECT v.*, u.full_name as officer_name, u.badge_number, c.camera_id as camera_serial
        FROM bodycam_videos v
        LEFT JOIN users u ON v.officer_id = u.id
        LEFT JOIN body_cameras c ON v.camera_id = c.id
        WHERE v.id = ?
      `).get(req.params.videoId) as any;

      if (!video) {
        res.status(404).json({ error: 'Video not found' });
        return;
      }

      const inputPath = path.resolve(BODYCAM_DIR, video.file_path);
      if (!fs.existsSync(inputPath)) {
        res.status(404).json({ error: 'Original video file not found on disk' });
        return;
      }

      const recordedAt = video.recorded_at ? new Date(video.recorded_at) : new Date();
      const config: BodyCamOverlayConfig = {
        type: 'bodycam',
        officerName: video.officer_name || 'UNKNOWN',
        badgeNumber: video.badge_number || '',
        cameraSerial: video.camera_serial || '',
        recordedAtUnix: Math.floor(recordedAt.getTime() / 1000),
        caseNumber: video.case_number || '',
        classification: (video.classification || 'routine').toUpperCase(),
      };

      queueOverlayProcessing(video.id, 'bodycam', inputPath, config);
      res.json({ message: 'Overlay reprocessing queued', videoId: video.id });
    } catch (error: any) {
      console.error('Reprocess overlay error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/personnel/bodycam-videos/overlay-status - Overlay processing summary (admin)
  parentRouter.get('/personnel/bodycam-videos/overlay-status', authenticateToken, requireRole('admin'), (_req: Request, res: Response) => {
    try {
      const db = getDb();
      const stats = db.prepare(`
        SELECT overlay_status, COUNT(*) as count
        FROM bodycam_videos
        GROUP BY overlay_status
      `).all() as any[];

      const summary: Record<string, number> = { pending: 0, processing: 0, complete: 0, error: 0 };
      for (const row of stats) {
        summary[row.overlay_status || 'pending'] = row.count;
      }

      res.json(summary);
    } catch (error: any) {
      console.error('Overlay status error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/personnel/coverage-gaps - Get coverage gap analysis
  parentRouter.get('/personnel/coverage-gaps', authenticateToken, (req: Request, res: Response) => {
    try {
      const db = getDb();
      const properties = db.prepare(`
        SELECT p.id as property_id, p.name as property_name,
          COUNT(DISTINCT d.officer_id) as assigned_officers
        FROM properties p
        LEFT JOIN deployments d ON p.id = d.property_id AND d.status = 'active'
        WHERE p.is_active = 1
        GROUP BY p.id, p.name
        ORDER BY p.name
      `).all() as any[];

      const gaps = properties.map((p) => ({
        property_id: String(p.property_id),
        property_name: p.property_name,
        required_officers: 2,
        assigned_officers: p.assigned_officers || 0,
        gap: Math.max(0, 2 - (p.assigned_officers || 0)),
        shift_type: 'all',
      }));

      res.json(gaps);
    } catch (error: any) {
      console.error('Get coverage gaps error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── ANALYTICS ───────────────────────────────────────

  // GET /api/personnel/analytics - Aggregate personnel analytics
  parentRouter.get('/personnel/analytics', authenticateToken, (req: Request, res: Response) => {
    try {
      const db = getDb();

      // Headcount summary
      const totalPersonnel = (db.prepare('SELECT COUNT(*) as count FROM users').get() as any)?.count || 0;
      const activePersonnel = (db.prepare("SELECT COUNT(*) as count FROM users WHERE status = 'active'").get() as any)?.count || 0;
      const onDuty = activePersonnel;
      const clockedIn = (db.prepare("SELECT COUNT(*) as count FROM time_entries WHERE status = 'active'").get() as any)?.count || 0;

      // Avg tenure
      const tenureRows = db.prepare("SELECT hire_date FROM users WHERE hire_date IS NOT NULL AND status = 'active'").all() as any[];
      const now = Date.now();
      const avgTenure = tenureRows.length > 0
        ? tenureRows.reduce((sum: number, r: any) => sum + (now - new Date(r.hire_date).getTime()) / (365.25 * 24 * 60 * 60 * 1000), 0) / tenureRows.length
        : 0;

      // New hires / terminations in last 30 days
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const newHires = (db.prepare('SELECT COUNT(*) as count FROM users WHERE hire_date >= ?').get(thirtyDaysAgo) as any)?.count || 0;
      const terminations = (db.prepare('SELECT COUNT(*) as count FROM users WHERE termination_date >= ?').get(thirtyDaysAgo) as any)?.count || 0;

      // Hours trend (by month)
      const hoursTrend = db.prepare(`
        SELECT strftime('%Y-%m', clock_in) as month,
          SUM(total_hours) as total_hours,
          AVG(total_hours) as avg_hours_per_officer,
          SUM(CASE WHEN total_hours > 8 THEN total_hours - 8 ELSE 0 END) as overtime_hours
        FROM time_entries
        WHERE status = 'completed' AND clock_in >= date('now', '-6 months')
        GROUP BY strftime('%Y-%m', clock_in)
        ORDER BY month
      `).all();

      // Attendance patterns by day of week
      const attendancePatterns = db.prepare(`
        SELECT
          CASE CAST(strftime('%w', clock_in) AS INTEGER)
            WHEN 0 THEN 'Sun' WHEN 1 THEN 'Mon' WHEN 2 THEN 'Tue'
            WHEN 3 THEN 'Wed' WHEN 4 THEN 'Thu' WHEN 5 THEN 'Fri' WHEN 6 THEN 'Sat'
          END as day_of_week,
          COUNT(*) as avg_clock_in_count,
          AVG(total_hours) as avg_hours
        FROM time_entries
        WHERE status = 'completed'
        GROUP BY strftime('%w', clock_in)
        ORDER BY CAST(strftime('%w', clock_in) AS INTEGER)
      `).all();

      // Credential compliance
      const totalCreds = (db.prepare('SELECT COUNT(*) as count FROM credentials').get() as any)?.count || 0;
      const validCreds = (db.prepare("SELECT COUNT(*) as count FROM credentials WHERE expiry_date IS NULL OR expiry_date >= date('now')").get() as any)?.count || 0;
      const expiringSoon = (db.prepare("SELECT COUNT(*) as count FROM credentials WHERE expiry_date >= date('now') AND expiry_date <= date('now', '+90 days')").get() as any)?.count || 0;
      const expiredCreds = (db.prepare("SELECT COUNT(*) as count FROM credentials WHERE expiry_date < date('now')").get() as any)?.count || 0;

      // Overtime tracking - top officers
      const overtimeTracking = db.prepare(`
        SELECT u.full_name as officer_name, t.officer_id,
          SUM(t.total_hours) as total_hours,
          SUM(CASE WHEN t.total_hours > 8 THEN t.total_hours - 8 ELSE 0 END) as overtime_hours,
          SUM(CASE WHEN t.total_hours <= 8 THEN t.total_hours ELSE 8 END) as regular_hours
        FROM time_entries t
        LEFT JOIN users u ON t.officer_id = u.id
        WHERE t.status = 'completed'
        GROUP BY t.officer_id
        ORDER BY total_hours DESC
        LIMIT 10
      `).all();

      // Department breakdown
      const departmentBreakdown = db.prepare(`
        SELECT COALESCE(department, 'Unassigned') as department,
          COUNT(*) as count,
          SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as on_duty,
          AVG(CASE WHEN hire_date IS NOT NULL
            THEN (julianday('now') - julianday(hire_date)) / 365.25
            ELSE 0 END) as avg_tenure_years
        FROM users
        GROUP BY COALESCE(department, 'Unassigned')
        ORDER BY count DESC
      `).all();

      // Role distribution
      const ROLE_COLORS: Record<string, string> = {
        admin: '#ef4444', manager: '#a855f7', supervisor: '#f59e0b',
        officer: '#1a5a9e', dispatcher: '#3b82f6',
      };
      const roleDistribution = db.prepare(`
        SELECT role, COUNT(*) as count FROM users GROUP BY role ORDER BY count DESC
      `).all().map((r: any) => ({
        role: r.role,
        count: r.count,
        color: ROLE_COLORS[r.role] || '#6b7280',
      }));

      // Training compliance
      const totalTraining = (db.prepare('SELECT COUNT(*) as count FROM training_records').get() as any)?.count || 0;
      const completedTraining = (db.prepare("SELECT COUNT(*) as count FROM training_records WHERE status = 'completed'").get() as any)?.count || 0;
      const overdueTraining = (db.prepare("SELECT COUNT(*) as count FROM training_records WHERE status = 'overdue' OR (status = 'scheduled' AND expiry_date < date('now'))").get() as any)?.count || 0;

      res.json({
        hours_trend: hoursTrend,
        attendance_patterns: attendancePatterns,
        credential_compliance: {
          total_credentials: totalCreds,
          valid: validCreds - expiringSoon,
          expiring_soon: expiringSoon,
          expired: expiredCreds,
          compliance_rate: totalCreds > 0 ? Math.round(((validCreds - expiringSoon) / totalCreds) * 100) : 100,
        },
        overtime_tracking: overtimeTracking,
        department_breakdown: departmentBreakdown,
        role_distribution: roleDistribution,
        training_compliance: {
          total_required: totalTraining,
          completed: completedTraining,
          overdue: overdueTraining,
          completion_rate: totalTraining > 0 ? Math.round((completedTraining / totalTraining) * 100) : 100,
        },
        headcount_summary: {
          total_personnel: totalPersonnel,
          active: activePersonnel,
          on_duty: onDuty,
          clocked_in: clockedIn,
          avg_tenure_years: Math.round(avgTenure * 10) / 10,
          new_hires_30d: newHires,
          terminations_30d: terminations,
        },
      });
    } catch (error: any) {
      console.error('Get personnel analytics error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
}

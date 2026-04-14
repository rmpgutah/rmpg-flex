import { Router, Request, Response, NextFunction } from 'express';
import bcryptjs from 'bcryptjs';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { localNow, localToday } from '../utils/timeUtils';

const execFileAsync = promisify(execFile);

/** Extract video duration using ffprobe. Returns seconds or null if ffmpeg not available. */
async function extractVideoDuration(filePath: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync(
      'ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', filePath],
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
    const ext = path.extname(file.originalname || '').toLowerCase();
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

const bodycamUpload = multer({
  storage: bodycamStorage,
  limits: { fileSize: 10 * 1024 * 1024 * 1024, files: 1, fields: 20, parts: 25, fieldSize: 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (VIDEO_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} is not allowed. Accepted: MP4, MOV, AVI, WebM`));
    }
  },
});

const router = Router();

// Promote query-string token to Authorization header BEFORE authenticateToken runs.
// <video> elements can't set custom headers, so the VideoPlayer passes the JWT as
// ?token=... on the streaming URL. This middleware promotes it so authenticateToken
// can validate it normally. Safe for all personnel routes (same JWT either way).
router.use((req: Request, res: Response, next: NextFunction) => {
  if (!req.headers['authorization'] && req.query.token) {
    req.headers['authorization'] = `Bearer ${req.query.token}`;
  }
  next();
});

router.use(authenticateToken);

// ─── USERS / OFFICERS ─────────────────────────────────

// GET /api/personnel - List all personnel
router.get('/', (req: Request, res: Response) => {
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
        u.totp_enabled, u.totp_exempt,
        u.created_at, u.updated_at,
        un.call_sign as unit_call_sign
      FROM users u
      LEFT JOIN units un ON un.officer_id = u.id
      ${whereClause.replace(/\bstatus\b/g, 'u.status').replace(/\brole\b/g, 'u.role').replace(/\barchived_at\b/g, 'u.archived_at')}
      ORDER BY u.full_name
      LIMIT 500
    `).all(...params);

    res.json(users);
  } catch (error: any) {
    console.error('Get personnel error:', error);
    res.status(500).json({ error: 'Failed to get personnel', code: 'GET_PERSONNEL_ERROR' });
  }
});

// GET /api/personnel/:id - Get user details
router.get('/:id', (req: Request, res: Response, next) => {
  try {
    // Check for route conflicts with sub-paths handled by mountScheduleRoutes / training routes.
    // When this list drifts, the shadowed literal route silently 404s (see the
    // 2026-04-14 training-completion regression). Every literal-child GET route
    // on the personnel router MUST be listed here.
    const subPaths = [
      'schedules', 'time', 'credentials', 'expiring-credentials',
      'training', 'training-requirements', 'training-completion', 'training-materials', 'training-alerts',
      'deployments', 'coverage-gaps', 'analytics', 'activity', 'equipment', 'body-cameras', 'bodycam-videos',
    ];
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
      res.status(404).json({ error: 'User not found', code: 'USER_NOT_FOUND' });
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
    
      LIMIT 1000
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
    res.status(500).json({ error: 'Failed to get user', code: 'GET_USER_ERROR' });
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
      res.status(400).json({ error: 'username, password, full_name, and role are required', code: 'USERNAME_PASSWORD_FULLNAME_AND' });
      return;
    }

    const validRoles = ['admin', 'manager', 'supervisor', 'officer', 'dispatcher', 'contract_manager'];
    if (!validRoles.includes(role)) {
      res.status(400).json({ error: `role must be one of: ${validRoles.join(', ')}`, code: 'INVALID_ROLE' });
      return;
    }

    if (typeof username !== 'string' || username.trim().length < 3 || username.length > 50) {
      res.status(400).json({ error: 'username must be 3-50 characters', code: 'INVALID_USERNAME' });
      return;
    }

    if (typeof password !== 'string' || password.length < 6) {
      res.status(400).json({ error: 'password must be at least 6 characters', code: 'INVALID_PASSWORD' });
      return;
    }

    // Check username uniqueness
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) {
      res.status(409).json({ error: 'Username already exists', code: 'USERNAME_ALREADY_EXISTS' });
      return;
    }

    const passwordHash = bcryptjs.hashSync(password, 10);

    // Derive first_name/last_name from full_name if not provided
    const derivedFirst = first_name || full_name.split(' ')[0] || '';
    const derivedLast = last_name || full_name.split(' ').slice(1).join(' ') || '';

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
    res.status(500).json({ error: 'Failed to create user', code: 'CREATE_USER_ERROR' });
  }
});

// PUT /api/personnel/:id - Update user
router.put('/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id) as any;
    if (!user) {
      res.status(404).json({ error: 'User not found', code: 'USER_NOT_FOUND' });
      return;
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
    res.status(500).json({ error: 'Failed to update user', code: 'UPDATE_USER_ERROR' });
  }
});

// DELETE /api/personnel/:id - Soft-delete (terminate) user
router.delete('/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id) as any;
    if (!user) {
      res.status(404).json({ error: 'User not found', code: 'USER_NOT_FOUND' });
      return;
    }

    if (user.status === 'terminated') {
      res.status(400).json({ error: 'User is already terminated', code: 'USER_IS_ALREADY_TERMINATED' });
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
    res.status(500).json({ error: 'Failed to delete user', code: 'DELETE_USER_ERROR' });
  }
});

// POST /api/personnel/:id/archive - Archive terminated user
router.post('/:id/archive', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id) as any;
    if (!user) { res.status(404).json({ error: 'User not found', code: 'USER_NOT_FOUND' }); return; }
    if (user.status !== 'terminated') {
      res.status(400).json({ error: 'Only terminated users can be archived', code: 'ONLY_TERMINATED_USERS_CAN' }); return;
    }
    if (user.archived_at) { res.status(400).json({ error: 'User is already archived', code: 'USER_IS_ALREADY_ARCHIVED' }); return; }

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
    res.status(500).json({ error: 'Failed to archive user', code: 'ARCHIVE_USER_ERROR' });
  }
});

// POST /api/personnel/:id/unarchive
router.post('/:id/unarchive', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id) as any;
    if (!user) { res.status(404).json({ error: 'User not found', code: 'USER_NOT_FOUND' }); return; }
    if (!user.archived_at) { res.status(400).json({ error: 'User is not archived', code: 'USER_IS_NOT_ARCHIVED' }); return; }

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
    res.status(500).json({ error: 'Failed to unarchive user', code: 'UNARCHIVE_USER_ERROR' });
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
      res.status(404).json({ error: 'Video not found', code: 'VIDEO_NOT_FOUND' });
      return;
    }

    const filePath = path.resolve(BODYCAM_DIR, video.file_path);
    if (!filePath.startsWith(BODYCAM_DIR) || !fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Video file not found on disk', code: 'VIDEO_FILE_NOT_FOUND' });
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
    console.error('Stream bodycam video error:', error);
    res.status(500).json({ error: 'Failed to stream bodycam video', code: 'STREAM_BODYCAM_VIDEO_ERROR' });
  }
});

// POST /api/personnel/bodycam-videos/:videoId/reprocess — Queue overlay reprocessing
router.post('/bodycam-videos/:videoId/reprocess', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const videoId = parseInt(req.params.videoId as string, 10);
    if (isNaN(videoId)) { res.status(400).json({ error: 'Invalid video ID' }); return; }
    db.prepare("UPDATE body_camera_recordings SET overlay_status = 'pending', updated_at = datetime('now') WHERE id = ?").run(videoId);
    res.json({ success: true, message: 'Reprocessing queued' });
  } catch (error: any) {
    console.error('Bodycam reprocess error:', error);
    res.status(500).json({ error: 'Failed to queue reprocessing', code: 'BODYCAM_REPROCESS_ERROR' });
  }
});

// ─── SCHEDULES / TIME / CREDENTIALS ──────────────────
// These routes are handled via mountScheduleRoutes() in index.ts
// to avoid /:id route conflicts in this sub-router.

// ═══════════════════════════════════════════════════════════════════════════════
// PERSONNEL FEATURES (1-15)
// ═══════════════════════════════════════════════════════════════════════════════

// ─── 1. Officer Schedule Calendar View ───────────────────────────────────────
router.get('/calendar/shifts', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { month, year, officer_id } = req.query;
    const y = year ? Number(year) : new Date().getFullYear();
    const m = month ? Number(month) : new Date().getMonth() + 1;
    const startDate = `${y}-${String(m).padStart(2, '0')}-01`;
    const endDate = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;

    let sql = `SELECT s.*, u.full_name as officer_name, u.badge_number, p.name as property_name
               FROM schedules s
               JOIN users u ON u.id = s.officer_id
               LEFT JOIN properties p ON p.id = s.property_id
               WHERE s.shift_date >= ? AND s.shift_date < ?`;
    const params: any[] = [startDate, endDate];
    if (officer_id) { sql += ' AND s.officer_id = ?'; params.push(Number(officer_id)); }
    sql += ' ORDER BY s.shift_date, s.start_time';

    res.json(db.prepare(sql).all(...params));
  } catch (error: any) {
    console.error('Calendar shifts error:', error);
    res.status(500).json({ error: 'Failed to load calendar shifts', code: 'FAILED_TO_LOAD_CALENDAR' });
  }
});

// ─── 2. Emergency Contact Display — already in user fields, just a getter ────
router.get('/emergency-contacts', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const users = db.prepare(`
      SELECT id, full_name, badge_number, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship
      FROM users WHERE status = 'active' AND archived_at IS NULL
      ORDER BY full_name
    
      LIMIT 1000
    `).all();
    res.json(users);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to load emergency contacts', code: 'FAILED_TO_LOAD_EMERGENCY' });
  }
});

// ─── 3. Disciplinary Action History Timeline — see HR routes ─────────────────

// ─── 4. Officer Fitness Tracking ─────────────────────────────────────────────
router.get('/fitness/:officerId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = db.prepare('SELECT fitness_scores FROM users WHERE id = ?').get(Number(req.params.officerId)) as any;
    if (!user) return res.status(404).json({ error: 'Officer not found', code: 'OFFICER_NOT_FOUND' });
    res.json(JSON.parse(user.fitness_scores || '[]'));
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to load fitness scores', code: 'FAILED_TO_LOAD_FITNESS' });
  }
});

router.post('/fitness/:officerId', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const officerId = Number(req.params.officerId);
    const user = db.prepare('SELECT fitness_scores FROM users WHERE id = ?').get(officerId) as any;
    if (!user) return res.status(404).json({ error: 'Officer not found', code: 'OFFICER_NOT_FOUND' });

    const scores = JSON.parse(user.fitness_scores || '[]');
    const { date, score, run_time, pushups, situps, notes } = req.body;
    scores.push({ date: date || localNow().substring(0, 10), score, run_time, pushups, situps, notes, recorded_by: req.user!.userId });
    scores.sort((a: any, b: any) => b.date.localeCompare(a.date));

    db.prepare('UPDATE users SET fitness_scores = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(scores), localNow(), officerId);
    res.json({ success: true, scores });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to save fitness score', code: 'FAILED_TO_SAVE_FITNESS' });
  }
});

// ─── 5. Badge Number Search ──────────────────────────────────────────────────
router.get('/search/badge', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { q } = req.query;
    if (!q) return res.json([]);
    const rows = db.prepare(`
      SELECT id, full_name, badge_number, rank, role, status, avatar_url, profile_image
      FROM users WHERE badge_number LIKE ? AND archived_at IS NULL
      ORDER BY badge_number LIMIT 20
    `).all(`%${q}%`);
    res.json(rows);
  } catch (error: any) {
    res.status(500).json({ error: 'Badge search failed', code: 'BADGE_SEARCH_FAILED' });
  }
});

// ─── 6. Personnel Export to CSV ──────────────────────────────────────────────
router.get('/export/csv', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT id, full_name, first_name, last_name, badge_number, rank, role, department,
        email, phone, status, hire_date, termination_date, uniform_size,
        emergency_contact_name, emergency_contact_phone, emergency_contact_relationship,
        created_at
      FROM users WHERE archived_at IS NULL ORDER BY full_name
    
      LIMIT 1000
    `).all();

    // Build CSV manually
    const headers = ['Name','Badge','Rank','Role','Department','Email','Phone','Status','Hire Date','Uniform Size','Emergency Contact','Emergency Phone'];
    const csvRows = rows.map((r: any) =>
      [r.full_name, r.badge_number, r.rank, r.role, r.department, r.email, r.phone, r.status,
       r.hire_date, r.uniform_size, r.emergency_contact_name, r.emergency_contact_phone]
        .map(v => `"${(v || '').toString().replace(/"/g, '""')}"`)
        .join(',')
    );

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=personnel.csv');
    res.send([headers.join(','), ...csvRows].join('\n'));
  } catch (error: any) {
    res.status(500).json({ error: 'Export failed', code: 'EXPORT_FAILED' });
  }
});

// ─── 7. Officer Skills/Certifications Matrix ─────────────────────────────────
router.get('/certifications-matrix', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const officers = db.prepare(`
      SELECT u.id, u.full_name, u.badge_number, u.certifications
      FROM users u WHERE u.status = 'active' AND u.archived_at IS NULL
      ORDER BY u.full_name
    
      LIMIT 1000
    `).all() as any[];

    const creds = db.prepare(`
      SELECT c.officer_id, c.credential_type, c.status, c.expiry_date
      FROM credentials c
      JOIN users u ON u.id = c.officer_id
      WHERE u.status = 'active'
    
      LIMIT 1000
    `).all() as any[];

    // Build a map: officer_id → list of credential types
    const matrix: Record<number, Record<string, string>> = {};
    const allTypes = new Set<string>();

    for (const c of creds) {
      if (!matrix[c.officer_id]) matrix[c.officer_id] = {};
      matrix[c.officer_id][c.credential_type] = c.status;
      allTypes.add(c.credential_type);
    }

    res.json({
      officers: officers.map((o: any) => ({
        id: o.id, full_name: o.full_name, badge_number: o.badge_number,
        certs: matrix[o.id] || {},
      })),
      credential_types: Array.from(allTypes).sort(),
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to build certifications matrix', code: 'FAILED_TO_BUILD_CERTIFICATIONS' });
  }
});

// ─── 8. Uniform Size Tracking — already in user fields, provide summary ──────
router.get('/uniform-sizes', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT id, full_name, badge_number, uniform_size
      FROM users WHERE status = 'active' AND archived_at IS NULL
      ORDER BY full_name
    
      LIMIT 1000
    `).all();

    // Size summary for ordering
    const summary: Record<string, number> = {};
    for (const r of rows as any[]) {
      if (r.uniform_size) {
        summary[r.uniform_size] = (summary[r.uniform_size] || 0) + 1;
      }
    }

    res.json({ personnel: rows, size_summary: summary });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to load uniform sizes', code: 'FAILED_TO_LOAD_UNIFORM' });
  }
});

// ─── 9. Personnel Anniversary Reminder ───────────────────────────────────────
router.get('/anniversaries', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { days = '30' } = req.query;
    const lookAhead = Math.min(Number(days) || 30, 365);

    const officers = db.prepare(`
      SELECT id, full_name, badge_number, hire_date
      FROM users WHERE status = 'active' AND archived_at IS NULL AND hire_date IS NOT NULL
    
      LIMIT 1000
    `).all() as any[];

    const today = new Date();
    const upcoming: any[] = [];

    for (const o of officers) {
      const hireDate = new Date(o.hire_date);
      const thisYearAnniv = new Date(today.getFullYear(), hireDate.getMonth(), hireDate.getDate());
      if (thisYearAnniv < today) {
        thisYearAnniv.setFullYear(thisYearAnniv.getFullYear() + 1);
      }
      const daysUntil = Math.floor((thisYearAnniv.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      if (daysUntil <= lookAhead) {
        const years = thisYearAnniv.getFullYear() - hireDate.getFullYear();
        upcoming.push({ ...o, anniversary_date: thisYearAnniv.toISOString().slice(0, 10), years_of_service: years, days_until: daysUntil });
      }
    }

    upcoming.sort((a, b) => a.days_until - b.days_until);
    res.json(upcoming);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to load anniversaries', code: 'FAILED_TO_LOAD_ANNIVERSARIES' });
  }
});

// ─── 10. Officer Assignment History ──────────────────────────────────────────
router.get('/assignment-history/:officerId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = db.prepare('SELECT assignment_history FROM users WHERE id = ?').get(Number(req.params.officerId)) as any;
    if (!user) return res.status(404).json({ error: 'Officer not found', code: 'OFFICER_NOT_FOUND' });
    res.json(JSON.parse(user.assignment_history || '[]'));
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to load assignment history', code: 'FAILED_TO_LOAD_ASSIGNMENT' });
  }
});

router.post('/assignment-history/:officerId', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const officerId = Number(req.params.officerId);
    const user = db.prepare('SELECT assignment_history FROM users WHERE id = ?').get(officerId) as any;
    if (!user) return res.status(404).json({ error: 'Officer not found', code: 'OFFICER_NOT_FOUND' });

    const history = JSON.parse(user.assignment_history || '[]');
    const { date, unit, shift, notes } = req.body;
    history.unshift({ date: date || localNow().substring(0, 10), unit, shift, notes, assigned_by: req.user!.userId, assigned_at: localNow() });

    db.prepare('UPDATE users SET assignment_history = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(history), localNow(), officerId);
    res.json({ success: true, history });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to save assignment', code: 'FAILED_TO_SAVE_ASSIGNMENT' });
  }
});

// ─── 11. Photo ID Card Generator ─────────────────────────────────────────────
router.get('/id-card/:officerId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const officer = db.prepare(`
      SELECT id, full_name, first_name, last_name, badge_number, rank, role,
        department, hire_date, profile_image, avatar_url, photo
      FROM users WHERE id = ?
    `).get(Number(req.params.officerId)) as any;
    if (!officer) return res.status(404).json({ error: 'Officer not found', code: 'OFFICER_NOT_FOUND' });

    // Return the data needed for client-side ID card rendering / PDF generation
    res.json({
      ...officer,
      company: 'Rocky Mountain Protective Group',
      id_number: `RMPG-${String(officer.id).padStart(4, '0')}`,
      issued_date: localToday(),
      expiry_date: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to generate ID card data', code: 'FAILED_TO_GENERATE_ID' });
  }
});

// ─── 12. Personnel Status Timeline ───────────────────────────────────────────
router.get('/status-timeline/:officerId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = db.prepare('SELECT status_history, status FROM users WHERE id = ?').get(Number(req.params.officerId)) as any;
    if (!user) return res.status(404).json({ error: 'Officer not found', code: 'OFFICER_NOT_FOUND' });
    res.json(JSON.parse(user.status_history || '[]'));
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to load status timeline', code: 'FAILED_TO_LOAD_STATUS' });
  }
});

// ─── 13. Commendation Tracking ───────────────────────────────────────────────
router.get('/commendations/:officerId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = db.prepare('SELECT commendations FROM users WHERE id = ?').get(Number(req.params.officerId)) as any;
    if (!user) return res.status(404).json({ error: 'Officer not found', code: 'OFFICER_NOT_FOUND' });
    res.json(JSON.parse(user.commendations || '[]'));
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to load commendations', code: 'FAILED_TO_LOAD_COMMENDATIONS' });
  }
});

router.post('/commendations/:officerId', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const officerId = Number(req.params.officerId);
    const user = db.prepare('SELECT commendations FROM users WHERE id = ?').get(officerId) as any;
    if (!user) return res.status(404).json({ error: 'Officer not found', code: 'OFFICER_NOT_FOUND' });

    const commendations = JSON.parse(user.commendations || '[]');
    const { date, type, description, awarded_by_name } = req.body;
    commendations.unshift({
      id: Date.now(),
      date: date || localNow().substring(0, 10),
      type: type || 'commendation',
      description,
      awarded_by: req.user!.userId,
      awarded_by_name: awarded_by_name || null,
      created_at: localNow(),
    });

    db.prepare('UPDATE users SET commendations = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(commendations), localNow(), officerId);
    res.json({ success: true, commendations });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to save commendation', code: 'FAILED_TO_SAVE_COMMENDATION' });
  }
});

// ─── 14. Officer Response Time Stats ─────────────────────────────────────────
router.get('/response-times/:officerId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const officerId = Number(req.params.officerId);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // Find calls where this officer was dispatched and arrived on scene
    const unitRow = db.prepare('SELECT id, call_sign FROM units WHERE officer_id = ?').get(officerId) as any;
    if (!unitRow) return res.json({ officer_id: officerId, avg_response_minutes: null, calls_responded: 0, times: [] });

    const calls = db.prepare(`
      SELECT c.id, c.call_number, c.incident_type, c.priority,
        c.dispatched_at, c.enroute_at, c.onscene_at
      FROM calls_for_service c
      WHERE c.assigned_unit_ids LIKE ? AND c.dispatched_at >= ? AND c.onscene_at IS NOT NULL
      ORDER BY c.dispatched_at DESC
    
      LIMIT 1000
    `).all(`%${unitRow.id}%`, thirtyDaysAgo) as any[];

    const times: any[] = [];
    let totalMinutes = 0;
    for (const c of calls) {
      const dispatched = new Date(c.dispatched_at).getTime();
      const onscene = new Date(c.onscene_at).getTime();
      const minutes = (onscene - dispatched) / 60000;
      if (minutes > 0 && minutes < 180) { // Filter outliers
        times.push({ call_number: c.call_number, incident_type: c.incident_type, priority: c.priority, response_minutes: Math.round(minutes * 10) / 10 });
        totalMinutes += minutes;
      }
    }

    res.json({
      officer_id: officerId,
      avg_response_minutes: times.length > 0 ? Math.round((totalMinutes / times.length) * 10) / 10 : null,
      calls_responded: times.length,
      times,
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to load response times', code: 'FAILED_TO_LOAD_RESPONSE' });
  }
});

// ─── 15. Personnel Comparison View ───────────────────────────────────────────
router.get('/compare', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { ids } = req.query;
    if (!ids) return res.status(400).json({ error: 'ids query param required (comma-separated)', code: 'IDS_QUERY_PARAM_REQUIRED' });

    const idList = String(ids).split(',').map(Number).filter(n => !isNaN(n));
    if (idList.length < 2) return res.status(400).json({ error: 'At least 2 IDs required', code: 'AT_LEAST_2_IDS' });
    if (idList.length > 5) return res.status(400).json({ error: 'Maximum 5 officers to compare', code: 'MAXIMUM_5_OFFICERS_TO' });

    const placeholders = idList.map(() => '?').join(',');
    const officers = db.prepare(`
      SELECT id, full_name, badge_number, rank, role, department, status, hire_date,
        fitness_scores, commendations, certifications
      FROM users WHERE id IN (${placeholders})
    
      LIMIT 1000
    `).all(...idList) as any[];

    // Get credential counts
    const credCounts = db.prepare(`
      SELECT officer_id, COUNT(*) as total, SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_count
      FROM credentials WHERE officer_id IN (${placeholders})
      GROUP BY officer_id
    `).all(...idList) as any[];

    // Get training counts
    const trainingCounts = db.prepare(`
      SELECT officer_id, COUNT(*) as total, SUM(hours) as total_hours
      FROM training_records WHERE officer_id IN (${placeholders})
      GROUP BY officer_id
    `).all(...idList) as any[];

    // Get time entry totals (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const timeTotals = db.prepare(`
      SELECT officer_id, SUM(total_hours) as total_hours, COUNT(*) as shifts
      FROM time_entries WHERE officer_id IN (${placeholders}) AND clock_in >= ?
      GROUP BY officer_id
    `).all(...idList, thirtyDaysAgo) as any[];

    const credMap = Object.fromEntries(credCounts.map((c: any) => [c.officer_id, c]));
    const trainMap = Object.fromEntries(trainingCounts.map((t: any) => [t.officer_id, t]));
    const timeMap = Object.fromEntries(timeTotals.map((t: any) => [t.officer_id, t]));

    const comparison = officers.map((o: any) => ({
      ...o,
      fitness_scores: JSON.parse(o.fitness_scores || '[]'),
      commendations: JSON.parse(o.commendations || '[]'),
      credential_stats: credMap[o.id] || { total: 0, active_count: 0 },
      training_stats: trainMap[o.id] || { total: 0, total_hours: 0 },
      time_stats: timeMap[o.id] || { total_hours: 0, shifts: 0 },
    }));

    res.json(comparison);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to compare personnel', code: 'FAILED_TO_COMPARE_PERSONNEL' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// UPGRADE BATCH — Personnel Management Enhancements
// ═══════════════════════════════════════════════════════════════════════════

// ── U12: Certification Expiration Warnings (30/60/90 day) ───────────
router.get('/cert-expiration-warnings', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const today = localToday();
    const warnings: any[] = [];

    const creds = db.prepare(`
      SELECT c.id, c.officer_id, c.credential_type, c.status, c.expiry_date,
        u.full_name as officer_name, u.badge_number
      FROM credentials c JOIN users u ON u.id = c.officer_id
      WHERE u.status = 'active' AND c.expiry_date IS NOT NULL
      ORDER BY c.expiry_date ASC LIMIT 1000
    `).all() as any[];

    for (const c of creds) {
      const daysUntil = Math.floor((new Date(c.expiry_date).getTime() - new Date(today).getTime()) / 86400000);
      let severity: string | null = null;
      if (daysUntil < 0) severity = 'expired';
      else if (daysUntil <= 30) severity = 'critical';
      else if (daysUntil <= 60) severity = 'warning';
      else if (daysUntil <= 90) severity = 'upcoming';
      else continue;

      warnings.push({ credential_id: c.id, officer_id: c.officer_id, officer_name: c.officer_name,
        badge_number: c.badge_number, credential_type: c.credential_type,
        expiry_date: c.expiry_date, days_until: daysUntil, severity });
    }

    const summary = { expired: warnings.filter(w => w.severity === 'expired').length,
      within_30: warnings.filter(w => w.severity === 'critical').length,
      within_60: warnings.filter(w => w.severity === 'warning').length,
      within_90: warnings.filter(w => w.severity === 'upcoming').length };

    res.json({ warnings, summary, total: warnings.length });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to load cert warnings', code: 'CERT_WARNINGS_ERROR' });
  }
});

// ── U13: Equipment Checkout/Return Logging ──────────────────────────
router.get('/equipment-log', (req: Request, res: Response) => {
  try {
    const db = getDb();
    db.exec(`CREATE TABLE IF NOT EXISTS equipment_checkout_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, officer_id INTEGER NOT NULL,
      equipment_id INTEGER, equipment_name TEXT NOT NULL, action TEXT NOT NULL,
      condition_notes TEXT, checked_by INTEGER, created_at TEXT DEFAULT (datetime('now'))
    )`);
    const { officer_id, days = '30' } = req.query;
    const dayCount = parseInt(days as string, 10) || 30;
    let sql = `SELECT ecl.*, u.full_name as officer_name, cu.full_name as checked_by_name
      FROM equipment_checkout_log ecl LEFT JOIN users u ON ecl.officer_id = u.id
      LEFT JOIN users cu ON ecl.checked_by = cu.id WHERE ecl.created_at >= datetime('now', '-' || ? || ' days')`;
    const params: any[] = [dayCount];
    if (officer_id) { sql += ' AND ecl.officer_id = ?'; params.push(officer_id); }
    sql += ' ORDER BY ecl.created_at DESC LIMIT 500';
    res.json(db.prepare(sql).all(...params));
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to load equipment log', code: 'EQUIPMENT_LOG_ERROR' });
  }
});

router.post('/equipment-log', (req: Request, res: Response) => {
  try {
    const db = getDb();
    db.exec(`CREATE TABLE IF NOT EXISTS equipment_checkout_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, officer_id INTEGER NOT NULL,
      equipment_id INTEGER, equipment_name TEXT NOT NULL, action TEXT NOT NULL,
      condition_notes TEXT, checked_by INTEGER, created_at TEXT DEFAULT (datetime('now'))
    )`);
    const { officer_id, equipment_id, equipment_name, action, condition_notes } = req.body;
    if (!officer_id || !equipment_name || !action) return res.status(400).json({ error: 'officer_id, equipment_name, and action required', code: 'MISSING_FIELDS' });
    const result = db.prepare(`INSERT INTO equipment_checkout_log (officer_id, equipment_id, equipment_name, action, condition_notes, checked_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(officer_id, equipment_id || null, equipment_name, action, condition_notes || null, req.user!.userId, localNow());
    res.status(201).json({ success: true, id: Number(result.lastInsertRowid) });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to log equipment checkout', code: 'EQUIPMENT_CHECKOUT_ERROR' });
  }
});

// ── U14: Duty Hour Calculations ─────────────────────────────────────
router.get('/duty-hours', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { period = '14', officer_id } = req.query;
    const days = parseInt(period as string, 10) || 14;
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();

    let sql = `SELECT te.officer_id, u.full_name as officer_name, u.badge_number,
      COUNT(*) as shift_count, SUM(te.total_hours) as total_hours,
      AVG(te.total_hours) as avg_hours_per_shift, MAX(te.total_hours) as max_shift_hours,
      SUM(te.overtime_hours) as total_overtime
      FROM time_entries te JOIN users u ON u.id = te.officer_id WHERE te.clock_in >= ?`;
    const params: any[] = [cutoff];
    if (officer_id) { sql += ' AND te.officer_id = ?'; params.push(officer_id); }
    sql += ' GROUP BY te.officer_id ORDER BY total_hours DESC LIMIT 200';

    const rows = db.prepare(sql).all(...params) as any[];
    const maxWeeklyHours = 60;
    const weeklyFactor = 7 / days;
    const flagged = rows.filter((r: any) => ((r.total_hours || 0) * weeklyFactor) > maxWeeklyHours)
      .map((r: any) => ({ ...r, weekly_estimate: Math.round(((r.total_hours || 0) * weeklyFactor) * 10) / 10 }));

    res.json({ period_days: days,
      officers: rows.map((r: any) => ({ ...r, total_hours: Math.round((r.total_hours || 0) * 10) / 10,
        avg_hours_per_shift: Math.round((r.avg_hours_per_shift || 0) * 10) / 10,
        total_overtime: Math.round((r.total_overtime || 0) * 10) / 10 })),
      flagged_excessive_hours: flagged });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to load duty hours', code: 'DUTY_HOURS_ERROR' });
  }
});

// ── U15: Personnel Notifications ────────────────────────────────────
router.get('/notifications', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const today = localToday();
    const notifications: any[] = [];

    try {
      const expiring = db.prepare(`SELECT c.credential_type, c.expiry_date, u.full_name, u.id as officer_id
        FROM credentials c JOIN users u ON u.id = c.officer_id
        WHERE u.status = 'active' AND c.expiry_date IS NOT NULL
        AND c.expiry_date <= date(?, '+30 days') ORDER BY c.expiry_date ASC LIMIT 50`).all(today) as any[];
      for (const e of expiring) {
        const daysUntil = Math.floor((new Date(e.expiry_date).getTime() - new Date(today).getTime()) / 86400000);
        notifications.push({ type: 'cert_expiring', severity: daysUntil < 0 ? 'critical' : 'warning',
          message: `${e.full_name}: ${e.credential_type} ${daysUntil < 0 ? 'expired' : 'expires in ' + daysUntil + ' days'}`,
          officer_id: e.officer_id, date: e.expiry_date });
      }
    } catch { /* table may not exist */ }

    try {
      const overdue = db.prepare(`SELECT t.course_name, t.officer_id, u.full_name, t.expiry_date
        FROM training_records t JOIN users u ON u.id = t.officer_id
        WHERE t.status = 'overdue' OR (t.expiry_date IS NOT NULL AND t.expiry_date < ?) LIMIT 50`).all(today) as any[];
      for (const t of overdue) {
        notifications.push({ type: 'training_overdue', severity: 'warning',
          message: `${t.full_name}: ${t.course_name} training overdue`,
          officer_id: t.officer_id, date: t.expiry_date });
      }
    } catch { /* table may not exist */ }

    notifications.sort((a, b) => ({ critical: 0, warning: 1, info: 2 }[a.severity as string] || 9) - ({ critical: 0, warning: 1, info: 2 }[b.severity as string] || 9));
    res.json({ notifications, total: notifications.length });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to load personnel notifications', code: 'PERSONNEL_NOTIFICATIONS_ERROR' });
  }
});

// ── U16: Personnel Analytics Dashboard ──────────────────────────────
router.get('/analytics-dashboard', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const today = localToday();
    const totalActive = (db.prepare("SELECT COUNT(*) as cnt FROM users WHERE status = 'active'").get() as any)?.cnt || 0;
    const byRole = db.prepare("SELECT role, COUNT(*) as count FROM users WHERE status = 'active' GROUP BY role ORDER BY count DESC").all();
    const byDepartment = db.prepare("SELECT department, COUNT(*) as count FROM users WHERE status = 'active' AND department IS NOT NULL GROUP BY department ORDER BY count DESC").all();

    let credCompliance = { total_creds: 0, active_creds: 0, expired_creds: 0 };
    try {
      const cc = db.prepare(`SELECT COUNT(*) as total, SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_count, SUM(CASE WHEN expiry_date < ? THEN 1 ELSE 0 END) as expired_count FROM credentials`).get(today) as any;
      credCompliance = { total_creds: cc.total || 0, active_creds: cc.active_count || 0, expired_creds: cc.expired_count || 0 };
    } catch { /* ok */ }

    let trainingStats = { total_records: 0, completed: 0, avg_hours: 0 };
    try {
      const ts = db.prepare(`SELECT COUNT(*) as total, SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed, AVG(hours) as avg_hours FROM training_records`).get() as any;
      trainingStats = { total_records: ts.total || 0, completed: ts.completed || 0, avg_hours: Math.round((ts.avg_hours || 0) * 10) / 10 };
    } catch { /* ok */ }

    res.json({ total_active: totalActive, by_role: byRole, by_department: byDepartment, credential_compliance: credCompliance, training_stats: trainingStats });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to load analytics dashboard', code: 'ANALYTICS_DASHBOARD_ERROR' });
  }
});

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
      
        LIMIT 1000
      `).all(...params);

      res.json(schedules);
    } catch (error: any) {
      console.error('Get schedules error:', error);
      res.status(500).json({ error: 'Failed to get schedules', code: 'GET_SCHEDULES_ERROR' });
    }
  });

  // POST /api/personnel/schedules
  parentRouter.post('/personnel/schedules', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const { officer_id, property_id, shift_date, start_time, end_time, notes } = req.body;

      if (!officer_id || !shift_date || !start_time || !end_time) {
        res.status(400).json({ error: 'officer_id, shift_date, start_time, and end_time are required', code: 'OFFICERID_SHIFTDATE_STARTTIME_AND' });
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
      res.status(500).json({ error: 'Failed to create schedule', code: 'CREATE_SCHEDULE_ERROR' });
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
        res.status(403).json({ error: 'You can only clock in yourself', code: 'YOU_CAN_ONLY_CLOCK' });
        return;
      }

      // Check if already clocked in
      const activeEntry = db.prepare(`
        SELECT * FROM time_entries WHERE officer_id = ? AND status IN ('active', 'on_break')
      `).get(targetId) as any;

      if (activeEntry) {
        // Admin God Mode: force clock-out then clock-in
        if (req.user?.role === 'admin') {
          const now2 = localNow();
          let breakMins2 = Number(activeEntry.break_minutes) || 0;
          if (activeEntry.status === 'on_break' && activeEntry.break_start) {
            const bs = new Date(activeEntry.break_start.replace(' ', 'T'));
            const be = new Date(now2.replace(' ', 'T'));
            breakMins2 += Math.round(((be.getTime() - bs.getTime()) / 60000) * 10000) / 10000;
          }
          const ci = new Date(activeEntry.clock_in.replace(' ', 'T'));
          const co = new Date(now2.replace(' ', 'T'));
          const rawH = (co.getTime() - ci.getTime()) / 3600000;
          const totH = Math.max(0, Math.round((rawH - breakMins2 / 60) * 10000) / 10000);
          db.prepare(`UPDATE time_entries SET clock_out = ?, total_hours = ?, break_minutes = ?, break_start = NULL, status = 'completed' WHERE id = ?`)
            .run(now2, totH, breakMins2, activeEntry.id);
          db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, 'ADMIN_OVERRIDE', 'time_entry', ?, ?, ?)`)
            .run(req.user!.userId, activeEntry.id, `Admin God Mode: force clock-out before re-clock-in (was ${activeEntry.status}, hours: ${totH})`, req.ip || 'unknown');
        } else {
          res.status(400).json({ error: 'Already clocked in', activeEntry });
          return;
        }
      }

      const now = localNow();

      const result = db.prepare(`
        INSERT INTO time_entries (officer_id, schedule_id, clock_in, clock_in_latitude, clock_in_longitude)
        VALUES (?, ?, ?, ?, ?)
      `).run(targetId, schedule_id || null, now, latitude || null, longitude || null);

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
      res.status(500).json({ error: 'Failed to clock in', code: 'CLOCK_IN_ERROR' });
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
        res.status(403).json({ error: 'You can only clock out yourself', code: 'YOU_CAN_ONLY_CLOCK' });
        return;
      }

      const activeEntry = db.prepare(`
        SELECT * FROM time_entries WHERE officer_id = ? AND status IN ('active', 'on_break') ORDER BY clock_in DESC LIMIT 1
      `).get(targetId) as any;

      if (!activeEntry) {
        // Admin God Mode: create a completed time entry if not clocked in
        if (req.user?.role === 'admin') {
          const now = localNow();
          const result = db.prepare(`
            INSERT INTO time_entries (officer_id, clock_in, clock_out, total_hours, status)
            VALUES (?, ?, ?, 0, 'completed')
          `).run(targetId, now, now);
          db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, 'ADMIN_OVERRIDE', 'time_entry', ?, ?, ?)`)
            .run(req.user!.userId, result.lastInsertRowid, `Admin God Mode: created completed entry for officer not clocked in`, req.ip || 'unknown');
          const entry = db.prepare(`
            SELECT t.*, u.full_name as officer_name, u.badge_number
            FROM time_entries t LEFT JOIN users u ON t.officer_id = u.id WHERE t.id = ?
          `).get(result.lastInsertRowid);
          res.json(entry);
          return;
        }
        res.status(400).json({ error: 'Not currently clocked in', code: 'NOT_CURRENTLY_CLOCKED_IN' });
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
      res.status(500).json({ error: 'Failed to clock out', code: 'CLOCK_OUT_ERROR' });
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
        res.status(403).json({ error: 'Insufficient permissions', code: 'INSUFFICIENT_PERMISSIONS' });
        return;
      }

      const activeEntry = db.prepare(`
        SELECT * FROM time_entries WHERE officer_id = ? AND status = 'active' ORDER BY clock_in DESC LIMIT 1
      `).get(targetId) as any;

      if (!activeEntry) {
        res.status(400).json({ error: 'Not currently clocked in (or already on break)', code: 'NOT_CURRENTLY_CLOCKED_IN' });
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
      res.status(500).json({ error: 'Failed to start break', code: 'START_BREAK_ERROR' });
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
        res.status(403).json({ error: 'Insufficient permissions', code: 'INSUFFICIENT_PERMISSIONS' });
        return;
      }

      const breakEntry = db.prepare(`
        SELECT * FROM time_entries WHERE officer_id = ? AND status = 'on_break' ORDER BY clock_in DESC LIMIT 1
      `).get(targetId) as any;

      if (!breakEntry) {
        res.status(400).json({ error: 'Not currently on break', code: 'NOT_CURRENTLY_ON_BREAK' });
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
      res.status(500).json({ error: 'Failed to end break', code: 'END_BREAK_ERROR' });
    }
  });

  // POST /api/personnel/time/batch-clock-in - Clock in multiple officers at once
  parentRouter.post('/personnel/time/batch-clock-in', authenticateToken, requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const { officer_ids } = req.body;
      if (!Array.isArray(officer_ids) || officer_ids.length === 0) {
        res.status(400).json({ error: 'officer_ids array is required', code: 'OFFICERIDS_ARRAY_IS_REQUIRED' });
        return;
      }

      const results: { officer_id: number; success: boolean; error?: string }[] = [];

      for (const officerId of officer_ids) {
        const existing = db.prepare("SELECT id FROM time_entries WHERE officer_id = ? AND status IN ('active', 'on_break')").get(officerId);
        if (existing) {
          results.push({ officer_id: officerId, success: false, error: 'Already clocked in' });
          continue;
        }

        db.prepare('INSERT INTO time_entries (officer_id, clock_in, status) VALUES (?, datetime("now","localtime"), "active")').run(officerId);

        db.prepare("INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, 'clock_in', 'time_entry', ?, ?, ?)")
          .run(req.user!.userId, officerId, `Batch clock-in for officer ${officerId}`, req.ip || 'unknown');

        results.push({ officer_id: officerId, success: true });
      }

      res.json({ results, clocked_in: results.filter(r => r.success).length, skipped: results.filter(r => !r.success).length });
    } catch (error: any) {
      console.error('Batch clock-in error:', error);
      res.status(500).json({ error: 'Failed to batch clock-in', code: 'BATCH_CLOCKIN_ERROR' });
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
      
        LIMIT 1000
      `).all(req.params.officerId);

      res.json(credentials);
    } catch (error: any) {
      console.error('Get credentials error:', error);
      res.status(500).json({ error: 'Failed to get credentials', code: 'GET_CREDENTIALS_ERROR' });
    }
  });

  // GET /api/personnel/time - List all time entries
  parentRouter.get('/personnel/time', authenticateToken, (req: Request, res: Response) => {
    try {
      const db = getDb();
      const { status, date, start_date, end_date } = req.query;

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
      if (start_date) {
        whereClause += ' AND DATE(t.clock_in) >= ?';
        params.push(start_date);
      }
      if (end_date) {
        whereClause += ' AND DATE(t.clock_in) <= ?';
        params.push(end_date);
      }

      if (req.user!.role === 'officer') {
        whereClause += ' AND t.officer_id = ?';
        params.push(req.user!.userId);
      }

      const entries = db.prepare(`
        SELECT t.*, u.full_name as officer_name, u.badge_number,
          (SELECT COUNT(*) FROM time_entry_edits WHERE time_entry_id = t.id) as edit_count,
          (SELECT u2.full_name FROM users u2 WHERE u2.id = t.edited_by) as edited_by_name
        FROM time_entries t
        LEFT JOIN users u ON t.officer_id = u.id
        ${whereClause}
        ORDER BY t.clock_in DESC
        LIMIT 500
      `).all(...params);

      res.json(entries);
    } catch (error: any) {
      console.error('Get time entries error:', error);
      res.status(500).json({ error: 'Failed to get time entries', code: 'GET_TIME_ENTRIES_ERROR' });
    }
  });

  // PUT /api/personnel/time/:id - Edit a time entry (punch correction)
  parentRouter.put('/personnel/time/:id', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const entry = db.prepare('SELECT * FROM time_entries WHERE id = ?').get(req.params.id) as any;
      if (!entry) { res.status(404).json({ error: 'Time entry not found', code: 'TIME_ENTRY_NOT_FOUND' }); return; }

      const { clock_in, clock_out, reason, notes } = req.body;
      if (!clock_in) { res.status(400).json({ error: 'clock_in is required', code: 'CLOCKIN_IS_REQUIRED' }); return; }
      if (!reason) { res.status(400).json({ error: 'reason is required for edits', code: 'REASON_IS_REQUIRED_FOR' }); return; }

      const editorName = (db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.user!.userId) as any)?.full_name || 'Unknown';

      // Log individual field changes to audit table
      if (entry.clock_in !== clock_in) {
        db.prepare('INSERT INTO time_entry_edits (time_entry_id, edited_by, edited_by_name, edit_type, old_value, new_value, reason) VALUES (?,?,?,?,?,?,?)')
          .run(entry.id, req.user!.userId, editorName, 'clock_in_changed', entry.clock_in, clock_in, reason);
      }
      if ((entry.clock_out || '') !== (clock_out || '')) {
        db.prepare('INSERT INTO time_entry_edits (time_entry_id, edited_by, edited_by_name, edit_type, old_value, new_value, reason) VALUES (?,?,?,?,?,?,?)')
          .run(entry.id, req.user!.userId, editorName, 'clock_out_changed', entry.clock_out || null, clock_out || null, reason);
      }

      // Recalculate total hours
      let totalHours: number | null = null;
      if (clock_out) {
        const start = new Date(clock_in).getTime();
        const end = new Date(clock_out).getTime();
        totalHours = Math.round(((end - start) / (1000 * 60 * 60)) * 10000) / 10000;
        if (totalHours < 0) totalHours = 0;
      }

      db.prepare(`
        UPDATE time_entries SET clock_in = ?, clock_out = ?, total_hours = ?, status = 'edited',
          notes = COALESCE(?, notes), edit_reason = ?, edited_by = ?, edited_at = datetime('now','localtime')
        WHERE id = ?
      `).run(clock_in, clock_out || null, totalHours, notes || null, reason, req.user!.userId, req.params.id);

      db.prepare(`
        INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, 'time_entry_edited', 'time_entry', ?, ?, ?)
      `).run(req.user!.userId, req.params.id, `Edited time entry for officer ${entry.officer_id}: ${reason}`, req.ip || 'unknown');

      const updated = db.prepare(`
        SELECT t.*, u.full_name as officer_name, u.badge_number,
          (SELECT COUNT(*) FROM time_entry_edits WHERE time_entry_id = t.id) as edit_count,
          (SELECT u2.full_name FROM users u2 WHERE u2.id = t.edited_by) as edited_by_name
        FROM time_entries t LEFT JOIN users u ON t.officer_id = u.id WHERE t.id = ?
      `).get(req.params.id);

      res.json(updated);
    } catch (error: any) {
      console.error('Edit time entry error:', error);
      res.status(500).json({ error: 'Failed to edit time entry', code: 'EDIT_TIME_ENTRY_ERROR' });
    }
  });

  // DELETE /api/personnel/time/:id - Delete time entry (admin/manager only)
  parentRouter.delete('/personnel/time/:id', authenticateToken, requireRole('admin', 'manager'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const entry = db.prepare('SELECT * FROM time_entries WHERE id = ?').get(req.params.id) as any;
      if (!entry) {
        res.status(404).json({ error: 'Time entry not found', code: 'TIME_ENTRY_NOT_FOUND' });
        return;
      }

      const editorName = (db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.user!.userId) as any)?.full_name || 'Unknown';
      db.prepare('INSERT INTO time_entry_edits (time_entry_id, edited_by, edited_by_name, edit_type, old_value, new_value, reason) VALUES (?,?,?,?,?,?,?)')
        .run(entry.id, req.user!.userId, editorName, 'deleted',
          JSON.stringify({ clock_in: entry.clock_in, clock_out: entry.clock_out, total_hours: entry.total_hours, officer_id: entry.officer_id }),
          null, 'Deleted by ' + editorName);

      db.prepare('DELETE FROM time_entries WHERE id = ?').run(req.params.id);

      db.prepare(`
        INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, 'time_entry_deleted', 'time_entry', ?, ?, ?)
      `).run(req.user!.userId, req.params.id, `Deleted time entry for officer ${entry.officer_id}`, req.ip || 'unknown');

      res.json({ success: true, id: req.params.id });
    } catch (error: any) {
      console.error('Delete time entry error:', error);
      res.status(500).json({ error: 'Failed to delete time entry', code: 'DELETE_TIME_ENTRY_ERROR' });
    }
  });

  // GET /api/personnel/time/:id/history - Edit history for a time entry
  parentRouter.get('/personnel/time/:id/history', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const edits = db.prepare(
        'SELECT * FROM time_entry_edits WHERE time_entry_id = ? ORDER BY created_at DESC'
      ).all(req.params.id);
      res.json(edits);
    } catch (error: any) {
      console.error('Get time entry history error:', error);
      res.status(500).json({ error: 'Failed to get time entry history', code: 'GET_TIME_ENTRY_HISTORY' });
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
      
        LIMIT 1000
      `).all();

      res.json(credentials);
    } catch (error: any) {
      console.error('Get all credentials error:', error);
      res.status(500).json({ error: 'Failed to get all credentials', code: 'GET_ALL_CREDENTIALS_ERROR' });
    }
  });

  // GET /api/personnel/expiring-credentials — Find credentials expiring within N days
  parentRouter.get('/personnel/expiring-credentials', authenticateToken, (req: Request, res: Response) => {
    try {
      const db = getDb();
      const days = parseInt(req.query.days as string, 10) || 30;
      const clampedDays = Math.max(1, Math.min(days, 365));
      const expiring = db.prepare(`
        SELECT c.*, u.full_name as officer_name, u.badge_number, u.id as officer_id
        FROM credentials c
        JOIN users u ON c.officer_id = u.id
        WHERE c.expiry_date IS NOT NULL
          AND c.expiry_date <= date('now', '+' || ? || ' days')
          AND c.expiry_date >= date('now')
          AND c.status != 'expired'
          AND u.status = 'active'
          AND u.archived_at IS NULL
        ORDER BY c.expiry_date ASC
        LIMIT 200
      `).all(clampedDays);
      res.json({ data: expiring, count: expiring.length, days_window: clampedDays });
    } catch (error: any) {
      console.error('Get expiring credentials error:', error);
      // Table might not exist or schema mismatch — return empty gracefully
      res.json({ data: [], count: 0, days_window: 30 });
    }
  });

  // POST /api/personnel/credentials
  parentRouter.post('/personnel/credentials', authenticateToken, requireRole('admin', 'manager'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const { officer_id, credential_type, credential_number, issued_date, expiry_date, notes } = req.body;

      if (!officer_id || !credential_type) {
        res.status(400).json({ error: 'officer_id and credential_type are required', code: 'OFFICERID_AND_CREDENTIALTYPE_ARE' });
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
      res.status(500).json({ error: 'Failed to create credential', code: 'CREATE_CREDENTIAL_ERROR' });
    }
  });

  // PUT /api/personnel/credentials/:id - Update credential
  parentRouter.put('/personnel/credentials/:id', authenticateToken, requireRole('admin', 'manager'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const existing = db.prepare('SELECT * FROM credentials WHERE id = ?').get(req.params.id) as any;
      if (!existing) {
        res.status(404).json({ error: 'Credential not found', code: 'CREDENTIAL_NOT_FOUND' });
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
      res.status(500).json({ error: 'Failed to update credential', code: 'UPDATE_CREDENTIAL_ERROR' });
    }
  });

  // DELETE /api/personnel/credentials/:id - Delete credential
  parentRouter.delete('/personnel/credentials/:id', authenticateToken, requireRole('admin', 'manager'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const existing = db.prepare('SELECT * FROM credentials WHERE id = ?').get(req.params.id) as any;
      if (!existing) {
        res.status(404).json({ error: 'Credential not found', code: 'CREDENTIAL_NOT_FOUND' });
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
      res.status(500).json({ error: 'Failed to delete credential', code: 'DELETE_CREDENTIAL_ERROR' });
    }
  });

  // POST /api/personnel/credentials/:id/archive
  parentRouter.post('/personnel/credentials/:id/archive', authenticateToken, requireRole('admin', 'manager'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const cred = db.prepare('SELECT * FROM credentials WHERE id = ?').get(req.params.id) as any;
      if (!cred) { res.status(404).json({ error: 'Credential not found', code: 'CREDENTIAL_NOT_FOUND' }); return; }
      if (cred.archived_at) { res.status(400).json({ error: 'Already archived', code: 'ALREADY_ARCHIVED' }); return; }
      const now = localNow();
      db.prepare('UPDATE credentials SET archived_at = ? WHERE id = ?').run(now, cred.id);
      const updated = db.prepare('SELECT * FROM credentials WHERE id = ?').get(cred.id);
      res.json(updated);
    } catch (error: any) {
      console.error('Archive credential error:', error);
      res.status(500).json({ error: 'Failed to archive credential', code: 'ARCHIVE_CREDENTIAL_ERROR' });
    }
  });

  // POST /api/personnel/credentials/:id/unarchive
  parentRouter.post('/personnel/credentials/:id/unarchive', authenticateToken, requireRole('admin', 'manager'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const cred = db.prepare('SELECT * FROM credentials WHERE id = ?').get(req.params.id) as any;
      if (!cred) { res.status(404).json({ error: 'Credential not found', code: 'CREDENTIAL_NOT_FOUND' }); return; }
      if (!cred.archived_at) { res.status(400).json({ error: 'Not archived', code: 'NOT_ARCHIVED' }); return; }
      db.prepare('UPDATE credentials SET archived_at = NULL WHERE id = ?').run(cred.id);
      const updated = db.prepare('SELECT * FROM credentials WHERE id = ?').get(cred.id);
      res.json(updated);
    } catch (error: any) {
      console.error('Unarchive credential error:', error);
      res.status(500).json({ error: 'Failed to unarchive credential', code: 'UNARCHIVE_CREDENTIAL_ERROR' });
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
      res.status(500).json({ error: 'Failed to get user activity', code: 'GET_USER_ACTIVITY_ERROR' });
    }
  });

  // DELETE /api/personnel/schedules/:id - Delete schedule
  parentRouter.delete('/personnel/schedules/:id', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const existing = db.prepare('SELECT * FROM schedules WHERE id = ?').get(req.params.id) as any;
      if (!existing) {
        res.status(404).json({ error: 'Schedule not found', code: 'SCHEDULE_NOT_FOUND' });
        return;
      }

      db.prepare('DELETE FROM schedules WHERE id = ?').run(req.params.id);
      res.json({ message: 'Schedule deleted' });
    } catch (error: any) {
      console.error('Delete schedule error:', error);
      res.status(500).json({ error: 'Failed to delete schedule', code: 'DELETE_SCHEDULE_ERROR' });
    }
  });

  // PUT /api/personnel/schedules/:id - Update schedule
  parentRouter.put('/personnel/schedules/:id', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const existing = db.prepare('SELECT * FROM schedules WHERE id = ?').get(req.params.id) as any;
      if (!existing) {
        res.status(404).json({ error: 'Schedule not found', code: 'SCHEDULE_NOT_FOUND' });
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
      res.status(500).json({ error: 'Failed to update schedule', code: 'UPDATE_SCHEDULE_ERROR' });
    }
  });

  // POST /api/personnel/schedules/:id/archive
  parentRouter.post('/personnel/schedules/:id/archive', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const schedule = db.prepare('SELECT * FROM schedules WHERE id = ?').get(req.params.id) as any;
      if (!schedule) { res.status(404).json({ error: 'Schedule not found', code: 'SCHEDULE_NOT_FOUND' }); return; }
      if (schedule.archived_at) { res.status(400).json({ error: 'Already archived', code: 'ALREADY_ARCHIVED' }); return; }
      const now = localNow();
      db.prepare('UPDATE schedules SET archived_at = ? WHERE id = ?').run(now, schedule.id);
      const updated = db.prepare('SELECT * FROM schedules WHERE id = ?').get(schedule.id);
      res.json(updated);
    } catch (error: any) {
      console.error('Archive schedule error:', error);
      res.status(500).json({ error: 'Failed to archive schedule', code: 'ARCHIVE_SCHEDULE_ERROR' });
    }
  });

  // POST /api/personnel/schedules/:id/unarchive
  parentRouter.post('/personnel/schedules/:id/unarchive', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const schedule = db.prepare('SELECT * FROM schedules WHERE id = ?').get(req.params.id) as any;
      if (!schedule) { res.status(404).json({ error: 'Schedule not found', code: 'SCHEDULE_NOT_FOUND' }); return; }
      if (!schedule.archived_at) { res.status(400).json({ error: 'Not archived', code: 'NOT_ARCHIVED' }); return; }
      db.prepare('UPDATE schedules SET archived_at = NULL WHERE id = ?').run(schedule.id);
      const updated = db.prepare('SELECT * FROM schedules WHERE id = ?').get(schedule.id);
      res.json(updated);
    } catch (error: any) {
      console.error('Unarchive schedule error:', error);
      res.status(500).json({ error: 'Failed to unarchive schedule', code: 'UNARCHIVE_SCHEDULE_ERROR' });
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
      
        LIMIT 1000
      `).all();
      res.json(records);
    } catch (error: any) {
      console.error('Get training records error:', error);
      res.status(500).json({ error: 'Failed to get training records', code: 'GET_TRAINING_RECORDS_ERROR' });
    }
  });

  // GET /api/personnel/training-requirements - List required trainings
  parentRouter.get('/personnel/training-requirements', authenticateToken, (req: Request, res: Response) => {
    try {
      const db = getDb();
      const requirements = db.prepare('SELECT * FROM training_requirements ORDER BY course_name').all();
      res.json(requirements.map((r: any) => ({
        ...r,
        required_for_roles: typeof r.required_for_roles === 'string' ? JSON.parse(r.required_for_roles) : r.required_for_roles,
        is_mandatory: !!r.is_mandatory,
      })));
    } catch (error: any) {
      console.error('Get training requirements error:', error);
      res.status(500).json({ error: 'Failed to get training requirements', code: 'GET_TRAINING_REQUIREMENTS_ERROR' });
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
      
        LIMIT 1000
      `).all(req.params.officerId);
      res.json(records);
    } catch (error: any) {
      console.error('Get officer training error:', error);
      res.status(500).json({ error: 'Failed to get officer training', code: 'GET_OFFICER_TRAINING_ERROR' });
    }
  });

  // POST /api/personnel/training - Create training record
  parentRouter.post('/personnel/training', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const { officer_id, course_name, category, provider, completed_date, expiry_date, score, hours, certificate_number, status, notes } = req.body;

      if (!officer_id || !course_name) {
        res.status(400).json({ error: 'officer_id and course_name are required', code: 'OFFICERID_AND_COURSENAME_ARE' });
        return;
      }

      const result = db.prepare(`
        INSERT INTO training_records (officer_id, course_name, category, provider, completed_date, expiry_date, score, hours, certificate_number, status, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        officer_id, course_name, category || 'other', provider || null,
        completed_date || null, expiry_date || null, score || null, hours || 0,
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
      res.status(500).json({ error: 'Failed to create training record', code: 'CREATE_TRAINING_RECORD_ERROR' });
    }
  });

  // PUT /api/personnel/training/:id - Update training record
  parentRouter.put('/personnel/training/:id', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const existing = db.prepare('SELECT * FROM training_records WHERE id = ?').get(req.params.id) as any;
      if (!existing) {
        res.status(404).json({ error: 'Training record not found', code: 'TRAINING_RECORD_NOT_FOUND' });
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
      res.status(500).json({ error: 'Failed to update training record', code: 'UPDATE_TRAINING_RECORD_ERROR' });
    }
  });

  // DELETE /api/personnel/training/:id - Delete training record
  parentRouter.delete('/personnel/training/:id', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const existing = db.prepare('SELECT * FROM training_records WHERE id = ?').get(req.params.id) as any;
      if (!existing) {
        res.status(404).json({ error: 'Training record not found', code: 'TRAINING_RECORD_NOT_FOUND' });
        return;
      }

      db.prepare('DELETE FROM training_records WHERE id = ?').run(req.params.id);
      res.json({ message: 'Training record deleted' });
    } catch (error: any) {
      console.error('Delete training record error:', error);
      res.status(500).json({ error: 'Failed to delete training record', code: 'DELETE_TRAINING_RECORD_ERROR' });
    }
  });

  // POST /api/personnel/training/:id/archive
  parentRouter.post('/personnel/training/:id/archive', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const record = db.prepare('SELECT * FROM training_records WHERE id = ?').get(req.params.id) as any;
      if (!record) { res.status(404).json({ error: 'Training record not found', code: 'TRAINING_RECORD_NOT_FOUND' }); return; }
      if (record.archived_at) { res.status(400).json({ error: 'Already archived', code: 'ALREADY_ARCHIVED' }); return; }
      const now = localNow();
      db.prepare('UPDATE training_records SET archived_at = ? WHERE id = ?').run(now, record.id);
      const updated = db.prepare('SELECT * FROM training_records WHERE id = ?').get(record.id);
      res.json(updated);
    } catch (error: any) {
      console.error('Archive training record error:', error);
      res.status(500).json({ error: 'Failed to archive training record', code: 'ARCHIVE_TRAINING_RECORD_ERROR' });
    }
  });

  // POST /api/personnel/training/:id/unarchive
  parentRouter.post('/personnel/training/:id/unarchive', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const record = db.prepare('SELECT * FROM training_records WHERE id = ?').get(req.params.id) as any;
      if (!record) { res.status(404).json({ error: 'Training record not found', code: 'TRAINING_RECORD_NOT_FOUND' }); return; }
      if (!record.archived_at) { res.status(400).json({ error: 'Not archived', code: 'NOT_ARCHIVED' }); return; }
      db.prepare('UPDATE training_records SET archived_at = NULL WHERE id = ?').run(record.id);
      const updated = db.prepare('SELECT * FROM training_records WHERE id = ?').get(record.id);
      res.json(updated);
    } catch (error: any) {
      console.error('Unarchive training record error:', error);
      res.status(500).json({ error: 'Failed to unarchive training record', code: 'UNARCHIVE_TRAINING_RECORD_ERROR' });
    }
  });

  // ════════════════════════════════════════════════════════
  // FEATURE 16: Training Calendar — events by month
  // ════════════════════════════════════════════════════════

  parentRouter.get('/personnel/training-calendar', authenticateToken, (req: Request, res: Response) => {
    try {
      const db = getDb();
      const { month, year } = req.query;
      const y = parseInt(year as string, 10) || new Date().getFullYear();
      const m = parseInt(month as string, 10) || (new Date().getMonth() + 1);
      const startDate = `${y}-${String(m).padStart(2, '0')}-01`;
      const endDate = `${y}-${String(m).padStart(2, '0')}-31`;

      const records = db.prepare(`
        SELECT t.*, u.full_name as officer_name
        FROM training_records t
        LEFT JOIN users u ON t.officer_id = u.id
        WHERE (t.completed_date BETWEEN ? AND ?)
          OR (t.status = 'scheduled' AND t.completed_date BETWEEN ? AND ?)
        ORDER BY t.completed_date ASC
      
        LIMIT 1000
      `).all(startDate, endDate, startDate, endDate);

      // Group by date
      const calendar: Record<string, any[]> = {};
      for (const rec of records as any[]) {
        const date = rec.completed_date || 'unscheduled';
        if (!calendar[date]) calendar[date] = [];
        calendar[date].push(rec);
      }

      // Include upcoming requirements
      const requirements = db.prepare(`
        SELECT * FROM training_requirements WHERE is_mandatory = 1
      
        LIMIT 1000
      `).all();

      res.json({ calendar, requirements, month: m, year: y });
    } catch (error: any) {
      console.error('Training calendar error:', error);
      res.status(500).json({ error: 'Failed to training calendar', code: 'TRAINING_CALENDAR_ERROR' });
    }
  });

  // ════════════════════════════════════════════════════════
  // FEATURE 17: Training Attendance Tracking
  // ════════════════════════════════════════════════════════

  parentRouter.get('/personnel/training/:id/attendance', authenticateToken, (req: Request, res: Response) => {
    try {
      const db = getDb();
      const record = db.prepare('SELECT * FROM training_records WHERE id = ?').get(req.params.id) as any;
      if (!record) { res.status(404).json({ error: 'Training record not found', code: 'TRAINING_RECORD_NOT_FOUND' }); return; }
      const attendance = JSON.parse(record.attendance || '[]');
      res.json({ data: attendance });
    } catch (error: any) { res.status(500).json({ error: 'Server error in personnel', code: 'PERSONNEL_ERROR' }); }
  });

  parentRouter.put('/personnel/training/:id/attendance', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const { attendance } = req.body;
      // attendance: [{ officer_id, officer_name, present: boolean, arrived_at, left_at, notes }]
      if (!Array.isArray(attendance)) { res.status(400).json({ error: 'attendance must be an array', code: 'ATTENDANCE_MUST_BE_AN' }); return; }

      const record = db.prepare('SELECT * FROM training_records WHERE id = ?').get(req.params.id) as any;
      if (!record) { res.status(404).json({ error: 'Training record not found', code: 'TRAINING_RECORD_NOT_FOUND' }); return; }

      const sanitized = attendance.slice(0, 100).map((a: any) => ({
        officer_id: a.officer_id,
        officer_name: String(a.officer_name || '').slice(0, 200),
        present: !!a.present,
        arrived_at: a.arrived_at || null,
        left_at: a.left_at || null,
        notes: String(a.notes || '').slice(0, 500),
      }));

      db.prepare('UPDATE training_records SET attendance = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(sanitized), localNow(), req.params.id);

      res.json({ data: sanitized });
    } catch (error: any) {
      console.error('Training attendance error:', error);
      res.status(500).json({ error: 'Failed to training attendance', code: 'TRAINING_ATTENDANCE_ERROR' });
    }
  });

  // ════════════════════════════════════════════════════════
  // FEATURE 18: Training Material Library
  // ════════════════════════════════════════════════════════

  parentRouter.get('/personnel/training-materials', authenticateToken, (req: Request, res: Response) => {
    try {
      const db = getDb();
      const { category, search } = req.query;
      let sql = `
        SELECT tm.*, u.full_name as uploaded_by_name
        FROM training_materials tm
        LEFT JOIN users u ON tm.uploaded_by = u.id
        WHERE 1=1
      `;
      const params: any[] = [];
      if (category) { sql += ' AND tm.category = ?'; params.push(category); }
      if (search) { sql += ' AND (tm.title LIKE ? OR tm.description LIKE ?)'; const s = `%${search}%`; params.push(s, s); }
      sql += ' ORDER BY tm.created_at DESC';

      // Try the table — if it doesn't exist, return empty
      try {
        const rows = db.prepare(sql).all(...params);
        res.json({ data: rows });
      } catch {
        // Table doesn't exist yet — create it
        db.exec(`CREATE TABLE IF NOT EXISTS training_materials (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          description TEXT,
          category TEXT DEFAULT 'other',
          file_url TEXT,
          file_type TEXT,
          file_size INTEGER DEFAULT 0,
          course_name TEXT,
          uploaded_by INTEGER,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        )`);
        res.json({ data: [] });
      }
    } catch (error: any) {
      console.error('Training materials error:', error);
      res.status(500).json({ error: 'Failed to training materials', code: 'TRAINING_MATERIALS_ERROR' });
    }
  });

  parentRouter.post('/personnel/training-materials', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const { title, description, category, file_url, file_type, file_size, course_name } = req.body;
      if (!title) { res.status(400).json({ error: 'Title is required', code: 'TITLE_IS_REQUIRED' }); return; }

      db.exec(`CREATE TABLE IF NOT EXISTS training_materials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT,
        category TEXT DEFAULT 'other',
        file_url TEXT,
        file_type TEXT,
        file_size INTEGER DEFAULT 0,
        course_name TEXT,
        uploaded_by INTEGER,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )`);

      const now = localNow();
      const result = db.prepare(`
        INSERT INTO training_materials (title, description, category, file_url, file_type, file_size, course_name, uploaded_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(title, description || null, category || 'other', file_url || null, file_type || null, file_size || 0, course_name || null, req.user!.userId, now, now);

      const material = db.prepare('SELECT * FROM training_materials WHERE id = ?').get(result.lastInsertRowid);
      res.status(201).json(material);
    } catch (error: any) {
      console.error('Create training material error:', error);
      res.status(500).json({ error: 'Failed to create training material', code: 'CREATE_TRAINING_MATERIAL_ERROR' });
    }
  });

  parentRouter.delete('/personnel/training-materials/:id', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      db.prepare('DELETE FROM training_materials WHERE id = ?').run(req.params.id);
      res.json({ success: true });
    } catch (error: any) { res.status(500).json({ error: 'Server error in personnel', code: 'PERSONNEL_ERROR' }); }
  });

  // ════════════════════════════════════════════════════════
  // FEATURE 19: Training Quiz/Assessment
  // ════════════════════════════════════════════════════════

  parentRouter.post('/personnel/training/:id/assessment', authenticateToken, (req: Request, res: Response) => {
    try {
      const db = getDb();
      const { score, total_questions, passed, answers } = req.body;

      const record = db.prepare('SELECT * FROM training_records WHERE id = ?').get(req.params.id) as any;
      if (!record) { res.status(404).json({ error: 'Training record not found', code: 'TRAINING_RECORD_NOT_FOUND' }); return; }

      const assessments = JSON.parse(record.assessments || '[]');
      const now = localNow();
      assessments.push({
        officer_id: req.user!.userId,
        score: score || 0,
        total_questions: total_questions || 0,
        percentage: total_questions > 0 ? Math.round((score / total_questions) * 100) : 0,
        passed: !!passed,
        answers: answers || [],
        taken_at: now,
      });

      // Update record status if passed
      const updates: string[] = ['assessments = ?', 'updated_at = ?'];
      const params: any[] = [JSON.stringify(assessments), now];
      if (passed && record.status !== 'completed') {
        updates.push("status = 'completed'");
        updates.push('score = ?');
        params.push(score);
      }
      params.push(req.params.id);

      db.prepare(`UPDATE training_records SET ${updates.join(', ')} WHERE id = ?`).run(...params);

      res.json({ data: assessments[assessments.length - 1] });
    } catch (error: any) {
      console.error('Training assessment error:', error);
      res.status(500).json({ error: 'Failed to training assessment', code: 'TRAINING_ASSESSMENT_ERROR' });
    }
  });

  parentRouter.get('/personnel/training/:id/assessments', authenticateToken, (req: Request, res: Response) => {
    try {
      const db = getDb();
      const record = db.prepare('SELECT assessments FROM training_records WHERE id = ?').get(req.params.id) as any;
      if (!record) { res.status(404).json({ error: 'Training record not found', code: 'TRAINING_RECORD_NOT_FOUND' }); return; }
      res.json({ data: JSON.parse(record.assessments || '[]') });
    } catch (error: any) { res.status(500).json({ error: 'Server error in personnel', code: 'PERSONNEL_ERROR' }); }
  });

  // ════════════════════════════════════════════════════════
  // FEATURE 20: Mandatory Training Alerts
  // Alert when officer is overdue on required annual training
  // ════════════════════════════════════════════════════════

  parentRouter.get('/personnel/training-alerts', authenticateToken, (req: Request, res: Response) => {
    try {
      const db = getDb();
      const today = localNow().slice(0, 10);

      const requirements = db.prepare(
        'SELECT * FROM training_requirements WHERE is_mandatory = 1'
      ).all() as any[];

      const officers = db.prepare(
        "SELECT id, full_name, badge_number, role FROM users WHERE status = 'active' AND role IN ('admin','manager','supervisor','officer','dispatcher')"
      ).all() as any[];

      const alerts: any[] = [];

      for (const officer of officers) {
        for (const req of requirements) {
          const roles = JSON.parse(req.required_for_roles || '[]');
          if (roles.length > 0 && !roles.includes(officer.role)) continue;

          // Find most recent completed record for this course
          const latest = db.prepare(`
            SELECT * FROM training_records
            WHERE officer_id = ? AND course_name = ? AND status = 'completed'
            ORDER BY completed_date DESC LIMIT 1
          `).get(officer.id, req.course_name) as any;

          let alertType: string | null = null;
          let daysOverdue = 0;

          if (!latest) {
            alertType = 'never_completed';
          } else if (latest.expiry_date && latest.expiry_date < today) {
            alertType = 'expired';
            daysOverdue = Math.round((new Date(today).getTime() - new Date(latest.expiry_date).getTime()) / (1000 * 60 * 60 * 24));
          } else if (latest.expiry_date) {
            const daysUntilExpiry = Math.round((new Date(latest.expiry_date).getTime() - new Date(today).getTime()) / (1000 * 60 * 60 * 24));
            if (daysUntilExpiry <= 30) {
              alertType = 'expiring_soon';
              daysOverdue = -daysUntilExpiry; // negative = days until expiry
            }
          }

          if (alertType) {
            alerts.push({
              officer_id: officer.id,
              officer_name: officer.full_name,
              badge_number: officer.badge_number,
              role: officer.role,
              course_name: req.course_name,
              category: req.category,
              alert_type: alertType,
              days_overdue: daysOverdue,
              last_completed: latest?.completed_date || null,
              expiry_date: latest?.expiry_date || null,
              frequency_months: req.frequency_months,
            });
          }
        }
      }

      // Sort: expired first, then expiring soon, then never completed
      alerts.sort((a, b) => {
        const order: Record<string, number> = { expired: 0, expiring_soon: 1, never_completed: 2 };
        return (order[a.alert_type] || 3) - (order[b.alert_type] || 3) || b.days_overdue - a.days_overdue;
      });

      const expired = alerts.filter(a => a.alert_type === 'expired');
      const expiringSoon = alerts.filter(a => a.alert_type === 'expiring_soon');
      const neverCompleted = alerts.filter(a => a.alert_type === 'never_completed');

      res.json({
        total_alerts: alerts.length,
        expired: expired.length,
        expiring_soon: expiringSoon.length,
        never_completed: neverCompleted.length,
        alerts,
      });
    } catch (error: any) {
      console.error('Training alerts error:', error);
      res.status(500).json({ error: 'Failed to training alerts', code: 'TRAINING_ALERTS_ERROR' });
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
      
        LIMIT 1000
      `).all(...params);

      res.json(deployments);
    } catch (error: any) {
      console.error('Get deployments error:', error);
      res.status(500).json({ error: 'Failed to get deployments', code: 'GET_DEPLOYMENTS_ERROR' });
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
      
        LIMIT 1000
      `).all(req.params.officerId);
      res.json(deployments);
    } catch (error: any) {
      console.error('Get officer deployments error:', error);
      res.status(500).json({ error: 'Failed to get officer deployments', code: 'GET_OFFICER_DEPLOYMENTS_ERROR' });
    }
  });

  // POST /api/personnel/deployments - Create deployment
  parentRouter.post('/personnel/deployments', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const { officer_id, property_id, position, start_date, end_date, status, hours_per_week, notes } = req.body;

      if (!officer_id || !property_id || !start_date) {
        res.status(400).json({ error: 'officer_id, property_id, and start_date are required', code: 'OFFICERID_PROPERTYID_AND_STARTDATE' });
        return;
      }

      const result = db.prepare(`
        INSERT INTO deployments (officer_id, property_id, position, start_date, end_date, status, hours_per_week, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        officer_id, property_id, position || 'Patrol', start_date,
        end_date || null, status || 'active', hours_per_week || null, notes || null,
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
      res.status(500).json({ error: 'Failed to create deployment', code: 'CREATE_DEPLOYMENT_ERROR' });
    }
  });

  // PUT /api/personnel/deployments/:id - Update deployment
  parentRouter.put('/personnel/deployments/:id', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const existing = db.prepare('SELECT * FROM deployments WHERE id = ?').get(req.params.id) as any;
      if (!existing) {
        res.status(404).json({ error: 'Deployment not found', code: 'DEPLOYMENT_NOT_FOUND' });
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
      res.status(500).json({ error: 'Failed to update deployment', code: 'UPDATE_DEPLOYMENT_ERROR' });
    }
  });

  // DELETE /api/personnel/deployments/:id - Delete deployment
  parentRouter.delete('/personnel/deployments/:id', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const existing = db.prepare('SELECT * FROM deployments WHERE id = ?').get(req.params.id) as any;
      if (!existing) {
        res.status(404).json({ error: 'Deployment not found', code: 'DEPLOYMENT_NOT_FOUND' });
        return;
      }

      db.prepare('DELETE FROM deployments WHERE id = ?').run(req.params.id);
      res.json({ message: 'Deployment deleted' });
    } catch (error: any) {
      console.error('Delete deployment error:', error);
      res.status(500).json({ error: 'Failed to delete deployment', code: 'DELETE_DEPLOYMENT_ERROR' });
    }
  });

  // POST /api/personnel/deployments/:id/archive
  parentRouter.post('/personnel/deployments/:id/archive', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const dep = db.prepare('SELECT * FROM deployments WHERE id = ?').get(req.params.id) as any;
      if (!dep) { res.status(404).json({ error: 'Deployment not found', code: 'DEPLOYMENT_NOT_FOUND' }); return; }
      if (dep.archived_at) { res.status(400).json({ error: 'Already archived', code: 'ALREADY_ARCHIVED' }); return; }
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
      res.status(500).json({ error: 'Failed to archive deployment', code: 'ARCHIVE_DEPLOYMENT_ERROR' });
    }
  });

  // POST /api/personnel/deployments/:id/unarchive
  parentRouter.post('/personnel/deployments/:id/unarchive', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const dep = db.prepare('SELECT * FROM deployments WHERE id = ?').get(req.params.id) as any;
      if (!dep) { res.status(404).json({ error: 'Deployment not found', code: 'DEPLOYMENT_NOT_FOUND' }); return; }
      if (!dep.archived_at) { res.status(400).json({ error: 'Not archived', code: 'NOT_ARCHIVED' }); return; }
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
      res.status(500).json({ error: 'Failed to unarchive deployment', code: 'UNARCHIVE_DEPLOYMENT_ERROR' });
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
      
        LIMIT 1000
      `).all(...params);

      res.json(equipment);
    } catch (error: any) {
      console.error('Get equipment error:', error);
      res.status(500).json({ error: 'Failed to get equipment', code: 'GET_EQUIPMENT_ERROR' });
    }
  });

  // GET /api/personnel/:id/equipment - Get equipment for a specific officer
  parentRouter.get('/personnel/:id/equipment', authenticateToken, (req: Request, res: Response) => {
    try {
      const db = getDb();
      const equipment = db.prepare(`
        SELECT * FROM officer_equipment WHERE officer_id = ? ORDER BY status, equipment_type
      
        LIMIT 1000
      `).all(req.params.id);

      res.json(equipment);
    } catch (error: any) {
      console.error('Get officer equipment error:', error);
      res.status(500).json({ error: 'Failed to get officer equipment', code: 'GET_OFFICER_EQUIPMENT_ERROR' });
    }
  });

  // POST /api/personnel/:id/equipment - Create equipment record
  parentRouter.post('/personnel/:id/equipment', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const officer_id = req.params.id;
      const { equipment_type, make, model, serial_number, asset_tag, condition, status, issued_date, returned_date, notes } = req.body;

      if (!equipment_type) {
        res.status(400).json({ error: 'equipment_type is required', code: 'EQUIPMENTTYPE_IS_REQUIRED' });
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
      res.status(500).json({ error: 'Failed to create equipment', code: 'CREATE_EQUIPMENT_ERROR' });
    }
  });

  // PUT /api/personnel/equipment/:equipId - Update equipment record
  parentRouter.put('/personnel/equipment/:equipId', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const existing = db.prepare('SELECT * FROM officer_equipment WHERE id = ?').get(req.params.equipId) as any;
      if (!existing) {
        res.status(404).json({ error: 'Equipment record not found', code: 'EQUIPMENT_RECORD_NOT_FOUND' });
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
      res.status(500).json({ error: 'Failed to update equipment', code: 'UPDATE_EQUIPMENT_ERROR' });
    }
  });

  // DELETE /api/personnel/equipment/:equipId - Delete equipment record
  parentRouter.delete('/personnel/equipment/:equipId', authenticateToken, requireRole('admin', 'manager'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const existing = db.prepare('SELECT * FROM officer_equipment WHERE id = ?').get(req.params.equipId) as any;
      if (!existing) {
        res.status(404).json({ error: 'Equipment record not found', code: 'EQUIPMENT_RECORD_NOT_FOUND' });
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
      res.status(500).json({ error: 'Failed to delete equipment', code: 'DELETE_EQUIPMENT_ERROR' });
    }
  });

  // ─── EQUIPMENT CHECKOUT LOG ────────────────────────────

  // Ensure table exists
  try {
    const db = getDb();
    db.exec(`
      CREATE TABLE IF NOT EXISTS equipment_checkout_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        equipment_id INTEGER NOT NULL,
        officer_id INTEGER NOT NULL,
        action TEXT NOT NULL,
        checked_by INTEGER,
        checked_by_name TEXT,
        notes TEXT,
        created_at TEXT NOT NULL
      )
    `);
  } catch { /* table may already exist */ }

  // POST /api/personnel/equipment/:equipId/checkout — Check out equipment
  parentRouter.post('/personnel/equipment/:equipId/checkout', authenticateToken, (req: Request, res: Response) => {
    try {
      const db = getDb();
      const eq = db.prepare('SELECT * FROM officer_equipment WHERE id = ?').get(req.params.equipId) as any;
      if (!eq) { res.status(404).json({ error: 'Equipment not found', code: 'EQUIPMENT_NOT_FOUND' }); return; }
      const now = localNow();
      const userName = (db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.user!.userId) as any)?.full_name || '';

      db.prepare("UPDATE officer_equipment SET status = 'issued', updated_at = ? WHERE id = ?").run(now, req.params.equipId);
      db.prepare(`
        INSERT INTO equipment_checkout_log (equipment_id, officer_id, action, checked_by, checked_by_name, notes, created_at)
        VALUES (?, ?, 'checkout', ?, ?, ?, ?)
      `).run(req.params.equipId, eq.officer_id, req.user!.userId, userName, req.body.notes || null, now);

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: 'Checkout failed', code: 'CHECKOUT_FAILED' });
    }
  });

  // POST /api/personnel/equipment/:equipId/checkin — Check in equipment
  parentRouter.post('/personnel/equipment/:equipId/checkin', authenticateToken, (req: Request, res: Response) => {
    try {
      const db = getDb();
      const eq = db.prepare('SELECT * FROM officer_equipment WHERE id = ?').get(req.params.equipId) as any;
      if (!eq) { res.status(404).json({ error: 'Equipment not found', code: 'EQUIPMENT_NOT_FOUND' }); return; }
      const now = localNow();
      const userName = (db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.user!.userId) as any)?.full_name || '';

      db.prepare("UPDATE officer_equipment SET status = 'available', updated_at = ? WHERE id = ?").run(now, req.params.equipId);
      db.prepare(`
        INSERT INTO equipment_checkout_log (equipment_id, officer_id, action, checked_by, checked_by_name, notes, created_at)
        VALUES (?, ?, 'checkin', ?, ?, ?, ?)
      `).run(req.params.equipId, eq.officer_id, req.user!.userId, userName, req.body.notes || null, now);

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: 'Checkin failed', code: 'CHECKIN_FAILED' });
    }
  });

  // GET /api/personnel/equipment/:equipId/checkout-log — Get checkout history
  parentRouter.get('/personnel/equipment/:equipId/checkout-log', authenticateToken, (req: Request, res: Response) => {
    try {
      const db = getDb();
      const logs = db.prepare(`
        SELECT * FROM equipment_checkout_log WHERE equipment_id = ? ORDER BY created_at DESC LIMIT 20
      `).all(req.params.equipId);
      res.json(logs);
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to fetch checkout log', code: 'FAILED_TO_FETCH_CHECKOUT' });
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
      
        LIMIT 1000
      `).all(...params);

      res.json(cameras);
    } catch (error: any) {
      console.error('Get body cameras error:', error);
      res.status(500).json({ error: 'Failed to get body cameras', code: 'GET_BODY_CAMERAS_ERROR' });
    }
  });

  // GET /api/personnel/body-cameras/export — CSV export
  parentRouter.get('/personnel/body-cameras/export', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const rows = db.prepare(`
        SELECT c.camera_id, c.make, c.model, c.firmware_version, c.storage_capacity_gb,
               c.status, c.condition, c.assigned_at, c.notes, u.full_name as officer_name, c.created_at
        FROM body_cameras c
        LEFT JOIN users u ON c.officer_id = u.id
        ORDER BY c.status, c.camera_id
        LIMIT 10000
      `).all() as any[];
      const headers = ['Camera ID', 'Make', 'Model', 'Firmware', 'Storage (GB)', 'Status', 'Condition', 'Assigned At', 'Notes', 'Officer', 'Created'];
      const csvRows = rows.map((r: any) => [
        r.camera_id, r.make, r.model, r.firmware_version, r.storage_capacity_gb,
        r.status, r.condition, r.assigned_at, (r.notes || '').replace(/"/g, '""'), r.officer_name, r.created_at,
      ]);
      const csv = [headers.join(','), ...csvRows.map((r: any[]) => r.map(v => `"${v || ''}"`).join(','))].join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="body_cameras_${new Date().toISOString().slice(0, 10)}.csv"`);
      res.send(csv);
    } catch (err: any) {
      console.error('Body cameras export error:', err?.message);
      res.status(500).json({ error: 'Failed to export', code: 'EXPORT_BODY_CAMERAS_ERROR' });
    }
  });

  // GET /api/personnel/bodycam-videos/export — CSV export
  parentRouter.get('/personnel/bodycam-videos/export', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const rows = db.prepare(`
        SELECT v.id, v.title, v.camera_id, v.officer_id, v.incident_id, v.duration_seconds,
               v.file_size_bytes, v.recorded_at, v.status, u.full_name as officer_name, v.created_at
        FROM bodycam_videos v
        LEFT JOIN users u ON v.officer_id = u.id
        ORDER BY v.recorded_at DESC
        LIMIT 10000
      `).all() as any[];
      const headers = ['ID', 'Title', 'Camera ID', 'Officer ID', 'Incident ID', 'Duration (s)', 'Size (bytes)', 'Recorded At', 'Status', 'Officer', 'Created'];
      const csvRows = rows.map((r: any) => [
        r.id, (r.title || '').replace(/"/g, '""'), r.camera_id, r.officer_id, r.incident_id,
        r.duration_seconds, r.file_size_bytes, r.recorded_at, r.status, r.officer_name, r.created_at,
      ]);
      const csv = [headers.join(','), ...csvRows.map((r: any[]) => r.map(v => `"${v || ''}"`).join(','))].join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="bodycam_videos_${new Date().toISOString().slice(0, 10)}.csv"`);
      res.send(csv);
    } catch (err: any) {
      console.error('Bodycam videos export error:', err?.message);
      res.status(500).json({ error: 'Failed to export', code: 'EXPORT_BODYCAM_VIDEOS_ERROR' });
    }
  });

  // GET /api/personnel/:id/body-cameras - Get cameras for specific officer
  parentRouter.get('/personnel/:id/body-cameras', authenticateToken, (req: Request, res: Response) => {
    try {
      const db = getDb();
      const cameras = db.prepare(`
        SELECT * FROM body_cameras WHERE officer_id = ? ORDER BY status, camera_id
      
        LIMIT 1000
      `).all(req.params.id);
      res.json(cameras);
    } catch (error: any) {
      console.error('Get officer body cameras error:', error);
      res.status(500).json({ error: 'Failed to get officer body cameras', code: 'GET_OFFICER_BODY_CAMERAS' });
    }
  });

  // POST /api/personnel/body-cameras - Create body camera
  parentRouter.post('/personnel/body-cameras', authenticateToken, requireRole('admin'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const { officer_id, camera_id, make, model, firmware_version, storage_capacity_gb, status, condition, assigned_at, notes } = req.body;

      if (!camera_id) {
        res.status(400).json({ error: 'camera_id (serial number) is required', code: 'CAMERAID_SERIAL_NUMBER_IS' });
        return;
      }
      if (!officer_id) {
        res.status(400).json({ error: 'officer_id is required', code: 'OFFICERID_IS_REQUIRED' });
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
        res.status(409).json({ error: 'A camera with that serial number already exists', code: 'A_CAMERA_WITH_THAT' });
        return;
      }
      console.error('Create body camera error:', error);
      res.status(500).json({ error: 'Failed to create body camera', code: 'CREATE_BODY_CAMERA_ERROR' });
    }
  });

  // PUT /api/personnel/body-cameras/:cameraId - Update body camera
  parentRouter.put('/personnel/body-cameras/:cameraId', authenticateToken, requireRole('admin'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const existing = db.prepare('SELECT * FROM body_cameras WHERE id = ?').get(req.params.cameraId) as any;
      if (!existing) {
        res.status(404).json({ error: 'Body camera not found', code: 'BODY_CAMERA_NOT_FOUND' });
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
      res.status(500).json({ error: 'Failed to update body camera', code: 'UPDATE_BODY_CAMERA_ERROR' });
    }
  });

  // DELETE /api/personnel/body-cameras/:cameraId - Delete body camera
  parentRouter.delete('/personnel/body-cameras/:cameraId', authenticateToken, requireRole('admin'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const existing = db.prepare('SELECT * FROM body_cameras WHERE id = ?').get(req.params.cameraId) as any;
      if (!existing) {
        res.status(404).json({ error: 'Body camera not found', code: 'BODY_CAMERA_NOT_FOUND' });
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
      res.status(500).json({ error: 'Failed to delete body camera', code: 'DELETE_BODY_CAMERA_ERROR' });
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
      
        LIMIT 1000
      `).all(...params);

      res.json(videos);
    } catch (error: any) {
      console.error('Get bodycam videos error:', error);
      res.status(500).json({ error: 'Failed to get bodycam videos', code: 'GET_BODYCAM_VIDEOS_ERROR' });
    }
  });

  // ─── BULK OPERATIONS (must be BEFORE /:videoId param routes) ────

  // DELETE /api/personnel/bodycam-videos/bulk - Bulk delete videos
  parentRouter.delete('/personnel/bodycam-videos/bulk', authenticateToken, requireRole('admin'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const { videoIds } = req.body;
      if (!Array.isArray(videoIds) || videoIds.length === 0) {
        res.status(400).json({ error: 'videoIds array required', code: 'VIDEOIDS_ARRAY_REQUIRED' });
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
      res.status(500).json({ error: 'Failed to bulk delete bodycam videos', code: 'BULK_DELETE_BODYCAM_VIDEOS' });
    }
  });

  // PUT /api/personnel/bodycam-videos/bulk - Bulk update video metadata
  parentRouter.put('/personnel/bodycam-videos/bulk', authenticateToken, requireRole('admin'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const { videoIds, classification, retention_status } = req.body;
      if (!Array.isArray(videoIds) || videoIds.length === 0) {
        res.status(400).json({ error: 'videoIds array required', code: 'VIDEOIDS_ARRAY_REQUIRED' });
        return;
      }

      const setClauses: string[] = [];
      const vals: any[] = [];
      if (classification) { setClauses.push('classification = ?'); vals.push(classification); }
      if (retention_status) { setClauses.push('retention_status = ?'); vals.push(retention_status); }
      if (setClauses.length === 0) {
        res.status(400).json({ error: 'At least one field to update is required (classification, retention_status)', code: 'AT_LEAST_ONE_FIELD' });
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
      res.status(500).json({ error: 'Failed to bulk update bodycam videos', code: 'BULK_UPDATE_BODYCAM_VIDEOS' });
    }
  });

  // DELETE /api/personnel/body-cameras/bulk - Bulk delete cameras + associated videos
  parentRouter.delete('/personnel/body-cameras/bulk', authenticateToken, requireRole('admin'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const { cameraIds } = req.body;
      if (!Array.isArray(cameraIds) || cameraIds.length === 0) {
        res.status(400).json({ error: 'cameraIds array required', code: 'CAMERAIDS_ARRAY_REQUIRED' });
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
      res.status(500).json({ error: 'Failed to bulk delete body cameras', code: 'BULK_DELETE_BODY_CAMERAS' });
    }
  });

  // ════════════════════════════════════════════════════════════
  // BODY CAMERA UPGRADE 1: Video Retention Policy Enforcement
  // Returns videos that are past their retention period.
  // ════════════════════════════════════════════════════════════
  parentRouter.get('/personnel/bodycam-videos/retention/report', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (_req: Request, res: Response) => {
    try {
      const db = getDb();
      // Default retention: evidence=7 years, incident=3 years, routine=90 days, training=1 year
      const retentionDays: Record<string, number> = { evidence: 2555, incident: 1095, routine: 90, training: 365 };

      const report: any[] = [];
      for (const [classification, days] of Object.entries(retentionDays)) {
        const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
        const expired = db.prepare(`
          SELECT id, title, classification, file_size, created_at, officer_id,
            CAST(julianday('now') - julianday(created_at) AS INTEGER) as age_days
          FROM bodycam_videos
          WHERE classification = ? AND created_at < ?
          ORDER BY created_at ASC LIMIT 50
        `).all(classification, cutoff) as any[];
        if (expired.length > 0) {
          report.push({
            classification,
            retention_days: days,
            expired_count: expired.length,
            total_bytes: expired.reduce((s: number, v: any) => s + (v.file_size || 0), 0),
            videos: expired,
          });
        }
      }

      const totalExpired = report.reduce((s, r) => s + r.expired_count, 0);
      const totalBytes = report.reduce((s, r) => s + r.total_bytes, 0);

      res.json({
        retention_policies: retentionDays,
        expired_groups: report,
        total_expired: totalExpired,
        total_storage_gb: Math.round(totalBytes / 1024 / 1024 / 1024 * 100) / 100,
      });
    } catch (error: any) {
      console.error('Retention report error:', error);
      res.status(500).json({ error: 'Failed to get retention report', code: 'RETENTION_REPORT_ERROR' });
    }
  });

  // ════════════════════════════════════════════════════════════
  // BODY CAMERA UPGRADE 2: Auto-Tag Videos by Incident/Call
  // Finds untagged videos and suggests matching incidents/calls.
  // ════════════════════════════════════════════════════════════
  parentRouter.get('/personnel/bodycam-videos/auto-tag/suggestions', authenticateToken, (_req: Request, res: Response) => {
    try {
      const db = getDb();
      // Find videos without case numbers that have timestamps
      const untagged = db.prepare(`
        SELECT id, title, officer_id, created_at, duration_seconds
        FROM bodycam_videos
        WHERE (case_number IS NULL OR case_number = '') AND created_at IS NOT NULL
        ORDER BY created_at DESC LIMIT 20
      `).all() as any[];

      const suggestions: any[] = [];
      for (const video of untagged) {
        // Find incidents by the same officer around the same time
        const nearby = db.prepare(`
          SELECT id, incident_number, incident_type, created_at
          FROM incidents
          WHERE officer_id = ?
            AND ABS(CAST((julianday(created_at) - julianday(?)) * 24 * 60 AS INTEGER)) <= 60
          ORDER BY ABS(julianday(created_at) - julianday(?))
          LIMIT 3
        `).all(video.officer_id, video.created_at, video.created_at) as any[];

        if (nearby.length > 0) {
          suggestions.push({
            video_id: video.id,
            video_title: video.title,
            video_time: video.created_at,
            suggested_incidents: nearby,
          });
        }
      }

      res.json({ suggestions, total_untagged: untagged.length });
    } catch (error: any) {
      console.error('Auto-tag suggestions error:', error);
      res.status(500).json({ error: 'Failed to get tag suggestions', code: 'AUTOTAG_SUGGESTIONS_ERROR' });
    }
  });

  // ════════════════════════════════════════════════════════════
  // BODY CAMERA UPGRADE 3: Video Review Assignment Workflow
  // Assigns videos for review and tracks review status.
  // ════════════════════════════════════════════════════════════
  parentRouter.post('/personnel/bodycam-videos/:videoId/assign-review', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const videoId = parseInt(req.params.videoId as string, 10);
      if (isNaN(videoId)) { res.status(400).json({ error: 'Invalid video ID' }); return; }

      const { reviewer_id, priority, notes } = req.body;
      if (!reviewer_id) { res.status(400).json({ error: 'reviewer_id required' }); return; }

      const now = localNow();

      // Ensure review assignment table exists
      try {
        db.prepare(`CREATE TABLE IF NOT EXISTS bodycam_review_assignments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          video_id INTEGER NOT NULL, reviewer_id INTEGER NOT NULL,
          assigned_by INTEGER NOT NULL, priority TEXT DEFAULT 'normal',
          status TEXT DEFAULT 'pending', notes TEXT,
          review_notes TEXT, reviewed_at TEXT,
          created_at TEXT, updated_at TEXT
        )`);
      } catch { /* already exists */ }

      const result = db.prepare(`
        INSERT INTO bodycam_review_assignments (video_id, reviewer_id, assigned_by, priority, notes, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
      `).run(videoId, reviewer_id, req.user!.userId, priority || 'normal', notes || null, now, now);

      res.status(201).json({ id: result.lastInsertRowid, status: 'pending' });
    } catch (error: any) {
      console.error('Assign review error:', error);
      res.status(500).json({ error: 'Failed to assign review', code: 'ASSIGN_REVIEW_ERROR' });
    }
  });

  parentRouter.get('/personnel/bodycam-videos/reviews/pending', authenticateToken, (req: Request, res: Response) => {
    try {
      const db = getDb();
      let rows: any[] = [];
      try {
        rows = db.prepare(`
          SELECT ra.*, v.title as video_title, v.classification,
            reviewer.full_name as reviewer_name, assigner.full_name as assigned_by_name
          FROM bodycam_review_assignments ra
          LEFT JOIN bodycam_videos v ON ra.video_id = v.id
          LEFT JOIN users reviewer ON ra.reviewer_id = reviewer.id
          LEFT JOIN users assigner ON ra.assigned_by = assigner.id
          WHERE ra.status = 'pending'
          ORDER BY CASE ra.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, ra.created_at ASC
          LIMIT 100
        `).all();
      } catch { /* table may not exist */ }
      res.json({ data: rows, count: rows.length });
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to get pending reviews', code: 'PENDING_REVIEWS_ERROR' });
    }
  });

  // ════════════════════════════════════════════════════════════
  // BODY CAMERA UPGRADE 4: Redaction Request Tracking
  // Track requests to redact portions of body camera footage.
  // ════════════════════════════════════════════════════════════
  parentRouter.post('/personnel/bodycam-videos/:videoId/redaction-request', authenticateToken, (req: Request, res: Response) => {
    try {
      const db = getDb();
      const videoId = parseInt(req.params.videoId as string, 10);
      if (isNaN(videoId)) { res.status(400).json({ error: 'Invalid video ID' }); return; }

      const { reason, start_time_seconds, end_time_seconds, redaction_type } = req.body;
      if (!reason) { res.status(400).json({ error: 'Reason required for redaction request' }); return; }

      const now = localNow();

      // Ensure redaction request table exists
      try {
        db.prepare(`CREATE TABLE IF NOT EXISTS bodycam_redaction_requests (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          video_id INTEGER NOT NULL, requested_by INTEGER NOT NULL,
          reason TEXT NOT NULL, redaction_type TEXT DEFAULT 'face_blur',
          start_time_seconds REAL, end_time_seconds REAL,
          status TEXT DEFAULT 'pending', approved_by INTEGER,
          approved_at TEXT, notes TEXT,
          created_at TEXT, updated_at TEXT
        )`);
      } catch { /* already exists */ }

      const result = db.prepare(`
        INSERT INTO bodycam_redaction_requests (video_id, requested_by, reason, redaction_type,
          start_time_seconds, end_time_seconds, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
      `).run(videoId, req.user!.userId, reason, redaction_type || 'face_blur',
        start_time_seconds || null, end_time_seconds || null, now, now);

      res.status(201).json({ id: result.lastInsertRowid, status: 'pending' });
    } catch (error: any) {
      console.error('Redaction request error:', error);
      res.status(500).json({ error: 'Failed to create redaction request', code: 'REDACTION_REQUEST_ERROR' });
    }
  });

  parentRouter.get('/personnel/bodycam-videos/redaction-requests', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (_req: Request, res: Response) => {
    try {
      const db = getDb();
      let rows: any[] = [];
      try {
        rows = db.prepare(`
          SELECT rr.*, v.title as video_title, u.full_name as requested_by_name,
            approver.full_name as approved_by_name
          FROM bodycam_redaction_requests rr
          LEFT JOIN bodycam_videos v ON rr.video_id = v.id
          LEFT JOIN users u ON rr.requested_by = u.id
          LEFT JOIN users approver ON rr.approved_by = approver.id
          ORDER BY CASE rr.status WHEN 'pending' THEN 0 ELSE 1 END, rr.created_at DESC
          LIMIT 100
        `).all();
      } catch { /* table may not exist */ }
      res.json({ data: rows, count: rows.length });
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to get redaction requests', code: 'GET_REDACTION_REQUESTS_ERROR' });
    }
  });

  parentRouter.put('/personnel/bodycam-videos/redaction-requests/:requestId/approve', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const reqId = parseInt(req.params.requestId as string, 10);
      if (isNaN(reqId)) { res.status(400).json({ error: 'Invalid request ID' }); return; }
      const now = localNow();
      const { status, notes } = req.body;
      const newStatus = status === 'rejected' ? 'rejected' : 'approved';
      try {
        db.prepare(`UPDATE bodycam_redaction_requests SET status = ?, approved_by = ?,
          approved_at = ?, notes = ?, updated_at = ? WHERE id = ?`)
          .run(newStatus, req.user!.userId, now, notes || null, now, reqId);
      } catch { /* ok */ }
      res.json({ success: true, status: newStatus });
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to process redaction request', code: 'PROCESS_REDACTION_ERROR' });
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
      
        LIMIT 1000
      `).all(req.params.id);
      res.json(videos);
    } catch (error: any) {
      console.error('Get officer bodycam videos error:', error);
      res.status(500).json({ error: 'Failed to get officer bodycam videos', code: 'GET_OFFICER_BODYCAM_VIDEOS' });
    }
  });

  // POST /api/personnel/bodycam-videos - Upload video
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
            res.status(400).json({ error: 'No video file provided', code: 'NO_VIDEO_FILE_PROVIDED' });
            return;
          }

          const { camera_id, officer_id, title, duration_seconds, recorded_at, case_number, classification, notes } = req.body;

          if (!camera_id || !officer_id || !title) {
            if (file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
            res.status(400).json({ error: 'camera_id, officer_id, and title are required', code: 'CAMERAID_OFFICERID_AND_TITLE' });
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
        res.status(404).json({ error: 'Video not found', code: 'VIDEO_NOT_FOUND' });
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
      res.status(500).json({ error: 'Failed to update bodycam video', code: 'UPDATE_BODYCAM_VIDEO_ERROR' });
    }
  });

  // DELETE /api/personnel/bodycam-videos/:videoId - Delete video + file
  parentRouter.delete('/personnel/bodycam-videos/:videoId', authenticateToken, requireRole('admin'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const existing = db.prepare('SELECT * FROM bodycam_videos WHERE id = ?').get(req.params.videoId) as any;
      if (!existing) {
        res.status(404).json({ error: 'Video not found', code: 'VIDEO_NOT_FOUND' });
        return;
      }

      // Delete file from disk
      const filePath = path.resolve(BODYCAM_DIR, existing.file_path);
      if (filePath.startsWith(BODYCAM_DIR) && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      db.prepare('DELETE FROM bodycam_videos WHERE id = ?').run(req.params.videoId);
      res.json({ message: 'Video deleted' });
    } catch (error: any) {
      console.error('Delete bodycam video error:', error);
      res.status(500).json({ error: 'Failed to delete bodycam video', code: 'DELETE_BODYCAM_VIDEO_ERROR' });
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
        res.status(404).json({ error: 'Video not found', code: 'VIDEO_NOT_FOUND' });
        return;
      }

      const filePath = path.resolve(BODYCAM_DIR, video.file_path);
      if (!filePath.startsWith(BODYCAM_DIR) || !fs.existsSync(filePath)) {
        res.status(404).json({ error: 'Video file not found on disk', code: 'VIDEO_FILE_NOT_FOUND' });
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
      console.error('Stream bodycam video error:', error);
      res.status(500).json({ error: 'Failed to stream bodycam video', code: 'STREAM_BODYCAM_VIDEO_ERROR' });
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
      res.status(500).json({ error: 'Failed to get coverage gaps', code: 'GET_COVERAGE_GAPS_ERROR' });
    }
  });

  // ─── ANALYTICS ───────────────────────────────────────

  // GET /api/personnel/analytics - Aggregate personnel analytics
  parentRouter.get('/personnel/analytics', authenticateToken, (req: Request, res: Response) => {
    try {
      const db = getDb();

      // Headcount summary
      const totalPersonnel = (db.prepare('SELECT COUNT(*) as count FROM users').get() as any).count;
      const activePersonnel = (db.prepare("SELECT COUNT(*) as count FROM users WHERE status = 'active'").get() as any).count;
      const onDuty = activePersonnel;
      const clockedIn = (db.prepare("SELECT COUNT(*) as count FROM time_entries WHERE status = 'active'").get() as any).count;

      // Avg tenure
      const tenureRows = db.prepare("SELECT hire_date FROM users WHERE hire_date IS NOT NULL AND status = 'active'").all() as any[];
      const now = Date.now();
      const avgTenure = tenureRows.length > 0
        ? tenureRows.reduce((sum: number, r: any) => sum + (now - new Date(r.hire_date).getTime()) / (365.25 * 24 * 60 * 60 * 1000), 0) / tenureRows.length
        : 0;

      // New hires / terminations in last 30 days
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const newHires = (db.prepare('SELECT COUNT(*) as count FROM users WHERE hire_date >= ?').get(thirtyDaysAgo) as any).count;
      const terminations = (db.prepare('SELECT COUNT(*) as count FROM users WHERE termination_date >= ?').get(thirtyDaysAgo) as any).count;

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
      const totalCreds = (db.prepare('SELECT COUNT(*) as count FROM credentials').get() as any).count;
      const validCreds = (db.prepare("SELECT COUNT(*) as count FROM credentials WHERE expiry_date IS NULL OR expiry_date >= date('now')").get() as any).count;
      const expiringSoon = (db.prepare("SELECT COUNT(*) as count FROM credentials WHERE expiry_date >= date('now') AND expiry_date <= date('now', '+90 days')").get() as any).count;
      const expiredCreds = (db.prepare("SELECT COUNT(*) as count FROM credentials WHERE expiry_date < date('now')").get() as any).count;

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
        officer: '#bc1010', dispatcher: '#3b82f6',
      };
      const roleDistribution = db.prepare(`
        SELECT role, COUNT(*) as count FROM users GROUP BY role ORDER BY count DESC
      `).all().map((r: any) => ({
        role: r.role,
        count: r.count,
        color: ROLE_COLORS[r.role] || '#6b7280',
      }));

      // Training compliance
      const totalTraining = (db.prepare('SELECT COUNT(*) as count FROM training_records').get() as any).count;
      const completedTraining = (db.prepare("SELECT COUNT(*) as count FROM training_records WHERE status = 'completed'").get() as any).count;
      const overdueTraining = (db.prepare("SELECT COUNT(*) as count FROM training_records WHERE status = 'overdue' OR (status = 'scheduled' AND expiry_date < date('now'))").get() as any).count;

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
      res.status(500).json({ error: 'Failed to get personnel analytics', code: 'GET_PERSONNEL_ANALYTICS_ERROR' });
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // UPGRADE BATCH — Training & Scheduling Enhancements
  // ═══════════════════════════════════════════════════════════════════

  // ── U17: Training Completion Percentages ────────────────────────────
  parentRouter.get('/personnel/training-completion', authenticateToken, (req: Request, res: Response) => {
    try {
      const db = getDb();
      const officers = db.prepare(`SELECT id, full_name, badge_number, role FROM users WHERE status = 'active' AND archived_at IS NULL ORDER BY full_name LIMIT 500`).all() as any[];

      let requirements: any[] = [];
      try { requirements = db.prepare('SELECT * FROM training_requirements WHERE is_mandatory = 1').all() as any[]; } catch { /* ok */ }

      const records = db.prepare(`SELECT officer_id, course_name, status, expiry_date FROM training_records ORDER BY completed_date DESC`).all() as any[];
      const recordsByOfficer: Record<number, any[]> = {};
      for (const r of records) {
        if (!recordsByOfficer[r.officer_id]) recordsByOfficer[r.officer_id] = [];
        recordsByOfficer[r.officer_id].push(r);
      }

      const completion = officers.map((o: any) => {
        const officerRecords = recordsByOfficer[o.id] || [];
        const completedCourses = new Set(officerRecords.filter((r: any) => r.status === 'completed').map((r: any) => r.course_name));
        const applicableReqs = requirements.filter((req: any) => {
          const roles = typeof req.required_for_roles === 'string' ? JSON.parse(req.required_for_roles) : (req.required_for_roles || []);
          return roles.length === 0 || roles.includes(o.role);
        });
        const completedReqs = applicableReqs.filter((req: any) => completedCourses.has(req.course_name));
        const overdueReqs = applicableReqs.filter((req: any) => !completedCourses.has(req.course_name));

        return {
          officer_id: o.id, full_name: o.full_name, badge_number: o.badge_number, role: o.role,
          total_required: applicableReqs.length, completed: completedReqs.length,
          overdue: overdueReqs.length,
          completion_pct: applicableReqs.length > 0 ? Math.round((completedReqs.length / applicableReqs.length) * 100) : 100,
          overdue_courses: overdueReqs.map((r: any) => r.course_name),
          total_training_records: officerRecords.length,
          total_hours: officerRecords.reduce((s: number, r: any) => s + (r.hours || 0), 0),
        };
      });

      const overallCompliance = completion.length > 0
        ? Math.round(completion.reduce((s, c) => s + c.completion_pct, 0) / completion.length)
        : 100;

      res.json({ officers: completion, overall_compliance_pct: overallCompliance, total_requirements: requirements.length });
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to load training completion', code: 'TRAINING_COMPLETION_ERROR' });
    }
  });

  // ── U18: Required vs Completed Training Matrix ──────────────────────
  parentRouter.get('/personnel/training-requirements-matrix', authenticateToken, (req: Request, res: Response) => {
    try {
      const db = getDb();
      let requirements: any[] = [];
      try {
        requirements = db.prepare('SELECT * FROM training_requirements ORDER BY course_name').all() as any[];
        requirements = requirements.map((r: any) => ({
          ...r, required_for_roles: typeof r.required_for_roles === 'string' ? JSON.parse(r.required_for_roles) : (r.required_for_roles || []),
          is_mandatory: !!r.is_mandatory,
        }));
      } catch { /* ok */ }

      const officers = db.prepare(`SELECT id, full_name, badge_number, role FROM users WHERE status = 'active' AND archived_at IS NULL ORDER BY full_name LIMIT 500`).all() as any[];
      const records = db.prepare(`SELECT officer_id, course_name, status, completed_date, expiry_date FROM training_records`).all() as any[];

      const recordMap: Record<string, any> = {};
      for (const r of records) {
        const key = `${r.officer_id}-${r.course_name}`;
        if (!recordMap[key] || (r.completed_date && (!recordMap[key].completed_date || r.completed_date > recordMap[key].completed_date))) {
          recordMap[key] = r;
        }
      }

      const matrix = officers.map((o: any) => {
        const courseStatuses: Record<string, { status: string; completed_date?: string; expiry_date?: string }> = {};
        for (const req of requirements) {
          const key = `${o.id}-${req.course_name}`;
          const record = recordMap[key];
          if (record) {
            courseStatuses[req.course_name] = { status: record.status, completed_date: record.completed_date, expiry_date: record.expiry_date };
          } else {
            const roles = req.required_for_roles || [];
            if (roles.length === 0 || roles.includes(o.role)) {
              courseStatuses[req.course_name] = { status: 'not_started' };
            }
          }
        }
        return { officer_id: o.id, full_name: o.full_name, badge_number: o.badge_number, role: o.role, courses: courseStatuses };
      });

      res.json({ matrix, requirements: requirements.map((r: any) => ({ id: r.id, course_name: r.course_name, category: r.category, is_mandatory: r.is_mandatory })) });
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to load training matrix', code: 'TRAINING_MATRIX_ERROR' });
    }
  });

  // ── U19: Training Certificate Generation Data ───────────────────────
  parentRouter.get('/personnel/training-certificate-data/:recordId', authenticateToken, (req: Request, res: Response) => {
    try {
      const db = getDb();
      const record = db.prepare(`
        SELECT t.*, u.full_name as officer_name, u.badge_number, u.rank
        FROM training_records t LEFT JOIN users u ON t.officer_id = u.id
        WHERE t.id = ?
      `).get(req.params.recordId) as any;
      if (!record) return res.status(404).json({ error: 'Training record not found', code: 'NOT_FOUND' });

      res.json({
        certificate: {
          officer_name: record.officer_name, badge_number: record.badge_number,
          rank: record.rank, course_name: record.course_name, category: record.category,
          provider: record.provider, completed_date: record.completed_date,
          expiry_date: record.expiry_date, hours: record.hours, score: record.score,
          certificate_number: record.certificate_number || `RMPG-${record.id}-${Date.now().toString(36).toUpperCase()}`,
          status: record.status, organization: 'Rocky Mountain Protective Group',
          issued_date: record.completed_date || localToday(),
        },
      });
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to load certificate data', code: 'CERTIFICATE_DATA_ERROR' });
    }
  });

  // ── U20: Bulk Training Assignment ───────────────────────────────────
  parentRouter.post('/personnel/training-bulk-assign', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const { officer_ids, course_name, category, provider, scheduled_date, hours, notes } = req.body;
      if (!Array.isArray(officer_ids) || officer_ids.length === 0 || !course_name) {
        return res.status(400).json({ error: 'officer_ids array and course_name required', code: 'MISSING_FIELDS' });
      }

      const now = localNow();
      const created: number[] = [];
      const insert = db.prepare(`INSERT INTO training_records (officer_id, course_name, category, provider, completed_date, hours, status, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, 'scheduled', ?, ?)`);

      const tx = db.transaction(() => {
        for (const officerId of officer_ids.slice(0, 100)) {
          const result = insert.run(officerId, course_name, category || 'other', provider || null, scheduled_date || null, hours || 0, notes || null, now);
          created.push(Number(result.lastInsertRowid));
        }
      });
      tx();

      res.status(201).json({ success: true, created_count: created.length, record_ids: created });
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to bulk assign training', code: 'BULK_ASSIGN_ERROR' });
    }
  });

  // ── U21: Schedule Conflict Detection ────────────────────────────────
  parentRouter.get('/personnel/schedule-conflicts', authenticateToken, (req: Request, res: Response) => {
    try {
      const db = getDb();
      const { start_date, end_date } = req.query;
      const startDate = start_date || localToday();
      const endDate = end_date || new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0];

      const schedules = db.prepare(`
        SELECT s.*, u.full_name as officer_name
        FROM schedules s LEFT JOIN users u ON s.officer_id = u.id
        WHERE s.shift_date BETWEEN ? AND ?
        ORDER BY s.officer_id, s.shift_date, s.start_time
        LIMIT 5000
      `).all(startDate, endDate) as any[];

      // Detect double-bookings
      const conflicts: any[] = [];
      const byOfficer: Record<number, any[]> = {};
      for (const s of schedules) {
        if (!byOfficer[s.officer_id]) byOfficer[s.officer_id] = [];
        byOfficer[s.officer_id].push(s);
      }

      for (const [officerId, shifts] of Object.entries(byOfficer)) {
        for (let i = 0; i < shifts.length; i++) {
          for (let j = i + 1; j < shifts.length; j++) {
            if (shifts[i].shift_date === shifts[j].shift_date) {
              const s1Start = shifts[i].start_time;
              const s1End = shifts[i].end_time;
              const s2Start = shifts[j].start_time;
              const s2End = shifts[j].end_time;
              if (s1Start < s2End && s2Start < s1End) {
                conflicts.push({
                  officer_id: Number(officerId), officer_name: shifts[i].officer_name,
                  date: shifts[i].shift_date,
                  shift_1: { id: shifts[i].id, start: s1Start, end: s1End, property: shifts[i].property_name },
                  shift_2: { id: shifts[j].id, start: s2Start, end: s2End, property: shifts[j].property_name },
                  type: 'double_booked',
                });
              }
            }
          }
        }
      }

      res.json({ conflicts, total: conflicts.length, period: { start: startDate, end: endDate } });
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to detect schedule conflicts', code: 'SCHEDULE_CONFLICTS_ERROR' });
    }
  });

  // ── U22: Shift Coverage Gap Alerts ──────────────────────────────────
  parentRouter.get('/personnel/coverage-gaps', authenticateToken, (req: Request, res: Response) => {
    try {
      const db = getDb();
      const { start_date, end_date, min_officers = '1' } = req.query;
      const startDate = start_date || localToday();
      const endDate = end_date || new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0];
      const minRequired = parseInt(min_officers as string, 10) || 1;

      const schedules = db.prepare(`
        SELECT shift_date, COUNT(DISTINCT officer_id) as officer_count
        FROM schedules WHERE shift_date BETWEEN ? AND ? AND status != 'cancelled'
        GROUP BY shift_date ORDER BY shift_date
      `).all(startDate, endDate) as any[];

      const coverageByDate: Record<string, number> = {};
      for (const s of schedules) coverageByDate[s.shift_date] = s.officer_count;

      const gaps: any[] = [];
      const start = new Date(startDate as string);
      const end = new Date(endDate as string);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split('T')[0];
        const count = coverageByDate[dateStr] || 0;
        if (count < minRequired) {
          gaps.push({ date: dateStr, officers_scheduled: count, minimum_required: minRequired, shortfall: minRequired - count });
        }
      }

      res.json({ gaps, total: gaps.length, period: { start: startDate, end: endDate }, minimum_officers: minRequired });
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to detect coverage gaps', code: 'COVERAGE_GAPS_ERROR' });
    }
  });

  // ── U23: Bulk Schedule Publishing ───────────────────────────────────
  parentRouter.post('/personnel/schedules/bulk-publish', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const { schedule_ids, start_date, end_date } = req.body;

      let updated = 0;
      if (Array.isArray(schedule_ids) && schedule_ids.length > 0) {
        const placeholders = schedule_ids.map(() => '?').join(',');
        const result = db.prepare(`UPDATE schedules SET status = 'published', updated_at = ? WHERE id IN (${placeholders}) AND status = 'draft'`).run(localNow(), ...schedule_ids);
        updated = result.changes;
      } else if (start_date && end_date) {
        const result = db.prepare(`UPDATE schedules SET status = 'published', updated_at = ? WHERE shift_date BETWEEN ? AND ? AND status = 'draft'`).run(localNow(), start_date, end_date);
        updated = result.changes;
      } else {
        return res.status(400).json({ error: 'Provide schedule_ids or start_date/end_date', code: 'MISSING_FIELDS' });
      }

      res.json({ success: true, updated_count: updated });
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to bulk publish schedules', code: 'BULK_PUBLISH_ERROR' });
    }
  });

  // ═══════════════════════════════════════════════════════════
  //  TRAINING RECORDS CRUD
  // ═══════════════════════════════════════════════════════════

  // GET /api/personnel/training — List all training records
  router.get('/training', requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const rows = db.prepare(`
        SELECT t.*, u.full_name as officer_name, u.badge_number
        FROM training_records t
        LEFT JOIN users u ON t.officer_id = u.id
        WHERE t.archived_at IS NULL
        ORDER BY t.completed_date DESC, t.created_at DESC
        LIMIT 2000
      `).all();
      res.json(rows);
    } catch (error: any) {
      console.error('Get training records error:', error?.message);
      res.status(500).json({ error: 'Failed to get training records', code: 'TRAINING_LIST_ERROR' });
    }
  });

  // POST /api/personnel/training — Create training record
  router.post('/training', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const { officer_id, course_name, category, provider, completed_date, expiry_date, score, hours, certificate_number, status, notes, training_type } = req.body;
      if (!course_name || !officer_id) { res.status(400).json({ error: 'course_name and officer_id required', code: 'MISSING_FIELDS' }); return; }
      const now = localNow();
      const result = db.prepare(`
        INSERT INTO training_records (officer_id, course_name, category, provider, completed_date, expiry_date, score, hours, certificate_number, status, notes, training_type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(officer_id, course_name, category || 'other', provider || null, completed_date || null, expiry_date || null, score || null, hours || 0, certificate_number || null, status || 'scheduled', notes || null, training_type || null, now, now);
      res.status(201).json({ success: true, id: result.lastInsertRowid });
    } catch (error: any) {
      console.error('Create training record error:', error?.message);
      res.status(500).json({ error: 'Failed to create training record', code: 'TRAINING_CREATE_ERROR' });
    }
  });

  // PUT /api/personnel/training/:id — Update training record
  router.put('/training/:id', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const id = parseInt(req.params.id as string, 10);
      if (isNaN(id) || id < 1) { res.status(400).json({ error: 'Invalid ID', code: 'INVALID_ID' }); return; }
      const { course_name, category, provider, completed_date, expiry_date, score, hours, certificate_number, status, notes, training_type, officer_id } = req.body;
      const now = localNow();
      db.prepare(`
        UPDATE training_records SET course_name = COALESCE(?, course_name), category = COALESCE(?, category), provider = ?, completed_date = ?, expiry_date = ?, score = ?, hours = COALESCE(?, hours), certificate_number = ?, status = COALESCE(?, status), notes = ?, training_type = ?, officer_id = COALESCE(?, officer_id), updated_at = ? WHERE id = ?
      `).run(course_name, category, provider ?? null, completed_date ?? null, expiry_date ?? null, score ?? null, hours, certificate_number ?? null, status, notes ?? null, training_type ?? null, officer_id, now, id);
      res.json({ success: true });
    } catch (error: any) {
      console.error('Update training record error:', error?.message);
      res.status(500).json({ error: 'Failed to update training record', code: 'TRAINING_UPDATE_ERROR' });
    }
  });

  // DELETE /api/personnel/training/:id — Soft-delete training record
  router.delete('/training/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const id = parseInt(req.params.id as string, 10);
      if (isNaN(id) || id < 1) { res.status(400).json({ error: 'Invalid ID', code: 'INVALID_ID' }); return; }
      db.prepare('UPDATE training_records SET archived_at = ? WHERE id = ?').run(localNow(), id);
      res.json({ success: true });
    } catch (error: any) {
      console.error('Delete training record error:', error?.message);
      res.status(500).json({ error: 'Failed to delete training record', code: 'TRAINING_DELETE_ERROR' });
    }
  });

  // GET /api/personnel/training-requirements — List requirements
  router.get('/training-requirements', requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const rows = db.prepare('SELECT * FROM training_requirements WHERE is_active = 1 ORDER BY course_name').all();
      res.json(rows);
    } catch (error: any) {
      console.error('Get training requirements error:', error?.message);
      res.status(500).json({ error: 'Failed to get training requirements', code: 'TRAINING_REQ_LIST_ERROR' });
    }
  });

  // POST /api/personnel/training-requirements — Create requirement
  router.post('/training-requirements', requireRole('admin', 'manager'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const { course_name, category, required_for_roles, renewal_period_months, minimum_hours, is_mandatory, description } = req.body;
      if (!course_name) { res.status(400).json({ error: 'course_name required', code: 'MISSING_FIELDS' }); return; }
      const result = db.prepare(`
        INSERT INTO training_requirements (course_name, category, required_for_roles, renewal_period_months, minimum_hours, is_mandatory, description, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(course_name, category || 'other', JSON.stringify(required_for_roles || ['officer']), renewal_period_months || 12, minimum_hours || 1, is_mandatory ?? 1, description || null);
      res.status(201).json({ success: true, id: result.lastInsertRowid });
    } catch (error: any) {
      console.error('Create training requirement error:', error?.message);
      res.status(500).json({ error: 'Failed to create training requirement', code: 'TRAINING_REQ_CREATE_ERROR' });
    }
  });

  // PUT /api/personnel/training-requirements/:id — Update requirement
  router.put('/training-requirements/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const id = parseInt(req.params.id as string, 10);
      if (isNaN(id) || id < 1) { res.status(400).json({ error: 'Invalid ID', code: 'INVALID_ID' }); return; }
      const { course_name, category, required_for_roles, renewal_period_months, minimum_hours, is_mandatory, description } = req.body;
      db.prepare(`
        UPDATE training_requirements SET course_name = COALESCE(?, course_name), category = COALESCE(?, category), required_for_roles = COALESCE(?, required_for_roles), renewal_period_months = COALESCE(?, renewal_period_months), minimum_hours = COALESCE(?, minimum_hours), is_mandatory = COALESCE(?, is_mandatory), description = ? WHERE id = ?
      `).run(course_name, category, required_for_roles ? JSON.stringify(required_for_roles) : null, renewal_period_months, minimum_hours, is_mandatory, description ?? null, id);
      res.json({ success: true });
    } catch (error: any) {
      console.error('Update training requirement error:', error?.message);
      res.status(500).json({ error: 'Failed to update training requirement', code: 'TRAINING_REQ_UPDATE_ERROR' });
    }
  });

  // DELETE /api/personnel/training-requirements/:id — Soft-delete requirement
  router.delete('/training-requirements/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const id = parseInt(req.params.id as string, 10);
      if (isNaN(id) || id < 1) { res.status(400).json({ error: 'Invalid ID', code: 'INVALID_ID' }); return; }
      db.prepare('UPDATE training_requirements SET is_active = 0 WHERE id = ?').run(id);
      res.json({ success: true });
    } catch (error: any) {
      console.error('Delete training requirement error:', error?.message);
      res.status(500).json({ error: 'Failed to delete training requirement', code: 'TRAINING_REQ_DELETE_ERROR' });
    }
  });

  // GET /api/personnel/training-completion — Completion stats per officer
  router.get('/training-completion', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const requirements = db.prepare('SELECT * FROM training_requirements WHERE is_active = 1').all() as any[];
      const officers = db.prepare("SELECT id, full_name, badge_number, role FROM users WHERE status = 'active'").all() as any[];
      const records = db.prepare('SELECT * FROM training_records WHERE archived_at IS NULL AND status = ?').all('completed') as any[];
      const completionMap: Record<number, { officer_name: string; badge_number: string; completed: number; required: number; percentage: number }> = {};
      for (const officer of officers) {
        const officerRecords = records.filter((r: any) => r.officer_id === officer.id);
        const requiredCourses = requirements.filter((req: any) => {
          try { const roles = JSON.parse(req.required_for_roles || '[]'); return roles.includes(officer.role); } catch { return false; }
        });
        completionMap[officer.id] = {
          officer_name: officer.full_name, badge_number: officer.badge_number,
          completed: requiredCourses.filter((rc: any) => officerRecords.some((r: any) => r.course_name === rc.course_name)).length,
          required: requiredCourses.length,
          percentage: requiredCourses.length > 0 ? Math.round((requiredCourses.filter((rc: any) => officerRecords.some((r: any) => r.course_name === rc.course_name)).length / requiredCourses.length) * 100) : 100,
        };
      }
      res.json(completionMap);
    } catch (error: any) {
      console.error('Get training completion error:', error?.message);
      res.status(500).json({ error: 'Failed to get training completion', code: 'TRAINING_COMPLETION_ERROR' });
    }
  });

  // POST /api/personnel/training-bulk-assign — Bulk assign training to multiple officers
  router.post('/training-bulk-assign', requireRole('admin', 'manager'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const { officer_ids, course_name, category, hours, due_date } = req.body;
      if (!Array.isArray(officer_ids) || !course_name) { res.status(400).json({ error: 'officer_ids and course_name required', code: 'MISSING_FIELDS' }); return; }
      const now = localNow();
      const insert = db.prepare(`INSERT INTO training_records (officer_id, course_name, category, hours, expiry_date, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'scheduled', ?, ?)`);
      const tx = db.transaction(() => {
        for (const oid of officer_ids) { insert.run(oid, course_name, category || 'other', hours || 0, due_date || null, now, now); }
      });
      tx();
      res.json({ success: true, assigned_count: officer_ids.length });
    } catch (error: any) {
      console.error('Bulk assign training error:', error?.message);
      res.status(500).json({ error: 'Failed to bulk assign training', code: 'TRAINING_BULK_ASSIGN_ERROR' });
    }
  });

  // GET /api/personnel/training-materials — List training materials/documents
  router.get('/training-materials', requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      // Check if training_materials table exists
      const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='training_materials'").get();
      if (!tableExists) { res.json({ data: [] }); return; }
      const rows = db.prepare('SELECT * FROM training_materials ORDER BY created_at DESC LIMIT 500').all();
      res.json({ data: rows });
    } catch (error: any) {
      console.error('Get training materials error:', error?.message);
      res.json({ data: [] }); // Graceful fallback
    }
  });

  // GET /api/personnel/training-alerts — Training expiration alerts
  router.get('/training-alerts', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
    try {
      const db = getDb();
      const today = localToday();
      // Find records expiring within 30 days or already expired
      const alerts = db.prepare(`
        SELECT t.*, u.full_name as officer_name, u.badge_number
        FROM training_records t
        LEFT JOIN users u ON t.officer_id = u.id
        WHERE t.archived_at IS NULL
          AND t.expiry_date IS NOT NULL
          AND t.expiry_date <= date(?, '+30 days')
        ORDER BY t.expiry_date ASC
        LIMIT 200
      `).all(today) as any[];
      const result = alerts.map((a: any) => ({
        ...a,
        is_expired: a.expiry_date < today,
        days_until_expiry: Math.ceil((new Date(a.expiry_date + 'T00:00:00').getTime() - new Date(today + 'T00:00:00').getTime()) / 86400000),
      }));
      res.json(result);
    } catch (error: any) {
      console.error('Get training alerts error:', error?.message);
      res.json([]); // Graceful fallback
    }
  });
}

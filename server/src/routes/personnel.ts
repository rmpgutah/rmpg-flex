import { Router, Request, Response } from 'express';
import bcryptjs from 'bcryptjs';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { localNow, localToday } from '../utils/timeUtils';

const router = Router();

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
      SELECT id, username, full_name, first_name, last_name, middle_name, email, role,
        badge_number, phone, status, avatar_url, rank, department, address, city, state, zip,
        date_of_birth, hire_date, termination_date, shift_preference,
        dl_number, dl_state, dl_expiry, blood_type, allergies, uniform_size,
        emergency_contact_name, emergency_contact_phone, emergency_contact_relationship,
        employee_id, certifications, notes, profile_image,
        created_at, updated_at
      FROM users ${whereClause}
      ORDER BY full_name
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
    const subPaths = ['schedules', 'time', 'credentials', 'training', 'training-requirements', 'deployments', 'coverage-gaps', 'analytics', 'activity', 'equipment'];
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

    // Check username uniqueness
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) {
      res.status(409).json({ error: 'Username already exists' });
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
        employee_id, certifications, notes, profile_image, last_password_change)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?, ?)
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

    if (setClauses.length > 0) {
      setClauses.push("updated_at = ?");
      setValues.push(localNow());
      setValues.push(req.params.id);
      db.prepare(`UPDATE users SET ${setClauses.join(', ')} WHERE id = ?`).run(...setValues);
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
        required_for_roles: typeof r.required_for_roles === 'string' ? JSON.parse(r.required_for_roles) : r.required_for_roles,
        is_mandatory: !!r.is_mandatory,
      })));
    } catch (error: any) {
      console.error('Get training requirements error:', error);
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
      res.status(500).json({ error: 'Internal server error' });
    }
  });
}

// Stub: Personnel routes for Workers (read-only endpoints ported)
import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { D1Db, paramNum, safeStr } from '../worker-middleware/d1Helpers';
import { localNow, localToday } from '../worker-middleware/timeUtils';
import { auditLog } from '../worker-middleware/auditLogger';
import * as bcrypt from 'bcryptjs';

export function mountPersonnelRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  // GET /api/personnel
  api.get('/', async (c) => {
    const db = new D1Db(c.env.DB);
    const users = await db.prepare(`SELECT id, username, first_name, last_name, full_name, email, role, badge_number, phone, status, avatar_url, created_at FROM users ORDER BY full_name`).all();
    return c.json(users);
  });

  // GET /api/personnel/users - List users
  api.get('/users', requireRole('admin', 'manager'), async (c) => {
    const db = new D1Db(c.env.DB);
    const users = await db.prepare(`SELECT id, username, first_name, last_name, full_name, email, role, badge_number, phone, status, avatar_url, created_at FROM users ORDER BY full_name`).all();
    return c.json(users);
  });

  // GET /api/personnel/users/:id
  api.get('/users/:id', async (c) => {
    const db = new D1Db(c.env.DB);
    const id = paramNum(c.req.param('id'));
    const user = await db.prepare('SELECT id, username, first_name, last_name, full_name, email, role, badge_number, phone, status, avatar_url, created_at FROM users WHERE id = ?').get(id);
    if (!user) return c.json({ error: 'User not found', code: 'USER_NOT_FOUND' }, 404);
    return c.json(user);
  });

  // GET /api/personnel/roster
  api.get('/roster', async (c) => {
    const db = new D1Db(c.env.DB);
    const roster = await db.prepare(`SELECT id, username, full_name, role, badge_number, status FROM users WHERE status = 'active' ORDER BY badge_number`).all();
    return c.json(roster);
  });

  // GET /api/personnel/credentials
  api.get('/credentials', async (c) => {
    const db = new D1Db(c.env.DB);
    const credentials = await db.prepare(`SELECT c.*, u.full_name as officer_name, u.badge_number FROM credentials c LEFT JOIN users u ON c.officer_id = u.id ORDER BY c.expiry_date ASC LIMIT 1000`).all();
    return c.json(credentials);
  });

  // GET /api/personnel/cert-expiration-warnings
  api.get('/cert-expiration-warnings', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const today = localToday();
      const creds = await db.prepare(`
        SELECT c.id, c.officer_id, c.credential_type, c.status, c.expiry_date,
          u.full_name as officer_name, u.badge_number
        FROM credentials c JOIN users u ON u.id = c.officer_id
        WHERE u.status = 'active' AND c.expiry_date IS NOT NULL
        ORDER BY c.expiry_date ASC LIMIT 1000
      `).all() as any[];
      const warnings: any[] = [];
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
      return c.json({ warnings, summary, total: warnings.length });
    } catch {
      return c.json({ error: 'Failed to load cert warnings', code: 'CERT_WARNINGS_ERROR' }, 500);
    }
  });

  // GET /api/personnel/equipment-log
  api.get('/equipment-log', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      await db.prepare(`CREATE TABLE IF NOT EXISTS equipment_checkout_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT, officer_id INTEGER NOT NULL,
        equipment_id INTEGER, equipment_name TEXT NOT NULL, action TEXT NOT NULL,
        condition_notes TEXT, checked_by INTEGER, created_at TEXT DEFAULT (datetime('now'))
      )`).run();
      const { officer_id, days = '30' } = c.req.query();
      const dayCount = parseInt(days as string, 10) || 30;
      let sql = `SELECT ecl.*, u.full_name as officer_name, cu.full_name as checked_by_name
        FROM equipment_checkout_log ecl LEFT JOIN users u ON ecl.officer_id = u.id
        LEFT JOIN users cu ON ecl.checked_by = cu.id WHERE ecl.created_at >= datetime('now', '-' || ? || ' days')`;
      const params: any[] = [dayCount];
      if (officer_id) { sql += ' AND ecl.officer_id = ?'; params.push(officer_id); }
      sql += ' ORDER BY ecl.created_at DESC LIMIT 500';
      const rows = await db.prepare(sql).all(...params);
      return c.json(rows);
    } catch {
      return c.json({ error: 'Failed to load equipment log', code: 'EQUIPMENT_LOG_ERROR' }, 500);
    }
  });

  // POST /api/personnel/equipment-log
  api.post('/equipment-log', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      await db.prepare(`CREATE TABLE IF NOT EXISTS equipment_checkout_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT, officer_id INTEGER NOT NULL,
        equipment_id INTEGER, equipment_name TEXT NOT NULL, action TEXT NOT NULL,
        condition_notes TEXT, checked_by INTEGER, created_at TEXT DEFAULT (datetime('now'))
      )`).run();
      const body = await c.req.json();
      const { officer_id, equipment_id, equipment_name, action, condition_notes } = body;
      if (!officer_id || !equipment_name || !action) return c.json({ error: 'officer_id, equipment_name, and action required', code: 'MISSING_FIELDS' }, 400);
      const result = await db.prepare(`INSERT INTO equipment_checkout_log (officer_id, equipment_id, equipment_name, action, condition_notes, checked_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(officer_id, equipment_id || null, equipment_name, action, condition_notes || null, (c.var as any).user?.userId, localNow());
      return c.json({ success: true, id: Number(result.meta.last_row_id) }, 201);
    } catch {
      return c.json({ error: 'Failed to log equipment checkout', code: 'EQUIPMENT_CHECKOUT_ERROR' }, 500);
    }
  });

  // GET /api/personnel/duty-hours
  api.get('/duty-hours', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const { period = '14', officer_id } = c.req.query();
      const days = parseInt(period as string, 10) || 14;
      const now = new Date();
      const cutoff = new Date(now.getTime() - days * 86400000).toISOString();
      let sql = `SELECT te.officer_id, u.full_name as officer_name, u.badge_number,
        COUNT(*) as shift_count, SUM(te.total_hours) as total_hours,
        AVG(te.total_hours) as avg_hours_per_shift, MAX(te.total_hours) as max_shift_hours,
        SUM(te.overtime_hours) as total_overtime
        FROM time_entries te JOIN users u ON u.id = te.officer_id WHERE te.clock_in >= ?`;
      const params: any[] = [cutoff];
      if (officer_id) { sql += ' AND te.officer_id = ?'; params.push(officer_id); }
      sql += ' GROUP BY te.officer_id ORDER BY total_hours DESC LIMIT 200';
      const rows = await db.prepare(sql).all(...params);
      return c.json(rows);
    } catch {
      return c.json({ error: 'Failed to load duty hours', code: 'DUTY_HOURS_ERROR' }, 500);
    }
  });

  // POST /api/personnel/time/clock-in
  api.post('/time/clock-in', async (c) => {
    const db = new D1Db(c.env.DB);
    const user = c.get('user');
    const body = await c.req.json();
    const { officer_id, latitude, longitude, schedule_id } = body;

    const targetId = officer_id || user.userId;
    const isSelf = String(targetId) === String(user.userId);
    if (!isSelf && !['admin', 'manager', 'supervisor', 'dispatcher'].includes(user.role)) {
      return c.json({ error: 'You can only clock in yourself', code: 'YOU_CAN_ONLY_CLOCK' }, 403);
    }

    const activeEntry = await db.prepare(
      "SELECT * FROM time_entries WHERE officer_id = ? AND status IN ('active', 'on_break')"
    ).get(targetId) as any;

    if (activeEntry) {
      if (user.role === 'admin') {
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
        await db.prepare("UPDATE time_entries SET clock_out = ?, total_hours = ?, break_minutes = ?, break_start = NULL, status = 'completed' WHERE id = ?")
          .run(now2, totH, breakMins2, activeEntry.id);
        await auditLog(db, c, 'ADMIN_OVERRIDE', 'time_entry', activeEntry.id, `Admin force clock-out before re-clock-in (was ${activeEntry.status}, hours: ${totH})`);
      } else {
        return c.json({ error: 'Already clocked in', activeEntry }, 400);
      }
    }

    const now = localNow();
    const result = await db.prepare(
      "INSERT INTO time_entries (officer_id, schedule_id, clock_in, clock_in_latitude, clock_in_longitude) VALUES (?, ?, ?, ?, ?)"
    ).run(targetId, schedule_id || null, now, latitude || null, longitude || null);

    if (schedule_id) {
      await db.prepare("UPDATE schedules SET status = 'active' WHERE id = ?").run(schedule_id);
    }

    const officerRow = await db.prepare('SELECT full_name FROM users WHERE id = ?').get(targetId) as any;
    const officerName = officerRow?.full_name || String(targetId);
    await auditLog(db, c, 'clock_in', 'time_entry', Number(result.meta.last_row_id), isSelf ? 'Clocked in' : `Clocked in ${officerName}`);

    const entry = await db.prepare(
      "SELECT t.*, u.full_name as officer_name, u.badge_number FROM time_entries t LEFT JOIN users u ON t.officer_id = u.id WHERE t.id = ?"
    ).get(Number(result.meta.last_row_id));

    return c.json(entry, 201);
  });

  // POST /api/personnel/time/clock-out
  api.post('/time/clock-out', async (c) => {
    const db = new D1Db(c.env.DB);
    const user = c.get('user');
    const body = await c.req.json();
    const { officer_id } = body;

    const targetId = officer_id || user.userId;
    const isSelf = String(targetId) === String(user.userId);
    if (!isSelf && !['admin', 'manager', 'supervisor', 'dispatcher'].includes(user.role)) {
      return c.json({ error: 'You can only clock out yourself', code: 'YOU_CAN_ONLY_CLOCK' }, 403);
    }

    const activeEntry = await db.prepare(
      "SELECT * FROM time_entries WHERE officer_id = ? AND status IN ('active', 'on_break') ORDER BY clock_in DESC LIMIT 1"
    ).get(targetId) as any;

    if (!activeEntry) {
      if (user.role === 'admin') {
        const now = localNow();
        const result = await db.prepare(
          "INSERT INTO time_entries (officer_id, clock_in, clock_out, total_hours, status) VALUES (?, ?, ?, 0, 'completed')"
        ).run(targetId, now, now);
        await auditLog(db, c, 'ADMIN_OVERRIDE', 'time_entry', Number(result.meta.last_row_id), 'Admin: created completed entry for officer not clocked in');
        const entry = await db.prepare(
          "SELECT t.*, u.full_name as officer_name, u.badge_number FROM time_entries t LEFT JOIN users u ON t.officer_id = u.id WHERE t.id = ?"
        ).get(Number(result.meta.last_row_id));
        return c.json(entry);
      }
      return c.json({ error: 'Not currently clocked in', code: 'NOT_CURRENTLY_CLOCKED_IN' }, 400);
    }

    const now = localNow();
    let breakMins = Number(activeEntry.break_minutes) || 0;
    if (activeEntry.status === 'on_break' && activeEntry.break_start) {
      const breakStart = new Date(activeEntry.break_start.replace(' ', 'T'));
      const breakEnd = new Date(now.replace(' ', 'T'));
      breakMins += Math.round(((breakEnd.getTime() - breakStart.getTime()) / 60000) * 10000) / 10000;
    }

    const clockIn = new Date(activeEntry.clock_in.replace(' ', 'T'));
    const clockOut = new Date(now.replace(' ', 'T'));
    const rawHours = (clockOut.getTime() - clockIn.getTime()) / 3600000;
    const totalHours = Math.max(0, Math.round((rawHours - breakMins / 60) * 10000) / 10000);

    await db.prepare(
      "UPDATE time_entries SET clock_out = ?, total_hours = ?, break_minutes = ?, break_start = NULL, status = 'completed' WHERE id = ?"
    ).run(now, totalHours, breakMins, activeEntry.id);

    if (activeEntry.schedule_id) {
      await db.prepare("UPDATE schedules SET status = 'completed' WHERE id = ?").run(activeEntry.schedule_id);
    }

    const officerRow = await db.prepare('SELECT full_name FROM users WHERE id = ?').get(targetId) as any;
    const officerName = officerRow?.full_name || String(targetId);
    await auditLog(db, c, 'clock_out', 'time_entry', activeEntry.id, isSelf ? `Clocked out. Total: ${totalHours}h` : `Clocked out ${officerName}. Total: ${totalHours}h`);

    const entry = await db.prepare(
      "SELECT t.*, u.full_name as officer_name, u.badge_number FROM time_entries t LEFT JOIN users u ON t.officer_id = u.id WHERE t.id = ?"
    ).get(activeEntry.id);
    return c.json(entry);
  });

  // POST /api/personnel - Create user
  api.post('/', requireRole('admin', 'manager'), async (c) => {
    const db = new D1Db(c.env.DB);
    const user = c.get('user');
    const body = await c.req.json();
    const {
      username, password, full_name, email, role, badge_number, phone,
      first_name, last_name, middle_name, rank, department,
      address, city, state, zip, date_of_birth, hire_date, termination_date,
      shift_preference, dl_number, dl_state, dl_expiry, blood_type,
      allergies, uniform_size,
      emergency_contact_name, emergency_contact_phone, emergency_contact_relationship,
      employee_id, certifications, notes, profile_image,
    } = body;

    if (!username || !password || !full_name || !role) {
      return c.json({ error: 'username, password, full_name, and role are required', code: 'USERNAME_PASSWORD_FULLNAME_AND' }, 400);
    }

    const validRoles = ['admin', 'manager', 'supervisor', 'officer', 'dispatcher', 'contract_manager'];
    if (!validRoles.includes(role)) {
      return c.json({ error: `role must be one of: ${validRoles.join(', ')}`, code: 'INVALID_ROLE' }, 400);
    }

    if (typeof username !== 'string' || username.trim().length < 3 || username.length > 50) {
      return c.json({ error: 'username must be 3-50 characters', code: 'INVALID_USERNAME' }, 400);
    }

    if (typeof password !== 'string' || password.length < 6) {
      return c.json({ error: 'password must be at least 6 characters', code: 'INVALID_PASSWORD' }, 400);
    }

    const existing = await db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) {
      return c.json({ error: 'Username already exists', code: 'USERNAME_ALREADY_EXISTS' }, 409);
    }

    const passwordHash = bcrypt.hashSync(password, 10);
    const derivedFirst = first_name || full_name.split(' ')[0] || '';
    const derivedLast = last_name || full_name.split(' ').slice(1).join(' ') || '';

    const result = await db.prepare(`
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
      localNow(),
    );

    const newUser = await db.prepare(`
      SELECT id, username, full_name, first_name, last_name, middle_name, email, role,
        badge_number, phone, status, avatar_url, rank, department, address, city, state, zip,
        date_of_birth, hire_date, termination_date, shift_preference,
        dl_number, dl_state, dl_expiry, blood_type, allergies, uniform_size,
        emergency_contact_name, emergency_contact_phone, emergency_contact_relationship,
        employee_id, certifications, notes, profile_image,
        created_at, updated_at
      FROM users WHERE id = ?
    `).get(Number(result.meta.last_row_id));

    await auditLog(db, c, 'user_created', 'user', Number(result.meta.last_row_id), `Created user: ${username} (${role})`);
    return c.json(newUser, 201);
  });

  app.route('/api/personnel', api);
}

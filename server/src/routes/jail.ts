import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { paramStr } from '../utils/reqHelpers';

const router = Router();
router.use(authenticateToken);

// ─── Helpers ────────────────────────────────────────────────────────────────

function generateBookingNumber(db: ReturnType<typeof getDb>): string {
  const year = new Date().getFullYear();
  const prefix = `BK-${year}-`;
  const row = db.prepare(
    `SELECT booking_number FROM jail_bookings WHERE booking_number LIKE ? ORDER BY id DESC LIMIT 1`
  ).get(`${prefix}%`) as { booking_number: string } | undefined;

  let seq = 1;
  if (row) {
    const parts = row.booking_number.split('-');
    const parsed = parseInt(parts[parts.length - 1], 10);
    seq = isNaN(parsed) ? 1 : parsed + 1;
  }
  return `${prefix}${String(seq).padStart(5, '0')}`;
}

// ─── Inmates ────────────────────────────────────────────────────────────────

// GET /inmates — List inmates
router.get('/inmates', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { status, classification, search, housing_unit } = req.query;

    let where = 'WHERE 1=1';
    const params: any[] = [];

    if (status) { where += ' AND i.status = ?'; params.push(status); }
    if (classification) { where += ' AND i.classification = ?'; params.push(classification); }
    if (housing_unit) { where += ' AND i.housing_unit = ?'; params.push(housing_unit); }
    if (search) {
      where += ' AND (i.first_name LIKE ? OR i.last_name LIKE ? OR i.inmate_number LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s);
    }

    const rows = db.prepare(`
      SELECT i.*
      FROM jail_inmates i
      ${where}
      ORDER BY i.last_name, i.first_name
    `).all(...params);

    res.json(rows);
  } catch (err: any) {
    console.error('[Jail] List inmates error:', err?.message);
    res.status(500).json({ error: 'Failed to list inmates', code: 'JAIL_ERROR' });
  }
});

// GET /inmates/:id — Single inmate with bookings and movements
router.get('/inmates/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(paramStr(req.params.id), 10);

    const inmate = db.prepare('SELECT * FROM jail_inmates WHERE id = ?').get(id);
    if (!inmate) {
      res.status(404).json({ error: 'Inmate not found' });
      return;
    }

    const bookings = db.prepare('SELECT * FROM jail_bookings WHERE inmate_id = ? ORDER BY booking_date DESC').all(id);
    const movements = db.prepare('SELECT * FROM jail_movements WHERE inmate_id = ? ORDER BY movement_time DESC').all(id);

    res.json({ ...(inmate as any), bookings, movements });
  } catch (err: any) {
    console.error('[Jail] Get inmate error:', err?.message);
    res.status(500).json({ error: 'Failed to get inmate', code: 'JAIL_ERROR' });
  }
});

// POST /inmates — Intake new inmate
router.post('/inmates', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const {
      first_name, last_name, date_of_birth, gender, race,
      inmate_number, classification, housing_unit, medical_notes,
    } = req.body;

    if (!first_name || !last_name) {
      res.status(400).json({ error: 'first_name and last_name are required' });
      return;
    }

    const now = new Date().toISOString();
    const result = db.prepare(`
      INSERT INTO jail_inmates (first_name, last_name, date_of_birth, gender, race, inmate_number, classification, housing_unit, medical_notes, status, intake_date, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'in_custody', ?, ?, ?)
    `).run(
      first_name, last_name, date_of_birth || null, gender || null,
      race || null, inmate_number || null, classification || 'general',
      housing_unit || null, medical_notes || null, now, now, now
    );

    res.status(201).json({ success: true, id: result.lastInsertRowid });
  } catch (err: any) {
    console.error('[Jail] Intake error:', err?.message);
    res.status(500).json({ error: 'Failed to intake inmate', code: 'JAIL_ERROR' });
  }
});

// PUT /inmates/:id — Update inmate
router.put('/inmates/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(paramStr(req.params.id), 10);
    const {
      first_name, last_name, date_of_birth, gender, race,
      classification, housing_unit, medical_notes, status,
    } = req.body;
    const now = new Date().toISOString();

    const existing = db.prepare('SELECT id FROM jail_inmates WHERE id = ?').get(id);
    if (!existing) {
      res.status(404).json({ error: 'Inmate not found' });
      return;
    }

    db.prepare(`
      UPDATE jail_inmates SET
        first_name = COALESCE(?, first_name), last_name = COALESCE(?, last_name),
        date_of_birth = COALESCE(?, date_of_birth), gender = COALESCE(?, gender),
        race = COALESCE(?, race), classification = COALESCE(?, classification),
        housing_unit = COALESCE(?, housing_unit), medical_notes = COALESCE(?, medical_notes),
        status = COALESCE(?, status), updated_at = ?
      WHERE id = ?
    `).run(
      first_name || null, last_name || null, date_of_birth || null,
      gender || null, race || null, classification || null,
      housing_unit || null, medical_notes || null, status || null, now, id
    );

    const updated = db.prepare('SELECT * FROM jail_inmates WHERE id = ?').get(id);
    res.json(updated);
  } catch (err: any) {
    console.error('[Jail] Update inmate error:', err?.message);
    res.status(500).json({ error: 'Failed to update inmate', code: 'JAIL_ERROR' });
  }
});

// ─── Bookings ───────────────────────────────────────────────────────────────

// GET /bookings — List bookings
router.get('/bookings', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { inmate_id, date_from, date_to, status } = req.query;

    let where = 'WHERE 1=1';
    const params: any[] = [];

    if (inmate_id) { where += ' AND b.inmate_id = ?'; params.push(inmate_id); }
    if (status) { where += ' AND b.status = ?'; params.push(status); }
    if (date_from) { where += ' AND b.booking_date >= ?'; params.push(date_from); }
    if (date_to) { where += ' AND b.booking_date <= ?'; params.push(date_to); }

    const rows = db.prepare(`
      SELECT b.*, i.first_name, i.last_name
      FROM jail_bookings b
      LEFT JOIN jail_inmates i ON b.inmate_id = i.id
      ${where}
      ORDER BY b.booking_date DESC
    `).all(...params);

    res.json(rows);
  } catch (err: any) {
    console.error('[Jail] List bookings error:', err?.message);
    res.status(500).json({ error: 'Failed to list bookings', code: 'JAIL_ERROR' });
  }
});

// POST /bookings — New booking
router.post('/bookings', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const {
      inmate_id, charges, arresting_officer_id, arresting_agency,
      bail_amount, court_date, notes,
    } = req.body;

    if (!inmate_id) {
      res.status(400).json({ error: 'inmate_id is required' });
      return;
    }

    const booking_number = generateBookingNumber(db);
    const now = new Date().toISOString();

    const result = db.prepare(`
      INSERT INTO jail_bookings (booking_number, inmate_id, charges, arresting_officer_id, arresting_agency, bail_amount, court_date, notes, status, booking_date, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
    `).run(
      booking_number, inmate_id, charges || null, arresting_officer_id || null,
      arresting_agency || null, bail_amount || null, court_date || null,
      notes || null, now, now, now
    );

    res.status(201).json({ success: true, id: result.lastInsertRowid, booking_number });
  } catch (err: any) {
    console.error('[Jail] Create booking error:', err?.message);
    res.status(500).json({ error: 'Failed to create booking', code: 'JAIL_ERROR' });
  }
});

// PUT /bookings/:id/release — Release booking
router.put('/bookings/:id/release', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(paramStr(req.params.id), 10);
    const { release_reason, release_notes } = req.body;
    const now = new Date().toISOString();

    const existing = db.prepare('SELECT id, inmate_id FROM jail_bookings WHERE id = ?').get(id) as any;
    if (!existing) {
      res.status(404).json({ error: 'Booking not found' });
      return;
    }

    db.prepare(`
      UPDATE jail_bookings SET status = 'released', release_date = ?, release_reason = ?, release_notes = ?, updated_at = ? WHERE id = ?
    `).run(now, release_reason || null, release_notes || null, now, id);

    // Check if inmate has any other active bookings; if not, update inmate status
    const activeBookings = db.prepare(
      `SELECT COUNT(*) as count FROM jail_bookings WHERE inmate_id = ? AND status = 'active' AND id != ?`
    ).get(existing.inmate_id, id) as any;

    if (activeBookings.count === 0) {
      db.prepare(`UPDATE jail_inmates SET status = 'released', updated_at = ? WHERE id = ?`).run(now, existing.inmate_id);
    }

    res.json({ success: true });
  } catch (err: any) {
    console.error('[Jail] Release error:', err?.message);
    res.status(500).json({ error: 'Failed to release booking', code: 'JAIL_ERROR' });
  }
});

// ─── Housing ────────────────────────────────────────────────────────────────

// GET /housing — Housing board (units with occupancy)
router.get('/housing', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const units = db.prepare(`
      SELECT housing_unit, COUNT(*) as occupancy,
        SUM(CASE WHEN classification = 'maximum' THEN 1 ELSE 0 END) as max_security,
        SUM(CASE WHEN classification = 'medium' THEN 1 ELSE 0 END) as med_security,
        SUM(CASE WHEN classification = 'minimum' THEN 1 ELSE 0 END) as min_security
      FROM jail_inmates
      WHERE status = 'in_custody' AND housing_unit IS NOT NULL
      GROUP BY housing_unit
      ORDER BY housing_unit
    `).all();

    res.json(units);
  } catch (err: any) {
    console.error('[Jail] Housing error:', err?.message);
    res.status(500).json({ error: 'Failed to get housing', code: 'JAIL_ERROR' });
  }
});

// ─── Movements ──────────────────────────────────────────────────────────────

// POST /movements — Log a movement
router.post('/movements', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { inmate_id, movement_type, from_location, to_location, reason, officer_id } = req.body;

    if (!inmate_id || !movement_type) {
      res.status(400).json({ error: 'inmate_id and movement_type are required' });
      return;
    }

    const now = new Date().toISOString();
    const result = db.prepare(`
      INSERT INTO jail_movements (inmate_id, movement_type, from_location, to_location, reason, officer_id, movement_time, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(inmate_id, movement_type, from_location || null, to_location || null, reason || null, officer_id || null, now, now);

    // Update inmate housing if movement changes it
    if (to_location) {
      db.prepare('UPDATE jail_inmates SET housing_unit = ?, updated_at = ? WHERE id = ?').run(to_location, now, inmate_id);
    }

    res.status(201).json({ success: true, id: result.lastInsertRowid });
  } catch (err: any) {
    console.error('[Jail] Movement error:', err?.message);
    res.status(500).json({ error: 'Failed to log movement', code: 'JAIL_ERROR' });
  }
});

// GET /movements/:inmateId — Movement history for inmate
router.get('/movements/:inmateId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const inmateId = parseInt(paramStr(req.params.inmateId), 10);

    const rows = db.prepare(`
      SELECT m.*, u.full_name as officer_name
      FROM jail_movements m
      LEFT JOIN users u ON m.officer_id = u.id
      WHERE m.inmate_id = ?
      ORDER BY m.movement_time DESC
    `).all(inmateId);

    res.json(rows);
  } catch (err: any) {
    console.error('[Jail] Movement history error:', err?.message);
    res.status(500).json({ error: 'Failed to get movement history', code: 'JAIL_ERROR' });
  }
});

// ─── Stats ──────────────────────────────────────────────────────────────────

// GET /stats — Jail statistics
router.get('/stats', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const byStatus = db.prepare('SELECT status, COUNT(*) as count FROM jail_inmates GROUP BY status').all();
    const byClassification = db.prepare(
      `SELECT classification, COUNT(*) as count FROM jail_inmates WHERE status = 'in_custody' GROUP BY classification`
    ).all();
    const totalInCustody = db.prepare(`SELECT COUNT(*) as count FROM jail_inmates WHERE status = 'in_custody'`).get() as any;
    const totalCapacity = db.prepare(`SELECT COUNT(DISTINCT housing_unit) as units FROM jail_inmates WHERE housing_unit IS NOT NULL`).get() as any;
    const bookingsToday = db.prepare(
      `SELECT COUNT(*) as count FROM jail_bookings WHERE date(booking_date) = date('now')`
    ).get() as any;
    const releasesToday = db.prepare(
      `SELECT COUNT(*) as count FROM jail_bookings WHERE date(release_date) = date('now')`
    ).get() as any;

    res.json({
      in_custody: totalInCustody.count,
      housing_units: totalCapacity.units,
      by_status: byStatus,
      by_classification: byClassification,
      bookings_today: bookingsToday.count,
      releases_today: releasesToday.count,
    });
  } catch (err: any) {
    console.error('[Jail] Stats error:', err?.message);
    res.status(500).json({ error: 'Failed to get stats', code: 'JAIL_ERROR' });
  }
});

export default router;

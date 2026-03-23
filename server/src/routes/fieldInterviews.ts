import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken } from '../middleware/auth';
import { broadcast } from '../utils/websocket';
import { auditLog } from '../utils/auditLogger';
import { localNow } from '../utils/timeUtils';

const router = Router();
router.use(authenticateToken);

/** Generate next FI number: FI-YYYY-NNNN */
function generateFiNumber(db: ReturnType<typeof getDb>): string {
  const year = new Date().getFullYear();
  const prefix = `FI-${year}-`;
  const row = db.prepare(
    `SELECT fi_number FROM field_interviews WHERE fi_number LIKE ? ORDER BY id DESC LIMIT 1`
  ).get(`${prefix}%`) as { fi_number: string } | undefined;

  let seq = 1;
  if (row) {
    const parts = row.fi_number.split('-');
    seq = parseInt(parts[2], 10) + 1;
  }
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

// GET / — List field interviews
router.get('/', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { status, officer_id, search, archived, page = '1', per_page = '50' } = req.query;

    let where = 'WHERE 1=1';
    const params: any[] = [];

    if (status) { where += ' AND fi.status = ?'; params.push(status); }
    if (officer_id) { where += ' AND fi.officer_id = ?'; params.push(officer_id); }
    if (search) {
      where += ` AND (fi.subject_first_name || ' ' || fi.subject_last_name LIKE ? OR fi.fi_number LIKE ? OR fi.location LIKE ? OR fi.narrative LIKE ?)`;
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }
    if (archived === 'true') {
      where += ' AND fi.archived_at IS NOT NULL';
    } else if (archived !== 'all') {
      where += ' AND fi.archived_at IS NULL';
    }

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const perPage = Math.min(200, Math.max(1, parseInt(per_page as string, 10) || 50));
    const offset = (pageNum - 1) * perPage;

    const countRow = db.prepare(`SELECT COUNT(*) as total FROM field_interviews fi ${where}`).get(...params) as any;
    const rows = db.prepare(`
      SELECT fi.*, u.full_name as officer_display_name,
        p.first_name as linked_person_first, p.last_name as linked_person_last
      FROM field_interviews fi
      LEFT JOIN users u ON fi.officer_id = u.id
      LEFT JOIN persons p ON fi.person_id = p.id
      ${where}
      ORDER BY fi.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, perPage, offset);

    res.json({
      data: rows,
      pagination: { page: pageNum, per_page: perPage, total: countRow.total, totalPages: Math.ceil(countRow.total / perPage) },
    });
  } catch (err: any) {
    console.error('[FieldInterviews] Error:', err?.message);
    res.status(500).json({ error: 'Failed to retrieve field interviews', code: 'LIST_FI_ERROR' });
  }
});

// GET /map — Field interviews with coordinates for map overlay
router.get('/map', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const days = parseInt(req.query.days as string, 10) || 30;

    const rows = db.prepare(`
      SELECT id, fi_number, subject_first_name, subject_last_name, latitude, longitude,
             contact_reason, action_taken, officer_name, created_at, location
      FROM field_interviews
      WHERE latitude IS NOT NULL AND longitude IS NOT NULL
        AND created_at >= datetime('now', '-' || ? || ' days', 'localtime')
        AND archived_at IS NULL
      ORDER BY created_at DESC
      LIMIT 200
    `).all(days);

    res.set('Cache-Control', 'private, max-age=60');
    res.json(rows);
  } catch (err: any) {
    console.error('[FieldInterviews] Error:', err?.message);
    res.status(500).json({ error: 'Failed to retrieve map data', code: 'MAP_DATA_ERROR' });
  }
});

// GET /repeat-check — Check if a subject has been contacted 3+ times in last 30 days
router.get('/repeat-check', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { name } = req.query;
    if (!name || (name as string).length < 2) {
      res.json({ count: 0, recent: [] });
      return;
    }
    const searchName = `%${(name as string).trim()}%`;
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    const rows = db.prepare(`
      SELECT id, fi_number, subject_first_name, subject_last_name, location, contact_reason, created_at
      FROM field_interviews
      WHERE (subject_first_name || ' ' || subject_last_name LIKE ? OR subject_last_name LIKE ?)
        AND created_at >= ?
        AND archived_at IS NULL
      ORDER BY created_at DESC
    
      LIMIT 1000
    `).all(searchName, searchName, thirtyDaysAgo) as any[];
    res.json({ count: rows.length, recent: rows.slice(0, 5) });
  } catch (err: any) {
    console.error('[FieldInterviews] Error:', err?.message);
    res.status(500).json({ error: 'Failed to check repeat contacts', code: 'REPEAT_CHECK_ERROR' });
  }
});

// GET /:id — Single FI detail
router.get('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: 'Invalid field interview ID', code: 'INVALID_FIELD_INTERVIEW_ID' });
      return;
    }
    const row = db.prepare(`
      SELECT fi.*, u.full_name as officer_display_name,
        p.first_name as linked_person_first, p.last_name as linked_person_last
      FROM field_interviews fi
      LEFT JOIN users u ON fi.officer_id = u.id
      LEFT JOIN persons p ON fi.person_id = p.id
      WHERE fi.id = ?
    `).get(id);
    if (!row) return res.status(404).json({ error: 'Field interview not found', code: 'NOT_FOUND' });
    res.json({ data: row });
  } catch (err: any) {
    console.error('[FieldInterviews] Error:', err?.message);
    res.status(500).json({ error: 'Internal server error', code: 'FETCH_ERROR' });
  }
});

// POST / — Create new FI
router.post('/', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const fi_number = generateFiNumber(db);
    const now = localNow();

    const {
      person_id, subject_first_name, subject_last_name, subject_dob,
      subject_gender, subject_race, subject_height, subject_weight,
      subject_hair, subject_eye, subject_clothing, subject_description,
      location, latitude, longitude, property_id,
      contact_reason = 'other', contact_type = 'field', action_taken = 'none',
      narrative, vehicle_plate, vehicle_description, vehicle_id,
      associated_call_id, associated_incident_id,
    } = req.body;

    if (!location) return res.status(400).json({ error: 'Location is required', code: 'MISSING_LOCATION' });

    // Input sanitization
    const cleanLocation = typeof location === 'string' ? location.trim() : location;
    const cleanNarrative = typeof narrative === 'string' ? narrative.trim() : narrative;
    const cleanFirstName = typeof subject_first_name === 'string' ? subject_first_name.trim() : subject_first_name;
    const cleanLastName = typeof subject_last_name === 'string' ? subject_last_name.trim() : subject_last_name;

    // Validate latitude/longitude if provided
    if (latitude !== undefined && latitude !== null) {
      const lat = parseFloat(latitude);
      if (isNaN(lat) || lat < -90 || lat > 90) return res.status(400).json({ error: 'Invalid latitude', code: 'INVALID_LATITUDE' });
    }
    if (longitude !== undefined && longitude !== null) {
      const lng = parseFloat(longitude);
      if (isNaN(lng) || lng < -180 || lng > 180) return res.status(400).json({ error: 'Invalid longitude', code: 'INVALID_LONGITUDE' });
    }

    const result = db.prepare(`
      INSERT INTO field_interviews (
        fi_number, person_id, subject_first_name, subject_last_name, subject_dob,
        subject_gender, subject_race, subject_height, subject_weight,
        subject_hair, subject_eye, subject_clothing, subject_description,
        location, latitude, longitude, property_id,
        contact_reason, contact_type, action_taken,
        narrative, vehicle_plate, vehicle_description, vehicle_id,
        associated_call_id, associated_incident_id,
        officer_id, officer_name, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
    `).run(
      fi_number, person_id || null, subject_first_name, subject_last_name, subject_dob,
      subject_gender, subject_race, subject_height, subject_weight,
      subject_hair, subject_eye, subject_clothing, subject_description,
      location, latitude || null, longitude || null, property_id || null,
      contact_reason, contact_type, action_taken,
      narrative, vehicle_plate, vehicle_description, vehicle_id || null,
      associated_call_id || null, associated_incident_id || null,
      user.id, user.full_name, now
    );

    const created = db.prepare('SELECT * FROM field_interviews WHERE id = ?').get(result.lastInsertRowid);
    auditLog(req, 'CREATE', 'field_interview', result.lastInsertRowid as number, `Created field interview ${fi_number}`);
    broadcast('alerts', 'fi_created', created);
    res.status(201).json({ data: created });
  } catch (err: any) {
    console.error('[FieldInterviews] Error:', err?.message);
    res.status(500).json({ error: 'Failed to create field interview', code: 'CREATE_FI_ERROR' });
  }
});

// PUT /:id — Update FI
router.put('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: 'Invalid field interview ID', code: 'INVALID_FIELD_INTERVIEW_ID' });
      return;
    }
    const existing = db.prepare('SELECT id FROM field_interviews WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'Field interview not found', code: 'FIELD_INTERVIEW_NOT_FOUND' });

    const fields = [
      'person_id', 'subject_first_name', 'subject_last_name', 'subject_dob',
      'subject_gender', 'subject_race', 'subject_height', 'subject_weight',
      'subject_hair', 'subject_eye', 'subject_clothing', 'subject_description',
      'location', 'latitude', 'longitude', 'property_id',
      'contact_reason', 'contact_type', 'action_taken',
      'narrative', 'vehicle_plate', 'vehicle_description', 'vehicle_id',
      'associated_call_id', 'associated_incident_id',
    ];

    const setClauses: string[] = [];
    const params: any[] = [];
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        setClauses.push(`${f} = ?`);
        params.push(req.body[f] || null);
      }
    }
    if (setClauses.length === 0) return res.status(400).json({ error: 'No fields to update', code: 'NO_FIELDS_TO_UPDATE' });

    params.push(req.params.id);
    db.prepare(`UPDATE field_interviews SET ${setClauses.join(', ')} WHERE id = ?`).run(...params);

    const updated = db.prepare('SELECT * FROM field_interviews WHERE id = ?').get(req.params.id);
    auditLog(req, 'UPDATE', 'field_interview', id, `Updated field interview #${id}`);
    broadcast('alerts', 'fi_updated', updated);
    res.json({ data: updated });
  } catch (err: any) {
    console.error('[FieldInterviews] Error:', err?.message);
    res.status(500).json({ error: 'Failed to update field interview', code: 'UPDATE_FI_ERROR' });
  }
});

// POST /:id/archive
router.post('/:id/archive', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid ID', code: 'INVALID_ID' }); return; }
    const existing = db.prepare('SELECT id FROM field_interviews WHERE id = ?').get(id);
    if (!existing) { res.status(404).json({ error: 'Field interview not found', code: 'FIELD_INTERVIEW_NOT_FOUND' }); return; }
    db.prepare(`UPDATE field_interviews SET status = 'archived', archived_at = ? WHERE id = ?`).run(localNow(), id);
    auditLog(req, 'UPDATE', 'field_interview', id, `Archived field interview #${id}`);
    broadcast('alerts', 'fi_archived', { id });
    res.json({ success: true });
  } catch (err: any) {
    console.error('[FieldInterviews] Error:', err?.message);
    res.status(500).json({ error: 'Internal server error', code: 'ARCHIVE_ERROR' });
  }
});

// POST /:id/unarchive
router.post('/:id/unarchive', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid ID', code: 'INVALID_ID' }); return; }
    const existing = db.prepare('SELECT id FROM field_interviews WHERE id = ?').get(id);
    if (!existing) { res.status(404).json({ error: 'Field interview not found', code: 'NOT_FOUND' }); return; }
    db.prepare(`UPDATE field_interviews SET status = 'active', archived_at = NULL WHERE id = ?`).run(id);
    auditLog(req, 'UPDATE', 'field_interview', id, `Unarchived field interview #${id}`);
    broadcast('alerts', 'fi_unarchived', { id });
    res.json({ success: true });
  } catch (err: any) {
    console.error('[FieldInterviews] Error:', err?.message);
    res.status(500).json({ error: 'Failed to unarchive field interview', code: 'UNARCHIVE_ERROR' });
  }
});

// DELETE /:id — Soft delete (archive)
router.delete('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid ID', code: 'INVALID_ID' }); return; }
    const existing = db.prepare('SELECT id FROM field_interviews WHERE id = ?').get(id);
    if (!existing) { res.status(404).json({ error: 'Field interview not found', code: 'FIELD_INTERVIEW_NOT_FOUND' }); return; }
    db.prepare(`UPDATE field_interviews SET status = 'archived', archived_at = ? WHERE id = ?`).run(localNow(), id);
    auditLog(req, 'DELETE', 'field_interview', id, `Soft-deleted field interview #${id}`);
    broadcast('alerts', 'fi_deleted', { id });
    res.json({ success: true });
  } catch (err: any) {
    console.error('[FieldInterviews] Error:', err?.message);
    res.status(500).json({ error: 'Internal server error', code: 'DELETE_ERROR' });
  }
});

// GET /api/field-interviews/map — Field interviews with coordinates for map display
router.get('/map', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const days = parseInt(req.query.days as string, 10) || 90;

    const interviews = db.prepare(`
      SELECT fi.id, fi.location, fi.latitude, fi.longitude, fi.date_time,
        fi.reason, fi.disposition, fi.officer_id,
        p.first_name as subject_first_name, p.last_name as subject_last_name,
        u.full_name as officer_name
      FROM field_interviews fi
      LEFT JOIN persons p ON fi.person_id = p.id
      LEFT JOIN users u ON fi.officer_id = u.id
      WHERE fi.latitude IS NOT NULL AND fi.longitude IS NOT NULL
        AND fi.date_time >= datetime('now','localtime','-${days} days')
      ORDER BY fi.date_time DESC
      LIMIT 500
    `).all();

    res.json(interviews);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to retrieve map interviews', code: 'MAP_FI_ERROR' });
  }
});

// GET /api/field-interviews/repeat-check — Check for repeated contacts with same person
router.get('/repeat-check', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { person_id } = req.query;
    if (!person_id) { res.status(400).json({ error: 'person_id required', code: 'PERSONID_REQUIRED' }); return; }

    const contacts = db.prepare(`
      SELECT fi.*, u.full_name as officer_name
      FROM field_interviews fi
      LEFT JOIN users u ON fi.officer_id = u.id
      WHERE fi.person_id = ?
      ORDER BY fi.date_time DESC
      LIMIT 100
    `).all(person_id);

    res.json({
      person_id: Number(person_id),
      total_contacts: contacts.length,
      is_repeat: contacts.length > 1,
      contacts,
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to check repeated contacts', code: 'REPEAT_CONTACT_ERROR' });
  }
});

export default router;

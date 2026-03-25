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
    const parsed = parseInt(parts[2], 10);
    seq = isNaN(parsed) ? 1 : parsed + 1;
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
    const days = Math.max(1, Math.min(365, parseInt(req.query.days as string, 10) || 30));

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
    const days = Math.max(1, Math.min(365, parseInt(req.query.days as string, 10) || 90));

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

// ════════════════════════════════════════════════════════════
// UPGRADE 27: Gang Affiliation Tracking Field
// ════════════════════════════════════════════════════════════
// Add gang_affiliation column if not present
try { const db = getDb(); db.prepare("SELECT gang_affiliation FROM field_interviews LIMIT 1").get(); } catch { try { const db = getDb(); db.prepare("ALTER TABLE field_interviews ADD COLUMN gang_affiliation TEXT").run(); } catch { /* already exists */ } }

// UPGRADE 28: Associate Linking for Field Interviews
try { const db = getDb(); db.prepare(`CREATE TABLE IF NOT EXISTS fi_associates (id INTEGER PRIMARY KEY AUTOINCREMENT, fi_id INTEGER NOT NULL, person_id INTEGER, name TEXT NOT NULL, relationship TEXT DEFAULT 'associate', notes TEXT, created_at TEXT NOT NULL)`).run(); } catch { /* already exists */ }

router.get('/:id/associates', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const fi = db.prepare('SELECT id FROM field_interviews WHERE id = ?').get(req.params.id);
    if (!fi) { res.status(404).json({ error: 'Field interview not found', code: 'NOT_FOUND' }); return; }
    const associates = db.prepare('SELECT fa.*, p.first_name, p.last_name, p.photo_url, p.dob FROM fi_associates fa LEFT JOIN persons p ON fa.person_id = p.id WHERE fa.fi_id = ? ORDER BY fa.created_at DESC').all(req.params.id);
    res.json({ data: associates });
  } catch (err: any) { console.error('[FieldInterviews] Get associates error:', err?.message); res.status(500).json({ error: 'Failed to get associates', code: 'GET_FI_ASSOCIATES_ERROR' }); }
});

router.post('/:id/associates', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const fi = db.prepare('SELECT id, fi_number FROM field_interviews WHERE id = ?').get(req.params.id) as any;
    if (!fi) { res.status(404).json({ error: 'Field interview not found', code: 'NOT_FOUND' }); return; }
    const { person_id, name, relationship, notes } = req.body;
    if (!name?.trim() && !person_id) { res.status(400).json({ error: 'name or person_id required', code: 'MISSING_ASSOCIATE_INFO' }); return; }
    let assocName = name || '';
    if (person_id && !assocName) { const p = db.prepare('SELECT first_name, last_name FROM persons WHERE id = ?').get(person_id) as any; if (p) assocName = `${p.first_name} ${p.last_name}`; }
    const now = localNow();
    const result = db.prepare('INSERT INTO fi_associates (fi_id, person_id, name, relationship, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(req.params.id, person_id || null, assocName, relationship || 'associate', notes || null, now);
    auditLog(req, 'CREATE', 'fi_associate', Number(result.lastInsertRowid), `Added associate "${assocName}" to FI ${fi.fi_number}`);
    res.status(201).json({ data: { id: result.lastInsertRowid } });
  } catch (err: any) { console.error('[FieldInterviews] Create associate error:', err?.message); res.status(500).json({ error: 'Failed to add associate', code: 'CREATE_FI_ASSOCIATE_ERROR' }); }
});

router.delete('/:id/associates/:assocId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const assoc = db.prepare('SELECT * FROM fi_associates WHERE id = ? AND fi_id = ?').get(req.params.assocId, req.params.id) as any;
    if (!assoc) { res.status(404).json({ error: 'Associate not found', code: 'FI_ASSOCIATE_NOT_FOUND' }); return; }
    db.prepare('DELETE FROM fi_associates WHERE id = ?').run(req.params.assocId);
    res.json({ success: true });
  } catch (err: any) { console.error('[FieldInterviews] Delete associate error:', err?.message); res.status(500).json({ error: 'Failed to delete associate', code: 'DELETE_FI_ASSOCIATE_ERROR' }); }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 29: Location Clustering (FIs at same location)
// ════════════════════════════════════════════════════════════
router.get('/location-clusters', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const days = parseInt(req.query.days as string, 10) || 90;
    const minCount = parseInt(req.query.min_count as string, 10) || 2;
    // Cluster by exact location string match
    const clusters = db.prepare(`
      SELECT location, COUNT(*) as fi_count,
        MIN(created_at) as first_contact, MAX(created_at) as last_contact,
        GROUP_CONCAT(DISTINCT contact_reason) as reasons,
        GROUP_CONCAT(DISTINCT (subject_first_name || ' ' || subject_last_name), ', ') as subjects
      FROM field_interviews
      WHERE location IS NOT NULL AND location != ''
        AND created_at >= datetime('now', '-' || ? || ' days', 'localtime')
        AND archived_at IS NULL
      GROUP BY location
      HAVING COUNT(*) >= ?
      ORDER BY fi_count DESC
      LIMIT 50
    `).all(days, minCount);
    // Also cluster by proximity (rounded lat/lng)
    let geoClusters: any[] = [];
    try {
      geoClusters = db.prepare(`
        SELECT ROUND(latitude, 3) as lat_cluster, ROUND(longitude, 3) as lng_cluster,
          COUNT(*) as fi_count,
          GROUP_CONCAT(DISTINCT location, ' | ') as locations
        FROM field_interviews
        WHERE latitude IS NOT NULL AND longitude IS NOT NULL
          AND created_at >= datetime('now', '-' || ? || ' days', 'localtime')
          AND archived_at IS NULL
        GROUP BY lat_cluster, lng_cluster
        HAVING COUNT(*) >= ?
        ORDER BY fi_count DESC
        LIMIT 30
      `).all(days, minCount);
    } catch { /* lat/lng columns may not exist */ }
    res.json({ data: { location_clusters: clusters, geo_clusters: geoClusters } });
  } catch (err: any) { console.error('[FieldInterviews] Location clusters error:', err?.message); res.status(500).json({ error: 'Failed to get clusters', code: 'LOCATION_CLUSTERS_ERROR' }); }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 30: Field Interviews CSV Export
// ════════════════════════════════════════════════════════════
router.get('/export/csv', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { date_from, date_to, contact_reason } = req.query;
    let where = 'WHERE fi.archived_at IS NULL';
    const params: any[] = [];
    if (date_from) { where += ' AND fi.created_at >= ?'; params.push(date_from); }
    if (date_to) { where += ' AND fi.created_at <= ?'; params.push(date_to); }
    if (contact_reason) { where += ' AND fi.contact_reason = ?'; params.push(contact_reason); }
    const rows = db.prepare(`SELECT fi.fi_number, fi.subject_first_name, fi.subject_last_name, fi.subject_dob, fi.subject_gender, fi.subject_race, fi.location, fi.contact_reason, fi.contact_type, fi.action_taken, fi.narrative, fi.vehicle_plate, fi.vehicle_description, fi.officer_name, fi.created_at FROM field_interviews fi ${where} ORDER BY fi.created_at DESC LIMIT 10000`).all(...params) as any[];
    const headers = ['FI #', 'First Name', 'Last Name', 'DOB', 'Gender', 'Race', 'Location', 'Reason', 'Type', 'Action', 'Narrative', 'Vehicle Plate', 'Vehicle Desc', 'Officer', 'Created'];
    const csvRows = rows.map((r: any) => [r.fi_number, r.subject_first_name, r.subject_last_name, r.subject_dob, r.subject_gender, r.subject_race, (r.location || '').replace(/"/g, '""'), r.contact_reason, r.contact_type, r.action_taken, (r.narrative || '').replace(/"/g, '""').replace(/\n/g, ' '), r.vehicle_plate, (r.vehicle_description || '').replace(/"/g, '""'), r.officer_name, r.created_at]);
    const csv = [headers.join(','), ...csvRows.map((r: any[]) => r.map(v => `"${v || ''}"`).join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="field_interviews_${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  } catch (err: any) { console.error('[FieldInterviews] Export error:', err?.message); res.status(500).json({ error: 'Failed to export', code: 'EXPORT_FI_ERROR' }); }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 31: Field Interview Statistics
// ════════════════════════════════════════════════════════════
router.get('/stats/overview', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const totalActive = (db.prepare("SELECT COUNT(*) as count FROM field_interviews WHERE status = 'active'").get() as any).count;
    const byReason = db.prepare(`SELECT contact_reason, COUNT(*) as count FROM field_interviews WHERE archived_at IS NULL GROUP BY contact_reason`).all() as any[];
    const byAction = db.prepare(`SELECT action_taken, COUNT(*) as count FROM field_interviews WHERE archived_at IS NULL GROUP BY action_taken`).all() as any[];
    const byOfficer = db.prepare(`SELECT officer_id, officer_name, COUNT(*) as fi_count FROM field_interviews WHERE archived_at IS NULL AND officer_id IS NOT NULL GROUP BY officer_id, officer_name ORDER BY fi_count DESC LIMIT 20`).all() as any[];
    const thisWeek = (db.prepare("SELECT COUNT(*) as count FROM field_interviews WHERE created_at >= datetime('now','-7 days','localtime')").get() as any).count;
    const thisMonth = (db.prepare("SELECT COUNT(*) as count FROM field_interviews WHERE created_at >= datetime('now','start of month','localtime')").get() as any).count;
    // Top locations
    const topLocations = db.prepare(`SELECT location, COUNT(*) as count FROM field_interviews WHERE archived_at IS NULL AND location IS NOT NULL GROUP BY location ORDER BY count DESC LIMIT 10`).all() as any[];
    res.json({ data: { total_active: totalActive, by_reason: Object.fromEntries(byReason.map((r: any) => [r.contact_reason, r.count])), by_action: Object.fromEntries(byAction.map((r: any) => [r.action_taken, r.count])), by_officer: byOfficer, this_week: thisWeek, this_month: thisMonth, top_locations: topLocations } });
  } catch (err: any) { console.error('[FieldInterviews] Stats error:', err?.message); res.status(500).json({ error: 'Failed to get stats', code: 'FI_STATS_ERROR' }); }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 32: FI Data Completeness
// ════════════════════════════════════════════════════════════
router.get('/:id/completeness', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const fi = db.prepare('SELECT * FROM field_interviews WHERE id = ?').get(req.params.id) as any;
    if (!fi) { res.status(404).json({ error: 'Field interview not found', code: 'NOT_FOUND' }); return; }
    const requiredFields = ['location', 'contact_reason'];
    const recommendedFields = ['subject_first_name', 'subject_last_name', 'subject_dob', 'subject_gender', 'subject_race', 'subject_description', 'narrative', 'latitude', 'longitude', 'vehicle_plate'];
    const filledRequired = requiredFields.filter(f => fi[f] != null && String(fi[f]).trim() !== '').length;
    const filledRecommended = recommendedFields.filter(f => fi[f] != null && String(fi[f]).trim() !== '').length;
    const score = Math.round(((filledRequired / requiredFields.length) * 40 + (filledRecommended / recommendedFields.length) * 60));
    res.json({ data: { fi_id: fi.id, score, grade: score >= 80 ? 'A' : score >= 60 ? 'B' : score >= 40 ? 'C' : 'D', missing_required: requiredFields.filter(f => !fi[f] || String(fi[f]).trim() === ''), missing_recommended: recommendedFields.filter(f => !fi[f] || String(fi[f]).trim() === '') } });
  } catch (err: any) { console.error('[FieldInterviews] Completeness error:', err?.message); res.status(500).json({ error: 'Failed to get completeness', code: 'FI_COMPLETENESS_ERROR' }); }
});

export default router;

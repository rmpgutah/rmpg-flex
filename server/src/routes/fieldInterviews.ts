import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { auditLog } from '../utils/auditLogger';
import { localNow, localToday } from '../utils/timeUtils';
import { broadcast } from '../utils/websocket';

const router = Router();
router.use(authenticateToken);

/** Generate next FI number: FI-YY-NNNNN */
function generateFiNumber(db: ReturnType<typeof getDb>): string {
  const yy = String(new Date().getFullYear()).slice(-2);
  const prefix = `FI-${yy}-`;
  const row = db.prepare(
    `SELECT fi_number FROM field_interviews WHERE fi_number LIKE ? ORDER BY id DESC LIMIT 1`
  ).get(`${prefix}%`) as { fi_number: string } | undefined;

  let seq = 1;
  if (row) {
    const parts = row.fi_number.split('-');
    const parsed = parseInt(parts[2], 10);
    seq = isNaN(parsed) ? 1 : parsed + 1;
  }
  return `${prefix}${String(seq).padStart(5, '0')}`;
}

// ─── GET / — List field interviews (paginated, filterable) ───
router.get('/', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const {
      page = '1', per_page = '50',
      officer_id, person_id, date_from, date_to,
      disposition, contact_reason, archived, search,
    } = req.query;

    let where = 'WHERE 1=1';
    const params: any[] = [];

    if (officer_id) { where += ' AND fi.officer_id = ?'; params.push(officer_id); }
    if (person_id) { where += ' AND fi.person_id = ?'; params.push(person_id); }
    if (date_from) { where += ' AND fi.date >= ?'; params.push(date_from); }
    if (date_to) { where += ' AND fi.date <= ?'; params.push(date_to); }
    if (disposition) { where += ' AND fi.disposition = ?'; params.push(disposition); }
    // contact_reason maps to the reason DB column
    if (contact_reason) { where += ' AND fi.contact_reason = ?'; params.push(contact_reason); }
    // archived filter
    if (archived === 'true') { where += ' AND fi.archived_at IS NOT NULL'; }
    else { where += ' AND fi.archived_at IS NULL'; }
    if (search) {
      where += ' AND (fi.location LIKE ? OR fi.narrative LIKE ? OR fi.subject_first_name LIKE ? OR fi.subject_last_name LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const perPage = Math.max(1, parseInt(per_page as string, 10) || 50);
    const offset = (pageNum - 1) * perPage;

    const countRow = db.prepare(
      `SELECT COUNT(*) as total FROM field_interviews fi ${where}`
    ).get(...params) as any;

    const rows = db.prepare(`
      SELECT fi.*,
        p.first_name as person_first_name, p.last_name as person_last_name,
        u.full_name as officer_name
      FROM field_interviews fi
      LEFT JOIN persons p ON fi.person_id = p.id
      LEFT JOIN users u ON fi.officer_id = u.id
      ${where}
      ORDER BY fi.date DESC, fi.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, perPage, offset);

    res.json({
      data: rows,
      pagination: {
        page: pageNum,
        per_page: perPage,
        total: countRow.total,
        totalPages: Math.ceil(countRow.total / perPage),
      },
    });
  } catch (err: any) {
    console.error('[FieldInterviews] List error:', err?.message);
    res.status(500).json({ error: 'Failed to list field interviews', code: 'LIST_FI_ERROR' });
  }
});

// ─── GET /stats — Aggregate statistics ───────────────────────
router.get('/stats', (req: Request, res: Response) => {
  try {
    const db = getDb();

    const totalCount = (db.prepare(
      `SELECT COUNT(*) as count FROM field_interviews`
    ).get() as any).count;

    const byDisposition = db.prepare(
      `SELECT disposition, COUNT(*) as count FROM field_interviews
       WHERE disposition IS NOT NULL
       GROUP BY disposition ORDER BY count DESC`
    ).all();

    const byOfficer = db.prepare(
      `SELECT fi.officer_id, u.full_name as officer_name, COUNT(*) as count
       FROM field_interviews fi
       LEFT JOIN users u ON fi.officer_id = u.id
       WHERE fi.officer_id IS NOT NULL
       GROUP BY fi.officer_id ORDER BY count DESC LIMIT 10`
    ).all();

    const byReason = db.prepare(
      `SELECT contact_reason as reason, COUNT(*) as count FROM field_interviews
       WHERE contact_reason IS NOT NULL
       GROUP BY contact_reason ORDER BY count DESC LIMIT 10`
    ).all();

    const thisWeek = (db.prepare(
      `SELECT COUNT(*) as count FROM field_interviews
       WHERE created_at >= datetime('now', '-7 days', 'localtime')`
    ).get() as any).count;

    const thisMonth = (db.prepare(
      `SELECT COUNT(*) as count FROM field_interviews
       WHERE created_at >= datetime('now', 'start of month', 'localtime')`
    ).get() as any).count;

    res.json({
      total: totalCount,
      by_disposition: byDisposition,
      by_officer: byOfficer,
      by_reason: byReason,
      this_week: thisWeek,
      this_month: thisMonth,
    });
  } catch (err: any) {
    console.error('[FieldInterviews] Stats error:', err?.message);
    res.status(500).json({ error: 'Failed to get stats', code: 'FI_STATS_ERROR' });
  }
});

// ─── GET /by-person/:personId — All FIs for a person ─────────
router.get('/by-person/:personId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const personId = parseInt(req.params.personId as string, 10);
    if (isNaN(personId)) {
      res.status(400).json({ error: 'Invalid person ID', code: 'INVALID_PERSON_ID' });
      return;
    }

    const rows = db.prepare(`
      SELECT fi.*,
        u.full_name as officer_name
      FROM field_interviews fi
      LEFT JOIN users u ON fi.officer_id = u.id
      WHERE fi.person_id = ?
      ORDER BY fi.date DESC
    `).all(personId);

    res.json({ data: rows });
  } catch (err: any) {
    console.error('[FieldInterviews] By-person error:', err?.message);
    res.status(500).json({ error: 'Failed to get field interviews for person', code: 'BY_PERSON_FI_ERROR' });
  }
});

// ─── GET /by-location — Haversine radius search ─────────────
router.get('/by-location', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const lat = parseFloat(req.query.lat as string);
    const lng = parseFloat(req.query.lng as string);
    const radiusMiles = parseFloat(req.query.radius_miles as string) || 1.0;

    if (isNaN(lat) || isNaN(lng)) {
      res.status(400).json({ error: 'lat and lng are required', code: 'MISSING_COORDS' });
      return;
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      res.status(400).json({ error: 'Invalid coordinates', code: 'INVALID_COORDS' });
      return;
    }

    // Haversine formula in SQL (result in miles)
    // 3959 = Earth radius in miles
    const rows = db.prepare(`
      SELECT fi.*,
        u.full_name as officer_name,
        p.first_name as person_first_name, p.last_name as person_last_name,
        (3959 * acos(
          cos(radians(?)) * cos(radians(fi.latitude)) *
          cos(radians(fi.longitude) - radians(?)) +
          sin(radians(?)) * sin(radians(fi.latitude))
        )) AS distance_miles
      FROM field_interviews fi
      LEFT JOIN users u ON fi.officer_id = u.id
      LEFT JOIN persons p ON fi.person_id = p.id
      WHERE fi.latitude IS NOT NULL AND fi.longitude IS NOT NULL
        AND fi.latitude BETWEEN ? AND ?
        AND fi.longitude BETWEEN ? AND ?
      HAVING distance_miles <= ?
      ORDER BY distance_miles ASC
      LIMIT 200
    `).all(
      lat, lng, lat,
      lat - (radiusMiles / 69.0), lat + (radiusMiles / 69.0),
      lng - (radiusMiles / (69.0 * Math.cos(lat * Math.PI / 180))),
      lng + (radiusMiles / (69.0 * Math.cos(lat * Math.PI / 180))),
      radiusMiles,
    );

    res.json({ data: rows });
  } catch (err: any) {
    // SQLite may not have radians/acos -- fall back to bounding-box only
    if (err?.message?.includes('no such function')) {
      try {
        const db = getDb();
        const lat = parseFloat(req.query.lat as string);
        const lng = parseFloat(req.query.lng as string);
        const radiusMiles = parseFloat(req.query.radius_miles as string) || 1.0;

        const rows = db.prepare(`
          SELECT fi.*,
            fi.location_address as location,
            fi.reason as contact_reason,
            fi.disposition as action_taken,
            u.full_name as officer_name,
            p.first_name as person_first_name, p.last_name as person_last_name
          FROM field_interviews fi
          LEFT JOIN users u ON fi.officer_id = u.id
          LEFT JOIN persons p ON fi.person_id = p.id
          WHERE fi.latitude IS NOT NULL AND fi.longitude IS NOT NULL
            AND fi.latitude BETWEEN ? AND ?
            AND fi.longitude BETWEEN ? AND ?
          ORDER BY fi.date DESC
          LIMIT 200
        `).all(
          lat - (radiusMiles / 69.0), lat + (radiusMiles / 69.0),
          lng - (radiusMiles / (69.0 * Math.cos(lat * Math.PI / 180))),
          lng + (radiusMiles / (69.0 * Math.cos(lat * Math.PI / 180))),
        );

        res.json({ data: rows });
      } catch (fallbackErr: any) {
        console.error('[FieldInterviews] By-location fallback error:', fallbackErr?.message);
        res.status(500).json({ error: 'Failed to search by location', code: 'BY_LOCATION_FI_ERROR' });
      }
      return;
    }
    console.error('[FieldInterviews] By-location error:', err?.message);
    res.status(500).json({ error: 'Failed to search by location', code: 'BY_LOCATION_FI_ERROR' });
  }
});

// ─── GET /:id — Single FI with JOINed details ───────────────
router.get('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: 'Invalid field interview ID', code: 'INVALID_FI_ID' });
      return;
    }

    const row = db.prepare(`
      SELECT fi.*,
        p.first_name as person_first_name, p.last_name as person_last_name,
        p.dob as person_dob, p.phone as person_phone,
        u.full_name as officer_name, u.badge_number as officer_badge,
        v.plate_number as vehicle_plate, v.make as vehicle_make,
        v.model as vehicle_model, v.color as vehicle_color, v.year as vehicle_year
      FROM field_interviews fi
      LEFT JOIN persons p ON fi.person_id = p.id
      LEFT JOIN users u ON fi.officer_id = u.id
      LEFT JOIN vehicles_records v ON fi.vehicle_id = v.id
      WHERE fi.id = ?
    `).get(id);

    if (!row) {
      res.status(404).json({ error: 'Field interview not found', code: 'FI_NOT_FOUND' });
      return;
    }

    res.json({ data: row });
  } catch (err: any) {
    console.error('[FieldInterviews] Get error:', err?.message);
    res.status(500).json({ error: 'Failed to get field interview', code: 'GET_FI_ERROR' });
  }
});

// ─── POST / — Create field interview ─────────────────────────
router.post('/', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = req.user!;
    const fi_number = generateFiNumber(db);
    const now = localNow();

    // Accept both old (location, contact_reason, action_taken) and new (location_address, reason, disposition) field names
    const {
      date, person_id, vehicle_id,
      location, location_address, latitude, longitude,
      contact_reason, reason, contact_type,
      action_taken, disposition, narrative,
      subject_first_name, subject_last_name, subject_dob,
      subject_gender, subject_race, subject_height, subject_weight,
      subject_hair, subject_eye, subject_clothing, subject_description,
      vehicle_plate, vehicle_description,
      gang_affiliation, associated_call_id, associated_incident_id,
      // District/beat association — previously silent-dropped (audit 2026-04-11)
      // Form sends these so map layers and geofence reports can locate FIs.
      section_id, zone_id, beat_id, zone_beat,
    } = req.body;

    // Resolve field name aliases
    const resolvedLocation = location || location_address || null;
    const resolvedReason = contact_reason || reason || 'other';
    const resolvedAction = action_taken || disposition || 'none';
    const resolvedContactType = contact_type || 'field';

    if (!date) {
      res.status(400).json({ error: 'date is required', code: 'MISSING_DATE' });
      return;
    }

    // Validate person_id exists if provided
    if (person_id) {
      const personExists = db.prepare('SELECT id FROM persons WHERE id = ?').get(person_id);
      if (!personExists) {
        res.status(400).json({ error: 'Person not found', code: 'PERSON_NOT_FOUND' });
        return;
      }
    }

    const result = db.prepare(`
      INSERT INTO field_interviews (
        fi_number, date, officer_id, person_id, vehicle_id,
        location, latitude, longitude,
        contact_reason, contact_type, action_taken, narrative,
        subject_first_name, subject_last_name, subject_dob,
        subject_gender, subject_race, subject_height, subject_weight,
        subject_hair, subject_eye, subject_clothing, subject_description,
        vehicle_plate, vehicle_description,
        gang_affiliation, associated_call_id, associated_incident_id,
        section_id, zone_id, beat_id, zone_beat,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      fi_number, date, user.userId, person_id || null, vehicle_id || null,
      resolvedLocation, latitude || null, longitude || null,
      resolvedReason, resolvedContactType, resolvedAction, narrative || null,
      subject_first_name || null, subject_last_name || null, subject_dob || null,
      subject_gender || null, subject_race || null, subject_height || null, subject_weight || null,
      subject_hair || null, subject_eye || null, subject_clothing || null, subject_description || null,
      vehicle_plate || null, vehicle_description || null,
      gang_affiliation || null, associated_call_id || null, associated_incident_id || null,
      section_id || null, zone_id || null, beat_id || null, zone_beat || null,
      now, now,
    );

    const newId = result.lastInsertRowid as number;

    // Update person.fi_count and last_fi_date if linked
    if (person_id) {
      try {
        db.prepare(`
          UPDATE persons SET
            fi_count = COALESCE(fi_count, 0) + 1,
            last_fi_date = ?
          WHERE id = ?
        `).run(now, person_id);
      } catch { /* fi_count/last_fi_date columns may not exist */ }
    }

    const created = db.prepare('SELECT * FROM field_interviews WHERE id = ?').get(newId);
    auditLog(req, 'CREATE', 'field_interview', newId, `Created field interview ${fi_number}`);
    broadcast('alerts', 'fi_created', created);
    res.status(201).json({ data: created });
  } catch (err: any) {
    console.error('[FieldInterviews] Create error:', err?.message);
    res.status(500).json({ error: 'Failed to create field interview', code: 'CREATE_FI_ERROR' });
  }
});

// ─── PUT /:id — Update field interview ───────────────────────
router.put('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: 'Invalid field interview ID', code: 'INVALID_FI_ID' });
      return;
    }

    const existing = db.prepare('SELECT id FROM field_interviews WHERE id = ?').get(id);
    if (!existing) {
      res.status(404).json({ error: 'Field interview not found', code: 'FI_NOT_FOUND' });
      return;
    }

    // Map body field names → DB column names (accept both old and new naming conventions)
    const fieldMap: Record<string, string> = {
      date: 'date',
      person_id: 'person_id',
      vehicle_id: 'vehicle_id',
      location: 'location',
      location_address: 'location', // alias
      latitude: 'latitude',
      longitude: 'longitude',
      contact_reason: 'contact_reason',
      reason: 'contact_reason', // alias
      contact_type: 'contact_type',
      action_taken: 'action_taken',
      disposition: 'action_taken', // alias
      narrative: 'narrative',
      subject_first_name: 'subject_first_name',
      subject_last_name: 'subject_last_name',
      subject_dob: 'subject_dob',
      subject_gender: 'subject_gender',
      subject_race: 'subject_race',
      subject_height: 'subject_height',
      subject_weight: 'subject_weight',
      subject_hair: 'subject_hair',
      subject_eye: 'subject_eye',
      subject_clothing: 'subject_clothing',
      subject_description: 'subject_description',
      vehicle_plate: 'vehicle_plate',
      vehicle_description: 'vehicle_description',
      gang_affiliation: 'gang_affiliation',
      associated_call_id: 'associated_call_id',
      associated_incident_id: 'associated_incident_id',
      // District/beat — previously dropped on edit (audit 2026-04-11)
      section_id: 'section_id',
      zone_id: 'zone_id',
      beat_id: 'beat_id',
      zone_beat: 'zone_beat',
    };

    const setClauses: string[] = [];
    const values: any[] = [];

    for (const [bodyKey, dbCol] of Object.entries(fieldMap)) {
      if (req.body[bodyKey] !== undefined) {
        setClauses.push(`${dbCol} = ?`);
        values.push(req.body[bodyKey] ?? null);
      }
    }

    if (setClauses.length === 0) {
      res.status(400).json({ error: 'No fields to update', code: 'NO_FIELDS' });
      return;
    }

    setClauses.push('updated_at = ?');
    values.push(localNow());
    values.push(id);

    db.prepare(
      `UPDATE field_interviews SET ${setClauses.join(', ')} WHERE id = ?`
    ).run(...values);

    const updated = db.prepare('SELECT * FROM field_interviews WHERE id = ?').get(id);
    auditLog(req, 'UPDATE', 'field_interview', id, `Updated field interview #${id}`);
    broadcast('alerts', 'fi_updated', updated);
    res.json({ data: updated });
  } catch (err: any) {
    console.error('[FieldInterviews] Update error:', err?.message);
    res.status(500).json({ error: 'Failed to update field interview', code: 'UPDATE_FI_ERROR' });
  }
});

// ─── DELETE /:id — Delete field interview (admin/manager only) ──
router.delete('/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: 'Invalid field interview ID', code: 'INVALID_FI_ID' });
      return;
    }

    const existing = db.prepare('SELECT id, fi_number, person_id FROM field_interviews WHERE id = ?').get(id) as any;
    if (!existing) {
      res.status(404).json({ error: 'Field interview not found', code: 'FI_NOT_FOUND' });
      return;
    }

    // Decrement person.fi_count if linked
    if (existing.person_id) {
      try {
        db.prepare(`
          UPDATE persons SET fi_count = MAX(0, COALESCE(fi_count, 0) - 1)
          WHERE id = ?
        `).run(existing.person_id);
      } catch { /* fi_count column may not exist */ }
    }

    db.prepare('DELETE FROM field_interviews WHERE id = ?').run(id);
    auditLog(req, 'DELETE', 'field_interview', id, `Deleted field interview ${existing.fi_number}`);
    broadcast('alerts', 'fi_deleted', { id });
    res.json({ success: true });
  } catch (err: any) {
    console.error('[FieldInterviews] Delete error:', err?.message);
    res.status(500).json({ error: 'Failed to delete field interview', code: 'DELETE_FI_ERROR' });
  }
});

// GET /api/field-interviews/export/csv — CSV export
router.get('/export/csv', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT fi.fi_number, fi.subject_first_name, fi.subject_last_name, fi.subject_dob,
             fi.location,
             fi.latitude, fi.longitude,
             fi.contact_reason AS reason,
             fi.action_taken AS disposition,
             fi.status,
             u.full_name AS officer_name,
             fi.narrative AS notes,
             fi.created_at
      FROM field_interviews fi
      LEFT JOIN users u ON fi.officer_id = u.id
      ORDER BY fi.created_at DESC
      LIMIT 10000
    `).all() as any[];
    const headers = ['FI #', 'First Name', 'Last Name', 'DOB', 'Location', 'Latitude', 'Longitude', 'Reason', 'Disposition', 'Status', 'Officer', 'Notes', 'Created'];
    const csvRows = rows.map((r: any) => [
      r.fi_number, r.subject_first_name, r.subject_last_name, r.subject_dob,
      (r.location || '').replace(/"/g, '""'), r.latitude, r.longitude,
      (r.reason || '').replace(/"/g, '""'), r.disposition, r.status,
      r.officer_name, (r.notes || '').replace(/"/g, '""'),
      r.created_at,
    ]);
    const csv = [headers.join(','), ...csvRows.map((r: any[]) => r.map(v => `"${v || ''}"`).join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="field_interviews_${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  } catch (err: any) {
    console.error('[FieldInterviews] Export error:', err?.message);
    res.status(500).json({ error: 'Failed to export', code: 'EXPORT_FI_ERROR' });
  }
});

export default router;

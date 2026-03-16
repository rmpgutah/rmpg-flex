import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { broadcast } from '../utils/websocket';
import { localNow, localToday } from '../utils/timeUtils';
import { createNotificationForRoles } from './notifications';
import { resolveDistrict } from '../utils/districtResolver';
import { escapeLike, validateParamId } from '../middleware/sanitize';
import { auditLog } from '../utils/auditLogger';

const router = Router();
router.use(authenticateToken);

// Validate :id params as positive integers
router.param('id', (req: Request, res: Response, next) => {
  const raw = String(req.params.id);
  const n = parseInt(raw, 10);
  if (isNaN(n) || n < 1 || String(n) !== raw) {
    res.status(400).json({ error: 'Invalid ID parameter' });
    return;
  }
  next();
});

/** Generate next FI number: FI-YYYY-NNNN */
/** Generate FI number — wrapped in transaction to prevent race conditions */
function generateFiNumber(db: ReturnType<typeof getDb>): string {
  const year = parseInt(localToday().slice(0, 4), 10);
  const prefix = `FI-${year}-`;
  return db.transaction(() => {
    const row = db.prepare(
      `SELECT fi_number FROM field_interviews WHERE fi_number LIKE ? ORDER BY id DESC LIMIT 1`
    ).get(`${prefix}%`) as { fi_number: string } | undefined;

    let seq = 1;
    if (row) {
      const parts = row.fi_number.split('-');
      const parsed = parts.length >= 3 ? parseInt(parts[2], 10) : 0;
      seq = (isNaN(parsed) ? 0 : parsed) + 1;
    }
    return `${prefix}${String(seq).padStart(4, '0')}`;
  })();
}

// GET / — List field interviews
router.get('/', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { status, officer_id, search, archived, page = '1', per_page = '50' } = req.query;

    let where = 'WHERE 1=1';
    const params: any[] = [];

    if (status) { where += ' AND fi.status = ?'; params.push(status); }
    if (officer_id) { where += ' AND fi.officer_id = ?'; params.push(officer_id); }
    if (search) {
      where += ` AND ((fi.subject_first_name || ' ' || fi.subject_last_name) LIKE ? ESCAPE '\\' OR fi.fi_number LIKE ? ESCAPE '\\' OR fi.location LIKE ? ESCAPE '\\' OR fi.narrative LIKE ? ESCAPE '\\')`;
      const s = `%${escapeLike(String(search))}%`;
      params.push(s, s, s, s);
    }
    if (archived === 'true') {
      where += ' AND fi.archived_at IS NOT NULL';
    } else if (archived !== 'all') {
      where += ' AND fi.archived_at IS NULL';
    }

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const perPage = Math.min(200, Math.max(1, parseInt(per_page as string, 10) || 25));
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

    const total = countRow?.total ?? 0;
    res.json({
      data: rows,
      pagination: { page: pageNum, per_page: perPage, total, totalPages: Math.ceil(total / perPage) },
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /:id — Single FI detail
router.get('/:id', validateParamId, requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const row = db.prepare(`
      SELECT fi.*, u.full_name as officer_display_name,
        p.first_name as linked_person_first, p.last_name as linked_person_last
      FROM field_interviews fi
      LEFT JOIN users u ON fi.officer_id = u.id
      LEFT JOIN persons p ON fi.person_id = p.id
      WHERE fi.id = ?
    `).get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Field interview not found' });
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST / — Create new FI
router.post('/', requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
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

    if (!location) return res.status(400).json({ error: 'Location is required' });

    // Auto-fill Section/Zone/Beat from coordinates
    let { section_id, zone_id, beat_id, zone_beat } = req.body;
    if (latitude != null && longitude != null && !section_id && !zone_id && !beat_id) {
      const district = resolveDistrict(Number(latitude), Number(longitude));
      if (district) {
        section_id = district.section_id;
        zone_id = district.zone_id;
        beat_id = district.beat_id;
        zone_beat = district.zone_beat;
      }
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
        officer_id, officer_name, status,
        section_id, zone_id, beat_id, zone_beat,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)
    `).run(
      fi_number, person_id || null, subject_first_name, subject_last_name, subject_dob,
      subject_gender, subject_race, subject_height, subject_weight,
      subject_hair, subject_eye, subject_clothing, subject_description,
      location, latitude ?? null, longitude ?? null, property_id || null,
      contact_reason, contact_type, action_taken,
      narrative, vehicle_plate, vehicle_description, vehicle_id || null,
      associated_call_id || null, associated_incident_id || null,
      user.userId, user.fullName,
      section_id || null, zone_id || null, beat_id || null, zone_beat || null,
      now
    );

    const created = db.prepare('SELECT * FROM field_interviews WHERE id = ?').get(result.lastInsertRowid) as any;
    if (!created) { res.status(500).json({ error: 'Failed to retrieve created field interview' }); return; }
    // Broadcast minimal payload — no subject PII over WebSocket
    if (created.fi_number) {
      broadcast('alerts', 'fi_created', {
        id: created.id,
        fi_number: created.fi_number,
        officer_id: created.officer_id,
        location: created.location,
        status: created.status,
      });
    }

    // Notify supervisors of new field interview
    createNotificationForRoles(
      ['admin', 'manager', 'supervisor'],
      'field_interview', `Field Interview: ${created.fi_number}`,
      `FI recorded at ${created.location || 'unknown location'}`,
      'field_interview', created.id, 'normal', 'fi.created', req.user!.userId,
    );

    auditLog(req, 'CREATE', 'field_interview', created.id, `Created field interview ${created.fi_number}`);

    res.status(201).json(created);
  } catch (err: any) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /:id — Update FI
router.put('/:id', validateParamId, requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT id FROM field_interviews WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Field interview not found' });

    const fields = [
      'person_id', 'subject_first_name', 'subject_last_name', 'subject_dob',
      'subject_gender', 'subject_race', 'subject_height', 'subject_weight',
      'subject_hair', 'subject_eye', 'subject_clothing', 'subject_description',
      'location', 'latitude', 'longitude', 'property_id',
      'contact_reason', 'contact_type', 'action_taken',
      'narrative', 'vehicle_plate', 'vehicle_description', 'vehicle_id',
      'associated_call_id', 'associated_incident_id',
      'status', 'section_id', 'zone_id', 'beat_id', 'zone_beat',
    ];

    // Auto-fill S/Z/B when coordinates are updated
    if (req.body.latitude != null && req.body.longitude != null && !req.body.section_id) {
      const district = resolveDistrict(Number(req.body.latitude), Number(req.body.longitude));
      if (district) {
        req.body.section_id = district.section_id;
        req.body.zone_id = district.zone_id;
        req.body.beat_id = district.beat_id;
        req.body.zone_beat = district.zone_beat;
      }
    }

    const setClauses: string[] = [];
    const params: any[] = [];
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        setClauses.push(`${f} = ?`);
        params.push(req.body[f] ?? null);
      }
    }
    if (setClauses.length === 0) return res.status(400).json({ error: 'No fields to update' });

    params.push(req.params.id);
    db.prepare(`UPDATE field_interviews SET ${setClauses.join(', ')} WHERE id = ?`).run(...params);

    const updated = db.prepare('SELECT * FROM field_interviews WHERE id = ?').get(req.params.id) as any;
    // Broadcast minimal payload — no subject PII over WebSocket
    broadcast('alerts', 'fi_updated', {
      id: updated.id,
      fi_number: updated.fi_number,
      officer_id: updated.officer_id,
      location: updated.location,
      status: updated.status,
    });
    auditLog(req, 'UPDATE', 'field_interview', Number(req.params.id), `Updated field interview #${req.params.id}`);

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /:id/archive
router.post('/:id/archive', validateParamId, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT id FROM field_interviews WHERE id = ?').get(req.params.id);
    if (!existing) { res.status(404).json({ error: 'Field interview not found' }); return; }
    db.prepare(`UPDATE field_interviews SET status = 'archived', archived_at = ? WHERE id = ?`).run(localNow(), req.params.id);
    auditLog(req, 'UPDATE', 'field_interview', Number(req.params.id), `Archived field interview #${req.params.id}`);

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /:id/unarchive
router.post('/:id/unarchive', validateParamId, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT id FROM field_interviews WHERE id = ?').get(req.params.id);
    if (!existing) { res.status(404).json({ error: 'Field interview not found' }); return; }
    db.prepare(`UPDATE field_interviews SET status = 'active', archived_at = NULL WHERE id = ?`).run(req.params.id);
    auditLog(req, 'UPDATE', 'field_interview', Number(req.params.id), `Unarchived field interview #${req.params.id}`);

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /:id — Soft delete (archive)
router.delete('/:id', validateParamId, requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT id FROM field_interviews WHERE id = ?').get(req.params.id);
    if (!existing) { res.status(404).json({ error: 'Field interview not found' }); return; }
    db.prepare(`UPDATE field_interviews SET status = 'archived', archived_at = ? WHERE id = ?`).run(localNow(), req.params.id);
    auditLog(req, 'DELETE', 'field_interview', Number(req.params.id), `Deleted field interview #${req.params.id}`);

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

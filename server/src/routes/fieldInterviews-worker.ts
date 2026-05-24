// Field Interview routes for Workers
import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { D1Db, paramNum } from '../worker-middleware/d1Helpers';
import { localNow } from '../worker-middleware/timeUtils';

export function mountFieldInterviewRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  async function generateFiNumber(db: D1Db): Promise<string> {
    const yy = String(new Date().getFullYear()).slice(-2);
    const prefix = `FI-${yy}-`;
    const row = await db.prepare('SELECT fi_number FROM field_interviews WHERE fi_number LIKE ? ORDER BY id DESC LIMIT 1').get(`${prefix}%`) as { fi_number: string } | undefined;
    let seq = 1;
    if (row) {
      const parts = row.fi_number.split('-');
      const parsed = parseInt(parts[2], 10);
      seq = isNaN(parsed) ? 1 : parsed + 1;
    }
    return `${prefix}${String(seq).padStart(5, '0')}`;
  }

  // GET /
  api.get('/', async (c) => {
    const db = new D1Db(c.env.DB);
    const q = c.req.query();
    const { page = '1', per_page = '100000', officer_id, person_id, date_from, date_to, disposition, contact_reason, archived, search } = q;

    let where = 'WHERE 1=1';
    const params: any[] = [];
    if (officer_id) { where += ' AND fi.officer_id = ?'; params.push(officer_id); }
    if (person_id) { where += ' AND fi.person_id = ?'; params.push(person_id); }
    if (date_from) { where += ' AND fi.date >= ?'; params.push(date_from); }
    if (date_to) { where += ' AND fi.date <= ?'; params.push(date_to); }
    if (disposition) { where += ' AND fi.disposition = ?'; params.push(disposition); }
    if (contact_reason) { where += ' AND fi.contact_reason = ?'; params.push(contact_reason); }
    if (archived === 'true') { where += ' AND fi.archived_at IS NOT NULL'; }
    else { where += ' AND fi.archived_at IS NULL'; }
    if (search) {
      where += ' AND (fi.location LIKE ? OR fi.narrative LIKE ? OR fi.subject_first_name LIKE ? OR fi.subject_last_name LIKE ?)';
      const s = `%${search}%`; params.push(s, s, s, s);
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const perPage = Math.min(100000, Math.max(1, parseInt(per_page, 10) || 100000));
    const offset = (pageNum - 1) * perPage;

    const countRow = await db.prepare(`SELECT COUNT(*) as total FROM field_interviews fi ${where}`).get(...params) as any;
    const rows = await db.prepare(`
      SELECT fi.*, p.first_name as person_first_name, p.last_name as person_last_name,
        u.full_name as officer_name
      FROM field_interviews fi
      LEFT JOIN persons p ON fi.person_id = p.id
      LEFT JOIN users u ON fi.officer_id = u.id
      ${where}
      ORDER BY fi.date DESC, fi.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, perPage, offset);

    return c.json({ data: rows, pagination: { page: pageNum, per_page: perPage, total: countRow.total, totalPages: Math.ceil(countRow.total / perPage) } });
  });

  // GET /stats
  api.get('/stats', async (c) => {
    const db = new D1Db(c.env.DB);
    const totalCount = (await db.prepare('SELECT COUNT(*) as count FROM field_interviews').get() as any).count;
    const byDisposition = await db.prepare('SELECT disposition, COUNT(*) as count FROM field_interviews WHERE disposition IS NOT NULL GROUP BY disposition ORDER BY count DESC').all();
    const byOfficer = await db.prepare('SELECT fi.officer_id, u.full_name as officer_name, COUNT(*) as count FROM field_interviews fi LEFT JOIN users u ON fi.officer_id = u.id WHERE fi.officer_id IS NOT NULL GROUP BY fi.officer_id ORDER BY count DESC LIMIT 10').all();
    const byReason = await db.prepare('SELECT contact_reason as reason, COUNT(*) as count FROM field_interviews WHERE contact_reason IS NOT NULL GROUP BY contact_reason ORDER BY count DESC LIMIT 10').all();
    const thisWeek = (await db.prepare("SELECT COUNT(*) as count FROM field_interviews WHERE created_at >= datetime('now', '-7 days', 'localtime')").get() as any).count;
    const thisMonth = (await db.prepare("SELECT COUNT(*) as count FROM field_interviews WHERE created_at >= datetime('now', 'start of month', 'localtime')").get() as any).count;

    return c.json({ total: totalCount, by_disposition: byDisposition, by_officer: byOfficer, by_reason: byReason, this_week: thisWeek, this_month: thisMonth });
  });

  // GET /by-person/:personId
  api.get('/by-person/:personId', async (c) => {
    const db = new D1Db(c.env.DB);
    const personId = paramNum(c.req.param('personId'));
    if (isNaN(personId)) return c.json({ error: 'Invalid person ID', code: 'INVALID_PERSON_ID' }, 400);

    const rows = await db.prepare(`
      SELECT fi.*, u.full_name as officer_name
      FROM field_interviews fi
      LEFT JOIN users u ON fi.officer_id = u.id
      WHERE fi.person_id = ?
      ORDER BY fi.date DESC
    `).all(personId);

    return c.json({ data: rows });
  });

  // GET /by-location
  api.get('/by-location', async (c) => {
    const db = new D1Db(c.env.DB);
    const q = c.req.query();
    const lat = parseFloat(q.lat || '');
    const lng = parseFloat(q.lng || '');
    const radiusMiles = parseFloat(q.radius_miles || '1.0');

    if (isNaN(lat) || isNaN(lng)) return c.json({ error: 'lat and lng are required', code: 'MISSING_COORDS' }, 400);
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return c.json({ error: 'Invalid coordinates', code: 'INVALID_COORDS' }, 400);

    try {
      const rows = await db.prepare(`
        SELECT fi.*, u.full_name as officer_name,
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
        ORDER BY distance_miles ASC LIMIT 200
      `).all(
        lat, lng, lat,
        lat - (radiusMiles / 69.0), lat + (radiusMiles / 69.0),
        lng - (radiusMiles / (69.0 * Math.cos(lat * Math.PI / 180))),
        lng + (radiusMiles / (69.0 * Math.cos(lat * Math.PI / 180))),
        radiusMiles,
      );
      return c.json({ data: rows });
    } catch (err: any) {
      // Fallback: bounding-box only
      try {
        const rows = await db.prepare(`
          SELECT fi.*, fi.location_address as location, fi.reason as contact_reason,
            fi.disposition as action_taken, u.full_name as officer_name,
            p.first_name as person_first_name, p.last_name as person_last_name
          FROM field_interviews fi
          LEFT JOIN users u ON fi.officer_id = u.id
          LEFT JOIN persons p ON fi.person_id = p.id
          WHERE fi.latitude IS NOT NULL AND fi.longitude IS NOT NULL
            AND fi.latitude BETWEEN ? AND ?
            AND fi.longitude BETWEEN ? AND ?
          ORDER BY fi.date DESC LIMIT 200
        `).all(
          lat - (radiusMiles / 69.0), lat + (radiusMiles / 69.0),
          lng - (radiusMiles / (69.0 * Math.cos(lat * Math.PI / 180))),
          lng + (radiusMiles / (69.0 * Math.cos(lat * Math.PI / 180))),
        );
        return c.json({ data: rows });
      } catch (fallbackErr: any) {
        return c.json({ error: 'Failed to search by location', code: 'BY_LOCATION_FI_ERROR' }, 500);
      }
    }
  });

  // GET /:id
  api.get('/:id', async (c) => {
    const db = new D1Db(c.env.DB);
    const id = paramNum(c.req.param('id'));
    if (isNaN(id)) return c.json({ error: 'Invalid field interview ID', code: 'INVALID_FI_ID' }, 400);

    const row = await db.prepare(`
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

    if (!row) return c.json({ error: 'Field interview not found', code: 'FI_NOT_FOUND' }, 404);
    return c.json({ data: row });
  });

  // POST /
  api.post('/', async (c) => {
    const db = new D1Db(c.env.DB);
    const user = c.get('user');
    const fi_number = await generateFiNumber(db);
    const now = localNow();
    const body = await c.req.json();

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
      section_id, zone_id, beat_id, zone_beat,
    } = body;

    const resolvedLocation = location || location_address || null;
    const resolvedReason = contact_reason || reason || 'other';
    const resolvedAction = action_taken || disposition || 'none';
    const resolvedContactType = contact_type || 'field';

    if (!date) return c.json({ error: 'date is required', code: 'MISSING_DATE' }, 400);

    if (person_id) {
      const personExists = await db.prepare('SELECT id FROM persons WHERE id = ?').get(person_id);
      if (!personExists) return c.json({ error: 'Person not found', code: 'PERSON_NOT_FOUND' }, 400);
    }

    const result = await db.prepare(`
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

    const newId = result.meta.last_row_id as number;

    if (person_id) {
      try {
        await db.prepare('UPDATE persons SET fi_count = COALESCE(fi_count, 0) + 1, last_fi_date = ? WHERE id = ?').run(now, person_id);
      } catch { /* columns may not exist */ }
    }

    const created = await db.prepare('SELECT * FROM field_interviews WHERE id = ?').get(newId);
    return c.json({ data: created }, 201);
  });

  // PUT /:id
  api.put('/:id', async (c) => {
    const db = new D1Db(c.env.DB);
    const id = paramNum(c.req.param('id'));
    if (isNaN(id)) return c.json({ error: 'Invalid field interview ID', code: 'INVALID_FI_ID' }, 400);

    const existing = await db.prepare('SELECT id FROM field_interviews WHERE id = ?').get(id);
    if (!existing) return c.json({ error: 'Field interview not found', code: 'FI_NOT_FOUND' }, 404);

    const body = await c.req.json();
    const fieldMap: Record<string, string> = {
      date: 'date', person_id: 'person_id', vehicle_id: 'vehicle_id',
      location: 'location', location_address: 'location',
      latitude: 'latitude', longitude: 'longitude',
      contact_reason: 'contact_reason', reason: 'contact_reason',
      contact_type: 'contact_type', action_taken: 'action_taken',
      disposition: 'action_taken', narrative: 'narrative',
      subject_first_name: 'subject_first_name', subject_last_name: 'subject_last_name',
      subject_dob: 'subject_dob', subject_gender: 'subject_gender',
      subject_race: 'subject_race', subject_height: 'subject_height',
      subject_weight: 'subject_weight', subject_hair: 'subject_hair',
      subject_eye: 'subject_eye', subject_clothing: 'subject_clothing',
      subject_description: 'subject_description', vehicle_plate: 'vehicle_plate',
      vehicle_description: 'vehicle_description', gang_affiliation: 'gang_affiliation',
      associated_call_id: 'associated_call_id', associated_incident_id: 'associated_incident_id',
      section_id: 'section_id', zone_id: 'zone_id', beat_id: 'beat_id', zone_beat: 'zone_beat',
    };

    const setClauses: string[] = [];
    const values: any[] = [];
    for (const [bodyKey, dbCol] of Object.entries(fieldMap)) {
      if (body[bodyKey] !== undefined) {
        // Avoid duplicate SET for aliased fields
        if (bodyKey === 'location_address' && body.location !== undefined) continue;
        if (bodyKey === 'reason' && body.contact_reason !== undefined) continue;
        if (bodyKey === 'disposition' && body.action_taken !== undefined) continue;
        setClauses.push(`${dbCol} = ?`);
        values.push(body[bodyKey] ?? null);
      }
    }

    if (setClauses.length === 0) return c.json({ error: 'No fields to update', code: 'NO_FIELDS' }, 400);

    setClauses.push('updated_at = ?');
    values.push(localNow());
    values.push(id);

    await db.prepare(`UPDATE field_interviews SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);

    const updated = await db.prepare('SELECT * FROM field_interviews WHERE id = ?').get(id);
    return c.json({ data: updated });
  });

  // DELETE /:id
  api.delete('/:id', requireRole('admin', 'manager'), async (c) => {
    const db = new D1Db(c.env.DB);
    const id = paramNum(c.req.param('id'));
    if (isNaN(id)) return c.json({ error: 'Invalid field interview ID', code: 'INVALID_FI_ID' }, 400);

    const existing = await db.prepare('SELECT id, fi_number, person_id FROM field_interviews WHERE id = ?').get(id) as any;
    if (!existing) return c.json({ error: 'Field interview not found', code: 'FI_NOT_FOUND' }, 404);

    if (existing.person_id) {
      try {
        await db.prepare('UPDATE persons SET fi_count = MAX(0, COALESCE(fi_count, 0) - 1) WHERE id = ?').run(existing.person_id);
      } catch { /* fi_count column may not exist */ }
    }

    await db.prepare('DELETE FROM field_interviews WHERE id = ?').run(id);
    return c.json({ success: true });
  });

  // GET /export/csv
  api.get('/export/csv', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    const db = new D1Db(c.env.DB);
    const rows = await db.prepare(`
      SELECT fi.fi_number, fi.subject_first_name, fi.subject_last_name, fi.subject_dob,
             fi.location, fi.latitude, fi.longitude,
             fi.contact_reason AS reason, fi.action_taken AS disposition,
             fi.status, u.full_name AS officer_name,
             fi.narrative AS notes, fi.created_at
      FROM field_interviews fi
      LEFT JOIN users u ON fi.officer_id = u.id
      ORDER BY fi.created_at DESC LIMIT 10000
    `).all() as any[];

    const headers = ['FI #', 'First Name', 'Last Name', 'DOB', 'Location', 'Latitude', 'Longitude', 'Reason', 'Disposition', 'Status', 'Officer', 'Notes', 'Created'];
    const csvRows = rows.map((r: any) => [
      r.fi_number, r.subject_first_name, r.subject_last_name, r.subject_dob,
      (r.location || '').replace(/"/g, '""'), r.latitude, r.longitude,
      (r.reason || '').replace(/"/g, '""'), r.disposition, r.status,
      r.officer_name, (r.notes || '').replace(/"/g, '""'), r.created_at,
    ]);
    const csv = [headers.join(','), ...csvRows.map((r: any[]) => r.map(v => `"${v || ''}"`).join(','))].join('\n');
    c.header('Content-Type', 'text/csv');
    c.header('Content-Disposition', `attachment; filename="field_interviews_${new Date().toISOString().slice(0, 10)}.csv"`);
    return c.body(csv);
  });

  // GET /api/field-interviews/map
  api.get('/map', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const days = Math.max(1, Math.min(365, parseInt(c.req.query('days') || '30', 10) || 30));

      const rows = await db.prepare(`
        SELECT fi.id, fi.fi_number, fi.subject_first_name, fi.subject_last_name,
               fi.latitude, fi.longitude, fi.contact_reason, fi.action_taken,
               u.full_name as officer_name, fi.created_at, fi.location
        FROM field_interviews fi
        LEFT JOIN users u ON fi.officer_id = u.id
        WHERE fi.latitude IS NOT NULL AND fi.longitude IS NOT NULL
          AND fi.created_at >= datetime('now', 'localtime', '-${days} days')
          AND fi.archived_at IS NULL
        ORDER BY fi.created_at DESC
        LIMIT 1000
      `).all() as any[];

      return c.json(rows);
    } catch (err: any) {
      return c.json({ error: 'Failed to get field interviews map data', code: 'GET_FI_MAP_ERROR' }, 500);
    }
  });

  app.route('/api/field-interviews', api);
}

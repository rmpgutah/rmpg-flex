import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { paramStr } from '../utils/reqHelpers';

const router = Router();
router.use(authenticateToken);

// ─── Helpers ────────────────────────────────────────────────────────────────

function generateIncidentNumber(db: ReturnType<typeof getDb>): string {
  const year = new Date().getFullYear();
  const prefix = `FI-${year}-`;
  const row = db.prepare(
    `SELECT incident_number FROM fire_incidents WHERE incident_number LIKE ? ORDER BY id DESC LIMIT 1`
  ).get(`${prefix}%`) as { incident_number: string } | undefined;

  let seq = 1;
  if (row) {
    const parts = row.incident_number.split('-');
    const parsed = parseInt(parts[parts.length - 1], 10);
    seq = isNaN(parsed) ? 1 : parsed + 1;
  }
  return `${prefix}${String(seq).padStart(5, '0')}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// INCIDENTS
// ═══════════════════════════════════════════════════════════════════════════

// GET /incidents — List fire incidents
router.get('/incidents', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { type, status, date_from, date_to, search } = req.query;

    let where = 'WHERE 1=1';
    const params: any[] = [];

    if (type) { where += ' AND fi.incident_type = ?'; params.push(type); }
    if (status) { where += ' AND fi.status = ?'; params.push(status); }
    if (date_from) { where += ' AND fi.incident_date >= ?'; params.push(date_from); }
    if (date_to) { where += ' AND fi.incident_date <= ?'; params.push(date_to); }
    if (search) {
      where += ' AND (fi.incident_number LIKE ? OR fi.location LIKE ? OR fi.description LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s);
    }

    const rows = db.prepare(`
      SELECT fi.*
      FROM fire_incidents fi
      ${where}
      ORDER BY fi.incident_date DESC, fi.created_at DESC
    `).all(...params);

    res.json(rows);
  } catch (err: any) {
    console.error('[FireRMS] List incidents error:', err?.message);
    res.status(500).json({ error: 'Failed to list fire incidents', code: 'FIRE_RMS_ERROR' });
  }
});

// POST /incidents — Create fire incident
router.post('/incidents', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const {
      incident_type, incident_date, incident_time, location, latitude, longitude,
      description, alarm_level, units_dispatched, mutual_aid,
      structure_type, estimated_loss, area_of_origin, cause, status,
    } = req.body;

    if (!incident_type || !location) {
      res.status(400).json({ error: 'incident_type and location are required' });
      return;
    }

    const incident_number = generateIncidentNumber(db);
    const now = new Date().toISOString();

    const result = db.prepare(`
      INSERT INTO fire_incidents (incident_number, incident_type, incident_date, incident_time, location, latitude, longitude, description, alarm_level, units_dispatched, mutual_aid, structure_type, estimated_loss, area_of_origin, cause, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      incident_number, incident_type, incident_date || now, incident_time || null,
      location, latitude || null, longitude || null, description || null,
      alarm_level || 1, units_dispatched || null, mutual_aid ? 1 : 0,
      structure_type || null, estimated_loss || null, area_of_origin || null,
      cause || null, status || 'open', now, now
    );

    res.status(201).json({ success: true, id: result.lastInsertRowid, incident_number });
  } catch (err: any) {
    console.error('[FireRMS] Create incident error:', err?.message);
    res.status(500).json({ error: 'Failed to create fire incident', code: 'FIRE_RMS_ERROR' });
  }
});

// GET /incidents/:id — Single fire incident
router.get('/incidents/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(paramStr(req.params.id), 10);
    const row = db.prepare('SELECT * FROM fire_incidents WHERE id = ?').get(id);
    if (!row) {
      res.status(404).json({ error: 'Fire incident not found' });
      return;
    }
    res.json(row);
  } catch (err: any) {
    console.error('[FireRMS] Get incident error:', err?.message);
    res.status(500).json({ error: 'Failed to get fire incident', code: 'FIRE_RMS_ERROR' });
  }
});

// PUT /incidents/:id — Update fire incident
router.put('/incidents/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(paramStr(req.params.id), 10);
    const {
      incident_type, incident_date, incident_time, location, latitude, longitude,
      description, alarm_level, units_dispatched, mutual_aid,
      structure_type, estimated_loss, area_of_origin, cause, status,
    } = req.body;

    const existing = db.prepare('SELECT id FROM fire_incidents WHERE id = ?').get(id);
    if (!existing) {
      res.status(404).json({ error: 'Fire incident not found' });
      return;
    }

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE fire_incidents SET
        incident_type = COALESCE(?, incident_type), incident_date = COALESCE(?, incident_date),
        incident_time = COALESCE(?, incident_time), location = COALESCE(?, location),
        latitude = COALESCE(?, latitude), longitude = COALESCE(?, longitude),
        description = COALESCE(?, description), alarm_level = COALESCE(?, alarm_level),
        units_dispatched = COALESCE(?, units_dispatched),
        mutual_aid = COALESCE(?, mutual_aid), structure_type = COALESCE(?, structure_type),
        estimated_loss = COALESCE(?, estimated_loss), area_of_origin = COALESCE(?, area_of_origin),
        cause = COALESCE(?, cause), status = COALESCE(?, status), updated_at = ?
      WHERE id = ?
    `).run(
      incident_type || null, incident_date || null, incident_time || null,
      location || null, latitude || null, longitude || null,
      description || null, alarm_level || null, units_dispatched || null,
      mutual_aid != null ? (mutual_aid ? 1 : 0) : null,
      structure_type || null, estimated_loss || null, area_of_origin || null,
      cause || null, status || null, now, id
    );

    const updated = db.prepare('SELECT * FROM fire_incidents WHERE id = ?').get(id);
    res.json(updated);
  } catch (err: any) {
    console.error('[FireRMS] Update incident error:', err?.message);
    res.status(500).json({ error: 'Failed to update fire incident', code: 'FIRE_RMS_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// PREPLANS
// ═══════════════════════════════════════════════════════════════════════════

// GET /preplans — List preplans
router.get('/preplans', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { search, occupancy_type } = req.query;

    let where = 'WHERE 1=1';
    const params: any[] = [];

    if (occupancy_type) { where += ' AND occupancy_type = ?'; params.push(occupancy_type); }
    if (search) {
      where += ' AND (building_name LIKE ? OR address LIKE ? OR contact_name LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s);
    }

    const rows = db.prepare(`SELECT * FROM fire_preplans ${where} ORDER BY building_name`).all(...params);
    res.json(rows);
  } catch (err: any) {
    console.error('[FireRMS] List preplans error:', err?.message);
    res.status(500).json({ error: 'Failed to list preplans', code: 'FIRE_RMS_ERROR' });
  }
});

// POST /preplans — Create preplan
router.post('/preplans', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const {
      building_name, address, latitude, longitude, occupancy_type,
      stories, square_footage, construction_type, sprinkler_system,
      alarm_system, hazardous_materials, contact_name, contact_phone,
      access_notes, water_supply_notes, notes,
    } = req.body;

    if (!building_name || !address) {
      res.status(400).json({ error: 'building_name and address are required' });
      return;
    }

    const now = new Date().toISOString();
    const result = db.prepare(`
      INSERT INTO fire_preplans (building_name, address, latitude, longitude, occupancy_type, stories, square_footage, construction_type, sprinkler_system, alarm_system, hazardous_materials, contact_name, contact_phone, access_notes, water_supply_notes, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      building_name, address, latitude || null, longitude || null,
      occupancy_type || null, stories || null, square_footage || null,
      construction_type || null, sprinkler_system ? 1 : 0, alarm_system ? 1 : 0,
      hazardous_materials || null, contact_name || null, contact_phone || null,
      access_notes || null, water_supply_notes || null, notes || null, now, now
    );

    res.status(201).json({ success: true, id: result.lastInsertRowid });
  } catch (err: any) {
    console.error('[FireRMS] Create preplan error:', err?.message);
    res.status(500).json({ error: 'Failed to create preplan', code: 'FIRE_RMS_ERROR' });
  }
});

// GET /preplans/:id — Single preplan
router.get('/preplans/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(paramStr(req.params.id), 10);
    const row = db.prepare('SELECT * FROM fire_preplans WHERE id = ?').get(id);
    if (!row) {
      res.status(404).json({ error: 'Preplan not found' });
      return;
    }
    res.json(row);
  } catch (err: any) {
    console.error('[FireRMS] Get preplan error:', err?.message);
    res.status(500).json({ error: 'Failed to get preplan', code: 'FIRE_RMS_ERROR' });
  }
});

// PUT /preplans/:id — Update preplan
router.put('/preplans/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(paramStr(req.params.id), 10);
    const {
      building_name, address, latitude, longitude, occupancy_type,
      stories, square_footage, construction_type, sprinkler_system,
      alarm_system, hazardous_materials, contact_name, contact_phone,
      access_notes, water_supply_notes, notes,
    } = req.body;

    const existing = db.prepare('SELECT id FROM fire_preplans WHERE id = ?').get(id);
    if (!existing) {
      res.status(404).json({ error: 'Preplan not found' });
      return;
    }

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE fire_preplans SET
        building_name = COALESCE(?, building_name), address = COALESCE(?, address),
        latitude = COALESCE(?, latitude), longitude = COALESCE(?, longitude),
        occupancy_type = COALESCE(?, occupancy_type), stories = COALESCE(?, stories),
        square_footage = COALESCE(?, square_footage), construction_type = COALESCE(?, construction_type),
        sprinkler_system = COALESCE(?, sprinkler_system), alarm_system = COALESCE(?, alarm_system),
        hazardous_materials = COALESCE(?, hazardous_materials), contact_name = COALESCE(?, contact_name),
        contact_phone = COALESCE(?, contact_phone), access_notes = COALESCE(?, access_notes),
        water_supply_notes = COALESCE(?, water_supply_notes), notes = COALESCE(?, notes), updated_at = ?
      WHERE id = ?
    `).run(
      building_name || null, address || null, latitude || null, longitude || null,
      occupancy_type || null, stories || null, square_footage || null,
      construction_type || null,
      sprinkler_system != null ? (sprinkler_system ? 1 : 0) : null,
      alarm_system != null ? (alarm_system ? 1 : 0) : null,
      hazardous_materials || null, contact_name || null, contact_phone || null,
      access_notes || null, water_supply_notes || null, notes || null, now, id
    );

    const updated = db.prepare('SELECT * FROM fire_preplans WHERE id = ?').get(id);
    res.json(updated);
  } catch (err: any) {
    console.error('[FireRMS] Update preplan error:', err?.message);
    res.status(500).json({ error: 'Failed to update preplan', code: 'FIRE_RMS_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// HYDRANTS
// ═══════════════════════════════════════════════════════════════════════════

// GET /hydrants — List hydrants
router.get('/hydrants', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { status, search } = req.query;

    let where = 'WHERE 1=1';
    const params: any[] = [];

    if (status) { where += ' AND status = ?'; params.push(status); }
    if (search) {
      where += ' AND (hydrant_id LIKE ? OR location LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s);
    }

    const rows = db.prepare(`SELECT * FROM fire_hydrants ${where} ORDER BY hydrant_id`).all(...params);
    res.json(rows);
  } catch (err: any) {
    console.error('[FireRMS] List hydrants error:', err?.message);
    res.status(500).json({ error: 'Failed to list hydrants', code: 'FIRE_RMS_ERROR' });
  }
});

// POST /hydrants — Create hydrant
router.post('/hydrants', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const {
      hydrant_id, location, latitude, longitude, flow_rate,
      hydrant_type, color_code, last_inspected, status, notes,
    } = req.body;

    if (!hydrant_id || !location) {
      res.status(400).json({ error: 'hydrant_id and location are required' });
      return;
    }

    const now = new Date().toISOString();
    const result = db.prepare(`
      INSERT INTO fire_hydrants (hydrant_id, location, latitude, longitude, flow_rate, hydrant_type, color_code, last_inspected, status, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      hydrant_id, location, latitude || null, longitude || null,
      flow_rate || null, hydrant_type || null, color_code || null,
      last_inspected || null, status || 'active', notes || null, now, now
    );

    res.status(201).json({ success: true, id: result.lastInsertRowid });
  } catch (err: any) {
    console.error('[FireRMS] Create hydrant error:', err?.message);
    res.status(500).json({ error: 'Failed to create hydrant', code: 'FIRE_RMS_ERROR' });
  }
});

// GET /hydrants/:id — Single hydrant
router.get('/hydrants/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(paramStr(req.params.id), 10);
    const row = db.prepare('SELECT * FROM fire_hydrants WHERE id = ?').get(id);
    if (!row) {
      res.status(404).json({ error: 'Hydrant not found' });
      return;
    }
    res.json(row);
  } catch (err: any) {
    console.error('[FireRMS] Get hydrant error:', err?.message);
    res.status(500).json({ error: 'Failed to get hydrant', code: 'FIRE_RMS_ERROR' });
  }
});

// PUT /hydrants/:id — Update hydrant
router.put('/hydrants/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(paramStr(req.params.id), 10);
    const {
      hydrant_id: newHydrantId, location, latitude, longitude, flow_rate,
      hydrant_type, color_code, last_inspected, status, notes,
    } = req.body;

    const existing = db.prepare('SELECT id FROM fire_hydrants WHERE id = ?').get(id);
    if (!existing) {
      res.status(404).json({ error: 'Hydrant not found' });
      return;
    }

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE fire_hydrants SET
        hydrant_id = COALESCE(?, hydrant_id), location = COALESCE(?, location),
        latitude = COALESCE(?, latitude), longitude = COALESCE(?, longitude),
        flow_rate = COALESCE(?, flow_rate), hydrant_type = COALESCE(?, hydrant_type),
        color_code = COALESCE(?, color_code), last_inspected = COALESCE(?, last_inspected),
        status = COALESCE(?, status), notes = COALESCE(?, notes), updated_at = ?
      WHERE id = ?
    `).run(
      newHydrantId || null, location || null, latitude || null, longitude || null,
      flow_rate || null, hydrant_type || null, color_code || null,
      last_inspected || null, status || null, notes || null, now, id
    );

    const updated = db.prepare('SELECT * FROM fire_hydrants WHERE id = ?').get(id);
    res.json(updated);
  } catch (err: any) {
    console.error('[FireRMS] Update hydrant error:', err?.message);
    res.status(500).json({ error: 'Failed to update hydrant', code: 'FIRE_RMS_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// STATS
// ═══════════════════════════════════════════════════════════════════════════

// GET /stats — Fire RMS statistics
router.get('/stats', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const totalIncidents = db.prepare('SELECT COUNT(*) as count FROM fire_incidents').get() as any;
    const incidentsByType = db.prepare('SELECT incident_type, COUNT(*) as count FROM fire_incidents GROUP BY incident_type ORDER BY count DESC').all();
    const incidentsByMonth = db.prepare(`
      SELECT strftime('%Y-%m', incident_date) as month, COUNT(*) as count
      FROM fire_incidents WHERE incident_date >= date('now', '-12 months')
      GROUP BY month ORDER BY month
    `).all();
    const totalPreplans = db.prepare('SELECT COUNT(*) as count FROM fire_preplans').get() as any;
    const totalHydrants = db.prepare('SELECT COUNT(*) as count FROM fire_hydrants').get() as any;
    const hydrantsByStatus = db.prepare('SELECT status, COUNT(*) as count FROM fire_hydrants GROUP BY status').all();

    res.json({
      total_incidents: totalIncidents.count,
      incidents_by_type: incidentsByType,
      incidents_by_month: incidentsByMonth,
      total_preplans: totalPreplans.count,
      total_hydrants: totalHydrants.count,
      hydrants_by_status: hydrantsByStatus,
    });
  } catch (err: any) {
    console.error('[FireRMS] Stats error:', err?.message);
    res.status(500).json({ error: 'Failed to get stats', code: 'FIRE_RMS_ERROR' });
  }
});

export default router;

import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { localNow } from '../utils/timeUtils';

const router = Router();
router.use(authenticateToken);

// ─── STATS ───────────────────────────────────────────

router.get('/stats', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const days = parseInt(req.query.days as string) || 365;

    const total = (db.prepare(`
      SELECT COUNT(*) as count FROM vehicle_pursuits WHERE pursuit_date >= date('now', '-${days} days')
    `).get() as any).count;

    const byOutcome = db.prepare(`
      SELECT outcome, COUNT(*) as count FROM vehicle_pursuits
      WHERE pursuit_date >= date('now', '-${days} days') AND outcome IS NOT NULL
      GROUP BY outcome ORDER BY count DESC
    `).all();

    const byReason = db.prepare(`
      SELECT initial_reason, COUNT(*) as count FROM vehicle_pursuits
      WHERE pursuit_date >= date('now', '-${days} days')
      GROUP BY initial_reason ORDER BY count DESC
    `).all();

    const avgSpeed = (db.prepare(`
      SELECT ROUND(AVG(max_speed_mph), 0) as avg_speed FROM vehicle_pursuits
      WHERE max_speed_mph IS NOT NULL AND pursuit_date >= date('now', '-${days} days')
    `).get() as any)?.avg_speed || 0;

    const avgDuration = (db.prepare(`
      SELECT ROUND(AVG(duration_minutes), 1) as avg_dur FROM vehicle_pursuits
      WHERE duration_minutes IS NOT NULL AND pursuit_date >= date('now', '-${days} days')
    `).get() as any)?.avg_dur || 0;

    const injuryRate = (() => {
      const row = db.prepare(`
        SELECT
          SUM(CASE WHEN suspect_injured = 1 OR officer_injured = 1 OR bystander_injured = 1 THEN 1 ELSE 0 END) as injured,
          COUNT(*) as total
        FROM vehicle_pursuits WHERE pursuit_date >= date('now', '-${days} days')
      `).get() as any;
      return row?.total > 0 ? Math.round(100 * row.injured / row.total) : 0;
    })();

    const apprehensionRate = (() => {
      const row = db.prepare(`
        SELECT
          SUM(CASE WHEN outcome IN ('apprehension','suspect_surrendered') THEN 1 ELSE 0 END) as caught,
          COUNT(*) as total
        FROM vehicle_pursuits WHERE outcome IS NOT NULL AND pursuit_date >= date('now', '-${days} days')
      `).get() as any;
      return row?.total > 0 ? Math.round(100 * row.caught / row.total) : 0;
    })();

    const monthly = db.prepare(`
      SELECT strftime('%Y-%m', pursuit_date) as month, COUNT(*) as count
      FROM vehicle_pursuits WHERE pursuit_date >= date('now', '-${days} days')
      GROUP BY month ORDER BY month ASC
    `).all();

    const pendingReview = (db.prepare(`
      SELECT COUNT(*) as count FROM vehicle_pursuits WHERE status IN ('submitted','under_review')
    `).get() as any).count;

    res.json({
      total, byOutcome, byReason, avgSpeed, avgDuration,
      injuryRate, apprehensionRate, monthly, pendingReview,
    });
  } catch (error: any) {
    console.error('Pursuit stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── LIST ────────────────────────────────────────────

router.get('/', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { status, outcome, officer_id, search } = req.query;

    let where = 'WHERE 1=1';
    const params: any[] = [];
    if (status) { where += ' AND p.status = ?'; params.push(status); }
    if (outcome) { where += ' AND p.outcome = ?'; params.push(outcome); }
    if (officer_id) { where += ' AND p.initiating_officer_id = ?'; params.push(officer_id); }
    if (search) {
      where += ' AND (p.pursuit_number LIKE ? OR p.suspect_name LIKE ? OR p.start_location LIKE ? OR p.suspect_vehicle_plate LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }

    const pursuits = db.prepare(`
      SELECT p.*, u.full_name as officer_name, u.badge_number,
             sv.full_name as supervisor_name,
             rv.full_name as reviewed_by_name
      FROM vehicle_pursuits p
      JOIN users u ON p.initiating_officer_id = u.id
      LEFT JOIN users sv ON p.supervisor_id = sv.id
      LEFT JOIN users rv ON p.reviewed_by = rv.id
      ${where}
      ORDER BY p.pursuit_date DESC, p.created_at DESC
    `).all(...params);

    res.json(pursuits.map((p: any) => ({
      ...p,
      additional_units: typeof p.additional_units === 'string' ? JSON.parse(p.additional_units) : p.additional_units,
    })));
  } catch (error: any) {
    console.error('Get pursuits error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET SINGLE ──────────────────────────────────────

router.get('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const pursuit = db.prepare(`
      SELECT p.*, u.full_name as officer_name, u.badge_number,
             sv.full_name as supervisor_name,
             rv.full_name as reviewed_by_name
      FROM vehicle_pursuits p
      JOIN users u ON p.initiating_officer_id = u.id
      LEFT JOIN users sv ON p.supervisor_id = sv.id
      LEFT JOIN users rv ON p.reviewed_by = rv.id
      WHERE p.id = ?
    `).get(req.params.id) as any;

    if (!pursuit) { res.status(404).json({ error: 'Pursuit not found' }); return; }
    pursuit.additional_units = typeof pursuit.additional_units === 'string' ? JSON.parse(pursuit.additional_units) : pursuit.additional_units;
    res.json(pursuit);
  } catch (error: any) {
    console.error('Get pursuit error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── CREATE ──────────────────────────────────────────

router.post('/', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();

    const year = new Date().getFullYear();
    const last = db.prepare(`SELECT pursuit_number FROM vehicle_pursuits WHERE pursuit_number LIKE 'VP-${year}-%' ORDER BY id DESC LIMIT 1`).get() as any;
    const seq = last ? parseInt(last.pursuit_number.split('-')[2]) + 1 : 1;
    const pursuit_number = `VP-${year}-${String(seq).padStart(4, '0')}`;

    const b = req.body;
    if (!b.pursuit_date || !b.initial_reason || !b.start_location) {
      res.status(400).json({ error: 'pursuit_date, initial_reason, and start_location are required' }); return;
    }

    const result = db.prepare(`
      INSERT INTO vehicle_pursuits (
        pursuit_number, status, initiating_officer_id, initiating_unit, call_id, incident_id,
        pursuit_date, pursuit_time, initial_reason, initial_reason_other, initial_violation,
        suspect_name, suspect_dob, suspect_gender, suspect_race,
        suspect_vehicle_year, suspect_vehicle_make, suspect_vehicle_model,
        suspect_vehicle_color, suspect_vehicle_plate, suspect_vehicle_state, passenger_count,
        start_location, end_location, route_description,
        max_speed_mph, road_conditions, weather_conditions, traffic_density, area_type, duration_minutes,
        pit_maneuver, spike_strips, rolling_roadblock, helicopter_assist, k9_deployment, additional_tactics,
        outcome, termination_reason,
        suspect_injured, suspect_injury_description, officer_injured, officer_injury_description,
        bystander_injured, bystander_injury_description, fatalities, property_damage,
        property_damage_description, accidents_during_pursuit,
        supervisor_notified, supervisor_id, supervisor_authorized, supervisor_terminated,
        narrative, additional_units, created_by, created_at, updated_at
      ) VALUES (${Array(55).fill('?').join(',')})
    `).run(
      pursuit_number, b.status || 'draft',
      b.initiating_officer_id || req.user!.userId, b.initiating_unit || null,
      b.call_id || null, b.incident_id || null,
      b.pursuit_date, b.pursuit_time || null,
      b.initial_reason, b.initial_reason_other || null, b.initial_violation || null,
      b.suspect_name || null, b.suspect_dob || null, b.suspect_gender || null, b.suspect_race || null,
      b.suspect_vehicle_year || null, b.suspect_vehicle_make || null, b.suspect_vehicle_model || null,
      b.suspect_vehicle_color || null, b.suspect_vehicle_plate || null, b.suspect_vehicle_state || null,
      b.passenger_count || 0,
      b.start_location, b.end_location || null, b.route_description || null,
      b.max_speed_mph || null, b.road_conditions || null, b.weather_conditions || null,
      b.traffic_density || null, b.area_type || null, b.duration_minutes || null,
      b.pit_maneuver ? 1 : 0, b.spike_strips ? 1 : 0, b.rolling_roadblock ? 1 : 0,
      b.helicopter_assist ? 1 : 0, b.k9_deployment ? 1 : 0, b.additional_tactics || null,
      b.outcome || null, b.termination_reason || null,
      b.suspect_injured ? 1 : 0, b.suspect_injury_description || null,
      b.officer_injured ? 1 : 0, b.officer_injury_description || null,
      b.bystander_injured ? 1 : 0, b.bystander_injury_description || null,
      b.fatalities || 0, b.property_damage ? 1 : 0,
      b.property_damage_description || null, b.accidents_during_pursuit || 0,
      b.supervisor_notified ? 1 : 0, b.supervisor_id || null,
      b.supervisor_authorized ? 1 : 0, b.supervisor_terminated ? 1 : 0,
      b.narrative || null, JSON.stringify(b.additional_units || []),
      req.user!.userId, now, now,
    );

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'pursuit_created', 'vehicle_pursuit', ?, ?, ?)`).run(
      req.user!.userId, result.lastInsertRowid, `Pursuit ${pursuit_number} created`, req.ip || 'unknown'
    );

    const created = db.prepare('SELECT * FROM vehicle_pursuits WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(created);
  } catch (error: any) {
    console.error('Create pursuit error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── UPDATE ──────────────────────────────────────────

router.put('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM vehicle_pursuits WHERE id = ?').get(req.params.id) as any;
    if (!existing) { res.status(404).json({ error: 'Pursuit not found' }); return; }

    const fields: string[] = [];
    const values: any[] = [];
    const addField = (col: string, val: any) => {
      if (val !== undefined) { fields.push(`${col} = ?`); values.push(val); }
    };
    const addBool = (col: string, val: any) => {
      if (val !== undefined) { fields.push(`${col} = ?`); values.push(val ? 1 : 0); }
    };

    const b = req.body;
    addField('status', b.status);
    addField('initiating_officer_id', b.initiating_officer_id);
    addField('initiating_unit', b.initiating_unit);
    addField('call_id', b.call_id);
    addField('incident_id', b.incident_id);
    addField('pursuit_date', b.pursuit_date);
    addField('pursuit_time', b.pursuit_time);
    addField('initial_reason', b.initial_reason);
    addField('initial_reason_other', b.initial_reason_other);
    addField('initial_violation', b.initial_violation);
    addField('suspect_name', b.suspect_name);
    addField('suspect_dob', b.suspect_dob);
    addField('suspect_gender', b.suspect_gender);
    addField('suspect_race', b.suspect_race);
    addField('suspect_vehicle_year', b.suspect_vehicle_year);
    addField('suspect_vehicle_make', b.suspect_vehicle_make);
    addField('suspect_vehicle_model', b.suspect_vehicle_model);
    addField('suspect_vehicle_color', b.suspect_vehicle_color);
    addField('suspect_vehicle_plate', b.suspect_vehicle_plate);
    addField('suspect_vehicle_state', b.suspect_vehicle_state);
    addField('passenger_count', b.passenger_count);
    addField('start_location', b.start_location);
    addField('end_location', b.end_location);
    addField('route_description', b.route_description);
    addField('max_speed_mph', b.max_speed_mph);
    addField('road_conditions', b.road_conditions);
    addField('weather_conditions', b.weather_conditions);
    addField('traffic_density', b.traffic_density);
    addField('area_type', b.area_type);
    addField('duration_minutes', b.duration_minutes);
    addBool('pit_maneuver', b.pit_maneuver);
    addBool('spike_strips', b.spike_strips);
    addBool('rolling_roadblock', b.rolling_roadblock);
    addBool('helicopter_assist', b.helicopter_assist);
    addBool('k9_deployment', b.k9_deployment);
    addField('additional_tactics', b.additional_tactics);
    addField('outcome', b.outcome);
    addField('termination_reason', b.termination_reason);
    addBool('suspect_injured', b.suspect_injured);
    addField('suspect_injury_description', b.suspect_injury_description);
    addBool('officer_injured', b.officer_injured);
    addField('officer_injury_description', b.officer_injury_description);
    addBool('bystander_injured', b.bystander_injured);
    addField('bystander_injury_description', b.bystander_injury_description);
    addField('fatalities', b.fatalities);
    addBool('property_damage', b.property_damage);
    addField('property_damage_description', b.property_damage_description);
    addField('accidents_during_pursuit', b.accidents_during_pursuit);
    addBool('supervisor_notified', b.supervisor_notified);
    addField('supervisor_id', b.supervisor_id);
    addBool('supervisor_authorized', b.supervisor_authorized);
    addBool('supervisor_terminated', b.supervisor_terminated);
    addField('narrative', b.narrative);
    if (b.additional_units !== undefined) addField('additional_units', JSON.stringify(b.additional_units));
    addBool('policy_compliant', b.policy_compliant);

    if (fields.length === 0) { res.json(existing); return; }
    fields.push('updated_at = ?');
    values.push(localNow());
    values.push(req.params.id);

    db.prepare(`UPDATE vehicle_pursuits SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    const updated = db.prepare('SELECT * FROM vehicle_pursuits WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (error: any) {
    console.error('Update pursuit error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── REVIEW ──────────────────────────────────────────

router.put('/:id/review', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { status, review_notes, policy_compliant } = req.body;
    if (!['approved', 'returned'].includes(status)) {
      res.status(400).json({ error: 'Invalid review status' }); return;
    }

    const now = localNow();
    db.prepare(`
      UPDATE vehicle_pursuits SET status = ?, reviewed_by = ?, reviewed_at = ?,
        review_notes = ?, policy_compliant = ?, updated_at = ?
      WHERE id = ?
    `).run(status, req.user!.userId, now, review_notes || null,
      policy_compliant !== undefined ? (policy_compliant ? 1 : 0) : null, now, req.params.id);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'pursuit_reviewed', 'vehicle_pursuit', ?, ?, ?)`).run(
      req.user!.userId, req.params.id, `Pursuit #${req.params.id} → ${status}`, req.ip || 'unknown'
    );

    const updated = db.prepare('SELECT * FROM vehicle_pursuits WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (error: any) {
    console.error('Pursuit review error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

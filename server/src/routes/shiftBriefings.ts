import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { auditLog } from '../utils/auditLogger';
import { localNow, localToday } from '../utils/timeUtils';
import { paramStr } from '../utils/reqHelpers';

const router = Router();
router.use(authenticateToken);

const DEFAULT_HISTORY_DAYS = 30;

function getCurrentShift(): 'day' | 'swing' | 'night' {
  const now = localNow();
  const hour = parseInt(now.slice(11, 13), 10);
  if (hour >= 6 && hour < 14) return 'day';
  if (hour >= 14 && hour < 22) return 'swing';
  return 'night';
}

// GET /officer-safety/alerts — consolidated officer safety info (must be before /:id)
router.get('/officer-safety/alerts', (req: Request, res: Response) => {
  const db = getDb();

  const premiseAlerts = db.prepare(
    "SELECT * FROM premise_alerts WHERE is_active = 1 ORDER BY created_at DESC LIMIT 50"
  ).all();

  const officerSafetyPersons = db.prepare(
    "SELECT * FROM persons WHERE officer_safety = 1 OR caution_flag = 1 ORDER BY last_name, first_name LIMIT 50"
  ).all();

  const recentUseOfForce = db.prepare(
    "SELECT * FROM use_of_force WHERE created_at >= datetime('now','localtime','-7 days') ORDER BY created_at DESC LIMIT 20"
  ).all();

  const weaponsCalls = db.prepare(
    "SELECT * FROM calls_for_service WHERE incident_type LIKE '%WEAPON%' AND created_at >= datetime('now','localtime','-7 days') ORDER BY created_at DESC LIMIT 20"
  ).all();

  res.json({
    premise_alerts: premiseAlerts,
    officer_safety_persons: officerSafetyPersons,
    recent_use_of_force: recentUseOfForce,
    weapons_calls: weaponsCalls
  });
});

// GET / — list briefings with filters
router.get('/', (req: Request, res: Response) => {
  const db = getDb();
  const shift = req.query.shift as string | undefined;
  const dateFrom = req.query.date_from as string | undefined;
  const dateTo = req.query.date_to as string | undefined;
  const createdBy = req.query.created_by as string | undefined;

  const conditions: string[] = ['deleted_at IS NULL'];
  const params: any[] = [];

  if (shift && shift !== 'all') {
    conditions.push('shift_type = ?');
    params.push(shift);
  }

  if (dateFrom) {
    conditions.push('briefing_date >= ?');
    params.push(dateFrom);
  } else {
    conditions.push(`briefing_date >= date('now','localtime','-${DEFAULT_HISTORY_DAYS} days')`);
  }

  if (dateTo) {
    conditions.push('briefing_date <= ?');
    params.push(dateTo);
  }

  if (createdBy) {
    conditions.push('created_by = ?');
    params.push(createdBy);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT * FROM shift_briefings ${where} ORDER BY created_at DESC`).all(...params);
  res.json(rows);
});

// GET /generate — auto-generate briefing for current shift
router.get('/generate', requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  const db = getDb();
  const shift = getCurrentShift();

  const intelBulletins = db.prepare(
    "SELECT * FROM intel_bulletins WHERE status = 'active' ORDER BY created_at DESC"
  ).all();

  const criticalCalls = db.prepare(
    "SELECT * FROM calls_for_service WHERE priority IN ('P1','P2') AND created_at >= datetime('now','localtime','-12 hours') ORDER BY created_at DESC"
  ).all();

  const activeWarrants = db.prepare(
    "SELECT * FROM warrants WHERE status = 'active' AND officer_safety_caution = 1 LIMIT 10"
  ).all();

  const premiseAlerts = db.prepare(
    "SELECT * FROM premise_alerts WHERE is_active = 1 LIMIT 20"
  ).all();

  const recentArrests = db.prepare(
    "SELECT * FROM arrest_records WHERE created_at >= datetime('now','localtime','-24 hours') LIMIT 10"
  ).all();

  const unitsOnDuty = db.prepare(
    "SELECT * FROM units WHERE status != 'off_duty'"
  ).all();

  res.json({
    shift,
    generated_at: localNow(),
    sections: {
      intel_bulletins: intelBulletins,
      critical_calls: criticalCalls,
      active_warrants: activeWarrants,
      premise_alerts: premiseAlerts,
      recent_arrests: recentArrests,
      units_on_duty: unitsOnDuty
    }
  });
});

// POST / — save a briefing
router.post('/', requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  const db = getDb();
  const { shift_type, briefing_date, title, content, notes, weather_conditions, staffing_level } = req.body;
  const user = (req as any).user;

  const year = new Date().getFullYear();
  const lastBriefing = db.prepare(
    "SELECT briefing_number FROM shift_briefings WHERE briefing_number LIKE ? ORDER BY id DESC LIMIT 1"
  ).get(`SB-${year}-%`) as any;
  let seq = 1;
  if (lastBriefing) {
    const parts = lastBriefing.briefing_number.split('-');
    seq = parseInt(parts[2]) + 1;
  }
  const briefingNumber = `SB-${year}-${String(seq).padStart(5, '0')}`;

  const now = localNow();
  const result = db.prepare(`
    INSERT INTO shift_briefings (briefing_number, shift_type, briefing_date, title, content, notes, weather_conditions, staffing_level, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    briefingNumber,
    shift_type,
    briefing_date || localToday(),
    title,
    typeof content === 'object' ? JSON.stringify(content) : content,
    notes || null,
    weather_conditions || null,
    staffing_level || null,
    user.id,
    now
  );

  auditLog(req, 'CREATE', 'shift_briefings', result.lastInsertRowid as number, null, { briefing_number: briefingNumber, title });

  res.json({ success: true, id: result.lastInsertRowid, briefing_number: briefingNumber });
});

// GET /:id — get single briefing
router.get('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const id = parseInt(paramStr(req.params.id), 10);
  const row = db.prepare("SELECT * FROM shift_briefings WHERE id = ? AND deleted_at IS NULL").get(id);
  if (!row) {
    res.status(404).json({ error: 'Briefing not found' });
    return;
  }
  res.json(row);
});

// PUT /:id — update briefing
router.put('/:id', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  const db = getDb();
  const id = parseInt(paramStr(req.params.id), 10);
  const { shift_type, briefing_date, title, content, notes, weather_conditions, staffing_level } = req.body;

  const existing = db.prepare("SELECT * FROM shift_briefings WHERE id = ? AND deleted_at IS NULL").get(id) as any;
  if (!existing) {
    res.status(404).json({ error: 'Briefing not found' });
    return;
  }

  db.prepare(`
    UPDATE shift_briefings
    SET shift_type = ?, briefing_date = ?, title = ?, content = ?, notes = ?, weather_conditions = ?, staffing_level = ?, updated_at = ?
    WHERE id = ?
  `).run(
    shift_type ?? existing.shift_type,
    briefing_date ?? existing.briefing_date,
    title ?? existing.title,
    content ? (typeof content === 'object' ? JSON.stringify(content) : content) : existing.content,
    notes ?? existing.notes,
    weather_conditions ?? existing.weather_conditions,
    staffing_level ?? existing.staffing_level,
    localNow(),
    id
  );

  auditLog(req, 'UPDATE', 'shift_briefings', id, existing, { title, shift_type });

  res.json({ success: true });
});

// DELETE /:id — soft delete
router.delete('/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  const db = getDb();
  const id = parseInt(paramStr(req.params.id), 10);

  const existing = db.prepare("SELECT * FROM shift_briefings WHERE id = ? AND deleted_at IS NULL").get(id);
  if (!existing) {
    res.status(404).json({ error: 'Briefing not found' });
    return;
  }

  db.prepare("UPDATE shift_briefings SET deleted_at = ? WHERE id = ?").run(localNow(), id);
  auditLog(req, 'DELETE', 'shift_briefings', id, existing, null);

  res.json({ success: true });
});

// POST /:id/acknowledge — officer acknowledges reading the briefing
router.post('/:id/acknowledge', (req: Request, res: Response) => {
  const db = getDb();
  const id = parseInt(paramStr(req.params.id), 10);
  const user = (req as any).user;

  const briefing = db.prepare("SELECT * FROM shift_briefings WHERE id = ? AND deleted_at IS NULL").get(id);
  if (!briefing) {
    res.status(404).json({ error: 'Briefing not found' });
    return;
  }

  const existingAck = db.prepare(
    "SELECT * FROM shift_briefing_acknowledgments WHERE briefing_id = ? AND user_id = ?"
  ).get(id, user.id);
  if (existingAck) {
    res.json({ success: true, message: 'Already acknowledged' });
    return;
  }

  db.prepare(
    "INSERT INTO shift_briefing_acknowledgments (briefing_id, user_id, acknowledged_at) VALUES (?, ?, ?)"
  ).run(id, user.id, localNow());

  res.json({ success: true });
});

// GET /:id/acknowledgments — list acknowledgments for a briefing
router.get('/:id/acknowledgments', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  const db = getDb();
  const id = parseInt(paramStr(req.params.id), 10);

  const rows = db.prepare(`
    SELECT a.*, u.username, u.full_name
    FROM shift_briefing_acknowledgments a
    LEFT JOIN users u ON a.user_id = u.id
    WHERE a.briefing_id = ?
    ORDER BY a.acknowledged_at DESC
  `).all(id);

  res.json(rows);
});

export default router;

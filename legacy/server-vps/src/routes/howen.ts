import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { auditLog } from '../utils/auditLogger';
import { paramStr, paramNum } from '../utils/reqHelpers';
import {
  getHowenConfig,
  startHowenReceiver,
  stopHowenReceiver,
  restartHowenReceiver,
} from '../utils/howenReceiver';

const router = Router();
router.use(authenticateToken);

router.get('/status', (req: Request, res: Response) => {
  const config = getHowenConfig();
  res.json({
    integration: 'howen',
    ...config,
    ports: [33000, 22129, 47670],
    protocol: 'H-protocol',
    models: ['Hero-ME40-02', 'Hero-ME40-02V3', 'Hero-ME40-02V8'],
  });
});

router.post('/enable', requireRole('admin'), (req: Request, res: Response) => {
  const { enabled, port } = req.body;
  if (enabled) {
    startHowenReceiver(port || 33000);
  } else {
    stopHowenReceiver();
  }
  auditLog(req, 'UPDATE', 'howen_integration', 0, null, { enabled, port });
  res.json({ success: true, enabled: !!enabled, port: port || 33000 });
});

router.put('/settings', requireRole('admin'), (req: Request, res: Response) => {
  const { port } = req.body;
  if (port && (port < 1 || port > 65535)) {
    res.status(400).json({ error: 'Invalid port' });
    return;
  }
  restartHowenReceiver(port || 33000);
  auditLog(req, 'UPDATE', 'howen_settings', 0, null, { port });
  res.json({ success: true, port: port || 33000 });
});

router.get('/devices', (req: Request, res: Response) => {
  const db = getDb();
  const search = paramStr(req.query.search as string);
  const unitId = paramStr(req.query.unit_id as string);
  const isActive = paramStr(req.query.is_active as string);
  const pageNum = Math.max(1, paramNum(req.query.page as string, 1));
  const limitNum = Math.min(200, Math.max(1, paramNum(req.query.limit as string, 50)));
  const offset = (pageNum - 1) * limitNum;

  let where = 'WHERE 1=1';
  const params: any[] = [];

  if (search) {
    where += ' AND (device_id LIKE ? OR label LIKE ? OR imei LIKE ? OR plate_number LIKE ?)';
    const s = `%${search}%`;
    params.push(s, s, s, s);
  }
  if (unitId) {
    where += ' AND unit_id = ?';
    params.push(parseInt(unitId, 10));
  }
  if (isActive) {
    where += ' AND is_active = ?';
    params.push(isActive === '1' || isActive === 'true' ? 1 : 0);
  }

  const total = (db.prepare(`SELECT COUNT(*) as cnt FROM howen_devices ${where}`).get(...params) as any)?.cnt || 0;

  const rows = db.prepare(`
    SELECT hd.*, u.call_sign, u.status as unit_status,
      u.officer_name, fv.license_plate as fleet_plate
    FROM howen_devices hd
    LEFT JOIN units u ON hd.unit_id = u.id
    LEFT JOIN fleet_vehicles fv ON hd.vehicle_id = fv.id
    ${where}
    ORDER BY hd.last_connection_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limitNum, offset);

  res.json({ devices: rows, total, page: pageNum, limit: limitNum });
});

router.get('/devices/:id', (req: Request, res: Response) => {
  const db = getDb();
  const device = db.prepare(`
    SELECT hd.*, u.call_sign, u.status as unit_status,
      u.officer_name, fv.license_plate as fleet_plate
    FROM howen_devices hd
    LEFT JOIN units u ON hd.unit_id = u.id
    LEFT JOIN fleet_vehicles fv ON hd.vehicle_id = fv.id
    WHERE hd.id = ?
  `).get(parseInt(paramStr(req.params.id), 10));

  if (!device) {
    res.status(404).json({ error: 'Device not found' });
    return;
  }

  const recentGps = db.prepare(`
    SELECT * FROM howen_gps_breadcrumbs
    WHERE device_id = ?
    ORDER BY recorded_at DESC LIMIT 100
  `).all((device as any).device_id);

  const recentEvents = db.prepare(`
    SELECT * FROM howen_events
    WHERE device_id = ?
    ORDER BY event_at DESC LIMIT 50
  `).all((device as any).device_id);

  const last24h = db.prepare(`
    SELECT COUNT(*) as cnt FROM howen_gps_breadcrumbs
    WHERE device_id = ? AND recorded_at >= datetime('now', '-1 day', 'localtime')
  `).get((device as any).device_id) as any;

  res.json({
    ...device as any,
    recent_gps_points: recentGps,
    recent_events: recentEvents,
    gps_count_24h: last24h?.cnt || 0,
  });
});

router.post('/devices', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  const db = getDb();
  const { device_id, imei, iccid, label, unit_id, vehicle_id, plate_number } = req.body;

  if (!device_id) {
    res.status(400).json({ error: 'device_id is required' });
    return;
  }

  const existing = db.prepare('SELECT id FROM howen_devices WHERE device_id = ?').get(device_id);
  if (existing) {
    res.status(409).json({ error: 'Device already registered', id: (existing as any).id });
    return;
  }

  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const result = db.prepare(`
    INSERT INTO howen_devices (device_id, imei, iccid, label, unit_id, vehicle_id, plate_number, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(device_id, imei || null, iccid || null, label || null,
    unit_id || null, vehicle_id || null, plate_number || null, now, now);

  auditLog(req, 'CREATE', 'howen_device', result.lastInsertRowid as number, null, { device_id });
  res.json({ success: true, id: result.lastInsertRowid });
});

router.put('/devices/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  const db = getDb();
  const id = parseInt(paramStr(req.params.id), 10);
  const device = db.prepare('SELECT * FROM howen_devices WHERE id = ?').get(id) as any;
  if (!device) {
    res.status(404).json({ error: 'Device not found' });
    return;
  }

  const { label, unit_id, vehicle_id, plate_number, is_active } = req.body;
  const updates: string[] = [];
  const vals: any[] = [];

  if (label !== undefined) { updates.push('label = ?'); vals.push(label); }
  if (unit_id !== undefined) { updates.push('unit_id = ?'); vals.push(unit_id || null); }
  if (vehicle_id !== undefined) { updates.push('vehicle_id = ?'); vals.push(vehicle_id || null); }
  if (plate_number !== undefined) { updates.push('plate_number = ?'); vals.push(plate_number); }
  if (is_active !== undefined) { updates.push('is_active = ?'); vals.push(is_active ? 1 : 0); }

  if (updates.length === 0) {
    res.json({ success: true, message: 'No changes' });
    return;
  }

  updates.push('updated_at = ?');
  vals.push(new Date().toISOString().replace('T', ' ').substring(0, 19));
  vals.push(id);

  db.prepare(`UPDATE howen_devices SET ${updates.join(', ')} WHERE id = ?`).run(...vals);
  auditLog(req, 'UPDATE', 'howen_device', id, null, req.body);
  res.json({ success: true });
});

router.delete('/devices/:id', requireRole('admin'), (req: Request, res: Response) => {
  const db = getDb();
  const id = parseInt(paramStr(req.params.id), 10);
  const device = db.prepare('SELECT device_id FROM howen_devices WHERE id = ?').get(id) as any;
  if (!device) {
    res.status(404).json({ error: 'Device not found' });
    return;
  }

  db.prepare('DELETE FROM howen_devices WHERE id = ?').run(id);
  auditLog(req, 'DELETE', 'howen_device', id, null, { device_id: device.device_id });
  res.json({ success: true });
});

router.get('/devices/:id/gps', (req: Request, res: Response) => {
  const db = getDb();
  const id = parseInt(paramStr(req.params.id), 10);
  const device = db.prepare('SELECT device_id FROM howen_devices WHERE id = ?').get(id) as any;
  if (!device) {
    res.status(404).json({ error: 'Device not found' });
    return;
  }

  const since = paramStr(req.query.since as string);
  const until = paramStr(req.query.until as string);
  const limitNum = Math.min(5000, Math.max(1, paramNum(req.query.limit as string, 500)));

  let where = 'WHERE device_id = ?';
  const params: any[] = [device.device_id];

  if (since) { where += ' AND recorded_at >= ?'; params.push(since); }
  if (until) { where += ' AND recorded_at <= ?'; params.push(until); }

  const rows = db.prepare(`
    SELECT * FROM howen_gps_breadcrumbs ${where}
    ORDER BY recorded_at DESC LIMIT ?
  `).all(...params, limitNum);

  res.json({ gps: rows });
});

router.get('/devices/:id/events', (req: Request, res: Response) => {
  const db = getDb();
  const id = parseInt(paramStr(req.params.id), 10);
  const device = db.prepare('SELECT device_id FROM howen_devices WHERE id = ?').get(id) as any;
  if (!device) {
    res.status(404).json({ error: 'Device not found' });
    return;
  }

  const since = paramStr(req.query.since as string);
  const until = paramStr(req.query.until as string);
  const type = paramStr(req.query.type as string);
  const limitNum = Math.min(1000, Math.max(1, paramNum(req.query.limit as string, 100)));

  let where = 'WHERE device_id = ?';
  const params: any[] = [device.device_id];

  if (since) { where += ' AND event_at >= ?'; params.push(since); }
  if (until) { where += ' AND event_at <= ?'; params.push(until); }
  if (type) { where += ' AND event_type = ?'; params.push(type); }

  const rows = db.prepare(`
    SELECT * FROM howen_events ${where}
    ORDER BY event_at DESC LIMIT ?
  `).all(...params, limitNum);

  res.json({ events: rows });
});

router.get('/events', (req: Request, res: Response) => {
  const db = getDb();
  const since = paramStr(req.query.since as string);
  const until = paramStr(req.query.until as string);
  const type = paramStr(req.query.type as string);
  const severity = paramStr(req.query.severity as string);
  const deviceId = paramStr(req.query.device_id as string);
  const pageNum = Math.max(1, paramNum(req.query.page as string, 1));
  const limitNum = Math.min(500, Math.max(1, paramNum(req.query.limit as string, 50)));
  const offset = (pageNum - 1) * limitNum;

  let where = 'WHERE 1=1';
  const params: any[] = [];

  if (since) { where += ' AND he.event_at >= ?'; params.push(since); }
  if (until) { where += ' AND he.event_at <= ?'; params.push(until); }
  if (type) { where += ' AND he.event_type = ?'; params.push(type); }
  if (severity) { where += ' AND he.severity = ?'; params.push(severity); }
  if (deviceId) { where += ' AND he.device_id = ?'; params.push(deviceId); }

  const total = (db.prepare(`SELECT COUNT(*) as cnt FROM howen_events he ${where}`).get(...params) as any)?.cnt || 0;

  const rows = db.prepare(`
    SELECT he.*, hd.label as device_label, hd.unit_id,
      u.call_sign, u.officer_name
    FROM howen_events he
    LEFT JOIN howen_devices hd ON he.device_id = hd.device_id
    LEFT JOIN units u ON hd.unit_id = u.id
    ${where}
    ORDER BY he.event_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limitNum, offset);

  res.json({ events: rows, total, page: pageNum, limit: limitNum });
});

router.get('/events/stats', (req: Request, res: Response) => {
  const db = getDb();
  const byType = db.prepare(`
    SELECT event_type, COUNT(*) as cnt, MAX(event_at) as last_at
    FROM howen_events
    GROUP BY event_type ORDER BY cnt DESC
  `).all();

  const bySeverity = db.prepare(`
    SELECT severity, COUNT(*) as cnt
    FROM howen_events
    GROUP BY severity
  `).all();

  const total24h = (db.prepare(`
    SELECT COUNT(*) as cnt FROM howen_events
    WHERE event_at >= datetime('now', '-1 day', 'localtime')
  `).get() as any)?.cnt || 0;

  res.json({ by_type: byType, by_severity: bySeverity, total_24h: total24h });
});

export default router;

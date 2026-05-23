import { Hono } from 'hono';
import { authenticateToken, requireRole } from '../worker-middleware/auth';

export function mountHowenRoutes(app: Hono<{ Bindings: any; Variables: { user: any } }>): void {
  const api = new Hono<{ Bindings: any; Variables: any }>();

  api.use('/*', authenticateToken);

  api.get('/status', (c) => {
    return c.json({
      integration: 'howen',
      enabled: false,
      port: 33000,
      deviceCount: 0,
      uptime: 0,
      ports: [33000, 22129, 47670],
      protocol: 'H-protocol',
      models: ['Hero-ME40-02', 'Hero-ME40-02V3', 'Hero-ME40-02V8'],
      note: 'TCP receiver runs on Express server only',
    });
  });

  api.get('/devices', async (c) => {
    const db = c.env.DB;
    const search = c.req.query('search');
    const unitId = c.req.query('unit_id');
    const isActive = c.req.query('is_active');
    const page = parseInt(c.req.query('page') || '1', 10);
    const limit = Math.min(200, Math.max(1, parseInt(c.req.query('limit') || '50', 10)));
    const offset = (page - 1) * limit;

    let where = 'WHERE 1=1';
    const params: any[] = [];

    if (search) {
      where += ' AND (hd.device_id LIKE ? OR hd.label LIKE ? OR hd.imei LIKE ? OR hd.plate_number LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }
    if (unitId) {
      where += ' AND hd.unit_id = ?';
      params.push(parseInt(unitId, 10));
    }
    if (isActive !== undefined && isActive !== null) {
      where += ' AND hd.is_active = ?';
      params.push(isActive === '1' || isActive === 'true' ? 1 : 0);
    }

    try {
      const countRow: any = await db.prepare(`SELECT COUNT(*) as cnt FROM howen_devices hd ${where}`).bind(...params).first();
      const total = countRow?.cnt || 0;

      const rows = await db.prepare(`
        SELECT hd.*, u.call_sign, u.status as unit_status,
          u.officer_name, fv.license_plate as fleet_plate
        FROM howen_devices hd
        LEFT JOIN units u ON hd.unit_id = u.id
        LEFT JOIN fleet_vehicles fv ON hd.vehicle_id = fv.id
        ${where}
        ORDER BY hd.last_connection_at DESC
        LIMIT ? OFFSET ?
      `).bind(...params, limit, offset).all();

      return c.json({ devices: rows.results || [], total, page, limit });
    } catch (err: any) {
      return c.json({ error: 'Failed to fetch devices', details: err.message }, 500);
    }
  });

  api.get('/devices/:id', async (c) => {
    const db = c.env.DB;
    const id = c.req.param('id');

    try {
      const device: any = await db.prepare(`
        SELECT hd.*, u.call_sign, u.status as unit_status,
          u.officer_name, fv.license_plate as fleet_plate
        FROM howen_devices hd
        LEFT JOIN units u ON hd.unit_id = u.id
        LEFT JOIN fleet_vehicles fv ON hd.vehicle_id = fv.id
        WHERE hd.id = ?
      `).bind(parseInt(id, 10)).first();

      if (!device) {
        return c.json({ error: 'Device not found' }, 404);
      }

      const recentGps = await db.prepare(`
        SELECT * FROM howen_gps_breadcrumbs
        WHERE device_id = ?
        ORDER BY recorded_at DESC LIMIT 100
      `).bind(device.device_id).all();

      const recentEvents = await db.prepare(`
        SELECT * FROM howen_events
        WHERE device_id = ?
        ORDER BY event_at DESC LIMIT 50
      `).bind(device.device_id).all();

      const gpsCount: any = await db.prepare(`
        SELECT COUNT(*) as cnt FROM howen_gps_breadcrumbs
        WHERE device_id = ? AND recorded_at >= datetime('now', '-1 day')
      `).bind(device.device_id).first();

      return c.json({
        ...device,
        recent_gps_points: recentGps.results || [],
        recent_events: recentEvents.results || [],
        gps_count_24h: gpsCount?.cnt || 0,
      });
    } catch (err: any) {
      return c.json({ error: 'Failed to fetch device', details: err.message }, 500);
    }
  });

  api.post('/devices', requireRole('admin', 'manager'), async (c) => {
    const db = c.env.DB;
    const body = await c.req.json();
    const { device_id, imei, iccid, label, unit_id, vehicle_id, plate_number } = body;

    if (!device_id) {
      return c.json({ error: 'device_id is required' }, 400);
    }

    try {
      const existing: any = await db.prepare('SELECT id FROM howen_devices WHERE device_id = ?').bind(device_id).first();
      if (existing) {
        return c.json({ error: 'Device already registered', id: existing.id }, 409);
      }

      const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
      const result = await db.prepare(`
        INSERT INTO howen_devices (device_id, imei, iccid, label, unit_id, vehicle_id, plate_number, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(device_id, imei || null, iccid || null, label || null,
        unit_id || null, vehicle_id || null, plate_number || null, now, now).run();

      return c.json({ success: true, id: result.meta?.last_row_id });
    } catch (err: any) {
      return c.json({ error: 'Failed to create device', details: err.message }, 500);
    }
  });

  api.put('/devices/:id', requireRole('admin', 'manager'), async (c) => {
    const db = c.env.DB;
    const id = parseInt(c.req.param('id') || '0', 10);

    try {
      const device: any = await db.prepare('SELECT * FROM howen_devices WHERE id = ?').bind(id).first();
      if (!device) {
        return c.json({ error: 'Device not found' }, 404);
      }

      const body = await c.req.json();
      const { label, unit_id, vehicle_id, plate_number, is_active } = body;
      const updates: string[] = [];
      const vals: any[] = [];

      if (label !== undefined) { updates.push('label = ?'); vals.push(label); }
      if (unit_id !== undefined) { updates.push('unit_id = ?'); vals.push(unit_id || null); }
      if (vehicle_id !== undefined) { updates.push('vehicle_id = ?'); vals.push(vehicle_id || null); }
      if (plate_number !== undefined) { updates.push('plate_number = ?'); vals.push(plate_number); }
      if (is_active !== undefined) { updates.push('is_active = ?'); vals.push(is_active ? 1 : 0); }

      if (updates.length === 0) {
        return c.json({ success: true, message: 'No changes' });
      }

      updates.push('updated_at = ?');
      vals.push(new Date().toISOString().replace('T', ' ').substring(0, 19));
      vals.push(id);

      await db.prepare(`UPDATE howen_devices SET ${updates.join(', ')} WHERE id = ?`).bind(...vals).run();
      return c.json({ success: true });
    } catch (err: any) {
      return c.json({ error: 'Failed to update device', details: err.message }, 500);
    }
  });

  api.delete('/devices/:id', requireRole('admin'), async (c) => {
    const db = c.env.DB;
    const id = parseInt(c.req.param('id') || '0', 10);

    try {
      const device: any = await db.prepare('SELECT device_id FROM howen_devices WHERE id = ?').bind(id).first();
      if (!device) {
        return c.json({ error: 'Device not found' }, 404);
      }
      await db.prepare('DELETE FROM howen_devices WHERE id = ?').bind(id).run();
      return c.json({ success: true });
    } catch (err: any) {
      return c.json({ error: 'Failed to delete device', details: err.message }, 500);
    }
  });

  api.get('/devices/:id/gps', async (c) => {
    const db = c.env.DB;
    const id = parseInt(c.req.param('id') || '0', 10);
    const since = c.req.query('since');
    const until = c.req.query('until');
    const limit = Math.min(5000, Math.max(1, parseInt(c.req.query('limit') || '500', 10)));

    try {
      const device: any = await db.prepare('SELECT device_id FROM howen_devices WHERE id = ?').bind(id).first();
      if (!device) return c.json({ error: 'Device not found' }, 404);

      let where = 'WHERE device_id = ?';
      const params: any[] = [device.device_id];
      if (since) { where += ' AND recorded_at >= ?'; params.push(since); }
      if (until) { where += ' AND recorded_at <= ?'; params.push(until); }

      const rows = await db.prepare(`SELECT * FROM howen_gps_breadcrumbs ${where} ORDER BY recorded_at DESC LIMIT ?`).bind(...params, limit).all();
      return c.json({ gps: rows.results || [] });
    } catch (err: any) {
      return c.json({ error: 'Failed to fetch GPS data', details: err.message }, 500);
    }
  });

  api.get('/devices/:id/events', async (c) => {
    const db = c.env.DB;
    const id = parseInt(c.req.param('id') || '0', 10);
    const since = c.req.query('since');
    const until = c.req.query('until');
    const type = c.req.query('type');
    const limit = Math.min(1000, Math.max(1, parseInt(c.req.query('limit') || '100', 10)));

    try {
      const device: any = await db.prepare('SELECT device_id FROM howen_devices WHERE id = ?').bind(id).first();
      if (!device) return c.json({ error: 'Device not found' }, 404);

      let where = 'WHERE device_id = ?';
      const params: any[] = [device.device_id];
      if (since) { where += ' AND event_at >= ?'; params.push(since); }
      if (until) { where += ' AND event_at <= ?'; params.push(until); }
      if (type) { where += ' AND event_type = ?'; params.push(type); }

      const rows = await db.prepare(`SELECT * FROM howen_events ${where} ORDER BY event_at DESC LIMIT ?`).bind(...params, limit).all();
      return c.json({ events: rows.results || [] });
    } catch (err: any) {
      return c.json({ error: 'Failed to fetch events', details: err.message }, 500);
    }
  });

  api.get('/events', async (c) => {
    const db = c.env.DB;
    const since = c.req.query('since');
    const until = c.req.query('until');
    const type = c.req.query('type');
    const severity = c.req.query('severity');
    const deviceId = c.req.query('device_id');
    const page = parseInt(c.req.query('page') || '1', 10);
    const limit = Math.min(500, Math.max(1, parseInt(c.req.query('limit') || '50', 10)));
    const offset = (page - 1) * limit;

    let where = 'WHERE 1=1';
    const params: any[] = [];

    if (since) { where += ' AND he.event_at >= ?'; params.push(since); }
    if (until) { where += ' AND he.event_at <= ?'; params.push(until); }
    if (type) { where += ' AND he.event_type = ?'; params.push(type); }
    if (severity) { where += ' AND he.severity = ?'; params.push(severity); }
    if (deviceId) { where += ' AND he.device_id = ?'; params.push(deviceId); }

    try {
      const totalRow: any = await db.prepare(`SELECT COUNT(*) as cnt FROM howen_events he ${where}`).bind(...params).first();

      const rows = await db.prepare(`
        SELECT he.*, hd.label as device_label, hd.unit_id,
          u.call_sign, u.officer_name
        FROM howen_events he
        LEFT JOIN howen_devices hd ON he.device_id = hd.device_id
        LEFT JOIN units u ON hd.unit_id = u.id
        ${where}
        ORDER BY he.event_at DESC
        LIMIT ? OFFSET ?
      `).bind(...params, limit, offset).all();

      return c.json({ events: rows.results || [], total: totalRow?.cnt || 0, page, limit });
    } catch (err: any) {
      return c.json({ error: 'Failed to fetch events', details: err.message }, 500);
    }
  });

  api.get('/events/stats', async (c) => {
    const db = c.env.DB;
    try {
      const byType = await db.prepare(`
        SELECT event_type, COUNT(*) as cnt, MAX(event_at) as last_at
        FROM howen_events GROUP BY event_type ORDER BY cnt DESC
      `).all();

      const bySeverity = await db.prepare(`
        SELECT severity, COUNT(*) as cnt FROM howen_events GROUP BY severity
      `).all();

      const total24h: any = await db.prepare(`
        SELECT COUNT(*) as cnt FROM howen_events
        WHERE event_at >= datetime('now', '-1 day')
      `).first();

      return c.json({
        by_type: byType.results || [],
        by_severity: bySeverity.results || [],
        total_24h: total24h?.cnt || 0,
      });
    } catch (err: any) {
      return c.json({ error: 'Failed to fetch stats', details: err.message }, 500);
    }
  });

  app.route('/api/howen', api);
}

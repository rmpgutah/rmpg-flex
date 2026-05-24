// Patrol routes for Workers
import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { D1Db, paramNum } from '../worker-middleware/d1Helpers';
import { localNow, localToday } from '../worker-middleware/timeUtils';

export function mountPatrolRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  // GET /checkpoints
  api.get('/checkpoints', async (c) => {
    const db = new D1Db(c.env.DB);
    const checkpoints = await db.prepare(`
      SELECT pc.*, p.name as property_name
      FROM patrol_checkpoints pc
      LEFT JOIN properties p ON pc.property_id = p.id
      ORDER BY pc.created_at DESC LIMIT 1000
    `).all();
    return c.json(checkpoints);
  });

  // GET /checkpoints/property/:propertyId
  api.get('/checkpoints/property/:propertyId', async (c) => {
    const db = new D1Db(c.env.DB);
    const propertyId = paramNum(c.req.param('propertyId'));
    if (isNaN(propertyId)) return c.json({ error: 'Invalid property ID', code: 'INVALID_PROPERTY_ID' }, 400);
    const checkpoints = await db.prepare(`
      SELECT pc.*, p.name as property_name
      FROM patrol_checkpoints pc
      LEFT JOIN properties p ON pc.property_id = p.id
      WHERE pc.property_id = ?
      ORDER BY pc.name LIMIT 500
    `).all(propertyId);
    return c.json(checkpoints);
  });

  // POST /checkpoints
  api.post('/checkpoints', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    const body = await c.req.json();
    const { property_id, name, description, latitude, longitude, scan_required_interval_minutes, is_active } = body;
    if (!property_id || !name || !scan_required_interval_minutes) return c.json({ error: 'Missing required fields: property_id, name, scan_required_interval_minutes', code: 'MISSING_REQUIRED_FIELDS_PROPERTYID' }, 400);

    const db = new D1Db(c.env.DB);
    const qr_code = crypto.randomUUID();
    const user = c.get('user');

    const result = await db.prepare(`
      INSERT INTO patrol_checkpoints (property_id, name, description, qr_code, latitude, longitude, scan_required_interval_minutes, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(property_id, name, description || null, qr_code, latitude || null, longitude || null, scan_required_interval_minutes, is_active !== undefined ? (is_active ? 1 : 0) : 1, localNow());

    // activity_log skipped in worker

    const checkpoint = await db.prepare('SELECT pc.*, p.name as property_name FROM patrol_checkpoints pc LEFT JOIN properties p ON pc.property_id = p.id WHERE pc.id = ?').get(result.meta.last_row_id);
    return c.json(checkpoint, 201);
  });

  // PUT /checkpoints/:id
  api.put('/checkpoints/:id', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    const id = c.req.param('id');
    const db = new D1Db(c.env.DB);
    const existing = await db.prepare('SELECT * FROM patrol_checkpoints WHERE id = ?').get(id) as any;
    if (!existing) return c.json({ error: 'Checkpoint not found', code: 'CHECKPOINT_NOT_FOUND' }, 404);

    const body = await c.req.json();
    const user = c.get('user');
    const cpFields: string[] = [];
    const cpValues: any[] = [];
    const cpBodyKeys = Object.keys(body);

    const cpFieldMap: Record<string, (v: any) => any> = {
      property_id: v => v ?? null, name: v => v ?? null, description: v => v ?? null,
      latitude: v => v ?? null, longitude: v => v ?? null,
      scan_required_interval_minutes: v => v ?? null,
      is_active: v => v ? 1 : 0,
    };

    for (const [key, transform] of Object.entries(cpFieldMap)) {
      if (cpBodyKeys.includes(key)) { cpFields.push(`${key} = ?`); cpValues.push(transform(body[key])); }
    }

    if (cpFields.length > 0) {
      cpValues.push(id);
      await db.prepare(`UPDATE patrol_checkpoints SET ${cpFields.join(', ')} WHERE id = ?`).run(...cpValues);
    }

    // activity_log skipped

    const updated = await db.prepare('SELECT pc.*, p.name as property_name FROM patrol_checkpoints pc LEFT JOIN properties p ON pc.property_id = p.id WHERE pc.id = ?').get(id);
    return c.json({ data: updated });
  });

  // DELETE /checkpoints/:id
  api.delete('/checkpoints/:id', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    const id = c.req.param('id');
    const db = new D1Db(c.env.DB);
    const existing = await db.prepare('SELECT * FROM patrol_checkpoints WHERE id = ?').get(id) as any;
    if (!existing) return c.json({ error: 'Checkpoint not found', code: 'CHECKPOINT_NOT_FOUND' }, 404);
    await db.prepare('DELETE FROM patrol_checkpoints WHERE id = ?').run(id);
    // activity_log skipped
    return c.json({ message: 'Checkpoint deleted successfully' });
  });

  // POST /checkpoints/:id/archive
  api.post('/checkpoints/:id/archive', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    const db = new D1Db(c.env.DB);
    const id = paramNum(c.req.param('id'));
    const checkpoint = await db.prepare('SELECT * FROM patrol_checkpoints WHERE id = ?').get(id) as any;
    if (!checkpoint) return c.json({ error: 'Checkpoint not found', code: 'CHECKPOINT_NOT_FOUND' }, 404);
    if (checkpoint.archived_at) return c.json({ error: 'Checkpoint is already archived', code: 'CHECKPOINT_IS_ALREADY_ARCHIVED' }, 400);

    const now = localNow();
    await db.prepare('UPDATE patrol_checkpoints SET archived_at = ? WHERE id = ?').run(now, checkpoint.id);
    // activity_log skipped

    const updated = await db.prepare('SELECT pc.*, p.name as property_name FROM patrol_checkpoints pc LEFT JOIN properties p ON pc.property_id = p.id WHERE pc.id = ?').get(checkpoint.id);
    return c.json({ data: updated });
  });

  // POST /checkpoints/:id/unarchive
  api.post('/checkpoints/:id/unarchive', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    const db = new D1Db(c.env.DB);
    const id = paramNum(c.req.param('id'));
    const checkpoint = await db.prepare('SELECT * FROM patrol_checkpoints WHERE id = ?').get(id) as any;
    if (!checkpoint) return c.json({ error: 'Checkpoint not found', code: 'CHECKPOINT_NOT_FOUND' }, 404);
    if (!checkpoint.archived_at) return c.json({ error: 'Checkpoint is not archived', code: 'CHECKPOINT_IS_NOT_ARCHIVED' }, 400);

    await db.prepare('UPDATE patrol_checkpoints SET archived_at = NULL WHERE id = ?').run(checkpoint.id);
    // activity_log skipped

    const updated = await db.prepare('SELECT pc.*, p.name as property_name FROM patrol_checkpoints pc LEFT JOIN properties p ON pc.property_id = p.id WHERE pc.id = ?').get(checkpoint.id);
    return c.json(updated);
  });

  // POST /scan
  api.post('/scan', async (c) => {
    const body = await c.req.json();
    const { qr_code, latitude, longitude, notes } = body;
    if (!qr_code) return c.json({ error: 'Missing required field: qr_code', code: 'MISSING_REQUIRED_FIELD_QRCODE' }, 400);

    const db = new D1Db(c.env.DB);
    const user = c.get('user');
    const checkpoint = await db.prepare('SELECT * FROM patrol_checkpoints WHERE qr_code = ? AND is_active = 1').get(qr_code) as any;
    if (!checkpoint) return c.json({ error: 'Invalid or inactive checkpoint', code: 'INVALID_OR_INACTIVE_CHECKPOINT' }, 404);

    const lastScan = await db.prepare('SELECT * FROM patrol_scans WHERE checkpoint_id = ? ORDER BY scanned_at DESC LIMIT 1').get(checkpoint.id) as any;

    let status = 'on_time';
    if (lastScan) {
      const lastScanTime = new Date(lastScan.scanned_at).getTime();
      const nowTs = Date.now();
      const intervalMs = checkpoint.scan_required_interval_minutes * 60 * 1000;
      if ((nowTs - lastScanTime) > intervalMs) status = 'late';
    }

    const now = localNow();
    const result = await db.prepare(`
      INSERT INTO patrol_scans (checkpoint_id, officer_id, scanned_at, latitude, longitude, notes, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(checkpoint.id, user.userId, now, latitude || null, longitude || null, notes || null, status);

    const scan = await db.prepare('SELECT * FROM patrol_scans WHERE id = ?').get(result.meta.last_row_id);
    // activity_log + broadcast skipped

    return c.json({ data: { ...(scan as any), checkpoint_name: checkpoint.name, status } }, 201);
  });

  // GET /scans/export
  api.get('/scans/export', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    const db = new D1Db(c.env.DB);
    const q = c.req.query();
    const conditions: string[] = [];
    const params: any[] = [];
    if (q.checkpointId) { conditions.push('ps.checkpoint_id = ?'); params.push(q.checkpointId); }
    if (q.officerId) { conditions.push('ps.officer_id = ?'); params.push(q.officerId); }
    if (q.startDate) { conditions.push('ps.scanned_at >= ?'); params.push(q.startDate); }
    if (q.endDate) { conditions.push('ps.scanned_at <= ?'); params.push(q.endDate); }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = await db.prepare(`
      SELECT pc.name as checkpoint_name, u.full_name as officer_name,
        ps.scanned_at, ps.status, ps.notes
      FROM patrol_scans ps
      LEFT JOIN patrol_checkpoints pc ON ps.checkpoint_id = pc.id
      LEFT JOIN users u ON ps.officer_id = u.id
      ${whereClause}
      ORDER BY ps.scanned_at DESC LIMIT 5000
    `).all(...params) as any[];

    const headers = ['Checkpoint Name', 'Officer Name', 'Scanned At', 'Status', 'Notes'];
    const csvRows = rows.map((r: any) => [
      r.checkpoint_name, r.officer_name, r.scanned_at, r.status,
      (r.notes || '').replace(/"/g, '""'),
    ]);
    const csv = [headers.join(','), ...csvRows.map((r: any[]) => r.map(v => `"${v || ''}"`).join(','))].join('\n');
    c.header('Content-Type', 'text/csv');
    c.header('Content-Disposition', 'attachment; filename="patrol_scans_export.csv"');
    return c.body(csv);
  });

  // GET /scans
  api.get('/scans', async (c) => {
    const db = new D1Db(c.env.DB);
    const q = c.req.query();
    const conditions: string[] = [];
    const params: any[] = [];
    if (q.checkpointId) { conditions.push('ps.checkpoint_id = ?'); params.push(q.checkpointId); }
    if (q.officerId) { conditions.push('ps.officer_id = ?'); params.push(q.officerId); }
    if (q.startDate) { conditions.push('ps.scanned_at >= ?'); params.push(q.startDate); }
    if (q.endDate) { conditions.push('ps.scanned_at <= ?'); params.push(q.endDate); }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = parseInt(q.limit || '100000', 10);
    params.push(limit);

    const scans = await db.prepare(`
      SELECT ps.*, pc.name as checkpoint_name, p.name as property_name, u.full_name as officer_name
      FROM patrol_scans ps
      LEFT JOIN patrol_checkpoints pc ON ps.checkpoint_id = pc.id
      LEFT JOIN properties p ON pc.property_id = p.id
      LEFT JOIN users u ON ps.officer_id = u.id
      ${whereClause}
      ORDER BY ps.scanned_at DESC LIMIT ?
    `).all(...params);
    return c.json(scans);
  });

  // GET /compliance
  api.get('/compliance', async (c) => {
    const db = new D1Db(c.env.DB);
    const checkpoints = await db.prepare(`
      SELECT pc.*, p.name as property_name
      FROM patrol_checkpoints pc
      LEFT JOIN properties p ON pc.property_id = p.id
      WHERE pc.is_active = 1
      ORDER BY p.name, pc.name LIMIT 1000
    `).all() as any[];

    const compliance: any[] = [];
    for (const checkpoint of checkpoints) {
      const todayScans = await db.prepare("SELECT COUNT(*) as count FROM patrol_scans WHERE checkpoint_id = ? AND date(scanned_at) = date('now')").get(checkpoint.id) as any;
      const lastScan = await db.prepare('SELECT scanned_at FROM patrol_scans WHERE checkpoint_id = ? ORDER BY scanned_at DESC LIMIT 1').get(checkpoint.id) as any;
      const complianceStats = await db.prepare('SELECT COUNT(*) as total_scans, SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) as on_time_scans FROM patrol_scans WHERE checkpoint_id = ? AND scanned_at >= ?').get('on_time', checkpoint.id, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()) as any;

      const complianceRate = complianceStats.total_scans > 0 ? (complianceStats.on_time_scans / complianceStats.total_scans) * 100 : 0;
      let nextScanDue = null;
      if (lastScan) {
        const lastScanTime = new Date(lastScan.scanned_at);
        nextScanDue = new Date(lastScanTime.getTime() + checkpoint.scan_required_interval_minutes * 60 * 1000).toISOString();
      }

      compliance.push({
        checkpoint_id: checkpoint.id, checkpoint_name: checkpoint.name,
        property_name: checkpoint.property_name,
        scans_today: todayScans.count, last_scan_time: lastScan ? lastScan.scanned_at : null,
        compliance_rate: Math.round(complianceRate * 10) / 10,
        next_scan_due: nextScanDue, scan_interval_minutes: checkpoint.scan_required_interval_minutes,
      });
    }

    return c.json(compliance);
  });

  // GET /checkpoints/map
  api.get('/checkpoints/map', async (c) => {
    const db = new D1Db(c.env.DB);
    const rows = await db.prepare(`
      SELECT pc.id, pc.name, pc.latitude, pc.longitude, pc.property_id, pc.sequence_order,
             pc.scan_required_interval_minutes,
             ps.scanned_at AS last_scanned, u.full_name AS scanned_by_name, p.name AS property_name
      FROM patrol_checkpoints pc
      LEFT JOIN (SELECT checkpoint_id, MAX(scanned_at) AS scanned_at, officer_id FROM patrol_scans GROUP BY checkpoint_id) ps ON ps.checkpoint_id = pc.id
      LEFT JOIN users u ON u.id = ps.officer_id
      LEFT JOIN properties p ON p.id = pc.property_id
      WHERE pc.is_active = 1 AND pc.latitude IS NOT NULL AND pc.longitude IS NOT NULL
      ORDER BY pc.property_id, pc.sequence_order
    `).all();
    return c.json(rows);
  });

  // GET /optimize-route
  api.get('/optimize-route', async (c) => {
    const db = new D1Db(c.env.DB);
    const q = c.req.query();
    const { property_id, start_lat, start_lng } = q;

    let where = 'WHERE pc.is_active = 1 AND pc.latitude IS NOT NULL AND pc.longitude IS NOT NULL';
    const params: any[] = [];
    if (property_id) { where += ' AND pc.property_id = ?'; params.push(property_id); }

    const checkpoints = await db.prepare(`
      SELECT pc.id, pc.name, pc.latitude, pc.longitude, pc.property_id, p.name as property_name
      FROM patrol_checkpoints pc
      LEFT JOIN properties p ON pc.property_id = p.id
      ${where} LIMIT 1000
    `).all(...params) as any[];

    if (checkpoints.length === 0) return c.json({ optimized_order: [], total_distance_mi: 0 });

    function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
      const R = 3958.8;
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLng = (lng2 - lng1) * Math.PI / 180;
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    const startLat = parseFloat(start_lat || '') || checkpoints[0].latitude;
    const startLng = parseFloat(start_lng || '') || checkpoints[0].longitude;
    const visited = new Set<number>();
    const order: any[] = [];
    let currentLat = startLat;
    let currentLng = startLng;
    let totalDist = 0;

    while (visited.size < checkpoints.length) {
      let nearest: any = null;
      let nearestDist = Infinity;
      for (const cp of checkpoints) {
        if (visited.has(cp.id)) continue;
        const dist = haversine(currentLat, currentLng, cp.latitude, cp.longitude);
        if (dist < nearestDist) { nearestDist = dist; nearest = cp; }
      }
      if (!nearest) break;
      visited.add(nearest.id);
      order.push({ ...nearest, distance_from_previous_mi: Math.round(nearestDist * 100) / 100 });
      totalDist += nearestDist;
      currentLat = nearest.latitude;
      currentLng = nearest.longitude;
    }

    return c.json({ optimized_order: order, total_distance_mi: Math.round(totalDist * 100) / 100 });
  });

  // GET /log/generate
  api.get('/log/generate', async (c) => {
    const db = new D1Db(c.env.DB);
    const q = c.req.query();
    const targetDate = (q.date as string) || localToday();
    const user = c.get('user');
    const officerId = q.officer_id ? parseInt(q.officer_id, 10) : user.userId;

    const officer = await db.prepare('SELECT full_name, badge_number FROM users WHERE id = ?').get(officerId) as any;
    const dayScans = await db.prepare(`
      SELECT ps.*, pc.name as checkpoint_name, p.name as property_name,
             pc.latitude as cp_lat, pc.longitude as cp_lng
      FROM patrol_scans ps
      LEFT JOIN patrol_checkpoints pc ON ps.checkpoint_id = pc.id
      LEFT JOIN properties p ON pc.property_id = p.id
      WHERE ps.officer_id = ? AND DATE(ps.scanned_at) = ?
      ORDER BY ps.scanned_at ASC LIMIT 1000
    `).all(officerId, targetDate) as any[];

    let totalTimeMinutes = 0;
    const checkpointTimes: { checkpoint: string; property: string; time: string; status: string; notes: string; time_since_prev_min: number | null }[] = [];
    for (let i = 0; i < dayScans.length; i++) {
      const scan = dayScans[i];
      let timeSincePrev: number | null = null;
      if (i > 0) {
        const prev = new Date(dayScans[i - 1].scanned_at).getTime();
        const curr = new Date(scan.scanned_at).getTime();
        timeSincePrev = Math.round((curr - prev) / 60000);
        totalTimeMinutes += timeSincePrev;
      }
      checkpointTimes.push({ checkpoint: scan.checkpoint_name, property: scan.property_name || '', time: scan.scanned_at, status: scan.status, notes: scan.notes || '', time_since_prev_min: timeSincePrev });
    }

    const startTime = dayScans.length > 0 ? dayScans[0].scanned_at : null;
    const endTime = dayScans.length > 0 ? dayScans[dayScans.length - 1].scanned_at : null;
    const onTimeCount = dayScans.filter((s: any) => s.status === 'on_time').length;
    const lateCount = dayScans.filter((s: any) => s.status === 'late').length;

    return c.json({
      officer_name: officer?.full_name || 'Unknown', badge_number: officer?.badge_number || '',
      date: targetDate, total_checkpoints_scanned: dayScans.length,
      total_time_minutes: totalTimeMinutes, start_time: startTime, end_time: endTime,
      on_time: onTimeCount, late: lateCount,
      compliance_rate: dayScans.length > 0 ? Math.round((onTimeCount / dayScans.length) * 100) : 0,
      entries: checkpointTimes,
    });
  });

  // POST /scan/:scanId/create-incident
  api.post('/scan/:scanId/create-incident', async (c) => {
    const db = new D1Db(c.env.DB);
    const scanId = paramNum(c.req.param('scanId'));
    const scan = await db.prepare(`
      SELECT ps.*, pc.name as checkpoint_name, pc.property_id, pc.latitude, pc.longitude, p.name as property_name
      FROM patrol_scans ps
      LEFT JOIN patrol_checkpoints pc ON ps.checkpoint_id = pc.id
      LEFT JOIN properties p ON pc.property_id = p.id
      WHERE ps.id = ?
    `).get(scanId) as any;
    if (!scan) return c.json({ error: 'Scan not found', code: 'SCAN_NOT_FOUND' }, 404);

    const body = await c.req.json();
    const { incident_type, description, priority } = body;
    const user = c.get('user');

    const yy = String(new Date().getFullYear()).slice(-2);
    const prefix = `INC-${yy}-`;
    const last = await db.prepare(`SELECT incident_number FROM incidents WHERE incident_number LIKE ? ORDER BY id DESC LIMIT 1`).get(`${prefix}%`) as any;
    let seq = 1;
    if (last) { const m = last.incident_number.match(/INC-\d{2}-(\d{5})/); if (m) seq = parseInt(m[1], 10) + 1; }
    const incidentNumber = `${prefix}${String(seq).padStart(5, '0')}`;

    const now = localNow();
    const info = await db.prepare(`
      INSERT INTO incidents (incident_number, incident_type, status, priority, description,
        location, latitude, longitude, reporting_officer_id, property_id,
        occurred_at, reported_at, created_at, updated_at)
      VALUES (?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(incidentNumber, incident_type || 'patrol_observation', priority || 'low',
      description || `Incident observed during patrol scan at ${scan.checkpoint_name}`,
      scan.property_name || scan.checkpoint_name, scan.latitude, scan.longitude,
      user.userId, scan.property_id || null, scan.scanned_at, now, now, now);

    const incident = await db.prepare('SELECT * FROM incidents WHERE id = ?').get(info.meta.last_row_id);
    // activity_log skipped
    return c.json(incident, 201);
  });

  // GET /coverage-heatmap
  api.get('/coverage-heatmap', async (c) => {
    const db = new D1Db(c.env.DB);
    const q = c.req.query();
    const daysNum = Math.min(90, Math.max(1, parseInt(q.days || '7', 10) || 7));
    const cutoff = new Date(Date.now() - daysNum * 24 * 60 * 60 * 1000).toISOString();

    const points = await db.prepare(`
      SELECT ps.latitude, ps.longitude, COUNT(*) as weight,
             pc.name as checkpoint_name, p.name as property_name,
             MAX(ps.scanned_at) as last_scan
      FROM patrol_scans ps
      LEFT JOIN patrol_checkpoints pc ON ps.checkpoint_id = pc.id
      LEFT JOIN properties p ON pc.property_id = p.id
      WHERE ps.latitude IS NOT NULL AND ps.longitude IS NOT NULL AND ps.scanned_at >= ?
      GROUP BY ROUND(ps.latitude, 4), ROUND(ps.longitude, 4)
      ORDER BY weight DESC
    `).all(cutoff);

    const unpatrolled = await db.prepare(`
      SELECT pc.id, pc.name, pc.latitude, pc.longitude, p.name as property_name
      FROM patrol_checkpoints pc
      LEFT JOIN properties p ON pc.property_id = p.id
      WHERE pc.is_active = 1 AND pc.latitude IS NOT NULL
        AND pc.id NOT IN (SELECT DISTINCT checkpoint_id FROM patrol_scans WHERE scanned_at >= ?)
      LIMIT 1000
    `).all(cutoff);

    return c.json({ heatmap_points: points, unpatrolled_checkpoints: unpatrolled, days: daysNum });
  });

  // POST /verify-tour
  api.post('/verify-tour', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    const db = new D1Db(c.env.DB);
    const body = await c.req.json();
    const { officer_id, date, notes, status } = body;
    if (!officer_id || !date) return c.json({ error: 'officer_id and date are required', code: 'OFFICERID_AND_DATE_ARE' }, 400);

    const user = c.get('user');
    const now = localNow();
    const existing = await db.prepare('SELECT id FROM patrol_tour_verifications WHERE officer_id = ? AND tour_date = ?').get(officer_id, date) as any;

    if (existing) {
      await db.prepare('UPDATE patrol_tour_verifications SET verified_by = ?, verified_at = ?, status = ?, notes = ?, updated_at = ? WHERE id = ?')
        .run(user.userId, now, status || 'approved', notes || '', now, existing.id);
      const updated = await db.prepare('SELECT * FROM patrol_tour_verifications WHERE id = ?').get(existing.id);
      // activity_log skipped
      return c.json(updated);
    } else {
      const scanStats = await db.prepare("SELECT COUNT(*) as total, SUM(CASE WHEN status = 'on_time' THEN 1 ELSE 0 END) as on_time FROM patrol_scans WHERE officer_id = ? AND DATE(scanned_at) = ?").get(officer_id, date) as any;

      const info = await db.prepare(`
        INSERT INTO patrol_tour_verifications (officer_id, tour_date, verified_by, verified_at, status, notes, total_scans, on_time_scans, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(officer_id, date, user.userId, now, status || 'approved', notes || '',
        scanStats?.total || 0, scanStats?.on_time || 0, now, now);

      const verification = await db.prepare('SELECT * FROM patrol_tour_verifications WHERE id = ?').get(info.meta.last_row_id);
      // activity_log skipped
      return c.json(verification, 201);
    }
  });

  // GET /verifications
  api.get('/verifications', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    const db = new D1Db(c.env.DB);
    const q = c.req.query();
    let where = 'WHERE 1=1';
    const params: any[] = [];
    if (q.officer_id) { where += ' AND ptv.officer_id = ?'; params.push(q.officer_id); }
    if (q.start_date) { where += ' AND ptv.tour_date >= ?'; params.push(q.start_date); }
    if (q.end_date) { where += ' AND ptv.tour_date <= ?'; params.push(q.end_date); }

    const rows = await db.prepare(`
      SELECT ptv.*, u.full_name as officer_name, v.full_name as verified_by_name
      FROM patrol_tour_verifications ptv
      LEFT JOIN users u ON ptv.officer_id = u.id
      LEFT JOIN users v ON ptv.verified_by = v.id
      ${where} ORDER BY ptv.tour_date DESC LIMIT 200
    `).all(...params);
    return c.json(rows);
  });

  // GET /exceptions
  api.get('/exceptions', async (c) => {
    const db = new D1Db(c.env.DB);
    const q = c.req.query();
    const daysNum = Math.min(90, Math.max(1, parseInt(q.days || '7', 10) || 7));
    const cutoff = new Date(Date.now() - daysNum * 24 * 60 * 60 * 1000).toISOString();

    const lateScans = await db.prepare(`
      SELECT ps.*, pc.name as checkpoint_name, p.name as property_name,
             u.full_name as officer_name, pc.scan_required_interval_minutes
      FROM patrol_scans ps
      LEFT JOIN patrol_checkpoints pc ON ps.checkpoint_id = pc.id
      LEFT JOIN properties p ON pc.property_id = p.id
      LEFT JOIN users u ON ps.officer_id = u.id
      WHERE ps.status = 'late' AND ps.scanned_at >= ?
      ORDER BY ps.scanned_at DESC LIMIT 1000
    `).all(cutoff) as any[];

    const missedCheckpoints = await db.prepare(`
      SELECT pc.id, pc.name, p.name as property_name, pc.scan_required_interval_minutes,
             MAX(ps.scanned_at) as last_scan
      FROM patrol_checkpoints pc
      LEFT JOIN properties p ON pc.property_id = p.id
      LEFT JOIN patrol_scans ps ON ps.checkpoint_id = pc.id
      WHERE pc.is_active = 1
      GROUP BY pc.id
      HAVING last_scan IS NULL OR last_scan < datetime('now', '-' || pc.scan_required_interval_minutes || ' minutes')
    `).all() as any[];

    const totalScans = await db.prepare("SELECT COUNT(*) as total, SUM(CASE WHEN status = 'late' THEN 1 ELSE 0 END) as late_count FROM patrol_scans WHERE scanned_at >= ?").get(cutoff) as any;

    return c.json({
      late_scans: lateScans, missed_checkpoints: missedCheckpoints, period_days: daysNum,
      total_scans: totalScans?.total || 0, late_count: totalScans?.late_count || 0,
      late_rate: totalScans?.total > 0 ? Math.round((totalScans.late_count / totalScans.total) * 100) : 0,
    });
  });

  // GET /time-tracking
  api.get('/time-tracking', async (c) => {
    const db = new D1Db(c.env.DB);
    const q = c.req.query();
    const targetDate = (q.date as string) || localToday();
    const user = c.get('user');
    const officerId = q.officer_id ? parseInt(q.officer_id, 10) : user.userId;

    const dayScans = await db.prepare(`
      SELECT ps.scanned_at, pc.name as checkpoint_name, p.name as property_name
      FROM patrol_scans ps
      LEFT JOIN patrol_checkpoints pc ON ps.checkpoint_id = pc.id
      LEFT JOIN properties p ON pc.property_id = p.id
      WHERE ps.officer_id = ? AND DATE(ps.scanned_at) = ?
      ORDER BY ps.scanned_at ASC LIMIT 1000
    `).all(officerId, targetDate) as any[];

    const segments: { from: string; to: string; from_time: string; to_time: string; duration_minutes: number }[] = [];
    let totalPatrolMinutes = 0;
    let longestGapMinutes = 0;
    let shortestGapMinutes = Infinity;

    for (let i = 1; i < dayScans.length; i++) {
      const prev = dayScans[i - 1];
      const curr = dayScans[i];
      const diffMs = new Date(curr.scanned_at).getTime() - new Date(prev.scanned_at).getTime();
      const diffMin = Math.round(diffMs / 60000);
      totalPatrolMinutes += diffMin;
      if (diffMin > longestGapMinutes) longestGapMinutes = diffMin;
      if (diffMin < shortestGapMinutes) shortestGapMinutes = diffMin;
      segments.push({ from: prev.checkpoint_name, to: curr.checkpoint_name, from_time: prev.scanned_at, to_time: curr.scanned_at, duration_minutes: diffMin });
    }

    return c.json({
      date: targetDate, officer_id: officerId, total_patrol_minutes: totalPatrolMinutes,
      total_checkpoints: dayScans.length,
      average_between_minutes: segments.length > 0 ? Math.round(totalPatrolMinutes / segments.length) : 0,
      longest_gap_minutes: longestGapMinutes,
      shortest_gap_minutes: shortestGapMinutes === Infinity ? 0 : shortestGapMinutes,
      first_scan: dayScans.length > 0 ? dayScans[0].scanned_at : null,
      last_scan: dayScans.length > 0 ? dayScans[dayScans.length - 1].scanned_at : null,
      segments,
    });
  });

  // POST /scan/:scanId/weather
  api.post('/scan/:scanId/weather', async (c) => {
    const db = new D1Db(c.env.DB);
    const scanId = paramNum(c.req.param('scanId'));
    const scan = await db.prepare('SELECT * FROM patrol_scans WHERE id = ?').get(scanId) as any;
    if (!scan) return c.json({ error: 'Scan not found', code: 'SCAN_NOT_FOUND' }, 404);

    const body = await c.req.json();
    const user = c.get('user');
    const { conditions, temperature_f, wind_mph, visibility, precipitation, humidity_pct } = body;

    const weatherData = {
      conditions: conditions || 'clear', temperature_f: temperature_f ?? null,
      wind_mph: wind_mph ?? null, visibility: visibility || 'good',
      precipitation: precipitation || 'none', humidity_pct: humidity_pct ?? null,
      recorded_at: localNow(), recorded_by: user.userId,
    };

    const existingNotes = scan.notes || '';
    const updatedNotes = existingNotes ? `${existingNotes}\n[WEATHER] ${JSON.stringify(weatherData)}` : `[WEATHER] ${JSON.stringify(weatherData)}`;

    await db.prepare('UPDATE patrol_scans SET notes = ? WHERE id = ?').run(updatedNotes, scan.id);

    try { await db.prepare('UPDATE patrol_scans SET weather_json = ? WHERE id = ?').run(JSON.stringify(weatherData), scan.id); } catch { /* column may not exist */ }

    return c.json({ success: true, weather: weatherData });
  });

  // GET /shift-summary
  api.get('/shift-summary', async (c) => {
    const db = new D1Db(c.env.DB);
    const q = c.req.query();
    const targetDate = (q.date as string) || localNow().split('T')[0];
    const user = c.get('user');
    const officerId = q.officer_id || user.userId;

    const scans = await db.prepare(`
      SELECT ps.*, pc.name as checkpoint_name, p.name as property_name
      FROM patrol_scans ps
      JOIN patrol_checkpoints pc ON ps.checkpoint_id = pc.id
      LEFT JOIN properties p ON pc.property_id = p.id
      WHERE ps.officer_id = ? AND DATE(ps.scanned_at) = ?
      ORDER BY ps.scanned_at ASC LIMIT 1000
    `).all(officerId, targetDate) as any[];

    const onTime = scans.filter((s: any) => s.status === 'on_time').length;
    const late = scans.filter((s: any) => s.status === 'late').length;

    let incidents: any[] = [];
    try { incidents = await db.prepare('SELECT id, incident_number, incident_type, status FROM incidents WHERE officer_id = ? AND DATE(created_at) = ? LIMIT 1000').all(officerId, targetDate) as any[]; } catch { /* */ }

    let totalMileage = 0;
    try {
      const breadcrumbs = await db.prepare('SELECT latitude, longitude FROM gps_breadcrumbs WHERE officer_id = ? AND DATE(recorded_at) = ? ORDER BY recorded_at ASC LIMIT 1000').all(officerId, targetDate) as any[];
      for (let i = 1; i < breadcrumbs.length; i++) {
        const prev = breadcrumbs[i - 1];
        const curr = breadcrumbs[i];
        const R = 3959;
        const dLat = (curr.latitude - prev.latitude) * Math.PI / 180;
        const dLon = (curr.longitude - prev.longitude) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(prev.latitude * Math.PI / 180) * Math.cos(curr.latitude * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
        totalMileage += R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      }
    } catch { /* breadcrumbs may not exist */ }

    let breaks: any[] = [];
    try { breaks = await db.prepare('SELECT * FROM patrol_breaks WHERE officer_id = ? AND shift_date = ? LIMIT 1000').all(officerId, targetDate) as any[]; } catch { /* */ }

    return c.json({
      date: targetDate, officer_id: officerId, scans_total: scans.length,
      scans_on_time: onTime, scans_late: late, incidents_count: incidents.length, incidents,
      estimated_mileage: Math.round(totalMileage * 10) / 10,
      breaks_count: breaks.length,
      total_break_minutes: breaks.reduce((sum: number, b: any) => sum + (b.duration_minutes || 0), 0),
      properties_visited: [...new Set(scans.map((s: any) => s.property_name))],
    });
  });

  // GET /checkpoints/:id/instructions
  api.get('/checkpoints/:id/instructions', async (c) => {
    const db = new D1Db(c.env.DB);
    const id = paramNum(c.req.param('id'));
    const checkpoint = await db.prepare(`
      SELECT pc.special_instructions, pc.name, pc.description,
        p.gate_code, p.alarm_code, p.hazard_notes, p.post_orders, p.emergency_contact, p.access_instructions
      FROM patrol_checkpoints pc
      LEFT JOIN properties p ON pc.property_id = p.id
      WHERE pc.id = ?
    `).get(id) as any;
    if (!checkpoint) return c.json({ error: 'Checkpoint not found', code: 'CHECKPOINT_NOT_FOUND' }, 404);

    return c.json({
      checkpoint_name: checkpoint.name, checkpoint_description: checkpoint.description,
      special_instructions: checkpoint.special_instructions, gate_code: checkpoint.gate_code,
      alarm_code: checkpoint.alarm_code, hazard_notes: checkpoint.hazard_notes,
      post_orders: checkpoint.post_orders, emergency_contact: checkpoint.emergency_contact,
      access_instructions: checkpoint.access_instructions,
    });
  });

  // POST /breaks/start
  api.post('/breaks/start', async (c) => {
    const db = new D1Db(c.env.DB);
    const body = await c.req.json();
    const { break_type } = body;
    const now = localNow();
    const today = now.split('T')[0];
    const user = c.get('user');

    const active = await db.prepare('SELECT * FROM patrol_breaks WHERE officer_id = ? AND shift_date = ? AND break_end IS NULL').get(user.userId, today) as any;
    if (active) return c.json({ error: 'Already on a break. End current break first.', code: 'ALREADY_ON_A_BREAK' }, 400);

    const result = await db.prepare('INSERT INTO patrol_breaks (officer_id, shift_date, break_start, break_type) VALUES (?, ?, ?, ?)')
      .run(user.userId, today, now, break_type || 'break');

    return c.json({ id: result.meta.last_row_id, break_start: now }, 201);
  });

  // POST /breaks/end
  api.post('/breaks/end', async (c) => {
    const db = new D1Db(c.env.DB);
    const now = localNow();
    const today = now.split('T')[0];
    const user = c.get('user');

    const active = await db.prepare('SELECT * FROM patrol_breaks WHERE officer_id = ? AND shift_date = ? AND break_end IS NULL').get(user.userId, today) as any;
    if (!active) return c.json({ error: 'No active break to end', code: 'NO_ACTIVE_BREAK_TO' }, 400);

    const startTime = new Date(active.break_start).getTime();
    const endTime = new Date(now).getTime();
    const durationMinutes = Math.round((endTime - startTime) / 60000 * 10) / 10;

    await db.prepare('UPDATE patrol_breaks SET break_end = ?, duration_minutes = ? WHERE id = ?').run(now, durationMinutes, active.id);
    return c.json({ success: true, duration_minutes: durationMinutes });
  });

  // GET /breaks
  api.get('/breaks', async (c) => {
    const db = new D1Db(c.env.DB);
    const q = c.req.query();
    const targetDate = (q.date as string) || localNow().split('T')[0];
    const user = c.get('user');
    const officerId = q.officer_id || user.userId;

    const breaks = await db.prepare(`
      SELECT pb.*, u.full_name as officer_name
      FROM patrol_breaks pb
      LEFT JOIN users u ON pb.officer_id = u.id
      WHERE pb.officer_id = ? AND pb.shift_date = ?
      ORDER BY pb.break_start ASC LIMIT 1000
    `).all(officerId, targetDate);
    return c.json(breaks);
  });

  // POST /proximity-check
  api.post('/proximity-check', async (c) => {
    const db = new D1Db(c.env.DB);
    const body = await c.req.json();
    const { latitude, longitude, radius_miles } = body;
    if (!latitude || !longitude) return c.json({ error: 'latitude and longitude required', code: 'LATITUDE_AND_LONGITUDE_REQUIRED' }, 400);

    const radiusMi = radius_miles || 0.5;
    const latDelta = radiusMi / 69;
    const lngDelta = radiusMi / (69 * Math.cos(latitude * Math.PI / 180));

    const activeCalls = await db.prepare(`
      SELECT id, call_number, incident_type, priority, status, location_address, latitude, longitude
      FROM calls_for_service
      WHERE status IN ('pending', 'dispatched', 'enroute', 'onscene')
        AND latitude IS NOT NULL AND longitude IS NOT NULL
        AND latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?
      LIMIT 1000
    `).all(latitude - latDelta, latitude + latDelta, longitude - lngDelta, longitude + lngDelta);

    return c.json({ nearby_calls: activeCalls, count: activeCalls.length });
  });

  // GET /efficiency
  api.get('/efficiency', async (c) => {
    const db = new D1Db(c.env.DB);
    const q = c.req.query();
    const targetDate = (q.date as string) || localNow().split('T')[0];
    const user = c.get('user');
    const officerId = q.officer_id || user.userId;

    const totalCheckpoints = await db.prepare('SELECT COUNT(*) as total FROM patrol_checkpoints WHERE is_active = 1 AND archived_at IS NULL').get() as any;
    const scansToday = await db.prepare("SELECT ps.status, COUNT(*) as count FROM patrol_scans ps WHERE ps.officer_id = ? AND DATE(ps.scanned_at) = ? GROUP BY ps.status").all(officerId, targetDate) as any[];

    const onTime = scansToday.find((s: any) => s.status === 'on_time')?.count || 0;
    const late = scansToday.find((s: any) => s.status === 'late')?.count || 0;
    const totalScans = onTime + late;
    const totalAssigned = totalCheckpoints.total || 1;

    return c.json({
      officer_id: officerId, date: targetDate, total_assigned: totalAssigned,
      scans_completed: totalScans, scans_on_time: onTime, scans_late: late,
      completion_rate: Math.round((totalScans / totalAssigned) * 100),
      on_time_rate: totalScans > 0 ? Math.round((onTime / totalScans) * 100) : 0,
      efficiency_score: Math.round(((onTime * 1.0 + late * 0.5) / totalAssigned) * 100),
    });
  });

  // GET /compliance/by-officer
  api.get('/compliance/by-officer', async (c) => {
    const db = new D1Db(c.env.DB);
    const q = c.req.query();
    const days = Math.min(90, Math.max(1, parseInt(String(q.days || '30'), 10)));
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const officers = await db.prepare(`
      SELECT ps.officer_id, u.full_name as officer_name, u.badge_number,
        COUNT(*) as total_scans,
        SUM(CASE WHEN ps.status = 'on_time' THEN 1 ELSE 0 END) as on_time,
        SUM(CASE WHEN ps.status = 'late' THEN 1 ELSE 0 END) as late,
        COUNT(DISTINCT ps.checkpoint_id) as unique_checkpoints,
        COUNT(DISTINCT DATE(ps.scanned_at)) as active_days,
        MIN(ps.scanned_at) as first_scan, MAX(ps.scanned_at) as last_scan
      FROM patrol_scans ps
      LEFT JOIN users u ON ps.officer_id = u.id
      WHERE ps.scanned_at >= ?
      GROUP BY ps.officer_id
      ORDER BY total_scans DESC
    `).all(cutoff) as any[];

    const scored = officers.map((o: any) => ({
      ...o,
      compliance_rate: o.total_scans > 0 ? Math.round((o.on_time / o.total_scans) * 100) : 0,
      efficiency_score: o.total_scans > 0 ? Math.round(((o.on_time * 1.0 + o.late * 0.5) / o.total_scans) * 100) : 0,
      avg_scans_per_day: o.active_days > 0 ? Math.round((o.total_scans / o.active_days) * 10) / 10 : 0,
    }));

    return c.json({ officers: scored, period_days: days });
  });

  // GET /coverage/analysis
  api.get('/coverage/analysis', async (c) => {
    const db = new D1Db(c.env.DB);
    const q = c.req.query();
    const days = Math.min(90, Math.max(1, parseInt(String(q.days || '7'), 10)));
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const properties = await db.prepare(`
      SELECT p.id, p.name,
        COUNT(DISTINCT pc.id) as total_checkpoints,
        COUNT(DISTINCT CASE WHEN ps.id IS NOT NULL THEN pc.id END) as scanned_checkpoints,
        COALESCE(COUNT(ps.id), 0) as total_scans,
        COALESCE(SUM(CASE WHEN ps.status = 'on_time' THEN 1 ELSE 0 END), 0) as on_time_scans
      FROM properties p
      LEFT JOIN patrol_checkpoints pc ON pc.property_id = p.id AND pc.is_active = 1
      LEFT JOIN patrol_scans ps ON ps.checkpoint_id = pc.id AND ps.scanned_at >= ?
      WHERE pc.id IS NOT NULL
      GROUP BY p.id
      ORDER BY total_checkpoints DESC
    `).all(cutoff) as any[];

    const analysis = properties.map((p: any) => ({
      ...p,
      coverage_pct: p.total_checkpoints > 0 ? Math.round((p.scanned_checkpoints / p.total_checkpoints) * 100) : 0,
      compliance_rate: p.total_scans > 0 ? Math.round((p.on_time_scans / p.total_scans) * 100) : 0,
      status: p.total_checkpoints > 0 && p.scanned_checkpoints === 0 ? 'no_coverage' : p.scanned_checkpoints < p.total_checkpoints ? 'partial_coverage' : 'full_coverage',
    }));

    return c.json({
      properties: analysis,
      summary: {
        total_properties: analysis.length,
        full_coverage: analysis.filter(a => a.status === 'full_coverage').length,
        partial_coverage: analysis.filter(a => a.status === 'partial_coverage').length,
        no_coverage: analysis.filter(a => a.status === 'no_coverage').length,
      },
      period_days: days,
    });
  });

  // GET /breaks/summary
  api.get('/breaks/summary', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    const db = new D1Db(c.env.DB);
    const q = c.req.query();
    const targetDate = (q.date as string) || localNow().split('T')[0];

    let breakSummary: any[] = [];
    try {
      breakSummary = await db.prepare(`
        SELECT pb.officer_id, u.full_name as officer_name,
          COUNT(*) as break_count, SUM(COALESCE(pb.duration_minutes, 0)) as total_minutes,
          MAX(pb.duration_minutes) as longest_break_minutes,
          MIN(pb.break_start) as first_break,
          MAX(COALESCE(pb.break_end, pb.break_start)) as last_break,
          SUM(CASE WHEN pb.break_end IS NULL THEN 1 ELSE 0 END) as currently_on_break
        FROM patrol_breaks pb
        LEFT JOIN users u ON pb.officer_id = u.id
        WHERE pb.shift_date = ?
        GROUP BY pb.officer_id
        ORDER BY total_minutes DESC
      `).all(targetDate);
    } catch { /* table may not exist */ }

    return c.json({
      date: targetDate, officers: breakSummary,
      total_break_minutes: breakSummary.reduce((s: number, b: any) => s + (b.total_minutes || 0), 0),
      officers_on_break: breakSummary.filter((b: any) => b.currently_on_break > 0).length,
    });
  });

  app.route('/api/patrol', api);
}

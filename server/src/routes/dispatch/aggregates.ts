import { Router, Request, Response } from 'express';
import { getDb } from '../../models/database';
import { authenticateToken, requireRole } from '../../middleware/auth';
import { broadcastDispatchUpdate, broadcastUnitUpdate, broadcastPanic } from '../../utils/websocket';
import { generateCallNumber } from '../../utils/caseNumbers';
import { localNow } from '../../utils/timeUtils';
import { reverseGeocodeAddress } from '../../utils/geocode';
import { identifyBeat } from '../../utils/geofence';
import { escapeLike } from '../../middleware/sanitize';
import { auditLog } from '../../utils/auditLogger';

const router = Router();

// All routes require authentication
router.use(authenticateToken);

// GET /api/dispatch/heatmap - Aggregated call locations for heat map display
// Query params: days (int), mode ('all'|'risk'|'type'), type (incident_type filter)
router.get('/heatmap', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const days = Math.max(1, Math.min(365, parseInt(req.query.days as string, 10) || 30));
    const mode = (req.query.mode as string) || 'all';
    const typeFilter = req.query.type as string | undefined;

    const validModes = ['all', 'risk', 'type'];
    if (!validModes.includes(mode)) {
      res.status(400).json({ error: `Invalid mode. Must be one of: ${validModes.join(', ')}` });
      return;
    }

    if (typeFilter && (typeof typeFilter !== 'string' || typeFilter.length > 100)) {
      res.status(400).json({ error: 'Invalid type filter' });
      return;
    }

    const cutoff = `-${days}`;

    if (mode === 'risk') {
      // Risk-weighted: only calls with risk flags, weighted by severity
      const points = db.prepare(`
        SELECT
          ROUND(latitude, 3) as latitude,
          ROUND(longitude, 3) as longitude,
          COUNT(*) as count,
          SUM(CASE WHEN weapons_involved IS NOT NULL AND weapons_involved != '' AND weapons_involved != '0' THEN 3 ELSE 0 END
            + CASE WHEN domestic_violence = 1 THEN 2 ELSE 0 END
            + CASE WHEN injuries_reported = 1 THEN 2 ELSE 0 END
            + CASE WHEN alcohol_involved = 1 THEN 1 ELSE 0 END
            + CASE WHEN drugs_involved = 1 THEN 1 ELSE 0 END
          ) as risk_weight,
          SUM(CASE WHEN weapons_involved IS NOT NULL AND weapons_involved != '' AND weapons_involved != '0' THEN 1 ELSE 0 END) as weapons_count,
          SUM(CASE WHEN domestic_violence = 1 THEN 1 ELSE 0 END) as dv_count,
          SUM(CASE WHEN injuries_reported = 1 THEN 1 ELSE 0 END) as injuries_count
        FROM calls_for_service
        WHERE latitude IS NOT NULL AND longitude IS NOT NULL
          AND created_at >= datetime('now', 'localtime', ? || ' days')
          AND (weapons_involved IS NOT NULL AND weapons_involved != '' AND weapons_involved != '0'
               OR domestic_violence = 1 OR injuries_reported = 1
               OR alcohol_involved = 1 OR drugs_involved = 1)
        GROUP BY ROUND(latitude, 3), ROUND(longitude, 3)
        ORDER BY risk_weight DESC
        LIMIT 300
      `).all(cutoff);
      return res.json(points);
    }

    if (mode === 'type' && typeFilter) {
      // Filtered by specific incident type
      const points = db.prepare(`
        SELECT
          ROUND(latitude, 3) as latitude,
          ROUND(longitude, 3) as longitude,
          COUNT(*) as count
        FROM calls_for_service
        WHERE latitude IS NOT NULL AND longitude IS NOT NULL
          AND created_at >= datetime('now', 'localtime', ? || ' days')
          AND incident_type = ?
        GROUP BY ROUND(latitude, 3), ROUND(longitude, 3)
        ORDER BY count DESC
        LIMIT 200
      `).all(cutoff, typeFilter);
      return res.json(points);
    }

    // Default: all calls with enriched metadata for click info
    const points = db.prepare(`
      SELECT
        ROUND(latitude, 3) as latitude,
        ROUND(longitude, 3) as longitude,
        COUNT(*) as count,
        GROUP_CONCAT(DISTINCT incident_type) as incident_types,
        SUM(CASE WHEN priority = 'P1' THEN 1 ELSE 0 END) as p1_count,
        SUM(CASE WHEN weapons_involved IS NOT NULL AND weapons_involved != '' AND weapons_involved != '0' THEN 1 ELSE 0 END) as weapons_count,
        SUM(CASE WHEN domestic_violence = 1 THEN 1 ELSE 0 END) as dv_count,
        SUM(CASE WHEN injuries_reported = 1 THEN 1 ELSE 0 END) as injuries_count
      FROM calls_for_service
      WHERE latitude IS NOT NULL AND longitude IS NOT NULL
        AND created_at >= datetime('now', 'localtime', ? || ' days')
      GROUP BY ROUND(latitude, 3), ROUND(longitude, 3)
      ORDER BY count DESC
      LIMIT 200
    `).all(cutoff);

    res.json(points);
  } catch (error: any) {
    console.error('[Dispatch] heatmap error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/dispatch/heatmap/types - Available incident types for heatmap filter
router.get('/heatmap/types', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const types = db.prepare(`
      SELECT incident_type, COUNT(*) as count
      FROM calls_for_service
      WHERE incident_type IS NOT NULL AND incident_type != ''
        AND created_at >= datetime('now', 'localtime', '-90 days')
      GROUP BY incident_type
      ORDER BY count DESC
      LIMIT 50
    `).all();
    res.json(types);
  } catch (error: any) {
    console.error('[Dispatch] heatmap types error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to get heatmap types' });
  }
});

// GET /api/dispatch/heatmap/advanced - Enhanced heatmap with filtering, clustering, comparison
router.get('/heatmap/advanced', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const days = Math.max(1, Math.min(365, parseInt(req.query.days as string, 10) || 30));
    const mode = (req.query.mode as string) || 'density'; // density | risk | temporal | comparison
    const typesRaw = req.query.types as string | undefined; // comma-separated
    const hourStart = parseInt(req.query.hourStart as string, 10);
    const hourEnd = parseInt(req.query.hourEnd as string, 10);
    const dayFilterRaw = req.query.dayFilter as string | undefined; // comma-separated 0-6
    const resolution = (req.query.resolution as string) || 'medium'; // fine=0.001, medium=0.003, coarse=0.005
    const comparisonDays = parseInt(req.query.comparisonDays as string, 10) || days;
    const temporalHour = parseInt(req.query.temporalHour as string, 10); // for temporal mode single-hour

    // Resolution mapping
    const resMap: Record<string, number> = { fine: 1, medium: 3, coarse: 5 };
    const roundDigits = resMap[resolution] || 3;

    // Parse multi-type filter
    const types = typesRaw ? typesRaw.split(',').filter(t => t.length > 0 && t.length < 100).slice(0, 20) : [];

    // Parse day-of-week filter (0=Sun, 6=Sat)
    const dayFilter = dayFilterRaw ? dayFilterRaw.split(',').map(Number).filter(n => n >= 0 && n <= 6) : [];

    // Build WHERE clauses
    const cutoff = `-${days}`;
    const conditions: string[] = [
      'latitude IS NOT NULL',
      'longitude IS NOT NULL',
      `created_at >= datetime('now', 'localtime', '${cutoff} days')`,
    ];
    const params: any[] = [];

    // Hour range filter
    const hasHourFilter = !isNaN(hourStart) && !isNaN(hourEnd) && hourStart >= 0 && hourStart <= 23 && hourEnd >= 0 && hourEnd <= 23;
    if (hasHourFilter) {
      if (hourStart <= hourEnd) {
        conditions.push(`CAST(strftime('%H', created_at) AS INTEGER) >= ? AND CAST(strftime('%H', created_at) AS INTEGER) <= ?`);
        params.push(hourStart, hourEnd);
      } else {
        // Wrapping range e.g. 18-2 means 18,19,20,21,22,23,0,1,2
        conditions.push(`(CAST(strftime('%H', created_at) AS INTEGER) >= ? OR CAST(strftime('%H', created_at) AS INTEGER) <= ?)`);
        params.push(hourStart, hourEnd);
      }
    }

    // Day-of-week filter (SQLite: %w gives 0=Sunday)
    if (dayFilter.length > 0 && dayFilter.length < 7) {
      const placeholders = dayFilter.map(() => '?').join(',');
      conditions.push(`CAST(strftime('%w', created_at) AS INTEGER) IN (${placeholders})`);
      params.push(...dayFilter);
    }

    // Type filter
    if (types.length > 0) {
      const placeholders = types.map(() => '?').join(',');
      conditions.push(`incident_type IN (${placeholders})`);
      params.push(...types);
    }

    const whereClause = conditions.join(' AND ');

    // --- Main query ---
    const roundExpr = roundDigits === 1 ? 'ROUND(latitude, 3)' : roundDigits === 5 ? 'ROUND(latitude, 2)' : 'ROUND(latitude, 3)';
    const roundExprLng = roundDigits === 1 ? 'ROUND(longitude, 3)' : roundDigits === 5 ? 'ROUND(longitude, 2)' : 'ROUND(longitude, 3)';
    // For fine resolution, use 3 decimal places; for medium 3; for coarse 2
    const latRound = resolution === 'coarse' ? 2 : 3;
    const lngRound = resolution === 'coarse' ? 2 : 3;

    // For temporal mode with a specific hour, add extra filter
    let temporalConditions = '';
    const temporalParams: any[] = [];
    if (mode === 'temporal' && !isNaN(temporalHour) && temporalHour >= 0 && temporalHour <= 23) {
      temporalConditions = ` AND CAST(strftime('%H', created_at) AS INTEGER) = ?`;
      temporalParams.push(temporalHour);
    }

    const pointsQuery = `
      SELECT
        ROUND(latitude, ${latRound}) as latitude,
        ROUND(longitude, ${lngRound}) as longitude,
        COUNT(*) as count,
        GROUP_CONCAT(DISTINCT incident_type) as types,
        SUM(CASE WHEN weapons_involved IS NOT NULL AND weapons_involved != '' AND weapons_involved != '0' THEN 3 ELSE 0 END
          + CASE WHEN domestic_violence = 1 THEN 2 ELSE 0 END
          + CASE WHEN injuries_reported = 1 THEN 2 ELSE 0 END
          + CASE WHEN alcohol_involved = 1 THEN 1 ELSE 0 END
          + CASE WHEN drugs_involved = 1 THEN 1 ELSE 0 END
        ) as riskScore
      FROM calls_for_service
      WHERE ${whereClause}${temporalConditions}
      GROUP BY ROUND(latitude, ${latRound}), ROUND(longitude, ${lngRound})
      ORDER BY ${mode === 'risk' ? 'riskScore' : 'count'} DESC
      LIMIT 500
    `;

    const points = db.prepare(pointsQuery).all(...params, ...temporalParams) as any[];

    // Format points with weight based on mode
    const formattedPoints = points.map((p: any) => ({
      lat: p.latitude,
      lng: p.longitude,
      weight: mode === 'risk' ? Math.max(p.riskScore || 1, p.count) : (p.count || 1),
      count: p.count,
      types: p.types || '',
      riskScore: p.riskScore || 0,
    }));

    // --- Cluster detection (DBSCAN-like grouping) ---
    const clusters: any[] = [];
    const clusterThreshold = resolution === 'fine' ? 0.003 : resolution === 'coarse' ? 0.01 : 0.005;
    const minClusterPoints = 3;
    const visited = new Set<number>();

    for (let i = 0; i < formattedPoints.length; i++) {
      if (visited.has(i)) continue;
      const cluster: number[] = [i];
      visited.add(i);

      for (let j = i + 1; j < formattedPoints.length; j++) {
        if (visited.has(j)) continue;
        const dist = Math.sqrt(
          Math.pow(formattedPoints[i].lat - formattedPoints[j].lat, 2) +
          Math.pow(formattedPoints[i].lng - formattedPoints[j].lng, 2)
        );
        if (dist <= clusterThreshold) {
          cluster.push(j);
          visited.add(j);
        }
      }

      if (cluster.length >= minClusterPoints) {
        const clusterPoints = cluster.map(idx => formattedPoints[idx]);
        const centerLat = clusterPoints.reduce((s, p) => s + p.lat, 0) / clusterPoints.length;
        const centerLng = clusterPoints.reduce((s, p) => s + p.lng, 0) / clusterPoints.length;
        const totalCount = clusterPoints.reduce((s, p) => s + p.count, 0);
        const avgRisk = clusterPoints.reduce((s, p) => s + p.riskScore, 0) / clusterPoints.length;
        const maxDist = clusterPoints.reduce((max, p) => {
          const d = Math.sqrt(Math.pow(p.lat - centerLat, 2) + Math.pow(p.lng - centerLng, 2));
          return Math.max(max, d);
        }, 0);

        clusters.push({
          center: { lat: centerLat, lng: centerLng },
          radius: Math.max(maxDist * 111000, 200), // Convert degrees to meters, min 200m
          count: totalCount,
          avgRisk: Math.round(avgRisk * 10) / 10,
        });
      }
    }

    // --- Statistics ---
    const statsQuery = `
      SELECT
        COUNT(*) as total,
        CAST(strftime('%H', created_at) AS INTEGER) as hour,
        CAST(strftime('%w', created_at) AS INTEGER) as dow,
        incident_type
      FROM calls_for_service
      WHERE ${whereClause}${temporalConditions}
    `;

    // Get total
    const totalRow = db.prepare(`SELECT COUNT(*) as total FROM calls_for_service WHERE ${whereClause}${temporalConditions}`).get(...params, ...temporalParams) as any;

    // Get top types
    const topTypes = db.prepare(`
      SELECT incident_type, COUNT(*) as count
      FROM calls_for_service
      WHERE ${whereClause}${temporalConditions} AND incident_type IS NOT NULL AND incident_type != ''
      GROUP BY incident_type
      ORDER BY count DESC
      LIMIT 5
    `).all(...params, ...temporalParams) as any[];

    // Get peak hour
    const peakHourRow = db.prepare(`
      SELECT CAST(strftime('%H', created_at) AS INTEGER) as hour, COUNT(*) as count
      FROM calls_for_service
      WHERE ${whereClause}${temporalConditions}
      GROUP BY hour
      ORDER BY count DESC
      LIMIT 1
    `).get(...params, ...temporalParams) as any;

    // Get peak day
    const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const peakDayRow = db.prepare(`
      SELECT CAST(strftime('%w', created_at) AS INTEGER) as dow, COUNT(*) as count
      FROM calls_for_service
      WHERE ${whereClause}${temporalConditions}
      GROUP BY dow
      ORDER BY count DESC
      LIMIT 1
    `).get(...params, ...temporalParams) as any;

    const stats = {
      total: totalRow?.total || 0,
      topTypes: topTypes.map((t: any) => ({ type: t.incident_type, count: t.count })),
      peakHour: peakHourRow?.hour ?? null,
      peakDay: peakDayRow ? DAY_NAMES[peakDayRow.dow] : null,
    };

    // --- Comparison mode: fetch previous period ---
    let comparisonPoints: any[] = [];
    if (mode === 'comparison') {
      const compCutoffStart = `-${days + comparisonDays}`;
      const compCutoffEnd = `-${days}`;

      // Build comparison conditions (same filters but different date range)
      const compConditions = conditions.map(c => {
        if (c.includes('created_at >=')) {
          return `created_at >= datetime('now', 'localtime', '${compCutoffStart} days') AND created_at < datetime('now', 'localtime', '${compCutoffEnd} days')`;
        }
        return c;
      });

      const compWhere = compConditions.join(' AND ');
      // Params are the same minus the date param (which is inlined)
      const compPoints = db.prepare(`
        SELECT
          ROUND(latitude, ${latRound}) as latitude,
          ROUND(longitude, ${lngRound}) as longitude,
          COUNT(*) as count,
          GROUP_CONCAT(DISTINCT incident_type) as types,
          SUM(CASE WHEN weapons_involved IS NOT NULL AND weapons_involved != '' AND weapons_involved != '0' THEN 3 ELSE 0 END
            + CASE WHEN domestic_violence = 1 THEN 2 ELSE 0 END
            + CASE WHEN injuries_reported = 1 THEN 2 ELSE 0 END
          ) as riskScore
        FROM calls_for_service
        WHERE ${compWhere}
        GROUP BY ROUND(latitude, ${latRound}), ROUND(longitude, ${lngRound})
        ORDER BY count DESC
        LIMIT 500
      `).all(...params) as any[];

      comparisonPoints = compPoints.map((p: any) => ({
        lat: p.latitude,
        lng: p.longitude,
        weight: p.count || 1,
        count: p.count,
        types: p.types || '',
        riskScore: p.riskScore || 0,
      }));
    }

    res.json({
      points: formattedPoints,
      comparisonPoints: mode === 'comparison' ? comparisonPoints : undefined,
      clusters,
      stats,
    });
  } catch (error: any) {
    console.error('[Dispatch] advanced heatmap error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/dispatch/queue - Active dispatch queue
router.get('/queue', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const calls = db.prepare(`
      SELECT c.*, p.name as property_name, u.full_name as dispatcher_name
      FROM calls_for_service c
      LEFT JOIN properties p ON c.property_id = p.id
      LEFT JOIN users u ON c.dispatcher_id = u.id
      WHERE c.status IN ('pending', 'dispatched', 'enroute', 'onscene')
      ORDER BY
        CASE c.priority WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 WHEN 'P4' THEN 4 END,
        c.created_at ASC
    `).all();

    res.json(calls);
  } catch (error: any) {
    console.error('[Dispatch] get queue error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/dispatch/stats - Current dispatch statistics
router.get('/stats', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();

    const callsByStatus = db.prepare(`
      SELECT status, COUNT(*) as count FROM calls_for_service
      WHERE DATE(created_at) = DATE('now', 'localtime')
      GROUP BY status
    `).all();

    const callsByPriority = db.prepare(`
      SELECT priority, COUNT(*) as count FROM calls_for_service
      WHERE DATE(created_at) = DATE('now', 'localtime')
      GROUP BY priority
    `).all();

    const unitsByStatus = db.prepare(`
      SELECT status, COUNT(*) as count FROM units GROUP BY status
    `).all();

    const activeCalls = db.prepare(`
      SELECT COUNT(*) as count FROM calls_for_service
      WHERE status IN ('pending', 'dispatched', 'enroute', 'onscene')
    `).get() as any;

    const todayTotal = db.prepare(`
      SELECT COUNT(*) as count FROM calls_for_service
      WHERE DATE(created_at) = DATE('now', 'localtime')
    `).get() as any;

    const avgResponseTime = db.prepare(`
      SELECT AVG(
        (julianday(onscene_at) - julianday(created_at)) * 24 * 60
      ) as avg_minutes
      FROM calls_for_service
      WHERE onscene_at IS NOT NULL AND DATE(created_at) = DATE('now', 'localtime')
    `).get() as any;

    res.json({
      activeCalls: activeCalls.count,
      todayTotal: todayTotal.count,
      avgResponseMinutes: avgResponseTime.avg_minutes ? Math.round(avgResponseTime.avg_minutes * 10) / 10 : null,
      callsByStatus,
      callsByPriority,
      unitsByStatus,
    });
  } catch (error: any) {
    console.error('[Dispatch] get stats error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/dispatch/panic - Emergency PANIC button
// Broadcasts audible alert to all connected users
router.post('/panic', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { latitude, longitude, message } = req.body;

    // Validate panic input
    if (message !== undefined && message !== null) {
      if (typeof message !== 'string' || message.length > 500) {
        res.status(400).json({ error: 'Message must be a string of 500 characters or less' });
        return;
      }
    }

    const user = db.prepare('SELECT id, full_name, badge_number, role FROM users WHERE id = ?')
      .get(req.user!.userId) as any;

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const now = localNow();

    // ── Reverse-geocode officer GPS → address (with fallback) ──
    // Must happen BEFORE the transaction since it's async
    let locationAddress = latitude != null && longitude != null && Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude))
      ? `GPS: ${Number(latitude).toFixed(5)}, ${Number(longitude).toFixed(5)}`
      : 'Unknown location';

    if (latitude != null && longitude != null) {
      try {
        const addr = await reverseGeocodeAddress(Number(latitude), Number(longitude));
        if (addr) locationAddress = addr;
      } catch { /* keep GPS fallback */ }
    }

    // ── All DB writes in a single transaction for atomicity ──
    const callNumber = generateCallNumber(db);
    const description = `PANIC ALARM — Officer ${user.full_name} (Badge: ${user.badge_number || 'N/A'}) triggered emergency alert.${message ? ' Message: ' + message : ''}`;

    const panicTx = db.transaction(() => {
      // Log the panic alert to activity log
      db.prepare(`
        INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, 'panic_alert', 'user', ?, ?, ?)
      `).run(
        user.id,
        user.id,
        `PANIC ALERT triggered by ${user.full_name} (${user.badge_number || 'N/A'})${message ? ': ' + message : ''}`,
        req.ip || 'unknown'
      );

      // Auto-create "Officer Assist — Panic Alarm" dispatch call
      const callResult = db.prepare(`
        INSERT INTO calls_for_service (
          call_number, incident_type, priority, status,
          caller_name, location_address, latitude, longitude,
          description, source, dispatcher_id,
          weapons_involved, created_at, dispatched_at
        ) VALUES (?, 'officer_assist', 'P1', 'dispatched',
          ?, ?, ?, ?,
          ?, 'panic', ?,
          'unknown', ?, ?)
      `).run(
        callNumber,
        user.full_name,
        locationAddress,
        latitude ?? null,
        longitude ?? null,
        description,
        user.id,
        now,
        now,
      );

      const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?')
        .get(callResult.lastInsertRowid) as any;
      if (!call) throw new Error('Failed to retrieve auto-created panic call');

      // Auto-assign officer's unit to the call
      const unit = db.prepare('SELECT id, call_sign FROM units WHERE officer_id = ?')
        .get(user.id) as any;

      if (unit) {
        db.prepare('UPDATE units SET status = ?, current_call_id = ?, last_status_change = ? WHERE id = ?')
          .run('dispatched', call.id, now, unit.id);

        const unitIds = JSON.stringify([unit.id]);
        db.prepare('UPDATE calls_for_service SET assigned_unit_ids = ? WHERE id = ?')
          .run(unitIds, call.id);
      }

      // Log call creation
      db.prepare(`
        INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, 'call_created', 'call', ?, ?, ?)
      `).run(user.id, call.id, `PANIC auto-created ${callNumber}: officer_assist`, req.ip || 'unknown');

      return { call, unit };
    });

    const { call, unit } = panicTx();

    // ── Broadcasts happen AFTER transaction commits ──
    if (unit) {
      broadcastUnitUpdate({ action: 'unit_status_changed', unit: { ...unit, status: 'dispatched', current_call_id: call.id } });
    }

    broadcastPanic({
      user_id: user.id,
      user_name: user.full_name,
      badge_number: user.badge_number,
      role: user.role,
      message: message || null,
      latitude: latitude ?? null,
      longitude: longitude ?? null,
      triggered_at: now,
      call_number: callNumber,
      call_id: call.id,
      location_address: locationAddress,
      unit_call_sign: unit?.call_sign || null,
    });

    const enrichedCall = db.prepare(`
      SELECT c.*, u.full_name as dispatcher_name
      FROM calls_for_service c
      LEFT JOIN users u ON c.dispatcher_id = u.id
      WHERE c.id = ?
    `).get(call.id);

    broadcastDispatchUpdate({ action: 'call_created', call: enrichedCall || call });

    auditLog(req, 'panic_activated', 'call', call.id, `PANIC alert by ${user.full_name} (${user.badge_number || 'N/A'}) — call ${callNumber} created`);

    res.json({
      success: true,
      message: 'Panic alert sent — dispatch call created',
      call_number: callNumber,
      call_id: call.id,
    });
  } catch (error: any) {
    console.error('[Dispatch] panic alert error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/dispatch/premise-history - Premise history lookup
// Returns prior calls at or near a given address.
router.get('/premise-history', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { address } = req.query;

    if (!address || typeof address !== 'string' || address.length < 3) {
      res.status(400).json({ error: 'Address must be at least 3 characters' });
      return;
    }

    if (address.length > 300) {
      res.status(400).json({ error: 'Address must be 300 characters or less' });
      return;
    }

    const searchTerm = `%${escapeLike(String(address))}%`;

    // Find prior calls at this address (fuzzy match on location_address)
    const calls = db.prepare(`
      SELECT c.id, c.call_number, c.incident_type, c.priority, c.status, c.disposition,
        c.location_address, c.created_at, c.cleared_at,
        c.weapons_involved, c.domestic_violence, c.injuries_reported,
        c.alcohol_involved, c.drugs_involved, c.description
      FROM calls_for_service c
      WHERE c.location_address LIKE ? ESCAPE '\\'
      ORDER BY c.created_at DESC
      LIMIT 20
    `).all(searchTerm) as any[];

    // Determine if there are hazardous warnings
    const warningTypes: string[] = [];
    for (const call of calls) {
      if (call.weapons_involved && call.weapons_involved !== 'None' && !warningTypes.includes('ARMED'))
        warningTypes.push('ARMED');
      if (call.domestic_violence && !warningTypes.includes('DV'))
        warningTypes.push('DV');
      if (call.injuries_reported && !warningTypes.includes('INJURIES'))
        warningTypes.push('INJURIES');
      if (call.alcohol_involved && !warningTypes.includes('ALCOHOL'))
        warningTypes.push('ALCOHOL');
      if (call.drugs_involved && !warningTypes.includes('DRUGS'))
        warningTypes.push('DRUGS');
    }

    // Check for high-risk incident types in history
    const highRiskTypes = ['shooting', 'shots_fired', 'armed', 'barricade', 'hostage', 'hazmat', 'officer_assist'];
    for (const call of calls) {
      const itype = (call.incident_type || '').toLowerCase();
      if (highRiskTypes.some(t => itype.includes(t)) && !warningTypes.includes('HIGH_RISK_HISTORY'))
        warningTypes.push('HIGH_RISK_HISTORY');
    }

    // Also check property hazard notes if we can match a property
    let propertyHazard: string | null = null;
    try {
      const prop = db.prepare(`
        SELECT hazard_notes FROM properties WHERE address LIKE ? ESCAPE '\\' AND hazard_notes IS NOT NULL LIMIT 1
      `).get(searchTerm) as any;
      if (prop?.hazard_notes) {
        propertyHazard = prop.hazard_notes;
        if (!warningTypes.includes('PROPERTY_HAZARD')) warningTypes.push('PROPERTY_HAZARD');
      }
    } catch { /* properties table may not have hazard_notes */ }

    res.json({
      calls,
      total: calls.length,
      hasWarnings: warningTypes.length > 0,
      warningTypes,
      propertyHazard,
    });
  } catch (error: any) {
    console.error('[Dispatch] premise history error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/dispatch/safety-screen - Officer Safety Auto-Screening
// Searches persons and warrants by name to detect active warrants, caution flags, criminal history.
router.get('/safety-screen', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { name } = req.query;

    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      return res.json({ persons: [], directWarrantHits: [], hasWarnings: false });
    }

    if (name.length > 200) {
      res.status(400).json({ error: 'Name must be 200 characters or less' });
      return;
    }

    const searchName = name.trim();

    // Split into possible first/last name parts
    const parts = searchName.split(/[\s,]+/).filter(Boolean);

    // ── Search persons table ──
    let personRows: any[] = [];
    if (parts.length >= 2) {
      // Try both orderings: "first last" and "last, first"
      personRows = db.prepare(`
        SELECT * FROM persons
        WHERE (first_name LIKE ? ESCAPE '\\' AND last_name LIKE ? ESCAPE '\\')
           OR (first_name LIKE ? ESCAPE '\\' AND last_name LIKE ? ESCAPE '\\')
           OR (first_name || ' ' || last_name LIKE ? ESCAPE '\\')
        LIMIT 10
      `).all(
        `%${escapeLike(parts[0])}%`, `%${escapeLike(parts[1])}%`,
        `%${escapeLike(parts[1])}%`, `%${escapeLike(parts[0])}%`,
        `%${escapeLike(searchName)}%`
      );
    } else if (parts.length === 1) {
      personRows = db.prepare(`
        SELECT * FROM persons
        WHERE first_name LIKE ? ESCAPE '\\' OR last_name LIKE ? ESCAPE '\\'
        LIMIT 10
      `).all(`%${escapeLike(parts[0])}%`, `%${escapeLike(parts[0])}%`);
    }

    // Enrich each person with warrants and criminal history
    const persons = personRows.map((person: any) => {
      const warrants = db.prepare(`
        SELECT w.* FROM warrants w
        WHERE w.status = 'active'
          AND w.subject_person_id = ?
      `).all(person.id);

      const criminalHistory = db.prepare(`
        SELECT * FROM criminal_history WHERE person_id = ? ORDER BY charge_date DESC LIMIT 10
      `).all(person.id);

      return { person, warrants, criminalHistory };
    });

    // ── Search warrants directly by subject name (via persons join) ──
    let directWarrantHits: any[] = [];
    if (parts.length >= 2) {
      directWarrantHits = db.prepare(`
        SELECT w.*, p.first_name AS subject_first_name, p.last_name AS subject_last_name
        FROM warrants w
        LEFT JOIN persons p ON w.subject_person_id = p.id
        WHERE w.status = 'active'
          AND ((p.first_name LIKE ? ESCAPE '\\' AND p.last_name LIKE ? ESCAPE '\\')
            OR (p.first_name LIKE ? ESCAPE '\\' AND p.last_name LIKE ? ESCAPE '\\'))
        LIMIT 10
      `).all(
        `%${escapeLike(parts[0])}%`, `%${escapeLike(parts[1])}%`,
        `%${escapeLike(parts[1])}%`, `%${escapeLike(parts[0])}%`
      );
    } else if (parts.length === 1) {
      directWarrantHits = db.prepare(`
        SELECT w.*, p.first_name AS subject_first_name, p.last_name AS subject_last_name
        FROM warrants w
        LEFT JOIN persons p ON w.subject_person_id = p.id
        WHERE w.status = 'active'
          AND (p.first_name LIKE ? ESCAPE '\\' OR p.last_name LIKE ? ESCAPE '\\')
        LIMIT 10
      `).all(`%${escapeLike(parts[0])}%`, `%${escapeLike(parts[0])}%`);
    }

    // Deduplicate warrant hits (already found via person enrichment)
    const personWarrantIds = new Set(
      persons.flatMap(p => p.warrants.map((w: any) => w.id))
    );
    const uniqueDirectWarrants = directWarrantHits.filter(
      (w: any) => !personWarrantIds.has(w.id)
    );

    // Determine if any warnings exist
    const hasWarnings =
      persons.some(p =>
        p.warrants.length > 0 ||
        p.person.caution_flags ||
        p.person.is_sex_offender ||
        p.person.has_criminal_history
      ) ||
      uniqueDirectWarrants.length > 0;

    res.json({
      persons,
      directWarrantHits: uniqueDirectWarrants,
      hasWarnings,
    });
  } catch (error: any) {
    console.error('[Dispatch] safety screen error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/dispatch/districts - List all 3-tier dispatch districts
router.get('/districts', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const districts = db.prepare('SELECT * FROM dispatch_districts ORDER BY section_id, zone_id, beat_id LIMIT 5000').all();
    res.json(districts);
  } catch (error: any) {
    console.error('[Dispatch] districts list error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/dispatch/districts/lookup - Lookup 3-tier by zone_id + beat_id
router.get('/districts/lookup', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { zone_id, beat_id } = req.query;

    if (!zone_id || typeof zone_id !== 'string' || zone_id.length > 50) {
      res.status(400).json({ error: 'zone_id is required (max 50 chars)' });
      return;
    }

    if (beat_id && (typeof beat_id !== 'string' || beat_id.length > 50)) {
      res.status(400).json({ error: 'beat_id must be 50 characters or less' });
      return;
    }

    let district: any;
    if (beat_id) {
      district = db.prepare(
        'SELECT * FROM dispatch_districts WHERE zone_id = ? AND beat_id = ?'
      ).get(zone_id, beat_id);
    } else {
      // Return first matching zone entry
      district = db.prepare(
        'SELECT * FROM dispatch_districts WHERE zone_id = ? LIMIT 1'
      ).get(zone_id);
    }

    if (!district) {
      res.json({ found: false });
      return;
    }

    res.json({ found: true, district });
  } catch (error: any) {
    console.error('[Dispatch] district lookup error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/dispatch/districts/identify - Identify district from GPS coordinates
router.get('/districts/identify', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { lat, lng } = req.query;
    if (!lat || !lng) {
      res.status(400).json({ error: 'lat and lng are required' });
      return;
    }
    const latNum = Number(lat);
    const lngNum = Number(lng);
    if (!Number.isFinite(latNum) || latNum < -90 || latNum > 90 ||
        !Number.isFinite(lngNum) || lngNum < -180 || lngNum > 180) {
      res.status(400).json({ error: 'lat must be -90..90, lng must be -180..180' });
      return;
    }

    const beat = identifyBeat(latNum, lngNum);
    if (!beat) {
      res.json({ found: false });
      return;
    }

    // Lookup dispatch_districts table for rich names
    const district = db.prepare(
      'SELECT * FROM dispatch_districts WHERE zone_id = ? AND beat_id = ?'
    ).get(beat.city_code, beat.district_letter) as any;

    if (district) {
      res.json({
        found: true,
        section_id: district.section_id,
        zone_id: district.zone_name,
        beat_id: `${district.beat_name} — ${district.beat_descriptor || ''}`.trim(),
        dispatch_code: district.dispatch_code,
        section_name: district.section_name,
        zone_name: district.zone_name,
        beat_name: district.beat_name,
        beat_descriptor: district.beat_descriptor,
      });
    } else {
      // Fallback to raw geofence data
      res.json({
        found: true,
        section_id: beat.district_letter,
        zone_id: `${beat.city} ${beat.district_letter}${beat.beat_number}`,
        beat_id: beat.beat_id,
      });
    }
  } catch (error: any) {
    console.error('[Dispatch] district identify error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/dispatch/heatmap/timelapse - Animated heatmap data sliced by time
router.get('/heatmap/timelapse', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const days = Math.max(1, Math.min(90, parseInt(req.query.days as string, 10) || 7));
    const mode = (req.query.mode as string) || 'all';
    const validModes = ['all', 'risk'];
    if (!validModes.includes(mode)) {
      res.status(400).json({ error: `Invalid mode. Must be one of: ${validModes.join(', ')}` });
      return;
    }

    // Determine slice duration based on range
    let sliceHours: number;
    if (req.query.slices) {
      const totalHours = days * 24;
      const requestedSlices = Math.max(1, Math.min(500, parseInt(req.query.slices as string, 10) || 24));
      sliceHours = Math.max(1, Math.floor(totalHours / requestedSlices));
    } else if (days <= 7) {
      sliceHours = 1; // hourly
    } else if (days <= 30) {
      sliceHours = 6; // 6-hour blocks
    } else {
      sliceHours = 24; // daily
    }

    const totalHours = days * 24;
    const sliceCount = Math.ceil(totalHours / sliceHours);
    const now = new Date();
    const startTime = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    const riskFilter = mode === 'risk'
      ? `AND (weapons_involved IS NOT NULL AND weapons_involved != '' AND weapons_involved != '0'
           OR domestic_violence = 1 OR injuries_reported = 1
           OR alcohol_involved = 1 OR drugs_involved = 1)`
      : '';

    const riskColumns = mode === 'risk'
      ? `, SUM(CASE WHEN weapons_involved IS NOT NULL AND weapons_involved != '' AND weapons_involved != '0' THEN 3 ELSE 0 END
            + CASE WHEN domestic_violence = 1 THEN 2 ELSE 0 END
            + CASE WHEN injuries_reported = 1 THEN 2 ELSE 0 END
            + CASE WHEN alcohol_involved = 1 THEN 1 ELSE 0 END
            + CASE WHEN drugs_involved = 1 THEN 1 ELSE 0 END
          ) as risk_weight`
      : '';

    const slices: { start: string; end: string; points: any[] }[] = [];

    for (let i = 0; i < sliceCount; i++) {
      const sliceStart = new Date(startTime.getTime() + i * sliceHours * 60 * 60 * 1000);
      const sliceEnd = new Date(sliceStart.getTime() + sliceHours * 60 * 60 * 1000);

      const startStr = sliceStart.toISOString().replace('T', ' ').slice(0, 19);
      const endStr = sliceEnd.toISOString().replace('T', ' ').slice(0, 19);

      const points = db.prepare(`
        SELECT
          ROUND(latitude, 3) as latitude,
          ROUND(longitude, 3) as longitude,
          COUNT(*) as count
          ${riskColumns}
        FROM calls_for_service
        WHERE latitude IS NOT NULL AND longitude IS NOT NULL
          AND created_at >= ? AND created_at < ?
          ${riskFilter}
        GROUP BY ROUND(latitude, 3), ROUND(longitude, 3)
        ORDER BY count DESC
        LIMIT 200
      `).all(startStr, endStr);

      slices.push({ start: startStr, end: endStr, points });
    }

    res.json({ slices });
  } catch (error: any) {
    console.error('[Dispatch] heatmap timelapse error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/dispatch/heatmap/predictions - Predictive hotspot analysis
router.get('/heatmap/predictions', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();

    // Determine target shift
    const shiftParam = req.query.shift as string | undefined;
    const validShifts = ['day', 'swing', 'night'];
    let targetShift: string;

    if (shiftParam && validShifts.includes(shiftParam)) {
      targetShift = shiftParam;
    } else {
      // Auto-detect current shift
      const currentHour = new Date().getHours();
      if (currentHour >= 6 && currentHour < 14) targetShift = 'day';
      else if (currentHour >= 14 && currentHour < 22) targetShift = 'swing';
      else targetShift = 'night';
    }

    // Shift hour ranges
    const shiftHours: Record<string, [number, number]> = {
      day: [6, 14],
      swing: [14, 22],
      night: [22, 6],
    };
    const [shiftStart, shiftEnd] = shiftHours[targetShift];

    const todayDow = new Date().getDay(); // 0=Sunday

    // Query last 90 days of calls with valid lat/lng
    const rows = db.prepare(`
      SELECT
        ROUND(latitude, 3) as latitude,
        ROUND(longitude, 3) as longitude,
        created_at,
        incident_type,
        CASE WHEN weapons_involved IS NOT NULL AND weapons_involved != '' AND weapons_involved != '0' THEN 1 ELSE 0 END as has_weapon,
        CASE WHEN domestic_violence = 1 THEN 1 ELSE 0 END as has_dv
      FROM calls_for_service
      WHERE latitude IS NOT NULL AND longitude IS NOT NULL
        AND created_at >= datetime('now', 'localtime', '-90 days')
    `).all() as any[];

    // Aggregate by grid cell
    const cells: Record<string, {
      latitude: number;
      longitude: number;
      score: number;
      incident_count: number;
      types: Record<string, number>;
      weapons_count: number;
      dv_count: number;
    }> = {};

    const now = Date.now();
    const msPerDay = 86400000;

    for (const row of rows) {
      const key = `${row.latitude},${row.longitude}`;
      if (!cells[key]) {
        cells[key] = {
          latitude: row.latitude,
          longitude: row.longitude,
          score: 0,
          incident_count: 0,
          types: {},
          weapons_count: 0,
          dv_count: 0,
        };
      }

      const cell = cells[key];
      cell.incident_count++;
      if (row.has_weapon) cell.weapons_count++;
      if (row.has_dv) cell.dv_count++;
      if (row.incident_type) {
        cell.types[row.incident_type] = (cell.types[row.incident_type] || 0) + 1;
      }

      // Calculate weight
      let weight = 1;

      // Recency weight
      const callDate = new Date(row.created_at);
      const ageMs = now - callDate.getTime();
      const ageDays = ageMs / msPerDay;
      if (ageDays <= 7) weight = 3;
      else if (ageDays <= 30) weight = 2;
      // else weight = 1 (default)

      // Day-of-week match
      if (callDate.getDay() === todayDow) {
        weight *= 1.5;
      }

      // Shift match
      const callHour = callDate.getHours();
      let inShift = false;
      if (targetShift === 'night') {
        inShift = callHour >= 22 || callHour < 6;
      } else {
        inShift = callHour >= shiftStart && callHour < shiftEnd;
      }
      if (inShift) {
        weight *= 2.0;
      }

      cell.score += weight;
    }

    // Sort by score, take top 15
    const hotspots = Object.values(cells)
      .sort((a, b) => b.score - a.score)
      .slice(0, 15)
      .map(cell => ({
        latitude: cell.latitude,
        longitude: cell.longitude,
        score: Math.round(cell.score * 10) / 10,
        incident_count: cell.incident_count,
        top_types: Object.entries(cell.types)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([t]) => t)
          .join(', '),
        weapons_count: cell.weapons_count,
        dv_count: cell.dv_count,
      }));

    res.json({ shift: targetShift, hotspots });
  } catch (error: any) {
    console.error('[Dispatch] heatmap predictions error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/dispatch/heatmap/safety-zones - High-risk safety zones
router.get('/heatmap/safety-zones', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();

    const zones = db.prepare(`
      SELECT
        ROUND(latitude, 3) as latitude,
        ROUND(longitude, 3) as longitude,
        SUM(CASE WHEN weapons_involved IS NOT NULL AND weapons_involved != '' AND weapons_involved != '0' THEN 1 ELSE 0 END) as weapons_count,
        SUM(CASE WHEN domestic_violence = 1 THEN 1 ELSE 0 END) as dv_count,
        SUM(CASE WHEN injuries_reported = 1 THEN 1 ELSE 0 END) as injuries_count,
        COUNT(*) as total_flagged,
        MAX(created_at) as last_incident
      FROM calls_for_service
      WHERE latitude IS NOT NULL AND longitude IS NOT NULL
        AND created_at >= datetime('now', 'localtime', '-90 days')
        AND (
          (weapons_involved IS NOT NULL AND weapons_involved != '' AND weapons_involved != '0')
          OR domestic_violence = 1
          OR injuries_reported = 1
        )
      GROUP BY ROUND(latitude, 3), ROUND(longitude, 3)
      HAVING COUNT(*) >= 2
      ORDER BY total_flagged DESC
      LIMIT 50
    `).all() as any[];

    const result = zones.map(z => ({
      latitude: z.latitude,
      longitude: z.longitude,
      risk_level: (z.weapons_count >= 3 || z.total_flagged >= 5) ? 'high' : 'moderate',
      weapons_count: z.weapons_count,
      dv_count: z.dv_count,
      injuries_count: z.injuries_count,
      total_flagged: z.total_flagged,
      last_incident: z.last_incident,
    }));

    res.json({ zones: result });
  } catch (error: any) {
    console.error('[Dispatch] safety zones error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/dispatch/repeat-addresses - Addresses with repeated calls for service
// Query params: days (int, default 30), min_count (int, default 3)
router.get('/repeat-addresses', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const days = Math.max(1, Math.min(365, parseInt(req.query.days as string, 10) || 30));
    const minCount = Math.max(2, Math.min(100, parseInt(req.query.min_count as string, 10) || 3));

    const cutoff = `-${days}`;

    const addresses = db.prepare(`
      SELECT location_address, ROUND(latitude, 4) AS lat, ROUND(longitude, 4) AS lng,
             COUNT(*) AS call_count, GROUP_CONCAT(DISTINCT incident_type) AS incident_types,
             MAX(created_at) AS last_call
      FROM calls_for_service
      WHERE latitude IS NOT NULL AND longitude IS NOT NULL
        AND created_at >= datetime('now', 'localtime', ? || ' days')
      GROUP BY ROUND(latitude, 4), ROUND(longitude, 4)
      HAVING COUNT(*) >= ?
      ORDER BY call_count DESC
      LIMIT 100
    `).all(cutoff, minCount);

    res.json(addresses);
  } catch (error: any) {
    console.error('[Dispatch] repeat-addresses error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/dispatch/heatmap/enforcement - Citation/arrest geographic clusters
// Query params: type ('citations' | 'arrests'), days (int, default 90)
router.get('/heatmap/enforcement', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const type = req.query.type as string;
    const days = Math.max(1, Math.min(365, parseInt(req.query.days as string, 10) || 90));

    if (!type || !['citations', 'arrests'].includes(type)) {
      res.status(400).json({ error: 'type must be "citations" or "arrests"' });
      return;
    }

    const cutoff = `-${days}`;

    if (type === 'citations') {
      // Join citations to calls_for_service via call_id to get coordinates
      const clusters = db.prepare(`
        SELECT ROUND(c2.latitude, 3) AS lat, ROUND(c2.longitude, 3) AS lng,
               COUNT(*) AS total,
               GROUP_CONCAT(DISTINCT c.violation_description) AS top_statutes,
               MIN(c.created_at) AS first_date,
               MAX(c.created_at) AS last_date
        FROM citations c
        JOIN calls_for_service c2 ON c.call_id = c2.id
        WHERE c2.latitude IS NOT NULL AND c2.longitude IS NOT NULL
          AND c.created_at >= datetime('now', 'localtime', ? || ' days')
        GROUP BY ROUND(c2.latitude, 3), ROUND(c2.longitude, 3)
        ORDER BY total DESC
        LIMIT 100
      `).all(cutoff);

      res.json(clusters);
      return;
    }

    // Arrests: use incidents with arrest-related dispositions joined to calls_for_service
    const clusters = db.prepare(`
      SELECT ROUND(c.latitude, 3) AS lat, ROUND(c.longitude, 3) AS lng,
             COUNT(*) AS total,
             GROUP_CONCAT(DISTINCT i.incident_type) AS top_statutes,
             MIN(i.created_at) AS first_date,
             MAX(i.created_at) AS last_date
      FROM incidents i
      JOIN calls_for_service c ON i.call_id = c.id
      WHERE c.latitude IS NOT NULL AND c.longitude IS NOT NULL
        AND i.created_at >= datetime('now', 'localtime', ? || ' days')
        AND (i.disposition LIKE '%arrest%' OR i.disposition LIKE '%custody%' OR i.disposition LIKE '%booked%')
      GROUP BY ROUND(c.latitude, 3), ROUND(c.longitude, 3)
      ORDER BY total DESC
      LIMIT 100
    `).all(cutoff);

    res.json(clusters);
  } catch (error: any) {
    console.error('[Dispatch] enforcement heatmap error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

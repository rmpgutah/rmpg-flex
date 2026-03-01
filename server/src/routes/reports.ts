import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { localNow, localToday } from '../utils/timeUtils';

const router = Router();

router.use(authenticateToken);

// GET /api/reports/dashboard - Overall dashboard statistics
router.get('/dashboard', (req: Request, res: Response) => {
  try {
    const db = getDb();

    // Active calls
    const activeCalls = db.prepare(`
      SELECT COUNT(*) as count FROM calls_for_service
      WHERE status IN ('pending', 'dispatched', 'enroute', 'onscene')
    `).get() as any;

    // Today's calls
    const todayCalls = db.prepare(`
      SELECT COUNT(*) as count FROM calls_for_service
      WHERE DATE(created_at) = DATE('now')
    `).get() as any;

    // Units on duty
    const unitsOnDuty = db.prepare(`
      SELECT COUNT(*) as count FROM units WHERE status != 'off_duty'
    `).get() as any;

    // Total units
    const totalUnits = db.prepare(`SELECT COUNT(*) as count FROM units`).get() as any;

    // Pending incidents for review
    const pendingReports = db.prepare(`
      SELECT COUNT(*) as count FROM incidents WHERE status IN ('submitted', 'under_review')
    `).get() as any;

    // Active BOLOs
    const activeBolos = db.prepare(`
      SELECT COUNT(*) as count FROM bolos WHERE status = 'active'
    `).get() as any;

    // Unread messages for current user
    const unreadMessages = db.prepare(`
      SELECT COUNT(*) as count FROM messages WHERE to_user_id = ? AND read_at IS NULL
    `).get(req.user!.userId) as any;

    // Average response time today
    const avgResponse = db.prepare(`
      SELECT AVG(
        (julianday(onscene_at) - julianday(created_at)) * 24 * 60
      ) as avg_minutes
      FROM calls_for_service
      WHERE onscene_at IS NOT NULL AND DATE(created_at) = DATE('now')
    `).get() as any;

    // Calls by priority today
    const callsByPriority = db.prepare(`
      SELECT priority, COUNT(*) as count FROM calls_for_service
      WHERE DATE(created_at) = DATE('now')
      GROUP BY priority ORDER BY priority
    `).all();

    // Calls by status
    const callsByStatus = db.prepare(`
      SELECT status, COUNT(*) as count FROM calls_for_service
      WHERE DATE(created_at) = DATE('now')
      GROUP BY status
    `).all();

    // Recent activity
    const recentActivity = db.prepare(`
      SELECT al.*, u.full_name as user_name
      FROM activity_log al
      LEFT JOIN users u ON al.user_id = u.id
      ORDER BY al.created_at DESC
      LIMIT 10
    `).all();

    // Officers currently on duty
    const officersOnDuty = db.prepare(`
      SELECT u.id, u.full_name, u.badge_number, un.call_sign, un.status as unit_status,
        un.latitude, un.longitude
      FROM units un
      JOIN users u ON un.officer_id = u.id
      WHERE un.status != 'off_duty'
    `).all();

    // Call volume by hour (today)
    const callsByHour = db.prepare(`
      SELECT strftime('%H', created_at) as hour, COUNT(*) as count
      FROM calls_for_service
      WHERE DATE(created_at) = DATE('now')
      GROUP BY hour ORDER BY hour
    `).all();

    res.json({
      activeCalls: activeCalls.count,
      todayCalls: todayCalls.count,
      unitsOnDuty: unitsOnDuty.count,
      totalUnits: totalUnits.count,
      pendingReports: pendingReports.count,
      activeBolos: activeBolos.count,
      unreadMessages: unreadMessages.count,
      avgResponseMinutes: avgResponse.avg_minutes ? Math.round(avgResponse.avg_minutes * 10) / 10 : null,
      callsByPriority,
      callsByStatus,
      recentActivity,
      officersOnDuty,
      callsByHour,
    });
  } catch (error: any) {
    console.error('Get dashboard error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/reports/incidents-summary - Incident summary with grouping
router.get('/incidents-summary', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { startDate, endDate, groupBy = 'type' } = req.query;

    let dateFilter = '';
    const params: any[] = [];

    if (startDate) {
      dateFilter += ' AND created_at >= ?';
      params.push(startDate);
    }
    if (endDate) {
      dateFilter += ' AND created_at <= ?';
      params.push(endDate);
    }

    const columnMap: Record<string, string> = {
      type: 'incident_type',
      status: 'status',
      priority: 'priority',
      officer: 'officer_id',
    };
    const groupColumn = columnMap[groupBy as string] || 'incident_type';

    const summary = db.prepare(`
      SELECT ${groupColumn} as group_key, COUNT(*) as count
      FROM incidents
      WHERE 1=1 ${dateFilter}
      GROUP BY ${groupColumn}
      ORDER BY count DESC
    `).all(...params);

    // If grouped by officer, enrich with names
    let enriched = summary;
    if (groupBy === 'officer') {
      enriched = summary.map((row: any) => {
        const officer = db.prepare('SELECT full_name, badge_number FROM users WHERE id = ?').get(row.group_key) as any;
        return {
          ...row,
          officer_name: officer?.full_name || 'Unknown',
          badge_number: officer?.badge_number,
        };
      });
    }

    const total = db.prepare(`
      SELECT COUNT(*) as count FROM incidents WHERE 1=1 ${dateFilter}
    `).get(...params) as any;

    res.json({
      groupBy,
      data: enriched,
      total: total.count,
    });
  } catch (error: any) {
    console.error('Get incidents summary error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/reports/response-times - Response time analytics
router.get('/response-times', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { startDate, endDate, propertyId } = req.query;

    let dateFilter = '';
    let dateFilterAliased = ''; // prefixed with c. for JOIN queries
    const params: any[] = [];

    if (startDate) {
      dateFilter += ' AND created_at >= ?';
      dateFilterAliased += ' AND c.created_at >= ?';
      params.push(startDate);
    }
    if (endDate) {
      dateFilter += ' AND created_at <= ?';
      dateFilterAliased += ' AND c.created_at <= ?';
      params.push(endDate);
    }
    if (propertyId) {
      dateFilter += ' AND property_id = ?';
      dateFilterAliased += ' AND c.property_id = ?';
      params.push(propertyId);
    }

    // Overall average response times
    const overall = db.prepare(`
      SELECT
        AVG((julianday(dispatched_at) - julianday(created_at)) * 24 * 60) as avg_dispatch_minutes,
        AVG((julianday(enroute_at) - julianday(dispatched_at)) * 24 * 60) as avg_enroute_minutes,
        AVG((julianday(onscene_at) - julianday(created_at)) * 24 * 60) as avg_total_response_minutes,
        MIN((julianday(onscene_at) - julianday(created_at)) * 24 * 60) as min_response_minutes,
        MAX((julianday(onscene_at) - julianday(created_at)) * 24 * 60) as max_response_minutes,
        COUNT(*) as total_calls
      FROM calls_for_service
      WHERE onscene_at IS NOT NULL ${dateFilter}
    `).get(...params) as any;

    // By priority
    const byPriority = db.prepare(`
      SELECT
        priority,
        AVG((julianday(onscene_at) - julianday(created_at)) * 24 * 60) as avg_response_minutes,
        COUNT(*) as count
      FROM calls_for_service
      WHERE onscene_at IS NOT NULL ${dateFilter}
      GROUP BY priority ORDER BY priority
    `).all(...params);

    // By property (uses aliased date filter to avoid ambiguous created_at)
    const byProperty = db.prepare(`
      SELECT
        p.name as property_name,
        AVG((julianday(c.onscene_at) - julianday(c.created_at)) * 24 * 60) as avg_response_minutes,
        COUNT(*) as count
      FROM calls_for_service c
      JOIN properties p ON c.property_id = p.id
      WHERE c.onscene_at IS NOT NULL ${dateFilterAliased}
      GROUP BY c.property_id
      ORDER BY avg_response_minutes
    `).all(...params);

    // Daily trend
    const dailyTrend = db.prepare(`
      SELECT
        DATE(created_at) as date,
        AVG((julianday(onscene_at) - julianday(created_at)) * 24 * 60) as avg_response_minutes,
        COUNT(*) as count
      FROM calls_for_service
      WHERE onscene_at IS NOT NULL ${dateFilter}
      GROUP BY DATE(created_at)
      ORDER BY date DESC
      LIMIT 30
    `).all(...params);

    // Round all numbers
    const round = (v: any) => v ? Math.round(v * 10) / 10 : null;

    res.json({
      overall: {
        avgDispatchMinutes: round(overall.avg_dispatch_minutes),
        avgEnrouteMinutes: round(overall.avg_enroute_minutes),
        avgTotalResponseMinutes: round(overall.avg_total_response_minutes),
        minResponseMinutes: round(overall.min_response_minutes),
        maxResponseMinutes: round(overall.max_response_minutes),
        totalCalls: overall.total_calls,
      },
      byPriority: byPriority.map((r: any) => ({
        ...r,
        avg_response_minutes: round(r.avg_response_minutes),
      })),
      byProperty: byProperty.map((r: any) => ({
        ...r,
        avg_response_minutes: round(r.avg_response_minutes),
      })),
      dailyTrend: dailyTrend.map((r: any) => ({
        ...r,
        avg_response_minutes: round(r.avg_response_minutes),
      })),
    });
  } catch (error: any) {
    console.error('Get response times error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/reports/officer-activity - Per-officer metrics
router.get('/officer-activity', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { startDate, endDate } = req.query;

    let dateFilter = '';
    const params: any[] = [];

    if (startDate) {
      dateFilter += ' AND created_at >= ?';
      params.push(startDate);
    }
    if (endDate) {
      dateFilter += ' AND created_at <= ?';
      params.push(endDate);
    }

    // Get all active officers
    const officers = db.prepare(`
      SELECT id, full_name, badge_number, role FROM users
      WHERE role IN ('officer', 'supervisor') AND status = 'active'
      ORDER BY full_name
    `).all() as any[];

    const metrics = officers.map((officer) => {
      // Incidents written
      const incidents = db.prepare(`
        SELECT COUNT(*) as count FROM incidents
        WHERE officer_id = ? ${dateFilter}
      `).get(officer.id, ...params) as any;

      // Incidents by status
      const incidentsByStatus = db.prepare(`
        SELECT status, COUNT(*) as count FROM incidents
        WHERE officer_id = ? ${dateFilter}
        GROUP BY status
      `).all(officer.id, ...params);

      // Total hours worked
      const hours = db.prepare(`
        SELECT SUM(total_hours) as total FROM time_entries
        WHERE officer_id = ? AND status = 'completed' ${dateFilter.replace('created_at', 'clock_in')}
      `).get(officer.id, ...params) as any;

      // Calls responded to (via unit assignment)
      const unit = db.prepare('SELECT id FROM units WHERE officer_id = ?').get(officer.id) as any;
      let callsResponded = 0;
      if (unit) {
        const callCount = db.prepare(`
          SELECT COUNT(*) as count FROM calls_for_service
          WHERE assigned_unit_ids LIKE ? ${dateFilter}
        `).get(`%${unit.id}%`, ...params) as any;
        callsResponded = callCount.count;
      }

      return {
        officer_id: officer.id,
        full_name: officer.full_name,
        badge_number: officer.badge_number,
        role: officer.role,
        incidents_written: incidents.count,
        incidents_by_status: incidentsByStatus,
        calls_responded: callsResponded,
        total_hours: hours.total ? Math.round(hours.total * 100) / 100 : 0,
      };
    });

    res.json(metrics);
  } catch (error: any) {
    console.error('Get officer activity error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/reports/client/:clientId - Client-specific report data
router.get('/client/:clientId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { startDate, endDate } = req.query;

    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.clientId) as any;
    if (!client) {
      res.status(404).json({ error: 'Client not found' });
      return;
    }

    // Get properties for this client
    const properties = db.prepare('SELECT * FROM properties WHERE client_id = ?').all(client.id) as any[];
    const propertyIds = properties.map((p) => p.id);

    if (propertyIds.length === 0) {
      res.json({
        client,
        properties: [],
        callsSummary: { total: 0, byType: [], byPriority: [] },
        incidentsSummary: { total: 0, byType: [] },
        responseTimeAvg: null,
        slaCompliance: null,
      });
      return;
    }

    let dateFilter = '';
    const dateParams: any[] = [];
    if (startDate) {
      dateFilter += ' AND created_at >= ?';
      dateParams.push(startDate);
    }
    if (endDate) {
      dateFilter += ' AND created_at <= ?';
      dateParams.push(endDate);
    }

    const placeholders = propertyIds.map(() => '?').join(',');

    // Calls for this client's properties
    const totalCalls = db.prepare(`
      SELECT COUNT(*) as count FROM calls_for_service
      WHERE property_id IN (${placeholders}) ${dateFilter}
    `).get(...propertyIds, ...dateParams) as any;

    const callsByType = db.prepare(`
      SELECT incident_type, COUNT(*) as count FROM calls_for_service
      WHERE property_id IN (${placeholders}) ${dateFilter}
      GROUP BY incident_type ORDER BY count DESC
    `).all(...propertyIds, ...dateParams);

    const callsByPriority = db.prepare(`
      SELECT priority, COUNT(*) as count FROM calls_for_service
      WHERE property_id IN (${placeholders}) ${dateFilter}
      GROUP BY priority ORDER BY priority
    `).all(...propertyIds, ...dateParams);

    // Incidents
    const totalIncidents = db.prepare(`
      SELECT COUNT(*) as count FROM incidents
      WHERE property_id IN (${placeholders}) ${dateFilter}
    `).get(...propertyIds, ...dateParams) as any;

    const incidentsByType = db.prepare(`
      SELECT incident_type, COUNT(*) as count FROM incidents
      WHERE property_id IN (${placeholders}) ${dateFilter}
      GROUP BY incident_type ORDER BY count DESC
    `).all(...propertyIds, ...dateParams);

    // Average response time for this client
    const avgResponse = db.prepare(`
      SELECT AVG(
        (julianday(onscene_at) - julianday(created_at)) * 24 * 60
      ) as avg_minutes
      FROM calls_for_service
      WHERE property_id IN (${placeholders}) AND onscene_at IS NOT NULL ${dateFilter}
    `).get(...propertyIds, ...dateParams) as any;

    // SLA compliance
    const slaTotal = db.prepare(`
      SELECT COUNT(*) as count FROM calls_for_service
      WHERE property_id IN (${placeholders}) AND onscene_at IS NOT NULL ${dateFilter}
    `).get(...propertyIds, ...dateParams) as any;

    const slaWithin = db.prepare(`
      SELECT COUNT(*) as count FROM calls_for_service
      WHERE property_id IN (${placeholders}) AND onscene_at IS NOT NULL
        AND (julianday(onscene_at) - julianday(created_at)) * 24 * 60 <= ?
        ${dateFilter}
    `).get(...propertyIds, client.sla_response_minutes, ...dateParams) as any;

    const slaCompliance = slaTotal.count > 0
      ? Math.round((slaWithin.count / slaTotal.count) * 100 * 10) / 10
      : null;

    res.json({
      client,
      properties,
      callsSummary: {
        total: totalCalls.count,
        byType: callsByType,
        byPriority: callsByPriority,
      },
      incidentsSummary: {
        total: totalIncidents.count,
        byType: incidentsByType,
      },
      responseTimeAvg: avgResponse.avg_minutes ? Math.round(avgResponse.avg_minutes * 10) / 10 : null,
      slaCompliance,
      slaTargetMinutes: client.sla_response_minutes,
    });
  } catch (error: any) {
    console.error('Get client report error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/reports/shift-activity/:officerId — End-of-shift activity report data
router.get('/shift-activity/:officerId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { officerId } = req.params;
    const date = (req.query.date as string) || new Date().toISOString().slice(0, 10);

    // Officer info
    const officer = db.prepare('SELECT id, full_name, badge_number, email, role FROM users WHERE id = ?').get(officerId) as any;
    if (!officer) return res.status(404).json({ error: 'Officer not found' });

    // Calls handled today — units stored as JSON array in assigned_unit_ids
    const calls = db.prepare(`
      SELECT c.*,
        (SELECT GROUP_CONCAT(u2.call_sign)
         FROM units u2, json_each(c.assigned_unit_ids) je
         WHERE u2.id = je.value) as unit_signs
      FROM calls_for_service c
      WHERE DATE(c.created_at) = ? AND (
        c.dispatcher_id = ?
        OR EXISTS (
          SELECT 1 FROM json_each(c.assigned_unit_ids) je
          JOIN units u ON u.id = je.value
          WHERE u.officer_id = ?
        )
      )
      ORDER BY c.created_at ASC
    `).all(date, officerId, officerId) as any[];

    // Incidents authored today
    const incidents = db.prepare(`
      SELECT id, incident_number, incident_type, priority, status, location_address, narrative, created_at
      FROM incidents
      WHERE DATE(created_at) = ? AND officer_id = ?
      ORDER BY created_at ASC
    `).all(date, officerId) as any[];

    // Patrol scans today
    const scans = db.prepare(`
      SELECT ps.*, pc.name as checkpoint_name, pc.location_description
      FROM patrol_scans ps
      LEFT JOIN patrol_checkpoints pc ON pc.id = ps.checkpoint_id
      WHERE DATE(ps.scanned_at) = ? AND ps.officer_id = ?
      ORDER BY ps.scanned_at ASC
    `).all(date, officerId) as any[];

    // Citations issued today
    const citations = db.prepare(`
      SELECT id, citation_number, violation_description, location, status, created_at
      FROM citations
      WHERE DATE(created_at) = ? AND officer_id = ?
      ORDER BY created_at ASC
    `).all(date, officerId) as any[];

    // Field interviews today
    const fieldInterviews = db.prepare(`
      SELECT id, subject_name, location, reason, created_at
      FROM field_interviews
      WHERE DATE(created_at) = ? AND officer_id = ?
      ORDER BY created_at ASC
    `).all(date, officerId) as any[];

    res.json({
      officer,
      date,
      calls: calls || [],
      incidents: incidents || [],
      scans: scans || [],
      citations: citations || [],
      fieldInterviews: fieldInterviews || [],
      summary: {
        totalCalls: (calls || []).length,
        totalIncidents: (incidents || []).length,
        totalScans: (scans || []).length,
        totalCitations: (citations || []).length,
        totalFieldInterviews: (fieldInterviews || []).length,
      },
    });
  } catch (error: any) {
    console.error('Get shift activity error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/reports/training-compliance — Org-wide training compliance
router.get('/training-compliance', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const users = db.prepare("SELECT id, full_name, badge_number, role FROM users WHERE role IN ('officer','manager','admin') AND status = 'active'").all() as any[];
    const requirements = db.prepare('SELECT * FROM training_requirements WHERE is_active = 1').all() as any[];
    const records = db.prepare('SELECT * FROM training_records ORDER BY completed_date DESC').all() as any[];
    res.json({ users, requirements, records });
  } catch (error: any) {
    console.error('Training compliance error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/reports/call-density — Call density data for heatmap
router.get('/call-density', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const days = parseInt(req.query.days as string) || 30;
    const incidentType = req.query.type as string;

    let sql = `
      SELECT latitude, longitude, priority, incident_type, zone_beat, created_at
      FROM calls_for_service
      WHERE latitude IS NOT NULL AND longitude IS NOT NULL
        AND created_at >= datetime('now', '-${days} days')
    `;
    const params: any[] = [];
    if (incidentType) {
      sql += ' AND incident_type = ?';
      params.push(incidentType);
    }

    const points = db.prepare(sql).all(...params) as any[];
    res.json({ points, count: points.length });
  } catch (error: any) {
    console.error('Call density error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/reports/statute-analytics — Statute violation analytics
router.get('/statute-analytics', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const days = parseInt(req.query.days as string) || 90;

    // Top cited statutes
    const topStatutes = db.prepare(`
      SELECT us.citation as statute_number, us.short_title as title, us.offense_level, COUNT(*) as count
      FROM citations c
      JOIN utah_statutes us ON us.id = c.statute_id
      WHERE c.created_at >= datetime('now', '-${days} days')
      GROUP BY c.statute_id
      ORDER BY count DESC
      LIMIT 20
    `).all() as any[];

    // By offense level
    const byLevel = db.prepare(`
      SELECT us.offense_level, COUNT(*) as count
      FROM citations c
      JOIN utah_statutes us ON us.id = c.statute_id
      WHERE c.created_at >= datetime('now', '-${days} days')
      GROUP BY us.offense_level
      ORDER BY count DESC
    `).all() as any[];

    // Monthly trend
    const trend = db.prepare(`
      SELECT strftime('%Y-%m', c.created_at) as month, COUNT(*) as count
      FROM citations c
      WHERE c.created_at >= datetime('now', '-${days} days')
      GROUP BY month
      ORDER BY month ASC
    `).all() as any[];

    // From incidents too
    const incidentStatutes = db.prepare(`
      SELECT us.citation as statute_number, us.short_title as title, us.offense_level, COUNT(*) as count
      FROM incidents i
      JOIN utah_statutes us ON us.id = i.statute_id
      WHERE i.created_at >= datetime('now', '-${days} days') AND i.statute_id IS NOT NULL
      GROUP BY i.statute_id
      ORDER BY count DESC
      LIMIT 20
    `).all() as any[];

    res.json({ topStatutes, byLevel, trend, incidentStatutes });
  } catch (error: any) {
    console.error('Statute analytics error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/reports/patrol-compliance — Patrol scan compliance analytics
router.get('/patrol-compliance', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const days = parseInt(req.query.days as string) || 30;

    // Overall scan stats
    const totalScans = db.prepare(`
      SELECT COUNT(*) as count FROM patrol_scans WHERE scanned_at >= datetime('now', '-${days} days')
    `).get() as any;

    const activeCheckpoints = db.prepare(`
      SELECT COUNT(*) as count FROM patrol_checkpoints WHERE is_active = 1
    `).get() as any;

    // By officer
    const byOfficer = db.prepare(`
      SELECT u.full_name, u.badge_number, COUNT(ps.id) as scan_count,
        COUNT(DISTINCT DATE(ps.scanned_at)) as active_days
      FROM patrol_scans ps
      JOIN users u ON u.id = ps.officer_id
      WHERE ps.scanned_at >= datetime('now', '-${days} days')
      GROUP BY ps.officer_id
      ORDER BY scan_count DESC
    `).all() as any[];

    // By checkpoint
    const byCheckpoint = db.prepare(`
      SELECT pc.name, pc.location_description, COUNT(ps.id) as scan_count,
        MAX(ps.scanned_at) as last_scan
      FROM patrol_checkpoints pc
      LEFT JOIN patrol_scans ps ON ps.checkpoint_id = pc.id
        AND ps.scanned_at >= datetime('now', '-${days} days')
      WHERE pc.is_active = 1
      GROUP BY pc.id
      ORDER BY scan_count DESC
    `).all() as any[];

    // By hour of day
    const byHour = db.prepare(`
      SELECT CAST(strftime('%H', scanned_at) AS INTEGER) as hour, COUNT(*) as count
      FROM patrol_scans
      WHERE scanned_at >= datetime('now', '-${days} days')
      GROUP BY hour
      ORDER BY hour ASC
    `).all() as any[];

    res.json({
      totalScans: totalScans.count,
      activeCheckpoints: activeCheckpoints.count,
      byOfficer,
      byCheckpoint,
      byHour,
    });
  } catch (error: any) {
    console.error('Patrol compliance error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/reports/custom — Custom report builder query
router.post('/custom', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { source, columns, filters, groupBy, sortBy, sortDir, limit: queryLimit } = req.body;

    // Allowed sources and their column whitelists
    const ALLOWED_SOURCES: Record<string, string[]> = {
      calls_for_service: ['id', 'call_number', 'incident_type', 'priority', 'status', 'caller_name', 'location_address', 'zone_beat', 'disposition', 'created_at', 'dispatched_at', 'onscene_at', 'cleared_at'],
      incidents: ['id', 'incident_number', 'incident_type', 'priority', 'status', 'location_address', 'narrative', 'officer_id', 'created_at', 'occurred_date', 'zone_beat', 'disposition', 'domestic_violence', 'weapons_involved'],
      citations: ['id', 'citation_number', 'violation_description', 'location', 'status', 'fine_amount', 'officer_id', 'created_at'],
      field_interviews: ['id', 'subject_name', 'location', 'reason', 'officer_id', 'created_at'],
      patrol_scans: ['id', 'checkpoint_id', 'officer_id', 'scanned_at', 'gps_latitude', 'gps_longitude'],
    };

    if (!source || !ALLOWED_SOURCES[source]) {
      return res.status(400).json({ error: 'Invalid data source' });
    }

    const allowedCols = ALLOWED_SOURCES[source];
    const selectedCols = (columns || allowedCols).filter((c: string) => allowedCols.includes(c));
    if (selectedCols.length === 0) return res.status(400).json({ error: 'No valid columns selected' });

    let sql = `SELECT ${selectedCols.join(', ')} FROM ${source}`;
    const params: any[] = [];
    const conditions: string[] = [];

    if (filters && Array.isArray(filters)) {
      for (const f of filters) {
        if (!allowedCols.includes(f.column)) continue;
        if (f.operator === 'eq') { conditions.push(`${f.column} = ?`); params.push(f.value); }
        else if (f.operator === 'contains') { conditions.push(`${f.column} LIKE ?`); params.push(`%${f.value}%`); }
        else if (f.operator === 'gte') { conditions.push(`${f.column} >= ?`); params.push(f.value); }
        else if (f.operator === 'lte') { conditions.push(`${f.column} <= ?`); params.push(f.value); }
      }
    }

    if (conditions.length > 0) sql += ` WHERE ${conditions.join(' AND ')}`;
    if (groupBy && allowedCols.includes(groupBy)) sql += ` GROUP BY ${groupBy}`;
    if (sortBy && allowedCols.includes(sortBy)) sql += ` ORDER BY ${sortBy} ${sortDir === 'asc' ? 'ASC' : 'DESC'}`;
    sql += ` LIMIT ${Math.min(parseInt(queryLimit) || 500, 2000)}`;

    const rows = db.prepare(sql).all(...params);
    res.json({ data: rows, columns: selectedCols, count: rows.length, sql: sql.replace(/\?/g, '…') });
  } catch (error: any) {
    console.error('Custom report error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /crime-analysis ─────────────────────────────────
// Crime analysis / ILP dashboard data
router.get('/crime-analysis', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { days = '90' } = req.query;
    const daysNum = parseInt(days as string, 10) || 90;
    const cutoff = `DATE('now', '-${daysNum} days')`;

    // Top offenses by incident type
    const topOffenses = db.prepare(`
      SELECT incident_type, COUNT(*) as count FROM incidents
      WHERE created_at >= ${cutoff} AND status != 'draft'
      GROUP BY incident_type ORDER BY count DESC LIMIT 10
    `).all();

    // Monthly trend (last 12 months)
    const trendData = db.prepare(`
      SELECT strftime('%Y-%m', created_at) as month, COUNT(*) as count
      FROM incidents WHERE created_at >= DATE('now', '-12 months') AND status != 'draft'
      GROUP BY month ORDER BY month
    `).all();

    // Time of day distribution
    const timeOfDay = db.prepare(`
      SELECT CAST(strftime('%H', created_at) AS INTEGER) as hour, COUNT(*) as count
      FROM calls_for_service WHERE created_at >= ${cutoff}
      GROUP BY hour ORDER BY hour
    `).all();

    // Day of week distribution
    const dayOfWeek = db.prepare(`
      SELECT CAST(strftime('%w', created_at) AS INTEGER) as day, COUNT(*) as count
      FROM calls_for_service WHERE created_at >= ${cutoff}
      GROUP BY day ORDER BY day
    `).all();

    // Hotspot locations (top 15 by call count)
    const hotspots = db.prepare(`
      SELECT location_address, COUNT(*) as count,
        GROUP_CONCAT(DISTINCT incident_type) as types
      FROM calls_for_service
      WHERE created_at >= ${cutoff} AND location_address IS NOT NULL
      GROUP BY location_address ORDER BY count DESC LIMIT 15
    `).all();

    // Repeat offenders (persons with 3+ incidents)
    const repeatOffenders = db.prepare(`
      SELECT p.id, p.first_name, p.last_name, p.dob,
        COUNT(ip.id) as incident_count,
        MAX(i.created_at) as last_incident
      FROM persons p
      JOIN incident_persons ip ON p.id = ip.person_id
      JOIN incidents i ON ip.incident_id = i.id
      WHERE i.created_at >= ${cutoff}
      GROUP BY p.id HAVING incident_count >= 3
      ORDER BY incident_count DESC LIMIT 20
    `).all();

    // Response time metrics by priority
    const responseMetrics = db.prepare(`
      SELECT priority,
        ROUND(AVG(
          (julianday(onscene_at) - julianday(created_at)) * 1440
        ), 1) as avg_response_min,
        COUNT(*) as count
      FROM calls_for_service
      WHERE created_at >= ${cutoff} AND onscene_at IS NOT NULL
      GROUP BY priority
    `).all();

    // Clearance rate
    const clearanceRate = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as cleared
      FROM incidents WHERE created_at >= ${cutoff}
    `).get() as any;

    res.json({
      data: {
        period_days: daysNum,
        topOffenses,
        trendData,
        timeOfDay,
        dayOfWeek,
        hotspots,
        repeatOffenders,
        responseMetrics,
        clearanceRate: {
          total: clearanceRate?.total || 0,
          cleared: clearanceRate?.cleared || 0,
          rate: clearanceRate?.total > 0
            ? Math.round((clearanceRate.cleared / clearanceRate.total) * 100)
            : 0,
        },
      },
    });
  } catch (error: any) {
    console.error('Crime analysis error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── ROLL CALL / BRIEFING BOARD ──────────────────────
// Daily shift briefing: active BOLOs, warrants, recent crimes, assignments

router.get('/briefing', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { shift_date } = req.query;
    const today = (shift_date as string) || localToday();
    const yesterday = new Date(new Date(today).getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // 1. Active BOLOs
    const bolos = db.prepare(`
      SELECT b.*, u.full_name as issued_by_name
      FROM bolos b
      LEFT JOIN users u ON b.issued_by = u.id
      WHERE b.status = 'active'
        AND (b.expires_at IS NULL OR b.expires_at > datetime('now','localtime'))
      ORDER BY b.priority ASC, b.created_at DESC
    `).all() as any[];

    // 2. Active Warrants (recent 30 days)
    const warrants = db.prepare(`
      SELECT w.*, p.first_name, p.last_name, p.photo_url, p.dob,
        p.height_feet, p.height_inches, p.weight, p.hair_color, p.eye_color
      FROM warrants w
      LEFT JOIN persons p ON w.subject_person_id = p.id
      WHERE w.status = 'active'
      ORDER BY w.created_at DESC
      LIMIT 30
    `).all() as any[];

    // 3. Recent Incidents (last 24h)
    const recentIncidents = db.prepare(`
      SELECT i.id, i.incident_number, i.incident_type, i.priority, i.status,
        i.location_address, i.created_at, i.disposition,
        u.full_name as officer_name
      FROM incidents i
      LEFT JOIN users u ON i.officer_id = u.id
      WHERE i.created_at >= ?
      ORDER BY i.created_at DESC
    `).all(yesterday) as any[];

    // 4. Recent Calls (last 24h)
    const recentCalls = db.prepare(`
      SELECT id, call_number, incident_type, priority, status,
        location_address, created_at, disposition, source
      FROM calls_for_service
      WHERE created_at >= ?
      ORDER BY created_at DESC
    `).all(yesterday) as any[];

    // 5. Officer Shift Assignments for today
    const assignments = db.prepare(`
      SELECT s.*, u.full_name as officer_name, u.badge_number,
        p.name as property_name, p.address as property_address
      FROM schedules s
      LEFT JOIN users u ON s.officer_id = u.id
      LEFT JOIN properties p ON s.property_id = p.id
      WHERE s.shift_date = ? AND s.status IN ('scheduled', 'active')
      ORDER BY s.start_time ASC
    `).all(today) as any[];

    // 6. Active Trespass Orders
    const activeTrespass = db.prepare(`
      SELECT t.order_number, t.subject_first_name, t.subject_last_name,
        t.property_name, t.reason, t.expiration_date
      FROM trespass_orders t
      WHERE t.status = 'active'
        AND (t.expiration_date IS NULL OR t.expiration_date >= ?)
      ORDER BY t.created_at DESC LIMIT 20
    `).all(today) as any[];

    // 7. Fleet Status
    const fleetStatus = db.prepare(`
      SELECT fv.id, fv.vehicle_number, fv.make, fv.model, fv.year, fv.status,
        fv.current_mileage, u2.call_sign as assigned_unit
      FROM fleet_vehicles fv
      LEFT JOIN units u2 ON fv.assigned_unit_id = u2.id
      WHERE fv.status != 'retired' AND fv.archived_at IS NULL
      ORDER BY fv.vehicle_number
    `).all() as any[];

    // 8. Credentials expiring within 30 days
    const expiringCredentials = db.prepare(`
      SELECT c.*, u.full_name as officer_name, u.badge_number
      FROM credentials c
      JOIN users u ON c.officer_id = u.id
      WHERE c.status = 'active'
        AND c.expiry_date IS NOT NULL
        AND c.expiry_date <= date('now', 'localtime', '+30 days')
        AND c.expiry_date >= date('now', 'localtime')
      ORDER BY c.expiry_date ASC
    `).all() as any[];

    // 9. Offender alerts (active critical/warning)
    const offenderAlerts = db.prepare(`
      SELECT oa.*, p.first_name, p.last_name, p.photo_url
      FROM offender_alerts oa
      LEFT JOIN persons p ON oa.person_id = p.id
      WHERE oa.status = 'active' AND oa.severity IN ('critical', 'warning')
      ORDER BY oa.severity DESC, oa.created_at DESC
    `).all() as any[];

    // 10. Activity summary stats
    const stats = {
      calls_24h: recentCalls.length,
      incidents_24h: recentIncidents.length,
      active_bolos: bolos.length,
      active_warrants: warrants.length,
      officers_scheduled: assignments.length,
      vehicles_in_service: fleetStatus.filter(v => v.status === 'in_service').length,
      vehicles_out: fleetStatus.filter(v => v.status !== 'in_service').length,
      credentials_expiring: expiringCredentials.length,
    };

    res.json({
      shift_date: today,
      generated_at: localNow(),
      stats,
      bolos,
      warrants,
      recent_incidents: recentIncidents,
      recent_calls: recentCalls,
      assignments,
      active_trespass: activeTrespass,
      fleet_status: fleetStatus,
      expiring_credentials: expiringCredentials,
      offender_alerts: offenderAlerts,
    });
  } catch (error: any) {
    console.error('Briefing board error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// ─── HOT SHEET / ACTIVE ALERTS ───────────────────────
// Live consolidated view of all active alerts for tactical awareness

router.get('/hot-sheet', (req: Request, res: Response) => {
  try {
    const db = getDb();

    const alerts: any[] = [];

    // 1. Active BOLOs
    const bolos = db.prepare(`
      SELECT b.id, b.bolo_number, b.type, b.title, b.description, b.priority,
        b.subject_description, b.vehicle_description, b.photo_url,
        b.created_at, b.expires_at,
        u.full_name as issued_by_name
      FROM bolos b
      LEFT JOIN users u ON b.issued_by = u.id
      WHERE b.status = 'active'
        AND (b.expires_at IS NULL OR b.expires_at > datetime('now','localtime'))
      ORDER BY b.priority ASC, b.created_at DESC
    `).all() as any[];

    bolos.forEach(b => alerts.push({
      alert_type: 'bolo',
      severity: b.priority === 'P1' ? 'critical' : b.priority === 'P2' ? 'urgent' : 'notice',
      id: b.id, number: b.bolo_number, bolo_type: b.type,
      title: b.title, description: b.description,
      subject_description: b.subject_description,
      vehicle_description: b.vehicle_description,
      photo_url: b.photo_url,
      issued_by: b.issued_by_name,
      created_at: b.created_at, expires_at: b.expires_at,
    }));

    // 2. Active Warrants
    const warrants = db.prepare(`
      SELECT w.id, w.warrant_number, w.type, w.charge_description,
        w.offense_level, w.bail_amount, w.issuing_court, w.created_at, w.expires_at,
        p.first_name, p.last_name, p.dob, p.photo_url,
        p.height_feet, p.height_inches, p.weight, p.hair_color, p.eye_color,
        p.scars_marks_tattoos
      FROM warrants w
      LEFT JOIN persons p ON w.subject_person_id = p.id
      WHERE w.status = 'active'
      ORDER BY
        CASE w.offense_level
          WHEN 'capital_felony' THEN 0 WHEN '1st_degree_felony' THEN 1
          WHEN '2nd_degree_felony' THEN 2 WHEN '3rd_degree_felony' THEN 3
          ELSE 4
        END ASC,
        w.created_at DESC
    `).all() as any[];

    warrants.forEach(w => alerts.push({
      alert_type: 'warrant',
      severity: (w.offense_level || '').includes('felony') ? 'critical' : 'urgent',
      id: w.id, number: w.warrant_number, warrant_type: w.type,
      title: `${w.first_name || 'Unknown'} ${w.last_name || ''}`.trim(),
      description: w.charge_description,
      offense_level: w.offense_level, bail_amount: w.bail_amount,
      subject: {
        first_name: w.first_name, last_name: w.last_name, dob: w.dob,
        photo_url: w.photo_url, height_feet: w.height_feet,
        height_inches: w.height_inches, weight: w.weight,
        hair_color: w.hair_color, eye_color: w.eye_color,
        scars_marks_tattoos: w.scars_marks_tattoos,
      },
      created_at: w.created_at, expires_at: w.expires_at,
    }));

    // 3. Active Trespass Orders
    const trespass = db.prepare(`
      SELECT t.id, t.order_number, t.subject_first_name, t.subject_last_name,
        t.subject_description, t.property_name, t.location, t.reason,
        t.effective_date, t.expiration_date, t.created_at
      FROM trespass_orders t
      WHERE t.status = 'active'
        AND (t.expiration_date IS NULL OR t.expiration_date >= date('now','localtime'))
      ORDER BY t.created_at DESC
    `).all() as any[];

    trespass.forEach(t => alerts.push({
      alert_type: 'trespass',
      severity: 'notice',
      id: t.id, number: t.order_number,
      title: `${t.subject_first_name || ''} ${t.subject_last_name || ''}`.trim(),
      description: t.reason,
      subject_description: t.subject_description,
      property: t.property_name, location: t.location,
      effective_date: t.effective_date, expiration_date: t.expiration_date,
      created_at: t.created_at,
    }));

    // 4. Critical Offender Alerts
    const offenderAlerts = db.prepare(`
      SELECT oa.id, oa.alert_type as offender_alert_type, oa.description,
        oa.severity, oa.effective_date, oa.expiration_date, oa.created_at,
        p.first_name, p.last_name, p.photo_url, p.dob
      FROM offender_alerts oa
      LEFT JOIN persons p ON oa.person_id = p.id
      WHERE oa.status = 'active'
        AND oa.severity IN ('critical', 'warning')
      ORDER BY oa.severity DESC, oa.created_at DESC
    `).all() as any[];

    offenderAlerts.forEach(o => alerts.push({
      alert_type: 'offender',
      severity: o.severity === 'critical' ? 'critical' : 'urgent',
      id: o.id,
      title: `${o.first_name || ''} ${o.last_name || ''}`.trim(),
      description: o.description,
      offender_type: o.offender_alert_type,
      photo_url: o.photo_url, dob: o.dob,
      effective_date: o.effective_date, expiration_date: o.expiration_date,
      created_at: o.created_at,
    }));

    // Sort: critical first, then urgent, then notice — then by date
    const severityOrder: Record<string, number> = { critical: 0, urgent: 1, notice: 2 };
    alerts.sort((a, b) => {
      const sevDiff = (severityOrder[a.severity] ?? 3) - (severityOrder[b.severity] ?? 3);
      if (sevDiff !== 0) return sevDiff;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    const summary = {
      total: alerts.length,
      critical: alerts.filter(a => a.severity === 'critical').length,
      urgent: alerts.filter(a => a.severity === 'urgent').length,
      notice: alerts.filter(a => a.severity === 'notice').length,
      by_type: {
        bolos: bolos.length,
        warrants: warrants.length,
        trespass: trespass.length,
        offender: offenderAlerts.length,
      },
    };

    res.json({ generated_at: localNow(), summary, alerts });
  } catch (error: any) {
    console.error('Hot sheet error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


export default router;

import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { reverseGeocodeDetailed } from '../utils/geocode';
import { identifyBeat } from '../utils/geofence';
import { listDailyReports, getReportPath, generateAndSaveDailyReport } from '../utils/dailyReportGenerator';
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
    
      LIMIT 1000
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
    res.status(500).json({ error: 'Failed to get dashboard', code: 'GET_DASHBOARD_ERROR' });
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
    const validGroupBy = typeof groupBy === 'string' && groupBy in columnMap ? groupBy : 'type';
    const groupColumn = columnMap[validGroupBy];

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
    res.status(500).json({ error: 'Failed to get incidents summary', code: 'GET_INCIDENTS_SUMMARY_ERROR' });
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
    res.status(500).json({ error: 'Failed to get response times', code: 'GET_RESPONSE_TIMES_ERROR' });
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
    
      LIMIT 1000
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
    res.status(500).json({ error: 'Failed to get officer activity', code: 'GET_OFFICER_ACTIVITY_ERROR' });
  }
});

// GET /api/reports/client/:clientId - Client-specific report data
router.get('/client/:clientId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { startDate, endDate } = req.query;

    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.clientId) as any;
    if (!client) {
      res.status(404).json({ error: 'Client not found', code: 'CLIENT_NOT_FOUND' });
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
    res.status(500).json({ error: 'Failed to get client report', code: 'GET_CLIENT_REPORT_ERROR' });
  }
});

// GET /api/reports/shift-activity/:officerId — End-of-shift activity report data
router.get('/shift-activity/:officerId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { officerId } = req.params;
    const date = (req.query.date as string) || localToday();

    // Officer info
    const officer = db.prepare('SELECT id, full_name, badge_number, email, role FROM users WHERE id = ?').get(officerId) as any;
    if (!officer) return res.status(404).json({ error: 'Officer not found', code: 'OFFICER_NOT_FOUND' });

    // Calls handled today — find calls where this officer's unit was assigned
    // assigned_unit_ids is a JSON array stored as TEXT, and units.officer_id links to users
    const officerUnit = db.prepare('SELECT id FROM units WHERE officer_id = ?').get(officerId) as any;
    const unitId = officerUnit ? String(officerUnit.id) : '-1';
    const calls = db.prepare(`
      SELECT c.*
      FROM calls_for_service c
      WHERE DATE(c.created_at) = ? AND (
        c.dispatcher_id = ? OR c.assigned_unit_ids LIKE ?
      )
      ORDER BY c.created_at ASC
    
      LIMIT 1000
    `).all(date, officerId, `%${unitId}%`) as any[];

    // Incidents authored today
    const incidents = db.prepare(`
      SELECT id, incident_number, incident_type, priority, status, location_address, narrative, created_at
      FROM incidents
      WHERE DATE(created_at) = ? AND officer_id = ?
      ORDER BY created_at ASC
    
      LIMIT 1000
    `).all(date, officerId) as any[];

    // Patrol scans today
    const scans = db.prepare(`
      SELECT ps.*, pc.name as checkpoint_name, pc.description as location_description
      FROM patrol_scans ps
      LEFT JOIN patrol_checkpoints pc ON pc.id = ps.checkpoint_id
      WHERE DATE(ps.scanned_at) = ? AND ps.officer_id = ?
      ORDER BY ps.scanned_at ASC
    
      LIMIT 1000
    `).all(date, officerId) as any[];

    // Citations issued today
    const citations = db.prepare(`
      SELECT id, citation_number, violation_description, location, status, created_at
      FROM citations
      WHERE DATE(created_at) = ? AND officer_id = ?
      ORDER BY created_at ASC
    
      LIMIT 1000
    `).all(date, officerId) as any[];

    // Field interviews today
    const fieldInterviews = db.prepare(`
      SELECT id, subject_name, location, reason, created_at
      FROM field_interviews
      WHERE DATE(created_at) = ? AND officer_id = ?
      ORDER BY created_at ASC
    
      LIMIT 1000
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
    res.status(500).json({ error: 'Failed to get shift activity', code: 'GET_SHIFT_ACTIVITY_ERROR' });
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
    res.status(500).json({ error: 'Failed to training compliance', code: 'TRAINING_COMPLIANCE_ERROR' });
  }
});

// GET /api/reports/call-density — Call density data for heatmap
router.get('/call-density', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const days = parseInt(req.query.days as string) || 30;
    const incidentType = req.query.type as string;

    const safeDays = Math.max(1, Math.min(365, Math.floor(days) || 30));
    let sql = `
      SELECT latitude, longitude, priority, incident_type, zone_beat, created_at
      FROM calls_for_service
      WHERE latitude IS NOT NULL AND longitude IS NOT NULL
        AND created_at >= datetime('now', ?)
    `;
    const params: any[] = [`-${safeDays} days`];
    if (incidentType) {
      sql += ' AND incident_type = ?';
      params.push(incidentType);
    }

    const points = db.prepare(sql).all(...params) as any[];
    res.json({ points, count: points.length });
  } catch (error: any) {
    console.error('Call density error:', error);
    res.status(500).json({ error: 'Failed to call density', code: 'CALL_DENSITY_ERROR' });
  }
});

// GET /api/reports/statute-analytics — Statute violation analytics
router.get('/statute-analytics', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const days = Math.max(1, Math.min(365, parseInt(req.query.days as string) || 90));
    const offset = `-${days} days`;

    // Top cited statutes
    const topStatutes = db.prepare(`
      SELECT us.citation AS statute_number, us.short_title AS title, us.offense_level, COUNT(*) as count
      FROM citations c
      JOIN utah_statutes us ON us.id = c.statute_id
      WHERE c.created_at >= datetime('now', ?)
      GROUP BY c.statute_id
      ORDER BY count DESC
      LIMIT 20
    `).all(offset) as any[];

    // By offense level
    const byLevel = db.prepare(`
      SELECT us.offense_level, COUNT(*) as count
      FROM citations c
      JOIN utah_statutes us ON us.id = c.statute_id
      WHERE c.created_at >= datetime('now', ?)
      GROUP BY us.offense_level
      ORDER BY count DESC
    `).all(offset) as any[];

    // Monthly trend
    const trend = db.prepare(`
      SELECT strftime('%Y-%m', c.created_at) as month, COUNT(*) as count
      FROM citations c
      WHERE c.created_at >= datetime('now', ?)
      GROUP BY month
      ORDER BY month ASC
    `).all(offset) as any[];

    // From incidents too
    const incidentStatutes = db.prepare(`
      SELECT us.citation AS statute_number, us.short_title AS title, us.offense_level, COUNT(*) as count
      FROM incidents i
      JOIN utah_statutes us ON us.id = i.statute_id
      WHERE i.created_at >= datetime('now', ?) AND i.statute_id IS NOT NULL
      GROUP BY i.statute_id
      ORDER BY count DESC
      LIMIT 20
    `).all(offset) as any[];

    res.json({ topStatutes, byLevel, trend, incidentStatutes });
  } catch (error: any) {
    console.error('Statute analytics error:', error);
    res.status(500).json({ error: 'Failed to statute analytics', code: 'STATUTE_ANALYTICS_ERROR' });
  }
});

// GET /api/reports/patrol-compliance — Patrol scan compliance analytics
router.get('/patrol-compliance', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const days = Math.max(1, Math.min(365, parseInt(req.query.days as string) || 30));
    const offset = `-${days} days`;

    // Overall scan stats
    const totalScans = db.prepare(`
      SELECT COUNT(*) as count FROM patrol_scans WHERE scanned_at >= datetime('now', ?)
    `).get(offset) as any;

    const activeCheckpoints = db.prepare(`
      SELECT COUNT(*) as count FROM patrol_checkpoints WHERE is_active = 1
    `).get() as any;

    // By officer
    const byOfficer = db.prepare(`
      SELECT u.full_name, u.badge_number, COUNT(ps.id) as scan_count,
        COUNT(DISTINCT DATE(ps.scanned_at)) as active_days
      FROM patrol_scans ps
      JOIN users u ON u.id = ps.officer_id
      WHERE ps.scanned_at >= datetime('now', ?)
      GROUP BY ps.officer_id
      ORDER BY scan_count DESC
    `).all(offset) as any[];

    // By checkpoint
    const byCheckpoint = db.prepare(`
      SELECT pc.name, pc.description as location_description, COUNT(ps.id) as scan_count,
        MAX(ps.scanned_at) as last_scan
      FROM patrol_checkpoints pc
      LEFT JOIN patrol_scans ps ON ps.checkpoint_id = pc.id
        AND ps.scanned_at >= datetime('now', ?)
      WHERE pc.is_active = 1
      GROUP BY pc.id
      ORDER BY scan_count DESC
    `).all(offset) as any[];

    // By hour of day
    const byHour = db.prepare(`
      SELECT CAST(strftime('%H', scanned_at) AS INTEGER) as hour, COUNT(*) as count
      FROM patrol_scans
      WHERE scanned_at >= datetime('now', ?)
      GROUP BY hour
      ORDER BY hour ASC
    `).all(offset) as any[];

    res.json({
      totalScans: totalScans.count,
      activeCheckpoints: activeCheckpoints.count,
      byOfficer,
      byCheckpoint,
      byHour,
    });
  } catch (error: any) {
    console.error('Patrol compliance error:', error);
    res.status(500).json({ error: 'Failed to patrol compliance', code: 'PATROL_COMPLIANCE_ERROR' });
  }
});

// POST /api/reports/custom — Custom report builder query
router.post('/custom', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { source, columns, filters, groupBy, sortBy, sortDir, limit: queryLimit } = req.body;

    // Allowed sources and their column whitelists
    const ALLOWED_SOURCES: Record<string, string[]> = {
      calls_for_service: ['id', 'call_number', 'incident_type', 'priority', 'status', 'caller_name', 'location_address', 'zone_beat', 'beat_id', 'zone_id', 'section_id', 'disposition', 'created_at', 'dispatched_at', 'onscene_at', 'cleared_at'],
      incidents: ['id', 'incident_number', 'incident_type', 'priority', 'status', 'location_address', 'narrative', 'officer_id', 'created_at', 'occurred_date', 'zone_beat', 'beat_id', 'zone_id', 'disposition', 'domestic_violence', 'weapons_involved'],
      citations: ['id', 'citation_number', 'type', 'violation_description', 'statute_citation', 'offense_level', 'location', 'status', 'fine_amount', 'officer_id', 'violation_date', 'created_at'],
      warrants: ['id', 'warrant_number', 'type', 'status', 'offense_level', 'charge_description', 'statute_citation', 'court_name', 'bail_amount', 'date_issued', 'expires_at', 'served_at', 'created_at'],
      bolos: ['id', 'subject_name', 'description', 'priority', 'status', 'category', 'vehicle_info', 'location_last_seen', 'issued_by', 'created_at', 'expires_at'],
      evidence: ['id', 'evidence_number', 'incident_id', 'description', 'category', 'storage_location', 'chain_of_custody', 'collected_by', 'collected_at', 'created_at'],
      time_entries: ['id', 'officer_id', 'shift_date', 'clock_in', 'clock_out', 'hours_worked', 'overtime_hours', 'status', 'notes', 'approved_by'],
      training_records: ['id', 'officer_id', 'title', 'category', 'status', 'hours', 'completed_date', 'expiry_date', 'instructor', 'score'],
      field_interviews: ['id', 'subject_name', 'location', 'reason', 'officer_id', 'created_at'],
      patrol_scans: ['id', 'checkpoint_id', 'officer_id', 'scanned_at', 'gps_latitude', 'gps_longitude'],
    };

    if (!source || !ALLOWED_SOURCES[source]) {
      return res.status(400).json({ error: 'Invalid data source', code: 'INVALID_DATA_SOURCE' });
    }

    const allowedCols = ALLOWED_SOURCES[source];
    const selectedCols = (columns || allowedCols).filter((c: string) => allowedCols.includes(c));
    if (selectedCols.length === 0) return res.status(400).json({ error: 'No valid columns selected', code: 'NO_VALID_COLUMNS_SELECTED' });

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
    res.status(500).json({ error: 'Failed to generate custom report', code: 'CUSTOM_REPORT_ERROR' });
  }
});

// ─── GET /crime-analysis ─────────────────────────────────
// Crime analysis / ILP dashboard data
router.get('/crime-analysis', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { days = '90' } = req.query;
    const daysNum = Math.max(1, Math.min(365, parseInt(days as string, 10) || 90));
    const offset = `-${daysNum} days`;

    // Top offenses by incident type
    const topOffenses = db.prepare(`
      SELECT incident_type, COUNT(*) as count FROM incidents
      WHERE created_at >= DATE('now', ?) AND status != 'draft'
      GROUP BY incident_type ORDER BY count DESC LIMIT 10
    `).all(offset);

    // Monthly trend (last 12 months)
    const trendData = db.prepare(`
      SELECT strftime('%Y-%m', created_at) as month, COUNT(*) as count
      FROM incidents WHERE created_at >= DATE('now', '-12 months') AND status != 'draft'
      GROUP BY month ORDER BY month
    `).all();

    // Time of day distribution
    const timeOfDay = db.prepare(`
      SELECT CAST(strftime('%H', created_at) AS INTEGER) as hour, COUNT(*) as count
      FROM calls_for_service WHERE created_at >= DATE('now', ?)
      GROUP BY hour ORDER BY hour
    `).all(offset);

    // Day of week distribution
    const dayOfWeek = db.prepare(`
      SELECT CAST(strftime('%w', created_at) AS INTEGER) as day, COUNT(*) as count
      FROM calls_for_service WHERE created_at >= DATE('now', ?)
      GROUP BY day ORDER BY day
    `).all(offset);

    // Hotspot locations (top 15 by call count)
    const hotspots = db.prepare(`
      SELECT location_address, COUNT(*) as count,
        GROUP_CONCAT(DISTINCT incident_type) as types
      FROM calls_for_service
      WHERE created_at >= DATE('now', ?) AND location_address IS NOT NULL
      GROUP BY location_address ORDER BY count DESC LIMIT 15
    `).all(offset);

    // Repeat offenders (persons with 3+ incidents)
    const repeatOffenders = db.prepare(`
      SELECT p.id, p.first_name, p.last_name, p.dob,
        COUNT(ip.id) as incident_count,
        MAX(i.created_at) as last_incident
      FROM persons p
      JOIN incident_persons ip ON p.id = ip.person_id
      JOIN incidents i ON ip.incident_id = i.id
      WHERE i.created_at >= DATE('now', ?)
      GROUP BY p.id HAVING incident_count >= 3
      ORDER BY incident_count DESC LIMIT 20
    `).all(offset);

    // Response time metrics by priority
    const responseMetrics = db.prepare(`
      SELECT priority,
        ROUND(AVG(
          (julianday(onscene_at) - julianday(created_at)) * 1440
        ), 1) as avg_response_min,
        COUNT(*) as count
      FROM calls_for_service
      WHERE created_at >= DATE('now', ?) AND onscene_at IS NOT NULL
      GROUP BY priority
    `).all(offset);

    // Clearance rate
    const clearanceRate = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as cleared
      FROM incidents WHERE created_at >= DATE('now', ?)
    `).get(offset) as any;

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
    res.status(500).json({ error: 'Failed to crime analysis', code: 'CRIME_ANALYSIS_ERROR' });
  }
});

// ─── GET /crime-analysis/export ──────────────────────────────
// Export crime analysis incident-type breakdown as CSV
router.get('/crime-analysis/export', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { days, start_date, end_date } = req.query;

    let whereClause: string;
    let params: any[];

    if (start_date && end_date) {
      whereClause = `created_at >= ? AND created_at <= ? AND status != 'draft'`;
      params = [start_date as string, end_date as string];
    } else {
      const daysNum = Math.max(1, Math.min(365, parseInt(days as string, 10) || 90));
      whereClause = `created_at >= DATE('now', ?) AND status != 'draft'`;
      params = [`-${daysNum} days`];
    }

    const rows = db.prepare(`
      SELECT incident_type, COUNT(*) as count
      FROM incidents WHERE ${whereClause}
      GROUP BY incident_type ORDER BY count DESC
    `).all(...params) as { incident_type: string; count: number }[];

    const total = rows.reduce((s, r) => s + r.count, 0);
    const data = rows.map(r => ({
      incident_type: r.incident_type || 'Unknown',
      count: r.count,
      percentage: total > 0 ? Math.round((r.count / total) * 10000) / 100 : 0,
    }));

    const headers = ['incident_type', 'count', 'percentage'];
    const csvRows = [headers.join(',')];
    for (const row of data) {
      csvRows.push([
        `"${(row.incident_type).replace(/"/g, '""')}"`,
        row.count,
        row.percentage,
      ].join(','));
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `attachment; filename="crime-analysis_${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csvRows.join('\r\n'));
  } catch (error: any) {
    console.error('Crime analysis export error:', error);
    res.status(500).json({ error: 'Failed to export crime analysis', code: 'CRIME_ANALYSIS_EXPORT_ERROR' });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/reports/patrol-tracking — Patrol Tracking Report
//
// Enriched GPS breadcrumb data with derived fields (speed_mph,
// heading_cardinal, distance from previous point, stationary
// detection), per-unit aggregates, and optional reverse geocoding
// for road names / intersections.
// ─────────────────────────────────────────────────────────────
router.get('/patrol-tracking', requireRole('admin', 'manager', 'supervisor'), async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const unitId = req.query.unitId as string;
    const officerId = req.query.officerId as string;
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;
    const hours = parseInt(req.query.hours as string) || 8;
    const includeGeocode = req.query.geocode === 'true'; // opt-in (costs API calls)

    // ── Haversine distance (meters) ──────────────────────
    const haversineM = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
      const R = 6_371_000;
      const toRad = (d: number) => (d * Math.PI) / 180;
      const dLat = toRad(lat2 - lat1);
      const dLng = toRad(lng2 - lng1);
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };

    // ── Heading to cardinal direction ────────────────────
    const headingCardinal = (deg: number | null): string | null => {
      if (deg == null) return null;
      const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
      return dirs[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
    };

    // ── Build query ──────────────────────────────────────
    let dateClause: string;
    const params: any[] = [];

    if (startDate && endDate) {
      dateClause = `b.recorded_at >= ? AND b.recorded_at <= ?`;
      params.push(startDate, endDate);
    } else {
      dateClause = `b.recorded_at >= datetime('now', 'localtime', '-' || ? || ' hours')`;
      params.push(hours);
    }

    let whereExtra = '';
    if (unitId) {
      whereExtra += ' AND b.unit_id = ?';
      params.push(parseInt(unitId));
    }
    if (officerId) {
      whereExtra += ' AND b.officer_id = ?';
      params.push(parseInt(officerId));
    }

    const rows = db.prepare(`
      SELECT b.id, b.unit_id, b.officer_id, b.latitude, b.longitude, b.accuracy,
        b.heading, b.speed, b.unit_status, b.call_sign, b.officer_name,
        b.badge_number, b.current_call_id, b.current_call_number,
        b.current_call_type, b.road_name, b.nearest_intersection,
        b.recorded_at, COALESCE(b.source, 'unknown') as source
      FROM gps_breadcrumbs b
      WHERE ${dateClause} ${whereExtra}
      ORDER BY b.unit_id, b.recorded_at ASC
    
      LIMIT 1000
    `).all(...params) as any[];

    // ── Constants for filtering ─────────────────────────
    const MAX_ACCURACY = 150; // meters
    const MAX_SPEED = 80;     // m/s (~180 mph)
    const MIN_DISTANCE = 3;   // meters — collapse stationary

    // ── Process by unit ─────────────────────────────────
    interface ProcessedPoint {
      id: number;
      lat: number;
      lng: number;
      accuracy: number | null;
      heading: number | null;
      heading_cardinal: string | null;
      speed: number | null;
      speed_mph: number | null;
      status: string | null;
      call_sign: string;
      officer_name: string;
      badge_number: string;
      current_call_id: number | null;
      current_call_number: string | null;
      current_call_type: string | null;
      time: string;
      distance_from_prev_meters: number | null;
      time_delta_seconds: number | null;
      is_stationary: boolean;
      road_name?: string | null;
      nearest_intersection?: string | null;
      formatted_address?: string | null;
      source: string;
      beat_id: string | null;
      beat_code: string | null;
      zone: string | null;
      cumulative_distance_miles: number;
    }

    interface UnitTrail {
      unit_id: number;
      call_sign: string;
      officer_name: string;
      badge_number: string;
      officer_id: number;
      points: ProcessedPoint[];
      stats: {
        total_points: number;
        stationary_points: number;
        moving_points: number;
        total_distance_miles: number;
        max_speed_mph: number;
        avg_speed_mph: number;
        duration_minutes: number;
        source_breakdown: Record<string, number>;
      };
      response_segments: any[];
      zone_coverage: Record<string, {
        beat_code: string;
        city: string;
        point_count: number;
        time_seconds: number;
        percentage: number;
      }>;
    }

    const trailMap: Record<number, { raw: any[]; info: { call_sign: string; officer_name: string; badge_number: string; officer_id: number } }> = {};

    for (const row of rows) {
      if (!trailMap[row.unit_id]) {
        trailMap[row.unit_id] = {
          raw: [],
          info: {
            call_sign: row.call_sign || '',
            officer_name: row.officer_name || '',
            badge_number: row.badge_number || '',
            officer_id: row.officer_id,
          },
        };
      }

      // Accuracy gate
      if (row.accuracy != null && row.accuracy > MAX_ACCURACY) continue;

      trailMap[row.unit_id].raw.push(row);
    }

    const trails: UnitTrail[] = [];

    for (const [uid, trail] of Object.entries(trailMap)) {
      const unitId = parseInt(uid);
      const points: ProcessedPoint[] = [];
      let totalDistance = 0;
      let maxSpeed = 0;
      let speedSum = 0;
      let speedCount = 0;
      let stationaryCount = 0;
      let prevAccepted: any = null;

      for (const row of trail.raw) {
        let distFromPrev: number | null = null;
        let timeDelta: number | null = null;

        if (prevAccepted) {
          distFromPrev = haversineM(prevAccepted.latitude, prevAccepted.longitude, row.latitude, row.longitude);
          const prevTime = new Date(prevAccepted.recorded_at).getTime();
          const curTime = new Date(row.recorded_at).getTime();
          timeDelta = (curTime - prevTime) / 1000;

          // Jump detection
          if (timeDelta > 0) {
            const impliedSpeed = distFromPrev / timeDelta;
            if (impliedSpeed > MAX_SPEED) continue; // skip teleportation
          }

          // Skip points with zero or negative time delta (duplicate timestamps)
          if (timeDelta <= 0) continue;

          // Collapse stationary (counted once below via isStationary check)
          // No separate increment here — avoids double-counting
        }

        const speedMs = row.speed != null ? row.speed : (distFromPrev && timeDelta && timeDelta > 0 ? distFromPrev / timeDelta : null);
        const speedMph = speedMs != null ? speedMs * 2.237 : null;
        const isStationary = (speedMs != null && speedMs < 0.5) || (distFromPrev != null && distFromPrev < MIN_DISTANCE);

        if (distFromPrev != null && !isStationary) totalDistance += distFromPrev;
        if (speedMph != null && speedMph > 0) {
          if (speedMph > maxSpeed) maxSpeed = speedMph;
          speedSum += speedMph;
          speedCount++;
        }
        if (isStationary) stationaryCount++;

        // Beat zone identification
        const beat = identifyBeat(row.latitude, row.longitude);

        // Cumulative distance (running total of moving distance)
        const cumulativeMiles = Math.round((totalDistance / 1609.34) * 100) / 100;

        const pt: ProcessedPoint = {
          id: row.id,
          lat: row.latitude,
          lng: row.longitude,
          accuracy: row.accuracy,
          heading: row.heading,
          heading_cardinal: headingCardinal(row.heading),
          speed: speedMs,
          speed_mph: speedMph != null ? Math.round(speedMph * 10) / 10 : null,
          status: row.unit_status,
          call_sign: row.call_sign || '',
          officer_name: row.officer_name || '',
          badge_number: row.badge_number || '',
          current_call_id: row.current_call_id,
          current_call_number: row.current_call_number,
          current_call_type: row.current_call_type,
          time: row.recorded_at,
          distance_from_prev_meters: distFromPrev != null ? Math.round(distFromPrev * 10) / 10 : null,
          time_delta_seconds: timeDelta != null ? Math.round(timeDelta) : null,
          is_stationary: isStationary,
          road_name: row.road_name || null,
          nearest_intersection: row.nearest_intersection || null,
          source: row.source || 'unknown',
          beat_id: beat?.beat_id || null,
          beat_code: beat?.beat_code || null,
          zone: beat ? `${beat.city} ${beat.district_letter}${beat.beat_number}` : null,
          cumulative_distance_miles: cumulativeMiles,
        };

        points.push(pt);
        prevAccepted = row;
      }

      // ── Response time segments ─────────────────────────
      // For points linked to a call, compute response metrics
      const responseSegments: any[] = [];
      const callIds = new Set(points.filter(p => p.current_call_id).map(p => p.current_call_id!));

      for (const callId of callIds) {
        const call = db.prepare(`
          SELECT id, call_number, incident_type, priority, status,
            created_at, dispatched_at, enroute_at, onscene_at
          FROM calls_for_service WHERE id = ?
        `).get(callId) as any;

        if (!call) continue;

        const callPoints = points.filter(p => p.current_call_id === callId);
        if (callPoints.length === 0) continue;

        const firstPoint = callPoints[0];
        const lastPoint = callPoints[callPoints.length - 1];

        // Distance traveled during response
        let responseDist = 0;
        for (let i = 1; i < callPoints.length; i++) {
          const d = callPoints[i].distance_from_prev_meters;
          if (d && !callPoints[i].is_stationary) responseDist += d;
        }

        // Time from dispatched_at to first breadcrumb with this call
        let timeToFirstBreadcrumb: number | null = null;
        if (call.dispatched_at) {
          const dispatchTime = new Date(call.dispatched_at).getTime();
          const firstBcTime = new Date(firstPoint.time).getTime();
          timeToFirstBreadcrumb = Math.round((firstBcTime - dispatchTime) / 1000);
        }

        // Time from dispatch to onscene
        let timeToOnscene: number | null = null;
        if (call.dispatched_at && call.onscene_at) {
          const dispatchTime = new Date(call.dispatched_at).getTime();
          const onsceneTime = new Date(call.onscene_at).getTime();
          timeToOnscene = Math.round((onsceneTime - dispatchTime) / 1000);
        }

        responseSegments.push({
          call_id: call.id,
          call_number: call.call_number,
          incident_type: call.incident_type,
          priority: call.priority,
          dispatched_at: call.dispatched_at,
          onscene_at: call.onscene_at,
          time_to_first_breadcrumb_seconds: timeToFirstBreadcrumb,
          time_to_onscene_seconds: timeToOnscene,
          response_distance_miles: Math.round((responseDist / 1609.34) * 100) / 100,
          breadcrumb_count: callPoints.length,
        });
      }

      // ── Unit duration ──────────────────────────────────
      let durationMinutes = 0;
      if (points.length >= 2) {
        const first = new Date(points[0].time).getTime();
        const last = new Date(points[points.length - 1].time).getTime();
        durationMinutes = Math.round((last - first) / 60000);
      }

      // ── Zone coverage summary ────────────────────────────
      const zoneCoverage: Record<string, { beat_code: string; city: string; point_count: number; time_seconds: number; percentage: number }> = {};
      for (let i = 0; i < points.length; i++) {
        const pt = points[i];
        if (!pt.beat_id) continue;
        if (!zoneCoverage[pt.beat_id]) {
          zoneCoverage[pt.beat_id] = { beat_code: pt.beat_code || '', city: pt.zone || '', point_count: 0, time_seconds: 0, percentage: 0 };
        }
        zoneCoverage[pt.beat_id].point_count++;
        // Attribute time delta to this zone (the time spent between this point and the next)
        if (i < points.length - 1 && points[i + 1].time_delta_seconds) {
          zoneCoverage[pt.beat_id].time_seconds += points[i + 1].time_delta_seconds!;
        }
      }
      // Compute percentages
      const totalTrackedSeconds = Object.values(zoneCoverage).reduce((s, z) => s + z.time_seconds, 0);
      for (const z of Object.values(zoneCoverage)) {
        z.percentage = totalTrackedSeconds > 0 ? Math.round((z.time_seconds / totalTrackedSeconds) * 1000) / 10 : 0;
      }

      trails.push({
        unit_id: unitId,
        call_sign: trail.info.call_sign,
        officer_name: trail.info.officer_name,
        badge_number: trail.info.badge_number,
        officer_id: trail.info.officer_id,
        points,
        stats: {
          total_points: points.length,
          stationary_points: stationaryCount,
          moving_points: points.length - stationaryCount,
          total_distance_miles: Math.round((totalDistance / 1609.34) * 100) / 100,
          max_speed_mph: Math.round(maxSpeed * 10) / 10,
          avg_speed_mph: speedCount > 0 ? Math.round((speedSum / speedCount) * 10) / 10 : 0,
          duration_minutes: durationMinutes,
          source_breakdown: points.reduce((acc, p) => { acc[p.source] = (acc[p.source] || 0) + 1; return acc; }, {} as Record<string, number>),
        },
        response_segments: responseSegments,
        zone_coverage: zoneCoverage,
      });
    }

    // ── Optional reverse geocoding (sampled) ─────────────
    // Only geocode every point > 100m from last geocoded point,
    // capped at 50 calls per report request.
    if (includeGeocode) {
      let geocodeCount = 0;
      const MAX_GEOCODE_CALLS = 50;
      const GEOCODE_MIN_DISTANCE = 100; // meters between geocoded points

      for (const trail of trails) {
        let lastGeocodedLat = 0;
        let lastGeocodedLng = 0;
        let lastRoadName: string | null = null;
        let lastIntersection: string | null = null;
        let lastAddress: string | null = null;

        for (const pt of trail.points) {
          const dist = lastGeocodedLat ? haversineM(lastGeocodedLat, lastGeocodedLng, pt.lat, pt.lng) : Infinity;

          if (dist > GEOCODE_MIN_DISTANCE && geocodeCount < MAX_GEOCODE_CALLS) {
            const result = await reverseGeocodeDetailed(pt.lat, pt.lng);
            if (result) {
              lastRoadName = result.road_name;
              lastIntersection = result.nearest_intersection;
              lastAddress = result.formatted_address;
            }
            lastGeocodedLat = pt.lat;
            lastGeocodedLng = pt.lng;
            geocodeCount++;
          }

          pt.road_name = lastRoadName;
          pt.nearest_intersection = lastIntersection;
          pt.formatted_address = lastAddress;
        }
      }
    }

    res.json({
      trails,
      query: {
        unitId: unitId || null,
        officerId: officerId || null,
        startDate: startDate || null,
        endDate: endDate || null,
        hours,
        includeGeocode,
      },
      total_units: trails.length,
      total_points: trails.reduce((s, t) => s + t.points.length, 0),
    });
  } catch (error: any) {
    console.error('Patrol tracking report error:', error);
    res.status(500).json({ error: 'Failed to patrol tracking report', code: 'PATROL_TRACKING_REPORT_ERROR' });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/reports/daily-reports — List saved daily patrol reports
// ─────────────────────────────────────────────────────────────
router.get('/daily-reports', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const reports = listDailyReports();
    res.json({ reports });
  } catch (error: any) {
    console.error('List daily reports error:', error);
    res.status(500).json({ error: 'Failed to list daily reports', code: 'LIST_DAILY_REPORTS_ERROR' });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/reports/daily-reports/:filename — Download a saved report
// ─────────────────────────────────────────────────────────────
router.get('/daily-reports/:filename', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const filename = req.params.filename as string;
    const filepath = getReportPath(filename);
    if (!filepath) {
      res.status(404).json({ error: 'Report not found', code: 'REPORT_NOT_FOUND' });
      return;
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.sendFile(filepath);
  } catch (error: any) {
    console.error('Download daily report error:', error);
    res.status(500).json({ error: 'Failed to download daily report', code: 'DOWNLOAD_DAILY_REPORT_ERROR' });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/reports/daily-reports/generate — Manually trigger report
// ─────────────────────────────────────────────────────────────
router.post('/daily-reports/generate', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const date = req.body.date as string | undefined;
    const filename = await generateAndSaveDailyReport(date);
    if (!filename) {
      res.json({ ok: false, message: 'No breadcrumb data for specified date' });
      return;
    }
    res.json({ ok: true, filename });
  } catch (error: any) {
    console.error('Generate daily report error:', error);
    res.status(500).json({ error: 'Failed to generate daily report', code: 'GENERATE_DAILY_REPORT_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════════
// Feature 1: Monthly Incident Report
// ═══════════════════════════════════════════════════════════════
router.get('/monthly-incident-report', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const year = parseInt(req.query.year as string) || new Date().getFullYear();
    const month = parseInt(req.query.month as string) || (new Date().getMonth() + 1);
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endDate = month === 12
      ? `${year + 1}-01-01`
      : `${year}-${String(month + 1).padStart(2, '0')}-01`;

    const byType = db.prepare(`
      SELECT incident_type, COUNT(*) as count,
        SUM(CASE WHEN priority = 'P1' THEN 1 ELSE 0 END) as p1_count,
        SUM(CASE WHEN priority = 'P2' THEN 1 ELSE 0 END) as p2_count,
        SUM(CASE WHEN priority = 'P3' THEN 1 ELSE 0 END) as p3_count,
        SUM(CASE WHEN priority = 'P4' THEN 1 ELSE 0 END) as p4_count
      FROM incidents
      WHERE created_at >= ? AND created_at < ?
      GROUP BY incident_type ORDER BY count DESC
    `).all(startDate, endDate);

    const byStatus = db.prepare(`
      SELECT status, COUNT(*) as count FROM incidents
      WHERE created_at >= ? AND created_at < ?
      GROUP BY status ORDER BY count DESC
    `).all(startDate, endDate);

    const byDay = db.prepare(`
      SELECT DATE(created_at) as day, COUNT(*) as count FROM incidents
      WHERE created_at >= ? AND created_at < ?
      GROUP BY day ORDER BY day
    `).all(startDate, endDate);

    const byHour = db.prepare(`
      SELECT CAST(strftime('%H', created_at) AS INTEGER) as hour, COUNT(*) as count
      FROM incidents WHERE created_at >= ? AND created_at < ?
      GROUP BY hour ORDER BY hour
    `).all(startDate, endDate);

    const total = db.prepare(`
      SELECT COUNT(*) as count FROM incidents WHERE created_at >= ? AND created_at < ?
    `).get(startDate, endDate) as any;

    // Comparison with previous month
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    const prevStart = `${prevYear}-${String(prevMonth).padStart(2, '0')}-01`;
    const prevEnd = startDate;
    const prevTotal = db.prepare(`
      SELECT COUNT(*) as count FROM incidents WHERE created_at >= ? AND created_at < ?
    `).get(prevStart, prevEnd) as any;

    // Same month last year
    const lastYearStart = `${year - 1}-${String(month).padStart(2, '0')}-01`;
    const lastYearEnd = month === 12
      ? `${year}-01-01`
      : `${year - 1}-${String(month + 1).padStart(2, '0')}-01`;
    const lastYearTotal = db.prepare(`
      SELECT COUNT(*) as count FROM incidents WHERE created_at >= ? AND created_at < ?
    `).get(lastYearStart, lastYearEnd) as any;

    res.json({
      year, month,
      total: total.count,
      prevMonthTotal: prevTotal.count,
      lastYearTotal: lastYearTotal.count,
      changeFromPrevMonth: total.count - prevTotal.count,
      changeFromLastYear: total.count - lastYearTotal.count,
      byType, byStatus, byDay, byHour,
    });
  } catch (error: any) {
    console.error('Monthly incident report error:', error);
    res.status(500).json({ error: 'Failed to monthly incident report', code: 'MONTHLY_INCIDENT_REPORT_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════════
// Feature 2: Officer Performance Scorecard
// ═══════════════════════════════════════════════════════════════
router.get('/officer-scorecard/:officerId', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { officerId } = req.params;
    const days = Math.max(1, Math.min(365, parseInt(req.query.days as string) || 30));
    const offset = `-${days} days`;

    const officer = db.prepare('SELECT id, full_name, badge_number, role, rank FROM users WHERE id = ?').get(officerId) as any;
    if (!officer) return res.status(404).json({ error: 'Officer not found', code: 'OFFICER_NOT_FOUND' });

    const unit = db.prepare('SELECT id FROM units WHERE officer_id = ?').get(officerId) as any;
    const unitId = unit ? String(unit.id) : '-1';

    const callsHandled = db.prepare(`
      SELECT COUNT(*) as count FROM calls_for_service
      WHERE assigned_unit_ids LIKE ? AND created_at >= DATE('now', ?)
    `).get(`%${unitId}%`, offset) as any;

    const incidents = db.prepare(`
      SELECT COUNT(*) as count FROM incidents
      WHERE officer_id = ? AND created_at >= DATE('now', ?)
    `).get(officerId, offset) as any;

    const citations = db.prepare(`
      SELECT COUNT(*) as count FROM citations
      WHERE officer_id = ? AND created_at >= DATE('now', ?)
    `).get(officerId, offset) as any;

    const arrests = db.prepare(`
      SELECT COUNT(*) as count FROM arrest_records
      WHERE officer_id = ? AND created_at >= DATE('now', ?)
    `).get(officerId, offset) as any;

    const avgResponse = db.prepare(`
      SELECT AVG((julianday(onscene_at) - julianday(created_at)) * 1440) as avg_min
      FROM calls_for_service
      WHERE assigned_unit_ids LIKE ? AND onscene_at IS NOT NULL AND created_at >= DATE('now', ?)
    `).get(`%${unitId}%`, offset) as any;

    const fieldInterviews = db.prepare(`
      SELECT COUNT(*) as count FROM field_interviews
      WHERE officer_id = ? AND created_at >= DATE('now', ?)
    `).get(officerId, offset) as any;

    const patrolScans = db.prepare(`
      SELECT COUNT(*) as count FROM patrol_scans
      WHERE officer_id = ? AND scanned_at >= DATE('now', ?)
    `).get(officerId, offset) as any;

    const hoursWorked = db.prepare(`
      SELECT SUM(total_hours) as total FROM time_entries
      WHERE officer_id = ? AND status = 'completed' AND clock_in >= DATE('now', ?)
    `).get(officerId, offset) as any;

    res.json({
      officer,
      period_days: days,
      metrics: {
        calls_handled: callsHandled.count,
        incidents_written: incidents.count,
        citations_issued: citations.count,
        arrests_made: arrests?.count || 0,
        avg_response_minutes: avgResponse.avg_min ? Math.round(avgResponse.avg_min * 10) / 10 : null,
        field_interviews: fieldInterviews.count,
        patrol_scans: patrolScans.count,
        hours_worked: hoursWorked.total ? Math.round(hoursWorked.total * 10) / 10 : 0,
      },
    });
  } catch (error: any) {
    console.error('Officer scorecard error:', error);
    res.status(500).json({ error: 'Failed to officer scorecard', code: 'OFFICER_SCORECARD_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════════
// Feature 3: Crime Trend Analysis (month-over-month comparison)
// ═══════════════════════════════════════════════════════════════
router.get('/crime-trends', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
    const lastYearDate = new Date(now.getFullYear() - 1, now.getMonth(), 1);
    const lastYearMonth = `${lastYearDate.getFullYear()}-${String(lastYearDate.getMonth() + 1).padStart(2, '0')}`;

    const getMonthData = (monthStr: string) => db.prepare(`
      SELECT incident_type, COUNT(*) as count FROM incidents
      WHERE strftime('%Y-%m', created_at) = ?
      GROUP BY incident_type ORDER BY count DESC
    `).all(monthStr) as any[];

    const current = getMonthData(currentMonth);
    const previous = getMonthData(prevMonth);
    const lastYear = getMonthData(lastYearMonth);

    const allTypes = new Set<string>();
    [current, previous, lastYear].forEach(data => data.forEach((r: any) => allTypes.add(r.incident_type)));

    const trends = Array.from(allTypes).map(type => {
      const cur = current.find((r: any) => r.incident_type === type)?.count || 0;
      const prev = previous.find((r: any) => r.incident_type === type)?.count || 0;
      const ly = lastYear.find((r: any) => r.incident_type === type)?.count || 0;
      const momChange = prev > 0 ? Math.round(((cur - prev) / prev) * 100) : cur > 0 ? 100 : 0;
      const yoyChange = ly > 0 ? Math.round(((cur - ly) / ly) * 100) : cur > 0 ? 100 : 0;
      return { type, current: cur, previous: prev, lastYear: ly, momChange, yoyChange };
    }).sort((a, b) => b.current - a.current);

    const monthlyTrend = db.prepare(`
      SELECT strftime('%Y-%m', created_at) as month, COUNT(*) as count
      FROM incidents WHERE created_at >= DATE('now', '-12 months')
      GROUP BY month ORDER BY month
    `).all();

    res.json({ currentMonth, prevMonth, lastYearMonth, trends, monthlyTrend });
  } catch (error: any) {
    console.error('Crime trends error:', error);
    res.status(500).json({ error: 'Failed to crime trends', code: 'CRIME_TRENDS_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════════
// Feature 4: Beat Activity Report
// ═══════════════════════════════════════════════════════════════
router.get('/beat-activity', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const days = Math.max(1, Math.min(365, parseInt(req.query.days as string) || 30));
    const offset = `-${days} days`;

    const incidentsByBeat = db.prepare(`
      SELECT COALESCE(zone_beat, 'Unassigned') as beat, incident_type, COUNT(*) as count
      FROM incidents WHERE created_at >= DATE('now', ?)
      GROUP BY beat, incident_type ORDER BY beat, count DESC
    `).all(offset) as any[];

    const callsByBeat = db.prepare(`
      SELECT COALESCE(zone_beat, 'Unassigned') as beat, COUNT(*) as count,
        AVG(CASE WHEN onscene_at IS NOT NULL THEN (julianday(onscene_at) - julianday(created_at)) * 1440 END) as avg_response_min
      FROM calls_for_service WHERE created_at >= DATE('now', ?)
      GROUP BY beat ORDER BY count DESC
    `).all(offset) as any[];

    const citationsByBeat = db.prepare(`
      SELECT COALESCE(zone_beat, 'Unassigned') as beat, COUNT(*) as count
      FROM citations WHERE created_at >= DATE('now', ?)
      GROUP BY beat ORDER BY count DESC
    `).all(offset) as any[];

    const arrestsByBeat = db.prepare(`
      SELECT COALESCE(zone_beat, 'Unassigned') as beat, COUNT(*) as count
      FROM arrest_records WHERE created_at >= DATE('now', ?)
      GROUP BY beat ORDER BY count DESC
    `).all(offset) as any[];

    const beatMap: Record<string, any> = {};
    for (const row of callsByBeat) {
      if (!beatMap[row.beat]) beatMap[row.beat] = { beat: row.beat, calls: 0, incidents: 0, citations: 0, arrests: 0, avg_response_min: null, incident_types: [] };
      beatMap[row.beat].calls = row.count;
      beatMap[row.beat].avg_response_min = row.avg_response_min ? Math.round(row.avg_response_min * 10) / 10 : null;
    }
    for (const row of incidentsByBeat) {
      if (!beatMap[row.beat]) beatMap[row.beat] = { beat: row.beat, calls: 0, incidents: 0, citations: 0, arrests: 0, avg_response_min: null, incident_types: [] };
      beatMap[row.beat].incidents += row.count;
      beatMap[row.beat].incident_types.push({ type: row.incident_type, count: row.count });
    }
    for (const row of citationsByBeat) {
      if (!beatMap[row.beat]) beatMap[row.beat] = { beat: row.beat, calls: 0, incidents: 0, citations: 0, arrests: 0, avg_response_min: null, incident_types: [] };
      beatMap[row.beat].citations = row.count;
    }
    for (const row of arrestsByBeat) {
      if (!beatMap[row.beat]) beatMap[row.beat] = { beat: row.beat, calls: 0, incidents: 0, citations: 0, arrests: 0, avg_response_min: null, incident_types: [] };
      beatMap[row.beat].arrests = row.count;
    }

    res.json({ period_days: days, beats: Object.values(beatMap).sort((a: any, b: any) => b.calls - a.calls) });
  } catch (error: any) {
    console.error('Beat activity error:', error);
    res.status(500).json({ error: 'Failed to get beat activity report', code: 'BEAT_ACTIVITY_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════════
// Feature 5: Use of Force Tracking
// ═══════════════════════════════════════════════════════════════
router.get('/use-of-force', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const days = Math.max(1, Math.min(365, parseInt(req.query.days as string) || 90));
    const offset = `-${days} days`;

    db.prepare(`CREATE TABLE IF NOT EXISTS use_of_force (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      incident_id TEXT, officer_id TEXT NOT NULL,
      date_of_incident TEXT NOT NULL, force_type TEXT NOT NULL,
      force_level TEXT DEFAULT 'level_1', subject_name TEXT,
      subject_injury TEXT, officer_injury TEXT, circumstances TEXT,
      weapons_used TEXT, outcome TEXT, review_status TEXT DEFAULT 'pending',
      reviewed_by TEXT, reviewed_at TEXT, notes TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    )`).run();

    const incidents = db.prepare(`
      SELECT uof.*, u.full_name as officer_name, u.badge_number
      FROM use_of_force uof
      LEFT JOIN users u ON uof.officer_id = u.id
      WHERE uof.created_at >= DATE('now', ?)
      ORDER BY uof.created_at DESC
    
      LIMIT 1000
    `).all(offset);

    const byType = db.prepare(`
      SELECT force_type, COUNT(*) as count FROM use_of_force
      WHERE created_at >= DATE('now', ?) GROUP BY force_type ORDER BY count DESC
    `).all(offset);

    const byLevel = db.prepare(`
      SELECT force_level, COUNT(*) as count FROM use_of_force
      WHERE created_at >= DATE('now', ?) GROUP BY force_level ORDER BY count DESC
    `).all(offset);

    const byReviewStatus = db.prepare(`
      SELECT review_status, COUNT(*) as count FROM use_of_force
      WHERE created_at >= DATE('now', ?) GROUP BY review_status
    `).all(offset);

    const total = db.prepare(`SELECT COUNT(*) as count FROM use_of_force WHERE created_at >= DATE('now', ?)`).get(offset) as any;

    res.json({ period_days: days, total: total.count, incidents, byType, byLevel, byReviewStatus });
  } catch (error: any) {
    console.error('Use of force error:', error);
    res.status(500).json({ error: 'Failed to use of force', code: 'USE_OF_FORCE_ERROR' });
  }
});

router.post('/use-of-force', requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    db.prepare(`CREATE TABLE IF NOT EXISTS use_of_force (
      id INTEGER PRIMARY KEY AUTOINCREMENT, incident_id TEXT, officer_id TEXT NOT NULL,
      date_of_incident TEXT NOT NULL, force_type TEXT NOT NULL, force_level TEXT DEFAULT 'level_1',
      subject_name TEXT, subject_injury TEXT, officer_injury TEXT, circumstances TEXT,
      weapons_used TEXT, outcome TEXT, review_status TEXT DEFAULT 'pending',
      reviewed_by TEXT, reviewed_at TEXT, notes TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')), updated_at TEXT DEFAULT (datetime('now','localtime'))
    )`).run();
    const { incident_id, date_of_incident, force_type, force_level, subject_name, subject_injury, officer_injury, circumstances, weapons_used, outcome, notes } = req.body;
    const result = db.prepare(`
      INSERT INTO use_of_force (incident_id, officer_id, date_of_incident, force_type, force_level, subject_name, subject_injury, officer_injury, circumstances, weapons_used, outcome, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(incident_id, req.user!.userId, date_of_incident, force_type, force_level || 'level_1', subject_name, subject_injury, officer_injury, circumstances, weapons_used, outcome, notes);
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (error: any) {
    console.error('Create use of force error:', error);
    res.status(500).json({ error: 'Failed to create use of force', code: 'CREATE_USE_OF_FORCE' });
  }
});

// ═══════════════════════════════════════════════════════════════
// Feature 6: Vehicle Pursuit Log
// ═══════════════════════════════════════════════════════════════
router.get('/vehicle-pursuits', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const days = Math.max(1, Math.min(365, parseInt(req.query.days as string) || 90));
    const offset = `-${days} days`;

    db.prepare(`CREATE TABLE IF NOT EXISTS vehicle_pursuits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      incident_id TEXT, officer_id TEXT NOT NULL,
      pursuit_date TEXT NOT NULL, reason TEXT NOT NULL,
      max_speed_mph REAL, duration_minutes REAL,
      distance_miles REAL, weather_conditions TEXT,
      road_conditions TEXT, traffic_density TEXT,
      suspect_vehicle TEXT, outcome TEXT NOT NULL,
      property_damage INTEGER DEFAULT 0,
      injuries INTEGER DEFAULT 0,
      review_status TEXT DEFAULT 'pending',
      reviewed_by TEXT, reviewed_at TEXT, supervisor_notes TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    )`).run();

    const pursuits = db.prepare(`
      SELECT vp.*, u.full_name as officer_name, u.badge_number
      FROM vehicle_pursuits vp
      LEFT JOIN users u ON vp.officer_id = u.id
      WHERE vp.created_at >= DATE('now', ?)
      ORDER BY vp.created_at DESC
    
      LIMIT 1000
    `).all(offset);

    const byOutcome = db.prepare(`
      SELECT outcome, COUNT(*) as count FROM vehicle_pursuits
      WHERE created_at >= DATE('now', ?) GROUP BY outcome ORDER BY count DESC
    `).all(offset);

    const total = db.prepare(`SELECT COUNT(*) as count FROM vehicle_pursuits WHERE created_at >= DATE('now', ?)`).get(offset) as any;

    res.json({ period_days: days, total: total.count, pursuits, byOutcome });
  } catch (error: any) {
    console.error('Vehicle pursuits error:', error);
    res.status(500).json({ error: 'Failed to vehicle pursuits', code: 'VEHICLE_PURSUITS_ERROR' });
  }
});

router.post('/vehicle-pursuits', requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    db.prepare(`CREATE TABLE IF NOT EXISTS vehicle_pursuits (
      id INTEGER PRIMARY KEY AUTOINCREMENT, incident_id TEXT, officer_id TEXT NOT NULL,
      pursuit_date TEXT NOT NULL, reason TEXT NOT NULL, max_speed_mph REAL, duration_minutes REAL,
      distance_miles REAL, weather_conditions TEXT, road_conditions TEXT, traffic_density TEXT,
      suspect_vehicle TEXT, outcome TEXT NOT NULL, property_damage INTEGER DEFAULT 0,
      injuries INTEGER DEFAULT 0, review_status TEXT DEFAULT 'pending',
      reviewed_by TEXT, reviewed_at TEXT, supervisor_notes TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')), updated_at TEXT DEFAULT (datetime('now','localtime'))
    )`).run();
    const b = req.body;
    const result = db.prepare(`
      INSERT INTO vehicle_pursuits (incident_id, officer_id, pursuit_date, reason, max_speed_mph, duration_minutes, distance_miles, weather_conditions, road_conditions, traffic_density, suspect_vehicle, outcome, property_damage, injuries)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(b.incident_id, req.user!.userId, b.pursuit_date, b.reason, b.max_speed_mph, b.duration_minutes, b.distance_miles, b.weather_conditions, b.road_conditions, b.traffic_density, b.suspect_vehicle, b.outcome, b.property_damage ? 1 : 0, b.injuries ? 1 : 0);
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (error: any) {
    console.error('Create vehicle pursuit error:', error);
    res.status(500).json({ error: 'Failed to create vehicle pursuit', code: 'CREATE_VEHICLE_PURSUIT_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════════
// Feature 7: Property Crime Trends
// ═══════════════════════════════════════════════════════════════
router.get('/property-crime-trends', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const months = Math.max(1, Math.min(24, parseInt(req.query.months as string) || 12));

    const propertyCrimeTypes = ['burglary', 'theft', 'larceny', 'robbery', 'vandalism', 'auto_theft', 'shoplifting', 'trespass', 'property_damage'];
    const placeholders = propertyCrimeTypes.map(() => '?').join(',');

    const monthlyTrend = db.prepare(`
      SELECT strftime('%Y-%m', created_at) as month, incident_type, COUNT(*) as count
      FROM incidents
      WHERE incident_type IN (${placeholders})
        AND created_at >= DATE('now', '-' || ? || ' months')
      GROUP BY month, incident_type ORDER BY month
    `).all(...propertyCrimeTypes, months) as any[];

    const totals = db.prepare(`
      SELECT incident_type, COUNT(*) as count FROM incidents
      WHERE incident_type IN (${placeholders})
        AND created_at >= DATE('now', '-' || ? || ' months')
      GROUP BY incident_type ORDER BY count DESC
    `).all(...propertyCrimeTypes, months);

    res.json({ months, monthlyTrend, totals });
  } catch (error: any) {
    console.error('Property crime trends error:', error);
    res.status(500).json({ error: 'Failed to property crime trends', code: 'PROPERTY_CRIME_TRENDS_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════════
// Feature 8: Arrest Demographics Report
// ═══════════════════════════════════════════════════════════════
router.get('/arrest-demographics', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const days = Math.max(1, Math.min(365, parseInt(req.query.days as string) || 90));
    const offset = `-${days} days`;

    const byCharge = db.prepare(`
      SELECT charge_description, COUNT(*) as count FROM arrest_records
      WHERE created_at >= DATE('now', ?) GROUP BY charge_description ORDER BY count DESC LIMIT 20
    `).all(offset);

    const byTimeOfDay = db.prepare(`
      SELECT CAST(strftime('%H', created_at) AS INTEGER) as hour, COUNT(*) as count
      FROM arrest_records WHERE created_at >= DATE('now', ?) GROUP BY hour ORDER BY hour
    `).all(offset);

    const byDayOfWeek = db.prepare(`
      SELECT CAST(strftime('%w', created_at) AS INTEGER) as day, COUNT(*) as count
      FROM arrest_records WHERE created_at >= DATE('now', ?) GROUP BY day ORDER BY day
    `).all(offset);

    const byLocation = db.prepare(`
      SELECT COALESCE(zone_beat, 'Unknown') as location, COUNT(*) as count FROM arrest_records
      WHERE created_at >= DATE('now', ?) GROUP BY location ORDER BY count DESC LIMIT 15
    `).all(offset);

    const monthlyTrend = db.prepare(`
      SELECT strftime('%Y-%m', created_at) as month, COUNT(*) as count
      FROM arrest_records WHERE created_at >= DATE('now', ?) GROUP BY month ORDER BY month
    `).all(offset);

    const total = db.prepare(`SELECT COUNT(*) as count FROM arrest_records WHERE created_at >= DATE('now', ?)`).get(offset) as any;

    res.json({ period_days: days, total: total.count, byCharge, byTimeOfDay, byDayOfWeek, byLocation, monthlyTrend });
  } catch (error: any) {
    console.error('Arrest demographics error:', error);
    res.status(500).json({ error: 'Failed to arrest demographics', code: 'ARREST_DEMOGRAPHICS_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════════
// Feature 9: Citation Revenue Report
// ═══════════════════════════════════════════════════════════════
router.get('/citation-revenue', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const months = Math.max(1, Math.min(24, parseInt(req.query.months as string) || 12));

    const monthlyRevenue = db.prepare(`
      SELECT strftime('%Y-%m', created_at) as month,
        COUNT(*) as total_citations,
        COALESCE(SUM(fine_amount), 0) as total_fines,
        COALESCE(SUM(CASE WHEN status = 'paid' THEN fine_amount ELSE 0 END), 0) as collected,
        COALESCE(SUM(CASE WHEN status != 'paid' AND status != 'dismissed' THEN fine_amount ELSE 0 END), 0) as outstanding
      FROM citations
      WHERE created_at >= DATE('now', '-' || ? || ' months')
      GROUP BY month ORDER BY month
    `).all(months);

    const byType = db.prepare(`
      SELECT type, COUNT(*) as count, COALESCE(SUM(fine_amount), 0) as total_fines
      FROM citations WHERE created_at >= DATE('now', '-' || ? || ' months')
      GROUP BY type ORDER BY total_fines DESC
    `).all(months);

    const summary = db.prepare(`
      SELECT
        COUNT(*) as total_citations,
        COALESCE(SUM(fine_amount), 0) as total_fines,
        COALESCE(SUM(CASE WHEN status = 'paid' THEN fine_amount ELSE 0 END), 0) as collected,
        COALESCE(SUM(CASE WHEN status != 'paid' AND status != 'dismissed' THEN fine_amount ELSE 0 END), 0) as outstanding,
        COALESCE(SUM(CASE WHEN status = 'dismissed' THEN fine_amount ELSE 0 END), 0) as dismissed
      FROM citations WHERE created_at >= DATE('now', '-' || ? || ' months')
    `).get(months) as any;

    res.json({ months, summary, monthlyRevenue, byType });
  } catch (error: any) {
    console.error('Citation revenue error:', error);
    res.status(500).json({ error: 'Failed to citation revenue', code: 'CITATION_REVENUE_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════════
// Feature 10: Response Time Analysis (enhanced)
// ═══════════════════════════════════════════════════════════════
router.get('/response-time-analysis', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const days = Math.max(1, Math.min(365, parseInt(req.query.days as string) || 30));
    const offset = `-${days} days`;

    const overall = db.prepare(`
      SELECT
        ROUND(AVG((julianday(onscene_at) - julianday(created_at)) * 1440), 1) as avg_min,
        ROUND(MIN((julianday(onscene_at) - julianday(created_at)) * 1440), 1) as min_min,
        ROUND(MAX((julianday(onscene_at) - julianday(created_at)) * 1440), 1) as max_min,
        COUNT(*) as total_calls
      FROM calls_for_service
      WHERE onscene_at IS NOT NULL AND created_at >= DATE('now', ?)
    `).get(offset) as any;

    const allTimes = db.prepare(`
      SELECT ROUND((julianday(onscene_at) - julianday(created_at)) * 1440, 1) as response_min
      FROM calls_for_service
      WHERE onscene_at IS NOT NULL AND created_at >= DATE('now', ?)
      ORDER BY response_min
    
      LIMIT 1000
    `).all(offset) as any[];
    const p50Idx = Math.floor(allTimes.length * 0.5);
    const p95Idx = Math.floor(allTimes.length * 0.95);
    const median = allTimes.length > 0 ? allTimes[p50Idx]?.response_min : null;
    const p95 = allTimes.length > 0 ? allTimes[Math.min(p95Idx, allTimes.length - 1)]?.response_min : null;

    const byPriority = db.prepare(`
      SELECT priority,
        ROUND(AVG((julianday(onscene_at) - julianday(created_at)) * 1440), 1) as avg_min,
        COUNT(*) as count
      FROM calls_for_service
      WHERE onscene_at IS NOT NULL AND created_at >= DATE('now', ?)
      GROUP BY priority ORDER BY priority
    `).all(offset);

    const byBeat = db.prepare(`
      SELECT COALESCE(zone_beat, 'Unassigned') as beat,
        ROUND(AVG((julianday(onscene_at) - julianday(created_at)) * 1440), 1) as avg_min,
        COUNT(*) as count
      FROM calls_for_service
      WHERE onscene_at IS NOT NULL AND created_at >= DATE('now', ?)
      GROUP BY beat ORDER BY avg_min
    `).all(offset);

    const byHour = db.prepare(`
      SELECT CAST(strftime('%H', created_at) AS INTEGER) as hour,
        ROUND(AVG((julianday(onscene_at) - julianday(created_at)) * 1440), 1) as avg_min,
        COUNT(*) as count
      FROM calls_for_service
      WHERE onscene_at IS NOT NULL AND created_at >= DATE('now', ?)
      GROUP BY hour ORDER BY hour
    `).all(offset);

    res.json({
      period_days: days,
      overall: { ...overall, median, p95 },
      byPriority, byBeat, byHour,
    });
  } catch (error: any) {
    console.error('Response time analysis error:', error);
    res.status(500).json({ error: 'Failed to response time analysis', code: 'RESPONSE_TIME_ANALYSIS_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════════
// Feature 11: Daily Briefing Generator
// ═══════════════════════════════════════════════════════════════
router.get('/daily-briefing', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const date = (req.query.date as string) || localToday();

    const activeBolos = db.prepare(`
      SELECT id, bolo_number, type, title, description, priority, subject_description, vehicle_description
      FROM bolos WHERE status = 'active' ORDER BY priority, created_at DESC LIMIT 10
    `).all();

    const activeWarrants = db.prepare(`
      SELECT w.id, w.warrant_number, w.type, w.charge_description, w.offense_level, w.bail_amount,
        COALESCE(p.first_name || ' ' || p.last_name, '') as subject_name
      FROM warrants w LEFT JOIN persons p ON w.subject_person_id = p.id
      WHERE w.status = 'active' ORDER BY w.offense_level DESC, w.created_at DESC LIMIT 10
    `).all();

    const recentIncidents = db.prepare(`
      SELECT id, incident_number, incident_type, priority, status, location_address, narrative
      FROM incidents WHERE DATE(created_at) = ? ORDER BY priority, created_at DESC LIMIT 15
    `).all(date);

    const prevDayStats = db.prepare(`
      SELECT COUNT(*) as total_calls,
        SUM(CASE WHEN priority = 'P1' THEN 1 ELSE 0 END) as p1_calls,
        SUM(CASE WHEN priority = 'P2' THEN 1 ELSE 0 END) as p2_calls,
        ROUND(AVG(CASE WHEN onscene_at IS NOT NULL THEN (julianday(onscene_at) - julianday(created_at)) * 1440 END), 1) as avg_response
      FROM calls_for_service WHERE DATE(created_at) = DATE(?, '-1 day')
    `).get(date) as any;

    const trendingIncidents = db.prepare(`
      SELECT incident_type, COUNT(*) as count FROM incidents
      WHERE created_at >= DATE('now', '-7 days')
      GROUP BY incident_type ORDER BY count DESC LIMIT 5
    `).all();

    const personnelOnDuty = db.prepare(`
      SELECT u.full_name, u.badge_number, un.call_sign, un.status
      FROM units un JOIN users u ON un.officer_id = u.id
      WHERE un.status != 'off_duty'
    
      LIMIT 1000
    `).all();

    res.json({ date, activeBolos, activeWarrants, recentIncidents, prevDayStats, trendingIncidents, personnelOnDuty });
  } catch (error: any) {
    console.error('Daily briefing error:', error);
    res.status(500).json({ error: 'Failed to daily briefing', code: 'DAILY_BRIEFING_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════════
// Feature 12: Weekly Activity Digest
// ═══════════════════════════════════════════════════════════════
router.get('/weekly-digest', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();

    const totalCalls = db.prepare(`SELECT COUNT(*) as count FROM calls_for_service WHERE created_at >= DATE('now', '-7 days')`).get() as any;
    const totalIncidents = db.prepare(`SELECT COUNT(*) as count FROM incidents WHERE created_at >= DATE('now', '-7 days')`).get() as any;
    const totalCitations = db.prepare(`SELECT COUNT(*) as count FROM citations WHERE created_at >= DATE('now', '-7 days')`).get() as any;
    const totalArrests = db.prepare(`SELECT COUNT(*) as count FROM arrest_records WHERE created_at >= DATE('now', '-7 days')`).get() as any;

    const avgResponse = db.prepare(`
      SELECT ROUND(AVG((julianday(onscene_at) - julianday(created_at)) * 1440), 1) as avg_min
      FROM calls_for_service WHERE onscene_at IS NOT NULL AND created_at >= DATE('now', '-7 days')
    `).get() as any;

    const byDay = db.prepare(`
      SELECT DATE(created_at) as day, COUNT(*) as count FROM calls_for_service
      WHERE created_at >= DATE('now', '-7 days') GROUP BY day ORDER BY day
    `).all();

    const topIncidentTypes = db.prepare(`
      SELECT incident_type, COUNT(*) as count FROM incidents
      WHERE created_at >= DATE('now', '-7 days')
      GROUP BY incident_type ORDER BY count DESC LIMIT 10
    `).all();

    const topOfficers = db.prepare(`
      SELECT u.full_name, u.badge_number, COUNT(i.id) as incident_count
      FROM incidents i JOIN users u ON i.officer_id = u.id
      WHERE i.created_at >= DATE('now', '-7 days')
      GROUP BY i.officer_id ORDER BY incident_count DESC LIMIT 10
    `).all();

    res.json({
      period: '7 days',
      summary: { totalCalls: totalCalls.count, totalIncidents: totalIncidents.count, totalCitations: totalCitations.count, totalArrests: totalArrests?.count || 0, avgResponseMinutes: avgResponse.avg_min },
      byDay, topIncidentTypes, topOfficers,
    });
  } catch (error: any) {
    console.error('Weekly digest error:', error);
    res.status(500).json({ error: 'Failed to weekly digest', code: 'WEEKLY_DIGEST_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════════
// Feature 14: Report Scheduling (CRUD)
// ═══════════════════════════════════════════════════════════════
router.get('/schedules', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    db.prepare(`CREATE TABLE IF NOT EXISTS report_schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, report_type TEXT NOT NULL,
      frequency TEXT NOT NULL DEFAULT 'weekly', parameters TEXT DEFAULT '{}', recipients TEXT DEFAULT '[]',
      last_run TEXT, next_run TEXT, is_active INTEGER DEFAULT 1, created_by TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now','localtime')), updated_at TEXT DEFAULT (datetime('now','localtime'))
    )`).run();
    const schedules = db.prepare(`
      SELECT rs.*, u.full_name as created_by_name FROM report_schedules rs
      LEFT JOIN users u ON rs.created_by = u.id ORDER BY rs.created_at DESC
    
      LIMIT 1000
    `).all();
    res.json(schedules);
  } catch (error: any) {
    console.error('Report schedules error:', error);
    res.status(500).json({ error: 'Failed to report schedules', code: 'REPORT_SCHEDULES_ERROR' });
  }
});

router.post('/schedules', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    db.prepare(`CREATE TABLE IF NOT EXISTS report_schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, report_type TEXT NOT NULL,
      frequency TEXT NOT NULL DEFAULT 'weekly', parameters TEXT DEFAULT '{}', recipients TEXT DEFAULT '[]',
      last_run TEXT, next_run TEXT, is_active INTEGER DEFAULT 1, created_by TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now','localtime')), updated_at TEXT DEFAULT (datetime('now','localtime'))
    )`).run();
    const { name, report_type, frequency, parameters, recipients } = req.body;
    const result = db.prepare(`
      INSERT INTO report_schedules (name, report_type, frequency, parameters, recipients, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(name, report_type, frequency || 'weekly', JSON.stringify(parameters || {}), JSON.stringify(recipients || []), req.user!.userId);
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (error: any) {
    console.error('Create schedule error:', error);
    res.status(500).json({ error: 'Failed to create schedule', code: 'CREATE_SCHEDULE_ERROR' });
  }
});

router.delete('/schedules/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM report_schedules WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    console.error('Delete schedule error:', error);
    res.status(500).json({ error: 'Failed to delete schedule', code: 'DELETE_SCHEDULE_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════════
// Feature 15: Report Template Library
// ═══════════════════════════════════════════════════════════════
router.get('/templates', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    db.prepare(`CREATE TABLE IF NOT EXISTS report_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT,
      report_type TEXT NOT NULL, configuration TEXT NOT NULL DEFAULT '{}',
      is_default INTEGER DEFAULT 0, created_by TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now','localtime')), updated_at TEXT DEFAULT (datetime('now','localtime'))
    )`).run();
    const templates = db.prepare(`
      SELECT rt.*, u.full_name as created_by_name FROM report_templates rt
      LEFT JOIN users u ON rt.created_by = u.id ORDER BY rt.is_default DESC, rt.name
    
      LIMIT 1000
    `).all();
    res.json(templates);
  } catch (error: any) {
    console.error('Report templates error:', error);
    res.status(500).json({ error: 'Failed to report templates', code: 'REPORT_TEMPLATES_ERROR' });
  }
});

router.post('/templates', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    db.prepare(`CREATE TABLE IF NOT EXISTS report_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT,
      report_type TEXT NOT NULL, configuration TEXT NOT NULL DEFAULT '{}',
      is_default INTEGER DEFAULT 0, created_by TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now','localtime')), updated_at TEXT DEFAULT (datetime('now','localtime'))
    )`).run();
    const { name, description, report_type, configuration } = req.body;
    const result = db.prepare(`
      INSERT INTO report_templates (name, description, report_type, configuration, created_by)
      VALUES (?, ?, ?, ?, ?)
    `).run(name, description, report_type, JSON.stringify(configuration || {}), req.user!.userId);
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (error: any) {
    console.error('Create template error:', error);
    res.status(500).json({ error: 'Failed to create template', code: 'CREATE_TEMPLATE_ERROR' });
  }
});

router.delete('/templates/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM report_templates WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    console.error('Delete template error:', error);
    res.status(500).json({ error: 'Failed to delete template', code: 'DELETE_TEMPLATE_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════════
// Dashboard Widget Endpoints (Features 31-45)
// ═══════════════════════════════════════════════════════════════

// Feature 33: Shift Performance Comparison
router.get('/shift-comparison', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const days = Math.max(1, Math.min(90, parseInt(req.query.days as string) || 30));
    const offset = `-${days} days`;

    const shifts = [
      { name: 'Day', startHour: 6, endHour: 14 },
      { name: 'Swing', startHour: 14, endHour: 22 },
      { name: 'Night', startHour: 22, endHour: 6 },
    ];

    const results = shifts.map(shift => {
      const hourCondition = shift.name === 'Night'
        ? `(CAST(strftime('%H', created_at) AS INTEGER) >= ${shift.startHour} OR CAST(strftime('%H', created_at) AS INTEGER) < ${shift.endHour})`
        : `CAST(strftime('%H', created_at) AS INTEGER) >= ${shift.startHour} AND CAST(strftime('%H', created_at) AS INTEGER) < ${shift.endHour}`;

      const stats = db.prepare(`
        SELECT COUNT(*) as calls,
          ROUND(AVG(CASE WHEN onscene_at IS NOT NULL THEN (julianday(onscene_at) - julianday(created_at)) * 1440 END), 1) as avg_response
        FROM calls_for_service
        WHERE created_at >= DATE('now', ?) AND ${hourCondition}
      `).get(offset) as any;

      const incidents = db.prepare(`
        SELECT COUNT(*) as count FROM incidents
        WHERE created_at >= DATE('now', ?) AND ${hourCondition}
      `).get(offset) as any;

      return { shift: shift.name, hours: `${String(shift.startHour).padStart(2, '0')}00-${String(shift.endHour).padStart(2, '0')}00`, calls: stats.calls, avgResponseMin: stats.avg_response, incidents: incidents.count };
    });

    res.json({ period_days: days, shifts: results });
  } catch (error: any) {
    console.error('Shift comparison error:', error);
    res.status(500).json({ error: 'Failed to shift comparison', code: 'SHIFT_COMPARISON_ERROR' });
  }
});

// Feature 38: Clearance Rate
router.get('/clearance-rate', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const days = Math.max(1, Math.min(365, parseInt(req.query.days as string) || 30));
    const offset = `-${days} days`;

    const result = db.prepare(`
      SELECT COUNT(*) as total,
        SUM(CASE WHEN status IN ('approved', 'closed') THEN 1 ELSE 0 END) as cleared,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN status IN ('submitted', 'under_review') THEN 1 ELSE 0 END) as pending
      FROM incidents WHERE created_at >= DATE('now', ?)
    `).get(offset) as any;

    res.json({ total: result.total, cleared: result.cleared, active: result.active, pending: result.pending, rate: result.total > 0 ? Math.round((result.cleared / result.total) * 100) : 0 });
  } catch (error: any) {
    console.error('Clearance rate error:', error);
    res.status(500).json({ error: 'Failed to clearance rate', code: 'CLEARANCE_RATE_ERROR' });
  }
});

// Feature 39: Patrol Coverage
router.get('/patrol-coverage', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const totalBeats = db.prepare(`SELECT COUNT(DISTINCT property_id) as count FROM patrol_checkpoints WHERE is_active = 1`).get() as any;
    const coveredBeats = db.prepare(`
      SELECT COUNT(DISTINCT pc.property_id) as count
      FROM patrol_scans ps JOIN patrol_checkpoints pc ON ps.checkpoint_id = pc.id
      WHERE ps.scanned_at >= datetime('now', '-8 hours')
    `).get() as any;

    const activeUnits = db.prepare(`
      SELECT u.call_sign, u.status, u.latitude, u.longitude, us.full_name as officer_name, us.badge_number
      FROM units u LEFT JOIN users us ON u.officer_id = us.id
      WHERE u.status NOT IN ('off_duty', 'out_of_service')
    
      LIMIT 1000
    `).all();

    res.json({ totalBeats: totalBeats.count || 0, coveredBeats: coveredBeats.count || 0, coverage: totalBeats.count > 0 ? Math.round((coveredBeats.count / totalBeats.count) * 100) : 0, activeUnits });
  } catch (error: any) {
    console.error('Patrol coverage error:', error);
    res.status(500).json({ error: 'Failed to patrol coverage', code: 'PATROL_COVERAGE_ERROR' });
  }
});

// Feature 41: Evidence Pending Count
router.get('/evidence-pending', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const pending = db.prepare(`SELECT COUNT(*) as count FROM evidence WHERE status IN ('collected', 'pending', 'in_lab')`).get() as any;
    const byStatus = db.prepare(`SELECT status, COUNT(*) as count FROM evidence WHERE status IN ('collected', 'pending', 'in_lab', 'released', 'destroyed') GROUP BY status ORDER BY count DESC`).all();
    res.json({ pending: pending.count, byStatus });
  } catch (error: any) {
    console.error('Evidence pending error:', error);
    res.status(500).json({ error: 'Failed to evidence pending', code: 'EVIDENCE_PENDING_ERROR' });
  }
});

// Feature 42: Upcoming Court Dates
router.get('/upcoming-court', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const upcoming = db.prepare(`
      SELECT ce.*, u.full_name as officer_name FROM court_events ce
      LEFT JOIN users u ON ce.created_by = u.id
      WHERE ce.event_date >= DATE('now') AND ce.event_date <= DATE('now', '+7 days') ORDER BY ce.event_date ASC
    
      LIMIT 1000
    `).all();
    res.json({ count: upcoming.length, upcoming });
  } catch (error: any) {
    console.error('Upcoming court error:', error);
    res.status(500).json({ error: 'Failed to upcoming court', code: 'UPCOMING_COURT_ERROR' });
  }
});

// Feature 43: Overdue Reports Count
router.get('/overdue-reports', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const overdue = db.prepare(`SELECT COUNT(*) as count FROM incidents WHERE status = 'draft' AND created_at <= DATE('now', '-3 days')`).get() as any;
    const overdueList = db.prepare(`
      SELECT i.id, i.incident_number, i.incident_type, i.created_at, u.full_name as officer_name
      FROM incidents i LEFT JOIN users u ON i.officer_id = u.id
      WHERE i.status = 'draft' AND i.created_at <= DATE('now', '-3 days') ORDER BY i.created_at ASC LIMIT 20
    `).all();
    res.json({ count: overdue.count, overdueList });
  } catch (error: any) {
    console.error('Overdue reports error:', error);
    res.status(500).json({ error: 'Failed to overdue reports', code: 'OVERDUE_REPORTS_ERROR' });
  }
});

// ══════════════════════════════════════════════════════════════════
// REPORT UPGRADES
// ══════════════════════════════════════════════════════════════════

// ── Upgrade 26: Report templates CRUD ───────────────────────────
router.get('/templates', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const templates = db.prepare(`
      SELECT config_key, config_value, created_at, updated_at
      FROM system_config
      WHERE category = 'report_template' AND is_active = 1
      ORDER BY sort_order ASC
    `).all() as any[];

    const parsed = templates.map(t => {
      try {
        return { id: t.config_key, ...JSON.parse(t.config_value), created_at: t.created_at, updated_at: t.updated_at };
      } catch {
        return { id: t.config_key, name: t.config_key, config: {}, created_at: t.created_at };
      }
    });

    res.json({ data: parsed });
  } catch (error: any) {
    console.error('Get report templates error:', error);
    res.status(500).json({ error: 'Failed to get report templates', code: 'GET_REPORT_TEMPLATES_ERROR' });
  }
});

router.post('/templates', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { name, description, source, columns, filters, groupBy, sortBy, sortDir, schedule } = req.body;
    if (!name) { res.status(400).json({ error: 'name is required', code: 'NAME_REQUIRED' }); return; }

    const now = localNow();
    const key = `rpt_${Date.now()}`;
    const value = JSON.stringify({ name, description, source, columns, filters, groupBy, sortBy, sortDir, schedule });

    const maxOrder = db.prepare(
      "SELECT MAX(sort_order) as mx FROM system_config WHERE category = 'report_template'"
    ).get() as any;

    db.prepare(`
      INSERT INTO system_config (config_key, config_value, category, sort_order, created_at, updated_at)
      VALUES (?, ?, 'report_template', ?, ?, ?)
    `).run(key, value, (maxOrder?.mx ?? -1) + 1, now, now);

    res.status(201).json({ id: key, name, description });
  } catch (error: any) {
    console.error('Create report template error:', error);
    res.status(500).json({ error: 'Failed to create report template', code: 'CREATE_REPORT_TEMPLATE_ERROR' });
  }
});

router.put('/templates/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const existing = db.prepare(
      "SELECT * FROM system_config WHERE config_key = ? AND category = 'report_template'"
    ).get(req.params.id) as any;
    if (!existing) { res.status(404).json({ error: 'Template not found', code: 'TEMPLATE_NOT_FOUND' }); return; }

    const now = localNow();
    const value = JSON.stringify(req.body);
    db.prepare("UPDATE system_config SET config_value = ?, updated_at = ? WHERE config_key = ? AND category = 'report_template'")
      .run(value, now, req.params.id);

    res.json({ id: req.params.id, ...req.body });
  } catch (error: any) {
    console.error('Update report template error:', error);
    res.status(500).json({ error: 'Failed to update report template', code: 'UPDATE_REPORT_TEMPLATE_ERROR' });
  }
});

router.delete('/templates/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    db.prepare("UPDATE system_config SET is_active = 0 WHERE config_key = ? AND category = 'report_template'")
      .run(req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    console.error('Delete report template error:', error);
    res.status(500).json({ error: 'Failed to delete report template', code: 'DELETE_REPORT_TEMPLATE_ERROR' });
  }
});

// ── Upgrade 27: Report scheduling (save schedule configs) ───────
router.get('/schedules', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const schedules = db.prepare(`
      SELECT config_key, config_value, created_at, updated_at
      FROM system_config
      WHERE category = 'report_schedule' AND is_active = 1
      ORDER BY created_at DESC
    `).all() as any[];

    const parsed = schedules.map(s => {
      try {
        return { id: s.config_key, ...JSON.parse(s.config_value), created_at: s.created_at };
      } catch {
        return { id: s.config_key, name: 'Unknown', created_at: s.created_at };
      }
    });

    res.json({ data: parsed });
  } catch (error: any) {
    console.error('Get report schedules error:', error);
    res.status(500).json({ error: 'Failed to get report schedules', code: 'GET_REPORT_SCHEDULES_ERROR' });
  }
});

router.post('/schedules', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { name, template_id, frequency, day_of_week, day_of_month, time_of_day, recipients, enabled } = req.body;
    if (!name || !frequency) { res.status(400).json({ error: 'name and frequency required', code: 'NAME_FREQUENCY_REQUIRED' }); return; }

    const now = localNow();
    const key = `sched_${Date.now()}`;
    const value = JSON.stringify({
      name, template_id, frequency, day_of_week, day_of_month, time_of_day,
      recipients, enabled: enabled !== false, created_by: req.user!.userId,
    });

    db.prepare(`
      INSERT INTO system_config (config_key, config_value, category, sort_order, created_at, updated_at)
      VALUES (?, ?, 'report_schedule', 0, ?, ?)
    `).run(key, value, now, now);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'report_schedule_created', 'report_schedule', 0, ?, ?)`).run(
      req.user!.userId, `Created report schedule: ${name} (${frequency})`, req.ip || 'unknown');

    res.status(201).json({ id: key, name, frequency });
  } catch (error: any) {
    console.error('Create report schedule error:', error);
    res.status(500).json({ error: 'Failed to create report schedule', code: 'CREATE_REPORT_SCHEDULE_ERROR' });
  }
});

router.put('/schedules/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const value = JSON.stringify(req.body);
    db.prepare("UPDATE system_config SET config_value = ?, updated_at = ? WHERE config_key = ? AND category = 'report_schedule'")
      .run(value, now, req.params.id);
    res.json({ id: req.params.id, ...req.body });
  } catch (error: any) {
    console.error('Update report schedule error:', error);
    res.status(500).json({ error: 'Failed to update report schedule', code: 'UPDATE_REPORT_SCHEDULE_ERROR' });
  }
});

router.delete('/schedules/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    db.prepare("UPDATE system_config SET is_active = 0 WHERE config_key = ? AND category = 'report_schedule'")
      .run(req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    console.error('Delete report schedule error:', error);
    res.status(500).json({ error: 'Failed to delete report schedule', code: 'DELETE_REPORT_SCHEDULE_ERROR' });
  }
});

// ── Upgrade 28: Period comparison (this week vs last week, etc) ─
router.get('/comparison', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { period = 'week' } = req.query;

    let currentStart: string, currentEnd: string, previousStart: string, previousEnd: string;

    if (period === 'month') {
      currentStart = "date('now', 'start of month')";
      currentEnd = "datetime('now')";
      previousStart = "date('now', 'start of month', '-1 month')";
      previousEnd = "date('now', 'start of month')";
    } else {
      // Default: week (Mon-Sun)
      currentStart = "date('now', 'weekday 0', '-6 days')";
      currentEnd = "datetime('now')";
      previousStart = "date('now', 'weekday 0', '-13 days')";
      previousEnd = "date('now', 'weekday 0', '-6 days')";
    }

    // Calls comparison
    const currentCalls = db.prepare(`
      SELECT COUNT(*) as count FROM calls_for_service WHERE created_at >= ${currentStart} AND created_at <= ${currentEnd}
    `).get() as any;
    const previousCalls = db.prepare(`
      SELECT COUNT(*) as count FROM calls_for_service WHERE created_at >= ${previousStart} AND created_at < ${previousEnd}
    `).get() as any;

    // Incidents comparison
    const currentIncidents = db.prepare(`
      SELECT COUNT(*) as count FROM incidents WHERE created_at >= ${currentStart} AND created_at <= ${currentEnd}
    `).get() as any;
    const previousIncidents = db.prepare(`
      SELECT COUNT(*) as count FROM incidents WHERE created_at >= ${previousStart} AND created_at < ${previousEnd}
    `).get() as any;

    // Citations comparison
    const currentCitations = db.prepare(`
      SELECT COUNT(*) as count FROM citations WHERE created_at >= ${currentStart} AND created_at <= ${currentEnd}
    `).get() as any;
    const previousCitations = db.prepare(`
      SELECT COUNT(*) as count FROM citations WHERE created_at >= ${previousStart} AND created_at < ${previousEnd}
    `).get() as any;

    // Response time comparison
    const currentResponse = db.prepare(`
      SELECT AVG((julianday(onscene_at) - julianday(created_at)) * 24 * 60) as avg_minutes
      FROM calls_for_service WHERE onscene_at IS NOT NULL AND created_at >= ${currentStart} AND created_at <= ${currentEnd}
    `).get() as any;
    const previousResponse = db.prepare(`
      SELECT AVG((julianday(onscene_at) - julianday(created_at)) * 24 * 60) as avg_minutes
      FROM calls_for_service WHERE onscene_at IS NOT NULL AND created_at >= ${previousStart} AND created_at < ${previousEnd}
    `).get() as any;

    const calcChange = (current: number, previous: number) => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return Math.round(((current - previous) / previous) * 100);
    };

    const round = (v: any) => v ? Math.round(v * 10) / 10 : null;

    res.json({
      period,
      calls: {
        current: currentCalls?.count || 0,
        previous: previousCalls?.count || 0,
        change: calcChange(currentCalls?.count || 0, previousCalls?.count || 0),
      },
      incidents: {
        current: currentIncidents?.count || 0,
        previous: previousIncidents?.count || 0,
        change: calcChange(currentIncidents?.count || 0, previousIncidents?.count || 0),
      },
      citations: {
        current: currentCitations?.count || 0,
        previous: previousCitations?.count || 0,
        change: calcChange(currentCitations?.count || 0, previousCitations?.count || 0),
      },
      responseTime: {
        current: round(currentResponse?.avg_minutes),
        previous: round(previousResponse?.avg_minutes),
        change: currentResponse?.avg_minutes && previousResponse?.avg_minutes
          ? calcChange(currentResponse.avg_minutes, previousResponse.avg_minutes) : null,
      },
    });
  } catch (error: any) {
    console.error('Comparison report error:', error);
    res.status(500).json({ error: 'Failed to get comparison report', code: 'COMPARISON_REPORT_ERROR' });
  }
});

// ── Upgrade 29: Shift summary data ─────────────────────────────
router.get('/shift-summary', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { date, shift } = req.query;
    const targetDate = (date as string) || localToday();

    // Define shift windows (default day shift 0600-1800, night 1800-0600)
    let startHour = 6, endHour = 18;
    if (shift === 'night') { startHour = 18; endHour = 6; }
    else if (shift === 'swing') { startHour = 14; endHour = 22; }

    const shiftStart = `${targetDate} ${String(startHour).padStart(2, '0')}:00:00`;
    const shiftEnd = shift === 'night'
      ? `${targetDate} 23:59:59`
      : `${targetDate} ${String(endHour).padStart(2, '0')}:00:00`;

    // Calls during shift
    const calls = db.prepare(`
      SELECT COUNT(*) as total,
        SUM(CASE WHEN priority = 'P1' THEN 1 ELSE 0 END) as p1,
        SUM(CASE WHEN priority = 'P2' THEN 1 ELSE 0 END) as p2,
        SUM(CASE WHEN status = 'cleared' THEN 1 ELSE 0 END) as cleared,
        AVG(CASE WHEN onscene_at IS NOT NULL
          THEN (julianday(onscene_at) - julianday(created_at)) * 24 * 60
          ELSE NULL END) as avg_response_min
      FROM calls_for_service
      WHERE created_at >= ? AND created_at <= ?
    `).get(shiftStart, shiftEnd) as any;

    // Incidents during shift
    const incidents = db.prepare(`
      SELECT COUNT(*) as total FROM incidents WHERE created_at >= ? AND created_at <= ?
    `).get(shiftStart, shiftEnd) as any;

    // Officers on duty during shift
    const officers = db.prepare(`
      SELECT DISTINCT u.id, u.full_name, u.badge_number, un.call_sign
      FROM units un
      JOIN users u ON un.officer_id = u.id
      WHERE un.status != 'off_duty'
      LIMIT 50
    `).all();

    // Activity during shift
    const activity = db.prepare(`
      SELECT al.action, COUNT(*) as count
      FROM activity_log al
      WHERE al.created_at >= ? AND al.created_at <= ?
      GROUP BY al.action ORDER BY count DESC LIMIT 10
    `).all(shiftStart, shiftEnd);

    res.json({
      date: targetDate,
      shift: shift || 'day',
      shiftStart,
      shiftEnd,
      calls: {
        total: calls?.total || 0,
        p1: calls?.p1 || 0,
        p2: calls?.p2 || 0,
        cleared: calls?.cleared || 0,
        avgResponseMin: calls?.avg_response_min ? Math.round(calls.avg_response_min * 10) / 10 : null,
      },
      incidents: incidents?.total || 0,
      officersOnDuty: officers,
      topActivity: activity,
    });
  } catch (error: any) {
    console.error('Shift summary error:', error);
    res.status(500).json({ error: 'Failed to get shift summary', code: 'SHIFT_SUMMARY_ERROR' });
  }
});

// ── Upgrade 30: Officer activity feed (recent actions) ──────────
router.get('/officer-feed/:officerId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { officerId } = req.params;
    const { limit = '30' } = req.query;
    const limitNum = Math.min(100, parseInt(limit as string, 10) || 30);

    const officer = db.prepare('SELECT id, full_name, badge_number FROM users WHERE id = ?').get(officerId) as any;
    if (!officer) { res.status(404).json({ error: 'Officer not found', code: 'OFFICER_NOT_FOUND' }); return; }

    const feed = db.prepare(`
      SELECT al.id, al.action, al.entity_type, al.entity_id, al.details, al.created_at
      FROM activity_log al
      WHERE al.user_id = ?
      ORDER BY al.created_at DESC
      LIMIT ?
    `).all(officerId, limitNum);

    res.json({ officer, feed });
  } catch (error: any) {
    console.error('Officer feed error:', error);
    res.status(500).json({ error: 'Failed to get officer feed', code: 'OFFICER_FEED_ERROR' });
  }
});

export default router;

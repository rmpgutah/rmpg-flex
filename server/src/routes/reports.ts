import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';

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

export default router;

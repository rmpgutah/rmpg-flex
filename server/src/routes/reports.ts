import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { reverseGeocodeDetailed } from '../utils/geocode';
import { identifyBeat } from '../utils/geofence';
import { listDailyReports, getReportPath, generateAndSaveDailyReport } from '../utils/dailyReportGenerator';
import { localToday } from '../utils/timeUtils';
import { escapeLike, quoteIdent } from '../middleware/sanitize';
import { auditLog } from '../utils/auditLogger';

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
      WHERE DATE(created_at) = DATE('now', 'localtime')
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
      WHERE onscene_at IS NOT NULL AND DATE(created_at) = DATE('now', 'localtime')
    `).get() as any;

    // Calls by priority today
    const callsByPriority = db.prepare(`
      SELECT priority, COUNT(*) as count FROM calls_for_service
      WHERE DATE(created_at) = DATE('now', 'localtime')
      GROUP BY priority ORDER BY priority
    `).all();

    // Calls by status
    const callsByStatus = db.prepare(`
      SELECT status, COUNT(*) as count FROM calls_for_service
      WHERE DATE(created_at) = DATE('now', 'localtime')
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
      WHERE DATE(created_at) = DATE('now', 'localtime')
      GROUP BY hour ORDER BY hour
    `).all();

    // ── PSO (Process Service Officer) Metrics ──
    const psoActive = db.prepare(`
      SELECT COUNT(*) as count FROM calls_for_service
      WHERE incident_type = 'pso_client_request'
        AND status IN ('pending', 'dispatched', 'enroute', 'onscene')
    `).get() as any;

    const psoToday = db.prepare(`
      SELECT COUNT(*) as count FROM calls_for_service
      WHERE incident_type = 'pso_client_request'
        AND DATE(created_at) = DATE('now', 'localtime')
    `).get() as any;

    const psoThisMonth = db.prepare(`
      SELECT COUNT(*) as count FROM calls_for_service
      WHERE incident_type = 'pso_client_request'
        AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now', 'localtime')
    `).get() as any;

    const psoCompleted = db.prepare(`
      SELECT COUNT(*) as count FROM calls_for_service
      WHERE incident_type = 'pso_client_request'
        AND status IN ('cleared', 'closed', 'archived')
        AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now', 'localtime')
    `).get() as any;

    // Process service success rate (served vs total attempts this month)
    const psoServeResults = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN process_service_result = 'served' THEN 1 ELSE 0 END) as served,
        SUM(CASE WHEN process_service_result = 'not_served' THEN 1 ELSE 0 END) as not_served,
        SUM(CASE WHEN process_service_result = 'refused' THEN 1 ELSE 0 END) as refused,
        SUM(CASE WHEN process_service_result IS NULL OR process_service_result = '' THEN 1 ELSE 0 END) as pending_result
      FROM calls_for_service
      WHERE incident_type = 'pso_client_request'
        AND process_service_type IS NOT NULL AND process_service_type != ''
        AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now', 'localtime')
    `).get() as any;

    // Average attempts per process serve
    const psoAvgAttempts = db.prepare(`
      SELECT AVG(CAST(process_attempts AS REAL)) as avg_attempts
      FROM calls_for_service
      WHERE incident_type = 'pso_client_request'
        AND process_attempts IS NOT NULL AND process_attempts > 0
        AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now', 'localtime')
    `).get() as any;

    // PSO calls by service type (this month)
    const psoByServiceType = db.prepare(`
      SELECT pso_service_type, COUNT(*) as count
      FROM calls_for_service
      WHERE incident_type = 'pso_client_request'
        AND pso_service_type IS NOT NULL AND pso_service_type != ''
        AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now', 'localtime')
      GROUP BY pso_service_type ORDER BY count DESC
    `).all();

    // ServeManager sync stats (if tables exist)
    let smStats = { totalJobs: 0, pendingJobs: 0, completedJobs: 0 };
    try {
      const smTotal = db.prepare(`SELECT COUNT(*) as count FROM sm_jobs`).get() as any;
      const smPending = db.prepare(`SELECT COUNT(*) as count FROM sm_jobs WHERE status IN ('pending', 'assigned', 'in_progress')`).get() as any;
      const smCompleted = db.prepare(`SELECT COUNT(*) as count FROM sm_jobs WHERE status IN ('completed', 'served')`).get() as any;
      smStats = { totalJobs: smTotal?.count ?? 0, pendingJobs: smPending?.count ?? 0, completedJobs: smCompleted?.count ?? 0 };
    } catch { /* sm_jobs table may not exist */ }

    // PSO avg response time (separate from general)
    const psoAvgResponse = db.prepare(`
      SELECT AVG(
        (julianday(onscene_at) - julianday(created_at)) * 24 * 60
      ) as avg_minutes
      FROM calls_for_service
      WHERE incident_type = 'pso_client_request'
        AND onscene_at IS NOT NULL
        AND DATE(created_at) = DATE('now', 'localtime')
    `).get() as any;

    const pso = {
      activeCalls: psoActive?.count ?? 0,
      todayCalls: psoToday?.count ?? 0,
      monthCalls: psoThisMonth?.count ?? 0,
      monthCompleted: psoCompleted?.count ?? 0,
      avgResponseMinutes: psoAvgResponse?.avg_minutes ? Math.round(psoAvgResponse.avg_minutes * 10) / 10 : null,
      avgAttempts: psoAvgAttempts?.avg_attempts ? Math.round(psoAvgAttempts.avg_attempts * 10) / 10 : null,
      serveResults: {
        total: psoServeResults?.total || 0,
        served: psoServeResults?.served || 0,
        notServed: psoServeResults?.not_served || 0,
        refused: psoServeResults?.refused || 0,
        pendingResult: psoServeResults?.pending_result || 0,
      },
      byServiceType: psoByServiceType,
      serveManager: smStats,
    };

    res.json({
      activeCalls: activeCalls?.count ?? 0,
      todayCalls: todayCalls?.count ?? 0,
      unitsOnDuty: unitsOnDuty?.count ?? 0,
      totalUnits: totalUnits?.count ?? 0,
      pendingReports: pendingReports?.count ?? 0,
      activeBolos: activeBolos?.count ?? 0,
      unreadMessages: unreadMessages?.count ?? 0,
      avgResponseMinutes: avgResponse?.avg_minutes ? Math.round(avgResponse.avg_minutes * 10) / 10 : null,
      callsByPriority,
      callsByStatus,
      recentActivity,
      officersOnDuty,
      callsByHour,
      pso,
    });
  } catch (error: any) {
    console.error('Get dashboard error:', error?.message || 'Unknown error');
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
    console.error('Get incidents summary error:', error?.message || 'Unknown error');
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
      const pid = parseInt(String(propertyId), 10);
      if (!isNaN(pid)) {
        dateFilter += ' AND property_id = ?';
        dateFilterAliased += ' AND c.property_id = ?';
        params.push(pid);
      }
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
    console.error('Get response times error:', error?.message || 'Unknown error');
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
        WHERE officer_id = ? AND status = 'completed' ${dateFilter.replaceAll('created_at', 'clock_in')}
      `).get(officer.id, ...params) as any;

      // Calls responded to (via unit assignment)
      const unit = db.prepare('SELECT id FROM units WHERE officer_id = ?').get(officer.id) as any;
      let callsResponded = 0;
      if (unit) {
        const callCount = db.prepare(`
          SELECT COUNT(*) as count FROM calls_for_service
          WHERE assigned_unit_ids LIKE ? ESCAPE '\\' ${dateFilter}
        `).get(`%${escapeLike(String(unit.id))}%`, ...params) as any;
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
    console.error('Get officer activity error:', error?.message || 'Unknown error');
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
    console.error('Get client report error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/reports/shift-activity/:officerId — End-of-shift activity report data
router.get('/shift-activity/:officerId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { officerId } = req.params;
    const date = (req.query.date as string) || localToday();

    // Authorization: officers can only view their own shift data
    const privilegedRoles = ['admin', 'manager', 'supervisor'];
    if (!privilegedRoles.includes(req.user!.role) && String(req.user!.userId) !== String(officerId)) {
      res.status(403).json({ error: 'You can only view your own shift activity' });
      return;
    }

    // Officer info
    const officer = db.prepare('SELECT id, full_name, badge_number, email, role FROM users WHERE id = ?').get(officerId) as any;
    if (!officer) return res.status(404).json({ error: 'Officer not found' });

    // Calls handled today — find calls where this officer's unit was assigned
    // assigned_unit_ids is a JSON array stored as TEXT, and units.officer_id links to users
    const officerUnit = db.prepare('SELECT id FROM units WHERE officer_id = ?').get(officerId) as any;
    const unitId = officerUnit ? String(officerUnit.id) : '-1';
    const calls = db.prepare(`
      SELECT c.*
      FROM calls_for_service c
      WHERE DATE(c.created_at) = ? AND (
        c.dispatcher_id = ? OR c.assigned_unit_ids LIKE ? ESCAPE '\\'
      )
      ORDER BY c.created_at ASC
    `).all(date, officerId, `%${escapeLike(unitId)}%`) as any[];

    // Incidents authored today
    const incidents = db.prepare(`
      SELECT id, incident_number, incident_type, priority, status, location_address, narrative, created_at
      FROM incidents
      WHERE DATE(created_at) = ? AND officer_id = ?
      ORDER BY created_at ASC
    `).all(date, officerId) as any[];

    // Patrol scans today
    const scans = db.prepare(`
      SELECT ps.*, pc.name as checkpoint_name, pc.description as location_description
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
      SELECT id, fi_number, (subject_first_name || ' ' || subject_last_name) AS subject_name, location, contact_reason, created_at
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
    console.error('Get shift activity error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/reports/training-compliance — Org-wide training compliance
router.get('/training-compliance', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const users = db.prepare("SELECT id, full_name, badge_number, role FROM users WHERE role IN ('officer','manager','admin') AND status = 'active'").all() as any[];
    const requirements = db.prepare('SELECT * FROM training_requirements WHERE is_active = 1').all() as any[];
    const records = db.prepare('SELECT * FROM training_records ORDER BY completed_date DESC LIMIT 10000').all() as any[];
    res.json({ users, requirements, records });
  } catch (error: any) {
    console.error('Training compliance error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/reports/call-density — Call density data for heatmap
router.get('/call-density', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const days = parseInt(req.query.days as string, 10) || 30;
    const incidentType = req.query.type as string;

    const safeDays = Math.max(1, Math.min(365, Math.floor(days) || 30));
    let sql = `
      SELECT latitude, longitude, priority, incident_type, zone_beat, created_at
      FROM calls_for_service
      WHERE latitude IS NOT NULL AND longitude IS NOT NULL
        AND created_at >= datetime('now', 'localtime', ?)
    `;
    const params: any[] = [`-${safeDays} days`];
    if (incidentType) {
      sql += ' AND incident_type = ?';
      params.push(incidentType);
    }

    const points = db.prepare(sql).all(...params) as any[];
    res.json({ points, count: points.length });
  } catch (error: any) {
    console.error('Call density error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/reports/statute-analytics — Statute violation analytics
router.get('/statute-analytics', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const days = Math.max(1, Math.min(365, parseInt(req.query.days as string, 10) || 90));
    const offset = `-${days} days`;

    // Top cited statutes
    const topStatutes = db.prepare(`
      SELECT us.citation AS statute_number, us.short_title AS title, us.offense_level, COUNT(*) as count
      FROM citations c
      JOIN utah_statutes us ON us.id = c.statute_id
      WHERE c.created_at >= datetime('now', 'localtime', ?)
      GROUP BY c.statute_id
      ORDER BY count DESC
      LIMIT 20
    `).all(offset) as any[];

    // By offense level
    const byLevel = db.prepare(`
      SELECT us.offense_level, COUNT(*) as count
      FROM citations c
      JOIN utah_statutes us ON us.id = c.statute_id
      WHERE c.created_at >= datetime('now', 'localtime', ?)
      GROUP BY us.offense_level
      ORDER BY count DESC
    `).all(offset) as any[];

    // Monthly trend
    const trend = db.prepare(`
      SELECT strftime('%Y-%m', c.created_at) as month, COUNT(*) as count
      FROM citations c
      WHERE c.created_at >= datetime('now', 'localtime', ?)
      GROUP BY month
      ORDER BY month ASC
    `).all(offset) as any[];

    // From incidents too
    const incidentStatutes = db.prepare(`
      SELECT us.citation AS statute_number, us.short_title AS title, us.offense_level, COUNT(*) as count
      FROM incidents i
      JOIN utah_statutes us ON us.id = i.statute_id
      WHERE i.created_at >= datetime('now', 'localtime', ?) AND i.statute_id IS NOT NULL
      GROUP BY i.statute_id
      ORDER BY count DESC
      LIMIT 20
    `).all(offset) as any[];

    res.json({ topStatutes, byLevel, trend, incidentStatutes });
  } catch (error: any) {
    console.error('Statute analytics error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/reports/patrol-compliance — Patrol scan compliance analytics
router.get('/patrol-compliance', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const days = Math.max(1, Math.min(365, parseInt(req.query.days as string, 10) || 30));
    const offset = `-${days} days`;

    // Overall scan stats
    const totalScans = db.prepare(`
      SELECT COUNT(*) as count FROM patrol_scans WHERE scanned_at >= datetime('now', 'localtime', ?)
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
      WHERE ps.scanned_at >= datetime('now', 'localtime', ?)
      GROUP BY ps.officer_id
      ORDER BY scan_count DESC
    `).all(offset) as any[];

    // By checkpoint
    const byCheckpoint = db.prepare(`
      SELECT pc.name, pc.description as location_description, COUNT(ps.id) as scan_count,
        MAX(ps.scanned_at) as last_scan
      FROM patrol_checkpoints pc
      LEFT JOIN patrol_scans ps ON ps.checkpoint_id = pc.id
        AND ps.scanned_at >= datetime('now', 'localtime', ?)
      WHERE pc.is_active = 1
      GROUP BY pc.id
      ORDER BY scan_count DESC
    `).all(offset) as any[];

    // By hour of day
    const byHour = db.prepare(`
      SELECT CAST(strftime('%H', scanned_at) AS INTEGER) as hour, COUNT(*) as count
      FROM patrol_scans
      WHERE scanned_at >= datetime('now', 'localtime', ?)
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
    console.error('Patrol compliance error:', error?.message || 'Unknown error');
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
      calls_for_service: ['id', 'call_number', 'incident_type', 'priority', 'status', 'caller_name', 'location_address', 'zone_beat', 'beat_id', 'zone_id', 'section_id', 'disposition', 'created_at', 'dispatched_at', 'onscene_at', 'cleared_at'],
      incidents: ['id', 'incident_number', 'incident_type', 'priority', 'status', 'location_address', 'narrative', 'officer_id', 'created_at', 'occurred_date', 'zone_beat', 'beat_id', 'zone_id', 'disposition', 'domestic_violence', 'weapons_involved'],
      citations: ['id', 'citation_number', 'type', 'violation_description', 'statute_citation', 'offense_level', 'location', 'status', 'fine_amount', 'issuing_officer_id', 'violation_date', 'created_at'],
      warrants: ['id', 'warrant_number', 'type', 'status', 'offense_level', 'charge_description', 'statute_citation', 'issuing_court', 'issuing_judge', 'bail_amount', 'expires_at', 'served_at', 'created_at'],
      bolos: ['id', 'title', 'description', 'subject_description', 'vehicle_description', 'priority', 'status', 'issued_by', 'created_at', 'expires_at'],
      evidence: ['id', 'evidence_number', 'incident_id', 'description', 'category', 'storage_location', 'chain_of_custody', 'collected_by', 'collected_date', 'created_at'],
      time_entries: ['id', 'officer_id', 'clock_in', 'clock_out', 'total_hours', 'break_minutes', 'status', 'created_at'],
      training_records: ['id', 'officer_id', 'course_name', 'category', 'status', 'hours', 'completed_date', 'expiry_date', 'score', 'created_at'],
      field_interviews: ['id', 'fi_number', 'subject_first_name', 'subject_last_name', 'location', 'contact_reason', 'officer_id', 'created_at'],
      patrol_scans: ['id', 'checkpoint_id', 'officer_id', 'scanned_at', 'latitude', 'longitude'],
      schedules: ['id', 'officer_id', 'property_id', 'shift_date', 'start_time', 'end_time', 'status', 'notes', 'created_at'],
    };

    if (!source || !ALLOWED_SOURCES[source]) {
      return res.status(400).json({ error: 'Invalid data source' });
    }

    const allowedCols = ALLOWED_SOURCES[source];
    const selectedCols = (columns || allowedCols).filter((c: string) => allowedCols.includes(c));
    if (selectedCols.length === 0) return res.status(400).json({ error: 'No valid columns selected' });

    let sql = `SELECT ${selectedCols.map(quoteIdent).join(', ')} FROM ${quoteIdent(source)}`;
    const params: any[] = [];
    const conditions: string[] = [];

    // Validate filter operators to prevent injection via operator field
    const VALID_OPERATORS = new Set(['eq', 'contains', 'gte', 'lte']);

    if (filters && Array.isArray(filters)) {
      for (const f of filters) {
        if (!allowedCols.includes(f.column)) continue;
        if (!VALID_OPERATORS.has(f.operator)) continue;
        const col = quoteIdent(f.column);
        if (f.operator === 'eq') { conditions.push(`${col} = ?`); params.push(f.value); }
        else if (f.operator === 'contains') { conditions.push(`${col} LIKE ? ESCAPE '\\'`); params.push(`%${escapeLike(String(f.value))}%`); }
        else if (f.operator === 'gte') { conditions.push(`${col} >= ?`); params.push(f.value); }
        else if (f.operator === 'lte') { conditions.push(`${col} <= ?`); params.push(f.value); }
      }
    }

    if (conditions.length > 0) sql += ` WHERE ${conditions.join(' AND ')}`;
    if (groupBy && allowedCols.includes(groupBy)) sql += ` GROUP BY ${quoteIdent(groupBy)}`;
    if (sortBy && allowedCols.includes(sortBy)) sql += ` ORDER BY ${quoteIdent(sortBy)} ${sortDir === 'asc' ? 'ASC' : 'DESC'}`;
    const parsedLimit = parseInt(queryLimit, 10);
    const safeLimit = Math.min(isNaN(parsedLimit) ? 500 : parsedLimit, 2000);
    sql += ` LIMIT ?`;
    params.push(safeLimit);

    const rows = db.prepare(sql).all(...params);
    auditLog(req, 'CREATE' as any, 'report' as any, 0, `Ran custom report on ${source} (${rows.length} rows)`);
    res.json({ data: rows, columns: selectedCols, count: rows.length, sql: sql.replace(/\?/g, '…') });
  } catch (error: any) {
    console.error('Custom report error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /crime-analysis ─────────────────────────────────
// Crime analysis / ILP dashboard data
router.get('/crime-analysis', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { days = '90' } = req.query;
    const daysNum = Math.max(1, Math.min(365, parseInt(days as string, 10) || 90));
    const offset = `-${daysNum} days`;

    // Top offenses by incident type
    const topOffenses = db.prepare(`
      SELECT incident_type, COUNT(*) as count FROM incidents
      WHERE created_at >= DATE('now', 'localtime', ?) AND status != 'draft'
      GROUP BY incident_type ORDER BY count DESC LIMIT 10
    `).all(offset);

    // Monthly trend (last 12 months)
    const trendData = db.prepare(`
      SELECT strftime('%Y-%m', created_at) as month, COUNT(*) as count
      FROM incidents WHERE created_at >= DATE('now', 'localtime', '-12 months') AND status != 'draft'
      GROUP BY month ORDER BY month
    `).all();

    // Time of day distribution
    const timeOfDay = db.prepare(`
      SELECT CAST(strftime('%H', created_at) AS INTEGER) as hour, COUNT(*) as count
      FROM calls_for_service WHERE created_at >= DATE('now', 'localtime', ?)
      GROUP BY hour ORDER BY hour
    `).all(offset);

    // Day of week distribution
    const dayOfWeek = db.prepare(`
      SELECT CAST(strftime('%w', created_at) AS INTEGER) as day, COUNT(*) as count
      FROM calls_for_service WHERE created_at >= DATE('now', 'localtime', ?)
      GROUP BY day ORDER BY day
    `).all(offset);

    // Hotspot locations (top 15 by call count)
    const hotspots = db.prepare(`
      SELECT location_address, COUNT(*) as count,
        GROUP_CONCAT(DISTINCT incident_type) as types
      FROM calls_for_service
      WHERE created_at >= DATE('now', 'localtime', ?) AND location_address IS NOT NULL
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
      WHERE i.created_at >= DATE('now', 'localtime', ?)
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
      WHERE created_at >= DATE('now', 'localtime', ?) AND onscene_at IS NOT NULL
      GROUP BY priority
    `).all(offset);

    // Clearance rate
    const clearanceRate = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as cleared
      FROM incidents WHERE created_at >= DATE('now', 'localtime', ?)
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
    console.error('Crime analysis error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
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
    const hours = Math.max(1, Math.min(72, parseInt(req.query.hours as string, 10) || 8));
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
      params.push(parseInt(unitId, 10));
    }
    if (officerId) {
      whereExtra += ' AND b.officer_id = ?';
      params.push(parseInt(officerId, 10));
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
      const unitId = parseInt(uid, 10);
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
          if (isNaN(prevTime) || isNaN(curTime)) continue; // skip points with invalid timestamps
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
          if (!isNaN(dispatchTime) && !isNaN(firstBcTime)) {
            timeToFirstBreadcrumb = Math.round((firstBcTime - dispatchTime) / 1000);
          }
        }

        // Time from dispatch to onscene
        let timeToOnscene: number | null = null;
        if (call.dispatched_at && call.onscene_at) {
          const dispatchTime = new Date(call.dispatched_at).getTime();
          const onsceneTime = new Date(call.onscene_at).getTime();
          if (!isNaN(dispatchTime) && !isNaN(onsceneTime)) {
            timeToOnscene = Math.round((onsceneTime - dispatchTime) / 1000);
          }
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
        if (!isNaN(first) && !isNaN(last)) {
          durationMinutes = Math.round((last - first) / 60000);
        }
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
    console.error('Patrol tracking report error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
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
    console.error('List daily reports error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
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
      res.status(404).json({ error: 'Report not found' });
      return;
    }
    res.setHeader('Content-Type', 'application/pdf');
    const safeName = filename.replace(/[\r\n\0"]/g, '_');
    res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
    res.sendFile(filepath);
  } catch (error: any) {
    console.error('Download daily report error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
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
    auditLog(req, 'CREATE' as any, 'report' as any, 0, `Generated daily report: ${filename}`);
    res.json({ ok: true, filename });
  } catch (error: any) {
    console.error('Generate daily report error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

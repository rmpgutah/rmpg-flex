import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { sendCsv } from '../utils/csvExport';
import { localNow } from '../utils/timeUtils';

const router = Router();

router.use(authenticateToken);
router.use(requireRole('admin', 'manager'));

// GET /api/audit/logs - List audit log entries with filtering
router.get('/logs', (req: Request, res: Response) => {
  try {
    const {
      action,
      entityType,
      userId,
      startDate,
      endDate,
      search,
      page = '1',
      limit = '100'
    } = req.query;

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(500, Math.max(1, parseInt(limit as string, 10) || 100));
    const offset = (pageNum - 1) * limitNum;

    const db = getDb();

    // Build WHERE clause dynamically
    const conditions: string[] = [];
    const params: any[] = [];

    if (action) {
      conditions.push('al.action = ?');
      params.push(action);
    }

    if (entityType) {
      conditions.push('al.entity_type = ?');
      params.push(entityType);
    }

    if (userId) {
      conditions.push('al.user_id = ?');
      params.push(userId);
    }

    if (startDate) {
      conditions.push('al.created_at >= ?');
      params.push(startDate);
    }

    if (endDate) {
      conditions.push('al.created_at <= ?');
      params.push(endDate);
    }

    if (search) {
      conditions.push('al.details LIKE ?');
      params.push(`%${search}%`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Get total count
    const countRow = db.prepare(`
      SELECT COUNT(*) as total
      FROM activity_log al
      ${whereClause}
    `).get(...params) as any;
    const total = countRow?.total || 0;
    const totalPages = Math.ceil(total / limitNum);

    // Get paginated data with user information
    const data = db.prepare(`
      SELECT
        al.id,
        al.user_id,
        al.action,
        al.entity_type,
        al.entity_id,
        al.details,
        al.ip_address,
        al.created_at,
        u.full_name as user_name,
        u.badge_number,
        u.role as user_role
      FROM activity_log al
      LEFT JOIN users u ON al.user_id = u.id
      ${whereClause}
      ORDER BY al.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limitNum, offset);

    res.json({
      data,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages
      }
    });
  } catch (error) {
<<<<<<< HEAD
    console.error('Error fetching audit logs:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to fetch audit logs' });
=======
    console.error('Error fetching audit logs:', error);
    res.status(500).json({ error: 'Failed to fetch audit logs', code: 'FAILED_TO_FETCH_AUDIT' });
>>>>>>> origin/main
  }
});

// GET /api/audit/stats - Audit statistics
router.get('/stats', (req: Request, res: Response) => {
  try {
    const db = getDb();

    // Total entries
    const totalRow = db.prepare('SELECT COUNT(*) as total FROM activity_log').get() as any;
    const totalEntries = totalRow?.total || 0;

    // Entries today
    const todayRow = db.prepare(`
      SELECT COUNT(*) as total
      FROM activity_log
      WHERE date(created_at) = date('now')
    `).get() as any;
    const entriesToday = todayRow?.total || 0;

    // Top actions (last 30 days)
    const topActions = db.prepare(`
      SELECT action, COUNT(*) as count
      FROM activity_log
      WHERE created_at >= ?
      GROUP BY action
      ORDER BY count DESC
      LIMIT 10
    `).all(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

    // Top users (last 30 days)
    const topUsers = db.prepare(`
      SELECT
        u.full_name as user_name,
        u.badge_number,
        COUNT(*) as count
      FROM activity_log al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE al.created_at >= ?
        AND u.full_name IS NOT NULL
      GROUP BY u.full_name, u.badge_number
      ORDER BY count DESC
      LIMIT 10
    `).all(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

    res.set('Cache-Control', 'private, max-age=60');
    res.json({
      totalEntries,
      entriesToday,
      topActions,
      topUsers
    });
  } catch (error) {
<<<<<<< HEAD
    console.error('Error fetching audit stats:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to fetch audit statistics' });
=======
    console.error('Error fetching audit stats:', error);
    res.status(500).json({ error: 'Failed to fetch audit statistics', code: 'FAILED_TO_FETCH_AUDIT' });
>>>>>>> origin/main
  }
});

// GET /api/audit/export - Export audit log as CSV
router.get('/export', (req: Request, res: Response) => {
  try {
    const {
      action,
      entityType,
      userId,
      startDate,
      endDate,
      search,
    } = req.query;

    const db = getDb();

    const conditions: string[] = [];
    const params: any[] = [];

    if (action) {
      conditions.push('al.action = ?');
      params.push(action);
    }
    if (entityType) {
      conditions.push('al.entity_type = ?');
      params.push(entityType);
    }
    if (userId) {
      conditions.push('al.user_id = ?');
      params.push(userId);
    }
    if (startDate) {
      conditions.push('al.created_at >= ?');
      params.push(startDate);
    }
    if (endDate) {
      conditions.push('al.created_at <= ?');
      params.push(endDate);
    }
    if (search) {
      conditions.push('al.details LIKE ?');
      params.push(`%${search}%`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const rows = db.prepare(`
      SELECT al.action, al.entity_type, al.entity_id, al.details,
        u.full_name as user_name, al.ip_address, al.created_at
      FROM activity_log al
      LEFT JOIN users u ON al.user_id = u.id
      ${whereClause}
      ORDER BY al.created_at DESC
    
      LIMIT 1000
    `).all(...params);

    sendCsv(res, 'audit_log_export.csv', [
      { key: 'action', header: 'Action' },
      { key: 'entity_type', header: 'Entity Type' },
      { key: 'entity_id', header: 'Entity ID' },
      { key: 'details', header: 'Details' },
      { key: 'user_name', header: 'User Name' },
      { key: 'ip_address', header: 'IP Address' },
      { key: 'created_at', header: 'Created At' },
    ], rows);
  } catch (error: any) {
<<<<<<< HEAD
    console.error('Export audit log error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
=======
    console.error('Export audit log error:', error);
    res.status(500).json({ error: 'Failed to export audit log', code: 'EXPORT_AUDIT_LOG_ERROR' });
  }
});

// ══════════════════════════════════════════════════════════════════
// AUDIT UPGRADES
// ══════════════════════════════════════════════════════════════════

// ── Upgrade 31: Audit log retention policy enforcement ──────────
// God Mode: admin-only — destructive retention enforcement
router.post('/retention/enforce', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { retention_days = 365 } = req.body;
    const days = Math.max(30, Math.min(3650, parseInt(retention_days, 10) || 365));

    const countBefore = (db.prepare('SELECT COUNT(*) as count FROM activity_log').get() as any)?.count || 0;

    const result = db.prepare(`
      DELETE FROM activity_log
      WHERE created_at < datetime('now', '-' || ? || ' days')
    `).run(days);

    const countAfter = (db.prepare('SELECT COUNT(*) as count FROM activity_log').get() as any)?.count || 0;

    // Log the retention enforcement itself
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'audit_retention_enforced', 'audit', 0, ?, ?)
    `).run(req.user!.userId, `Enforced ${days}-day retention: removed ${result.changes} entries`, req.ip || 'unknown');

    res.json({
      retention_days: days,
      deleted: result.changes,
      remaining: countAfter,
      before: countBefore,
    });
  } catch (error: any) {
    console.error('Retention enforce error:', error);
    res.status(500).json({ error: 'Failed to enforce retention', code: 'RETENTION_ENFORCE_ERROR' });
  }
});

// ── Upgrade 32: Get/set retention policy ────────────────────────
router.get('/retention/policy', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const row = db.prepare(
      "SELECT config_value FROM system_config WHERE config_key = 'audit_retention_days' AND category = 'system_settings'"
    ).get() as any;

    const policy = {
      retention_days: parseInt(row?.config_value) || 365,
      auto_enforce: false,
    };

    const autoRow = db.prepare(
      "SELECT config_value FROM system_config WHERE config_key = 'audit_auto_enforce' AND category = 'system_settings'"
    ).get() as any;
    policy.auto_enforce = autoRow?.config_value === 'true';

    // Size estimate
    const totalEntries = (db.prepare('SELECT COUNT(*) as count FROM activity_log').get() as any)?.count || 0;
    const oldestEntry = db.prepare('SELECT MIN(created_at) as oldest FROM activity_log').get() as any;

    res.json({ ...policy, totalEntries, oldestEntry: oldestEntry?.oldest });
  } catch (error: any) {
    console.error('Get retention policy error:', error);
    res.status(500).json({ error: 'Failed to get retention policy', code: 'GET_RETENTION_POLICY_ERROR' });
  }
});

// God Mode: admin-only — retention policy changes
router.put('/retention/policy', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { retention_days, auto_enforce } = req.body;
    const now = localNow();

    if (retention_days !== undefined) {
      db.prepare("DELETE FROM system_config WHERE config_key = 'audit_retention_days' AND category = 'system_settings'").run();
      db.prepare(`INSERT INTO system_config (config_key, config_value, category, sort_order, created_at, updated_at)
        VALUES ('audit_retention_days', ?, 'system_settings', 0, ?, ?)`).run(String(retention_days), now, now);
    }

    if (auto_enforce !== undefined) {
      db.prepare("DELETE FROM system_config WHERE config_key = 'audit_auto_enforce' AND category = 'system_settings'").run();
      db.prepare(`INSERT INTO system_config (config_key, config_value, category, sort_order, created_at, updated_at)
        VALUES ('audit_auto_enforce', ?, 'system_settings', 0, ?, ?)`).run(auto_enforce ? 'true' : 'false', now, now);
    }

    res.json({ retention_days, auto_enforce, message: 'Policy updated' });
  } catch (error: any) {
    console.error('Update retention policy error:', error);
    res.status(500).json({ error: 'Failed to update retention policy', code: 'UPDATE_RETENTION_POLICY_ERROR' });
  }
});

// ── Upgrade 33: Search by action type (available action types) ──
router.get('/action-types', (req: Request, res: Response) => {
  try {
    const db = getDb();

    const actionTypes = db.prepare(`
      SELECT action, COUNT(*) as count,
        MAX(created_at) as last_seen
      FROM activity_log
      GROUP BY action
      ORDER BY count DESC
    `).all();

    const entityTypes = db.prepare(`
      SELECT entity_type, COUNT(*) as count
      FROM activity_log
      WHERE entity_type IS NOT NULL
      GROUP BY entity_type
      ORDER BY count DESC
    `).all();

    res.json({ actionTypes, entityTypes });
  } catch (error: any) {
    console.error('Action types error:', error);
    res.status(500).json({ error: 'Failed to get action types', code: 'ACTION_TYPES_ERROR' });
  }
});

// ── Upgrade 34: Audit summary statistics (enhanced) ─────────────
router.get('/summary', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { days = '30' } = req.query;
    const daysNum = Math.max(1, Math.min(365, parseInt(days as string, 10) || 30));

    // Daily activity trend
    const dailyTrend = db.prepare(`
      SELECT DATE(created_at) as date, COUNT(*) as count
      FROM activity_log
      WHERE created_at >= datetime('now', '-' || ? || ' days')
      GROUP BY date ORDER BY date
    `).all(daysNum);

    // By hour of day
    const byHour = db.prepare(`
      SELECT CAST(strftime('%H', created_at) AS INTEGER) as hour, COUNT(*) as count
      FROM activity_log
      WHERE created_at >= datetime('now', '-' || ? || ' days')
      GROUP BY hour ORDER BY hour
    `).all(daysNum);

    // Most active users
    const topUsers = db.prepare(`
      SELECT u.full_name, u.badge_number, u.role, COUNT(*) as action_count
      FROM activity_log al
      JOIN users u ON al.user_id = u.id
      WHERE al.created_at >= datetime('now', '-' || ? || ' days')
      GROUP BY al.user_id
      ORDER BY action_count DESC LIMIT 10
    `).all(daysNum);

    // Top actions
    const topActions = db.prepare(`
      SELECT action, COUNT(*) as count
      FROM activity_log
      WHERE created_at >= datetime('now', '-' || ? || ' days')
      GROUP BY action ORDER BY count DESC LIMIT 15
    `).all(daysNum);

    // Security-relevant actions
    const securityActions = db.prepare(`
      SELECT action, COUNT(*) as count
      FROM activity_log
      WHERE created_at >= datetime('now', '-' || ? || ' days')
        AND (action LIKE '%login%' OR action LIKE '%password%' OR action LIKE '%totp%'
          OR action LIKE '%session%' OR action LIKE '%role%' OR action LIKE '%permission%')
      GROUP BY action ORDER BY count DESC
    `).all(daysNum);

    // Total entries in period
    const totalInPeriod = db.prepare(`
      SELECT COUNT(*) as count FROM activity_log
      WHERE created_at >= datetime('now', '-' || ? || ' days')
    `).get(daysNum) as any;

    // Total entries overall
    const totalOverall = db.prepare('SELECT COUNT(*) as count FROM activity_log').get() as any;

    res.json({
      period_days: daysNum,
      totalInPeriod: totalInPeriod?.count || 0,
      totalOverall: totalOverall?.count || 0,
      dailyTrend,
      byHour,
      topUsers,
      topActions,
      securityActions,
    });
  } catch (error: any) {
    console.error('Audit summary error:', error);
    res.status(500).json({ error: 'Failed to get audit summary', code: 'AUDIT_SUMMARY_ERROR' });
  }
});

// ── Upgrade 35: Audit log for specific entity ───────────────────
router.get('/entity/:entityType/:entityId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { entityType, entityId } = req.params;
    const { limit = '50' } = req.query;
    const limitNum = Math.min(200, parseInt(limit as string, 10) || 50);

    const logs = db.prepare(`
      SELECT al.*, u.full_name as user_name, u.badge_number
      FROM activity_log al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE al.entity_type = ? AND al.entity_id = ?
      ORDER BY al.created_at DESC
      LIMIT ?
    `).all(entityType, entityId, limitNum);

    res.json({ data: logs, entity_type: entityType, entity_id: entityId });
  } catch (error: any) {
    console.error('Entity audit error:', error);
    res.status(500).json({ error: 'Failed to get entity audit log', code: 'ENTITY_AUDIT_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 1: Audit Log Compression
// Archives old audit entries by summarizing them into daily
// aggregate records and optionally purging detail.
// ════════════════════════════════════════════════════════════
router.post('/compress', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { older_than_days } = req.body;
    const days = Math.max(30, parseInt(String(older_than_days || '90'), 10));
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    // Count entries that would be compressed
    const count = db.prepare(
      'SELECT COUNT(*) as count FROM activity_log WHERE created_at < ?'
    ).get(cutoff) as { count: number };

    if (count.count === 0) {
      res.json({ message: 'No entries older than the cutoff', compressed: 0 });
      return;
    }

    // Create daily summaries (don't actually delete — just create summaries)
    const summaries = db.prepare(`
      SELECT DATE(created_at) as log_date, action,
        COUNT(*) as count, COUNT(DISTINCT user_id) as unique_users
      FROM activity_log
      WHERE created_at < ?
      GROUP BY DATE(created_at), action
      ORDER BY log_date
    `).all(cutoff) as any[];

    // Store summaries in a compressed_audit table
    try {
      db.prepare(`CREATE TABLE IF NOT EXISTS audit_daily_summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        log_date TEXT NOT NULL, action TEXT NOT NULL,
        entry_count INTEGER DEFAULT 0, unique_users INTEGER DEFAULT 0,
        created_at TEXT
      )`);
    } catch { /* already exists */ }

    const insertSummary = db.prepare(`
      INSERT OR REPLACE INTO audit_daily_summaries (log_date, action, entry_count, unique_users, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    const now = localNow();
    const tx = db.transaction(() => {
      for (const s of summaries) {
        insertSummary.run(s.log_date, s.action, s.count, s.unique_users, now);
      }
    });
    tx();

    res.json({
      message: `Created ${summaries.length} daily summaries for ${count.count} audit entries older than ${days} days`,
      summaries_created: summaries.length,
      entries_covered: count.count,
      cutoff_date: cutoff.split('T')[0],
    });
  } catch (error: any) {
    console.error('Audit compress error:', error);
    res.status(500).json({ error: 'Failed to compress audit log', code: 'AUDIT_COMPRESS_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 2: Audit Search Index Stats
// Returns information about the audit log search performance
// and index coverage.
// ════════════════════════════════════════════════════════════
router.get('/index-stats', requireRole('admin'), (_req: Request, res: Response) => {
  try {
    const db = getDb();

    const totalEntries = db.prepare(
      'SELECT COUNT(*) as count FROM activity_log'
    ).get() as { count: number };

    const oldestEntry = db.prepare(
      'SELECT MIN(created_at) as oldest FROM activity_log'
    ).get() as { oldest: string | null };

    const newestEntry = db.prepare(
      'SELECT MAX(created_at) as newest FROM activity_log'
    ).get() as { newest: string | null };

    // Check for common index patterns
    const uniqueActions = db.prepare(
      'SELECT COUNT(DISTINCT action) as count FROM activity_log'
    ).get() as { count: number };

    const uniqueEntityTypes = db.prepare(
      'SELECT COUNT(DISTINCT entity_type) as count FROM activity_log'
    ).get() as { count: number };

    const uniqueUsers = db.prepare(
      'SELECT COUNT(DISTINCT user_id) as count FROM activity_log'
    ).get() as { count: number };

    // Size estimate
    const avgEntrySize = db.prepare(`
      SELECT AVG(LENGTH(COALESCE(action, '')) + LENGTH(COALESCE(details, '')) + LENGTH(COALESCE(ip_address, ''))) as avg_bytes
      FROM activity_log LIMIT 1000
    `).get() as any;

    res.json({
      total_entries: totalEntries.count,
      oldest_entry: oldestEntry.oldest,
      newest_entry: newestEntry.newest,
      unique_actions: uniqueActions.count,
      unique_entity_types: uniqueEntityTypes.count,
      unique_users: uniqueUsers.count,
      estimated_size_mb: Math.round((totalEntries.count * (avgEntrySize?.avg_bytes || 100)) / 1024 / 1024 * 100) / 100,
    });
  } catch (error: any) {
    console.error('Audit index stats error:', error);
    res.status(500).json({ error: 'Failed to get index stats', code: 'AUDIT_INDEX_STATS_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 3: Compliance Report Generation
// Generates a structured compliance report for a date range.
// ════════════════════════════════════════════════════════════
router.get('/compliance-report', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const days = Math.min(90, Math.max(1, parseInt(String(req.query.days || '30'), 10)));
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    // Security events
    const securityEvents = db.prepare(`
      SELECT action, COUNT(*) as count FROM activity_log
      WHERE created_at >= ? AND action IN (
        'user_login', 'user_logout', 'password_changed', 'totp_enabled',
        'totp_disabled', 'user_created', 'user_deactivated', 'user_role_changed',
        'admin_terminate_sessions', 'enforce_password_expiry'
      )
      GROUP BY action ORDER BY count DESC
    `).all(cutoff) as any[];

    // Data access events
    const dataAccess = db.prepare(`
      SELECT entity_type, COUNT(*) as count FROM activity_log
      WHERE created_at >= ? AND action IN ('read', 'view', 'search', 'export')
      GROUP BY entity_type ORDER BY count DESC LIMIT 20
    `).all(cutoff) as any[];

    // Data modification events
    const dataModifications = db.prepare(`
      SELECT entity_type, action, COUNT(*) as count FROM activity_log
      WHERE created_at >= ? AND action IN ('create', 'update', 'delete', 'archive')
      GROUP BY entity_type, action ORDER BY count DESC LIMIT 30
    `).all(cutoff) as any[];

    // Failed login attempts
    const failedLogins = db.prepare(`
      SELECT COUNT(*) as count FROM login_attempts
      WHERE success = 0 AND created_at >= ?
    `).get(cutoff) as { count: number };

    // Successful logins
    const successfulLogins = db.prepare(`
      SELECT COUNT(*) as count FROM login_attempts
      WHERE success = 1 AND created_at >= ?
    `).get(cutoff) as { count: number };

    // Users who were active
    const activeUsers = db.prepare(`
      SELECT COUNT(DISTINCT user_id) as count FROM activity_log
      WHERE created_at >= ?
    `).get(cutoff) as { count: number };

    res.json({
      report_period_days: days,
      generated_at: localNow(),
      security_events: securityEvents,
      data_access: dataAccess,
      data_modifications: dataModifications,
      login_stats: {
        successful: successfulLogins.count,
        failed: failedLogins.count,
        failure_rate: (successfulLogins.count + failedLogins.count) > 0
          ? Math.round(failedLogins.count / (successfulLogins.count + failedLogins.count) * 100) : 0,
      },
      active_users: activeUsers.count,
    });
  } catch (error: any) {
    console.error('Compliance report error:', error);
    res.status(500).json({ error: 'Failed to generate compliance report', code: 'COMPLIANCE_REPORT_ERROR' });
>>>>>>> origin/main
  }
});

export default router;

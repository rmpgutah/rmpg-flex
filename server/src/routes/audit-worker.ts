// ============================================================
// RMPG Flex — Audit routes (Cloudflare Workers / Hono)
// ============================================================
// Ported from server/src/routes/audit.ts. Every endpoint
// requires admin or manager role. Read endpoints power the
// audit log viewer; write endpoints (retention, compress)
// require admin and are destructive.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { D1Db, paramStr, paramNum } from '../worker-middleware/d1Helpers';
import { localNow } from '../worker-middleware/timeUtils';

// Minimal CSV serializer — every cell is wrapped in double quotes with internal
// quotes doubled (RFC 4180). The audit details column can contain commas,
// newlines, and quotes from operator notes; raw join(',') would corrupt rows.
function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '""';
  const s = typeof v === 'string' ? v : String(v);
  return `"${s.replace(/"/g, '""')}"`;
}
function rowsToCsv(headers: { key: string; header: string }[], rows: any[]): string {
  const head = headers.map(h => csvEscape(h.header)).join(',');
  const body = rows.map(r => headers.map(h => csvEscape(r[h.key])).join(',')).join('\n');
  return `${head}\n${body}\n`;
}

export function mountAuditRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);
  api.use('/*', requireRole('admin', 'manager'));

  // GET /api/audit/logs — paginated audit list with filters
  api.get('/logs', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const action = c.req.query('action');
      const entityType = c.req.query('entityType');
      const userId = c.req.query('userId');
      const startDate = c.req.query('startDate');
      const endDate = c.req.query('endDate');
      const search = c.req.query('search');
      const pageNum = Math.max(1, parseInt(c.req.query('page') || '1', 10) || 1);
      const limitNum = Math.min(100000, Math.max(1, parseInt(c.req.query('limit') || '100000', 10) || 100000));
      const offset = (pageNum - 1) * limitNum;

      const conditions: string[] = [];
      const params: any[] = [];
      if (action) { conditions.push('al.action = ?'); params.push(action); }
      if (entityType) { conditions.push('al.entity_type = ?'); params.push(entityType); }
      if (userId) { conditions.push('al.user_id = ?'); params.push(userId); }
      if (startDate) { conditions.push('al.created_at >= ?'); params.push(startDate); }
      if (endDate) { conditions.push('al.created_at <= ?'); params.push(endDate); }
      if (search) { conditions.push('al.details LIKE ?'); params.push(`%${search}%`); }
      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const countRow = await db.prepare(`SELECT COUNT(*) as total FROM activity_log al ${whereClause}`).get(...params) as any;
      const total = countRow?.total || 0;
      const totalPages = limitNum > 0 ? Math.ceil(total / limitNum) : 0;

      const data = await db.prepare(`
        SELECT al.id, al.user_id, al.action, al.entity_type, al.entity_id,
          al.details, al.ip_address, al.created_at,
          u.full_name as user_name, u.badge_number, u.role as user_role
        FROM activity_log al
        LEFT JOIN users u ON al.user_id = u.id
        ${whereClause}
        ORDER BY al.created_at DESC
        LIMIT ? OFFSET ?
      `).all(...params, limitNum, offset);

      return c.json({ data, pagination: { page: pageNum, limit: limitNum, total, totalPages } });
    } catch (err: any) {
      return c.json({ error: 'Failed to fetch audit logs', code: 'FAILED_TO_FETCH_AUDIT', detail: err?.message }, 500);
    }
  });

  // GET /api/audit/stats — totals + top actions/users (30-day window)
  api.get('/stats', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const totalRow = await db.prepare('SELECT COUNT(*) as total FROM activity_log').get() as any;
      const todayRow = await db.prepare(`SELECT COUNT(*) as total FROM activity_log WHERE date(created_at) = date('now')`).get() as any;
      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const topActions = await db.prepare(`
        SELECT action, COUNT(*) as count FROM activity_log
        WHERE created_at >= ? GROUP BY action ORDER BY count DESC LIMIT 10
      `).all(cutoff);
      const topUsers = await db.prepare(`
        SELECT u.full_name as user_name, u.badge_number, COUNT(*) as count
        FROM activity_log al LEFT JOIN users u ON al.user_id = u.id
        WHERE al.created_at >= ? AND u.full_name IS NOT NULL
        GROUP BY u.full_name, u.badge_number ORDER BY count DESC LIMIT 10
      `).all(cutoff);

      c.header('Cache-Control', 'private, max-age=60');
      return c.json({
        totalEntries: totalRow?.total || 0,
        entriesToday: todayRow?.total || 0,
        topActions,
        topUsers,
      });
    } catch (err: any) {
      return c.json({ error: 'Failed to fetch audit statistics', code: 'FAILED_TO_FETCH_AUDIT', detail: err?.message }, 500);
    }
  });

  // GET /api/audit/export — CSV download with same filters as /logs (capped at 1000)
  api.get('/export', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const conditions: string[] = [];
      const params: any[] = [];
      const action = c.req.query('action');
      const entityType = c.req.query('entityType');
      const userId = c.req.query('userId');
      const startDate = c.req.query('startDate');
      const endDate = c.req.query('endDate');
      const search = c.req.query('search');
      if (action) { conditions.push('al.action = ?'); params.push(action); }
      if (entityType) { conditions.push('al.entity_type = ?'); params.push(entityType); }
      if (userId) { conditions.push('al.user_id = ?'); params.push(userId); }
      if (startDate) { conditions.push('al.created_at >= ?'); params.push(startDate); }
      if (endDate) { conditions.push('al.created_at <= ?'); params.push(endDate); }
      if (search) { conditions.push('al.details LIKE ?'); params.push(`%${search}%`); }
      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const rows = await db.prepare(`
        SELECT al.action, al.entity_type, al.entity_id, al.details,
          u.full_name as user_name, al.ip_address, al.created_at
        FROM activity_log al
        LEFT JOIN users u ON al.user_id = u.id
        ${whereClause}
        ORDER BY al.created_at DESC
        LIMIT 1000
      `).all(...params) as any[];

      const csv = rowsToCsv([
        { key: 'action', header: 'Action' },
        { key: 'entity_type', header: 'Entity Type' },
        { key: 'entity_id', header: 'Entity ID' },
        { key: 'details', header: 'Details' },
        { key: 'user_name', header: 'User Name' },
        { key: 'ip_address', header: 'IP Address' },
        { key: 'created_at', header: 'Created At' },
      ], rows);

      return c.body(csv, 200, {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="audit_log_export.csv"',
      });
    } catch (err: any) {
      return c.json({ error: 'Failed to export audit log', code: 'EXPORT_AUDIT_LOG_ERROR', detail: err?.message }, 500);
    }
  });

  // POST /api/audit/retention/enforce — DESTRUCTIVE; deletes entries older
  // than retention_days (default 365, clamped to [30, 3650]). Admin only.
  api.post('/retention/enforce', requireRole('admin'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const body = await c.req.json<any>().catch(() => ({}));
      const days = Math.max(30, Math.min(3650, parseInt(String(body?.retention_days ?? '365'), 10) || 365));

      const beforeRow = await db.prepare('SELECT COUNT(*) as count FROM activity_log').get() as any;
      const countBefore = beforeRow?.count || 0;

      const result = await db.prepare(
        `DELETE FROM activity_log WHERE created_at < datetime('now', '-' || ? || ' days')`
      ).run(days);

      const afterRow = await db.prepare('SELECT COUNT(*) as count FROM activity_log').get() as any;
      const countAfter = afterRow?.count || 0;

      // Log the enforcement itself so it stays auditable even after the purge
      const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown';
      await db.prepare(
        `INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
         VALUES (?, 'audit_retention_enforced', 'audit', 0, ?, ?)`
      ).run(user?.userId ?? 0, `Enforced ${days}-day retention: removed ${result.meta.changes} entries`, ip);

      return c.json({
        retention_days: days,
        deleted: result.meta.changes,
        remaining: countAfter,
        before: countBefore,
      });
    } catch (err: any) {
      return c.json({ error: 'Failed to enforce retention', code: 'RETENTION_ENFORCE_ERROR', detail: err?.message }, 500);
    }
  });

  // GET /api/audit/retention/policy — current policy + totals
  api.get('/retention/policy', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const row = await db.prepare(
        `SELECT config_value FROM system_config WHERE config_key = 'audit_retention_days' AND category = 'system_settings'`
      ).get() as any;
      const autoRow = await db.prepare(
        `SELECT config_value FROM system_config WHERE config_key = 'audit_auto_enforce' AND category = 'system_settings'`
      ).get() as any;
      const totalEntries = (await db.prepare('SELECT COUNT(*) as count FROM activity_log').get() as any)?.count || 0;
      const oldestEntry = await db.prepare('SELECT MIN(created_at) as oldest FROM activity_log').get() as any;

      return c.json({
        retention_days: parseInt(row?.config_value) || 365,
        auto_enforce: autoRow?.config_value === 'true',
        totalEntries,
        oldestEntry: oldestEntry?.oldest,
      });
    } catch (err: any) {
      return c.json({ error: 'Failed to get retention policy', code: 'GET_RETENTION_POLICY_ERROR', detail: err?.message }, 500);
    }
  });

  // PUT /api/audit/retention/policy — admin only
  api.put('/retention/policy', requireRole('admin'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const body = await c.req.json<any>();
      const { retention_days, auto_enforce } = body || {};
      const now = localNow();

      if (retention_days !== undefined) {
        await db.prepare(`DELETE FROM system_config WHERE config_key = 'audit_retention_days' AND category = 'system_settings'`).run();
        await db.prepare(
          `INSERT INTO system_config (config_key, config_value, category, sort_order, created_at, updated_at)
           VALUES ('audit_retention_days', ?, 'system_settings', 0, ?, ?)`
        ).run(String(retention_days), now, now);
      }
      if (auto_enforce !== undefined) {
        await db.prepare(`DELETE FROM system_config WHERE config_key = 'audit_auto_enforce' AND category = 'system_settings'`).run();
        await db.prepare(
          `INSERT INTO system_config (config_key, config_value, category, sort_order, created_at, updated_at)
           VALUES ('audit_auto_enforce', ?, 'system_settings', 0, ?, ?)`
        ).run(auto_enforce ? 'true' : 'false', now, now);
      }

      return c.json({ retention_days, auto_enforce, message: 'Policy updated' });
    } catch (err: any) {
      return c.json({ error: 'Failed to update retention policy', code: 'UPDATE_RETENTION_POLICY_ERROR', detail: err?.message }, 500);
    }
  });

  // GET /api/audit/action-types — distinct action + entity types for filter dropdowns
  api.get('/action-types', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const actionTypes = await db.prepare(`
        SELECT action, COUNT(*) as count, MAX(created_at) as last_seen
        FROM activity_log GROUP BY action ORDER BY count DESC
      `).all();
      const entityTypes = await db.prepare(`
        SELECT entity_type, COUNT(*) as count FROM activity_log
        WHERE entity_type IS NOT NULL GROUP BY entity_type ORDER BY count DESC
      `).all();
      return c.json({ actionTypes, entityTypes });
    } catch (err: any) {
      return c.json({ error: 'Failed to get action types', code: 'ACTION_TYPES_ERROR', detail: err?.message }, 500);
    }
  });

  // GET /api/audit/summary?days=30 — daily/hourly trends + top users/actions
  api.get('/summary', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const daysNum = Math.max(1, Math.min(365, parseInt(c.req.query('days') || '30', 10) || 30));

      const dailyTrend = await db.prepare(`
        SELECT DATE(created_at) as date, COUNT(*) as count FROM activity_log
        WHERE created_at >= datetime('now', '-' || ? || ' days')
        GROUP BY date ORDER BY date
      `).all(daysNum);
      const byHour = await db.prepare(`
        SELECT CAST(strftime('%H', created_at) AS INTEGER) as hour, COUNT(*) as count
        FROM activity_log WHERE created_at >= datetime('now', '-' || ? || ' days')
        GROUP BY hour ORDER BY hour
      `).all(daysNum);
      const topUsers = await db.prepare(`
        SELECT u.full_name, u.badge_number, u.role, COUNT(*) as action_count
        FROM activity_log al JOIN users u ON al.user_id = u.id
        WHERE al.created_at >= datetime('now', '-' || ? || ' days')
        GROUP BY al.user_id ORDER BY action_count DESC LIMIT 10
      `).all(daysNum);
      const topActions = await db.prepare(`
        SELECT action, COUNT(*) as count FROM activity_log
        WHERE created_at >= datetime('now', '-' || ? || ' days')
        GROUP BY action ORDER BY count DESC LIMIT 15
      `).all(daysNum);
      const securityActions = await db.prepare(`
        SELECT action, COUNT(*) as count FROM activity_log
        WHERE created_at >= datetime('now', '-' || ? || ' days')
          AND (action LIKE '%login%' OR action LIKE '%password%' OR action LIKE '%totp%'
            OR action LIKE '%session%' OR action LIKE '%role%' OR action LIKE '%permission%')
        GROUP BY action ORDER BY count DESC
      `).all(daysNum);
      const totalInPeriod = await db.prepare(`
        SELECT COUNT(*) as count FROM activity_log
        WHERE created_at >= datetime('now', '-' || ? || ' days')
      `).get(daysNum) as any;
      const totalOverall = await db.prepare('SELECT COUNT(*) as count FROM activity_log').get() as any;

      return c.json({
        period_days: daysNum,
        totalInPeriod: totalInPeriod?.count || 0,
        totalOverall: totalOverall?.count || 0,
        dailyTrend, byHour, topUsers, topActions, securityActions,
      });
    } catch (err: any) {
      return c.json({ error: 'Failed to get audit summary', code: 'AUDIT_SUMMARY_ERROR', detail: err?.message }, 500);
    }
  });

  // GET /api/audit/entity/:entityType/:entityId — audit trail for one record
  api.get('/entity/:entityType/:entityId', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const entityType = paramStr(c.req.param('entityType'));
      const entityId = paramNum(c.req.param('entityId'));
      const limitNum = Math.min(100000, Math.max(1, parseInt(c.req.query('limit') || '100000', 10) || 100000));

      const logs = await db.prepare(`
        SELECT al.*, u.full_name as user_name, u.badge_number
        FROM activity_log al LEFT JOIN users u ON al.user_id = u.id
        WHERE al.entity_type = ? AND al.entity_id = ?
        ORDER BY al.created_at DESC LIMIT ?
      `).all(entityType, entityId, limitNum);
      return c.json({ data: logs, entity_type: entityType, entity_id: entityId });
    } catch (err: any) {
      return c.json({ error: 'Failed to get entity audit log', code: 'ENTITY_AUDIT_ERROR', detail: err?.message }, 500);
    }
  });

  // POST /api/audit/compress — summarize old entries into daily aggregates (non-destructive)
  api.post('/compress', requireRole('admin'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const body = await c.req.json<any>().catch(() => ({}));
      const days = Math.max(30, parseInt(String(body?.older_than_days || '90'), 10) || 90);
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

      const countRow = await db.prepare('SELECT COUNT(*) as count FROM activity_log WHERE created_at < ?').get(cutoff) as any;
      const count = countRow?.count || 0;
      if (count === 0) return c.json({ message: 'No entries older than the cutoff', compressed: 0 });

      const summaries = await db.prepare(`
        SELECT DATE(created_at) as log_date, action,
          COUNT(*) as count, COUNT(DISTINCT user_id) as unique_users
        FROM activity_log WHERE created_at < ?
        GROUP BY DATE(created_at), action ORDER BY log_date
      `).all(cutoff) as any[];

      try {
        await db.prepare(`CREATE TABLE IF NOT EXISTS audit_daily_summaries (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          log_date TEXT NOT NULL, action TEXT NOT NULL,
          entry_count INTEGER DEFAULT 0, unique_users INTEGER DEFAULT 0,
          created_at TEXT
        )`).run();
        await db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_summaries_unique ON audit_daily_summaries(log_date, action)`).run();
      } catch { /* already exists */ }

      const now = localNow();
      for (const s of summaries) {
        await db.prepare(`
          INSERT INTO audit_daily_summaries (log_date, action, entry_count, unique_users, created_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(log_date, action) DO UPDATE SET
            entry_count = excluded.entry_count,
            unique_users = excluded.unique_users,
            created_at = excluded.created_at
        `).run(s.log_date, s.action, s.count, s.unique_users, now);
      }

      return c.json({
        message: `Created ${summaries.length} daily summaries for ${count} audit entries older than ${days} days`,
        summaries_created: summaries.length,
        entries_covered: count,
        cutoff_date: cutoff.split('T')[0],
      });
    } catch (err: any) {
      return c.json({ error: 'Failed to compress audit log', code: 'AUDIT_COMPRESS_ERROR', detail: err?.message }, 500);
    }
  });

  // GET /api/audit/index-stats — admin diagnostics
  api.get('/index-stats', requireRole('admin'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const totalEntries = (await db.prepare('SELECT COUNT(*) as count FROM activity_log').get() as any)?.count || 0;
      const oldestEntry = await db.prepare('SELECT MIN(created_at) as oldest FROM activity_log').get() as any;
      const newestEntry = await db.prepare('SELECT MAX(created_at) as newest FROM activity_log').get() as any;
      const uniqueActions = (await db.prepare('SELECT COUNT(DISTINCT action) as count FROM activity_log').get() as any)?.count || 0;
      const uniqueEntityTypes = (await db.prepare('SELECT COUNT(DISTINCT entity_type) as count FROM activity_log').get() as any)?.count || 0;
      const uniqueUsers = (await db.prepare('SELECT COUNT(DISTINCT user_id) as count FROM activity_log').get() as any)?.count || 0;
      const avgEntrySize = await db.prepare(`
        SELECT AVG(LENGTH(COALESCE(action, '')) + LENGTH(COALESCE(details, '')) + LENGTH(COALESCE(ip_address, ''))) as avg_bytes
        FROM activity_log LIMIT 1000
      `).get() as any;

      return c.json({
        total_entries: totalEntries,
        oldest_entry: oldestEntry?.oldest,
        newest_entry: newestEntry?.newest,
        unique_actions: uniqueActions,
        unique_entity_types: uniqueEntityTypes,
        unique_users: uniqueUsers,
        estimated_size_mb: Math.round((totalEntries * (avgEntrySize?.avg_bytes || 100)) / 1024 / 1024 * 100) / 100,
      });
    } catch (err: any) {
      return c.json({ error: 'Failed to get index stats', code: 'AUDIT_INDEX_STATS_ERROR', detail: err?.message }, 500);
    }
  });

  // GET /api/audit/compliance-report — structured compliance report (max 90 days)
  api.get('/compliance-report', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const days = Math.min(90, Math.max(1, parseInt(c.req.query('days') || '30', 10) || 30));
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

      const securityEvents = await db.prepare(`
        SELECT action, COUNT(*) as count FROM activity_log
        WHERE created_at >= ? AND action IN (
          'user_login', 'user_logout', 'password_changed', 'totp_enabled',
          'totp_disabled', 'user_created', 'user_deactivated', 'user_role_changed',
          'admin_terminate_sessions', 'enforce_password_expiry'
        )
        GROUP BY action ORDER BY count DESC
      `).all(cutoff);
      const dataAccess = await db.prepare(`
        SELECT entity_type, COUNT(*) as count FROM activity_log
        WHERE created_at >= ? AND action IN ('read', 'view', 'search', 'export')
        GROUP BY entity_type ORDER BY count DESC LIMIT 20
      `).all(cutoff);
      const dataModifications = await db.prepare(`
        SELECT entity_type, action, COUNT(*) as count FROM activity_log
        WHERE created_at >= ? AND action IN ('create', 'update', 'delete', 'archive', 'CREATE', 'UPDATE', 'DELETE')
        GROUP BY entity_type, action ORDER BY count DESC LIMIT 30
      `).all(cutoff);

      // login_attempts table may not exist in every D1 deployment — tolerate it
      let failedLogins = 0;
      let successfulLogins = 0;
      try {
        const failed = await db.prepare(`SELECT COUNT(*) as count FROM login_attempts WHERE success = 0 AND created_at >= ?`).get(cutoff) as any;
        failedLogins = failed?.count || 0;
        const ok = await db.prepare(`SELECT COUNT(*) as count FROM login_attempts WHERE success = 1 AND created_at >= ?`).get(cutoff) as any;
        successfulLogins = ok?.count || 0;
      } catch { /* table missing — leave as 0 */ }

      const activeUsers = (await db.prepare(`
        SELECT COUNT(DISTINCT user_id) as count FROM activity_log WHERE created_at >= ?
      `).get(cutoff) as any)?.count || 0;

      return c.json({
        report_period_days: days,
        generated_at: localNow(),
        security_events: securityEvents,
        data_access: dataAccess,
        data_modifications: dataModifications,
        login_stats: {
          successful: successfulLogins,
          failed: failedLogins,
          failure_rate: (successfulLogins + failedLogins) > 0
            ? Math.round(failedLogins / (successfulLogins + failedLogins) * 100) : 0,
        },
        active_users: activeUsers,
      });
    } catch (err: any) {
      return c.json({ error: 'Failed to generate compliance report', code: 'COMPLIANCE_REPORT_ERROR', detail: err?.message }, 500);
    }
  });

  app.route('/api/audit', api);
}

// ============================================================
// RMPG Flex — Audit routes (Cloudflare Worker)
// ============================================================
// Audit log viewer + analytics + retention. Every endpoint
// requires admin OR manager role at the mount layer
// (src/index.ts gates /api/audit/* with authMiddleware + the
// inline check below); destructive endpoints (retention purge,
// retention policy edit, compress) require admin specifically.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';

const audit = new Hono<Env>();

// ── Role gate ──────────────────────────────────────────────
// Applied at the top of every endpoint via .use('*', ...).
// admin OR manager can READ the audit log + summaries.
// Destructive endpoints further restrict to admin only.
audit.use('*', async (c, next) => {
  const user = c.get('user');
  if (!user || (user.role !== 'admin' && user.role !== 'manager')) {
    return c.json({ error: 'Audit access requires admin or manager role', code: 'FORBIDDEN' }, 403);
  }
  await next();
});

function requireAdmin(c: { get: (k: 'user') => { role: string } | undefined }): boolean {
  const u = c.get('user');
  return !!u && u.role === 'admin';
}

// ── CSV serializer (RFC 4180) ──────────────────────────────
// Inline because /src/ doesn't have a CSV helper yet. Wraps
// every cell in quotes with internal quotes doubled — the
// activity_log details column can contain commas, newlines,
// and quoted incident numbers, and a naive join(',') would
// silently corrupt rows. This matters most when prosecutors
// export the audit log for discovery.
function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '""';
  const s = typeof v === 'string' ? v : String(v);
  return `"${s.replace(/"/g, '""')}"`;
}
function rowsToCsv(headers: { key: string; header: string }[], rows: Record<string, unknown>[]): string {
  const head = headers.map((h) => csvEscape(h.header)).join(',');
  const body = rows.map((r) => headers.map((h) => csvEscape(r[h.key])).join(',')).join('\n');
  return `${head}\n${body}\n`;
}

// ── GET /api/audit/logs — paginated audit list with 6-axis filter ──
audit.get('/logs', async (c) => {
  try {
    const db = getDb(c.env);
    const action = c.req.query('action');
    const entityType = c.req.query('entityType');
    const userId = c.req.query('userId');
    const startDate = c.req.query('startDate');
    const endDate = c.req.query('endDate');
    const search = c.req.query('search');
    const pageNum = Math.max(1, parseInt(c.req.query('page') || '1', 10) || 1);
    const limitNum = Math.min(100000, Math.max(1, parseInt(c.req.query('limit') || '100', 10) || 100));
    const offset = (pageNum - 1) * limitNum;

    const conditions: string[] = [];
    const params: unknown[] = [];
    if (action) { conditions.push('al.action = ?'); params.push(action); }
    if (entityType) { conditions.push('al.entity_type = ?'); params.push(entityType); }
    if (userId) { conditions.push('al.user_id = ?'); params.push(userId); }
    if (startDate) { conditions.push('al.created_at >= ?'); params.push(startDate); }
    if (endDate) { conditions.push('al.created_at <= ?'); params.push(endDate); }
    if (search) { conditions.push('al.details LIKE ?'); params.push(`%${search}%`); }
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRow = await queryFirst<{ total: number }>(
      db, `SELECT COUNT(*) as total FROM activity_log al ${whereClause}`, ...params,
    );
    const total = countRow?.total ?? 0;
    const totalPages = limitNum > 0 ? Math.ceil(total / limitNum) : 0;

    const data = await query<Record<string, unknown>>(
      db,
      `SELECT al.id, al.user_id, al.action, al.entity_type, al.entity_id,
              al.details, al.ip_address, al.created_at,
              u.full_name as user_name, u.badge_number, u.role as user_role
       FROM activity_log al
       LEFT JOIN users u ON al.user_id = u.id
       ${whereClause}
       ORDER BY al.created_at DESC
       LIMIT ? OFFSET ?`,
      ...params, limitNum, offset,
    );

    return c.json({ data, pagination: { page: pageNum, limit: limitNum, total, totalPages } });
  } catch (err) {
    return c.json({
      error: 'Failed to fetch audit logs', code: 'FAILED_TO_FETCH_AUDIT',
      detail: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});

// ── GET /api/audit/stats — totals + top actions/users (30-day window) ──
audit.get('/stats', async (c) => {
  try {
    const db = getDb(c.env);
    const totalRow = await queryFirst<{ total: number }>(db, 'SELECT COUNT(*) as total FROM activity_log');
    const todayRow = await queryFirst<{ total: number }>(
      db, `SELECT COUNT(*) as total FROM activity_log WHERE date(created_at) = date('now')`,
    );
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const topActions = await query<Record<string, unknown>>(
      db,
      `SELECT action, COUNT(*) as count FROM activity_log
       WHERE created_at >= ? GROUP BY action ORDER BY count DESC LIMIT 10`,
      cutoff,
    );
    const topUsers = await query<Record<string, unknown>>(
      db,
      `SELECT u.full_name as user_name, u.badge_number, COUNT(*) as count
       FROM activity_log al LEFT JOIN users u ON al.user_id = u.id
       WHERE al.created_at >= ? AND u.full_name IS NOT NULL
       GROUP BY u.full_name, u.badge_number ORDER BY count DESC LIMIT 10`,
      cutoff,
    );

    c.header('Cache-Control', 'private, max-age=60');
    return c.json({
      totalEntries: totalRow?.total ?? 0,
      entriesToday: todayRow?.total ?? 0,
      topActions,
      topUsers,
    });
  } catch (err) {
    return c.json({ error: 'Failed to fetch audit stats', code: 'FAILED_TO_FETCH_AUDIT' }, 500);
  }
});

// ── GET /api/audit/export — CSV download (capped at 1000) ──
audit.get('/export', async (c) => {
  try {
    const db = getDb(c.env);
    const conditions: string[] = [];
    const params: unknown[] = [];
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

    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT al.action, al.entity_type, al.entity_id, al.details,
              u.full_name as user_name, al.ip_address, al.created_at
       FROM activity_log al
       LEFT JOIN users u ON al.user_id = u.id
       ${whereClause}
       ORDER BY al.created_at DESC
       LIMIT 1000`,
      ...params,
    );

    const csv = rowsToCsv([
      { key: 'action', header: 'Action' },
      { key: 'entity_type', header: 'Entity Type' },
      { key: 'entity_id', header: 'Entity ID' },
      { key: 'details', header: 'Details' },
      { key: 'user_name', header: 'User Name' },
      { key: 'ip_address', header: 'IP Address' },
      { key: 'created_at', header: 'Created At' },
    ], rows);

    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="audit_log_export.csv"',
      },
    });
  } catch (err) {
    return c.json({ error: 'Failed to export audit log', code: 'EXPORT_AUDIT_LOG_ERROR' }, 500);
  }
});

// ── POST /api/audit/retention/enforce — DESTRUCTIVE; admin only ──
audit.post('/retention/enforce', async (c) => {
  if (!requireAdmin(c)) return c.json({ error: 'Admin only', code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const body = await c.req.json<{ retention_days?: number }>().catch(() => ({} as { retention_days?: number }));
    const days = Math.max(30, Math.min(3650, parseInt(String(body.retention_days ?? '365'), 10) || 365));

    const beforeRow = await queryFirst<{ count: number }>(db, 'SELECT COUNT(*) as count FROM activity_log');
    const countBefore = beforeRow?.count ?? 0;

    const result = await execute(
      db,
      `DELETE FROM activity_log WHERE created_at < datetime('now', '-' || ? || ' days')`,
      days,
    );

    const afterRow = await queryFirst<{ count: number }>(db, 'SELECT COUNT(*) as count FROM activity_log');
    const countAfter = afterRow?.count ?? 0;

    // Log the enforcement itself so it stays auditable even after the purge.
    const user = c.get('user');
    const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown';
    await execute(
      db,
      `INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
       VALUES (?, 'audit_retention_enforced', 'audit', 0, ?, ?)`,
      user?.id ?? 0,
      `Enforced ${days}-day retention: removed ${result.meta.changes} entries`,
      ip,
    );

    return c.json({
      retention_days: days,
      deleted: result.meta.changes,
      remaining: countAfter,
      before: countBefore,
    });
  } catch (err) {
    return c.json({ error: 'Failed to enforce retention', code: 'RETENTION_ENFORCE_ERROR' }, 500);
  }
});

// ── GET /api/audit/retention/policy — current policy + totals ──
audit.get('/retention/policy', async (c) => {
  try {
    const db = getDb(c.env);
    const row = await queryFirst<{ config_value: string }>(
      db,
      `SELECT config_value FROM system_config WHERE config_key = 'audit_retention_days' AND category = 'system_settings'`,
    );
    const autoRow = await queryFirst<{ config_value: string }>(
      db,
      `SELECT config_value FROM system_config WHERE config_key = 'audit_auto_enforce' AND category = 'system_settings'`,
    );
    const totalRow = await queryFirst<{ count: number }>(db, 'SELECT COUNT(*) as count FROM activity_log');
    const oldestRow = await queryFirst<{ oldest: string | null }>(db, 'SELECT MIN(created_at) as oldest FROM activity_log');

    return c.json({
      retention_days: parseInt(row?.config_value ?? '365', 10) || 365,
      auto_enforce: autoRow?.config_value === 'true',
      totalEntries: totalRow?.count ?? 0,
      oldestEntry: oldestRow?.oldest ?? null,
    });
  } catch (err) {
    return c.json({ error: 'Failed to get retention policy', code: 'GET_RETENTION_POLICY_ERROR' }, 500);
  }
});

// ── PUT /api/audit/retention/policy — admin only ──
audit.put('/retention/policy', async (c) => {
  if (!requireAdmin(c)) return c.json({ error: 'Admin only', code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const body = await c.req.json<{ retention_days?: number; auto_enforce?: boolean }>();
    const { retention_days, auto_enforce } = body || {};
    const now = new Date().toISOString();

    if (retention_days !== undefined) {
      // DELETE then INSERT — system_config has UNIQUE(config_key, config_value)
      // which doesn't prevent multiple rows per config_key but does prevent
      // duplicate (key,value) pairs.
      await execute(
        db,
        `DELETE FROM system_config WHERE config_key = 'audit_retention_days' AND category = 'system_settings'`,
      );
      await execute(
        db,
        `INSERT INTO system_config (config_key, config_value, category, sort_order, created_at, updated_at)
         VALUES ('audit_retention_days', ?, 'system_settings', 0, ?, ?)`,
        String(retention_days), now, now,
      );
    }
    if (auto_enforce !== undefined) {
      await execute(
        db,
        `DELETE FROM system_config WHERE config_key = 'audit_auto_enforce' AND category = 'system_settings'`,
      );
      await execute(
        db,
        `INSERT INTO system_config (config_key, config_value, category, sort_order, created_at, updated_at)
         VALUES ('audit_auto_enforce', ?, 'system_settings', 0, ?, ?)`,
        auto_enforce ? 'true' : 'false', now, now,
      );
    }

    return c.json({ retention_days, auto_enforce, message: 'Policy updated' });
  } catch (err) {
    return c.json({ error: 'Failed to update retention policy', code: 'UPDATE_RETENTION_POLICY_ERROR' }, 500);
  }
});

// ── GET /api/audit/action-types — distinct action + entity types ──
audit.get('/action-types', async (c) => {
  try {
    const db = getDb(c.env);
    const actionTypes = await query<Record<string, unknown>>(
      db,
      `SELECT action, COUNT(*) as count, MAX(created_at) as last_seen
       FROM activity_log GROUP BY action ORDER BY count DESC`,
    );
    const entityTypes = await query<Record<string, unknown>>(
      db,
      `SELECT entity_type, COUNT(*) as count FROM activity_log
       WHERE entity_type IS NOT NULL GROUP BY entity_type ORDER BY count DESC`,
    );
    return c.json({ actionTypes, entityTypes });
  } catch (err) {
    return c.json({ error: 'Failed to get action types', code: 'ACTION_TYPES_ERROR' }, 500);
  }
});

// ── GET /api/audit/summary?days=N — daily/hourly trends ──
audit.get('/summary', async (c) => {
  try {
    const db = getDb(c.env);
    const daysNum = Math.max(1, Math.min(365, parseInt(c.req.query('days') || '30', 10) || 30));

    const dailyTrend = await query<Record<string, unknown>>(
      db,
      `SELECT DATE(created_at) as date, COUNT(*) as count FROM activity_log
       WHERE created_at >= datetime('now', '-' || ? || ' days')
       GROUP BY date ORDER BY date`,
      daysNum,
    );
    const byHour = await query<Record<string, unknown>>(
      db,
      `SELECT CAST(strftime('%H', created_at) AS INTEGER) as hour, COUNT(*) as count
       FROM activity_log WHERE created_at >= datetime('now', '-' || ? || ' days')
       GROUP BY hour ORDER BY hour`,
      daysNum,
    );
    const topUsers = await query<Record<string, unknown>>(
      db,
      `SELECT u.full_name, u.badge_number, u.role, COUNT(*) as action_count
       FROM activity_log al JOIN users u ON al.user_id = u.id
       WHERE al.created_at >= datetime('now', '-' || ? || ' days')
       GROUP BY al.user_id ORDER BY action_count DESC LIMIT 10`,
      daysNum,
    );
    const topActions = await query<Record<string, unknown>>(
      db,
      `SELECT action, COUNT(*) as count FROM activity_log
       WHERE created_at >= datetime('now', '-' || ? || ' days')
       GROUP BY action ORDER BY count DESC LIMIT 15`,
      daysNum,
    );
    const securityActions = await query<Record<string, unknown>>(
      db,
      `SELECT action, COUNT(*) as count FROM activity_log
       WHERE created_at >= datetime('now', '-' || ? || ' days')
         AND (action LIKE '%login%' OR action LIKE '%password%' OR action LIKE '%totp%'
              OR action LIKE '%session%' OR action LIKE '%role%' OR action LIKE '%permission%')
       GROUP BY action ORDER BY count DESC`,
      daysNum,
    );
    const totalInPeriod = await queryFirst<{ count: number }>(
      db,
      `SELECT COUNT(*) as count FROM activity_log
       WHERE created_at >= datetime('now', '-' || ? || ' days')`,
      daysNum,
    );
    const totalOverall = await queryFirst<{ count: number }>(db, 'SELECT COUNT(*) as count FROM activity_log');

    return c.json({
      period_days: daysNum,
      totalInPeriod: totalInPeriod?.count ?? 0,
      totalOverall: totalOverall?.count ?? 0,
      dailyTrend, byHour, topUsers, topActions, securityActions,
    });
  } catch (err) {
    return c.json({ error: 'Failed to get audit summary', code: 'AUDIT_SUMMARY_ERROR' }, 500);
  }
});

// ── GET /api/audit/entity/:entityType/:entityId — per-record trail ──
audit.get('/entity/:entityType/:entityId', async (c) => {
  try {
    const db = getDb(c.env);
    const entityType = c.req.param('entityType');
    const entityId = parseInt(c.req.param('entityId'), 10);
    const limitNum = Math.min(100000, Math.max(1, parseInt(c.req.query('limit') || '100', 10) || 100));

    const logs = await query<Record<string, unknown>>(
      db,
      `SELECT al.*, u.full_name as user_name, u.badge_number
       FROM activity_log al LEFT JOIN users u ON al.user_id = u.id
       WHERE al.entity_type = ? AND al.entity_id = ?
       ORDER BY al.created_at DESC LIMIT ?`,
      entityType, entityId, limitNum,
    );
    return c.json({ data: logs, entity_type: entityType, entity_id: entityId });
  } catch (err) {
    return c.json({ error: 'Failed to get entity audit log', code: 'ENTITY_AUDIT_ERROR' }, 500);
  }
});

// ── POST /api/audit/compress — daily aggregates (non-destructive, admin only) ──
audit.post('/compress', async (c) => {
  if (!requireAdmin(c)) return c.json({ error: 'Admin only', code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const body = await c.req.json<{ older_than_days?: number }>().catch(() => ({} as { older_than_days?: number }));
    const days = Math.max(30, parseInt(String(body.older_than_days ?? '90'), 10) || 90);
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const countRow = await queryFirst<{ count: number }>(
      db, 'SELECT COUNT(*) as count FROM activity_log WHERE created_at < ?', cutoff,
    );
    const count = countRow?.count ?? 0;
    if (count === 0) return c.json({ message: 'No entries older than the cutoff', compressed: 0 });

    const summaries = await query<{ log_date: string; action: string; count: number; unique_users: number }>(
      db,
      `SELECT DATE(created_at) as log_date, action,
              COUNT(*) as count, COUNT(DISTINCT user_id) as unique_users
       FROM activity_log WHERE created_at < ?
       GROUP BY DATE(created_at), action ORDER BY log_date`,
      cutoff,
    );

    // Self-heal — table not in /migrations/. Idempotent CREATE.
    await execute(
      db,
      `CREATE TABLE IF NOT EXISTS audit_daily_summaries (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         log_date TEXT NOT NULL, action TEXT NOT NULL,
         entry_count INTEGER DEFAULT 0, unique_users INTEGER DEFAULT 0,
         created_at TEXT
       )`,
    );
    await execute(
      db,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_summaries_unique ON audit_daily_summaries(log_date, action)`,
    );

    const now = new Date().toISOString();
    for (const s of summaries) {
      // ON CONFLICT DO UPDATE preserves IDs and avoids the ON DELETE CASCADE
      // side-effects that INSERT OR REPLACE triggers.
      await execute(
        db,
        `INSERT INTO audit_daily_summaries (log_date, action, entry_count, unique_users, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(log_date, action) DO UPDATE SET
           entry_count = excluded.entry_count,
           unique_users = excluded.unique_users,
           created_at = excluded.created_at`,
        s.log_date, s.action, s.count, s.unique_users, now,
      );
    }

    return c.json({
      message: `Created ${summaries.length} daily summaries for ${count} audit entries older than ${days} days`,
      summaries_created: summaries.length,
      entries_covered: count,
      cutoff_date: cutoff.split('T')[0],
    });
  } catch (err) {
    return c.json({ error: 'Failed to compress audit log', code: 'AUDIT_COMPRESS_ERROR' }, 500);
  }
});

// ── GET /api/audit/index-stats — admin diagnostics ──
audit.get('/index-stats', async (c) => {
  if (!requireAdmin(c)) return c.json({ error: 'Admin only', code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const totalEntries = (await queryFirst<{ count: number }>(db, 'SELECT COUNT(*) as count FROM activity_log'))?.count ?? 0;
    const oldestEntry = await queryFirst<{ oldest: string | null }>(db, 'SELECT MIN(created_at) as oldest FROM activity_log');
    const newestEntry = await queryFirst<{ newest: string | null }>(db, 'SELECT MAX(created_at) as newest FROM activity_log');
    const uniqueActions = (await queryFirst<{ count: number }>(db, 'SELECT COUNT(DISTINCT action) as count FROM activity_log'))?.count ?? 0;
    const uniqueEntityTypes = (await queryFirst<{ count: number }>(db, 'SELECT COUNT(DISTINCT entity_type) as count FROM activity_log'))?.count ?? 0;
    const uniqueUsers = (await queryFirst<{ count: number }>(db, 'SELECT COUNT(DISTINCT user_id) as count FROM activity_log'))?.count ?? 0;
    const avgEntrySize = await queryFirst<{ avg_bytes: number | null }>(
      db,
      `SELECT AVG(LENGTH(COALESCE(action, '')) + LENGTH(COALESCE(details, '')) + LENGTH(COALESCE(ip_address, ''))) as avg_bytes
       FROM activity_log LIMIT 1000`,
    );

    return c.json({
      total_entries: totalEntries,
      oldest_entry: oldestEntry?.oldest ?? null,
      newest_entry: newestEntry?.newest ?? null,
      unique_actions: uniqueActions,
      unique_entity_types: uniqueEntityTypes,
      unique_users: uniqueUsers,
      estimated_size_mb: Math.round((totalEntries * (avgEntrySize?.avg_bytes || 100)) / 1024 / 1024 * 100) / 100,
    });
  } catch (err) {
    return c.json({ error: 'Failed to get index stats', code: 'AUDIT_INDEX_STATS_ERROR' }, 500);
  }
});

// ── GET /api/audit/compliance-report — structured compliance report (max 90 days) ──
audit.get('/compliance-report', async (c) => {
  try {
    const db = getDb(c.env);
    const days = Math.min(90, Math.max(1, parseInt(c.req.query('days') || '30', 10) || 30));
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const securityEvents = await query<Record<string, unknown>>(
      db,
      `SELECT action, COUNT(*) as count FROM activity_log
       WHERE created_at >= ? AND action IN (
         'user_login', 'user_logout', 'password_changed', 'totp_enabled',
         'totp_disabled', 'user_created', 'user_deactivated', 'user_role_changed',
         'admin_terminate_sessions', 'enforce_password_expiry'
       )
       GROUP BY action ORDER BY count DESC`,
      cutoff,
    );
    const dataAccess = await query<Record<string, unknown>>(
      db,
      `SELECT entity_type, COUNT(*) as count FROM activity_log
       WHERE created_at >= ? AND action IN ('read', 'view', 'search', 'export')
       GROUP BY entity_type ORDER BY count DESC LIMIT 20`,
      cutoff,
    );
    const dataModifications = await query<Record<string, unknown>>(
      db,
      `SELECT entity_type, action, COUNT(*) as count FROM activity_log
       WHERE created_at >= ? AND action IN ('create', 'update', 'delete', 'archive', 'CREATE', 'UPDATE', 'DELETE')
       GROUP BY entity_type, action ORDER BY count DESC LIMIT 30`,
      cutoff,
    );

    // login_attempts is in the initial schema so it always exists on the
    // live DB. Wrapping in try/catch defends against fresh D1 deployments
    // where the migration may not have applied yet.
    let failedLogins = 0;
    let successfulLogins = 0;
    try {
      const failed = await queryFirst<{ count: number }>(
        db, `SELECT COUNT(*) as count FROM login_attempts WHERE success = 0 AND created_at >= ?`, cutoff,
      );
      failedLogins = failed?.count ?? 0;
      const ok = await queryFirst<{ count: number }>(
        db, `SELECT COUNT(*) as count FROM login_attempts WHERE success = 1 AND created_at >= ?`, cutoff,
      );
      successfulLogins = ok?.count ?? 0;
    } catch { /* table missing — leave as 0 */ }

    const activeUsers = (await queryFirst<{ count: number }>(
      db, `SELECT COUNT(DISTINCT user_id) as count FROM activity_log WHERE created_at >= ?`, cutoff,
    ))?.count ?? 0;

    return c.json({
      report_period_days: days,
      generated_at: new Date().toISOString(),
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
  } catch (err) {
    return c.json({ error: 'Failed to generate compliance report', code: 'COMPLIANCE_REPORT_ERROR' }, 500);
  }
});

export default audit;

import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { localNow } from '../utils/timeUtils';
import { getConnectedClientCount } from '../utils/websocket';
import { createNotification } from './notifications';
import { sendNotificationEmail } from '../utils/emailSender';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

// Allowed table names for retention policy operations (SQL injection prevention)
const RETENTION_ALLOWED_TABLES = new Set([
  'calls_for_service', 'incidents', 'persons', 'vehicles', 'warrants',
  'evidence', 'arrests', 'citations', 'audit_log', 'activity_log',
  'fleet_vehicles', 'fleet_fuel_logs', 'fleet_maintenance_logs',
  'attachments', 'notifications', 'patrol_breadcrumbs',
]);

// All routes require authentication
router.use(authenticateToken);

// ============================================================
// Initialize tables for this module
// ============================================================
function initTables(): void {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS system_announcements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      type TEXT CHECK(type IN ('info','warning','maintenance','update','policy')) DEFAULT 'info',
      priority TEXT CHECK(priority IN ('normal','high','critical')) DEFAULT 'normal',
      target_roles TEXT DEFAULT '[]',
      is_active INTEGER DEFAULT 1,
      starts_at TEXT,
      expires_at TEXT,
      created_by INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS retention_policies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL UNIQUE,
      retention_days INTEGER NOT NULL DEFAULT 365,
      auto_archive INTEGER DEFAULT 0,
      auto_delete INTEGER DEFAULT 0,
      last_run_at TEXT,
      records_affected INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS departments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      code TEXT UNIQUE,
      description TEXT,
      parent_id INTEGER,
      manager_id INTEGER,
      is_active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (parent_id) REFERENCES departments(id),
      FOREIGN KEY (manager_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS notification_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      trigger_event TEXT NOT NULL,
      conditions TEXT DEFAULT '{}',
      target_roles TEXT DEFAULT '[]',
      target_user_ids TEXT DEFAULT '[]',
      notification_type TEXT CHECK(notification_type IN ('in_app','email','both')) DEFAULT 'in_app',
      is_active INTEGER DEFAULT 1,
      created_by INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );
  `);

  // ── Seed default notification rules (idempotent — skips existing trigger events) ──
  const adminId = (db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get() as any)?.id || 1;
  const now = localNow();
  const existingEvents = new Set(
    (db.prepare('SELECT trigger_event FROM notification_rules').all() as any[]).map(r => r.trigger_event)
  );
  const seed = db.prepare(`
    INSERT INTO notification_rules (name, description, trigger_event, target_roles, notification_type, is_active, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
  `);
  const rules = [
    ['New Call for Service', 'Notify dispatch/supervisors when a new call is created', 'dispatch.call_created', '["admin","manager","supervisor","dispatcher"]', 'in_app'],
    ['P1 Emergency Call', 'Critical alert for P1 emergency calls', 'dispatch.call_priority_p1', '["admin","manager","supervisor","officer","dispatcher"]', 'both'],
    ['Unit Dispatched', 'Notify officer when dispatched to a call', 'dispatch.unit_dispatched', '["officer"]', 'in_app'],
    ['Call Cleared', 'Notify supervisors when a call is cleared', 'dispatch.call_cleared', '["admin","manager","supervisor"]', 'in_app'],
    ['Warrant Created', 'Alert sworn personnel of new warrants', 'warrant.created', '["admin","manager","supervisor","officer"]', 'in_app'],
    ['Warrant Served', 'Notify supervisors when a warrant is served', 'warrant.served', '["admin","manager","supervisor"]', 'in_app'],
    ['Incident Created', 'Notify supervisors of new incident reports', 'incident.created', '["admin","manager","supervisor"]', 'in_app'],
    ['Citation Issued', 'Notify supervisors of citations issued', 'citation.issued', '["admin","manager","supervisor"]', 'in_app'],
    ['Trespass Order Issued', 'Notify supervisors of new trespass orders', 'trespass.created', '["admin","manager","supervisor"]', 'in_app'],
    ['Field Interview Recorded', 'Notify supervisors of new field interviews', 'fi.created', '["admin","manager","supervisor"]', 'in_app'],
    ['New IP Login', 'Alert user when login from unrecognized IP', 'auth.new_ip_login', '["admin","manager","supervisor","officer","dispatcher"]', 'both'],
    ['Patrol Checkpoint Missed', 'Alert when a patrol checkpoint scan is overdue', 'patrol.checkpoint_missed', '["admin","manager","supervisor","officer"]', 'both'],
  ];
  let seeded = 0;
  for (const [name, desc, event, roles, type] of rules) {
    if (!existingEvents.has(event)) {
      seed.run(name, desc, event, roles, type, adminId, now, now);
      seeded++;
    }
  }
  if (seeded > 0) console.log(`[AdminSystems] Seeded ${seeded} new notification rules`);
}

// Run table init on import (may fail if DB not yet initialized)
let tablesInitialized = false;
try {
  initTables();
  tablesInitialized = true;
} catch {
  // DB may not be initialized yet at import time; will retry on first request
}

// Lazy init middleware — ensures tables exist before any route handler runs
router.use((_req, _res, next) => {
  if (!tablesInitialized) {
    try {
      initTables();
      tablesInitialized = true;
    } catch (err) {
      console.error('adminSystems initTables retry failed:', err);
    }
  }
  next();
});

// ============================================================
// 0. USER & TRAINING LOOKUPS (used by AdminTrainingTab, ShiftPlans)
// ============================================================

// GET /users — List all users (for admin panels that need user dropdowns)
router.get('/users', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT id, username, full_name, badge_number, role, status, email, phone,
             hire_date, department, created_at, updated_at
      FROM users
      ORDER BY full_name ASC
    `).all();
    res.json(rows);
  } catch (err: any) {
    console.error('GET /admin/users error:', err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// GET /training — List all training records (for compliance dashboard)
router.get('/training', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT tr.*, u.full_name as officer_name, u.badge_number,
             tr.officer_id as user_id
      FROM training_records tr
      LEFT JOIN users u ON tr.officer_id = u.id
      ORDER BY tr.created_at DESC
    `).all();
    res.json(rows);
  } catch (err: any) {
    console.error('GET /admin/training error:', err);
    res.status(500).json({ error: 'Failed to fetch training records' });
  }
});

// ============================================================
// 0. CLIENT ERROR REPORTING
// ============================================================

// POST /health/client-error — Logs client-side React errors to server log
router.post('/health/client-error', authenticateToken, (req: Request, res: Response) => {
  const { message, componentStack, url, timestamp } = req.body || {};
  const user = (req as any).user;
  console.error(
    `[CLIENT ERROR] user=${user?.username || '?'} url=${url || '?'} time=${timestamp || '?'}`,
    `\n  message: ${message || 'unknown'}`,
    componentStack ? `\n  components: ${componentStack.trim().split('\n').slice(0, 5).join(' > ')}` : '',
  );
  res.json({ received: true });
});

// ============================================================
// 1. SYSTEM HEALTH & METRICS
// ============================================================

// GET /health/detailed — Requires admin/manager role
router.get('/health/detailed', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();

    // Server uptime & memory
    const uptime = process.uptime();
    const memory = process.memoryUsage();

    // Database file size
    const dataDir = process.env.RMPG_DATA_DIR || path.resolve(__dirname, '../../data');
    const dbPath = path.join(dataDir, 'rmpg-flex.db');
    let dbFileSize = 0;
    try {
      const stat = fs.statSync(dbPath);
      dbFileSize = stat.size;
    } catch { /* file may not exist */ }

    // Table row counts
    const tableCounts: Record<string, number> = {};
    const tables = [
      'users', 'calls_for_service', 'incidents', 'persons',
      'vehicles_records', 'warrants', 'citations', 'activity_log',
    ];
    for (const table of tables) {
      try {
        const row = db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as any;
        tableCounts[table] = row.count;
      } catch {
        tableCounts[table] = 0;
      }
    }

    // Active sessions
    let activeSessions = 0;
    try {
      const row = db.prepare("SELECT COUNT(*) as count FROM sessions WHERE is_active = 1").get() as any;
      activeSessions = row.count;
    } catch { /* ignore */ }

    // Active units
    let activeUnits = 0;
    try {
      const row = db.prepare("SELECT COUNT(*) as count FROM units WHERE status != 'off_duty'").get() as any;
      activeUnits = row.count;
    } catch { /* ignore */ }

    // Pending calls
    let pendingCalls = 0;
    try {
      const row = db.prepare("SELECT COUNT(*) as count FROM calls_for_service WHERE status NOT IN ('closed','cancelled','archived')").get() as any;
      pendingCalls = row.count;
    } catch { /* ignore */ }

    // WebSocket connected clients
    const wsClients = getConnectedClientCount();

    // Login stats from last 24 hours
    let loginSuccessful = 0;
    let loginFailed = 0;
    try {
      const successRow = db.prepare("SELECT COUNT(*) as count FROM login_attempts WHERE success = 1 AND created_at >= datetime('now', '-1 day')").get() as any;
      loginSuccessful = successRow.count;
      const failRow = db.prepare("SELECT COUNT(*) as count FROM login_attempts WHERE success = 0 AND created_at >= datetime('now', '-1 day')").get() as any;
      loginFailed = failRow.count;
    } catch { /* ignore */ }

    // Recent errors from activity_log
    let recentErrors: any[] = [];
    try {
      recentErrors = db.prepare(`
        SELECT al.*, u.full_name as user_name
        FROM activity_log al
        LEFT JOIN users u ON al.user_id = u.id
        WHERE al.action LIKE '%error%' OR al.action LIKE '%failed%'
        ORDER BY al.created_at DESC
        LIMIT 10
      `).all();
    } catch { /* ignore */ }

    // ─── VPS / Host Metrics ────────────────────────────────
    const cpus = os.cpus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const loadAvg = os.loadavg();

    // Disk usage (works on Linux/macOS)
    let diskTotal = 0;
    let diskUsed = 0;
    let diskFree = 0;
    try {
      const dfOutput = execSync("df -k / | tail -1", { encoding: 'utf-8', timeout: 3000 });
      const parts = dfOutput.trim().split(/\s+/);
      if (parts.length >= 4) {
        diskTotal = parseInt(parts[1], 10) * 1024; // KB to bytes
        diskUsed = parseInt(parts[2], 10) * 1024;
        diskFree = parseInt(parts[3], 10) * 1024;
      }
    } catch { /* disk info unavailable */ }

    // System uptime (host, not just Node process)
    const hostUptime = os.uptime();

    // Network interfaces — public IP, MAC, etc.
    const networkInterfaces: Array<{ name: string; ip: string; mac: string; internal: boolean; family: string }> = [];
    const nets = os.networkInterfaces();
    for (const [name, addrs] of Object.entries(nets)) {
      if (!addrs) continue;
      for (const addr of addrs) {
        if (addr.family === 'IPv4') {
          networkInterfaces.push({
            name,
            ip: addr.address,
            mac: addr.mac,
            internal: addr.internal,
            family: addr.family,
          });
        }
      }
    }

    // CPU usage percentage (Linux only — /proc/stat based snapshot)
    let cpuUsagePercent: number | null = null;
    try {
      // Quick single-sample via /proc/stat (Linux) or vm_stat (macOS)
      if (os.platform() === 'linux') {
        const topOutput = execSync("top -bn1 | head -3 | grep 'Cpu'", { encoding: 'utf-8', timeout: 3000 });
        const idleMatch = topOutput.match(/(\d+\.?\d*)\s*id/);
        if (idleMatch) cpuUsagePercent = Math.round((100 - parseFloat(idleMatch[1])) * 10) / 10;
      } else {
        // macOS fallback — approximate from load average vs core count
        cpuUsagePercent = Math.round((loadAvg[0] / cpus.length) * 100 * 10) / 10;
      }
    } catch { /* CPU usage unavailable */ }

    // Network I/O (Linux: /proc/net/dev)
    let networkIO: { rxBytes: number; txBytes: number } | null = null;
    try {
      if (os.platform() === 'linux') {
        const netDev = execSync("cat /proc/net/dev | grep -v 'lo:' | tail -n +3", { encoding: 'utf-8', timeout: 3000 });
        let totalRx = 0, totalTx = 0;
        for (const line of netDev.trim().split('\n')) {
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 10) {
            totalRx += parseInt(parts[1], 10) || 0;
            totalTx += parseInt(parts[9], 10) || 0;
          }
        }
        networkIO = { rxBytes: totalRx, txBytes: totalTx };
      }
    } catch { /* network I/O unavailable */ }

    // Process count (Linux)
    let processCount: number | null = null;
    try {
      const psOutput = execSync("ps aux --no-heading 2>/dev/null | wc -l || ps aux | wc -l", { encoding: 'utf-8', timeout: 3000 });
      processCount = parseInt(psOutput.trim(), 10) || null;
    } catch { /* ignore */ }

    // Read version from changelog
    let appVersion = '0.0.0';
    try {
      const changelogPath = path.resolve(__dirname, '../../../CHANGELOG.json');
      const changelogData = JSON.parse(fs.readFileSync(changelogPath, 'utf-8'));
      appVersion = changelogData.version || '0.0.0';
    } catch { /* changelog not found */ }

    res.json({
      timestamp: now,
      version: appVersion,
      server: {
        uptime: Math.round(uptime),
        memory: {
          rss: memory.rss,
          heapTotal: memory.heapTotal,
          heapUsed: memory.heapUsed,
          external: memory.external,
        },
        nodeVersion: process.version,
      },
      host: {
        hostname: os.hostname(),
        platform: os.platform(),
        arch: os.arch(),
        osRelease: os.release(),
        osType: os.type(),
        hostUptime: Math.round(hostUptime),
        cpu: {
          model: cpus[0]?.model || 'Unknown',
          cores: cpus.length,
          speed: cpus[0]?.speed || 0,
          usagePercent: cpuUsagePercent,
        },
        memory: {
          total: totalMem,
          free: freeMem,
          used: totalMem - freeMem,
        },
        disk: {
          total: diskTotal,
          used: diskUsed,
          free: diskFree,
        },
        loadAverage: {
          '1m': Math.round(loadAvg[0] * 100) / 100,
          '5m': Math.round(loadAvg[1] * 100) / 100,
          '15m': Math.round(loadAvg[2] * 100) / 100,
        },
        network: networkInterfaces,
        networkIO: networkIO,
        processCount: processCount,
      },
      database: {
        sizeBytes: dbFileSize,
        tables: tableCounts,
      },
      operations: {
        activeSessions,
        activeUnits,
        pendingCalls,
        connectedClients: wsClients,
      },
      loginStats: {
        successful24h: loginSuccessful,
        failed24h: loginFailed,
      },
      recentErrors: recentErrors,
    });
  } catch (error: any) {
    console.error('Health detailed error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /changelog — Version history and changelog
router.get('/changelog', requireRole('admin', 'manager'), (_req: Request, res: Response) => {
  try {
    const changelogPath = path.resolve(__dirname, '../../../CHANGELOG.json');
    const data = JSON.parse(fs.readFileSync(changelogPath, 'utf-8'));
    res.json(data);
  } catch (error: any) {
    console.error('Changelog read error:', error);
    res.status(500).json({ error: 'Could not read changelog' });
  }
});

// ============================================================
// 2. SYSTEM ANNOUNCEMENTS
// ============================================================

// GET /announcements — List active announcements (filtered by current user's role)
router.get('/announcements', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const userRole = req.user!.role;

    const announcements = db.prepare(`
      SELECT sa.*, u.full_name as created_by_name
      FROM system_announcements sa
      LEFT JOIN users u ON sa.created_by = u.id
      WHERE sa.is_active = 1
        AND (sa.starts_at IS NULL OR sa.starts_at <= ?)
        AND (sa.expires_at IS NULL OR sa.expires_at >= ?)
      ORDER BY
        CASE sa.priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 END,
        sa.created_at DESC
    `).all(now, now) as any[];

    // Filter by target_roles — empty array means all roles
    const filtered = announcements.filter((a: any) => {
      try {
        const roles = JSON.parse(a.target_roles || '[]');
        if (!Array.isArray(roles) || roles.length === 0) return true;
        return roles.includes(userRole);
      } catch {
        return true;
      }
    });

    res.json(filtered);
  } catch (error: any) {
    console.error('Get announcements error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /announcements/all — Admin only: list ALL announcements including inactive
router.get('/announcements/all', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const announcements = db.prepare(`
      SELECT sa.*, u.full_name as created_by_name
      FROM system_announcements sa
      LEFT JOIN users u ON sa.created_by = u.id
      ORDER BY sa.created_at DESC
    `).all();

    res.json(announcements);
  } catch (error: any) {
    console.error('Get all announcements error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /announcements — Admin/manager: create announcement
router.post('/announcements', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { title, body, type, priority, target_roles, is_active, starts_at, expires_at } = req.body;

    if (!title || !body) {
      res.status(400).json({ error: 'title and body are required' });
      return;
    }

    const now = localNow();
    const rolesJson = target_roles
      ? (typeof target_roles === 'string' ? target_roles : JSON.stringify(target_roles))
      : '[]';

    const result = db.prepare(`
      INSERT INTO system_announcements (title, body, type, priority, target_roles, is_active, starts_at, expires_at, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      title, body,
      type || 'info',
      priority || 'normal',
      rolesJson,
      is_active !== undefined ? (is_active ? 1 : 0) : 1,
      starts_at || null,
      expires_at || null,
      req.user!.userId,
      now, now,
    );

    const announcement = db.prepare('SELECT * FROM system_announcements WHERE id = ?').get(result.lastInsertRowid);

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'announcement_created', 'announcement', ?, ?, ?)
    `).run(req.user!.userId, result.lastInsertRowid, `Created announcement: ${title}`, req.ip || 'unknown');

    res.status(201).json(announcement || { id: result.lastInsertRowid });
  } catch (error: any) {
    console.error('Create announcement error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /announcements/:id — Admin/manager: update announcement
router.put('/announcements/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM system_announcements WHERE id = ?').get(req.params.id) as any;
    if (!existing) {
      res.status(404).json({ error: 'Announcement not found' });
      return;
    }

    const fields = ['title', 'body', 'type', 'priority', 'target_roles', 'is_active', 'starts_at', 'expires_at'];
    const bodyKeys = Object.keys(req.body);
    const setClauses: string[] = [];
    const values: any[] = [];

    for (const f of fields) {
      if (bodyKeys.includes(f)) {
        setClauses.push(`${f} = ?`);
        let val = req.body[f];
        if (f === 'target_roles' && typeof val !== 'string') {
          val = JSON.stringify(val);
        }
        if (f === 'is_active') {
          val = val ? 1 : 0;
        }
        values.push(val === '' ? null : val ?? null);
      }
    }

    if (setClauses.length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    setClauses.push('updated_at = ?');
    values.push(localNow());
    values.push(req.params.id);

    db.prepare(`UPDATE system_announcements SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);

    const updated = db.prepare('SELECT * FROM system_announcements WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (error: any) {
    console.error('Update announcement error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /announcements/:id — Admin only: delete announcement
router.delete('/announcements/:id', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM system_announcements WHERE id = ?').get(req.params.id) as any;
    if (!existing) {
      res.status(404).json({ error: 'Announcement not found' });
      return;
    }

    db.prepare('DELETE FROM system_announcements WHERE id = ?').run(req.params.id);

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'announcement_deleted', 'announcement', ?, ?, ?)
    `).run(req.user!.userId, existing.id, `Deleted announcement: ${existing.title}`, req.ip || 'unknown');

    res.json({ message: 'Announcement deleted' });
  } catch (error: any) {
    console.error('Delete announcement error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// 3. DATA RETENTION POLICIES
// ============================================================

// GET /retention — List all retention policies
router.get('/retention', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const policies = db.prepare('SELECT * FROM retention_policies ORDER BY entity_type').all();
    res.json(policies);
  } catch (error: any) {
    console.error('Get retention policies error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /retention/:id — Update a retention policy
router.put('/retention/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM retention_policies WHERE id = ?').get(req.params.id) as any;
    if (!existing) {
      res.status(404).json({ error: 'Retention policy not found' });
      return;
    }

    const fields = ['retention_days', 'auto_archive', 'auto_delete', 'is_active'];
    const bodyKeys = Object.keys(req.body);
    const setClauses: string[] = [];
    const values: any[] = [];

    for (const f of fields) {
      if (bodyKeys.includes(f)) {
        setClauses.push(`${f} = ?`);
        let val = req.body[f];
        if (f === 'auto_archive' || f === 'auto_delete' || f === 'is_active') {
          val = val ? 1 : 0;
        }
        values.push(val);
      }
    }

    if (setClauses.length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    setClauses.push('updated_at = ?');
    values.push(localNow());
    values.push(req.params.id);

    db.prepare(`UPDATE retention_policies SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);

    const updated = db.prepare('SELECT * FROM retention_policies WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (error: any) {
    console.error('Update retention policy error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /retention/run — Execute retention policies (admin only)
router.post('/retention/run', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const policies = db.prepare('SELECT * FROM retention_policies WHERE is_active = 1').all() as any[];

    const results: Array<{
      entity_type: string;
      action: string;
      records_affected: number;
    }> = [];

    for (const policy of policies) {
      let totalAffected = 0;

      // Validate table name against whitelist (prevent SQL injection)
      if (!RETENTION_ALLOWED_TABLES.has(policy.entity_type)) {
        results.push({
          entity_type: policy.entity_type,
          action: 'error: table not in allowed list',
          records_affected: 0,
        });
        continue;
      }

      try {
        if (policy.auto_archive) {
          // Try to archive records — table must have an archived_at column
          try {
            const archiveResult = db.prepare(`
              UPDATE ${policy.entity_type}
              SET archived_at = ?
              WHERE archived_at IS NULL
                AND created_at < date('now', '-' || ? || ' days')
            `).run(now, policy.retention_days);
            totalAffected += archiveResult.changes;
            if (archiveResult.changes > 0) {
              results.push({
                entity_type: policy.entity_type,
                action: 'archived',
                records_affected: archiveResult.changes,
              });
            }
          } catch {
            // Table may not have archived_at column — skip
          }
        }

        if (policy.auto_delete) {
          const deleteResult = db.prepare(`
            DELETE FROM ${policy.entity_type}
            WHERE created_at < date('now', '-' || ? || ' days')
          `).run(policy.retention_days);
          totalAffected += deleteResult.changes;
          if (deleteResult.changes > 0) {
            results.push({
              entity_type: policy.entity_type,
              action: 'deleted',
              records_affected: deleteResult.changes,
            });
          }
        }

        // Update policy metadata
        db.prepare(`
          UPDATE retention_policies SET last_run_at = ?, records_affected = ?, updated_at = ? WHERE id = ?
        `).run(now, totalAffected, now, policy.id);
      } catch (err: any) {
        results.push({
          entity_type: policy.entity_type,
          action: `error: ${err.message}`,
          records_affected: 0,
        });
      }
    }

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'retention_run', 'system', 0, ?, ?)
    `).run(req.user!.userId, `Retention policies executed: ${results.length} actions`, req.ip || 'unknown');

    res.json({ executed_at: now, results });
  } catch (error: any) {
    console.error('Run retention policies error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /retention/preview — Show how many records would be affected without executing
router.get('/retention/preview', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const policies = db.prepare('SELECT * FROM retention_policies WHERE is_active = 1').all() as any[];

    const previews: Array<{
      id: number;
      entity_type: string;
      retention_days: number;
      auto_archive: number;
      auto_delete: number;
      archive_count: number;
      delete_count: number;
    }> = [];

    for (const policy of policies) {
      let archiveCount = 0;
      let deleteCount = 0;

      // Validate table name against whitelist (prevent SQL injection)
      if (!RETENTION_ALLOWED_TABLES.has(policy.entity_type)) continue;

      try {
        if (policy.auto_archive) {
          try {
            const row = db.prepare(`
              SELECT COUNT(*) as count FROM ${policy.entity_type}
              WHERE archived_at IS NULL
                AND created_at < date('now', '-' || ? || ' days')
            `).get(policy.retention_days) as any;
            archiveCount = row.count;
          } catch {
            // Table may not have archived_at column
          }
        }

        if (policy.auto_delete) {
          const row = db.prepare(`
            SELECT COUNT(*) as count FROM ${policy.entity_type}
            WHERE created_at < date('now', '-' || ? || ' days')
          `).get(policy.retention_days) as any;
          deleteCount = row.count;
        }
      } catch {
        // Table may not exist — skip
      }

      previews.push({
        id: policy.id,
        entity_type: policy.entity_type,
        retention_days: policy.retention_days,
        auto_archive: policy.auto_archive,
        auto_delete: policy.auto_delete,
        archive_count: archiveCount,
        delete_count: deleteCount,
      });
    }

    res.json(previews);
  } catch (error: any) {
    console.error('Retention preview error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// 4. DEPARTMENTS / DIVISIONS
// ============================================================

// GET /departments — List all departments with manager name
router.get('/departments', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const departments = db.prepare(`
      SELECT d.*, u.full_name as manager_name,
        pd.name as parent_name
      FROM departments d
      LEFT JOIN users u ON d.manager_id = u.id
      LEFT JOIN departments pd ON d.parent_id = pd.id
      ORDER BY d.name
    `).all();

    res.json(departments);
  } catch (error: any) {
    console.error('Get departments error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /departments — Create department (admin/manager)
router.post('/departments', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { name, code, description, parent_id, manager_id, is_active } = req.body;

    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }

    const now = localNow();
    const result = db.prepare(`
      INSERT INTO departments (name, code, description, parent_id, manager_id, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      name,
      code || null,
      description || null,
      parent_id || null,
      manager_id || null,
      is_active !== undefined ? (is_active ? 1 : 0) : 1,
      now, now,
    );

    const department = db.prepare(`
      SELECT d.*, u.full_name as manager_name
      FROM departments d
      LEFT JOIN users u ON d.manager_id = u.id
      WHERE d.id = ?
    `).get(result.lastInsertRowid);

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'department_created', 'department', ?, ?, ?)
    `).run(req.user!.userId, result.lastInsertRowid, `Created department: ${name}`, req.ip || 'unknown');

    res.status(201).json(department || { id: result.lastInsertRowid });
  } catch (error: any) {
    if (error.message?.includes('UNIQUE constraint')) {
      res.status(409).json({ error: 'A department with this name or code already exists' });
      return;
    }
    console.error('Create department error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /departments/:id — Update department
router.put('/departments/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM departments WHERE id = ?').get(req.params.id) as any;
    if (!existing) {
      res.status(404).json({ error: 'Department not found' });
      return;
    }

    const fields = ['name', 'code', 'description', 'parent_id', 'manager_id', 'is_active'];
    const bodyKeys = Object.keys(req.body);
    const setClauses: string[] = [];
    const values: any[] = [];

    for (const f of fields) {
      if (bodyKeys.includes(f)) {
        setClauses.push(`${f} = ?`);
        let val = req.body[f];
        if (f === 'is_active') val = val ? 1 : 0;
        values.push(val === '' ? null : val ?? null);
      }
    }

    if (setClauses.length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    setClauses.push('updated_at = ?');
    values.push(localNow());
    values.push(req.params.id);

    db.prepare(`UPDATE departments SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);

    const updated = db.prepare(`
      SELECT d.*, u.full_name as manager_name
      FROM departments d
      LEFT JOIN users u ON d.manager_id = u.id
      WHERE d.id = ?
    `).get(req.params.id);

    res.json(updated);
  } catch (error: any) {
    if (error.message?.includes('UNIQUE constraint')) {
      res.status(409).json({ error: 'A department with this name or code already exists' });
      return;
    }
    console.error('Update department error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /departments/:id — Delete department (only if no users assigned)
router.delete('/departments/:id', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM departments WHERE id = ?').get(req.params.id) as any;
    if (!existing) {
      res.status(404).json({ error: 'Department not found' });
      return;
    }

    // Check if any users are assigned to this department
    const userCount = db.prepare("SELECT COUNT(*) as count FROM users WHERE department = ?").get(existing.name) as any;
    if (userCount.count > 0) {
      res.status(400).json({ error: `Cannot delete department with ${userCount.count} assigned user(s)` });
      return;
    }

    // Check if any child departments reference this as parent
    const childCount = db.prepare('SELECT COUNT(*) as count FROM departments WHERE parent_id = ?').get(existing.id) as any;
    if (childCount.count > 0) {
      res.status(400).json({ error: `Cannot delete department with ${childCount.count} child department(s)` });
      return;
    }

    db.prepare('DELETE FROM departments WHERE id = ?').run(existing.id);

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'department_deleted', 'department', ?, ?, ?)
    `).run(req.user!.userId, existing.id, `Deleted department: ${existing.name}`, req.ip || 'unknown');

    res.json({ message: 'Department deleted' });
  } catch (error: any) {
    console.error('Delete department error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// 5. NOTIFICATION RULES
// ============================================================

// GET /notification-rules — List all rules
router.get('/notification-rules', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rules = db.prepare(`
      SELECT nr.*, u.full_name as created_by_name
      FROM notification_rules nr
      LEFT JOIN users u ON nr.created_by = u.id
      ORDER BY nr.name
    `).all();

    res.json(rules);
  } catch (error: any) {
    console.error('Get notification rules error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /notification-rules — Create rule (admin/manager)
router.post('/notification-rules', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { name, description, trigger_event, conditions, target_roles, target_user_ids, notification_type, is_active } = req.body;

    if (!name || !trigger_event) {
      res.status(400).json({ error: 'name and trigger_event are required' });
      return;
    }

    const now = localNow();
    const conditionsJson = conditions
      ? (typeof conditions === 'string' ? conditions : JSON.stringify(conditions))
      : '{}';
    const rolesJson = target_roles
      ? (typeof target_roles === 'string' ? target_roles : JSON.stringify(target_roles))
      : '[]';
    const userIdsJson = target_user_ids
      ? (typeof target_user_ids === 'string' ? target_user_ids : JSON.stringify(target_user_ids))
      : '[]';

    const result = db.prepare(`
      INSERT INTO notification_rules (name, description, trigger_event, conditions, target_roles, target_user_ids, notification_type, is_active, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      name,
      description || null,
      trigger_event,
      conditionsJson,
      rolesJson,
      userIdsJson,
      notification_type || 'in_app',
      is_active !== undefined ? (is_active ? 1 : 0) : 1,
      req.user!.userId,
      now, now,
    );

    const rule = db.prepare(`
      SELECT nr.*, u.full_name as created_by_name
      FROM notification_rules nr
      LEFT JOIN users u ON nr.created_by = u.id
      WHERE nr.id = ?
    `).get(result.lastInsertRowid);

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'notification_rule_created', 'notification_rule', ?, ?, ?)
    `).run(req.user!.userId, result.lastInsertRowid, `Created notification rule: ${name}`, req.ip || 'unknown');

    res.status(201).json(rule);
  } catch (error: any) {
    console.error('Create notification rule error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /notification-rules/:id — Update rule
router.put('/notification-rules/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM notification_rules WHERE id = ?').get(req.params.id) as any;
    if (!existing) {
      res.status(404).json({ error: 'Notification rule not found' });
      return;
    }

    const fields = ['name', 'description', 'trigger_event', 'conditions', 'target_roles', 'target_user_ids', 'notification_type', 'is_active'];
    const bodyKeys = Object.keys(req.body);
    const setClauses: string[] = [];
    const values: any[] = [];

    for (const f of fields) {
      if (bodyKeys.includes(f)) {
        setClauses.push(`${f} = ?`);
        let val = req.body[f];
        if (['conditions', 'target_roles', 'target_user_ids'].includes(f) && typeof val !== 'string') {
          val = JSON.stringify(val);
        }
        if (f === 'is_active') val = val ? 1 : 0;
        values.push(val === '' ? null : val ?? null);
      }
    }

    if (setClauses.length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    setClauses.push('updated_at = ?');
    values.push(localNow());
    values.push(req.params.id);

    db.prepare(`UPDATE notification_rules SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);

    const updated = db.prepare(`
      SELECT nr.*, u.full_name as created_by_name
      FROM notification_rules nr
      LEFT JOIN users u ON nr.created_by = u.id
      WHERE nr.id = ?
    `).get(req.params.id);

    res.json(updated);
  } catch (error: any) {
    console.error('Update notification rule error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /notification-rules/:id — Delete rule
router.delete('/notification-rules/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM notification_rules WHERE id = ?').get(req.params.id) as any;
    if (!existing) {
      res.status(404).json({ error: 'Notification rule not found' });
      return;
    }

    db.prepare('DELETE FROM notification_rules WHERE id = ?').run(existing.id);

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'notification_rule_deleted', 'notification_rule', ?, ?, ?)
    `).run(req.user!.userId, existing.id, `Deleted notification rule: ${existing.name}`, req.ip || 'unknown');

    res.json({ message: 'Notification rule deleted' });
  } catch (error: any) {
    console.error('Delete notification rule error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /notification-rules/:id/test — Send a test notification using this rule
router.post('/notification-rules/:id/test', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rule = db.prepare('SELECT * FROM notification_rules WHERE id = ?').get(req.params.id) as any;
    if (!rule) {
      res.status(404).json({ error: 'Notification rule not found' });
      return;
    }

    // Determine target users
    const targetUserIds: number[] = [];

    // Add specific user IDs from the rule
    try {
      const userIds = JSON.parse(rule.target_user_ids || '[]');
      if (Array.isArray(userIds)) {
        targetUserIds.push(...userIds);
      }
    } catch { /* ignore parse errors */ }

    // Add users matching target roles
    try {
      const roles = JSON.parse(rule.target_roles || '[]');
      if (Array.isArray(roles) && roles.length > 0) {
        const placeholders = roles.map(() => '?').join(',');
        const roleUsers = db.prepare(
          `SELECT id FROM users WHERE role IN (${placeholders}) AND status = 'active'`
        ).all(...roles) as any[];
        for (const u of roleUsers) {
          if (!targetUserIds.includes(u.id)) {
            targetUserIds.push(u.id);
          }
        }
      }
    } catch { /* ignore parse errors */ }

    // If no targets resolved, send to the requesting user
    if (targetUserIds.length === 0) {
      targetUserIds.push(req.user!.userId);
    }

    // Send test notification to each target user
    let sentCount = 0;
    let emailSentCount = 0;
    const shouldEmail = rule.notification_type === 'email' || rule.notification_type === 'both';

    for (const userId of targetUserIds) {
      try {
        createNotification(
          userId,
          'system',
          `[TEST] ${rule.name}`,
          `Test notification for rule: ${rule.name} (trigger: ${rule.trigger_event})`,
          'notification_rule',
          rule.id,
          'normal',
          rule.trigger_event,
        );
        sentCount++;

        // Also send test email when rule includes email delivery
        if (shouldEmail) {
          sendNotificationEmail(
            userId,
            `[TEST] ${rule.name}`,
            `Test notification for rule: ${rule.name} (trigger: ${rule.trigger_event})`,
          ).then(() => { emailSentCount++; })
           .catch(err => console.error(`[AdminSystems] Test email failed for user ${userId}:`, err.message));
        }
      } catch { /* skip failed sends */ }
    }

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'notification_rule_tested', 'notification_rule', ?, ?, ?)
    `).run(req.user!.userId, rule.id, `Test notification sent to ${sentCount} user(s) for rule: ${rule.name}`, req.ip || 'unknown');

    res.json({ message: `Test notification sent to ${sentCount} user(s)`, sent_to: targetUserIds });
  } catch (error: any) {
    console.error('Test notification rule error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

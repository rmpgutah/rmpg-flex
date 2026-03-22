// ============================================================
// RMPG Flex — Offline Sync API Routes
// Provides endpoints for the Electron desktop app to pull data
// for local caching, push locally-created records, and manage
// offline PIN secrets for the 24-hour override system.
// ============================================================

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { localNow } from '../utils/timeUtils';

const router = Router();

// All offline routes require authentication
router.use(authenticateToken);

// ─── Allowed tables for sync pull ────────────────────────────
// Maps table name → columns to SELECT (controls what the desktop app receives)
const SYNC_TABLES: Record<string, { columns: string; hasUpdatedAt: boolean; limit?: number }> = {
  users: {
    columns: 'id, username, password_hash, first_name, last_name, full_name, email, role, badge_number, phone, status, avatar_url, created_at, updated_at',
    hasUpdatedAt: true,
  },
  clients: {
    columns: 'id, name, contact_name, contact_phone, contact_email, address, status, sla_response_minutes, created_at, updated_at',
    hasUpdatedAt: true,
  },
  properties: {
    columns: 'id, client_id, name, address, latitude, longitude, property_type, gate_code, alarm_code, post_orders, hazard_notes, is_active, created_at, updated_at',
    hasUpdatedAt: true,
  },
  calls_for_service: {
    columns: 'id, call_number, incident_type, priority, status, caller_name, caller_phone, location_address, property_id, client_id, latitude, longitude, description, notes, source, assigned_unit_ids, dispatcher_id, created_at, updated_at, dispatched_at, enroute_at, onscene_at, cleared_at, closed_at, disposition',
    hasUpdatedAt: true,
    limit: 500,
  },
  units: {
    columns: 'id, call_sign, officer_id, officer_name, status, latitude, longitude, current_call_id, last_status_change, capabilities',
    hasUpdatedAt: false,
  },
  incidents: {
    columns: 'id, incident_number, call_id, incident_type, priority, status, location_address, property_id, narrative, officer_id, supervisor_id, created_at, updated_at',
    hasUpdatedAt: true,
    limit: 500,
  },
  time_entries: {
    columns: 'id, officer_id, schedule_id, clock_in, clock_out, clock_in_latitude, clock_in_longitude, clock_out_latitude, clock_out_longitude, total_hours, break_minutes, status',
    hasUpdatedAt: false,
    limit: 200,
  },
  persons: {
    columns: 'id, first_name, last_name, dob, gender, race, address, phone, dl_number, dl_state, flags, notes, created_at, updated_at',
    hasUpdatedAt: true,
    limit: 500,
  },
  vehicles_records: {
    columns: 'id, plate_number, state, make, model, year, color, vin, owner_person_id, flags, stolen_status, created_at, updated_at',
    hasUpdatedAt: true,
    limit: 500,
  },
};

// Reference tables get full replacement (small datasets)
const REFERENCE_TABLES = ['users', 'clients', 'properties'];

// ─── POST /sync/pull ─────────────────────────────────────────
// Returns rows from a table, optionally filtered by updated_at > since
router.post('/sync/pull', (req: Request, res: Response) => {
  try {
    const { table, since, limit: reqLimit } = req.body;
    const db = getDb();

    if (!table || !SYNC_TABLES[table]) {
      res.status(400).json({ error: `Invalid table: ${table}. Allowed: ${Object.keys(SYNC_TABLES).join(', ')}` });
      return;
    }

    const config = SYNC_TABLES[table];
    const isReference = REFERENCE_TABLES.includes(table);
    const maxRows = reqLimit || config.limit || 1000;

    let sql: string;
    let params: any[];

    if (isReference || !since || !config.hasUpdatedAt) {
      // Full pull for reference tables or first sync
      sql = `SELECT ${config.columns} FROM ${table} ORDER BY id ASC LIMIT ?`;
      params = [maxRows];
    } else {
      // Delta pull — only rows changed since last sync
      sql = `SELECT ${config.columns} FROM ${table} WHERE updated_at > ? ORDER BY updated_at ASC LIMIT ?`;
      params = [since, maxRows];
    }

    const rows = db.prepare(sql).all(...params);

    res.json({
      table,
      rows,
      count: rows.length,
      fullReplace: isReference || !since,
      pulledAt: localNow(),
    });
  } catch (error: any) {
    console.error('[OFFLINE] Pull sync error:', error.message);
    res.status(500).json({ error: 'Failed to pull sync data' });
  }
});

// ─── POST /sync/push ─────────────────────────────────────────
// Accepts a batch of locally-created records, inserts them, returns
// the mapping of local_id → server-assigned id
router.post('/sync/push', (req: Request, res: Response) => {
  try {
    const { items } = req.body; // Array of { method, endpoint, body, local_id, table_name }
    const db = getDb();

    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'No items to push' });
      return;
    }

    const results: { local_id: string; server_id?: number; success: boolean; error?: string }[] = [];

    for (const item of items) {
      try {
        if (item.table_name === 'calls_for_service' && item.method === 'POST') {
          const body = typeof item.body === 'string' ? JSON.parse(item.body) : item.body;
          const result = pushCallForService(db, body, req.user!.userId);
          results.push({ local_id: item.local_id, server_id: result.id, success: true });

        } else if (item.table_name === 'incidents' && item.method === 'POST') {
          const body = typeof item.body === 'string' ? JSON.parse(item.body) : item.body;
          const result = pushIncident(db, body, req.user!.userId);
          results.push({ local_id: item.local_id, server_id: result.id, success: true });

        } else if (item.table_name === 'time_entries' && item.method === 'POST') {
          const body = typeof item.body === 'string' ? JSON.parse(item.body) : item.body;
          const result = pushTimeEntry(db, body);
          results.push({ local_id: item.local_id, server_id: result.id, success: true });

        } else if (item.table_name === 'gps_breadcrumbs' && item.method === 'POST') {
          const body = typeof item.body === 'string' ? JSON.parse(item.body) : item.body;
          pushGpsBreadcrumbs(db, body);
          results.push({ local_id: item.local_id, success: true });

        } else if (item.method === 'PUT') {
          // Generic update — parse the endpoint to get table and id
          const body = typeof item.body === 'string' ? JSON.parse(item.body) : item.body;
          pushUpdate(db, item.endpoint, body);
          results.push({ local_id: item.local_id, success: true });

        } else {
          results.push({ local_id: item.local_id, success: false, error: 'Unsupported operation' });
        }
      } catch (err: any) {
        results.push({ local_id: item.local_id, success: false, error: err.message });
      }
    }

    res.json({
      pushed: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results,
    });
  } catch (error: any) {
    console.error('[OFFLINE] Push sync error:', error.message);
    res.status(500).json({ error: 'Failed to push sync data' });
  }
});

// ─── Push Helpers ────────────────────────────────────────────

function pushCallForService(db: any, body: any, userId: number) {
  // Generate a proper call number
  const year = new Date().getFullYear();
  const last = db.prepare(
    `SELECT call_number FROM calls_for_service WHERE call_number LIKE ? ORDER BY id DESC LIMIT 1`
  ).get(`CFS-${year}-%`);
  const seq = last ? parseInt(last.call_number.split('-')[2], 10) + 1 : 1;
  const callNumber = `CFS-${year}-${String(seq).padStart(5, '0')}`;
  const now = localNow();

  const result = db.prepare(`
    INSERT INTO calls_for_service (call_number, incident_type, priority, status, caller_name, caller_phone,
      location_address, property_id, client_id, latitude, longitude, description, notes, source,
      assigned_unit_ids, dispatcher_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    callNumber, body.incident_type, body.priority || 'P3', body.status || 'pending',
    body.caller_name, body.caller_phone, body.location_address,
    body.property_id, body.client_id, body.latitude, body.longitude,
    body.description, body.notes ? JSON.stringify(body.notes) : '[]',
    body.source || 'dispatch', body.assigned_unit_ids ? JSON.stringify(body.assigned_unit_ids) : '[]',
    body.dispatcher_id || userId, now, now
  );

  return { id: result.lastInsertRowid, call_number: callNumber };
}

function pushIncident(db: any, body: any, userId: number) {
  const now = localNow();
  const result = db.prepare(`
    INSERT INTO incidents (incident_type, priority, status, location_address, property_id,
      narrative, officer_id, supervisor_id, call_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    body.incident_type, body.priority || 'P3', body.status || 'draft',
    body.location_address, body.property_id, body.narrative,
    body.officer_id || userId, body.supervisor_id, body.call_id, now, now
  );

  return { id: result.lastInsertRowid };
}

function pushTimeEntry(db: any, body: any) {
  const result = db.prepare(`
    INSERT INTO time_entries (officer_id, schedule_id, clock_in, clock_out,
      clock_in_latitude, clock_in_longitude, clock_out_latitude, clock_out_longitude,
      total_hours, break_minutes, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    body.officer_id, body.schedule_id, body.clock_in, body.clock_out,
    body.clock_in_latitude, body.clock_in_longitude,
    body.clock_out_latitude, body.clock_out_longitude,
    body.total_hours, body.break_minutes || 0, body.status || 'active'
  );

  return { id: result.lastInsertRowid };
}

function pushGpsBreadcrumbs(db: any, body: any) {
  // Body is an array of GPS points
  const points = Array.isArray(body) ? body : (body.points || [body]);
  const stmt = db.prepare(`
    INSERT INTO gps_breadcrumbs (unit_id, officer_id, call_sign, latitude, longitude,
      accuracy, heading, speed, unit_status, recorded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    for (const p of points) {
      stmt.run(p.unit_id, p.officer_id, p.call_sign, p.latitude, p.longitude,
        p.accuracy, p.heading, p.speed, p.unit_status, p.recorded_at);
    }
  });
  tx();
}

function pushUpdate(db: any, endpoint: string, body: any) {
  // Parse endpoint like /api/dispatch/calls/123 or /api/dispatch/units/5
  const parts = endpoint.replace(/^\/api\//, '').split('/');
  // e.g. ['dispatch', 'calls', '123'] or ['dispatch', 'units', '5']
  if (parts.length < 3) return;

  const entityId = parts[parts.length - 1];

  if (parts[0] === 'dispatch' && parts[1] === 'calls') {
    const sets: string[] = [];
    const vals: any[] = [];
    const updatable = ['status', 'priority', 'assigned_unit_ids', 'description', 'disposition',
      'dispatched_at', 'enroute_at', 'onscene_at', 'cleared_at', 'closed_at', 'notes'];
    for (const key of updatable) {
      if (body[key] !== undefined) {
        sets.push(`${key} = ?`);
        vals.push(typeof body[key] === 'object' ? JSON.stringify(body[key]) : body[key]);
      }
    }
    if (sets.length > 0) {
      sets.push('updated_at = ?');
      vals.push(localNow());
      vals.push(entityId);
      db.prepare(`UPDATE calls_for_service SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    }

  } else if (parts[0] === 'dispatch' && parts[1] === 'units') {
    const sets: string[] = [];
    const vals: any[] = [];
    const updatable = ['status', 'latitude', 'longitude', 'current_call_id', 'last_status_change'];
    for (const key of updatable) {
      if (body[key] !== undefined) {
        sets.push(`${key} = ?`);
        vals.push(body[key]);
      }
    }
    if (sets.length > 0) {
      vals.push(entityId);
      db.prepare(`UPDATE units SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    }
  }
}

// ─── GET /secrets (admin only) ───────────────────────────────
// Returns all user offline secrets for the admin's local cache
router.get('/secrets', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const secrets = db.prepare(`
      SELECT ops.user_id, ops.secret, u.username, u.full_name, u.role
      FROM offline_pin_secrets ops
      JOIN users u ON u.id = ops.user_id
      WHERE u.status = 'active'
    `).all();

    // Also include the admin_secret (stored under the admin's own user_id)
    const adminSecret = db.prepare(
      `SELECT secret FROM offline_pin_secrets WHERE user_id = ?`
    ).get(req.user!.userId) as { secret: string } | undefined;

    res.json({
      secrets,
      admin_secret: adminSecret ? adminSecret.secret : null,
    });
  } catch (error: any) {
    console.error('[OFFLINE] Get secrets error:', error.message);
    res.status(500).json({ error: 'Failed to get offline secrets' });
  }
});

// ─── GET /my-secret ──────────────────────────────────────────
// Returns the requesting user's own offline secret
router.get('/my-secret', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const row = db.prepare(
      'SELECT secret FROM offline_pin_secrets WHERE user_id = ?'
    ).get(req.user!.userId);

    // Also get the admin secret (needed for local PIN validation)
    const adminUser = db.prepare(
      `SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1`
    ).get() as any;
    const adminSecret = adminUser
      ? db.prepare('SELECT secret FROM offline_pin_secrets WHERE user_id = ?').get(adminUser.id)
      : null;

    res.json({
      secret: row ? (row as any).secret : null,
      admin_secret: adminSecret ? (adminSecret as any).secret : null,
    });
  } catch (error: any) {
    console.error('[OFFLINE] Get my-secret error:', error.message);
    res.status(500).json({ error: 'Failed to get offline secret' });
  }
});

// ─── POST /secrets/generate ──────────────────────────────────
// Generate or rotate an offline secret for a user (admin only)
router.post('/secrets/generate', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const { userId } = req.body;
    const db = getDb();

    if (!userId) {
      res.status(400).json({ error: 'userId is required' });
      return;
    }

    // Verify user exists
    const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Generate a 32-byte random hex secret
    const secret = crypto.randomBytes(32).toString('hex');
    const now = localNow();

    db.prepare(`
      INSERT INTO offline_pin_secrets (user_id, secret, created_at)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET secret = excluded.secret, rotated_at = ?
    `).run(userId, secret, now, now);

    res.json({ userId, secret, generated_at: now });
  } catch (error: any) {
    console.error('[OFFLINE] Generate secret error:', error.message);
    res.status(500).json({ error: 'Failed to generate offline secret' });
  }
});

// ─── POST /secrets/generate-all ──────────────────────────────
// Generate offline secrets for all active users who don't have one
router.post('/secrets/generate-all', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const users = db.prepare(
      `SELECT id FROM users WHERE status = 'active' AND id NOT IN (SELECT user_id FROM offline_pin_secrets)`
    ).all() as any[];

    const now = localNow();
    const stmt = db.prepare(`
      INSERT INTO offline_pin_secrets (user_id, secret, created_at) VALUES (?, ?, ?)
    `);

    const tx = db.transaction(() => {
      for (const u of users) {
        const secret = crypto.randomBytes(32).toString('hex');
        stmt.run(u.id, secret, now);
      }
    });
    tx();

    res.json({ generated: users.length });
  } catch (error: any) {
    console.error('[OFFLINE] Generate-all error:', error.message);
    res.status(500).json({ error: 'Failed to generate offline secrets' });
  }
});

export default router;

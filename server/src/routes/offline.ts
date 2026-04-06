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
<<<<<<< HEAD
import { rateLimit } from '../middleware/rateLimiter';
import { sanitizeObject } from '../middleware/sanitize';
=======
>>>>>>> origin/main
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
  citations: {
    columns: 'id, citation_number, type, status, person_id, person_name, person_dob, person_dl, person_address, vehicle_description, vehicle_plate, vehicle_state, statute_id, statute_citation, violation_description, offense_level, fine_amount, violation_date, violation_time, location, incident_id, call_id, issuing_officer_id, issuing_officer_name, badge_number, court_date, court_name, court_address, notes, created_at, updated_at',
    hasUpdatedAt: true,
    limit: 500,
  },
  field_interviews: {
    columns: 'id, fi_number, person_id, subject_first_name, subject_last_name, subject_dob, subject_gender, subject_race, subject_height, subject_weight, subject_hair, subject_eye, subject_clothing, subject_description, location, latitude, longitude, property_id, contact_reason, contact_type, action_taken, narrative, vehicle_plate, vehicle_description, vehicle_id, associated_call_id, associated_incident_id, officer_id, officer_name, status, created_at, archived_at',
    hasUpdatedAt: false,
    limit: 500,
  },
  evidence: {
    columns: 'id, evidence_number, incident_id, description, evidence_type, category, storage_location, collected_by, status, chain_of_custody, location_found, condition, quantity, collected_date, notes, created_at, updated_at',
    hasUpdatedAt: true,
    limit: 500,
  },
  criminal_history: {
    columns: 'id, person_id, record_type, offense, offense_level, statute, case_number, agency, jurisdiction, offense_date, disposition, disposition_date, sentence, source, notes, created_by, created_at, updated_at',
    hasUpdatedAt: true,
    limit: 500,
  },
  patrol_scans: {
    columns: 'id, checkpoint_id, officer_id, scanned_at, latitude, longitude, notes, status',
    hasUpdatedAt: false,
    limit: 200,
  },
  patrol_checkpoints: {
    columns: 'id, property_id, name, description, latitude, longitude, qr_code, sequence_order, scan_required_interval_minutes, is_active, created_at',
    hasUpdatedAt: false,
    limit: 200,
  },
  trespass_orders: {
    columns: 'id, order_number, person_id, subject_first_name, subject_last_name, subject_dob, subject_description, property_id, property_name, location, order_type, status, reason, conditions, duration_days, effective_date, expiration_date, served_at, served_by, originating_call_id, originating_incident_id, issued_by, issued_by_name, authorized_by, notes, archived_at, created_at, updated_at',
    hasUpdatedAt: true,
    limit: 500,
  },
  warrants: {
    columns: 'id, warrant_number, type, status, subject_person_id, issuing_court, issuing_judge, charge_description, bail_amount, offense_level, entered_by, served_by, served_at, served_location, expires_at, notes, created_at, updated_at',
    hasUpdatedAt: true,
    limit: 500,
  },
};

// Reference tables get full replacement (small datasets)
const REFERENCE_TABLES = ['users', 'clients', 'properties', 'patrol_checkpoints'];

// Stricter rate limit for sync endpoints — 30 requests per minute per user
const syncRateLimit = rateLimit({
  windowMs: 60_000,
  maxRequests: 30,
  keyGenerator: (req: Request) => `sync:${req.user?.userId || req.ip}`,
  message: 'Sync rate limit exceeded — try again shortly',
});

// ─── POST /sync/pull ─────────────────────────────────────────
// Returns rows from a table, optionally filtered by updated_at > since
router.post('/sync/pull', syncRateLimit, (req: Request, res: Response) => {
  try {
    const { table, since, limit: reqLimit } = req.body;
    const db = getDb();

    if (!table || !SYNC_TABLES[table]) {
<<<<<<< HEAD
      res.status(400).json({ error: 'Invalid or unrecognized table name' });
      return;
    }

    // PII-heavy tables restricted to supervisor+ roles
    if (PII_TABLES.has(table) && !['admin', 'manager', 'supervisor'].includes(role)) {
      res.status(403).json({ error: `Access to ${table} sync requires supervisor or higher role` });
=======
      res.status(400).json({ error: `Invalid table: ${table}. Allowed: ${Object.keys(SYNC_TABLES).join(', ')}`, code: 'INVALID_TABLE' });
>>>>>>> origin/main
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
    res.status(500).json({ error: 'Failed to pull sync data', code: 'FAILED_TO_PULL_SYNC' });
  }
});

// ─── POST /sync/push ─────────────────────────────────────────
// Accepts a batch of locally-created records, inserts them, returns
// the mapping of local_id → server-assigned id
router.post('/sync/push', syncRateLimit, (req: Request, res: Response) => {
  try {
    const { items } = req.body; // Array of { method, endpoint, body, local_id, table_name }
    const db = getDb();

    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'No items to push', code: 'NO_ITEMS_TO_PUSH' });
      return;
    }

    if (items.length > 100) {
      res.status(400).json({ error: 'Batch size exceeds maximum of 100 items' });
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

        } else if (item.table_name === 'citations' && item.method === 'POST') {
          const body = typeof item.body === 'string' ? JSON.parse(item.body) : item.body;
          const result = pushCitation(db, body, req.user!.userId);
          results.push({ local_id: item.local_id, server_id: result.id, success: true });

        } else if (item.table_name === 'field_interviews' && item.method === 'POST') {
          const body = typeof item.body === 'string' ? JSON.parse(item.body) : item.body;
          const result = pushFieldInterview(db, body, req.user!.userId);
          results.push({ local_id: item.local_id, server_id: result.id, success: true });

        } else if (item.table_name === 'evidence' && item.method === 'POST') {
          const body = typeof item.body === 'string' ? JSON.parse(item.body) : item.body;
          const result = pushEvidence(db, body, req.user!.userId);
          results.push({ local_id: item.local_id, server_id: result.id, success: true });

        } else if (item.table_name === 'criminal_history' && item.method === 'POST') {
          const body = typeof item.body === 'string' ? JSON.parse(item.body) : item.body;
          const result = pushCriminalHistory(db, body, req.user!.userId);
          results.push({ local_id: item.local_id, server_id: result.id, success: true });

        } else if (item.table_name === 'patrol_scans' && item.method === 'POST') {
          const body = typeof item.body === 'string' ? JSON.parse(item.body) : item.body;
          const result = pushPatrolScan(db, body, req.user!.userId);
          results.push({ local_id: item.local_id, server_id: result.id, success: true });

        } else if (item.table_name === 'trespass_orders' && item.method === 'POST') {
          const body = typeof item.body === 'string' ? JSON.parse(item.body) : item.body;
          const result = pushTrespassOrder(db, body, req.user!.userId);
          results.push({ local_id: item.local_id, server_id: result.id, success: true });

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
    res.status(500).json({ error: 'Failed to push sync data', code: 'FAILED_TO_PUSH_SYNC' });
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

function pushCitation(db: any, body: any, userId: number) {
  const year = new Date().getFullYear();
  const last = db.prepare(
    `SELECT citation_number FROM citations WHERE citation_number LIKE ? ORDER BY id DESC LIMIT 1`
  ).get(`CIT-${year}-%`);
  const seq = last ? parseInt(last.citation_number.split('-')[2], 10) + 1 : 1;
  const citationNumber = `CIT-${year}-${String(seq).padStart(5, '0')}`;
  const now = localNow();

  const result = db.prepare(`
    INSERT INTO citations (citation_number, type, status, person_id, person_name, person_dob, person_dl,
      person_address, vehicle_description, vehicle_plate, vehicle_state, statute_id, statute_citation,
      violation_description, offense_level, fine_amount, violation_date, violation_time, location,
      incident_id, call_id, issuing_officer_id, issuing_officer_name, badge_number,
      court_date, court_name, court_address, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    citationNumber, body.type || 'traffic', body.status || 'issued',
    body.person_id, body.person_name, body.person_dob, body.person_dl,
    body.person_address, body.vehicle_description, body.vehicle_plate, body.vehicle_state,
    body.statute_id, body.statute_citation, body.violation_description, body.offense_level,
    body.fine_amount, body.violation_date || now, body.violation_time, body.location,
    body.incident_id, body.call_id, body.issuing_officer_id || userId,
    body.issuing_officer_name, body.badge_number,
    body.court_date, body.court_name, body.court_address, body.notes, now, now
  );

  return { id: result.lastInsertRowid, citation_number: citationNumber };
}

function pushFieldInterview(db: any, body: any, userId: number) {
  const year = new Date().getFullYear();
  const last = db.prepare(
    `SELECT fi_number FROM field_interviews WHERE fi_number LIKE ? ORDER BY id DESC LIMIT 1`
  ).get(`FI-${year}-%`);
  const seq = last ? parseInt(last.fi_number.split('-')[2], 10) + 1 : 1;
  const fiNumber = `FI-${year}-${String(seq).padStart(5, '0')}`;
  const now = localNow();

  const result = db.prepare(`
    INSERT INTO field_interviews (fi_number, person_id, subject_first_name, subject_last_name,
      subject_dob, subject_gender, subject_race, subject_height, subject_weight, subject_hair,
      subject_eye, subject_clothing, subject_description, location, latitude, longitude,
      property_id, contact_reason, contact_type, action_taken, narrative,
      vehicle_plate, vehicle_description, vehicle_id, associated_call_id, associated_incident_id,
      officer_id, officer_name, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    fiNumber, body.person_id, body.subject_first_name, body.subject_last_name,
    body.subject_dob, body.subject_gender, body.subject_race, body.subject_height,
    body.subject_weight, body.subject_hair, body.subject_eye, body.subject_clothing,
    body.subject_description, body.location, body.latitude, body.longitude,
    body.property_id, body.contact_reason || 'other', body.contact_type || 'field',
    body.action_taken || 'none', body.narrative,
    body.vehicle_plate, body.vehicle_description, body.vehicle_id,
    body.associated_call_id, body.associated_incident_id,
    body.officer_id || userId, body.officer_name, body.status || 'active', now
  );

  return { id: result.lastInsertRowid, fi_number: fiNumber };
}

function pushEvidence(db: any, body: any, userId: number) {
  const year = new Date().getFullYear();
  const last = db.prepare(
    `SELECT evidence_number FROM evidence WHERE evidence_number LIKE ? ORDER BY id DESC LIMIT 1`
  ).get(`EV-${year}-%`);
  const seq = last ? parseInt(last.evidence_number.split('-')[2], 10) + 1 : 1;
  const evidenceNumber = `EV-${year}-${String(seq).padStart(5, '0')}`;
  const now = localNow();

  const result = db.prepare(`
    INSERT INTO evidence (evidence_number, incident_id, description, evidence_type, category,
      storage_location, collected_by, status, chain_of_custody, location_found, condition,
      quantity, collected_date, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    evidenceNumber, body.incident_id, body.description, body.evidence_type, body.category,
    body.storage_location, body.collected_by || userId, body.status || 'received',
    body.chain_of_custody ? JSON.stringify(body.chain_of_custody) : '[]',
    body.location_found, body.condition, body.quantity || 1,
    body.collected_date || now, body.notes, now, now
  );

  return { id: result.lastInsertRowid, evidence_number: evidenceNumber };
}

function pushCriminalHistory(db: any, body: any, userId: number) {
  const now = localNow();

  const result = db.prepare(`
    INSERT INTO criminal_history (person_id, record_type, offense, offense_level, statute,
      case_number, agency, jurisdiction, offense_date, disposition, disposition_date,
      sentence, source, notes, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    body.person_id, body.record_type || 'arrest', body.offense, body.offense_level,
    body.statute, body.case_number, body.agency || 'RMPG', body.jurisdiction,
    body.offense_date || now, body.disposition, body.disposition_date,
    body.sentence, body.source || 'field', body.notes,
    body.created_by || userId, now, now
  );

  return { id: result.lastInsertRowid };
}

function pushPatrolScan(db: any, body: any, userId: number) {
  const now = localNow();

  const result = db.prepare(`
    INSERT INTO patrol_scans (checkpoint_id, officer_id, scanned_at, latitude, longitude, notes, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    body.checkpoint_id, body.officer_id || userId, body.scanned_at || now,
    body.latitude, body.longitude, body.notes, body.status || 'on_time'
  );

  return { id: result.lastInsertRowid };
}

function pushTrespassOrder(db: any, body: any, userId: number) {
  const year = new Date().getFullYear();
  const last = db.prepare(
    `SELECT order_number FROM trespass_orders WHERE order_number LIKE ? ORDER BY id DESC LIMIT 1`
  ).get(`TO-${year}-%`);
  const seq = last ? parseInt(last.order_number.split('-')[2], 10) + 1 : 1;
  const orderNumber = `TO-${year}-${String(seq).padStart(5, '0')}`;
  const now = localNow();

  const result = db.prepare(`
    INSERT INTO trespass_orders (order_number, person_id, subject_first_name, subject_last_name,
      subject_dob, subject_description, property_id, property_name, location, order_type, status,
      reason, conditions, duration_days, effective_date, expiration_date, served_at, served_by,
      originating_call_id, originating_incident_id, issued_by, issued_by_name, authorized_by,
      notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    orderNumber, body.person_id, body.subject_first_name, body.subject_last_name,
    body.subject_dob, body.subject_description, body.property_id, body.property_name,
    body.location, body.order_type || 'trespass_warning', body.status || 'active',
    body.reason, body.conditions, body.duration_days,
    body.effective_date || now, body.expiration_date, body.served_at, body.served_by,
    body.originating_call_id, body.originating_incident_id,
    body.issued_by || userId, body.issued_by_name, body.authorized_by,
    body.notes, now, now
  );

  return { id: result.lastInsertRowid, order_number: orderNumber };
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
    
      LIMIT 1000
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
    res.status(500).json({ error: 'Failed to get offline secrets', code: 'FAILED_TO_GET_OFFLINE' });
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
    res.status(500).json({ error: 'Failed to get offline secret', code: 'FAILED_TO_GET_OFFLINE' });
  }
});

// ─── POST /secrets/generate ──────────────────────────────────
// Generate or rotate an offline secret for a user (admin only)
router.post('/secrets/generate', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const { userId } = req.body;
    const db = getDb();

    if (!userId) {
      res.status(400).json({ error: 'userId is required', code: 'USERID_IS_REQUIRED' });
      return;
    }

    // Verify user exists
    const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId);
    if (!user) {
      res.status(404).json({ error: 'User not found', code: 'USER_NOT_FOUND' });
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
    res.status(500).json({ error: 'Failed to generate offline secret', code: 'FAILED_TO_GENERATE_OFFLINE' });
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
    res.status(500).json({ error: 'Failed to generate offline secrets', code: 'FAILED_TO_GENERATE_OFFLINE' });
  }
});

export default router;

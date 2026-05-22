// ============================================================
// RMPG Flex — Offline Sync API Routes (Cloudflare Workers)
// Ported from server/src/routes/offline.ts for Workers runtime.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { D1Db, localNow, safeStr } from '../worker-middleware/d1Helpers';

export function mountOfflineRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();

  api.use('/*', authenticateToken);

  // ─── Sync Tables Config ─────────────────────────────────
  const SYNC_TABLES: Record<string, { columns: string; hasUpdatedAt: boolean; limit?: number }> = {
    users: { columns: 'id, username, password_hash, first_name, last_name, full_name, email, role, badge_number, phone, status, avatar_url, created_at, updated_at', hasUpdatedAt: true },
    clients: { columns: 'id, name, contact_name, contact_phone, contact_email, address, status, sla_response_minutes, created_at, updated_at', hasUpdatedAt: true },
    properties: { columns: 'id, client_id, name, address, latitude, longitude, property_type, gate_code, alarm_code, post_orders, hazard_notes, is_active, created_at, updated_at', hasUpdatedAt: true },
    calls_for_service: { columns: 'id, call_number, incident_type, priority, status, caller_name, caller_phone, location_address, property_id, client_id, latitude, longitude, description, notes, source, assigned_unit_ids, dispatcher_id, created_at, updated_at, dispatched_at, enroute_at, onscene_at, cleared_at, closed_at, disposition', hasUpdatedAt: true, limit: 500 },
    units: { columns: 'id, call_sign, officer_id, officer_name, status, latitude, longitude, current_call_id, last_status_change, capabilities', hasUpdatedAt: false },
    incidents: { columns: 'id, incident_number, call_id, incident_type, priority, status, location_address, property_id, narrative, officer_id, supervisor_id, created_at, updated_at', hasUpdatedAt: true, limit: 500 },
    time_entries: { columns: 'id, officer_id, schedule_id, clock_in, clock_out, clock_in_latitude, clock_in_longitude, clock_out_latitude, clock_out_longitude, total_hours, break_minutes, status', hasUpdatedAt: false, limit: 200 },
    persons: { columns: 'id, first_name, last_name, middle_name, alias_nickname, dob, gender, race, height, height_feet, height_inches, weight, build, complexion, hair_color, eye_color, scars_marks_tattoos, clothing_description, address, city, state, zip, phone, email, dl_number, dl_state, dl_expiry, dl_class, ssn_last4, id_image_url, id_type, id_number, id_state, id_expiry, employer, occupation, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship, gang_affiliation, is_sex_offender, is_veteran, language, place_of_birth, citizenship, marital_status, hair_length, hair_style, facial_hair, glasses, shoe_size, blood_type, phone_secondary, social_media, probation_parole, probation_parole_officer, known_associates, caution_flags, photo_url, ncic_number, sor_number, fbi_number, state_id_number, passport_number, passport_country, immigration_status, disability_flags, mental_health_flags, substance_abuse, medication_notes, education_level, military_branch, military_status, tribal_affiliation, identifying_marks_location, tattoo_description, scar_description, piercing_description, distinguishing_features, email_secondary, date_last_seen, location_last_seen, alias_dob, home_phone, work_phone, watchlist_match, watchlist_checked_at, flags, notes, created_at, updated_at', hasUpdatedAt: true, limit: 500 },
    vehicles_records: { columns: 'id, plate_number, state, make, model, year, color, secondary_color, body_style, doors, vin, owner_person_id, owner_name, owner_address, owner_phone, owner_dl_number, owner_dob, registered_owner, primary_driver_name, insurance_company, insurance_policy, insurance_expiry, registration_expiry, registration_state, damage_description, distinguishing_features, trim, engine_type, fuel_type, transmission, drive_type, tow_status, tow_company, tow_date, tow_location, plate_type, commercial_vehicle, hazmat, odometer, lien_holder, stolen_status, stolen_date, recovery_date, title_status, exterior_condition, interior_condition, estimated_value, window_tint, modifications, equipment_notes, vehicle_use, ncic_entry_number, flags, notes, created_at, updated_at', hasUpdatedAt: true, limit: 500 },
    citations: { columns: 'id, citation_number, type, status, person_id, person_name, person_dob, person_dl, person_address, vehicle_description, vehicle_plate, vehicle_state, statute_id, statute_citation, violation_description, offense_level, fine_amount, violation_date, violation_time, location, incident_id, call_id, issuing_officer_id, issuing_officer_name, badge_number, court_date, court_name, court_address, notes, created_at, updated_at', hasUpdatedAt: true, limit: 500 },
    field_interviews: { columns: 'id, fi_number, person_id, subject_first_name, subject_last_name, subject_dob, subject_gender, subject_race, subject_height, subject_weight, subject_hair, subject_eye, subject_clothing, subject_description, location, latitude, longitude, property_id, contact_reason, contact_type, action_taken, narrative, vehicle_plate, vehicle_description, vehicle_id, associated_call_id, associated_incident_id, officer_id, officer_name, status, created_at, archived_at', hasUpdatedAt: false, limit: 500 },
    evidence: { columns: 'id, evidence_number, incident_id, description, evidence_type, category, storage_location, collected_by, status, chain_of_custody, location_found, condition, quantity, collected_date, notes, created_at, updated_at', hasUpdatedAt: true, limit: 500 },
    criminal_history: { columns: 'id, person_id, record_type, offense, offense_level, statute, case_number, agency, jurisdiction, offense_date, disposition, disposition_date, sentence, source, notes, created_by, created_at, updated_at', hasUpdatedAt: true, limit: 500 },
    patrol_scans: { columns: 'id, checkpoint_id, officer_id, scanned_at, latitude, longitude, notes, status', hasUpdatedAt: false, limit: 200 },
    patrol_checkpoints: { columns: 'id, property_id, name, description, latitude, longitude, qr_code, sequence_order, scan_required_interval_minutes, is_active, created_at', hasUpdatedAt: false, limit: 200 },
    trespass_orders: { columns: 'id, order_number, person_id, subject_first_name, subject_last_name, subject_dob, subject_description, property_id, property_name, location, order_type, status, reason, conditions, duration_days, effective_date, expiration_date, served_at, served_by, originating_call_id, originating_incident_id, issued_by, issued_by_name, authorized_by, notes, archived_at, created_at, updated_at', hasUpdatedAt: true, limit: 500 },
    warrants: { columns: 'id, warrant_number, type, status, subject_person_id, issuing_court, issuing_judge, charge_description, bail_amount, offense_level, entered_by, served_by, served_at, served_location, expires_at, notes, created_at, updated_at', hasUpdatedAt: true, limit: 500 },
  };

  const REFERENCE_TABLES = ['users', 'clients', 'properties', 'patrol_checkpoints'];
  const VALID_TABLES = new Set(Object.keys(SYNC_TABLES));

  // ─── POST /sync/pull ──────────────────────────────────
  api.post('/sync/pull', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const { table, since, limit: reqLimit } = await c.req.json();
      if (!table || !VALID_TABLES.has(table)) {
        return c.json({ error: `Invalid table: ${table}`, code: 'INVALID_TABLE' }, 400);
      }
      const config = SYNC_TABLES[table];
      const isReference = REFERENCE_TABLES.includes(table);
      const maxRows = reqLimit || config.limit || 1000;
      let sql: string;
      let params: any[];
      if (isReference || !since || !config.hasUpdatedAt) {
        sql = `SELECT ${config.columns} FROM ${table} ORDER BY id ASC LIMIT ?`;
        params = [maxRows];
      } else {
        sql = `SELECT ${config.columns} FROM ${table} WHERE updated_at > ? ORDER BY updated_at ASC LIMIT ?`;
        params = [since, maxRows];
      }
      const rows = await db.prepare(sql).all(...params);
      return c.json({
        table,
        rows,
        count: rows.length,
        fullReplace: isReference || !since,
        pulledAt: localNow(),
      });
    } catch (err: any) {
      console.error('[OFFLINE] Pull sync error:', err?.message || err);
      if (err?.message?.includes('no such table')) return c.json({ table: '', rows: [], count: 0, fullReplace: false, pulledAt: localNow() });
      return c.json({ error: 'Failed to pull sync data', code: 'FAILED_TO_PULL_SYNC' }, 500);
    }
  });

  // ─── POST /sync/push ──────────────────────────────────
  api.post('/sync/push', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const { items } = await c.req.json();
      if (!Array.isArray(items) || items.length === 0) {
        return c.json({ error: 'No items to push', code: 'NO_ITEMS_TO_PUSH' }, 400);
      }
      const results: { local_id: string; server_id?: number | null; success: boolean; error?: string }[] = [];
      for (const item of items) {
        try {
          const body = typeof item.body === 'string' ? JSON.parse(item.body) : item.body;
          if (item.table_name === 'calls_for_service' && item.method === 'POST') {
            const result = await pushCallForService(db, body, user.userId);
            results.push({ local_id: item.local_id, server_id: result.id, success: true });
          } else if (item.table_name === 'incidents' && item.method === 'POST') {
            const result = await pushIncident(db, body, user.userId);
            results.push({ local_id: item.local_id, server_id: result.id, success: true });
          } else if (item.table_name === 'time_entries' && item.method === 'POST') {
            const result = await pushTimeEntry(db, body);
            results.push({ local_id: item.local_id, server_id: result.id, success: true });
          } else if (item.table_name === 'gps_breadcrumbs' && item.method === 'POST') {
            await pushGpsBreadcrumbs(db, body);
            results.push({ local_id: item.local_id, success: true });
          } else if (item.table_name === 'citations' && item.method === 'POST') {
            const result = await pushCitation(db, body, user.userId);
            results.push({ local_id: item.local_id, server_id: result.id, success: true });
          } else if (item.table_name === 'field_interviews' && item.method === 'POST') {
            const result = await pushFieldInterview(db, body, user.userId);
            results.push({ local_id: item.local_id, server_id: result.id, success: true });
          } else if (item.table_name === 'evidence' && item.method === 'POST') {
            const result = await pushEvidence(db, body, user.userId);
            results.push({ local_id: item.local_id, server_id: result.id, success: true });
          } else if (item.table_name === 'criminal_history' && item.method === 'POST') {
            const result = await pushCriminalHistory(db, body, user.userId);
            results.push({ local_id: item.local_id, server_id: result.id, success: true });
          } else if (item.table_name === 'patrol_scans' && item.method === 'POST') {
            const result = await pushPatrolScan(db, body, user.userId);
            results.push({ local_id: item.local_id, server_id: result.id, success: true });
          } else if (item.table_name === 'trespass_orders' && item.method === 'POST') {
            const result = await pushTrespassOrder(db, body, user.userId);
            results.push({ local_id: item.local_id, server_id: result.id, success: true });
          } else if (item.table_name === 'persons' && item.method === 'POST') {
            const result = await pushPerson(db, body);
            results.push({ local_id: item.local_id, server_id: result.id, success: true });
          } else if (item.table_name === 'vehicles_records' && item.method === 'POST') {
            const result = await pushVehicle(db, body);
            results.push({ local_id: item.local_id, server_id: result.id, success: true });
          } else if (item.method === 'PUT') {
            await pushUpdate(db, item.endpoint, body);
            results.push({ local_id: item.local_id, success: true });
          } else {
            results.push({ local_id: item.local_id, success: false, error: 'Unsupported operation' });
          }
        } catch (err: any) {
          results.push({ local_id: item.local_id, success: false, error: err.message });
        }
      }
      return c.json({
        pushed: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        results,
      });
    } catch (err: any) {
      console.error('[OFFLINE] Push sync error:', err?.message || err);
      return c.json({ error: 'Failed to push sync data', code: 'FAILED_TO_PUSH_SYNC' }, 500);
    }
  });

  // ─── GET /secrets (admin only) ────────────────────────
  api.get('/secrets', requireRole('admin'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const secrets = await db.prepare(`
        SELECT ops.user_id, ops.secret, u.username, u.full_name, u.role
        FROM offline_pin_secrets ops
        JOIN users u ON u.id = ops.user_id
        WHERE u.status = 'active'
        ORDER BY u.full_name ASC LIMIT 1000
      `).all();
      const adminSecret = await db.prepare(
        'SELECT secret FROM offline_pin_secrets WHERE user_id = ?'
      ).get(user.userId) as { secret: string } | undefined;
      return c.json({ secrets, admin_secret: adminSecret?.secret || null });
    } catch (err: any) {
      console.error('[OFFLINE] Get secrets error:', err?.message || err);
      return c.json({ error: 'Failed to get offline secrets', code: 'FAILED_TO_GET_OFFLINE' }, 500);
    }
  });

  // ─── GET /my-secret ───────────────────────────────────
  api.get('/my-secret', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const row = await db.prepare(
        'SELECT secret FROM offline_pin_secrets WHERE user_id = ?'
      ).get(user.userId) as { secret: string } | undefined;
      const adminUser = await db.prepare(
        "SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1"
      ).get() as any;
      let adminSecret: string | null = null;
      if (adminUser) {
        const as = await db.prepare('SELECT secret FROM offline_pin_secrets WHERE user_id = ?')
          .get(adminUser.id) as { secret: string } | undefined;
        adminSecret = as?.secret || null;
      }
      return c.json({ secret: row?.secret || null, admin_secret: adminSecret });
    } catch (err: any) {
      console.error('[OFFLINE] Get my-secret error:', err?.message || err);
      return c.json({ error: 'Failed to get offline secret', code: 'FAILED_TO_GET_OFFLINE' }, 500);
    }
  });

  // ─── POST /secrets/generate ───────────────────────────
  api.post('/secrets/generate', requireRole('admin'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const { userId } = await c.req.json();
      if (!userId) return c.json({ error: 'userId is required', code: 'USERID_IS_REQUIRED' }, 400);
      const user = await db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId);
      if (!user) return c.json({ error: 'User not found', code: 'USER_NOT_FOUND' }, 404);
      const secretBytes = new Uint8Array(32);
      crypto.getRandomValues(secretBytes);
      const secret = Array.from(secretBytes).map(b => b.toString(16).padStart(2, '0')).join('');
      const now = localNow();
      await db.prepare(`
        INSERT INTO offline_pin_secrets (user_id, secret, created_at)
        VALUES (?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET secret = excluded.secret, rotated_at = ?
      `).run(userId, secret, now, now);
      return c.json({ userId, secret, generated_at: now });
    } catch (err: any) {
      console.error('[OFFLINE] Generate secret error:', err?.message || err);
      return c.json({ error: 'Failed to generate offline secret', code: 'FAILED_TO_GENERATE_OFFLINE' }, 500);
    }
  });

  // ─── POST /secrets/generate-all ───────────────────────
  api.post('/secrets/generate-all', requireRole('admin'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const users = await db.prepare(
        "SELECT id FROM users WHERE status = 'active' AND id NOT IN (SELECT user_id FROM offline_pin_secrets)"
      ).all() as { id: number }[];
      const now = localNow();
      let generated = 0;
      for (const u of users) {
        const secretBytes = new Uint8Array(32);
        crypto.getRandomValues(secretBytes);
        const secret = Array.from(secretBytes).map(b => b.toString(16).padStart(2, '0')).join('');
        await db.prepare('INSERT INTO offline_pin_secrets (user_id, secret, created_at) VALUES (?, ?, ?)').run(u.id, secret, now);
        generated++;
      }
      return c.json({ generated });
    } catch (err: any) {
      console.error('[OFFLINE] Generate-all error:', err?.message || err);
      return c.json({ error: 'Failed to generate offline secrets', code: 'FAILED_TO_GENERATE_OFFLINE' }, 500);
    }
  });

  // Mount at /api/offline
  app.route('/api/offline', api);
}

// ─── Push Helpers ─────────────────────────────────────────

async function pushCallForService(db: D1Db, body: any, userId: number) {
  const year = new Date().getFullYear();
  const last = await db.prepare(
    "SELECT call_number FROM calls_for_service WHERE call_number LIKE ? ORDER BY id DESC LIMIT 1"
  ).get(`CFS-${year}-%`) as { call_number: string } | undefined;
  const seq = last ? parseInt(last.call_number.split('-')[2], 10) + 1 : 1;
  const callNumber = `CFS-${year}-${String(seq).padStart(5, '0')}`;
  const now = localNow();
  const result = await db.prepare(`
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
  return { id: result.meta.last_row_id, call_number: callNumber };
}

async function pushIncident(db: D1Db, body: any, userId: number) {
  const now = localNow();
  const result = await db.prepare(`
    INSERT INTO incidents (incident_type, priority, status, location_address, property_id,
      narrative, officer_id, supervisor_id, call_id,
      alcohol_involved, drugs_involved, domestic_violence, weapons_involved,
      injuries_reported, mental_health_crisis, juvenile_involved, felony_in_progress,
      officer_safety_caution, k9_requested, ems_requested, fire_requested,
      hazmat, gang_related, evidence_collected, body_camera_active, photos_taken,
      trespass_issued, vehicle_pursuit, foot_pursuit, le_notified, supervisor_notified,
      created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?)
  `).run(
    body.incident_type, body.priority || 'P3', body.status || 'draft',
    body.location_address, body.property_id, body.narrative,
    body.officer_id || userId, body.supervisor_id, body.call_id,
    body.alcohol_involved ? 1 : 0, body.drugs_involved ? 1 : 0,
    body.domestic_violence ? 1 : 0, body.weapons_involved || null,
    body.injuries_reported ? 1 : 0, body.mental_health_crisis ? 1 : 0,
    body.juvenile_involved ? 1 : 0, body.felony_in_progress ? 1 : 0,
    body.officer_safety_caution ? 1 : 0, body.k9_requested ? 1 : 0,
    body.ems_requested ? 1 : 0, body.fire_requested ? 1 : 0,
    body.hazmat ? 1 : 0, body.gang_related ? 1 : 0,
    body.evidence_collected ? 1 : 0, body.body_camera_active ? 1 : 0,
    body.photos_taken ? 1 : 0,
    body.trespass_issued ? 1 : 0, body.vehicle_pursuit ? 1 : 0,
    body.foot_pursuit ? 1 : 0, body.le_notified ? 1 : 0,
    body.supervisor_notified ? 1 : 0,
    now, now
  );
  return { id: result.meta.last_row_id };
}

const PUSH_PERSON_COLUMNS = [
  'first_name', 'last_name', 'middle_name', 'alias_nickname', 'dob', 'gender', 'race',
  'height', 'height_feet', 'height_inches', 'weight', 'build', 'complexion',
  'hair_color', 'eye_color', 'scars_marks_tattoos', 'clothing_description',
  'address', 'city', 'state', 'zip', 'phone', 'email',
  'dl_number', 'dl_state', 'dl_expiry', 'dl_class', 'ssn_last4', 'ssn_full',
  'id_image_url', 'id_type', 'id_number', 'id_state', 'id_expiry',
  'employer', 'occupation', 'emergency_contact_name', 'emergency_contact_phone',
  'emergency_contact_relationship', 'gang_affiliation', 'language',
  'place_of_birth', 'citizenship', 'marital_status',
  'hair_length', 'hair_style', 'facial_hair', 'glasses', 'shoe_size', 'blood_type',
  'phone_secondary', 'social_media', 'probation_parole', 'probation_parole_officer',
  'known_associates', 'caution_flags', 'photo_url',
  'ncic_number', 'sor_number', 'fbi_number', 'state_id_number',
  'passport_number', 'passport_country', 'immigration_status',
  'disability_flags', 'mental_health_flags', 'substance_abuse', 'medication_notes',
  'education_level', 'military_branch', 'military_status', 'tribal_affiliation',
  'identifying_marks_location', 'tattoo_description', 'scar_description',
  'piercing_description', 'distinguishing_features',
  'email_secondary', 'date_last_seen', 'location_last_seen', 'alias_dob',
  'home_phone', 'work_phone', 'notes',
];

const PUSH_PERSON_BOOL_COLUMNS = new Set(['is_sex_offender', 'is_veteran']);

async function pushPerson(db: D1Db, body: any) {
  if (!body.first_name || !body.last_name) {
    throw new Error('first_name and last_name are required');
  }
  const now = localNow();
  const columns: string[] = [];
  const placeholders: string[] = [];
  const values: any[] = [];
  for (const col of PUSH_PERSON_COLUMNS) {
    if (body[col] !== undefined) {
      columns.push(col);
      placeholders.push('?');
      values.push(body[col] === '' ? null : body[col]);
    }
  }
  for (const col of PUSH_PERSON_BOOL_COLUMNS) {
    if (body[col] !== undefined) {
      columns.push(col);
      placeholders.push('?');
      values.push(body[col] ? 1 : 0);
    }
  }
  columns.push('flags');
  placeholders.push('?');
  values.push(JSON.stringify(body.flags || []));
  columns.push('created_at');
  placeholders.push('?');
  values.push(now);
  columns.push('updated_at');
  placeholders.push('?');
  values.push(now);
  const result = await db.prepare(
    `INSERT INTO persons (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`
  ).run(...values);
  return { id: result.meta.last_row_id };
}

const PUSH_VEHICLE_COLUMNS = [
  'plate_number', 'state', 'make', 'model', 'year', 'color', 'secondary_color',
  'body_style', 'doors', 'vin', 'owner_person_id', 'owner_name', 'owner_address',
  'owner_phone', 'owner_dl_number', 'owner_dob', 'registered_owner',
  'primary_driver_name', 'insurance_company', 'insurance_policy', 'insurance_expiry',
  'registration_expiry', 'registration_state', 'damage_description',
  'distinguishing_features', 'trim', 'engine_type', 'fuel_type', 'transmission',
  'drive_type', 'tow_status', 'tow_company', 'tow_date', 'tow_location', 'plate_type',
  'odometer', 'lien_holder', 'stolen_status', 'stolen_date', 'recovery_date',
  'title_status', 'exterior_condition', 'interior_condition', 'estimated_value',
  'window_tint', 'modifications', 'equipment_notes', 'vehicle_use',
  'ncic_entry_number', 'notes',
];

const PUSH_VEHICLE_BOOL_COLUMNS = new Set(['commercial_vehicle', 'hazmat']);

async function pushVehicle(db: D1Db, body: any) {
  const now = localNow();
  const columns: string[] = [];
  const placeholders: string[] = [];
  const values: any[] = [];
  for (const col of PUSH_VEHICLE_COLUMNS) {
    if (body[col] !== undefined) {
      columns.push(col);
      placeholders.push('?');
      values.push(body[col] === '' ? null : body[col]);
    }
  }
  for (const col of PUSH_VEHICLE_BOOL_COLUMNS) {
    if (body[col] !== undefined) {
      columns.push(col);
      placeholders.push('?');
      values.push(body[col] ? 1 : 0);
    }
  }
  columns.push('flags');
  placeholders.push('?');
  values.push(JSON.stringify(body.flags || []));
  columns.push('created_at');
  placeholders.push('?');
  values.push(now);
  columns.push('updated_at');
  placeholders.push('?');
  values.push(now);
  const result = await db.prepare(
    `INSERT INTO vehicles_records (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`
  ).run(...values);
  return { id: result.meta.last_row_id };
}

async function pushTimeEntry(db: D1Db, body: any) {
  const result = await db.prepare(`
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
  return { id: result.meta.last_row_id };
}

async function pushGpsBreadcrumbs(db: D1Db, body: any) {
  const points = Array.isArray(body) ? body : (body.points || [body]);
  for (const p of points) {
    await db.prepare(`
      INSERT INTO gps_breadcrumbs (unit_id, officer_id, call_sign, latitude, longitude,
        accuracy, heading, speed, unit_status, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(p.unit_id, p.officer_id, p.call_sign, p.latitude, p.longitude,
      p.accuracy, p.heading, p.speed, p.unit_status, p.recorded_at);
  }
}

async function pushUpdate(db: D1Db, endpoint: string, body: any) {
  const parts = endpoint.replace(/^\/api\//, '').split('/');
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
      await db.prepare(`UPDATE calls_for_service SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
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
      await db.prepare(`UPDATE units SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    }
  } else if (parts[0] === 'records' && parts[1] === 'persons') {
    const sets: string[] = [];
    const vals: any[] = [];
    for (const col of PUSH_PERSON_COLUMNS) {
      if (body[col] !== undefined) {
        sets.push(`${col} = ?`);
        vals.push(body[col] === '' ? null : body[col]);
      }
    }
    for (const col of PUSH_PERSON_BOOL_COLUMNS) {
      if (body[col] !== undefined) {
        sets.push(`${col} = ?`);
        vals.push(body[col] ? 1 : 0);
      }
    }
    if (body.flags !== undefined) {
      sets.push('flags = ?');
      vals.push(JSON.stringify(body.flags || []));
    }
    if (sets.length > 0) {
      sets.push('updated_at = ?');
      vals.push(localNow());
      vals.push(entityId);
      await db.prepare(`UPDATE persons SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    }
  } else if (parts[0] === 'records' && parts[1] === 'vehicles') {
    const sets: string[] = [];
    const vals: any[] = [];
    for (const col of PUSH_VEHICLE_COLUMNS) {
      if (body[col] !== undefined) {
        sets.push(`${col} = ?`);
        vals.push(body[col] === '' ? null : body[col]);
      }
    }
    for (const col of PUSH_VEHICLE_BOOL_COLUMNS) {
      if (body[col] !== undefined) {
        sets.push(`${col} = ?`);
        vals.push(body[col] ? 1 : 0);
      }
    }
    if (body.flags !== undefined) {
      sets.push('flags = ?');
      vals.push(JSON.stringify(body.flags || []));
    }
    if (sets.length > 0) {
      sets.push('updated_at = ?');
      vals.push(localNow());
      vals.push(entityId);
      await db.prepare(`UPDATE vehicles_records SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    }
  }
}

async function pushCitation(db: D1Db, body: any, userId: number) {
  const year = new Date().getFullYear();
  const last = await db.prepare(
    "SELECT citation_number FROM citations WHERE citation_number LIKE ? ORDER BY id DESC LIMIT 1"
  ).get(`CIT-${year}-%`) as { citation_number: string } | undefined;
  const seq = last ? parseInt(last.citation_number.split('-')[2], 10) + 1 : 1;
  const citationNumber = `CIT-${year}-${String(seq).padStart(5, '0')}`;
  const now = localNow();
  const result = await db.prepare(`
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
  return { id: result.meta.last_row_id, citation_number: citationNumber };
}

async function pushFieldInterview(db: D1Db, body: any, userId: number) {
  const year = new Date().getFullYear();
  const last = await db.prepare(
    "SELECT fi_number FROM field_interviews WHERE fi_number LIKE ? ORDER BY id DESC LIMIT 1"
  ).get(`FI-${year}-%`) as { fi_number: string } | undefined;
  const seq = last ? parseInt(last.fi_number.split('-')[2], 10) + 1 : 1;
  const fiNumber = `FI-${year}-${String(seq).padStart(5, '0')}`;
  const now = localNow();
  const result = await db.prepare(`
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
  return { id: result.meta.last_row_id, fi_number: fiNumber };
}

async function pushEvidence(db: D1Db, body: any, userId: number) {
  const year = new Date().getFullYear();
  const last = await db.prepare(
    "SELECT evidence_number FROM evidence WHERE evidence_number LIKE ? ORDER BY id DESC LIMIT 1"
  ).get(`EV-${year}-%`) as { evidence_number: string } | undefined;
  const seq = last ? parseInt(last.evidence_number.split('-')[2], 10) + 1 : 1;
  const evidenceNumber = `EV-${year}-${String(seq).padStart(5, '0')}`;
  const now = localNow();
  const result = await db.prepare(`
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
  return { id: result.meta.last_row_id, evidence_number: evidenceNumber };
}

async function pushCriminalHistory(db: D1Db, body: any, userId: number) {
  const now = localNow();
  const result = await db.prepare(`
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
  return { id: result.meta.last_row_id };
}

async function pushPatrolScan(db: D1Db, body: any, userId: number) {
  const now = localNow();
  const result = await db.prepare(`
    INSERT INTO patrol_scans (checkpoint_id, officer_id, scanned_at, latitude, longitude, notes, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    body.checkpoint_id, body.officer_id || userId, body.scanned_at || now,
    body.latitude, body.longitude, body.notes, body.status || 'on_time'
  );
  return { id: result.meta.last_row_id };
}

async function pushTrespassOrder(db: D1Db, body: any, userId: number) {
  const year = new Date().getFullYear();
  const last = await db.prepare(
    "SELECT order_number FROM trespass_orders WHERE order_number LIKE ? ORDER BY id DESC LIMIT 1"
  ).get(`TO-${year}-%`) as { order_number: string } | undefined;
  const seq = last ? parseInt(last.order_number.split('-')[2], 10) + 1 : 1;
  const orderNumber = `TO-${year}-${String(seq).padStart(5, '0')}`;
  const now = localNow();
  const result = await db.prepare(`
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
  return { id: result.meta.last_row_id, order_number: orderNumber };
}

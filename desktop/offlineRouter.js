// ============================================================
// RMPG Flex — Offline API Router
// Maps IPC API requests to local SQLite queries, returning data
// in the same JSON shape as the server endpoints.
// ============================================================

const crypto = require('crypto');
const { getLocalDb, enqueue, getConfig } = require('./localDb');

/**
 * Handle a local API request.
 * @param {string} method - HTTP method (GET, POST, PUT, DELETE)
 * @param {string} path - API path (e.g. /api/dispatch/calls?status=pending)
 * @param {object} body - Request body for POST/PUT
 * @returns {{ status: number, data?: any, error?: string }}
 */
function handle(method, fullPath, body) {
  const url = new URL(fullPath, 'http://localhost');
  const path = url.pathname;
  const query = Object.fromEntries(url.searchParams);

  try {
    // ─── Auth ────────────────────────────────────────────
    if (method === 'GET' && path === '/api/auth/me') {
      return handleGetMe();
    }

    // ─── Dispatch Calls ──────────────────────────────────
    if (method === 'GET' && path === '/api/dispatch/calls') {
      return handleGetCalls(query);
    }
    if (method === 'POST' && path === '/api/dispatch/calls') {
      return handleCreateCall(body);
    }
    if (method === 'GET' && path.match(/^\/api\/dispatch\/calls\/\d+$/)) {
      return handleGetCallById(path.split('/').pop());
    }
    if (method === 'PUT' && path.match(/^\/api\/dispatch\/calls\/\d+$/)) {
      return handleUpdateCall(path.split('/').pop(), body);
    }

    // ─── Units ───────────────────────────────────────────
    if (method === 'GET' && path === '/api/dispatch/units') {
      return handleGetUnits();
    }
    if (method === 'PUT' && path.match(/^\/api\/dispatch\/units\/\d+$/)) {
      return handleUpdateUnit(path.split('/').pop(), body);
    }

    // ─── GPS ─────────────────────────────────────────────
    if (method === 'POST' && path === '/api/dispatch/gps') {
      return handlePostGps(body);
    }

    // ─── Incidents ───────────────────────────────────────
    if (method === 'GET' && path === '/api/incidents') {
      return handleGetIncidents(query);
    }
    if (method === 'POST' && path === '/api/incidents') {
      return handleCreateIncident(body);
    }

    // ─── Records (read-only) ─────────────────────────────
    if (method === 'GET' && path === '/api/records/persons') {
      return handleSearchPersons(query);
    }
    if (method === 'GET' && path === '/api/records/vehicles') {
      return handleSearchVehicles(query);
    }

    // ─── Time Entries ────────────────────────────────────
    if (method === 'POST' && (path === '/api/personnel/time/clock-in' || path === '/api/personnel/time-entries')) {
      return handleClockIn(body);
    }

    // ─── Citations ────────────────────────────────────────
    if (method === 'GET' && path === '/api/citations') {
      return handleGetCitations(query);
    }
    if (method === 'POST' && path === '/api/citations') {
      return handleCreateCitation(body);
    }

    // ─── Field Interviews ─────────────────────────────────
    if (method === 'GET' && path === '/api/field-interviews') {
      return handleGetFieldInterviews(query);
    }
    if (method === 'POST' && path === '/api/field-interviews') {
      return handleCreateFieldInterview(body);
    }

    // ─── Evidence ─────────────────────────────────────────
    if (method === 'GET' && path === '/api/evidence') {
      return handleGetEvidence(query);
    }
    if (method === 'POST' && path === '/api/evidence') {
      return handleCreateEvidence(body);
    }

    // ─── Clock Out ────────────────────────────────────────
    if (method === 'POST' && path === '/api/personnel/time/clock-out') {
      return handleClockOut(body);
    }

    return { status: 503, error: 'Endpoint not available offline' };
  } catch (err) {
    console.error(`[OFFLINE-ROUTER] Error handling ${method} ${path}:`, err.message);
    return { status: 500, error: err.message };
  }
}

// ─── Handler: GET /api/auth/me ───────────────────────────────

function handleGetMe() {
  const userId = getConfig('current_user_id');
  if (!userId) return { status: 401, error: 'Not authenticated offline' };

  const db = getLocalDb();
  const user = db.prepare(`
    SELECT id, username, first_name, last_name, full_name, email, role,
           badge_number, phone, status, avatar_url, created_at
    FROM users WHERE id = ?
  `).get(userId);

  if (!user) return { status: 404, error: 'User not found in local cache' };
  return { status: 200, data: user };
}

// ─── Handler: GET /api/dispatch/calls ────────────────────────

function handleGetCalls(query) {
  const db = getLocalDb();
  let sql = 'SELECT * FROM calls_for_service WHERE 1=1';
  const params = [];

  if (query.status) {
    const statuses = query.status.split(',');
    sql += ` AND status IN (${statuses.map(() => '?').join(',')})`;
    params.push(...statuses);
  }

  if (query.priority) {
    sql += ' AND priority = ?';
    params.push(query.priority);
  }

  sql += ' ORDER BY created_at DESC';

  const limit = parseInt(query.limit) || 200;
  sql += ' LIMIT ?';
  params.push(limit);

  const rows = db.prepare(sql).all(...params);

  // Format to match server response shape
  const calls = rows.map(row => ({
    ...row,
    notes: safeJsonParse(row.notes, []),
    assigned_unit_ids: safeJsonParse(row.assigned_unit_ids, []),
  }));

  return { status: 200, data: calls };
}

// ─── Handler: POST /api/dispatch/calls ───────────────────────

function handleCreateCall(body) {
  const db = getLocalDb();
  const localId = `LOCAL-${crypto.randomUUID()}`;
  const callNumber = `CFS-${new Date().getFullYear()}-LOCAL-${Date.now().toString(36).toUpperCase()}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO calls_for_service
    (local_id, call_number, incident_type, priority, status, caller_name, caller_phone,
     location_address, property_id, client_id, latitude, longitude, description, notes,
     source, assigned_unit_ids, dispatcher_id, created_at, updated_at, is_dirty)
    VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(
    localId, callNumber, body.incident_type, body.priority || 'P3',
    body.caller_name, body.caller_phone, body.location_address,
    body.property_id, body.client_id, body.latitude, body.longitude,
    body.description, JSON.stringify(body.notes || []),
    body.source || 'dispatch', JSON.stringify(body.assigned_unit_ids || []),
    body.dispatcher_id, now, now
  );

  // Enqueue for server sync
  enqueue('POST', '/api/dispatch/calls', body, localId, 'calls_for_service');

  const created = db.prepare('SELECT * FROM calls_for_service WHERE local_id = ?').get(localId);
  return { status: 201, data: { ...created, notes: safeJsonParse(created.notes, []), assigned_unit_ids: safeJsonParse(created.assigned_unit_ids, []) } };
}

// ─── Handler: GET /api/dispatch/calls/:id ────────────────────

function handleGetCallById(id) {
  const db = getLocalDb();
  const row = db.prepare('SELECT * FROM calls_for_service WHERE id = ? OR local_id = ?').get(id, id);
  if (!row) return { status: 404, error: 'Call not found' };

  return {
    status: 200,
    data: { ...row, notes: safeJsonParse(row.notes, []), assigned_unit_ids: safeJsonParse(row.assigned_unit_ids, []) },
  };
}

// ─── Handler: PUT /api/dispatch/calls/:id ────────────────────

function handleUpdateCall(id, body) {
  const db = getLocalDb();
  const existing = db.prepare('SELECT * FROM calls_for_service WHERE id = ? OR local_id = ?').get(id, id);
  if (!existing) return { status: 404, error: 'Call not found' };

  const updatable = ['status', 'priority', 'assigned_unit_ids', 'description', 'disposition',
    'dispatched_at', 'enroute_at', 'onscene_at', 'cleared_at', 'closed_at', 'notes', 'caller_name', 'caller_phone'];
  const sets = ['updated_at = ?', 'is_dirty = 1'];
  const vals = [new Date().toISOString()];

  for (const key of updatable) {
    if (body[key] !== undefined) {
      sets.push(`${key} = ?`);
      vals.push(typeof body[key] === 'object' ? JSON.stringify(body[key]) : body[key]);
    }
  }

  vals.push(existing.id);
  db.prepare(`UPDATE calls_for_service SET ${sets.join(', ')} WHERE id = ?`).run(...vals);

  // Enqueue for server sync
  enqueue('PUT', `/api/dispatch/calls/${existing.server_id || existing.id}`, body, existing.local_id, 'calls_for_service');

  const updated = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(existing.id);
  return { status: 200, data: { ...updated, notes: safeJsonParse(updated.notes, []), assigned_unit_ids: safeJsonParse(updated.assigned_unit_ids, []) } };
}

// ─── Handler: GET /api/dispatch/units ────────────────────────

function handleGetUnits() {
  const db = getLocalDb();
  const units = db.prepare('SELECT * FROM units ORDER BY call_sign ASC').all();
  return { status: 200, data: units.map(u => ({ ...u, capabilities: safeJsonParse(u.capabilities, []) })) };
}

// ─── Handler: PUT /api/dispatch/units/:id ────────────────────

function handleUpdateUnit(id, body) {
  const db = getLocalDb();
  const existing = db.prepare('SELECT * FROM units WHERE id = ?').get(id);
  if (!existing) return { status: 404, error: 'Unit not found' };

  const sets = ['is_dirty = 1'];
  const vals = [];
  const updatable = ['status', 'latitude', 'longitude', 'current_call_id', 'last_status_change'];

  for (const key of updatable) {
    if (body[key] !== undefined) {
      sets.push(`${key} = ?`);
      vals.push(body[key]);
    }
  }

  vals.push(id);
  db.prepare(`UPDATE units SET ${sets.join(', ')} WHERE id = ?`).run(...vals);

  enqueue('PUT', `/api/dispatch/units/${id}`, body, null, 'units');

  const updated = db.prepare('SELECT * FROM units WHERE id = ?').get(id);
  return { status: 200, data: { ...updated, capabilities: safeJsonParse(updated.capabilities, []) } };
}

// ─── Handler: POST /api/dispatch/gps ─────────────────────────

function handlePostGps(body) {
  const db = getLocalDb();
  const points = Array.isArray(body) ? body : (body.points || [body]);

  const stmt = db.prepare(`
    INSERT INTO gps_breadcrumbs (unit_id, officer_id, call_sign, latitude, longitude,
      accuracy, heading, speed, unit_status, recorded_at, is_synced)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  `);

  const tx = db.transaction(() => {
    for (const p of points) {
      stmt.run(p.unit_id, p.officer_id, p.call_sign, p.latitude, p.longitude,
        p.accuracy, p.heading, p.speed, p.unit_status, p.recorded_at);
    }
  });
  tx();

  return { status: 200, data: { stored: points.length } };
}

// ─── Handler: GET /api/incidents ─────────────────────────────

function handleGetIncidents(query) {
  const db = getLocalDb();
  let sql = 'SELECT * FROM incidents WHERE 1=1';
  const params = [];

  if (query.status) {
    sql += ' AND status = ?';
    params.push(query.status);
  }

  sql += ' ORDER BY created_at DESC';
  const limit = parseInt(query.limit) || 100;
  sql += ' LIMIT ?';
  params.push(limit);

  const rows = db.prepare(sql).all(...params);
  return { status: 200, data: rows };
}

// ─── Handler: POST /api/incidents ────────────────────────────

function handleCreateIncident(body) {
  const db = getLocalDb();
  const localId = `LOCAL-${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO incidents (local_id, incident_type, priority, status, location_address,
      property_id, narrative, officer_id, supervisor_id, call_id, created_at, updated_at, is_dirty)
    VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(
    localId, body.incident_type, body.priority || 'P3',
    body.location_address, body.property_id, body.narrative,
    body.officer_id, body.supervisor_id, body.call_id, now, now
  );

  enqueue('POST', '/api/incidents', body, localId, 'incidents');

  const created = db.prepare('SELECT * FROM incidents WHERE local_id = ?').get(localId);
  return { status: 201, data: created };
}

// ─── Handler: GET /api/records/persons ───────────────────────

function handleSearchPersons(query) {
  const db = getLocalDb();
  let sql = 'SELECT * FROM persons WHERE 1=1';
  const params = [];

  if (query.search || query.q) {
    const term = `%${query.search || query.q}%`;
    sql += ' AND (first_name LIKE ? OR last_name LIKE ? OR dl_number LIKE ? OR phone LIKE ?)';
    params.push(term, term, term, term);
  }

  sql += ' ORDER BY last_name ASC, first_name ASC LIMIT ?';
  params.push(parseInt(query.limit) || 50);

  const rows = db.prepare(sql).all(...params);
  return { status: 200, data: rows.map(r => ({ ...r, flags: safeJsonParse(r.flags, []) })) };
}

// ─── Handler: GET /api/records/vehicles ──────────────────────

function handleSearchVehicles(query) {
  const db = getLocalDb();
  let sql = 'SELECT * FROM vehicles_records WHERE 1=1';
  const params = [];

  if (query.search || query.q) {
    const term = `%${query.search || query.q}%`;
    sql += ' AND (plate_number LIKE ? OR vin LIKE ? OR make LIKE ? OR model LIKE ?)';
    params.push(term, term, term, term);
  }

  sql += ' ORDER BY plate_number ASC LIMIT ?';
  params.push(parseInt(query.limit) || 50);

  const rows = db.prepare(sql).all(...params);
  return { status: 200, data: rows.map(r => ({ ...r, flags: safeJsonParse(r.flags, []) })) };
}

// ─── Handler: POST /api/personnel/time/clock-in ──────────────

function handleClockIn(body) {
  const db = getLocalDb();
  const localId = `LOCAL-${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO time_entries (local_id, officer_id, schedule_id, clock_in,
      clock_in_latitude, clock_in_longitude, status, is_dirty)
    VALUES (?, ?, ?, ?, ?, ?, 'active', 1)
  `).run(
    localId, body.officer_id, body.schedule_id, body.clock_in || now,
    body.latitude, body.longitude
  );

  enqueue('POST', '/api/personnel/time/clock-in', body, localId, 'time_entries');

  const created = db.prepare('SELECT * FROM time_entries WHERE local_id = ?').get(localId);
  return { status: 201, data: created };
}

// ─── Utility ─────────────────────────────────────────────────

// ─── Handler: GET /api/citations ──────────────────────────────

function handleGetCitations(query) {
  const db = getLocalDb();
  let sql = 'SELECT * FROM citations WHERE 1=1';
  const params = [];
  if (query.status) { sql += ' AND status = ?'; params.push(query.status); }
  if (query.officer_id) { sql += ' AND officer_id = ?'; params.push(query.officer_id); }
  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(parseInt(query.limit) || 100);
  return { status: 200, data: db.prepare(sql).all(...params) };
}

// ─── Handler: POST /api/citations ─────────────────────────────

function handleCreateCitation(body) {
  const db = getLocalDb();
  const localId = `LOCAL-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const citNum = `CIT-${new Date().getFullYear()}-LOCAL-${Date.now().toString(36).toUpperCase()}`;

  db.prepare(`
    INSERT INTO citations (local_id, citation_number, citation_type, person_id, person_name,
      vehicle_id, officer_id, location_address, latitude, longitude, violation_code,
      violation_description, fine_amount, court_date, court_location, status, notes,
      call_id, incident_id, issued_at, created_at, updated_at, is_dirty)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, 1)
  `).run(
    localId, citNum, body.citation_type || 'traffic', body.person_id, body.person_name,
    body.vehicle_id, body.officer_id, body.location_address, body.latitude, body.longitude,
    body.violation_code, body.violation_description, body.fine_amount, body.court_date,
    body.court_location, body.notes, body.call_id, body.incident_id, body.issued_at || now,
    now, now
  );

  enqueue('POST', '/api/citations', body, localId, 'citations');
  const created = db.prepare('SELECT * FROM citations WHERE local_id = ?').get(localId);
  return { status: 201, data: created };
}

// ─── Handler: GET /api/field-interviews ───────────────────────

function handleGetFieldInterviews(query) {
  const db = getLocalDb();
  let sql = 'SELECT * FROM field_interviews WHERE 1=1';
  const params = [];
  if (query.officer_id) { sql += ' AND officer_id = ?'; params.push(query.officer_id); }
  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(parseInt(query.limit) || 100);
  return { status: 200, data: db.prepare(sql).all(...params) };
}

// ─── Handler: POST /api/field-interviews ──────────────────────

function handleCreateFieldInterview(body) {
  const db = getLocalDb();
  const localId = `LOCAL-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const fiNum = `FI-${new Date().getFullYear()}-LOCAL-${Date.now().toString(36).toUpperCase()}`;

  db.prepare(`
    INSERT INTO field_interviews (local_id, fi_number, officer_id, person_name,
      person_description, dob, address, location_address, latitude, longitude,
      reason, narrative, associated_call_id, person_id, vehicle_description,
      status, created_at, updated_at, is_dirty)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, 1)
  `).run(
    localId, fiNum, body.officer_id, body.person_name, body.person_description,
    body.dob, body.address, body.location_address, body.latitude, body.longitude,
    body.reason, body.narrative, body.associated_call_id, body.person_id,
    body.vehicle_description, now, now
  );

  enqueue('POST', '/api/field-interviews', body, localId, 'field_interviews');
  const created = db.prepare('SELECT * FROM field_interviews WHERE local_id = ?').get(localId);
  return { status: 201, data: created };
}

// ─── Handler: GET /api/evidence ───────────────────────────────

function handleGetEvidence(query) {
  const db = getLocalDb();
  let sql = 'SELECT * FROM evidence_property WHERE 1=1';
  const params = [];
  if (query.incident_id) { sql += ' AND incident_id = ?'; params.push(query.incident_id); }
  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(parseInt(query.limit) || 100);
  return { status: 200, data: db.prepare(sql).all(...params) };
}

// ─── Handler: POST /api/evidence ──────────────────────────────

function handleCreateEvidence(body) {
  const db = getLocalDb();
  const localId = `LOCAL-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const evNum = `EV-${new Date().getFullYear()}-LOCAL-${Date.now().toString(36).toUpperCase()}`;

  db.prepare(`
    INSERT INTO evidence_property (local_id, evidence_number, incident_id, case_id,
      item_type, description, location_found, collected_by, collected_date,
      serial_number, make, model, quantity, unit_of_measure, estimated_value,
      status, storage_location, notes, latitude, longitude, created_at, updated_at, is_dirty)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'in_custody', ?, ?, ?, ?, ?, ?, 1)
  `).run(
    localId, evNum, body.incident_id, body.case_id, body.item_type, body.description,
    body.location_found, body.collected_by, body.collected_date || now,
    body.serial_number, body.make, body.model, body.quantity || 1,
    body.unit_of_measure || 'each', body.estimated_value,
    body.storage_location, body.notes, body.latitude, body.longitude, now, now
  );

  enqueue('POST', '/api/evidence', body, localId, 'evidence_property');
  const created = db.prepare('SELECT * FROM evidence_property WHERE local_id = ?').get(localId);
  return { status: 201, data: created };
}

// ─── Handler: POST /api/personnel/time/clock-out ──────────────

function handleClockOut(body) {
  const db = getLocalDb();
  const now = new Date().toISOString();
  const active = db.prepare(
    `SELECT * FROM time_entries WHERE officer_id = ? AND status = 'active' ORDER BY clock_in DESC LIMIT 1`
  ).get(body.officer_id);

  if (!active) return { status: 404, error: 'No active time entry found' };

  const clockIn = new Date(active.clock_in);
  const clockOut = new Date(body.clock_out || now);
  const totalHours = (clockOut - clockIn) / 3600000;

  db.prepare(`
    UPDATE time_entries SET clock_out = ?, clock_out_latitude = ?, clock_out_longitude = ?,
      total_hours = ?, status = 'completed', is_dirty = 1 WHERE id = ?
  `).run(body.clock_out || now, body.latitude, body.longitude, totalHours, active.id);

  enqueue('POST', '/api/personnel/time/clock-out', body, active.local_id, 'time_entries');
  const updated = db.prepare('SELECT * FROM time_entries WHERE id = ?').get(active.id);
  return { status: 200, data: updated };
}

// ─── Utility ─────────────────────────────────────────────────

function safeJsonParse(str, fallback) {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

module.exports = { handle };

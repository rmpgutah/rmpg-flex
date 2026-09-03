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

    // ─── Incidents (single + update) ─────────────────────
    if (method === 'GET' && path.match(/^\/api\/incidents\/\d+$/)) {
      return handleGetIncidentById(path.split('/').pop());
    }
    if (method === 'PUT' && path.match(/^\/api\/incidents\/\d+$/)) {
      return handleUpdateIncident(path.split('/').pop(), body);
    }

    // ─── Time Entries ────────────────────────────────────
    if (method === 'POST' && (path === '/api/personnel/time/clock-in' || path === '/api/personnel/time-entries')) {
      return handleClockIn(body);
    }
    if (method === 'POST' && path === '/api/personnel/time/clock-out') {
      return handleClockOut(body);
    }
    if (method === 'GET' && path === '/api/personnel/time-entries') {
      return handleGetTimeEntries(query);
    }

    // ─── Units (single) ───────────────────────────────────
    if (method === 'GET' && path.match(/^\/api\/dispatch\/units\/\d+$/)) {
      return handleGetUnitById(path.split('/').pop());
    }

    // ─── Records (single) ────────────────────────────────
    if (method === 'GET' && path.match(/^\/api\/records\/persons\/\d+$/)) {
      return handleGetPersonById(path.split('/').pop());
    }
    if (method === 'GET' && path.match(/^\/api\/records\/vehicles\/\d+$/)) {
      return handleGetVehicleById(path.split('/').pop());
    }

    // ─── Clients (reference data) ─────────────────────────
    if (method === 'GET' && path === '/api/clients') {
      return handleGetClients(query);
    }
    if (method === 'GET' && path.match(/^\/api\/clients\/\d+\/properties$/)) {
      return handleGetClientProperties(path.split('/')[3]);
    }

    // ─── Patrol scans ─────────────────────────────────────
    if (method === 'POST' && path === '/api/patrol/scans') {
      return handleCreatePatrolScan(body);
    }
    if (method === 'GET' && path === '/api/patrol/scans') {
      return handleGetPatrolScans(query);
    }

    // ─── Field Interviews ─────────────────────────────────
    if (method === 'POST' && path === '/api/field-interviews') {
      return handleCreateFieldInterview(body);
    }
    if (method === 'GET' && path === '/api/field-interviews') {
      return handleGetFieldInterviews(query);
    }

    // ─── Citations ────────────────────────────────────────
    if (method === 'POST' && path === '/api/citations') {
      return handleCreateCitation(body);
    }
    if (method === 'GET' && path === '/api/citations') {
      return handleGetCitations(query);
    }

    // ─── GPS trail (recent breadcrumbs) ───────────────────
    if (method === 'GET' && path === '/api/dispatch/gps/trail') {
      return handleGetGpsTrail(query);
    }

    // ─── Process Server (serve queue + attempts) ──────────
    if (method === 'GET' && path === '/api/process-server') {
      return handleGetServeQueue(query);
    }
    if (method === 'GET' && path.match(/^\/api\/process-server\/\d+$/)) {
      return handleGetServeJobById(path.split('/').pop());
    }
    if (method === 'GET' && path.match(/^\/api\/process-server\/\d+\/attempts$/)) {
      return handleGetServeAttempts(path.split('/')[3]);
    }
    if (method === 'POST' && path.match(/^\/api\/process-server\/\d+\/attempt$/)) {
      return handleCreateServeAttempt(path.split('/')[3], body);
    }
    if (method === 'PUT' && path.match(/^\/api\/process-server\/\d+\/status$/)) {
      return handleUpdateServeStatus(path.split('/')[3], body);
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

  // Tag each point with recorded_at if the caller didn't set one.
  // Critical for offline replay — without a local timestamp the server
  // would stamp replayed points with the time the sync happened to run,
  // which misplaces the trail wherever reconnection occurred.
  const nowIso = new Date().toISOString();
  for (const p of points) {
    if (!p.recorded_at) p.recorded_at = nowIso;
    if (!p.gps_source) p.gps_source = 'offline_desktop';
  }

  // Store locally for immediate map rendering on the offline client.
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

  // Replay ownership: syncManager.js's pushGpsBreadcrumbs() is the SOLE
  // replay path for GPS — it scans gps_breadcrumbs directly for is_synced=0
  // rows and pushes them. This handler used to ALSO enqueue the same batch
  // onto the generic sync_queue (table_name 'gps_breadcrumbs' isn't in
  // ALLOWED_SYNC_TABLES, and the queue item's local_id is null, so the
  // generic push path never marked anything synced here — meaning every
  // reconnect sent the batch once via the generic queue drain AND again via
  // pushGpsBreadcrumbs(), duplicating every offline breadcrumb, doubling
  // trip mileage, and double-firing geofence/automation transitions for the
  // same fixes). Local rows are already stored above with is_synced=0, which
  // is all pushGpsBreadcrumbs() needs — no separate enqueue required.

  return { status: 200, data: { stored: points.length, queued: points.length } };
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

// ─── Handler: GET /api/incidents/:id ─────────────────────────

function handleGetIncidentById(id) {
  const db = getLocalDb();
  const row = db.prepare('SELECT * FROM incidents WHERE id = ? OR local_id = ?').get(id, id);
  if (!row) return { status: 404, error: 'Incident not found' };
  return { status: 200, data: row };
}

// ─── Handler: PUT /api/incidents/:id ─────────────────────────

function handleUpdateIncident(id, body) {
  const db = getLocalDb();
  const existing = db.prepare('SELECT * FROM incidents WHERE id = ? OR local_id = ?').get(id, id);
  if (!existing) return { status: 404, error: 'Incident not found' };

  const updatable = ['status', 'priority', 'narrative', 'location_address', 'property_id',
    'supervisor_id', 'call_id', 'incident_type'];
  const sets = ['updated_at = ?', 'is_dirty = 1'];
  const vals = [new Date().toISOString()];

  for (const key of updatable) {
    if (body[key] !== undefined) {
      sets.push(`${key} = ?`);
      vals.push(body[key]);
    }
  }

  vals.push(existing.id);
  db.prepare(`UPDATE incidents SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  enqueue('PUT', `/api/incidents/${existing.server_id || existing.id}`, body, existing.local_id, 'incidents');

  const updated = db.prepare('SELECT * FROM incidents WHERE id = ?').get(existing.id);
  return { status: 200, data: updated };
}

// ─── Handler: POST /api/personnel/time/clock-out ─────────────

function handleClockOut(body) {
  const db = getLocalDb();
  const userId = getConfig('current_user_id');
  const now = new Date().toISOString();

  const active = db.prepare(
    `SELECT * FROM time_entries WHERE officer_id = ? AND status = 'active' ORDER BY clock_in DESC LIMIT 1`
  ).get(body.officer_id || userId);

  if (!active) return { status: 404, error: 'No active time entry found' };

  const clockOut = body.clock_out || now;
  // D1 timestamps are stored as naive UTC (e.g. "2026-08-12 14:30:00") without
  // a 'Z' suffix. new Date() on such a string parses it as LOCAL time in Node.js,
  // causing up to 7h error vs the ISO Z-string from Date.prototype.toISOString().
  // Normalize by replacing the space with 'T' and appending 'Z' if absent.
  function parseD1Ts(ts) {
    if (!ts) return NaN;
    const normalized = ts.includes('T') ? ts : ts.replace(' ', 'T');
    return new Date(normalized.endsWith('Z') ? normalized : normalized + 'Z').getTime();
  }
  const clockInMs = parseD1Ts(active.clock_in);
  const clockOutMs = parseD1Ts(clockOut);
  const totalHours = Math.max(0, (clockOutMs - clockInMs) / 3600000);

  db.prepare(`
    UPDATE time_entries SET clock_out = ?, clock_out_latitude = ?, clock_out_longitude = ?,
      total_hours = ?, status = 'completed', is_dirty = 1 WHERE id = ?
  `).run(clockOut, body.latitude, body.longitude, totalHours, active.id);

  enqueue('POST', '/api/personnel/time/clock-out', { ...body, clock_out: clockOut }, active.local_id, 'time_entries');

  const updated = db.prepare('SELECT * FROM time_entries WHERE id = ?').get(active.id);
  return { status: 200, data: updated };
}

// ─── Handler: GET /api/personnel/time-entries ─────────────────

function handleGetTimeEntries(query) {
  const db = getLocalDb();
  const userId = getConfig('current_user_id');
  let sql = 'SELECT * FROM time_entries WHERE officer_id = ?';
  const params = [query.officer_id || userId];

  if (query.status) {
    sql += ' AND status = ?';
    params.push(query.status);
  }

  sql += ' ORDER BY clock_in DESC LIMIT ?';
  params.push(parseInt(query.limit) || 50);

  const rows = db.prepare(sql).all(...params);
  return { status: 200, data: rows };
}

// ─── Handler: GET /api/dispatch/units/:id ────────────────────

function handleGetUnitById(id) {
  const db = getLocalDb();
  const row = db.prepare('SELECT * FROM units WHERE id = ?').get(id);
  if (!row) return { status: 404, error: 'Unit not found' };
  return { status: 200, data: { ...row, capabilities: safeJsonParse(row.capabilities, []) } };
}

// ─── Handler: GET /api/records/persons/:id ───────────────────

function handleGetPersonById(id) {
  const db = getLocalDb();
  const row = db.prepare('SELECT * FROM persons WHERE id = ?').get(id);
  if (!row) return { status: 404, error: 'Person not found' };
  return { status: 200, data: { ...row, flags: safeJsonParse(row.flags, []) } };
}

// ─── Handler: GET /api/records/vehicles/:id ──────────────────

function handleGetVehicleById(id) {
  const db = getLocalDb();
  const row = db.prepare('SELECT * FROM vehicles_records WHERE id = ?').get(id);
  if (!row) return { status: 404, error: 'Vehicle not found' };
  return { status: 200, data: { ...row, flags: safeJsonParse(row.flags, []) } };
}

// ─── Handler: GET /api/clients ───────────────────────────────

function handleGetClients(query) {
  const db = getLocalDb();
  let sql = 'SELECT * FROM clients WHERE status = ?';
  const params = [query.status || 'active'];
  sql += ' ORDER BY name ASC LIMIT ?';
  params.push(parseInt(query.limit) || 200);
  const rows = db.prepare(sql).all(...params);
  return { status: 200, data: rows };
}

// ─── Handler: GET /api/clients/:id/properties ────────────────

function handleGetClientProperties(clientId) {
  const db = getLocalDb();
  const rows = db.prepare(
    'SELECT * FROM properties WHERE client_id = ? AND is_active = 1 ORDER BY name ASC'
  ).all(clientId);
  return { status: 200, data: rows };
}

// ─── Handler: POST /api/patrol/scans ─────────────────────────

function handleCreatePatrolScan(body) {
  const db = getLocalDb();
  const now = new Date().toISOString();

  // patrol_scans uses scanned_at (NOT created_at) per migrations README
  db.prepare(`
    INSERT INTO patrol_scans
      (officer_id, unit_id, checkpoint_id, property_id, latitude, longitude,
       notes, scanned_at, is_synced)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
  `).run(
    body.officer_id, body.unit_id, body.checkpoint_id, body.property_id,
    body.latitude, body.longitude, body.notes, body.scanned_at || now
  );

  const created = db.prepare('SELECT * FROM patrol_scans WHERE rowid = last_insert_rowid()').get();
  enqueue('POST', '/api/patrol/scans', body, null, 'patrol_scans');
  return { status: 201, data: created };
}

// ─── Handler: GET /api/patrol/scans ──────────────────────────

function handleGetPatrolScans(query) {
  const db = getLocalDb();
  let sql = 'SELECT * FROM patrol_scans WHERE 1=1';
  const params = [];

  if (query.officer_id) { sql += ' AND officer_id = ?'; params.push(query.officer_id); }
  if (query.property_id) { sql += ' AND property_id = ?'; params.push(query.property_id); }

  sql += ' ORDER BY scanned_at DESC LIMIT ?';
  params.push(parseInt(query.limit) || 100);
  return { status: 200, data: db.prepare(sql).all(...params) };
}

// ─── Handler: POST /api/field-interviews ─────────────────────

function handleCreateFieldInterview(body) {
  const db = getLocalDb();
  const localId = `LOCAL-${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO field_interviews
      (local_id, officer_id, subject_first_name, subject_last_name, subject_dob,
       subject_race, subject_sex, location_address, latitude, longitude,
       reason, narrative, call_id, created_at, updated_at, is_dirty)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(
    localId, body.officer_id,
    body.subject_first_name, body.subject_last_name, body.subject_dob,
    body.subject_race, body.subject_sex,
    body.location_address, body.latitude, body.longitude,
    body.reason, body.narrative, body.call_id, now, now
  );

  const created = db.prepare('SELECT * FROM field_interviews WHERE local_id = ?').get(localId);
  enqueue('POST', '/api/field-interviews', body, localId, 'field_interviews');
  return { status: 201, data: created };
}

// ─── Handler: GET /api/field-interviews ──────────────────────

function handleGetFieldInterviews(query) {
  const db = getLocalDb();
  let sql = 'SELECT * FROM field_interviews WHERE 1=1';
  const params = [];

  if (query.officer_id) { sql += ' AND officer_id = ?'; params.push(query.officer_id); }
  if (query.call_id) { sql += ' AND call_id = ?'; params.push(query.call_id); }

  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(parseInt(query.limit) || 50);
  return { status: 200, data: db.prepare(sql).all(...params) };
}

// ─── Handler: POST /api/citations ────────────────────────────

function handleCreateCitation(body) {
  const db = getLocalDb();
  const localId = `LOCAL-${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO citations
      (local_id, officer_id, citation_number, violation_code, violation_description,
       subject_first_name, subject_last_name, subject_dob, subject_dl_number,
       vehicle_plate, vehicle_make, vehicle_model, vehicle_year, vehicle_color,
       location_address, latitude, longitude, call_id,
       issued_at, updated_at, is_dirty)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(
    localId, body.officer_id,
    body.citation_number || `CIT-${Date.now().toString(36).toUpperCase()}`,
    body.violation_code, body.violation_description,
    body.subject_first_name, body.subject_last_name, body.subject_dob, body.subject_dl_number,
    body.vehicle_plate, body.vehicle_make, body.vehicle_model, body.vehicle_year, body.vehicle_color,
    body.location_address, body.latitude, body.longitude, body.call_id,
    body.issued_at || now, now
  );

  const created = db.prepare('SELECT * FROM citations WHERE local_id = ?').get(localId);
  enqueue('POST', '/api/citations', body, localId, 'citations');
  return { status: 201, data: created };
}

// ─── Handler: GET /api/citations ─────────────────────────────

function handleGetCitations(query) {
  const db = getLocalDb();
  let sql = 'SELECT * FROM citations WHERE 1=1';
  const params = [];

  if (query.officer_id) { sql += ' AND officer_id = ?'; params.push(query.officer_id); }
  if (query.call_id) { sql += ' AND call_id = ?'; params.push(query.call_id); }

  sql += ' ORDER BY issued_at DESC LIMIT ?';
  params.push(parseInt(query.limit) || 50);
  return { status: 200, data: db.prepare(sql).all(...params) };
}

// ─── Handler: GET /api/dispatch/gps/trail ────────────────────

function handleGetGpsTrail(query) {
  const db = getLocalDb();
  let sql = 'SELECT * FROM gps_breadcrumbs WHERE 1=1';
  const params = [];

  if (query.unit_id) { sql += ' AND unit_id = ?'; params.push(query.unit_id); }
  if (query.officer_id) { sql += ' AND officer_id = ?'; params.push(query.officer_id); }
  if (query.since) { sql += ' AND recorded_at >= ?'; params.push(query.since); }

  sql += ' ORDER BY recorded_at DESC LIMIT ?';
  params.push(parseInt(query.limit) || 500);
  return { status: 200, data: db.prepare(sql).all(...params) };
}

// ─── Handler: GET /api/process-server ────────────────────────

function handleGetServeQueue(query) {
  const db = getLocalDb();
  const userId = getConfig('current_user_id');
  let sql = 'SELECT * FROM serve_queue WHERE 1=1';
  const params = [];

  if (query.officer_id) {
    sql += ' AND officer_id = ?';
    params.push(parseInt(query.officer_id));
  } else if (userId) {
    // Default to the current officer's own queue so My Run works offline
    sql += ' AND officer_id = ?';
    params.push(parseInt(userId));
  }

  if (query.status) {
    sql += ' AND status = ?';
    params.push(query.status);
  }

  sql += ' ORDER BY sort_order ASC, priority DESC, deadline ASC LIMIT ?';
  params.push(parseInt(query.limit) || 200);

  return { status: 200, data: db.prepare(sql).all(...params) };
}

// ─── Handler: GET /api/process-server/:id ────────────────────

function handleGetServeJobById(id) {
  const db = getLocalDb();
  const job = db.prepare('SELECT * FROM serve_queue WHERE id = ?').get(parseInt(id));
  if (!job) return { status: 404, error: 'Job not found' };
  return { status: 200, data: job };
}

// ─── Handler: GET /api/process-server/:id/attempts ───────────

function handleGetServeAttempts(jobId) {
  const db = getLocalDb();
  const attempts = db.prepare(
    'SELECT * FROM serve_attempts WHERE serve_queue_id = ? ORDER BY attempt_at ASC'
  ).all(parseInt(jobId));
  return { status: 200, data: attempts };
}

// ─── Handler: POST /api/process-server/:id/attempt ───────────

function handleCreateServeAttempt(jobId, body) {
  const db = getLocalDb();
  const now = new Date().toISOString();
  const localId = `serve-attempt-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const jobIdInt = parseInt(jobId);

  const job = db.prepare('SELECT * FROM serve_queue WHERE id = ?').get(jobIdInt);
  if (!job) return { status: 404, error: 'Job not found offline' };

  const nextAttemptNumber = (job.attempt_count || 0) + 1;

  db.prepare(`
    INSERT INTO serve_attempts
      (local_id, serve_queue_id, attempt_number, attempt_at, officer_id,
       result, latitude, longitude, notes, attempt_type, photo_ids,
       signature_data, planned_at, window, status, is_dirty, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `).run(
    localId,
    jobIdInt,
    nextAttemptNumber,
    body.attempt_at || now,
    body.officer_id || getConfig('current_user_id'),
    body.result || null,
    body.latitude || null,
    body.longitude || null,
    body.notes || null,
    body.attempt_type || null,
    JSON.stringify(body.photo_ids || []),
    body.signature_data || null,
    body.planned_at || null,
    body.window || null,
    body.status || 'attempted',
    now,
  );

  // Derive new queue_status from the attempt result so My Run tab sees it
  const resultToStatus = { served: 'served', failed: 'failed', skipped: 'skipped' };
  const newStatus = resultToStatus[body.result] || job.status;

  db.prepare(`
    UPDATE serve_queue
    SET attempt_count = attempt_count + 1, status = ?, updated_at = ?, is_dirty = 1
    WHERE id = ?
  `).run(newStatus, now, jobIdInt);

  enqueue(
    'POST',
    `/api/process-server/${jobId}/attempt`,
    { ...body, attempt_at: body.attempt_at || now },
    localId,
    'serve_attempts',
  );

  const created = db.prepare('SELECT * FROM serve_attempts WHERE local_id = ?').get(localId);
  return { status: 201, data: { ...created, queue_status: newStatus } };
}

// ─── Handler: PUT /api/process-server/:id/status ─────────────

function handleUpdateServeStatus(jobId, body) {
  const db = getLocalDb();
  const now = new Date().toISOString();
  const jobIdInt = parseInt(jobId);

  const job = db.prepare('SELECT * FROM serve_queue WHERE id = ?').get(jobIdInt);
  if (!job) return { status: 404, error: 'Job not found offline' };

  const newStatus = body.status || job.status;
  db.prepare(
    `UPDATE serve_queue SET status = ?, updated_at = ?, is_dirty = 1 WHERE id = ?`
  ).run(newStatus, now, jobIdInt);

  enqueue(
    'PUT',
    `/api/process-server/${jobId}/status`,
    body,
    null,
    'serve_queue',
  );

  return { status: 200, data: { id: jobIdInt, status: newStatus } };
}

// ─── Utility ─────────────────────────────────────────────────

function safeJsonParse(str, fallback) {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

module.exports = { handle };

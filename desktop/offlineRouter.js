// ============================================================
// RMPG Flex — Offline API Router
// Maps IPC API requests (method + path + body) to local SQLite
// queries, returning data in the same JSON shape as the server.
// ============================================================

const { v4: uuidv4 } = require('uuid');

let localDb = null;

function init(db) {
  localDb = db;
  console.log('[OfflineRouter] Initialized');
}

function localNow() {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

// Route an API request to local SQLite
function route(method, path, body) {
  if (!localDb) return { status: 503, error: 'Local database not initialized' };

  try {
    // Normalize
    method = method.toUpperCase();
    if (path.startsWith('/api')) path = path.substring(4);

    // ── Dispatch: Calls ──
    if (method === 'GET' && path === '/dispatch/calls') {
      return getCalls(body);
    }
    if (method === 'POST' && path === '/dispatch/calls') {
      return createCall(body);
    }
    if (method === 'GET' && path.match(/^\/dispatch\/calls\/\d+$/)) {
      const id = path.split('/').pop();
      return getCall(id);
    }
    if (method === 'PUT' && path.match(/^\/dispatch\/calls\/\d+$/)) {
      const id = path.split('/').pop();
      return updateCall(id, body);
    }
    if (method === 'POST' && path.match(/^\/dispatch\/calls\/\d+\/status$/)) {
      const id = path.split('/')[3];
      return updateCallStatus(id, body);
    }

    // ── Dispatch: Units ──
    if (method === 'GET' && path === '/dispatch/units') {
      return getUnits();
    }
    if (method === 'PUT' && path.match(/^\/dispatch\/units\/\d+$/)) {
      const id = path.split('/').pop();
      return updateUnit(id, body);
    }

    // ── GPS ──
    if (method === 'POST' && path === '/dispatch/gps') {
      return recordGps(body);
    }

    // ── Incidents ──
    if (method === 'GET' && path === '/incidents') {
      return getIncidents(body);
    }
    if (method === 'POST' && path === '/incidents') {
      return createIncident(body);
    }

    // ── Records: Persons ──
    if (method === 'GET' && path === '/records/persons/search') {
      return searchPersons(body);
    }
    if (method === 'GET' && path.match(/^\/records\/persons\/\d+$/)) {
      const id = path.split('/').pop();
      return getPerson(id);
    }

    // ── Records: Vehicles ──
    if (method === 'GET' && path === '/records/vehicles/search') {
      return searchVehicles(body);
    }

    // ── Personnel: Time entries ──
    if (method === 'POST' && path === '/personnel/time-entries/clock-in') {
      return clockIn(body);
    }
    if (method === 'POST' && path === '/personnel/time-entries/clock-out') {
      return clockOut(body);
    }

    // ── Auth ──
    if (method === 'GET' && path === '/auth/me') {
      return getAuthMe(body);
    }

    return { status: 503, error: 'Endpoint not available offline: ' + method + ' ' + path };
  } catch (err) {
    console.error('[OfflineRouter] Error:', err.message);
    return { status: 500, error: err.message };
  }
}

// ── Route Handlers ───────────────────────────────────────────

function getCalls(params) {
  let where = 'WHERE 1=1';
  const args = [];

  if (params && params.status) {
    if (params.status === 'active') {
      where += " AND status IN ('pending','dispatched','enroute','onscene')";
    } else {
      where += ' AND status = ?';
      args.push(params.status);
    }
  } else {
    where += " AND status NOT IN ('archived')";
  }

  const calls = localDb.prepare(
    'SELECT * FROM calls_for_service ' + where + ' ORDER BY created_at DESC LIMIT 200'
  ).all(...args);

  return { status: 200, data: calls };
}

function getCall(id) {
  const call = localDb.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(id);
  if (!call) return { status: 404, error: 'Call not found' };
  return { status: 200, data: call };
}

function createCall(body) {
  const now = localNow();
  const localId = 'LOCAL-' + uuidv4().substring(0, 8).toUpperCase();
  const callNumber = 'LCFS-' + Date.now().toString(36).toUpperCase();

  const result = localDb.prepare(`
    INSERT INTO calls_for_service (local_id, call_number, incident_type, priority, status, caller_name, caller_phone,
      location_address, property_id, latitude, longitude, description, notes, source, dispatcher_id, created_at, is_dirty)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(
    localId, callNumber, body.incident_type, body.priority || 'P3', body.status || 'pending',
    body.caller_name || null, body.caller_phone || null, body.location_address,
    body.property_id || null, body.latitude || null, body.longitude || null,
    body.description || null, body.notes || null, body.source || 'dispatch',
    body.dispatcher_id || null, now
  );

  // Enqueue for sync
  localDb.prepare(`INSERT INTO sync_queue (method, endpoint, body, local_id, table_name) VALUES ('POST', '/api/dispatch/calls', ?, ?, 'calls_for_service')`)
    .run(JSON.stringify(body), localId);

  const created = localDb.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(result.lastInsertRowid);
  return { status: 201, data: created };
}

function updateCall(id, body) {
  const call = localDb.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(id);
  if (!call) return { status: 404, error: 'Call not found' };

  const fields = ['incident_type', 'priority', 'status', 'caller_name', 'caller_phone',
    'location_address', 'description', 'notes', 'disposition', 'assigned_unit_ids'];
  const sets = [];
  const args = [];
  for (const f of fields) {
    if (body[f] !== undefined) {
      sets.push(f + ' = ?');
      args.push(body[f]);
    }
  }
  if (sets.length === 0) return { status: 200, data: call };

  sets.push('is_dirty = 1');
  sets.push("updated_at = datetime('now','localtime')");
  args.push(id);

  localDb.prepare('UPDATE calls_for_service SET ' + sets.join(', ') + ' WHERE id = ?').run(...args);

  // Enqueue for sync
  localDb.prepare(`INSERT INTO sync_queue (method, endpoint, body, table_name) VALUES ('PUT', ?, ?, 'calls_for_service')`)
    .run('/api/dispatch/calls/' + (call.server_id || id), JSON.stringify(body));

  const updated = localDb.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(id);
  return { status: 200, data: updated };
}

function updateCallStatus(id, body) {
  const call = localDb.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(id);
  if (!call) return { status: 404, error: 'Call not found' };

  const now = localNow();
  const tsMap = { dispatched: 'dispatched_at', enroute: 'enroute_at', onscene: 'onscene_at', cleared: 'cleared_at', closed: 'closed_at' };
  const tsField = tsMap[body.status];

  let sql = 'UPDATE calls_for_service SET status = ?, is_dirty = 1, updated_at = ?';
  const args = [body.status, now];
  if (tsField) { sql += ', ' + tsField + ' = COALESCE(' + tsField + ', ?)'; args.push(now); }
  if (body.disposition) { sql += ', disposition = ?'; args.push(body.disposition); }
  sql += ' WHERE id = ?';
  args.push(id);

  localDb.prepare(sql).run(...args);

  // Free units on clear/close
  if (['cleared', 'closed', 'cancelled'].includes(body.status)) {
    try {
      const unitIds = JSON.parse(call.assigned_unit_ids || '[]');
      for (const uid of unitIds) {
        localDb.prepare("UPDATE units SET status = 'available', current_call_id = NULL, is_dirty = 1 WHERE id = ?").run(uid);
      }
    } catch { /* ignore */ }
  }

  // Enqueue sync
  localDb.prepare(`INSERT INTO sync_queue (method, endpoint, body, table_name) VALUES ('POST', ?, ?, 'calls_for_service')`)
    .run('/api/dispatch/calls/' + (call.server_id || id) + '/status', JSON.stringify(body));

  const updated = localDb.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(id);
  return { status: 200, data: updated };
}

function getUnits() {
  const units = localDb.prepare('SELECT * FROM units ORDER BY call_sign').all();
  return { status: 200, data: units };
}

function updateUnit(id, body) {
  const unit = localDb.prepare('SELECT * FROM units WHERE id = ?').get(id);
  if (!unit) return { status: 404, error: 'Unit not found' };

  const fields = ['status', 'latitude', 'longitude', 'current_call_id', 'last_status_change'];
  const sets = [];
  const args = [];
  for (const f of fields) {
    if (body[f] !== undefined) { sets.push(f + ' = ?'); args.push(body[f]); }
  }
  sets.push('is_dirty = 1');
  args.push(id);

  localDb.prepare('UPDATE units SET ' + sets.join(', ') + ' WHERE id = ?').run(...args);
  const updated = localDb.prepare('SELECT * FROM units WHERE id = ?').get(id);
  return { status: 200, data: updated };
}

function recordGps(body) {
  const now = localNow();
  localDb.prepare(`
    INSERT INTO gps_breadcrumbs (unit_id, officer_id, latitude, longitude, accuracy, heading, speed,
      unit_status, call_sign, officer_name, badge_number, current_call_id, current_call_number, current_call_type, recorded_at, is_synced)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  `).run(
    body.unit_id, body.officer_id, body.latitude, body.longitude,
    body.accuracy || null, body.heading || null, body.speed || null,
    body.unit_status || null, body.call_sign || null, body.officer_name || null,
    body.badge_number || null, body.current_call_id || null,
    body.current_call_number || null, body.current_call_type || null, now
  );
  return { status: 201, data: { recorded: true } };
}

function getIncidents(params) {
  let where = 'WHERE 1=1';
  const args = [];
  if (params && params.status) { where += ' AND status = ?'; args.push(params.status); }

  const incidents = localDb.prepare(
    'SELECT * FROM incidents ' + where + ' ORDER BY created_at DESC LIMIT 100'
  ).all(...args);
  return { status: 200, data: incidents };
}

function createIncident(body) {
  const now = localNow();
  const localId = 'LOCAL-' + uuidv4().substring(0, 8).toUpperCase();
  const incNumber = 'LINC-' + Date.now().toString(36).toUpperCase();

  const result = localDb.prepare(`
    INSERT INTO incidents (local_id, incident_number, incident_type, priority, status,
      location_address, property_id, description, narrative, officer_id, created_at, is_dirty)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(localId, incNumber, body.incident_type, body.priority || 'P3', 'open',
    body.location_address || '', body.property_id || null, body.description || null,
    body.narrative || null, body.officer_id || null, now);

  localDb.prepare(`INSERT INTO sync_queue (method, endpoint, body, local_id, table_name) VALUES ('POST', '/api/incidents', ?, ?, 'incidents')`)
    .run(JSON.stringify(body), localId);

  const created = localDb.prepare('SELECT * FROM incidents WHERE id = ?').get(result.lastInsertRowid);
  return { status: 201, data: created };
}

function searchPersons(params) {
  const q = (params && params.q) || '';
  if (q.length < 2) return { status: 200, data: [] };

  const like = '%' + q.toLowerCase() + '%';
  const persons = localDb.prepare(`
    SELECT * FROM persons
    WHERE LOWER(first_name) LIKE ? OR LOWER(last_name) LIKE ?
      OR id_number LIKE ? OR phone LIKE ?
    ORDER BY last_name, first_name LIMIT 50
  `).all(like, like, like, like);

  return { status: 200, data: persons };
}

function getPerson(id) {
  const person = localDb.prepare('SELECT * FROM persons WHERE id = ?').get(id);
  if (!person) return { status: 404, error: 'Person not found' };
  return { status: 200, data: person };
}

function searchVehicles(params) {
  const q = (params && params.q) || '';
  if (q.length < 2) return { status: 200, data: [] };

  const like = '%' + q.toUpperCase() + '%';
  const vehicles = localDb.prepare(`
    SELECT * FROM vehicles_records
    WHERE UPPER(plate_number) LIKE ? OR UPPER(vin) LIKE ?
      OR UPPER(make) LIKE ? OR UPPER(model) LIKE ?
    ORDER BY plate_number LIMIT 50
  `).all(like, like, like, like);

  return { status: 200, data: vehicles };
}

function clockIn(body) {
  const now = localNow();
  const localId = 'LOCAL-' + uuidv4().substring(0, 8).toUpperCase();

  const result = localDb.prepare(`
    INSERT INTO time_entries (local_id, officer_id, clock_in, status, vehicle_id, mileage_start, property_id, is_dirty)
    VALUES (?, ?, ?, 'active', ?, ?, ?, 1)
  `).run(localId, body.officer_id, now, body.vehicle_id || null, body.mileage_start || null, body.property_id || null);

  localDb.prepare(`INSERT INTO sync_queue (method, endpoint, body, local_id, table_name) VALUES ('POST', '/api/personnel/time-entries/clock-in', ?, ?, 'time_entries')`)
    .run(JSON.stringify(body), localId);

  const entry = localDb.prepare('SELECT * FROM time_entries WHERE id = ?').get(result.lastInsertRowid);
  return { status: 201, data: entry };
}

function clockOut(body) {
  const now = localNow();
  const active = localDb.prepare("SELECT * FROM time_entries WHERE officer_id = ? AND status = 'active' ORDER BY clock_in DESC LIMIT 1").get(body.officer_id);
  if (!active) return { status: 400, error: 'No active time entry found' };

  const clockIn = new Date(active.clock_in);
  const clockOutTime = new Date();
  const totalHours = Math.round((clockOutTime - clockIn) / 3600000 * 100) / 100;

  localDb.prepare(`
    UPDATE time_entries SET clock_out = ?, total_hours = ?, mileage_end = ?, status = 'completed', is_dirty = 1
    WHERE id = ?
  `).run(now, totalHours, body.mileage_end || null, active.id);

  localDb.prepare(`INSERT INTO sync_queue (method, endpoint, body, table_name) VALUES ('POST', '/api/personnel/time-entries/clock-out', ?, 'time_entries')`)
    .run(JSON.stringify(body));

  const entry = localDb.prepare('SELECT * FROM time_entries WHERE id = ?').get(active.id);
  return { status: 200, data: entry };
}

function getAuthMe(params) {
  // Return cached user info
  if (params && params.userId) {
    const user = localDb.prepare('SELECT id, username, full_name, email, role, badge_number, status FROM users WHERE id = ?').get(params.userId);
    if (user) return { status: 200, data: user };
  }
  // Try last logged-in user from local_config
  const lastUser = localDb.prepare("SELECT value FROM local_config WHERE key = 'last_user_id'").get();
  if (lastUser) {
    const user = localDb.prepare('SELECT id, username, full_name, email, role, badge_number, status FROM users WHERE id = ?').get(lastUser.value);
    if (user) return { status: 200, data: user };
  }
  return { status: 401, error: 'No cached user available' };
}

module.exports = { init, route };

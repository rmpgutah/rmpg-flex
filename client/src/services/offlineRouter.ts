// ============================================================
// RMPG Flex — Browser Offline API Router
// Mirrors desktop/offlineRouter.js — maps API requests to
// IndexedDB queries, returning data in the same JSON shape
// as the server endpoints.
// ============================================================

import {
  getOfflineDb,
  enqueue,
  getConfig,
  upsertRow,
  type CallForService,
  type Unit,
  type Incident,
  type Citation,
  type FieldInterview,
  type Evidence,
  type CriminalHistory,
  type PatrolScan,
  type TrespassOrder,
  type Warrant,
} from './offlineDb';

// ─── Types ──────────────────────────────────────────────────

interface OfflineResponse {
  status: number;
  data?: any;
  error?: string;
}

// ─── Public API ─────────────────────────────────────────────

/**
 * Handle a local API request, routing to IndexedDB.
 * Returns a response in the same shape as the server.
 */
export async function handle(
  method: string,
  fullPath: string,
  body?: any
): Promise<OfflineResponse> {
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
    if (method === 'GET' && /^\/api\/dispatch\/calls\/\d+$/.test(path)) {
      return handleGetCallById(path.split('/').pop()!);
    }
    if (method === 'PUT' && /^\/api\/dispatch\/calls\/\d+$/.test(path)) {
      return handleUpdateCall(path.split('/').pop()!, body);
    }

    // ─── Units ───────────────────────────────────────────
    if (method === 'GET' && path === '/api/dispatch/units') {
      return handleGetUnits();
    }
    if (method === 'PUT' && /^\/api\/dispatch\/units\/\d+$/.test(path)) {
      return handleUpdateUnit(path.split('/').pop()!, body);
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
    if (method === 'POST' && path === '/api/personnel/time/clock-out') {
      return handleClockOut(body);
    }

    // ─── Citations ──────────────────────────────────────
    if (method === 'GET' && path === '/api/citations') {
      return handleGetCitations(query);
    }
    if (method === 'POST' && path === '/api/citations') {
      return handleCreateCitation(body);
    }

    // ─── Field Interviews ───────────────────────────────
    if (method === 'GET' && path === '/api/field-interviews') {
      return handleGetFieldInterviews(query);
    }
    if (method === 'POST' && path === '/api/field-interviews') {
      return handleCreateFieldInterview(body);
    }

    // ─── Evidence ───────────────────────────────────────
    if (method === 'GET' && path === '/api/evidence') {
      return handleGetEvidence(query);
    }
    if (method === 'POST' && path === '/api/evidence') {
      return handleCreateEvidence(body);
    }

    // ─── Arrests (criminal_history) ─────────────────────
    if (method === 'GET' && path === '/api/arrests') {
      return handleGetArrests(query);
    }
    if (method === 'POST' && path === '/api/arrests') {
      return handleCreateArrest(body);
    }

    // ─── Patrol Checkpoints / Scans ─────────────────────
    if (method === 'GET' && path === '/api/patrol/checkpoints') {
      return handleGetPatrolCheckpoints(query);
    }
    if (method === 'POST' && path === '/api/patrol/checkpoints') {
      return handleCreatePatrolScan(body);
    }

    // ─── Trespass Orders ────────────────────────────────
    if (method === 'GET' && path === '/api/trespass-orders') {
      return handleGetTrespassOrders(query);
    }
    if (method === 'POST' && path === '/api/trespass-orders') {
      return handleCreateTrespassOrder(body);
    }

    // ─── Warrants (read-only cache) ─────────────────────
    if (method === 'GET' && path === '/api/warrants') {
      return handleGetWarrants(query);
    }
    if (method === 'GET' && /^\/api\/warrants\/check\/\d+$/.test(path)) {
      return handleCheckWarrants(path.split('/').pop()!);
    }

    return { status: 503, error: 'Endpoint not available offline' };
  } catch (err: any) {
    console.error(`[OFFLINE-ROUTER] Error handling ${method} ${path}:`, err?.message || err);
    return { status: 500, error: err?.message || 'Internal error' };
  }
}

/**
 * Check if a given method + URL can be served offline.
 */
export function isOfflineCapableEndpoint(method: string, url: string): boolean {
  const path = new URL(url, 'http://localhost').pathname;

  const readRoutes = [
    '/api/auth/me',
    '/api/dispatch/calls',
    '/api/dispatch/units',
    '/api/incidents',
    '/api/records/persons',
    '/api/records/vehicles',
    '/api/citations',
    '/api/field-interviews',
    '/api/evidence',
    '/api/arrests',
    '/api/patrol/checkpoints',
    '/api/trespass-orders',
    '/api/warrants',
  ];

  const writeRoutes = [
    '/api/dispatch/calls',
    '/api/dispatch/gps',
    '/api/incidents',
    '/api/personnel/time/clock-in',
    '/api/personnel/time-entries',
    '/api/personnel/time/clock-out',
    '/api/citations',
    '/api/field-interviews',
    '/api/evidence',
    '/api/arrests',
    '/api/patrol/checkpoints',
    '/api/trespass-orders',
  ];

  // GET requests — check read routes and parameterized routes
  if (method === 'GET') {
    if (readRoutes.some(r => path === r || path.startsWith(r + '/'))) return true;
    if (/^\/api\/dispatch\/calls\/\d+$/.test(path)) return true;
    if (/^\/api\/warrants\/check\/\d+$/.test(path)) return true;
    return false;
  }

  // POST requests
  if (method === 'POST') {
    return writeRoutes.includes(path);
  }

  // PUT requests
  if (method === 'PUT') {
    if (/^\/api\/dispatch\/calls\/\d+$/.test(path)) return true;
    if (/^\/api\/dispatch\/units\/\d+$/.test(path)) return true;
    return false;
  }

  return false;
}

// ─── Handler: GET /api/auth/me ──────────────────────────────

async function handleGetMe(): Promise<OfflineResponse> {
  const userId = await getConfig('current_user_id');
  if (!userId) return { status: 401, error: 'Not authenticated offline' };

  const db = getOfflineDb();
  const user = await db.get('users', parseInt(userId, 10));

  if (!user) return { status: 404, error: 'User not found in local cache' };

  // Return same shape as server (exclude password_hash)
  const { password_hash, ...safeUser } = user;
  return { status: 200, data: safeUser };
}

// ─── Handler: GET /api/dispatch/calls ───────────────────────

async function handleGetCalls(query: Record<string, string>): Promise<OfflineResponse> {
  const db = getOfflineDb();
  let calls = await db.getAll('calls_for_service');

  // Filter by status
  if (query.status) {
    const statuses = query.status.split(',');
    calls = calls.filter(c => statuses.includes(c.status));
  }

  // Filter by priority
  if (query.priority) {
    calls = calls.filter(c => c.priority === query.priority);
  }

  // Sort by created_at descending
  calls.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

  // Limit
  const limit = parseInt(query.limit, 10) || 200;
  calls = calls.slice(0, limit);

  // Parse JSON fields to match server response shape
  const formatted = calls.map(row => ({
    ...row,
    notes: safeJsonParse(row.notes, []),
    assigned_unit_ids: safeJsonParse(row.assigned_unit_ids, []),
  }));

  return { status: 200, data: formatted };
}

// ─── Handler: POST /api/dispatch/calls ──────────────────────

async function handleCreateCall(body: any): Promise<OfflineResponse> {
  const db = getOfflineDb();
  const localId = `LOCAL-${crypto.randomUUID()}`;
  const callNumber = `CFS-${new Date().getFullYear()}-LOCAL-${Date.now().toString(36).toUpperCase()}`;
  const now = new Date().toISOString();

  const newCall: any = {
    local_id: localId,
    server_id: null,
    call_number: callNumber,
    incident_type: body.incident_type,
    priority: body.priority || 'P3',
    status: 'pending',
    caller_name: body.caller_name || null,
    caller_phone: body.caller_phone || null,
    location_address: body.location_address,
    property_id: body.property_id || null,
    client_id: body.client_id || null,
    latitude: body.latitude || null,
    longitude: body.longitude || null,
    description: body.description || null,
    notes: JSON.stringify(body.notes || []),
    source: body.source || 'dispatch',
    assigned_unit_ids: JSON.stringify(body.assigned_unit_ids || []),
    dispatcher_id: body.dispatcher_id || null,
    created_at: now,
    updated_at: now,
    dispatched_at: null,
    enroute_at: null,
    onscene_at: null,
    cleared_at: null,
    closed_at: null,
    disposition: null,
    is_dirty: 1,
    synced_at: null,
  };

  const id = await db.add('calls_for_service', newCall);
  newCall.id = id;

  // Enqueue for server sync
  await enqueue('POST', '/api/dispatch/calls', body, localId, 'calls_for_service');

  return {
    status: 201,
    data: {
      ...newCall,
      notes: safeJsonParse(newCall.notes, []),
      assigned_unit_ids: safeJsonParse(newCall.assigned_unit_ids, []),
    },
  };
}

// ─── Handler: GET /api/dispatch/calls/:id ───────────────────

async function handleGetCallById(id: string): Promise<OfflineResponse> {
  const db = getOfflineDb();

  // Try by numeric ID first
  const numId = parseInt(id, 10);
  let row = !isNaN(numId) ? await db.get('calls_for_service', numId) : undefined;

  // Try by local_id
  if (!row) {
    const byLocalId = await db.getAllFromIndex('calls_for_service', 'by-local-id', id);
    row = byLocalId[0];
  }

  if (!row) return { status: 404, error: 'Call not found' };

  return {
    status: 200,
    data: {
      ...row,
      notes: safeJsonParse(row.notes, []),
      assigned_unit_ids: safeJsonParse(row.assigned_unit_ids, []),
    },
  };
}

// ─── Handler: PUT /api/dispatch/calls/:id ───────────────────

async function handleUpdateCall(id: string, body: any): Promise<OfflineResponse> {
  const db = getOfflineDb();

  // Find existing
  const numId = parseInt(id, 10);
  let existing = !isNaN(numId) ? await db.get('calls_for_service', numId) : undefined;
  if (!existing) {
    const byLocalId = await db.getAllFromIndex('calls_for_service', 'by-local-id', id);
    existing = byLocalId[0];
  }
  if (!existing) return { status: 404, error: 'Call not found' };

  // Apply updatable fields
  const updatable = [
    'status', 'priority', 'assigned_unit_ids', 'description', 'disposition',
    'dispatched_at', 'enroute_at', 'onscene_at', 'cleared_at', 'closed_at',
    'notes', 'caller_name', 'caller_phone',
  ];

  const updated: any = { ...existing, updated_at: new Date().toISOString(), is_dirty: 1 };
  for (const key of updatable) {
    if (body[key] !== undefined) {
      updated[key] = typeof body[key] === 'object' ? JSON.stringify(body[key]) : body[key];
    }
  }

  await db.put('calls_for_service', updated);

  // Enqueue for server sync
  await enqueue(
    'PUT',
    `/api/dispatch/calls/${existing.server_id || existing.id}`,
    body,
    existing.local_id,
    'calls_for_service'
  );

  return {
    status: 200,
    data: {
      ...updated,
      notes: safeJsonParse(updated.notes, []),
      assigned_unit_ids: safeJsonParse(updated.assigned_unit_ids, []),
    },
  };
}

// ─── Handler: GET /api/dispatch/units ───────────────────────

async function handleGetUnits(): Promise<OfflineResponse> {
  const db = getOfflineDb();
  const units = await db.getAll('units');

  // Sort by call_sign ascending
  units.sort((a, b) => (a.call_sign || '').localeCompare(b.call_sign || ''));

  return {
    status: 200,
    data: units.map(u => ({
      ...u,
      capabilities: safeJsonParse(u.capabilities, []),
    })),
  };
}

// ─── Handler: PUT /api/dispatch/units/:id ───────────────────

async function handleUpdateUnit(id: string, body: any): Promise<OfflineResponse> {
  const db = getOfflineDb();
  const numId = parseInt(id, 10);
  const existing = await db.get('units', numId);
  if (!existing) return { status: 404, error: 'Unit not found' };

  const updatable = ['status', 'latitude', 'longitude', 'current_call_id', 'last_status_change'];
  const updated: any = { ...existing, is_dirty: 1 };

  for (const key of updatable) {
    if (body[key] !== undefined) {
      updated[key] = body[key];
    }
  }

  await db.put('units', updated);

  await enqueue('PUT', `/api/dispatch/units/${id}`, body, null, 'units');

  return {
    status: 200,
    data: { ...updated, capabilities: safeJsonParse(updated.capabilities, []) },
  };
}

// ─── Handler: POST /api/dispatch/gps ────────────────────────

async function handlePostGps(body: any): Promise<OfflineResponse> {
  const db = getOfflineDb();
  const points = Array.isArray(body) ? body : (body.points || [body]);

  const tx = db.transaction('gps_breadcrumbs', 'readwrite');
  for (const p of points) {
    await tx.store.add({
      unit_id: p.unit_id,
      officer_id: p.officer_id,
      call_sign: p.call_sign,
      latitude: p.latitude,
      longitude: p.longitude,
      accuracy: p.accuracy,
      heading: p.heading,
      speed: p.speed,
      unit_status: p.unit_status,
      recorded_at: p.recorded_at,
      is_synced: 0,
    } as any);
  }
  await tx.done;

  return { status: 200, data: { stored: points.length } };
}

// ─── Handler: GET /api/incidents ────────────────────────────

async function handleGetIncidents(query: Record<string, string>): Promise<OfflineResponse> {
  const db = getOfflineDb();
  let incidents = await db.getAll('incidents');

  if (query.status) {
    incidents = incidents.filter(i => i.status === query.status);
  }

  // Sort by created_at descending
  incidents.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

  const limit = parseInt(query.limit, 10) || 100;
  incidents = incidents.slice(0, limit);

  return { status: 200, data: incidents };
}

// ─── Handler: POST /api/incidents ───────────────────────────

async function handleCreateIncident(body: any): Promise<OfflineResponse> {
  const db = getOfflineDb();
  const localId = `LOCAL-${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  const newIncident: any = {
    local_id: localId,
    server_id: null,
    incident_number: null,
    incident_type: body.incident_type,
    priority: body.priority || 'P3',
    status: 'draft',
    location_address: body.location_address || null,
    property_id: body.property_id || null,
    narrative: body.narrative || null,
    officer_id: body.officer_id,
    supervisor_id: body.supervisor_id || null,
    call_id: body.call_id || null,
    created_at: now,
    updated_at: now,
    is_dirty: 1,
    synced_at: null,
  };

  const id = await db.add('incidents', newIncident);
  newIncident.id = id;

  await enqueue('POST', '/api/incidents', body, localId, 'incidents');

  return { status: 201, data: newIncident };
}

// ─── Handler: GET /api/records/persons ──────────────────────

async function handleSearchPersons(query: Record<string, string>): Promise<OfflineResponse> {
  const db = getOfflineDb();
  let persons = await db.getAll('persons');

  const searchTerm = query.search || query.q;
  if (searchTerm) {
    const term = searchTerm.toLowerCase();
    persons = persons.filter(p =>
      (p.first_name || '').toLowerCase().includes(term) ||
      (p.last_name || '').toLowerCase().includes(term) ||
      (p.dl_number || '').toLowerCase().includes(term) ||
      (p.phone || '').toLowerCase().includes(term)
    );
  }

  // Sort by last_name, first_name
  persons.sort((a, b) => {
    const cmp = (a.last_name || '').localeCompare(b.last_name || '');
    return cmp !== 0 ? cmp : (a.first_name || '').localeCompare(b.first_name || '');
  });

  const limit = parseInt(query.limit, 10) || 50;
  persons = persons.slice(0, limit);

  return {
    status: 200,
    data: persons.map(r => ({ ...r, flags: safeJsonParse(r.flags, []) })),
  };
}

// ─── Handler: GET /api/records/vehicles ─────────────────────

async function handleSearchVehicles(query: Record<string, string>): Promise<OfflineResponse> {
  const db = getOfflineDb();
  let vehicles = await db.getAll('vehicles_records');

  const searchTerm = query.search || query.q;
  if (searchTerm) {
    const term = searchTerm.toLowerCase();
    vehicles = vehicles.filter(v =>
      (v.plate_number || '').toLowerCase().includes(term) ||
      (v.vin || '').toLowerCase().includes(term) ||
      (v.make || '').toLowerCase().includes(term) ||
      (v.model || '').toLowerCase().includes(term)
    );
  }

  vehicles.sort((a, b) => (a.plate_number || '').localeCompare(b.plate_number || ''));

  const limit = parseInt(query.limit, 10) || 50;
  vehicles = vehicles.slice(0, limit);

  return {
    status: 200,
    data: vehicles.map(r => ({ ...r, flags: safeJsonParse(r.flags, []) })),
  };
}

// ─── Handler: POST /api/personnel/time/clock-in ─────────────

async function handleClockIn(body: any): Promise<OfflineResponse> {
  const db = getOfflineDb();
  const localId = `LOCAL-${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  const newEntry: any = {
    local_id: localId,
    server_id: null,
    officer_id: body.officer_id,
    schedule_id: body.schedule_id || null,
    clock_in: body.clock_in || now,
    clock_out: null,
    clock_in_latitude: body.latitude || null,
    clock_in_longitude: body.longitude || null,
    clock_out_latitude: null,
    clock_out_longitude: null,
    total_hours: null,
    break_minutes: 0,
    status: 'active',
    is_dirty: 1,
    synced_at: null,
  };

  const id = await db.add('time_entries', newEntry);
  newEntry.id = id;

  await enqueue('POST', '/api/personnel/time/clock-in', body, localId, 'time_entries');

  return { status: 201, data: newEntry };
}

// ─── Handler: POST /api/personnel/time/clock-out ───────────

async function handleClockOut(body: any): Promise<OfflineResponse> {
  const db = getOfflineDb();
  // Find the active time entry for this officer
  const allEntries = await db.getAll('time_entries');
  const active = allEntries.find(
    e => e.officer_id === body.officer_id && e.status === 'active'
  );

  if (!active) return { status: 404, error: 'No active time entry found' };

  const now = new Date().toISOString();
  const updated: any = {
    ...active,
    clock_out: body.clock_out || now,
    clock_out_latitude: body.latitude || null,
    clock_out_longitude: body.longitude || null,
    status: 'completed',
    is_dirty: 1,
    synced_at: null,
  };

  // Calculate total hours
  const inTime = new Date(active.clock_in).getTime();
  const outTime = new Date(updated.clock_out).getTime();
  updated.total_hours = Math.round(((outTime - inTime) / 3600000) * 100) / 100;

  await db.put('time_entries', updated);
  await enqueue('POST', '/api/personnel/time/clock-out', body, active.local_id, 'time_entries');

  return { status: 200, data: updated };
}

// ─── Handler: GET /api/citations ────────────────────────────

async function handleGetCitations(query: Record<string, string>): Promise<OfflineResponse> {
  const db = getOfflineDb();
  let rows = await db.getAll('citations');

  if (query.status) {
    const statuses = query.status.split(',');
    rows = rows.filter(r => statuses.includes(r.status));
  }
  if (query.type) {
    rows = rows.filter(r => r.type === query.type);
  }

  rows.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

  const limit = parseInt(query.limit, 10) || 100;
  rows = rows.slice(0, limit);

  return { status: 200, data: rows };
}

// ─── Handler: POST /api/citations ───────────────────────────

async function handleCreateCitation(body: any): Promise<OfflineResponse> {
  const db = getOfflineDb();
  const localId = `LOCAL-${crypto.randomUUID()}`;
  const citationNumber = `CIT-LOCAL-${Date.now().toString(36).toUpperCase()}`;
  const now = new Date().toISOString();

  const row: any = {
    local_id: localId,
    server_id: null,
    citation_number: citationNumber,
    type: body.type || 'traffic',
    status: body.status || 'issued',
    person_id: body.person_id || null,
    person_name: body.person_name || null,
    person_dob: body.person_dob || null,
    person_dl: body.person_dl || null,
    person_address: body.person_address || null,
    vehicle_description: body.vehicle_description || null,
    vehicle_plate: body.vehicle_plate || null,
    vehicle_state: body.vehicle_state || null,
    statute_id: body.statute_id || null,
    statute_citation: body.statute_citation || null,
    violation_description: body.violation_description || null,
    offense_level: body.offense_level || null,
    fine_amount: body.fine_amount || null,
    violation_date: body.violation_date || now,
    violation_time: body.violation_time || null,
    location: body.location || null,
    incident_id: body.incident_id || null,
    call_id: body.call_id || null,
    issuing_officer_id: body.issuing_officer_id || null,
    issuing_officer_name: body.issuing_officer_name || null,
    badge_number: body.badge_number || null,
    court_date: body.court_date || null,
    court_name: body.court_name || null,
    court_address: body.court_address || null,
    notes: body.notes || null,
    created_at: now,
    updated_at: now,
    is_dirty: 1,
    synced_at: null,
  };

  const id = await db.add('citations', row);
  row.id = id;

  await enqueue('POST', '/api/citations', body, localId, 'citations');

  return { status: 201, data: row };
}

// ─── Handler: GET /api/field-interviews ─────────────────────

async function handleGetFieldInterviews(query: Record<string, string>): Promise<OfflineResponse> {
  const db = getOfflineDb();
  let rows = await db.getAll('field_interviews');

  if (query.status) {
    rows = rows.filter(r => r.status === query.status);
  }

  const searchTerm = query.search || query.q;
  if (searchTerm) {
    const term = searchTerm.toLowerCase();
    rows = rows.filter(r =>
      (r.subject_first_name || '').toLowerCase().includes(term) ||
      (r.subject_last_name || '').toLowerCase().includes(term) ||
      (r.location || '').toLowerCase().includes(term)
    );
  }

  rows.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

  const limit = parseInt(query.limit, 10) || 100;
  rows = rows.slice(0, limit);

  return { status: 200, data: rows };
}

// ─── Handler: POST /api/field-interviews ────────────────────

async function handleCreateFieldInterview(body: any): Promise<OfflineResponse> {
  const db = getOfflineDb();
  const localId = `LOCAL-${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  const row: any = {
    local_id: localId,
    server_id: null,
    fi_number: null, // Server will assign
    person_id: body.person_id || null,
    subject_first_name: body.subject_first_name || null,
    subject_last_name: body.subject_last_name || null,
    subject_dob: body.subject_dob || null,
    subject_gender: body.subject_gender || null,
    subject_race: body.subject_race || null,
    subject_height: body.subject_height || null,
    subject_weight: body.subject_weight || null,
    subject_hair: body.subject_hair || null,
    subject_eye: body.subject_eye || null,
    subject_clothing: body.subject_clothing || null,
    subject_description: body.subject_description || null,
    location: body.location,
    latitude: body.latitude || null,
    longitude: body.longitude || null,
    property_id: body.property_id || null,
    contact_reason: body.contact_reason || 'other',
    contact_type: body.contact_type || 'field',
    action_taken: body.action_taken || 'none',
    narrative: body.narrative || null,
    vehicle_plate: body.vehicle_plate || null,
    vehicle_description: body.vehicle_description || null,
    vehicle_id: body.vehicle_id || null,
    associated_call_id: body.associated_call_id || null,
    associated_incident_id: body.associated_incident_id || null,
    officer_id: body.officer_id,
    officer_name: body.officer_name || null,
    status: 'active',
    created_at: now,
    archived_at: null,
    is_dirty: 1,
    synced_at: null,
  };

  const id = await db.add('field_interviews', row);
  row.id = id;

  await enqueue('POST', '/api/field-interviews', body, localId, 'field_interviews');

  return { status: 201, data: row };
}

// ─── Handler: GET /api/evidence ─────────────────────────────

async function handleGetEvidence(query: Record<string, string>): Promise<OfflineResponse> {
  const db = getOfflineDb();
  let rows = await db.getAll('evidence');

  if (query.status) {
    rows = rows.filter(r => r.status === query.status);
  }
  if (query.incident_id) {
    const incId = parseInt(query.incident_id, 10);
    rows = rows.filter(r => r.incident_id === incId);
  }

  rows.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

  const limit = parseInt(query.limit, 10) || 100;
  rows = rows.slice(0, limit);

  return {
    status: 200,
    data: rows.map(r => ({
      ...r,
      chain_of_custody: safeJsonParse(r.chain_of_custody, []),
    })),
  };
}

// ─── Handler: POST /api/evidence ────────────────────────────

async function handleCreateEvidence(body: any): Promise<OfflineResponse> {
  const db = getOfflineDb();
  const localId = `LOCAL-${crypto.randomUUID()}`;
  const evidenceNumber = `EV-LOCAL-${Date.now().toString(36).toUpperCase()}`;
  const now = new Date().toISOString();

  const row: any = {
    local_id: localId,
    server_id: null,
    evidence_number: evidenceNumber,
    incident_id: body.incident_id || null,
    description: body.description || null,
    evidence_type: body.evidence_type || null,
    category: body.category || null,
    storage_location: body.storage_location || null,
    collected_by: body.collected_by || null,
    status: body.status || 'received',
    chain_of_custody: JSON.stringify(body.chain_of_custody || []),
    location_found: body.location_found || null,
    condition: body.condition || null,
    quantity: body.quantity || 1,
    collected_date: body.collected_date || now,
    notes: body.notes || null,
    created_at: now,
    updated_at: now,
    is_dirty: 1,
    synced_at: null,
  };

  const id = await db.add('evidence', row);
  row.id = id;

  await enqueue('POST', '/api/evidence', body, localId, 'evidence');

  return { status: 201, data: { ...row, chain_of_custody: safeJsonParse(row.chain_of_custody, []) } };
}

// ─── Handler: GET /api/arrests ──────────────────────────────

async function handleGetArrests(query: Record<string, string>): Promise<OfflineResponse> {
  const db = getOfflineDb();
  let rows = await db.getAll('criminal_history');

  // Filter to arrest records by default
  rows = rows.filter(r => r.record_type === 'arrest');

  if (query.person_id) {
    const pid = parseInt(query.person_id, 10);
    rows = rows.filter(r => r.person_id === pid);
  }

  rows.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

  const limit = parseInt(query.limit, 10) || 100;
  rows = rows.slice(0, limit);

  return { status: 200, data: rows };
}

// ─── Handler: POST /api/arrests ─────────────────────────────

async function handleCreateArrest(body: any): Promise<OfflineResponse> {
  const db = getOfflineDb();
  const localId = `LOCAL-${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  const row: any = {
    local_id: localId,
    server_id: null,
    person_id: body.person_id,
    record_type: 'arrest',
    offense: body.offense,
    offense_level: body.offense_level || null,
    statute: body.statute || null,
    case_number: body.case_number || null,
    agency: body.agency || 'RMPG',
    jurisdiction: body.jurisdiction || null,
    offense_date: body.offense_date || now,
    disposition: body.disposition || null,
    disposition_date: body.disposition_date || null,
    sentence: body.sentence || null,
    source: body.source || 'field',
    notes: body.notes || null,
    created_by: body.created_by,
    created_at: now,
    updated_at: now,
    is_dirty: 1,
    synced_at: null,
  };

  const id = await db.add('criminal_history', row);
  row.id = id;

  await enqueue('POST', '/api/arrests', body, localId, 'criminal_history');

  return { status: 201, data: row };
}

// ─── Handler: GET /api/patrol/checkpoints ───────────────────

async function handleGetPatrolCheckpoints(query: Record<string, string>): Promise<OfflineResponse> {
  const db = getOfflineDb();
  let rows = await db.getAll('patrol_checkpoints');

  if (query.property_id) {
    const pid = parseInt(query.property_id, 10);
    rows = rows.filter(r => r.property_id === pid);
  }

  // Only active checkpoints by default
  if (!query.include_inactive) {
    rows = rows.filter(r => r.is_active === 1);
  }

  rows.sort((a, b) => (a.sequence_order || 0) - (b.sequence_order || 0));

  return { status: 200, data: rows };
}

// ─── Handler: POST /api/patrol/checkpoints (scan) ───────────

async function handleCreatePatrolScan(body: any): Promise<OfflineResponse> {
  const db = getOfflineDb();
  const localId = `LOCAL-${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  const row: any = {
    local_id: localId,
    server_id: null,
    checkpoint_id: body.checkpoint_id,
    officer_id: body.officer_id,
    scanned_at: body.scanned_at || now,
    latitude: body.latitude || null,
    longitude: body.longitude || null,
    notes: body.notes || null,
    status: body.status || 'on_time',
    is_dirty: 1,
    synced_at: null,
  };

  const id = await db.add('patrol_scans', row);
  row.id = id;

  await enqueue('POST', '/api/patrol/checkpoints', body, localId, 'patrol_scans');

  return { status: 201, data: row };
}

// ─── Handler: GET /api/trespass-orders ──────────────────────

async function handleGetTrespassOrders(query: Record<string, string>): Promise<OfflineResponse> {
  const db = getOfflineDb();
  let rows = await db.getAll('trespass_orders');

  if (query.status) {
    rows = rows.filter(r => r.status === query.status);
  }
  if (query.property_id) {
    const pid = parseInt(query.property_id, 10);
    rows = rows.filter(r => r.property_id === pid);
  }

  const searchTerm = query.search || query.q;
  if (searchTerm) {
    const term = searchTerm.toLowerCase();
    rows = rows.filter(r =>
      (r.subject_first_name || '').toLowerCase().includes(term) ||
      (r.subject_last_name || '').toLowerCase().includes(term) ||
      (r.order_number || '').toLowerCase().includes(term)
    );
  }

  rows.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

  const limit = parseInt(query.limit, 10) || 100;
  rows = rows.slice(0, limit);

  return { status: 200, data: rows };
}

// ─── Handler: POST /api/trespass-orders ─────────────────────

async function handleCreateTrespassOrder(body: any): Promise<OfflineResponse> {
  const db = getOfflineDb();
  const localId = `LOCAL-${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  const row: any = {
    local_id: localId,
    server_id: null,
    order_number: null, // Server will assign
    person_id: body.person_id || null,
    subject_first_name: body.subject_first_name,
    subject_last_name: body.subject_last_name,
    subject_dob: body.subject_dob || null,
    subject_description: body.subject_description || null,
    property_id: body.property_id || null,
    property_name: body.property_name || null,
    location: body.location,
    order_type: body.order_type || 'trespass_warning',
    status: 'active',
    reason: body.reason || null,
    conditions: body.conditions || null,
    duration_days: body.duration_days || null,
    effective_date: body.effective_date || now,
    expiration_date: body.expiration_date || null,
    served_at: body.served_at || null,
    served_by: body.served_by || null,
    originating_call_id: body.originating_call_id || null,
    originating_incident_id: body.originating_incident_id || null,
    issued_by: body.issued_by,
    issued_by_name: body.issued_by_name || null,
    authorized_by: body.authorized_by || null,
    notes: body.notes || null,
    archived_at: null,
    created_at: now,
    updated_at: now,
    is_dirty: 1,
    synced_at: null,
  };

  const id = await db.add('trespass_orders', row);
  row.id = id;

  await enqueue('POST', '/api/trespass-orders', body, localId, 'trespass_orders');

  return { status: 201, data: row };
}

// ─── Handler: GET /api/warrants (read-only cache) ───────────

async function handleGetWarrants(query: Record<string, string>): Promise<OfflineResponse> {
  const db = getOfflineDb();
  let rows = await db.getAll('warrants');

  if (query.status) {
    const statuses = query.status.split(',');
    rows = rows.filter(r => statuses.includes(r.status));
  } else {
    // Default to active warrants only
    rows = rows.filter(r => r.status === 'active');
  }

  const searchTerm = query.search || query.q;
  if (searchTerm) {
    const term = searchTerm.toLowerCase();
    rows = rows.filter(r =>
      (r.warrant_number || '').toLowerCase().includes(term) ||
      (r.charge_description || '').toLowerCase().includes(term)
    );
  }

  rows.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

  const limit = parseInt(query.limit, 10) || 100;
  rows = rows.slice(0, limit);

  return { status: 200, data: rows };
}

// ─── Handler: GET /api/warrants/check/:personId ─────────────

async function handleCheckWarrants(personId: string): Promise<OfflineResponse> {
  const db = getOfflineDb();
  const pid = parseInt(personId, 10);

  const allWarrants = await db.getAll('warrants');
  const matching = allWarrants.filter(
    w => w.subject_person_id === pid && w.status === 'active'
  );

  return {
    status: 200,
    data: {
      person_id: pid,
      has_warrants: matching.length > 0,
      warrants: matching,
      count: matching.length,
      source: 'offline_cache',
    },
  };
}

// ─── Utility ────────────────────────────────────────────────

function safeJsonParse(str: any, fallback: any): any {
  if (!str) return fallback;
  if (typeof str !== 'string') return str; // Already parsed
  try { return JSON.parse(str); } catch { return fallback; }
}

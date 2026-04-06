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

    return { status: 503, error: 'Endpoint not available offline' };
  } catch (err: any) {
    console.error(`[OFFLINE-ROUTER] Error handling ${method} ${path}:`, err.message);
    return { status: 500, error: err.message };
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
  ];

  const writeRoutes = [
    '/api/dispatch/calls',
    '/api/dispatch/gps',
    '/api/incidents',
    '/api/personnel/time/clock-in',
    '/api/personnel/time-entries',
  ];

  // GET requests — check read routes and parameterized routes
  if (method === 'GET') {
    if (readRoutes.some(r => path === r || path.startsWith(r + '/'))) return true;
    if (/^\/api\/dispatch\/calls\/\d+$/.test(path)) return true;
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

// ─── Utility ────────────────────────────────────────────────

function safeJsonParse(str: any, fallback: any): any {
  if (!str) return fallback;
  if (typeof str !== 'string') return str; // Already parsed
  try { return JSON.parse(str); } catch { return fallback; }
}

import { Hono } from 'hono';
import type { Env } from '../../types';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { getDb, query, queryFirst, execute } from '../../utils/db';
import { authMiddleware, requireRole } from '../../middleware/auth';
import { applyRunCard } from '../runCards';
import { sendToUser, broadcastAll } from '../ws';
import { geocodeAddress } from '../geocode';

const calls = new Hono<Env>();

// D1 caps a result set at 100 columns. calls_for_service has been pushed to
// ~100 cols (see memory project-live-d1-schema-patches), so `SELECT c.* +
// any JOIN columns` exceeds the cap and returns SQLITE_ERROR 7500
// "too many columns in result set". This is the column set the list/queue/
// active views actually project — wide enough that the dispatch panel, MDT,
// and map page render correctly without re-fetching, narrow enough to leave
// headroom for the 3 joined name columns (property/dispatcher/client).
//
// Any column NOT in this list will not appear in list-row responses. The
// single-call GET (/:id) still returns SELECT *, so detail panels are
// unaffected.
export const LIST_VIEW_COLUMNS = [
  // IDs / metadata
  'id', 'call_number', 'incident_type', 'secondary_type',
  'priority', 'priority_score', 'status', 'previous_status',
  'status_changed_at', 'source', 'dispatch_code',
  // Timing
  'created_at', 'received_at', 'dispatched_at', 'enroute_at', 'onscene_at',
  'cleared_at', 'closed_at', 'archived_at', 'updated_at',
  'response_time_seconds', 'onscene_duration_seconds',
  // Location
  'location_address', 'latitude', 'longitude',
  'cross_street', 'location_building', 'location_floor', 'location_room',
  // Caller / contact
  'caller_name', 'caller_phone', 'contact_method',
  // Foreign refs (names come from JOINs below)
  'dispatcher_id', 'property_id', 'client_id',
  'case_id', 'case_number', 'contract_id',
  // Free-text + outcome
  'description', 'notes', 'disposition', 'action_taken',
  // Units
  'assigned_unit_ids', 'unit_call_signs',
  // Geography
  'sector_id', 'sector_name', 'zone_id', 'zone_name', 'zone_beat',
  'beat_id', 'beat_name', 'beat_descriptor',
  // Safety flags (most-read by dispatcher; the rest live on the detail GET).
  // Intentionally excluded: `pinned` and `officer_safety_caution` — both are
  // in UPDATABLE_CALL_COLUMNS_BASE but not in any /migrations/ file (live D1
  // patched directly per memory project-live-d1-schema-patches). Including
  // them risks `no such column` 500s on prod if the patch was never applied.
  // Re-add once a migration backfills them.
  'weapons_involved', 'injuries_reported', 'domestic_violence',
  // Mileage + overdue
  'starting_mileage', 'ending_mileage', 'overdue_notified',
] as const;

// Pre-built `c.col1, c.col2, ...` fragment used in every list query.
// Exported so peer routers (callLinks, aggregates) can reuse it instead of
// rebuilding the join string and risk drifting from this projection.
export const LIST_VIEW_SELECT = LIST_VIEW_COLUMNS.map(col => `c.${col}`).join(', ');

// GET /dispatch/calls - List calls with filters (also handles /active via query param)
calls.get('/', async (c) => {
  try {
    const db = getDb(c.env);
    const { status, priority, startDate, endDate, search, archived, page, limit, active } = c.req.query();

    let where = 'WHERE 1=1';
    const params: unknown[] = [];

    if (status) {
      const statuses = status.split(',').map(s => s.trim()).filter(Boolean);
      if (statuses.length === 1) { where += ' AND c.status = ?'; params.push(statuses[0]); }
      else if (statuses.length > 1) { where += ` AND c.status IN (${statuses.map(() => '?').join(',')})`; params.push(...statuses); }
    }
    if (priority) { where += ' AND c.priority = ?'; params.push(priority.toUpperCase()); }
    if (startDate) { where += ' AND c.created_at >= ?'; params.push(startDate); }
    if (endDate) { where += ' AND c.created_at <= ?'; params.push(endDate); }
    if (search) {
      where += " AND (c.call_number LIKE ? OR c.incident_type LIKE ? OR c.location_address LIKE ? OR c.description LIKE ?)";
      const s = `%${search}%`; params.push(s, s, s, s);
    }
    if (archived === 'true') where += " AND c.status = 'archived'";
    else if (archived !== 'all') where += " AND c.status != 'archived'";

    if (active === 'true' || (!status && !archived)) {
      where = "WHERE c.status IN ('dispatched','enroute','onscene','pending','open')";
    }

    const pageNum = Math.max(1, parseInt(page || '1', 10));
    const limitNum = Math.min(1000, Math.max(1, parseInt(limit || '200', 10)));
    const offset = (pageNum - 1) * limitNum;

    const [{ total }] = await query<{ total: number }>(db, `SELECT COUNT(*) as total FROM calls_for_service c ${where}`, ...params);

    // Narrow projection — see LIST_VIEW_COLUMNS comment for the D1 100-col
    // result-set cap. SELECT c.* + JOIN columns 500s; this stays under ~60.
    // cfe.pinned + cfe.held_at are TWO explicit columns off the ext table —
    // safe under the result-set cap (the cap problem is SELECT c.*, not a few
    // joined cols). Sorted pinned-first so a dispatcher's pinned calls stay on
    // top across refreshes (PATCH /:id/pin writes cfe.pinned).
    //   NOTE: a parallel PR added the `cfe.held_at` join with alias `cfe`
    //   while #728 had added pinning with alias `cfse`; the squash kept
    //   `cfse` in the ORDER BY but only the `cfe` join, 500ing the queue.
    //   Both now use the single `cfe` alias.
    const rows = await query<Record<string, unknown>>(db, `
      SELECT ${LIST_VIEW_SELECT},
        p.name as property_name, u.full_name as dispatcher_name,
        cl.name as client_name, cfe.held_at,
        COALESCE(cfe.pinned, 0) as pinned
      FROM calls_for_service c
      LEFT JOIN properties p ON c.property_id = p.id
      LEFT JOIN users u ON c.dispatcher_id = u.id
      LEFT JOIN clients cl ON COALESCE(c.client_id, p.client_id) = cl.id
      LEFT JOIN calls_for_service_ext cfe ON cfe.id = c.id
      ${where}
      ORDER BY COALESCE(cfe.pinned, 0) DESC, c.priority_score IS NOT NULL, c.priority_score DESC, c.created_at DESC
      LIMIT ? OFFSET ?
    `, ...params, limitNum, offset);

    return c.json({
      data: rows,
      pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (err) {
    console.error('Get calls error:', err);
    return c.json({ error: 'Failed to get calls' }, 500);
  }
});

// POST /dispatch/calls - Create call
calls.post('/', async (c) => {
  try {
    const db = getDb(c.env);
    const body = await c.req.json<Record<string, unknown>>();
    const userId = c.get('userId') as number;

    const { incident_type, priority, location_address } = body;
    if (!incident_type || !priority || !location_address) {
      return c.json({ error: 'incident_type, priority, and location_address are required' }, 400);
    }

    // ── Run Card application (Spillman parity, DI-1) ──
    // Caller-provided fields always win; the run card fills only
    // nullish/empty entries. Records run_card_id + run_card_applied_at
    // on the call row.
    const normalizedIncidentType = String(incident_type || '').trim().toLowerCase().replace(/\s+/g, '_');
    const rcResult = await applyRunCard(db, normalizedIncidentType, String(priority).toUpperCase(), {
      weapons_involved: body.weapons_involved,
      injuries_reported: body.injuries_reported,
      domestic_violence: body.domestic_violence,
      alcohol_involved: body.alcohol_involved,
      mental_health_crisis: body.mental_health_crisis,
      officer_safety_caution: body.officer_safety_caution,
      felony_in_progress: body.felony_in_progress,
      vehicle_pursuit: body.vehicle_pursuit,
      foot_pursuit: body.foot_pursuit,
      hazmat: body.hazmat,
      ems_requested: body.ems_requested,
      fire_requested: body.fire_requested,
    });
    if (rcResult.card) {
      for (const [k, v] of Object.entries(rcResult.appliedFlags)) {
        if (body[k] == null || body[k] === '') body[k] = v as any;
      }
    }

    // Call-number format: CFS{YY}-{NNNNN}, 5-digit sequence, resets
    // each calendar year (the LIKE filter is YY-scoped so MAX() only
    // sees this year's rows). Example: CFS26-00001.
    // Back-compat: legacy rows used "{YY}-CFS{NNNNN}" — those still
    // co-exist; the LIKE here only scans the new format so we don't
    // collide with the old sequence.
    const year = new Date().getFullYear().toString().slice(-2);
    const prefix = `CFS${year}-`;
    const [{ max }] = await query<{ max: string | null }>(
      db,
      "SELECT MAX(call_number) as max FROM calls_for_service WHERE call_number LIKE ?",
      `${prefix}%`,
    );
    const seq = max
      ? String(parseInt(max.slice(prefix.length), 10) + 1).padStart(5, '0')
      : '00001';
    const callNumber = `${prefix}${seq}`;

    // FK guard — restored-pending-draft can carry a stale property_id
    // from localStorage that no longer exists in this database. If
    // the ID doesn't resolve, drop it rather than failing the INSERT
    // with SQLITE_CONSTRAINT_FOREIGNKEY (the production crash this
    // change is fixing).
    if (body.property_id != null && body.property_id !== '') {
      const exists = await queryFirst<{ id: number }>(
        db, 'SELECT id FROM properties WHERE id = ?', body.property_id,
      );
      if (!exists) body.property_id = null;
    }
    // Same guard for client_id when present (some clients send it
    // directly on create instead of inheriting via property).
    if ((body as any).client_id != null && (body as any).client_id !== '') {
      const exists = await queryFirst<{ id: number }>(
        db, 'SELECT id FROM clients WHERE id = ?', (body as any).client_id,
      );
      if (!exists) (body as any).client_id = null;
    }
    // dispatcher_id is taken from JWT below — but verify the user row
    // still exists (sessions can outlive deleted users).
    const dispatcherExists = await queryFirst<{ id: number }>(
      db, 'SELECT id FROM users WHERE id = ?', userId,
    );
    if (!dispatcherExists) {
      return c.json({ error: 'Your user account no longer exists; please re-login' }, 401);
    }

    // Always populate map coordinates for the CFS location. If the caller
    // didn't supply lat/lng (created via the API, the CAD command line, or any
    // path that skipped the address-autocomplete pick), forward-geocode the
    // address server-side so EVERY call plots on the dispatch map and
    // closest-unit ranking works. Best-effort — a geocode miss must never block
    // call creation; the call just keeps null coords as before.
    const hasLat = body.latitude != null && body.latitude !== '';
    const hasLng = body.longitude != null && body.longitude !== '';
    if ((!hasLat || !hasLng) && typeof body.location_address === 'string' && body.location_address.trim().length >= 3) {
      const coords = await geocodeAddress(c.env, body.location_address);
      if (coords) {
        body.latitude = coords.lat;
        body.longitude = coords.lng;
      }
    }

    const cols: string[] = [];
    const vals: string[] = [];
    const bindParams: unknown[] = [];

    const fieldMap: Record<string, string> = {
      incident_type: '@incident_type', priority: '@priority', status: '@status',
      caller_name: '@caller_name', caller_phone: '@caller_phone', location_address: '@location_address',
      description: '@description', notes: '@notes', source: '@source',
      latitude: '@latitude', longitude: '@longitude', property_id: '@property_id',
      dispatcher_id: '@dispatcher_id',
    };
    
    // created_at / updated_at use datetime('now') = UTC (the Workers/D1 host
    // runs in UTC). App standard is UTC storage + browser-local display via
    // the client's parseTimestamp. Do NOT store local/MST wall-clock here —
    // the display layer reads naive strings as UTC and would render them ~6h
    // off (see the utcNow() note in dispatch/extensions.ts).
    cols.push('call_number', 'dispatcher_id', 'created_at', 'updated_at');
    vals.push('?', '?', "datetime('now')", "datetime('now')");
    bindParams.push(callNumber, userId);

    // Same whitelist applies on create as on edit. Use the
    // UPDATABLE_CALL_COLUMNS_BASE set so any column writable later is
    // writable on insert. Skip immutable cols (id, call_number,
    // created_at, dispatcher_id — set above).
    const skipOnCreate = new Set(['id', 'call_number', 'created_at', 'dispatcher_id']);
    for (const [key, val] of Object.entries(body)) {
      if (skipOnCreate.has(key)) continue;
      if (UPDATABLE_CALL_COLUMNS_BASE.has(key)) {
        cols.push(key);
        vals.push('?');
        bindParams.push(val ?? null);
      }
    }

    // Note: run_card_id + run_card_applied_at intentionally NOT written to
    // calls_for_service here. The base table is at the D1 100-column cap;
    // adding columns would break GET /:id which does SELECT *. Those two
    // columns live on calls_for_service_ext (1:1) per the existing PSO/
    // process-service overflow pattern. We write to ext after the INSERT
    // succeeds (below) so the call row commits even if the ext write fails.

    try {
      const result = await execute(db, `INSERT INTO calls_for_service (${cols.join(',')}) VALUES (${vals.join(',')})`, ...bindParams);
      const callId = Number(result.meta.last_row_id);

      // Record which run card was applied — to ext (PSO/process-service home).
      // INSERT OR IGNORE then UPDATE matches the rest of the ext write flow.
      // Best-effort: never block call creation on the ext write.
      if (rcResult.card) {
        try {
          await execute(db, 'INSERT OR IGNORE INTO calls_for_service_ext (id) VALUES (?)', callId);
          await execute(
            db,
            'UPDATE calls_for_service_ext SET run_card_id = ?, run_card_applied_at = ? WHERE id = ?',
            rcResult.card.id,
            new Date().toISOString(),
            callId,
          );
        } catch (extErr) {
          console.warn('run_card ext write failed (non-fatal):', extErr);
        }
      }

      const call = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM calls_for_service WHERE id = ?', callId);

      // Audit trail entry — dispatch's Audit tab reads audit_log by
      // entity_type='call' + entity_id. Failure shouldn't block the create.
      try {
        await execute(
          db,
          `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details, created_at)
           VALUES (?, ?, ?, ?, ?, datetime('now'))`,
          userId, 'CREATE', 'call', callId, `Created call ${callNumber}`,
        );
      } catch (auditErr) {
        console.warn('audit_log insert failed for call create:', auditErr);
      }

      // Broadcast to every connected dispatcher so rosters re-render
      // without a manual refresh. Matches the legacy POST behavior.
      broadcastAll('dispatch_update', { action: 'call_created', call });

      return c.json({ ...call, runCard: rcResult.card }, 201);
    } catch (sqlErr: any) {
      // Surface the real SQL error so the dispatcher (and we) can see
      // which column / FK is rejecting. Without this the client sees a
      // generic 500 and we can't debug from production.
      const msg = String(sqlErr?.message || sqlErr || 'unknown');
      console.error('Create call INSERT failed:', {
        msg,
        userId,
        cols,
        params: bindParams,
      });
      if (msg.includes('FOREIGN KEY')) {
        return c.json({
          error: `Foreign key constraint failed. dispatcher_id=${userId} (must reference users.id), property_id=${body.property_id ?? null}, client_id=${(body as any).client_id ?? null}. Detail: ${msg}`,
          code: 'FK_VIOLATION',
        }, 500);
      }
      return c.json({ error: `Failed to create call: ${msg}`, code: 'INSERT_FAILED' }, 500);
    }
  } catch (err: any) {
    console.error('Create call outer error:', err);
    return c.json({ error: `Failed to create call: ${err?.message || 'unknown'}`, code: 'OUTER_ERROR' }, 500);
  }
});

// GET /dispatch/calls/active - Active calls shortcut
calls.get('/active', async (c) => {
  try {
    const db = getDb(c.env);
    // Narrow projection — see LIST_VIEW_COLUMNS for D1 100-col cap rationale.
    const rows = await query<Record<string, unknown>>(db, `
      SELECT ${LIST_VIEW_SELECT},
        u.full_name as dispatcher_name, p.name as property_name
      FROM calls_for_service c
      LEFT JOIN users u ON c.dispatcher_id = u.id
      LEFT JOIN properties p ON c.property_id = p.id
      WHERE c.status IN ('dispatched','enroute','onscene','pending','open')
      ORDER BY c.created_at DESC LIMIT 200
    `);
    return c.json(rows);
  } catch (err) {
    return c.json({ error: 'Failed to get active calls' }, 500);
  }
});

// GET /dispatch/calls/export - CSV export
calls.get('/export', async (c) => {
  try {
    const db = getDb(c.env);
    const { status, priority, startDate, endDate } = c.req.query();
    let where = 'WHERE 1=1';
    const params: unknown[] = [];
    if (status) { where += ' AND c.status = ?'; params.push(status); }
    if (priority) { where += ' AND c.priority = ?'; params.push(priority); }
    if (startDate) { where += ' AND c.created_at >= ?'; params.push(startDate); }
    if (endDate) { where += ' AND c.created_at <= ?'; params.push(endDate); }

    const rows = await query<Record<string, unknown>>(db, `
      SELECT c.call_number, c.incident_type, c.priority, c.status, c.caller_name,
        c.location_address, c.description, c.source, c.disposition, c.created_at, c.cleared_at
      FROM calls_for_service c ${where} ORDER BY c.created_at DESC LIMIT 50000
    `, ...params);

    // Timestamps are stored UTC; the app's primary timezone is Mountain
    // (America/Denver). Render the exported created_at/cleared_at in MT so the
    // CSV matches what dispatchers see in the UI. Workers ship full ICU, so
    // Intl with an IANA zone is available. DST-aware.
    const toMountain = (v: unknown): string => {
      if (v == null || v === '') return '';
      const s = String(v);
      // Parse naive "YYYY-MM-DD HH:MM:SS" as UTC; pass through tz-aware forms.
      const hasTz = (s.includes('T') && (/[zZ]$/.test(s) || /[+-]\d{2}:?\d{2}$/.test(s)));
      const iso = hasTz ? s : (s.includes(' ') ? s.replace(' ', 'T') + 'Z' : (s.includes('T') ? s + 'Z' : s));
      const d = new Date(iso);
      if (isNaN(d.getTime())) return s;
      const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(d);
      const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
      return `${g('year')}-${g('month')}-${g('day')} ${g('hour')}:${g('minute')}:${g('second')} MT`;
    };

    const csv = ['call_number,incident_type,priority,status,caller_name,location_address,description,source,disposition,created_at,cleared_at',
      ...rows.map(r => [r.call_number, r.incident_type, r.priority, r.status, r.caller_name, r.location_address, r.description, r.source, r.disposition, toMountain(r.created_at), toMountain(r.cleared_at)].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    return c.newResponse(csv, 200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename=calls_export.csv' });
  } catch (err) {
    return c.json({ error: 'Failed to export calls' }, 500);
  }
});

// GET /dispatch/calls/check-duplicate
calls.get('/check-duplicate', async (c) => {
  try {
    const db = getDb(c.env);
    const address = c.req.query('address');
    if (!address || address.length < 3) return c.json({ duplicates: [], count: 0 });

    const normalized = address.toUpperCase().replace(/\s+/g, ' ').trim();
    const rows = await query<Record<string, unknown>>(db, `
      SELECT id, call_number, incident_type, priority, status, location_address, created_at
      FROM calls_for_service
      WHERE status NOT IN ('cleared','closed','cancelled','archived')
        AND UPPER(REPLACE(location_address, '  ', ' ')) LIKE ?
      ORDER BY created_at DESC LIMIT 5
    `, `%${normalized}%`);

    return c.json({ duplicates: rows, count: rows.length });
  } catch (err) {
    return c.json({ error: 'Duplicate check failed' }, 500);
  }
});

// GET /dispatch/calls/archive-bulk - MUST be before /:id routes
calls.get('/archive-bulk', async (c) => {
  // redirect to POST
  return c.redirect('/dispatch/calls/archive-bulk', 307);
});

calls.post('/archive-bulk', async (c) => {
  try {
    const db = getDb(c.env);
    // Honor the client's { statuses } body (handleBulkArchive sends
    // ['cleared','closed','cancelled']) and return { archived_count } — the
    // client gates its list refresh on archived_count > 0, so the old
    // {message} response meant the UI never refreshed after a bulk archive.
    const body = await c.req.json<{ statuses?: string[] }>().catch(() => ({} as { statuses?: string[] }));
    const ARCHIVABLE = ['cleared', 'closed', 'cancelled'];
    const requested = Array.isArray(body.statuses) && body.statuses.length > 0 ? body.statuses : ARCHIVABLE;
    const statuses = requested.filter((s) => ARCHIVABLE.includes(s));
    if (statuses.length === 0) return c.json({ archived_count: 0 });

    const placeholders = statuses.map(() => '?').join(',');
    const result = await execute(db,
      `UPDATE calls_for_service SET status = 'archived', archived_at = datetime('now') WHERE status IN (${placeholders})`,
      ...statuses);
    const archived_count = (result as any)?.meta?.changes ?? 0;
    return c.json({ archived_count });
  } catch (err) {
    return c.json({ error: 'Bulk archive failed' }, 500);
  }
});

// GET /dispatch/calls/:id - Single call
// Split into multiple narrow queries instead of one wide JOIN because D1
// caps result sets at 100 columns. calls_for_service is ~93 columns; adding
// property/user/client JOIN columns or LEFT JOIN calls_for_service_ext blew
// past the cap and produced SQLITE_ERROR 7500 "too many columns in result set".
calls.get('/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');

    const call = await queryFirst<Record<string, unknown>>(
      db, 'SELECT * FROM calls_for_service WHERE id = ?', id);
    if (!call) return c.json({ error: 'Call not found' }, 404);

    const ext = await queryFirst<Record<string, unknown>>(
      db, 'SELECT * FROM calls_for_service_ext WHERE id = ?', id);

    // Re-dispatch ("return visit") chain. For PSO/process-service calls, attach
    // the prior attempts as visit_history so the detail panel's "PRIOR VISITS"
    // list renders. The chain is flat — children carry ext.parent_call_id =
    // ROOT id — so a call's root is its own parent_call_id (if a child) or its
    // own id (if the root). Reconstructed from calls_for_service + ext; the
    // legacy call_visit_history snapshot table is unused (live repurposed it).
    let visit_history: Record<string, unknown>[] | undefined;
    if (['pso_client_request', 'process_service'].includes(String(call.incident_type))) {
      const rootId = Number((ext?.parent_call_id as number | null) ?? call.id);
      const currentAttempt = Number((ext?.pso_attempt_number as number | null) ?? (call.pso_attempt_number as number | null) ?? 1);
      visit_history = await query<Record<string, unknown>>(db, `
        SELECT c.id,
          COALESCE(e.pso_attempt_number, c.pso_attempt_number, 1) AS visit_number,
          c.status, c.disposition, c.unit_call_signs AS assigned_units,
          c.dispatched_at, c.enroute_at, c.onscene_at, c.cleared_at, c.closed_at,
          c.responding_vehicle_id, c.starting_mileage, c.ending_mileage
        FROM calls_for_service c
        LEFT JOIN calls_for_service_ext e ON e.id = c.id
        WHERE (c.id = ? OR e.parent_call_id = ?)
          AND c.id != ?
          AND COALESCE(e.pso_attempt_number, c.pso_attempt_number, 1) < ?
        ORDER BY visit_number ASC, c.id ASC
      `, rootId, rootId, Number(id), currentAttempt);
    }

    const joined = await queryFirst<Record<string, unknown>>(db, `
      SELECT p.name AS property_name, p.address AS property_address,
        p.gate_code, p.alarm_code, p.emergency_contact, p.post_orders, p.hazard_notes,
        u.full_name AS dispatcher_name, cl.name AS client_name
      FROM (SELECT ? AS property_id, ? AS dispatcher_id, ? AS client_id) ck
      LEFT JOIN properties p ON p.id = ck.property_id
      LEFT JOIN users u ON u.id = ck.dispatcher_id
      LEFT JOIN clients cl ON cl.id = COALESCE(ck.client_id, p.client_id)
    `, call.property_id ?? null, call.dispatcher_id ?? null, call.client_id ?? null);

    const assignedIds = JSON.parse(String(call.assigned_unit_ids || '[]')) as number[];
    const assignedUnits = assignedIds.length === 0 ? [] : await query<Record<string, unknown>>(db, `
      SELECT u.*, usr.full_name as officer_name, usr.badge_number
      FROM units u LEFT JOIN users usr ON u.officer_id = usr.id
      WHERE u.id IN (${assignedIds.map(() => '?').join(',')})
    `, ...assignedIds);

    const incidents = await query<Record<string, unknown>>(db,
      'SELECT id, incident_number, incident_type, status, created_at FROM incidents WHERE call_id = ? ORDER BY created_at DESC LIMIT 1000', id);

    const activity = await query<Record<string, unknown>>(db,
      'SELECT al.*, u.full_name as user_name FROM audit_log al LEFT JOIN users u ON al.user_id = u.id WHERE al.entity_type = ? AND al.entity_id = ? ORDER BY al.created_at DESC LIMIT 1000',
      'call', id);

    return c.json({
      ...call,
      ...(ext || {}),
      ...(joined || {}),
      assigned_units: assignedUnits,
      related_incidents: incidents,
      activity,
      ...(visit_history ? { visit_history } : {}),
    });
  } catch (err) {
    console.error('GET /dispatch/calls/:id failed:', err);
    return c.json({ error: 'Failed to get call', detail: (err as Error)?.message }, 500);
  }
});

// Updatable columns. Anything not in either set is silently dropped by PUT —
// prevents both "no such column" 500s when the client sends unknown fields
// and column-name injection via interpolated keys. Split across two tables
// because D1 caps a single table at 100 columns and the union exceeds that;
// PSO + process-service fields live in calls_for_service_ext (1:1).
// Keep in sync with migrations/0001_initial.sql + 0003_calls_for_service_extended.sql.
// Immutable (never updatable): id, call_number, created_at.
const UPDATABLE_CALL_COLUMNS_BASE = new Set<string>([
  // base (0001)
  'incident_type', 'priority', 'status', 'caller_name', 'caller_phone',
  'location_address', 'property_id', 'latitude', 'longitude', 'description',
  'notes', 'source', 'assigned_unit_ids', 'unit_call_signs', 'dispatcher_id',
  // Timeline timestamps — all admin-editable from the dispatch timeline.
  // created_at was previously omitted, so editing the "Created" time
  // returned {message:'No changes'} and the client blanked the call.
  'created_at', 'dispatched_at', 'enroute_at', 'onscene_at', 'cleared_at', 'closed_at',
  'disposition',
  // geography
  'sector_id', 'sector_name', 'zone_id', 'zone_name', 'zone_beat',
  'beat_id', 'beat_name', 'beat_descriptor', 'section_name',
  // caller / location detail
  'caller_relationship', 'caller_address', 'cross_street',
  'location_building', 'location_floor', 'location_room', 'contact_method',
  // subject / vehicle
  'num_subjects', 'num_victims', 'subject_description', 'vehicle_description',
  'direction_of_travel', 'weapons_involved',
  // scene
  'scene_safety', 'weather_conditions', 'lighting_conditions',
  'secondary_type', 'dispatch_code',
  // response
  'responding_officer', 'responding_vehicle_id', 'action_taken',
  // damage
  'damage_estimate', 'damage_description',
  // LE coordination
  'le_agency', 'le_case_number', 'le_notified', 'supervisor_notified',
  // tactical flags (base — first 7 added directly to calls_for_service;
  // 10 more flags overflowed to _ext when base hit the D1 100-col cap)
  'injuries_reported', 'alcohol_involved', 'drugs_involved', 'domestic_violence',
  'mental_health_crisis', 'juvenile_involved', 'felony_in_progress',
  'officer_safety_caution', 'k9_requested', 'ems_requested',
  // cross-linking
  'case_id', 'case_number', 'client_id', 'contract_id',
  // lifecycle
  'previous_status', 'status_changed_at', 'archived_at', 'received_at',
  'priority_score', 'response_time_seconds', 'onscene_duration_seconds',
  'starting_mileage', 'ending_mileage', 'overdue_notified',
]);

const UPDATABLE_CALL_COLUMNS_EXT = new Set<string>([
  // PSO
  'pso_requestor_name', 'pso_requestor_phone', 'pso_requestor_email',
  'pso_service_type', 'pso_billing_code', 'pso_authorization',
  'pso_72hr_deadline', 'pso_72hr_notified', 'pso_service_windows',
  'pso_attempt_number',
  // process service
  'process_service_type', 'process_served_to', 'process_served_address',
  'process_attempts', 'process_served_at', 'process_service_result',
  // tactical flags overflowed here on 2026-05-26 when calls_for_service hit
  // the 100-column D1 cap. New tactical flags should land here too.
  'fire_requested', 'hazmat', 'gang_related', 'evidence_collected',
  'body_camera_active', 'photos_taken', 'trespass_issued',
  'vehicle_pursuit', 'foot_pursuit', 'pinned',
  // Re-dispatch ("return visit") chain linkage (migration 0044). NULL = root
  // call; an int = the ROOT call id this attempt belongs to. Lives on ext
  // because calls_for_service is at the D1 100-column cap — the legacy worker
  // writes calls_for_service.parent_call_id (no longer exists) and 500s.
  'parent_call_id',
]);

// PUT /dispatch/calls/:id - Update call
calls.put('/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const existing = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM calls_for_service WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Call not found' }, 404);

    const body = await c.req.json<Record<string, unknown>>();

    // Re-geocode on address change: if this update changes location_address and
    // doesn't carry explicit valid coordinates, resolve fresh coords so the
    // call's map pin follows the new address. Without this, editing an address
    // strands the call off the map ("NO LOCATION DATA" / "Call has no GPS"),
    // since the edit form may send null/stale lat/lng. Mirrors the create-path
    // geocode (#735). Best-effort — never block the update on a geocode miss.
    if (typeof body.location_address === 'string'
        && body.location_address.trim().length >= 3
        && body.location_address !== existing.location_address) {
      const hasLat = body.latitude != null && body.latitude !== '';
      const hasLng = body.longitude != null && body.longitude !== '';
      if (!hasLat || !hasLng) {
        const coords = await geocodeAddress(c.env, body.location_address);
        if (coords) {
          body.latitude = coords.lat;
          body.longitude = coords.lng;
        }
      }
    }

    const baseUpdates: string[] = [];
    const baseParams: unknown[] = [];
    const extUpdates: string[] = [];
    const extParams: unknown[] = [];
    const skipped: string[] = [];

    for (const [key, val] of Object.entries(body)) {
      if (UPDATABLE_CALL_COLUMNS_BASE.has(key)) {
        baseUpdates.push(`${key} = ?`);
        baseParams.push(val ?? null);
      } else if (UPDATABLE_CALL_COLUMNS_EXT.has(key)) {
        extUpdates.push(`${key} = ?`);
        extParams.push(val ?? null);
      } else {
        skipped.push(key);
      }
    }

    if (baseUpdates.length === 0 && extUpdates.length === 0) {
      return c.json({ message: 'No changes', skipped });
    }

    // updated_at lives on base; bump it on any change so callers see it.
    baseUpdates.push("updated_at = datetime('now')");
    baseParams.push(id);
    await execute(db, `UPDATE calls_for_service SET ${baseUpdates.join(', ')} WHERE id = ?`, ...baseParams);

    if (extUpdates.length > 0) {
      // Ext row may not exist yet (created lazily on first ext-column write).
      await execute(db, 'INSERT OR IGNORE INTO calls_for_service_ext (id) VALUES (?)', id);
      extParams.push(id);
      await execute(db, `UPDATE calls_for_service_ext SET ${extUpdates.join(', ')} WHERE id = ?`, ...extParams);
    }

    // Split fetch to dodge D1's 100-column cap (base ~93 + ext 16 > 100).
    const updatedBase = await queryFirst<Record<string, unknown>>(
      db, 'SELECT * FROM calls_for_service WHERE id = ?', id);
    const updatedExt = await queryFirst<Record<string, unknown>>(
      db, 'SELECT * FROM calls_for_service_ext WHERE id = ?', id);
    return c.json({ ...(updatedBase || {}), ...(updatedExt || {}) });
  } catch (err) {
    console.error('PUT /dispatch/calls/:id failed:', err);
    return c.json({ error: 'Failed to update call', detail: (err as Error)?.message }, 500);
  }
});

// GET /dispatch/calls/:id/audit-trail — chronological event log for this call.
// Reads from audit_log filtered by entity_type='call'. The client renders
// { created_at, action, details, user_name } per row in the Audit tab
// (DispatchPage.tsx ~line 5280). Degrades to empty on error rather than 500
// so the tab doesn't break if audit_log schema drifts.
calls.get('/:id/audit-trail', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const rows = await query<{
      id: number; action: string; details: string | null;
      user_id: number | null; user_name: string | null;
      created_at: string;
    }>(
      db,
      `SELECT al.id, al.action, al.details, al.user_id,
              u.full_name as user_name, al.created_at
       FROM audit_log al
       LEFT JOIN users u ON u.id = al.user_id
       WHERE al.entity_type = 'call' AND al.entity_id = ?
       ORDER BY al.created_at DESC LIMIT 500`,
      id,
    );
    return c.json({ events: rows });
  } catch (err) {
    console.error('GET /dispatch/calls/:id/audit-trail failed:', err);
    return c.json({ events: [] });
  }
});

// DELETE /dispatch/calls/:id
calls.delete('/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    await execute(db, 'DELETE FROM calls_for_service WHERE id = ?', id);
    return c.json({ message: 'Call deleted' });
  } catch (err) {
    return c.json({ error: 'Failed to delete call' }, 500);
  }
});

// POST /dispatch/calls/:id/status - Status transition
calls.post('/:id/status', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    // The clear/close flow (client handleConfirmClear) sends { status, disposition }.
    // Persist disposition alongside the status transition — dropping it left the
    // call's outcome blank and the disposition column NULL after every clear.
    const { status, disposition, notes } = await c.req.json<{ status: string; disposition?: string; notes?: string }>();
    // 'on_hold' is intentionally NOT a status value — hold is an orthogonal flag
    // in calls_for_service_ext.held_at (see /:id/hold). The live status CHECK
    // enum has no 'on_hold'.
    const valid = ['pending', 'dispatched', 'enroute', 'onscene', 'cleared', 'closed', 'cancelled', 'archived'];
    if (!valid.includes(status)) return c.json({ error: 'Invalid status', code: 'INVALID_STATUS' }, 400);

    // ALL timestamps use datetime('now') (UTC). This is the canonical status
    // writer once the proxy routes /:id/status here. The legacy worker's
    // localNow() stamped Denver-local time as +00:00, so dispatched/enroute/
    // onscene rendered ~6h off. status_changed_at + archived_at + notes are
    // written here for parity with the legacy handler this replaces.
    const timeField = `${status}_at`;
    const validTimeFields = ['dispatched_at', 'enroute_at', 'onscene_at', 'cleared_at', 'closed_at', 'archived_at'];
    const timeSql = validTimeFields.includes(timeField) ? `, ${timeField} = COALESCE(${timeField}, datetime('now'))` : '';
    const dispSql = typeof disposition === 'string' && disposition.length > 0 ? ', disposition = ?' : '';
    const notesSql = typeof notes === 'string' && notes.length > 0 ? ', notes = ?' : '';

    const params: unknown[] = [status];
    if (dispSql) params.push(disposition);
    if (notesSql) params.push(notes);
    params.push(id);
    await execute(db, `UPDATE calls_for_service SET status = ?, status_changed_at = datetime('now'), updated_at = datetime('now')${timeSql}${dispSql}${notesSql} WHERE id = ?`, ...params);
    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM calls_for_service WHERE id = ?', id);

    // Audit trail — parity with the legacy handler this replaced (which wrote
    // a STATUS_CHANGE row). Without this the call's Audit tab showed nothing
    // for dispatch transitions. Best-effort: never fail the transition on an
    // audit write. entity_type/id match the audit-trail GET's filter so the
    // entry surfaces on the call. created_at = UTC.
    try {
      const userId = c.get('userId') as number | undefined;
      if (userId != null) {
        const callNumber = (updated?.call_number as string) ?? `#${id}`;
        await execute(
          db,
          `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details, created_at)
           VALUES (?, 'STATUS_CHANGE', 'call', ?, ?, datetime('now'))`,
          userId, id, `Status changed to ${status} on ${callNumber}${typeof disposition === 'string' && disposition.length > 0 ? ` (disposition: ${disposition})` : ''}`,
        );
      }
    } catch (auditErr) {
      console.warn('audit_log insert failed for status change:', auditErr);
    }

    return c.json(updated);
  } catch (err) {
    return c.json({ error: 'Failed to update status' }, 500);
  }
});

// POST /dispatch/calls/:id/archive
calls.post('/:id/archive', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    await execute(db, "UPDATE calls_for_service SET status = 'archived', archived_at = datetime('now') WHERE id = ?", id);
    return c.json({ message: 'Archived' });
  } catch (err) { return c.json({ error: 'Archive failed' }, 500); }
});

// POST /dispatch/calls/:id/unarchive
calls.post('/:id/unarchive', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    await execute(db, "UPDATE calls_for_service SET status = 'closed' WHERE id = ? AND status = 'archived'", id);
    return c.json({ message: 'Unarchived' });
  } catch (err) { return c.json({ error: 'Unarchive failed' }, 500); }
});

// POST /dispatch/calls/:id/hold
// Hold is an orthogonal flag in the _ext overflow table (held_at), NOT a status
// enum value — this avoids a CHECK rebuild of the 100-column, FK-referenced
// calls_for_service table (migration 0041 adds the column). Status is preserved
// while held; the queue badges held calls via held_at. The _ext row is created
// lazily if it doesn't exist yet (mirrors the run_card / PSO ext-write pattern).
calls.post('/:id/hold', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    await execute(db, 'INSERT OR IGNORE INTO calls_for_service_ext (id) VALUES (?)', id);
    await execute(db, "UPDATE calls_for_service_ext SET held_at = datetime('now') WHERE id = ?", id);
    await execute(db, "UPDATE calls_for_service SET updated_at = datetime('now') WHERE id = ?", id);
    return c.json({ message: 'On hold' });
  } catch (err) {
    return c.json({ error: 'Hold failed' }, 500);
  }
});

// POST /dispatch/calls/:id/resume — clears the hold flag; status is untouched.
calls.post('/:id/resume', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    await execute(db, 'UPDATE calls_for_service_ext SET held_at = NULL WHERE id = ?', id);
    await execute(db, "UPDATE calls_for_service SET updated_at = datetime('now') WHERE id = ?", id);
    return c.json({ message: 'Resumed' });
  } catch (err) {
    return c.json({ error: 'Resume failed' }, 500);
  }
});

// POST /dispatch/calls/:id/assign-unit
calls.post('/:id/assign-unit', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const body = await c.req.json<{ unit_id: number | string }>();
    // Client sends unit_id as a string; coerce so dedup against the numeric
    // assigned_unit_ids array works and we never store mixed [5172, "5172"].
    const unit_id = Number(body.unit_id);
    if (!Number.isFinite(unit_id) || unit_id <= 0) return c.json({ error: 'Invalid unit_id' }, 400);
    const call = await queryFirst<{ assigned_unit_ids: string; call_number: string; latitude: number | null; longitude: number | null }>(
      db, 'SELECT assigned_unit_ids, call_number, latitude, longitude FROM calls_for_service WHERE id = ?', id
    );
    if (!call) return c.json({ error: 'Call not found' }, 404);
    const assigned = JSON.parse(call.assigned_unit_ids || '[]') as number[];
    if (!assigned.includes(unit_id)) assigned.push(unit_id);
    await execute(db, 'UPDATE calls_for_service SET assigned_unit_ids = ? WHERE id = ?', JSON.stringify(assigned), id);
    await execute(db, "UPDATE units SET status = 'dispatched', current_call_id = ? WHERE id = ?", parseInt(id, 10), unit_id);

    // ── Premise auto-push (Spillman parity, DI-3) ──
    // Look up premise_alerts within 50m of the call's GPS, push to the
    // assigned officer's MDT via sendToUser. Best-effort.
    let premise_pushed = 0;
    try {
      if (call.latitude != null && call.longitude != null) {
        const dLat = 0.001;
        const dLng = 0.001 / Math.max(0.01, Math.cos(call.latitude * Math.PI / 180));
        const alerts = await query<any>(db, `
          SELECT id, address, latitude, longitude, alert_type, alert_level,
                 title, description, flags
          FROM premise_alerts
          WHERE active = 1
            AND latitude  BETWEEN ? AND ?
            AND longitude BETWEEN ? AND ?
            AND (expires_at IS NULL OR expires_at >= datetime('now'))`,
          call.latitude - dLat, call.latitude + dLat,
          call.longitude - dLng, call.longitude + dLng);
        const within50m = alerts.filter((a: any) => {
          const dLatR = (a.latitude - call.latitude!) * Math.PI / 180;
          const dLngR = (a.longitude - call.longitude!) * Math.PI / 180;
          const aa = Math.sin(dLatR / 2) ** 2 + Math.cos(call.latitude! * Math.PI / 180) * Math.cos(a.latitude * Math.PI / 180) * Math.sin(dLngR / 2) ** 2;
          return 6371000 * 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa)) <= 50;
        });
        if (within50m.length > 0) {
          const unit = await queryFirst<{ officer_id: number | null }>(db, 'SELECT officer_id FROM units WHERE id = ?', unit_id);
          if (unit?.officer_id) {
            premise_pushed = sendToUser(unit.officer_id, 'premise_alert_for_unit', {
              call_id: id,
              call_number: call.call_number,
              unit_id,
              alerts: within50m,
              pushed_at: new Date().toISOString(),
            });
          }
        }
      }
    } catch (err) { console.error('[dispatch] premise auto-push:', err); }

    // Return the full updated call row (not a bare {message}). The client
    // (handleAssignUnit) feeds this straight into mapDbCall() and replaces the
    // selected call with it — a partial response yields a blank-id corrupted
    // call that wipes the call out of the dispatch UI. Mirrors /dispatch,
    // /auto-assign, and /transfer, which all return the full row.
    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM calls_for_service WHERE id = ?', id);
    return c.json({ ...(updated || {}), premise_pushed });
  } catch (err) { return c.json({ error: 'Assign failed' }, 500); }
});

// POST /dispatch/calls/:id/unassign-unit
calls.post('/:id/unassign-unit', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const body = await c.req.json<{ unit_id: number | string }>();
    // Coerce to number: the client sends a string, and a string vs number
    // filter (5172 !== "5172") is always true — the unit would never be removed.
    const unit_id = Number(body.unit_id);
    if (!Number.isFinite(unit_id) || unit_id <= 0) return c.json({ error: 'Invalid unit_id' }, 400);
    const call = await queryFirst<{ assigned_unit_ids: string }>(db, 'SELECT assigned_unit_ids FROM calls_for_service WHERE id = ?', id);
    if (!call) return c.json({ error: 'Call not found' }, 404);
    const assigned = (JSON.parse(call.assigned_unit_ids || '[]') as number[]).filter(u => u !== unit_id);
    await execute(db, 'UPDATE calls_for_service SET assigned_unit_ids = ? WHERE id = ?', JSON.stringify(assigned), id);
    await execute(db, "UPDATE units SET status = 'available', current_call_id = NULL WHERE id = ?", unit_id);
    // Return the full updated call row — the client (handleUnassignUnit) runs it
    // through mapDbCall() and replaces the selected call; a bare {message}
    // corrupts the call to a blank-id object. Mirrors /assign-unit.
    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM calls_for_service WHERE id = ?', id);
    return c.json(updated || {});
  } catch (err) { return c.json({ error: 'Unassign failed' }, 500); }
});

// POST /dispatch/calls/:id/dispatch - Multi-unit dispatch
calls.post('/:id/dispatch', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const { unit_ids } = await c.req.json<{ unit_ids: number[] }>();
    if (!unit_ids?.length) return c.json({ error: 'No units specified' }, 400);

    const call = await queryFirst<{ assigned_unit_ids: string }>(db, 'SELECT assigned_unit_ids FROM calls_for_service WHERE id = ?', id);
    if (!call) return c.json({ error: 'Call not found' }, 404);

    const assigned = new Set(JSON.parse(call.assigned_unit_ids || '[]') as number[]);
    for (const uid of unit_ids) assigned.add(uid);

    await execute(db, "UPDATE calls_for_service SET assigned_unit_ids = ?, status = 'dispatched', dispatched_at = COALESCE(dispatched_at, datetime('now')) WHERE id = ?", JSON.stringify([...assigned]), id);

    for (const uid of unit_ids) {
      await execute(db, "UPDATE units SET status = 'dispatched', current_call_id = ? WHERE id = ?", parseInt(id, 10), uid);
    }

    // Return the updated call row, not a {message}. The client
    // (handleMultiUnitDispatch) feeds this straight into mapDbCall() and splices
    // it into dispatch state — a bare message produced a blank-id corrupted call.
    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM calls_for_service WHERE id = ?', id);
    return c.json(updated);
  } catch (err) { return c.json({ error: 'Dispatch failed' }, 500); }
});

// ── Re-dispatch ("return visit") chain ───────────────────────────────
// Ported from the legacy rmpg-flex Worker, which 500s on live D1: its INSERT
// writes calls_for_service.parent_call_id (+ gang_related/fire_requested/hazmat/
// tags), none of which exist on the live base table — and its visit-history
// snapshot targets a call_visit_history schema that live repurposed for premise
// visits. This rewrite keeps the chain in calls_for_service_ext.parent_call_id
// (migration 0044) and reconstructs visit history from the chain itself (see
// GET /:id), so no snapshot table is needed.

// PSO/process-service overflow + tactical-flag fields copied to the child's ext
// row. COALESCE(parentExt, parentBase) handles legacy-created parents whose PSO
// data still lives on the base table.
const REDISPATCH_EXT_COPY_COLS = [
  'pso_requestor_name', 'pso_requestor_phone', 'pso_requestor_email',
  'pso_service_type', 'pso_billing_code', 'pso_authorization',
  'pso_service_windows', 'pso_72hr_deadline', 'pso_72hr_notified',
  'process_service_type', 'process_served_to', 'process_served_address',
  'fire_requested', 'hazmat', 'gang_related',
] as const;

// Base columns copied verbatim from the parent. Every column is confirmed to
// exist on the live calls_for_service table (the legacy crash was caused by
// copying columns that no longer do). Excludes id/call_number/status/notes/
// timestamps (set explicitly) and the PSO/process fields (copied to ext).
const REDISPATCH_BASE_COPY_COLS = [
  'incident_type', 'priority', 'source',
  'caller_name', 'caller_phone', 'caller_relationship', 'caller_address',
  'location_address', 'property_id', 'client_id', 'latitude', 'longitude',
  'cross_street', 'location_building', 'location_floor', 'location_room',
  'description', 'dispatch_code',
  'sector_id', 'sector_name', 'zone_id', 'zone_name',
  'beat_id', 'beat_name', 'beat_descriptor', 'contract_id',
  'num_subjects', 'num_victims', 'direction_of_travel',
  'subject_description', 'vehicle_description',
  'scene_safety', 'weather_conditions', 'lighting_conditions',
  'injuries_reported', 'alcohol_involved', 'domestic_violence', 'drugs_involved',
  'weapons_involved', 'mental_health_crisis', 'juvenile_involved',
  'felony_in_progress', 'officer_safety_caution', 'k9_requested', 'ems_requested',
  'case_number', 'le_agency', 'le_case_number', 'le_notified',
  'secondary_type', 'contact_method',
] as const;

const ordinal = (n: number): string => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${v >= 11 && v <= 13 ? 'th' : s[n % 10] || s[0]}`;
};

// POST /dispatch/calls/:id/redispatch — create a NEW call linked to the parent's
// chain root (a "return visit"). PSO Client Request + Process Service only, and
// only once the parent is inactive (cleared/closed/cancelled/on_hold/archived).
calls.post('/:id/redispatch', requireRole('admin', 'manager', 'supervisor', 'dispatcher'), async (c) => {
  try {
    const db = getDb(c.env);
    const user = c.get('user') as { id: number; full_name: string };
    const userId = c.get('userId') as number;
    const parentId = parseInt(c.req.param('id') ?? '', 10);
    if (isNaN(parentId)) return c.json({ error: 'Invalid call ID', code: 'INVALID_CALL_ID' }, 400);

    const parentBase = await queryFirst<Record<string, any>>(db, 'SELECT * FROM calls_for_service WHERE id = ?', parentId);
    if (!parentBase) return c.json({ error: 'Call not found', code: 'CALL_NOT_FOUND' }, 404);
    const parentExt = await queryFirst<Record<string, any>>(db, 'SELECT * FROM calls_for_service_ext WHERE id = ?', parentId);

    if (!['pso_client_request', 'process_service'].includes(String(parentBase.incident_type))) {
      return c.json({ error: 'Re-dispatch is only available for PSO Client Request and Process Service calls', code: 'REDISPATCH_TYPE_INVALID' }, 400);
    }
    if (!['cleared', 'closed', 'cancelled', 'on_hold', 'archived'].includes(String(parentBase.status))) {
      return c.json({ error: 'Call must be cleared, closed, cancelled, on hold, or archived to re-dispatch', code: 'CALL_MUST_BE_INACTIVE' }, 400);
    }

    const currentAttempt = Number(parentExt?.pso_attempt_number ?? parentBase.pso_attempt_number ?? 1);
    const newAttempt = currentAttempt + 1;
    // Flat chain: every child points at the ROOT call's id (matches legacy).
    const rootCallId = Number(parentExt?.parent_call_id ?? parentBase.id);

    // Call number: CFS{YY}-{NNNNN}, same generator as POST / (create).
    const year = new Date().getFullYear().toString().slice(-2);
    const prefix = `CFS${year}-`;
    const [{ max }] = await query<{ max: string | null }>(
      db, 'SELECT MAX(call_number) as max FROM calls_for_service WHERE call_number LIKE ?', `${prefix}%`);
    const seq = max ? String(parseInt(max.slice(prefix.length), 10) + 1).padStart(5, '0') : '00001';
    const newCallNumber = `${prefix}${seq}`;

    const { scheduled_note } = await c.req.json<{ scheduled_note?: string }>().catch(() => ({ scheduled_note: undefined }));
    const nowIso = new Date().toISOString();
    const noteText = scheduled_note
      ? `Re-dispatch from ${parentBase.call_number} — ${ordinal(newAttempt)} attempt. Note: ${scheduled_note}`
      : `Re-dispatch from ${parentBase.call_number} — ${ordinal(newAttempt)} attempt`;
    const initialNotes = JSON.stringify([{ id: String(Date.now()), author: user.full_name || 'Dispatch', text: noteText, timestamp: nowIso }]);

    // ── INSERT the child call (base row) ──
    const cols = ['call_number', 'status', 'dispatcher_id', 'notes', 'created_at', 'updated_at', 'received_at'];
    const vals = ['?', '?', '?', '?', "datetime('now')", "datetime('now')", "datetime('now')"];
    const params: unknown[] = [newCallNumber, 'pending', userId, initialNotes];
    for (const col of REDISPATCH_BASE_COPY_COLS) {
      cols.push(col); vals.push('?'); params.push(parentBase[col] ?? null);
    }
    const result = await execute(db, `INSERT INTO calls_for_service (${cols.join(', ')}) VALUES (${vals.join(', ')})`, ...params);
    const newCallId = Number(result.meta.last_row_id);

    // ── Child ext row: parent linkage + attempt + copied PSO/tactical fields ──
    const extCols = ['parent_call_id', 'pso_attempt_number'];
    const extParams: unknown[] = [rootCallId, newAttempt];
    for (const col of REDISPATCH_EXT_COPY_COLS) {
      extCols.push(col); extParams.push(parentExt?.[col] ?? parentBase[col] ?? null);
    }
    await execute(db, 'INSERT OR IGNORE INTO calls_for_service_ext (id) VALUES (?)', newCallId);
    await execute(db, `UPDATE calls_for_service_ext SET ${extCols.map(c2 => `${c2} = ?`).join(', ')} WHERE id = ?`, ...extParams, newCallId);

    // ── Copy linked persons + vehicles (best-effort, per-row) ──
    try {
      const persons = await query<{ person_id: number; role: string | null; notes: string | null }>(db, 'SELECT person_id, role, notes FROM call_persons WHERE call_id = ?', parentId);
      for (const p of persons) {
        try { await execute(db, 'INSERT INTO call_persons (call_id, person_id, role, notes) VALUES (?, ?, ?, ?)', newCallId, p.person_id, p.role, p.notes); } catch { /* skip dup/constraint */ }
      }
    } catch (e) { console.warn('redispatch copy persons failed (non-fatal):', e); }
    try {
      const vehicles = await query<{ vehicle_id: number; role: string | null; notes: string | null }>(db, 'SELECT vehicle_id, role, notes FROM call_vehicles WHERE call_id = ?', parentId);
      for (const v of vehicles) {
        try { await execute(db, 'INSERT INTO call_vehicles (call_id, vehicle_id, role, notes) VALUES (?, ?, ?, ?)', newCallId, v.vehicle_id, v.role, v.notes); } catch { /* skip dup/constraint */ }
      }
    } catch (e) { console.warn('redispatch copy vehicles failed (non-fatal):', e); }

    // ── Parent back-link note ──
    let parentNotes: any[] = [];
    try { parentNotes = JSON.parse(parentBase.notes || '[]'); if (!Array.isArray(parentNotes)) parentNotes = []; } catch { parentNotes = []; }
    parentNotes.push({ id: String(Date.now() + 1), author: 'System', text: `Re-dispatched → new call ${newCallNumber}`, timestamp: nowIso });
    await execute(db, "UPDATE calls_for_service SET notes = ?, updated_at = datetime('now') WHERE id = ?", JSON.stringify(parentNotes), parentId);

    // ── Audit trail (best-effort) ──
    try {
      await execute(db, "INSERT INTO audit_log (user_id, action, entity_type, entity_id, details, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))", userId, 'call_redispatched', 'call', parentId, `Re-dispatched → ${newCallNumber} (${ordinal(newAttempt)} attempt)`);
      await execute(db, "INSERT INTO audit_log (user_id, action, entity_type, entity_id, details, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))", userId, 'call_created_from_redispatch', 'call', newCallId, `Created from re-dispatch of ${parentBase.call_number} (${ordinal(newAttempt)} attempt)`);
    } catch (e) { console.warn('redispatch audit_log failed (non-fatal):', e); }

    // ── Build response: merged child row + full chain ──
    const newBase = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM calls_for_service WHERE id = ?', newCallId);
    const newExt = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM calls_for_service_ext WHERE id = ?', newCallId);
    const chain = await query<Record<string, unknown>>(db, `
      SELECT c.id, c.call_number, c.status, e.pso_attempt_number, c.created_at, c.cleared_at, c.disposition, e.parent_call_id
      FROM calls_for_service c
      LEFT JOIN calls_for_service_ext e ON e.id = c.id
      WHERE c.id = ? OR e.parent_call_id = ?
      ORDER BY COALESCE(e.pso_attempt_number, 1) ASC, c.id ASC
    `, rootCallId, rootCallId);

    const newCall = { ...(newBase || {}), ...(newExt || {}) };
    broadcastAll('dispatch_update', { action: 'call_created', call: newCall });
    broadcastAll('dispatch_update', { action: 'call_updated', call: { ...parentBase, notes: JSON.stringify(parentNotes) } });

    return c.json({ ...newCall, chain, parent_call_number: parentBase.call_number }, 201);
  } catch (err) {
    console.error('Re-dispatch call error:', err);
    return c.json({ error: `Failed to re-dispatch call: ${(err as Error)?.message || 'unknown'}`, code: 'REDISPATCH_CALL_ERROR' }, 500);
  }
});

// POST /dispatch/calls/:id/undo-redispatch — delete a still-pending return visit
// and restore the parent. parent_call_id linkage lives on ext.
calls.post('/:id/undo-redispatch', requireRole('admin', 'manager', 'supervisor', 'dispatcher'), async (c) => {
  try {
    const db = getDb(c.env);
    const user = c.get('user') as { id: number; role: string; full_name: string };
    const userId = c.get('userId') as number;
    const childId = parseInt(c.req.param('id') ?? '', 10);
    if (isNaN(childId)) return c.json({ error: 'Invalid call ID', code: 'INVALID_CALL_ID' }, 400);

    const childBase = await queryFirst<Record<string, any>>(db, 'SELECT * FROM calls_for_service WHERE id = ?', childId);
    if (!childBase) return c.json({ error: 'Call not found', code: 'CALL_NOT_FOUND' }, 404);
    const childExt = await queryFirst<Record<string, any>>(db, 'SELECT parent_call_id FROM calls_for_service_ext WHERE id = ?', childId);

    const parentId = childExt?.parent_call_id;
    if (parentId == null) return c.json({ error: 'This call is not a re-dispatch — it has no parent call', code: 'NOT_A_REDISPATCH' }, 400);

    // Pending-only, unless admin (which logs an override).
    if (childBase.status !== 'pending' && user.role !== 'admin') {
      return c.json({ error: 'Can only undo a return visit that is still pending. Once dispatched, it cannot be undone.', code: 'CHILD_NOT_PENDING' }, 400);
    }
    if (user.role === 'admin' && childBase.status !== 'pending') {
      try { await execute(db, "INSERT INTO audit_log (user_id, action, entity_type, entity_id, details, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))", userId, 'ADMIN_OVERRIDE', 'call', childId, `Admin override: bypassed pending-only undo-redispatch (status: ${childBase.status})`); } catch { /* non-fatal */ }
    }

    const parentBase = await queryFirst<Record<string, any>>(db, 'SELECT * FROM calls_for_service WHERE id = ?', parentId);
    if (!parentBase) return c.json({ error: 'Parent call not found', code: 'PARENT_NOT_FOUND' }, 404);

    // Delete child + related rows. D1 may not enforce FK ON DELETE CASCADE, so
    // delete children explicitly (ext too) before the call row.
    for (const sql of [
      'DELETE FROM call_persons WHERE call_id = ?',
      'DELETE FROM call_vehicles WHERE call_id = ?',
      'DELETE FROM call_units WHERE call_id = ?',
      'DELETE FROM serve_queue WHERE call_id = ?',
      'DELETE FROM calls_for_service_ext WHERE id = ?',
      'DELETE FROM calls_for_service WHERE id = ?',
    ]) {
      try { await execute(db, sql, childId); } catch (e) { console.warn(`undo-redispatch ${sql} failed (non-fatal):`, e); }
    }

    // Restore parent notes: drop the "Re-dispatched → new call X" note, add an undo note.
    let parentNotes: any[] = [];
    try { parentNotes = JSON.parse(parentBase.notes || '[]'); if (!Array.isArray(parentNotes)) parentNotes = []; } catch { parentNotes = []; }
    parentNotes = parentNotes.filter((n: any) => !String(n?.text || '').includes(`Re-dispatched → new call ${childBase.call_number}`));
    parentNotes.push({ id: String(Date.now()), author: user.full_name || 'System', text: `Return visit ${childBase.call_number} was undone`, timestamp: new Date().toISOString() });
    await execute(db, "UPDATE calls_for_service SET notes = ?, updated_at = datetime('now') WHERE id = ?", JSON.stringify(parentNotes), parentId);

    try { await execute(db, "INSERT INTO audit_log (user_id, action, entity_type, entity_id, details, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))", userId, 'undo_redispatch', 'call', parentId, `Undid return visit ${childBase.call_number} for ${parentBase.call_number}`); } catch (e) { console.warn('undo-redispatch audit_log failed (non-fatal):', e); }

    const updatedBase = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM calls_for_service WHERE id = ?', parentId);
    const updatedExt = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM calls_for_service_ext WHERE id = ?', parentId);
    const updated = { ...(updatedBase || {}), ...(updatedExt || {}) };
    broadcastAll('dispatch_update', { action: 'call_deleted', call: { id: childId, call_number: childBase.call_number } });
    broadcastAll('dispatch_update', { action: 'call_updated', call: updated });

    return c.json({ success: true, parent: updated, deleted_call: childBase.call_number });
  } catch (err) {
    console.error('Undo redispatch error:', err);
    return c.json({ error: `Failed to undo return visit: ${(err as Error)?.message || 'unknown'}`, code: 'UNDO_REDISPATCH_ERROR' }, 500);
  }
});

export default calls;

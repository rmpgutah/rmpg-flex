import { Hono } from 'hono';
import type { Env } from '../../types';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { getDb, query, queryFirst, execute } from '../../utils/db';
import { emitAnalytics, flexEvent } from '../../utils/analytics';
import { recordAudit } from '../../utils/auditLog';
import { authMiddleware, requireRole } from '../../middleware/auth';
import { applyRunCard } from '../runCards';
import { sendToUser } from '../ws';
import { emitAlert } from '../../utils/alertHub';
import { geocodeAddress } from '../geocode';
import { resolveDistrict } from '../../utils/districtResolver';
import { parseUnitIds, canonicalUnitIdsJson } from './unitIds';
import { setFleetOdometer, vehicleOdometerForUnit } from '../../utils/fleetOdometer';
import { codedLike, escapeLike } from '../../utils/searchText';
import { planAction, isCfsVerb } from '../../utils/cfsActions';
import { crossLinkPsoCloseToServe } from '../../utils/psoServeCrosslink';
import { log } from '../../utils/logger';

const calls = new Hono<Env>();

// CFS Action Bus audit table — every named action (status / disposition / unit /
// hazard / narrative / timer / notify / query / link) lands here for the call's
// action history. Self-heals on first use (no migration).
async function ensureCfsActionLog(db: ReturnType<typeof getDb>): Promise<void> {
  await execute(db, `CREATE TABLE IF NOT EXISTS cfs_action_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    call_id INTEGER,
    action TEXT,
    verb TEXT,
    params TEXT,
    narrative TEXT,
    actor_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
}

// REGRESSION-GUARD: role gates on mutation endpoints. Pre-Claude these
// had only authMiddleware (valid JWT), so any authenticated user including
// client_viewer could create/update/delete calls and assign units.
const WRITE_ROLES = ['admin', 'manager', 'supervisor', 'dispatcher'] as const;
const READ_ROLES = ['admin', 'manager', 'supervisor', 'officer', 'dispatcher'] as const;

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
  // Safety flags shown on the dispatcher's row at a glance. The rest of the
  // safety/tactical flags load on the detail GET only — keeping the list
  // projection lean both for screen real-estate and for staying clear of the
  // D1 100-column SELECT cap that already constrains this query.
  // `officer_safety_caution` (migration 0003:70) and `pinned`
  // (migration 0003:100, read here via the cfe.pinned JOIN below) both exist
  // in migrations and are surfaced via the detail GET / the pinned-sort key
  // respectively — they don't need to live in the row projection.
  'weapons_involved', 'injuries_reported', 'domestic_violence',
  // Mileage + overdue
  'starting_mileage', 'ending_mileage', 'overdue_notified',
] as const;

// Pre-built `c.col1, c.col2, ...` fragment used in every list query.
// Exported so peer routers (callLinks, aggregates) can reuse it instead of
// rebuilding the join string and risk drifting from this projection.
export const LIST_VIEW_SELECT = LIST_VIEW_COLUMNS.map(col => `c.${col}`).join(', ');

// GET /dispatch/calls - List calls with filters (also handles /active via query param)
calls.get('/', requireRole(...READ_ROLES), async (c) => {
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
      const raw = search.trim();
      const itLike = codedLike('c.incident_type', raw);
      where += ` AND (c.call_number LIKE ? ESCAPE '\\' OR ${itLike.sql} OR c.location_address LIKE ? ESCAPE '\\' OR c.description LIKE ? ESCAPE '\\')`;
      const s = `%${escapeLike(raw)}%`; params.push(s, ...itLike.binds, s, s);
    }
    if (archived === 'true') where += " AND c.status = 'archived'";
    else if (archived !== 'all') where += " AND c.status != 'archived'";

    // Only filter to active statuses when explicitly requested via active=true
    // or when no filters are specified AND status is not explicitly provided.
    // This allows the frontend to see cleared/closed/cancelled calls in the "All" tab.
    if (active === 'true') {
      where = "WHERE c.status IN ('dispatched','enroute','onscene','pending','open')";
      // Re-apply archived filter since we replaced the WHERE clause
      if (archived === 'true') where += " AND c.status = 'archived'";
      else if (archived !== 'all') where += " AND c.status != 'archived'";
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
        cl.name as client_name, cl.contact_name as client_contact_name,
        cl.contact_phone as client_phone, cl.address as client_address,
        cl.industry as client_industry, cfe.held_at,
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
    log.error('Get calls error', {}, err);
    return c.json({ error: 'Failed to get calls' }, 500);
  }
});

// POST /dispatch/calls - Create call
  const VALID_PRIORITIES = new Set(['P1', 'P2', 'P3', 'P4']);
  const VALID_PRIORITIES_SQL = ['P1', 'P2', 'P3', 'P4'];
  // Mirrors the enum used by POST /:id/status (line 973) AND the CHECK
  // constraint on calls_for_service.status (migrations/0001_initial.sql:84).
  // 'on_hold' is intentionally absent — hold is an orthogonal flag in
  // calls_for_service_ext.held_at, not a status value.
  const VALID_STATUSES = new Set(['pending', 'dispatched', 'enroute', 'onscene', 'cleared', 'closed', 'cancelled', 'archived']);
  calls.post('/', requireRole(...WRITE_ROLES), async (c) => {
    try {
      const db = getDb(c.env);
      const body = await c.req.json<Record<string, unknown>>();
      const userId = c.get('userId') as number;

      const { incident_type, priority, location_address } = body;
      if (!incident_type || !priority || !location_address) {
        return c.json({ error: 'incident_type, priority, and location_address are required' }, 400);
      }
      // REGRESSION-GUARD: validate priority against P1-P4 (SQL CHECK constraint
      // on calls_for_service.priority enforces this at DB level but a cleaner
      // 400 saves the round-trip).
      const normalizedPriority = String(priority).toUpperCase();
      if (!VALID_PRIORITIES.has(normalizedPriority)) {
        return c.json({ error: `Invalid priority '${priority}'. Must be P1, P2, P3, or P4.`, code: 'INVALID_PRIORITY' }, 400);
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
        if (body[k] == null || body[k] === '') body[k] = v;
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
    if (body.client_id != null && body.client_id !== '') {
      const exists = await queryFirst<{ id: number }>(
        db, 'SELECT id FROM clients WHERE id = ?', body.client_id,
      );
      if (!exists) body.client_id = null;
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

    // ── District backfill (Sector / Zone / Beat) ──
    // Every entry path (dispatch modal, CAD command line, raw API) lands here,
    // so resolving geography once on the server guarantees the call list always
    // shows human-readable Sector/Zone/Beat — not the blank fields that result
    // when a client form sends ids but no names. Caller-supplied values always
    // win; we only fill blanks. Authoritative source is the chosen beat_id
    // (beat_code); if absent we derive the beat from coordinates via the R2
    // geofence. Best-effort — a miss must never block call creation.
    try {
      const lat = body.latitude != null && body.latitude !== '' ? Number(body.latitude) : null;
      const lng = body.longitude != null && body.longitude !== '' ? Number(body.longitude) : null;
      const zoneCode = typeof body.zone_id === 'string' ? body.zone_id : null;
      const beatCode = typeof body.beat_id === 'string' ? body.beat_id : null;
      if ((zoneCode && beatCode) || (lat != null && lng != null)) {
        const district = await resolveDistrict(c.env, { zoneCode, beatCode, lat, lng });
        if (district) {
          const fill = (key: string, value: unknown) => {
            if (value != null && value !== '' && (body[key] == null || body[key] === '')) {
              body[key] = value;
            }
          };
          fill('sector_id', district.sector_id);
          fill('sector_name', district.sector_name);
          fill('zone_id', district.zone_id);
          fill('zone_name', district.zone_name);
          fill('beat_id', district.beat_id);
          fill('beat_name', district.beat_name);
          fill('beat_descriptor', district.beat_descriptor);
          fill('dispatch_code', district.dispatch_code);
          fill('zone_beat', district.zone_beat);
        }
      }
    } catch (err) {
      log.warn('[calls.create] district backfill skipped', { message: (err as Error)?.message });
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
    // PSO / process-service fields and the 9 tactical flags live on the 1:1
    // calls_for_service_ext overflow table (base is at the D1 100-col cap).
    // Collect them here and write them after the base INSERT succeeds, mirroring
    // the PUT handler — otherwise every one of these fields is silently dropped
    // on call creation.
    const extCols: string[] = [];
    const extColParams: unknown[] = [];
    for (const [key, val] of Object.entries(body)) {
      if (skipOnCreate.has(key)) continue;
      if (UPDATABLE_CALL_COLUMNS_BASE.has(key)) {
        cols.push(key);
        vals.push('?');
        // Canonicalize assigned_unit_ids to a JSON int array so the client can
        // never persist the mixed ["1"]/[1] shape that breaks SQL matching.
        bindParams.push(key === 'assigned_unit_ids' ? canonicalUnitIdsJson(val) : (val ?? null));
      } else if (UPDATABLE_CALL_COLUMNS_EXT.has(key)) {
        extCols.push(key);
        extColParams.push(val ?? null);
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

      // Analytics lakehouse: call-created event (best-effort, no-op until the
      // EVENTS pipeline is provisioned; fire-and-forget, never blocks dispatch).
      emitAnalytics(c, c.env.EVENTS, [flexEvent({
        event_type: 'cfs_created', occurred_at: new Date().toISOString(),
        actor_id: (c.get('userId') as number | undefined) ?? null,
        entity_type: 'call', entity_id: callId,
        lat: body.latitude, lng: body.longitude, status: 'pending',
        label: body.incident_type, priority: body.priority, category: 'dispatch',
        payload: { call_number: callNumber, address: body.location_address ?? null },
      })]);

      // Write the PSO/process-service/tactical-flag overflow columns AND the
      // applied run card to the ext table in one INSERT OR IGNORE + UPDATE.
      // INSERT OR IGNORE then UPDATE matches the rest of the ext write flow.
      // Best-effort: the base call row already committed, so never block call
      // creation (or 500) on the ext write.
      const extSet: string[] = extCols.map((col) => `${col} = ?`);
      const extWriteParams: unknown[] = [...extColParams];
      if (rcResult.card) {
        extSet.push('run_card_id = ?', 'run_card_applied_at = ?');
        extWriteParams.push(rcResult.card.id, new Date().toISOString());
      }
      if (extSet.length > 0) {
        try {
          await execute(db, 'INSERT OR IGNORE INTO calls_for_service_ext (id) VALUES (?)', callId);
          extWriteParams.push(callId);
          await execute(db, `UPDATE calls_for_service_ext SET ${extSet.join(', ')} WHERE id = ?`, ...extWriteParams);
        } catch (extErr) {
          log.warn('call ext write failed (non-fatal)', { err: extErr });
        }
      }

      // Split fetch + merge to dodge D1's 100-column cap (base ~93 + ext 16 > 100),
      // so the created call returned/broadcast includes the PSO/ext fields.
      const callBase = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM calls_for_service WHERE id = ?', callId);
      const callExt = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM calls_for_service_ext WHERE id = ?', callId);
      const call = { ...(callBase || {}), ...(callExt || {}) };

      // Audit trail entry — dispatch's Audit tab reads audit_log by
      // entity_type='call' + entity_id. Failure shouldn't block the create.
      try {
        await recordAudit(c, { action: 'CREATE', entityType: 'call', entityId: callId, details: `Created call ${callNumber}`, actorId: userId });
      } catch (auditErr) {
        log.warn('audit_log insert failed for call create', { err: auditErr });
      }

      // Broadcast to every connected dispatcher so rosters re-render
      // without a manual refresh. Matches the legacy POST behavior.
      await emitAlert(c.env, 'dispatch_update', { action: 'call_created', call });

      // Alert Rules engine — fire P1/P2 call-created triggers so admin-
      // configured notification rules fan out to their target roles/users.
      // Best-effort; evaluateNotificationRules never throws into this path.
      const prio = String(priority).toUpperCase();
      if (prio === 'P1' || prio === 'P2') {
        await evaluateNotificationRules(db, prio === 'P1' ? 'call_created_p1' : 'call_created_p2', {
          title: `${prio} Call: ${normalizedIncidentType}`,
          message: `${callNumber} — ${String(location_address)}`,
          priority: prio === 'P1' ? 'critical' : 'high',
          entity_type: 'call',
          entity_id: callId as number,
          incident_type: normalizedIncidentType,
        });
      }

      return c.json({ ...call, runCard: rcResult.card }, 201);
    } catch (sqlErr: unknown) {
      // Surface the real SQL error so the dispatcher (and we) can see
      // which column / FK is rejecting. Without this the client sees a
      // generic 500 and we can't debug from production.
      const msg = String((sqlErr as Error)?.message || sqlErr || 'unknown');
      log.error('Create call INSERT failed', { msg, userId, cols, params: bindParams });
      if (msg.includes('FOREIGN KEY')) {
        return c.json({
          error: `Foreign key constraint failed. dispatcher_id=${userId} (must reference users.id), property_id=${body.property_id ?? null}, client_id=${body.client_id ?? null}. Detail: ${msg}`,
          code: 'FK_VIOLATION',
        }, 500);
      }
      return c.json({ error: `Failed to create call: ${msg}`, code: 'INSERT_FAILED' }, 500);
    }
  } catch (err: unknown) {
    log.error('Create call outer error', {}, err);
    return c.json({ error: `Failed to create call: ${(err as Error)?.message || 'unknown'}`, code: 'OUTER_ERROR' }, 500);
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

calls.post('/archive-bulk', requireRole(...WRITE_ROLES), async (c) => {
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
    const archived_count = result.meta.changes ?? 0;
    // Release every unit whose linked call is now (or already was) terminal —
    // also heals any strays left over from pre-fix archives.
    try {
      const stranded = await query<{ id: number; call_sign: string }>(db,
        `SELECT u.id, u.call_sign FROM units u
           JOIN calls_for_service cf ON cf.id = u.current_call_id
          WHERE cf.status IN ('cleared','closed','cancelled','archived')`);
      if (stranded.length) {
        await execute(db,
          `UPDATE units SET status = 'available', current_call_id = NULL,
                  last_status_change = datetime('now'), updated_at = datetime('now')
            WHERE id IN (${stranded.map(() => '?').join(',')})`,
          ...stranded.map((u) => u.id));
        for (const u of stranded) {
          await emitAlert(c.env, 'dispatch_update', {
            action: 'unit_status_changed',
            unit: { id: u.id, call_sign: u.call_sign, status: 'available', current_call_id: null, current_call_number: null },
          });
        }
      }
    } catch (err) { log.warn('[calls] bulk-archive unit release failed (non-fatal)', { err }); }
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
//
// Each sub-query is individually wrapped so a missing column, drifted schema,
// or D1 cap error on one aspect never crashes the full response — the other
// sections still render. This was the root cause of the 500 on call 25: one
// sub-query (likely the JOIN subquery pattern or an absent column) threw and
// the outer catch swallowed the entire response.
calls.get('/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');

    const call = await queryFirst<Record<string, unknown>>(
      db, 'SELECT * FROM calls_for_service WHERE id = ?', id);
    if (!call) return c.json({ error: 'Call not found' }, 404);

    const soft = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
      try { return await fn(); } catch (err) { log.warn(`[calls/:id] sub-query degraded`, { message: (err as Error)?.message }); return fallback; }
    };

    const ext = await soft(() => queryFirst<Record<string, unknown>>(
      db, 'SELECT * FROM calls_for_service_ext WHERE id = ?', id), null);

    // Re-dispatch ("return visit") chain. For PSO/process-service calls, attach
    // the prior attempts as visit_history so the detail panel's "PRIOR VISITS"
    // list renders. The chain is flat — children carry ext.parent_call_id =
    // ROOT id — so a call's root is its own parent_call_id (if a child) or its
    // own id (if the root). Reconstructed from calls_for_service + ext; the
    // legacy call_visit_history snapshot table is unused (live repurposed it).
    let visit_history: Record<string, unknown>[] | undefined;
    if (['pso_client_request', 'process_service'].includes(String(call.incident_type))) {
      const rootId = Number((ext?.parent_call_id as number | null) ?? call.id);
      visit_history = await soft(() => query<Record<string, unknown>>(db, `
        SELECT c.id,
          COALESCE(e.pso_attempt_number, c.pso_attempt_number,
                   ROW_NUMBER() OVER (ORDER BY c.id ASC)) AS visit_number,
          c.status, c.disposition, c.unit_call_signs AS assigned_units,
          c.dispatched_at, c.enroute_at, c.onscene_at, c.cleared_at, c.closed_at,
          c.responding_vehicle_id, c.starting_mileage, c.ending_mileage
        FROM calls_for_service c
        LEFT JOIN calls_for_service_ext e ON e.id = c.id
        WHERE (c.id = ? OR e.parent_call_id = ?)
          AND c.id < ?
        ORDER BY c.id ASC
      `, rootId, rootId, Number(id)), undefined);
    }

    const joined = await soft(() => queryFirst<Record<string, unknown>>(db, `
      SELECT p.name AS property_name, p.address AS property_address,
        p.gate_code, p.alarm_code, p.emergency_contact, p.post_orders, p.hazard_notes,
        u.full_name AS dispatcher_name, cl.name AS client_name,
        cl.contact_name AS client_contact_name, cl.contact_phone AS client_phone,
        cl.address AS client_address, cl.industry AS client_industry
      FROM (SELECT ? AS property_id, ? AS dispatcher_id, ? AS client_id) ck
      LEFT JOIN properties p ON p.id = ck.property_id
      LEFT JOIN users u ON u.id = ck.dispatcher_id
      LEFT JOIN clients cl ON cl.id = COALESCE(ck.client_id, p.client_id)
    `, call.property_id ?? null, call.dispatcher_id ?? null, call.client_id ?? null), null);

    let assignedIds: number[] = []; try { assignedIds = JSON.parse(String(call.assigned_unit_ids || '[]')); if (!Array.isArray(assignedIds)) assignedIds = []; } catch { assignedIds = []; }
    const assignedUnits = assignedIds.length === 0 ? [] : await soft(() => query<Record<string, unknown>>(db, `
      SELECT u.*, usr.full_name as officer_name, usr.badge_number
      FROM units u LEFT JOIN users usr ON u.officer_id = usr.id
      WHERE u.id IN (${assignedIds.map(() => '?').join(',')})
    `, ...assignedIds), []);

    const incidents = await soft(() => query<Record<string, unknown>>(db,
      'SELECT id, incident_number, incident_type, status, created_at FROM incidents WHERE call_id = ? ORDER BY created_at DESC LIMIT 1000', id), []);

    const activity = await soft(() => query<Record<string, unknown>>(db,
      'SELECT al.*, u.full_name as user_name FROM audit_log al LEFT JOIN users u ON al.user_id = u.id WHERE al.entity_type = ? AND al.entity_id = ? ORDER BY al.created_at DESC LIMIT 1000',
      'call', id), []);

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
    log.error('GET /dispatch/calls/:id failed', {}, err);
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
  // Court name for PSO calls — surfaced on the Notice of Attempt PDF.
  // Column added via migration 0145_cfs_court_name.sql.
  'court_name',
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
calls.put('/:id', requireRole(...WRITE_ROLES), async (c) => {
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
        let bindVal: unknown;
        if (key === 'assigned_unit_ids') {
          bindVal = canonicalUnitIdsJson(val);
        } else if (key === 'priority' && val != null) {
          // REGRESSION-GUARD: mirror POST normalization + CHECK enum on
          // calls_for_service.priority. Without this, a bad value reaches
          // the bind at line 804 and the CHECK rejects with a raw SQL
          // error that the catch leaks as a 500. Same posture as the POST
          // path at line 188.
          const normalized = String(val).toUpperCase();
          if (!VALID_PRIORITIES.has(normalized)) {
            return c.json({ error: `Invalid priority '${val}'. Must be P1, P2, P3, or P4.`, code: 'INVALID_PRIORITY' }, 400);
          }
          bindVal = normalized;
        } else if (key === 'status' && val != null) {
          // Mirror /:id/status enum check (line 973) so the PUT path cannot
          // sneak past with hyphenated/uppercase variants that the CHECK rejects.
          const normalized = String(val).toLowerCase();
          if (!VALID_STATUSES.has(normalized)) {
            return c.json({ error: `Invalid status '${val}'. Must be one of: ${[...VALID_STATUSES].join(', ')}.`, code: 'INVALID_STATUS' }, 400);
          }
          bindVal = normalized;
        } else {
          bindVal = val ?? null;
        }
        baseUpdates.push(`${key} = ?`);
        baseParams.push(bindVal);
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
    log.error('PUT /dispatch/calls/:id failed', {}, err);
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
    log.error('GET /dispatch/calls/:id/audit-trail failed', {}, err);
    return c.json({ events: [] });
  }
});

// DELETE /dispatch/calls/:id
calls.delete('/:id', requireRole(...WRITE_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    // Clear/unlink the non-cascading FK references before deleting, or the
    // raw DELETE hits a FOREIGN KEY constraint and 500s. Tables that point at
    // calls_for_service WITHOUT ON DELETE CASCADE: units.current_call_id,
    // incidents.call_id, radio_transmissions.call_id (records — UNLINK, don't
    // delete) and the call_persons/call_vehicles link rows (safe to DELETE).
    // calls_for_service_ext / call_businesses / case_calls cascade on their own.
    await execute(db, 'UPDATE units SET current_call_id = NULL WHERE current_call_id = ?', id);
    await execute(db, 'UPDATE incidents SET call_id = NULL WHERE call_id = ?', id);
    await execute(db, 'UPDATE radio_transmissions SET call_id = NULL WHERE call_id = ?', id);
    await execute(db, 'DELETE FROM call_persons WHERE call_id = ?', id);
    await execute(db, 'DELETE FROM call_vehicles WHERE call_id = ?', id);
    await execute(db, 'DELETE FROM calls_for_service WHERE id = ?', id);
    // Broadcast so peer consoles drop the deleted call from their boards
    // immediately (without this they keep showing it until the 20s
    // cross-device poll refreshes). Mirrors the undo-redispatch path's
    // call_deleted broadcast at line 1632; payload is just { id } because
    // the row is gone and the client only needs the id to remove it.
    try { await emitAlert(c.env, 'dispatch_update', { action: 'call_deleted', call: { id: Number(id) } }); } catch { log.warn('Broadcast call_deleted failed', { callId: id }); /* never block the response */ }
    return c.json({ message: 'Call deleted' });
  } catch (err) {
    // Surface the real reason (FK name, missing table) instead of an opaque 500.
    return c.json({ error: 'Failed to delete call', detail: (err as Error)?.message }, 500);
  }
});

// POST /dispatch/calls/:id/status - Status transition
// ── Unit/board lockstep ─────────────────────────────────────
// Keep assigned units in sync with their call's lifecycle. The legacy worker
// did this inside its status handler; the rewrite port dropped it, which is
// how units got STUCK on the board: a call could be cleared/closed/cancelled/
// ARCHIVED while its units stayed 'dispatched' with current_call_id pointing
// at a dead call forever (live incident: D19 dispatched on archived
// CFS26-00055 for 30+ hours, board showing AVAIL:0/DISP:1 with no way out).
//
// status dispatched/enroute/onscene → units riding the call follow it.
// status cleared/closed/cancelled/archived → units are RELEASED
// (available, current_call_id NULL). Always stamps last_status_change so the
// board's time-in-status dwell timer restarts. Emits one
// 'unit_status_changed' per affected unit (the client merges partial unit
// objects). Best-effort: a sync failure never fails the call transition.
const CALL_ENGAGED_STATUSES = new Set(['dispatched', 'enroute', 'onscene']);
const CALL_TERMINAL_STATUSES = new Set(['cleared', 'closed', 'cancelled', 'archived']);

// Re-fetch the merged `calls_for_service` + `calls_for_service_ext` row so a
// broadcast carries the same shape the GET surfaces (the client's mapDbCall
// reads ext fields like held_at). The pattern was inlined at three sites
// (hold, resume, assign-unit) — DRY'd here so every broadcast path matches.
// Returns null if the call no longer exists (e.g. concurrent DELETE).
async function mergedCallRow(
  db: ReturnType<typeof getDb>,
  id: string | number | undefined,
): Promise<Record<string, unknown> | null> {
  if (id == null || id === '') return null;
  const row = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM calls_for_service WHERE id = ?', id);
  if (!row) return null;
  const ext = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM calls_for_service_ext WHERE id = ?', id);
  return { ...row, ...(ext || {}) };
}

async function syncUnitsWithCallStatus(
  db: D1Database,
  env: Env['Bindings'],
  callId: string | number | undefined,
  status: string,
): Promise<void> {
  if (callId == null) return;
  try {
    if (CALL_ENGAGED_STATUSES.has(status)) {
      const affected = await query<{ id: number; call_sign: string }>(
        db, 'SELECT id, call_sign FROM units WHERE current_call_id = ? AND status != ?', callId, status);
      if (!affected.length) return;
      await execute(db,
        `UPDATE units SET status = ?, last_status_change = datetime('now'), updated_at = datetime('now')
          WHERE current_call_id = ? AND status != ?`,
        status, callId, status);
      for (const u of affected) {
        await emitAlert(env, 'dispatch_update', {
          action: 'unit_status_changed',
          unit: { id: u.id, call_sign: u.call_sign, status, current_call_id: callId },
        });
      }
    } else if (CALL_TERMINAL_STATUSES.has(status)) {
      const affected = await query<{ id: number; call_sign: string }>(
        db, 'SELECT id, call_sign FROM units WHERE current_call_id = ?', callId);
      if (!affected.length) return;
      await execute(db,
        `UPDATE units SET status = 'available', current_call_id = NULL,
                last_status_change = datetime('now'), updated_at = datetime('now')
          WHERE current_call_id = ?`,
        callId);
      for (const u of affected) {
        await emitAlert(env, 'dispatch_update', {
          action: 'unit_status_changed',
          unit: { id: u.id, call_sign: u.call_sign, status: 'available', current_call_id: null, current_call_number: null },
        });
      }
    }
  } catch (err) {
    log.warn('[calls] unit/board sync failed (non-fatal)', { err });
  }
}

calls.post('/:id/status', requireRole(...WRITE_ROLES), async (c) => {
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

    // Analytics lakehouse: call status-change event (best-effort, fire-and-forget).
    emitAnalytics(c, c.env.EVENTS, [flexEvent({
      event_type: 'cfs_status', occurred_at: new Date().toISOString(),
      actor_id: (c.get('userId') as number | undefined) ?? null,
      entity_type: 'call', entity_id: id, status,
      lat: updated?.latitude, lng: updated?.longitude,
      label: updated?.incident_type, priority: updated?.priority, category: 'dispatch',
      payload: { call_number: updated?.call_number ?? null, disposition: disposition ?? null },
    })]);

    // Audit trail — parity with the legacy handler this replaced (which wrote
    // a STATUS_CHANGE row). Without this the call's Audit tab showed nothing
    // for dispatch transitions. Best-effort: never fail the transition on an
    // audit write. entity_type/id match the audit-trail GET's filter so the
    // entry surfaces on the call. created_at = UTC.
    try {
      const userId = c.get('userId') as number | undefined;
      if (userId != null) {
        const callNumber = (updated?.call_number as string) ?? `#${id}`;
        await recordAudit(c, { action: 'STATUS_CHANGE', entityType: 'call', entityId: id, actorId: userId,
          details: `Status changed to ${status} on ${callNumber}${typeof disposition === 'string' && disposition.length > 0 ? ` (disposition: ${disposition})` : ''}` });
      }
    } catch (auditErr) {
      log.warn('audit_log insert failed for status change', { err: auditErr });
    }

    // CRITICAL FIX: Merge ext table data (PSO/process fields) into the response.
    // Without this, the client's mapDbCall() produces a call object missing all
    // PSO/process fields after a status change — the detail panel then shows
    // "No PSO details entered yet" even when data exists.
    const ext = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM calls_for_service_ext WHERE id = ?', id);
    const merged = { ...(updated || {}), ...(ext || {}) };
    // Keep assigned units in lockstep with the call (release on terminal
    // statuses, follow on engaged ones) — see syncUnitsWithCallStatus.
    await syncUnitsWithCallStatus(db, c.env, id, status);

    // Auto-mileage — same chain as the GPS auto-transitions (gps.ts): enroute
    // snapshots the assigned vehicle's odometer into starting_mileage; onscene
    // derives ending_mileage from starting + the active trip's GPS distance
    // and re-anchors the fleet odometer. Only fills BLANK fields, so anything
    // the officer/dispatcher typed in the call edit form always wins.
    if (status === 'enroute' || status === 'onscene') {
      try {
        const au = await queryFirst<{ id: number }>(db,
          'SELECT id FROM units WHERE current_call_id = ? LIMIT 1', id);
        if (au) {
          if (status === 'enroute' && merged.starting_mileage == null) {
            const odo = await vehicleOdometerForUnit(db, au.id);
            if (odo != null) {
              await execute(db,
                `UPDATE calls_for_service SET starting_mileage = ?, updated_at = datetime('now')
                  WHERE id = ? AND starting_mileage IS NULL`, odo, id);
              (merged as Record<string, unknown>).starting_mileage = odo;
            }
          } else if (status === 'onscene' && merged.ending_mileage == null) {
            let startMi: number | null = merged.starting_mileage != null ? Number(merged.starting_mileage) : null;
            if (startMi == null) {
              startMi = await vehicleOdometerForUnit(db, au.id);
              if (startMi != null) {
                await execute(db,
                  `UPDATE calls_for_service SET starting_mileage = ?, updated_at = datetime('now')
                    WHERE id = ? AND starting_mileage IS NULL`, startMi, id);
                (merged as Record<string, unknown>).starting_mileage = startMi;
              }
            }
            const trip = await queryFirst<{ distance_m: number | null; vehicle_id: number | null }>(db,
              `SELECT distance_m, vehicle_id FROM unit_trips WHERE unit_id = ? AND status = 'active'
               ORDER BY start_time DESC LIMIT 1`, au.id);
            const miles = trip?.distance_m != null ? trip.distance_m / 1609.344 : null;
            if (startMi != null && miles != null && miles >= 0.05) {
              const arrivalMi = Math.round((startMi + miles) * 10) / 10;
              await execute(db,
                `UPDATE calls_for_service SET ending_mileage = ?, updated_at = datetime('now')
                  WHERE id = ? AND ending_mileage IS NULL`, arrivalMi, id);
              (merged as Record<string, unknown>).ending_mileage = arrivalMi;
              await setFleetOdometer(db, trip?.vehicle_id ?? null, arrivalMi);
            }
          }
        }
      } catch (err) {
        log.warn('[calls] auto-mileage failed (non-fatal)', { err });
      }
    }

    // PSO Client Request cross-link: when a PSO CFS hits a terminal status,
    // mirror the close into the Process Server queue — find/create the linked
    // serve_queue row + log a serve_attempts row with the structured PS code
    // derived from the disposition. Best-effort: a failure here MUST NOT
    // break the CFS status transition itself.
    let psoCrosslink: Awaited<ReturnType<typeof crossLinkPsoCloseToServe>> | null = null;
    if (id && ['cleared', 'closed', 'cancelled'].includes(status)
        && (updated?.incident_type as string | undefined) === 'pso_client_request') {
      try {
        psoCrosslink = await crossLinkPsoCloseToServe(db, id, {
          actorUserId: (c.get('userId') as number | undefined) ?? null,
        });
      } catch (xlErr) {
        log.warn('[pso crosslink] non-fatal', { message: (xlErr as Error)?.message });
      }
    }

    // Fan the transition to every console via AlertHubDO. Previously this handler
    // emitted NO broadcast at all, so dispatched→enroute→onscene→cleared changes
    // only surfaced on the next adaptive poll — the unit board lagged reality.
    await emitAlert(c.env, 'dispatch_update', { action: 'call_updated', call: merged });
    // psoCrosslink summary lets the dispatch client toast "Sent to Process
    // Server queue" + jump to the queue row without an extra round-trip.
    return c.json(psoCrosslink ? { ...merged, pso_crosslink: psoCrosslink } : merged);
  } catch (err) {
    return c.json({ error: 'Failed to update status' }, 500);
  }
});

// POST /dispatch/calls/:id/action — the unified CFS Action Bus. Applies a named
// action ({action, verb, params}) to the call: column updates + narrative append
// + audit + action-log row (+ entity link). Return type pinned to dodge TS2589.
calls.post('/:id/action', requireRole(...WRITE_ROLES), async (c): Promise<Response> => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const { action, verb, params } = await c.req.json<{
      action?: string; verb?: string; params?: Record<string, unknown>;
    }>().catch(() => ({}) as { action?: string; verb?: string; params?: Record<string, unknown> });
    if (!isCfsVerb(verb)) return c.json({ error: 'invalid or missing verb' }, 400);

    const call = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM calls_for_service WHERE id = ?', id);
    if (!call) return c.json({ error: 'call not found' }, 404);

    const plan = planAction(call, String(action ?? verb), verb, params ?? {});
    if ('error' in plan) return c.json({ error: plan.error }, 400);

    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const [k, v] of Object.entries(plan.updates)) { sets.push(`${k} = ?`); vals.push(v); }
    // narrative lives on calls_for_service_ext, NOT the base table: base is at the
    // D1 100-col cap and has no `narrative` column, so writing/reading it there 500s
    // the whole action. Appended to the ext 1:1 row below (mirrors the ext write flow).
    if ('status' in plan.updates) sets.push(`status_changed_at = datetime('now')`);
    for (const t of plan.setTimes) sets.push(`${t} = COALESCE(${t}, datetime('now'))`);
    sets.push(`updated_at = datetime('now')`);
    vals.push(id);
    await execute(db, `UPDATE calls_for_service SET ${sets.join(', ')} WHERE id = ?`, ...vals);

    if (plan.narrative) {
      await execute(db, 'INSERT OR IGNORE INTO calls_for_service_ext (id) VALUES (?)', id);
      await execute(db,
        `UPDATE calls_for_service_ext SET narrative = TRIM(COALESCE(narrative, '') || ?) WHERE id = ?`,
        `\n[${new Date().toISOString()}] ${plan.narrative}`, id);
    }

    // Entity link — best-effort; the call_links schema may differ on live, and a
    // failed link must never fail the action (it's still logged below).
    if (plan.link) {
      try {
        await execute(db,
          `INSERT INTO call_links (call_id, entity_type, entity_id, created_at) VALUES (?, ?, ?, datetime('now'))`,
          id, plan.link.entity_type, plan.link.entity_id);
      } catch (linkErr) {
        log.warn('[cfs action] call_links insert degraded', { message: (linkErr as Error)?.message });
      }
    }

    await ensureCfsActionLog(db);
    const userId = c.get('userId') as number | undefined;
    await execute(db,
      `INSERT INTO cfs_action_log (call_id, action, verb, params, narrative, actor_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
      id, String(action ?? verb), verb, JSON.stringify(params ?? {}), plan.narrative, userId ?? null);
    try {
      if (userId != null) {
        await recordAudit(c, { action: 'CFS_ACTION', entityType: 'call', entityId: id, details: plan.narrative, actorId: userId });
      }
    } catch (auditErr) {
      log.warn('[cfs action] audit_log insert degraded', { message: (auditErr as Error)?.message });
    }

    const updated = await queryFirst<Record<string, unknown>>(db,
      `SELECT c.id, c.status, c.priority, c.disposition, c.unit_call_signs, c.incident_type, e.narrative
         FROM calls_for_service c
         LEFT JOIN calls_for_service_ext e ON e.id = c.id
        WHERE c.id = ?`, id);

    // PSO Client Request cross-link: mirror the close into the Process
    // Server queue when the action transitioned the call to a terminal
    // state. Same idempotent helper as POST /:id/status. Best-effort.
    let psoCrosslink: Awaited<ReturnType<typeof crossLinkPsoCloseToServe>> | null = null;
    const updatedStatus = String(updated?.status ?? '');
    if (id && ['cleared', 'closed', 'cancelled'].includes(updatedStatus)
        && (updated?.incident_type as string | undefined) === 'pso_client_request') {
      try {
        psoCrosslink = await crossLinkPsoCloseToServe(db, id, { actorUserId: userId ?? null });
      } catch (xlErr) {
        log.warn('[pso crosslink action] non-fatal', { message: (xlErr as Error)?.message });
      }
    }

    return c.json({
      success: true,
      action: action ?? verb,
      narrative: plan.narrative,
      call: updated,
      ...(psoCrosslink ? { pso_crosslink: psoCrosslink } : {}),
    });
  } catch (err) {
    log.error('POST /dispatch/calls/:id/action failed', {}, err);
    return c.json({ error: 'action failed' }, 500);
  }
});

// GET /dispatch/calls/:id/actions — CFS action history (newest first).
calls.get('/:id/actions', async (c): Promise<Response> => {
  const db = getDb(c.env);
  await ensureCfsActionLog(db);
  const rows = await query<Record<string, unknown>>(db,
    'SELECT * FROM cfs_action_log WHERE call_id = ? ORDER BY id DESC LIMIT 200', c.req.param('id'))
    .catch(() => [] as Record<string, unknown>[]);
  return c.json(rows);
});

// POST /dispatch/calls/:id/archive
calls.post('/:id/archive', requireRole(...WRITE_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    await execute(db, "UPDATE calls_for_service SET status = 'archived', archived_at = datetime('now') WHERE id = ?", id);
    // Release any units still assigned — archiving without this stranded them
    // in 'dispatched' on a dead call (the D19/CFS26-00055 incident).
    await syncUnitsWithCallStatus(db, c.env, id, 'archived');
    return c.json({ message: 'Archived' });
  } catch (err) { return c.json({ error: 'Archive failed' }, 500); }
});

// POST /dispatch/calls/:id/unarchive
calls.post('/:id/unarchive', requireRole(...WRITE_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    await execute(db, "UPDATE calls_for_service SET status = 'closed' WHERE id = ? AND status = 'archived'", id);
    try {
      const merged = await mergedCallRow(db, id);
      if (merged) await emitAlert(c.env, 'dispatch_update', { action: 'call_updated', call: merged });
    } catch { log.warn('Broadcast unarchive call_updated failed', { callId: id }); /* never block the response */ }
    return c.json({ message: 'Unarchived' });
  } catch (err) { return c.json({ error: 'Unarchive failed' }, 500); }
});

// POST /dispatch/calls/:id/hold
// Hold is an orthogonal flag in the _ext overflow table (held_at), NOT a status
// enum value — this avoids a CHECK rebuild of the 100-column, FK-referenced
// calls_for_service table (migration 0041 adds the column). Status is preserved
// while held; the queue badges held calls via held_at. The _ext row is created
// lazily if it doesn't exist yet (mirrors the run_card / PSO ext-write pattern).
calls.post('/:id/hold', requireRole(...WRITE_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    await db.batch([
      db.prepare('INSERT OR IGNORE INTO calls_for_service_ext (id) VALUES (?)').bind(id),
      db.prepare("UPDATE calls_for_service_ext SET held_at = datetime('now') WHERE id = ?").bind(id),
      db.prepare("UPDATE calls_for_service SET updated_at = datetime('now') WHERE id = ?").bind(id),
    ]);
    // Return the full row (not a bare {message}) incl. held_at so the client can
    // map it back to a real call object — mapDbCall derives the synthetic
    // 'on_hold' status from held_at. Returning {message} blanked the call card.
    // CRITICAL FIX: Return full ext table data (PSO/process fields) so the client
    // doesn't lose them after a hold operation.
    const row = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM calls_for_service WHERE id = ?', id);
    const ext = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM calls_for_service_ext WHERE id = ?', id);
    const merged = { ...(row || {}), ...(ext || {}) };
    // Broadcast so the held badge appears on peer dispatchers' queues
    // immediately (mapDbCall derives the synthetic 'on_hold' status from held_at).
    try { if (row) await emitAlert(c.env, 'dispatch_update', { action: 'call_updated', call: merged }); } catch { log.warn('Broadcast call_updated (hold) failed', { callId: id }); /* never block the response */ }
    return c.json(merged);
  } catch (err) {
    return c.json({ error: 'Hold failed' }, 500);
  }
});

// POST /dispatch/calls/:id/resume — clears the hold flag; status is untouched.
calls.post('/:id/resume', requireRole(...WRITE_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    await db.batch([
      db.prepare('UPDATE calls_for_service_ext SET held_at = NULL WHERE id = ?').bind(id),
      db.prepare("UPDATE calls_for_service SET updated_at = datetime('now') WHERE id = ?").bind(id),
    ]);
    // Return the full row with held_at cleared so the client maps it back to the
    // call's real (non-held) status instead of mapping a bare {message} to a blank.
    // CRITICAL FIX: Return full ext table data (PSO/process fields) so the client
    // doesn't lose them after a resume operation.
    const row = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM calls_for_service WHERE id = ?', id);
    const ext = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM calls_for_service_ext WHERE id = ?', id);
    const merged = { ...(row || {}), ...(ext || {}), held_at: null };
    // Broadcast so peer queues drop the held badge immediately.
    try { if (row) await emitAlert(c.env, 'dispatch_update', { action: 'call_updated', call: merged }); } catch { log.warn('Broadcast call_updated (resume) failed', { callId: id }); /* never block the response */ }
    return c.json(merged);
  } catch (err) {
    return c.json({ error: 'Resume failed' }, 500);
  }
});

// POST /dispatch/calls/:id/assign-unit
calls.post('/:id/assign-unit', requireRole(...WRITE_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id') ?? '';
    const callId = parseInt(id, 10);
    if (!Number.isInteger(callId) || callId <= 0) return c.json({ error: 'Invalid call id' }, 400);
    const body = await c.req.json<{ unit_id: number | string }>();
    // Client sends unit_id as a string; coerce so dedup against the numeric
    // assigned_unit_ids array works and we never store mixed [5172, "5172"].
    const unit_id = Number(body.unit_id);
    if (!Number.isFinite(unit_id) || unit_id <= 0) return c.json({ error: 'Invalid unit_id' }, 400);
    const call = await queryFirst<{ assigned_unit_ids: string; call_number: string; latitude: number | null; longitude: number | null }>(
      db, 'SELECT assigned_unit_ids, call_number, latitude, longitude FROM calls_for_service WHERE id = ?', id
    );
    if (!call) return c.json({ error: 'Call not found' }, 404);
    // Verify unit exists + isn't already committed to a different call.
    // (Pre-Claude version skipped both checks — see CROSS-INTEGRATION
    // GUARD comment above for the symptoms.)
    const unit = await queryFirst<{ id: number; current_call_id: number | null; call_sign: string | null }>(
      db, 'SELECT id, current_call_id, call_sign FROM units WHERE id = ?', unit_id);
    if (!unit) return c.json({ error: `Unit ${unit_id} does not exist`, code: 'UNIT_NOT_FOUND' }, 404);
    const prevCallId = unit.current_call_id != null && unit.current_call_id !== callId ? unit.current_call_id : null;
    if (prevCallId != null) {
      // Auto-unassign from old call so dispatchers can reassign in one step.
      try {
        const oldCall = await queryFirst<{ assigned_unit_ids: string }>(
          db, 'SELECT assigned_unit_ids FROM calls_for_service WHERE id = ?', prevCallId);
        if (oldCall) {
          const oldAssigned = parseUnitIds(oldCall.assigned_unit_ids).filter((u) => u !== Number(unit_id));
          await execute(db, 'UPDATE calls_for_service SET assigned_unit_ids = ? WHERE id = ?',
            canonicalUnitIdsJson(oldAssigned), prevCallId);
        }
      } catch { log.warn('Old-call cleanup failed during unit assign', { unitId: unit_id, prevCallId }); /* best-effort — proceed with assignment even if old-call cleanup fails */ }
    }
    const assigned = parseUnitIds(call.assigned_unit_ids);
    if (!assigned.includes(Number(unit_id))) assigned.push(Number(unit_id));
    await db.batch([
      db.prepare('UPDATE calls_for_service SET assigned_unit_ids = ? WHERE id = ?').bind(canonicalUnitIdsJson(assigned), id),
      db.prepare("UPDATE units SET status = 'dispatched', current_call_id = ? WHERE id = ?").bind(callId, unit_id),
    ]);

    // ── Premise auto-push (Spillman parity, DI-3) ──
    // Look up premise_alerts within 50m of the call's GPS, push to the
    // assigned officer's MDT via sendToUser. Best-effort.
    let premise_pushed = 0;
    try {
      if (call.latitude != null && call.longitude != null) {
        const dLat = 0.001;
        const dLng = 0.001 / Math.max(0.01, Math.cos(call.latitude * Math.PI / 180));
        const alerts = await query<Record<string, unknown>>(db, `
          SELECT id, address, latitude, longitude, alert_type, alert_level,
                 title, description, flags
          FROM premise_alerts
          WHERE active = 1
            AND latitude  BETWEEN ? AND ?
            AND longitude BETWEEN ? AND ?
            AND (expires_at IS NULL OR expires_at >= datetime('now'))`,
          call.latitude - dLat, call.latitude + dLat,
          call.longitude - dLng, call.longitude + dLng);
        const within50m = alerts.filter((a: Record<string, unknown>) => {
          const dLatR = (Number(a.latitude) - call.latitude!) * Math.PI / 180;
          const dLngR = (Number(a.longitude) - call.longitude!) * Math.PI / 180;
          const aa = Math.sin(dLatR / 2) ** 2 + Math.cos(call.latitude! * Math.PI / 180) * Math.cos(Number(a.latitude) * Math.PI / 180) * Math.sin(dLngR / 2) ** 2;
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
    } catch (err) { log.error('[dispatch] premise auto-push', {}, err); }

    // Return the full updated call row (not a bare {message}). The client
    // (handleAssignUnit) feeds this straight into mapDbCall() and replaces the
    // selected call with it — a partial response yields a blank-id corrupted
    // call that wipes the call out of the dispatch UI. Mirrors /dispatch,
    // /auto-assign, and /transfer, which all return the full row.
    const updated = await mergedCallRow(db, id);

    // Broadcast so peer consoles update without waiting for the 20s cross-device
    // poll. Two frames are required:
    //   1. call_updated for the NEW call (this one) so its assigned_unit_ids
    //      change reaches every dispatcher's call board immediately.
    //   2. call_updated for the OLD call if the unit was reassigned from it
    //      (otherwise Tab A keeps showing the unit on the old call for ~20s,
    //      which causes coordination errors during fast-moving incidents).
    //   3. unit_status_changed for the unit itself so the unit panel shows
    //      it on the new call.
    try {
      if (updated) await emitAlert(c.env, 'dispatch_update', { action: 'call_updated', call: updated });
      if (prevCallId != null) {
        const oldUpdated = await mergedCallRow(db, prevCallId);
        if (oldUpdated) await emitAlert(c.env, 'dispatch_update', { action: 'call_updated', call: oldUpdated });
      }
      await emitAlert(c.env, 'dispatch_update', {
        action: 'unit_status_changed',
        unit: { id: unit.id, call_sign: unit.call_sign, status: 'dispatched', current_call_id: callId },
      });
    } catch { log.warn('Broadcast after unit assign failed', { unitId: unit_id, callId: id }); /* never block the response */ }
    return c.json({ ...(updated || {}), premise_pushed });
  } catch (err) { return c.json({ error: 'Assign failed' }, 500); }
});

// POST /dispatch/calls/:id/unassign-unit
calls.post('/:id/unassign-unit', requireRole(...WRITE_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id') ?? '';
    const callId = parseInt(id, 10);
    if (!Number.isInteger(callId) || callId <= 0) return c.json({ error: 'Invalid call id' }, 400);
    const body = await c.req.json<{ unit_id: number | string }>();
    // Coerce to number: the client sends a string, and a string vs number
    // filter (5172 !== "5172") is always true — the unit would never be removed.
    const unit_id = Number(body.unit_id);
    if (!Number.isFinite(unit_id) || unit_id <= 0) return c.json({ error: 'Invalid unit_id' }, 400);
    const call = await queryFirst<{ assigned_unit_ids: string }>(db, 'SELECT assigned_unit_ids FROM calls_for_service WHERE id = ?', id);
    if (!call) return c.json({ error: 'Call not found' }, 404);
    // parseUnitIds coerces to ints so the filter works even when the row was
    // stored in the legacy ["5172"] string shape (string !== number is always
    // true → the unit would otherwise never be removed).
    const assigned = parseUnitIds(call.assigned_unit_ids).filter(u => u !== unit_id);
    await db.batch([
      db.prepare('UPDATE calls_for_service SET assigned_unit_ids = ? WHERE id = ?').bind(canonicalUnitIdsJson(assigned), id),
      db.prepare(
        `UPDATE units SET status = 'available', current_call_id = NULL, last_status_change = datetime('now')
         WHERE id = ? AND current_call_id = ?`).bind(unit_id, callId),
    ]);
    // Return the full updated call row — the client (handleUnassignUnit) runs it
    // through mapDbCall() and replaces the selected call; a bare {message}
    // corrupts the call to a blank-id object. Mirrors /assign-unit.
    const updated = await mergedCallRow(db, id);

    // Broadcast: call_updated so peer dispatchers see the unit drop from this
    // call, and unit_status_changed so the unit panel shows the unit free
    // (status=available, current_call_id=null). Mirrors the syncUnitsWithCallStatus
    // pattern at line 920-933 for terminal-status releases.
    try {
      const unitRow = await queryFirst<{ call_sign: string | null }>(db, 'SELECT call_sign FROM units WHERE id = ?', unit_id);
      if (updated) await emitAlert(c.env, 'dispatch_update', { action: 'call_updated', call: updated });
      await emitAlert(c.env, 'dispatch_update', {
        action: 'unit_status_changed',
        unit: { id: unit_id, call_sign: unitRow?.call_sign ?? null, status: 'available', current_call_id: null, current_call_number: null },
      });
    } catch { log.warn('Broadcast after unit unassign failed', { unitId: unit_id }); /* never block the response */ }
    return c.json(updated || {});
  } catch (err) { return c.json({ error: 'Unassign failed' }, 500); }
});

// POST /dispatch/calls/:id/dispatch - Multi-unit dispatch
calls.post('/:id/dispatch', requireRole(...WRITE_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id') ?? '';
    const callId = parseInt(id, 10);
    if (!Number.isInteger(callId) || callId <= 0) return c.json({ error: 'Invalid call id' }, 400);
    const { unit_ids } = await c.req.json<{ unit_ids: number[] }>();
    if (!Array.isArray(unit_ids) || unit_ids.length === 0) return c.json({ error: 'No units specified' }, 400);
    const cleanIds = unit_ids.map((u) => Number(u)).filter((u) => Number.isInteger(u) && u > 0);
    if (cleanIds.length === 0) return c.json({ error: 'No valid unit_ids' }, 400);

    const call = await queryFirst<{ assigned_unit_ids: string }>(db, 'SELECT assigned_unit_ids FROM calls_for_service WHERE id = ?', id);
    if (!call) return c.json({ error: 'Call not found' }, 404);

    // Validate that none of the units are already on a different call.
    // Single query: WHERE id IN (...) AND current_call_id IS NOT NULL
    // AND current_call_id != :callId returns the offenders in one shot.
    const placeholders = cleanIds.map(() => '?').join(',');
    const conflicts = await query<{ id: number; call_sign: string | null; current_call_id: number }>(
      db,
      `SELECT id, call_sign, current_call_id FROM units
        WHERE id IN (${placeholders})
          AND current_call_id IS NOT NULL
          AND current_call_id != ?`,
      ...cleanIds, callId);
    if (conflicts.length > 0) {
      return c.json({
        error: `${conflicts.length} unit(s) are already committed to other calls`,
        code: 'UNITS_ON_OTHER_CALLS',
        conflicts: conflicts.map((c) => ({ unit_id: c.id, call_sign: c.call_sign, current_call_id: c.current_call_id })),
      }, 409);
    }

    const assigned = new Set(parseUnitIds(call.assigned_unit_ids));
    for (const uid of cleanIds) assigned.add(Number(uid));

    await execute(db, "UPDATE calls_for_service SET assigned_unit_ids = ?, status = 'dispatched', dispatched_at = COALESCE(dispatched_at, datetime('now')) WHERE id = ?", canonicalUnitIdsJson([...assigned]), id);

    for (const uid of cleanIds) {
      await execute(db, "UPDATE units SET status = 'dispatched', current_call_id = ?, last_status_change = datetime('now') WHERE id = ?", callId, uid);
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

    const parentBase = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM calls_for_service WHERE id = ?', parentId);
    if (!parentBase) return c.json({ error: 'Call not found', code: 'CALL_NOT_FOUND' }, 404);
    const parentExt = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM calls_for_service_ext WHERE id = ?', parentId);

    if (!['pso_client_request', 'process_service'].includes(String(parentBase.incident_type))) {
      return c.json({ error: 'Re-dispatch is only available for PSO Client Request and Process Service calls', code: 'REDISPATCH_TYPE_INVALID' }, 400);
    }
    if (!['cleared', 'closed', 'cancelled', 'archived'].includes(String(parentBase.status))) {
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
        try { await execute(db, 'INSERT INTO call_persons (call_id, person_id, role, notes) VALUES (?, ?, ?, ?)', newCallId, p.person_id, p.role, p.notes); } catch { log.warn('Redispatch copy person failed', { personId: p.person_id, newCallId }); /* skip dup/constraint */ }
      }
    } catch (e) { log.warn('redispatch copy persons failed (non-fatal)', { err: e }); }
    try {
      const vehicles = await query<{ vehicle_id: number; role: string | null; notes: string | null }>(db, 'SELECT vehicle_id, role, notes FROM call_vehicles WHERE call_id = ?', parentId);
      for (const v of vehicles) {
        try { await execute(db, 'INSERT INTO call_vehicles (call_id, vehicle_id, role, notes) VALUES (?, ?, ?, ?)', newCallId, v.vehicle_id, v.role, v.notes); } catch { log.warn('Redispatch copy vehicle failed', { vehicleId: v.vehicle_id, newCallId }); /* skip dup/constraint */ }
      }
    } catch (e) { log.warn('redispatch copy vehicles failed (non-fatal)', { err: e }); }

    // ── Parent back-link note ──
    let parentNotes: any[] = [];
    try { parentNotes = JSON.parse(String(parentBase.notes ?? '[]')); if (!Array.isArray(parentNotes)) parentNotes = []; } catch { parentNotes = []; }
    parentNotes.push({ id: String(Date.now() + 1), author: 'System', text: `Re-dispatched → new call ${newCallNumber}`, timestamp: nowIso });
    await execute(db, "UPDATE calls_for_service SET notes = ?, updated_at = datetime('now') WHERE id = ?", JSON.stringify(parentNotes), parentId);

    // ── Audit trail (best-effort) ──
    try {
      await recordAudit(c, { action: 'call_redispatched', entityType: 'call', entityId: parentId, details: `Re-dispatched → ${newCallNumber} (${ordinal(newAttempt)} attempt)`, actorId: userId });
      await recordAudit(c, { action: 'call_created_from_redispatch', entityType: 'call', entityId: newCallId, details: `Created from re-dispatch of ${parentBase.call_number} (${ordinal(newAttempt)} attempt)`, actorId: userId });
    } catch (e) { log.warn('redispatch audit_log failed (non-fatal)', { err: e }); }

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
    await emitAlert(c.env, 'dispatch_update', { action: 'call_created', call: newCall });
    // CRITICAL FIX: Include parent ext data in the broadcast so clients don't
    // lose PSO/process fields when the parent call is updated via WebSocket.
    await emitAlert(c.env, 'dispatch_update', { action: 'call_updated', call: { ...parentBase, ...(parentExt || {}), notes: JSON.stringify(parentNotes) } });

    return c.json({ ...newCall, chain, parent_call_number: parentBase.call_number }, 201);
  } catch (err) {
    log.error('Re-dispatch call error', {}, err);
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

    const childBase = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM calls_for_service WHERE id = ?', childId);
    if (!childBase) return c.json({ error: 'Call not found', code: 'CALL_NOT_FOUND' }, 404);
    const childExt = await queryFirst<Record<string, unknown>>(db, 'SELECT parent_call_id FROM calls_for_service_ext WHERE id = ?', childId);

    const parentId = childExt?.parent_call_id as number | undefined;
    if (parentId == null) return c.json({ error: 'This call is not a re-dispatch — it has no parent call', code: 'NOT_A_REDISPATCH' }, 400);

    // Pending-only, unless admin (which logs an override).
    if (childBase.status !== 'pending' && user.role !== 'admin') {
      return c.json({ error: 'Can only undo a return visit that is still pending. Once dispatched, it cannot be undone.', code: 'CHILD_NOT_PENDING' }, 400);
    }
    if (user.role === 'admin' && childBase.status !== 'pending') {
      await recordAudit(c, { action: 'ADMIN_OVERRIDE', entityType: 'call', entityId: childId, details: `Admin override: bypassed pending-only undo-redispatch (status: ${childBase.status})`, actorId: userId });
    }

    const parentBase = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM calls_for_service WHERE id = ?', parentId);
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
      try { await execute(db, sql, childId); } catch (e) { log.warn(`undo-redispatch ${sql} failed (non-fatal)`, { err: e }); }
    }

    // Restore parent notes: drop the "Re-dispatched → new call X" note, add an undo note.
    let parentNotes: any[] = [];
    try { parentNotes = JSON.parse(String(parentBase.notes ?? '[]')); if (!Array.isArray(parentNotes)) parentNotes = []; } catch { parentNotes = []; }
    parentNotes = parentNotes.filter((n: any) => !String(n?.text || '').includes(`Re-dispatched → new call ${childBase.call_number}`));
    parentNotes.push({ id: String(Date.now()), author: user.full_name || 'System', text: `Return visit ${childBase.call_number} was undone`, timestamp: new Date().toISOString() });
    await execute(db, "UPDATE calls_for_service SET notes = ?, updated_at = datetime('now') WHERE id = ?", JSON.stringify(parentNotes), parentId);

    await recordAudit(c, { action: 'undo_redispatch', entityType: 'call', entityId: parentId, details: `Undid return visit ${childBase.call_number} for ${parentBase.call_number}`, actorId: userId });

    const updatedBase = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM calls_for_service WHERE id = ?', parentId);
    const updatedExt = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM calls_for_service_ext WHERE id = ?', parentId);
    const updated = { ...(updatedBase || {}), ...(updatedExt || {}) };
    await emitAlert(c.env, 'dispatch_update', { action: 'call_deleted', call: { id: childId, call_number: childBase.call_number } });
    await emitAlert(c.env, 'dispatch_update', { action: 'call_updated', call: updated });

    return c.json({ success: true, parent: updated, deleted_call: childBase.call_number });
  } catch (err) {
    log.error('Undo redispatch error', {}, err);
    return c.json({ error: `Failed to undo return visit: ${(err as Error)?.message || 'unknown'}`, code: 'UNDO_REDISPATCH_ERROR' }, 500);
  }
});

// ── POST /dispatch/calls/bulk-reassign ──────────────────────
calls.post('/bulk-reassign', requireRole(...WRITE_ROLES), async (c) => {
  try {
    const body = await c.req.json<{ call_ids: number[]; unit_id: number }>();
    if (!Array.isArray(body.call_ids) || !body.call_ids.length || !body.unit_id) {
      return c.json({ error: 'call_ids (array) and unit_id required' }, 400);
    }
    const db = getDb(c.env);
    // `call_sign` is the units table's human-readable id (UNIQUE NOT NULL);
    // there is NO `unit_number` column on units (that lives on the GPS-device
    // table) — selecting it threw `no such column` and the catch turned every
    // reassign into a generic 500. Return it as `target` so the God Mode toast
    // renders "Reassigned N calls to D19" instead of "...to undefined".
    const unit = await queryFirst<{ id: number; call_sign: string }>(db,
      'SELECT id, call_sign FROM units WHERE id = ?', body.unit_id);
    if (!unit) return c.json({ error: 'Unit not found' }, 404);
    let updated = 0;
    for (const callId of body.call_ids.slice(0, 50)) {
      try {
        await execute(db,
          `UPDATE calls_for_service SET assigned_unit_ids = ?, updated_at = datetime('now') WHERE id = ?`,
          canonicalUnitIdsJson([body.unit_id]), callId);
        updated++;
      } catch { log.warn('Bulk reassign update failed for call', { callId, unitId: body.unit_id }); /* skip individual failures */ }
    }
    await emitAlert(c.env, 'dispatch_update', { action: 'bulk_reassign', unit_id: body.unit_id, call_ids: body.call_ids });
    return c.json({ success: true, updated, total: body.call_ids.length, target: unit.call_sign });
  } catch (err) {
    return c.json({ error: 'Bulk reassign failed' }, 500);
  }
});

// ── POST /dispatch/calls/force-close-all ────────────────────
// God Mode bulk action (Admin → God Mode → Bulk Call Operations). Closes
// EVERY currently-open call in one shot — no per-call selection — stamping the
// supplied disposition. "Open" = the active CAD status set the queue/active
// views use; closing flips each to 'closed' with closed_at + disposition,
// exactly like the per-call status writer (POST /:id/status). Mirrors the
// bulk-reassign sibling's shape: read body, cap the batch, mutate, emit a
// dispatch_update, return { success, closed } (the client toast reads `closed`).
// Assigned units are RELEASED so they don't strand 'dispatched' on a now-dead
// call — the exact "stuck on the board" hazard syncUnitsWithCallStatus and the
// archive-bulk handler both defend against.
const FORCE_CLOSE_OPEN_STATUSES = ['pending', 'dispatched', 'enroute', 'onscene', 'open'];
const FORCE_CLOSE_BATCH_CAP = 500;

calls.post('/force-close-all', requireRole(...WRITE_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const body = await c.req.json<{ disposition?: string }>().catch(() => ({} as { disposition?: string }));
    const disposition = typeof body.disposition === 'string' && body.disposition.trim().length > 0
      ? body.disposition.trim()
      : 'Closed by Admin';

    // Capture the open call ids first (capped) so we know exactly which calls —
    // and therefore which units — this operation touched. "Force close ALL" is
    // meant to clear a backlog, not scan an unbounded table in one UPDATE; if
    // more than the cap are open, re-run to drain the rest.
    const openStatusPlaceholders = FORCE_CLOSE_OPEN_STATUSES.map(() => '?').join(',');
    const open = await query<{ id: number }>(db,
      `SELECT id FROM calls_for_service WHERE status IN (${openStatusPlaceholders}) ORDER BY id LIMIT ${FORCE_CLOSE_BATCH_CAP}`,
      ...FORCE_CLOSE_OPEN_STATUSES);
    if (open.length === 0) return c.json({ success: true, closed: 0 });

    const ids = open.map((r) => r.id);
    const idPlaceholders = ids.map(() => '?').join(',');
    await execute(db,
      `UPDATE calls_for_service
          SET status = 'closed',
              disposition = ?,
              closed_at = COALESCE(closed_at, datetime('now')),
              status_changed_at = datetime('now'),
              updated_at = datetime('now')
        WHERE id IN (${idPlaceholders})`,
      disposition, ...ids);

    // Release any units riding the calls we just closed (best-effort — a sync
    // failure must never fail the close). Emits one unit_status_changed per
    // freed unit so every console drops it from the call without a refresh.
    try {
      const affected = await query<{ id: number; call_sign: string }>(db,
        `SELECT id, call_sign FROM units WHERE current_call_id IN (${idPlaceholders})`, ...ids);
      if (affected.length) {
        await execute(db,
          `UPDATE units SET status = 'available', current_call_id = NULL,
                  last_status_change = datetime('now'), updated_at = datetime('now')
            WHERE current_call_id IN (${idPlaceholders})`, ...ids);
        for (const u of affected) {
          await emitAlert(c.env, 'dispatch_update', {
            action: 'unit_status_changed',
            unit: { id: u.id, call_sign: u.call_sign, status: 'available', current_call_id: null, current_call_number: null },
          });
        }
      }
    } catch (err) {
      log.warn('[calls] force-close-all unit release failed (non-fatal)', { err });
    }

    // One summary audit row — a bulk close is destructive and worth a trail.
    // entity_id is NULL (no single call); audit_log.entity_id is nullable TEXT.
    try {
      const userId = c.get('userId') as number | undefined;
      if (userId != null) {
        await recordAudit(c, { action: 'FORCE_CLOSE_ALL', entityType: 'call', entityId: null, details: `Force-closed ${ids.length} open call(s) with disposition "${disposition}"`, actorId: userId });
      }
    } catch (auditErr) {
      log.warn('audit_log insert failed for force-close-all', { err: auditErr });
    }

    await emitAlert(c.env, 'dispatch_update', { action: 'bulk_force_close', closed: ids.length, disposition });
    return c.json({ success: true, closed: ids.length });
  } catch (err) {
    log.error('Force close-all error', {}, err);
    return c.json({ error: 'Force close failed' }, 500);
  }
});

export default calls;

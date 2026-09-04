import { Hono } from 'hono';
import type { Env } from '../../types';
import type { D1Database } from '@cloudflare/workers-types';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { getDb, query, queryFirst, queryInChunks, execute, executeInChunks, executeBatch, columnExists } from '../../utils/db';
import { authMiddleware, requireRole } from '../../middleware/auth';
import { applyRunCard } from '../runCards';
import { sendToUser, broadcastAll } from '../ws';
import { emitAlert } from '../../utils/alertHub';
import { log } from '../../utils/logger';
import { recordAudit } from '../../utils/auditLog';
import { emitFleetioEvent } from '../../utils/fleetio/events';

import { dbErrorResponse } from '../../utils/dbErrors';
import { ACTIVE_CALL_WHERE } from '../../utils/callStatus';
import { assignStackGroup, leaveStackGroup, reassignStackGroup, syncToStack, type SyncFields } from '../../utils/stackSync';
import {
  collectCallChainIds,
  findServeJobForCall,
  findRestoreCallIdForUndoRedispatch,
  relinkServeJobForRedispatch,
  restoreServeJobAfterUndoRedispatch,
} from '../../utils/psoServeCrosslink';
import { stampCallWeather } from '../../utils/cfsWeatherStamp';
import { parseWeatherSnapshot } from '../../utils/cfsWeather';
const calls = new Hono<Env>();

// ── Atomic call-number sequence (C2) ──────────────────────────────────────
// The sequence table is created once per isolate (boot reconciler pattern used
// throughout this codebase). INSERT INTO ... DEFAULT VALUES returns a unique,
// monotonically increasing id under concurrent Workers — no SELECT MAX race.
let callSeqEnsured = false;
async function ensureCallNumberSeq(db: D1Database): Promise<void> {
  if (callSeqEnsured) return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS call_number_seq (id INTEGER PRIMARY KEY AUTOINCREMENT)`).run();
  callSeqEnsured = true;
}

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
  'weather_conditions',
  // Mileage + overdue
  'starting_mileage', 'ending_mileage', 'overdue_notified',
] as const;

// Pre-built `c.col1, c.col2, ...` fragment used in every list query.
// Exported so peer routers (callLinks, aggregates) can reuse it instead of
// rebuilding the join string and risk drifting from this projection.
export const LIST_VIEW_SELECT = LIST_VIEW_COLUMNS.map(col => `c.${col}`).join(', ');

// GET /dispatch/calls - List calls with filters (also handles /active via query param)
calls.get('/', requireRole('officer', 'dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  try {
    const db = getDb(c.env);
    const { status, priority, startDate, endDate, search, archived, page, limit, active, unit_id } = c.req.query();

    let where = 'WHERE 1=1';
    const params: unknown[] = [];

    if (status) {
      const statuses = status.split(',').map(s => s.trim()).filter(Boolean);
      if (statuses.length === 1) { where += ' AND c.status = ?'; params.push(statuses[0]); }
      else if (statuses.length > 1) { const capped = statuses.slice(0, 90); where += ` AND c.status IN (${capped.map(() => '?').join(',')})`; params.push(...capped); }
    }
    if (priority) { where += ' AND c.priority = ?'; params.push(priority.toUpperCase()); }
    if (startDate) { where += ' AND c.created_at >= ?'; params.push(startDate); }
    if (endDate) { where += ' AND c.created_at <= ?'; params.push(endDate); }
    if (search) {
      where += " AND (c.call_number LIKE ? OR c.incident_type LIKE ? OR c.location_address LIKE ? OR c.description LIKE ?)";
      const s = `%${search.slice(0, 48)}%`; params.push(s, s, s, s);
    }
    if (archived === 'true') where += " AND c.status = 'archived'";
    else if (archived !== 'all') where += " AND c.status != 'archived'";

    // `active=true` narrows to in-progress statuses only. This used to also
    // fire implicitly whenever neither `status` nor `archived` was passed,
    // which *replaced* the whole WHERE clause above (silently dropping
    // cleared/closed/cancelled rows AND any startDate/search/priority filter
    // for every caller that didn't explicitly ask for archived/status —
    // CallHistoryDrawer, MdtPage's monthly fetch, CallPicker, and the
    // Dispatch page's "Cleared" tab all hit this). Dedicated active-only
    // listing lives at GET /dispatch/calls/active; this flag is now additive,
    // not a replacement, so unset callers correctly get "everything
    // non-archived" per the archived handling above.
    if (active === 'true') {
      where += " AND c.status IN ('dispatched','enroute','onscene','pending')";
    }

    // `unit_id` scopes the list to calls assigned to one unit — opt-in, so
    // dispatch/supervisor views (which need every agency call) keep omitting
    // it. assigned_unit_ids is a JSON array column (see the assignment
    // handlers further down this file); json_each is the only reliable "does
    // this array contain N" check without a LIKE false-positive on
    // substrings (e.g. unit 1 matching 11/21). Added for the CarPlay/
    // officer-facing call list, which must show only the officer's own
    // assigned calls rather than every agency call.
    const unitIdNum = unit_id != null ? Number(unit_id) : NaN;
    if (Number.isFinite(unitIdNum)) {
      where += " AND EXISTS (SELECT 1 FROM json_each(c.assigned_unit_ids) je WHERE je.value = ?)";
      params.push(unitIdNum);
    }

    const pageNum = Math.max(1, parseInt(page || '1', 10));
    const limitNum = Math.min(250, Math.max(1, parseInt(limit || '200', 10)));
    const offset = (pageNum - 1) * limitNum;

    const countRow = await queryFirst<{ total: number }>(db, `SELECT COUNT(*) as total FROM calls_for_service c ${where}`, ...params);
    const total = countRow?.total ?? 0;

    // Narrow projection — see LIST_VIEW_COLUMNS comment for the D1 100-col
    // result-set cap. SELECT c.* + JOIN columns 500s; this stays under ~60.
    // cfse.pinned is ONE explicit column from the ext table — safe under the
    // result-set cap (the cap problem is SELECT c.*, not a single joined col).
    // Sorted pinned-first so a dispatcher's pinned calls stay on top across
    // refreshes (the PATCH /:id/pin handler writes cfse.pinned).
    const rows = await query<Record<string, unknown>>(db, `
      SELECT ${LIST_VIEW_SELECT},
        p.name as property_name, u.full_name as dispatcher_name,
        cl.name as client_name,
        COALESCE(cfse.pinned, 0) as pinned
      FROM calls_for_service c
      LEFT JOIN properties p ON c.property_id = p.id
      LEFT JOIN users u ON c.dispatcher_id = u.id
      LEFT JOIN clients cl ON COALESCE(c.client_id, p.client_id) = cl.id
      LEFT JOIN calls_for_service_ext cfse ON cfse.id = c.id
      ${where}
      ORDER BY COALESCE(cfse.pinned, 0) DESC, c.priority_score IS NOT NULL, c.priority_score DESC, c.created_at DESC
      LIMIT ? OFFSET ?
    `, ...params, limitNum, offset);

    return c.json({
      data: rows,
      pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (err) {
    log.error('GET /dispatch/calls failed', { query: c.req.query() }, err as Error);
    return c.json({ error: 'Failed to get calls' }, 500);
  }
});

// POST /dispatch/calls - Create call
calls.post('/', requireRole('officer', 'dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  try {
    const db = getDb(c.env);
    const body = await c.req.json<Record<string, unknown>>();
    const userId = (c.get('userId') as number | undefined) ?? null;

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

    // ── Smart context defaults ──
    // Time-of-day: night shift (18-06) auto-sets officer safety + lighting flags
    if (body.officer_safety_caution == null) {
      const hour = parseInt(new Date().toLocaleString('en-US', { timeZone: 'America/Denver', hour: '2-digit', hour12: false }), 10);
      if (hour >= 18 || hour < 6) body.officer_safety_caution = 1;
    }
    // Weather: if weather data available and hazardous, auto-set caution flag
    // (best-effort — weather endpoint may be unavailable)
    if (!body.officer_safety_caution && body.latitude != null && body.longitude != null) {
      try {
        const weatherAc = new AbortController();
        const weatherTimer = setTimeout(() => weatherAc.abort(), 3000);
        let weatherResp: Response;
        try {
          weatherResp = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${body.latitude}&longitude=${body.longitude}&current=weather_code&timezone=America%2FDenver`, { signal: weatherAc.signal });
        } finally {
          clearTimeout(weatherTimer);
        }
        const weather = await weatherResp!.json() as any;
        const code = weather?.current?.weather_code;
        // WMO weather codes: 95-99 = thunderstorm, 71-77 = snow, 56-67 = freezing, 85-86 = snow showers
        if (code && (code >= 95 || code === 71 || code === 73 || code === 75 || code === 77 || code === 85 || code === 86 || code === 66 || code === 67)) {
          body.officer_safety_caution = 1;
        }
      } catch { /* best-effort */ }
    }

    // Call-number format: CFS{YY}-{NNNNN}, 5-digit sequence, resets
    // each calendar year (the LIKE filter is YY-scoped so MAX() only
    // sees this year's rows). Example: CFS26-00001.
    // Back-compat: legacy rows used "{YY}-CFS{NNNNN}" — those still
    // co-exist; the LIKE here only scans the new format so we don't
    // collide with the old sequence.
    const year = new Date().toLocaleString('en-US', { timeZone: 'America/Denver', year: 'numeric' }).slice(-2); // Denver-zone year, not the UTC Workers host's — avoids rolling the CFS# prefix ~5-7pm MT on Dec 31
    const prefix = `CFS${year}-`;
    // ── Atomic call-number generation (C2) ──
    // INSERT into the sequence table — AUTOINCREMENT guarantees uniqueness
    // under concurrent Workers without a MAX read-then-increment race.
    await ensureCallNumberSeq(db);
    const seqResult = await db.prepare("INSERT INTO call_number_seq DEFAULT VALUES").run();
    let callNumber = `${prefix}${String(seqResult.meta.last_row_id).padStart(5, '0')}`;

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
    const createdAtRaw = typeof body.created_at === 'string' ? body.created_at.trim() : '';
    if (createdAtRaw && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(createdAtRaw)) {
      vals.push('?', '?', '?', "datetime('now')");
      bindParams.push(callNumber, userId, createdAtRaw.replace('T', ' ').slice(0, 19));
    } else {
      vals.push('?', '?', "datetime('now')", "datetime('now')");
      bindParams.push(callNumber, userId);
    }

    // Same whitelist applies on create as on edit. Use the
    // UPDATABLE_CALL_COLUMNS_BASE set so any column writable later is
    // writable on insert. Skip immutable cols (id, call_number,
    // created_at, dispatcher_id — set above).
    const skipOnCreate = new Set(['id', 'call_number', 'created_at', 'dispatcher_id']);
    const VALID_CREATE_STATUSES = new Set(['pending','dispatched','enroute','onscene','cleared','closed','cancelled','archived']);
    if (body.status == null || !VALID_CREATE_STATUSES.has(String(body.status))) {
      skipOnCreate.add('status');
    }
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

    // ── Duplicate call detection ──────────────────────────────────────────
    // Check for an active call of the same incident type within ~0.25 miles
    // in the last 30 minutes. Haversine approximation via SQLite math:
    //   distance ≈ sqrt((Δlat*111.139)² + (Δlng*111.139*cos(lat_rad))²) km
    // 0.25 miles ≈ 0.402 km → threshold 0.402. Best-effort — never blocks create.
    let duplicate_warning: {
      call_id: number; call_number: string; distance_miles: number; created_at: string;
    } | null = null;
    try {
      const dupLat = body.latitude != null ? Number(body.latitude) : null;
      const dupLng = body.longitude != null ? Number(body.longitude) : null;
      const dupType = String(incident_type || '').trim().toUpperCase();
      if (dupLat != null && dupLng != null && Number.isFinite(dupLat) && Number.isFinite(dupLng) && dupType) {
        const dupRow = await queryFirst<{
          id: number; call_number: string; latitude: number; longitude: number; created_at: string;
        }>(db, `
          SELECT id, call_number, latitude, longitude, created_at
          FROM calls_for_service
          WHERE ${ACTIVE_CALL_WHERE}
            AND UPPER(TRIM(incident_type)) = ?
            AND created_at >= datetime('now', '-30 minutes')
            AND latitude IS NOT NULL AND longitude IS NOT NULL
          ORDER BY created_at DESC
          LIMIT 1
        `, dupType);
        if (dupRow) {
          const dLat = (dupRow.latitude - dupLat) * 111.139;
          const dLng = (dupRow.longitude - dupLng) * 111.139 * Math.cos(dupLat * Math.PI / 180);
          const distKm = Math.sqrt(dLat * dLat + dLng * dLng);
          const distMiles = distKm * 0.621371;
          if (distMiles <= 0.25) {
            duplicate_warning = {
              call_id: dupRow.id,
              call_number: dupRow.call_number,
              distance_miles: Math.round(distMiles * 1000) / 1000,
              created_at: dupRow.created_at,
            };
          }
        }
      }
    } catch (dupErr) {
      log.warn('Duplicate call detection failed (non-fatal)', { err: String((dupErr as Error)?.message ?? dupErr) });
    }

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
          log.warn('run_card ext write failed (non-fatal)', { callId, err: String((extErr as Error)?.message ?? extErr) });
        }
      }

      // ── Stack group assignment ──
      // Best-effort: never block call creation on a sync failure.
      try {
        await execute(db, 'INSERT OR IGNORE INTO calls_for_service_ext (id) VALUES (?)', callId);
        await assignStackGroup(db, callId, String(location_address || ''));
      } catch (stackErr) {
        log.error('assignStackGroup failed on call create (non-fatal)', { callId }, stackErr);
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
        log.warn('audit_log insert failed for call create (non-fatal)', { callId, err: String((auditErr as Error)?.message ?? auditErr) });
      }

      // Broadcast to every connected dispatcher so rosters re-render
      // without a manual refresh. Matches the legacy POST behavior.
      broadcastAll('dispatch_update', { action: 'call_created', call });

      // Background geocoding — best-effort, never blocks the response.
      // Two paths: forward (address → coords) and reverse (coords → address).
      const stampAfterCreate = async (lat: number | null, lng: number | null, at: string | null) => {
        try {
          await stampCallWeather(db, {
            callId,
            lat,
            lng,
            at,
            existingConditions: (body.weather_conditions as string) || null,
            existingLighting: (body.lighting_conditions as string) || null,
            weatherManual: body.weather_manual === 1 || body.weather_manual === true || body.weather_manual === '1',
            overwriteConditions: false,
          });
        } catch { /* best-effort */ }
      };

      const createdAtForWeather = createdAtRaw || null;
      const hasCoordsNow = body.latitude != null && body.longitude != null &&
        Number.isFinite(Number(body.latitude)) && Number.isFinite(Number(body.longitude));
      if (hasCoordsNow) {
        c.executionCtx.waitUntil(stampAfterCreate(Number(body.latitude), Number(body.longitude), createdAtForWeather));
      }

      import('../geocode').then(async (geo) => {
        try {
          const addr = body.location_address as string | undefined;
          const hasAddr = addr && addr.trim().length >= 3;
          const hasCoords = body.latitude != null && body.longitude != null &&
            Number.isFinite(Number(body.latitude)) && Number.isFinite(Number(body.longitude));

          if (hasAddr && !hasCoords) {
            // Forward geocode: address provided but no coordinates — populate lat/lng
            const coords = await geo.geocodeAddress(c.env, addr!.trim());
            if (coords) {
              await execute(db, `UPDATE calls_for_service SET latitude = ?, longitude = ?, updated_at = datetime(\'now\') WHERE id = ?`, coords.lat, coords.lng, callId);
              await stampAfterCreate(coords.lat, coords.lng, createdAtForWeather);
            }
          } else if (!hasAddr && hasCoords) {
            // Reverse geocode: coordinates provided but no address — populate address
            const label = await geo.reverseGeocodeAddress(c.env, Number(body.latitude), Number(body.longitude));
            if (label) {
              await execute(db, `UPDATE calls_for_service SET location_address = ?, updated_at = datetime(\'now\') WHERE id = ?`, label, callId);
            }
          }
        } catch { /* best-effort */ }
      }).catch(() => {});

      return c.json({ ...call, runCard: rcResult.card, duplicate_warning }, 201);
    } catch (sqlErr: any) {
      // Surface the real SQL error so the dispatcher (and we) can see
      // which column / FK is rejecting. Without this the client sees a
      // generic 500 and we can't debug from production.
      const msg = String(sqlErr?.message || sqlErr || 'unknown');
      log.error('Create call INSERT failed', { msg, userId, cols }, new Error(msg));
      if (msg.includes('FOREIGN KEY')) {
        return c.json({
          error: `Foreign key constraint failed. dispatcher_id=${userId} (must reference users.id), property_id=${body.property_id ?? null}, client_id=${(body as any).client_id ?? null}. Detail: ${msg}`,
          code: 'FK_VIOLATION',
        }, 500);
      }
      return c.json({ error: `Failed to create call: ${msg}`, code: 'INSERT_FAILED' }, 500);
    }
  } catch (err: any) {
    log.error('Create call outer error', {}, err as Error);
    return c.json({ error: `Failed to create call: ${err?.message || 'unknown'}`, code: 'OUTER_ERROR' }, 500);
  }
});

// GET /dispatch/calls/active - Active calls shortcut
calls.get('/active', requireRole('officer', 'dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  try {
    const db = getDb(c.env);
    // Narrow projection — see LIST_VIEW_COLUMNS for D1 100-col cap rationale.
    const rows = await query<Record<string, unknown>>(db, `
      SELECT ${LIST_VIEW_SELECT},
        u.full_name as dispatcher_name, p.name as property_name
      FROM calls_for_service c
      LEFT JOIN users u ON c.dispatcher_id = u.id
      LEFT JOIN properties p ON c.property_id = p.id
      WHERE c.status IN ('dispatched','enroute','onscene','pending')
      ORDER BY c.created_at DESC LIMIT 200
    `);
    return c.json(rows);
  } catch (err) {
    log.error('GET /active failed', { src: 'src/routes/dispatch/calls.ts' }, err);
    return c.json({ error: 'Failed to get active calls' }, 500);
  }
});

// GET /dispatch/calls/export - CSV export
calls.get('/export', requireRole('dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
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
    log.error('GET /export failed', { src: 'src/routes/dispatch/calls.ts' }, err);
    return c.json({ error: 'Failed to export calls' }, 500);
  }
});

// GET /dispatch/calls/check-duplicate
calls.get('/check-duplicate', requireRole('officer', 'dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  try {
    const db = getDb(c.env);
    const address = c.req.query('address');
    const latStr = c.req.query('lat');
    const lngStr = c.req.query('lng');

    if (!address && (!latStr || !lngStr)) return c.json({ duplicates: [], count: 0 });

    // Text-based duplicate check
    const textResults: Record<string, unknown>[] = [];
    if (address && address.length >= 3) {
      const normalized = address.toUpperCase().replace(/\s+/g, ' ').trim();
      const rows = await query<Record<string, unknown>>(db, `
        SELECT id, call_number, incident_type, priority, status, location_address, latitude, longitude, created_at
        FROM calls_for_service
        WHERE ${ACTIVE_CALL_WHERE}
          AND UPPER(REPLACE(location_address, '  ', ' ')) LIKE ?
        ORDER BY created_at DESC LIMIT 10
      `, `%${normalized.slice(0, 48)}%`);
      textResults.push(...rows);
    }

    // Spatial proximity check (within 100m of active calls)
    const spatialResults: Record<string, unknown>[] = [];
    if (latStr && lngStr) {
      const lat = parseFloat(latStr);
      const lng = parseFloat(lngStr);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        const dLat = 0.001; // ~111m
        const dLng = 0.001 / Math.max(0.01, Math.cos(lat * Math.PI / 180));
        const rows = await query<Record<string, unknown>>(db, `
          SELECT id, call_number, incident_type, priority, status, location_address, latitude, longitude, created_at
          FROM calls_for_service
          WHERE ${ACTIVE_CALL_WHERE}
            AND latitude IS NOT NULL AND longitude IS NOT NULL
            AND latitude BETWEEN ? AND ?
            AND longitude BETWEEN ? AND ?
          ORDER BY created_at DESC LIMIT 10
        `, lat - dLat, lat + dLat, lng - dLng, lng + dLng);
        spatialResults.push(...rows);
      }
    }

    // Dedupe by id
    const seen = new Set<number>();
    const all = [...textResults, ...spatialResults].filter((r) => {
      const id = r.id as number;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });

    return c.json({ duplicates: all.slice(0, 15), count: all.length });
  } catch (err) {
    log.error('GET /check-duplicate failed', { src: 'src/routes/dispatch/calls.ts' }, err);
    return c.json({ error: 'Duplicate check failed' }, 500);
  }
});

// GET /dispatch/calls/hits - MUST be before /:id routes.
// Lightweight companion to the intel screening engine (src/utils/intelScreen.ts)
// for the Dispatch CAD board: rather than running screenPerson/screenVehicle
// per call on every render (N+1, expensive), this returns just the set of
// non-archived call IDs with a hit worth a queue-scanning glance — stolen/
// watchlisted vehicle, a linked person with an active warrant/watchlist
// entry, or a linked person matched to the NSOPW sex-offender registry
// (national_sex_offenders.person_id, migration 0149) — linked via
// call_vehicles/call_persons. Generic caution/gang flags are intentionally
// excluded: this is a "check this call" signal, not the full screening
// detail (that still lives on the call/person/vehicle record itself).
calls.get('/hits', requireRole('officer', 'dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<{ call_id: number }>(db, `
      SELECT DISTINCT c.id as call_id
      FROM calls_for_service c
      WHERE c.status != 'archived' AND (
        EXISTS (
          SELECT 1 FROM call_vehicles cv JOIN vehicles_records v ON v.id = cv.vehicle_id
          WHERE cv.call_id = c.id AND (v.is_stolen = 1 OR (v.stolen_status IS NOT NULL AND v.stolen_status != ''))
        )
        OR EXISTS (
          SELECT 1 FROM call_vehicles cv JOIN intel_watchlist w
            ON w.entity_type = 'vehicle' AND w.entity_id = cv.vehicle_id AND w.active = 1
          WHERE cv.call_id = c.id
        )
        OR EXISTS (
          SELECT 1 FROM call_persons cp JOIN warrants wa
            ON wa.subject_person_id = cp.person_id AND wa.status IN ('active', 'outstanding')
          WHERE cp.call_id = c.id
        )
        OR EXISTS (
          SELECT 1 FROM call_persons cp JOIN intel_watchlist w
            ON w.entity_type = 'person' AND w.entity_id = cp.person_id AND w.active = 1
          WHERE cp.call_id = c.id
        )
        OR EXISTS (
          SELECT 1 FROM call_persons cp JOIN national_sex_offenders nso ON nso.person_id = cp.person_id
          WHERE cp.call_id = c.id
        )
      )
      LIMIT 500
    `);
    return c.json({ call_ids: rows.map((r) => r.call_id) });
  } catch (err) {
    log.error('GET /dispatch/calls/hits failed', {}, err as Error);
    return c.json({ error: 'Failed to get call hits' }, 500);
  }
});

// GET /dispatch/calls/archive-bulk - MUST be before /:id routes
calls.get('/archive-bulk', async (c) => {
  // redirect to POST
  return c.redirect('/dispatch/calls/archive-bulk', 307);
});

calls.post('/archive-bulk', requireRole('dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
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

    // Release units from all calls that will be archived before archiving them.
    // Without this, dispatched units keep pointing at archived calls and never
    // return to available on the board.
    try {
      const toArchive = await query<{ id: number; assigned_unit_ids: string }>(
        db,
        `SELECT id, assigned_unit_ids FROM calls_for_service WHERE status IN (${placeholders}) AND assigned_unit_ids IS NOT NULL AND assigned_unit_ids != '[]'`,
        ...statuses,
      );
      const allUnitIds = toArchive.flatMap((c) => {
        try { return JSON.parse(c.assigned_unit_ids || '[]') as number[]; } catch { return []; }
      }).filter((id) => typeof id === 'number');
      const callIds = toArchive.map((c) => c.id);
      if (allUnitIds.length > 0) {
        await executeInChunks(db, allUnitIds, (ph) => `UPDATE units SET status = 'available', current_call_id = NULL WHERE id IN (${ph})`);
      }
      if (callIds.length > 0) {
        await executeInChunks(db, callIds, (ph) => `UPDATE calls_for_service SET assigned_unit_ids = '[]', unit_call_signs = '[]' WHERE id IN (${ph})`);
      }
    } catch (unitErr) {
      log.error('archive-bulk unit release failed (non-fatal)', {}, unitErr as Error);
    }

    const result = await execute(db,
      `UPDATE calls_for_service SET status = 'archived', archived_at = datetime(\'now\') WHERE status IN (${placeholders})`,
      ...statuses);
    const archived_count = (result as any)?.meta?.changes ?? 0;
    return c.json({ archived_count });
  } catch (err) {
    log.error('POST /archive-bulk failed', { src: 'src/routes/dispatch/calls.ts' }, err);
    return c.json({ error: 'Bulk archive failed' }, 500);
  }
});

// ── Call Templates (CRUD for reusable dispatch patterns) ─────
calls.get('/templates', requireRole('officer', 'dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number | undefined;
    const rows = await query<Record<string, unknown>>(db,
      `SELECT * FROM call_templates WHERE (owner_user_id = ? OR is_shared = 1) AND active = 1 ORDER BY use_count DESC, name`, userId ?? 0);
    return c.json(rows);
  } catch { return c.json([]); }
});

// GET /dispatch/calls/:id - Single call
// Split into multiple narrow queries instead of one wide JOIN because D1
// caps result sets at 100 columns. calls_for_service is ~93 columns; adding
// property/user/client JOIN columns or LEFT JOIN calls_for_service_ext blew
// past the cap and produced SQLITE_ERROR 7500 "too many columns in result set".
calls.get('/:id', requireRole('officer', 'dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    if (!Number.isFinite(Number(id))) return c.json({ error: 'Invalid id' }, 400);

    const call = await queryFirst<Record<string, unknown>>(
      db, 'SELECT * FROM calls_for_service WHERE id = ?', id);
    if (!call) return c.json({ error: 'Call not found' }, 404);

    const ext = await queryFirst<Record<string, unknown>>(
      db, 'SELECT * FROM calls_for_service_ext WHERE id = ?', id);

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
    const assignedUnits = assignedIds.length === 0 ? [] : await queryInChunks<Record<string, unknown>>(
      db, assignedIds,
      (ph) => `SELECT u.*, usr.full_name as officer_name, usr.badge_number
               FROM units u LEFT JOIN users usr ON u.officer_id = usr.id
               WHERE u.id IN (${ph})`,
    );

    const incidents = await query<Record<string, unknown>>(db,
      'SELECT id, incident_number, incident_type, status, created_at FROM incidents WHERE call_id = ? ORDER BY created_at DESC LIMIT 1000', id);

    const activity = await query<Record<string, unknown>>(db,
      'SELECT al.*, u.full_name as user_name FROM audit_log al LEFT JOIN users u ON al.user_id = u.id WHERE al.entity_type = ? AND al.entity_id = ? ORDER BY al.created_at DESC LIMIT 1000',
      'call', id);

    // Visit snapshots are stored against the ROOT call id. Collect the whole
    // return-visit family so the root (no parent_call_id) still returns history,
    // and a child still sees every prior visit.
    const chainIds = await collectCallChainIds(db, Number(id)).catch(() => [Number(id)]);
    const historyIds = chainIds.length ? chainIds : [Number(id)];
    const visitHistory = await queryInChunks<Record<string, unknown>>(
      db,
      historyIds,
      (ph) =>
        `SELECT cvh.*, fv.vehicle_number AS responding_vehicle_number
         FROM call_visit_history cvh
         LEFT JOIN fleet_vehicles fv ON fv.id = cvh.responding_vehicle_id
         WHERE cvh.call_id IN (${ph})
         ORDER BY cvh.visit_number ASC, cvh.id ASC LIMIT 200`,
    );

    const serveJob = await findServeJobForCall(db, Number(id)).catch(() => null);

    const parentCallId = ext?.parent_call_id != null ? Number(ext.parent_call_id) : null;
    const parentCall = parentCallId
      ? await queryFirst<{ id: number; call_number: string; status: string; pso_attempt_number: number | null }>(
        db,
        'SELECT id, call_number, status, pso_attempt_number FROM calls_for_service WHERE id = ?',
        parentCallId,
      ).catch(() => null)
      : null;
    const siblingIds = historyIds.filter((cid) => cid !== Number(id));
    const childCalls = siblingIds.length
      ? await queryInChunks<{ id: number; call_number: string; status: string; pso_attempt_number: number | null }>(
        db,
        siblingIds,
        (ph) =>
          `SELECT id, call_number, status, pso_attempt_number FROM calls_for_service
           WHERE id IN (${ph})
           ORDER BY COALESCE(pso_attempt_number, 0) ASC, id ASC`,
      ).catch(() => [])
      : [];

    return c.json({
      ...call,
      ...(ext || {}),
      ...(joined || {}),
      serve_queue_id: serveJob?.id ?? null,
      assigned_units: assignedUnits,
      related_incidents: incidents,
      activity,
      visit_history: visitHistory,
      parent_call: parentCall,
      child_calls: childCalls,
    });
  } catch (err) {
    log.error('GET /dispatch/calls/:id failed', { id: c.req.param('id') }, err as Error);
    return dbErrorResponse(c, err, 'Failed to get call');
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
  // court (added by migration 0145; this allowlist was never updated to
  // match, so every court_name edit silently fell into the `skipped`
  // bucket in the PUT handler below and was never written — the field
  // "failed to save on reopening" because it was never persisted at all)
  'court_name',
  'attorney_name', 'jurisdiction', 'deadline', 'time_window',
  'service_instructions', 'plaintiff_name',
  // tactical flags overflowed here on 2026-05-26 when calls_for_service hit
  // the 100-column D1 cap. New tactical flags should land here too.
  'fire_requested', 'hazmat', 'gang_related', 'evidence_collected',
  'body_camera_active', 'photos_taken', 'trespass_issued',
  'vehicle_pursuit', 'foot_pursuit', 'pinned',
  // geography — submitted by NewCallModal and the edit panel but were
  // missing from both column sets so every area_code/area_name edit was
  // silently dropped into the skipped[] bucket and never written
  'area_code', 'area_name',
  // Live/historical scene weather snapshot (migration 0271)
  'weather_snapshot', 'weather_manual',
]);

// PUT /dispatch/calls/:id - Update call
calls.put('/:id', requireRole('dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const existing = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM calls_for_service WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Call not found' }, 404);

    const body = await c.req.json<Record<string, unknown>>();
    const baseUpdates: string[] = [];
    const baseParams: unknown[] = [];
    const extUpdates: string[] = [];
    const extParams: unknown[] = [];
    const skipped: string[] = [];

    const VALID_CALL_STATUSES = new Set(['pending','dispatched','enroute','onscene','cleared','closed','cancelled','archived','merged','split','on_hold']);
    for (const [key, val] of Object.entries(body)) {
      if (key === 'status' && val != null && !VALID_CALL_STATUSES.has(String(val))) {
        return c.json({ error: `Invalid status '${val}'`, code: 'INVALID_STATUS' }, 400);
      }
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

    // ── Stack sync: mileage + address changes ──
    try {
      // Address change: leave old group, join/create at new address.
      const newAddr = body.location_address as string | undefined;
      const oldAddr = String(existing.location_address ?? '');
      if (newAddr && newAddr.trim().toLowerCase() !== oldAddr.trim().toLowerCase()) {
        await reassignStackGroup(db, parseInt(id || '0', 10), newAddr);
      }

      // Re-read after possible reassignment — reassignStackGroup writes a new stack_group_id.
      const ext = await queryFirst<{ stack_group_id: string | null }>(
        db, 'SELECT stack_group_id FROM calls_for_service_ext WHERE id = ?', id,
      );

      // Mileage sync to current group.
      if (ext?.stack_group_id) {
        const mileageFields: SyncFields['mileage'] = {};
        if ('starting_mileage' in body && body.starting_mileage !== undefined) {
          mileageFields.starting_mileage = Number(body.starting_mileage);
        }
        if ('ending_mileage' in body && body.ending_mileage !== undefined) {
          mileageFields.ending_mileage = Number(body.ending_mileage);
        }
        if (Object.keys(mileageFields).length) {
          await syncToStack(db, ext.stack_group_id, parseInt(id || '0', 10), { mileage: mileageFields });
        }
      }
    } catch (stackErr) {
      log.error('stack sync on PUT /calls/:id failed (non-fatal)', { callId: id }, stackErr);
    }

    // Forward geocode: if address changed and the row still has no coordinates,
    // populate lat/lng in the background so the call appears on the map.
    const newAddr = body.location_address as string | undefined;
    const stillMissingCoords = updatedBase?.latitude == null && updatedBase?.longitude == null;
    if (newAddr && newAddr.trim().length >= 3 && stillMissingCoords) {
      import('../geocode').then(async (geo) => {
        try {
          const coords = await geo.geocodeAddress(c.env, newAddr.trim());
          if (coords) {
            await execute(db, `UPDATE calls_for_service SET latitude = ?, longitude = ?, updated_at = datetime(\'now\') WHERE id = ?`, coords.lat, coords.lng, id);
          }
        } catch { /* best-effort */ }
      }).catch(() => {});
    }

    const timeChanged = 'created_at' in body || 'dispatched_at' in body;
    const coordsChanged = 'latitude' in body || 'longitude' in body;
    if (timeChanged || coordsChanged) {
      const lat = Number((updatedBase as any)?.latitude ?? existing.latitude);
      const lng = Number((updatedBase as any)?.longitude ?? existing.longitude);
      const at = String((updatedBase as any)?.created_at || body.created_at || existing.created_at || '');
      const existingManual = Number((updatedExt as any)?.weather_manual) === 1;
      const snap = await stampCallWeather(db, {
        callId: parseInt(String(id), 10),
        lat: Number.isFinite(lat) ? lat : null,
        lng: Number.isFinite(lng) ? lng : null,
        at,
        existingConditions: String((updatedBase as any)?.weather_conditions || ''),
        existingLighting: String((updatedBase as any)?.lighting_conditions || ''),
        weatherManual: existingManual && !timeChanged,
        overwriteConditions: timeChanged,
      });
      if (snap) {
        if (!updatedExt) {
          // stamp creates the ext row; merge into the response even if the
          // pre-stamp SELECT missed it.
        }
        const extOut = { ...(updatedExt || {}), weather_snapshot: JSON.stringify(snap) };
        if (timeChanged && updatedBase) {
          updatedBase.weather_conditions = snap.scene_category;
          if (snap.lighting) updatedBase.lighting_conditions = snap.lighting;
        }
        return c.json({
          ...(updatedBase || {}),
          ...extOut,
          weather_snapshot: snap,
        });
      }
    }

    return c.json({
      ...(updatedBase || {}),
      ...(updatedExt || {}),
      weather_snapshot: parseWeatherSnapshot((updatedExt as any)?.weather_snapshot) ?? (updatedExt as any)?.weather_snapshot,
    });
  } catch (err) {
    log.error('PUT /dispatch/calls/:id failed', { id: c.req.param('id') }, err as Error);
    return dbErrorResponse(c, err, 'Failed to update call');
  }
});

// GET /dispatch/calls/:id/audit-trail — chronological event log for this call.
// Reads from audit_log filtered by entity_type='call'. The client renders
// { created_at, action, details, user_name } per row in the Audit tab
// (DispatchPage.tsx ~line 5280). Degrades to empty on error rather than 500
// so the tab doesn't break if audit_log schema drifts.
calls.get('/:id/audit-trail', requireRole('officer', 'dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
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
    log.error('GET /dispatch/calls/:id/audit-trail failed', {}, err as Error);
    return c.json({ events: [] });
  }
});

// POST /dispatch/calls/:id/merge — consolidate duplicate CFS into a master call
calls.post('/:id/merge', requireRole('dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id') || '0', 10);
    const { merge_call_ids } = await c.req.json<{ merge_call_ids: number[] }>();
    if (!Array.isArray(merge_call_ids) || !merge_call_ids.length) {
      return c.json({ error: 'merge_call_ids array required' }, 400);
    }
    const master = await queryFirst<{ id: number }>(db, 'SELECT id FROM calls_for_service WHERE id = ?', id);
    if (!master) return c.json({ error: 'Master call not found' }, 404);

    const userId = c.get('userId') as number | undefined;
    let merged = 0;
    for (const mergeId of merge_call_ids) {
      if (mergeId === id) continue;
      // Copy linked persons from merged call to master
      await execute(db,
        `INSERT OR IGNORE INTO call_persons (call_id, person_id, role)
         SELECT ?, person_id, COALESCE(role, 'involved')
         FROM call_persons WHERE call_id = ?`, id, mergeId);
      // Copy notes to master
      await execute(db,
        `INSERT INTO call_notes (call_id, user_id, note, created_at)
         SELECT ?, user_id, '[Merged from CFS #' || cn.call_id || '] ' || note, datetime(\'now\')
         FROM (SELECT call_id, user_id, note FROM call_notes WHERE call_id = ? LIMIT 50) cn`,
        id, mergeId);
      // Mark merged call as merged with reference. calls_for_service has no
      // merged_into_id and is at D1's 100-column cap, so the structured link
      // goes to the overflow table's parent_call_id instead of a new column.
      await execute(db,
        `UPDATE calls_for_service SET status = 'merged', notes = COALESCE(notes || char(10), '') || '[Merged into CFS ' || ? || ']'
         WHERE id = ?`, (await queryFirst<{ call_number: string }>(db, 'SELECT call_number FROM calls_for_service WHERE id = ?', id))?.call_number || String(id), mergeId);
      await execute(db, 'INSERT OR IGNORE INTO calls_for_service_ext (id) VALUES (?)', mergeId);
      await execute(db, 'UPDATE calls_for_service_ext SET parent_call_id = ? WHERE id = ?', id, mergeId);
      await recordAudit(c, {
        action: 'merge_call', entityType: 'call', entityId: mergeId,
        details: { merged_into: id },
      });
      merged++;
    }
    return c.json({ success: true, merged, master_call_id: id });
  } catch (err) {
    log.error('[dispatch] call merge failed', {}, err as Error);
    return c.json({ error: 'Call merge failed' }, 500);
  }
});

// DELETE /dispatch/calls/:id
// Hard-deletes a dispatch record permanently — same destructiveness class as
// the bulk /force-close-all above, so it carries the same admin|manager gate.
// Was ungated, letting any authenticated non-client_viewer role (officer,
// contract_manager, human_resources) erase an in-progress officer-safety call
// by id, wiping it from every console via the broadcast below.
calls.delete('/:id', requireRole('admin', 'manager'), async (c) => {
  const idStr = c.req.param('id');
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: 'Invalid call id', code: 'INVALID_ID' }, 400);
  }
  try {
    const db = getDb(c.env);
    const callRow = await queryFirst<{ id: number }>(db, 'SELECT id FROM calls_for_service WHERE id = ?', id);
    if (!callRow) return c.json({ error: 'Call not found', code: 'NOT_FOUND' }, 404);

    // ── Detach dependents BEFORE the parent delete ──
    // D1 runs with PRAGMA foreign_keys=1. Only three child tables declare
    // ON DELETE CASCADE (calls_for_service_ext, call_businesses, case_calls);
    // every other reference to calls_for_service(id) is a bare REFERENCES,
    // which SQLite treats as NO ACTION — so the parent DELETE is REJECTED with
    // "FOREIGN KEY constraint failed" the moment any of them holds a row.
    // That is exactly what produced the DELETE /dispatch/calls/147 → 500 loop:
    // a single call_persons row was enough, and the old blanket catch reported
    // nothing, so the client retried a request that could never succeed.
    //
    // Policy, deliberately split by what the row IS:
    //  - Pure link rows (call_persons, call_vehicles) carry no independent
    //    record value — they only exist to tie a person/vehicle TO this call,
    //    so they are removed with it.
    //  - Standalone records that merely *point* at the call (incidents,
    //    impounds, radio_transmissions, nav_trip_log) are records-management
    //    artifacts in their own right. Deleting a CAD call must never silently
    //    destroy an incident report or an impound; their pointer is NULLed and
    //    the record survives.
    //  - units are live operational state: release any unit still showing this
    //    call as current/emergency rather than orphaning a dangling pointer
    //    that makes the unit read as permanently busy.
    await executeBatch(db, [
      { sql: 'DELETE FROM call_persons WHERE call_id = ?', bindings: [id] },
      { sql: 'DELETE FROM call_vehicles WHERE call_id = ?', bindings: [id] },
      { sql: 'UPDATE incidents SET call_id = NULL WHERE call_id = ?', bindings: [id] },
      { sql: 'UPDATE impounds SET call_id = NULL WHERE call_id = ?', bindings: [id] },
      { sql: 'UPDATE radio_transmissions SET call_id = NULL WHERE call_id = ?', bindings: [id] },
      { sql: 'UPDATE nav_trip_log SET call_id = NULL WHERE call_id = ?', bindings: [id] },
      {
        sql: `UPDATE units SET status = 'available', current_call_id = NULL,
              last_status_change = datetime(\'now\') WHERE current_call_id = ?`,
        bindings: [id],
      },
      { sql: 'UPDATE units SET emergency_call_id = NULL WHERE emergency_call_id = ?', bindings: [id] },
      { sql: 'DELETE FROM calls_for_service WHERE id = ?', bindings: [id] },
    ]);

    // Emit alert for deletion
    await emitAlert(c.env, 'dispatch_update', { action: 'call_deleted', call: { id } });
    return c.json({ message: 'Call deleted' });
  } catch (err) {
    // Never swallow this again — a bare 500 here is what made the original
    // incident undiagnosable from the server side.
    log.error('Failed to delete call', { route: 'DELETE /dispatch/calls/:id', callId: id }, err as Error);
    return c.json({ error: 'Failed to delete call' }, 500);
  }
});

// POST /dispatch/calls/:id/status - Status transition
calls.post('/:id/status', requireRole('dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id') || '';
    // The clear/close flow (client handleConfirmClear) sends { status, disposition }.
    // Persist disposition alongside the status transition — dropping it left the
    // call's outcome blank and the disposition column NULL after every clear.
    const { status, disposition, starting_mileage, ending_mileage } = await c.req.json<{
      status: string;
      disposition?: string;
      starting_mileage?: number | string;
      ending_mileage?: number | string;
    }>();
    const callCheck = await queryFirst<{ id: number }>(db, 'SELECT id FROM calls_for_service WHERE id = ?', id);
    if (!callCheck) return c.json({ error: 'Call not found', code: 'NOT_FOUND' }, 404);
    // NOTE: 'on_hold' is intentionally NOT in this list. Hold is stored as
    // calls_for_service_ext.held_at (migration 0041), an orthogonal flag set
    // via POST /:id/hold and /:id/resume — not a real status value — so a
    // direct write of 'on_hold' here would overwrite the call's true status
    // instead of layering hold on top of it.
    const valid = ['pending', 'dispatched', 'enroute', 'onscene', 'cleared', 'closed', 'cancelled', 'archived'];
    if (!valid.includes(status)) return c.json({ error: 'Invalid status', code: 'INVALID_STATUS' }, 400);

    // Clearing/closing a call without a disposition leaves the outcome
    // permanently blank (nothing else ever backfills it). The UI's
    // DispositionPrompt enforces this client-side, but that's not a
    // backstop against a direct API call or a client bug — require it
    // here too unless the call already has one on file.
    if (status === 'cleared' || status === 'closed') {
      const hasDisposition = typeof disposition === 'string' && disposition.length > 0;
      if (!hasDisposition) {
        const existing = await queryFirst<{ disposition: string | null }>(
          db, 'SELECT disposition FROM calls_for_service WHERE id = ?', id
        );
        if (!existing?.disposition) {
          return c.json({ error: 'A disposition is required to clear or close a call', code: 'DISPOSITION_REQUIRED' }, 400);
        }
      }
    }

    const timeField = `${status}_at`;
    const validTimeFields = ['dispatched_at', 'enroute_at', 'onscene_at', 'cleared_at', 'closed_at', 'archived_at'];
    const timeSql = validTimeFields.includes(timeField) ? `, ${timeField} = COALESCE(${timeField}, datetime('now'))` : '';
    const dispSql = typeof disposition === 'string' && disposition.length > 0 ? ', disposition = ?' : '';
    let mileageSql = '';
    const extraParams: unknown[] = [];

    const parsedStartMi = starting_mileage != null && Number(starting_mileage) > 0 ? Math.round(Number(starting_mileage) * 10) / 10 : null;
    const parsedEndMi = ending_mileage != null && Number(ending_mileage) > 0 ? Math.round(Number(ending_mileage) * 10) / 10 : null;

    if (parsedStartMi != null) {
      mileageSql += ', starting_mileage = ?';
      extraParams.push(parsedStartMi);
    }
    if (parsedEndMi != null) {
      mileageSql += ', ending_mileage = ?';
      extraParams.push(parsedEndMi);
    }

    const params: unknown[] = [status];
    if (dispSql) params.push(disposition);
    params.push(...extraParams);
    params.push(id);
    await execute(db, `UPDATE calls_for_service SET status = ?, updated_at = datetime(\'now\')${timeSql}${dispSql}${mileageSql} WHERE id = ?`, ...params);
    if (status === 'cleared' || status === 'closed' || status === 'cancelled') {
      try {
        await execute(db,
          `UPDATE calls_for_service SET onscene_duration_seconds = CASE
             WHEN onscene_at IS NOT NULL AND (onscene_duration_seconds IS NULL OR onscene_duration_seconds = 0)
             THEN CAST((julianday(COALESCE(cleared_at, closed_at, datetime('now'))) - julianday(onscene_at)) * 86400 AS INTEGER)
             ELSE onscene_duration_seconds
           END
           WHERE id = ?`,
          id);
      } catch (err) {
        log.error('[dispatch] failed to stamp onscene_duration_seconds', { callId: id }, err as Error);
      }
    }
    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM calls_for_service WHERE id = ?', id);

    // ── Stack sync: propagate timestamp + cascaded unit status to siblings ──
    try {
      const ext = await queryFirst<{ stack_group_id: string | null }>(
        db, 'SELECT stack_group_id FROM calls_for_service_ext WHERE id = ?', id,
      );
      if (ext?.stack_group_id) {
        const timestampFields: Record<string, string> = {
          dispatched: 'dispatched_at',
          enroute:    'enroute_at',
          onscene:    'onscene_at',
        };
        const tsField = timestampFields[status as keyof typeof timestampFields];
        const tsValue = tsField ? String(updated?.[tsField] ?? '') : '';
        if (tsField && tsValue) {
          await syncToStack(db, ext.stack_group_id, parseInt(id, 10), {
            timestamps: { [tsField]: tsValue } as any,
          });
        }
      }
    } catch (stackErr) {
      log.error('syncToStack timestamps failed (non-fatal)', { callId: id, status }, stackErr);
    }

    // response_time_seconds is read by every response-time report/dashboard
    // stat (see reports.ts RESP formula), but nothing ever wrote it — those
    // stats silently fell back to (onscene_at - created_at), which measures
    // queue-wait + response combined rather than actual dispatch-to-arrival.
    // Compute it once, on the transition that first sets onscene_at.
    if (status === 'onscene' && updated?.dispatched_at && updated?.onscene_at) {
      try {
        await execute(db,
          `UPDATE calls_for_service SET response_time_seconds = (julianday(onscene_at) - julianday(dispatched_at)) * 86400 WHERE id = ? AND response_time_seconds IS NULL`,
          id);
      } catch (err) { log.error('[dispatch] failed to compute response_time_seconds', { callId: id }, err as Error); }
    }

    // ── Cascade non-terminal transitions to assigned units ──
    // A call moving dispatched→enroute→onscene previously left every assigned
    // unit's status frozen wherever assign-unit set it — the roster/MDT kept
    // reading "dispatched" while the call itself said "onscene". Units mirror
    // the call's status 1:1 (units.status supports the same 'enroute'/
    // 'onscene' values — see the VALID list in units.ts) but only when the
    // unit is still actively working this call; a unit already marked
    // 'unavailable'/'out_of_service' should not be silently pulled back into
    // service just because the call moved.
    if (status === 'enroute' || status === 'onscene') {
      try {
        const assignedIds = JSON.parse(String(updated?.assigned_unit_ids || '[]')) as number[];
        if (Array.isArray(assignedIds) && assignedIds.length > 0) {
          await executeInChunks(db, assignedIds,
            (ph) => `UPDATE units SET status = ?, last_status_change = datetime(\'now\') WHERE id IN (${ph}) AND status IN ('dispatched', 'enroute', 'onscene')`,
            [status]);
        }
      } catch (err) { log.error('[dispatch] failed to cascade unit status on call transition', { callId: id, status }, err as Error); }
    }

    // ── Release assigned units on a terminal transition ──
    // On close/clear/cancel, release all assigned units back to 'available'
    // and clear their current_call_id. Without this, units stay permanently
    // busy on a dead call, and recommended-units/closest-unit skip them.
    const TERMINAL_STATUSES = new Set(['cleared', 'closed', 'cancelled', 'archived', 'merged', 'split']);
    if (TERMINAL_STATUSES.has(status)) {
      try {
        const assignedIds = JSON.parse(String(updated?.assigned_unit_ids || '[]')) as number[];
        if (Array.isArray(assignedIds) && assignedIds.length > 0) {
          // current_call_id leg: sweep any unit that still points at this call.
          await execute(db, `UPDATE units SET status = 'available', current_call_id = NULL WHERE current_call_id = ?`, parseInt(id, 10));
          // IN-list leg: release assigned units by explicit id, chunked to stay under D1's 100-param cap.
          await executeInChunks(db, assignedIds,
            (ph) => `UPDATE units SET status = 'available', current_call_id = NULL WHERE id IN (${ph})`);
          // Promote queued calls for each released unit.
          for (const uid of assignedIds) {
            promoteQueuedCall(db, uid).catch((qErr) =>
              log.error('promoteQueuedCall on call close failed (non-fatal)', { unit_id: uid }, qErr),
            );
          }
        }
      } catch (err) { log.error('[dispatch] failed to release units on call close', { callId: id }, err as Error); }
    }

    // ── Stack group: leave on terminal status ──
    if (['cleared', 'closed', 'cancelled', 'archived', 'merged', 'split'].includes(status)) {
      try {
        await leaveStackGroup(db, parseInt(id, 10));
      } catch (stackErr) {
        log.error('leaveStackGroup failed (non-fatal)', { callId: id }, stackErr);
      }
    }

    // ── PSO cross-link: on clear/close of a process-server call, mirror
    // the outcome into serve_queue (creates or updates the linked job).
    // Fire-and-forget — the status transition must never fail on PSO sync.
    if (status === 'cleared' || status === 'closed') {
      const userId = c.get('userId') as number | undefined;
      import('../../utils/psoServeCrosslink').then((m) => {
        m.crossLinkPsoCloseToServe(db, id, { actorUserId: userId ?? null })
          .then((r: { skipped: boolean; queueId: number | null; attemptId: number | null; dispositionCode: string | null }) => {
            if (!r.skipped) {
              log.info(`[pso-crosslink] CFS ${id} → queue ${r.queueId} attempt ${r.attemptId} (${r.dispositionCode})`);
              // Broadcast serve queue change so ServePage polls and picks up the new entry
              try {
                broadcastAll('data_changed', { module: 'process-server', entity: 'queue', action: 'crosslinked', queue_id: r.queueId, call_id: id });
              } catch { /* best-effort */ }
            }
          })
          .catch((err: Error) => log.error('[pso-crosslink] sync failed', {}, err));
      }).catch(() => {});
    }

    // ── Dial Connect status webhook ──────────────────────────────
    // Fire-and-forget: if this CFS was created via the Dial Connect
    // integration push (POST /api/integrations/calls-for-service,
    // external_source_system = 'dial_connect'), notify Dial Connect of the
    // new status so its own Incident row doesn't go stale. Never blocks or
    // fails this response -- the status transition has already succeeded
    // by this point regardless of whether the notification lands.
    const webhookUrl = (c.env as Record<string, unknown>).DIAL_CONNECT_WEBHOOK_URL as string | undefined;
    const webhookSecret = (c.env as Record<string, unknown>).DIAL_CONNECT_WEBHOOK_SECRET as string | undefined;
    if (webhookUrl && webhookSecret) {
      queryFirst<{ external_source_system: string | null }>(
        db, 'SELECT external_source_system FROM calls_for_service_ext WHERE id = ?', id
      ).then((ext) => {
        if (ext?.external_source_system !== 'dial_connect') return;
        return fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: webhookSecret },
          body: JSON.stringify({ cfsId: parseInt(id, 10), callNumber: updated?.call_number, status }),
        });
      }).catch((err) => log.error('[dispatch] Dial Connect status webhook failed', {}, err instanceof Error ? err : new Error(String(err))));
    }

    // Broadcast so every connected dispatcher/map/MDT client re-renders
    // without a manual refresh. call_created already broadcasts (above, in
    // POST /) but this status-transition endpoint never did — clients only
    // saw a status change on their next poll or page reload.
    broadcastAll('dispatch_update', { action: 'call_status_changed', call: updated });

    return c.json(updated);
  } catch (err) {
    log.error('POST /:id/status failed', { src: 'src/routes/dispatch/calls.ts' }, err);
    return c.json({ error: 'Failed to update status' }, 500);
  }
});

// D1 caps bound parameters per query at 100. Both bulk routes below can
// operate on arbitrarily many rows (that's the whole point of an
// emergency bulk tool), so every IN(...) update must be chunked rather
// than built as one query — a single-query version throws once the id
// list (plus any extra bound params) crosses the limit, exactly when
// the bulk tool is most needed (many open calls at once).
const D1_PARAM_CHUNK = 90;
// Promote the next queued call for a unit that just cleared its active slot.
// Called after unassign-unit and after terminal call-status transitions.
// depth guard: a corrupt queued_call_ids list (all cancelled entries) could
// recurse until the Workers call stack limit — cap at 20 iterations.
async function promoteQueuedCall(
  db: Awaited<ReturnType<typeof getDb>>,
  unit_id: number,
  _depth = 0,
): Promise<void> {
  if (_depth >= 20) {
    await execute(db, "UPDATE units SET queued_call_ids = '[]' WHERE id = ?", unit_id);
    return;
  }
  const row = await queryFirst<{ queued_call_ids: string }>(
    db, 'SELECT queued_call_ids FROM units WHERE id = ?', unit_id,
  );
  if (!row) return;
  const queue = JSON.parse(row.queued_call_ids || '[]') as number[];
  if (queue.length === 0) return;
  const nextCallId = queue[0];
  const remaining = queue.slice(1);
  const nextCall = await queryFirst<{ status: string }>(
    db, 'SELECT status FROM calls_for_service WHERE id = ?', nextCallId,
  );
  if (!nextCall || nextCall.status === 'closed' || nextCall.status === 'cancelled') {
    await execute(db, 'UPDATE units SET queued_call_ids = ? WHERE id = ?', JSON.stringify(remaining), unit_id);
    if (remaining.length > 0) await promoteQueuedCall(db, unit_id, _depth + 1);
    return;
  }
  await executeBatch(db, [
    { sql: "UPDATE units SET status = 'dispatched', current_call_id = ?, queued_call_ids = ? WHERE id = ?", bindings: [nextCallId, JSON.stringify(remaining), unit_id] },
  ]);
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// POST /dispatch/calls/bulk-reassign — AdminGodModeTab emergency tool.
// Its own code comment claimed this was "Mounted at /api/dispatch/calls" but
// the route never actually existed - every click 404'd. Reassigns a batch of
// calls to a single unit (assigned_unit_ids is a JSON array column, so this
// REPLACES each call's assignment list with just the target unit, matching
// the tool's "emergency reassign" intent rather than appending).
calls.post('/bulk-reassign', requireRole('admin', 'manager'), async (c) => {
  try {
    const db = getDb(c.env);
    const body = await c.req.json<{ call_ids: unknown; unit_id: unknown }>();
    const callIds = Array.isArray(body.call_ids)
      ? body.call_ids.map(Number).filter((n) => Number.isInteger(n))
      : [];
    const unitId = typeof body.unit_id === 'number' && Number.isInteger(body.unit_id) ? body.unit_id : Number(body.unit_id);
    if (callIds.length === 0 || !Number.isInteger(unitId)) {
      return c.json({ error: 'call_ids and unit_id required' }, 400);
    }
    const unit = await queryFirst<{ call_sign: string }>(db, 'SELECT call_sign FROM units WHERE id = ?', unitId);
    if (!unit) return c.json({ error: 'Unit not found' }, 404);

    // Collect units currently assigned to these calls BEFORE overwriting, so
    // any unit that's losing this call (i.e. isn't the new target) can be
    // released — otherwise it's stuck 'dispatched' with a dangling
    // current_call_id, exactly the bug the per-call status handler above
    // documents and fixes for the single-call path.
    const priorUnitIds = new Set<number>();
    for (const batch of chunk(callIds, D1_PARAM_CHUNK)) {
      const ph = batch.map(() => '?').join(',');
      const rows = await query<{ assigned_unit_ids: string | null }>(db,
        `SELECT assigned_unit_ids FROM calls_for_service WHERE id IN (${ph})`, ...batch);
      for (const r of rows) {
        try { (JSON.parse(r.assigned_unit_ids || '[]') as number[]).forEach((id) => priorUnitIds.add(id)); } catch { /* ignore */ }
      }
    }
    priorUnitIds.delete(unitId);

    // Collect every write as one batch of statements so db.batch() commits
    // them atomically — chunked sequential execute() calls left a real gap
    // where a mid-operation failure (e.g. a later chunk throwing) could
    // leave some calls reassigned and others not, or calls updated but
    // units never released.
    const stmts: { sql: string; bindings?: unknown[] }[] = [];
    const callChunks = chunk(callIds, D1_PARAM_CHUNK);
    for (const batch of callChunks) {
      const ph = batch.map(() => '?').join(',');
      stmts.push({
        sql: `UPDATE calls_for_service SET assigned_unit_ids = ?, unit_call_signs = ?, updated_at = datetime(\'now\') WHERE id IN (${ph})`,
        bindings: [JSON.stringify([unitId]), JSON.stringify([unit.call_sign]), ...batch],
      });
    }
    stmts.push({ sql: "UPDATE units SET status = 'dispatched', current_call_id = ? WHERE id = ?", bindings: [callIds[0], unitId] });
    if (priorUnitIds.size > 0) {
      for (const batch of chunk(Array.from(priorUnitIds), D1_PARAM_CHUNK)) {
        const ph = batch.map(() => '?').join(',');
        stmts.push({ sql: `UPDATE units SET status = 'available', current_call_id = NULL WHERE id IN (${ph})`, bindings: batch });
      }
    }
    const results = await executeBatch(db, stmts);
    const updated = results.slice(0, callChunks.length).reduce((sum, r) => sum + (r.meta.changes ?? 0), 0);
    broadcastAll('dispatch_update', { action: 'bulk_reassigned', call_ids: callIds, unit_id: unitId });
    return c.json({ updated, target: unit.call_sign });
  } catch (err) {
    log.error('POST /dispatch/calls/bulk-reassign failed', {}, err as Error);
    return c.json({ error: 'Failed to bulk-reassign calls' }, 500);
  }
});

// POST /dispatch/calls/force-close-all — AdminGodModeTab emergency tool.
// Same "documented as fixed but never built" defect as bulk-reassign above.
// Closes every non-terminal call with the given disposition and releases
// their assigned units (mirrors the per-call terminal-transition logic in
// POST /:id/status above, including releasing by current_call_id in
// addition to the JSON array — a unit's current_call_id can be set while
// it's absent from that array, so JSON-only release misses it). Deliberately
// does NOT run the PSO-crosslink side effect that single-call close does -
// firing that for potentially hundreds of calls at once in an emergency-
// close scenario risks flooding serve_queue with unintended jobs; a genuine
// PSO close should still go through the normal per-call flow.
calls.post('/force-close-all', requireRole('admin', 'manager'), async (c) => {
  try {
    const db = getDb(c.env);
    const { disposition } = await c.req.json<{ disposition?: string }>().catch(() => ({}) as { disposition?: string });
    const open = await query<{ id: number; assigned_unit_ids: string | null }>(db,
      `SELECT id, assigned_unit_ids FROM calls_for_service WHERE ${ACTIVE_CALL_WHERE}`);
    if (open.length === 0) return c.json({ closed: 0 });

    const dispSql = typeof disposition === 'string' && disposition.length > 0 ? ', disposition = ?' : '';
    const ids = open.map((r) => r.id);

    // Collect every write as one batch so db.batch() commits atomically —
    // sequential execute() calls left a gap where a mid-operation failure
    // could close some calls without releasing their units, or vice versa.
    const stmts: { sql: string; bindings?: unknown[] }[] = [];
    for (const batch of chunk(ids, D1_PARAM_CHUNK)) {
      const ph = batch.map(() => '?').join(',');
      const params: unknown[] = dispSql ? [disposition, ...batch] : batch;
      stmts.push({
        sql: `UPDATE calls_for_service SET status = 'closed', closed_at = COALESCE(closed_at, datetime(\'now\')), updated_at = datetime(\'now\')${dispSql} WHERE id IN (${ph})`,
        bindings: params,
      });
    }

    const unitIds = Array.from(new Set(open.flatMap((r) => {
      try { return JSON.parse(r.assigned_unit_ids || '[]') as number[]; } catch { return []; }
    })));
    for (const batch of chunk(unitIds, D1_PARAM_CHUNK)) {
      const uPh = batch.map(() => '?').join(',');
      stmts.push({ sql: `UPDATE units SET status = 'available', current_call_id = NULL WHERE id IN (${uPh})`, bindings: batch });
    }
    // Also release by current_call_id — mirrors the single-call handler's
    // `WHERE current_call_id = ? OR id IN (...)` since a unit can have
    // current_call_id set while missing from the JSON array.
    for (const batch of chunk(ids, D1_PARAM_CHUNK)) {
      const cPh = batch.map(() => '?').join(',');
      stmts.push({ sql: `UPDATE units SET status = 'available', current_call_id = NULL WHERE current_call_id IN (${cPh})`, bindings: batch });
    }
    await executeBatch(db, stmts);
    broadcastAll('dispatch_update', { action: 'force_closed_all', call_ids: ids });
    return c.json({ closed: ids.length });
  } catch (err) {
    log.error('POST /dispatch/calls/force-close-all failed', {}, err as Error);
    return c.json({ error: 'Failed to force-close all calls' }, 500);
  }
});

// POST /dispatch/calls/:id/archive
calls.post('/:id/archive', requireRole('dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const result = await execute(db, "UPDATE calls_for_service SET status = 'archived', archived_at = datetime(\'now\') WHERE id = ?", id);
    if (result.meta.changes === 0) return c.json({ error: 'Call not found', code: 'NOT_FOUND' }, 404);
    return c.json({ message: 'Archived' });
  } catch (err) {
    log.error('POST /:id/archive failed', { src: 'src/routes/dispatch/calls.ts' }, err); return c.json({ error: 'Archive failed' }, 500); }
});

// POST /dispatch/calls/:id/unarchive
calls.post('/:id/unarchive', requireRole('dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  try {
    const db = getDb(c.env);
    const idStr = c.req.param('id');
    const id = Number(idStr);
    const result = await execute(db, "UPDATE calls_for_service SET status = 'closed' WHERE id = ? AND status = 'archived'", id);
    if (result.meta.changes === 0) {
      const exists = await queryFirst(db, 'SELECT id, status FROM calls_for_service WHERE id = ?', id);
      return c.json({ error: exists ? 'Call is not archived' : 'Not found' }, exists ? 409 : 404);
    }
    // Fetch the updated call and ext rows
    const call = await queryFirst<Record<string, any>>(db, 'SELECT * FROM calls_for_service WHERE id = ?', id);
    const ext = await queryFirst<Record<string, any>>(db, 'SELECT * FROM calls_for_service_ext WHERE id = ?', id);
    const merged = call ? { ...(call || {}), ...(ext || {}) } : null;
    if (merged) {
      await emitAlert(c.env, 'dispatch_update', { action: 'call_updated', call: merged });
    }
    return c.json({ message: 'Unarchived' });
  } catch (err) {
    log.error('POST /:id/unarchive failed', { src: 'src/routes/dispatch/calls.ts' }, err);
    return c.json({ error: 'Unarchive failed' }, 500);
  }
});

// POST /dispatch/calls/:id/hold
// Hold is stored as calls_for_service_ext.held_at (migration 0041), an
// orthogonal flag — NOT calls_for_service.status='on_hold'. The client
// (dispatchMappers.ts, CallCard.tsx) synthesizes the 'on_hold' display
// status from held_at while the real status is left untouched, so a held
// call resumes to whatever status it actually held (dispatched/enroute/
// onscene) instead of always bouncing back to 'pending'.
//
// NOTE: #3305 landed a competing fix that wrote status='on_hold' directly
// and left the old /resume (SET status='pending' WHERE status='on_hold')
// in place — that combination silently drops a held call's real status on
// resume. Superseded here by the held_at design both this route and the
// client already commit to.
calls.post('/:id/hold', requireRole('dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const callExists = await queryFirst<{ id: number }>(db, 'SELECT id FROM calls_for_service WHERE id = ?', id);
    if (!callExists) return c.json({ error: 'Call not found', code: 'NOT_FOUND' }, 404);
    await execute(db, 'INSERT OR IGNORE INTO calls_for_service_ext (id) VALUES (?)', id);
    await execute(db, "UPDATE calls_for_service_ext SET held_at = datetime(\'now\') WHERE id = ?", id);
    const call = await queryFirst<Record<string, any>>(db, 'SELECT * FROM calls_for_service WHERE id = ?', id);
    const ext = await queryFirst<Record<string, any>>(db, 'SELECT * FROM calls_for_service_ext WHERE id = ?', id);
    const merged = call ? { ...(call || {}), ...(ext || {}) } : null;
    if (!merged) return c.json({ error: 'Call not found' }, 404);
    await emitAlert(c.env, 'dispatch_update', { action: 'call_updated', call: merged });
    return c.json(merged);
  } catch (err) {
    log.error('POST /:id/hold failed', { src: 'src/routes/dispatch/calls.ts' }, err);
    return c.json({ error: 'Hold failed' }, 500);
  }
});

// POST /dispatch/calls/:id/resume
calls.post('/:id/resume', requireRole('dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const resumeCallExists = await queryFirst<{ id: number }>(db, 'SELECT id FROM calls_for_service WHERE id = ?', id);
    if (!resumeCallExists) return c.json({ error: 'Call not found', code: 'NOT_FOUND' }, 404);
    await execute(db, 'UPDATE calls_for_service_ext SET held_at = NULL WHERE id = ?', id);
    const call = await queryFirst<Record<string, any>>(db, 'SELECT * FROM calls_for_service WHERE id = ?', id);
    const ext = await queryFirst<Record<string, any>>(db, 'SELECT * FROM calls_for_service_ext WHERE id = ?', id);
    const merged = call ? { ...(call || {}), ...(ext || {}) } : null;
    if (!merged) return c.json({ error: 'Call not found' }, 404);
    await emitAlert(c.env, 'dispatch_update', { action: 'call_updated', call: merged });
    return c.json(merged);
  } catch (err) {
    log.error('POST /:id/resume failed', { src: 'src/routes/dispatch/calls.ts' }, err);
    return c.json({ error: 'Resume failed' }, 500);
  }
});

// Columns work_orders gained in migration 0158_work_orders_scheduling.sql.
// workOrders.ts's own create path guards these via its module-private
// reconcileSchema()/columnExists() before inserting; this route lives in a
// different module, so it repeats the same runtime guard rather than
// assuming 0158 has landed on every environment that reaches this handler.
// Latched to a single worker-lifetime Promise (mirrors workOrders.ts's
// schemaReconciled flag) so the 4 columnExists pragma round-trips only run
// once per isolate instead of on every report-issue request.
let reportIssueColsReady: Promise<void> | null = null;
function ensureReportIssueColumns(db: Awaited<ReturnType<typeof getDb>>): Promise<void> {
  if (!reportIssueColsReady) {
    reportIssueColsReady = (async () => {
      for (const [name, type] of [
        ['priority', "TEXT NOT NULL DEFAULT 'normal'"],
        ['call_id', 'INTEGER'],
        ['unit_id', 'INTEGER'],
        ['reported_by_user_id', 'INTEGER'],
      ] as const) {
        try {
          if (!(await columnExists(db, 'work_orders', name))) {
            await execute(db, `ALTER TABLE work_orders ADD COLUMN ${name} ${type}`);
          }
        } catch (err) { log.warn('[calls] report-issue reconcile column', { column: name, error: (err as Error)?.message }); }
      }
    })();
  }
  return reportIssueColsReady;
}

// POST /dispatch/calls/:id/report-issue — create a mechanical work order
// for the vehicle assigned to this call. DispatchPage.tsx's "Report Issue"
// toolbar button posts here; the call's first assigned unit resolves to a
// fleet vehicle via units.vehicle_id (a vehicle_number string, not the
// fleet_vehicles.id the work_orders table wants — same lookup units.ts's
// GET / does for the reverse join). Role-gated to match sibling call
// mutations (assign-unit, dispatch, redispatch); emits the same Fleet.io
// outbound event workOrders.ts's canonical create path does, so work orders
// created from this shortcut still sync instead of silently diverging.
calls.post('/:id/report-issue', requireRole('dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const userId = (c.get('userId') as number | undefined) ?? null;
    const body = await c.req.json<{ summary?: string }>().catch(() => ({} as { summary?: string }));

    const call = await queryFirst<Record<string, unknown>>(
      db, 'SELECT assigned_unit_ids, call_number FROM calls_for_service WHERE id = ?', id);
    if (!call) return c.json({ error: 'Call not found' }, 404);

    const assignedIds = JSON.parse(String(call.assigned_unit_ids || '[]')) as number[];
    if (assignedIds.length === 0) {
      return c.json({ error: 'No unit assigned to this call', code: 'NO_UNIT' }, 400);
    }
    const unitId = assignedIds[0];
    const unit = await queryFirst<{ vehicle_id: string | null }>(
      db, 'SELECT vehicle_id FROM units WHERE id = ?', unitId);
    if (!unit?.vehicle_id) {
      return c.json({ error: 'Assigned unit has no vehicle on file', code: 'NO_VEHICLE' }, 400);
    }
    const vehicle = await queryFirst<{ id: number }>(
      db, 'SELECT id FROM fleet_vehicles WHERE vehicle_number = ?', unit.vehicle_id);
    if (!vehicle) {
      return c.json({ error: 'Assigned vehicle not found in fleet records', code: 'NO_VEHICLE' }, 400);
    }

    await ensureReportIssueColumns(db);

    const summary = body.summary || `Mechanical issue reported from Call #${call.call_number ?? id}`;
    const result = await execute(db,
      `INSERT INTO work_orders (vehicle_id, status, summary, priority, call_id, unit_id, reported_by_user_id, created_by)
       VALUES (?, 'open', ?, 'normal', ?, ?, ?, ?)`,
      vehicle.id, summary, Number(id), unitId, userId, userId);

    const workOrderId = Number(result.meta.last_row_id);
    const created = await queryFirst<Record<string, unknown>>(
      db, 'SELECT * FROM work_orders WHERE id = ?', workOrderId);
    try {
      c.executionCtx.waitUntil(
        emitFleetioEvent(c, 'work_order.create', created, {
          rmpgTable: 'work_orders',
          rmpgId: workOrderId,
          versionToken: `work_order.create:${workOrderId}:${Date.now()}`,
        }),
      );
    } catch { /* executionCtx unavailable in tests */ }

    return c.json({ data: { id: workOrderId } }, 201);
  } catch (err) {
    log.error('POST /dispatch/calls/:id/report-issue failed', { id: c.req.param('id') }, err as Error);
    return dbErrorResponse(c, err, 'Failed to report issue');
  }
});

// POST /dispatch/calls/:id/assign-unit
calls.post('/:id/assign-unit', requireRole('dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id') || '';
    const rawBody = await c.req.json<{ unit_id: number; confirm?: number | string }>();
    const { unit_id } = rawBody;
    const confirmOverride = rawBody.confirm == 1 || c.req.query('confirm') === '1';
    const call = await queryFirst<{ assigned_unit_ids: string; call_number: string; status: string; latitude: number | null; longitude: number | null }>(
      db, 'SELECT assigned_unit_ids, call_number, status, latitude, longitude FROM calls_for_service WHERE id = ?', id
    );
    if (!call) return c.json({ error: 'Call not found' }, 404);
    const assigned = JSON.parse(call.assigned_unit_ids || '[]') as number[];
    if (!assigned.includes(unit_id)) assigned.push(unit_id);

    // Fleet maintenance guard: warn if unit's vehicle is out of service.
    // Dispatcher can override by sending confirm=1 in the request body.
    if (!confirmOverride) {
      const vehicle = await queryFirst<{ status: string; vehicle_number: string }>(
        db, `SELECT fv.status, fv.vehicle_number FROM fleet_vehicles fv WHERE fv.assigned_unit_id = ?`, unit_id,
      ).catch(() => null);
      if (vehicle && (vehicle.status === 'out_of_service' || vehicle.status === 'in_maintenance')) {
        return c.json({
          warning: 'vehicle_unavailable',
          message: `Unit's assigned vehicle (${vehicle.vehicle_number}) is ${vehicle.status}. Override with confirm=1 to proceed.`,
          code: 'VEHICLE_UNAVAILABLE',
        }, 409);
      }
    }

    // If the unit is already working a DIFFERENT open call, queue this
    // assignment rather than rejecting it outright. The queued call will be
    // promoted automatically when the unit clears its active call.
    const unitRow = await queryFirst<{ current_call_id: number | null; queued_call_ids: string; call_sign: string | null }>(
      db, 'SELECT current_call_id, queued_call_ids, call_sign FROM units WHERE id = ?', unit_id,
    );
    const activeCallId = unitRow?.current_call_id;
    if (activeCallId != null && String(activeCallId) !== String(id)) {
      const conflictingCall = await queryFirst<{ call_number: string; status: string }>(
        db, 'SELECT call_number, status FROM calls_for_service WHERE id = ?', activeCallId,
      );
      const CONFLICT_TERMINAL = new Set(['cleared', 'closed', 'cancelled', 'archived', 'merged', 'split']);
      if (conflictingCall && !CONFLICT_TERMINAL.has(conflictingCall.status)) {
        // Queue this call behind the active one instead of 409-ing.
        const queue = JSON.parse(unitRow?.queued_call_ids || '[]') as number[];
        const callIdNum = parseInt(id, 10);
        if (!queue.includes(callIdNum)) queue.push(callIdNum);
        await executeBatch(db, [
          { sql: 'UPDATE calls_for_service SET assigned_unit_ids = ? WHERE id = ?', bindings: [JSON.stringify(assigned), id] },
          { sql: 'UPDATE units SET queued_call_ids = ? WHERE id = ?', bindings: [JSON.stringify(queue), unit_id] },
        ]);
        return c.json({ queued: true, message: `Unit is on call ${conflictingCall.call_number} — this call has been queued.`, assigned_unit_ids: assigned, premise_pushed: 0 });
      }
    }

    // Rebuild unit_call_signs in sync with assigned_unit_ids (C1).
    let callSigns: string[] = [];
    try {
      if (assigned.length > 0) {
        const unitRows = await queryInChunks<{ id: number; call_sign: string }>(
          db, assigned, (ph) => `SELECT id, call_sign FROM units WHERE id IN (${ph})`);
        callSigns = assigned.map((uid) => unitRows.find((u) => u.id === uid)?.call_sign ?? '').filter(Boolean);
      }
    } catch { /* best-effort — at minimum keep the ids */ }

    // Auto-advance call stage: if call was pending/created, promote to dispatched, stamp dispatched_at, and audit log.
    const shouldPromoteCall = call.status === 'pending' || !call.status || call.status === 'created';
    const nextCallStatus = shouldPromoteCall ? 'dispatched' : call.status;

    await executeBatch(db, [
      {
        sql: `UPDATE calls_for_service SET assigned_unit_ids = ?, unit_call_signs = ?,
                     status = ?, dispatched_at = CASE WHEN ? = 'dispatched' THEN COALESCE(dispatched_at, datetime('now')) ELSE dispatched_at END,
                     updated_at = datetime('now')
              WHERE id = ?`,
        bindings: [JSON.stringify(assigned), JSON.stringify(callSigns), nextCallStatus, nextCallStatus, id],
      },
      { sql: "UPDATE units SET status = 'dispatched', current_call_id = ?, queued_call_ids = '[]' WHERE id = ?", bindings: [parseInt(id, 10), unit_id] },
    ]);

    if (shouldPromoteCall) {
      try {
        const unitCs = unitRow?.call_sign ?? `Unit ${unit_id}`;
        await recordAudit(c, {
          action: 'call_dispatched',
          entityType: 'call',
          entityId: id,
          details: {
            description: `Unit ${unitCs} dispatched to CFS ${call.call_number} (auto-transitioned to Dispatched)`,
            call_id: id,
            call_number: call.call_number,
            unit_id,
            unit_call_sign: unitCs,
          },
        });
      } catch (auditErr) {
        log.warn('Failed to record dispatch audit log (non-fatal)', { err: auditErr });
      }
    }

    // ── Stack sync: add unit to sibling calls ──
    try {
      const ext = await queryFirst<{ stack_group_id: string | null }>(
        db, 'SELECT stack_group_id FROM calls_for_service_ext WHERE id = ?', id,
      );
      if (ext && ext.stack_group_id) {
        const unitRow = await queryFirst<{ call_sign: string | null }>(
          db, 'SELECT call_sign FROM units WHERE id = ?', unit_id,
        );
        await syncToStack(db, ext.stack_group_id, parseInt(id, 10), {
          units: {
            addIds: [unit_id],
            addCallSigns: unitRow?.call_sign ? [unitRow.call_sign] : [],
          },
        });
      }
    } catch (stackErr) {
      log.error('syncToStack assign-unit failed (non-fatal)', { callId: id, unit_id }, stackErr as Error);
    }

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
    } catch (err) { log.error('[dispatch] premise auto-push failed', { callId: id, unit_id }, err as Error); }

    const updatedCall = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM calls_for_service WHERE id = ?', id);
    return c.json({ ...(updatedCall ?? {}), message: 'Unit assigned', assigned_unit_ids: assigned, premise_pushed });
  } catch (err) {
    log.error('POST /:id/assign-unit failed', { src: 'src/routes/dispatch/calls.ts' }, err); return c.json({ error: 'Assign failed' }, 500); }
});

// POST /dispatch/calls/:id/unassign-unit
calls.post('/:id/unassign-unit', requireRole('dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const { unit_id } = await c.req.json<{ unit_id: number }>();
    const call = await queryFirst<{ assigned_unit_ids: string }>(db, 'SELECT assigned_unit_ids FROM calls_for_service WHERE id = ?', id);
    if (!call) return c.json({ error: 'Call not found' }, 404);
    const assigned = (() => { try { return (JSON.parse(call.assigned_unit_ids || '[]') as number[]).filter(u => u !== unit_id); } catch { return []; } })();
    // Rebuild unit_call_signs in sync with updated assigned_unit_ids (C1).
    let unassignCallSigns: string[] = [];
    try {
      if (assigned.length > 0) {
        const unitRows2 = await queryInChunks<{ id: number; call_sign: string }>(
          db, assigned, (ph) => `SELECT id, call_sign FROM units WHERE id IN (${ph})`);
        unassignCallSigns = assigned.map((uid) => unitRows2.find((u) => u.id === uid)?.call_sign ?? '').filter(Boolean);
      }
    } catch { /* best-effort */ }
    await execute(db, 'UPDATE calls_for_service SET assigned_unit_ids = ?, unit_call_signs = ? WHERE id = ?', JSON.stringify(assigned), JSON.stringify(unassignCallSigns), id);

    // If the unit's active call is this one, clear it and promote from queue.
    // If this call was only queued (not active), just remove it from the queue.
    const unitRow = await queryFirst<{ current_call_id: number | null; queued_call_ids: string }>(
      db, 'SELECT current_call_id, queued_call_ids FROM units WHERE id = ?', unit_id,
    );
    const callIdNum = parseInt(id ?? '', 10);
    if (unitRow?.current_call_id === callIdNum) {
      await execute(db, "UPDATE units SET status = 'available', current_call_id = NULL WHERE id = ?", unit_id);
      try { await promoteQueuedCall(db, unit_id); } catch (qErr) {
        log.error('promoteQueuedCall failed (non-fatal)', { unit_id }, qErr as Error);
      }
    } else {
      // Remove from the queue without touching the active call.
      const queue = (JSON.parse(unitRow?.queued_call_ids || '[]') as number[]).filter(q => q !== callIdNum);
      await execute(db, 'UPDATE units SET queued_call_ids = ? WHERE id = ?', JSON.stringify(queue), unit_id);
    }

    // ── Stack sync: remove unit from sibling calls ──
    try {
      const ext = await queryFirst<{ stack_group_id: string | null }>(
        db, 'SELECT stack_group_id FROM calls_for_service_ext WHERE id = ?', id,
      );
      if (ext && ext.stack_group_id) {
        const unitRow = await queryFirst<{ call_sign: string | null }>(
          db, 'SELECT call_sign FROM units WHERE id = ?', unit_id,
        );
        await syncToStack(db, ext.stack_group_id, parseInt(id ?? '', 10), {
          units: {
            removeIds: [unit_id],
            removeCallSigns: unitRow?.call_sign ? [unitRow.call_sign] : [],
          },
        });
      }
    } catch (stackErr) {
      log.error('syncToStack unassign-unit failed (non-fatal)', { callId: id, unit_id }, stackErr as Error);
    }

    return c.json({ message: 'Unit unassigned', assigned_unit_ids: assigned });
  } catch (err) {
    log.error('POST /:id/unassign-unit failed', { src: 'src/routes/dispatch/calls.ts' }, err); return c.json({ error: 'Unassign failed' }, 500); }
});

// POST /dispatch/calls/:id/dispatch - Multi-unit dispatch
calls.post('/:id/dispatch', requireRole('dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id') || '';
    const { unit_ids } = await c.req.json<{ unit_ids: number[] }>();
    if (!unit_ids?.length) return c.json({ error: 'No units specified' }, 400);

    const call = await queryFirst<{ assigned_unit_ids: string }>(db, 'SELECT assigned_unit_ids FROM calls_for_service WHERE id = ?', id);
    if (!call) return c.json({ error: 'Call not found' }, 404);

    const assigned = new Set((() => { try { return JSON.parse(call.assigned_unit_ids || '[]') as number[]; } catch { return []; } })());
    for (const uid of unit_ids) assigned.add(uid);

    // Rebuild unit_call_signs in sync with assigned_unit_ids (C1).
    const assignedArr = [...assigned];
    let dispatchCallSigns: string[] = [];
    try {
      if (assignedArr.length > 0) {
        const dispUnitRows = await queryInChunks<{ id: number; call_sign: string }>(
          db, assignedArr, (ph) => `SELECT id, call_sign FROM units WHERE id IN (${ph})`);
        dispatchCallSigns = assignedArr.map((uid) => dispUnitRows.find((u) => u.id === uid)?.call_sign ?? '').filter(Boolean);
      }
    } catch { /* best-effort */ }

    await execute(db, "UPDATE calls_for_service SET assigned_unit_ids = ?, unit_call_signs = ?, status = 'dispatched', dispatched_at = COALESCE(dispatched_at, datetime(\'now\')) WHERE id = ?", JSON.stringify(assignedArr), JSON.stringify(dispatchCallSigns), id);

    for (const uid of unit_ids) {
      await execute(db, "UPDATE units SET status = 'dispatched', current_call_id = ? WHERE id = ?", parseInt(id, 10), uid);
    }

    // ── Stack sync: add all dispatched units to sibling calls ──
    try {
      const ext = await queryFirst<{ stack_group_id: string | null }>(
        db, 'SELECT stack_group_id FROM calls_for_service_ext WHERE id = ?', id,
      );
      if (ext && ext.stack_group_id) {
        const unitRows = unit_ids.length
          ? await queryInChunks<{ id: number; call_sign: string | null }>(
              db,
              unit_ids,
              (ph) => `SELECT id, call_sign FROM units WHERE id IN (${ph})`,
            )
          : [];
        const addCallSigns = unitRows.map((u) => u.call_sign).filter(Boolean) as string[];
        const dispatchedAtRow = await queryFirst<{ dispatched_at: string | null }>(
          db, 'SELECT dispatched_at FROM calls_for_service WHERE id = ?', id,
        );
        const dispatchedAt = dispatchedAtRow?.dispatched_at ?? '';
        await syncToStack(db, ext.stack_group_id, parseInt(id, 10), {
          units: { addIds: unit_ids, addCallSigns },
          ...(dispatchedAt ? { timestamps: { dispatched_at: dispatchedAt } } : {}),
        });
      }
    } catch (stackErr) {
      log.error('syncToStack dispatch failed (non-fatal)', { callId: id }, stackErr as Error);
    }

    // Return the updated call row, not a {message}. The client
    // (handleMultiUnitDispatch) feeds this straight into mapDbCall() and splices
    // it into dispatch state — a bare message produced a blank-id corrupted call.
    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM calls_for_service WHERE id = ?', id);
    return c.json(updated);
  } catch (err) {
    log.error('POST /:id/dispatch failed', { src: 'src/routes/dispatch/calls.ts' }, err); return c.json({ error: 'Dispatch failed' }, 500); }
});

// POST /dispatch/calls/:id/split — split a call into multiple child CFS records
calls.post('/:id/split', requireRole('dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id') || '', 10);
    const parent = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM calls_for_service WHERE id = ?', id);
    if (!parent) return c.json({ error: 'Parent call not found' }, 404);
    const { splits } = await c.req.json<{ splits: Array<{ incident_type: string; description?: string; location_address?: string }> }>();
    if (!Array.isArray(splits) || !splits.length) return c.json({ error: 'splits array required' }, 400);
    const userId = c.get('userId') as number | undefined;
    const created: number[] = [];
    // call_number is NOT NULL UNIQUE — generate a new number for each child
    const splitYear = new Date().toLocaleString('en-US', { timeZone: 'America/Denver', year: 'numeric' }).slice(-2);
    const splitPrefix = `CFS${splitYear}-`;
    const nextSplitCallNumber = async () => {
      const [{ max }] = await query<{ max: string | null }>(
        db, "SELECT MAX(call_number) as max FROM calls_for_service WHERE call_number LIKE ?", `${splitPrefix}%`,
      );
      const seq = max ? String(parseInt(max.slice(splitPrefix.length), 10) + 1).padStart(5, '0') : '00001';
      return `${splitPrefix}${seq}`;
    };
    for (const s of splits) {
      const childCallNumber = await nextSplitCallNumber();
      const result = await execute(db,
        // No split_from_id on calls_for_service (and it's at the 100-column
        // cap) — the parent link lives on calls_for_service_ext.parent_call_id.
        `INSERT INTO calls_for_service (call_number, incident_type, priority, status, location_address, latitude, longitude, description, dispatcher_id, created_at, updated_at)
         VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        childCallNumber, s.incident_type, parent.priority || 'P3', s.location_address || parent.location_address, parent.latitude, parent.longitude, s.description || null, userId ?? null);
      const childId = Number(result.meta.last_row_id);
      await execute(db, 'INSERT OR IGNORE INTO calls_for_service_ext (id) VALUES (?)', childId);
      await execute(db, 'UPDATE calls_for_service_ext SET parent_call_id = ? WHERE id = ?', id, childId);
      created.push(childId);
    }
    await execute(db, "UPDATE calls_for_service SET status = ?, notes = COALESCE(notes || char(10), '') || ? WHERE id = ?", 'split', `Split into ${created.length} child call(s): ${created.join(', ')}`, id);
    // Release units assigned to the now-split parent — mirrors the unit-release
    // block in POST /:id/status, which this handler bypasses.
    try {
      const assignedIdsForSplit = JSON.parse(String(parent.assigned_unit_ids || '[]')) as number[];
      if (Array.isArray(assignedIdsForSplit) && assignedIdsForSplit.length > 0) {
        await execute(db, `UPDATE units SET status = 'available', current_call_id = NULL WHERE current_call_id = ?`, id);
        await executeInChunks(db, assignedIdsForSplit,
          (ph) => `UPDATE units SET status = 'available', current_call_id = NULL WHERE id IN (${ph})`);
      }
    } catch (unitErr) { log.error('[dispatch] failed to release units after split', { callId: id }, unitErr); }
    if (userId) await execute(db, `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details) VALUES (?, 'split_call', 'call', ?, ?)`, userId, id, JSON.stringify({ child_ids: created }));
    return c.json({ success: true, parent_id: id, child_ids: created });
  } catch (err) {
    log.error('POST /:id/split failed', { src: 'src/routes/dispatch/calls.ts' }, err); return c.json({ error: 'Call split failed' }, 500); }
});

// GET /dispatch/calls/:id/evidence-prompt — check if evidence should be collected before clearing
calls.get('/:id/evidence-prompt', requireRole('officer', 'dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id') || '0', 10);
    const call = await queryFirst<{ photos_taken: number | null }>(db,
      'SELECT (SELECT COUNT(*) FROM field_photos WHERE call_id = ?) AS photos_taken', id);
    const notes = (await queryFirst<{ n: number }>(db,
      'SELECT COUNT(*) AS n FROM call_notes WHERE call_id = ?', id))?.n ?? 0;
    return c.json({ prompt_evidence: !call?.photos_taken || call.photos_taken === 0, photos_count: call?.photos_taken ?? 0, notes_count: notes });
  } catch { return c.json({ prompt_evidence: false, photos_count: 0, notes_count: 0 }); }
});

calls.post('/templates', requireRole('officer', 'dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number;
    const body = await c.req.json<{ name: string; incident_type: string; priority?: string; auto_flags?: any; notes?: string; is_shared?: boolean }>();
    if (!body.name || !body.incident_type) return c.json({ error: 'name and incident_type required' }, 400);
    const r = await execute(db,
      `INSERT INTO call_templates (name, incident_type, priority, auto_flags, notes, owner_user_id, is_shared, created_at)
       VALUES (?,?,?,?,?,?,?,datetime('now'))`,
      body.name, body.incident_type, body.priority || 'P3', JSON.stringify(body.auto_flags || {}), body.notes || null, userId, body.is_shared ? 1 : 0);
    return c.json({ success: true, id: r.meta.last_row_id }, 201);
  } catch (err) {
    log.error('POST /templates failed', { src: 'src/routes/dispatch/calls.ts' }, err); return c.json({ error: 'Template creation failed' }, 500); }
});

calls.delete('/templates/:id', requireRole('officer', 'dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number;
    const id = parseInt(c.req.param('id') || '0', 10);
    const r = await execute(db, 'UPDATE call_templates SET active = 0 WHERE id = ? AND owner_user_id = ?', id, userId);
    if ((r.meta.changes ?? 0) === 0) {
      const exists = await queryFirst<{ id: number }>(db, 'SELECT id FROM call_templates WHERE id = ?', id);
      return c.json({ error: exists ? 'Not authorized' : 'Template not found' }, exists ? 403 : 404);
    }
    return c.json({ success: true });
  } catch (err) {
    log.error('DELETE /templates/:id failed', { src: 'src/routes/dispatch/calls.ts' }, err); return c.json({ error: 'Delete failed' }, 500); }
});

// POST /dispatch/calls/:id/redispatch - Re-dispatch creates a NEW linked call
// ("Schedule Return Visit" for a PSO/process-service call that already
// cleared/closed/etc, needing a follow-up attempt). Ported from
// legacy/server-vps/src/routes/dispatch/calls.ts — this never carried over
// in the Cloudflare cutover, so the client's fully-built "Return Visit" /
// "Undo Visit" / Visit History UI (DispatchPage.tsx) 404'd on every call.
calls.post('/:id/redispatch', requireRole('dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  const id = c.req.param('id');
  try {
    const db = getDb(c.env);
    const parent = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM calls_for_service WHERE id = ?', id);
    if (!parent) return c.json({ error: 'Call not found', code: 'CALL_NOT_FOUND' }, 404);
    const parentExt = (await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM calls_for_service_ext WHERE id = ?', id)) || {};

    if (!['pso_client_request', 'process_service'].includes(String(parent.incident_type))) {
      return c.json({ error: 'Re-dispatch is only available for PSO Client Request and Process Service calls', code: 'REDISPATCH_TYPE_INVALID' }, 400);
    }
    if (!['cleared', 'closed', 'cancelled', 'archived'].includes(String(parent.status))) {
      return c.json({ error: 'Call must be cleared, closed, cancelled, or archived to re-dispatch', code: 'CALL_MUST_BE_INACTIVE' }, 400);
    }

    const userId = (c.get('userId') as number | undefined) ?? null;
    const currentAttempt = Number(parent.pso_attempt_number) || 1;
    const newAttempt = currentAttempt + 1;

    // Root of the chain (trace back through parent_call_id, which lives on
    // ext — every visit_history row + the new child's parent_call_id both
    // point at the ROOT call, not the immediately-prior visit, so the chain
    // stays flat regardless of how many return visits deep it goes).
    let rootId = Number(id);
    if (parentExt.parent_call_id) {
      const root = await queryFirst<{ id: number }>(db, 'SELECT id FROM calls_for_service WHERE id = ?', parentExt.parent_call_id as number);
      if (root) rootId = root.id;
    }

    // Snapshot the visit being closed out into call_visit_history.
    let assignedCallSigns: string[] = [];
    try {
      const parsedIds = JSON.parse(String(parent.assigned_unit_ids || '[]'));
      const unitIds = (Array.isArray(parsedIds) ? parsedIds : []).filter((x: unknown) => typeof x === 'number' && Number.isFinite(x));
      if (unitIds.length) {
        const units = await queryInChunks<{ call_sign: string }>(db, unitIds, (ph) => `SELECT call_sign FROM units WHERE id IN (${ph})`);
        assignedCallSigns = units.map((u) => u.call_sign).filter(Boolean);
      }
    } catch (err) { log.error('[redispatch] failed to snapshot assigned units', { callId: id }, err as Error); }

    // visit_date is a legacy NOT NULL column (predates the visit_number/
    // status chain-tracking columns added later on this same table) with no
    // default on live D1 — every redispatch INSERT failed against it until
    // this fix (SQLITE_CONSTRAINT_NOTNULL, see error_log id 11-15). Stamped
    // with the current time same as created_at.
    // visit_history rows always reference the ROOT of the chain so the full
    // attempt sequence can be read from one call_id. Use rootId, not id
    // (which points at whatever the current non-root attempt is).
    await execute(db, `
      INSERT INTO call_visit_history
        (call_id, visit_date, visit_number, status, disposition, assigned_units, dispatched_at, enroute_at, onscene_at, cleared_at, closed_at,
         responding_vehicle_id, starting_mileage, ending_mileage, created_at)
      VALUES (?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      rootId, currentAttempt, parent.status, parent.disposition ?? null, JSON.stringify(assignedCallSigns),
      parent.dispatched_at ?? null, parent.enroute_at ?? null, parent.onscene_at ?? null, parent.cleared_at ?? null, parent.closed_at ?? null,
      parent.responding_vehicle_id ?? null, parent.starting_mileage ?? null, parent.ending_mileage ?? null);

    // New call number — same CFS{YY}-{NNNNN} scheme as call creation (POST /).
    // call_number carries a UNIQUE constraint, and this read-max-then-increment
    // isn't atomic — a near-simultaneous redispatch (e.g. a double-clicked
    // "Schedule Return Visit" button) can read the same MAX twice and collide
    // on insert. Recompute and retry a few times on that specific collision
    // rather than surfacing the generic SQLITE_CONSTRAINT 409 to the dispatcher.
    const year = new Date().toLocaleString('en-US', { timeZone: 'America/Denver', year: 'numeric' }).slice(-2); // Denver-zone year, not the UTC Workers host's — avoids rolling the CFS# prefix ~5-7pm MT on Dec 31
    const prefix = `CFS${year}-`;
    const nextCallNumber = async () => {
      const [{ max }] = await query<{ max: string | null }>(db, 'SELECT MAX(call_number) as max FROM calls_for_service WHERE call_number LIKE ?', `${prefix}%`);
      const seq = max ? String(parseInt(max.slice(prefix.length), 10) + 1).padStart(5, '0') : '00001';
      return `${prefix}${seq}`;
    };
    let newCallNumber = await nextCallNumber();

    // Carry parent notes forward (tagged so the client can badge them
    // "carried from prior visit") + append a system note marking the
    // re-dispatch, on both the new call and a back-link on the parent.
    let parentNotes: Array<Record<string, unknown>> = [];
    try { const raw = JSON.parse(String(parent.notes || '[]')); parentNotes = Array.isArray(raw) ? raw : []; } catch { parentNotes = []; }
    const now = new Date().toISOString();
    const ordinal = (n: number) => { const s = ['th', 'st', 'nd', 'rd']; const v = n % 100; return `${n}${v >= 11 && v <= 13 ? 'th' : (s[n % 10] || s[0])}`; };
    const tsBase = Date.now();
    const carriedNotes = parentNotes.map((n, idx) => ({
      id: String(tsBase + idx),
      author: n.author || 'System',
      text: n.text || '',
      timestamp: n.timestamp || now,
      carried_from_call_number: parent.call_number,
      carried_from_call_id: Number(id),
      original_timestamp: n.timestamp || null,
    }));
    const noteText = `Re-dispatch from ${parent.call_number} — ${ordinal(newAttempt)} attempt`;
    const allNotes = [...carriedNotes, { id: String(tsBase + carriedNotes.length), author: 'Dispatch', text: noteText, timestamp: now }];

    // Schema-driven copy: read every column on both tables (except id) from
    // the parent row, then override only the per-visit fields that must
    // reset on a new visit. Anything added to either table in the future
    // automatically flows through the re-dispatch chain without touching
    // this route (mirrors the legacy VPS route's own reasoning).
    const baseCols = (await query<{ name: string }>(db, "PRAGMA table_info('calls_for_service')")).map((r) => r.name).filter((n) => n !== 'id');
    const baseOverrides: Record<string, unknown> = {
      call_number: newCallNumber,
      status: 'pending',
      pso_attempt_number: newAttempt,
      notes: JSON.stringify(allNotes),
      assigned_unit_ids: null,
      unit_call_signs: null,
      dispatched_at: null, enroute_at: null, onscene_at: null, cleared_at: null, closed_at: null, archived_at: null,
      disposition: null, action_taken: null, responding_officer: null, responding_vehicle_id: null,
      starting_mileage: null, ending_mileage: null,
      dispatcher_id: userId,
      created_at: now, updated_at: now, received_at: now,
      previous_status: null, status_changed_at: now,
      overdue_notified: 0,
    };
    let insertResult;
    for (let attempt = 0; ; attempt++) {
      const baseValues = baseCols.map((col) => {
        if (col === 'call_number') return newCallNumber;
        return col in baseOverrides ? baseOverrides[col] : (parent as Record<string, unknown>)[col] ?? null;
      });
      try {
        insertResult = await execute(db,
          `INSERT INTO calls_for_service (${baseCols.map((c2) => `"${c2}"`).join(', ')}) VALUES (${baseCols.map(() => '?').join(', ')})`,
          ...baseValues);
        break;
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err ?? '');
        if (attempt < 4 && /SQLITE_CONSTRAINT/i.test(raw) && /call_number/i.test(raw)) {
          newCallNumber = await nextCallNumber();
          continue;
        }
        throw err;
      }
    }
    const newCallId = Number(insertResult.meta.last_row_id);

    // Ext row — same schema-driven copy, plus the chain link + reset
    // per-visit-only ext fields (72hr PSO timer counts from the NEXT
    // clear, not the prior one; hold state never carries to a fresh visit).
    const extCols = (await query<{ name: string }>(db, "PRAGMA table_info('calls_for_service_ext')")).map((r) => r.name).filter((n) => n !== 'id');
    const extOverrides: Record<string, unknown> = {
      parent_call_id: rootId,
      pso_72hr_deadline: null,
      pso_72hr_notified: null,
      held_at: null,
      deleted_at: null,
    };
    await execute(db, 'INSERT OR IGNORE INTO calls_for_service_ext (id) VALUES (?)', newCallId);
    if (extCols.length) {
      const extValues = extCols.map((col) => (col in extOverrides ? extOverrides[col] : (parentExt as Record<string, unknown>)[col] ?? null));
      await execute(db, `UPDATE calls_for_service_ext SET ${extCols.map((c2) => `"${c2}" = ?`).join(', ')} WHERE id = ?`, ...extValues, newCallId);
    }

    // Same Process Server job for every return visit: move serve_queue.call_id
    // onto the new CFS. Insert only when the chain has no job yet (PSO-only
    // with no intake), never a second job for the same matter.
    let serveQueueId: number | null = null;
    try {
      const relink = await relinkServeJobForRedispatch(db, Number(id), newCallId, newCallNumber);
      serveQueueId = relink.queueId;
      if (relink.relinked) {
        log.info('[redispatch] relinked serve_queue to return visit', { callId: newCallId, queueId: relink.queueId, fromCallId: Number(id) });
      } else if (!relink.queueId) {
        const existingOnNew = await queryFirst<{ id: number }>(
          db, 'SELECT id FROM serve_queue WHERE call_id = ? LIMIT 1', newCallId,
        );
        if (existingOnNew) {
          serveQueueId = existingOnNew.id;
        } else {
          const newCallExtRow = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM calls_for_service_ext WHERE id = ?', newCallId);
          const mergedNew = { ...(await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM calls_for_service WHERE id = ?', newCallId) || {}), ...(newCallExtRow || {}) } as Record<string, any>;
          const ins = await execute(db,
            `INSERT INTO serve_queue (
               call_id, officer_id, recipient_name, recipient_address,
               recipient_lat, recipient_lng, document_type, case_number, client_name,
               priority, status, deadline, service_instructions
             ) VALUES (?,?,?,?, ?,?,?,?,?, 'normal','pending',?,?)`,
            newCallId, userId,
            mergedNew.process_served_to || mergedNew.pso_requestor_name || null,
            mergedNew.process_served_address || mergedNew.location_address || null,
            mergedNew.latitude ?? null, mergedNew.longitude ?? null,
            mergedNew.process_service_type || mergedNew.pso_service_type || null,
            mergedNew.case_number || null, mergedNew.client_name || null,
            mergedNew.pso_72hr_deadline || null, mergedNew.post_orders || null,
          );
          serveQueueId = Number(ins.meta.last_row_id) || null;
        }
      }
    } catch (err) { log.error('[redispatch] serve_queue relink failed', { callId: newCallId }, err as Error); }

    // Copy linked persons/vehicles/businesses from the parent call.
    const linkTables: Array<[string, readonly string[]]> = [
      ['call_persons', ['person_id', 'role', 'notes']],
      ['call_vehicles', ['vehicle_id', 'role', 'notes']],
      ['call_businesses', ['business_id', 'role', 'notes']],
    ];
    for (const [table, cols] of linkTables) {
      try {
        const rows = await query<Record<string, unknown>>(db, `SELECT ${cols.join(', ')} FROM ${table} WHERE call_id = ?`, id);
        for (const r of rows) {
          try {
            await execute(db, `INSERT INTO ${table} (call_id, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`,
              newCallId, ...cols.map((col) => r[col] ?? null));
          } catch { /* skip duplicates */ }
        }
      } catch (err) { log.error(`[redispatch] copy ${table} failed`, { callId: id, table }, err as Error); }
    }

    // Back-link note + notes update on the parent.
    parentNotes.push({ id: String(Date.now() + 1), author: 'System', text: `Re-dispatched → new call ${newCallNumber}`, timestamp: now });
    await execute(db, 'UPDATE calls_for_service SET notes = ?, updated_at = ? WHERE id = ?', JSON.stringify(parentNotes), now, id);

    await recordAudit(c, {
      action: 'CALL_REDISPATCHED', entityType: 'call', entityId: Number(id),
      details: { new_call_id: newCallId, new_call_number: newCallNumber, attempt: newAttempt },
    });
    await recordAudit(c, {
      action: 'CALL_CREATED_FROM_REDISPATCH', entityType: 'call', entityId: newCallId,
      details: { parent_call_id: Number(id), parent_call_number: parent.call_number, attempt: newAttempt },
    });

    const newCallBase = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM calls_for_service WHERE id = ?', newCallId);
    const newCallExt = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM calls_for_service_ext WHERE id = ?', newCallId);
    const merged = { ...(newCallBase || {}), ...(newCallExt || {}) };

    try {
      broadcastAll('dispatch_update', { action: 'call_created', call: merged });
      broadcastAll('dispatch_update', { action: 'call_updated', call: { id: Number(id), notes: parentNotes } });
    } catch { /* best-effort */ }

    return c.json({ ...merged, serve_queue_id: serveQueueId }, 201);
  } catch (err) {
    log.error('POST /dispatch/calls/:id/redispatch failed', { callId: id }, err as Error);
    return dbErrorResponse(c, err, 'Failed to re-dispatch call');
  }
});

// POST /dispatch/calls/:id/undo-redispatch - delete a pending return-visit
// child call and restore the parent (only while the child hasn't progressed
// past 'pending' — once dispatched, undoing would strand assigned units and
// destroy real dispatch activity, not just an accidental click).
calls.post('/:id/undo-redispatch', requireRole('dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  const id = c.req.param('id');
  try {
    const db = getDb(c.env);
    const child = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM calls_for_service WHERE id = ?', id);
    if (!child) return c.json({ error: 'Call not found', code: 'CALL_NOT_FOUND' }, 404);
    const childExt = (await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM calls_for_service_ext WHERE id = ?', id)) || {};
    const parentCallId = childExt.parent_call_id as number | undefined;
    if (!parentCallId) return c.json({ error: 'This call has no parent to restore', code: 'NOT_A_REDISPATCH' }, 400);
    if (child.status !== 'pending') {
      return c.json({ error: 'Only a pending return visit can be undone', code: 'CALL_MUST_BE_PENDING' }, 400);
    }

    // parent_call_id always points at the ROOT of the chain (see redispatch
    // above), which is also where every visit_history snapshot lives — pull
    // the most recent one back off since this undo reverses that snapshot.
    const lastVisit = await queryFirst<{ id: number }>(db,
      'SELECT id FROM call_visit_history WHERE call_id = ? ORDER BY visit_number DESC, id DESC LIMIT 1', parentCallId);
    if (lastVisit) await execute(db, 'DELETE FROM call_visit_history WHERE id = ?', lastVisit.id);

    await execute(db, 'DELETE FROM call_persons WHERE call_id = ?', id);
    await execute(db, 'DELETE FROM call_vehicles WHERE call_id = ?', id);
    await execute(db, 'DELETE FROM call_businesses WHERE call_id = ?', id);
    // Move the Process Server job back onto the remaining CFS. Do not DELETE
    // by child call_id — after relink that row *is* the original job.
    const restoreCallId = await findRestoreCallIdForUndoRedispatch(db, Number(id), Number(parentCallId));
    try {
      await restoreServeJobAfterUndoRedispatch(db, Number(id), restoreCallId);
    } catch (err) {
      log.error('[undo-redispatch] serve_queue restore failed', { callId: id, restoreCallId }, err as Error);
    }
    await execute(db, 'DELETE FROM calls_for_service_ext WHERE id = ?', id);
    await execute(db, 'DELETE FROM calls_for_service WHERE id = ?', id);

    await recordAudit(c, { action: 'CALL_UNDO_REDISPATCH', entityType: 'call', entityId: Number(id), details: { restored_parent_id: parentCallId } });

    const parentBase = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM calls_for_service WHERE id = ?', parentCallId);
    const parentExtRow = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM calls_for_service_ext WHERE id = ?', parentCallId);
    const parent = { ...(parentBase || {}), ...(parentExtRow || {}) };

    try {
      broadcastAll('dispatch_update', { action: 'call_deleted', call_id: Number(id) });
      broadcastAll('dispatch_update', { action: 'call_updated', call: parent });
    } catch { /* best-effort */ }

    return c.json({ parent });
  } catch (err) {
    log.error('POST /dispatch/calls/:id/undo-redispatch failed', { callId: id }, err as Error);
    return dbErrorResponse(c, err, 'Failed to undo re-dispatch');
  }
});

// ── Boot reconciler for call_response_times ──────────────────────────────────
let responseTimesEnsured = false;
async function ensureCallResponseTimesTable(db: D1Database): Promise<void> {
  if (responseTimesEnsured) return;
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS call_response_times (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      call_id INTEGER NOT NULL,
      unit_id INTEGER NOT NULL,
      dispatched_at TEXT,
      onscene_at TEXT NOT NULL,
      response_seconds INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime(\'now\')),
      UNIQUE(call_id, unit_id)
    )
  `).run();
  responseTimesEnsured = true;
}

// POST /dispatch/calls/:id/escalate
// Updates priority, logs a system note, and broadcasts the updated call.
// Requires dispatcher+ role.
calls.post('/:id/escalate', requireRole('dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const userId = c.get('userId') as number | undefined;
    const body = await c.req.json<{ new_priority?: string; reason?: string }>().catch(() => ({} as Record<string, unknown>));

    const newPriority = String(body.new_priority || '').trim().toUpperCase();
    if (!newPriority || !['P1', 'P2', 'P3', 'P4'].includes(newPriority)) {
      return c.json({ error: 'new_priority must be one of P1, P2, P3, P4', code: 'INVALID_PRIORITY' }, 400);
    }

    const existing = await queryFirst<{ id: number; priority: string; status: string }>(
      db, 'SELECT id, priority, status FROM calls_for_service WHERE id = ?', id,
    );
    if (!existing) return c.json({ error: 'Call not found', code: 'NOT_FOUND' }, 404);
    if (['closed', 'cancelled', 'archived'].includes(existing.status)) {
      return c.json({ error: 'Cannot escalate a closed/cancelled/archived call', code: 'CALL_CLOSED' }, 400);
    }

    const oldPriority = existing.priority;
    const reason = String(body.reason || '').trim();

    await execute(db,
      `UPDATE calls_for_service SET priority = ?, updated_at = datetime(\'now\') WHERE id = ?`,
      newPriority, id,
    );

    // System note in call_notes
    const noteText = `Priority escalated from ${oldPriority} to ${newPriority}${reason ? ': ' + reason : ''}`;
    try {
      await execute(db,
        `INSERT INTO call_notes (call_id, user_id, note, created_at) VALUES (?, ?, ?, datetime(\'now\'))`,
        id, userId ?? null, noteText,
      );
    } catch (noteErr) {
      log.warn('Escalate note insert failed (non-fatal)', { callId: id, err: String((noteErr as Error)?.message ?? noteErr) });
    }

    try {
      await recordAudit(c, { action: 'CALL_ESCALATE', entityType: 'call', entityId: Number(id), details: { old_priority: oldPriority, new_priority: newPriority, reason } });
    } catch { /* best-effort */ }

    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM calls_for_service WHERE id = ?', id);

    try { broadcastAll('dispatch_update', { action: 'call_updated', call: updated }); } catch { /* best-effort */ }

    return c.json({ success: true, call: updated, note: noteText });
  } catch (err) {
    log.error('POST /dispatch/calls/:id/escalate failed', {}, err as Error);
    return c.json({ error: 'Failed to escalate call' }, 500);
  }
});

// POST /dispatch/calls/:id/merge (enhanced — canonical merge endpoint)
// Moves units from source call to target, adds a note on target, sets
// source status = 'merged', stores merged_into_call_id in ext.
// Supervisor+ role (stronger than the old dispatcher gate on the legacy
// batch-merge endpoint at /:id/merge, which does multi-ID merges).
calls.post('/:id/merge-into', requireRole('supervisor', 'manager', 'admin'), async (c) => {
  try {
    const db = getDb(c.env);
    const sourceId = Number(c.req.param('id'));
    const userId = c.get('userId') as number | undefined;
    const body = await c.req.json<{ target_call_id?: unknown }>().catch(() => ({} as Record<string, unknown>));
    const targetId = Number(body.target_call_id);

    if (!Number.isInteger(sourceId) || sourceId <= 0) return c.json({ error: 'Invalid source call id' }, 400);
    if (!Number.isInteger(targetId) || targetId <= 0) return c.json({ error: 'target_call_id must be a valid integer' }, 400);
    if (sourceId === targetId) return c.json({ error: 'Source and target calls must differ' }, 400);

    const [sourceCall, targetCall] = await Promise.all([
      queryFirst<{ id: number; call_number: string; status: string; assigned_unit_ids: string | null }>(
        db, 'SELECT id, call_number, status, assigned_unit_ids FROM calls_for_service WHERE id = ?', sourceId,
      ),
      queryFirst<{ id: number; call_number: string; status: string }>(
        db, 'SELECT id, call_number, status FROM calls_for_service WHERE id = ?', targetId,
      ),
    ]);

    if (!sourceCall) return c.json({ error: 'Source call not found' }, 404);
    if (!targetCall) return c.json({ error: 'Target call not found' }, 404);
    if (['closed', 'cancelled', 'archived', 'merged'].includes(sourceCall.status)) {
      return c.json({ error: `Source call is already ${sourceCall.status}`, code: 'SOURCE_INACTIVE' }, 400);
    }

    // Re-assign units from source to target (call_units table if it exists; else JSON column)
    try {
      await execute(db,
        `INSERT OR IGNORE INTO call_units (call_id, unit_id, assigned_at)
         SELECT ?, unit_id, datetime(\'now\') FROM call_units WHERE call_id = ?`,
        targetId, sourceId,
      );
      await execute(db, 'DELETE FROM call_units WHERE call_id = ?', sourceId);
    } catch { /* call_units table may not exist; fall through to JSON approach */ }

    // Add system note on target
    const mergeNote = `Call ${sourceCall.call_number} merged into this call${userId ? ` by user ${userId}` : ''}.`;
    try {
      await execute(db,
        `INSERT INTO call_notes (call_id, user_id, note, created_at) VALUES (?, ?, ?, datetime(\'now\'))`,
        targetId, userId ?? null, mergeNote,
      );
    } catch { /* best-effort */ }

    // Mark source as merged
    await execute(db,
      `UPDATE calls_for_service SET status = 'merged', updated_at = datetime(\'now\'),
        notes = COALESCE(notes || char(10), '') || '[Merged into ' || ? || ']'
       WHERE id = ?`,
      targetCall.call_number, sourceId,
    );
    await execute(db, 'INSERT OR IGNORE INTO calls_for_service_ext (id) VALUES (?)', sourceId);
    await execute(db, 'UPDATE calls_for_service_ext SET parent_call_id = ? WHERE id = ?', targetId, sourceId);

    try { await recordAudit(c, { action: 'CALL_MERGE', entityType: 'call', entityId: sourceId, details: { merged_into: targetId } }); } catch { /* best-effort */ }

    const targetUpdated = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM calls_for_service WHERE id = ?', targetId);
    try {
      broadcastAll('dispatch_update', { action: 'call_updated', call: targetUpdated });
      broadcastAll('dispatch_update', { action: 'call_updated', call: { id: sourceId, status: 'merged' } });
    } catch { /* best-effort */ }

    return c.json({ success: true, source_call_id: sourceId, target_call_id: targetId, target_call: targetUpdated });
  } catch (err) {
    log.error('POST /dispatch/calls/:id/merge-into failed', {}, err as Error);
    return c.json({ error: 'Call merge failed' }, 500);
  }
});

// Expose the reconciler so units route can call it when recording response times
export { ensureCallResponseTimesTable };

export default calls;

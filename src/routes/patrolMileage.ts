// ============================================================
// RMPG Flex — Patrol Mileage (Cloudflare Worker)
// ============================================================
// Per-(officer, unit) mileage anchor + admin correction / audit
// surface that powers the FORM PS-211 Trip Log.
//
// Endpoints:
//   GET    /mileage/suggest?officer_id=X&unit_id=Y
//          Return the suggested starting_mileage for a new patrol
//          or CFS, looked up by (officer, unit) then officer-only
//          then unit-only. The returned value already includes
//          any admin-applied offset_miles.
//   GET    /mileage/chain?officer_id=X&unit_id=Y&from=DATE&to=DATE
//          Return the chronological chain of calls_for_service
//          rows that touched mileage in the scope+window, with
//          audit annotations. Used to render the PS-211 PDF and
//          to preview a chain rewrite BEFORE the admin clicks
//          "Apply Fix".
//   GET    /mileage/audit?officer_id=X&unit_id=Y&from=DATE&to=DATE&limit=N
//          Return the mileage_audit history for the scope.
//   POST   /mileage/fix
//          Admin/manager/supervisor only. Body:
//            { entry_table, entry_id, field, after_value, reason,
//              scope: { officer_id, unit_id }, propagate_chain }
//          Updates the bad row, optionally rewrites every later
//          row in the scope+chain by the same delta, updates the
//          mileage_anchor, and writes a mileage_audit row.
//   GET    /trip-log/generate?officer_id=X&unit_id=Y&from=DATE&to=DATE
//          Return the JSON payload that powers the FORM PS-211
//          Trip Log (RESPONSE rows from calls_for_service +
//          PATROL rows from gps_breadcrumbs between calls). The
//          client renders the actual PDF via the v2 PDF engine
//          (jsPDF) — see client/src/utils/pdf/v2/forms/tripLog.ts.
// ============================================================

import { Hono } from 'hono';
import { clampIntParam } from '../utils/paginationParams';
import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from '../types';
import { getDb, query, queryFirst } from '../utils/db';
import { recordAudit } from '../utils/auditLog';
import { dbErrorResponse } from '../utils/dbErrors';
import { log, logErrorToDb } from '../utils/logger';
import {
  getSuggestedMileage,
  deriveEndMileage,
  scopeKeyOfficerUnit,
  scopeKeyOfficer,
  scopeKeyUnit,
} from '../utils/mileageAnchor';

const pm = new Hono<Env>();

/** Resolve officer_id / unit_id from a calls_for_service row by walking
 *  assigned_unit_ids → units.officer_id. Returns null when the call is
 *  not assigned to a unit (so the chain can't be scoped). */
async function resolveCfsScope(db: D1Database, callId: number): Promise<{
  officerId: number | null; unitId: number | null; assignedUnitIds: number[];
} | null> {
  const row = await queryFirst<{ assigned_unit_ids: string | null }>(
    db, 'SELECT assigned_unit_ids FROM calls_for_service WHERE id = ?', callId,
  );
  if (!row) return null;
  let assigned: number[] = [];
  try { assigned = JSON.parse(row.assigned_unit_ids || '[]'); } catch { assigned = []; }
  if (assigned.length === 0) return { officerId: null, unitId: null, assignedUnitIds: [] };

  // Primary unit (first assigned) — the response was driven by this unit.
  const unitId = assigned[0];
  const unit = await queryFirst<{ officer_id: number | null }>(
    db, 'SELECT officer_id FROM units WHERE id = ?', unitId,
  );
  return { officerId: unit?.officer_id ?? null, unitId, assignedUnitIds: assigned };
}

// ── GET /mileage/suggest ──────────────────────────────────
// Lookup order: officer_unit → officer → unit. Each subsequent
// tier is a fallback when the more specific scope has no anchor.
// The returned current_mileage already reflects offset_miles.
pm.get('/mileage/suggest', async (c) => {
  try {
    const officerIdRaw = c.req.query('officer_id');
    const unitIdRaw = c.req.query('unit_id');
    const officerId = officerIdRaw ? parseInt(officerIdRaw, 10) : NaN;
    const unitId = unitIdRaw ? parseInt(unitIdRaw, 10) : NaN;

    if (!Number.isFinite(officerId) && !Number.isFinite(unitId)) {
      return c.json({
        suggested_mileage: null,
        source: 'none',
        message: 'Provide officer_id and/or unit_id to suggest a starting mileage.',
      }, 400);
    }

    const suggestion = await getSuggestedMileage(
      getDb(c.env),
      Number.isFinite(officerId) ? officerId : null,
      Number.isFinite(unitId) ? unitId : null,
    );
    if (suggestion) return c.json(suggestion);

    return c.json({
      suggested_mileage: null,
      source: 'none',
      message: 'No prior mileage entry for this scope. Enter a starting mileage manually.',
    });
  } catch (err) {
    log.error('[patrolMileage] GET /mileage/suggest failed', {}, err as Error);
    logErrorToDb(c.env.DB, { severity: 'error', category: 'route', message: (err as Error)?.message ?? String(err), details: { route: 'GET /patrol/mileage/suggest' }, source: 'patrolMileage', statusCode: 500 }, c.executionCtx);
    return dbErrorResponse(c, err, 'Failed to suggest mileage');
  }
});

// ── GET /mileage/chain ────────────────────────────────────
// Returns the ordered mileage-touching calls for the (officer, unit)
// scope in the time window. Joins against mileage_audit so the UI
// can show which rows have been corrected (and by how much).
pm.get('/mileage/chain', async (c) => {
  try {
    const officerIdRaw = c.req.query('officer_id');
    const unitIdRaw = c.req.query('unit_id');
    const from = c.req.query('from');
    const to = c.req.query('to');
    const officerId = officerIdRaw ? parseInt(officerIdRaw, 10) : NaN;
    const unitId = unitIdRaw ? parseInt(unitIdRaw, 10) : NaN;
    if (!Number.isFinite(officerId) && !Number.isFinite(unitId)) {
      return c.json({ error: 'officer_id and/or unit_id required' }, 400);
    }

    const db = getDb(c.env);
    // Build a "this is the relevant set of units" filter. When the
    // caller specifies an officer+unit we look at exactly that unit;
    // officer-only is "any unit driven by this officer"; unit-only
    // is "any officer on this unit". We match the unit id as a JSON array
    // element via json_each + CAST (see the per-clause note below) — exact and
    // robust to the mixed ["1"]/[1] storage shapes.
    const params: unknown[] = [];
    const joins: string[] = [];
    const where: string[] = ["c.starting_mileage IS NOT NULL OR c.ending_mileage IS NOT NULL"];
    if (Number.isFinite(officerId) && Number.isFinite(unitId)) {
      joins.push('INNER JOIN units u ON u.id = ? AND u.officer_id = ?');
      params.push(unitId, officerId);
      // Match the unit id as a real JSON array element. A bare
      // LIKE '%'||?||'%' substring match over-matches (unit 1 also hits 10/11/
      // 21/100…) AND a typed `value = ?` under-matches (assigned_unit_ids is
      // stored as both ["1"] and [1]; 1 = '1' is false in SQLite). json_each +
      // CAST(value AS TEXT) is exact and shape-agnostic.
      where.push("(SELECT COUNT(*) FROM json_each(c.assigned_unit_ids) WHERE CAST(value AS TEXT) = ?) > 0");
      params.push(String(unitId));
    } else if (Number.isFinite(officerId)) {
      joins.push('INNER JOIN units u ON u.officer_id = ?');
      params.push(officerId);
    } else if (Number.isFinite(unitId)) {
      joins.push('INNER JOIN units u ON u.id = ?');
      params.push(unitId);
      // Match the unit id as a real JSON array element. A bare
      // LIKE '%'||?||'%' substring match over-matches (unit 1 also hits 10/11/
      // 21/100…) AND a typed `value = ?` under-matches (assigned_unit_ids is
      // stored as both ["1"] and [1]; 1 = '1' is false in SQLite). json_each +
      // CAST(value AS TEXT) is exact and shape-agnostic.
      where.push("(SELECT COUNT(*) FROM json_each(c.assigned_unit_ids) WHERE CAST(value AS TEXT) = ?) > 0");
      params.push(String(unitId));
    }
    if (from) { where.push('COALESCE(c.cleared_at, c.closed_at, c.created_at) >= ?'); params.push(from); }
    if (to)   { where.push('COALESCE(c.cleared_at, c.closed_at, c.created_at) <= ?'); params.push(to);   }

    const sql = `
      SELECT c.id, c.call_number, c.incident_type, c.priority, c.status,
             c.assigned_unit_ids, c.unit_call_signs,
             c.dispatched_at, c.enroute_at, c.onscene_at, c.cleared_at, c.closed_at,
             c.starting_mileage, c.ending_mileage,
             c.responding_vehicle_id
        FROM calls_for_service c
        ${joins.join('\n        ')}
       WHERE ${where.join(' AND ')}
       ORDER BY COALESCE(c.cleared_at, c.closed_at, c.created_at) ASC
       LIMIT 1000
    `;
    const rows = await query<Record<string, unknown>>(db, sql, ...params);

    // ── Pull standalone PATROL trips (no-call movement) ──────
    // The call-side chain only captures mileage tied to a CFS row. Officers
    // also drive patrol routes that never get dispatched (welfare passes,
    // property checks between calls, station-to-zone repositioning) — those
    // closed PATROL trips live in unit_trips with their own start/end
    // mileage. Without them the chain has gaps and the running odometer
    // drifts every shift. We merge those rows in with a synthetic shape
    // (call_number 'PATROL-<id>', incident_type 'PATROL') so the audit UI
    // and trip-log PDF can render them inline with real calls.
    const tripWhere: string[] = ["t.status = 'closed'", "t.trip_type = 'patrol'"];
    const tripParams: unknown[] = [];
    if (Number.isFinite(officerId)) { tripWhere.push('t.officer_id = ?'); tripParams.push(officerId); }
    if (Number.isFinite(unitId)) { tripWhere.push('t.unit_id = ?'); tripParams.push(unitId); }
    if (from) { tripWhere.push('COALESCE(t.end_time, t.start_time) >= ?'); tripParams.push(from); }
    if (to)   { tripWhere.push('COALESCE(t.end_time, t.start_time) <= ?'); tripParams.push(to); }
    const tripRows = await query<{
      id: number; unit_id: number | null; officer_id: number | null; vehicle_id: number | null;
      start_time: string | null; end_time: string | null;
      start_mileage: number | null; end_mileage: number | null;
      distance_m: number | null; duration_s: number | null;
    }>(db, `
      SELECT t.id, t.unit_id, t.officer_id, t.vehicle_id,
             t.start_time, t.end_time,
             t.start_mileage, t.end_mileage,
             t.distance_m, t.duration_s
        FROM unit_trips t
       WHERE ${tripWhere.join(' AND ')}
         -- Patrol trips rarely carry odometer stamps (live D1 2026-06-10: 0 of
         -- 50 closed patrol trips had start/end_mileage) — they carry GPS
         -- distance_m instead. Requiring an odometer reading here excluded
         -- EVERY patrol trip, so the chain showed calls only. Include any trip
         -- with real movement; the engine already noise-discards <50m blips,
         -- and the client renders distance from distance_m when odometer
         -- readings are missing.
         AND (t.start_mileage IS NOT NULL OR t.end_mileage IS NOT NULL
              OR (t.distance_m IS NOT NULL AND t.distance_m > 0))
       ORDER BY COALESCE(t.end_time, t.start_time) ASC
       LIMIT 1000
    `, ...tripParams);
    const patrolRows: Record<string, unknown>[] = tripRows.map(t => ({
      id: t.id,
      source: 'unit_trip',
      call_number: `PATROL-${t.id}`,
      incident_type: 'PATROL',
      priority: null,
      status: 'closed',
      assigned_unit_ids: t.unit_id != null ? JSON.stringify([t.unit_id]) : null,
      unit_call_signs: null,
      dispatched_at: t.start_time,
      enroute_at: t.start_time,
      onscene_at: t.start_time,
      cleared_at: t.end_time,
      closed_at: t.end_time,
      starting_mileage: t.start_mileage,
      ending_mileage: t.end_mileage,
      responding_vehicle_id: t.vehicle_id,
      distance_m: t.distance_m,
      duration_s: t.duration_s,
    }));

    // Annotate each row with the latest mileage_audit correction
    // touching this row, so the UI can badge corrected rows.
    const annotated: Array<Record<string, unknown>> = [];
    for (const r of rows) {
      const audits = await query<{ id: number; field: string; before_value: number | null; after_value: number | null; delta: number; reason: string | null; created_at: string; created_by: number | null; created_by_name: string | null }>(
        db,
        `SELECT ma.id, ma.field, ma.before_value, ma.after_value, ma.delta, ma.reason,
                ma.created_at, ma.created_by,
                u.full_name as created_by_name
           FROM mileage_audit ma
           LEFT JOIN users u ON u.id = ma.created_by
          WHERE ma.entry_table = 'calls_for_service' AND ma.entry_id = ?
          ORDER BY ma.created_at DESC`,
        r.id as number,
      );
      const lastFix = audits[0] ?? null;
      annotated.push({
        ...r,
        source: 'call',
        starting_mileage_corrected: !!(lastFix && lastFix.field === 'starting_mileage'),
        ending_mileage_corrected: !!(lastFix && lastFix.field === 'ending_mileage'),
        last_fix: lastFix,
        audit_count: audits.length,
      });
    }

    // Merge patrol trips into the chain, sorted by end timestamp so the UI
    // sees one continuous timeline of mileage-bearing events. Patrol rows
    // carry source='unit_trip' so the client can render them distinctly
    // (gold-on-dark per the Spillman convention vs CFS's neutral row).
    for (const p of patrolRows) {
      annotated.push({
        ...p,
        starting_mileage_corrected: false,
        ending_mileage_corrected: false,
        last_fix: null,
        audit_count: 0,
      });
    }
    annotated.sort((a, b) => {
      const aT = String(a.cleared_at || a.closed_at || a.dispatched_at || '');
      const bT = String(b.cleared_at || b.closed_at || b.dispatched_at || '');
      return aT.localeCompare(bT);
    });

    // Return the anchor too (so the UI can show the current baseline
    // next to the chain).
    let anchor: Record<string, unknown> | null = null;
    const tryAnchor = async (key: string) => {
      const a = await queryFirst<{ current_mileage: number; offset_miles: number; last_entry_at: string | null }>(
        db, 'SELECT current_mileage, offset_miles, last_entry_at FROM mileage_anchor WHERE scope_key = ?', key,
      );
      if (a) anchor = { scope_key: key, ...a };
    };
    if (Number.isFinite(officerId) && Number.isFinite(unitId)) await tryAnchor(scopeKeyOfficerUnit(officerId, unitId));
    if (!anchor && Number.isFinite(officerId)) await tryAnchor(scopeKeyOfficer(officerId));
    if (!anchor && Number.isFinite(unitId)) await tryAnchor(scopeKeyUnit(unitId));

    return c.json({
      scope: { officer_id: Number.isFinite(officerId) ? officerId : null, unit_id: Number.isFinite(unitId) ? unitId : null },
      window: { from: from ?? null, to: to ?? null },
      anchor,
      rows: annotated,
    });
  } catch (err) {
    log.error('[patrolMileage] GET /mileage/chain failed', {}, err as Error);
    logErrorToDb(c.env.DB, { severity: 'error', category: 'route', message: (err as Error)?.message ?? String(err), details: { route: 'GET /patrol/mileage/chain' }, source: 'patrolMileage', statusCode: 500 }, c.executionCtx);
    return dbErrorResponse(c, err, 'Failed to load chain');
  }
});

// ── GET /mileage/audit ────────────────────────────────────
pm.get('/mileage/audit', async (c) => {
  try {
    const officerIdRaw = c.req.query('officer_id');
    const unitIdRaw = c.req.query('unit_id');
    const from = c.req.query('from');
    const to = c.req.query('to');
    const limit = clampIntParam(c.req.query('limit'), 100, 1, 500);
    const officerId = officerIdRaw ? parseInt(officerIdRaw, 10) : NaN;
    const unitId = unitIdRaw ? parseInt(unitIdRaw, 10) : NaN;
    if (!Number.isFinite(officerId) && !Number.isFinite(unitId)) {
      return c.json({ error: 'officer_id and/or unit_id required' }, 400);
    }
    const db = getDb(c.env);
    const where: string[] = [];
    const params: unknown[] = [];
    if (Number.isFinite(officerId) && Number.isFinite(unitId)) {
      where.push('ma.scope_key = ?'); params.push(scopeKeyOfficerUnit(officerId, unitId));
    } else if (Number.isFinite(officerId)) {
      where.push('ma.scope_key = ?'); params.push(scopeKeyOfficer(officerId));
    } else {
      where.push('ma.scope_key = ?'); params.push(scopeKeyUnit(unitId));
    }
    if (from) { where.push('ma.created_at >= ?'); params.push(from); }
    if (to)   { where.push('ma.created_at <= ?'); params.push(to);   }
    const sql = `
      SELECT ma.*, u.full_name as created_by_name
        FROM mileage_audit ma
        LEFT JOIN users u ON u.id = ma.created_by
       WHERE ${where.join(' AND ')}
       ORDER BY ma.created_at DESC
       LIMIT ?
    `;
    const rows = await query<Record<string, unknown>>(db, sql, ...params, limit);
    return c.json({ rows });
  } catch (err) {
    log.error('[patrolMileage] GET /mileage/audit failed', {}, err as Error);
    logErrorToDb(c.env.DB, { severity: 'error', category: 'route', message: (err as Error)?.message ?? String(err), details: { route: 'GET /patrol/mileage/audit' }, source: 'patrolMileage', statusCode: 500 }, c.executionCtx);
    return dbErrorResponse(c, err, 'Failed to load audit');
  }
});

// ── GET /mileage/fix-suggestions ──────────────────────────
// Autofill candidates for the admin fix/backfill form. For a given CFS row
// and field, computes data-derived values the admin can apply in one click:
//   • gps        — starting_mileage + GPS-recorded breadcrumb distance over
//                  the call window (ending fix), or ending − GPS distance
//                  (starting fix). Reuses computeBreadcrumbStats.
//   • next_start — the NEXT mileage-bearing event's starting reading
//                  (odometer continuity: this call should end where the
//                  next one starts). Considers BOTH calls_for_service and
//                  closed PATROL unit_trips, whichever is nearest in time.
//   • prev_end   — the PREVIOUS event's ending reading (starting fix).
// Read-only; same role gate as /mileage/fix so the chips only ever appear
// where the Apply button works.
pm.get('/mileage/fix-suggestions', async (c) => {
  try {
    const user = c.get('user') as { id: number; role: string } | undefined;
    if (!user) return c.json({ error: 'Unauthenticated' }, 401);
    if (!['admin', 'manager', 'supervisor'].includes(user.role)) {
      return c.json({ error: 'Admin / manager / supervisor only', code: 'FORBIDDEN' }, 403);
    }
    const entryId = parseInt(c.req.query('entry_id') || '', 10);
    const field = c.req.query('field');
    if (!Number.isFinite(entryId)) return c.json({ error: 'entry_id required', code: 'BAD_ENTRY' }, 400);
    if (field !== 'starting_mileage' && field !== 'ending_mileage') {
      return c.json({ error: 'field must be starting_mileage or ending_mileage', code: 'BAD_FIELD' }, 400);
    }

    const db = getDb(c.env);
    const call = await queryFirst<{
      starting_mileage: number | null; ending_mileage: number | null;
      call_number: string | null;
      dispatched_at: string | null; enroute_at: string | null; onscene_at: string | null;
      cleared_at: string | null; closed_at: string | null; created_at: string;
    }>(db, `SELECT starting_mileage, ending_mileage, call_number,
                   dispatched_at, enroute_at, onscene_at, cleared_at, closed_at, created_at
              FROM calls_for_service WHERE id = ?`, entryId);
    if (!call) return c.json({ error: 'Call not found', code: 'NOT_FOUND' }, 404);

    const scope = await resolveCfsScope(db, entryId);
    const officerId = scope?.officerId ?? null;
    const unitId = scope?.unitId ?? null;

    const windowStart = call.dispatched_at || call.enroute_at || call.onscene_at || call.created_at;
    const windowEnd = call.cleared_at || call.closed_at || new Date().toISOString();
    const chainTime = call.cleared_at || call.closed_at || call.created_at;

    // GPS-recorded distance over the call window (breadcrumb haversine sum).
    let gps: { distance_mi: number; point_count: number; max_mph: number } | null = null;
    if ((unitId || officerId) && windowStart && windowEnd) {
      const stats = await computeBreadcrumbStats(db, unitId, officerId, windowStart, windowEnd);
      if (stats.point_count > 0) {
        gps = { distance_mi: round1(stats.distance_miles), point_count: stats.point_count, max_mph: stats.max_mph };
      }
    }

    // Nearest mileage-bearing neighbors in the same scope — check both the
    // CFS chain and closed PATROL trips, then pick whichever is closest in
    // time. Same json_each + CAST scope filter as the /mileage/fix cascade
    // (assigned_unit_ids is stored as both ["1"] and [1]).
    const scopeWhere = `(
        (SELECT COUNT(*) FROM json_each(assigned_unit_ids) WHERE CAST(value AS TEXT) = ?) > 0
        OR (
          SELECT u.officer_id FROM units u
           WHERE u.id = (SELECT CAST(value AS INTEGER) FROM json_each(assigned_unit_ids) LIMIT 1)
        ) = ?
      )`;
    type NeighborRow = { ref: string; t: string; starting_mileage: number | null; ending_mileage: number | null };
    const neighborCfs = async (dir: 'prev' | 'next'): Promise<NeighborRow | null> => {
      if (unitId == null && officerId == null) return null;
      const cmp = dir === 'prev' ? '<' : '>';
      const ord = dir === 'prev' ? 'DESC' : 'ASC';
      const r = await queryFirst<{ id: number; call_number: string | null; t: string; starting_mileage: number | null; ending_mileage: number | null }>(
        db,
        `SELECT id, call_number, COALESCE(cleared_at, closed_at, created_at) AS t,
                starting_mileage, ending_mileage
           FROM calls_for_service
          WHERE id != ?
            AND (starting_mileage IS NOT NULL OR ending_mileage IS NOT NULL)
            AND COALESCE(cleared_at, closed_at, created_at) ${cmp} ?
            AND ${scopeWhere}
          ORDER BY COALESCE(cleared_at, closed_at, created_at) ${ord}
          LIMIT 1`,
        entryId, chainTime, String(unitId ?? -1), officerId ?? -1,
      );
      return r ? { ref: r.call_number || `CFS #${r.id}`, t: r.t, starting_mileage: r.starting_mileage, ending_mileage: r.ending_mileage } : null;
    };
    const neighborTrip = async (dir: 'prev' | 'next'): Promise<NeighborRow | null> => {
      if (unitId == null && officerId == null) return null;
      const cmp = dir === 'prev' ? '<' : '>';
      const ord = dir === 'prev' ? 'DESC' : 'ASC';
      const parts: string[] = [];
      const prm: unknown[] = [];
      if (unitId != null) { parts.push('unit_id = ?'); prm.push(unitId); }
      if (officerId != null) { parts.push('officer_id = ?'); prm.push(officerId); }
      const r = await queryFirst<{ id: number; t: string; start_mileage: number | null; end_mileage: number | null }>(
        db,
        `SELECT id, COALESCE(end_time, start_time) AS t, start_mileage, end_mileage
           FROM unit_trips
          WHERE status = 'closed'
            AND (start_mileage IS NOT NULL OR end_mileage IS NOT NULL)
            AND COALESCE(end_time, start_time) ${cmp} ?
            AND (${parts.join(' OR ')})
          ORDER BY COALESCE(end_time, start_time) ${ord}
          LIMIT 1`,
        chainTime, ...prm,
      );
      return r ? { ref: `PATROL-${r.id}`, t: r.t, starting_mileage: r.start_mileage, ending_mileage: r.end_mileage } : null;
    };
    const pickNearest = (a: NeighborRow | null, b: NeighborRow | null, dir: 'prev' | 'next'): NeighborRow | null => {
      if (!a) return b;
      if (!b) return a;
      // prev → later timestamp is nearer; next → earlier timestamp is nearer.
      return (dir === 'prev' ? a.t >= b.t : a.t <= b.t) ? a : b;
    };
    const [prevC, prevT, nextC, nextT] = await Promise.all([
      neighborCfs('prev'), neighborTrip('prev'), neighborCfs('next'), neighborTrip('next'),
    ]);
    const prev = pickNearest(prevC, prevT, 'prev');
    const next = pickNearest(nextC, nextT, 'next');

    // Build candidates (deduped by value).
    const candidates: Array<{ value: number; source: string; label: string; detail: string }> = [];
    const push = (value: number | null | undefined, source: string, label: string, detail: string) => {
      if (value == null || !Number.isFinite(value) || value <= 0) return;
      const v = round1(value);
      if (candidates.some((x) => Math.abs(x.value - v) < 0.05)) return;
      candidates.push({ value: v, source, label, detail });
    };
    if (field === 'ending_mileage') {
      if (call.starting_mileage != null && gps && gps.distance_mi > 0) {
        push(call.starting_mileage + gps.distance_mi, 'gps',
          `GPS +${gps.distance_mi.toFixed(1)} mi`,
          `start ${call.starting_mileage} + ${gps.distance_mi.toFixed(1)} mi recorded over ${gps.point_count} GPS points`);
      }
      push(next?.starting_mileage, 'next_start',
        `${next?.ref} starts here`,
        `odometer continuity — the next mileage-bearing event (${next?.ref}) started at this reading`);
    } else {
      push(prev?.ending_mileage, 'prev_end',
        `${prev?.ref} ended here`,
        `odometer continuity — the previous mileage-bearing event (${prev?.ref}) ended at this reading`);
      if (call.ending_mileage != null && gps && gps.distance_mi > 0) {
        push(call.ending_mileage - gps.distance_mi, 'gps',
          `GPS −${gps.distance_mi.toFixed(1)} mi`,
          `end ${call.ending_mileage} − ${gps.distance_mi.toFixed(1)} mi recorded over ${gps.point_count} GPS points`);
      }
    }

    return c.json({
      entry_id: entryId,
      field,
      current: { starting_mileage: call.starting_mileage, ending_mileage: call.ending_mileage },
      gps,
      neighbors: {
        prev: prev ? { ref: prev.ref, ending_mileage: prev.ending_mileage, starting_mileage: prev.starting_mileage } : null,
        next: next ? { ref: next.ref, ending_mileage: next.ending_mileage, starting_mileage: next.starting_mileage } : null,
      },
      candidates,
    });
  } catch (err) {
    log.error('[patrolMileage] GET /mileage/fix-suggestions failed', {}, err as Error);
    logErrorToDb(c.env.DB, { severity: 'error', category: 'route', message: (err as Error)?.message ?? String(err), details: { route: 'GET /patrol/mileage/fix-suggestions' }, source: 'patrolMileage', statusCode: 500 }, c.executionCtx);
    return dbErrorResponse(c, err, 'Failed to compute suggestions');
  }
});

// ── POST /mileage/fix ────────────────────────────────────
// Body:
//   { entry_table, entry_id, field, after_value, reason,
//     scope: { officer_id, unit_id }, propagate_chain }
pm.post('/mileage/fix', async (c) => {
  try {
    const user = c.get('user') as { id: number; role: string } | undefined;
    if (!user) return c.json({ error: 'Unauthenticated' }, 401);
    if (!['admin', 'manager', 'supervisor'].includes(user.role)) {
      return c.json({ error: 'Admin / manager / supervisor only', code: 'FORBIDDEN' }, 403);
    }
    const body = await c.req.json<{
      entry_table?: string;
      entry_id?: number;
      field?: 'starting_mileage' | 'ending_mileage';
      after_value?: number;
      reason?: string;
      scope?: { officer_id?: number | null; unit_id?: number | null };
      propagate_chain?: boolean;
    }>().catch(() => ({} as any));
    if (body.entry_table !== 'calls_for_service') {
      return c.json({ error: 'entry_table must be calls_for_service', code: 'BAD_ENTRY' }, 400);
    }
    if (!Number.isFinite(body.entry_id)) {
      return c.json({ error: 'entry_id required', code: 'BAD_ENTRY' }, 400);
    }
    if (!['starting_mileage', 'ending_mileage'].includes(String(body.field))) {
      return c.json({ error: 'field must be starting_mileage or ending_mileage', code: 'BAD_FIELD' }, 400);
    }
    if (!Number.isFinite(body.after_value)) {
      return c.json({ error: 'after_value required (number)', code: 'BAD_VALUE' }, 400);
    }
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (!reason) {
      return c.json({ error: 'reason required (audit trail)', code: 'REASON_REQUIRED' }, 400);
    }
    let propagate = body.propagate_chain !== false; // default true

    const db = getDb(c.env);
    const existing = await queryFirst<{ starting_mileage: number | null; ending_mileage: number | null; call_number: string | null; assigned_unit_ids: string | null; cleared_at: string | null; closed_at: string | null; created_at: string }>(
      db,
      'SELECT starting_mileage, ending_mileage, call_number, assigned_unit_ids, cleared_at, closed_at, created_at FROM calls_for_service WHERE id = ?',
      body.entry_id,
    );
    if (!existing) return c.json({ error: 'Call not found', code: 'NOT_FOUND' }, 404);
    const before = existing[body.field as 'starting_mileage' | 'ending_mileage'];
    const after = Number(body.after_value);
    // A null current value means the call was cleared without a mileage stamp
    // on this field — the common "officer forgot to enter ending mileage" case.
    // That's a BACKFILL (set the value for the first time), not a correction.
    // The old code rejected before==null with NO_VALUE, which made it
    // impossible to fill in a missing ending mileage at all — even though the
    // UI offers "New value (was —)" precisely for this. (regression fix)
    const isBackfill = before == null;
    if (!isBackfill && after === before) {
      return c.json({ error: 'after_value equals before_value; no change to apply', code: 'NO_DELTA' }, 400);
    }
    // A backfill shifts nothing downstream — there is no prior reading to diff
    // against — so the chain delta is 0 and we never propagate, regardless of
    // the client's propagate flag.
    const delta = isBackfill ? 0 : after - (before as number);
    if (isBackfill) propagate = false;

    // Resolve scope. Explicit scope wins; otherwise derive from the
    // call's primary assigned unit.
    let officerId: number | null = body.scope?.officer_id ?? null;
    let unitId: number | null = body.scope?.unit_id ?? null;
    if (officerId == null || unitId == null) {
      const derived = await resolveCfsScope(db, body.entry_id);
      if (!derived) return c.json({ error: 'Could not resolve scope from call assignment', code: 'NO_SCOPE' }, 400);
      officerId = officerId ?? derived.officerId;
      unitId = unitId ?? derived.unitId;
    }
    if (officerId == null || unitId == null) {
      return c.json({ error: 'Scope requires both officer_id and unit_id (the call must be assigned to a unit with an officer)', code: 'INCOMPLETE_SCOPE' }, 400);
    }

    const scopeKey = scopeKeyOfficerUnit(officerId, unitId);
    const scopeType = 'officer_unit';
    const anchorTime = existing.cleared_at || existing.closed_at || existing.created_at;

    // ── Compute cascade ──────────────────────────────────
    // Find all subsequent rows in the same scope whose mileage is
    // at-or-after the bad value (so applying the delta preserves
    // the chain). We use the row's clear/close time as the chain
    // cursor — anything closed AFTER the bad row gets the delta.
    // Both starting and ending get rewritten; ending first so the
    // transition is consistent for any reader mid-transaction.
    let cascadeCount = 0;
    let rewriteStarting: Array<{ id: number; before: number | null; after: number }> = [];
    let rewriteEnding:   Array<{ id: number; before: number | null; after: number }> = [];
    if (propagate) {
      const later = await query<{ id: number; starting_mileage: number | null; ending_mileage: number | null }>(
        db,
        `SELECT id, starting_mileage, ending_mileage
           FROM calls_for_service
          WHERE id != ?
            AND (starting_mileage IS NOT NULL OR ending_mileage IS NOT NULL)
            -- '>=' (not '>') so a sibling call that shares the anchor's
            -- exact cleared_at (common on bulk-close) is still cascaded;
            -- the id-mismatch guard above prevents the anchor self-matching.
            AND COALESCE(cleared_at, closed_at, created_at) >= ?
            AND (
              -- assigned_unit_ids is stored inconsistently as ["1"] (text) AND [1]
              -- (int). json_each.value keeps the JSON storage class, and in SQLite
              -- 1 = '1' is FALSE, so a bare value=? comparison silently dropped
              -- calls stored in the other shape. CAST to TEXT to match both.
              (SELECT COUNT(*) FROM json_each(assigned_unit_ids) WHERE CAST(value AS TEXT) = ?) > 0
              OR (
                SELECT u.officer_id FROM units u
                 WHERE u.id = (SELECT CAST(value AS INTEGER) FROM json_each(assigned_unit_ids) LIMIT 1)
              ) = ?
            )
          ORDER BY COALESCE(cleared_at, closed_at, created_at) ASC
          LIMIT 1000`,
        body.entry_id, anchorTime, String(unitId), officerId,
      );
      for (const row of later) {
        if (row.starting_mileage != null) {
          rewriteStarting.push({ id: row.id, before: row.starting_mileage, after: row.starting_mileage + delta });
        }
        if (row.ending_mileage != null) {
          rewriteEnding.push({ id: row.id, before: row.ending_mileage, after: row.ending_mileage + delta });
        }
      }
      cascadeCount = new Set([...rewriteStarting.map(r => r.id), ...rewriteEnding.map(r => r.id)]).size;
    }

    // ── Apply ────────────────────────────────────────────
    // Single primary update + N cascade updates. D1 batch keeps
    // it inside one round trip and one logical write.
    const batch: { sql: string; bindings?: unknown[] }[] = [];
    batch.push({
      sql: `UPDATE calls_for_service SET ${body.field} = ?, updated_at = datetime(\'now\') WHERE id = ?`,
      bindings: [after, body.entry_id],
    });
    for (const r of rewriteStarting) {
      batch.push({
        sql: 'UPDATE calls_for_service SET starting_mileage = ?, updated_at = datetime(\'now\') WHERE id = ?',
        bindings: [r.after, r.id],
      });
    }
    for (const r of rewriteEnding) {
      batch.push({
        sql: 'UPDATE calls_for_service SET ending_mileage = ?, updated_at = datetime(\'now\') WHERE id = ?',
        bindings: [r.after, r.id],
      });
    }
    // Anchor: upsert. For a CORRECTION the delta accumulates into offset_miles
    // AND bumps current_mileage so the next /suggest returns the corrected
    // baseline. For a BACKFILL there is no delta to accumulate — instead we
    // advance current_mileage to the newly-stamped reading when it's higher
    // (a fresh ending odometer); MAX() keeps a starting-mileage backfill from
    // lowering an already-higher baseline, and offset_miles is left untouched.
    if (isBackfill) {
      batch.push({
        sql: `INSERT INTO mileage_anchor
                (scope_type, scope_key, officer_id, unit_id, current_mileage, offset_miles,
                 last_entry_table, last_entry_id, last_entry_at, updated_by)
              VALUES (?, ?, ?, ?, ?, 0, 'calls_for_service', ?, ?, ?)
              ON CONFLICT(scope_key) DO UPDATE SET
                current_mileage = MAX(mileage_anchor.current_mileage, excluded.current_mileage),
                last_entry_table = excluded.last_entry_table,
                last_entry_id = excluded.last_entry_id,
                last_entry_at = excluded.last_entry_at,
                updated_by = excluded.updated_by,
                updated_at = datetime('now')`,
        bindings: [scopeType, scopeKey, officerId, unitId, after, body.entry_id, anchorTime, user.id],
      });
    } else {
      batch.push({
        sql: `INSERT INTO mileage_anchor
                (scope_type, scope_key, officer_id, unit_id, current_mileage, offset_miles,
                 last_entry_table, last_entry_id, last_entry_at, updated_by)
              VALUES (?, ?, ?, ?, ?, ?, 'calls_for_service', ?, ?, ?)
              ON CONFLICT(scope_key) DO UPDATE SET
                current_mileage = mileage_anchor.current_mileage + excluded.offset_miles,
                offset_miles = mileage_anchor.offset_miles + excluded.offset_miles,
                last_entry_table = excluded.last_entry_table,
                last_entry_id = excluded.last_entry_id,
                last_entry_at = excluded.last_entry_at,
                updated_by = excluded.updated_by,
                updated_at = datetime('now')`,
        bindings: [scopeType, scopeKey, officerId, unitId, after, delta, body.entry_id, anchorTime, user.id],
      });
    }
    // The cascade above rewrote current rows; the offset still
    // applies to FUTURE entries (officer's next patrol). That is
    // already handled by offset_miles on the anchor row.
    // Audit row:
    batch.push({
      sql: `INSERT INTO mileage_audit
              (scope_type, scope_key, officer_id, unit_id,
               entry_table, entry_id, field, before_value, after_value,
               delta, cascade_count, reason, created_by)
            VALUES (?, ?, ?, ?, 'calls_for_service', ?, ?, ?, ?, ?, ?, ?, ?)`,
      bindings: [
        scopeType, scopeKey, officerId, unitId,
        body.entry_id, body.field, before, after,
        delta, cascadeCount, reason, user.id,
      ],
    });
    // Dispatch-Audit-tab + analytics entries — routed through the central audit
    // seam AFTER the atomic batch commits (a fix that doesn't commit isn't
    // audited), rather than inlined in the batch. Collected here, fired below.
    const auditLogEntries: Array<{ action: string; entityType: string; entityId: number | string | null; details: string }> = [{
      action: 'MILEAGE_FIX', entityType: 'call', entityId: body.entry_id,
      details: `${isBackfill ? 'Mileage backfill' : 'Mileage fix'}: ${existing.call_number || body.entry_id} ${body.field} ${before == null ? '—' : before}→${after}` +
        `${isBackfill ? '' : ` (Δ ${delta >= 0 ? '+' : ''}${delta.toFixed(1)} mi, cascade=${cascadeCount})`} scope=${scopeKey} — ${reason}`,
    }];

    // ── Fleet odometer write-through ────────────────────────
    // When the corrected/backfilled field is the call's ending_mileage AND
    // the call was assigned to a specific fleet vehicle, push the new value
    // through to fleet_vehicles.current_mileage. MAX() semantics — never
    // lower the odometer (a corrected past trip can't outrank a more recent
    // reading on the same vehicle). Audited separately so the fleet history
    // shows the source. Best-effort: any vehicle resolution miss is a no-op,
    // not a failure — the call-level fix already succeeded.
    if (body.field === 'ending_mileage') {
      const veh = await queryFirst<{ vehicle_id: number | null }>(
        db,
        'SELECT responding_vehicle_id AS vehicle_id FROM calls_for_service WHERE id = ?',
        body.entry_id,
      );
      const vehicleId = veh?.vehicle_id;
      if (vehicleId != null && Number.isFinite(vehicleId)) {
        batch.push({
          sql: `UPDATE fleet_vehicles
                   SET current_mileage = MAX(COALESCE(current_mileage, 0), ?)
                 WHERE id = ?`,
          bindings: [after, vehicleId],
        });
        auditLogEntries.push({
          action: 'FLEET_ODOMETER_SYNC', entityType: 'fleet_vehicle', entityId: vehicleId,
          details: `Odometer write-through from mileage fix on call ${existing.call_number || body.entry_id}: ` +
            `proposed ${after} mi (current MAX-merged) — ${reason}`,
        });
      }
    }

    await db.batch(batch.map(s => {
      const stmt = db.prepare(s.sql);
      return s.bindings?.length ? stmt.bind(...s.bindings) : stmt;
    }));

    // Fire the audit_log rows + flex_events mirror now that the fix committed.
    for (const a of auditLogEntries) {
      await recordAudit(c, { ...a, actorId: user.id });
    }

    return c.json({
      success: true,
      is_backfill: isBackfill,
      scope: { scope_type: scopeType, scope_key: scopeKey, officer_id: officerId, unit_id: unitId },
      fix: {
        entry_table: 'calls_for_service',
        entry_id: body.entry_id,
        call_number: existing.call_number,
        field: body.field,
        before, after, delta,
      },
      cascade: {
        count: cascadeCount,
        rewrote_starting: rewriteStarting.length,
        rewrote_ending: rewriteEnding.length,
      },
      reason,
      fixed_by: user.id,
      fixed_at: new Date().toISOString(),
    });
  } catch (err) {
    log.error('[patrolMileage] POST /mileage/fix failed', {}, err as Error);
    logErrorToDb(c.env.DB, { severity: 'error', category: 'route', message: (err as Error)?.message ?? String(err), details: { route: 'POST /patrol/mileage/fix' }, source: 'patrolMileage', statusCode: 500 }, c.executionCtx);
    return dbErrorResponse(c, err, 'Failed to apply fix');
  }
});

// ── GET /trip-log/generate ────────────────────────────────
// Builds the JSON payload the FORM PS-211 renderer needs. The
// client uses jsPDF + the v2 PDF engine to produce the actual
// PDF (matches the rest of the system's PDF architecture).
//
// Output:
//   {
//     meta: { officer, unit, period: { from, to }, generated_at, trips_logged, page_count },
//     anchor: { current_mileage, offset_miles } | null,
//     rows: [
//       { type: 'PATROL' | 'RESPONSE', call_id, call_number, start, end,
//         distance_mi, duration_min, mileage_from, mileage_to, max_mph, harsh }
//     ],
//     totals: { distance_mi, duration_min, harsh: { a, b, c } }
//   }
pm.get('/trip-log/generate', async (c) => {
  try {
    const officerIdRaw = c.req.query('officer_id');
    const unitIdRaw = c.req.query('unit_id');
    const officerId = officerIdRaw ? parseInt(officerIdRaw, 10) : NaN;
    const unitId = unitIdRaw ? parseInt(unitIdRaw, 10) : NaN;
    if (!Number.isFinite(officerId) && !Number.isFinite(unitId)) {
      return c.json({ error: 'officer_id and/or unit_id required' }, 400);
    }
    const from = c.req.query('from') || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const to = c.req.query('to') || new Date().toISOString().slice(0, 10);

    const db = getDb(c.env);
    // Officer / unit names for the header.
    let officerName: string | null = null;
    let unitCallSign: string | null = null;
    if (Number.isFinite(officerId)) {
      const u = await queryFirst<{ full_name: string }>(db, 'SELECT full_name FROM users WHERE id = ?', officerId);
      officerName = u?.full_name ?? null;
    }
    if (Number.isFinite(unitId)) {
      const u = await queryFirst<{ call_sign: string }>(db, 'SELECT call_sign FROM units WHERE id = ?', unitId);
      unitCallSign = u?.call_sign ?? null;
    }

    // RESPONSE rows: closed CFS with mileage on this scope.
    // Build the "this unit handled this call" filter the same way
    // /mileage/chain does (json_each check + officer match).
    const params: unknown[] = [];
    const joins: string[] = [];
    const where: string[] = [
      "(c.starting_mileage IS NOT NULL OR c.ending_mileage IS NOT NULL)",
      "date(COALESCE(c.cleared_at, c.closed_at, c.created_at)) >= date(?)",
      "date(COALESCE(c.cleared_at, c.closed_at, c.created_at)) <= date(?)",
    ];
    params.push(from, to);
    if (Number.isFinite(officerId) && Number.isFinite(unitId)) {
      joins.push('INNER JOIN units u ON u.id = ? AND u.officer_id = ?');
      params.push(unitId, officerId);
      // CAST(value AS TEXT): assigned_unit_ids is stored as both ["1"] and [1];
      // a bare `value = ?` (text param) misses the integer-shaped rows in SQLite.
      where.push("(SELECT COUNT(*) FROM json_each(c.assigned_unit_ids) WHERE CAST(value AS TEXT) = ?) > 0");
      params.push(String(unitId));
    } else if (Number.isFinite(officerId)) {
      joins.push('INNER JOIN units u ON u.officer_id = ?');
      params.push(officerId);
    } else if (Number.isFinite(unitId)) {
      joins.push('INNER JOIN units u ON u.id = ?');
      params.push(unitId);
      // CAST(value AS TEXT): assigned_unit_ids is stored as both ["1"] and [1];
      // a bare `value = ?` (text param) misses the integer-shaped rows in SQLite.
      where.push("(SELECT COUNT(*) FROM json_each(c.assigned_unit_ids) WHERE CAST(value AS TEXT) = ?) > 0");
      params.push(String(unitId));
    }

    const cfsRows = await query<Record<string, unknown>>(db, `
      SELECT c.id, c.call_number, c.incident_type, c.priority, c.status,
             c.dispatched_at, c.enroute_at, c.onscene_at, c.cleared_at, c.closed_at,
             c.starting_mileage, c.ending_mileage, c.assigned_unit_ids, c.unit_call_signs
        FROM calls_for_service c
        ${joins.join('\n        ')}
       WHERE ${where.join(' AND ')}
       ORDER BY COALESCE(c.dispatched_at, c.created_at) ASC
       LIMIT 1000
    `, ...params);

    // Build RESPONSE rows (mileage transitions) and PATROL rows
    // (gaps between responses, derived from gps_breadcrumbs).
    const responseRows: TripLogRow[] = [];
    for (const cfs of cfsRows) {
      const start = (cfs.dispatched_at as string) || (cfs.enroute_at as string) || (cfs.onscene_at as string) || (cfs.closed_at as string);
      const end = (cfs.cleared_at as string) || (cfs.closed_at as string) || start;
      const startMileage = cfs.starting_mileage != null ? Number(cfs.starting_mileage) : null;
      const endMileage = cfs.ending_mileage != null ? Number(cfs.ending_mileage) : null;
      const distance = startMileage != null && endMileage != null ? Math.max(0, endMileage - startMileage) : 0;
      const duration = start && end ? Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000)) : 0;

      // Max MPH + harsh from gps_breadcrumbs between start and end
      const stats = await computeBreadcrumbStats(
        db,
        Number.isFinite(unitId as number) ? (unitId as number) : null,
        Number.isFinite(officerId as number) ? (officerId as number) : null,
        start, end,
      );

      responseRows.push({
        type: 'RESPONSE',
        call_id: cfs.id as number,
        call_number: (cfs.call_number as string) || `CFS #${cfs.id}`,
        start,
        end,
        distance_mi: round1(distance),
        duration_min: duration,
        mileage_from: startMileage,
        mileage_to: endMileage,
        max_mph: stats.max_mph,
        harsh: stats.harsh,
      });
    }

    // PATROL rows: discrete completed trips from nav_trip_log (the trip
    // detector's real start/stop segmentation).
    //
    // The previous implementation derived PATROL rows from breadcrumb GAPS
    // BETWEEN dispatched-call (CFS) responses. For an officer who just patrols
    // and is never dispatched to a call there are zero RESPONSE rows, so the
    // whole report window collapsed into ONE patrol "gap" row spanning from→to
    // (a nonsensical multi-day duration — e.g. 11520 min over a week) and the
    // officer's actual discrete trips never appeared ("missing recent trips").
    // nav_trip_log already holds the real per-trip start/end, so use it. Per-trip
    // max_mph / harsh / distance are recomputed from the breadcrumbs over each
    // trip's window (authoritative — nav_trip_log.distance_miles can be null),
    // falling back to the stored values.
    const patrolRows: TripLogRow[] = [];
    const navWhere: string[] = ["status = 'completed'", 'date(start_time) >= date(?)', 'date(start_time) <= date(?)'];
    const navParams: unknown[] = [from, to];
    if (Number.isFinite(officerId)) { navWhere.push('officer_id = ?'); navParams.push(officerId); }
    else if (Number.isFinite(unitId)) { navWhere.push('unit_id = ?'); navParams.push(unitId); }
    const navTrips = await query<Record<string, unknown>>(db, `
      SELECT id, start_time, end_time, distance_miles, duration_seconds, max_speed_mph
        FROM nav_trip_log
       WHERE ${navWhere.join(' AND ')}
       ORDER BY start_time ASC
       LIMIT 500
    `, ...navParams);

    // unit_trips also tracks PATROL movement, with start/end odometer stamps
    // that nav_trip_log lacks. Pull the closed PATROL rows in this window so
    // we can attach mileage_from/mileage_to to patrol log entries when their
    // time spans line up. Indexed by (officer_id||unit_id, start_time) for
    // quick lookup.
    const utWhere: string[] = ["status = 'closed'", "trip_type = 'patrol'", 'date(start_time) >= date(?)', 'date(start_time) <= date(?)'];
    const utParams: unknown[] = [from, to];
    if (Number.isFinite(officerId)) { utWhere.push('officer_id = ?'); utParams.push(officerId); }
    else if (Number.isFinite(unitId)) { utWhere.push('unit_id = ?'); utParams.push(unitId); }
    const unitTrips = await query<{
      start_time: string | null; end_time: string | null;
      start_mileage: number | null; end_mileage: number | null;
      distance_m: number | null; duration_s: number | null; max_speed: number | null;
      harsh_accel_count: number | null; harsh_brake_count: number | null; harsh_corner_count: number | null;
    }>(db, `
      SELECT start_time, end_time, start_mileage, end_mileage,
             distance_m, duration_s, max_speed,
             harsh_accel_count, harsh_brake_count, harsh_corner_count
        FROM unit_trips
       WHERE ${utWhere.join(' AND ')}
       ORDER BY start_time ASC
       LIMIT 1000
    `, ...utParams);

    // CALL_RESPONSE unit_trips that don't correspond to a CFS row already
    // in the report (the CFS path above only sees calls with mileage; the
    // dispatch trip engine logs the drive regardless). Without these, a
    // response drive on a mileage-less call silently vanished from PS-211.
    const seenCallIds = new Set(responseRows.map((r) => r.call_id).filter((id) => id != null));
    const utRespWhere: string[] = ["status = 'closed'", "trip_type = 'call_response'", 'date(start_time) >= date(?)', 'date(start_time) <= date(?)'];
    const utRespParams: unknown[] = [from, to];
    if (Number.isFinite(officerId)) { utRespWhere.push('officer_id = ?'); utRespParams.push(officerId); }
    else if (Number.isFinite(unitId)) { utRespWhere.push('unit_id = ?'); utRespParams.push(unitId); }
    const utResponses = await query<Record<string, unknown>>(db, `
      SELECT id, call_id, call_number, start_time, end_time,
             start_mileage, end_mileage, distance_m, duration_s, max_speed,
             harsh_accel_count, harsh_brake_count, harsh_corner_count
        FROM unit_trips
       WHERE ${utRespWhere.join(' AND ')}
       ORDER BY start_time ASC
       LIMIT 1000
    `, ...utRespParams);
    for (const ut of utResponses) {
      if (ut.call_id != null && seenCallIds.has(ut.call_id as number)) continue;
      const start = ut.start_time as string;
      if (!start) continue;
      const end = (ut.end_time as string) || start;
      const distM = ut.distance_m != null ? Number(ut.distance_m) : 0;
      const sm = ut.start_mileage != null ? Number(ut.start_mileage) : null;
      const em = ut.end_mileage != null ? Number(ut.end_mileage) : null;
      const odoDist = sm != null && em != null ? Math.max(0, em - sm) : 0;
      responseRows.push({
        type: 'RESPONSE',
        call_id: (ut.call_id as number) ?? null,
        call_number: (ut.call_number as string) ?? null,
        start,
        end,
        distance_mi: round1(odoDist > 0 ? odoDist : distM / 1609.34),
        duration_min: ut.duration_s != null ? Math.round(Number(ut.duration_s) / 60) : 0,
        mileage_from: sm,
        mileage_to: em,
        max_mph: ut.max_speed != null ? Math.round(Number(ut.max_speed)) : 0,
        harsh: {
          a: Number(ut.harsh_accel_count ?? 0),
          b: Number(ut.harsh_brake_count ?? 0),
          c: Number(ut.harsh_corner_count ?? 0),
        },
      });
    }
    // Pair a nav_trip_log row with the unit_trips row whose start_time is
    // within ±2 minutes — the two systems segment differently but converge
    // on the same real trip. We mark each unit_trips row as consumed so a
    // late row doesn't double-attach.
    const consumed = new Uint8Array(unitTrips.length);
    const findMileagePair = (navStart: string): { from: number | null; to: number | null } => {
      const target = new Date(navStart.replace(' ', 'T') + (/[zZ]|[+-]\d{2}:?\d{2}$/.test(navStart) ? '' : 'Z')).getTime();
      let bestIdx = -1; let bestDt = Infinity;
      for (let i = 0; i < unitTrips.length; i++) {
        if (consumed[i]) continue;
        const utStart = unitTrips[i].start_time;
        if (!utStart) continue;
        const t = new Date(String(utStart).replace(' ', 'T') + (/[zZ]|[+-]\d{2}:?\d{2}$/.test(String(utStart)) ? '' : 'Z')).getTime();
        const dt = Math.abs(t - target);
        if (dt < bestDt) { bestDt = dt; bestIdx = i; }
      }
      if (bestIdx >= 0 && bestDt <= 120_000) {
        consumed[bestIdx] = 1;
        return { from: unitTrips[bestIdx].start_mileage, to: unitTrips[bestIdx].end_mileage };
      }
      return { from: null, to: null };
    };

    for (const t of navTrips) {
      const start = (t.start_time as string);
      const end = (t.end_time as string) || start;
      const stats = await computeBreadcrumbStats(
        db,
        Number.isFinite(unitId as number) ? (unitId as number) : null,
        Number.isFinite(officerId as number) ? (officerId as number) : null,
        start, end,
      );
      const storedDist = t.distance_miles != null ? Number(t.distance_miles) : 0;
      const distance = stats.distance_miles > 0 ? stats.distance_miles : storedDist;
      const storedMax = t.max_speed_mph != null ? Number(t.max_speed_mph) : 0;
      const maxMph = Math.max(stats.max_mph, storedMax);
      const duration = t.duration_seconds != null
        ? Math.round(Number(t.duration_seconds) / 60)
        : Math.max(0, Math.round((new Date(end.replace(' ', 'T') + 'Z').getTime() - new Date(start.replace(' ', 'T') + 'Z').getTime()) / 60000));
      // Zero-movement blip (0.0 mi, 0 min): a detector artifact, not a trip.
      // Printing it wastes a PS-211 line and reads as a data error.
      if (distance < 0.05 && duration < 1) continue;
      const mileage = findMileagePair(start);
      patrolRows.push({
        type: 'PATROL',
        call_id: null,
        call_number: null,
        start,
        end,
        distance_mi: round1(distance),
        duration_min: Math.max(0, duration),
        mileage_from: mileage.from,
        mileage_to: mileage.to,
        max_mph: Math.round(maxMph),
        harsh: stats.harsh,
      });
    }

    // Any unit_trips PATROL rows that didn't pair with a nav_trip_log entry
    // (the dispatch trip system tracked the drive, nav didn't) still belong
    // in the report so mileage continuity isn't broken.
    // Include them even when no odometer was stamped (the 2026-06 live data
    // has ZERO mileage-stamped patrol unit_trips — the old `continue` made
    // every dispatch-tracked patrol drive vanish). Distance falls back to
    // the GPS-accumulated distance_m; speed/harsh come from the trip engine.
    const toMs = (s: string) => new Date(s.replace(' ', 'T') + (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? '' : 'Z')).getTime();
    const navWindows = patrolRows.map((r) => ({ s: toMs(r.start), e: toMs(r.end) }));
    for (let i = 0; i < unitTrips.length; i++) {
      if (consumed[i]) continue;
      const ut = unitTrips[i];
      if (!ut.start_time) continue;
      const start = ut.start_time;
      const end = ut.end_time || start;
      // Same-drive guard: if this trip's midpoint falls inside a nav trip's
      // window, the drive is already on the report — don't double-count.
      const mid = (toMs(start) + toMs(end)) / 2;
      if (navWindows.some((w) => mid >= w.s && mid <= w.e)) continue;
      const odoDist = ut.start_mileage != null && ut.end_mileage != null
        ? Math.max(0, Number(ut.end_mileage) - Number(ut.start_mileage))
        : 0;
      const gpsDist = ut.distance_m != null ? Number(ut.distance_m) / 1609.34 : 0;
      const duration = ut.duration_s != null
        ? Math.round(Number(ut.duration_s) / 60)
        : Math.max(0, Math.round((new Date(end.replace(' ', 'T') + 'Z').getTime() - new Date(start.replace(' ', 'T') + 'Z').getTime()) / 60000));
      patrolRows.push({
        type: 'PATROL',
        call_id: null,
        call_number: null,
        start,
        end,
        distance_mi: round1(odoDist > 0 ? odoDist : gpsDist),
        duration_min: duration,
        mileage_from: ut.start_mileage,
        mileage_to: ut.end_mileage,
        max_mph: ut.max_speed != null ? Math.round(Number(ut.max_speed)) : 0,
        harsh: {
          a: Number(ut.harsh_accel_count ?? 0),
          b: Number(ut.harsh_brake_count ?? 0),
          c: Number(ut.harsh_corner_count ?? 0),
        },
      });
    }

    // Merge + sort chronologically.
    const rows = [...responseRows, ...patrolRows].sort((a, b) => (a.start < b.start ? -1 : 1));

    // Anchor for the header.
    let anchor: { current_mileage: number; offset_miles: number } | null = null;
    const tryAnchor = async (key: string) => {
      const a = await queryFirst<{ current_mileage: number; offset_miles: number }>(
        db, 'SELECT current_mileage, offset_miles FROM mileage_anchor WHERE scope_key = ?', key,
      );
      if (a) anchor = a;
    };
    if (Number.isFinite(officerId) && Number.isFinite(unitId)) await tryAnchor(scopeKeyOfficerUnit(officerId, unitId));
    if (!anchor && Number.isFinite(officerId)) await tryAnchor(scopeKeyOfficer(officerId));
    if (!anchor && Number.isFinite(unitId)) await tryAnchor(scopeKeyUnit(unitId));

    // Totals.
    const totals = {
      distance_mi: round1(rows.reduce((s, r) => s + (r.distance_mi || 0), 0)),
      duration_min: rows.reduce((s, r) => s + (r.duration_min || 0), 0),
      harsh: {
        a: rows.reduce((s, r) => s + (r.harsh?.a || 0), 0),
        b: rows.reduce((s, r) => s + (r.harsh?.b || 0), 0),
        c: rows.reduce((s, r) => s + (r.harsh?.c || 0), 0),
      },
    };

    return c.json({
      meta: {
        officer_id: Number.isFinite(officerId) ? officerId : null,
        officer_name: officerName,
        unit_id: Number.isFinite(unitId) ? unitId : null,
        unit_call_sign: unitCallSign,
        period: { from, to },
        generated_at: new Date().toISOString(),
        trips_logged: rows.length,
      },
      anchor,
      rows,
      totals,
    });
  } catch (err) {
    log.error('[patrolMileage] GET /trip-log/generate failed', {}, err as Error);
    logErrorToDb(c.env.DB, { severity: 'error', category: 'route', message: (err as Error)?.message ?? String(err), details: { route: 'GET /patrol/trip-log/generate' }, source: 'patrolMileage', statusCode: 500 }, c.executionCtx);
    return dbErrorResponse(c, err, 'Failed to generate trip log');
  }
});

// ════════════════════════════════════════════════════════════
// TRIP MANAGEMENT — full add / edit / delete over both trip
// systems (unit_trips + nav_trip_log) for the Patrol surface.
// Admin/manager/supervisor only; every mutation writes a
// mileage_audit row (entry_table = the trip table) so the PS-211
// audit trail covers manual trip surgery too.
// ════════════════════════════════════════════════════════════

const TRIP_TABLES: Record<string, string> = { unit: 'unit_trips', nav: 'nav_trip_log' };

function requireTripEditor(c: { get: (k: 'user') => unknown }): { id: number; role: string } | null {
  const user = c.get('user') as { id: number; role: string } | undefined;
  if (!user || !['admin', 'manager', 'supervisor'].includes(user.role)) return null;
  return user;
}

async function auditTripChange(
  db: D1Database,
  opts: { table: string; entryId: number; field: string; before: unknown; after: unknown; reason: string; userId: number; officerId?: number | null; unitId?: number | null },
): Promise<void> {
  try {
    await db.prepare(
      `INSERT INTO mileage_audit (scope_type, scope_key, officer_id, unit_id, entry_table, entry_id, field, before_value, after_value, delta, cascade_count, reason, created_by)
       VALUES ('trip', ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, ?)`,
    ).bind(
      `trip:${opts.table}:${opts.entryId}`,
      opts.officerId ?? null, opts.unitId ?? null,
      opts.table, opts.entryId, opts.field,
      opts.before == null ? null : String(opts.before),
      opts.after == null ? null : String(opts.after),
      opts.reason, opts.userId,
    ).run();
  } catch (e) {
    log.warn('[patrolMileage] trip audit write failed (continuing)', { message: (e as Error)?.message });
  }
}

// GET /trips — merged editable trip list for the management table.
pm.get('/trips', async (c) => {
  try {
    const db = getDb(c.env);
    const officerId = c.req.query('officer_id') ? parseInt(c.req.query('officer_id')!, 10) : NaN;
    const unitId = c.req.query('unit_id') ? parseInt(c.req.query('unit_id')!, 10) : NaN;
    const from = c.req.query('from') || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const to = c.req.query('to') || new Date().toISOString().slice(0, 10);

    const utWhere: string[] = ['date(start_time) >= date(?)', 'date(start_time) <= date(?)'];
    const utParams: unknown[] = [from, to];
    if (Number.isFinite(officerId)) { utWhere.push('officer_id = ?'); utParams.push(officerId); }
    if (Number.isFinite(unitId)) { utWhere.push('unit_id = ?'); utParams.push(unitId); }
    const ut = await query<Record<string, unknown>>(db, `
      SELECT id, 'unit' as source, trip_type, status, call_id, call_number,
             officer_id, unit_id, start_time, end_time,
             start_mileage, end_mileage, distance_m, duration_s, max_speed
        FROM unit_trips WHERE ${utWhere.join(' AND ')}
       ORDER BY start_time DESC LIMIT 500`, ...utParams);

    const navWhere: string[] = ['date(start_time) >= date(?)', 'date(start_time) <= date(?)'];
    const navParams: unknown[] = [from, to];
    if (Number.isFinite(officerId)) { navWhere.push('officer_id = ?'); navParams.push(officerId); }
    if (Number.isFinite(unitId)) { navWhere.push('unit_id = ?'); navParams.push(unitId); }
    const nav = await query<Record<string, unknown>>(db, `
      SELECT id, 'nav' as source, 'patrol' as trip_type, status, NULL as call_id, NULL as call_number,
             officer_id, unit_id, start_time, end_time,
             NULL as start_mileage, NULL as end_mileage,
             distance_miles * 1609.34 as distance_m, duration_seconds as duration_s,
             max_speed_mph as max_speed
        FROM nav_trip_log WHERE ${navWhere.join(' AND ')}
       ORDER BY start_time DESC LIMIT 500`, ...navParams);

    const trips = [...ut, ...nav]
      .map((t) => ({ ...t, distance_mi: t.distance_m != null ? Math.round((Number(t.distance_m) / 1609.34) * 10) / 10 : null } as Record<string, unknown>))
      .sort((a, b) => (String(a.start_time) < String(b.start_time) ? 1 : -1));
    return c.json({ trips });
  } catch (err) {
    log.error('[patrolMileage] GET /trips failed', {}, err as Error);
    logErrorToDb(c.env.DB, { severity: 'error', category: 'route', message: (err as Error)?.message ?? String(err), details: { route: 'GET /patrol/trips' }, source: 'patrolMileage', statusCode: 500 }, c.executionCtx);
    return dbErrorResponse(c, err, 'Failed');
  }
});

// POST /trips — manually add a trip (always unit_trips; close_reason 'manual').
pm.post('/trips', async (c) => {
  try {
    const user = requireTripEditor(c);
    if (!user) return c.json({ error: 'Admin / manager / supervisor only', code: 'FORBIDDEN' }, 403);
    const db = getDb(c.env);
    const body = await c.req.json<Record<string, unknown>>();
    if (!body.start_time) return c.json({ error: 'start_time required' }, 400);
    if (!body.reason || !String(body.reason).trim()) return c.json({ error: 'reason required for the audit trail' }, 400);
    const tripType = body.trip_type === 'call_response' ? 'call_response' : 'patrol';
    const distanceM = body.distance_mi != null ? Math.round(Number(body.distance_mi) * 1609.34) : null;
    const result = await db.prepare(`
      INSERT INTO unit_trips (unit_id, officer_id, trip_type, status, call_number,
                              start_time, end_time, start_mileage, end_mileage,
                              distance_m, duration_s, close_reason, created_at, updated_at)
      VALUES (?,?,?,'closed',?,?,?,?,?,?,?, 'manual', datetime('now'), datetime('now'))`,
    ).bind(
      body.unit_id ?? null, body.officer_id ?? null, tripType, body.call_number ?? null,
      body.start_time, body.end_time ?? body.start_time,
      body.start_mileage ?? null, body.end_mileage ?? null,
      distanceM,
      body.duration_s ?? null,
    ).run();
    const id = result.meta.last_row_id as number;
    await auditTripChange(db, {
      table: 'unit_trips', entryId: id, field: 'created',
      before: null, after: `manual ${tripType} trip`, reason: String(body.reason).trim(),
      userId: user.id, officerId: (body.officer_id as number) ?? null, unitId: (body.unit_id as number) ?? null,
    });
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM unit_trips WHERE id = ?', id);
    return c.json({ success: true, trip: created }, 201);
  } catch (err) {
    log.error('[patrolMileage] POST /trips failed', {}, err as Error);
    logErrorToDb(c.env.DB, { severity: 'error', category: 'route', message: (err as Error)?.message ?? String(err), details: { route: 'POST /patrol/trips' }, source: 'patrolMileage', statusCode: 500 }, c.executionCtx);
    return dbErrorResponse(c, err, 'Failed');
  }
});

// PUT /trips/:source/:id — edit allowlisted fields on either trip table.
pm.put('/trips/:source/:id', async (c) => {
  try {
    const user = requireTripEditor(c);
    if (!user) return c.json({ error: 'Admin / manager / supervisor only', code: 'FORBIDDEN' }, 403);
    const table = TRIP_TABLES[c.req.param('source')];
    const id = parseInt(c.req.param('id'), 10);
    if (!table || !Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid source or id' }, 400);
    const db = getDb(c.env);
    const body = await c.req.json<Record<string, unknown>>();
    if (!body.reason || !String(body.reason).trim()) return c.json({ error: 'reason required for the audit trail' }, 400);
    const reason = String(body.reason).trim();

    const ALLOW: Record<string, string[]> = {
      unit_trips: ['trip_type', 'call_number', 'start_time', 'end_time', 'start_mileage', 'end_mileage', 'distance_m', 'duration_s', 'max_speed'],
      nav_trip_log: ['start_time', 'end_time', 'distance_miles', 'duration_seconds', 'max_speed_mph', 'purpose', 'notes'],
    };
    // Client convenience: accept distance_mi and convert for unit_trips.
    if (table === 'unit_trips' && body.distance_mi != null && body.distance_m === undefined) {
      body.distance_m = Math.round(Number(body.distance_mi) * 1609.34);
    }
    if (table === 'nav_trip_log' && body.distance_mi != null && body.distance_miles === undefined) {
      body.distance_miles = Number(body.distance_mi);
    }
    const before = await queryFirst<Record<string, unknown>>(db, `SELECT * FROM ${table} WHERE id = ?`, id);
    if (!before) return c.json({ error: 'Trip not found' }, 404);

    const sets: string[] = []; const binds: unknown[] = []; const changed: string[] = [];
    for (const col of ALLOW[table]) {
      if (Object.prototype.hasOwnProperty.call(body, col)) {
        sets.push(`${col} = ?`);
        binds.push(body[col] === '' ? null : body[col]);
        changed.push(col);
      }
    }
    if (sets.length === 0) return c.json({ error: 'No editable fields in body' }, 400);
    if (table === 'unit_trips') sets.push(`updated_at = datetime('now')`);
    binds.push(id);
    await db.prepare(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();

    for (const col of changed) {
      await auditTripChange(db, {
        table, entryId: id, field: col,
        before: before[col], after: body[col], reason,
        userId: user.id, officerId: (before.officer_id as number) ?? null, unitId: (before.unit_id as number) ?? null,
      });
    }
    const updated = await queryFirst<Record<string, unknown>>(db, `SELECT * FROM ${table} WHERE id = ?`, id);
    return c.json({ success: true, trip: updated });
  } catch (err) {
    log.error('[patrolMileage] PUT /trips/:source/:id failed', {}, err as Error);
    logErrorToDb(c.env.DB, { severity: 'error', category: 'route', message: (err as Error)?.message ?? String(err), details: { route: 'PUT /patrol/trips/:source/:id' }, source: 'patrolMileage', statusCode: 500 }, c.executionCtx);
    return dbErrorResponse(c, err, 'Failed');
  }
});

// DELETE /trips/:source/:id — remove a trip row (audited).
pm.delete('/trips/:source/:id', async (c) => {
  try {
    const user = requireTripEditor(c);
    if (!user) return c.json({ error: 'Admin / manager / supervisor only', code: 'FORBIDDEN' }, 403);
    const table = TRIP_TABLES[c.req.param('source')];
    const id = parseInt(c.req.param('id'), 10);
    if (!table || !Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid source or id' }, 400);
    const reason = (c.req.query('reason') || '').trim();
    if (!reason) return c.json({ error: 'reason query param required for the audit trail' }, 400);
    const db = getDb(c.env);
    const before = await queryFirst<Record<string, unknown>>(db, `SELECT * FROM ${table} WHERE id = ?`, id);
    if (!before) return c.json({ error: 'Trip not found' }, 404);
    await db.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id).run();
    await auditTripChange(db, {
      table, entryId: id, field: 'deleted',
      before: `${before.trip_type ?? 'patrol'} ${before.start_time}→${before.end_time} ${before.distance_m ?? before.distance_miles ?? ''}`,
      after: null, reason,
      userId: user.id, officerId: (before.officer_id as number) ?? null, unitId: (before.unit_id as number) ?? null,
    });
    return c.json({ success: true });
  } catch (err) {
    log.error('[patrolMileage] DELETE /trips/:source/:id failed', {}, err as Error);
    logErrorToDb(c.env.DB, { severity: 'error', category: 'route', message: (err as Error)?.message ?? String(err), details: { route: 'DELETE /patrol/trips/:source/:id' }, source: 'patrolMileage', statusCode: 500 }, c.executionCtx);
    return dbErrorResponse(c, err, 'Failed');
  }
});

// POST /mileage/backfill-patrol-trips — unified-chain rebuild for the PATROL
// rows whose odometer disagrees with the CFS chain. Walks every mileage-
// bearing event in (officer, unit) scope (CFS calls + closed PATROL trips)
// in time order, treating CFS rows as AUTHORITATIVE (observed odometer
// reads, never re-stamped) and re-deriving PATROL rows from whatever event
// came immediately before — CFS row's ending_mileage if the prior event was
// a call, the prior PATROL row's end if patrol-on-patrol. Outlier guard
// (>75 mi single-trip distance) leaves the row blank instead of poisoning.
//
// Why this replaces the first-pass per-PATROL backfill (PR #1464): that one
// walked PATROL rows in isolation, seeded from mileage_anchor (which is only
// written by admin /mileage/fix), so the PATROL chain ended up parallel to
// the CFS chain instead of interleaved with it — every PATROL row showed
// up ~60 mi behind on prod's Mileage Audit (Christopher's screenshot, the
// trigger for this PR). The unified walk fixes that by reading the same
// observed odometer the CFS path writes.
//
// CFS rows are NEVER auto-edited — a wrong CFS starting_mileage means the
// officer mis-stamped at enroute, and that's what the per-row Fix tool +
// /mileage/fix endpoint exist for.
//
// Body: { officer_id?, unit_id?, from?, to?, reason }
pm.post('/mileage/backfill-patrol-trips', async (c) => {
  try {
    const user = requireTripEditor(c);
    if (!user) return c.json({ error: 'Admin / manager / supervisor only', code: 'FORBIDDEN' }, 403);
    const db = getDb(c.env);
    const body = await c.req.json<Record<string, unknown>>();
    if (!body.reason || !String(body.reason).trim()) {
      return c.json({ error: 'reason required for the audit trail' }, 400);
    }
    const reason = String(body.reason).trim();
    const officerId = body.officer_id != null ? Number(body.officer_id) : null;
    const unitId = body.unit_id != null ? Number(body.unit_id) : null;
    const from = typeof body.from === 'string' ? body.from : null;
    const to = typeof body.to === 'string' ? body.to : null;

    // ── 1. Pull every PATROL trip in scope/window that could be rewritten ──
    const trWhere: string[] = [
      "status = 'closed'", "trip_type = 'patrol'",
      'distance_m IS NOT NULL', 'distance_m > 0',
      'officer_id IS NOT NULL', 'unit_id IS NOT NULL',
    ];
    const trParams: unknown[] = [];
    if (officerId != null && Number.isFinite(officerId)) { trWhere.push('officer_id = ?'); trParams.push(officerId); }
    if (unitId != null && Number.isFinite(unitId)) { trWhere.push('unit_id = ?'); trParams.push(unitId); }
    if (from) { trWhere.push('date(start_time) >= date(?)'); trParams.push(from); }
    if (to) { trWhere.push('date(start_time) <= date(?)'); trParams.push(to); }
    const patrolRows = await query<{
      id: number; officer_id: number; unit_id: number; vehicle_id: number | null;
      start_time: string; end_time: string | null;
      start_mileage: number | null; end_mileage: number | null;
      distance_m: number;
    }>(db, `
      SELECT id, officer_id, unit_id, vehicle_id, start_time, end_time,
             start_mileage, end_mileage, distance_m
        FROM unit_trips WHERE ${trWhere.join(' AND ')}
       ORDER BY officer_id, unit_id, start_time ASC
       LIMIT 2000
    `, ...trParams);

    // ── 2. Pull every CFS row in scope/window with observed odometer ──
    // We need these to anchor the PATROL chain: each PATROL trip's start
    // should equal the immediately preceding event's end, and a CFS row's
    // ending_mileage is an observed odometer reading we trust.
    const cfWhere: string[] = [
      '(c.starting_mileage IS NOT NULL OR c.ending_mileage IS NOT NULL)',
    ];
    const cfParams: unknown[] = [];
    if (unitId != null && Number.isFinite(unitId)) {
      cfWhere.push("(SELECT COUNT(*) FROM json_each(c.assigned_unit_ids) WHERE CAST(value AS TEXT) = ?) > 0");
      cfParams.push(String(unitId));
    }
    if (from) { cfWhere.push("COALESCE(c.cleared_at, c.closed_at, c.dispatched_at) >= ?"); cfParams.push(from); }
    if (to) { cfWhere.push("COALESCE(c.cleared_at, c.closed_at, c.dispatched_at) <= ?"); cfParams.push(to + ' 23:59:59'); }
    const cfsRows = await query<{
      id: number; starting_mileage: number | null; ending_mileage: number | null;
      enroute_at: string | null; onscene_at: string | null;
      cleared_at: string | null; closed_at: string | null; dispatched_at: string | null;
      assigned_unit_ids: string | null;
    }>(db, `
      SELECT c.id, c.starting_mileage, c.ending_mileage,
             c.enroute_at, c.onscene_at, c.cleared_at, c.closed_at, c.dispatched_at,
             c.assigned_unit_ids
        FROM calls_for_service c WHERE ${cfWhere.join(' AND ')}
       ORDER BY COALESCE(c.dispatched_at, c.enroute_at) ASC
       LIMIT 2000
    `, ...cfParams);

    // ── 3. Bucket events per (officer, unit) and merge by time ──
    // PATROL rows carry their own officer/unit. CFS rows have unit_id buried
    // in assigned_unit_ids; we resolve officer_id from units.officer_id.
    type Event = (
      | { kind: 'patrol'; id: number; officer_id: number; unit_id: number; t: string;
          start_mileage: number | null; end_mileage: number | null; distance_m: number }
      | { kind: 'cfs'; id: number; officer_id: number; unit_id: number; t: string;
          starting_mileage: number | null; ending_mileage: number | null }
    );
    const unitOfficerCache = new Map<number, number | null>();
    const resolveOfficer = async (uId: number): Promise<number | null> => {
      if (unitOfficerCache.has(uId)) return unitOfficerCache.get(uId)!;
      const row = await queryFirst<{ officer_id: number | null }>(
        db, 'SELECT officer_id FROM units WHERE id = ?', uId);
      const v = row?.officer_id ?? null;
      unitOfficerCache.set(uId, v);
      return v;
    };
    const buckets = new Map<string, Event[]>();
    const bucketPush = (key: string, ev: Event) => {
      const arr = buckets.get(key) ?? [];
      arr.push(ev);
      buckets.set(key, arr);
    };

    for (const p of patrolRows) {
      bucketPush(`${p.officer_id}:${p.unit_id}`, {
        kind: 'patrol', id: p.id, officer_id: p.officer_id, unit_id: p.unit_id,
        t: p.start_time, start_mileage: p.start_mileage, end_mileage: p.end_mileage,
        distance_m: p.distance_m,
      });
    }
    for (const r of cfsRows) {
      let assigned: number[] = [];
      try { assigned = JSON.parse(r.assigned_unit_ids || '[]'); } catch { /* skip */ }
      if (!assigned.length) continue;
      const uId = assigned[0];
      if (unitId != null && Number.isFinite(unitId) && uId !== unitId) continue;
      const oId = await resolveOfficer(uId);
      if (oId == null) continue;
      if (officerId != null && Number.isFinite(officerId) && oId !== officerId) continue;
      const t = r.enroute_at || r.dispatched_at || r.onscene_at || r.cleared_at || r.closed_at;
      if (!t) continue;
      bucketPush(`${oId}:${uId}`, {
        kind: 'cfs', id: r.id, officer_id: oId, unit_id: uId, t,
        starting_mileage: r.starting_mileage, ending_mileage: r.ending_mileage,
      });
    }

    // ── 4. Walk each bucket in time order, re-stamp PATROL to match chain ──
    let restamped = 0, skipped = 0, outliers = 0, alreadyConsistent = 0;
    const errors: string[] = [];

    for (const [, events] of buckets) {
      events.sort((a, b) => a.t.localeCompare(b.t));
      let prevEnd: number | null = null;

      for (const ev of events) {
        if (ev.kind === 'cfs') {
          // CFS: authoritative — DO NOT REWRITE. Advance the running cursor.
          const observed = ev.ending_mileage ?? ev.starting_mileage;
          if (observed != null && Number.isFinite(observed)) prevEnd = observed;
          continue;
        }

        // PATROL row: re-derive start + end from prevEnd. Seed from the
        // mileage_anchor only when there is no prior chain event at all.
        let seedStart = prevEnd;
        if (seedStart == null) {
          const suggestion = await getSuggestedMileage(db, ev.officer_id, ev.unit_id);
          if (suggestion) seedStart = suggestion.suggested_mileage;
        }
        if (seedStart == null) { skipped++; continue; }

        const derived = deriveEndMileage(seedStart, ev.distance_m);
        if (!derived) {
          outliers++;
          // Don't advance — next row should re-anchor.
          prevEnd = null;
          continue;
        }

        const newStart = Math.round(seedStart * 10) / 10;
        const newEnd = derived.endMileage;
        const startChanged = ev.start_mileage == null
          ? true
          : Math.abs(Number(ev.start_mileage) - newStart) >= 0.1;
        const endChanged = ev.end_mileage == null
          ? true
          : Math.abs(Number(ev.end_mileage) - newEnd) >= 0.1;

        if (!startChanged && !endChanged) { alreadyConsistent++; prevEnd = newEnd; continue; }

        try {
          await db.prepare(
            `UPDATE unit_trips SET start_mileage = ?, end_mileage = ?, updated_at = datetime(\'now\') WHERE id = ?`,
          ).bind(newStart, newEnd, ev.id).run();
          if (startChanged) {
            await auditTripChange(db, {
              table: 'unit_trips', entryId: ev.id, field: 'start_mileage',
              before: ev.start_mileage, after: newStart, reason: `chain-rebuild: ${reason}`,
              userId: user.id, officerId: ev.officer_id, unitId: ev.unit_id,
            });
          }
          if (endChanged) {
            await auditTripChange(db, {
              table: 'unit_trips', entryId: ev.id, field: 'end_mileage',
              before: ev.end_mileage, after: newEnd, reason: `chain-rebuild: ${reason}`,
              userId: user.id, officerId: ev.officer_id, unitId: ev.unit_id,
            });
          }
          restamped++;
          prevEnd = newEnd;
        } catch (e) {
          errors.push(`trip ${ev.id}: ${(e as Error)?.message}`);
        }
      }
    }

    return c.json({
      success: true,
      examined_patrol: patrolRows.length,
      examined_cfs: cfsRows.length,
      restamped,
      already_consistent: alreadyConsistent,
      skipped,
      outliers,
      errors: errors.slice(0, 20),
    });
  } catch (err) {
    log.error('[patrolMileage] POST /mileage/backfill-patrol-trips failed', {}, err as Error);
    logErrorToDb(c.env.DB, { severity: 'error', category: 'route', message: (err as Error)?.message ?? String(err), details: { route: 'POST /patrol/mileage/backfill-patrol-trips' }, source: 'patrolMileage', statusCode: 500 }, c.executionCtx);
    return dbErrorResponse(c, err, 'Failed');
  }
});

// POST /mileage/auto-fix-gaps — close remaining +/- gaps in the unified
// chain after Rebuild has already aligned existing PATROL rows. Rebuild
// guarantees PATROL chains forward from its prior event; it does NOT
// guarantee the LAST PATROL in a span ends exactly at the NEXT CFS's
// starting_mileage — so gaps persist when an officer drove farther than
// their patrol GPS captured (positive gap) or the CFS row's odometer was
// entered lower than the patrol chain expected (negative gap).
//
// Strategy per consecutive event pair (A, B):
//   • |gap| < TOL_MI (0.1)         : skip — rounding noise.
//   • gap > 0, PATROL between(A,B) : chain them forward + stretch the
//                                     LAST patrol's end_mileage up to
//                                     B's starting_mileage. The residual
//                                     becomes part of that last patrol's
//                                     recorded distance.
//   • gap > 0, NO PATROL between   : synthesize ONE patrol row spanning
//                                     A.end → B.start with
//                                     close_reason='gap_fill_auto', so
//                                     the chain is continuous. Capped at
//                                     SYNTH_CAP_MI (100 mi) — anything
//                                     bigger is corrupted data and gets
//                                     reported instead of fabricated.
//   • gap < 0, PATROL between(A,B) : contract the LAST patrol's end down
//                                     to B's starting_mileage. CFS
//                                     observation wins; patrol GPS
//                                     over-recorded.
//   • gap < 0, NO PATROL between   : unbridgeable — requires a manual
//                                     /mileage/fix on one of the two
//                                     CFS rows. Reported, not fixed.
//
// CFS row mileages are NEVER auto-edited (same authority rule as
// Rebuild). Every change writes through auditTripChange.
//
// Body: { officer_id?, unit_id?, from?, to?, reason }
pm.post('/mileage/auto-fix-gaps', async (c) => {
  try {
    const user = requireTripEditor(c);
    if (!user) return c.json({ error: 'Admin / manager / supervisor only', code: 'FORBIDDEN' }, 403);
    const db = getDb(c.env);
    const body = await c.req.json<Record<string, unknown>>();
    if (!body.reason || !String(body.reason).trim()) {
      return c.json({ error: 'reason required for the audit trail' }, 400);
    }
    const reason = String(body.reason).trim();
    const officerId = body.officer_id != null ? Number(body.officer_id) : null;
    const unitId = body.unit_id != null ? Number(body.unit_id) : null;
    const from = typeof body.from === 'string' ? body.from : null;
    const to = typeof body.to === 'string' ? body.to : null;

    const TOL_MI = 0.1;
    const SYNTH_CAP_MI = 100;

    // ── 1. Pull PATROL trips + CFS rows in scope ───────────────────
    const trWhere: string[] = [
      "status = 'closed'", "trip_type = 'patrol'",
      'officer_id IS NOT NULL', 'unit_id IS NOT NULL',
    ];
    const trParams: unknown[] = [];
    if (officerId != null && Number.isFinite(officerId)) { trWhere.push('officer_id = ?'); trParams.push(officerId); }
    if (unitId != null && Number.isFinite(unitId)) { trWhere.push('unit_id = ?'); trParams.push(unitId); }
    if (from) { trWhere.push('date(start_time) >= date(?)'); trParams.push(from); }
    if (to) { trWhere.push('date(start_time) <= date(?)'); trParams.push(to); }
    const patrolRows = await query<{
      id: number; officer_id: number; unit_id: number; vehicle_id: number | null;
      start_time: string; end_time: string | null;
      start_mileage: number | null; end_mileage: number | null;
      distance_m: number | null;
    }>(db, `
      SELECT id, officer_id, unit_id, vehicle_id, start_time, end_time,
             start_mileage, end_mileage, distance_m
        FROM unit_trips WHERE ${trWhere.join(' AND ')}
       ORDER BY officer_id, unit_id, start_time ASC
       LIMIT 2000
    `, ...trParams);

    const cfWhere: string[] = [
      '(c.starting_mileage IS NOT NULL OR c.ending_mileage IS NOT NULL)',
    ];
    const cfParams: unknown[] = [];
    if (unitId != null && Number.isFinite(unitId)) {
      cfWhere.push("(SELECT COUNT(*) FROM json_each(c.assigned_unit_ids) WHERE CAST(value AS TEXT) = ?) > 0");
      cfParams.push(String(unitId));
    }
    if (from) { cfWhere.push("COALESCE(c.cleared_at, c.closed_at, c.dispatched_at) >= ?"); cfParams.push(from); }
    if (to) { cfWhere.push("COALESCE(c.cleared_at, c.closed_at, c.dispatched_at) <= ?"); cfParams.push(to + ' 23:59:59'); }
    const cfsRows = await query<{
      id: number; starting_mileage: number | null; ending_mileage: number | null;
      enroute_at: string | null; onscene_at: string | null;
      cleared_at: string | null; closed_at: string | null; dispatched_at: string | null;
      assigned_unit_ids: string | null;
    }>(db, `
      SELECT c.id, c.starting_mileage, c.ending_mileage,
             c.enroute_at, c.onscene_at, c.cleared_at, c.closed_at, c.dispatched_at,
             c.assigned_unit_ids
        FROM calls_for_service c WHERE ${cfWhere.join(' AND ')}
       ORDER BY COALESCE(c.dispatched_at, c.enroute_at) ASC
       LIMIT 2000
    `, ...cfParams);

    // ── 2. Bucket by (officer, unit) + sort by time ────────────────
    type Event =
      | { kind: 'patrol'; id: number; officer_id: number; unit_id: number;
          start: string; end: string; start_mileage: number | null;
          end_mileage: number | null; distance_m: number | null }
      | { kind: 'cfs'; id: number; officer_id: number; unit_id: number;
          start: string; end: string; starting_mileage: number | null;
          ending_mileage: number | null };
    const unitOfficerCache = new Map<number, number | null>();
    const resolveOfficer = async (uId: number): Promise<number | null> => {
      if (unitOfficerCache.has(uId)) return unitOfficerCache.get(uId)!;
      const row = await queryFirst<{ officer_id: number | null }>(db, 'SELECT officer_id FROM units WHERE id = ?', uId);
      const v = row?.officer_id ?? null;
      unitOfficerCache.set(uId, v);
      return v;
    };
    const buckets = new Map<string, Event[]>();
    const bucketPush = (key: string, ev: Event) => {
      const arr = buckets.get(key) ?? [];
      arr.push(ev);
      buckets.set(key, arr);
    };

    for (const p of patrolRows) {
      bucketPush(`${p.officer_id}:${p.unit_id}`, {
        kind: 'patrol', id: p.id, officer_id: p.officer_id, unit_id: p.unit_id,
        start: p.start_time, end: p.end_time ?? p.start_time,
        start_mileage: p.start_mileage, end_mileage: p.end_mileage,
        distance_m: p.distance_m,
      });
    }
    for (const r of cfsRows) {
      let assigned: number[] = [];
      try { assigned = JSON.parse(r.assigned_unit_ids || '[]'); } catch { /* skip */ }
      if (!assigned.length) continue;
      const uId = assigned[0];
      if (unitId != null && Number.isFinite(unitId) && uId !== unitId) continue;
      const oId = await resolveOfficer(uId);
      if (oId == null) continue;
      if (officerId != null && Number.isFinite(officerId) && oId !== officerId) continue;
      const t = r.enroute_at || r.dispatched_at || r.onscene_at || r.cleared_at || r.closed_at;
      if (!t) continue;
      bucketPush(`${oId}:${uId}`, {
        kind: 'cfs', id: r.id, officer_id: oId, unit_id: uId,
        start: t, end: r.cleared_at || r.closed_at || t,
        starting_mileage: r.starting_mileage, ending_mileage: r.ending_mileage,
      });
    }

    // ── 3. Walk pairs, build fix proposals ─────────────────────────
    let bridgedExisting = 0, synthesized = 0, contractedNegative = 0;
    let unbridgeableNegative = 0, oversizedPositive = 0;
    const errors: string[] = [];
    const unbridgeable: Array<{ scope: string; between_cfs_ids: [number, number]; gap_mi: number }> = [];

    for (const [scope, events] of buckets) {
      events.sort((a, b) => a.start.localeCompare(b.start));

      for (let i = 1; i < events.length; i++) {
        const prev = events[i - 1];
        const cur = events[i];

        const prevEnd = prev.kind === 'cfs' ? prev.ending_mileage : prev.end_mileage;
        const curStart = cur.kind === 'cfs' ? cur.starting_mileage : cur.start_mileage;
        if (prevEnd == null || curStart == null) continue;

        const gap = Number(curStart) - Number(prevEnd);
        if (Math.abs(gap) < TOL_MI) continue;

        const closingAtCfs = cur.kind === 'cfs';
        const startingFromCfs = prev.kind === 'cfs';

        if (gap > 0) {
          if (cur.kind === 'patrol') {
            // The current row IS a patrol — re-stamp it forward.
            const newStart = Math.round(Number(prevEnd) * 10) / 10;
            const distanceMi = cur.distance_m != null && cur.distance_m > 0
              ? (cur.distance_m / 1609.344) : gap;
            const newEnd = Math.round((newStart + Math.max(distanceMi, gap)) * 10) / 10;
            try {
              await db.prepare(
                `UPDATE unit_trips SET start_mileage = ?, end_mileage = ?, updated_at = datetime(\'now\') WHERE id = ?`,
              ).bind(newStart, newEnd, cur.id).run();
              await auditTripChange(db, {
                table: 'unit_trips', entryId: cur.id, field: 'start_mileage',
                before: cur.start_mileage, after: newStart, reason: `auto-fix-gap (+${gap.toFixed(1)} mi): ${reason}`,
                userId: user.id, officerId: cur.officer_id, unitId: cur.unit_id,
              });
              if (cur.end_mileage !== newEnd) {
                await auditTripChange(db, {
                  table: 'unit_trips', entryId: cur.id, field: 'end_mileage',
                  before: cur.end_mileage, after: newEnd, reason: `auto-fix-gap (stretched +${(newEnd - newStart - (distanceMi)).toFixed(1)} mi to bridge): ${reason}`,
                  userId: user.id, officerId: cur.officer_id, unitId: cur.unit_id,
                });
              }
              cur.start_mileage = newStart;
              cur.end_mileage = newEnd;
              bridgedExisting++;
            } catch (e) { errors.push(`patrol ${cur.id}: ${(e as Error)?.message}`); }
          } else if (closingAtCfs && startingFromCfs) {
            // Two CFS rows back-to-back with no PATROL between — synthesize one
            if (gap > SYNTH_CAP_MI) {
              oversizedPositive++;
              continue;
            }
            const synthStart = new Date(Date.parse(prev.end.replace(' ', 'T') + 'Z') + 60_000).toISOString().slice(0, 19).replace('T', ' ');
            const synthEnd = new Date(Date.parse(cur.start.replace(' ', 'T') + 'Z') - 60_000).toISOString().slice(0, 19).replace('T', ' ');
            const startMi = Math.round(Number(prevEnd) * 10) / 10;
            const endMi = Math.round(Number(curStart) * 10) / 10;
            try {
              const ins = await db.prepare(
                `INSERT INTO unit_trips (unit_id, officer_id, trip_type, status,
                    start_time, end_time, start_mileage, end_mileage,
                    distance_m, close_reason, created_at, updated_at)
                  VALUES (?, ?, 'patrol', 'closed', ?, ?, ?, ?, ?, 'gap_fill_auto', datetime('now'), datetime('now'))`,
              ).bind(
                cur.unit_id, cur.officer_id,
                synthStart, synthEnd, startMi, endMi,
                Math.round(gap * 1609.344),
              ).run();
              const newId = (ins.meta as { last_row_id?: number })?.last_row_id ?? 0;
              await auditTripChange(db, {
                table: 'unit_trips', entryId: newId, field: 'created',
                before: null, after: `gap_fill_auto patrol ${synthStart}→${synthEnd} (${gap.toFixed(1)} mi between CFS ${prev.id} and CFS ${cur.id})`,
                reason: `auto-fix-gap synthesis: ${reason}`,
                userId: user.id, officerId: cur.officer_id, unitId: cur.unit_id,
              });
              synthesized++;
            } catch (e) { errors.push(`synth gap ${prev.id}->${cur.id}: ${(e as Error)?.message}`); }
          }
        } else {
          // Negative gap: odometer went backward
          if (prev.kind === 'patrol') {
            // Contract the prior patrol's end_mileage to match cur's start
            const newEnd = Math.round(Number(curStart) * 10) / 10;
            try {
              await db.prepare(
                `UPDATE unit_trips SET end_mileage = ?, updated_at = datetime(\'now\') WHERE id = ?`,
              ).bind(newEnd, prev.id).run();
              await auditTripChange(db, {
                table: 'unit_trips', entryId: prev.id, field: 'end_mileage',
                before: prev.end_mileage, after: newEnd,
                reason: `auto-fix-gap (contracted ${gap.toFixed(1)} mi to match CFS observation): ${reason}`,
                userId: user.id, officerId: prev.officer_id, unitId: prev.unit_id,
              });
              prev.end_mileage = newEnd;
              contractedNegative++;
            } catch (e) { errors.push(`patrol ${prev.id}: ${(e as Error)?.message}`); }
          } else {
            // CFS-to-CFS negative gap: unbridgeable without human judgment.
            unbridgeableNegative++;
            unbridgeable.push({ scope, between_cfs_ids: [prev.id, cur.id], gap_mi: Math.round(gap * 10) / 10 });
          }
        }
      }
    }

    return c.json({
      success: true,
      bridged_existing: bridgedExisting,
      synthesized,
      contracted_negative: contractedNegative,
      unbridgeable_negative: unbridgeableNegative,
      oversized_positive: oversizedPositive,
      tolerance_mi: TOL_MI,
      synthesis_cap_mi: SYNTH_CAP_MI,
      unbridgeable: unbridgeable.slice(0, 20),
      errors: errors.slice(0, 20),
    });
  } catch (err) {
    log.error('[patrolMileage] POST /mileage/auto-fix-gaps failed', {}, err as Error);
    logErrorToDb(c.env.DB, { severity: 'error', category: 'route', message: (err as Error)?.message ?? String(err), details: { route: 'POST /patrol/mileage/auto-fix-gaps' }, source: 'patrolMileage', statusCode: 500 }, c.executionCtx);
    return dbErrorResponse(c, err, 'Failed');
  }
});

// POST /trips/discard-zero-mile — admin sweep that deletes closed PATROL
// trips whose recorded distance is below the noise threshold (≤ 0.5 mi,
// matching the live tripStore filter). Catches both literal-zero rows AND
// the 0.1/0.3/0.5-mi micro-shuffles (parking-lot crawl, building-to-
// building reposition) that aren't real patrol travel for audit/billing
// purposes. URL kept as `discard-zero-mile` for back-compat with the
// already-deployed Pages bundle that calls it — semantics widened to
// match the live tripStore noise filter. Each delete is audited.
//
// Body: { officer_id?, unit_id?, from?, to?, reason }
pm.post('/trips/discard-zero-mile', async (c) => {
  try {
    const user = requireTripEditor(c);
    if (!user) return c.json({ error: 'Admin / manager / supervisor only', code: 'FORBIDDEN' }, 403);
    const db = getDb(c.env);
    const body = await c.req.json<Record<string, unknown>>();
    if (!body.reason || !String(body.reason).trim()) {
      return c.json({ error: 'reason required for the audit trail' }, 400);
    }
    const reason = String(body.reason).trim();
    const officerId = body.officer_id != null ? Number(body.officer_id) : null;
    const unitId = body.unit_id != null ? Number(body.unit_id) : null;
    const from = typeof body.from === 'string' ? body.from : null;
    const to = typeof body.to === 'string' ? body.to : null;

    // 805 m = 0.5 mi (same constant the tripStore noise filter uses; kept
    // inline here so the endpoint stays a single file's edit if the
    // threshold ever changes again).
    const HALF_MILE_METERS = 805;
    const where: string[] = [
      "status = 'closed'", "trip_type = 'patrol'",
      '(distance_m IS NULL OR distance_m <= ?)',
    ];
    const params: unknown[] = [HALF_MILE_METERS];
    if (officerId != null && Number.isFinite(officerId)) { where.push('officer_id = ?'); params.push(officerId); }
    if (unitId != null && Number.isFinite(unitId)) { where.push('unit_id = ?'); params.push(unitId); }
    if (from) { where.push('date(start_time) >= date(?)'); params.push(from); }
    if (to) { where.push('date(start_time) <= date(?)'); params.push(to); }

    const candidates = await query<{ id: number; officer_id: number | null; unit_id: number | null; start_time: string; end_time: string | null; distance_m: number | null }>(
      db, `SELECT id, officer_id, unit_id, start_time, end_time, distance_m FROM unit_trips WHERE ${where.join(' AND ')} LIMIT 1000`,
      ...params,
    );

    let deleted = 0;
    const errors: string[] = [];
    for (const row of candidates) {
      try {
        await db.prepare(`DELETE FROM unit_trips WHERE id = ?`).bind(row.id).run();
        await auditTripChange(db, {
          table: 'unit_trips', entryId: row.id, field: 'deleted',
          before: `noise: patrol ${row.start_time}→${row.end_time ?? '?'} distance_m=${row.distance_m ?? 'null'}`,
          after: null, reason: `discard-≤0.5mi: ${reason}`,
          userId: user.id, officerId: row.officer_id, unitId: row.unit_id,
        });
        deleted++;
      } catch (e) {
        errors.push(`trip ${row.id}: ${(e as Error)?.message}`);
      }
    }

    return c.json({ success: true, examined: candidates.length, deleted, threshold_mi: 0.5, errors: errors.slice(0, 20) });
  } catch (err) {
    log.error('[patrolMileage] POST /trips/discard-zero-mile failed', {}, err as Error);
    logErrorToDb(c.env.DB, { severity: 'error', category: 'route', message: (err as Error)?.message ?? String(err), details: { route: 'POST /patrol/trips/discard-zero-mile' }, source: 'patrolMileage', statusCode: 500 }, c.executionCtx);
    return dbErrorResponse(c, err, 'Failed');
  }
});

interface TripLogRow {
  type: 'PATROL' | 'RESPONSE';
  call_id: number | null;
  call_number: string | null;
  start: string;
  end: string;
  distance_mi: number;
  duration_min: number;
  mileage_from: number | null;
  mileage_to: number | null;
  max_mph: number;
  harsh: { a: number; b: number; c: number };
}

interface BreadcrumbStats {
  point_count: number;
  max_mph: number;
  distance_miles: number;
  harsh: { a: number; b: number; c: number };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function mphFromMs(ms: number | null | undefined): number {
  // gps_breadcrumbs.speed is in m/s; convert to mph
  if (ms == null || !Number.isFinite(ms)) return 0;
  return Math.round(ms * 2.2369362921);
}

/**
 * Aggregate max-speed + harsh-event counts over a window of GPS
 * breadcrumbs. Harsh detection mirrors the existing avlTracking
 * thresholds: > 4 m/s² decel = hard brake (B), > 4 m/s² accel
 * = hard accel (A); sharp turn is the 'C' bucket (we approximate
 * via high yaw deltas using successive heading values where
 * present, falling back to a sustained-low-speed / high-yaw-rate
 * proxy that gps_breadcrumbs doesn't capture well — we conservatively
 * leave C at 0 to avoid false positives).
 */
async function computeBreadcrumbStats(
  db: D1Database,
  unitId: number | null,
  officerId: number | null,
  startIso: string,
  endIso: string,
): Promise<BreadcrumbStats> {
  if (!unitId && !officerId) {
    return { point_count: 0, max_mph: 0, distance_miles: 0, harsh: { a: 0, b: 0, c: 0 } };
  }
  const where: string[] = ['recorded_at >= ?', 'recorded_at <= ?'];
  const params: unknown[] = [startIso, endIso];
  if (unitId)   { where.push('unit_id = ?');   params.push(unitId);   }
  if (officerId){ where.push('officer_id = ?');params.push(officerId);}
  const rows = await query<{ speed: number | null; latitude: number; longitude: number; recorded_at: string }>(
    db,
    `SELECT speed, latitude, longitude, recorded_at
       FROM gps_breadcrumbs
      WHERE ${where.join(' AND ')}
      ORDER BY recorded_at ASC
      LIMIT 4000`,
    ...params,
  );
  if (rows.length === 0) {
    return { point_count: 0, max_mph: 0, distance_miles: 0, harsh: { a: 0, b: 0, c: 0 } };
  }
  let maxMph = 0;
  let distanceMeters = 0;
  let harshA = 0, harshB = 0, harshC = 0;
  let prev: { lat: number; lng: number; speedMs: number; t: number } | null = null;
  // Episode flags: a sustained hard accel/brake spans several consecutive
  // 1Hz fixes. Counting every exceeding PAIR (the old behavior) booked one
  // braking maneuver as 5-10 "events", producing absurd PS-211 rows like
  // "A:25 B:23" on an 11-minute drive. Count only the TRANSITION into an
  // exceedance episode.
  let inAccelEpisode = false;
  let inBrakeEpisode = false;
  /** Reject teleport segments: > 80 m/s (~179 mph, mirrors the client GPS
   *  jump gate) implied speed means a GPS glitch, not driving. Without this,
   *  one bad fix added miles of phantom distance (PS-211 showed a 64.5 mi /
   *  16 min "trip" ≈ 242 mph average). */
  const MAX_PLAUSIBLE_MPS = 80;
  for (const r of rows) {
    const speedMs = r.speed != null ? Number(r.speed) : 0;
    const t = new Date(r.recorded_at.replace(' ', 'T') + 'Z').getTime();
    if (prev) {
      // Haversine in meters.
      const dLat = ((r.latitude - prev.lat) * Math.PI) / 180;
      const dLng = ((r.longitude - prev.lng) * Math.PI) / 180;
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(prev.lat * Math.PI / 180) * Math.cos(r.latitude * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
      const dMeters = 2 * 6371000 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const dtSec = Math.max(0.5, (t - prev.t) / 1000);
      if (dMeters / dtSec > MAX_PLAUSIBLE_MPS) {
        // Teleport glitch — skip the segment entirely (no distance, no harsh,
        // no max-speed from this pair) and re-anchor at the new fix.
        prev = { lat: r.latitude, lng: r.longitude, speedMs, t };
        inAccelEpisode = false;
        inBrakeEpisode = false;
        continue;
      }
      distanceMeters += dMeters;
      // Harsh events: > 4 m/s² accel/brake (matches avlTracking), counted
      // once per episode (transition into exceedance), not per fix-pair.
      const dV = speedMs - prev.speedMs;
      const accelMps2 = dV / dtSec;
      if (accelMps2 > 4) {
        if (!inAccelEpisode) harshA++;
        inAccelEpisode = true;
      } else {
        inAccelEpisode = false;
      }
      if (accelMps2 < -4) {
        if (!inBrakeEpisode) harshB++;
        inBrakeEpisode = true;
      } else {
        inBrakeEpisode = false;
      }
    }
    const mph = mphFromMs(speedMs);
    if (mph > maxMph) maxMph = mph;
    prev = { lat: r.latitude, lng: r.longitude, speedMs, t };
  }
  // C bucket: standing count of cornering proxies is unreliable from
  // the breadcrumb schema (no yaw). Leave at 0 to avoid false
  // positives — driver can edit / annotate after the fact.
  return {
    point_count: rows.length,
    max_mph: maxMph,
    distance_miles: distanceMeters * 0.000621371,
    harsh: { a: harshA, b: harshB, c: harshC },
  };
}

export default pm;

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
import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from '../types';
import { getDb, query, queryFirst } from '../utils/db';

const pm = new Hono<Env>();

// ── Scope-key helpers (canonical; one source of truth) ─────

function scopeKeyOfficerUnit(officerId: number, unitId: number): string {
  return `officer_unit:${officerId}:${unitId}`;
}
function scopeKeyOfficer(officerId: number): string {
  return `officer:${officerId}`;
}
function scopeKeyUnit(unitId: number): string {
  return `unit:${unitId}`;
}

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

    const db = getDb(c.env);

    // 1) officer_unit combo (most accurate)
    if (Number.isFinite(officerId) && Number.isFinite(unitId)) {
      const row = await queryFirst<{ current_mileage: number; offset_miles: number; last_entry_at: string | null }>(
        db,
        'SELECT current_mileage, offset_miles, last_entry_at FROM mileage_anchor WHERE scope_key = ?',
        scopeKeyOfficerUnit(officerId, unitId),
      );
      if (row) {
        return c.json({
          suggested_mileage: row.current_mileage,
          source: 'officer_unit',
          scope_key: scopeKeyOfficerUnit(officerId, unitId),
          offset_miles: row.offset_miles,
          last_entry_at: row.last_entry_at,
        });
      }
    }

    // 2) officer-only fallback
    if (Number.isFinite(officerId)) {
      const row = await queryFirst<{ current_mileage: number; offset_miles: number; last_entry_at: string | null }>(
        db,
        'SELECT current_mileage, offset_miles, last_entry_at FROM mileage_anchor WHERE scope_key = ?',
        scopeKeyOfficer(officerId),
      );
      if (row) {
        return c.json({
          suggested_mileage: row.current_mileage,
          source: 'officer',
          scope_key: scopeKeyOfficer(officerId),
          offset_miles: row.offset_miles,
          last_entry_at: row.last_entry_at,
        });
      }
    }

    // 3) unit-only fallback
    if (Number.isFinite(unitId)) {
      const row = await queryFirst<{ current_mileage: number; offset_miles: number; last_entry_at: string | null }>(
        db,
        'SELECT current_mileage, offset_miles, last_entry_at FROM mileage_anchor WHERE scope_key = ?',
        scopeKeyUnit(unitId),
      );
      if (row) {
        return c.json({
          suggested_mileage: row.current_mileage,
          source: 'unit',
          scope_key: scopeKeyUnit(unitId),
          offset_miles: row.offset_miles,
          last_entry_at: row.last_entry_at,
        });
      }
    }

    return c.json({
      suggested_mileage: null,
      source: 'none',
      message: 'No prior mileage entry for this scope. Enter a starting mileage manually.',
    });
  } catch (err) {
    console.error('GET /patrol/mileage/suggest failed:', err);
    return c.json({ error: 'Failed to suggest mileage', detail: (err as Error)?.message }, 500);
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
         AND (t.start_mileage IS NOT NULL OR t.end_mileage IS NOT NULL)
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
    console.error('GET /patrol/mileage/chain failed:', err);
    return c.json({ error: 'Failed to load chain', detail: (err as Error)?.message }, 500);
  }
});

// ── GET /mileage/audit ────────────────────────────────────
pm.get('/mileage/audit', async (c) => {
  try {
    const officerIdRaw = c.req.query('officer_id');
    const unitIdRaw = c.req.query('unit_id');
    const from = c.req.query('from');
    const to = c.req.query('to');
    const limit = Math.min(500, Math.max(1, parseInt(c.req.query('limit') || '100', 10)));
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
    console.error('GET /patrol/mileage/audit failed:', err);
    return c.json({ error: 'Failed to load audit', detail: (err as Error)?.message }, 500);
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
      sql: `UPDATE calls_for_service SET ${body.field} = ?, updated_at = datetime('now') WHERE id = ?`,
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
    // Generic audit_log entry for the dispatch Audit tab.
    batch.push({
      sql: `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details, created_at)
            VALUES (?, 'MILEAGE_FIX', 'call', ?, ?, datetime('now'))`,
      bindings: [
        user.id, body.entry_id,
        `${isBackfill ? 'Mileage backfill' : 'Mileage fix'}: ${existing.call_number || body.entry_id} ${body.field} ${before == null ? '—' : before}→${after}` +
        `${isBackfill ? '' : ` (Δ ${delta >= 0 ? '+' : ''}${delta.toFixed(1)} mi, cascade=${cascadeCount})`} scope=${scopeKey} — ${reason}`,
      ],
    });

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
        batch.push({
          sql: `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details, created_at)
                VALUES (?, 'FLEET_ODOMETER_SYNC', 'fleet_vehicle', ?, ?, datetime('now'))`,
          bindings: [
            user.id, vehicleId,
            `Odometer write-through from mileage fix on call ${existing.call_number || body.entry_id}: ` +
            `proposed ${after} mi (current MAX-merged) — ${reason}`,
          ],
        });
      }
    }

    await db.batch(batch.map(s => {
      const stmt = db.prepare(s.sql);
      return s.bindings?.length ? stmt.bind(...s.bindings) : stmt;
    }));

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
    console.error('POST /patrol/mileage/fix failed:', err);
    return c.json({ error: 'Failed to apply fix', detail: (err as Error)?.message }, 500);
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
    const unitTrips = await query<{ start_time: string | null; end_time: string | null; start_mileage: number | null; end_mileage: number | null }>(db, `
      SELECT start_time, end_time, start_mileage, end_mileage
        FROM unit_trips
       WHERE ${utWhere.join(' AND ')}
       ORDER BY start_time ASC
       LIMIT 1000
    `, ...utParams);
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
    for (let i = 0; i < unitTrips.length; i++) {
      if (consumed[i]) continue;
      const ut = unitTrips[i];
      if (!ut.start_time || (ut.start_mileage == null && ut.end_mileage == null)) continue;
      const start = ut.start_time;
      const end = ut.end_time || start;
      const distance = ut.start_mileage != null && ut.end_mileage != null
        ? Math.max(0, Number(ut.end_mileage) - Number(ut.start_mileage))
        : 0;
      const duration = Math.max(0, Math.round((new Date(end.replace(' ', 'T') + 'Z').getTime() - new Date(start.replace(' ', 'T') + 'Z').getTime()) / 60000));
      patrolRows.push({
        type: 'PATROL',
        call_id: null,
        call_number: null,
        start,
        end,
        distance_mi: round1(distance),
        duration_min: duration,
        mileage_from: ut.start_mileage,
        mileage_to: ut.end_mileage,
        max_mph: 0,
        harsh: { a: 0, b: 0, c: 0 },
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
    console.error('GET /patrol/trip-log/generate failed:', err);
    return c.json({ error: 'Failed to generate trip log', detail: (err as Error)?.message }, 500);
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
  for (const r of rows) {
    const speedMs = r.speed != null ? Number(r.speed) : 0;
    const mph = mphFromMs(speedMs);
    if (mph > maxMph) maxMph = mph;
    const t = new Date(r.recorded_at.replace(' ', 'T') + 'Z').getTime();
    if (prev) {
      // Haversine in meters.
      const dLat = ((r.latitude - prev.lat) * Math.PI) / 180;
      const dLng = ((r.longitude - prev.lng) * Math.PI) / 180;
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(prev.lat * Math.PI / 180) * Math.cos(r.latitude * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
      const dMeters = 2 * 6371000 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      distanceMeters += dMeters;
      // Harsh events: > 4 m/s² accel/brake (matches avlTracking).
      const dtSec = Math.max(0.5, (t - prev.t) / 1000);
      const dV = speedMs - prev.speedMs;
      const accelMps2 = dV / dtSec;
      if (accelMps2 > 4) harshA++;
      if (accelMps2 < -4) harshB++;
    }
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

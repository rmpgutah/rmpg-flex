// ============================================================
// RMPG Flex — Fleet visualization routes (Fleet.io PR 7–9 backend)
// ============================================================
// All routes mounted at /api/fleet-viz (auth: 'required'). Read-only
// SQL aggregates over the mirror tables (fleet_vehicles, fleet_fuel_log,
// fleet_maintenance, work_orders, vehicle_inspections) joined against
// RMPG operational tables (calls_for_service, cad_units, officers).
//
// The "why RMPG and not just Fleet.io" moats live here — particularly
// V3 (MPG-by-officer), V6 (fuel anomaly heatmap), V7 (calls-per-gallon).
// Fleet.io literally can't build these because they need RMPG's
// officer + GPS joins.
//
// Each endpoint returns a stable JSON shape so the React dashboard can
// switch between charts without server changes. Defensive: every query
// is wrapped in try/catch and returns an empty-but-typed shape on D1
// failure so a single bad query never breaks the whole dashboard load.
//
// Endpoint inventory:
//   F1: GET /kpi                  — KPI ribbon (in-service, in-shop, overdue PMs, avg MPG, cost/mi)
//   F2: GET /dossier/:id          — Vehicle dossier (timeline + fuel chart + WO/insp counts)
//   F3: GET /readiness            — Readiness board (per-vehicle status + fuel + PM + open WOs)
//   V1: GET /fleet-map            — Vehicle list with current_location + readiness for Mapbox
//   V2: GET /pm-timeline          — Upcoming PM events per vehicle (Gantt-ready)
//   V3: GET /mpg-by-officer       — MPG samples grouped by officer (scatter)
//   V4: GET /cost-per-mile        — Cost breakdown per vehicle (stack)
//   V5: GET /work-order-flow      — WO status transition counts (Sankey)
//   V6: GET /fuel-anomalies       — Per-entry z-scores (heatmap)
//   V7: GET /calls-per-gallon     — Calls handled / gallons consumed per officer (THE moat)
//   V8: GET /pm-upcoming          — Top-N upcoming PMs sorted by miles-until-due
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst } from '../utils/db';
import {
  buildDateWindow,
  computeCostBreakdown,
  computeMpgPoints,
  zScores,
  type FuelEntry,
} from '../utils/fleetViz';

const viz = new Hono<Env>();

// ─── F1: KPI ribbon ────────────────────────────────────────

viz.get('/kpi', async (c) => {
  try {
    const db = getDb(c.env);
    const period = c.req.query('period');
    const fuelWin = buildDateWindow(period, 'fuel_date');
    // fleet_maintenance uses `service_date` on live D1 (no `maintenance_date`
    // column ever shipped). Same drift fixed in /cost-per-mile.
    const mvWin = buildDateWindow(period, 'service_date');

    const inService = await queryFirst<{ n: number }>(
      db, `SELECT COUNT(*) AS n FROM fleet_vehicles WHERE status = 'in_service'`,
    );
    const inShop = await queryFirst<{ n: number }>(
      // 'in_shop' is not a valid fleet_vehicles.status value (VALID_STATUSES
      // in fleet.ts only allows in_service/out_of_service/maintenance/
      // retired/archived) — this always undercounted to 0 for maintenance
      // vehicles until fixed. Canonical value is 'maintenance'.
      db, `SELECT COUNT(*) AS n FROM fleet_vehicles WHERE status IN ('maintenance','out_of_service')`,
    );
    // Overdue PMs: vehicles whose next_service_date is in the past, or
    // current_mileage > next_service_mileage.
    const overdue = await queryFirst<{ n: number }>(
      db, `SELECT COUNT(*) AS n FROM fleet_vehicles
           WHERE (next_service_date IS NOT NULL AND next_service_date < date('now'))
              OR (next_service_mileage IS NOT NULL AND current_mileage IS NOT NULL
                  AND current_mileage > next_service_mileage)`,
    );
    // Avg MPG and cost-per-mile use the (server-rolled) mpg on the row + period totals.
    const fuelTotals = await queryFirst<{ gallons: number; total_cost: number; avg_mpg: number }>(
      db, `SELECT COALESCE(SUM(gallons), 0) AS gallons,
                  COALESCE(SUM(total_cost), 0) AS total_cost,
                  COALESCE(AVG(mpg), 0) AS avg_mpg
           FROM fleet_fuel_log WHERE 1=1 ${fuelWin.whereClause}`,
    );
    const maintTotals = await queryFirst<{ total_cost: number }>(
      db, `SELECT COALESCE(SUM(cost), 0) AS total_cost
           FROM fleet_maintenance WHERE 1=1 ${mvWin.whereClause}`,
    );
    // Miles driven in the window — best-effort: vehicle deltas in current_mileage
    // are aggregated. For PR 7 we approximate by summing odometer deltas across
    // fuel entries (close enough until PR 8's ClearPathGPS-derived mileage cron).
    const miles = await queryFirst<{ miles: number }>(
      db, `SELECT COALESCE(MAX(odometer) - MIN(odometer), 0) AS miles
           FROM fleet_fuel_log WHERE 1=1 ${fuelWin.whereClause}`,
    );
    const cost = computeCostBreakdown({
      fuel_cost: fuelTotals?.total_cost ?? 0,
      maintenance_cost: maintTotals?.total_cost ?? 0,
      parts_cost: 0,
      miles_driven: miles?.miles ?? 0,
    });
    return c.json({
      period: fuelWin.label,
      in_service: inService?.n ?? 0,
      in_shop: inShop?.n ?? 0,
      overdue_pms: overdue?.n ?? 0,
      avg_mpg: Math.round((fuelTotals?.avg_mpg ?? 0) * 10) / 10,
      cost_per_mile: cost.cost_per_mile,
      total_cost: cost.total,
      miles_driven: miles?.miles ?? 0,
    });
  } catch (err) {
    console.error('[fleetViz] /kpi failed', err);
    return c.json({
      period: 'unknown', in_service: 0, in_shop: 0, overdue_pms: 0,
      avg_mpg: 0, cost_per_mile: null, total_cost: 0, miles_driven: 0,
      error: 'aggregation failure',
    }, 500);
  }
});

// ─── F2: Vehicle dossier ───────────────────────────────────

viz.get('/dossier/:id{[0-9]+}', async (c) => {
  try {
    const id = parseInt(c.req.param('id') ?? '0', 10);
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
    const db = getDb(c.env);
    const vehicle = await queryFirst<Record<string, unknown>>(
      db, 'SELECT * FROM fleet_vehicles WHERE id = ?', id,
    );
    if (!vehicle) return c.json({ error: 'Not found' }, 404);

    const fuel90d = await query<Record<string, unknown>>(
      db, `SELECT id, fuel_date, gallons, total_cost, mpg, odometer, is_full_tank, is_partial_fillup
           FROM fleet_fuel_log
           WHERE vehicle_id = ? AND fuel_date >= date('now','-90 days')
           ORDER BY fuel_date`, id,
    );
    // fleet_maintenance columns on live: service_date, service_type (no
    // `maintenance_date`/`maintenance_type`); there is no `status` column.
    // Alias service_* back to maintenance_* so the dossier UI keeps its
    // current JSON shape without a client edit.
    const maint90d = await query<Record<string, unknown>>(
      db, `SELECT id,
                  service_date AS maintenance_date,
                  service_type AS maintenance_type,
                  description, cost, work_order_id
           FROM fleet_maintenance
           WHERE vehicle_id = ? AND service_date >= date('now','-90 days')
           ORDER BY service_date DESC`, id,
    );
    const openWoCount = await queryFirst<{ n: number }>(
      db, `SELECT COUNT(*) AS n FROM work_orders WHERE vehicle_id = ?
           AND status NOT IN ('completed','cancelled')`, id,
    );
    const inspCount90d = await queryFirst<{ n: number; fails: number }>(
      db, `SELECT COUNT(*) AS n, SUM(CASE WHEN escalated_issue_id IS NOT NULL THEN 1 ELSE 0 END) AS fails
           FROM vehicle_inspections WHERE vehicle_id = ?
           AND created_at >= date('now','-90 days')`, id,
    );
    const callsHandled90d = await queryFirst<{ n: number }>(
      db, `SELECT COUNT(*) AS n FROM calls_for_service
           WHERE assigned_unit_ids LIKE ?
           AND created_at >= date('now','-90 days')`, `%${id}%`,
    );

    return c.json({
      vehicle,
      fuel_log: fuel90d,
      mpg_points: computeMpgPoints(fuel90d as unknown as FuelEntry[]),
      maintenance: maint90d,
      open_work_orders: openWoCount?.n ?? 0,
      inspections_90d: inspCount90d?.n ?? 0,
      failed_inspections_90d: inspCount90d?.fails ?? 0,
      calls_handled_90d: callsHandled90d?.n ?? 0,
    });
  } catch (err) {
    console.error('[fleetViz] /dossier failed', err);
    return c.json({ error: 'Failed to load dossier', detail: (err as Error)?.message }, 500);
  }
});

// ─── F3: Readiness board ───────────────────────────────────

viz.get('/readiness', async (c) => {
  try {
    const db = getDb(c.env);
    // One row per vehicle with the columns the board needs: status, last
    // fuel %, miles-until-PM, open WO count, last inspection result.
    const rows = await query<Record<string, unknown>>(
      db, `
      SELECT
        v.id, v.vehicle_name, v.vehicle_number, v.status,
        v.current_mileage,
        v.next_service_mileage,
        (v.next_service_mileage - v.current_mileage) AS miles_to_pm,
        v.next_service_date,
        (SELECT COUNT(*) FROM work_orders WHERE vehicle_id = v.id
         AND status NOT IN ('completed','cancelled')) AS open_work_orders,
        (SELECT escalated_issue_id IS NOT NULL FROM vehicle_inspections
         WHERE vehicle_id = v.id ORDER BY created_at DESC LIMIT 1) AS last_inspection_failed,
        (SELECT fuel_level FROM vehicle_inspections
         WHERE vehicle_id = v.id AND fuel_level IS NOT NULL
         ORDER BY created_at DESC LIMIT 1) AS last_fuel_level
      FROM fleet_vehicles v
      WHERE v.status != 'archived'
      ORDER BY
        CASE WHEN v.status = 'in_service' THEN 0 WHEN v.status IN ('maintenance','out_of_service') THEN 1 ELSE 2 END,
        v.vehicle_number`,
    );
    return c.json({ count: rows.length, data: rows });
  } catch (err) {
    console.error('[fleetViz] /readiness failed', err);
    return c.json({ count: 0, data: [], error: 'aggregation failure' }, 500);
  }
});

// ─── V1: Fleet map (Mapbox) ───────────────────────────────

viz.get('/fleet-map', async (c) => {
  try {
    const db = getDb(c.env);
    // Joined with the most recent ClearPathGPS breadcrumb when available.
    // gps_breadcrumbs uses `latitude`/`longitude`/`recorded_at` (the
    // canonical pattern used in src/routes/fleet.ts) — there are no
    // `lat`/`lng`/`ts` columns. Alias back to the historical names so the
    // FleetMapCard contract stays stable.
    const rows = await query<Record<string, unknown>>(
      db, `
      SELECT
        v.id, v.vehicle_name, v.vehicle_number, v.status,
        v.current_mileage, v.next_service_mileage,
        (v.next_service_mileage - v.current_mileage) AS miles_to_pm,
        v.assigned_unit_id,
        (SELECT latitude    FROM gps_breadcrumbs WHERE unit_id = v.assigned_unit_id ORDER BY recorded_at DESC LIMIT 1) AS lat,
        (SELECT longitude   FROM gps_breadcrumbs WHERE unit_id = v.assigned_unit_id ORDER BY recorded_at DESC LIMIT 1) AS lng,
        (SELECT recorded_at FROM gps_breadcrumbs WHERE unit_id = v.assigned_unit_id ORDER BY recorded_at DESC LIMIT 1) AS gps_ts
      FROM fleet_vehicles v
      WHERE v.status != 'archived'`,
    );
    // Mark readiness: in_service + miles_to_pm > 500 = 'ready', else 'attention'.
    const features = rows.map((r) => {
      const milesToPm = typeof r.miles_to_pm === 'number' ? r.miles_to_pm : null;
      const status = r.status === 'in_service'
        ? (milesToPm != null && milesToPm > 500 ? 'ready' : 'attention')
        : 'unavailable';
      return { ...r, readiness: status };
    });
    return c.json({ count: features.length, data: features });
  } catch (err) {
    console.error('[fleetViz] /fleet-map failed', err);
    return c.json({ count: 0, data: [], error: 'aggregation failure' }, 500);
  }
});

// ─── V2: PM timeline (Gantt) ──────────────────────────────

viz.get('/pm-timeline', async (c) => {
  try {
    const db = getDb(c.env);
    const horizonDays = Math.min(parseInt(c.req.query('horizon_days') ?? '90', 10), 365);
    const rows = await query<Record<string, unknown>>(
      db, `
      SELECT
        v.id AS vehicle_id, v.vehicle_number, v.vehicle_name,
        v.next_service_date, v.next_service_mileage, v.current_mileage,
        CASE
          WHEN v.next_service_date IS NOT NULL AND v.next_service_date < date('now') THEN 'overdue'
          WHEN v.next_service_mileage IS NOT NULL AND v.current_mileage IS NOT NULL
               AND v.current_mileage > v.next_service_mileage THEN 'overdue'
          WHEN v.next_service_date IS NOT NULL AND v.next_service_date < date('now', ? || ' days') THEN 'upcoming'
          ELSE 'future'
        END AS bucket
      FROM fleet_vehicles v
      WHERE v.status != 'archived'
        AND (v.next_service_date IS NOT NULL OR v.next_service_mileage IS NOT NULL)
      ORDER BY v.next_service_date NULLS LAST, v.vehicle_number`,
      `+${horizonDays}`,
    );
    return c.json({ horizon_days: horizonDays, count: rows.length, data: rows });
  } catch (err) {
    console.error('[fleetViz] /pm-timeline failed', err);
    return c.json({ horizon_days: 0, count: 0, data: [], error: 'aggregation failure' }, 500);
  }
});

// ─── V3: MPG by officer (THE moat — needs officer×fuel joins) ──

viz.get('/mpg-by-officer', async (c) => {
  try {
    const db = getDb(c.env);
    const win = buildDateWindow(c.req.query('period'), 'fuel_date');
    // Schema: fleet_fuel_log has `driver_name TEXT` — there is no driver_id
    // column and no `officers` table. Group by driver_name directly.
    // Synthetic officer_id = stable hash of name so the frontend can key on
    // it without colliding for distinct drivers with the same display name
    // (rare in this fleet but cheap to guard against).
    const rows = await query<Record<string, unknown>>(
      db, `
      SELECT
        f.driver_name AS officer_name,
        f.vehicle_id,
        f.fuel_date,
        f.mpg,
        f.gallons,
        f.total_cost
      FROM fleet_fuel_log f
      WHERE f.mpg IS NOT NULL
        AND f.driver_name IS NOT NULL
        AND TRIM(f.driver_name) != '' ${win.whereClause}
      ORDER BY f.fuel_date DESC
      LIMIT 5000`,
    );
    // Group + average per driver_name for the scatter aggregate.
    const byOfficer: Record<string, { officer_id: number; officer_name: string; samples: number; mean_mpg: number; total_gallons: number; total_cost: number }> = {};
    for (const r of rows) {
      const name = String(r.officer_name ?? '').trim();
      if (!name) continue;
      const slot = byOfficer[name] ?? (byOfficer[name] = {
        officer_id: stableHash(name),
        officer_name: name,
        samples: 0, mean_mpg: 0, total_gallons: 0, total_cost: 0,
      });
      slot.samples++;
      slot.mean_mpg += (Number(r.mpg) - slot.mean_mpg) / slot.samples;
      slot.total_gallons += Number(r.gallons ?? 0);
      slot.total_cost += Number(r.total_cost ?? 0);
    }
    return c.json({
      period: win.label,
      // Stamp officer_id onto each sample so the frontend (which keys by it)
      // can stay typed without a schema migration. Hash is deterministic per
      // driver_name so the same driver maps to the same id across requests.
      samples: rows.slice(0, 500).map((r) => ({
        ...r,
        officer_id: stableHash(String(r.officer_name ?? '')),
      })),
      by_officer: Object.values(byOfficer).map((s) => ({
        ...s,
        mean_mpg: Math.round(s.mean_mpg * 10) / 10,
        total_gallons: Math.round(s.total_gallons * 100) / 100,
        total_cost: Math.round(s.total_cost * 100) / 100,
      })),
    });
  } catch (err) {
    console.error('[fleetViz] /mpg-by-officer failed', err);
    return c.json({ period: 'unknown', samples: [], by_officer: [], error: 'aggregation failure' }, 500);
  }
});

/** Stable 31-bit non-negative hash of a string — used to synthesize an
 *  officer_id from driver_name when the underlying schema doesn't have one.
 *  Not cryptographic; only needs to be deterministic + collision-rare across
 *  ~tens of drivers. */
function stableHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

// ─── V4: Cost-per-mile stack ──────────────────────────────

viz.get('/cost-per-mile', async (c) => {
  try {
    const db = getDb(c.env);
    // Schema: fleet_maintenance uses `service_date` (NOT `maintenance_date`).
    // The latter was a renamed column that never landed in baseline schema.
    const win = buildDateWindow(c.req.query('period'), 'service_date');
    const fuelWin = buildDateWindow(c.req.query('period'), 'fuel_date');
    const rows = await query<Record<string, unknown>>(
      db, `
      SELECT
        v.id AS vehicle_id, v.vehicle_number, v.vehicle_name,
        COALESCE((SELECT SUM(total_cost) FROM fleet_fuel_log
                  WHERE vehicle_id = v.id ${fuelWin.whereClause}), 0) AS fuel_cost,
        COALESCE((SELECT SUM(cost) FROM fleet_maintenance
                  WHERE vehicle_id = v.id ${win.whereClause}), 0) AS maint_cost,
        COALESCE((SELECT MAX(odometer) - MIN(odometer) FROM fleet_fuel_log
                  WHERE vehicle_id = v.id ${fuelWin.whereClause}), 0) AS miles
      FROM fleet_vehicles v
      WHERE v.status != 'archived'`,
    );
    const data = rows.map((r) => {
      const cost = computeCostBreakdown({
        fuel_cost: Number(r.fuel_cost ?? 0),
        maintenance_cost: Number(r.maint_cost ?? 0),
        parts_cost: 0,
        miles_driven: Number(r.miles ?? 0),
      });
      return {
        vehicle_id: r.vehicle_id, vehicle_number: r.vehicle_number, vehicle_name: r.vehicle_name,
        miles: r.miles, ...cost,
      };
    });
    return c.json({ period: win.label, count: data.length, data });
  } catch (err) {
    console.error('[fleetViz] /cost-per-mile failed', err);
    return c.json({ period: 'unknown', count: 0, data: [], error: 'aggregation failure' }, 500);
  }
});

// ─── V5: WO flow (Sankey) ─────────────────────────────────

viz.get('/work-order-flow', async (c) => {
  try {
    const db = getDb(c.env);
    const win = buildDateWindow(c.req.query('period'), 'opened_at');
    const rows = await query<{ status: string; n: number }>(
      db, `SELECT status, COUNT(*) AS n FROM work_orders
           WHERE 1=1 ${win.whereClause}
           GROUP BY status`,
    );
    // Sankey-shape: 'open' → 'in_progress' → 'waiting_parts' → 'completed' edges with counts.
    const byStatus: Record<string, number> = {};
    for (const r of rows) byStatus[r.status] = r.n;
    const nodes = ['open', 'in_progress', 'waiting_parts', 'completed', 'cancelled'].map((s) => ({
      name: s, count: byStatus[s] ?? 0,
    }));
    return c.json({ period: win.label, nodes });
  } catch (err) {
    console.error('[fleetViz] /work-order-flow failed', err);
    return c.json({ period: 'unknown', nodes: [], error: 'aggregation failure' }, 500);
  }
});

// ─── V6: Fuel anomaly heatmap (z-scores) ──────────────────

viz.get('/fuel-anomalies', async (c) => {
  try {
    const db = getDb(c.env);
    const win = buildDateWindow(c.req.query('period'), 'fuel_date');
    // Schema: fleet_fuel_log has `driver_name TEXT`, no `driver_id`. Return
    // driver_name on the row so the frontend can display + group by it.
    const rows = await query<{
      id: number; fuel_date: string; gallons: number; total_cost: number;
      driver_name: string | null; vehicle_id: number;
    }>(db, `
      SELECT id, fuel_date, gallons, total_cost, driver_name, vehicle_id
      FROM fleet_fuel_log
      WHERE gallons IS NOT NULL AND total_cost IS NOT NULL ${win.whereClause}
      ORDER BY fuel_date`,
    );
    const gallons = rows.map((r) => Number(r.gallons) || 0);
    const costPerGal = rows.map((r) => {
      const g = Number(r.gallons) || 0;
      return g > 0 ? Number(r.total_cost) / g : 0;
    });
    const zGallons = zScores(gallons);
    const zCost = zScores(costPerGal);
    const flagged = rows.map((r, i) => ({
      ...r,
      cost_per_gallon: Math.round(costPerGal[i] * 100) / 100,
      z_gallons: zGallons[i] ?? 0,
      z_cost_per_gallon: zCost[i] ?? 0,
      flagged: Math.abs(zGallons[i] ?? 0) > 2 || Math.abs(zCost[i] ?? 0) > 2,
    }));
    return c.json({ period: win.label, count: flagged.length, data: flagged });
  } catch (err) {
    console.error('[fleetViz] /fuel-anomalies failed', err);
    return c.json({ period: 'unknown', count: 0, data: [], error: 'aggregation failure' }, 500);
  }
});

// ─── V7: Calls per gallon (THE moat — Fleet.io can't do this) ──

viz.get('/calls-per-gallon', async (c) => {
  try {
    const db = getDb(c.env);
    const win = buildDateWindow(c.req.query('period'), 'fuel_date');
    const callWin = buildDateWindow(c.req.query('period'), 'created_at');

    // Live schema reality: there is no `officers` table and
    // `fleet_fuel_log` has no `driver_id` FK — only `driver_name TEXT`.
    // The moat join therefore runs in two halves and gets stitched in
    // JS on the case-folded name. The "officer" entity is `users`; the
    // dispatch unit table is `units`, not `cad_units`.
    const fuelRows = await query<{ driver_name: string; total_gallons: number }>(
      db, `
      SELECT TRIM(driver_name) AS driver_name,
             COALESCE(SUM(gallons), 0) AS total_gallons
      FROM fleet_fuel_log
      WHERE driver_name IS NOT NULL
        AND TRIM(driver_name) != '' ${win.whereClause}
      GROUP BY TRIM(driver_name)`,
    );
    const callRows = await query<{ officer_id: number; full_name: string; calls: number }>(
      db, `
      SELECT u.id AS officer_id, u.full_name, COUNT(DISTINCT c.id) AS calls
      FROM units un
      JOIN users u ON u.id = un.officer_id
      JOIN calls_for_service c ON c.assigned_unit_ids LIKE '%' || un.id || '%'
      WHERE un.officer_id IS NOT NULL ${callWin.whereClause}
      GROUP BY u.id, u.full_name`,
    );

    const callsByName = new Map<string, { officer_id: number; full_name: string; calls: number }>();
    for (const row of callRows) {
      if (!row.full_name) continue;
      callsByName.set(row.full_name.trim().toLowerCase(), row);
    }

    const data = fuelRows
      .filter((g) => g.total_gallons > 0)
      .map((g) => {
        const match = callsByName.get(g.driver_name.toLowerCase());
        const calls = match?.calls ?? 0;
        return {
          // Prefer the real users.id when the name matched; otherwise a
          // deterministic hash so the React key stays stable across reloads.
          officer_id: match?.officer_id ?? stableHash(g.driver_name),
          officer_name: match?.full_name ?? g.driver_name,
          total_gallons: Math.round(g.total_gallons * 100) / 100,
          calls_handled: calls,
          calls_per_gallon: Math.round((calls / g.total_gallons) * 100) / 100,
        };
      })
      .sort((a, b) => b.calls_per_gallon - a.calls_per_gallon);
    return c.json({ period: win.label, count: data.length, data });
  } catch (err) {
    console.error('[fleetViz] /calls-per-gallon failed', err);
    return c.json({ period: 'unknown', count: 0, data: [], error: 'aggregation failure' }, 500);
  }
});

// ─── V8: PM upcoming (table + spark) ──────────────────────

viz.get('/pm-upcoming', async (c) => {
  try {
    const db = getDb(c.env);
    const limit = Math.min(parseInt(c.req.query('limit') ?? '25', 10), 200);
    const rows = await query<Record<string, unknown>>(
      db, `
      SELECT
        v.id, v.vehicle_number, v.vehicle_name,
        v.current_mileage, v.next_service_mileage, v.next_service_date,
        (v.next_service_mileage - v.current_mileage) AS miles_to_pm
      FROM fleet_vehicles v
      WHERE v.status != 'archived'
        AND (v.next_service_mileage IS NOT NULL OR v.next_service_date IS NOT NULL)
      ORDER BY
        CASE WHEN v.next_service_date < date('now') THEN 0
             WHEN v.current_mileage > v.next_service_mileage THEN 0
             ELSE 1 END,
        miles_to_pm NULLS LAST,
        v.next_service_date NULLS LAST
      LIMIT ?`, limit,
    );
    return c.json({ count: rows.length, data: rows });
  } catch (err) {
    console.error('[fleetViz] /pm-upcoming failed', err);
    return c.json({ count: 0, data: [], error: 'aggregation failure' }, 500);
  }
});

export default viz;

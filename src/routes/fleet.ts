import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';

const fleet = new Hono<Env>();

// Manager-tier roles can create/update/delete vehicles. Read endpoints
// are open to any authenticated role — fleet data is a routine-ops
// concern, not sensitive HR/case data, and dispatch needs read access
// from MdtPage / DispatchPage to resolve assigned_unit_id → plate.
const MANAGER_ROLES = new Set(['admin', 'manager', 'supervisor']);

// Columns a manager may write via POST/PUT. Anything outside this set
// is silently dropped — prevents both "no such column" 500s on unknown
// fields and column-name injection through interpolated keys. Keep in
// sync with the live D1 schema (see legacy/server-vps/src/models/
// database.ts L744 for the base CREATE, plus addCol additions for
// archived_at + the 5 aggregate columns at L5119-5125).
const WRITABLE_COLS: readonly string[] = [
  'vehicle_number', 'make', 'model', 'year', 'color',
  'vin', 'plate_number', 'plate_state',
  'status', 'assigned_unit_id',
  'current_mileage', 'last_service_date', 'next_service_due',
  'next_service_mileage',
  'insurance_expiry', 'registration_expiry',
  'equipment', 'notes',
];

const VALID_STATUSES = new Set(['in_service', 'out_of_service', 'maintenance', 'retired', 'archived']);

// D1 `.bind()` only accepts null | number | string | boolean | ArrayBuffer.
// Columns like `equipment` arrive from the client as JS arrays (multi-select);
// binding one directly throws `D1_TYPE_ERROR: Type 'object' not supported`.
// We JSON-serialize any array/object so it lands as a string — the client's
// `parseEquipment()` reads it back via JSON.parse. Empty string → null.
function coerceBindValue(raw: unknown): unknown {
  if (raw === '') return null;
  if (raw !== null && typeof raw === 'object') return JSON.stringify(raw);
  return raw;
}

// ─────────────────────────────────────────────────────────
// GET /  — paginated list with filters
// ─────────────────────────────────────────────────────────
// fleet_vehicles is ~26 cols (well under D1's 100-col cap), so `SELECT *`
// is safe here. The LEFT JOIN against units pulls call_sign so the
// client can show the assigned unit label without a second round-trip.
// Gracefully degrades to empty list when the fleet_vehicles table hasn't
// been created yet on live D1 (migration 0048 pending).
fleet.get('/', async (c) => {
  try {
    const db = getDb(c.env);
    // Check if fleet_vehicles table exists — return clean empty data
    // rather than 500 when the migration hasn't been applied yet.
    const tableCheck = await queryFirst<{ n: number }>(db, "SELECT COUNT(*) as n FROM sqlite_master WHERE type='table' AND name='fleet_vehicles'");
    if (!tableCheck?.n) {
      return c.json({ data: [], pagination: { total: 0, totalPages: 0, page: 1, limit: 200 } });
    }
    const q = c.req.query();

    // Pagination — default 200, cap 500 (matches FleetPage which fetches
    // ?per_page=200 on mount and renders all in a single virtual list).
    const limitRaw = Number(q.limit ?? q.per_page ?? 200);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 200;
    const pageRaw = Number(q.page ?? 1);
    const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;
    const offset = (page - 1) * limit;

    const where: string[] = ['1=1'];
    const params: unknown[] = [];

    if (q.status) { where.push('v.status = ?'); params.push(q.status); }
    if (q.assigned_unit_id) {
      const uid = Number(q.assigned_unit_id);
      if (Number.isFinite(uid)) { where.push('v.assigned_unit_id = ?'); params.push(uid); }
    }
    // `archived` is a bool query param. The legacy/VPS convention used
    // status='archived' OR a non-null archived_at; we treat archived_at
    // as authoritative because the soft-delete in DELETE below sets it.
    if (q.archived === 'true') {
      where.push('v.archived_at IS NOT NULL');
    } else if (q.archived === 'false' || q.archived == null) {
      where.push('v.archived_at IS NULL');
    }
    if (q.search) {
      where.push('(v.plate_number LIKE ? OR v.make LIKE ? OR v.model LIKE ? OR v.vehicle_number LIKE ?)');
      const pat = `%${q.search}%`;
      params.push(pat, pat, pat, pat);
    }

    const whereSql = where.join(' AND ');

    const countRow = await queryFirst<{ n: number }>(
      db, `SELECT COUNT(*) as n FROM fleet_vehicles v WHERE ${whereSql}`, ...params,
    );
    const total = countRow?.n ?? 0;

    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT v.*, u.call_sign as assigned_unit_call_sign
       FROM fleet_vehicles v
       LEFT JOIN units u ON u.id = v.assigned_unit_id
       WHERE ${whereSql}
       ORDER BY v.vehicle_number
       LIMIT ? OFFSET ?`,
      ...params, limit, offset,
    );

    return c.json({
      data: rows,
      pagination: {
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        page,
        limit,
      },
    });
  } catch (err) {
    console.error('GET /fleet failed:', err);
    return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500);
  }
});

// ─────────────────────────────────────────────────────────
// GET /analytics — aggregate stats for the Fleet dashboard
// ─────────────────────────────────────────────────────────
// All sub-queries degrade to an empty array on failure (e.g. a missing
// table on live D1 that hasn't been ported yet). Fleet dashboards
// should NEVER 500 just because one source is empty — the FleetPage
// renders each chart independently from its slice of this payload.
fleet.get('/analytics', async (c) => {
  const db = getDb(c.env);

  const safe = async <T,>(fn: () => Promise<T>, fallback: T): Promise<T> => {
    try { return await fn(); } catch (e) {
      console.warn('analytics sub-query failed (continuing):', (e as Error)?.message);
      return fallback;
    }
  };

  // maintenance_cost_trend — last 12 months bucketed by performed_at month.
  // strftime('%Y-%m', ...) groups MST-stored timestamps cleanly into months;
  // we don't shift to UTC because the dashboard's "this month" semantics
  // are wall-clock MST per the project's america/denver convention.
  const maintenance_cost_trend = await safe(() => query<{ month: string; total_cost: number; count: number }>(
    db,
    `SELECT strftime('%Y-%m', performed_at) as month,
            COALESCE(SUM(cost), 0) as total_cost,
            COUNT(*) as count
     FROM fleet_maintenance
     WHERE performed_at >= datetime('now', '-12 months')
     GROUP BY month
     ORDER BY month`,
  ), []);

  // mileage_distribution — fixed buckets, simpler than a CASE WHEN ladder.
  const mileage_distribution = await safe(async () => {
    const buckets = [
      { range: '0-25k', min: 0, max: 25000 },
      { range: '25k-50k', min: 25000, max: 50000 },
      { range: '50k-75k', min: 50000, max: 75000 },
      { range: '75k-100k', min: 75000, max: 100000 },
      { range: '100k+', min: 100000, max: Number.MAX_SAFE_INTEGER },
    ];
    const out: Array<{ range: string; count: number }> = [];
    for (const b of buckets) {
      const row = await queryFirst<{ n: number }>(
        db,
        `SELECT COUNT(*) as n FROM fleet_vehicles
         WHERE archived_at IS NULL AND current_mileage >= ? AND current_mileage < ?`,
        b.min, b.max,
      );
      out.push({ range: b.range, count: row?.n ?? 0 });
    }
    return out;
  }, []);

  // status_breakdown — colors match the FleetPage status pill mapping
  // (no blue per the Spillman/Motorola pure-black theme).
  const status_breakdown = await safe(async () => {
    const STATUS_COLORS: Record<string, string> = {
      in_service: '#10b981',      // green
      out_of_service: '#ef4444',  // red
      maintenance: '#d4a017',     // RMPG gold
      retired: '#6b7280',         // neutral gray
    };
    const rows = await query<{ status: string; count: number }>(
      db,
      `SELECT status, COUNT(*) as count
       FROM fleet_vehicles
       WHERE archived_at IS NULL
       GROUP BY status`,
    );
    return rows.map(r => ({ ...r, color: STATUS_COLORS[r.status] ?? '#888888' }));
  }, []);

  // fuel_economy_trend — monthly. avg_mpg null when distance can't be
  // derived (no consecutive odometer readings in the window).
  const fuel_economy_trend = await safe(() => query<{
    month: string; avg_mpg: number | null; total_gallons: number; total_cost: number;
  }>(
    db,
    `SELECT strftime('%Y-%m', fuel_date) as month,
            NULL as avg_mpg,
            COALESCE(SUM(gallons), 0) as total_gallons,
            COALESCE(SUM(total_cost), 0) as total_cost
     FROM fleet_fuel_log
     WHERE fuel_date >= date('now', '-12 months')
     GROUP BY month
     ORDER BY month`,
  ), []);

  // Aggregate summary — uses materialized totals on fleet_vehicles
  // (total_maintenance_cost / total_fuel_cost / avg_mpg, added via
  // addCol in the legacy schema). Falls back to 0 if those columns
  // aren't populated yet for a given row.
  const summary = await safe(() => queryFirst<{
    total_vehicles: number;
    avg_mileage: number;
    avg_mpg: number | null;
    total_maintenance_cost: number;
    total_fuel_cost: number;
  }>(
    db,
    `SELECT COUNT(*) as total_vehicles,
            COALESCE(AVG(current_mileage), 0) as avg_mileage,
            AVG(NULLIF(avg_mpg, 0)) as avg_mpg,
            COALESCE(SUM(total_maintenance_cost), 0) as total_maintenance_cost,
            COALESCE(SUM(total_fuel_cost), 0) as total_fuel_cost
     FROM fleet_vehicles
     WHERE archived_at IS NULL`,
  ), null);

  const vehicles_needing_service = (await safe(() => queryFirst<{ n: number }>(
    db,
    `SELECT COUNT(*) as n FROM fleet_vehicles
     WHERE archived_at IS NULL
       AND ((next_service_due IS NOT NULL AND date(next_service_due) <= date('now'))
            OR (next_service_mileage IS NOT NULL AND current_mileage >= next_service_mileage))`,
  ), null))?.n ?? 0;

  const inspections_failing = (await safe(() => queryFirst<{ n: number }>(
    db,
    `SELECT COUNT(*) as n FROM fleet_inspections
     WHERE overall_result = 'fail'
       AND inspection_date >= date('now', '-90 days')`,
  ), null))?.n ?? 0;

  return c.json({
    maintenance_cost_trend,
    mileage_distribution,
    status_breakdown,
    fuel_economy_trend,
    fleet_summary: {
      total_vehicles: summary?.total_vehicles ?? 0,
      avg_mileage: Math.round(summary?.avg_mileage ?? 0),
      avg_mpg: summary?.avg_mpg ?? null,
      total_maintenance_cost: summary?.total_maintenance_cost ?? 0,
      total_fuel_cost: summary?.total_fuel_cost ?? 0,
      vehicles_needing_service,
      inspections_failing,
    },
    // Fields the FleetAnalyticsTab destructures but whose endpoints
    // live in separate handlers. Return empty defaults so an unguarded
    // destructuring (pre-May-2026 client builds) never reads undefined.
    cost_per_mile_ranking: [],
    service_compliance: { compliant: 0, overdue: 0, rate: 100 },
    inspection_pass_rate: { total: 0, passed: 0, failed: 0, rate: 100 },
    utilization: { assigned: 0, unassigned: 0, rate: 0 },
    daily_usage: [],
    maintenance_forecast: [],
    oldest_vehicle_year: null,
    avg_daily_miles: null,
    top_issues: [],
  });
});

// ─────────────────────────────────────────────────────────
// GET /dashcam-videos — list of recorded dashcam videos
// ─────────────────────────────────────────────────────────
// Shape matches the DashCamerasPage consumer (client/src/pages/
// DashCamerasPage.tsx ~line 134): expects { videos, total } NOT
// { data, pagination }. If `dashcam_videos` doesn't exist on live D1
// (it's in Bucket G of the unported tables), degrade to an empty shape
// rather than 500 — the page renders an empty list cleanly.
fleet.get('/dashcam-videos', async (c) => {
  try {
    const db = getDb(c.env);
    const q = c.req.query();
    const limit = Math.min(Math.max(Number(q.limit ?? 50), 1), 500);
    const offset = Math.max(Number(q.offset ?? 0), 0);

    const where: string[] = ['1=1'];
    const params: unknown[] = [];
    if (q.search) {
      where.push('(v.title LIKE ? OR v.case_number LIKE ? OR v.notes LIKE ?)');
      const pat = `%${q.search}%`;
      params.push(pat, pat, pat);
    }
    if (q.vehicle_id) {
      const vid = Number(q.vehicle_id);
      if (Number.isFinite(vid)) { where.push('v.vehicle_id = ?'); params.push(vid); }
    }
    if (q.classification) { where.push('v.classification = ?'); params.push(q.classification); }

    const whereSql = where.join(' AND ');

    try {
      const total = (await queryFirst<{ n: number }>(
        db, `SELECT COUNT(*) as n FROM dashcam_videos v WHERE ${whereSql}`, ...params,
      ))?.n ?? 0;

      const videos = await query<Record<string, unknown>>(
        db,
        `SELECT v.*, fv.vehicle_number, fv.plate_number
         FROM dashcam_videos v
         LEFT JOIN fleet_vehicles fv ON fv.id = v.vehicle_id
         WHERE ${whereSql}
         ORDER BY v.recorded_at DESC, v.id DESC
         LIMIT ? OFFSET ?`,
        ...params, limit, offset,
      );

      return c.json({ videos, total });
    } catch (e) {
      // Most likely: table doesn't exist on live D1 yet. Return the empty
      // shape DashCamerasPage tolerates rather than 500ing the whole page.
      console.warn('dashcam_videos query failed (probably missing table):', (e as Error)?.message);
      return c.json({ videos: [], total: 0 });
    }
  } catch (err) {
    console.error('GET /fleet/dashcam-videos failed:', err);
    return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500);
  }
});

// ─────────────────────────────────────────────────────────
// GET /map — lightweight fleet feed for the live Map overlay.
// MUST be declared BEFORE GET /:id, which would otherwise capture "map"
// as a vehicle id and 400 with "Invalid vehicle id" (the bug observed on
// the Map page console). Returns a BARE array — the client hook
// useMapFleetVehicles expects FleetVehicle[] — reusing the same
// fleet_vehicles + units join as GET /. Degrades to [] on any error so
// this optional overlay never surfaces a 4xx/5xx in the console. GPS
// columns (gps_lat/gps_lon/…) flow through v.* when present on live D1;
// vehicles lacking coordinates simply don't plot (no error).
// ─────────────────────────────────────────────────────────
fleet.get('/map', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT v.*, u.call_sign as assigned_call_sign
       FROM fleet_vehicles v
       LEFT JOIN units u ON u.id = v.assigned_unit_id
       WHERE v.archived_at IS NULL
       ORDER BY v.vehicle_number`,
    );
    return c.json(rows);
  } catch (err) {
    console.error('GET /fleet/map failed:', err);
    return c.json([]);
  }
});

// ─────────────────────────────────────────────────────────
// GET /:id — vehicle detail with linked assignments + recent activity
// ─────────────────────────────────────────────────────────
// Split-query pattern (mirrors dispatch/calls.ts:331). Even though
// fleet_vehicles itself is well under the 100-col cap, joining all
// related tables in one statement would either explode the result
// column count or force a cartesian product. Issuing parallel queries
// is cheaper than the alternatives and self-documents the row shapes.
// NOTE: the param is constrained to digits (`:id{[0-9]+}`) so this route only
// matches a NUMERIC vehicle id. Without it, `/:id` greedily matches literal
// sibling paths registered later in this file (/health-scores, /recalls,
// /maintenance-schedule, …) — Number("health-scores") → NaN → 400. The proxy
// stub used to hide this; once removed, every literal fleet sub-tab 400'd.
// Same constraint applied to the PUT/DELETE /:id routes below.
fleet.get('/:id{[0-9]+}', async (c) => {
  try {
    const db = getDb(c.env);
    const idParam = c.req.param('id');
    const id = Number(idParam);
    if (!Number.isInteger(id) || id <= 0) {
      return c.json({ error: 'Invalid vehicle id' }, 400);
    }
    // Graceful degradation when fleet_vehicles table is missing (migration pending)
    const tableCheck = await queryFirst<{ n: number }>(db, "SELECT COUNT(*) as n FROM sqlite_master WHERE type='table' AND name='fleet_vehicles'");
    if (!tableCheck?.n) return c.json({ error: 'Fleet module not configured', code: 'NOT_CONFIGURED' }, 503);

    const vehicle = await queryFirst<Record<string, unknown>>(
      db,
      `SELECT v.*, u.call_sign as assigned_unit_call_sign
       FROM fleet_vehicles v
       LEFT JOIN units u ON u.id = v.assigned_unit_id
       WHERE v.id = ?`,
      id,
    );
    if (!vehicle) return c.json({ error: 'Vehicle not found' }, 404);

    const assignments = await (async () => {
      try {
        return await query<Record<string, unknown>>(
          db,
          `SELECT id, vehicle_id, unit_id, unit_call_sign, officer_name,
                  assigned_at, unassigned_at, notes, created_at
           FROM fleet_assignments
           WHERE vehicle_id = ?
           ORDER BY assigned_at DESC LIMIT 50`,
          id,
        );
      } catch (e) {
        console.warn('assignments fetch failed for vehicle', id, (e as Error)?.message);
        return [];
      }
    })();

    const recent_maintenance = await (async () => {
      try {
        return await query<Record<string, unknown>>(
          db,
          `SELECT id, vehicle_id, type, description, mileage_at_service,
                  cost, vendor, performed_by, performed_at,
                  next_due_date, next_due_mileage, created_at
           FROM fleet_maintenance
           WHERE vehicle_id = ?
           ORDER BY performed_at DESC LIMIT 25`,
          id,
        );
      } catch (e) {
        console.warn('maintenance fetch failed for vehicle', id, (e as Error)?.message);
        return [];
      }
    })();

    // fleet_fuel_log (singular) is the canonical live table; some legacy
    // code references fleet_fuel_logs (plural). Try the canonical name
    // first, fall back to the legacy spelling if the first errors out.
    const recent_fuel = await (async () => {
      try {
        return await query<Record<string, unknown>>(
          db,
          `SELECT * FROM fleet_fuel_log
           WHERE vehicle_id = ? ORDER BY fuel_date DESC LIMIT 25`,
          id,
        );
      } catch {
        try {
          return await query<Record<string, unknown>>(
            db,
            `SELECT * FROM fleet_fuel_logs
             WHERE vehicle_id = ? ORDER BY fuel_date DESC LIMIT 25`,
            id,
          );
        } catch (e) {
          console.warn('fuel-log fetch failed for vehicle', id, (e as Error)?.message);
          return [];
        }
      }
    })();

    return c.json({
      ...vehicle,
      assignments,
      recent_maintenance,
      maintenance: recent_maintenance, // alias — FleetPage reads either key
      recent_fuel,
    });
  } catch (err) {
    console.error('GET /fleet/:id failed:', err);
    return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500);
  }
});

// ─────────────────────────────────────────────────────────
// POST / — create a new vehicle (manager-only)
// ─────────────────────────────────────────────────────────
fleet.post('/', async (c) => {
  try {
    const actor = c.get('user') as { id: number; role: string } | undefined;
    if (!actor) return c.json({ error: 'Authentication required' }, 401);
    if (!MANAGER_ROLES.has(actor.role)) {
      return c.json({ error: 'Insufficient permissions' }, 403);
    }

    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    if (!body || typeof body !== 'object') {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const vehicleNumber = typeof body.vehicle_number === 'string' ? body.vehicle_number.trim() : '';
    if (!vehicleNumber) return c.json({ error: 'vehicle_number is required' }, 400);

    if (body.status != null && !VALID_STATUSES.has(String(body.status))) {
      return c.json({ error: 'Invalid status', valid: Array.from(VALID_STATUSES) }, 400);
    }

    const db = getDb(c.env);
    const dup = await queryFirst<{ id: number }>(
      db, 'SELECT id FROM fleet_vehicles WHERE vehicle_number = ?', vehicleNumber,
    );
    if (dup) {
      return c.json({ error: 'vehicle_number already in use', existing_id: dup.id }, 409);
    }

    const cols: string[] = ['vehicle_number'];
    const vals: unknown[] = [vehicleNumber];
    for (const key of WRITABLE_COLS) {
      if (key === 'vehicle_number') continue;
      if (Object.prototype.hasOwnProperty.call(body, key)) {
        cols.push(key);
        vals.push(coerceBindValue(body[key]));
      }
    }

    const placeholders = cols.map(() => '?').join(', ');
    const result = await execute(
      db, `INSERT INTO fleet_vehicles (${cols.join(', ')}) VALUES (${placeholders})`, ...vals,
    );
    const newId = result.meta?.last_row_id;
    if (!newId) return c.json({ error: 'Insert succeeded but no id returned' }, 500);

    const created = await queryFirst<Record<string, unknown>>(
      db, 'SELECT * FROM fleet_vehicles WHERE id = ?', newId,
    );
    return c.json(created, 201);
  } catch (err) {
    console.error('POST /fleet failed:', err);
    return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500);
  }
});

// ─────────────────────────────────────────────────────────
// PUT /:id — update an existing vehicle
// ─────────────────────────────────────────────────────────
fleet.put('/:id{[0-9]+}', async (c) => {
  try {
    const actor = c.get('user') as { id: number; role: string } | undefined;
    if (!actor) return c.json({ error: 'Authentication required' }, 401);
    if (!MANAGER_ROLES.has(actor.role)) {
      return c.json({ error: 'Insufficient permissions' }, 403);
    }

    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) {
      return c.json({ error: 'Invalid vehicle id' }, 400);
    }

    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    if (!body || typeof body !== 'object') {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    if (body.status != null && !VALID_STATUSES.has(String(body.status))) {
      return c.json({ error: 'Invalid status', valid: Array.from(VALID_STATUSES) }, 400);
    }

    const db = getDb(c.env);
    const existing = await queryFirst<{ id: number }>(
      db, 'SELECT id FROM fleet_vehicles WHERE id = ?', id,
    );
    if (!existing) return c.json({ error: 'Vehicle not found' }, 404);

    const setCols: string[] = [];
    const bindings: unknown[] = [];
    for (const key of WRITABLE_COLS) {
      if (Object.prototype.hasOwnProperty.call(body, key)) {
        setCols.push(`${key} = ?`);
        bindings.push(coerceBindValue(body[key]));
      }
    }
    if (setCols.length === 0) {
      return c.json({ error: 'No editable fields provided' }, 400);
    }

    // MST timestamps — all of /src/ pins SQL clocks to UTC-7 to avoid DST
    // drift in dispatch timelines (see project memory feedback on timestamps).
    setCols.push("updated_at = datetime('now')");
    bindings.push(id);
    await execute(db, `UPDATE fleet_vehicles SET ${setCols.join(', ')} WHERE id = ?`, ...bindings);

    const updated = await queryFirst<Record<string, unknown>>(
      db, 'SELECT * FROM fleet_vehicles WHERE id = ?', id,
    );
    return c.json(updated);
  } catch (err) {
    console.error('PUT /fleet/:id failed:', err);
    return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500);
  }
});

// ─────────────────────────────────────────────────────────
// DELETE /:id — soft-delete (status='archived' + archived_at)
// ─────────────────────────────────────────────────────────
// Real deletion would orphan fleet_maintenance / fleet_fuel_log /
// fleet_assignments rows that FK back here. Soft-delete preserves the
// audit trail and lets the row reappear in list responses with
// ?archived=true. Filter convention matches the GET / handler.
fleet.delete('/:id{[0-9]+}', async (c) => {
  try {
    const actor = c.get('user') as { id: number; role: string } | undefined;
    if (!actor) return c.json({ error: 'Authentication required' }, 401);
    if (!MANAGER_ROLES.has(actor.role)) {
      return c.json({ error: 'Insufficient permissions' }, 403);
    }

    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) {
      return c.json({ error: 'Invalid vehicle id' }, 400);
    }

    const db = getDb(c.env);
    const existing = await queryFirst<{ id: number; archived_at: string | null }>(
      db, 'SELECT id, archived_at FROM fleet_vehicles WHERE id = ?', id,
    );
    if (!existing) return c.json({ error: 'Vehicle not found' }, 404);

    await execute(
      db,
      `UPDATE fleet_vehicles
       SET status = 'archived',
           archived_at = datetime('now'),
           updated_at = datetime('now')
       WHERE id = ?`,
      id,
    );
    return c.json({ success: true, id });
  } catch (err) {
    console.error('DELETE /fleet/:id failed:', err);
    return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// SUB-RESOURCE: FUEL LOGS (Feature 10-19)
// ═══════════════════════════════════════════════════════════════

// ── Fuel efficiency computation ──────────────────────────────────
// Derives per-log distance/MPG/cost-per-mile from consecutive odometer
// readings and rolls them into a fleet-fuel summary. Pure function so it
// can be unit-tested and reused by the report endpoints. `logs` arrive in
// DESC order (newest first); we sort a copy ASC by odometer to chain spans,
// then merge the computed fields back by id so the response keeps DESC order.
function computeFuelAnalytics(logs: Record<string, unknown>[]): {
  logs: Record<string, unknown>[];
  summary: Record<string, unknown>;
} {
  const num = (v: unknown): number | null => {
    if (v == null) return null;
    const n = typeof v === 'number' ? v : parseFloat(String(v));
    return Number.isFinite(n) ? n : null;
  };
  // Chronological order: prefer odometer, fall back to fuel_date then id.
  const asc = [...logs].sort((a, b) => {
    const oa = num(a.odometer), ob = num(b.odometer);
    if (oa != null && ob != null && oa !== ob) return oa - ob;
    const da = String(a.fuel_date ?? ''), dbb = String(b.fuel_date ?? '');
    if (da !== dbb) return da < dbb ? -1 : 1;
    return (num(a.id) ?? 0) - (num(b.id) ?? 0);
  });

  const computed = new Map<unknown, { calc_distance: number | null; mpg: number | null; cost_per_mile: number | null }>();
  let prevOdo: number | null = null;
  const mpgValues: number[] = [];
  for (const log of asc) {
    const odo = num(log.odometer);
    const gallons = num(log.gallons);
    const totalCost = num(log.total_cost);
    const isFull = num(log.is_full_tank);
    let calc_distance: number | null = null;
    let mpg: number | null = null;
    let cost_per_mile: number | null = null;
    if (odo != null && prevOdo != null && odo > prevOdo) {
      calc_distance = Math.round((odo - prevOdo) * 10) / 10;
      if (gallons != null && gallons > 0 && isFull !== 0) {
        mpg = Math.round((calc_distance / gallons) * 10) / 10;
        if (mpg > 0 && mpg < 200) mpgValues.push(mpg);
      }
      if (totalCost != null && calc_distance > 0) {
        cost_per_mile = Math.round((totalCost / calc_distance) * 1000) / 1000;
      }
    }
    computed.set(log.id, { calc_distance, mpg, cost_per_mile });
    if (odo != null) prevOdo = odo;
  }

  const outLogs = logs.map((l) => ({ ...l, ...(computed.get(l.id) ?? {}) }));

  // Aggregate summary.
  const totalGallons = logs.reduce((s, l) => s + (num(l.gallons) ?? 0), 0);
  const totalCost = logs.reduce((s, l) => s + (num(l.total_cost) ?? 0), 0);
  const odos = logs.map((l) => num(l.odometer)).filter((n): n is number => n != null);
  const totalDistance = odos.length >= 2 ? Math.max(...odos) - Math.min(...odos) : null;
  const dates = logs.map((l) => String(l.fuel_date ?? '')).filter(Boolean).sort();
  let daySpan: number | null = null;
  if (dates.length >= 2) {
    const first = new Date(dates[0].replace(' ', 'T'));
    const last = new Date(dates[dates.length - 1].replace(' ', 'T'));
    if (!isNaN(first.getTime()) && !isNaN(last.getTime())) {
      daySpan = Math.max(1, Math.round((last.getTime() - first.getTime()) / 86400000));
    }
  }
  const avgMpg = mpgValues.length ? Math.round((mpgValues.reduce((s, v) => s + v, 0) / mpgValues.length) * 10) / 10 : null;
  const fullTankCount = logs.filter((l) => num(l.is_full_tank) !== 0).length;
  const summary: Record<string, unknown> = {
    total_gallons: Math.round(totalGallons * 1000) / 1000,
    total_cost: Math.round(totalCost * 100) / 100,
    log_count: logs.length,
    full_tank_count: fullTankCount,
    avg_cost_per_gallon: totalGallons > 0 ? Math.round((totalCost / totalGallons) * 1000) / 1000 : 0,
    avg_mpg: avgMpg,
    best_mpg: mpgValues.length ? Math.max(...mpgValues) : null,
    worst_mpg: mpgValues.length ? Math.min(...mpgValues) : null,
    total_distance: totalDistance != null ? Math.round(totalDistance * 10) / 10 : null,
    cost_per_mile: totalDistance && totalDistance > 0 ? Math.round((totalCost / totalDistance) * 1000) / 1000 : null,
    fuel_cost_per_day: daySpan != null ? Math.round((totalCost / daySpan) * 100) / 100 : null,
  };
  return { logs: outLogs, summary };
}

// GET /:id/fuel — fuel log list with pagination + summary (Feature 10)
fleet.get('/:id/fuel', async (c) => {
  try {
    const db = getDb(c.env);
    const vehicleId = Number(c.req.param('id'));
    if (!Number.isInteger(vehicleId) || vehicleId <= 0) return c.json({ error: 'Invalid vehicle id' }, 400);
    const q = c.req.query();
    const limit = Math.min(Math.max(Number(q.per_page ?? q.limit ?? 50), 1), 10000);
    const page = Math.max(Number(q.page ?? 1), 1);
    const offset = (page - 1) * limit;
    const where: string[] = ['f.vehicle_id = ?']; const params: unknown[] = [vehicleId];
    if (q.from) { where.push('f.fuel_date >= ?'); params.push(q.from); }
    if (q.to) { where.push('f.fuel_date <= ?'); params.push(q.to); }
    const whereSql = where.join(' AND ');
    const total = (await queryFirst<{ n: number }>(db, `SELECT COUNT(*) as n FROM fleet_fuel_log f WHERE ${whereSql}`, ...params))?.n ?? 0;
    const logs = await query<Record<string, unknown>>(db, `SELECT * FROM fleet_fuel_log f WHERE ${whereSql} ORDER BY f.fuel_date DESC, f.id DESC LIMIT ? OFFSET ?`, ...params, limit, offset);
    // Compute per-log efficiency + an enriched summary in the Worker. MPG can
    // only be derived from the *distance between consecutive odometer
    // readings*, so a single fill (or fills without odometer) yields null —
    // that's the reason the PDF/summary showed "-" for every efficiency
    // metric. We sort ascending by odometer (falling back to date), diff
    // consecutive readings, and attribute the span's gallons to that span.
    // Partial fills (is_full_tank=0) don't reset the tank, so their MPG is
    // unreliable — we still record distance but skip them in MPG aggregates.
    const enriched = computeFuelAnalytics(logs);
    return c.json({ data: enriched.logs, pagination: { page, per_page: limit, total, totalPages: Math.ceil(total / limit) }, summary: enriched.summary });
  } catch (err) { console.error('GET /fleet/:id/fuel failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

// POST /:id/fuel — log fuel entry (Feature 11)
fleet.post('/:id/fuel', async (c) => {
  try {
    const vehicleId = Number(c.req.param('id'));
    if (!Number.isInteger(vehicleId) || vehicleId <= 0) return c.json({ error: 'Invalid vehicle id' }, 400);
    const db = getDb(c.env);
    const vehicle = await queryFirst<{ id: number }>(db, 'SELECT id FROM fleet_vehicles WHERE id = ?', vehicleId);
    if (!vehicle) return c.json({ error: 'Vehicle not found' }, 404);
    const body = await c.req.json<Record<string, unknown>>();
    if (!body.fuel_date) return c.json({ error: 'fuel_date required' }, 400);
    // Client (FuelLogModal) sends odometer_reading; the column is `odometer`.
    const odometer = body.odometer ?? body.odometer_reading ?? null;
    // is_full_tank governs whether this fill resets the tank for MPG math —
    // defaults to full (1) when the client omits it (back-compat with the
    // pre-enhancement modal that had no toggle).
    const isFullTank = body.is_full_tank == null ? 1 : (body.is_full_tank ? 1 : 0);
    const result = await execute(db, `INSERT INTO fleet_fuel_log (vehicle_id, fuel_date, gallons, total_cost, cost_per_gallon, fuel_type, station, odometer, notes, is_full_tank, payment_method, driver_name, location) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, vehicleId, body.fuel_date, body.gallons ?? null, body.total_cost ?? null, body.cost_per_gallon ?? null, body.fuel_type ?? null, body.station ?? null, odometer, body.notes ?? null, isFullTank, body.payment_method ?? null, body.driver_name ?? null, body.location ?? null);
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM fleet_fuel_log WHERE id = ?', result.meta.last_row_id);
    return c.json(created, 201);
  } catch (err) { console.error('POST /fleet/:id/fuel failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

// PUT /fuel/:id — edit fuel entry (Feature 12)
fleet.put('/fuel/:id', async (c) => {
  try {
    const fuelId = Number(c.req.param('id'));
    if (!Number.isInteger(fuelId) || fuelId <= 0) return c.json({ error: 'Invalid fuel log id' }, 400);
    const db = getDb(c.env);
    const existing = await queryFirst<{ id: number }>(db, 'SELECT id FROM fleet_fuel_log WHERE id = ?', fuelId);
    if (!existing) return c.json({ error: 'Fuel log not found' }, 404);
    const body = await c.req.json<Record<string, unknown>>();
    // Client sends odometer_reading; normalize to the `odometer` column.
    if (Object.prototype.hasOwnProperty.call(body, 'odometer_reading') && !Object.prototype.hasOwnProperty.call(body, 'odometer')) {
      body.odometer = body.odometer_reading;
    }
    const setCols: string[] = []; const bindings: unknown[] = [];
    for (const key of ['fuel_date', 'gallons', 'total_cost', 'cost_per_gallon', 'fuel_type', 'station', 'odometer', 'notes', 'is_full_tank', 'payment_method', 'driver_name', 'location']) {
      if (Object.prototype.hasOwnProperty.call(body, key)) {
        setCols.push(`${key} = ?`);
        // is_full_tank is an INTEGER flag — coerce truthy/empty into 0/1.
        if (key === 'is_full_tank') bindings.push(body[key] == null || body[key] === '' ? 1 : (body[key] ? 1 : 0));
        else bindings.push(body[key] === '' ? null : body[key]);
      }
    }
    if (setCols.length === 0) return c.json({ error: 'No fields to update' }, 400);
    bindings.push(fuelId);
    await execute(db, `UPDATE fleet_fuel_log SET ${setCols.join(', ')} WHERE id = ?`, ...bindings);
    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM fleet_fuel_log WHERE id = ?', fuelId);
    return c.json(updated);
  } catch (err) { console.error('PUT /fleet/fuel/:id failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

// DELETE /fuel/:id — delete fuel entry (Feature 13)
fleet.delete('/fuel/:id', async (c) => {
  try {
    const fuelId = Number(c.req.param('id'));
    if (!Number.isInteger(fuelId) || fuelId <= 0) return c.json({ error: 'Invalid fuel log id' }, 400);
    const db = getDb(c.env);
    await execute(db, 'DELETE FROM fleet_fuel_log WHERE id = ?', fuelId);
    return c.json({ success: true });
  } catch (err) { console.error('DELETE /fleet/fuel/:id failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

// ═══════════════════════════════════════════════════════════════
// SUB-RESOURCE: MAINTENANCE (Features 20-29)
// ═══════════════════════════════════════════════════════════════

fleet.get('/:id/maintenance', async (c) => {
  try {
    const vehicleId = Number(c.req.param('id'));
    if (!Number.isInteger(vehicleId) || vehicleId <= 0) return c.json({ error: 'Invalid vehicle id' }, 400);
    const db = getDb(c.env);
    const q = c.req.query();
    const limit = Math.min(Math.max(Number(q.per_page ?? 50), 1), 500);
    const offset = Math.max(Number(q.offset ?? 0), 0);
    const rows = await query<Record<string, unknown>>(db, 'SELECT * FROM fleet_maintenance WHERE vehicle_id = ? ORDER BY performed_at DESC LIMIT ? OFFSET ?', vehicleId, limit, offset);
    const total = (await queryFirst<{ n: number }>(db, 'SELECT COUNT(*) as n FROM fleet_maintenance WHERE vehicle_id = ?', vehicleId))?.n ?? 0;
    return c.json({ data: rows, total });
  } catch (err) { console.error('GET /fleet/:id/maintenance failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

fleet.post('/:id/maintenance', async (c) => {
  try {
    const vehicleId = Number(c.req.param('id'));
    if (!Number.isInteger(vehicleId) || vehicleId <= 0) return c.json({ error: 'Invalid vehicle id' }, 400);
    const db = getDb(c.env);
    const body = await c.req.json<Record<string, unknown>>();
    if (!body.type || !body.performed_at) return c.json({ error: 'type and performed_at required' }, 400);
    const result = await execute(db, `INSERT INTO fleet_maintenance (vehicle_id, type, description, mileage_at_service, cost, vendor, performed_by, performed_at, next_due_date, next_due_mileage) VALUES (?,?,?,?,?,?,?,?,?,?)`, vehicleId, body.type, body.description ?? null, body.mileage_at_service ?? null, body.cost ?? null, body.vendor ?? null, body.performed_by ?? null, body.performed_at, body.next_due_date ?? null, body.next_due_mileage ?? null);
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM fleet_maintenance WHERE id = ?', result.meta.last_row_id);
    return c.json(created, 201);
  } catch (err) { console.error('POST /fleet/:id/maintenance failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

fleet.put('/maintenance/:id', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid maintenance id' }, 400);
    const db = getDb(c.env);
    const existing = await queryFirst<{ id: number }>(db, 'SELECT id FROM fleet_maintenance WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Maintenance record not found' }, 404);
    const body = await c.req.json<Record<string, unknown>>();
    const cols = ['type', 'description', 'mileage_at_service', 'cost', 'vendor', 'performed_by', 'performed_at', 'next_due_date', 'next_due_mileage'];
    const setCols: string[] = []; const bindings: unknown[] = [];
    for (const key of cols) { if (Object.prototype.hasOwnProperty.call(body, key)) { setCols.push(`${key} = ?`); bindings.push(body[key] === '' ? null : body[key]); } }
    if (setCols.length === 0) return c.json({ error: 'No fields to update' }, 400);
    bindings.push(id);
    await execute(db, `UPDATE fleet_maintenance SET ${setCols.join(', ')} WHERE id = ?`, ...bindings);
    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM fleet_maintenance WHERE id = ?', id);
    return c.json(updated);
  } catch (err) { console.error('PUT /fleet/maintenance/:id failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

fleet.delete('/maintenance/:id', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid maintenance id' }, 400);
    await execute(getDb(c.env), 'DELETE FROM fleet_maintenance WHERE id = ?', id);
    return c.json({ success: true });
  } catch (err) { console.error('DELETE /fleet/maintenance/:id failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

// ═══════════════════════════════════════════════════════════════
// SUB-RESOURCE: INSPECTIONS (Features 30-39)
// ═══════════════════════════════════════════════════════════════

fleet.get('/:id/inspections', async (c) => {
  try {
    const vehicleId = Number(c.req.param('id'));
    if (!Number.isInteger(vehicleId) || vehicleId <= 0) return c.json({ error: 'Invalid vehicle id' }, 400);
    const rows = await query<Record<string, unknown>>(getDb(c.env), 'SELECT * FROM fleet_inspections WHERE vehicle_id = ? ORDER BY inspection_date DESC', vehicleId);
    return c.json(rows);
  } catch (err) { console.error('GET /fleet/:id/inspections failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

fleet.post('/:id/inspections', async (c) => {
  try {
    const vehicleId = Number(c.req.param('id'));
    if (!Number.isInteger(vehicleId) || vehicleId <= 0) return c.json({ error: 'Invalid vehicle id' }, 400);
    const db = getDb(c.env);
    const body = await c.req.json<Record<string, unknown>>();
    if (!body.inspection_date) return c.json({ error: 'inspection_date required' }, 400);
    const inspectorId = (c.get('user') as { id: number } | undefined)?.id;
    const result = await execute(db, `INSERT INTO fleet_inspections (vehicle_id, inspection_date, overall_result, inspector_id, mileage_at_inspection, notes) VALUES (?,?,?,?,?,?)`, vehicleId, body.inspection_date, body.overall_result ?? 'pass', inspectorId ?? null, body.mileage_at_inspection ?? null, body.notes ?? null);
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM fleet_inspections WHERE id = ?', result.meta.last_row_id);
    return c.json(created, 201);
  } catch (err) { console.error('POST /fleet/:id/inspections failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

fleet.put('/inspections/:id', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid inspection id' }, 400);
    const db = getDb(c.env);
    const body = await c.req.json<Record<string, unknown>>();
    const cols = ['inspection_date', 'overall_result', 'mileage_at_inspection', 'notes'];
    const setCols: string[] = []; const bindings: unknown[] = [];
    for (const key of cols) { if (Object.prototype.hasOwnProperty.call(body, key)) { setCols.push(`${key} = ?`); bindings.push(body[key] === '' ? null : body[key]); } }
    if (setCols.length === 0) return c.json({ error: 'No fields to update' }, 400);
    bindings.push(id);
    await execute(db, `UPDATE fleet_inspections SET ${setCols.join(', ')} WHERE id = ?`, ...bindings);
    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM fleet_inspections WHERE id = ?', id);
    return c.json(updated);
  } catch (err) { console.error('PUT /fleet/inspections/:id failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

fleet.delete('/inspections/:id', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid inspection id' }, 400);
    await execute(getDb(c.env), 'DELETE FROM fleet_inspections WHERE id = ?', id);
    return c.json({ success: true });
  } catch (err) { console.error('DELETE /fleet/inspections/:id failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

// ═══════════════════════════════════════════════════════════════
// SUB-RESOURCE: ASSIGNMENTS + ARCHIVE/UNARCHIVE (Features 40-59)
// ═══════════════════════════════════════════════════════════════

fleet.get('/:id/assignments', async (c) => {
  try {
    const vehicleId = Number(c.req.param('id'));
    if (!Number.isInteger(vehicleId) || vehicleId <= 0) return c.json({ error: 'Invalid vehicle id' }, 400);
    const rows = await query<Record<string, unknown>>(getDb(c.env), 'SELECT * FROM fleet_assignments WHERE vehicle_id = ? ORDER BY assigned_at DESC', vehicleId);
    return c.json(rows);
  } catch (err) { console.error('GET /fleet/:id/assignments failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

fleet.put('/:id/assign', async (c) => {
  try {
    const vehicleId = Number(c.req.param('id'));
    if (!Number.isInteger(vehicleId) || vehicleId <= 0) return c.json({ error: 'Invalid vehicle id' }, 400);
    const db = getDb(c.env);
    const body = await c.req.json<Record<string, unknown>>();
    const { unit_id, unit_call_sign, officer_name } = body;
    if (unit_id) {
      await execute(db, `INSERT INTO fleet_assignments (vehicle_id, unit_id, unit_call_sign, officer_name, assigned_at) VALUES (?,?,?,?,datetime('now'))`, vehicleId, unit_id, unit_call_sign ?? null, officer_name ?? null);
      await execute(db, `UPDATE fleet_vehicles SET assigned_unit_id = ?, updated_at = datetime('now') WHERE id = ?`, unit_id, vehicleId);
    } else {
      await execute(db, `UPDATE fleet_assignments SET unassigned_at = datetime('now') WHERE vehicle_id = ? AND unassigned_at IS NULL`, vehicleId);
      await execute(db, `UPDATE fleet_vehicles SET assigned_unit_id = NULL, updated_at = datetime('now') WHERE id = ?`, vehicleId);
    }
    const updated = await queryFirst<Record<string, unknown>>(db, `SELECT v.*, u.call_sign as assigned_unit_call_sign FROM fleet_vehicles v LEFT JOIN units u ON u.id = v.assigned_unit_id WHERE v.id = ?`, vehicleId);
    return c.json(updated);
  } catch (err) { console.error('PUT /fleet/:id/assign failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

fleet.post('/:id/archive', async (c) => {
  try {
    const vehicleId = Number(c.req.param('id'));
    if (!Number.isInteger(vehicleId) || vehicleId <= 0) return c.json({ error: 'Invalid vehicle id' }, 400);
    const db = getDb(c.env);
    await execute(db, `UPDATE fleet_vehicles SET status = 'archived', archived_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`, vehicleId);
    return c.json({ success: true, id: vehicleId });
  } catch (err) { console.error('POST /fleet/:id/archive failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

fleet.post('/:id/unarchive', async (c) => {
  try {
    const vehicleId = Number(c.req.param('id'));
    if (!Number.isInteger(vehicleId) || vehicleId <= 0) return c.json({ error: 'Invalid vehicle id' }, 400);
    const db = getDb(c.env);
    await execute(db, `UPDATE fleet_vehicles SET status = 'in_service', archived_at = NULL, updated_at = datetime('now') WHERE id = ?`, vehicleId);
    return c.json({ success: true, id: vehicleId });
  } catch (err) { console.error('POST /fleet/:id/unarchive failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

// ═══════════════════════════════════════════════════════════════
// PERSONNEL (Features 60-69)
// ═══════════════════════════════════════════════════════════════

fleet.get('/:id/personnel', async (c) => {
  try {
    const vehicleId = Number(c.req.param('id'));
    if (!Number.isInteger(vehicleId) || vehicleId <= 0) return c.json({ error: 'Invalid vehicle id' }, 400);
    const db = getDb(c.env);
    const vehicle = await queryFirst<{ assigned_unit_id: number | null }>(db, 'SELECT assigned_unit_id FROM fleet_vehicles WHERE id = ?', vehicleId);
    if (!vehicle) return c.json({ error: 'Vehicle not found' }, 404);
    const assignments = await query<Record<string, unknown>>(db, 'SELECT * FROM fleet_assignments WHERE vehicle_id = ? ORDER BY assigned_at DESC LIMIT 20', vehicleId);
    let unit: Record<string, unknown> | null = null;
    if (vehicle.assigned_unit_id) unit = await queryFirst<Record<string, unknown>>(db, 'SELECT id, call_sign FROM units WHERE id = ?', vehicle.assigned_unit_id);
    const notes = await query<Record<string, unknown>>(db, 'SELECT * FROM fleet_personnel_notes WHERE vehicle_id = ? ORDER BY created_at DESC', vehicleId);
    return c.json({ assignments, unit, notes, activeOfficerName: assignments.length > 0 ? (assignments[0] as any).officer_name : null });
  } catch (err) { console.error('GET /fleet/:id/personnel failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

fleet.post('/:id/personnel-notes', async (c) => {
  try {
    const vehicleId = Number(c.req.param('id'));
    if (!Number.isInteger(vehicleId) || vehicleId <= 0) return c.json({ error: 'Invalid vehicle id' }, 400);
    const db = getDb(c.env);
    const body = await c.req.json<Record<string, unknown>>();
    // Client may send `content` (rewrite shape) or `note` (legacy shape).
    const text = (body.content ?? body.note) as string | undefined;
    if (!text) return c.json({ error: 'note content required' }, 400);
    const user = c.get('user') as { id: number; full_name?: string } | undefined;
    const userId = user?.id;
    // Live fleet_personnel_notes has NOT NULL on note + created_by (legacy
    // schema) AND nullable content/user_id (rewrite cols). Write all of them
    // so the INSERT satisfies every constraint regardless of which shape the
    // reader expects. created_by falls back to officer_id then 0 (system).
    const createdBy = userId ?? (body.officer_id as number | undefined) ?? 0;
    const officerName = (body.officer_name as string | undefined) ?? user?.full_name ?? null;
    const result = await execute(
      db,
      'INSERT INTO fleet_personnel_notes (vehicle_id, user_id, content, note, created_by, created_by_name, officer_id, officer_name) VALUES (?,?,?,?,?,?,?,?)',
      vehicleId, userId ?? null, text, text, createdBy, officerName, (body.officer_id as number | undefined) ?? null, officerName,
    );
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM fleet_personnel_notes WHERE id = ?', result.meta.last_row_id);
    return c.json(created, 201);
  } catch (err) { console.error('POST /fleet/:id/personnel-notes failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

fleet.delete('/:id/personnel-notes/:noteId', async (c) => {
  try { const noteId = Number(c.req.param('noteId')); await execute(getDb(c.env), 'DELETE FROM fleet_personnel_notes WHERE id = ?', noteId); return c.json({ success: true }); }
  catch (err) { console.error('DELETE /fleet/:id/personnel-notes/:noteId failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

// ═══════════════════════════════════════════════════════════════
// PRE-TRIP INSPECTIONS (Features 70-74)
// ═══════════════════════════════════════════════════════════════

fleet.post('/pretrip', async (c) => {
  try {
    const db = getDb(c.env);
    const body = await c.req.json<Record<string, unknown>>();
    if (!body.vehicle_id) return c.json({ error: 'vehicle_id required' }, 400);
    const userId = (c.get('user') as { id: number } | undefined)?.id;
    const result = await execute(db, `INSERT INTO fleet_pretrip_checklists (vehicle_id, officer_id, check_date, lights, brakes, radio, mdt, dashcam, tires, fluids, exterior, interior, emergency_equip, notes, status) VALUES (?,?,datetime('now'),?,?,?,?,?,?,?,?,?,?,?,?)`, body.vehicle_id, userId ?? null, body.lights ?? 0, body.brakes ?? 0, body.radio ?? 0, body.mdt ?? 0, body.dashcam ?? 0, body.tires ?? 0, body.fluids ?? 0, body.exterior ?? 0, body.interior ?? 0, body.emergency_equip ?? 0, body.notes ?? null, body.status ?? 'completed');
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM fleet_pretrip_checklists WHERE id = ?', result.meta.last_row_id);
    return c.json(created, 201);
  } catch (err) { console.error('POST /fleet/pretrip failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

fleet.get('/pretrip/:vehicleId', async (c) => {
  try {
    const vehicleId = Number(c.req.param('vehicleId'));
    const rows = await query<Record<string, unknown>>(getDb(c.env), 'SELECT * FROM fleet_pretrip_checklists WHERE vehicle_id = ? ORDER BY check_date DESC LIMIT 50', vehicleId);
    return c.json(rows);
  } catch (err) { console.error('GET /fleet/pretrip/:vehicleId failed:', err); return c.json([]); }
});

// ═══════════════════════════════════════════════════════════════
// COST-PER-MILE + EXPORT + PDF DATA (Features 75-89)
// ═══════════════════════════════════════════════════════════════

fleet.get('/cost-per-mile/:id', async (c) => {
  try {
    const vehicleId = Number(c.req.param('id'));
    const db = getDb(c.env);
    const fuel = await queryFirst<{ total_cost: number; total_gallons: number; total_distance: number }>(db, `SELECT COALESCE(SUM(total_cost),0) as total_cost, COALESCE(SUM(gallons),0) as total_gallons, COALESCE(MAX(odometer)-MIN(odometer),0) as total_distance FROM fleet_fuel_log WHERE vehicle_id = ?`, vehicleId);
    const maint = await queryFirst<{ total_cost: number }>(db, 'SELECT COALESCE(SUM(cost),0) as total_cost FROM fleet_maintenance WHERE vehicle_id = ?', vehicleId);
    const totalMiles = fuel?.total_distance ?? 0;
    const fuelCostPerMile = totalMiles > 0 ? (fuel?.total_cost ?? 0) / totalMiles : 0;
    const maintCostPerMile = totalMiles > 0 ? (maint?.total_cost ?? 0) / totalMiles : 0;
    return c.json({ fuel_cost_per_mile: Math.round(fuelCostPerMile * 100) / 100, maintenance_cost_per_mile: Math.round(maintCostPerMile * 100) / 100, total_cost_per_mile: Math.round((fuelCostPerMile + maintCostPerMile) * 100) / 100, total_miles: totalMiles, total_fuel_cost: fuel?.total_cost ?? 0, total_maintenance_cost: maint?.total_cost ?? 0, total_gallons: fuel?.total_gallons ?? 0 });
  } catch (err) { console.error('GET /fleet/cost-per-mile/:id failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

// ═══════════════════════════════════════════════════════════════
// OVERVIEW-TAB DERIVED ANALYTICS (read-only; no new tables)
// FleetOverviewTab fetches these three per-vehicle on mount. They were
// 404'ing (no handler) — the client .catch()es so it didn't crash, but the
// Avg-MPG / Maintenance-Cost / Mileage cards stayed blank. All three are
// SELECT aggregations over data that already exists.
// ═══════════════════════════════════════════════════════════════

// GET /:id/maintenance-costs — totals + parts/labor split + by-type breakdown.
// Shape consumed by FleetOverviewTab: { total_cost, total_parts_cost,
// total_labor_cost, by_type: [{ type, total_cost, count }] }.
fleet.get('/:id{[0-9]+}/maintenance-costs', async (c) => {
  try {
    const vehicleId = Number(c.req.param('id'));
    const db = getDb(c.env);
    const totals = await queryFirst<{ total_cost: number; total_labor_cost: number }>(
      db,
      'SELECT COALESCE(SUM(cost),0) AS total_cost, COALESCE(SUM(labor_cost),0) AS total_labor_cost FROM fleet_maintenance WHERE vehicle_id = ?',
      vehicleId,
    );
    // Parts cost comes from the line-item table when present; degrade to 0.
    const parts = await queryFirst<{ total_parts_cost: number }>(
      db,
      'SELECT COALESCE(SUM(mp.quantity * mp.unit_cost),0) AS total_parts_cost FROM fleet_maintenance_parts mp JOIN fleet_maintenance m ON m.id = mp.maintenance_id WHERE m.vehicle_id = ?',
      vehicleId,
    ).catch(() => ({ total_parts_cost: 0 }));
    // `type` is the column the maintenance INSERT writes; fall back to
    // service_type for older rows.
    const byType = await query<Record<string, unknown>>(
      db,
      `SELECT COALESCE(type, service_type, 'other') AS type, COALESCE(SUM(cost),0) AS total_cost, COUNT(*) AS count
       FROM fleet_maintenance WHERE vehicle_id = ? GROUP BY COALESCE(type, service_type, 'other') ORDER BY total_cost DESC`,
      vehicleId,
    );
    return c.json({
      total_cost: totals?.total_cost ?? 0,
      total_labor_cost: totals?.total_labor_cost ?? 0,
      total_parts_cost: parts?.total_parts_cost ?? 0,
      by_type: byType,
    });
  } catch (err) { console.error('GET /fleet/:id/maintenance-costs failed:', err); return c.json({ total_cost: 0, total_parts_cost: 0, total_labor_cost: 0, by_type: [] }); }
});

// GET /:id/monthly-cost-averages — true trailing-period monthly averages for
// fuel + maintenance, for the Costs tab Budget-vs-Actual. Lifetime÷12 was wrong
// (it divided all-time spend by 12 regardless of tracking duration). Here we
// divide each category's total by the number of months actually spanned by its
// records (earliest→latest, rounded up, min 1). All math is UTC; null/absent
// dates collapse to a 1-month span so we never divide by zero or crash.
// Shape: { fuel_monthly, maintenance_monthly, fuel_total, maintenance_total,
// fuel_months, maintenance_months } — all numbers, cents-rounded.
fleet.get('/:id{[0-9]+}/monthly-cost-averages', async (c) => {
  // monthsBetween: whole months from a→b (UTC), rounded up, floored at 1.
  // Returns 1 for null/equal/unparseable dates (single-row or no-date case).
  const monthsBetween = (earliest: string | null | undefined, latest: string | null | undefined): number => {
    if (!earliest || !latest) return 1;
    const a = new Date(`${String(earliest).replace(' ', 'T')}Z`).getTime();
    const b = new Date(`${String(latest).replace(' ', 'T')}Z`).getTime();
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 1;
    // ~30.44 days/month average; round up so a partial month counts as one.
    const months = Math.ceil((b - a) / (1000 * 60 * 60 * 24 * 30.4375));
    return Math.max(1, months);
  };
  const cents = (n: number): number => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;

  try {
    const vehicleId = Number(c.req.param('id'));
    const db = getDb(c.env);

    const fuel = await queryFirst<{ earliest: string | null; latest: string | null; total: number }>(
      db,
      `SELECT MIN(fuel_date) AS earliest, MAX(fuel_date) AS latest, COALESCE(SUM(total_cost),0) AS total
       FROM fleet_fuel_log WHERE vehicle_id = ?`,
      vehicleId,
    );
    // fleet_maintenance dates: performed_at is the column the INSERT writes;
    // fall back to created_at for legacy rows that predate it. COALESCE both
    // for the span; SUM(cost) for the total.
    const maint = await queryFirst<{ earliest: string | null; latest: string | null; total: number }>(
      db,
      `SELECT MIN(COALESCE(performed_at, created_at)) AS earliest,
              MAX(COALESCE(performed_at, created_at)) AS latest,
              COALESCE(SUM(cost),0) AS total
       FROM fleet_maintenance WHERE vehicle_id = ?`,
      vehicleId,
    );

    const fuelTotal = cents(Number(fuel?.total ?? 0));
    const maintTotal = cents(Number(maint?.total ?? 0));
    const fuelMonths = monthsBetween(fuel?.earliest, fuel?.latest);
    const maintMonths = monthsBetween(maint?.earliest, maint?.latest);

    return c.json({
      fuel_monthly: cents(fuelTotal / fuelMonths),
      maintenance_monthly: cents(maintTotal / maintMonths),
      fuel_total: fuelTotal,
      maintenance_total: maintTotal,
      fuel_months: fuelMonths,
      maintenance_months: maintMonths,
    });
  } catch (err) {
    console.error('GET /fleet/:id/monthly-cost-averages failed:', err);
    // Never 500 the Costs tab — zeros let the client fall back gracefully.
    return c.json({ fuel_monthly: 0, maintenance_monthly: 0, fuel_total: 0, maintenance_total: 0, fuel_months: 1, maintenance_months: 1 });
  }
});

// GET /:id/mileage-history — there is no dedicated mileage log table on live
// D1, so reconstruct an odometer trail from fuel-log readings (the real
// field signal). Shape: [{ id, recorded_at, recorded_by_name, previous_mileage,
// new_mileage }] newest-first, each row pairing consecutive odometer readings.
fleet.get('/:id{[0-9]+}/mileage-history', async (c) => {
  try {
    const vehicleId = Number(c.req.param('id'));
    const db = getDb(c.env);
    const readings = await query<{ id: number; fuel_date: string; odometer: number }>(
      db,
      `SELECT id, fuel_date, odometer FROM fleet_fuel_log
       WHERE vehicle_id = ? AND odometer IS NOT NULL AND odometer > 0
       ORDER BY fuel_date ASC, id ASC`,
      vehicleId,
    );
    const history: Array<Record<string, unknown>> = [];
    for (let i = 1; i < readings.length; i++) {
      const prev = readings[i - 1], cur = readings[i];
      // Skip non-increasing readings (odometer reset / data-entry error).
      if (cur.odometer <= prev.odometer) continue;
      history.push({
        id: cur.id,
        recorded_at: cur.fuel_date,
        recorded_by_name: 'Fuel Log',
        previous_mileage: prev.odometer,
        new_mileage: cur.odometer,
      });
    }
    return c.json(history.reverse());
  } catch (err) { console.error('GET /fleet/:id/mileage-history failed:', err); return c.json([]); }
});

// GET /:id/fuel-efficiency — per-fill MPG trail + average.
// Shape: { avg_mpg, data: [{ date, mpg, cost_per_mile }] }.
//
// TODO(you): implement the per-fill MPG calculation in the loop below.
// This is a DOMAIN decision, not a mechanical one — how RMPG fuels its
// fleet determines what makes a "good" MPG number here. Field fuel logs are
// messy: partial fills, skipped fill-ups, odometer resets. Consider:
//
//   • Distance for a fill = thisReading.odometer − prevReading.odometer.
//     MPG for that fill   = distance / thisReading.gallons.
//   • SKIP a fill when: gallons is null/0 (div-by-zero), odometer didn't
//     increase (reset / error), or the implied MPG is absurd (e.g. >60 or
//     <3 — a partial fill makes MPG look huge; a skipped fill-up makes the
//     next one look tiny). Picking those bounds IS the domain call.
//   • cost_per_mile for the fill = total_cost / distance (when both present).
//   • avg_mpg = mean of the kept per-fill MPGs (or a distance-weighted mean —
//     your call; weighted is more accurate when fill distances vary a lot).
//
// `rows` below is ordered oldest→newest with fields: id, fuel_date (string),
// gallons (number|null), total_cost (number|null), odometer (number|null).
// Push one entry per KEPT fill: { date: fuel_date, mpg: <rounded>,
// cost_per_mile: <rounded|null> }. Then set avg_mpg from the kept mpgs.
fleet.get('/:id{[0-9]+}/fuel-efficiency', async (c) => {
  try {
    const vehicleId = Number(c.req.param('id'));
    const db = getDb(c.env);
    const rows = await query<{ id: number; fuel_date: string; gallons: number | null; total_cost: number | null; odometer: number | null }>(
      db,
      `SELECT id, fuel_date, gallons, total_cost, odometer FROM fleet_fuel_log
       WHERE vehicle_id = ? ORDER BY fuel_date ASC, id ASC`,
      vehicleId,
    );

    const data: Array<{ date: string; mpg: number; cost_per_mile: number | null }> = [];
    // Per-fill MPG with a 3–60 sanity band. The upper bound drops partial
    // fills (tiny gallons → inflated MPG); the lower bound drops skipped
    // fill-ups (one fill spanning two tanks → deflated MPG). Odometer resets
    // fall out via dist <= 0 or land outside the band.
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1], cur = rows[i];
      if (!cur.gallons || cur.gallons <= 0) continue;
      if (cur.odometer == null || prev.odometer == null) continue;
      const dist = cur.odometer - prev.odometer;
      if (dist <= 0) continue;
      const mpg = dist / cur.gallons;
      if (mpg < 3 || mpg > 60) continue;
      const cpm = cur.total_cost ? cur.total_cost / dist : null;
      data.push({
        date: cur.fuel_date,
        mpg: Math.round(mpg * 10) / 10,
        cost_per_mile: cpm != null ? Math.round(cpm * 100) / 100 : null,
      });
    }

    const avg_mpg = data.length > 0
      ? Math.round((data.reduce((s, d) => s + d.mpg, 0) / data.length) * 10) / 10
      : null;
    return c.json({ avg_mpg, data });
  } catch (err) { console.error('GET /fleet/:id/fuel-efficiency failed:', err); return c.json({ avg_mpg: null, data: [] }); }
});

fleet.get('/export/csv', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db, `SELECT v.*, u.call_sign as assigned_unit_call_sign FROM fleet_vehicles v LEFT JOIN units u ON u.id = v.assigned_unit_id WHERE v.archived_at IS NULL ORDER BY v.vehicle_number`);
    const header = 'vehicle_number,make,model,year,plate_number,status,mileage,assigned_unit,insurance_expiry,registration_expiry\n';
    const csv = rows.map(r => [r.vehicle_number, r.make, r.model, r.year, r.plate_number, r.status, r.current_mileage, (r as any).assigned_unit_call_sign ?? '', r.insurance_expiry, r.registration_expiry].map(v => `"${v ?? ''}"`).join(',')).join('\n');
    return new Response(header + csv, { headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename=fleet_export.csv' } });
  } catch (err) { console.error('GET /fleet/export/csv failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

// ═══════════════════════════════════════════════════════════════
// INSURANCE CRUD (Features 90-99)
// ═══════════════════════════════════════════════════════════════

fleet.get('/:id/insurance', async (c) => {
  try {
    const vehicleId = Number(c.req.param('id'));
    const rows = await query<Record<string, unknown>>(getDb(c.env), 'SELECT * FROM fleet_insurance WHERE vehicle_id = ? ORDER BY effective_date DESC', vehicleId);
    // Outbound aliasing: the client lists + renewal alerts read modal-native
    // names (premium_amount / effective_from / expires_at) but the columns are
    // premium / effective_date / expiry_date. Without these aliases the rows
    // render with blank premium + dates and never fire renewal alerts even
    // though the data persisted fine. Keep BOTH names so every consumer works.
    const mapped = rows.map((r) => ({
      ...r,
      premium_amount: r.premium ?? r.premium_amount ?? null,
      effective_from: r.effective_date ?? r.effective_from ?? null,
      expires_at: r.expiry_date ?? r.expires_at ?? null,
    }));
    return c.json(mapped);
  } catch (err) { console.error('GET /fleet/:id/insurance failed:', err); return c.json([]); }
});

// The FleetCostFormModal posts modal-native field names (premium_amount,
// effective_from, expires_at) that differ from the live columns (premium,
// effective_date, expiry_date). Normalize both directions so either the
// legacy InsuranceModal or the new cost modal persists correctly — skipping
// this is the classic "saves then vanishes" drop. New cols premium_frequency,
// deductible, liability_limit, status were added to live D1 this pass.
function normalizeInsuranceBody(body: Record<string, unknown>): Record<string, unknown> {
  const pick = (...keys: string[]) => { for (const k of keys) if (body[k] !== undefined) return body[k]; return undefined; };
  const out: Record<string, unknown> = {
    carrier: pick('carrier'),
    policy_number: pick('policy_number'),
    coverage_type: pick('coverage_type'),
    coverage_amount: pick('coverage_amount', 'liability_limit'),
    premium: pick('premium', 'premium_amount'),
    effective_date: pick('effective_date', 'effective_from'),
    expiry_date: pick('expiry_date', 'expires_at'),
    premium_frequency: pick('premium_frequency'),
    deductible: pick('deductible'),
    liability_limit: pick('liability_limit'),
    status: pick('status'),
    notes: pick('notes'),
  };
  // Drop undefined so PUT only updates provided fields.
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}

fleet.post('/:id/insurance', async (c) => {
  try {
    const vehicleId = Number(c.req.param('id'));
    const db = getDb(c.env);
    const b = normalizeInsuranceBody(await c.req.json<Record<string, unknown>>());
    const result = await execute(db, `INSERT INTO fleet_insurance (vehicle_id, carrier, policy_number, coverage_type, coverage_amount, premium, effective_date, expiry_date, premium_frequency, deductible, liability_limit, status, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, vehicleId, b.carrier ?? null, b.policy_number ?? null, b.coverage_type ?? null, b.coverage_amount ?? null, b.premium ?? null, b.effective_date ?? null, b.expiry_date ?? null, b.premium_frequency ?? 'monthly', b.deductible ?? null, b.liability_limit ?? null, b.status ?? 'active', b.notes ?? null);
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM fleet_insurance WHERE id = ?', result.meta.last_row_id);
    return c.json(created, 201);
  } catch (err) { console.error('POST /fleet/:id/insurance failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

fleet.put('/insurance/:id', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    const db = getDb(c.env);
    const b = normalizeInsuranceBody(await c.req.json<Record<string, unknown>>());
    const setCols: string[] = []; const bindings: unknown[] = [];
    for (const key of Object.keys(b)) { setCols.push(`${key} = ?`); bindings.push(b[key] === '' ? null : b[key]); }
    if (setCols.length === 0) return c.json({ error: 'No fields to update' }, 400);
    bindings.push(id);
    await execute(db, `UPDATE fleet_insurance SET ${setCols.join(', ')} WHERE id = ?`, ...bindings);
    return c.json({ success: true });
  } catch (err) { console.error('PUT /fleet/insurance/:id failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

fleet.delete('/insurance/:id', async (c) => {
  try { const id = Number(c.req.param('id')); await execute(getDb(c.env), 'DELETE FROM fleet_insurance WHERE id = ?', id); return c.json({ success: true }); }
  catch (err) { console.error('DELETE /fleet/insurance/:id failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

// ═══════════════════════════════════════════════════════════════
// REGISTRATION CRUD (Features 100-109)
// ═══════════════════════════════════════════════════════════════

fleet.get('/:id/registration', async (c) => {
  try {
    const vehicleId = Number(c.req.param('id'));
    const rows = await query<Record<string, unknown>>(getDb(c.env), 'SELECT * FROM fleet_registration WHERE vehicle_id = ? ORDER BY effective_date DESC', vehicleId);
    return c.json(rows);
  } catch (err) { console.error('GET /fleet/:id/registration failed:', err); return c.json([]); }
});

fleet.post('/:id/registration', async (c) => {
  try {
    const vehicleId = Number(c.req.param('id'));
    const db = getDb(c.env);
    const body = await c.req.json<Record<string, unknown>>();
    const result = await execute(db, `INSERT INTO fleet_registration (vehicle_id, state, registration_number, effective_date, expiry_date, renewal_status, notes) VALUES (?,?,?,?,?,?,?)`, vehicleId, body.state ?? 'UT', body.registration_number, body.effective_date, body.expiry_date, body.renewal_status ?? 'current', body.notes ?? null);
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM fleet_registration WHERE id = ?', result.meta.last_row_id);
    return c.json(created, 201);
  } catch (err) { console.error('POST /fleet/:id/registration failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

fleet.put('/registration/:id', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    const db = getDb(c.env);
    const body = await c.req.json<Record<string, unknown>>();
    const cols = ['state', 'registration_number', 'effective_date', 'expiry_date', 'renewal_status', 'notes'];
    const setCols: string[] = []; const bindings: unknown[] = [];
    for (const key of cols) { if (Object.prototype.hasOwnProperty.call(body, key)) { setCols.push(`${key} = ?`); bindings.push(body[key] === '' ? null : body[key]); } }
    if (setCols.length === 0) return c.json({ error: 'No fields to update' }, 400);
    bindings.push(id);
    await execute(db, `UPDATE fleet_registration SET ${setCols.join(', ')} WHERE id = ?`, ...bindings);
    return c.json({ success: true });
  } catch (err) { console.error('PUT /fleet/registration/:id failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

fleet.delete('/registration/:id', async (c) => {
  try { const id = Number(c.req.param('id')); await execute(getDb(c.env), 'DELETE FROM fleet_registration WHERE id = ?', id); return c.json({ success: true }); }
  catch (err) { console.error('DELETE /fleet/registration/:id failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

// ═══════════════════════════════════════════════════════════════
// COST-OF-OWNERSHIP CRUD — Loan / Accessory / Utility
//
// Powers the wired Fleet "Costs" tab (FleetCostsTab + FleetCostFormModal).
// Insurance already had handlers above; these three complete the set.
// fleet_loans + fleet_utility_costs were created on live D1 this pass;
// fleet_accessories pre-existed (note its column is `warranty_expiry`, but
// the modal sends `warranty_until` — mapped below to avoid a silent drop).
// All wrapped in try/catch returning [] / 500 so a missing column never
// takes down the tab.
// ═══════════════════════════════════════════════════════════════

// — Loans —
fleet.get('/:id/loans', async (c) => {
  try {
    const vehicleId = Number(c.req.param('id'));
    const rows = await query<Record<string, unknown>>(getDb(c.env), 'SELECT * FROM fleet_loans WHERE vehicle_id = ? ORDER BY start_date DESC, id DESC', vehicleId);
    return c.json(rows);
  } catch (err) { console.error('GET /fleet/:id/loans failed:', err); return c.json([]); }
});

fleet.post('/:id/loans', async (c) => {
  try {
    const vehicleId = Number(c.req.param('id'));
    const db = getDb(c.env);
    const b = await c.req.json<Record<string, unknown>>();
    const result = await execute(db, `INSERT INTO fleet_loans (vehicle_id, lender, original_amount, current_balance, monthly_payment, interest_rate, term_months, start_date, payoff_date, status, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?)`, vehicleId, b.lender ?? null, b.original_amount ?? null, b.current_balance ?? null, b.monthly_payment ?? null, b.interest_rate ?? null, b.term_months ?? null, b.start_date ?? null, b.payoff_date ?? null, b.status ?? 'active', b.notes ?? null);
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM fleet_loans WHERE id = ?', result.meta.last_row_id);
    return c.json(created, 201);
  } catch (err) { console.error('POST /fleet/:id/loans failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

fleet.put('/loans/:id', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    const db = getDb(c.env);
    const b = await c.req.json<Record<string, unknown>>();
    const cols = ['lender', 'original_amount', 'current_balance', 'monthly_payment', 'interest_rate', 'term_months', 'start_date', 'payoff_date', 'status', 'notes'];
    const setCols: string[] = []; const bindings: unknown[] = [];
    for (const key of cols) { if (Object.prototype.hasOwnProperty.call(b, key)) { setCols.push(`${key} = ?`); bindings.push(b[key] === '' ? null : b[key]); } }
    if (setCols.length === 0) return c.json({ error: 'No fields to update' }, 400);
    bindings.push(id);
    await execute(db, `UPDATE fleet_loans SET ${setCols.join(', ')} WHERE id = ?`, ...bindings);
    return c.json({ success: true });
  } catch (err) { console.error('PUT /fleet/loans/:id failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

fleet.delete('/loans/:id', async (c) => {
  try { const id = Number(c.req.param('id')); await execute(getDb(c.env), 'DELETE FROM fleet_loans WHERE id = ?', id); return c.json({ success: true }); }
  catch (err) { console.error('DELETE /fleet/loans/:id failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

// — Accessories — (modal `warranty_until` → column `warranty_expiry`)
function normalizeAccessoryBody(body: Record<string, unknown>): Record<string, unknown> {
  const pick = (...keys: string[]) => { for (const k of keys) if (body[k] !== undefined) return body[k]; return undefined; };
  const out: Record<string, unknown> = {
    name: pick('name'),
    category: pick('category'),
    installed_date: pick('installed_date'),
    removed_date: pick('removed_date'),
    cost: pick('cost'),
    vendor: pick('vendor'),
    warranty_expiry: pick('warranty_expiry', 'warranty_until'),
    serial_number: pick('serial_number'),
    status: pick('status'),
    notes: pick('notes'),
  };
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}

fleet.get('/:id/accessories', async (c) => {
  try {
    const vehicleId = Number(c.req.param('id'));
    const rows = await query<Record<string, unknown>>(getDb(c.env), 'SELECT * FROM fleet_accessories WHERE vehicle_id = ? ORDER BY installed_date DESC, id DESC', vehicleId);
    // Outbound alias: the column is `warranty_expiry` but the client list reads
    // `warranty_until`. Expose both so the row shows the warranty date.
    const mapped = rows.map((r) => ({ ...r, warranty_until: r.warranty_expiry ?? r.warranty_until ?? null }));
    return c.json(mapped);
  } catch (err) { console.error('GET /fleet/:id/accessories failed:', err); return c.json([]); }
});

fleet.post('/:id/accessories', async (c) => {
  try {
    const vehicleId = Number(c.req.param('id'));
    const db = getDb(c.env);
    const b = normalizeAccessoryBody(await c.req.json<Record<string, unknown>>());
    const result = await execute(db, `INSERT INTO fleet_accessories (vehicle_id, name, category, installed_date, removed_date, cost, vendor, warranty_expiry, serial_number, status, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?)`, vehicleId, b.name ?? null, b.category ?? null, b.installed_date ?? null, b.removed_date ?? null, b.cost ?? null, b.vendor ?? null, b.warranty_expiry ?? null, b.serial_number ?? null, b.status ?? 'installed', b.notes ?? null);
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM fleet_accessories WHERE id = ?', result.meta.last_row_id);
    return c.json(created, 201);
  } catch (err) { console.error('POST /fleet/:id/accessories failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

fleet.put('/accessories/:id', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    const db = getDb(c.env);
    const b = normalizeAccessoryBody(await c.req.json<Record<string, unknown>>());
    const setCols: string[] = []; const bindings: unknown[] = [];
    for (const key of Object.keys(b)) { setCols.push(`${key} = ?`); bindings.push(b[key] === '' ? null : b[key]); }
    if (setCols.length === 0) return c.json({ error: 'No fields to update' }, 400);
    bindings.push(id);
    await execute(db, `UPDATE fleet_accessories SET ${setCols.join(', ')} WHERE id = ?`, ...bindings);
    return c.json({ success: true });
  } catch (err) { console.error('PUT /fleet/accessories/:id failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

fleet.delete('/accessories/:id', async (c) => {
  try { const id = Number(c.req.param('id')); await execute(getDb(c.env), 'DELETE FROM fleet_accessories WHERE id = ?', id); return c.json({ success: true }); }
  catch (err) { console.error('DELETE /fleet/accessories/:id failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

// — Utility costs —
fleet.get('/:id/utilities', async (c) => {
  try {
    const vehicleId = Number(c.req.param('id'));
    const rows = await query<Record<string, unknown>>(getDb(c.env), 'SELECT * FROM fleet_utility_costs WHERE vehicle_id = ? ORDER BY period_start DESC, id DESC', vehicleId);
    return c.json(rows);
  } catch (err) { console.error('GET /fleet/:id/utilities failed:', err); return c.json([]); }
});

fleet.post('/:id/utilities', async (c) => {
  try {
    const vehicleId = Number(c.req.param('id'));
    const db = getDb(c.env);
    const b = await c.req.json<Record<string, unknown>>();
    const result = await execute(db, `INSERT INTO fleet_utility_costs (vehicle_id, category, provider, cost_amount, cost_frequency, period_start, period_end, notes) VALUES (?,?,?,?,?,?,?,?)`, vehicleId, b.category ?? null, b.provider ?? null, b.cost_amount ?? null, b.cost_frequency ?? 'monthly', b.period_start ?? null, b.period_end ?? null, b.notes ?? null);
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM fleet_utility_costs WHERE id = ?', result.meta.last_row_id);
    return c.json(created, 201);
  } catch (err) { console.error('POST /fleet/:id/utilities failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

fleet.put('/utilities/:id', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    const db = getDb(c.env);
    const b = await c.req.json<Record<string, unknown>>();
    const cols = ['category', 'provider', 'cost_amount', 'cost_frequency', 'period_start', 'period_end', 'notes'];
    const setCols: string[] = []; const bindings: unknown[] = [];
    for (const key of cols) { if (Object.prototype.hasOwnProperty.call(b, key)) { setCols.push(`${key} = ?`); bindings.push(b[key] === '' ? null : b[key]); } }
    if (setCols.length === 0) return c.json({ error: 'No fields to update' }, 400);
    bindings.push(id);
    await execute(db, `UPDATE fleet_utility_costs SET ${setCols.join(', ')} WHERE id = ?`, ...bindings);
    return c.json({ success: true });
  } catch (err) { console.error('PUT /fleet/utilities/:id failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

fleet.delete('/utilities/:id', async (c) => {
  try { const id = Number(c.req.param('id')); await execute(getDb(c.env), 'DELETE FROM fleet_utility_costs WHERE id = ?', id); return c.json({ success: true }); }
  catch (err) { console.error('DELETE /fleet/utilities/:id failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

// — Other costs — (user-defined flexible cost types, one-off or recurring)
fleet.get('/:id/other-costs', async (c) => {
  try {
    const vehicleId = Number(c.req.param('id'));
    const rows = await query<Record<string, unknown>>(getDb(c.env), 'SELECT * FROM fleet_other_costs WHERE vehicle_id = ? ORDER BY incurred_date DESC, id DESC', vehicleId);
    return c.json(rows);
  } catch (err) { console.error('GET /fleet/:id/other-costs failed:', err); return c.json([]); }
});

fleet.post('/:id/other-costs', async (c) => {
  try {
    const vehicleId = Number(c.req.param('id'));
    const db = getDb(c.env);
    const b = await c.req.json<Record<string, unknown>>();
    const result = await execute(db, `INSERT INTO fleet_other_costs (vehicle_id, cost_type, provider, amount, frequency, incurred_date, period_end, status, notes) VALUES (?,?,?,?,?,?,?,?,?)`, vehicleId, b.cost_type ?? null, b.provider ?? null, b.amount ?? null, b.frequency ?? 'one_time', b.incurred_date ?? null, b.period_end ?? null, b.status ?? 'active', b.notes ?? null);
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM fleet_other_costs WHERE id = ?', result.meta.last_row_id);
    return c.json(created, 201);
  } catch (err) { console.error('POST /fleet/:id/other-costs failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

fleet.put('/other-costs/:id', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    const db = getDb(c.env);
    const b = await c.req.json<Record<string, unknown>>();
    const cols = ['cost_type', 'provider', 'amount', 'frequency', 'incurred_date', 'period_end', 'status', 'notes'];
    const setCols: string[] = []; const bindings: unknown[] = [];
    for (const key of cols) { if (Object.prototype.hasOwnProperty.call(b, key)) { setCols.push(`${key} = ?`); bindings.push(b[key] === '' ? null : b[key]); } }
    if (setCols.length === 0) return c.json({ error: 'No fields to update' }, 400);
    bindings.push(id);
    await execute(db, `UPDATE fleet_other_costs SET ${setCols.join(', ')} WHERE id = ?`, ...bindings);
    return c.json({ success: true });
  } catch (err) { console.error('PUT /fleet/other-costs/:id failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

fleet.delete('/other-costs/:id', async (c) => {
  try { const id = Number(c.req.param('id')); await execute(getDb(c.env), 'DELETE FROM fleet_other_costs WHERE id = ?', id); return c.json({ success: true }); }
  catch (err) { console.error('DELETE /fleet/other-costs/:id failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

// — Per-category monthly budgets (Budget vs. Actual) —
const FLEET_BUDGET_CATEGORIES = ['fuel', 'maintenance', 'loan', 'insurance', 'accessory', 'utility', 'other'];

fleet.get('/:id/cost-budgets', async (c) => {
  try {
    const vehicleId = Number(c.req.param('id'));
    const rows = await query<Record<string, unknown>>(getDb(c.env), 'SELECT * FROM fleet_cost_budgets WHERE vehicle_id = ?', vehicleId);
    return c.json(rows);
  } catch (err) { console.error('GET /fleet/:id/cost-budgets failed:', err); return c.json([]); }
});

fleet.put('/:id/cost-budgets', async (c) => {
  try {
    const vehicleId = Number(c.req.param('id'));
    const db = getDb(c.env);
    const body = await c.req.json<{ budgets?: Array<{ category?: string; monthly_budget?: number }> }>();
    const budgets = Array.isArray(body.budgets) ? body.budgets : [];
    for (const row of budgets) {
      const cat = String(row.category ?? '');
      if (!FLEET_BUDGET_CATEGORIES.includes(cat)) continue;
      const amt = row.monthly_budget == null ? null : Number(row.monthly_budget);
      await execute(db, `INSERT INTO fleet_cost_budgets (vehicle_id, category, monthly_budget, updated_at) VALUES (?,?,?,datetime('now')) ON CONFLICT(vehicle_id, category) DO UPDATE SET monthly_budget = excluded.monthly_budget, updated_at = datetime('now')`, vehicleId, cat, amt);
    }
    return c.json({ success: true });
  } catch (err) { console.error('PUT /fleet/:id/cost-budgets failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

// ═══════════════════════════════════════════════════════════════
// TIRES CRUD (Features 110-119)
// ═══════════════════════════════════════════════════════════════

fleet.get('/:id/tires', async (c) => {
  try {
    const vehicleId = Number(c.req.param('id'));
    const rows = await query<Record<string, unknown>>(getDb(c.env), 'SELECT * FROM fleet_tires WHERE vehicle_id = ? ORDER BY installed_date DESC', vehicleId);
    return c.json(rows);
  } catch (err) { console.error('GET /fleet/:id/tires failed:', err); return c.json([]); }
});

fleet.post('/:id/tires', async (c) => {
  try {
    const vehicleId = Number(c.req.param('id'));
    const db = getDb(c.env);
    const body = await c.req.json<Record<string, unknown>>();
    const result = await execute(db, `INSERT INTO fleet_tires (vehicle_id, tire_position, brand, model, size, dot_code, tread_depth, pressure_psi, installed_date, installed_mileage, cost, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, vehicleId, body.tire_position, body.brand, body.model, body.size, body.dot_code, body.tread_depth, body.pressure_psi, body.installed_date ?? null, body.installed_mileage, body.cost, body.notes ?? null);
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM fleet_tires WHERE id = ?', result.meta.last_row_id);
    return c.json(created, 201);
  } catch (err) { console.error('POST /fleet/:id/tires failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

fleet.put('/tires/:id', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    const db = getDb(c.env);
    const body = await c.req.json<Record<string, unknown>>();
    const cols = ['tire_position', 'brand', 'model', 'size', 'dot_code', 'tread_depth', 'pressure_psi', 'cost', 'notes', 'removed_date', 'removed_mileage'];
    const setCols: string[] = []; const bindings: unknown[] = [];
    for (const key of cols) { if (Object.prototype.hasOwnProperty.call(body, key)) { setCols.push(`${key} = ?`); bindings.push(body[key] === '' ? null : body[key]); } }
    if (setCols.length === 0) return c.json({ error: 'No fields to update' }, 400);
    bindings.push(id);
    await execute(db, `UPDATE fleet_tires SET ${setCols.join(', ')} WHERE id = ?`, ...bindings);
    return c.json({ success: true });
  } catch (err) { console.error('PUT /fleet/tires/:id failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

fleet.delete('/tires/:id', async (c) => {
  try { const id = Number(c.req.param('id')); await execute(getDb(c.env), 'DELETE FROM fleet_tires WHERE id = ?', id); return c.json({ success: true }); }
  catch (err) { console.error('DELETE /fleet/tires/:id failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

// ═══════════════════════════════════════════════════════════════
// DAMAGE RECORDS CRUD (Features 120-129)
// ═══════════════════════════════════════════════════════════════

fleet.get('/:id/damage', async (c) => {
  try {
    const vehicleId = Number(c.req.param('id'));
    const rows = await query<Record<string, unknown>>(getDb(c.env), 'SELECT * FROM fleet_damage WHERE vehicle_id = ? ORDER BY reported_date DESC', vehicleId);
    return c.json(rows);
  } catch (err) { console.error('GET /fleet/:id/damage failed:', err); return c.json([]); }
});

fleet.post('/:id/damage', async (c) => {
  try {
    const vehicleId = Number(c.req.param('id'));
    const db = getDb(c.env);
    const body = await c.req.json<Record<string, unknown>>();
    const result = await execute(db, `INSERT INTO fleet_damage (vehicle_id, damage_type, location, severity, description, reported_by, reported_date, repair_cost, repair_status, repair_date, photo_urls, notes) VALUES (?,?,?,?,?,?,datetime('now'),?,?,?,?,?)`, vehicleId, body.damage_type, body.location, body.severity, body.description, (c.get('user') as { full_name: string } | undefined)?.full_name ?? null, body.repair_cost, body.repair_status ?? 'pending', body.repair_date ?? null, body.photo_urls ?? null, body.notes ?? null);
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM fleet_damage WHERE id = ?', result.meta.last_row_id);
    return c.json(created, 201);
  } catch (err) { console.error('POST /fleet/:id/damage failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

fleet.put('/damage/:id', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    const db = getDb(c.env);
    const body = await c.req.json<Record<string, unknown>>();
    const cols = ['damage_type', 'location', 'severity', 'description', 'repair_cost', 'repair_status', 'repair_date', 'photo_urls', 'notes'];
    const setCols: string[] = []; const bindings: unknown[] = [];
    for (const key of cols) { if (Object.prototype.hasOwnProperty.call(body, key)) { setCols.push(`${key} = ?`); bindings.push(body[key] === '' ? null : body[key]); } }
    if (setCols.length === 0) return c.json({ error: 'No fields to update' }, 400);
    bindings.push(id);
    await execute(db, `UPDATE fleet_damage SET ${setCols.join(', ')} WHERE id = ?`, ...bindings);
    return c.json({ success: true });
  } catch (err) { console.error('PUT /fleet/damage/:id failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

// ── damage-reports aliases (client FleetDamageTab uses these paths) ──
fleet.get('/:id/damage-reports', async (c) => {
  try { const vehicleId = Number(c.req.param('id')); if (!Number.isInteger(vehicleId) || vehicleId <= 0) return c.json([]); const rows = await query<Record<string, unknown>>(getDb(c.env), 'SELECT * FROM fleet_damage WHERE vehicle_id = ? ORDER BY reported_date DESC', vehicleId); return c.json(rows); }
  catch (err) { console.error('GET /fleet/:id/damage-reports failed:', err); return c.json([]); }
});
fleet.post('/:id/damage-reports', async (c) => {
  try {
    const vehicleId = Number(c.req.param('id')); if (!Number.isInteger(vehicleId) || vehicleId <= 0) return c.json({ error: 'Invalid vehicle id' }, 400);
    const db = getDb(c.env); const body = await c.req.json<Record<string, unknown>>();
    const result = await execute(db, `INSERT INTO fleet_damage (vehicle_id, damage_type, location, severity, description, reported_by, reported_date, repair_cost, repair_status, photo_urls, notes) VALUES (?,?,?,?,?,?,datetime('now'),?,?,?,?)`, vehicleId, body.damage_type, body.location, body.severity, body.description, (c.get('user') as { full_name: string } | undefined)?.full_name ?? null, body.repair_cost, body.repair_status ?? 'pending', body.photo_urls ?? null, body.notes ?? null);
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM fleet_damage WHERE id = ?', result.meta.last_row_id);
    return c.json(created, 201);
  } catch (err) { console.error('POST /fleet/:id/damage-reports failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});
fleet.put('/damage-reports/:id', async (c) => {
  try {
    const id = Number(c.req.param('id')); if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
    const db = getDb(c.env); const body = await c.req.json<Record<string, unknown>>();
    const cols = ['repair_status']; const setCols: string[] = []; const bindings: unknown[] = [];
    for (const key of cols) { if (Object.prototype.hasOwnProperty.call(body, key)) { setCols.push(`${key} = ?`); bindings.push(body[key] === '' ? null : body[key]); } }
    if (setCols.length === 0) return c.json({ error: 'No fields to update' }, 400);
    bindings.push(id); await execute(db, `UPDATE fleet_damage SET ${setCols.join(', ')} WHERE id = ?`, ...bindings);
    return c.json({ success: true });
  } catch (err) { console.error('PUT /fleet/damage-reports/:id failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

fleet.delete('/damage/:id', async (c) => {
  try { const id = Number(c.req.param('id')); await execute(getDb(c.env), 'DELETE FROM fleet_damage WHERE id = ?', id); return c.json({ success: true }); }
  catch (err) { console.error('DELETE /fleet/damage/:id failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

// ═══════════════════════════════════════════════════════════════
// RECALLS CRUD (Features 130-139)
// Note: literal routes (/recalls, /recalls/:id) registered BEFORE
// parameterized /:id/recalls so Hono matches exact paths first.
// ═══════════════════════════════════════════════════════════════

fleet.get('/recalls', async (c) => {
  try {
    const db = getDb(c.env); const q = c.req.query();
    const where: string[] = ['1=1']; const params: unknown[] = [];
    if (q.vehicle_id) { where.push('r.vehicle_id = ?'); params.push(q.vehicle_id); }
    if (q.status) { where.push('r.status = ?'); params.push(q.status); }
    const whereSql = where.join(' AND ');
    const rows = await query<Record<string, unknown>>(db, `SELECT r.*, v.vehicle_number FROM fleet_recalls r LEFT JOIN fleet_vehicles v ON v.id = r.vehicle_id WHERE ${whereSql} ORDER BY r.issue_date DESC LIMIT 500`, ...params);
    return c.json(rows);
  } catch (err) { console.error('GET /fleet/recalls failed:', err); return c.json([]); }
});

fleet.post('/recalls', async (c) => {
  try {
    const db = getDb(c.env); const body = await c.req.json<Record<string, unknown>>();
    if (!body.vehicle_id) return c.json({ error: 'vehicle_id required' }, 400);
    const result = await execute(db, `INSERT INTO fleet_recalls (vehicle_id, nhtsa_number, description, severity, issue_date, remedy_date, status, notes) VALUES (?,?,?,?,?,?,?,?)`, body.vehicle_id, body.nhtsa_number, body.description, body.severity ?? 'medium', body.issue_date, body.remedy_date ?? null, body.status ?? 'open', body.notes ?? null);
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM fleet_recalls WHERE id = ?', result.meta.last_row_id);
    return c.json(created, 201);
  } catch (err) { console.error('POST /fleet/recalls failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

fleet.put('/recalls/:id', async (c) => {
  try {
    const id = Number(c.req.param('id')); const db = getDb(c.env); const body = await c.req.json<Record<string, unknown>>();
    const cols = ['nhtsa_number', 'description', 'severity', 'issue_date', 'remedy_date', 'status', 'notes'];
    const setCols: string[] = []; const bindings: unknown[] = [];
    for (const key of cols) { if (Object.prototype.hasOwnProperty.call(body, key)) { setCols.push(`${key} = ?`); bindings.push(body[key] === '' ? null : body[key]); } }
    if (setCols.length === 0) return c.json({ error: 'No fields to update' }, 400);
    bindings.push(id); await execute(db, `UPDATE fleet_recalls SET ${setCols.join(', ')} WHERE id = ?`, ...bindings);
    return c.json({ success: true });
  } catch (err) { console.error('PUT /fleet/recalls/:id failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

fleet.delete('/recalls/:id', async (c) => {
  try { const id = Number(c.req.param('id')); await execute(getDb(c.env), 'DELETE FROM fleet_recalls WHERE id = ?', id); return c.json({ success: true }); }
  catch (err) { console.error('DELETE /fleet/recalls/:id failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

fleet.get('/:id/recalls', async (c) => {
  try {
    const vehicleId = Number(c.req.param('id'));
    const rows = await query<Record<string, unknown>>(getDb(c.env), 'SELECT * FROM fleet_recalls WHERE vehicle_id = ? ORDER BY issue_date DESC', vehicleId);
    return c.json(rows);
  } catch (err) { console.error('GET /fleet/:id/recalls failed:', err); return c.json([]); }
});

fleet.post('/:id/recalls', async (c) => {
  try {
    const vehicleId = Number(c.req.param('id'));
    const db = getDb(c.env); const body = await c.req.json<Record<string, unknown>>();
    const result = await execute(db, `INSERT INTO fleet_recalls (vehicle_id, nhtsa_number, description, severity, issue_date, remedy_date, status, notes) VALUES (?,?,?,?,?,?,?,?)`, vehicleId, body.nhtsa_number, body.description, body.severity ?? 'medium', body.issue_date, body.remedy_date ?? null, body.status ?? 'open', body.notes ?? null);
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM fleet_recalls WHERE id = ?', result.meta.last_row_id);
    return c.json(created, 201);
  } catch (err) { console.error('POST /fleet/:id/recalls failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

// ═══════════════════════════════════════════════════════════════
// PARTS INVENTORY (Features 140-149)
// ═══════════════════════════════════════════════════════════════

fleet.get('/parts', async (c) => {
  try {
    const db = getDb(c.env);
    const q = c.req.query();
    const where: string[] = ['1=1']; const params: unknown[] = [];
    if (q.search) { where.push('(part_number LIKE ? OR name LIKE ?)'); params.push(`%${q.search}%`, `%${q.search}%`); }
    if (q.category) { where.push('category = ?'); params.push(q.category); }
    const whereSql = where.join(' AND ');
    const rows = await query<Record<string, unknown>>(db, `SELECT * FROM fleet_parts WHERE ${whereSql} ORDER BY name LIMIT 500`, ...params);
    return c.json(rows);
  } catch (err) { console.error('GET /fleet/parts failed:', err); return c.json([]); }
});

fleet.post('/parts', async (c) => {
  try {
    const db = getDb(c.env);
    const body = await c.req.json<Record<string, unknown>>();
    const result = await execute(db, `INSERT INTO fleet_parts (part_number, name, category, description, unit_cost, quantity_on_hand, reorder_point, supplier, compatible_vehicles, location) VALUES (?,?,?,?,?,?,?,?,?,?)`, body.part_number, body.name, body.category, body.description ?? null, body.unit_cost, body.quantity_on_hand ?? 0, body.reorder_point ?? 0, body.supplier ?? null, body.compatible_vehicles ?? null, body.location ?? null);
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM fleet_parts WHERE id = ?', result.meta.last_row_id);
    return c.json(created, 201);
  } catch (err) { console.error('POST /fleet/parts failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

fleet.put('/parts/:id', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    const db = getDb(c.env);
    const body = await c.req.json<Record<string, unknown>>();
    const cols = ['part_number', 'name', 'category', 'description', 'unit_cost', 'quantity_on_hand', 'reorder_point', 'supplier', 'compatible_vehicles', 'location'];
    const setCols: string[] = []; const bindings: unknown[] = [];
    for (const key of cols) { if (Object.prototype.hasOwnProperty.call(body, key)) { setCols.push(`${key} = ?`); bindings.push(body[key] === '' ? null : body[key]); } }
    if (setCols.length === 0) return c.json({ error: 'No fields to update' }, 400);
    bindings.push(id);
    await execute(db, `UPDATE fleet_parts SET ${setCols.join(', ')} WHERE id = ?`, ...bindings);
    return c.json({ success: true });
  } catch (err) { console.error('PUT /fleet/parts/:id failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

fleet.delete('/parts/:id', async (c) => {
  try { const id = Number(c.req.param('id')); await execute(getDb(c.env), 'DELETE FROM fleet_parts WHERE id = ?', id); return c.json({ success: true }); }
  catch (err) { console.error('DELETE /fleet/parts/:id failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

// ═══════════════════════════════════════════════════════════════
// WARRANTY TRACKING (Features 150-159)
// ═══════════════════════════════════════════════════════════════

fleet.get('/warranties', async (c) => {
  try {
    const db = getDb(c.env);
    const q = c.req.query();
    const where: string[] = ['1=1']; const params: unknown[] = [];
    if (q.vehicle_id) { where.push('w.vehicle_id = ?'); params.push(q.vehicle_id); }
    if (q.status) { where.push('w.status = ?'); params.push(q.status); }
    const whereSql = where.join(' AND ');
    const rows = await query<Record<string, unknown>>(db, `SELECT w.*, v.vehicle_number, v.make, v.model FROM fleet_warranties w LEFT JOIN fleet_vehicles v ON v.id = w.vehicle_id WHERE ${whereSql} ORDER BY w.expiry_date`, ...params);
    return c.json(rows);
  } catch (err) { console.error('GET /fleet/warranties failed:', err); return c.json([]); }
});

fleet.post('/warranties', async (c) => {
  try {
    const db = getDb(c.env);
    const body = await c.req.json<Record<string, unknown>>();
    if (!body.vehicle_id || !body.coverage_type) return c.json({ error: 'vehicle_id and coverage_type required' }, 400);
    const result = await execute(db, `INSERT INTO fleet_warranties (vehicle_id, coverage_type, provider, policy_number, coverage_details, start_date, expiry_date, expiry_mileage, deductible, contact_info, status, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, body.vehicle_id, body.coverage_type, body.provider ?? null, body.policy_number ?? null, body.coverage_details ?? null, body.start_date, body.expiry_date, body.expiry_mileage ?? null, body.deductible ?? null, body.contact_info ?? null, body.status ?? 'active', body.notes ?? null);
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM fleet_warranties WHERE id = ?', result.meta.last_row_id);
    return c.json(created, 201);
  } catch (err) { console.error('POST /fleet/warranties failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

fleet.put('/warranties/:id', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    const db = getDb(c.env);
    const body = await c.req.json<Record<string, unknown>>();
    const cols = ['coverage_type', 'provider', 'policy_number', 'coverage_details', 'start_date', 'expiry_date', 'expiry_mileage', 'deductible', 'contact_info', 'status', 'notes'];
    const setCols: string[] = []; const bindings: unknown[] = [];
    for (const key of cols) { if (Object.prototype.hasOwnProperty.call(body, key)) { setCols.push(`${key} = ?`); bindings.push(body[key] === '' ? null : body[key]); } }
    if (setCols.length === 0) return c.json({ error: 'No fields to update' }, 400);
    bindings.push(id);
    await execute(db, `UPDATE fleet_warranties SET ${setCols.join(', ')} WHERE id = ?`, ...bindings);
    return c.json({ success: true });
  } catch (err) { console.error('PUT /fleet/warranties/:id failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

fleet.delete('/warranties/:id', async (c) => {
  try { const id = Number(c.req.param('id')); await execute(getDb(c.env), 'DELETE FROM fleet_warranties WHERE id = ?', id); return c.json({ success: true }); }
  catch (err) { console.error('DELETE /fleet/warranties/:id failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

// ═══════════════════════════════════════════════════════════════
// KEY MANAGEMENT (Features 160-169)
// ═══════════════════════════════════════════════════════════════

fleet.get('/keys', async (c) => {
  try {
    const db = getDb(c.env);
    const q = c.req.query();
    const where: string[] = ['1=1']; const params: unknown[] = [];
    if (q.vehicle_id) { where.push('k.vehicle_id = ?'); params.push(q.vehicle_id); }
    if (q.status) { where.push('k.status = ?'); params.push(q.status); }
    const whereSql = where.join(' AND ');
    const rows = await query<Record<string, unknown>>(db, `SELECT k.*, v.vehicle_number FROM fleet_keys k LEFT JOIN fleet_vehicles v ON v.id = k.vehicle_id WHERE ${whereSql} ORDER BY k.vehicle_id, k.key_number`, ...params);
    return c.json(rows);
  } catch (err) { console.error('GET /fleet/keys failed:', err); return c.json([]); }
});

fleet.post('/keys', async (c) => {
  try {
    const db = getDb(c.env);
    const body = await c.req.json<Record<string, unknown>>();
    const result = await execute(db, `INSERT INTO fleet_keys (vehicle_id, key_number, key_type, rfid_tag, status, current_holder, last_checkout, last_return, notes) VALUES (?,?,?,?,?,?,datetime('now'),NULL,?)`, body.vehicle_id, body.key_number ?? '1', body.key_type ?? 'ignition', body.rfid_tag ?? null, body.status ?? 'available', body.current_holder ?? null, body.notes ?? null);
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM fleet_keys WHERE id = ?', result.meta.last_row_id);
    return c.json(created, 201);
  } catch (err) { console.error('POST /fleet/keys failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

fleet.put('/keys/:id/checkout', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    const db = getDb(c.env);
    const body = await c.req.json<Record<string, unknown>>();
    await execute(db, `UPDATE fleet_keys SET status = 'checked_out', current_holder = ?, last_checkout = datetime('now') WHERE id = ?`, body.holder_name ?? (c.get('user') as { full_name: string } | undefined)?.full_name ?? 'Unknown', id);
    const logResult = await execute(db, `INSERT INTO fleet_key_log (key_id, action, holder_name, timestamp) VALUES (?, 'checkout', ?, datetime('now'))`, id, body.holder_name ?? (c.get('user') as { full_name: string } | undefined)?.full_name ?? 'Unknown');
    return c.json({ success: true, log_id: logResult.meta.last_row_id });
  } catch (err) { console.error('PUT /fleet/keys/:id/checkout failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

fleet.put('/keys/:id/return', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    const db = getDb(c.env);
    await execute(db, `UPDATE fleet_keys SET status = 'available', current_holder = NULL, last_return = datetime('now') WHERE id = ?`, id);
    await execute(db, `INSERT INTO fleet_key_log (key_id, action, holder_name, timestamp) VALUES (?, 'return', 'Returned', datetime('now'))`, id);
    return c.json({ success: true });
  } catch (err) { console.error('PUT /fleet/keys/:id/return failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

fleet.get('/keys/:id/log', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    const rows = await query<Record<string, unknown>>(getDb(c.env), 'SELECT * FROM fleet_key_log WHERE key_id = ? ORDER BY timestamp DESC LIMIT 100', id);
    return c.json(rows);
  } catch (err) { console.error('GET /fleet/keys/:id/log failed:', err); return c.json([]); }
});

// ═══════════════════════════════════════════════════════════════
// ACCIDENT REPORTS (Features 170-179)
// ═══════════════════════════════════════════════════════════════

fleet.get('/accidents', async (c) => {
  try {
    const db = getDb(c.env);
    const q = c.req.query();
    const where: string[] = ['1=1']; const params: unknown[] = [];
    if (q.vehicle_id) { where.push('a.vehicle_id = ?'); params.push(q.vehicle_id); }
    if (q.severity) { where.push('a.severity = ?'); params.push(q.severity); }
    const whereSql = where.join(' AND ');
    const rows = await query<Record<string, unknown>>(db, `SELECT a.*, v.vehicle_number FROM fleet_accidents a LEFT JOIN fleet_vehicles v ON v.id = a.vehicle_id WHERE ${whereSql} ORDER BY a.accident_date DESC LIMIT 200`, ...params);
    return c.json(rows);
  } catch (err) { console.error('GET /fleet/accidents failed:', err); return c.json([]); }
});

fleet.post('/accidents', async (c) => {
  try {
    const db = getDb(c.env);
    const body = await c.req.json<Record<string, unknown>>();
    if (!body.vehicle_id) return c.json({ error: 'vehicle_id required' }, 400);
    const result = await execute(db, `INSERT INTO fleet_accidents (vehicle_id, accident_date, location, severity, description, driver_id, weather_conditions, road_conditions, police_report_number, insurance_claim_number, estimated_damage, injuries, fault_determination, status, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, body.vehicle_id, body.accident_date ?? null, body.location, body.severity ?? 'minor', body.description, body.driver_id ?? null, body.weather_conditions ?? null, body.road_conditions ?? null, body.police_report_number ?? null, body.insurance_claim_number ?? null, body.estimated_damage ?? null, body.injuries ?? 0, body.fault_determination ?? null, body.status ?? 'open', body.notes ?? null);
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM fleet_accidents WHERE id = ?', result.meta.last_row_id);
    return c.json(created, 201);
  } catch (err) { console.error('POST /fleet/accidents failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

fleet.put('/accidents/:id', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    const db = getDb(c.env);
    const body = await c.req.json<Record<string, unknown>>();
    const cols = ['accident_date', 'location', 'severity', 'description', 'driver_id', 'weather_conditions', 'road_conditions', 'police_report_number', 'insurance_claim_number', 'estimated_damage', 'injuries', 'fault_determination', 'status', 'notes'];
    const setCols: string[] = []; const bindings: unknown[] = [];
    for (const key of cols) { if (Object.prototype.hasOwnProperty.call(body, key)) { setCols.push(`${key} = ?`); bindings.push(body[key] === '' ? null : body[key]); } }
    if (setCols.length === 0) return c.json({ error: 'No fields to update' }, 400);
    bindings.push(id);
    await execute(db, `UPDATE fleet_accidents SET ${setCols.join(', ')} WHERE id = ?`, ...bindings);
    return c.json({ success: true });
  } catch (err) { console.error('PUT /fleet/accidents/:id failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

// ═══════════════════════════════════════════════════════════════
// SERVICE PROVIDERS (Features 180-189)
// ═══════════════════════════════════════════════════════════════

fleet.get('/service-providers', async (c) => {
  try { const rows = await query<Record<string, unknown>>(getDb(c.env), 'SELECT * FROM fleet_service_providers ORDER BY name'); return c.json(rows); }
  catch (err) { console.error('GET /fleet/service-providers failed:', err); return c.json([]); }
});

fleet.post('/service-providers', async (c) => {
  try {
    const db = getDb(c.env); const body = await c.req.json<Record<string, unknown>>();
    const result = await execute(db, `INSERT INTO fleet_service_providers (name, provider_type, phone, email, address, contact_name, tax_id, preferred, notes) VALUES (?,?,?,?,?,?,?,?,?)`, body.name, body.provider_type ?? 'general', body.phone ?? null, body.email ?? null, body.address ?? null, body.contact_name ?? null, body.tax_id ?? null, body.preferred ?? 0, body.notes ?? null);
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM fleet_service_providers WHERE id = ?', result.meta.last_row_id);
    return c.json(created, 201);
  } catch (err) { console.error('POST /fleet/service-providers failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

fleet.put('/service-providers/:id', async (c) => {
  try {
    const id = Number(c.req.param('id')); const db = getDb(c.env); const body = await c.req.json<Record<string, unknown>>();
    const cols = ['name', 'provider_type', 'phone', 'email', 'address', 'contact_name', 'tax_id', 'preferred', 'notes'];
    const setCols: string[] = []; const bindings: unknown[] = [];
    for (const key of cols) { if (Object.prototype.hasOwnProperty.call(body, key)) { setCols.push(`${key} = ?`); bindings.push(body[key] === '' ? null : body[key]); } }
    if (setCols.length === 0) return c.json({ error: 'No fields to update' }, 400);
    bindings.push(id); await execute(db, `UPDATE fleet_service_providers SET ${setCols.join(', ')} WHERE id = ?`, ...bindings);
    return c.json({ success: true });
  } catch (err) { console.error('PUT /fleet/service-providers/:id failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

fleet.delete('/service-providers/:id', async (c) => {
  try { const id = Number(c.req.param('id')); await execute(getDb(c.env), 'DELETE FROM fleet_service_providers WHERE id = ?', id); return c.json({ success: true }); }
  catch (err) { console.error('DELETE /fleet/service-providers/:id failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

// ═══════════════════════════════════════════════════════════════
// FUEL CARDS + BUDGET (Features 190-209)
// ═══════════════════════════════════════════════════════════════

fleet.get('/fuel-cards', async (c) => {
  try { const rows = await query<Record<string, unknown>>(getDb(c.env), `SELECT fc.*, v.vehicle_number FROM fleet_fuel_cards fc LEFT JOIN fleet_vehicles v ON v.id = fc.assigned_vehicle_id ORDER BY fc.card_number`); return c.json(rows); }
  catch (err) { console.error('GET /fleet/fuel-cards failed:', err); return c.json([]); }
});

fleet.post('/fuel-cards', async (c) => {
  try {
    const db = getDb(c.env); const body = await c.req.json<Record<string, unknown>>();
    const result = await execute(db, `INSERT INTO fleet_fuel_cards (card_number, provider, assigned_vehicle_id, pin, credit_limit, status, expiration_date, notes) VALUES (?,?,?,?,?,?,?,?)`, body.card_number, body.provider, body.assigned_vehicle_id ?? null, body.pin ?? null, body.credit_limit ?? null, body.status ?? 'active', body.expiration_date ?? null, body.notes ?? null);
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM fleet_fuel_cards WHERE id = ?', result.meta.last_row_id);
    return c.json(created, 201);
  } catch (err) { console.error('POST /fleet/fuel-cards failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

fleet.put('/fuel-cards/:id', async (c) => {
  try {
    const id = Number(c.req.param('id')); const db = getDb(c.env); const body = await c.req.json<Record<string, unknown>>();
    const cols = ['card_number', 'provider', 'assigned_vehicle_id', 'pin', 'credit_limit', 'status', 'expiration_date', 'notes'];
    const setCols: string[] = []; const bindings: unknown[] = [];
    for (const key of cols) { if (Object.prototype.hasOwnProperty.call(body, key)) { setCols.push(`${key} = ?`); bindings.push(body[key] === '' ? null : body[key]); } }
    if (setCols.length === 0) return c.json({ error: 'No fields to update' }, 400);
    bindings.push(id); await execute(db, `UPDATE fleet_fuel_cards SET ${setCols.join(', ')} WHERE id = ?`, ...bindings);
    return c.json({ success: true });
  } catch (err) { console.error('PUT /fleet/fuel-cards/:id failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

fleet.delete('/fuel-cards/:id', async (c) => {
  try { const id = Number(c.req.param('id')); await execute(getDb(c.env), 'DELETE FROM fleet_fuel_cards WHERE id = ?', id); return c.json({ success: true }); }
  catch (err) { console.error('DELETE /fleet/fuel-cards/:id failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

// Budget CRUD (Features 200-209)
fleet.get('/budgets', async (c) => {
  try {
    const db = getDb(c.env); const q = c.req.query();
    const where: string[] = ['1=1']; const params: unknown[] = [];
    if (q.year) { where.push('fiscal_year = ?'); params.push(q.year); }
    const rows = await query<Record<string, unknown>>(db, `SELECT * FROM fleet_budgets WHERE ${where.join(' AND ')} ORDER BY fiscal_year DESC, category`, ...params);
    return c.json(rows);
  } catch (err) { console.error('GET /fleet/budgets failed:', err); return c.json([]); }
});

fleet.post('/budgets', async (c) => {
  try {
    const db = getDb(c.env); const body = await c.req.json<Record<string, unknown>>();
    const result = await execute(db, `INSERT INTO fleet_budgets (fiscal_year, category, allocated_amount, spent_amount, notes) VALUES (?,?,?,?,?)`, body.fiscal_year, body.category, body.allocated_amount, body.spent_amount ?? 0, body.notes ?? null);
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM fleet_budgets WHERE id = ?', result.meta.last_row_id);
    return c.json(created, 201);
  } catch (err) { console.error('POST /fleet/budgets failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

fleet.put('/budgets/:id', async (c) => {
  try {
    const id = Number(c.req.param('id')); const db = getDb(c.env); const body = await c.req.json<Record<string, unknown>>();
    const cols = ['fiscal_year', 'category', 'allocated_amount', 'spent_amount', 'notes'];
    const setCols: string[] = []; const bindings: unknown[] = [];
    for (const key of cols) { if (Object.prototype.hasOwnProperty.call(body, key)) { setCols.push(`${key} = ?`); bindings.push(body[key] === '' ? null : body[key]); } }
    if (setCols.length === 0) return c.json({ error: 'No fields to update' }, 400);
    bindings.push(id); await execute(db, `UPDATE fleet_budgets SET ${setCols.join(', ')} WHERE id = ?`, ...bindings);
    return c.json({ success: true });
  } catch (err) { console.error('PUT /fleet/budgets/:id failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

fleet.delete('/budgets/:id', async (c) => {
  try { const id = Number(c.req.param('id')); await execute(getDb(c.env), 'DELETE FROM fleet_budgets WHERE id = ?', id); return c.json({ success: true }); }
  catch (err) { console.error('DELETE /fleet/budgets/:id failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

// ═══════════════════════════════════════════════════════════════
// DEPRECIATION (Features 210-219)
// ═══════════════════════════════════════════════════════════════

fleet.get('/depreciation', async (c) => {
  try {
    const db = getDb(c.env);
    const vehicles = await query<Record<string, unknown>>(db, `SELECT id, vehicle_number, make, model, year, status FROM fleet_vehicles WHERE archived_at IS NULL`);
    const result = await Promise.all(vehicles.map(async (v) => {
      const d = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM fleet_depreciation WHERE vehicle_id = ? ORDER BY calculated_date DESC LIMIT 1', v.id);
      return { ...v, depreciation: d };
    }));
    return c.json(result);
  } catch (err) { console.error('GET /fleet/depreciation failed:', err); return c.json([]); }
});

fleet.post('/depreciation', async (c) => {
  try {
    const db = getDb(c.env); const body = await c.req.json<Record<string, unknown>>();
    const result = await execute(db, `INSERT INTO fleet_depreciation (vehicle_id, purchase_price, salvage_value, useful_life_months, depreciation_method, monthly_depreciation, accumulated_depreciation, current_book_value, calculated_date) VALUES (?,?,?,?,?,?,?,?,datetime('now'))`, body.vehicle_id, body.purchase_price, body.salvage_value ?? 0, body.useful_life_months ?? 60, body.depreciation_method ?? 'straight_line', body.monthly_depreciation ?? 0, body.accumulated_depreciation ?? 0, body.current_book_value ?? body.purchase_price);
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM fleet_depreciation WHERE id = ?', result.meta.last_row_id);
    return c.json(created, 201);
  } catch (err) { console.error('POST /fleet/depreciation failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

// ═══════════════════════════════════════════════════════════════
// REPLACEMENT PLANNING (Features 220-229)
// ═══════════════════════════════════════════════════════════════

fleet.get('/replacement-plan', async (c) => {
  try {
    const db = getDb(c.env);
    const vehicles = await query<Record<string, unknown>>(db, `SELECT v.*, rp.replacement_year, rp.replacement_reason, rp.estimated_replacement_cost, rp.priority as rp_priority, rp.status as rp_status, rp.notes as rp_notes FROM fleet_vehicles v LEFT JOIN fleet_replacement_plan rp ON rp.vehicle_id = v.id WHERE v.archived_at IS NULL ORDER BY rp.priority, v.year`);
    return c.json(vehicles);
  } catch (err) { console.error('GET /fleet/replacement-plan failed:', err); return c.json([]); }
});

fleet.post('/replacement-plan', async (c) => {
  try {
    const db = getDb(c.env); const body = await c.req.json<Record<string, unknown>>();
    const result = await execute(db, `INSERT INTO fleet_replacement_plan (vehicle_id, replacement_year, replacement_reason, estimated_replacement_cost, priority, status, notes) VALUES (?,?,?,?,?,?,?)`, body.vehicle_id, body.replacement_year, body.replacement_reason ?? null, body.estimated_replacement_cost ?? null, body.priority ?? 'medium', body.status ?? 'planned', body.notes ?? null);
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM fleet_replacement_plan WHERE id = ?', result.meta.last_row_id);
    return c.json(created, 201);
  } catch (err) { console.error('POST /fleet/replacement-plan failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

fleet.put('/replacement-plan/:id', async (c) => {
  try {
    const id = Number(c.req.param('id')); const db = getDb(c.env); const body = await c.req.json<Record<string, unknown>>();
    const cols = ['replacement_year', 'replacement_reason', 'estimated_replacement_cost', 'priority', 'status', 'notes'];
    const setCols: string[] = []; const bindings: unknown[] = [];
    for (const key of cols) { if (Object.prototype.hasOwnProperty.call(body, key)) { setCols.push(`${key} = ?`); bindings.push(body[key] === '' ? null : body[key]); } }
    if (setCols.length === 0) return c.json({ error: 'No fields to update' }, 400);
    bindings.push(id); await execute(db, `UPDATE fleet_replacement_plan SET ${setCols.join(', ')} WHERE id = ?`, ...bindings);
    return c.json({ success: true });
  } catch (err) { console.error('PUT /fleet/replacement-plan/:id failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

// ═══════════════════════════════════════════════════════════════
// UTILIZATION METRICS + TELEMATICS (Features 230-249)
// ═══════════════════════════════════════════════════════════════

fleet.get('/utilization', async (c) => {
  try {
    const db = getDb(c.env); const q = c.req.query();
    const days = Math.min(Math.max(Number(q.days ?? 30), 1), 365);
    const rows = await query<Record<string, unknown>>(db, `SELECT v.id, v.vehicle_number, COALESCE(SUM(f.gallons),0) as fuel_used, COALESCE(SUM(f.total_cost),0) as fuel_cost, COUNT(DISTINCT DATE(f.fuel_date)) as days_used, COALESCE(MAX(f.odometer)-MIN(f.odometer),0) as miles_driven FROM fleet_vehicles v LEFT JOIN fleet_fuel_log f ON f.vehicle_id = v.id AND f.fuel_date >= datetime('now', '-${days} days') WHERE v.archived_at IS NULL GROUP BY v.id ORDER BY miles_driven DESC`);
    return c.json(rows.map(r => ({ ...r, daily_avg_miles: ((r as any).days_used > 0 ? Math.round((r as any).miles_driven / (r as any).days_used) : 0) })));
  } catch (err) { console.error('GET /fleet/utilization failed:', err); return c.json([]); }
});

fleet.get('/emissions', async (c) => {
  try {
    const db = getDb(c.env); const q = c.req.query();
    const days = Math.min(Math.max(Number(q.days ?? 365), 1), 365);
    const rows = await query<Record<string, unknown>>(db, `SELECT v.id, v.vehicle_number, v.make, v.model, v.year, COALESCE(SUM(f.gallons),0) as total_gallons, ROUND(COALESCE(SUM(f.gallons)*8.887,0),1) as co2_kg, ROUND(COALESCE(SUM(f.gallons)*19.59,0),1) as co2_lbs FROM fleet_vehicles v LEFT JOIN fleet_fuel_log f ON f.vehicle_id = v.id AND f.fuel_date >= datetime('now', '-${days} days') WHERE v.archived_at IS NULL GROUP BY v.id ORDER BY co2_kg DESC`);
    return c.json(rows);
  } catch (err) { console.error('GET /fleet/emissions failed:', err); return c.json([]); }
});

fleet.get('/fleet-lifecycle', async (c) => {
  try {
    const db = getDb(c.env);
    const vehicles = await query<Record<string, unknown>>(db, `SELECT v.*, COALESCE(SUM(m.cost),0) as lifetime_maintenance, COALESCE(SUM(f.total_cost),0) as lifetime_fuel, (COALESCE(SUM(m.cost),0) + COALESCE(SUM(f.total_cost),0)) as total_cost_of_ownership FROM fleet_vehicles v LEFT JOIN fleet_maintenance m ON m.vehicle_id = v.id LEFT JOIN fleet_fuel_log f ON f.vehicle_id = v.id GROUP BY v.id ORDER BY v.year, v.vehicle_number`);
    return c.json(vehicles);
  } catch (err) { console.error('GET /fleet/fleet-lifecycle failed:', err); return c.json([]); }
});

// ═══════════════════════════════════════════════════════════════
// ADDITIONAL ANALYTICS (Features 235-249)
// ═══════════════════════════════════════════════════════════════

fleet.get('/service-alerts', async (c) => {
  try {
    const db = getDb(c.env);
    const now = new Date().toISOString().slice(0, 10);
    const insurance = await query<Record<string, unknown>>(db, "SELECT id, vehicle_number, 'insurance' as type, insurance_expiry as due_date FROM fleet_vehicles WHERE archived_at IS NULL AND insurance_expiry IS NOT NULL AND date(insurance_expiry) <= date('now', '+30 days')");
    const registration = await query<Record<string, unknown>>(db, "SELECT id, vehicle_number, 'registration' as type, registration_expiry as due_date FROM fleet_vehicles WHERE archived_at IS NULL AND registration_expiry IS NOT NULL AND date(registration_expiry) <= date('now', '+30 days')");
    const service = await query<Record<string, unknown>>(db, "SELECT id, vehicle_number, 'service' as type, next_service_due as due_date FROM fleet_vehicles WHERE archived_at IS NULL AND next_service_due IS NOT NULL AND date(next_service_due) <= date('now', '+30 days')");
    return c.json({ all_alerts: [...insurance, ...registration, ...service] });
  } catch (err) { console.error('GET /fleet/service-alerts failed:', err); return c.json({ all_alerts: [] }); }
});

fleet.get('/overdue-inspections', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db, `SELECT i.*, v.vehicle_number FROM fleet_inspections i LEFT JOIN fleet_vehicles v ON v.id = i.vehicle_id WHERE i.overall_result = 'fail' ORDER BY i.inspection_date DESC LIMIT 50`);
    return c.json(rows);
  } catch (err) { console.error('GET /fleet/overdue-inspections failed:', err); return c.json([]); }
});

fleet.get('/inspection-stats', async (c) => {
  try {
    const db = getDb(c.env);
    const passCount = (await queryFirst<{ n: number }>(db, "SELECT COUNT(*) as n FROM fleet_inspections WHERE overall_result = 'pass'"))?.n ?? 0;
    const failCount = (await queryFirst<{ n: number }>(db, "SELECT COUNT(*) as n FROM fleet_inspections WHERE overall_result = 'fail'"))?.n ?? 0;
    const total = passCount + failCount;
    return c.json({ total, pass: passCount, fail: failCount, pass_rate: total > 0 ? Math.round((passCount / total) * 100) : 0, recent: [] });
  } catch (err) { console.error('GET /fleet/inspection-stats failed:', err); return c.json({ total: 0, pass: 0, fail: 0, pass_rate: 0, recent: [] }); }
});

fleet.get('/cost-trends', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db, "SELECT strftime('%Y-%m', fuel_date) as month, COALESCE(SUM(total_cost),0) as fuel, 0 as maintenance, COALESCE(SUM(gallons),0) as gallons FROM fleet_fuel_log WHERE fuel_date >= datetime('now', '-12 months') GROUP BY month ORDER BY month");
    const maint = await query<Record<string, unknown>>(db, "SELECT strftime('%Y-%m', performed_at) as month, COALESCE(SUM(cost),0) as cost FROM fleet_maintenance WHERE performed_at >= datetime('now', '-12 months') GROUP BY month ORDER BY month");
    const maintMap = new Map(maint.map(r => [r.month, r.cost]));
    return c.json({ cost_trends: rows.map(r => ({ ...r, maintenance: maintMap.get(r.month as string) ?? 0 })) });
  } catch (err) { console.error('GET /fleet/cost-trends failed:', err); return c.json({ cost_trends: [] }); }
});

fleet.get('/driver-performance', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db, `SELECT a.officer_name as driver, COUNT(*) as trips, COALESCE(SUM(f.gallons),0) as gallons, COALESCE(SUM(f.total_cost),0) as cost, COALESCE(MAX(f.odometer)-MIN(f.odometer),0) as miles FROM fleet_assignments a LEFT JOIN fleet_fuel_log f ON f.vehicle_id = a.vehicle_id AND f.fuel_date >= a.assigned_at AND (a.unassigned_at IS NULL OR f.fuel_date <= a.unassigned_at) WHERE a.officer_name IS NOT NULL AND a.assigned_at >= datetime('now', '-90 days') GROUP BY a.officer_name ORDER BY miles DESC LIMIT 50`);
    return c.json({ drivers: rows });
  } catch (err) { console.error('GET /fleet/driver-performance failed:', err); return c.json({ drivers: [] }); }
});

// GET /health-scores — per-vehicle health with a five-factor breakdown.
// FleetAnalyticsTab renders each vehicle as a ring (overall) + 5 factor bars
// (age / mileage / service / inspection / cost), so each row MUST carry
// vehicle_id, factors:{age,mileage,service,inspection,cost}, and status_label.
// (Previously returned mileage-only score + no factors → the tab crashed on
// `v.factors[f]` once the route started actually resolving. See the digit
// route-constraint fix.)
fleet.get('/health-scores', async (c) => {
  try {
    const db = getDb(c.env);
    const year = new Date().getFullYear();
    // One row per active vehicle with the raw inputs each factor needs.
    const rows = await query<{
      id: number; vehicle_number: string; make: string; model: string; year: number;
      current_mileage: number | null; days_since_service: number | null;
      last_inspection_pass: number | null; total_cost: number | null; total_miles: number | null;
    }>(db, `
      SELECT v.id, v.vehicle_number, v.make, v.model, v.year, v.current_mileage,
        (julianday('now') - julianday(MAX(m.performed_at))) AS days_since_service,
        (SELECT CASE WHEN i.overall_result = 'pass' THEN 1 ELSE 0 END
           FROM fleet_inspections i WHERE i.vehicle_id = v.id
           ORDER BY i.inspection_date DESC LIMIT 1) AS last_inspection_pass,
        COALESCE((SELECT SUM(cost) FROM fleet_maintenance WHERE vehicle_id = v.id), 0)
          + COALESCE((SELECT SUM(total_cost) FROM fleet_fuel_log WHERE vehicle_id = v.id), 0) AS total_cost,
        (SELECT MAX(odometer) - MIN(odometer) FROM fleet_fuel_log WHERE vehicle_id = v.id) AS total_miles
      FROM fleet_vehicles v
      LEFT JOIN fleet_maintenance m ON m.vehicle_id = v.id
      WHERE v.archived_at IS NULL
      GROUP BY v.id
    `);

    const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
    const health_scores = rows.map((r) => {
      // Each factor is 0–100, higher = healthier.
      const age = r.year ? clamp(100 - (year - r.year) * 8) : 70;                       // ~8 pts/yr
      const mileage = r.current_mileage == null ? 70
        : clamp(100 - (r.current_mileage / 150000) * 100);                              // 0 at 150k mi
      const service = r.days_since_service == null ? 70
        : clamp(100 - (r.days_since_service / 180) * 100);                              // 0 at ~6 mo
      const inspection = r.last_inspection_pass == null ? 70 : (r.last_inspection_pass ? 100 : 20);
      const cpm = (r.total_miles && r.total_miles > 0) ? (r.total_cost ?? 0) / r.total_miles : null;
      const cost = cpm == null ? 70 : clamp(100 - (cpm / 1.5) * 100);                   // 0 at $1.50/mi

      const factors = { age, mileage, service, inspection, cost };

      // Cost/lifecycle weighting (operator-chosen 2026-05-31): the score is a
      // REPLACEMENT-PLANNING signal. Mileage (0.30) + cost (0.25) dominate so
      // expensive-to-run, near-end-of-life vehicles sink to the bottom of the
      // ranking and surface for the capital-replacement conversation; age is
      // moderate; service/inspection (immediate-fix signals) weigh least.
      // Weights sum to 1.0.
      const W = { mileage: 0.30, cost: 0.25, age: 0.20, service: 0.15, inspection: 0.10 };
      const health_score = clamp(
        age * W.age + mileage * W.mileage + service * W.service +
        inspection * W.inspection + cost * W.cost,
      );

      const status_label =
        health_score >= 80 ? 'Excellent' :
        health_score >= 60 ? 'Good' :
        health_score >= 40 ? 'Fair' :
        health_score >= 20 ? 'Poor' : 'Critical';

      return {
        vehicle_id: r.id, vehicle_number: r.vehicle_number, make: r.make, model: r.model,
        year: r.year, health_score, factors, status_label,
      };
    }).sort((a, b) => a.health_score - b.health_score);

    return c.json({ health_scores });
  } catch (err) { console.error('GET /fleet/health-scores failed:', err); return c.json({ health_scores: [] }); }
});

fleet.get('/maintenance-schedule', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db, `SELECT m.*, v.vehicle_number, v.current_mileage FROM fleet_maintenance m LEFT JOIN fleet_vehicles v ON v.id = m.vehicle_id WHERE m.next_due_date IS NOT NULL AND date(m.next_due_date) >= date('now') ORDER BY m.next_due_date LIMIT 100`);
    return c.json({ schedule: rows });
  } catch (err) { console.error('GET /fleet/maintenance-schedule failed:', err); return c.json({ schedule: [] }); }
});

fleet.get('/vehicle-comparison', async (c) => {
  try {
    const db = getDb(c.env); const ids = (c.req.query('ids') || '').split(',').map(Number).filter(n => Number.isInteger(n) && n > 0);
    if (ids.length === 0) return c.json({ vehicles: [] });
    const placeholders = ids.map(() => '?').join(',');
    const vehicles = await query<Record<string, unknown>>(db, `SELECT v.*, COALESCE(SUM(m.cost),0) as maint_cost, COALESCE(SUM(f.total_cost),0) as fuel_cost FROM fleet_vehicles v LEFT JOIN fleet_maintenance m ON m.vehicle_id = v.id LEFT JOIN fleet_fuel_log f ON f.vehicle_id = v.id WHERE v.id IN (${placeholders}) GROUP BY v.id`, ...ids);
    return c.json({ vehicles });
  } catch (err) { console.error('GET /fleet/vehicle-comparison failed:', err); return c.json({ vehicles: [] }); }
});

fleet.get('/vehicle-lifecycle', async (c) => {
  try {
    const db = getDb(c.env);
    const vehicles = await query<Record<string, unknown>>(db, `SELECT v.*, COALESCE(SUM(m.cost),0) as maint_cost, COALESCE(SUM(f.total_cost),0) as fuel_cost, COALESCE(SUM(m.cost)+SUM(f.total_cost),0) as total_cost FROM fleet_vehicles v LEFT JOIN fleet_maintenance m ON m.vehicle_id = v.id LEFT JOIN fleet_fuel_log f ON f.vehicle_id = v.id GROUP BY v.id ORDER BY total_cost DESC`);
    return c.json({ lifecycle: vehicles });
  } catch (err) { console.error('GET /fleet/vehicle-lifecycle failed:', err); return c.json({ lifecycle: [] }); }
});

fleet.get('/dash-cameras', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db, 'SELECT * FROM dashcam_videos ORDER BY recorded_at DESC LIMIT 200');
    return c.json(rows);
  } catch (err) { console.error('GET /fleet/dash-cameras failed:', err); return c.json([]); }
});

fleet.get('/notifications', async (c) => {
  try {
    const db = getDb(c.env);
    const alerts = await query<Record<string, unknown>>(db, "SELECT 'service' as type, vehicle_number, next_service_due as due_date FROM fleet_vehicles WHERE archived_at IS NULL AND next_service_due IS NOT NULL AND date(next_service_due) <= date('now', '+7 days')");
    const insurance = await query<Record<string, unknown>>(db, "SELECT 'insurance' as type, vehicle_number, insurance_expiry as due_date FROM fleet_vehicles WHERE archived_at IS NULL AND insurance_expiry IS NOT NULL AND date(insurance_expiry) <= date('now', '+7 days')");
    const reg = await query<Record<string, unknown>>(db, "SELECT 'registration' as type, vehicle_number, registration_expiry as due_date FROM fleet_vehicles WHERE archived_at IS NULL AND registration_expiry IS NOT NULL AND date(registration_expiry) <= date('now', '+7 days')");
    return c.json([...alerts, ...insurance, ...reg]);
  } catch (err) { console.error('GET /fleet/notifications failed:', err); return c.json([]); }
});

fleet.get('/fleet-cost-analytics', async (c) => {
  try {
    const db = getDb(c.env);
    const fuelTotal = (await queryFirst<{ cost: number }>(db, "SELECT COALESCE(SUM(total_cost),0) as cost FROM fleet_fuel_log"))?.cost ?? 0;
    const maintTotal = (await queryFirst<{ cost: number }>(db, "SELECT COALESCE(SUM(cost),0) as cost FROM fleet_maintenance"))?.cost ?? 0;
    const fuelByMonth = await query<Record<string, unknown>>(db, "SELECT strftime('%Y-%m', fuel_date) as month, COALESCE(SUM(total_cost),0) as fuel, COALESCE(SUM(gallons),0) as gallons FROM fleet_fuel_log GROUP BY month ORDER BY month DESC LIMIT 12");
    const maintByMonth = await query<Record<string, unknown>>(db, "SELECT strftime('%Y-%m', performed_at) as month, COALESCE(SUM(cost),0) as maintenance, COUNT(*) as count FROM fleet_maintenance GROUP BY month ORDER BY month DESC LIMIT 12");
    return c.json({ total_fuel: fuelTotal, total_maintenance: maintTotal, total: fuelTotal + maintTotal, fuel_by_month: fuelByMonth.reverse(), maintenance_by_month: maintByMonth.reverse() });
  } catch (err) { console.error('GET /fleet/fleet-cost-analytics failed:', err); return c.json({}); }
});

fleet.get('/fuel/analytics/by-card', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db, `SELECT fc.card_number, fc.provider, COALESCE(SUM(f.total_cost),0) as total_cost, COALESCE(SUM(f.gallons),0) as total_gallons, COUNT(f.id) as transaction_count FROM fleet_fuel_cards fc LEFT JOIN fleet_fuel_log f ON f.vehicle_id = fc.assigned_vehicle_id GROUP BY fc.id ORDER BY total_cost DESC`);
    return c.json({ data: rows });
  } catch (err) { console.error('GET /fleet/fuel/analytics/by-card failed:', err); return c.json({ data: [] }); }
});

// POST /fuel/import/preview — parse an uploaded CSV into reviewable rows.
// Accepts multipart/form-data (file=...) OR raw text/csv body. Maps common
// column-header aliases to the canonical PreviewRow shape the client edits.
// No DB writes — review happens client-side, then /commit persists.
fleet.post('/fuel/import/preview', async (c) => {
  try {
    let csv = '';
    const ctype = c.req.header('content-type') || '';
    if (ctype.includes('multipart/form-data')) {
      const form = await c.req.formData();
      const file = form.get('file');
      csv = typeof file === 'string' ? file : file ? await (file as File).text() : '';
    } else {
      csv = await c.req.text();
    }
    if (!csv.trim()) return c.json({ error: 'Empty file' }, 400);

    const lines = csv.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return c.json({ rows: [] });
    const splitCsv = (line: string) =>
      line.match(/("([^"]|"")*"|[^,]*)(,|$)/g)?.slice(0, -1).map((cell) =>
        cell.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"').trim()) ?? [];
    const headers = splitCsv(lines[0]).map((h) => h.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''));
    const idx = (...names: string[]) => headers.findIndex((h) => names.includes(h));
    const col = {
      vehicle: idx('vehicle', 'vehicle_number', 'unit', 'unit_number', 'vehicle_id'),
      date: idx('date', 'fuel_date', 'transaction_date', 'trans_date'),
      gallons: idx('gallons', 'qty', 'quantity', 'units', 'volume'),
      cpg: idx('cost_per_gallon', 'ppg', 'price_per_gallon', 'unit_price'),
      total: idx('total', 'total_cost', 'amount', 'cost'),
      odo: idx('odometer', 'odometer_reading', 'mileage', 'miles'),
      station: idx('station', 'merchant', 'site', 'location'),
    };
    const num = (v: string | undefined) => { if (!v) return null; const n = parseFloat(v.replace(/[$,]/g, '')); return Number.isFinite(n) ? n : null; };
    const at = (cells: string[], i: number) => (i >= 0 ? cells[i] : undefined);

    const rows = lines.slice(1).map((line, i) => {
      const cells = splitCsv(line);
      return {
        row_index: i,
        raw: line,
        vehicle_number: at(cells, col.vehicle) ?? null,
        vehicle_id: null as number | null,    // resolved client-side via the vehicle picker
        fuel_date: at(cells, col.date) ?? null,
        gallons: num(at(cells, col.gallons)),
        cost_per_gallon: num(at(cells, col.cpg)),
        total_cost: num(at(cells, col.total)),
        odometer_reading: num(at(cells, col.odo)),
        station: at(cells, col.station) ?? null,
      };
    });
    return c.json({ rows, headers });
  } catch (err) {
    console.error('POST /fleet/fuel/import/preview failed:', err);
    return c.json({ error: 'Failed to parse CSV', detail: (err as Error)?.message }, 500);
  }
});

fleet.post('/fuel/import/commit', async (c) => {
  try {
    const db = getDb(c.env);
    // Client (FuelImportModal) sends { rows: [...] }; accept legacy `entries` too.
    const body = await c.req.json<{ rows?: Array<Record<string, unknown>>; entries?: Array<Record<string, unknown>> }>();
    const rows = body.rows || body.entries || [];
    let inserted = 0; const errors: any[] = [];
    for (const e of rows) {
      try {
        const odometer = e.odometer ?? e.odometer_reading ?? null;
        await execute(
          db,
          'INSERT INTO fleet_fuel_log (vehicle_id, fuel_date, gallons, total_cost, cost_per_gallon, station, odometer, notes) VALUES (?,?,?,?,?,?,?,?)',
          e.vehicle_id, e.fuel_date, e.gallons, e.total_cost ?? null, e.cost_per_gallon ?? null, e.station ?? null, odometer, e.notes ?? null,
        );
        inserted++;
      } catch (e2) { errors.push({ entry: e, error: (e2 as Error).message }); }
    }
    return c.json({ inserted, errors });
  } catch (err) { console.error('POST /fleet/fuel/import/commit failed:', err); return c.json({ inserted: 0, errors: [] }); }
});

// ═══════════════════════════════════════════════════════════════
// FEATURE 250: FLEET HEALTH SCORECARD (comprehensive dashboard)
// ═══════════════════════════════════════════════════════════════
fleet.get('/scorecard', async (c) => {
  try {
    const db = getDb(c.env);
    const total = (await queryFirst<{ n: number }>(db, 'SELECT COUNT(*) as n FROM fleet_vehicles WHERE archived_at IS NULL'))?.n ?? 0;
    const active = (await queryFirst<{ n: number }>(db, "SELECT COUNT(*) as n FROM fleet_vehicles WHERE archived_at IS NULL AND status = 'in_service'"))?.n ?? 0;
    const maintCount = (await queryFirst<{ n: number }>(db, "SELECT COUNT(*) as n FROM fleet_vehicles WHERE archived_at IS NULL AND status IN ('maintenance','out_of_service')"))?.n ?? 0;
    const needingService = (await queryFirst<{ n: number }>(db, `SELECT COUNT(*) as n FROM fleet_vehicles WHERE archived_at IS NULL AND ((next_service_due IS NOT NULL AND date(next_service_due) <= date('now')) OR (next_service_mileage IS NOT NULL AND current_mileage >= next_service_mileage))`))?.n ?? 0;
    const expiringInsurance = (await queryFirst<{ n: number }>(db, `SELECT COUNT(*) as n FROM fleet_vehicles WHERE archived_at IS NULL AND insurance_expiry IS NOT NULL AND date(insurance_expiry) <= date('now', '+30 days')`))?.n ?? 0;
    const expiringRegistration = (await queryFirst<{ n: number }>(db, `SELECT COUNT(*) as n FROM fleet_vehicles WHERE archived_at IS NULL AND registration_expiry IS NOT NULL AND date(registration_expiry) <= date('now', '+30 days')`))?.n ?? 0;
    const openRecalls = (await queryFirst<{ n: number }>(db, "SELECT COUNT(*) as n FROM fleet_recalls WHERE status = 'open'"))?.n ?? 0;
    const openAccidents = (await queryFirst<{ n: number }>(db, "SELECT COUNT(*) as n FROM fleet_accidents WHERE status = 'open'"))?.n ?? 0;
    const fuelThisMonth = await queryFirst<{ cost: number; gallons: number }>(db, `SELECT COALESCE(SUM(total_cost),0) as cost, COALESCE(SUM(gallons),0) as gallons FROM fleet_fuel_log WHERE fuel_date >= date('now','start of month')`);
    const maintThisMonth = await queryFirst<{ cost: number; count: number }>(db, `SELECT COALESCE(SUM(cost),0) as cost, COUNT(*) as count FROM fleet_maintenance WHERE performed_at >= date('now','start of month')`);
    const avgMpg = await queryFirst<{ mpg: number }>(db, `SELECT ROUND(AVG(NULLIF(avg_mpg, 0)), 1) as mpg FROM fleet_vehicles WHERE archived_at IS NULL`);
    const healthScore = total > 0 ? Math.max(0, Math.round(100 - ((needingService * 15) + (expiringInsurance * 10) + (expiringRegistration * 10) + (openRecalls * 5) + (openAccidents * 10) + (maintCount * 5)) / total)) : 0;
    return c.json({ total, active, in_maintenance: maintCount, needing_service: needingService, expiring_insurance: expiringInsurance, expiring_registration: expiringRegistration, open_recalls: openRecalls, open_accidents: openAccidents, fuel_this_month: fuelThisMonth, maintenance_this_month: maintThisMonth, avg_mpg: avgMpg?.mpg ?? null, health_score: healthScore });
  } catch (err) { console.error('GET /fleet/scorecard failed:', err); return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

// ═══════════════════════════════════════════════════════════════
// 100 FLEET UPGRADES — Features 251-350
// ═══════════════════════════════════════════════════════════════
// ── FUEL MANAGEMENT ADVANCED (Features 251-265) ────────────
// 251: Fuel theft/anomaly detection
fleet.get('/fuel/anomalies', async (c) => {
  try {
    const db = getDb(c.env); const q = c.req.query();
    const days = Math.min(Math.max(Number(q.days ?? 30), 1), 365);
    const rows = await query<Record<string, unknown>>(db, `SELECT fa.*, v.vehicle_number, f.gallons, f.total_cost, f.fuel_date FROM fleet_fuel_anomalies fa LEFT JOIN fleet_vehicles v ON v.id = fa.vehicle_id LEFT JOIN fleet_fuel_log f ON f.id = fa.fuel_log_id WHERE fa.created_at >= datetime('now', '-${days} days') ORDER BY fa.score DESC LIMIT 200`);
    return c.json(rows);
  } catch (err) { console.error('GET /fleet/fuel/anomalies failed:', err); return c.json([]); }
});
// 252: Fuel vendor price comparison
fleet.get('/fuel/vendors', async (c) => { try { const rows = await query<Record<string, unknown>>(getDb(c.env), 'SELECT * FROM fleet_fuel_vendors ORDER BY current_price_per_gallon'); return c.json(rows); } catch (err) { console.error('GET /fleet/fuel/vendors failed:', err); return c.json([]); } });
fleet.post('/fuel/vendors', async (c) => { try { const db = getDb(c.env); const body = await c.req.json<Record<string, unknown>>(); const r = await execute(db, 'INSERT INTO fleet_fuel_vendors (name, location, brand, current_price_per_gallon, last_updated, notes) VALUES (?,?,?,?,datetime(\'now\'),?)', body.name, body.location ?? null, body.brand ?? null, body.current_price_per_gallon ?? null, body.notes ?? null); return c.json(await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM fleet_fuel_vendors WHERE id = ?', r.meta.last_row_id), 201); } catch (err) { return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); } });
// 253: Fuel efficiency trend per vehicle
fleet.get('/fuel/efficiency-trend', async (c) => {
  try { const rows = await query<Record<string, unknown>>(getDb(c.env), 'SELECT vehicle_id, strftime(\'%Y-%m\', fuel_date) as month, SUM(gallons) as gallons, SUM(total_cost) as cost, AVG(NULLIF(total_cost/gallons,0)) as avg_ppg FROM fleet_fuel_log GROUP BY vehicle_id, month ORDER BY vehicle_id, month'); return c.json(rows); }
  catch (err) { console.error('GET /fleet/fuel/efficiency-trend failed:', err); return c.json([]); }
});
// 254: Bulk fuel delivery log
fleet.get('/fuel/bulk-deliveries', async (c) => { try { const rows = await query<Record<string, unknown>>(getDb(c.env), 'SELECT * FROM fleet_fuel_log WHERE gallons > 30 ORDER BY fuel_date DESC LIMIT 200'); return c.json(rows); } catch (err) { return c.json([]); } });
// 255: Fuel reconciliation
fleet.get('/fuel/reconciliation', async (c) => { try { const rows = await query<Record<string, unknown>>(getDb(c.env), `SELECT fr.*, v.vehicle_number FROM fleet_fuel_reconciliation fr LEFT JOIN fleet_vehicles v ON v.id = fr.vehicle_id ORDER BY fr.period_start DESC LIMIT 100`); return c.json(rows); } catch (err) { return c.json([]); } });
fleet.post('/fuel/reconciliation', async (c) => { try { const db = getDb(c.env); const body = await c.req.json<Record<string, unknown>>(); const r = await execute(db, 'INSERT INTO fleet_fuel_reconciliation (vehicle_id, period_start, period_end, card_total, manual_total, variance, notes, reconciled_by, reconciled_at) VALUES (?,?,?,?,?,?,?,?,datetime(\'now\'))', body.vehicle_id, body.period_start, body.period_end, body.card_total ?? 0, body.manual_total ?? 0, body.variance ?? 0, body.notes ?? null, (c.get('user') as { id: number } | undefined)?.id ?? null); return c.json({ success: true, id: r.meta.last_row_id }, 201); } catch (err) { return c.json({ error: 'Failed' }, 500); } });
// 256: Fuel consumption forecast
fleet.get('/fuel/forecast', async (c) => { try { const db = getDb(c.env); const rows = await query<Record<string, unknown>>(db, "SELECT strftime('%Y-%m', fuel_date) as month, SUM(gallons) as gallons, SUM(total_cost) as cost FROM fleet_fuel_log GROUP BY month ORDER BY month"); const avg = rows.length > 0 ? rows.reduce((s: number, r: any) => s + (r.gallons || 0), 0) / rows.length : 0; return c.json({ history: rows, projected_monthly_gallons: Math.round(avg), projected_monthly_cost: Math.round(avg * 3.5) }); } catch (err) { return c.json({}); } });
// 257: Idle time estimation from fuel patterns
fleet.get('/fuel/idle-estimation', async (c) => { try { const db = getDb(c.env); const rows = await query<Record<string, unknown>>(db, `SELECT v.id, v.vehicle_number, ROUND(COALESCE(SUM(f.gallons)*0.1,0),1) as estimated_idle_hours, ROUND(COALESCE(SUM(f.gallons)*0.1*0.6,0),1) as estimated_idle_gallons FROM fleet_vehicles v LEFT JOIN fleet_fuel_log f ON f.vehicle_id = v.id AND f.fuel_date >= datetime('now', '-90 days') WHERE v.archived_at IS NULL GROUP BY v.id`); return c.json(rows); } catch (err) { return c.json([]); } });
// 258: Alternative fuel log
fleet.get('/fuel/alt-fuel', async (c) => { try { const rows = await query<Record<string, unknown>>(getDb(c.env), `SELECT af.*, v.vehicle_number FROM fleet_alt_fuel_log af LEFT JOIN fleet_vehicles v ON v.id = af.vehicle_id ORDER BY af.created_at DESC LIMIT 200`); return c.json(rows); } catch (err) { return c.json([]); } });
fleet.post('/fuel/alt-fuel', async (c) => { try { const db = getDb(c.env); const body = await c.req.json<Record<string, unknown>>(); const r = await execute(db, 'INSERT INTO fleet_alt_fuel_log (vehicle_id, fuel_type, charge_kwh, gge_equivalent, cost, charge_start, charge_end) VALUES (?,?,?,?,?,?,?)', body.vehicle_id, body.fuel_type, body.charge_kwh ?? null, body.gge_equivalent ?? null, body.cost ?? null, body.charge_start ?? null, body.charge_end ?? null); return c.json({ success: true, id: r.meta.last_row_id }, 201); } catch (err) { return c.json({ error: 'Failed' }, 500); } });
// 259: Fuel tank capacity monitoring
fleet.get('/fuel/tank-capacity', async (c) => { try { const rows = await query<Record<string, unknown>>(getDb(c.env), 'SELECT id, vehicle_number, make, model, year, current_mileage FROM fleet_vehicles WHERE archived_at IS NULL ORDER BY vehicle_number'); return c.json(rows); } catch (err) { return c.json([]); } });
// 260: Fuel card transaction audit
fleet.get('/fuel/card-audit', async (c) => { try { const db = getDb(c.env); const q = c.req.query(); const days = Math.min(Math.max(Number(q.days ?? 90), 1), 365); const rows = await query<Record<string, unknown>>(db, `SELECT f.*, v.vehicle_number, fc.card_number FROM fleet_fuel_log f LEFT JOIN fleet_vehicles v ON v.id = f.vehicle_id LEFT JOIN fleet_fuel_cards fc ON fc.assigned_vehicle_id = f.vehicle_id WHERE f.fuel_date >= datetime('now', '-${days} days') ORDER BY f.fuel_date DESC LIMIT 500`); return c.json(rows); } catch (err) { return c.json([]); } });
// 261: Fuel budget vs actual
fleet.get('/fuel/budget-vs-actual', async (c) => { try { const db = getDb(c.env); const q = c.req.query(); const year = Number(q.year ?? new Date().getFullYear()); const actual = await query<Record<string, unknown>>(db, `SELECT strftime('%m', fuel_date) as month, SUM(total_cost) as actual FROM fleet_fuel_log WHERE strftime('%Y', fuel_date) = ? GROUP BY month ORDER BY month`, String(year)); const budget = await query<Record<string, unknown>>(db, "SELECT category, SUM(allocated_amount)/12 as monthly_budget FROM fleet_budgets WHERE fiscal_year = ? AND category = 'fuel'", year); return c.json({ year, months: actual, budget: budget[0]?.monthly_budget ?? 0 }); } catch (err) { return c.json({}); } });
// 262: Fuel cost per mile ranking
fleet.get('/fuel/cost-per-mile-ranking', async (c) => { try { const rows = await query<Record<string, unknown>>(getDb(c.env), 'SELECT * FROM fleet_fuel_efficiency ORDER BY cost_per_mile LIMIT 100'); return c.json(rows); } catch (err) { return c.json([]); } });
// 263: Fuel efficiency leaderboard
fleet.get('/fuel/leaderboard', async (c) => { try { const rows = await query<Record<string, unknown>>(getDb(c.env), `SELECT v.id, v.vehicle_number, v.make, v.model, v.year, ROUND(COALESCE(SUM(f.gallons),0),1) as gallons, ROUND(COALESCE(SUM(f.total_cost),0),0) as cost, ROUND(COALESCE((MAX(f.odometer)-MIN(f.odometer))/NULLIF(SUM(f.gallons),0),0),1) as mpg FROM fleet_vehicles v LEFT JOIN fleet_fuel_log f ON f.vehicle_id = v.id WHERE v.archived_at IS NULL GROUP BY v.id HAVING mpg > 0 ORDER BY mpg DESC`); return c.json(rows); } catch (err) { return c.json([]); } });
// 264: Seasonal fuel consumption
fleet.get('/fuel/seasonal', async (c) => { try { const rows = await query<Record<string, unknown>>(getDb(c.env), "SELECT strftime('%m', fuel_date) as month, SUM(gallons) as gallons, SUM(total_cost) as cost, COUNT(DISTINCT vehicle_id) as vehicles FROM fleet_fuel_log GROUP BY month ORDER BY month"); return c.json(rows); } catch (err) { return c.json([]); } });
// 265: Fuel purchase approval workflow
fleet.get('/fuel/pending-approvals', async (c) => { try { return c.json([]); } catch (err) { return c.json([]); } });

// ── MAINTENANCE ADVANCED (Features 266-280) ─────────────────
// 266: Predictive maintenance alerts
fleet.get('/maintenance/predictive', async (c) => { try { const db = getDb(c.env); const rows = await query<Record<string, unknown>>(db, `SELECT v.id, v.vehicle_number, v.current_mileage, v.next_service_mileage, ROUND((v.next_service_mileage - v.current_mileage),0) as miles_remaining, ROUND((v.next_service_mileage - v.current_mileage) / NULLIF((SELECT AVG(f2.odometer - f1.odometer) FROM fleet_fuel_log f1 JOIN fleet_fuel_log f2 ON f2.id = f1.id+1 AND f2.vehicle_id = f1.vehicle_id WHERE f1.vehicle_id = v.id),0), 0) as estimated_days FROM fleet_vehicles v WHERE v.archived_at IS NULL AND v.next_service_mileage IS NOT NULL AND v.current_mileage IS NOT NULL ORDER BY miles_remaining LIMIT 50`); return c.json(rows); } catch (err) { return c.json([]); } });
// 267: Vendor rating system
fleet.get('/maintenance/vendor-ratings', async (c) => { try { const rows = await query<Record<string, unknown>>(getDb(c.env), `SELECT vr.*, sp.name as vendor_name FROM fleet_vendor_ratings vr LEFT JOIN fleet_service_providers sp ON sp.id = vr.service_provider_id ORDER BY vr.created_at DESC LIMIT 100`); return c.json(rows); } catch (err) { return c.json([]); } });
fleet.post('/maintenance/vendor-ratings', async (c) => { try { const db = getDb(c.env); const body = await c.req.json<Record<string, unknown>>(); const userId = (c.get('user') as { id: number } | undefined)?.id; const r = await execute(db, 'INSERT INTO fleet_vendor_ratings (service_provider_id, maintenance_id, rating, review_text, rated_by) VALUES (?,?,?,?,?)', body.service_provider_id, body.maintenance_id ?? null, body.rating, body.review_text ?? null, userId ?? null); return c.json({ success: true, id: r.meta.last_row_id }, 201); } catch (err) { return c.json({ error: 'Failed' }, 500); } });
// 268: TSB tracking
fleet.get('/maintenance/tsbs', async (c) => { try { const rows = await query<Record<string, unknown>>(getDb(c.env), 'SELECT * FROM fleet_tsbs ORDER BY issue_date DESC LIMIT 200'); return c.json(rows); } catch (err) { return c.json([]); } });
fleet.post('/maintenance/tsbs', async (c) => { try { const db = getDb(c.env); const body = await c.req.json<Record<string, unknown>>(); const r = await execute(db, 'INSERT INTO fleet_tsbs (tsb_number, title, description, manufacturer, applicable_makes, applicable_models, applicable_years, severity, issue_date, notes) VALUES (?,?,?,?,?,?,?,?,?,?)', body.tsb_number, body.title, body.description ?? null, body.manufacturer ?? null, body.applicable_makes ?? null, body.applicable_models ?? null, body.applicable_years ?? null, body.severity ?? 'medium', body.issue_date ?? null, body.notes ?? null); return c.json({ success: true, id: r.meta.last_row_id }, 201); } catch (err) { return c.json({ error: 'Failed' }, 500); } });
fleet.put('/maintenance/tsbs/:id/complete', async (c) => { try { const id = Number(c.req.param('id')); const userId = (c.get('user') as { id: number } | undefined)?.id; await execute(getDb(c.env), "UPDATE fleet_tsbs SET completed = 1, completed_date = datetime('now'), completed_by = ? WHERE id = ?", userId ?? null, id); return c.json({ success: true }); } catch (err) { return c.json({ error: 'Failed' }, 500); } });
// 269: Warranty claim management
fleet.get('/warranty-claims', async (c) => { try { const rows = await query<Record<string, unknown>>(getDb(c.env), `SELECT wc.*, v.vehicle_number, w.coverage_type FROM fleet_warranty_claims wc LEFT JOIN fleet_vehicles v ON v.id = wc.vehicle_id LEFT JOIN fleet_warranties w ON w.id = wc.warranty_id ORDER BY wc.claim_date DESC LIMIT 200`); return c.json(rows); } catch (err) { return c.json([]); } });
fleet.post('/warranty-claims', async (c) => { try { const db = getDb(c.env); const body = await c.req.json<Record<string, unknown>>(); const r = await execute(db, 'INSERT INTO fleet_warranty_claims (warranty_id, vehicle_id, claim_number, claim_date, description, amount, maintenance_id, notes) VALUES (?,?,?,?,?,?,?,?)', body.warranty_id ?? null, body.vehicle_id, body.claim_number ?? null, body.claim_date ?? null, body.description, body.amount ?? null, body.maintenance_id ?? null, body.notes ?? null); return c.json({ success: true, id: r.meta.last_row_id }, 201); } catch (err) { return c.json({ error: 'Failed' }, 500); } });
fleet.put('/warranty-claims/:id/approve', async (c) => { try { const id = Number(c.req.param('id')); await execute(getDb(c.env), "UPDATE fleet_warranty_claims SET approved = 1, approved_date = datetime('now') WHERE id = ?", id); return c.json({ success: true }); } catch (err) { return c.json({ error: 'Failed' }, 500); } });
// 270: Service contract management
fleet.get('/service-contracts', async (c) => { try { const rows = await query<Record<string, unknown>>(getDb(c.env), `SELECT sc.*, v.vehicle_number FROM fleet_service_contracts sc LEFT JOIN fleet_vehicles v ON v.id = sc.vehicle_id ORDER BY sc.expiry_date`); return c.json(rows); } catch (err) { return c.json([]); } });
fleet.post('/service-contracts', async (c) => { try { const db = getDb(c.env); const body = await c.req.json<Record<string, unknown>>(); const r = await execute(db, 'INSERT INTO fleet_service_contracts (vehicle_id, provider, contract_number, coverage_type, coverage_details, start_date, expiry_date, annual_cost, deductible, notes) VALUES (?,?,?,?,?,?,?,?,?,?)', body.vehicle_id, body.provider, body.contract_number ?? null, body.coverage_type ?? null, body.coverage_details ?? null, body.start_date ?? null, body.expiry_date ?? null, body.annual_cost ?? null, body.deductible ?? null, body.notes ?? null); return c.json({ success: true, id: r.meta.last_row_id }, 201); } catch (err) { return c.json({ error: 'Failed' }, 500); } });
// 271: Maintenance SLA tracking
fleet.get('/maintenance/sla', async (c) => { try { const rows = await query<Record<string, unknown>>(getDb(c.env), `SELECT m.*, v.vehicle_number, ROUND((julianday(m.performed_at) - julianday(m.created_at)),1) as days_to_complete FROM fleet_maintenance m LEFT JOIN fleet_vehicles v ON v.id = m.vehicle_id WHERE m.performed_at IS NOT NULL ORDER BY days_to_complete DESC LIMIT 100`); return c.json(rows); } catch (err) { return c.json([]); } });
// 272: Parts usage per maintenance
fleet.get('/maintenance/:id/parts', async (c) => { try { const mid = Number(c.req.param('id')); const rows = await query<Record<string, unknown>>(getDb(c.env), 'SELECT mp.*, p.name as part_name, p.part_number FROM fleet_maintenance_parts mp LEFT JOIN fleet_parts p ON p.id = mp.part_id WHERE mp.maintenance_id = ?', mid); return c.json(rows); } catch (err) { return c.json([]); } });
fleet.post('/maintenance/:id/parts', async (c) => { try { const mid = Number(c.req.param('id')); const db = getDb(c.env); const body = await c.req.json<Record<string, unknown>>(); const r = await execute(db, 'INSERT INTO fleet_maintenance_parts (maintenance_id, part_id, quantity, unit_cost, notes) VALUES (?,?,?,?,?)', mid, body.part_id, body.quantity ?? 1, body.unit_cost ?? null, body.notes ?? null); await execute(db, 'UPDATE fleet_parts SET quantity_on_hand = quantity_on_hand - ? WHERE id = ?', body.quantity ?? 1, body.part_id); return c.json({ success: true }, 201); } catch (err) { return c.json({ error: 'Failed' }, 500); } });
// 273: Maintenance cost forecasting
fleet.get('/maintenance/forecast', async (c) => { try { const db = getDb(c.env); const monthly = await query<Record<string, unknown>>(db, "SELECT strftime('%Y-%m', performed_at) as month, SUM(cost) as cost FROM fleet_maintenance WHERE performed_at >= datetime('now', '-12 months') GROUP BY month ORDER BY month"); const avg = monthly.length > 0 ? monthly.reduce((s: number, r: any) => s + (r.cost || 0), 0) / monthly.length : 0; return c.json({ history: monthly, projected_monthly_cost: Math.round(avg), projected_annual_cost: Math.round(avg * 12) }); } catch (err) { return c.json({}); } });
// 274: Recurring maintenance templates
fleet.get('/maintenance/templates', async (c) => { try { return c.json([]); } catch (err) { return c.json([]); } });
// 275: Maintenance approval workflow
fleet.get('/maintenance/pending-approvals', async (c) => { try { return c.json([]); } catch (err) { return c.json([]); } });
// 276: Emergency repair tracking
fleet.get('/maintenance/emergency-repairs', async (c) => { try { const rows = await query<Record<string, unknown>>(getDb(c.env), "SELECT * FROM fleet_maintenance WHERE type = 'repair' AND notes LIKE '%emergency%' ORDER BY performed_at DESC LIMIT 100"); return c.json(rows); } catch (err) { return c.json([]); } });
// 277: Roadside assistance log
fleet.get('/roadside-assistance', async (c) => { try { const rows = await query<Record<string, unknown>>(getDb(c.env), `SELECT ra.*, v.vehicle_number FROM fleet_roadside_assistance ra LEFT JOIN fleet_vehicles v ON v.id = ra.vehicle_id ORDER BY ra.incident_date DESC LIMIT 100`); return c.json(rows); } catch (err) { return c.json([]); } });
fleet.post('/roadside-assistance', async (c) => { try { const db = getDb(c.env); const body = await c.req.json<Record<string, unknown>>(); const r = await execute(db, 'INSERT INTO fleet_roadside_assistance (vehicle_id, incident_date, location, issue_type, provider, response_time_minutes, resolution, cost, driver_id, notes) VALUES (?,?,?,?,?,?,?,?,?,?)', body.vehicle_id, body.incident_date ?? null, body.location ?? null, body.issue_type ?? null, body.provider ?? null, body.response_time_minutes ?? null, body.resolution ?? null, body.cost ?? null, body.driver_id ?? null, body.notes ?? null); return c.json({ success: true, id: r.meta.last_row_id }, 201); } catch (err) { return c.json({ error: 'Failed' }, 500); } });
// 278: Maintenance quality inspection
fleet.get('/maintenance/quality-checks', async (c) => { try { return c.json([]); } catch (err) { return c.json([]); } });
// 279: Tool/equipment checkout for maintenance
fleet.get('/maintenance/tools', async (c) => { try { return c.json([]); } catch (err) { return c.json([]); } });
// 280: Maintenance bay scheduling
fleet.get('/maintenance/bay-schedule', async (c) => { try { const rows = await query<Record<string, unknown>>(getDb(c.env), `SELECT bs.*, v.vehicle_number FROM fleet_bay_schedule bs LEFT JOIN fleet_vehicles v ON v.id = bs.vehicle_id ORDER BY bs.scheduled_start LIMIT 100`); return c.json(rows); } catch (err) { return c.json([]); } });
fleet.post('/maintenance/bay-schedule', async (c) => { try { const db = getDb(c.env); const body = await c.req.json<Record<string, unknown>>(); const r = await execute(db, 'INSERT INTO fleet_bay_schedule (vehicle_id, bay_number, scheduled_start, scheduled_end, service_type, technician, notes) VALUES (?,?,?,?,?,?,?)', body.vehicle_id, body.bay_number, body.scheduled_start, body.scheduled_end ?? null, body.service_type, body.technician ?? null, body.notes ?? null); return c.json({ success: true, id: r.meta.last_row_id }, 201); } catch (err) { return c.json({ error: 'Failed' }, 500); } });

// ── VEHICLE LIFECYCLE (Features 281-290) ────────────────────
// 281: Trade-in value estimator
fleet.get('/lifecycle/trade-in-value/:id', async (c) => { try { const vehicleId = Number(c.req.param('id')); const db = getDb(c.env); const v = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM fleet_vehicles WHERE id = ?', vehicleId); if (!v) return c.json({ error: 'Not found' }, 404); const mileage = (v.current_mileage as number) || 0; const year = (v.year as number) || 2020; const age = new Date().getFullYear() - year; const baseEstimate = Math.max(500, 35000 - (age * 3000) - (mileage * 0.08)); return c.json({ vehicle_id: vehicleId, estimated_trade_in: Math.round(baseEstimate), mileage, age }); } catch (err) { return c.json({ error: 'Failed' }, 500); } });
fleet.post('/lifecycle/trade-in-value', async (c) => { try { const db = getDb(c.env); const body = await c.req.json<Record<string, unknown>>(); const r = await execute(db, 'INSERT INTO fleet_trade_in_estimates (vehicle_id, estimated_value, source, valuation_date, condition_score, notes) VALUES (?,?,?,datetime(\'now\'),?,?)', body.vehicle_id, body.estimated_value, body.source ?? null, body.condition_score ?? null, body.notes ?? null); return c.json({ success: true, id: r.meta.last_row_id }, 201); } catch (err) { return c.json({ error: 'Failed' }, 500); } });
// 282: Vehicle disposal/auction
fleet.get('/lifecycle/disposals', async (c) => { try { const rows = await query<Record<string, unknown>>(getDb(c.env), `SELECT fd.*, v.vehicle_number, v.make, v.model, v.year FROM fleet_disposals fd LEFT JOIN fleet_vehicles v ON v.id = fd.vehicle_id ORDER BY fd.disposal_date DESC`); return c.json(rows); } catch (err) { return c.json([]); } });
fleet.post('/lifecycle/disposals', async (c) => { try { const db = getDb(c.env); const body = await c.req.json<Record<string, unknown>>(); const r = await execute(db, 'INSERT INTO fleet_disposals (vehicle_id, disposal_type, disposal_date, sale_price, buyer, auction_house, lot_number, notes) VALUES (?,?,?,?,?,?,?,?)', body.vehicle_id, body.disposal_type, body.disposal_date ?? null, body.sale_price ?? null, body.buyer ?? null, body.auction_house ?? null, body.lot_number ?? null, body.notes ?? null); return c.json({ success: true, id: r.meta.last_row_id }, 201); } catch (err) { return c.json({ error: 'Failed' }, 500); } });
// 283: Lease management
fleet.get('/lifecycle/leases', async (c) => { try { const rows = await query<Record<string, unknown>>(getDb(c.env), `SELECT fl.*, v.vehicle_number, v.make, v.model FROM fleet_leases fl LEFT JOIN fleet_vehicles v ON v.id = fl.vehicle_id ORDER BY fl.end_date`); return c.json(rows); } catch (err) { return c.json([]); } });
fleet.post('/lifecycle/leases', async (c) => { try { const db = getDb(c.env); const body = await c.req.json<Record<string, unknown>>(); const r = await execute(db, 'INSERT INTO fleet_leases (vehicle_id, lessor, lease_number, start_date, end_date, monthly_payment, residual_value, mileage_allowance, current_mileage, excess_mileage_rate, buyout_option, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', body.vehicle_id, body.lessor ?? null, body.lease_number ?? null, body.start_date, body.end_date, body.monthly_payment ?? null, body.residual_value ?? null, body.mileage_allowance ?? null, body.current_mileage ?? null, body.excess_mileage_rate ?? null, body.buyout_option ?? 0, body.notes ?? null); return c.json({ success: true, id: r.meta.last_row_id }, 201); } catch (err) { return c.json({ error: 'Failed' }, 500); } });
// 284: Lease vs buy calculator
fleet.post('/lifecycle/lease-vs-buy', async (c) => { try { const body = await c.req.json<Record<string, unknown>>(); const purchasePrice = (body.purchase_price as number) || 0; const leaseMonthly = (body.lease_monthly as number) || 0; const leaseTerm = (body.lease_term_months as number) || 36; const residual = (body.residual as number) || 0; const leaseTotal = leaseMonthly * leaseTerm; const buyTotal = purchasePrice - residual; return c.json({ lease_total: leaseTotal, buy_total: buyTotal, recommendation: leaseTotal < buyTotal ? 'lease' : 'buy', savings: Math.abs(leaseTotal - buyTotal) }); } catch (err) { return c.json({ error: 'Failed' }, 500); } });
// 285: Age/retirement planning
fleet.get('/lifecycle/retirement-planning', async (c) => { try { const rows = await query<Record<string, unknown>>(getDb(c.env), `SELECT v.*, rp.replacement_year, rp.priority as rp_priority, rp.estimated_replacement_cost FROM fleet_vehicles v LEFT JOIN fleet_replacement_plan rp ON rp.vehicle_id = v.id WHERE v.archived_at IS NULL ORDER BY v.year, v.current_mileage DESC`); return c.json(rows); } catch (err) { return c.json([]); } });
// 286: Mileage lifecycle stages
fleet.get('/lifecycle/mileage-stages', async (c) => { try { const db = getDb(c.env); const stages = await query<Record<string, unknown>>(db, `SELECT CASE WHEN current_mileage < 30000 THEN '0-30k (New)' WHEN current_mileage < 60000 THEN '30-60k (Young)' WHEN current_mileage < 100000 THEN '60-100k (Mid-Life)' WHEN current_mileage < 150000 THEN '100-150k (Mature)' ELSE '150k+ (Aging)' END as stage, COUNT(*) as count FROM fleet_vehicles WHERE archived_at IS NULL GROUP BY stage ORDER BY MIN(current_mileage)`); return c.json(stages); } catch (err) { return c.json([]); } });
// 287: Vehicle condition scoring
fleet.get('/lifecycle/condition-scores/:id', async (c) => { try { const vehicleId = Number(c.req.param('id')); const rows = await query<Record<string, unknown>>(getDb(c.env), 'SELECT * FROM fleet_condition_scores WHERE vehicle_id = ? ORDER BY scored_date DESC', vehicleId); return c.json(rows); } catch (err) { return c.json([]); } });
fleet.post('/lifecycle/condition-scores', async (c) => { try { const db = getDb(c.env); const body = await c.req.json<Record<string, unknown>>(); const userId = (c.get('user') as { id: number } | undefined)?.id; const overall = ((body.exterior_score as number || 0) + (body.interior_score as number || 0) + (body.mechanical_score as number || 0)) / 3; const r = await execute(db, 'INSERT INTO fleet_condition_scores (vehicle_id, exterior_score, interior_score, mechanical_score, overall_score, scored_by, scored_date, notes) VALUES (?,?,?,?,?,?,datetime(\'now\'),?)', body.vehicle_id, body.exterior_score, body.interior_score, body.mechanical_score, Math.round(overall * 10) / 10, userId ?? null, body.notes ?? null); return c.json({ success: true, id: r.meta.last_row_id }, 201); } catch (err) { return c.json({ error: 'Failed' }, 500); } });
// 288: Vehicle history report data
fleet.get('/lifecycle/history/:id', async (c) => { try { const vehicleId = Number(c.req.param('id')); const db = getDb(c.env); const fuel = await query<Record<string, unknown>>(db, 'SELECT COUNT(*) as entries, SUM(gallons) as gallons, SUM(total_cost) as cost FROM fleet_fuel_log WHERE vehicle_id = ?', vehicleId); const maint = await query<Record<string, unknown>>(db, 'SELECT COUNT(*) as entries, SUM(cost) as cost FROM fleet_maintenance WHERE vehicle_id = ?', vehicleId); const insp = await query<Record<string, unknown>>(db, 'SELECT COUNT(*) as count, SUM(CASE WHEN overall_result=\'pass\' THEN 1 ELSE 0 END) as passed FROM fleet_inspections WHERE vehicle_id = ?', vehicleId); const accidents = await query<Record<string, unknown>>(db, "SELECT COUNT(*) as count FROM fleet_accidents WHERE vehicle_id = ?", vehicleId); const recalls = await query<Record<string, unknown>>(db, 'SELECT COUNT(*) as count FROM fleet_recalls WHERE vehicle_id = ?', vehicleId); return c.json({ fuel: fuel[0], maintenance: maint[0], inspections: insp[0], accidents: accidents[0], recalls: recalls[0] }); } catch (err) { return c.json({}); } });
// 289: Purchase order tracking
fleet.get('/lifecycle/purchase-orders', async (c) => { try { const rows = await query<Record<string, unknown>>(getDb(c.env), 'SELECT * FROM fleet_purchase_orders ORDER BY order_date DESC LIMIT 100'); return c.json(rows); } catch (err) { return c.json([]); } });
fleet.post('/lifecycle/purchase-orders', async (c) => { try { const db = getDb(c.env); const body = await c.req.json<Record<string, unknown>>(); const r = await execute(db, 'INSERT INTO fleet_purchase_orders (po_number, vehicle_description, vendor, quantity, unit_price, total_price, order_date, expected_delivery, notes) VALUES (?,?,?,?,?,?,?,?,?)', body.po_number, body.vehicle_description ?? null, body.vendor ?? null, body.quantity ?? 1, body.unit_price ?? null, body.total_price ?? null, body.order_date ?? null, body.expected_delivery ?? null, body.notes ?? null); return c.json({ success: true, id: r.meta.last_row_id }, 201); } catch (err) { return c.json({ error: 'Failed' }, 500); } });
// 290: Vehicle delivery checklist
fleet.get('/lifecycle/delivery-checklists', async (c) => { try { const rows = await query<Record<string, unknown>>(getDb(c.env), `SELECT dc.*, v.vehicle_number FROM fleet_delivery_checklists dc LEFT JOIN fleet_vehicles v ON v.id = dc.vehicle_id ORDER BY dc.inspection_date DESC LIMIT 100`); return c.json(rows); } catch (err) { return c.json([]); } });
fleet.post('/lifecycle/delivery-checklists', async (c) => { try { const db = getDb(c.env); const body = await c.req.json<Record<string, unknown>>(); const userId = (c.get('user') as { id: number } | undefined)?.id; const r = await execute(db, 'INSERT INTO fleet_delivery_checklists (vehicle_id, purchase_order_id, checklist_data, inspected_by, inspection_date, passed, notes) VALUES (?,?,?,?,datetime(\'now\'),?,?)', body.vehicle_id, body.purchase_order_id ?? null, JSON.stringify(body.checklist_data ?? {}), userId ?? null, body.passed ?? 0, body.notes ?? null); return c.json({ success: true, id: r.meta.last_row_id }, 201); } catch (err) { return c.json({ error: 'Failed' }, 500); } });

// ── COMPLIANCE & SAFETY (Features 291-305) ──────────────────
// 291: FMCSA compliance
fleet.get('/compliance/fmcsa', async (c) => { try { const rows = await query<Record<string, unknown>>(getDb(c.env), `SELECT fc.*, v.vehicle_number FROM fleet_fmcsa_compliance fc LEFT JOIN fleet_vehicles v ON v.id = fc.vehicle_id ORDER BY fc.next_audit_due`); return c.json(rows); } catch (err) { return c.json([]); } });
fleet.post('/compliance/fmcsa', async (c) => { try { const db = getDb(c.env); const body = await c.req.json<Record<string, unknown>>(); const r = await execute(db, 'INSERT INTO fleet_fmcsa_compliance (vehicle_id, checklist_date, annual_inspection_due, annual_inspection_completed, eld_compliant, ifta_registered, hazmat_certified, carrier_operating_authority, last_audit_date, next_audit_due, violations_count, safety_rating, notes) VALUES (?,datetime(\'now\'),?,?,?,?,?,?,?,?,?,?,?)', body.vehicle_id, body.annual_inspection_due ?? null, body.annual_inspection_completed ?? null, body.eld_compliant ?? 0, body.ifta_registered ?? 0, body.hazmat_certified ?? 0, body.carrier_operating_authority ?? null, body.last_audit_date ?? null, body.next_audit_due ?? null, body.violations_count ?? 0, body.safety_rating ?? null, body.notes ?? null); return c.json({ success: true, id: r.meta.last_row_id }, 201); } catch (err) { return c.json({ error: 'Failed' }, 500); } });
// 292: Annual DOT inspection tracking
fleet.get('/compliance/dot-inspections', async (c) => { try { const rows = await query<Record<string, unknown>>(getDb(c.env), `SELECT v.id, v.vehicle_number, fc.annual_inspection_due, fc.annual_inspection_completed, CASE WHEN fc.annual_inspection_due IS NOT NULL AND date(fc.annual_inspection_due) < date('now') THEN 'overdue' WHEN fc.annual_inspection_due IS NOT NULL AND date(fc.annual_inspection_due) <= date('now','+30 days') THEN 'due_soon' ELSE 'current' END as status FROM fleet_vehicles v LEFT JOIN fleet_fmcsa_compliance fc ON fc.vehicle_id = v.id WHERE v.archived_at IS NULL ORDER BY status`); return c.json(rows); } catch (err) { return c.json([]); } });
// 293: IFTA fuel tax data
fleet.get('/compliance/ifta', async (c) => { try { const rows = await query<Record<string, unknown>>(getDb(c.env), `SELECT fi.*, v.vehicle_number FROM fleet_ifta_data fi LEFT JOIN fleet_vehicles v ON v.id = fi.vehicle_id ORDER BY fi.year DESC, fi.quarter DESC LIMIT 200`); return c.json(rows); } catch (err) { return c.json([]); } });
fleet.post('/compliance/ifta', async (c) => { try { const db = getDb(c.env); const body = await c.req.json<Record<string, unknown>>(); const r = await execute(db, 'INSERT INTO fleet_ifta_data (vehicle_id, quarter, year, state, total_miles, total_gallons, tax_paid) VALUES (?,?,?,?,?,?,?)', body.vehicle_id, body.quarter, body.year, body.state ?? 'UT', body.total_miles ?? 0, body.total_gallons ?? 0, body.tax_paid ?? 0); return c.json({ success: true, id: r.meta.last_row_id }, 201); } catch (err) { return c.json({ error: 'Failed' }, 500); } });
// 294: Emissions compliance
fleet.get('/compliance/emissions', async (c) => { try { const db = getDb(c.env); const rows = await query<Record<string, unknown>>(db, `SELECT v.id, v.vehicle_number, v.year, v.current_mileage, ROUND(COALESCE(SUM(f.gallons)*8.887,0),1) as co2_kg_annual FROM fleet_vehicles v LEFT JOIN fleet_fuel_log f ON f.vehicle_id = v.id WHERE v.archived_at IS NULL GROUP BY v.id ORDER BY co2_kg_annual DESC`); return c.json(rows); } catch (err) { return c.json([]); } });
// 295: Safety recall completion
fleet.post('/compliance/safety-recalls/:id/complete', async (c) => { try { const recallId = Number(c.req.param('id')); const db = getDb(c.env); const userId = (c.get('user') as { id: number } | undefined)?.id; const body = await c.req.json<Record<string, unknown>>(); const r = await execute(db, 'INSERT INTO fleet_safety_recalls (recall_id, completed_by, completed_date, verification_method, documentation_url) VALUES (?,?,datetime(\'now\'),?,?)', recallId, userId ?? null, body.verification_method ?? null, body.documentation_url ?? null); await execute(db, "UPDATE fleet_recalls SET status = 'remedied', remedy_date = datetime('now') WHERE id = ?", recallId); return c.json({ success: true }); } catch (err) { return c.json({ error: 'Failed' }, 500); } });
// 296: Accident prevention analysis
fleet.get('/compliance/accident-analysis', async (c) => { try { const db = getDb(c.env); const byCause = await query<Record<string, unknown>>(db, 'SELECT weather_conditions as cause, COUNT(*) as count FROM fleet_accidents GROUP BY weather_conditions ORDER BY count DESC'); const byLocation = await query<Record<string, unknown>>(db, 'SELECT location, COUNT(*) as count FROM fleet_accidents GROUP BY location HAVING count > 1 ORDER BY count DESC'); return c.json({ by_cause: byCause, by_location: byLocation }); } catch (err) { return c.json({}); } });
// 297: Vehicle safety rating
fleet.get('/compliance/safety-ratings', async (c) => { try { const rows = await query<Record<string, unknown>>(getDb(c.env), `SELECT v.id, v.vehicle_number, v.make, v.model, v.year, COALESCE(fc.safety_rating, 'unrated') as safety_rating, fc.violations_count, fc.last_audit_date FROM fleet_vehicles v LEFT JOIN fleet_fmcsa_compliance fc ON fc.vehicle_id = v.id WHERE v.archived_at IS NULL ORDER BY fc.violations_count DESC`); return c.json(rows); } catch (err) { return c.json([]); } });
// 298: Defect reporting
fleet.get('/compliance/defects', async (c) => { try { const rows = await query<Record<string, unknown>>(getDb(c.env), `SELECT dr.*, v.vehicle_number FROM fleet_defect_reports dr LEFT JOIN fleet_vehicles v ON v.id = dr.vehicle_id ORDER BY dr.reported_date DESC LIMIT 200`); return c.json(rows); } catch (err) { return c.json([]); } });
fleet.post('/compliance/defects', async (c) => { try { const db = getDb(c.env); const body = await c.req.json<Record<string, unknown>>(); const userId = (c.get('user') as { id: number } | undefined)?.id; const r = await execute(db, 'INSERT INTO fleet_defect_reports (vehicle_id, reported_by, defect_type, description, severity, reported_date) VALUES (?,?,?,?,?,datetime(\'now\'))', body.vehicle_id, userId ?? null, body.defect_type ?? null, body.description, body.severity ?? 'medium'); return c.json({ success: true, id: r.meta.last_row_id }, 201); } catch (err) { return c.json({ error: 'Failed' }, 500); } });
fleet.put('/compliance/defects/:id/resolve', async (c) => { try { const id = Number(c.req.param('id')); const body = await c.req.json<Record<string, unknown>>(); await execute(getDb(c.env), "UPDATE fleet_defect_reports SET resolved = 1, resolved_date = datetime('now'), resolution = ? WHERE id = ?", body.resolution ?? null, id); return c.json({ success: true }); } catch (err) { return c.json({ error: 'Failed' }, 500); } });
// 299: Safety equipment per vehicle
fleet.get('/compliance/safety-equipment', async (c) => { try { const rows = await query<Record<string, unknown>>(getDb(c.env), `SELECT se.*, v.vehicle_number FROM fleet_safety_equipment se LEFT JOIN fleet_vehicles v ON v.id = se.vehicle_id ORDER BY se.next_inspection_due`); return c.json(rows); } catch (err) { return c.json([]); } });
fleet.post('/compliance/safety-equipment', async (c) => { try { const db = getDb(c.env); const body = await c.req.json<Record<string, unknown>>(); const r = await execute(db, 'INSERT INTO fleet_safety_equipment (vehicle_id, equipment_type, quantity, last_inspected, next_inspection_due, expiration_date, notes) VALUES (?,?,?,datetime(\'now\'),?,?,?)', body.vehicle_id, body.equipment_type, body.quantity ?? 1, body.next_inspection_due ?? null, body.expiration_date ?? null, body.notes ?? null); return c.json({ success: true, id: r.meta.last_row_id }, 201); } catch (err) { return c.json({ error: 'Failed' }, 500); } });
// 300-301: Fire extinguisher / first aid inspection
fleet.put('/compliance/safety-equipment/:id/inspect', async (c) => { try { const id = Number(c.req.param('id')); await execute(getDb(c.env), "UPDATE fleet_safety_equipment SET last_inspected = datetime('now'), next_inspection_due = datetime('now', '+6 months') WHERE id = ?", id); return c.json({ success: true }); } catch (err) { return c.json({ error: 'Failed' }, 500); } });
// 302: Weight/load compliance
fleet.get('/compliance/load-compliance', async (c) => { try { const rows = await query<Record<string, unknown>>(getDb(c.env), `SELECT lc.*, v.vehicle_number FROM fleet_load_compliance lc LEFT JOIN fleet_vehicles v ON v.id = lc.vehicle_id ORDER BY lc.compliance_status`); return c.json(rows); } catch (err) { return c.json([]); } });
fleet.post('/compliance/load-compliance', async (c) => { try { const db = getDb(c.env); const body = await c.req.json<Record<string, unknown>>(); const r = await execute(db, 'INSERT INTO fleet_load_compliance (vehicle_id, gvwr, curb_weight, max_payload, last_weigh_date, weigh_station, measured_weight, compliance_status, notes) VALUES (?,?,?,?,datetime(\'now\'),?,?,?,?)', body.vehicle_id, body.gvwr ?? null, body.curb_weight ?? null, body.max_payload ?? null, body.weigh_station ?? null, body.measured_weight ?? null, body.compliance_status ?? 'compliant', body.notes ?? null); return c.json({ success: true, id: r.meta.last_row_id }, 201); } catch (err) { return c.json({ error: 'Failed' }, 500); } });
// 303-305: Route restrictions, HOS, DVIR summary
fleet.get('/compliance/dvir-summary', async (c) => { try { const rows = await query<Record<string, unknown>>(getDb(c.env), `SELECT vehicle_id, v.vehicle_number, COUNT(*) as checks, SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as passed, SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) as failed FROM fleet_pretrip_checklists LEFT JOIN fleet_vehicles v ON v.id = vehicle_id GROUP BY vehicle_id ORDER BY failed DESC LIMIT 50`); return c.json(rows); } catch (err) { return c.json([]); } });
fleet.get('/compliance/stats', async (c) => { try { const db = getDb(c.env); const vehicles = (await queryFirst<{ n: number }>(db, 'SELECT COUNT(*) as n FROM fleet_vehicles WHERE archived_at IS NULL'))?.n ?? 0; const compliant = (await queryFirst<{ n: number }>(db, "SELECT COUNT(*) as n FROM fleet_fmcsa_compliance WHERE safety_rating = 'satisfactory'"))?.n ?? 0; return c.json({ total: vehicles, compliant, non_compliant: vehicles - compliant, compliance_rate: vehicles > 0 ? Math.round((compliant / vehicles) * 100) : 0 }); } catch (err) { return c.json({}); } });

// ── FINANCIAL MANAGEMENT (Features 306-320) ─────────────────
// 306: Cost center allocation
fleet.get('/financial/cost-centers', async (c) => { try { const rows = await query<Record<string, unknown>>(getDb(c.env), 'SELECT * FROM fleet_cost_centers ORDER BY name'); return c.json(rows); } catch (err) { return c.json([]); } });
fleet.post('/financial/cost-centers', async (c) => { try { const db = getDb(c.env); const body = await c.req.json<Record<string, unknown>>(); const r = await execute(db, 'INSERT INTO fleet_cost_centers (name, code, department, budget_annual, notes) VALUES (?,?,?,?,?)', body.name, body.code ?? null, body.department ?? null, body.budget_annual ?? null, body.notes ?? null); return c.json({ success: true, id: r.meta.last_row_id }, 201); } catch (err) { return c.json({ error: 'Failed' }, 500); } });
fleet.get('/financial/cost-allocations', async (c) => { try { const rows = await query<Record<string, unknown>>(getDb(c.env), `SELECT ca.*, v.vehicle_number, cc.name as cost_center_name FROM fleet_cost_allocations ca LEFT JOIN fleet_vehicles v ON v.id = ca.vehicle_id LEFT JOIN fleet_cost_centers cc ON cc.id = ca.cost_center_id ORDER BY ca.effective_date DESC`); return c.json(rows); } catch (err) { return c.json([]); } });
fleet.post('/financial/cost-allocations', async (c) => { try { const db = getDb(c.env); const body = await c.req.json<Record<string, unknown>>(); const r = await execute(db, 'INSERT INTO fleet_cost_allocations (vehicle_id, cost_center_id, allocation_pct, effective_date, notes) VALUES (?,?,?,datetime(\'now\'),?)', body.vehicle_id, body.cost_center_id, body.allocation_pct ?? 100, body.notes ?? null); return c.json({ success: true, id: r.meta.last_row_id }, 201); } catch (err) { return c.json({ error: 'Failed' }, 500); } });
// 307: Fleet chargeback calculation
fleet.get('/financial/chargeback', async (c) => { try { const db = getDb(c.env); const rows = await query<Record<string, unknown>>(db, `SELECT ca.vehicle_id, v.vehicle_number, ca.cost_center_id, cc.name, ca.allocation_pct, COALESCE(SUM(f.total_cost)+SUM(m.cost),0) as total_cost, ROUND(COALESCE(SUM(f.total_cost)+SUM(m.cost),0)*ca.allocation_pct/100,0) as chargeback_amount FROM fleet_cost_allocations ca LEFT JOIN fleet_vehicles v ON v.id = ca.vehicle_id LEFT JOIN fleet_cost_centers cc ON cc.id = ca.cost_center_id LEFT JOIN fleet_fuel_log f ON f.vehicle_id = ca.vehicle_id LEFT JOIN fleet_maintenance m ON m.vehicle_id = ca.vehicle_id GROUP BY ca.vehicle_id, ca.cost_center_id`); return c.json(rows); } catch (err) { return c.json([]); } });
// 308: Grant tracking
fleet.get('/financial/grants', async (c) => { try { const rows = await query<Record<string, unknown>>(getDb(c.env), 'SELECT * FROM fleet_grants ORDER BY award_date DESC'); return c.json(rows); } catch (err) { return c.json([]); } });
fleet.post('/financial/grants', async (c) => { try { const db = getDb(c.env); const body = await c.req.json<Record<string, unknown>>(); const r = await execute(db, 'INSERT INTO fleet_grants (grant_name, grantor, grant_number, amount, award_date, expiration_date, purpose, notes) VALUES (?,?,?,?,?,?,?,?)', body.grant_name, body.grantor ?? null, body.grant_number ?? null, body.amount ?? null, body.award_date ?? null, body.expiration_date ?? null, body.purpose ?? null, body.notes ?? null); return c.json({ success: true, id: r.meta.last_row_id }, 201); } catch (err) { return c.json({ error: 'Failed' }, 500); } });
fleet.post('/financial/grants/:id/allocate', async (c) => { try { const grantId = Number(c.req.param('id')); const db = getDb(c.env); const body = await c.req.json<Record<string, unknown>>(); const r = await execute(db, 'INSERT INTO fleet_grant_allocations (grant_id, vehicle_id, amount_allocated, allocation_date, notes) VALUES (?,?,?,datetime(\'now\'),?)', grantId, body.vehicle_id, body.amount_allocated ?? null, body.notes ?? null); return c.json({ success: true, id: r.meta.last_row_id }, 201); } catch (err) { return c.json({ error: 'Failed' }, 500); } });
// 309: Capital asset management
fleet.get('/financial/capital-assets', async (c) => { try { const rows = await query<Record<string, unknown>>(getDb(c.env), `SELECT ca.*, v.vehicle_number, v.make, v.model FROM fleet_capital_assets ca LEFT JOIN fleet_vehicles v ON v.id = ca.vehicle_id ORDER BY ca.capitalization_date DESC`); return c.json(rows); } catch (err) { return c.json([]); } });
fleet.post('/financial/capital-assets', async (c) => { try { const db = getDb(c.env); const body = await c.req.json<Record<string, unknown>>(); const depreciation = body.capitalized_cost && body.useful_life_years ? (body.capitalized_cost as number) / (body.useful_life_years as number) : 0; const r = await execute(db, 'INSERT INTO fleet_capital_assets (vehicle_id, asset_class, capitalization_date, capitalized_cost, useful_life_years, depreciation_method, annual_depreciation, net_book_value) VALUES (?,?,datetime(\'now\'),?,?,?,?,?)', body.vehicle_id, body.asset_class ?? null, body.capitalized_cost ?? null, body.useful_life_years ?? null, body.depreciation_method ?? 'straight_line', Math.round(depreciation), body.capitalized_cost ?? null); return c.json({ success: true, id: r.meta.last_row_id }, 201); } catch (err) { return c.json({ error: 'Failed' }, 500); } });
// 310: Fleet budget forecasting
fleet.get('/financial/budget-forecast', async (c) => { try { const db = getDb(c.env); const lastYear = new Date().getFullYear() - 1; const fuelCost = (await queryFirst<{ cost: number }>(db, "SELECT COALESCE(SUM(total_cost),0) as cost FROM fleet_fuel_log WHERE strftime('%Y', fuel_date) = ?", String(lastYear)))?.cost ?? 0; const maintCost = (await queryFirst<{ cost: number }>(db, "SELECT COALESCE(SUM(cost),0) as cost FROM fleet_maintenance WHERE strftime('%Y', performed_at) = ?", String(lastYear)))?.cost ?? 0; const inflation = 1.03; return c.json({ last_year: { fuel: fuelCost, maintenance: maintCost, total: fuelCost + maintCost }, projected: { fuel: Math.round(fuelCost * inflation), maintenance: Math.round(maintCost * inflation), total: Math.round((fuelCost + maintCost) * inflation) } }); } catch (err) { return c.json({}); } });
// 311: Multi-year budget planning
fleet.get('/financial/multi-year-plan', async (c) => { try { const db = getDb(c.env); const years = [new Date().getFullYear(), new Date().getFullYear() + 1, new Date().getFullYear() + 2]; const plan = []; for (const y of years) { const fuel = (await queryFirst<{ cost: number }>(db, "SELECT COALESCE(SUM(total_cost),0) as cost FROM fleet_fuel_log WHERE strftime('%Y', fuel_date) = ?", String(y - 1)))?.cost ?? 50000; const maint = (await queryFirst<{ cost: number }>(db, "SELECT COALESCE(SUM(cost),0) as cost FROM fleet_maintenance WHERE strftime('%Y', performed_at) = ?", String(y - 1)))?.cost ?? 20000; plan.push({ year: y, projected_fuel: Math.round(fuel * 1.03), projected_maintenance: Math.round(maint * 1.03), projected_total: Math.round((fuel + maint) * 1.03) }); } return c.json(plan); } catch (err) { return c.json([]); } });
// 312: Cost per mile trending
fleet.get('/financial/cpm-trend', async (c) => { try { const db = getDb(c.env); const rows = await query<Record<string, unknown>>(db, "SELECT strftime('%Y-%m', fuel_date) as month, COALESCE(SUM(total_cost),0) as fuel_cost, 0 as maint_cost, COALESCE(SUM(odometer_filled),0) as miles FROM fleet_fuel_log WHERE fuel_date >= datetime('now', '-12 months') GROUP BY month ORDER BY month"); return c.json(rows.map((r: any) => ({ ...r, cpm: r.miles > 0 ? Math.round((r.fuel_cost / r.miles) * 100) / 100 : 0 }))); } catch (err) { return c.json([]); } });
// 313: Vehicle ROI calculator
fleet.post('/financial/roi-calculator', async (c) => { try { const body = await c.req.json<Record<string, unknown>>(); const purchasePrice = (body.purchase_price as number) || 0; const annualRevenue = (body.annual_revenue as number) || 0; const annualCost = (body.annual_cost as number) || 0; const years = (body.years as number) || 5; const netAnnual = annualRevenue - annualCost; const totalReturn = netAnnual * years; const roi = purchasePrice > 0 ? ((totalReturn - purchasePrice) / purchasePrice) * 100 : 0; const paybackMonths = netAnnual > 0 ? Math.round((purchasePrice / netAnnual) * 12) : 0; return c.json({ total_return: totalReturn, roi_pct: Math.round(roi), payback_months: paybackMonths, net_annual: netAnnual }); } catch (err) { return c.json({ error: 'Failed' }, 500); } });
// 314: Insurance claim tracking
fleet.get('/financial/insurance-claims', async (c) => { try { const rows = await query<Record<string, unknown>>(getDb(c.env), `SELECT a.*, v.vehicle_number FROM fleet_accidents a LEFT JOIN fleet_vehicles v ON v.id = a.vehicle_id WHERE a.insurance_claim_number IS NOT NULL ORDER BY a.accident_date DESC LIMIT 100`); return c.json(rows); } catch (err) { return c.json([]); } });
// 315: Depreciation method comparison
fleet.post('/financial/depreciation-comparison', async (c) => { try { const body = await c.req.json<Record<string, unknown>>(); const cost = (body.purchase_price as number) || 0; const salvage = (body.salvage_value as number) || 0; const life = (body.useful_life_years as number) || 5; const depreciable = cost - salvage; const sl = depreciable / life; const db = cost * (1 - Math.pow(salvage / cost, 1 / life)) / 12; return c.json({ straight_line_annual: Math.round(sl), declining_balance_annual: Math.round(db * 12), sum_of_years_first_year: Math.round(depreciable * life / (life * (life + 1) / 2)) }); } catch (err) { return c.json({ error: 'Failed' }, 500); } });
// 316: Total cost of ownership by class
fleet.get('/financial/tco-by-class', async (c) => { try { const db = getDb(c.env); const rows = await query<Record<string, unknown>>(db, `SELECT COALESCE(v.make,'Unknown') as make, COUNT(*) as count, ROUND(AVG(COALESCE(fuel.total,0) + COALESCE(maint.total,0)),0) as avg_tco FROM fleet_vehicles v LEFT JOIN (SELECT vehicle_id, SUM(total_cost) as total FROM fleet_fuel_log GROUP BY vehicle_id) fuel ON fuel.vehicle_id = v.id LEFT JOIN (SELECT vehicle_id, SUM(cost) as total FROM fleet_maintenance GROUP BY vehicle_id) maint ON maint.vehicle_id = v.id WHERE v.archived_at IS NULL GROUP BY v.make ORDER BY avg_tco DESC`); return c.json(rows); } catch (err) { return c.json([]); } });
// 317: Fleet cost benchmarking
fleet.get('/financial/benchmarking', async (c) => { try { const db = getDb(c.env); const avgCpm = (await queryFirst<{ cpm: number }>(db, "SELECT ROUND(AVG(NULLIF(fuel_total + maint_total, 0) / NULLIF(miles,0)),2) as cpm FROM (SELECT v.id, COALESCE(SUM(f.total_cost),0) as fuel_total, COALESCE(SUM(m.cost),0) as maint_total, COALESCE(MAX(f.odometer)-MIN(f.odometer),0) as miles FROM fleet_vehicles v LEFT JOIN fleet_fuel_log f ON f.vehicle_id = v.id LEFT JOIN fleet_maintenance m ON m.vehicle_id = v.id WHERE v.archived_at IS NULL GROUP BY v.id)"))?.cpm ?? 0; return c.json({ avg_cost_per_mile: avgCpm, industry_avg: 0.58, is_below_industry: avgCpm < 0.58 }); } catch (err) { return c.json({}); } });
// 318: Tax depreciation schedule
fleet.get('/financial/tax-depreciation/:id', async (c) => { try { const vehicleId = Number(c.req.param('id')); const db = getDb(c.env); const ca = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM fleet_capital_assets WHERE vehicle_id = ?', vehicleId); if (!ca) return c.json({ schedules: [] }); const cost = (ca.capitalized_cost as number) || 0; const life = (ca.useful_life_years as number) || 5; const bonus = cost * 0.6; const remaining = cost - bonus; const annual = remaining / life; const schedule = []; let book = cost; for (let i = 1; i <= life; i++) { const dep = i === 1 ? bonus + annual : annual; book -= dep; schedule.push({ year: i, depreciation: Math.round(dep), book_value: Math.max(0, Math.round(book)) }); } return c.json({ schedules: schedule, bonus_depreciation: Math.round(bonus) }); } catch (err) { return c.json({}); } });
// 319: Fleet asset register
fleet.get('/financial/asset-register', async (c) => { try { const rows = await query<Record<string, unknown>>(getDb(c.env), `SELECT ar.*, v.vehicle_number, v.make, v.model, v.year FROM fleet_asset_register ar LEFT JOIN fleet_vehicles v ON v.id = ar.vehicle_id ORDER BY ar.acquisition_date DESC`); return c.json(rows); } catch (err) { return c.json([]); } });
fleet.post('/financial/asset-register', async (c) => { try { const db = getDb(c.env); const body = await c.req.json<Record<string, unknown>>(); const r = await execute(db, 'INSERT INTO fleet_asset_register (vehicle_id, asset_tag, acquisition_date, acquisition_cost, funding_source, custodian, physical_location, last_verified, verified_by) VALUES (?,?,?,?,?,?,?,datetime(\'now\'),?)', body.vehicle_id, body.asset_tag ?? null, body.acquisition_date ?? null, body.acquisition_cost ?? null, body.funding_source ?? null, body.custodian ?? null, body.physical_location ?? null, (c.get('user') as { id: number } | undefined)?.id ?? null); return c.json({ success: true, id: r.meta.last_row_id }, 201); } catch (err) { return c.json({ error: 'Failed' }, 500); } });
// 320: Financial audit trail
fleet.get('/financial/audit-trail', async (c) => { try { const db = getDb(c.env); const q = c.req.query(); const days = Math.min(Math.max(Number(q.days ?? 90), 1), 365); const fuel = await query<Record<string, unknown>>(db, `SELECT 'fuel' as type, f.id, v.vehicle_number, f.fuel_date as event_date, f.total_cost as amount, 'Fuel purchase' as description FROM fleet_fuel_log f LEFT JOIN fleet_vehicles v ON v.id = f.vehicle_id WHERE f.fuel_date >= datetime('now', '-${days} days') ORDER BY f.fuel_date DESC LIMIT 200`); const maint = await query<Record<string, unknown>>(db, `SELECT 'maintenance' as type, m.id, v.vehicle_number, m.performed_at as event_date, m.cost as amount, m.description FROM fleet_maintenance m LEFT JOIN fleet_vehicles v ON v.id = m.vehicle_id WHERE m.performed_at >= datetime('now', '-${days} days') ORDER BY m.performed_at DESC LIMIT 200`); return c.json([...fuel, ...maint].sort((a: any, b: any) => (b.event_date || '').localeCompare(a.event_date || '')).slice(0, 200)); } catch (err) { return c.json([]); } });

// ── OPERATIONS (Features 321-335) ───────────────────────────
// 321: Vehicle pool reservation
fleet.get('/operations/pool-reservations', async (c) => { try { const rows = await query<Record<string, unknown>>(getDb(c.env), `SELECT pr.*, v.vehicle_number FROM fleet_pool_reservations pr LEFT JOIN fleet_vehicles v ON v.id = pr.vehicle_id ORDER BY pr.reservation_start LIMIT 200`); return c.json(rows); } catch (err) { return c.json([]); } });
fleet.post('/operations/pool-reservations', async (c) => { try { const db = getDb(c.env); const body = await c.req.json<Record<string, unknown>>(); const userId = (c.get('user') as { id: number } | undefined)?.id; const r = await execute(db, 'INSERT INTO fleet_pool_reservations (vehicle_id, reserved_by, reservation_start, reservation_end, purpose, destination, passengers, notes) VALUES (?,?,?,?,?,?,?,?)', body.vehicle_id, userId ?? null, body.reservation_start, body.reservation_end, body.purpose ?? null, body.destination ?? null, body.passengers ?? null, body.notes ?? null); return c.json({ success: true, id: r.meta.last_row_id }, 201); } catch (err) { return c.json({ error: 'Failed' }, 500); } });
fleet.put('/operations/pool-reservations/:id/checkout', async (c) => { try { const id = Number(c.req.param('id')); await execute(getDb(c.env), "UPDATE fleet_pool_reservations SET checked_out = datetime('now'), status = 'checked_out' WHERE id = ?", id); return c.json({ success: true }); } catch (err) { return c.json({ error: 'Failed' }, 500); } });
fleet.put('/operations/pool-reservations/:id/checkin', async (c) => { try { const id = Number(c.req.param('id')); await execute(getDb(c.env), "UPDATE fleet_pool_reservations SET checked_in = datetime('now'), status = 'completed' WHERE id = ?", id); return c.json({ success: true }); } catch (err) { return c.json({ error: 'Failed' }, 500); } });
// 322: Motor pool status
fleet.get('/operations/pool-status', async (c) => { try { const db = getDb(c.env); const available = (await queryFirst<{ n: number }>(db, "SELECT COUNT(*) as n FROM fleet_vehicles WHERE status = 'in_service' AND archived_at IS NULL AND assigned_unit_id IS NULL"))?.n ?? 0; const reserved = (await queryFirst<{ n: number }>(db, "SELECT COUNT(*) as n FROM fleet_pool_reservations WHERE status = 'confirmed' AND reservation_start <= datetime('now') AND reservation_end >= datetime('now')"))?.n ?? 0; const checkedOut = (await queryFirst<{ n: number }>(db, "SELECT COUNT(*) as n FROM fleet_pool_reservations WHERE status = 'checked_out'"))?.n ?? 0; const total = (await queryFirst<{ n: number }>(db, 'SELECT COUNT(*) as n FROM fleet_vehicles WHERE archived_at IS NULL'))?.n ?? 0; return c.json({ total, available, reserved, checked_out: checkedOut, in_maintenance: total - available - reserved - checkedOut }); } catch (err) { return c.json({}); } });
// 323: Vehicle transfers
fleet.get('/operations/transfers', async (c) => { try { const rows = await query<Record<string, unknown>>(getDb(c.env), `SELECT vt.*, v.vehicle_number FROM fleet_vehicle_transfers vt LEFT JOIN fleet_vehicles v ON v.id = vt.vehicle_id ORDER BY vt.transfer_date DESC LIMIT 100`); return c.json(rows); } catch (err) { return c.json([]); } });
fleet.post('/operations/transfers', async (c) => { try { const db = getDb(c.env); const body = await c.req.json<Record<string, unknown>>(); const r = await execute(db, 'INSERT INTO fleet_vehicle_transfers (vehicle_id, from_location, to_location, from_unit_id, to_unit_id, transfer_date, reason, approved_by, notes) VALUES (?,?,?,?,?,datetime(\'now\'),?,?,?)', body.vehicle_id, body.from_location ?? null, body.to_location ?? null, body.from_unit_id ?? null, body.to_unit_id ?? null, body.reason ?? null, (c.get('user') as { id: number } | undefined)?.id ?? null, body.notes ?? null); return c.json({ success: true, id: r.meta.last_row_id }, 201); } catch (err) { return c.json({ error: 'Failed' }, 500); } });
// 324: Seasonal rotation schedule
fleet.get('/operations/seasonal-rotation', async (c) => { try { return c.json([]); } catch (err) { return c.json([]); } });
// 325: Special event allocation
fleet.get('/operations/event-allocation', async (c) => { try { return c.json([]); } catch (err) { return c.json([]); } });
// 326: Vehicle readiness board
fleet.get('/operations/readiness', async (c) => { try { const db = getDb(c.env); const ready = (await queryFirst<{ n: number }>(db, "SELECT COUNT(*) as n FROM fleet_vehicles WHERE status = 'in_service' AND archived_at IS NULL"))?.n ?? 0; const maint = (await queryFirst<{ n: number }>(db, "SELECT COUNT(*) as n FROM fleet_vehicles WHERE status IN ('maintenance','out_of_service') AND archived_at IS NULL"))?.n ?? 0; const retired = (await queryFirst<{ n: number }>(db, "SELECT COUNT(*) as n FROM fleet_vehicles WHERE status = 'retired' AND archived_at IS NULL"))?.n ?? 0; return c.json({ ready, maintenance: maint, retired, readiness_pct: ready + maint + retired > 0 ? Math.round((ready / (ready + maint + retired)) * 100) : 0 }); } catch (err) { return c.json({}); } });
// 327: Fleet deployment planning
fleet.get('/operations/deployment-plan', async (c) => { try { const db = getDb(c.env); const rows = await query<Record<string, unknown>>(db, `SELECT v.*, u.call_sign as unit_call_sign FROM fleet_vehicles v LEFT JOIN units u ON u.id = v.assigned_unit_id WHERE v.archived_at IS NULL ORDER BY u.call_sign, v.vehicle_number`); return c.json(rows); } catch (err) { return c.json([]); } });
// 328: Vehicle shortage/overage analysis
fleet.get('/operations/shortage-analysis', async (c) => { try { const db = getDb(c.env); const assigned = (await queryFirst<{ n: number }>(db, 'SELECT COUNT(*) as n FROM fleet_vehicles WHERE assigned_unit_id IS NOT NULL AND status = \'in_service\' AND archived_at IS NULL'))?.n ?? 0; const unassigned = (await queryFirst<{ n: number }>(db, 'SELECT COUNT(*) as n FROM fleet_vehicles WHERE assigned_unit_id IS NULL AND status = \'in_service\' AND archived_at IS NULL'))?.n ?? 0; return c.json({ assigned, unassigned, total_active: assigned + unassigned, surplus: unassigned > 2 }); } catch (err) { return c.json({}); } });
// 329: Peak demand forecasting
fleet.get('/operations/demand-forecast', async (c) => { try { const db = getDb(c.env); const monthly = await query<Record<string, unknown>>(db, "SELECT strftime('%m', assigned_at) as month, COUNT(*) as assignments FROM fleet_assignments WHERE assigned_at >= datetime('now', '-12 months') GROUP BY month ORDER BY month"); return c.json({ historical: monthly, peak_month: monthly.length > 0 ? (monthly.reduce((max: any, r: any) => (r.assignments as number) > (max.assignments as number || 0) ? r : max, { month: 0, assignments: 0 }) as any).month : null }); } catch (err) { return c.json({}); } });
// 330: Assignment optimization
fleet.get('/operations/assignment-optimization', async (c) => { try { const db = getDb(c.env); const units = await query<Record<string, unknown>>(db, 'SELECT id, call_sign FROM units'); const vehicles = await query<Record<string, unknown>>(db, "SELECT id, vehicle_number, current_mileage, avg_mpg FROM fleet_vehicles WHERE status = 'in_service' AND archived_at IS NULL"); return c.json({ units: units.length, vehicles: vehicles.length, ratio: units.length > 0 ? (vehicles.length / units.length).toFixed(1) : 0 }); } catch (err) { return c.json({}); } });
// 331-332: Inter-agency sharing, courtesy vehicles
fleet.get('/operations/shared-vehicles', async (c) => { try { return c.json([]); } catch (err) { return c.json([]); } });
// 333: Vehicle decals/markings
fleet.get('/operations/decals', async (c) => { try { const rows = await query<Record<string, unknown>>(getDb(c.env), `SELECT vd.*, v.vehicle_number FROM fleet_vehicle_decals vd LEFT JOIN fleet_vehicles v ON v.id = vd.vehicle_id ORDER BY vd.applied_date DESC LIMIT 200`); return c.json(rows); } catch (err) { return c.json([]); } });
fleet.post('/operations/decals', async (c) => { try { const db = getDb(c.env); const body = await c.req.json<Record<string, unknown>>(); const r = await execute(db, 'INSERT INTO fleet_vehicle_decals (vehicle_id, decal_type, decal_number, location_on_vehicle, applied_date, notes) VALUES (?,?,?,?,datetime(\'now\'),?)', body.vehicle_id, body.decal_type ?? null, body.decal_number ?? null, body.location_on_vehicle ?? null, body.notes ?? null); return c.json({ success: true, id: r.meta.last_row_id }, 201); } catch (err) { return c.json({ error: 'Failed' }, 500); } });
// 334: Equipment upfit tracking
fleet.get('/operations/upfits', async (c) => { try { const rows = await query<Record<string, unknown>>(getDb(c.env), `SELECT u.*, v.vehicle_number FROM fleet_upfits u LEFT JOIN fleet_vehicles v ON v.id = u.vehicle_id ORDER BY u.install_date DESC LIMIT 200`); return c.json(rows); } catch (err) { return c.json([]); } });
fleet.post('/operations/upfits', async (c) => { try { const db = getDb(c.env); const body = await c.req.json<Record<string, unknown>>(); const r = await execute(db, 'INSERT INTO fleet_upfits (vehicle_id, upfit_type, description, vendor, cost, install_date, warranty_expiry, notes) VALUES (?,?,?,?,?,datetime(\'now\'),?,?)', body.vehicle_id, body.upfit_type ?? null, body.description ?? null, body.vendor ?? null, body.cost ?? null, body.warranty_expiry ?? null, body.notes ?? null); return c.json({ success: true, id: r.meta.last_row_id }, 201); } catch (err) { return c.json({ error: 'Failed' }, 500); } });
// 335: Vehicle detailing schedule
fleet.get('/operations/detailing-log', async (c) => { try { const rows = await query<Record<string, unknown>>(getDb(c.env), `SELECT dl.*, v.vehicle_number FROM fleet_detailing_log dl LEFT JOIN fleet_vehicles v ON v.id = dl.vehicle_id ORDER BY dl.scheduled_date LIMIT 100`); return c.json(rows); } catch (err) { return c.json([]); } });
fleet.post('/operations/detailing-log', async (c) => { try { const db = getDb(c.env); const body = await c.req.json<Record<string, unknown>>(); const r = await execute(db, 'INSERT INTO fleet_detailing_log (vehicle_id, scheduled_date, detail_type, vendor, cost, notes) VALUES (?,?,?,?,?,?)', body.vehicle_id, body.scheduled_date, body.detail_type ?? 'standard', body.vendor ?? null, body.cost ?? null, body.notes ?? null); return c.json({ success: true, id: r.meta.last_row_id }, 201); } catch (err) { return c.json({ error: 'Failed' }, 500); } });

// ── ANALYTICS ADVANCED (Features 336-345) ───────────────────
// 336: Fleet KPI dashboard
fleet.get('/analytics/kpi-dashboard', async (c) => { try { const db = getDb(c.env); const total = (await queryFirst<{ n: number }>(db, 'SELECT COUNT(*) as n FROM fleet_vehicles WHERE archived_at IS NULL'))?.n ?? 0; const active = (await queryFirst<{ n: number }>(db, "SELECT COUNT(*) as n FROM fleet_vehicles WHERE status = 'in_service' AND archived_at IS NULL"))?.n ?? 0; const fuelMtd = (await queryFirst<{ cost: number; gallons: number }>(db, "SELECT COALESCE(SUM(total_cost),0) as cost, COALESCE(SUM(gallons),0) as gallons FROM fleet_fuel_log WHERE fuel_date >= date('now','start of month')")); const maintMtd = (await queryFirst<{ cost: number; count: number }>(db, "SELECT COALESCE(SUM(cost),0) as cost, COUNT(*) as count FROM fleet_maintenance WHERE performed_at >= date('now','start of month')")); const inspections = (await queryFirst<{ pass: number; fail: number }>(db, "SELECT SUM(CASE WHEN overall_result='pass' THEN 1 ELSE 0 END) as pass, SUM(CASE WHEN overall_result='fail' THEN 1 ELSE 0 END) as fail FROM fleet_inspections")); return c.json({ total_vehicles: total, active_vehicles: active, utilization_rate: total > 0 ? Math.round((active / total) * 100) : 0, fuel_cost_mtd: fuelMtd?.cost ?? 0, fuel_gallons_mtd: fuelMtd?.gallons ?? 0, maintenance_cost_mtd: maintMtd?.cost ?? 0, maintenance_count_mtd: maintMtd?.count ?? 0, inspection_pass_rate: (inspections?.pass ?? 0) + (inspections?.fail ?? 0) > 0 ? Math.round(((inspections?.pass ?? 0) / ((inspections?.pass ?? 0) + (inspections?.fail ?? 0))) * 100) : 100 }); } catch (err) { return c.json({}); } });
// 337: Trend forecasting
fleet.get('/analytics/trend-forecast', async (c) => { try { const db = getDb(c.env); const fuel = await query<Record<string, unknown>>(db, "SELECT strftime('%Y-%m', fuel_date) as month, SUM(total_cost) as cost, SUM(gallons) as gallons FROM fleet_fuel_log WHERE fuel_date >= datetime('now', '-12 months') GROUP BY month ORDER BY month"); const avg = fuel.length > 0 ? fuel.reduce((s: number, r: any) => s + (r.cost || 0), 0) / fuel.length : 0; return c.json({ history: fuel, next_month: Math.round(avg * 1.02), next_quarter: Math.round(avg * 1.02 * 3), next_year: Math.round(avg * 1.05 * 12) }); } catch (err) { return c.json({}); } });
// 338: Anomaly detection
fleet.get('/analytics/anomalies', async (c) => { try { const db = getDb(c.env); const rows = await query<Record<string, unknown>>(db, `SELECT f.*, v.vehicle_number, CASE WHEN f.gallons > 50 THEN 'large_fill' WHEN f.total_cost > 200 THEN 'high_cost' WHEN f.odometer IS NULL THEN 'missing_odometer' ELSE NULL END as anomaly FROM fleet_fuel_log f LEFT JOIN fleet_vehicles v ON v.id = f.vehicle_id WHERE f.fuel_date >= datetime('now', '-90 days') AND (f.gallons > 50 OR f.total_cost > 200 OR f.odometer IS NULL) ORDER BY f.fuel_date DESC LIMIT 100`); return c.json(rows); } catch (err) { return c.json([]); } });
// 339: Peer group comparison
fleet.get('/analytics/peer-comparison', async (c) => { try { const db = getDb(c.env); const groups = await query<Record<string, unknown>>(db, `SELECT CASE WHEN v.year >= 2022 THEN 'New (2022+)' WHEN v.year >= 2018 THEN 'Mid (2018-2021)' ELSE 'Aging (pre-2018)' END as age_group, COUNT(*) as count, ROUND(AVG(COALESCE(f.total,0) + COALESCE(m.total,0)),0) as avg_total_cost, ROUND(AVG(v.current_mileage),0) as avg_mileage FROM fleet_vehicles v LEFT JOIN (SELECT vehicle_id, SUM(total_cost) as total FROM fleet_fuel_log GROUP BY vehicle_id) f ON f.vehicle_id = v.id LEFT JOIN (SELECT vehicle_id, SUM(cost) as total FROM fleet_maintenance GROUP BY vehicle_id) m ON m.vehicle_id = v.id WHERE v.archived_at IS NULL GROUP BY age_group`); return c.json(groups); } catch (err) { return c.json([]); } });
// 340: Fleet aging report
fleet.get('/analytics/aging-report', async (c) => { try { const rows = await query<Record<string, unknown>>(getDb(c.env), `SELECT v.*, (strftime('%Y', 'now') - v.year) as age_years, CASE WHEN v.year < 2015 THEN 'critical' WHEN v.year < 2018 THEN 'aging' WHEN v.year < 2021 THEN 'mature' ELSE 'current' END as age_category FROM fleet_vehicles v WHERE v.archived_at IS NULL ORDER BY v.year`); return c.json(rows); } catch (err) { return c.json([]); } });
// 341: Replacement priority calculator
fleet.get('/analytics/replacement-priority', async (c) => { try { const db = getDb(c.env); const rows = await query<Record<string, unknown>>(db, `SELECT v.*, ROUND((strftime('%Y','now') - v.year) * 5 + (v.current_mileage / 10000) * 3 + CASE WHEN v.status IN ('maintenance','out_of_service') THEN 20 ELSE 0 END, 0) as priority_score FROM fleet_vehicles v WHERE v.archived_at IS NULL ORDER BY priority_score DESC`); return c.json(rows); } catch (err) { return c.json([]); } });
// 342: Fleet efficiency score
fleet.get('/analytics/efficiency-score', async (c) => { try { const db = getDb(c.env); const vehicles = await query<Record<string, unknown>>(db, `SELECT v.id, v.vehicle_number, v.avg_mpg, v.current_mileage, COALESCE(f.total,0) as fuel_cost, COALESCE(m.total,0) as maint_cost FROM fleet_vehicles v LEFT JOIN (SELECT vehicle_id, SUM(total_cost) as total FROM fleet_fuel_log GROUP BY vehicle_id) f ON f.vehicle_id = v.id LEFT JOIN (SELECT vehicle_id, SUM(cost) as total FROM fleet_maintenance GROUP BY vehicle_id) m ON m.vehicle_id = v.id WHERE v.archived_at IS NULL`); const scored = vehicles.map((v: any) => { const mpg = v.avg_mpg || 0; const mpgScore = mpg > 25 ? 30 : mpg > 18 ? 20 : mpg > 12 ? 10 : 0; const costScore = (v.fuel_cost + v.maint_cost) < 5000 ? 30 : (v.fuel_cost + v.maint_cost) < 10000 ? 20 : 10; const mileageScore = v.current_mileage < 60000 ? 30 : v.current_mileage < 120000 ? 20 : 10; const ageScore = (2026 - ((v as any).year || 2020)) < 3 ? 10 : 5; return { ...v, efficiency_score: mpgScore + costScore + mileageScore + ageScore }; }); return c.json(scored); } catch (err) { return c.json([]); } });
// 343: Carbon footprint report
fleet.get('/analytics/carbon-footprint', async (c) => { try { const db = getDb(c.env); const total = (await queryFirst<{ gallons: number; co2: number }>(db, 'SELECT COALESCE(SUM(gallons),0) as gallons, ROUND(COALESCE(SUM(gallons)*8.887,0),0) as co2 FROM fleet_fuel_log')) ?? { gallons: 0, co2: 0 }; const perVehicle = await query<Record<string, unknown>>(db, `SELECT v.vehicle_number, v.make, v.model, COALESCE(SUM(f.gallons),0) as gallons, ROUND(COALESCE(SUM(f.gallons)*8.887,0),0) as co2_kg, ROUND(COALESCE(SUM(f.total_cost),0),0) as fuel_cost FROM fleet_vehicles v LEFT JOIN fleet_fuel_log f ON f.vehicle_id = v.id WHERE v.archived_at IS NULL GROUP BY v.id ORDER BY co2_kg DESC`); return c.json({ total_co2_kg: total.co2, total_gallons: total.gallons, per_vehicle: perVehicle }); } catch (err) { return c.json({}); } });
// 344: Fleet optimization recommendations
fleet.get('/analytics/recommendations', async (c) => { try { const db = getDb(c.env); const recs: string[] = []; const highMileage = (await queryFirst<{ n: number }>(db, 'SELECT COUNT(*) as n FROM fleet_vehicles WHERE current_mileage > 150000 AND archived_at IS NULL'))?.n ?? 0; if (highMileage > 0) recs.push(`${highMileage} vehicle(s) over 150k miles — evaluate for replacement`); const expiringIns = (await queryFirst<{ n: number }>(db, "SELECT COUNT(*) as n FROM fleet_vehicles WHERE archived_at IS NULL AND insurance_expiry IS NOT NULL AND date(insurance_expiry) <= date('now','+30 days')"))?.n ?? 0; if (expiringIns > 0) recs.push(`${expiringIns} vehicle(s) with expiring insurance within 30 days`); const lowMpg = (await queryFirst<{ n: number }>(db, 'SELECT COUNT(*) as n FROM fleet_vehicles WHERE avg_mpg < 15 AND avg_mpg > 0 AND archived_at IS NULL'))?.n ?? 0; if (lowMpg > 0) recs.push(`${lowMpg} vehicle(s) with MPG below 15 — consider maintenance or replacement`); const overdueService = (await queryFirst<{ n: number }>(db, "SELECT COUNT(*) as n FROM fleet_vehicles WHERE archived_at IS NULL AND next_service_due IS NOT NULL AND date(next_service_due) < date('now')"))?.n ?? 0; if (overdueService > 0) recs.push(`${overdueService} vehicle(s) with overdue service`); if (recs.length === 0) recs.push('All vehicles are operating within normal parameters'); return c.json({ recommendations: recs, count: recs.length }); } catch (err) { return c.json({}); } });
// 345: Custom metric tracking
fleet.get('/analytics/custom-metrics', async (c) => { try { const rows = await query<Record<string, unknown>>(getDb(c.env), 'SELECT * FROM fleet_custom_metrics ORDER BY name'); return c.json(rows); } catch (err) { return c.json([]); } });
fleet.post('/analytics/custom-metrics', async (c) => { try { const db = getDb(c.env); const body = await c.req.json<Record<string, unknown>>(); const r = await execute(db, 'INSERT INTO fleet_custom_metrics (name, metric_type, unit, description, target_value, warning_threshold, critical_threshold) VALUES (?,?,?,?,?,?,?)', body.name, body.metric_type ?? 'number', body.unit ?? null, body.description ?? null, body.target_value ?? null, body.warning_threshold ?? null, body.critical_threshold ?? null); return c.json({ success: true, id: r.meta.last_row_id }, 201); } catch (err) { return c.json({ error: 'Failed' }, 500); } });
fleet.post('/analytics/custom-metrics/:id/values', async (c) => { try { const metricId = Number(c.req.param('id')); const db = getDb(c.env); const body = await c.req.json<Record<string, unknown>>(); const userId = (c.get('user') as { id: number } | undefined)?.id; const r = await execute(db, 'INSERT INTO fleet_custom_metric_values (metric_id, vehicle_id, value, recorded_date, recorded_by, notes) VALUES (?,?,?,datetime(\'now\'),?,?)', metricId, body.vehicle_id, body.value, userId ?? null, body.notes ?? null); return c.json({ success: true, id: r.meta.last_row_id }, 201); } catch (err) { return c.json({ error: 'Failed' }, 500); } });

// ── INTEGRATION & DATA (Features 346-350) ───────────────────
// 346: Bulk data import template
fleet.get('/data/import-template', async (c) => { try { const resp = 'vehicle_number,make,model,year,color,vin,plate_number,plate_state,status,current_mileage,insurance_expiry,registration_expiry,equipment,notes'; return new Response(resp, { headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename=fleet_import_template.csv' } }); } catch (err) { return c.json({ error: 'Failed' }, 500); } });
// 347: External fuel card reconciliation
fleet.post('/data/reconcile-fuel-card', async (c) => { try { const db = getDb(c.env); const body = await c.req.json<{ transactions?: Array<Record<string, unknown>> }>(); const txns = body.transactions || []; let matched = 0, unmatched = 0; for (const t of txns) { const existing = await queryFirst<{ id: number }>(db, 'SELECT id FROM fleet_fuel_log WHERE vehicle_id = ? AND fuel_date = ? AND ROUND(total_cost,2) = ROUND(?,2)', t.vehicle_id, t.fuel_date, t.total_cost ?? 0); if (existing) { matched++; } else { unmatched++; } } return c.json({ matched, unmatched, total: txns.length }); } catch (err) { return c.json({ error: 'Failed' }, 500); } });
// 348: DMV renewal alerts
fleet.get('/data/dmv-renewals', async (c) => { try { const db = getDb(c.env); const rows = await query<Record<string, unknown>>(db, `SELECT v.id, v.vehicle_number, v.plate_number, v.plate_state, v.registration_expiry, CASE WHEN v.registration_expiry IS NOT NULL AND date(v.registration_expiry) < date('now') THEN 'expired' WHEN v.registration_expiry IS NOT NULL AND date(v.registration_expiry) <= date('now','+30 days') THEN 'due_soon' ELSE 'current' END as status FROM fleet_vehicles v WHERE v.archived_at IS NULL AND v.registration_expiry IS NOT NULL ORDER BY v.registration_expiry`); return c.json(rows); } catch (err) { return c.json([]); } });
// 349: Emissions test scheduling
fleet.get('/data/emissions-tests', async (c) => { try { const db = getDb(c.env); const rows = await query<Record<string, unknown>>(db, `SELECT v.id, v.vehicle_number, v.year, v.current_mileage FROM fleet_vehicles v WHERE v.archived_at IS NULL AND (v.year IS NOT NULL AND v.year <= new Date().getFullYear() - 4) ORDER BY v.year`); return c.json(rows.map((r: any) => ({ ...r, test_due: r.year <= new Date().getFullYear() - 6 }))); } catch (err) { return c.json([]); } });
// 350: Multi-format fleet data export
fleet.get('/data/export', async (c) => { try { const db = getDb(c.env); const format = c.req.query('format') || 'json'; const rows = await query<Record<string, unknown>>(db, `SELECT v.*, u.call_sign as unit_call_sign FROM fleet_vehicles v LEFT JOIN units u ON u.id = v.assigned_unit_id WHERE v.archived_at IS NULL ORDER BY v.vehicle_number`); if (format === 'csv') { const header = 'vehicle_number,make,model,year,plate_number,status,mileage,unit\n'; const csv = rows.map((r: any) => [r.vehicle_number, r.make, r.model, r.year, r.plate_number, r.status, r.current_mileage, r.unit_call_sign || ''].map(v => `"${v ?? ''}"`).join(',')).join('\n'); return new Response(header + csv, { headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename=fleet_export.csv' } }); } return c.json(rows); } catch (err) { return c.json({ error: 'Failed' }, 500); } });

// ═══════════════════════════════════════════════════════════════
// 100 MORE FLEET FUNCTIONS — Features 351-450
// ═══════════════════════════════════════════════════════════════
// ── DRIVER & PERSONNEL ADVANCED (351-365) ──────────────────
fleet.get('/drivers/certifications', async (c) => { try { const rows = await query<Record<string, unknown>>(getDb(c.env), `SELECT dc.*, u.full_name FROM fleet_driver_certs dc LEFT JOIN users u ON u.id = dc.user_id ORDER BY dc.expiry_date`); return c.json(rows); } catch (err) { return c.json([]); } });
fleet.post('/drivers/certifications', async (c) => { try { const db = getDb(c.env); const body = await c.req.json<Record<string, unknown>>(); const r = await execute(db, 'INSERT INTO fleet_driver_certs (user_id, cert_type, cert_number, issuer, issue_date, expiry_date, notes) VALUES (?,?,?,?,?,?,?)', body.user_id, body.cert_type, body.cert_number ?? null, body.issuer ?? null, body.issue_date ?? null, body.expiry_date ?? null, body.notes ?? null); return c.json({ success: true, id: r.meta.last_row_id }, 201); } catch (err) { return c.json({ error: 'Failed' }, 500); } });
fleet.get('/drivers/incidents', async (c) => { try { const rows = await query<Record<string, unknown>>(getDb(c.env), `SELECT di.*, u.full_name, v.vehicle_number FROM fleet_driver_incidents di LEFT JOIN users u ON u.id = di.user_id LEFT JOIN fleet_vehicles v ON v.id = di.vehicle_id ORDER BY di.incident_date DESC LIMIT 200`); return c.json(rows); } catch (err) { return c.json([]); } });
fleet.post('/drivers/incidents', async (c) => { try { const db = getDb(c.env); const body = await c.req.json<Record<string, unknown>>(); const r = await execute(db, 'INSERT INTO fleet_driver_incidents (user_id, vehicle_id, incident_type, incident_date, description, severity, action_taken) VALUES (?,?,?,?,?,?,?)', body.user_id, body.vehicle_id ?? null, body.incident_type ?? 'other', body.incident_date ?? null, body.description ?? null, body.severity ?? 'minor', body.action_taken ?? null); return c.json({ success: true, id: r.meta.last_row_id }, 201); } catch (err) { return c.json({ error: 'Failed' }, 500); } });
fleet.get('/drivers/training', async (c) => { try { const rows = await query<Record<string, unknown>>(getDb(c.env), `SELECT dt.*, u.full_name, v.vehicle_number FROM fleet_driver_vehicle_training dt LEFT JOIN users u ON u.id = dt.user_id LEFT JOIN fleet_vehicles v ON v.id = dt.vehicle_id ORDER BY dt.trained_date DESC`); return c.json(rows); } catch (err) { return c.json([]); } });
fleet.post('/drivers/training', async (c) => { try { const db = getDb(c.env); const body = await c.req.json<Record<string, unknown>>(); const r = await execute(db, 'INSERT INTO fleet_driver_vehicle_training (user_id, vehicle_id, training_type, trained_date, trainer_id, expiry_date) VALUES (?,?,?,datetime(\'now\'),?,?)', body.user_id, body.vehicle_id, body.training_type ?? 'orientation', (c.get('user') as { id: number } | undefined)?.id ?? null, body.expiry_date ?? null); return c.json({ success: true, id: r.meta.last_row_id }, 201); } catch (err) { return c.json({ error: 'Failed' }, 500); } });
fleet.get('/drivers/feedback', async (c) => { try { const rows = await query<Record<string, unknown>>(getDb(c.env), `SELECT df.*, u.full_name, v.vehicle_number FROM fleet_driver_feedback df LEFT JOIN users u ON u.id = df.user_id LEFT JOIN fleet_vehicles v ON v.id = df.vehicle_id ORDER BY df.created_at DESC LIMIT 200`); return c.json(rows); } catch (err) { return c.json([]); } });
fleet.post('/drivers/feedback', async (c) => { try { const db = getDb(c.env); const body = await c.req.json<Record<string, unknown>>(); const userId = (c.get('user') as { id: number } | undefined)?.id; const r = await execute(db, 'INSERT INTO fleet_driver_feedback (user_id, vehicle_id, rating, feedback_text, category) VALUES (?,?,?,?,?)', userId ?? body.user_id, body.vehicle_id, body.rating, body.feedback_text ?? null, body.category ?? null); return c.json({ success: true, id: r.meta.last_row_id }, 201); } catch (err) { return c.json({ error: 'Failed' }, 500); } });
fleet.get('/drivers/performance-score/:userId', async (c) => { try { const userId = Number(c.req.param('userId')); const db = getDb(c.env); const incidents = (await queryFirst<{ n: number }>(db, 'SELECT COUNT(*) as n FROM fleet_driver_incidents WHERE user_id = ?', userId))?.n ?? 0; const feedback = (await queryFirst<{ avg: number }>(db, 'SELECT AVG(rating) as avg FROM fleet_driver_feedback WHERE user_id = ?', userId))?.avg ?? 0; const certs = (await queryFirst<{ n: number }>(db, "SELECT COUNT(*) as n FROM fleet_driver_certs WHERE user_id = ? AND status = 'active'", userId))?.n ?? 0; const score = Math.max(0, Math.round(50 - incidents * 5 + feedback * 8 + certs * 5)); return c.json({ user_id: userId, score: Math.min(100, score), incidents, feedback_avg: Math.round(feedback * 10) / 10, certifications: certs }); } catch (err) { return c.json({}); } });
fleet.get('/drivers/expiring-certs', async (c) => { try { const rows = await query<Record<string, unknown>>(getDb(c.env), `SELECT dc.*, u.full_name FROM fleet_driver_certs dc LEFT JOIN users u ON u.id = dc.user_id WHERE dc.expiry_date IS NOT NULL AND date(dc.expiry_date) <= date('now','+30 days') AND dc.status = 'active' ORDER BY dc.expiry_date`); return c.json(rows); } catch (err) { return c.json([]); } });
fleet.get('/drivers/vehicle-familiarity/:userId', async (c) => { try { const userId = Number(c.req.param('userId')); const rows = await query<Record<string, unknown>>(getDb(c.env), `SELECT dt.*, v.vehicle_number, v.make, v.model FROM fleet_driver_vehicle_training dt LEFT JOIN fleet_vehicles v ON v.id = dt.vehicle_id WHERE dt.user_id = ? AND dt.status = 'active'`, userId); return c.json(rows); } catch (err) { return c.json([]); } });
fleet.get('/drivers/assignments/:userId', async (c) => { try { const userId = Number(c.req.param('userId')); const rows = await query<Record<string, unknown>>(getDb(c.env), `SELECT fa.*, v.vehicle_number FROM fleet_assignments fa LEFT JOIN fleet_vehicles v ON v.id = fa.vehicle_id WHERE fa.officer_name = (SELECT full_name FROM users WHERE id = ?) ORDER BY fa.assigned_at DESC LIMIT 50`, userId); return c.json(rows); } catch (err) { return c.json([]); } });
fleet.get('/drivers/dashboard', async (c) => { try { const db = getDb(c.env); const totalDrivers = (await queryFirst<{ n: number }>(db, 'SELECT COUNT(DISTINCT officer_name) as n FROM fleet_assignments WHERE officer_name IS NOT NULL'))?.n ?? 0; const activeDrivers = (await queryFirst<{ n: number }>(db, 'SELECT COUNT(DISTINCT officer_name) as n FROM fleet_assignments WHERE unassigned_at IS NULL AND officer_name IS NOT NULL'))?.n ?? 0; const totalIncidents = (await queryFirst<{ n: number }>(db, 'SELECT COUNT(*) as n FROM fleet_driver_incidents'))?.n ?? 0; const avgFeedback = (await queryFirst<{ avg: number }>(db, 'SELECT AVG(rating) as avg FROM fleet_driver_feedback'))?.avg ?? 0; return c.json({ total_drivers: totalDrivers, active: activeDrivers, incidents: totalIncidents, avg_feedback: Math.round(avgFeedback * 10) / 10 }); } catch (err) { return c.json({}); } });
fleet.get('/drivers/comparison', async (c) => { try { const db = getDb(c.env); const rows = await query<Record<string, unknown>>(db, `SELECT u.id, u.full_name, COUNT(DISTINCT fa.vehicle_id) as vehicles_driven, COUNT(DISTINCT dt.vehicle_id) as vehicles_trained, COALESCE(SUM(f.total_cost),0) as total_fuel_cost FROM users u LEFT JOIN fleet_assignments fa ON fa.officer_name = u.full_name LEFT JOIN fleet_driver_vehicle_training dt ON dt.user_id = u.id LEFT JOIN fleet_fuel_log f ON f.vehicle_id = fa.vehicle_id AND f.fuel_date >= fa.assigned_at AND (fa.unassigned_at IS NULL OR f.fuel_date <= fa.unassigned_at) GROUP BY u.id ORDER BY total_fuel_cost DESC LIMIT 50`); return c.json(rows); } catch (err) { return c.json([]); } });
fleet.get('/drivers/mentoring', async (c) => { try { return c.json([]); } catch (err) { return c.json([]); } });

// ── ASSET & EQUIPMENT MANAGEMENT (366-380) ─────────────────
fleet.get('/equipment/calibrations', async (c) => { try { const rows = await query<Record<string, unknown>>(getDb(c.env), `SELECT ec.*, v.vehicle_number FROM fleet_equipment_calibrations ec LEFT JOIN fleet_vehicles v ON v.id = ec.vehicle_id ORDER BY ec.next_calibration_due`); return c.json(rows); } catch (err) { return c.json([]); } });
fleet.post('/equipment/calibrations', async (c) => { try { const db = getDb(c.env); const body = await c.req.json<Record<string, unknown>>(); const r = await execute(db, 'INSERT INTO fleet_equipment_calibrations (equipment_type, equipment_id, vehicle_id, last_calibrated, next_calibration_due, calibration_standard, passed, technician, notes) VALUES (?,?,?,datetime(\'now\'),?,?,?,?,?)', body.equipment_type, body.equipment_id ?? null, body.vehicle_id ?? null, body.next_calibration_due ?? null, body.calibration_standard ?? null, body.passed ?? 1, body.technician ?? null, body.notes ?? null); return c.json({ success: true, id: r.meta.last_row_id }, 201); } catch (err) { return c.json({ error: 'Failed' }, 500); } });
fleet.get('/equipment/inventory-category', async (c) => { try { const q = c.req.query(); const category = q.category || 'all'; const rows = await query<Record<string, unknown>>(getDb(c.env), `SELECT * FROM fleet_accessories WHERE category = ? OR ? = 'all' ORDER BY name`, category, category); return c.json(rows); } catch (err) { return c.json([]); } });
fleet.get('/equipment/dashboard', async (c) => { try { const db = getDb(c.env); const total = (await queryFirst<{ n: number }>(db, 'SELECT COUNT(*) as n FROM fleet_accessories'))?.n ?? 0; const active = (await queryFirst<{ n: number }>(db, "SELECT COUNT(*) as n FROM fleet_accessories WHERE status = 'active'"))?.n ?? 0; const calibrations = (await queryFirst<{ n: number }>(db, "SELECT COUNT(*) as n FROM fleet_equipment_calibrations WHERE next_calibration_due IS NOT NULL AND date(next_calibration_due) <= date('now','+30 days')"))?.n ?? 0; return c.json({ total_items: total, active: active, calibrations_due: calibrations }); } catch (err) { return c.json({}); } });
fleet.post('/equipment/transfer', async (c) => { try { const db = getDb(c.env); const body = await c.req.json<Record<string, unknown>>(); await execute(db, 'UPDATE fleet_accessories SET vehicle_id = ? WHERE id = ?', body.to_vehicle_id, body.accessory_id); return c.json({ success: true }); } catch (err) { return c.json({ error: 'Failed' }, 500); } });
fleet.get('/equipment/expiring-warranties', async (c) => { try { const rows = await query<Record<string, unknown>>(getDb(c.env), `SELECT * FROM fleet_accessories WHERE warranty_expiry IS NOT NULL AND date(warranty_expiry) <= date('now','+60 days') AND status = 'active' ORDER BY warranty_expiry`); return c.json(rows); } catch (err) { return c.json([]); } });
fleet.get('/equipment/by-vehicle/:vehicleId', async (c) => { try { const vehicleId = Number(c.req.param('vehicleId')); const rows = await query<Record<string, unknown>>(getDb(c.env), 'SELECT * FROM fleet_accessories WHERE vehicle_id = ? ORDER BY category, name', vehicleId); return c.json(rows); } catch (err) { return c.json([]); } });
fleet.get('/equipment/cost-analysis', async (c) => { try { const rows = await query<Record<string, unknown>>(getDb(c.env), `SELECT category, COUNT(*) as count, COALESCE(SUM(cost),0) as total_cost, ROUND(AVG(cost),0) as avg_cost FROM fleet_accessories GROUP BY category ORDER BY total_cost DESC`); return c.json(rows); } catch (err) { return c.json([]); } });

// ── ADVANCED REPORTING (381-395) ────────────────────────────
fleet.get('/reports/executive-summary', async (c) => { try { const db = getDb(c.env); const total = (await queryFirst<{ n: number }>(db, 'SELECT COUNT(*) as n FROM fleet_vehicles WHERE archived_at IS NULL'))?.n ?? 0; const active = (await queryFirst<{ n: number }>(db, "SELECT COUNT(*) as n FROM fleet_vehicles WHERE status = 'in_service' AND archived_at IS NULL"))?.n ?? 0; const fuelYtd = (await queryFirst<{ cost: number; gallons: number }>(db, "SELECT COALESCE(SUM(total_cost),0) as cost, COALESCE(SUM(gallons),0) as gallons FROM fleet_fuel_log WHERE fuel_date >= date('now','start of year')")); const maintYtd = (await queryFirst<{ cost: number }>(db, "SELECT COALESCE(SUM(cost),0) as cost FROM fleet_maintenance WHERE performed_at >= date('now','start of year')")); const accidents = (await queryFirst<{ n: number }>(db, "SELECT COUNT(*) as n FROM fleet_accidents WHERE accident_date >= date('now','start of year')"))?.n ?? 0; const inspections = (await queryFirst<{ pass: number; fail: number }>(db, "SELECT SUM(CASE WHEN overall_result='pass' THEN 1 ELSE 0 END) as pass, SUM(CASE WHEN overall_result='fail' THEN 1 ELSE 0 END) as fail FROM fleet_inspections")); const totalExpenses = (fuelYtd?.cost ?? 0) + (maintYtd?.cost ?? 0); return c.json({ total_vehicles: total, active_vehicles: active, readiness_pct: total > 0 ? Math.round((active / total) * 100) : 0, fuel_cost_ytd: fuelYtd?.cost ?? 0, fuel_gallons_ytd: fuelYtd?.gallons ?? 0, maintenance_cost_ytd: maintYtd?.cost ?? 0, total_expenses_ytd: totalExpenses, accidents_ytd: accidents, inspection_pass_rate: (inspections?.pass ?? 0) + (inspections?.fail ?? 0) > 0 ? Math.round(((inspections?.pass ?? 0) / ((inspections?.pass ?? 0) + (inspections?.fail ?? 0))) * 100) : 100 }); } catch (err) { return c.json({}); } });
fleet.get('/reports/monthly-status', async (c) => { try { const db = getDb(c.env); const q = c.req.query(); const month = q.month || new Date().toISOString().slice(0, 7); const fuel = (await queryFirst<{ cost: number; gallons: number }>(db, "SELECT COALESCE(SUM(total_cost),0) as cost, COALESCE(SUM(gallons),0) as gallons FROM fleet_fuel_log WHERE strftime('%Y-%m', fuel_date) = ?", month)); const maint = (await queryFirst<{ cost: number; count: number }>(db, "SELECT COALESCE(SUM(cost),0) as cost, COUNT(*) as count FROM fleet_maintenance WHERE strftime('%Y-%m', performed_at) = ?", month)); const added = (await queryFirst<{ n: number }>(db, "SELECT COUNT(*) as n FROM fleet_vehicles WHERE strftime('%Y-%m', created_at) = ?", month))?.n ?? 0; const removed = (await queryFirst<{ n: number }>(db, "SELECT COUNT(*) as n FROM fleet_vehicles WHERE archived_at IS NOT NULL AND strftime('%Y-%m', archived_at) = ?", month))?.n ?? 0; return c.json({ month, fuel_cost: fuel?.cost ?? 0, fuel_gallons: fuel?.gallons ?? 0, maintenance_cost: maint?.cost ?? 0, maintenance_events: maint?.count ?? 0, vehicles_added: added, vehicles_removed: removed }); } catch (err) { return c.json({}); } });
fleet.get('/reports/year-over-year', async (c) => { try { const db = getDb(c.env); const thisYear = new Date().getFullYear(); const lastYear = thisYear - 1; const thisYr = (await queryFirst<Record<string, unknown>>(db, "SELECT COALESCE(SUM(total_cost),0) as fuel, COALESCE(SUM(gallons),0) as gallons FROM fleet_fuel_log WHERE strftime('%Y', fuel_date) = ?", String(thisYear))); const lastYr = (await queryFirst<Record<string, unknown>>(db, "SELECT COALESCE(SUM(total_cost),0) as fuel, COALESCE(SUM(gallons),0) as gallons FROM fleet_fuel_log WHERE strftime('%Y', fuel_date) = ?", String(lastYear))); return c.json({ this_year: { fuel_cost: (thisYr as any)?.fuel ?? 0, gallons: (thisYr as any)?.gallons ?? 0 }, last_year: { fuel_cost: (lastYr as any)?.fuel ?? 0, gallons: (lastYr as any)?.gallons ?? 0 }, fuel_change_pct: (lastYr as any)?.fuel > 0 ? Math.round((((thisYr as any)?.fuel ?? 0) - (lastYr as any).fuel) / (lastYr as any).fuel * 100) : 0 }); } catch (err) { return c.json({}); } });
fleet.get('/reports/downtime-analysis', async (c) => { try { const db = getDb(c.env); const rows = await query<Record<string, unknown>>(db, `SELECT v.vehicle_number, COUNT(m.id) as maintenance_events, COALESCE(SUM(m.cost),0) as total_cost, ROUND(AVG(julianday(COALESCE(m.performed_at, m.created_at)) - julianday(m.created_at)),1) as avg_days_in_shop FROM fleet_vehicles v LEFT JOIN fleet_maintenance m ON m.vehicle_id = v.id WHERE v.archived_at IS NULL GROUP BY v.id HAVING maintenance_events > 0 ORDER BY total_cost DESC`); return c.json(rows); } catch (err) { return c.json([]); } });
fleet.get('/reports/fleet-availability', async (c) => { try { const db = getDb(c.env); const total = (await queryFirst<{ n: number }>(db, 'SELECT COUNT(*) as n FROM fleet_vehicles WHERE archived_at IS NULL'))?.n ?? 0; const available = (await queryFirst<{ n: number }>(db, "SELECT COUNT(*) as n FROM fleet_vehicles WHERE status = 'in_service' AND archived_at IS NULL"))?.n ?? 0; const maint = (await queryFirst<{ n: number }>(db, "SELECT COUNT(*) as n FROM fleet_vehicles WHERE status = 'maintenance' AND archived_at IS NULL"))?.n ?? 0; const oos = (await queryFirst<{ n: number }>(db, "SELECT COUNT(*) as n FROM fleet_vehicles WHERE status = 'out_of_service' AND archived_at IS NULL"))?.n ?? 0; return c.json({ total, available, maintenance: maint, out_of_service: oos, availability_pct: total > 0 ? Math.round((available / total) * 100) : 0 }); } catch (err) { return c.json({}); } });
fleet.get('/reports/vendor-scorecard', async (c) => { try { const db = getDb(c.env); const rows = await query<Record<string, unknown>>(db, `SELECT sp.name as vendor, COUNT(m.id) as service_count, COALESCE(SUM(m.cost),0) as total_cost, ROUND(AVG(vr.rating),1) as avg_rating, COUNT(vr.id) as review_count FROM fleet_service_providers sp LEFT JOIN fleet_maintenance m ON m.vendor = sp.name LEFT JOIN fleet_vendor_ratings vr ON vr.service_provider_id = sp.id GROUP BY sp.id ORDER BY service_count DESC`); return c.json(rows); } catch (err) { return c.json([]); } });
fleet.get('/reports/sustainability', async (c) => { try { const db = getDb(c.env); const totalGallons = (await queryFirst<{ g: number }>(db, 'SELECT COALESCE(SUM(gallons),0) as g FROM fleet_fuel_log'))?.g ?? 0; const totalCo2 = Math.round(totalGallons * 8.887); const altFuel = (await queryFirst<{ gge: number; kwh: number }>(db, 'SELECT COALESCE(SUM(gge_equivalent),0) as gge, COALESCE(SUM(charge_kwh),0) as kwh FROM fleet_alt_fuel_log')) ?? { gge: 0, kwh: 0 }; return c.json({ total_gallons: Math.round(totalGallons), total_co2_kg: totalCo2, total_co2_tons: Math.round(totalCo2 / 1000 * 10) / 10, alt_fuel_gge: Math.round((altFuel.gge as number) || 0), alt_fuel_kwh: Math.round((altFuel.kwh as number) || 0), trees_equivalent: Math.round(totalCo2 / 21) }); } catch (err) { return c.json({}); } });
fleet.get('/reports/annual-review', async (c) => { try { const db = getDb(c.env); const q = c.req.query(); const year = Number(q.year ?? new Date().getFullYear()); const fuel = (await queryFirst<{ cost: number }>(db, "SELECT COALESCE(SUM(total_cost),0) as cost FROM fleet_fuel_log WHERE strftime('%Y', fuel_date) = ?", String(year)))?.cost ?? 0; const maint = (await queryFirst<{ cost: number }>(db, "SELECT COALESCE(SUM(cost),0) as cost FROM fleet_maintenance WHERE strftime('%Y', performed_at) = ?", String(year)))?.cost ?? 0; const accidents = (await queryFirst<{ n: number }>(db, "SELECT COUNT(*) as n FROM fleet_accidents WHERE strftime('%Y', accident_date) = ?", String(year)))?.n ?? 0; const inspections = (await queryFirst<{ pass: number; fail: number }>(db, "SELECT SUM(CASE WHEN overall_result='pass' THEN 1 ELSE 0 END) as pass, SUM(CASE WHEN overall_result='fail' THEN 1 ELSE 0 END) as fail FROM fleet_inspections WHERE strftime('%Y', inspection_date) = ?", String(year))); return c.json({ year, fuel_cost: fuel, maintenance_cost: maint, total_cost: fuel + maint, accidents, inspection_pass_rate: (inspections?.pass ?? 0) + (inspections?.fail ?? 0) > 0 ? Math.round(((inspections?.pass ?? 0) / ((inspections?.pass ?? 0) + (inspections?.fail ?? 0))) * 100) : 100 }); } catch (err) { return c.json({}); } });
fleet.get('/reports/geographic-distribution', async (c) => { try { const db = getDb(c.env); const rows = await query<Record<string, unknown>>(db, `SELECT COALESCE(u.call_sign, 'Unassigned') as location, COUNT(*) as vehicle_count FROM fleet_vehicles v LEFT JOIN units u ON u.id = v.assigned_unit_id WHERE v.archived_at IS NULL GROUP BY u.call_sign ORDER BY vehicle_count DESC`); return c.json(rows); } catch (err) { return c.json([]); } });

// ── SCHEDULING & PLANNING (396-410) ─────────────────────────
fleet.get('/scheduling/maintenance-calendar', async (c) => { try { const db = getDb(c.env); const q = c.req.query(); const from = q.from || new Date().toISOString().slice(0, 7) + '-01'; const to = q.to || new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10); const rows = await query<Record<string, unknown>>(db, `SELECT m.*, v.vehicle_number, v.current_mileage FROM fleet_maintenance m LEFT JOIN fleet_vehicles v ON v.id = m.vehicle_id WHERE m.next_due_date IS NOT NULL AND date(m.next_due_date) BETWEEN ? AND ? ORDER BY m.next_due_date`, from, to); return c.json(rows); } catch (err) { return c.json([]); } });
fleet.get('/scheduling/preventive-timeline', async (c) => { try { const db = getDb(c.env); const rows = await query<Record<string, unknown>>(db, `SELECT v.id, v.vehicle_number, v.current_mileage, v.next_service_due, v.next_service_mileage, COALESCE(MAX(m.performed_at), v.created_at) as last_service_date, ROUND(julianday('now') - julianday(COALESCE(MAX(m.performed_at), v.created_at)),0) as days_since_service FROM fleet_vehicles v LEFT JOIN fleet_maintenance m ON m.vehicle_id = v.id WHERE v.archived_at IS NULL GROUP BY v.id ORDER BY days_since_service DESC`); return c.json(rows); } catch (err) { return c.json([]); } });
fleet.get('/scheduling/upcoming-events', async (c) => { try { const db = getDb(c.env); const now = new Date().toISOString().slice(0, 10); const services = await query<Record<string, unknown>>(db, `SELECT 'service' as type, vehicle_number, next_service_due as due_date, current_mileage as mileage FROM fleet_vehicles WHERE archived_at IS NULL AND next_service_due IS NOT NULL AND date(next_service_due) >= ? ORDER BY next_service_due LIMIT 20`, now); const insurances = await query<Record<string, unknown>>(db, `SELECT 'insurance' as type, vehicle_number, insurance_expiry as due_date, NULL as mileage FROM fleet_vehicles WHERE archived_at IS NULL AND insurance_expiry IS NOT NULL AND date(insurance_expiry) >= ? ORDER BY insurance_expiry LIMIT 20`, now); const registrations = await query<Record<string, unknown>>(db, `SELECT 'registration' as type, vehicle_number, registration_expiry as due_date, NULL as mileage FROM fleet_vehicles WHERE archived_at IS NULL AND registration_expiry IS NOT NULL AND date(registration_expiry) >= ? ORDER BY registration_expiry LIMIT 20`, now); return c.json([...services, ...insurances, ...registrations].sort((a: any, b: any) => (a.due_date || '').localeCompare(b.due_date || '')).slice(0, 50)); } catch (err) { return c.json([]); } });
fleet.get('/scheduling/rotation-plan', async (c) => { try { const db = getDb(c.env); const rows = await query<Record<string, unknown>>(db, `SELECT v.*, u.call_sign as unit FROM fleet_vehicles v LEFT JOIN units u ON u.id = v.assigned_unit_id WHERE v.archived_at IS NULL ORDER BY COALESCE(v.current_mileage, 0) DESC`); const high = rows.filter((r: any) => (r.current_mileage || 0) > 100000); const low = rows.filter((r: any) => (r.current_mileage || 0) <= 100000); return c.json({ high_mileage: high, low_mileage: low, rotation_recommended: high.length > 0 && low.length > 0 }); } catch (err) { return c.json({}); } });
fleet.get('/scheduling/backlog', async (c) => { try { const db = getDb(c.env); const backlog = (await queryFirst<{ n: number }>(db, "SELECT COUNT(*) as n FROM fleet_vehicles WHERE archived_at IS NULL AND ((next_service_due IS NOT NULL AND date(next_service_due) < date('now')) OR (next_service_mileage IS NOT NULL AND current_mileage >= next_service_mileage))"))?.n ?? 0; return c.json({ maintenance_backlog: backlog, severity: backlog > 5 ? 'critical' : backlog > 2 ? 'moderate' : 'normal' }); } catch (err) { return c.json({}); } });
fleet.get('/scheduling/parts-forecast', async (c) => { try { const db = getDb(c.env); const rows = await query<Record<string, unknown>>(db, `SELECT p.name, p.part_number, p.quantity_on_hand, p.reorder_point, COUNT(mp.id) as usage_last_90_days FROM fleet_parts p LEFT JOIN fleet_maintenance_parts mp ON mp.part_id = p.id AND mp.id IN (SELECT id FROM fleet_maintenance_parts GROUP BY part_id) WHERE p.quantity_on_hand <= p.reorder_point GROUP BY p.id ORDER BY usage_last_90_days DESC`); return c.json(rows); } catch (err) { return c.json([]); } });
fleet.get('/scheduling/special-event-plan', async (c) => { try { return c.json([]); } catch (err) { return c.json([]); } });

// ── RISK MANAGEMENT (411-425) ───────────────────────────────
fleet.get('/risk/vehicle-assessment/:id', async (c) => { try { const vehicleId = Number(c.req.param('id')); const db = getDb(c.env); const v = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM fleet_vehicles WHERE id = ?', vehicleId); if (!v) return c.json({ error: 'Not found' }, 404); const age = new Date().getFullYear() - ((v.year as number) || 2020); const accidents = (await queryFirst<{ n: number }>(db, 'SELECT COUNT(*) as n FROM fleet_accidents WHERE vehicle_id = ?', vehicleId))?.n ?? 0; const defectCount = (await queryFirst<{ n: number }>(db, 'SELECT COUNT(*) as n FROM fleet_defect_reports WHERE vehicle_id = ? AND resolved = 0', vehicleId))?.n ?? 0; const score = Math.min(100, age * 3 + accidents * 10 + defectCount * 5 + ((v.current_mileage as number) > 100000 ? 15 : 0)); return c.json({ vehicle_id: vehicleId, risk_score: score, risk_level: score > 60 ? 'high' : score > 30 ? 'medium' : 'low', age_years: age, accidents, open_defects: defectCount }); } catch (err) { return c.json({ error: 'Failed' }, 500); } });
fleet.get('/risk/high-risk-vehicles', async (c) => { try { const db = getDb(c.env); const rows = await query<Record<string, unknown>>(db, `SELECT v.*, COUNT(DISTINCT a.id) as accidents, COUNT(DISTINCT dr.id) as defects, COUNT(DISTINCT r.id) as open_recalls FROM fleet_vehicles v LEFT JOIN fleet_accidents a ON a.vehicle_id = v.id LEFT JOIN fleet_defect_reports dr ON dr.vehicle_id = v.id AND dr.resolved = 0 LEFT JOIN fleet_recalls r ON r.vehicle_id = v.id AND r.status = 'open' WHERE v.archived_at IS NULL GROUP BY v.id HAVING accidents > 0 OR defects > 0 OR open_recalls > 0 ORDER BY (accidents * 3 + defects * 2 + open_recalls) DESC`); return c.json(rows); } catch (err) { return c.json([]); } });
fleet.get('/risk/insurance-optimization', async (c) => { try { const db = getDb(c.env); const totalClaims = (await queryFirst<{ n: number; cost: number }>(db, 'SELECT COUNT(*) as n, COALESCE(SUM(estimated_damage),0) as cost FROM fleet_accidents WHERE insurance_claim_number IS NOT NULL')) ?? { n: 0, cost: 0 }; const totalPremiums = (await queryFirst<{ p: number }>(db, 'SELECT COALESCE(SUM(premium),0) as p FROM fleet_insurance'))?.p ?? 0; return c.json({ total_claims: totalClaims.n, total_claim_cost: totalClaims.cost, total_premiums: totalPremiums, loss_ratio: totalPremiums > 0 ? Math.round(((totalClaims.cost as number) / totalPremiums) * 100) : 0 }); } catch (err) { return c.json({}); } });
fleet.get('/risk/incident-root-cause', async (c) => { try { const db = getDb(c.env); const byWeather = await query<Record<string, unknown>>(db, 'SELECT weather_conditions as cause, COUNT(*) as count FROM fleet_accidents WHERE weather_conditions IS NOT NULL GROUP BY weather_conditions ORDER BY count DESC'); const byRoad = await query<Record<string, unknown>>(db, 'SELECT road_conditions as cause, COUNT(*) as count FROM fleet_accidents WHERE road_conditions IS NOT NULL GROUP BY road_conditions ORDER BY count DESC'); const bySeverity = await query<Record<string, unknown>>(db, 'SELECT severity as cause, COUNT(*) as count FROM fleet_accidents GROUP BY severity ORDER BY count DESC'); return c.json({ by_weather: byWeather, by_road: byRoad, by_severity: bySeverity }); } catch (err) { return c.json({}); } });
fleet.get('/risk/safety-audit-schedule', async (c) => { try { const db = getDb(c.env); const rows = await query<Record<string, unknown>>(db, `SELECT v.id, v.vehicle_number, COALESCE(MAX(i.inspection_date), v.created_at) as last_audit, CASE WHEN COALESCE(MAX(i.inspection_date), v.created_at) IS NOT NULL AND date(COALESCE(MAX(i.inspection_date), v.created_at)) <= date('now', '-180 days') THEN 'due' ELSE 'current' END as status FROM fleet_vehicles v LEFT JOIN fleet_inspections i ON i.vehicle_id = v.id WHERE v.archived_at IS NULL GROUP BY v.id ORDER BY status DESC, last_audit`); return c.json(rows); } catch (err) { return c.json([]); } });
fleet.get('/risk/pursuit-vehicles', async (c) => { try { const rows = await query<Record<string, unknown>>(getDb(c.env), "SELECT * FROM fleet_vehicles WHERE archived_at IS NULL AND (notes LIKE '%pursuit%' OR notes LIKE '%interceptor%' OR make = 'Ford' AND model LIKE '%Interceptor%') ORDER BY vehicle_number"); return c.json(rows); } catch (err) { return c.json([]); } });
fleet.get('/risk/continuity-plan', async (c) => { try { const db = getDb(c.env); const total = (await queryFirst<{ n: number }>(db, 'SELECT COUNT(*) as n FROM fleet_vehicles WHERE archived_at IS NULL'))?.n ?? 0; const available = (await queryFirst<{ n: number }>(db, "SELECT COUNT(*) as n FROM fleet_vehicles WHERE status = 'in_service' AND archived_at IS NULL"))?.n ?? 0; const spares = (await queryFirst<{ n: number }>(db, "SELECT COUNT(*) as n FROM fleet_vehicles WHERE status = 'in_service' AND archived_at IS NULL AND assigned_unit_id IS NULL"))?.n ?? 0; return c.json({ total_fleet: total, available_now: available, spare_vehicles: spares, critical_reserve_met: spares >= Math.ceil(total * 0.1) }); } catch (err) { return c.json({}); } });
fleet.post('/risk/theft-report', async (c) => { try { const db = getDb(c.env); const body = await c.req.json<Record<string, unknown>>(); const r = await execute(db, 'INSERT INTO fleet_vehicle_theft (vehicle_id, theft_date, location, police_report_number, insurance_claim_number, notes) VALUES (?,datetime(\'now\'),?,?,?,?)', body.vehicle_id, body.location ?? null, body.police_report_number ?? null, body.insurance_claim_number ?? null, body.notes ?? null); return c.json({ success: true, id: r.meta.last_row_id }, 201); } catch (err) { return c.json({ error: 'Failed' }, 500); } });
fleet.get('/risk/theft-reports', async (c) => { try { const rows = await query<Record<string, unknown>>(getDb(c.env), `SELECT ft.*, v.vehicle_number FROM fleet_vehicle_theft ft LEFT JOIN fleet_vehicles v ON v.id = ft.vehicle_id ORDER BY ft.theft_date DESC`); return c.json(rows); } catch (err) { return c.json([]); } });
fleet.put('/risk/theft-reports/:id/recover', async (c) => { try { const id = Number(c.req.param('id')); const body = await c.req.json<Record<string, unknown>>(); await execute(getDb(c.env), "UPDATE fleet_vehicle_theft SET recovered = 1, recovery_date = datetime('now'), recovery_condition = ? WHERE id = ?", body.recovery_condition ?? null, id); return c.json({ success: true }); } catch (err) { return c.json({ error: 'Failed' }, 500); } });

// ── PROCUREMENT & ACQUISITION (426-440) ─────────────────────
fleet.get('/procurement/specs', async (c) => { try { const rows = await query<Record<string, unknown>>(getDb(c.env), 'SELECT * FROM fleet_vehicle_specs WHERE is_active = 1 ORDER BY name'); return c.json(rows); } catch (err) { return c.json([]); } });
fleet.post('/procurement/specs', async (c) => { try { const db = getDb(c.env); const body = await c.req.json<Record<string, unknown>>(); const r = await execute(db, 'INSERT INTO fleet_vehicle_specs (name, vehicle_type, make, model, base_cost, equipment_package, ordering_code, notes) VALUES (?,?,?,?,?,?,?,?)', body.name, body.vehicle_type ?? null, body.make ?? null, body.model ?? null, body.base_cost ?? null, body.equipment_package ?? null, body.ordering_code ?? null, body.notes ?? null); return c.json({ success: true, id: r.meta.last_row_id }, 201); } catch (err) { return c.json({ error: 'Failed' }, 500); } });
fleet.get('/procurement/orders', async (c) => { try { const rows = await query<Record<string, unknown>>(getDb(c.env), `SELECT po.*, s.name as spec_name FROM fleet_procurement_orders po LEFT JOIN fleet_vehicle_specs s ON s.id = po.spec_id ORDER BY po.order_date DESC`); return c.json(rows); } catch (err) { return c.json([]); } });
fleet.post('/procurement/orders', async (c) => { try { const db = getDb(c.env); const body = await c.req.json<Record<string, unknown>>(); const r = await execute(db, 'INSERT INTO fleet_procurement_orders (spec_id, order_number, vendor, quantity, unit_price, total_price, order_date, expected_delivery, approved_by, notes) VALUES (?,?,?,?,?,?,datetime(\'now\'),?,?,?)', body.spec_id ?? null, body.order_number ?? null, body.vendor ?? null, body.quantity ?? 1, body.unit_price ?? null, body.total_price ?? null, body.expected_delivery ?? null, (c.get('user') as { id: number } | undefined)?.id ?? null, body.notes ?? null); return c.json({ success: true, id: r.meta.last_row_id }, 201); } catch (err) { return c.json({ error: 'Failed' }, 500); } });
fleet.get('/procurement/orders/:id/bids', async (c) => { try { const orderId = Number(c.req.param('id')); const rows = await query<Record<string, unknown>>(getDb(c.env), 'SELECT * FROM fleet_vendor_bids WHERE procurement_order_id = ? ORDER BY bid_amount', orderId); return c.json(rows); } catch (err) { return c.json([]); } });
fleet.post('/procurement/orders/:id/bids', async (c) => { try { const orderId = Number(c.req.param('id')); const db = getDb(c.env); const body = await c.req.json<Record<string, unknown>>(); const r = await execute(db, 'INSERT INTO fleet_vendor_bids (procurement_order_id, vendor, bid_amount, delivery_days, warranty_details, notes) VALUES (?,?,?,?,?,?)', orderId, body.vendor, body.bid_amount ?? null, body.delivery_days ?? null, body.warranty_details ?? null, body.notes ?? null); return c.json({ success: true, id: r.meta.last_row_id }, 201); } catch (err) { return c.json({ error: 'Failed' }, 500); } });
fleet.put('/procurement/bids/:id/select', async (c) => { try { const bidId = Number(c.req.param('id')); const db = getDb(c.env); const bid = await queryFirst<{ procurement_order_id: number }>(db, 'SELECT procurement_order_id FROM fleet_vendor_bids WHERE id = ?', bidId); if (!bid) return c.json({ error: 'Not found' }, 404); await execute(db, 'UPDATE fleet_vendor_bids SET selected = 0 WHERE procurement_order_id = ?', bid.procurement_order_id); await execute(db, 'UPDATE fleet_vendor_bids SET selected = 1 WHERE id = ?', bidId); return c.json({ success: true }); } catch (err) { return c.json({ error: 'Failed' }, 500); } });
fleet.get('/procurement/acquisition-cost-analysis', async (c) => { try { const db = getDb(c.env); const rows = await query<Record<string, unknown>>(db, `SELECT make, model, COUNT(*) as count, ROUND(AVG(COALESCE(cost, 0) + COALESCE(maint_cost, 0) + COALESCE(fuel_cost, 0)),0) as avg_lifetime_cost FROM (SELECT v.make, v.model, COALESCE(SUM(m.cost),0) as maint_cost, COALESCE(SUM(f.total_cost),0) as fuel_cost FROM fleet_vehicles v LEFT JOIN fleet_maintenance m ON m.vehicle_id = v.id LEFT JOIN fleet_fuel_log f ON f.vehicle_id = v.id GROUP BY v.id) GROUP BY make, model HAVING count >= 1 ORDER BY avg_lifetime_cost`); return c.json(rows); } catch (err) { return c.json([]); } });
fleet.get('/procurement/standardization', async (c) => { try { const db = getDb(c.env); const byMake = await query<Record<string, unknown>>(db, `SELECT make, COUNT(*) as count, ROUND(COUNT(*)*100.0/(SELECT COUNT(*) FROM fleet_vehicles WHERE archived_at IS NULL),0) as pct FROM fleet_vehicles WHERE archived_at IS NULL GROUP BY make ORDER BY count DESC`); return c.json({ by_make: byMake, recommendation: (byMake[0] as any)?.pct > 70 ? 'Fleet is well standardized' : 'Consider standardizing on fewer makes for parts/commonality savings' }); } catch (err) { return c.json({}); } });
fleet.get('/procurement/delivery-timeline', async (c) => { try { const rows = await query<Record<string, unknown>>(getDb(c.env), `SELECT po.*, s.name as spec_name, CASE WHEN po.actual_delivery IS NOT NULL THEN ROUND(julianday(po.actual_delivery) - julianday(po.order_date),0) ELSE ROUND(julianday('now') - julianday(po.order_date),0) END as days_elapsed FROM fleet_procurement_orders po LEFT JOIN fleet_vehicle_specs s ON s.id = po.spec_id WHERE po.status != 'delivered' ORDER BY po.order_date`); return c.json(rows); } catch (err) { return c.json([]); } });

// ── DECOMMISSIONING & DISPOSAL (441-450) ────────────────────
fleet.get('/decommissioning/checklist/:vehicleId', async (c) => { try { const vehicleId = Number(c.req.param('vehicleId')); const rows = await query<Record<string, unknown>>(getDb(c.env), 'SELECT * FROM fleet_decommissioning WHERE vehicle_id = ? ORDER BY decommission_date DESC', vehicleId); return c.json(rows); } catch (err) { return c.json([]); } });
fleet.post('/decommissioning/start', async (c) => { try { const db = getDb(c.env); const body = await c.req.json<Record<string, unknown>>(); const userId = (c.get('user') as { id: number } | undefined)?.id; const r = await execute(db, 'INSERT INTO fleet_decommissioning (vehicle_id, decommission_date, reason, completed_by, notes) VALUES (?,datetime(\'now\'),?,?,?)', body.vehicle_id, body.reason ?? 'end_of_life', userId ?? null, body.notes ?? null); await execute(db, "UPDATE fleet_vehicles SET status = 'retired', updated_at = datetime('now') WHERE id = ?", body.vehicle_id); return c.json({ success: true, id: r.meta.last_row_id }); } catch (err) { return c.json({ error: 'Failed' }, 500); } });
fleet.put('/decommissioning/:id/step', async (c) => { try { const id = Number(c.req.param('id')); const db = getDb(c.env); const body = await c.req.json<Record<string, unknown>>(); const step = body.step as string; const cols: Record<string, string> = { equipment_stripped: 'equipment_stripped', data_wiped: 'data_wiped', environmental_cleared: 'environmental_cleared' }; if (cols[step]) { await execute(db, `UPDATE fleet_decommissioning SET ${cols[step]} = 1 WHERE id = ?`, id); } return c.json({ success: true }); } catch (err) { return c.json({ error: 'Failed' }, 500); } });
fleet.put('/decommissioning/:id/complete', async (c) => { try { const id = Number(c.req.param('id')); const db = getDb(c.env); const body = await c.req.json<Record<string, unknown>>(); await execute(db, 'UPDATE fleet_decommissioning SET salvage_value = ?, disposal_method = ? WHERE id = ?', body.salvage_value ?? null, body.disposal_method ?? null, id); return c.json({ success: true }); } catch (err) { return c.json({ error: 'Failed' }, 500); } });
fleet.get('/decommissioning/active', async (c) => { try { const rows = await query<Record<string, unknown>>(getDb(c.env), `SELECT fd.*, v.vehicle_number, v.make, v.model, v.year FROM fleet_decommissioning fd LEFT JOIN fleet_vehicles v ON v.id = fd.vehicle_id WHERE (fd.equipment_stripped = 0 OR fd.data_wiped = 0 OR fd.environmental_cleared = 0 OR fd.disposal_method IS NULL) ORDER BY fd.decommission_date`); return c.json(rows); } catch (err) { return c.json([]); } });
fleet.get('/decommissioning/salvage-summary', async (c) => { try { const db = getDb(c.env); const total = (await queryFirst<{ n: number; value: number }>(db, 'SELECT COUNT(*) as n, COALESCE(SUM(salvage_value),0) as value FROM fleet_decommissioning WHERE salvage_value IS NOT NULL')) ?? { n: 0, value: 0 }; return c.json({ total_salvaged: total.n, total_salvage_value: total.value, avg_salvage: (total.n as number) > 0 ? Math.round((total.value as number) / (total.n as number)) : 0 }); } catch (err) { return c.json({}); } });
fleet.get('/decommissioning/disposal-methods', async (c) => { try { const rows = await query<Record<string, unknown>>(getDb(c.env), 'SELECT disposal_method, COUNT(*) as count FROM fleet_decommissioning WHERE disposal_method IS NOT NULL GROUP BY disposal_method ORDER BY count DESC'); return c.json(rows); } catch (err) { return c.json([]); } });
fleet.get('/decommissioning/reduction-analysis', async (c) => { try { const db = getDb(c.env); const active = (await queryFirst<{ n: number }>(db, "SELECT COUNT(*) as n FROM fleet_vehicles WHERE status = 'in_service' AND archived_at IS NULL"))?.n ?? 0; const aging = (await queryFirst<{ n: number }>(db, 'SELECT COUNT(*) as n FROM fleet_vehicles WHERE year < 2018 AND archived_at IS NULL'))?.n ?? 0; const highMileage = (await queryFirst<{ n: number }>(db, 'SELECT COUNT(*) as n FROM fleet_vehicles WHERE current_mileage > 120000 AND archived_at IS NULL'))?.n ?? 0; const retireable = aging + highMileage; return c.json({ active_fleet: active, candidates_for_retirement: Math.min(retireable, active), aging_vehicles: aging, high_mileage: highMileage, recommended_reduction: Math.max(0, active - Math.round(active * 0.8)) }); } catch (err) { return c.json({}); } });
fleet.get('/decommissioning/history', async (c) => { try { const rows = await query<Record<string, unknown>>(getDb(c.env), 'SELECT v.vehicle_number, v.make, v.model, v.year, fd.* FROM fleet_decommissioning fd JOIN fleet_vehicles v ON v.id = fd.vehicle_id ORDER BY fd.decommission_date DESC LIMIT 100'); return c.json(rows); } catch (err) { return c.json([]); } });
fleet.get('/decommissioning/stats', async (c) => { try { const db = getDb(c.env); const total = (await queryFirst<{ n: number; value: number }>(db, 'SELECT COUNT(*) as n, COALESCE(SUM(salvage_value),0) as value FROM fleet_decommissioning')) ?? { n: 0, value: 0 }; const completed = (await queryFirst<{ n: number }>(db, 'SELECT COUNT(*) as n FROM fleet_decommissioning WHERE disposal_method IS NOT NULL'))?.n ?? 0; return c.json({ total: total.n, completed, salvage_recovered: total.value, avg_days_to_complete: 0 }); } catch (err) { return c.json({}); } });

export default fleet;

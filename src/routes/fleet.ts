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

// ─────────────────────────────────────────────────────────
// GET /  — paginated list with filters
// ─────────────────────────────────────────────────────────
// fleet_vehicles is ~26 cols (well under D1's 100-col cap), so `SELECT *`
// is safe here. The LEFT JOIN against units pulls call_sign so the
// client can show the assigned unit label without a second round-trip.
fleet.get('/', async (c) => {
  try {
    const db = getDb(c.env);
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
// GET /:id — vehicle detail with linked assignments + recent activity
// ─────────────────────────────────────────────────────────
// Split-query pattern (mirrors dispatch/calls.ts:331). Even though
// fleet_vehicles itself is well under the 100-col cap, joining all
// related tables in one statement would either explode the result
// column count or force a cartesian product. Issuing parallel queries
// is cheaper than the alternatives and self-documents the row shapes.
fleet.get('/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const idParam = c.req.param('id');
    const id = Number(idParam);
    if (!Number.isInteger(id) || id <= 0) {
      return c.json({ error: 'Invalid vehicle id' }, 400);
    }

    const vehicle = await queryFirst<Record<string, unknown>>(
      db,
      `SELECT v.*, u.call_sign as assigned_unit_call_sign
       FROM fleet_vehicles v
       LEFT JOIN units u ON u.id = v.assigned_unit_id
       WHERE v.id = ?`,
      id,
    );
    if (!vehicle) return c.json({ error: 'Vehicle not found' }, 404);

    const assignments = await query<Record<string, unknown>>(
      db,
      `SELECT id, vehicle_id, unit_id, unit_call_sign, officer_name,
              assigned_at, unassigned_at, notes, created_at
       FROM fleet_assignments
       WHERE vehicle_id = ?
       ORDER BY assigned_at DESC LIMIT 50`,
      id,
    );

    const recent_maintenance = await query<Record<string, unknown>>(
      db,
      `SELECT id, vehicle_id, type, description, mileage_at_service,
              cost, vendor, performed_by, performed_at,
              next_due_date, next_due_mileage, created_at
       FROM fleet_maintenance
       WHERE vehicle_id = ?
       ORDER BY performed_at DESC LIMIT 25`,
      id,
    );

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
        const raw = body[key];
        vals.push(raw === '' ? null : raw);
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
fleet.put('/:id', async (c) => {
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
        const raw = body[key];
        bindings.push(raw === '' ? null : raw);
      }
    }
    if (setCols.length === 0) {
      return c.json({ error: 'No editable fields provided' }, 400);
    }

    // MST timestamps — all of /src/ pins SQL clocks to UTC-7 to avoid DST
    // drift in dispatch timelines (see project memory feedback on timestamps).
    setCols.push("updated_at = datetime('now', '-7 hours')");
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
fleet.delete('/:id', async (c) => {
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
           archived_at = datetime('now', '-7 hours'),
           updated_at = datetime('now', '-7 hours')
       WHERE id = ?`,
      id,
    );
    return c.json({ success: true, id });
  } catch (err) {
    console.error('DELETE /fleet/:id failed:', err);
    return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500);
  }
});

export default fleet;

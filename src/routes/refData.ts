// ============================================================
// RMPG Flex — Reference-data routes (Fleet.io PR 2)
// ============================================================
// Mounted at /api/ref-data (auth: 'required'). Read-only in PR 2; admin
// CRUD writes ship with the admin UI in PR 2b.
//
// Routes:
//   GET /api/ref-data/families             — list available family slugs
//   GET /api/ref-data/:family              — list rows from one ref table
//   GET /api/ref-data/:family/:id          — fetch one row by id
//   GET /api/ref-data/decode-vin/:vin      — NHTSA vPIC decode with D1 cache
//
// SECURITY: the `:family` URL param is mapped through a HARD-CODED
// allowlist (`FAMILIES` below) before any SQL is built. We never
// interpolate user-supplied identifiers into the SQL statement.
// ============================================================

import { Hono } from 'hono';
import { log } from '../utils/logger';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';
import { requireRole } from '../middleware/auth';
import { emitFleetioEvent } from '../utils/fleetio/events';
import {
  decodeVinCached,
  VinFormatError,
  VinDecoderTimeoutError,
  VinDecoderHttpError,
  VinDecoderError,
} from '../utils/vinDecoder';

const refData = new Hono<Env>();

// ─── Allowlist of family slugs → ref table + ordering ──────────
// Keep slugs kebab-case so URLs are readable; map back to the snake_case
// table name. Order column drives the default ordering on list.

interface FamilyConfig {
  table: string;
  orderBy: string;
}

const FAMILIES: Record<string, FamilyConfig> = {
  // Vehicle reference
  'vehicle-makes':        { table: 'ref_vehicle_makes',        orderBy: 'name' },
  'vehicle-models':       { table: 'ref_vehicle_models',       orderBy: 'name' },
  'vehicle-types':        { table: 'ref_vehicle_types',        orderBy: 'name' },
  'body-types':           { table: 'ref_body_types',           orderBy: 'name' },
  'drivetrains':          { table: 'ref_drivetrains',          orderBy: 'name' },
  'transmission-types':   { table: 'ref_transmission_types',   orderBy: 'name' },
  'engine-types':         { table: 'ref_engine_types',         orderBy: 'name' },
  'fuel-types':           { table: 'ref_fuel_types',           orderBy: 'name' },
  'colors':               { table: 'ref_colors',               orderBy: 'name' },
  'plate-states':         { table: 'ref_plate_states',         orderBy: 'name' },
  'tire-sizes':           { table: 'ref_tire_sizes',           orderBy: 'code' },
  'oil-types':            { table: 'ref_oil_types',            orderBy: 'name' },

  // Maintenance reference
  'vmrs-systems':         { table: 'ref_vmrs_systems',         orderBy: 'code' },
  'vmrs-assemblies':      { table: 'ref_vmrs_assemblies',      orderBy: 'system_code, code' },
  'vmrs-components':      { table: 'ref_vmrs_components',      orderBy: 'system_code, assembly_code, code' },
  'service-types':        { table: 'ref_service_types',        orderBy: 'name' },
  'part-categories':      { table: 'ref_part_categories',      orderBy: 'name' },
  'parts':                { table: 'ref_parts',                orderBy: 'name' },
  'labor-rates':          { table: 'ref_labor_rates',          orderBy: 'name' },
  'work-order-categories':{ table: 'ref_work_order_categories',orderBy: 'name' },

  // Fuel reference
  'fuel-grades':          { table: 'ref_fuel_grades',          orderBy: 'name' },
  'fuel-card-types':      { table: 'ref_fuel_card_types',      orderBy: 'name' },

  // Shared
  'vendors':              { table: 'ref_vendors',              orderBy: 'name' },
  'units-of-measure':     { table: 'ref_units_of_measure',     orderBy: 'family, name' },
};

function resolveFamily(slug: string): FamilyConfig | null {
  if (!Object.prototype.hasOwnProperty.call(FAMILIES, slug)) return null;
  return FAMILIES[slug];
}

// ─── GET /families — directory listing ─────────────────────────

refData.get('/families', (c) =>
  c.json({
    families: Object.keys(FAMILIES).sort(),
    count: Object.keys(FAMILIES).length,
  }),
);

// ─── GET /decode-vin/:vin — NHTSA vPIC decoder (cache-first) ───
//
// MUST be registered BEFORE /:family and /:family/:id below so that
// '/decode-vin/<vin>' doesn't get eaten by the parametric family handler
// with family='decode-vin' (which would return UNKNOWN_FAMILY 404 — the
// same shadow trap fixed elsewhere in this codebase; see properties.ts:43-45
// and the serveIntake/forensics regex-constrained /:id handlers).

refData.get('/decode-vin/:vin', async (c) => {
  const vin = c.req.param('vin');
  try {
    const db = getDb(c.env);
    const decoded = await decodeVinCached(db, vin);
    return c.json(decoded);
  } catch (err) {
    if (err instanceof VinFormatError) {
      return c.json({ error: err.message, code: 'INVALID_VIN' }, 400);
    }
    if (err instanceof VinDecoderTimeoutError) {
      return c.json({ error: err.message, code: 'NHTSA_TIMEOUT' }, 504);
    }
    if (err instanceof VinDecoderHttpError) {
      return c.json({ error: err.message, code: 'NHTSA_HTTP', status: err.status }, 502);
    }
    if (err instanceof VinDecoderError) {
      return c.json({ error: err.message, code: 'NHTSA_FAIL' }, 502);
    }
    log.error('[refData] decode-vin unknown error', {}, err instanceof Error ? err : new Error(String(err)));
    return c.json({ error: 'Failed to decode VIN', code: 'INTERNAL' }, 500);
  }
});

// ─── GET /:family — list rows ──────────────────────────────────

refData.get('/:family', async (c) => {
  const slug = c.req.param('family');
  const fam = resolveFamily(slug);
  if (!fam) {
    return c.json({ error: `Unknown ref family '${slug}'`, code: 'UNKNOWN_FAMILY' }, 404);
  }
  // Optional ?active_only=1 — filters to active=1 if the table has the column.
  const activeOnly = c.req.query('active_only') === '1';
  const limit = clampLimit(c.req.query('limit'));
  try {
    const db = getDb(c.env);
    const where = activeOnly ? ' WHERE active = 1' : '';
    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT * FROM ${fam.table}${where} ORDER BY ${fam.orderBy} LIMIT ?`,
      limit,
    );
    return c.json({ family: slug, count: rows.length, rows });
  } catch (err) {
    // Most likely cause: the migration hasn't reached live D1 yet (per CLAUDE.md
    // gotcha #5). Surface that explicitly instead of a bare 500.
    log.error(`[refData] list /${slug} failed`, {}, err instanceof Error ? err : new Error(String(err)));
    return c.json({
      error: `Failed to list ${slug}`,
      code: 'DB_ERROR',
      detail: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});

// ─── GET /:family/:id — single row ─────────────────────────────

refData.get('/:family/:id', async (c) => {
  const slug = c.req.param('family');
  const fam = resolveFamily(slug);
  if (!fam) {
    return c.json({ error: `Unknown ref family '${slug}'`, code: 'UNKNOWN_FAMILY' }, 404);
  }
  const idRaw = c.req.param('id');
  const id = parseInt(idRaw, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: 'Invalid id', code: 'INVALID_ID' }, 400);
  }
  try {
    const db = getDb(c.env);
    const row = await queryFirst<Record<string, unknown>>(
      db,
      `SELECT * FROM ${fam.table} WHERE id = ?`,
      id,
    );
    if (!row) return c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404);
    return c.json(row);
  } catch (err) {
    log.error(`[refData] get /${slug}/${id} failed`, {}, err instanceof Error ? err : new Error(String(err)));
    return c.json({
      error: `Failed to fetch ${slug}/${id}`,
      code: 'DB_ERROR',
      detail: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});

// ─── Vendor CRUD (admin) — only `ref_vendors` writes today ─────
// `ref_vendors` is the RMPG-side half of the Fleet.io vendor sync
// (resource-parity extension). The other 20+ ref families are read-only
// lookup tables seeded by migrations; vendors are the one family with
// real day-to-day data entry (new shop/parts vendors), so it gets its
// own write path here rather than a generic CRUD-for-every-family route.

const VENDOR_TABLE = 'ref_vendors';
const VENDOR_KIND_CREATE = 'vendor.create';
const VENDOR_KIND_UPDATE = 'vendor.update';
const VENDOR_KIND_DELETE = 'vendor.delete';

// Fleet.io's vendors resource caps every one of these string fields at 255
// chars (developer.fleetio.com/reference/create-vendor, confirmed
// 2026-07-29 — see docs/fleetio-api-reference.md). Before mapVendorFieldsToFleetio
// was fixed to send Fleet.io's real field names, an over-length value here
// was silently dropped along with every other field, so this constraint was
// never actually exercised. Now that field names round-trip correctly, an
// over-length value would 422 on sync instead — reject it here instead.
const VENDOR_MAX_LEN = 255;
function validateVendorBody(body: Record<string, unknown>): string | null {
  for (const key of ['name', 'address', 'city', 'state', 'zip', 'phone', 'email'] as const) {
    const v = body[key];
    if (typeof v === 'string' && v.length > VENDOR_MAX_LEN) return `${key} must be ${VENDOR_MAX_LEN} characters or fewer`;
  }
  return null;
}

refData.post('/vendors', requireRole('admin'), async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  if (!body.name) return c.json({ error: 'name is required', code: 'INVALID_BODY' }, 400);
  const validationError = validateVendorBody(body);
  if (validationError) return c.json({ error: validationError, code: 'INVALID_BODY' }, 400);
  const db = getDb(c.env);
  const result = await execute(db,
    `INSERT INTO ref_vendors (name, kind, address, city, state, zip, phone, email, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    body.name, body.kind ?? 'vendor', body.address ?? null, body.city ?? null,
    body.state ?? null, body.zip ?? null, body.phone ?? null, body.email ?? null, body.notes ?? null);
  const id = result.meta.last_row_id as number;
  const row = await queryFirst<Record<string, unknown>>(db, `SELECT * FROM ${VENDOR_TABLE} WHERE id = ?`, id);
  await emitFleetioEvent(c, VENDOR_KIND_CREATE, row, {
    rmpgTable: VENDOR_TABLE, rmpgId: id, versionToken: String(row?.updated_at ?? row?.created_at ?? id),
  });
  return c.json(row, 201);
});

refData.put('/vendors/:id{[0-9]+}', requireRole('admin'), async (c) => {
  const id = parseInt(c.req.param('id') ?? '0', 10);
  const db = getDb(c.env);
  const existing = await queryFirst<Record<string, unknown>>(db, `SELECT * FROM ${VENDOR_TABLE} WHERE id = ?`, id);
  if (!existing) return c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404);
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  const validationError = validateVendorBody(body);
  if (validationError) return c.json({ error: validationError, code: 'INVALID_BODY' }, 400);
  const editable = ['name', 'kind', 'address', 'city', 'state', 'zip', 'lat', 'lng', 'phone', 'email', 'notes', 'active'];
  const setCols: string[] = [];
  const bindings: unknown[] = [];
  for (const f of editable) {
    if (Object.prototype.hasOwnProperty.call(body, f)) {
      setCols.push(`${f} = ?`);
      bindings.push(body[f]);
    }
  }
  if (setCols.length === 0) return c.json({ error: 'No editable fields provided', code: 'INVALID_BODY' }, 400);
  bindings.push(id);
  await execute(db, `UPDATE ${VENDOR_TABLE} SET ${setCols.join(', ')}, updated_at = datetime('now') WHERE id = ?`, ...bindings);
  const row = await queryFirst<Record<string, unknown>>(db, `SELECT * FROM ${VENDOR_TABLE} WHERE id = ?`, id);
  await emitFleetioEvent(c, VENDOR_KIND_UPDATE, row, {
    rmpgTable: VENDOR_TABLE, rmpgId: id, versionToken: String(row?.updated_at ?? Date.now()),
  });
  return c.json(row);
});

refData.delete('/vendors/:id{[0-9]+}', requireRole('admin'), async (c) => {
  const id = parseInt(c.req.param('id') ?? '0', 10);
  const db = getDb(c.env);
  const existing = await queryFirst<Record<string, unknown>>(db, `SELECT * FROM ${VENDOR_TABLE} WHERE id = ?`, id);
  if (!existing) return c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404);
  // Soft delete — vendors may be referenced by historical work orders/fuel
  // entries via vendor_id; deactivate rather than remove the row.
  await execute(db, `UPDATE ${VENDOR_TABLE} SET active = 0, updated_at = datetime('now') WHERE id = ?`, id);
  await emitFleetioEvent(c, VENDOR_KIND_DELETE, { id }, {
    rmpgTable: VENDOR_TABLE, rmpgId: id, versionToken: String(Date.now()),
  });
  return c.json({ success: true });
});

// ─── Helpers ───────────────────────────────────────────────────

function clampLimit(raw: string | undefined): number {
  const DEFAULT = 500;
  const MAX = 5000;
  if (!raw) return DEFAULT;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT;
  return Math.min(n, MAX);
}

export default refData;

// src/utils/carxe/vehicleRecords.ts
// ============================================================
// RMPG Flex — CarsXE → vehicles_records bridge
// ============================================================
// WHY THIS EXISTS (live-data audit, 2026-07-30):
//
// The CarsXE integration originally wrote to vehicles_records from exactly one
// place — the active-theft path — and matched only on `WHERE UPPER(vin) = ?`.
// On live D1 (785de7ae) that join key is 90% empty: 38 of 42 vehicles_records
// rows had NO vin, and 0 lacked a plate_number. The RMS is plate-keyed, and
// both UI call sites (VehicleDossier, PlateLogPage) pass mode="plate".
//
// Two consequences, both fixed here:
//   1. The officer-safety theft write was effectively unreachable, and when it
//      DID fire against a car already known by plate it INSERTed a duplicate
//      row — putting is_stolen=1 on an orphan record while the plate-keyed row
//      officers actually see in the dossier stayed clean.
//   2. Rich data CarsXE already returned (vin, make, model, year, color, trim,
//      body style, engine/fuel/transmission/drive type) was thrown away even
//      though vehicles_records has columns for every one of it.
//
// DESIGN RULE — FILL-ONLY, NEVER CLOBBER. CarsXE is commercial third-party
// data being written into an authoritative law-enforcement record. Every
// column write is COALESCE(NULLIF(col,''), ?) (or COALESCE(col, ?) for
// numerics), so a CarsXE value can only ever populate a BLANK field. Anything
// an officer typed wins permanently. The one deliberate exception is the theft
// status itself (is_stolen / stolen_status), which is an officer-safety signal
// and must overwrite — see recordCarxeTheftHit in ../../routes/carxe.ts.
// ============================================================

import { queryFirst, execute } from '../db';
import type { CarxePlateResult, CarxeSpecsResult, CarxeHistoryResult } from './types';

/** CarsXE returns `year` as a STRING on the plate decoder ("2015") and
 *  sometimes as a range ("2014-2015") on specs, while vehicles_records.year is
 *  INTEGER. A raw bind of "2014-2015" into an INTEGER column stores 0 in
 *  SQLite's loose typing rather than failing, so parse explicitly and take the
 *  FIRST 4-digit run. Returns null for anything not a plausible vehicle year —
 *  null is safe because every write is COALESCE-guarded. */
export function parseVehicleYear(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw >= 1900 && raw <= 2100 ? Math.trunc(raw) : null;
  }
  const m = String(raw ?? '').match(/\b(19|20)\d{2}\b/);
  if (!m) return null;
  const n = Number(m[0]);
  return n >= 1900 && n <= 2100 ? n : null;
}

/** Normalizes an identifier for comparison. Plates and VINs are compared
 *  case-insensitively and whitespace-trimmed; returns undefined for blanks so
 *  callers can skip a useless WHERE clause rather than matching on ''. */
export function normalizeId(raw: unknown): string | undefined {
  const s = String(raw ?? '').trim().toUpperCase();
  return s === '' ? undefined : s;
}

export interface VehicleIdentity {
  vin?: string;
  plate?: string;
  state?: string;
}

export interface ResolvedVehicle {
  id: number;
  vin: string | null;
  plate_number: string | null;
  flags: string | null;
}

/** Finds the existing vehicles_records row for a CarsXE result.
 *
 *  Resolution order is deliberate and is the whole fix for the duplicate-record
 *  bug: VIN first (globally unique, so an exact match is definitive), then
 *  plate+state (a plate is only unique WITHIN a state), then plate alone
 *  (90% of live rows have a plate and no state-qualified duplicate, and a
 *  same-plate different-state collision is rarer than the missed-match it
 *  prevents). Returns null only when the car is genuinely unknown.
 *
 *  All comparisons wrap the COLUMN in UPPER(TRIM(...)) as well as the bound
 *  value — existing rows were written by several different code paths (ALPR,
 *  manual entry, imports) with inconsistent casing/padding. */
export async function resolveVehicleRecord(
  db: D1Database,
  identity: VehicleIdentity,
): Promise<ResolvedVehicle | null> {
  const vin = normalizeId(identity.vin);
  const plate = normalizeId(identity.plate);
  const state = normalizeId(identity.state);

  const SELECT = 'SELECT id, vin, plate_number, flags FROM vehicles_records';

  if (vin) {
    // The `vin IS NOT NULL AND TRIM(vin) != ''` prefix is REDUNDANT for
    // correctness (a non-blank equality match already implies both) but is
    // REQUIRED for performance: idx_vehicles_records_vin_unique is a PARTIAL
    // index carrying exactly that WHERE clause, and SQLite will only use a
    // partial index when the query's predicate provably implies the index's.
    // Verified on live via EXPLAIN QUERY PLAN — without this prefix the plan is
    // `SCAN vehicles_records`; with it, `SEARCH ... USING INDEX
    // idx_vehicles_records_vin_unique`. Do not "simplify" it away.
    const byVin = await queryFirst<ResolvedVehicle>(
      db,
      `${SELECT} WHERE vin IS NOT NULL AND TRIM(vin) != '' AND UPPER(TRIM(vin)) = ? LIMIT 1`,
      vin,
    );
    if (byVin) return byVin;
  }

  if (plate && state) {
    const byPlateState = await queryFirst<ResolvedVehicle>(
      db,
      `${SELECT} WHERE UPPER(TRIM(plate_number)) = ? AND UPPER(TRIM(state)) = ? LIMIT 1`,
      plate,
      state,
    );
    if (byPlateState) return byPlateState;
  }

  if (plate) {
    // Prefer a row that already carries a VIN, so repeated lookups converge on
    // the richest record instead of oscillating between near-duplicates.
    const byPlate = await queryFirst<ResolvedVehicle>(
      db,
      `${SELECT} WHERE UPPER(TRIM(plate_number)) = ?
        ORDER BY CASE WHEN vin IS NULL OR TRIM(vin) = '' THEN 1 ELSE 0 END, id
        LIMIT 1`,
      plate,
    );
    if (byPlate) return byPlate;
  }

  return null;
}

/** Column set a CarsXE plate decode can contribute. Kept as data (not inlined
 *  SQL) so the fill-only UPDATE and the INSERT stay in sync by construction —
 *  they previously drifted in alpr.ts's equivalent. */
interface VehicleFields {
  vin?: string | null;
  plate_number?: string | null;
  state?: string | null;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  color?: string | null;
  trim?: string | null;
  body_style?: string | null;
  engine_type?: string | null;
  fuel_type?: string | null;
  transmission?: string | null;
  drive_type?: string | null;
  doors?: number | null;
  lien_holder?: string | null;
  title_status?: string | null;
}

const TEXT_FIELDS: Array<keyof VehicleFields> = [
  'vin', 'plate_number', 'state', 'make', 'model', 'color', 'trim',
  'body_style', 'engine_type', 'fuel_type', 'transmission', 'drive_type',
  'lien_holder', 'title_status',
];
const NUMERIC_FIELDS: Array<keyof VehicleFields> = ['year', 'doors'];

/** Applies fields to an existing row, FILL-ONLY. Builds the SET list from the
 *  keys actually present so an absent field is never bound as NULL into a
 *  COALESCE (which would be a no-op, but would also pointlessly rewrite
 *  updated_at and obscure which lookups contributed anything).
 *  Returns the number of columns it attempted to fill. */
export async function fillVehicleFields(
  db: D1Database,
  vehicleId: number,
  fields: VehicleFields,
): Promise<number> {
  const sets: string[] = [];
  const binds: unknown[] = [];

  for (const key of TEXT_FIELDS) {
    const v = fields[key];
    if (v === undefined || v === null || String(v).trim() === '') continue;
    sets.push(`${key} = COALESCE(NULLIF(${key}, ''), ?)`);
    binds.push(String(v).trim());
  }
  for (const key of NUMERIC_FIELDS) {
    const v = fields[key];
    if (v === undefined || v === null) continue;
    sets.push(`${key} = COALESCE(${key}, ?)`);
    binds.push(v);
  }

  if (!sets.length) return 0;

  sets.push("updated_at = datetime('now')");
  binds.push(vehicleId);
  await execute(db, `UPDATE vehicles_records SET ${sets.join(', ')} WHERE id = ?`, ...binds);
  return sets.length - 1;
}

/** Resolve-or-create, then fill. This is the single entry point every CarsXE
 *  write path uses, so identity resolution can never diverge between them.
 *  `provenance` lands in `notes` ONLY when notes is blank — it documents where
 *  an auto-created record came from without ever overwriting officer notes. */
export async function upsertVehicleFromCarxe(
  db: D1Database,
  identity: VehicleIdentity,
  fields: VehicleFields,
  provenance: string,
): Promise<{ vehicleId: number; created: boolean; filled: number }> {
  const existing = await resolveVehicleRecord(db, identity);

  if (existing) {
    // Never let a blank/absent incoming identifier blank out a stored one.
    const merged: VehicleFields = {
      ...fields,
      vin: fields.vin ?? normalizeId(identity.vin) ?? null,
      plate_number: fields.plate_number ?? normalizeId(identity.plate) ?? null,
      state: fields.state ?? normalizeId(identity.state) ?? null,
    };
    const filled = await fillVehicleFields(db, existing.id, merged);
    return { vehicleId: existing.id, created: false, filled };
  }

  const plate = normalizeId(identity.plate) ?? null;
  const vin = normalizeId(identity.vin) ?? null;
  // A record with neither identifier is unusable — refuse rather than create
  // an anonymous row that can never be resolved again.
  if (!plate && !vin) {
    throw new Error('upsertVehicleFromCarxe: refusing to create a vehicle record with no plate and no VIN');
  }

  const r = await execute(
    db,
    `INSERT INTO vehicles_records (plate_number, state, vin, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`,
    plate,
    normalizeId(identity.state) ?? null,
    vin,
    provenance,
  );
  const vehicleId = Number(r.meta.last_row_id);
  const filled = await fillVehicleFields(db, vehicleId, fields);
  return { vehicleId, created: true, filled };
}

/** Maps a CarsXE plate-decoder response onto vehicles_records columns.
 *  `style` is CarsXE's name for body style; `body_style` also appears on some
 *  country variants, so accept either. */
export function fieldsFromPlateResult(result: CarxePlateResult): VehicleFields {
  return {
    vin: normalizeId(result.vin) ?? null,
    make: result.make ?? null,
    model: result.model ?? null,
    year: parseVehicleYear(result.year),
    color: result.color ?? null,
    trim: result.trim ?? null,
    body_style: (result.body_style as string | undefined) ?? result.style ?? null,
  };
}

/** Reads a value from CarsXE's `attributes` dict under any of several candidate
 *  key names. CarsXE's specs payload is not a fixed schema — key naming varies
 *  by data provider (`transmission` vs `transmission_short`, `drive_type` vs
 *  `driven_wheels`), so probe rather than assume, exactly as the Roboflow ALPR
 *  parser does for its outputs. */
function pick(attrs: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = attrs[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return null;
}

/** Extracts a title-status string from a CarsXE /history response.
 *
 *  `currentTitleInformation` / `brandsInformation` are typed `unknown[]` because
 *  CarsXE's history payload nests differently per data provider, so walk them
 *  defensively rather than asserting a shape. A brand ("SALVAGE", "FLOOD",
 *  "LEMON") is preferred over the plain title status when present — it is the
 *  more operationally significant fact about the vehicle.
 *
 *  Returns null when nothing usable is found; every write is COALESCE-guarded,
 *  so null simply means "contribute nothing". */
export function titleStatusFromHistory(result: CarxeHistoryResult): string | null {
  const firstString = (rows: unknown, ...keys: string[]): string | null => {
    if (!Array.isArray(rows)) return null;
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const rec = row as Record<string, unknown>;
      for (const k of keys) {
        const v = rec[k];
        if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
      }
    }
    return null;
  };

  return (
    firstString(result.brandsInformation, 'brand', 'brandType', 'brand_type', 'description') ??
    firstString(result.currentTitleInformation, 'titleStatus', 'title_status', 'status', 'description') ??
    firstString(result.junkAndSalvageInformation, 'reportingEntityType', 'disposition', 'description') ??
    null
  );
}

/** Maps a CarsXE /history response onto vehicles_records columns. */
export function fieldsFromHistoryResult(result: CarxeHistoryResult): VehicleFields {
  return { title_status: titleStatusFromHistory(result) };
}

/** Maps a CarsXE /specs response onto vehicles_records columns. */
export function fieldsFromSpecsResult(result: CarxeSpecsResult): VehicleFields {
  const attrs = (result.attributes ?? {}) as Record<string, unknown>;
  const doorsRaw = pick(attrs, 'doors', 'number_of_doors', 'door_count');
  const doors = doorsRaw ? Number.parseInt(doorsRaw, 10) : NaN;
  return {
    make: pick(attrs, 'make'),
    model: pick(attrs, 'model'),
    year: parseVehicleYear(pick(attrs, 'year')),
    trim: pick(attrs, 'trim', 'trim_level'),
    body_style: pick(attrs, 'body_style', 'style', 'body_type'),
    engine_type: pick(attrs, 'engine', 'engine_type', 'engine_description'),
    fuel_type: pick(attrs, 'fuel_type', 'fuel'),
    transmission: pick(attrs, 'transmission', 'transmission_short', 'transmission_type'),
    drive_type: pick(attrs, 'drive_type', 'driven_wheels', 'drivetrain'),
    doors: Number.isFinite(doors) && doors > 0 && doors < 10 ? doors : null,
  };
}

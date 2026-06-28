// ============================================================
// RMPG Flex — NSOPW offender ⇄ canonical records linkage.
// ------------------------------------------------------------
// On every NSOPW match (confirmed OR possible), this module:
//
//   1. Finds-or-creates a `persons` row for the offender (canonical
//      identity record on the RMPG side, dedup'd by name + DOB).
//      Stamps is_sex_offender = 1 + sor_number = "{jurisdiction}:{ext}".
//
//   2. For each non-TRANSIENT / non-INCARCERATED location, finds-or-
//      creates a `properties` row (dedup'd by normalized address)
//      and writes a `nsopw_offender_properties` join row marking
//      this offender at this property with its location_type.
//
//   3. Updates `national_sex_offenders.person_id` to the linked
//      person row id so downstream queries can join cleanly.
//
// Caller responsibility: nothing here throws. Every find/create
// failure is logged + skipped. This is fire-and-forget so a write
// hiccup never breaks the parent NSOPW screening call. The orchestrator
// invokes us via ctx.waitUntil() after upsertOffender.
//
// IMPORTANT: the property dedup intentionally skips TRANSIENT
// addresses ("TRANSIENT" / blank streetAddress) and INCARCERATED
// types — those are jurisdictional placeholder values, not actual
// addresses; creating a `properties` row for them would pollute
// the records space (every TRANSIENT offender would resolve to the
// same fake "TRANSIENT" property).
// ============================================================

import type { D1Database } from '@cloudflare/workers-types';
import type { Bindings } from '../../types';
import { execute, query, queryFirst } from '../db';
import type { NsopwOffender, NsopwLocation } from './types';

export interface MaterializedLinks {
  personId: number | null;
  personCreated: boolean;
  propertyLinks: Array<{
    propertyId: number;
    propertyCreated: boolean;
    locationType: string;
    locationName: string | null;
  }>;
  /** Future-hook: per-state detail enrichment may yield vehicles. */
  vehicleLinks: Array<{ vehicleId: number; created: boolean }>;
}

/**
 * Compose every records-linkage side-effect for one offender match.
 * Idempotent — calling again with the same data returns the same ids
 * and updates last_seen_at on the join rows.
 */
export async function materializeOffenderLinks(
  env: Bindings,
  db: D1Database,
  offenderRowId: number,
  offender: NsopwOffender,
): Promise<MaterializedLinks> {
  const result: MaterializedLinks = {
    personId: null,
    personCreated: false,
    propertyLinks: [],
    vehicleLinks: [],
  };

  // 1) Person — find or create + link both ways.
  try {
    const person = await findOrCreateOffenderPerson(db, offender);
    if (person.id) {
      result.personId = person.id;
      result.personCreated = person.created;
      await execute(
        db,
        `UPDATE national_sex_offenders SET person_id = ? WHERE id = ?`,
        person.id, offenderRowId,
      );
    }
  } catch (err) {
    console.warn('[nsopw-link] person link failed:', err);
  }

  // 2) Properties — one join row per real address. TRANSIENT /
  // INCARCERATED locations are NOT materialized as properties.
  for (const loc of offender.locations ?? []) {
    if (!isRealAddress(loc)) continue;
    try {
      const prop = await findOrCreateOffenderProperty(db, offender, loc);
      if (!prop.id) continue;
      const locationType = normLocationType(loc.type);
      await linkOffenderToProperty(db, offenderRowId, prop.id, locationType, loc);
      result.propertyLinks.push({
        propertyId: prop.id,
        propertyCreated: prop.created,
        locationType,
        locationName: loc.name,
      });
    } catch (err) {
      console.warn('[nsopw-link] property link failed:', err);
    }
  }

  return result;
}

// ── Person ───────────────────────────────────────────────────

interface FoundOrCreated { id: number; created: boolean }

async function findOrCreateOffenderPerson(
  db: D1Database,
  o: NsopwOffender,
): Promise<FoundOrCreated> {
  const first = (o.firstName || '').trim();
  const last = (o.lastName || '').trim();
  if (!first && !last) return { id: 0, created: false };
  const dob = o.dateOfBirth || null;
  const sorNumber = o.nsopwOffenderId
    ? `${o.jurisdiction}:${o.nsopwOffenderId}`
    : null;

  // Match priority: sor_number → (last+first+dob exact) → (last+first
  // when neither side has a DOB). We deliberately do NOT match on
  // last+first alone when one side has a DOB and the other doesn't —
  // safer to create a duplicate than to merge two distinct people.
  if (sorNumber) {
    const bySor = await queryFirst<{ id: number }>(
      db, `SELECT id FROM persons WHERE sor_number = ? LIMIT 1`, sorNumber,
    );
    if (bySor?.id) {
      await stampAsSorOffender(db, bySor.id, o, sorNumber);
      return { id: bySor.id, created: false };
    }
  }

  if (dob) {
    const byNameDob = await queryFirst<{ id: number }>(
      db,
      `SELECT id FROM persons
        WHERE LOWER(last_name) = LOWER(?) AND LOWER(first_name) = LOWER(?)
          AND dob = ? LIMIT 1`,
      last, first, dob,
    );
    if (byNameDob?.id) {
      await stampAsSorOffender(db, byNameDob.id, o, sorNumber);
      return { id: byNameDob.id, created: false };
    }
  } else {
    // No DOB on either side — fall back to name-only match.
    // (Only takes effect when persons.dob IS NULL too.)
    const byName = await queryFirst<{ id: number }>(
      db,
      `SELECT id FROM persons
        WHERE LOWER(last_name) = LOWER(?) AND LOWER(first_name) = LOWER(?)
          AND (dob IS NULL OR dob = '') LIMIT 1`,
      last, first,
    );
    if (byName?.id) {
      await stampAsSorOffender(db, byName.id, o, sorNumber);
      return { id: byName.id, created: false };
    }
  }

  // Insert. persons.first_name + last_name are NOT NULL; everything
  // else nullable. Primary address from locations[0] if present.
  const primary = (o.locations ?? []).find(isRealAddress) ?? null;
  const ins = await execute(
    db,
    `INSERT INTO persons (
       first_name, middle_name, last_name, dob, gender, race,
       address, city, state, zip,
       is_sex_offender, sor_number, notes
     ) VALUES (?, ?, ?, ?, ?, ?,  ?, ?, ?, ?,  1, ?, ?)`,
    first || '-',
    o.middleName,
    last || '-',
    dob,
    o.sex, o.race,
    primary?.streetAddress ?? null,
    primary?.city ?? null,
    primary?.state ?? null,
    primary?.zipCode ?? null,
    sorNumber,
    `Auto-created from NSOPW match (${o.jurisdictionLabel || o.jurisdiction})`,
  );
  return { id: Number(ins.meta?.last_row_id ?? 0), created: true };
}

async function stampAsSorOffender(
  db: D1Database,
  personId: number,
  o: NsopwOffender,
  sorNumber: string | null,
): Promise<void> {
  // Never clobber an existing sor_number; only set is_sex_offender + the
  // sor_number if missing. Updates are intentionally narrow so we don't
  // overwrite operator edits.
  await execute(
    db,
    `UPDATE persons
        SET is_sex_offender = 1,
            sor_number = COALESCE(NULLIF(sor_number, ''), ?)
      WHERE id = ?`,
    sorNumber, personId,
  ).catch(() => {});
}

// ── Property ─────────────────────────────────────────────────

async function findOrCreateOffenderProperty(
  db: D1Database,
  o: NsopwOffender,
  loc: NsopwLocation,
): Promise<FoundOrCreated> {
  const address = (loc.streetAddress || '').trim();
  if (!address) return { id: 0, created: false };
  const normalized = normalizeAddress(address);
  // Address-prefix match with normalized comparison — copies the
  // dedup behavior from serveIntakeRecords.findOrCreateProperty so
  // both writers converge on the same property row when the same
  // address is imported via different paths.
  const prefix = normalized.split(' ').slice(0, 4).join(' ');
  const candidates = await query<{ id: number; address: string }>(
    db,
    `SELECT id, address FROM properties WHERE LOWER(address) LIKE ? LIMIT 25`,
    `%${prefix}%`,
  );
  for (const c of candidates) {
    if (normalizeAddress(c.address) === normalized) {
      return { id: c.id, created: false };
    }
  }
  const clientId = await ensureNsopwSentinelClient(db);
  if (!clientId) return { id: 0, created: false };

  // properties.is_active is NOT NULL with no default on live D1
  // (0037 backport observation, see serveIntakeRecords.ts:233).
  // Keep the projection tight.
  const ins = await execute(
    db,
    `INSERT INTO properties (
       client_id, name, address, latitude, longitude, property_type,
       post_orders, is_active
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
    clientId,
    `${o.firstName} ${o.lastName}`.trim() || address,
    address,
    loc.latitude ?? null, loc.longitude ?? null,
    deriveTypeFromLocation(loc),
    `Auto-imported from NSOPW (${o.jurisdictionLabel || o.jurisdiction})`,
  );
  return { id: Number(ins.meta?.last_row_id ?? 0), created: true };
}

async function linkOffenderToProperty(
  db: D1Database,
  offenderRowId: number,
  propertyId: number,
  locationType: string,
  loc: NsopwLocation,
): Promise<void> {
  // UPSERT on (offender_id, property_id, location_type).
  await execute(
    db,
    `INSERT INTO nsopw_offender_properties (
        offender_id, property_id, location_type, location_name,
        latitude, longitude, first_seen_at, last_seen_at, active
     ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), 1)
     ON CONFLICT(offender_id, property_id, location_type) DO UPDATE SET
        last_seen_at = datetime('now'),
        active = 1,
        location_name = COALESCE(excluded.location_name, location_name),
        latitude = COALESCE(excluded.latitude, latitude),
        longitude = COALESCE(excluded.longitude, longitude)`,
    offenderRowId, propertyId, locationType, loc.name,
    loc.latitude, loc.longitude,
  );
}

// ── Sentinel client ─────────────────────────────────────────

let _sentinelClientId: number | null = null;
async function ensureNsopwSentinelClient(db: D1Database): Promise<number> {
  if (_sentinelClientId) return _sentinelClientId;
  const row = await queryFirst<{ id: number }>(
    db,
    `SELECT id FROM clients WHERE name = 'NSOPW — Auto-Imported' LIMIT 1`,
  ).catch(() => null);
  if (row?.id) { _sentinelClientId = row.id; return row.id; }
  // Mig 0149 seeds it; runtime-create if mig didn't land.
  const ins = await execute(
    db,
    `INSERT INTO clients (name, notes) VALUES (?, ?)`,
    'NSOPW — Auto-Imported',
    'Sentinel client for properties imported from NSOPW federated SOR matches.',
  ).catch(() => null);
  const id = Number(ins?.meta?.last_row_id ?? 0);
  if (id) _sentinelClientId = id;
  return id;
}

// ── Helpers ──────────────────────────────────────────────────

export function isRealAddress(loc: NsopwLocation): boolean {
  const street = (loc.streetAddress || '').trim().toUpperCase();
  if (!street) return false;
  // NSOPW jurisdictions emit literal placeholders that aren't real
  // addresses. Treat them as "no place" — every TRANSIENT offender
  // in Utah otherwise collapses to the same property row.
  if (street === 'TRANSIENT' || street === 'INCARCERATED' ||
      street === 'UNKNOWN' || street === 'N/A' || street === 'NA') {
    return false;
  }
  const type = (loc.type || '').toUpperCase();
  if (type === 'INCARCERATED') return false;
  return true;
}

export function normLocationType(t: string | null | undefined): string {
  const s = (t || '').toUpperCase();
  if (s === 'R' || s === 'RESIDENTIAL' || s === 'RESIDENCE') return 'RESIDENCE';
  if (s === 'W' || s === 'WORK' || s === 'EMPLOYMENT') return 'WORK';
  if (s === 'E' || s === 'STUDENT' || s === 'EDUCATIONAL' || s === 'SCHOOL') return 'STUDENT';
  if (s === 'I' || s === 'INCARCERATED') return 'INCARCERATED';
  return s || 'OTHER';
}

function deriveTypeFromLocation(loc: NsopwLocation): string {
  const t = normLocationType(loc.type);
  if (t === 'WORK') return 'business';
  if (t === 'STUDENT') return 'educational';
  return 'residential';
}

// Lowercase + strip punctuation + collapse whitespace. Same shape as
// serveIntakeRecords.normAddr (which is private). Keeping a local copy
// keeps this module self-contained.
export function normalizeAddress(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[,.()'"`]/g, ' ')
    .replace(/[^a-z0-9\s#-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

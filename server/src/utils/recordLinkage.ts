// ============================================================
// RMPG Flex — NCIC Auto-Record Linkage
// ============================================================
// When NCIC/API searches return results, automatically create or
// update records in the local database (persons, vehicles, properties).
// Uses deduplication to avoid duplicate entries:
//   Persons: match on (first_name + last_name + DOB) or Enformion tahoeId
//   Vehicles: match on VIN or (plate_number + state)
//   Properties: match on normalized address
// All auto-linked records are tagged with source='ncic_auto'.

import { getDb } from '../models/database';
import { localNow } from './timeUtils';
import type { UgrcBusinessResult, UgrcAddressResult, UgrcParcelResult } from './geocode';

// ── Person Linkage ───────────────────────────────────────────

interface PersonInput {
  firstName: string;
  middleName?: string;
  lastName: string;
  dob?: string;       // YYYY-MM-DD or MMDDYYYY
  gender?: string;
  race?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  phone?: string;
  email?: string;
  tahoeId?: string;    // Enformion ID
  source: string;      // e.g., 'enformion', 'criminal_checks', 'utah_dld'
}

interface LinkResult {
  action: 'created' | 'updated' | 'skipped';
  personId?: number;
  vehicleId?: number;
  propertyId?: number;
  reason?: string;
}

/**
 * Normalize a DOB string to YYYY-MM-DD format.
 * Handles: "03/15/1985", "03151985", "1985-03-15"
 */
function normalizeDob(dob: string | undefined): string | null {
  if (!dob) return null;
  const cleaned = dob.replace(/[^0-9]/g, '');

  // MMDDYYYY format
  if (cleaned.length === 8 && parseInt(cleaned.slice(0, 2)) <= 12) {
    return `${cleaned.slice(4, 8)}-${cleaned.slice(0, 2)}-${cleaned.slice(2, 4)}`;
  }

  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(dob)) return dob;

  // MM/DD/YYYY
  const parts = dob.split('/');
  if (parts.length === 3) {
    return `${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;
  }

  return dob; // Return as-is if unrecognized
}

/**
 * Link a person from an NCIC query result into the persons table.
 * Deduplicates by (first_name + last_name + DOB) or tahoeId.
 * Returns the linked person ID and whether it was created or updated.
 */
export function linkPerson(input: PersonInput): LinkResult {
  const db = getDb();
  const now = localNow();
  const first = (input.firstName || '').trim();
  const last = (input.lastName || '').trim();

  if (!first || !last) return { action: 'skipped', reason: 'Missing first/last name' };

  const dob = normalizeDob(input.dob);

  try {
    // 1. Try match by Enformion tahoeId (most specific)
    if (input.tahoeId) {
      const byTahoe = db.prepare(
        `SELECT id FROM persons WHERE enformion_tahoe_id = ?`
      ).get(input.tahoeId) as any;

      if (byTahoe) {
        // Update existing record
        updatePerson(db, byTahoe.id, input, dob, now);
        return { action: 'updated', personId: byTahoe.id };
      }
    }

    // 2. Try match by (first_name + last_name + DOB)
    if (dob) {
      const byNameDob = db.prepare(
        `SELECT id FROM persons WHERE LOWER(first_name) = LOWER(?) AND LOWER(last_name) = LOWER(?) AND dob = ?`
      ).get(first, last, dob) as any;

      if (byNameDob) {
        updatePerson(db, byNameDob.id, input, dob, now);
        return { action: 'updated', personId: byNameDob.id };
      }
    }

    // 3. Try fuzzy match by (first_name + last_name) — only update, don't create
    const byName = db.prepare(
      `SELECT id, dob FROM persons WHERE LOWER(first_name) = LOWER(?) AND LOWER(last_name) = LOWER(?) LIMIT 1`
    ).get(first, last) as any;

    if (byName && !byName.dob && dob) {
      // Existing record with no DOB — safe to update
      updatePerson(db, byName.id, input, dob, now);
      return { action: 'updated', personId: byName.id };
    }

    // 4. Create new person record
    const result = db.prepare(`
      INSERT INTO persons (
        first_name, last_name, middle_name, dob, gender, race,
        address, city, state, zip, phone, email,
        source, enformion_tahoe_id, last_ncic_query_at, ncic_query_count,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `).run(
      first, last, input.middleName || null, dob, input.gender || null, input.race || null,
      input.address || null, input.city || null, input.state || null, input.zip || null,
      input.phone || null, input.email || null,
      `ncic_${input.source}`, input.tahoeId || null, now, now,
    );

    console.log(`[linkage] Created person #${result.lastInsertRowid}: ${first} ${last} (source: ${input.source})`);
    return { action: 'created', personId: result.lastInsertRowid as number };
  } catch (err) {
    console.error('[linkage] Error linking person:', err);
    return { action: 'skipped', reason: 'Database error' };
  }
}

function updatePerson(db: any, id: number, input: PersonInput, dob: string | null, now: string) {
  // Only update fields that are currently empty in the existing record
  const existing = db.prepare('SELECT * FROM persons WHERE id = ?').get(id) as any;
  if (!existing) return;

  const updates: string[] = [];
  const values: any[] = [];

  const maybeSet = (col: string, newVal: string | undefined | null) => {
    if (newVal && !existing[col]) {
      updates.push(`${col} = ?`);
      values.push(newVal);
    }
  };

  maybeSet('middle_name', input.middleName);
  maybeSet('dob', dob);
  maybeSet('gender', input.gender);
  maybeSet('race', input.race);
  maybeSet('address', input.address);
  maybeSet('city', input.city);
  maybeSet('state', input.state);
  maybeSet('zip', input.zip);
  maybeSet('phone', input.phone);
  maybeSet('email', input.email);
  maybeSet('enformion_tahoe_id', input.tahoeId);

  // Always update query metadata
  updates.push('last_ncic_query_at = ?');
  values.push(now);
  updates.push('ncic_query_count = COALESCE(ncic_query_count, 0) + 1');

  if (updates.length > 0) {
    values.push(id);
    db.prepare(`UPDATE persons SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    console.log(`[linkage] Updated person #${id}: ${input.firstName} ${input.lastName}`);
  }
}

// ── Vehicle Linkage ──────────────────────────────────────────

interface VehicleInput {
  vin?: string;
  plateNumber?: string;
  plateState?: string;
  make?: string;
  model?: string;
  year?: number;
  color?: string;
  ownerName?: string;     // Will try to link to persons table
  source: string;
}

/**
 * Link a vehicle from NCIC query results into vehicles_records.
 * Deduplicates by VIN (gold standard) or (plate_number + state).
 */
export function linkVehicle(input: VehicleInput): LinkResult {
  const db = getDb();
  const now = localNow();

  if (!input.vin && !input.plateNumber) {
    return { action: 'skipped', reason: 'No VIN or plate number' };
  }

  try {
    // 1. Match by VIN
    if (input.vin) {
      const byVin = db.prepare(
        `SELECT id FROM vehicles_records WHERE UPPER(vin) = UPPER(?)`
      ).get(input.vin) as any;

      if (byVin) {
        updateVehicle(db, byVin.id, input, now);
        return { action: 'updated', vehicleId: byVin.id };
      }
    }

    // 2. Match by plate + state
    if (input.plateNumber && input.plateState) {
      const byPlate = db.prepare(
        `SELECT id FROM vehicles_records WHERE UPPER(plate_number) = UPPER(?) AND UPPER(state) = UPPER(?)`
      ).get(input.plateNumber, input.plateState) as any;

      if (byPlate) {
        updateVehicle(db, byPlate.id, input, now);
        return { action: 'updated', vehicleId: byPlate.id };
      }
    }

    // 3. Create new vehicle record
    const result = db.prepare(`
      INSERT INTO vehicles_records (
        vin, plate_number, state, make, model, year, color,
        source, last_ncic_query_at, ncic_query_count, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `).run(
      input.vin || null, input.plateNumber || null, input.plateState || null,
      input.make || null, input.model || null, input.year || null, input.color || null,
      `ncic_${input.source}`, now, now,
    );

    console.log(`[linkage] Created vehicle #${result.lastInsertRowid}: ${input.vin || input.plateNumber} (source: ${input.source})`);
    return { action: 'created', vehicleId: result.lastInsertRowid as number };
  } catch (err) {
    console.error('[linkage] Error linking vehicle:', err);
    return { action: 'skipped', reason: 'Database error' };
  }
}

function updateVehicle(db: any, id: number, input: VehicleInput, now: string) {
  const existing = db.prepare('SELECT * FROM vehicles_records WHERE id = ?').get(id) as any;
  if (!existing) return;

  const updates: string[] = [];
  const values: any[] = [];

  const maybeSet = (col: string, newVal: any) => {
    if (newVal !== undefined && newVal !== null && !existing[col]) {
      updates.push(`${col} = ?`);
      values.push(newVal);
    }
  };

  maybeSet('vin', input.vin);
  maybeSet('plate_number', input.plateNumber);
  maybeSet('state', input.plateState);
  maybeSet('make', input.make);
  maybeSet('model', input.model);
  maybeSet('year', input.year);
  maybeSet('color', input.color);

  updates.push('last_ncic_query_at = ?');
  values.push(now);
  updates.push('ncic_query_count = COALESCE(ncic_query_count, 0) + 1');

  if (updates.length > 0) {
    values.push(id);
    db.prepare(`UPDATE vehicles_records SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    console.log(`[linkage] Updated vehicle #${id}`);
  }
}

// ── Address/Property Linkage ─────────────────────────────────

interface AddressInput {
  address: string;
  city?: string;
  state?: string;
  zip?: string;
  latitude?: number;
  longitude?: number;
  source: string;
}

/**
 * Normalize an address for comparison (lowercase, remove apt/suite, trim).
 */
function normalizeAddress(addr: string): string {
  return addr.toLowerCase()
    .replace(/\b(apt|suite|ste|unit|#)\s*\S+/gi, '')
    .replace(/[.,]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Link an address from NCIC results into the properties table.
 * Requires an NCIC Auto-Import system client (created lazily).
 */
export function linkAddress(input: AddressInput): LinkResult {
  const db = getDb();
  const now = localNow();

  if (!input.address || input.address.trim().length < 5) {
    return { action: 'skipped', reason: 'Address too short or missing' };
  }

  const normalized = normalizeAddress(input.address);

  try {
    // Check for existing property with similar address
    const existing = db.prepare(`
      SELECT id, address FROM properties ORDER BY id DESC LIMIT 500
    `).all() as any[];

    for (const prop of existing) {
      if (normalizeAddress(prop.address) === normalized) {
        // Update coordinates if we have them and property doesn't
        if (input.latitude && input.longitude) {
          const current = db.prepare('SELECT latitude, longitude FROM properties WHERE id = ?').get(prop.id) as any;
          if (!current.latitude || !current.longitude) {
            db.prepare('UPDATE properties SET latitude = ?, longitude = ?, last_ncic_query_at = ? WHERE id = ?')
              .run(input.latitude, input.longitude, now, prop.id);
          }
        }
        return { action: 'updated', propertyId: prop.id };
      }
    }

    // Get or create the "NCIC Auto-Import" system client
    const clientId = getAutoImportClientId(db, now);

    // Build full address
    let fullAddr = input.address;
    if (input.city) fullAddr += `, ${input.city}`;
    if (input.state) fullAddr += `, ${input.state}`;
    if (input.zip) fullAddr += ` ${input.zip}`;

    const result = db.prepare(`
      INSERT INTO properties (
        client_id, name, address, latitude, longitude, property_type,
        source, last_ncic_query_at, created_at
      ) VALUES (?, ?, ?, ?, ?, 'residential', ?, ?, ?)
    `).run(
      clientId, `NCIC Import: ${input.address}`, fullAddr,
      input.latitude || null, input.longitude || null,
      `ncic_${input.source}`, now, now,
    );

    console.log(`[linkage] Created property #${result.lastInsertRowid}: ${fullAddr}`);
    return { action: 'created', propertyId: result.lastInsertRowid as number };
  } catch (err) {
    console.error('[linkage] Error linking address:', err);
    return { action: 'skipped', reason: 'Database error' };
  }
}

// Lazily create the NCIC Auto-Import system client
let _autoImportClientId: number | null = null;

function getAutoImportClientId(db: any, now: string): number {
  if (_autoImportClientId) return _autoImportClientId;

  const existing = db.prepare(
    `SELECT id FROM clients WHERE name = 'NCIC Auto-Import'`
  ).get() as any;

  if (existing) {
    _autoImportClientId = existing.id;
    return existing.id;
  }

  const result = db.prepare(`
    INSERT INTO clients (name, contact_name, contact_email, status, notes, created_at)
    VALUES ('NCIC Auto-Import', 'System', 'system@rmpgflex.local', 'active',
            'System client for auto-imported properties from NCIC queries', ?)
  `).run(now);

  _autoImportClientId = result.lastInsertRowid as number;
  console.log(`[linkage] Created NCIC Auto-Import client #${_autoImportClientId}`);
  return _autoImportClientId;
}

// ── Batch Linkage from API Results ───────────────────────────

/**
 * Process Enformion person search results and link all data.
 * Called after a successful QI or QH query.
 */
export function linkEnformionResults(persons: any[]): { persons: number; addresses: number; phones: number } {
  let personCount = 0;
  let addressCount = 0;
  let phoneCount = 0;

  for (const p of persons) {
    // Link person
    const personResult = linkPerson({
      firstName: p.firstName || '',
      middleName: p.middleName || '',
      lastName: p.lastName || '',
      dob: p.dob || undefined,
      phone: p.phones?.[0]?.number || undefined,
      email: p.emails?.[0] || undefined,
      address: p.addresses?.[0]?.addressLine1 || undefined,
      city: p.addresses?.[0]?.city || undefined,
      state: p.addresses?.[0]?.state || undefined,
      zip: p.addresses?.[0]?.zip || undefined,
      tahoeId: p.tahoeId || undefined,
      source: 'enformion',
    });
    if (personResult.action !== 'skipped') personCount++;

    // Link addresses
    for (const addr of (p.addresses || [])) {
      if (addr.addressLine1) {
        const addrResult = linkAddress({
          address: addr.addressLine1,
          city: addr.city,
          state: addr.state,
          zip: addr.zip,
          latitude: addr.latitude,
          longitude: addr.longitude,
          source: 'enformion',
        });
        if (addrResult.action !== 'skipped') addressCount++;
      }
    }

    phoneCount += (p.phones || []).length;
  }

  return { persons: personCount, addresses: addressCount, phones: phoneCount };
}

/**
 * Process NHTSA VIN decode results and link vehicle data.
 */
export function linkNhtsaResults(vinData: any, vin: string): LinkResult {
  if (!vinData) return { action: 'skipped', reason: 'No VIN data' };

  return linkVehicle({
    vin: vin,
    make: vinData.make || undefined,
    model: vinData.model || undefined,
    year: vinData.year ? parseInt(vinData.year) : undefined,
    source: 'nhtsa',
  });
}

/**
 * Process Criminal Checks results and link person data.
 */
export function linkCriminalResults(records: any[]): number {
  let linked = 0;
  for (const r of records) {
    const result = linkPerson({
      firstName: r.first_name || r.firstName || '',
      lastName: r.last_name || r.lastName || '',
      dob: r.dob || r.date_of_birth || undefined,
      address: r.address || undefined,
      city: r.city || undefined,
      state: r.state || undefined,
      source: 'criminal_checks',
    });
    if (result.action !== 'skipped') linked++;
  }
  return linked;
}

// ── UGRC SGID Linkage ────────────────────────────────────────
// Import Utah business, address, and parcel data into Properties.
// Uses strong dedup: ugrc_address_id, parcel_id, normalized address.

/**
 * Link UGRC business search results into the properties table.
 * Deduplicates by normalized (name + city) or normalized address.
 * Creates properties with type='commercial'.
 */
export function linkUgrcBusinessResults(
  results: UgrcBusinessResult[],
): { created: number; updated: number; skipped: number } {
  const db = getDb();
  const now = localNow();
  let created = 0, updated = 0, skipped = 0;

  const clientId = getAutoImportClientId(db, now);

  // Pre-load existing properties for dedup (address → id)
  const existingProps = db.prepare(
    `SELECT id, name, address, phone, website, business_category FROM properties`
  ).all() as any[];

  const addrIndex = new Map<string, any>();
  const nameIndex = new Map<string, any>();
  for (const p of existingProps) {
    if (p.address) addrIndex.set(normalizeAddress(p.address), p);
    if (p.name) nameIndex.set(p.name.toLowerCase().trim(), p);
  }

  // Track what we create in this batch to prevent intra-batch duplicates
  const batchAddrs = new Set<string>();

  for (const biz of results) {
    if (!biz.name || biz.name.trim().length < 2) { skipped++; continue; }

    const addr = biz.ugrc_addr || biz.osm_addr || '';
    const fullAddr = addr
      ? `${addr}${biz.city ? ', ' + biz.city : ''}${biz.zip ? ', UT ' + biz.zip : ', UT'}`
      : '';
    const normAddr = fullAddr ? normalizeAddress(fullAddr) : '';
    const normName = biz.name.toLowerCase().trim();

    // Skip if we already imported this in the current batch
    const batchKey = normAddr || normName;
    if (batchAddrs.has(batchKey)) { skipped++; continue; }

    // Dedup: check by address first, then by name
    let match = normAddr ? addrIndex.get(normAddr) : undefined;
    if (!match) match = nameIndex.get(normName);

    if (match) {
      // Update empty fields only — never overwrite existing data
      const updates: string[] = [];
      const values: any[] = [];
      const maybeSet = (col: string, val: any) => {
        if (val !== undefined && val !== null && val !== '' && !match[col]) {
          updates.push(`${col} = ?`);
          values.push(val);
        }
      };
      maybeSet('phone', biz.phone);
      maybeSet('website', biz.website);
      maybeSet('business_category', biz.category || biz.amenity || biz.shop);
      if (updates.length > 0) {
        values.push(match.id);
        db.prepare(`UPDATE properties SET ${updates.join(', ')} WHERE id = ?`).run(...values);
      }
      updated++;
    } else {
      // Create new commercial property
      db.prepare(`
        INSERT INTO properties (
          client_id, name, address, latitude, longitude, property_type,
          phone, website, business_category,
          county, source, last_ncic_query_at, created_at
        ) VALUES (?, ?, ?, ?, ?, 'commercial', ?, ?, ?, 'UT', ?, ?, ?)
      `).run(
        clientId,
        biz.name.trim(),
        fullAddr || biz.name.trim(),
        biz.lat || null,
        biz.lon || null,
        biz.phone || null,
        biz.website || null,
        biz.category || biz.amenity || biz.shop || null,
        'ncic_ugrc_business',
        now,
        now,
      );
      created++;
    }

    batchAddrs.add(batchKey);
  }

  console.log(`[linkage/ugrc] Businesses: ${created} created, ${updated} updated, ${skipped} skipped`);
  return { created, updated, skipped };
}

/**
 * Link UGRC address point search results into the properties table.
 * Deduplicates by ugrc_address_id (utaddptid) or normalized address.
 * Creates properties with type='residential'.
 */
export function linkUgrcAddressResults(
  results: UgrcAddressResult[],
): { created: number; updated: number; skipped: number } {
  const db = getDb();
  const now = localNow();
  let created = 0, updated = 0, skipped = 0;

  const clientId = getAutoImportClientId(db, now);

  // Pre-load indexes for fast dedup
  const byUgrcId = new Map<string, any>();
  const byAddr = new Map<string, any>();
  const existingProps = db.prepare(
    `SELECT id, address, ugrc_address_id, parcel_id, county, zip FROM properties`
  ).all() as any[];
  for (const p of existingProps) {
    if (p.ugrc_address_id) byUgrcId.set(p.ugrc_address_id, p);
    if (p.address) byAddr.set(normalizeAddress(p.address), p);
  }

  const batchIds = new Set<string>();

  for (const addr of results) {
    if (!addr.fulladd || addr.fulladd.trim().length < 3) { skipped++; continue; }

    const utId = addr.utaddptid || '';
    const fullAddr = `${addr.fulladd}, ${addr.city || ''}, UT${addr.zipcode ? ' ' + addr.zipcode : ''}`;
    const normAddr = normalizeAddress(fullAddr);

    // Intra-batch dedup
    const batchKey = utId || normAddr;
    if (batchIds.has(batchKey)) { skipped++; continue; }

    // Cross-check: UGRC ID first (most specific), then address
    let match = utId ? byUgrcId.get(utId) : undefined;
    if (!match) match = byAddr.get(normAddr);

    // Resolve county from FIPS code
    const countyName = addr.countyid ? resolveCountyFromFips(addr.countyid) : null;

    // Extract lat/lng from geometry if present
    let lat: number | null = null;
    let lng: number | null = null;
    if (addr._geometry && typeof addr._geometry === 'object') {
      if (addr._geometry.y) lat = addr._geometry.y;
      if (addr._geometry.x) lng = addr._geometry.x;
    }

    if (match) {
      // Enrich existing record — fill empty fields only
      const updates: string[] = [];
      const values: any[] = [];
      const maybeSet = (col: string, val: any) => {
        if (val !== undefined && val !== null && val !== '' && !match[col]) {
          updates.push(`${col} = ?`);
          values.push(val);
        }
      };
      maybeSet('ugrc_address_id', utId);
      maybeSet('parcel_id', addr.parcelid);
      maybeSet('county', countyName);
      maybeSet('zip', addr.zipcode);
      if (lat && lng) {
        const cur = db.prepare('SELECT latitude, longitude FROM properties WHERE id = ?').get(match.id) as any;
        if (!cur.latitude) { updates.push('latitude = ?'); values.push(lat); }
        if (!cur.longitude) { updates.push('longitude = ?'); values.push(lng); }
      }
      if (updates.length > 0) {
        values.push(match.id);
        db.prepare(`UPDATE properties SET ${updates.join(', ')} WHERE id = ?`).run(...values);
      }
      updated++;
    } else {
      db.prepare(`
        INSERT INTO properties (
          client_id, name, address, latitude, longitude, property_type,
          city, state, zip, county, parcel_id, ugrc_address_id,
          source, last_ncic_query_at, created_at
        ) VALUES (?, ?, ?, ?, ?, 'residential', ?, 'UT', ?, ?, ?, ?, ?, ?, ?)
      `).run(
        clientId,
        `UGRC: ${addr.fulladd}`,
        fullAddr,
        lat, lng,
        addr.city || null,
        addr.zipcode || null,
        countyName,
        addr.parcelid || null,
        utId || null,
        'ncic_ugrc_address',
        now,
        now,
      );
      created++;
    }

    batchIds.add(batchKey);
  }

  console.log(`[linkage/ugrc] Addresses: ${created} created, ${updated} updated, ${skipped} skipped`);
  return { created, updated, skipped };
}

/**
 * Link UGRC parcel/tax data to existing or new properties.
 * Deduplicates by parcel_id or normalized address.
 * Enriches properties with tax/assessment data (acres, market value, etc.).
 */
export function linkUgrcParcelResults(
  results: UgrcParcelResult[],
): { created: number; updated: number; skipped: number } {
  const db = getDb();
  const now = localNow();
  let created = 0, updated = 0, skipped = 0;

  const clientId = getAutoImportClientId(db, now);

  // Build parcel_id and address indexes for fast dedup
  const byParcel = new Map<string, any>();
  const byAddr = new Map<string, any>();
  const existingProps = db.prepare(
    `SELECT id, address, parcel_id FROM properties`
  ).all() as any[];
  for (const p of existingProps) {
    if (p.parcel_id) byParcel.set(p.parcel_id.toUpperCase(), p);
    if (p.address) byAddr.set(normalizeAddress(p.address), p);
  }

  const batchParcels = new Set<string>();

  for (const parcel of results) {
    if (!parcel.parcel_id) { skipped++; continue; }

    const pid = parcel.parcel_id.toUpperCase();

    // Intra-batch dedup
    if (batchParcels.has(pid)) { skipped++; continue; }

    // Cross-check: parcel_id first, then address
    let match = byParcel.get(pid);
    if (!match && parcel.parcel_add) {
      const fullAddr = `${parcel.parcel_add}, ${parcel.parcel_city || ''}, UT`;
      match = byAddr.get(normalizeAddress(fullAddr));
    }

    // Extract lat/lng from geometry centroid
    let lat: number | null = null;
    let lng: number | null = null;
    if (parcel._geometry?.rings?.[0]) {
      // Compute centroid of polygon ring
      const ring = parcel._geometry.rings[0] as number[][];
      if (ring.length > 0) {
        let sumX = 0, sumY = 0;
        for (const pt of ring) { sumX += pt[0]; sumY += pt[1]; }
        lng = sumX / ring.length;
        lat = sumY / ring.length;
      }
    }

    if (match) {
      // Enrich existing property with parcel/tax data — fill empty fields only
      const existing = db.prepare('SELECT * FROM properties WHERE id = ?').get(match.id) as any;
      const updates: string[] = [];
      const values: any[] = [];
      const maybeSet = (col: string, val: any) => {
        if (val !== undefined && val !== null && val !== '' && !existing[col]) {
          updates.push(`${col} = ?`);
          values.push(val);
        }
      };
      maybeSet('parcel_id', parcel.parcel_id);
      maybeSet('parcel_serial', parcel.serial_num);
      maybeSet('parcel_acres', parcel.parcel_acres);
      maybeSet('total_market_value', parcel.total_mkt_value);
      maybeSet('land_market_value', parcel.land_mkt_value);
      maybeSet('building_sqft', parcel.bldg_sqft);
      maybeSet('year_built', parcel.built_yr);
      maybeSet('floors', parcel.floors_cnt);
      maybeSet('subdivision', parcel.subdiv_name);
      maybeSet('prop_class', parcel.prop_class);
      maybeSet('county', parcel.county_name);
      if (lat && lng && !existing.latitude) {
        updates.push('latitude = ?', 'longitude = ?');
        values.push(lat, lng);
      }
      if (updates.length > 0) {
        values.push(match.id);
        db.prepare(`UPDATE properties SET ${updates.join(', ')} WHERE id = ?`).run(...values);
      }
      updated++;
    } else {
      // No matching property — create a new one with parcel data
      const addr = parcel.parcel_add
        ? `${parcel.parcel_add}, ${parcel.parcel_city || ''}, UT`
        : `Parcel ${parcel.parcel_id}`;

      db.prepare(`
        INSERT INTO properties (
          client_id, name, address, latitude, longitude, property_type,
          county, parcel_id, parcel_serial, parcel_acres,
          total_market_value, land_market_value, building_sqft,
          year_built, floors, subdivision, prop_class,
          source, last_ncic_query_at, created_at
        ) VALUES (?, ?, ?, ?, ?, 'residential', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        clientId,
        `UGRC: ${parcel.parcel_add || parcel.parcel_id}`,
        addr,
        lat, lng,
        parcel.county_name || null,
        parcel.parcel_id,
        parcel.serial_num || null,
        parcel.parcel_acres || null,
        parcel.total_mkt_value || null,
        parcel.land_mkt_value || null,
        parcel.bldg_sqft || null,
        parcel.built_yr || null,
        parcel.floors_cnt || null,
        parcel.subdiv_name || null,
        parcel.prop_class || null,
        'ncic_ugrc_parcel',
        now,
        now,
      );
      created++;
    }

    batchParcels.add(pid);
  }

  console.log(`[linkage/ugrc] Parcels: ${created} created, ${updated} updated, ${skipped} skipped`);
  return { created, updated, skipped };
}

// ── Duplicate Cleanup ────────────────────────────────────────

/**
 * Resolve county name from FIPS code (2-digit string).
 * Uses first two digits of the county ID if it's longer.
 */
function resolveCountyFromFips(fipsCode: string): string | null {
  const FIPS_TO_COUNTY: Record<string, string> = {
    '49001': 'Beaver', '49003': 'Box Elder', '49005': 'Cache',
    '49007': 'Carbon', '49009': 'Daggett', '49011': 'Davis',
    '49013': 'Duchesne', '49015': 'Emery', '49017': 'Garfield',
    '49019': 'Grand', '49021': 'Iron', '49023': 'Juab',
    '49025': 'Kane', '49027': 'Millard', '49029': 'Morgan',
    '49031': 'Piute', '49033': 'Rich', '49035': 'Salt Lake',
    '49037': 'San Juan', '49039': 'Sanpete', '49041': 'Sevier',
    '49043': 'Summit', '49045': 'Tooele', '49047': 'Uintah',
    '49049': 'Utah', '49051': 'Wasatch', '49053': 'Washington',
    '49055': 'Wayne', '49057': 'Weber',
  };
  // SGID countyid may be "49035" (FIPS) or just "35"
  const code = fipsCode.padStart(5, '49000'.slice(0, 5 - fipsCode.length));
  const padded = fipsCode.length <= 3 ? `49${fipsCode.padStart(3, '0')}` : fipsCode;
  return FIPS_TO_COUNTY[padded] || FIPS_TO_COUNTY[code] || null;
}

/**
 * Remove duplicate property records from the database.
 * Keeps the oldest record (lowest ID) and merges data from duplicates
 * before deleting them. Matches by normalized address.
 *
 * Call this periodically or after bulk imports.
 */
export function deduplicateProperties(): { merged: number; deleted: number } {
  const db = getDb();
  let merged = 0, deleted = 0;

  try {
    const allProps = db.prepare(
      `SELECT * FROM properties ORDER BY id ASC`
    ).all() as any[];

    // Group by normalized address
    const groups = new Map<string, any[]>();
    for (const p of allProps) {
      if (!p.address) continue;
      const key = normalizeAddress(p.address);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(p);
    }

    const deleteStmt = db.prepare('DELETE FROM properties WHERE id = ?');

    for (const [, props] of groups) {
      if (props.length <= 1) continue;

      // Keep the first (oldest) record, merge data from others
      const keeper = props[0];
      const updates: string[] = [];
      const values: any[] = [];

      for (let i = 1; i < props.length; i++) {
        const dupe = props[i];
        // Merge any non-null fields from the dupe into the keeper
        for (const col of Object.keys(dupe)) {
          if (col === 'id' || col === 'created_at' || col === 'client_id') continue;
          if (dupe[col] && !keeper[col]) {
            updates.push(`${col} = ?`);
            values.push(dupe[col]);
            keeper[col] = dupe[col]; // Track merged value
          }
        }
        // Delete the duplicate
        deleteStmt.run(dupe.id);
        deleted++;
      }

      if (updates.length > 0) {
        values.push(keeper.id);
        db.prepare(`UPDATE properties SET ${updates.join(', ')} WHERE id = ?`).run(...values);
        merged++;
      }
    }

    console.log(`[linkage] Dedup properties: ${merged} merged, ${deleted} deleted`);
  } catch (err) {
    console.error('[linkage] Error deduplicating properties:', err);
  }

  return { merged, deleted };
}

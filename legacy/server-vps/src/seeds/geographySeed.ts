// Idempotent geography seed.
//
// Reads the three Utah GeoJSON files from client/public/geojson and
// populates dispatch_areas, dispatch_sectors, dispatch_zones, and
// dispatch_beats in one atomic transaction.
//
// Runs only when all 4 tables are empty. Safe to call on every boot —
// the empty-guard makes repeated calls no-ops.
//
// Order: areas (6) → sectors (29) → zones (~287) → beats (719).

import { readFileSync } from 'fs';
import { join } from 'path';
import type Database from 'better-sqlite3';
import {
  UTAH_AOG_REGIONS,
  COUNTY_TO_AOG,
  SECTOR_CODE_OVERRIDES,
  type AogRegionKey,
} from './data/utahAogRegions';

interface GeoJsonFeature {
  type: 'Feature';
  properties: Record<string, unknown>;
  geometry: unknown;
}

interface GeoJsonCollection {
  type: 'FeatureCollection';
  features: GeoJsonFeature[];
}

function readGeoJson(dir: string, filename: string): GeoJsonCollection {
  const path = join(dir, filename);
  return JSON.parse(readFileSync(path, 'utf8')) as GeoJsonCollection;
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w.length ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}

function sectorCodeFor(countyName: string): string {
  const upper = countyName.toUpperCase().trim();
  if (SECTOR_CODE_OVERRIDES[upper]) return SECTOR_CODE_OVERRIDES[upper];
  // Default fallback: first 3 letters, alpha only, uppercased
  return upper.replace(/[^A-Z]/g, '').slice(0, 3);
}

export interface SeedCounts {
  areas: number;
  sectors: number;
  zones: number;
  beats: number;
  orphan_beats: number;
}

export function seedGeographyFromGeoJSON(
  db: Database.Database,
  geojsonDir: string,
): SeedCounts | null {
  // Idempotency guard — only run if all 4 tables are empty
  const counts = {
    areas: (db.prepare('SELECT COUNT(*) as n FROM dispatch_areas').get() as { n: number }).n,
    sectors: (db.prepare('SELECT COUNT(*) as n FROM dispatch_sectors').get() as { n: number }).n,
    zones: (db.prepare('SELECT COUNT(*) as n FROM dispatch_zones').get() as { n: number }).n,
    beats: (db.prepare('SELECT COUNT(*) as n FROM dispatch_beats').get() as { n: number }).n,
  };
  if (counts.areas > 0 || counts.sectors > 0 || counts.zones > 0 || counts.beats > 0) {
    console.log('[geography-seed] Skipping — tables not all empty:', counts);
    return null;
  }

  let counties: GeoJsonCollection;
  let municipalities: GeoJsonCollection;
  let beats: GeoJsonCollection;
  try {
    counties = readGeoJson(geojsonDir, 'county.geojson');
    municipalities = readGeoJson(geojsonDir, 'municipality.geojson');
    beats = readGeoJson(geojsonDir, 'beat.geojson');
  } catch (err) {
    console.log('[geography-seed] Could not read GeoJSON files from', geojsonDir, ':', (err as Error).message);
    return null;
  }

  const insertArea = db.prepare(
    'INSERT INTO dispatch_areas (area_code, area_name, color, sort_order) VALUES (?, ?, ?, ?)',
  );
  const insertSector = db.prepare(
    `INSERT INTO dispatch_sectors
       (sector_code, sector_name, area_id, county_nbr, fips_code, color, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertZone = db.prepare(
    `INSERT INTO dispatch_zones
       (zone_code, zone_name, sector_id, zone_type, ugrc_code, population_estimate, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertBeat = db.prepare(
    `INSERT INTO dispatch_beats
       (beat_code, beat_name, beat_descriptor, zone_id, district_letter, beat_number, dispatch_code, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  let orphanBeats = 0;

  const tx = db.transaction(() => {
    // ── Step 1: Areas ──
    const areaIdByCode = new Map<AogRegionKey, number>();
    for (const [key, region] of Object.entries(UTAH_AOG_REGIONS) as [
      AogRegionKey,
      (typeof UTAH_AOG_REGIONS)[AogRegionKey],
    ][]) {
      const r = insertArea.run(key, region.name, region.color, region.sort_order);
      areaIdByCode.set(key, r.lastInsertRowid as number);
    }

    // ── Step 2: Sectors (from county.geojson) ──
    const sectorIdByCountyNbr = new Map<string, number>();
    const sectorIdBySectorCode = new Map<string, number>();
    let sectorOrder = 0;
    for (const f of counties.features) {
      const p = (f.properties || {}) as Record<string, unknown>;
      const countyName = String(p.NAME || '').toUpperCase().trim();
      if (!countyName) continue;
      const sectorCode = sectorCodeFor(countyName);
      const areaKey = COUNTY_TO_AOG[countyName];
      const areaId = areaKey ? areaIdByCode.get(areaKey) ?? null : null;
      const countyNbr = String(p.COUNTYNBR || '');
      const fipsCode = String(p.FIPS_STR || '');
      const result = insertSector.run(
        sectorCode,
        titleCase(countyName) + ' County',
        areaId,
        countyNbr,
        fipsCode,
        '#808080',
        ++sectorOrder,
      );
      const sectorId = result.lastInsertRowid as number;
      sectorIdByCountyNbr.set(countyNbr, sectorId);
      sectorIdBySectorCode.set(sectorCode, sectorId);
    }

    // ── Step 3a: Municipalities → zones ──
    // NOTE: municipality.geojson has a few duplicate city_code values (e.g.
    // CL2, MI2, SA2) where a municipality spans multiple counties. We dedupe
    // by keeping the first occurrence per city_code. Dupes with different
    // COUNTYNBR get their zone_code suffixed with `-<COUNTYNBR>` so they
    // remain distinct rows but don't collide on the UNIQUE index.
    const zoneIdByCityCode = new Map<string, number>();
    let zoneOrder = 0;
    const seenCityCodes = new Map<string, string>(); // city_code -> county_nbr of first insert
    for (const f of municipalities.features) {
      const p = (f.properties || {}) as Record<string, unknown>;
      const rawCityCode = String(p.city_code || '').trim();
      if (!rawCityCode) continue;
      const countyNbr = String(p.COUNTYNBR || '');
      let zoneCode = rawCityCode;
      // If this city_code was already inserted for a different county, suffix it
      if (seenCityCodes.has(rawCityCode)) {
        const existingCounty = seenCityCodes.get(rawCityCode);
        if (existingCounty === countyNbr) continue; // exact duplicate — skip
        zoneCode = `${rawCityCode}-${countyNbr}`;
      }
      seenCityCodes.set(rawCityCode, countyNbr);
      const sectorId = sectorIdByCountyNbr.get(countyNbr) ?? null;
      const popLast = Number(p.POPLASTESTIMATE) || null;
      const result = insertZone.run(
        zoneCode,
        String(p.NAME || zoneCode),
        sectorId,
        'municipality',
        String(p.UGRCODE || '') || null,
        popLast,
        ++zoneOrder,
      );
      const zoneId = result.lastInsertRowid as number;
      zoneIdByCityCode.set(zoneCode, zoneId);
      // Also register the unsuffixed rawCityCode → the FIRST zone for beat lookup
      if (!zoneIdByCityCode.has(rawCityCode)) {
        zoneIdByCityCode.set(rawCityCode, zoneId);
      }
    }

    // ── Step 3b: Synthetic unincorporated zones ──
    // For each beat whose city_code doesn't match a municipality, create a
    // synthetic unincorporated zone for the matching sector.
    const unmatchedBeatCityCodes = new Set<string>();
    for (const f of beats.features) {
      const p = (f.properties || {}) as Record<string, unknown>;
      const cityCode = String(p.city_code || '').trim();
      if (cityCode && !zoneIdByCityCode.has(cityCode)) {
        unmatchedBeatCityCodes.add(cityCode);
      }
    }

    for (const cityCode of unmatchedBeatCityCodes) {
      // Try to match cityCode to a sector by prefix
      let sectorId: number | null = null;
      for (const [sCode, sId] of sectorIdBySectorCode) {
        if (cityCode === sCode || cityCode.startsWith(sCode + '-') || cityCode.startsWith(sCode)) {
          sectorId = sId;
          break;
        }
      }
      const zoneCode = cityCode;
      if (zoneIdByCityCode.has(zoneCode)) continue;
      const zoneName = cityCode.includes('UNINC')
        ? titleCase(cityCode.replace(/_/g, ' ').replace(/-/g, ' '))
        : `${cityCode} Unincorporated`;
      const result = insertZone.run(
        zoneCode,
        zoneName,
        sectorId,
        'unincorporated',
        null,
        null,
        ++zoneOrder,
      );
      zoneIdByCityCode.set(cityCode, result.lastInsertRowid as number);
    }

    // ── Step 4: Beats ──
    // NOTE: beat.geojson has 14 duplicate beat_code values where the same
    // beat code appears in two counties (cross-county municipalities like
    // CL2, MI2, SA2). We suffix the second occurrence with the county_nbr
    // to keep rows distinct.
    let beatOrder = 0;
    const seenBeatCodes = new Set<string>();
    for (const f of beats.features) {
      const p = (f.properties || {}) as Record<string, unknown>;
      const rawBeatCode = String(p.beat_code || p.beat_id || '').trim();
      if (!rawBeatCode) continue;
      // Dedupe on beat_code — suffix if already seen
      let beatCode = rawBeatCode;
      if (seenBeatCodes.has(rawBeatCode)) {
        // Second+ occurrence — suffix with a counter so the UNIQUE index holds
        let suffix = 2;
        while (seenBeatCodes.has(`${rawBeatCode}-${suffix}`)) suffix++;
        beatCode = `${rawBeatCode}-${suffix}`;
      }
      seenBeatCodes.add(beatCode);

      const cityCode = String(p.city_code || '').trim();
      const district = String(p.district_letter || '');
      const num = Number(p.beat_number) || 0;
      const zoneId = zoneIdByCityCode.get(cityCode) ?? null;
      if (!zoneId) orphanBeats++;
      const cityName = String(p.city || cityCode);
      const beatName = num > 0 ? `${cityName} ${district}-${num}` : cityName;
      insertBeat.run(
        beatCode,
        beatName,
        beatName,
        zoneId,
        district || null,
        num || null,
        `${cityCode}-${district}${num}`,
        ++beatOrder,
      );
    }
  });
  tx();

  const finalCounts: SeedCounts = {
    areas: (db.prepare('SELECT COUNT(*) as n FROM dispatch_areas').get() as { n: number }).n,
    sectors: (db.prepare('SELECT COUNT(*) as n FROM dispatch_sectors').get() as { n: number }).n,
    zones: (db.prepare('SELECT COUNT(*) as n FROM dispatch_zones').get() as { n: number }).n,
    beats: (db.prepare('SELECT COUNT(*) as n FROM dispatch_beats').get() as { n: number }).n,
    orphan_beats: orphanBeats,
  };
  console.log('[geography-seed] Seeded:', finalCounts);
  return finalCounts;
}

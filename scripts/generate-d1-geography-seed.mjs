#!/usr/bin/env node
// ============================================================
// RMPG Flex — D1 Geography Seed Generator
// ============================================================
// Reads the Utah GeoJSON files (county / municipality / beat) and
// emits a SQL migration that seeds dispatch_areas (6), dispatch_sectors
// (~29), dispatch_zones (~290), dispatch_beats (~720) with their MBR
// bounds (min/max lat/lng per beat).
//
// Output: migrations/0012_seed_geography.sql
//
// Why a build-time script (not a runtime seed)?
// The existing server/src/seeds/geographySeed.ts uses fs.readFileSync
// to load the GeoJSON files — Workers have no filesystem, so the seed
// can't run inside the Worker on boot. Generating SQL at build time and
// applying it via `wrangler d1 execute --remote --file` is the
// Cloudflare-native equivalent.
//
// Run once:
//   node scripts/generate-d1-geography-seed.mjs
//   npx wrangler d1 execute rmpg-flex --remote \
//       --file migrations/0012_seed_geography.sql
//
// Idempotent — emits CREATE-OR-IGNORE style INSERTs guarded by
// `WHERE NOT EXISTS (SELECT 1 FROM <table>)` so re-applying against a
// populated DB is a no-op. To force re-seed, manually `DELETE FROM
// dispatch_beats; DELETE FROM dispatch_zones; ...` first.
//
// Companion to PR #556 — closes the "production geography tables are
// empty" finding from the 2026-05-24 audit.
// ============================================================

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const GEOJSON_DIR = join(ROOT, 'client', 'public', 'geojson');
const OUT_FILE = join(ROOT, 'migrations', '0012_seed_geography.sql');

// ── AOG metadata (kept in sync with server/src/seeds/data/utahAogRegions.ts) ──
const UTAH_AOG_REGIONS = {
  BEAR_RIVER: { name: 'Bear River', counties: ['BOX ELDER', 'CACHE', 'RICH'], color: '#d4a017', sort_order: 1 },
  WASATCH_FRONT: { name: 'Wasatch Front', counties: ['WEBER', 'MORGAN', 'DAVIS', 'SALT LAKE', 'TOOELE', 'SUMMIT', 'UTAH', 'WASATCH'], color: '#a0a0a0', sort_order: 2 },
  SIX_COUNTY: { name: 'Six County', counties: ['JUAB', 'MILLARD', 'PIUTE', 'SANPETE', 'SEVIER', 'WAYNE'], color: '#888888', sort_order: 3 },
  UINTAH_BASIN: { name: 'Uintah Basin', counties: ['DAGGETT', 'DUCHESNE', 'UINTAH'], color: '#707070', sort_order: 4 },
  SOUTHEASTERN: { name: 'Southeastern', counties: ['CARBON', 'EMERY', 'GRAND', 'SAN JUAN'], color: '#5a5a5a', sort_order: 5 },
  FIVE_COUNTY: { name: 'Five County', counties: ['BEAVER', 'GARFIELD', 'IRON', 'KANE', 'WASHINGTON'], color: '#c8c8c8', sort_order: 6 },
};
const COUNTY_TO_AOG = {};
for (const [k, r] of Object.entries(UTAH_AOG_REGIONS)) {
  for (const c of r.counties) COUNTY_TO_AOG[c.toUpperCase()] = k;
}
const SECTOR_CODE_OVERRIDES = {
  'SAN JUAN': 'SJN', SANPETE: 'SNP', 'BOX ELDER': 'BXE', 'SALT LAKE': 'SLC', UINTAH: 'UNT', UTAH: 'UTC',
  CACHE: 'CCH', DAVIS: 'DVS', MILLARD: 'MLD', WASHINGTON: 'WSH', WEBER: 'WBR', JUAB: 'JUB',
  GARFIELD: 'GRF', RICH: 'RCH', CARBON: 'CRB', DAGGETT: 'DGT', BEAVER: 'BVR', SEVIER: 'SVR',
  GRAND: 'GRD', TOOELE: 'TOO', SUMMIT: 'SMT', PIUTE: 'PUT', IRON: 'IRN', EMERY: 'EMR',
  WAYNE: 'WYN', MORGAN: 'MRG', KANE: 'KNE', DUCHESNE: 'DCH', WASATCH: 'WSC',
};

// ── Helpers ──
const titleCase = (s) => s.toLowerCase().split(/\s+/).map(w => w ? w.charAt(0).toUpperCase() + w.slice(1) : w).join(' ');
const sectorCodeFor = (county) => {
  const u = county.toUpperCase().trim();
  return SECTOR_CODE_OVERRIDES[u] || u.replace(/[^A-Z]/g, '').slice(0, 3);
};
const sqlStr = (v) => v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`;
const sqlNum = (v) => v == null || Number.isNaN(v) ? 'NULL' : String(v);

// Walk arbitrary GeoJSON Polygon/MultiPolygon coordinates and update bounds.
function updateBounds(coords, b) {
  if (typeof coords[0] === 'number') {
    const [lng, lat] = coords;
    if (lat < b.minLat) b.minLat = lat;
    if (lat > b.maxLat) b.maxLat = lat;
    if (lng < b.minLng) b.minLng = lng;
    if (lng > b.maxLng) b.maxLng = lng;
    return;
  }
  for (const c of coords) updateBounds(c, b);
}
function computeMBR(geometry) {
  if (!geometry || !geometry.coordinates) return null;
  const b = { minLat: 90, maxLat: -90, minLng: 180, maxLng: -180 };
  updateBounds(geometry.coordinates, b);
  if (b.minLat > b.maxLat) return null;
  // Round to 6 decimal places (~10cm) to keep SQL compact
  return { min_lat: +b.minLat.toFixed(6), max_lat: +b.maxLat.toFixed(6), min_lng: +b.minLng.toFixed(6), max_lng: +b.maxLng.toFixed(6) };
}

// ── Load inputs ──
console.log('Reading GeoJSON…');
const counties = JSON.parse(readFileSync(join(GEOJSON_DIR, 'county.geojson'), 'utf8'));
const municipalities = JSON.parse(readFileSync(join(GEOJSON_DIR, 'municipality.geojson'), 'utf8'));
const beats = JSON.parse(readFileSync(join(GEOJSON_DIR, 'beat.geojson'), 'utf8'));
console.log(`  county.geojson:       ${counties.features.length} features`);
console.log(`  municipality.geojson: ${municipalities.features.length} features`);
console.log(`  beat.geojson:         ${beats.features.length} features`);

// ── Build rows in memory (deterministic IDs starting at 1) ──
const areaRows = [];   // {id, code, name, color, sort_order}
const sectorRows = []; // {id, code, name, area_id, county_nbr, fips, color, sort_order}
const zoneRows = [];   // {id, code, name, sector_id, zone_type, ugrc_code, pop, sort_order}
const beatRows = [];   // {id, code, name, descriptor, zone_id, district_letter, beat_number, dispatch_code, sort_order, min_lat, max_lat, min_lng, max_lng}

// Areas
const areaIdByCode = new Map();
{
  let id = 1;
  for (const [key, r] of Object.entries(UTAH_AOG_REGIONS)) {
    areaRows.push({ id, code: key, name: r.name, color: r.color, sort_order: r.sort_order });
    areaIdByCode.set(key, id);
    id++;
  }
}

// Sectors (one per county)
const sectorIdByCountyNbr = new Map();
const sectorIdBySectorCode = new Map();
{
  let id = 1;
  let order = 0;
  for (const f of counties.features) {
    const p = f.properties || {};
    const countyName = String(p.NAME || '').toUpperCase().trim();
    if (!countyName) continue;
    const sectorCode = sectorCodeFor(countyName);
    const areaKey = COUNTY_TO_AOG[countyName];
    const areaId = areaKey ? areaIdByCode.get(areaKey) : null;
    const countyNbr = String(p.COUNTYNBR || '');
    const fipsCode = String(p.FIPS_STR || '');
    sectorRows.push({
      id, code: sectorCode, name: titleCase(countyName) + ' County',
      area_id: areaId, county_nbr: countyNbr, fips: fipsCode,
      color: '#808080', sort_order: ++order,
    });
    sectorIdByCountyNbr.set(countyNbr, id);
    sectorIdBySectorCode.set(sectorCode, id);
    id++;
  }
}

// Zones — municipalities
const zoneIdByCityCode = new Map();
{
  let id = 1;
  let order = 0;
  const seen = new Map();
  for (const f of municipalities.features) {
    const p = f.properties || {};
    const rawCityCode = String(p.city_code || '').trim();
    if (!rawCityCode) continue;
    const countyNbr = String(p.COUNTYNBR || '');
    let zoneCode = rawCityCode;
    if (seen.has(rawCityCode)) {
      const existingCounty = seen.get(rawCityCode);
      if (existingCounty === countyNbr) continue;
      zoneCode = `${rawCityCode}-${countyNbr}`;
    }
    seen.set(rawCityCode, countyNbr);
    const sectorId = sectorIdByCountyNbr.get(countyNbr) ?? null;
    const popLast = Number(p.POPLASTESTIMATE) || null;
    zoneRows.push({
      id, code: zoneCode, name: String(p.NAME || zoneCode),
      sector_id: sectorId, zone_type: 'municipality',
      ugrc_code: String(p.UGRCODE || '') || null, pop: popLast,
      sort_order: ++order,
    });
    zoneIdByCityCode.set(zoneCode, id);
    if (!zoneIdByCityCode.has(rawCityCode)) zoneIdByCityCode.set(rawCityCode, id);
    id++;
  }

  // Synthetic unincorporated zones for unmatched beat city_codes
  const unmatched = new Set();
  for (const f of beats.features) {
    const c = String((f.properties || {}).city_code || '').trim();
    if (c && !zoneIdByCityCode.has(c)) unmatched.add(c);
  }
  for (const cityCode of unmatched) {
    let sectorId = null;
    for (const [sCode, sId] of sectorIdBySectorCode) {
      if (cityCode === sCode || cityCode.startsWith(sCode + '-') || cityCode.startsWith(sCode)) {
        sectorId = sId; break;
      }
    }
    if (zoneIdByCityCode.has(cityCode)) continue;
    const zoneName = cityCode.includes('UNINC')
      ? titleCase(cityCode.replace(/_/g, ' ').replace(/-/g, ' '))
      : `${cityCode} Unincorporated`;
    zoneRows.push({
      id, code: cityCode, name: zoneName,
      sector_id: sectorId, zone_type: 'unincorporated',
      ugrc_code: null, pop: null, sort_order: ++order,
    });
    zoneIdByCityCode.set(cityCode, id);
    id++;
  }
}

// Beats — with MBR bounds
let orphanBeats = 0;
{
  let id = 1;
  let order = 0;
  const seen = new Set();
  for (const f of beats.features) {
    const p = f.properties || {};
    const rawBeatCode = String(p.beat_code || p.beat_id || '').trim();
    if (!rawBeatCode) continue;
    let beatCode = rawBeatCode;
    if (seen.has(rawBeatCode)) {
      let suffix = 2;
      while (seen.has(`${rawBeatCode}-${suffix}`)) suffix++;
      beatCode = `${rawBeatCode}-${suffix}`;
    }
    seen.add(beatCode);

    const cityCode = String(p.city_code || '').trim();
    const district = String(p.district_letter || '');
    const num = Number(p.beat_number) || 0;
    const zoneId = zoneIdByCityCode.get(cityCode) ?? null;
    if (!zoneId) orphanBeats++;
    const cityName = String(p.city || cityCode);
    const beatName = num > 0 ? `${cityName} ${district}-${num}` : cityName;

    const mbr = computeMBR(f.geometry) || { min_lat: null, max_lat: null, min_lng: null, max_lng: null };

    beatRows.push({
      id, code: beatCode, name: beatName, descriptor: beatName,
      zone_id: zoneId, district_letter: district || null,
      beat_number: num || null, dispatch_code: `${cityCode}-${district}${num}`,
      sort_order: ++order, ...mbr,
    });
    id++;
  }
}

// ── Emit SQL ──
const lines = [];
lines.push('-- Generated by scripts/generate-d1-geography-seed.mjs — DO NOT EDIT BY HAND');
lines.push(`-- Counts: areas=${areaRows.length} sectors=${sectorRows.length} zones=${zoneRows.length} beats=${beatRows.length} (${orphanBeats} orphan)`);
lines.push('-- Idempotent: each block only runs if its table is empty.');
lines.push('');
lines.push('-- ── AREAS ──');
lines.push('INSERT INTO dispatch_areas (id, area_code, area_name, color, sort_order) SELECT * FROM (VALUES');
lines.push(areaRows.map(r => `  (${r.id}, ${sqlStr(r.code)}, ${sqlStr(r.name)}, ${sqlStr(r.color)}, ${r.sort_order})`).join(',\n'));
lines.push(') AS t WHERE NOT EXISTS (SELECT 1 FROM dispatch_areas LIMIT 1);');
lines.push('');
lines.push('-- ── SECTORS ──');
lines.push('INSERT INTO dispatch_sectors (id, sector_code, sector_name, area_id, county_nbr, fips_code, color, sort_order) SELECT * FROM (VALUES');
lines.push(sectorRows.map(r => `  (${r.id}, ${sqlStr(r.code)}, ${sqlStr(r.name)}, ${sqlNum(r.area_id)}, ${sqlStr(r.county_nbr)}, ${sqlStr(r.fips)}, ${sqlStr(r.color)}, ${r.sort_order})`).join(',\n'));
lines.push(') AS t WHERE NOT EXISTS (SELECT 1 FROM dispatch_sectors LIMIT 1);');
lines.push('');
lines.push('-- ── ZONES ──');
// Chunk zone INSERTs to keep statement size manageable
const ZONE_CHUNK = 100;
for (let i = 0; i < zoneRows.length; i += ZONE_CHUNK) {
  const chunk = zoneRows.slice(i, i + ZONE_CHUNK);
  lines.push('INSERT INTO dispatch_zones (id, zone_code, zone_name, sector_id, zone_type, ugrc_code, population_estimate, sort_order) SELECT * FROM (VALUES');
  lines.push(chunk.map(r => `  (${r.id}, ${sqlStr(r.code)}, ${sqlStr(r.name)}, ${sqlNum(r.sector_id)}, ${sqlStr(r.zone_type)}, ${sqlStr(r.ugrc_code)}, ${sqlNum(r.pop)}, ${r.sort_order})`).join(',\n'));
  lines.push(`) AS t WHERE NOT EXISTS (SELECT 1 FROM dispatch_zones WHERE id = ${chunk[0].id});`);
  lines.push('');
}
lines.push('-- ── BEATS (with MBR bounds for /dispatch/districts/identify) ──');
const BEAT_CHUNK = 100;
for (let i = 0; i < beatRows.length; i += BEAT_CHUNK) {
  const chunk = beatRows.slice(i, i + BEAT_CHUNK);
  lines.push('INSERT INTO dispatch_beats (id, beat_code, beat_name, beat_descriptor, zone_id, district_letter, beat_number, dispatch_code, sort_order, min_lat, max_lat, min_lng, max_lng) SELECT * FROM (VALUES');
  lines.push(chunk.map(r => `  (${r.id}, ${sqlStr(r.code)}, ${sqlStr(r.name)}, ${sqlStr(r.descriptor)}, ${sqlNum(r.zone_id)}, ${sqlStr(r.district_letter)}, ${sqlNum(r.beat_number)}, ${sqlStr(r.dispatch_code)}, ${r.sort_order}, ${sqlNum(r.min_lat)}, ${sqlNum(r.max_lat)}, ${sqlNum(r.min_lng)}, ${sqlNum(r.max_lng)})`).join(',\n'));
  lines.push(`) AS t WHERE NOT EXISTS (SELECT 1 FROM dispatch_beats WHERE id = ${chunk[0].id});`);
  lines.push('');
}
lines.push('-- Helpful indexes for /dispatch/districts/identify (MBR lookup)');
lines.push('CREATE INDEX IF NOT EXISTS idx_dispatch_beats_mbr ON dispatch_beats(min_lat, max_lat, min_lng, max_lng);');
lines.push('');

mkdirSync(dirname(OUT_FILE), { recursive: true });
writeFileSync(OUT_FILE, lines.join('\n'));
const bytes = Buffer.byteLength(lines.join('\n'));
console.log(`\nWrote ${OUT_FILE}`);
console.log(`  size:    ${(bytes / 1024).toFixed(1)} KB`);
console.log(`  areas:   ${areaRows.length}`);
console.log(`  sectors: ${sectorRows.length}`);
console.log(`  zones:   ${zoneRows.length}`);
console.log(`  beats:   ${beatRows.length}  (${orphanBeats} without a zone — expected for unmatched city_codes)`);
console.log('\nApply with:');
console.log('  npx wrangler d1 execute rmpg-flex --remote --file migrations/0012_seed_geography.sql');

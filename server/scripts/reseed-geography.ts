#!/usr/bin/env npx tsx
// ============================================================
// RMPG Flex — Geography Reseed Script
//
// Idempotently loads the full Utah Sector → Area → Zone → Beat
// hierarchy into an existing database.
//
// Usage (from server/ directory):
//   npx tsx scripts/reseed-geography.ts [--force]
//
// With --force: clears existing geography before reseeding
// Without --force: uses INSERT OR IGNORE (preserves manual edits)
// ============================================================

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { DISPATCH_DISTRICTS, DISPATCH_SECTORS, DISPATCH_AREAS } from '../src/seeds/dispatchDistricts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '../data/rmpg.db');
const FORCE = process.argv.includes('--force');

console.log('[reseed-geography] DB path:', DB_PATH);
console.log('[reseed-geography] Force mode:', FORCE);

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

if (FORCE) {
  console.log('[reseed-geography] Force mode — clearing existing geography...');
  db.exec(`DELETE FROM dispatch_beats`);
  db.exec(`DELETE FROM dispatch_zones`);
  db.exec(`DELETE FROM dispatch_sections`);
  db.exec(`DELETE FROM dispatch_areas`);
  console.log('[reseed-geography] Tables cleared.');
}

const reseed = db.transaction(() => {
  // 1. Sectors → dispatch_areas
  const insertSector = db.prepare(
    'INSERT OR IGNORE INTO dispatch_areas (area_code, area_name, color, description, sort_order) VALUES (?, ?, ?, ?, ?)'
  );
  let sectorCount = 0;
  DISPATCH_SECTORS.forEach((s, i) => {
    const info = insertSector.run(s.id, s.name, s.color, s.description, i);
    if (info.changes) sectorCount++;
  });

  // 2. Areas (counties) → dispatch_sections
  const insertArea = db.prepare(
    'INSERT OR IGNORE INTO dispatch_sections (section_code, section_name, area_id, color, sort_order) VALUES (?, ?, (SELECT id FROM dispatch_areas WHERE area_code = ?), ?, ?)'
  );
  const seenAreas = new Set<string>();
  let areaCount = 0;
  let areaSort = 0;
  for (const a of DISPATCH_AREAS) {
    if (!seenAreas.has(a.area_id)) {
      const info = insertArea.run(a.area_id, a.area_name, a.sector_id, a.color || '#6366f1', areaSort++);
      if (info.changes) areaCount++;
      seenAreas.add(a.area_id);
    }
  }

  // 3. Zones (cities/towns) → dispatch_zones
  const insertZone = db.prepare(
    'INSERT OR IGNORE INTO dispatch_zones (zone_code, zone_name, section_id, sort_order) VALUES (?, ?, (SELECT id FROM dispatch_sections WHERE section_code = ?), ?)'
  );
  const seenZones = new Set<string>();
  let zoneCount = 0;
  let zoneSort = 0;
  for (const d of DISPATCH_DISTRICTS) {
    if (!seenZones.has(d.zone_id)) {
      const info = insertZone.run(d.zone_id, d.zone_name, d.area_id || d.section_id, zoneSort++);
      if (info.changes) zoneCount++;
      seenZones.add(d.zone_id);
    }
  }

  // 4. Beats → dispatch_beats
  const insertBeat = db.prepare(
    'INSERT OR IGNORE INTO dispatch_beats (beat_code, beat_name, beat_descriptor, zone_id, dispatch_code, sort_order) VALUES (?, ?, ?, (SELECT id FROM dispatch_zones WHERE zone_code = ?), ?, ?)'
  );
  let beatCount = 0;
  let beatSort = 0;
  for (const d of DISPATCH_DISTRICTS) {
    const beatCode = d.zone_id + '-' + d.beat_id;
    const info = insertBeat.run(beatCode, d.beat_name, d.beat_descriptor, d.zone_id, d.dispatch_code, beatSort++);
    if (info.changes) beatCount++;
  }

  return { sectorCount, areaCount, zoneCount, beatCount };
});

try {
  const result = reseed();
  console.log('[reseed-geography] Done:');
  console.log('  Sectors  inserted:', result.sectorCount, '/', DISPATCH_SECTORS.length);
  console.log('  Areas    inserted:', result.areaCount, '/', DISPATCH_AREAS.length);
  console.log('  Zones    inserted:', result.zoneCount);
  console.log('  Beats    inserted:', result.beatCount, '/', DISPATCH_DISTRICTS.length);

  // Summary query
  const summary = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM dispatch_areas) as sectors,
      (SELECT COUNT(*) FROM dispatch_sections) as areas,
      (SELECT COUNT(*) FROM dispatch_zones) as zones,
      (SELECT COUNT(*) FROM dispatch_beats) as beats
  `).get() as any;
  console.log('\n[reseed-geography] Current DB totals:');
  console.log('  Sectors:', summary.sectors);
  console.log('  Areas:', summary.areas);
  console.log('  Zones:', summary.zones);
  console.log('  Beats:', summary.beats);
} catch (err: any) {
  console.error('[reseed-geography] ERROR:', err.message);
  process.exit(1);
}

db.close();

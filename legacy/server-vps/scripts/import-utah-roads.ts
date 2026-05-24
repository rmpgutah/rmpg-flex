#!/usr/bin/env npx tsx
import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse';
import Pick from 'stream-json/filters/pick.js';
import StreamArray from 'stream-json/streamers/stream-array.js';
import { normalizeStreetName } from '../src/utils/addressRange';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface Args {
  csv: string;
  geojson: string;
  db: string;
}

function parseArgs(argv: string[]): Args {
  const args: Partial<Args> = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--csv') { args.csv = value; i++; }
    else if (flag === '--geojson') { args.geojson = value; i++; }
    else if (flag === '--db') { args.db = value; i++; }
  }
  if (!args.csv || !args.geojson) {
    console.error('Usage: import-utah-roads.ts --csv <path> --geojson <path> [--db <path>]');
    process.exit(1);
  }
  return {
    csv: args.csv,
    geojson: args.geojson,
    db: args.db ?? path.resolve(__dirname, '../data/rmpg-flex.db'),
  };
}

function toIntOrNull(v: string | undefined): number | null {
  if (v == null || v === '') return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

function s(v: string | undefined | null): string | null {
  return v == null || v === '' ? null : v;
}

function sOr(...vals: Array<string | undefined | null>): string | null {
  for (const v of vals) {
    if (v != null && v !== '') return v;
  }
  return null;
}

async function importCsv(
  db: Database.Database,
  csvPath: string,
  objectIdToKey: Map<number, string>,
): Promise<{ inserted: number; skipped: number }> {
  const insert = db.prepare(`INSERT OR IGNORE INTO roads (
    utah_road_unique_id, unique_id, full_name, street_name,
    pre_dir, post_type, post_dir,
    left_from, left_to, right_from, right_to,
    parity_left, parity_right,
    postal_community_left, postal_community_right,
    zip_left, zip_right,
    esn_left, esn_right,
    msag_community_left, msag_community_right,
    one_way, posted_speed, dot_functional_class,
    county_left, county_right
  ) VALUES (
    @utah_road_unique_id, @unique_id, @full_name, @street_name,
    @pre_dir, @post_type, @post_dir,
    @left_from, @left_to, @right_from, @right_to,
    @parity_left, @parity_right,
    @postal_community_left, @postal_community_right,
    @zip_left, @zip_right,
    @esn_left, @esn_right,
    @msag_community_left, @msag_community_right,
    @one_way, @posted_speed, @dot_functional_class,
    @county_left, @county_right
  )`);

  const start = Date.now();
  let inserted = 0;
  let skipped = 0;
  const rows: any[] = [];
  const FLUSH_EVERY = 50000;

  const flush = db.transaction((batch: any[]) => {
    for (const row of batch) {
      const result = insert.run(row);
      if (result.changes > 0) inserted++;
      else skipped++;
    }
  });

  const parser = fs.createReadStream(csvPath).pipe(parse({
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true,
  }));

  for await (const rec of parser) {
    const key = sOr(rec.UtahRoadUniqueID, rec.UniqueID);
    if (!key) continue;
    const objectId = toIntOrNull(rec.OBJECTID ?? rec['\uFEFFOBJECTID']);
    if (objectId != null && !objectIdToKey.has(objectId)) {
      objectIdToKey.set(objectId, key);
    }
    rows.push({
      utah_road_unique_id: key,
      unique_id: s(rec.UniqueID),
      full_name: s(rec.FullName),
      street_name: rec.StreetName ? normalizeStreetName(rec.StreetName) : null,
      pre_dir: s(rec.StreetNamePreDirectional),
      post_type: s(rec.StreetNamePostType),
      post_dir: s(rec.StreetNamePostDirectional),
      left_from: toIntOrNull(rec.LeftFromAddress),
      left_to: toIntOrNull(rec.LeftToAddress),
      right_from: toIntOrNull(rec.RightFromAddress),
      right_to: toIntOrNull(rec.RightToAddress),
      parity_left: s(rec.ParityLeft),
      parity_right: s(rec.ParityRight),
      postal_community_left: sOr(rec.PostalCommunityNameLeft, rec.PostalCommunityLeft),
      postal_community_right: sOr(rec.PostalCommunityNameRight, rec.PostalCommunityRight),
      zip_left: sOr(rec.PostalZipCodeLeft, rec.ZipLeft),
      zip_right: sOr(rec.PostalZipCodeRight, rec.ZipRight),
      esn_left: s(rec.ESNLeft),
      esn_right: s(rec.ESNRight),
      msag_community_left: s(rec.MSAGCommunityLeft),
      msag_community_right: s(rec.MSAGCommunityRight),
      one_way: s(rec.OneWayCode),
      posted_speed: toIntOrNull(rec.PostedSpeedLimit),
      dot_functional_class: sOr(rec['DOTFunctional Class'], rec.DOTFunctionalClass),
      county_left: s(rec.CountyLeft),
      county_right: s(rec.CountyRight),
    });
    if (rows.length >= FLUSH_EVERY) {
      flush(rows.splice(0));
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`[roads] ${inserted} inserted, ${skipped} skipped, ${elapsed}s elapsed`);
    }
  }
  if (rows.length) flush(rows.splice(0));

  const totalElapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[roads] DONE — ${inserted} inserted, ${skipped} skipped, ${totalElapsed}s total`);
  return { inserted, skipped };
}

async function importGeoJson(
  db: Database.Database,
  geojsonPath: string,
  objectIdToKey: Map<number, string>,
): Promise<{ inserted: number; skipped: number }> {
  const knownKeys = new Set<string>(
    db.prepare('SELECT utah_road_unique_id FROM roads').all().map((r: any) => r.utah_road_unique_id),
  );
  console.log(`[geom] loaded ${knownKeys.size} road keys, ${objectIdToKey.size} OBJECTID mappings for orphan filter`);

  const insert = db.prepare(
    `INSERT OR IGNORE INTO road_segments_geom (utah_road_unique_id, geom_json) VALUES (?, ?)`,
  );

  const start = Date.now();
  let inserted = 0;
  let skipped = 0;
  let orphans = 0;
  const batch: Array<{ key: string; geom: string }> = [];
  const FLUSH_EVERY = 50000;

  const flush = db.transaction((items: typeof batch) => {
    for (const item of items) {
      const result = insert.run(item.key, item.geom);
      if (result.changes > 0) inserted++;
      else skipped++;
    }
  });

  const stream = fs.createReadStream(geojsonPath)
    .pipe(Pick.withParserAsStream({ filter: 'features' }))
    .pipe(StreamArray.asStream());

  for await (const chunk of stream as AsyncIterable<{ key: number; value: any }>) {
    const value = chunk.value;
    const props = value.properties ?? {};
    let key: string | undefined =
      (props.UtahRoadUniqueID && props.UtahRoadUniqueID !== '' ? props.UtahRoadUniqueID : undefined) ??
      (props.UniqueID && props.UniqueID !== '' ? props.UniqueID : undefined);
    if (!key) {
      // Fall back to OBJECTID / feature.id join (UGRC GeoJSON exports often have no properties).
      const fid =
        (typeof value.id === 'number' ? value.id : null) ??
        (props.OBJECTID != null ? Number(props.OBJECTID) : null);
      if (fid != null) key = objectIdToKey.get(fid);
    }
    if (!key) continue;
    if (!knownKeys.has(key)) { orphans++; continue; }
    const coords = value.geometry?.coordinates;
    if (!coords) continue;
    batch.push({ key, geom: JSON.stringify(coords) });
    if (batch.length >= FLUSH_EVERY) {
      flush(batch.splice(0));
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`[geom] ${inserted} inserted, ${skipped} skipped, ${orphans} orphans, ${elapsed}s elapsed`);
    }
  }
  if (batch.length) flush(batch.splice(0));

  const totalElapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[geom] DONE — ${inserted} inserted, ${skipped} skipped, ${orphans} orphans, ${totalElapsed}s total`);
  return { inserted, skipped };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  for (const [label, file] of [['csv', args.csv], ['geojson', args.geojson]] as const) {
    if (!fs.existsSync(file)) {
      console.error(`[error] ${label} file not found: ${file}`);
      process.exit(1);
    }
  }
  const db = new Database(args.db);
  console.log(`[import] db=${args.db} csv=${args.csv} geojson=${args.geojson}`);
  const objectIdToKey = new Map<number, string>();
  const csvStats = await importCsv(db, args.csv, objectIdToKey);
  const geomStats = await importGeoJson(db, args.geojson, objectIdToKey);
  db.close();
  console.log('\n[summary]');
  console.log(`  roads:              ${csvStats.inserted} inserted / ${csvStats.skipped} skipped`);
  console.log(`  road_segments_geom: ${geomStats.inserted} inserted / ${geomStats.skipped} skipped`);
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});

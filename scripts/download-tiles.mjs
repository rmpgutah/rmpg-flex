#!/usr/bin/env node
// ============================================================
// RMPG Flex — Offline Tile Downloader
// Downloads CartoDB dark_matter raster tiles for the Utah
// operational area at multiple zoom levels. Tiles are saved
// to client/public/tiles/{z}/{x}/{y}.png for offline use.
//
// Coverage strategy:
//   Z7-8   Full Utah state (overview)
//   Z9-11  Wasatch Front (Ogden → Provo corridor)
//   Z12-14 SLC metro (Salt Lake Valley + suburbs)
//   Z15    SLC core (downtown + surrounding neighborhoods)
//
// CartoDB dark_matter tiles are free and open (CC BY 3.0)
// with attribution to CartoDB and OpenStreetMap contributors.
// ============================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.resolve(__dirname, '../client/public/tiles');

// ─── Tile Math ───────────────────────────────────────────────

function lng2tile(lng, zoom) {
  return Math.floor(((lng + 180) / 360) * (1 << zoom));
}

function lat2tile(lat, zoom) {
  const latRad = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
      (1 << zoom)
  );
}

// ─── Coverage Zones ──────────────────────────────────────────
// Each zone defines a bounding box and which zoom levels it covers.
// Higher zooms focus on the operational area (SLC metro).

const ZONES = [
  {
    name: 'Utah State',
    zooms: [7, 8],
    bounds: { north: 42.0, south: 36.99, west: -114.05, east: -109.04 },
  },
  {
    name: 'Wasatch Front',
    zooms: [9, 10, 11],
    bounds: { north: 41.3, south: 40.0, west: -112.3, east: -111.4 },
  },
  {
    name: 'SLC Metro',
    zooms: [12, 13, 14],
    bounds: { north: 40.95, south: 40.45, west: -112.15, east: -111.65 },
  },
  {
    name: 'SLC Core',
    zooms: [15],
    bounds: { north: 40.85, south: 40.65, west: -112.0, east: -111.75 },
  },
];

// CartoDB dark_matter CDN (round-robin across a/b/c/d subdomains)
const TILE_SERVERS = [
  'https://a.basemaps.cartocdn.com/dark_all',
  'https://b.basemaps.cartocdn.com/dark_all',
  'https://c.basemaps.cartocdn.com/dark_all',
  'https://d.basemaps.cartocdn.com/dark_all',
];

// ─── Download Logic ──────────────────────────────────────────

let serverIdx = 0;
function getTileUrl(z, x, y) {
  const server = TILE_SERVERS[serverIdx++ % TILE_SERVERS.length];
  return `${server}/${z}/${x}/${y}.png`;
}

async function downloadTile(z, x, y, retries = 3) {
  const url = getTileUrl(z, x, y);
  const outPath = path.join(OUTPUT_DIR, String(z), String(x), `${y}.png`);

  // Skip if already downloaded
  if (fs.existsSync(outPath)) return { status: 'skipped', z, x, y };

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'RMPG-Flex-TileDownloader/1.0' },
        signal: AbortSignal.timeout(15000),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const buffer = Buffer.from(await resp.arrayBuffer());

      // Ensure directory exists
      const dir = path.dirname(outPath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(outPath, buffer);

      return { status: 'downloaded', z, x, y, size: buffer.length };
    } catch (err) {
      if (attempt === retries - 1) {
        return { status: 'failed', z, x, y, error: err.message };
      }
      // Backoff: 1s, 2s, 4s
      await new Promise((r) => setTimeout(r, 1000 * (1 << attempt)));
    }
  }
}

// ─── Main ────────────────────────────────────────────────────

async function main() {
  console.log('============================================================');
  console.log('  RMPG Flex — Offline Tile Downloader');
  console.log('  CartoDB dark_matter tiles for Utah operational area');
  console.log('============================================================\n');

  // Calculate all tiles to download
  const tiles = [];
  for (const zone of ZONES) {
    for (const z of zone.zooms) {
      const xMin = lng2tile(zone.bounds.west, z);
      const xMax = lng2tile(zone.bounds.east, z);
      const yMin = lat2tile(zone.bounds.north, z); // north = lower y
      const yMax = lat2tile(zone.bounds.south, z); // south = higher y

      let count = 0;
      for (let x = xMin; x <= xMax; x++) {
        for (let y = yMin; y <= yMax; y++) {
          tiles.push({ z, x, y });
          count++;
        }
      }
      console.log(`  ${zone.name} Z${z}: ${xMin}-${xMax} x ${yMin}-${yMax} = ${count} tiles`);
    }
  }

  console.log(`\n  Total: ${tiles.length} tiles to download\n`);

  // Create output directory
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Download in batches of 10 (respectful concurrency)
  const BATCH_SIZE = 10;
  let downloaded = 0;
  let skipped = 0;
  let failed = 0;
  let totalBytes = 0;
  const failedTiles = [];
  const startTime = Date.now();

  for (let i = 0; i < tiles.length; i += BATCH_SIZE) {
    const batch = tiles.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map((t) => downloadTile(t.z, t.x, t.y))
    );

    for (const result of results) {
      if (result.status === 'downloaded') {
        downloaded++;
        totalBytes += result.size || 0;
      } else if (result.status === 'skipped') {
        skipped++;
      } else {
        failed++;
        failedTiles.push(result);
      }
    }

    // Progress
    const done = i + batch.length;
    const pct = ((done / tiles.length) * 100).toFixed(1);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const mbDown = (totalBytes / 1024 / 1024).toFixed(2);
    process.stdout.write(
      `\r  Progress: ${done}/${tiles.length} (${pct}%) | ${downloaded} new | ${skipped} cached | ${failed} failed | ${mbDown} MB | ${elapsed}s`
    );

    // Small delay between batches to be respectful
    if (i + BATCH_SIZE < tiles.length) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  console.log('\n');

  // Summary
  const totalMB = (totalBytes / 1024 / 1024).toFixed(2);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('============================================================');
  console.log(`  Downloaded: ${downloaded} tiles (${totalMB} MB)`);
  console.log(`  Skipped:    ${skipped} tiles (already cached)`);
  console.log(`  Failed:     ${failed} tiles`);
  console.log(`  Time:       ${elapsed}s`);
  console.log(`  Output:     ${OUTPUT_DIR}/`);
  console.log('============================================================');

  if (failedTiles.length > 0) {
    console.log('\n  Failed tiles:');
    for (const t of failedTiles.slice(0, 10)) {
      console.log(`    Z${t.z}/${t.x}/${t.y}: ${t.error}`);
    }
    if (failedTiles.length > 10) {
      console.log(`    ... and ${failedTiles.length - 10} more`);
    }
  }

  // Generate tile manifest for service worker
  const manifest = tiles.map((t) => `/tiles/${t.z}/${t.x}/${t.y}.png`);
  const manifestPath = path.join(OUTPUT_DIR, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 0));
  console.log(`\n  Tile manifest: ${manifestPath} (${manifest.length} entries)`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

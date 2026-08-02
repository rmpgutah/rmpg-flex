#!/usr/bin/env node
// GeoJSONSeq -> GeoJSONSeq: assign `cat`, project properties, emit camera cones.
// Streams line-by-line — a statewide extract does not fit in memory.
//
// Usage: osmium export -f geojsonseq in.pbf | node transform.mjs --group safety > out.geojsonseq
// Writes a JSON count summary to stderr as its final line.
import { createInterface } from 'node:readline';
import { projectFeature } from './project.mjs';
import { coneFeature } from './cones.mjs';
import { getGroup } from './catalog.mjs';

const argv = process.argv.slice(2);
const groupIdx = argv.indexOf('--group');
if (groupIdx === -1 || !argv[groupIdx + 1]) {
  console.error('usage: transform.mjs --group <name>');
  process.exit(2);
}
const groupName = argv[groupIdx + 1];
const group = getGroup(groupName);
const wantCones = groupName === 'surveillance';

const counts = Object.fromEntries(group.categories.map((c) => [c.cat, 0]));
if (wantCones) counts.camera_cone = 0;

const MINZOOM_BY_CAT = Object.fromEntries(group.categories.map((c) => [c.cat, c.minzoom]));
// Cones ride with their camera — same gate as the most permissive camera category.
if (wantCones) MINZOOM_BY_CAT.camera_cone = Math.min(...group.categories.map((c) => c.minzoom));
function minzoomFor(cat) {
  const z = MINZOOM_BY_CAT[cat];
  if (z === undefined) throw new Error(`no minzoom for category ${cat} in group ${groupName}`);
  return z;
}
let skipped = 0;
let malformed = 0;

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
const out = [];
const FLUSH_AT = 1000;

function write(obj) {
  out.push(JSON.stringify(obj));
  if (out.length >= FLUSH_AT) {
    process.stdout.write(out.join('\n') + '\n');
    out.length = 0;
  }
}

for await (const line of rl) {
  // osmium's geojsonseq may prefix each line with RS (U+001E) per RFC 8142.
  // Written as an ESCAPE, not a literal control char — an invisible byte here
  // is silently lost by editors and copy/paste, and JSON.parse rejects a
  // leading control character. Strip it BEFORE trimming.
  const cleaned = line.replace(/^\u001e/, '').trim();
  if (!cleaned) continue;

  let feature;
  try {
    feature = JSON.parse(cleaned);
  } catch {
    malformed++;
    continue;
  }

  const projected = projectFeature(feature, groupName);
  if (!projected) { skipped++; continue; }

  // projectFeature() nests `cat` under `.properties.cat`, NOT at the top level
  // of the returned feature — don't "simplify" this back to `projected.cat`.
  //
  // Per-feature zoom gate. Tippecanoe reads a `tippecanoe` member on the feature
  // and honors minzoom PER FEATURE, unlike --minimum-zoom which is per tile-layer.
  // Without this, every category in a group would be forced into tiles from the
  // group's LOWEST minzoom — a z10 utility tile carrying every power pole in the
  // metro. With it, poles start at z16 and substations at z10 from one archive,
  // and nothing has to be dropped to keep tiles small.
  //
  // NOTE the asymmetry: `cat` is read from `properties`, but `tippecanoe` is
  // written at the feature's TOP level (a sibling of `geometry`/`properties`) —
  // that is the only place tippecanoe looks for it. A `tippecanoe` key placed
  // inside `properties` is silently ignored as ordinary data, and per-feature
  // zoom gating does nothing — with no error, only oversized low-zoom tiles.
  projected.tippecanoe = { minzoom: minzoomFor(projected.properties.cat) };

  counts[projected.properties.cat]++;
  write(projected);

  if (wantCones) {
    // Cones need camera:direction, which projectFeature keeps only if it is in
    // the group's allow-list. Build from the PROJECTED feature so cat is set.
    const cone = coneFeature(projected);
    if (cone) {
      // Same top-level placement as above — cone.tippecanoe, not
      // cone.properties.tippecanoe.
      cone.tippecanoe = { minzoom: minzoomFor('camera_cone') };
      counts.camera_cone++;
      write(cone);
    }
  }
}

if (out.length) process.stdout.write(out.join('\n') + '\n');
console.error(JSON.stringify({ group: groupName, counts, skipped, malformed }));

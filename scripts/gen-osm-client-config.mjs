// Generates client/src/config/osmLayers.generated.ts from config/osm-layers.json
// (via scripts/osm/catalog.mjs's loadCatalog()), so the pipeline catalog and the
// client-side layer config can never drift apart.
//
// Usage: node scripts/gen-osm-client-config.mjs
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadCatalog } from './osm/catalog.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(HERE, '..', 'client', 'src', 'config', 'osmLayers.generated.ts');
const MANIFEST_PATH = join(HERE, '..', '.osm-build', 'osm-manifest.json');

function readExtractDate() {
  if (!existsSync(MANIFEST_PATH)) return 'unknown';
  try {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
    return typeof manifest.extract_date === 'string' ? manifest.extract_date : 'unknown';
  } catch {
    return 'unknown';
  }
}

function quote(s) {
  return `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/**
 * Derive a Mapbox render kind ('point' | 'line' | 'polygon') for a category
 * from its osmium `filters` prefixes (n/, w/, r/, nwr/, wr/, nw/, ...):
 *  - every filter is node-only (n/)               -> 'point'
 *  - every filter is way-only (w/)                -> 'line'
 *  - every filter is way/relation-only (wr/ or r/) -> 'polygon'
 *  - anything else (mixed nwr/, nw/, ...)          -> 'point' (safe default)
 * A category's explicit "render" field in the JSON catalog always wins over
 * this derivation — see resolveRender().
 */
function deriveRender(filters) {
  const prefixes = filters.map((f) => `${f.split('/')[0]}/`);
  if (prefixes.every((p) => p === 'n/')) return 'point';
  if (prefixes.every((p) => p === 'w/')) return 'line';
  if (prefixes.every((p) => p === 'wr/' || p === 'r/')) return 'polygon';
  return 'point';
}

function resolveRender(cat) {
  return cat.render ?? deriveRender(cat.filters);
}

function renderCategory(cat, indent) {
  return `${indent}{ cat: ${quote(cat.cat)}, label: ${quote(cat.label)}, minzoom: ${cat.minzoom}, render: ${quote(resolveRender(cat))} },`;
}

function renderGroup(g, indent) {
  const inner = `${indent}  `;
  const catLines = g.categories.map((c) => renderCategory(c, `${inner}  `));
  if (g.name === 'surveillance') {
    // Synthetic category: transform.mjs derives `camera_cone` at build time from
    // `camera` features that carry a `camera:direction` tag. It is intentionally
    // NOT present in config/osm-layers.json — see osmClientConfigSync.test.ts,
    // which asserts it is generated here but absent from the JSON catalog.
    // render: 'polygon' is set here (not via a JSON override) because this
    // category is synthetic and has no catalog entry to carry one.
    catLines.push(
      `${inner}  // Synthetic: derived by scripts/osm/transform.mjs from cameras`,
      `${inner}  // carrying a camera:direction tag. Not present in osm-layers.json.`,
      `${inner}  { cat: 'camera_cone', label: 'Camera view cones', minzoom: 14, render: 'polygon' },`,
    );
  }
  return [
    `${indent}{`,
    `${inner}name: ${quote(g.name)},`,
    `${inner}label: ${quote(g.label)},`,
    `${inner}archive: ${quote(g.archive)},`,
    `${inner}geometry: ${quote(g.geometry)},`,
    `${inner}coverage: ${quote(g.coverage)},`,
    `${inner}assignment: ${quote(g.assignment)},`,
    `${inner}categories: [`,
    ...catLines,
    `${inner}],`,
    `${indent}},`,
  ].join('\n');
}

function generate() {
  const catalog = loadCatalog();
  const extractDate = readExtractDate();

  const groupBlocks = catalog.groups.map((g) => renderGroup(g, '  '));

  const lines = [
    '// GENERATED FILE — do not edit by hand.',
    '// Source: config/osm-layers.json',
    '// Regenerate: node scripts/gen-osm-client-config.mjs',
    '',
    "export interface OsmCategory {",
    '  cat: string;',
    '  label: string;',
    '  minzoom: number;',
    "  render: 'point' | 'line' | 'polygon';",
    '}',
    '',
    'export interface OsmGroup {',
    '  name: string;',
    '  label: string;',
    '  archive: string;',
    "  geometry: 'point' | 'line' | 'polygon' | 'mixed';",
    "  coverage: 'sparse' | 'incomplete' | 'attribute' | 'boundary';",
    "  assignment: 'first-match' | 'multi';",
    '  categories: OsmCategory[];',
    '}',
    '',
    'export const OSM_GROUPS: OsmGroup[] = [',
    ...groupBlocks,
    '];',
    '',
    `export const OSM_EXTRACT_DATE: string = ${quote(extractDate)};`,
    '',
  ];

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, lines.join('\n'), 'utf8');
  console.log(`Wrote ${OUT_PATH}`);
}

generate();

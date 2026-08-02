// Loads and validates config/osm-layers.json — the single source of truth for
// OSM overlay groups, categories, tag filters, and captured properties.
// Consumed by build-osm-tiles.sh (via transform.mjs) and by tests.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = join(HERE, '..', '..', 'config', 'osm-layers.json');

let cached = null;

export function loadCatalog() {
  if (cached) return cached;
  const raw = JSON.parse(readFileSync(CATALOG_PATH, 'utf8'));
  validate(raw);
  cached = raw;
  return cached;
}

function validate(cat) {
  if (cat.version !== 1) throw new Error(`unsupported catalog version: ${cat.version}`);
  if (!Array.isArray(cat.groups) || cat.groups.length === 0) throw new Error('catalog has no groups');
  const seenGroups = new Set();
  for (const g of cat.groups) {
    if (!g.name) throw new Error('group missing name');
    // Group names flow into R2 object keys and filesystem paths — constrain the
    // charset so a stray name can't traverse a path or produce a surprising key.
    if (!/^[a-z][a-z0-9-]*$/.test(g.name)) {
      throw new Error(`${g.name}: group name must match /^[a-z][a-z0-9-]*$/`);
    }
    if (seenGroups.has(g.name)) throw new Error(`duplicate group: ${g.name}`);
    seenGroups.add(g.name);
    if (g.archive !== `osm-${g.name}.pmtiles`) {
      throw new Error(`${g.name}: archive must be osm-${g.name}.pmtiles, got ${g.archive}`);
    }
    if (!Array.isArray(g.properties) || !g.properties.includes('name')) {
      throw new Error(`${g.name}: properties must include "name"`);
    }
    if (!Array.isArray(g.categories) || g.categories.length === 0) {
      throw new Error(`${g.name}: no categories`);
    }
    const seenCats = new Set();
    for (const c of g.categories) {
      if (!c.cat) throw new Error(`${g.name}: category missing cat`);
      if (seenCats.has(c.cat)) throw new Error(`${g.name}: duplicate cat ${c.cat}`);
      seenCats.add(c.cat);
      if (!Number.isInteger(c.minzoom) || c.minzoom < 0 || c.minzoom > 22) {
        throw new Error(`${g.name}/${c.cat}: minzoom out of range`);
      }
      if (!Array.isArray(c.filters) || c.filters.length === 0) {
        throw new Error(`${g.name}/${c.cat}: no filters`);
      }
      if (!Array.isArray(c.match) || c.match.length === 0) {
        throw new Error(`${g.name}/${c.cat}: no match rules`);
      }
    }
  }
}

export function groupNames() {
  return loadCatalog().groups.map((g) => g.name);
}

export function getGroup(name) {
  const g = loadCatalog().groups.find((x) => x.name === name);
  if (!g) throw new Error(`unknown group: ${name}`);
  return g;
}

/**
 * The archive's tippecanoe --minimum-zoom: the LOWEST minzoom among the group's
 * categories. Per-category gating happens client-side; setting this to a
 * per-category value would omit features a lower-gated category needs.
 */
export function archiveMinZoom(name) {
  return Math.min(...getGroup(name).categories.map((c) => c.minzoom));
}

/** Deduped, flat list of osmium tags-filter expressions covering the whole group. */
export function osmiumFilterArgs(name) {
  const out = new Set();
  for (const c of getGroup(name).categories) for (const f of c.filters) out.add(f);
  return [...out];
}

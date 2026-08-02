// Pure category-assignment + property-projection for OSM features.
// Runs AFTER osmium export (which emits every tag) and BEFORE tippecanoe, so
// archives carry only the properties the client actually renders.
import { getGroup } from './catalog.mjs';

function ruleHolds(props, rule) {
  const v = props[rule.key];
  if (v === undefined || v === null || String(v).trim() === '') return false;
  if (rule.present) return true;
  if (Array.isArray(rule.values)) return rule.values.includes(String(v));
  return false;
}

/**
 * All matching categories, in catalog order. Category ORDER in the catalog is
 * load-bearing: specific categories must precede general ones (an ALPR camera
 * also satisfies the generic camera rule) — that ordering is what lets a
 * `first-match` group pick the narrower one.
 */
function matchingCategories(props, group) {
  const out = [];
  for (const c of group.categories) {
    const any = c.matchMode === 'any';
    const ok = any
      ? c.match.some((r) => ruleHolds(props, r))
      : c.match.every((r) => ruleHolds(props, r));
    if (ok) out.push(c);
  }
  return out;
}

/**
 * First matching category's `cat`, or null. Unchanged contract — always the
 * first match regardless of the group's `assignment` mode.
 */
export function assignCategory(properties, groupName) {
  const group = getGroup(groupName);
  const props = properties || {};
  const matches = matchingCategories(props, group);
  return matches.length ? matches[0].cat : null;
}

/**
 * Tags that carry no operational meaning and only inflate every tile.
 * Everything else is kept when a group opts into full capture, so the popup
 * can show what openstreetmap.org shows for that same feature.
 */
const NOISE_TAG_EXACT = new Set([
  'created_by', 'source', 'source:date', 'source:ref', 'attribution',
  'note', 'fixme', 'FIXME', 'comment', 'check_date', 'survey:date',
  'import', 'import_uuid', 'converted_by', 'odbl', 'tiger:tlid',
]);
const NOISE_TAG_PREFIX = [
  'tiger:', 'gnis:', 'NHD:', 'nhd:', 'massgis:', 'CLC:', 'KSJ2:',
  'source:', 'note:', 'ref:linz', 'wikipedia:', 'wikidata:',
];
/** osmium --attributes writes these; they are re-exported under stable names. */
const ATTRIBUTE_TAGS = new Set(['@version', '@timestamp', '@id', '@type']);

function isNoiseTag(key) {
  if (NOISE_TAG_EXACT.has(key)) return true;
  if (ATTRIBUTE_TAGS.has(key)) return true;
  return NOISE_TAG_PREFIX.some((p) => key.startsWith(p));
}

/**
 * A group whose `properties` is the string `'*'` captures EVERY tag except
 * known noise — matching what openstreetmap.org displays for the feature.
 * Groups that name an explicit array stay restricted, which is how the two
 * enormous way-based groups (traffic, drivability) keep their tiles bounded.
 */
function projectProps(props, group, cat) {
  const out = { cat };
  if (group.properties === '*') {
    for (const [key, v] of Object.entries(props)) {
      if (isNoiseTag(key)) continue;
      if (v === undefined || v === null || String(v).trim() === '') continue;
      out[key] = v;
    }
    return out;
  }
  for (const key of group.properties) {
    const v = props[key];
    if (v === undefined || v === null || String(v).trim() === '') continue;
    out[key] = v;
  }
  return out;
}

/**
 * Array of new features, one per matching category for a `multi`-assignment
 * group, or at most one (the first match) for a `first-match` group. Each
 * carries its own `cat` plus the group's projected property allow-list, and
 * the same geometry. Never mutates the input. Returns `[]` when nothing
 * matches.
 *
 * `surveillance` MUST stay `first-match`: its `alpr` and `camera` categories
 * are deliberately ordered so an ALPR camera matches the narrower `alpr` rule
 * first. Under multi-emit it would ALSO match the generic `camera` rule
 * (`man_made=surveillance` alone), double-counting every ALPR camera into both
 * layers.
 */
export function projectFeatures(feature, groupName) {
  const group = getGroup(groupName);
  const props = feature.properties || {};
  const matches = matchingCategories(props, group);
  if (matches.length === 0) return [];

  const cats = group.assignment === 'multi' ? matches : [matches[0]];
  return cats.map((c) => {
    const properties = projectProps(props, group, c.cat);

    // Carry the OpenStreetMap element id through into the tiles. osmium writes
    // it as a TOP-LEVEL `id` ("n83099358"), which tippecanoe will not preserve
    // for a non-numeric value — so it has to live in properties or it is lost.
    // This id is what makes a feature addressable: it is the key an internal
    // RMPG edit attaches to, the join key to a CAD record, the way to diff one
    // extract against the next, and the deep link to openstreetmap.org.
    if (feature.id !== undefined && feature.id !== null && feature.id !== '') {
      properties.osm_id = String(feature.id);
    }
    // Standard OSM metadata, as shown on openstreetmap.org itself.
    if (props['@version'] !== undefined) properties.osm_version = String(props['@version']);
    if (props['@timestamp'] !== undefined) properties.osm_timestamp = String(props['@timestamp']);

    return { type: 'Feature', geometry: feature.geometry, properties };
  });
}

/**
 * New feature with properties reduced to {cat} + the group's allow-list.
 * Never mutates the input. Returns null when no category matches. Unchanged
 * contract — always the first match, identical to `projectFeatures(...)[0]`.
 */
export function projectFeature(feature, groupName) {
  const [first] = projectFeatures(feature, groupName);
  return first || null;
}

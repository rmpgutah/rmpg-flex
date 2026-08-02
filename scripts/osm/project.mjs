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

function projectProps(props, group, cat) {
  const out = { cat };
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
  return cats.map((c) => ({
    type: 'Feature',
    geometry: feature.geometry,
    properties: projectProps(props, group, c.cat),
  }));
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

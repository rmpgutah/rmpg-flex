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
 * First matching category's `cat`, or null. Category ORDER in the catalog is
 * load-bearing: specific categories must precede general ones (an ALPR camera
 * also satisfies the generic camera rule).
 */
export function assignCategory(properties, groupName) {
  const group = getGroup(groupName);
  const props = properties || {};
  for (const c of group.categories) {
    const any = c.matchMode === 'any';
    const ok = any
      ? c.match.some((r) => ruleHolds(props, r))
      : c.match.every((r) => ruleHolds(props, r));
    if (ok) return c.cat;
  }
  return null;
}

/**
 * New feature with properties reduced to {cat} + the group's allow-list.
 * Never mutates the input. Returns null when no category matches.
 */
export function projectFeature(feature, groupName) {
  const group = getGroup(groupName);
  const props = feature.properties || {};
  const cat = assignCategory(props, groupName);
  if (cat === null) return null;

  const out = { cat };
  for (const key of group.properties) {
    const v = props[key];
    if (v === undefined || v === null || String(v).trim() === '') continue;
    out[key] = v;
  }
  return { type: 'Feature', geometry: feature.geometry, properties: out };
}

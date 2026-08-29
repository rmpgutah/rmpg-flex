// ============================================================
// RMPG Flex — Human labels for OSM overlay layer ids
// ============================================================
// The map's Identify tool reported raw Mapbox layer ids straight to the
// operator — a click on a hydrant read "vt-osm_safety_emerg-circle" rather
// than "Emergency Infrastructure". Layer ids are an internal addressing
// scheme; they are not a label, and they are not something an officer
// should ever have to decode on scene.
//
// Layer ids are built as `vt-<configId>-<suffix>`, e.g.
//   vt-osm_safety_emerg-circle   -> osm_safety_emerg   -> "Emergency Infrastructure"
//   vt-osm_traffic_maxspeed-line -> osm_traffic_maxspeed -> "Speed limits"
// UGRC layers use the same envelope (vt-utah_roads-line).
// ============================================================

import { OSM_GROUPS } from '../config/osmLayers.generated';

/** Render suffixes appended by buildOsmLayerSpecs / the UGRC branches. */
/** Render suffixes appended by buildOsmLayerSpecs / the UGRC branches.
 *  Longest-first: `-outline-alpr` must beat `-outline` or Feature Inspector
 *  drops a cone edge as an unknown layer. */
const LAYER_SUFFIXES = [
  '-outline-alpr', '-outline-camera',
  '-circle', '-line', '-fill', '-label', '-symbol', '-halo', '-outline', '-cone',
];

/** configId -> "Group · Category", built once from the generated catalog. */
const LABEL_BY_CONFIG_ID: Record<string, { group: string; category: string }> = (() => {
  const out: Record<string, { group: string; category: string }> = {};
  for (const g of OSM_GROUPS) {
    for (const c of g.categories) {
      out[`osm_${g.name}_${c.cat}`] = { group: g.label, category: c.label };
    }
  }
  return out;
})();

/** The two pre-existing UGRC vector layers, which are not in the OSM catalog. */
const UGRC_LABELS: Record<string, { group: string; category: string }> = {
  utah_roads: { group: 'UGRC', category: 'Utah Roads' },
  utah_addresses: { group: 'UGRC', category: 'Utah Address Points' },
};

/** Strip the `vt-` envelope and any render suffix to recover the config id. */
export function configIdFromLayerId(layerId: string): string | null {
  if (!layerId.startsWith('vt-')) return null;
  let id = layerId.slice(3);
  for (const s of LAYER_SUFFIXES) {
    if (id.endsWith(s)) { id = id.slice(0, -s.length); break; }
  }
  return id || null;
}

/**
 * Operator-facing label for a map layer id.
 * Returns null for layers we do not own (basemap, tilequery, other overlays),
 * so callers can fall back to whatever they showed before rather than
 * mislabelling someone else's layer.
 */
export function humanLayerLabel(layerId: string): string | null {
  const cfgId = configIdFromLayerId(layerId);
  if (!cfgId) return null;
  const hit = LABEL_BY_CONFIG_ID[cfgId] ?? UGRC_LABELS[cfgId];
  return hit ? hit.category : null;
}

/** Group name for a layer id, for use as a secondary//context line. */
export function layerGroupLabel(layerId: string): string | null {
  const cfgId = configIdFromLayerId(layerId);
  if (!cfgId) return null;
  const hit = LABEL_BY_CONFIG_ID[cfgId] ?? UGRC_LABELS[cfgId];
  return hit ? hit.group : null;
}

/** True when this layer is one of ours (OSM overlay or UGRC vector tiles). */
export function isOverlayLayer(layerId: string): boolean {
  return humanLayerLabel(layerId) !== null;
}

/**
 * Split `osm_<group>_<cat>` (and Mapbox `vt-osm_…-circle` ids) into the
 * catalog group + category. Group names have no underscore.
 */
export function osmGroupAndCatFromLayerId(layerId: string): { group: string; cat: string } | null {
  const cfgId = configIdFromLayerId(layerId) ?? (layerId.startsWith('osm_') ? layerId : null);
  if (!cfgId?.startsWith('osm_')) return null;
  const rest = cfgId.slice(4);
  const i = rest.indexOf('_');
  if (i <= 0) return null;
  return { group: rest.slice(0, i), cat: rest.slice(i + 1) };
}

// ── Unit helpers ────────────────────────────────────────────
// Org standard is US units. Mapbox tilequery reports distance in METRES;
// rendering that bare number next to a US address is a readability trap.

/** Metres -> a short US distance string ("12 ft", "0.3 mi"). */
export function metresToUsDistance(m: number): string {
  if (!Number.isFinite(m) || m < 0) return '';
  const feet = m * 3.28084;
  if (feet < 1000) return `${Math.round(feet)} ft`;
  return `${(feet / 5280).toFixed(feet / 5280 < 10 ? 1 : 0)} mi`;
}

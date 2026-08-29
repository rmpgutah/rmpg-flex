// ============================================================
// RMPG Flex — Structured description of an OSM overlay feature
// ============================================================
// Splits WHAT to say about a feature from HOW to render it. The map has two
// consumers with incompatible output needs — an innerHTML popup and a React
// panel — and duplicating the field table into both is exactly how they
// diverge. Both render from this one description.
//
// Org standard is US units. OSM stores several fields metric by default: a
// bare `maxheight` is METRES, a bare `maxspeed` is KM/H, `ele` is metres. A
// bare metric number next to a US address is a readability trap at best and a
// clearance error at worst, so nothing is emitted without an explicit unit.
//
// ⚠️ VALUES ARE RETURNED UNESCAPED. Escaping belongs to the renderer: JSX
// escapes automatically, and osmPopup.ts escapes on the way into innerHTML.
// Escaping here would double-escape every popup value. Never "fix" this by
// escaping at the source — fix the renderer that forgot.
// ============================================================

import { OSM_EXTRACT_DATE } from '../config/osmLayers.generated';
import { parseTimestamp } from './dateUtils';
import { formatCameraBearing, formatConeRadius } from './osmCamera';

// ── Unit conversion ─────────────────────────────────────────

/** OSM maxspeed: "45 mph" passes through; a bare number is km/h. */
export function formatSpeed(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (/mph/i.test(s)) return s.replace(/\s*mph/i, ' mph');
  const n = Number(s);
  if (!Number.isFinite(n)) return s; // e.g. "walk", "signals"
  return `${Math.round(n * 0.621371)} mph (${n} km/h)`;
}

/** OSM maxheight/maxwidth: bare number = metres. `"12'6\""` is already imperial. */
export function formatClearance(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (s.includes("'") || /ft/i.test(s)) return s; // already imperial
  const m = Number(s.replace(/\s*m$/i, ''));
  if (!Number.isFinite(m)) return s;
  const totalInches = m * 39.3701;
  const feet = Math.floor(totalInches / 12);
  const inches = Math.round(totalInches - feet * 12);
  return inches === 12 ? `${feet + 1}' 0"` : `${feet}' ${inches}"`;
}

/** OSM maxweight: bare number = metric tonnes. */
export function formatWeight(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (/lb|ton/i.test(s)) return s;
  const t = Number(s.replace(/\s*t$/i, ''));
  if (!Number.isFinite(t)) return s;
  return `${(t * 1.10231).toFixed(1)} tons`;
}

/** OSM ele: metres above sea level. */
export function formatElevation(raw: unknown): string | null {
  const m = Number(String(raw ?? '').trim());
  if (!Number.isFinite(m)) return null;
  return `${Math.round(m * 3.28084).toLocaleString()} ft`;
}

export function formatBearing(raw: unknown): string | null {
  return formatCameraBearing(raw);
}

/** Volts -> kV once it stops being readable in volts. */
export function formatVoltage(raw: unknown): string | null {
  const v = Number(String(raw ?? '').trim().split(';')[0]);
  if (!Number.isFinite(v)) return null;
  return v >= 1000 ? `${(v / 1000).toLocaleString()} kV` : `${v} V`;
}

/**
 * OSM last-edited timestamp -> a readable date.
 *
 * osmium's `--attributes=timestamp` emits Unix EPOCH SECONDS (e.g.
 * "1707809666"), not a server wall-clock string. Epoch is unambiguously UTC,
 * so the numeric path constructs a Date directly. Any non-numeric value is a
 * string form (ISO with Z, or naive) and goes through parseTimestamp, which
 * knows the repo's naive-UTC convention — constructing a Date straight from a
 * naive string would read it as device-local and land ~7h off in Mountain Time.
 */
export function formatOsmTimestamp(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const n = Number(s);
  const d = Number.isFinite(n) ? new Date(n * 1000) : parseTimestamp(s); // new-date-ok: epoch ms, not a server string
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/** snake_case / hyphen OSM values -> readable words. */
function humanValue(v: unknown): string {
  return String(v ?? '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// ── Field table ─────────────────────────────────────────────

type Formatter = (raw: unknown) => string | null;

interface FieldDef { label: string; format?: Formatter; }

/** Ordered so the operationally important fields come first. */
const FIELDS: Array<[string, FieldDef]> = [
  // Surveillance — "what does this camera actually capture"
  ['surveillance:type', { label: 'Camera type', format: (v) => humanValue(v).toUpperCase() }],
  ['surveillance:zone', { label: 'Covers' }],
  ['surveillance', { label: 'Scope', format: humanValue }],
  ['camera:direction', { label: 'Facing', format: formatBearing }],
  ['camera:mount', { label: 'Mount', format: humanValue }],
  ['camera:type', { label: 'Optics', format: humanValue }],
  ['camera:fov', { label: 'Field of view', format: (v) => {
    const n = Number(String(v).trim());
    return Number.isFinite(n) && n > 0 ? `${Math.round(n)}°` : humanValue(v);
  } }],
  ['camera:angle', { label: 'Field of view', format: (v) => {
    const n = Number(String(v).trim());
    return Number.isFinite(n) && n > 0 ? `${Math.round(n)}°` : humanValue(v);
  } }],
  ['camera:range', { label: 'Range', format: formatConeRadius }],
  ['cone_fov_deg', { label: 'Cone width', format: (v) => `${String(v).trim()}°` }],
  ['cone_radius_m', { label: 'Cone range', format: formatConeRadius }],
  ['manufacturer', { label: 'Manufacturer' }],
  ['brand', { label: 'Brand' }],
  ['model', { label: 'Model' }],

  // Fire & life safety
  ['fire_hydrant:type', { label: 'Hydrant type', format: humanValue }],
  ['colour', { label: 'Bonnet colour', format: humanValue }],
  ['couplings', { label: 'Couplings' }],
  ['fire_hydrant:diameter', { label: 'Main diameter' }],
  ['flow_rate', { label: 'Flow rate' }],
  ['emergency', { label: 'Emergency type', format: humanValue }],

  // Traffic & drivability
  ['maxspeed', { label: 'Speed limit', format: formatSpeed }],
  ['maxheight', { label: 'Clearance', format: formatClearance }],
  ['maxweight', { label: 'Weight limit', format: formatWeight }],
  ['oneway', { label: 'One-way', format: (v) => (String(v) === 'yes' ? 'Yes' : humanValue(v)) }],
  ['surface', { label: 'Surface', format: humanValue }],
  ['tracktype', { label: 'Track grade', format: humanValue }],
  ['smoothness', { label: 'Condition', format: humanValue }],
  ['4wd_only', { label: '4WD only', format: (v) => (String(v) === 'yes' ? 'Yes' : humanValue(v)) }],
  ['ford', { label: 'Ford', format: () => 'Roadway crosses water' }],
  ['traffic_calming', { label: 'Calming', format: humanValue }],
  ['crossing', { label: 'Crossing', format: humanValue }],

  // Access
  ['barrier', { label: 'Barrier', format: humanValue }],
  ['access', { label: 'Access', format: humanValue }],
  ['motor_vehicle', { label: 'Motor vehicle', format: humanValue }],
  ['seasonal', { label: 'Seasonal', format: humanValue }],
  ['parking', { label: 'Parking type', format: humanValue }],

  // Sites & structures
  ['amenity', { label: 'Amenity', format: humanValue }],
  ['shop', { label: 'Shop', format: humanValue }],
  ['tourism', { label: 'Tourism', format: humanValue }],
  ['building:levels', { label: 'Floors' }],
  ['height', { label: 'Height', format: formatClearance }],
  ['entrance', { label: 'Entrance', format: humanValue }],

  // Utility
  ['power', { label: 'Power', format: humanValue }],
  ['voltage', { label: 'Voltage', format: formatVoltage }],
  ['man_made', { label: 'Structure', format: humanValue }],
  ['generator:source', { label: 'Generation', format: humanValue }],

  // Terrain & jurisdiction
  ['natural', { label: 'Natural', format: humanValue }],
  ['hazard', { label: 'Hazard', format: humanValue }],
  ['ele', { label: 'Elevation', format: formatElevation }],
  ['boundary', { label: 'Boundary', format: humanValue }],
  ['landuse', { label: 'Land use', format: humanValue }],
  ['military', { label: 'Military', format: humanValue }],
  ['protect_class', { label: 'Protection class' }],

  // Contact & identity
  ['operator', { label: 'Operator' }],
  ['addr:housenumber', { label: 'Address' }],
  ['addr:street', { label: 'Street' }],
  ['addr:city', { label: 'City' }],
  ['addr:state', { label: 'State' }],
  ['addr:postcode', { label: 'ZIP' }],
  ['phone', { label: 'Phone' }],
  ['contact:phone', { label: 'Phone' }],
  ['website', { label: 'Website' }],
  ['contact:website', { label: 'Website' }],
  ['opening_hours', { label: 'Hours' }],
  ['ref', { label: 'Reference' }],
  ['description', { label: 'Description' }],
];

/** Tags handled structurally (title/provenance) rather than as detail rows. */
const HANDLED_ELSEWHERE = new Set([
  'cat', 'name', 'osm_id', 'osm_version', 'osm_timestamp', 'parent_cat',
  'camera:bearing',
  // Markers injected by mergeOverride — rendered as structured UI below, never
  // as raw key/value rows.
  '__rmpg_note', '__rmpg_verified', '__rmpg_verified_at', '__rmpg_overridden',
]);

// ── Description ─────────────────────────────────────────────

export interface DescriptionRow {
  /** Original OSM tag, for React keys and debugging. */
  key: string;
  label: string;
  /** Already converted, already US units, NOT escaped. */
  value: string;
}

export interface DescribeOptions {
  /** Operator-facing category name, e.g. "Fire hydrants". */
  categoryLabel?: string;
  /** Catalog group, e.g. "Fire & life safety". */
  groupLabel?: string;
  /** Coverage caveat for this layer's coverage class. */
  coverage?: string;
}

export interface FeatureDescription {
  title: string;
  categoryLabel?: string;
  groupLabel?: string;
  rows: DescriptionRow[];
  extras: DescriptionRow[];
  coverage?: string;
  rmpg: {
    verified: boolean;
    verifiedAt?: string;
    note?: string;
    overriddenFields: string[];
  };
  provenance: { extractDate: string; editedDate?: string };
  osmLink?: { id: string; url: string };
}

const MAX_EXTRAS = 8;

export function describeOsmFeature(
  props: Record<string, unknown>,
  opts: DescribeOptions = {},
): FeatureDescription {
  const name = String(props.name ?? '').trim();

  const rows: DescriptionRow[] = [];
  const seenLabels = new Set<string>();
  for (const [key, def] of FIELDS) {
    const raw = props[key];
    if (raw === undefined || raw === null || String(raw).trim() === '') continue;
    // `phone`/`contact:phone` and `website`/`contact:website` both map to one
    // label; show the first that exists rather than the same row twice.
    if (seenLabels.has(def.label)) continue;
    const value = def.format ? def.format(raw) : String(raw);
    if (value === null || value === '') continue;
    seenLabels.add(def.label);
    rows.push({ key, label: def.label, value });
  }

  // Anything captured but not in the field table — shown so full OSM capture is
  // actually visible, rather than silently dropped by an incomplete table.
  const extras: DescriptionRow[] = Object.keys(props)
    .filter((k) => !HANDLED_ELSEWHERE.has(k) && !FIELDS.some(([fk]) => fk === k))
    .filter((k) => String(props[k] ?? '').trim() !== '')
    .slice(0, MAX_EXTRAS)
    .map((k) => ({ key: k, label: k, value: String(props[k]) }));

  const verifiedAt = String(props.__rmpg_verified_at ?? '').trim();
  const note = String(props.__rmpg_note ?? '').trim();
  const overridden = String(props.__rmpg_overridden ?? '').trim();

  const osmId = String(props.osm_id ?? '').trim();
  let osmLink: FeatureDescription['osmLink'];
  if (osmId) {
    const type = osmId[0] === 'n' ? 'node' : osmId[0] === 'w' ? 'way' : 'relation';
    osmLink = { id: osmId, url: `https://www.openstreetmap.org/${type}/${osmId.slice(1)}` };
  }

  const editedDate = formatOsmTimestamp(props.osm_timestamp) ?? undefined;

  const cat = String(props.cat ?? '');
  const parent = String(props.parent_cat ?? '');
  let fallbackTitle = opts.categoryLabel || 'Feature';
  if (!name) {
    if (cat === 'alpr') fallbackTitle = 'ALPR camera';
    else if (cat === 'camera') fallbackTitle = 'Public camera';
    else if (cat === 'camera_cone') {
      fallbackTitle = parent === 'alpr' ? 'ALPR view cone' : 'Camera view cone';
    }
  }

  return {
    title: name || fallbackTitle,
    categoryLabel: opts.categoryLabel,
    groupLabel: opts.groupLabel,
    rows,
    extras,
    coverage: opts.coverage,
    rmpg: {
      verified: props.__rmpg_verified === true || props.__rmpg_verified === 'true',
      verifiedAt: verifiedAt ? verifiedAt.slice(0, 10) : undefined,
      note: note || undefined,
      overriddenFields: overridden ? overridden.split(',').map((s) => s.trim()).filter(Boolean) : [],
    },
    provenance: { extractDate: OSM_EXTRACT_DATE, editedDate },
    osmLink,
  };
}

// ============================================================
// RMPG Flex — Detail popups for OSM overlay features
// ============================================================
// The pipeline now captures every tag OpenStreetMap publishes, so a popup can
// show what openstreetmap.org shows for the same feature. This module turns
// raw OSM tags into labelled, US-unit detail.
//
// Org standard is US units. OSM stores several fields metric by default — a
// bare `maxheight` is METRES, a bare `maxspeed` is KM/H, `ele` is metres. A
// bare metric number next to a US address is a readability trap at best and a
// clearance error at worst, so nothing renders without an explicit unit.
//
// Every value is escaped: OSM text is user-generated.
// ============================================================

import { OSM_EXTRACT_DATE } from '../config/osmLayers.generated';
import { parseTimestamp } from './dateUtils';

export function escapeHtml(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

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

/** Degrees clockwise from north -> compass point plus the raw bearing. */
export function formatBearing(raw: unknown): string | null {
  const d = Number(String(raw ?? '').trim());
  if (!Number.isFinite(d)) return null;
  const pts = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const norm = ((d % 360) + 360) % 360;
  return `${pts[Math.round(norm / 22.5) % 16]} (${Math.round(norm)}°)`;
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
  // Markers injected by mergeOverride — rendered as structured UI below, never
  // as raw key/value rows.
  '__rmpg_note', '__rmpg_verified', '__rmpg_verified_at', '__rmpg_overridden',
]);

const C = {
  panel: '#0f1a28', border: '#2a3646', title: '#f0f4f9',
  label: '#8a97a6', value: '#d7dee7', muted: '#6b7785', chip: '#c3ccd6',
};

export interface OsmPopupOptions {
  /** Operator-facing category name, e.g. "Fire hydrants". */
  categoryLabel?: string;
  /** Coverage caveat for this layer's coverage class. */
  coverage?: string;
}

/**
 * Detail popup for one OSM feature. Absent fields are omitted entirely —
 * never rendered as "Unknown", which would imply we looked and found nothing.
 */
export function buildOsmPopupHtml(
  props: Record<string, unknown>,
  opts: OsmPopupOptions = {},
): string {
  const name = String(props.name ?? '').trim();
  const title = name || opts.categoryLabel || 'Feature';

  const rows: string[] = [];
  const seenLabels = new Set<string>();
  for (const [key, def] of FIELDS) {
    const raw = props[key];
    if (raw === undefined || raw === null || String(raw).trim() === '') continue;
    // `phone`/`contact:phone` and `website`/`contact:website` both map to one
    // label; show the first that exists rather than the same row twice.
    if (seenLabels.has(def.label)) continue;
    const val = def.format ? def.format(raw) : String(raw);
    if (val === null || val === '') continue;
    seenLabels.add(def.label);
    rows.push(
      `<div style="display:flex;gap:6px;font-size:10px;line-height:1.5;">`
      + `<span style="color:${C.label};min-width:96px;flex:0 0 auto;">${escapeHtml(def.label)}</span>`
      + `<span style="color:${C.value};">${escapeHtml(val)}</span>`
      + `</div>`,
    );
  }

  // Anything captured but not in the field table — shown so full OSM capture is
  // actually visible, rather than silently dropped by an incomplete table.
  const extras = Object.keys(props)
    .filter((k) => !HANDLED_ELSEWHERE.has(k) && !FIELDS.some(([fk]) => fk === k))
    .filter((k) => String(props[k] ?? '').trim() !== '')
    .slice(0, 8);

  // ── RMPG's internal edit layer ──
  // Rendered ABOVE the provenance line and visually distinct, so a correction
  // is never mistaken for OpenStreetMap's own data.
  const rmpgNote = String(props.__rmpg_note ?? '').trim();
  const rmpgVerified = props.__rmpg_verified === true || props.__rmpg_verified === 'true';
  const rmpgVerifiedAt = String(props.__rmpg_verified_at ?? '').trim();
  const rmpgOverridden = String(props.__rmpg_overridden ?? '').trim();

  const osmId = String(props.osm_id ?? '').trim();
  const edited = formatOsmTimestamp(props.osm_timestamp);

  let html = `<div style="font-family:system-ui,-apple-system,sans-serif;background:${C.panel};`
    + `border:1px solid ${C.border};border-radius:2px;padding:9px 11px;min-width:210px;max-width:320px;">`;
  html += `<div style="color:${C.title};font-weight:700;font-size:12px;margin-bottom:2px;">${escapeHtml(title)}</div>`;
  if (opts.categoryLabel) {
    html += `<div style="color:${C.chip};font-size:8px;letter-spacing:0.5px;text-transform:uppercase;`
      + `margin-bottom:6px;">${escapeHtml(opts.categoryLabel)}</div>`;
  }
  if (rows.length) html += `<div style="display:flex;flex-direction:column;gap:1px;">${rows.join('')}</div>`;

  if (extras.length) {
    html += `<div style="margin-top:5px;padding-top:4px;border-top:1px solid ${C.border};">`;
    for (const k of extras) {
      html += `<div style="display:flex;gap:6px;font-size:9px;line-height:1.45;">`
        + `<span style="color:${C.muted};min-width:96px;flex:0 0 auto;">${escapeHtml(k)}</span>`
        + `<span style="color:${C.label};">${escapeHtml(String(props[k]))}</span></div>`;
    }
    html += `</div>`;
  }

  if (opts.coverage) {
    html += `<div style="margin-top:6px;padding-top:5px;border-top:1px solid ${C.border};`
      + `color:${C.muted};font-size:8.5px;line-height:1.4;">${escapeHtml(opts.coverage)}</div>`;
  }

  if (rmpgVerified || rmpgNote || rmpgOverridden) {
    html += `<div style="margin-top:6px;padding-top:5px;border-top:1px solid ${C.border};">`;
    if (rmpgVerified) {
      // The whole point of the edit layer: ground-truthed vs crowd-sourced.
      html += `<div style="color:#22c55e;font-size:9px;font-weight:700;letter-spacing:0.4px;">`
        + `\u2713 RMPG VERIFIED${rmpgVerifiedAt ? ` \u00b7 ${escapeHtml(rmpgVerifiedAt.slice(0, 10))}` : ''}</div>`;
    }
    if (rmpgNote) {
      html += `<div style="color:${C.value};font-size:10px;line-height:1.45;margin-top:2px;">`
        + `${escapeHtml(rmpgNote)}</div>`;
    }
    if (rmpgOverridden) {
      // Name the corrected fields explicitly. Silently showing RMPG's value as
      // if OSM published it would misattribute the data.
      html += `<div style="color:${C.muted};font-size:8px;margin-top:2px;">`
        + `Corrected by RMPG: ${escapeHtml(rmpgOverridden.split(',').join(', '))}</div>`;
    }
    html += `</div>`;
  }

  html += `<div style="margin-top:5px;color:${C.muted};font-size:8px;">`
    + `Source: OpenStreetMap · extract ${escapeHtml(OSM_EXTRACT_DATE)}`;
  if (edited) html += ` · edited ${escapeHtml(edited)}`;
  html += `</div>`;

  if (osmId) {
    // Deep link to the canonical record. Only possible because the pipeline now
    // stamps the element id; before that every feature was anonymous.
    const type = osmId[0] === 'n' ? 'node' : osmId[0] === 'w' ? 'way' : 'relation';
    const num = osmId.slice(1);
    html += `<div style="margin-top:2px;"><a href="https://www.openstreetmap.org/${type}/${escapeHtml(num)}"`
      + ` target="_blank" rel="noopener noreferrer" style="color:${C.chip};font-size:8px;">`
      + `${escapeHtml(osmId)} on openstreetmap.org ↗</a></div>`;
  }

  html += `</div>`;
  return html;
}

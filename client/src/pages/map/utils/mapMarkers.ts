import type { MapUnit as Unit, ActiveCall } from './mapConstants';
import { UNIT_STATUS_COLORS, UNIT_STATUS_LABELS, priorityHex } from './mapConstants';
import { CALL_MARKER_INK, priorityLabel } from '../../../utils/statusColors';
import { formatIncidentType } from '../../../utils/caseNumbers';
import { formatEnumValue } from '../../../utils/formatters';
import { escapeHtml } from '../../../utils/sanitize';
import { getGpsStaleness } from '../../../utils/gpsStaleness';
import { haversineDistance } from '../../../utils/unitRecommendation';
import { withAlpha } from '../../../utils/withAlpha';
import {
  TACTICAL_SURFACE_RAISED, TACTICAL_BORDER, TACTICAL_TEXT_MUTED, TACTICAL_BRAND_GOLD,
  TACTICAL_TEXT_PRIMARY, TACTICAL_TEXT_DIM,
} from './tacticalPalette';

// Re-exported for call sites that already import CALL_MARKER_INK from here —
// the canonical definition now lives in utils/statusColors.ts, right below
// PRIORITY_HEX, since it's used by any badge filled with a PRIORITY_HEX color,
// not just this file's map markers.
export { CALL_MARKER_INK };

// How long a marker's CSS transform transition runs — matches the fast
// units-poll interval (MapboxMapPage.tsx UNITS_FAST_POLL_MS) so a position
// update finishes gliding right as the next one arrives, reading as
// continuous motion instead of a teleport between polls.
export const MARKER_TRANSITION_MS = 4500;

// A jump further than this in one poll interval isn't a real drive — it's a
// reassignment, GPS glitch recovery, or test data. Snap instead of gliding
// across an implausible distance (miles, since haversineDistance returns miles).
const MAX_ANIMATED_JUMP_MILES = 0.3; // ~480m

export function shouldAnimateMarkerMove(prevLat: number, prevLng: number, nextLat: number, nextLng: number): boolean {
  return haversineDistance(prevLat, prevLng, nextLat, nextLng) <= MAX_ANIMATED_JUMP_MILES;
}

/**
 * Pure geometry for the accuracy-radius ring, shared by buildUnitMarkerEl and
 * applyUnitMarkerState so the CSS-string-building code can't drift out of
 * sync. `marginTop` is computed as a single signed number (`15 - pixelRadius`)
 * rather than interpolated as `-${pixelRadius - 15}` — the latter produces an
 * invalid double-minus CSS string (e.g. `margin-top:--5px`) whenever
 * `pixelRadius <= 15` (i.e. `gps_accuracy <= 30m`, the common good-accuracy
 * case), which browsers silently ignore.
 */
export function computeAccuracyRingGeometry(gpsAccuracyMeters: number): { pixelRadius: number; marginTop: number } {
  const pixelRadius = Math.min(60, Math.max(8, gpsAccuracyMeters / 2));
  const marginTop = 15 - pixelRadius;
  return { pixelRadius, marginTop };
}

const HAZARD_FLAGS: { key: string; label: string; color: string }[] = [
  { key: 'officer_safety_caution', label: 'OFFICER SAFETY', color: '#ef4444' },
  { key: 'weapons_involved',       label: 'WEAPONS',        color: '#ef4444' },
  { key: 'felony_in_progress',     label: 'FELONY',         color: '#f97316' },
  { key: 'domestic_violence',      label: 'DV',             color: '#f59e0b' },
  { key: 'hazmat',                 label: 'HAZMAT',         color: '#f59e0b' },
  { key: 'mental_health_crisis',   label: 'MH CRISIS',     color: '#a855f7' },
  { key: 'gang_related',           label: 'GANG',           color: '#ef4444' },
];

export { HAZARD_FLAGS };

// Thin wrapper kept for call-site stability within this file — the actual
// thresholds now live in gpsStaleness.ts (single source of truth shared
// with UnitStatusBoard.tsx's getGpsStaleStatus).
function getMapUnitGpsStaleness(unit: Unit): 'ok' | 'stale' | 'lost' {
  return getGpsStaleness(unit);
}

// Near-black backdrop for the unit marker's glyph and badge ring.
//
// Unit markers use a FIXED tactical palette — NOT theme variables. Two reasons:
//   1. They render on tactical surfaces (the Map page, MDT, nav), which are
//      always near-black by design regardless of the app-wide day/night theme.
//   2. buildUnitMarkerEl is also called by components/DashboardMiniMap.tsx,
//      which has NO `.tactical-dark` ancestor. A `var(--surface-sunken)` there
//      resolves to the ambient theme (#1a3350 under Blue & Silver, #d6d3c8 —
//      light tan — under html.theme-light), producing a washed-out glyph and
//      border on a status-colored disc.
// This file is on the hex-audit exclusion list (utils/hexClassifier.ts,
// `mapboxPaint`) for exactly this reason. Defined once here so the value
// isn't repeated at each site.
const TACTICAL_BADGE_SURFACE = '#0d1520';

// Directional triangular arrow — replaces the old vehicle-silhouette glyph.
// Points north (0deg) by default; buildUnitMarkerEl/applyUnitMarkerState set
// the rotation via the returned <svg>'s own style.transform, not a wrapping
// element, so the fill color and the rotation can be updated independently
// without re-parsing HTML on every poll.
function buildUnitArrowSvg(fillColor: string, headingDeg: number | null | undefined): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '20');
  svg.setAttribute('height', '20');
  const rotation = headingDeg != null && Number.isFinite(headingDeg) ? headingDeg : 0;
  svg.style.transform = `rotate(${rotation}deg)`;
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M12 2 20 21 12 16 4 21Z');
  path.setAttribute('fill', fillColor);
  path.setAttribute('stroke', TACTICAL_BADGE_SURFACE);
  path.setAttribute('stroke-width', '1');
  svg.appendChild(path);
  return svg;
}

/** Build a bold solid-badge unit marker: status-colored disc + vehicle glyph + call-sign label. */
export function buildUnitMarkerEl(unit: Unit): HTMLDivElement {
  const color = UNIT_STATUS_COLORS[unit.status] || '#888888';
  const staleness = getMapUnitGpsStaleness(unit);
  // Root element handed to `new mapboxgl.Marker({ element: el })`. Mapbox GL
  // writes this exact node's `transform` on EVERY render frame during pan/zoom
  // (not just on our own setLngLat calls), so it must never carry a CSS
  // transition on `transform` — doing so previously caused every marker to
  // visibly lag/glide whenever the user panned or zoomed the map. All visual
  // styling + the glide transition live on the inner wrapper below instead.
  const el = document.createElement('div');
  el.className = 'rmpg-mbx-unit';
  el.style.cssText = `display:block;cursor:pointer;`;
  el.title = `${unit.call_sign} — ${UNIT_STATUS_LABELS[unit.status] || unit.status}`
    + (staleness === 'lost' ? ' (GPS lost)' : staleness === 'stale' ? ' (GPS stale)' : '');

  const inner = document.createElement('div');
  inner.setAttribute('data-role', 'marker-inner');
  inner.style.cssText = `
    display:flex;flex-direction:column;align-items:center;gap:2px;
    position:relative;
    filter:drop-shadow(0 2px 4px rgba(0,0,0,0.6));
    opacity:${staleness === 'lost' ? 0.45 : staleness === 'stale' ? 0.7 : 1};
    transition:transform ${MARKER_TRANSITION_MS}ms linear;
  `;
  el.appendChild(inner);

  const badge = document.createElement('div');
  badge.setAttribute('data-role', 'badge');
  const ringColor = staleness === 'ok' ? color : '#6b7280';
  badge.style.cssText = `
    display:flex;align-items:center;justify-content:center;
    filter:drop-shadow(0 0 4px ${withAlpha(ringColor, 'b3')});
  `;
  const arrowFill = staleness === 'ok' ? color : ringColor;
  badge.appendChild(buildUnitArrowSvg(arrowFill, unit.gps_heading));
  inner.appendChild(badge);

  const label = document.createElement('div');
  label.setAttribute('data-role', 'label');
  label.style.cssText = `
    background:#101820;border:1.2px solid ${color};border-radius:2px;
    padding:1px 6px;font-size:9px;font-weight:700;color:${color};
    font-family:ui-monospace,monospace;white-space:nowrap;
  `;
  label.textContent = unit.call_sign.slice(0, 6);
  inner.appendChild(label);

  // Accuracy-radius ring: a translucent circle sized to the reported GPS
  // accuracy in meters. Rendered only when accuracy data is present (the
  // server nulls implausible values) so we never draw a fake/default ring.
  // Sized in CSS pixels using a fixed reference scale (roughly meters-per-
  // pixel at typical dispatch zoom levels ~14-16); it's an approximate
  // confidence indicator, not a survey-accurate overlay.
  if (unit.gps_accuracy != null && Number.isFinite(unit.gps_accuracy) && unit.gps_accuracy > 0) {
    const ring = document.createElement('div');
    ring.setAttribute('data-role', 'accuracy-ring');
    const { pixelRadius, marginTop } = computeAccuracyRingGeometry(unit.gps_accuracy);
    ring.style.cssText = `
      position:absolute;top:50%;left:50%;
      width:${pixelRadius * 2}px;height:${pixelRadius * 2}px;
      margin-left:-${pixelRadius}px;margin-top:${marginTop}px;
      border-radius:50%;background:${withAlpha(color, '22')};border:1px solid ${withAlpha(color, '55')};
      pointer-events:none;z-index:-1;
    `;
    inner.appendChild(ring);
  }

  return el;
}

/**
 * Update an existing marker's root element in place to reflect the unit's
 * current status/GPS-staleness, without touching its child node identity
 * (mapboxgl.Marker writes position transforms onto the exact root element
 * it was constructed with — replacing or clearing its children breaks that).
 */
export function applyUnitMarkerState(el: HTMLElement, unit: Unit): void {
  const color = UNIT_STATUS_COLORS[unit.status] || '#888888';
  const staleness = getMapUnitGpsStaleness(unit);
  // Opacity (and the position/transition styling) live on the inner wrapper,
  // not the mapboxgl-controlled root — see buildUnitMarkerEl.
  const inner = el.querySelector<HTMLElement>('[data-role="marker-inner"]') || el;
  inner.style.opacity = String(staleness === 'lost' ? 0.45 : staleness === 'stale' ? 0.7 : 1);
  el.title = `${unit.call_sign} — ${UNIT_STATUS_LABELS[unit.status] || unit.status}`
    + (staleness === 'lost' ? ' (GPS lost)' : staleness === 'stale' ? ' (GPS stale)' : '');

  const ringColor = staleness === 'ok' ? color : '#6b7280';
  const badge = el.querySelector<HTMLElement>('[data-role="badge"]');
  if (badge) {
    badge.style.filter = `drop-shadow(0 0 4px ${withAlpha(ringColor, 'b3')})`;
    const arrowFill = staleness === 'ok' ? color : ringColor;
    const svg = badge.querySelector('svg') as SVGSVGElement | null;
    const path = badge.querySelector('path') as SVGPathElement | null;
    if (svg && path) {
      const rotation = unit.gps_heading != null && Number.isFinite(unit.gps_heading) ? unit.gps_heading : 0;
      svg.style.transform = `rotate(${rotation}deg)`;
      path.setAttribute('fill', arrowFill);
      path.setAttribute('stroke', TACTICAL_BADGE_SURFACE);
    }
  }

  const label = el.querySelector<HTMLElement>('[data-role="label"]');
  if (label) {
    label.style.border = `1.2px solid ${color}`;
    label.style.color = color;
    label.textContent = unit.call_sign.slice(0, 6);
  }

  // Accuracy ring: remove and rebuild rather than resize in place — it's a
  // cheap DOM op at this element count and avoids drifting math between
  // build and update paths.
  const existingRing = el.querySelector('[data-role="accuracy-ring"]');
  if (existingRing) existingRing.remove();
  if (unit.gps_accuracy != null && Number.isFinite(unit.gps_accuracy) && unit.gps_accuracy > 0) {
    const ring = document.createElement('div');
    ring.setAttribute('data-role', 'accuracy-ring');
    const { pixelRadius, marginTop } = computeAccuracyRingGeometry(unit.gps_accuracy);
    ring.style.cssText = `
      position:absolute;top:50%;left:50%;
      width:${pixelRadius * 2}px;height:${pixelRadius * 2}px;
      margin-left:-${pixelRadius}px;margin-top:${marginTop}px;
      border-radius:50%;background:${withAlpha(color, '22')};border:1px solid ${withAlpha(color, '55')};
      pointer-events:none;z-index:-1;
    `;
    inner.appendChild(ring);
  }
}

/** Build HTML popup content for a unit. */
export function buildUnitPopupHtml(unit: Unit): string {
  const color = UNIT_STATUS_COLORS[unit.status] || '#888888';
  const statusLabel = UNIT_STATUS_LABELS[unit.status] || unit.status;
  const callInfo = unit.current_call_type
    ? `<div style="margin-top:4px;border-top:1px solid ${TACTICAL_BORDER};padding-top:4px;">
         <div style="color:${TACTICAL_BRAND_GOLD};font-size:9px;">ASSIGNED CALL</div>
         <div>${escapeHtml(unit.call_number)} — ${escapeHtml(formatIncidentType(unit.current_call_type))}</div>
         <div style="color:${TACTICAL_TEXT_MUTED};">${escapeHtml(unit.current_call_location)}</div>
       </div>`
    : '';
  return `
    <div style="background:${TACTICAL_SURFACE_RAISED};color:${TACTICAL_TEXT_PRIMARY};padding:8px 12px;border:1px solid ${TACTICAL_BORDER};border-radius:2px;font-family:system-ui,sans-serif;font-size:11px;min-width:160px;">
      <div style="font-weight:700;color:${TACTICAL_BRAND_GOLD};margin-bottom:2px;font-size:12px;">${escapeHtml(unit.call_sign)}</div>
      <div>${escapeHtml(unit.officer_name)}</div>
      <div>Status: <span style="color:${color};font-weight:600;">${escapeHtml(statusLabel)}</span></div>
      ${unit.vehicle ? `<div style="color:${TACTICAL_TEXT_MUTED};">Vehicle: ${escapeHtml(unit.vehicle)}</div>` : ''}
      ${callInfo}
    </div>`;
}

/** Build HTML for a call marker element. */
export function buildCallMarkerEl(call: ActiveCall): HTMLDivElement {
  const color = priorityHex(call.priority);
  // Root element handed to `new mapboxgl.Marker({ element: el })`. Mapbox GL
  // OVERWRITES this node's `style.transform` wholesale on every render frame,
  // so a `rotate(45deg)` written here is destroyed the instant the marker is
  // added — the diamond flattened to a square while the counter-rotated label
  // inside stayed tilted. Root carries position-neutral styling only; the
  // rotation lives on the inner wrapper below. Same contract as
  // buildUnitMarkerEl above.
  const el = document.createElement('div');
  el.className = 'rmpg-mbx-call';
  el.style.cssText = `display:block;cursor:pointer;`;

  const diamond = document.createElement('div');
  diamond.setAttribute('data-role', 'marker-inner');
  diamond.style.cssText = `
    width:22px;height:22px;
    background:${color};border:2px solid ${color};
    border-radius:2px;
    display:flex;align-items:center;justify-content:center;
    box-shadow:0 0 8px ${withAlpha(color, '99')};
  `;
  // Discrete assignment, not part of the cssText blob above: jsdom voids an
  // entire inline style when one cssText string mixes the `background`
  // shorthand with `border-radius` (documented in this file's test suite), so
  // the rotation that DEFINES this marker's shape must not ride in that blob.
  diamond.style.transform = 'rotate(45deg)';
  el.appendChild(diamond);

  const inner = document.createElement('span');
  inner.style.cssText = `font-size:8px;font-weight:700;color:${CALL_MARKER_INK};font-family:ui-monospace,monospace;`;
  inner.style.transform = 'rotate(-45deg)';
  // priorityLabel, not `P${call.priority}` — live rows store 'P1'..'P4', so the
  // hand-built prefix rendered "PP1" on the map.
  inner.textContent = priorityLabel(call.priority);
  diamond.appendChild(inner);
  el.title = `${call.call_number} — ${formatIncidentType(call.incident_type)}`;
  return el;
}

/** Build HTML popup for a call. */
export function buildCallPopupHtml(call: ActiveCall, queued: boolean = false): string {
  const color = priorityHex(call.priority);
  const flags = HAZARD_FLAGS
    .filter(f => (call as any)[f.key])
    .map(f => `<span style="background:${withAlpha(f.color, '22')};color:${f.color};padding:1px 4px;border-radius:2px;font-size:8px;font-weight:700;margin-right:3px;">${f.label}</span>`)
    .join('');
  const hasCoords = call.latitude != null && call.longitude != null;
  const addToRouteBtn = hasCoords
    ? queued
      ? `<button disabled style="margin-top:6px;width:100%;font:10px monospace;font-weight:700;color:#666;background:transparent;border:1px solid #333;padding:3px 6px;border-radius:2px;cursor:default;">✓ ON ROUTE</button>`
      : `<button data-action="add-to-route" data-call-number="${escapeHtml(call.call_number)}" style="margin-top:6px;width:100%;font:10px monospace;font-weight:700;color:#8b5cf6;background:transparent;border:1px solid #8b5cf6;padding:3px 6px;border-radius:2px;cursor:pointer;">+ ADD TO ROUTE</button>`
    : '';
  return `
    <div style="background:${TACTICAL_SURFACE_RAISED};color:${TACTICAL_TEXT_PRIMARY};padding:8px 12px;border:1px solid ${TACTICAL_BORDER};border-radius:2px;font-family:system-ui,sans-serif;font-size:11px;min-width:180px;">
      <div style="font-weight:700;color:${color};margin-bottom:2px;font-size:12px;">${escapeHtml(call.call_number)}</div>
      <div style="font-weight:600;">${escapeHtml(formatIncidentType(call.incident_type))}</div>
      <div>Priority: <span style="color:${color};font-weight:700;">${escapeHtml(priorityLabel(call.priority))}</span></div>
      <div>Status: ${escapeHtml(formatEnumValue(call.status))}</div>
      <div style="color:${TACTICAL_TEXT_MUTED};margin-top:2px;">${escapeHtml(call.location_address)}</div>
      ${call.cross_street ? `<div style="color:${TACTICAL_TEXT_DIM};font-size:10px;">X: ${escapeHtml(call.cross_street)}</div>` : ''}
      ${call.beat_name ? `<div style="color:${TACTICAL_TEXT_DIM};font-size:10px;">Beat: ${escapeHtml(call.beat_name)}</div>` : ''}
      ${flags ? `<div style="margin-top:4px;">${flags}</div>` : ''}
      ${addToRouteBtn}
    </div>`;
}

/**
 * Generic label/value detail popup, shared by every map layer whose click
 * handler just needs to surface a handful of fields (incidents, repeat
 * addresses, coverage gaps, response time, safety zones, call history,
 * pursuit tracks, GPS breadcrumbs) rather than a bespoke layout like units
 * or calls above. `rows` skips any entry whose value is null/undefined/''.
 */
export function buildDetailPopupHtml(
  title: string,
  rows: Array<[label: string, value: string | number | null | undefined]>,
  accentColor: string = TACTICAL_BRAND_GOLD,
): string {
  const rowsHtml = rows
    .filter(([, value]) => value != null && value !== '')
    .map(([label, value]) => `
      <div style="display:flex;justify-content:space-between;gap:10px;padding:2px 0;">
        <span style="color:${TACTICAL_TEXT_MUTED};">${escapeHtml(label)}</span>
        <span style="color:${TACTICAL_TEXT_PRIMARY};font-weight:600;text-align:right;">${escapeHtml(String(value))}</span>
      </div>`)
    .join('');
  return `
    <div style="background:${TACTICAL_SURFACE_RAISED};color:${TACTICAL_TEXT_PRIMARY};padding:8px 12px;border:1px solid ${TACTICAL_BORDER};border-radius:2px;font-family:system-ui,sans-serif;font-size:11px;min-width:180px;max-width:260px;">
      <div style="font-weight:700;color:${accentColor};margin-bottom:4px;font-size:12px;">${escapeHtml(title)}</div>
      ${rowsHtml}
    </div>`;
}

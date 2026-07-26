import type { MapUnit as Unit, ActiveCall } from './mapConstants';
import { UNIT_STATUS_COLORS, UNIT_STATUS_LABELS, PRIORITY_COLORS, priorityHex } from './mapConstants';
import { formatIncidentType } from '../../../utils/caseNumbers';
import { formatEnumValue } from '../../../utils/formatters';
import { escapeHtml } from '../../../utils/sanitize';
import { getGpsStaleness } from '../../../utils/gpsStaleness';
import { haversineDistance } from '../../../utils/unitRecommendation';
import {
  TACTICAL_SURFACE_RAISED, TACTICAL_BORDER, TACTICAL_TEXT_MUTED, TACTICAL_BRAND_GOLD,
  TACTICAL_TEXT_PRIMARY, TACTICAL_TEXT_DIM,
} from './tacticalPalette';

/** Ink for the marker's P{n} label. The fills are light (they must clear 3:1
 *  against the navy land), so the label is dark: with white ink the fill would
 *  need luminance <= 0.183 for 4.5:1 text AND >= 0.245 for 3:1 vs land, which
 *  is unsatisfiable. Measured >= 5.27:1 on every PRIORITY_HEX step. */
export const CALL_MARKER_INK = '#0d1520';

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

// Simple top-down vehicle glyph — deliberately basic (one <path>, no detail)
// so it stays legible at map scale; it's a silhouette, not an illustration.
const UNIT_GLYPH_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg">'
  + '<path d="M12 2 L19 9 L19 21 L15 21 L15 17 L9 17 L9 21 L5 21 L5 9 Z" fill="#0d1520"/></svg>';

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
    width:30px;height:30px;border-radius:50%;
    display:flex;align-items:center;justify-content:center;
    background:${color};
    border:2px ${staleness === 'ok' ? 'solid' : 'dashed'} ${staleness === 'ok' ? '#0d1520' : ringColor};
    box-shadow:0 0 8px ${ringColor}b3;
  `;
  badge.innerHTML = UNIT_GLYPH_SVG;
  // Rotate the whole badge to point in the direction of travel. Only applied
  // when heading is present and non-null — the server nulls implausible
  // headings (gps.ts bounds validation), so a present value is trustworthy.
  if (unit.gps_heading != null && Number.isFinite(unit.gps_heading)) {
    badge.style.transform = `rotate(${unit.gps_heading}deg)`;
  }
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
      border-radius:50%;background:${color}22;border:1px solid ${color}55;
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
    badge.style.background = color;
    badge.style.border = `2px ${staleness === 'ok' ? 'solid' : 'dashed'} ${staleness === 'ok' ? '#0d1520' : ringColor}`;
    badge.style.boxShadow = `0 0 8px ${ringColor}b3`;
    badge.style.transform = (unit.gps_heading != null && Number.isFinite(unit.gps_heading)) ? `rotate(${unit.gps_heading}deg)` : '';
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
      border-radius:50%;background:${color}22;border:1px solid ${color}55;
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
  const el = document.createElement('div');
  el.className = 'rmpg-mbx-call';
  el.style.cssText = `
    width:22px;height:22px;
    background:${color};border:2px solid ${color};
    transform:rotate(45deg);border-radius:2px;
    display:flex;align-items:center;justify-content:center;
    cursor:pointer;box-shadow:0 0 8px ${color}99;
  `;
  const inner = document.createElement('span');
  inner.style.cssText = `transform:rotate(-45deg);font-size:8px;font-weight:700;color:${CALL_MARKER_INK};font-family:ui-monospace,monospace;`;
  inner.textContent = `P${call.priority}`;
  el.appendChild(inner);
  el.title = `${call.call_number} — ${formatIncidentType(call.incident_type)}`;
  return el;
}

/** Build HTML popup for a call. */
export function buildCallPopupHtml(call: ActiveCall, queued: boolean = false): string {
  const color = PRIORITY_COLORS[call.priority] || '#888888';
  const flags = HAZARD_FLAGS
    .filter(f => (call as any)[f.key])
    .map(f => `<span style="background:${f.color}22;color:${f.color};padding:1px 4px;border-radius:2px;font-size:8px;font-weight:700;margin-right:3px;">${f.label}</span>`)
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
      <div>Priority: <span style="color:${color};font-weight:700;">P${escapeHtml(call.priority)}</span></div>
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

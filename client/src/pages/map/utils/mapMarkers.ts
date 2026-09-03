import type { MapUnit as Unit, ActiveCall } from './mapConstants';
import { UNIT_STATUS_COLORS, UNIT_STATUS_LABELS, priorityHex } from './mapConstants';
import { CALL_MARKER_INK, priorityLabel } from '../../../utils/statusColors';
import { formatIncidentType } from '../../../utils/caseNumbers';
import { formatEnumValue } from '../../../utils/formatters';
import { escapeHtml } from '../../../utils/sanitize';
import { getGpsStaleness } from '../../../utils/gpsStaleness';
import { haversineDistance } from '../../../utils/unitRecommendation';
import { withAlpha } from '../../../utils/withAlpha';
import { parseTimestamp } from '../../../utils/dateUtils';
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

/** `mm:ss`, zero-padded. Minutes are not capped at 59 — a >59min ETA is real data, not an overflow to hide. */
export function formatEtaSeconds(totalSeconds: number): string {
  const clamped = Math.max(0, Math.round(totalSeconds));
  const mm = Math.floor(clamped / 60);
  const ss = clamped % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

/** One decimal place, always shown (e.g. "0.0 mi", never "0 mi"). */
export function formatDistanceMiles(miles: number): string {
  return `${miles.toFixed(1)} mi`;
}

export interface EnRouteEta {
  etaSeconds: number;
  distanceMiles: number;
}

function buildEnRouteTagEl(callSign: string, enRoute: EnRouteEta): HTMLDivElement {
  const tag = document.createElement('div');
  tag.setAttribute('data-role', 'enroute-tag');
  tag.style.cssText = `
    background:#000;border:1px solid #1d4ed8;border-radius:2px;
    padding:3px 6px;display:grid;grid-template-columns:auto auto;gap:0 8px;
    font-family:'Arial, sans-serif';white-space:nowrap;
  `;
  const rows: Array<[string, string]> = [
    [callSign.slice(0, 6), 'ENROUTE'],
    [`ETA ${formatEtaSeconds(enRoute.etaSeconds)}`, `DIS ${formatDistanceMiles(enRoute.distanceMiles)}`],
  ];
  for (const [left, right] of rows) {
    const leftEl = document.createElement('span');
    leftEl.style.cssText = 'font-size:9px;font-weight:800;color:#e8f0ff;';
    leftEl.textContent = left;
    const rightEl = document.createElement('span');
    rightEl.style.cssText = 'font-size:9px;font-weight:700;color:#93c5fd;';
    rightEl.textContent = right;
    tag.appendChild(leftEl);
    tag.appendChild(rightEl);
  }
  return tag;
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
  { key: 'officer_safety_caution', label: 'OFFICER SAFETY', color: 'var(--sev-critical)' },
  { key: 'weapons_involved',       label: 'WEAPONS',        color: 'var(--sev-critical)' },
  { key: 'felony_in_progress',     label: 'FELONY',         color: 'var(--sev-high)' },
  { key: 'domestic_violence',      label: 'DV',             color: 'var(--sev-warn)' },
  { key: 'hazmat',                 label: 'HAZMAT',         color: 'var(--sev-warn)' },
  { key: 'mental_health_crisis',   label: 'MH CRISIS',     color: '#a855f7' },
  { key: 'gang_related',           label: 'GANG',           color: 'var(--sev-critical)' },
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
export function buildUnitMarkerEl(unit: Unit, enRoute?: EnRouteEta | null): HTMLDivElement {
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
    filter:drop-shadow(0 2px 4px rgba(0 0 0 / 0.6));
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
    font-family:'Arial, sans-serif';white-space:nowrap;
  `;
  label.textContent = unit.call_sign.slice(0, 6);
  inner.appendChild(label);

  // Speed readout below call sign — shows mph when moving
  if (unit.gps_speed != null && Number.isFinite(unit.gps_speed) && unit.gps_speed > 0.5) {
    const speedEl = document.createElement('div');
    speedEl.setAttribute('data-role', 'speed-label');
    const mph = Math.round(unit.gps_speed * 2.237);
    const speedColor = mph >= 75 ? '#ef4444' : mph >= 55 ? '#f97316' : mph >= 45 ? '#eab308' : '#93c5fd';
    speedEl.style.cssText = `
      font-size:8px;font-weight:700;font-family:'Arial, sans-serif';
      color:${speedColor};white-space:nowrap;line-height:1;
    `;
    speedEl.textContent = `${mph} mph`;
    inner.appendChild(speedEl);
  }

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

  if (unit.status === 'enroute' && enRoute) {
    inner.appendChild(buildEnRouteTagEl(unit.call_sign, enRoute));
  }

  return el;
}

/**
 * Update an existing marker's root element in place to reflect the unit's
 * current status/GPS-staleness, without touching its child node identity
 * (mapboxgl.Marker writes position transforms onto the exact root element
 * it was constructed with — replacing or clearing its children breaks that).
 */
export function applyUnitMarkerState(el: HTMLElement, unit: Unit, enRoute?: EnRouteEta | null): void {
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

  // Speed label: update or create/remove as speed changes
  const existingSpeed = el.querySelector<HTMLElement>('[data-role="speed-label"]');
  if (unit.gps_speed != null && Number.isFinite(unit.gps_speed) && unit.gps_speed > 0.5) {
    const mph = Math.round(unit.gps_speed * 2.237);
    const speedColor = mph >= 75 ? '#ef4444' : mph >= 55 ? '#f97316' : mph >= 45 ? '#eab308' : '#93c5fd';
    if (existingSpeed) {
      existingSpeed.textContent = `${mph} mph`;
      existingSpeed.style.color = speedColor;
    } else {
      const speedEl = document.createElement('div');
      speedEl.setAttribute('data-role', 'speed-label');
      speedEl.style.cssText = `
        font-size:8px;font-weight:700;font-family:'Arial, sans-serif';
        color:${speedColor};white-space:nowrap;line-height:1;
      `;
      speedEl.textContent = `${mph} mph`;
      const labelEl = el.querySelector('[data-role="label"]');
      if (labelEl && labelEl.nextSibling) {
        inner.insertBefore(speedEl, labelEl.nextSibling);
      } else {
        inner.appendChild(speedEl);
      }
    }
  } else if (existingSpeed) {
    existingSpeed.remove();
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

  const existingTag = el.querySelector('[data-role="enroute-tag"]');
  if (unit.status === 'enroute' && enRoute) {
    if (existingTag) existingTag.remove();
    inner.appendChild(buildEnRouteTagEl(unit.call_sign, enRoute));
  } else if (existingTag) {
    existingTag.remove();
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

/** Build HTML for a call marker element: rounded priority square + call-number label below. */
export function buildCallMarkerEl(call: ActiveCall): HTMLDivElement {
  const color = priorityHex(call.priority);
  const el = document.createElement('div');
  el.className = 'rmpg-mbx-call';
  el.style.cssText = `display:flex;flex-direction:column;align-items:center;gap:2px;cursor:pointer;`;

  const square = document.createElement('div');
  square.setAttribute('data-role', 'priority-square');
  square.style.cssText = `
    width:22px;height:22px;
    background:${color};border:2px solid ${color};
    display:flex;align-items:center;justify-content:center;
    box-shadow:0 0 8px ${withAlpha(color, '99')};
  `;
  // Discrete assignment, not part of the cssText blob above: jsdom's cssstyle
  // parser voids the ENTIRE inline style when one cssText string mixes the
  // `background` shorthand with `border-radius` (documented elsewhere in this
  // file's test suite), so border-radius must be set outside that blob for
  // `style.borderRadius` to read back correctly.
  square.style.borderRadius = '2px';
  const priorityText = document.createElement('span');
  priorityText.style.cssText = `font-size:8px;font-weight:700;color:${CALL_MARKER_INK};font-family:'Arial, sans-serif';`;
  // priorityLabel, not `P${call.priority}` — live rows store 'P1'..'P4', so the
  // hand-built prefix rendered "PP1" on the map.
  priorityText.textContent = priorityLabel(call.priority);
  square.appendChild(priorityText);
  el.appendChild(square);

  const numberLabel = document.createElement('div');
  numberLabel.setAttribute('data-role', 'call-number-label');
  numberLabel.style.cssText = `
    background:#101820;border:1.2px solid ${color};
    padding:1px 5px;font-size:8px;font-weight:700;
    font-family:'Arial, sans-serif';white-space:nowrap;
  `;
  // Discrete assignments for the same jsdom cssText-voiding reason as above —
  // border-radius and color must not ride in the same cssText blob as `background`.
  numberLabel.style.borderRadius = '2px';
  numberLabel.style.color = color;
  numberLabel.textContent = call.call_number;
  el.appendChild(numberLabel);

  el.title = `${call.call_number} — ${formatIncidentType(call.incident_type)}`;
  return el;
}

/**
 * Elapsed time since `createdAt`, as `HH:MM:SS` (hours segment grows past
 * 99 rather than rolling over — a call open for 100+ hours is a data
 * problem worth seeing, not something to hide by wrapping the display).
 * Returns null when createdAt is missing or unparseable so callers can
 * omit the timer row entirely instead of rendering "NaN:NaN:NaN".
 */
export function formatCallAge(createdAt: string | null | undefined, nowMs: number): string | null {
  if (!createdAt) return null;
  // parseTimestamp() never returns an Invalid Date — genuinely unparseable
  // input falls back to `new Date()` (now), which would silently render
  // "00:00:00" instead of omitting the row. Date.parse() here is only a
  // validity probe (its value is discarded); the actual elapsed time below
  // uses parseTimestamp's UTC-correct value, so this doesn't reintroduce
  // the naive-string/device-local timezone bug parseTimestamp exists to fix.
  if (!Number.isFinite(Date.parse(createdAt))) return null;
  // Server timestamps are naive UTC ("YYYY-MM-DD HH:MM:SS") — parseTimestamp
  // treats them as UTC before converting to a Date; the plain Date
  // constructor would parse that same string as device-local time, skewing
  // the timer by a full UTC offset (e.g. ~7h in Mountain Time).
  const createdMs = parseTimestamp(createdAt).getTime();
  const elapsedSec = Math.max(0, Math.floor((nowMs - createdMs) / 1000));
  const hh = Math.floor(elapsedSec / 3600);
  const mm = Math.floor((elapsedSec % 3600) / 60);
  const ss = elapsedSec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
}

/** Build HTML popup for a call: priority-colored header + call-age timer + labeled field table. */
export function buildCallPopupHtml(
  call: ActiveCall,
  queued: boolean = false,
  nowMs: number,
  assignedUnit?: { callSign: string; etaLabel?: string; distanceLabel?: string } | null,
): string {
  const color = priorityHex(call.priority);
  const age = formatCallAge(call.created_at, nowMs);
  const flags = HAZARD_FLAGS
    .filter(f => (call as any)[f.key])
    .map(f => `<span style="background:${withAlpha(f.color, '22')};color:${f.color};padding:1px 4px;border-radius:2px;font-size:8px;font-weight:700;margin-right:3px;">${f.label}</span>`)
    .join('');
  const hasCoords = call.latitude != null && call.longitude != null;
  const addToRouteBtn = hasCoords
    ? queued
      ? `<button disabled style="width:100%;font:10px monospace;font-weight:700;color:#666;background:transparent;border:none;border-top:1px solid ${TACTICAL_BORDER};padding:8px 6px;cursor:default;">✓ ON ROUTE</button>`
      : `<button data-action="add-to-route" data-call-number="${escapeHtml(call.call_number)}" style="width:100%;font:10px monospace;font-weight:700;color:#8b5cf6;background:transparent;border:none;border-top:1px solid ${TACTICAL_BORDER};padding:8px 6px;cursor:pointer;">+ ADD TO ROUTE</button>`
    : '';

  const fieldRows: Array<[string, string]> = [
    ['STATUS', escapeHtml(formatEnumValue(call.status)).toUpperCase()],
  ];
  if (call.beat_name) fieldRows.push(['BEAT', escapeHtml(call.beat_name)]);
  if (call.cross_street) fieldRows.push(['CROSS', escapeHtml(call.cross_street)]);
  fieldRows.push(['ADDRESS', escapeHtml(call.location_address)]);
  fieldRows.push(['UNIT', assignedUnit ? escapeHtml(assignedUnit.callSign) : '— unassigned —']);
  if (assignedUnit?.etaLabel) fieldRows.push(['ETA', escapeHtml(assignedUnit.etaLabel)]);
  if (assignedUnit?.distanceLabel) fieldRows.push(['DISTANCE', escapeHtml(assignedUnit.distanceLabel)]);

  const rowsHtml = fieldRows
    .map(([label, value]) => `
      <tr><td style="color:${TACTICAL_TEXT_MUTED};padding:2px 0;width:70px;vertical-align:top;">${label}</td><td style="color:${TACTICAL_TEXT_PRIMARY};">${value}</td></tr>`)
    .join('');

  return `
    <div style="background:${TACTICAL_SURFACE_RAISED};color:${TACTICAL_TEXT_PRIMARY};border:1px solid ${TACTICAL_BORDER};border-radius:2px;font-family:system-ui,sans-serif;font-size:11px;min-width:200px;overflow:hidden;">
      <div style="background:${color};padding:6px 10px;display:flex;justify-content:space-between;align-items:flex-start;">
        <div>
          <div style="font:800 12px monospace;color:${CALL_MARKER_INK};">${escapeHtml(call.call_number)}</div>
          ${age ? `<div style="font:700 10px monospace;color:${CALL_MARKER_INK};opacity:.75;margin-top:1px;">⏱ ${age} open</div>` : ''}
        </div>
        <span style="font:800 11px monospace;color:${CALL_MARKER_INK};background:rgba(0,0,0,.2);padding:1px 6px;border-radius:2px;">${escapeHtml(priorityLabel(call.priority))}</span>
      </div>
      <div style="padding:8px 10px 0;">
        <div style="font-weight:700;margin-bottom:6px;">${escapeHtml(formatIncidentType(call.incident_type))}</div>
        <table style="width:100%;font:11px monospace;border-collapse:collapse;">${rowsHtml}</table>
        ${flags ? `<div style="margin-top:6px;">${flags}</div>` : ''}
      </div>
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

// ---------------------------------------------------------------------------
// Shared mini-map / generic marker primitives (formerly client/src/utils/mapMarkers.ts)
// Moved here so the canonical path is pages/map/utils/mapMarkers.ts.
// ---------------------------------------------------------------------------

/**
 * Reject coordinates that Mapbox would happily plot but a human reading the
 * map would treat as a bug: NaN / Infinity, the exact (0, 0) no-fix signature
 * ClearPath GPS emits before its first GPS lock, and out-of-globe values.
 */
export function isValidLngLat(lng: unknown, lat: unknown): boolean {
  return (
    typeof lng === 'number' && typeof lat === 'number' &&
    Number.isFinite(lng) && Number.isFinite(lat) &&
    !(lng === 0 && lat === 0) &&
    Math.abs(lat) <= 90 && Math.abs(lng) <= 180
  );
}

export type UnitStatus =
  | 'in_service' | 'available' | 'enroute' | 'onscene' | 'busy'
  | 'out_of_service' | string;

const _GOLD = '#d4a017';
const _GREEN = '#22c55e';
const _RED = '#dc2626';
const _NEUTRAL = '#888888';

function _applyStyles(el: HTMLElement, styles: Record<string, string>): void {
  for (const [prop, value] of Object.entries(styles)) {
    el.style.setProperty(prop, value);
  }
}

export function unitStatusColor(status: UnitStatus | undefined): string {
  switch (status) {
    case 'in_service':
    case 'available':
      return _GREEN;
    case 'enroute':
    case 'onscene':
    case 'busy':
      return _GOLD;
    case 'out_of_service':
      return _NEUTRAL;
    default:
      return _NEUTRAL;
  }
}

export function callPriorityColor(priority: number | string | undefined): string {
  if (priority === undefined || priority === null) return _GOLD;
  const p = typeof priority === 'string' ? parseInt(priority, 10) : priority;
  if (Number.isNaN(p)) return _GOLD;
  if (p <= 2) return _RED;
  if (p <= 4) return _GOLD;
  return _NEUTRAL;
}

export interface UnitMarkerOpts {
  label?: string;
  status?: UnitStatus;
  heading?: number;
}

const _UNIT_GLYPH_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg">'
  + `<path d="M12 2 L19 9 L19 21 L15 21 L15 17 L9 17 L9 21 L5 21 L5 9 Z" fill="${TACTICAL_BADGE_SURFACE}"/></svg>`;

/** Bold solid-badge unit marker for mini-maps: status-colored disc + vehicle glyph + label. */
export function buildUnitMarker(opts: UnitMarkerOpts): HTMLElement {
  const color = unitStatusColor(opts.status);
  const el = document.createElement('div');
  el.dataset.statusColor = color;
  _applyStyles(el, {
    display: 'flex',
    'flex-direction': 'column',
    'align-items': 'center',
    gap: '2px',
    cursor: 'pointer',
  });

  const badge = document.createElement('div');
  _applyStyles(badge, {
    width: '30px',
    height: '30px',
    'border-radius': '50%',
    display: 'flex',
    'align-items': 'center',
    'justify-content': 'center',
    background: color,
    border: `2px solid ${TACTICAL_BADGE_SURFACE}`,
    'box-shadow': `0 0 8px ${withAlpha(color, 'b3')}`,
  });
  badge.innerHTML = _UNIT_GLYPH_SVG;
  el.appendChild(badge);

  if (opts.label) {
    const labelEl = document.createElement('div');
    _applyStyles(labelEl, {
      background: '#101820',
      border: `1.2px solid ${color}`,
      'border-radius': '2px',
      padding: '1px 6px',
      'font-size': '9px',
      'font-weight': '700',
      color,
      'font-family': "'Arial, sans-serif'",
      'white-space': 'nowrap',
    });
    labelEl.textContent = opts.label;
    el.appendChild(labelEl);
  }

  return el;
}

export interface CallMarkerOpts {
  priority?: number | string;
  label?: string;
}

/** Priority-colored teardrop call marker. */
export function buildCallMarker(opts: CallMarkerOpts): HTMLElement {
  const color = callPriorityColor(opts.priority);
  const el = document.createElement('div');
  el.dataset.priorityColor = color;
  _applyStyles(el, { display: 'block', cursor: 'pointer' });

  const teardrop = document.createElement('div');
  teardrop.setAttribute('data-role', 'marker-inner');
  _applyStyles(teardrop, {
    width: '20px',
    height: '20px',
    background: color,
    border: '1.5px solid #000000',
    'border-radius': '50% 50% 50% 0',
    transform: 'rotate(-45deg)',
    'box-shadow': '0 2px 4px rgba(0 0 0 / 0.6)',
  });
  el.appendChild(teardrop);

  if (opts.label) {
    const span = document.createElement('span');
    span.textContent = opts.label;
    _applyStyles(span, {
      display: 'block',
      transform: 'rotate(45deg)',
      'text-align': 'center',
      'font-size': '9px',
      'font-weight': '700',
      color: '#000',
      'line-height': '20px',
    });
    teardrop.appendChild(span);
  }
  return el;
}

export interface DotHalo {
  color: string;
  width?: number;
  shadowSpread?: number;
}

export interface DotMarkerOpts {
  color?: string;
  size?: number;
  pulse?: boolean;
  halo?: DotHalo;
}

/** Simple colored dot for sightings / track points. */
export function buildDotMarker(opts: DotMarkerOpts): HTMLElement {
  const color = opts.color || _GOLD;
  const size = opts.size ?? 10;
  const el = document.createElement('div');
  const halo = opts.halo;
  _applyStyles(el, {
    width: `${size}px`,
    height: `${size}px`,
    'border-radius': '50%',
    background: color,
    border: halo ? `${halo.width ?? 2}px solid ${halo.color}` : '1px solid #000000',
    'box-shadow': halo
      ? `0 0 ${halo.shadowSpread ?? 8}px 2px ${halo.color}`
      : `0 0 4px ${color}`,
  });
  if (opts.pulse) el.style.animation = 'rmpg-recovery-pulse 1.4s ease-in-out infinite';
  return el;
}

export const STATUS_COLORS = {
  online: _GREEN,      // #22c55e
  warning: _GOLD,      // #d4a017 (brand)
  caution: '#f59e0b',  // amber-500
  offline: _NEUTRAL,   // #888888
} as const;

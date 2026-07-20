import type { MapUnit as Unit, ActiveCall } from './mapConstants';
import { UNIT_STATUS_COLORS, UNIT_STATUS_LABELS, PRIORITY_COLORS } from './mapConstants';
import { formatIncidentType } from '../../../utils/caseNumbers';
import { formatEnumValue } from '../../../utils/formatters';
import { escapeHtml } from '../../../utils/sanitize';
import {
  TACTICAL_SURFACE_RAISED, TACTICAL_BORDER, TACTICAL_TEXT_MUTED, TACTICAL_BRAND_GOLD,
  TACTICAL_TEXT_PRIMARY, TACTICAL_TEXT_DIM,
} from './tacticalPalette';

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

// GPS staleness thresholds — must stay in sync with getGpsStaleStatus in
// UnitStatusBoard.tsx (>2min = stale/amber, >5min = lost/gray). Duplicated
// here rather than imported because that's a full React component file and
// this module is a headless DOM-builder; MapUnit's shape also differs
// slightly from the board's Unit type. A unit that stopped reporting GPS
// previously stayed full-brightness on the map indefinitely — operators had
// no way to tell a live position from a dot frozen since last contact.
function getMapUnitGpsStaleness(unit: Unit): 'ok' | 'stale' | 'lost' {
  if (!unit.gps_updated_at || unit.status === 'off_duty') return 'ok';
  const elapsed = Date.now() - new Date(unit.gps_updated_at.replace(' ', 'T') + (unit.gps_updated_at.includes('Z') ? '' : 'Z')).getTime();
  if (elapsed > 5 * 60 * 1000) return 'lost';
  if (elapsed > 2 * 60 * 1000) return 'stale';
  return 'ok';
}

// Simple top-down vehicle glyph — deliberately basic (one <path>, no detail)
// so it stays legible at map scale; it's a silhouette, not an illustration.
const UNIT_GLYPH_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg">'
  + '<path d="M12 2 L19 9 L19 21 L15 21 L15 17 L9 17 L9 21 L5 21 L5 9 Z" fill="#0d1520"/></svg>';

/** Build a bold solid-badge unit marker: status-colored disc + vehicle glyph + call-sign label. */
export function buildUnitMarkerEl(unit: Unit): HTMLDivElement {
  const color = UNIT_STATUS_COLORS[unit.status] || '#888888';
  const staleness = getMapUnitGpsStaleness(unit);
  const el = document.createElement('div');
  el.className = 'rmpg-mbx-unit';
  el.style.cssText = `
    display:flex;flex-direction:column;align-items:center;gap:2px;
    cursor:pointer;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.6));
    opacity:${staleness === 'lost' ? 0.45 : staleness === 'stale' ? 0.7 : 1};
  `;
  el.title = `${unit.call_sign} — ${UNIT_STATUS_LABELS[unit.status] || unit.status}`
    + (staleness === 'lost' ? ' (GPS lost)' : staleness === 'stale' ? ' (GPS stale)' : '');

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
  el.appendChild(badge);

  const label = document.createElement('div');
  label.setAttribute('data-role', 'label');
  label.style.cssText = `
    background:#101820;border:1.2px solid ${color};border-radius:2px;
    padding:1px 6px;font-size:9px;font-weight:700;color:${color};
    font-family:ui-monospace,monospace;white-space:nowrap;
  `;
  label.textContent = unit.call_sign.slice(0, 6);
  el.appendChild(label);

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
  el.style.opacity = String(staleness === 'lost' ? 0.45 : staleness === 'stale' ? 0.7 : 1);
  el.title = `${unit.call_sign} — ${UNIT_STATUS_LABELS[unit.status] || unit.status}`
    + (staleness === 'lost' ? ' (GPS lost)' : staleness === 'stale' ? ' (GPS stale)' : '');

  const ringColor = staleness === 'ok' ? color : '#6b7280';
  const badge = el.querySelector<HTMLElement>('[data-role="badge"]');
  if (badge) {
    badge.style.background = color;
    badge.style.border = `2px ${staleness === 'ok' ? 'solid' : 'dashed'} ${staleness === 'ok' ? '#0d1520' : ringColor}`;
    badge.style.boxShadow = `0 0 8px ${ringColor}b3`;
  }

  const label = el.querySelector<HTMLElement>('[data-role="label"]');
  if (label) {
    label.style.border = `1.2px solid ${color}`;
    label.style.color = color;
    label.textContent = unit.call_sign.slice(0, 6);
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
  const color = PRIORITY_COLORS[call.priority] || '#888888';
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
  inner.style.cssText = `transform:rotate(-45deg);font-size:8px;font-weight:700;color:#fff;font-family:ui-monospace,monospace;`;
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

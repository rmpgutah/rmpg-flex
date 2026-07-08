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

/** Build a fixed-orientation photo-icon unit marker: vehicle photo + status ring + call-sign label. */
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

  const photoFrame = document.createElement('div');
  photoFrame.setAttribute('data-role', 'photo-frame');
  const ringColor = staleness === 'ok' ? color : '#6b7280';
  photoFrame.style.cssText = `
    width:40px;height:40px;border-radius:4px;overflow:hidden;
    border:3px ${staleness === 'ok' ? 'solid' : 'dashed'} ${ringColor};
    box-shadow:0 0 6px ${ringColor}80;
    background:#0d1520;
  `;
  const img = document.createElement('img');
  img.src = '/icons/unit-vehicle.png';
  img.alt = '';
  img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
  // Fallback: if the photo fails to load (bad connectivity, missing asset),
  // never leave a broken-image icon on the map — swap to a plain
  // status-colored square instead.
  img.onerror = () => {
    photoFrame.style.background = color;
    img.remove();
  };
  photoFrame.appendChild(img);
  el.appendChild(photoFrame);

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
  const photoFrame = el.querySelector<HTMLElement>('[data-role="photo-frame"]');
  if (photoFrame) {
    photoFrame.style.border = `3px ${staleness === 'ok' ? 'solid' : 'dashed'} ${ringColor}`;
    photoFrame.style.boxShadow = `0 0 6px ${ringColor}80`;
    // Only touch background if the photo already fell back to a solid swatch
    // (img.onerror already removed the <img>) — otherwise leave the photo alone.
    if (!photoFrame.querySelector('img')) photoFrame.style.background = color;
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

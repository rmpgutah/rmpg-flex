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

/** Build HTML for a unit marker element. */
export function buildUnitMarkerEl(unit: Unit): HTMLDivElement {
  const color = UNIT_STATUS_COLORS[unit.status] || '#888888';
  const el = document.createElement('div');
  el.className = 'rmpg-mbx-unit';
  el.style.cssText = `
    width:32px;height:32px;border-radius:2px;
    background:${color};border:2px solid ${TACTICAL_BRAND_GOLD};
    display:flex;align-items:center;justify-content:center;
    font-size:9px;font-weight:700;color:#fff;
    font-family:ui-monospace,monospace;cursor:pointer;
    box-shadow:0 0 6px ${color}80;
    transition:box-shadow .2s;
  `;
  el.textContent = unit.call_sign.slice(0, 4);
  el.title = `${unit.call_sign} — ${UNIT_STATUS_LABELS[unit.status] || unit.status}`;
  return el;
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
export function buildCallPopupHtml(call: ActiveCall): string {
  const color = PRIORITY_COLORS[call.priority] || '#888888';
  const flags = HAZARD_FLAGS
    .filter(f => (call as any)[f.key])
    .map(f => `<span style="background:${f.color}22;color:${f.color};padding:1px 4px;border-radius:2px;font-size:8px;font-weight:700;margin-right:3px;">${f.label}</span>`)
    .join('');
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
    </div>`;
}

// ============================================================
// Map Info Window Builder — Tabbed HTML info windows
// ============================================================
// Returns raw HTML strings for google.maps.InfoWindow.setContent().
// Uses CSS-only tabs (radio button :checked trick, no JS needed).
// ============================================================

import { escapeHtml } from '../../../utils/sanitize';
import { formatIncidentType } from '../../../utils/caseNumbers';
import { UNIT_STATUS_HEX, UNIT_STATUS_LABELS, PRIORITY_HEX } from '../../../utils/statusColors';
import type { MapUnit, ActiveCall, MapProperty } from './mapConstants';

// Unique prefix to avoid ID collisions when multiple info windows exist
let _iwCounter = 0;
function nextId(): string { return `iw${++_iwCounter}`; }

// ── Shared styles ────────────────────────────────────────────

const FONT_MONO = "'Courier New','JetBrains Mono',monospace";
const FONT_SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
const C_BASE = '#141e2b';
const C_SUNKEN = '#0d1520';
const C_RAISED = '#1a2636';
const C_BORDER = '#1e3048';
const C_TEXT = '#e5e7eb';
const C_TEXT_DIM = '#9ca3af';
const C_TEXT_MUTED = '#5a6e80';
const C_BLUE = '#60a5fa';
const C_BRAND = '#1a5a9e';
const C_GOLD = '#d4a017';

function tabStyles(id: string): string {
  return `
    <style>
      #${id} input[type=radio]{display:none}
      #${id} .iw-tabs{display:flex;border-bottom:1px solid ${C_BORDER};margin-bottom:8px}
      #${id} .iw-tab-label{padding:4px 10px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:${C_TEXT_MUTED};cursor:pointer;border-bottom:2px solid transparent;font-family:${FONT_SANS};transition:color 0.15s,border-color 0.15s;user-select:none}
      #${id} .iw-tab-label:hover{color:${C_TEXT_DIM}}
      #${id} .iw-panel{display:none;max-height:260px;overflow-y:auto;scrollbar-width:thin;scrollbar-color:${C_BORDER} transparent}
      #${id} .iw-panel::-webkit-scrollbar{width:4px}
      #${id} .iw-panel::-webkit-scrollbar-thumb{background:${C_BORDER};border-radius:2px}
      #${id} input[type=radio]:nth-of-type(1):checked ~ .iw-tabs .iw-tab-label:nth-of-type(1),
      #${id} input[type=radio]:nth-of-type(2):checked ~ .iw-tabs .iw-tab-label:nth-of-type(2),
      #${id} input[type=radio]:nth-of-type(3):checked ~ .iw-tabs .iw-tab-label:nth-of-type(3){color:${C_BLUE};border-bottom-color:${C_BLUE}}
      #${id} input[type=radio]:nth-of-type(1):checked ~ .iw-panel:nth-of-type(1),
      #${id} input[type=radio]:nth-of-type(2):checked ~ .iw-panel:nth-of-type(2),
      #${id} input[type=radio]:nth-of-type(3):checked ~ .iw-panel:nth-of-type(3){display:block}
    </style>`;
}

function led(color: string, size = 8): string {
  return `<span style="display:inline-block;width:${size}px;height:${size}px;border-radius:50%;background:${color};box-shadow:0 0 6px ${color}80;flex-shrink:0;"></span>`;
}

function badge(text: string, bg: string, fg: string): string {
  return `<span style="display:inline-block;padding:1px 6px;font-size:8px;font-weight:800;letter-spacing:0.5px;text-transform:uppercase;background:${bg};color:${fg};border:1px solid ${fg}40;border-radius:2px;font-family:${FONT_MONO};">${escapeHtml(text)}</span>`;
}

function routeButton(unitCallSign: string, callNumber: string, uLat: number, uLng: number, cLat: number, cLng: number, label?: string): string {
  return `<button data-route-unit="${escapeHtml(unitCallSign)}" data-route-call="${escapeHtml(callNumber)}"
    data-route-ulat="${uLat}" data-route-ulng="${uLng}"
    data-route-clat="${cLat}" data-route-clng="${cLng}"
    style="padding:2px 8px;background:${C_BRAND}30;border:1px solid ${C_BRAND}80;color:${C_BLUE};font-size:8px;font-weight:900;font-family:${FONT_MONO};cursor:pointer;letter-spacing:0.5px;text-transform:uppercase;border-radius:2px;">
    &#9654; ${escapeHtml(label || 'ROUTE')}
  </button>`;
}

function dataRow(label: string, value: string, valueColor = C_TEXT): string {
  if (!value) return '';
  return `<div style="display:flex;justify-content:space-between;align-items:baseline;padding:2px 0;">
    <span style="font-size:8px;color:${C_TEXT_MUTED};font-family:${FONT_SANS};text-transform:uppercase;letter-spacing:0.5px;">${label}</span>
    <span style="font-size:10px;color:${valueColor};font-family:${FONT_MONO};font-weight:600;max-width:65%;text-align:right;word-break:break-word;">${escapeHtml(value)}</span>
  </div>`;
}

function sectionHeader(text: string, color = C_TEXT_MUTED): string {
  return `<div style="font-size:8px;color:${color};font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;margin-top:2px;font-family:${FONT_SANS};">${text}</div>`;
}

function emptyState(text: string): string {
  return `<div style="font-size:9px;color:${C_TEXT_MUTED};text-align:center;padding:12px 0;">${escapeHtml(text)}</div>`;
}

function formatTimestamp(ts: string | null | undefined): string {
  if (!ts) return '--';
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  } catch { return '--'; }
}

function formatDateTime(ts: string | null | undefined): string {
  if (!ts) return '--';
  try {
    const d = new Date(ts);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' +
           d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  } catch { return '--'; }
}

// ── Unit Info Window ─────────────────────────────────────────

export interface UnitInfoData extends MapUnit {
  last_gps_update?: string | null;
}

export function buildUnitInfoWindow(
  unit: UnitInfoData,
  assignedCall?: ActiveCall | null,
  _routeCallback?: string,
): string {
  const id = nextId();
  const statusColor = UNIT_STATUS_HEX[unit.status] || C_TEXT_MUTED;
  const statusLabel = UNIT_STATUS_LABELS[unit.status] || unit.status.replace(/_/g, ' ');
  const gpsSource = unit.gps_source || 'unknown';

  // Overview tab
  const overviewTab = `
    ${dataRow('Officer', unit.officer_name, C_TEXT)}
    ${dataRow('Status', statusLabel, statusColor)}
    ${unit.vehicle ? dataRow('Vehicle', unit.vehicle, C_TEXT_DIM) : ''}
    ${dataRow('GPS Source', gpsSource, gpsSource === 'device' ? '#22d3ee' : gpsSource === 'manual' ? C_GOLD : C_TEXT_MUTED)}
    ${unit.last_gps_update ? dataRow('Last Update', formatTimestamp(unit.last_gps_update), C_TEXT_DIM) : ''}
  `;

  // Assignment tab
  let assignmentTab = '';
  if (assignedCall) {
    const pColor = PRIORITY_HEX[assignedCall.priority] || C_TEXT_MUTED;
    const hasRoute = assignedCall.latitude != null && assignedCall.longitude != null && unit.latitude != null && unit.longitude != null;
    assignmentTab = `
      <div style="margin-bottom:6px;">${badge(assignedCall.priority, pColor + '25', pColor)}</div>
      ${dataRow('Call #', assignedCall.call_number, C_BLUE)}
      ${dataRow('Type', formatIncidentType(assignedCall.incident_type), pColor)}
      ${dataRow('Location', assignedCall.location_address, C_TEXT_DIM)}
      ${dataRow('Status', assignedCall.status.replace(/_/g, ' '), C_TEXT_DIM)}
      ${assignedCall.property_name ? dataRow('Property', assignedCall.property_name, C_GOLD) : ''}
      ${hasRoute ? `<div style="margin-top:8px;text-align:center;">${routeButton(unit.call_sign, assignedCall.call_number, unit.latitude!, unit.longitude!, assignedCall.latitude!, assignedCall.longitude!, 'Route to Call')}</div>` : ''}
    `;
  } else {
    assignmentTab = emptyState('No active assignment');
  }

  // History tab — shows current status context
  const historyTab = `
    <div style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid ${C_BORDER}30;">
      ${led(statusColor, 6)}
      <span style="font-size:9px;color:${statusColor};font-weight:700;font-family:${FONT_MONO};">${escapeHtml(statusLabel.toUpperCase())}</span>
      <span style="font-size:8px;color:${C_TEXT_MUTED};margin-left:auto;">Current</span>
    </div>
    ${unit.call_number ? `
      <div style="padding:4px 0;font-size:9px;color:${C_TEXT_DIM};">
        Assigned to <span style="color:${C_BLUE};font-weight:700;">${escapeHtml(unit.call_number)}</span>
        ${unit.current_call_type ? `<span style="color:${C_TEXT_MUTED};"> &mdash; ${escapeHtml(formatIncidentType(unit.current_call_type))}</span>` : ''}
      </div>
    ` : ''}
    ${emptyState('Full history not available in map view')}
  `;

  return `
    ${tabStyles(id)}
    <div id="${id}" style="width:320px;font-family:${FONT_MONO};background:${C_SUNKEN};color:${C_TEXT};padding:10px;border:1px solid ${statusColor}50;border-radius:2px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid ${C_BORDER};">
        ${led(statusColor, 10)}
        <span style="font-weight:900;font-size:15px;color:${statusColor};letter-spacing:-0.5px;">${escapeHtml(unit.call_sign)}</span>
        <span style="margin-left:auto;">${badge(statusLabel, statusColor + '20', statusColor)}</span>
      </div>
      <input type="radio" name="${id}" id="${id}_t1" checked>
      <input type="radio" name="${id}" id="${id}_t2">
      <input type="radio" name="${id}" id="${id}_t3">
      <div class="iw-tabs">
        <label class="iw-tab-label" for="${id}_t1">Overview</label>
        <label class="iw-tab-label" for="${id}_t2">Assignment</label>
        <label class="iw-tab-label" for="${id}_t3">History</label>
      </div>
      <div class="iw-panel">${overviewTab}</div>
      <div class="iw-panel">${assignmentTab}</div>
      <div class="iw-panel">${historyTab}</div>
    </div>
  `;
}

// ── Call Info Window ─────────────────────────────────────────

export interface CallInfoData extends ActiveCall {
  source?: string | null;
  disposition?: string | null;
  created_at?: string | null;
  dispatched_at?: string | null;
  first_enroute_at?: string | null;
  first_onscene_at?: string | null;
  cleared_at?: string | null;
}

export function buildCallInfoWindow(
  call: CallInfoData,
  assignedUnits?: MapUnit[],
  _routeCallback?: string,
): string {
  const id = nextId();
  const pColor = PRIORITY_HEX[call.priority] || C_TEXT_MUTED;
  const unitsList = assignedUnits || [];

  // Overview tab
  const overviewTab = `
    <div style="margin-bottom:6px;display:flex;align-items:center;gap:6px;">
      ${badge(call.priority, pColor + '25', pColor)}
      <span style="font-size:10px;color:${pColor};font-weight:800;font-family:${FONT_MONO};">${escapeHtml(formatIncidentType(call.incident_type))}</span>
    </div>
    ${dataRow('Call #', call.call_number, C_BLUE)}
    ${dataRow('Location', call.location_address, C_TEXT)}
    ${call.property_name ? dataRow('Property', call.property_name, C_GOLD) : ''}
    ${dataRow('Status', call.status.replace(/_/g, ' '), C_TEXT_DIM)}
    ${call.source ? dataRow('Source', call.source, C_TEXT_DIM) : ''}
    ${call.disposition ? dataRow('Disposition', call.disposition, C_TEXT_DIM) : ''}
  `;

  // Units tab
  let unitsTab = '';
  if (unitsList.length > 0) {
    unitsTab = `
      ${sectionHeader(`Assigned Units (${unitsList.length})`)}
      ${unitsList.map(u => {
        const uc = UNIT_STATUS_HEX[u.status] || C_TEXT_MUTED;
        const uLabel = UNIT_STATUS_LABELS[u.status] || u.status;
        const hasRoute = u.latitude != null && u.longitude != null && call.latitude != null && call.longitude != null;
        return `<div style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid ${C_BORDER}20;">
          ${led(uc, 6)}
          <span style="font-size:10px;color:${uc};font-weight:700;font-family:${FONT_MONO};">${escapeHtml(u.call_sign)}</span>
          <span style="font-size:9px;color:${C_TEXT_DIM};flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(u.officer_name)}</span>
          <span style="font-size:7px;color:${uc};opacity:0.7;">${escapeHtml(uLabel)}</span>
          ${hasRoute ? routeButton(u.call_sign, call.call_number, u.latitude!, u.longitude!, call.latitude!, call.longitude!) : ''}
        </div>`;
      }).join('')}
    `;
  } else {
    unitsTab = emptyState('No units assigned');
  }

  // Timeline tab
  const timelineItems: Array<{ label: string; ts: string | null | undefined; color: string }> = [
    { label: 'Created', ts: call.created_at, color: C_TEXT_DIM },
    { label: 'Dispatched', ts: call.dispatched_at, color: '#f59e0b' },
    { label: 'First En Route', ts: call.first_enroute_at, color: '#3b82f6' },
    { label: 'First On Scene', ts: call.first_onscene_at, color: '#a855f7' },
    { label: 'Cleared', ts: call.cleared_at, color: '#22c55e' },
  ];

  const timelineTab = `
    ${sectionHeader('Call Timeline')}
    ${timelineItems.map((item, i) => {
      const filled = !!item.ts;
      return `<div style="display:flex;align-items:center;gap:8px;padding:4px 0;${i < timelineItems.length - 1 ? `border-left:2px solid ${filled ? item.color + '50' : C_BORDER}30;margin-left:4px;padding-left:12px;` : 'margin-left:4px;padding-left:12px;border-left:2px solid transparent;'}">
        <span style="position:relative;left:-17px;display:inline-block;width:8px;height:8px;border-radius:50%;background:${filled ? item.color : C_BORDER};box-shadow:${filled ? `0 0 4px ${item.color}60` : 'none'};flex-shrink:0;"></span>
        <span style="font-size:9px;color:${filled ? item.color : C_TEXT_MUTED};font-weight:600;font-family:${FONT_SANS};margin-left:-12px;">${item.label}</span>
        <span style="font-size:9px;color:${filled ? C_TEXT : C_TEXT_MUTED};font-family:${FONT_MONO};margin-left:auto;">${filled ? formatTimestamp(item.ts) : '--'}</span>
      </div>`;
    }).join('')}
  `;

  return `
    ${tabStyles(id)}
    <div id="${id}" style="width:320px;font-family:${FONT_MONO};background:${C_SUNKEN};color:${C_TEXT};padding:10px;border:1px solid ${pColor}50;border-radius:2px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid ${C_BORDER};">
        <span style="background:${pColor};color:#fff;padding:2px 8px;font-size:10px;font-weight:900;letter-spacing:0.5px;border-radius:2px;">${escapeHtml(call.priority)}</span>
        <span style="font-weight:900;font-size:13px;color:${pColor};flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(call.call_number)}</span>
      </div>
      <input type="radio" name="${id}" id="${id}_t1" checked>
      <input type="radio" name="${id}" id="${id}_t2">
      <input type="radio" name="${id}" id="${id}_t3">
      <div class="iw-tabs">
        <label class="iw-tab-label" for="${id}_t1">Overview</label>
        <label class="iw-tab-label" for="${id}_t2">Units</label>
        <label class="iw-tab-label" for="${id}_t3">Timeline</label>
      </div>
      <div class="iw-panel">${overviewTab}</div>
      <div class="iw-panel">${unitsTab}</div>
      <div class="iw-panel">${timelineTab}</div>
    </div>
  `;
}

// ── Property Info Window ─────────────────────────────────────

export interface PropertyDetails {
  property_type?: string | null;
  emergency_contact?: string | null;
  gate_code?: string | null;
  alarm_code?: string | null;
  access_instructions?: string | null;
  client_contact?: string | null;
  client_phone?: string | null;
  sla_response_minutes?: number | null;
  hazard_notes?: string | null;
  post_orders?: string | null;
  recentCalls?: Array<{
    call_number?: string;
    incident_type?: string;
    status?: string;
    created_at?: string;
  }>;
  todaySchedules?: Array<{
    officer_name?: string;
    shift_type?: string;
  }>;
  linkedPersons?: Array<{
    first_name: string;
    last_name: string;
    relationship?: string;
    title?: string;
    flags?: string;
  }>;
}

export function buildPropertyInfoWindow(
  prop: MapProperty,
  details?: PropertyDetails | null,
): string {
  const id = nextId();

  if (!details) {
    // Loading / fallback state
    return `
      <div style="min-width:200px;font-family:${FONT_MONO};background:${C_SUNKEN};color:${C_TEXT};padding:12px;border:1px solid ${C_BLUE}50;border-radius:2px;">
        <div style="font-weight:900;font-size:13px;color:${C_BLUE};margin-bottom:4px;">${escapeHtml(prop.name)}</div>
        <div style="font-size:10px;color:${C_TEXT_DIM};">Loading details...</div>
      </div>
    `;
  }

  const RELATIONSHIP_COLORS: Record<string, string> = {
    employee: '#22d3ee', contact: '#60a5fa', tenant: '#a78bfa', owner: '#4ade80',
    manager: '#d4a017', subject: '#f59e0b', trespass_warning: '#ef4444',
    banned: '#ef4444', frequent_visitor: '#9ca3af', associated: '#6b7280',
  };

  const recentCalls = details.recentCalls || [];
  const linkedPersons = details.linkedPersons || [];
  const schedules = details.todaySchedules || [];

  // Overview tab
  const overviewTab = `
    ${dataRow('Address', prop.address, C_TEXT)}
    ${prop.client_name ? dataRow('Client', prop.client_name, C_GOLD) : ''}
    ${details.property_type ? dataRow('Type', details.property_type, C_TEXT_DIM) : ''}
    ${details.emergency_contact ? dataRow('Emergency', details.emergency_contact, '#f87171') : ''}
    ${details.gate_code ? dataRow('Gate Code', details.gate_code, '#22d3ee') : ''}
    ${details.alarm_code ? dataRow('Alarm Code', details.alarm_code, '#f59e0b') : ''}
    ${details.access_instructions ? `
      <div style="margin-top:4px;padding:3px 5px;background:${C_RAISED};border:1px solid ${C_BORDER};border-radius:2px;">
        <span style="font-size:7px;color:${C_TEXT_MUTED};text-transform:uppercase;letter-spacing:0.5px;">Access</span>
        <div style="font-size:9px;color:${C_TEXT_DIM};margin-top:1px;">${escapeHtml(details.access_instructions)}</div>
      </div>
    ` : ''}
    ${details.sla_response_minutes ? `
      <div style="margin-top:6px;font-size:8px;color:#4ade80;font-weight:600;">SLA: ${details.sla_response_minutes} min response</div>
    ` : ''}
    ${details.hazard_notes ? `
      <div style="margin-top:4px;padding:3px 5px;background:#f8717110;border:1px solid #f8717130;border-radius:2px;">
        <span style="font-size:8px;color:#f87171;font-weight:700;">&#9888; HAZARD</span>
        <div style="font-size:8px;color:#f87171;margin-top:1px;">${escapeHtml(details.hazard_notes)}</div>
      </div>
    ` : ''}
    ${schedules.length > 0 ? `
      <div style="margin-top:6px;padding-top:4px;border-top:1px solid ${C_BORDER};">
        ${sectionHeader("Today's Officers")}
        ${schedules.map(s => `
          <div style="font-size:9px;color:${C_TEXT_DIM};padding:1px 0;">
            <span style="color:#22d3ee;">&#9679;</span> ${escapeHtml(s.officer_name || 'Unassigned')}
            ${s.shift_type ? `<span style="color:${C_TEXT_MUTED};margin-left:4px;">${escapeHtml(s.shift_type)}</span>` : ''}
          </div>
        `).join('')}
      </div>
    ` : ''}
  `;

  // History tab — recent calls
  let historyTab = '';
  if (recentCalls.length > 0) {
    historyTab = `
      ${sectionHeader(`Call History (${recentCalls.length})`)}
      ${recentCalls.slice(0, 5).map(c => {
        const statusColor = (c.status === 'cleared' || c.status === 'closed') ? '#4ade80' : c.status === 'pending' ? '#fbbf24' : C_BLUE;
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:3px 0;border-bottom:1px solid ${C_BORDER}20;">
          <div style="overflow:hidden;flex:1;">
            <span style="color:#93c5fd;font-size:9px;font-weight:700;">${escapeHtml(c.call_number || '')}</span>
            <span style="color:${C_TEXT_MUTED};font-size:8px;margin-left:4px;">${escapeHtml((c.incident_type || '').replace(/_/g, ' '))}</span>
          </div>
          <div style="text-align:right;flex-shrink:0;margin-left:6px;">
            <span style="color:${statusColor};font-size:8px;font-weight:600;">${escapeHtml(c.status || '')}</span>
            <div style="color:${C_TEXT_MUTED};font-size:7px;">${formatDateTime(c.created_at)}</div>
          </div>
        </div>`;
      }).join('')}
      ${recentCalls.length > 5 ? `<div style="font-size:8px;color:${C_TEXT_MUTED};text-align:center;margin-top:4px;">+${recentCalls.length - 5} more</div>` : ''}
    `;
  } else {
    historyTab = emptyState('No recent calls');
  }

  // Contacts tab — linked persons, client contact, post orders
  let contactsTab = '';

  if (details.client_contact || details.client_phone) {
    contactsTab += `
      ${sectionHeader('Client Contact', '#a78bfa')}
      ${details.client_contact ? `<div style="font-size:9px;color:${C_TEXT_DIM};">${escapeHtml(details.client_contact)}</div>` : ''}
      ${details.client_phone ? `<div style="font-size:9px;color:#93c5fd;">${escapeHtml(details.client_phone)}</div>` : ''}
    `;
  }

  if (linkedPersons.length > 0) {
    contactsTab += `
      <div style="${details.client_contact ? `margin-top:6px;padding-top:4px;border-top:1px solid ${C_BORDER};` : ''}">
        ${sectionHeader(`Linked Persons (${linkedPersons.length})`, '#e879f9')}
        ${linkedPersons.slice(0, 8).map(p => {
          const relColor = RELATIONSHIP_COLORS[p.relationship || ''] || '#6b7280';
          const name = `${p.first_name} ${p.last_name}`;
          const rel = (p.relationship || '').replace(/_/g, ' ');
          let flagsArr: string[] = [];
          try { flagsArr = JSON.parse(p.flags || '[]'); } catch { /* ignore */ }
          const hasWarning = flagsArr.includes('trespass') || flagsArr.includes('violent') || flagsArr.includes('armed') || p.relationship === 'trespass_warning' || p.relationship === 'banned';
          return `<div style="display:flex;justify-content:space-between;align-items:center;padding:3px 0;border-bottom:1px solid ${C_BORDER}20;">
            <div style="display:flex;align-items:center;gap:4px;overflow:hidden;">
              ${hasWarning ? '<span style="color:#ef4444;font-size:8px;">&#9888;</span>' : ''}
              <span style="color:${C_TEXT};font-size:9px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(name)}</span>
              ${p.title ? `<span style="color:${C_TEXT_MUTED};font-size:7px;">${escapeHtml(p.title)}</span>` : ''}
            </div>
            <span style="color:${relColor};font-size:7px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;flex-shrink:0;margin-left:4px;">${escapeHtml(rel)}</span>
          </div>`;
        }).join('')}
        ${linkedPersons.length > 8 ? `<div style="font-size:8px;color:${C_TEXT_MUTED};text-align:center;margin-top:4px;">+${linkedPersons.length - 8} more</div>` : ''}
      </div>
    `;
  }

  if (details.post_orders) {
    contactsTab += `
      <div style="margin-top:6px;padding-top:4px;border-top:1px solid ${C_BORDER};">
        ${sectionHeader('Post Orders', C_TEXT_DIM)}
        <div style="font-size:8px;color:${C_TEXT_DIM};line-height:1.4;">${escapeHtml(details.post_orders.substring(0, 200))}${details.post_orders.length > 200 ? '&hellip;' : ''}</div>
      </div>
    `;
  }

  if (!contactsTab) {
    contactsTab = emptyState('No contacts on file');
  }

  return `
    ${tabStyles(id)}
    <div id="${id}" style="width:380px;font-family:${FONT_MONO};background:${C_SUNKEN};color:${C_TEXT};padding:10px;border:1px solid ${C_BLUE}50;border-radius:2px;">
      <div style="margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid ${C_BORDER};">
        <div style="font-weight:900;font-size:13px;color:${C_BLUE};margin-bottom:2px;">${escapeHtml(prop.name)}</div>
        ${prop.client_name ? `<div style="font-size:9px;color:${C_GOLD};font-weight:600;">Client: ${escapeHtml(prop.client_name)}</div>` : ''}
      </div>
      <input type="radio" name="${id}" id="${id}_t1" checked>
      <input type="radio" name="${id}" id="${id}_t2">
      <input type="radio" name="${id}" id="${id}_t3">
      <div class="iw-tabs">
        <label class="iw-tab-label" for="${id}_t1">Overview</label>
        <label class="iw-tab-label" for="${id}_t2">History</label>
        <label class="iw-tab-label" for="${id}_t3">Contacts</label>
      </div>
      <div class="iw-panel">${overviewTab}</div>
      <div class="iw-panel">${historyTab}</div>
      <div class="iw-panel">${contactsTab}</div>
    </div>
  `;
}

// ── Error / Fallback Property Window ─────────────────────────

export function buildPropertyFallbackWindow(prop: MapProperty): string {
  return `
    <div style="min-width:160px;font-family:${FONT_MONO};background:${C_SUNKEN};color:${C_TEXT};padding:10px;border:1px solid ${C_BLUE}50;border-radius:2px;">
      <div style="font-weight:900;font-size:13px;color:${C_BLUE};margin-bottom:4px;">${escapeHtml(prop.name)}</div>
      <div style="font-size:10px;color:${C_TEXT_DIM};">${escapeHtml(prop.address)}</div>
      ${prop.client_name ? `<div style="font-size:9px;margin-top:6px;color:${C_GOLD};font-weight:600;">Client: ${escapeHtml(prop.client_name)}</div>` : ''}
    </div>
  `;
}

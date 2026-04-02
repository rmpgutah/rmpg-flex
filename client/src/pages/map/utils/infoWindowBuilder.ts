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
const C_BRAND = '#888888';
const C_GOLD = '#d4a017';
const C_RED = '#f87171';
const C_GREEN = '#4ade80';
const C_AMBER = '#fbbf24';
const C_PURPLE = '#a78bfa';

function tabStyles(id: string): string {
  return `
    <style>
      #${id} input[type=radio]{display:none}
      #${id} .iw-tabs{display:flex;border-bottom:1px solid ${C_BORDER};margin-bottom:8px}
      #${id} .iw-tab-label{padding:4px 10px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:${C_TEXT_MUTED};cursor:pointer;border-bottom:2px solid transparent;font-family:${FONT_SANS};transition:color 0.15s,border-color 0.15s,background 0.15s;user-select:none}
      #${id} .iw-tab-label:hover{color:${C_TEXT_DIM};background:${C_RAISED}}
      #${id} .iw-panel{display:none;max-height:260px;overflow-y:auto;scrollbar-width:thin;scrollbar-color:${C_BORDER} transparent;transition:opacity 0.15s ease}
      #${id} .iw-panel::-webkit-scrollbar{width:4px}
      #${id} .iw-panel::-webkit-scrollbar-thumb{background:${C_BORDER};border-radius:4px}
      #${id} .iw-panel::-webkit-scrollbar-thumb:hover{background:${C_TEXT_MUTED}}
      #${id} input[type=radio]:nth-of-type(1):checked ~ .iw-tabs .iw-tab-label:nth-of-type(1),
      #${id} input[type=radio]:nth-of-type(2):checked ~ .iw-tabs .iw-tab-label:nth-of-type(2),
      #${id} input[type=radio]:nth-of-type(3):checked ~ .iw-tabs .iw-tab-label:nth-of-type(3),
      #${id} input[type=radio]:nth-of-type(4):checked ~ .iw-tabs .iw-tab-label:nth-of-type(4){color:${C_BLUE};border-bottom-color:${C_BLUE};transform:translateY(0);box-shadow:0 1px 0 ${C_BLUE}40}
      #${id} input[type=radio]:nth-of-type(1):checked ~ .iw-panel:nth-of-type(1),
      #${id} input[type=radio]:nth-of-type(2):checked ~ .iw-panel:nth-of-type(2),
      #${id} input[type=radio]:nth-of-type(3):checked ~ .iw-panel:nth-of-type(3),
      #${id} input[type=radio]:nth-of-type(4):checked ~ .iw-panel:nth-of-type(4){display:block}
      @keyframes pulse-led{0%,100%{opacity:1}50%{opacity:0.5}}
      @keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
    </style>`;
}

function led(color: string, size = 8): string {
  return `<span style="display:inline-block;width:${size}px;height:${size}px;border-radius:50%;background:${color};box-shadow:0 0 8px ${color}90;flex-shrink:0;transition:box-shadow 0.2s ease;"></span>`;
}

function badge(text: string, bg: string, fg: string): string {
  return `<span style="display:inline-block;padding:1px 6px;font-size:8px;font-weight:800;letter-spacing:0.5px;text-transform:uppercase;background:${bg};color:${fg};border:1px solid ${fg}40;border-radius:2px;font-family:${FONT_MONO};white-space:nowrap;transition:background 0.15s ease,color 0.15s ease;">${escapeHtml(text)}</span>`;
}

function routeButton(unitCallSign: string, callNumber: string, uLat: number, uLng: number, cLat: number, cLng: number, label?: string): string {
  return `<button data-route-unit="${escapeHtml(unitCallSign)}" data-route-call="${escapeHtml(callNumber)}"
    data-route-ulat="${uLat}" data-route-ulng="${uLng}"
    data-route-clat="${cLat}" data-route-clng="${cLng}"
    style="padding:2px 8px;background:${C_BRAND}40;border:1px solid ${C_BRAND}80;color:${C_BLUE};font-size:8px;font-weight:900;font-family:${FONT_MONO};cursor:pointer;letter-spacing:0.5px;text-transform:uppercase;border-radius:2px;transition:background 0.15s ease,border-color 0.15s ease;">
    &#9654; ${escapeHtml(label || 'ROUTE')}
  </button>`;
}

function findClosestButton(callId: string): string {
  return `<button data-find-closest="${escapeHtml(callId)}"
    style="display:block;width:100%;margin-top:8px;padding:4px 8px;background:${C_BRAND}40;border:1px solid ${C_BRAND}80;color:${C_BLUE};font-size:8px;font-weight:900;font-family:${FONT_MONO};cursor:pointer;letter-spacing:0.5px;text-transform:uppercase;border-radius:2px;text-align:center;transition:background 0.15s ease,border-color 0.15s ease;box-shadow:0 2px 8px rgba(26,90,158,0.3);">
    &#9737; FIND CLOSEST UNIT
  </button>`;
}

function dataRow(label: string, value: string, valueColor = C_TEXT): string {
  if (!value) return '';
  return `<div style="display:flex;justify-content:space-between;align-items:baseline;padding:3px 0;border-bottom:1px solid ${C_BORDER}15;transition:background 0.1s ease;">
    <span style="font-size:8px;color:${C_TEXT_MUTED};font-family:${FONT_SANS};text-transform:uppercase;letter-spacing:0.5px;">${label}</span>
    <span style="font-size:10px;color:${valueColor};font-family:${FONT_MONO};font-weight:600;max-width:65%;text-align:right;word-break:break-word;">${escapeHtml(value)}</span>
  </div>`;
}

function sectionHeader(text: string, color = C_TEXT_MUTED): string {
  return `<div style="font-size:8px;color:${color};font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;margin-top:2px;font-family:${FONT_SANS};border-bottom:1px solid ${C_BORDER}30;padding-bottom:4px;">${text}</div>`;
}

function emptyState(text: string): string {
  return `<div style="font-size:9px;color:${C_TEXT_MUTED};text-align:center;padding:16px 0;border:1px dashed ${C_BORDER}40;border-radius:2px;margin:4px 0;">${escapeHtml(text)}</div>`;
}

function divider(): string {
  return `<div style="height:1px;background:linear-gradient(to right, transparent, ${C_BORDER}60, transparent);margin:6px 0;"></div>`;
}

function formatTimestamp(ts: string | null | undefined): string {
  if (!ts) return '--';
  try {
    const d = new Date(ts.includes('T') ? ts : ts + 'T00:00:00');
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  } catch { return '--'; }
}

function formatDateTime(ts: string | null | undefined): string {
  if (!ts) return '--';
  try {
    const d = new Date(ts.includes('T') ? ts : ts + 'T00:00:00');
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

  // GPS accuracy indicator color
  const gpsColor = gpsSource === 'device' ? C_GREEN : gpsSource === 'manual' ? C_GOLD : C_TEXT_MUTED;

  // Speed and heading formatting
  const speedMph = unit.gps_speed != null ? `${(unit.gps_speed * 2.237).toFixed(0)} mph` : '';
  const headingDirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const headingStr = unit.gps_heading != null
    ? `${headingDirs[Math.round(unit.gps_heading / 45) % 8]} (${Math.round(unit.gps_heading)}\u00b0)`
    : '';

  // Time on scene / time since dispatch
  let timeOnScene = '';
  let timeSinceDispatch = '';
  if (unit.onscene_at) {
    const ms = Date.now() - new Date(unit.onscene_at).getTime();
    const mins = Math.floor(ms / 60000);
    timeOnScene = mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
  }
  if (unit.dispatched_at && !unit.onscene_at) {
    const ms = Date.now() - new Date(unit.dispatched_at).getTime();
    const mins = Math.floor(ms / 60000);
    timeSinceDispatch = mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
  }

  // Battery level color
  const batteryColor = unit.battery_level != null
    ? unit.battery_level > 50 ? C_GREEN : unit.battery_level > 20 ? C_AMBER : C_RED
    : C_TEXT_MUTED;

  // Overview tab
  const overviewTab = `
    <div style="padding:4px 6px;background:${C_BASE};border-radius:2px;border:1px solid ${C_BORDER}20;">
      ${dataRow('Officer', unit.officer_name, C_TEXT)}
      ${dataRow('Status', statusLabel, statusColor)}
      ${unit.vehicle ? dataRow('Vehicle', unit.vehicle, C_TEXT_DIM) : ''}
      ${dataRow('GPS Source', gpsSource + ' ', gpsColor)}
      ${speedMph ? dataRow('Speed', speedMph, C_TEXT) : ''}
      ${headingStr ? dataRow('Heading', headingStr, C_TEXT_DIM) : ''}
      ${unit.battery_level != null ? dataRow('Battery', `${unit.battery_level}%`, batteryColor) : ''}
      ${timeOnScene ? dataRow('On Scene', timeOnScene, C_AMBER) : ''}
      ${timeSinceDispatch ? dataRow('Since Dispatch', timeSinceDispatch, C_TEXT_DIM) : ''}
      ${unit.last_gps_update ? dataRow('Last Update', formatTimestamp(unit.last_gps_update), C_TEXT_DIM) : ''}
    </div>
  `;

  // Assignment tab
  let assignmentTab = '';
  if (assignedCall) {
    const pColor = PRIORITY_HEX[assignedCall.priority] || C_TEXT_MUTED;
    const hasRoute = assignedCall.latitude != null && assignedCall.longitude != null && unit.latitude != null && unit.longitude != null;
    assignmentTab = `
      <div style="margin-bottom:8px;">${badge(assignedCall.priority, pColor + '25', pColor)}</div>
      <div style="padding:4px 6px;background:${C_BASE};border-radius:2px;border:1px solid ${C_BORDER}20;">
        ${dataRow('Call #', assignedCall.call_number, C_BLUE)}
        ${dataRow('Type', formatIncidentType(assignedCall.incident_type), pColor)}
        ${dataRow('Location', assignedCall.location_address, C_TEXT_DIM)}
        ${dataRow('Status', assignedCall.status.replace(/_/g, ' '), C_TEXT_DIM)}
        ${assignedCall.property_name ? dataRow('Property', assignedCall.property_name, C_GOLD) : ''}
      </div>
      ${hasRoute ? `<div style="margin-top:8px;text-align:center;">${routeButton(unit.call_sign, assignedCall.call_number, unit.latitude!, unit.longitude!, assignedCall.latitude!, assignedCall.longitude!, 'Route to Call')}</div>` : ''}
    `;
  } else {
    assignmentTab = emptyState('No active assignment');
  }

  // History tab — shows current status context
  const historyTab = `
    <div style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid ${C_BORDER}30;border-left:3px solid ${statusColor};padding-left:8px;">
      ${led(statusColor, 6)}
      <span style="font-size:9px;color:${statusColor};font-weight:700;font-family:${FONT_MONO};">${escapeHtml(statusLabel.toUpperCase())}</span>
      <span style="font-size:8px;color:${C_TEXT_MUTED};margin-left:auto;">Current</span>
    </div>
    ${unit.call_number ? `
      <div style="padding:4px 0;font-size:9px;color:${C_TEXT_DIM};border-left:3px solid ${C_BORDER}30;padding-left:8px;">
        Assigned to <span style="color:${C_BLUE};font-weight:700;">${escapeHtml(unit.call_number)}</span>
        ${unit.current_call_type ? `<span style="color:${C_TEXT_MUTED};"> &mdash; ${escapeHtml(formatIncidentType(unit.current_call_type))}</span>` : ''}
      </div>
    ` : ''}
    ${emptyState('View full history in Records module')}
  `;

  return `
    ${tabStyles(id)}
    <div id="${id}" style="width:340px;font-family:${FONT_MONO};background:${C_SUNKEN};color:${C_TEXT};padding:10px;border:1px solid ${statusColor}50;border-radius:2px;box-shadow:0 4px 20px rgba(0,0,0,0.5);">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid ${C_BORDER};background:linear-gradient(to right, ${statusColor}08, transparent);">
        ${led(statusColor, 12)}
        <span style="font-weight:900;font-size:15px;color:${statusColor};letter-spacing:-0.5px;">${escapeHtml(unit.call_sign)}</span>
        <span style="margin-left:auto;">${badge(statusLabel, statusColor + '20', statusColor)}</span>
      </div>
      ${divider()}
      <input type="radio" name="${id}" id="${id}_t1" checked>
      <input type="radio" name="${id}" id="${id}_t2">
      <input type="radio" name="${id}" id="${id}_t3">
      <div class="iw-tabs" role="tablist">
        <label class="iw-tab-label" for="${id}_t1" role="tab">Overview</label>
        <label class="iw-tab-label" for="${id}_t2" role="tab">Assignment</label>
        <label class="iw-tab-label" for="${id}_t3" role="tab">History</label>
      </div>
      <div class="iw-panel" role="tabpanel">${overviewTab}</div>
      <div class="iw-panel" role="tabpanel">${assignmentTab}</div>
      <div class="iw-panel" role="tabpanel">${historyTab}</div>
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
    <div style="padding:4px 6px;background:${C_BASE};border-radius:2px;border:1px solid ${C_BORDER}20;">
      ${dataRow('Call #', call.call_number, C_BLUE)}
      ${dataRow('Location', call.location_address, C_TEXT)}
      ${call.property_name ? dataRow('Property', call.property_name, C_GOLD) : ''}
      ${dataRow('Status', call.status.replace(/_/g, ' '), C_TEXT_DIM)}
      ${call.source ? dataRow('Source', call.source, C_TEXT_DIM) : ''}
      ${call.disposition ? dataRow('Disposition', call.disposition, C_TEXT_DIM) : ''}
    </div>
    ${call.latitude != null && call.longitude != null ? findClosestButton(String(call.id)) : ''}
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
        return `<div style="display:flex;align-items:center;gap:6px;padding:4px 2px;border-bottom:1px solid ${C_BORDER}20;transition:background 0.1s ease;" onmouseenter="this.style.background='${C_RAISED}'" onmouseleave="this.style.background='transparent'">
          ${led(uc, 6)}
          <span style="font-size:10px;color:${uc};font-weight:700;font-family:${FONT_MONO};">${escapeHtml(u.call_sign)}</span>
          <span style="font-size:9px;color:${C_TEXT_DIM};flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(u.officer_name)}</span>
          <span style="font-size:7px;color:${uc};opacity:0.7;">${escapeHtml(uLabel)}</span>
          ${hasRoute ? routeButton(u.call_sign, call.call_number, u.latitude!, u.longitude!, call.latitude!, call.longitude!) : `<span style="font-size:7px;color:${C_TEXT_MUTED};font-style:italic;">No route</span>`}
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

  // Find last filled index for pulse animation
  let lastFilledIdx = -1;
  timelineItems.forEach((item, i) => { if (item.ts) lastFilledIdx = i; });

  const timelineTab = `
    ${sectionHeader('Call Timeline')}
    ${timelineItems.map((item, i) => {
      const filled = !!item.ts;
      const isLastFilled = i === lastFilledIdx;
      const nextFilled = i < timelineItems.length - 1 && !!timelineItems[i + 1].ts;
      const connectorColor = filled && nextFilled ? item.color + '60' : filled ? item.color + '30' : C_BORDER + '25';
      return `<div style="display:flex;align-items:center;gap:8px;padding:4px 0;${i < timelineItems.length - 1 ? `border-left:2px solid ${connectorColor};margin-left:4px;padding-left:12px;` : 'margin-left:4px;padding-left:12px;border-left:2px solid transparent;'}">
        <span style="position:relative;left:-17px;display:inline-block;width:8px;height:8px;border-radius:50%;background:${filled ? item.color : C_BORDER};box-shadow:${filled ? `0 0 6px ${item.color}70` : 'none'};flex-shrink:0;${isLastFilled ? 'animation:pulse-led 2s infinite;' : ''}"></span>
        <span style="font-size:9px;color:${filled ? item.color : C_TEXT_MUTED};font-weight:600;font-family:${FONT_SANS};margin-left:-12px;">${item.label}</span>
        <span style="font-size:9px;color:${filled ? C_TEXT : C_TEXT_MUTED};font-family:${FONT_MONO};margin-left:auto;">${filled ? formatTimestamp(item.ts) : '--'}</span>
      </div>`;
    }).join('')}
  `;

  return `
    ${tabStyles(id)}
    <div id="${id}" style="width:340px;font-family:${FONT_MONO};background:${C_SUNKEN};color:${C_TEXT};padding:10px;border:1px solid ${pColor}50;border-radius:2px;box-shadow:0 4px 20px rgba(0,0,0,0.5);">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid ${C_BORDER};background:linear-gradient(to right, ${pColor}08, transparent);">
        <span style="background:${pColor};color:#fff;padding:3px 10px;font-size:11px;font-weight:900;letter-spacing:0.5px;border-radius:2px;">${escapeHtml(call.priority)}</span>
        <span style="font-weight:900;font-size:13px;color:${pColor};flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(call.call_number)}</span>
      </div>
      ${divider()}
      <input type="radio" name="${id}" id="${id}_t1" checked>
      <input type="radio" name="${id}" id="${id}_t2">
      <input type="radio" name="${id}" id="${id}_t3">
      <div class="iw-tabs" role="tablist">
        <label class="iw-tab-label" for="${id}_t1" role="tab">Overview</label>
        <label class="iw-tab-label" for="${id}_t2" role="tab">Units</label>
        <label class="iw-tab-label" for="${id}_t3" role="tab">Timeline</label>
      </div>
      <div class="iw-panel" role="tabpanel">${overviewTab}</div>
      <div class="iw-panel" role="tabpanel">${unitsTab}</div>
      <div class="iw-panel" role="tabpanel">${timelineTab}</div>
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
    // Loading / fallback state with shimmer animation
    return `
      <style>@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}</style>
      <div style="min-width:200px;font-family:${FONT_MONO};background:${C_SUNKEN};color:${C_TEXT};padding:12px;border:1px solid ${C_BLUE}50;border-radius:2px;box-shadow:0 4px 20px rgba(0,0,0,0.5);">
        <div style="font-weight:900;font-size:13px;color:${C_BLUE};margin-bottom:4px;">${escapeHtml(prop.name)}</div>
        <div style="font-size:10px;color:${C_TEXT_DIM};margin-bottom:6px;">Loading details...</div>
        <div style="height:4px;border-radius:2px;background:linear-gradient(90deg, ${C_SUNKEN}, ${C_RAISED}, ${C_SUNKEN});background-size:200% 100%;animation:shimmer 1.5s infinite;"></div>
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
      <div style="margin-top:6px;font-size:8px;color:${details.sla_response_minutes <= 10 ? C_AMBER : C_GREEN};font-weight:600;${details.sla_response_minutes <= 10 ? 'animation:pulse-led 2s infinite;' : ''}">SLA: ${details.sla_response_minutes} min response</div>
    ` : ''}
    ${details.hazard_notes ? `
      <div style="margin-top:4px;padding:3px 5px;background:#f8717110;border:1px solid #f8717130;border-radius:2px;">
        <span style="font-size:8px;color:#f87171;font-weight:700;animation:pulse-led 2s infinite;">&#9888; HAZARD</span>
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
        const isActive = c.status === 'dispatched' || c.status === 'en_route' || c.status === 'on_scene';
        const statusColor = (c.status === 'cleared' || c.status === 'closed') ? C_GREEN : c.status === 'pending' ? C_AMBER : isActive ? '#93c5fd' : C_BLUE;
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
          return `<div style="display:flex;justify-content:space-between;align-items:center;padding:3px 2px;border-bottom:1px solid ${C_BORDER}20;transition:background 0.1s ease;" onmouseenter="this.style.background='${C_RAISED}'" onmouseleave="this.style.background='transparent'">
            <div style="display:flex;align-items:center;gap:4px;overflow:hidden;">
              ${hasWarning ? '<span style="color:#ef4444;font-size:9px;text-shadow:0 0 4px #ef444460;">&#9888;</span>' : ''}
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
    <div id="${id}" style="width:400px;font-family:${FONT_MONO};background:${C_SUNKEN};color:${C_TEXT};padding:10px;border:1px solid ${C_BLUE}50;border-radius:2px;box-shadow:0 4px 20px rgba(0,0,0,0.5);">
      <div style="margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid ${C_BORDER};background:linear-gradient(to right, ${C_BLUE}08, transparent);">
        <div style="font-weight:900;font-size:13px;color:${C_BLUE};margin-bottom:2px;">${escapeHtml(prop.name)}</div>
        ${prop.client_name ? `<div style="font-size:9px;color:${C_GOLD};font-weight:600;">Client: ${escapeHtml(prop.client_name)}</div>` : ''}
      </div>
      ${divider()}
      <input type="radio" name="${id}" id="${id}_t1" checked>
      <input type="radio" name="${id}" id="${id}_t2">
      <input type="radio" name="${id}" id="${id}_t3">
      <div class="iw-tabs" role="tablist">
        <label class="iw-tab-label" for="${id}_t1" role="tab">Overview</label>
        <label class="iw-tab-label" for="${id}_t2" role="tab">History</label>
        <label class="iw-tab-label" for="${id}_t3" role="tab">Contacts</label>
      </div>
      <div class="iw-panel" role="tabpanel">${overviewTab}</div>
      <div class="iw-panel" role="tabpanel">${historyTab}</div>
      <div class="iw-panel" role="tabpanel">${contactsTab}</div>
    </div>
  `;
}

// ── Error / Fallback Property Window ─────────────────────────

export function buildPropertyFallbackWindow(prop: MapProperty): string {
  return `
    <style>@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}</style>
    <div style="min-width:160px;font-family:${FONT_MONO};background:${C_SUNKEN};color:${C_TEXT};padding:10px;border:1px solid ${C_BLUE}50;border-radius:2px;box-shadow:0 4px 20px rgba(0,0,0,0.5);">
      <div style="font-weight:900;font-size:13px;color:${C_BLUE};margin-bottom:4px;">${escapeHtml(prop.name)}</div>
      <div style="font-size:10px;color:${C_TEXT_DIM};">${escapeHtml(prop.address)}</div>
      ${prop.client_name ? `<div style="font-size:9px;margin-top:6px;color:${C_GOLD};font-weight:600;">Client: ${escapeHtml(prop.client_name)}</div>` : ''}
      <div style="margin-top:6px;height:4px;border-radius:2px;background:linear-gradient(90deg, ${C_SUNKEN}, ${C_RAISED}, ${C_SUNKEN});background-size:200% 100%;animation:shimmer 1.5s infinite;"></div>
    </div>
  `;
}

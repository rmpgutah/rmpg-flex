// Pure mapping helpers for the Spillman CAD board's three status grids.
// The color contract comes from the P0 kit: priorityColor()/unitStatusColor()
// return CSS-variable strings usable directly as inline `color`.
import type { CallForService, CallPriority, Unit } from '../../../types';
import { unitStatusColor } from '../../../components/spillman';
import type { StatusColumn } from '../../../components/spillman';
import { parseTimestamp } from '../../../utils/dateUtils';

/** RMPG P1..P4 → Spillman fixed priority number (1 red … 4 light green). */
export function spillmanPriorityNumber(priority: CallPriority): number {
  const n = parseInt(String(priority ?? '').replace(/^P/i, ''), 10);
  return n >= 1 && n <= 4 ? n : 3;
}

const UNDISPATCHED_STATUSES = new Set(['pending', 'on_hold']);
const DISPATCHED_STATUSES = new Set(['dispatched', 'enroute', 'onscene']);

export function partitionCalls(calls: CallForService[]): {
  undispatched: CallForService[];
  dispatched: CallForService[];
} {
  return {
    undispatched: calls.filter((c) => UNDISPATCHED_STATUSES.has(c.status)),
    dispatched: calls.filter((c) => DISPATCHED_STATUSES.has(c.status)),
  };
}

const UNIT_STATUS_LABELS: Record<string, string> = {
  available: 'AVL',
  dispatched: 'DSP',
  enroute: 'ENR',
  onscene: 'ONS',
  busy: 'BUSY',
  off_duty: 'OFFD',
  out_of_service: 'OOS',
};

export function cadUnitStatusLabel(status: string | null | undefined): string {
  if (!status) return '—';
  return UNIT_STATUS_LABELS[status] ?? status.toUpperCase();
}

// unitStatusColor() knows avail/enrt/busy/xbsy; translate our richer union
// onto that fixed CAD palette (working statuses read as "busy").
const UNIT_COLOR_ALIASES: Record<string, string> = {
  dispatched: 'busy',
  onscene: 'busy',
  out_of_service: 'oos',
};

export function cadUnitColor(status: string | null | undefined): string {
  if (!status || status === 'off_duty') return 'inherit';
  return unitStatusColor(UNIT_COLOR_ALIASES[status] ?? status);
}

export function timeHHMM(iso: string | null | undefined): string {
  if (!iso || Number.isNaN(new Date(iso).getTime())) return '';
  const d = parseTimestamp(iso);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

// ── Column layouts (Spillman CAD console) ─────────────────────
export const UNDISPATCHED_COLUMNS: StatusColumn[] = [
  { key: 'pri', label: 'Pri', width: 34, align: 'center' },
  { key: 'call_number', label: 'Call #', width: 96 },
  { key: 'type', label: 'Type', width: 110 },
  { key: 'location', label: 'Location' },
  { key: 'zone', label: 'Zone', width: 70 },
  { key: 'time', label: 'Recvd', width: 52, align: 'right' },
];

export const DISPATCHED_COLUMNS: StatusColumn[] = [
  { key: 'pri', label: 'Pri', width: 34, align: 'center' },
  { key: 'call_number', label: 'Call #', width: 96 },
  { key: 'type', label: 'Type', width: 110 },
  { key: 'location', label: 'Location' },
  { key: 'units', label: 'Units', width: 110 },
  { key: 'status', label: 'Status', width: 64 },
];

export const UNIT_COLUMNS: StatusColumn[] = [
  { key: 'call_sign', label: 'Unit', width: 64 },
  { key: 'officer', label: 'Officer' },
  { key: 'status', label: 'St', width: 52, align: 'center' },
  { key: 'call_number', label: 'Call #', width: 96 },
  { key: 'beat', label: 'Beat', width: 64 },
  { key: 'time', label: 'Last', width: 52, align: 'right' },
];

// ── Row projections (plain records — SpillmanStatusGrid renders row[col.key]) ──
export interface CadCallRow extends Record<string, any> {
  id: string;
  call: CallForService;
}
export interface CadUnitRow extends Record<string, any> {
  id: string;
  unit: Unit;
}

export function callToRow(call: CallForService): CadCallRow {
  return {
    id: call.id,
    call,
    pri: spillmanPriorityNumber(call.priority),
    call_number: call.call_number,
    type: (call.incident_type || '').replace(/_/g, ' ').toUpperCase(),
    location: call.location || '',
    zone: call.beat_name || call.zone_name || call.zone_beat || '',
    time: timeHHMM(call.created_at),
    units: (call.assigned_units || []).join(' '),
    status: (call.status || '').replace(/_/g, ' ').toUpperCase(),
  };
}

export function unitToRow(
  unit: Unit,
  callNumberById: (id: string | null | undefined) => string,
): CadUnitRow {
  return {
    id: unit.id,
    unit,
    call_sign: unit.call_sign,
    officer: unit.officer_name || '',
    status: cadUnitStatusLabel(unit.status),
    call_number: callNumberById(unit.current_call_id) || unit.current_call_number || '',
    beat: unit.assigned_beat || '',
    time: timeHHMM(unit.last_status_change),
  };
}

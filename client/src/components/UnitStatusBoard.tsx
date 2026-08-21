import React, { useMemo, useState } from 'react';
import { Radio, MapPin, PlusCircle, Plus, Edit, Trash2, AlertTriangle, Activity, UserPlus, Eye, Pencil } from 'lucide-react';
import type { Unit, UnitStatus } from '../types';
import StatusBadge from './StatusBadge';
import OnFootBadge from './OnFootBadge';
import OnFootActivityModal from './OnFootActivityModal';
import { parseTimestamp } from '../utils/dateUtils';
import { getGpsStaleness } from '../utils/gpsStaleness';
import { useUnitLocations } from '../hooks/useUnitLocations';
import { useActiveTripsLive } from '../hooks/useActiveTripsLive';
import { tripLabel, tripMiles, tripDurationMin, type Trip } from '../hooks/useTrips';
import { useContextMenu, type ContextMenuItem } from '../context/ContextMenuContext';
import { useMenuActions } from '../utils/contextMenuActions';
import { toDisplayLabel } from '../utils/formatters';

// Spillman EMERGENCY overlay: an officer with an active panic. Truthy for
// either the numeric (1) or boolean (true) shape the API may serialize.
function isEmergency(unit: Unit): boolean {
  const e = unit.emergency_active;
  return e === 1 || e === true;
}

function isOnFoot(unit: Unit): boolean {
  return unit.on_foot === 1 || unit.on_foot === true;
}

// Feature 2: GPS stale indicator thresholds. Exported so other unit-marker
// surfaces (e.g. MapboxMapPage) apply the exact same >2min/>5min thresholds
// instead of re-deriving their own — a unit reads "stale" the same way
// everywhere in the app.
export function getGpsStaleStatus(unit: Unit): 'ok' | 'stale' | 'lost' {
  return getGpsStaleness(unit);
}

// Time-in-status: how long a unit has held its current status. Dispatchers
// watch this to catch units stuck en route / dispatched without arriving.
// Recomputed on each board render (same cadence as the GPS-age indicator above);
// only shown for active statuses where dwell time is operationally meaningful.
const STATUS_DWELL_THRESHOLDS: Partial<Record<UnitStatus, { amber: number; red: number }>> = {
  dispatched: { amber: 5, red: 10 },   // should be moving / en route quickly
  enroute: { amber: 10, red: 20 },     // long transit → check on the unit
  onscene: { amber: 30, red: 60 },     // extended scene time → welfare/relief
  busy: { amber: 20, red: 45 },
};

function statusDwell(unit: Unit): { mins: number; color: string } | null {
  if (!unit.last_status_change || unit.status === 'off_duty' || unit.status === 'available') return null;
  const mins = Math.floor((Date.now() - parseTimestamp(unit.last_status_change).getTime()) / 60000);
  if (mins < 1) return null;
  const t = STATUS_DWELL_THRESHOLDS[unit.status];
  const color = t ? (mins >= t.red ? 'var(--sev-critical)' : mins >= t.amber ? 'var(--sev-warn)' : 'var(--text-secondary)') : 'var(--text-secondary)';
  return { mins, color };
}

// Live "current trip" badge for the Assignment column. Driven by the live
// trip map (poll-seeded, socket-kept). call_response → brand gold; patrol →
// neutral gray; no active trip → nothing. Format: "▶ RESPONSE 24-0613 · 2.1 mi · 4m".
function TripBadge({ trip }: { trip: Trip }) {
  const isResponse = trip.trip_type === 'call_response';
  const color = isResponse ? 'var(--brand-gold)' : 'var(--text-muted)';
  const miles = tripMiles(trip);
  const mins = tripDurationMin(trip);
  const parts: string[] = [tripLabel(trip)];
  if (Number.isFinite(miles)) parts.push(`${miles.toFixed(1)} mi`);
  if (mins != null) parts.push(`${mins}m`);
  return (
    <span
      className="inline-flex items-center text-[9px] font-mono font-bold tabular-nums truncate max-w-[180px]"
      style={{ color }}
      title={`Active trip — ${parts.join(' · ')}`}
    >
      &#9654;&nbsp;{parts.join(' · ')}
    </span>
  );
}

interface UnitStatusBoardProps {
  units: Unit[];
  onUnitClick?: (unit: Unit) => void;
  onStatusChange?: (unitId: string, newStatus: UnitStatus) => void;
  onAssignUnit?: (unitId: string) => void;
  onCreateUnit?: () => void;
  onEditUnit?: (unit: Unit) => void;
  onDeleteUnit?: (unit: Unit) => void;
  selectedCallId?: string | number | null;
  assignedUnitIds?: string[];
  unitWorkload?: Map<string, number>;
  compact?: boolean;
}

const STATUS_LED_CLASSES: Record<UnitStatus, string> = {
  available: 'led-dot led-green',
  dispatched: 'led-dot led-amber',
  enroute: 'led-dot led-gray',
  onscene: 'led-dot led-purple',
  busy: 'led-dot led-red animate-led-blink',
  off_duty: 'led-dot led-off',
  out_of_service: 'led-dot led-red',
};

export default React.memo(function UnitStatusBoard({
  units,
  onUnitClick,
  onStatusChange,
  onAssignUnit,
  onCreateUnit,
  onEditUnit,
  onDeleteUnit,
  selectedCallId,
  assignedUnitIds = [],
  unitWorkload,
  compact = false,
}: UnitStatusBoardProps) {
  const canAssign = !!selectedCallId && !!onAssignUnit;
  const hasActions = !!onEditUnit || !!onDeleteUnit;
  // Live street address + cross street resolved from each unit's GPS, so the
  // board always shows where a unit physically is — not just coordinates.
  const unitLocations = useUnitLocations(units);
  // Live current-trip-by-unit map (poll-seeded + 'trip_update' socket). Drives
  // the per-row trip badge in the Assignment column.
  const { getTrip } = useActiveTripsLive();

  // ── Right-click context menu ──
  const { openMenu } = useContextMenu();
  const m = useMenuActions();

  const [footUnit, setFootUnit] = useState<Unit | null>(null);

  // All unit statuses, for the "Set status" submenu. Mirrors the UnitStatus union.
  const STATUSES: UnitStatus[] = ['available', 'dispatched', 'enroute', 'onscene', 'busy', 'off_duty', 'out_of_service'];
  const prettyStatus = (s: UnitStatus) => toDisplayLabel(s);

  const buildUnitMenu = (unit: Unit): ContextMenuItem[] => [
    ...(onStatusChange
      ? [{
          label: 'Set status',
          icon: <Activity size={12} />,
          submenu: STATUSES.map((s) =>
            m.action(prettyStatus(s), () => onStatusChange(unit.id, s), { disabled: unit.status === s }),
          ),
        } as ContextMenuItem]
      : []),
    ...(onAssignUnit ? [m.action('Assign to selected call', () => onAssignUnit(unit.id), { icon: <UserPlus size={12} /> })] : []),
    m.action('View call', () => onUnitClick?.(unit), { icon: <Eye size={12} /> }),
    m.separator(),
    m.copy('Copy unit', unit.call_sign),
    ...(unit.officer_name ? [m.copy('Copy officer', unit.officer_name)] : []),
    m.copyId(unit.id),
    m.separator(),
    ...(onEditUnit ? [m.action('Edit unit', () => onEditUnit(unit), { icon: <Pencil size={12} /> })] : []),
    ...(onDeleteUnit ? [m.action('Delete unit', () => onDeleteUnit(unit), { icon: <Trash2 size={12} />, danger: true })] : []),
  ];
  // Sort: on-duty first (available, dispatched, enroute, onscene, busy), then off_duty
  // Includes every live status. out_of_service was missing, so indexOf returned
  // -1 and those units sorted ABOVE onscene (index 0) at the very top of the board.
  const statusOrder: UnitStatus[] = ['onscene', 'enroute', 'dispatched', 'available', 'busy', 'off_duty', 'out_of_service'];
  // Unknown/sentinel statuses sort last (rank after the known list) instead of -1.
  const rank = (s: UnitStatus) => { const i = statusOrder.indexOf(s); return i === -1 ? statusOrder.length : i; };
  // EMERGENCY units float to the very top of the board (Spillman Status
  // Monitor behaviour) regardless of their underlying status; then by status.
  const sorted = [...units].sort((a, b) => {
    const ea = isEmergency(a) ? 0 : 1;
    const eb = isEmergency(b) ? 0 : 1;
    if (ea !== eb) return ea - eb;
    return rank(a.status) - rank(b.status);
  });

  const isDraggable = (unit: Unit) => unit.status !== 'off_duty';

  const handleDragStart = (e: React.DragEvent, unit: Unit) => {
    if (!isDraggable(unit)) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData('text/unit-id', unit.id);
    e.dataTransfer.effectAllowed = 'link';
    // Set a slight delay so the drag image captures properly
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '0.5';
    }
  };

  const handleDragEnd = (e: React.DragEvent) => {
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '';
    }
  };

  if (compact) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
        {sorted.map((unit) => (
          <div
            key={unit.id}
            draggable={isDraggable(unit)}
            onDragStart={(e) => handleDragStart(e, unit)}
            onDragEnd={handleDragEnd}
            onClick={() => onUnitClick?.(unit)}
            onContextMenu={(e) => openMenu(e, buildUnitMenu(unit))}
            className={`flex items-center gap-2 p-1.5 panel-beveled cursor-pointer hover:bg-surface-raised transition-colors ${isDraggable(unit) ? 'cursor-grab active:cursor-grabbing' : ''}`}
            style={{ background:"var(--surface-sunken)" }}
          >
            {/* 33: aria-hidden on decorative LED dot */}
            <span className={STATUS_LED_CLASSES[unit.status]} aria-hidden="true" />
            <div className="min-w-0">
              <div className="text-xs font-bold text-rmpg-100 font-mono truncate">{unit.call_sign}</div>
              {isOnFoot(unit) && <OnFootBadge since={unit.on_foot_since} onClick={() => setFootUnit(unit)} />}
              {/* 34: Italic unassigned label in compact mode */}
              <div className={`text-[10px] truncate ${unit.officer_name ? 'text-rmpg-300' : 'text-fg-muted italic'}`}>{unit.officer_name || 'Unassigned'}</div>
            </div>
          </div>
        ))}
        {footUnit && <OnFootActivityModal unit={footUnit} onClose={() => setFootUnit(null)} />}
      </div>
    );
  }

  const colCount = 5 + (canAssign ? 1 : 0) + (hasActions ? 1 : 0);

  return (
    <div className="overflow-auto scrollbar-dark">
      <div className="overflow-x-auto"><table className="table-dark" aria-label="Unit status board">
        <thead>
          <tr>
            <th>Unit</th>
            <th>Officer</th>
            <th>Status</th>
            <th>Assignment</th>
            <th>Location</th>
            {canAssign && <th style={{ width: 60 }}>Dispatch</th>}
            {hasActions && <th style={{ width: 70 }}>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {sorted.map((unit) => (
            <tr
              key={unit.id}
              draggable={isDraggable(unit)}
              onDragStart={(e) => handleDragStart(e, unit)}
              onDragEnd={handleDragEnd}
              onClick={() => onUnitClick?.(unit)}
              onContextMenu={(e) => openMenu(e, buildUnitMenu(unit))}
              className={`cursor-pointer ${isDraggable(unit) ? 'cursor-grab active:cursor-grabbing' : ''} ${isEmergency(unit) ? 'animate-emergency-blink' : ''}`}
              style={isEmergency(unit) ? { background: 'rgba(var(--sev-critical-rgb) / 0.18)', boxShadow: 'inset 3px 0 0 var(--sev-critical)' } : undefined}
            >
              <td>
                <div className="flex items-center gap-2">
                  <span className={STATUS_LED_CLASSES[unit.status] || 'led-dot led-off'} />
                  <span className="font-bold text-rmpg-100 font-mono">{unit.call_sign}</span>
                  {/* Spillman EMERGENCY overlay — flashing red badge, floats this
                      row to the top of the board (see sort above). */}
                  {isEmergency(unit) && (
                    <span
                      className="inline-flex items-center gap-0.5 px-1 py-0 text-[8px] font-black uppercase tracking-wider text-rmpg-100 animate-emergency-blink"
                      style={{ background: 'var(--sev-critical)', letterSpacing: '1px' }}
                      title="EMERGENCY — active panic activation"
                    >
                      <AlertTriangle className="w-2.5 h-2.5" /> EMER
                    </span>
                  )}
                  {isOnFoot(unit) && <OnFootBadge since={unit.on_foot_since} onClick={() => setFootUnit(unit)} />}
                  {/* Feature 2: GPS stale indicator */}
                  {(() => {
                    const gpsStatus = getGpsStaleStatus(unit);
                    if (gpsStatus === 'lost') return <span title="GPS lost (>5min)"><AlertTriangle className="w-3 h-3 text-red-400 animate-pulse" /></span>;
                    if (gpsStatus === 'stale') return <span title="GPS stale (>2min)"><AlertTriangle className="w-3 h-3 text-amber-400" /></span>;
                    return null;
                  })()}
                  {/* Workload indicator dot */}
                  {unitWorkload && (() => {
                    const count = unitWorkload.get(String(unit.id)) ?? 0;
                    if (count === 0) return (
                      <span className="w-2 h-2 rounded-full flex-shrink-0 bg-green-500" title="0 active calls" aria-hidden="true" />
                    );
                    if (count <= 2) return (
                      <span className="w-2 h-2 rounded-full flex-shrink-0 bg-amber-400" title={`${count} active call${count > 1 ? 's' : ''}`} aria-hidden="true" />
                    );
                    return (
                      <span className="w-2 h-2 rounded-full flex-shrink-0 bg-red-500" title={`${count} active calls`} aria-hidden="true" />
                    );
                  })()}
                </div>
              </td>
              {/* 29: Italic styling on unassigned officer for distinction */}
              <td className="text-rmpg-200">{unit.officer_name || <span className="text-fg-muted italic">Unassigned</span>}</td>
              <td>
                <div className="flex items-center gap-1.5">
                  {onStatusChange ? (
                    <select
                      className="text-[9px] font-bold font-mono px-1 py-0.5 cursor-pointer"
                      style={{ background: 'var(--surface-raised)', border: '1px solid var(--spm-border)', color: 'var(--spm-text)', borderRadius: 2 }}
                      value={unit.status}
                      aria-label={`Change status for ${unit.call_sign}`}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        e.stopPropagation();
                        onStatusChange(unit.id, e.target.value as UnitStatus);
                      }}
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>{prettyStatus(s)}</option>
                      ))}
                    </select>
                  ) : (
                    <StatusBadge status={unit.status} type="unit_status" size="sm" />
                  )}
                  {(() => {
                    const dwell = statusDwell(unit);
                    return dwell ? (
                      <span
                        className="text-[9px] font-mono tabular-nums"
                        style={{ color: dwell.color }}
                        title={`In ${unit.status} for ${dwell.mins} min`}
                      >
                        {dwell.mins}m
                      </span>
                    ) : null;
                  })()}
                </div>
              </td>
              <td className="text-rmpg-300 text-xs font-mono">
                <div className="flex flex-col gap-0.5">
                  <span className="flex items-center gap-1">
                    {unit.current_call_number || <span className="text-fg-muted italic text-[10px]">Unassigned</span>}
                    {(unit.queued_call_ids?.length ?? 0) > 0 && (
                      <span
                        className="text-[8px] font-bold px-1 py-px rounded-sm tabular-nums"
                        style={{ background: 'color-mix(in srgb, var(--sev-warn) 22%, transparent)', color: 'var(--sev-warn)' }}
                        title={`${unit.queued_call_ids!.length} call${unit.queued_call_ids!.length > 1 ? 's' : ''} queued`}
                      >
                        +{unit.queued_call_ids!.length}Q
                      </span>
                    )}
                    {unitWorkload && (unitWorkload.get(String(unit.id)) ?? 0) > 1 && (
                      <span
                        className="text-[8px] font-bold px-1 py-px rounded-sm tabular-nums"
                        style={{ background: 'color-mix(in srgb, var(--sev-warn) 18%, transparent)', color: 'var(--sev-warn)' }}
                        title={`${unitWorkload.get(String(unit.id))} active calls assigned`}
                      >
                        {unitWorkload.get(String(unit.id))}
                      </span>
                    )}
                  </span>
                  {(() => {
                    const trip = getTrip(unit.id);
                    return trip ? <TripBadge trip={trip} /> : null;
                  })()}
                </div>
              </td>
              <td>
                {(() => {
                  const lat = Number(unit.latitude), lng = Number(unit.longitude);
                  const hasCoords = unit.latitude != null && unit.longitude != null
                    && Number.isFinite(lat) && Number.isFinite(lng);
                  if (!unit.location && !hasCoords) {
                    return <span className="text-fg-muted italic text-[10px]">No GPS</span>;
                  }
                  // Three-line live location: street address, cross street, and
                  // coordinates — resolved from the unit's GPS (useUnitLocations).
                  const loc = unitLocations[String(unit.id)];
                  const street = unit.location || loc?.address || loc?.onStreet || null;
                  const cross = loc?.crossStreet || null;
                  const coords = hasCoords ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : null;
                  return (
                    <div className="flex flex-col gap-0.5 text-xs text-rmpg-300 max-w-[190px]">
                      <div className="flex items-center gap-1">
                        <MapPin className="w-3 h-3 flex-shrink-0" />
                        <span className="truncate" title={street || coords || ''}>
                          {street || coords || 'Locating…'}
                        </span>
                        {unit.gps_updated_at && unit.status !== 'off_duty' && (() => {
                          const mins = Math.floor((Date.now() - parseTimestamp(unit.gps_updated_at).getTime()) / 60000);
                          const color = mins > 10 ? 'var(--sev-critical)' : mins > 5 ? 'var(--sev-warn)' : 'var(--text-muted)';
                          return <span className="text-[8px] font-mono ml-1 flex-shrink-0" style={{ color }} title="GPS age">{mins}m</span>;
                        })()}
                      </div>
                      {cross && (
                        <span className="text-[9px] text-fg-muted truncate pl-4" title={`Cross street: ${loc?.onStreet ? loc.onStreet + ' & ' : ''}${cross}`}>
                          &times; {loc?.onStreet ? `${loc.onStreet} & ` : ''}{cross}
                        </span>
                      )}
                      {coords && street && (
                        <span className="text-[8px] font-mono text-fg-muted pl-4 select-all" title="Live coordinates">{coords}</span>
                      )}
                    </div>
                  );
                })()}
              </td>
              {canAssign && (
                <td>
                  {/* 30: Active press feedback on assign button */}
                  {unit.status === 'available' && !assignedUnitIds.includes(unit.id) ? (
                    <button type="button"
                      onClick={(e) => { e.stopPropagation(); onAssignUnit!(unit.id); }}
                      className="flex items-center gap-1 px-2 py-0.5 sm:py-0.5 min-h-[44px] sm:min-h-0 text-[10px] font-bold text-green-400 bg-green-900/30 border border-green-700/50 hover:bg-green-800/40 active:bg-green-700/50 transition-colors"
                      title={`Assign ${unit.call_sign} to call`}
                      aria-label={`Assign ${unit.call_sign} to call`}
                    >
                      <PlusCircle className="w-3 h-3" />
                      Assign
                    </button>
                  ) : assignedUnitIds.includes(unit.id) ? (
                    <span className="text-[10px] text-brand-400 font-bold">Assigned</span>
                  ) : (
                    <span className="text-[10px] text-fg-muted">-</span>
                  )}
                </td>
              )}
              {hasActions && (
                <td>
                  <div className="flex items-center gap-1">
                    {onEditUnit && (
                      <button type="button"
                        onClick={(e) => { e.stopPropagation(); onEditUnit(unit); }}
                        className="p-2 sm:p-0.5 min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 flex items-center justify-center text-rmpg-400 hover:text-brand-400 transition-colors"
                        title={`Edit ${unit.call_sign}`}
                      >
                        <Edit className="w-3 h-3" />
                      </button>
                    )}
                    {onDeleteUnit && (
                      <button type="button"
                        onClick={(e) => { e.stopPropagation(); onDeleteUnit(unit); }}
                        className="p-2 sm:p-0.5 min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 flex items-center justify-center text-rmpg-400 hover:text-red-400 transition-colors"
                        title={`Dispose ${unit.call_sign} (retire or delete)`}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </td>
              )}
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr>
              {/* 31: Empty state with larger icon and fade-in; 32: aria-hidden on decorative icon */}
            <td colSpan={colCount} className="text-center text-rmpg-400 py-8">
                <div className="flex flex-col items-center gap-2 animate-fade-in">
                  <Radio className="w-6 h-6 text-fg-muted opacity-50" aria-hidden="true" />
                  <p className="text-xs">No units configured</p>
                  {onCreateUnit && (
                    <button type="button"
                      onClick={(e) => { e.stopPropagation(); onCreateUnit(); }}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold text-brand-400 bg-brand-900/30 border border-brand-600/50 hover:bg-brand-800/40 transition-colors mt-1"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Create First Unit
                    </button>
                  )}
                </div>
              </td>
            </tr>
          )}
        </tbody>
      </table></div>
      {footUnit && <OnFootActivityModal unit={footUnit} onClose={() => setFootUnit(null)} />}
    </div>
  );
});

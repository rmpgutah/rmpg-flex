import React, { useMemo } from 'react';
import { Radio, MapPin, PlusCircle, Plus, Edit, Trash2, AlertTriangle } from 'lucide-react';
import type { Unit, UnitStatus } from '../types';
import StatusBadge from './StatusBadge';

// Feature 2: GPS stale indicator thresholds
function getGpsStaleStatus(unit: Unit): 'ok' | 'stale' | 'lost' {
  if (!unit.gps_updated_at || unit.status === 'off_duty') return 'ok';
  const elapsed = Date.now() - new Date(unit.gps_updated_at).getTime();
  if (elapsed > 5 * 60 * 1000) return 'lost';  // >5 min = red (lost)
  if (elapsed > 2 * 60 * 1000) return 'stale'; // >2 min = amber (stale)
  return 'ok';
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
  compact?: boolean;
}

const STATUS_LED_CLASSES: Record<UnitStatus, string> = {
  available: 'led-dot led-green',
  dispatched: 'led-dot led-amber',
  enroute: 'led-dot led-blue',
  onscene: 'led-dot led-purple',
  busy: 'led-dot led-red animate-led-blink',
  off_duty: 'led-dot led-off',
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
  compact = false,
}: UnitStatusBoardProps) {
  const canAssign = !!selectedCallId && !!onAssignUnit;
  const hasActions = !!onEditUnit || !!onDeleteUnit;
  // Sort: on-duty first (available, dispatched, enroute, onscene, busy), then off_duty
  const statusOrder: UnitStatus[] = ['onscene', 'enroute', 'dispatched', 'available', 'busy', 'off_duty'];
  const sorted = [...units].sort(
    (a, b) => statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status)
  );

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
            className={`flex items-center gap-2 p-1.5 panel-beveled cursor-pointer hover:bg-surface-raised transition-colors ${isDraggable(unit) ? 'cursor-grab active:cursor-grabbing' : ''}`}
            style={{ background: '#141e2b' }}
          >
            <span className={STATUS_LED_CLASSES[unit.status]} />
            <div className="min-w-0">
              <div className="text-xs font-bold text-white font-mono truncate">{unit.call_sign}</div>
              <div className="text-[10px] text-rmpg-300 truncate">{unit.officer_name || 'Unassigned'}</div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  const colCount = 5 + (canAssign ? 1 : 0) + (hasActions ? 1 : 0);

  return (
    <div className="overflow-auto">
      <table className="table-dark" aria-label="Unit status board">
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
              className={`cursor-pointer ${isDraggable(unit) ? 'cursor-grab active:cursor-grabbing' : ''}`}
            >
              <td>
                <div className="flex items-center gap-2">
                  <span className={STATUS_LED_CLASSES[unit.status]} />
                  <span className="font-bold text-white font-mono">{unit.call_sign}</span>
                  {/* Feature 2: GPS stale indicator */}
                  {(() => {
                    const gpsStatus = getGpsStaleStatus(unit);
                    if (gpsStatus === 'lost') return <span title="GPS lost (>5min)"><AlertTriangle className="w-3 h-3 text-red-400 animate-pulse" /></span>;
                    if (gpsStatus === 'stale') return <span title="GPS stale (>2min)"><AlertTriangle className="w-3 h-3 text-amber-400" /></span>;
                    return null;
                  })()}
                </div>
              </td>
              <td className="text-rmpg-200">{unit.officer_name || <span className="text-rmpg-500">Unassigned</span>}</td>
              <td>
                <StatusBadge status={unit.status} type="unit_status" size="sm" />
              </td>
              <td className="text-rmpg-300 text-xs font-mono">
                {unit.current_call_number || '-'}
              </td>
              <td>
                {unit.location ? (
                  <div className="flex items-center gap-1 text-xs text-rmpg-300">
                    <MapPin className="w-3 h-3" />
                    <span className="truncate max-w-[150px]">{unit.location}</span>
                  </div>
                ) : (
                  <span className="text-rmpg-500">-</span>
                )}
              </td>
              {canAssign && (
                <td>
                  {unit.status === 'available' && !assignedUnitIds.includes(unit.id) ? (
                    <button type="button"
                      onClick={(e) => { e.stopPropagation(); onAssignUnit!(unit.id); }}
                      className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold text-green-400 bg-green-900/30 border border-green-700/50 hover:bg-green-800/40 transition-colors"
                      title={`Assign ${unit.call_sign} to call`}
                    >
                      <PlusCircle className="w-3 h-3" />
                      Assign
                    </button>
                  ) : assignedUnitIds.includes(unit.id) ? (
                    <span className="text-[10px] text-brand-400 font-bold">Assigned</span>
                  ) : (
                    <span className="text-[10px] text-rmpg-500">-</span>
                  )}
                </td>
              )}
              {hasActions && (
                <td>
                  <div className="flex items-center gap-1">
                    {onEditUnit && (
                      <button type="button"
                        onClick={(e) => { e.stopPropagation(); onEditUnit(unit); }}
                        className="p-0.5 text-rmpg-400 hover:text-brand-400 transition-colors"
                        title={`Edit ${unit.call_sign}`}
                      >
                        <Edit className="w-3 h-3" />
                      </button>
                    )}
                    {onDeleteUnit && !unit.current_call_id && (
                      <button type="button"
                        onClick={(e) => { e.stopPropagation(); onDeleteUnit(unit); }}
                        className="p-0.5 text-rmpg-400 hover:text-red-400 transition-colors"
                        title={`Delete ${unit.call_sign}`}
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
              <td colSpan={colCount} className="text-center text-rmpg-400 py-8">
                <div className="flex flex-col items-center gap-2">
                  <Radio className="w-6 h-6 text-rmpg-500" />
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
      </table>
    </div>
  );
});

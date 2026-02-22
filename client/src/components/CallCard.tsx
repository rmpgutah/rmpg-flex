import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Clock, MapPin, Users, AlertTriangle } from 'lucide-react';
import type { CallForService } from '../types';
import StatusBadge from './StatusBadge';
import { formatIncidentType } from '../utils/caseNumbers';
import WarningTags from './WarningTags';
import type { WarningTag } from './WarningTags';

interface CallCardProps {
  call: CallForService;
  isSelected?: boolean;
  onClick?: (call: CallForService) => void;
  onUnitDrop?: (callId: string, unitId: string) => void;
  warnings?: WarningTag[];
}

function computeElapsed(createdAt: string) {
  const created = new Date(createdAt).getTime();
  const now = Date.now();
  const diffMs = now - created;
  const diffMin = Math.floor(diffMs / 60000);

  let elapsed: string;
  if (diffMin < 1) elapsed = '<1m';
  else if (diffMin < 60) elapsed = `${diffMin}m`;
  else {
    const hours = Math.floor(diffMin / 60);
    const mins = diffMin % 60;
    elapsed = `${hours}h ${mins}m`;
  }

  let color: string;
  if (diffMin >= 60) color = '#ef4444';
  else if (diffMin >= 30) color = '#ef4444';
  else if (diffMin >= 15) color = '#f59e0b';
  else color = '#6b7280';

  return { elapsed, color, diffMin };
}

const NON_DROPPABLE_STATUSES = ['cleared', 'closed', 'cancelled', 'archived'];

export default React.memo(function CallCard({ call, isSelected = false, onClick, onUnitDrop, warnings }: CallCardProps) {
  const isEmergency = call.priority === 'P1';
  const [isDragOver, setIsDragOver] = useState(false);
  const elapsedRef = useRef<HTMLSpanElement>(null);
  const [shouldEscalate, setShouldEscalate] = useState(false);

  // Use direct DOM updates for elapsed timer to avoid re-renders every 30s
  useEffect(() => {
    const update = () => {
      const { elapsed, color, diffMin } = computeElapsed(call.created_at);
      const el = elapsedRef.current;
      if (el) {
        el.textContent = elapsed;
        el.style.color = color;
        el.className = diffMin >= 60 ? 'animate-pulse' : '';
      }

      const isPending = call.status === 'pending';
      const shouldEsc = isPending && (
        (call.priority === 'P3' && diffMin >= 20) ||
        (call.priority === 'P2' && diffMin >= 10) ||
        (call.priority === 'P4' && diffMin >= 30)
      );
      setShouldEscalate(shouldEsc);
    };
    update();
    const interval = setInterval(update, 30000);
    return () => clearInterval(interval);
  }, [call.created_at, call.status, call.priority]);

  const canAcceptDrop = onUnitDrop && !NON_DROPPABLE_STATUSES.includes(call.status);

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!canAcceptDrop) return;
    if (!e.dataTransfer.types.includes('text/unit-id')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'link';
  };

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    if (!canAcceptDrop) return;
    if (!e.dataTransfer.types.includes('text/unit-id')) return;
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    if (!canAcceptDrop) return;
    const unitId = e.dataTransfer.getData('text/unit-id');
    if (unitId) {
      onUnitDrop(call.id, unitId);
    }
  };

  // Initial values for first render
  const init = computeElapsed(call.created_at);

  return (
    <div
      onClick={() => onClick?.(call)}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`
        relative p-2 cursor-pointer transition-all duration-100
        priority-border-${call.priority}
        ${isSelected
          ? 'bg-brand-900/30 panel-beveled'
          : 'panel-beveled hover:bg-surface-raised'
        }
        ${isEmergency ? 'animate-emergency-pulse' : ''}
      `}
      style={{
        background: isSelected ? undefined : '#1a1a1a',
        borderLeftColor: undefined, // Let priority-border handle left
        ...(isDragOver ? {
          boxShadow: '0 0 8px rgba(34, 197, 94, 0.5)',
          borderColor: 'rgb(34, 197, 94)',
          outline: '1px solid rgba(34, 197, 94, 0.6)',
        } : {}),
      }}
    >
      {/* Header Row */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {isEmergency && (
            <AlertTriangle className="w-4 h-4 text-red-500 animate-emergency-blink" />
          )}
          <span className="text-sm font-bold text-green-400 font-mono">{call.call_number}</span>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={call.priority} type="priority" size="sm" />
          <StatusBadge status={call.status} type="call_status" size="sm" />
          {shouldEscalate && (
            <span className="text-[8px] font-bold font-mono text-amber-400 bg-amber-900/30 border border-amber-700/50 px-1 py-0 animate-pulse">
              ESCALATE
            </span>
          )}
        </div>
      </div>

      {/* Type */}
      <div className="text-sm font-medium text-brand-400 mb-1">
        {formatIncidentType(call.incident_type)}
      </div>

      {/* Location */}
      <div className="flex items-center gap-1.5 text-xs text-rmpg-300 mb-2">
        <MapPin className="w-3 h-3 flex-shrink-0" />
        <span className="truncate">{call.location}</span>
      </div>

      {/* Footer Row */}
      <div className="flex items-center justify-between text-xs text-rmpg-400">
        <div className="flex items-center gap-1 font-mono">
          <Clock className="w-3 h-3" />
          <span ref={elapsedRef} style={{ color: init.color }} className={init.diffMin >= 60 ? 'animate-pulse' : ''}>{init.elapsed}</span>
        </div>
        {call.assigned_units.length > 0 && (
          <div className="flex items-center gap-1">
            <Users className="w-3 h-3" />
            <span>{call.assigned_units.length} unit{call.assigned_units.length !== 1 ? 's' : ''}</span>
          </div>
        )}
      </div>

      {/* Description preview */}
      {call.description && (
        <p className="mt-1.5 text-[11px] text-rmpg-300 line-clamp-2 border-t border-rmpg-700 pt-1.5">
          {call.description}
        </p>
      )}

      {/* Warning indicators */}
      {warnings && warnings.length > 0 && (
        <div className="mt-1.5 pt-1 border-t border-red-900/40">
          <WarningTags warnings={warnings} compact />
        </div>
      )}

      {/* Drop to assign indicator */}
      {isDragOver && canAcceptDrop && (
        <div className="absolute inset-0 flex items-center justify-center bg-green-900/30 pointer-events-none rounded">
          <span className="text-xs font-bold text-green-400 bg-green-950/80 px-2 py-1 rounded border border-green-600/50">
            Drop to assign
          </span>
        </div>
      )}
    </div>
  );
});

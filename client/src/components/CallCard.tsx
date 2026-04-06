import React, { useState, useEffect, useRef } from 'react';
import { Clock, MapPin, Users, AlertTriangle } from 'lucide-react';
import type { CallForService } from '../types';
import StatusBadge from './StatusBadge';
import { formatIncidentType } from '../utils/caseNumbers';
import WarningTags from './WarningTags';
import type { WarningTag } from './WarningTags';
import { getTimerState, isActiveStatus, type TimerSeverity } from '../utils/dispatchTimers';

interface CallCardProps {
  call: CallForService;
  isSelected?: boolean;
  onClick?: (call: CallForService) => void;
  onUnitDrop?: (callId: string, unitId: string) => void;
  onStatusChange?: (callId: string, newStatus: string) => void;
  onContextMenu?: (e: React.MouseEvent, call: CallForService) => void;
  warnings?: WarningTag[];
}

const NON_DROPPABLE_STATUSES = ['cleared', 'closed', 'cancelled', 'archived'];

export default React.memo(function CallCard({ call, isSelected = false, onClick, onUnitDrop, onStatusChange, onContextMenu, warnings }: CallCardProps) {
  const isEmergency = call.priority === 'P1';
  const [isDragOver, setIsDragOver] = useState(false);
  const timerRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const [isOverdue, setIsOverdue] = useState(false);
  const [shouldEscalate, setShouldEscalate] = useState(false);

  // Status-aware timer — updates every second via direct DOM manipulation
  useEffect(() => {
    const active = isActiveStatus(call.status);

    const update = () => {
      const state = getTimerState(call);

      // Update timer text
      if (timerRef.current) {
        timerRef.current.textContent = `${state.label} ${state.formatted}`;
        timerRef.current.style.color = state.color;
        timerRef.current.className = state.isOverdue ? 'animate-pulse font-bold' : '';
      }

      // Update progress bar
      if (barRef.current) {
        barRef.current.style.width = `${state.progress * 100}%`;
        barRef.current.style.background = state.color;
        barRef.current.style.opacity = state.progress > 0 ? '1' : '0';
      }

      // Update overdue label
      if (labelRef.current) {
        labelRef.current.style.display = state.isOverdue ? 'inline-flex' : 'none';
      }

      setIsOverdue(state.isOverdue);

      // Legacy escalation logic — guard against missing/invalid created_at
      const createdTime = call.created_at ? new Date(call.created_at).getTime() : NaN;
      const diffMin = Number.isFinite(createdTime) ? Math.floor((Date.now() - createdTime) / 60000) : 0;
      const isPending = call.status === 'pending';
      setShouldEscalate(isPending && (
        (call.priority === 'P3' && diffMin >= 20) ||
        (call.priority === 'P2' && diffMin >= 10) ||
        (call.priority === 'P4' && diffMin >= 30)
      ));
    };

    update();
    // Update every second for active calls, every 30s for inactive
    const interval = setInterval(update, active ? 1000 : 30000);
    return () => clearInterval(interval);
  }, [call.created_at, call.status, call.priority, call.dispatched_at, call.enroute_at, call.onscene_at]);

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

  // Initial timer state for first render
  const initState = getTimerState(call);

  return (
    <div
      onClick={() => onClick?.(call)}
      onContextMenu={(e) => { if (onContextMenu) { e.preventDefault(); onContextMenu(e, call); } }}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`
        group relative p-2 cursor-pointer transition-all duration-100
        priority-border-${call.priority}
        ${isSelected
          ? 'bg-brand-900/30 panel-beveled'
          : 'panel-beveled hover:bg-surface-raised'
        }
        ${isEmergency ? 'animate-emergency-pulse' : ''}
        ${isOverdue ? 'timer-overdue' : ''}
        ${call.status === 'on_hold' ? 'call-on-hold' : ''}
      `}
      style={{
        background: call.status === 'on_hold'
          ? 'rgba(180, 130, 0, 0.08)'
          : isSelected ? undefined : '#141e2b',
        borderLeftColor: call.status === 'on_hold' ? '#f59e0b' : undefined,
        ...(isDragOver ? {
          boxShadow: '0 0 8px rgba(34, 197, 94, 0.5)',
          borderColor: 'rgb(34, 197, 94)',
          outline: '1px solid rgba(34, 197, 94, 0.6)',
        } : {}),
      }}
    >
      {/* Timer progress bar (thin line at top) */}
      {isActiveStatus(call.status) && (
        <div className="timer-bar-track">
          <div
            ref={barRef}
            className="timer-bar-fill"
            style={{
              width: `${initState.progress * 100}%`,
              background: initState.color,
              opacity: initState.progress > 0 ? 1 : 0,
            }}
          />
        </div>
      )}

      {/* Header Row */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {isEmergency && (
            <AlertTriangle className="w-4 h-4 text-red-500 animate-emergency-blink" />
          )}
          <span className="text-sm font-bold text-green-400 font-mono">{call.call_number}</span>
          {call.incident_type === 'pso_client_request' && call.pso_attempt_number && (
            <span className="text-[9px] font-bold font-mono text-amber-300 bg-amber-900/30 border border-amber-700/40 px-1 py-0">
              VISIT #{call.pso_attempt_number}
            </span>
          )}
          {/* 72-hour PSO re-dispatch countdown */}
          {call.incident_type === 'pso_client_request' && ['cleared', 'closed'].includes(call.status) && (() => {
            const terminalTime = call.closed_at || call.cleared_at;
            if (!terminalTime) return null;
            const elapsed = Date.now() - new Date(terminalTime).getTime();
            const hoursLeft = Math.max(0, 72 - elapsed / (60 * 60 * 1000));
            if (elapsed >= 72 * 60 * 60 * 1000) {
              return (
                <span className="text-[8px] font-bold font-mono text-red-400 bg-red-900/40 border border-red-600/50 px-1 py-0 animate-pulse">
                  72HR OVERDUE
                </span>
              );
            }
            if (elapsed >= 48 * 60 * 60 * 1000) {
              return (
                <span className="text-[8px] font-bold font-mono text-amber-400 bg-amber-900/40 border border-amber-600/50 px-1 py-0">
                  {Math.floor(hoursLeft)}HR LEFT
                </span>
              );
            }
            return null;
          })()}
          {call.dispatch_code && !(call.incident_type === 'pso_client_request' && call.pso_attempt_number) && (
            <span className="text-[10px] font-bold font-mono text-amber-300 bg-amber-900/30 border border-amber-700/40 px-1 py-0">
              {call.dispatch_code}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <StatusBadge status={call.priority} type="priority" size="sm" />
          <StatusBadge status={call.status} type="call_status" size="sm" />
          {shouldEscalate && (
            <span className="text-[8px] font-bold font-mono text-amber-400 bg-amber-900/30 border border-amber-700/50 px-1 py-0 animate-pulse">
              ESCALATE
            </span>
          )}
          <span
            ref={labelRef}
            className="text-[8px] font-bold font-mono text-red-400 bg-red-900/40 border border-red-600/50 px-1 py-0 animate-pulse"
            style={{ display: initState.isOverdue ? 'inline-flex' : 'none' }}
          >
            OVERDUE
          </span>
        </div>
      </div>

      {/* Type + Case Number */}
      <div className="flex items-center gap-2 mb-1">
        <span className="text-sm font-medium text-brand-400">
          {formatIncidentType(call.incident_type)}
        </span>
        {call.incident_type === 'pso_client_request' && call.pso_service_type && (
          <span className="text-[9px] text-rmpg-300 truncate max-w-[140px]">{call.pso_service_type}</span>
        )}
        {call.case_number && (
          <span className="text-[9px] font-mono text-cyan-400 bg-cyan-900/20 border border-cyan-700/30 px-1">
            {call.case_number}
          </span>
        )}
      </div>

      {/* Location */}
      <div className="flex items-center gap-1.5 text-xs text-rmpg-300 mb-2">
        <MapPin className="w-3 h-3 flex-shrink-0" />
        <span className="truncate">{call.location}</span>
      </div>

      {/* Footer Row — status timer + units */}
      <div className="flex items-center justify-between text-xs text-rmpg-400">
        <div className="flex items-center gap-1 font-mono">
          <Clock className="w-3 h-3" />
          <span
            ref={timerRef}
            style={{ color: initState.color }}
            className={initState.isOverdue ? 'animate-pulse font-bold' : ''}
          >
            {initState.label} {initState.formatted}
          </span>
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

      {/* Quick Status Advance Buttons — visible on hover */}
      {onStatusChange && !['closed', 'cancelled', 'archived'].includes(call.status) && (
        <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity flex gap-0.5 z-10"
          onClick={(e) => e.stopPropagation()}
        >
          {call.status === 'pending' && (
            <button onClick={() => onStatusChange(call.id, 'dispatched')} className="px-1.5 py-0.5 text-[8px] font-bold bg-amber-900/60 text-amber-300 border border-amber-700/50 hover:bg-amber-800/80 transition-colors" title="Dispatch">D</button>
          )}
          {call.status === 'dispatched' && (
            <button onClick={() => onStatusChange(call.id, 'enroute')} className="px-1.5 py-0.5 text-[8px] font-bold bg-blue-900/60 text-blue-300 border border-blue-700/50 hover:bg-blue-800/80 transition-colors" title="En Route">ER</button>
          )}
          {call.status === 'enroute' && (
            <button onClick={() => onStatusChange(call.id, 'onscene')} className="px-1.5 py-0.5 text-[8px] font-bold bg-purple-900/60 text-purple-300 border border-purple-700/50 hover:bg-purple-800/80 transition-colors" title="On Scene">OS</button>
          )}
          {['dispatched', 'enroute', 'onscene'].includes(call.status) && (
            <button onClick={() => onStatusChange(call.id, 'cleared')} className="px-1.5 py-0.5 text-[8px] font-bold bg-green-900/60 text-green-300 border border-green-700/50 hover:bg-green-800/80 transition-colors" title="Clear">CL</button>
          )}
          <button onClick={() => onStatusChange(call.id, 'closed')} className="px-1.5 py-0.5 text-[8px] font-bold bg-red-900/60 text-red-300 border border-red-700/50 hover:bg-red-800/80 transition-colors" title="Close Call">X</button>
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

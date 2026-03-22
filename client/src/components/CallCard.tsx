import React, { useState, useEffect, useRef } from 'react';
import { Clock, MapPin, Users, AlertTriangle, Phone, Radio, UserCheck, Globe, Layers, MessageSquare, ShieldAlert } from 'lucide-react';
import type { CallForService } from '../types';
import StatusBadge from './StatusBadge';
import { formatIncidentType } from '../utils/caseNumbers';
import WarningTags from './WarningTags';
import type { WarningTag } from './WarningTags';
import { getTimerState, isActiveStatus, type TimerSeverity } from '../utils/dispatchTimers';

// Feature 15: Call Source Icons
const SOURCE_ICONS: Record<string, React.ElementType> = {
  phone: Phone,
  radio: Radio,
  walk_in: UserCheck,
  online: Globe,
  alarm: AlertTriangle,
  patrol: Radio,
};

// Feature 3: Elapsed time formatter
function formatCallDuration(createdAt: string): string {
  const elapsed = Date.now() - new Date(createdAt).getTime();
  if (elapsed < 0 || !isFinite(elapsed)) return '0:00';
  const totalSec = Math.floor(elapsed / 1000);
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (hrs > 0) return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

// Feature 8: Response time calculation
function calcResponseTime(call: CallForService): string | null {
  if (!call.dispatched_at || !call.created_at) return null;
  if (!['cleared', 'closed', 'archived'].includes(call.status) && !call.onscene_at) return null;
  const endTime = call.onscene_at || call.cleared_at || call.dispatched_at;
  const diff = new Date(endTime).getTime() - new Date(call.created_at).getTime();
  if (diff < 0 || !isFinite(diff)) return null;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

interface CallCardProps {
  call: CallForService;
  isSelected?: boolean;
  onClick?: (call: CallForService) => void;
  onUnitDrop?: (callId: string, unitId: string) => void;
  onStatusChange?: (callId: string, newStatus: string) => void;
  onContextMenu?: (e: React.MouseEvent, call: CallForService) => void;
  warnings?: WarningTag[];
  /** Feature 5: Number of stacked calls at this address */
  stackCount?: number;
  /** Feature 6: Quick note add handler */
  onQuickNote?: (callId: string, note: string) => void;
  /** Warrant indicator: true if any linked person has an active warrant */
  hasActiveWarrant?: boolean;
}

const NON_DROPPABLE_STATUSES = ['cleared', 'closed', 'cancelled', 'archived'];

export default React.memo(function CallCard({ call, isSelected = false, onClick, onUnitDrop, onStatusChange, onContextMenu, warnings, stackCount, onQuickNote, hasActiveWarrant }: CallCardProps) {
  const isEmergency = call.priority === 'P1';
  const [isDragOver, setIsDragOver] = useState(false);
  const timerRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const durationRef = useRef<HTMLSpanElement>(null);
  const holdTimerRef = useRef<HTMLSpanElement>(null);
  const [isOverdue, setIsOverdue] = useState(false);
  const [shouldEscalate, setShouldEscalate] = useState(false);
  // Feature 6: Quick note inline input
  const [showQuickNote, setShowQuickNote] = useState(false);
  const [quickNoteText, setQuickNoteText] = useState('');

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

      // Feature 3: Update call duration display
      if (durationRef.current && call.created_at) {
        durationRef.current.textContent = formatCallDuration(call.created_at);
      }

      // Feature 12: Update hold timer
      if (holdTimerRef.current) {
        if (call.status === 'pending' && !call.assigned_units?.length) {
          const holdMs = Date.now() - new Date(call.created_at).getTime();
          const holdMins = Math.floor(holdMs / 60000);
          holdTimerRef.current.textContent = `HOLD ${holdMins}m`;
          holdTimerRef.current.style.display = 'inline-flex';
        } else {
          holdTimerRef.current.style.display = 'none';
        }
      }

      // Legacy escalation logic — guard against missing/invalid created_at
      const createdTime = call.created_at ? new Date(call.created_at).getTime() : NaN;
      const diffMin = Number.isFinite(createdTime) ? Math.floor((Date.now() - createdTime) / 60000) : -1;
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
        ${call.priority === 'P1' ? 'p1-pulse-border' : ''}
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
          {hasActiveWarrant && (
            <span className="inline-flex items-center gap-0.5 text-[9px] font-bold text-red-100 bg-red-600 px-1 py-0 rounded-sm animate-pulse" title="Person on this call has active warrant(s)">
              <ShieldAlert style={{ width: 9, height: 9 }} /> WRN
            </span>
          )}
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
          {/* Feature 12: Hold timer badge */}
          <span
            ref={holdTimerRef}
            className="text-[8px] font-bold font-mono text-yellow-400 bg-yellow-900/30 border border-yellow-700/50 px-1 py-0"
            style={{ display: call.status === 'pending' && !call.assigned_units?.length ? 'inline-flex' : 'none' }}
          >
            HOLD 0m
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
        {call.incident_number && (
          <span className="text-[9px] font-mono text-green-400 bg-green-900/20 border border-green-700/30 px-1">
            {call.incident_number}
          </span>
        )}
      </div>

      {/* Feature 15: Source icon + Feature 5: Stack count + Feature 3: Duration */}
      <div className="flex items-center gap-1.5 text-[9px] text-rmpg-400 mb-1">
        {/* Source icon */}
        {call.source && (() => {
          const SourceIcon = SOURCE_ICONS[call.source] || Phone;
          return <SourceIcon className="w-3 h-3 flex-shrink-0" title={call.source?.replace('_', ' ')} />;
        })()}
        {/* Feature 3: Call duration */}
        <span ref={durationRef} className="font-mono">{call.created_at ? formatCallDuration(call.created_at) : ''}</span>
        {/* Feature 5: Stacked calls badge */}
        {stackCount && stackCount > 1 && (
          <span className="flex items-center gap-0.5 px-1 py-0 bg-purple-900/40 text-purple-300 border border-purple-700/40 font-bold text-[8px]">
            <Layers className="w-2.5 h-2.5" /> {stackCount}
          </span>
        )}
        {/* Feature 8: Response time for cleared calls */}
        {['cleared', 'closed', 'archived'].includes(call.status) && (() => {
          const rt = calcResponseTime(call);
          return rt ? <span className="font-mono text-cyan-400 ml-auto">RT: {rt}</span> : null;
        })()}
      </div>

      {/* Location */}
      <div className="flex items-center gap-1.5 text-xs text-rmpg-300 mb-1">
        <MapPin className="w-3 h-3 flex-shrink-0" />
        <span className="truncate">{call.location}</span>
      </div>
      {call.latitude != null && call.longitude != null && (
        <div className="text-[9px] font-mono text-rmpg-400 ml-[18px] mb-2">
          {Number(call.latitude).toFixed(5)}, {Number(call.longitude).toFixed(5)}
        </div>
      )}

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

      {/* Feature 3: Call tags (color-coded chips) */}
      {(() => {
        const tags: string[] = (() => {
          try { return JSON.parse((call as any).tags || '[]'); } catch { return []; }
        })();
        if (tags.length === 0) return null;
        const TAG_COLORS: Record<string, string> = {
          domestic: 'bg-red-900/40 text-red-300 border-red-700/50',
          weapons: 'bg-orange-900/40 text-orange-300 border-orange-700/50',
          officer_safety: 'bg-yellow-900/40 text-yellow-300 border-yellow-700/50',
          juvenile: 'bg-blue-900/40 text-blue-300 border-blue-700/50',
          mental_health: 'bg-purple-900/40 text-purple-300 border-purple-700/50',
          gang: 'bg-red-900/40 text-red-400 border-red-600/50',
          drugs: 'bg-green-900/40 text-green-300 border-green-700/50',
          hazmat: 'bg-amber-900/40 text-amber-300 border-amber-700/50',
          barricade: 'bg-pink-900/40 text-pink-300 border-pink-700/50',
        };
        return (
          <div className="flex flex-wrap gap-0.5 mt-1">
            {tags.map((tag: string) => (
              <span key={tag} className={`text-[7px] font-bold uppercase px-1 py-0 border ${TAG_COLORS[tag] || 'bg-rmpg-800 text-rmpg-300 border-rmpg-600'}`}>
                {tag.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
        );
      })()}

      {/* Warning indicators */}
      {warnings && warnings.length > 0 && (
        <div className="mt-1.5 pt-1 border-t border-red-900/40">
          <WarningTags warnings={warnings} compact />
        </div>
      )}

      {/* Feature 6: Quick Note Add */}
      {onQuickNote && !showQuickNote && (
        <button
          onClick={(e) => { e.stopPropagation(); setShowQuickNote(true); }}
          className="absolute bottom-1 right-1 opacity-0 group-hover:opacity-70 hover:!opacity-100 transition-opacity text-[8px] text-rmpg-400 hover:text-rmpg-200 z-10"
          title="Quick note"
        >
          <MessageSquare className="w-3 h-3" />
        </button>
      )}
      {showQuickNote && onQuickNote && (
        <div className="mt-1.5 pt-1 border-t border-rmpg-700/50 flex gap-1" onClick={(e) => e.stopPropagation()}>
          <input
            type="text"
            className="flex-1 bg-surface-sunken border border-rmpg-600 text-[10px] text-rmpg-200 px-1.5 py-0.5 rounded-sm"
            placeholder="Add note..."
            maxLength={500}
            value={quickNoteText}
            onChange={(e) => setQuickNoteText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && quickNoteText.trim()) {
                onQuickNote(call.id, quickNoteText.trim());
                setQuickNoteText('');
                setShowQuickNote(false);
              }
              if (e.key === 'Escape') { setShowQuickNote(false); setQuickNoteText(''); }
            }}
            autoFocus
          />
          <button
            onClick={() => {
              if (quickNoteText.trim()) {
                onQuickNote(call.id, quickNoteText.trim());
                setQuickNoteText('');
                setShowQuickNote(false);
              }
            }}
            className="text-[8px] px-1.5 py-0.5 bg-brand-600 text-white border border-brand-500 rounded-sm"
          >
            Add
          </button>
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
        <div className="absolute inset-0 flex items-center justify-center bg-green-900/30 pointer-events-none rounded-sm">
          <span className="text-xs font-bold text-green-400 bg-green-950/80 px-2 py-1 rounded-sm border border-green-600/50">
            Drop to assign
          </span>
        </div>
      )}
    </div>
  );
});

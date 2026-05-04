import React, { useState, useEffect, useRef } from 'react';
import { Clock, MapPin, Users, AlertTriangle, Phone, Radio, UserCheck, Globe, Layers, MessageSquare, ShieldAlert, Star } from 'lucide-react';
import type { CallForService } from '../types';
import StatusBadge from './StatusBadge';
import { formatIncidentType } from '../utils/caseNumbers';
import WarningTags from './WarningTags';
import type { WarningTag } from './WarningTags';
import { getTimerState, isActiveStatus } from '../utils/dispatchTimers';
import { humanizePriority, getStatusTooltip, formatAddressDisplay } from '../utils/statusLabels';

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
function formatCallDuration(createdAt: string, status?: string, archivedAt?: string): string {
  // For archived/closed/cancelled calls, show the final duration (not a running timer)
  if (status && ['archived', 'closed', 'cancelled'].includes(status)) {
    const endTime = archivedAt || createdAt;
    const start = new Date(createdAt).getTime();
    const end = new Date(endTime).getTime();
    const elapsed = end - start;
    if (elapsed <= 0 || !isFinite(elapsed)) return '0:00';
    const totalSec = Math.floor(elapsed / 1000);
    const hrs = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    if (hrs > 0) return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    return `${mins}:${String(secs).padStart(2, '0')}`;
  }
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
  /** Toggle pinned-to-top flag */
  onTogglePin?: (callId: string, currentlyPinned: boolean) => void;
}

const NON_DROPPABLE_STATUSES = ['cleared', 'closed', 'cancelled', 'archived'];

export default React.memo(function CallCard({ call, isSelected = false, onClick, onUnitDrop, onStatusChange, onContextMenu, warnings, stackCount, onQuickNote, hasActiveWarrant, onTogglePin }: CallCardProps) {
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
        durationRef.current.textContent = formatCallDuration(call.created_at, call.status, (call as any).archived_at || call.cleared_at || call.closed_at);
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
      onUnitDrop!(call.id, unitId);
    }
  };

  // Initial timer state for first render
  const initState = getTimerState(call);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Call ${call.call_number}: ${formatIncidentType(call.incident_type)} at ${call.location || 'unknown location'}`}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(call); } }}
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
        ${call.priority === 'P1' ? 'p1-pulse-border' : call.priority === 'P2' ? 'p2-pulse-border' : ''}
        ${call.status === 'archived' ? 'opacity-60' : ''}
      `}
      style={{
        background: call.status === 'on_hold'
          ? 'rgba(180, 130, 0, 0.08)'
          : isSelected ? undefined : '#0a0a0a',
        borderLeftColor: call.status === 'on_hold' ? '#f59e0b' : undefined,
        scrollSnapAlign: 'start',
        WebkitTouchCallout: 'none',
        willChange: 'transform',
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
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          {isEmergency && (
            <AlertTriangle className="w-4 h-4 text-red-500 animate-emergency-blink" />
          )}
          {onTogglePin && (
            <button
              type="button"
              aria-label={call.pinned ? `Unpin call ${call.call_number}` : `Pin call ${call.call_number}`}
              title={call.pinned ? 'Unpin (currently floats to top)' : 'Pin to top of list'}
              onClick={(e) => { e.stopPropagation(); onTogglePin(call.id, !!call.pinned); }}
              className="p-0.5 hover:brightness-125 transition-all"
              style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
            >
              <Star
                style={{ width: 12, height: 12 }}
                className={call.pinned ? 'fill-amber-400 text-amber-400' : 'text-rmpg-600'}
              />
            </button>
          )}
          {/* 39: Call number with letter-spacing for CAD readability */}
          <span className="text-sm font-bold text-green-400 font-mono tabular-nums" style={{ letterSpacing: '0.04em' }}>{call.call_number}</span>
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
          {/* 72-hour deadline for active PSO calls (from creation time) */}
          {call.incident_type === 'pso_client_request' && !['cleared', 'closed', 'archived', 'cancelled'].includes(call.status) && call.created_at && (() => {
            const deadline = new Date(new Date(call.created_at).getTime() + 72 * 3600000);
            const remaining = deadline.getTime() - Date.now();
            if (remaining <= 0) return (
              <span className="text-[8px] font-bold font-mono text-red-400 bg-red-900/40 border border-red-600/50 px-1 py-0 animate-pulse">
                72HR PASSED
              </span>
            );
            const hrs = Math.floor(remaining / 3600000);
            if (hrs < 24) return (
              <span className={`text-[8px] font-bold font-mono px-1 py-0 ${hrs < 12 ? 'text-red-400 bg-red-900/40 border border-red-600/50' : 'text-amber-400 bg-amber-900/40 border border-amber-600/50'}`}>
                {hrs}h left
              </span>
            );
            return null;
          })()}
          {call.dispatch_code && !(call.incident_type === 'pso_client_request' && call.pso_attempt_number) && (
            <span className="text-[10px] font-bold font-mono text-amber-300 bg-amber-900/30 border border-amber-700/40 px-1 py-0">
              {call.dispatch_code}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <StatusBadge status={call.priority} type="priority" size="sm" title={humanizePriority(call.priority)} />
          <StatusBadge status={call.status} type="call_status" size="sm" title={getStatusTooltip(call.status, 'call')} />
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
          <span className="text-[9px] text-rmpg-300 truncate max-w-[140px]">{call.pso_service_type.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}</span>
        )}
        {call.case_number && (
          <span className="text-[9px] font-mono text-gray-300 bg-[#141414] border border-[#2e2e2e] px-1">
            {call.case_number}
          </span>
        )}
        {call.incident_number && (
          <span className="text-[9px] font-mono text-green-400 bg-green-900/20 border border-green-700/30 px-1">
            {call.incident_number}
          </span>
        )}
      </div>

      {/* Safety Flag Indicators — compact inline badges */}
      {(() => {
        const flagBadges: Array<{ label: string; color: string; bg: string; border: string }> = [];
        if (call.weapons_involved && call.weapons_involved !== 'None') flagBadges.push({ label: 'ARMED', color: '#fca5a5', bg: 'rgba(220,38,38,0.2)', border: 'rgba(220,38,38,0.4)' });
        if ((call as any).domestic_violence) flagBadges.push({ label: 'DV', color: '#fde047', bg: 'rgba(234,179,8,0.15)', border: 'rgba(234,179,8,0.35)' });
        if ((call as any).mental_health_crisis) flagBadges.push({ label: 'MH', color: '#c4b5fd', bg: 'rgba(139,92,246,0.15)', border: 'rgba(139,92,246,0.35)' });
        if ((call as any).vehicle_pursuit || (call as any).foot_pursuit) flagBadges.push({ label: 'PURSUIT', color: '#f97316', bg: 'rgba(249,115,22,0.15)', border: 'rgba(249,115,22,0.35)' });
        if ((call as any).officer_safety_caution) flagBadges.push({ label: 'SAFETY', color: '#ef4444', bg: 'rgba(239,68,68,0.15)', border: 'rgba(239,68,68,0.35)' });
        if ((call as any).felony_in_progress) flagBadges.push({ label: 'FELONY', color: '#ef4444', bg: 'rgba(239,68,68,0.2)', border: 'rgba(239,68,68,0.5)' });
        if ((call as any).ems_requested) flagBadges.push({ label: 'EMS', color: '#aaaaaa', bg: 'rgba(136,136,136,0.15)', border: 'rgba(136,136,136,0.35)' });
        if ((call as any).injuries_reported) flagBadges.push({ label: 'INJ', color: '#fb923c', bg: 'rgba(251,146,60,0.15)', border: 'rgba(251,146,60,0.35)' });
        if (flagBadges.length === 0) return null;
        return (
          <div className="flex flex-wrap gap-0.5 mb-1">
            {flagBadges.map(f => (
              <span key={f.label} className="text-[7px] font-bold font-mono px-1 py-0 leading-tight" style={{ color: f.color, background: f.bg, border: `1px solid ${f.border}` }}>
                {f.label}
              </span>
            ))}
          </div>
        );
      })()}

      {/* Feature 15: Source icon + Feature 5: Stack count + Feature 3: Duration */}
      <div className="flex items-center gap-1.5 text-[9px] text-rmpg-400 mb-1">
        {/* Source icon */}
        {call.source && (() => {
          const SourceIcon = SOURCE_ICONS[call.source] || Phone;
          return <SourceIcon className="w-3 h-3 flex-shrink-0" title={call.source?.replace('_', ' ')} />;
        })()}
        {/* Feature 3: Call duration */}
        <span ref={durationRef} className="font-mono tabular-nums">{call.created_at ? formatCallDuration(call.created_at, call.status, (call as any).archived_at || call.cleared_at || call.closed_at) : ''}</span>
        {/* Feature 5: Stacked calls badge */}
        {stackCount != null && stackCount > 1 && (
          <span className="flex items-center gap-0.5 px-1 py-0 bg-purple-900/40 text-purple-300 border border-purple-700/40 font-bold text-[8px]">
            <Layers className="w-2.5 h-2.5" /> {stackCount}
          </span>
        )}
        {/* Feature 8: Response time for cleared calls */}
        {['cleared', 'closed', 'archived'].includes(call.status) && (() => {
          const rt = calcResponseTime(call);
          return rt ? <span className="font-mono text-gray-300 ml-auto">RT: {rt}</span> : null;
        })()}
      </div>

      {/* 40: Location with improved pin icon color — coords hidden (redundant with address) */}
      <div className="flex items-center gap-1.5 text-xs text-rmpg-300 mb-1">
        <MapPin className="w-3 h-3 flex-shrink-0 text-rmpg-500" aria-hidden="true" />
        <div className="truncate">
          <span className="truncate">{formatAddressDisplay(call.location)}</span>
          {/* Enhancement 28: Show property name below address */}
          {call.property_name && (
            <div className="text-[9px] text-rmpg-400 truncate">{call.property_name}</div>
          )}
          {/* Client/requestor company name */}
          {(call.client_name || (call as any).pso_requestor_name) && (
            <div className="text-[9px] text-brand-400 truncate flex items-center gap-0.5">
              <Globe className="w-2.5 h-2.5 flex-shrink-0" />
              {call.client_name || (call as any).pso_requestor_name}
            </div>
          )}
        </div>
      </div>

      {/* 20: Footer row with top border separator for visual grouping */}
      <div className="flex items-center justify-between text-xs text-rmpg-400 pt-1 border-t border-rmpg-700/20 mt-1">
        {/* 21: Timer with tabular-nums for stable digit rendering */}
        <div className="flex items-center gap-1 font-mono tabular-nums">
          <Clock className="w-3 h-3" aria-hidden="true" />
          <span
            ref={timerRef}
            style={{ color: initState.color }}
            className={initState.isOverdue ? 'animate-pulse font-bold' : ''}
          >
            {initState.label} {initState.formatted}
          </span>
        </div>
        {call.assigned_units?.length > 0 && (
          <div className="flex items-center gap-1">
            <Users className="w-3 h-3" />
            <span>{call.assigned_units.length} unit{call.assigned_units.length !== 1 ? 's' : ''}</span>
          </div>
        )}
      </div>

      {/* 41: Description with smoother transition and better truncation */}
      {call.description && (
        <p className="mt-1.5 text-[11px] text-rmpg-400 italic line-clamp-3 border-t border-rmpg-700/30 pt-1.5" style={{ lineHeight: '1.4' }}>
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
          juvenile: 'bg-gray-900/40 text-gray-300 border-gray-700/50',
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
        <button type="button"
          onClick={(e) => { e.stopPropagation(); setShowQuickNote(true); }}
          className="absolute bottom-1 right-1 opacity-0 group-hover:opacity-70 hover:!opacity-100 transition-opacity text-[8px] text-rmpg-400 hover:text-rmpg-200 z-10"
          title="Quick note"
        >
          <MessageSquare className="w-3 h-3" />
        </button>
      )}
      {showQuickNote && onQuickNote && (
        <div className="mt-1.5 pt-1 border-t border-rmpg-700/50 flex gap-1" onClick={(e) => e.stopPropagation()}>
          {/* 25: Focus ring on quick note input; 26: Transition on border color */}
          <input
            type="text"
            className="flex-1 bg-surface-sunken border border-rmpg-600 text-[10px] text-rmpg-200 px-1.5 py-0.5 rounded-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30 focus:outline-none transition-colors"
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
            aria-label="Quick note text"
            autoFocus
          />
          {/* 27: Quick note Add button with hover and disabled states */}
          <button type="button"
            onClick={() => {
              if (quickNoteText.trim()) {
                onQuickNote(call.id, quickNoteText.trim());
                setQuickNoteText('');
                setShowQuickNote(false);
              }
            }}
            disabled={!quickNoteText.trim()}
            className="text-[8px] px-1.5 py-0.5 bg-brand-600 text-white border border-brand-500 rounded-sm hover:bg-brand-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Add
          </button>
        </div>
      )}

      {/* 42: Quick Status Advance Buttons with smoother reveal */}
      {onStatusChange && !['closed', 'cancelled', 'archived'].includes(call.status) && (
        <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-all duration-200 flex gap-0.5 z-10"
          onClick={(e) => e.stopPropagation()}
          style={{ WebkitBackdropFilter: 'blur(2px)', backdropFilter: 'blur(2px)' }}
        >
          {call.status === 'pending' && (
            <button type="button" onClick={() => onStatusChange(call.id, 'dispatched')} className="px-1.5 py-0.5 text-[8px] font-bold bg-amber-900/60 text-amber-300 border border-amber-700/50 hover:bg-amber-800/80 transition-colors" title="Dispatch" aria-label="Dispatch call">D</button>
          )}
          {call.status === 'dispatched' && (
            <button type="button" onClick={() => onStatusChange(call.id, 'enroute')} className="px-1.5 py-0.5 text-[8px] font-bold bg-gray-900/60 text-gray-300 border border-gray-700/50 hover:bg-gray-800/80 transition-colors" title="En Route" aria-label="Set en route">ER</button>
          )}
          {call.status === 'enroute' && (
            <button type="button" onClick={() => onStatusChange(call.id, 'onscene')} className="px-1.5 py-0.5 text-[8px] font-bold bg-purple-900/60 text-purple-300 border border-purple-700/50 hover:bg-purple-800/80 transition-colors" title="On Scene" aria-label="Set on scene">OS</button>
          )}
          {['dispatched', 'enroute', 'onscene'].includes(call.status) && (
            <button type="button" onClick={() => onStatusChange(call.id, 'cleared')} className="px-1.5 py-0.5 text-[8px] font-bold bg-green-900/60 text-green-300 border border-green-700/50 hover:bg-green-800/80 transition-colors" title="Clear" aria-label="Clear call">CL</button>
          )}
          <button type="button" onClick={() => onStatusChange(call.id, 'closed')} className="px-1.5 py-0.5 text-[8px] font-bold bg-red-900/60 text-red-300 border border-red-700/50 hover:bg-red-800/80 transition-colors" title="Close Call" aria-label="Close call">X</button>
        </div>
      )}

      {/* 43: Drop-to-assign indicator with glow effect */}
      {isDragOver && canAcceptDrop && (
        <div className="absolute inset-0 flex items-center justify-center bg-green-900/30 pointer-events-none rounded-sm" style={{ boxShadow: 'inset 0 0 12px rgba(34, 197, 94, 0.2)' }}>
          <span className="text-xs font-bold text-green-400 bg-green-950/80 px-3 py-1.5 rounded-sm border border-green-600/50" style={{ boxShadow: '0 2px 8px rgba(34, 197, 94, 0.3)' }}>
            Drop to assign unit
          </span>
        </div>
      )}
    </div>
  );
});

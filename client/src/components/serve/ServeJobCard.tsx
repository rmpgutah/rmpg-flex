import React, { useMemo } from 'react';
import { formatEnumValue } from '../../utils/formatters';
import {
  MapPin,
  ClipboardCheck,
  Search,
  AlertTriangle,
  Sun,
  Moon,
  Clock,
  ChevronDown,
  ChevronUp,
  Briefcase,
  Calendar,
  User,
  FileText,
  ScrollText,
  Shield,
  Gavel,
  FileWarning,
} from 'lucide-react';
import type { ServeJob, ServeJobLinkedCall } from '../../types';
import { safeDateStr, parseTimestamp } from '../../utils/dateUtils';

interface ServeJobCardProps {
  job: ServeJob;
  linkedCall?: ServeJobLinkedCall | null;
  onAttempt: (jobId: number) => void;
  onNavigate: (jobId: number) => void;
  onSkipTrace: (jobId: number) => void;
  onFlagAddress: (jobId: number) => void;
  onEdit: (jobId: number) => void;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
}

const STATUS_COLORS: Record<string, { bg: string; glow: string }> = {
  pending: { bg: 'bg-gray-500', glow: 'shadow-[0_0_6px_rgba(136, 136, 136,0.5)]' },
  in_progress: { bg: 'bg-amber-500 animate-pulse', glow: 'shadow-[0_0_6px_rgba(245,158,11,0.5)]' },
  served: { bg: 'bg-green-500', glow: 'shadow-[0_0_6px_rgba(34,197,94,0.5)]' },
  failed: { bg: 'bg-red-500', glow: 'shadow-[0_0_6px_rgba(239,68,68,0.5)]' },
  skipped: { bg: 'bg-rmpg-500', glow: 'shadow-[0_0_6px_rgba(107,114,128,0.5)]' },
  archived: { bg: 'bg-rmpg-600', glow: 'shadow-[0_0_6px_rgba(75,85,99,0.5)]' },
};

const PRIORITY_STYLES: Record<string, string> = {
  rush: 'bg-red-900/60 text-red-300 border-red-700/50',
  high: 'bg-amber-900/60 text-amber-300 border-amber-700/50',
  normal: 'bg-gray-900/60 text-gray-300 border-gray-700/50',
  low: 'bg-rmpg-800/60 text-rmpg-400 border-rmpg-600/50',
};

const TIME_WINDOW_CONFIG: Record<string, { icon: typeof Sun; label: string }> = {
  morning: { icon: Sun, label: 'Morning' },
  afternoon: { icon: Clock, label: 'Afternoon' },
  evening: { icon: Moon, label: 'Evening' },
  anytime: { icon: Clock, label: 'Anytime' },
};

const ATTEMPT_RESULT_LABELS: Record<string, string> = {
  served: 'Served',
  no_answer: 'No Answer',
  refused: 'Refused',
  wrong_address: 'Wrong Address',
  moved: 'Moved',
  other: 'Other',
};

// Enhancement 50: Document type icons
const DOC_TYPE_ICONS: Record<string, React.ElementType> = {
  Subpoena: ScrollText, Summons: FileText, Complaint: FileWarning,
  Writ: Gavel, Order: Gavel, Notice: FileText, Petition: FileText,
  Motion: FileText, Garnishment: FileWarning, Eviction: Shield,
};

function AttemptDots({ count, max }: { count: number; max: number }) {
  const dots = [];
  for (let i = 0; i < max; i++) {
    dots.push(
      <span
        key={i}
        className={`inline-block w-2 h-2 rounded-full ${
          i < count ? 'bg-amber-400' : 'bg-rmpg-600'
        }`}
      />
    );
  }
  return <div className="flex items-center gap-0.5">{dots}</div>;
}

export default React.memo(function ServeJobCard({
  job,
  linkedCall,
  onAttempt,
  onNavigate,
  onSkipTrace,
  onFlagAddress,
  onEdit,
  isExpanded = false,
  onToggleExpand,
}: ServeJobCardProps) {
  const isDueSoon = useMemo(() => {
    if (!job.deadline) return false;
    const deadlineMs = parseTimestamp(job.deadline).getTime();
    const now = Date.now();
    return deadlineMs - now <= 48 * 60 * 60 * 1000 && deadlineMs > now;
  }, [job.deadline]);

  const isOverdue = useMemo(() => {
    if (!job.deadline) return false;
    return parseTimestamp(job.deadline).getTime() <= Date.now();
  }, [job.deadline]);

  const fullAddress = [job.recipient_address, job.recipient_city, job.recipient_state, job.recipient_zip]
    .filter(Boolean)
    .join(', ');

  const TimeIcon = TIME_WINDOW_CONFIG[job.time_window]?.icon ?? Clock;
  const timeLabel = TIME_WINDOW_CONFIG[job.time_window]?.label ?? job.time_window;

  return (
    <div
      role="article"
      tabIndex={0}
      aria-label={`Serve job: ${job.recipient_name}`}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggleExpand?.(); } }}
      className={`
        panel-beveled rounded-[2px] transition-all duration-150 hover:bg-[#1a1a1a] hover:shadow-md
        ${isDueSoon ? 'ring-1 ring-red-500/60 animate-pulse' : ''}
        ${isOverdue ? 'ring-1 ring-red-600/80 shadow-[0_0_8px_rgba(239,68,68,0.3)]' : ''}
      `}
      style={{ background: '#141414', borderColor: '#222222' }}
    >
      {/* Clickable header area */}
      <div
        className="p-2 cursor-pointer select-none"
        onClick={onToggleExpand}
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggleExpand?.(); } }}
      >
        {/* Top row: name + attempt dots */}
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2 min-w-0">
            {/* Status LED */}
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_COLORS[job.status]?.bg || 'bg-rmpg-500'} ${STATUS_COLORS[job.status]?.glow || ''}`} aria-label={`Status: ${job.status}`} />
            <span className="text-sm font-bold text-white truncate">{job.recipient_name}</span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <AttemptDots count={job.attempt_count} max={job.max_attempts} />
            {isExpanded ? (
              <ChevronUp className="w-3.5 h-3.5 text-rmpg-400" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 text-rmpg-400" />
            )}
          </div>
        </div>

        {/* Address */}
        {fullAddress && (
          <div className="flex items-center gap-1.5 text-xs text-rmpg-300 mb-1.5 ml-4">
            <MapPin className="w-3 h-3 flex-shrink-0" />
            <span className="truncate">{fullAddress}</span>
          </div>
        )}

        {/* Badges row */}
        <div className="flex items-center gap-1.5 ml-4 flex-wrap">
          {/* Enhancement 50: Document type with icon */}
          <span className="text-[9px] font-mono text-rmpg-400 bg-rmpg-800/60 border border-rmpg-700/40 px-1 py-0 inline-flex items-center gap-0.5">
            {(() => { const DocIcon = DOC_TYPE_ICONS[job.document_type] || FileText; return <DocIcon className="w-2.5 h-2.5" />; })()}
            {(job.document_type || '').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}
          </span>

          {/* Priority */}
          <span className={`text-[9px] font-bold font-mono border rounded-sm px-1 py-0 ${PRIORITY_STYLES[job.priority] || PRIORITY_STYLES.normal}`}>
            {formatEnumValue(job.priority)}
          </span>

          {/* Time window */}
          <span className="text-[9px] font-mono text-rmpg-300 bg-rmpg-800/40 border border-rmpg-700/30 px-1 py-0 inline-flex items-center gap-0.5">
            <TimeIcon className="w-2.5 h-2.5" />
            {timeLabel}
          </span>

          {/* Enhancement 46: Deadline countdown */}
          {isDueSoon && job.deadline && (() => {
            const msLeft = parseTimestamp(job.deadline).getTime() - Date.now();
            const hrsLeft = Math.floor(msLeft / 3600000);
            const minsLeft = Math.floor((msLeft % 3600000) / 60000);
            return (
              <span className="text-[8px] font-bold font-mono text-red-400 bg-red-900/40 border border-red-600/50 px-1 py-0 animate-pulse">
                {hrsLeft}h {minsLeft}m LEFT
              </span>
            );
          })()}
          {isOverdue && (
            <span className="text-[8px] font-bold font-mono text-red-400 bg-red-900/60 border border-red-500/60 px-1 py-0">
              OVERDUE
            </span>
          )}

          {/* Status label */}
          <span className="text-[9px] font-mono text-rmpg-400 ml-auto">
            {job.status.replace('_', ' ').toUpperCase()}
          </span>
        </div>
      </div>

      {/* Expandable details */}
      {isExpanded && (
        <div className="px-2 pb-2 border-t border-rmpg-700/40 pt-2 space-y-2 text-xs animate-in fade-in slide-in-from-top-1 duration-150">
          {/* Linked Dispatch Call */}
          {linkedCall && (
            <div className="p-2 rounded-[2px] border mb-2" style={{ background: '#88888810', borderColor: '#88888830' }}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[9px] font-bold text-[#d4a017] uppercase tracking-wider">Dispatch Link</span>
                <button type="button"
                  className="text-[10px] text-gray-400 hover:text-gray-300 underline"
                  onClick={(e) => { e.stopPropagation(); window.open(`/dispatch?call=${linkedCall.call_number}`, '_blank', 'noopener,noreferrer'); }}
                >
                  {linkedCall.call_number}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] text-rmpg-300">
                <div><span className="text-rmpg-400">Status:</span> <span className="font-mono">{linkedCall.status?.toUpperCase()}</span></div>
                <div><span className="text-rmpg-400">Priority:</span> <span className="font-mono">{linkedCall.priority?.toUpperCase()}</span></div>
                {linkedCall.pso_requestor_name && (
                  <div><span className="text-rmpg-400">Requestor:</span> {linkedCall.pso_requestor_name}</div>
                )}
                {linkedCall.contract_id && (
                  <div><span className="text-rmpg-400">Contract:</span> <span className="font-mono text-gray-400">{linkedCall.contract_id}</span></div>
                )}
              </div>
              {/* PSO Compliance mini-indicator */}
              {linkedCall.pso_service_windows && (() => {
                try {
                  const w = JSON.parse(linkedCall.pso_service_windows);
                  const met = [w.early_morning, w.daytime, w.evening, w.weekend].filter(Boolean).length;
                  return (
                    <div className="mt-1 flex items-center gap-1 text-[9px]">
                      <span className="text-rmpg-400">Compliance:</span>
                      <span className="font-mono tabular-nums" style={{ color: met === 4 ? '#4ade80' : '#fbbf24' }}>{met}/4 windows</span>
                    </div>
                  );
                } catch { return null; }
              })()}
            </div>
          )}

          {/* Case / court / jurisdiction */}
          <span className="text-[9px] font-bold text-[#d4a017] uppercase tracking-wider">Case Details</span>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-rmpg-300">
            {job.case_number && (
              <div className="flex items-center gap-1">
                <Briefcase className="w-3 h-3 text-rmpg-400" />
                <span className="text-rmpg-400">Case:</span>
                <span className="font-mono tabular-nums text-gray-400">{job.case_number}</span>
              </div>
            )}
            {job.court_name && (
              <div className="flex items-center gap-1">
                <Briefcase className="w-3 h-3 text-rmpg-400" />
                <span className="text-rmpg-400">Court:</span>
                <span>{job.court_name}</span>
              </div>
            )}
            {job.jurisdiction && (
              <div className="flex items-center gap-1">
                <span className="text-rmpg-400">Jurisdiction:</span>
                <span>{job.jurisdiction}</span>
              </div>
            )}
            {job.client_name && (
              <div className="flex items-center gap-1">
                <User className="w-3 h-3 text-rmpg-400" />
                <span className="text-rmpg-400">Client:</span>
                <span>{job.client_name}</span>
              </div>
            )}
            {job.attorney_name && (
              <div className="flex items-center gap-1">
                <User className="w-3 h-3 text-rmpg-400" />
                <span className="text-rmpg-400">Attorney:</span>
                <span>{job.attorney_name}</span>
              </div>
            )}
            {job.deadline && (
              <div className="flex items-center gap-1">
                <Calendar className="w-3 h-3 text-rmpg-400" />
                <span className="text-rmpg-400">Deadline:</span>
                <span className={isDueSoon || isOverdue ? 'text-red-400 font-bold' : ''}>
                  {safeDateStr(job.deadline)}
                </span>
              </div>
            )}
          </div>

          {/* Service instructions */}
          {job.service_instructions && (
            <div>
              <span className="text-[9px] font-bold text-[#d4a017] uppercase tracking-wider">Instructions</span>
              <p className="text-rmpg-300 mt-0.5">{job.service_instructions}</p>
            </div>
          )}

          {/* Prior attempts timeline */}
          {job.attempts && job.attempts.length > 0 && (
            <div>
              <span className="text-[9px] font-bold text-[#d4a017] uppercase tracking-wider">Prior Attempts</span>
              <div className="mt-1 space-y-1">
                {job.attempts.map((attempt) => (
                  <div
                    key={attempt.id}
                    className="flex items-start gap-2 pl-2 border-l-2 border-rmpg-600/50"
                  >
                    <span className="text-[10px] font-mono text-rmpg-400 flex-shrink-0 w-16">
                      {safeDateStr(attempt.attempt_at)}
                    </span>
                    <span className="text-[10px] font-mono text-amber-300 flex-shrink-0 w-14">
                      {attempt.attempt_type}
                    </span>
                    <span className={`text-[10px] font-mono flex-shrink-0 ${
                      attempt.result === 'served' ? 'text-green-400' : 'text-red-400'
                    }`}>
                      {ATTEMPT_RESULT_LABELS[attempt.result] || attempt.result}
                    </span>
                    {attempt.notes && (
                      <span className="text-[10px] text-rmpg-400 truncate">{attempt.notes}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Notes */}
          {job.notes && (
            <div>
              <span className="text-[9px] font-bold text-[#d4a017] uppercase tracking-wider">Notes</span>
              <p className="text-rmpg-300 mt-0.5">{job.notes}</p>
            </div>
          )}
        </div>
      )}

      {/* Action buttons row */}
      <div className="flex items-center border-t border-rmpg-700/40 divide-x divide-rmpg-700/40">
        {/* Directions link */}
        <button type="button"
          onClick={(e) => { e.stopPropagation(); window.open(`https://www.openstreetmap.org/directions?to=${encodeURIComponent(fullAddress)}`, '_blank', 'noopener,noreferrer'); }}
          className="flex-1 flex items-center justify-center gap-1 py-1.5 text-[10px] font-bold text-amber-400 hover:bg-amber-900/30 transition-colors duration-150 focus:outline-none focus:ring-1 focus:ring-[#888888]/50 focus:bg-amber-900/20"
          title="Open in Maps"
          aria-label={`Open Maps to ${job.recipient_name}`}
        >
          <MapPin className="w-3 h-3" />
          Map
        </button>
        <button type="button"
          onClick={(e) => { e.stopPropagation(); onNavigate(job.id); }}
          className="flex-1 flex items-center justify-center gap-1 py-1.5 text-[10px] font-bold text-gray-400 hover:bg-gray-900/30 transition-colors duration-150 focus:outline-none focus:ring-1 focus:ring-[#888888]/50 focus:bg-gray-900/20"
          title="Navigate"
          aria-label={`Navigate to ${job.recipient_name}`}
        >
          <MapPin className="w-3 h-3" />
          Navigate
        </button>
        <button type="button"
          onClick={(e) => { e.stopPropagation(); onAttempt(job.id); }}
          className="flex-1 flex items-center justify-center gap-1 py-1.5 text-[10px] font-bold text-green-400 hover:bg-green-900/30 transition-colors duration-150 focus:outline-none focus:ring-1 focus:ring-[#888888]/50 focus:bg-green-900/20"
          title="Attempt Service"
          aria-label={`Attempt service for ${job.recipient_name}`}
        >
          <ClipboardCheck className="w-3 h-3" />
          Attempt
        </button>
        <button type="button"
          onClick={(e) => { e.stopPropagation(); onSkipTrace(job.id); }}
          className="flex-1 flex items-center justify-center gap-1 py-1.5 text-[10px] font-bold text-gray-400 hover:bg-gray-900/30 transition-colors duration-150 focus:outline-none focus:ring-1 focus:ring-[#888888]/50 focus:bg-gray-900/20"
          title="Skip Trace"
          aria-label={`Skip trace for ${job.recipient_name}`}
        >
          <Search className="w-3 h-3" />
          Skip Trace
        </button>
        <button type="button"
          onClick={(e) => { e.stopPropagation(); onFlagAddress(job.id); }}
          className="flex-1 flex items-center justify-center gap-1 py-1.5 text-[10px] font-bold text-amber-400 hover:bg-amber-900/30 transition-colors duration-150 focus:outline-none focus:ring-1 focus:ring-[#888888]/50 focus:bg-amber-900/20"
          title="Flag Bad Address"
          aria-label={`Flag bad address for ${job.recipient_name}`}
        >
          <AlertTriangle className="w-3 h-3" />
          Flag
        </button>
      </div>
    </div>
  );
});

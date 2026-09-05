import React, { useMemo, useState, useCallback } from 'react';
import { formatEnumValue, toDisplayLabel } from '../../utils/formatters';
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
  Pencil,
  CheckCircle2,
  Bot,
  Flame,
  Phone,
  Mail,
  Copy,
  Check,
  DollarSign,
  Lock,
  KeyRound,
  ClipboardList,
  Scale,
  Building2,
  Link2,
} from 'lucide-react';
import type { ServeJob, ServeJobLinkedCall, ServeAttempt } from '../../types';
import { safeDateStr, safeTimeStr, parseTimestamp } from '../../utils/dateUtils';
import { formatCodeShort } from '../../constants/processServiceCodes';
import { getMatterCategoryByDocType } from '../../constants/documentTypes';
import ServeReceiptActions from './ServeReceiptActions';
import DiligencePanel from './DiligencePanel';
import ServeJobComments from './ServeJobComments';
import ServeJobOpsPanel from './ServeJobOpsPanel';
import ServeJobQuickFields from './ServeJobQuickFields';
import { parseServeJobMeta } from '../../utils/serveJobIntake';

interface ServeJobCardProps {
  job: ServeJob;
  linkedCall?: ServeJobLinkedCall | null;
  onAttempt: (jobId: number) => void;
  onNavigate: (jobId: number) => void;
  onSkipTrace: (jobId: number) => void;
  onFlagAddress: (jobId: number) => void;
  onEdit: (jobId: number) => void;
  /** Edit a previously-logged attempt — opens EditServeAttemptModal in the parent. */
  onEditAttempt?: (jobId: number, attempt: ServeAttempt) => void;
  /** Open audit trail modal for this job. */
  onAudit?: (jobId: number) => void;
  onOpsSaved?: () => void;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  // ── Selection mode (bulk actions) ──────────────────────────────────────────
  /** Whether this card is currently selected for bulk operations. */
  isSelected?: boolean;
  /** Toggle the selected state of this card. */
  onToggleSelect?: () => void;
}

const STATUS_COLORS: Record<string, { bg: string; glow: string; dot: string; label: string; badge: string }> = {
  pending:     { bg: 'bg-rmpg-500',              glow: 'shadow-[0_0_6px_rgba(136,136,136,0.5)]',  dot: 'bg-rmpg-400',    label: 'PENDING',     badge: 'bg-rmpg-800/60 text-rmpg-300 border-rmpg-600/50' },
  // No animate-pulse anywhere in this card. Urgency is carried by colour,
  // the red ring and the tier badge — all of which stay. Animating them as
  // well meant a queue where several jobs are due at once had several cards
  // flaring in and out simultaneously, which reads as an alarm rather than
  // a priority and is exhausting to work a shift against.
  in_progress: { bg: 'bg-amber-500', glow: '', dot: 'bg-amber-400', label: 'IN PROGRESS', badge: 'bg-amber-900/50 text-amber-300 border-amber-700/50' },
  served:      { bg: 'bg-green-500',             glow: 'shadow-[0_0_6px_rgba(34,197,94,0.5)]',   dot: 'bg-green-400',   label: 'SERVED',      badge: 'bg-green-900/50 text-green-300 border-green-700/50' },
  failed:      { bg: 'bg-red-500',               glow: 'shadow-[0_0_6px_rgba(239,68,68,0.5)]',   dot: 'bg-red-400',     label: 'FAILED',      badge: 'bg-red-900/50 text-red-300 border-red-700/50' },
  skipped:     { bg: 'bg-rmpg-500',              glow: 'shadow-[0_0_6px_rgba(107,114,128,0.5)]', dot: 'bg-rmpg-400',    label: 'SKIPPED',     badge: 'bg-rmpg-800/60 text-rmpg-400 border-rmpg-600/50' },
  archived:    { bg: 'bg-rmpg-600',              glow: 'shadow-[0_0_6px_rgba(75,85,99,0.5)]',    dot: 'bg-rmpg-500',    label: 'ARCHIVED',    badge: 'bg-rmpg-900/60 text-fg-muted border-rmpg-700/50' },
};

const PRIORITY_STYLES: Record<string, string> = {
  rush: 'bg-red-900/60 text-red-300 border-red-700/50',
  high: 'bg-amber-900/60 text-amber-300 border-amber-700/50',
  normal: 'bg-surface-sunken/60 text-rmpg-300 border-border-default/50',
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
  sub_served: 'Sub. Service',
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

const SERVE_TYPE_STYLES: Record<string, string> = {
  personal:    'bg-blue-900/40 text-blue-300 border-blue-700/50',
  substituted: 'bg-amber-900/40 text-amber-300 border-amber-700/50',
  corporate:   'bg-purple-900/40 text-purple-300 border-purple-700/50',
  posting:     'bg-rmpg-800/60 text-rmpg-300 border-rmpg-600/50',
  publication: 'bg-rmpg-800/60 text-rmpg-400 border-rmpg-600/50',
};

const PAYMENT_STATUS_STYLES: Record<string, string> = {
  unpaid:   'bg-red-900/40 text-red-300 border-red-700/50',
  invoiced: 'bg-amber-900/40 text-amber-300 border-amber-700/50',
  paid:     'bg-green-900/40 text-green-300 border-green-700/50',
  waived:   'bg-rmpg-800/60 text-rmpg-400 border-rmpg-600/50',
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
  onEditAttempt,
  onAudit,
  onOpsSaved,
  isExpanded = false,
  onToggleExpand,
  isSelected = false,
  onToggleSelect,
}: ServeJobCardProps) {
  // Deadline urgency only applies to jobs still awaiting service — a job
  // that's already served/failed/archived is resolved and shouldn't show a
  // pulsing OVERDUE/CRITICAL alert just because its deadline has since passed.
  const isOpenJob = job.status === 'pending' || job.status === 'in_progress';

  const isDueSoon = useMemo(() => {
    if (!isOpenJob || !job.deadline) return false;
    const deadlineMs = parseTimestamp(job.deadline).getTime();
    const now = Date.now();
    return deadlineMs - now <= 48 * 60 * 60 * 1000 && deadlineMs > now;
  }, [isOpenJob, job.deadline]);

  const isOverdue = useMemo(() => {
    if (!isOpenJob || !job.deadline) return false;
    return parseTimestamp(job.deadline).getTime() <= Date.now();
  }, [isOpenJob, job.deadline]);

  // Same rule as isDueSoon/isOverdue above: urgency describes how hard a job is
  // still pushing for attention, so it stops applying once the job is resolved.
  // Gating only the deadline chips left every served/archived card rendering a
  // red CRITICAL flame and a red ring — on the live queue that was *every* card
  // in the Served folder, which trains operators to ignore the colour that is
  // supposed to mean "act now".
  // Carries the tier rather than a boolean so the JSX below narrows without a
  // non-null assertion.
  const shownUrgency = isOpenJob && job.urgency_tier && job.urgency_tier !== 'standard'
    ? job.urgency_tier
    : null;
  const isCritical = isOpenJob && job.urgency_tier === 'critical';
  const statusCfg = STATUS_COLORS[job.status] ?? STATUS_COLORS.pending;

  const fullAddress = [job.recipient_address, job.recipient_city, job.recipient_state, job.recipient_zip]
    .filter(Boolean)
    .join(', ');

  const TimeIcon = TIME_WINDOW_CONFIG[job.time_window]?.icon ?? Clock;
  const timeLabel = TIME_WINDOW_CONFIG[job.time_window]?.label ?? job.time_window;
  const opsMeta = useMemo(() => parseServeJobMeta(job.parsed_data), [job.parsed_data]);

  // Selection mode is active whenever the prop is wired up (parent has at
  // least one card selected or is displaying the selection UI).
  const selectionModeActive = onToggleSelect !== undefined;

  // Feature 18: Copy address to clipboard
  const [copied, setCopied] = useState(false);
  const handleCopyAddress = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!fullAddress) return;
    navigator.clipboard?.writeText(fullAddress).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }, [fullAddress]);

  // Feature 27: diligence required warning
  const needsDiligence = !!job.diligence_required && job.status !== 'served';

  // Return-date urgency
  const returnDateMs = job.return_date ? parseTimestamp(job.return_date).getTime() : null;
  const returnOverdue = returnDateMs !== null && returnDateMs <= Date.now() && job.status !== 'served';
  const returnDueSoon = returnDateMs !== null && !returnOverdue && returnDateMs - Date.now() <= 48 * 60 * 60 * 1000;

  return (
    <div
      role="article"
      tabIndex={0}
      aria-label={`Serve job: ${job.recipient_name}${isSelected ? ' — selected' : ''}`}
      aria-selected={selectionModeActive ? isSelected : undefined}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          // In selection mode Space/Enter toggles selection; otherwise expand.
          if (selectionModeActive && e.key === ' ') {
            onToggleSelect?.();
          } else {
            onToggleExpand?.();
          }
        }
      }}
      className={`
        panel-beveled rounded-[2px] transition-all duration-150 hover:bg-surface-raised hover:shadow-md
        ${isDueSoon && !isSelected ? 'ring-1 ring-red-500/60' : ''}
        ${isOverdue && !isSelected ? 'ring-1 ring-red-600/80 shadow-[0_0_8px_rgba(239,68,68,0.3)]' : ''}
        ${isSelected ? 'ring-1 ring-brand-400 shadow-[0_0_8px_rgb(var(--accent-silver-400-rgb)/0.25)]' : ''}
        ${!isDueSoon && !isOverdue && !isSelected && isCritical ? 'ring-1 ring-red-500/60' : ''}
      `}
      style={{ background: 'var(--surface-base)', borderColor: 'var(--border-subtle)' }}
    >
      {/* Selection mode banner — only shown when the parent is wiring selection */}
      {selectionModeActive && (
        <div className="flex items-center gap-1 px-2 pt-1 pb-0">
          <span className="text-[8px] font-bold tracking-wider text-brand-400 uppercase">
            Selection mode
          </span>
        </div>
      )}

      {/* Clickable header area */}
      <div
        className="p-2 cursor-pointer select-none"
        onClick={onToggleExpand}
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggleExpand?.(); } }}
      >
        {/* Top row: name + attempt dots + optional checkbox */}
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2 min-w-0">
            {/* Status LED */}
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${statusCfg.bg} ${statusCfg.glow}`} aria-label={`Status: ${job.status}`} />
            <span className="text-sm font-bold text-rmpg-100 truncate">{job.recipient_name}</span>
            {((Number(job.linked_attempt_number) || Number(linkedCall?.pso_attempt_number) || 0) > 1
              || !!job.linked_parent_call_id || !!linkedCall?.parent_call_id) && (
              <span
                title="Return visits stay on this same Process Server job"
                className="flex-shrink-0 text-[8px] font-bold font-mono px-1 py-0 rounded-[2px] border"
                style={{ color: 'var(--panel-header-color)', borderColor: 'rgb(var(--brand-gold-rgb)/0.35)', background: 'rgb(var(--brand-gold-rgb)/0.08)' }}
              >
                VISIT {job.linked_attempt_number || linkedCall?.pso_attempt_number || 1}
              </span>
            )}
            {/* Intake-screened shield — warrant check completed */}
            {job.intake_screened_at && (
              <span
                title={`Warrant check completed ${safeDateStr(job.intake_screened_at)}`}
                className="flex-shrink-0 text-green-400"
                aria-label="Warrant/intake check completed"
              >
                <Shield className="w-3 h-3" />
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <AttemptDots count={job.attempt_count} max={job.max_attempts} />

            {/* Checkbox — only rendered when selection mode is active */}
            {selectionModeActive && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onToggleSelect?.(); }}
                aria-label={isSelected ? `Deselect ${job.recipient_name}` : `Select ${job.recipient_name}`}
                aria-pressed={isSelected}
                className={`
                  w-4 h-4 rounded-[2px] border flex items-center justify-center flex-shrink-0
                  transition-colors focus:outline-none focus:ring-1 focus:ring-brand-400
                  ${isSelected
                    ? 'bg-brand-400 border-brand-400'
                    : 'bg-surface-sunken border-border-default hover:border-brand-400/60'}
                `}
              >
                {isSelected && (
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 10 8"
                    width="8"
                    height="6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-surface-base"
                  >
                    <polyline points="1,4 3.5,6.5 9,1" />
                  </svg>
                )}
              </button>
            )}

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
          {/* Matter Category Badge */}
          {(() => {
            const cat = getMatterCategoryByDocType(job.document_type || '');
            return (
              <span className={`text-[9px] font-semibold uppercase font-mono px-1 py-0 border rounded-[2px] ${cat.badgeBg} ${cat.badgeText} ${cat.badgeBorder}`}>
                {cat.shortLabel}
              </span>
            );
          })()}

          {/* Document type with icon */}
          <span className="text-[9px] font-mono text-rmpg-200 bg-rmpg-800/60 border border-rmpg-700/40 px-1 py-0 inline-flex items-center gap-0.5">
            {(() => { const DocIcon = DOC_TYPE_ICONS[job.document_type] || FileText; return <DocIcon className="w-2.5 h-2.5" />; })()}
            {job.document_type || 'Legal Document'}
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
          {opsMeta.venue && opsMeta.venue !== 'none' && (
            <span className="text-[8px] font-bold uppercase font-mono px-1 py-0 border rounded-[2px] text-brand-200 border-brand-700/40 bg-brand-900/20">
              {(opsMeta.venueLabel || opsMeta.venue).replace(/_/g, ' ')}
            </span>
          )}
          {opsMeta.addressClass && opsMeta.addressClass !== 'unknown' && (
            <span className="text-[8px] font-mono px-1 py-0 rounded-[2px] border border-rmpg-600/40 text-rmpg-300">
              {opsMeta.addressClass.replace(/_/g, ' ')}
            </span>
          )}
          {opsMeta.ops?.no_sunday && (
            <span className="text-[8px] font-bold px-1 py-0 rounded-[2px] border border-amber-700/50 text-amber-300">NO SUN</span>
          )}

          {/* Enhancement 46: Deadline countdown */}
          {isDueSoon && job.deadline && (() => {
            const msLeft = parseTimestamp(job.deadline).getTime() - Date.now();
            const hrsLeft = Math.floor(msLeft / 3600000);
            const minsLeft = Math.floor((msLeft % 3600000) / 60000);
            return (
              <span className="text-[8px] font-bold font-mono text-red-400 bg-red-900/40 border border-red-600/50 px-1 py-0">
                {hrsLeft}h {minsLeft}m LEFT
              </span>
            );
          })()}
          {isOverdue && (
            <span className="text-[8px] font-bold font-mono text-red-400 bg-red-900/60 border border-red-500/60 px-1 py-0">
              OVERDUE
            </span>
          )}

          {/* Auto-assigned badge */}
          {!!job.auto_assigned && (
            <span title="Auto-assigned by system" className="inline-flex items-center gap-0.5 text-[8px] font-bold text-rmpg-300 bg-rmpg-600/40 border border-rmpg-500/50 px-1 py-0 rounded-[2px]">
              <Bot className="w-2.5 h-2.5" />AUTO-ASSIGNED
            </span>
          )}
          {/* Urgency tier badge — critical uses a Flame icon. Static: see the
              note on the status map above for why nothing here animates. */}
          {shownUrgency && (
            <span title={`Urgency: ${shownUrgency}`} className={`inline-flex items-center gap-0.5 text-[8px] font-bold px-1 py-0 rounded-[2px] border ${
              shownUrgency === 'critical'
                ? 'text-red-300 bg-red-900/40 border-red-600/60'
                : 'text-amber-400 bg-amber-900/20 border-amber-600/50'
            }`}>
              {shownUrgency === 'critical'
                ? <Flame className="w-2.5 h-2.5" />
                : <AlertTriangle className="w-2.5 h-2.5" />}
              {shownUrgency.toUpperCase()}
            </span>
          )}
          {/* Feature 21: Serve type badge */}
          {job.serve_type && job.serve_type !== 'personal' && (
            <span className={`text-[8px] font-bold font-mono border rounded-[2px] px-1 py-0 ${SERVE_TYPE_STYLES[job.serve_type] ?? SERVE_TYPE_STYLES.personal}`}>
              {job.serve_type.toUpperCase()}
            </span>
          )}
          {/* Feature 22: Case type badge */}
          {job.case_type && (
            <span className="text-[8px] font-mono text-rmpg-300 bg-rmpg-800/50 border border-rmpg-600/40 px-1 py-0 rounded-[2px]">
              {formatEnumValue(job.case_type)}
            </span>
          )}
          {/* Feature 24: Payment status badge (only show unpaid/invoiced as warnings) */}
          {job.payment_status && job.payment_status !== 'paid' && job.payment_status !== 'waived' && (
            <span className={`inline-flex items-center gap-0.5 text-[8px] font-bold border rounded-[2px] px-1 py-0 ${PAYMENT_STATUS_STYLES[job.payment_status] ?? PAYMENT_STATUS_STYLES.unpaid}`}>
              <DollarSign className="w-2 h-2" />{job.payment_status.toUpperCase()}
            </span>
          )}
          {/* Feature 27: Diligence required warning */}
          {needsDiligence && (
            <span title="Due diligence documentation required" className="inline-flex items-center gap-0.5 text-[8px] font-bold text-amber-300 bg-amber-900/40 border border-amber-700/50 px-1 py-0 rounded-[2px]">
              <ClipboardList className="w-2.5 h-2.5" />DILIGENCE
            </span>
          )}
          {/* [16] Diligence countdown chip — days until deadline, colored by urgency tier */}
          {job.deadline && !job.closed_at && (() => {
            const daysLeft = Math.ceil(
              (parseTimestamp(job.deadline).getTime() - Date.now()) / 86_400_000,
            );
            if (daysLeft > 7) return null;
            const style = daysLeft <= 1
              ? 'text-red-300 bg-red-900/50 border-red-600/60'
              : daysLeft <= 3
              ? 'text-amber-300 bg-amber-900/40 border-amber-700/50'
              : 'text-fg-secondary bg-rmpg-800/50 border-rmpg-600/40';
            return (
              <span title={`Deadline: ${safeDateStr(job.deadline)}`}
                className={`inline-flex items-center gap-0.5 text-[8px] font-bold border rounded-[2px] px-1 py-0 ${style}`}>
                <Calendar className="w-2.5 h-2.5" />{daysLeft <= 0 ? 'OVERDUE' : `${daysLeft}d LEFT`}
              </span>
            );
          })()}

          {/* [17] Never attempted warning — job has been active more than 24h with zero attempts */}
          {!job.closed_at && (job.attempt_count ?? 0) === 0 &&
            (Date.now() - parseTimestamp(job.created_at ?? '').getTime()) > 86_400_000 && (
            <span title="No service attempts yet" className="inline-flex items-center gap-0.5 text-[8px] font-bold text-orange-300 bg-orange-900/40 border border-orange-700/50 px-1 py-0 rounded-[2px]">
              <AlertTriangle className="w-2.5 h-2.5" />NEVER ATTEMPTED
            </span>
          )}

          {/* [18] Witness fee chip — shown when serve_fee or rush_fee indicates a fee is set */}
          {(Number(job.serve_fee ?? 0) > 0 || Number(job.rush_fee ?? 0) > 0) && (
            <span title={`Serve fee: $${Number(job.serve_fee ?? 0).toFixed(2)}${Number(job.rush_fee ?? 0) > 0 ? ` + $${Number(job.rush_fee).toFixed(2)} rush` : ''}`}
              className="inline-flex items-center gap-0.5 text-[8px] font-bold text-green-300 bg-green-900/30 border border-green-700/40 px-1 py-0 rounded-[2px]">
              <DollarSign className="w-2 h-2" />FEE ${(Number(job.serve_fee ?? 0) + Number(job.rush_fee ?? 0)).toFixed(2)}
            </span>
          )}

          {/* Closed chip — green-800/green-300, shown whenever closed_at is set */}
          {job.closed_at && (
            <span title={`Closed ${safeDateStr(job.closed_at)}`} className="inline-flex items-center gap-0.5 text-[8px] font-bold text-green-300 bg-green-900/50 border border-green-700/50 px-1 py-0 rounded-[2px]">
              <CheckCircle2 className="w-2.5 h-2.5" />CLOSED {safeDateStr(job.closed_at)}
            </span>
          )}
          {/* Status chip — colored dot + label */}
          <span className={`text-[9px] font-mono border px-1 py-0 inline-flex items-center gap-1 ml-auto ${statusCfg.badge}`}>
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusCfg.dot}`} />
            {statusCfg.label}
          </span>
        </div>
      </div>

      {/* Expandable details */}
      {isExpanded && (
        <div className="px-2 pb-2 border-t border-rmpg-700/40 pt-2 space-y-2 text-xs animate-in fade-in slide-in-from-top-1 duration-150">
          {/* Linked Dispatch Call */}
          {linkedCall && (
            <div className="p-2 rounded-[2px] border mb-2" style={{ background: 'rgb(var(--accent-silver-500-rgb) / 0.06)', borderColor: 'rgb(var(--accent-silver-500-rgb) / 0.19)' }}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: 'var(--panel-header-color)' }}>Dispatch Link</span>
                <button type="button"
                  className="text-[10px] text-rmpg-400 hover:text-rmpg-300 underline"
                  onClick={(e) => { e.stopPropagation(); window.open(`/dispatch?call=${linkedCall.call_number}`, '_blank', 'noopener,noreferrer'); }}
                >
                  {linkedCall.call_number}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] text-rmpg-300">
                <div><span className="text-rmpg-400">Status:</span> <span className="font-mono">{linkedCall.status?.toUpperCase()}</span></div>
                <div><span className="text-rmpg-400">Priority:</span> <span className="font-mono">{linkedCall.priority?.toUpperCase()}</span></div>
                {(linkedCall.pso_attempt_number || job.linked_attempt_number) && (
                  <div><span className="text-fg-muted">Visit:</span> <span className="font-mono">{linkedCall.pso_attempt_number || job.linked_attempt_number}</span></div>
                )}
                {job.id != null && (
                  <div className="flex items-center gap-1"><Link2 className="w-3 h-3 text-fg-muted" /><span className="text-fg-muted">Job ID:</span> <span className="font-mono">{job.id}</span></div>
                )}
                {linkedCall.pso_requestor_name && (
                  <div><span className="text-rmpg-400">Requestor:</span> {linkedCall.pso_requestor_name}</div>
                )}
                {linkedCall.contract_id && (
                  <div><span className="text-rmpg-400">Contract:</span> <span className="font-mono text-rmpg-400">{linkedCall.contract_id}</span></div>
                )}
              </div>
              {(linkedCall.parent_call || linkedCall.parentCall || (linkedCall.child_calls?.length ?? linkedCall.childCalls?.length ?? 0) > 0) && (
                <div className="mt-1.5 pt-1.5 border-t border-rmpg-700/40 space-y-0.5">
                  <div className="text-[9px] text-fg-muted">Return visits share this job — they do not create a new queue entry.</div>
                  {(linkedCall.parent_call || linkedCall.parentCall) && (
                    <div className="text-[10px] text-fg-secondary">
                      Original:{' '}
                      <span className="font-mono">{(linkedCall.parent_call || linkedCall.parentCall)?.call_number}</span>
                    </div>
                  )}
                  {(linkedCall.child_calls || linkedCall.childCalls || []).map((c) => (
                    <div key={c.id} className="text-[10px] text-fg-secondary">
                      Visit {c.pso_attempt_number ?? '—'} · <span className="font-mono">{c.call_number}</span> · {c.status}
                    </div>
                  ))}
                </div>
              )}
              {/* PSO Compliance mini-indicator */}
              {linkedCall.pso_service_windows && (() => {
                try {
                  const w = JSON.parse(linkedCall.pso_service_windows);
                  const met = [w.early_morning, w.daytime, w.evening, w.weekend].filter(Boolean).length;
                  return (
                    <div className="mt-1 flex items-center gap-1 text-[9px]">
                      <span className="text-rmpg-400">Compliance:</span>
                      <span className="font-mono tabular-nums" style={{ color: met === 4 ? 'var(--sev-ok)' : 'var(--sev-warn-soft)' }}>{met}/4 windows</span>
                    </div>
                  );
                } catch { return null; }
              })()}
            </div>
          )}

          <ServeJobOpsPanel meta={opsMeta} compact />
          {onOpsSaved && job.status !== 'served' && job.status !== 'archived' && (
            <ServeJobQuickFields job={job} onUpdated={() => onOpsSaved()} />
          )}

          {/* Feature 19-20: Contact info — phone, email, DOB */}
          {(job.recipient_phone || job.recipient_email || job.recipient_dob) && (
            <div>
              <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: 'var(--panel-header-color)' }}>Contact</span>
              <div className="mt-0.5 grid grid-cols-2 gap-x-4 gap-y-0.5 text-[10px] text-rmpg-300">
                {job.recipient_phone && (
                  <div className="flex items-center gap-1">
                    <Phone className="w-3 h-3 text-rmpg-400 flex-shrink-0" />
                    <a href={`tel:${job.recipient_phone}`} onClick={e => e.stopPropagation()} className="text-blue-400 hover:text-blue-300 underline">{job.recipient_phone}</a>
                  </div>
                )}
                {job.recipient_email && (
                  <div className="flex items-center gap-1">
                    <Mail className="w-3 h-3 text-rmpg-400 flex-shrink-0" />
                    <a href={`mailto:${job.recipient_email}`} onClick={e => e.stopPropagation()} className="text-blue-400 hover:text-blue-300 underline truncate max-w-[120px]">{job.recipient_email}</a>
                  </div>
                )}
                {job.recipient_dob && (
                  <div className="flex items-center gap-1 col-span-2">
                    <User className="w-3 h-3 text-rmpg-400 flex-shrink-0" />
                    <span className="text-rmpg-400">DOB:</span>
                    <span className="font-mono tabular-nums">{job.recipient_dob}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Feature 21-22: Employment info */}
          {(job.recipient_employer || job.recipient_employer_address) && (
            <div>
              <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: 'var(--panel-header-color)' }}>Employment</span>
              <div className="mt-0.5 space-y-0.5 text-[10px] text-rmpg-300">
                {job.recipient_employer && (
                  <div className="flex items-center gap-1">
                    <Building2 className="w-3 h-3 text-rmpg-400 flex-shrink-0" />
                    <span>{job.recipient_employer}</span>
                  </div>
                )}
                {job.recipient_employer_address && (
                  <div className="flex items-center gap-1 ml-4">
                    <MapPin className="w-3 h-3 text-rmpg-400 flex-shrink-0" />
                    <span>{job.recipient_employer_address}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Feature 23: Case / court / jurisdiction */}
          <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: 'var(--panel-header-color)' }}>Case Details</span>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-rmpg-300">
            {job.case_number && (
              <div className="flex items-center gap-1">
                <Briefcase className="w-3 h-3 text-rmpg-400" />
                <span className="text-rmpg-400">Case:</span>
                <span className="font-mono tabular-nums text-rmpg-400">{job.case_number}</span>
              </div>
            )}
            {job.court_date && (
              <div className="flex items-center gap-1">
                <Calendar className="w-3 h-3 text-rmpg-400" />
                <span className="text-rmpg-400">Court date:</span>
                <span>{job.court_date}</span>
              </div>
            )}
            {opsMeta.ops?.documents_to_serve && (
              <div className="flex items-start gap-1 col-span-2">
                <FileText className="w-3 h-3 text-rmpg-400 flex-shrink-0 mt-0.5" />
                <span className="text-rmpg-400 flex-shrink-0">Packet:</span>
                <span className="text-rmpg-300">{opsMeta.ops.documents_to_serve}</span>
              </div>
            )}
            {job.sm_job_id && (
              <div className="flex items-center gap-1">
                <span className="text-rmpg-400">Job #:</span>
                <span className="font-mono tabular-nums text-rmpg-300">{job.sm_job_id}</span>
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
            {job.attorney_phone && (
              <div className="flex items-center gap-1">
                <Phone className="w-3 h-3 text-fg-muted" />
                <span className="text-fg-muted">Atty phone:</span>
                <a href={`tel:${job.attorney_phone}`} onClick={e => e.stopPropagation()} className="text-blue-400 hover:text-blue-300 underline">{job.attorney_phone}</a>
              </div>
            )}
            {job.attorney_email && (
              <div className="flex items-center gap-1">
                <Mail className="w-3 h-3 text-fg-muted" />
                <span className="text-fg-muted">Atty email:</span>
                <a href={`mailto:${job.attorney_email}`} onClick={e => e.stopPropagation()} className="text-blue-400 hover:text-blue-300 underline truncate max-w-[160px]">{job.attorney_email}</a>
              </div>
            )}
            {job.attorney_bar_number && (
              <div className="flex items-center gap-1">
                <span className="text-fg-muted">Bar #:</span>
                <span className="font-mono tabular-nums">{job.attorney_bar_number}</span>
              </div>
            )}
            {job.registered_agent_name && (
              <div className="flex items-center gap-1 col-span-2">
                <User className="w-3 h-3 text-fg-muted" />
                <span className="text-fg-muted">Registered agent:</span>
                <span>{job.registered_agent_name}</span>
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
            {job.closed_at && (
              <div className="flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3 text-green-400" />
                <span className="text-rmpg-400">Closed:</span>
                <span className="text-green-300">{safeDateStr(job.closed_at)}</span>
              </div>
            )}
            {job.intake_screened_at && (
              <div className="flex items-center gap-1">
                <Shield className="w-3 h-3 text-green-400" />
                <span className="text-rmpg-400">Screened:</span>
                <span className="text-green-300">{safeDateStr(job.intake_screened_at)}</span>
              </div>
            )}
            {/* Feature 23: Return date */}
            {job.return_date && (
              <div className="flex items-center gap-1 col-span-2">
                <Calendar className="w-3 h-3 text-rmpg-400 flex-shrink-0" />
                <span className="text-rmpg-400">Return Date:</span>
                <span className={returnOverdue ? 'text-red-400 font-bold' : returnDueSoon ? 'text-amber-400 font-semibold' : ''}>
                  {safeDateStr(job.return_date)}
                  {returnOverdue && ' — OVERDUE'}
                  {returnDueSoon && !returnOverdue && ' — DUE SOON'}
                </span>
              </div>
            )}
            {/* Feature 10: Relationship (substituted service) */}
            {job.relationship && (
              <div className="flex items-center gap-1 col-span-2">
                <User className="w-3 h-3 text-rmpg-400 flex-shrink-0" />
                <span className="text-rmpg-400">Relationship:</span>
                <span>{job.relationship}</span>
              </div>
            )}
            {/* Feature 9: Co-defendants */}
            {job.co_defendants && (
              <div className="flex items-start gap-1 col-span-2">
                <Scale className="w-3 h-3 text-rmpg-400 flex-shrink-0 mt-0.5" />
                <span className="text-rmpg-400 flex-shrink-0">Co-Defendants:</span>
                <span className="text-rmpg-300">{job.co_defendants}</span>
              </div>
            )}
            {/* Feature 11-13: Billing */}
            {(job.serve_fee != null || job.rush_fee != null) && (
              <div className="flex items-center gap-1 col-span-2">
                <DollarSign className="w-3 h-3 text-rmpg-400 flex-shrink-0" />
                <span className="text-rmpg-400">Fee:</span>
                <span className="font-mono tabular-nums text-green-300">
                  ${(Number(job.serve_fee ?? 0) + Number(job.rush_fee ?? 0)).toFixed(2)}
                  {job.rush_fee ? ` (incl. $${Number(job.rush_fee).toFixed(2)} rush)` : ''}
                </span>
                {job.payment_status && (
                  <span className={`ml-1 text-[8px] font-bold border px-1 py-0 rounded-[2px] ${PAYMENT_STATUS_STYLES[job.payment_status] ?? PAYMENT_STATUS_STYLES.unpaid}`}>
                    {job.payment_status.toUpperCase()}
                  </span>
                )}
              </div>
            )}
            {job.mileage_actual != null && (
              <div className="flex items-center gap-1">
                <MapPin className="w-3 h-3 text-rmpg-400 flex-shrink-0" />
                <span className="text-rmpg-400">Mileage:</span>
                <span className="font-mono tabular-nums">{Number(job.mileage_actual).toFixed(1)} mi</span>
              </div>
            )}
          </div>

          {/* Feature 25-26: Building access notes and contact restrictions */}
          {job.building_access_notes && (
            <div>
              <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: 'var(--panel-header-color)' }}>
                <KeyRound className="inline w-3 h-3 mr-1" />Building Access
              </span>
              <p className="text-rmpg-300 mt-0.5 text-[10px] bg-surface-sunken/50 rounded-[2px] px-2 py-1 border border-rmpg-700/30">{job.building_access_notes}</p>
            </div>
          )}
          {job.contact_restrictions && (
            <div>
              <span className="text-[9px] font-bold uppercase tracking-wider text-amber-400">
                <Lock className="inline w-3 h-3 mr-1" />Contact Restrictions
              </span>
              <p className="text-amber-200/80 mt-0.5 text-[10px] bg-amber-900/20 rounded-[2px] px-2 py-1 border border-amber-700/30">{job.contact_restrictions}</p>
            </div>
          )}

          {/* Service instructions */}
          {job.service_instructions && (
            <div>
              <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: 'var(--panel-header-color)' }}>Instructions</span>
              <p className="text-rmpg-300 mt-0.5">{job.service_instructions}</p>
            </div>
          )}

          {/* Diligence record — sits directly above the raw timeline because it
              is the READ of that timeline.
              Shown for every job EXCEPT a served one. The original gate was
              `isOpenJob`, which was backwards: it hid the panel on exactly the
              non-service jobs whose Affidavit of Non-Service is built from this
              chain, and on the live queue (0 pending, 0 in-progress) that meant
              it never rendered at all. Only a served job makes it moot — there
              the chain is history, not evidence still being assembled. */}
          {job.status !== 'served' && job.attempts && job.attempts.length > 0 && (
            <DiligencePanel attempts={job.attempts} />
          )}

          {/* [19] Comment thread panel — always visible in expanded view */}
          <ServeJobComments jobId={job.id} />

          {/* Prior attempts timeline */}
          {job.attempts && job.attempts.length > 0 && (
            <div>
              <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: 'var(--panel-header-color)' }}>Prior Attempts</span>
              <div className="mt-1 space-y-1">
                {job.attempts.map((attempt) => (
                  <div
                    key={attempt.id}
                    className="flex items-center gap-2 pl-2 border-l-2 border-rmpg-600/50"
                  >
                    <span className="text-[10px] font-mono text-rmpg-400 flex-shrink-0 w-16">
                      {safeDateStr(attempt.attempt_at)}
                    </span>
                    {/* Time of day is load-bearing on serve jobs, not decoration:
                        diligence requirements are written as time windows ("1
                        attempt between 7AM and 9AM, 1 between 9AM and 7PM, 1
                        between 7PM and 9PM"), so an officer reviewing prior
                        attempts cannot tell whether the windows are covered
                        from the date alone. Mountain Time, same as every other
                        timestamp surface. */}
                    <span
                      className="text-[10px] font-mono text-fg-secondary flex-shrink-0 w-11 tabular-nums"
                      title="Attempt time (Mountain Time)"
                    >
                      {safeTimeStr(attempt.attempt_at, '')}
                    </span>
                    <span className="text-[10px] font-mono text-amber-300 flex-shrink-0 w-14">
                      {formatEnumValue(attempt.attempt_type)}
                    </span>
                    <span className={`text-[10px] font-mono flex-shrink-0 ${
                      attempt.result === 'served' ? 'text-green-400' : 'text-red-400'
                    }`}>
                      {ATTEMPT_RESULT_LABELS[attempt.result] || attempt.result}
                    </span>
                    {(() => {
                      const fallback = attempt.notes
                        || formatCodeShort(attempt.disposition_code);
                      if (!fallback) return null;
                      const isFallback = !attempt.notes;
                      return (
                        <span
                          className={`text-[10px] truncate flex-1 min-w-0 ${
                            isFallback ? 'italic text-fg-muted' : 'text-rmpg-400'
                          }`}
                          title={isFallback ? 'No operator notes — showing disposition code' : undefined}
                        >
                          {fallback}
                        </span>
                      );
                    })()}
                    {/* Edit affordance — always visible (no hover gate). Field
                        operators on iPad/phone have no hover state, so a
                        group-hover:opacity-100 pencil was invisible to them.
                        Bumped icon + padding clears the iOS-HIG 44×44 minimum
                        without enlarging the row visually. */}
                    {onEditAttempt && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onEditAttempt(job.id, attempt); }}
                        className="ml-auto flex-shrink-0 text-amber-400 hover:text-amber-300 active:text-amber-200 bg-rmpg-800/40 hover:bg-rmpg-800/70 border border-amber-700/40 hover:border-amber-500/60 rounded-[2px] inline-flex items-center gap-1 px-1.5 py-1 text-[10px] font-medium focus:outline-none focus:ring-1 focus:ring-amber-400"
                        title={`Edit attempt #${attempt.attempt_number}`}
                        aria-label={`Edit attempt ${attempt.attempt_number} for ${job.recipient_name}`}
                      >
                        <Pencil className="w-3 h-3" />
                        <span>Edit</span>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Notice of Attempt — QR scan evidence (migration 0189) */}
          {job.scans && job.scans.length > 0 && (
            <div>
              <span className="text-[9px] font-bold text-[color:var(--field-label-color)] uppercase tracking-wider">
                Notice Scans ({job.scans.length})
              </span>
              <div className="mt-1 space-y-1">
                {job.scans.map((scan) => (
                  <div key={scan.id} className="flex items-center gap-2 pl-2 border-l-2 border-rmpg-600/50">
                    <span className="text-[10px] font-mono text-rmpg-400 flex-shrink-0 w-16">
                      {safeDateStr(scan.scanned_at)}
                    </span>
                    <span className="text-[10px] font-mono text-amber-300 flex-shrink-0 w-14">
                      {formatEnumValue(scan.device_type || 'scan')}
                    </span>
                    <span className="text-[10px] text-rmpg-400 flex-1 min-w-0 truncate" title={scan.ip_address || undefined}>
                      {[scan.geo_city, scan.geo_region, scan.geo_country].filter(Boolean).join(', ')}
                      {[scan.geo_city, scan.geo_region, scan.geo_country].some(Boolean) ? ' · ' : ''}
                      {[scan.os_family, scan.browser_family].filter(Boolean).join(' / ') || scan.ip_address}
                      {scan.is_proxy ? ' · PROXY' : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Empty-state prompt: no attempts yet on an in-progress job */}
          {job.status === 'in_progress' && Array.isArray(job.attempts) && job.attempts.length === 0 && (
            <div
              role="button"
              tabIndex={0}
              aria-label={`Log first attempt for ${job.recipient_name}`}
              onClick={(e) => { e.stopPropagation(); onAttempt(job.id); }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAttempt(job.id); } }}
              className="flex items-center gap-2 px-2 py-1.5 rounded-[2px] border border-dashed border-amber-700/40 bg-amber-900/10 cursor-pointer hover:bg-amber-900/20 transition-colors"
            >
              <ClipboardCheck className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
              <span className="text-[10px] text-amber-400 italic">Log first attempt</span>
            </div>
          )}

          {/* Notes */}
          {job.notes && (
            <div>
              <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: 'var(--panel-header-color)' }}>Notes</span>
              <p className="text-rmpg-300 mt-0.5">{job.notes}</p>
            </div>
          )}

          {onAudit && (
            <button type="button"
              onClick={(e) => { e.stopPropagation(); onAudit(job.id); }}
              className="text-[9px] text-rmpg-400 hover:text-rmpg-200 uppercase tracking-wider font-bold transition-colors"
            >
              Audit Log
            </button>
          )}
        </div>
      )}

      {/* Action buttons row */}
      <div className="flex items-center border-t border-rmpg-700/40 divide-x divide-rmpg-700/40">
        {/* Feature 18: Copy address */}
        {fullAddress && (
          <button type="button"
            onClick={handleCopyAddress}
            className="flex-1 flex items-center justify-center gap-1 py-1.5 text-[10px] font-bold text-rmpg-400 hover:bg-surface-sunken/30 transition-colors duration-150 focus:outline-none focus:ring-1 focus:ring-[color:var(--accent-silver-400)]/50"
            title="Copy address"
            aria-label={`Copy address for ${job.recipient_name}`}
          >
            {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        )}
        {/* Feature 19: Quick call */}
        {job.recipient_phone && (
          <a href={`tel:${job.recipient_phone}`}
            onClick={e => e.stopPropagation()}
            className="flex-1 flex items-center justify-center gap-1 py-1.5 text-[10px] font-bold text-blue-400 hover:bg-blue-900/30 transition-colors duration-150"
            title={`Call ${job.recipient_phone}`}
            aria-label={`Call ${job.recipient_name}`}
          >
            <Phone className="w-3 h-3" />
            Call
          </a>
        )}
        {/* Directions link */}
        <button type="button"
          onClick={(e) => { e.stopPropagation(); window.open(`https://www.openstreetmap.org/directions?to=${encodeURIComponent(fullAddress)}`, '_blank', 'noopener,noreferrer'); }}
          className="flex-1 flex items-center justify-center gap-1 py-1.5 text-[10px] font-bold text-amber-400 hover:bg-amber-900/30 transition-colors duration-150 focus:outline-none focus:ring-1 focus:ring-[color:var(--accent-silver-400)]/50 focus:bg-amber-900/20"
          title="Open in Maps"
          aria-label={`Open Maps to ${job.recipient_name}`}
        >
          <MapPin className="w-3 h-3" />
          Map
        </button>
        <button type="button"
          onClick={(e) => { e.stopPropagation(); onNavigate(job.id); }}
          className="flex-1 flex items-center justify-center gap-1 py-1.5 text-[10px] font-bold text-rmpg-400 hover:bg-surface-sunken/30 transition-colors duration-150 focus:outline-none focus:ring-1 focus:ring-[color:var(--accent-silver-400)]/50 focus:bg-surface-sunken/20"
          title="Navigate"
          aria-label={`Navigate to ${job.recipient_name}`}
        >
          <MapPin className="w-3 h-3" />
          Navigate
        </button>
        <button type="button"
          onClick={(e) => { e.stopPropagation(); onAttempt(job.id); }}
          className="flex-1 flex items-center justify-center gap-1 py-1.5 text-[10px] font-bold text-green-400 hover:bg-green-900/30 transition-colors duration-150 focus:outline-none focus:ring-1 focus:ring-[color:var(--accent-silver-400)]/50 focus:bg-green-900/20"
          title="Attempt Service"
          aria-label={`Attempt service for ${job.recipient_name}`}
        >
          <ClipboardCheck className="w-3 h-3" />
          Attempt
        </button>
        <button type="button"
          onClick={(e) => { e.stopPropagation(); onSkipTrace(job.id); }}
          className="flex-1 flex items-center justify-center gap-1 py-1.5 text-[10px] font-bold text-rmpg-400 hover:bg-surface-sunken/30 transition-colors duration-150 focus:outline-none focus:ring-1 focus:ring-[color:var(--accent-silver-400)]/50 focus:bg-surface-sunken/20"
          title="Skip Trace"
          aria-label={`Skip trace for ${job.recipient_name}`}
        >
          <Search className="w-3 h-3" />
          Skip Trace
        </button>
        {/* Acknowledgement of Service — QR for the subject's phone, or
            blank paper for hand completion. Lives in the action row
            because it is used AT the door, alongside Attempt. */}
        <ServeReceiptActions job={job} compact />
        <button type="button"
          onClick={(e) => { e.stopPropagation(); onFlagAddress(job.id); }}
          className="flex-1 flex items-center justify-center gap-1 py-1.5 text-[10px] font-bold text-amber-400 hover:bg-amber-900/30 transition-colors duration-150 focus:outline-none focus:ring-1 focus:ring-[color:var(--accent-silver-400)]/50 focus:bg-amber-900/20"
          title="Flag Bad Address"
          aria-label={`Flag bad address for ${job.recipient_name}`}
        >
          <AlertTriangle className="w-3 h-3" />
          Flag
        </button>
        <button type="button"
          onClick={(e) => { e.stopPropagation(); onEdit(job.id); }}
          className="flex-1 flex items-center justify-center gap-1 py-1.5 text-[10px] font-bold text-rmpg-400 hover:bg-surface-sunken/30 transition-colors duration-150 focus:outline-none focus:ring-1 focus:ring-[color:var(--accent-silver-400)]/50 focus:bg-surface-sunken/20"
          title="Edit Job"
          aria-label={`Edit job for ${job.recipient_name}`}
        >
          <Pencil className="w-3 h-3" />
          Edit
        </button>
      </div>
    </div>
  );
});

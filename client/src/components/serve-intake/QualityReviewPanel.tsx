import { useState, useEffect, useCallback } from 'react';
import { CheckCircle2, Wrench, AlertTriangle, ChevronDown, ChevronRight, RefreshCw, Loader2, FileWarning } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { useToast } from '../ToastProvider';
import { useAuth } from '../../context/AuthContext';
import { toDisplayLabel } from '../../utils/formatters';

type QualityStatus = 'needs_review' | 'reviewed_ok' | 'reviewed_fixed';

interface ReviewRow {
  id: number;
  recipient_name: string | null;
  recipient_address: string | null;
  case_number: string | null;
  quality_status: QualityStatus;
  judge_run_id: number | null;
  created_at: string;
  deadline: string | null;
  priority: string | null;
  flagged_field_count: number | null;
  judge_raw_response: string | null;
}

interface VerdictMap {
  [field: string]: { ok: boolean; reason: string | null; suggested_value: string | null };
}

const STATUS_TABS: { key: QualityStatus; label: string }[] = [
  { key: 'needs_review', label: 'Needs Review' },
  { key: 'reviewed_ok', label: 'Accepted' },
  { key: 'reviewed_fixed', label: 'Fixed' },
];

const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'text-red-400',
  rush: 'text-orange-400',
  normal: 'text-rmpg-400',
  routine: 'text-rmpg-500',
};

export default function QualityReviewPanel() {
  const { user } = useAuth();
  const { addToast } = useToast();
  const [activeTab, setActiveTab] = useState<QualityStatus>('needs_review');
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [actioning, setActioning] = useState<number | null>(null);
  const [reprocessing, setReprocessing] = useState(false);

  const canReview = user && ['admin', 'manager', 'supervisor'].includes(user.role);

  const load = useCallback(async () => {
    setLoading(true);
    setExpandedId(null);
    try {
      const data = await apiFetch<{ rows: ReviewRow[] }>(
        `/serve-intake/review-queue?quality_status=${activeTab}`
      );
      setRows(data.rows ?? []);
    } catch {
      addToast('Failed to load review queue', 'error');
    } finally {
      setLoading(false);
    }
  }, [activeTab, addToast]);

  useEffect(() => { load(); }, [load]);

  const act = useCallback(async (id: number, action: 'accept' | 'fix') => {
    if (!canReview) return;
    setActioning(id);
    try {
      await apiFetch(`/serve-intake/review-queue/${id}/${action === 'accept' ? 'accept' : 'fix'}`, {
        method: 'POST',
      });
      setRows(prev => prev.filter(r => r.id !== id));
      addToast(action === 'accept' ? 'Marked as reviewed OK' : 'Marked as fixed', 'success');
    } catch {
      addToast('Action failed — try again', 'error');
    } finally {
      setActioning(null);
    }
  }, [canReview, addToast]);

  const reprocessFailed = useCallback(async () => {
    if (!canReview) return;
    setReprocessing(true);
    try {
      const data = await apiFetch<{ recovered: number; failed: number }>(
        '/serve-intake/reprocess-failed?limit=10',
        { method: 'POST' }
      );
      addToast(`Reprocess: ${data.recovered ?? 0} recovered, ${data.failed ?? 0} failed`, 'info');
      if ((data.recovered ?? 0) > 0) load();
    } catch {
      addToast('Reprocess batch failed', 'error');
    } finally {
      setReprocessing(false);
    }
  }, [canReview, addToast, load]);

  const parseVerdicts = (raw: string | null): VerdictMap => {
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      // raw_response may be the full judge response object; verdicts lives inside it
      return (parsed?.verdicts ?? parsed) as VerdictMap;
    } catch {
      return {};
    }
  };

  const flaggedVerdicts = (raw: string | null) =>
    Object.entries(parseVerdicts(raw)).filter(([, v]) => !v.ok);

  return (
    <div className="p-3 space-y-3">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-fg-muted uppercase tracking-wide font-semibold">OCR Quality Review</p>
        <div className="flex items-center gap-1.5">
          {canReview && (
            <button
              onClick={reprocessFailed}
              disabled={reprocessing}
              className="flex items-center gap-1 px-2 py-0.5 text-[10px] border border-surface-border hover:bg-surface-raised disabled:opacity-40"
            >
              {reprocessing ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
              Reprocess Failed
            </button>
          )}
          <button
            onClick={load}
            disabled={loading}
            aria-label="Refresh review queue"
            className="p-0.5 text-rmpg-400 hover:text-rmpg-200 disabled:opacity-40"
          >
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Status filter tabs */}
      <div className="flex gap-0 border-b border-surface-border">
        {STATUS_TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-3 py-[5px] text-[10px] font-semibold uppercase tracking-wide border-b-2 transition-colors -mb-px ${
              activeTab === tab.key
                ? 'border-brand-400 text-brand-300'
                : 'border-transparent text-rmpg-500 hover:text-rmpg-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center gap-1.5 py-6 justify-center text-rmpg-500 text-[11px]">
          <Loader2 size={13} className="animate-spin" /> Loading…
        </div>
      ) : rows.length === 0 ? (
        <div className="py-8 text-center text-[11px] text-rmpg-500">
          {activeTab === 'needs_review' ? 'No items pending review.' : 'None in this bucket.'}
        </div>
      ) : (
        <div className="space-y-1.5">
          {rows.map(row => {
            const flagged = flaggedVerdicts(row.judge_raw_response);
            const isExpanded = expandedId === row.id;
            const isActioning = actioning === row.id;
            const age = Math.floor((Date.now() - new Date(row.created_at).getTime()) / 3_600_000);
            const ageLabel = age < 24 ? `${age}h ago` : `${Math.floor(age / 24)}d ago`;

            return (
              <div
                key={row.id}
                className="border border-surface-border bg-surface-raised"
              >
                {/* Row header — click to expand */}
                <button
                  onClick={() => setExpandedId(isExpanded ? null : row.id)}
                  className="w-full flex items-start gap-2 px-2.5 py-2 text-left hover:bg-surface-hover"
                >
                  <span className="mt-0.5 text-rmpg-500 shrink-0">
                    {isExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[11px] font-semibold text-rmpg-100 truncate">
                        {row.recipient_name ?? '(no name)'}
                      </span>
                      {row.priority && (
                        <span className={`text-[9px] font-semibold uppercase ${PRIORITY_COLORS[row.priority] ?? 'text-rmpg-400'}`}>
                          {row.priority}
                        </span>
                      )}
                      {row.case_number && (
                        <span className="text-[9px] text-rmpg-500 font-mono">{row.case_number}</span>
                      )}
                    </div>
                    <div className="text-[10px] text-rmpg-400 truncate mt-0.5">
                      {row.recipient_address ?? '—'}
                    </div>
                  </div>
                  <div className="shrink-0 flex flex-col items-end gap-0.5">
                    {(row.flagged_field_count ?? 0) > 0 && (
                      <div className="flex items-center gap-0.5 text-[9px] text-amber-400">
                        <AlertTriangle size={9} />
                        {row.flagged_field_count} flag{row.flagged_field_count !== 1 ? 's' : ''}
                      </div>
                    )}
                    <span className="text-[9px] text-rmpg-500">{ageLabel}</span>
                  </div>
                </button>

                {/* Expanded: judge flags + actions */}
                {isExpanded && (
                  <div className="border-t border-surface-border px-3 py-2 space-y-2">
                    {flagged.length > 0 ? (
                      <div className="space-y-1">
                        <p className="text-[9px] text-rmpg-500 uppercase tracking-wide font-semibold">Judge Flags</p>
                        {flagged.map(([field, v]) => (
                          <div key={field} className="flex items-start gap-1.5 text-[10px] bg-amber-900/20 border border-amber-700/40 px-1.5 py-1">
                            <AlertTriangle className="w-3 h-3 mt-px text-amber-400 shrink-0" />
                            <div>
                              <span className="font-semibold text-amber-300">{toDisplayLabel(field)}</span>
                              {v.reason && <span className="text-rmpg-400"> — {v.reason}</span>}
                              {v.suggested_value && (
                                <div className="text-amber-200/70 mt-0.5">Suggested: <span className="font-mono">{v.suggested_value}</span></div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[10px] text-rmpg-500">No field-level flags recorded.</p>
                    )}

                    {/* Actions — only for needs_review and eligible roles */}
                    {activeTab === 'needs_review' && canReview && (
                      <div className="flex gap-1.5 pt-1">
                        <button
                          onClick={() => act(row.id, 'accept')}
                          disabled={isActioning}
                          className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-semibold bg-green-900/40 border border-green-700/50 text-green-300 hover:bg-green-900/60 disabled:opacity-40"
                        >
                          {isActioning ? <Loader2 size={10} className="animate-spin" /> : <CheckCircle2 size={10} />}
                          Accept
                        </button>
                        <button
                          onClick={() => act(row.id, 'fix')}
                          disabled={isActioning}
                          className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-semibold bg-blue-900/40 border border-blue-700/50 text-blue-300 hover:bg-blue-900/60 disabled:opacity-40"
                        >
                          {isActioning ? <Loader2 size={10} className="animate-spin" /> : <Wrench size={10} />}
                          Mark Fixed
                        </button>
                        <a
                          href={`/serve?id=${row.id}`}
                          className="flex items-center gap-1 px-2.5 py-1 text-[10px] border border-surface-border text-rmpg-400 hover:text-rmpg-200 hover:bg-surface-raised"
                        >
                          <FileWarning size={10} /> Open Job
                        </a>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

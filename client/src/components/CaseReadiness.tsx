// Case readiness / completeness card (v3 Phase 1). Renders GET
// /cases/:id/completeness — a required-element checklist + percent.
import { useState, useEffect } from 'react';
import { Loader2, CheckCircle, Circle, AlertTriangle } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';

export interface CompletenessResult {
  percent: number;
  requiredTotal: number;
  requiredMet: number;
  items: { key: string; label: string; required: boolean; met: boolean }[];
  missing: string[];
}

/** Shared fetch — also used by the page's advisory submit/close gate. */
export function fetchCaseCompleteness(caseId: number | string): Promise<CompletenessResult | null> {
  return apiFetch<CompletenessResult>(`/cases/${caseId}/completeness`).then((r) => r as any).catch(() => null);
}

export function CaseReadinessCard({ caseId, refreshKey }: { caseId: number | string; refreshKey?: unknown }) {
  const [data, setData] = useState<CompletenessResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchCaseCompleteness(caseId)
      .then((d) => { if (!cancelled) setData(d); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [caseId, refreshKey]);

  if (loading) return <div className="panel-beveled p-3 flex items-center gap-2 text-[10px] text-rmpg-500"><Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> Evaluating readiness...</div>;
  if (!data) return null;

  const color = data.percent >= 100 ? '#22c55e' : data.percent >= 60 ? '#d4a017' : '#ef4444';

  return (
    <div className="panel-beveled p-4">
      <div className="text-[10px] font-mono text-rmpg-500 uppercase mb-3">Case Readiness</div>
      <div className="flex items-center gap-4">
        <div className="relative w-16 h-16 flex-shrink-0">
          <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
            <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#141414" strokeWidth="3" />
            <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke={color} strokeWidth="3" strokeDasharray={`${data.percent}, 100`} strokeLinecap="round" />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-sm font-bold" style={{ color }}>{data.percent}%</span>
          </div>
        </div>
        <div className="flex-1 min-w-0 space-y-0.5">
          {data.items.map((it) => (
            <div key={it.key} className="flex items-center gap-1.5 text-[10px]">
              {it.met
                ? <CheckCircle className="w-3 h-3 text-green-400 flex-shrink-0" />
                : it.required
                  ? <AlertTriangle className="w-3 h-3 text-red-400 flex-shrink-0" />
                  : <Circle className="w-3 h-3 text-rmpg-600 flex-shrink-0" />}
              <span className={it.met ? 'text-rmpg-300' : it.required ? 'text-red-300' : 'text-rmpg-500'}>
                {it.label}{!it.required && <span className="text-rmpg-600"> (optional)</span>}
              </span>
            </div>
          ))}
        </div>
      </div>
      {data.missing.length > 0 && (
        <div className="mt-3 text-[9px] text-red-400/90 border-t border-rmpg-800 pt-2">
          Required before close: {data.missing.join(', ')}
        </div>
      )}
    </div>
  );
}

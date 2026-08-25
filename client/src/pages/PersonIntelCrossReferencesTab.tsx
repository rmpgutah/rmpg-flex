// client/src/pages/PersonIntelCrossReferencesTab.tsx
// Cross-reference capture & verification tab for the Person Intel dossier.
// Integrates CourtListener/juriscraper, FBI Wanted, criminal-DB, skip-trace,
// and centralia opinion cross-refs with officer verification.
import { useState, useEffect, useCallback } from 'react';
import {
  Loader2, AlertTriangle, CheckCircle2, XCircle, HelpCircle, RefreshCw,
  Gavel, ShieldAlert, Search, FileDown, ExternalLink, Scale,
} from 'lucide-react';
import { apiFetch, apiFetchBlob } from '../hooks/useApi';
import { useToast } from '../components/ToastProvider';
import { toDisplayLabel } from '../utils/formatters';

interface CrossRef {
  id: number;
  source: string;
  externalRef: string;
  externalUrl?: string;
  label: string;
  matchedFields: { field: string; value: string }[];
  confidence: number;
  isCriminal: boolean;
  riskFlags: string[];
  effectiveConfidence: number;
  verifications: {
    id: number;
    method: string;
    result: string;
    evidence: string;
    adjustedConfidence: number;
    notes?: string;
    verifiedAt?: string;
  }[];
}

const SOURCE_ICON: Record<string, React.ElementType> = {
  COURTLISTENER: Scale,
  FBI_WANTED: ShieldAlert,
  CRIMINAL_DB: Gavel,
  SKIP_TRACE: Search,
  INTERNAL: Gavel,
};

function confColor(c: number): string {
  if (c >= 0.80) return 'text-green-400';
  if (c >= 0.55) return 'text-blue-400';
  if (c >= 0.40) return 'text-amber-400';
  return 'text-fg-muted';
}

function resultBadge(r: string) {
  if (r === 'confirmed') return <span className="text-[10px] text-green-400 border border-green-400/30 rounded px-1 inline-flex items-center gap-0.5"><CheckCircle2 className="w-2.5 h-2.5" />CONFIRMED</span>;
  if (r === 'rejected') return <span className="text-[10px] text-red-400 border border-red-400/30 rounded px-1 inline-flex items-center gap-0.5"><XCircle className="w-2.5 h-2.5" />REJECTED</span>;
  return <span className="text-[10px] text-amber-400 border border-amber-400/30 rounded px-1 inline-flex items-center gap-0.5"><HelpCircle className="w-2.5 h-2.5" />INCONCLUSIVE</span>;
}

const METHODS = ['dob', 'address', 'phone', 'email', 'identifier', 'officer_review'] as const;

export default function PersonIntelCrossReferencesTab({ dossierId }: { dossierId: number }) {
  const { addToast } = useToast();
  const [xrefs, setXrefs] = useState<CrossRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [verifyBusy, setVerifyBusy] = useState<number | null>(null);
  const [draft, setDraft] = useState<{ method: string; evidence: string }>({ method: 'dob', evidence: '' });

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<CrossRef[]>(`/person-intel/${dossierId}/cross-refs`);
      setXrefs(data);
    } catch (e: any) {
      // 404 / not-found surfaces quietly until the legal phase has run.
      setXrefs([]);
    } finally {
      setLoading(false);
    }
  }, [dossierId]);

  useEffect(() => { load(); }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await apiFetch(`/person-intel/${dossierId}/cross-refs/refresh`, { method: 'POST' });
      addToast('Cross-references refreshed', 'success');
      await load();
    } catch (e: any) {
      addToast(e?.message ?? 'Refresh failed', 'error');
    } finally {
      setRefreshing(false);
    }
  };

  const verify = async (xrefId: number) => {
    if (!draft.evidence.trim() && draft.method !== 'officer_review') {
      addToast('Enter evidence to verify against', 'error');
      return;
    }
    setVerifyBusy(xrefId);
    try {
      const res = await apiFetch<{ result: string; adjustedConfidence: number; reason: string }>(
        `/person-intel/${dossierId}/cross-refs/${xrefId}/verify`,
        { method: 'POST', body: JSON.stringify({ method: draft.method, evidence: draft.evidence }) },
      );
      addToast(`${res.result} — ${res.reason}`, res.result === 'confirmed' ? 'success' : res.result === 'rejected' ? 'error' : 'info');
      setDraft({ method: 'dob', evidence: '' });
      await load();
    } catch (e: any) {
      addToast(e?.message ?? 'Verification failed', 'error');
    } finally {
      setVerifyBusy(null);
    }
  };

  const downloadReport = async (format: 'pdf' | 'csv') => {
    try {
      const blob = await apiFetchBlob(`/person-intel/${dossierId}/report?format=${format}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `intel-${dossierId}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      addToast(e?.message ?? 'Report download failed', 'error');
    }
  };

  if (loading) return (
    <div className="flex items-center gap-2 text-fg-secondary text-xs py-8 justify-center">
      <Loader2 className="w-4 h-4 animate-spin" />Loading cross-references…
    </div>
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button
          onClick={refresh}
          disabled={refreshing}
          className="text-xs px-2 py-1 rounded bg-surface-raised text-rmpg-100 hover:bg-surface-overlay disabled:opacity-50 flex items-center gap-1"
        >
          {refreshing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          Refresh cross-refs
        </button>
        <button onClick={() => downloadReport('pdf')} className="text-xs px-2 py-1 rounded bg-surface-raised text-rmpg-100 hover:bg-surface-overlay flex items-center gap-1">
          <FileDown className="w-3 h-3" />PDF
        </button>
        <button onClick={() => downloadReport('csv')} className="text-xs px-2 py-1 rounded bg-surface-raised text-rmpg-100 hover:bg-surface-overlay flex items-center gap-1">
          <FileDown className="w-3 h-3" />CSV
        </button>
      </div>

      {xrefs.length === 0 ? (
        <div className="text-center py-8 text-fg-muted text-xs">
          <Search className="w-5 h-5 mx-auto mb-2 text-rmpg-700" />
          No cross-references captured yet. Click <span className="text-brand-400">Refresh</span> to run the
          CourtListener / FBI Wanted / criminal-DB / skip-trace fan-out.
        </div>
      ) : xrefs.map(xr => {
        const Icon = SOURCE_ICON[xr.source] ?? Gavel;
        return (
          <div key={xr.id} className="bg-surface-raised rounded p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Icon className="w-3.5 h-3.5 text-brand-400" />
              <span className="text-[10px] text-fg-muted uppercase tracking-wide">{toDisplayLabel(xr.source)}</span>
              {xr.isCriminal && (
                <span className="text-[10px] text-red-400 border border-red-600/40 rounded px-1">CRIMINAL</span>
              )}
              {xr.riskFlags.map(f => (
                <span key={f} className="text-[10px] bg-red-600/15 text-red-400 border border-red-600/30 rounded px-1">
                  {toDisplayLabel(f).toUpperCase()}
                </span>
              ))}
              <span className="ml-auto text-[10px] text-fg-muted">
                conf <span className={confColor(xr.confidence)}>{(xr.confidence * 100).toFixed(0)}%</span>
                {' → '}
                <span className={confColor(xr.effectiveConfidence)}>{(xr.effectiveConfidence * 100).toFixed(0)}%</span>
              </span>
            </div>
            <div className="text-xs text-rmpg-100 font-medium">{xr.label}</div>
            <div className="text-[10px] text-fg-muted">
              {xr.externalRef}
              {xr.externalUrl && (
                <a href={xr.externalUrl} target="_blank" rel="noreferrer" className="ml-2 text-brand-400 inline-flex items-center gap-0.5 hover:underline">
                  source <ExternalLink className="w-2.5 h-2.5" />
                </a>
              )}
              {' · matched: '}
              {xr.matchedFields.map(m => `${m.field}=${m.value}`).join(', ') || 'name'}
            </div>

            {xr.verifications.length > 0 && (
              <div className="border-t border-rmpg-800 pt-1 space-y-0.5">
                {xr.verifications.map(v => (
                  <div key={v.id} className="text-[10px] text-fg-muted flex items-center gap-2">
                    {resultBadge(v.result)}
                    <span className="uppercase">{toDisplayLabel(v.method)}</span>
                    <span className="truncate">“{v.evidence}”</span>
                    <span className={confColor(v.adjustedConfidence)}>{(v.adjustedConfidence * 100).toFixed(0)}%</span>
                  </div>
                ))}
              </div>
            )}

            {/* Inline verify form */}
            <div className="flex items-center gap-1.5 pt-1 border-t border-rmpg-800/50">
              <select
                value={draft.method}
                onChange={e => setDraft(d => ({ ...d, method: e.target.value }))}
                className="text-[10px] bg-surface-sunken text-rmpg-100 rounded px-1 py-0.5 border border-rmpg-800"
              >
                {METHODS.map(m => <option key={m} value={m}>{toDisplayLabel(m)}</option>)}
              </select>
              <input
                value={draft.evidence}
                onChange={e => setDraft(d => ({ ...d, evidence: e.target.value }))}
                placeholder={draft.method === 'officer_review' ? 'documented review…' : 'value to verify against…'}
                className="flex-1 text-[10px] bg-surface-sunken text-rmpg-100 rounded px-1.5 py-0.5 border border-rmpg-800 placeholder:text-rmpg-700"
              />
              <button
                onClick={() => verify(xr.id)}
                disabled={verifyBusy === xr.id}
                className="text-[10px] px-2 py-0.5 rounded bg-brand-500/20 text-brand-400 hover:bg-brand-500/30 disabled:opacity-50 flex items-center gap-1"
              >
                {verifyBusy === xr.id ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <CheckCircle2 className="w-2.5 h-2.5" />}
                Verify
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

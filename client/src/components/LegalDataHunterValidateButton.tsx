// ============================================================
// RMPG Flex — "Validate Charge" button (Legal Data Hunter)
// ------------------------------------------------------------
// Manual, officer-initiated charge validation. Embedded on
// WarrantsPage's warrant-detail "Offense / Charges" block. Calls
// POST /api/legal-data-hunter/validate on click; no background
// polling, no auto-trigger. Result renders inline and is cached
// server-side, so repeat clicks on the same charge are free.
// ============================================================

import { useState } from 'react';
import { Scale, Loader2, CheckCircle2, AlertTriangle, Info } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';

interface ValidateResponse {
  ok: boolean;
  code?: 'not_configured' | 'rate_limited' | 'bad_request' | 'upstream_error';
  reason?: 'daily_limit' | 'minute_limit';
  source?: string;
  match_found?: boolean;
  matched_title?: string | null;
  matched_citation?: string | null;
  matched_source_url?: string | null;
}

interface Props {
  charge: string;
  state?: string;
  warrantId?: number;
}

export default function LegalDataHunterValidateButton({ charge, state, warrantId }: Props) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ValidateResponse | null>(null);

  async function handleValidate() {
    if (!charge.trim() || loading) return;
    setLoading(true);
    setResult(null);
    try {
      const r = await apiFetch<ValidateResponse>('/legal-data-hunter/validate', {
        method: 'POST',
        body: JSON.stringify({ charge, state, warrant_id: warrantId }),
      });
      setResult(r);
    } catch (err) {
      console.warn('[legal-data-hunter] validate failed:', err);
      setResult({ ok: false, code: 'upstream_error' });
    } finally {
      setLoading(false);
    }
  }

  if (!charge.trim()) return null;

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={handleValidate}
        disabled={loading}
        className="inline-flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded-sm border border-rmpg-600/50 bg-surface-overlay hover:bg-surface-raised text-rmpg-200 disabled:opacity-50"
      >
        {loading ? <Loader2 size={11} className="animate-spin" /> : <Scale size={11} />}
        Validate Charge
      </button>

      {result && !loading && (
        <div className="mt-1.5 text-[10px]">
          {result.ok && result.match_found && (
            <div className="flex items-start gap-1.5 text-green-400">
              <CheckCircle2 size={12} className="mt-0.5 shrink-0" />
              <span>
                Matched: <strong>{result.matched_title}</strong>
                {result.matched_citation ? ` (${result.matched_citation})` : ''}
                {result.matched_source_url && (
                  <>
                    {' — '}
                    <a href={result.matched_source_url} target="_blank" rel="noreferrer" className="underline">
                      source
                    </a>
                  </>
                )}
              </span>
            </div>
          )}
          {result.ok && !result.match_found && (
            <div className="flex items-center gap-1.5 text-amber-400">
              <AlertTriangle size={12} className="shrink-0" />
              <span>No matching statute/citation found.</span>
            </div>
          )}
          {!result.ok && result.code === 'rate_limited' && (
            <div className="flex items-center gap-1.5 text-amber-400">
              <Info size={12} className="shrink-0" />
              <span>Lookup limit reached — try again {result.reason === 'daily_limit' ? 'tomorrow' : 'in a minute'}.</span>
            </div>
          )}
          {!result.ok && result.code === 'not_configured' && (
            <div className="flex items-center gap-1.5 text-rmpg-400">
              <Info size={12} className="shrink-0" />
              <span>Legal Data Hunter is not configured.</span>
            </div>
          )}
          {!result.ok && (result.code === 'upstream_error' || result.code === 'bad_request') && (
            <div className="flex items-center gap-1.5 text-red-400">
              <AlertTriangle size={12} className="shrink-0" />
              <span>Validation failed — try again later.</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

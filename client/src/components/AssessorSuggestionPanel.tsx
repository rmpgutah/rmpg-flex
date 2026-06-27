// client/src/components/AssessorSuggestionPanel.tsx
// Day/night-themed parcel-picker panel. Renders 0 / 1 / N states from
// useAssessorLookup, plus error and fallback-chain transparency. Tokens-only
// — no hex (CLAUDE.md theme rule).

import { useEffect, useState } from 'react';
import type { LookupCode, LookupSource, ParcelSummary } from '../hooks/useAssessorLookup';

interface Props {
  parcels: ParcelSummary[] | null;
  cached?: boolean;
  loading?: boolean;
  /** New optional fallback-chain props. Older callers that don't pass these
   *  get the legacy (loading | results | nothing) behavior — no breakage. */
  error?: string | null;
  code?: LookupCode | null;
  source?: LookupSource | null;
  degraded?: boolean;
  manualUrl?: string | null;
  onApply: (parcelNumber: string) => void;
  onDismiss: () => void;
  onRetry?: () => void;
  onRefresh?: () => void;
}

function fmtMoney(n: number | null): string {
  if (n == null) return '—';
  return `$${n.toLocaleString()}`;
}
function fmtSqft(n: number | null): string {
  return n == null ? '—' : `${n.toLocaleString()} sqft`;
}

function sourceLabel(source: LookupSource | null | undefined): string | null {
  switch (source) {
    case 'firecrawl': return null;          // primary path; don't mention
    case 'direct':    return null;          // also a fresh fetch
    case 'cache':     return null;          // fresh cache, no degradation
    case 'ai':        return 'AI-extracted (review carefully)';
    case 'stale_cache': return 'showing last-known data — live source unavailable';
    default: return null;
  }
}

function codeMessage(code: LookupCode | null | undefined, error?: string | null): string {
  if (error) return error;
  switch (code) {
    case 'not_configured':
      return 'Assessor lookup is not configured (no scraper key set).';
    case 'no_match':
      return 'No matching parcels on the Salt Lake County Assessor.';
    case 'upstream_error':
      return 'Could not reach the Assessor. Try again or search manually.';
    case 'timeout':
      return 'Assessor lookup timed out. Try again or search manually.';
    default:
      return 'Assessor lookup did not return any results.';
  }
}

export function AssessorSuggestionPanel({
  parcels, cached, loading, error, code, source, degraded, manualUrl,
  onApply, onDismiss, onRetry, onRefresh,
}: Props) {
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => {
    if (parcels && parcels.length === 1) setPicked(parcels[0].parcel_number);
    else setPicked(null);
  }, [parcels]);

  if (loading) {
    return (
      <div className="mt-1 p-2 border border-surface-raised bg-surface-base text-xs text-rmpg-400">
        Looking up Salt Lake County Assessor…
      </div>
    );
  }

  // Hide entirely when the caller hasn't initiated a lookup at all OR when an
  // older caller only passes parcels=[] without the new code/error props. The
  // new code/error props are what opt a caller into the no-match panel.
  if ((parcels === null || parcels.length === 0) && !error && !code) return null;

  // ── No-result / error state ───────────────────────────────────────────
  if (!parcels || parcels.length === 0) {
    const isError = !!error || code === 'upstream_error' || code === 'timeout' || code === 'not_configured';
    return (
      <div className="mt-1 p-2 border border-surface-raised bg-surface-base text-xs">
        <div className={`mb-1 font-semibold ${isError ? 'text-red-400' : 'text-rmpg-300'}`}>
          🏠 Salt Lake County Assessor
        </div>
        <div className="text-rmpg-400 mb-2">
          {codeMessage(code, error)}
        </div>
        <div className="flex items-center gap-2">
          {onRetry && isError && (
            <button
              type="button"
              onClick={onRetry}
              className="px-2 py-1 bg-surface-raised text-rmpg-200 hover:bg-surface-base border border-surface-raised">
              Retry
            </button>
          )}
          {manualUrl && (
            <a
              href={manualUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-2 py-1 bg-brand-500 text-rmpg-900 hover:opacity-90">
              Search SLCo manually ↗
            </a>
          )}
          <button
            type="button"
            onClick={onDismiss}
            className="px-2 py-1 bg-surface-raised text-rmpg-300 ml-auto">
            Dismiss
          </button>
        </div>
      </div>
    );
  }

  // ── Picker (1 or more matches) ────────────────────────────────────────
  const note = sourceLabel(source);
  return (
    <div className="mt-1 p-2 border border-surface-raised bg-surface-base text-xs">
      <div className="font-semibold text-brand-400 mb-1">
        🏠 Salt Lake County Assessor — {parcels.length} parcel{parcels.length === 1 ? '' : 's'} match
      </div>
      {degraded && note && (
        <div className="mb-1 text-rmpg-500 italic">⚠ {note}</div>
      )}
      <div className="space-y-1">
        {parcels.map((p) => (
          <label key={p.parcel_number}
            className="flex items-start gap-2 cursor-pointer p-1 hover:bg-surface-raised">
            <input
              type="radio"
              name="assessor-parcel"
              value={p.parcel_number}
              checked={picked === p.parcel_number}
              onChange={() => setPicked(p.parcel_number)}
              className="mt-[2px]"
            />
            <div className="flex-1">
              <div className="font-mono">{p.parcel_number}  <span className="font-sans text-rmpg-200">{p.owner_of_record ?? '—'}</span></div>
              <div className="text-rmpg-400">
                {p.situs_address ?? '—'} · {fmtSqft(p.land_sqft)} · {fmtMoney(p.total_market_value)}
              </div>
            </div>
          </label>
        ))}
      </div>
      <div className="flex justify-between items-center mt-2">
        <div className="flex gap-2">
          <button
            type="button"
            disabled={!picked}
            onClick={() => picked && onApply(picked)}
            className="px-2 py-1 bg-brand-500 text-rmpg-900 disabled:opacity-50">
            Apply
          </button>
          <button type="button" onClick={onDismiss}
            className="px-2 py-1 bg-surface-raised text-rmpg-300">
            Dismiss
          </button>
          {manualUrl && (
            <a
              href={manualUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-2 py-1 text-rmpg-400 hover:text-rmpg-200 underline">
              search SLCo ↗
            </a>
          )}
        </div>
        {cached && (
          <div className="flex items-center gap-2">
            {onRefresh && (
              <button
                type="button"
                onClick={onRefresh}
                className="text-rmpg-400 hover:text-rmpg-200 underline text-[10px]">
                Refresh ↺
              </button>
            )}
            <div className="text-rmpg-500">cached</div>
          </div>
        )}
      </div>
    </div>
  );
}

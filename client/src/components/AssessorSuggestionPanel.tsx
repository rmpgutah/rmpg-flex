// client/src/components/AssessorSuggestionPanel.tsx
// Day/night-themed parcel-picker panel. Renders 0 / 1 / N states from
// useAssessorLookup. Tokens-only — no hex (CLAUDE.md theme rule).

import { useEffect, useState } from 'react';
import type { ParcelSummary } from '../hooks/useAssessorLookup';

interface Props {
  parcels: ParcelSummary[] | null;
  cached?: boolean;
  loading?: boolean;
  onApply: (parcelNumber: string) => void;
  onDismiss: () => void;
}

function fmtMoney(n: number | null): string {
  if (n == null) return '—';
  return `$${n.toLocaleString()}`;
}
function fmtSqft(n: number | null): string {
  return n == null ? '—' : `${n.toLocaleString()} sqft`;
}

export function AssessorSuggestionPanel({ parcels, cached, loading, onApply, onDismiss }: Props) {
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
  if (!parcels || parcels.length === 0) return null;
  return (
    <div className="mt-1 p-2 border border-surface-raised bg-surface-base text-xs">
      <div className="font-semibold text-brand-400 mb-1">
        🏠 Salt Lake County Assessor — {parcels.length} parcel{parcels.length === 1 ? '' : 's'} match
      </div>
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
        </div>
        {cached && <div className="text-rmpg-500">cached</div>}
      </div>
    </div>
  );
}

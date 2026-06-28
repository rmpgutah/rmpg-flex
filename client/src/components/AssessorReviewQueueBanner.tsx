// client/src/components/AssessorReviewQueueBanner.tsx
//
// Banner that surfaces ambiguous Salt Lake County Assessor backfill jobs
// (multiple parcel matches → needs a human to pick). Each row expands inline
// into the shared AssessorSuggestionPanel; applying the picked parcel POSTs
// to /assessor/apply and refreshes the queue so the just-resolved row drops
// out. Renders nothing when the queue is empty.

import { useCallback, useEffect, useState } from 'react';
import { Home } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { AssessorSuggestionPanel } from './AssessorSuggestionPanel';
import type { ParcelSummary } from '../hooks/useAssessorLookup';

interface Row {
  id: number;
  record_type: 'business' | 'property';
  record_id: number;
  record_label: string;
  matches: ParcelSummary[];
}

export function AssessorReviewQueueBanner() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch<{ rows: Row[] }>('/assessor/review-queue');
      setRows(r.rows);
    } catch {
      // Treat error as "no queue" rather than blocking the records page.
      setRows([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (!rows || rows.length === 0) return null;

  return (
    <div className="border border-surface-raised bg-surface-base p-2 mb-2">
      <div className="font-semibold text-brand-400 text-xs mb-1 flex items-center gap-1">
        <Home className="w-3 h-3" />
        {rows.length} record{rows.length === 1 ? '' : 's'} need parcel review
      </div>
      <div className="space-y-1">
        {rows.map((r) => (
          <div key={r.id} className="text-xs">
            <button
              type="button"
              onClick={() => setExpanded((x) => (x === r.id ? null : r.id))}
              className="text-rmpg-200 hover:text-brand-400 text-left w-full"
            >
              {r.record_label} · {r.matches.length} parcels → Pick parcel
            </button>
            {expanded === r.id && (
              <AssessorSuggestionPanel
                parcels={r.matches}
                onApply={async (parcelNumber) => {
                  try {
                    await apiFetch('/assessor/apply', {
                      method: 'POST',
                      body: JSON.stringify({
                        record_type: r.record_type,
                        record_id: r.record_id,
                        parcel_number: parcelNumber,
                      }),
                    });
                  } catch (err) {
                    alert(`Apply failed: ${err instanceof Error ? err.message : String(err)}`);
                    return;
                  }
                  setExpanded(null);
                  await load();
                }}
                onDismiss={() => setExpanded(null)}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

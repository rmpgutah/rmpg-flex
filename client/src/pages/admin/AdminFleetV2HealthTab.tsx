import { useEffect, useState } from 'react';
import { apiFetch } from '../../hooks/useApi';

/** Stub for PR 7'a. PR 7'b adds: per-route view counts, recent FLEET_V2_API_ERROR
 *  events table, viewport-width histogram. Removed in PR 7'd post-soak. */
export function AdminFleetV2HealthTab() {
  const [viewCount, setViewCount] = useState<number | null>(null);
  const [errorCount, setErrorCount] = useState<number | null>(null);

  useEffect(() => {
    // Best-effort counts. The /api/audit/count endpoint may not exist in 7'a
    // (added in 7'b alongside richer Fleet V2 health metrics). Gracefully
    // show "—" if absent.
    apiFetch<{ count: number }>('/audit/count?action=FLEET_V2_VIEW&since=24h')
      .then((r) => setViewCount(r?.count ?? null))
      .catch(() => setViewCount(null));
    apiFetch<{ count: number }>('/audit/count?action=FLEET_V2_API_ERROR&since=24h')
      .then((r) => setErrorCount(r?.count ?? null))
      .catch(() => setErrorCount(null));
  }, []);

  return (
    <div className="p-4 space-y-3">
      <h2 className="text-base font-semibold text-rmpg-100">Fleet V2 — Soak Health</h2>
      <p className="text-xs text-rmpg-400 max-w-prose">
        Tracks usage of the new /fleet/v2 UI during the soak before cutover.
        Stub in PR 7'a; richer breakdown in PR 7'b.
      </p>
      <div className="grid grid-cols-2 gap-3 max-w-md">
        <Cell label="Page views (24h)" value={viewCount} />
        <Cell label="API errors (24h)" value={errorCount} />
      </div>
    </div>
  );
}

function Cell({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-sm border border-rmpg-700 bg-surface-raised p-3">
      <div className="text-[9px] uppercase tracking-wide text-rmpg-400">{label}</div>
      <div className="text-lg font-semibold text-rmpg-100 mt-1">{value ?? '—'}</div>
    </div>
  );
}

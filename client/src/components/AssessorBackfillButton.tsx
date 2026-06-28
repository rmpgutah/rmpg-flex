// client/src/components/AssessorBackfillButton.tsx
//
// Admin/manager-only toolbar button that kicks off the Salt Lake County
// Assessor backfill (enqueues every business/property that has an address but
// no parcel_number). Polls /assessor/backfill/status every 5 s while mounted
// to surface live progress next to the button. Renders nothing for
// non-privileged roles.

import { useEffect, useState } from 'react';
import { Home, RefreshCw } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';

interface Status {
  pending: number;
  applied: number;
  ambiguous: number;
  no_match: number;
  error: number;
  unfetchable: number;
  total: number;
}

interface Props {
  isAdminOrManager: boolean;
}

export function AssessorBackfillButton({ isAdminOrManager }: Props) {
  const [status, setStatus] = useState<Status | null>(null);
  const [queuing, setQueuing] = useState(false);

  useEffect(() => {
    if (!isAdminOrManager) return;
    let live = true;
    const tick = async () => {
      try {
        const s = await apiFetch<Status>('/assessor/backfill/status');
        if (live) setStatus(s);
      } catch {
        /* ignore — silent during polling */
      }
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => { live = false; clearInterval(id); };
  }, [isAdminOrManager]);

  if (!isAdminOrManager) return null;

  async function runBackfill() {
    setQueuing(true);
    try {
      const r = await apiFetch<{ queued: number; total_target: number }>(
        '/assessor/backfill',
        { method: 'POST', body: JSON.stringify({}) },
      );
      // alert() keeps the operator on the page and surfaces the outcome
      // without requiring a toast container; this is an admin action.
      alert(`Queued ${r.queued} records (${r.total_target} eligible). Backfill runs in background.`);
    } catch (err) {
      alert(`Backfill failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setQueuing(false);
    }
  }

  const done = status
    ? status.applied + status.no_match + status.error + status.unfetchable
    : 0;

  return (
    <>
      <button
        type="button"
        disabled={queuing}
        onClick={runBackfill}
        className="toolbar-btn print:hidden"
        title="Backfill parcel data from Salt Lake County Assessor"
      >
        <Home className="w-3.5 h-3.5" />
        Backfill Assessor
        <RefreshCw className={`w-3 h-3 ${queuing ? 'animate-spin' : ''}`} />
      </button>
      {status && status.total > 0 && (
        <span className="text-[10px] text-rmpg-400 font-mono whitespace-nowrap">
          {done}/{status.total} done
          {status.ambiguous > 0 && <> · {status.ambiguous} need review</>}
        </span>
      )}
    </>
  );
}

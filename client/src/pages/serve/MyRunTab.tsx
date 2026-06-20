// client/src/pages/serve/MyRunTab.tsx
import { useEffect, useState } from 'react';
import { apiFetch } from '../../hooks/useApi';

interface RunJob { id: number; defendant_name?: string; recipient_name?: string; recipient_address?: string; deadline: string | null; priority: string; status: string; attempt_count?: number; }

export default function MyRunTab({ officerId }: { officerId: number }) {
  const [jobs, setJobs] = useState<RunJob[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    apiFetch<RunJob[]>(`/process-server/priority-queue?officer_id=${officerId}`)
      .then((r) => { if (alive) setJobs(r ?? []); })
      .catch(() => { if (alive) setJobs([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [officerId]);

  const open = jobs.filter((j) => !['served', 'cancelled', 'failed'].includes(j.status));
  return (
    <div className="p-4 space-y-2">
      <div className="text-[9px] font-semibold text-[#888] uppercase">My Run — {open.length} stop{open.length === 1 ? '' : 's'}</div>
      {loading ? <div className="text-[11px] text-[#888]">Loading…</div> : open.map((j, i) => (
        <div key={j.id} className="flex items-center gap-3 border border-border-default bg-surface-sunken px-3 py-2 text-[11px]">
          <span className="text-[#d4a017] font-mono">{i + 1}</span>
          <div className="flex-1">
            <div className="text-rmpg-300">{j.defendant_name ?? j.recipient_name ?? `Job ${j.id}`} <span className="text-rmpg-500">{(j.priority || '').charAt(0).toUpperCase() + (j.priority || '').slice(1)}</span></div>
            <div className="text-[#888] text-[10px]">{j.recipient_address ?? '—'} · due {j.deadline ?? '—'} · attempts {j.attempt_count ?? 0}</div>
          </div>
          {j.recipient_address && (
            <a className="text-[#d4a017]" href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(j.recipient_address)}`} target="_blank" rel="noreferrer">Navigate</a>
          )}
        </div>
      ))}
      {!loading && open.length === 0 && <div className="text-[11px] text-[#888]">Nothing assigned to you right now.</div>}
    </div>
  );
}

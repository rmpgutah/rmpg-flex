// client/src/pages/admin/SyncStatusTab.tsx
import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../../hooks/useApi';
import { useApiBase } from '../../hooks/useApiBase';
import PanelTitleBar from '../../components/PanelTitleBar';
import { Server as ServerIcon } from 'lucide-react';

interface QueueCounts {
  pending: number;
  failed: number;
  delivered: number;
}

interface ConflictRow {
  id: number;
  table_name: string;
  record_id: number;
  fz55_updated_at: string;
  cloud_updated_at: string;
  winning_source: 'fz55' | 'cloudflare';
  resolved_at: string;
}

export default function SyncStatusTab() {
  const { mode, localBase } = useApiBase();
  const [queue, setQueue] = useState<QueueCounts | null>(null);
  const [conflicts, setConflicts] = useState<ConflictRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [q, c] = await Promise.all([
        apiFetch<QueueCounts>('/api/sync/queue'),
        apiFetch<{ conflicts: ConflictRow[] }>('/api/sync/conflicts?limit=50'),
      ]);
      setQueue(q);
      setConflicts(Array.isArray(c?.conflicts) ? c.conflicts : []);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to load sync status';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const triggerReplay = async () => {
    setReplaying(true);
    try {
      await apiFetch('/api/sync/replay', { method: 'POST' });
      await load();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Replay failed';
      setError(msg);
    } finally {
      setReplaying(false);
    }
  };

  return (
    <div className="space-y-4 p-4">
      <PanelTitleBar title="SYNC STATUS" icon={ServerIcon} />

      <div className="flex items-center gap-3 text-xs text-fg-muted">
        <span>Active endpoint:</span>
        <span className={mode === 'local' ? 'text-green-400 font-semibold' : 'text-fg-secondary'}>
          {mode === 'local' ? `LOCAL (${localBase})` : 'CLOUD (api.rmpgutah.us)'}
        </span>
      </div>

      {error && <p className="text-red-400 text-xs">{error}</p>}

      {loading && !queue && (
        <p className="text-xs text-fg-muted">Loading sync status…</p>
      )}

      {queue && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Pending', value: queue.pending, color: queue.pending > 0 ? 'text-amber-400' : 'text-fg-muted' },
            { label: 'Failed', value: queue.failed, color: queue.failed > 0 ? 'text-red-400' : 'text-fg-muted' },
            { label: 'Delivered', value: queue.delivered, color: 'text-green-400' },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-surface-raised rounded p-3 text-center">
              <div className={`text-2xl font-bold ${color}`}>{value}</div>
              <div className="text-[10px] text-fg-secondary mt-1">{label}</div>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={triggerReplay}
        disabled={replaying || loading}
        className="px-3 py-1.5 text-xs bg-rmpg-700 hover:bg-rmpg-600 text-rmpg-100 rounded disabled:opacity-50"
      >
        {replaying ? 'Replaying…' : 'Trigger Manual Replay'}
      </button>

      <div>
        <h3 className="text-xs font-semibold text-[color:var(--panel-header-color)] mb-2">
          Recent Conflicts (last 50)
        </h3>
        {conflicts.length === 0 ? (
          <p className="text-xs text-fg-muted">No conflicts recorded.</p>
        ) : (
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-fg-secondary font-semibold text-[9px] border-b border-rmpg-700">
                <th className="text-left py-[3px]">Table</th>
                <th className="text-left py-[3px]">Record</th>
                <th className="text-left py-[3px]">Winner</th>
                <th className="text-left py-[3px]">Resolved</th>
              </tr>
            </thead>
            <tbody>
              {conflicts.map(row => (
                <tr key={row.id} className="border-b border-rmpg-800/50">
                  <td className="py-[2px] text-fg-secondary">{row.table_name}</td>
                  <td className="py-[2px] text-fg-secondary">#{row.record_id}</td>
                  <td className={`py-[2px] ${row.winning_source === 'fz55' ? 'text-green-400' : 'text-fg-secondary'}`}>
                    {row.winning_source === 'fz55' ? 'FZ-55' : 'Cloudflare'}
                  </td>
                  <td className="py-[2px] text-fg-muted">{(row.resolved_at ?? '').slice(0, 16)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

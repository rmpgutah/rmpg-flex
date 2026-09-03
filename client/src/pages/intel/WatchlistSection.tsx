// Thin watchlist list. Reuses the existing /intel/watchlist endpoint.
import { useEffect, useState } from 'react';
import { apiFetch } from '../../hooks/useApi';
import { useIntelContext } from './IntelContext';
import { formatEnumValue } from '../../utils/formatters';

interface Watch { entity_type: string; entity_id: number; reason: string; label?: string; created_at: string }

export default function WatchlistSection() {
  const [rows, setRows] = useState<Watch[]>([]);
  const [fetchError, setFetchError] = useState(false);
  const { selectEntity } = useIntelContext();
  useEffect(() => {
    let cancelled = false;
    setFetchError(false);
    apiFetch<Watch[]>('/intel/watchlist')
      .then((r) => { if (!cancelled) setRows(Array.isArray(r) ? r : []); })
      .catch(() => { if (!cancelled) { setRows([]); setFetchError(true); } });
    return () => { cancelled = true; };
  }, []);
  return (
    <div className="p-3 space-y-2">
      <div className="font-mono text-[10px] tracking-widest text-fg-muted uppercase">Watchlist ({rows.length})</div>
      {rows.length === 0 && fetchError && (
        <div className="border border-red-900/50 bg-surface-overlay rounded-[2px] px-3 py-6 text-center">
          <div className="text-red-500 text-[18px] leading-none mb-1">⚠</div>
          <div className="text-[11px] text-red-400">Watchlist unavailable</div>
          <div className="text-[9px] text-rmpg-500 mt-1">Could not load watchlist — check your connection and reload.</div>
        </div>
      )}
      {rows.length === 0 && !fetchError && (
        <div className="border border-border-default bg-surface-overlay rounded-[2px] px-3 py-6 text-center">
          <div className="text-emerald-500 text-[18px] leading-none mb-1">✓</div>
          <div className="text-[11px] text-rmpg-400">All clear — no active watches</div>
          <div className="text-[9px] text-rmpg-500 mt-1">Flag a person or vehicle from search to monitor it here.</div>
        </div>
      )}
      {rows.map((w) => (
        <button key={`${w.entity_type}:${w.entity_id}`} onClick={() => selectEntity(w.entity_type, w.entity_id, w.label || `Entity #${w.entity_id}`)}
          className="w-full text-left flex items-center gap-2 bg-surface-overlay border border-border-default rounded-[2px] px-2 py-[6px]">
          <span className="text-[11px] text-rmpg-200 min-w-0 flex-1 truncate">{w.label || `${w.entity_type} #${w.entity_id}`}</span>
          <span className="text-[10px] text-rmpg-500 truncate max-w-[160px]">{formatEnumValue(w.reason)}</span>
        </button>
      ))}
    </div>
  );
}

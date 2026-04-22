import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../../../hooks/useApi';
import { useWebSocket } from '../../../context/WebSocketContext';

// Endpoints:
//   GET /api/comms/bolos/active             — active BOLOs (server already filters active+unexpired)
//   GET /api/dispatch/geography/premise-alerts — active premise alerts (server already filters active+unexpired)
// Spec asked for ?active=1&limit= params; server doesn't honor those but returns active-only
// results already, so we just slice client-side.

interface BoloRow {
  id: number;
  title?: string;
  description?: string;
  suspect_description?: string;
  vehicle_description?: string;
  plate?: string;
  created_at?: string;
  [k: string]: any;
}

interface PremiseRow {
  id: number;
  location_name?: string;
  title?: string;
  address?: string;
  alert_type?: string;
  description?: string;
  created_at?: string;
  [k: string]: any;
}

type FeedItem =
  | { kind: 'bolo'; id: number; created_at: string; row: BoloRow }
  | { kind: 'alert'; id: number; created_at: string; row: PremiseRow };

export default function BolosCard() {
  const { subscribe } = useWebSocket();

  const [bolos, setBolos] = useState<BoloRow[]>([]);
  const [alerts, setAlerts] = useState<PremiseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchAll = useCallback(async () => {
    setError(null);
    const results = await Promise.all([
      apiFetch<any>('/api/comms/bolos/active').catch(() => null),
      apiFetch<any>('/api/dispatch/geography/premise-alerts').catch(() => null),
    ]);
    const [bRes, aRes] = results;
    let anyFailed = false;
    if (bRes == null) anyFailed = true;
    if (aRes == null) anyFailed = true;

    const bRows: BoloRow[] = Array.isArray(bRes)
      ? bRes
      : Array.isArray(bRes?.rows)
      ? bRes.rows
      : [];
    const aRows: PremiseRow[] = Array.isArray(aRes)
      ? aRes
      : Array.isArray(aRes?.rows)
      ? aRes.rows
      : [];

    setBolos(bRows);
    setAlerts(aRows);
    if (anyFailed && bRows.length === 0 && aRows.length === 0) {
      setError('Failed to load BOLOs/alerts');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    const trigger = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => { fetchAll(); }, 250);
    };
    const unsubB = subscribe('bolo_update' as any, trigger);
    const unsubA = subscribe('premise_alert' as any, trigger);
    return () => {
      unsubB();
      unsubA();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [subscribe, fetchAll]);

  const feed = useMemo<FeedItem[]>(() => {
    const items: FeedItem[] = [];
    for (const b of bolos) {
      items.push({ kind: 'bolo', id: b.id, created_at: b.created_at || '', row: b });
    }
    for (const a of alerts) {
      items.push({ kind: 'alert', id: a.id, created_at: a.created_at || '', row: a });
    }
    items.sort((x, y) => {
      const tx = x.created_at ? new Date(x.created_at).getTime() : 0;
      const ty = y.created_at ? new Date(y.created_at).getTime() : 0;
      return ty - tx;
    });
    return items.slice(0, 8);
  }, [bolos, alerts]);

  if (loading) {
    return (
      <section className="bg-[#141414] border border-[#222] p-3">
        <h2 className="text-[#d4a017] text-[10px] font-bold tracking-widest mb-2">BOLOS & ALERTS</h2>
        <div className="h-[180px] animate-pulse bg-[#1a1a1a] border border-[#222]" />
      </section>
    );
  }

  if (error) {
    return (
      <section className="bg-[#141414] border border-[#222] p-3">
        <h2 className="text-[#d4a017] text-[10px] font-bold tracking-widest mb-2">BOLOS & ALERTS</h2>
        <div className="flex items-center justify-between gap-2">
          <span className="text-amber-400 text-xs">{error}</span>
          <button
            type="button"
            onClick={() => { setLoading(true); fetchAll(); }}
            className="min-h-[44px] h-11 px-3 bg-amber-900/30 border border-amber-700 text-amber-200 text-xs uppercase tracking-widest"
          >
            Retry
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="bg-[#141414] border border-[#222] p-3">
      <h2 className="text-[#d4a017] text-[10px] font-bold tracking-widest mb-2">BOLOS & ALERTS</h2>

      {feed.length === 0 ? (
        <p className="text-gray-500 text-xs italic">No active BOLOs or alerts.</p>
      ) : (
        <ul className="space-y-1">
          {feed.map((item) => {
            const key = `${item.kind}-${item.id}`;
            const isExpanded = expandedKey === key;
            if (item.kind === 'bolo') {
              const b = item.row;
              const title = b.title ?? b.description ?? 'BOLO';
              const subtitle =
                b.vehicle_description ||
                b.suspect_description ||
                b.plate ||
                '';
              const fullText = b.description || b.suspect_description || b.vehicle_description || '';
              return (
                <li key={key}>
                  <button
                    type="button"
                    onClick={() => setExpandedKey(isExpanded ? null : key)}
                    aria-expanded={isExpanded}
                    className="w-full text-left min-h-[44px] border-l-2 border-l-red-700 pl-2 py-2 flex flex-col"
                  >
                    <span className="flex items-center gap-2">
                      <span className="bg-red-900/40 text-red-300 text-[9px] font-bold tracking-widest px-1.5 py-0.5">BOLO</span>
                      <span className="text-white text-xs truncate">{title}</span>
                    </span>
                    {subtitle ? (
                      <span className="text-gray-500 text-[11px] truncate">{subtitle}</span>
                    ) : null}
                    {isExpanded && fullText ? (
                      <span className="mt-1 text-gray-300 text-[11px] whitespace-pre-wrap">{fullText}</span>
                    ) : null}
                  </button>
                </li>
              );
            }
            const a = item.row;
            const title = a.location_name ?? a.title ?? a.address ?? 'Premise Alert';
            const subtitle = a.alert_type || a.address || '';
            const fullText = a.description || '';
            return (
              <li key={key}>
                <button
                  type="button"
                  onClick={() => setExpandedKey(isExpanded ? null : key)}
                  aria-expanded={isExpanded}
                  className="w-full text-left min-h-[44px] border-l-2 border-l-amber-700 pl-2 py-2 flex flex-col"
                >
                  <span className="flex items-center gap-2">
                    <span className="bg-amber-900/40 text-amber-300 text-[9px] font-bold tracking-widest px-1.5 py-0.5">ALERT</span>
                    <span className="text-white text-xs truncate">{title}</span>
                  </span>
                  {subtitle ? (
                    <span className="text-gray-500 text-[11px] truncate">{subtitle}</span>
                  ) : null}
                  {isExpanded && fullText ? (
                    <span className="mt-1 text-gray-300 text-[11px] whitespace-pre-wrap">{fullText}</span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

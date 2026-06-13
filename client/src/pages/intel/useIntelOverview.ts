// Polls /api/intel/overview every 20s. Pauses while the tab is hidden so a
// backgrounded command center doesn't hammer the Worker. (WebSocket is dead
// on the rewrite — polling is the live-data transport for now.)
import { useEffect, useRef, useState, useCallback } from 'react';
import { apiFetch } from '../../hooks/useApi';

export interface IntelOverview {
  stats: { active_warrants: number; on_watchlist: number; gang_flagged: number };
  watchlist_activity: Array<{ entity_type: string; entity_id: number; label: string; event: string; when: string }>;
  alerts: Array<{ kind: string; person_id: number | null; label: string; detail: string; when: string }>;
  escalation_leaderboard: Array<{ person_id: number; label: string; score: number; trend: string }>;
  jail_cross_hits: Array<{ booking_id: number; name: string; person_id: number | null; booked_at: string; match: string }>;
  plate_sightings: Array<{ plate: string; state: string | null; flag: string | null; location_text: string | null; when: string }>;
  queues: { link_suggestions: number; resolution_pairs: number };
  bolos: { active: number; high_priority: number };
}

const POLL_MS = 20_000;

export function useIntelOverview() {
  const [data, setData] = useState<IntelOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const load = useCallback(() => {
    apiFetch<IntelOverview>('/intel/overview')
      .then((d) => { setData(d); setError(null); })
      .catch((e) => setError(e?.message || 'overview failed'));
  }, []);

  useEffect(() => {
    load();
    const start = () => { clearInterval(timer.current); timer.current = setInterval(load, POLL_MS); };
    const onVis = () => { if (document.visibilityState === 'visible') { load(); start(); } else clearInterval(timer.current); };
    start();
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(timer.current); document.removeEventListener('visibilitychange', onVis); };
  }, [load]);

  return { data, error, reload: load };
}

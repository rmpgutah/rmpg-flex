// Shared poller for /api/intel/overview. EVERY consumer (rail, dashboard, any
// section) subscribes to ONE module-level interval and ONE in-flight request,
// so the command center makes a single overview call per 20s no matter how many
// surfaces read it. Pauses while the tab is hidden. (WebSocket is dead on the
// rewrite — polling is the live-data transport; sharing it keeps cost to 1/20s.)
import { useEffect, useState } from 'react';
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

// ── Module-level shared state ────────────────────────────────
let cache: IntelOverview | null = null;
let cacheError: string | null = null;
const subscribers = new Set<() => void>();
let intervalId: ReturnType<typeof setInterval> | undefined;

function notify() { subscribers.forEach((fn) => fn()); }

function load() {
  apiFetch<IntelOverview>('/intel/overview')
    .then((d) => { cache = d; cacheError = null; notify(); })
    .catch((e) => { cacheError = e instanceof Error ? e.message : 'overview failed'; notify(); });
}

function ensureInterval() { if (intervalId === undefined) intervalId = setInterval(load, POLL_MS); }
function clearTimer() { if (intervalId !== undefined) { clearInterval(intervalId); intervalId = undefined; } }

function onVisibility() {
  if (document.visibilityState === 'visible') { load(); ensureInterval(); }
  else clearTimer();
}

function subscribe(fn: () => void): () => void {
  subscribers.add(fn);
  if (subscribers.size === 1) {
    // First consumer starts the shared poll.
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
    load();
    ensureInterval();
  }
  return () => {
    subscribers.delete(fn);
    if (subscribers.size === 0) {
      // Last consumer left — tear the shared poll down so it doesn't leak.
      clearTimer();
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
    }
  };
}

export function useIntelOverview() {
  const [, force] = useState(0);
  useEffect(() => subscribe(() => force((n) => n + 1)), []);
  return { data: cache, error: cacheError, reload: load };
}

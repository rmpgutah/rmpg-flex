import { useState, useEffect } from 'react';
import { apiFetch } from './useApi';

export interface NavBadges {
  activeCalls?: number;
  activeBOLOs?: number;
  unreadEmail?: number;
  activeWarrants?: number;
  openCases?: number;
  pendingServe?: number;
}

export function useNavBadges(intervalMs = 30000): { badges: NavBadges; isLoading: boolean } {
  const [badges, setBadges] = useState<NavBadges>({});
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchBadges() {
      setIsLoading(true);
      const results: NavBadges = {};
      try {
        // dispatchAggregates mounts bare at /api/dispatch — '/dispatch/aggregates'
        // 404s, the dashboard-stats route is the bare prefix itself.
        const stats = await apiFetch<{ calls?: { active?: number } }>('/dispatch');
        if (stats?.calls?.active) results.activeCalls = stats.calls.active;
      } catch { /* silent */ }
      try {
        const bolos = await apiFetch<unknown[]>('/comms/bolos/active');
        if (Array.isArray(bolos)) results.activeBOLOs = bolos.length;
      } catch { /* silent */ }
      try {
        const email = await apiFetch<{ count: number }>('/email/unread-count');
        if (email?.count) results.unreadEmail = email.count;
      } catch { /* silent */ }
      try {
        const warrants = await apiFetch<{ active_warrants?: number }>('/dispatch/stats');
        if (warrants?.active_warrants) results.activeWarrants = warrants.active_warrants;
      } catch { /* silent */ }
      try {
        const dashboard = await apiFetch<{ open_cases?: number; pending_serve?: number }>('/stats/dashboard');
        if (dashboard?.open_cases) results.openCases = dashboard.open_cases;
        if (dashboard?.pending_serve) results.pendingServe = dashboard.pending_serve;
      } catch { /* silent */ }
      if (!cancelled) {
        setBadges(results);
        setIsLoading(false);
      }
    }

    fetchBadges();
    const interval = setInterval(fetchBadges, intervalMs);
    return () => { cancelled = true; clearInterval(interval); };
  }, [intervalMs]);

  return { badges, isLoading };
}

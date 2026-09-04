// Intel command-center landing. One /api/intel/overview call → stat tiles +
// six live widgets. Rows pivot the right context panel via selectEntity.
//
// v1047 — Page 30 audit:
//   • URL deep-link `/intel?entity_type=person&entity_id=42&label=Hale`
//     opens the right dossier panel pre-selected on the entity. Lets the
//     watchlist toast, AI Analyst output, or a court packet link land
//     straight on the dashboard with context.
//   • LIVE indicator now flips amber when the shared overview poll has
//     stale data (>60s) — was previously a static green dot regardless
//     of whether the request had succeeded recently.
//   • Distinct error vs empty-data states.
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useIntelOverview } from './useIntelOverview';
import { useIntelContext } from './IntelContext';
import StatTiles from './widgets/StatTiles';
import WatchlistActivityWidget from './widgets/WatchlistActivityWidget';
import ActiveAlertsWidget from './widgets/ActiveAlertsWidget';
import EscalationLeaderboardWidget from './widgets/EscalationLeaderboardWidget';
import JailCrossHitsWidget from './widgets/JailCrossHitsWidget';
import PlateSightingsWidget from './widgets/PlateSightingsWidget';
import ReviewQueuesWidget from './widgets/ReviewQueuesWidget';

const EMPTY = {
  stats: { active_warrants: 0, on_watchlist: 0, gang_flagged: 0 },
  watchlist_activity: [], alerts: [], escalation_leaderboard: [],
  jail_cross_hits: [], plate_sightings: [],
  queues: { link_suggestions: 0, resolution_pairs: 0 }, bolos: { active: 0, high_priority: 0 },
};

export default function IntelDashboard() {
  const { data, error } = useIntelOverview();
  const { selectEntity } = useIntelContext();
  const ov = data || EMPTY;

  // Track last-update timestamp so LIVE dot flips amber if the poll stalls.
  // (useIntelOverview is module-singleton; we observe transitions here.)
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const prevDataRef = useRef<typeof data | null>(null);
  useEffect(() => {
    if (data && data !== prevDataRef.current) {
      prevDataRef.current = data;
      setLastUpdated(Date.now());
    }
  }, [data]);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const id = setInterval(tick, 10_000);
    return () => clearInterval(id);
  }, []);
  const stale = lastUpdated != null && (now - lastUpdated) > 60_000;

  // ── `?entity_id=…&entity_type=…&label=…` deep-link auto-select ──
  // Opens the right context dossier panel on the entity in the URL.
  // Strips the params after applying so a refresh doesn't re-select.
  const [searchParams, setSearchParams] = useSearchParams();
  const pendingDeepLinkRef = useRef<{ type: string; id: number; label: string } | null>(null);
  if (pendingDeepLinkRef.current === null) {
    const entityIdRaw = searchParams.get('entity_id');
    const entityType = searchParams.get('entity_type') || 'person';
    const entityLabel = searchParams.get('label') || '';
    if (entityIdRaw) {
      const id = parseInt(entityIdRaw, 10);
      if (Number.isFinite(id) && id > 0) pendingDeepLinkRef.current = { type: entityType, id, label: entityLabel };
    }
  }
  useEffect(() => {
    const pending = pendingDeepLinkRef.current;
    if (!pending) return;
    pendingDeepLinkRef.current = null;
    selectEntity(pending.type, pending.id, pending.label || `#${pending.id}`);
    const next = new URLSearchParams(searchParams);
    next.delete('entity_id');
    next.delete('entity_type');
    next.delete('label');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="p-3 space-y-[10px]">
      <div className="font-mono text-[10px] tracking-widest text-rmpg-400 uppercase flex items-center gap-2">
        Intelligence Dashboard
        <span className={`text-[8px] flex items-center gap-1 ${stale ? 'text-amber-400' : 'text-emerald-400'}`}
              title={lastUpdated ? `Last updated ${new Date(lastUpdated).toLocaleTimeString('en-US', { timeZone: 'America/Denver' })}` : 'Waiting…'}> // new-date-ok
          <span className={`w-[5px] h-[5px] rounded-full inline-block ${stale ? 'bg-amber-400' : 'bg-emerald-400 animate-pulse'}`} />
          {stale ? 'STALE' : 'LIVE'}
        </span>
      </div>
      {error && <div className="text-[10px] text-red-400">Live data error: {error}</div>}

      <StatTiles stats={ov.stats} />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-[10px]">
        <WatchlistActivityWidget rows={ov.watchlist_activity} onSelect={selectEntity} />
        <ActiveAlertsWidget rows={ov.alerts} onSelect={selectEntity} />
        <EscalationLeaderboardWidget rows={ov.escalation_leaderboard} onSelect={selectEntity} />
        <JailCrossHitsWidget rows={ov.jail_cross_hits} onSelect={selectEntity} />
        <PlateSightingsWidget rows={ov.plate_sightings} />
        <ReviewQueuesWidget queues={ov.queues} />
      </div>
    </div>
  );
}

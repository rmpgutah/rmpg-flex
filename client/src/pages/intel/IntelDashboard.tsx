// Intel command-center landing. One /api/intel/overview call → stat tiles +
// six live widgets. Rows pivot the right context panel via selectEntity.
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

  return (
    <div className="p-3 space-y-[10px]">
      <div className="font-mono text-[10px] tracking-widest text-[#888] uppercase flex items-center gap-2">
        Intelligence Dashboard
        <span className="text-[8px] text-[#10b981] flex items-center gap-1">
          <span className="w-[5px] h-[5px] rounded-full bg-[#10b981] inline-block" />LIVE
        </span>
      </div>
      {error && <div className="text-[10px] text-[#ff6b5e]">Live data error: {error}</div>}

      <StatTiles stats={ov.stats} />

      <div className="grid grid-cols-2 gap-[10px]">
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

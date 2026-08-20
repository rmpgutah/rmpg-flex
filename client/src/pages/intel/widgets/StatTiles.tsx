import type { IntelOverview } from '../useIntelOverview';

const TILE = 'border border-border-default bg-surface-overlay rounded-[2px] p-3 text-center';

export default function StatTiles({ stats }: { stats: IntelOverview['stats'] }) {
  const items = [
    { n: stats.active_warrants, l: 'Active Warrants', c: 'text-red-400' },
    { n: stats.on_watchlist, l: 'On Watchlist', c: 'text-rmpg-100' },
    { n: stats.gang_flagged, l: 'Gang-Flagged', c: 'text-purple-400' },
  ];
  return (
    <div className="grid grid-cols-3 gap-[10px]">
      {items.map((it) => (
        <div key={it.l} className={TILE}>
          <div className={`font-mono text-[20px] font-bold ${it.c}`}>{it.n}</div>
          <div className="text-[8px] text-rmpg-400 uppercase tracking-wide mt-[3px]">{it.l}</div>
        </div>
      ))}
    </div>
  );
}

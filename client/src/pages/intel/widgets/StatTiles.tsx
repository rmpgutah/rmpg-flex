import type { IntelOverview } from '../useIntelOverview';

const TILE = 'border border-[#1f1f1f] bg-[#070707] rounded-[2px] p-3 text-center';

export default function StatTiles({ stats }: { stats: IntelOverview['stats'] }) {
  const items = [
    { n: stats.active_warrants, l: 'Active Warrants', c: 'text-[#ff6b5e]' },
    { n: stats.on_watchlist, l: 'On Watchlist', c: 'text-[#d4a017]' },
    { n: stats.gang_flagged, l: 'Gang-Flagged', c: 'text-[#c07ff0]' },
  ];
  return (
    <div className="grid grid-cols-3 gap-[10px]">
      {items.map((it) => (
        <div key={it.l} className={TILE}>
          <div className={`font-mono text-[20px] font-bold ${it.c}`}>{it.n}</div>
          <div className="text-[8px] text-[#777] uppercase tracking-wide mt-[3px]">{it.l}</div>
        </div>
      ))}
    </div>
  );
}

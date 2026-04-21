import type { CoverageStats } from '../hooks/useDispatchCoverageStats';

interface MapV2CoverageBarProps {
  stats: CoverageStats;
}

/**
 * At-a-glance dispatch coverage strip — top-center floating chrome on
 * /map-v2. Mirrors the v1 dispatch console's "X available · Y dispatched
 * · Z onscene · N P1 active" header so dispatchers see the load picture
 * without scanning the unit list.
 *
 * Color cues:
 *  - Green = available units
 *  - Amber = dispatched/enroute
 *  - Purple = onscene
 *  - Red = busy or P1 active
 */
export default function MapV2CoverageBar({ stats }: MapV2CoverageBarProps) {
  const items = [
    { label: 'AVL', value: stats.unitsAvailable, color: '#22c55e' },
    { label: 'DSP', value: stats.unitsDispatched, color: '#f59e0b' },
    { label: 'ENR', value: stats.unitsEnroute, color: '#888888' },
    { label: 'ONS', value: stats.unitsOnscene, color: '#a855f7' },
    { label: 'BSY', value: stats.unitsBusy, color: '#ef4444' },
  ];
  const callItems = [
    { label: 'P1', value: stats.callsP1, color: '#ef4444' },
    { label: 'P2', value: stats.callsP2, color: '#f59e0b' },
    { label: 'ACT', value: stats.callsActive, color: '#fbbf24' },
  ];

  return (
    <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 flex items-stretch font-mono text-[10px] uppercase tracking-wider select-none pointer-events-none">
      <div className="flex items-stretch bg-[#0a0a0a] border border-[#222222] divide-x divide-[#1a1a1a]">
        <div className="px-2 py-1 text-[#666666]">UNITS</div>
        {items.map((it) => (
          <div key={it.label} className="px-2 py-1 flex items-center gap-1">
            <span className="text-[#666666] text-[8px]">{it.label}</span>
            <span style={{ color: it.color }} className="font-bold tabular-nums">{it.value}</span>
          </div>
        ))}
        <div className="px-2 py-1 text-[#666666]">CALLS</div>
        {callItems.map((it) => (
          <div key={it.label} className="px-2 py-1 flex items-center gap-1">
            <span className="text-[#666666] text-[8px]">{it.label}</span>
            <span style={{ color: it.color }} className="font-bold tabular-nums">{it.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

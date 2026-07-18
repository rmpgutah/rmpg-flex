// Speed Analytics side panel — per-beat speed stats + coverage timeline.
// Opened from the "Speed Analytics" map layer toggle.
import { useState } from 'react';
import { Gauge, X } from 'lucide-react';
import type { ZoneSpeedStat, CoverageTimelineData } from '../hooks/useSpeedZoneStats';
import CoverageTimeline from './CoverageTimeline';

interface SpeedAnalyticsPanelProps {
  zoneStats: ZoneSpeedStat[];
  coverage: CoverageTimelineData | null;
  loading: boolean;
  onClose: () => void;
}

export default function SpeedAnalyticsPanel({ zoneStats, coverage, loading, onClose }: SpeedAnalyticsPanelProps) {
  const [coverageExpanded, setCoverageExpanded] = useState(false);
  const topBeats = zoneStats.slice(0, 20);

  return (
    <div className="absolute top-16 left-2 z-40 w-[360px] max-h-[70vh] overflow-y-auto bg-surface-raised/95 border border-rmpg-700 rounded-[2px] font-mono text-rmpg-200">
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-rmpg-700">
        <div className="flex items-center gap-1.5">
          <Gauge size={12} className="text-brand-gold-400" />
          <span className="text-[10px] font-semibold text-brand-gold-400">Speed Analytics</span>
          {loading && <span className="text-[8px] text-rmpg-500">loading…</span>}
        </div>
        <button onClick={onClose} className="p-0.5" aria-label="Close speed analytics panel">
          <X size={12} className="text-rmpg-500" />
        </button>
      </div>

      <div className="border-b border-rmpg-700">
        <CoverageTimeline data={coverage} expanded={coverageExpanded} onToggle={() => setCoverageExpanded((v) => !v)} />
      </div>

      <div className="px-1 pt-1 pb-2">
        <div className="text-[9px] font-semibold text-rmpg-400 px-1 pb-1">Beat Speed Stats</div>
        {topBeats.length === 0 ? (
          <div className="text-[10px] text-rmpg-500 px-1 py-2">No GPS speed data in this window.</div>
        ) : (
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-rmpg-500">
                <th className="text-left font-semibold text-[9px] py-[3px] px-1">Beat</th>
                <th className="text-right font-semibold text-[9px] py-[3px] px-1">Avg</th>
                <th className="text-right font-semibold text-[9px] py-[3px] px-1">Max</th>
                <th className="text-right font-semibold text-[9px] py-[3px] px-1">P95</th>
                <th className="text-right font-semibold text-[9px] py-[3px] px-1">Pts</th>
              </tr>
            </thead>
            <tbody>
              {topBeats.map((b) => (
                <tr key={b.beat_id} className="py-[2px] border-t border-rmpg-800/60" title={`${b.zone_name} / ${b.sector_name}`}>
                  <td className="px-1 py-[2px] truncate max-w-[140px]">{b.beat_name}</td>
                  <td className="px-1 py-[2px] text-right">{b.avg_speed.toFixed(0)}</td>
                  <td className="px-1 py-[2px] text-right text-brand-gold-400">{b.max_speed.toFixed(0)}</td>
                  <td className="px-1 py-[2px] text-right">{b.p95_speed.toFixed(0)}</td>
                  <td className="px-1 py-[2px] text-right text-rmpg-500">{b.point_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

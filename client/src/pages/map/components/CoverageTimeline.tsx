// ============================================================
// RMPG Flex — CoverageTimeline Component
// Collapsible panel with horizontal bar chart showing zone
// coverage over time. Beat rows colored by coverage state
// (covered, slow/stationary, gap) with opacity by unit count.
// ============================================================

import { Clock, ChevronDown, ChevronUp } from 'lucide-react';

interface CoverageInterval {
  start: string;
  end: string;
  zones: { beat_id: number; beat_name: string; unit_count: number; avg_speed: number | null }[];
}

interface CoverageTimelineProps {
  data: { intervals: CoverageInterval[]; total_beats: number } | null;
  expanded: boolean;
  onToggle: () => void;
}

/** Format HH:MM from ISO timestamp */
function fmtTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes();
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

export default function CoverageTimeline({ data, expanded, onToggle }: CoverageTimelineProps) {
  if (!data || !data.intervals || data.intervals.length === 0) return null;

  const { intervals } = data;

  // ── Beat selection: top 15 by coverage frequency ──
  const beatFreq = new Map<number, { name: string; count: number }>();
  for (const iv of intervals) {
    for (const z of iv.zones) {
      const entry = beatFreq.get(z.beat_id);
      if (entry) {
        entry.count++;
      } else {
        beatFreq.set(z.beat_id, { name: z.beat_name, count: 1 });
      }
    }
  }
  const topBeats = Array.from(beatFreq.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 15)
    .map(([id, { name }]) => ({ id, name }));

  // ── Time label spacing ──
  const labelStep = Math.max(1, Math.floor(intervals.length / 8));

  // ── Build zone lookup per interval ──
  const intervalMaps = intervals.map((iv) => {
    const m = new Map<number, { unit_count: number; avg_speed: number | null }>();
    for (const z of iv.zones) {
      m.set(z.beat_id, { unit_count: z.unit_count, avg_speed: z.avg_speed });
    }
    return m;
  });

  return (
    <div>
      {/* Toggle button */}
      <button
        onClick={onToggle}
        className="flex items-center gap-1.5 w-full px-2 py-1 text-left hover:bg-rmpg-800/50 transition-colors"
      >
        <Clock size={10} className="text-rmpg-400" />
        <span className="text-[9px] font-mono font-bold text-rmpg-200">Coverage Timeline</span>
        {expanded ? (
          <ChevronUp size={10} className="ml-auto text-rmpg-400" />
        ) : (
          <ChevronDown size={10} className="ml-auto text-rmpg-400" />
        )}
      </button>

      {expanded && (
        <div className="px-2 pb-2 pt-1">
          <div className="overflow-x-auto" style={{ minWidth: 400 }}>
            {/* Header row — time labels */}
            <div className="flex" style={{ marginLeft: 80 }}>
              {intervals.map((iv, i) => (
                <div
                  key={i}
                  className="text-center font-mono"
                  style={{
                    width: 18,
                    minWidth: 18,
                    fontSize: 7,
                    color: '#888',
                    lineHeight: '12px',
                  }}
                >
                  {i % labelStep === 0 ? fmtTime(iv.start) : ''}
                </div>
              ))}
            </div>

            {/* Beat rows */}
            {topBeats.map((beat) => (
              <div key={beat.id} className="flex items-center" style={{ height: 14 }}>
                {/* Beat name */}
                <div
                  className="font-mono truncate"
                  style={{
                    width: 80,
                    minWidth: 80,
                    fontSize: 7,
                    color: '#888',
                    paddingRight: 4,
                  }}
                  title={beat.name}
                >
                  {beat.name}
                </div>

                {/* Interval cells */}
                {intervals.map((iv, i) => {
                  const zone = intervalMaps[i].get(beat.id);
                  let bgColor: string;
                  let opacity: number;
                  let tooltip: string;

                  if (!zone) {
                    bgColor = '#1a1a1a';
                    opacity = 0.3;
                    tooltip = `${beat.name} | ${fmtTime(iv.start)}-${fmtTime(iv.end)} | No coverage`;
                  } else if (zone.avg_speed !== null && zone.avg_speed < 5) {
                    bgColor = '#854d0e';
                    opacity = Math.min(0.5 + zone.unit_count * 0.15, 1);
                    tooltip = `${beat.name} | ${fmtTime(iv.start)}-${fmtTime(iv.end)} | ${zone.unit_count} unit${zone.unit_count !== 1 ? 's' : ''} | ${zone.avg_speed != null ? zone.avg_speed.toFixed(1) : '?'} mph (slow)`;
                  } else {
                    bgColor = '#166534';
                    opacity = Math.min(0.5 + zone.unit_count * 0.15, 1);
                    tooltip = `${beat.name} | ${fmtTime(iv.start)}-${fmtTime(iv.end)} | ${zone.unit_count} unit${zone.unit_count !== 1 ? 's' : ''} | ${zone.avg_speed != null ? zone.avg_speed.toFixed(1) : '?'} mph`;
                  }

                  return (
                    <div
                      key={i}
                      title={tooltip}
                      style={{
                        width: 18,
                        minWidth: 18,
                        height: 10,
                        backgroundColor: bgColor,
                        opacity,
                        borderRadius: 1,
                        margin: '0 0.5px',
                      }}
                    />
                  );
                })}
              </div>
            ))}
          </div>

          {/* Legend */}
          <div className="flex items-center gap-3 mt-1.5 ml-[80px]">
            <div className="flex items-center gap-1">
              <div style={{ width: 8, height: 8, backgroundColor: '#166534', borderRadius: 1 }} />
              <span className="text-[7px] font-mono text-rmpg-400">Covered</span>
            </div>
            <div className="flex items-center gap-1">
              <div style={{ width: 8, height: 8, backgroundColor: '#854d0e', borderRadius: 1 }} />
              <span className="text-[7px] font-mono text-rmpg-400">Slow/Stationary</span>
            </div>
            <div className="flex items-center gap-1">
              <div style={{ width: 8, height: 8, backgroundColor: '#1a1a1a', borderRadius: 1, border: '1px solid #333' }} />
              <span className="text-[7px] font-mono text-rmpg-400">Gap</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

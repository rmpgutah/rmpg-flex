// StatsTab — sparkline (24h) + heatmap (7d x 24h) + totals.
// All data comes from /api/radio/stats in one round-trip.
import { useEffect, useState } from 'react';
import { BarChart3, RefreshCw } from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import { SectionHeader, Sparkline, Heatmap, Stat, ToolbarBtn } from '../components';
import type { RadioStats } from '../types';

export default function StatsTab() {
  const [stats, setStats] = useState<RadioStats | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    apiFetch<RadioStats>('/radio/stats')
      .then(setStats)
      .catch((err) => console.error('[radio] stats', err))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  // Sparkline component expects oldest→newest. The server returns
  // index 0 = current hour, so reverse before render. The `highlight`
  // index marks "now" — last bar after reversal.
  const sparkValues = stats ? [...stats.sparkline].reverse() : [];
  const highlight = sparkValues.length - 1;

  return (
    <div className="h-full flex flex-col">
      <SectionHeader
        icon={<BarChart3 className="w-3 h-3" style={{ color: 'var(--rt-accent)' }} />}
        label="ACTIVITY STATS"
        trailing={
          <ToolbarBtn onClick={load} title="Reload">
            <RefreshCw className="w-3 h-3" /> RELOAD
          </ToolbarBtn>
        }
      />

      <div className="flex-1 min-h-0 overflow-auto p-3 flex flex-col gap-3">
        {loading && !stats ? (
          <div className="text-[10px] font-mono" style={{ color: 'var(--rt-muted)' }}>Loading…</div>
        ) : stats ? (
          <>
            {/* Totals row */}
            <div className="grid grid-cols-3 gap-2">
              <Stat label="TODAY" value={String(stats.totals.today ?? 0)} />
              <Stat label="LAST 7 DAYS" value={String(stats.totals.week ?? 0)} />
              <Stat label="ALL TIME" value={String(stats.totals.all ?? 0)} />
            </div>

            {/* Sparkline */}
            <div className="flex flex-col gap-1">
              <div className="text-[9px] font-mono tracking-[0.2em]" style={{ color: 'var(--rt-muted)' }}>
                LAST 24 HOURS (HOURLY)
              </div>
              <Sparkline values={sparkValues} highlight={highlight} />
            </div>

            {/* Heatmap */}
            <div className="flex flex-col gap-1">
              <div className="text-[9px] font-mono tracking-[0.2em]" style={{ color: 'var(--rt-muted)' }}>
                LAST 7 DAYS · 24-HOUR HEATMAP
              </div>
              <Heatmap rows={stats.heatmap} />
            </div>
          </>
        ) : (
          <div className="text-[10px] font-mono" style={{ color: 'var(--rt-muted)' }}>No stats available.</div>
        )}
      </div>
    </div>
  );
}

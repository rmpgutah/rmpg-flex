// Data-only hook for the Speed Analytics panel: per-beat speed stats and the
// coverage timeline. Both fetch on-demand (panel open) and poll while open.
import { useEffect, useState } from 'react';
import { apiFetch } from '../../../hooks/useApi';

export interface ZoneSpeedStat {
  beat_id: string;
  beat_name: string;
  beat_code: string;
  zone_name: string;
  sector_name: string;
  avg_speed: number;
  max_speed: number;
  p95_speed: number;
  point_count: number;
}

export interface CoverageZone {
  beat_id: string;
  beat_name: string;
  unit_count: number;
  avg_speed: number | null;
}

export interface CoverageInterval {
  start: string;
  end: string;
  zones: CoverageZone[];
}

export interface CoverageTimelineData {
  intervals: CoverageInterval[];
  total_beats: number;
}

export function useSpeedZoneStats(hours: number, enabled: boolean) {
  const [zoneStats, setZoneStats] = useState<ZoneSpeedStat[]>([]);
  const [coverage, setCoverage] = useState<CoverageTimelineData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) { setZoneStats([]); setCoverage(null); return; }
    let cancelled = false;

    const fetchAll = async () => {
      setLoading(true);
      try {
        const [stats, timeline] = await Promise.all([
          apiFetch<ZoneSpeedStat[]>(`/dispatch/gps/zone-speed-stats?hours=${hours}`),
          apiFetch<CoverageTimelineData>(`/dispatch/gps/coverage-timeline?hours=${hours}`),
        ]);
        if (cancelled) return;
        setZoneStats(Array.isArray(stats) ? stats : []);
        setCoverage(timeline || null);
      } catch (err) {
        if (!cancelled) console.warn('[useSpeedZoneStats] fetch failed:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchAll();
    const interval = setInterval(fetchAll, 60_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [enabled, hours]);

  return { zoneStats, coverage, loading };
}

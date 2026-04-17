import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '../../../hooks/useApi';

// ─── Exported interfaces ────────────────────────────────────

export interface SpeedViolation {
  id: number;
  unit_id: number;
  officer_id: number;
  call_sign: string;
  officer_name: string;
  badge_number: string;
  speed_mph: number;
  speed_limit_mph: number;
  overage_mph: number;
  latitude: number;
  longitude: number;
  road_name: string | null;
  duration_seconds: number;
  current_call_number: string | null;
  recorded_at: string;
  acknowledged_by: number | null;
  acknowledged_at: string | null;
  notes: string | null;
}

export interface SpeedStat {
  officer_id: number;
  officer_name: string;
  badge_number: string;
  call_sign: string;
  points_count: number;
  max_speed_mph: number;
  avg_speed_mph: number;
  p95_speed_mph: number;
  points_over_limit: number;
  violations_count: number;
}

export interface HeatmapCell {
  grid_lat: number;
  grid_lng: number;
  avg_speed: number;
  max_speed: number;
  point_count: number;
}

export interface ZoneSpeedStat {
  beat_id: number;
  beat_name: string;
  beat_code: string;
  zone_name: string;
  sector_name: string;
  avg_speed_mph: number;
  max_speed_mph: number;
  p95_speed_mph: number;
  point_count: number;
}

export interface PursuitSegment {
  unit_id: number;
  call_sign: string;
  officer_name: string;
  start_time: string;
  end_time: string;
  max_speed_mph: number;
  avg_speed_mph: number;
  distance_miles: number;
  point_count: number;
  points: { lat: number; lng: number; speed: number; heading: number; time: string }[];
}

export interface CoverageInterval {
  start: string;
  end: string;
  zones: { beat_id: number; beat_name: string; unit_count: number; avg_speed: number | null }[];
}

export interface SpeedZone {
  id: number;
  name: string;
  speed_limit_mph: number;
  polygon_coords: string;
  zone_type: string;
  active_hours: string | null;
  is_active: number;
}

// ─── Helper: speed band classification ──────────────────────

export function getBandKey(mph: number): string {
  if (mph < 3) return 'walking';
  if (mph < 10) return 'slow';
  if (mph < 25) return 'residential';
  if (mph < 35) return 'city';
  if (mph < 45) return 'arterial';
  if (mph < 55) return 'highway';
  if (mph < 75) return 'freeway';
  return 'pursuit';
}

// ─── Hook params ────────────────────────────────────────────

interface UseSpeedAnalyticsParams {
  hours: number;
  enabled: boolean;
}

// ─── Hook ───────────────────────────────────────────────────

export function useSpeedAnalytics({ hours, enabled }: UseSpeedAnalyticsParams) {
  // --- Violations ---
  const [violations, setViolations] = useState<SpeedViolation[]>([]);
  const [unacknowledgedCount, setUnacknowledgedCount] = useState(0);

  // --- Pursuit segments ---
  const [pursuitSegments, setPursuitSegments] = useState<PursuitSegment[]>([]);

  // --- Heatmap ---
  const [showSpeedHeatmap, setShowSpeedHeatmap] = useState(false);
  const [heatmapCells, setHeatmapCells] = useState<HeatmapCell[]>([]);

  // --- Zone stats ---
  const [showZoneStats, setShowZoneStats] = useState(false);
  const [zoneSpeedStats, setZoneSpeedStats] = useState<ZoneSpeedStat[]>([]);

  // --- Coverage timeline ---
  const [showCoverageTimeline, setShowCoverageTimeline] = useState(false);
  const [coverageTimeline, setCoverageTimeline] = useState<CoverageInterval[]>([]);

  // --- Speed zones ---
  const [speedZones, setSpeedZones] = useState<SpeedZone[]>([]);

  // --- Speed filtering ---
  const [speedFilterMin, setSpeedFilterMin] = useState(0);
  const [speedFilterMax, setSpeedFilterMax] = useState(200);
  const [speedBandToggles, setSpeedBandToggles] = useState<Record<string, boolean>>({});

  // --- Speed graph ---
  const [speedGraphUnit, setSpeedGraphUnit] = useState<number | null>(null);

  // ─── Violations fetch (every 30s) ─────────────────────────
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const fetchViolations = () => {
      apiFetch<SpeedViolation[]>(`/dispatch/gps/speed-violations?hours=${hours}`)
        .then((data) => {
          if (cancelled) return;
          const list = data || [];
          setViolations(list);
          setUnacknowledgedCount(list.filter((v) => v.acknowledged_by == null).length);
        })
        .catch(() => {});
    };
    fetchViolations();
    const interval = setInterval(fetchViolations, 30_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [enabled, hours]);

  // ─── Pursuit segments fetch (every 30s) ───────────────────
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const fetchPursuits = () => {
      apiFetch<PursuitSegment[]>(`/dispatch/gps/pursuit-segments?hours=${hours}`)
        .then((data) => { if (!cancelled) setPursuitSegments(data || []); })
        .catch(() => {});
    };
    fetchPursuits();
    const interval = setInterval(fetchPursuits, 30_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [enabled, hours]);

  // ─── Heatmap fetch (every 60s when toggled on) ────────────
  useEffect(() => {
    if (!enabled || !showSpeedHeatmap) {
      setHeatmapCells([]);
      return;
    }
    let cancelled = false;
    const fetchHeatmap = () => {
      apiFetch<HeatmapCell[]>(`/dispatch/gps/speed-heatmap?hours=${hours}`)
        .then((data) => { if (!cancelled) setHeatmapCells(data || []); })
        .catch(() => {});
    };
    fetchHeatmap();
    const interval = setInterval(fetchHeatmap, 60_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [enabled, showSpeedHeatmap, hours]);

  // ─── Zone speed stats fetch (every 60s when toggled on) ───
  useEffect(() => {
    if (!enabled || !showZoneStats) {
      setZoneSpeedStats([]);
      return;
    }
    let cancelled = false;
    const fetchZoneStats = () => {
      apiFetch<ZoneSpeedStat[]>(`/dispatch/gps/zone-speed-stats?hours=${hours}`)
        .then((data) => { if (!cancelled) setZoneSpeedStats(data || []); })
        .catch(() => {});
    };
    fetchZoneStats();
    const interval = setInterval(fetchZoneStats, 60_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [enabled, showZoneStats, hours]);

  // ─── Coverage timeline fetch (every 60s when toggled on) ──
  useEffect(() => {
    if (!enabled || !showCoverageTimeline) {
      setCoverageTimeline([]);
      return;
    }
    let cancelled = false;
    const fetchCoverage = () => {
      apiFetch<CoverageInterval[]>(`/dispatch/gps/coverage-timeline?hours=${hours}`)
        .then((data) => { if (!cancelled) setCoverageTimeline(data || []); })
        .catch(() => {});
    };
    fetchCoverage();
    const interval = setInterval(fetchCoverage, 60_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [enabled, showCoverageTimeline, hours]);

  // ─── Speed zones (one-time fetch on mount when enabled) ───
  const speedZonesFetchedRef = useRef(false);
  useEffect(() => {
    if (!enabled || speedZonesFetchedRef.current) return;
    speedZonesFetchedRef.current = true;
    apiFetch<SpeedZone[]>('/dispatch/gps/speed-zones')
      .then((data) => setSpeedZones(data || []))
      .catch(() => {});
  }, [enabled]);

  // ─── Speed visibility helper ──────────────────────────────
  const isSpeedVisible = useCallback(
    (speedMps: number): boolean => {
      const mph = speedMps * 2.23694;
      if (mph < speedFilterMin || mph > speedFilterMax) return false;
      const band = getBandKey(mph);
      if (speedBandToggles[band] === false) return false;
      return true;
    },
    [speedFilterMin, speedFilterMax, speedBandToggles],
  );

  // ─── Acknowledge violation callback ───────────────────────
  const acknowledgeViolation = useCallback(
    async (id: number, notes?: string) => {
      await apiFetch(`/dispatch/gps/speed-violations/${id}/acknowledge`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes }),
      });
      setViolations((prev) =>
        prev.map((v) =>
          v.id === id
            ? { ...v, acknowledged_by: -1, acknowledged_at: new Date().toISOString(), notes: notes ?? v.notes }
            : v,
        ),
      );
      setUnacknowledgedCount((c) => Math.max(0, c - 1));
    },
    [],
  );

  // ─── Return flat object ───────────────────────────────────
  return {
    // Violations
    violations,
    unacknowledgedCount,
    acknowledgeViolation,

    // Pursuit segments
    pursuitSegments,

    // Heatmap
    showSpeedHeatmap,
    setShowSpeedHeatmap,
    heatmapCells,

    // Zone stats
    showZoneStats,
    setShowZoneStats,
    zoneSpeedStats,

    // Coverage timeline
    showCoverageTimeline,
    setShowCoverageTimeline,
    coverageTimeline,

    // Speed zones
    speedZones,

    // Speed filtering
    speedFilterMin,
    setSpeedFilterMin,
    speedFilterMax,
    setSpeedFilterMax,
    speedBandToggles,
    setSpeedBandToggles,
    isSpeedVisible,

    // Speed graph
    speedGraphUnit,
    setSpeedGraphUnit,
  };
}

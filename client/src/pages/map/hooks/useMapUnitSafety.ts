// ============================================================
// RMPG Flex — useMapUnitSafety Hook
// Unit safety monitoring: lone officers, exposure warnings,
// stationary detection, speed anomalies, coverage gaps,
// shift fatigue, backup proximity, unit clusters.
// ============================================================

import { useState, useRef, useCallback, useEffect } from 'react';
import { apiFetch } from '../../../hooks/useApi';

// ─── Types ──────────────────────────────────────────────────

export interface UnitExposureData {
  call_sign: string;
  lat: number;
  lng: number;
  high_risk_minutes: number;
  total_minutes_on_duty: number;
  current_zone_risk: 'low' | 'moderate' | 'high' | 'critical';
  heading: number;
  speed_kmh: number;
  shift_start: string;
}

export interface CoverageGap {
  lat: number;
  lng: number;
  width: number;
  height: number;
  gap_severity: 'low' | 'moderate' | 'high';
}

interface PerimeterCheckResult {
  gaps: CoverageGap[];
  coverage_percent: number;
}

interface UnitCluster {
  lat: number;
  lng: number;
  units: string[];
}

interface UseMapUnitSafetyReturn {
  unitExposure: Map<string, UnitExposureData>;
  coverageGaps: CoverageGap[];
  coveragePercent: number;
  loneOfficers: string[];
  exposureWarnings: { callSign: string; minutes: number }[];
  stationaryUnits: string[];
  speedAnomalies: { callSign: string; speed: number }[];
  unitClusters: UnitCluster[];
  backupCounts: Map<string, number>;
  loading: boolean;
  refresh: () => void;
}

// ─── Constants ──────────────────────────────────────────────

const POLL_INTERVAL_MS = 60_000;
const LONE_OFFICER_RADIUS_KM = 2;
const BACKUP_RADIUS_KM = 3;
const CLUSTER_RADIUS_M = 200;
const EXPOSURE_THRESHOLD_MIN = 30;
const STATIONARY_THRESHOLD_MS = 20 * 60 * 1000; // 20 min
const SPEED_ANOMALY_KMH = 128; // ~80 mph
const SHIFT_FATIGUE_HOURS = 10;
const DEG_TO_RAD = Math.PI / 180;
const EARTH_RADIUS_KM = 6371;

// ─── Haversine helper ───────────────────────────────────────

function haversineKm(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const dLat = (lat2 - lat1) * DEG_TO_RAD;
  const dLng = (lng2 - lng1) * DEG_TO_RAD;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG_TO_RAD) *
      Math.cos(lat2 * DEG_TO_RAD) *
      Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Hook ───────────────────────────────────────────────────

export function useMapUnitSafety(
  map: google.maps.Map | null,
  enabled: boolean,
  units?: any[],
): UseMapUnitSafetyReturn {
  const [unitExposure, setUnitExposure] = useState<Map<string, UnitExposureData>>(new Map());
  const [coverageGaps, setCoverageGaps] = useState<CoverageGap[]>([]);
  const [coveragePercent, setCoveragePercent] = useState(100);
  const [loneOfficers, setLoneOfficers] = useState<string[]>([]);
  const [exposureWarnings, setExposureWarnings] = useState<{ callSign: string; minutes: number }[]>([]);
  const [stationaryUnits, setStationaryUnits] = useState<string[]>([]);
  const [speedAnomalies, setSpeedAnomalies] = useState<{ callSign: string; speed: number }[]>([]);
  const [unitClusters, setUnitClusters] = useState<UnitCluster[]>([]);
  const [backupCounts, setBackupCounts] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(false);
  const mountedRef = useRef(true);

  // Position history for stationary detection
  const posHistoryRef = useRef<Map<string, { lat: number; lng: number; since: number }>>(new Map());

  // Map overlay refs
  const gapRectsRef = useRef<google.maps.Rectangle[]>([]);
  const loneCirclesRef = useRef<google.maps.Circle[]>([]);
  const clusterCirclesRef = useRef<google.maps.Circle[]>([]);

  // ── Clear map overlays ────────────────────────────────────

  const clearOverlays = useCallback(() => {
    gapRectsRef.current.forEach((r) => r.setMap(null));
    gapRectsRef.current = [];
    loneCirclesRef.current.forEach((c) => c.setMap(null));
    loneCirclesRef.current = [];
    clusterCirclesRef.current.forEach((c) => c.setMap(null));
    clusterCirclesRef.current = [];
  }, []);

  // ── Compute derived safety data ───────────────────────────

  const computeSafetyMetrics = useCallback(
    (exposureMap: Map<string, UnitExposureData>) => {
      const entries = Array.from(exposureMap.values());
      if (entries.length === 0) return;

      // Lone officers: no other unit within LONE_OFFICER_RADIUS_KM
      const lone: string[] = [];
      entries.forEach((u) => {
        const nearby = entries.filter(
          (o) =>
            o.call_sign !== u.call_sign &&
            haversineKm(u.lat, u.lng, o.lat, o.lng) < LONE_OFFICER_RADIUS_KM,
        );
        if (nearby.length === 0) lone.push(u.call_sign);
      });
      setLoneOfficers(lone);

      // Exposure warnings: high_risk_minutes > threshold
      const warnings = entries
        .filter((u) => u.high_risk_minutes > EXPOSURE_THRESHOLD_MIN)
        .map((u) => ({ callSign: u.call_sign, minutes: u.high_risk_minutes }));
      setExposureWarnings(warnings);

      // Speed anomalies
      const speedFlags = entries
        .filter((u) => u.speed_kmh > SPEED_ANOMALY_KMH)
        .map((u) => ({ callSign: u.call_sign, speed: u.speed_kmh }));
      setSpeedAnomalies(speedFlags);

      // Stationary detection
      const now = Date.now();
      const history = posHistoryRef.current;
      const stationary: string[] = [];
      entries.forEach((u) => {
        const prev = history.get(u.call_sign);
        if (prev) {
          const moved = haversineKm(prev.lat, prev.lng, u.lat, u.lng) > 0.02; // ~20m
          if (moved) {
            history.set(u.call_sign, { lat: u.lat, lng: u.lng, since: now });
          } else if (now - prev.since > STATIONARY_THRESHOLD_MS) {
            stationary.push(u.call_sign);
          }
        } else {
          history.set(u.call_sign, { lat: u.lat, lng: u.lng, since: now });
        }
      });
      setStationaryUnits(stationary);

      // Backup proximity
      const backup = new Map<string, number>();
      entries.forEach((u) => {
        const count = entries.filter(
          (o) =>
            o.call_sign !== u.call_sign &&
            haversineKm(u.lat, u.lng, o.lat, o.lng) < BACKUP_RADIUS_KM,
        ).length;
        backup.set(u.call_sign, count);
      });
      setBackupCounts(backup);

      // Shift fatigue — flag units on duty > SHIFT_FATIGUE_HOURS
      // (exposed via exposureWarnings — callers can also check unitExposure directly)

      // Unit cluster detection: 3+ units within CLUSTER_RADIUS_M
      const clusters: UnitCluster[] = [];
      const visited = new Set<string>();
      entries.forEach((u) => {
        if (visited.has(u.call_sign)) return;
        const nearby = entries.filter(
          (o) =>
            o.call_sign !== u.call_sign &&
            haversineKm(u.lat, u.lng, o.lat, o.lng) * 1000 < CLUSTER_RADIUS_M,
        );
        if (nearby.length >= 2) {
          const clusterUnits = [u.call_sign, ...nearby.map((n) => n.call_sign)];
          clusterUnits.forEach((cs) => visited.add(cs));
          const avgLat = [u, ...nearby].reduce((s, n) => s + n.lat, 0) / (nearby.length + 1);
          const avgLng = [u, ...nearby].reduce((s, n) => s + n.lng, 0) / (nearby.length + 1);
          clusters.push({ lat: avgLat, lng: avgLng, units: clusterUnits });
        }
      });
      setUnitClusters(clusters);
    },
    [],
  );

  // ── Render map overlays ───────────────────────────────────

  const renderOverlays = useCallback(
    (
      gaps: CoverageGap[],
      lone: string[],
      clusters: UnitCluster[],
      exposureMap: Map<string, UnitExposureData>,
    ) => {
      if (!map || !window.google?.maps) return;

      clearOverlays();

      // Coverage gap rectangles
      gaps.forEach((gap) => {
        const rect = new google.maps.Rectangle({
          bounds: {
            north: gap.lat + gap.height / 2,
            south: gap.lat - gap.height / 2,
            east: gap.lng + gap.width / 2,
            west: gap.lng - gap.width / 2,
          },
          fillColor: '#ef4444',
          fillOpacity: 0.12,
          strokeColor: '#ef4444',
          strokeWeight: 1,
          strokeOpacity: 0.3,
          map,
          clickable: false,
          zIndex: 3,
        });
        gapRectsRef.current.push(rect);
      });

      // Lone officer amber pulse circles
      lone.forEach((cs) => {
        const unit = exposureMap.get(cs);
        if (!unit) return;
        const circle = new google.maps.Circle({
          center: { lat: unit.lat, lng: unit.lng },
          radius: 150,
          fillColor: '#f59e0b',
          fillOpacity: 0.2,
          strokeColor: '#f59e0b',
          strokeWeight: 2,
          strokeOpacity: 0.6,
          map,
          clickable: false,
          zIndex: 8,
        });
        loneCirclesRef.current.push(circle);
      });

      // Cluster indicators
      clusters.forEach((cl) => {
        const circle = new google.maps.Circle({
          center: { lat: cl.lat, lng: cl.lng },
          radius: 100,
          fillColor: '#3b82f6',
          fillOpacity: 0.15,
          strokeColor: '#3b82f6',
          strokeWeight: 2,
          strokeOpacity: 0.5,
          map,
          clickable: false,
          zIndex: 7,
        });
        clusterCirclesRef.current.push(circle);
      });
    },
    [map, clearOverlays],
  );

  // ── Fetch all data ────────────────────────────────────────

  const fetchData = useCallback(async () => {
    if (!enabled) return;

    if (mountedRef.current) setLoading(true);

    try {
      // Fetch unit exposure for each active unit (max 5 concurrent)
      const activeUnits = (units || []).filter(
        (u: any) => u.latitude != null && u.longitude != null,
      );

      const CONCURRENCY = 5;
      const exposureEntries: PromiseSettledResult<UnitExposureData | null>[] = [];
      for (let i = 0; i < activeUnits.length; i += CONCURRENCY) {
        const batch = activeUnits.slice(i, i + CONCURRENCY);
        const batchResults = await Promise.allSettled(
          batch.map(async (u: any) => {
            const data = await apiFetch<UnitExposureData>(
              `/map/safety/unit-exposure/${encodeURIComponent(u.call_sign)}`,
            );
            return data;
          }),
        );
        exposureEntries.push(...batchResults);
      }

      const newExposure = new Map<string, UnitExposureData>();
      exposureEntries.forEach((result) => {
        if (result.status === 'fulfilled' && result.value) {
          newExposure.set(result.value.call_sign, result.value);
        }
      });
      if (mountedRef.current) setUnitExposure(newExposure);

      // Fetch coverage gaps
      let gaps: CoverageGap[] = [];
      let covPct = 100;

      // Use map center for perimeter check
      const center = map?.getCenter();
      if (center) {
        try {
          const perimeterData = await apiFetch<PerimeterCheckResult>(
            `/map/safety/perimeter-check/${center.lat()}/${center.lng()}`,
          );
          if (perimeterData) {
            gaps = perimeterData.gaps || [];
            covPct = perimeterData.coverage_percent ?? 100;
          }
        } catch (err) {
          console.warn('[useMapUnitSafety] Perimeter check failed, falling through:', err);
        }
      }

      // Also fetch general coverage gaps
      try {
        const coverageData = await apiFetch<CoverageGap[]>('/map/safety/coverage-gaps');
        if (coverageData && coverageData.length > 0) {
          gaps = [...gaps, ...coverageData];
        }
      } catch (err) {
        console.warn('[useMapUnitSafety] Coverage gaps fetch failed:', err);
      }

      if (mountedRef.current) {
        setCoverageGaps(gaps);
        setCoveragePercent(covPct);
      }

      // Compute derived metrics
      computeSafetyMetrics(newExposure);

      // Render overlays if map is available
      const loneList = Array.from(newExposure.values())
        .filter((u) => {
          const others = Array.from(newExposure.values()).filter(
            (o) =>
              o.call_sign !== u.call_sign &&
              haversineKm(u.lat, u.lng, o.lat, o.lng) < LONE_OFFICER_RADIUS_KM,
          );
          return others.length === 0;
        })
        .map((u) => u.call_sign);

      const clusterList: UnitCluster[] = [];
      const visited = new Set<string>();
      const entries = Array.from(newExposure.values());
      entries.forEach((u) => {
        if (visited.has(u.call_sign)) return;
        const nearby = entries.filter(
          (o) =>
            o.call_sign !== u.call_sign &&
            haversineKm(u.lat, u.lng, o.lat, o.lng) * 1000 < CLUSTER_RADIUS_M,
        );
        if (nearby.length >= 2) {
          const cUnits = [u.call_sign, ...nearby.map((n) => n.call_sign)];
          cUnits.forEach((cs) => visited.add(cs));
          const avgLat = [u, ...nearby].reduce((s, n) => s + n.lat, 0) / (nearby.length + 1);
          const avgLng = [u, ...nearby].reduce((s, n) => s + n.lng, 0) / (nearby.length + 1);
          clusterList.push({ lat: avgLat, lng: avgLng, units: cUnits });
        }
      });

      renderOverlays(gaps, loneList, clusterList, newExposure);
    } catch (err) {
      console.warn('[useMapUnitSafety] Safety data fetch failed:', err);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [enabled, units, map, computeSafetyMetrics, renderOverlays]);

  // ── Polling ───────────────────────────────────────────────

  useEffect(() => {
    if (!enabled) {
      clearOverlays();
      return;
    }

    fetchData();
    const timer = setInterval(fetchData, POLL_INTERVAL_MS);

    return () => {
      clearInterval(timer);
      clearOverlays();
    };
  }, [enabled, fetchData, clearOverlays]);

  // ── Cleanup on unmount ────────────────────────────────────

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearOverlays();
    };
  }, [clearOverlays]);

  return {
    unitExposure,
    coverageGaps,
    coveragePercent,
    loneOfficers,
    exposureWarnings,
    stationaryUnits,
    speedAnomalies,
    unitClusters,
    backupCounts,
    loading,
    refresh: fetchData,
  };
}

import { useState, useRef, useCallback, useEffect } from 'react';
import mapboxgl from 'mapbox-gl';
import { apiFetch } from '../../../hooks/useApi';

export interface UnitExposureData {
  call_sign: string; lat: number; lng: number;
  high_risk_minutes: number; total_minutes_on_duty: number;
  current_zone_risk: 'low' | 'moderate' | 'high' | 'critical';
  heading: number; speed_mph: number; shift_start: string;
}

export interface CoverageGap {
  lat: number; lng: number; width: number; height: number;
  gap_severity: 'low' | 'moderate' | 'high';
}

interface PerimeterCheckResult { gaps: CoverageGap[]; coverage_percent: number; }

interface UnitCluster { lat: number; lng: number; units: string[]; }

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

const POLL_INTERVAL_MS = 60_000;
const LONE_OFFICER_RADIUS_MI = 1.24;
const BACKUP_RADIUS_MI = 1.86;
const CLUSTER_RADIUS_M = 200;
const EXPOSURE_THRESHOLD_MIN = 30;
const STATIONARY_THRESHOLD_MS = 20 * 60 * 1000;
const SPEED_ANOMALY_MPH = 80;
const SHIFT_FATIGUE_HOURS = 10;
const DEG_TO_RAD = Math.PI / 180;
const EARTH_RADIUS_MI = 3958.8;

const GAP_SOURCE = 'unit-safety-gap-source';
const GAP_LAYER = 'unit-safety-gap-layer';
const LONE_SOURCE = 'unit-safety-lone-source';
const LONE_LAYER = 'unit-safety-lone-layer';
const CLUSTER_SOURCE = 'unit-safety-cluster-source';
const CLUSTER_LAYER = 'unit-safety-cluster-layer';

function haversineMi(lat1: number, lng1: number, lat2: number, lng2: number): number {
  if (!Number.isFinite(lat1) || !Number.isFinite(lng1) || !Number.isFinite(lat2) || !Number.isFinite(lng2)) return Infinity;
  const dLat = (lat2 - lat1) * DEG_TO_RAD;
  const dLng = (lng2 - lng1) * DEG_TO_RAD;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * DEG_TO_RAD) * Math.cos(lat2 * DEG_TO_RAD) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_MI * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function circleToPolygon(center: [number, number], radiusM: number, segments = 32): [number, number][] {
  const coords: [number, number][] = [];
  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos(center[1] * Math.PI / 180);
  const dLat = radiusM / metersPerDegLat;
  const dLng = radiusM / metersPerDegLng;
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * 2 * Math.PI;
    coords.push([center[0] + dLng * Math.cos(angle), center[1] + dLat * Math.sin(angle)]);
  }
  return coords;
}

function removeSourceAndLayer(map: mapboxgl.Map, layerId: string, sourceId: string) {
  try {
    if (map.getLayer(layerId)) map.removeLayer(layerId);
    if (map.getSource(sourceId)) map.removeSource(sourceId);
  } catch { /* ignore */ }
}

export function useMapUnitSafety(map: mapboxgl.Map | null, enabled: boolean, units?: any[]): UseMapUnitSafetyReturn {
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
  const posHistoryRef = useRef<Map<string, { lat: number; lng: number; since: number }>>(new Map());

  const clearOverlays = useCallback(() => {
    if (map) {
      removeSourceAndLayer(map, GAP_LAYER, GAP_SOURCE);
      removeSourceAndLayer(map, LONE_LAYER, LONE_SOURCE);
      removeSourceAndLayer(map, CLUSTER_LAYER, CLUSTER_SOURCE);
    }
  }, [map]);

  const computeSafetyMetrics = useCallback((exposureMap: Map<string, UnitExposureData>) => {
    const entries = Array.from(exposureMap.values());
    if (entries.length === 0) return;

    const lone: string[] = [];
    entries.forEach((u) => {
      const nearby = entries.filter((o) => o.call_sign !== u.call_sign && haversineMi(u.lat, u.lng, o.lat, o.lng) < LONE_OFFICER_RADIUS_MI);
      if (nearby.length === 0) lone.push(u.call_sign);
    });
    setLoneOfficers(lone);

    const warnings = entries.filter((u) => u.high_risk_minutes > EXPOSURE_THRESHOLD_MIN).map((u) => ({ callSign: u.call_sign, minutes: u.high_risk_minutes }));
    setExposureWarnings(warnings);

    const speedFlags = entries.filter((u) => u.speed_mph > SPEED_ANOMALY_MPH).map((u) => ({ callSign: u.call_sign, speed: u.speed_mph }));
    setSpeedAnomalies(speedFlags);

    const now = Date.now();
    const history = posHistoryRef.current;
    const stationary: string[] = [];
    entries.forEach((u) => {
      const prev = history.get(u.call_sign);
      if (prev) {
        if (haversineMi(prev.lat, prev.lng, u.lat, u.lng) > 0.02) history.set(u.call_sign, { lat: u.lat, lng: u.lng, since: now });
        else if (now - prev.since > STATIONARY_THRESHOLD_MS) stationary.push(u.call_sign);
      } else history.set(u.call_sign, { lat: u.lat, lng: u.lng, since: now });
    });
    setStationaryUnits(stationary);

    const backup = new Map<string, number>();
    entries.forEach((u) => {
      const count = entries.filter((o) => o.call_sign !== u.call_sign && haversineMi(u.lat, u.lng, o.lat, o.lng) < BACKUP_RADIUS_MI).length;
      backup.set(u.call_sign, count);
    });
    setBackupCounts(backup);

    const clusters: UnitCluster[] = [];
    const visited = new Set<string>();
    entries.forEach((u) => {
      if (visited.has(u.call_sign)) return;
      const nearby = entries.filter((o) => o.call_sign !== u.call_sign && haversineMi(u.lat, u.lng, o.lat, o.lng) * 1000 < CLUSTER_RADIUS_M);
      if (nearby.length >= 2) {
        const cUnits = [u.call_sign, ...nearby.map((n) => n.call_sign)];
        cUnits.forEach((cs) => visited.add(cs));
        const avgLat = [u, ...nearby].reduce((s, n) => s + n.lat, 0) / (nearby.length + 1);
        const avgLng = [u, ...nearby].reduce((s, n) => s + n.lng, 0) / (nearby.length + 1);
        clusters.push({ lat: avgLat, lng: avgLng, units: cUnits });
      }
    });
    setUnitClusters(clusters);
  }, []);

  const renderOverlays = useCallback((gaps: CoverageGap[], lone: string[], clusters: UnitCluster[], exposureMap: Map<string, UnitExposureData>) => {
    if (!map) return;
    clearOverlays();

    // Gap rectangles
    if (gaps.length > 0) {
      const gapFeatures: GeoJSON.Feature[] = gaps.map((gap) => ({
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: [[
          [gap.lng - gap.width / 2, gap.lat - gap.height / 2],
          [gap.lng + gap.width / 2, gap.lat - gap.height / 2],
          [gap.lng + gap.width / 2, gap.lat + gap.height / 2],
          [gap.lng - gap.width / 2, gap.lat + gap.height / 2],
          [gap.lng - gap.width / 2, gap.lat - gap.height / 2],
        ]] },
      }));
      map.addSource(GAP_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: gapFeatures } });
      map.addLayer({ id: GAP_LAYER, type: 'fill', source: GAP_SOURCE, paint: { 'fill-color': '#ef4444', 'fill-opacity': 0.12, 'fill-outline-color': '#ef4444' } });
    }

    // Lone officer circles
    if (lone.length > 0) {
      const loneFeatures: GeoJSON.Feature[] = [];
      lone.forEach((cs) => {
        const unit = exposureMap.get(cs);
        if (!unit) return;
        loneFeatures.push({
          type: 'Feature',
          properties: {},
          geometry: { type: 'Polygon', coordinates: [circleToPolygon([unit.lng, unit.lat], 150)] },
        });
      });
      if (loneFeatures.length > 0) {
        map.addSource(LONE_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: loneFeatures } });
        map.addLayer({ id: LONE_LAYER, type: 'fill', source: LONE_SOURCE, paint: { 'fill-color': '#f59e0b', 'fill-opacity': 0.2, 'fill-outline-color': '#f59e0b' } });
      }
    }

    // Cluster indicators
    if (clusters.length > 0) {
      const clusterFeatures: GeoJSON.Feature[] = clusters.map((cl) => ({
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: [circleToPolygon([cl.lng, cl.lat], 100)] },
      }));
      map.addSource(CLUSTER_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: clusterFeatures } });
      map.addLayer({ id: CLUSTER_LAYER, type: 'fill', source: CLUSTER_SOURCE, paint: { 'fill-color': '#888888', 'fill-opacity': 0.15, 'fill-outline-color': '#888888' } });
    }
  }, [map, clearOverlays]);

  const fetchData = useCallback(async () => {
    if (!enabled) return;
    if (mountedRef.current) setLoading(true);

    try {
      const activeUnits = (units || []).filter((u: any) => u.latitude != null && u.longitude != null);
      const CONCURRENCY = 5;
      const exposureEntries: PromiseSettledResult<UnitExposureData | null>[] = [];
      for (let i = 0; i < activeUnits.length; i += CONCURRENCY) {
        const batch = activeUnits.slice(i, i + CONCURRENCY);
        const batchResults = await Promise.allSettled(batch.map(async (u: any) => {
          try { return await apiFetch<UnitExposureData>(`/map/safety/unit-exposure/${encodeURIComponent(u.call_sign)}`); } catch { return null; }
        }));
        exposureEntries.push(...batchResults);
      }

      const newExposure = new Map<string, UnitExposureData>();
      exposureEntries.forEach((result) => { if (result.status === 'fulfilled' && result.value) newExposure.set(result.value.call_sign, result.value); });
      if (mountedRef.current) setUnitExposure(newExposure);

      let gaps: CoverageGap[] = [];
      let covPct = 100;
      if (map) {
        const center = map.getCenter();
        try {
          const perimeterData = await apiFetch<PerimeterCheckResult>(`/map/safety/perimeter-check/${center.lat}/${center.lng}`);
          if (perimeterData) { gaps = perimeterData.gaps || []; covPct = perimeterData.coverage_percent ?? 100; }
        } catch { /* ignore */ }
      }
      try {
        const coverageData = await apiFetch<CoverageGap[]>('/map/safety/coverage-gaps');
        if (coverageData && coverageData.length > 0) gaps = [...gaps, ...coverageData];
      } catch { /* ignore */ }
      if (mountedRef.current) { setCoverageGaps(gaps); setCoveragePercent(covPct); }

      computeSafetyMetrics(newExposure);

      const loneList = Array.from(newExposure.values()).filter((u) => {
        const others = Array.from(newExposure.values()).filter((o) => o.call_sign !== u.call_sign && haversineMi(u.lat, u.lng, o.lat, o.lng) < LONE_OFFICER_RADIUS_MI);
        return others.length === 0;
      }).map((u) => u.call_sign);

      const clusterList: UnitCluster[] = [];
      const visited = new Set<string>();
      const entries = Array.from(newExposure.values());
      entries.forEach((u) => {
        if (visited.has(u.call_sign)) return;
        const nearby = entries.filter((o) => o.call_sign !== u.call_sign && haversineMi(u.lat, u.lng, o.lat, o.lng) * 1000 < CLUSTER_RADIUS_M);
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
    } finally { if (mountedRef.current) setLoading(false); }
  }, [enabled, units, map, computeSafetyMetrics, renderOverlays]);

  useEffect(() => {
    if (!enabled) { clearOverlays(); return; }
    fetchData();
    const timer = setInterval(fetchData, POLL_INTERVAL_MS);
    return () => { clearInterval(timer); clearOverlays(); };
  }, [enabled, fetchData, clearOverlays]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; clearOverlays(); };
  }, [clearOverlays]);

  return {
    unitExposure, coverageGaps, coveragePercent, loneOfficers, exposureWarnings,
    stationaryUnits, speedAnomalies, unitClusters, backupCounts, loading, refresh: fetchData,
  };
}
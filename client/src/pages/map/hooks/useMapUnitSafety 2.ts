import { useState, useRef, useCallback, useEffect } from 'react';
import mapboxgl from 'mapbox-gl';
import { apiFetch } from '../../../hooks/useApi';

export interface UnitExposureData {
  call_sign: string;
  lat: number;
  lng: number;
  high_risk_minutes: number;
  total_minutes_on_duty: number;
  current_zone_risk: 'low' | 'moderate' | 'high' | 'critical';
  heading: number;
  speed_mph: number;
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

function haversineMi(lat1: number, lng1: number, lat2: number, lng2: number): number {
  if (!Number.isFinite(lat1) || !Number.isFinite(lng1) || !Number.isFinite(lat2) || !Number.isFinite(lng2)) return Infinity;
  const dLat = (lat2 - lat1) * DEG_TO_RAD;
  const dLng = (lng2 - lng1) * DEG_TO_RAD;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * DEG_TO_RAD) * Math.cos(lat2 * DEG_TO_RAD) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_MI * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function useMapUnitSafety(
  map: mapboxgl.Map | null,
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

  const posHistoryRef = useRef<Map<string, { lat: number; lng: number; since: number }>>(new Map());

  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const loneSourceId = 'safety-lone-officers';
  const clusterSourceId = 'safety-unit-clusters';
  const gapSourceId = 'safety-coverage-gaps';

  const clearOverlays = useCallback(() => {
    if (!map) return;
    [loneSourceId, clusterSourceId, gapSourceId].forEach(id => {
      if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource(id)) map.removeSource(id);
    });
  }, [map]);

  const computeSafetyMetrics = useCallback((exposureMap: Map<string, UnitExposureData>) => {
    const entries = Array.from(exposureMap.values());
    if (entries.length === 0) return;

    const lone: string[] = [];
    entries.forEach((u) => {
      const nearby = entries.filter(o => o.call_sign !== u.call_sign && haversineMi(u.lat, u.lng, o.lat, o.lng) < LONE_OFFICER_RADIUS_MI);
      if (nearby.length === 0) lone.push(u.call_sign);
    });
    setLoneOfficers(lone);

    const warnings = entries.filter(u => u.high_risk_minutes > EXPOSURE_THRESHOLD_MIN).map(u => ({ callSign: u.call_sign, minutes: u.high_risk_minutes }));
    setExposureWarnings(warnings);

    const speedFlags = entries.filter(u => u.speed_mph > SPEED_ANOMALY_MPH).map(u => ({ callSign: u.call_sign, speed: u.speed_mph }));
    setSpeedAnomalies(speedFlags);

    const now = Date.now();
    const history = posHistoryRef.current;
    const stationary: string[] = [];
    entries.forEach((u) => {
      const prev = history.get(u.call_sign);
      if (prev) {
        const moved = haversineMi(prev.lat, prev.lng, u.lat, u.lng) > 0.02;
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

    const backup = new Map<string, number>();
    entries.forEach((u) => {
      const count = entries.filter(o => o.call_sign !== u.call_sign && haversineMi(u.lat, u.lng, o.lat, o.lng) < BACKUP_RADIUS_MI).length;
      backup.set(u.call_sign, count);
    });
    setBackupCounts(backup);

    const clusters: UnitCluster[] = [];
    const visited = new Set<string>();
    entries.forEach((u) => {
      if (visited.has(u.call_sign)) return;
      const nearby = entries.filter(o => o.call_sign !== u.call_sign && haversineMi(u.lat, u.lng, o.lat, o.lng) * 1000 < CLUSTER_RADIUS_M);
      if (nearby.length >= 2) {
        const clusterUnits = [u.call_sign, ...nearby.map(n => n.call_sign)];
        clusterUnits.forEach(cs => visited.add(cs));
        const avgLat = [u, ...nearby].reduce((s, n) => s + n.lat, 0) / (nearby.length + 1);
        const avgLng = [u, ...nearby].reduce((s, n) => s + n.lng, 0) / (nearby.length + 1);
        clusters.push({ lat: avgLat, lng: avgLng, units: clusterUnits });
      }
    });
    setUnitClusters(clusters);
  }, []);

  const renderOverlays = useCallback((gaps: CoverageGap[], lone: string[], clusters: UnitCluster[], exposureMap: Map<string, UnitExposureData>) => {
    if (!map) return;
    clearOverlays();

    if (!popupRef.current) {
      popupRef.current = new mapboxgl.Popup({ maxWidth: '320px', closeButton: true, closeOnClick: false });
    }

    const loneFeatures: any[] = [];
    lone.forEach((cs) => {
      const unit = exposureMap.get(cs);
      if (!unit) return;
      loneFeatures.push({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [unit.lng, unit.lat] as [number, number] },
        properties: { call_sign: cs },
      });
    });

    if (loneFeatures.length > 0) {
      map.addSource(loneSourceId, { type: 'geojson', data: { type: 'FeatureCollection', features: loneFeatures } });
      map.addLayer({
        id: loneSourceId,
        type: 'circle',
        source: loneSourceId,
        paint: {
          'circle-color': '#f59e0b',
          'circle-radius': 150,
          'circle-opacity': 0.2,
          'circle-stroke-color': '#f59e0b',
          'circle-stroke-width': 2,
          'circle-stroke-opacity': 0.6,
        },
      });

      map.on('click', loneSourceId, (e) => {
        const feature = e.features?.[0];
        if (!feature || !feature.properties) return;
        const html = `<div style="font-family:monospace;font-size:11px;color:#e0e0e0;background:#050505;padding:10px 12px;border-radius:4px;border:1px solid #f59e0b40"><div style="font-weight:bold;font-size:12px;color:#f59e0b;margin-bottom:4px">Lone Officer — ${feature.properties.call_sign}</div><div style="font-size:9px;color:#9ca3af">No backup within ${LONE_OFFICER_RADIUS_MI} mi</div></div>`;
        if (popupRef.current) popupRef.current.setLngLat(e.lngLat).setHTML(html).addTo(map);
      });
    }

    const clusterFeatures: any[] = [];
    clusters.forEach((cl) => {
      clusterFeatures.push({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [cl.lng, cl.lat] as [number, number] },
        properties: { units: cl.units.join(', '), count: cl.units.length },
      });
    });

    if (clusterFeatures.length > 0) {
      map.addSource(clusterSourceId, { type: 'geojson', data: { type: 'FeatureCollection', features: clusterFeatures } });
      map.addLayer({
        id: clusterSourceId,
        type: 'circle',
        source: clusterSourceId,
        paint: {
          'circle-color': '#888888',
          'circle-radius': 100,
          'circle-opacity': 0.15,
          'circle-stroke-color': '#888888',
          'circle-stroke-width': 2,
          'circle-stroke-opacity': 0.5,
        },
      });

      map.on('click', clusterSourceId, (e) => {
        const feature = e.features?.[0];
        if (!feature || !feature.properties) return;
        const html = `<div style="font-family:monospace;font-size:11px;color:#e0e0e0;background:#050505;padding:10px 12px;border-radius:4px;border:1px solid #88888840"><div style="font-weight:bold;font-size:12px;color:#888888;margin-bottom:4px">Unit Cluster</div><div style="font-size:9px;color:#9ca3af">${feature.properties.count} units: ${feature.properties.units}</div></div>`;
        if (popupRef.current) popupRef.current.setLngLat(e.lngLat).setHTML(html).addTo(map);
      });
    }

    const gapFeatures: any[] = [];
    gaps.forEach((gap) => {
      gapFeatures.push({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [gap.lng, gap.lat] as [number, number] },
        properties: { severity: gap.gap_severity },
      });
    });

    if (gapFeatures.length > 0) {
      map.addSource(gapSourceId, { type: 'geojson', data: { type: 'FeatureCollection', features: gapFeatures } });
      map.addLayer({
        id: gapSourceId,
        type: 'circle',
        source: gapSourceId,
        paint: {
          'circle-color': '#ef4444',
          'circle-radius': ['case', ['==', ['get', 'severity'], 'high'], 200, ['==', ['get', 'severity'], 'moderate'], 150, 100],
          'circle-opacity': 0.12,
          'circle-stroke-color': '#ef4444',
          'circle-stroke-width': 1,
          'circle-stroke-opacity': 0.3,
        },
      });
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
          const data = await apiFetch<UnitExposureData>(`/map/safety/unit-exposure/${encodeURIComponent(u.call_sign)}`);
          return data;
        }));
        exposureEntries.push(...batchResults);
      }

      const newExposure = new Map<string, UnitExposureData>();
      exposureEntries.forEach((result) => {
        if (result.status === 'fulfilled' && result.value) newExposure.set(result.value.call_sign, result.value);
      });
      if (mountedRef.current) setUnitExposure(newExposure);

      let gaps: CoverageGap[] = [];
      let covPct = 100;
      const center = map?.getCenter();
      if (center) {
        try {
          const perimeterData = await apiFetch<PerimeterCheckResult>(`/map/safety/perimeter-check/${center.lat}/${center.lng}`);
          if (perimeterData) {
            gaps = perimeterData.gaps || [];
            covPct = perimeterData.coverage_percent ?? 100;
          }
        } catch (err) {
          console.warn('[useMapUnitSafety] Perimeter check failed:', err);
        }
      }

      try {
        const coverageData = await apiFetch<CoverageGap[]>('/map/safety/coverage-gaps');
        if (coverageData && coverageData.length > 0) gaps = [...gaps, ...coverageData];
      } catch (err) {
        console.warn('[useMapUnitSafety] Coverage gaps fetch failed:', err);
      }

      if (mountedRef.current) {
        setCoverageGaps(gaps);
        setCoveragePercent(covPct);
      }

      computeSafetyMetrics(newExposure);

      const loneList = Array.from(newExposure.values()).filter(u => {
        const others = Array.from(newExposure.values()).filter(o => o.call_sign !== u.call_sign && haversineMi(u.lat, u.lng, o.lat, o.lng) < LONE_OFFICER_RADIUS_MI);
        return others.length === 0;
      }).map(u => u.call_sign);

      const clusterList: UnitCluster[] = [];
      const visited = new Set<string>();
      const entries = Array.from(newExposure.values());
      entries.forEach((u) => {
        if (visited.has(u.call_sign)) return;
        const nearby = entries.filter(o => o.call_sign !== u.call_sign && haversineMi(u.lat, u.lng, o.lat, o.lng) * 1000 < CLUSTER_RADIUS_M);
        if (nearby.length >= 2) {
          const cUnits = [u.call_sign, ...nearby.map(n => n.call_sign)];
          cUnits.forEach(cs => visited.add(cs));
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

  useEffect(() => {
    if (!enabled) {
      clearOverlays();
      return;
    }
    fetchData();
    const timer = setInterval(fetchData, POLL_INTERVAL_MS);
    return () => { clearInterval(timer); clearOverlays(); };
  }, [enabled, fetchData, clearOverlays]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; clearOverlays(); };
  }, [clearOverlays]);

  useEffect(() => {
    return () => {
      if (popupRef.current) { popupRef.current.remove(); popupRef.current = null; }
    };
  }, []);

  return { unitExposure, coverageGaps, coveragePercent, loneOfficers, exposureWarnings, stationaryUnits, speedAnomalies, unitClusters, backupCounts, loading, refresh: fetchData };
}

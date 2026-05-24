import { useRef, useState, useCallback, useEffect } from 'react';
import mapboxgl from 'mapbox-gl';
import { getMapboxToken } from '../utils/mapboxClient';

export interface UnitRoute {
  unitCallSign: string;
  callNumber: string;
  eta: string;
  distance: string;
  durationSec: number;
  distanceMeters: number;
  color: string;
}

interface UseMultiUnitRoutingOptions {
  map: mapboxgl.Map | null;
}

const REROUTE_THROTTLE_MS = 30_000;
const REROUTE_DISTANCE_THRESHOLD = 100;

const COLOR_FASTEST = '#22c55e';
const COLOR_MID = '#eab308';
const COLOR_SLOWEST = '#ef4444';

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  if (!Number.isFinite(lat1) || !Number.isFinite(lng1) || !Number.isFinite(lat2) || !Number.isFinite(lng2)) return Infinity;
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function parseDuration(seconds: number): string {
  if (seconds < 60) return '<1 min';
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function parseDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

interface RouteState {
  lastOrigin: { lat: number; lng: number };
  lastQueryTime: number;
  destination: { lat: number; lng: number };
  callNumber: string;
  durationSec: number;
}

function assignColors(statesByCallSign: Map<string, RouteState>): Map<string, string> {
  const colors = new Map<string, string>();
  const sorted = [...statesByCallSign.entries()].sort(
    (a, b) => a[1].durationSec - b[1].durationSec,
  );
  if (sorted.length === 0) return colors;
  if (sorted.length === 1) {
    colors.set(sorted[0][0], COLOR_FASTEST);
    return colors;
  }
  if (sorted.length === 2) {
    colors.set(sorted[0][0], COLOR_FASTEST);
    colors.set(sorted[1][0], COLOR_SLOWEST);
    return colors;
  }
  sorted.forEach(([callSign], idx) => {
    if (idx === 0) colors.set(callSign, COLOR_FASTEST);
    else if (idx === sorted.length - 1) colors.set(callSign, COLOR_SLOWEST);
    else colors.set(callSign, COLOR_MID);
  });
  return colors;
}

export function useMultiUnitRouting({ map }: UseMultiUnitRoutingOptions) {
  const [activeRoutes, setActiveRoutes] = useState<UnitRoute[]>([]);
  const [routeLoading, setRouteLoading] = useState(false);

  const statesRef = useRef<Map<string, RouteState>>(new Map());

  const ensureUnitLayer = useCallback((callSign: string) => {
    if (!map) return;
    const sourceId = `route-unit-${callSign}`;
    const layerId = `route-line-unit-${callSign}`;
    if (!map.getSource(sourceId)) {
      map.addSource(sourceId, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
    }
    if (!map.getLayer(layerId)) {
      map.addLayer({
        id: layerId,
        type: 'line',
        source: sourceId,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': COLOR_FASTEST,
          'line-width': 4,
          'line-opacity': 0.85,
        },
      });
    }
  }, [map]);

  const removeUnitLayer = useCallback((callSign: string) => {
    if (!map) return;
    const sourceId = `route-unit-${callSign}`;
    const layerId = `route-line-unit-${callSign}`;
    try { if (map.getLayer(layerId)) map.removeLayer(layerId); } catch { /* ignore */ }
    try { if (map.getSource(sourceId)) map.removeSource(sourceId); } catch { /* ignore */ }
  }, [map]);

  const recolorLayers = useCallback(() => {
    if (!map) return;
    for (const [callSign] of statesRef.current.entries()) {
      const layerId = `route-line-unit-${callSign}`;
      if (!map.getLayer(layerId)) continue;
    }
  }, [map]);

  const refreshActive = useCallback(() => {
    const colors = assignColors(statesRef.current);
    const next: UnitRoute[] = [];
    for (const [callSign, st] of statesRef.current.entries()) {
      const color = colors.get(callSign) || COLOR_FASTEST;
      const layerId = `route-line-unit-${callSign}`;
      if (map && map.getLayer(layerId)) {
        map.setPaintProperty(layerId, 'line-color', color);
      }
      next.push({
        unitCallSign: callSign,
        callNumber: st.callNumber,
        eta: '—',
        distance: '—',
        durationSec: st.durationSec,
        distanceMeters: 0,
        color,
      });
    }
    setActiveRoutes(next);
  }, [map]);

  const queryOne = useCallback(
    async (
      callSign: string,
      callNumber: string,
      origin: { lat: number; lng: number },
      destination: { lat: number; lng: number },
    ) => {
      if (!map) return;
      setRouteLoading(true);
      try {
        const token = await getMapboxToken();
        if (!token) {
          console.warn('[useMultiUnitRouting] No Mapbox token available');
          return;
        }

        const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${origin.lng},${origin.lat};${destination.lng},${destination.lat}?access_token=${token}&geometries=geojson&overview=full&steps=true&traffic=true`;

        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`Directions HTTP ${resp.status}`);
        const data = await resp.json();

        if (!data.routes?.length) return;
        const route = data.routes[0];
        const leg = route.legs?.[0];
        if (!leg) return;

        ensureUnitLayer(callSign);

        const sourceId = `route-unit-${callSign}`;
        const geojsonSource = map.getSource(sourceId) as mapboxgl.GeoJSONSource;
        if (geojsonSource) {
          geojsonSource.setData({
            type: 'Feature',
            geometry: route.geometry,
            properties: {},
          });
        }

        let st = statesRef.current.get(callSign);
        if (!st) {
          st = {
            lastOrigin: origin,
            lastQueryTime: 0,
            destination,
            callNumber,
            durationSec: 0,
          };
          statesRef.current.set(callSign, st);
        }
        st.lastOrigin = origin;
        st.lastQueryTime = Date.now();
        st.destination = destination;
        st.callNumber = callNumber;
        st.durationSec = leg.duration || 0;

        const colors = assignColors(statesRef.current);
        const next: UnitRoute[] = [];
        for (const [cs, s] of statesRef.current.entries()) {
          const color = colors.get(cs) || COLOR_FASTEST;
          const lid = `route-line-unit-${cs}`;
          if (map.getLayer(lid)) {
            map.setPaintProperty(lid, 'line-color', color);
          }
          if (cs === callSign) {
            next.push({
              unitCallSign: cs,
              callNumber: s.callNumber,
              eta: parseDuration(leg.duration || 0),
              distance: parseDistance(leg.distance || 0),
              durationSec: s.durationSec,
              distanceMeters: leg.distance || 0,
              color,
            });
          } else {
            const prev = activeRoutes.find((r) => r.unitCallSign === cs);
            next.push({
              unitCallSign: cs,
              callNumber: s.callNumber,
              eta: prev?.eta || '—',
              distance: prev?.distance || '—',
              durationSec: s.durationSec,
              distanceMeters: prev?.distanceMeters || 0,
              color,
            });
          }
        }
        setActiveRoutes(next);
      } catch (err) {
        console.warn('[useMultiUnitRouting] Directions query failed:', err);
      } finally {
        setRouteLoading(false);
      }
    },
    [map, ensureUnitLayer, activeRoutes],
  );

  const showRoute = useCallback(
    (
      unitCallSign: string,
      callNumber: string,
      unitLat: number,
      unitLng: number,
      callLat: number,
      callLng: number,
    ) => {
      return queryOne(
        unitCallSign,
        callNumber,
        { lat: unitLat, lng: unitLng },
        { lat: callLat, lng: callLng },
      );
    },
    [queryOne],
  );

  const updateOrigin = useCallback(
    (unitCallSign: string, newLat: number, newLng: number) => {
      const st = statesRef.current.get(unitCallSign);
      if (!st) return;
      const elapsed = Date.now() - st.lastQueryTime;
      if (elapsed < REROUTE_THROTTLE_MS) return;
      const moved = haversineMeters(st.lastOrigin.lat, st.lastOrigin.lng, newLat, newLng);
      if (moved < REROUTE_DISTANCE_THRESHOLD) return;
      queryOne(unitCallSign, st.callNumber, { lat: newLat, lng: newLng }, st.destination);
    },
    [queryOne],
  );

  const removeRoute = useCallback(
    (unitCallSign: string) => {
      const st = statesRef.current.get(unitCallSign);
      if (!st) return;
      removeUnitLayer(unitCallSign);
      statesRef.current.delete(unitCallSign);
      refreshActive();
    },
    [refreshActive, removeUnitLayer],
  );

  const clearAllRoutes = useCallback(() => {
    for (const callSign of statesRef.current.keys()) {
      removeUnitLayer(callSign);
    }
    statesRef.current.clear();
    setActiveRoutes([]);
  }, [removeUnitLayer]);

  useEffect(() => {
    return () => {
      for (const callSign of statesRef.current.keys()) {
        removeUnitLayer(callSign);
      }
      statesRef.current.clear();
    };
  }, [removeUnitLayer]);

  return {
    activeRoutes,
    routeLoading,
    showRoute,
    updateOrigin,
    removeRoute,
    clearAllRoutes,
  };
}

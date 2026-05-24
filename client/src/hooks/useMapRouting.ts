import { useRef, useState, useCallback, useEffect } from 'react';
import mapboxgl from 'mapbox-gl';
import { getMapboxToken } from '../utils/mapboxClient';

export interface RouteInfo {
  unitCallSign: string;
  callNumber: string;
  eta: string;
  distance: string;
  durationSec: number;
  distanceMeters: number;
}

interface UseMapRoutingOptions {
  map: mapboxgl.Map | null;
}

function haversineMeters(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  if (!Number.isFinite(lat1) || !Number.isFinite(lng1) || !Number.isFinite(lat2) || !Number.isFinite(lng2)) return Infinity;
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const REROUTE_THROTTLE_MS = 30_000;
const REROUTE_DISTANCE_THRESHOLD = 100;
const ROUTE_COLOR = '#888888';

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

const SOURCE_ID = 'route-source';
const LAYER_ID = 'route-line';

export function useMapRouting({ map }: UseMapRoutingOptions) {
  const [activeRoute, setActiveRoute] = useState<RouteInfo | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);

  const lastOriginRef = useRef<{ lat: number; lng: number } | null>(null);
  const lastQueryTimeRef = useRef<number>(0);
  const destRef = useRef<{ lat: number; lng: number } | null>(null);
  const metaRef = useRef<{ unitCallSign: string; callNumber: string }>({
    unitCallSign: '',
    callNumber: '',
  });
  const popupRef = useRef<mapboxgl.Popup | null>(null);

  const ensureRouteLayer = useCallback(() => {
    if (!map) return;
    if (!map.getSource(SOURCE_ID)) {
      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
    }
    if (!map.getLayer(LAYER_ID)) {
      map.addLayer({
        id: LAYER_ID,
        type: 'line',
        source: SOURCE_ID,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': ROUTE_COLOR,
          'line-width': 4,
          'line-opacity': 0.8,
        },
      });
    }
  }, [map]);

  const removeRouteLayer = useCallback(() => {
    if (!map) return;
    try {
      if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
    } catch { /* ignore */ }
    try {
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
    } catch { /* ignore */ }
    if (popupRef.current) {
      popupRef.current.remove();
      popupRef.current = null;
    }
  }, [map]);

  const queryRoute = useCallback(
    async (
      origin: { lat: number; lng: number },
      destination: { lat: number; lng: number },
    ): Promise<RouteInfo | null> => {
      if (!map) return null;

      setRouteLoading(true);

      try {
        const token = await getMapboxToken();
        if (!token) {
          console.warn('[useMapRouting] No Mapbox token available');
          return null;
        }

        const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${origin.lng},${origin.lat};${destination.lng},${destination.lat}?access_token=${token}&geometries=geojson&overview=full&steps=true&traffic=true`;

        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`Directions HTTP ${resp.status}`);
        const data = await resp.json();

        if (!data.routes?.length) throw new Error('No route found');

        const route = data.routes[0];
        const leg = route.legs?.[0];
        if (!leg) return null;

        const durationSec = leg.duration || 0;
        const distanceMeters = leg.distance || 0;

        ensureRouteLayer();

        const geojsonSource = map.getSource(SOURCE_ID) as mapboxgl.GeoJSONSource;
        if (geojsonSource) {
          geojsonSource.setData({
            type: 'Feature',
            geometry: route.geometry,
            properties: {},
          });
        }

        const info: RouteInfo = {
          unitCallSign: metaRef.current.unitCallSign,
          callNumber: metaRef.current.callNumber,
          eta: parseDuration(durationSec),
          distance: parseDistance(distanceMeters),
          durationSec,
          distanceMeters,
        };

        lastOriginRef.current = origin;
        lastQueryTimeRef.current = Date.now();

        setActiveRoute(info);

        if (popupRef.current) popupRef.current.remove();
        popupRef.current = new mapboxgl.Popup({ closeButton: true })
          .setLngLat([destination.lng, destination.lat])
          .setHTML(`<div style="font-family:'Courier New',monospace;color:#d4d4d4;font-size:11px;min-width:120px;">
            <div style="font-weight:bold;color:#fff;margin-bottom:2px;">${info.unitCallSign}</div>
            <div style="color:#888;font-size:10px;">${info.eta} &middot; ${info.distance}</div>
          </div>`)
          .addTo(map);

        return info;
      } catch (err) {
        console.warn('[useMapRouting] Directions query failed:', err);
        return null;
      } finally {
        setRouteLoading(false);
      }
    },
    [map, ensureRouteLayer],
  );

  const showRoute = useCallback(
    async (
      unitCallSign: string,
      callNumber: string,
      unitLat: number,
      unitLng: number,
      callLat: number,
      callLng: number,
    ) => {
      metaRef.current = { unitCallSign, callNumber };
      destRef.current = { lat: callLat, lng: callLng };
      return queryRoute(
        { lat: unitLat, lng: unitLng },
        { lat: callLat, lng: callLng },
      );
    },
    [queryRoute],
  );

  const clearRoute = useCallback(() => {
    removeRouteLayer();
    setActiveRoute(null);
    lastOriginRef.current = null;
    destRef.current = null;
    metaRef.current = { unitCallSign: '', callNumber: '' };
  }, [removeRouteLayer]);

  const updateOrigin = useCallback(
    (newLat: number, newLng: number) => {
      if (!destRef.current || !lastOriginRef.current) return;

      const elapsed = Date.now() - lastQueryTimeRef.current;
      if (elapsed < REROUTE_THROTTLE_MS) return;

      const moved = haversineMeters(
        lastOriginRef.current.lat,
        lastOriginRef.current.lng,
        newLat,
        newLng,
      );
      if (moved < REROUTE_DISTANCE_THRESHOLD) return;

      queryRoute({ lat: newLat, lng: newLng }, destRef.current);
    },
    [queryRoute],
  );

  useEffect(() => {
    return () => {
      removeRouteLayer();
    };
  }, [removeRouteLayer]);

  return {
    activeRoute,
    routeLoading,
    showRoute,
    clearRoute,
    updateOrigin,
  };
}

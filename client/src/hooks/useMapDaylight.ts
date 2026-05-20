// ============================================================
// RMPG Flex — useMapDaylight Hook
// ============================================================
// Day/night terminator overlay for the Mapbox map. Replaces
// the Google Maps DayNightOverlay. Shows the current solar
// terminator line and shades the night side of the earth.
// Useful for dispatchers coordinating across time zones or
// evaluating lighting conditions at a call location.
// ============================================================

import { useRef, useState, useCallback, useEffect } from 'react';
import mapboxgl from 'mapbox-gl';
import { devLog } from '../utils/devLog';

// ── Types ─────────────────────────────────────────────────

export interface UseMapDaylightResult {
  enabled: boolean;
  toggle: () => void;
  setEnabled: (v: boolean) => void;
}

// ── Constants ─────────────────────────────────────────────

const DAYLIGHT_SOURCE = 'rmpg-daylight';
const DAYLIGHT_FILL = 'rmpg-daylight-fill';
const DAYLIGHT_LINE = 'rmpg-daylight-line';
const UPDATE_INTERVAL_MS = 60_000; // update every minute

// ── Solar math (simplified) ──────────────────────────────

/** Calculate the solar declination angle for a given date. */
function solarDeclination(date: Date): number {
  const dayOfYear = Math.floor(
    (date.getTime() - new Date(date.getFullYear(), 0, 0).getTime()) / 86400000
  );
  return -23.44 * Math.cos((2 * Math.PI * (dayOfYear + 10)) / 365);
}

/** Calculate the sub-solar longitude (where the sun is directly overhead). */
function subSolarLongitude(date: Date): number {
  const hours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  return -((hours / 24) * 360 - 180);
}

/**
 * Generate the day/night terminator polygon.
 * Returns a GeoJSON polygon covering the night side of the earth.
 */
function generateTerminatorPolygon(date: Date): GeoJSON.Feature {
  const decl = solarDeclination(date) * (Math.PI / 180);
  const subLng = subSolarLongitude(date);

  // Generate terminator line points
  const terminatorPoints: [number, number][] = [];
  for (let lng = -180; lng <= 180; lng += 2) {
    const lngRad = (lng - subLng) * (Math.PI / 180);
    const latRad = Math.atan(-Math.cos(lngRad) / Math.tan(decl));
    const lat = latRad * (180 / Math.PI);
    terminatorPoints.push([lng, lat]);
  }

  // Determine which pole is in darkness
  // If declination is positive (summer in northern hemisphere), south pole is dark
  const darkPole = decl > 0 ? -90 : 90;

  // Build night polygon: terminator line → pole → back
  const nightCoords: [number, number][] = [
    ...terminatorPoints,
    [180, darkPole],
    [-180, darkPole],
    terminatorPoints[0], // close the ring
  ];

  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'Polygon',
      coordinates: [nightCoords],
    },
  };
}

// ── Hook ──────────────────────────────────────────────────

export function useMapDaylight(map: mapboxgl.Map | null, mapLoaded: boolean): UseMapDaylightResult {
  const [enabled, setEnabled] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const updateTerminator = useCallback(() => {
    if (!map || !map.getSource(DAYLIGHT_SOURCE)) return;
    const feature = generateTerminatorPolygon(new Date());
    (map.getSource(DAYLIGHT_SOURCE) as mapboxgl.GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: [feature],
    });
  }, [map]);

  useEffect(() => {
    if (!map || !mapLoaded) return;

    if (!enabled) {
      if (map.getLayer(DAYLIGHT_LINE)) map.removeLayer(DAYLIGHT_LINE);
      if (map.getLayer(DAYLIGHT_FILL)) map.removeLayer(DAYLIGHT_FILL);
      if (map.getSource(DAYLIGHT_SOURCE)) map.removeSource(DAYLIGHT_SOURCE);
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      return;
    }

    const feature = generateTerminatorPolygon(new Date());

    if (!map.getSource(DAYLIGHT_SOURCE)) {
      map.addSource(DAYLIGHT_SOURCE, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [feature] },
      });

      map.addLayer({
        id: DAYLIGHT_FILL,
        type: 'fill',
        source: DAYLIGHT_SOURCE,
        paint: {
          'fill-color': '#000000',
          'fill-opacity': 0.3,
        },
      });

      map.addLayer({
        id: DAYLIGHT_LINE,
        type: 'line',
        source: DAYLIGHT_SOURCE,
        paint: {
          'line-color': '#f59e0b',
          'line-width': 1.5,
          'line-opacity': 0.6,
          'line-dasharray': [4, 2],
        },
      });

      devLog('[Daylight] Terminator overlay added');
    }

    // Update every minute
    timerRef.current = setInterval(updateTerminator, UPDATE_INTERVAL_MS);

    return () => {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      if (map.getLayer(DAYLIGHT_LINE)) map.removeLayer(DAYLIGHT_LINE);
      if (map.getLayer(DAYLIGHT_FILL)) map.removeLayer(DAYLIGHT_FILL);
      if (map.getSource(DAYLIGHT_SOURCE)) map.removeSource(DAYLIGHT_SOURCE);
    };
  }, [map, mapLoaded, enabled, updateTerminator]);

  const toggle = useCallback(() => setEnabled(v => !v), []);

  return { enabled, toggle, setEnabled };
}

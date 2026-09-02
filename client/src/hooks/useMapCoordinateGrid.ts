/**
 * useMapCoordinateGrid — Google Maps coordinate grid/graticule overlay for Mapbox GL.
 *
 * Renders lat/lng grid lines at adaptive intervals based on zoom level.
 * Labels grid lines with degree values. Replaces custom Google Maps
 * OverlayView grid implementations.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import mapboxgl from 'mapbox-gl';
import { hasLayer, hasSource, safeRemoveLayer, safeRemoveSource, getSourceSafe } from '../utils/mapboxSafeLayer';

const SOURCE_ID = 'coord-grid';
const LINE_LAYER = 'coord-grid-lines';
const LABEL_LAYER = 'coord-grid-labels';

function getGridInterval(zoom: number): number {
  if (zoom >= 16) return 0.001;
  if (zoom >= 14) return 0.005;
  if (zoom >= 12) return 0.01;
  if (zoom >= 10) return 0.05;
  if (zoom >= 8) return 0.1;
  if (zoom >= 6) return 0.5;
  if (zoom >= 4) return 1;
  if (zoom >= 2) return 5;
  return 10;
}

function formatDeg(val: number, isLat: boolean): string {
  const dir = isLat ? (val >= 0 ? 'N' : 'S') : (val >= 0 ? 'E' : 'W');
  return `${Math.abs(val).toFixed(val % 1 === 0 ? 0 : 3)}°${dir}`;
}

function buildGridGeoJson(bounds: mapboxgl.LngLatBounds, zoom: number): GeoJSON.FeatureCollection {
  const interval = getGridInterval(zoom);
  const features: GeoJSON.Feature[] = [];

  const west = Math.floor(bounds.getWest() / interval) * interval;
  const east = Math.ceil(bounds.getEast() / interval) * interval;
  const south = Math.floor(bounds.getSouth() / interval) * interval;
  const north = Math.ceil(bounds.getNorth() / interval) * interval;

  // Longitude lines (vertical)
  for (let lng = west; lng <= east; lng += interval) {
    features.push({
      type: 'Feature',
      properties: { label: formatDeg(lng, false), gridType: 'line' },
      geometry: { type: 'LineString', coordinates: [[lng, south], [lng, north]] },
    });
    // Label point at top
    features.push({
      type: 'Feature',
      properties: { label: formatDeg(lng, false), gridType: 'label' },
      geometry: { type: 'Point', coordinates: [lng, north - (north - south) * 0.02] },
    });
  }

  // Latitude lines (horizontal)
  for (let lat = south; lat <= north; lat += interval) {
    features.push({
      type: 'Feature',
      properties: { label: formatDeg(lat, true), gridType: 'line' },
      geometry: { type: 'LineString', coordinates: [[west, lat], [east, lat]] },
    });
    // Label point at left
    features.push({
      type: 'Feature',
      properties: { label: formatDeg(lat, true), gridType: 'label' },
      geometry: { type: 'Point', coordinates: [west + (east - west) * 0.02, lat] },
    });
  }

  return { type: 'FeatureCollection', features };
}

export function useMapCoordinateGrid(
  map: mapboxgl.Map | null,
  mapLoaded: boolean,
) {
  const [enabled, setEnabled] = useState(false);
  const activeRef = useRef(false);

  const updateGrid = useCallback(() => {
    if (!map || !activeRef.current) return;
    const bounds = map.getBounds();
    if (!bounds) return;
    const zoom = map.getZoom();
    const geojson = buildGridGeoJson(bounds, zoom);

    const source = getSourceSafe(map, SOURCE_ID);
    if (source) {
      source.setData(geojson);
    }
  }, [map]);

  const toggle = useCallback(() => {
    if (!map || !mapLoaded) return;

    if (enabled) {
      // Remove
      activeRef.current = false;
      safeRemoveLayer(map, LABEL_LAYER);
      safeRemoveLayer(map, LINE_LAYER);
      safeRemoveSource(map, SOURCE_ID);
      map.off('moveend', updateGrid);
      setEnabled(false);
      return;
    }

    // Add
    activeRef.current = true;
    const bounds = map.getBounds();
    if (!bounds) return;
    const zoom = map.getZoom();
    const geojson = buildGridGeoJson(bounds, zoom);

    if (!hasSource(map, SOURCE_ID)) {
      map.addSource(SOURCE_ID, { type: 'geojson', data: geojson });
    }

    if (!hasLayer(map, LINE_LAYER)) {
      map.addLayer({
        id: LINE_LAYER,
        type: 'line',
        source: SOURCE_ID,
        filter: ['==', ['get', 'gridType'], 'line'],
        paint: {
          'line-color': '#c3ccd6',
          'line-opacity': 0.2,
          'line-width': 0.5,
          'line-dasharray': [4, 4],
        },
      });
    }

    if (!hasLayer(map, LABEL_LAYER)) {
      map.addLayer({
        id: LABEL_LAYER,
        type: 'symbol',
        source: SOURCE_ID,
        filter: ['==', ['get', 'gridType'], 'label'],
        layout: {
          'text-field': ['get', 'label'],
          'text-size': 9,
          'text-allow-overlap': true,
          'text-font': ['DIN Pro Regular', 'Arial Unicode MS Regular'],
        },
        paint: {
          'text-color': '#c3ccd6',
          'text-opacity': 0.5,
          'text-halo-color': '#000',
          'text-halo-width': 1,
        },
      });
    }

    map.on('moveend', updateGrid);
    setEnabled(true);
  }, [map, mapLoaded, enabled, updateGrid]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (!map) return;
      activeRef.current = false;
      map.off('moveend', updateGrid);
      safeRemoveLayer(map, LABEL_LAYER);
      safeRemoveLayer(map, LINE_LAYER);
      safeRemoveSource(map, SOURCE_ID);
    };
  }, [map, updateGrid]);

  return { enabled, toggle };
}

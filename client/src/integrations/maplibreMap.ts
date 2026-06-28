// ============================================================
// RMPG Flex — MapLibre GL Integration
// ============================================================
// Open-source vector tile map engine as an alternative to
// Google Maps. No API key required, supports fully offline
// .mbtiles packages, 3D building extrusion, and custom
// vector tile styling.
//
// NOTE: This does NOT replace the primary Google Maps surface
// (per project rules). It provides an optional secondary
// map surface for scenarios where Google Maps isn't available
// (offline field use, cost reduction, custom vector layers).
// ============================================================

import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

// ── Types ─────────────────────────────────────────────────

export interface MapConfig {
  container: HTMLElement | string;
  center?: [number, number]; // [lng, lat], default SLC
  zoom?: number;
  bearing?: number;
  pitch?: number;
  style?: string | maplibregl.StyleSpecification;
  interactive?: boolean;
}

// ── Dark style (Spillman Flex aesthetic) ───────────────────

const DARK_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  name: 'RMPG Dark',
  sources: {
    'carto-dark': {
      type: 'raster',
      tiles: [
        'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
      ],
      tileSize: 256,
      attribution: '© CartoDB © OpenStreetMap contributors',
    },
  },
  layers: [
    {
      id: 'carto-dark-tiles',
      type: 'raster',
      source: 'carto-dark',
      minzoom: 0,
      maxzoom: 20,
    },
  ],
};

// ── Map factory ───────────────────────────────────────────

/**
 * Create a MapLibre GL map instance with RMPG dark theme.
 * Uses CartoDB dark_matter tiles (same as existing offline tiles).
 */
export function createMap(config: MapConfig): maplibregl.Map {
  const map = new maplibregl.Map({
    container: config.container,
    style: config.style || DARK_STYLE,
    center: config.center || [-111.891, 40.7608], // SLC
    zoom: config.zoom || 12,
    bearing: config.bearing || 0,
    pitch: config.pitch || 0,
    interactive: config.interactive !== false,
    attributionControl: false,
  });

  // Add compact attribution
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

  // Add navigation controls
  map.addControl(new maplibregl.NavigationControl(), 'top-right');

  // Add scale bar
  map.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }), 'bottom-left');

  return map;
}

/**
 * Add a GeoJSON layer to the map (beats, zones, sectors).
 */
export function addGeoJsonLayer(
  map: maplibregl.Map,
  id: string,
  geojson: GeoJSON.FeatureCollection,
  options: {
    type: 'fill' | 'line' | 'circle' | 'symbol';
    paint?: Record<string, unknown>;
    layout?: Record<string, unknown>;
    interactive?: boolean;
  }
): void {
  // Add source
  if (!map.getSource(id)) {
    map.addSource(id, {
      type: 'geojson',
      data: geojson,
    });
  }

  // Add layer
  if (!map.getLayer(id)) {
    map.addLayer({
      id,
      type: options.type,
      source: id,
      paint: options.paint || {},
      layout: options.layout || {},
    } as maplibregl.LayerSpecification);
  }
}

/**
 * Add beat boundary polygons with sector-colored outlines.
 */
export function addBeatBoundaries(
  map: maplibregl.Map,
  beats: GeoJSON.FeatureCollection
): void {
  addGeoJsonLayer(map, 'beat-fills', beats, {
    type: 'fill',
    paint: {
      'fill-color': '#d4a017',
      'fill-opacity': 0.05,
    },
  });

  addGeoJsonLayer(map, 'beat-outlines', beats, {
    type: 'line',
    paint: {
      'line-color': '#d4a017',
      'line-width': 1,
      'line-opacity': 0.4,
    },
  });
}

/**
 * Add unit position markers to the map.
 */
export function addUnitMarkers(
  map: maplibregl.Map,
  units: Array<{ id: number; callsign: string; lat: number; lng: number; status: string }>
): maplibregl.Marker[] {
  return units.map(unit => {
    const color = getStatusColor(unit.status);
    const marker = new maplibregl.Marker({ color })
      .setLngLat([unit.lng, unit.lat])
      .setPopup(new maplibregl.Popup().setHTML(
        `<div style="color:#000"><strong>${unit.callsign}</strong><br>Status: ${unit.status}</div>`
      ))
      .addTo(map);
    return marker;
  });
}

/**
 * Add incident markers to the map.
 */
export function addIncidentMarkers(
  map: maplibregl.Map,
  incidents: Array<{ id: number; type: string; lat: number; lng: number; priority: string }>
): maplibregl.Marker[] {
  return incidents.map(incident => {
    const color = getPriorityColor(incident.priority);
    const marker = new maplibregl.Marker({ color, scale: 0.7 })
      .setLngLat([incident.lng, incident.lat])
      .setPopup(new maplibregl.Popup().setHTML(
        `<div style="color:#000"><strong>${incident.type}</strong><br>Priority: ${incident.priority}</div>`
      ))
      .addTo(map);
    return marker;
  });
}

// ── Helpers ───────────────────────────────────────────────

function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    AVAILABLE: '#00b400',
    DISPATCHED: '#d4a017',
    ENROUTE: '#0078ff',
    ON_SCENE: '#ff0000',
    BUSY: '#ff8c00',
    OUT_OF_SERVICE: '#505050',
  };
  return colors[status] || '#888';
}

function getPriorityColor(priority: string): string {
  const colors: Record<string, string> = {
    '1': '#ff0000',
    '2': '#ff8c00',
    '3': '#d4a017',
    '4': '#666',
    '5': '#444',
  };
  return colors[priority] || '#888';
}

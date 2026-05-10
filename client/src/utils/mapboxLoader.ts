// ============================================================
// RMPG Flex — Mapbox GL Loader & Style System
// ============================================================
// Primary map engine loader using Mapbox GL JS with dark theme
// matching the Spillman Flex aesthetic. Falls back to MapLibre GL
// when no Mapbox access token is configured.
//
// Style philosophy: Pure black (#0a0a0a) base, gold (#d4a017)
// accent — consistent with the rest of the Spillman Flex UI.
// ============================================================

import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

// ── Types ─────────────────────────────────────────────────

export type MapboxStyleId = 'dark' | 'standard' | 'satellite' | 'hybrid' | 'streets' | 'terrain' | 'night_nav' | 'outdoors';

export interface MapboxMapConfig {
  container: HTMLElement | string;
  center?: [number, number]; // [lng, lat]
  zoom?: number;
  bearing?: number;
  pitch?: number;
  style?: MapboxStyleId;
  interactive?: boolean;
  accessToken: string;
  /** Enable 3D terrain with exaggeration factor (default: off) */
  terrain?: boolean;
  terrainExaggeration?: number;
  /** Use globe projection at low zoom levels (default: true for v3) */
  globe?: boolean;
  /** Custom style URL — overrides the style preset if provided.
   *  Accepts mapbox://styles/... or https://api.mapbox.com/styles/v1/... */
  customStyleUrl?: string;
}

// ── Mapbox Style URLs ─────────────────────────────────────

const MAPBOX_STYLES: Record<MapboxStyleId, string> = {
  dark: 'mapbox://styles/mapbox/dark-v11',
  standard: 'mapbox://styles/mapbox/standard',
  satellite: 'mapbox://styles/mapbox/satellite-v9',
  hybrid: 'mapbox://styles/mapbox/satellite-streets-v12',
  streets: 'mapbox://styles/mapbox/streets-v12',
  terrain: 'mapbox://styles/mapbox/outdoors-v12',
  night_nav: 'mapbox://styles/mapbox/navigation-night-v1',
  outdoors: 'mapbox://styles/mapbox/outdoors-v12',
};

function isValidCustomMapboxStyleUrl(value: string | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('mapbox://styles/')) return true;
  // Accept only Mapbox HTTPS style endpoints:
  //   https://api.mapbox.com/styles/v1/{username}/{style_id}[?...|#...]
  return /^https:\/\/api\.mapbox\.com\/styles\/v1\/[^/]+\/[^/?#]+(?:[/?#]|$)/i.test(trimmed);
}

export const MAPBOX_STYLE_LABELS: Record<MapboxStyleId, string> = {
  dark: 'Dark',
  standard: 'Standard',
  satellite: 'Satellite',
  hybrid: 'Hybrid',
  streets: 'Streets',
  terrain: 'Terrain',
  night_nav: 'Night Nav',
  outdoors: 'Outdoors',
};

// ── Dark style customization (Spillman Flex theme) ────────
// These overrides are applied on top of mapbox://styles/mapbox/dark-v11
// to match the RMPG dark aesthetic: darker backgrounds, gold accents,
// reduced label clutter for tactical clarity.

const SPILLMAN_DARK_OVERRIDES: Array<{
  id: string;
  paint?: Record<string, unknown>;
  layout?: Record<string, unknown>;
}> = [
  // Darken water
  { id: 'water', paint: { 'fill-color': '#080808' } },
  // Darken land
  { id: 'land', paint: { 'background-color': '#0a0a0a' } },
  // Reduce road visibility
  { id: 'road-street', paint: { 'line-color': '#1a1a1a', 'line-width': 1 } },
  { id: 'road-secondary-tertiary', paint: { 'line-color': '#1e1e1e', 'line-width': 1.2 } },
  { id: 'road-primary', paint: { 'line-color': '#222222', 'line-width': 1.5 } },
  { id: 'road-motorway-trunk', paint: { 'line-color': '#2e2e2e', 'line-width': 2 } },
  // Reduce label prominence — keep POI labels but dim them
  { id: 'poi-label', paint: { 'text-color': '#555555' } },
  { id: 'road-label', paint: { 'text-color': '#666666' } },
];

// ── Default center (Salt Lake City) ───────────────────────

const SLC_CENTER: [number, number] = [-111.891, 40.7608];
const DEFAULT_ZOOM = 12;

// ── Singleton state ───────────────────────────────────────

let mapInstance: mapboxgl.Map | null = null;
let isLoaded = false;

/**
 * Create a Mapbox GL map with Spillman Flex dark theme.
 * Supports Mapbox GL JS v3 features: globe projection, fog/atmosphere,
 * 3D terrain, Standard style, and fullscreen control.
 */
export function createMapboxMap(config: MapboxMapConfig): mapboxgl.Map {
  // Set the access token globally
  mapboxgl.accessToken = config.accessToken;

  const styleId = config.style || 'dark';
  const hasValidCustomStyle = isValidCustomMapboxStyleUrl(config.customStyleUrl);
  const styleUrl = hasValidCustomStyle
    ? config.customStyleUrl!.trim()
    : (MAPBOX_STYLES[styleId] || MAPBOX_STYLES.dark);
  const useGlobe = config.globe !== false; // default: true

  const map = new mapboxgl.Map({
    container: config.container,
    style: styleUrl,
    center: config.center || SLC_CENTER,
    zoom: config.zoom || DEFAULT_ZOOM,
    bearing: config.bearing || 0,
    pitch: config.pitch || 0,
    interactive: config.interactive !== false,
    attributionControl: false,
    antialias: true,
    maxZoom: 20,
    minZoom: 3,
    // Mapbox GL JS v3: globe projection for an immersive view at low zooms,
    // automatically transitions to mercator at closer zoom levels.
    projection: useGlobe ? 'globe' : 'mercator',
  });

  // Add compact attribution
  map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');

  // Add navigation controls (zoom + compass)
  map.addControl(new mapboxgl.NavigationControl({
    showCompass: true,
    showZoom: true,
    visualizePitch: true,
  }), 'top-right');

  // Add fullscreen control (Mapbox GL JS v3 best practice)
  map.addControl(new mapboxgl.FullscreenControl(), 'top-right');

  // Add scale bar (imperial for US law enforcement)
  map.addControl(new mapboxgl.ScaleControl({ unit: 'imperial' }), 'bottom-left');

  // Add geolocate control
  map.addControl(new mapboxgl.GeolocateControl({
    positionOptions: { enableHighAccuracy: true },
    trackUserLocation: true,
    showUserHeading: true,
  }), 'top-right');

  // Apply Spillman dark overrides when the dark style loads
  if (styleId === 'dark' || styleId === 'night_nav') {
    map.on('style.load', () => {
      applySpillmanDarkOverrides(map);
      applySpillmanFog(map);
    });
  }

  // Apply fog/atmosphere for globe projection on non-dark styles too
  if (useGlobe && styleId !== 'dark' && styleId !== 'night_nav') {
    map.on('style.load', () => {
      applyDefaultFog(map);
    });
  }

  // Enable 3D terrain if requested and available
  if (config.terrain) {
    map.on('style.load', () => {
      addMapboxTerrain(map, config.terrainExaggeration);
    });
  }

  // Standard style config: set light preset to night for Spillman theme
  if (styleId === 'standard') {
    map.on('style.load', () => {
      try {
        map.setConfigProperty('basemap', 'lightPreset', 'night');
      } catch {
        // Standard style config may not be available in all versions
      }
    });
  }

  // Track loaded state
  map.on('load', () => {
    isLoaded = true;
  });

  mapInstance = map;
  return map;
}

/**
 * Apply Spillman Flex dark theme overrides to the loaded style.
 */
function applySpillmanDarkOverrides(map: mapboxgl.Map): void {
  for (const override of SPILLMAN_DARK_OVERRIDES) {
    try {
      const layer = map.getLayer(override.id);
      if (!layer) continue;

      if (override.paint) {
        for (const [prop, value] of Object.entries(override.paint)) {
          map.setPaintProperty(override.id, prop as any, value);
        }
      }
      if (override.layout) {
        for (const [prop, value] of Object.entries(override.layout)) {
          map.setLayoutProperty(override.id, prop as any, value as string);
        }
      }
    } catch {
      // Layer might not exist in this style version — skip silently
    }
  }
}

// ── Fog / Atmosphere (Mapbox GL JS v3) ────────────────────

/**
 * Apply Spillman Flex dark fog/atmosphere for globe projection.
 * Creates a moody, dark atmosphere matching the tactical theme.
 */
function applySpillmanFog(map: mapboxgl.Map): void {
  try {
    map.setFog({
      color: 'rgba(10, 10, 10, 0.9)',           // Lower atmosphere — near-black
      'high-color': 'rgba(20, 15, 5, 1)',        // Upper atmosphere — warm black
      'horizon-blend': 0.08,                      // Sharp horizon line
      'star-intensity': 0.4,                      // Subtle stars for night feel
      'space-color': 'rgba(5, 5, 5, 1)',         // Deep space — almost black
    });
  } catch {
    // Fog API may not be available on all style types
  }
}

/**
 * Apply default fog/atmosphere for non-dark styles with globe projection.
 */
function applyDefaultFog(map: mapboxgl.Map): void {
  try {
    map.setFog({
      color: 'rgba(186, 210, 235, 0.8)',         // Lower atmosphere — soft blue
      'high-color': 'rgba(36, 92, 223, 1)',      // Upper atmosphere — sky blue
      'horizon-blend': 0.2,                       // Gentle horizon blend
      'star-intensity': 0.15,                     // Minimal stars
      'space-color': 'rgba(10, 10, 30, 1)',      // Dark space
    });
  } catch {
    // Fog API may not be available on all style types
  }
}

// ── 3D Terrain (Mapbox GL JS v3) ──────────────────────────

/**
 * Add 3D terrain using Mapbox DEM (Digital Elevation Model).
 * Exaggeration controls the vertical scale (1.0 = real-world, 1.5 = enhanced).
 */
export function addMapboxTerrain(map: mapboxgl.Map, exaggeration = 1.5): void {
  try {
    // Add the Mapbox DEM raster source if not already present
    if (!map.getSource('mapbox-dem')) {
      map.addSource('mapbox-dem', {
        type: 'raster-dem',
        url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
        tileSize: 512,
        maxzoom: 14,
      });
    }

    map.setTerrain({ source: 'mapbox-dem', exaggeration });
  } catch (err) {
    // Terrain may not be supported in older browsers or WebGL1 contexts
    console.warn('[Mapbox] Terrain setup failed:', err);
  }
}

/**
 * Remove 3D terrain from the map.
 */
export function removeMapboxTerrain(map: mapboxgl.Map): void {
  try {
    map.setTerrain(null);
  } catch {
    // Safe to ignore — terrain may not have been set
  }
}

/**
 * Switch the map style.
 * Re-applies fog/atmosphere and Standard style config as needed.
 */
export function setMapboxStyle(map: mapboxgl.Map, styleId: MapboxStyleId): void {
  const styleUrl = MAPBOX_STYLES[styleId] || MAPBOX_STYLES.dark;
  map.setStyle(styleUrl);

  map.once('style.load', () => {
    if (styleId === 'dark' || styleId === 'night_nav') {
      applySpillmanDarkOverrides(map);
      applySpillmanFog(map);
    } else if (map.getProjection()?.name === 'globe') {
      applyDefaultFog(map);
    }

    // Standard style: set night preset for Spillman theme
    if (styleId === 'standard') {
      try {
        map.setConfigProperty('basemap', 'lightPreset', 'night');
      } catch {
        // Standard style config not available
      }
    }
  });
}

/**
 * Get the singleton map instance.
 */
export function getMapboxInstance(): mapboxgl.Map | null {
  return mapInstance;
}

/**
 * Check if the map is loaded and ready.
 */
export function isMapboxLoaded(): boolean {
  return isLoaded && mapInstance !== null;
}

/**
 * Clean up the map instance.
 */
export function destroyMapboxMap(): void {
  if (mapInstance) {
    try { mapInstance.remove(); } catch { /* map may not have fully initialized before destroy */ }
    mapInstance = null;
    isLoaded = false;
  }
}

// ── GeoJSON Layer Helpers ─────────────────────────────────

/**
 * Add a GeoJSON source and layer to the Mapbox map.
 */
export function addMapboxGeoJsonLayer(
  map: mapboxgl.Map,
  id: string,
  geojson: GeoJSON.FeatureCollection,
  options: {
    type: 'fill' | 'line' | 'circle' | 'symbol';
    paint?: Record<string, unknown>;
    layout?: Record<string, unknown>;
    minzoom?: number;
    maxzoom?: number;
  }
): void {
  // Add source if not exists
  if (!map.getSource(id)) {
    map.addSource(id, {
      type: 'geojson',
      data: geojson,
    });
  }

  // Add layer if not exists
  if (!map.getLayer(id)) {
    map.addLayer({
      id,
      type: options.type,
      source: id,
      paint: (options.paint || {}) as any,
      layout: (options.layout || {}) as any,
      minzoom: options.minzoom,
      maxzoom: options.maxzoom,
    });
  }
}

/**
 * Update a GeoJSON source data.
 */
export function updateMapboxGeoJsonSource(
  map: mapboxgl.Map,
  id: string,
  geojson: GeoJSON.FeatureCollection
): void {
  const source = map.getSource(id) as mapboxgl.GeoJSONSource | undefined;
  if (source) {
    source.setData(geojson);
  }
}

/**
 * Add beat boundary polygons with gold-tinted outlines (Spillman theme).
 */
export function addMapboxBeatBoundaries(
  map: mapboxgl.Map,
  beats: GeoJSON.FeatureCollection
): void {
  addMapboxGeoJsonLayer(map, 'beat-fills', beats, {
    type: 'fill',
    paint: {
      'fill-color': '#d4a017',
      'fill-opacity': 0.05,
    },
  });

  addMapboxGeoJsonLayer(map, 'beat-outlines', beats, {
    type: 'line',
    paint: {
      'line-color': '#d4a017',
      'line-width': 1,
      'line-opacity': 0.4,
    },
  });
}

// ── Marker Helpers ────────────────────────────────────────

/**
 * Create a custom HTML marker for a unit.
 */
export function createMapboxUnitMarker(
  map: mapboxgl.Map,
  unit: { id: number; callsign: string; lat: number; lng: number; status: string },
  statusColors: Record<string, string>
): mapboxgl.Marker {
  const color = statusColors[unit.status] || '#888';

  // Create custom marker element
  const el = document.createElement('div');
  el.className = 'mapbox-unit-marker';
  el.style.cssText = `
    width: 28px; height: 28px; border-radius: 2px;
    background: ${color}; border: 2px solid #d4a017;
    display: flex; align-items: center; justify-content: center;
    font-size: 9px; font-weight: 700; color: #fff;
    font-family: system-ui, sans-serif; cursor: pointer;
    box-shadow: 0 0 6px ${color}80;
  `;
  el.textContent = unit.callsign.slice(0, 3);
  el.title = `${unit.callsign} — ${unit.status}`;

  const marker = new mapboxgl.Marker({ element: el })
    .setLngLat([unit.lng, unit.lat])
    .setPopup(
      new mapboxgl.Popup({ offset: 16, closeButton: false, className: 'mapbox-popup-dark' })
        .setHTML(`
          <div style="background:#141414;color:#e0e0e0;padding:8px 12px;border:1px solid #222;border-radius:2px;font-family:system-ui,sans-serif;font-size:11px;">
            <div style="font-weight:700;color:#d4a017;margin-bottom:4px;">${unit.callsign}</div>
            <div>Status: <span style="color:${color}">${unit.status}</span></div>
          </div>
        `)
    )
    .addTo(map);

  return marker;
}

/**
 * Create a custom HTML marker for an active call/incident.
 */
export function createMapboxCallMarker(
  map: mapboxgl.Map,
  call: { id: number; type: string; lat: number; lng: number; priority: string },
  priorityColors: Record<string, string>
): mapboxgl.Marker {
  const color = priorityColors[call.priority] || '#888';

  const el = document.createElement('div');
  el.className = 'mapbox-call-marker';
  el.style.cssText = `
    width: 12px; height: 12px; border-radius: 50%;
    background: ${color}; border: 2px solid ${color};
    cursor: pointer; box-shadow: 0 0 8px ${color}99;
    animation: mapbox-pulse 2s ease-in-out infinite;
  `;
  el.title = `${call.type} — P${call.priority}`;

  const marker = new mapboxgl.Marker({ element: el })
    .setLngLat([call.lng, call.lat])
    .setPopup(
      new mapboxgl.Popup({ offset: 12, closeButton: false, className: 'mapbox-popup-dark' })
        .setHTML(`
          <div style="background:#141414;color:#e0e0e0;padding:8px 12px;border:1px solid #222;border-radius:2px;font-family:system-ui,sans-serif;font-size:11px;">
            <div style="font-weight:700;color:${color};margin-bottom:4px;">${call.type}</div>
            <div>Priority: <span style="color:${color}">P${call.priority}</span></div>
          </div>
        `)
    )
    .addTo(map);

  return marker;
}

// ── CSS Injection ─────────────────────────────────────────

let cssInjected = false;

/**
 * Inject Mapbox-specific CSS overrides for Spillman dark theme.
 */
export function injectMapboxStyles(): void {
  if (cssInjected) return;
  cssInjected = true;

  const style = document.createElement('style');
  style.textContent = `
    /* Spillman Flex dark popup theme */
    .mapbox-popup-dark .mapboxgl-popup-content {
      background: transparent !important;
      padding: 0 !important;
      border-radius: 2px !important;
      box-shadow: 0 2px 8px rgba(0,0,0,0.6) !important;
    }
    .mapbox-popup-dark .mapboxgl-popup-tip {
      border-top-color: #141414 !important;
    }

    /* Pulse animation for call markers */
    @keyframes mapbox-pulse {
      0%, 100% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.3); opacity: 0.7; }
    }

    /* Override Mapbox GL attribution for dark theme */
    .mapboxgl-ctrl-attrib {
      background: rgba(10, 10, 10, 0.8) !important;
      color: #666 !important;
      font-size: 9px !important;
    }
    .mapboxgl-ctrl-attrib a {
      color: #888 !important;
    }

    /* Navigation controls dark theme */
    .mapboxgl-ctrl-group {
      background: #141414 !important;
      border: 1px solid #222 !important;
      border-radius: 2px !important;
    }
    .mapboxgl-ctrl-group button {
      border-color: #222 !important;
    }
    .mapboxgl-ctrl-group button:hover {
      background: #1a1a1a !important;
    }
    .mapboxgl-ctrl-group button .mapboxgl-ctrl-icon {
      filter: invert(0.7) !important;
    }

    /* Scale control dark theme */
    .mapboxgl-ctrl-scale {
      background: rgba(10, 10, 10, 0.8) !important;
      color: #888 !important;
      border-color: #444 !important;
      font-size: 9px !important;
    }

    /* Geolocate control */
    .mapboxgl-ctrl-geolocate .mapboxgl-ctrl-icon {
      filter: invert(0.7) !important;
    }

    /* Fullscreen control dark theme */
    .mapboxgl-ctrl-fullscreen .mapboxgl-ctrl-icon {
      filter: invert(0.7) !important;
    }
  `;
  document.head.appendChild(style);
}

// ── Heatmap Layer ─────────────────────────────────────────

/**
 * Add a heatmap layer from point data.
 */
export function addMapboxHeatmapLayer(
  map: mapboxgl.Map,
  id: string,
  points: Array<{ lng: number; lat: number; weight?: number }>
): void {
  const geojson: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: points.map(p => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      properties: { weight: p.weight || 1 },
    })),
  };

  if (!map.getSource(id)) {
    map.addSource(id, { type: 'geojson', data: geojson });
  }

  if (!map.getLayer(id)) {
    map.addLayer({
      id,
      type: 'heatmap',
      source: id,
      paint: {
        // Ramp heatmap weight from 0 to 1 based on property weight
        'heatmap-weight': ['interpolate', ['linear'], ['get', 'weight'], 0, 0, 5, 1],
        // Increase intensity as zoom level increases
        'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 0, 1, 15, 3],
        // Color ramp: dark → gold → red (Spillman theme)
        'heatmap-color': [
          'interpolate', ['linear'], ['heatmap-density'],
          0, 'rgba(10, 10, 10, 0)',
          0.2, 'rgba(100, 60, 0, 0.4)',
          0.4, 'rgba(160, 100, 0, 0.6)',
          0.6, 'rgba(212, 160, 23, 0.8)',
          0.8, 'rgba(255, 140, 0, 0.9)',
          1.0, 'rgba(255, 60, 0, 1)',
        ],
        // Radius increases with zoom
        'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 0, 4, 15, 25],
        // Opacity fades at high zoom to reveal individual points
        'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0.8, 15, 0.4],
      },
    });
  }
}

// ── 3D Building Layer ─────────────────────────────────────

/**
 * Add 3D building extrusion layer (available on dark/streets styles).
 */
export function addMapbox3DBuildings(map: mapboxgl.Map): void {
  const layers = map.getStyle()?.layers;
  if (!layers) return;

  // Find the first symbol layer to insert 3D buildings beneath labels
  let labelLayerId: string | undefined;
  for (const layer of layers) {
    if (layer.type === 'symbol' && (layer.layout as any)?.['text-field']) {
      labelLayerId = layer.id;
      break;
    }
  }

  if (map.getLayer('3d-buildings')) return;

  map.addLayer(
    {
      id: '3d-buildings',
      source: 'composite',
      'source-layer': 'building',
      filter: ['==', 'extrude', 'true'],
      type: 'fill-extrusion',
      minzoom: 14,
      paint: {
        'fill-extrusion-color': '#1a1a1a',
        'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 14, 0, 15.05, ['get', 'height']],
        'fill-extrusion-base': ['interpolate', ['linear'], ['zoom'], 14, 0, 15.05, ['get', 'min_height']],
        'fill-extrusion-opacity': 0.5,
      },
    },
    labelLayerId
  );
}

// ── Polyline / Trail Helpers ──────────────────────────────

/**
 * Add a polyline trail (breadcrumb path) to the map.
 */
export function addMapboxTrail(
  map: mapboxgl.Map,
  id: string,
  coordinates: [number, number][],
  color = '#d4a017',
  width = 2
): void {
  const geojson: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: { type: 'LineString', coordinates },
      properties: {},
    }],
  };

  if (map.getSource(id)) {
    (map.getSource(id) as mapboxgl.GeoJSONSource).setData(geojson);
  } else {
    map.addSource(id, { type: 'geojson', data: geojson });
    map.addLayer({
      id,
      type: 'line',
      source: id,
      paint: {
        'line-color': color,
        'line-width': width,
        'line-opacity': 0.8,
      },
      layout: {
        'line-join': 'round',
        'line-cap': 'round',
      },
    });
  }
}

/**
 * Remove a trail layer and source.
 */
export function removeMapboxTrail(map: mapboxgl.Map, id: string): void {
  if (map.getLayer(id)) map.removeLayer(id);
  if (map.getSource(id)) map.removeSource(id);
}

// ── Geofence Circle Helpers ───────────────────────────────

/**
 * Add a circle geofence visualization.
 * Mapbox GL doesn't have native circle geometry — we approximate
 * with a 64-vertex polygon using Turf.js or manual calculation.
 */
export function addMapboxCircle(
  map: mapboxgl.Map,
  id: string,
  center: [number, number],
  radiusMeters: number,
  color = '#d4a017',
  opacity = 0.15
): void {
  // Generate circle polygon vertices
  const steps = 64;
  const coordinates: [number, number][] = [];
  const earthRadius = 6371000; // meters

  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * 2 * Math.PI;
    const lat = center[1] + (radiusMeters / earthRadius) * (180 / Math.PI) * Math.sin(angle);
    const lng = center[0] + (radiusMeters / earthRadius) * (180 / Math.PI) * Math.cos(angle) / Math.cos(center[1] * Math.PI / 180);
    coordinates.push([lng, lat]);
  }

  const geojson: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [coordinates] },
      properties: {},
    }],
  };

  addMapboxGeoJsonLayer(map, `${id}-fill`, geojson, {
    type: 'fill',
    paint: { 'fill-color': color, 'fill-opacity': opacity },
  });

  addMapboxGeoJsonLayer(map, `${id}-outline`, geojson, {
    type: 'line',
    paint: { 'line-color': color, 'line-width': 2, 'line-opacity': 0.6 },
  });
}

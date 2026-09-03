// ============================================================
// mapboxOptimizationLayer — render Optimization V2 solution
// routes as visual layers on a Mapbox GL JS map instance.
//
// Literal hex is correct here — Mapbox paint properties cannot
// resolve CSS variables (same pattern as mapboxBasemap.ts).
// ============================================================

import type { Map as MapboxMap } from 'mapbox-gl';
import type { V2Solution } from './mapboxOptimizationV2';
import { hasLayer, safeRemoveLayer, safeRemoveSource } from './mapboxSafeLayer';

export const LAYER_PREFIX = 'optv2';

// One color per vehicle/unit — up to 8, then wraps.
const UNIT_COLORS = [
  '#3b82f6', // blue
  '#f59e0b', // amber
  '#10b981', // green
  '#8b5cf6', // purple
  '#ef4444', // red
  '#06b6d4', // cyan
  '#f97316', // orange
  '#ec4899', // pink
];

// ─── Public interfaces ────────────────────────────────────────────────────────

/**
 * A coordinate entry for a single stop location.
 * `locationName` must match the `V2Stop.location` value in the solution so
 * the layer can map solution stops → real coordinates.
 */
export interface StopCoordinate {
  locationName: string;
  lng: number;
  lat: number;
  /** Optional human-readable label shown in a popup (address or call number). */
  label?: string;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function routeSourceId(routeIndex: number): string {
  return `${LAYER_PREFIX}-route-source-${routeIndex}`;
}

function routeLineLayerId(routeIndex: number): string {
  return `${LAYER_PREFIX}-route-${routeIndex}`;
}

function stopsSourceId(routeIndex: number): string {
  return `${LAYER_PREFIX}-stops-source-${routeIndex}`;
}

function stopsLayerId(routeIndex: number): string {
  return `${LAYER_PREFIX}-stops-${routeIndex}`;
}

function stopsLabelLayerId(routeIndex: number): string {
  return `${LAYER_PREFIX}-stops-label-${routeIndex}`;
}

/**
 * Fetch a real Mapbox Directions polyline between a series of coordinates.
 * Returns null if the call fails or fewer than 2 coordinates are provided.
 */
async function fetchDirectionsPolyline(
  coords: Array<{ lng: number; lat: number }>,
  token: string,
): Promise<GeoJSON.Feature<GeoJSON.LineString> | null> {
  if (coords.length < 2) return null;
  // Mapbox Directions accepts at most 25 waypoints per request.
  const waypoints = coords.slice(0, 25).map((c) => `${c.lng},${c.lat}`).join(';');
  const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${waypoints}?geometries=geojson&overview=full&access_token=${token}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return null;
    const json = (await res.json()) as { routes?: Array<{ geometry: GeoJSON.LineString }> };
    const geometry = json.routes?.[0]?.geometry;
    if (!geometry) return null;
    return { type: 'Feature', properties: {}, geometry };
  } catch {
    return null;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Render an optimization solution on the map.
 *
 * Draws one colored dashed line per route plus numbered stop markers.
 * Call `removeOptimizationLayers()` first to avoid duplicates.
 *
 * @param map          Live Mapbox GL JS map instance.
 * @param solution     V2Solution returned by the optimization job.
 * @param stopCoords   Coordinate lookup: one entry per location name in the solution.
 * @param options.fetchRouteLine  If true AND mapboxToken is supplied, replaces
 *                                straight-line segments with real Directions polylines.
 * @param options.mapboxToken     Required when fetchRouteLine is true.
 */
export async function renderOptimizationSolution(
  map: MapboxMap,
  solution: V2Solution,
  stopCoords: StopCoordinate[],
  options?: { fetchRouteLine?: boolean; mapboxToken?: string },
): Promise<void> {
  const coordMap = new Map<string, StopCoordinate>(
    stopCoords.map((s) => [s.locationName, s]),
  );

  for (let routeIndex = 0; routeIndex < solution.routes.length; routeIndex++) {
    const route = solution.routes[routeIndex];
    const color = UNIT_COLORS[routeIndex % UNIT_COLORS.length];

    // Collect ordered service-stop coords (skip depot start/end + unresolvable names).
    const serviceStops = route.stops.filter((s) => s.type === 'service');
    const resolved: Array<{ lng: number; lat: number; label: string; seq: number }> = [];
    for (let i = 0; i < serviceStops.length; i++) {
      const coord = coordMap.get(serviceStops[i].location);
      if (coord) {
        resolved.push({ lng: coord.lng, lat: coord.lat, label: coord.label ?? serviceStops[i].location, seq: i + 1 });
      }
    }

    if (resolved.length === 0) continue;

    // ── Route line ────────────────────────────────────────────────────────────
    let lineFeature: GeoJSON.Feature<GeoJSON.LineString> | null = null;
    if (options?.fetchRouteLine && options.mapboxToken && resolved.length >= 2) {
      lineFeature = await fetchDirectionsPolyline(resolved, options.mapboxToken);
    }
    if (!lineFeature) {
      // Fall back to straight lines between stops.
      lineFeature = {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: resolved.map((c) => [c.lng, c.lat]),
        },
      };
    }

    const lineSourceId = routeSourceId(routeIndex);
    const lineLayId = routeLineLayerId(routeIndex);
    if (hasLayer(map, lineLayId)) {
      try {
        (map.getSource(lineSourceId) as mapboxgl.GeoJSONSource | undefined)?.setData({
          type: 'FeatureCollection',
          features: [lineFeature],
        });
      } catch { /* style torn down — skip */ }
    } else {
      try {
        map.addSource(lineSourceId, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [lineFeature] },
        });
        map.addLayer({
          id: lineLayId,
          type: 'line',
          source: lineSourceId,
          paint: {
            'line-color': color,
            'line-width': 3,
            'line-opacity': 0.85,
            'line-dasharray': [2, 1],
          },
          layout: { 'line-cap': 'round', 'line-join': 'round' },
        });
      } catch { /* style not ready — caller should wrap in whenStyleReady */ }
    }

    // ── Stop circles + number labels ─────────────────────────────────────────
    const stopsFeatures: GeoJSON.Feature<GeoJSON.Point>[] = resolved.map((s) => ({
      type: 'Feature',
      properties: { seq: s.seq, label: s.label, color },
      geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
    }));
    const stopsCollection: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: stopsFeatures };

    const srcId = stopsSourceId(routeIndex);
    const circLayId = stopsLayerId(routeIndex);
    const lblLayId = stopsLabelLayerId(routeIndex);

    if (hasLayer(map, circLayId)) {
      try {
        (map.getSource(srcId) as mapboxgl.GeoJSONSource | undefined)?.setData(stopsCollection);
      } catch { /* style torn down */ }
    } else {
      try {
        map.addSource(srcId, { type: 'geojson', data: stopsCollection });

        // Outer circle
        map.addLayer({
          id: circLayId,
          type: 'circle',
          source: srcId,
          paint: {
            'circle-color': color,
            'circle-radius': 10,
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 2,
            'circle-opacity': 0.9,
          },
        });

        // Sequence number label
        map.addLayer({
          id: lblLayId,
          type: 'symbol',
          source: srcId,
          layout: {
            'text-field': ['to-string', ['get', 'seq']],
            'text-size': 11,
            'text-font': ['DIN Offc Pro Bold', 'Arial Unicode MS Bold'],
            'text-allow-overlap': true,
          },
          paint: {
            'text-color': '#ffffff',
          },
        });
      } catch { /* style not ready */ }
    }
  }
}

/**
 * Remove all optimization route layers and sources added by
 * `renderOptimizationSolution`. Safe to call when nothing has been rendered.
 */
export function removeOptimizationLayers(map: MapboxMap): void {
  if (!map.style) return;
  let layers: Array<{ id: string }> = [];
  try {
    layers = map.getStyle().layers ?? [];
  } catch {
    return;
  }
  for (const layer of layers) {
    if (layer.id.startsWith(LAYER_PREFIX)) {
      safeRemoveLayer(map, layer.id);
    }
  }
  // Also remove sources that match the prefix (layers share source names).
  const style = map.getStyle();
  for (const sourceId of Object.keys(style.sources ?? {})) {
    if (sourceId.startsWith(LAYER_PREFIX)) {
      safeRemoveSource(map, sourceId);
    }
  }
}

/**
 * Fit the map viewport to show all optimization route stops.
 * No-op when the solution has no resolved coordinates.
 */
export function fitToOptimizationBounds(
  map: MapboxMap,
  solution: V2Solution,
  stopCoords: StopCoordinate[],
): void {
  const coordMap = new Map<string, StopCoordinate>(
    stopCoords.map((s) => [s.locationName, s]),
  );

  const lngs: number[] = [];
  const lats: number[] = [];
  for (const route of solution.routes) {
    for (const stop of route.stops) {
      if (stop.type !== 'service') continue;
      const c = coordMap.get(stop.location);
      if (c) {
        lngs.push(c.lng);
        lats.push(c.lat);
      }
    }
  }

  if (lngs.length === 0) return;

  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);

  try {
    map.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 60, maxZoom: 16 });
  } catch { /* map torn down */ }
}

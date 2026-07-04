// ============================================================
// RMPG Flex — Mapbox API Client Service
// ============================================================
// Typed client-side wrappers for all Mapbox API endpoints
// exposed by the server at /api/mapbox/*.
// ============================================================

import { apiFetch } from '../hooks/useApi';

// ── Types ─────────────────────────────────────────────────

export interface MapboxGeocodingResult {
  name: string;
  full_address: string;
  latitude: number;
  longitude: number;
  place_type: string;
  relevance: number;
}

export interface MapboxIsochroneResponse {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    geometry: { type: string; coordinates: unknown };
    properties: Record<string, unknown>;
  }>;
}

export interface MapboxMatrixResponse {
  durations: (number | null)[][];
  distances: (number | null)[][] | null;
  sources: Array<{ location: [number, number]; name: string }>;
  destinations: Array<{ location: [number, number]; name: string }>;
}

export interface MapboxDirectionsResponse {
  routes: Array<{
    geometry: { type: 'LineString'; coordinates: [number, number][] };
    duration: number;
    distance: number;
    legs: Array<{
      duration: number;
      distance: number;
      steps: Array<{
        maneuver: { instruction: string; type: string };
        duration: number;
        distance: number;
        name: string;
      }>;
    }>;
  }>;
  waypoints: Array<{ name: string; location: [number, number] }>;
}

export interface MapboxMapMatchResponse {
  matchings: Array<{
    confidence: number;
    geometry: { type: 'LineString'; coordinates: [number, number][] };
    duration: number;
    distance: number;
  }>;
  tracepoints: Array<{
    name: string;
    location: [number, number];
  } | null>;
}

export interface MapboxTilequeryResponse {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    geometry: { type: string; coordinates: unknown };
    properties: Record<string, unknown> & {
      tilequery: { distance: number; layer: string };
    };
  }>;
}

// ── Shared coordinate encoding ────────────────────────────
// The server's directions/matrix/optimization routes all take
// `coordinates` as a single "lng,lat;lng,lat" query string (they pass it
// straight through to the upstream Mapbox REST path), not a JSON array.
export function coordsToParam(coords: Array<[number, number]>): string {
  return coords.map(([lng, lat]) => `${lng},${lat}`).join(';');
}

interface RawMapboxFeature {
  place_name: string;
  text: string;
  center: [number, number];
  place_type: string[];
  relevance: number;
}

function mapRawFeature(f: RawMapboxFeature): MapboxGeocodingResult {
  return {
    name: f.text || f.place_name || '',
    full_address: f.place_name || '',
    latitude: f.center?.[1] ?? 0,
    longitude: f.center?.[0] ?? 0,
    place_type: (f.place_type || [])[0] || '',
    relevance: f.relevance ?? 0,
  };
}

// ── Forward Geocode ───────────────────────────────────────

export async function mapboxForwardGeocode(
  query: string,
  options?: { limit?: number; proximity?: [number, number]; country?: string }
): Promise<MapboxGeocodingResult[]> {
  const params = new URLSearchParams({ q: query });
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.proximity) params.set('proximity', options.proximity.join(','));
  if (options?.country) params.set('country', options.country);

  const data = await apiFetch<{ features: RawMapboxFeature[] }>(`/mapbox/geocode?${params}`);
  return (data.features || []).map(mapRawFeature);
}

// ── Reverse Geocode ───────────────────────────────────────

export async function mapboxReverseGeocode(
  lng: number, lat: number,
  options?: { types?: string; limit?: number }
): Promise<MapboxGeocodingResult[]> {
  const params = new URLSearchParams({ lng: String(lng), lat: String(lat) });
  if (options?.types) params.set('types', options.types);
  if (options?.limit) params.set('limit', String(options.limit));

  const data = await apiFetch<{ features: RawMapboxFeature[] }>(`/mapbox/reverse-geocode?${params}`);
  return (data.features || []).map(mapRawFeature);
}

// ── Isochrone ─────────────────────────────────────────────

export async function mapboxIsochrone(
  lng: number, lat: number,
  options?: { profile?: 'driving' | 'walking' | 'cycling'; minutes?: number[] }
): Promise<MapboxIsochroneResponse> {
  const params = new URLSearchParams({ lng: String(lng), lat: String(lat) });
  if (options?.profile) params.set('profile', options.profile);
  if (options?.minutes) params.set('minutes', options.minutes.join(','));

  return apiFetch<MapboxIsochroneResponse>(`/mapbox/isochrone?${params}`);
}

// ── Matrix ────────────────────────────────────────────────

export async function mapboxMatrix(
  coordinates: Array<[number, number]>,
  options?: { profile?: string; sources?: number[]; destinations?: number[] }
): Promise<MapboxMatrixResponse> {
  const params = new URLSearchParams({ coordinates: coordsToParam(coordinates) });
  if (options?.profile) params.set('profile', options.profile);
  if (options?.sources?.length) params.set('sources', options.sources.join(','));
  if (options?.destinations?.length) params.set('destinations', options.destinations.join(','));
  return apiFetch<MapboxMatrixResponse>(`/mapbox/matrix?${params}`);
}

// ── Static Image URL ──────────────────────────────────────

export async function mapboxStaticImageUrl(options: {
  lng: number; lat: number; zoom?: number;
  width?: number; height?: number; style?: string;
  markers?: Array<{ lng: number; lat: number; color?: string; label?: string }>;
  retina?: boolean;
}): Promise<string> {
  const params = new URLSearchParams({
    lng: String(options.lng),
    lat: String(options.lat),
    zoom: String(options.zoom ?? 14),
    width: String(options.width ?? 600),
    height: String(options.height ?? 400),
  });
  if (options.style) params.set('style', options.style);
  if (options.retina) params.set('retina', 'true');
  if (options.markers?.length) {
    params.set('markers', options.markers.map(m =>
      `${m.lng},${m.lat},${m.color ?? 'd4a017'},${m.label ?? ''}`
    ).join(';'));
  }

  const data = await apiFetch<{ url: string }>(`/mapbox/static?${params}`);
  return data.url;
}

// ── Directions ────────────────────────────────────────────

export async function mapboxDirections(
  coordinates: Array<[number, number]>,
  options?: { profile?: string; steps?: boolean; alternatives?: boolean }
): Promise<MapboxDirectionsResponse> {
  const params = new URLSearchParams({ coordinates: coordsToParam(coordinates) });
  if (options?.profile) params.set('profile', options.profile);
  if (options?.alternatives != null) params.set('alternatives', String(options.alternatives));
  if (options?.steps != null) params.set('steps', String(options.steps));
  return apiFetch<MapboxDirectionsResponse>(`/mapbox/directions?${params}`);
}

// ── Map Matching ──────────────────────────────────────────

export async function mapboxMapMatch(
  coordinates: Array<[number, number]>,
  options?: { profile?: string; timestamps?: number[]; radiuses?: number[] }
): Promise<MapboxMapMatchResponse> {
  return apiFetch<MapboxMapMatchResponse>('/mapbox/map-matching', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ coordinates, ...options }),
  });
}

// ── Tilequery ─────────────────────────────────────────────

export async function mapboxTilequery(
  lng: number, lat: number,
  options?: { tileset?: string; radius?: number; limit?: number; layers?: string[] }
): Promise<MapboxTilequeryResponse> {
  const params = new URLSearchParams({
    lng: String(lng),
    lat: String(lat),
  });
  if (options?.tileset) params.set('tileset', options.tileset);
  if (options?.radius) params.set('radius', String(options.radius));
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.layers?.length) params.set('layers', options.layers.join(','));

  return apiFetch<MapboxTilequeryResponse>(`/mapbox/tilequery?${params}`);
}

// ── Nearest Unit (convenience using matrix) ───────────────

export interface NearestUnitResult {
  unitIndex: number;
  durationSec: number;
  distanceMeters: number;
}

/**
 * Find the nearest unit to a call location using the Mapbox Matrix API.
 * @param callLocation [lng, lat] of the call
 * @param unitLocations Array of [lng, lat] for each available unit
 * @returns Sorted array of nearest units with travel time
 */
export async function findNearestUnits(
  callLocation: [number, number],
  unitLocations: Array<[number, number]>
): Promise<NearestUnitResult[]> {
  if (unitLocations.length === 0) return [];

  // Call location first, then all unit locations
  const coordinates = [callLocation, ...unitLocations];
  const sources = [0]; // Only the call is a source
  const destinations = unitLocations.map((_, i) => i + 1); // Units are destinations

  const data = await mapboxMatrix(coordinates, { sources, destinations });

  if (!data.durations?.[0]) return [];

  const results: NearestUnitResult[] = data.durations[0]
    .map((duration, idx) => ({
      unitIndex: idx,
      durationSec: duration ?? Infinity,
      distanceMeters: data.distances?.[0]?.[idx] ?? 0,
    }))
    .filter(r => Number.isFinite(r.durationSec))
    .sort((a, b) => a.durationSec - b.durationSec);

  return results;
}

// ── Optimization (Traveling Salesman) ─────────────────────

export interface MapboxOptimizationResponse {
  trips: Array<{
    geometry: { type: 'LineString'; coordinates: [number, number][] };
    duration: number;
    distance: number;
    legs: Array<{
      duration: number;
      distance: number;
      steps: Array<{
        maneuver: { instruction: string; type: string };
        duration: number;
        distance: number;
        name: string;
      }>;
    }>;
  }>;
  waypoints: Array<{
    name: string;
    location: [number, number];
    trips_index: number;
    waypoint_index: number;
  }>;
}

export async function mapboxOptimization(
  coordinates: Array<[number, number]>,
  options?: { profile?: string; steps?: boolean; roundtrip?: boolean; source?: string; destination?: string }
): Promise<MapboxOptimizationResponse> {
  const params = new URLSearchParams({ coordinates: coordsToParam(coordinates) });
  if (options?.profile) params.set('profile', options.profile);
  if (options?.source) params.set('source', options.source);
  if (options?.destination) params.set('destination', options.destination);
  if (options?.roundtrip != null) params.set('roundtrip', String(options.roundtrip));
  return apiFetch<MapboxOptimizationResponse>(`/mapbox/optimization?${params}`);
}

// ── Datasets API ──────────────────────────────────────────
// Mapbox Developer Cheatsheet: Datasets API for managing custom vector data.

export interface MapboxDataset {
  id: string;
  owner: string;
  name: string;
  description: string;
  created: string;
  modified: string;
  features: number;
  size: number;
  bounds?: [number, number, number, number];
}

export async function mapboxListDatasets(): Promise<MapboxDataset[]> {
  const data = await apiFetch<{ datasets: MapboxDataset[] }>('/mapbox/datasets');
  return data.datasets;
}

export async function mapboxCreateDataset(
  name: string,
  description?: string
): Promise<MapboxDataset> {
  return apiFetch<MapboxDataset>('/mapbox/datasets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description }),
  });
}

export async function mapboxGetDataset(datasetId: string): Promise<MapboxDataset> {
  return apiFetch<MapboxDataset>(`/mapbox/datasets/${encodeURIComponent(datasetId)}`);
}

export async function mapboxDeleteDataset(datasetId: string): Promise<void> {
  await apiFetch(`/mapbox/datasets/${encodeURIComponent(datasetId)}`, { method: 'DELETE' });
}

export async function mapboxListDatasetFeatures(
  datasetId: string,
  options?: { limit?: number; start?: string }
): Promise<GeoJSON.FeatureCollection> {
  const params = new URLSearchParams();
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.start) params.set('start', options.start);
  const qs = params.toString();
  return apiFetch<GeoJSON.FeatureCollection>(
    `/mapbox/datasets/${encodeURIComponent(datasetId)}/features${qs ? `?${qs}` : ''}`
  );
}

export async function mapboxPutDatasetFeature(
  datasetId: string,
  featureId: string,
  feature: { geometry: GeoJSON.Geometry; properties?: Record<string, unknown> }
): Promise<GeoJSON.Feature> {
  return apiFetch<GeoJSON.Feature>(
    `/mapbox/datasets/${encodeURIComponent(datasetId)}/features/${encodeURIComponent(featureId)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(feature),
    }
  );
}

export async function mapboxDeleteDatasetFeature(
  datasetId: string,
  featureId: string
): Promise<void> {
  await apiFetch(
    `/mapbox/datasets/${encodeURIComponent(datasetId)}/features/${encodeURIComponent(featureId)}`,
    { method: 'DELETE' }
  );
}

// Unified Mapbox API client — calls server-side proxy endpoints
import { apiFetch } from '../hooks/useApi';

export interface GeocodeFeature {
  id: string;
  place_name: string;
  center: [number, number]; // [lng, lat]
  place_type: string[];
  relevance: number;
  text: string;
}

export interface DirectionStep {
  maneuver: { instruction: string; type: string; modifier?: string };
  distance: number; // meters
  duration: number; // seconds
  name: string;
}

export interface DirectionsRoute {
  distance: number; // meters
  duration: number; // seconds (with traffic)
  duration_typical?: number; // seconds (without traffic)
  geometry: GeoJSON.LineString;
  legs: {
    distance: number;
    duration: number;
    steps: DirectionStep[];
    summary: string;
  }[];
  summary?: string;
}

export interface IsochroneContour {
  center: [number, number];
  geometry: GeoJSON.Polygon;
  minutes: number;
}

export interface MatrixResult {
  durations: number[][];
  distances: number[][];
  destinations: { location: [number, number]; name?: string }[];
  sources: { location: [number, number]; name?: string }[];
}

export interface OptimizationResult {
  geometry: GeoJSON.LineString;
  distance: number;
  duration: number;
  waypoints: { location: [number, number]; waypoint_index: number }[];
  trips: { geometry: GeoJSON.LineString }[];
}

export interface MapMatchResult {
  code: string;
  matchings?: {
    confidence: number;
    geometry: GeoJSON.LineString;
    distance: number;
    duration: number;
  }[];
}

// ─── Geocoding ─────────────────────────────────────────────

export async function forwardGeocode(q: string, limit = 5, types?: string) {
  const params = new URLSearchParams({ q, limit: String(limit) });
  if (types) params.set('types', types);
  const data = await apiFetch<{ features: GeocodeFeature[] }>(
    `/mapbox/geocode?${params}`
  );
  return data.features;
}

export async function reverseGeocode(lng: number, lat: number) {
  return apiFetch<{ features: GeocodeFeature[] }>(
    `/mapbox/reverse-geocode?lng=${lng}&lat=${lat}`
  );
}

// ─── Directions ────────────────────────────────────────────

export async function getDirections(
  waypoints: [number, number][], // [lng, lat][]
  profile: 'driving' | 'driving-traffic' | 'walking' | 'cycling' = 'driving-traffic',
  alternatives = false,
) {
  const coords = waypoints.map(([lng, lat]) => `${lng},${lat}`).join(';');
  const params = new URLSearchParams({
    coordinates: coords,
    profile,
    alternatives: String(alternatives),
    overview: 'full',
    geometries: 'geojson',
    steps: 'true',
  });
  return apiFetch<{ routes: DirectionsRoute[] }>(`/mapbox/directions?${params}`);
}

// ─── Isochrone ─────────────────────────────────────────────

export async function getIsochrone(
  lng: number,
  lat: number,
  minutes: number[] = [5, 10],
  profile: 'driving' | 'walking' | 'cycling' = 'driving',
) {
  const mins = minutes.join(',');
  return apiFetch<{ features: IsochroneContour[] }>(
    `/mapbox/isochrone?lng=${lng}&lat=${lat}&minutes=${mins}&profile=${profile}&polygons=true`
  );
}

// ─── Matrix ────────────────────────────────────────────────

export async function getMatrix(
  coordinates: [number, number][],
  profile: 'driving' | 'driving-traffic' | 'walking' | 'cycling' = 'driving',
  options?: { sources?: number[]; destinations?: number[] },
) {
  const coords = coordinates.map(([lng, lat]) => `${lng},${lat}`).join(';');
  const params = new URLSearchParams({
    coordinates: coords,
    profile,
    annotations: 'duration,distance',
  });
  if (options?.sources) params.set('sources', options.sources.join(';'));
  if (options?.destinations) params.set('destinations', options.destinations.join(';'));
  return apiFetch<MatrixResult & { code?: string }>(`/mapbox/matrix?${params}`);
}

// ─── Optimization ──────────────────────────────────────────

export async function getOptimizedRoute(
  waypoints: [number, number][],
  profile: 'driving' | 'driving-traffic' = 'driving',
  source: 'first' | 'any' = 'any',
  destination: 'last' | 'any' = 'any',
  roundtrip = false,
) {
  const coords = waypoints.map(([lng, lat]) => `${lng},${lat}`).join(';');
  const params = new URLSearchParams({
    coordinates: coords,
    profile,
    source,
    destination,
    roundtrip: String(roundtrip),
  });
  return apiFetch<OptimizationResult>(`/mapbox/optimization?${params}`);
}

// ─── Map Matching ──────────────────────────────────────────

export async function matchToRoad(
  coordinates: [number, number][],
  profile: 'driving' | 'walking' | 'cycling' = 'driving',
) {
  return apiFetch<MapMatchResult>(`/mapbox/map-matching`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ coordinates, profile }),
  });
}

// ─── Tilequery ─────────────────────────────────────────────

export async function tileQuery(
  lng: number,
  lat: number,
  radius = 50,
  limit = 10,
  layer?: string,
) {
  const params = new URLSearchParams({
    lng: String(lng),
    lat: String(lat),
    radius: String(radius),
    limit: String(limit),
  });
  if (layer) params.set('layer', layer);
  return apiFetch<any>(`/mapbox/tilequery?${params}`);
}

// ─── Static Map ────────────────────────────────────────────

export async function getStaticMapUrl(
  lng: number,
  lat: number,
  zoom = 14,
  width = 600,
  height = 400,
  style = 'mapbox/dark-v11',
) {
  const params = new URLSearchParams({
    lng: String(lng),
    lat: String(lat),
    zoom: String(zoom),
    width: String(width),
    height: String(height),
    style,
  });
  return apiFetch<{ url: string; attribution: string }>(
    `/mapbox/static-map?${params}`
  );
}

// ─── Token Status ───────────────────────────────────────────

export async function getTokenStatus() {
  return apiFetch<{ configured: boolean; valid: boolean; tokenPrefix?: string }>(
    '/mapbox/token-status'
  );
}

// ============================================================
// RMPG Flex — Mapbox API Service
// ============================================================
// Centralized proxy for Mapbox web service APIs: Geocoding,
// Directions, Isochrone, Matrix, Static Images, Map Matching,
// and Tilequery. All calls go through the server to protect
// the access token and enforce rate limiting.
// ============================================================

import { getDb } from '../models/database';
import { decryptApiKey } from './serveManagerClient';
import { logger } from './logger';

// ── Token Resolution ──────────────────────────────────────

let _cachedToken: string | null = null;
let _tokenCacheTime = 0;
const TOKEN_CACHE_TTL_MS = 5 * 60 * 1000;

export function getMapboxAccessToken(): string | null {
  const now = Date.now();
  if (_cachedToken && now - _tokenCacheTime < TOKEN_CACHE_TTL_MS) return _cachedToken;

  // 1. Environment variable
  const envToken = (process.env.MAPBOX_ACCESS_TOKEN || '').trim();
  if (envToken) {
    _cachedToken = envToken;
    _tokenCacheTime = now;
    return envToken;
  }

  // 2. Database system_config
  try {
    const db = getDb();
    for (const key of ['mapbox_api_key', 'mapbox_access_token']) {
      const row = db.prepare(
        "SELECT config_value FROM system_config WHERE config_key = ? AND category = 'integrations' AND is_active = 1 LIMIT 1"
      ).get(key) as { config_value?: string } | undefined;
      if (!row?.config_value) continue;
      let val: string;
      try {
        val = decryptApiKey(row.config_value);
      } catch {
        val = row.config_value.startsWith('pk.') || row.config_value.startsWith('sk.')
          ? row.config_value : '';
      }
      if (val) {
        _cachedToken = val;
        _tokenCacheTime = now;
        return val;
      }
    }
  } catch (err) {
    logger.warn({ err }, '[mapboxApi] Failed to read token from DB');
  }

  return null;
}

// ── Rate Limiting ─────────────────────────────────────────

let lastRequestMs = 0;
const MIN_INTERVAL_MS = 100; // 10 req/s

async function throttle(): Promise<void> {
  const now = Date.now();
  const wait = MIN_INTERVAL_MS - (now - lastRequestMs);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastRequestMs = Date.now();
}

// ── Fetch Helper ──────────────────────────────────────────

const TIMEOUT_MS = 15_000;

async function mapboxFetch(url: string): Promise<any> {
  await throttle();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Mapbox API ${res.status}: ${body.slice(0, 200)}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

// ── Geocoding API (v6) ────────────────────────────────────

export interface MapboxGeocodingResult {
  name: string;
  full_address: string;
  latitude: number;
  longitude: number;
  place_type: string;
  relevance: number;
}

/** Forward geocode an address string via Mapbox Geocoding API */
export async function mapboxGeocode(
  query: string,
  options?: { limit?: number; proximity?: [number, number]; country?: string; types?: string }
): Promise<MapboxGeocodingResult[]> {
  const token = getMapboxAccessToken();
  if (!token) throw new Error('Mapbox access token not configured');

  const params = new URLSearchParams({
    q: query,
    access_token: token,
    limit: String(options?.limit ?? 5),
    language: 'en',
  });
  if (options?.proximity) params.set('proximity', options.proximity.join(','));
  if (options?.country) params.set('country', options.country);
  if (options?.types) params.set('types', options.types);

  const data = await mapboxFetch(
    `https://api.mapbox.com/search/geocode/v6/forward?${params}`
  );

  return (data.features || []).map((f: any) => ({
    name: f.properties?.name || '',
    full_address: f.properties?.full_address || f.properties?.place_formatted || '',
    latitude: f.geometry?.coordinates?.[1] ?? 0,
    longitude: f.geometry?.coordinates?.[0] ?? 0,
    place_type: f.properties?.feature_type || '',
    relevance: f.properties?.relevance ?? 0,
  }));
}

/** Reverse geocode coordinates via Mapbox Geocoding API */
export async function mapboxReverseGeocode(
  lng: number, lat: number,
  options?: { types?: string; limit?: number }
): Promise<MapboxGeocodingResult[]> {
  const token = getMapboxAccessToken();
  if (!token) throw new Error('Mapbox access token not configured');

  const params = new URLSearchParams({
    access_token: token,
    limit: String(options?.limit ?? 1),
    language: 'en',
  });
  if (options?.types) params.set('types', options.types);

  const data = await mapboxFetch(
    `https://api.mapbox.com/search/geocode/v6/reverse?longitude=${lng}&latitude=${lat}&${params}`
  );

  return (data.features || []).map((f: any) => ({
    name: f.properties?.name || '',
    full_address: f.properties?.full_address || f.properties?.place_formatted || '',
    latitude: f.geometry?.coordinates?.[1] ?? 0,
    longitude: f.geometry?.coordinates?.[0] ?? 0,
    place_type: f.properties?.feature_type || '',
    relevance: f.properties?.relevance ?? 0,
  }));
}

// ── Isochrone API ─────────────────────────────────────────

export interface MapboxIsochroneResult {
  type: 'FeatureCollection';
  features: GeoJSON.Feature[];
}

/** Get isochrone (travel time) polygons from Mapbox */
export async function mapboxIsochrone(
  lng: number, lat: number,
  options?: {
    profile?: 'driving' | 'walking' | 'cycling';
    contours_minutes?: number[];
    polygons?: boolean;
    generalize?: number;
  }
): Promise<MapboxIsochroneResult> {
  const token = getMapboxAccessToken();
  if (!token) throw new Error('Mapbox access token not configured');

  const profile = options?.profile ?? 'driving';
  const minutes = options?.contours_minutes ?? [5, 10, 15];
  const params = new URLSearchParams({
    access_token: token,
    contours_minutes: minutes.join(','),
    polygons: String(options?.polygons !== false),
  });
  if (options?.generalize != null) params.set('generalize', String(options.generalize));

  return mapboxFetch(
    `https://api.mapbox.com/isochrone/v1/mapbox/${profile}/${lng},${lat}?${params}`
  );
}

// ── Matrix API ────────────────────────────────────────────

export interface MapboxMatrixResult {
  durations: (number | null)[][];
  distances: (number | null)[][] | null;
  sources: Array<{ location: [number, number]; name: string }>;
  destinations: Array<{ location: [number, number]; name: string }>;
}

/** Get travel time/distance matrix between multiple points */
export async function mapboxMatrix(
  coordinates: Array<[number, number]>, // [lng, lat][]
  options?: {
    profile?: 'driving' | 'walking' | 'cycling';
    annotations?: ('duration' | 'distance')[];
    sources?: number[];
    destinations?: number[];
  }
): Promise<MapboxMatrixResult> {
  const token = getMapboxAccessToken();
  if (!token) throw new Error('Mapbox access token not configured');

  const profile = options?.profile ?? 'driving';
  const coordStr = coordinates.map(c => c.join(',')).join(';');
  const params = new URLSearchParams({
    access_token: token,
    annotations: (options?.annotations ?? ['duration', 'distance']).join(','),
  });
  if (options?.sources) params.set('sources', options.sources.join(';'));
  if (options?.destinations) params.set('destinations', options.destinations.join(';'));

  return mapboxFetch(
    `https://api.mapbox.com/directions-matrix/v1/mapbox/${profile}/${coordStr}?${params}`
  );
}

// ── Static Images API ─────────────────────────────────────

/** Build a Mapbox Static Images API URL (returns URL string, not fetched) */
export function mapboxStaticImageUrl(options: {
  lng: number;
  lat: number;
  zoom: number;
  width: number;
  height: number;
  style?: string;
  marker?: { lng: number; lat: number; color?: string; label?: string };
  markers?: Array<{ lng: number; lat: number; color?: string; label?: string }>;
  overlay?: string;
  bearing?: number;
  pitch?: number;
  highRes?: boolean;
}): string {
  const token = getMapboxAccessToken();
  if (!token) throw new Error('Mapbox access token not configured');

  const style = options.style ?? 'mapbox/dark-v11';
  const retina = options.highRes ? '@2x' : '';

  // Build marker overlay string
  let overlayStr = '';
  const allMarkers = [
    ...(options.marker ? [options.marker] : []),
    ...(options.markers ?? []),
  ];
  if (allMarkers.length > 0) {
    const pins = allMarkers.map(m => {
      const color = (m.color ?? 'd4a017').replace('#', '');
      const label = m.label ?? '';
      // Mapbox spec: pin-s+color for no label, pin-s-X+color for label X
      const labelPart = label ? `-${label}` : '';
      return `pin-s${labelPart}+${color}(${m.lng},${m.lat})`;
    }).join(',');
    overlayStr = `/${pins}`;
  }
  if (options.overlay) {
    overlayStr = `/${options.overlay}`;
  }

  const center = `${options.lng},${options.lat},${options.zoom}`;
  const bearing = options.bearing ?? 0;
  const pitch = options.pitch ?? 0;
  const size = `${options.width}x${options.height}`;

  return `https://api.mapbox.com/styles/v1/${style}/static${overlayStr}/${center},${bearing},${pitch}/${size}${retina}?access_token=${token}`;
}

/** Fetch a static map image as a Buffer */
export async function mapboxStaticImage(options: Parameters<typeof mapboxStaticImageUrl>[0]): Promise<Buffer> {
  const url = mapboxStaticImageUrl(options);
  await throttle();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Mapbox Static API ${res.status}`);
    const arrayBuf = await res.arrayBuffer();
    return Buffer.from(arrayBuf);
  } finally {
    clearTimeout(timeout);
  }
}

// ── Map Matching API ──────────────────────────────────────

export interface MapboxMapMatchResult {
  matchings: Array<{
    confidence: number;
    geometry: GeoJSON.LineString;
    duration: number;
    distance: number;
    legs: Array<{ duration: number; distance: number }>;
  }>;
  tracepoints: Array<{
    name: string;
    location: [number, number];
    matchings_index: number;
    waypoint_index: number;
  } | null>;
}

/** Snap GPS traces to roads via Mapbox Map Matching API */
export async function mapboxMapMatch(
  coordinates: Array<[number, number]>, // [lng, lat][]
  options?: {
    profile?: 'driving' | 'walking' | 'cycling';
    geometries?: 'geojson' | 'polyline';
    timestamps?: number[];
    radiuses?: number[];
    overview?: 'full' | 'simplified' | 'false';
  }
): Promise<MapboxMapMatchResult> {
  const token = getMapboxAccessToken();
  if (!token) throw new Error('Mapbox access token not configured');

  const profile = options?.profile ?? 'driving';
  const coordStr = coordinates.map(c => c.join(',')).join(';');
  const params = new URLSearchParams({
    access_token: token,
    geometries: options?.geometries ?? 'geojson',
    overview: options?.overview ?? 'full',
  });
  if (options?.timestamps) params.set('timestamps', options.timestamps.join(';'));
  if (options?.radiuses) params.set('radiuses', options.radiuses.join(';'));

  return mapboxFetch(
    `https://api.mapbox.com/matching/v5/mapbox/${profile}/${coordStr}?${params}`
  );
}

// ── Tilequery API ─────────────────────────────────────────

export interface MapboxTilequeryResult {
  type: 'FeatureCollection';
  features: Array<GeoJSON.Feature & {
    properties: Record<string, unknown> & {
      tilequery: { distance: number; layer: string };
    };
  }>;
}

/** Query features near a point from a vector tileset */
export async function mapboxTilequery(
  tilesetId: string,
  lng: number, lat: number,
  options?: { radius?: number; limit?: number; layers?: string[] }
): Promise<MapboxTilequeryResult> {
  const token = getMapboxAccessToken();
  if (!token) throw new Error('Mapbox access token not configured');

  const params = new URLSearchParams({
    access_token: token,
    radius: String(options?.radius ?? 1000),
    limit: String(options?.limit ?? 10),
  });
  if (options?.layers?.length) params.set('layers', options.layers.join(','));

  return mapboxFetch(
    `https://api.mapbox.com/v4/${tilesetId}/tilequery/${lng},${lat}.json?${params}`
  );
}

// ── Directions API (server-side) ──────────────────────────

export interface MapboxDirectionsResult {
  routes: Array<{
    geometry: GeoJSON.LineString;
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

/** Get driving/walking/cycling directions via Mapbox Directions API */
export async function mapboxDirections(
  coordinates: Array<[number, number]>, // [lng, lat][]
  options?: {
    profile?: 'driving' | 'driving-traffic' | 'walking' | 'cycling';
    geometries?: 'geojson' | 'polyline';
    overview?: 'full' | 'simplified' | 'false';
    steps?: boolean;
    alternatives?: boolean;
  }
): Promise<MapboxDirectionsResult> {
  const token = getMapboxAccessToken();
  if (!token) throw new Error('Mapbox access token not configured');

  const profile = options?.profile ?? 'driving';
  const coordStr = coordinates.map(c => c.join(',')).join(';');
  const params = new URLSearchParams({
    access_token: token,
    geometries: options?.geometries ?? 'geojson',
    overview: options?.overview ?? 'full',
    steps: String(options?.steps ?? false),
    alternatives: String(options?.alternatives ?? false),
  });

  return mapboxFetch(
    `https://api.mapbox.com/directions/v5/mapbox/${profile}/${coordStr}?${params}`
  );
}

// ── Optimization API (Traveling Salesman) ─────────────────

export interface MapboxOptimizationResult {
  trips: Array<{
    geometry: GeoJSON.LineString;
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

/** Optimize a multi-stop route (traveling salesman) via Mapbox Optimization API */
export async function mapboxOptimization(
  coordinates: Array<[number, number]>,
  options?: {
    profile?: 'driving' | 'driving-traffic' | 'walking' | 'cycling';
    steps?: boolean;
    roundtrip?: boolean;
    source?: 'any' | 'first';
    destination?: 'any' | 'last';
    geometries?: 'geojson' | 'polyline';
    overview?: 'full' | 'simplified' | 'false';
  }
): Promise<MapboxOptimizationResult> {
  const token = getMapboxAccessToken();
  if (!token) throw new Error('Mapbox access token not configured');

  const profile = options?.profile ?? 'driving';
  const coordStr = coordinates.map(c => c.join(',')).join(';');
  const params = new URLSearchParams({
    access_token: token,
    geometries: options?.geometries ?? 'geojson',
    overview: options?.overview ?? 'full',
    steps: String(options?.steps ?? false),
    roundtrip: String(options?.roundtrip ?? true),
  });
  if (options?.source) params.set('source', options.source);
  if (options?.destination) params.set('destination', options.destination);

  return mapboxFetch(
    `https://api.mapbox.com/optimized-trips/v1/mapbox/${profile}/${coordStr}?${params}`
  );
}

// ── Datasets API ──────────────────────────────────────────
// Mapbox Developer Cheatsheet: Datasets API for managing
// custom vector data (create, read, update, delete features).
// The dataset owner is derived from the access token.
// ──────────────────────────────────────────────────────────

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

export interface MapboxDatasetFeature {
  id: string;
  type: 'Feature';
  geometry: GeoJSON.Geometry;
  properties: Record<string, unknown>;
}

/**
 * List all datasets owned by the account associated with the access token.
 */
export async function mapboxListDatasets(): Promise<MapboxDataset[]> {
  const token = getMapboxAccessToken();
  if (!token) throw new Error('Mapbox access token not configured');

  // Extract the username from the token (pk.eyXXX.username.XXXX)
  // Mapbox tokens encode the owner in the payload
  const username = await resolveMapboxUsername(token);
  return mapboxFetch(
    `https://api.mapbox.com/datasets/v1/${username}?access_token=${encodeURIComponent(token)}`
  );
}

/**
 * Create a new empty dataset.
 */
export async function mapboxCreateDataset(
  name: string,
  description?: string
): Promise<MapboxDataset> {
  const token = getMapboxAccessToken();
  if (!token) throw new Error('Mapbox access token not configured');

  const username = await resolveMapboxUsername(token);
  return mapboxFetchWithBody(
    `https://api.mapbox.com/datasets/v1/${username}?access_token=${encodeURIComponent(token)}`,
    'POST',
    { name, description: description || '' }
  );
}

/**
 * Get a single dataset's metadata.
 */
export async function mapboxGetDataset(datasetId: string): Promise<MapboxDataset> {
  const token = getMapboxAccessToken();
  if (!token) throw new Error('Mapbox access token not configured');

  const username = await resolveMapboxUsername(token);
  return mapboxFetch(
    `https://api.mapbox.com/datasets/v1/${username}/${encodeURIComponent(datasetId)}?access_token=${encodeURIComponent(token)}`
  );
}

/**
 * Delete a dataset.
 */
export async function mapboxDeleteDataset(datasetId: string): Promise<void> {
  const token = getMapboxAccessToken();
  if (!token) throw new Error('Mapbox access token not configured');

  const username = await resolveMapboxUsername(token);
  await throttle();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://api.mapbox.com/datasets/v1/${username}/${encodeURIComponent(datasetId)}?access_token=${encodeURIComponent(token)}`,
      { method: 'DELETE', signal: controller.signal }
    );
    if (!res.ok && res.status !== 204) {
      const body = await res.text().catch(() => '');
      throw new Error(`Mapbox Datasets DELETE ${res.status}: ${body.slice(0, 200)}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * List features in a dataset.
 */
export async function mapboxListDatasetFeatures(
  datasetId: string,
  options?: { limit?: number; start?: string }
): Promise<GeoJSON.FeatureCollection> {
  const token = getMapboxAccessToken();
  if (!token) throw new Error('Mapbox access token not configured');

  const username = await resolveMapboxUsername(token);
  const params = new URLSearchParams({
    access_token: token,
  });
  if (options?.limit) params.set('limit', String(Math.min(options.limit, 100)));
  if (options?.start) params.set('start', options.start);

  return mapboxFetch(
    `https://api.mapbox.com/datasets/v1/${username}/${encodeURIComponent(datasetId)}/features?${params}`
  );
}

/**
 * Insert or update a feature in a dataset.
 */
export async function mapboxPutDatasetFeature(
  datasetId: string,
  featureId: string,
  feature: { type: 'Feature'; geometry: GeoJSON.Geometry; properties?: Record<string, unknown> }
): Promise<MapboxDatasetFeature> {
  const token = getMapboxAccessToken();
  if (!token) throw new Error('Mapbox access token not configured');

  const username = await resolveMapboxUsername(token);
  return mapboxFetchWithBody(
    `https://api.mapbox.com/datasets/v1/${username}/${encodeURIComponent(datasetId)}/features/${encodeURIComponent(featureId)}?access_token=${encodeURIComponent(token)}`,
    'PUT',
    feature
  );
}

/**
 * Delete a feature from a dataset.
 */
export async function mapboxDeleteDatasetFeature(
  datasetId: string,
  featureId: string
): Promise<void> {
  const token = getMapboxAccessToken();
  if (!token) throw new Error('Mapbox access token not configured');

  const username = await resolveMapboxUsername(token);
  await throttle();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://api.mapbox.com/datasets/v1/${username}/${encodeURIComponent(datasetId)}/features/${encodeURIComponent(featureId)}?access_token=${encodeURIComponent(token)}`,
      { method: 'DELETE', signal: controller.signal }
    );
    if (!res.ok && res.status !== 204) {
      const body = await res.text().catch(() => '');
      throw new Error(`Mapbox Datasets feature DELETE ${res.status}: ${body.slice(0, 200)}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

// ── Datasets Helpers ──────────────────────────────────────

let _cachedUsername: string | null = null;
let _usernameResolving: Promise<string> | null = null;

async function resolveMapboxUsername(token: string): Promise<string> {
  if (_cachedUsername) return _cachedUsername;

  // Deduplicate concurrent resolution requests
  if (_usernameResolving) return _usernameResolving;

  _usernameResolving = (async () => {
    // Try the v2/me endpoint directly — returns the account username
    try {
      const meRes = await fetch(`https://api.mapbox.com/v2/me?access_token=${encodeURIComponent(token)}`);
      if (meRes.ok) {
        const me = await meRes.json();
        if (me.id) {
          _cachedUsername = me.id;
          return me.id;
        }
      }
    } catch {
      // Fallback below
    }

    // Parse from token if it's a standard Mapbox token structure
    // pk.{base64payload}.{signature} — the payload contains the username
    try {
      const parts = token.split('.');
      if (parts.length >= 2) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
        if (payload.u) {
          _cachedUsername = payload.u;
          return payload.u;
        }
      }
    } catch {
      // Not a standard JWT-like token
    }

    throw new Error('Could not resolve Mapbox username from access token');
  })();

  try {
    return await _usernameResolving;
  } finally {
    _usernameResolving = null;
  }
}

async function mapboxFetchWithBody(url: string, method: string, body: unknown): Promise<any> {
  await throttle();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Mapbox API ${method} ${res.status}: ${text.slice(0, 200)}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

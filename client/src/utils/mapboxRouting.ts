export interface CoordinatePair {
  lat: number;
  lng: number;
}

export interface MapboxRouteSummary {
  eta: string;
  distance: string;
  durationSec: number;
  distanceMeters: number;
  geometry: google.maps.LatLngLiteral[];
}

export interface MapboxMatrixCell {
  durationSec: number | null;
  distanceMeters: number | null;
  eta: string;
  distance: string;
}

export interface MapboxIsochroneContour {
  minutes: number;
  coordinates: [number, number][][];
}

export interface MapboxGeocodeFeature {
  id: string;
  placeName: string;
  center: CoordinatePair;
  address?: string;
}

export interface MapboxMatchedPoint {
  lat: number;
  lng: number;
}

function formatEta(durationSec: number): string {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return '—';
  const minutes = Math.round(durationSec / 60);
  if (minutes < 1) return '<1 min';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining > 0 ? `${hours}h ${remaining}m` : `${hours}h`;
}

function formatDistance(distanceMeters: number): string {
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) return '—';
  const miles = distanceMeters / 1609.344;
  if (miles < 0.1) return '<0.1 mi';
  return `${miles.toFixed(miles >= 10 ? 0 : 1)} mi`;
}

function isFiniteCoordinate(value: CoordinatePair | null | undefined): value is CoordinatePair {
  return !!value && Number.isFinite(value.lat) && Number.isFinite(value.lng);
}

export function getMapboxAccessToken(): string {
  return String(import.meta.env.VITE_MAPBOX_ACCESS_TOKEN || '').trim();
}

export function hasMapboxDirections(): boolean {
  return getMapboxAccessToken().length > 0;
}

async function mapboxFetch<T>(path: string, query: URLSearchParams): Promise<T> {
  const token = getMapboxAccessToken();
  if (!token) throw new Error('Mapbox access token not configured');
  query.set('access_token', token);
  const response = await fetch(`https://api.mapbox.com${path}?${query.toString()}`);
  if (!response.ok) {
    throw new Error(`Mapbox request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

interface MapboxDirectionsResponse {
  routes?: Array<{
    duration?: number;
    distance?: number;
    geometry?: { coordinates?: [number, number][] };
    legs?: Array<{
      duration?: number;
      distance?: number;
      duration_typical?: number;
    }>;
    duration_typical?: number;
  }>;
}

export async function fetchMapboxRoute(origin: CoordinatePair, destination: CoordinatePair): Promise<MapboxRouteSummary | null> {
  if (!isFiniteCoordinate(origin) || !isFiniteCoordinate(destination)) return null;
  const coordinates = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
  const payload = await mapboxFetch<MapboxDirectionsResponse>(
    `/directions/v5/mapbox/driving-traffic/${coordinates}`,
    new URLSearchParams({
      geometries: 'geojson',
      overview: 'full',
      steps: 'false',
      alternatives: 'false',
      annotations: 'distance,duration',
    }),
  );
  const route = payload.routes?.[0];
  if (!route) return null;
  const durationSec = route.duration_typical ?? route.duration ?? route.legs?.[0]?.duration_typical ?? route.legs?.[0]?.duration ?? 0;
  const distanceMeters = route.distance ?? route.legs?.[0]?.distance ?? 0;
  return {
    eta: formatEta(durationSec),
    distance: formatDistance(distanceMeters),
    durationSec,
    distanceMeters,
    geometry: (route.geometry?.coordinates || []).map(([lng, lat]) => ({ lat, lng })),
  };
}

interface MapboxMatrixResponse {
  durations?: Array<Array<number | null>>;
  distances?: Array<Array<number | null>>;
}

export async function fetchMapboxMatrix(
  origins: CoordinatePair[],
  destination: CoordinatePair,
): Promise<MapboxMatrixCell[]> {
  const validOrigins = origins.filter(isFiniteCoordinate);
  if (!isFiniteCoordinate(destination) || validOrigins.length === 0) return [];
  const coordinates = [...validOrigins, destination].map(point => `${point.lng},${point.lat}`).join(';');
  const destinationIndex = String(validOrigins.length);
  const payload = await mapboxFetch<MapboxMatrixResponse>(
    `/directions-matrix/v1/mapbox/driving-traffic/${coordinates}`,
    new URLSearchParams({
      annotations: 'duration,distance',
      sources: validOrigins.map((_, idx) => String(idx)).join(';'),
      destinations: destinationIndex,
    }),
  );
  return validOrigins.map((_, idx) => {
    const durationSec = payload.durations?.[idx]?.[0] ?? null;
    const distanceMeters = payload.distances?.[idx]?.[0] ?? null;
    return {
      durationSec,
      distanceMeters,
      eta: durationSec != null ? formatEta(durationSec) : '—',
      distance: distanceMeters != null ? formatDistance(distanceMeters) : '—',
    };
  });
}

interface MapboxIsochroneResponse {
  features?: Array<{
    properties?: { contour?: number };
    geometry?: { coordinates?: [number, number][][] };
  }>;
}

export async function fetchMapboxIsochrones(
  origin: CoordinatePair,
  contoursMinutes: number[] = [5, 10, 15],
): Promise<MapboxIsochroneContour[]> {
  if (!isFiniteCoordinate(origin)) return [];
  const payload = await mapboxFetch<MapboxIsochroneResponse>(
    `/isochrone/v1/mapbox/driving-traffic/${origin.lng},${origin.lat}`,
    new URLSearchParams({
      contours_minutes: contoursMinutes.join(','),
      polygons: 'true',
      denoise: '1',
      generalize: '50',
    }),
  );
  return (payload.features || []).map(feature => ({
    minutes: Number(feature.properties?.contour || 0),
    coordinates: feature.geometry?.coordinates || [],
  }));
}

interface MapboxMatchingResponse {
  matchings?: Array<{
    geometry?: { coordinates?: [number, number][] };
  }>;
}

export async function fetchMapboxMatchedPath(points: CoordinatePair[]): Promise<MapboxMatchedPoint[]> {
  const validPoints = points.filter(isFiniteCoordinate);
  if (validPoints.length < 2) return [];
  const coordinates = validPoints.map(point => `${point.lng},${point.lat}`).join(';');
  const payload = await mapboxFetch<MapboxMatchingResponse>(
    `/matching/v5/mapbox/driving-traffic/${coordinates}`,
    new URLSearchParams({
      geometries: 'geojson',
      overview: 'full',
      steps: 'false',
      tidy: 'true',
    }),
  );
  return (payload.matchings?.[0]?.geometry?.coordinates || []).map(([lng, lat]) => ({ lat, lng }));
}

interface MapboxGeocodingResponse {
  features?: Array<{
    id?: string;
    place_name?: string;
    center?: [number, number];
    properties?: { address?: string };
  }>;
}

export async function fetchMapboxForwardGeocode(query: string, proximity?: CoordinatePair): Promise<MapboxGeocodeFeature[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const params = new URLSearchParams({
    autocomplete: 'true',
    limit: '5',
    types: 'address,street,place,poi',
  });
  if (isFiniteCoordinate(proximity)) {
    params.set('proximity', `${proximity.lng},${proximity.lat}`);
  }
  const payload = await mapboxFetch<MapboxGeocodingResponse>(
    `/search/geocode/v6/forward`,
    new URLSearchParams({
      ...Object.fromEntries(params.entries()),
      q: trimmed,
    }),
  );
  return (payload.features || []).map(feature => ({
    id: String(feature.id || feature.place_name || Math.random()),
    placeName: String(feature.place_name || ''),
    center: {
      lat: feature.center?.[1] ?? 0,
      lng: feature.center?.[0] ?? 0,
    },
    address: feature.properties?.address,
  }));
}

export async function fetchMapboxReverseGeocode(point: CoordinatePair): Promise<MapboxGeocodeFeature[]> {
  if (!isFiniteCoordinate(point)) return [];
  const payload = await mapboxFetch<MapboxGeocodingResponse>(
    `/search/geocode/v6/reverse`,
    new URLSearchParams({
      longitude: String(point.lng),
      latitude: String(point.lat),
      limit: '5',
      types: 'address,street,place,poi',
    }),
  );
  return (payload.features || []).map(feature => ({
    id: String(feature.id || feature.place_name || Math.random()),
    placeName: String(feature.place_name || ''),
    center: {
      lat: feature.center?.[1] ?? 0,
      lng: feature.center?.[0] ?? 0,
    },
    address: feature.properties?.address,
  }));
}

export function buildMapboxStaticImageUrl(
  center: CoordinatePair,
  options?: {
    zoom?: number;
    width?: number;
    height?: number;
    pinCoordinates?: CoordinatePair[];
  },
): string | null {
  const token = getMapboxAccessToken();
  if (!token || !isFiniteCoordinate(center)) return null;
  const zoom = options?.zoom ?? 14;
  const width = options?.width ?? 800;
  const height = options?.height ?? 500;
  const overlays = (options?.pinCoordinates || [])
    .filter(isFiniteCoordinate)
    .map(point => `pin-s+ef4444(${point.lng},${point.lat})`)
    .join(',');
  const overlayPrefix = overlays ? `${overlays}/` : '';
  return `https://api.mapbox.com/styles/v1/mapbox/dark-v11/static/${overlayPrefix}${center.lng},${center.lat},${zoom}/${width}x${height}?access_token=${encodeURIComponent(token)}`;
}

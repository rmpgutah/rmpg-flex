import { getDb } from '../models/database';
import { broadcastDispatchUpdate } from './websocket';
import { resolveGoogleMapsApiKey } from './configEncryption';

// Lazily resolved so the DB is ready when first used
let _cachedGoogleKey: string | undefined;
let _cacheTime = 0;
let _cacheResolving = false;
const CACHE_TTL_MS = 5 * 60 * 1000; // re-check every 5 min

function getGoogleMapsApiKey(): string | undefined {
  const now = Date.now();
  if ((!_cachedGoogleKey || now - _cacheTime > CACHE_TTL_MS) && !_cacheResolving) {
    _cacheResolving = true;
    _cachedGoogleKey = resolveGoogleMapsApiKey();
    _cacheTime = Date.now();
    _cacheResolving = false;
  }
  return _cachedGoogleKey;
}

// [FIX 54] Add request timeout for geocode API calls
const GEOCODE_TIMEOUT_MS = 10_000;

// [FIX 55] Simple rate limiter for geocode API calls to avoid quota exhaustion
let lastGeocodeFetchMs = 0;
const MIN_GEOCODE_INTERVAL_MS = 100; // 10 req/s max

interface GeocodeResult {
  latitude: number;
  longitude: number;
}

/**
 * Geocode an address string using the Google Geocoding API.
 * Returns { latitude, longitude } or null if geocoding fails.
 */
export async function geocodeAddress(address: string): Promise<GeocodeResult | null> {
  const apiKey = getGoogleMapsApiKey();
  if (!apiKey || !address.trim()) return null;
  // [FIX 56] Validate address length to avoid sending huge payloads
  if (address.length > 500) return null;

  // [FIX 57] Enforce rate limit between API calls
  const now = Date.now();
  const wait = MIN_GEOCODE_INTERVAL_MS - (now - lastGeocodeFetchMs);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastGeocodeFetchMs = Date.now();

  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`;
    // [FIX 58] Add AbortController timeout to prevent hanging requests
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GEOCODE_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) return null;

      const data = await res.json();
      if (data.status === 'OK' && data.results?.length > 0) {
        const loc = data.results[0].geometry?.location;
        // [FIX 59] Null-check geometry.location before accessing lat/lng
        if (!loc || typeof loc.lat !== 'number' || typeof loc.lng !== 'number') return null;
        return { latitude: loc.lat, longitude: loc.lng };
      }
      return null;
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    console.error('[geocode] Error geocoding address:', err);
    return null;
  }
}

/**
 * Reverse-geocode GPS coordinates to a street address using Google Geocoding API.
 * Returns the formatted address string or null if reverse geocoding fails.
 */
export async function reverseGeocodeAddress(lat: number, lng: number): Promise<string | null> {
  const apiKey = getGoogleMapsApiKey();
  if (!apiKey) return null;
  // [FIX 60] Validate coordinate ranges before making API call
  if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${apiKey}`;
    // [FIX 61] Add timeout to reverse geocode fetch
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GEOCODE_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) return null;

      const data = await res.json();
      if (data.status === 'OK' && data.results?.length > 0) {
        return data.results[0].formatted_address || null;
      }
      return null;
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    console.error('[geocode] Error reverse-geocoding:', err);
    return null;
  }
}

// ─── Detailed Reverse Geocode ─────────────────────────────
// Returns road name, nearest intersection, and formatted address
// from Google's Geocoding API address_components.

export interface DetailedGeocodeResult {
  formatted_address: string;
  road_name: string | null;
  nearest_intersection: string | null;
}

/**
 * Reverse-geocode GPS coordinates to get detailed road info.
 * Parses address_components for route (road name) and looks for
 * intersection data in secondary results.
 */
export async function reverseGeocodeDetailed(lat: number, lng: number): Promise<DetailedGeocodeResult | null> {
  const apiKey = getGoogleMapsApiKey();
  if (!apiKey) return null;
  // [FIX 62] Validate coordinates for detailed reverse geocode
  if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) return null;

  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&result_type=street_address|route|intersection&key=${apiKey}`;
    // [FIX 63] Add timeout to detailed reverse geocode fetch
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GEOCODE_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    if (!res.ok) return null;

    const data = await res.json();
    if (data.status !== 'OK' || !data.results?.length) return null;

    const primary = data.results[0];
    const formatted_address = primary.formatted_address || '';

    // Extract road name from address_components
    let road_name: string | null = null;
    for (const comp of (primary.address_components || [])) {
      if (comp.types?.includes('route')) {
        road_name = comp.long_name;
        break;
      }
    }

    // Look for intersection in secondary results
    let nearest_intersection: string | null = null;
    for (const result of data.results) {
      if (result.types?.includes('intersection')) {
        nearest_intersection = result.formatted_address;
        break;
      }
      // Also check address_components for intersection type
      for (const comp of (result.address_components || [])) {
        if (comp.types?.includes('intersection')) {
          nearest_intersection = comp.long_name;
          break;
        }
      }
      if (nearest_intersection) break;
    }

    return { formatted_address, road_name, nearest_intersection };
  } catch (err) {
    console.error('[geocode] Error in detailed reverse geocode:', err);
    return null;
  }
}

/**
 * If a call has an address but no coordinates, geocode it and update the DB.
 * Runs asynchronously — does not block the response.
 * After successful geocoding, broadcasts the updated call so the map updates in real-time.
 */
export function geocodeCallIfNeeded(callId: number, address: string, lat: any, lng: any): void {
  // [FIX 102] Validate callId is a positive integer
  if (!callId || typeof callId !== 'number' || callId < 1) return;
  if (lat || lng || !address || !address.trim()) return;

  geocodeAddress(address).then((result) => {
    if (!result) return;
    try {
      const db = getDb();
      db.prepare('UPDATE calls_for_service SET latitude = ?, longitude = ? WHERE id = ?')
        .run(result.latitude, result.longitude, callId);
      console.log(`[geocode] Geocoded call ${callId}: ${result.latitude}, ${result.longitude}`);

      // Broadcast updated call so map markers appear in real-time
      const updatedCall = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(callId);
      if (updatedCall) {
        broadcastDispatchUpdate({ action: 'call_updated', call: updatedCall });
      }
    } catch (err) {
      console.error('[geocode] Failed to update call coordinates:', err);
    }
  });
}

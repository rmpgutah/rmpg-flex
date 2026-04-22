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

// ── Nominatim-specific 24h cache + 1-req/sec throttle (OSM usage policy) ──
// Nominatim requires ≤1 req/sec and encourages aggressive client-side caching.
// https://operations.osmfoundation.org/policies/nominatim/
const osmCache = new Map<string, { at: number; result: GeocodeResult | null }>();
const OSM_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
let lastOsmCall = 0;
const OSM_MIN_INTERVAL_MS = 1000;

async function throttledOsmGeocode(address: string): Promise<GeocodeResult | null> {
  const key = address.toLowerCase().trim();
  const cached = osmCache.get(key);
  if (cached && Date.now() - cached.at < OSM_CACHE_TTL_MS) return cached.result;
  const elapsed = Date.now() - lastOsmCall;
  if (elapsed < OSM_MIN_INTERVAL_MS) await new Promise(r => setTimeout(r, OSM_MIN_INTERVAL_MS - elapsed));
  lastOsmCall = Date.now();
  const result = await geocodeWithNominatim(address);
  osmCache.set(key, { at: Date.now(), result });
  return result;
}

/**
 * Geocode an address string.
 *
 * NOTE: Despite the design doc naming "Google primary + Nominatim fallback",
 * this server has no Google geocoding path — Nominatim has been the primary
 * all along. Keeping Nominatim primary and layering a 24h in-memory cache
 * plus the 1-req/sec throttle required by OSM usage policy.
 *
 * Returns { latitude, longitude } or null if geocoding fails.
 */
export async function geocodeAddress(address: string): Promise<GeocodeResult | null> {
  if (!address.trim()) return null;
  if (address.length > 500) return null;

  // Global rate limit (10 req/s for internal callers)
  const now = Date.now();
  const wait = MIN_GEOCODE_INTERVAL_MS - (now - lastGeocodeFetchMs);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastGeocodeFetchMs = Date.now();

  // Cached + throttled Nominatim (24h TTL, 1 req/sec floor)
  return throttledOsmGeocode(address);
}

/**
 * Free geocoding fallback via OpenStreetMap Nominatim.
 * No API key required. Rate limit: 1 req/sec (enforced by MIN_GEOCODE_INTERVAL_MS).
 * Usage policy: https://operations.osmfoundation.org/policies/nominatim/
 */
async function geocodeWithNominatim(address: string): Promise<GeocodeResult | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1&countrycodes=us`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GEOCODE_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'RMPG-Flex-CAD/5.7 (rmpgutah.us)' },
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0 && data[0].lat && data[0].lon) {
        return { latitude: parseFloat(data[0].lat), longitude: parseFloat(data[0].lon) };
      }
      return null;
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return null;
  }
}

/**
 * Reverse-geocode GPS coordinates to a street address using Google Geocoding API.
 * Returns the formatted address string or null if reverse geocoding fails.
 */
export async function reverseGeocodeAddress(lat: number, lng: number): Promise<string | null> {
  if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  // Primary: Nominatim reverse geocoding (free)
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GEOCODE_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'RMPG-Flex-CAD/5.7 (rmpgutah.us)' },
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data.display_name || null;
    } finally {
      clearTimeout(timeout);
    }
  } catch {
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
  if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) return null;

  // Primary: Nominatim reverse geocoding with address details (free)
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1&zoom=18`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GEOCODE_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'RMPG-Flex-CAD/5.7 (rmpgutah.us)' },
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data.display_name) return null;

      const addr = data.address || {};
      const road_name = addr.road || addr.highway || addr.pedestrian || null;
      // Nominatim doesn't provide intersection directly — approximate from nearby road
      const nearest_intersection = addr.neighbourhood || addr.suburb || null;

      return {
        formatted_address: data.display_name,
        road_name,
        nearest_intersection,
      };
    } finally {
      clearTimeout(timeout);
    }
  } catch {
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

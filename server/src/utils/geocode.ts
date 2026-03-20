import { getDb } from '../models/database';
import { broadcastDispatchUpdate } from './websocket';

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

// ─── In-memory LRU geocode cache ─────────────────────────
const geocodeCache = new Map<string, { lat: number; lng: number }>();
const MAX_CACHE = 2000;

function cacheKey(address: string): string {
  return address.trim().toLowerCase();
}

function cacheSet(address: string, lat: number, lng: number): void {
  const key = cacheKey(address);
  geocodeCache.set(key, { lat, lng });
  // Evict oldest half when over limit
  if (geocodeCache.size > MAX_CACHE) {
    const keys = [...geocodeCache.keys()];
    const evictCount = Math.floor(MAX_CACHE / 2);
    for (let i = 0; i < evictCount; i++) {
      geocodeCache.delete(keys[i]);
    }
  }
}

function cacheGet(address: string): { lat: number; lng: number } | undefined {
  return geocodeCache.get(cacheKey(address));
}

interface GeocodeResult {
  latitude: number;
  longitude: number;
}

/**
 * Geocode an address string using the Google Geocoding API.
 * Returns { latitude, longitude } or null if geocoding fails.
 */
export async function geocodeAddress(address: string): Promise<GeocodeResult | null> {
  if (!GOOGLE_MAPS_API_KEY || !address.trim()) return null;

  // Check cache first
  const cached = cacheGet(address);
  if (cached) {
    return { latitude: cached.lat, longitude: cached.lng };
  }

  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${GOOGLE_MAPS_API_KEY}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;

    const data = await res.json();
    if (data.status === 'OK' && data.results?.length > 0) {
      const loc = data.results[0].geometry.location;
      cacheSet(address, loc.lat, loc.lng);
      return { latitude: loc.lat, longitude: loc.lng };
    }
    return null;
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
  if (!GOOGLE_MAPS_API_KEY) return null;

  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GOOGLE_MAPS_API_KEY}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;

    const data = await res.json();
    if (data.status === 'OK' && data.results?.length > 0) {
      return data.results[0].formatted_address;
    }
    return null;
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
  if (!GOOGLE_MAPS_API_KEY) return null;

  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&result_type=street_address|route|intersection&key=${GOOGLE_MAPS_API_KEY}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
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
  if ((lat != null && lng != null) || !address.trim()) return;

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
  }).catch(err => {
    console.warn(`[geocode] Failed to geocode call ${callId}:`, err?.message || err);
  });
}

// ─── Batch Geocode Ungeocoded Calls ───────────────────────
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Find all calls_for_service that have an address but no lat/lng,
 * geocode them one at a time with a 1-second delay between requests.
 */
export async function batchGeocodeUngeocoded(): Promise<{ success: number; failed: number }> {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, call_number, location_address
    FROM calls_for_service
    WHERE (latitude IS NULL OR longitude IS NULL)
      AND location_address IS NOT NULL
      AND length(location_address) > 2
  `).all() as { id: number; call_number: string; location_address: string }[];

  if (rows.length === 0) {
    console.log('[Geocoder] Batch: no ungeocoded calls found');
    return { success: 0, failed: 0 };
  }

  console.log(`[Geocoder] Batch: starting — ${rows.length} calls to geocode`);
  let success = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      const result = await geocodeAddress(row.location_address);
      if (result) {
        db.prepare('UPDATE calls_for_service SET latitude = ?, longitude = ? WHERE id = ?')
          .run(result.latitude, result.longitude, row.id);
        success++;
        console.log(`[Geocoder] Batch: ${i + 1}/${rows.length} — geocoded "${row.location_address}" → ${result.latitude},${result.longitude}`);

        // Broadcast so map updates in real-time
        const updatedCall = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(row.id);
        if (updatedCall) {
          broadcastDispatchUpdate({ action: 'call_updated', call: updatedCall });
        }
      } else {
        failed++;
        console.warn(`[Geocoder] Batch: ${i + 1}/${rows.length} — FAILED "${row.location_address}" (no result)`);
      }
    } catch (err: any) {
      failed++;
      console.warn(`[Geocoder] Batch: ${i + 1}/${rows.length} — ERROR "${row.location_address}": ${err?.message}`);
    }

    // Rate-limit: 1 request per second (conservative for Google free tier)
    if (i < rows.length - 1) {
      await sleep(1000);
    }
  }

  console.log(`[Geocoder] Batch complete: ${success} success, ${failed} failed out of ${rows.length}`);
  return { success, failed };
}

// ─── Scheduled Geocode Sweep ──────────────────────────────

/**
 * Runs batchGeocodeUngeocoded() 60 seconds after startup,
 * then every 30 minutes to catch newly created calls that failed initial geocoding.
 */
export function scheduleGeocodeSweep(): void {
  console.log('[Geocoder] Sweep scheduler started — first run in 60s, then every 30m');

  setTimeout(() => {
    batchGeocodeUngeocoded().catch(err =>
      console.error('[Geocoder] Sweep error:', err?.message)
    );

    const interval = setInterval(() => {
      batchGeocodeUngeocoded().catch(err =>
        console.error('[Geocoder] Sweep error:', err?.message)
      );
    }, 30 * 60 * 1000); // every 30 minutes

    interval.unref();
  }, 60 * 1000); // 60-second startup delay
}

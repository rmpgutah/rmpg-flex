import { getDb } from '../models/database';
import { broadcastDispatchUpdate } from './websocket';

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

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

  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${GOOGLE_MAPS_API_KEY}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;

    const data = await res.json();
    if (data.status === 'OK' && data.results?.length > 0) {
      const loc = data.results[0].geometry.location;
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

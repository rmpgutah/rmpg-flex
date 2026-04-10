/**
 * Pursuit Tracker
 *
 * Tracks active vehicle/foot pursuits and generates periodic GPS-based
 * voice updates with heading, speed, location, and nearest intercept unit.
 */

import { getDb } from '../models/database';
import { broadcastDispatchUpdate } from './websocket';
import { haversineDistance, findNearestUnits } from './proximityAlerts';

// ─── Types ──────────────────────────────────────────────────

interface ActivePursuit {
  id: string;
  callSign: string;
  callId?: number;
  startedAt: Date;
  lastUpdate: Date;
  lastLat: number;
  lastLng: number;
  lastAddress: string;
  lastSpeed?: number;
  lastHeading?: string;
  updateCount: number;
}

// ─── Constants ──────────────────────────────────────────────

export const UPDATE_INTERVAL_MS = 30_000;

const HEADING_LABELS: Record<string, string> = {
  N: 'northbound',
  NE: 'northeast',
  E: 'eastbound',
  SE: 'southeast',
  S: 'southbound',
  SW: 'southwest',
  W: 'westbound',
  NW: 'northwest',
};

// ─── State ──────────────────────────────────────────────────

const activePursuits: Map<string, ActivePursuit> = new Map();

// ─── Helpers ────────────────────────────────────────────────

function bearingToHeading(bearing: number): string {
  // Normalize to 0-360
  const b = ((bearing % 360) + 360) % 360;
  if (b >= 337.5 || b < 22.5) return 'N';
  if (b >= 22.5 && b < 67.5) return 'NE';
  if (b >= 67.5 && b < 112.5) return 'E';
  if (b >= 112.5 && b < 157.5) return 'SE';
  if (b >= 157.5 && b < 202.5) return 'S';
  if (b >= 202.5 && b < 247.5) return 'SW';
  if (b >= 247.5 && b < 292.5) return 'W';
  return 'NW';
}

function calculateBearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => d * Math.PI / 180;
  const toDeg = (r: number) => r * 180 / Math.PI;
  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2))
    - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function getLatestGps(callSign: string): { latitude: number; longitude: number; speed?: number; heading?: number; address?: string } | null {
  const db = getDb();
  try {
    const row = db.prepare(`
      SELECT latitude, longitude, speed, heading, address
      FROM gps_locations
      WHERE call_sign = ?
      ORDER BY timestamp DESC
      LIMIT 1
    `).get(callSign) as { latitude: number; longitude: number; speed?: number; heading?: number; address?: string } | undefined;
    return row || null;
  } catch {
    return null;
  }
}

// ─── Exports ────────────────────────────────────────────────

/**
 * Start tracking a pursuit for the given call sign.
 * Reads initial GPS position from gps_locations table.
 */
export function startPursuit(callSign: string, callId?: number): ActivePursuit | null {
  if (activePursuits.has(callSign)) {
    return activePursuits.get(callSign)!;
  }

  const gps = getLatestGps(callSign);
  const now = new Date();

  const pursuit: ActivePursuit = {
    id: `pursuit-${callSign}-${now.getTime()}`,
    callSign,
    callId,
    startedAt: now,
    lastUpdate: now,
    lastLat: gps?.latitude ?? 0,
    lastLng: gps?.longitude ?? 0,
    lastAddress: gps?.address ?? 'unknown location',
    lastSpeed: gps?.speed ?? undefined,
    lastHeading: gps?.heading != null ? bearingToHeading(gps.heading) : undefined,
    updateCount: 0,
  };

  activePursuits.set(callSign, pursuit);

  broadcastDispatchUpdate({
    type: 'pursuit_started',
    callSign,
    callId,
    pursuitId: pursuit.id,
    location: pursuit.lastAddress,
    timestamp: now.toISOString(),
  });

  return pursuit;
}

/**
 * End an active pursuit. Returns a duration message for TTS.
 */
export function endPursuit(callSign: string): string | null {
  const pursuit = activePursuits.get(callSign);
  if (!pursuit) return null;

  activePursuits.delete(callSign);

  const durationMs = Date.now() - pursuit.startedAt.getTime();
  const minutes = Math.round(durationMs / 60_000);
  const durationText = minutes < 1
    ? 'under 1 minute'
    : minutes === 1
      ? '1 minute'
      : `${minutes} minutes`;

  const message = `Pursuit by ${callSign} terminated after ${durationText}. ${pursuit.updateCount} updates logged.`;

  broadcastDispatchUpdate({
    type: 'pursuit_ended',
    callSign,
    pursuitId: pursuit.id,
    callId: pursuit.callId,
    duration: durationText,
    updateCount: pursuit.updateCount,
    timestamp: new Date().toISOString(),
  });

  return message;
}

/**
 * Generate pursuit updates for all active pursuits.
 * Called on a 30-second interval. For each pursuit, fetches latest GPS,
 * calculates heading/speed narrative, finds nearest intercept unit,
 * and broadcasts a pursuit_update event.
 *
 * Returns array of { callSign, narrative } for TTS consumption.
 */
export function generatePursuitUpdates(): { callSign: string; narrative: string }[] {
  const updates: { callSign: string; narrative: string }[] = [];

  for (const [callSign, pursuit] of activePursuits) {
    const gps = getLatestGps(callSign);
    if (!gps || !gps.latitude || !gps.longitude) continue;

    // Calculate heading from previous position if not provided by GPS
    let heading = pursuit.lastHeading;
    if (gps.heading != null) {
      heading = bearingToHeading(gps.heading);
    } else if (pursuit.lastLat && pursuit.lastLng) {
      const dist = haversineDistance(pursuit.lastLat, pursuit.lastLng, gps.latitude, gps.longitude);
      if (dist > 10) {
        // Only recalculate heading if moved more than 10 meters
        const bearing = calculateBearing(pursuit.lastLat, pursuit.lastLng, gps.latitude, gps.longitude);
        heading = bearingToHeading(bearing);
      }
    }

    // Build narrative
    const parts: string[] = [];

    // Location
    const location = gps.address || pursuit.lastAddress || 'unknown location';
    parts.push(`${callSign} pursuit update.`);
    parts.push(`Currently near ${location}.`);

    // Heading
    if (heading) {
      const headingLabel = HEADING_LABELS[heading] || heading;
      parts.push(`Traveling ${headingLabel}.`);
    }

    // Speed
    const speed = gps.speed ?? pursuit.lastSpeed;
    if (speed != null && speed > 0) {
      parts.push(`Speed approximately ${Math.round(speed)} miles per hour.`);
    }

    // Find nearest intercept unit (exclude the pursuing unit itself)
    const nearestUnits = findNearestUnits(gps.latitude, gps.longitude, 6);
    const interceptUnit = nearestUnits.find(u => u.callSign !== callSign);

    if (interceptUnit) {
      const distMiles = (interceptUnit.distance / 1609.34).toFixed(1);
      const eta = interceptUnit.etaMinutes < 1
        ? 'under 1 minute'
        : `${Math.round(interceptUnit.etaMinutes)} minutes`;
      parts.push(`Nearest intercept unit ${interceptUnit.callSign}, ${distMiles} miles away, ETA ${eta}.`);
    } else {
      parts.push('No intercept units available.');
    }

    const narrative = parts.join(' ');

    // Update pursuit state
    pursuit.lastLat = gps.latitude;
    pursuit.lastLng = gps.longitude;
    pursuit.lastAddress = gps.address || pursuit.lastAddress;
    pursuit.lastSpeed = gps.speed ?? pursuit.lastSpeed;
    pursuit.lastHeading = heading;
    pursuit.lastUpdate = new Date();
    pursuit.updateCount++;

    // Broadcast
    broadcastDispatchUpdate({
      type: 'pursuit_update',
      callSign,
      pursuitId: pursuit.id,
      callId: pursuit.callId,
      latitude: gps.latitude,
      longitude: gps.longitude,
      address: pursuit.lastAddress,
      heading,
      speed,
      interceptUnit: interceptUnit ? {
        callSign: interceptUnit.callSign,
        distance: interceptUnit.distance,
        etaMinutes: interceptUnit.etaMinutes,
      } : null,
      narrative,
      updateCount: pursuit.updateCount,
      timestamp: pursuit.lastUpdate.toISOString(),
    });

    updates.push({ callSign, narrative });
  }

  return updates;
}

/**
 * Returns the number of currently active pursuits.
 */
export function getActivePursuitCount(): number {
  return activePursuits.size;
}

/**
 * Check whether a unit is currently involved in a pursuit.
 */
export function isInPursuit(callSign: string): boolean {
  return activePursuits.has(callSign);
}

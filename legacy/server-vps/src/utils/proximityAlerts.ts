/**
 * Proximity Alerts + Nearest Units
 *
 * GPS-based hazard detection and nearest available unit finder
 * for dispatch operations.
 */

import { getDb } from '../models/database';

// ─── Types ──────────────────────────────────────────────────

export interface ProximityAlert {
  type: 'sex_offender' | 'shooting_history' | 'high_crime' | 'trespass_property';
  description: string;
  distance: number; // meters
  latitude: number;
  longitude: number;
}

export interface NearestUnit {
  callSign: string;
  distance: number; // meters
  etaMinutes: number;
  status: string;
}

// ─── Haversine Distance ─────────────────────────────────────

const EARTH_RADIUS_M = 6371000;
const toRad = (deg: number) => deg * Math.PI / 180;

/**
 * Calculate distance in meters between two GPS coordinates
 * using the Haversine formula.
 */
export function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Proximity Hazard Check ─────────────────────────────────

const PROXIMITY_RADIUS_M = 200;

/**
 * Check GPS coordinates against known hazards within 200m radius.
 * Queries offender_registry (sex offenders) and calls_for_service
 * (prior shootings in last 6 months).
 */
export function checkProximityHazards(lat: number, lng: number): ProximityAlert[] {
  const alerts: ProximityAlert[] = [];
  const db = getDb();

  // --- Sex offender registry ---
  try {
    const offenders = db.prepare(`
      SELECT id, full_name, latitude, longitude, address
      FROM offender_registry
      WHERE latitude IS NOT NULL AND longitude IS NOT NULL
    `).all() as { id: number; full_name: string; latitude: number; longitude: number; address: string }[];

    for (const offender of offenders) {
      const dist = haversineDistance(lat, lng, offender.latitude, offender.longitude);
      if (dist <= PROXIMITY_RADIUS_M) {
        alerts.push({
          type: 'sex_offender',
          description: `Registered sex offender ${offender.full_name} at ${offender.address || 'nearby address'}`,
          distance: Math.round(dist),
          latitude: offender.latitude,
          longitude: offender.longitude,
        });
      }
    }
  } catch (_err) {
    // Table may not exist in dev — silently skip
  }

  // --- Prior shootings in last 6 months ---
  try {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const cutoff = sixMonthsAgo.toISOString();

    const shootings = db.prepare(`
      SELECT id, call_number, latitude, longitude, location, created_at
      FROM calls_for_service
      WHERE latitude IS NOT NULL AND longitude IS NOT NULL
        AND nature LIKE '%shoot%'
        AND created_at >= ?
    `).all(cutoff) as { id: number; call_number: string; latitude: number; longitude: number; location: string; created_at: string }[];

    for (const incident of shootings) {
      const dist = haversineDistance(lat, lng, incident.latitude, incident.longitude);
      if (dist <= PROXIMITY_RADIUS_M) {
        alerts.push({
          type: 'shooting_history',
          description: `Prior shooting incident (${incident.call_number}) at ${incident.location || 'this location'}`,
          distance: Math.round(dist),
          latitude: incident.latitude,
          longitude: incident.longitude,
        });
      }
    }
  } catch (_err) {
    // Table may not exist in dev — silently skip
  }

  // Sort by distance (closest first)
  alerts.sort((a, b) => a.distance - b.distance);

  return alerts;
}

// ─── Proximity Narrative ────────────────────────────────────

/**
 * Convert proximity alerts to a spoken voice string.
 * Limited to the 3 closest alerts.
 */
export function composeProximityNarrative(alerts: ProximityAlert[]): string {
  if (alerts.length === 0) return '';

  const top = alerts.slice(0, 3);
  const parts = top.map((alert) => {
    const distText = alert.distance < 100
      ? `${alert.distance} meters`
      : `${Math.round(alert.distance / 10) * 10} meters`;

    switch (alert.type) {
      case 'sex_offender':
        return `Caution: registered sex offender within ${distText}. ${alert.description}.`;
      case 'shooting_history':
        return `Alert: prior shooting incident within ${distText}. ${alert.description}.`;
      case 'high_crime':
        return `Advisory: high crime area within ${distText}. ${alert.description}.`;
      case 'trespass_property':
        return `Note: known trespass property within ${distText}. ${alert.description}.`;
    }
  });

  return parts.join(' ');
}

// ─── Nearest Available Units ────────────────────────────────

const AVERAGE_URBAN_SPEED_MPH = 25;
const GPS_STALE_MINUTES = 10;

/**
 * Find available units with recent GPS sorted by distance from a call location.
 * ETA calculated assuming 25 mph average urban speed.
 */
export function findNearestUnits(callLat: number, callLng: number, limit: number = 5): NearestUnit[] {
  const db = getDb();

  try {
    const cutoff = new Date(Date.now() - GPS_STALE_MINUTES * 60 * 1000).toISOString();

    // Get available units with their latest GPS position (within 10 min)
    const rows = db.prepare(`
      SELECT
        du.call_sign,
        du.status,
        g.latitude,
        g.longitude,
        g.timestamp AS gps_time
      FROM dispatch_units du
      INNER JOIN (
        SELECT call_sign, latitude, longitude, timestamp,
               ROW_NUMBER() OVER (PARTITION BY call_sign ORDER BY timestamp DESC) AS rn
        FROM gps_locations
        WHERE timestamp >= ?
      ) g ON g.call_sign = du.call_sign AND g.rn = 1
      WHERE du.status IN ('available', 'on_patrol', 'in_service')
        AND g.latitude IS NOT NULL
        AND g.longitude IS NOT NULL
    `).all(cutoff) as { call_sign: string; status: string; latitude: number; longitude: number; gps_time: string }[];

    const units: NearestUnit[] = rows.map((row) => {
      const dist = haversineDistance(callLat, callLng, row.latitude, row.longitude);
      const etaMinutes = (dist / 1609.34) / AVERAGE_URBAN_SPEED_MPH * 60;
      return {
        callSign: row.call_sign,
        distance: Math.round(dist),
        etaMinutes: Math.round(etaMinutes * 10) / 10, // 1 decimal place
        status: row.status,
      };
    });

    // Sort by distance ascending
    units.sort((a, b) => a.distance - b.distance);

    return units.slice(0, limit);
  } catch (_err) {
    // Tables may not exist in dev — return empty
    return [];
  }
}

// ─── Nearest Units Narrative ────────────────────────────────

/**
 * Convert nearest units to a spoken voice string.
 * Limited to the top 3 closest units.
 */
export function composeNearestUnitsNarrative(units: NearestUnit[]): string {
  if (units.length === 0) return 'No available units with GPS in range.';

  const top = units.slice(0, 3);
  const parts = top.map((unit, i) => {
    const distMi = (unit.distance / 1609.34).toFixed(1);
    const eta = unit.etaMinutes < 1
      ? 'under 1 minute'
      : unit.etaMinutes === 1
        ? '1 minute'
        : `${Math.round(unit.etaMinutes)} minutes`;

    if (i === 0) {
      return `Nearest unit: ${unit.callSign}, ${distMi} miles, ETA ${eta}.`;
    }
    return `${unit.callSign}, ${distMi} miles, ETA ${eta}.`;
  });

  return parts.join(' ');
}

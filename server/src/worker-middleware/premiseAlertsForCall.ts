// ============================================================
// RMPG Flex — Premise alerts proximity lookup (Hono/D1, DI-3)
// Async port of server/src/utils/premiseAlertsForCall.ts.
//
// The lookup (getPremiseAlertsNear) ports cleanly. The targeted
// WebSocket push (sendToUser → connected officer's MDT) does NOT —
// Workers have no shared connection registry. That step needs a
// PremiseAlertDO (or hibernatable WebSocket DO) to route by user_id.
// Until then, the dispatcher console banner remains as the only
// delivery surface; the MDT modal won't pop until the DO lands.
// ============================================================

import { D1Db } from './d1Helpers';

const PREMISE_PUSH_RADIUS_M = 50;
const EARTH_RADIUS_M = 6371000;
const toRad = (deg: number) => deg * Math.PI / 180;

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export interface PremiseAlertNear {
  id: number;
  address: string;
  alert_type: string;
  alert_level: string;
  title: string;
  description: string | null;
  flags: string[];
  distance_meters: number;
  latitude: number;
  longitude: number;
}

/**
 * Returns active premise_alerts within PREMISE_PUSH_RADIUS_M of the
 * given point. Pre-filters with a ±0.001° bounding box (QA M2 fix
 * carried over from the Express version's deferred improvement).
 */
export async function getPremiseAlertsNear(db: D1Db, lat: number, lng: number): Promise<PremiseAlertNear[]> {
  try {
    const dLat = 0.001;          // ~111m latitude (overshoots the 50m radius safely)
    const dLng = 0.001 / Math.max(0.01, Math.cos(toRad(lat)));
    const rows = await db.prepare(`
      SELECT id, address, latitude, longitude, alert_type, alert_level,
             title, description, flags, expires_at
      FROM premise_alerts
      WHERE active = 1
        AND latitude  BETWEEN ? AND ?
        AND longitude BETWEEN ? AND ?
        AND (expires_at IS NULL OR expires_at >= datetime('now'))
    `).all(lat - dLat, lat + dLat, lng - dLng, lng + dLng) as any[];

    const out: PremiseAlertNear[] = [];
    for (const r of rows) {
      const d = haversineDistance(lat, lng, r.latitude, r.longitude);
      if (d <= PREMISE_PUSH_RADIUS_M) {
        let parsedFlags: string[] = [];
        try {
          const p = JSON.parse(r.flags || '[]');
          if (Array.isArray(p)) parsedFlags = p.map(String);
        } catch { /* keep empty */ }
        out.push({
          id: r.id,
          address: r.address,
          alert_type: r.alert_type,
          alert_level: r.alert_level,
          title: r.title,
          description: r.description,
          flags: parsedFlags,
          distance_meters: Math.round(d),
          latitude: r.latitude,
          longitude: r.longitude,
        });
      }
    }
    out.sort((a, b) => a.distance_meters - b.distance_meters);
    return out;
  } catch {
    return [];
  }
}

// TODO(DO): pushPremiseAlertsToUnit(unitId, callId, callNumber, alerts)
// requires a Durable Object that holds connected MDT WebSockets keyed
// by user_id. When that lands, this module gets a second export that
// looks up the unit's officer_id and forwards via the DO. Until then,
// the dispatcher's /api/dispatch/calls/:id/warnings response is the
// only delivery surface for premise hazards.

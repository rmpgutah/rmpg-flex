/**
 * Premise Alerts for Call — proximity lookup + WebSocket push.
 *
 * When a unit is assigned to a call, every active premise alert within
 * 50m of the call location is pushed to the assigned officer's MDT via
 * sendToUser. This is the "premise hazards reach the unit before they
 * arrive" behavior Spillman Flex provides out of the box.
 */

import { getDb } from '../models/database';
import { haversineDistance } from './proximityAlerts';
import { sendToUser } from './websocket';

const PREMISE_PUSH_RADIUS_M = 50;

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
 * Returns active premise_alerts within PREMISE_PUSH_RADIUS_M of the given
 * point. Bails to empty array on any error so the caller can call this
 * inline in a dispatch transaction without risking a 500.
 */
export function getPremiseAlertsNear(lat: number, lng: number): PremiseAlertNear[] {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT id, address, latitude, longitude, alert_type, alert_level,
             title, description, flags, expires_at
      FROM premise_alerts
      WHERE active = 1
        AND latitude IS NOT NULL
        AND longitude IS NOT NULL
        AND (expires_at IS NULL OR expires_at >= datetime('now'))
    `).all() as any[];

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

/**
 * Look up the user_id for a given units.id (via units.officer_id).
 * Returns null if the unit has no assigned officer.
 */
export function unitOfficerUserId(unitId: number | string): number | null {
  try {
    const db = getDb();
    const row = db.prepare('SELECT officer_id FROM units WHERE id = ?').get(unitId) as { officer_id: number | null } | undefined;
    return row?.officer_id ?? null;
  } catch {
    return null;
  }
}

/**
 * Push premise alerts to a single officer for a specific call.
 * Idempotent on the receiving side — the MDT modal de-dups by call_id.
 */
export function pushPremiseAlertsToUnit(args: {
  unitId: number | string;
  callId: number | string;
  callNumber: string;
  alerts: PremiseAlertNear[];
}): boolean {
  if (args.alerts.length === 0) return false;
  const userId = unitOfficerUserId(args.unitId);
  if (userId == null) return false;
  sendToUser(userId, 'premise_alert_for_unit', {
    call_id: args.callId,
    call_number: args.callNumber,
    unit_id: args.unitId,
    alerts: args.alerts,
    pushed_at: new Date().toISOString(),
  });
  return true;
}

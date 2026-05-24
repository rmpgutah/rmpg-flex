/**
 * Premise alerts auto-push.
 *
 * When a unit is assigned to a call, look up any premise_alerts within
 * ~0.05 miles (~80m) of the call location and push them to the unit's
 * MDT via WebSocket. Pre-filters by SQL bounding box first to avoid
 * a full table scan once premise_alerts grows past a few hundred rows.
 */
import type Database from 'better-sqlite3';
import { sendToUser } from './websocket';
import { haversineDistance } from './proximityAlerts';

const DEFAULT_RADIUS_METERS = 80;

type PremiseAlertRow = {
  id: number;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  alert_type: string | null;
  caution_text: string | null;
  severity: string | null;
  active: number | null;
};

export type PremiseAlertPayload = {
  id: number;
  address: string;
  alertType: string;
  cautionText: string;
  severity: string;
  distanceMeters: number;
};

/**
 * Find premise alerts near (lat, lng). Returns the closest first.
 * Uses a bounding-box pre-filter (~0.001 degree per 111m at this latitude).
 */
export function findPremiseAlertsNear(
  db: Database.Database,
  lat: number,
  lng: number,
  radiusMeters = DEFAULT_RADIUS_METERS,
): PremiseAlertPayload[] {
  if (lat == null || lng == null) return [];

  // ~111km per degree latitude; longitude shrinks by cos(lat).
  const latDelta = radiusMeters / 111_000;
  const lngDelta = radiusMeters / (111_000 * Math.cos(lat * Math.PI / 180));
  const minLat = lat - latDelta, maxLat = lat + latDelta;
  const minLng = lng - lngDelta, maxLng = lng + lngDelta;

  let rows: PremiseAlertRow[] = [];
  try {
    rows = db.prepare(`
      SELECT id, address, latitude, longitude, alert_type, caution_text, severity, active
      FROM premise_alerts
      WHERE active = 1
        AND latitude  BETWEEN ? AND ?
        AND longitude BETWEEN ? AND ?
    `).all(minLat, maxLat, minLng, maxLng) as PremiseAlertRow[];
  } catch {
    return []; // table not provisioned yet in dev
  }

  const out: PremiseAlertPayload[] = [];
  for (const r of rows) {
    if (r.latitude == null || r.longitude == null) continue;
    const dist = haversineDistance(lat, lng, r.latitude, r.longitude);
    if (dist <= radiusMeters) {
      out.push({
        id: r.id,
        address: r.address ?? '',
        alertType: r.alert_type ?? 'caution',
        cautionText: r.caution_text ?? '',
        severity: r.severity ?? 'medium',
        distanceMeters: Math.round(dist),
      });
    }
  }
  out.sort((a, b) => a.distanceMeters - b.distanceMeters);
  return out;
}

/**
 * Push premise alerts to the officer assigned to a unit (if any).
 * Best-effort: silently returns 0 if the unit has no officer or no
 * call location. Returns the count of alerts pushed.
 */
export function pushPremiseAlertsToUnit(
  db: Database.Database,
  unitId: number,
  callId: number,
): number {
  let unit: { officer_id: number | null } | undefined;
  let call: { latitude: number | null; longitude: number | null; call_number: string | null } | undefined;
  try {
    unit = db.prepare('SELECT officer_id FROM units WHERE id = ?').get(unitId) as any;
    call = db.prepare('SELECT latitude, longitude, call_number FROM calls_for_service WHERE id = ?').get(callId) as any;
  } catch { return 0; }

  if (!unit?.officer_id || call?.latitude == null || call?.longitude == null) return 0;

  const alerts = findPremiseAlertsNear(db, call.latitude, call.longitude);
  if (alerts.length === 0) return 0;

  sendToUser(unit.officer_id, 'premise_alert_for_unit', {
    action: 'premise_alert_for_unit',
    unitId,
    callId,
    callNumber: call.call_number,
    alerts,
  });
  return alerts.length;
}

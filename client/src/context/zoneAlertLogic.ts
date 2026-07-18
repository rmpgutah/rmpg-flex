import type { GeofenceAlertPayload } from './stationPauseLogic';

/** Zone types that should surface a transient HUD notification on enter
 *  (station handled separately by stationPauseAction; these are informational). */
const ALERTABLE_ZONE_TYPES = new Set(['alert', 'patrol_required']);

export interface ZoneAlertResult {
  show: boolean;
  zoneType: string;
}

/** Pure decision: given a geofence_alert event, should we surface a transient
 *  "entering zone" HUD notice? Station zones are handled separately by
 *  stationPauseAction (pause/resume trip tracking); exclusion zones are
 *  routing-only and never alert; only 'enter' events on 'alert' or
 *  'patrol_required' zones produce a result. */
export function zoneEntryAlert(payload: GeofenceAlertPayload): ZoneAlertResult | null {
  if (payload.eventType !== 'enter') return null;
  if (!ALERTABLE_ZONE_TYPES.has(payload.zoneType)) return null;
  return { show: true, zoneType: payload.zoneType };
}

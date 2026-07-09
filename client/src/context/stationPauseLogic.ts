export interface GeofenceAlertPayload {
  unitId: number;
  zoneId: number;
  zoneType: string;
  eventType: 'enter' | 'exit' | 'transfer';
}

/** Whether a geofence_alert event should pause or resume active trip tracking. */
export function stationPauseAction(payload: GeofenceAlertPayload): 'pause' | 'resume' | null {
  if (payload.zoneType !== 'station') return null;
  if (payload.eventType === 'enter') return 'pause';
  if (payload.eventType === 'exit') return 'resume';
  return null;
}

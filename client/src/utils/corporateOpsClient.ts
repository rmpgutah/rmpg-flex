export type ClockLinkFlags = {
  handbook_pending?: boolean;
  service_due?: boolean;
  license_expiring?: boolean;
};

export type CorporateSnapshot = {
  day?: string;
  clocked_in_now?: number;
  scheduled_today?: number;
  hours_today?: number;
  duty_miles_today?: number;
  serve_attempts_today?: number;
  fleet_service_due?: number;
  mileage_flags_today?: number;
  handbook_pending?: number;
  cost_per_mile_30d?: number | null;
  low_fuel_units?: Array<{ id: number; vehicle_number: string | null; fuel_level: number | null }>;
  on_duty?: Array<{ officer_id: number; full_name: string; call_sign: string | null; vehicle_number: string | null }>;
};

export type CorporateMine = {
  day?: string;
  on_duty?: boolean;
  hours_today?: number;
  duty_miles_today?: number;
  serve_attempts_today?: number;
};

export type CorporateServer = {
  officer_id: number;
  full_name: string;
  vehicle_number?: string | null;
  call_sign?: string | null;
  miles_today?: number | null;
};

export function toastClockLinkWarnings(
  addToast: (message: string, type: 'success' | 'error' | 'warning' | 'info') => void,
  body: ClockLinkFlags | null | undefined,
): void {
  if (!body) return;
  if (body.handbook_pending) addToast('Handbook acknowledgment still pending', 'warning');
  if (body.service_due) addToast('Assigned vehicle is due for service', 'warning');
  if (body.license_expiring) addToast('Driver license or CDL expires within 14 days', 'warning');
}

export function formatServerAssignLabel(o: {
  name: string;
  onDuty?: boolean;
  vehicle?: string | null;
  milesToday?: number | null;
}): string {
  const bits = [o.name];
  if (o.onDuty) bits.push('on duty');
  if (o.vehicle) bits.push(o.vehicle);
  if (o.milesToday != null && Number(o.milesToday) > 0) bits.push(`${Number(o.milesToday).toFixed(1)} mi`);
  return bits.join(' · ');
}

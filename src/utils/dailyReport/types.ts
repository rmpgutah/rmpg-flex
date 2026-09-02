// ============================================================
// RMPG Flex — Daily Blotter: shared shapes
// ============================================================
// collect.ts produces these; render.ts consumes them. Kept in their
// own module so render.ts never needs to import anything that touches
// D1, which is what keeps it a pure function.
// ============================================================

export interface CallRow {
  call_number: string | null;
  received_at: string | null;
  incident_type: string | null;
  priority: string | number | null;
  location_address: string | null;
  disposition: string | null;
  status: string | null;
  unit_call_signs: string | null;
  responding_officer: string | null;
  description: string | null;
  notes: string | null;
  source: string | null;
  dispatch_code: string | null;
  sector_name: string | null;
  zone_name: string | null;
  beat_name: string | null;
  weapons_involved: number | null;
  domestic_violence: number | null;
  mental_health_crisis: number | null;
  juvenile_involved: number | null;
  felony_in_progress: number | null;
  officer_safety_caution: number | null;
  k9_requested: number | null;
  ems_requested: number | null;
  response_time_seconds: number | null;
  onscene_duration_seconds: number | null;
  pso_requestor_name: string | null;
  pso_service_type: string | null;
  le_notified: number | null;
  le_case_number: string | null;
  supervisor_notified: number | null;
  damage_estimate: number | null;
  damage_description: string | null;
  action_taken: string | null;
  caller_relationship: string | null;
  caller_name: string | null;
  secondary_type: string | null;
  scene_safety: string | null;
}

export interface CitationRow {
  citation_number: string | null;
  citation_date: string | null;
  violation_description: string | null;
  location_address: string | null;
  issuing_officer_name: string | null;
  fine_amount: number | null;
}

export interface TripRow {
  vehicle_label: string;
  trips: number;
  miles: number | null;
  duration_s: number | null;
}

export interface FuelRow {
  vehicle_label: string;
  fuel_date: string | null;
  gallons: number | null;
  total_cost: number | null;
  odometer: number | null;
  station: string | null;
}

export interface CheckRow {
  vehicle_label: string;
  kind: 'inspection' | 'pretrip';
  performed_at: string | null;
  result: string | null;
  performed_by: string | null;
}

export interface WorkOrderRow {
  number: string | null;
  vehicle_label: string;
  event: 'opened' | 'closed';
  at: string | null;
  summary: string | null;
  status: string | null;
}

export interface DailyReportData {
  /** Denver calendar day, YYYY-MM-DD. */
  date: string;
  /** ISO instant the report was produced. */
  generatedAt: string;
  operations: {
    calls: CallRow[];
    citations: CitationRow[];
  };
  fleet: {
    trips: TripRow[];
    fuel: FuelRow[];
    checks: CheckRow[];
    workOrders: WorkOrderRow[];
  };
}

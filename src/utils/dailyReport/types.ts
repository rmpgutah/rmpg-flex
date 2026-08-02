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
  /** From calls_for_service directly — call_units is empty on live. */
  unit_call_signs: string | null;
  responding_officer: string | null;
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

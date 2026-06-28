// ============================================================
// RMPG Flex — Vehicle Dossier Aggregator
//
// Print-ready aggregation for a vehicle: linked incidents,
// dispatch calls (via incidents), citations directly bound
// to this vehicle, field interviews where the vehicle was
// observed, and the registered owner (if any).
//
// Mirrors personDossier.ts in shape and section caps so the
// same renderer can drive both.
// ============================================================

import type Database from 'better-sqlite3';

export interface VehicleDossier {
  vehicle: any;
  owner: any | null;
  incidents: { count: number; rows: any[] };
  calls: { count: number; rows: any[] };
  citations: { count: number; rows: any[]; unpaidCount: number };
  fieldInterviews: { count: number; rows: any[] };
  summary: {
    riskLevel: 'high' | 'elevated' | 'standard';
    totalContacts: number;
    flagged: boolean;
  };
}

const ROW_CAP = 25;

export function buildVehicleDossier(
  db: Database.Database,
  vehicleId: number,
): VehicleDossier | null {
  const vehicle = db.prepare(
    'SELECT * FROM vehicles_records WHERE id = ?'
  ).get(vehicleId) as any;
  if (!vehicle) return null;

  const owner = vehicle.owner_person_id
    ? db.prepare('SELECT id, first_name, last_name, date_of_birth FROM persons WHERE id = ?')
        .get(vehicle.owner_person_id)
    : null;

  // ── Incidents ─────────────────────────────────────────
  const incidents = safeQuery(() =>
    db.prepare(`
      SELECT i.id, i.incident_number, i.incident_type, i.status, i.priority,
             i.narrative AS description, i.created_at, iv.role
      FROM incident_vehicles iv
      JOIN incidents i ON iv.incident_id = i.id
      WHERE iv.vehicle_id = ?
      ORDER BY i.created_at DESC
      LIMIT ?
    `).all(vehicleId, ROW_CAP),
  );
  const incidentsTotal = safeCount(() =>
    db.prepare('SELECT COUNT(*) as c FROM incident_vehicles WHERE vehicle_id = ?').get(vehicleId),
  );

  // ── Calls (via incident_vehicles → incidents → calls_for_service) ─
  const calls = safeQuery(() =>
    db.prepare(`
      SELECT DISTINCT c.id, c.call_number, c.incident_type, c.priority,
             c.status, c.location_address AS location, c.created_at
      FROM incident_vehicles iv
      JOIN incidents i ON iv.incident_id = i.id
      JOIN calls_for_service c ON i.call_id = c.id
      WHERE iv.vehicle_id = ? AND i.call_id IS NOT NULL
      ORDER BY c.created_at DESC
      LIMIT ?
    `).all(vehicleId, ROW_CAP),
  );
  const callsTotal = safeCount(() =>
    db.prepare(`
      SELECT COUNT(DISTINCT c.id) as c
      FROM incident_vehicles iv
      JOIN incidents i ON iv.incident_id = i.id
      JOIN calls_for_service c ON i.call_id = c.id
      WHERE iv.vehicle_id = ? AND i.call_id IS NOT NULL
    `).get(vehicleId),
  );

  // ── Citations issued against this vehicle ─────────────
  const citations = safeQuery(() =>
    db.prepare(`
      SELECT id, citation_number, type, status, statute_citation,
             violation_description, fine_amount, violation_date, court_date
      FROM citations
      WHERE vehicle_id = ?
      ORDER BY violation_date DESC
      LIMIT ?
    `).all(vehicleId, ROW_CAP),
  );
  const citationsTotal = safeCount(() =>
    db.prepare('SELECT COUNT(*) as c FROM citations WHERE vehicle_id = ?').get(vehicleId),
  );
  const unpaidCitations = citations.filter(
    c => c.status === 'issued' || c.status === 'contested',
  ).length;

  // ── Field Interviews observing this vehicle ───────────
  const fieldInterviews = safeQuery(() =>
    db.prepare(`
      SELECT id, fi_number, location, contact_reason, contact_type,
             officer_name, created_at, status, vehicle_plate
      FROM field_interviews
      WHERE vehicle_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(vehicleId, ROW_CAP),
  );
  const fieldInterviewsTotal = safeCount(() =>
    db.prepare('SELECT COUNT(*) as c FROM field_interviews WHERE vehicle_id = ?').get(vehicleId),
  );

  // ── Risk classification (vehicle-specific) ────────────
  // - HIGH: stolen flag set on vehicle row
  // - ELEVATED: 3+ incidents OR any unpaid citation
  // - STANDARD: otherwise
  const flagged = !!(vehicle.is_stolen || vehicle.flagged);
  let riskLevel: 'high' | 'elevated' | 'standard' = 'standard';
  if (flagged) {
    riskLevel = 'high';
  } else if (incidentsTotal >= 3 || unpaidCitations > 0) {
    riskLevel = 'elevated';
  }

  return {
    vehicle,
    owner,
    incidents: { count: incidentsTotal, rows: incidents },
    calls: { count: callsTotal, rows: calls },
    citations: { count: citationsTotal, rows: citations, unpaidCount: unpaidCitations },
    fieldInterviews: { count: fieldInterviewsTotal, rows: fieldInterviews },
    summary: {
      riskLevel,
      totalContacts: incidentsTotal + callsTotal + fieldInterviewsTotal,
      flagged,
    },
  };
}

function safeQuery(fn: () => unknown[]): any[] {
  try { return fn() as any[]; } catch { return []; }
}

function safeCount(fn: () => unknown): number {
  try {
    const row = fn() as { c?: number } | undefined;
    return row?.c ?? 0;
  } catch {
    return 0;
  }
}

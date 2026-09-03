// ============================================================
// RMPG Flex — Daily Blotter: data collection
// ============================================================
// Every D1 read for the blotter lives here. No formatting, no PDF.
//
// Two constraints are load-bearing:
//   1. calls_for_service is at D1's 100-column cap — explicit column
//      lists only, never SELECT *.
//   2. call_units has ZERO rows on live, so unit attribution comes from
//      calls_for_service.unit_call_signs / .responding_officer. A join
//      through call_units renders a silently empty operations section.
// ============================================================

import type { D1Database } from '@cloudflare/workers-types';
import { denverDayBoundsUtc } from './dates';
import type {
  DailyReportData, CallRow, CitationRow, TripRow, FuelRow, CheckRow, WorkOrderRow,
} from './types';

/** Total label — never NULL. `alias` is the source table's alias, whose
 *  vehicle_id survives a LEFT JOIN miss (v.id does not). SQLite's ||
 *  yields NULL on a NULL operand, so a bare 'Vehicle ' || id is not a
 *  usable fallback: 34% of live unit_trips rows have a NULL or orphaned
 *  vehicle_id and would collapse into one blank GROUP BY bucket. */
const vehicleLabelSql = (alias: string): string =>
  `COALESCE(NULLIF(v.vehicle_name,''), NULLIF(v.vehicle_number,''), NULLIF(v.plate_number,''), 'Vehicle ' || CAST(${alias}.vehicle_id AS TEXT), 'Unassigned')`;

/** Date-only values ('2026-06-21') sort BELOW that day's own start bound
 *  ('2026-06-21 06:00:00') under lexical comparison, so they land on the
 *  PREVIOUS Denver day. inspection_date is written unnormalized straight
 *  from the client body, so this is reachable with real data. Pin a
 *  date-only value to midday of its own date before comparing. */
const dayNormalized = (expr: string): string =>
  `CASE WHEN length(${expr}) = 10 THEN ${expr} || ' 12:00:00' ELSE ${expr} END`;

async function all<T>(db: D1Database, sql: string, ...binds: unknown[]): Promise<T[]> {
  try {
    const rs = await db.prepare(sql).bind(...binds).all<T>();
    return rs.results ?? [];
  } catch (e: unknown) {
    // Degrade gracefully when a table doesn't exist yet (e.g. missing migration
    // or test-worker DB lacking the schema for this query's tables).
    const msg = e instanceof Error ? e.message : String(e);
    if (/no such (table|column)/i.test(msg)) return [];
    throw e;
  }
}

export async function collectDailyReport(
  db: D1Database,
  date: string,
  nowIso?: string,
): Promise<DailyReportData> {
  const { startUtc, endUtc } = denverDayBoundsUtc(date);

  const calls = await all<CallRow>(
    db,
    `SELECT call_number, received_at, created_at, incident_type, priority, location_address,
            disposition, status, unit_call_signs, responding_officer,
            description, notes, source, dispatch_code, sector_name, zone_name,
            beat_name, weapons_involved, domestic_violence, mental_health_crisis,
            juvenile_involved, felony_in_progress, officer_safety_caution,
            k9_requested, ems_requested, response_time_seconds,
            onscene_duration_seconds, pso_requestor_name, pso_service_type,
            le_notified, le_case_number, supervisor_notified, damage_estimate,
            damage_description, action_taken, caller_relationship, caller_name,
            secondary_type, scene_safety
       FROM calls_for_service
      WHERE COALESCE(received_at, created_at) >= ? AND COALESCE(received_at, created_at) < ?
      ORDER BY COALESCE(received_at, created_at) ASC`,
    startUtc, endUtc,
  );

  const citations = await all<CitationRow>(
    db,
    `SELECT citation_number, citation_date, violation_description, location_address,
            issuing_officer_name, fine_amount
       FROM citations
      WHERE ${dayNormalized('COALESCE(citation_date, created_at)')} >= ? AND ${dayNormalized('COALESCE(citation_date, created_at)')} < ?
      ORDER BY ${dayNormalized('COALESCE(citation_date, created_at)')} ASC`,
    startUtc, endUtc,
  );

  const trips = await all<TripRow>(
    db,
    `SELECT ${vehicleLabelSql('t')} AS vehicle_label,
            COUNT(*) AS trips,
            ROUND(SUM(COALESCE(t.distance_m, 0)) / 1609.344, 1) AS miles,
            SUM(COALESCE(t.duration_s, 0)) AS duration_s
       FROM unit_trips t
       LEFT JOIN fleet_vehicles v ON v.id = t.vehicle_id
      WHERE t.start_time >= ? AND t.start_time < ?
      GROUP BY vehicle_label
      ORDER BY vehicle_label ASC`,
    startUtc, endUtc,
  );

  const fuel = await all<FuelRow>(
    db,
    `SELECT ${vehicleLabelSql('f')} AS vehicle_label,
            f.fuel_date, f.gallons, f.total_cost, f.odometer, f.station
       FROM fleet_fuel_log f
       LEFT JOIN fleet_vehicles v ON v.id = f.vehicle_id
      WHERE COALESCE(f.fuel_date, f.created_at) >= ? AND COALESCE(f.fuel_date, f.created_at) < ?
      ORDER BY COALESCE(f.fuel_date, f.created_at) ASC`,
    startUtc, endUtc,
  );

  const inspections = await all<CheckRow>(
    db,
    `SELECT ${vehicleLabelSql('i')} AS vehicle_label,
            'inspection' AS kind,
            COALESCE(i.inspection_date, i.created_at) AS performed_at,
            COALESCE(i.overall_result, CASE WHEN i.passed = 1 THEN 'PASS' ELSE 'FAIL' END) AS result,
            i.inspector AS performed_by
       FROM fleet_inspections i
       LEFT JOIN fleet_vehicles v ON v.id = i.vehicle_id
      WHERE ${dayNormalized('COALESCE(i.inspection_date, i.created_at)')} >= ? AND ${dayNormalized('COALESCE(i.inspection_date, i.created_at)')} < ?
      ORDER BY ${dayNormalized('performed_at')} ASC`,
    startUtc, endUtc,
  );

  const pretrips = await all<CheckRow>(
    db,
    `SELECT ${vehicleLabelSql('p')} AS vehicle_label,
            'pretrip' AS kind,
            COALESCE(p.check_date, p.created_at) AS performed_at,
            p.status AS result,
            CAST(p.officer_id AS TEXT) AS performed_by
       FROM fleet_pretrip_checklists p
       LEFT JOIN fleet_vehicles v ON v.id = p.vehicle_id
      WHERE COALESCE(p.check_date, p.created_at) >= ? AND COALESCE(p.check_date, p.created_at) < ?
      ORDER BY performed_at ASC`,
    startUtc, endUtc,
  );

  const opened = await all<WorkOrderRow>(
    db,
    `SELECT w.number, ${vehicleLabelSql('w')} AS vehicle_label,
            'opened' AS event, w.opened_at AS at, w.summary, w.status
       FROM work_orders w
       LEFT JOIN fleet_vehicles v ON v.id = w.vehicle_id
      WHERE w.opened_at >= ? AND w.opened_at < ?
      ORDER BY w.opened_at ASC`,
    startUtc, endUtc,
  );

  const closed = await all<WorkOrderRow>(
    db,
    `SELECT w.number, ${vehicleLabelSql('w')} AS vehicle_label,
            'closed' AS event, w.closed_at AS at, w.summary, w.status
       FROM work_orders w
       LEFT JOIN fleet_vehicles v ON v.id = w.vehicle_id
      WHERE w.closed_at >= ? AND w.closed_at < ?
      ORDER BY w.closed_at ASC`,
    startUtc, endUtc,
  );

  return {
    date,
    generatedAt: nowIso ?? new Date().toISOString(),
    operations: { calls, citations },
    fleet: {
      trips,
      fuel,
      checks: [...inspections, ...pretrips],
      workOrders: [...opened, ...closed],
    },
  };
}

/** True when the day produced nothing worth archiving. */
export function isEmpty(data: DailyReportData): boolean {
  return (
    data.operations.calls.length === 0 &&
    data.operations.citations.length === 0 &&
    data.fleet.trips.length === 0 &&
    data.fleet.fuel.length === 0 &&
    data.fleet.checks.length === 0 &&
    data.fleet.workOrders.length === 0
  );
}

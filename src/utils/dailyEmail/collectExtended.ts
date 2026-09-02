// ============================================================
// RMPG Flex — Daily Email: extended activity collection
// ============================================================
// Queries warrants, incidents, ALPR captures, patrol scans, and
// new persons for a given Denver day. Uses denverDayBoundsUtc
// from the existing dailyReport module for timezone correctness.
//
// Each section is independent — a failure in one does not prevent
// the others from being collected.
// ============================================================

import type { D1Database } from '@cloudflare/workers-types';
import { denverDayBoundsUtc } from '../dailyReport/dates';

async function all<T>(db: D1Database, sql: string, ...binds: unknown[]): Promise<T[]> {
  const rs = await db.prepare(sql).bind(...binds).all<T>();
  return rs.results ?? [];
}

// ── Row types ─────────────────────────────────────────────

export interface WarrantRow {
  warrant_number: string | null;
  type: string | null;
  status: string | null;
  subject_name: string | null;
  charge_description: string | null;
  offense_level: string | null;
  bond_amount: number | null;
  served_at: string | null;
  created_at: string;
}

export interface IncidentRow {
  incident_number: string | null;
  incident_type: string | null;
  status: string | null;
  priority: string | null;
  location_address: string | null;
  created_at: string;
}

export interface AlprCaptureRow {
  id: number;
  plate: string | null;
  state: string | null;
  make: string | null;
  model: string | null;
  color: string | null;
  confidence: number | null;
  risk_score: number | null;
  review_status: string | null;
  alerted: number;
  call_id: number | null;
  created_at: string;
}

export interface PatrolScanRow {
  checkpoint_id: number;
  officer_id: number;
  status: string;
  scanned_at: string;
  notes: string | null;
}

export interface PersonRow {
  first_name: string | null;
  last_name: string | null;
  dob: string | null;
  flags: string | null;
  created_at: string;
}

export interface ExtendedActivity {
  warrants: {
    newToday: WarrantRow[];
    servedToday: WarrantRow[];
    totalCount: number;
    newCount: number;
    servedCount: number;
  };
  incidents: {
    rows: IncidentRow[];
    totalCount: number;
    byStatus: Record<string, number>;
  };
  alpr: {
    rows: AlprCaptureRow[];
    totalCount: number;
    alertedCount: number;
  };
  patrolScans: {
    rows: PatrolScanRow[];
    totalCount: number;
    onTime: number;
    late: number;
    missed: number;
  };
  persons: {
    rows: PersonRow[];
    totalCount: number;
  };
}

// ── Collection ────────────────────────────────────────────

export async function collectExtendedActivity(
  db: D1Database,
  date: string,
): Promise<ExtendedActivity> {
  const { startUtc, endUtc } = denverDayBoundsUtc(date);

  // Run all queries concurrently — each section is independent.
  const [warrantsNew, warrantsServed, incidents, alprCaptures, patrolScans, persons] =
    await Promise.all([
      // Warrants created today
      all<WarrantRow>(
        db,
        `SELECT warrant_number, type, status, subject_name, charge_description,
                offense_level, bond_amount, served_at, created_at
           FROM warrants
          WHERE created_at >= ? AND created_at < ?
          ORDER BY created_at ASC`,
        startUtc, endUtc,
      ).catch(() => [] as WarrantRow[]),

      // Warrants served today (served_at falls in the window)
      all<WarrantRow>(
        db,
        `SELECT warrant_number, type, status, subject_name, charge_description,
                offense_level, bond_amount, served_at, created_at
           FROM warrants
          WHERE served_at >= ? AND served_at < ?
          ORDER BY served_at ASC`,
        startUtc, endUtc,
      ).catch(() => [] as WarrantRow[]),

      // Incidents created today
      all<IncidentRow>(
        db,
        `SELECT incident_number, incident_type, status, priority,
                location_address, created_at
           FROM incidents
          WHERE created_at >= ? AND created_at < ?
          ORDER BY created_at ASC`,
        startUtc, endUtc,
      ).catch(() => [] as IncidentRow[]),

      // ALPR captures today
      all<AlprCaptureRow>(
        db,
        `SELECT id, plate, state, make, model, color, confidence,
                risk_score, review_status, alerted, call_id, created_at
           FROM alpr_captures
          WHERE created_at >= ? AND created_at < ?
          ORDER BY created_at ASC`,
        startUtc, endUtc,
      ).catch(() => [] as AlprCaptureRow[]),

      // Patrol scans today
      all<PatrolScanRow>(
        db,
        `SELECT checkpoint_id, officer_id, status, scanned_at, notes
           FROM patrol_scans
          WHERE scanned_at >= ? AND scanned_at < ?
          ORDER BY scanned_at ASC`,
        startUtc, endUtc,
      ).catch(() => [] as PatrolScanRow[]),

      // New persons added today
      all<PersonRow>(
        db,
        `SELECT first_name, last_name, dob, flags, created_at
           FROM persons
          WHERE created_at >= ? AND created_at < ?
          ORDER BY created_at ASC`,
        startUtc, endUtc,
      ).catch(() => [] as PersonRow[]),
    ]);

  // Aggregate incident statuses.
  const byStatus: Record<string, number> = {};
  for (const inc of incidents) {
    const s = inc.status ?? 'unknown';
    byStatus[s] = (byStatus[s] ?? 0) + 1;
  }

  // Aggregate patrol scan statuses.
  let onTime = 0, late = 0, missed = 0;
  for (const ps of patrolScans) {
    if (ps.status === 'on_time') onTime++;
    else if (ps.status === 'late') late++;
    else if (ps.status === 'missed') missed++;
  }

  return {
    warrants: {
      newToday: warrantsNew,
      servedToday: warrantsServed,
      totalCount: warrantsNew.length + warrantsServed.length,
      newCount: warrantsNew.length,
      servedCount: warrantsServed.length,
    },
    incidents: {
      rows: incidents,
      totalCount: incidents.length,
      byStatus,
    },
    alpr: {
      rows: alprCaptures,
      totalCount: alprCaptures.length,
      alertedCount: alprCaptures.filter((a) => a.alerted === 1).length,
    },
    patrolScans: {
      rows: patrolScans,
      totalCount: patrolScans.length,
      onTime,
      late,
      missed,
    },
    persons: {
      rows: persons,
      totalCount: persons.length,
    },
  };
}

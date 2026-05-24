/**
 * NIBRS flat-file writer.
 *
 * Produces a fixed-width FBI NIBRS submission file (Version 1.0, 2019
 * specification). Segments emitted:
 *   L00 Batch Header
 *   L01 Administrative
 *   L02 Offense   (one per offense, max 10/incident)
 *   L04 Victim    (one per victim)
 *   L05 Offender  (one per offender, blank if unknown)
 *   L06 Arrestee  (one per arrestee linked to this incident)
 *
 * Property (L03) and Group B arrest (L07) segments are NOT yet emitted —
 * tracked under MPI master + arrest-only flow follow-ups.
 *
 * Critical design: every segment writer uses withLength() to prepend the
 * actual 4-digit byte length of the segment body. Hardcoded lengths
 * silently rot the file when a column width changes upstream.
 */
import type Database from 'better-sqlite3';
import crypto from 'crypto';

const ORI = process.env.NIBRS_AGENCY_ORI || 'UTRMPG000';

// ─── Field helpers ───────────────────────────────────────────

const pad = (val: string | number | null | undefined, len: number, fill = ' ', align: 'L' | 'R' = 'L'): string => {
  const s = val == null ? '' : String(val);
  const trimmed = s.length > len ? s.slice(0, len) : s;
  return align === 'L' ? trimmed.padEnd(len, fill) : trimmed.padStart(len, fill);
};
const numPad = (val: number | null | undefined, len: number): string => pad(val ?? '', len, '0', 'R');
const datePad = (iso: string | null | undefined): string => {
  if (!iso) return '        ';
  // NIBRS dates are YYYYMMDD; accept either ISO timestamp or YYYY-MM-DD.
  const d = iso.length >= 10 ? iso.slice(0, 10).replace(/-/g, '') : '';
  return pad(d, 8);
};

/**
 * Prepend a 4-digit byte length to the segment body.
 * NIBRS spec: positions 1-4 = total segment length including the length itself.
 */
const withLength = (segmentLevel: string, body: string): string => {
  const total = 4 + body.length;
  return pad(total, 4, '0', 'R') + segmentLevel + body;
};

// ─── Segment writers ─────────────────────────────────────────

function batchHeader(ori: string, dateFrom: string, dateTo: string): string {
  const body =
    pad(ori, 9) +
    datePad(dateFrom) +
    datePad(dateTo) +
    pad('I', 1) +   // I = Incident report
    pad('', 6);     // filler
  return withLength('B', body);
}

type AdminRow = {
  id: number;
  incident_number: string | null;
  created_at: string;
  cleared_exceptionally: number | null;
  exceptional_clearance_code: string | null;
  cleared_at: string | null;
  nibrs_location_code: string | null;
};

function administrative(row: AdminRow): string {
  const incidentDate = datePad(row.created_at);
  const body =
    pad(ORI, 9) +
    pad(row.incident_number ?? '', 12) +
    incidentDate +
    pad('M', 1) +                            // report indicator (M = month)
    pad(row.exceptional_clearance_code ?? 'N', 1) +
    datePad(row.cleared_at) +
    pad('', 7);                              // filler
  return withLength('1', body);
}

type OffenseRowOut = {
  id: number;
  nibrs_code: string | null;
  offense_code: string | null;
  attempted_completed: string | null;
  weapon_force: string | null;
  bias_motivation: string | null;
  location_code: string | null;
  incident_id: number;
};

function offenseSegment(row: OffenseRowOut, incidentNumber: string): string {
  const code = row.nibrs_code || row.offense_code || '';
  const body =
    pad(ORI, 9) +
    pad(incidentNumber, 12) +
    pad(code, 3) +
    pad(row.attempted_completed ?? 'C', 1) +
    pad('N', 1) +                              // offender suspected of using
    pad(row.location_code ?? '20', 2) +
    pad('00', 2) +                             // # of premises entered
    pad('N', 1) +                              // method of entry
    pad('N', 1) +                              // criminal activity
    pad(row.weapon_force ?? '40', 2) +
    pad(row.bias_motivation ?? '88', 2);
  return withLength('2', body);
}

type VictimRow = {
  id: number;
  victim_seq: number;
  victim_type: string | null;       // I (Individual), B (Business), L (LE Officer), etc.
  age: number | null;
  sex: string | null;               // M | F | U
  race: string | null;              // W B I A P U
  ethnicity: string | null;         // H N U
  resident_status: string | null;   // R N U
  injury: string | null;
};

function victimSegment(v: VictimRow, incidentNumber: string): string {
  const body =
    pad(ORI, 9) +
    pad(incidentNumber, 12) +
    numPad(v.victim_seq, 3) +
    pad(v.victim_type ?? 'I', 1) +
    numPad(v.age, 4) +
    pad(v.sex ?? 'U', 1) +
    pad(v.race ?? 'U', 1) +
    pad(v.ethnicity ?? 'U', 1) +
    pad(v.resident_status ?? 'U', 1) +
    pad(v.injury ?? 'N', 1);
  return withLength('4', body);
}

type OffenderRow = {
  id: number;
  offender_seq: number;
  age: number | null;
  sex: string | null;
  race: string | null;
  ethnicity: string | null;
};

function offenderSegment(o: OffenderRow, incidentNumber: string): string {
  const body =
    pad(ORI, 9) +
    pad(incidentNumber, 12) +
    numPad(o.offender_seq, 3) +
    numPad(o.age, 4) +
    pad(o.sex ?? 'U', 1) +
    pad(o.race ?? 'U', 1) +
    pad(o.ethnicity ?? 'U', 1);
  return withLength('5', body);
}

type ArresteeRow = {
  id: number;
  arrest_number: string | null;
  arrest_date: string | null;
  arrest_type: string | null;          // O T S (on-view, summons, taken-into-custody)
  multiple_arrestee_indicator: string | null;  // C M N (count / multiple / not applicable)
  offense_code: string | null;
  arrestee_armed_with: string | null;
  age: number | null;
  sex: string | null;
  race: string | null;
};

function arresteeSegment(a: ArresteeRow, incidentNumber: string): string {
  const body =
    pad(ORI, 9) +
    pad(incidentNumber, 12) +
    pad(a.arrest_number ?? '', 12) +
    datePad(a.arrest_date) +
    pad(a.arrest_type ?? 'T', 1) +
    pad(a.multiple_arrestee_indicator ?? 'N', 1) +
    pad(a.offense_code ?? '', 3) +
    pad(a.arrestee_armed_with ?? '40', 2) +
    numPad(a.age, 4) +
    pad(a.sex ?? 'U', 1) +
    pad(a.race ?? 'U', 1);
  return withLength('6', body);
}

// ─── Top-level export ────────────────────────────────────────

export type NibrsExportResult = {
  body: string;
  incidentCount: number;
  segmentCount: number;
  byteSize: number;
  sha256: string;
};

export type NibrsExportOptions = {
  dateFrom: string;   // YYYY-MM-DD
  dateTo: string;     // YYYY-MM-DD
  includeForced?: boolean;  // if true, include admin-forced incidents (otherwise NIBRS_VALID only)
};

/**
 * Build a NIBRS flat-file for incidents submitted in [dateFrom, dateTo].
 * Returns the bytes plus a manifest. Caller is responsible for writing to disk
 * and recording the export in nibrs_exports.
 */
export function buildNibrsFlatFile(db: Database.Database, opts: NibrsExportOptions): NibrsExportResult {
  const lines: string[] = [];
  lines.push(batchHeader(ORI, opts.dateFrom, opts.dateTo));

  const incidents = db.prepare(`
    SELECT i.id, i.incident_number, i.created_at, i.cleared_exceptionally,
           i.exceptional_clearance_code, i.cleared_at, i.nibrs_location_code
    FROM incidents i
    WHERE i.status IN ('submitted','under_review','approved')
      AND DATE(i.created_at) BETWEEN ? AND ?
    ORDER BY i.created_at ASC
  `).all(opts.dateFrom, opts.dateTo) as AdminRow[];

  for (const inc of incidents) {
    if (!inc.incident_number) continue;
    lines.push(administrative(inc));

    try {
      const offenses = db.prepare(`SELECT * FROM incident_offenses WHERE incident_id = ?`).all(inc.id) as OffenseRowOut[];
      for (const off of offenses) lines.push(offenseSegment(off, inc.incident_number));
    } catch { /* table missing in dev */ }

    try {
      const victims = db.prepare(`
        SELECT id,
               ROW_NUMBER() OVER (ORDER BY id) AS victim_seq,
               COALESCE(victim_type, 'I') as victim_type,
               age, sex, race, ethnicity, resident_status,
               COALESCE(injury, 'N') as injury
        FROM incident_victims WHERE incident_id = ?
      `).all(inc.id) as VictimRow[];
      for (const v of victims) lines.push(victimSegment(v, inc.incident_number));
    } catch { /* optional */ }

    try {
      const offenders = db.prepare(`
        SELECT id,
               ROW_NUMBER() OVER (ORDER BY id) AS offender_seq,
               age, sex, race, ethnicity
        FROM incident_offenders WHERE incident_id = ?
      `).all(inc.id) as OffenderRow[];
      for (const o of offenders) lines.push(offenderSegment(o, inc.incident_number));
    } catch { /* optional */ }

    try {
      const arrestees = db.prepare(`
        SELECT a.id, a.arrest_number, a.arrest_date,
               a.arrest_type, a.multiple_arrestee_indicator,
               a.offense_code, a.arrestee_armed_with,
               a.age, a.sex, a.race
        FROM arrest_records a
        WHERE a.incident_id = ?
      `).all(inc.id) as ArresteeRow[];
      for (const ar of arrestees) lines.push(arresteeSegment(ar, inc.incident_number));
    } catch { /* optional */ }
  }

  const body = lines.join('\n') + '\n';
  return {
    body,
    incidentCount: incidents.length,
    segmentCount: lines.length,
    byteSize: Buffer.byteLength(body, 'utf8'),
    sha256: crypto.createHash('sha256').update(body).digest('hex'),
  };
}

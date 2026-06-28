// ============================================================
// RMPG Flex — FBI NIBRS 2019 Flat-File Generator (NB-3)
// Stand-in for the Utah BCI flat-file (user accepted this scope:
// see CLAUDE.md notes for NB-3). Produces a NIBRS 2019 segment
// stream the FBI's national submission tool can ingest, with
// `${ORI}` slot for the agency identifier. State adapters can
// reshape per-jurisdiction later.
//
// Segment levels implemented:
//   L00  ZERO (file header)
//   L01  Administrative
//   L02  Offense (one per incident_offenses row)
//   L04  Victim (one per incident_persons role='victim')
//   L05  Offender (one per incident_persons role='suspect')
//   L06  Arrestee (one per linked arrest_records row)
//
// Deferred (would extend the same module):
//   L03  Property — needs property master (MPI gap, P2 follow-up)
//   L07  Group B Arrest — needs arrest-only standalone flow
//   L99  Trailer + record counts — added when state adapter requires it
//
// Each writer is a pure function: receives a typed shape, returns
// a fixed-width ASCII string. Pad/truncate is centralised in `f()`.
// ============================================================

import { getDb } from '../models/database';

/** Reporting agency ORI. Set via env at runtime; falls back to a placeholder. */
function getAgencyORI(): string {
  return (process.env.NIBRS_AGENCY_ORI || 'UTRMPG000').slice(0, 9).padEnd(9, ' ');
}

/** Pad/truncate a value to an exact field width. NIBRS uses left-aligned
 * text with trailing spaces; numerics are right-aligned with leading zeros
 * (pass `zero: true`). Always sanitises to ASCII printable. */
function f(value: unknown, width: number, opts?: { zero?: boolean }): string {
  let s = value == null ? '' : String(value);
  // Strip non-ASCII-printable and the NIBRS field separator (we use fixed-width)
  s = s.replace(/[^\x20-\x7E]/g, ' ').slice(0, width);
  if (opts?.zero) {
    return s.padStart(width, '0');
  }
  return s.padEnd(width, ' ');
}

// FIX (QA C3): FBI NIBRS requires LOCAL agency time, not UTC.
// Project timezone is America/Denver (CLAUDE.md). Using UTC made
// any incident 5pm-midnight Mountain export with the next day's date.
const AGENCY_TZ = process.env.NIBRS_AGENCY_TZ || 'America/Denver';

function localParts(d: Date): { year: string; month: string; day: string; hour: string; minute: string } {
  // en-CA gives YYYY-MM-DD HH:mm:ss in local timezone
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: AGENCY_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
  return {
    year: parts.year || '0000',
    month: parts.month || '00',
    day: parts.day || '00',
    // Intl 'hour' with hour12:false can emit '24' for midnight — normalise
    hour: (parts.hour === '24' ? '00' : parts.hour) || '00',
    minute: parts.minute || '00',
  };
}

/** Format a Date or YYYY-MM-DD string as NIBRS YYYYMMDD in agency local time. */
function nibrsDate(v: string | Date | null | undefined): string {
  if (!v) return '        '; // 8 spaces = unknown
  const d = typeof v === 'string' ? new Date(v) : v;
  if (isNaN(d.getTime())) return '        ';
  const p = localParts(d);
  return p.year + p.month + p.day;
}

/** Format a Date as NIBRS YYYYMMDDHHMM in agency local time. */
function nibrsDateTime(v: string | Date | null | undefined): string {
  if (!v) return '            ';
  const d = typeof v === 'string' ? new Date(v) : v;
  if (isNaN(d.getTime())) return '            ';
  const p = localParts(d);
  return p.year + p.month + p.day + p.hour + p.minute;
}

// ── Segment writers ──────────────────────────────────────────
//
// FIX (QA C1): segment length field (bytes 3-6) must reflect the
// ACTUAL byte length of the record per FBI spec, not a literal.
// `withLength(level, body)` computes it once at the call site so
// no per-segment math is hand-coded.

function withLength(level: string, body: string): string {
  // total length = 2 (level) + 4 (length field) + body.length
  const total = 6 + body.length;
  return level + f(total, 4, { zero: true }) + body;
}

export function segL00(args: { batchDate: Date; fromDate: Date; toDate: Date }): string {
  // Level | Segment-Length | ORI | Run-date | From-date | To-date
  const body =
    getAgencyORI() +                            // 9
    nibrsDate(args.batchDate) +                 // 8
    nibrsDate(args.fromDate) +                  // 8
    nibrsDate(args.toDate);                     // 8
  return withLength('00', body);
}

export function segL01(args: {
  incidentNumber: string;
  incidentDate: string | Date;
  reportDate: string | Date | null;
  exceptionalClearance: 'A' | 'B' | 'C' | 'D' | 'E' | 'N';
  exceptionalClearanceDate: string | Date | null;
  cargoTheft: 'Y' | 'N' | 'U';
}): string {
  const body =
    getAgencyORI() +
    f(args.incidentNumber, 12) +
    nibrsDateTime(args.incidentDate) +
    f(args.exceptionalClearance, 1) +
    nibrsDate(args.exceptionalClearanceDate) +
    f(args.cargoTheft, 1);
  return withLength('01', body);
}

export function segL02(args: {
  incidentNumber: string;
  offenseCode: string;
  attemptedCompleted: 'A' | 'C';
  locationType: string;
  weaponForce: string;
  biasMotivation: string;
  numberOfPremises: number | null;
  methodOfEntry: 'F' | 'N' | 'U' | '';
  criminalActivity: string;
}): string {
  const body =
    getAgencyORI() +
    f(args.incidentNumber, 12) +
    f(args.offenseCode, 3) +
    f(args.attemptedCompleted, 1) +
    f(args.locationType || '25', 2) +
    f(args.weaponForce, 3) +
    f(args.biasMotivation || '88', 2) +
    f(args.numberOfPremises == null ? '' : args.numberOfPremises, 2, { zero: true }) +
    f(args.methodOfEntry, 1) +
    f(args.criminalActivity, 1);
  return withLength('02', body);
}

export function segL04(args: {
  incidentNumber: string;
  victimSequence: number;
  victimType: 'I' | 'B' | 'F' | 'G' | 'L' | 'O' | 'P' | 'R' | 'S' | 'U';
  age: number | string | null;
  sex: 'M' | 'F' | 'U';
  race: 'W' | 'B' | 'I' | 'A' | 'P' | 'U';
  ethnicity: 'H' | 'N' | 'U';
  residentStatus: 'R' | 'N' | 'U';
  injuries: string;
  offenderRelationship: string;
}): string {
  const body =
    getAgencyORI() +
    f(args.incidentNumber, 12) +
    f(args.victimSequence, 3, { zero: true }) +
    f(args.victimType, 1) +
    f(args.age == null ? '' : args.age, 4) +
    f(args.sex || 'U', 1) +
    f(args.race || 'U', 1) +
    f(args.ethnicity || 'U', 1) +
    f(args.residentStatus || 'U', 1) +
    f(args.injuries, 5) +
    f(args.offenderRelationship, 2);
  return withLength('04', body);
}

export function segL05(args: {
  incidentNumber: string;
  offenderSequence: number;
  age: number | string | null;
  sex: 'M' | 'F' | 'U';
  race: 'W' | 'B' | 'I' | 'A' | 'P' | 'U';
  ethnicity: 'H' | 'N' | 'U';
}): string {
  const body =
    getAgencyORI() +
    f(args.incidentNumber, 12) +
    f(args.offenderSequence, 3, { zero: true }) +
    f(args.age == null ? '' : args.age, 4) +
    f(args.sex || 'U', 1) +
    f(args.race || 'U', 1) +
    f(args.ethnicity || 'U', 1);
  return withLength('05', body);
}

export function segL06(args: {
  incidentNumber: string;
  arresteeSequence: number;
  arrestNumber: string;
  arrestDate: string | Date;
  arrestType: 'O' | 'S' | 'T';
  multipleArresteeIndicator: 'M' | 'C' | 'N';
  offenseCode: string;
  arresteeArmed: string;
  age: number | string | null;
  sex: 'M' | 'F' | 'U';
  race: 'W' | 'B' | 'I' | 'A' | 'P' | 'U';
  ethnicity: 'H' | 'N' | 'U';
  residentStatus: 'R' | 'N' | 'U';
  juvenileDisposition: 'H' | 'R' | 'C' | 'D' | 'W' | '';
}): string {
  const body =
    getAgencyORI() +
    f(args.incidentNumber, 12) +
    f(args.arresteeSequence, 3, { zero: true }) +
    f(args.arrestNumber, 12) +
    nibrsDate(args.arrestDate) +
    f(args.arrestType, 1) +
    f(args.multipleArresteeIndicator, 1) +
    f(args.offenseCode, 3) +
    f(args.arresteeArmed, 6) +
    f(args.age == null ? '' : args.age, 4) +
    f(args.sex || 'U', 1) +
    f(args.race || 'U', 1) +
    f(args.ethnicity || 'U', 1) +
    f(args.residentStatus || 'U', 1) +
    f(args.juvenileDisposition, 1);
  return withLength('06', body);
}

// ── Translation helpers ──────────────────────────────────────

function pickSex(v: unknown): 'M' | 'F' | 'U' {
  const s = String(v || '').trim().toLowerCase();
  if (s.startsWith('m')) return 'M';
  if (s.startsWith('f')) return 'F';
  return 'U';
}

function pickRace(v: unknown): 'W' | 'B' | 'I' | 'A' | 'P' | 'U' {
  const s = String(v || '').trim().toLowerCase();
  if (s.startsWith('w')) return 'W';
  if (s.startsWith('b') || s.includes('african')) return 'B';
  if (s.startsWith('i') || s.includes('native') || s.includes('indian')) return 'I';
  if (s.startsWith('a')) return 'A';
  if (s.startsWith('p')) return 'P';
  return 'U';
}

function pickEthnicity(v: unknown): 'H' | 'N' | 'U' {
  const s = String(v || '').trim().toLowerCase();
  if (s.includes('hisp') || s.includes('latin')) return 'H';
  if (s.includes('non') || s.startsWith('n')) return 'N';
  return 'U';
}

function ageFromDOB(dob: string | null | undefined, asOf: Date): string {
  if (!dob) return '00';
  const d = new Date(dob);
  if (isNaN(d.getTime())) return '00';
  let age = asOf.getFullYear() - d.getFullYear();
  const m = asOf.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && asOf.getDate() < d.getDate())) age--;
  if (age < 0 || age > 99) return '00';
  return age.toString().padStart(2, '0');
}

// ── Top-level: build the segment stream for a date range ─────

export interface BuildOptions {
  fromDate: Date;
  toDate: Date;
  /** When true, validates each incident and skips invalid ones,
   *  recording them in `excluded`. When false, every incident in
   *  range is emitted regardless of validation status. */
  enforceValidation?: boolean;
}

export interface BuildResult {
  /** Newline-joined NIBRS segment stream, ready to write to .dat */
  content: string;
  /** Incidents that produced segments. */
  included: { incident_id: number; incident_number: string; segments: number }[];
  /** Incidents skipped due to validation failures. */
  excluded: { incident_id: number; incident_number: string; errors: { field: string; message: string }[] }[];
  totalSegments: number;
}

export async function buildNibrsExport(options: BuildOptions): Promise<BuildResult> {
  const db = getDb();
  const { fromDate, toDate, enforceValidation = true } = options;

  // Pick approved incidents in the date window. FBI submits only approved
  // records — drafts/under_review never go to the state.
  const incidents = db.prepare(`
    SELECT * FROM incidents
    WHERE status IN ('approved', 'closed')
      AND COALESCE(occurred_at, reported_at, created_at) >= ?
      AND COALESCE(occurred_at, reported_at, created_at) <= ?
    ORDER BY id
  `).all(fromDate.toISOString(), toDate.toISOString()) as any[];

  const segments: string[] = [segL00({ batchDate: new Date(), fromDate, toDate })];
  const included: BuildResult['included'] = [];
  const excluded: BuildResult['excluded'] = [];

  // Lazy import to avoid circular ref (validator imports getDb too)
  const { validateIncidentForNibrs } = await import('./nibrsValidator');

  for (const inc of incidents) {
    if (enforceValidation) {
      const v = validateIncidentForNibrs(inc.id);
      if (!v.valid) {
        excluded.push({
          incident_id: inc.id,
          incident_number: inc.incident_number,
          errors: v.errors.map((e) => ({ field: e.missing_field, message: e.message })),
        });
        continue;
      }
    }

    const incidentNumber = inc.incident_number || `RMP${inc.id}`;
    let perIncidentCount = 0;

    // L01 Admin
    segments.push(segL01({
      incidentNumber,
      incidentDate: inc.occurred_at || inc.reported_at || inc.created_at,
      reportDate: inc.reported_at,
      exceptionalClearance: 'N',
      exceptionalClearanceDate: null,
      cargoTheft: 'N',
    }));
    perIncidentCount++;

    // L02 Offenses
    const offenses = db.prepare(`
      SELECT * FROM incident_offenses WHERE incident_id = ?
    `).all(inc.id) as any[];
    for (const off of offenses) {
      segments.push(segL02({
        incidentNumber,
        offenseCode: off.nibrs_code || '90Z',
        attemptedCompleted: (off.attempted_completed === 'attempted' ? 'A' : 'C'),
        locationType: off.location_type || '25',
        weaponForce: (off.weapon_force || '').replace(/[^0-9]/g, '').slice(0, 3),
        biasMotivation: (off.bias_motivation || '88').slice(0, 2),
        numberOfPremises: null,
        methodOfEntry: '',
        criminalActivity: (off.criminal_activity || '').slice(0, 1),
      }));
      perIncidentCount++;
    }

    // L04 Victims  +  L05 Offenders (driven by incident_persons roles)
    const persons = db.prepare(`
      SELECT ip.role, p.*
      FROM incident_persons ip
      JOIN persons p ON p.id = ip.person_id
      WHERE ip.incident_id = ?
      ORDER BY ip.id
    `).all(inc.id) as any[];

    let victimSeq = 0;
    let offenderSeq = 0;
    const asOf = new Date(inc.occurred_at || inc.reported_at || inc.created_at);
    for (const p of persons) {
      if (p.role === 'victim') {
        victimSeq++;
        segments.push(segL04({
          incidentNumber,
          victimSequence: victimSeq,
          victimType: 'I',  // Individual (vs Business/Government/etc.)
          age: ageFromDOB(p.dob, asOf),
          sex: pickSex(p.gender),
          race: pickRace(p.race),
          ethnicity: pickEthnicity(p.ethnicity),
          residentStatus: 'U',
          injuries: '',
          offenderRelationship: '',
        }));
        perIncidentCount++;
      }
      if (p.role === 'suspect') {
        offenderSeq++;
        segments.push(segL05({
          incidentNumber,
          offenderSequence: offenderSeq,
          age: ageFromDOB(p.dob, asOf),
          sex: pickSex(p.gender),
          race: pickRace(p.race),
          ethnicity: pickEthnicity(p.ethnicity),
        }));
        perIncidentCount++;
      }
    }

    // L06 Arrestees (linked arrest_records via incident_links or arrest.incident_id)
    let arrests: any[] = [];
    try {
      arrests = db.prepare(`
        SELECT a.*, p.dob, p.gender, p.race, p.ethnicity
        FROM arrest_records a
        LEFT JOIN persons p ON p.id = a.person_id
        WHERE a.linked_incident_id = ? OR a.incident_id = ?
      `).all(inc.id, inc.id) as any[];
    } catch {
      try {
        arrests = db.prepare(`
          SELECT a.*, p.dob, p.gender, p.race, p.ethnicity
          FROM arrest_records a
          LEFT JOIN persons p ON p.id = a.person_id
          WHERE a.incident_id = ?
        `).all(inc.id) as any[];
      } catch { arrests = []; }
    }
    let arresteeSeq = 0;
    for (const a of arrests) {
      arresteeSeq++;
      segments.push(segL06({
        incidentNumber,
        arresteeSequence: arresteeSeq,
        arrestNumber: a.arrest_number || `A${a.id}`,
        arrestDate: a.arrest_date || a.created_at,
        arrestType: 'T',
        // FIX (QA C4): 'M' means same person, multiple arrests across incidents.
        // 'C' (Count) = this arrest counts as one charge — correct default for
        // an in-custody arrest with no cross-incident multiplexing.
        multipleArresteeIndicator: 'C',
        offenseCode: (a.charge_code || a.nibrs_code || '90Z').slice(0, 3),
        arresteeArmed: '99    ',
        age: ageFromDOB(a.dob, asOf),
        sex: pickSex(a.gender),
        race: pickRace(a.race),
        ethnicity: pickEthnicity(a.ethnicity),
        residentStatus: 'U',
        juvenileDisposition: '',
      }));
      perIncidentCount++;
    }

    included.push({ incident_id: inc.id, incident_number: incidentNumber, segments: perIncidentCount });
  }

  return {
    content: segments.join('\n') + '\n',
    included,
    excluded,
    totalSegments: segments.length,
  };
}

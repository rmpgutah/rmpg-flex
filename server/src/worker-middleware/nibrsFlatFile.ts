// ============================================================
// RMPG Flex — FBI NIBRS 2019 Flat-File Generator (Hono/D1, NB-3)
// Async port of server/src/utils/nibrsFlatFile.ts. Segment writers
// stay pure; only the orchestrating buildNibrsExport() goes async.
// All QA fixes from the Express version preserved:
//   - withLength() computes segment byte counts dynamically
//   - nibrsDate/nibrsDateTime use America/Denver (not UTC)
//   - multipleArresteeIndicator defaults to 'C', not 'M'
// ============================================================

import { D1Db } from './d1Helpers';
import { validateIncidentForNibrs } from './nibrsValidator';

function getAgencyORI(env: { NIBRS_AGENCY_ORI?: string } | undefined): string {
  return (env?.NIBRS_AGENCY_ORI || 'UTRMPG000').slice(0, 9).padEnd(9, ' ');
}

function f(value: unknown, width: number, opts?: { zero?: boolean }): string {
  let s = value == null ? '' : String(value);
  s = s.replace(/[^\x20-\x7E]/g, ' ').slice(0, width);
  if (opts?.zero) return s.padStart(width, '0');
  return s.padEnd(width, ' ');
}

function withLength(level: string, body: string): string {
  const total = 6 + body.length;
  return level + f(total, 4, { zero: true }) + body;
}

const AGENCY_TZ = 'America/Denver';

function localParts(d: Date): { year: string; month: string; day: string; hour: string; minute: string } {
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
    hour: (parts.hour === '24' ? '00' : parts.hour) || '00',
    minute: parts.minute || '00',
  };
}

function nibrsDate(v: string | Date | null | undefined): string {
  if (!v) return '        ';
  const d = typeof v === 'string' ? new Date(v) : v;
  if (isNaN(d.getTime())) return '        ';
  const p = localParts(d);
  return p.year + p.month + p.day;
}

function nibrsDateTime(v: string | Date | null | undefined): string {
  if (!v) return '            ';
  const d = typeof v === 'string' ? new Date(v) : v;
  if (isNaN(d.getTime())) return '            ';
  const p = localParts(d);
  return p.year + p.month + p.day + p.hour + p.minute;
}

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

export interface BuildOptions {
  fromDate: Date;
  toDate: Date;
  enforceValidation?: boolean;
}

export interface BuildResult {
  content: string;
  included: { incident_id: number; incident_number: string; segments: number }[];
  excluded: { incident_id: number; incident_number: string; errors: { field: string; message: string }[] }[];
  totalSegments: number;
}

export async function buildNibrsExport(
  db: D1Db,
  env: { NIBRS_AGENCY_ORI?: string },
  options: BuildOptions,
): Promise<BuildResult> {
  const { fromDate, toDate, enforceValidation = true } = options;
  const ORI = getAgencyORI(env);

  const incidents = await db.prepare(`
    SELECT * FROM incidents
    WHERE status IN ('approved', 'closed')
      AND COALESCE(occurred_at, reported_at, created_at) >= ?
      AND COALESCE(occurred_at, reported_at, created_at) <= ?
    ORDER BY id
  `).all(fromDate.toISOString(), toDate.toISOString()) as any[];

  const batchHeader = withLength('00',
    ORI + nibrsDate(new Date()) + nibrsDate(fromDate) + nibrsDate(toDate));
  const segments: string[] = [batchHeader];
  const included: BuildResult['included'] = [];
  const excluded: BuildResult['excluded'] = [];

  for (const inc of incidents) {
    if (enforceValidation) {
      const v = await validateIncidentForNibrs(db, inc.id);
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
    segments.push(withLength('01',
      ORI + f(incidentNumber, 12) + nibrsDateTime(inc.occurred_at || inc.reported_at || inc.created_at) +
      f('N', 1) + nibrsDate(null) + f('N', 1)));
    perIncidentCount++;

    // L02 Offenses
    const offenses = await db.prepare('SELECT * FROM incident_offenses WHERE incident_id = ?').all(inc.id) as any[];
    for (const off of offenses) {
      segments.push(withLength('02',
        ORI + f(incidentNumber, 12) + f(off.nibrs_code || '90Z', 3) +
        f(off.attempted_completed === 'attempted' ? 'A' : 'C', 1) +
        f(off.location_type || '25', 2) +
        f(String(off.weapon_force || '').replace(/[^0-9]/g, '').slice(0, 3), 3) +
        f((off.bias_motivation || '88').slice(0, 2), 2) +
        f('', 2, { zero: true }) + f('', 1) +
        f(String(off.criminal_activity || '').slice(0, 1), 1)));
      perIncidentCount++;
    }

    // L04 Victims + L05 Offenders
    const persons = await db.prepare(`
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
        segments.push(withLength('04',
          ORI + f(incidentNumber, 12) + f(victimSeq, 3, { zero: true }) +
          f('I', 1) + f(ageFromDOB(p.dob, asOf), 4) +
          f(pickSex(p.gender), 1) + f(pickRace(p.race), 1) + f(pickEthnicity(p.ethnicity), 1) +
          f('U', 1) + f('', 5) + f('', 2)));
        perIncidentCount++;
      }
      if (p.role === 'suspect') {
        offenderSeq++;
        segments.push(withLength('05',
          ORI + f(incidentNumber, 12) + f(offenderSeq, 3, { zero: true }) +
          f(ageFromDOB(p.dob, asOf), 4) +
          f(pickSex(p.gender), 1) + f(pickRace(p.race), 1) + f(pickEthnicity(p.ethnicity), 1)));
        perIncidentCount++;
      }
    }

    // L06 Arrestees
    let arrests: any[] = [];
    try {
      arrests = await db.prepare(`
        SELECT a.*, p.dob, p.gender, p.race, p.ethnicity
        FROM arrest_records a
        LEFT JOIN persons p ON p.id = a.person_id
        WHERE a.linked_incident_id = ? OR a.incident_id = ?
      `).all(inc.id, inc.id) as any[];
    } catch {
      try {
        arrests = await db.prepare(`
          SELECT a.*, p.dob, p.gender, p.race, p.ethnicity
          FROM arrest_records a LEFT JOIN persons p ON p.id = a.person_id
          WHERE a.incident_id = ?
        `).all(inc.id) as any[];
      } catch { arrests = []; }
    }
    let arresteeSeq = 0;
    for (const a of arrests) {
      arresteeSeq++;
      segments.push(withLength('06',
        ORI + f(incidentNumber, 12) + f(arresteeSeq, 3, { zero: true }) +
        f(a.arrest_number || `A${a.id}`, 12) +
        nibrsDate(a.arrest_date || a.created_at) +
        f('T', 1) + f('C', 1) +
        f((a.charge_code || a.nibrs_code || '90Z').slice(0, 3), 3) +
        f('99    ', 6) +
        f(ageFromDOB(a.dob, asOf), 4) +
        f(pickSex(a.gender), 1) + f(pickRace(a.race), 1) + f(pickEthnicity(a.ethnicity), 1) +
        f('U', 1) + f('', 1)));
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

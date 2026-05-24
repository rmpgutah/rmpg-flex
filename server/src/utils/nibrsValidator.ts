/**
 * NIBRS submit-gate validator.
 *
 * Runs structural validation on an incident before it can be submitted
 * for state reporting. Returns an array of errors (blocking) and warnings
 * (non-blocking). The /submit route hard-gates on errors unless the
 * caller is admin and passes ?force=1 (audit-logged override).
 *
 * Rule sources: FBI NIBRS Technical Specification v1.0 (2019),
 * Sections 4.1 (Administrative segment) through 4.7 (Group B Arrest).
 */
import type Database from 'better-sqlite3';

export type NibrsIssue = {
  code: string;        // stable code for client mapping (e.g. 'M01_MISSING_LOCATION')
  segment: 'incident' | 'offense' | 'victim' | 'property' | 'offender' | 'arrestee';
  field?: string;
  message: string;
  refId?: number;      // related row id (offense.id, victim.id, etc.)
};

export type NibrsValidation = {
  ok: boolean;
  errors: NibrsIssue[];
  warnings: NibrsIssue[];
};

type IncidentRow = {
  id: number;
  incident_number: string | null;
  incident_type: string;
  status: string;
  location_address: string | null;
  latitude: number | null;
  longitude: number | null;
  narrative: string | null;
  officer_id: number;
  created_at: string;
  nibrs_location_code?: string | null;
  cleared_exceptionally?: number | null;
  exceptional_clearance_code?: string | null;
  domestic_violence?: number | null;
};

type OffenseRow = {
  id: number;
  incident_id: number;
  nibrs_code: string | null;
  offense_code?: string | null;
  attempted_completed?: string | null;  // 'A' | 'C'
  offender_suspected_of_using?: string | null;
  bias_motivation?: string | null;
  weapon_force?: string | null;
};

export function validateIncidentForNibrs(db: Database.Database, incidentId: number): NibrsValidation {
  const errors: NibrsIssue[] = [];
  const warnings: NibrsIssue[] = [];

  const incident = db.prepare('SELECT * FROM incidents WHERE id = ?').get(incidentId) as IncidentRow | undefined;
  if (!incident) {
    return {
      ok: false,
      errors: [{ code: 'INCIDENT_NOT_FOUND', segment: 'incident', message: `Incident ${incidentId} not found` }],
      warnings: [],
    };
  }

  // ── Administrative segment (L01) ──
  if (!incident.incident_number) {
    errors.push({ code: 'M01_MISSING_INCIDENT_NUMBER', segment: 'incident', field: 'incident_number', message: 'Incident number is required.' });
  } else if (incident.incident_number.length > 12) {
    errors.push({ code: 'M01_INCIDENT_NUMBER_TOO_LONG', segment: 'incident', field: 'incident_number', message: 'Incident number cannot exceed 12 characters per NIBRS spec.' });
  }
  if (!incident.created_at) {
    errors.push({ code: 'M02_MISSING_INCIDENT_DATE', segment: 'incident', field: 'created_at', message: 'Incident date is required.' });
  }
  if (!incident.narrative || incident.narrative.trim().length < 10) {
    errors.push({ code: 'M03_NARRATIVE_TOO_SHORT', segment: 'incident', field: 'narrative', message: 'Narrative must be at least 10 characters.' });
  }

  // Exceptional clearance — if cleared exceptionally, code is required.
  if (incident.cleared_exceptionally && !incident.exceptional_clearance_code) {
    errors.push({ code: 'M04_MISSING_EXCEPTIONAL_CLEARANCE', segment: 'incident', field: 'exceptional_clearance_code', message: 'Exceptional clearance code is required when cleared_exceptionally is set.' });
  }

  // ── Offense segment(s) (L02) ──
  let offenses: OffenseRow[] = [];
  try {
    offenses = db.prepare('SELECT * FROM incident_offenses WHERE incident_id = ?').all(incidentId) as OffenseRow[];
  } catch {
    // Table may not exist in dev
  }
  if (offenses.length === 0) {
    errors.push({ code: 'M05_NO_OFFENSES', segment: 'offense', message: 'At least one offense is required.' });
  }
  if (offenses.length > 10) {
    errors.push({ code: 'M06_TOO_MANY_OFFENSES', segment: 'offense', message: 'NIBRS allows at most 10 offenses per incident.' });
  }

  // Cache offense-code lookup once (not per offense — N+1 hoist).
  const offenseCodeMap = new Map<string, { crime_against: string; group_class: string; victim_required: number; property_required: number }>();
  try {
    const rows = db.prepare('SELECT code, crime_against, group_class, victim_required, property_required FROM nibrs_offense_codes WHERE active = 1').all() as Array<{ code: string; crime_against: string; group_class: string; victim_required: number; property_required: number }>;
    for (const r of rows) offenseCodeMap.set(r.code, r);
  } catch {
    warnings.push({ code: 'W01_OFFENSE_CODES_TABLE_MISSING', segment: 'offense', message: 'NIBRS offense code table unavailable; cannot cross-check offense codes.' });
  }

  // Per-offense rules
  const personOrPropertyCount = { needsVictim: 0, needsProperty: 0 };
  for (const off of offenses) {
    const code = off.nibrs_code || off.offense_code;
    if (!code) {
      errors.push({ code: 'M07_OFFENSE_CODE_MISSING', segment: 'offense', refId: off.id, message: `Offense ${off.id} missing NIBRS code.` });
      continue;
    }
    const def = offenseCodeMap.get(code);
    if (offenseCodeMap.size > 0 && !def) {
      errors.push({ code: 'M08_OFFENSE_CODE_UNKNOWN', segment: 'offense', refId: off.id, message: `Offense ${off.id} has unknown NIBRS code "${code}".` });
      continue;
    }
    if (!off.attempted_completed || !['A', 'C'].includes(off.attempted_completed)) {
      errors.push({ code: 'M09_ATTEMPTED_COMPLETED', segment: 'offense', refId: off.id, message: `Offense ${off.id}: attempted_completed must be 'A' (attempted) or 'C' (completed).` });
    }
    if (def) {
      if (def.victim_required === 1) personOrPropertyCount.needsVictim++;
      if (def.property_required === 1) personOrPropertyCount.needsProperty++;
    }
    // Bias-motivation: optional but if set must be a known code.
    if (off.bias_motivation) {
      const known = db.prepare('SELECT 1 FROM nibrs_bias_codes WHERE code = ? AND active = 1').get(off.bias_motivation);
      if (!known) {
        warnings.push({ code: 'W02_UNKNOWN_BIAS', segment: 'offense', refId: off.id, message: `Offense ${off.id}: bias_motivation "${off.bias_motivation}" not in nibrs_bias_codes.` });
      }
    }
  }

  // ── Location code (incident-level Data Element 9) ──
  if (!incident.nibrs_location_code) {
    warnings.push({ code: 'W03_MISSING_LOCATION_CODE', segment: 'incident', field: 'nibrs_location_code', message: 'NIBRS location code recommended but missing.' });
  }

  // ── Victim segment (L04) ──
  let victimCount = 0;
  try {
    const r = db.prepare('SELECT COUNT(*) as c FROM call_persons WHERE call_id IN (SELECT call_id FROM incidents WHERE id = ?) AND role = ?').get(incidentId, 'victim') as { c: number };
    victimCount = r.c;
  } catch { /* ignore */ }
  // Some installs link victims directly to incidents.
  try {
    const r = db.prepare(`SELECT COUNT(*) as c FROM incident_links WHERE incident_id = ? AND link_reason = 'victim'`).get(incidentId) as { c: number };
    if (r.c > victimCount) victimCount = r.c;
  } catch { /* ignore */ }

  if (personOrPropertyCount.needsVictim > 0 && victimCount === 0) {
    errors.push({ code: 'M10_NO_VICTIM', segment: 'victim', message: `Offense requires a victim, but none is linked.` });
  }

  // ── Cross-cutting domestic-violence rule ──
  if (incident.domestic_violence) {
    const hasDvSupp = db.prepare('SELECT 1 FROM incident_dv_supplements WHERE incident_id = ?').get(incidentId);
    if (!hasDvSupp) {
      warnings.push({ code: 'W04_DV_FLAG_NO_SUPPLEMENT', segment: 'incident', message: 'Incident flagged domestic_violence but no DV supplement attached.' });
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

// ============================================================
// RMPG Flex — NIBRS submit validator (NB-2)
// For each offense on an incident, look up the FBI required-field
// metadata (seeded in nibrs_offense_codes by NB-1) and verify the
// corresponding incident_offense / incident_persons / evidence
// rows are populated. Called from PUT /api/incidents/:id/submit.
//
// Severity model:
//   'error'   — blocks submit (FBI-required field missing)
//   'warning' — does NOT block; flagged for supervisor review
//
// Admin god-mode at the route layer can still bypass.
// ============================================================

import { getDb } from '../models/database';

export type ValidationSeverity = 'error' | 'warning';

export interface NibrsValidationIssue {
  offense_id: number | null;        // null if issue is incident-wide
  offense_code: string | null;
  missing_field: string;
  severity: ValidationSeverity;
  message: string;
}

export interface NibrsValidationResult {
  incident_id: number;
  valid: boolean;
  errors: NibrsValidationIssue[];   // severity=error
  warnings: NibrsValidationIssue[]; // severity=warning
}

function isMissing(v: unknown): boolean {
  if (v == null) return true;
  const s = String(v).trim();
  if (!s) return true;
  if (s === '0' || s.toLowerCase() === 'none' || s.toLowerCase() === 'unknown') return true;
  return false;
}

export function validateIncidentForNibrs(incidentId: number): NibrsValidationResult {
  const db = getDb();
  const issues: NibrsValidationIssue[] = [];

  const incident = db.prepare('SELECT * FROM incidents WHERE id = ?').get(incidentId) as any;
  if (!incident) {
    return {
      incident_id: incidentId,
      valid: false,
      errors: [{ offense_id: null, offense_code: null, missing_field: 'incident', severity: 'error', message: 'Incident not found' }],
      warnings: [],
    };
  }

  // Incident-wide checks ─────────────────────────────────────
  if (isMissing(incident.narrative)) {
    issues.push({ offense_id: null, offense_code: null, missing_field: 'narrative', severity: 'error', message: 'Incident narrative is required' });
  }
  if (isMissing(incident.location_address)) {
    issues.push({ offense_id: null, offense_code: null, missing_field: 'location_address', severity: 'error', message: 'Incident location is required (NIBRS Admin segment)' });
  }
  if (isMissing(incident.occurred_at) && isMissing(incident.reported_at)) {
    issues.push({ offense_id: null, offense_code: null, missing_field: 'occurred_at', severity: 'error', message: 'Occurrence date/time is required (NIBRS Admin segment)' });
  }

  // At least one officer assigned (NIBRS Admin)
  const officerCount = db.prepare('SELECT COUNT(*) AS n FROM incident_officers WHERE incident_id = ?').get(incidentId) as { n: number };
  if (!officerCount.n) {
    issues.push({ offense_id: null, offense_code: null, missing_field: 'officer', severity: 'error', message: 'At least one officer must be assigned' });
  }

  // Offense-level checks ─────────────────────────────────────
  const offenses = db.prepare(`
    SELECT io.*, nc.ucr_group, nc.category,
           nc.attempted_completed_required, nc.victim_required,
           nc.weapon_required, nc.bias_required,
           nc.property_required, nc.drug_required
    FROM incident_offenses io
    LEFT JOIN nibrs_offense_codes nc ON nc.code = io.nibrs_code
    WHERE io.incident_id = ?
  `).all(incidentId) as any[];

  if (offenses.length === 0) {
    issues.push({ offense_id: null, offense_code: null, missing_field: 'offense', severity: 'error', message: 'At least one offense must be listed' });
  }

  // FIX (QA M3): hoist the per-offense lookups out of the loop. Both
  // queries are incident-scoped (not offense-scoped) — running them per
  // offense was O(N) identical hits on incident_persons + evidence.
  const incidentHasVictim = db.prepare(
    "SELECT 1 FROM incident_persons WHERE incident_id = ? AND role = 'victim' LIMIT 1"
  ).get(incidentId) != null;
  const incidentHasProperty = db.prepare(
    'SELECT 1 FROM evidence WHERE incident_id = ? LIMIT 1'
  ).get(incidentId) != null;

  for (const off of offenses) {
    const code = off.nibrs_code || off.offense_code;
    if (isMissing(off.nibrs_code)) {
      issues.push({
        offense_id: off.id, offense_code: code,
        missing_field: 'nibrs_code',
        severity: 'error',
        message: `Offense "${off.description || off.offense_code}" has no NIBRS code`,
      });
      // skip the rest of per-offense checks — without code we can't lookup metadata
      continue;
    }
    if (off.ucr_group == null) {
      issues.push({
        offense_id: off.id, offense_code: code,
        missing_field: 'nibrs_code',
        severity: 'error',
        message: `NIBRS code "${code}" is not recognized in the FBI 2019 code set`,
      });
      continue;
    }

    // Group B (arrest-only) skips most segment requirements
    if (off.ucr_group === 'B') continue;

    if (off.attempted_completed_required && isMissing(off.attempted_completed)) {
      issues.push({ offense_id: off.id, offense_code: code, missing_field: 'attempted_completed', severity: 'error', message: `${code}: attempted/completed indicator required` });
    }

    if (off.victim_required) {
      const hasVictim = !isMissing(off.victim_person_id) || incidentHasVictim;
      if (!hasVictim) {
        issues.push({ offense_id: off.id, offense_code: code, missing_field: 'victim', severity: 'error', message: `${code}: at least one victim required` });
      }
    }

    if (off.weapon_required && isMissing(off.weapon_force)) {
      issues.push({ offense_id: off.id, offense_code: code, missing_field: 'weapon_force', severity: 'error', message: `${code}: weapon/force code required` });
    }

    if (off.bias_required && isMissing(off.bias_motivation)) {
      // Bias is FBI-required but typically allowed to be "88 None" — emit as warning, not error
      issues.push({ offense_id: off.id, offense_code: code, missing_field: 'bias_motivation', severity: 'warning', message: `${code}: bias motivation should be set (use code 88 if none)` });
    }

    if (off.property_required && !incidentHasProperty) {
      issues.push({ offense_id: off.id, offense_code: code, missing_field: 'property', severity: 'warning', message: `${code}: at least one property/evidence record expected` });
    }

    if (isMissing(off.location_type)) {
      issues.push({ offense_id: off.id, offense_code: code, missing_field: 'location_type', severity: 'warning', message: `${code}: NIBRS location_type code recommended` });
    }
  }

  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');

  return {
    incident_id: incidentId,
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

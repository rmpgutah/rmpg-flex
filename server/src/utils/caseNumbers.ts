// ============================================================
// RMPG Flex — Server-Side Case Number Generation
// ============================================================

import Database from 'better-sqlite3';

// ── Type Code Mapping (mirrors client/src/utils/caseNumbers.ts) ──

const INCIDENT_TYPE_CODES: Record<string, string> = {
  // Security
  alarm_response: 'ALR', access_control: 'ACC', patrol_check: 'PTL', lock_unlock: 'LCK',
  property_damage: 'PDM', lost_found: 'LFP',
  // Criminal
  theft: 'THF', burglary: 'BRG', robbery: 'ROB', assault: 'ASL', battery: 'BAT',
  vandalism: 'VAN', criminal_mischief: 'CRM', drug_activity: 'DRG',
  weapons_offense: 'WPN', fraud_forgery: 'FRD',
  kidnapping: 'KID', arson: 'ARS', sexual_assault: 'SXA', stalking: 'STK',
  identity_theft: 'IDT', extortion: 'EXT', criminal_trespass: 'CTR',
  disorderly_conduct: 'DIS', public_intoxication: 'PIX', indecent_exposure: 'INX',
  shoplifting: 'SHP', auto_theft: 'ATH', receiving_stolen: 'RST',
  poss_stolen_vehicle: 'PSV', criminal_threat: 'CTH', illegal_dumping: 'ILD',
  prostitution: 'PRS',
  // Disorder
  trespass: 'TRS', disturbance: 'DST', noise_complaint: 'NOI', loitering: 'LOI',
  panhandling: 'PNH', domestic_dispute: 'DOM',
  prowler: 'PRW', harassment: 'HRS', curfew_violation: 'CRF', illegal_camping: 'ILC',
  // Traffic
  traffic_accident: 'TAC', hit_and_run: 'HNR', dui_dwi: 'DUI', parking_violation: 'PKV',
  traffic_hazard: 'THZ', abandoned_vehicle: 'ABV',
  reckless_driving: 'RKD', suspended_license: 'SLI', no_insurance: 'NIN',
  expired_registration: 'EXR', speed_violation: 'SPD', traffic_stop: 'TST',
  // Medical/Fire
  medical_emergency: 'MED', overdose: 'OVD', mental_health_crisis: 'MHC',
  fire: 'FIR', fire_alarm: 'FAR', hazmat: 'HAZ',
  // Service
  escort: 'ESC', welfare_check: 'WCK', citizen_assist: 'CTA', civil_standby: 'CSB',
  animal_complaint: 'ANM', utility_problem: 'UTI', pso_client_request: 'PSO',
  death_investigation: 'DTH', juvenile_runaway: 'JRN', missing_person: 'MSP',
  found_person: 'FDP', repo_notice: 'REP', civil_dispute: 'CVD',
  // Admin
  daily_activity: 'DAR', special_event: 'SPE', training_exercise: 'TRN', equipment_issue: 'EQP',
  // Legacy
  suspicious_activity: 'SUS', other: 'OTH',
};

export function getTypeCode(type: string): string {
  return INCIDENT_TYPE_CODES[type] || 'OTH';
}

// ── 2-Letter Case Type Codes (for Case Number format: YY-######-XX) ──

const CASE_TYPE_CODES: Record<string, string> = {
  general: 'GN', criminal: 'CR', traffic: 'TR', medical: 'MD',
  security: 'SE', disorder: 'DS', service: 'SV', fire: 'FR',
  admin: 'AD', civil: 'CV', use_of_force: 'UF', property: 'PR',
  missing_person: 'MP', narcotics: 'NR', fraud: 'FD', juvenile: 'JV',
  domestic: 'DM', accident: 'AC', death: 'DT', theft: 'TH',
  assault: 'AS', burglary: 'BG', other: 'OT',
};

export function getCaseTypeCode(caseType: string): string {
  return CASE_TYPE_CODES[caseType] || 'GN';
}

// ── Case Number Generation ──────────────────────────────────
// Format: YY-######-XX  (2-digit year + 6-digit sequence + 2-letter type code)

export function generateCaseNumber(db: Database.Database, caseType: string = 'general'): string {
  const yy = String(new Date().getFullYear()).slice(-2);
  const typeCode = getCaseTypeCode(caseType);
  // Sequence is global per year (not per type)
  const prefix = `${yy}-`;
  const lastCase = db.prepare(
    `SELECT case_number FROM cases WHERE case_number LIKE ? ORDER BY id DESC LIMIT 1`,
  ).get(`${prefix}%`) as { case_number: string } | undefined;

  let nextNum = 1;
  if (lastCase) {
    const match = lastCase.case_number.match(/\d{2}-(\d{6})-[A-Z]{2}/);
    if (match) {
      nextNum = parseInt(match[1], 10) + 1;
    }
  }

  return `${prefix}${String(nextNum).padStart(6, '0')}-${typeCode}`;
}

// ── Incident Number Generation ──────────────────────────────
// Format: RKY26-#####-CODE  (RKY + 2-digit year)
// Sequence is global per year (not per type)

export function generateIncidentNumber(db: Database.Database, incidentType: string): string {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const code = getTypeCode(incidentType);
  const prefix = `RKY${yy}-`;

  const lastInc = db.prepare(
    `SELECT incident_number FROM incidents WHERE incident_number LIKE ? ORDER BY id DESC LIMIT 1`,
  ).get(`${prefix}%`) as { incident_number: string } | undefined;

  let nextNum = 1;
  if (lastInc) {
    const match = lastInc.incident_number.match(/RKY\d{2}-(\d{5})-/);
    if (match) {
      nextNum = parseInt(match[1], 10) + 1;
    }
  }

  return `${prefix}${String(nextNum).padStart(5, '0')}-${code}`;
}

// ── Call Number Generation ──────────────────────────────────
// Format: 26-CFS#####  (2-digit year + CFS prefix)

export function generateCallNumber(db: Database.Database): string {
  const yy = String(new Date().getFullYear()).slice(-2);
  const prefix = `${yy}-CFS`;
  const lastCall = db.prepare(
    `SELECT call_number FROM calls_for_service WHERE call_number LIKE ? ORDER BY id DESC LIMIT 1`,
  ).get(`${prefix}%`) as { call_number: string } | undefined;

  let nextNum = 1;
  if (lastCall) {
    const match = lastCall.call_number.match(/\d{2}-CFS(\d{5})/);
    if (match) {
      nextNum = parseInt(match[1], 10) + 1;
    }
  }

  return `${prefix}${String(nextNum).padStart(5, '0')}`;
}

// ── Migration Helper ────────────────────────────────────────
// Converts existing INC-YYYY-NNNNN and RMP-YY-NNNNN-CODE records to RKY format

export function migrateIncidentNumbers(db: Database.Database): void {
  try {
    // Migrate old INC- format
    const oldInc = db.prepare(
      "SELECT id, incident_number, incident_type FROM incidents WHERE incident_number LIKE 'INC-%'",
    ).all() as { id: number; incident_number: string; incident_type: string }[];

    for (const inc of oldInc) {
      const code = getTypeCode(inc.incident_type);
      const match = inc.incident_number.match(/INC-(\d{4})-(\d{5})/);
      if (match) {
        const yy = match[1].slice(-2);
        const seq = match[2];
        const newNumber = `RKY${yy}-${seq}-${code}`;
        db.prepare('UPDATE incidents SET incident_number = ? WHERE id = ?').run(newNumber, inc.id);
      }
    }

    // Migrate old RMP- format to RKY format
    const rmpInc = db.prepare(
      "SELECT id, incident_number, incident_type FROM incidents WHERE incident_number LIKE 'RMP-%'",
    ).all() as { id: number; incident_number: string; incident_type: string }[];

    for (const inc of rmpInc) {
      const code = getTypeCode(inc.incident_type);
      const match = inc.incident_number.match(/RMP-(\d{2})-(\d{5})-/);
      if (match) {
        const newNumber = `RKY${match[1]}-${match[2]}-${code}`;
        db.prepare('UPDATE incidents SET incident_number = ? WHERE id = ?').run(newNumber, inc.id);
      }
    }

    // Migrate old CFS-YYYY- call numbers to YY-CFS##### format
    const oldCalls = db.prepare(
      "SELECT id, call_number FROM calls_for_service WHERE call_number LIKE 'CFS-____-%'",
    ).all() as { id: number; call_number: string }[];

    for (const call of oldCalls) {
      const match = call.call_number.match(/CFS-(\d{4})-(\d{5})/);
      if (match) {
        const yy = match[1].slice(-2);
        const newNumber = `${yy}-CFS${match[2]}`;
        db.prepare('UPDATE calls_for_service SET call_number = ? WHERE id = ?').run(newNumber, call.id);
      }
    }

    // Migrate CFS26-##### format to 26-CFS##### format
    const cfsCalls = db.prepare(
      "SELECT id, call_number FROM calls_for_service WHERE call_number LIKE 'CFS__-%'",
    ).all() as { id: number; call_number: string }[];

    for (const call of cfsCalls) {
      const match = call.call_number.match(/CFS(\d{2})-(\d{5})/);
      if (match) {
        const newNumber = `${match[1]}-CFS${match[2]}`;
        db.prepare('UPDATE calls_for_service SET call_number = ? WHERE id = ?').run(newNumber, call.id);
      }
    }

    const total = oldInc.length + rmpInc.length + oldCalls.length + cfsCalls.length;
    if (total > 0) {
      console.log(`  Migrated ${total} numbers to RKY/CFS format`);
    }
  } catch {
    // Ignore if already migrated or table doesn't exist
  }
}

// ============================================================
// RMPG Flex — NCIC/NLETS Response Formatter
// Formats database records into NCIC-style terminal output
// matching real National Crime Information Center response format.
// Fixed-width, coded field headers, monospace presentation.
// ============================================================

const ORI = 'RMPGFLEX01';  // Originating Agency Identifier
const MKE = 'QH';           // Message Key (query hit)

/** Pad or truncate string to exact width */
function pad(val: string | null | undefined, width: number): string {
  const s = String(val || '').toUpperCase();
  return s.length >= width ? s.substring(0, width) : s + ' '.repeat(width - s.length);
}

/** Format a date string to NCIC format (YYYYMMDD) */
function ncicDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '        ';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '        ';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}${m}${day}`;
  } catch {
    return '        ';
  }
}

/** Current timestamp in NCIC format */
function ncicTimestamp(): string {
  const now = new Date();
  const date = ncicDate(now.toISOString());
  const time = now.toTimeString().substring(0, 8).replace(/:/g, '');
  return `${date} ${time}`;
}

/** Generate response header */
function header(queryType: string, mke: string = MKE): string {
  return [
    `*** NCIC RESPONSE ***`,
    `HDR/${ncicTimestamp()}`,
    `ORI/${ORI}  MKE/${mke}  QRY/${queryType}`,
    `─`.repeat(60),
  ].join('\n');
}

/** No-record-found response */
function noRecord(queryType: string, searchTerm: string): string {
  return [
    header(queryType, 'QN'),
    ``,
    `  NO RECORD FOUND`,
    `  SEARCH: ${searchTerm.toUpperCase()}`,
    ``,
    `─`.repeat(60),
    `*** END OF RECORD ***`,
  ].join('\n');
}

// ─── Person Query Response ──────────────────────────────────

export interface NcicPerson {
  id?: number;
  first_name?: string;
  last_name?: string;
  middle_name?: string;
  date_of_birth?: string;
  sex?: string;
  race?: string;
  height?: string;
  weight?: string | number;
  eye_color?: string;
  hair_color?: string;
  address?: string;
  phone?: string;
  ssn?: string;
  drivers_license?: string;
  dl_state?: string;
  caution_flags?: string;
  is_sex_offender?: boolean | number;
  gang_affiliation?: string;
  probation_parole?: string;
  scars_marks_tattoos?: string;
}

export interface NcicCriminalHistory {
  offense?: string;
  offense_level?: string;
  offense_date?: string;
  disposition?: string;
  agency?: string;
  case_number?: string;
  statute?: string;
  sentence?: string;
}

export interface NcicWarrant {
  warrant_number?: string;
  type?: string;
  charge_description?: string;
  offense_level?: string;
  bail_amount?: number | string;
  issue_date?: string;
  issuing_court?: string;
  status?: string;
}

export function formatPersonResponse(
  person: NcicPerson,
  criminalHistory: NcicCriminalHistory[] = [],
  warrants: NcicWarrant[] = [],
): string {
  const lines: string[] = [header('PERSON')];

  // ── Subject identification
  lines.push('');
  lines.push('  SUBJECT IDENTIFICATION');
  lines.push(`  NAM/${pad(person.last_name, 20)},${pad(person.first_name, 15)} ${pad(person.middle_name, 1)}`);
  lines.push(`  SEX/${pad(person.sex, 1)}  RAC/${pad(person.race, 1)}  DOB/${ncicDate(person.date_of_birth)}`);
  lines.push(`  HGT/${pad(person.height, 4)}  WGT/${pad(String(person.weight || ''), 3)}  EYE/${pad(person.eye_color, 3)}  HAI/${pad(person.hair_color, 3)}`);

  if (person.drivers_license) {
    lines.push(`  OLN/${pad(person.drivers_license, 15)}  OLS/${pad(person.dl_state, 2)}`);
  }
  if (person.address) {
    lines.push(`  ADR/${person.address.toUpperCase()}`);
  }
  if (person.scars_marks_tattoos) {
    lines.push(`  SMT/${person.scars_marks_tattoos.toUpperCase()}`);
  }

  // ── Caution flags
  if (person.caution_flags || person.is_sex_offender || person.gang_affiliation) {
    lines.push('');
    lines.push('  *** CAUTION ***');
    if (person.caution_flags) {
      person.caution_flags.split(',').forEach(flag => {
        lines.push(`  >> ${flag.trim().toUpperCase()}`);
      });
    }
    if (person.is_sex_offender) lines.push('  >> REGISTERED SEX OFFENDER');
    if (person.gang_affiliation) lines.push(`  >> GANG AFFILIATION: ${person.gang_affiliation.toUpperCase()}`);
    if (person.probation_parole) lines.push(`  >> ${person.probation_parole.toUpperCase()}`);
  }

  // ── Warrant hits
  if (warrants.length > 0) {
    lines.push('');
    lines.push(`  *** WARRANT HIT — ${warrants.length} ACTIVE ***`);
    for (const w of warrants) {
      lines.push(`  OCA/${pad(w.warrant_number, 15)}  DOW/${ncicDate(w.issue_date)}`);
      lines.push(`  CHG/${(w.charge_description || w.type || '').toUpperCase()}`);
      lines.push(`  OFL/${pad(w.offense_level, 3)}  BAL/${w.bail_amount ? `$${Number(w.bail_amount).toLocaleString()}` : 'N/A'}`);
      if (w.issuing_court) lines.push(`  CRT/${w.issuing_court.toUpperCase()}`);
      lines.push('');
    }
  }

  // ── Criminal history
  if (criminalHistory.length > 0) {
    lines.push('');
    lines.push(`  CRIMINAL HISTORY — ${criminalHistory.length} RECORD(S)`);
    lines.push(`  ${'─'.repeat(56)}`);
    for (const ch of criminalHistory) {
      lines.push(`  DOO/${ncicDate(ch.offense_date)}  OFL/${pad(ch.offense_level, 3)}  CHG/${(ch.offense || '').toUpperCase()}`);
      if (ch.statute) lines.push(`  STA/${ch.statute.toUpperCase()}`);
      if (ch.disposition) lines.push(`  DIS/${ch.disposition.toUpperCase()}`);
      if (ch.agency) lines.push(`  AGY/${ch.agency.toUpperCase()}`);
      if (ch.sentence) lines.push(`  SEN/${ch.sentence.toUpperCase()}`);
      lines.push('');
    }
  }

  lines.push(`─`.repeat(60));
  lines.push('*** END OF RECORD ***');

  return lines.join('\n');
}

// ─── Vehicle Query Response ─────────────────────────────────

export interface NcicVehicle {
  id?: number;
  plate_number?: string;
  plate_state?: string;
  vin?: string;
  year?: number | string;
  make?: string;
  model?: string;
  color?: string;
  style?: string;
  registration_status?: string;
  owner_first_name?: string;
  owner_last_name?: string;
  insurance_company?: string;
  insurance_policy?: string;
  notes?: string;
  is_stolen?: boolean | number;
}

export function formatVehicleResponse(vehicle: NcicVehicle): string {
  const lines: string[] = [header('VEHICLE')];

  lines.push('');
  lines.push('  VEHICLE IDENTIFICATION');
  lines.push(`  LIC/${pad(vehicle.plate_number, 10)}  LIS/${pad(vehicle.plate_state, 2)}`);
  if (vehicle.vin) lines.push(`  VIN/${vehicle.vin.toUpperCase()}`);
  lines.push(`  VYR/${pad(String(vehicle.year || ''), 4)}  VMA/${pad(vehicle.make, 10)}  VMO/${pad(vehicle.model, 15)}`);
  lines.push(`  VCO/${pad(vehicle.color, 10)}  VST/${pad(vehicle.style, 4)}`);

  if (vehicle.is_stolen) {
    lines.push('');
    lines.push('  *** STOLEN VEHICLE ***');
    lines.push('  >> VEHICLE REPORTED STOLEN — EXERCISE CAUTION');
  }

  if (vehicle.owner_last_name || vehicle.owner_first_name) {
    lines.push('');
    lines.push('  REGISTERED OWNER');
    lines.push(`  NAM/${pad(vehicle.owner_last_name, 20)},${pad(vehicle.owner_first_name, 15)}`);
  }

  if (vehicle.registration_status) {
    lines.push(`  REG/${vehicle.registration_status.toUpperCase()}`);
  }

  if (vehicle.insurance_company) {
    lines.push(`  INS/${vehicle.insurance_company.toUpperCase()}  POL/${vehicle.insurance_policy || 'N/A'}`);
  }

  lines.push('');
  lines.push(`─`.repeat(60));
  lines.push('*** END OF RECORD ***');

  return lines.join('\n');
}

// ─── Warrant Query Response ─────────────────────────────────

export function formatWarrantResponse(
  warrants: (NcicWarrant & { subject_first_name?: string; subject_last_name?: string; subject_dob?: string })[],
  searchTerm: string,
): string {
  if (warrants.length === 0) return noRecord('WARRANT', searchTerm);

  const lines: string[] = [header('WARRANT')];

  lines.push('');
  lines.push(`  WARRANT QUERY — ${warrants.length} RESULT(S)`);
  lines.push(`  ${'─'.repeat(56)}`);

  for (const w of warrants) {
    lines.push(`  OCA/${pad(w.warrant_number, 15)}  STS/${pad(w.status, 8)}`);
    if (w.subject_last_name) {
      lines.push(`  NAM/${pad(w.subject_last_name, 20)},${pad(w.subject_first_name, 15)}`);
    }
    if (w.subject_dob) lines.push(`  DOB/${ncicDate(w.subject_dob)}`);
    lines.push(`  CHG/${(w.charge_description || w.type || '').toUpperCase()}`);
    lines.push(`  OFL/${pad(w.offense_level, 3)}  BAL/${w.bail_amount ? `$${Number(w.bail_amount).toLocaleString()}` : 'N/A'}`);
    if (w.issue_date) lines.push(`  DOW/${ncicDate(w.issue_date)}`);
    if (w.issuing_court) lines.push(`  CRT/${w.issuing_court.toUpperCase()}`);
    lines.push('');
  }

  lines.push(`─`.repeat(60));
  lines.push('*** END OF RECORD ***');

  return lines.join('\n');
}

/** Format a "no record" response for any query type */
export function formatNoRecord(queryType: string, searchTerm: string): string {
  return noRecord(queryType, searchTerm);
}

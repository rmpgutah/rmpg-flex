// ============================================================
// RMPG Flex — NCIC/NLETS Response Formatter
// Formats database records into NCIC-style terminal output
// matching real National Crime Information Center response format.
// Fixed-width, coded field headers, monospace presentation.
// ============================================================

const ORI = 'RMPGFLEX01';  // Originating Agency Identifier
const MKE = 'QH';           // Message Key (query hit)

// ─── Color Classification ─────────────────────────────────
// Maps each output line to a CSS class for semantic coloring.
// Returns '' for normal data lines (use default amber + inline
// field-label highlighting in the component).

export function getNcicLineClass(line: string): string {
  const t = line.trim();
  if (!t) return '';

  // System header / footer markers — teal bookends
  if (t.startsWith('*** NCIC RESPONSE') || t.startsWith('*** END OF')) return 'ncic-c-header';
  if (t.startsWith('HDR/') || t.startsWith('ORI/')) return 'ncic-c-header';
  if (t.startsWith('*** UTAH COURTS') || t.startsWith('*** DL MANUAL')) return 'ncic-c-header';
  if (t.startsWith('*** END OF BACKGROUND') || t.startsWith('*** END OF ARREST') || t.startsWith('*** END OF SKIP TRACER')) return 'ncic-c-header';

  // Cached result indicator — amber
  if (t.startsWith('CACHED RESULT FROM')) return 'ncic-c-caution';

  // Pure divider lines (all ─ or ═ characters) — dim
  if (/^[─═]+$/.test(t)) return 'ncic-c-dim';

  // Danger / warning lines — bright red, must check before section headers
  if (
    t.startsWith('*** CAUTION') || t.startsWith('*** WARRANT') ||
    t.startsWith('*** STOLEN') || t.startsWith('*** HAZARD') ||
    t.startsWith('*** PREMISE WARNINGS') ||
    t.startsWith('*** OFAC WATCHLIST') || t.startsWith('*** OFAC CONSOLIDATED') ||
    t.startsWith('*** SEX OFFENDER') ||
    /\*\*\* \d+ ACTIVE WARRANT/.test(t) ||
    /\*\*\* \d+ LINKED WARRANT/.test(t) ||
    t.startsWith('*** ARREST RECORDS') ||
    t.includes('WARNINGS PRESENT') || t.includes('EXERCISE CAUTION')
  ) return 'ncic-c-danger';

  // Section headers using ═══ — white, unless they contain danger keywords
  if (t.includes('═══')) {
    if (t.includes('OFAC') || t.includes('TRESPASS') || t.includes('WARRANT') || t.includes('SEX OFFENDER') || (t.includes('ARREST') && t.includes('***'))) return 'ncic-c-danger';
    return 'ncic-c-section';
  }

  // Caution detail lines (>> prefix) — orange
  if (t.startsWith('>>')) return 'ncic-c-caution';

  // "All clear" indicators — muted green
  if (t === 'NO RECORD FOUND' || t === 'NO PERSONS FOUND' || t === 'NO PRIOR CALLS') return 'ncic-c-clear';

  // Error lines — red
  if (t.startsWith('ERR/') || t.startsWith('ERROR:') || t.includes('QUERY FAILED')) return 'ncic-c-error';

  // Summary / overview lines — gold
  if (t.startsWith('SUMMARY:') || t.startsWith('*** COMPLETE SUBJECT CHECK')) return 'ncic-c-summary';

  // Section titles (plain text headers without ═══) — white
  if (
    t === 'SUBJECT IDENTIFICATION' || t === 'REGISTERED OWNER' ||
    t === 'ADDRESS' || t === 'ADDRESSES:' ||
    t.startsWith('CRIMINAL HISTORY') ||
    t === "DRIVER'S LICENSE INFORMATION" ||
    t.startsWith('DL QUERY') || t.startsWith('WARRANT QUERY') ||
    t.startsWith('ADDRESS LOOKUP:') ||
    t.startsWith('ALIASES:') || t.startsWith('VEHICLE IDENTIFICATION')
  ) return 'ncic-c-section';

  // Prior offense count line — white (section-level info)
  if (t.startsWith('CHR/')) return 'ncic-c-section';

  // Search term echo in no-record responses
  if (t.startsWith('SEARCH:')) return 'ncic-c-dim';

  // Browser/note lines in QC output
  if (t.startsWith('OPENING BROWSER:') || t.startsWith('SEARCH TERM:') || t.startsWith('NOTE:')) return 'ncic-c-dim';

  // Default — normal data line (amber base, field labels highlighted inline)
  return '';
}

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
  if (person.phone) {
    lines.push(`  TEL/${person.phone.toUpperCase()}`);
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
  utahWarrants?: Array<{ first_name?: string; last_name?: string; middle_name?: string; age?: number; city?: string; court_name?: string; case_id?: string; issue_date?: string; charges?: string; source?: string }>,
): string {
  const totalCount = warrants.length + (utahWarrants?.length || 0);
  if (totalCount === 0) return noRecord('WARRANT', searchTerm);

  const lines: string[] = [header('WARRANT')];

  // Local warrants
  if (warrants.length > 0) {
    lines.push('');
    lines.push(`  LOCAL WARRANT QUERY — ${warrants.length} RESULT(S)`);
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
  }

  // Utah state warrants
  if (utahWarrants && utahWarrants.length > 0) {
    lines.push('');
    lines.push(`  *** UTAH STATE WARRANTS — ${utahWarrants.length} HIT(S) ***`);
    lines.push(`  SRC/UTAH STATE — WARRANTS.UTAH.GOV`);
    lines.push(`  ${'─'.repeat(56)}`);

    for (const uw of utahWarrants) {
      const fullName = `${uw.last_name || ''}`.toUpperCase();
      const firstName = `${uw.first_name || ''}`.toUpperCase();
      lines.push(`  NAM/${pad(fullName, 20)},${pad(firstName, 15)}`);
      if (uw.age) lines.push(`  AGE/${uw.age}`);
      if (uw.city) lines.push(`  CTY/${uw.city.toUpperCase()}`);
      // Parse charges from JSON
      let chargeStr = '';
      try {
        const charges = JSON.parse(uw.charges || '[]');
        chargeStr = charges.join('; ');
      } catch { chargeStr = uw.charges || ''; }
      if (chargeStr) lines.push(`  CHG/${chargeStr.toUpperCase()}`);
      if (uw.court_name) lines.push(`  CRT/${uw.court_name.toUpperCase()}`);
      if (uw.case_id) lines.push(`  CSE/${uw.case_id}`);
      if (uw.issue_date) lines.push(`  DOW/${uw.issue_date}`);
      lines.push(`  SRC/UTAH STATE`);
      lines.push('');
    }
  }

  lines.push(`─`.repeat(60));
  lines.push('*** END OF RECORD ***');

  return lines.join('\n');
}

/** Format a "no record" response for any query type */
export function formatNoRecord(queryType: string, searchTerm: string): string {
  return noRecord(queryType, searchTerm);
}

// ─── Driver's License Query Response ────────────────────────

export interface NcicDlSubject {
  first_name?: string;
  middle_name?: string;
  last_name?: string;
  full_name?: string;
  suffix?: string;
  date_of_birth?: string;
  gender?: string;
  height?: string;
  weight?: string;
  eye_color?: string;
  hair_color?: string;
  race?: string;
  dl_number?: string;
  dl_state?: string;
  dl_class?: string;
  dl_status?: string;
  dl_expiration?: string;
  dl_issue_date?: string;
  dl_restrictions?: string;
  dl_endorsements?: string;
  addresses?: { address?: string; address2?: string; city?: string; state?: string; postal_code?: string; country?: string }[];
  source?: string;
  match_source?: string;
}

export function formatDlResponse(subjects: NcicDlSubject[], searchTerm: string): string {
  if (subjects.length === 0) return noRecord('DL SEARCH', searchTerm);

  const lines: string[] = [header('DL SEARCH', 'QD')];

  lines.push('');
  lines.push(`  DL QUERY — ${subjects.length} RESULT(S)`);
  lines.push(`  ${'─'.repeat(56)}`);

  for (const s of subjects) {
    lines.push('');
    lines.push('  DRIVER\'S LICENSE INFORMATION');
    lines.push(`  OLN/${pad(s.dl_number, 15)}  OLS/${pad(s.dl_state, 2)}  STS/${pad(s.dl_status, 8)}`);
    lines.push(`  CLS/${pad(s.dl_class, 4)}  EXP/${ncicDate(s.dl_expiration)}  ISS/${ncicDate(s.dl_issue_date)}`);
    if (s.dl_restrictions || s.dl_endorsements) {
      lines.push(`  RST/${pad(s.dl_restrictions || 'NONE', 15)}  END/${pad(s.dl_endorsements || 'NONE', 15)}`);
    }

    lines.push('');
    lines.push('  SUBJECT IDENTIFICATION');
    lines.push(`  NAM/${pad(s.last_name, 20)},${pad(s.first_name, 15)} ${pad(s.middle_name, 1)}`);
    lines.push(`  SEX/${pad(s.gender, 1)}  RAC/${pad(s.race, 1)}  DOB/${ncicDate(s.date_of_birth)}`);
    lines.push(`  HGT/${pad(s.height, 4)}  WGT/${pad(s.weight, 3)}  EYE/${pad(s.eye_color, 3)}  HAI/${pad(s.hair_color, 3)}`);

    if (s.addresses && s.addresses.length > 0) {
      lines.push('');
      lines.push('  ADDRESS');
      for (const addr of s.addresses) {
        lines.push(`  ADR/${(addr.address || '').toUpperCase()}`);
        if (addr.address2) lines.push(`      ${addr.address2.toUpperCase()}`);
        lines.push(`      ${(addr.city || '').toUpperCase()}, ${(addr.state || '').toUpperCase()} ${addr.postal_code || ''}`);
      }
    }

    if (s.source || s.match_source) {
      lines.push(`  SRC/${(s.source || s.match_source || '').toUpperCase()}`);
    }

    lines.push('');
    lines.push(`  ${'─'.repeat(56)}`);
  }

  lines.push('*** END OF RECORD ***');
  return lines.join('\n');
}

// ─── OFAC Watchlist Query Response ──────────────────────────

export interface NcicOfacSubject {
  name?: string;
  type?: string;
  program?: string;
  source_list?: string;
  title?: string;
  remarks?: string;
  match_score?: number;
  match_source?: string;
  source?: string;
  date_of_birth?: string[];
  nationalities?: string[];
  aliases?: { name?: string; type?: string }[];
  addresses?: { address?: string; city?: string; state?: string; country?: string; postal_code?: string }[];
  passports?: { number?: string; country?: string }[];
  other_ids?: { type?: string; number?: string; country?: string }[];
}

// ─── Address Lookup Response ───────────────────────────────

export interface AddressLookupResults {
  persons: (NcicPerson & { active_warrants?: number })[];
  calls: { call_number?: string; incident_type?: string; priority?: string; disposition?: string; created_at?: string; weapons_involved?: boolean | number; domestic_violence?: boolean | number }[];
  properties: { name?: string; address?: string; gate_code?: string; alarm_code?: string; post_orders?: string; hazard_notes?: string }[];
  trespassOrders: { order_number?: string; status?: string; subject_name?: string; expiration_date?: string }[];
}

export function formatAddressResponse(results: AddressLookupResults, searchTerm: string): string {
  const lines: string[] = [header('ADDRESS', 'QA')];

  lines.push('');
  lines.push(`  ADDRESS LOOKUP: ${searchTerm.toUpperCase()}`);
  lines.push(`  ${'─'.repeat(56)}`);

  let hasWarnings = false;

  // ── Property info (gate codes, post orders, hazards)
  if (results.properties.length > 0) {
    lines.push('');
    lines.push(`  ═══ PROPERTY INFO — ${results.properties.length} ═══`);
    for (const p of results.properties) {
      lines.push(`  PRP/${(p.name || '').toUpperCase()}`);
      if (p.gate_code) lines.push(`  GATE/${p.gate_code}`);
      if (p.alarm_code) lines.push(`  ALM/${p.alarm_code}`);
      if (p.post_orders) lines.push(`  POST/${p.post_orders.substring(0, 120).toUpperCase()}`);
      if (p.hazard_notes) {
        hasWarnings = true;
        lines.push(`  *** HAZARD: ${p.hazard_notes.toUpperCase()} ***`);
      }
      lines.push('');
    }
  }

  // ── Active trespass orders at this address
  if (results.trespassOrders.length > 0) {
    hasWarnings = true;
    lines.push(`  ═══ *** ACTIVE TRESPASS ORDERS — ${results.trespassOrders.length} *** ═══`);
    for (const t of results.trespassOrders) {
      lines.push(`  TPO/${pad(t.order_number, 15)}  SUBJ/${(t.subject_name || '').toUpperCase()}`);
      lines.push(`  EXP/${ncicDate(t.expiration_date)}`);
    }
    lines.push('');
  }

  // ── Persons at this address
  if (results.persons.length > 0) {
    lines.push(`  ═══ PERSONS AT ADDRESS — ${results.persons.length} ═══`);
    for (const p of results.persons) {
      lines.push(`  NAM/${pad(p.last_name, 20)},${pad(p.first_name, 15)}`);
      lines.push(`  DOB/${ncicDate(p.date_of_birth)}  SEX/${pad(p.sex, 1)}  RAC/${pad(p.race, 1)}`);
      if (p.phone) lines.push(`  TEL/${p.phone.toUpperCase()}`);
      if (p.active_warrants && p.active_warrants > 0) {
        hasWarnings = true;
        lines.push(`  *** ${p.active_warrants} ACTIVE WARRANT(S) ***`);
      }
      if (p.caution_flags) {
        hasWarnings = true;
        lines.push(`  *** CAUTION: ${p.caution_flags.toUpperCase()} ***`);
      }
      lines.push('');
    }
  } else {
    lines.push('  ═══ PERSONS AT ADDRESS ═══');
    lines.push('  NO PERSONS FOUND');
    lines.push('');
  }

  // ── Call history at this address
  if (results.calls.length > 0) {
    lines.push(`  ═══ CALL HISTORY — ${results.calls.length} PRIOR CALL(S) ═══`);
    for (const c of results.calls.slice(0, 5)) {
      const flags: string[] = [];
      if (c.weapons_involved) flags.push('ARMED');
      if (c.domestic_violence) flags.push('DV');
      const flagStr = flags.length > 0 ? `  [${flags.join(',')}]` : '';
      lines.push(`  ${ncicDate(c.created_at)} ${pad(c.call_number, 12)} ${pad(c.incident_type, 20)} ${pad(c.disposition, 10)}${flagStr}`);
    }
    if (results.calls.length > 5) lines.push(`  ... +${results.calls.length - 5} MORE`);

    // Summary warnings from call history
    const armedCalls = results.calls.filter(c => c.weapons_involved).length;
    const dvCalls = results.calls.filter(c => c.domestic_violence).length;
    if (armedCalls > 0 || dvCalls > 0) {
      hasWarnings = true;
      lines.push('');
      lines.push('  *** PREMISE WARNINGS ***');
      if (armedCalls > 0) lines.push(`  >> ${armedCalls} PRIOR ARMED CALL(S)`);
      if (dvCalls > 0) lines.push(`  >> ${dvCalls} PRIOR DV CALL(S)`);
    }
    lines.push('');
  } else {
    lines.push('  ═══ CALL HISTORY ═══');
    lines.push('  NO PRIOR CALLS');
    lines.push('');
  }

  if (hasWarnings) {
    lines.push('  *** WARNINGS PRESENT — EXERCISE CAUTION ***');
  }
  lines.push(`─`.repeat(60));
  lines.push('*** END OF ADDRESS LOOKUP ***');

  return lines.join('\n');
}

// ─── Cross-Reference Query Response ────────────────────────

// ── Arrest Record Types ─────────────────────────────────────

export interface NcicArrestRecord {
  id?: number;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  middle_name?: string;
  date_of_birth?: string;
  booking_date?: string;
  release_date?: string;
  charges?: string[];
  county?: string;
  source_name?: string;
  mugshot_url?: string;
  status?: string;
  // ── Manual booking fields ──
  booking_number?: string;
  agency?: string;
  gender?: string;
  race?: string;
  height?: string;
  weight?: string;
  hair_color?: string;
  eye_color?: string;
  address?: string;
  bail_amount?: number;
  hold_reason?: string;
  notes?: string;
  entry_source?: string;   // 'manual' | 'csv' | 'api'
  cross_links?: {
    warrants?: { warrant_number: string; charge_description: string; status: string; bail_amount?: number }[];
    court_events?: { event_number: string; event_type: string; court_name: string; event_date: string }[];
    persons?: { id: number; first_name: string; last_name: string }[];
  };
}

export interface CrossReferenceResults {
  persons: { person: NcicPerson; criminalHistory: NcicCriminalHistory[]; warrants: NcicWarrant[] }[];
  directWarrants: (NcicWarrant & { subject_first_name?: string; subject_last_name?: string; subject_dob?: string })[];
  dlSubjects: NcicDlSubject[];
  ofacSubjects: NcicOfacSubject[];
  arrestRecords: NcicArrestRecord[];
  skipTracerPeople: SkipTracerPerson[];
  errors: string[];
}

export function formatCrossReferenceResponse(results: CrossReferenceResults, searchTerm: string): string {
  const lines: string[] = [header('CROSS-REFERENCE', 'QX')];

  lines.push('');
  lines.push(`  *** COMPLETE SUBJECT CHECK: ${searchTerm.toUpperCase()} ***`);
  lines.push(`  ${'─'.repeat(56)}`);

  // Track what we found
  let totalHits = 0;
  let hasWarnings = false;

  // ── Section 1: Person records & criminal history
  if (results.persons.length > 0) {
    totalHits += results.persons.length;
    lines.push('');
    lines.push(`  ═══ PERSON RECORDS — ${results.persons.length} MATCH(ES) ═══`);
    for (const r of results.persons) {
      const p = r.person;
      lines.push(`  NAM/${pad(p.last_name, 20)},${pad(p.first_name, 15)} ${pad(p.middle_name, 1)}`);
      lines.push(`  SEX/${pad(p.sex, 1)}  RAC/${pad(p.race, 1)}  DOB/${ncicDate(p.date_of_birth)}`);
      lines.push(`  HGT/${pad(p.height, 4)}  WGT/${pad(String(p.weight || ''), 3)}  EYE/${pad(p.eye_color, 3)}  HAI/${pad(p.hair_color, 3)}`);
      if (p.drivers_license) lines.push(`  OLN/${pad(p.drivers_license, 15)}  OLS/${pad(p.dl_state, 2)}`);
      if (p.address) lines.push(`  ADR/${p.address.toUpperCase()}`);
      if (p.phone) lines.push(`  TEL/${p.phone.toUpperCase()}`);
      if (p.scars_marks_tattoos) lines.push(`  SMT/${p.scars_marks_tattoos.toUpperCase()}`);

      // Caution flags inline
      if (p.caution_flags || p.is_sex_offender || p.gang_affiliation) {
        hasWarnings = true;
        lines.push('  *** CAUTION ***');
        if (p.caution_flags) p.caution_flags.split(',').forEach(f => lines.push(`  >> ${f.trim().toUpperCase()}`));
        if (p.is_sex_offender) lines.push('  >> REGISTERED SEX OFFENDER');
        if (p.gang_affiliation) lines.push(`  >> GANG: ${p.gang_affiliation.toUpperCase()}`);
        if (p.probation_parole) lines.push(`  >> ${p.probation_parole.toUpperCase()}`);
      }

      // Criminal history count
      if (r.criminalHistory.length > 0) {
        lines.push(`  CHR/${r.criminalHistory.length} PRIOR OFFENSE(S)`);
        for (const ch of r.criminalHistory.slice(0, 3)) {
          lines.push(`    ${ncicDate(ch.offense_date)} ${pad(ch.offense_level, 3)} ${(ch.offense || '').toUpperCase()}`);
        }
        if (r.criminalHistory.length > 3) lines.push(`    ... +${r.criminalHistory.length - 3} MORE`);
      }

      // Inline warrants
      if (r.warrants.length > 0) {
        hasWarnings = true;
        lines.push(`  *** ${r.warrants.length} ACTIVE WARRANT(S) ***`);
        for (const w of r.warrants) {
          lines.push(`    OCA/${pad(w.warrant_number, 15)} CHG/${(w.charge_description || w.type || '').toUpperCase()}`);
          lines.push(`    OFL/${pad(w.offense_level, 3)}  BAL/${w.bail_amount ? `$${Number(w.bail_amount).toLocaleString()}` : 'N/A'}`);
        }
      }
      lines.push('');
    }
  } else {
    lines.push('');
    lines.push('  ═══ PERSON RECORDS ═══');
    lines.push('  NO RECORD FOUND');
    lines.push('');
  }

  // ── Section 2: Direct warrant hits (not already shown via person)
  if (results.directWarrants.length > 0) {
    hasWarnings = true;
    totalHits += results.directWarrants.length;
    lines.push(`  ═══ ADDITIONAL WARRANT HITS — ${results.directWarrants.length} ═══`);
    for (const w of results.directWarrants) {
      lines.push(`  OCA/${pad(w.warrant_number, 15)}  STS/${pad(w.status, 8)}`);
      if (w.subject_last_name) lines.push(`  NAM/${pad(w.subject_last_name, 20)},${pad(w.subject_first_name, 15)}`);
      lines.push(`  CHG/${(w.charge_description || w.type || '').toUpperCase()}`);
      lines.push(`  OFL/${pad(w.offense_level, 3)}  BAL/${w.bail_amount ? `$${Number(w.bail_amount).toLocaleString()}` : 'N/A'}`);
      lines.push('');
    }
  }

  // ── Section 3: Driver's License
  if (results.dlSubjects.length > 0) {
    totalHits += results.dlSubjects.length;
    lines.push(`  ═══ DRIVER'S LICENSE — ${results.dlSubjects.length} RECORD(S) ═══`);
    for (const s of results.dlSubjects) {
      lines.push(`  OLN/${pad(s.dl_number, 15)}  OLS/${pad(s.dl_state, 2)}  STS/${pad(s.dl_status, 8)}`);
      lines.push(`  CLS/${pad(s.dl_class, 4)}  EXP/${ncicDate(s.dl_expiration)}`);
      if (s.addresses && s.addresses.length > 0) {
        const a = s.addresses[0];
        lines.push(`  ADR/${(a.address || '').toUpperCase()}`);
        lines.push(`      ${(a.city || '').toUpperCase()}, ${(a.state || '').toUpperCase()} ${a.postal_code || ''}`);
      }
      if (s.source || s.match_source) lines.push(`  SRC/${(s.source || s.match_source || '').toUpperCase()}`);
      lines.push('');
    }
  } else {
    lines.push('  ═══ DRIVER\'S LICENSE ═══');
    lines.push('  NO RECORD FOUND — NO LOCAL DL RECORDS OR API DATA');
    lines.push('');
  }

  // ── Section 4: OFAC / Sanctions
  if (results.ofacSubjects.length > 0) {
    hasWarnings = true;
    totalHits += results.ofacSubjects.length;
    lines.push(`  ═══ *** OFAC SANCTIONS — ${results.ofacSubjects.length} HIT(S) *** ═══`);
    for (const s of results.ofacSubjects) {
      lines.push(`  NAM/${(s.name || '').toUpperCase()}`);
      lines.push(`  TYP/${pad(s.type, 10)}  PGM/${pad(s.program, 15)}`);
      if (s.source_list) lines.push(`  LST/${pad(s.source_list, 10)}`);
      if (s.match_score) lines.push(`  SCR/${s.match_score}`);
      lines.push('');
    }
  } else {
    lines.push('  ═══ OFAC SANCTIONS ═══');
    lines.push('  NO RECORD FOUND');
    lines.push('');
  }

  // ── Section 5: Arrest Records
  if (results.arrestRecords && results.arrestRecords.length > 0) {
    totalHits += results.arrestRecords.length;
    const hasActiveArrests = results.arrestRecords.some(r => r.status === 'active');
    if (hasActiveArrests) hasWarnings = true;
    lines.push(`  ═══ ${hasActiveArrests ? '*** ' : ''}ARREST RECORDS — ${results.arrestRecords.length} MATCH(ES)${hasActiveArrests ? ' ***' : ''} ═══`);
    for (const r of results.arrestRecords) {
      lines.push(`  NAM/${pad((r.last_name || '').toUpperCase(), 20)},${pad((r.first_name || '').toUpperCase(), 15)}`);
      const descLine: string[] = [];
      if (r.gender) descLine.push(`SEX/${r.gender.toUpperCase()}`);
      if (r.race) descLine.push(`RAC/${r.race.toUpperCase()}`);
      descLine.push(`DOB/${r.date_of_birth || 'N/A'}`);
      if (descLine.length > 1) lines.push(`  ${descLine.join('  ')}`);
      lines.push(`  BKG/${r.booking_date || 'N/A'}  CTY/${pad((r.county || '').toUpperCase(), 20)}  STS/${pad((r.status || 'UNKNOWN').toUpperCase(), 10)}`);
      if (r.agency) lines.push(`  AGY/${r.agency.toUpperCase()}`);
      if (r.bail_amount) lines.push(`  BAL/$${Number(r.bail_amount).toLocaleString()}`);
      if (r.charges && r.charges.length > 0) {
        lines.push(`  CHG/${r.charges[0].toUpperCase()}`);
        if (r.charges.length > 1) lines.push(`    ... +${r.charges.length - 1} MORE CHARGE(S)`);
      }
      if (r.cross_links?.warrants && r.cross_links.warrants.length > 0) {
        lines.push(`  *** ${r.cross_links.warrants.length} LINKED WARRANT(S) ***`);
      }
      if (r.entry_source && r.entry_source !== 'api') lines.push(`  ENT/${r.entry_source.toUpperCase()}`);
      lines.push('');
    }
  } else {
    lines.push('  ═══ ARREST RECORDS ═══');
    lines.push('  NO RECORD FOUND');
    lines.push('');
  }

  // ── Section 6: Skip Tracer (RapidAPI)
  if (results.skipTracerPeople && results.skipTracerPeople.length > 0) {
    totalHits += results.skipTracerPeople.length;
    lines.push(`  ═══ SKIP TRACER — ${results.skipTracerPeople.length} MATCH(ES) ═══`);
    lines.push(`  SRC/RAPIDAPI SKIP TRACING`);
    for (const p of results.skipTracerPeople.slice(0, 5)) {
      if (p.Name) lines.push(`  NAM/${p.Name.toUpperCase()}`);
      if (p['Person ID']) lines.push(`  PID/${p['Person ID']}`);
      if (p.Age) lines.push(`  AGE/${p.Age}`);
      if (p['Lives in']) lines.push(`  ADR/${p['Lives in'].toUpperCase()}`);
      if (p['Related to']) {
        const rels = p['Related to'].split(';').map(s => s.trim()).filter(Boolean);
        lines.push(`  REL/${rels.slice(0, 3).join(', ').toUpperCase()}`);
      }
      lines.push('');
    }
    if (results.skipTracerPeople.length > 5) {
      lines.push(`  ... +${results.skipTracerPeople.length - 5} MORE — USE QS FOR FULL RESULTS`);
      lines.push('');
    }
  } else {
    lines.push('  ═══ SKIP TRACER ═══');
    lines.push('  NO RECORD FOUND');
    lines.push('');
  }

  // ── Errors (sources that failed)
  if (results.errors.length > 0) {
    lines.push(`  ═══ QUERY ERRORS ═══`);
    for (const e of results.errors) {
      lines.push(`  ERR/${e.toUpperCase()}`);
    }
    lines.push('');
  }

  // ── Summary
  lines.push(`  ${'─'.repeat(56)}`);
  lines.push(`  SUMMARY: ${totalHits} TOTAL HIT(S) ACROSS ALL SOURCES`);
  if (hasWarnings) {
    lines.push('  *** WARNINGS PRESENT — REVIEW ALL SECTIONS ***');
  }
  lines.push(`─`.repeat(60));
  lines.push('*** END OF CROSS-REFERENCE ***');

  return lines.join('\n');
}

// ─── Background Check Query Response ────────────────────────

export interface BackgroundRecord {
  record_type: string;      // 'CRIMINAL' | 'COURT' | 'SEX_OFFENDER'
  source: string;           // 'STATE_CRIMINAL', 'FEDERAL_COURT', 'NATIONAL_REGISTRY', etc.
  subject_name: string;
  dob?: string;
  offense?: string;
  offense_date?: string;
  case_number?: string;
  court?: string;
  disposition?: string;
  sentence?: string;
  state?: string;
  status?: string;          // 'ACTIVE' | 'CLOSED' | 'REGISTERED'
  tier?: string;            // For sex offender: 'TIER_1', 'TIER_2', 'TIER_3'
  registry_address?: string;
}

export function formatBackgroundResponse(
  records: BackgroundRecord[],
  searchTerm: string,
  cached?: boolean,
  cachedAt?: string,
): string {
  if (records.length === 0) return noRecord('BACKGROUND', searchTerm);

  const lines: string[] = [header('BACKGROUND CHECK', 'QB')];

  // Group records by type
  const criminal = records.filter(r => r.record_type === 'CRIMINAL');
  const court = records.filter(r => r.record_type === 'COURT');
  const sexOffender = records.filter(r => r.record_type === 'SEX_OFFENDER');

  // ── Criminal Records
  if (criminal.length > 0) {
    lines.push('');
    lines.push(`  ═══ CRIMINAL RECORDS — ${criminal.length} ═══`);
    for (const r of criminal) {
      if (r.subject_name) lines.push(`  NAM/${r.subject_name.toUpperCase()}`);
      if (r.dob) lines.push(`  DOB/${ncicDate(r.dob)}`);
      lines.push(`  OFF/${(r.offense || 'UNKNOWN').toUpperCase()}`);
      if (r.offense_date) lines.push(`  DTM/${ncicDate(r.offense_date)}`);
      if (r.court) lines.push(`  CRT/${r.court.toUpperCase()}`);
      if (r.case_number) lines.push(`  CSE/${r.case_number.toUpperCase()}`);
      if (r.disposition) lines.push(`  DSP/${r.disposition.toUpperCase()}`);
      if (r.sentence) lines.push(`  SEN/${r.sentence.toUpperCase()}`);
      if (r.state) lines.push(`  STA/${r.state.toUpperCase()}`);
      if (r.status) lines.push(`  STS/${r.status.toUpperCase()}`);
      lines.push('');
    }
  }

  // ── Court / Public Records
  if (court.length > 0) {
    lines.push(`  ═══ COURT / PUBLIC RECORDS — ${court.length} ═══`);
    for (const r of court) {
      if (r.subject_name) lines.push(`  NAM/${r.subject_name.toUpperCase()}`);
      lines.push(`  TYP/${(r.offense || 'COURT RECORD').toUpperCase()}`);
      if (r.offense_date) lines.push(`  DTM/${ncicDate(r.offense_date)}`);
      if (r.court) lines.push(`  CRT/${r.court.toUpperCase()}`);
      if (r.case_number) lines.push(`  CSE/${r.case_number.toUpperCase()}`);
      if (r.disposition) lines.push(`  DSP/${r.disposition.toUpperCase()}`);
      if (r.state) lines.push(`  STA/${r.state.toUpperCase()}`);
      if (r.status) lines.push(`  STS/${r.status.toUpperCase()}`);
      lines.push('');
    }
  }

  // ── Sex Offender Registry
  if (sexOffender.length > 0) {
    lines.push(`  ═══ *** SEX OFFENDER REGISTRY — ${sexOffender.length} HIT(S) *** ═══`);
    for (const r of sexOffender) {
      if (r.subject_name) lines.push(`  NAM/${r.subject_name.toUpperCase()}`);
      if (r.dob) lines.push(`  DOB/${ncicDate(r.dob)}`);
      lines.push(`  OFF/${(r.offense || 'REGISTERED SEX OFFENDER').toUpperCase()}`);
      if (r.tier) lines.push(`  TIR/${r.tier.toUpperCase()}`);
      if (r.state) lines.push(`  STA/${r.state.toUpperCase()}`);
      lines.push(`  REG/${(r.status || 'REGISTERED').toUpperCase()}`);
      if (r.registry_address) lines.push(`  ADR/${r.registry_address.toUpperCase()}`);
      if (r.court) lines.push(`  JUR/${r.court.toUpperCase()}`);
      if (r.offense_date) lines.push(`  DTM/${ncicDate(r.offense_date)}`);
      lines.push('');
    }
  }

  // Summary
  lines.push(`  ${'─'.repeat(56)}`);
  lines.push(`  ** ${records.length} RECORD(S) FOUND — ${cached ? 'CACHED' : 'LIVE SEARCH'} **`);
  if (cached && cachedAt) {
    const cachedDate = new Date(cachedAt);
    const dateStr = `${String(cachedDate.getMonth() + 1).padStart(2, '0')}/${String(cachedDate.getDate()).padStart(2, '0')}/${cachedDate.getFullYear()}`;
    lines.push(`  CACHED RESULT FROM ${dateStr} — USE QB! TO FORCE FRESH`);
  }
  if (sexOffender.length > 0) {
    lines.push('  *** SEX OFFENDER MATCH — EXERCISE CAUTION ***');
  }

  lines.push(`${'─'.repeat(60)}`);
  lines.push('*** END OF BACKGROUND CHECK ***');

  return lines.join('\n');
}

// ── Arrest Record Formatter ─────────────────────────────────

export function formatArrestResponse(records: NcicArrestRecord[], searchTerm: string): string {
  if (!records || records.length === 0) return formatNoRecord('ARREST RECORDS', searchTerm);

  const lines: string[] = [header('ARREST RECORDS', 'QR')];
  lines.push('');
  lines.push(`  ARREST RECORD QUERY — ${records.length} RESULT(S)`);
  lines.push(`  ${'─'.repeat(56)}`);

  for (const r of records) {
    const lastName = (r.last_name || '').toUpperCase();
    const firstName = (r.first_name || '').toUpperCase();
    const src = (r.entry_source || 'api').toUpperCase();
    lines.push('');
    lines.push(`  NAM/${pad(lastName, 20)},${pad(firstName, 15)}`);
    // Descriptors: sex, race, DOB, physical
    const descParts: string[] = [];
    if (r.gender) descParts.push(`SEX/${pad(r.gender.toUpperCase(), 1)}`);
    if (r.race) descParts.push(`RAC/${pad(r.race.toUpperCase(), 1)}`);
    descParts.push(`DOB/${r.date_of_birth || 'N/A'}`);
    lines.push(`  ${descParts.join('  ')}`);
    // Physical descriptors (if any)
    const physParts: string[] = [];
    if (r.height) physParts.push(`HGT/${pad(r.height.toUpperCase(), 4)}`);
    if (r.weight) physParts.push(`WGT/${pad(r.weight, 3)}`);
    if (r.eye_color) physParts.push(`EYE/${pad(r.eye_color.toUpperCase(), 3)}`);
    if (r.hair_color) physParts.push(`HAI/${pad(r.hair_color.toUpperCase(), 3)}`);
    if (physParts.length > 0) lines.push(`  ${physParts.join('  ')}`);
    // Booking info
    lines.push(`  BKG/${r.booking_date || 'N/A'}  CTY/${pad((r.county || '').toUpperCase(), 20)}  STS/${pad((r.status || 'UNKNOWN').toUpperCase(), 10)}`);
    if (r.booking_number) lines.push(`  BKN/${r.booking_number.toUpperCase()}`);
    if (r.agency) lines.push(`  AGY/${r.agency.toUpperCase()}`);
    if (r.bail_amount) lines.push(`  BAL/$${Number(r.bail_amount).toLocaleString()}`);
    if (r.hold_reason) lines.push(`  HLD/${r.hold_reason.toUpperCase()}`);
    if (r.address) lines.push(`  ADR/${r.address.toUpperCase()}`);
    if (r.release_date) lines.push(`  REL/${r.release_date}`);
    // Source indicator
    if (r.source_name) {
      lines.push(`  SRC/${r.source_name.toUpperCase()}  ENT/${src}`);
    } else {
      lines.push(`  ENT/${src}`);
    }

    // Charges
    if (r.charges && r.charges.length > 0) {
      lines.push(`  CHG/${r.charges.length} CHARGE(S):`);
      for (const ch of r.charges) {
        lines.push(`    >> ${ch.toUpperCase()}`);
      }
    }

    // Notes (manual entries may have officer notes)
    if (r.notes) lines.push(`  NTE/${r.notes.toUpperCase()}`);

    // Cross-linked warrants
    if (r.cross_links?.warrants && r.cross_links.warrants.length > 0) {
      lines.push(`  *** ${r.cross_links.warrants.length} LINKED WARRANT(S) ***`);
      for (const w of r.cross_links.warrants) {
        lines.push(`    OCA/${pad(w.warrant_number || 'N/A', 15)} CHG/${(w.charge_description || 'N/A').toUpperCase()}`);
        lines.push(`    STS/${pad((w.status || '').toUpperCase(), 8)}  BAL/${w.bail_amount ? `$${Number(w.bail_amount).toLocaleString()}` : 'N/A'}`);
      }
    }

    // Cross-linked court events
    if (r.cross_links?.court_events && r.cross_links.court_events.length > 0) {
      lines.push(`  --- LINKED COURT RECORDS: ${r.cross_links.court_events.length} ---`);
      for (const ce of r.cross_links.court_events) {
        lines.push(`    EVT/${pad(ce.event_number || '', 15)} ${(ce.event_type || '').toUpperCase()}`);
        lines.push(`    CRT/${(ce.court_name || '').toUpperCase()}  DTE/${ce.event_date || 'N/A'}`);
      }
    }

    // Cross-linked known persons
    if (r.cross_links?.persons && r.cross_links.persons.length > 0) {
      lines.push(`  >>> KNOWN PERSON MATCH: ${r.cross_links.persons.map(p => `${p.last_name}, ${p.first_name} (ID#${p.id})`).join('; ')}`);
    }

    lines.push(`  ${'─'.repeat(56)}`);
  }

  lines.push('');
  lines.push('*** END OF ARREST RECORDS ***');
  return lines.join('\n');
}

// ─── Skip Tracer Query Response ─────────────────────────────

export interface SkipTracerPerson {
  Name?: string;
  'Person ID'?: string;
  Age?: string;
  'Lives in'?: string;
  'Used to live in'?: string;
  'Related to'?: string;
  Link?: string;
}

export function formatSkipTracerResponse(
  people: SkipTracerPerson[],
  searchTerm: string,
  totalRecords?: number,
  searchType?: string,
): string {
  if (!people || people.length === 0) return noRecord('SKIP TRACER', searchTerm);

  const lines: string[] = [header('SKIP TRACER', 'QS')];

  lines.push('');
  lines.push(`  SKIP TRACER — ${totalRecords || people.length} RESULT(S)`);
  lines.push(`  SRC/RAPIDAPI SKIP TRACING  TYP/${(searchType || 'NAME').toUpperCase()}`);
  lines.push(`  ${'─'.repeat(56)}`);

  for (const p of people) {
    lines.push('');
    if (p.Name) lines.push(`  NAM/${p.Name.toUpperCase()}`);
    if (p['Person ID']) lines.push(`  PID/${p['Person ID']}`);
    if (p.Age) lines.push(`  AGE/${p.Age}`);
    if (p['Lives in']) lines.push(`  ADR/${p['Lives in'].toUpperCase()}`);
    if (p['Used to live in']) {
      const priors = p['Used to live in'].split(';').map(s => s.trim()).filter(Boolean);
      for (const prior of priors.slice(0, 3)) {
        lines.push(`  PRA/${prior.toUpperCase()}`);
      }
      if (priors.length > 3) lines.push(`    ... +${priors.length - 3} MORE`);
    }
    if (p['Related to']) {
      const relatives = p['Related to'].split(';').map(s => s.trim()).filter(Boolean);
      lines.push(`  REL/${relatives.slice(0, 5).join(', ').toUpperCase()}`);
      if (relatives.length > 5) lines.push(`    ... +${relatives.length - 5} MORE`);
    }
    lines.push(`  ${'─'.repeat(56)}`);
  }

  lines.push('');
  lines.push('*** END OF SKIP TRACER ***');
  return lines.join('\n');
}

export function formatOfacResponse(subjects: NcicOfacSubject[], searchTerm: string): string {
  if (subjects.length === 0) return noRecord('OFAC WATCHLIST', searchTerm);

  const lines: string[] = [header('OFAC WATCHLIST', 'QO')];

  lines.push('');
  lines.push(`  *** OFAC CONSOLIDATED SANCTIONS — ${subjects.length} HIT(S) ***`);
  lines.push(`  ${'─'.repeat(56)}`);

  for (const s of subjects) {
    lines.push('');
    lines.push(`  NAM/${(s.name || '').toUpperCase()}`);
    lines.push(`  TYP/${pad(s.type, 10)}  PGM/${pad(s.program, 15)}`);
    if (s.source_list) lines.push(`  LST/${pad(s.source_list, 10)}`);
    if (s.title) lines.push(`  TTL/${s.title.toUpperCase()}`);
    if (s.match_score) lines.push(`  SCR/${s.match_score}  SRC/${(s.match_source || s.source || '').toUpperCase()}`);

    if (s.date_of_birth && s.date_of_birth.length > 0) {
      lines.push(`  DOB/${s.date_of_birth.map(d => d.toUpperCase()).join(', ')}`);
    }
    if (s.nationalities && s.nationalities.length > 0) {
      lines.push(`  NAT/${s.nationalities.join(', ').toUpperCase()}`);
    }

    if (s.aliases && s.aliases.length > 0) {
      lines.push(`  ALIASES: ${s.aliases.length}`);
      for (const a of s.aliases.slice(0, 10)) {
        lines.push(`    AKA/${(a.name || '').toUpperCase()}`);
      }
      if (s.aliases.length > 10) lines.push(`    ... +${s.aliases.length - 10} MORE`);
    }

    if (s.addresses && s.addresses.length > 0) {
      lines.push('  ADDRESSES:');
      for (const addr of s.addresses.slice(0, 5)) {
        const parts = [addr.address, addr.city, addr.state, addr.country].filter(Boolean);
        lines.push(`    ADR/${parts.join(', ').toUpperCase()}`);
      }
    }

    if (s.passports && s.passports.length > 0) {
      for (const p of s.passports) {
        lines.push(`  PPT/${(p.number || '').toUpperCase()}  CTR/${(p.country || '').toUpperCase()}`);
      }
    }

    if (s.other_ids && s.other_ids.length > 0) {
      for (const id of s.other_ids.slice(0, 5)) {
        lines.push(`  ID/${pad(id.type, 12)} NUM/${(id.number || '').toUpperCase()}`);
      }
    }

    if (s.remarks) {
      const rem = s.remarks.length > 200 ? s.remarks.substring(0, 200) + '...' : s.remarks;
      lines.push(`  RMK/${rem.toUpperCase()}`);
    }

    lines.push(`  ${'─'.repeat(56)}`);
  }

  lines.push('*** END OF RECORD ***');
  return lines.join('\n');
}

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

// ─── Utah MVR Registration Response ─────────────────────────

export interface UtahMvrRegistration {
  plate_number?: string;
  plate_state?: string;
  vin?: string;
  year?: number;
  make?: string;
  model?: string;
  color?: string;
  body_style?: string;
  registration_status?: string;
  registration_expiry?: string;
  owner_first_name?: string;
  owner_last_name?: string;
  owner_address?: string;
  owner_city?: string;
  owner_state?: string;
  owner_zip?: string;
  insurance_company?: string;
  insurance_policy?: string;
  insurance_expiry?: string;
  title_number?: string;
  title_date?: string;
  lien_holder?: string;
  odometer?: number;
  flags?: string[];
}

export function formatMvrRegistrationResponse(record: UtahMvrRegistration): string {
  const lines: string[] = [header('UT-REGISTRATION', 'QR')];

  lines.push('');
  lines.push('  UTAH DIVISION OF MOTOR VEHICLES');
  lines.push('  VEHICLE REGISTRATION RECORD');
  lines.push(`  ${'─'.repeat(56)}`);
  lines.push(`  LIC/${pad(record.plate_number, 10)}  LIS/${pad(record.plate_state || 'UT', 2)}`);
  if (record.vin) lines.push(`  VIN/${record.vin.toUpperCase()}`);
  lines.push(`  VYR/${pad(String(record.year || ''), 4)}  VMA/${pad(record.make, 10)}  VMO/${pad(record.model, 15)}`);
  lines.push(`  VCO/${pad(record.color, 10)}  VST/${pad(record.body_style, 6)}`);

  lines.push('');
  lines.push('  REGISTRATION STATUS');
  lines.push(`  STS/${pad(record.registration_status, 12)}  EXP/${ncicDate(record.registration_expiry)}`);
  if (record.title_number) lines.push(`  TTL/${pad(record.title_number, 15)}  TDT/${ncicDate(record.title_date)}`);
  if (record.odometer) lines.push(`  ODO/${String(record.odometer)} MI`);

  if (record.flags && record.flags.length > 0) {
    lines.push('');
    lines.push('  *** ALERTS ***');
    for (const flag of record.flags) {
      lines.push(`  >> ${flag.toUpperCase()}`);
    }
  }

  if (record.owner_last_name || record.owner_first_name) {
    lines.push('');
    lines.push('  REGISTERED OWNER');
    lines.push(`  NAM/${pad(record.owner_last_name, 20)},${pad(record.owner_first_name, 15)}`);
    if (record.owner_address) {
      lines.push(`  ADR/${record.owner_address.toUpperCase()}`);
      const cityLine = [record.owner_city, record.owner_state, record.owner_zip].filter(Boolean).join(', ').toUpperCase();
      if (cityLine) lines.push(`      ${cityLine}`);
    }
  }

  if (record.insurance_company) {
    lines.push('');
    lines.push('  INSURANCE');
    lines.push(`  INS/${pad(record.insurance_company, 25)}  POL/${record.insurance_policy || 'N/A'}`);
    if (record.insurance_expiry) lines.push(`  IEX/${ncicDate(record.insurance_expiry)}`);
  }

  if (record.lien_holder) {
    lines.push(`  LHR/${record.lien_holder.toUpperCase()}`);
  }

  lines.push('');
  lines.push(`─`.repeat(60));
  lines.push('*** END OF RECORD ***');

  return lines.join('\n');
}

// ─── Utah MVR Driver Record Response ────────────────────────

export interface UtahMvrViolation {
  date?: string;
  description?: string;
  statute?: string;
  disposition?: string;
  points?: number;
  court?: string;
}

export interface UtahMvrSuspension {
  type?: string;
  start_date?: string;
  end_date?: string;
  reason?: string;
  status?: string;
}

export interface UtahMvrDriver {
  dl_number?: string;
  dl_class?: string;
  dl_status?: string;
  dl_expiry?: string;
  first_name?: string;
  last_name?: string;
  middle_name?: string;
  date_of_birth?: string;
  sex?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  restrictions?: string[];
  endorsements?: string[];
  violations?: UtahMvrViolation[];
  suspensions?: UtahMvrSuspension[];
  points_total?: number;
}

export function formatMvrDriverResponse(record: UtahMvrDriver): string {
  const lines: string[] = [header('UT-DRIVER', 'QD')];

  lines.push('');
  lines.push('  UTAH DIVISION OF MOTOR VEHICLES');
  lines.push('  DRIVER HISTORY RECORD');
  lines.push(`  ${'─'.repeat(56)}`);

  lines.push(`  NAM/${pad(record.last_name, 20)},${pad(record.first_name, 15)} ${pad(record.middle_name, 1)}`);
  lines.push(`  SEX/${pad(record.sex, 1)}  DOB/${ncicDate(record.date_of_birth)}`);
  lines.push(`  OLN/${pad(record.dl_number, 15)}  CLS/${pad(record.dl_class, 3)}  STA/UT`);
  lines.push(`  DLS/${pad(record.dl_status, 10)}  EXP/${ncicDate(record.dl_expiry)}`);

  if (record.address) {
    lines.push(`  ADR/${record.address.toUpperCase()}`);
    const cityLine = [record.city, record.state, record.zip].filter(Boolean).join(', ').toUpperCase();
    if (cityLine) lines.push(`      ${cityLine}`);
  }

  if (record.dl_status && record.dl_status.toUpperCase() !== 'VALID' && record.dl_status.toUpperCase() !== 'ACTIVE') {
    lines.push('');
    lines.push('  *** LICENSE ALERT ***');
    lines.push(`  >> LICENSE STATUS: ${record.dl_status.toUpperCase()}`);
  }

  if (record.restrictions && record.restrictions.length > 0) {
    lines.push('');
    lines.push('  RESTRICTIONS');
    for (const r of record.restrictions) {
      lines.push(`  RST/${r.toUpperCase()}`);
    }
  }
  if (record.endorsements && record.endorsements.length > 0) {
    lines.push('');
    lines.push('  ENDORSEMENTS');
    for (const e of record.endorsements) {
      lines.push(`  END/${e.toUpperCase()}`);
    }
  }

  if (record.suspensions && record.suspensions.length > 0) {
    lines.push('');
    lines.push(`  *** SUSPENSION HISTORY — ${record.suspensions.length} RECORD(S) ***`);
    for (const s of record.suspensions) {
      lines.push(`  TYP/${pad(s.type, 15)}  STS/${pad(s.status, 10)}`);
      lines.push(`  BEG/${ncicDate(s.start_date)}  END/${ncicDate(s.end_date)}`);
      if (s.reason) lines.push(`  RSN/${s.reason.toUpperCase()}`);
      lines.push('');
    }
  }

  if (record.violations && record.violations.length > 0) {
    lines.push('');
    lines.push(`  VIOLATION HISTORY — ${record.violations.length} RECORD(S)  PTS/${record.points_total ?? '—'}`);
    lines.push(`  ${'─'.repeat(56)}`);
    for (const v of record.violations) {
      lines.push(`  DOO/${ncicDate(v.date)}  PTS/${pad(String(v.points ?? ''), 2)}  CHG/${(v.description || '').toUpperCase()}`);
      if (v.statute) lines.push(`  STA/${v.statute.toUpperCase()}`);
      if (v.disposition) lines.push(`  DIS/${v.disposition.toUpperCase()}`);
      if (v.court) lines.push(`  CRT/${v.court.toUpperCase()}`);
      lines.push('');
    }
  }

  lines.push(`─`.repeat(60));
  lines.push('*** END OF RECORD ***');

  return lines.join('\n');
}

// ─── NHTSA VIN Report Response ───────────────────────────────

export interface NhtsaVinResult {
  vin: string; year: string; make: string; model: string; trim: string;
  bodyClass: string; vehicleType: string; driveType: string; fuelType: string;
  engineCylinders: string; engineDisplacement: string; engineHP: string;
  transmissionStyle: string; doors: string; gvwr: string;
  plantCountry: string; plantCity: string; plantState: string;
  manufacturerName: string; errorCode: string; errorText: string;
  abs: string; esc: string; tractionControl: string;
  airbagLocFront: string; airbagLocSide: string; airbagLocCurtain: string;
}

export interface NhtsaRecall {
  nhtsaCampaignNumber: string; reportReceivedDate: string; component: string;
  summary: string; consequence: string; remedy: string; manufacturer: string;
  parkIt: boolean; parkOutside: boolean;
}

export interface NhtsaComplaint {
  odiNumber: string; dateComplaintFiled: string; dateOfIncident: string;
  numberOfInjuries: number; numberOfDeaths: number; crash: boolean; fire: boolean;
  components: string; summary: string;
}

export interface NhtsaFullReport {
  vehicle: NhtsaVinResult; recalls: NhtsaRecall[]; complaints: NhtsaComplaint[];
  recallCount: number; complaintCount: number; hasParkItRecall: boolean; hasFireRisk: boolean;
}

export function formatNhtsaVinResponse(report: NhtsaFullReport): string {
  const v = report.vehicle;
  const lines: string[] = [header('NHTSA-VIN', 'QN')];

  lines.push('');
  lines.push('  NHTSA VEHICLE IDENTIFICATION — FEDERAL DATABASE');
  lines.push(`  ${'─'.repeat(56)}`);
  lines.push(`  VIN/${v.vin}`);
  lines.push(`  VYR/${pad(v.year, 4)}  VMA/${pad(v.make, 12)}  VMO/${pad(v.model, 15)}`);
  if (v.trim) lines.push(`  TRM/${v.trim.toUpperCase()}`);
  lines.push(`  BDY/${pad(v.bodyClass, 25)}  TYP/${pad(v.vehicleType, 15)}`);
  lines.push(`  DRV/${pad(v.driveType, 20)}  FUL/${pad(v.fuelType, 10)}`);
  if (v.engineCylinders || v.engineDisplacement || v.engineHP) {
    lines.push(`  ENG/${pad(v.engineCylinders, 2)} CYL  ${pad(v.engineDisplacement, 5)}  ${v.engineHP ? v.engineHP + ' HP' : ''}`);
  }
  if (v.transmissionStyle) lines.push(`  TRN/${v.transmissionStyle.toUpperCase()}`);
  if (v.doors) lines.push(`  DRS/${v.doors}`);
  if (v.gvwr) lines.push(`  GVW/${v.gvwr}`);

  lines.push('');
  lines.push('  MANUFACTURING');
  lines.push(`  MFR/${(v.manufacturerName || '').toUpperCase()}`);
  const plant = [v.plantCity, v.plantState, v.plantCountry].filter(Boolean).join(', ').toUpperCase();
  if (plant) lines.push(`  PLT/${plant}`);

  const safetyItems = [
    v.abs && `ABS: ${v.abs}`, v.esc && `ESC: ${v.esc}`,
    v.tractionControl && `TRAC: ${v.tractionControl}`,
    v.airbagLocFront && `AIRBAG-FRT: ${v.airbagLocFront}`,
    v.airbagLocSide && `AIRBAG-SIDE: ${v.airbagLocSide}`,
    v.airbagLocCurtain && `AIRBAG-CURT: ${v.airbagLocCurtain}`,
  ].filter(Boolean);
  if (safetyItems.length > 0) {
    lines.push('');
    lines.push('  SAFETY EQUIPMENT');
    for (const item of safetyItems) lines.push(`  SAF/${item!.toUpperCase()}`);
  }

  if (report.hasParkItRecall) {
    lines.push('');
    lines.push('  *** CRITICAL: NHTSA "PARK IT" RECALL ***');
    lines.push('  >> DO NOT DRIVE — SERIOUS SAFETY DEFECT');
  }
  if (report.hasFireRisk) {
    lines.push('');
    lines.push('  *** WARNING: FIRE RISK ***');
    lines.push('  >> PARK OUTSIDE — FIRE HAZARD REPORTED');
  }

  if (report.recalls.length > 0) {
    lines.push('');
    lines.push(`  SAFETY RECALLS — ${report.recallCount} ACTIVE`);
    lines.push(`  ${'─'.repeat(56)}`);
    for (const r of report.recalls.slice(0, 5)) {
      lines.push(`  CMP/${r.nhtsaCampaignNumber}  DTE/${r.reportReceivedDate || 'N/A'}`);
      lines.push(`  CMP/${(r.component || '').toUpperCase().substring(0, 55)}`);
      lines.push(`  SUM/${(r.summary || '').toUpperCase().substring(0, 120)}`);
      if (r.parkIt) lines.push('  >> *** PARK IT — DO NOT DRIVE ***');
      if (r.parkOutside) lines.push('  >> *** PARK OUTSIDE — FIRE RISK ***');
      lines.push('');
    }
    if (report.recalls.length > 5) lines.push(`  ... ${report.recalls.length - 5} MORE RECALL(S)`);
  } else {
    lines.push('');
    lines.push('  SAFETY RECALLS — NONE FOUND');
  }

  if (report.complaints.length > 0) {
    const crashes = report.complaints.filter(c => c.crash).length;
    const fires = report.complaints.filter(c => c.fire).length;
    const injuries = report.complaints.reduce((s, c) => s + c.numberOfInjuries, 0);
    const deaths = report.complaints.reduce((s, c) => s + c.numberOfDeaths, 0);
    lines.push('');
    lines.push(`  NHTSA COMPLAINTS — ${report.complaintCount} FILED`);
    lines.push(`  CRH/${crashes} CRASHES  FIR/${fires} FIRES  INJ/${injuries} INJURIES  DTH/${deaths} DEATHS`);
  } else {
    lines.push('');
    lines.push('  NHTSA COMPLAINTS — NONE FILED');
  }

  lines.push('');
  lines.push(`─`.repeat(60));
  lines.push('*** END OF NHTSA RECORD ***');
  return lines.join('\n');
}

// ─── FMCSA Carrier Response ─────────────────────────────────

export interface FmcsaCarrier {
  dotNumber: string; legalName: string; dbaName: string; carrierOperation: string;
  hmFlag: string; pcFlag: string; phyStreet: string; phyCity: string;
  phyState: string; phyZipcode: string; telephone: string;
  totalDrivers: string; totalPowerUnits: string; safetyRating: string;
  safetyRatingDate: string; oosDate: string; oosReason: string;
  commonAuthorityStatus: string; contractAuthorityStatus: string; brokerAuthorityStatus: string;
}

export function formatFmcsaCarrierResponse(carrier: FmcsaCarrier): string {
  const lines: string[] = [header('FMCSA-CARRIER', 'QC')];

  lines.push('');
  lines.push('  FMCSA CARRIER SAFETY RECORD — FEDERAL DATABASE');
  lines.push(`  ${'─'.repeat(56)}`);
  lines.push(`  DOT/${carrier.dotNumber}`);
  lines.push(`  NAM/${(carrier.legalName || '').toUpperCase()}`);
  if (carrier.dbaName) lines.push(`  DBA/${carrier.dbaName.toUpperCase()}`);
  lines.push(`  OPR/${(carrier.carrierOperation || '').toUpperCase()}`);

  lines.push('');
  lines.push('  PHYSICAL ADDRESS');
  if (carrier.phyStreet) lines.push(`  ADR/${carrier.phyStreet.toUpperCase()}`);
  const city = [carrier.phyCity, carrier.phyState, carrier.phyZipcode].filter(Boolean).join(', ').toUpperCase();
  if (city) lines.push(`      ${city}`);
  if (carrier.telephone) lines.push(`  TEL/${carrier.telephone}`);

  lines.push('');
  lines.push('  FLEET INFORMATION');
  lines.push(`  DRV/${pad(carrier.totalDrivers, 6)} DRIVERS   PWR/${pad(carrier.totalPowerUnits, 6)} POWER UNITS`);
  lines.push(`  HM/${pad(carrier.hmFlag, 1)} HAZMAT    PC/${pad(carrier.pcFlag, 1)} PASSENGER`);

  lines.push('');
  lines.push('  SAFETY');
  lines.push(`  RAT/${pad(carrier.safetyRating, 15)}  DTE/${carrier.safetyRatingDate || 'N/A'}`);

  if (carrier.oosDate || carrier.oosReason) {
    lines.push('');
    lines.push('  *** OUT OF SERVICE ***');
    if (carrier.oosDate) lines.push(`  OOS/${carrier.oosDate}`);
    if (carrier.oosReason) lines.push(`  RSN/${carrier.oosReason.toUpperCase()}`);
  }

  lines.push('');
  lines.push('  OPERATING AUTHORITY');
  lines.push(`  COM/${pad(carrier.commonAuthorityStatus, 20)} (COMMON)`);
  lines.push(`  CON/${pad(carrier.contractAuthorityStatus, 20)} (CONTRACT)`);
  lines.push(`  BRK/${pad(carrier.brokerAuthorityStatus, 20)} (BROKER)`);

  lines.push('');
  lines.push(`─`.repeat(60));
  lines.push('*** END OF FMCSA RECORD ***');
  return lines.join('\n');
}

// ─── OpenCorporates Business Response ────────────────────────

export interface OCCompanyResult {
  name: string;
  companyNumber: string;
  jurisdictionCode: string;
  incorporationDate: string | null;
  dissolutionDate: string | null;
  companyType: string;
  currentStatus: string;
  registeredAddress: string;
  registryUrl: string;
  opencorporatesUrl: string;
  branchStatus: string | null;
  officers: { name: string; position: string; startDate: string | null; endDate: string | null }[];
}

export interface OCSearchResult {
  success: boolean;
  query: string;
  companies: OCCompanyResult[];
  totalCount: number;
  page: number;
  perPage: number;
  error?: string;
}

export function formatOpenCorporatesResponse(result: OCSearchResult): string {
  const lines: string[] = [header('BUSINESS', 'QB')];

  lines.push('');
  lines.push('  OPENCORPORATES — BUSINESS ENTITY SEARCH');
  lines.push(`  ${'─'.repeat(56)}`);
  lines.push(`  QRY/${result.query.toUpperCase()}`);

  if (result.totalCount === 0) {
    lines.push('');
    lines.push('  NO BUSINESS ENTITIES FOUND');
    lines.push('');
    lines.push(`─`.repeat(60));
    lines.push('*** END OF BUSINESS RECORD ***');
    return lines.join('\n');
  }

  lines.push(`  TOTAL RESULTS: ${result.totalCount}  (PAGE ${result.page})`);

  for (let i = 0; i < Math.min(result.companies.length, 15); i++) {
    const c = result.companies[i];
    lines.push('');
    lines.push(`  BUSINESS ENTITY ${i + 1} OF ${Math.min(result.companies.length, 15)}`);
    lines.push(`  ${'─'.repeat(56)}`);
    lines.push(`  BNM/${(c.name || '').toUpperCase()}`);
    lines.push(`  BRN/${pad(c.companyNumber, 15)}  JUR/${pad(c.jurisdictionCode, 8)}`);
    lines.push(`  TYP/${pad(c.companyType, 20)}  STS/${pad(c.currentStatus, 12)}`);

    if (c.incorporationDate) {
      lines.push(`  INC/${c.incorporationDate}${c.dissolutionDate ? `  DIS/${c.dissolutionDate}` : ''}`);
    }
    if (c.registeredAddress) {
      lines.push(`  ADR/${c.registeredAddress.toUpperCase().substring(0, 58)}`);
    }
    if (c.branchStatus) {
      lines.push(`  BRC/${c.branchStatus.toUpperCase()}`);
    }

    // Show officers if available (up to 5)
    if (c.officers && c.officers.length > 0) {
      lines.push('');
      lines.push(`  OFFICERS/DIRECTORS — ${c.officers.length}`);
      for (const o of c.officers.slice(0, 5)) {
        const datePart = o.startDate ? `  APT/${o.startDate}` : '';
        lines.push(`  OFC/${pad(o.name, 25).toUpperCase()}  POS/${pad(o.position, 15).toUpperCase()}${datePart}`);
      }
      if (c.officers.length > 5) {
        lines.push(`  ... ${c.officers.length - 5} MORE OFFICER(S)`);
      }
    }

    if (c.currentStatus && c.currentStatus.toLowerCase().includes('dissolved')) {
      lines.push('  >> ENTITY DISSOLVED/INACTIVE');
    }
  }

  if (result.companies.length > 15) {
    lines.push('');
    lines.push(`  ... ${result.totalCount - 15} MORE RESULT(S) — REFINE SEARCH OR ADD JURISDICTION`);
  }

  lines.push('');
  lines.push(`─`.repeat(60));
  lines.push('*** END OF BUSINESS RECORD ***');
  return lines.join('\n');
}

// ─── Criminal Records Response ──────────────────────────────

export interface CriminalRecordResult {
  source: string;
  name: string;
  aka: string;
  dob: string;
  sex: string;
  race: string;
  hair: string;
  eyes: string;
  height: string;
  weight: string;
  address: string;
  crime: string;
  state: string;
  imageUrl: string | null;
  updated: string;
  caseNumber: string;
  court: string;
  disposition: string;
  facility: string;
  status: string;
}

export interface CriminalSearchResult {
  success: boolean;
  query: string;
  feedsSearched: string[];
  totalRecords: number;
  records: CriminalRecordResult[];
  creditsUsed: number;
  remainingCredits: number;
  error?: string;
}

export function formatCriminalRecordsResponse(result: CriminalSearchResult): string {
  const lines: string[] = [header('CRIMINAL-RECORDS', 'QX')];

  lines.push('');
  lines.push('  COMPLETE CRIMINAL CHECKS — MULTI-DATABASE SEARCH');
  lines.push(`  ${'─'.repeat(56)}`);
  lines.push(`  QRY/${result.query.toUpperCase()}`);
  lines.push(`  FEEDS/${result.feedsSearched.map(f => f.toUpperCase()).join(', ') || 'ALL'}`);

  if (result.totalRecords === 0) {
    lines.push('');
    lines.push('  NO RECORDS FOUND');
    lines.push('');
    lines.push(`─`.repeat(60));
    lines.push('*** END OF CRIMINAL RECORD ***');
    return lines.join('\n');
  }

  lines.push(`  TOTAL RECORDS: ${result.totalRecords}`);

  // Group records by source feed
  const byFeed: Record<string, CriminalRecordResult[]> = {};
  for (const r of result.records) {
    const key = r.source || 'unknown';
    if (!byFeed[key]) byFeed[key] = [];
    byFeed[key].push(r);
  }

  const feedLabels: Record<string, string> = {
    sex_offender: '*** SEX OFFENDER REGISTRY ***',
    doc: 'DEPARTMENT OF CORRECTIONS',
    arrest_warrants: '*** ARREST WARRANTS ***',
    court: 'COURT RECORDS',
  };

  for (const [feed, records] of Object.entries(byFeed)) {
    lines.push('');
    lines.push(`  ${feedLabels[feed] || feed.toUpperCase()} — ${records.length} RECORD(S)`);
    lines.push(`  ${'─'.repeat(56)}`);

    for (const r of records.slice(0, 10)) {
      lines.push(`  NAM/${pad(r.name, 35)}`);
      if (r.aka) lines.push(`  AKA/${r.aka.toUpperCase()}`);
      lines.push(`  SEX/${pad(r.sex, 1)}  RAC/${pad(r.race, 6)}  DOB/${r.dob || 'UNKNOWN'}`);

      if (r.height || r.weight) {
        lines.push(`  HGT/${pad(r.height, 4)}  WGT/${pad(r.weight, 4)}  HAI/${pad(r.hair, 5)}  EYE/${pad(r.eyes, 5)}`);
      }

      if (r.address) lines.push(`  ADR/${r.address.toUpperCase()}`);
      if (r.state) lines.push(`  STA/${r.state.toUpperCase()}`);

      if (r.crime) lines.push(`  CHG/${r.crime.toUpperCase().substring(0, 60)}`);
      if (r.caseNumber) lines.push(`  OCA/${r.caseNumber.toUpperCase()}`);
      if (r.court) lines.push(`  CRT/${r.court.toUpperCase()}`);
      if (r.disposition) lines.push(`  DIS/${r.disposition.toUpperCase()}`);
      if (r.facility) lines.push(`  FAC/${r.facility.toUpperCase()}`);
      if (r.status) lines.push(`  STS/${r.status.toUpperCase()}`);
      if (r.updated) lines.push(`  UPD/${r.updated}`);

      // Flag sex offenders with caution
      if (feed === 'sex_offender') {
        lines.push('  >> *** REGISTERED SEX OFFENDER — EXERCISE CAUTION ***');
      }
      if (feed === 'arrest_warrants') {
        lines.push('  >> *** ACTIVE WARRANT — USE CAUTION ON APPROACH ***');
      }
      lines.push('');
    }

    if (records.length > 10) {
      lines.push(`  ... ${records.length - 10} MORE RECORD(S) IN ${feed.toUpperCase()}`);
    }
  }

  lines.push(`  CREDITS USED: ${result.creditsUsed}  REMAINING: ${result.remainingCredits}`);
  lines.push('');
  lines.push(`─`.repeat(60));
  lines.push('*** END OF CRIMINAL RECORD ***');
  return lines.join('\n');
}

// ─── Enformion Person Search Response ────────────────────────

export interface EnformionPersonAddress {
  addressLine1: string;
  city: string;
  state: string;
  zip: string;
  latitude: number | null;
  longitude: number | null;
}

export interface EnformionPersonPhone {
  number: string;
  type: string;
  carrier: string;
}

export interface EnformionPersonResult {
  tahoeId: string;
  firstName: string;
  middleName: string;
  lastName: string;
  age: number | null;
  dob: string | null;
  addresses: EnformionPersonAddress[];
  phones: EnformionPersonPhone[];
  emails: string[];
  relatives: { name: string; relation: string }[];
  indicators: Record<string, boolean>;
}

export interface EnformionSearchResult {
  success: boolean;
  query: string;
  persons: EnformionPersonResult[];
  totalCount: number;
  error?: string;
}

export interface EnformionPhoneSearchResult {
  success: boolean;
  query: string;
  persons: EnformionPersonResult[];
  totalCount: number;
  phoneType?: string;
  carrier?: string;
  error?: string;
}

function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `${digits.slice(0,3)}-${digits.slice(3,6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits[0] === '1') return `${digits.slice(1,4)}-${digits.slice(4,7)}-${digits.slice(7)}`;
  return raw;
}

export function formatEnformionPersonResponse(result: EnformionSearchResult): string {
  const lines: string[] = [header('INDIVIDUAL', 'QI')];

  lines.push('');
  lines.push('  ENFORMION \u2014 INDIVIDUAL / PUBLIC RECORDS SEARCH');
  lines.push(`  ${'─'.repeat(56)}`);
  lines.push(`  QRY/${result.query.toUpperCase()}`);

  if (result.totalCount === 0 || result.persons.length === 0) {
    lines.push('');
    lines.push('  NO MATCHING INDIVIDUALS FOUND');
    lines.push('');
    lines.push(`─`.repeat(60));
    lines.push('*** END OF INDIVIDUAL RECORD ***');
    return lines.join('\n');
  }

  lines.push(`  TOTAL RESULTS: ${result.totalCount}`);

  const maxShow = Math.min(result.persons.length, 10);
  for (let i = 0; i < maxShow; i++) {
    const p = result.persons[i];
    const fullName = [p.lastName, [p.firstName, p.middleName].filter(Boolean).join(' ')].filter(Boolean).join(', ');

    lines.push('');
    lines.push(`  INDIVIDUAL ${i + 1} OF ${result.totalCount}`);
    lines.push(`  ${'─'.repeat(56)}`);
    lines.push(`  NAM/${fullName.toUpperCase()}`);

    if (p.dob || p.age) {
      const dobPart = p.dob ? `DOB/${ncicDate(p.dob)}` : '';
      const agePart = p.age ? `AGE/${p.age}` : '';
      lines.push(`  ${[dobPart, agePart].filter(Boolean).join('  ')}`);
    }

    // Addresses (show up to 3)
    for (const a of (p.addresses || []).slice(0, 3)) {
      const addrLine = [a.addressLine1, a.city, a.state, a.zip].filter(Boolean).join(', ');
      if (addrLine) lines.push(`  ADR/${addrLine.toUpperCase().substring(0, 58)}`);
    }

    // Phones (show up to 4)
    const phoneParts: string[] = [];
    for (const ph of (p.phones || []).slice(0, 4)) {
      const typePart = ph.type ? ` (${ph.type.toUpperCase()})` : '';
      phoneParts.push(`TEL/${formatPhone(ph.number)}${typePart}`);
    }
    if (phoneParts.length > 0) {
      // Show 2 per line
      for (let j = 0; j < phoneParts.length; j += 2) {
        lines.push(`  ${phoneParts.slice(j, j + 2).join('  ')}`);
      }
    }

    // Emails (show up to 2)
    for (const email of (p.emails || []).slice(0, 2)) {
      if (email) lines.push(`  EML/${email.toUpperCase()}`);
    }

    // Indicators
    const flagEntries = Object.entries(p.indicators || {}).filter(([, v]) => v !== undefined);
    if (flagEntries.length > 0) {
      lines.push('');
      lines.push('  INDICATORS');
      lines.push(`  ${'─'.repeat(40)}`);
      const flagParts = flagEntries.map(([k, v]) => `${k.toUpperCase().replace(/_/g, ' ')}: ${v ? 'YES' : 'NO'}`);
      // Show 3 per line
      for (let j = 0; j < flagParts.length; j += 3) {
        lines.push(`  ${flagParts.slice(j, j + 3).join('  \u2502  ')}`);
      }
    }

    // Relatives (show up to 5)
    if (p.relatives && p.relatives.length > 0) {
      lines.push('');
      lines.push('  ASSOCIATES/RELATIVES');
      for (const r of p.relatives.slice(0, 5)) {
        lines.push(`  ASC/${pad(r.name, 25).toUpperCase()}  REL/${(r.relation || 'ASSOCIATE').toUpperCase()}`);
      }
      if (p.relatives.length > 5) {
        lines.push(`  ... ${p.relatives.length - 5} MORE ASSOCIATE(S)`);
      }
    }

    // Caution if criminal indicator
    if (p.indicators?.criminal || p.indicators?.Criminal) {
      lines.push('  >> *** CRIMINAL RECORD INDICATOR — USE CAUTION ***');
    }
  }

  if (result.totalCount > 10) {
    lines.push('');
    lines.push(`  ... ${result.totalCount - 10} MORE RESULT(S) — REFINE SEARCH WITH DOB OR ADDRESS`);
  }

  lines.push('');
  lines.push(`─`.repeat(60));
  lines.push('*** END OF INDIVIDUAL RECORD ***');
  return lines.join('\n');
}

// ─── Enformion Reverse Phone Response ────────────────────────

export function formatEnformionPhoneResponse(result: EnformionPhoneSearchResult): string {
  const lines: string[] = [header('PHONE', 'QZ')];

  lines.push('');
  lines.push('  ENFORMION \u2014 REVERSE PHONE LOOKUP');
  lines.push(`  ${'─'.repeat(56)}`);
  lines.push(`  QRY/${result.query}`);

  if (result.phoneType || result.carrier) {
    const parts: string[] = [];
    if (result.phoneType) parts.push(`TYP/${result.phoneType.toUpperCase()}`);
    if (result.carrier) parts.push(`CAR/${result.carrier.toUpperCase()}`);
    lines.push(`  TEL/${formatPhone(result.query)}  ${parts.join('  ')}`);
  }

  if (result.totalCount === 0 || result.persons.length === 0) {
    lines.push('');
    lines.push('  NO MATCHING RECORDS FOR THIS PHONE NUMBER');
    lines.push('');
    lines.push(`─`.repeat(60));
    lines.push('*** END OF PHONE RECORD ***');
    return lines.join('\n');
  }

  lines.push(`  REGISTERED INDIVIDUALS: ${result.totalCount}`);

  const maxShow = Math.min(result.persons.length, 5);
  for (let i = 0; i < maxShow; i++) {
    const p = result.persons[i];
    const fullName = [p.lastName, [p.firstName, p.middleName].filter(Boolean).join(' ')].filter(Boolean).join(', ');

    lines.push('');
    lines.push(`  REGISTERED TO (${i + 1})`);
    lines.push(`  ${'─'.repeat(56)}`);
    lines.push(`  NAM/${fullName.toUpperCase()}`);

    if (p.dob || p.age) {
      const dobPart = p.dob ? `DOB/${ncicDate(p.dob)}` : '';
      const agePart = p.age ? `AGE/${p.age}` : '';
      lines.push(`  ${[dobPart, agePart].filter(Boolean).join('  ')}`);
    }

    for (const a of (p.addresses || []).slice(0, 2)) {
      const addrLine = [a.addressLine1, a.city, a.state, a.zip].filter(Boolean).join(', ');
      if (addrLine) lines.push(`  ADR/${addrLine.toUpperCase().substring(0, 58)}`);
    }

    // Show other phones on this person
    const otherPhones = (p.phones || []).filter(ph => ph.number.replace(/\D/g, '') !== result.query.replace(/\D/g, ''));
    for (const ph of otherPhones.slice(0, 2)) {
      const typePart = ph.type ? ` (${ph.type.toUpperCase()})` : '';
      lines.push(`  TEL/${formatPhone(ph.number)}${typePart}`);
    }
  }

  if (result.totalCount > 5) {
    lines.push('');
    lines.push(`  ... ${result.totalCount - 5} MORE REGISTERED INDIVIDUAL(S)`);
  }

  lines.push('');
  lines.push(`─`.repeat(60));
  lines.push('*** END OF PHONE RECORD ***');
  return lines.join('\n');
}

// ── UGRC SGID Formatters ──────────────────────────────────────

export interface UgrcBusinessResult {
  name: string;
  category?: string;
  amenity?: string;
  shop?: string;
  city?: string;
  zip?: string;
  ugrc_addr?: string;
  osm_addr?: string;
  phone?: string;
  website?: string;
  open_hours?: string;
  lat?: number;
  lon?: number;
}

export interface UgrcBusinessSearchResult {
  success: boolean;
  results: UgrcBusinessResult[];
  message?: string;
}

export interface UgrcAddressResult {
  fulladd: string;
  city: string;
  zipcode?: string;
  countyid?: string;
  parcelid?: string;
  utaddptid?: string;
  pttype?: string;
  addnum?: string;
  streetname?: string;
  _geometry?: any;
}

export interface UgrcAddressSearchResult {
  success: boolean;
  results: UgrcAddressResult[];
  message?: string;
}

export function formatUgrcBusinessResponse(result: UgrcBusinessSearchResult, query: string): string {
  const lines: string[] = [header('BUSINESS', 'QB')];

  lines.push('');
  lines.push('  UGRC SGID \u2014 UTAH BUSINESS SEARCH');
  lines.push(`  ${'─'.repeat(56)}`);
  lines.push(`  QRY/${query.toUpperCase()}`);
  lines.push(`  TOTAL RESULTS: ${result.results.length}`);

  if (result.results.length === 0) {
    lines.push('');
    lines.push('  NO MATCHING BUSINESSES FOUND IN UTAH SGID');
    lines.push('');
    lines.push(`${'─'.repeat(60)}`);
    lines.push('*** END OF BUSINESS RECORD ***');
    return lines.join('\n');
  }

  const maxShow = Math.min(result.results.length, 10);
  for (let i = 0; i < maxShow; i++) {
    const b = result.results[i];
    lines.push('');
    lines.push(`  BUSINESS ${i + 1} OF ${result.results.length}`);
    lines.push(`  ${'─'.repeat(56)}`);
    lines.push(`  NAM/${b.name.toUpperCase()}`);

    const category = b.category || b.amenity || b.shop;
    if (category) lines.push(`  TYP/${category.toUpperCase()}`);

    const addr = b.ugrc_addr || b.osm_addr;
    if (addr) {
      const fullAddr = [addr, b.city, 'UT', b.zip].filter(Boolean).join(', ');
      lines.push(`  ADR/${fullAddr.toUpperCase()}`);
    }

    if (b.phone) lines.push(`  TEL/${formatPhone(b.phone)}`);
    if (b.website) lines.push(`  WEB/${b.website.toUpperCase()}`);
    if (b.open_hours) lines.push(`  HRS/${b.open_hours.toUpperCase()}`);

    if (b.lat && b.lon) {
      lines.push(`  GPS/${b.lat.toFixed(6)}, ${b.lon.toFixed(6)}`);
    }
  }

  if (result.results.length > 10) {
    lines.push('');
    lines.push(`  ... ${result.results.length - 10} MORE BUSINESS(ES) NOT SHOWN`);
  }

  lines.push('');
  lines.push('  * AUTO-IMPORTED TO PROPERTIES (DEDUP APPLIED)');
  lines.push('');
  lines.push(`${'─'.repeat(60)}`);
  lines.push('*** END OF BUSINESS RECORD ***');
  return lines.join('\n');
}

export function formatUgrcAddressResponse(result: UgrcAddressSearchResult, query: string): string {
  const lines: string[] = [header('RESIDENTIAL', 'QA')];

  lines.push('');
  lines.push('  UGRC SGID \u2014 UTAH ADDRESS SEARCH');
  lines.push(`  ${'─'.repeat(56)}`);
  lines.push(`  QRY/${query.toUpperCase()}`);
  lines.push(`  TOTAL RESULTS: ${result.results.length}`);

  if (result.results.length === 0) {
    lines.push('');
    lines.push('  NO MATCHING ADDRESSES FOUND IN UTAH SGID');
    lines.push('');
    lines.push(`${'─'.repeat(60)}`);
    lines.push('*** END OF ADDRESS RECORD ***');
    return lines.join('\n');
  }

  const maxShow = Math.min(result.results.length, 15);
  for (let i = 0; i < maxShow; i++) {
    const a = result.results[i];
    lines.push('');
    lines.push(`  ADDRESS ${i + 1} OF ${result.results.length}`);
    lines.push(`  ${'─'.repeat(56)}`);

    const fullAddr = [a.fulladd, a.city, 'UT', a.zipcode].filter(Boolean).join(', ');
    lines.push(`  ADR/${fullAddr.toUpperCase()}`);

    const details: string[] = [];
    if (a.zipcode) details.push(`ZIP/${a.zipcode}`);
    if (a.countyid) details.push(`CTY/${a.countyid}`);
    if (a.pttype) details.push(`TYP/${a.pttype.toUpperCase()}`);
    if (details.length > 0) lines.push(`  ${details.join('  ')}`);

    if (a.parcelid) lines.push(`  PCL/${a.parcelid.toUpperCase()}`);
    if (a.utaddptid) lines.push(`  UID/${a.utaddptid}`);

    if (a._geometry && a._geometry.x && a._geometry.y) {
      lines.push(`  GPS/${a._geometry.y.toFixed(6)}, ${a._geometry.x.toFixed(6)}`);
    }
  }

  if (result.results.length > 15) {
    lines.push('');
    lines.push(`  ... ${result.results.length - 15} MORE ADDRESS(ES) NOT SHOWN`);
  }

  lines.push('');
  lines.push('  * AUTO-IMPORTED TO PROPERTIES (DEDUP APPLIED)');
  lines.push('');
  lines.push(`${'─'.repeat(60)}`);
  lines.push('*** END OF ADDRESS RECORD ***');
  return lines.join('\n');
}

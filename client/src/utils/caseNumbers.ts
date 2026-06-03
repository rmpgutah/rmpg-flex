// ============================================================
// RMPG Flex — Incident Type Codes, Categories & Case Numbers
// Single source of truth for all incident type definitions
// ============================================================

export type IncidentType =
  // Security
  | 'alarm_response' | 'access_control' | 'patrol_check' | 'lock_unlock'
  | 'property_damage' | 'lost_found'
  | 'fire_watch' | 'house_check' | 'business_check' | 'gate_duty' | 'open_door'
  // Criminal
  | 'theft' | 'burglary' | 'robbery' | 'assault' | 'battery'
  | 'vandalism' | 'criminal_mischief' | 'drug_activity' | 'weapons_offense' | 'fraud_forgery'
  | 'kidnapping' | 'arson' | 'sexual_assault' | 'stalking' | 'identity_theft'
  | 'extortion' | 'criminal_trespass' | 'disorderly_conduct' | 'public_intoxication'
  | 'indecent_exposure' | 'shoplifting' | 'auto_theft' | 'receiving_stolen'
  | 'poss_stolen_vehicle' | 'criminal_threat' | 'illegal_dumping' | 'prostitution'
  | 'wanted_person'
  // Disorder
  | 'trespass' | 'disturbance' | 'noise_complaint' | 'loitering'
  | 'panhandling' | 'domestic_dispute'
  | 'prowler' | 'harassment' | 'curfew_violation' | 'illegal_camping'
  | 'fight' | 'intoxicated_person'
  // Traffic
  | 'traffic_accident' | 'hit_and_run' | 'dui_dwi' | 'parking_violation'
  | 'traffic_hazard' | 'abandoned_vehicle'
  | 'reckless_driving' | 'suspended_license' | 'no_insurance' | 'expired_registration'
  | 'speed_violation' | 'traffic_stop'
  // Medical/Fire
  | 'medical_emergency' | 'overdose' | 'mental_health_crisis'
  | 'fire' | 'fire_alarm' | 'hazmat'
  | 'suicidal_subject'
  // Service
  | 'officer_assist' | 'escort' | 'welfare_check' | 'citizen_assist' | 'civil_standby'
  | 'animal_complaint' | 'utility_problem' | 'pso_client_request'
  | 'death_investigation' | 'juvenile_runaway' | 'missing_person' | 'found_person'
  | 'repo_notice' | 'civil_dispute'
  | 'motorist_assist' | 'vehicle_lockout' | 'jump_start' | 'vehicle_tow' | 'hangup_911'
  // Admin
  | 'daily_activity' | 'special_event' | 'training_exercise' | 'equipment_issue'
  // Use of Force
  | 'use_of_force'
  // Legacy / Uncategorized
  | 'suspicious_activity' | 'suspicious_person' | 'suspicious_vehicle' | 'other';

// ── Case Number Type Codes ──────────────────────────────────

export const INCIDENT_TYPE_CODES: Record<string, string> = {
  // Security
  alarm_response: 'ALR',
  access_control: 'ACC',
  patrol_check: 'PTL',
  lock_unlock: 'LCK',
  property_damage: 'PDM',
  lost_found: 'LFP',
  fire_watch: 'FWT',
  house_check: 'HSC',
  business_check: 'BSC',
  gate_duty: 'GAT',
  open_door: 'OPD',
  // Criminal
  theft: 'THF',
  burglary: 'BRG',
  robbery: 'ROB',
  assault: 'ASL',
  battery: 'BAT',
  vandalism: 'VAN',
  criminal_mischief: 'CRM',
  drug_activity: 'DRG',
  weapons_offense: 'WPN',
  fraud_forgery: 'FRD',
  kidnapping: 'KID',
  arson: 'ARS',
  sexual_assault: 'SXA',
  stalking: 'STK',
  identity_theft: 'IDT',
  extortion: 'EXT',
  criminal_trespass: 'CTR',
  disorderly_conduct: 'DIS',
  public_intoxication: 'PIX',
  indecent_exposure: 'INX',
  shoplifting: 'SHP',
  auto_theft: 'ATH',
  receiving_stolen: 'RST',
  poss_stolen_vehicle: 'PSV',
  criminal_threat: 'CTH',
  illegal_dumping: 'ILD',
  prostitution: 'PRS',
  wanted_person: 'WNT',
  // Disorder
  trespass: 'TRS',
  disturbance: 'DST',
  noise_complaint: 'NOI',
  loitering: 'LOI',
  panhandling: 'PNH',
  domestic_dispute: 'DOM',
  prowler: 'PRW',
  harassment: 'HRS',
  curfew_violation: 'CRF',
  illegal_camping: 'ILC',
  fight: 'FGT',
  intoxicated_person: 'INT',
  // Traffic
  traffic_accident: 'TAC',
  hit_and_run: 'HNR',
  dui_dwi: 'DUI',
  parking_violation: 'PKV',
  traffic_hazard: 'THZ',
  abandoned_vehicle: 'ABV',
  reckless_driving: 'RKD',
  suspended_license: 'SLI',
  no_insurance: 'NIN',
  expired_registration: 'EXR',
  speed_violation: 'SPD',
  traffic_stop: 'TST',
  // Medical/Fire
  medical_emergency: 'MED',
  overdose: 'OVD',
  mental_health_crisis: 'MHC',
  fire: 'FIR',
  fire_alarm: 'FAR',
  hazmat: 'HAZ',
  suicidal_subject: 'SUI',
  // Service
  officer_assist: 'OFA',
  escort: 'ESC',
  welfare_check: 'WCK',
  citizen_assist: 'CTA',
  civil_standby: 'CSB',
  animal_complaint: 'ANM',
  utility_problem: 'UTI',
  pso_client_request: 'PSO',
  death_investigation: 'DTH',
  juvenile_runaway: 'JRN',
  missing_person: 'MSP',
  found_person: 'FDP',
  repo_notice: 'REP',
  civil_dispute: 'CVD',
  motorist_assist: 'MTA',
  vehicle_lockout: 'VLO',
  jump_start: 'JMP',
  vehicle_tow: 'VTW',
  hangup_911: 'HUP',
  // Admin
  daily_activity: 'DAR',
  special_event: 'SPE',
  training_exercise: 'TRN',
  equipment_issue: 'EQP',
  // Use of Force
  use_of_force: 'UOF',
  // Legacy / Uncategorized
  suspicious_activity: 'SUS',
  suspicious_person: 'SUP',
  suspicious_vehicle: 'SUV',
  other: 'OTH',
};

// ── Categories with Labels ──────────────────────────────────

export type IncidentCategory =
  | 'Security'
  | 'Criminal'
  | 'Disorder'
  | 'Traffic'
  | 'Medical/Fire'
  | 'Service'
  | 'Admin'
  | 'Use of Force'
  | 'Other';

export const INCIDENT_TYPE_CATEGORIES: Record<IncidentCategory, { value: IncidentType; label: string }[]> = {
  'Security': [
    { value: 'alarm_response', label: 'Alarm Response' },
    { value: 'access_control', label: 'Access Control' },
    { value: 'patrol_check', label: 'Patrol Check' },
    { value: 'lock_unlock', label: 'Lock/Unlock' },
    { value: 'property_damage', label: 'Property Damage' },
    { value: 'lost_found', label: 'Lost/Found Property' },
    { value: 'fire_watch', label: 'Fire Watch' },
    { value: 'house_check', label: 'Vacation/House Check' },
    { value: 'business_check', label: 'Business Check' },
    { value: 'gate_duty', label: 'Gate Duty' },
    { value: 'open_door', label: 'Open Door/Window' },
  ],
  'Criminal': [
    { value: 'theft', label: 'Theft' },
    { value: 'burglary', label: 'Burglary' },
    { value: 'robbery', label: 'Robbery' },
    { value: 'assault', label: 'Assault' },
    { value: 'battery', label: 'Battery' },
    { value: 'vandalism', label: 'Vandalism' },
    { value: 'criminal_mischief', label: 'Criminal Mischief' },
    { value: 'drug_activity', label: 'Drug Activity' },
    { value: 'weapons_offense', label: 'Weapons Offense' },
    { value: 'fraud_forgery', label: 'Fraud/Forgery' },
    { value: 'kidnapping', label: 'Kidnapping' },
    { value: 'arson', label: 'Arson' },
    { value: 'sexual_assault', label: 'Sexual Assault' },
    { value: 'stalking', label: 'Stalking' },
    { value: 'identity_theft', label: 'Identity Theft' },
    { value: 'extortion', label: 'Extortion' },
    { value: 'criminal_trespass', label: 'Criminal Trespass' },
    { value: 'disorderly_conduct', label: 'Disorderly Conduct' },
    { value: 'public_intoxication', label: 'Public Intoxication' },
    { value: 'indecent_exposure', label: 'Indecent Exposure' },
    { value: 'shoplifting', label: 'Shoplifting' },
    { value: 'auto_theft', label: 'Auto Theft' },
    { value: 'receiving_stolen', label: 'Receiving Stolen Property' },
    { value: 'poss_stolen_vehicle', label: 'Possession of Stolen Vehicle' },
    { value: 'criminal_threat', label: 'Criminal Threat' },
    { value: 'illegal_dumping', label: 'Illegal Dumping' },
    { value: 'prostitution', label: 'Prostitution' },
    { value: 'wanted_person', label: 'Wanted Person' },
  ],
  'Disorder': [
    { value: 'trespass', label: 'Trespass' },
    { value: 'disturbance', label: 'Disturbance' },
    { value: 'noise_complaint', label: 'Noise Complaint' },
    { value: 'loitering', label: 'Loitering' },
    { value: 'panhandling', label: 'Panhandling' },
    { value: 'domestic_dispute', label: 'Domestic Dispute' },
    { value: 'prowler', label: 'Prowler' },
    { value: 'harassment', label: 'Harassment' },
    { value: 'curfew_violation', label: 'Curfew Violation' },
    { value: 'illegal_camping', label: 'Illegal Camping' },
    { value: 'fight', label: 'Fight In Progress' },
    { value: 'intoxicated_person', label: 'Intoxicated Person' },
  ],
  'Traffic': [
    { value: 'traffic_accident', label: 'Traffic Accident' },
    { value: 'hit_and_run', label: 'Hit and Run' },
    { value: 'dui_dwi', label: 'DUI/DWI' },
    { value: 'parking_violation', label: 'Parking Violation' },
    { value: 'traffic_hazard', label: 'Traffic Hazard' },
    { value: 'abandoned_vehicle', label: 'Abandoned Vehicle' },
    { value: 'reckless_driving', label: 'Reckless Driving' },
    { value: 'suspended_license', label: 'Driving on Suspended License' },
    { value: 'no_insurance', label: 'No Insurance' },
    { value: 'expired_registration', label: 'Expired Registration' },
    { value: 'speed_violation', label: 'Speed Violation' },
    { value: 'traffic_stop', label: 'Traffic Stop' },
  ],
  'Medical/Fire': [
    { value: 'medical_emergency', label: 'Medical Emergency' },
    { value: 'overdose', label: 'Overdose' },
    { value: 'mental_health_crisis', label: 'Mental Health Crisis' },
    { value: 'fire', label: 'Fire' },
    { value: 'fire_alarm', label: 'Fire Alarm' },
    { value: 'hazmat', label: 'Hazmat' },
    { value: 'suicidal_subject', label: 'Suicidal Subject' },
  ],
  'Service': [
    { value: 'officer_assist', label: 'Officer Assist — Panic Alarm' },
    { value: 'escort', label: 'Escort' },
    { value: 'welfare_check', label: 'Welfare Check' },
    { value: 'citizen_assist', label: 'Citizen Assist' },
    { value: 'civil_standby', label: 'Civil Standby' },
    { value: 'animal_complaint', label: 'Animal Complaint' },
    { value: 'utility_problem', label: 'Utility Problem' },
    { value: 'pso_client_request', label: 'PSO Client Request' },
    { value: 'death_investigation', label: 'Death Investigation' },
    { value: 'juvenile_runaway', label: 'Juvenile Runaway' },
    { value: 'missing_person', label: 'Missing Person' },
    { value: 'found_person', label: 'Found Person' },
    { value: 'repo_notice', label: 'Repo Notice' },
    { value: 'civil_dispute', label: 'Civil Dispute' },
    { value: 'motorist_assist', label: 'Motorist Assist' },
    { value: 'vehicle_lockout', label: 'Vehicle Lockout' },
    { value: 'jump_start', label: 'Jump Start' },
    { value: 'vehicle_tow', label: 'Vehicle Tow Request' },
    { value: 'hangup_911', label: '911 Hangup' },
  ],
  'Admin': [
    { value: 'daily_activity', label: 'Daily Activity Report' },
    { value: 'special_event', label: 'Special Event' },
    { value: 'training_exercise', label: 'Training Exercise' },
    { value: 'equipment_issue', label: 'Equipment Issue' },
  ],
  'Use of Force': [
    { value: 'use_of_force', label: 'Use of Force Report' },
  ],
  'Other': [
    { value: 'suspicious_activity', label: 'Suspicious Activity' },
    { value: 'suspicious_person', label: 'Suspicious Person' },
    { value: 'suspicious_vehicle', label: 'Suspicious Vehicle' },
    { value: 'other', label: 'Other' },
  ],
};

// ── 2-Letter Case Type Codes (for Case Number format: YY-######-XX) ──

export const CASE_TYPE_CODES: Record<string, string> = {
  general: 'GN',
  criminal: 'CR',
  traffic: 'TR',
  medical: 'MD',
  security: 'SE',
  disorder: 'DS',
  service: 'SV',
  fire: 'FR',
  admin: 'AD',
  civil: 'CV',
  use_of_force: 'UF',
  property: 'PR',
  missing_person: 'MP',
  narcotics: 'NR',
  fraud: 'FD',
  juvenile: 'JV',
  domestic: 'DM',
  accident: 'AC',
  death: 'DT',
  theft: 'TH',
  assault: 'AS',
  burglary: 'BG',
  other: 'OT',
};

export function getCaseTypeCode(caseType: string): string {
  return CASE_TYPE_CODES[caseType] || 'GN';
}

// ── Helpers ─────────────────────────────────────────────────

export function getTypeCode(type: string): string {
  return INCIDENT_TYPE_CODES[type] || 'OTH';
}

export function formatIncidentType(type: string): string {
  for (const group of Object.values(INCIDENT_TYPE_CATEGORIES)) {
    const found = group.find((t) => t.value === type);
    if (found) return found.label;
  }
  return type
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function getIncidentCategory(type: string): IncidentCategory {
  for (const [cat, types] of Object.entries(INCIDENT_TYPE_CATEGORIES)) {
    if (types.some((t) => t.value === type)) return cat as IncidentCategory;
  }
  return 'Other';
}

// Flat array for iteration
export const ALL_INCIDENT_TYPES: {
  value: IncidentType;
  label: string;
  category: IncidentCategory;
  code: string;
}[] = Object.entries(INCIDENT_TYPE_CATEGORIES).flatMap(([cat, types]) =>
  types.map((t) => ({
    ...t,
    category: cat as IncidentCategory,
    code: INCIDENT_TYPE_CODES[t.value],
  })),
);

// Category color mapping for UI badges
export const CATEGORY_COLORS: Record<IncidentCategory, string> = {
  'Security': 'bg-brand-900/40 text-brand-300 border-brand-700/50',
  'Criminal': 'bg-red-900/40 text-red-300 border-red-700/50',
  'Disorder': 'bg-amber-900/40 text-amber-300 border-amber-700/50',
  'Traffic': 'bg-gray-900/40 text-gray-300 border-gray-700/50',
  'Medical/Fire': 'bg-green-900/40 text-green-300 border-green-700/50',
  'Service': 'bg-purple-900/40 text-purple-300 border-purple-700/50',
  'Admin': 'bg-rmpg-700/40 text-rmpg-200 border-rmpg-500/50',
  'Other': 'bg-rmpg-700/40 text-rmpg-300 border-rmpg-600/50',
  'Use of Force': 'bg-orange-900/40 text-orange-300 border-orange-700/50',
};

// PDF report type defaults per incident type
export type PdfReportType =
  | 'incident'
  | 'trespass'
  | 'accident'
  | 'medical'
  | 'use_of_force'
  | 'daily_activity'
  | 'arrest'
  | 'process_service';

export function getDefaultReportType(incidentType: string): PdfReportType {
  switch (incidentType) {
    case 'traffic_accident':
    case 'hit_and_run':
    case 'dui_dwi':
      return 'accident';
    case 'trespass':
      return 'trespass';
    case 'medical_emergency':
    case 'overdose':
    case 'mental_health_crisis':
    case 'suicidal_subject':
      return 'medical';
    // TODO(report-mapping): decide whether any of the other new types should
    // default to a specific PDF template instead of the generic incident
    // report. Candidates worth considering:
    //   - 'fight'         → 'use_of_force' if officer intervention is expected?
    //   - 'vehicle_tow'   → keep 'incident', or a dedicated tow/impound form?
    //   - 'wanted_person' → 'arrest' if a custody outcome is likely?
    // Left at the 'incident' default below until you confirm the policy.
    case 'daily_activity':
      return 'daily_activity';
    case 'assault':
    case 'battery':
      return 'use_of_force';
    case 'pso_client_request':
      return 'process_service';
    default:
      return 'incident';
  }
}

export const PDF_REPORT_LABELS: Record<PdfReportType, string> = {
  incident: 'General Incident Report',
  trespass: 'Trespass Warning',
  accident: 'Vehicle Accident Report',
  medical: 'Medical Response Report',
  use_of_force: 'Use of Force Report',
  daily_activity: 'Daily Activity Report',
  arrest: 'Arrest/Detention Report',
  process_service: 'Process Service Report',
};

// ============================================================
// RMPG Flex — Human-Readable Status & Label Utilities
// ============================================================
// Single source of truth for converting raw DB values into
// user-friendly display labels throughout the application.
// ============================================================

import { parseTimestamp } from './dateUtils';

// ── Call Status Labels ────────────────────────────────
export const CALL_STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  dispatched: 'Dispatched',
  enroute: 'En Route',
  onscene: 'On Scene',
  on_hold: 'On Hold',
  cleared: 'Cleared',
  closed: 'Closed',
  cancelled: 'Cancelled',
  archived: 'Archived',
};

// ── Call Status Tooltips ──────────────────────────────
export const CALL_STATUS_TOOLTIPS: Record<string, string> = {
  pending: 'Call received — waiting for dispatch',
  dispatched: 'Unit has been dispatched to the scene',
  enroute: 'Unit is en route to the scene',
  onscene: 'Unit is on scene handling the call',
  on_hold: 'Call is temporarily on hold',
  cleared: 'Call has been cleared by responding unit',
  closed: 'Call has been closed — no further action',
  cancelled: 'Call was cancelled before completion',
  archived: 'Call archived for records retention',
};

// ── Incident Status Labels ────────────────────────────
export const INCIDENT_STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  submitted: 'Submitted for Review',
  under_review: 'Under Review',
  returned: 'Returned for Revision',
  approved: 'Approved',
  closed: 'Closed',
  archived: 'Archived',
};

export const INCIDENT_STATUS_TOOLTIPS: Record<string, string> = {
  draft: 'Report is being drafted by the officer',
  submitted: 'Report submitted — awaiting supervisor review',
  under_review: 'Supervisor is currently reviewing the report',
  returned: 'Report returned to officer for corrections',
  approved: 'Report approved by supervisor',
  closed: 'Incident closed — no further action needed',
  archived: 'Incident archived for records retention',
};

// ── Priority Labels ───────────────────────────────────
export const PRIORITY_LABELS: Record<string, string> = {
  P1: 'P1 — Emergency',
  P2: 'P2 — Urgent',
  P3: 'P3 — Routine',
  P4: 'P4 — Scheduled',
};

// ── Incident Type Labels ──────────────────────────────
export const INCIDENT_TYPE_LABELS: Record<string, string> = {
  pso_client_request: 'PSO Client Request',
  process_service: 'Process Service',
  patrol: 'Patrol',
  patrol_check: 'Patrol Check',
  alarm_response: 'Alarm Response',
  access_control: 'Access Control',
  lock_unlock: 'Lock/Unlock',
  property_damage: 'Property Damage',
  lost_found: 'Lost/Found Property',
  trespass: 'Trespass',
  criminal_trespass: 'Criminal Trespass',
  theft: 'Theft / Larceny',
  shoplifting: 'Shoplifting',
  burglary: 'Burglary',
  robbery: 'Robbery',
  assault: 'Assault',
  battery: 'Battery',
  vandalism: 'Vandalism / Criminal Mischief',
  criminal_mischief: 'Criminal Mischief',
  disturbance: 'Disturbance',
  suspicious_activity: 'Suspicious Activity',
  welfare_check: 'Welfare Check',
  traffic_accident: 'Vehicle Accident',
  accident: 'Vehicle Accident',
  medical_emergency: 'Medical Emergency',
  medical: 'Medical Emergency',
  fire: 'Fire',
  fire_alarm: 'Fire Alarm',
  dui_dwi: 'DUI / Impaired Driving',
  domestic_dispute: 'Domestic Dispute',
  domestic_violence: 'Domestic Violence',
  missing_person: 'Missing Person',
  found_person: 'Found Person',
  fraud_forgery: 'Fraud / Forgery',
  fraud: 'Fraud / Forgery',
  drug_activity: 'Drug Activity / Narcotics',
  narcotics: 'Narcotics',
  traffic_stop: 'Traffic Stop',
  parking_violation: 'Parking Violation',
  noise_complaint: 'Noise Complaint',
  animal_complaint: 'Animal Complaint',
  escort: 'Escort / Transport',
  civil_dispute: 'Civil Dispute',
  civil_standby: 'Civil Standby',
  officer_assist: 'Officer Assist — Panic Alarm',
  citizen_assist: 'Citizen Assist',
  utility_problem: 'Utility Problem',
  loitering: 'Loitering',
  panhandling: 'Panhandling',
  prowler: 'Prowler',
  harassment: 'Harassment',
  stalking: 'Stalking',
  weapons_offense: 'Weapons Offense',
  kidnapping: 'Kidnapping',
  arson: 'Arson',
  sexual_assault: 'Sexual Assault',
  identity_theft: 'Identity Theft',
  extortion: 'Extortion',
  disorderly_conduct: 'Disorderly Conduct',
  public_intoxication: 'Public Intoxication',
  indecent_exposure: 'Indecent Exposure',
  auto_theft: 'Auto Theft',
  receiving_stolen: 'Receiving Stolen Property',
  poss_stolen_vehicle: 'Possession of Stolen Vehicle',
  criminal_threat: 'Criminal Threat',
  illegal_dumping: 'Illegal Dumping',
  prostitution: 'Prostitution',
  curfew_violation: 'Curfew Violation',
  illegal_camping: 'Illegal Camping',
  hit_and_run: 'Hit and Run',
  traffic_hazard: 'Traffic Hazard',
  abandoned_vehicle: 'Abandoned Vehicle',
  reckless_driving: 'Reckless Driving',
  suspended_license: 'Driving on Suspended License',
  no_insurance: 'No Insurance',
  expired_registration: 'Expired Registration',
  speed_violation: 'Speed Violation',
  overdose: 'Overdose',
  mental_health_crisis: 'Mental Health Crisis',
  hazmat: 'Hazmat',
  death_investigation: 'Death Investigation',
  juvenile_runaway: 'Juvenile Runaway',
  repo_notice: 'Repo Notice',
  daily_activity: 'Daily Activity Report',
  special_event: 'Special Event',
  training_exercise: 'Training Exercise',
  equipment_issue: 'Equipment Issue',
  use_of_force: 'Use of Force Report',
  code_violation: 'Code Violation',
  other: 'Other',
};

// ── Unit Status Labels ────────────────────────────────
export const UNIT_STATUS_LABELS: Record<string, string> = {
  available: 'Available',
  dispatched: 'Dispatched',
  enroute: 'En Route',
  onscene: 'On Scene',
  busy: 'Busy',
  off_duty: 'Off Duty',
  out_of_service: 'Out of Service',
  on_break: 'On Break',
};

// ── Gender Labels ─────────────────────────────────────
export const GENDER_LABELS: Record<string, string> = {
  M: 'Male',
  F: 'Female',
  X: 'Non-Binary',
  U: 'Unknown',
  Male: 'Male',
  Female: 'Female',
};

// ── Race Labels ───────────────────────────────────────
export const RACE_LABELS: Record<string, string> = {
  W: 'White',
  B: 'Black',
  H: 'Hispanic',
  A: 'Asian',
  I: 'American Indian',
  P: 'Pacific Islander',
  M: 'Multiracial',
  O: 'Other',
  U: 'Unknown',
  White: 'White',
  Black: 'Black',
  Hispanic: 'Hispanic',
  Asian: 'Asian',
};

// ── Case Type Labels ──────────────────────────────────
export const CASE_TYPE_LABELS: Record<string, string> = {
  general: 'General Investigation',
  criminal: 'Criminal Investigation',
  theft: 'Theft / Property Crime',
  assault: 'Assault Investigation',
  fraud: 'Fraud / Financial Crime',
  narcotics: 'Narcotics Investigation',
  missing_person: 'Missing Person',
  traffic: 'Traffic Investigation',
  medical: 'Medical Investigation',
  security: 'Security Investigation',
  disorder: 'Disorder Investigation',
  service: 'Service Investigation',
  fire: 'Fire Investigation',
  admin: 'Administrative',
  civil: 'Civil Matter',
  use_of_force: 'Use of Force Review',
  property: 'Property Crime',
  juvenile: 'Juvenile Investigation',
  domestic: 'Domestic Investigation',
  accident: 'Accident Investigation',
  death: 'Death Investigation',
  burglary: 'Burglary Investigation',
  other: 'Other',
};

// ── Disposition Code Labels ───────────────────────────
export const DISPOSITION_LABELS: Record<string, string> = {
  'PS/05': 'PS/05 — Personal Service Completed',
  'PS/06': 'PS/06 — Sub-Service Completed',
  'NS/01': 'NS/01 — Not Served — Unable to Locate',
  'NS/02': 'NS/02 — Not Served — Bad Address',
  'NS/03': 'NS/03 — Not Served — Evading Service',
  'NS/04': 'NS/04 — Not Served — Other',
  'ADV': 'ADV — Advised / Information Given',
  'ARR': 'ARR — Arrest Made',
  'CIT': 'CIT — Citation Issued',
  'GOA': 'GOA — Gone on Arrival',
  'UTL': 'UTL — Unable to Locate',
  'RPT': 'RPT — Report Taken',
  'REF': 'REF — Referred to Other Agency',
  'UNF': 'UNF — Unfounded',
  'WAR': 'WAR — Warrant Issued',
  'CLR': 'CLR — Cleared',
  'CSL': 'CSL — Civil Standby',
  'TPW': 'TPW — Trespass Warning Issued',
  'FIA': 'FIA — Field Interview / Advisory',
  'AST': 'AST — Assist Other Agency',
  'MED': 'MED — Medical Transport / Aid',
  'CAN': 'CAN — Cancelled',
  'DUP': 'DUP — Duplicate Call',
};

// ── Solvability Factor Labels ─────────────────────────
export const SOLVABILITY_FACTOR_LABELS: Record<string, string> = {
  witness_available: 'Witness available to identify suspect',
  physical_evidence: 'Physical evidence recovered at scene',
  suspect_named: 'Suspect has been identified by name',
  suspect_described: 'Physical description of suspect obtained',
  suspect_vehicle: 'Suspect vehicle identified or described',
  video_available: 'Video/surveillance footage available',
  traceable_property: 'Stolen/involved property is traceable',
  significant_modus: 'Significant modus operandi identified',
};

// ── Flag Description Labels ───────────────────────────
export const FLAG_DESCRIPTIONS: Record<string, string> = {
  'Trespass Warning': 'Active trespass warning on file — subject has been issued a no-trespass notice',
  'Known Offender': 'Known repeat offender — exercise heightened awareness',
  'Warrant': 'Active warrant — verify and confirm with dispatch',
  'Mental Health': 'Mental health concerns — use crisis intervention approach',
  'BOLO': 'Be On the Lookout — active advisory in effect',
  'Parking Violation': 'Previous parking violations on record',
  'Pre-Trial Supervision': 'Subject is under pre-trial supervision — verify compliance conditions',
};

// ══════════════════════════════════════════════════════
// Helper Functions
// ══════════════════════════════════════════════════════

/** Convert a raw status value to a human-readable label */
export function humanizeStatus(status: string | null | undefined, type?: 'call' | 'incident' | 'unit'): string {
  if (!status) return '\u2014';
  const maps: Record<string, Record<string, string>> = {
    call: CALL_STATUS_LABELS,
    incident: INCIDENT_STATUS_LABELS,
    unit: UNIT_STATUS_LABELS,
  };
  const map = type ? maps[type] : { ...CALL_STATUS_LABELS, ...INCIDENT_STATUS_LABELS, ...UNIT_STATUS_LABELS };
  return map[status] || status.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
}

/** Convert an incident type code to a readable label */
export function humanizeType(type: string | null | undefined): string {
  if (!type) return '\u2014';
  return INCIDENT_TYPE_LABELS[type] || type.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
}

/** Convert a priority code to a descriptive label */
export function humanizePriority(priority: string | null | undefined): string {
  if (!priority) return '\u2014';
  return PRIORITY_LABELS[priority] || priority;
}

/** Get a tooltip for a call status */
export function getStatusTooltip(status: string | null | undefined, type?: 'call' | 'incident'): string {
  if (!status) return '';
  if (type === 'incident') return INCIDENT_STATUS_TOOLTIPS[status] || '';
  return CALL_STATUS_TOOLTIPS[status] || '';
}

/** Convert gender abbreviation to full word */
export function humanizeGender(gender: string | null | undefined): string {
  if (!gender) return '\u2014';
  return GENDER_LABELS[gender] || gender;
}

/** Convert race abbreviation to full word */
export function humanizeRace(race: string | null | undefined): string {
  if (!race) return '\u2014';
  return RACE_LABELS[race] || race;
}

/** Convert a case type code to a readable label */
export function humanizeCaseType(caseType: string | null | undefined): string {
  if (!caseType) return '\u2014';
  return CASE_TYPE_LABELS[caseType] || caseType.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
}

/** Translate a disposition code to its full description */
export function humanizeDisposition(code: string | null | undefined): string {
  if (!code) return '\u2014';
  return DISPOSITION_LABELS[code] || code;
}

/** Translate a solvability factor key to its description */
export function humanizeSolvabilityFactor(key: string): string {
  return SOLVABILITY_FACTOR_LABELS[key] || key.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
}

/** Get a human-readable description for a person flag */
export function humanizeFlag(flag: string): string {
  return FLAG_DESCRIPTIONS[flag] || flag;
}

// ── Relative Time Formatting ──────────────────────────
export function timeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return '\u2014';
  const date = parseTimestamp(dateStr);
  if (isNaN(date.getTime())) return '\u2014';
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ── Duration Formatting ───────────────────────────────
export function formatDurationMs(ms: number): string {
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.round((ms % 60000) / 1000);
  if (mins < 60) return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rmins = mins % 60;
  return rmins > 0 ? `${hrs}h ${rmins}m` : `${hrs}h`;
}

// ── Distance Formatting ───────────────────────────────
export function formatDistance(miles: number): string {
  if (miles < 0.1) return `${Math.round(miles * 5280)} ft`;
  return `${miles.toFixed(1)} mi`;
}

// ── Phone Display Formatting ──────────────────────────
export function formatPhoneDisplay(phone: string | null | undefined): string {
  if (!phone) return '\u2014';
  const digits = phone.replace(/\D/g, '');
  const d = digits.length === 11 && digits[0] === '1' ? digits.substring(1) : digits;
  if (d.length !== 10) return phone;
  return `(${d.substring(0, 3)}) ${d.substring(3, 6)}-${d.substring(6)}`;
}

// ── Number Formatting ─────────────────────────────────
export function formatNumber(n: number | null | undefined): string {
  if (n == null) return '\u2014';
  return n.toLocaleString('en-US');
}

// ── Boolean Display ───────────────────────────────────
export function formatYesNo(val: boolean | number | null | undefined): string {
  if (val == null) return '\u2014';
  return val ? 'Yes' : 'No';
}

// ── Date-Only Display ─────────────────────────────────
export function formatDateShort(dateStr: string | null | undefined): string {
  if (!dateStr) return '\u2014';
  const d = parseTimestamp(dateStr);
  if (isNaN(d.getTime())) return '\u2014';
  return d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
}

// ── Address Formatting ────────────────────────────────
/** Tokens that must stay UPPERCASE in formatted addresses */
const ADDRESS_UPPER_TOKENS = new Set([
  // Country
  'USA', 'US',
  // US state abbreviations
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  'DC', 'PR', 'VI', 'GU', 'AS', 'MP',
  // Directionals
  'N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW',
  // Address abbreviations
  'PO', 'APT', 'STE', 'BLDG', 'RM',
  // Business suffixes
  'LLC', 'INC', 'LTD', 'CORP',
]);

/** Title-case street names while keeping state abbrevs, directionals, and USA uppercase */
export function formatAddressDisplay(address: string | null | undefined): string {
  if (!address) return '\u2014';
  // Split on whitespace and commas, preserving delimiters
  return address.split(/(\s+|,)/).map(token => {
    const trimmed = token.trim();
    if (!trimmed || /^\s+$/.test(token) || token === ',') return token;
    // Strip trailing punctuation for lookup
    const stripped = trimmed.replace(/[.,]/g, '').toUpperCase();
    // Keep tokens that should be uppercase
    if (ADDRESS_UPPER_TOKENS.has(stripped)) return token.toUpperCase();
    // Keep zip codes as-is (5 or 5+4 format)
    if (/^\d{5}(-\d{4})?$/.test(trimmed)) return trimmed;
    // Keep all-numeric tokens as-is (street numbers)
    if (/^\d+$/.test(trimmed)) return trimmed;
    // Keep ordinals like 11th, 2nd as-is
    if (/^\d+(st|nd|rd|th)$/i.test(trimmed)) return trimmed;
    // Title-case everything else
    if (/^[a-zA-Z]/.test(trimmed)) {
      return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
    }
    return token;
  }).join('');
}

// ── Title Case Utility ────────────────────────────────
/** Simple title case: "hello world" -> "Hello World" */
export function titleCase(str: string | null | undefined): string {
  if (!str) return '\u2014';
  return str.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
}

/** Remove underscores from any string and title-case it \u2014 use as last-resort formatter */
export function cleanDisplay(val: string | null | undefined): string {
  if (!val) return '\u2014';
  return val.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
}

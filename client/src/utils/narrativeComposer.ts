// ============================================================
// RMPG Flex — Narrative Composer
//
// Builds rich tactical spoken narratives from dispatch call data
// for consumption by the Edge-TTS or browser SpeechSynthesis
// engines. Fields are ordered by officer safety priority:
//   1. Call ID + type + priority
//   2. Location (full address, apartment, building)
//   3. Zone / beat / section
//   4. Suspect / vehicle description
//   5. Safety flags (weapons, warrants, pursuit, DV, etc.)
//   6. Service requests (EMS, K9)
//   7. Assigned units
//   8. Brief narrative excerpt (full detail only)
//
// Empty fields are silently skipped. Natural punctuation
// (periods between phrases) ensures proper TTS pacing.
// ============================================================

import { toPhonetic } from './voiceAlerts';

// ─── Types ──────────────────────────────────────────────────

/** How much detail to include in spoken narratives */
export type NarrativeDetail = 'minimal' | 'standard' | 'full';

/**
 * Call data shape for narrative composition.
 * Covers all fields from the `calls_for_service` table that may
 * appear in dispatch data. All fields optional except call_number.
 */
export interface CallData {
  call_number: string;
  call_type?: string;
  incident_type?: string;
  nature?: string;
  priority?: string;
  status?: string;
  // Location
  location?: string;
  location_address?: string;
  apartment?: string;
  location_room?: string;
  property_name?: string;
  business_name?: string;
  client_name?: string;
  cross_street?: string;
  // Zone / beat
  zone?: string;
  beat?: string;
  zone_beat?: string;
  sector_name?: string;
  beat_descriptor?: string;
  // Subject / vehicle
  suspect_description?: string;
  subject_description?: string;
  vehicle_description?: string;
  // Narrative
  narrative?: string;
  description?: string;
  // Safety flags
  weapons_involved?: string | boolean;
  domestic_violence?: boolean;
  mental_health_crisis?: boolean;
  felony_in_progress?: boolean;
  officer_safety_caution?: boolean;
  gang_related?: boolean;
  hazmat?: boolean;
  vehicle_pursuit?: boolean;
  foot_pursuit?: boolean;
  // Service requests
  ems_requested?: boolean;
  k9_requested?: boolean;
  // Other flags
  drugs_involved?: boolean;
  alcohol_involved?: boolean;
  injuries_reported?: boolean;
  // Units
  assigned_units?: string[];
  // Caller
  caller_name?: string;
  caller_phone?: string;
  // Source
  source?: string;
  call_source?: string;
}

/** BOLO alert data */
export interface BoloData {
  type: string;
  description: string;
  vehicle_description?: string;
  suspect_description?: string;
  last_seen_location?: string;
  direction_of_travel?: string;
  reason?: string;
}

/** Pursuit update data */
export interface PursuitData {
  unit: string;
  location: string;
  direction?: string;
  speed?: string | number;
  vehicle_description?: string;
  reason?: string;
  status?: string;
}

// ─── Constants ──────────────────────────────────────────────

/** localStorage key for narrative detail level preference */
const DETAIL_KEY = 'rmpg-narrative-detail';

/** Default detail level */
const DEFAULT_DETAIL: NarrativeDetail = 'standard';

/** Priority labels for natural speech */
const PRIORITY_LABELS: Record<string, string> = {
  P1: 'priority one',
  P2: 'priority two',
  P3: 'priority three',
  P4: 'priority four',
};

/** License plate pattern: 2-4 letters followed by 1-5 digits (with optional separator) */
const PLATE_PATTERN = /\b([A-Z]{2,4})[- ]?(\d{1,5})\b/gi;

// ─── Detail Level Preference ────────────────────────────────

/**
 * Get the current narrative detail level from localStorage.
 * Defaults to 'standard' if unset or invalid.
 */
export function getDetailLevel(): NarrativeDetail {
  try {
    const stored = localStorage.getItem(DETAIL_KEY);
    if (stored === 'minimal' || stored === 'standard' || stored === 'full') {
      return stored;
    }
  } catch {
    // localStorage unavailable (SSR, etc.)
  }
  return DEFAULT_DETAIL;
}

/**
 * Persist the narrative detail level preference.
 */
export function setDetailLevel(level: NarrativeDetail): void {
  try {
    localStorage.setItem(DETAIL_KEY, level);
  } catch {
    // localStorage unavailable
  }
}

// ─── Internal Helpers ───────────────────────────────────────

/** Return the string if it has meaningful content, otherwise undefined */
function present(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === 'none' || trimmed.toLowerCase() === 'n/a') {
    return undefined;
  }
  return trimmed;
}

/** Join non-empty phrases with period-space for TTS breathing */
function joinPhrases(phrases: (string | undefined | null | false)[]): string {
  return phrases.filter((p): p is string => typeof p === 'string' && p.length > 0).join('. ') + '.';
}

/** Resolve the call type label from available fields */
function resolveCallType(call: CallData): string | undefined {
  return present(call.call_type)
    || present(call.incident_type)
    || present(call.nature);
}

/** Build the full location phrase from address components */
function buildLocation(call: CallData): string | undefined {
  const addr = present(call.location_address) || present(call.location);
  if (!addr) return undefined;

  const parts: string[] = [addr];

  const apt = present(call.apartment) || present(call.location_room);
  if (apt) parts.push(`apartment ${apt}`);

  const building = present(call.property_name) || present(call.business_name);
  if (building) parts.push(building);

  return parts.join(', ');
}

/** Build zone/beat/section phrase */
function buildZoneBeat(call: CallData): string | undefined {
  const parts: string[] = [];

  const zone = present(call.zone);
  const beat = present(call.beat);
  const zoneBeat = present(call.zone_beat);
  const section = present(call.sector_name);
  const descriptor = present(call.beat_descriptor);

  if (zoneBeat) {
    parts.push(`zone beat ${zoneBeat}`);
  } else {
    if (zone) parts.push(`zone ${zone}`);
    if (beat) parts.push(`beat ${beat}`);
  }

  if (section) parts.push(section);
  if (descriptor) parts.push(descriptor);

  return parts.length > 0 ? parts.join(', ') : undefined;
}

/**
 * Check if weapons_involved has a real value.
 * Returns the weapon type string or undefined.
 * Handles: boolean false, string "None", empty string, truthy string.
 */
function parseWeapons(value: string | boolean | undefined): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (value === false) return undefined;
  if (value === true) return 'unknown weapon type';
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === 'none' || trimmed.toLowerCase() === 'false'
    || trimmed.toLowerCase() === 'no' || trimmed.toLowerCase() === 'n/a') {
    return undefined;
  }
  return trimmed;
}

/** Build safety flags list */
function buildSafetyFlags(call: CallData): string | undefined {
  const flags: string[] = [];

  const weapon = parseWeapons(call.weapons_involved);
  if (weapon) {
    flags.push(`Armed subject, ${weapon}`);
  }

  if (call.officer_safety_caution) flags.push('Officer safety caution');
  if (call.felony_in_progress) flags.push('Felony in progress');
  if (call.domestic_violence) flags.push('Domestic violence');
  if (call.mental_health_crisis) flags.push('Mental health crisis');
  if (call.gang_related) flags.push('Gang related');
  if (call.hazmat) flags.push('Hazmat');
  if (call.vehicle_pursuit) flags.push('Vehicle pursuit');
  if (call.foot_pursuit) flags.push('Foot pursuit');
  if (call.drugs_involved) flags.push('Drugs involved');
  if (call.alcohol_involved) flags.push('Alcohol involved');
  if (call.injuries_reported) flags.push('Injuries reported');

  return flags.length > 0 ? flags.join('. ') : undefined;
}

/** Build service request list */
function buildServiceRequests(call: CallData): string | undefined {
  const services: string[] = [];

  if (call.ems_requested) services.push('EMS requested');
  if (call.k9_requested) services.push('K9 requested');

  return services.length > 0 ? services.join('. ') : undefined;
}

/** Build assigned units phrase */
function buildUnits(call: CallData): string | undefined {
  if (!call.assigned_units || call.assigned_units.length === 0) return undefined;
  const unitList = call.assigned_units.join(', ');
  return call.assigned_units.length === 1
    ? `Assigned unit ${unitList}`
    : `Assigned units ${unitList}`;
}

/**
 * Convert license plate patterns in vehicle descriptions to NATO phonetic.
 * Example: "Red Ford F150, plate ABC1234" → "Red Ford F150, plate Alpha Bravo Charlie 1 2 3 4"
 */
function phoneticVehicle(description: string): string {
  return description.replace(PLATE_PATTERN, (_match, letters: string, digits: string) => {
    return `plate ${toPhonetic(letters + digits)}`;
  });
}

/** Extract the first sentence from a narrative, constrained to 10-150 chars */
function briefNarrative(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const trimmed = text.trim();
  if (!trimmed) return undefined;

  // Take first sentence (up to period, exclamation, or question mark)
  const match = trimmed.match(/^[^.!?]+[.!?]?/);
  const sentence = match ? match[0].trim() : trimmed;

  if (sentence.length < 10 || sentence.length > 150) return undefined;
  return sentence;
}

// ─── Public Composers ───────────────────────────────────────

/**
 * Build a tactical spoken narrative for a dispatch call.
 * Fields are ordered by officer safety priority.
 * Empty fields are silently skipped.
 *
 * @param call - Call data from dispatch
 * @param detail - Override detail level (defaults to stored preference)
 * @returns Natural speech text with period-separated phrases
 */
export function composeDispatchNarrative(
  call: CallData,
  detail?: NarrativeDetail,
  extra?: {
    threatContext?: { threatLevel?: string; briefingSummary?: string };
    nearestUnits?: Array<{ callSign: string; distance: number; etaMinutes: number }>;
  },
): string {
  const level = detail ?? getDetailLevel();
  const callType = resolveCallType(call);
  const location = buildLocation(call);

  // Minimal: just type + location
  if (level === 'minimal') {
    const type = callType || 'Call';
    return location ? `${type} at ${location}.` : `${type}.`;
  }

  // Standard + Full share the same base
  const phrases: (string | undefined)[] = [];

  // 1. Call ID + type + priority
  const priorityLabel = call.priority ? PRIORITY_LABELS[call.priority] || call.priority : undefined;
  const callId = present(call.call_number);
  const typeAndPriority = [
    callId ? `Call ${callId}` : undefined,
    callType,
    priorityLabel,
  ].filter(Boolean).join(', ');
  if (typeAndPriority) phrases.push(typeAndPriority);

  // 2. Location
  if (location) phrases.push(location);

  // 2b. Cross street
  const cross = present(call.cross_street);
  if (cross) phrases.push(`Cross street ${cross}`);

  // 3. Zone / beat / section
  const zoneBeat = buildZoneBeat(call);
  if (zoneBeat) phrases.push(zoneBeat);

  // 4. Suspect / vehicle description (full detail only)
  if (level === 'full') {
    const suspect = present(call.suspect_description) || present(call.subject_description);
    if (suspect) phrases.push(`Suspect description, ${suspect}`);

    const vehicle = present(call.vehicle_description);
    if (vehicle) phrases.push(`Vehicle, ${phoneticVehicle(vehicle)}`);
  }

  // 5. Safety flags (standard + full)
  const safety = buildSafetyFlags(call);
  if (safety) phrases.push(safety);

  // 5b. Threat context (if provided)
  if (extra?.threatContext?.briefingSummary) {
    phrases.push(extra.threatContext.briefingSummary);
  }

  // 5c. Nearest units (full detail only)
  if (level === 'full' && extra?.nearestUnits && extra.nearestUnits.length > 0) {
    const unitParts = extra.nearestUnits.slice(0, 3).map(u => {
      const dist = u.distance >= 1609
        ? `${(u.distance / 1609.34).toFixed(1)} miles`
        : `${u.distance} meters`;
      return `${u.callSign}, ${dist}, ${u.etaMinutes} minute${u.etaMinutes !== 1 ? 's' : ''}`;
    });
    phrases.push(`Nearest units: ${unitParts.join('. ')}.`);
  }

  // 6. Service requests (standard + full)
  const services = buildServiceRequests(call);
  if (services) phrases.push(services);

  // 7. Assigned units (standard + full)
  const units = buildUnits(call);
  if (units) phrases.push(units);

  // 8. Brief narrative excerpt (full detail only)
  if (level === 'full') {
    const narrativeText = present(call.narrative) || present(call.description);
    const brief = briefNarrative(narrativeText);
    if (brief) phrases.push(brief);
  }

  return joinPhrases(phrases);
}

/**
 * Build a spoken narrative for a unit status change.
 *
 * @param callSign - Unit call sign (e.g. "D-101")
 * @param status - New status value
 * @returns Natural speech text
 */
export function composeStatusNarrative(callSign: string, status: string): string {
  const label = status.replace(/_/g, ' ').toUpperCase();
  return `${callSign}, ${label}.`;
}

/**
 * Build an urgent spoken narrative for a panic alert.
 * Designed for maximum urgency and clarity.
 *
 * @param officerName - Officer's name
 * @param location - Last known location (optional)
 * @param callSign - Unit call sign (optional)
 * @returns Urgent speech text with repeated alert
 */
export function composePanicNarrative(
  officerName: string,
  location?: string,
  callSign?: string,
): string {
  const phrases: string[] = [
    'Emergency. Panic alarm activated',
  ];

  if (callSign) phrases.push(`Unit ${callSign}`);
  phrases.push(`Officer ${officerName}`);
  if (location) phrases.push(location);

  // Repeat core alert for emphasis
  phrases.push('All units respond immediately');

  return joinPhrases(phrases);
}

/**
 * Build a spoken BOLO (Be On the Lookout) alert.
 *
 * @param data - BOLO details
 * @returns Natural speech text
 */
export function composeBoloNarrative(data: BoloData): string {
  const phrases: string[] = [
    `Be on the lookout. ${data.type}`,
    data.description,
  ];

  if (present(data.suspect_description)) {
    phrases.push(`Suspect, ${data.suspect_description}`);
  }

  if (present(data.vehicle_description)) {
    phrases.push(`Vehicle, ${phoneticVehicle(data.vehicle_description!)}`);
  }

  if (present(data.last_seen_location)) {
    phrases.push(`Last seen ${data.last_seen_location}`);
  }

  if (present(data.direction_of_travel)) {
    phrases.push(`Traveling ${data.direction_of_travel}`);
  }

  if (present(data.reason)) {
    phrases.push(data.reason!);
  }

  return joinPhrases(phrases);
}

/**
 * Build a spoken backup request narrative.
 *
 * @param unit - Requesting unit call sign
 * @param location - Location for backup
 * @param callNumber - Associated call number (optional)
 * @returns Urgent speech text
 */
export function composeBackupNarrative(
  unit: string,
  location: string,
  callNumber?: string,
): string {
  const phrases: string[] = [
    `Backup requested. Unit ${unit}`,
    location,
  ];

  if (callNumber) {
    phrases.push(`Reference call ${callNumber}`);
  }

  phrases.push('All available units respond');

  return joinPhrases(phrases);
}

/**
 * Build a spoken pursuit update narrative.
 *
 * @param data - Pursuit details
 * @returns Natural speech text with pursuit info
 */
export function composePursuitNarrative(data: PursuitData): string {
  const phrases: string[] = [
    `Pursuit update. Unit ${data.unit}`,
    data.location,
  ];

  if (present(data.direction)) {
    phrases.push(`Direction ${data.direction}`);
  }

  if (data.speed !== undefined && data.speed !== null) {
    phrases.push(`Speed ${data.speed} miles per hour`);
  }

  if (present(data.vehicle_description)) {
    phrases.push(`Vehicle, ${phoneticVehicle(data.vehicle_description!)}`);
  }

  if (present(data.reason)) {
    phrases.push(data.reason!);
  }

  if (present(data.status)) {
    phrases.push(data.status!);
  }

  return joinPhrases(phrases);
}

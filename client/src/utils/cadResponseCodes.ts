// ============================================================
// RMPG Flex — CAD Response Codes (Spillman Flex Standard)
// 10 dispatch enhancement features: response codes, nature codes,
// disposition codes, clearance codes, priority escalation, call
// type classification, location verification, response plan
// generation, closest-unit routing, and time compliance tracking.
// ============================================================

/* ── FEATURE 1: Response Code System ──────────────────────
   Spillman Flex uses a numeric response code system (1-5) that
   maps to urgency levels and determines the response plan.
   1 = Emergency (lights+siren), 2 = Urgent (expedited),
   3 = Routine, 4 = Scheduled, 5 = Administrative. */
export type ResponseCode = 1 | 2 | 3 | 4 | 5;

export interface ResponseCodeDef {
  code: ResponseCode;
  label: string;
  shortLabel: string;
  lightsAndSiren: boolean;
  maxResponseMinutes: number;
  description: string;
}

export const RESPONSE_CODES: Record<ResponseCode, ResponseCodeDef> = {
  1: { code: 1, label: 'Emergency', shortLabel: 'EMG', lightsAndSiren: true, maxResponseMinutes: 8, description: 'Immediate threat to life — full emergency response with lights and siren' },
  2: { code: 2, label: 'Urgent', shortLabel: 'URG', lightsAndSiren: true, maxResponseMinutes: 15, description: 'Potential threat or in-progress incident — expedited response' },
  3: { code: 3, label: 'Routine', shortLabel: 'RTN', lightsAndSiren: false, maxResponseMinutes: 45, description: 'Non-emergency — standard patrol response without lights/siren' },
  4: { code: 4, label: 'Scheduled', shortLabel: 'SCH', lightsAndSiren: false, maxResponseMinutes: 1440, description: 'Pre-planned event or scheduled service — no time constraint' },
  5: { code: 5, label: 'Administrative', shortLabel: 'ADM', lightsAndSiren: false, maxResponseMinutes: 2880, description: 'Admin follow-up — no immediate response required' },
};

export function getResponseCode(code: number): ResponseCodeDef | undefined {
  return RESPONSE_CODES[code as ResponseCode];
}

export function responseCodeFromPriority(priority: string): ResponseCode {
  switch (priority) {
    case 'P1': return 1;
    case 'P2': return 2;
    case 'P3': return 3;
    case 'P4': return 4;
    default: return 3;
  }
}

/* ── FEATURE 2: Nature Code Classification ──────────────────
   Spillman Flex classifies every call by a nature-of-call code
   (NATURE) that determines the default response, required units,
   and safety advisories. */
export interface NatureCode {
  code: string;
  category: 'violent' | 'property' | 'traffic' | 'service' | 'admin' | 'other';
  label: string;
  defaultResponse: ResponseCode;
  minUnits: number;
  requiresBackup: boolean;
  requiresSupervisor: boolean;
  safetyTags: string[];
}

export const NATURE_CODES: Record<string, NatureCode> = {
  'ROBBERY_ARMED': { code: 'ROBBERY_ARMED', category: 'violent', label: 'Armed Robbery', defaultResponse: 1, minUnits: 3, requiresBackup: true, requiresSupervisor: true, safetyTags: ['armed', 'felony', 'officer_safety'] },
  'ROBBERY_STRONGARM': { code: 'ROBBERY_STRONGARM', category: 'violent', label: 'Strong-Arm Robbery', defaultResponse: 1, minUnits: 2, requiresBackup: true, requiresSupervisor: false, safetyTags: ['felony'] },
  'ASSAULT_AGG': { code: 'ASSAULT_AGG', category: 'violent', label: 'Aggravated Assault', defaultResponse: 1, minUnits: 2, requiresBackup: true, requiresSupervisor: true, safetyTags: ['armed', 'felony', 'officer_safety'] },
  'ASSAULT_SIMPLE': { code: 'ASSAULT_SIMPLE', category: 'violent', label: 'Simple Assault', defaultResponse: 2, minUnits: 1, requiresBackup: false, requiresSupervisor: false, safetyTags: [] },
  'DOMESTIC': { code: 'DOMESTIC', category: 'violent', label: 'Domestic Disturbance', defaultResponse: 2, minUnits: 2, requiresBackup: true, requiresSupervisor: false, safetyTags: ['domestic', 'officer_safety'] },
  'SHOTS_FIRED': { code: 'SHOTS_FIRED', category: 'violent', label: 'Shots Fired', defaultResponse: 1, minUnits: 4, requiresBackup: true, requiresSupervisor: true, safetyTags: ['armed', 'felony', 'officer_safety', 'active_threat'] },
  'PERSON_WITH_WEAPON': { code: 'PERSON_WITH_WEAPON', category: 'violent', label: 'Person with Weapon', defaultResponse: 1, minUnits: 2, requiresBackup: true, requiresSupervisor: true, safetyTags: ['armed', 'officer_safety', 'active_threat'] },
  'OFFICER_DOWN': { code: 'OFFICER_DOWN', category: 'violent', label: 'Officer Down', defaultResponse: 1, minUnits: 5, requiresBackup: true, requiresSupervisor: true, safetyTags: ['armed', 'felony', 'officer_safety', 'active_threat', 'all_available'] },
  'BURGLARY_IP': { code: 'BURGLARY_IP', category: 'property', label: 'Burglary In Progress', defaultResponse: 1, minUnits: 2, requiresBackup: true, requiresSupervisor: false, safetyTags: ['felony', 'officer_safety'] },
  'BURGLARY_REPORT': { code: 'BURGLARY_REPORT', category: 'property', label: 'Burglary Report', defaultResponse: 3, minUnits: 1, requiresBackup: false, requiresSupervisor: false, safetyTags: [] },
  'THEFT_IP': { code: 'THEFT_IP', category: 'property', label: 'Theft In Progress', defaultResponse: 2, minUnits: 1, requiresBackup: false, requiresSupervisor: false, safetyTags: [] },
  'THEFT_REPORT': { code: 'THEFT_REPORT', category: 'property', label: 'Theft Report', defaultResponse: 3, minUnits: 1, requiresBackup: false, requiresSupervisor: false, safetyTags: [] },
  'VANDALISM_IP': { code: 'VANDALISM_IP', category: 'property', label: 'Vandalism In Progress', defaultResponse: 2, minUnits: 1, requiresBackup: false, requiresSupervisor: false, safetyTags: [] },
  'VANDALISM_REPORT': { code: 'VANDALISM_REPORT', category: 'property', label: 'Vandalism Report', defaultResponse: 4, minUnits: 1, requiresBackup: false, requiresSupervisor: false, safetyTags: [] },
  'TRAFFIC_STOP': { code: 'TRAFFIC_STOP', category: 'traffic', label: 'Traffic Stop', defaultResponse: 3, minUnits: 1, requiresBackup: false, requiresSupervisor: false, safetyTags: [] },
  'TRAFFIC_HAZARD': { code: 'TRAFFIC_HAZARD', category: 'traffic', label: 'Traffic Hazard', defaultResponse: 2, minUnits: 1, requiresBackup: false, requiresSupervisor: false, safetyTags: [] },
  'ACCIDENT_INJURY': { code: 'ACCIDENT_INJURY', category: 'traffic', label: 'Accident with Injuries', defaultResponse: 1, minUnits: 2, requiresBackup: false, requiresSupervisor: false, safetyTags: ['ems_needed'] },
  'ACCIDENT_NO_INJURY': { code: 'ACCIDENT_NO_INJURY', category: 'traffic', label: 'Accident No Injuries', defaultResponse: 3, minUnits: 1, requiresBackup: false, requiresSupervisor: false, safetyTags: [] },
  'DUI': { code: 'DUI', category: 'traffic', label: 'DUI / Impaired Driver', defaultResponse: 2, minUnits: 1, requiresBackup: false, requiresSupervisor: false, safetyTags: [] },
  'RECOVERED_VEHICLE': { code: 'RECOVERED_VEHICLE', category: 'traffic', label: 'Recovered Stolen Vehicle', defaultResponse: 3, minUnits: 1, requiresBackup: false, requiresSupervisor: false, safetyTags: ['stolen'] },
  'WELFARE_CHECK': { code: 'WELFARE_CHECK', category: 'service', label: 'Welfare Check', defaultResponse: 3, minUnits: 1, requiresBackup: false, requiresSupervisor: false, safetyTags: [] },
  'MENTAL_HEALTH': { code: 'MENTAL_HEALTH', category: 'service', label: 'Mental Health Crisis', defaultResponse: 2, minUnits: 2, requiresBackup: true, requiresSupervisor: false, safetyTags: ['mental_health', 'officer_safety'] },
  'NOISE_COMPLAINT': { code: 'NOISE_COMPLAINT', category: 'service', label: 'Noise Complaint', defaultResponse: 4, minUnits: 1, requiresBackup: false, requiresSupervisor: false, safetyTags: [] },
  'TRESPASSING': { code: 'TRESPASSING', category: 'service', label: 'Trespassing', defaultResponse: 3, minUnits: 1, requiresBackup: false, requiresSupervisor: false, safetyTags: [] },
  'SUSPICIOUS_PERSON': { code: 'SUSPICIOUS_PERSON', category: 'service', label: 'Suspicious Person', defaultResponse: 3, minUnits: 1, requiresBackup: false, requiresSupervisor: false, safetyTags: [] },
  'SUSPICIOUS_VEHICLE': { code: 'SUSPICIOUS_VEHICLE', category: 'service', label: 'Suspicious Vehicle', defaultResponse: 3, minUnits: 1, requiresBackup: false, requiresSupervisor: false, safetyTags: [] },
  'PARKING_COMPLAINT': { code: 'PARKING_COMPLAINT', category: 'service', label: 'Parking Complaint', defaultResponse: 4, minUnits: 1, requiresBackup: false, requiresSupervisor: false, safetyTags: [] },
  'ANIMAL_COMPLAINT': { code: 'ANIMAL_COMPLAINT', category: 'service', label: 'Animal Complaint', defaultResponse: 4, minUnits: 1, requiresBackup: false, requiresSupervisor: false, safetyTags: [] },
  'CIVIL_STANDBY': { code: 'CIVIL_STANDBY', category: 'service', label: 'Civil Standby', defaultResponse: 4, minUnits: 1, requiresBackup: false, requiresSupervisor: false, safetyTags: [] },
  'ADMIN_REPORT': { code: 'ADMIN_REPORT', category: 'admin', label: 'Administrative Report', defaultResponse: 5, minUnits: 0, requiresBackup: false, requiresSupervisor: false, safetyTags: [] },
};

export function getNatureCode(code: string): NatureCode | undefined {
  return NATURE_CODES[code];
}

export function lookupNatureCode(code: string): NatureCode | undefined {
  return NATURE_CODES[code?.toUpperCase()];
}

export function natureCodesByCategory(category: NatureCode['category']): NatureCode[] {
  return Object.values(NATURE_CODES).filter(n => n.category === category);
}

/* ── FEATURE 3: Disposition Codes ───────────────────────────
   Spillman Flex requires a final disposition for every cleared
   call. These codes feed into UCR/NIBRS reporting. */
export interface DispositionCode {
  code: string;
  label: string;
  nibrsMapping: string;
  reportable: boolean;
  requiresReport: boolean;
}

export const DISPOSITION_CODES: Record<string, DispositionCode> = {
  'G': { code: 'G', label: 'Gone on Arrival', nibrsMapping: 'G', reportable: true, requiresReport: false },
  'R': { code: 'R', label: 'Report Taken', nibrsMapping: 'R', reportable: true, requiresReport: true },
  'A': { code: 'A', label: 'Arrest Made', nibrsMapping: 'A', reportable: true, requiresReport: true },
  'C': { code: 'C', label: 'Citation Issued', nibrsMapping: 'C', reportable: true, requiresReport: false },
  'W': { code: 'W', label: 'Warning Given', nibrsMapping: 'W', reportable: true, requiresReport: false },
  'U': { code: 'U', label: 'Unfounded', nibrsMapping: 'U', reportable: true, requiresReport: false },
  'D': { code: 'D', label: 'Duplicate Call', nibrsMapping: 'D', reportable: false, requiresReport: false },
  'T': { code: 'T', label: 'Transferred to Other Agency', nibrsMapping: 'T', reportable: true, requiresReport: false },
  'S': { code: 'S', label: 'Service Rendered', nibrsMapping: 'S', reportable: true, requiresReport: false },
  'N': { code: 'N', label: 'No Action Required', nibrsMapping: 'N', reportable: true, requiresReport: false },
  'F': { code: 'F', label: 'Follow-up Required', nibrsMapping: 'R', reportable: true, requiresReport: true },
  'O': { code: 'O', label: 'Other', nibrsMapping: 'O', reportable: true, requiresReport: false },
};

export function getDisposition(code: string): DispositionCode | undefined {
  return DISPOSITION_CODES[code?.toUpperCase()];
}

/* ── FEATURE 4: Clearance Type Classification ──────────────
   Spillman tracks exceptional vs standard clearance for
   UCR/NIBRS compliance. */
export type ClearanceType = 'standard' | 'exceptional' | 'unfounded' | 'administrative';

export interface ClearanceResult {
  type: ClearanceType;
  requiresDAReview: boolean;
  ucrCode: string;
  label: string;
}

export function classifyClearance(disposition: string, hasArrest: boolean, hasProsecutionDeclined: boolean): ClearanceResult {
  const dispCode = disposition?.toUpperCase();
  if (dispCode === 'A' || hasArrest) {
    return { type: 'standard', requiresDAReview: false, ucrCode: 'CLEARED_BY_ARREST', label: 'Cleared by Arrest' };
  }
  if (hasProsecutionDeclined) {
    return { type: 'exceptional', requiresDAReview: true, ucrCode: 'CLEARED_EXCEPTIONALLY', label: 'Exceptionally Cleared' };
  }
  if (dispCode === 'U' || dispCode === 'D') {
    return { type: 'unfounded', requiresDAReview: false, ucrCode: 'UNFOUNDED', label: 'Unfounded' };
  }
  return { type: 'administrative', requiresDAReview: false, ucrCode: 'ADMIN_CLOSED', label: 'Administratively Closed' };
}

/* ── FEATURE 5: Priority Escalation Rules ──────────────────
   Spillman Flex auto-escalates calls when certain threat
   indicators appear in narratives or linked records. */
export interface EscalationTrigger {
  keyword: string;
  newPriority: string;
  reason: string;
  requiresSupervisor: boolean;
}

export const ESCALATION_TRIGGERS: EscalationTrigger[] = [
  { keyword: 'weapon', newPriority: 'P1', reason: 'Weapon mentioned', requiresSupervisor: true },
  { keyword: 'gun', newPriority: 'P1', reason: 'Firearm mentioned', requiresSupervisor: true },
  { keyword: 'shots fired', newPriority: 'P1', reason: 'Shots fired reported', requiresSupervisor: true },
  { keyword: 'officer down', newPriority: 'P1', reason: 'Officer down', requiresSupervisor: true },
  { keyword: 'hostage', newPriority: 'P1', reason: 'Hostage situation', requiresSupervisor: true },
  { keyword: 'active shooter', newPriority: 'P1', reason: 'Active shooter', requiresSupervisor: true },
  { keyword: 'in progress', newPriority: 'P2', reason: 'Crime in progress', requiresSupervisor: false },
  { keyword: 'just occurred', newPriority: 'P2', reason: 'Incident just occurred', requiresSupervisor: false },
  { keyword: 'subject on scene', newPriority: 'P2', reason: 'Subject still on scene', requiresSupervisor: false },
  { keyword: 'suicidal', newPriority: 'P2', reason: 'Suicidal subject', requiresSupervisor: true },
  { keyword: 'barricaded', newPriority: 'P1', reason: 'Barricaded subject', requiresSupervisor: true },
];

export function checkPriorityEscalation(
  narrativeText: string,
  currentPriority: string
): { escalated: boolean; newPriority: string; reasons: string[] } {
  if (currentPriority === 'P1') return { escalated: false, newPriority: 'P1', reasons: [] };
  const lower = narrativeText.toLowerCase();
  const reasons: string[] = [];
  let highestPriority = currentPriority;

  for (const trigger of ESCALATION_TRIGGERS) {
    if (lower.includes(trigger.keyword)) {
      reasons.push(trigger.reason);
      const priorityRank = { P1: 4, P2: 3, P3: 2, P4: 1 };
      if (priorityRank[trigger.newPriority as keyof typeof priorityRank] > priorityRank[highestPriority as keyof typeof priorityRank]) {
        highestPriority = trigger.newPriority;
      }
    }
  }

  return { escalated: highestPriority !== currentPriority, newPriority: highestPriority, reasons };
}

/* ── FEATURE 6: Call Type Auto-Classification ──────────────
   Spillman automatically classifies calls by their attributes
   to determine routing and response requirements. */
export interface CallClassification {
  type: 'emergency' | 'in_progress' | 'report' | 'service' | 'admin';
  requiresImmediateResponse: boolean;
  requiresBackup: boolean;
  requiresSupervisor: boolean;
  estimatedDuration: number; // minutes
  reportRequired: boolean;
}

export function classifyCall(natureCode: string, priority: string, hasWeapons: boolean, isInProgress: boolean): CallClassification {
  const nature = lookupNatureCode(natureCode);

  if (priority === 'P1') {
    return {
      type: 'emergency',
      requiresImmediateResponse: true,
      requiresBackup: true,
      requiresSupervisor: true,
      estimatedDuration: 120,
      reportRequired: true,
    };
  }

  if (isInProgress) {
    return {
      type: 'in_progress',
      requiresImmediateResponse: true,
      requiresBackup: nature?.requiresBackup || hasWeapons,
      requiresSupervisor: nature?.requiresSupervisor || false,
      estimatedDuration: 60,
      reportRequired: nature?.category === 'violent' || nature?.category === 'property',
    };
  }

  if (priority === 'P2') {
    return {
      type: 'report',
      requiresImmediateResponse: false,
      requiresBackup: hasWeapons,
      requiresSupervisor: false,
      estimatedDuration: 45,
      reportRequired: nature?.category === 'violent',
    };
  }

  return {
    type: 'service',
    requiresImmediateResponse: false,
    requiresBackup: false,
    requiresSupervisor: false,
    estimatedDuration: 30,
    reportRequired: false,
  };
}

/* ── FEATURE 7: Location Verification ───────────────────────
   Spillman Flex validates call locations against the geography
   hierarchy and flags out-of-jurisdiction or unverified addresses. */
export interface LocationVerification {
  verified: boolean;
  inJurisdiction: boolean;
  matchedZone: string | null;
  matchedBeat: string | null;
  needsGeocoding: boolean;
  confidence: 'high' | 'medium' | 'low' | 'none';
  warnings: string[];
}

export function verifyLocation(
  latitude: number | null,
  longitude: number | null,
  jurisdictionBounds: { north: number; south: number; east: number; west: number } | null,
  zoneMap: Array<{ id: string; name: string; north: number; south: number; east: number; west: number }>
): LocationVerification {
  const warnings: string[] = [];
  let matchedZone: string | null = null;
  let matchedBeat: string | null = null;

  if (!latitude || !longitude) {
    return { verified: false, inJurisdiction: false, matchedZone: null, matchedBeat: null, needsGeocoding: true, confidence: 'none', warnings: ['No coordinates provided — geocoding required'] };
  }

  let inJurisdiction = true;
  if (jurisdictionBounds) {
    const { north, south, east, west } = jurisdictionBounds;
    if (latitude > north || latitude < south || longitude > east || longitude < west) {
      inJurisdiction = false;
      warnings.push('Location outside agency jurisdiction');
    }
  }

  for (const zone of zoneMap) {
    if (latitude <= zone.north && latitude >= zone.south && longitude <= zone.east && longitude >= zone.west) {
      matchedZone = zone.name;
      break;
    }
  }

  if (!matchedZone) {
    warnings.push('Location does not match any known zone/beat');
  }

  return {
    verified: !!matchedZone,
    inJurisdiction,
    matchedZone,
    matchedBeat: null,
    needsGeocoding: false,
    confidence: matchedZone ? 'high' : 'low',
    warnings,
  };
}

/* ── FEATURE 8: Response Plan Generation ────────────────────
   Spillman Flex generates a response plan based on call
   classification — number of units, required specialties,
   equipment recommendations, and staging instructions. */
export interface ResponsePlan {
  primaryUnits: number;
  backupUnits: number;
  requiredSpecialties: string[];
  recommendedEquipment: string[];
  stagingLocation: string | null;
  perimeterRequired: boolean;
  emsRequired: boolean;
  fireRequired: boolean;
  commandPostRequired: boolean;
  instructions: string[];
}

export function generateResponsePlan(classification: CallClassification, nature: NatureCode | undefined): ResponsePlan {
  const plan: ResponsePlan = {
    primaryUnits: nature?.minUnits || 1,
    backupUnits: 0,
    requiredSpecialties: [],
    recommendedEquipment: [],
    stagingLocation: null,
    perimeterRequired: false,
    emsRequired: false,
    fireRequired: false,
    commandPostRequired: false,
    instructions: [],
  };

  switch (classification.type) {
    case 'emergency':
      plan.backupUnits = 2;
      plan.perimeterRequired = true;
      plan.commandPostRequired = true;
      plan.recommendedEquipment.push('rifle', 'less_lethal', 'shield', 'breaching_tools');
      plan.instructions.push('Establish perimeter immediately', 'Stage additional units at safe distance', 'Designate command post', 'Coordinate with EMS staging');
      break;
    case 'in_progress':
      plan.backupUnits = 1;
      plan.recommendedEquipment.push('less_lethal');
      plan.instructions.push('Approach with caution', 'Request backup if subject is armed', 'Establish containment if possible');
      break;
    case 'report':
      plan.instructions.push('Standard patrol response', 'No lights or siren unless upgraded');
      break;
    default:
      plan.instructions.push('Routine response', 'Coordinate with caller for access if needed');
  }

  if (nature?.safetyTags.includes('armed')) {
    plan.backupUnits = Math.max(plan.backupUnits, 2);
    plan.recommendedEquipment.push('rifle', 'ballistic_shield');
    plan.instructions.push('WEAPON ALERT: Subject may be armed — approach with extreme caution');
  }

  if (nature?.safetyTags.includes('ems_needed')) {
    plan.emsRequired = true;
    plan.instructions.push('Request EMS response');
  }

  if (nature?.safetyTags.includes('all_available')) {
    plan.primaryUnits = 99;
    plan.instructions.push('ALL AVAILABLE UNITS RESPOND — OFFICER DOWN');
  }

  return plan;
}

/* ── FEATURE 9: Time Compliance Tracking ───────────────────
   Spillman Flex tracks whether response times meet agency
   standards and flags non-compliant responses for review. */
export interface TimeCompliance {
  dispatchTime: number;          // seconds from call creation to dispatch
  enrouteTime: number;           // seconds from dispatch to enroute
  travelTime: number;            // seconds from enroute to onscene
  sceneTime: number;             // seconds from onscene to cleared
  totalResponseTime: number;     // seconds from call creation to onscene
  dispatchCompliant: boolean;    // dispatch within standard
  responseCompliant: boolean;    // onscene within standard
  sceneCompliant: boolean;       // cleared within standard
  overallCompliant: boolean;
  standardMinutes: number;       // agency standard for this priority
}

export function checkTimeCompliance(
  createdAt: Date,
  dispatchedAt: Date | null,
  enrouteAt: Date | null,
  onsceneAt: Date | null,
  clearedAt: Date | null,
  priority: string
): TimeCompliance {
  const now = new Date();
  const dispatchTime = dispatchedAt ? (dispatchedAt.getTime() - createdAt.getTime()) / 1000 : 0;
  const enrouteTime = dispatchedAt && enrouteAt ? (enrouteAt.getTime() - dispatchedAt.getTime()) / 1000 : 0;
  const travelTime = enrouteAt && onsceneAt ? (onsceneAt.getTime() - enrouteAt.getTime()) / 1000 : 0;
  const sceneTime = onsceneAt && clearedAt ? (clearedAt.getTime() - onsceneAt.getTime()) / 1000 : 0;
  const totalResponseTime = onsceneAt ? (onsceneAt.getTime() - createdAt.getTime()) / 1000 : (now.getTime() - createdAt.getTime()) / 1000;

  const standardMinutes = priority === 'P1' ? 8 : priority === 'P2' ? 15 : priority === 'P3' ? 45 : 1440;
  const standardSeconds = standardMinutes * 60;

  const dispatchStandard = priority === 'P1' ? 120 : priority === 'P2' ? 300 : 600;
  const sceneStandard = priority === 'P1' ? 2700 : priority === 'P2' ? 7200 : 14400;

  return {
    dispatchTime: Math.round(dispatchTime),
    enrouteTime: Math.round(enrouteTime),
    travelTime: Math.round(travelTime),
    sceneTime: Math.round(sceneTime),
    totalResponseTime: Math.round(totalResponseTime),
    dispatchCompliant: dispatchTime <= dispatchStandard,
    responseCompliant: totalResponseTime <= standardSeconds,
    sceneCompliant: sceneTime <= sceneStandard,
    overallCompliant: dispatchTime <= dispatchStandard && totalResponseTime <= standardSeconds,
    standardMinutes,
  };
}

/* ── FEATURE 10: Unit Specialty Matching ────────────────────
   Spillman Flex matches call requirements against officer
   specialties to ensure the right unit gets dispatched. */
export interface UnitSpecialty {
  code: string;
  label: string;
  requiredTraining: string[];
}

export const UNIT_SPECIALTIES: Record<string, UnitSpecialty> = {
  K9: { code: 'K9', label: 'K-9 Unit', requiredTraining: ['K9_HANDLER'] },
  SWAT: { code: 'SWAT', label: 'SWAT', requiredTraining: ['SWAT_BASIC', 'SWAT_ADVANCED'] },
  NEGOTIATOR: { code: 'NEGOTIATOR', label: 'Crisis Negotiator', requiredTraining: ['CRISIS_NEGOTIATION'] },
  MOTOR: { code: 'MOTOR', label: 'Motorcycle Unit', requiredTraining: ['MOTORCYCLE_CERT'] },
  MARINE: { code: 'MARINE', label: 'Marine Unit', requiredTraining: ['MARINE_OPERATIONS'] },
  DRONE: { code: 'DRONE', label: 'Drone Operator', requiredTraining: ['DRONE_PILOT'] },
  DRE: { code: 'DRE', label: 'Drug Recognition Expert', requiredTraining: ['DRE_CERTIFIED'] },
  FI: { code: 'FI', label: 'Field Instructor', requiredTraining: ['FTO_CERTIFIED'] },
  CSI: { code: 'CSI', label: 'Crime Scene Investigator', requiredTraining: ['CSI_BASIC'] },
  ACCIDENT: { code: 'ACCIDENT', label: 'Accident Reconstruction', requiredTraining: ['ACCIDENT_RECON'] },
  BILINGUAL: { code: 'BILINGUAL', label: 'Bilingual Officer', requiredTraining: [] },
  BIKE: { code: 'BIKE', label: 'Bike Patrol', requiredTraining: ['BIKE_CERT'] },
};

export function matchSpecialties(
  requiredSpecialties: string[],
  availableOfficers: Array<{ id: string; callSign: string; specialties: string[]; status: string }>
): Array<{ officer: { id: string; callSign: string; specialties: string[] }; matchedSpecialties: string[]; score: number }> {
  return availableOfficers
    .filter(o => o.status === 'available')
    .map(o => {
      const matched = requiredSpecialties.filter(s => o.specialties.includes(s));
      return { officer: { id: o.id, callSign: o.callSign, specialties: o.specialties }, matchedSpecialties: matched, score: matched.length };
    })
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score);
}

/* ── Helper: format seconds to mm:ss ────────────────────── */
export function formatSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

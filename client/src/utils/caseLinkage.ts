// ============================================================
// RMPG Flex — Case Linkage Analyzer (Spillman Flex Standard)
// 10 case management features: case relationship mapping,
// MO pattern matching, suspect linkage scoring, vehicle
// association analysis, cross-jurisdictional case linking,
// informant management, case priority scoring, workload
// distribution, statute of limitations tracking, and case
// aging analysis.
// ============================================================

/* ── FEATURE 51: Case Relationship Mapping ─────────────────
   Spillman Flex identifies and visualizes relationships
   between cases through shared persons, vehicles, locations,
   and modus operandi patterns. */
export interface CaseRelationship {
  caseA: string;
  caseB: string;
  linkType: 'shared_person' | 'shared_vehicle' | 'shared_location' | 'shared_property' | 'similar_mo' | 'time_proximity' | 'geographic_proximity' | 'investigator_link';
  strength: 'strong' | 'moderate' | 'weak';
  detail: string;
  score: number;
}

export function analyzeCaseRelationships(
  cases: Array<{
    id: string;
    caseNumber: string;
    persons: string[];
    vehicles: string[];
    location: { lat: number; lng: number } | null;
    natureCode: string;
    moDescription: string;
    occurredAt: string;
    investigatorId: string;
  }>
): CaseRelationship[] {
  const relationships: CaseRelationship[] = [];

  for (let i = 0; i < cases.length; i++) {
    for (let j = i + 1; j < cases.length; j++) {
      const a = cases[i];
      const b = cases[j];

      // Shared persons
      const sharedPersons = a.persons.filter(p => b.persons.includes(p));
      if (sharedPersons.length > 0) {
        relationships.push({
          caseA: a.caseNumber, caseB: b.caseNumber,
          linkType: 'shared_person',
          strength: 'strong',
          detail: `Linked by ${sharedPersons.length} shared person(s): ${sharedPersons.join(', ')}`,
          score: 90,
        });
      }

      // Shared vehicles
      const sharedVehicles = a.vehicles.filter(v => b.vehicles.includes(v));
      if (sharedVehicles.length > 0) {
        relationships.push({
          caseA: a.caseNumber, caseB: b.caseNumber,
          linkType: 'shared_vehicle',
          strength: 'strong',
          detail: `Linked by ${sharedVehicles.length} shared vehicle(s)`,
          score: 85,
        });
      }

      // Geographic proximity
      if (a.location && b.location) {
        const dist = haversineMiles(a.location.lat, a.location.lng, b.location.lat, b.location.lng);
        if (dist < 0.5) {
          relationships.push({
            caseA: a.caseNumber, caseB: b.caseNumber,
            linkType: 'geographic_proximity',
            strength: dist < 0.1 ? 'strong' : 'moderate',
            detail: `Locations within ${dist.toFixed(1)} miles`,
            score: dist < 0.1 ? 70 : 40,
          });
        }
      }

      // Same investigator
      if (a.investigatorId === b.investigatorId) {
        relationships.push({
          caseA: a.caseNumber, caseB: b.caseNumber,
          linkType: 'investigator_link',
          strength: 'weak',
          detail: 'Same assigned investigator',
          score: 10,
        });
      }

      // Similar MO
      const aWords = new Set(a.moDescription.toLowerCase().split(/\W+/).filter(w => w.length > 3));
      const bWords = new Set(b.moDescription.toLowerCase().split(/\W+/).filter(w => w.length > 3));
      const overlap = [...aWords].filter(w => bWords.has(w));
      if (overlap.length >= 4) {
        relationships.push({
          caseA: a.caseNumber, caseB: b.caseNumber,
          linkType: 'similar_mo',
          strength: overlap.length >= 6 ? 'strong' : 'moderate',
          detail: `Similar MO: ${overlap.slice(0, 5).join(', ')}`,
          score: Math.min(80, overlap.length * 12),
        });
      }

      // Time proximity (within 7 days)
      const aTime = new Date(a.occurredAt).getTime();
      const bTime = new Date(b.occurredAt).getTime();
      const daysApart = Math.abs(aTime - bTime) / 86400000;
      if (daysApart < 7) {
        relationships.push({
          caseA: a.caseNumber, caseB: b.caseNumber,
          linkType: 'time_proximity',
          strength: daysApart < 1 ? 'moderate' : 'weak',
          detail: `Occurred within ${daysApart.toFixed(0)} days`,
          score: Math.max(5, 30 - daysApart * 4),
        });
      }
    }
  }

  return relationships.sort((a, b) => b.score - a.score);
}

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3959;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* ── FEATURE 52: MO Pattern Matching ───────────────────────
   Spillman Flex identifies cases with similar modus operandi
   patterns for serial crime investigation. */
export interface MoPattern {
  patternId: string;
  crimeType: string;
  entryMethod: string | null;
  targetType: string | null;
  timeOfDay: string | null;
  dayOfWeek: string | null;
  weaponUsed: string | null;
  propertyTargeted: string[];
  suspectDescription: string | null;
  vehicleDescription: string | null;
  linkedCases: string[];
  confidence: number;
  geographicCenter: { lat: number; lng: number } | null;
}

export function detectMoPatterns(
  cases: Array<{
    id: string;
    caseNumber: string;
    natureCode: string;
    entryMethod: string | null;
    timeOfDay: string | null;
    weaponUsed: string | null;
    suspectDescription: string | null;
    vehicleDescription: string | null;
    latitude: number | null;
    longitude: number | null;
  }>
): MoPattern[] {
  const patterns: MoPattern[] = [];
  const byCrimeType = new Map<string, typeof cases>();

  for (const c of cases) {
    if (!byCrimeType.has(c.natureCode)) byCrimeType.set(c.natureCode, []);
    byCrimeType.get(c.natureCode)!.push(c);
  }

  for (const [crimeType, crimeCases] of byCrimeType.entries()) {
    if (crimeCases.length < 2) continue;

    // Group by entry method + time of day
    const byMo = new Map<string, typeof cases>();
    for (const c of crimeCases) {
      const key = `${c.entryMethod || 'any'}::${c.timeOfDay || 'any'}::${c.weaponUsed || 'none'}`;
      if (!byMo.has(key)) byMo.set(key, []);
      byMo.get(key)!.push(c);
    }

    for (const [key, moCases] of byMo.entries()) {
      if (moCases.length < 2) continue;
      const [entryMethod, timeOfDay, weaponUsed] = key.split('::');

      const lats = moCases.filter(c => c.latitude).map(c => c.latitude!);
      const lngs = moCases.filter(c => c.longitude).map(c => c.longitude!);
      const geographicCenter = lats.length > 0 ? {
        lat: lats.reduce((s, v) => s + v, 0) / lats.length,
        lng: lngs.reduce((s, v) => s + v, 0) / lngs.length,
      } : null;

      patterns.push({
        patternId: `mo-${crimeType}-${entryMethod}`,
        crimeType,
        entryMethod: entryMethod === 'any' ? null : entryMethod,
        targetType: null,
        timeOfDay: timeOfDay === 'any' ? null : timeOfDay,
        dayOfWeek: null,
        weaponUsed: weaponUsed === 'none' ? null : weaponUsed,
        propertyTargeted: [],
        suspectDescription: null,
        vehicleDescription: null,
        linkedCases: moCases.map(c => c.caseNumber),
        confidence: Math.min(95, 50 + moCases.length * 10),
        geographicCenter,
      });
    }
  }

  return patterns.sort((a, b) => b.confidence - a.confidence);
}

/* ── FEATURE 53: Suspect Linkage Scoring ───────────────────
   Spillman Flex calculates a linkage score between suspects
   and open cases based on multiple association factors. */
export interface SuspectLinkageScore {
  suspectId: string;
  suspectName: string;
  caseNumber: string;
  factors: Array<{ factor: string; weight: number; evidence: string }>;
  totalScore: number;
  recommendation: 'investigate' | 'monitor' | 'low_priority' | 'no_link';
}

export function scoreSuspectLinkage(
  suspect: {
    id: string;
    name: string;
    knownAddresses: string[];
    knownVehicles: string[];
    priorOffenses: string[];
    gangAffiliation: string | null;
    probationStatus: string | null;
  },
  caseData: {
    caseNumber: string;
    location: string;
    vehiclesInvolved: string[];
    offenseType: string;
    suspectDescription: string;
    evidenceDNA: boolean;
    evidenceFingerprints: boolean;
  }
): SuspectLinkageScore {
  const factors: Array<{ factor: string; weight: number; evidence: string }> = [];
  let totalScore = 0;

  // Address proximity
  const suspectAddressMatch = suspect.knownAddresses.some(addr => caseData.location.toLowerCase().includes(addr.toLowerCase()));
  if (suspectAddressMatch) { factors.push({ factor: 'Address Match', weight: 40, evidence: `Suspect address matches case location` }); totalScore += 40; }

  // Vehicle match
  const vehicleMatch = suspect.knownVehicles.some(v => caseData.vehiclesInvolved.some(cv => cv.toLowerCase().includes(v.toLowerCase())));
  if (vehicleMatch) { factors.push({ factor: 'Vehicle Match', weight: 35, evidence: `Suspect vehicle linked to case` }); totalScore += 35; }

  // Prior similar offenses
  const offenseMatch = suspect.priorOffenses.some(o => o.toLowerCase().includes(caseData.offenseType.toLowerCase()));
  if (offenseMatch) { factors.push({ factor: 'Prior Similar Offense', weight: 25, evidence: `Suspect has prior ${caseData.offenseType} offenses` }); totalScore += 25; }

  // Gang affiliation
  if (suspect.gangAffiliation && caseData.suspectDescription.toLowerCase().includes('gang')) {
    factors.push({ factor: 'Gang Connection', weight: 15, evidence: `Suspect gang: ${suspect.gangAffiliation}` }); totalScore += 15;
  }

  // Probation status
  if (suspect.probationStatus === 'active') {
    factors.push({ factor: 'Active Probation', weight: 10, evidence: 'Suspect is on active probation' }); totalScore += 10;
  }

  // Physical evidence availability
  if (caseData.evidenceDNA) { factors.push({ factor: 'DNA Evidence', weight: 20, evidence: 'DNA evidence available for comparison' }); totalScore += 20; }
  if (caseData.evidenceFingerprints) { factors.push({ factor: 'Fingerprint Evidence', weight: 20, evidence: 'Fingerprint evidence available for comparison' }); totalScore += 20; }

  let recommendation: SuspectLinkageScore['recommendation'] = 'no_link';
  if (totalScore >= 50) recommendation = 'investigate';
  else if (totalScore >= 30) recommendation = 'monitor';
  else if (totalScore >= 15) recommendation = 'low_priority';

  return { suspectId: suspect.id, suspectName: suspect.name, caseNumber: caseData.caseNumber, factors, totalScore, recommendation };
}

/* ── FEATURE 54: Vehicle Association Analysis ──────────────
   Spillman Flex links vehicles across multiple cases and
   identifies patterns of vehicle usage in criminal activity. */
export interface VehicleAssociation {
  vehicleId: string;
  plate: string;
  vin: string | null;
  make: string;
  model: string;
  color: string;
  linkedCases: Array<{ caseNumber: string; role: string; date: string }>;
  totalCases: number;
  flaggedAsSuspicious: boolean;
  ownerInfo: { name: string; address: string } | null;
}

export function analyzeVehicleAssociations(
  vehicles: Array<{
    id: string;
    plate: string;
    vin: string | null;
    make: string;
    model: string;
    color: string;
    caseLinks: Array<{ caseNumber: string; role: string; date: string }>;
  }>
): VehicleAssociation[] {
  return vehicles
    .filter(v => v.caseLinks.length > 0)
    .map(v => ({
      vehicleId: v.id,
      plate: v.plate,
      vin: v.vin,
      make: v.make,
      model: v.model,
      color: v.color,
      linkedCases: v.caseLinks,
      totalCases: v.caseLinks.length,
      flaggedAsSuspicious: v.caseLinks.length >= 3,
      ownerInfo: null,
    }))
    .sort((a, b) => b.totalCases - a.totalCases);
}

/* ── FEATURE 55: Informant Management ──────────────────────
   Spillman Flex tracks confidential informant relationships,
   reliability ratings, and payment history. */
export interface InformantProfile {
  id: string;
  codeName: string;
  reliability: 'unknown' | 'unreliable' | 'somewhat_reliable' | 'reliable' | 'very_reliable';
  activeCases: string[];
  totalTips: number;
  tipsResultingInArrest: number;
  lastContact: Date | null;
  status: 'active' | 'inactive' | 'terminated';
  handlerId: string;
  paymentTotal: number;
  notes: string;
}

export function rateInformantReliability(
  informant: InformantProfile
): { rating: number; label: string; canUseForWarrant: boolean } {
  if (informant.totalTips === 0) {
    return { rating: 0, label: 'New informant — reliability unknown', canUseForWarrant: false };
  }

  const successRate = informant.tipsResultingInArrest / informant.totalTips;
  let rating: number;
  let label: string;
  let canUseForWarrant = false;

  if (successRate >= 0.8) {
    rating = 5; label = 'Very Reliable'; canUseForWarrant = true;
  } else if (successRate >= 0.6) {
    rating = 4; label = 'Reliable'; canUseForWarrant = true;
  } else if (successRate >= 0.4) {
    rating = 3; label = 'Somewhat Reliable'; canUseForWarrant = false;
  } else if (successRate >= 0.2) {
    rating = 2; label = 'Unreliable'; canUseForWarrant = false;
  } else {
    rating = 1; label = 'Very Unreliable'; canUseForWarrant = false;
  }

  return { rating, label, canUseForWarrant };
}

/* ── FEATURE 56: Case Priority Scoring ─────────────────────
   Spillman Flex calculates a dynamic priority score for each
   case based on solvability factors and public safety risk. */
export interface CasePriorityScore {
  caseNumber: string;
  solvabilityScore: number;     // 0-100
  publicSafetyRisk: number;     // 0-100
  overallPriority: number;      // 0-100 weighted
  tier: 'tier1' | 'tier2' | 'tier3' | 'tier4';
  factors: Array<{ factor: string; impact: 'positive' | 'negative'; score: number }>;
}

export function scoreCasePriority(
  caseData: {
    caseNumber: string;
    hasSuspectIdentified: boolean;
    hasWitnesses: boolean;
    hasPhysicalEvidence: boolean;
    hasVideoEvidence: boolean;
    hasDNA: boolean;
    hasFingerprints: boolean;
    crimeType: string;
    isViolent: boolean;
    hasInjuries: boolean;
    weaponUsed: boolean;
    daysSinceIncident: number;
    suspectAtLarge: boolean;
  }
): CasePriorityScore {
  const factors: CasePriorityScore['factors'] = [];
  let solvability = 0;

  if (caseData.hasSuspectIdentified) { factors.push({ factor: 'Suspect Identified', impact: 'positive', score: 25 }); solvability += 25; }
  if (caseData.hasWitnesses) { factors.push({ factor: 'Witnesses Available', impact: 'positive', score: 15 }); solvability += 15; }
  if (caseData.hasPhysicalEvidence) { factors.push({ factor: 'Physical Evidence', impact: 'positive', score: 15 }); solvability += 15; }
  if (caseData.hasVideoEvidence) { factors.push({ factor: 'Video Evidence', impact: 'positive', score: 20 }); solvability += 20; }
  if (caseData.hasDNA) { factors.push({ factor: 'DNA Evidence', impact: 'positive', score: 20 }); solvability += 20; }
  if (caseData.hasFingerprints) { factors.push({ factor: 'Fingerprint Evidence', impact: 'positive', score: 15 }); solvability += 15; }

  if (caseData.daysSinceIncident > 30) { factors.push({ factor: `Cold Case (${caseData.daysSinceIncident}d)`, impact: 'negative', score: -15 }); solvability -= 15; }
  if (!caseData.hasSuspectIdentified) { factors.push({ factor: 'No Suspect', impact: 'negative', score: -10 }); solvability -= 10; }

  let publicSafety = 0;
  if (caseData.isViolent) { publicSafety += 40; }
  if (caseData.hasInjuries) { publicSafety += 20; }
  if (caseData.weaponUsed) { publicSafety += 20; }
  if (caseData.suspectAtLarge) { publicSafety += 20; }

  solvability = Math.max(0, Math.min(100, solvability));
  publicSafety = Math.max(0, Math.min(100, publicSafety));

  const overallPriority = Math.round(solvability * 0.4 + publicSafety * 0.6);

  let tier: CasePriorityScore['tier'] = 'tier4';
  if (overallPriority >= 75) tier = 'tier1';
  else if (overallPriority >= 50) tier = 'tier2';
  else if (overallPriority >= 25) tier = 'tier3';

  return { caseNumber: caseData.caseNumber, solvabilityScore: solvability, publicSafetyRisk: publicSafety, overallPriority, tier, factors };
}

/* ── FEATURE 57: Workload Distribution ─────────────────────
   Spillman Flex balances case assignments across investigators
   based on caseload, case complexity, and specialization. */
export interface InvestigatorWorkload {
  investigatorId: string;
  name: string;
  activeCases: number;
  totalCases: number;
  highPriorityCases: number;
  avgCaseAge: number;
  clearanceRate: number;
  workloadScore: number; // 0-100, higher = overloaded
  specialty: string[];
}

export function distributeWorkload(
  investigators: InvestigatorWorkload[],
  unassignedCases: Array<{ caseNumber: string; priority: string; crimeType: string; complexity: number }>,
  maxCaseThreshold: number = 25
): Array<{ caseNumber: string; assignedTo: string; reason: string }> {
  const assignments: Array<{ caseNumber: string; assignedTo: string; reason: string }> = [];

  for (const c of unassignedCases) {
    // Sort investigators by workload score (ascending) but prefer specialty match
    const sorted = [...investigators]
      .filter(i => i.activeCases < maxCaseThreshold)
      .sort((a, b) => {
        const aSpecialty = a.specialty.some(s => c.crimeType.toLowerCase().includes(s.toLowerCase())) ? -10 : 0;
        const bSpecialty = b.specialty.some(s => c.crimeType.toLowerCase().includes(s.toLowerCase())) ? -10 : 0;
        return (a.workloadScore + aSpecialty) - (b.workloadScore + bSpecialty);
      });

    if (sorted.length > 0) {
      const assignee = sorted[0];
      assignments.push({ caseNumber: c.caseNumber, assignedTo: assignee.investigatorId, reason: `Lowest workload (${assignee.activeCases} cases)${assignee.specialty.some(s => c.crimeType.toLowerCase().includes(s.toLowerCase())) ? ' + specialty match' : ''}` });
      assignee.activeCases++;
    }
  }

  return assignments;
}

/* ── FEATURE 58: Statute of Limitations Tracker ────────────
   Spillman Flex tracks approaching statute of limitations
   deadlines and alerts investigators before cases expire. */
export interface SolTracker {
  caseNumber: string;
  offenseType: string;
  solYears: number;
  incidentDate: Date;
  expirationDate: Date;
  daysRemaining: number;
  urgency: 'expired' | 'critical' | 'warning' | 'normal';
  tolled: boolean;
  tolledReason: string | null;
}

export const STATUTE_LIMITATIONS: Record<string, number> = {
  murder: 99,
  manslaughter: 99,
  kidnapping: 99,
  felony_sexual_assault: 99,
  felony_violent: 10,
  felony_property: 5,
  felony_fraud: 5,
  misdemeanor_violent: 2,
  misdemeanor: 1,
  traffic: 1,
  infraction: 0.5,
};

export function trackStatuteOfLimitations(
  cases: Array<{ caseNumber: string; offenseType: string; incidentDate: string; tolled: boolean; tolledReason: string | null }>
): SolTracker[] {
  return cases.map(c => {
    const solYears = STATUTE_LIMITATIONS[c.offenseType] || 5;
    const incidentDate = new Date(c.incidentDate);
    const expirationDate = new Date(incidentDate);
    if (!c.tolled) {
      expirationDate.setFullYear(expirationDate.getFullYear() + solYears);
    }
    const daysRemaining = Math.ceil((expirationDate.getTime() - Date.now()) / 86400000);

    let urgency: SolTracker['urgency'] = 'normal';
    if (daysRemaining < 0) urgency = 'expired';
    else if (daysRemaining < 30) urgency = 'critical';
    else if (daysRemaining < 90) urgency = 'warning';

    return { caseNumber: c.caseNumber, offenseType: c.offenseType, solYears, incidentDate, expirationDate, daysRemaining, urgency, tolled: c.tolled, tolledReason: c.tolledReason };
  }).sort((a, b) => a.daysRemaining - b.daysRemaining);
}

/* ── FEATURE 59: Case Aging Analysis ───────────────────────
   Spillman Flex analyzes how long cases have been open and
   identifies bottlenecks in the investigation process. */
export interface CaseAging {
  caseNumber: string;
  daysOpen: number;
  daysSinceLastActivity: number;
  lastActivityType: string | null;
  agingStage: 'fresh' | 'active' | 'aging' | 'stagnant' | 'cold';
  recommendedAction: string;
}

export function analyzeCaseAging(
  cases: Array<{
    caseNumber: string;
    openedAt: string;
    lastActivityAt: string | null;
    lastActivityType: string | null;
    hasSuspect: boolean;
    hasArrest: boolean;
  }>
): CaseAging[] {
  const now = Date.now();

  return cases
    .filter(c => !c.hasArrest)
    .map(c => {
      const daysOpen = Math.ceil((now - new Date(c.openedAt).getTime()) / 86400000);
      const daysSinceLastActivity = c.lastActivityAt ? Math.ceil((now - new Date(c.lastActivityAt).getTime()) / 86400000) : daysOpen;

      let agingStage: CaseAging['agingStage'] = 'fresh';
      let recommendedAction = '';

      if (daysOpen < 7) {
        agingStage = 'fresh';
        recommendedAction = 'Active investigation phase — gather evidence and interview witnesses';
      } else if (daysOpen < 30) {
        agingStage = 'active';
        recommendedAction = c.hasSuspect ? 'Focus on suspect apprehension' : 'Expand canvass, review surveillance footage';
      } else if (daysOpen < 90) {
        agingStage = 'aging';
        recommendedAction = 'Review case for additional leads. Consider crime analyst review.';
      } else if (daysSinceLastActivity < 60) {
        agingStage = 'stagnant';
        recommendedAction = `No activity in ${daysSinceLastActivity} days. Schedule case review with supervisor.`;
      } else {
        agingStage = 'cold';
        recommendedAction = `Cold case — ${daysOpen} days open. Consider cold case unit review.`;
      }

      return { caseNumber: c.caseNumber, daysOpen, daysSinceLastActivity, lastActivityType: c.lastActivityType, agingStage, recommendedAction };
    })
    .sort((a, b) => b.daysOpen - a.daysOpen);
}

/* ── FEATURE 60: Cross-Jurisdictional Case Linking ─────────
   Spillman Flex identifies cases in neighboring jurisdictions
   that may be related to local cases. */
export interface CrossJurisdictionLink {
  localCaseNumber: string;
  externalAgency: string;
  externalCaseNumber: string;
  linkType: string;
  sharedElements: string[];
  confidence: number;
  contactInfo: string;
}

export function suggestCrossJurisdictionLinks(
  localCases: Array<{ caseNumber: string; suspectName: string | null; vehiclePlate: string | null; moDescription: string; offenseType: string }>,
  externalCases: Array<{ agency: string; caseNumber: string; suspectName: string | null; vehiclePlate: string | null; moDescription: string; offenseType: string; contactPhone: string }>
): CrossJurisdictionLink[] {
  const links: CrossJurisdictionLink[] = [];

  for (const local of localCases) {
    for (const ext of externalCases) {
      const sharedElements: string[] = [];
      let confidence = 0;

      if (local.suspectName && ext.suspectName && local.suspectName.toLowerCase() === ext.suspectName.toLowerCase()) {
        sharedElements.push('Same suspect name'); confidence += 50;
      }
      if (local.vehiclePlate && ext.vehiclePlate && local.vehiclePlate.toLowerCase() === ext.vehiclePlate.toLowerCase()) {
        sharedElements.push('Same vehicle plate'); confidence += 40;
      }
      if (local.offenseType === ext.offenseType) {
        sharedElements.push('Same offense type'); confidence += 10;
      }

      const localWords = local.moDescription.toLowerCase().split(/\W+/).filter(w => w.length > 3);
      const extWords = ext.moDescription.toLowerCase().split(/\W+/).filter(w => w.length > 3);
      const moOverlap = localWords.filter(w => extWords.includes(w));
      if (moOverlap.length >= 3) {
        sharedElements.push(`Similar MO: ${moOverlap.slice(0, 3).join(', ')}`); confidence += moOverlap.length * 5;
      }

      if (sharedElements.length > 0) {
        links.push({
          localCaseNumber: local.caseNumber,
          externalAgency: ext.agency,
          externalCaseNumber: ext.caseNumber,
          linkType: sharedElements.length >= 3 ? 'strong_match' : 'possible_match',
          sharedElements,
          confidence: Math.min(95, confidence),
          contactInfo: ext.contactPhone,
        });
      }
    }
  }

  return links.sort((a, b) => b.confidence - a.confidence);
}

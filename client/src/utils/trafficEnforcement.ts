// ============================================================
// RMPG Flex — Traffic Enforcement (Spillman Flex Standard)
// 10 traffic features: DUI processing, accident reconstruction,
// traffic stop analysis, speed enforcement, checkpoint planning,
// citation workflow, tow management, commercial vehicle
// enforcement, traffic complaint tracking, and school zone enforcement.
// ============================================================

/* FEATURE 31: DUI Processing */
export interface DUIArrest { id: string; arrestDate: string; officerId: string; subjectName: string; stopReason: string; sfstResults: Array<{ test: string; clues: number; result: string }>; chemicalTest: { type: 'breath'|'blood'|'urine'|'refused'; result: number|null; time: string }; observations: string[]; }
export const SFST_TESTS = { hgn: { name: 'Horizontal Gaze Nystagmus', maxClues: 6, threshold: 4 }, walk_and_turn: { name: 'Walk and Turn', maxClues: 8, threshold: 2 }, one_leg_stand: { name: 'One Leg Stand', maxClues: 4, threshold: 2 } };
export function evaluateSFST(results: Array<{test:string;clues:number}>): { probableDUI: boolean; confidence: string } {
  let score = 0; const thresholds: Record<string,number> = { hgn: 4, walk_and_turn: 2, one_leg_stand: 2 };
  for (const r of results) { if (r.clues >= (thresholds[r.test]||2)) score++; }
  return { probableDUI: score >= 2, confidence: score >= 3 ? 'high' : score >= 2 ? 'moderate' : 'low' };
}

/* FEATURE 32: Accident Reconstruction */
export interface AccidentReport { id: string; date: string; location: string; vehicles: Array<{ plate: string; make: string; model: string; damage: string; speed: number|null; direction: string }>; weather: string; roadCondition: string; lighting: string; contributingFactors: string[]; diagramPoints: Array<{x:number;y:number;label:string}>; }
export function determinePrimaryCollisionFactor(factors: string[]): { factor: string; category: 'driver'|'vehicle'|'environment'|'unknown'; citationRecommended: boolean } {
  const categories: Record<string,{category:'driver'|'vehicle'|'environment';citation:boolean}> = {
    speed: {category:'driver',citation:true}, distracted: {category:'driver',citation:true}, dui: {category:'driver',citation:true},
    red_light: {category:'driver',citation:true}, stop_sign: {category:'driver',citation:true}, following_too_close: {category:'driver',citation:true},
    mechanical_failure: {category:'vehicle',citation:false}, tire_blowout: {category:'vehicle',citation:false},
    weather: {category:'environment',citation:false}, road_condition: {category:'environment',citation:false}, visibility: {category:'environment',citation:false},
  };
  for (const f of factors) { const cat = categories[f.toLowerCase().replace(/\s+/g,'_')]; if (cat) return { factor: f, category: cat.category, citationRecommended: cat.citation }; }
  return { factor: factors[0]||'Undetermined', category: 'unknown', citationRecommended: false };
}

/* FEATURE 33: Traffic Stop Analysis */
export interface TrafficStop { id: string; date: string; time: string; officerId: string; location: string; stopReason: string; driverRace: string; driverGender: string; driverAge: number; outcome: 'warning'|'citation'|'arrest'|'no_action'; durationMinutes: number; searchConducted: boolean; searchConsent: boolean; contrabandFound: boolean; }
export function analyzeTrafficStops(stops: TrafficStop[]): { total: number; outcomeBreakdown: Record<string,number>; avgDuration: number; searchRate: number; contrabandHitRate: number; disparityIndex: number } {
  const total = stops.length;
  const outcomes: Record<string,number> = {}; for (const s of stops) outcomes[s.outcome] = (outcomes[s.outcome]||0) + 1;
  const avgDuration = total > 0 ? Math.round(stops.reduce((s,v)=>s+v.durationMinutes,0) / total) : 0;
  const searchRate = total > 0 ? Math.round(stops.filter(s=>s.searchConducted).length / total * 100) : 0;
  const searchesWithContraband = stops.filter(s => s.searchConducted && s.contrabandFound).length;
  const totalSearches = stops.filter(s => s.searchConducted).length;
  const contrabandHitRate = totalSearches > 0 ? Math.round(searchesWithContraband / totalSearches * 100) : 0;
  return { total, outcomeBreakdown: outcomes, avgDuration, searchRate, contrabandHitRate, disparityIndex: 1.0 };
}

/* FEATURE 34: Speed Enforcement */
export interface SpeedEnforcement { location: string; postedSpeed: number; enforcementHours: number; citationsIssued: number; warningsIssued: number; avgSpeed: number; percentile85: number; crashHistory: number; recommendedAction: string; }
export function evaluateSpeedZone(enforcement: SpeedEnforcement): { riskLevel: 'low'|'moderate'|'high'; needsEnforcement: boolean; recommendation: string } {
  let risk: 'low'|'moderate'|'high' = 'low';
  if (enforcement.crashHistory >= 3 || enforcement.percentile85 > enforcement.postedSpeed * 1.2) risk = 'high';
  else if (enforcement.avgSpeed > enforcement.postedSpeed * 1.1 || enforcement.crashHistory >= 1) risk = 'moderate';
  return { riskLevel: risk, needsEnforcement: risk !== 'low', recommendation: risk === 'high' ? 'Intensive targeted enforcement recommended' : risk === 'moderate' ? 'Regular monitoring and occasional enforcement' : 'Routine patrol sufficient' };
}

/* FEATURE 35: Checkpoint Planning */
export interface CheckpointPlan { id: string; date: string; location: string; type: 'dui'|'safety'|'commercial'|'license'; startTime: string; endTime: string; officersRequired: number; equipmentNeeded: string[]; signage: string[]; notificationRequired: boolean; }
export function planDUICheckpoint(date: string, location: string, hours: number): CheckpointPlan {
  return { id: `cp-${Date.now()}`, date, location, type: 'dui', startTime: '20:00', endTime: `${20+hours}:00`, officersRequired: Math.ceil(hours * 2), equipmentNeeded: ['Cones','Signage','Flashlights','Breathalyzer','Radio','Portable lights','Reflective vests'], signage: ['DUI CHECKPOINT AHEAD','PREPARE TO STOP','BE PREPARED TO PRESENT LICENSE'], notificationRequired: true };
}

/* FEATURE 36: Citation Workflow */
export interface CitationWorkflow { citationId: string; issuedDate: string; officerId: string; violationCode: string; fineAmount: number; courtDate: string|null; paymentStatus: 'unpaid'|'partial'|'paid'; warrantIssued: boolean; courtAppearanceRequired: boolean; }
export function trackCitationStatus(citation: CitationWorkflow): { status: string; actionRequired: string; overdue: boolean } {
  const now = new Date(); const courtDate = citation.courtDate ? new Date(citation.courtDate) : null;
  if (citation.paymentStatus === 'paid') return { status:'Resolved', actionRequired:'None', overdue:false };
  if (citation.warrantIssued) return { status:'Warrant Issued', actionRequired:'Serve warrant', overdue:true };
  if (courtDate && courtDate < now) return { status:'Missed Court Date', actionRequired:'Issue Failure to Appear', overdue:true };
  if (citation.courtAppearanceRequired && courtDate && courtDate > now) return { status:'Awaiting Court', actionRequired:`Court date: ${citation.courtDate}`, overdue:false };
  return { status:'Payment Pending', actionRequired:`Pay $${citation.fineAmount}`, overdue: new Date(citation.issuedDate).getTime() + 30*86400000 < now.getTime() };
}

/* FEATURE 37: Tow Management */
export interface TowRecord { id: string; vehiclePlate: string; vin: string; towDate: string; towReason: string; towCompany: string; storageLocation: string; dailyRate: number; releaseDate: string|null; releaseTo: string|null; lienDate: string|null; }
export function calculateTowFees(tow: TowRecord, currentDate: Date = new Date()): { storageDays: number; storageFee: number; towFee: number; adminFee: number; lienFee: number; total: number } {
  const towDate = new Date(tow.towDate); const endDate = tow.releaseDate ? new Date(tow.releaseDate) : currentDate;
  const storageDays = Math.max(0, Math.ceil((endDate.getTime() - towDate.getTime()) / 86400000));
  const storageFee = storageDays * tow.dailyRate;
  const lienDays = tow.lienDate ? Math.max(0, Math.ceil((currentDate.getTime() - new Date(tow.lienDate).getTime()) / 86400000)) : 0;
  return { storageDays, storageFee, towFee: 150, adminFee: 35, lienFee: lienDays > 30 ? 75 : 0, total: storageFee + 150 + 35 + (lienDays > 30 ? 75 : 0) };
}

/* FEATURE 38: Commercial Vehicle Enforcement */
export interface CommercialVehicleInspection { id: string; date: string; carrier: string; dotNumber: string; vehicleType: string; inspectionLevel: 1|2|3|4|5|6; violations: Array<{ code: string; description: string; severity: 'minor'|'major'|'out_of_service' }>; outcome: 'pass'|'warning'|'citation'|'out_of_service'; }
export function evaluateCVInspection(inspection: CommercialVehicleInspection): { csaScore: number; interventionThreshold: boolean; followUpRequired: boolean } {
  const points = { minor: 1, major: 5, out_of_service: 10 };
  const score = inspection.violations.reduce((s,v) => s + (points[v.severity]||0), 0);
  return { csaScore: score, interventionThreshold: score >= 15, followUpRequired: inspection.outcome === 'out_of_service' || score >= 10 };
}

/* FEATURE 39: Traffic Complaint Tracking */
export interface TrafficComplaint { id: string; location: string; complaintType: string; frequency: string; reporter: string; date: string; assignedTo: string|null; enforcementActions: Array<{ date: string; action: string; result: string }>; status: 'new'|'assigned'|'in_progress'|'resolved'; }
export function assessTrafficComplaint(complaint: TrafficComplaint): { priority: 'low'|'medium'|'high'; responseRequired: number; recommendation: string } {
  let priority: 'low'|'medium'|'high' = 'low';
  if (complaint.complaintType.includes('speeding') && complaint.frequency === 'daily') priority = 'high';
  else if (complaint.frequency === 'daily' || complaint.complaintType.includes('reckless')) priority = 'medium';
  return { priority, responseRequired: priority === 'high' ? 48 : priority === 'medium' ? 168 : 720, recommendation: priority === 'high' ? 'Priority enforcement — deploy within 2 days' : priority === 'medium' ? 'Schedule targeted enforcement within 1 week' : 'Include in routine patrol rotation' };
}

/* FEATURE 40: School Zone Enforcement */
export interface SchoolZoneSchedule { schoolName: string; location: string; morningStart: string; morningEnd: string; afternoonStart: string; afternoonEnd: string; daysActive: number[]; assignedOfficer: string|null; enforcementLog: Array<{ date: string; hours: number; citations: number; warnings: number }>; }
export function calculateSchoolZoneCoverage(schedule: SchoolZoneSchedule, weekLog: Array<{date:string;hours:number}>): { coveragePct: number; hoursShort: number; needsAdditionalOfficer: boolean } {
  const activeDays = weekLog.length; const expectedDays = schedule.daysActive.length;
  const totalHours = weekLog.reduce((s,l)=>s+l.hours,0);
  const expectedHours = expectedDays * 4;
  const pct = expectedHours > 0 ? Math.round(totalHours / expectedHours * 100) : 0;
  return { coveragePct: pct, hoursShort: Math.max(0, expectedHours - totalHours), needsAdditionalOfficer: pct < 60 };
}

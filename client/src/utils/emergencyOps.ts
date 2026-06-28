// ============================================================
// RMPG Flex — Emergency Operations (Spillman Flex Standard)
// 10 emergency features: EOC activation, resource staging,
// mutual aid requests, disaster assessment, evacuation planning,
// shelter management, NIMS/ICS compliance, after-action reporting,
// COOP planning, and emergency notification cascade.
// ============================================================

/* FEATURE 81: EOC Activation */
export interface EOCActivation { activationLevel: 1|2|3; reason: string; activatedBy: string; activatedAt: string; deactivatedAt: string|null; staffingRequired: number; staffingPresent: number; agenciesNotified: string[]; resourcesRequested: string[]; }
export function determineActivationLevel(incident: { type: string; affectedPopulation: number; areaSize: number; multiAgency: boolean; duration: string }): { level: EOCActivation['activationLevel']; justification: string } {
  if (incident.affectedPopulation > 10000 || incident.areaSize > 50 || (incident.multiAgency && incident.duration === 'extended')) return { level: 1, justification: 'Full EOC activation — all positions staffed 24/7' };
  if (incident.affectedPopulation > 1000 || incident.areaSize > 10 || incident.multiAgency) return { level: 2, justification: 'Partial EOC activation — key positions staffed' };
  return { level: 3, justification: 'Monitoring level — EOC ready, virtual coordination' };
}

/* FEATURE 82: Resource Staging */
export interface StagingArea { id: string; name: string; location: string; capacity: number; currentOccupancy: number; resources: Array<{ type: string; quantity: number; unit: string; assigned: boolean }>; status: 'active'|'standby'|'closed'; }
export function assessStagingCapacity(areas: StagingArea[]): { totalCapacity: number; totalOccupied: number; availablePct: number; needsExpansion: boolean } {
  const totalCap = areas.reduce((s,a)=>s+a.capacity,0);
  const totalOcc = areas.reduce((s,a)=>s+a.currentOccupancy,0);
  const availPct = totalCap > 0 ? Math.round((1 - totalOcc/totalCap) * 100) : 0;
  return { totalCapacity: totalCap, totalOccupied: totalOcc, availablePct: availPct, needsExpansion: availPct < 20 };
}

/* FEATURE 83: Mutual Aid Requests */
export interface MutualAidRequest { id: string; requestingAgency: string; resourceType: string; quantity: number; priority: 'immediate'|'planned'|'standby'; requestedAt: string; fulfilledAt: string|null; providingAgency: string|null; cost: number; status: 'pending'|'accepted'|'declined'|'fulfilled'; }
export function trackMutualAidStatus(requests: MutualAidRequest[]): { pending: number; fulfilled: number; criticalUnmet: number; avgResponseMinutes: number } {
  const pending = requests.filter(r => r.status === 'pending');
  const fulfilled = requests.filter(r => r.status === 'fulfilled');
  const criticalUnmet = pending.filter(r => r.priority === 'immediate').length;
  const responseTimes = fulfilled.filter(r => r.fulfilledAt).map(r => (new Date(r.fulfilledAt!).getTime() - new Date(r.requestedAt).getTime()) / 60000);
  const avgResponse = responseTimes.length > 0 ? Math.round(responseTimes.reduce((s,v)=>s+v,0) / responseTimes.length) : 0;
  return { pending: pending.length, fulfilled: fulfilled.length, criticalUnmet, avgResponseMinutes: avgResponse };
}

/* FEATURE 84: Disaster Assessment */
export interface DamageAssessment { incidentId: string; assessedAt: string; areaName: string; structuresDamaged: number; structuresDestroyed: number; roadsBlocked: number; utilitiesDown: string[]; casualties: number; fatalities: number; estimatedCost: number; priority: 'critical'|'major'|'minor'; }
export function scoreDisasterSeverity(assessment: DamageAssessment): { severityIndex: number; femaEligible: boolean; disasterDeclarationRecommended: boolean } {
  let index = 0;
  index += assessment.fatalities * 10 + assessment.casualties * 3;
  index += assessment.structuresDestroyed * 5 + assessment.structuresDamaged * 2;
  index += assessment.roadsBlocked * 1;
  const femaThreshold = 25; const declarationThreshold = 50;
  return { severityIndex: index, femaEligible: index >= femaThreshold, disasterDeclarationRecommended: index >= declarationThreshold };
}

/* FEATURE 85: Evacuation Planning */
export interface EvacuationPlan { incidentId: string; zone: string; population: number; routes: Array<{ name: string; capacity: number; status: 'open'|'congested'|'closed' }>; shelters: Array<{ name: string; capacity: number; current: number }>; specialNeedsPopulation: number; transportationNeeded: boolean; status: 'planned'|'voluntary'|'mandatory'|'completed'; }
export function evaluateEvacuationProgress(plan: EvacuationPlan, evacuatedCount: number): { pctComplete: number; routeCapacity: number; shelterCapacity: number; needsMoreShelters: boolean } {
  const totalRouteCap = plan.routes.filter(r => r.status !== 'closed').reduce((s,r) => s + r.capacity, 0);
  const totalShelterCap = plan.shelters.reduce((s,sh) => s + sh.capacity, 0);
  const totalInShelters = plan.shelters.reduce((s,sh) => s + sh.current, 0);
  return { pctComplete: plan.population > 0 ? Math.round(evacuatedCount / plan.population * 100) : 0, routeCapacity: totalRouteCap, shelterCapacity: totalShelterCap, needsMoreShelters: totalShelterCap - totalInShelters < plan.population * 0.2 };
}

/* FEATURE 86: Shelter Management */
export interface Shelter { id: string; name: string; location: string; capacity: number; currentOccupancy: number; staffOnDuty: number; supplies: Array<{ item: string; quantity: number; unit: string; daysRemaining: number }>; status: 'open'|'full'|'closing'|'closed'; }
export function assessShelterReadiness(shelters: Shelter[]): { totalCapacity: number; totalOccupancy: number; availableBeds: number; supplyAlerts: string[] } {
  const totalCap = shelters.reduce((s,sh) => s + sh.capacity, 0);
  const totalOcc = shelters.reduce((s,sh) => s + sh.currentOccupancy, 0);
  const alerts: string[] = [];
  for (const sh of shelters) {
    for (const sup of sh.supplies) { if (sup.daysRemaining < 2) alerts.push(`${sh.name}: ${sup.item} critically low (${sup.daysRemaining} days)`); }
  }
  return { totalCapacity: totalCap, totalOccupancy: totalOcc, availableBeds: totalCap - totalOcc, supplyAlerts: alerts };
}

/* FEATURE 87: NIMS/ICS Compliance */
export interface ICSStructure { incidentName: string; positions: Array<{ role: string; assignedTo: string|null; qualified: boolean; dateAssigned: string|null }>; spanOfControl: number; objectives: string[]; operationalPeriod: string; }
export function validateICSStructure(ics: ICSStructure): { compliant: boolean; issues: string[] } {
  const issues: string[] = [];
  const unassigned = ics.positions.filter(p => !p.assignedTo);
  const unqualified = ics.positions.filter(p => p.assignedTo && !p.qualified);
  if (unassigned.length > 0) issues.push(`${unassigned.length} ICS positions unfilled: ${unassigned.map(p=>p.role).join(', ')}`);
  if (unqualified.length > 0) issues.push(`${unqualified.length} positions filled by unqualified personnel`);
  if (ics.spanOfControl > 7) issues.push(`Span of control (${ics.spanOfControl}) exceeds recommended maximum of 7`);
  if (ics.objectives.length === 0) issues.push('No operational objectives defined');
  return { compliant: issues.length === 0, issues };
}

/* FEATURE 88: After-Action Reporting */
export interface AfterActionReport { incidentId: string; incidentName: string; reportDate: string; strengths: string[]; areasForImprovement: string[]; lessonsLearned: string[]; correctiveActions: Array<{ action: string; responsible: string; dueDate: string; status: string }>; participants: Array<{ agency: string; role: string; contribution: string }>; }
export function generateAARSummary(report: AfterActionReport): { totalCorrectiveActions: number; completedActions: number; overallAssessment: string } {
  const total = report.correctiveActions.length;
  const completed = report.correctiveActions.filter(a => a.status === 'completed').length;
  let assessment = 'Satisfactory';
  if (report.areasForImprovement.length > 5) assessment = 'Significant improvements needed';
  else if (report.areasForImprovement.length > 2) assessment = 'Moderate improvements recommended';
  return { totalCorrectiveActions: total, completedActions: completed, overallAssessment: assessment };
}

/* FEATURE 89: COOP Planning */
export interface COOPPlan { department: string; essentialFunctions: Array<{ function: string; priority: number; recoveryTimeHours: number; alternateSite: string }>; successionOrder: string[]; delegationAuthority: string[]; vitalRecords: string[]; alternateFacility: string; testedDate: string|null; }
export function evaluateCOOPReadiness(plan: COOPPlan): { readinessScore: number; criticalGaps: string[]; requiresUpdate: boolean } {
  const gaps: string[] = [];
  if (!plan.alternateFacility) gaps.push('No alternate facility designated');
  if (plan.successionOrder.length < 3) gaps.push('Insufficient succession depth (minimum 3)');
  if (!plan.testedDate) gaps.push('COOP plan has not been tested');
  else if (new Date(plan.testedDate).getTime() < Date.now() - 365*86400000) gaps.push('COOP plan test expired (>1 year)');
  if (plan.vitalRecords.length === 0) gaps.push('No vital records identified');
  const score = Math.max(0, 100 - gaps.length * 20);
  return { readinessScore: score, criticalGaps: gaps, requiresUpdate: gaps.length > 0 };
}

/* FEATURE 90: Emergency Notification Cascade */
export interface NotificationCascade { incidentId: string; levels: Array<{ order: number; recipients: Array<{ name: string; role: string; contact: string; notified: boolean; acknowledged: boolean; notifiedAt: string|null }> }>; totalRecipients: number; totalNotified: number; totalAcknowledged: number; }
export function trackNotificationProgress(cascade: NotificationCascade): { notificationRate: number; acknowledgmentRate: number; unacknowledged: string[]; escalationNeeded: boolean } {
  const total = cascade.totalRecipients;
  const notified = cascade.totalNotified;
  const acknowledged = cascade.totalAcknowledged;
  const unacknowledged: string[] = [];
  for (const level of cascade.levels) {
    for (const r of level.recipients) { if (r.notified && !r.acknowledged) unacknowledged.push(`${r.name} (${r.role})`); }
  }
  return { notificationRate: total > 0 ? Math.round(notified/total*100) : 0, acknowledgmentRate: total > 0 ? Math.round(acknowledged/total*100) : 0, unacknowledged, escalationNeeded: unacknowledged.length > 0 && (notified/total) > 0.8 };
}

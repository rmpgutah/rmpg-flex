// ============================================================
// RMPG Flex — Special Operations (Spillman Flex Standard)
// 10 special ops features: SWAT callout tracking, tactical
// operations planning, crisis negotiation, surveillance logs,
// undercover operations, search warrant execution, high-risk
// entry planning, operational security, after-action reviews,
// and special equipment inventory.
// ============================================================

/* FEATURE 21: SWAT Callout Tracking */
export interface SWATCallout { id:string; date:string; time:string; callType:'barricade'|'hostage'|'active_shooter'|'high_risk_warrant'|'dignitary_protection'|'other'; location:string; respondingOperators:number; negotiatorsDeployed:number; k9Deployed:boolean; robotDeployed:boolean; gasDeployed:boolean; resolution:'surrender'|'breach_and_clear'|'negotation_success'|'use_of_force'|'stand_down'|'other'; durationMinutes:number; injuries:number; fatalities:number; }
export function analyzeSWATPerformance(callouts:SWATCallout[]): { avgResponseMinutes:number; avgDuration:number; negotiationSuccessRate:number; forceUsageRate:number; injuryRate:number } {
  const total = callouts.length||1;
  const avgDuration = Math.round(callouts.reduce((s,c)=>s+c.durationMinutes,0)/total);
  const negotiations = callouts.filter(c=>c.negotiatorsDeployed).length;
  const negotiationSuccess = callouts.filter(c=>c.resolution==='negotation_success'||c.resolution==='surrender').length;
  const forceUsed = callouts.filter(c=>c.resolution==='breach_and_clear'||c.resolution==='use_of_force').length;
  const withInjuries = callouts.filter(c=>c.injuries>0).length;
  return { avgResponseMinutes:0, avgDuration, negotiationSuccessRate:negotiations>0?Math.round(negotiationSuccess/negotiations*100):0, forceUsageRate:Math.round(forceUsed/total*100), injuryRate:Math.round(withInjuries/total*100) };
}

/* FEATURE 22: Tactical Operations Planning */
export interface TacticalPlan { id:string; operationName:string; date:string; location:string; objective:string; teamComposition:Array<{role:string;operatorId:string;equipment:string[]}>; entryPoints:string[]; containmentPositions:string[]; sniperPositions:string[]; evacuationPlan:string; commsPlan:{primary:string;secondary:string;tac:string}; contingencyPlans:string[]; riskAssessment:'low'|'medium'|'high'|'extreme'; approvedBy:string|null; }
export function validateTacticalPlan(plan:TacticalPlan): {ready:boolean; gaps:string[]; safetyScore:number } {
  const gaps:string[] = [];
  if (!plan.approvedBy) gaps.push('No command approval');
  if (plan.teamComposition.length < 4) gaps.push('Insufficient team size (minimum 4 operators)');
  if (plan.entryPoints.length < 2) gaps.push('Need minimum 2 entry points');
  if (!plan.contingencyPlans.length) gaps.push('No contingency plans defined');
  if (!plan.evacuationPlan) gaps.push('No evacuation plan');
  return { ready:gaps.length===0, gaps, safetyScore:Math.max(0,100-gaps.length*20) };
}

/* FEATURE 23: Crisis Negotiation */
export interface NegotiationLog { id:string; incidentId:string; negotiatorId:string; startTime:string; endTime:string|null; subjectName:string; subjectDemands:string[]; communicationMethod:'phone'|'throw_phone'|'voice'|'text'|'notes'; keyPhrases:string[]; rapportEstablished:boolean; concessionsMade:string[]; resolution:string|null; }
export function evaluateNegotiationEffectiveness(log:NegotiationLog): { rapportScore:number; concessionStrategy:string; timeEfficiency:number; outcomeRating:string } {
  let score = 0;
  if (log.rapportEstablished) score += 40;
  if (log.concessionsMade.length > 0) score += 10;
  if (log.keyPhrases.length > 5) score += 20;
  if (log.resolution && log.resolution !== 'tactical_intervention') score += 30;
  const rating = score >= 80 ? 'Excellent' : score >= 60 ? 'Good' : score >= 40 ? 'Fair' : 'Needs Improvement';
  return { rapportScore:score, concessionStrategy:log.concessionsMade.length>0?'Strategic concessions used':'No concessions — maintaining position', timeEfficiency:Math.round((log.endTime?new Date(log.endTime).getTime():Date.now())-new Date(log.startTime).getTime())/60000, outcomeRating:rating };
}

/* FEATURE 24: Surveillance Logs */
export interface SurveillanceLog { id:string; caseNumber:string; date:string; startTime:string; endTime:string; location:string; surveillanceType:'stationary'|'mobile'|'aerial'|'electronic'; officers:Array<{officerId:string;role:string;hours:number}>; targetDescription:string; observations:string[]; photos:number; videoMinutes:number; equipmentUsed:string[]; }
export function calculateSurveillanceCosts(log:SurveillanceLog, hourlyRate:number=45): { personnelCost:number; equipmentCost:number; totalCost:number; hoursObserved:number } {
  const totalHours = log.officers.reduce((s,o)=>s+o.hours,0);
  const equipmentCost = log.equipmentUsed.length * 50;
  return { personnelCost:Math.round(totalHours*hourlyRate), equipmentCost, totalCost:Math.round(totalHours*hourlyRate+equipmentCost), hoursObserved:totalHours };
}

/* FEATURE 25: Undercover Operations */
export interface UndercoverOp { id:string; operationName:string; startDate:string; endDate:string|null; undercoverOfficerId:string; coverIdentity:string; targetOrganization:string; operationType:'narcotics'|'organized_crime'|'human_trafficking'|'fencing'|'other'; budgetAllocated:number; budgetSpent:number; evidenceGathered:number; arrestsResulting:number; status:'active'|'completed'|'compromised'|'terminated'; }
export function assessUndercoverRisk(operation:UndercoverOp, daysActive:number): { riskLevel:'low'|'elevated'|'high'|'critical'; withdrawalRecommended:boolean; factors:string[] } {
  const factors:string[] = [];
  if (daysActive > 180) factors.push('Operation exceeds 180 days — increased exposure risk');
  if (operation.status === 'compromised') factors.push('Cover may be compromised');
  if (operation.budgetSpent > operation.budgetAllocated * 0.9) factors.push('Budget nearly exhausted');
  let level:'low'|'elevated'|'high'|'critical' = 'low';
  if (factors.length >= 3 || operation.status === 'compromised') level = 'critical';
  else if (factors.length >= 2) level = 'high';
  else if (factors.length >= 1) level = 'elevated';
  return { riskLevel:level, withdrawalRecommended:level === 'critical', factors };
}

/* FEATURE 26: Search Warrant Execution */
export interface WarrantExecution { id:string; warrantNumber:string; executionDate:string; location:string; teamSize:number; entryMethod:'knock_and_announce'|'no_knock'|'ruse'; forcedEntry:boolean; securedInMinutes:number; evidenceSeized:Array<{item:string;quantity:number;location:string}>; arrestsMade:number; useOfForce:boolean; injuries:number; propertyDamage:string; }
export function reviewWarrantExecution(execution:WarrantExecution): { compliant:boolean; issues:string[]; rating:1|2|3|4|5 } {
  const issues:string[] = [];
  if (execution.entryMethod==='no_knock' && !execution.warrantNumber) issues.push('No-knock entry requires specific judicial authorization');
  if (execution.injuries>0) issues.push(`${execution.injuries} injuries reported — review use of force`);
  if (execution.useOfForce && !execution.securedInMinutes) issues.push('Use of force incident — documentation required');
  let rating:1|2|3|4|5 = 5;
  if (issues.length>=3) rating=2; else if (issues.length>=1) rating=3;
  return { compliant:issues.length===0, issues, rating };
}

/* FEATURE 27: High-Risk Entry Planning */
export interface EntryPlan { id:string; locationType:'residential'|'commercial'|'vehicle'|'open_area'; floorPlan:Array<{room:string;position:'left'|'right'|'center'|'unknown';hazards:string[]}>; breachPoints:string[]; diversionPlan:string|null; lessLethalOptions:string[]; medicalStaging:string; timeOfDay:string; occupancy:number; hazards:string[]; }
export function assessEntryRisk(plan:EntryPlan): { riskScore:number; mitigationSteps:string[]; recommendedTeamSize:number } {
  let score = 0; const mitigations:string[] = [];
  if (plan.hazards.length>0) { score+=plan.hazards.length*5; mitigations.push(`Address ${plan.hazards.length} hazards: ${plan.hazards.join(', ')}`); }
  if (plan.occupancy>3) { score+=plan.occupancy*2; mitigations.push(`High occupancy (${plan.occupancy}) — increase team size`); }
  if (!plan.diversionPlan) { score+=10; mitigations.push('Consider adding diversion/distraction plan'); }
  if (!plan.medicalStaging) { score+=5; mitigations.push('Designate medical staging area'); }
  return { riskScore:score, mitigationSteps:mitigations, recommendedTeamSize:Math.max(4,Math.ceil(plan.occupancy/1.5)) };
}

/* FEATURE 28: Operational Security */
export interface OpSecAssessment { operationId:string; assessedBy:string; assessedAt:string; informationSensitivity:'low'|'medium'|'high'|'critical'; needToKnow:boolean; compartmentalized:boolean; commsEncrypted:boolean; physicalSecurity:string; digitalSecurity:string; vulnerabilities:string[]; mitigations:string[]; }
export function evaluateOpSecPosture(assessment:OpSecAssessment): { securityScore:number; criticalVulnerabilities:string[]; recommendations:string[] } {
  const vulns:string[] = []; const recs:string[] = [];
  if (!assessment.commsEncrypted) { vulns.push('Unencrypted communications'); recs.push('Implement end-to-end encryption for all operational comms'); }
  if (!assessment.compartmentalized) { vulns.push('Information not compartmentalized'); recs.push('Restrict information on need-to-know basis'); }
  if (!assessment.needToKnow) { vulns.push('No need-to-know enforcement'); recs.push('Implement need-to-know access controls'); }
  const score = Math.max(0,100 - vulns.length*25 - assessment.vulnerabilities.length*10);
  return { securityScore:score, criticalVulnerabilities:vulns, recommendations:recs };
}

/* FEATURE 29: After-Action Review */
export interface AfterActionReview { id:string; operationId:string; reviewDate:string; participants:string[]; whatWentWell:string[]; whatWentWrong:string[]; lessonsLearned:string[]; correctiveActions:Array<{action:string;responsible:string;deadline:string;status:string}>; overallRating:1|2|3|4|5; policyChanges:string[]; trainingRecommendations:string[]; }
export function trackAARCorrectiveActions(review:AfterActionReview): { total:number; completed:number; overdue:number; complianceRate:number } {
  const total = review.correctiveActions.length;
  const completed = review.correctiveActions.filter(a=>a.status==='completed').length;
  const overdue = review.correctiveActions.filter(a=>a.status!=='completed'&&new Date(a.deadline)<new Date()).length;
  return { total, completed, overdue, complianceRate:total>0?Math.round(completed/total*100):0 };
}

/* FEATURE 30: Special Equipment Inventory */
export interface SWATEquipment { id:string; equipmentType:string; serialNumber:string; assignedTo:string|null; condition:'ready'|'maintenance'|'repair'|'retired'; lastInspection:string; nextInspection:string; deployments:number; notes:string; }
export function checkEquipmentReadiness(inventory:SWATEquipment[]): { readyRate:number; needsMaintenance:SWATEquipment[]; criticalItems:SWATEquipment[] } {
  const ready = inventory.filter(e=>e.condition==='ready');
  const needsMaint = inventory.filter(e=>e.condition==='maintenance'||e.condition==='repair');
  const critical = inventory.filter(e=>e.condition==='retired'||(e.condition!=='ready'&&new Date(e.nextInspection)<new Date()));
  return { readyRate:inventory.length>0?Math.round(ready.length/inventory.length*100):0, needsMaintenance:needsMaint, criticalItems:critical };
}

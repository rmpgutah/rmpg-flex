// ============================================================
// RMPG Flex — Crisis Response & Mental Health (Spillman Flex Standard)
// 10 crisis features: CIT deployment, mental health hold tracking,
// crisis intervention, de-escalation documentation, mobile crisis
// team coordination, resource referral, suicide prevention,
// homeless outreach, substance abuse response, wellness check data.
// ============================================================

/* FEATURE 31: CIT Deployment */
export interface CITDeployment { id:string; date:string; officerId:string; citCertified:boolean; incidentType:string; subjectCondition:string; deescalationUsed:string[]; outcome:'resolved_on_scene'|'transport_to_facility'|'arrest'|'referral'|'other'; facilityName:string|null; holdPlaced:boolean; useOfForce:boolean; durationMinutes:number; }
export function evaluateCITOutcomes(deployments:CITDeployment[]): { totalDeployments:number; resolvedOnScene:number; arrestRate:number; forceRate:number; avgDuration:number } {
  const total = deployments.length||1;
  const resolved = deployments.filter(d=>d.outcome==='resolved_on_scene').length;
  const arrests = deployments.filter(d=>d.outcome==='arrest').length;
  const force = deployments.filter(d=>d.useOfForce).length;
  const avgDur = Math.round(deployments.reduce((s,d)=>s+d.durationMinutes,0)/total);
  return { totalDeployments:deployments.length, resolvedOnScene:resolved, arrestRate:Math.round(arrests/total*100), forceRate:Math.round(force/total*100), avgDuration:avgDur };
}

/* FEATURE 32: Mental Health Hold Tracking */
export interface MentalHealthHold { id:string; subjectName:string; date:string; initiatingOfficer:string; holdType:'5150'|'voluntary'|'court_ordered'|'emergency'; facility:string; transportMethod:string; holdStartDate:string; holdEndDate:string|null; evaluationResults:string|null; releasedTo:string|null; followUpRequired:boolean; }
export function trackHoldCompliance(holds:MentalHealthHold[]): { activeHolds:number; overdueEvaluations:number; avgHoldDurationDays:number; followUpRate:number } {
  const now = new Date(); const active = holds.filter(h=>!h.holdEndDate||new Date(h.holdEndDate)>now);
  const overdue = holds.filter(h=>!h.evaluationResults&&(!h.holdEndDate||new Date(h.holdEndDate)<now));
  const completed = holds.filter(h=>h.holdEndDate).map(h=>Math.ceil((new Date(h.holdEndDate!).getTime()-new Date(h.holdStartDate).getTime())/86400000));
  const avgDur = completed.length>0?Math.round(completed.reduce((s,v)=>s+v,0)/completed.length):0;
  const followUps = holds.filter(h=>h.followUpRequired).length;
  return { activeHolds:active.length, overdueEvaluations:overdue.length, avgHoldDurationDays:avgDur, followUpRate:holds.length>0?Math.round(followUps/holds.length*100):0 };
}

/* FEATURE 33: De-escalation Documentation */
export interface DeescalationReport { id:string; callNumber:string; officerId:string; date:string; subjectBehavior:string[]; techniquesUsed:Array<{technique:string;effective:boolean}>; verbalCommands:number; physicalIntervention:boolean; timeToResolution:number; outcome:string; }
export function analyzeDeescalation(reports:DeescalationReport[]): { techniquesUsed:Record<string,{count:number;effective:number}>; effectivenessRate:number; avgTimeToResolution:number } {
  const techniques:Record<string,{count:number;effective:number}> = {};
  for (const r of reports) { for (const t of r.techniquesUsed) { if (!techniques[t.technique]) techniques[t.technique]={count:0,effective:0}; techniques[t.technique].count++; if (t.effective) techniques[t.technique].effective++; } }
  const totalTechniques = reports.reduce((s,r)=>s+r.techniquesUsed.length,0);
  const totalEffective = reports.reduce((s,r)=>s+r.techniquesUsed.filter(t=>t.effective).length,0);
  const avgTime = reports.length>0?Math.round(reports.reduce((s,r)=>s+r.timeToResolution,0)/reports.length):0;
  return { techniquesUsed:techniques, effectivenessRate:totalTechniques>0?Math.round(totalEffective/totalTechniques*100):0, avgTimeToResolution:avgTime };
}

/* FEATURE 34: Mobile Crisis Team Coordination */
export interface MobileCrisisTeam { id:string; teamName:string; clinicians:Array<{name:string;role:string;availability:string}>; coverageZones:string[]; operatingHours:{start:string;end:string}; responseTime:number; activeIncidents:number; maxCapacity:number; }
export function assessCrisisCoverage(teams:MobileCrisisTeam[], activeCalls:number): { teamsAvailable:number; totalCapacity:number; utilizationRate:number; needsAdditionalResources:boolean } {
  const available = teams.filter(t=>t.activeIncidents<t.maxCapacity);
  const totalCap = teams.reduce((s,t)=>s+t.maxCapacity,0);
  const active = teams.reduce((s,t)=>s+t.activeIncidents,0);
  const utilization = totalCap>0?Math.round(active/totalCap*100):0;
  return { teamsAvailable:available.length, totalCapacity:totalCap, utilizationRate:utilization, needsAdditionalResources:utilization>80||available.length===0 };
}

/* FEATURE 35: Resource Referral */
export interface ResourceReferral { id:string; subjectName:string; referralDate:string; serviceType:'mental_health'|'substance_abuse'|'housing'|'employment'|'veterans'|'domestic_violence'|'food_assistance'|'other'; providerName:string; providerContact:string; appointmentDate:string|null; followUpDate:string|null; accepted:boolean; outcome:string|null; }
export function trackReferralOutcomes(referrals:ResourceReferral[]): { total:number; accepted:number; acceptanceRate:number; followUpCompleted:number; mostReferred:Record<string,number> } {
  const accepted = referrals.filter(r=>r.accepted).length;
  const followUps = referrals.filter(r=>r.followUpDate&&r.outcome).length;
  const byType:Record<string,number> = {}; for (const r of referrals) byType[r.serviceType]=(byType[r.serviceType]||0)+1;
  return { total:referrals.length, accepted, acceptanceRate:referrals.length>0?Math.round(accepted/referrals.length*100):0, followUpCompleted:followUps, mostReferred:byType };
}

/* FEATURE 36: Suicide Prevention */
export interface SuicideIntervention { id:string; date:string; officerId:string; location:string; method:string; interventionType:'verbal'|'physical'|'negotiation'; subjectTransported:boolean; facility:string|null; followUpContact:string|null; lethalityAssessment:string; safetyPlanCreated:boolean; }
export function assessLethalityRisk(factors:Array<{present:boolean;weight:number}>): {score:number;riskLevel:'low'|'moderate'|'high'|'imminent'; action:string} {
  const score = factors.filter(f=>f.present).reduce((s,f)=>s+f.weight,0);
  let level:'low'|'moderate'|'high'|'imminent' = 'low'; let action = '';
  if (score>=15) { level='imminent'; action='Immediate intervention required — do not leave subject alone'; }
  else if (score>=10) { level='high'; action='High risk — transport for evaluation, remove means'; }
  else if (score>=5) { level='moderate'; action='Moderate risk — safety plan and follow-up referral'; }
  else { action='Low risk — provide crisis resources and check back'; }
  return {score,riskLevel:level,action};
}

/* FEATURE 37: Homeless Outreach */
export interface HomelessContact { id:string; subjectName:string|null; date:string; location:string; encampment:boolean; servicesOffered:string[]; servicesAccepted:string[]; shelterReferral:boolean; shelterAccepted:boolean; notes:string; followUpDate:string|null; }
export function analyzeHomelessOutreach(contacts:HomelessContact[]): { totalContacts:number; uniqueLocations:number; shelterAcceptanceRate:number; serviceAcceptanceRate:number; encampments:number } {
  const uniqueLocs = new Set(contacts.map(c=>c.location)).size;
  const shelterRef = contacts.filter(c=>c.shelterReferral).length;
  const shelterAcc = contacts.filter(c=>c.shelterAccepted).length;
  const servicesOff = contacts.reduce((s,c)=>s+c.servicesOffered.length,0);
  const servicesAcc = contacts.reduce((s,c)=>s+c.servicesAccepted.length,0);
  const encampments = contacts.filter(c=>c.encampment).length;
  return { totalContacts:contacts.length, uniqueLocations:uniqueLocs, shelterAcceptanceRate:shelterRef>0?Math.round(shelterAcc/shelterRef*100):0, serviceAcceptanceRate:servicesOff>0?Math.round(servicesAcc/servicesOff*100):0, encampments };
}

/* FEATURE 38: Substance Abuse Response */
export interface SubstanceAbuseCall { id:string; date:string; substanceType:string; overdose:boolean; naloxoneAdministered:boolean; subjectCondition:string; transportedToHospital:boolean; treatmentReferralOffered:boolean; treatmentAccepted:boolean; arrestMade:boolean; }
export function trackOverdoseResponse(calls:SubstanceAbuseCall[]): { totalOverdoses:number; naloxoneAdministered:number; survivalRate:number; treatmentReferralRate:number; arrestRate:number } {
  const overdoses = calls.filter(c=>c.overdose);
  const naloxone = overdoses.filter(c=>c.naloxoneAdministered).length;
  const fatalities = overdoses.filter(c=>c.subjectCondition==='deceased').length;
  const treatmentOff = overdoses.filter(c=>c.treatmentReferralOffered).length;
  const treatmentAcc = overdoses.filter(c=>c.treatmentAccepted).length;
  return { totalOverdoses:overdoses.length, naloxoneAdministered:naloxone, survivalRate:overdoses.length>0?Math.round((overdoses.length-fatalities)/overdoses.length*100):100, treatmentReferralRate:treatmentOff>0?Math.round(treatmentAcc/treatmentOff*100):0, arrestRate:overdoses.length>0?Math.round(overdoses.filter(c=>c.arrestMade).length/overdoses.length*100):0 };
}

/* FEATURE 39: Wellness Check Data */
export interface WellnessCheck { id:string; date:string; requestedBy:string; subjectName:string; subjectAge:number; subjectAddress:string; reason:string; outcome:'ok'|'transported'|'refused'|'not_found'|'deceased'|'other'; officerId:string; durationMinutes:number; referralProvided:boolean; }
export function analyzeWellnessChecks(checks:WellnessCheck[]): { total:number; transportRate:number; notFoundRate:number; avgDuration:number; commonReasons:Record<string,number> } {
  const total = checks.length||1;
  const transported = checks.filter(c=>c.outcome==='transported').length;
  const notFound = checks.filter(c=>c.outcome==='not_found').length;
  const avgDur = Math.round(checks.reduce((s,c)=>s+c.durationMinutes,0)/total);
  const reasons:Record<string,number> = {}; for (const c of checks) reasons[c.reason]=(reasons[c.reason]||0)+1;
  return { total:checks.length, transportRate:Math.round(transported/total*100), notFoundRate:Math.round(notFound/total*100), avgDuration:avgDur, commonReasons:reasons };
}

/* FEATURE 40: Crisis Program Effectiveness */
export interface CrisisProgramMetrics { period:string; citCalls:number; citResolvedOnScene:number; holdsInitiated:number; referralsMade:number; referralsAccepted:number; followUpCompleted:number; useOfForceDuringCrisis:number; costSavings:number; }
export function calculateCrisisROI(metrics:CrisisProgramMetrics): { diversionRate:number; referralSuccessRate:number; estimatedSavings:number; programEffectiveness:string } {
  const diversionRate = metrics.citCalls>0?Math.round(metrics.citResolvedOnScene/metrics.citCalls*100):0;
  const referralRate = metrics.referralsMade>0?Math.round(metrics.referralsAccepted/metrics.referralsMade*100):0;
  const savings = metrics.citResolvedOnScene*2500 + metrics.referralsAccepted*1500;
  let effectiveness = 'Needs Improvement';
  if (diversionRate>60&&referralRate>50) effectiveness='Highly Effective'; else if (diversionRate>40) effectiveness='Moderately Effective';
  return { diversionRate, referralSuccessRate:referralRate, estimatedSavings:savings, programEffectiveness:effectiveness };
}

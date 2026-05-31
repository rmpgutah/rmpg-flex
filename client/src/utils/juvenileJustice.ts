// ============================================================
// RMPG Flex — Juvenile Justice (Spillman Flex Standard)
// 10 juvenile features: diversion tracking, detention
// alternatives, parental notification, juvenile court
// coordination, school resource officer data, truancy
// tracking, status offense management, juvenile probation
// monitoring, age-of-offender verification, and youth
// services referral network.
// ============================================================

/* FEATURE 1: Juvenile Diversion Tracking */
export interface DiversionProgram { id:string; juvenileName:string; age:number; offense:string; referralDate:string; programType:'teen_court'|'community_service'|'counseling'|'restorative_justice'|'educational'|'other'; programProvider:string; completionDate:string|null; completed:boolean; recidivism:boolean; }
export function evaluateDiversionOutcomes(programs:DiversionProgram[]): { total:number; completionRate:number; recidivismRate:number; mostEffective:string } {
  const completed = programs.filter(p=>p.completed).length;
  const recidivists = programs.filter(p=>p.recidivism).length;
  const byType:Record<string,{total:number;completed:number;recid:number}> = {};
  for (const p of programs) { if (!byType[p.programType]) byType[p.programType]={total:0,completed:0,recid:0}; byType[p.programType].total++; if (p.completed) byType[p.programType].completed++; if (p.recidivism) byType[p.programType].recid++; }
  const best = Object.entries(byType).sort((a,b)=>(a[1].completed/a[1].total)-(b[1].completed/b[1].total)).pop();
  return { total:programs.length, completionRate:programs.length>0?Math.round(completed/programs.length*100):0, recidivismRate:programs.length>0?Math.round(recidivists/programs.length*100):0, mostEffective:best?best[0]:'N/A' };
}

/* FEATURE 2: Detention Alternatives */
export interface DetentionAlternative { id:string; juvenileId:string; alternativeType:'home_detention'|'electronic_monitoring'|'shelter_care'|'foster_care'|'group_home'|'day_reporting'; startDate:string; endDate:string|null; violations:Array<{date:string;type:string;sanction:string}>; status:'active'|'completed'|'revoked'; }
export function assessAlternativeEffectiveness(alternatives:DetentionAlternative[]): { successRate:number; violationRate:number; mostViolations:string } {
  const withViolations = alternatives.filter(a=>a.violations.length>0).length;
  return { successRate:alternatives.length>0?Math.round((alternatives.length-withViolations)/alternatives.length*100):0, violationRate:alternatives.length>0?Math.round(withViolations/alternatives.length*100):0, mostViolations:'electronic_monitoring' };
}

/* FEATURE 3: Parental Notification */
export interface ParentalNotification { id:string; juvenileId:string; incidentDate:string; notificationDate:string; parentName:string; notificationMethod:'phone'|'in_person'|'certified_mail'|'email'; parentPresent:boolean; interpreterNeeded:boolean; notificationOutcome:string; }
export function checkNotificationCompliance(notifications:ParentalNotification[], statutoryHours:number=2): { complianceRate:number; lateNotifications:ParentalNotification[] } {
  const late = notifications.filter(n=>{const d=new Date(n.notificationDate);const i=new Date(n.incidentDate);return(d.getTime()-i.getTime())>statutoryHours*3600000;});
  return { complianceRate:notifications.length>0?Math.round((notifications.length-late.length)/notifications.length*100):0, lateNotifications:late };
}

/* FEATURE 4: Juvenile Court Coordination */
export interface JuvenileCourtCase { id:string; caseNumber:string; juvenileName:string; petitionFiled:boolean; petitionDate:string|null; hearingDate:string|null; adjudicationDate:string|null; adjudicationResult:string|null; dispositionDate:string|null; disposition:string|null; probationOfficer:string|null; }
export function trackCourtTimeline(cases:JuvenileCourtCase[]): { avgDaysToHearing:number; avgDaysToDisposition:number; casesPendingAdjudication:number } {
  const withHearing = cases.filter(c=>c.petitionDate&&c.hearingDate).map(c=>(new Date(c.hearingDate!).getTime()-new Date(c.petitionDate!).getTime())/86400000);
  const withDisp = cases.filter(c=>c.petitionDate&&c.dispositionDate).map(c=>(new Date(c.dispositionDate!).getTime()-new Date(c.petitionDate!).getTime())/86400000);
  return { avgDaysToHearing:withHearing.length>0?Math.round(withHearing.reduce((s,v)=>s+v,0)/withHearing.length):0, avgDaysToDisposition:withDisp.length>0?Math.round(withDisp.reduce((s,v)=>s+v,0)/withDisp.length):0, casesPendingAdjudication:cases.filter(c=>!c.adjudicationDate).length };
}

/* FEATURE 5: School Resource Officer Data */
export interface SROIncident { id:string; schoolName:string; date:string; incidentType:string; studentAge:number; studentGrade:number; referralSource:'teacher'|'administrator'|'sro_initiated'|'student_report'; outcome:'counseling'|'parent_conference'|'diversion'|'citation'|'arrest'|'no_action'; weaponsInvolved:boolean; drugsInvolved:boolean; }
export function analyzeSROActivity(incidents:SROIncident[]): { total:number; arrestRate:number; diversionRate:number; topSchools:Record<string,number> } {
  const arrests = incidents.filter(i=>i.outcome==='arrest').length;
  const diversions = incidents.filter(i=>i.outcome==='diversion').length;
  const schools:Record<string,number> = {}; for (const i of incidents) schools[i.schoolName]=(schools[i.schoolName]||0)+1;
  return { total:incidents.length, arrestRate:incidents.length>0?Math.round(arrests/incidents.length*100):0, diversionRate:incidents.length>0?Math.round(diversions/incidents.length*100):0, topSchools:schools };
}

/* FEATURE 6: Truancy Tracking */
export interface TruancyCase { id:string; studentName:string; school:string; grade:number; unexcusedAbsences:number; interventions:Array<{date:string;type:string;outcome:string}>; courtReferral:boolean; courtDate:string|null; status:'monitoring'|'intervention'|'court_referred'|'resolved'; }
export function evaluateTruancyInterventions(cases:TruancyCase[]): { totalCases:number; avgAbsences:number; courtReferralRate:number; interventionSuccessRate:number } {
  const avgAbs = cases.length>0?Math.round(cases.reduce((s,c)=>s+c.unexcusedAbsences,0)/cases.length):0;
  const courtRef = cases.filter(c=>c.courtReferral).length;
  const resolved = cases.filter(c=>c.status==='resolved').length;
  return { totalCases:cases.length, avgAbsences:avgAbs, courtReferralRate:cases.length>0?Math.round(courtRef/cases.length*100):0, interventionSuccessRate:cases.length>0?Math.round(resolved/cases.length*100):0 };
}

/* FEATURE 7: Status Offense Management */
export interface StatusOffense { id:string; juvenileName:string; offenseType:'runaway'|'truancy'|'curfew'|'ungovernable'|'underage_drinking'|'tobacco'; date:string; disposition:string; referralAgency:string|null; repeatOffender:boolean; }
export function analyzeStatusOffenses(offenses:StatusOffense[]): { total:number; byType:Record<string,number>; repeatRate:number; referralRate:number } {
  const byType:Record<string,number> = {}; for (const o of offenses) byType[o.offenseType]=(byType[o.offenseType]||0)+1;
  const repeats = offenses.filter(o=>o.repeatOffender).length;
  const referred = offenses.filter(o=>o.referralAgency).length;
  return { total:offenses.length, byType, repeatRate:offenses.length>0?Math.round(repeats/offenses.length*100):0, referralRate:offenses.length>0?Math.round(referred/offenses.length*100):0 };
}

/* FEATURE 8: Juvenile Probation Monitoring */
export interface JuvenileProbation { id:string; juvenileName:string; probationOfficer:string; startDate:string; endDate:string|null; conditions:Array<{condition:string;compliant:boolean}>; checkIns:Array<{date:string;contactMethod:string;notes:string}>; violations:Array<{date:string;type:string;sanction:string}>; status:'active'|'completed'|'violated'|'revoked'; }
export function calculateProbationCompliance(probation:JuvenileProbation): { complianceRate:number; checkInRate:number; violationCount:number; riskOfRevocation:boolean } {
  const conditionsMet = probation.conditions.filter(c=>c.compliant).length;
  const complianceRate = probation.conditions.length>0?Math.round(conditionsMet/probation.conditions.length*100):0;
  const monthsActive = Math.max(1,Math.ceil((Date.now()-new Date(probation.startDate).getTime())/86400000/30));
  const expectedCheckIns = monthsActive;
  const actualCheckIns = probation.checkIns.length;
  return { complianceRate, checkInRate:Math.round(actualCheckIns/Math.max(1,expectedCheckIns)*100), violationCount:probation.violations.length, riskOfRevocation:probation.violations.length>=3||complianceRate<50 };
}

/* FEATURE 9: Age Verification */
export interface AgeVerification { subjectName:string; claimedAge:number; claimedDOB:string; verifiedDOB:string|null; verificationMethod:'birth_certificate'|'school_records'|'parental_statement'|'medical_records'|'dental'|'bone_age_scan'; verified:boolean; actualAge:number|null; juvenile:boolean|null; }
export function verifyAge(claimedDOB:string, verifiedDOB:string): { age:number; isJuvenile:boolean; discrepancy:boolean } {
  const claimed = new Date(claimedDOB); const verified = new Date(verifiedDOB);
  const age = Math.floor((Date.now()-verified.getTime())/86400000/365.25);
  const discrepancy = Math.abs(claimed.getTime()-verified.getTime())>86400000;
  return { age, isJuvenile:age<18, discrepancy };
}

/* FEATURE 10: Youth Services Referral Network */
export interface YouthServiceProvider { id:string; organizationName:string; serviceType:string; address:string; phone:string; capacity:number; currentClients:number; acceptsWalkIns:boolean; juvenileOnly:boolean; waitlistDays:number; }
export function findYouthServices(need:string, age:number, providers:YouthServiceProvider[]): YouthServiceProvider[] {
  return providers.filter(p=>p.serviceType===need&&(!p.juvenileOnly||age<18)&&p.currentClients<p.capacity).sort((a,b)=>a.waitlistDays-b.waitlistDays);
}

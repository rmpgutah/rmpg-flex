// ============================================================
// RMPG Flex — Labor Relations (Spillman Flex Standard)
// 10 labor features: grievance tracking, union contract
// management, disciplinary due process, meet-and-confer
// documentation, bargaining unit tracking, labor dispute
// resolution, arbitration case management, employee
// association roster, contract negotiation timeline,
// and labor relations compliance.
// ============================================================

/* FEATURE 41: Grievance Tracking */
export interface Grievance { id:string; grievantName:string; grievantId:string; filingDate:string; grievanceType:'contract_violation'|'disciplinary'|'harassment'|'discrimination'|'working_conditions'|'pay'|'other'; description:string; step:1|2|3|4; stepDate:string; unionRepresentative:string|null; managementResponse:string|null; resolution:string|null; resolutionDate:string|null; status:'open'|'resolved'|'withdrawn'|'arbitration'; }
export function trackGrievanceTimeline(grievances:Grievance[]): { total:number; avgTimeToResolve:number; byType:Record<string,number>; arbitrationRate:number } {
  const resolved = grievances.filter(g=>g.resolutionDate);
  const days = resolved.map(g=>(new Date(g.resolutionDate!).getTime()-new Date(g.filingDate).getTime())/86400000);
  const byType:Record<string,number> = {}; for (const g of grievances) byType[g.grievanceType]=(byType[g.grievanceType]||0)+1;
  const toArbitration = grievances.filter(g=>g.status==='arbitration').length;
  return { total:grievances.length, avgTimeToResolve:days.length>0?Math.round(days.reduce((s,v)=>s+v,0)/days.length):0, byType, arbitrationRate:grievances.length>0?Math.round(toArbitration/grievances.length*100):0 };
}

/* FEATURE 42: Union Contract Management */
export interface UnionContract { id:string; unionName:string; contractStart:string; contractEnd:string; articles:Array<{number:number;title:string;summary:string;lastAmended:string|null}>; MOUs:Array<{title:string;date:string;description:string}>; sideLetters:Array<{title:string;date:string;description:string}>; status:'active'|'expired'|'negotiating'; }
export function checkContractStatus(contracts:UnionContract[]): { active:number; expired:number; negotiating:number; daysToExpiration:Record<string,number> } {
  const now = new Date(); const active = contracts.filter(c=>c.status==='active'&&new Date(c.contractEnd)>now);
  const expired = contracts.filter(c=>c.status==='expired'||new Date(c.contractEnd)<now);
  const negotiating = contracts.filter(c=>c.status==='negotiating');
  const daysToExp:Record<string,number> = {}; for (const c of active) daysToExp[c.unionName]=Math.ceil((new Date(c.contractEnd).getTime()-now.getTime())/86400000);
  return { active:active.length, expired:expired.length, negotiating:negotiating.length, daysToExpiration:daysToExp };
}

/* FEATURE 43: Disciplinary Due Process */
export interface DueProcessCheck { disciplineId:string; officerId:string; preDisciplinaryHearing:boolean; hearingDate:string|null; unionRepresentationOffered:boolean; unionRepresentationPresent:boolean; evidenceProvided:boolean; opportunityToRespond:boolean; writtenDecision:boolean; appealRightsGiven:boolean; compliant:boolean; }
export function validateDueProcess(check:DueProcessCheck): { requirementsMet:number; totalRequirements:number; compliant:boolean; violations:string[] } {
  const reqs = ['preDisciplinaryHearing','unionRepresentationOffered','evidenceProvided','opportunityToRespond','writtenDecision','appealRightsGiven'];
  const violations = reqs.filter(r=>!(check as any)[r]);
  return { requirementsMet:reqs.length-violations.length, totalRequirements:reqs.length, compliant:violations.length===0, violations };
}

/* FEATURE 44: Meet-and-Confer Documentation */
export interface MeetAndConfer { id:string; date:string; topic:string; unionRepresentatives:string[]; managementRepresentatives:string[]; proposals:Array<{party:string;proposal:string;response:string|null}>; agreements:string[]; outstandingItems:string[]; nextMeeting:string|null; }
export function trackNegotiationProgress(meetings:MeetAndConfer[]): { totalMeetings:number; agreementsReached:number; itemsPerMeeting:number; outstandingTotal:number } {
  const totalAgreements = meetings.reduce((s,m)=>s+m.agreements.length,0);
  const totalOutstanding = meetings.reduce((s,m)=>s+m.outstandingItems.length,0);
  return { totalMeetings:meetings.length, agreementsReached:totalAgreements, itemsPerMeeting:meetings.length>0?Math.round(totalAgreements/meetings.length):0, outstandingTotal:totalOutstanding };
}

/* FEATURE 45: Bargaining Unit Tracking */
export interface BargainingUnit { id:string; unitName:string; unionName:string; memberCount:number; eligibleCount:number; membershipRate:number; contractId:string; stewardCount:number; status:'active'|'decertification_pending'; }
export function calculateUnionDensity(units:BargainingUnit[]): { totalMembers:number; totalEligible:number; overallDensity:number; byUnit:Record<string,number> } {
  const totalMembers = units.reduce((s,u)=>s+u.memberCount,0);
  const totalEligible = units.reduce((s,u)=>s+u.eligibleCount,0);
  const byUnit:Record<string,number> = {}; for (const u of units) byUnit[u.unitName]=Math.round(u.memberCount/u.eligibleCount*100);
  return { totalMembers, totalEligible, overallDensity:totalEligible>0?Math.round(totalMembers/totalEligible*100):0, byUnit };
}

/* FEATURE 46: Labor Dispute Resolution */
export interface LaborDispute { id:string; disputeType:'unfair_labor_practice'|'impasse'|'strike'|'lockout'|'jurisdictional'; filingDate:string; filedBy:string; againstParty:string; mediator:string|null; mediationSessions:number; resolutionDate:string|null; resolution:string|null; status:'pending'|'mediation'|'resolved'|'litigation'; }
export function evaluateDisputeResolution(disputes:LaborDispute[]): { total:number; resolved:number; mediationSuccessRate:number; avgTimeToResolve:number } {
  const resolved = disputes.filter(d=>d.status==='resolved');
  const mediated = disputes.filter(d=>d.mediationSessions>0);
  const mediatedResolved = mediated.filter(d=>d.status==='resolved');
  const days = resolved.map(d=>(new Date(d.resolutionDate!).getTime()-new Date(d.filingDate).getTime())/86400000);
  return { total:disputes.length, resolved:resolved.length, mediationSuccessRate:mediated.length>0?Math.round(mediatedResolved.length/mediated.length*100):0, avgTimeToResolve:days.length>0?Math.round(days.reduce((s,v)=>s+v,0)/days.length):0 };
}

/* FEATURE 47: Arbitration Case Management */
export interface ArbitrationCase { id:string; grievanceId:string; arbitrator:string; arbitrationDate:string; preHearingBrief:string|null; exhibits:number; witnesses:number; decisionDate:string|null; decision:'sustained'|'denied'|'split'|'pending'; award:string|null; }
export function trackArbitrationOutcomes(cases:ArbitrationCase[]): { total:number; sustainedRate:number; deniedRate:number; splitRate:number; avgDaysToDecision:number } {
  const decided = cases.filter(c=>c.decision!=='pending');
  const sustained = decided.filter(c=>c.decision==='sustained').length;
  const denied = decided.filter(c=>c.decision==='denied').length;
  const days = decided.map(c=>(new Date(c.decisionDate!).getTime()-new Date(c.arbitrationDate).getTime())/86400000);
  return { total:cases.length, sustainedRate:decided.length>0?Math.round(sustained/decided.length*100):0, deniedRate:decided.length>0?Math.round(denied/decided.length*100):0, splitRate:decided.length>0?Math.round(decided.filter(c=>c.decision==='split').length/decided.length*100):0, avgDaysToDecision:days.length>0?Math.round(days.reduce((s,v)=>s+v,0)/days.length):0 };
}

/* FEATURE 48: Employee Association Roster */
export interface AssociationMember { id:string; employeeId:string; employeeName:string; associationName:string; joinDate:string; duesWithholding:boolean; stewardStatus:boolean; unionOfficerRole:string|null; committeeAssignments:string[]; }
export function manageAssociationRoster(members:AssociationMember[]): { totalMembers:number; byAssociation:Record<string,number>; stewardCount:number; duesWithholdingRate:number } {
  const byAssoc:Record<string,number> = {}; for (const m of members) byAssoc[m.associationName]=(byAssoc[m.associationName]||0)+1;
  const stewards = members.filter(m=>m.stewardStatus).length;
  const dues = members.filter(m=>m.duesWithholding).length;
  return { totalMembers:members.length, byAssociation:byAssoc, stewardCount:stewards, duesWithholdingRate:members.length>0?Math.round(dues/members.length*100):0 };
}

/* FEATURE 49: Contract Negotiation Timeline */
export interface NegotiationTimeline { contractId:string; unionName:string; negotiationStart:string; sessions:Array<{date:string;topics:string[];progress:string}>; tentativeAgreementDate:string|null; ratificationDate:string|null; effectiveDate:string|null; status:'preparing'|'negotiating'|'tentative'|'ratified'|'implemented'|'impasse'; }
export function estimateNegotiationCompletion(timeline:NegotiationTimeline): { estimatedCompletion:string; progressPct:number; remainingSessions:number; riskOfImpasse:boolean } {
  const sessions = timeline.sessions.length;
  const progress = timeline.status==='ratified'||timeline.status==='implemented'?100:timeline.status==='tentative'?85:sessions*10;
  return { estimatedCompletion:new Date(Date.now()+90*86400000).toISOString().slice(0,10), progressPct:Math.min(95,progress), remainingSessions:Math.max(0,8-sessions), riskOfImpasse:timeline.status==='impasse'||sessions>8 };
}

/* FEATURE 50: Labor Relations Compliance */
export interface LaborCompliance { requirement:string; regulation:string; compliant:boolean; lastReviewDate:string; nextReviewDate:string; responsibleParty:string; documentation:string[]; }
export function auditLaborCompliance(items:LaborCompliance[]): { complianceRate:number; overdue:number; findings:string[] } {
  const now = new Date(); const compliant = items.filter(i=>i.compliant);
  const overdue = items.filter(i=>new Date(i.nextReviewDate)<now);
  const findings = items.filter(i=>!i.compliant).map(i=>`${i.requirement}: ${i.regulation}`);
  return { complianceRate:items.length>0?Math.round(compliant.length/items.length*100):0, overdue:overdue.length, findings };
}

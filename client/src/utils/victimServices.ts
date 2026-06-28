// ============================================================
// RMPG Flex — Victim Services (Spillman Flex Standard)
// 10 victim features: victim notification, advocate tracking,
// restitution management, victim impact statements, protective
// orders, victim compensation, safety planning, victim rights
// compliance, referral services, and victim case tracking.
// ============================================================

/* FEATURE 41: Victim Notification */
export interface VictimNotification { id:string; caseNumber:string; victimName:string; victimContact:string; notificationType:'arrest'|'release'|'court_date'|'case_disposition'|'appeal'|'parole_hearing'; notificationDate:string|null; notificationMethod:'phone'|'mail'|'email'|'in_person'; status:'pending'|'sent'|'delivered'|'failed'; notes:string; }
export function checkNotificationCompliance(notifications:VictimNotification[], requiredTypes:VictimNotification['notificationType'][]): { compliant:boolean; missingTypes:string[]; overdue:VictimNotification[] } {
  const sent = notifications.filter(n=>n.status==='sent'||n.status==='delivered');
  const sentTypes = new Set(sent.map(n=>n.notificationType));
  const missing = requiredTypes.filter(t=>!sentTypes.has(t));
  const overdue = notifications.filter(n=>n.status==='pending'&&n.notificationDate&&new Date(n.notificationDate)<new Date());
  return { compliant:missing.length===0, missingTypes:missing, overdue };
}

/* FEATURE 42: Victim Advocate Tracking */
export interface VictimAdvocate { id:string; name:string; organization:string; casesAssigned:number; specialization:string[]; contactInfo:string; availability:string; languages:string[]; }
export function assignAdvocate(victim: {caseType:string;language:string;specialNeeds:string[]}, advocates:VictimAdvocate[]): VictimAdvocate|null {
  const scored = advocates.map(a=>{let score=0; if(a.specialization.includes(victim.caseType))score+=30; if(a.languages.includes(victim.language))score+=25; if(a.casesAssigned<15)score+=20; return {advocate:a,score};});
  scored.sort((a,b)=>b.score-a.score);
  return scored.length>0?scored[0].advocate:null;
}

/* FEATURE 43: Restitution Management */
export interface RestitutionOrder { id:string; caseNumber:string; victimId:string; offenderName:string; orderedAmount:number; paidAmount:number; balance:number; paymentSchedule:string; lastPayment:string|null; enforcementAction:string|null; status:'active'|'paid'|'default'|'waived'; }
export function trackRestitutionCollection(orders:RestitutionOrder[]): { totalOrdered:number; totalCollected:number; collectionRate:number; inDefault:RestitutionOrder[]; avgBalance:number } {
  const totalOrd = orders.reduce((s,o)=>s+o.orderedAmount,0);
  const totalColl = orders.reduce((s,o)=>s+o.paidAmount,0);
  const inDefault = orders.filter(o=>o.status==='default');
  const avgBalance = orders.length>0?Math.round(orders.reduce((s,o)=>s+o.balance,0)/orders.length):0;
  return { totalOrdered:totalOrd, totalCollected:totalColl, collectionRate:totalOrd>0?Math.round(totalColl/totalOrd*100):0, inDefault, avgBalance };
}

/* FEATURE 44: Victim Impact Statements */
export interface VictimImpactStatement { id:string; caseNumber:string; victimName:string; statementDate:string; statementType:'written'|'video'|'audio'|'in_person'; statementSummary:string; submittedToCourt:boolean; submissionDate:string|null; reviewedBy:string|null; confidentiality:'public'|'restricted'|'sealed'; }
export function manageImpactStatements(statements:VictimImpactStatement[]): { total:number; submittedToCourt:number; pendingSubmission:number; avgDaysToSubmit:number } {
  const submitted = statements.filter(s=>s.submittedToCourt);
  const pending = statements.filter(s=>!s.submittedToCourt);
  const days = submitted.filter(s=>s.submissionDate).map(s=>Math.ceil((new Date(s.submissionDate!).getTime()-new Date(s.statementDate).getTime())/86400000));
  const avgDays = days.length>0?Math.round(days.reduce((s,v)=>s+v,0)/days.length):0;
  return { total:statements.length, submittedToCourt:submitted.length, pendingSubmission:pending.length, avgDaysToSubmit:avgDays };
}

/* FEATURE 45: Protective Orders */
export interface ProtectiveOrder { id:string; caseNumber:string; protectedPerson:string; restrainedPerson:string; orderType:'TRO'|'CPO'|'EPO'|'no_contact'; issuedDate:string; expirationDate:string; serviceStatus:'pending'|'served'|'unable'; servedDate:string|null; violations:Array<{date:string;description:string;arrestMade:boolean}>; }
export function checkProtectiveOrderStatus(orders:ProtectiveOrder[]): { active:number; expiringSoon:number; unserved:number; withViolations:number } {
  const now = new Date(); const thirtyDays = new Date(now.getTime()+30*86400000);
  const active = orders.filter(o=>new Date(o.expirationDate)>now);
  const expiring = active.filter(o=>new Date(o.expirationDate)<thirtyDays);
  const unserved = active.filter(o=>o.serviceStatus==='pending'||o.serviceStatus==='unable');
  const withViolations = active.filter(o=>o.violations.length>0);
  return { active:active.length, expiringSoon:expiring.length, unserved:unserved.length, withViolations:withViolations.length };
}

/* FEATURE 46: Victim Compensation */
export interface CompensationClaim { id:string; victimId:string; caseNumber:string; claimType:string; expenses:Array<{type:string;amount:number;documented:boolean}>; totalClaimed:number; totalApproved:number; status:'submitted'|'under_review'|'approved'|'partial'|'denied'|'paid'; reviewDate:string|null; }
export function processCompensationClaim(claim:CompensationClaim): { documentable:number; undocumented:number; recommendedApproval:number; decision:string } {
  const documented = claim.expenses.filter(e=>e.documented);
  const undocumented = claim.expenses.filter(e=>!e.documented);
  const totalDoc = documented.reduce((s,e)=>s+e.amount,0);
  return { documentable:documented.length, undocumented:undocumented.length, recommendedApproval:totalDoc, decision:undocumented.length>0?`Partial approval recommended — ${undocumented.length} expenses require documentation`:'Full approval recommended' };
}

/* FEATURE 47: Safety Planning */
export interface SafetyPlan { id:string; victimId:string; createdDate:string; reviewedDate:string|null; riskLevel:'low'|'moderate'|'high'|'extreme'; safeLocation:string|null; emergencyContacts:string[]; codeWord:string; documentsSecured:boolean; transportationPlan:string; childrenSafetyPlan:string; petSafetyPlan:string; reviewed:boolean; }
export function evaluateSafetyPlan(plan:SafetyPlan): { completeness:number; missingElements:string[]; requiresUpdate:boolean } {
  const required = ['safeLocation','emergencyContacts','transportationPlan','documentsSecured']; const missing = required.filter(r=>!(plan as any)[r]);
  const completeness = Math.round((required.length-missing.length)/required.length*100);
  return { completeness, missingElements:missing, requiresUpdate:!plan.reviewed||(plan.reviewedDate?new Date(plan.reviewedDate).getTime()<Date.now()-180*86400000:true) };
}

/* FEATURE 48: Victim Rights Compliance */
export interface VictimRightsCheck { caseNumber:string; rightsNotified:boolean; notificationDate:string|null; rightsIncluded:string[]; rightsViolated:string[]; marsysLawCompliance:boolean; remediationAction:string|null; }
export function auditVictimRights(checks:VictimRightsCheck[]): { complianceRate:number; commonViolations:Record<string,number>; casesWithViolations:number } {
  const compliant = checks.filter(c=>c.rightsViolated.length===0).length;
  const violations:Record<string,number> = {}; for (const c of checks) for (const v of c.rightsViolated) violations[v]=(violations[v]||0)+1;
  return { complianceRate:checks.length>0?Math.round(compliant/checks.length*100):100, commonViolations:violations, casesWithViolations:checks.filter(c=>c.rightsViolated.length>0).length };
}

/* FEATURE 49: Referral Services */
export interface ServiceReferral { id:string; victimId:string; serviceType:string; providerName:string; referralDate:string; contacted:boolean; enrolled:boolean; outcome:string|null; followUpDate:string|null; }
export function analyzeReferralNetwork(referrals:ServiceReferral[]): { totalReferrals:number; enrollmentRate:number; byServiceType:Record<string,{total:number;enrolled:number}>; gaps:string[] } {
  const byType:Record<string,{total:number;enrolled:number}> = {};
  for (const r of referrals) { if (!byType[r.serviceType]) byType[r.serviceType]={total:0,enrolled:0}; byType[r.serviceType].total++; if (r.enrolled) byType[r.serviceType].enrolled++; }
  const gaps = Object.entries(byType).filter(([,v])=>v.total>0&&v.enrolled/v.total<0.3).map(([k])=>k);
  const enrolled = referrals.filter(r=>r.enrolled).length;
  return { totalReferrals:referrals.length, enrollmentRate:referrals.length>0?Math.round(enrolled/referrals.length*100):0, byServiceType:byType, gaps };
}

/* FEATURE 50: Victim Case Tracking */
export interface VictimCaseTracker { caseNumber:string; victimName:string; lastContactDate:string|null; nextContactDate:string|null; caseStatus:string; defendantStatus:string; upcomingCourtDates:string[]; restitutionStatus:string; safetyConcerns:string[]; satisfactionRating:number|null; }
export function prioritizeVictimFollowUp(cases:VictimCaseTracker[]): VictimCaseTracker[] {
  return [...cases].sort((a,b) => {
    const aScore = (a.safetyConcerns.length*10) + (!a.lastContactDate?5:0) + (a.nextContactDate&&new Date(a.nextContactDate)<new Date()?8:0);
    const bScore = (b.safetyConcerns.length*10) + (!b.lastContactDate?5:0) + (b.nextContactDate&&new Date(b.nextContactDate)<new Date()?8:0);
    return bScore - aScore;
  });
}

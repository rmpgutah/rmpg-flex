// ============================================================
// RMPG Flex — Reserve & Explorer Programs (Spillman Flex Standard)
// 10 features: reserve officer tracking, explorer/cadet
// program, volunteer hours, training management, equipment
// issuance, deployment history, certification maintenance,
// mentorship assignments, recruitment outreach, and
// program statistical reporting.
// ============================================================

/* FEATURE 51: Reserve Officer Tracking */
export interface ReserveOfficer { id:string; name:string; rank:string; joinDate:string; status:'active'|'inactive'|'suspended'|'resigned'; hoursThisMonth:number; hoursThisYear:number; minHoursRequired:number; certifications:Array<{name:string;expirationDate:string}>; assignedFTO:string|null; }
export function checkReserveCompliance(officers:ReserveOfficer[]): { total:number; compliantHours:number; nonCompliant:ReserveOfficer[]; expiringCerts:number } {
  const now = new Date(); const thirtyDays = new Date(now.getTime()+30*86400000);
  const nonCompliant = officers.filter(o=>o.status==='active'&&o.hoursThisYear<o.minHoursRequired);
  const expiringCerts = officers.filter(o=>o.certifications.some(c=>new Date(c.expirationDate)<thirtyDays)).length;
  return { total:officers.length, compliantHours:officers.length-nonCompliant.length, nonCompliant, expiringCerts };
}

/* FEATURE 52: Explorer/Cadet Program */
export interface Explorer { id:string; name:string; age:number; joinDate:string; postAssignment:string; rideAlongHours:number; trainingHours:number; communityServiceHours:number; advisor:string; status:'active'|'graduated'|'withdrawn'; }
export function evaluateExplorerProgress(explorers:Explorer[]): { total:number; avgHours:number; graduationEligible:number } {
  const avgRideHours = explorers.length>0?Math.round(explorers.reduce((s,e)=>s+e.rideAlongHours,0)/explorers.length):0;
  const gradEligible = explorers.filter(e=>e.rideAlongHours>=100&&e.trainingHours>=40).length;
  return { total:explorers.length, avgHours:avgRideHours, graduationEligible:gradEligible };
}

/* FEATURE 53: Volunteer Hours Tracking */
export interface VolunteerHours { id:string; volunteerId:string; date:string; activityType:string; hours:number; location:string; supervisor:string; verified:boolean; }
export function calculateVolunteerValue(hours:VolunteerHours[], hourlyValue:number=31.80): { totalHours:number; totalValue:number; byActivity:Record<string,number> } {
  const total = hours.reduce((s,h)=>s+h.hours,0);
  const byAct:Record<string,number> = {}; for (const h of hours) byAct[h.activityType]=(byAct[h.activityType]||0)+h.hours;
  return { totalHours:total, totalValue:Math.round(total*hourlyValue), byActivity:byAct };
}

/* FEATURE 54: Training Management */
export interface ReserveTraining { id:string; courseName:string; date:string; instructor:string; hours:number; attendees:number; topic:string; mandatory:boolean; }
export function trackReserveTraining(courses:ReserveTraining[]): { totalCourses:number; totalHours:number; avgAttendance:number; mandatoryCompletion:number } {
  const totalHrs = courses.reduce((s,c)=>s+c.hours,0);
  const avgAtt = courses.length>0?Math.round(courses.reduce((s,c)=>s+c.attendees,0)/courses.length):0;
  const mandatory = courses.filter(c=>c.mandatory).length;
  return { totalCourses:courses.length, totalHours:totalHrs, avgAttendance:avgAtt, mandatoryCompletion:mandatory };
}

/* FEATURE 55: Equipment Issuance */
export interface ReserveEquipment { id:string; officerId:string; equipmentType:string; serialNumber:string; issuedDate:string; returnDate:string|null; condition:string; notes:string; }
export function trackEquipmentIssuance(items:ReserveEquipment[]): { totalIssued:number; currentlyOut:number; overdue:ReserveEquipment[] } {
  const now = new Date(); const out = items.filter(i=>!i.returnDate);
  const overdue = out.filter(i=>new Date(i.issuedDate).getTime()+365*86400000<now.getTime());
  return { totalIssued:items.length, currentlyOut:out.length, overdue };
}

/* FEATURE 56: Deployment History */
export interface ReserveDeployment { id:string; officerId:string; date:string; callType:string; hours:number; supervisor:string; notes:string; }
export function analyzeReserveDeployments(deployments:ReserveDeployment[]): { total:number; totalHours:number; byCallType:Record<string,number> } {
  const totalHrs = deployments.reduce((s,d)=>s+d.hours,0);
  const byType:Record<string,number> = {}; for (const d of deployments) byType[d.callType]=(byType[d.callType]||0)+1;
  return { total:deployments.length, totalHours:totalHrs, byCallType:byType };
}

/* FEATURE 57: Certification Maintenance */
export interface ReserveCertification { officerId:string; certName:string; issueDate:string; expirationDate:string; renewalHours:number; hoursCompleted:number; status:'current'|'expiring'|'expired'; }
export function trackCertificationStatus(certs:ReserveCertification[]): { current:number; expiring:number; expired:number; complianceRate:number } {
  const now = new Date(); const thirtyDays = new Date(now.getTime()+30*86400000);
  const current = certs.filter(c=>new Date(c.expirationDate)>thirtyDays);
  const expiring = certs.filter(c=>new Date(c.expirationDate)<=thirtyDays&&new Date(c.expirationDate)>now);
  const expired = certs.filter(c=>new Date(c.expirationDate)<=now);
  return { current:current.length, expiring:expiring.length, expired:expired.length, complianceRate:certs.length>0?Math.round(current.length/certs.length*100):0 };
}

/* FEATURE 58: Mentorship Assignments */
export interface MentorshipAssignment { id:string; mentorId:string; mentorName:string; menteeId:string; menteeName:string; startDate:string; endDate:string|null; meetingFrequency:string; goals:string[]; progressNotes:string[]; }
export function evaluateMentorshipPairings(assignments:MentorshipAssignment[]): { active:number; completed:number; avgDurationMonths:number } {
  const completed = assignments.filter(a=>a.endDate);
  const durations = completed.map(a=>(new Date(a.endDate!).getTime()-new Date(a.startDate).getTime())/86400000/30);
  return { active:assignments.filter(a=>!a.endDate).length, completed:completed.length, avgDurationMonths:durations.length>0?Math.round(durations.reduce((s,v)=>s+v,0)/durations.length):0 };
}

/* FEATURE 59: Recruitment Outreach */
export interface ReserveOutreach { id:string; eventName:string; date:string; location:string; attendees:number; applications:number; followUps:number; cost:number; }
export function calculateOutreachROI(events:ReserveOutreach[]): { totalCost:number; totalApplications:number; costPerApplication:number; mostEffective:string } {
  const totalCost = events.reduce((s,e)=>s+e.cost,0);
  const totalApps = events.reduce((s,e)=>s+e.applications,0);
  const byEvent = events.sort((a,b)=>(a.applications/a.cost)-(b.applications/b.cost));
  return { totalCost, totalApplications:totalApps, costPerApplication:totalApps>0?Math.round(totalCost/totalApps):0, mostEffective:byEvent.length>0?byEvent[byEvent.length-1].eventName:'N/A' };
}

/* FEATURE 60: Program Statistical Reporting */
export interface ReserveProgramStats { period:string; activeReserves:number; activeExplorers:number; totalVolunteerHours:number; volunteerValue:number; deployments:number; trainingHours:number; newApplicants:number; attritionRate:number; budgetUtilization:number; }
export function compileReserveStats(data:{reserves:ReserveOfficer[];explorers:Explorer[];hours:VolunteerHours[];deployments:ReserveDeployment[];training:ReserveTraining[]}): ReserveProgramStats {
  const volunteerHrs = data.hours.reduce((s,h)=>s+h.hours,0);
  return { period:new Date().toISOString().slice(0,7), activeReserves:data.reserves.filter(o=>o.status==='active').length, activeExplorers:data.explorers.filter(e=>e.status==='active').length, totalVolunteerHours:volunteerHrs, volunteerValue:Math.round(volunteerHrs*31.80), deployments:data.deployments.length, trainingHours:data.training.reduce((s,t)=>s+t.hours,0), newApplicants:0, attritionRate:0, budgetUtilization:0 };
}

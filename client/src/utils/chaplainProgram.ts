// ============================================================
// RMPG Flex — Chaplain Program (Spillman Flex Standard)
// 10 chaplain features: chaplain roster, deployment tracking,
// critical incident response, death notification protocols,
// officer wellness visits, hospital visits, community
// outreach, training records, on-call scheduling, and
// chaplain program metrics.
// ============================================================

/* FEATURE 61: Chaplain Roster */
export interface Chaplain { id:string; name:string; faithTradition:string; ordinationStatus:string; joinDate:string; certifications:string[]; status:'active'|'inactive'|'resigned'; contactPhone:string; availability:string[]; }
export function findAvailableChaplain(faithPreference:string|null, chaplains:Chaplain[]): Chaplain|null {
  const available = chaplains.filter(c=>c.status==='active');
  if (faithPreference) { const match = available.find(c=>c.faithTradition===faithPreference); if (match) return match; }
  return available.length>0?available[0]:null;
}

/* FEATURE 62: Deployment Tracking */
export interface ChaplainDeployment { id:string; chaplainId:string; date:string; deploymentType:'critical_incident'|'death_notification'|'hospital_visit'|'officer_wellness'|'community_event'|'training'; location:string; durationHours:number; notes:string; }
export function analyzeChaplainActivity(deployments:ChaplainDeployment[]): { total:number; totalHours:number; byType:Record<string,number> } {
  const byType:Record<string,number> = {}; for (const d of deployments) byType[d.deploymentType]=(byType[d.deploymentType]||0)+1;
  return { total:deployments.length, totalHours:deployments.reduce((s,d)=>s+d.durationHours,0), byType };
}

/* FEATURE 63: Critical Incident Response */
export interface CIRResponse { incidentId:string; chaplainId:string; responseTime:string; incidentType:string; servicesProvided:string[]; officersContacted:number; familiesContacted:number; followUpNeeded:boolean; followUpDate:string|null; }
export function evaluateCIRResponse(response:CIRResponse): { coverageAdequate:boolean; followUpRequired:boolean } {
  return { coverageAdequate:response.officersContacted>0, followUpRequired:response.followUpNeeded };
}

/* FEATURE 64: Death Notification Protocols */
export interface DeathNotification { id:string; decedentName:string; nextOfKinName:string; notificationDate:string; chaplainId:string; officersPresent:string[]; location:string; outcome:string; }
export function prepareDeathNotification(decedentName:string, nextOfKin:string): { protocol:string[]; suggestedScript:string } {
  return { protocol:['Verify identity of deceased','Identify next of kin','Coordinate with medical examiner','Two-person notification team (officer + chaplain)','Deliver in person, never by phone','Use clear, direct language','Provide support resources'], suggestedScript:`On behalf of the Rocky Mountain Protective Group, I have some very difficult news to share with you. ${decedentName} has died. I am so sorry for your loss. We are here to support you in any way we can.` };
}

/* FEATURE 65: Officer Wellness Visits */
export interface WellnessVisit { id:string; officerId:string; chaplainId:string; visitDate:string; visitType:'routine'|'post_incident'|'family_crisis'|'health_issue'|'requested'; durationMinutes:number; concerns:string[]; referralsMade:string[]; }
export function trackWellnessVisits(visits:WellnessVisit[]): { total:number; avgDuration:number; byType:Record<string,number>; referralRate:number } {
  const byType:Record<string,number> = {}; for (const v of visits) byType[v.visitType]=(byType[v.visitType]||0)+1;
  const withReferrals = visits.filter(v=>v.referralsMade.length>0).length;
  return { total:visits.length, avgDuration:visits.length>0?Math.round(visits.reduce((s,v)=>s+v.durationMinutes,0)/visits.length):0, byType, referralRate:visits.length>0?Math.round(withReferrals/visits.length*100):0 };
}

/* FEATURE 66: Hospital Visits */
export interface HospitalVisit { id:string; patientName:string; patientType:'officer'|'officer_family'|'victim'|'community'; hospitalName:string; visitDate:string; chaplainId:string; prayerRequested:boolean; followUpNeeded:boolean; }
export function scheduleHospitalVisit(patientName:string, hospital:string, chaplainId:string): HospitalVisit {
  return { id:`hv-${Date.now()}`, patientName, patientType:'officer', hospitalName:hospital, visitDate:new Date().toISOString(), chaplainId, prayerRequested:false, followUpNeeded:false };
}

/* FEATURE 67: Community Outreach */
export interface ChaplainOutreach { id:string; eventName:string; date:string; location:string; chaplainsPresent:number; communityMembersReached:number; servicesProvided:string[]; }
export function measureOutreachImpact(events:ChaplainOutreach[]): { totalEvents:number; totalReached:number; avgPerEvent:number } {
  const totalReached = events.reduce((s,e)=>s+e.communityMembersReached,0);
  return { totalEvents:events.length, totalReached, avgPerEvent:events.length>0?Math.round(totalReached/events.length):0 };
}

/* FEATURE 68: Training Records */
export interface ChaplainTraining { id:string; chaplainId:string; courseName:string; date:string; hours:number; provider:string; certification:string|null; }
export function trackChaplainTraining(courses:ChaplainTraining[]): { total:number; totalHours:number; byChaplain:Record<string,number> } {
  const byChaplain:Record<string,number> = {}; for (const c of courses) byChaplain[c.chaplainId]=(byChaplain[c.chaplainId]||0)+c.hours;
  return { total:courses.length, totalHours:courses.reduce((s,c)=>s+c.hours,0), byChaplain };
}

/* FEATURE 69: On-Call Scheduling */
export interface ChaplainOnCall { chaplainId:string; startDate:string; endDate:string; isPrimary:boolean; backupChaplainId:string|null; }
export function manageOnCallSchedule(schedule:ChaplainOnCall[]): { currentOnCall:ChaplainOnCall[]; coverageGaps:boolean } {
  const now = new Date(); const current = schedule.filter(s=>new Date(s.startDate)<=now&&new Date(s.endDate)>=now);
  return { currentOnCall:current, coverageGaps:current.length===0 };
}

/* FEATURE 70: Chaplain Program Metrics */
export interface ChaplainMetrics { period:string; activeChaplains:number; deployments:number; wellnessVisits:number; deathNotifications:number; hospitalVisits:number; communityEvents:number; hoursServed:number; }
export function compileChaplainMetrics(data:{chaplains:number;deployments:ChaplainDeployment[];visits:WellnessVisit[];notifications:DeathNotification[];events:ChaplainOutreach[]}): ChaplainMetrics {
  return { period:new Date().toISOString().slice(0,7), activeChaplains:data.chaplains, deployments:data.deployments.length, wellnessVisits:data.visits.length, deathNotifications:data.notifications.length, hospitalVisits:0, communityEvents:data.events.length, hoursServed:data.deployments.reduce((s,d)=>s+d.durationHours,0) };
}

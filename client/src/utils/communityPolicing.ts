// ============================================================
// RMPG Flex — Community Policing (Spillman Flex Standard)
// 10 community features: community contacts, problem-oriented
// policing projects, neighborhood watch, business liaison,
// youth programs, community events, volunteer management,
// citizen satisfaction surveys, social media engagement,
// and community crime mapping.
// ============================================================

/* FEATURE 91: Community Contacts */
export interface CommunityContact { id: string; contactType: string; date: string; officerId: string; location: string; demographics: { age: string; race: string; gender: string }; outcome: string; followUpNeeded: boolean; followUpDate: string|null; notes: string; }
export function analyzeCommunityContacts(contacts: CommunityContact[]): { total: number; byType: Record<string,number>; byOfficer: Record<string,number>; avgPerDay: number; followUpRate: number } {
  const byType: Record<string,number> = {}; for (const c of contacts) byType[c.contactType] = (byType[c.contactType]||0) + 1;
  const byOfficer: Record<string,number> = {}; for (const c of contacts) byOfficer[c.officerId] = (byOfficer[c.officerId]||0) + 1;
  const days = new Set(contacts.map(c => c.date)).size;
  const followUps = contacts.filter(c => c.followUpNeeded).length;
  return { total: contacts.length, byType, byOfficer, avgPerDay: days > 0 ? Math.round(contacts.length/days*10)/10 : 0, followUpRate: contacts.length > 0 ? Math.round(followUps/contacts.length*100) : 0 };
}

/* FEATURE 92: Problem-Oriented Policing */
export interface POPProject { id: string; problem: string; location: string; startDate: string; endDate: string|null; scanningData: string; analysisFindings: string; responseStrategy: string; assessmentResults: string|null; status: 'scanning'|'analysis'|'response'|'assessment'|'closed'; partners: string[]; }
export function evaluatePOPProgress(project: POPProject): { phase: string; daysInPhase: number; stalled: boolean; recommendation: string } {
  const phases = ['scanning','analysis','response','assessment']; const phaseIdx = phases.indexOf(project.status);
  const start = new Date(project.startDate); const phaseStart = project.status === 'closed' && project.endDate ? new Date(project.endDate) : new Date();
  const daysInPhase = Math.ceil((phaseStart.getTime() - start.getTime()) / 86400000);
  let stalled = false; let rec = '';
  if (project.status === 'scanning' && daysInPhase > 30) { stalled = true; rec = 'Move to analysis phase or close project'; }
  else if (project.status === 'analysis' && daysInPhase > 60) { stalled = true; rec = 'Complete analysis and develop response strategy'; }
  else if (project.status === 'response' && daysInPhase > 90) { stalled = true; rec = 'Begin assessment of response effectiveness'; }
  else { rec = 'On track — continue current phase'; }
  return { phase: project.status, daysInPhase, stalled, recommendation: rec };
}

/* FEATURE 93: Neighborhood Watch */
export interface NeighborhoodWatch { id: string; neighborhood: string; coordinatorName: string; coordinatorContact: string; memberCount: number; meetingSchedule: string; lastMeeting: string|null; nextMeeting: string|null; activeIssues: string[]; officerLiaison: string|null; }
export function assessNWActivity(groups: NeighborhoodWatch[]): { totalGroups: number; totalMembers: number; activeGroups: number; groupsNeedingLiaison: number; avgMembers: number } {
  const now = new Date(); const ninetyDaysAgo = new Date(now.getTime() - 90*86400000);
  const active = groups.filter(g => g.lastMeeting && new Date(g.lastMeeting) > ninetyDaysAgo);
  const needLiaison = groups.filter(g => !g.officerLiaison);
  return { totalGroups: groups.length, totalMembers: groups.reduce((s,g)=>s+g.memberCount,0), activeGroups: active.length, groupsNeedingLiaison: needLiaison.length, avgMembers: groups.length > 0 ? Math.round(groups.reduce((s,g)=>s+g.memberCount,0)/groups.length) : 0 };
}

/* FEATURE 94: Business Liaison */
export interface BusinessContact { id: string; businessName: string; address: string; contactName: string; contactPhone: string; lastContact: string; nextContact: string|null; liaisonOfficer: string; issues: string[]; securityAssessment: boolean; emergencyContactInfo: boolean; }
export function generateBusinessOutreach(contacts: BusinessContact[]): { totalBusinesses: number; contactedThisQuarter: number; overdue: BusinessContact[]; highPriority: BusinessContact[] } {
  const now = new Date(); const quarterStart = new Date(now.getFullYear(), Math.floor(now.getMonth()/3)*3, 1);
  const contactedThisQ = contacts.filter(c => new Date(c.lastContact) >= quarterStart);
  const overdue = contacts.filter(c => !c.nextContact || new Date(c.nextContact) < now);
  const highPriority = contacts.filter(c => !c.securityAssessment || !c.emergencyContactInfo);
  return { totalBusinesses: contacts.length, contactedThisQuarter: contactedThisQ.length, overdue, highPriority };
}

/* FEATURE 95: Youth Programs */
export interface YouthProgram { id: string; programName: string; type: 'explorer'|'cadet'|'pal'|'mentoring'|'sports'|'internship'|'other'; participants: number; startDate: string; endDate: string|null; coordinatorId: string; budget: number; outcomes: string[]; }
export function evaluateYouthProgram(program: YouthProgram): { costPerParticipant: number; retentionRate: number; impactScore: number; recommendation: string } {
  const costPer = program.participants > 0 ? Math.round(program.budget / program.participants) : 0;
  return { costPerParticipant: costPer, retentionRate: 0, impactScore: program.outcomes.length * 20, recommendation: program.outcomes.length >= 3 ? 'Program demonstrating positive outcomes — consider expansion' : 'Continue monitoring program effectiveness' };
}

/* FEATURE 96: Community Events */
export interface CommunityEvent { id: string; eventName: string; date: string; location: string; type: string; expectedAttendees: number; officersAssigned: number; cost: number; feedback: string|null; status: 'planned'|'active'|'completed'|'cancelled'; }
export function planCommunityEvent(name: string, date: string, location: string, type: string, attendees: number): { staffingNeeded: number; budgetEstimate: number; permitsRequired: string[]; riskLevel: string } {
  const staffing = Math.ceil(attendees / 250) + 2;
  const budget = attendees * 2 + staffing * 150;
  const permits = attendees > 500 ? ['Special event permit','Traffic control plan','Health department','Fire marshal'] : ['Special event permit'];
  const risk = attendees > 2000 ? 'high' : attendees > 500 ? 'medium' : 'low';
  return { staffingNeeded: staffing, budgetEstimate: budget, permitsRequired: permits, riskLevel: risk };
}

/* FEATURE 97: Volunteer Management */
export interface Volunteer { id: string; name: string; role: string; startDate: string; hoursLogged: number; backgroundChecked: boolean; trainingCompleted: string[]; status: 'active'|'inactive'|'suspended'; assignedOfficer: string|null; }
export function trackVolunteerHours(volunteers: Volunteer[]): { totalVolunteers: number; totalHours: number; avgHoursPerVolunteer: number; valueToDepartment: number } {
  const active = volunteers.filter(v => v.status === 'active');
  const totalHours = active.reduce((s,v) => s + v.hoursLogged, 0);
  const valuePerHour = 31.80; // Independent Sector value of volunteer time
  return { totalVolunteers: active.length, totalHours, avgHoursPerVolunteer: active.length > 0 ? Math.round(totalHours / active.length) : 0, valueToDepartment: Math.round(totalHours * valuePerHour) };
}

/* FEATURE 98: Citizen Satisfaction Surveys */
export interface SatisfactionSurvey { id: string; callNumber: string; surveyDate: string; respondentType: 'victim'|'witness'|'caller'|'general'; questions: Array<{ question: string; rating: 1|2|3|4|5 }>; overallRating: number; comments: string; followUpRequested: boolean; }
export function calculateSatisfactionScore(surveys: SatisfactionSurvey[]): { avgRating: number; netPromoterScore: number; topComplaints: string[]; improvementRate: string } {
  const avg = surveys.length > 0 ? Math.round(surveys.reduce((s,sv)=>s+sv.overallRating,0) / surveys.length * 10) / 10 : 0;
  const promoters = surveys.filter(s => s.overallRating >= 4).length;
  const detractors = surveys.filter(s => s.overallRating <= 2).length;
  const nps = surveys.length > 0 ? Math.round((promoters - detractors) / surveys.length * 100) : 0;
  return { avgRating: avg, netPromoterScore: nps, topComplaints: [], improvementRate: '' };
}

/* FEATURE 99: Social Media Engagement */
export interface SocialMediaPost { id: string; platform: string; content: string; postedAt: string; reachCount: number; engagementCount: number; sentiment: 'positive'|'neutral'|'negative'; comments: number; shares: number; crisisCommunication: boolean; }
export function analyzeSocialMediaImpact(posts: SocialMediaPost[]): { totalReach: number; totalEngagement: number; engagementRate: number; sentimentBreakdown: Record<string,number>; bestTimeToPost: string } {
  const totalReach = posts.reduce((s,p)=>s+p.reachCount,0);
  const totalEng = posts.reduce((s,p)=>s+p.engagementCount,0);
  const sentiment: Record<string,number> = {positive:0,neutral:0,negative:0};
  for (const p of posts) sentiment[p.sentiment] = (sentiment[p.sentiment]||0) + 1;
  return { totalReach, totalEngagement: totalEng, engagementRate: totalReach > 0 ? Math.round(totalEng/totalReach*10000)/100 : 0, sentimentBreakdown: sentiment, bestTimeToPost: '10:00 AM' };
}

/* FEATURE 100: Community Crime Mapping */
export interface CrimeMapLayer { id: string; name: string; crimeType: string; dateRange: { start: string; end: string }; incidents: Array<{ latitude: number; longitude: number; type: string; date: string; caseNumber: string }>; sharedWithPublic: boolean; }
export function generatePublicCrimeReport(layers: CrimeMapLayer[]): { totalIncidents: number; topCrimeTypes: Array<{type:string;count:number}>; safestNeighborhoods: string[]; trends: string } {
  const allIncidents = layers.flatMap(l => l.incidents);
  const byType: Record<string,number> = {}; for (const i of allIncidents) byType[i.type] = (byType[i.type]||0) + 1;
  const top = Object.entries(byType).sort((a,b) => b[1]-a[1]).slice(0,5).map(([t,c]) => ({type:t,count:c}));
  return { totalIncidents: allIncidents.length, topCrimeTypes: top, safestNeighborhoods: [], trends: 'Stable' };
}

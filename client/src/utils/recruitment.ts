// ============================================================
// RMPG Flex — Recruitment & Hiring (Spillman Flex Standard)
// 10 recruitment features: applicant pipeline, testing
// administration, oral board scheduling, conditional offer
// tracking, medical/psych coordination, academy class planning,
// lateral transfer processing, recruitment marketing analytics,
// diversity hiring metrics, and onboarding workflow.
// ============================================================

/* FEATURE 91: Applicant Pipeline */
export interface RecruitmentPipeline { id:string; position:string; applicants:number; screeningPassed:number; testingPassed:number; oralBoardPassed:number; backgroundInProgress:number; conditionalOffers:number; hired:number; period:string; }
export function analyzePipeline(pipeline:RecruitmentPipeline): { conversionRate:number; dropoutPoints:Record<string,number>; timeToHire:number } {
  const stages = ['applicants','screeningPassed','testingPassed','oralBoardPassed','backgroundInProgress','conditionalOffers','hired'];
  const dropout:Record<string,number> = {};
  for (let i=1;i<stages.length;i++) { const prev = (pipeline as any)[stages[i-1]]||0; const curr = (pipeline as any)[stages[i]]||0; dropout[stages[i]]=prev-curr; }
  return { conversionRate:pipeline.applicants>0?Math.round(pipeline.hired/pipeline.applicants*100):0, dropoutPoints:dropout, timeToHire:0 };
}

/* FEATURE 92: Testing Administration */
export interface RecruitmentTest { id:string; testType:'written'|'physical_agility'|'scenario'|'psychological'|'polygraph'; testDate:string; applicantsScheduled:number; applicantsAttended:number; applicantsPassed:number; passRate:number; proctorId:string; location:string; }
export function scheduleRecruitmentTest(type:string, date:string, location:string, maxCapacity:number, proctorId:string): RecruitmentTest {
  return { id:`test-${Date.now()}`, testType:type as any, testDate:date, applicantsScheduled:0, applicantsAttended:0, applicantsPassed:0, passRate:0, proctorId, location };
}

/* FEATURE 93: Oral Board Scheduling */
export interface OralBoard { id:string; date:string; panelists:Array<{name:string;role:string}>; applicants:Array<{applicantId:string;timeSlot:string}>; scoringCriteria:Array<{criterion:string;maxPoints:number}>; location:string; status:'scheduled'|'in_progress'|'completed'; }
export function calculateOralBoardScores(applicantScores:Array<{applicantId:string;scores:number[]}>, maxPossible:number): Array<{applicantId:string;score:number;pct:number;passed:boolean}> {
  return applicantScores.map(a=>{const total=a.scores.reduce((s,v)=>s+v,0); const pct=Math.round(total/maxPossible*100); return{applicantId:a.applicantId,score:total,pct,passed:pct>=70};});
}

/* FEATURE 94: Conditional Offer Tracking */
export interface ConditionalOffer { applicantId:string; position:string; offerDate:string; conditions:Array<{condition:string;dueDate:string;completed:boolean;result:string|null}>; acceptanceDate:string|null; declinedDate:string|null; status:'pending'|'accepted'|'declined'|'withdrawn'; }
export function trackOfferConditions(offers:ConditionalOffer[]): { totalOffers:number; accepted:number; declined:number; avgConditionsCompleted:number } {
  const accepted = offers.filter(o=>o.status==='accepted');
  const declined = offers.filter(o=>o.status==='declined');
  const totalConditions = accepted.reduce((s,o)=>s+o.conditions.length,0);
  const completed = accepted.reduce((s,o)=>s+o.conditions.filter(c=>c.completed).length,0);
  return { totalOffers:offers.length, accepted:accepted.length, declined:declined.length, avgConditionsCompleted:accepted.length>0?Math.round(completed/accepted.length*10)/10:0 };
}

/* FEATURE 95: Medical/Psych Coordination */
export interface MedicalExam { applicantId:string; examDate:string; facility:string; physician:string; examType:'medical'|'psychological'|'drug_screen'|'vision'|'hearing'; results:string|null; passed:boolean|null; restrictions:string[]; reportUrl:string|null; }
export function schedulePreEmploymentMedical(applicantId:string, examDate:string, facility:string, examType:string): MedicalExam {
  return { applicantId, examDate, facility, physician:'', examType:examType as any, results:null, passed:null, restrictions:[], reportUrl:null };
}

/* FEATURE 96: Academy Class Planning */
export interface AcademyClass { id:string; classNumber:string; startDate:string; graduationDate:string; maxCapacity:number; enrolled:number; instructorTeam:string[]; curriculum:Array<{block:string;weeks:number;instructor:string}>; status:'forming'|'in_session'|'graduated'|'cancelled'; }
export function planAcademyClass(startDate:string, weeks:number, maxCapacity:number): AcademyClass {
  const gradDate = new Date(startDate); gradDate.setDate(gradDate.getDate()+weeks*7);
  return { id:`acad-${Date.now()}`, classNumber:`${new Date(startDate).getFullYear()}-${Math.ceil(new Date(startDate).getMonth()/4)}`, startDate, graduationDate:gradDate.toISOString().slice(0,10), maxCapacity, enrolled:0, instructorTeam:[], curriculum:[], status:'forming' };
}

/* FEATURE 97: Lateral Transfer Processing */
export interface LateralTransfer { applicantId:string; previousAgency:string; yearsOfService:number; rankAtDeparture:string; separationType:'resigned'|'retired'|'terminated'; certifiedInState:boolean; certifications:Array<{name:string;expirationDate:string}>; POSTStatus:string; backgroundVerified:boolean; }
export function evaluateLateralCandidate(candidate:LateralTransfer): { qualificationScore:number; rankEligibility:string; trainingWaiverEligible:boolean; hiringIncentive:number } {
  let score=0; if (candidate.yearsOfService>=5) score+=30; else if (candidate.yearsOfService>=3) score+=20; else score+=10;
  if (candidate.certifiedInState) score+=25; if (candidate.certifications.length>=3) score+=15;
  if (candidate.separationType==='terminated') score-=30;
  const incentive = candidate.yearsOfService>=5?5000:candidate.yearsOfService>=3?2500:0;
  return { qualificationScore:Math.max(0,score), rankEligibility:candidate.yearsOfService>=3?'Lateral Entry - Step Credit':candidate.yearsOfService>=1?'Step Adjustment Considered':'Entry Level', trainingWaiverEligible:candidate.certifiedInState&&candidate.yearsOfService>=3, hiringIncentive:incentive };
}

/* FEATURE 98: Recruitment Marketing Analytics */
export interface MarketingCampaign { id:string; campaignName:string; platforms:string[]; startDate:string; endDate:string|null; cost:number; impressions:number; clicks:number; applications:number; costPerApplicant:number; roi:number; }
export function calculateMarketingROI(campaigns:MarketingCampaign[]): { totalCost:number; totalApplications:number; avgCostPerApplicant:number; bestPlatform:string } {
  const totalCost = campaigns.reduce((s,c)=>s+c.cost,0);
  const totalApps = campaigns.reduce((s,c)=>s+c.applications,0);
  const byPlatform:Record<string,{cost:number;apps:number}> = {};
  for (const c of campaigns) for (const p of c.platforms) { if (!byPlatform[p]) byPlatform[p]={cost:0,apps:0}; byPlatform[p].cost+=c.cost/c.platforms.length; byPlatform[p].apps+=c.applications/c.platforms.length; }
  const best = Object.entries(byPlatform).sort((a,b)=>(a[1].apps/a[1].cost)-(b[1].apps/b[1].cost)).pop();
  return { totalCost, totalApplications:totalApps, avgCostPerApplicant:totalApps>0?Math.round(totalCost/totalApps):0, bestPlatform:best?best[0]:'N/A' };
}

/* FEATURE 99: Diversity Hiring Metrics */
export interface DiversityMetrics { period:string; totalApplicants:number; totalHired:number; byRace:Record<string,{applied:number;hired:number}>; byGender:Record<string,{applied:number;hired:number}>; veteranApplicants:number; veteranHired:number; }
export function calculateDiversityIndices(metrics:DiversityMetrics): { overallHireRate:number; representationGaps:string[]; inclusiveOutreachNeeded:boolean } {
  const gaps:string[] = [];
  for (const [group, data] of Object.entries(metrics.byRace)) { const hireRate = data.applied>0?data.hired/data.applied:0; const popRate = 0.12; if (hireRate<popRate*0.7) gaps.push(`${group}: Hire rate (${Math.round(hireRate*100)}%) below population representation`); }
  return { overallHireRate:metrics.totalApplicants>0?Math.round(metrics.totalHired/metrics.totalApplicants*100):0, representationGaps:gaps, inclusiveOutreachNeeded:gaps.length>0 };
}

/* FEATURE 100: Onboarding Workflow */
export interface OnboardingChecklist { newHireId:string; startDate:string; tasks:Array<{task:string;category:string;dueDate:string;completed:boolean;completedBy:string|null;completedAt:string|null}>; totalTasks:number; completedTasks:number; orientationDate:string|null; FTOAssignment:string|null; }
export function generateOnboardingTasks(newHireId:string, startDate:string): OnboardingChecklist {
  const tasks = [
    {task:'Complete HR paperwork',category:'administrative',dueDate:startDate,completed:false,completedBy:null,completedAt:null},
    {task:'Issue department ID',category:'administrative',dueDate:startDate,completed:false,completedBy:null,completedAt:null},
    {task:'Uniform fitting',category:'equipment',dueDate:startDate,completed:false,completedBy:null,completedAt:null},
    {task:'IT systems access',category:'technology',dueDate:startDate,completed:false,completedBy:null,completedAt:null},
    {task:'Policy manual acknowledgement',category:'compliance',dueDate:startDate,completed:false,completedBy:null,completedAt:null},
    {task:'Benefits enrollment',category:'benefits',dueDate:new Date(new Date(startDate).getTime()+30*86400000).toISOString().slice(0,10),completed:false,completedBy:null,completedAt:null},
    {task:'Safety orientation',category:'safety',dueDate:startDate,completed:false,completedBy:null,completedAt:null},
    {task:'Radio training',category:'equipment',dueDate:startDate,completed:false,completedBy:null,completedAt:null},
    {task:'Assign FTO',category:'training',dueDate:startDate,completed:false,completedBy:null,completedAt:null},
    {task:'Building tour',category:'orientation',dueDate:startDate,completed:false,completedBy:null,completedAt:null},
  ];
  return { newHireId, startDate, tasks, totalTasks:tasks.length, completedTasks:0, orientationDate:startDate, FTOAssignment:null };
}

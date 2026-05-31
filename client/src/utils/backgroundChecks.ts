// ============================================================
// RMPG Flex — Background Investigations (Spillman Flex Standard)
// 10 background features: applicant tracking, background check
// workflow, reference verification, social media screening,
// polygraph scheduling, psychological evaluation, credit check
// analysis, adjudication workflow, suitability determination,
// and background investigation metrics.
// ============================================================

/* FEATURE 71: Applicant Tracking */
export interface Applicant { id: string; name: string; position: string; appliedDate: string; status: 'screening'|'testing'|'interview'|'background'|'polygraph'|'psych'|'medical'|'offer'|'hired'|'withdrawn'|'rejected'; phaseStartDate: string; daysInPhase: number; assignedInvestigator: string|null; }
export function trackApplicantProgress(applicants: Applicant[]): { byPhase: Record<string,number>; avgDaysToHire: number; bottleneck: string } {
  const byPhase: Record<string,number> = {}; for (const a of applicants) byPhase[a.status] = (byPhase[a.status]||0) + 1;
  const hired = applicants.filter(a => a.status === 'hired');
  const avgDays = hired.length > 0 ? Math.round(hired.reduce((s,a) => s + a.daysInPhase, 0) / hired.length) : 0;
  const phases = ['screening','testing','interview','background','polygraph','psych','medical']; let maxDays = 0; let bottleneck = 'background';
  for (const p of phases) { const inPhase = applicants.filter(a => a.status === p); if (inPhase.length > 0) { const avg = Math.round(inPhase.reduce((s,a)=>s+a.daysInPhase,0)/inPhase.length); if (avg > maxDays) { maxDays = avg; bottleneck = p; } } }
  return { byPhase, avgDaysToHire: avgDays, bottleneck };
}

/* FEATURE 72: Background Check Workflow */
export interface BackgroundCheck { applicantId: string; startDate: string; criminalHistory: boolean; drivingRecord: boolean; employmentVerification: boolean; educationVerification: boolean; referenceChecks: boolean; creditCheck: boolean; militaryRecord: boolean; completedSteps: number; totalSteps: number; status: 'in_progress'|'completed'|'flagged'; }
export function calculateBackgroundProgress(check: BackgroundCheck): { pctComplete: number; remainingSteps: string[]; estimatedCompletion: string } {
  const steps: Array<{name:string;done:boolean}> = [
    {name:'Criminal History',done:check.criminalHistory},{name:'Driving Record',done:check.drivingRecord},
    {name:'Employment Verification',done:check.employmentVerification},{name:'Education Verification',done:check.educationVerification},
    {name:'Reference Checks',done:check.referenceChecks},{name:'Credit Check',done:check.creditCheck},{name:'Military Record',done:check.militaryRecord},
  ];
  const remaining = steps.filter(s => !s.done).map(s => s.name);
  const pct = Math.round(check.completedSteps / Math.max(1, check.totalSteps) * 100);
  const remainDays = remaining.length * 3;
  const est = new Date(); est.setDate(est.getDate() + remainDays);
  return { pctComplete: pct, remainingSteps: remaining, estimatedCompletion: est.toISOString().slice(0,10) };
}

/* FEATURE 73: Reference Verification */
export interface ReferenceCheck { applicantId: string; referenceName: string; relationship: string; contactDate: string|null; contactMethod: string|null; responses: Array<{ question: string; answer: string }>; verified: boolean; flagged: boolean; flagReason: string|null; }
export function evaluateReferenceResponses(checks: ReferenceCheck[]): { verified: number; flagged: number; pending: number; overallAssessment: string } {
  const verified = checks.filter(c => c.verified).length;
  const flagged = checks.filter(c => c.flagged).length;
  const pending = checks.filter(c => !c.verified && !c.contactDate).length;
  let assessment = 'References satisfactory';
  if (flagged > 0) assessment = `${flagged} reference(s) flagged for review`;
  if (pending > 2) assessment += `; ${pending} references pending contact`;
  return { verified, flagged, pending, overallAssessment: assessment };
}

/* FEATURE 74: Social Media Screening */
export interface SocialMediaScreening { applicantId: string; platforms: Array<{ platform: string; reviewed: boolean; findings: string; flagged: boolean }>; overallAssessment: string; reviewerId: string; reviewDate: string; }
export function summarizeSocialMediaFindings(screening: SocialMediaScreening): { totalPlatforms: number; reviewed: number; flags: string[]; recommendation: string } {
  const reviewed = screening.platforms.filter(p => p.reviewed).length;
  const flags = screening.platforms.filter(p => p.flagged).map(p => `${p.platform}: ${p.findings}`);
  let rec = 'No concerning content found';
  if (flags.length > 2) rec = 'Multiple concerning items — further investigation recommended';
  else if (flags.length > 0) rec = 'Minor items noted — discuss with applicant';
  return { totalPlatforms: screening.platforms.length, reviewed, flags, recommendation: rec };
}

/* FEATURE 75: Polygraph Scheduling */
export interface PolygraphExam { applicantId: string; scheduledDate: string|null; examiner: string|null; examType: string; questions: string[]; results: string|null; status: 'scheduled'|'completed'|'inconclusive'|'deception_indicated'|'no_deception'; reportUrl: string|null; }
export function processPolygraphResults(exam: PolygraphExam): { passed: boolean; requiresFollowUp: boolean; action: string } {
  if (exam.status === 'no_deception') return { passed: true, requiresFollowUp: false, action: 'Proceed with background' };
  if (exam.status === 'deception_indicated') return { passed: false, requiresFollowUp: true, action: 'Conduct follow-up interview on indicated areas' };
  if (exam.status === 'inconclusive') return { passed: false, requiresFollowUp: true, action: 'Schedule retest with different examiner' };
  return { passed: false, requiresFollowUp: false, action: 'Awaiting exam completion' };
}

/* FEATURE 76: Psychological Evaluation */
export interface PsychEval { applicantId: string; evaluationDate: string|null; psychologist: string|null; mmpiResults: string|null; clinicalInterview: string|null; suitabilityRating: 1|2|3|4|5|null; recommendation: 'recommended'|'recommended_with_conditions'|'not_recommended'|null; reportUrl: string|null; status: 'scheduled'|'completed'|'pending'; }
export function interpretPsychResults(eval_: PsychEval): { suitable: boolean; conditions: string[]; followUpNeeded: boolean } {
  if (!eval_.recommendation) return { suitable: false, conditions: [], followUpNeeded: true };
  if (eval_.recommendation === 'recommended') return { suitable: true, conditions: [], followUpNeeded: false };
  if (eval_.recommendation === 'recommended_with_conditions') return { suitable: true, conditions: ['Conditional hire — follow-up evaluation in 6 months'], followUpNeeded: true };
  return { suitable: false, conditions: ['Not recommended for law enforcement position'], followUpNeeded: false };
}

/* FEATURE 77: Credit Check Analysis */
export interface CreditAnalysis { applicantId: string; creditScore: number|null; bankruptcyHistory: boolean; delinquentAccounts: number; totalDebt: number; debtToIncomeRatio: number; negativeItems: string[]; overallRisk: 'low'|'moderate'|'high'; }
export function assessCreditRisk(analysis: CreditAnalysis): { acceptable: boolean; concerns: string[]; mitigations: string[] } {
  const concerns: string[] = []; const mitigations: string[] = [];
  if (analysis.bankruptcyHistory) { concerns.push('Prior bankruptcy'); mitigations.push('Review bankruptcy discharge and current financial status'); }
  if (analysis.delinquentAccounts > 3) { concerns.push(`${analysis.delinquentAccounts} delinquent accounts`); mitigations.push('Require payment plan documentation'); }
  if (analysis.debtToIncomeRatio > 0.4) { concerns.push('High debt-to-income ratio'); mitigations.push('Assess for financial stress indicators'); }
  if (!analysis.creditScore || analysis.creditScore < 550) { concerns.push('Poor credit score'); mitigations.push('Financial counseling referral'); }
  return { acceptable: concerns.length <= 2, concerns, mitigations };
}

/* FEATURE 78: Adjudication Workflow */
export interface Adjudication { applicantId: string; investigatorRecommendation: string; supervisorRecommendation: string; commanderDecision: string|null; decisionDate: string|null; rationale: string; appealFiled: boolean; appealOutcome: string|null; finalDetermination: 'hire'|'no_hire'|'pending'|'appealed'; }
export function trackAdjudicationTimeline(adj: Adjudication, startDate: string): { daysInAdjudication: number; stalled: boolean; actionNeeded: string } {
  const days = Math.ceil((Date.now() - new Date(startDate).getTime()) / 86400000);
  let stalled = false; let action = '';
  if (!adj.commanderDecision && days > 14) { stalled = true; action = 'Escalate to commander for decision'; }
  else if (adj.commanderDecision && !adj.finalDetermination) { action = 'Processing final determination'; }
  else if (adj.finalDetermination === 'pending') { action = 'Awaiting final disposition'; }
  else { action = `Determination: ${adj.finalDetermination}`; }
  return { daysInAdjudication: days, stalled, actionNeeded: action };
}

/* FEATURE 79: Suitability Determination */
export interface SuitabilityMatrix { applicantId: string; factors: Array<{ factor: string; weight: number; score: 1|2|3|4|5 }>; overallScore: number; minimumThreshold: number; meetsMinimum: boolean; disqualifiers: string[]; }
export function calculateSuitabilityScore(matrix: SuitabilityMatrix): { weightedScore: number; passed: boolean; disqualifyingFactors: string[] } {
  const totalWeight = matrix.factors.reduce((s,f) => s + f.weight, 0);
  const weightedScore = totalWeight > 0 ? Math.round(matrix.factors.reduce((s,f) => s + f.score * f.weight, 0) / totalWeight * 20) : 0;
  return { weightedScore, passed: weightedScore >= matrix.minimumThreshold && matrix.disqualifiers.length === 0, disqualifyingFactors: matrix.disqualifiers };
}

/* FEATURE 80: Background Investigation Metrics */
export interface BIMetrics { period: string; totalApplications: number; backgroundStarted: number; backgroundCompleted: number; avgCompletionDays: number; disqualificationRate: number; topDisqualifiers: Array<{ reason: string; count: number }>; investigatorWorkload: Array<{ investigator: string; active: number; completed: number }>; }
export function calculateInvestigatorCapacity(metrics: BIMetrics, targetDays: number = 30): { avgCaseload: number; recommendedMax: number; overloaded: boolean; needsStaffing: boolean } {
  const totalInvestigators = metrics.investigatorWorkload.length;
  const avgCaseload = totalInvestigators > 0 ? Math.round(metrics.investigatorWorkload.reduce((s,i)=>s+i.active,0) / totalInvestigators) : 0;
  const recommendedMax = 12;
  return { avgCaseload, recommendedMax, overloaded: avgCaseload > recommendedMax, needsStaffing: avgCaseload > recommendedMax * 0.85 };
}

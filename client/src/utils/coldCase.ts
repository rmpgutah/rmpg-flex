// ============================================================
// RMPG Flex — Cold Case Management (Spillman Flex Standard)
// 10 cold case features: case screening, evidence review,
// forensic potential, suspect re-evaluation, witness
// re-interview, familial DNA, media outreach, task force
// coordination, grant-funded investigation, and cold case metrics.
// ============================================================

/* FEATURE 91: Case Screening */
export interface ColdCaseScreening { caseNumber:string; caseType:string; dateOfOccurrence:string; solvabilityScore:number; hasDNA:boolean; hasFingerprints:boolean; hasWitnesses:boolean; suspectIdentified:boolean; priorityForReview:1|2|3|4|5; }
export function screenColdCases(cases:ColdCaseScreening[]): { total:number; highPriority:number; dnaCases:number } {
  return { total:cases.length, highPriority:cases.filter(c=>c.priorityForReview<=2).length, dnaCases:cases.filter(c=>c.hasDNA).length };
}

/* FEATURE 92: Evidence Review */
export interface EvidenceReview { caseNumber:string; evidenceType:string; lastTested:string|null; retestEligible:boolean; forensicAdvances:string[]; recommendedAction:string; }
export function evaluateEvidenceRetest(reviews:EvidenceReview[]): { total:number; eligible:number; recommendedActions:string[] } {
  const eligible = reviews.filter(r=>r.retestEligible); return { total:reviews.length, eligible:eligible.length, recommendedActions:eligible.map(r=>r.recommendedAction) };
}

/* FEATURE 93: Forensic Potential */
export interface ForensicPotential { caseNumber:string; dnaAvailable:boolean; dnaDegraded:boolean; codisUploaded:boolean; codisHit:boolean; geneticGenealogyCandidate:boolean; fingerprintAvailable:boolean; afisUploaded:boolean; }
export function assessForensicPotential(cases:ForensicPotential[]): { totalWithDNA:number; codisHits:number; genealogyCandidates:number } {
  return { totalWithDNA:cases.filter(c=>c.dnaAvailable).length, codisHits:cases.filter(c=>c.codisHit).length, genealogyCandidates:cases.filter(c=>c.geneticGenealogyCandidate).length };
}

/* FEATURE 94: Suspect Re-Evaluation */
export interface SuspectReEvaluation { caseNumber:string; originalSuspects:number; reInterviewed:number; newSuspectsIdentified:number; compositeSketch:boolean; ageProgression:boolean; }
export function trackSuspectReEval(evaluations:SuspectReEvaluation[]): { totalCases:number; newSuspectsTotal:number; compositeRate:number } {
  return { totalCases:evaluations.length, newSuspectsTotal:evaluations.reduce((s,e)=>s+e.newSuspectsIdentified,0), compositeRate:evaluations.length>0?Math.round(evaluations.filter(e=>e.compositeSketch).length/evaluations.length*100):0 };
}

/* FEATURE 95: Witness Re-Interview */
export interface WitnessReInterview { caseNumber:string; witnessName:string; originalStatementDate:string; reInterviewDate:string; newInformation:boolean; newInfoSummary:string|null; }
export function evaluateWitnessRecontact(interviews:WitnessReInterview[]): { total:number; productiveInterviews:number; newLeads:number } {
  const productive = interviews.filter(i=>i.newInformation); return { total:interviews.length, productiveInterviews:productive.length, newLeads:productive.length };
}

/* FEATURE 96: Familial DNA */
export interface FamilialDNASearch { caseNumber:string; requestedDate:string; approved:boolean; labSubmittedDate:string|null; resultsDate:string|null; leadsGenerated:number; matches:number; }
export function trackFamilialDNA(searches:FamilialDNASearch[]): { total:number; approved:number; completed:number; successRate:number } {
  const completed = searches.filter(s=>s.resultsDate); return { total:searches.length, approved:searches.filter(s=>s.approved).length, completed:completed.length, successRate:completed.length>0?Math.round(completed.filter(s=>s.matches>0).length/completed.length*100):0 };
}

/* FEATURE 97: Media Outreach */
export interface ColdCaseMedia { caseNumber:string; mediaType:string; outletName:string; airDate:string; tipsReceived:number; leadsGenerated:number; caseSolved:boolean; }
export function measureMediaImpact(coverage:ColdCaseMedia[]): { totalCoverage:number; tipsGenerated:number; solveRate:number } {
  const tips = coverage.reduce((s,c)=>s+c.tipsReceived,0); const solved = coverage.filter(c=>c.caseSolved).length;
  return { totalCoverage:coverage.length, tipsGenerated:tips, solveRate:coverage.length>0?Math.round(solved/coverage.length*100):0 };
}

/* FEATURE 98: Task Force Coordination */
export interface ColdCaseTaskForce { id:string; name:string; members:Array<{name:string;agency:string;role:string}>; casesAssigned:string[]; startDate:string; meetings:number; casesSolved:number; }
export function evaluateTaskForce(tf:ColdCaseTaskForce): { casesPerMember:number; solveRate:number; monthsActive:number } {
  const months = Math.ceil((Date.now()-new Date(tf.startDate).getTime())/86400000/30);
  return { casesPerMember:tf.members.length>0?Math.round(tf.casesAssigned.length/tf.members.length):0, solveRate:tf.casesAssigned.length>0?Math.round(tf.casesSolved/tf.casesAssigned.length*100):0, monthsActive:months };
}

/* FEATURE 99: Grant-Funded Investigation */
export interface ColdCaseGrant { id:string; grantName:string; amount:number; period:{start:string;end:string}; casesFunded:string[]; expenditures:number; outcomes:string[]; }
export function trackGrantProgress(grant:ColdCaseGrant): { fundsRemaining:number; burnRate:number; outcomesRate:number } {
  const fundsRemaining = grant.amount-grant.expenditures; const monthsElapsed = Math.max(1,Math.ceil((Date.now()-new Date(grant.period.start).getTime())/86400000/30));
  return { fundsRemaining, burnRate:Math.round(grant.expenditures/monthsElapsed), outcomesRate:grant.casesFunded.length>0?Math.round(grant.outcomes.length/grant.casesFunded.length*100):0 };
}

/* FEATURE 100: Cold Case Metrics */
export interface ColdCaseMetrics { totalColdCases:number; casesUnderReview:number; casesSolvedThisYear:number; dnaTestsCompleted:number; dnaHits:number; familialDNAMatches:number; mediaCoverages:number; grantsActive:number; }
export function compileColdCaseMetrics(data:{total:number;underReview:number;solved:number;dnaTests:number;dnaHits:number;familial:number;media:number;grants:number}): ColdCaseMetrics {
  return { totalColdCases:data.total, casesUnderReview:data.underReview, casesSolvedThisYear:data.solved, dnaTestsCompleted:data.dnaTests, dnaHits:data.dnaHits, familialDNAMatches:data.familial, mediaCoverages:data.media, grantsActive:data.grants };
}

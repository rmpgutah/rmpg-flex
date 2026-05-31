// ============================================================
// RMPG Flex — Accreditation & Compliance (Spillman Flex Standard)
// 10 accreditation features: standard tracking, proof of
// compliance, assessment preparation, policy review workflow,
// CALEA standards, annual reporting, corrective action tracking,
// file management, assessor coordination, and compliance dashboard.
// ============================================================

/* FEATURE 81: Standard Tracking */
export interface AccreditationStandard { id:string; chapter:string; standardNumber:string; title:string; description:string; complianceLevel:'compliant'|'partial'|'non_compliant'|'not_applicable'; lastReviewed:string; nextReview:string; proofFiles:string[]; comments:string; }
export function calculateComplianceRate(standards:AccreditationStandard[]): { overallRate:number; byChapter:Record<string,{total:number;compliant:number;rate:number}>; nonCompliantCount:number } {
  const applicable = standards.filter(s=>s.complianceLevel!=='not_applicable');
  const compliant = applicable.filter(s=>s.complianceLevel==='compliant').length;
  const byChapter:Record<string,{total:number;compliant:number;rate:number}> = {};
  for (const s of applicable) { if (!byChapter[s.chapter]) byChapter[s.chapter]={total:0,compliant:0,rate:0}; byChapter[s.chapter].total++; if (s.complianceLevel==='compliant') byChapter[s.chapter].compliant++; }
  for (const k of Object.keys(byChapter)) byChapter[k].rate = Math.round(byChapter[k].compliant/byChapter[k].total*100);
  return { overallRate:applicable.length>0?Math.round(compliant/applicable.length*100):0, byChapter, nonCompliantCount:applicable.filter(s=>s.complianceLevel==='non_compliant').length };
}

/* FEATURE 82: Proof of Compliance */
export interface ProofOfCompliance { standardId:string; proofType:'policy'|'training_record'|'report'|'photograph'|'video'|'audit'|'testimony'|'other'; fileUrl:string; description:string; uploadedBy:string; uploadedAt:string; verified:boolean; verifiedBy:string|null; verifiedAt:string|null; }
export function verifyProofs(proofs:ProofOfCompliance[]): { total:number; verified:number; unverified:number; verificationGap:number } {
  const verified = proofs.filter(p=>p.verified);
  return { total:proofs.length, verified:verified.length, unverified:proofs.length-verified.length, verificationGap:proofs.length>0?Math.round((1-verified.length/proofs.length)*100):0 };
}

/* FEATURE 83: Assessment Preparation */
export interface AssessmentPrep { id:string; assessorVisitDate:string; preparationDeadlines:Array<{task:string;dueDate:string;completed:boolean;assignedTo:string}>; mockAssessmentDate:string|null; mockAssessmentScore:number|null; readinessPct:number; status:'preparing'|'ready'|'in_progress'; }
export function evaluateAssessmentReadiness(prep:AssessmentPrep): { readyForAssessment:boolean; criticalTasks:Array<{task:string;dueDate:string}>; overallReadiness:number } {
  const incomplete = prep.preparationDeadlines.filter(t=>!t.completed);
  const overdue = incomplete.filter(t=>new Date(t.dueDate)<new Date());
  const totalTasks = prep.preparationDeadlines.length;
  const completed = totalTasks-incomplete.length;
  const readiness = totalTasks>0?Math.round(completed/totalTasks*100):0;
  return { readyForAssessment:overdue.length===0&&incomplete.length<=Math.ceil(totalTasks*0.1), criticalTasks:overdue.map(t=>({task:t.task,dueDate:t.dueDate})), overallReadiness:readiness };
}

/* FEATURE 84: Policy Review Workflow */
export interface PolicyReview { policyId:string; policyTitle:string; currentVersion:number; reviewDate:string; reviewerId:string; reviewStatus:'pending'|'approved'|'revision_requested'|'rejected'; revisionNotes:string|null; newVersion:number|null; effectiveDate:string|null; }
export function trackPolicyReviewCycle(reviews:PolicyReview[]): { policiesDue:number; policiesOverdue:number; avgReviewDays:number; approvalRate:number } {
  const now = new Date(); const dueThisQuarter = reviews.filter(r=>new Date(r.reviewDate)<=new Date(now.getFullYear(),Math.ceil((now.getMonth()+1)/3)*3,0));
  const overdue = dueThisQuarter.filter(r=>r.reviewStatus==='pending');
  const completed = reviews.filter(r=>r.reviewStatus==='approved'||r.reviewStatus==='revision_requested');
  const approvalRate = completed.length>0?Math.round(completed.filter(r=>r.reviewStatus==='approved').length/completed.length*100):0;
  return { policiesDue:dueThisQuarter.length, policiesOverdue:overdue.length, avgReviewDays:0, approvalRate };
}

/* FEATURE 85: CALEA Standards */
export interface CALEAStandard { chapter:number; standardId:string; title:string; applicable:boolean; complianceDate:string; proofUploaded:boolean; onSiteVerified:boolean; status:'compliant'|'non_compliant'|'in_progress'; }
export function calculateCALEAScore(standards:CALEAStandard[]): { applicableCount:number; compliantCount:number; score:number; certificationReady:boolean } {
  const applicable = standards.filter(s=>s.applicable);
  const compliant = applicable.filter(s=>s.status==='compliant'||s.onSiteVerified);
  const score = applicable.length>0?Math.round(compliant.length/applicable.length*100):0;
  return { applicableCount:applicable.length, compliantCount:compliant.length, score, certificationReady:score>=95 };
}

/* FEATURE 86: Annual Reporting */
export interface AccreditationReport { year:number; standardsReviewed:number; standardsAdded:number; standardsModified:number; complianceRate:number; notableChanges:string[]; challenges:string[]; nextYearGoals:string[]; submittedDate:string|null; }
export function generateAnnualReport(year:number, standards:AccreditationStandard[], changes:string[]): AccreditationReport {
  const rate = calculateComplianceRate(standards);
  return { year, standardsReviewed:standards.length, standardsAdded:0, standardsModified:0, complianceRate:rate.overallRate, notableChanges:changes, challenges:[], nextYearGoals:[], submittedDate:null };
}

/* FEATURE 87: Corrective Action Tracking */
export interface CorrectiveAction { id:string; standardId:string; finding:string; actionRequired:string; assignedTo:string; dueDate:string; completedDate:string|null; evidenceFile:string|null; status:'open'|'in_progress'|'completed'|'overdue'; }
export function monitorCorrectiveActions(actions:CorrectiveAction[]): { total:number; open:number; overdue:number; completionRate:number } {
  const now = new Date(); const open = actions.filter(a=>a.status!=='completed');
  const overdue = open.filter(a=>new Date(a.dueDate)<now);
  const completed = actions.filter(a=>a.status==='completed').length;
  return { total:actions.length, open:open.length, overdue:overdue.length, completionRate:actions.length>0?Math.round(completed/actions.length*100):0 };
}

/* FEATURE 88: File Management */
export interface AccreditationFile { id:string; standardId:string; fileName:string; fileType:string; fileSize:number; uploadedBy:string; uploadedAt:string; version:number; status:'current'|'superseded'|'archived'; }
export function organizeAccreditationFiles(files:AccreditationFile[]): { totalFiles:number; totalSize:number; byStandard:Record<string,number>; orphanedFiles:AccreditationFile[] } {
  const byStd:Record<string,number> = {}; for (const f of files) byStd[f.standardId]=(byStd[f.standardId]||0)+1;
  const orphaned = files.filter(f=>f.status==='superseded'&&!byStd[f.standardId]);
  return { totalFiles:files.length, totalSize:files.reduce((s,f)=>s+f.fileSize,0), byStandard:byStd, orphanedFiles:orphaned };
}

/* FEATURE 89: Assessor Coordination */
export interface AssessorVisit { id:string; leadAssessor:string; team:Array<{name:string;role:string;specialty:string}>; visitDates:{start:string;end:string}; standardsToReview:string[]; facilityTour:boolean; rideAlongScheduled:boolean; publicHearingScheduled:boolean; exitInterviewDate:string|null; }
export function prepareAssessorVisit(visit:AssessorVisit): { tasks:Array<{task:string;assignedTo:string;deadline:string}>; readinessChecklist:Array<{item:string;complete:boolean}> } {
  const tasks = [ {task:'Prepare standards binders',assignedTo:'Accreditation Manager',deadline:visit.visitDates.start}, {task:'Schedule facility tour',assignedTo:'Facilities',deadline:visit.visitDates.start}, {task:'Coordinate ride-along',assignedTo:'Patrol Commander',deadline:visit.visitDates.start}, {task:'Arrange public hearing',assignedTo:'PIO',deadline:visit.visitDates.start}, {task:'Reserve conference room',assignedTo:'Admin',deadline:visit.visitDates.start} ];
  return { tasks, readinessChecklist:tasks.map(t=>({item:t.task,complete:false})) };
}

/* FEATURE 90: Compliance Dashboard */
export interface ComplianceDashboard { accreditationBody:string; cycleStart:string; cycleEnd:string; standardsTotal:number; standardsCompliant:number; compliancePct:number; onSiteDate:string|null; certificationStatus:'certified'|'in_progress'|'probation'|'lapsed'; nextAssessment:string; }
export function generateComplianceDashboard(standards:AccreditationStandard[], body:string, cycleStart:string, cycleEnd:string): ComplianceDashboard {
  const compliant = standards.filter(s=>s.complianceLevel==='compliant').length;
  const pct = standards.length>0?Math.round(compliant/standards.length*100):0;
  let status:'certified'|'in_progress'|'probation'|'lapsed' = 'in_progress';
  if (pct>=95) status = 'certified'; else if (pct<60) status = 'probation';
  return { accreditationBody:body, cycleStart, cycleEnd, standardsTotal:standards.length, standardsCompliant:compliant, compliancePct:pct, onSiteDate:null, certificationStatus:status, nextAssessment:cycleEnd };
}

// ============================================================
// RMPG Flex — Records Retention (Spillman Flex Standard)
// 10 retention features: retention schedules, destruction
// workflow, legal holds, archival management, digitization
// tracking, compliance auditing, retention policy management,
// records inventory, purge eligibility, and retention
// statistical reporting.
// ============================================================

export interface RetentionSchedule { recordType:string; retentionYears:number; statutoryBasis:string; triggerEvent:string; destructionMethod:'shred'|'delete'|'incinerate'|'overwrite'; requiresApproval:boolean; }
export const RETENTION_SCHEDULES: Record<string, RetentionSchedule> = {
  personnel_records: { recordType:'Personnel Records', retentionYears:75, statutoryBasis:'FLSA', triggerEvent:'termination_date', destructionMethod:'shred', requiresApproval:true },
  incident_reports: { recordType:'Incident Reports', retentionYears:10, statutoryBasis:'State Code 63G-2', triggerEvent:'case_closed_date', destructionMethod:'shred', requiresApproval:true },
  dispatch_recordings: { recordType:'Dispatch Recordings', retentionYears:3, statutoryBasis:'Agency Policy', triggerEvent:'recording_date', destructionMethod:'delete', requiresApproval:false },
  body_camera: { recordType:'Body Camera Footage', retentionYears:1, statutoryBasis:'Agency Policy', triggerEvent:'recording_date', destructionMethod:'overwrite', requiresApproval:false },
  use_of_force: { recordType:'Use of Force Records', retentionYears:30, statutoryBasis:'State Code 76-2', triggerEvent:'incident_date', destructionMethod:'shred', requiresApproval:true },
  financial: { recordType:'Financial Records', retentionYears:7, statutoryBasis:'IRS', triggerEvent:'fiscal_year_end', destructionMethod:'shred', requiresApproval:true },
  evidence: { recordType:'Evidence Records', retentionYears:99, statutoryBasis:'State Code 77-24', triggerEvent:'case_closed_date', destructionMethod:'shred', requiresApproval:true },
};

/* FEATURE 81: Retention Eligibility */
export function getRetentionSchedule(recordType:string): RetentionSchedule { return RETENTION_SCHEDULES[recordType]||{recordType:'General',retentionYears:5,statutoryBasis:'Agency Policy',triggerEvent:'created_date',destructionMethod:'shred',requiresApproval:true}; }
/* FEATURE 82: Destruction Workflow */
export interface DestructionRequest { id:string; recordsType:string; quantity:number; retentionMet:boolean; triggerDate:string; requestedBy:string; approvedBy:string|null; destructionDate:string|null; method:string; witness:string|null; certificateOnFile:boolean; }
export function approveDestruction(request:DestructionRequest, approver:string): DestructionRequest { return { ...request, approvedBy:approver, destructionDate:new Date().toISOString().slice(0,10) }; }
/* FEATURE 83: Legal Holds */
export interface LegalHold { id:string; caseNumber:string; holdType:'litigation'|'investigation'|'audit'|'appeal'|'FOIA'; recordsAffected:string[]; issuedBy:string; issuedDate:string; releaseDate:string|null; status:'active'|'released'; }
export function checkLegalHolds(recordType:string, holds:LegalHold[]): { onHold:boolean; activeHolds:LegalHold[] } { const active=holds.filter(h=>h.status==='active'&&h.recordsAffected.includes(recordType)); return { onHold:active.length>0, activeHolds:active }; }
/* FEATURE 84: Archival Management */
export interface ArchiveRecord { id:string; boxNumber:string; location:string; contents:string[]; dateRange:{start:string;end:string}; retentionExpires:string; status:'active'|'eligible_for_destruction'|'destroyed'; }
export function trackArchiveRetrievals(archives:ArchiveRecord[]): { total:number; eligible:number; destroyed:number } { const now=new Date(); return { total:archives.length, eligible:archives.filter(a=>new Date(a.retentionExpires)<now).length, destroyed:archives.filter(a=>a.status==='destroyed').length }; }
/* FEATURE 85: Digitization Tracking */
export interface DigitizationProject { id:string; recordType:string; physicalRecords:number; digitizedRecords:number; startDate:string; completionDate:string|null; storageSizeMB:number; qualityCheckPassed:boolean; }
export function calculateDigitizationProgress(projects:DigitizationProject[]): { totalRecords:number; digitized:number; progressPct:number } { const total=projects.reduce((s,p)=>s+p.physicalRecords,0); const digitized=projects.reduce((s,p)=>s+p.digitizedRecords,0); return { totalRecords:total, digitized, progressPct:total>0?Math.round(digitized/total*100):0 }; }
/* FEATURE 86: Compliance Auditing */
export interface RetentionAudit { id:string; auditDate:string; auditor:string; recordsReviewed:number; compliant:number; nonCompliant:number; findings:string[]; overallResult:'pass'|'fail'|'needs_improvement'; }
export function conductRetentionAudit(records:Array<{retentionMet:boolean}>): RetentionAudit { const compliant=records.filter(r=>r.retentionMet).length; const nonCompliant=records.length-compliant; const rate=records.length>0?compliant/records.length:0; return { id:`audit-${Date.now()}`,auditDate:new Date().toISOString().slice(0,10),auditor:'',recordsReviewed:records.length,compliant,nonCompliant,findings:nonCompliant>0?[`${nonCompliant} records past retention deadline`]:[],overallResult:rate>=0.95?'pass':rate>=0.80?'needs_improvement':'fail' }; }
/* FEATURE 87: Retention Policy Management */
export interface RetentionPolicy { id:string; policyName:string; effectiveDate:string; lastReviewed:string; nextReview:string; approvedBy:string; status:'active'|'under_review'|'superseded'; }
export function checkPolicyReviewStatus(policies:RetentionPolicy[]): { total:number; overdue:number } { const now=new Date(); return { total:policies.length, overdue:policies.filter(p=>new Date(p.nextReview)<now).length }; }
/* FEATURE 88: Records Inventory */
export interface RecordsInventory { department:string; recordType:string; physicalCount:number; digitalCount:number; storageLocation:string; lastCounted:string; nextCountDate:string; }
export function planInventoryCycle(inventory:RecordsInventory[]): { totalRecords:number; needsCounting:number } { return { totalRecords:inventory.reduce((s,i)=>s+i.physicalCount+i.digitalCount,0), needsCounting:inventory.filter(i=>new Date(i.nextCountDate)<new Date()).length }; }
/* FEATURE 89: Purge Eligibility */
export interface PurgeEligibility { recordId:string; recordType:string; createdDate:string; triggerDate:string|null; retentionYears:number; eligibleDate:string; eligible:boolean; onLegalHold:boolean; }
export function calculatePurgeEligibility(records:Array<{id:string;type:string;createdDate:string;triggerDate:string|null;holdActive:boolean}>): PurgeEligibility[] { return records.map(r=>{ const schedule=RETENTION_SCHEDULES[r.type]; const trigDate=r.triggerDate||r.createdDate; const eligibleDate=new Date(trigDate); eligibleDate.setFullYear(eligibleDate.getFullYear()+(schedule?.retentionYears||5)); return { recordId:r.id, recordType:r.type, createdDate:r.createdDate, triggerDate:r.triggerDate, retentionYears:schedule?.retentionYears||5, eligibleDate:eligibleDate.toISOString().slice(0,10), eligible:new Date()>=eligibleDate&&!r.holdActive, onLegalHold:r.holdActive||false }; }); }
/* FEATURE 90: Retention Statistical Reporting */
export interface RetentionStats { period:string; recordsEligibleForDestruction:number; recordsDestroyed:number; recordsOnHold:number; digitizationProgress:number; auditFindings:number; policyComplianceRate:number; }
export function compileRetentionStats(data:{eligible:number;destroyed:number;onHold:number;digitizationPct:number;auditFindings:number;policyCompliance:number}): RetentionStats { return { period:new Date().toISOString().slice(0,7), recordsEligibleForDestruction:data.eligible, recordsDestroyed:data.destroyed, recordsOnHold:data.onHold, digitizationProgress:data.digitizationPct, auditFindings:data.auditFindings, policyComplianceRate:data.policyCompliance }; }

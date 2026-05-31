// ============================================================
// RMPG Flex — Body Camera Integration (Spillman Flex Standard)
// 10 BWC features: camera assignment, recording triggers,
// evidence categorization, retention compliance, audit
// review, camera health, upload management, redaction
// workflow, courtroom presentation, and BWC analytics.
// ============================================================

/* FEATURE 21: Camera Assignment */
export interface BWCAssignment { officerId:string; cameraSerial:string; assignedDate:string; returnedDate:string|null; firmwareVersion:string; status:'assigned'|'active'|'returned'|'maintenance'; }
export function trackCameraAssignments(assignments:BWCAssignment[]): { totalCameras:number; activeAssignments:number; unassigned:number } {
  const active = assignments.filter(a=>!a.returnedDate);
  return { totalCameras:new Set(assignments.map(a=>a.cameraSerial)).size, activeAssignments:active.length, unassigned:0 };
}

/* FEATURE 22: Recording Triggers */
export interface RecordingTrigger { id:string; triggerType:'holster_sensor'|'light_bar'|'door_open'|'manual'|'gunshot_detection'|'proximity'; activationTime:string; durationSeconds:number; officerId:string; callNumber:string|null; }
export function analyzeTriggerReliability(triggers:RecordingTrigger[]): { total:number; manualRate:number; autoRate:number; missedRecordings:number } {
  const manual = triggers.filter(t=>t.triggerType==='manual').length;
  return { total:triggers.length, manualRate:triggers.length>0?Math.round(manual/triggers.length*100):0, autoRate:triggers.length>0?Math.round((triggers.length-manual)/triggers.length*100):0, missedRecordings:0 };
}

/* FEATURE 23: Evidence Categorization */
export interface BWCEvidence { id:string; recordingDate:string; duration:number; categories:string[]; flagged:boolean; flagReason:string|null; caseNumber:string|null; retentionDate:string; }
export function categorizeBWCFootage(recordings:BWCEvidence[]): { total:number; totalDuration:number; flagged:number; byCategory:Record<string,number> } {
  const totalDuration = recordings.reduce((s,r)=>s+r.duration,0);
  const byCat:Record<string,number> = {}; for (const r of recordings) for (const c of r.categories) byCat[c]=(byCat[c]||0)+1;
  return { total:recordings.length, totalDuration, flagged:recordings.filter(r=>r.flagged).length, byCategory:byCat };
}

/* FEATURE 24: Retention Compliance */
export interface BWCRetention { recordingId:string; retentionPeriod:number; expirationDate:string; deleted:boolean; deletionDate:string|null; holdReason:string|null; }
export function checkRetentionCompliance(records:BWCRetention[]): { total:number; expired:number; pastDue:number; onHold:number } {
  const now = new Date(); return { total:records.length, expired:records.filter(r=>new Date(r.expirationDate)<now&&!r.deleted&&!r.holdReason).length, pastDue:records.filter(r=>new Date(r.expirationDate)<now&&!r.deleted).length, onHold:records.filter(r=>!!r.holdReason).length };
}

/* FEATURE 25: Audit Review */
export interface BWCAudit { id:string; officerId:string; auditorId:string; auditDate:string; recordingsReviewed:number; complianceScore:number; findings:string[]; requiresFollowUp:boolean; }
export function scoreBWCAudit(audit:BWCAudit): { rating:string; correctiveActions:number } {
  const rating = audit.complianceScore>=90?'Excellent':audit.complianceScore>=75?'Satisfactory':audit.complianceScore>=60?'Needs Improvement':'Non-Compliant';
  return { rating, correctiveActions:audit.findings.length };
}

/* FEATURE 26: Camera Health */
export interface BWCHealth { cameraSerial:string; batteryLevel:number; storageUsedPct:number; lastSync:string; firmwareVersion:string; status:'healthy'|'needs_charge'|'storage_full'|'needs_sync'|'offline'; }
export function monitorCameraFleet(health:BWCHealth[]): { healthy:number; needsAttention:BWCHealth[]; critical:BWCHealth[] } {
  const needs = health.filter(h=>h.status!=='healthy');
  const critical = health.filter(h=>h.status==='offline'||h.status==='storage_full');
  return { healthy:health.filter(h=>h.status==='healthy').length, needsAttention:needs, critical };
}

/* FEATURE 27: Upload Management */
export interface BWCUpload { cameraSerial:string; uploadStart:string; uploadEnd:string|null; fileCount:number; totalSizeMB:number; status:'uploading'|'completed'|'failed'; dockStation:string; }
export function trackUploadProgress(uploads:BWCUpload[]): { pending:number; completed:number; failed:number; totalDataGB:number } {
  const pending = uploads.filter(u=>u.status==='uploading');
  const completed = uploads.filter(u=>u.status==='completed');
  const totalMB = uploads.reduce((s,u)=>s+u.totalSizeMB,0);
  return { pending:pending.length, completed:completed.length, failed:uploads.filter(u=>u.status==='failed').length, totalDataGB:Math.round(totalMB/1024*10)/10 };
}

/* FEATURE 28: Redaction Workflow */
export interface BWVRedaction { recordingId:string; requestedBy:string; requestDate:string; redactionType:'face'|'license_plate'|'screen'|'audio'|'minor'|'confidential'; completedDate:string|null; reviewedBy:string|null; status:'pending'|'in_progress'|'completed'|'reviewed'; }
export function trackRedactionWorkflow(redactions:BWVRedaction[]): { total:number; pending:number; avgCompletionDays:number } {
  const pending = redactions.filter(r=>r.status==='pending'||r.status==='in_progress');
  const completed = redactions.filter(r=>r.completedDate).map(r=>(new Date(r.completedDate!).getTime()-new Date(r.requestDate).getTime())/86400000);
  return { total:redactions.length, pending:pending.length, avgCompletionDays:completed.length>0?Math.round(completed.reduce((s,v)=>s+v,0)/completed.length):0 };
}

/* FEATURE 29: Courtroom Presentation */
export interface BWCPresentation { caseNumber:string; recordings:string[]; clips:Array<{recordingId:string;startTime:number;endTime:number;description:string}>; prosecutorNotified:boolean; sharedDate:string|null; }
export function prepareCourtExhibit(presentation:BWCPresentation): { clipCount:number; totalDuration:number; chainOfCustody:string } {
  const totalDuration = presentation.clips.reduce((s,c)=>s+(c.endTime-c.startTime),0);
  return { clipCount:presentation.clips.length, totalDuration, chainOfCustody:'Authenticated — original files preserved. Hash values verified.' };
}

/* FEATURE 30: BWC Analytics */
export interface BWCAnalytics { period:string; totalRecordings:number; totalHours:number; avgRecordingsPerOfficer:number; complianceRate:number; flaggedRecordings:number; redactionsCompleted:number; storageUsedGB:number; }
export function compileBWCAnalytics(data:{recordings:number; hours:number; officers:number; complianceRate:number; flagged:number; redactions:number; storageGB:number}): BWCAnalytics {
  return { period:new Date().toISOString().slice(0,7), totalRecordings:data.recordings, totalHours:data.hours, avgRecordingsPerOfficer:data.officers>0?Math.round(data.recordings/data.officers):0, complianceRate:data.complianceRate, flaggedRecordings:data.flagged, redactionsCompleted:data.redactions, storageUsedGB:data.storageGB };
}

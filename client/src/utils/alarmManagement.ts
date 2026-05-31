// ============================================================
// RMPG Flex — Alarm Management (Spillman Flex Standard)
// 10 alarm features: alarm permit tracking, false alarm
// reduction, alarm company registry, alarm response
// classification, billing/fees, alarm system verification,
// enhanced call verification, alarm ordinance enforcement,
// keyholder database, and alarm statistical reporting.
// ============================================================

/* FEATURE 51: Alarm Permit Tracking */
export interface AlarmPermit { id:string; address:string; permitHolder:string; contactPhone:string; permitNumber:string; issuedDate:string; expirationDate:string; alarmCompany:string; alarmType:'burglary'|'fire'|'panic'|'medical'|'holdup'|'environmental'; status:'active'|'expired'|'revoked'|'pending'; annualFee:number; paid:boolean; }
export function checkPermitCompliance(permits:AlarmPermit[]): { active:number; expired:number; expiredUnpaid:AlarmPermit[]; complianceRate:number } {
  const now = new Date(); const active = permits.filter(p=>p.status==='active'&&new Date(p.expirationDate)>now);
  const expired = permits.filter(p=>new Date(p.expirationDate)<now||p.status==='expired');
  const expiredUnpaid = expired.filter(p=>!p.paid);
  return { active:active.length, expired:expired.length, expiredUnpaid, complianceRate:permits.length>0?Math.round(active.length/permits.length*100):100 };
}

/* FEATURE 52: False Alarm Reduction */
export interface AlarmEvent { id:string; permitId:string; date:string; time:string; alarmType:string; dispatched:boolean; responseCode:string|null; verified:boolean; falseAlarm:boolean; cause:string|null; officerId:string|null; }
export function calculateFalseAlarmRate(events:AlarmEvent[]): { totalAlarms:number; falseAlarms:number; falseAlarmRate:number; byPermit:Record<string,{total:number;falseAlarms:number}>; chronicOffenders:string[] } {
  const total = events.length; const falseAlarms = events.filter(e=>e.falseAlarm).length;
  const byPermit:Record<string,{total:number;falseAlarms:number}> = {};
  for (const e of events) { if (!byPermit[e.permitId]) byPermit[e.permitId]={total:0,falseAlarms:0}; byPermit[e.permitId].total++; if (e.falseAlarm) byPermit[e.permitId].falseAlarms++; }
  const chronic = Object.entries(byPermit).filter(([,v])=>v.total>=3&&v.falseAlarms/v.total>=0.5).map(([k])=>k);
  return { totalAlarms:total, falseAlarms, falseAlarmRate:total>0?Math.round(falseAlarms/total*100):0, byPermit, chronicOffenders:chronic };
}

/* FEATURE 53: Alarm Company Registry */
export interface AlarmCompany { id:string; companyName:string; licenseNumber:string; contactPhone:string; emergencyContact:string; addressesMonitored:number; permitsManaged:number; complianceStatus:'compliant'|'warning'|'non_compliant'; lastAudit:string|null; }
export function evaluateCompanyPerformance(company:AlarmCompany, falseAlarmRate:number): { rating:string; recommended:boolean; issues:string[] } {
  const issues:string[] = [];
  if (company.complianceStatus==='non_compliant') issues.push('Company is non-compliant with local ordinance');
  if (falseAlarmRate > 30) issues.push(`High false alarm rate (${falseAlarmRate}%)`);
  if (!company.lastAudit||new Date(company.lastAudit).getTime()<Date.now()-365*86400000) issues.push('Audit overdue');
  const rating = issues.length>=2?'Poor':issues.length>=1?'Fair':'Good';
  return { rating, recommended:issues.length===0, issues };
}

/* FEATURE 54: Alarm Response Classification */
export type AlarmResponseLevel = 'priority_1'|'priority_2'|'priority_3'|'no_response'|'verify_only';
export function determineAlarmResponse(alarm:{type:string;verified:boolean;multipleZones:boolean;videoConfirmation:boolean;audioConfirmation:boolean;permitValid:boolean;location:string}): { level:AlarmResponseLevel; justification:string } {
  if (!alarm.permitValid) return { level:'no_response', justification:'No valid alarm permit — response suspended per ordinance' };
  if (alarm.videoConfirmation||alarm.audioConfirmation) return { level:'priority_1', justification:'Verified alarm with audio/video confirmation — immediate response' };
  if (alarm.multipleZones&&alarm.verified) return { level:'priority_1', justification:'Multiple zone activation with verification' };
  if (alarm.verified) return { level:'priority_2', justification:'Verified alarm — dispatch response' };
  if (alarm.type==='panic'||alarm.type==='holdup') return { level:'priority_1', justification:'Panic/holdup alarm — highest priority response' };
  return { level:'verify_only', justification:'Unverified alarm — verify before dispatch' };
}

/* FEATURE 55: Alarm Billing / Fees */
export interface AlarmFeeSchedule { permitType:string; annualFee:number; falseAlarmFees:Array<{occurrence:number;fee:number}>; lateFee:number; reinstatementFee:number; }
export const DEFAULT_ALARM_FEES: AlarmFeeSchedule = { permitType:'residential', annualFee:35, falseAlarmFees:[{occurrence:1,fee:0},{occurrence:2,fee:50},{occurrence:3,fee:100},{occurrence:4,fee:200},{occurrence:5,fee:400}], lateFee:25, reinstatementFee:75 };
export function calculateAlarmFees(permit:AlarmPermit, falseAlarmsThisYear:number): { permitFee:number; falseAlarmFee:number; lateFee:number; total:number } {
  let falseFee = 0;
  for (const fee of DEFAULT_ALARM_FEES.falseAlarmFees) { if (falseAlarmsThisYear >= fee.occurrence) falseFee += fee.fee; else break; }
  const lateFee = !permit.paid && new Date(permit.expirationDate) < new Date() ? DEFAULT_ALARM_FEES.lateFee : 0;
  return { permitFee:permit.annualFee||DEFAULT_ALARM_FEES.annualFee, falseAlarmFee:falseFee, lateFee, total:permit.annualFee+falseFee+lateFee };
}

/* FEATURE 56: Alarm System Verification */
export interface AlarmVerification { alarmId:string; verificationMethod:'video'|'audio'|'multiple_call'|'cross_zone'|'eyewitness'|'owner_confirmation'|'none'; verifiedAt:string|null; verifiedBy:string|null; result:'confirmed_threat'|'false_alarm'|'inconclusive'|'pending'; notes:string; }
export function trackVerificationRate(verifications:AlarmVerification[]): { total:number; verified:number; confirmed:number; verificationRate:number; falseAlarmReduction:number } {
  const total = verifications.length||1;
  const verified = verifications.filter(v=>v.result!=='pending').length;
  const confirmed = verifications.filter(v=>v.result==='confirmed_threat').length;
  return { total:verifications.length, verified, confirmed, verificationRate:Math.round(verified/total*100), falseAlarmReduction:Math.round((1-verifications.filter(v=>v.result==='false_alarm').length/total)*100) };
}

/* FEATURE 57: Enhanced Call Verification */
export interface ECVProtocol { alarmId:string; ecvAttempted:boolean; call1Result:string|null; call2Result:string|null; smsResult:string|null; emailResult:string|null; appNotification:boolean; verifiedBeforeDispatch:boolean; dispatchDecision:'dispatch'|'cancel'|'reduce_priority'; }
export function evaluateECVEffectiveness(protocols:ECVProtocol[]): { ecvRate:number; dispatchPreventionRate:number; avgContactTime:number } {
  const ecvAttempted = protocols.filter(p=>p.ecvAttempted).length;
  const cancelled = protocols.filter(p=>p.ecvAttempted&&p.dispatchDecision==='cancel').length;
  return { ecvRate:protocols.length>0?Math.round(ecvAttempted/protocols.length*100):0, dispatchPreventionRate:ecvAttempted>0?Math.round(cancelled/ecvAttempted*100):0, avgContactTime:0 };
}

/* FEATURE 58: Alarm Ordinance Enforcement */
export interface OrdinanceViolation { alarmId:string; permitId:string; violationType:'no_permit'|'expired_permit'|'excessive_false_alarms'|'failure_to_respond'|'faulty_equipment'; violationDate:string; noticeSent:boolean; fineAmount:number; finePaid:boolean; hearingRequested:boolean; hearingDate:string|null; }
export function processOrdinanceViolations(violations:OrdinanceViolation[]): { totalViolations:number; finesIssued:number; finesCollected:number; collectionRate:number; pendingHearings:number } {
  const fines = violations.filter(v=>v.fineAmount>0);
  const paid = fines.filter(v=>v.finePaid).length;
  const hearings = violations.filter(v=>v.hearingRequested&&!v.hearingDate).length;
  return { totalViolations:violations.length, finesIssued:fines.reduce((s,v)=>s+v.fineAmount,0), finesCollected:fines.filter(v=>v.finePaid).reduce((s,v)=>s+v.fineAmount,0), collectionRate:fines.length>0?Math.round(paid/fines.length*100):0, pendingHearings:hearings };
}

/* FEATURE 59: Keyholder Database */
export interface Keyholder { id:string; address:string; name:string; phone:string; secondaryPhone:string|null; email:string|null; relationship:'owner'|'manager'|'employee'|'family'|'neighbor'|'other'; priority:number; verified:boolean; lastVerified:string|null; hasAccessCode:boolean; hasKeys:boolean; }
export function findResponsibleKeyholder(address:string, keyholders:Keyholder[]): Keyholder|null {
  const matches = keyholders.filter(k=>k.address.toLowerCase()===address.toLowerCase()&&k.verified);
  matches.sort((a,b)=>a.priority-b.priority);
  return matches.length>0?matches[0]:null;
}

/* FEATURE 60: Alarm Statistical Reporting */
export interface AlarmStatistics { period:string; totalAlarms:number; falseAlarms:number; verifiedAlarms:number; dispatchedAlarms:number; canceledBeforeArrival:number; avgResponseMinutes:number; permitsActive:number; permitsExpired:number; revenueCollected:number; }
export function compileAlarmStats(events:AlarmEvent[], permits:AlarmPermit[], fees:number): AlarmStatistics {
  const total = events.length;
  const falseAlarms = events.filter(e=>e.falseAlarm).length;
  const verified = events.filter(e=>e.verified).length;
  const dispatched = events.filter(e=>e.dispatched).length;
  const active = permits.filter(p=>p.status==='active').length;
  return { period:new Date().toISOString().slice(0,7), totalAlarms:total, falseAlarms, verifiedAlarms:verified, dispatchedAlarms:dispatched, canceledBeforeArrival:0, avgResponseMinutes:0, permitsActive:active, permitsExpired:permits.length-active, revenueCollected:fees };
}

// ============================================================
// RMPG Flex — Risk & Threat Assessment (Spillman Flex Standard)
// 10 risk features: threat matrix, vulnerability assessment,
// risk scoring, security survey, business continuity, critical
// infrastructure protection, special event risk, workplace
// violence prevention, suspicious indicator tracking,
// and risk management dashboard.
// ============================================================

/* FEATURE 51: Threat Matrix */
export interface ThreatMatrix { threatType:string; likelihood:1|2|3|4|5; impact:1|2|3|4|5; vulnerability:1|2|3|4|5; overallRisk:number; mitigationStrategies:string[]; }
export function calculateRiskScore(likelihood:number, impact:number, vulnerability:number): number { return Math.round((likelihood*impact*vulnerability)/5*20); }
export function prioritizeThreats(threats:ThreatMatrix[]): ThreatMatrix[] { return [...threats].sort((a,b)=>b.overallRisk-a.overallRisk); }

/* FEATURE 52: Vulnerability Assessment */
export interface VulnerabilityAssessment { facilityId:string; assessmentDate:string; assessor:string; findings:Array<{area:string;vulnerability:string;severity:'low'|'medium'|'high'|'critical';recommendation:string;status:'open'|'mitigated'|'accepted'}>; overallRating:'secure'|'moderate'|'vulnerable'|'critical'; }
export function assessOverallSecurity(findings:VulnerabilityAssessment['findings']): { score:number; rating:string; criticalItems:number } {
  const weights = {low:1,medium:3,high:7,critical:15}; const score = findings.filter(f=>f.status==='open').reduce((s,f)=>s+(weights[f.severity]||0),0);
  return { score, rating:score>=20?'critical':score>=10?'vulnerable':score>=5?'moderate':'secure', criticalItems:findings.filter(f=>f.severity==='critical'&&f.status==='open').length };
}

/* FEATURE 53: Security Survey */
export interface SecuritySurvey { propertyId:string; surveyDate:string; surveyor:string; sections:Array<{section:string;items:Array<{question:string;compliant:boolean;notes:string}>}>; overallCompliance:number; }
export function calculateSecurityCompliance(survey:SecuritySurvey): { compliancePct:number; criticalGaps:string[] } {
  const allItems = survey.sections.flatMap(s=>s.items); const compliant = allItems.filter(i=>i.compliant).length;
  return { compliancePct:allItems.length>0?Math.round(compliant/allItems.length*100):0, criticalGaps:allItems.filter(i=>!i.compliant).map(i=>i.question) };
}

/* FEATURE 54: Business Continuity */
export interface BCPlan { department:string; essentialFunctions:string[]; rtoHours:number; alternateSite:string; backupSystems:string[]; lastTested:string|null; testResult:string|null; }
export function evaluateBCReadiness(plans:BCPlan[]): { totalPlans:number; testedPlans:number; readyRate:number } {
  const tested = plans.filter(p=>p.lastTested&&new Date(p.lastTested).getTime()>Date.now()-365*86400000);
  return { totalPlans:plans.length, testedPlans:tested.length, readyRate:plans.length>0?Math.round(tested.length/plans.length*100):0 };
}

/* FEATURE 55: Critical Infrastructure Protection */
export interface CriticalAsset { id:string; assetName:string; assetType:string; location:string; threatLevel:'low'|'medium'|'high'|'critical'; protectiveMeasures:string[]; lastInspected:string; }
export function prioritizeAssetProtection(assets:CriticalAsset[]): CriticalAsset[] {
  return [...assets].sort((a,b)=>{const lv={critical:4,high:3,medium:2,low:1};return(lv[b.threatLevel]||0)-(lv[a.threatLevel]||0);});
}

/* FEATURE 56: Special Event Risk */
export interface EventRiskAssessment { eventName:string; date:string; expectedAttendance:number; threatLevel:'low'|'moderate'|'elevated'|'high'; securityMeasures:string[]; resourcesRequired:number; resourcesAssigned:number; }
export function calculateEventResourceGap(assessment:EventRiskAssessment): { deficit:number; riskLevel:string; recommendation:string } {
  const deficit = Math.max(0,assessment.resourcesRequired-assessment.resourcesAssigned);
  return { deficit, riskLevel:deficit>5?'critical':deficit>2?'warning':'adequate', recommendation:deficit>0?`Request ${deficit} additional resources`:'Resources adequate' };
}

/* FEATURE 57: Workplace Violence Prevention */
export interface WPVIncident { id:string; date:string; location:string; incidentType:'verbal_threat'|'physical_altercation'|'weapon_displayed'|'active_threat'; subjectType:'employee'|'visitor'|'former_employee'|'domestic'|'stranger'; outcome:string; restrainingOrder:boolean; }
export function analyzeWPVTrends(incidents:WPVIncident[]): { total:number; byType:Record<string,number>; escalatingPattern:boolean } {
  const byType:Record<string,number> = {}; for (const i of incidents) byType[i.incidentType]=(byType[i.incidentType]||0)+1;
  const recent = incidents.filter(i=>new Date(i.date).getTime()>Date.now()-90*86400000);
  const older = incidents.filter(i=>new Date(i.date).getTime()<=Date.now()-90*86400000);
  return { total:incidents.length, byType, escalatingPattern:recent.length>older.length };
}

/* FEATURE 58: Suspicious Indicator Tracking */
export interface SuspiciousIndicator { id:string; indicatorType:string; description:string; observedDate:string; location:string; reportedBy:string; assessed:'non_suspicious'|'suspicious'|'concerning'|'imminent_threat'; }
export function correlateIndicators(indicators:SuspiciousIndicator[], timeframeHours:number=24): SuspiciousIndicator[][] {
  const groups:SuspiciousIndicator[][] = []; const used=new Set<number>();
  for (let i=0;i<indicators.length;i++) { if (used.has(i)) continue; const group=[indicators[i]]; used.add(i);
    for (let j=i+1;j<indicators.length;j++) { if (used.has(j)) continue; const tDiff=Math.abs(new Date(indicators[i].observedDate).getTime()-new Date(indicators[j].observedDate).getTime())/3600000; if (tDiff<timeframeHours){group.push(indicators[j]);used.add(j);} }
    if (group.length>=2) groups.push(group);
  }
  return groups;
}

/* FEATURE 59: Active Shooter Preparedness */
export interface ASPreparedness { facilityId:string; hasPlan:boolean; lastDrill:string|null; staffTrained:number; totalStaff:number; runHideFightBriefed:boolean; lockdownProcedures:string; reunificationPlan:string; }
export function assessASReadiness(prep:ASPreparedness): { readinessScore:number; criticalGaps:string[] } {
  const gaps:string[] = []; let score = 0;
  if (prep.hasPlan) score+=30; else gaps.push('No active shooter plan');
  if (prep.lastDrill&&new Date(prep.lastDrill).getTime()>Date.now()-365*86400000) score+=20; else gaps.push('No recent drill');
  if (prep.staffTrained/prep.totalStaff>0.8) score+=25; else gaps.push('Insufficient staff training');
  if (prep.runHideFightBriefed) score+=15; else gaps.push('Run-Hide-Fight not briefed');
  if (prep.reunificationPlan) score+=10; else gaps.push('No reunification plan');
  return { readinessScore:score, criticalGaps:gaps };
}

/* FEATURE 60: Risk Management Dashboard */
export interface RiskDashboard { totalThreats:number; highRiskThreats:number; vulnerabilitiesOpen:number; securitySurveyCompliance:number; bcPlansReady:number; specialEventsThisMonth:number; wpvIncidents:number; overallRiskLevel:string; }
export function compileRiskDashboard(threats:ThreatMatrix[], vulns:VulnerabilityAssessment[], security:SecuritySurvey[], bc:BCPlan[]): RiskDashboard {
  const highThreats = threats.filter(t=>t.overallRisk>=70).length;
  const openVulns = vulns.reduce((s,v)=>s+v.findings.filter(f=>f.status==='open').length,0);
  const bcReady = bc.filter(p=>p.lastTested&&new Date(p.lastTested).getTime()>Date.now()-365*86400000).length;
  return { totalThreats:threats.length, highRiskThreats:highThreats, vulnerabilitiesOpen:openVulns, securitySurveyCompliance:0, bcPlansReady:bcReady, specialEventsThisMonth:0, wpvIncidents:0, overallRiskLevel:highThreats>0||openVulns>5?'elevated':'moderate' };
}

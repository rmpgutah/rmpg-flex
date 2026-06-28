// ============================================================
// RMPG Flex — K-9 Unit Management (Spillman Flex Standard)
// 10 K-9 features: health tracking, training logs, deployment
// records, certification tracking, retirement planning, bite
// ratio analysis, narcotics detection stats, patrol K-9 metrics,
// equipment inventory, and veterinary schedule.
// ============================================================

/* FEATURE 41: K-9 Health Tracking */
export interface K9HealthRecord { k9Id: string; k9Name: string; breed: string; dob: string; weight: number; lastVetVisit: string; nextVetVisit: string; vaccinations: Array<{ name: string; date: string; nextDue: string }>; medicalConditions: string[]; medications: Array<{ name: string; dosage: string; frequency: string }>; diet: string; notes: string; }
export function generateHealthReport(k9: K9HealthRecord): { status: 'healthy'|'needs_attention'|'urgent'; upcomingAppointments: number; overdueVaccinations: string[]; weightTrend: string } {
  const now = new Date(); const overdue = k9.vaccinations.filter(v => new Date(v.nextDue) < now).map(v => v.name);
  const upcoming = k9.vaccinations.filter(v => { const d = new Date(v.nextDue); return d > now && d.getTime() - now.getTime() < 30*86400000; }).length;
  let status: 'healthy'|'needs_attention'|'urgent' = 'healthy';
  if (overdue.length > 2) status = 'urgent'; else if (overdue.length > 0) status = 'needs_attention';
  return { status, upcomingAppointments: upcoming, overdueVaccinations: overdue, weightTrend: 'stable' };
}

/* FEATURE 42: K-9 Training Logs */
export interface K9TrainingLog { id: string; k9Id: string; date: string; type: 'obedience'|'tracking'|'narcotics'|'explosives'|'patrol'|'bite_work'|'article_search'|'building_search'|'area_search'|'agility'; durationMinutes: number; handlerId: string; performance: 1|2|3|4|5; notes: string; decoyId: string|null; }
export function analyzeTrainingProgress(logs: K9TrainingLog[]): { totalHours: number; byType: Record<string,number>; avgPerformance: number; trend: 'improving'|'stable'|'declining'; certificationsReady: string[] } {
  const totalHours = Math.round(logs.reduce((s,l)=>s+l.durationMinutes,0) / 60);
  const byType: Record<string,number> = {}; for (const l of logs) byType[l.type] = (byType[l.type]||0) + l.durationMinutes;
  const avgPerf = logs.length > 0 ? Math.round(logs.reduce((s,l)=>s+l.performance,0) / logs.length * 10) / 10 : 0;
  const recent = logs.slice(-10).reduce((s,l)=>s+l.performance,0) / Math.max(1,logs.slice(-10).length);
  const older = logs.slice(-20,-10).reduce((s,l)=>s+l.performance,0) / Math.max(1,logs.slice(-20,-10).length);
  const trend = recent > older + 0.3 ? 'improving' : recent < older - 0.3 ? 'declining' : 'stable';
  const ready: string[] = [];
  if ((byType['narcotics']||0) > 1200 && avgPerf >= 4) ready.push('Narcotics Detection');
  if ((byType['tracking']||0) > 800 && avgPerf >= 4) ready.push('Tracking/Trailing');
  if ((byType['patrol']||0) > 600 && avgPerf >= 4) ready.push('Patrol Certification');
  return { totalHours, byType, avgPerformance: avgPerf, trend, certificationsReady: ready };
}

/* FEATURE 43: K-9 Deployment Records */
export interface K9Deployment { id: string; k9Id: string; date: string; callType: string; deploymentType: 'track'|'article_search'|'building_search'|'area_search'|'narcotics_sniff'|'explosives_sniff'|'apprehension'|'handler_protection'|'crowd_control'; outcome: 'positive_find'|'negative_find'|'apprehension'|'deterrent'|'other'; durationMinutes: number; location: string; }
export function calculateK9Effectiveness(deployments: K9Deployment[]): { totalDeployments: number; successRate: number; byType: Record<string,{total:number;successes:number;rate:number}>; avgDuration: number } {
  const total = deployments.length;
  const successes = deployments.filter(d => ['positive_find','apprehension'].includes(d.outcome)).length;
  const byType: Record<string,{total:number;successes:number;rate:number}> = {};
  for (const d of deployments) { if (!byType[d.deploymentType]) byType[d.deploymentType] = {total:0,successes:0,rate:0}; byType[d.deploymentType].total++; if (['positive_find','apprehension'].includes(d.outcome)) byType[d.deploymentType].successes++; }
  for (const k of Object.keys(byType)) byType[k].rate = Math.round(byType[k].successes / byType[k].total * 100);
  return { totalDeployments: total, successRate: total > 0 ? Math.round(successes / total * 100) : 0, byType, avgDuration: total > 0 ? Math.round(deployments.reduce((s,d)=>s+d.durationMinutes,0)/total) : 0 };
}

/* FEATURE 44: K-9 Certification Tracking */
export interface K9Certification { id: string; k9Id: string; certType: string; certifyingBody: string; issuedDate: string; expirationDate: string; score: number; evaluator: string; status: 'active'|'expiring'|'expired'; }
export function useK9Certifications() {
  const certs = reactive<{items:K9Certification[];expiring:K9Certification[];complianceRate:number}>({ items: [], expiring: [], complianceRate: 0 });
  const checkCerts = (list: K9Certification[]) => {
    const now = new Date(); const expiring = list.filter(c => { const d = new Date(c.expirationDate); return (d.getTime() - now.getTime()) / 86400000 < 90 && c.status !== 'expired'; });
    const active = list.filter(c => c.status === 'active').length;
    return { items: list, expiring, complianceRate: list.length > 0 ? Math.round(active / list.length * 100) : 100 };
  };
  return { certs, checkCerts };
}
function reactive<T>(initial: T): { value: T } { let val = initial; return { get value() { return val; }, set value(v: T) { val = v; } }; }

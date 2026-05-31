// ============================================================
// RMPG Flex — Internal Affairs / Professional Standards (Spillman Flex Standard)
// 10 IA features: complaint intake, investigation workflow,
// case management, officer notification, disciplinary tracking,
// early intervention, use-of-force review, bias auditing,
// complaint statistics, and policy compliance tracking.
// ============================================================

import { useState, useCallback, useMemo } from 'react';
import { apiFetch } from './useApi';

/* FEATURE 21: Complaint Intake */
export interface IAComplaint { id: string; complainantName: string; complainantContact: string; complaintType: 'excessive_force'|'discourtesy'|'harassment'|'improper_procedure'|'misconduct'|'ethics'|'discrimination'|'other'; officerInvolved: string; dateOfIncident: string; location: string; description: string; witnesses: string[]; evidence: string[]; status: 'submitted'|'screening'|'investigation'|'review'|'sustained'|'not_sustained'|'exonerated'|'unfounded'|'closed'; priority: 'routine'|'priority'|'critical'; assignedTo: string|null; }
export function useIAComplaints() {
  const [complaints, setComplaints] = useState<IAComplaint[]>([]); const [loading, setLoading] = useState(false);
  const load = useCallback(async () => { setLoading(true); try { const r = await apiFetch<IAComplaint[]>('/admin/ia/complaints'); if (r) setComplaints(r); } catch {} setLoading(false); }, []);
  const open = useMemo(() => complaints.filter(c => !['sustained','not_sustained','exonerated','unfounded','closed'].includes(c.status)), [complaints]);
  const critical = useMemo(() => complaints.filter(c => c.priority === 'critical' && !['sustained','not_sustained','exonerated','unfounded','closed'].includes(c.status)), [complaints]);
  return { complaints, loading, load, open, critical };
}

/* FEATURE 22: Investigation Workflow */
export interface IAInvestigation { complaintId: string; investigatorId: string; openedDate: string; dueDate: string; steps: Array<{ step: string; completed: boolean; completedDate: string|null; notes: string }>; interviews: Array<{ interviewee: string; date: string; summary: string; recorded: boolean }>; findings: string|null; recommendation: string|null; }
export function trackInvestigationProgress(investigation: IAInvestigation): { pctComplete: number; onTrack: boolean; daysRemaining: number; overdueSteps: string[] } {
  const completed = investigation.steps.filter(s => s.completed).length;
  const pct = investigation.steps.length > 0 ? Math.round(completed / investigation.steps.length * 100) : 0;
  const daysRemaining = Math.ceil((new Date(investigation.dueDate).getTime() - Date.now()) / 86400000);
  const overdue = investigation.steps.filter(s => !s.completed).map(s => s.step);
  return { pctComplete: pct, onTrack: daysRemaining >= 0, daysRemaining, overdueSteps: daysRemaining < 0 ? overdue : [] };
}

/* FEATURE 23: Case Management */
export function prioritizeIACases(cases: IAComplaint[]): IAComplaint[] {
  const weight = { excessive_force: 10, discrimination: 9, harassment: 8, misconduct: 7, ethics: 6, improper_procedure: 4, discourtesy: 3, other: 2 };
  return [...cases].sort((a,b) => { const scoreA = (a.priority === 'critical' ? 20 : a.priority === 'priority' ? 10 : 0) + (weight[a.complaintType]||0); const scoreB = (b.priority === 'critical' ? 20 : b.priority === 'priority' ? 10 : 0) + (weight[b.complaintType]||0); return scoreB - scoreA; });
}

/* FEATURE 24: Officer Notification */
export interface OfficerNotification { complaintId: string; officerId: string; notifiedAt: string|null; notificationMethod: 'in_person'|'certified_mail'|'email'|null; acknowledgedAt: string|null; representationRequested: boolean; representativeName: string|null; gagOrderIssued: boolean; }
export function generateOfficerNotification(complaintId: string, officerId: string): OfficerNotification {
  return { complaintId, officerId, notifiedAt: null, notificationMethod: null, acknowledgedAt: null, representationRequested: false, representativeName: null, gagOrderIssued: true };
}

/* FEATURE 25: Disciplinary Tracking */
export interface DisciplinaryAction { id: string; complaintId: string; officerId: string; actionType: 'verbal_counseling'|'written_reprimand'|'suspension'|'demotion'|'termination'|'training_referral'; issuedDate: string; effectiveDate: string; duration: number|null; appealDeadline: string; appealFiled: boolean; appealStatus: string|null; }
export function useDisciplinaryTracking() {
  const [actions, setActions] = useState<DisciplinaryAction[]>([]); const [loading, setLoading] = useState(false);
  const load = useCallback(async () => { setLoading(true); try { const r = await apiFetch<DisciplinaryAction[]>('/admin/ia/disciplinary'); if (r) setActions(r); } catch {} setLoading(false); }, []);
  const active = useMemo(() => actions.filter(a => new Date(a.effectiveDate) <= new Date() && (!a.duration || new Date(a.effectiveDate).getTime() + a.duration*86400000 > Date.now())), [actions]);
  const underAppeal = useMemo(() => actions.filter(a => a.appealFiled && a.appealStatus !== 'resolved'), [actions]);
  return { actions, loading, load, active, underAppeal };
}

/* FEATURE 26: Early Intervention System */
export interface EarlyInterventionAlert { officerId: string; officerName: string; alertType: 'use_of_force_frequency'|'complaint_frequency'|'sick_leave_pattern'|'pursuit_frequency'|'performance_decline'|'peer_concerns'; threshold: number; currentValue: number; triggered: boolean; recommendedAction: string; }
export function evaluateEarlyIntervention(metrics: Record<string,number>, thresholds: Record<string,number>): EarlyInterventionAlert[] {
  const alerts: EarlyInterventionAlert[] = [];
  const map: Record<string,{type:EarlyInterventionAlert['alertType'];action:string}> = {
    useOfForce: { type: 'use_of_force_frequency', action: 'Review all UoF reports. Consider additional de-escalation training.' },
    complaints: { type: 'complaint_frequency', action: 'Review complaint history. Schedule supervisor conference.' },
    sickDays: { type: 'sick_leave_pattern', action: 'Check wellness. Offer peer support resources.' },
    pursuits: { type: 'pursuit_frequency', action: 'Review pursuit policy compliance. Consider remedial driver training.' },
  };
  for (const [key, threshold] of Object.entries(thresholds)) {
    const val = metrics[key] || 0;
    if (val >= threshold && map[key]) {
      alerts.push({ officerId: '', officerName: '', alertType: map[key].type, threshold, currentValue: val, triggered: true, recommendedAction: map[key].action });
    }
  }
  return alerts;
}

/* FEATURE 27: Use-of-Force Review */
export interface UoFReview { incidentId: string; officerId: string; reviewDate: string; reviewerId: string; forceType: string; policyCompliant: boolean; withinPolicy: boolean; justificationAdequate: boolean; deescalationAttempted: boolean; supervisorOnScene: boolean; bwcReviewed: boolean; findings: string; recommendations: string[]; }
export function scoreUoFReview(review: UoFReview): { score: number; grade: string; requiresFurtherReview: boolean } {
  let score = 0;
  if (review.policyCompliant) score += 25;
  if (review.withinPolicy) score += 25;
  if (review.justificationAdequate) score += 20;
  if (review.deescalationAttempted) score += 15;
  if (review.supervisorOnScene) score += 10;
  if (review.bwcReviewed) score += 5;
  const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : 'D';
  return { score, grade, requiresFurtherReview: score < 75 };
}

/* FEATURE 28: Bias Auditing */
export interface BiasAudit { period: string; totalStops: number; byRace: Record<string,number>; byGender: Record<string,number>; searchRate: number; arrestRate: number; citationRate: number; warningRate: number; disparityIndex: Record<string,number>; findings: string; }
export function calculateDisparityIndex(stopsByGroup: Record<string,number>, populationByGroup: Record<string,number>): Record<string,number> {
  const totalStops = Object.values(stopsByGroup).reduce((s,v)=>s+v,0);
  const totalPop = Object.values(populationByGroup).reduce((s,v)=>s+v,0);
  const index: Record<string,number> = {};
  for (const group of Object.keys(stopsByGroup)) {
    const stopPct = stopsByGroup[group] / totalStops;
    const popPct = (populationByGroup[group]||1) / totalPop;
    index[group] = Math.round(stopPct / Math.max(0.001, popPct) * 100) / 100;
  }
  return index;
}

/* FEATURE 29: Complaint Statistics */
export interface IAStats { totalComplaints: number; sustained: number; notSustained: number; exonerated: number; unfounded: number; avgInvestigationDays: number; byType: Array<{type:string;count:number;sustainedRate:number}>; byOfficer: Array<{officerName:string;count:number;repeatOffender:boolean}>; trend: 'increasing'|'stable'|'decreasing'; }
export function useIAStats() {
  const [stats, setStats] = useState<IAStats|null>(null); const [loading, setLoading] = useState(false);
  const load = useCallback(async () => { setLoading(true); try { const r = await apiFetch<IAStats>('/admin/ia/stats'); if (r) setStats(r); } catch {} setLoading(false); }, []);
  return { stats, loading, load };
}

/* FEATURE 30: Policy Compliance Tracking */
export interface PolicyAcknowledgement { policyId: string; policyTitle: string; version: string; effectiveDate: string; acknowledgedBy: string; acknowledgedAt: string|null; dueDate: string; status: 'acknowledged'|'pending'|'overdue'; }
export function usePolicyCompliance() {
  const [policies, setPolicies] = useState<PolicyAcknowledgement[]>([]); const [loading, setLoading] = useState(false);
  const load = useCallback(async () => { setLoading(true); try { const r = await apiFetch<PolicyAcknowledgement[]>('/admin/policies/acknowledgements'); if (r) setPolicies(r); } catch {} setLoading(false); }, []);
  const overdue = useMemo(() => policies.filter(p => p.status === 'overdue'), [policies]);
  const complianceRate = useMemo(() => policies.length > 0 ? Math.round(policies.filter(p => p.status === 'acknowledged').length / policies.length * 100) : 100, [policies]);
  return { policies, loading, load, overdue, complianceRate };
}

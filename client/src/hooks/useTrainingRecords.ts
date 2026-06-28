// ============================================================
// RMPG Flex — Training & Certification (Spillman Flex Standard)
// 10 training features: certification tracking, training hours,
// qualification expiry, lesson plans, instructor management,
// training compliance, skill matrix, academy tracking, FTO
// program, and continuing education credits.
// ============================================================

import { useState, useCallback, useMemo } from 'react';
import { apiFetch } from './useApi';

/* FEATURE 11: Certification Tracking */
export interface Certification { id: string; officerId: string; name: string; issuingAuthority: string; issuedDate: string; expirationDate: string; status: 'active'|'expiring'|'expired'; renewalRequired: boolean; renewalHours: number; }
export function useCertificationTracking(officerId?: string) {
  const [certs, setCerts] = useState<Certification[]>([]); const [loading, setLoading] = useState(false);
  const load = useCallback(async () => { setLoading(true); try { const q = officerId ? `?officerId=${officerId}` : ''; const r = await apiFetch<Certification[]>(`/personnel/certifications${q}`); if (r) setCerts(r); } catch (err) { console.warn('[useCertificationTracking] load failed:', err); } setLoading(false); }, [officerId]);
  const expiring = useMemo(() => certs.filter(c => c.status === 'expiring'), [certs]);
  const expired = useMemo(() => certs.filter(c => c.status === 'expired'), [certs]);
  return { certs, loading, load, expiring, expired };
}

/* FEATURE 12: Training Hours Tracking */
export interface TrainingHours { officerId: string; year: number; requiredHours: number; completedHours: number; remainingHours: number; byCategory: Array<{ category: string; hours: number; required: number }>; compliance: boolean; }
export function calculateTrainingCompliance(completedHours: number, requiredHours: number, categories: Array<{category:string;hours:number;required:number}>): { pct: number; compliant: boolean; deficits: string[] } {
  const pct = requiredHours > 0 ? Math.round(completedHours / requiredHours * 100) : 100;
  const deficits = categories.filter(c => c.hours < c.required).map(c => `${c.category}: ${c.required - c.hours}h needed`);
  return { pct, compliant: pct >= 100 && deficits.length === 0, deficits };
}

/* FEATURE 13: Qualification Expiry Alerts */
export interface QualificationAlert { officerId: string; officerName: string; qualification: string; expiresInDays: number; expirationDate: string; requiredFor: string; renewalProcess: string; }
export function generateExpiryAlerts(quals: Array<{officerId:string;officerName:string;qualification:string;expirationDate:string;requiredFor:string;renewalProcess:string}>): QualificationAlert[] {
  const now = new Date();
  return quals.map(q => { const days = Math.ceil((new Date(q.expirationDate).getTime() - now.getTime()) / 86400000); return { ...q, expiresInDays: days }; }).filter(q => q.expiresInDays <= 90).sort((a,b) => a.expiresInDays - b.expiresInDays);
}

/* FEATURE 14: Lesson Plan Library */
export interface LessonPlan { id: string; title: string; category: string; durationMinutes: number; instructorLevel: string; materials: string[]; objectives: string[]; assessmentMethod: string; lastUpdated: string; version: number; }
export function useLessonPlanLibrary() {
  const [plans, setPlans] = useState<LessonPlan[]>([]); const [loading, setLoading] = useState(false);
  const load = useCallback(async () => { setLoading(true); try { const r = await apiFetch<LessonPlan[]>('/personnel/training/lesson-plans'); if (r) setPlans(r); } catch (err) { console.warn("[useTrainingRecords] load failed:", err); } setLoading(false); }, []);
  const byCategory = useMemo(() => { const m = new Map<string,LessonPlan[]>(); for (const p of plans) { if (!m.has(p.category)) m.set(p.category, []); m.get(p.category)!.push(p); } return m; }, [plans]);
  return { plans, loading, load, byCategory };
}

/* FEATURE 15: Instructor Management */
export interface Instructor { id: string; name: string; certifications: string[]; coursesTaught: number; avgRating: number; availability: string[]; status: 'active'|'inactive'; }
export function matchInstructorToCourse(course: {category:string;level:string}, instructors: Instructor[]): Instructor[] {
  return instructors.filter(i => i.status === 'active' && i.certifications.some(c => c.toLowerCase().includes(course.category.toLowerCase()))).sort((a,b) => b.avgRating - a.avgRating);
}

/* FEATURE 16: Training Compliance Dashboard */
export interface TrainingCompliance { department: { requiredAnnualHours:number; avgCompleted:number; complianceRate:number; overdueOfficers:number; }; byDivision: Array<{ division:string; officers:number; compliant:number; rate:number }>; criticalDeficits: Array<{ qualification:string; officersMissing:number; deadline: string }>; }
export function useTrainingCompliance() {
  const [compliance, setCompliance] = useState<TrainingCompliance|null>(null); const [loading, setLoading] = useState(false);
  const load = useCallback(async () => { setLoading(true); try { const r = await apiFetch<TrainingCompliance>('/personnel/training/compliance'); if (r) setCompliance(r); } catch (err) { console.warn("[useTrainingRecords] load failed:", err); } setLoading(false); }, []);
  return { compliance, loading, load };
}

/* FEATURE 17: Skills Matrix */
export interface SkillMatrix { officerId: string; officerName: string; skills: Array<{ name: string; level: 1|2|3|4|5; required: boolean; lastAssessed: string; assessor: string }>; overallScore: number; gapAreas: string[]; }
export function analyzeSkillGaps(matrix: SkillMatrix): { criticalGaps: string[]; developmentalAreas: string[]; strengths: string[]; readinessScore: number } {
  const critical: string[] = []; const dev: string[] = []; const strengths: string[] = [];
  for (const s of matrix.skills) { if (s.required && s.level < 3) critical.push(s.name); else if (s.level < 3) dev.push(s.name); else if (s.level >= 4) strengths.push(s.name); }
  const readiness = matrix.skills.filter(s => s.required).length > 0 ? Math.round(matrix.skills.filter(s => s.required).reduce((sum,s) => sum + s.level, 0) / matrix.skills.filter(s => s.required).length * 20) : 0;
  return { criticalGaps: critical, developmentalAreas: dev, strengths, readinessScore: readiness };
}

/* FEATURE 18: Academy Tracking */
export interface AcademyClass { id: string; name: string; startDate: string; endDate: string; totalRecruits: number; activeRecruits: number; graduated: number; dropped: number; curriculum: Array<{ phase: string; weeks: number; status: string }>; }
export function useAcademyTracking() {
  const [classes, setClasses] = useState<AcademyClass[]>([]); const [loading, setLoading] = useState(false);
  const load = useCallback(async () => { setLoading(true); try { const r = await apiFetch<AcademyClass[]>('/personnel/training/academy'); if (r) setClasses(r); } catch (err) { console.warn("[useTrainingRecords] load failed:", err); } setLoading(false); }, []);
  const active = useMemo(() => classes.filter(c => new Date(c.endDate) > new Date()), [classes]);
  return { classes, loading, load, active };
}

/* FEATURE 19: FTO Program Tracking */
export interface FTOAssignment { recruitId: string; recruitName: string; ftoId: string; ftoName: string; phase: 1|2|3|4; startDate: string; endDate: string; dailyReports: number; ratingAvg: number; status: 'active'|'completed'|'extended'|'remedial'; }
export function evaluateFTOProgress(assignment: FTOAssignment, reports: Array<{rating:number;competencies:Record<string,number>}>): { overallRating: number; phaseReadiness: boolean; recommendations: string[] } {
  const avg = reports.length > 0 ? reports.reduce((s,r) => s + r.rating, 0) / reports.length : 0;
  const recs: string[] = [];
  if (avg < 3) recs.push('Performance below standard — remedial training recommended');
  else if (avg < 4) recs.push('Progressing adequately — continue current phase');
  else recs.push('Exceeding standards — consider accelerated advancement');
  return { overallRating: Math.round(avg*10)/10, phaseReadiness: avg >= 3, recommendations: recs };
}

/* FEATURE 20: Continuing Education Credits */
export interface CECredit { officerId: string; courseName: string; provider: string; hours: number; completedDate: string; certNumber: string; category: string; verified: boolean; }
export function trackCEProgress(officerId: string, credits: CECredit[], requiredPerYear: number): { earned: number; remaining: number; compliant: boolean; byCategory: Record<string,number>; expiresSoon: CECredit[] } {
  const now = new Date(); const thisYear = credits.filter(c => new Date(c.completedDate).getFullYear() === now.getFullYear());
  const earned = thisYear.reduce((s,c) => s + c.hours, 0);
  const byCategory: Record<string,number> = {}; for (const c of thisYear) { byCategory[c.category] = (byCategory[c.category]||0) + c.hours; }
  const expiresSoon = credits.filter(c => { const d = new Date(c.completedDate); d.setFullYear(d.getFullYear()+2); return (d.getTime() - now.getTime()) / 86400000 < 90 && (d.getTime() - now.getTime()) > 0; });
  return { earned: Math.round(earned*10)/10, remaining: Math.max(0, requiredPerYear - earned), compliant: earned >= requiredPerYear, byCategory, expiresSoon };
}

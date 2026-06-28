// ============================================================
// RMPG Flex — Grants & Budget Management (Spillman Flex Standard)
// 10 grants features: grant tracking, budget allocation,
// expenditure reporting, overtime cost analysis, equipment
// lifecycle budgeting, grant application workflow, quarterly
// reporting, match requirement tracking, compliance monitoring,
// and fiscal year planning.
// ============================================================

/* FEATURE 61: Grant Tracking */
export interface Grant { id: string; name: string; grantingAgency: string; awardAmount: number; awardDate: string; startDate: string; endDate: string; matchRequired: number; matchProvided: number; fundsExpended: number; fundsRemaining: number; status: 'active'|'closed'|'extended'; programAreas: string[]; }
export function calculateGrantBurnRate(grant: Grant): { burnRate: number; monthsRemaining: number; monthlySpend: number; onTrack: boolean; riskOfLapsing: boolean } {
  const start = new Date(grant.startDate); const end = new Date(grant.endDate);
  const totalMonths = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
  const elapsedMonths = (new Date().getFullYear() - start.getFullYear()) * 12 + (new Date().getMonth() - start.getMonth());
  const monthlySpend = elapsedMonths > 0 ? grant.fundsExpended / elapsedMonths : 0;
  const expectedMonthly = grant.awardAmount / Math.max(1, totalMonths);
  const monthsRemaining = Math.max(0, totalMonths - elapsedMonths);
  return { burnRate: Math.round(monthlySpend), monthsRemaining, monthlySpend: Math.round(monthlySpend), onTrack: monthlySpend >= expectedMonthly * 0.8 && monthlySpend <= expectedMonthly * 1.2, riskOfLapsing: monthsRemaining > 0 && grant.fundsRemaining / monthsRemaining > monthlySpend * 1.5 };
}

/* FEATURE 62: Budget Allocation */
export interface BudgetAllocation { fiscalYear: number; department: string; category: string; allocated: number; expended: number; encumbered: number; remaining: number; pctUsed: number; }
export function analyzeBudgetUtilization(allocations: BudgetAllocation[]): { totalBudget: number; totalExpended: number; overallPct: number; overBudget: BudgetAllocation[]; underUtilized: BudgetAllocation[] } {
  const totalBudget = allocations.reduce((s,a)=>s+a.allocated,0);
  const totalExpended = allocations.reduce((s,a)=>s+a.expended+a.encumbered,0);
  const overBudget = allocations.filter(a => a.expended + a.encumbered > a.allocated);
  const underUtilized = allocations.filter(a => a.pctUsed < 50 && a.expended + a.encumbered < a.allocated * 0.5);
  return { totalBudget, totalExpended, overallPct: totalBudget > 0 ? Math.round(totalExpended/totalBudget*100) : 0, overBudget, underUtilized };
}

/* FEATURE 63: Expenditure Reporting */
export interface ExpenditureReport { period: string; totalExpenditures: number; byCategory: Record<string,number>; byGrant: Record<string,number>; personnel: number; equipment: number; supplies: number; travel: number; training: number; other: number; }
export function generateExpenditureSummary(report: ExpenditureReport): { personnelPct: number; equipmentPct: number; programmaticPct: number; administrativePct: number } {
  const total = report.totalExpenditures || 1;
  const personnelPct = Math.round(report.personnel / total * 100);
  const adminPct = Math.round(report.travel / total * 100);
  return { personnelPct, equipmentPct: Math.round(report.equipment/total*100), programmaticPct: 100 - personnelPct - adminPct, administrativePct: adminPct };
}

/* FEATURE 64: Overtime Cost Analysis */
export interface OvertimeAnalysis { period: string; totalOvertimeHours: number; totalOvertimeCost: number; avgHoursPerOfficer: number; topOfficers: Array<{ officerName: string; hours: number; cost: number }>; byReason: Record<string,number>; budgetImpact: number; }
export function calculateOvertimeRate(hours: number, hourlyRate: number, isHoliday: boolean): { regularOvertime: number; holidayPay: number; total: number } {
  if (isHoliday) return { regularOvertime: hours * hourlyRate * 1.5, holidayPay: hours * hourlyRate * 0.5, total: hours * hourlyRate * 2.0 };
  return { regularOvertime: hours * hourlyRate * 1.5, holidayPay: 0, total: hours * hourlyRate * 1.5 };
}

/* FEATURE 65: Equipment Lifecycle Budgeting */
export interface EquipmentBudget { item: string; quantity: number; unitCost: number; totalCost: number; lifespanYears: number; annualReplacement: number; replacementYear: number; priority: 'critical'|'needed'|'planned'; }
export function generateEquipmentReplacementPlan(items: EquipmentBudget[], fiscalYears: number): { annualCost: number; criticalItems: EquipmentBudget[]; totalFiveYear: number } {
  const now = new Date().getFullYear();
  const urgent = items.filter(i => i.priority === 'critical' && i.replacementYear <= now + 1);
  const totalFiveYear = items.filter(i => i.replacementYear <= now + 5).reduce((s,i) => s + i.totalCost, 0);
  return { annualCost: Math.round(totalFiveYear / fiscalYears), criticalItems: urgent, totalFiveYear };
}

/* FEATURE 66: Grant Application Workflow */
export interface GrantApplication { id: string; grantName: string; agency: string; dueDate: string; submittedDate: string|null; amountRequested: number; status: 'draft'|'review'|'submitted'|'awarded'|'denied'; requiredDocs: Array<{ name: string; uploaded: boolean }>; narrativeSections: Array<{ section: string; complete: boolean }>; }
export function evaluateApplicationReadiness(app: GrantApplication): { readinessPct: number; missingItems: string[]; canSubmit: boolean } {
  const docsReady = app.requiredDocs.filter(d => d.uploaded).length;
  const docsTotal = app.requiredDocs.length;
  const narrativeReady = app.narrativeSections.filter(s => s.complete).length;
  const narrativeTotal = app.narrativeSections.length;
  const missing: string[] = [];
  for (const d of app.requiredDocs) if (!d.uploaded) missing.push(`Document: ${d.name}`);
  for (const s of app.narrativeSections) if (!s.complete) missing.push(`Narrative: ${s.section}`);
  const totalItems = docsTotal + narrativeTotal;
  const readyItems = docsReady + narrativeReady;
  return { readinessPct: totalItems > 0 ? Math.round(readyItems / totalItems * 100) : 0, missingItems: missing, canSubmit: missing.length === 0 };
}

/* FEATURE 67: Quarterly Reporting */
export interface QuarterlyReport { quarter: string; year: number; grantId: string; activitiesAccomplished: string[]; performanceMetrics: Array<{ metric: string; target: number; actual: number; met: boolean }>; challenges: string[]; financialStatus: { expended: number; remaining: number; projected: number }; submitted: boolean; }
export function assessQuarterlyPerformance(report: QuarterlyReport): { performanceScore: number; metAllTargets: boolean; financialOnTrack: boolean; narrativeRequired: boolean } {
  const metTargets = report.performanceMetrics.filter(m => m.met).length;
  const score = report.performanceMetrics.length > 0 ? Math.round(metTargets / report.performanceMetrics.length * 100) : 0;
  const finOnTrack = report.financialStatus.expended <= report.financialStatus.projected * 1.1;
  return { performanceScore: score, metAllTargets: metTargets === report.performanceMetrics.length, financialOnTrack: finOnTrack, narrativeRequired: !finOnTrack || score < 75 || report.challenges.length > 0 };
}

/* FEATURE 68: Match Requirement Tracking */
export interface MatchRequirement { grantId: string; matchType: 'cash'|'in_kind'|'personnel'|'equipment'; required: number; provided: number; shortfall: number; documentation: string[]; verified: boolean; }
export function calculateMatchShortfall(requirements: MatchRequirement[]): { totalRequired: number; totalProvided: number; overallShortfall: number; byType: Record<string,{required:number;provided:number;shortfall:number}> } {
  const byType: Record<string,any> = {};
  for (const r of requirements) {
    if (!byType[r.matchType]) byType[r.matchType] = { required: 0, provided: 0, shortfall: 0 };
    byType[r.matchType].required += r.required;
    byType[r.matchType].provided += r.provided;
    byType[r.matchType].shortfall += Math.max(0, r.required - r.provided);
  }
  const totalRequired = requirements.reduce((s,r)=>s+r.required,0);
  const totalProvided = requirements.reduce((s,r)=>s+r.provided,0);
  return { totalRequired, totalProvided, overallShortfall: Math.max(0, totalRequired - totalProvided), byType };
}

/* FEATURE 69: Compliance Monitoring */
export interface ComplianceItem { id: string; requirement: string; regulation: string; dueDate: string; completedDate: string|null; responsiblePerson: string; status: 'compliant'|'pending'|'overdue'|'not_applicable'; evidence: string[]; }
export function checkComplianceStatus(items: ComplianceItem[]): { overallCompliant: boolean; compliantCount: number; overdue: ComplianceItem[]; upcoming30Days: ComplianceItem[] } {
  const now = new Date();
  const overdue = items.filter(i => i.status === 'overdue' || (i.status === 'pending' && new Date(i.dueDate) < now));
  const upcoming = items.filter(i => i.status === 'pending' && new Date(i.dueDate) > now && new Date(i.dueDate).getTime() - now.getTime() < 30*86400000);
  const compliant = items.filter(i => i.status === 'compliant' || i.status === 'not_applicable');
  return { overallCompliant: overdue.length === 0, compliantCount: compliant.length, overdue, upcoming30Days: upcoming };
}

/* FEATURE 70: Fiscal Year Planning */
export interface FiscalYearPlan { fiscalYear: number; projectedRevenue: number; projectedExpenses: number; capitalProjects: Array<{ name: string; cost: number; priority: number }>; staffingPlan: { authorized: number; funded: number; vacancies: number }; contingencyFund: number; notes: string; }
export function validateFiscalPlan(plan: FiscalYearPlan): { balanced: boolean; deficit: number; contingencyPct: number; recommendations: string[] } {
  const deficit = plan.projectedExpenses - plan.projectedRevenue;
  const contingencyPct = plan.projectedExpenses > 0 ? Math.round(plan.contingencyFund / plan.projectedExpenses * 100) : 0;
  const recs: string[] = [];
  if (deficit > 0) recs.push(`Budget deficit of $${deficit.toLocaleString()}. Reduce expenses or identify additional revenue.`);
  if (contingencyPct < 3) recs.push('Contingency fund below recommended 3% minimum.');
  if (plan.staffingPlan.vacancies > plan.staffingPlan.authorized * 0.1) recs.push('Vacancy rate exceeds 10% — address recruitment/retention.');
  return { balanced: deficit <= 0, deficit: Math.max(0, deficit), contingencyPct, recommendations: recs };
}

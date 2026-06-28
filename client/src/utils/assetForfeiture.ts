// ============================================================
// RMPG Flex — Asset Forfeiture (Spillman Flex Standard)
// 10 forfeiture features: seizure intake, valuation, case
// tracking, equitable sharing, disposal process, currency
// counting, forfeiture timeline, probable cause documentation,
// owner notification, and audit compliance.
// ============================================================

/* FEATURE 51: Seizure Intake */
export interface SeizedAsset { id: string; caseNumber: string; seizureDate: string; seizingOfficer: string; assetType: 'currency'|'vehicle'|'firearm'|'real_property'|'electronics'|'jewelry'|'financial_account'|'other'; description: string; estimatedValue: number; location: string; storageLocation: string; probableCauseStatement: string; status: 'held'|'forfeiture_filed'|'forfeited'|'returned'|'equitable_share'; }
export function validateSeizureIntake(asset: SeizedAsset): { valid: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!asset.caseNumber) missing.push('Case number required');
  if (!asset.probableCauseStatement || asset.probableCauseStatement.length < 20) missing.push('Detailed probable cause statement required');
  if (!asset.estimatedValue && asset.assetType === 'currency') missing.push('Currency must be counted and valued');
  if (!asset.storageLocation) missing.push('Storage location required');
  return { valid: missing.length === 0, missing };
}

/* FEATURE 52: Asset Valuation */
export interface AssetValuation { assetId: string; appraisalMethod: 'kbb'|'market'|'appraiser'|'deposit'|'counted'|'estimated'; appraisedValue: number; appraisalDate: string; appraiserName: string|null; comparableItems: string[]; depreciation: number; finalValue: number; }
export function calculateAssetValue(originalValue: number, ageYears: number, assetType: string): { depreciated: number; method: string } {
  const rates: Record<string,number> = { vehicle: 0.15, electronics: 0.25, jewelry: 0.05, firearm: 0.05, real_property: 0, other: 0.1 };
  const rate = rates[assetType] || 0.1;
  const depreciated = Math.round(originalValue * Math.pow(1 - rate, ageYears));
  return { depreciated, method: 'straight-line depreciation' };
}

/* FEATURE 53: Forfeiture Case Tracking */
export interface ForfeitureCase { assetId: string; filingDate: string; courtCaseNumber: string; prosecutorName: string; deadlines: Array<{ description: string; dueDate: string; completed: boolean }>; hearings: Array<{ date: string; type: string; outcome: string }>; objections: Array<{ filedBy: string; date: string; basis: string; status: string }>; finalDisposition: string|null; }
export function trackForfeitureDeadlines(case_: ForfeitureCase): { daysSinceFiling: number; upcomingDeadlines: number; overdue: string[]; pctComplete: number } {
  const daysSince = Math.floor((Date.now() - new Date(case_.filingDate).getTime()) / 86400000);
  const now = new Date(); const overdue = case_.deadlines.filter(d => !d.completed && new Date(d.dueDate) < now).map(d => d.description);
  const upcoming = case_.deadlines.filter(d => !d.completed && new Date(d.dueDate) > now && new Date(d.dueDate).getTime() - now.getTime() < 30*86400000).length;
  const pct = case_.deadlines.length > 0 ? Math.round(case_.deadlines.filter(d => d.completed).length / case_.deadlines.length * 100) : 0;
  return { daysSinceFiling: daysSince, upcomingDeadlines: upcoming, overdue, pctComplete: pct };
}

/* FEATURE 54: Equitable Sharing */
export interface EquitableShare { assetId: string; federalAgency: string; adoptionDate: string; sharingRatio: number; federalShare: number; localShare: number; receivedDate: string|null; amountReceived: number; restrictions: string[]; }
export function calculateEquitableShare(totalValue: number, localInvolvement: number): { federalPct: number; localPct: number; federalAmount: number; localAmount: number } {
  const localPct = Math.round(localInvolvement);
  const federalPct = 100 - localPct;
  return { federalPct, localPct, federalAmount: Math.round(totalValue * federalPct / 100), localAmount: Math.round(totalValue * localPct / 100) };
}

/* FEATURE 55: Disposal Process */
export interface AssetDisposal { assetId: string; disposalMethod: 'auction'|'destroyed'|'converted_to_department'|'returned_to_owner'|'donated'|'sold'; disposalDate: string; authorizedBy: string; proceeds: number; proceedsDeposited: boolean; depositReference: string|null; }
export function generateDisposalReport(disposals: AssetDisposal[]): { totalProceeds: number; byMethod: Record<string,number>; totalDisposed: number; pendingDeposit: number } {
  const totalProceeds = disposals.reduce((s,d) => s + d.proceeds, 0);
  const byMethod: Record<string,number> = {}; for (const d of disposals) byMethod[d.disposalMethod] = (byMethod[d.disposalMethod]||0) + d.proceeds;
  const pendingDeposit = disposals.filter(d => !d.proceedsDeposited && d.proceeds > 0).reduce((s,d)=>s+d.proceeds,0);
  return { totalProceeds, byMethod, totalDisposed: disposals.length, pendingDeposit };
}

/* FEATURE 56: Currency Counting */
export interface CurrencyCount { assetId: string; countedBy: string; countedAt: string; witnessedBy: string; denominations: Record<string,number>; totalAmount: number; machineCount: boolean; machineVerified: boolean; discrepancy: number; }
export function calculateCurrencyTotal(denominations: Record<string,number>): { total: number; breakdown: string } {
  const denomValues: Record<string,number> = { '100': 100, '50': 50, '20': 20, '10': 10, '5': 5, '1': 1, 'coin': 0 };
  let total = 0; const parts: string[] = [];
  for (const [denom, count] of Object.entries(denominations)) { const val = (denomValues[denom]||1) * count; total += val; if (count > 0) parts.push(`${count} x $${denom}`); }
  return { total, breakdown: parts.join(', ') };
}

/* FEATURE 57: Forfeiture Timeline */
export interface ForfeitureTimeline { assetId: string; events: Array<{ date: string; event: string; actor: string; notes: string }>; }
export function generateTimelineReport(timeline: ForfeitureTimeline): { totalDays: number; fromSeizureToResolution: number; keyEvents: string[] } {
  const sorted = [...timeline.events].sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const first = sorted[0]; const last = sorted[sorted.length-1];
  const totalDays = first && last ? Math.ceil((new Date(last.date).getTime() - new Date(first.date).getTime()) / 86400000) : 0;
  return { totalDays, fromSeizureToResolution: totalDays, keyEvents: sorted.map(e => `${e.date}: ${e.event}`) };
}

/* FEATURE 58: Probable Cause Documentation */
export interface PCStatement { assetId: string; nexusToCrime: string; supportingEvidence: string[]; informantInfo: string|null; investigationFindings: string; legalStandard: 'preponderance'|'probable_cause'|'beyond_reasonable_doubt'; reviewedBy: string|null; reviewDate: string|null; }
export function evaluatePCStatement(statement: PCStatement): { adequate: boolean; score: number; recommendations: string[] } {
  let score = 0; const recs: string[] = [];
  if (statement.nexusToCrime.length > 50) score += 30; else recs.push('Expand nexus-to-crime explanation');
  if (statement.supportingEvidence.length >= 3) score += 30; else recs.push('Include more supporting evidence');
  if (statement.investigationFindings.length > 30) score += 25; else recs.push('Expand investigation findings');
  if (statement.reviewedBy) score += 15; else recs.push('Have PC statement reviewed by supervisor or prosecutor');
  return { adequate: score >= 50, score, recommendations: recs };
}

/* FEATURE 59: Owner Notification */
export interface OwnerNotification { assetId: string; ownerName: string; ownerAddress: string; notificationSent: string|null; notificationMethod: 'certified_mail'|'personal_service'|'publication'; responseDeadline: string; ownerResponse: string|null; claimFiled: boolean; claimDate: string|null; hearingRequested: boolean; }
export function checkNotificationCompliance(notification: OwnerNotification): { compliant: boolean; deadlinePassed: boolean; actionRequired: string } {
  const now = new Date(); const deadline = new Date(notification.responseDeadline);
  const passed = deadline < now;
  if (!notification.notificationSent) return { compliant: false, deadlinePassed: passed, actionRequired: 'Send owner notification immediately' };
  if (passed && !notification.ownerResponse && !notification.claimFiled) return { compliant: true, deadlinePassed: true, actionRequired: 'Response deadline passed. Proceed with default forfeiture.' };
  if (notification.claimFiled) return { compliant: true, deadlinePassed: false, actionRequired: 'Claim filed — schedule forfeiture hearing' };
  return { compliant: true, deadlinePassed: false, actionRequired: `Awaiting response. Deadline: ${notification.responseDeadline}` };
}

/* FEATURE 60: Audit Compliance */
export interface ForfeitureAudit { auditId: string; auditDate: string; auditor: string; period: string; totalAssets: number; totalValue: number; findings: Array<{ type: 'deficiency'|'commendation'|'recommendation'; description: string }>; compliant: boolean; }
export function generateAuditSummary(audits: ForfeitureAudit[]): { overallCompliant: boolean; commonFindings: string[]; improvementRate: number } {
  const common = audits.flatMap(a => a.findings.filter(f => f.type === 'deficiency').map(f => f.description));
  const freq: Record<string,number> = {}; for (const c of common) freq[c] = (freq[c]||0) + 1;
  const topFindings = Object.entries(freq).sort((a,b) => b[1]-a[1]).slice(0,5).map(([k]) => k);
  const compliant = audits.filter(a => a.compliant).length;
  return { overallCompliant: audits.length > 0 && compliant === audits.length, commonFindings: topFindings, improvementRate: audits.length > 1 ? Math.round(compliant / audits.length * 100) : 100 };
}

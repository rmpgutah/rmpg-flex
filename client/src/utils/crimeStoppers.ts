// ============================================================
// RMPG Flex — Crime Stoppers (Spillman Flex Standard)
// 10 tip management features: anonymous tips, reward tracking,
// tip validation, case linkage, caller management, reward
// board approval, hotline metrics, successful outcomes,
// fund management, and community engagement metrics.
// ============================================================

/* FEATURE 61: Anonymous Tip Management */
export interface AnonymousTip { id:string; tipNumber:string; receivedDate:string; receivedVia:'phone'|'web'|'mobile_app'|'text'; category:string; description:string; location:string|null; suspectDescription:string|null; vehicleDescription:string|null; assignedTo:string|null; status:'new'|'assigned'|'investigating'|'validated'|'unfounded'; }
export function categorizeTips(tips:AnonymousTip[]): { total:number; byCategory:Record<string,number>; validationRate:number; unfoundedRate:number } {
  const byCat:Record<string,number> = {}; for (const t of tips) byCat[t.category]=(byCat[t.category]||0)+1;
  const validated = tips.filter(t=>t.status==='validated').length;
  const unfounded = tips.filter(t=>t.status==='unfounded').length;
  return { total:tips.length, byCategory:byCat, validationRate:tips.length>0?Math.round(validated/tips.length*100):0, unfoundedRate:tips.length>0?Math.round(unfounded/tips.length*100):0 };
}

/* FEATURE 62: Reward Tracking */
export interface TipReward { id:string; tipId:string; amount:number; approvalStatus:'pending'|'board_review'|'approved'|'denied'|'paid'; boardReviewDate:string|null; approvedBy:string|null; paidDate:string|null; paymentMethod:'cash'|'check'|'prepaid_card'; anonymousPayment:boolean; }
export function calculateRewardStats(rewards:TipReward[]): { totalAwarded:number; totalPaid:number; avgReward:number; approvalRate:number } {
  const approved = rewards.filter(r=>r.approvalStatus==='approved'||r.approvalStatus==='paid');
  const paid = approved.filter(r=>r.approvalStatus==='paid');
  const totalAwarded = approved.reduce((s,r)=>s+r.amount,0);
  const avgReward = approved.length>0?Math.round(totalAwarded/approved.length):0;
  return { totalAwarded, totalPaid:paid.reduce((s,r)=>s+r.amount,0), avgReward, approvalRate:rewards.length>0?Math.round(approved.length/rewards.length*100):0 };
}

/* FEATURE 63: Tip Validation */
export interface TipValidation { tipId:string; validatedBy:string; validationDate:string; validationMethod:'investigation'|'arrest'|'recovery'|'intelligence'|'unfounded'; validationResult:string; caseNumber:string|null; arrestMade:boolean; propertyRecovered:boolean; valueRecovered:number; }
export function trackTipOutcomes(validations:TipValidation[]): { total:number; arrestRate:number; recoveryRate:number; totalValueRecovered:number } {
  const arrests = validations.filter(v=>v.arrestMade).length;
  const recoveries = validations.filter(v=>v.propertyRecovered).length;
  return { total:validations.length, arrestRate:validations.length>0?Math.round(arrests/validations.length*100):0, recoveryRate:validations.length>0?Math.round(recoveries/validations.length*100):0, totalValueRecovered:validations.reduce((s,v)=>s+v.valueRecovered,0) };
}

/* FEATURE 64: Case Linkage */
export interface TipCaseLink { tipId:string; caseNumber:string; linkType:'lead'|'corroborating'|'identification'|'location'; linkedBy:string; linkedDate:string; outcome:string|null; }
export function analyzeTipLinkages(links:TipCaseLink[]): { totalLinks:number; casesSolved:number; byType:Record<string,number> } {
  const byType:Record<string,number> = {}; for (const l of links) byType[l.linkType]=(byType[l.linkType]||0)+1;
  return { totalLinks:links.length, casesSolved:new Set(links.map(l=>l.caseNumber)).size, byType };
}

/* FEATURE 65: Caller Management */
export interface TipCaller { tipId:string; callerCode:string; callCount:number; firstCallDate:string; lastCallDate:string; reliability:'new'|'reliable'|'unreliable'|'unknown'; preferredContactWindow:string|null; }
export function evaluateCallerReliability(callers:TipCaller[]): { totalCallers:number; reliableRate:number; avgCallsPerCaller:number } {
  const reliable = callers.filter(c=>c.reliability==='reliable').length;
  const avgCalls = callers.length>0?Math.round(callers.reduce((s,c)=>s+c.callCount,0)/callers.length):0;
  return { totalCallers:callers.length, reliableRate:callers.length>0?Math.round(reliable/callers.length*100):0, avgCallsPerCaller:avgCalls };
}

/* FEATURE 66: Reward Board */
export interface RewardBoard { id:string; meetingDate:string; members:Array<{name:string;present:boolean}>; rewardsReviewed:Array<{tipId:string;amount:number;decision:'approved'|'denied'|'tabled';notes:string}>; quorumMet:boolean; }
export function trackBoardDecisions(boards:RewardBoard[]): { totalMeetings:number; rewardsApproved:number; totalAwarded:number; avgPerMeeting:number } {
  const totalApproved = boards.reduce((s,b)=>s+b.rewardsReviewed.filter(r=>r.decision==='approved').length,0);
  const totalAwarded = boards.reduce((s,b)=>s+b.rewardsReviewed.filter(r=>r.decision==='approved').reduce((sum,r)=>sum+r.amount,0),0);
  return { totalMeetings:boards.length, rewardsApproved:totalApproved, totalAwarded, avgPerMeeting:boards.length>0?Math.round(totalApproved/boards.length):0 };
}

/* FEATURE 67: Tip Hotline Metrics */
export interface HotlineMetrics { period:string; totalCalls:number; tipsReceived:number; abandonedCalls:number; avgCallDuration:number; peakHours:number[]; languageBreakdown:Record<string,number>; }
export function calculateHotlineEfficiency(metrics:HotlineMetrics): { answerRate:number; tipRate:number; avgHandleTime:number } {
  return { answerRate:metrics.totalCalls>0?Math.round((metrics.totalCalls-metrics.abandonedCalls)/metrics.totalCalls*100):0, tipRate:metrics.totalCalls>0?Math.round(metrics.tipsReceived/metrics.totalCalls*100):0, avgHandleTime:metrics.avgCallDuration };
}

/* FEATURE 68: Successful Outcomes */
export interface TipOutcome { tipId:string; outcomeType:'arrest'|'warrant_served'|'property_recovered'|'drugs_seized'|'weapons_seized'|'fugitive_captured'|'missing_person_found'|'case_closed'; date:string; details:string; rewardPaid:boolean; rewardAmount:number; }
export function compileSuccessStories(outcomes:TipOutcome[]): { totalSuccesses:number; arrestsMade:number; rewardsPaid:number } {
  const arrests = outcomes.filter(o=>o.outcomeType==='arrest'||o.outcomeType==='fugitive_captured').length;
  const rewardsPaid = outcomes.filter(o=>o.rewardPaid).reduce((s,o)=>s+o.rewardAmount,0);
  return { totalSuccesses:outcomes.length, arrestsMade:arrests, rewardsPaid };
}

/* FEATURE 69: Fund Management */
export interface CSFund { id:string; fundSource:string; amount:number; date:string; transactionType:'donation'|'grant'|'fundraiser'|'disbursement'|'reward_payment'; balance:number; notes:string; }
export function trackCSFundBalance(transactions:CSFund[]): { totalDonations:number; totalDisbursements:number; currentBalance:number } {
  const donations = transactions.filter(t=>['donation','grant','fundraiser'].includes(t.transactionType)).reduce((s,t)=>s+t.amount,0);
  const disbursements = transactions.filter(t=>['disbursement','reward_payment'].includes(t.transactionType)).reduce((s,t)=>s+t.amount,0);
  return { totalDonations:donations, totalDisbursements:disbursements, currentBalance:donations-disbursements };
}

/* FEATURE 70: Community Engagement */
export interface CSEngagement { id:string; eventType:string; date:string; location:string; attendees:number; tipsGenerated:number; newCallers:number; cost:number; }
export function measureEngagementROI(events:CSEngagement[]): { totalEvents:number; tipsGenerated:number; costPerTip:number } {
  const totalTips = events.reduce((s,e)=>s+e.tipsGenerated,0);
  const totalCost = events.reduce((s,e)=>s+e.cost,0);
  return { totalEvents:events.length, tipsGenerated:totalTips, costPerTip:totalTips>0?Math.round(totalCost/totalTips):0 };
}

// ============================================================
// RMPG Flex — Parking Enforcement (Spillman Flex Standard)
// 10 parking features: parking citation issuance, permit
// management, boot/tow tracking, handicap enforcement,
// meter zone management, scofflaw tracking, payment
// processing, citation appeals, street sweeping enforcement,
// and parking enforcement statistics.
// ============================================================

/* FEATURE 21: Parking Citation Issuance */
export interface ParkingCitation { id:string; citationNumber:string; date:string; time:string; location:string; plate:string; vin:string|null; make:string; model:string; color:string; violationCode:string; violationDescription:string; fineAmount:number; lateFee:number; totalDue:number; officerId:string; photos:string[]; paid:boolean; paidDate:string|null; status:'issued'|'paid'|'overdue'|'appealed'|'dismissed'; }
export function calculateParkingFines(citations:ParkingCitation[]): { totalIssued:number; totalCollected:number; collectionRate:number; avgFine:number } {
  const collected = citations.filter(c=>c.paid).reduce((s,c)=>s+c.totalDue,0);
  const issued = citations.reduce((s,c)=>s+c.totalDue,0);
  return { totalIssued:issued, totalCollected:collected, collectionRate:issued>0?Math.round(collected/issued*100):0, avgFine:citations.length>0?Math.round(issued/citations.length):0 };
}

/* FEATURE 22: Permit Management */
export interface ParkingPermit { id:string; permitNumber:string; holderName:string; vehiclePlate:string; permitType:'residential'|'commercial'|'visitor'|'contractor'|'handicap'|'government'; zone:string; issuedDate:string; expirationDate:string; fee:number; paid:boolean; status:'active'|'expired'|'revoked'; }
export function validateParkingPermit(plate:string, zone:string, permits:ParkingPermit[]): { valid:boolean; permit:ParkingPermit|null; reason:string } {
  const match = permits.find(p=>p.vehiclePlate===plate&&p.zone===zone&&p.status==='active'&&new Date(p.expirationDate)>new Date());
  return { valid:!!match, permit:match||null, reason:match?'Valid permit':'No valid permit found for this zone' };
}

/* FEATURE 23: Boot/Tow Tracking */
export interface BootTowRecord { id:string; plate:string; vin:string; location:string; bootInstalledAt:string|null; bootRemovedAt:string|null; towedAt:string|null; towCompany:string; storageLot:string; releaseDate:string|null; releaseTo:string|null; totalFees:number; feesPaid:boolean; reason:string; }
export function calculateBootTowFees(record:BootTowRecord): { bootFee:number; towFee:number; storageFee:number; total:number } {
  const now = new Date(); const towDate = record.towedAt?new Date(record.towedAt):now;
  const storageDays = Math.max(0,Math.ceil((now.getTime()-towDate.getTime())/86400000));
  const bootFee = record.bootInstalledAt?75:0; const towFee = record.towedAt?150:0; const storageFee = storageDays*35;
  return { bootFee, towFee, storageFee, total:bootFee+towFee+storageFee };
}

/* FEATURE 24: Handicap Enforcement */
export interface HandicapViolation { id:string; date:string; location:string; plate:string; violationType:'no_placard'|'expired_placard'|'misuse'|'blocking_access_aisle'; placardNumber:string|null; fineAmount:number; towed:boolean; }
export function assessHandicapCompliance(violations:HandicapViolation[]): { total:number; towRate:number; avgFine:number; commonViolations:Record<string,number> } {
  const byType:Record<string,number> = {}; for (const v of violations) byType[v.violationType]=(byType[v.violationType]||0)+1;
  const towed = violations.filter(v=>v.towed).length;
  const avgFine = violations.length>0?Math.round(violations.reduce((s,v)=>s+v.fineAmount,0)/violations.length):0;
  return { total:violations.length, towRate:violations.length>0?Math.round(towed/violations.length*100):0, avgFine, commonViolations:byType };
}

/* FEATURE 25: Meter Zone Management */
export interface MeterZone { id:string; zoneName:string; ratePerHour:number; maxHours:number; operatingHours:{start:string;end:string}; operatingDays:number[]; spaces:number; meters:number; metersOperational:number; enforcementPriority:'high'|'medium'|'low'; }
export function calculateMeterRevenue(zone:MeterZone, occupancyRate:number): { dailyRevenue:number; monthlyRevenue:number; annualRevenue:number } {
  const hours = parseInt(zone.operatingHours.end)-parseInt(zone.operatingHours.start);
  const daily = zone.spaces*zone.ratePerHour*hours*occupancyRate*zone.operatingDays.length/7;
  return { dailyRevenue:Math.round(daily), monthlyRevenue:Math.round(daily*30), annualRevenue:Math.round(daily*365) };
}

/* FEATURE 26: Scofflaw Tracking */
export interface Scofflaw { id:string; plate:string; ownerName:string; outstandingCitations:number; totalDue:number; bootEligible:boolean; towEligible:boolean; lastNoticeDate:string|null; paymentPlan:boolean; }
export function identifyScofflaws(violators:Array<{plate:string;citations:number;totalDue:number}>): Scofflaw[] {
  return violators.filter(v=>v.citations>=5||v.totalDue>=500).map(v=>({ id:`scf-${v.plate}`, plate:v.plate, ownerName:'', outstandingCitations:v.citations, totalDue:v.totalDue, bootEligible:v.totalDue>=500, towEligible:v.totalDue>=1000, lastNoticeDate:null, paymentPlan:false }));
}

/* FEATURE 27: Payment Processing */
export interface ParkingPayment { id:string; citationId:string; amount:number; paymentMethod:'cash'|'credit'|'check'|'online'|'phone'; paymentDate:string; transactionId:string|null; receiptNumber:string; processed:boolean; }
export function reconcilePayments(payments:ParkingPayment[], citations:ParkingCitation[]): { totalPayments:number; reconciledCitations:number; outstanding:ParkingCitation[] } {
  const paidCitationIds = new Set(payments.filter(p=>p.processed).map(p=>p.citationId));
  const outstanding = citations.filter(c=>!paidCitationIds.has(c.id)&&c.status!=='dismissed');
  return { totalPayments:payments.reduce((s,p)=>s+p.amount,0), reconciledCitations:paidCitationIds.size, outstanding };
}

/* FEATURE 28: Citation Appeals */
export interface ParkingAppeal { id:string; citationId:string; appellantName:string; appealDate:string; appealReason:string; evidenceSubmitted:boolean; hearingDate:string|null; hearingResult:'upheld'|'dismissed'|'reduced'|'pending'; newFineAmount:number|null; decisionDate:string|null; }
export function processAppealOutcome(appeals:ParkingAppeal[]): { totalAppeals:number; dismissalRate:number; reductionRate:number; avgProcessingDays:number } {
  const decided = appeals.filter(a=>a.hearingResult!=='pending');
  const dismissed = decided.filter(a=>a.hearingResult==='dismissed').length;
  const reduced = decided.filter(a=>a.hearingResult==='reduced').length;
  const days = decided.map(a=>(new Date(a.decisionDate||a.appealDate).getTime()-new Date(a.appealDate).getTime())/86400000);
  return { totalAppeals:appeals.length, dismissalRate:decided.length>0?Math.round(dismissed/decided.length*100):0, reductionRate:decided.length>0?Math.round(reduced/decided.length*100):0, avgProcessingDays:days.length>0?Math.round(days.reduce((s,v)=>s+v,0)/days.length):0 };
}

/* FEATURE 29: Street Sweeping Enforcement */
export interface StreetSweepingRoute { id:string; routeName:string; neighborhoods:string[]; schedule:{dayOfWeek:number;weekOfMonth:number;startTime:string}; parkingRestrictions:string; enforcementHours:string; citationsIssued:number; }
export function planSweepingEnforcement(route:StreetSweepingRoute, availableOfficers:number): { officersAssigned:number; coveragePct:number; expectedCitations:number } {
  const officers = Math.min(availableOfficers,Math.ceil(route.neighborhoods.length/3));
  return { officersAssigned:officers, coveragePct:officers>0?Math.round(officers/Math.max(1,Math.ceil(route.neighborhoods.length/3))*100):0, expectedCitations:route.neighborhoods.length*5 };
}

/* FEATURE 30: Parking Enforcement Statistics */
export interface ParkingStats { period:string; citationsIssued:number; citationsPaid:number; revenueCollected:number; bootsApplied:number; vehiclesTowed:number; permitsIssued:number; appealsFiled:number; handicapViolations:number; scofflawsIdentified:number; }
export function compileParkingStats(data:{citations:ParkingCitation[];boots:BootTowRecord[];permits:ParkingPermit[];appeals:ParkingAppeal[];handicap:HandicapViolation[];scofflaws:Scofflaw[]}): ParkingStats {
  return { period:new Date().toISOString().slice(0,7), citationsIssued:data.citations.length, citationsPaid:data.citations.filter(c=>c.paid).length, revenueCollected:data.citations.filter(c=>c.paid).reduce((s,c)=>s+c.totalDue,0), bootsApplied:data.boots.filter(b=>b.bootInstalledAt).length, vehiclesTowed:data.boots.filter(b=>b.towedAt).length, permitsIssued:data.permits.length, appealsFiled:data.appeals.length, handicapViolations:data.handicap.length, scofflawsIdentified:data.scofflaws.length };
}

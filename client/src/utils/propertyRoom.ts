// ============================================================
// RMPG Flex — Property Room Management (Spillman Flex Standard)
// 10 property room features: intake processing, barcode
// tracking, storage optimization, audit inventory, chain
// of custody extensions, release authorization, auction
// management, destruction workflow, digital evidence
// management, and property room statistics.
// ============================================================

/* FEATURE 61: Intake Processing */
export interface PropertyIntake { id:string; caseNumber:string; submittingOfficer:string; submissionDate:string; items:Array<{description:string;category:string;quantity:number;condition:string;estimatedValue:number;barcode:string|null}>; totalItems:number; storageLocation:string|null; status:'pending'|'processed'|'stored'; }
export function processIntakeBatch(intake:PropertyIntake): { barcodes:string[]; storageInstructions:string[]; highValue:boolean; narcoticsPresent:boolean } {
  const barcodes = intake.items.map((_,i)=>`EVD-${intake.submissionDate.replace(/-/g,'')}-${String(i+1).padStart(4,'0')}`);
  const highValue = intake.items.some(i=>i.estimatedValue>1000);
  const narcotics = intake.items.some(i=>i.category==='narcotics'||i.category==='controlled_substance');
  return { barcodes, storageInstructions:narcotics?['Store in narcotics locker','Double-lock container','Log in controlled substance registry']:['Standard storage','Label and photograph'], highValue, narcoticsPresent:narcotics };
}

/* FEATURE 62: Barcode Tracking */
export function generatePropertyBarcode(prefix:string, year:number, sequence:number): string { return `${prefix}-${String(year).slice(-2)}-${String(sequence).padStart(6,'0')}`; }
export function parsePropertyBarcode(barcode:string): {prefix:string;year:number;sequence:number}|null {
  const match = barcode.match(/^([A-Z]+)-(\d{2})-(\d{6})$/); if (!match) return null;
  return {prefix:match[1],year:2000+parseInt(match[2]),sequence:parseInt(match[3])};
}
export function scanBarcodeLocation(barcode:string, location:string, officerId:string): {scanned:boolean;timestamp:string;location:string;officerId:string} {
  return {scanned:true,timestamp:new Date().toISOString(),location,officerId};
}

/* FEATURE 63: Storage Optimization */
export interface StorageBay { id:string; zone:string; row:string; shelf:string; bin:string; category:string; capacity:number; occupied:number; restricted:boolean; temperature:'ambient'|'refrigerated'|'frozen'; }
export function optimizeStoragePlacement(items:Array<{category:string;size:'small'|'medium'|'large';temperature:string}>, bays:StorageBay[]): Array<{item:string;assignedBay:string;reason:string}> {
  return items.map(item=>{
    const matching = bays.filter(b=>b.category===item.category&&b.occupied<b.capacity&&b.temperature===(item.temperature==='cold'?'refrigerated':'ambient'));
    const best = matching.sort((a,b)=>(a.occupied/a.capacity)-(b.occupied/b.capacity))[0];
    return {item:item.size,assignedBay:best?`${best.zone}-${best.row}-${best.shelf}-${best.bin}`:'No available bay',reason:best?'Best fit by category and capacity':'All matching bays full'};
  });
}

/* FEATURE 64: Audit Inventory */
export interface InventoryAudit { id:string; auditDate:string; auditorId:string; zone:string; itemsCounted:number; itemsExpected:number; discrepancies:Array<{barcode:string;expected:string;actual:string;notes:string}>; accuracy:number; }
export function calculateInventoryAccuracy(audits:InventoryAudit[]): { overallAccuracy:number; mostDiscrepantZones:string[]; trend:'improving'|'stable'|'declining' } {
  const totalCounted = audits.reduce((s,a)=>s+a.itemsCounted,0);
  const totalDiscrepancies = audits.reduce((s,a)=>s+a.discrepancies.length,0);
  const accuracy = totalCounted>0?Math.round((1-totalDiscrepancies/totalCounted)*100):100;
  const byZone:Record<string,{counted:number;disc:number}> = {};
  for (const a of audits) { if (!byZone[a.zone]) byZone[a.zone]={counted:0,disc:0}; byZone[a.zone].counted+=a.itemsCounted; byZone[a.zone].disc+=a.discrepancies.length; }
  const discrepant = Object.entries(byZone).filter(([,v])=>v.disc/v.counted>0.05).map(([k])=>k);
  return { overallAccuracy:accuracy, mostDiscrepantZones:discrepant, trend:'stable' };
}

/* FEATURE 65: Chain of Custody Extension */
export interface CustodyTransfer { evidenceId:string; fromPerson:string; toPerson:string; transferDate:string; reason:string; fromLocation:string; toLocation:string; signatureRef:string|null; }
export function validateCustodyChain(transfers:CustodyTransfer[]): { gaps:CustodyTransfer[]; complete:boolean; lastCustodian:string; daysSinceLastTransfer:number } {
  if (transfers.length===0) return {gaps:[],complete:false,lastCustodian:'Unknown',daysSinceLastTransfer:0};
  const sorted = [...transfers].sort((a,b)=>new Date(a.transferDate).getTime()-new Date(b.transferDate).getTime());
  const gaps:CustodyTransfer[] = [];
  for (let i=1;i<sorted.length;i++) { const gap = (new Date(sorted[i].transferDate).getTime()-new Date(sorted[i-1].transferDate).getTime())/86400000; if (gap>30) gaps.push(sorted[i]); }
  const last = sorted[sorted.length-1];
  const daysSince = Math.ceil((Date.now()-new Date(last.transferDate).getTime())/86400000);
  return { gaps, complete:gaps.length===0, lastCustodian:last.toPerson, daysSinceLastTransfer:daysSince };
}

/* FEATURE 66: Release Authorization */
export interface PropertyRelease { id:string; evidenceIds:string[]; releaseTo:string; releaseToId:string; authorizedBy:string; authorizationDate:string; releaseDate:string|null; itemsReturned:number; itemsHeld:number; reason:string; signatureObtained:boolean; }
export function authorizePropertyRelease(evidenceIds:string[], recipient:string, recipientId:string, authorizer:string): PropertyRelease {
  return { id:`rel-${Date.now()}`, evidenceIds, releaseTo:recipient, releaseToId:recipientId, authorizedBy:authorizer, authorizationDate:new Date().toISOString().slice(0,10), releaseDate:null, itemsReturned:0, itemsHeld:0, reason:'', signatureObtained:false };
}

/* FEATURE 67: Auction Management */
export interface PropertyAuction { id:string; auctionDate:string; auctionHouse:string; items:Array<{evidenceId:string;description:string;startingBid:number;soldPrice:number|null;buyer:string|null}>; totalListed:number; totalSold:number; totalProceeds:number; proceedsDeposited:boolean; }
export function calculateAuctionResults(auction:PropertyAuction): { sellThroughRate:number; avgMarkup:number; totalRevenue:number; itemsUnsold:number } {
  const sold = auction.items.filter(i=>i.soldPrice!==null);
  const unsold = auction.items.filter(i=>i.soldPrice===null);
  const markup = sold.filter(i=>i.startingBid>0).map(i=>(i.soldPrice!-i.startingBid)/i.startingBid);
  const avgMarkup = markup.length>0?Math.round(markup.reduce((s,v)=>s+v,0)/markup.length*100):0;
  return { sellThroughRate:auction.items.length>0?Math.round(sold.length/auction.items.length*100):0, avgMarkup, totalRevenue:auction.totalProceeds, itemsUnsold:unsold.length };
}

/* FEATURE 68: Destruction Workflow */
export interface DestructionOrder { id:string; evidenceIds:string[]; authorizedBy:string; authorizationDate:string; destructionDate:string|null; method:string; witnessRequired:boolean; witnesses:string[]; disposalCompany:string|null; certificateNumber:string|null; }
export function approveDestruction(evidenceIds:string[], authorizer:string, method:string, witnessRequired:boolean): DestructionOrder {
  return { id:`dest-${Date.now()}`, evidenceIds, authorizedBy:authorizer, authorizationDate:new Date().toISOString().slice(0,10), destructionDate:null, method, witnessRequired, witnesses:[], disposalCompany:null, certificateNumber:null };
}

/* FEATURE 69: Digital Evidence Management */
export interface DigitalEvidence { id:string; caseNumber:string; fileType:string; fileSize:number; hash:string; originalDevice:string; extractedBy:string; extractionDate:string; storageLocation:string; retentionPeriod:number; purgeDate:string; }
export function calculateDigitalStorageUsage(evidence:DigitalEvidence[]): { totalFiles:number; totalSize:number; byType:Record<string,{count:number;size:number}>; storageFullPct:number } {
  const byType:Record<string,{count:number;size:number}> = {};
  for (const e of evidence) { if (!byType[e.fileType]) byType[e.fileType]={count:0,size:0}; byType[e.fileType].count++; byType[e.fileType].size+=e.fileSize; }
  const totalSize = evidence.reduce((s,e)=>s+e.fileSize,0);
  return { totalFiles:evidence.length, totalSize, byType, storageFullPct:0 };
}

/* FEATURE 70: Property Room Statistics */
export interface PropertyRoomStats { period:string; totalItems:number; itemsIn:number; itemsOut:number; currentValue:number; narcoticsStored:number; firearmsStored:number; currencyStored:number; auditsCompleted:number; auditAccuracy:number; }
export function compilePropertyRoomReport(items:Array<{dateIn:string;dateOut:string|null;category:string;value:number}>): PropertyRoomStats {
  const now = new Date(); const yearStart = new Date(now.getFullYear(),0,1);
  const current = items.filter(i=>!i.dateOut); const thisYearIn = items.filter(i=>new Date(i.dateIn)>=yearStart); const thisYearOut = items.filter(i=>i.dateOut&&new Date(i.dateOut)>=yearStart);
  return { period:now.toISOString().slice(0,7), totalItems:items.length, itemsIn:thisYearIn.length, itemsOut:thisYearOut.length, currentValue:current.reduce((s,i)=>s+i.value,0), narcoticsStored:current.filter(i=>i.category==='narcotics').length, firearmsStored:current.filter(i=>i.category==='firearm').length, currencyStored:current.filter(i=>i.category==='currency').length, auditsCompleted:0, auditAccuracy:100 };
}

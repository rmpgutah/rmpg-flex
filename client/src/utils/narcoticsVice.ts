// ============================================================
// RMPG Flex — Narcotics & Vice (Spillman Flex Standard)
// 10 narcotics features: drug investigation tracking, CI
// management, confidential funds, buy/bust operations,
// controlled deliveries, prescription fraud tracking,
// overdose mapping, drug trend analysis, narcotics
// evidence handling, and task force coordination.
// ============================================================

/* FEATURE 71: Drug Investigation Tracking */
export interface DrugInvestigation { id:string; caseNumber:string; targetName:string; drugType:string; investigationStart:string; investigationEnd:string|null; techniquesUsed:string[]; seizures:Array<{drugType:string;quantity:number;unit:string;streetValue:number;date:string}>; arrests:number; status:'active'|'indictment'|'closed'|'dormant'; }
export function calculateDrugInvestigationImpact(investigation:DrugInvestigation): { totalStreetValue:number; drugsSeized:number; arrestsPerMonth:number; investigationRating:string } {
  const totalValue = investigation.seizures.reduce((s,se)=>s+se.streetValue,0);
  const startDate = new Date(investigation.investigationStart); const endDate = investigation.investigationEnd?new Date(investigation.investigationEnd):new Date();
  const months = Math.max(1,Math.ceil((endDate.getTime()-startDate.getTime())/86400000/30));
  const rating = investigation.arrests>3&&totalValue>50000?'High Impact':investigation.arrests>0?'Moderate Impact':'Active Investigation';
  return { totalStreetValue:totalValue, drugsSeized:investigation.seizures.length, arrestsPerMonth:Math.round(investigation.arrests/months*10)/10, investigationRating:rating };
}

/* FEATURE 72: Confidential Informant Management */
export interface CIProfile { id:string; codeName:string; handlerId:string; registrationDate:string; status:'active'|'suspended'|'deactivated'; reliabilityRating:1|2|3|4|5; totalDeployments:number; successfulDeployments:number; totalPaid:number; lastDeployment:string|null; restrictions:string[]; }
export function evaluateCIReliability(ci:CIProfile): { reliabilityScore:number; canDeploy:boolean; riskLevel:'low'|'medium'|'high'; recommendations:string[] } {
  const recs:string[] = []; let score = 0;
  if (ci.totalDeployments>0) { const successRate = ci.successfulDeployments/ci.totalDeployments; score+=Math.round(successRate*50); } else { score+=20; }
  score+=ci.reliabilityRating*10;
  if (ci.status==='suspended') { score-=30; recs.push('CI is currently suspended'); }
  if (ci.restrictions.length>0) { score-=ci.restrictions.length*5; recs.push(`${ci.restrictions.length} operational restrictions apply`); }
  if (ci.lastDeployment && new Date(ci.lastDeployment).getTime()<Date.now()-180*86400000) { recs.push('No recent deployments — reassess viability'); }
  const risk = score>=70?'low':score>=40?'medium':'high';
  return { reliabilityScore:Math.max(0,score), canDeploy:ci.status==='active'&&score>=40, riskLevel:risk, recommendations:recs };
}

/* FEATURE 73: Confidential Funds Management */
export interface CIFundTransaction { id:string; ciId:string; date:string; amount:number; purpose:string; authorizedBy:string; witnessId:string|null; receiptObtained:boolean; reconciled:boolean; reconciledBy:string|null; }
export function reconcileCIFunds(transactions:CIFundTransaction[]): { totalDisbursed:number; totalReconciled:number; unreconciled:CIFundTransaction[]; balance:number; auditReady:boolean } {
  const total = transactions.reduce((s,t)=>s+t.amount,0);
  const reconciled = transactions.filter(t=>t.reconciled);
  const totalRec = reconciled.reduce((s,t)=>s+t.amount,0);
  const unreconciled = transactions.filter(t=>!t.reconciled);
  return { totalDisbursed:total, totalReconciled:totalRec, unreconciled, balance:total-totalRec, auditReady:unreconciled.length===0 };
}

/* FEATURE 74: Buy/Bust Operations */
export interface BuyBustOp { id:string; date:string; location:string; undercoverOfficerId:string; targetDescription:string; evidencePurchased:Array<{drugType:string;quantity:number;price:number}>; arrests:number; backupUnits:number; surveillanceTeam:boolean; takedownSuccessful:boolean; evidenceRecovered:boolean; }
export function evaluateBuyBust(operation:BuyBustOp): { tacticalScore:number; evidentiaryScore:number; officerSafetyScore:number; overallRating:string } {
  let tactical = 0, evidentiary = 0, safety = 0;
  if (operation.takedownSuccessful) tactical+=40; if (operation.backupUnits>=3) tactical+=20; if (operation.surveillanceTeam) tactical+=20;
  if (operation.evidenceRecovered) evidentiary+=40; if (operation.evidencePurchased.length>0) evidentiary+=30;
  if (operation.arrests>0&&!operation.takedownSuccessful===false) safety+=50; else safety+=10;
  const avg = Math.round((tactical+evidentiary+safety)/3);
  return { tacticalScore:tactical, evidentiaryScore:evidentiary, officerSafetyScore:safety, overallRating:avg>=70?'Excellent':avg>=50?'Satisfactory':'Needs Improvement' };
}

/* FEATURE 75: Controlled Deliveries */
export interface ControlledDelivery { id:string; caseNumber:string; originatedFrom:string; destination:string; drugType:string; quantity:string; courierCooperation:boolean; interdictionPoint:string|null; surveillanceLog:string; arrests:number; seizures:Array<{type:string;quantity:string;value:number}>; }
export function planControlledDelivery(delivery:ControlledDelivery): { riskAssessment:string; resourceNeeds:string[]; legalRequirements:string[]; successProbability:number } {
  const risk = delivery.courierCooperation?'Low Risk — courier cooperating':'Medium Risk — courier unaware';
  const resources = ['Surveillance team','Tactical arrest team','Evidence collection team','Prosecutor coordination'];
  if (!delivery.courierCooperation) resources.push('Covert tracking device','Air support');
  const legal = ['Prosecutor approval','Chain of custody documentation','Search warrant for final destination'];
  return { riskAssessment:risk, resourceNeeds:resources, legalRequirements:legal, successProbability:delivery.courierCooperation?85:55 };
}

/* FEATURE 76: Prescription Fraud Tracking */
export interface RxFraudCase { id:string; caseNumber:string; suspectName:string; pharmacyName:string; prescriptionDrug:string; doctorName:string|null; fraudulentScripts:number; pillsObtained:number; streetValue:number; investigationStatus:string; }
export function analyzeRxFraudPatterns(cases:RxFraudCase[]): { totalCases:number; commonDrugs:Record<string,number>; commonPharmacies:Record<string,number>; avgStreetValue:number } {
  const drugs:Record<string,number> = {}; const pharmacies:Record<string,number> = {};
  for (const c of cases) { drugs[c.prescriptionDrug]=(drugs[c.prescriptionDrug]||0)+1; pharmacies[c.pharmacyName]=(pharmacies[c.pharmacyName]||0)+1; }
  const avgValue = cases.length>0?Math.round(cases.reduce((s,c)=>s+c.streetValue,0)/cases.length):0;
  return { totalCases:cases.length, commonDrugs:drugs, commonPharmacies:pharmacies, avgStreetValue:avgValue };
}

/* FEATURE 77: Overdose Mapping */
export interface OverdoseIncident { id:string; date:string; location:string; latitude:number; longitude:number; drugType:string; fatal:boolean; naloxoneAdministered:boolean; naloxoneDoses:number; transportedToHospital:boolean; };
export function mapOverdoseHotspots(incidents:OverdoseIncident[], radiusMiles:number=1): Array<{latitude:number;longitude:number;count:number;fatalCount:number;radius:number}> {
  const grid = new Map<string,OverdoseIncident[]>();
  for (const i of incidents) { const key = `${Math.round(i.latitude/radiusMiles)*radiusMiles},${Math.round(i.longitude/radiusMiles)*radiusMiles}`; if (!grid.has(key)) grid.set(key,[]); grid.get(key)!.push(i); }
  return Array.from(grid.entries()).filter(([,v])=>v.length>=2).map(([key,v])=>{const[lat,lng]=key.split(',').map(Number);return{latitude:lat,longitude:lng,count:v.length,fatalCount:v.filter(i=>i.fatal).length,radius:radiusMiles};});
}

/* FEATURE 78: Drug Trend Analysis */
export interface DrugTrend { drugType:string; period:string; incidents:number; seizuresQuantity:number; streetPrice:number; purityAvg:number; trend:'increasing'|'stable'|'decreasing'; source:string; }
export function detectDrugTrends(seizures:Array<{drugType:string;date:string;quantity:number;price:number}>): DrugTrend[] {
  const byDrug = new Map<string,typeof seizures>();
  for (const s of seizures) { if (!byDrug.has(s.drugType)) byDrug.set(s.drugType,[]); byDrug.get(s.drugType)!.push(s); }
  const trends:DrugTrend[] = [];
  for (const [drug, data] of byDrug) {
    const recent = data.filter(d=>new Date(d.date)>new Date(Date.now()-90*86400000));
    const older = data.filter(d=>new Date(d.date)<=new Date(Date.now()-90*86400000)&&new Date(d.date)>new Date(Date.now()-180*86400000));
    const trend: 'increasing'|'stable'|'decreasing' = recent.length>older.length*1.2?'increasing':recent.length<older.length*0.8?'decreasing':'stable';
    const avgPrice = data.length>0?Math.round(data.reduce((s,d)=>s+d.price,0)/data.length):0;
    trends.push({ drugType:drug, period:'Q2 2026', incidents:recent.length, seizuresQuantity:recent.reduce((s,d)=>s+d.quantity,0), streetPrice:avgPrice, purityAvg:0, trend, source:'Field seizures' });
  }
  return trends.sort((a,b)=>b.incidents-a.incidents);
}

/* FEATURE 79: Narcotics Evidence Handling */
export interface NarcoticsEvidence { id:string; caseNumber:string; drugType:string; netWeight:number; grossWeight:number; packaging:string; fieldTested:boolean; fieldTestResult:string|null; labSubmitted:boolean; labCaseNumber:string|null; labResult:string|null; destroyed:boolean; }
export function trackNarcoticsChain(narc:NarcoticsEvidence): { requiresLabTest:boolean; destructionDueDate:string|null; weightDiscrepancyTolerance:number; handlingInstructions:string[] } {
  const instructions = ['Use PPE (gloves, mask)','Double-bag and heat-seal','Weigh before and after packaging','Photograph with scale','Store in narcotics locker'];
  const requiresLab = !narc.labSubmitted||!narc.labResult;
  const destructionDate = narc.labResult&&!narc.destroyed?new Date(Date.now()+365*86400000).toISOString().slice(0,10):null;
  return { requiresLabTest:requiresLab, destructionDueDate:destructionDate, weightDiscrepancyTolerance:0.5, handlingInstructions:instructions };
}

/* FEATURE 80: Task Force Coordination */
export interface TaskForceOp { id:string; operationName:string; participatingAgencies:Array<{agency:string;officers:number;resources:string[]}>; startDate:string; endDate:string|null; targetArea:string; arrests:number; seizures:Array<{type:string;quantity:number;value:number}>; weaponsSeized:number; vehiclesSeized:number; currencySeized:number; }
export function calculateTaskForceROI(operation:TaskForceOp): { totalSeizureValue:number; arrestsPerAgency:number; costEstimate:number; roi:number; effectiveness:string } {
  const totalValue = operation.seizures.reduce((s,se)=>s+se.value,0) + operation.currencySeized + operation.vehiclesSeized*15000 + operation.weaponsSeized*500;
  const totalAgencies = operation.participatingAgencies.length;
  const costEstimate = operation.participatingAgencies.reduce((s,a)=>s+a.officers,0)*5000*totalAgencies;
  const roi = costEstimate>0?Math.round(totalValue/costEstimate*100):0;
  return { totalSeizureValue:totalValue, arrestsPerAgency:totalAgencies>0?Math.round(operation.arrests/totalAgencies):0, costEstimate, roi, effectiveness:roi>200?'Highly Effective':roi>100?'Effective':'Needs Review' };
}

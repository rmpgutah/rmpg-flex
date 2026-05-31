// ============================================================
// RMPG Flex — Traffic Crash Reporting (Spillman Flex Standard)
// 10 crash features: state crash form, vehicle information,
// occupant tracking, witness information, diagramming,
// contributing factors, commercial vehicle crashes,
// fatality protocols, hit-and-run tracking, and crash
// statistical reporting.
// ============================================================

/* FEATURE 41: State Crash Form */
export interface CrashReport { id:string; reportNumber:string; date:string; time:string; location:string; jurisdiction:string; investigatingOfficer:string; reportType:'property_damage'|'injury'|'fatality'; weather:string; roadCondition:string; lighting:string; }
export function generateCrashNumber(year:number, sequence:number): string { return `CR-${String(year).slice(-2)}-${String(sequence).padStart(6,'0')}`; }

/* FEATURE 42: Vehicle Information */
export interface CrashVehicle { reportId:string; unitNumber:1|2; plate:string; vin:string; year:number; make:string; model:string; color:string; damageArea:string; towed:boolean; towCompany:string|null; insuranceCompany:string; policyNumber:string; }
export function assessVehicleDamage(vehicles:CrashVehicle[]): { totalVehicles:number; towedVehicles:number; towRate:number } {
  const towed = vehicles.filter(v=>v.towed).length;
  return { totalVehicles:vehicles.length, towedVehicles:towed, towRate:vehicles.length>0?Math.round(towed/vehicles.length*100):0 };
}

/* FEATURE 43: Occupant Tracking */
export interface CrashOccupant { vehicleId:string; name:string; seatingPosition:string; restraintUsed:boolean; injurySeverity:'none'|'possible'|'minor'|'moderate'|'serious'|'fatal'; transportedToHospital:boolean; hospitalName:string|null; age:number; sex:string; }
export function analyzeCrashInjuries(occupants:CrashOccupant[]): { total:number; injured:number; fatalityRate:number; restraintUsageRate:number } {
  const injured = occupants.filter(o=>o.injurySeverity!=='none').length;
  const fatalities = occupants.filter(o=>o.injurySeverity==='fatal').length;
  const restraints = occupants.filter(o=>o.restraintUsed).length;
  return { total:occupants.length, injured, fatalityRate:occupants.length>0?Math.round(fatalities/occupants.length*100):0, restraintUsageRate:occupants.length>0?Math.round(restraints/occupants.length*100):0 };
}

/* FEATURE 44: Witness Information */
export interface CrashWitness { reportId:string; name:string; contactPhone:string; statement:string; independent:boolean; locationAtTime:string; }
export function evaluateWitnessCredibility(witnesses:CrashWitness[]): { total:number; independent:number; withStatements:number } {
  return { total:witnesses.length, independent:witnesses.filter(w=>w.independent).length, withStatements:witnesses.filter(w=>w.statement.length>10).length };
}

/* FEATURE 45: Diagramming */
export interface CrashDiagram { reportId:string; diagramType:'intersection'|'straight_road'|'parking_lot'|'highway'|'roundabout'; elements:Array<{type:'vehicle'|'pedestrian'|'bicycle'|'fixed_object'|'traffic_control'|'skid_mark'; x:number;y:number;rotation:number;label:string}>; measurements:Array<{from:string;to:string;distance:number;unit:string}>; }
export function validateCrashDiagram(diagram:CrashDiagram): { complete:boolean; missingElements:string[] } {
  const missing:string[] = [];
  if (!diagram.elements.some(e=>e.type==='vehicle')) missing.push('At least one vehicle required');
  if (diagram.measurements.length===0) missing.push('No measurements recorded');
  return { complete:missing.length===0, missingElements:missing };
}

/* FEATURE 46: Contributing Factors */
export interface CrashFactor { reportId:string; vehicleUnit:number; factorCode:string; factorDescription:string; category:'driver'|'vehicle'|'environmental'|'roadway'; primaryContributing:boolean; }
export function identifyPrimaryFactors(factors:CrashFactor[]): { primaryFactor:CrashFactor|null; allFactors:Record<string,number> } {
  const primary = factors.find(f=>f.primaryContributing)||factors[0]||null;
  const all:Record<string,number> = {}; for (const f of factors) all[f.factorDescription]=(all[f.factorDescription]||0)+1;
  return { primaryFactor:primary, allFactors:all };
}

/* FEATURE 47: Commercial Vehicle Crashes */
export interface CMVCrash { reportId:string; carrierName:string; dotNumber:string; vehicleConfig:string; cargoType:string; hazmatInvolved:boolean; hazmatReleased:boolean; hazmatPlacard:string|null; }
export function assessHazmatRisk(crash:CMVCrash): { riskLevel:'none'|'low'|'high'|'critical'; evacuationNeeded:boolean; notificationsRequired:string[] } {
  if (!crash.hazmatInvolved) return { riskLevel:'none', evacuationNeeded:false, notificationsRequired:[] };
  if (crash.hazmatReleased) return { riskLevel:'critical', evacuationNeeded:true, notificationsRequired:['HazMat Team','Fire Department','EPA','DOT','Local EMA'] };
  return { riskLevel:'high', evacuationNeeded:false, notificationsRequired:['HazMat Team','Fire Department'] };
}

/* FEATURE 48: Fatality Protocols */
export interface CrashFatality { reportId:string; decedentName:string; timeOfDeath:string|null; medicalExaminer:string|null; meCaseNumber:string|null; nextOfKinNotified:boolean; notificationTime:string|null; }
export function trackFatalityProtocol(fatality:CrashFatality): { protocolComplete:boolean; outstandingItems:string[] } {
  const items:string[] = [];
  if (!fatality.timeOfDeath) items.push('Time of death not recorded');
  if (!fatality.medicalExaminer) items.push('Medical examiner not assigned');
  if (!fatality.nextOfKinNotified) items.push('Next of kin not notified');
  return { protocolComplete:items.length===0, outstandingItems:items };
}

/* FEATURE 49: Hit-and-Run Tracking */
export interface HitAndRun { reportId:string; fleeingVehicleDesc:string; directionOfTravel:string; suspectDescription:string; partialPlate:string|null; videoEvidence:boolean; witnessStatements:boolean; }
export function assessHitAndRunSolvability(hitrun:HitAndRun): { solvabilityScore:number; investigationPriority:'high'|'medium'|'low' } {
  let score = 20;
  if (hitrun.partialPlate) score += 30;
  if (hitrun.videoEvidence) score += 25;
  if (hitrun.witnessStatements) score += 15;
  if (hitrun.suspectDescription.length>10) score += 10;
  return { solvabilityScore:score, investigationPriority:score>=50?'high':score>=30?'medium':'low' };
}

/* FEATURE 50: Crash Statistical Reporting */
export interface CrashStatistics { period:string; totalCrashes:number; injuryCrashes:number; fatalCrashes:number; fatalities:number; injuries:number; hitAndRuns:number; commercialVehicleCrashes:number; mostCommonFactor:string; }
export function compileCrashStats(data:{crashes:number;injuries:number;fatalities:number;hitAndRuns:number;cmv:number}): CrashStatistics {
  return { period:new Date().toISOString().slice(0,7), totalCrashes:data.crashes, injuryCrashes:data.injuries>0?data.injuries:0, fatalCrashes:data.fatalities>0?data.fatalities:0, fatalities:data.fatalities, injuries:data.injuries, hitAndRuns:data.hitAndRuns, commercialVehicleCrashes:data.cmv, mostCommonFactor:'Driver inattention' };
}

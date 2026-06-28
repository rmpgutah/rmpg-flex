// ============================================================
// RMPG Flex — Animal Control (Spillman Flex Standard)
// 10 animal features: dangerous dog registry, animal bite
// tracking, cruelty investigation, wildlife incident response,
// animal shelter coordination, rabies control, livestock
// incidents, exotic animal permits, animal-at-large tracking,
// and animal control statistics.
// ============================================================

/* FEATURE 11: Dangerous Dog Registry */
export interface DangerousDog { id:string; dogName:string; breed:string; ownerName:string; ownerAddress:string; registrationDate:string; incidentHistory:Array<{date:string;type:'bite'|'attack'|'at_large'|'menacing';severity:'minor'|'moderate'|'severe'}>; restrictions:string[]; insuranceRequired:boolean; insuranceVerified:boolean; status:'active'|'euthanized'|'relocated'|'deceased'; }
export function assessDogRisk(dog:DangerousDog): { riskLevel:'low'|'moderate'|'high'|'extreme'; publicSafetyThreat:boolean; recommendedAction:string } {
  const incidents = dog.incidentHistory.length;
  const severe = dog.incidentHistory.filter(i=>i.severity==='severe').length;
  const bites = dog.incidentHistory.filter(i=>i.type==='bite'||i.type==='attack').length;
  let level:'low'|'moderate'|'high'|'extreme' = 'low';
  if (severe>=2||bites>=3) level='extreme'; else if (severe>=1||bites>=2) level='high'; else if (incidents>=2) level='moderate';
  return { riskLevel:level, publicSafetyThreat:level!=='low', recommendedAction:level==='extreme'?'Euthanasia recommended per dangerous dog ordinance':level==='high'?'Strict confinement and muzzle required':'Standard dangerous dog registration' };
}

/* FEATURE 12: Animal Bite Tracking */
export interface AnimalBite { id:string; date:string; victimName:string; victimAge:number; animalType:string; animalBreed:string; animalOwner:string|null; biteLocation:string; severity:'minor'|'moderate'|'severe'; medicalTreatment:boolean; rabiesObservation:boolean; quarantineStart:string|null; quarantineEnd:string|null; animalVaccinated:boolean; }
export function analyzeBiteIncidents(bites:AnimalBite[]): { total:number; byAnimalType:Record<string,number>; rabiesQuarantineRate:number; vaccinationRate:number } {
  const byType:Record<string,number> = {}; for (const b of bites) byType[b.animalType]=(byType[b.animalType]||0)+1;
  const quarantined = bites.filter(b=>b.rabiesObservation).length;
  const vaccinated = bites.filter(b=>b.animalVaccinated).length;
  return { total:bites.length, byAnimalType:byType, rabiesQuarantineRate:bites.length>0?Math.round(quarantined/bites.length*100):0, vaccinationRate:bites.length>0?Math.round(vaccinated/bites.length*100):0 };
}

/* FEATURE 13: Animal Cruelty Investigation */
export interface CrueltyCase { id:string; caseNumber:string; reportDate:string; location:string; animalType:string; animalCount:number; conditions:string[]; animalsSeized:number; animalsDeceased:number; suspectIdentified:boolean; chargesFiled:boolean; caseStatus:'open'|'investigation'|'charged'|'convicted'|'dismissed'|'closed'; }
export function trackCrueltyCases(cases:CrueltyCase[]): { total:number; animalsRescued:number; prosecutionRate:number; convictionRate:number } {
  const rescued = cases.reduce((s,c)=>s+c.animalsSeized,0);
  const charged = cases.filter(c=>c.chargesFiled).length;
  const convicted = cases.filter(c=>c.caseStatus==='convicted').length;
  return { total:cases.length, animalsRescued:rescued, prosecutionRate:cases.length>0?Math.round(charged/cases.length*100):0, convictionRate:charged>0?Math.round(convicted/charged*100):0 };
}

/* FEATURE 14: Wildlife Incident Response */
export interface WildlifeIncident { id:string; date:string; location:string; species:string; incidentType:'sighting'|'aggressive'|'injured'|'trapped'|'vehicle_collision'|'in_home'; outcome:'relocated'|'euthanized'|'released'|'transferred_to_wildlife'|'no_action'; wildlifeAgencyNotified:boolean; publicSafetyRisk:'none'|'low'|'medium'|'high'; }
export function assessWildlifeRisk(incident:WildlifeIncident): { requiresOfficerResponse:boolean; recommendedAction:string } {
  const dangerous = ['bear','mountain_lion','coyote','moose','venomous_snake'];
  const requiresResponse = dangerous.some(d=>incident.species.toLowerCase().includes(d))||incident.incidentType==='aggressive'||incident.incidentType==='in_home';
  return { requiresOfficerResponse:requiresResponse, recommendedAction:requiresResponse?'Officer response required — contain scene and contact wildlife authorities':'Monitor situation — refer to wildlife agency if needed' };
}

/* FEATURE 15: Animal Shelter Coordination */
export interface ShelterIntake { id:string; animalId:string; intakeDate:string; intakeReason:'stray'|'owner_surrender'|'seized'|'cruelty'|'bite_quarantine'|'transfer'; species:string; breed:string; color:string; sex:string; approximateAge:number; healthStatus:string; outcome:'adopted'|'returned_to_owner'|'transferred'|'euthanized'|'died'|'in_shelter'; outcomeDate:string|null; }
export function calculateShelterStats(intakes:ShelterIntake[]): { liveReleaseRate:number; avgDaysInShelter:number; adoptionRate:number; euthanasiaRate:number } {
  const adopted = intakes.filter(i=>i.outcome==='adopted'||i.outcome==='returned_to_owner'||i.outcome==='transferred').length;
  const euthanized = intakes.filter(i=>i.outcome==='euthanized'||i.outcome==='died').length;
  return { liveReleaseRate:intakes.length>0?Math.round(adopted/intakes.length*100):0, avgDaysInShelter:0, adoptionRate:intakes.length>0?Math.round(intakes.filter(i=>i.outcome==='adopted').length/intakes.length*100):0, euthanasiaRate:intakes.length>0?Math.round(euthanized/intakes.length*100):0 };
}

/* FEATURE 16: Rabies Control */
export interface RabiesCase { id:string; animalType:string; location:string; reportDate:string; testResult:'positive'|'negative'|'pending'; humanExposure:boolean; exposedPersons:number; postExposureTreatment:boolean; animalQuarantined:boolean; quarantineLocation:string|null; }
export function trackRabiesExposure(cases:RabiesCase[]): { totalCases:number; positiveCases:number; humanExposures:number; personsTreated:number } {
  const positive = cases.filter(c=>c.testResult==='positive').length;
  const humanExp = cases.filter(c=>c.humanExposure);
  const treated = humanExp.filter(c=>c.postExposureTreatment).length;
  return { totalCases:cases.length, positiveCases:positive, humanExposures:humanExp.length, personsTreated:treated };
}

/* FEATURE 17: Livestock Incidents */
export interface LivestockIncident { id:string; date:string; location:string; animalType:string; animalCount:number; incidentType:'at_large'|'vehicle_collision'|'property_damage'|'injury'|'theft'|'cruelty'; ownerIdentified:boolean; ownerContacted:boolean; animalsSecured:boolean; damagesEstimate:number; }
export function respondToLivestock(incident:LivestockIncident): { urgencyLevel:string; resourcesNeeded:string[]; ownerNotificationRequired:boolean } {
  const urgency = incident.incidentType==='vehicle_collision'||incident.incidentType==='injury'?'high':'standard';
  const resources = ['Animal control vehicle','Livestock trailer','Temporary fencing','Veterinarian contact'];
  return { urgencyLevel:urgency, resourcesNeeded:resources, ownerNotificationRequired:!incident.ownerContacted };
}

/* FEATURE 18: Exotic Animal Permits */
export interface ExoticAnimalPermit { id:string; ownerName:string; address:string; animalSpecies:string; animalCount:number; permitNumber:string; issuedDate:string; expirationDate:string; inspectionDate:string|null; inspectionPassed:boolean|null; insuranceVerified:boolean; status:'active'|'expired'|'revoked'; }
export function checkPermitValidity(permits:ExoticAnimalPermit[]): { active:number; expired:number; needsInspection:number; complianceRate:number } {
  const now = new Date(); const active = permits.filter(p=>p.status==='active'&&new Date(p.expirationDate)>now);
  const expired = permits.filter(p=>new Date(p.expirationDate)<now||p.status==='expired');
  const needsInsp = active.filter(p=>!p.inspectionDate||new Date(p.inspectionDate).getTime()<now.getTime()-365*86400000);
  return { active:active.length, expired:expired.length, needsInspection:needsInsp.length, complianceRate:permits.length>0?Math.round(active.length/permits.length*100):0 };
}

/* FEATURE 19: Animal-At-Large Tracking */
export interface AnimalAtLarge { id:string; date:string; location:string; animalType:string; description:string; aggressive:boolean; captured:boolean; captureMethod:string|null; returnedToOwner:boolean; impounded:boolean; impoundLocation:string|null; citationIssued:boolean; }
export function analyzeAtLarge(incidents:AnimalAtLarge[]): { total:number; captured:number; citationRate:number; aggressiveRate:number } {
  const captured = incidents.filter(i=>i.captured).length;
  const cited = incidents.filter(i=>i.citationIssued).length;
  const aggressive = incidents.filter(i=>i.aggressive).length;
  return { total:incidents.length, captured, citationRate:incidents.length>0?Math.round(cited/incidents.length*100):0, aggressiveRate:incidents.length>0?Math.round(aggressive/incidents.length*100):0 };
}

/* FEATURE 20: Animal Control Statistics */
export interface AnimalControlStats { period:string; totalCalls:number; bitesReported:number; dangerousDogCases:number; crueltyCases:number; wildlifeCalls:number; animalsImpounded:number; animalsAdopted:number; citationsIssued:number; revenueCollected:number; }
export function compileAnimalStats(data:{calls:number;bites:number;dangerous:number;cruelty:number;wildlife:number;impounded:number;adopted:number;citations:number;revenue:number}): AnimalControlStats {
  return { period:new Date().toISOString().slice(0,7), totalCalls:data.calls, bitesReported:data.bites, dangerousDogCases:data.dangerous, crueltyCases:data.cruelty, wildlifeCalls:data.wildlife, animalsImpounded:data.impounded, animalsAdopted:data.adopted, citationsIssued:data.citations, revenueCollected:data.revenue };
}

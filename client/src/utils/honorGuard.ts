// ============================================================
// RMPG Flex — Honor Guard (Spillman Flex Standard)
// 10 honor guard features: member roster, uniform inventory,
// event scheduling, funeral protocols, ceremony planning,
// training requirements, equipment tracking, travel
// coordination, community representation, and honor guard metrics.
// ============================================================

/* FEATURE 71: Member Roster */
export interface HGMember { id:string; name:string; rank:string; position:string; joinDate:string; status:'active'|'inactive'|'alumni'; uniformSize:string; certifications:string[]; }
export function checkHGAvailability(members:HGMember[], requiredCount:number): { available:number; sufficient:boolean; shortfall:number } {
  const active = members.filter(m=>m.status==='active'); return { available:active.length, sufficient:active.length>=requiredCount, shortfall:Math.max(0,requiredCount-active.length) };
}

/* FEATURE 72: Uniform Inventory */
export interface HGUniform { id:string; type:string; size:string; assignedTo:string|null; condition:'excellent'|'good'|'fair'|'needs_replacement'; lastInspected:string; }
export function inspectUniforms(uniforms:HGUniform[]): { total:number; needsReplacement:HGUniform[]; readinessRate:number } {
  const needs = uniforms.filter(u=>u.condition==='needs_replacement'); return { total:uniforms.length, needsReplacement:needs, readinessRate:uniforms.length>0?Math.round((uniforms.length-needs.length)/uniforms.length*100):0 };
}

/* FEATURE 73: Event Scheduling */
export interface HGEvent { id:string; eventType:'funeral'|'parade'|'ceremony'|'memorial'|'dedication'|'training'|'community'; date:string; location:string; membersRequired:number; membersAssigned:number; status:'scheduled'|'confirmed'|'completed'|'cancelled'; }
export function planHGEvent(event:HGEvent): { staffingAdequate:boolean; resourceNeeds:string[] } {
  return { staffingAdequate:event.membersAssigned>=event.membersRequired, resourceNeeds:['Full dress uniform','Flags and standards','Transportation','Water/hydration','Communications'] };
}

/* FEATURE 74: Funeral Protocols */
export interface HGFuneral { id:string; decedentName:string; decedentAgency:string; funeralDate:string; location:string; ceremonyType:'full_honors'|'standard'|'graveside'; pallbearers:string[]; firingParty:boolean; bugler:boolean; flagPresentation:boolean; }
export function prepareFuneralProtocol(decedentName:string, agency:string, date:string): HGFuneral {
  return { id:`hg-funeral-${Date.now()}`, decedentName, decedentAgency:agency, funeralDate:date, location:'', ceremonyType:'full_honors', pallbearers:[], firingParty:true, bugler:true, flagPresentation:true };
}

/* FEATURE 75: Ceremony Planning */
export interface HGCeremony { id:string; ceremonyType:string; date:string; script:string[]; participants:Array<{role:string;memberId:string|null}>; rehearsalDate:string|null; flags:number; music:string[]; }
export function checklistCeremony(ceremony:HGCeremony): { ready:boolean; missingItems:string[] } {
  const missing:string[] = [];
  if (ceremony.participants.some(p=>!p.memberId)) missing.push('All roles must be filled');
  if (!ceremony.rehearsalDate) missing.push('Rehearsal must be scheduled');
  if (ceremony.script.length===0) missing.push('Ceremony script required');
  return { ready:missing.length===0, missingItems:missing };
}

/* FEATURE 76: Training Requirements */
export interface HGTraining { id:string; trainingType:string; date:string; instructor:string; attendees:number; hours:number; }
export function trackHGTraining(sessions:HGTraining[]): { totalSessions:number; totalHours:number; avgAttendance:number } {
  const totalHrs = sessions.reduce((s,t)=>s+t.hours,0);
  return { totalSessions:sessions.length, totalHours:totalHrs, avgAttendance:sessions.length>0?Math.round(sessions.reduce((s,t)=>s+t.attendees,0)/sessions.length):0 };
}

/* FEATURE 77: Equipment Tracking */
export interface HGEquipment { id:string; equipmentType:'rifle'|'flag'|'harness'|'gloves'|'belt'|'cover'|'shoes'; serialNumber:string|null; assignedTo:string|null; condition:'ready'|'maintenance'|'replace'; }
export function checkEquipmentReadiness(equipment:HGEquipment[]): { ready:number; needsMaintenance:number; readinessRate:number } {
  const ready = equipment.filter(e=>e.condition==='ready'); return { ready:ready.length, needsMaintenance:equipment.length-ready.length, readinessRate:equipment.length>0?Math.round(ready.length/equipment.length*100):0 };
}

/* FEATURE 78: Travel Coordination */
export interface HGTravel { eventId:string; departureDate:string; returnDate:string; destination:string; travelers:number; transportationMode:string; lodging:string|null; perDiem:number; estimatedCost:number; }
export function calculateTravelCost(travel:HGTravel): { perPerson:number; totalEstimate:number } {
  const lodgingCost = travel.lodging?150:0; const transportCost = travel.transportationMode==='air'?500:travel.transportationMode==='van'?200:50;
  return { perPerson:travel.travelers>0?Math.round((transportCost+lodgingCost+travel.perDiem)/travel.travelers):0, totalEstimate:travel.travelers*(transportCost+lodgingCost+travel.perDiem) };
}

/* FEATURE 79: Community Representation */
export interface HGAppearance { id:string; eventName:string; date:string; location:string; membersPresent:number; publicReception:string; photosTaken:boolean; }
export function trackPublicAppearances(appearances:HGAppearance[]): { total:number; totalMembers:number; avgPerEvent:number } {
  const totalMembers = appearances.reduce((s,a)=>s+a.membersPresent,0);
  return { total:appearances.length, totalMembers, avgPerEvent:appearances.length>0?Math.round(totalMembers/appearances.length):0 };
}

/* FEATURE 80: Honor Guard Metrics */
export interface HGMetrics { period:string; activeMembers:number; eventsCompleted:number; funeralsServed:number; ceremonies:number; trainingHours:number; equipmentReadiness:number; budgetSpent:number; }
export function compileHGMetrics(data:{members:HGMember[];events:HGEvent[];funerals:HGFuneral[];training:HGTraining[];equipment:HGEquipment[]}): HGMetrics {
  return { period:new Date().toISOString().slice(0,7), activeMembers:data.members.filter(m=>m.status==='active').length, eventsCompleted:data.events.filter(e=>e.status==='completed').length, funeralsServed:data.funerals.length, ceremonies:data.events.length, trainingHours:data.training.reduce((s,t)=>s+t.hours,0), equipmentReadiness:0, budgetSpent:0 };
}

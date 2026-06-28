// ============================================================
// RMPG Flex — Gang Intelligence (Spillman Flex Standard)
// 10 gang features: member tracking, gang database, graffiti
// documentation, field interview cards, gang injunction tracking,
// social media monitoring, gang activity mapping, rivalries,
// prevention programs, and gang statistical reporting.
// ============================================================

/* FEATURE 11: Gang Member Tracking */
export interface GangMember { id:string; name:string; moniker:string; gangId:string; gangName:string; status:'active'|'associate'|'inactive'|'incarcerated'|'deceased'; joinDate:string|null; rank:string; tattoos:string[]; knownAssociates:string[]; lastContact:string|null; officerSafetyFlags:string[]; }
export function assessMemberRisk(member:GangMember, recentActivity:number): {riskLevel:'high'|'medium'|'low'; factors:string[]} {
  const factors:string[] = [];
  if (member.status==='active') factors.push('Active gang member');
  if (member.officerSafetyFlags.length > 0) { factors.push(...member.officerSafetyFlags); }
  if (recentActivity > 3) factors.push('High recent activity');
  let level:'high'|'medium'|'low' = 'low';
  if (factors.length >= 3) level = 'high'; else if (factors.length >= 1) level = 'medium';
  return {riskLevel:level, factors};
}

/* FEATURE 12: Gang Database */
export interface Gang { id:string; name:string; setNames:string[]; colors:string[]; symbols:string[]; territory:Array<{zone:string;boundary:string}>; rivalGangs:string[]; alliedGangs:string[]; memberCount:number; threatLevel:'low'|'medium'|'high'|'critical'; originatedFrom:string; active:string; }
export function evaluateGangThreat(gang:Gang, violentIncidents:number, drugActivity:boolean, recruitmentActive:boolean): {threatIndex:number; level:string; recommendation:string} {
  let index=0; index += gang.memberCount*0.5 + violentIncidents*3 + (drugActivity?5:0) + (recruitmentActive?4:0) + gang.rivalGangs.length*2;
  const level = index>20?'critical':index>10?'high':index>5?'medium':'low';
  return { threatIndex:Math.round(index), level, recommendation:level==='critical'?'Intensive monitoring and proactive enforcement':level==='high'?'Regular intelligence updates and patrol advisories':'Standard monitoring' };
}

/* FEATURE 13: Graffiti Documentation */
export interface GraffitiRecord { id:string; date:string; location:string; gangId:string|null; gangName:string|null; tags:string[]; symbols:string[]; message:string; photographed:boolean; removed:boolean; removalDate:string|null; officerId:string; }
export function matchGraffitiToGang(record:GraffitiRecord, knownGangs:Array<{id:string;name:string;symbols:string[];tags:string[]}>): {match:Gang|null;confidence:number} {
  for (const gang of knownGangs) { const tagMatch = record.tags.filter(t => gang.tags.some(gt => gt.toLowerCase().includes(t.toLowerCase())||t.toLowerCase().includes(gt.toLowerCase()))); const symMatch = record.symbols.filter(s => gang.symbols.some(gs => gs.toLowerCase().includes(s.toLowerCase())));
    if (tagMatch.length>0||symMatch.length>0) return {match:gang as unknown as Gang,confidence:Math.min(100,(tagMatch.length+symMatch.length)*30)};
  }
  return {match:null,confidence:0};
}

/* FEATURE 14: Gang Field Interview Cards */
export interface GangFICard { id:string; date:string; officerId:string; location:string; subjectName:string; subjectMoniker:string|null; gangAffiliation:string|null; reasonForStop:string; identifiers:Array<{type:'tattoo'|'clothing'|'hand_sign'|'other';description:string}>; associatesPresent:string[]; vehicleInfo:string|null; photoTaken:boolean; }
export function analyzeFIStopPatterns(cards:GangFICard[]): {totalStops:number; byGang:Record<string,number>; byLocation:Record<string,number>; byReason:Record<string,number>; hotLocations:string[]} {
  const byGang:Record<string,number>={}; const byLocation:Record<string,number>={}; const byReason:Record<string,number>={};
  for (const c of cards) { const g = c.gangAffiliation||'Unknown'; byGang[g]=(byGang[g]||0)+1; byLocation[c.location]=(byLocation[c.location]||0)+1; byReason[c.reasonForStop]=(byReason[c.reasonForStop]||0)+1; }
  const hot = Object.entries(byLocation).filter(([,c])=>c>=3).map(([k])=>k);
  return {totalStops:cards.length,byGang,byLocation,byReason,hotLocations:hot};
}

/* FEATURE 15: Gang Injunction Tracking */
export interface GangInjunction { id:string; gangId:string; gangName:string; courtOrderNumber:string; issuedDate:string; expirationDate:string|null; restrictedZones:string[]; restrictedActivities:string[]; enjoinedMembers:string[]; violations:Array<{date:string;memberId:string;description:string;actionTaken:string}>; status:'active'|'expired'|'dissolved'; }
export function checkInjunctionCompliance(injunction:GangInjunction, memberActivities:Array<{memberId:string;date:string;location:string;activity:string}>): {violations:number; compliantMembers:number; violators:string[]} {
  const violators = new Set<string>();
  for (const act of memberActivities) { if (injunction.restrictedZones.some(z=>act.location.includes(z))||injunction.restrictedActivities.some(a=>act.activity.includes(a))) { violators.add(act.memberId); } }
  return {violations:violators.size,compliantMembers:injunction.enjoinedMembers.length-violators.size,violators:Array.from(violators)};
}

/* FEATURE 16: Social Media Monitoring */
export interface SocialMediaIntel { id:string; platform:string; profileUrl:string; subjectName:string; gangReferences:string[]; threateningContent:boolean; criminalActivityIndicated:boolean; screenshots:string[]; reviewedBy:string; reviewedAt:string; actionable:boolean; }
export function assessSocialMediaThreat(posts:SocialMediaIntel[]): {threatLevel:'none'|'low'|'medium'|'high'; requiresLEAction:boolean; keyFindings:string[]} {
  const findings:string[] = [];
  const threatCount = posts.filter(p=>p.threateningContent).length;
  const criminalCount = posts.filter(p=>p.criminalActivityIndicated).length;
  if (threatCount>0) findings.push(`${threatCount} posts contain threatening content`);
  if (criminalCount>0) findings.push(`${criminalCount} posts indicate criminal activity`);
  let level:'none'|'low'|'medium'|'high' = 'none';
  if (threatCount>=3||criminalCount>=2) level='high'; else if (threatCount>=1||criminalCount>=1) level='medium'; else if (posts.length>2) level='low';
  return {threatLevel:level,requiresLEAction:level==='high',keyFindings:findings};
}

/* FEATURE 17: Gang Activity Mapping */
export interface GangActivityMap { gangId:string; gangName:string; territory:Array<{zone:string;controlLevel:'dominant'|'contested'|'peripheral'}>; recentIncidents:Array<{type:string;latitude:number;longitude:number;date:string;rivalGangInvolved:boolean}>; hotspotRadius:number; }
export function calculateTerritoryControl(incidents:Array<{zone:string;gangRelated:boolean;rivalInvolved:boolean;date:string}>, zones:string[]): Array<{zone:string;level:string;incidents:number;threatened:boolean}> {
  return zones.map(zone=>{const zoneIncidents=incidents.filter(i=>i.zone===zone); const gang=zoneIncidents.filter(i=>i.gangRelated).length; const rival=zoneIncidents.filter(i=>i.rivalInvolved).length; let level='peripheral'; if(gang>5)level='dominant'; else if(rival>2)level='contested'; return {zone,level,incidents:zoneIncidents.length,threatened:rival>0};});
}

/* FEATURE 18: Gang Rivalry Tracking */
export interface GangConflict { id:string; gangA:string; gangB:string; conflictType:'territorial'|'retaliatory'|'drug_trade'|'personal'|'unknown'; startDate:string; lastIncident:string; incidentCount:number; severity:'verbal'|'physical'|'weapons'|'fatal'; active:boolean; mediationAttempted:boolean; }
export function assessConflictEscalation(conflict:GangConflict, recentIncidents:Array<{date:string;severity:string;weaponsInvolved:boolean;injuries:number}>): {escalating:boolean; riskOfViolence:'low'|'medium'|'high'|'critical'; interventionRecommended:boolean} {
  const recent90 = recentIncidents.filter(i=>new Date(i.date).getTime()>Date.now()-90*86400000);
  const withWeapons = recent90.filter(i=>i.weaponsInvolved).length;
  const withInjuries = recent90.filter(i=>i.injuries>0).length;
  const escalating = recent90.length >=3 && (withWeapons>0||withInjuries>0);
  let risk:'low'|'medium'|'high'|'critical' = 'low';
  if (conflict.severity==='fatal'||withInjuries>=3) risk='critical'; else if (conflict.severity==='weapons'||withWeapons>=2) risk='high'; else if (recent90.length>=2) risk='medium';
  return {escalating,riskOfViolence:risk,interventionRecommended:risk!=='low'};
}

/* FEATURE 19: Gang Prevention Programs */
export interface PreventionProgram { id:string; programName:string; targetAudience:string; participants:number; startDate:string; funding:number; partnerAgencies:string[]; outcomes:string[]; status:'active'|'completed'|'cancelled'; }
export function evaluateProgramEffectiveness(program:PreventionProgram): {costPerParticipant:number; retentionRate:number; successIndicators:number; rating:string} {
  const costPer = program.participants>0?Math.round(program.funding/program.participants):0;
  const success = program.outcomes.length;
  const rating = success>=5?'Highly Effective':success>=3?'Moderately Effective':success>=1?'Minimally Effective':'Insufficient Data';
  return {costPerParticipant:costPer,retentionRate:program.participants>0?100:0,successIndicators:success,rating};
}

/* FEATURE 20: Gang Statistical Reporting */
export interface GangStats { period:string; totalMembers:number; activeMembers:number; totalIncidents:number; violentIncidents:number; gangMotivatedHomicides:number; firearmsSeized:number; drugsSeizedValue:number; graffitiIncidents:number; gangRelatedArrests:number; }
export function compileGangStats(data:{members:Array<{status:string}>;incidents:Array<{violent:boolean;homicide:boolean;firearmsSeized:number;drugValue:number;graffiti:boolean}>;arrests:Array<{gangRelated:boolean}>}): GangStats {
  return { period:new Date().toISOString().slice(0,7), totalMembers:data.members.length, activeMembers:data.members.filter(m=>m.status==='active').length, totalIncidents:data.incidents.length, violentIncidents:data.incidents.filter(i=>i.violent).length, gangMotivatedHomicides:data.incidents.filter(i=>i.homicide).length, firearmsSeized:data.incidents.reduce((s,i)=>s+(i.firearmsSeized||0),0), drugsSeizedValue:data.incidents.reduce((s,i)=>s+(i.drugValue||0),0), graffitiIncidents:data.incidents.filter(i=>i.graffiti).length, gangRelatedArrests:data.arrests.filter(a=>a.gangRelated).length };
}

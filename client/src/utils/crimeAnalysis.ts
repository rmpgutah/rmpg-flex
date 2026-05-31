// ============================================================
// RMPG Flex — Crime Analysis & Intelligence (Spillman Flex Standard)
// 10 crime analysis features: crime pattern analysis, link
// chart data, temporal analysis, geographic profiling, suspect
// prioritization, crime series detection, intelligence bulletins,
// threat assessments, crime trends dashboard, and COMPSTAT reporting.
// ============================================================

/* FEATURE 1: Crime Pattern Analysis */
export interface CrimePattern { id: string; patternName: string; crimeType: string; dateRange: {start:string;end:string}; totalIncidents:number; zones:string[]; dayOfWeek:number[]; timeOfDay:{start:number;end:number}; suspectDescription:string|null; vehicleDescription:string|null; moDetails:string; confidence:number; status:'active'|'monitoring'|'closed'; }
export function detectCrimePatterns(incidents: Array<{crimeType:string;date:string;hour:number;dayOfWeek:number;zone:string;moDescription:string;suspectDesc:string|null;vehicleDesc:string|null}>): CrimePattern[] {
  const patterns: CrimePattern[] = []; const groups = new Map<string,typeof incidents>();
  for (const i of incidents) { const key = `${i.crimeType}::${i.dayOfWeek}::${i.hour}`; if (!groups.has(key)) groups.set(key, []); groups.get(key)!.push(i); }
  let id = 1;
  for (const [key, group] of groups) { if (group.length < 3) continue; const [crimeType, dayStr, hourStr] = key.split('::'); const zones = [...new Set(group.map(i=>i.zone))];
    patterns.push({ id: `cp-${id++}`, patternName: `${crimeType} Pattern`, crimeType, dateRange: {start:group[0].date, end:group[group.length-1].date}, totalIncidents: group.length, zones, dayOfWeek: [parseInt(dayStr)], timeOfDay: {start:Math.max(0,parseInt(hourStr)-1), end:Math.min(23,parseInt(hourStr)+1)}, suspectDescription: group.find(i=>i.suspectDesc)?.suspectDesc||null, vehicleDescription: group.find(i=>i.vehicleDesc)?.vehicleDesc||null, moDetails: group[0].moDescription, confidence: Math.min(95, 50 + group.length*10), status:'active' });
  }
  return patterns.sort((a,b)=>b.confidence-a.confidence);
}

/* FEATURE 2: Link Chart Data */
export interface LinkNode { id:string; type:'person'|'vehicle'|'location'|'phone'|'case'|'organization'; label:string; risk:'high'|'medium'|'low'; properties:Record<string,string>; }
export interface LinkEdge { source:string; target:string; type:string; weight:number; evidence:string; }
export interface LinkChart { id:string; caseNumber:string; nodes:LinkNode[]; edges:LinkEdge[]; createdAt:string; }
export function generateLinkChart(caseNumber:string, persons:Array<{id:string;name:string;phone:string;address:string}>, vehicles:Array<{id:string;plate:string;ownerId:string}>, locations:Array<{id:string;address:string}>): LinkChart {
  const nodes:LinkNode[] = []; const edges:LinkEdge[] = [];
  for (const p of persons) { nodes.push({id:p.id,type:'person',label:p.name,risk:'medium',properties:{phone:p.phone,address:p.address}}); }
  for (const v of vehicles) { nodes.push({id:v.id,type:'vehicle',label:v.plate,risk:'low',properties:{}}); if (v.ownerId) edges.push({source:v.ownerId,target:v.id,type:'OWNS',weight:10,evidence:'DMV record'}); }
  for (const l of locations) { nodes.push({id:l.id,type:'location',label:l.address,risk:'low',properties:{}}); }
  return { id:`lc-${Date.now()}`, caseNumber, nodes, edges, createdAt: new Date().toISOString() };
}

/* FEATURE 3: Temporal Analysis */
export interface TemporalAnalysis { crimeType:string; byHour:number[]; byDay:number[]; byMonth:number[]; peakHour:number; peakDay:number; peakMonth:number; seasonalTrend:string; }
export function analyzeTemporalPatterns(incidents:Array<{crimeType:string;date:string;hour:number}>): TemporalAnalysis {
  const byHour = new Array(24).fill(0); const byDay = new Array(7).fill(0); const byMonth = new Array(12).fill(0);
  for (const i of incidents) { byHour[i.hour]++; const d = new Date(i.date); byDay[d.getDay()]++; byMonth[d.getMonth()]++; }
  const peakHour = byHour.indexOf(Math.max(...byHour)); const peakDay = byDay.indexOf(Math.max(...byDay)); const peakMonth = byMonth.indexOf(Math.max(...byMonth));
  return { crimeType: incidents[0]?.crimeType||'unknown', byHour, byDay, byMonth, peakHour, peakDay, peakMonth, seasonalTrend: peakMonth >= 5 && peakMonth <= 8 ? 'summer_peak' : peakMonth >= 11 || peakMonth <= 1 ? 'winter_peak' : 'no_clear_seasonal' };
}

/* FEATURE 4: Geographic Profiling */
export interface GeoProfile { centerLat:number; centerLng:number; radiusMiles:number; incidents:number; anchorPoints:Array<{lat:number;lng:number;type:string;description:string}>; probabilitySurface:Array<{lat:number;lng:number;probability:number}>; }
export function generateGeoProfile(incidents:Array<{latitude:number;longitude:number;type:string;date:string}>): GeoProfile {
  if (incidents.length === 0) return { centerLat:0,centerLng:0,radiusMiles:0,incidents:0,anchorPoints:[],probabilitySurface:[] };
  const avgLat = incidents.reduce((s,i)=>s+i.latitude,0)/incidents.length;
  const avgLng = incidents.reduce((s,i)=>s+i.longitude,0)/incidents.length;
  const maxDist = Math.max(...incidents.map(i=>haversine(avgLat,avgLng,i.latitude,i.longitude)));
  const uniqueLocations = new Set(incidents.map(i=>`${i.latitude.toFixed(4)},${i.longitude.toFixed(4)}`));
  const anchorPoints = Array.from(uniqueLocations).slice(0,10).map(loc=>{const[p,q]=loc.split(',');return{lat:parseFloat(p),lng:parseFloat(q),type:'incident',description:''};});
  return { centerLat:avgLat,centerLng:avgLng,radiusMiles:Math.round(maxDist*100)/100,incidents:incidents.length,anchorPoints,probabilitySurface:[] };
}
function haversine(lat1:number,lng1:number,lat2:number,lng2:number):number { const R=3959;const dLat=(lat2-lat1)*Math.PI/180;const dLon=(lng2-lng1)*Math.PI/180;const a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a)); }

/* FEATURE 5: Suspect Prioritization */
export interface SuspectRanking { suspectId:string; suspectName:string; matchScore:number; factors:Array<{factor:string;weight:number}>; recommendedAction:string; riskLevel:'high'|'medium'|'low'; }
export function rankSuspects(suspects:Array<{id:string;name:string;proximityToScene:number;criminalHistory:boolean;witnessId:boolean;physicalEvidence:boolean;priorSimilarOffense:boolean;gangAffiliation:boolean}>): SuspectRanking[] {
  return suspects.map(s => {
    let score=0; const factors:Array<{factor:string;weight:number}> = [];
    if (s.proximityToScene < 0.5) { score+=30; factors.push({factor:'Proximity to scene',weight:30}); }
    if (s.witnessId) { score+=25; factors.push({factor:'Witness identification',weight:25}); }
    if (s.physicalEvidence) { score+=20; factors.push({factor:'Physical evidence',weight:20}); }
    if (s.priorSimilarOffense) { score+=15; factors.push({factor:'Prior similar offense',weight:15}); }
    if (s.criminalHistory) { score+=10; factors.push({factor:'Criminal history',weight:10}); }
    if (s.gangAffiliation) { score+=5; factors.push({factor:'Gang affiliation',weight:5}); }
    const risk = score>=50?'high':score>=25?'medium':'low';
    return { suspectId:s.id, suspectName:s.name, matchScore:score, factors, recommendedAction:risk==='high'?'Prioritize for investigation and lineup':risk==='medium'?'Follow up for interview':'Maintain in suspect pool', riskLevel:risk };
  }).sort((a,b)=>b.matchScore-a.matchScore);
}

/* FEATURE 6: Crime Series Detection */
export interface CrimeSeries { id:string; seriesName:string; linkedCases:string[]; commonMO:string; suspectProfile:string|null; geographicRange:number; startDate:string; lastIncident:string; active:boolean; confidence:number; }
export function detectCrimeSeries(cases:Array<{caseNumber:string;crimeType:string;moDescription:string;latitude:number;longitude:number;date:string}>): CrimeSeries[] {
  const series:CrimeSeries[] = []; const processed = new Set<string>();
  for (let i=0;i<cases.length;i++) { if (processed.has(cases[i].caseNumber)) continue;
    const linked:string[] = [cases[i].caseNumber]; processed.add(cases[i].caseNumber);
    for (let j=i+1;j<cases.length;j++) { if (processed.has(cases[j].caseNumber)) continue;
      if (cases[i].crimeType===cases[j].crimeType) { const dist=haversine(cases[i].latitude,cases[i].longitude,cases[j].latitude,cases[j].longitude);
        const moi=cases[i].moDescription.split(/\W+/).filter(w=>w.length>3); const moj=cases[j].moDescription.split(/\W+/).filter(w=>w.length>3);
        const overlap=moi.filter(w=>moj.includes(w));
        if (dist<5&&overlap.length>=2) { linked.push(cases[j].caseNumber); processed.add(cases[j].caseNumber); }
      }
    }
    if (linked.length>=2) { series.push({ id:`cs-${Date.now()}-${i}`, seriesName:`${cases[i].crimeType} Series`, linkedCases:linked, commonMO:cases[i].moDescription.slice(0,100), suspectProfile:null, geographicRange:linked.length>1?haversine(cases[i].latitude,cases[i].longitude, cases[linked.length-1]?cases[linked.length-1].latitude:cases[i].latitude,cases[linked.length-1]?cases[linked.length-1].longitude:cases[i].longitude):0, startDate:cases[i].date, lastIncident:cases[linked.length-1]?.date||cases[i].date, active:true, confidence:Math.min(90,40+linked.length*15) }); }
  }
  return series.sort((a,b)=>b.confidence-a.confidence);
}

/* FEATURE 7: Intelligence Bulletins */
export interface IntelBulletin { id:string; title:string; classification:'unclassified'|'law_enforcement_sensitive'|'confidential'; date:string; summary:string; threatLevel:'low'|'moderate'|'elevated'|'high'|'critical'; affectedAreas:string[]; suspectInfo:string; vehicleInfo:string; modusOperandi:string; officerSafetyInfo:string; distribution:string[]; }
export function generateIntelBulletin(pattern:CrimePattern, classification:'unclassified'|'law_enforcement_sensitive'|'confidential'): IntelBulletin {
  return { id:`ib-${Date.now()}`, title:`INTELLIGENCE BULLETIN: ${pattern.crimeType}`, classification, date:new Date().toISOString().slice(0,10), summary:`${pattern.totalIncidents} incidents of ${pattern.crimeType} detected in the following areas: ${pattern.zones.join(', ')}.`, threatLevel:pattern.confidence>70?'elevated':'moderate', affectedAreas:pattern.zones, suspectInfo:pattern.suspectDescription||'Unknown', vehicleInfo:pattern.vehicleDescription||'Unknown', modusOperandi:pattern.moDetails, officerSafetyInfo:'Exercise standard precautions. Review pattern details before patrol.', distribution:[] };
}

/* FEATURE 8: Threat Assessment */
export interface ThreatAssessment { id:string; subjectName:string; assessmentDate:string; threatType:string; riskFactors:Array<{factor:string;severity:'low'|'medium'|'high'}>; overallRisk:'low'|'moderate'|'high'|'critical'; recommendedActions:string[]; assessedBy:string; reviewDate:string; }
export function calculateThreatLevel(factors:Array<{severity:'low'|'medium'|'high'}>): { score:number; level:string; requiresAction:boolean } {
  const weights = {low:1,medium:3,high:7}; const score = factors.reduce((s,f)=>s+weights[f.severity],0);
  const level = score>=15?'critical':score>=8?'high':score>=4?'moderate':'low';
  return {score,level,requiresAction:score>=4};
}

/* FEATURE 9: Crime Trends Dashboard */
export interface CrimeTrendData { period:string; totalIncidents:number; changeFromPrior:string; byType:Array<{type:string;count:number;change:number}>; byZone:Array<{zone:string;count:number;change:number}>; clearanceRate:number; responseTime:number; }
export function calculateTrendChange(current:number,previous:number): {value:number;pct:number;direction:'up'|'down'|'flat'} {
  if (previous===0) return {value:current,pct:100,direction:'up'};
  const change = current-previous; const pct = Math.round(change/previous*100);
  return {value:change,pct,direction:change>0?'up':change<0?'down':'flat'};
}

/* FEATURE 10: COMPSTAT Reporting */
export interface COMPSTATReport { date:string; period:string; commander:string; totalCalls:number; totalIncidents:number; violentCrime:number; propertyCrime:number; arrests:number; clearanceRate:number; responseTimeP1:number; overtimeHours:number; topIssues:string[]; actionPlan:string[]; }
export function generateCOMPSTATSummary(data:{calls:number;incidents:number;violent:number;property:number;arrests:number;clearance:number;responseP1:number;overtime:number}): COMPSTATReport {
  return { date:new Date().toISOString().slice(0,10), period:'Weekly', commander:'', totalCalls:data.calls, totalIncidents:data.incidents, violentCrime:data.violent, propertyCrime:data.property, arrests:data.arrests, clearanceRate:data.clearance, responseTimeP1:data.responseP1, overtimeHours:data.overtime, topIssues:[], actionPlan:[] };
}

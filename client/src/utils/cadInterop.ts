// ============================================================
// RMPG Flex — CAD-to-CAD Interoperability (Spillman Flex Standard)
// 10 interop features: agency discovery, mutual aid requests,
// shared call events, cross-jurisdictional unit tracking,
// regional dispatch coordination, data exchange formats,
// interop security, failover management, shared geography,
// and interoperability metrics.
// ============================================================

/* FEATURE 1: Agency Discovery */
export interface PartnerAgency { id:string; agencyName:string; jurisdiction:string; cadSystem:string; interopEndpoint:string; status:'online'|'offline'|'maintenance'; sharingLevel:'full'|'calls_only'|'units_only'|'none'; lastHeartbeat:string; }
export function discoverAgencies(agencies:PartnerAgency[]): { online:number; sharableAgencies:number; bySystem:Record<string,number> } {
  const online = agencies.filter(a=>a.status==='online');
  const sharing = online.filter(a=>a.sharingLevel!=='none');
  const bySystem:Record<string,number> = {}; for (const a of agencies) bySystem[a.cadSystem]=(bySystem[a.cadSystem]||0)+1;
  return { online:online.length, sharableAgencies:sharing.length, bySystem };
}

/* FEATURE 2: Mutual Aid Requests */
export interface MutualAidRequest { id:string; requestingAgency:string; resourceType:string; quantity:number; priority:'immediate'|'planned'; requestTime:string; responseTime:string|null; providingAgency:string|null; status:'pending'|'accepted'|'declined'|'fulfilled'|'cancelled'; }
export function trackMutualAid(requests:MutualAidRequest[]): { total:number; fulfillmentRate:number; avgResponseSeconds:number; pendingWithHighPriority:number } {
  const fulfilled = requests.filter(r=>r.status==='fulfilled');
  const pending = requests.filter(r=>r.status==='pending'&&r.priority==='immediate');
  const responses = fulfilled.filter(r=>r.responseTime).map(r=>(new Date(r.responseTime!).getTime()-new Date(r.requestTime).getTime())/1000);
  return { total:requests.length, fulfillmentRate:requests.length>0?Math.round(fulfilled.length/requests.length*100):0, avgResponseSeconds:responses.length>0?Math.round(responses.reduce((s,v)=>s+v,0)/responses.length):0, pendingWithHighPriority:pending.length };
}

/* FEATURE 3: Shared Call Events */
export interface SharedCall { id:string; localCallNumber:string; remoteCallNumber:string; sharedWithAgency:string; sharedAt:string; acknowledgedAt:string|null; disposition:string|null; status:'shared'|'acknowledged'|'responding'|'closed'; }
export function trackSharedCalls(calls:SharedCall[]): { total:number; acknowledged:number; responded:number; crossAgencyClosureRate:number } {
  return { total:calls.length, acknowledged:calls.filter(c=>c.acknowledgedAt).length, responded:calls.filter(c=>c.status==='responding'||c.status==='closed').length, crossAgencyClosureRate:calls.length>0?Math.round(calls.filter(c=>c.status==='closed').length/calls.length*100):0 };
}

/* FEATURE 4: Cross-Jurisdictional Unit Tracking */
export interface SharedUnit { id:string; unitCallSign:string; homeAgency:string; currentStatus:string; location:{lat:number;lng:number}|null; lastUpdate:string; }
export function monitorSharedUnits(units:SharedUnit[]): { total:number; available:number; byAgency:Record<string,number> } {
  const available = units.filter(u=>u.currentStatus==='available');
  const byAgency:Record<string,number> = {}; for (const u of units) byAgency[u.homeAgency]=(byAgency[u.homeAgency]||0)+1;
  return { total:units.length, available:available.length, byAgency };
}

/* FEATURE 5: Regional Dispatch Coordination */
export interface RegionalEvent { id:string; eventType:string; participatingAgencies:string[]; commandAgency:string; communicationsPlan:string; sharedTacticalChannel:string; status:'planned'|'active'|'concluded'; }
export function coordinateRegionalResponse(event:RegionalEvent, availableAgencies:string[]): { coverageAdequate:boolean; gapAgencies:string[] } {
  const missing = availableAgencies.filter(a=>!event.participatingAgencies.includes(a));
  return { coverageAdequate:missing.length===0, gapAgencies:missing };
}

/* FEATURE 6: Data Exchange Formats */
export interface DataExchange { exchangeType:'NIEM'|'CAP'|'EDXL'|'HAVE'|'CJIS'; dataCategory:string; schemaVersion:string; validated:boolean; lastTested:string; }
export function validateExchange(exchange:DataExchange): { valid:boolean; errors:string[] } {
  const errors:string[] = [];
  if (!exchange.schemaVersion) errors.push('Schema version required');
  if (!exchange.validated) errors.push('Exchange not validated — test before production');
  return { valid:errors.length===0, errors };
}

/* FEATURE 7: Interop Security */
export interface InteropCredentials { agencyId:string; apiKey:string; issuedAt:string; expiresAt:string; rotationDue:boolean; lastRotated:string; permissions:string[]; }
export function checkCredentialHealth(creds:InteropCredentials[]): { total:number; expiring:number; needsRotation:number } {
  const now = new Date(); const thirtyDays = new Date(now.getTime()+30*86400000);
  return { total:creds.length, expiring:creds.filter(c=>new Date(c.expiresAt)<=thirtyDays).length, needsRotation:creds.filter(c=>c.rotationDue||new Date(c.lastRotated).getTime()<now.getTime()-90*86400000).length };
}

/* FEATURE 8: Failover Management */
export interface FailoverConfig { primaryCad:string; backupCad:string|null; autoFailover:boolean; failoverTimeout:number; lastTested:string|null; testedBy:string|null; manualFailoverProcedure:string; }
export function testFailover(config:FailoverConfig): { ready:boolean; issues:string[] } {
  const issues:string[] = [];
  if (!config.backupCad) issues.push('No backup CAD system configured');
  if (!config.lastTested||new Date(config.lastTested).getTime()<Date.now()-90*86400000) issues.push('Failover test overdue (>90 days)');
  if (!config.manualFailoverProcedure) issues.push('No manual failover procedure documented');
  return { ready:issues.length===0, issues };
}

/* FEATURE 9: Shared Geography */
export interface SharedGeography { zone:string; owningAgency:string; sharingAgencies:string[]; sharedSince:string; responseAgreement:string; }
export function manageSharedZones(zones:SharedGeography[]): { total:number; multiAgencyZones:number; uncoveredZones:string[] } {
  const multi = zones.filter(z=>z.sharingAgencies.length>1);
  return { total:zones.length, multiAgencyZones:multi.length, uncoveredZones:zones.filter(z=>z.sharingAgencies.length===0).map(z=>z.zone) };
}

/* FEATURE 10: Interoperability Metrics */
export interface InteropMetrics { period:string; mutualAidRequests:number; fulfilledRequests:number; sharedCalls:number; crossJurisdictionalArrests:number; dataExchanges:number; uptimePct:number; }
export function compileInteropMetrics(data:{requests:number;fulfilled:number;calls:number;arrests:number;exchanges:number}): InteropMetrics {
  return { period:new Date().toISOString().slice(0,7), mutualAidRequests:data.requests, fulfilledRequests:data.fulfilled, sharedCalls:data.calls, crossJurisdictionalArrests:data.arrests, dataExchanges:data.exchanges, uptimePct:99.9 };
}

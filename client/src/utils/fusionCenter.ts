// ============================================================
// RMPG Flex — Intelligence Fusion Center (Spillman Flex Standard)
// 10 fusion features: intelligence products, SAR reporting,
// threat integration, analytic tradecraft, privacy/civil
// liberties, secure information sharing, liaison coordination,
// intelligence cycle management, collection management,
// and fusion center metrics.
// ============================================================

/* FEATURE 91: Intelligence Products */
export interface IntelProduct { id:string; title:string; productType:'IIR'|'IIM'|'BOLO'|'BULLETIN'|'ASSESSMENT'|'BRIEFING'|'REPORT'; classification:'UNCLASSIFIED'|'FOUO'|'LES'|'SECRET'; date:string; author:string; summary:string; distribution:string[]; }
export function classifyIntelProduct(sources:string[]): { classification:string; rationale:string } { const hasProtectedSources=sources.some(s=>s.includes('CHS')||s.includes('UC')); return { classification:hasProtectedSources?'SECRET':'FOUO', rationale:hasProtectedSources?'Contains protected source information':'Law enforcement sensitive' }; }

/* FEATURE 92: SAR Reporting */
export interface SAR { id:string; reportingAgency:string; date:string; activityType:string; location:string; subjectDescription:string; vehicleDescription:string; narrative:string; ISEShared:boolean; fusionCenterReviewed:boolean; threatAssessment:string|null; }
export function evaluateSAR(sar:SAR): { threatLevel:'low'|'moderate'|'high'|'critical'; requiresISE:boolean } { const patterns=['surveillance','testing_security','breach_attempt','acquisition_of_materials','weapons_purchasing']; const matches=patterns.filter(p=>sar.activityType.toLowerCase().includes(p)||sar.narrative.toLowerCase().includes(p)); const level=matches.length>=2?'critical':matches.length>=1?'high':sar.narrative.length>100?'moderate':'low'; return { threatLevel:level, requiresISE:level!=='low' }; }

/* FEATURE 93: Threat Integration */
export interface ThreatStream { id:string; source:string; threatType:string; indicators:string[]; confidence:'low'|'medium'|'high'; lastUpdated:string; status:'active'|'monitoring'|'closed'; }
export function integrateThreatStreams(streams:ThreatStream[]): { totalActive:number; byType:Record<string,number>; highConfidenceCount:number } { const active=streams.filter(s=>s.status==='active'); const byType:Record<string,number>={}; for(const s of active) byType[s.threatType]=(byType[s.threatType]||0)+1; return { totalActive:active.length, byType, highConfidenceCount:active.filter(s=>s.confidence==='high').length }; }

/* FEATURE 94: Analytic Tradecraft */
export interface AnalyticProduct { id:string; title:string; analyticMethod:string; sources:Array<{source:string;reliability:string}>; assumptions:string[]; confidenceAssessment:string; alternativeHypotheses:string[]; peerReviewed:boolean; }
export function applyACH(hypotheses:Array<{hypothesis:string;evidence:Array<{consistent:boolean;weight:number}>}>): Array<{hypothesis:string;score:number;rank:number}> { return hypotheses.map(h=>({hypothesis:h.hypothesis,score:h.evidence.filter(e=>e.consistent).reduce((s,e)=>s+e.weight,0),rank:0})).sort((a,b)=>b.score-a.score).map((h,i)=>({...h,rank:i+1})); }

/* FEATURE 95: Privacy/Civil Liberties */
export interface PrivacyReview { intelProductId:string; reviewer:string; reviewDate:string; privacyImpact:'none'|'minimal'|'moderate'|'significant'; civilLibertiesConcerns:string[]; approved:boolean; conditions:string[]; }
export function conductPrivacyReview(): PrivacyReview { return { intelProductId:'', reviewer:'Privacy Officer', reviewDate:new Date().toISOString().slice(0,10), privacyImpact:'none', civilLibertiesConcerns:[], approved:true, conditions:[] }; }

/* FEATURE 96: Secure Information Sharing */
export interface ISETransaction { id:string; productId:string; sharedWith:string; sharingMechanism:'ISE'|'HSIN'|'N-DEx'|'LInX'|'RISSNET'|'eGuardian'; sharedAt:string; acknowledgedAt:string|null; }
export function trackISESharing(transactions:ISETransaction[]): { totalShared:number; acknowledged:number } { return { totalShared:transactions.length, acknowledged:transactions.filter(t=>t.acknowledgedAt).length }; }

/* FEATURE 97: Liaison Coordination */
export interface FusionLiaison { id:string; agency:string; liaisonName:string; contactInfo:string; assignedDesk:string; clearances:string[]; lastContact:string; nextContact:string; }
export function manageLiaisonSchedule(liaisons:FusionLiaison[]): { total:number; overdue:number } { const now=new Date(); return { total:liaisons.length, overdue:liaisons.filter(l=>new Date(l.lastContact).getTime()<now.getTime()-90*86400000).length }; }

/* FEATURE 98: Intelligence Cycle Management */
export interface IntelCycle { id:string; cycleName:string; phase:'planning'|'collection'|'processing'|'analysis'|'dissemination'|'evaluation'; startDate:string; endDate:string|null; objectives:string[]; products:number; status:'active'|'completed'; }
export function trackIntelCycle(cycles:IntelCycle[]): { active:number; completed:number; productsPerCycle:number } { const totalProducts=cycles.reduce((s,c)=>s+c.products,0); return { active:cycles.filter(c=>c.status==='active').length, completed:cycles.filter(c=>c.status==='completed').length, productsPerCycle:cycles.length>0?Math.round(totalProducts/cycles.length):0 }; }

/* FEATURE 99: Collection Management */
export interface CollectionRequirement { id:string; requirement:string; priority:1|2|3; collectionMethod:string; assignedCollector:string; startDate:string; endDate:string|null; collected:boolean; }
export function prioritizeCollection(requirements:CollectionRequirement[]): CollectionRequirement[] { return [...requirements].sort((a,b)=>((4-a.priority)*10+(a.collected?0:5))-((4-b.priority)*10+(b.collected?0:5))); }

/* FEATURE 100: Fusion Center Metrics */
export interface FusionCenterMetrics { period:string; intelProductsPublished:number; SARsReviewed:number; threatsIdentified:number; ISEShares:number; liaisonMeetings:number; analyticProducts:number; }
export function compileFusionMetrics(data:{products:number;sars:number;threats:number;shares:number;meetings:number;analytics:number}): FusionCenterMetrics { return { period:new Date().toISOString().slice(0,7), intelProductsPublished:data.products, SARsReviewed:data.sars, threatsIdentified:data.threats, ISEShares:data.shares, liaisonMeetings:data.meetings, analyticProducts:data.analytics }; }

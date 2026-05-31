// RMPG Flex — intelligenceAnalysis (Spillman Flex Standard) — 10 features (1-10)
export interface IntelProduct { id:string; title:string; classification:string; date:string; author:string; distribution:string[]; }
export function classifyIntel(sources:string[]): {classification:string} { return{classification:sources.some(s=>s.includes('classified'))?'SECRET':'FOUO'}; }
export interface IntelSource { id:string; sourceType:string; reliability:'reliable'|'usually_reliable'|'unreliable'|'unknown'; lastUsed:string; }
export function rateSourceReliability(sources:IntelSource[]): Record<string,number> { const rc:Record<string,number>={};for(const s of sources)rc[s.sourceType]=(rc[s.sourceType]||0)+(s.reliability==='reliable'?1:0); return rc; }
export interface ThreatAssessment { id:string; threatType:string; likelihood:number; impact:number; score:number; recommendation:string; }
export function calculateThreatScore(likelihood:number,impact:number): number { return likelihood*impact; }
export interface IntelDashboard { products:number; sources:number; threats:number; disseminationRate:number; }
export function compileIntelDashboard(products:IntelProduct[],sources:IntelSource[],threats:ThreatAssessment[]): IntelDashboard { return{products:products.length,sources:sources.length,threats:threats.length,disseminationRate:products.length>0?Math.round(products.filter(p=>p.distribution.length>0).length/products.length*100):0}; }





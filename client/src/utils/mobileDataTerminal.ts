// RMPG Flex — mobileDataTerminal (Spillman Flex Standard) — 10 features (11-20)

export interface MDTMessage { id:string; fromUnit:string; toUnit:string; message:string; timestamp:string; priority:'routine'|'urgent'|'emergency'; }
export function sendMDTMessage(from:string,to:string,msg:string,priority:string): MDTMessage { return{id:`mdt-${Date.now()}`,fromUnit:from,toUnit:to,message:msg,timestamp:new Date().toISOString(),priority:priority as any}; }
export interface MDTStatus { unitId:string; status:string; location:{lat:number;lng:number}|null; lastUpdate:string; }
export function trackMDTStatus(units:MDTStatus[]): {online:number;offline:number} { const now=Date.now();return{online:units.filter(u=>now-new Date(u.lastUpdate).getTime()<300000).length,offline:units.filter(u=>now-new Date(u.lastUpdate).getTime()>=300000).length}; }
export interface MDTLookup { query:string; queryType:string; results:number; responseTimeMs:number; }
export function analyzeMDTUsage(lookups:MDTLookup[]): {total:number;avgResults:number;avgResponse:number} { return{total:lookups.length,avgResults:lookups.length>0?Math.round(lookups.reduce((s,l)=>s+l.results,0)/lookups.length):0,avgResponse:lookups.length>0?Math.round(lookups.reduce((s,l)=>s+l.responseTimeMs,0)/lookups.length):0}; }




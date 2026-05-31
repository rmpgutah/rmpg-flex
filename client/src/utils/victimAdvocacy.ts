// RMPG Flex — victimAdvocacy (Spillman Flex Standard) — 10 features (21-30)


export interface VictimCase { id:string; caseNumber:string; victimName:string; advocateId:string; servicesNeeded:string[]; servicesProvided:string[]; lastContact:string; nextContact:string; status:'active'|'closed'; }
export function trackAdvocateCaseload(cases:VictimCase[]): {total:number;active:number;avgServicesNeeded:number} { const active=cases.filter(c=>c.status==='active'); return{total:cases.length,active:active.length,avgServicesNeeded:active.length>0?Math.round(active.reduce((s,c)=>s+c.servicesNeeded.length,0)/active.length):0}; }
export interface VictimReferral { victimId:string; serviceType:string; providerName:string; referralDate:string; accepted:boolean; outcome:string|null; }
export function trackReferralOutcomes(referrals:VictimReferral[]): {total:number;accepted:number;acceptanceRate:number} { const accepted=referrals.filter(r=>r.accepted); return{total:referrals.length,accepted:accepted.length,acceptanceRate:referrals.length>0?Math.round(accepted.length/referrals.length*100):0}; }
export interface VictimDashboard { activeCases:number; referralsMade:number; servicesProvided:number; followUpsDue:number; }
export function compileVictimDashboard(cases:VictimCase[],referrals:VictimReferral[]): VictimDashboard { const now=new Date(); return{activeCases:cases.filter(c=>c.status==='active').length,referralsMade:referrals.length,servicesProvided:cases.reduce((s,c)=>s+c.servicesProvided.length,0),followUpsDue:cases.filter(c=>c.status==='active'&&new Date(c.nextContact)<=now).length}; }



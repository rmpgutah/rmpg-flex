// RMPG Flex — mutualAid (Spillman Flex Standard) — 10 features (41-50)




export interface MutualAidAgreement { id:string; partnerAgency:string; agreementType:string; effectiveDate:string; expirationDate:string; resourcesAvailable:string[]; activationCriteria:string[]; }
export function checkAgreementStatus(agreements:MutualAidAgreement[]): {active:number;expired:number;availableResources:Record<string,number>} { const now=new Date();const active=agreements.filter(a=>new Date(a.expirationDate)>now); const ar:Record<string,number>={};for(const a of active)for(const r of a.resourcesAvailable)ar[r]=(ar[r]||0)+1; return{active:active.length,expired:agreements.length-active.length,availableResources:ar}; }
export interface AidRequest { id:string; requestingAgency:string; resourceType:string; quantity:number; priority:'immediate'|'planned'; requestTime:string; status:'pending'|'accepted'|'fulfilled'|'declined'; }
export function processAidRequest(request:AidRequest,accept:boolean): AidRequest { return{...request,status:accept?'accepted':'declined'}; }
export interface AidDeployment { requestId:string; deployingAgency:string; resources:string[]; personnel:number; deployedAt:string; returnedAt:string|null; cost:number; }
export function calculateAidCost(deployment:AidDeployment,hours:number,hourlyRate:number=75): {totalCost:number;costBreakdown:string} { const cost=deployment.personnel*hours*hourlyRate+deployment.resources.length*500; return{totalCost:Math.round(cost),costBreakdown:`${deployment.personnel} personnel x ${hours}h x $${hourlyRate}/hr + ${deployment.resources.length} resources`}; }
export interface MutualAidDashboard { activeAgreements:number; pendingRequests:number; deploymentsActive:number; totalCostsYTD:number; }
export function compileAidDashboard(agreements:MutualAidAgreement[],requests:AidRequest[],deployments:AidDeployment[]): MutualAidDashboard { return{activeAgreements:agreements.filter(a=>new Date(a.expirationDate)>new Date()).length,pendingRequests:requests.filter(r=>r.status==='pending').length,deploymentsActive:deployments.filter(d=>!d.returnedAt).length,totalCostsYTD:deployments.reduce((s,d)=>s+d.cost,0)}; }

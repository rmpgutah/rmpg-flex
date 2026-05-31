// RMPG Flex — policyManagement (Spillman Flex Standard) — 10 features (31-40)



export interface DepartmentPolicy { id:string; title:string; policyNumber:string; version:number; effectiveDate:string; reviewDate:string; status:'active'|'under_review'|'superseded'|'archived'; }
export function trackPolicyReviews(policies:DepartmentPolicy[]): {total:number;overdue:number;upcoming30Days:number} { const now=new Date();const thirty=new Date(now.getTime()+30*86400000); return{total:policies.length,overdue:policies.filter(p=>new Date(p.reviewDate)<now).length,upcoming30Days:policies.filter(p=>new Date(p.reviewDate)>=now&&new Date(p.reviewDate)<=thirty).length}; }
export interface PolicyAcknowledgment { policyId:string; officerId:string; acknowledgedAt:string|null; dueDate:string; status:'acknowledged'|'pending'|'overdue'; }
export function checkAcknowledgmentCompliance(acks:PolicyAcknowledgment[]): {total:number;acknowledged:number;overdue:number;complianceRate:number} { const now=new Date();const ack=acks.filter(a=>a.status==='acknowledged'); return{total:acks.length,acknowledged:ack.length,overdue:acks.filter(a=>a.status==='overdue'||(a.status==='pending'&&new Date(a.dueDate)<now)).length,complianceRate:acks.length>0?Math.round(ack.length/acks.length*100):0}; }
export interface PolicyChange { policyId:string; changeType:string; description:string; effectiveDate:string; approvedBy:string; }
export function logPolicyChange(policyId:string,type:string,desc:string,approver:string): PolicyChange { return{policyId,changeType:type,description:desc,effectiveDate:new Date().toISOString().slice(0,10),approvedBy:approver}; }


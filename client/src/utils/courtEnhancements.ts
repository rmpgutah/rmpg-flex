// 50 court enhancements
export interface CourtDocket { caseNumber:string; courtDate:string; courtroom:string; judge:string; prosecutor:string; defenseAttorney:string; hearingType:string; outcome:string|null; }
export function scheduleCourtDate(caseNumber:string,date:string,courtroom:string,judge:string,type:string): CourtDocket { return{caseNumber,courtDate:date,courtroom,judge,prosecutor:'',defenseAttorney:'',hearingType:type,outcome:null}; }
export interface CourtCalendar { date:string; cases:Array<{caseNumber:string;time:string;courtroom:string;officersRequired:string[]}>; }
export function checkOfficerConflicts(date:string,officerId:string,calendar:CourtCalendar[]): {hasConflict:boolean;conflictingCase:string|null} { const day=calendar.find(c=>c.date===date); if(!day)return{hasConflict:false,conflictingCase:null}; const conflict=day.cases.find(c=>c.officersRequired.includes(officerId)); return{hasConflict:!!conflict,conflictingCase:conflict?.caseNumber||null}; }
export interface SubpoenaService { subpoenaId:string; serviceMethod:string; serviceDate:string; servedBy:string; proofOfService:boolean; }
export function logSubpoenaService(subpoenaId:string,method:string,server:string): SubpoenaService { return{subpoenaId,serviceMethod:method,serviceDate:new Date().toISOString().slice(0,10),servedBy:server,proofOfService:true}; }
export interface WitnessCoordination { caseNumber:string; witnessName:string; contactInfo:string; subpoenaed:boolean; confirmed:boolean; onCall:boolean; }
export function coordinateWitness(caseNumber:string,name:string,contact:string): WitnessCoordination { return{caseNumber,witnessName:name,contactInfo:contact,subpoenaed:false,confirmed:false,onCall:false}; }
export interface CourtExhibit { caseNumber:string; exhibitNumber:string; description:string; admitted:boolean; admissionDate:string|null; }
export function prepareCourtExhibit(caseNumber:string,desc:string): CourtExhibit { return{caseNumber,exhibitNumber:`EX-${Date.now()}`,description:desc,admitted:false,admissionDate:null}; }
export interface CourtContinuance { caseNumber:string; originalDate:string; newDate:string; reason:string; requestedBy:string; granted:boolean; }
export function requestContinuance(caseNumber:string,newDate:string,reason:string,requestor:string): CourtContinuance { return{caseNumber,originalDate:'',newDate,reason,requestedBy:requestor,granted:false}; }
export interface CourtCost { caseNumber:string; costType:string; amount:number; assessedDate:string; paidDate:string|null; }
export function assessCourtCosts(caseNumber:string,costs:Array<{type:string;amount:number}>): {totalCost:number;items:number} { return{totalCost:costs.reduce((s,c)=>s+c.amount,0),items:costs.length}; }
export interface CourtAppeal { caseNumber:string; appealDate:string; appellant:string; grounds:string; court:string; status:string; }
export function fileAppeal(caseNumber:string,grounds:string,appellant:string): CourtAppeal { return{caseNumber,appealDate:new Date().toISOString().slice(0,10),appellant,grounds,court:'',status:'filed'}; }
export interface CourtBond { caseNumber:string; defendantName:string; bondAmount:number; bondType:string; postedBy:string; postedDate:string; status:'active'|'forfeited'|'exonerated'; }
export function postBond(caseNumber:string,defendant:string,amount:number,type:string): CourtBond { return{caseNumber,defendantName:defendant,bondAmount:amount,bondType:type,postedBy:'',postedDate:new Date().toISOString().slice(0,10),status:'active'}; }
export interface CourtPlea { caseNumber:string; pleaDate:string; pleaType:'guilty'|'not_guilty'|'nolo_contendere'|'alford'; toCharge:string; accepted:boolean; }
export function enterPlea(caseNumber:string,pleaType:string,charge:string): CourtPlea { return{caseNumber,pleaDate:new Date().toISOString().slice(0,10),pleaType:pleaType as any,toCharge:charge,accepted:false}; }
export interface CourtSentencing { caseNumber:string; sentencingDate:string; sentence:string; incarcerationDays:number; probationMonths:number; fine:number; restitution:number; }
export function recordSentence(caseNumber:string,sentence:string,incarceration:number,probation:number,fine:number): CourtSentencing { return{caseNumber,sentencingDate:new Date().toISOString().slice(0,10),sentence,incarcerationDays:incarceration,probationMonths:probation,fine,restitution:0}; }
export interface CourtNotification { caseNumber:string; notificationType:string; sentTo:string; sentDate:string; acknowledged:boolean; }
export function sendCourtNotification(caseNumber:string,type:string,recipient:string): CourtNotification { return{caseNumber,notificationType:type,sentTo:recipient,sentDate:new Date().toISOString(),acknowledged:false}; }
export function calculateTimeToTrial(arrestDate:string,trialDate:string|null): {days:number;speedyTrialLimit:number;atRisk:boolean} { const days=trialDate?Math.ceil((new Date(trialDate).getTime()-new Date(arrestDate).getTime())/86400000):0; const limit=180; return{days, speedyTrialLimit:limit, atRisk:days>limit*0.85}; }
export interface CourtDashboard { casesOnDocket:number; subpoenasOutstanding:number; officersDueInCourt:number; casesAwaitingTrial:number; bondsActive:number; }
export function compileCourtDashboard(docket:number,subpoenas:number,officers:number,awaitingTrial:number,bonds:number): CourtDashboard { return{casesOnDocket:docket,subpoenasOutstanding:subpoenas,officersDueInCourt:officers,casesAwaitingTrial:awaitingTrial,bondsActive:bonds}; }

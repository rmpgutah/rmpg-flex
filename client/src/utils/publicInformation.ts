// ============================================================
// RMPG Flex — Public Information (Spillman Flex Standard)
// 10 PIO features: media contact management, press release
// workflow, public records requests, social media publishing,
// crisis communications, community notification system,
// media briefing management, FOIA/GRAMA tracking, public
// information dashboard, and transparency reporting.
// ============================================================

/* FEATURE 31: Media Contact Management */
export interface MediaContact { id:string; outletName:string; contactName:string; contactType:'reporter'|'editor'|'producer'|'photographer'; email:string; phone:string; beat:string[]; lastContact:string|null; notes:string; }
export function findMediaContacts(topic:string, contacts:MediaContact[]): MediaContact[] {
  return contacts.filter(c=>c.beat.some(b=>b.toLowerCase().includes(topic.toLowerCase()))).sort((a,b)=>(a.lastContact?new Date(a.lastContact).getTime():0)-(b.lastContact?new Date(b.lastContact).getTime():0));
}

/* FEATURE 32: Press Release Workflow */
export interface PressRelease { id:string; title:string; releaseDate:string; author:string; content:string; classification:'immediate_release'|'embargoed'|'internal_only'; embargoDate:string|null; approvedBy:string|null; approvedAt:string|null; distributed:boolean; distributionChannels:string[]; mediaOutlets:string[]; }
export function approvePressRelease(release:PressRelease, approverId:string): PressRelease {
  return { ...release, approvedBy:approverId, approvedAt:new Date().toISOString() };
}

/* FEATURE 33: Public Records Requests */
export interface RecordsRequest { id:string; requesterName:string; requesterContact:string; requestDate:string; description:string; recordsType:string; statutoryDeadline:string; responseDate:string|null; responseType:'fulfilled'|'partial'|'denied'|'pending'; denialReason:string|null; fees:number; feesPaid:boolean; estimatedHours:number; }
export function trackRecordsRequests(requests:RecordsRequest[]): { total:number; pending:number; overdue:number; avgResponseDays:number; fulfillmentRate:number } {
  const now = new Date(); const pending = requests.filter(r=>!r.responseDate);
  const overdue = pending.filter(r=>new Date(r.statutoryDeadline)<now);
  const fulfilled = requests.filter(r=>r.responseType==='fulfilled'||r.responseType==='partial');
  const days = fulfilled.map(r=>(new Date(r.responseDate!).getTime()-new Date(r.requestDate).getTime())/86400000);
  return { total:requests.length, pending:pending.length, overdue:overdue.length, avgResponseDays:days.length>0?Math.round(days.reduce((s,v)=>s+v,0)/days.length):0, fulfillmentRate:requests.length>0?Math.round(fulfilled.length/requests.length*100):0 };
}

/* FEATURE 34: Social Media Publishing */
export interface SocialMediaPost { id:string; platform:'twitter'|'facebook'|'instagram'|'nextdoor'|'youtube'|'linkedin'; content:string; scheduledAt:string|null; publishedAt:string|null; engagement:{likes:number;shares:number;comments:number;reach:number}; status:'draft'|'scheduled'|'published'|'failed'; }
export function calculateSocialReach(posts:SocialMediaPost[]): { totalPosts:number; totalReach:number; avgEngagement:number; bestPlatform:string } {
  const totalReach = posts.reduce((s,p)=>s+p.engagement.reach,0);
  const totalEng = posts.reduce((s,p)=>s+p.engagement.likes+p.engagement.shares+p.engagement.comments,0);
  const byPlatform:Record<string,{reach:number;count:number}> = {};
  for (const p of posts) { if (!byPlatform[p.platform]) byPlatform[p.platform]={reach:0,count:0}; byPlatform[p.platform].reach+=p.engagement.reach; byPlatform[p.platform].count++; }
  const best = Object.entries(byPlatform).sort((a,b)=>(a[1].reach/a[1].count)-(b[1].reach/b[1].count)).pop();
  return { totalPosts:posts.length, totalReach, avgEngagement:posts.length>0?Math.round(totalEng/posts.length):0, bestPlatform:best?best[0]:'N/A' };
}

/* FEATURE 35: Crisis Communications */
export interface CrisisCommunication { id:string; incidentId:string; incidentName:string; activatedAt:string; deactivatedAt:string|null; spokesperson:string; holdingStatement:string; keyMessages:string[]; pressConferences:Array<{date:string;location:string;attendees:number}>; rumorControl:string[]; }
export function generateHoldingStatement(incidentType:string, location:string, time:string): string {
  return `The Rocky Mountain Protective Group is aware of a ${incidentType} incident in the area of ${location} reported at approximately ${time}. Officers are on scene and an investigation is underway. Additional information will be provided as it becomes available. There is no immediate threat to public safety.`;
}

/* FEATURE 36: Community Notification */
export interface CommunityAlert { id:string; alertType:'missing_person'|'road_closure'|'weather_emergency'|'public_safety'|'event_notice'; title:string; message:string; affectedArea:string; sentAt:string; channels:string[]; recipients:number; acknowledged:number; }
export function assessAlertEffectiveness(alerts:CommunityAlert[]): { totalSent:number; avgRecipients:number; acknowledgmentRate:number } {
  const totalRecipients = alerts.reduce((s,a)=>s+a.recipients,0);
  const totalAcknowledged = alerts.reduce((s,a)=>s+a.acknowledged,0);
  return { totalSent:alerts.length, avgRecipients:alerts.length>0?Math.round(totalRecipients/alerts.length):0, acknowledgmentRate:totalRecipients>0?Math.round(totalAcknowledged/totalRecipients*100):0 };
}

/* FEATURE 37: Media Briefing Management */
export interface MediaBriefing { id:string; topic:string; date:string; time:string; location:string; briefers:string[]; mediaExpected:number; mediaAttended:number; recordingUrl:string|null; transcriptUrl:string|null; keyQuestions:string[]; }
export function prepareMediaBriefing(topic:string, date:string, location:string, spokesperson:string): MediaBriefing {
  return { id:`briefing-${Date.now()}`, topic, date, time:'10:00', location, briefers:[spokesperson], mediaExpected:0, mediaAttended:0, recordingUrl:null, transcriptUrl:null, keyQuestions:[] };
}

/* FEATURE 38: FOIA/GRAMA Tracking */
export interface FOIARequest { id:string; trackingNumber:string; requesterName:string; receivedDate:string; description:string; exemptionClaims:string[]; estimatedCost:number; costCollected:boolean; responseDate:string|null; documentsReleased:number; documentsWithheld:number; appealFiled:boolean; }
export function calculateFOIAStats(requests:FOIARequest[]): { totalRequests:number; avgResponseDays:number; withholdingRate:number; appealRate:number } {
  const completed = requests.filter(r=>r.responseDate);
  const days = completed.map(r=>(new Date(r.responseDate!).getTime()-new Date(r.receivedDate).getTime())/86400000);
  const totalDocs = requests.reduce((s,r)=>s+r.documentsReleased+r.documentsWithheld,0);
  const withheld = requests.reduce((s,r)=>s+r.documentsWithheld,0);
  const appeals = requests.filter(r=>r.appealFiled).length;
  return { totalRequests:requests.length, avgResponseDays:days.length>0?Math.round(days.reduce((s,v)=>s+v,0)/days.length):0, withholdingRate:totalDocs>0?Math.round(withheld/totalDocs*100):0, appealRate:requests.length>0?Math.round(appeals/requests.length*100):0 };
}

/* FEATURE 39: Public Information Dashboard */
export interface PIODashboard { activePressReleases:number; pendingRecordsRequests:number; upcomingBriefings:number; socialMediaFollowers:number; communityAlertsActive:number; mediaInquiriesThisWeek:number; }
export function calculatePIOEffectiveness(data:{pressReleases:PressRelease[];recordsRequests:RecordsRequest[];socialPosts:SocialMediaPost[];alerts:CommunityAlert[]}): { contentOutput:number; responseTimeliness:number; communityEngagement:number } {
  return { contentOutput:data.pressReleases.length, responseTimeliness:data.recordsRequests.filter(r=>r.responseDate&&new Date(r.responseDate)<=new Date(r.statutoryDeadline)).length, communityEngagement:data.socialPosts.reduce((s,p)=>s+p.engagement.reach,0) };
}

/* FEATURE 40: Transparency Reporting */
export interface TransparencyReport { period:string; useOfForceIncidents:number; citizenComplaints:number; complaintsSustained:number; officerInvolvedShootings:number; trafficStops:number; arrests:number; demographicBreakdown:Record<string,{stops:number;arrests:number;searches:number}>; }
export function generateTransparencyReport(data:{useOfForce:number;complaints:number;sustained:number;shootings:number;stops:number;arrests:number}): TransparencyReport {
  return { period:new Date().toISOString().slice(0,7), useOfForceIncidents:data.useOfForce, citizenComplaints:data.complaints, complaintsSustained:data.sustained, officerInvolvedShootings:data.shootings, trafficStops:data.stops, arrests:data.arrests, demographicBreakdown:{} };
}

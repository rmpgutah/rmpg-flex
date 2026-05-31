// ============================================================
// RMPG Flex — Mass Notification System (Spillman Flex Standard)
// 10 notification features: template management, recipient
// groups, delivery tracking, geo-targeted alerts, multi-channel
// delivery, opt-in/opt-out, scheduled notifications, emergency
// alert system integration, language support, and notification
// analytics.
// ============================================================

/* FEATURE 31: Template Management */
export interface NotificationTemplate { id:string; name:string; category:string; subjectTemplate:string; bodyTemplate:string; variables:string[]; lastUsed:string|null; }
export function fillTemplate(template:NotificationTemplate, values:Record<string,string>): { subject:string; body:string } {
  let subject = template.subjectTemplate; let body = template.bodyTemplate;
  for (const [k,v] of Object.entries(values)) { subject=subject.replace(`{${k}}`,v); body=body.replace(`{${k}}`,v); }
  return { subject, body };
}

/* FEATURE 32: Recipient Groups */
export interface RecipientGroup { id:string; name:string; memberCount:number; criteria:Record<string,string>; lastUpdated:string; }
export function estimateReach(groups:RecipientGroup[]): { totalReach:number; byGroup:Record<string,number> } {
  const byGroup:Record<string,number> = {}; for (const g of groups) byGroup[g.name]=g.memberCount;
  return { totalReach:groups.reduce((s,g)=>s+g.memberCount,0), byGroup };
}

/* FEATURE 33: Delivery Tracking */
export interface NotificationDelivery { notificationId:string; channel:'sms'|'email'|'voice'|'app_push'|'social'; sentAt:string; recipientCount:number; deliveredCount:number; failedCount:number; openedCount:number; }
export function trackDeliveryPerformance(deliveries:NotificationDelivery[]): { totalSent:number; deliveryRate:number; openRate:number; bestChannel:string } {
  const totalSent = deliveries.reduce((s,d)=>s+d.recipientCount,0);
  const totalDelivered = deliveries.reduce((s,d)=>s+d.deliveredCount,0);
  const totalOpened = deliveries.reduce((s,d)=>s+d.openedCount,0);
  const byChannel:Record<string,{delivered:number;sent:number}> = {};
  for (const d of deliveries) { if (!byChannel[d.channel]) byChannel[d.channel]={delivered:0,sent:0}; byChannel[d.channel].delivered+=d.deliveredCount; byChannel[d.channel].sent+=d.recipientCount; }
  const best = Object.entries(byChannel).sort((a,b)=>(a[1].delivered/a[1].sent)-(b[1].delivered/b[1].sent)).pop();
  return { totalSent, deliveryRate:totalSent>0?Math.round(totalDelivered/totalSent*100):0, openRate:totalDelivered>0?Math.round(totalOpened/totalDelivered*100):0, bestChannel:best?best[0]:'N/A' };
}

/* FEATURE 34: Geo-Targeted Alerts */
export interface GeoAlert { id:string; alertType:string; polygon:Array<{lat:number;lng:number}>; message:string; sentAt:string; recipientsInZone:number; }
export function calculateZoneCoverage(alert:GeoAlert, population:number): { coveragePct:number; missedHouseholds:number } {
  const coverage = population>0?Math.round(alert.recipientsInZone/population*100):0;
  return { coveragePct:Math.min(100,coverage), missedHouseholds:Math.max(0,population-alert.recipientsInZone) };
}

/* FEATURE 35: Multi-Channel Delivery */
export interface DeliveryChannel { channel:string; costPerRecipient:number; avgDeliveryTimeSeconds:number; reliability:number; capacityPerMinute:number; }
export function selectOptimalChannel(message:string, urgency:string, channels:DeliveryChannel[]): DeliveryChannel|null {
  const sorted = [...channels].sort((a,b)=>b.reliability-a.reliability);
  if (urgency==='emergency') return sorted.find(c=>c.avgDeliveryTimeSeconds<30)||sorted[0];
  return sorted[0];
}

/* FEATURE 36: Opt-In/Opt-Out */
export interface SubscriberPreference { subscriberId:string; contactInfo:string; channels:{sms:boolean;email:boolean;voice:boolean;push:boolean}; categories:string[]; optedIn:boolean; optedInDate:string; }
export function manageSubscriptions(subscribers:SubscriberPreference[]): { total:number; optedIn:number; byChannel:Record<string,number> } {
  const optedIn = subscribers.filter(s=>s.optedIn);
  const byChannel:Record<string,number> = {sms:subscribers.filter(s=>s.channels.sms).length,email:subscribers.filter(s=>s.channels.email).length,voice:subscribers.filter(s=>s.channels.voice).length,push:subscribers.filter(s=>s.channels.push).length};
  return { total:subscribers.length, optedIn:optedIn.length, byChannel };
}

/* FEATURE 37: Scheduled Notifications */
export interface ScheduledNotification { id:string; templateId:string; scheduledAt:string; sentAt:string|null; recurring:'none'|'daily'|'weekly'|'monthly'; recurrenceRule:string|null; status:'scheduled'|'sent'|'cancelled'; }
export function manageSchedule(notifications:ScheduledNotification[]): { scheduled:number; sent:number; upcoming:ScheduledNotification[] } {
  const now = new Date(); const upcoming = notifications.filter(n=>n.status==='scheduled'&&new Date(n.scheduledAt)>now);
  return { scheduled:notifications.filter(n=>n.status==='scheduled').length, sent:notifications.filter(n=>n.status==='sent').length, upcoming };
}

/* FEATURE 38: Emergency Alert System */
export interface EASAlert { id:string; alertType:'amber'|'silver'|'blue'|'weather'|'civil'; issuedAt:string; expiresAt:string; affectedCounties:string[]; message:string; fipsCodes:string[]; }
export function validateEASFormat(alert:EASAlert): { valid:boolean; issues:string[] } {
  const issues:string[] = [];
  if (alert.message.length>90) issues.push('EAS message exceeds 90 character limit');
  if (alert.fipsCodes.length===0) issues.push('FIPS codes required for EAS distribution');
  if (alert.expiresAt&&new Date(alert.expiresAt)<new Date()) issues.push('Alert has expired');
  return { valid:issues.length===0, issues };
}

/* FEATURE 39: Language Support */
export interface LanguageVariant { templateId:string; language:string; subject:string; body:string; translatedBy:string|null; machineTranslated:boolean; verified:boolean; }
export function checkTranslationCoverage(variants:LanguageVariant[], requiredLanguages:string[]): { covered:string[]; missing:string[] } {
  const covered = variants.map(v=>v.language);
  const missing = requiredLanguages.filter(l=>!covered.includes(l));
  return { covered, missing };
}

/* FEATURE 40: Notification Analytics */
export interface NotificationAnalytics { period:string; notificationsSent:number; recipientsReached:number; deliveryRate:number; openRate:number; optOutRate:number; costPerRecipient:number; }
export function compileNotificationAnalytics(deliveries:NotificationDelivery[], cost:number): NotificationAnalytics {
  const totalSent = deliveries.reduce((s,d)=>s+d.recipientCount,0);
  const totalDelivered = deliveries.reduce((s,d)=>s+d.deliveredCount,0);
  return { period:new Date().toISOString().slice(0,7), notificationsSent:deliveries.length, recipientsReached:totalDelivered, deliveryRate:totalSent>0?Math.round(totalDelivered/totalSent*100):0, openRate:totalDelivered>0?Math.round(deliveries.reduce((s,d)=>s+d.openedCount,0)/totalDelivered*100):0, optOutRate:0, costPerRecipient:totalSent>0?Math.round(cost/totalSent*100)/100:0 };
}

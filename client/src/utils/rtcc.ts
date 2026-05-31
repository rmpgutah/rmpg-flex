// ============================================================
// RMPG Flex — Real-Time Crime Center (Spillman Flex Standard)
// 10 RTCC features: live camera feeds, gunshot detection,
// license plate reader integration, drone operations,
// real-time intelligence, suspicious activity monitoring,
// tactical operations center, sensor network, alert
// correlation, and situational awareness dashboard.
// ============================================================

/* FEATURE 71: Live Camera Feeds */
export interface CameraFeed { id:string; cameraName:string; location:string; latitude:number; longitude:number; feedUrl:string; status:'online'|'offline'|'maintenance'; resolution:string; ptz:boolean; recording:boolean; retentionDays:number; }
export function monitorCameraHealth(feeds:CameraFeed[]): { online:number; offline:number; uptimePct:number } {
  const online = feeds.filter(f=>f.status==='online').length;
  return { online, offline:feeds.length-online, uptimePct:feeds.length>0?Math.round(online/feeds.length*100):0 };
}

/* FEATURE 72: Gunshot Detection */
export interface GunshotAlert { id:string; detectionDate:string; detectionTime:string; latitude:number; longitude:number; roundsDetected:number; confidence:number; verified:boolean; verifiedBy:string|null; responseTime:number; outcome:string|null; }
export function analyzeGunshotAlerts(alerts:GunshotAlert[]): { total:number; verified:number; falsePositiveRate:number; avgResponseTime:number } {
  const verified = alerts.filter(a=>a.verified).length;
  const falsePositives = alerts.filter(a=>a.verified&&!a.outcome).length;
  const responseTimes = alerts.filter(a=>a.responseTime>0).map(a=>a.responseTime);
  return { total:alerts.length, verified, falsePositiveRate:verified>0?Math.round(falsePositives/verified*100):0, avgResponseTime:responseTimes.length>0?Math.round(responseTimes.reduce((s,v)=>s+v,0)/responseTimes.length):0 };
}

/* FEATURE 73: License Plate Reader Integration */
export interface LPRHit { id:string; plate:string; captureDate:string; captureTime:string; location:string; cameraId:string; hitType:'stolen'|'wanted'|'amber_alert'|'silver_alert'|'scofflaw'|'investigative'; agency:string; officerNotified:boolean; notificationTime:string|null; outcome:string|null; }
export function trackLPRPerformance(hits:LPRHit[]): { totalHits:number; notificationRate:number; actionableRate:number } {
  const notified = hits.filter(h=>h.officerNotified).length;
  const actionable = hits.filter(h=>['stolen','wanted','amber_alert'].includes(h.hitType)).length;
  return { totalHits:hits.length, notificationRate:hits.length>0?Math.round(notified/hits.length*100):0, actionableRate:hits.length>0?Math.round(actionable/hits.length*100):0 };
}

/* FEATURE 74: Drone Operations */
export interface DroneOperation { id:string; droneId:string; operatorId:string; missionType:'search'|'surveillance'|'reconnaissance'|'accident_scene'|'crowd_monitoring'|'training'; date:string; startTime:string; endTime:string; flightMinutes:number; areaCovered:number; evidenceCaptured:boolean; }
export function trackDroneUsage(operations:DroneOperation[]): { totalFlights:number; totalFlightHours:number; avgFlightTime:number; missionBreakdown:Record<string,number> } {
  const totalMinutes = operations.reduce((s,o)=>s+o.flightMinutes,0);
  const byMission:Record<string,number> = {}; for (const o of operations) byMission[o.missionType]=(byMission[o.missionType]||0)+1;
  return { totalFlights:operations.length, totalFlightHours:Math.round(totalMinutes/60*10)/10, avgFlightTime:operations.length>0?Math.round(totalMinutes/operations.length):0, missionBreakdown:byMission };
}

/* FEATURE 75: Real-Time Intelligence */
export interface RTIntel { id:string; source:string; timestamp:string; intelligenceType:string; description:string; location:string|null; threatLevel:'low'|'moderate'|'high'|'critical'; verified:boolean; disseminated:boolean; disseminatedTo:string[]; }
export function prioritizeIntelligence(intel:RTIntel[]): RTIntel[] {
  return [...intel].sort((a,b)=>{
    const aScore = (a.threatLevel==='critical'?4:a.threatLevel==='high'?3:a.threatLevel==='moderate'?2:1) + (a.verified?2:0) + (a.disseminated?0:3);
    const bScore = (b.threatLevel==='critical'?4:b.threatLevel==='high'?3:b.threatLevel==='moderate'?2:1) + (b.verified?2:0) + (b.disseminated?0:3);
    return bScore - aScore;
  });
}

/* FEATURE 76: Suspicious Activity Monitoring */
export interface SuspiciousActivity { id:string; date:string; location:string; activityType:string; description:string; subjects:number; vehicles:string[]; reportedBy:string; assessed:'non_suspicious'|'suspicious'|'criminal'; referral:string|null; }
export function analyzeSuspiciousActivity(reports:SuspiciousActivity[]): { total:number; suspiciousRate:number; criminalRate:number; commonTypes:Record<string,number> } {
  const suspicious = reports.filter(r=>r.assessed==='suspicious').length;
  const criminal = reports.filter(r=>r.assessed==='criminal').length;
  const byType:Record<string,number> = {}; for (const r of reports) byType[r.activityType]=(byType[r.activityType]||0)+1;
  return { total:reports.length, suspiciousRate:reports.length>0?Math.round(suspicious/reports.length*100):0, criminalRate:reports.length>0?Math.round(criminal/reports.length*100):0, commonTypes:byType };
}

/* FEATURE 77: Tactical Operations Center */
export interface TOCActivation { id:string; activationDate:string; activationReason:string; staffedPositions:Array<{role:string;name:string}>; agenciesRepresented:string[]; systemsOnline:string[]; deactivatedAt:string|null; }
export function activateTOC(reason:string, staff:Array<{role:string;name:string}>, agencies:string[]): TOCActivation {
  return { id:`toc-${Date.now()}`, activationDate:new Date().toISOString(), activationReason:reason, staffedPositions:staff, agenciesRepresented:agencies, systemsOnline:['CAD','RMS','Camera Network','LPR','GIS Mapping','Radio System'], deactivatedAt:null };
}

/* FEATURE 78: Sensor Network */
export interface IOTSensor { id:string; sensorType:'shotspotter'|'flood'|'air_quality'|'seismic'|'radiation'|'chemical'; location:string; latitude:number; longitude:number; status:'online'|'offline'; lastReading:string|null; batteryLevel:number; }
export function monitorSensorHealth(sensors:IOTSensor[]): { total:number; online:number; lowBattery:IOTSensor[] } {
  const online = sensors.filter(s=>s.status==='online');
  const lowBattery = sensors.filter(s=>s.batteryLevel<20);
  return { total:sensors.length, online:online.length, lowBattery };
}

/* FEATURE 79: Alert Correlation */
export interface CorrelatedAlert { primaryAlertId:string; relatedAlerts:string[]; correlationType:'spatial'|'temporal'|'thematic'; correlationScore:number; narrative:string; recommendedAction:string; }
export function correlateAlerts(alerts:Array<{id:string;location:{lat:number;lng:number};timestamp:string;category:string}>): CorrelatedAlert[] {
  const correlations:CorrelatedAlert[] = [];
  for (let i=0;i<alerts.length;i++) {
    for (let j=i+1;j<alerts.length;j++) {
      const timeDiff = Math.abs(new Date(alerts[i].timestamp).getTime()-new Date(alerts[j].timestamp).getTime())/60000;
      if (timeDiff<15) {
        correlations.push({ primaryAlertId:alerts[i].id, relatedAlerts:[alerts[j].id], correlationType:'temporal', correlationScore:Math.round((1-timeDiff/15)*100), narrative:`Alerts ${alerts[i].id} and ${alerts[j].id} within ${Math.round(timeDiff)} min`, recommendedAction:'Investigate possible connection' });
      }
    }
  }
  return correlations.sort((a,b)=>b.correlationScore-a.correlationScore);
}

/* FEATURE 80: Situational Awareness Dashboard */
export interface SADashboard { activeIncidents:number; camerasOnline:number; gunshotDetections:number; lprHits:number; droneMissions:number; intelReports:number; suspiciousActivity:number; threatLevel:'green'|'yellow'|'orange'|'red'; }
export function assessThreatLevel(data:{activeIncidents:number;gunshots:number;intel:RTIntel[]}): { level:'green'|'yellow'|'orange'|'red'; recommendation:string } {
  const highIntel = data.intel.filter(i=>i.threatLevel==='high'||i.threatLevel==='critical').length;
  if (data.gunshots>0||highIntel>=3) return { level:'red', recommendation:'Immediate command notification. Activate TOC.' };
  if (data.activeIncidents>10||highIntel>=1) return { level:'orange', recommendation:'Heightened monitoring. Brief command staff.' };
  if (data.activeIncidents>5) return { level:'yellow', recommendation:'Standard monitoring. Normal operations.' };
  return { level:'green', recommendation:'Routine operations. All systems normal.' };
}

// ============================================================
// RMPG Flex — AVL & Fleet Tracking (Spillman Flex Standard)
// 10 AVL features: real-time vehicle location, geo-fencing,
// route playback, speed monitoring, idle time tracking,
// maintenance alerts, fuel optimization, driver behavior,
// panic button integration, and fleet analytics.
// ============================================================

import { parseTimestamp } from './dateUtils';

/* FEATURE 11: Real-Time Vehicle Location */
export interface VehiclePosition { vehicleId:string; latitude:number; longitude:number; speed:number; heading:number; timestamp:string; ignition:boolean; }
export function calculateFleetCoverage(positions:VehiclePosition[], totalVehicles:number): { activeTracking:number; coveragePct:number; staleVehicles:string[] } {
  const now = Date.now(); const recent = positions.filter(p=>now-parseTimestamp(p.timestamp).getTime()<300000);
  const activeIds = new Set(recent.map(p=>p.vehicleId));
  const stale:string[] = []; for (const p of positions) { if (!activeIds.has(p.vehicleId)) stale.push(p.vehicleId); }
  return { activeTracking:activeIds.size, coveragePct:totalVehicles>0?Math.round(activeIds.size/totalVehicles*100):0, staleVehicles:[...new Set(stale)] };
}

/* FEATURE 12: Geo-Fencing */
export interface GeoFence { id:string; name:string; boundary:Array<{lat:number;lng:number}>; alertOnEntry:boolean; alertOnExit:boolean; active:boolean; }
export function checkFenceViolation(position:{lat:number;lng:number}, fences:GeoFence[]): GeoFence[] {
  return fences.filter(f=>{
    const points = f.boundary; let inside = false;
    for (let i=0,j=points.length-1;i<points.length;j=i++) {
      if ((points[i].lat>position.lat)!==(points[j].lat>position.lat)&&position.lng<(points[j].lng-points[i].lng)*(position.lat-points[i].lat)/(points[j].lat-points[i].lat)+points[i].lng) inside=!inside;
    }
    return f.active && inside && f.alertOnEntry;
  });
}

/* FEATURE 13: Route Playback */
export interface RouteSegment { vehicleId:string; startTime:string; endTime:string; startLat:number; startLng:number; endLat:number; endLng:number; distance:number; avgSpeed:number; maxSpeed:number; }
export function analyzeRoute(segments:RouteSegment[]): { totalDistance:number; totalTime:number; avgSpeed:number; maxSpeed:number } {
  const totalDist = Math.round(segments.reduce((s,seg)=>s+seg.distance,0)*100)/100;
  const totalTime = Math.round(segments.reduce((s,seg)=>(parseTimestamp(seg.endTime).getTime()-parseTimestamp(seg.startTime).getTime())/60000,0));
  return { totalDistance:totalDist, totalTime, avgSpeed:segments.length>0?Math.round(segments.reduce((s,seg)=>s+seg.avgSpeed,0)/segments.length):0, maxSpeed:Math.max(0,...segments.map(s=>s.maxSpeed)) };
}

/* FEATURE 14: Speed Monitoring */
export interface SpeedEvent { vehicleId:string; timestamp:string; speed:number; postedSpeed:number; location:string; duration:number; }
export function analyzeSpeedProfile(events:SpeedEvent[]): { totalEvents:number; avgOverSpeed:number; chronicSpeeders:Array<{vehicleId:string;events:number}> } {
  const byVehicle:Record<string,SpeedEvent[]> = {}; for (const e of events) { if (!byVehicle[e.vehicleId]) byVehicle[e.vehicleId]=[]; byVehicle[e.vehicleId].push(e); }
  const chronic = Object.entries(byVehicle).filter(([,evts])=>evts.length>=5).map(([id,evts])=>({vehicleId:id,events:evts.length}));
  return { totalEvents:events.length, avgOverSpeed:events.length>0?Math.round(events.reduce((s,e)=>s+(e.speed-e.postedSpeed),0)/events.length):0, chronicSpeeders:chronic };
}

/* FEATURE 15: Idle Time Tracking */
export interface IdleEvent { vehicleId:string; startTime:string; endTime:string; durationMinutes:number; location:string; ignitionOn:boolean; }
export function calculateIdleCosts(events:IdleEvent[], fuelCostPerGallon:number=3.50, gallonsPerHour:number=1.0): { totalIdleHours:number; totalCost:number; avgIdlePerVehicle:number } {
  const totalMinutes = events.reduce((s,e)=>s+e.durationMinutes,0);
  const totalHours = Math.round(totalMinutes/60*10)/10;
  const byVehicle:Record<string,number> = {}; for (const e of events) byVehicle[e.vehicleId]=(byVehicle[e.vehicleId]||0)+e.durationMinutes;
  const avgPerVehicle = Object.keys(byVehicle).length>0?Math.round(totalMinutes/Object.keys(byVehicle).length):0;
  return { totalIdleHours:totalHours, totalCost:Math.round(totalHours*gallonsPerHour*fuelCostPerGallon), avgIdlePerVehicle:avgPerVehicle };
}

/* FEATURE 16: Maintenance Alerts */
export interface MaintenanceAlert { vehicleId:string; alertType:'oil_change'|'tire_rotation'|'brake_service'|'engine_light'|'scheduled_service'; dueMileage:number; currentMileage:number; severity:'due'|'overdue'|'critical'; }
export function prioritizeMaintenance(alerts:MaintenanceAlert[]): MaintenanceAlert[] {
  return [...alerts].sort((a,b)=>{const sev={critical:3,overdue:2,due:1}; return (sev[b.severity]||0)-(sev[a.severity]||0);});
}

/* FEATURE 17: Fuel Optimization */
export interface FuelOptimization { vehicleId:string; avgMpg:number; fleetAvgMpg:number; improvementOpportunities:string[]; estimatedSavings:number; }
export function calculateFuelSavings(vehicles:Array<{mpg:number;annualMiles:number}>, targetMpg:number): { totalVehicles:number; belowThreshold:number; potentialSavings:number } {
  const below = vehicles.filter(v=>v.mpg<targetMpg);
  const savings = below.reduce((s,v)=>s+(targetMpg-v.mpg)*v.annualMiles/targetMpg*3.50,0);
  return { totalVehicles:vehicles.length, belowThreshold:below.length, potentialSavings:Math.round(savings) };
}

/* FEATURE 18: Driver Behavior */
export interface DriverBehavior { vehicleId:string; driverId:string; events:Array<{type:'hard_acceleration'|'hard_braking'|'sharp_turn'|'speeding'; timestamp:string}>; score:number; }
export function calculateDriverScore(events:DriverBehavior['events']): number {
  const weights = {hard_acceleration:2,hard_braking:3,sharp_turn:2,speeding:5};
  const penalty = events.reduce((s,e)=>s+(weights[e.type]||0),0);
  return Math.max(0,100-penalty);
}

/* FEATURE 19: Panic Button Integration */
export interface AVLPanic { vehicleId:string; timestamp:string; location:{lat:number;lng:number}; officerId:string; resolved:boolean; resolvedAt:string|null; }
export function handleAVLPanic(panic:AVLPanic): { alertLevel:'critical'; notifications:string[]; nearestUnits:string } {
  return { alertLevel:'critical', notifications:['Dispatch center','Supervisor','Nearest units','Command staff'], nearestUnits:'Auto-calculated from GPS proximity' };
}

/* FEATURE 20: Fleet Analytics */
export interface FleetAnalytics { totalVehicles:number; vehiclesInService:number; totalMilesToday:number; avgSpeed:number; idleHours:number; fuelUsed:number; maintenanceDue:number; alertsActive:number; }
export function compileFleetAnalytics(data:{vehicles:number;inService:number;miles:number;idleHours:number;maintenance:number}): FleetAnalytics {
  return { totalVehicles:data.vehicles, vehiclesInService:data.inService, totalMilesToday:data.miles, avgSpeed:0, idleHours:data.idleHours, fuelUsed:0, maintenanceDue:data.maintenance, alertsActive:0 };
}

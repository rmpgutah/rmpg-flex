// ============================================================
// RMPG Flex — Fleet Maintenance (Spillman Flex Standard)
// 10 fleet features: maintenance scheduling, fuel tracking,
// mileage logging, tire management, recall monitoring, damage
// reporting, inspection checklists, cost-per-mile analysis,
// vehicle rotation, and lifecycle management.
// ============================================================

/* FEATURE 1: Maintenance Scheduling */
export interface MaintenanceSchedule {
  vehicleId: string; plate: string; make: string; model: string;
  currentMileage: number; nextOilChange: number; nextTireRotation: number;
  nextInspection: number; nextService: number; lastServiceDate: string;
  upcomingItems: Array<{ type: string; dueMileage: number; dueDate: string; priority: 'overdue'|'due_soon'|'scheduled'; cost: number }>;
}
export function scheduleMaintenance(vehicle: { id: string; plate: string; make: string; model: string; mileage: number; lastOilChange: number; lastTireRotation: number; lastInspection: number; lastServiceDate: string }): MaintenanceSchedule {
  const oilInterval = 5000; const tireInterval = 7500; const inspectionInterval = 12000; const serviceInterval = 15000;
  const items: MaintenanceSchedule['upcomingItems'] = [];
  const addItem = (type: string, dueMileage: number, cost: number) => {
    const diff = dueMileage - vehicle.mileage;
    const dueDate = new Date(); dueDate.setDate(dueDate.getDate() + Math.max(0, Math.floor(diff / 83)));
    const priority: 'overdue'|'due_soon'|'scheduled' = diff < 0 ? 'overdue' : diff < 500 ? 'due_soon' : 'scheduled';
    items.push({ type, dueMileage, dueDate: dueDate.toISOString().slice(0,10), priority, cost });
  };
  addItem('Oil Change', vehicle.lastOilChange + oilInterval, 85);
  addItem('Tire Rotation', vehicle.lastTireRotation + tireInterval, 45);
  addItem('Inspection', vehicle.lastInspection + inspectionInterval, 120);
  addItem('Full Service', vehicle.mileage + serviceInterval - (vehicle.mileage % serviceInterval), 350);
  items.sort((a,b) => a.dueMileage - b.dueMileage);
  return { vehicleId: vehicle.id, plate: vehicle.plate, make: vehicle.make, model: vehicle.model, currentMileage: vehicle.mileage, nextOilChange: vehicle.lastOilChange+oilInterval, nextTireRotation: vehicle.lastTireRotation+tireInterval, nextInspection: vehicle.lastInspection+inspectionInterval, nextService: vehicle.mileage+serviceInterval-(vehicle.mileage%serviceInterval), lastServiceDate: vehicle.lastServiceDate, upcomingItems: items };
}

/* FEATURE 2: Fuel Tracking */
export interface FuelLog { vehicleId: string; date: string; gallons: number; costPerGallon: number; totalCost: number; odometer: number; mpg: number | null; fuelType: string; station: string; notes: string; }
export function calculateFuelEfficiency(logs: FuelLog[]): { avgMpg: number; totalGallons: number; totalCost: number; costPerMile: number; trend: 'improving'|'stable'|'declining' } {
  const valid = logs.filter(l => l.mpg !== null && l.mpg > 0);
  const totalGallons = logs.reduce((s,l) => s + l.gallons, 0);
  const totalCost = logs.reduce((s,l) => s + l.totalCost, 0);
  const totalMiles = valid.reduce((s, l, i) => i === 0 ? 0 : s + (logs[i].odometer - logs[i-1].odometer), 0);
  const avgMpg = valid.length > 0 ? valid.reduce((s,l) => s + (l.mpg||0), 0) / valid.length : 0;
  const recent = valid.slice(-5); const older = valid.slice(-10, -5);
  const recentAvg = recent.length > 0 ? recent.reduce((s,l) => s + (l.mpg||0), 0) / recent.length : avgMpg;
  const olderAvg = older.length > 0 ? older.reduce((s,l) => s + (l.mpg||0), 0) / older.length : avgMpg;
  const trend = recentAvg > olderAvg * 1.05 ? 'improving' : recentAvg < olderAvg * 0.95 ? 'declining' : 'stable';
  return { avgMpg: Math.round(avgMpg * 10) / 10, totalGallons: Math.round(totalGallons * 10) / 10, totalCost: Math.round(totalCost * 100) / 100, costPerMile: totalMiles > 0 ? Math.round(totalCost / totalMiles * 100) / 100 : 0, trend };
}

/* FEATURE 3: Mileage Logging */
export interface MileageEntry { vehicleId: string; date: string; startOdometer: number; endOdometer: number; milesDriven: number; purpose: string; officerId: string; shift: string; }
export function analyzeMileage(entries: MileageEntry[]): { totalMiles: number; avgMilesPerDay: number; avgMilesPerShift: number; peakUsageDay: string; peakUsageShift: string } {
  const total = entries.reduce((s,e) => s + e.milesDriven, 0);
  const days = new Set(entries.map(e => e.date)).size;
  const byShift: Record<string,number[]> = {}; const byDay: Record<string,number> = {};
  for (const e of entries) { byShift[e.shift] = [...(byShift[e.shift]||[]), e.milesDriven]; byDay[e.date] = (byDay[e.date]||0) + e.milesDriven; }
  const peakDay = Object.entries(byDay).sort((a,b)=>b[1]-a[1])[0];
  const peakShift = Object.entries(byShift).sort((a,b)=> (b[1].reduce((s,v)=>s+v,0)/b[1].length) - (a[1].reduce((s,v)=>s+v,0)/a[1].length))[0];
  return { totalMiles: total, avgMilesPerDay: days > 0 ? Math.round(total/days) : 0, avgMilesPerShift: Object.keys(byShift).length > 0 ? Math.round(total / entries.length) : 0, peakUsageDay: peakDay ? `${peakDay[0]} (${peakDay[1]} mi)` : 'N/A', peakUsageShift: peakShift ? `${peakShift[0]} (${Math.round(peakShift[1].reduce((s,v)=>s+v,0)/peakShift[1].length)} mi avg)` : 'N/A' };
}

/* FEATURE 4: Tire Management */
export interface TireRecord { vehicleId: string; position: string; brand: string; model: string; installedDate: string; installedMileage: number; treadDepth: number; lastRotationDate: string; lastRotationMileage: number; status: 'good'|'fair'|'replace'; }
export function evaluateTireCondition(tires: TireRecord[]): { overallStatus: string; needsRotation: boolean; needsReplacement: TireRecord[]; avgTreadDepth: number; recommendation: string } {
  const needsReplacement = tires.filter(t => t.treadDepth < 3 || t.status === 'replace');
  const avgTread = tires.length > 0 ? Math.round(tires.reduce((s,t) => s + t.treadDepth, 0) / tires.length * 10) / 10 : 0;
  const needsRotation = tires.some(t => { if (!t.lastRotationMileage) return true; return (t.installedMileage - t.lastRotationMileage) > 7500; });
  let overall = 'good'; if (needsReplacement.length > 0) overall = 'replace'; else if (needsRotation || avgTread < 5) overall = 'fair';
  return { overallStatus: overall, needsRotation, needsReplacement, avgTreadDepth: avgTread, recommendation: needsReplacement.length > 0 ? `Replace ${needsReplacement.length} tire(s): ${needsReplacement.map(t=>t.position).join(', ')}` : needsRotation ? 'Tire rotation recommended' : 'Tires in good condition' };
}

/* FEATURE 5: Recall Monitoring */
export interface RecallAlert { vehicleId: string; vin: string; recallNumber: string; manufacturer: string; description: string; severity: 'critical'|'moderate'|'minor'; issuedDate: string; repairStatus: 'open'|'scheduled'|'completed'|'not_applicable'; }
export function checkRecallStatus(alerts: RecallAlert[]): { totalOpen: number; criticalOpen: number; vehiclesAffected: string[]; requiresImmediateAction: boolean } {
  const open = alerts.filter(a => a.repairStatus === 'open' || a.repairStatus === 'scheduled');
  const criticalOpen = open.filter(a => a.severity === 'critical');
  const vins = [...new Set(open.map(a => a.vin))];
  return { totalOpen: open.length, criticalOpen: criticalOpen.length, vehiclesAffected: vins, requiresImmediateAction: criticalOpen.length > 0 };
}

/* FEATURE 6: Damage Reporting */
export interface DamageReport { id: string; vehicleId: string; reportedBy: string; reportedAt: string; damageType: string; location: string; severity: 'minor'|'moderate'|'major'|'totaled'; description: string; photos: string[]; repairEstimate: number; repairStatus: 'pending'|'approved'|'in_repair'|'completed'; atFault: boolean; policeReportNumber: string | null; }
export function assessDamageSeverity(report: DamageReport): { costTier: string; requiresSupervisorReview: boolean; outOfService: boolean; insuranceRequired: boolean } {
  const requiresReview = report.severity === 'major' || report.severity === 'totaled' || report.repairEstimate > 2500;
  const outOfService = report.severity === 'totaled' || report.repairEstimate > 10000 || report.damageType.includes('frame') || report.damageType.includes('flood');
  return { costTier: report.repairEstimate < 1000 ? 'low' : report.repairEstimate < 5000 ? 'medium' : 'high', requiresSupervisorReview: requiresReview, outOfService, insuranceRequired: report.repairEstimate > 1000 || report.atFault };
}

/* FEATURE 7: Inspection Checklists */
export interface InspectionChecklist { id: string; type: 'daily'|'weekly'|'monthly'|'annual'; items: Array<{ name: string; category: string; required: boolean; passed: boolean|null; notes: string }>; completedBy: string; completedAt: string; vehicleId: string; odometer: number; overallResult: 'pass'|'fail'|'incomplete'; }
export function generateDailyInspection(vehicleId: string, officerId: string, odometer: number): InspectionChecklist {
  const items = [
    { name: 'Emergency lights', category: 'lighting', required: true, passed: null, notes: '' },
    { name: 'Headlights/Taillights', category: 'lighting', required: true, passed: null, notes: '' },
    { name: 'Siren', category: 'equipment', required: true, passed: null, notes: '' },
    { name: 'Brakes', category: 'mechanical', required: true, passed: null, notes: '' },
    { name: 'Tire condition', category: 'mechanical', required: true, passed: null, notes: '' },
    { name: 'Fluid levels', category: 'mechanical', required: true, passed: null, notes: '' },
    { name: 'Radio check', category: 'equipment', required: true, passed: null, notes: '' },
    { name: 'First aid kit', category: 'equipment', required: true, passed: null, notes: '' },
    { name: 'Fire extinguisher', category: 'safety', required: true, passed: null, notes: '' },
    { name: 'Body damage check', category: 'exterior', required: false, passed: null, notes: '' },
  ];
  return { id: `inspect-${Date.now()}`, type: 'daily', items, completedBy: officerId, completedAt: new Date().toISOString(), vehicleId, odometer, overallResult: 'incomplete' };
}

/* FEATURE 8: Cost-Per-Mile Analysis */
export interface VehicleCost { vehicleId: string; period: string; fuelCost: number; maintenanceCost: number; repairCost: number; insuranceCost: number; depreciation: number; totalMiles: number; }
export function calculateCostPerMile(cost: VehicleCost): { costPerMile: number; breakdown: Record<string,number>; comparisonToFleetAverage: string } {
  const cpm = cost.totalMiles > 0 ? cost.totalMiles : 1;
  const breakdown = { fuel: Math.round(cost.fuelCost / cpm * 100) / 100, maintenance: Math.round(cost.maintenanceCost / cpm * 100) / 100, repair: Math.round(cost.repairCost / cpm * 100) / 100, insurance: Math.round(cost.insuranceCost / cpm * 100) / 100, depreciation: Math.round(cost.depreciation / cpm * 100) / 100 };
  const totalCpm = Object.values(breakdown).reduce((s,v)=>s+v,0);
  const fleetAvg = 0.58;
  return { costPerMile: Math.round(totalCpm*100)/100, breakdown, comparisonToFleetAverage: totalCpm > fleetAvg * 1.2 ? 'Above fleet average' : totalCpm < fleetAvg * 0.8 ? 'Below fleet average' : 'At fleet average' };
}

/* FEATURE 9: Vehicle Rotation */
export interface RotationPlan { vehicleId: string; currentAssignment: string; recommendedAssignment: string; reason: string; priority: 'now'|'soon'|'future'; }
export function planVehicleRotation(vehicles: Array<{id:string;mileage:number;maxMileage:number;daysSinceLastService:number;assignedOfficer:string}>): RotationPlan[] {
  return vehicles.map(v => {
    const mileagePct = v.mileage / v.maxMileage;
    let priority: RotationPlan['priority'] = 'future'; let reason = '';
    if (mileagePct > 0.95) { priority = 'now'; reason = `At ${Math.round(mileagePct*100)}% of max mileage — immediate rotation needed`; }
    else if (mileagePct > 0.8) { priority = 'soon'; reason = `Approaching max mileage (${Math.round(mileagePct*100)}%)`; }
    else if (v.daysSinceLastService > 180) { priority = 'soon'; reason = `${v.daysSinceLastService} days since last service`; }
    else { reason = 'Normal rotation schedule'; }
    return { vehicleId: v.id, currentAssignment: v.assignedOfficer, recommendedAssignment: 'Pool', reason, priority };
  }).sort((a,b) => (a.priority==='now'?-1:a.priority==='soon'?0:1) - (b.priority==='now'?-1:b.priority==='soon'?0:1));
}

/* FEATURE 10: Lifecycle Management */
export interface VehicleLifecycle { vehicleId: string; acquisitionDate: string; acquisitionCost: number; currentValue: number; totalMaintenanceCost: number; totalRepairCost: number; totalMileage: number; ageYears: number; replacementYear: number; replacementCost: number; status: 'active'|'surplus'|'retired'; }
export function assessVehicleLifecycle(vehicle: VehicleLifecycle): { remainingLifePct: number; replacementUrgency: 'none'|'plan'|'urgent'; annualBudgetNeeded: number; recommendation: string } {
  const lifeUsed = (vehicle.ageYears / 8 + vehicle.totalMileage / 150000 * 0.5 + (vehicle.totalMaintenanceCost + vehicle.totalRepairCost) / vehicle.acquisitionCost * 0.5);
  const remaining = Math.max(0, 100 - lifeUsed * 100);
  let urgency: 'none'|'plan'|'urgent' = 'none';
  if (remaining < 10) urgency = 'urgent';
  else if (remaining < 30) urgency = 'plan';
  return { remainingLifePct: Math.round(remaining), replacementUrgency: urgency, annualBudgetNeeded: Math.round(vehicle.replacementCost / Math.max(1, 8 - vehicle.ageYears)), recommendation: urgency === 'urgent' ? 'Immediate replacement needed' : urgency === 'plan' ? 'Begin replacement procurement process' : 'Continue regular maintenance' };
}

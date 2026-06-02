// ═══════════════════════════════════════════════════════════════
// Fleet PDF Reports — consolidated generator (Features 75-89)
//
// Spillman Flex parity: FORM PS-206 style reports for every fleet
// sub-domain. All generators use the same header/footer pattern
// with NIBRS-style agency banner, vehicle quick-ref, and page
// numbering. Downloaded with deterministic filenames.
// ═══════════════════════════════════════════════════════════════

import jsPDF from 'jspdf';
import { parseTimestamp } from '../../../utils/dateUtils';
import type { FleetVehicle, FleetFuelLog, FleetFuelSummary, FleetMaintenance, FleetInspection, FleetAssignment, FleetInsurancePolicy, FleetAnalytics } from '../../../types';

const RMPG_GOLD = '#d4a017';
const RMPG_BLACK = '#0a0a0a';
const RMPG_GRAY = '#888888';

// ── Shared helpers ──────────────────────────────────────────

function headerStrip(doc: jsPDF, title: string, subtitle?: string) {
  const m = 40; const w = doc.internal.pageSize.getWidth();
  doc.setFillColor(RMPG_BLACK);
  doc.rect(0, 0, w, 52, 'F');
  doc.setFillColor(RMPG_GOLD);
  doc.rect(0, 52, w, 3, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor('#ffffff');
  doc.text('RMPG FLEX — FLEET MANAGEMENT', m, 26);
  doc.setFontSize(11); doc.setFont('helvetica', 'normal');
  doc.text(title, m, 42);
  if (subtitle) { doc.setFontSize(9); doc.setTextColor(RMPG_GOLD); doc.text(subtitle, m, 50); }
  doc.setTextColor('#000000');
  return 70;
}

function footerStrip(doc: jsPDF, page: number, total: number) {
  const w = doc.internal.pageSize.getWidth(); const h = doc.internal.pageSize.getHeight();
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(RMPG_GRAY);
  doc.text(`Page ${page} of ${total}`, 40, h - 25);
  doc.text(`Generated ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`, 40, h - 14);
}

function vehicleSummaryBlock(doc: jsPDF, v: FleetVehicle, y: number): number {
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
  doc.text(`UNIT #${v.vehicle_number}  •  ${[v.year, v.make, v.model].filter(Boolean).join(' ')}  •  ${v.plate_number || 'N/A'}`, 40, y);
  return y + 24;
}

function drawGridBox(doc: jsPDF, x: number, y: number, w: number, label: string, value: string, highlight?: boolean) {
  doc.setDrawColor('#cccccc'); doc.setLineWidth(0.5);
  doc.rect(x, y, w, 32);
  if (highlight) { doc.setFillColor(RMPG_GOLD); doc.rect(x, y, w, 3, 'F'); }
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(RMPG_GRAY);
  doc.text(label, x + 5, y + 14);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor('#000');
  doc.text(value, x + 5, y + 27);
}

// ═══════════════════════════════════════════════════════════════
// 1. FLEET STATUS REPORT (Feature 75)
// ═══════════════════════════════════════════════════════════════

export function generateFleetStatusReport(data: {
  vehicles: FleetVehicle[];
  analytics: FleetAnalytics | null;
}): void {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  let y = headerStrip(doc, 'FLEET STATUS REPORT', `Total Units: ${data.vehicles.length}  •  Active: ${data.vehicles.filter(v => v.status === 'in_service').length}`);
  const totalPages = Math.ceil(data.vehicles.length / 25);
  let page = 1;
  let rowIdx = 0;

  // Quick stats row
  const cols = [
    ['Total Fleet', String(data.analytics?.fleet_summary?.total_vehicles ?? data.vehicles.length)],
    ['Avg Mileage', String(Math.round(data.analytics?.fleet_summary?.avg_mileage ?? 0))],
    ['Avg MPG', String(data.analytics?.fleet_summary?.avg_mpg ?? 'N/A')],
    ['Needing Service', String(data.analytics?.fleet_summary?.vehicles_needing_service ?? 0)],
    ['Failed Insp.', String(data.analytics?.fleet_summary?.inspections_failing ?? 0)],
  ];
  const boxW = (pageW - 80) / cols.length;
  cols.forEach((c, i) => drawGridBox(doc, 40 + i * boxW, y, boxW - 4, c[0], c[1]));
  y += 48;

  // Vehicle table
  const headers = ['Unit #', 'Yr', 'Make', 'Model', 'Plate', 'Status', 'Mileage', 'Assigned'];
  const colW = [(pageW - 80) * 0.14, 30, (pageW - 80) * 0.16, (pageW - 80) * 0.16, (pageW - 80) * 0.14, 60, 50, 60];
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setFillColor('#1a1a1a'); doc.setTextColor('#ffffff');
  doc.rect(40, y, pageW - 80, 18, 'F');
  let cx = 40;
  headers.forEach((h, i) => { doc.text(h, cx + 3, y + 13); cx += colW[i]; });
  y += 22;
  doc.setTextColor('#000');

  for (const v of data.vehicles) {
    if (rowIdx > 0 && rowIdx % 25 === 0) {
      footerStrip(doc, page, totalPages);
      doc.addPage(); page++; y = headerStrip(doc, 'FLEET STATUS REPORT (cont.)');
      rowIdx = 0;
    }
    if (y > pageH - 60) { footerStrip(doc, page, totalPages); doc.addPage(); page++; y = headerStrip(doc, 'FLEET STATUS REPORT (cont.)'); }
    const vals = [v.vehicle_number, String(v.year ?? ''), v.make ?? '', v.model ?? '', v.plate_number ?? '', v.status ?? '', String(v.current_mileage ?? ''), (v as any).assigned_unit_call_sign ?? ''];
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); cx = 40;
    vals.forEach((val, i) => { doc.text(val, cx + 3, y + 13); cx += colW[i]; });
    y += 16; rowIdx++;
  }

  footerStrip(doc, page, totalPages);
  doc.save(`fleet_status_report_${new Date().toISOString().slice(0, 10)}.pdf`);
}

// ═══════════════════════════════════════════════════════════════
// 2. FLEET MAINTENANCE HISTORY REPORT (Feature 76)
// ═══════════════════════════════════════════════════════════════

export function generateFleetMaintenanceReport(data: {
  vehicle: FleetVehicle;
  records: FleetMaintenance[];
}): void {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  let y = headerStrip(doc, 'MAINTENANCE HISTORY REPORT');
  y = vehicleSummaryBlock(doc, data.vehicle, y);
  const totalPages = Math.max(1, Math.ceil(data.records.length / 30));
  let page = 1; let rowIdx = 0;

  const totalCost = data.records.reduce((s, r) => s + (r.cost || 0), 0);
  const cols = [['Total Records', String(data.records.length)], ['Total Cost', `$${totalCost.toLocaleString()}`, true], ['Avg Cost', `$${data.records.length > 0 ? Math.round(totalCost / data.records.length) : 0}`, true]];
  const boxW = (pageW - 80) / cols.length;
  cols.forEach((c, i) => drawGridBox(doc, 40 + i * boxW, y, boxW - 4, c[0] as string, c[1] as string, c[2] as boolean));
  y += 48;

  const headers = ['Date', 'Type', 'Description', 'Mileage', 'Cost', 'Vendor', 'Next Due'];
  const colW = [70, 55, 140, 55, 55, 80, 70];
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setFillColor('#1a1a1a'); doc.setTextColor('#ffffff');
  doc.rect(40, y, pageW - 80, 18, 'F');
  let cx = 40;
  headers.forEach((h, i) => { doc.text(h, cx + 3, y + 13); cx += colW[i]; });
  y += 22; doc.setTextColor('#000');

  for (const r of data.records) {
    if (y > pageH - 60) { footerStrip(doc, page, totalPages); doc.addPage(); page++; y = headerStrip(doc, 'MAINTENANCE HISTORY REPORT (cont.)'); }
    const vals = [r.performed_at?.slice(0, 10) ?? '', r.type ?? '', r.description?.slice(0, 40) ?? '', String(r.mileage_at_service ?? ''), `$${r.cost ?? 0}`, r.vendor?.slice(0, 20) ?? '', r.next_due_date?.slice(0, 10) ?? ''];
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); cx = 40;
    vals.forEach((val, i) => { doc.text(val, cx + 3, y + 12); cx += colW[i]; });
    y += 15; rowIdx++;
  }

  footerStrip(doc, page, totalPages);
  doc.save(`fleet_maintenance_${data.vehicle.vehicle_number}_${new Date().toISOString().slice(0, 10)}.pdf`);
}

// ═══════════════════════════════════════════════════════════════
// 3. FLEET COST ANALYSIS REPORT (Feature 77)
// ═══════════════════════════════════════════════════════════════

export function generateFleetCostReport(data: {
  vehicle: FleetVehicle;
  fuelLogs: FleetFuelLog[];
  fuelSummary: FleetFuelSummary | null;
  maintenanceRecords: FleetMaintenance[];
}): void {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  let y = headerStrip(doc, 'FLEET COST ANALYSIS REPORT');
  y = vehicleSummaryBlock(doc, data.vehicle, y);
  const totalMaintCost = data.maintenanceRecords.reduce((s, r) => s + (r.cost || 0), 0);
  const totalFuelCost = data.fuelLogs.reduce((s, l) => s + (l.total_cost || 0), 0);
  const totalMiles = data.fuelSummary?.total_distance ?? 0;
  const cpm = totalMiles > 0 ? ((totalFuelCost + totalMaintCost) / totalMiles).toFixed(2) : 'N/A';

  // Cost breakdown grid (2 rows x 4 cols)
  const boxes: [string, string, boolean?][] = [
    ['Fuel Cost (Total)', `$${totalFuelCost.toLocaleString()}`, true],
    ['Maintenance Cost', `$${totalMaintCost.toLocaleString()}`, true],
    ['Combined Cost', `$${(totalFuelCost + totalMaintCost).toLocaleString()}`, true],
    ['Cost / Mile', `$${cpm}`, true],
    ['Total Gallons', String(data.fuelSummary?.total_gallons ?? 0)],
    ['Avg MPG', String(data.fuelSummary?.avg_mpg ?? 'N/A')],
    ['Avg $/Gal', `$${data.fuelSummary?.avg_cost_per_gallon ?? 'N/A'}`],
    ['Total Miles', String(totalMiles)],
  ];
  const boxW = (pageW - 80) / 4;
  boxes.forEach((b, i) => {
    const col = i % 4; const row = Math.floor(i / 4);
    drawGridBox(doc, 40 + col * boxW, y + row * 38, boxW - 4, b[0], b[1], b[2]);
  });
  y += 88;

  // Maintenance cost table
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
  doc.text('Maintenance Cost Breakdown', 40, y);
  y += 16;
  const maintByType = new Map<string, { count: number; cost: number }>();
  for (const r of data.maintenanceRecords) { const t = r.type || 'other'; const e = maintByType.get(t) || { count: 0, cost: 0 }; e.count++; e.cost += r.cost || 0; maintByType.set(t, e); }
  for (const [type, info] of maintByType) {
    if (y > pageH - 40) { doc.addPage(); y = headerStrip(doc, 'FLEET COST ANALYSIS (cont.)'); }
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    doc.text(`${type}: ${info.count} records  •  $${info.cost.toLocaleString()}`, 40, y);
    y += 14;
  }

  doc.save(`fleet_cost_analysis_${data.vehicle.vehicle_number}_${new Date().toISOString().slice(0, 10)}.pdf`);
}

// ═══════════════════════════════════════════════════════════════
// 4. FLEET LIFECYCLE REPORT (Feature 78)
// ═══════════════════════════════════════════════════════════════

export function generateFleetLifecycleReport(data: {
  vehicle: FleetVehicle;
  fuelLogs: FleetFuelLog[];
  maintenanceRecords: FleetMaintenance[];
  inspections: FleetInspection[];
  assignments: FleetAssignment[];
}): void {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  let y = headerStrip(doc, 'VEHICLE LIFECYCLE REPORT');
  y = vehicleSummaryBlock(doc, data.vehicle, y);
  const totalPages = Math.max(1, Math.ceil((data.fuelLogs.length + data.maintenanceRecords.length) / 40));
  let page = 1;

  // Lifecycle summary boxes
  const firstFuel = data.fuelLogs[data.fuelLogs.length - 1];
  const lastFuel = data.fuelLogs[0];
  const totalFuel = data.fuelLogs.reduce((s, l) => s + (l.total_cost || 0), 0);
  const totalMaint = data.maintenanceRecords.reduce((s, r) => s + (r.cost || 0), 0);
  const totalInsp = data.inspections.length;
  const totalAssign = data.assignments.length;

  const boxes: [string, string][] = [
    ['First Fuel Date', firstFuel?.fuel_date?.slice(0, 10) ?? 'N/A'],
    ['Last Fuel Date', lastFuel?.fuel_date?.slice(0, 10) ?? 'N/A'],
    ['Total Fuel Cost', `$${totalFuel.toLocaleString()}`],
    ['Total Maint Cost', `$${totalMaint.toLocaleString()}`],
    ['Total Ownership Cost', `$${(totalFuel + totalMaint).toLocaleString()}`],
    ['Inspections', String(totalInsp)],
    ['Assignments', String(totalAssign)],
    ['Status', data.vehicle.status ?? 'N/A'],
  ];
  const boxW = (pageW - 80) / 4;
  boxes.forEach((b, i) => drawGridBox(doc, 40 + (i % 4) * boxW, y + Math.floor(i / 4) * 38, boxW - 4, b[0], b[1]));
  y += 88;

  // Maintenance history table
  const maintHeaders = ['Date', 'Type', 'Description', 'Mileage', 'Cost', 'Vendor'];
  const maintColW = [70, 55, 140, 55, 55, 80];
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
  doc.text('Maintenance History', 40, y); y += 16;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setFillColor('#1a1a1a'); doc.setTextColor('#ffffff');
  doc.rect(40, y, pageW - 80, 18, 'F');
  let cx = 40;
  maintHeaders.forEach((h, i) => { doc.text(h, cx + 3, y + 13); cx += maintColW[i]; });
  y += 22; doc.setTextColor('#000');

  let rowIdx = 0;
  for (const r of data.maintenanceRecords) {
    if (y > pageH - 60) { footerStrip(doc, page, totalPages); doc.addPage(); page++; y = headerStrip(doc, 'VEHICLE LIFECYCLE REPORT (cont.)'); }
    const vals = [r.performed_at?.slice(0, 10) ?? '', r.type ?? '', (r.description ?? '').slice(0, 40), String(r.mileage_at_service ?? ''), `$${r.cost ?? 0}`, (r.vendor ?? '').slice(0, 20)];
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); cx = 40;
    vals.forEach((v, i) => { doc.text(v, cx + 3, y + 12); cx += maintColW[i]; });
    y += 15; rowIdx++;
  }

  footerStrip(doc, page, totalPages);
  doc.save(`fleet_lifecycle_${data.vehicle.vehicle_number}_${new Date().toISOString().slice(0, 10)}.pdf`);
}

// ═══════════════════════════════════════════════════════════════
// 5. FLEET COMPLIANCE REPORT (Feature 79)
// ═══════════════════════════════════════════════════════════════

export function generateFleetComplianceReport(data: {
  vehicles: FleetVehicle[];
}): void {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  let y = headerStrip(doc, 'FLEET COMPLIANCE REPORT', `Generated: ${new Date().toISOString().slice(0, 10)}`);
  const totalPages = Math.ceil(data.vehicles.length / 20);
  let page = 1; let rowIdx = 0;

  // Count compliance issues
  const expiredIns = data.vehicles.filter(v => v.insurance_expiry && new Date(v.insurance_expiry) < new Date()).length;
  const expiredReg = data.vehicles.filter(v => v.registration_expiry && new Date(v.registration_expiry) < new Date()).length;
  const needingService = data.vehicles.filter(v => v.next_service_due && new Date(v.next_service_due) < new Date()).length;

  const boxes: [string, string, boolean?][] = [
    ['Total Vehicles', String(data.vehicles.length)],
    ['Expired Insurance', String(expiredIns), expiredIns > 0],
    ['Expired Reg.', String(expiredReg), expiredReg > 0],
    ['Overdue Service', String(needingService), needingService > 0],
  ];
  const boxW = (pageW - 80) / boxes.length;
  boxes.forEach((b, i) => drawGridBox(doc, 40 + i * boxW, y, boxW - 4, b[0], b[1], b[2]));
  y += 48;

  // Compliance table
  const headers = ['Unit #', 'Yr/Make/Model', 'Plate', 'Status', 'Ins Expiry', 'Reg Expiry', 'Last Service', 'Next Due'];
  const colW = [55, 140, 70, 60, 70, 70, 70, 70];
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setFillColor('#1a1a1a'); doc.setTextColor('#ffffff');
  doc.rect(40, y, pageW - 80, 18, 'F');
  let cx = 40;
  headers.forEach((h, i) => { doc.text(h, cx + 3, y + 13); cx += colW[i]; });
  y += 22; doc.setTextColor('#000');

  for (const v of data.vehicles) {
    if (y > pageH - 50) { footerStrip(doc, page, totalPages); doc.addPage(); page++; y = headerStrip(doc, 'FLEET COMPLIANCE REPORT (cont.)'); }
    const vals = [v.vehicle_number, `${v.year ?? ''} ${v.make ?? ''} ${v.model ?? ''}`.trim(), v.plate_number ?? '', v.status ?? '', v.insurance_expiry?.slice(0, 10) ?? '', v.registration_expiry?.slice(0, 10) ?? '', v.last_service_date?.slice(0, 10) ?? '', v.next_service_due?.slice(0, 10) ?? ''];
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); cx = 40;
    vals.forEach((val, i) => {
      const expiredDate = (i === 4 || i === 5 || i === 7) && val ? parseTimestamp(val) : null;
      const expired = !!expiredDate && !isNaN(expiredDate.getTime()) && expiredDate < new Date();
      if (expired) doc.setTextColor('#ef4444');
      doc.text(val, cx + 3, y + 12);
      if (expired) doc.setTextColor('#000');
      cx += colW[i];
    });
    y += 15; rowIdx++;
  }

  footerStrip(doc, page, totalPages);
  doc.save(`fleet_compliance_report_${new Date().toISOString().slice(0, 10)}.pdf`);
}

// ═══════════════════════════════════════════════════════════════
// 6. FLEET UTILIZATION REPORT (Feature 80)
// ═══════════════════════════════════════════════════════════════

export function generateFleetUtilizationReport(data: {
  vehicles: Array<FleetVehicle & { days_used?: number; miles_driven?: number; fuel_cost?: number; daily_avg_miles?: number }>;
  days?: number;
}): void {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  let y = headerStrip(doc, 'FLEET UTILIZATION REPORT', `Last ${data.days ?? 30} Days`);
  const totalPages = Math.ceil(data.vehicles.length / 22);
  let page = 1; let rowIdx = 0;

  const headers = ['Unit #', 'Yr/Make/Model', 'Days Used', 'Miles', 'Fuel Cost', 'Daily Avg Mi', 'Status'];
  const colW = [55, 160, 60, 60, 70, 70, 80];
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setFillColor('#1a1a1a'); doc.setTextColor('#ffffff');
  doc.rect(40, y, pageW - 80, 18, 'F');
  let cx = 40;
  headers.forEach((h, i) => { doc.text(h, cx + 3, y + 13); cx += colW[i]; });
  y += 22; doc.setTextColor('#000');

  for (const v of data.vehicles) {
    if (y > pageH - 50) { footerStrip(doc, page, totalPages); doc.addPage(); page++; y = headerStrip(doc, 'FLEET UTILIZATION REPORT (cont.)'); }
    const vals = [v.vehicle_number, `${v.year ?? ''} ${v.make ?? ''} ${v.model ?? ''}`.trim(), String(v.days_used ?? 0), String(v.miles_driven ?? 0), `$${Math.round(v.fuel_cost ?? 0)}`, String(v.daily_avg_miles ?? 0), v.status ?? ''];
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); cx = 40;
    vals.forEach((val, i) => { doc.text(val, cx + 3, y + 12); cx += colW[i]; });
    y += 15; rowIdx++;
  }

  footerStrip(doc, page, totalPages);
  doc.save(`fleet_utilization_report_${new Date().toISOString().slice(0, 10)}.pdf`);
}

// ═══════════════════════════════════════════════════════════════
// 7. FLEET FUEL CONSUMPTION REPORT (Feature 81)
// ═══════════════════════════════════════════════════════════════

export function generateFleetFuelConsumptionReport(data: {
  vehicles: Array<FleetVehicle & { total_gallons?: number; co2_kg?: number; co2_lbs?: number }>;
  totalGallons?: number;
  totalCo2?: number;
}): void {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  let y = headerStrip(doc, 'FLEET FUEL CONSUMPTION & EMISSIONS REPORT');
  const totalPages = Math.ceil(data.vehicles.length / 22);
  let page = 1; let rowIdx = 0;

  const boxes: [string, string][] = [
    ['Total Gallons', String(data.totalGallons ?? 0)],
    ['Total CO2 (kg)', String(Math.round(data.totalCo2 ?? 0))],
    ['CO2 (lbs)', String(Math.round((data.totalCo2 ?? 0) * 2.205))],
    ['Vehicles', String(data.vehicles.length)],
  ];
  const boxW = (pageW - 80) / boxes.length;
  boxes.forEach((b, i) => drawGridBox(doc, 40 + i * boxW, y, boxW - 4, b[0], b[1]));
  y += 48;

  const headers = ['Unit #', 'Yr/Make/Model', 'Gallons', 'CO2 (kg)', 'CO2 (lbs)', 'Avg Gal/Mo'];
  const colW = [55, 160, 70, 70, 70, 80];
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setFillColor('#1a1a1a'); doc.setTextColor('#ffffff');
  doc.rect(40, y, pageW - 80, 18, 'F');
  let cx = 40;
  headers.forEach((h, i) => { doc.text(h, cx + 3, y + 13); cx += colW[i]; });
  y += 22; doc.setTextColor('#000');

  for (const v of data.vehicles) {
    if (y > pageH - 50) { footerStrip(doc, page, totalPages); doc.addPage(); page++; y = headerStrip(doc, 'FLEET FUEL CONSUMPTION (cont.)'); }
    const galPerMo = v.total_gallons ? Math.round((v.total_gallons / 12) * 10) / 10 : 0;
    const vals = [v.vehicle_number, `${v.year ?? ''} ${v.make ?? ''} ${v.model ?? ''}`.trim(), String(v.total_gallons ?? 0), String(Math.round(v.co2_kg ?? 0)), String(Math.round(v.co2_lbs ?? 0)), String(galPerMo)];
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); cx = 40;
    vals.forEach((val, i) => { doc.text(val, cx + 3, y + 12); cx += colW[i]; });
    y += 15; rowIdx++;
  }

  footerStrip(doc, page, totalPages);
  doc.save(`fleet_fuel_consumption_report_${new Date().toISOString().slice(0, 10)}.pdf`);
}

// ═══════════════════════════════════════════════════════════════
// 8. FLEET ACCIDENT REPORT (Feature 82)
// ═══════════════════════════════════════════════════════════════

export function generateFleetAccidentReport(data: {
  vehicle: FleetVehicle;
  accident: Record<string, unknown>;
}): void {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  let y = headerStrip(doc, 'FLEET ACCIDENT REPORT', `Vehicle #${data.vehicle.vehicle_number}`);
  y = vehicleSummaryBlock(doc, data.vehicle, y);

  const fields: [string, string][] = [
    ['Accident Date', (data.accident.accident_date as string)?.slice(0, 10) ?? 'N/A'],
    ['Location', (data.accident.location as string) ?? 'N/A'],
    ['Severity', (data.accident.severity as string) ?? 'N/A'],
    ['Weather', (data.accident.weather_conditions as string) ?? 'N/A'],
    ['Road Conditions', (data.accident.road_conditions as string) ?? 'N/A'],
    ['Police Report #', (data.accident.police_report_number as string) ?? 'N/A'],
    ['Insurance Claim #', (data.accident.insurance_claim_number as string) ?? 'N/A'],
    ['Est. Damage', `$${(data.accident.estimated_damage as number ?? 0).toLocaleString()}`],
    ['Injuries', String(data.accident.injuries ?? 0)],
    ['Fault', (data.accident.fault_determination as string) ?? 'Pending'],
    ['Status', (data.accident.status as string) ?? 'Open'],
  ];

  fields.forEach((f, i) => {
    const row = Math.floor(i / 2); const col = i % 2;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(RMPG_GRAY);
    doc.text(f[0], 40 + col * 260, y + row * 20);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor('#000');
    doc.text(f[1], 40 + col * 260, y + row * 20 + 12);
  });
  y += Math.ceil(fields.length / 2) * 20 + 24;

  if (data.accident.description) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
    doc.text('Description', 40, y); y += 14;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    doc.text((data.accident.description as string).slice(0, 500), 40, y);
  }

  doc.save(`fleet_accident_report_${data.vehicle.vehicle_number}_${new Date().toISOString().slice(0, 10)}.pdf`);
}

// ═══════════════════════════════════════════════════════════════
// 9. FLEET BUDGET REPORT (Feature 83)
// ═══════════════════════════════════════════════════════════════

export function generateFleetBudgetReport(data: {
  fiscalYear: number;
  budgets: Array<{ category: string; allocated_amount: number; spent_amount: number }>;
}): void {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const pageW = doc.internal.pageSize.getWidth();
  let y = headerStrip(doc, 'FLEET BUDGET REPORT', `Fiscal Year ${data.fiscalYear}`);

  const totalAllocated = data.budgets.reduce((s, b) => s + (b.allocated_amount || 0), 0);
  const totalSpent = data.budgets.reduce((s, b) => s + (b.spent_amount || 0), 0);

  const boxes: [string, string][] = [
    ['Total Budget', `$${totalAllocated.toLocaleString()}`],
    ['Total Spent', `$${totalSpent.toLocaleString()}`],
    ['Remaining', `$${(totalAllocated - totalSpent).toLocaleString()}`],
    ['Utilization', `${totalAllocated > 0 ? Math.round((totalSpent / totalAllocated) * 100) : 0}%`],
  ];
  const boxW = (pageW - 80) / boxes.length;
  boxes.forEach((b, i) => drawGridBox(doc, 40 + i * boxW, y, boxW - 4, b[0], b[1]));
  y += 56;

  // Budget bar chart (text-based)
  for (const b of data.budgets) {
    const pct = b.allocated_amount > 0 ? Math.round((b.spent_amount / b.allocated_amount) * 100) : 0;
    const barW = Math.min(pct, 100) * 3.2;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
    doc.text(b.category, 40, y);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    doc.text(`$${b.spent_amount.toLocaleString()} of $${b.allocated_amount.toLocaleString()} (${pct}%)`, 160, y);
    if (pct > 90) doc.setTextColor('#ef4444'); else if (pct > 70) doc.setTextColor('#d4a017'); else doc.setTextColor('#10b981');
    doc.setFillColor(pct > 90 ? '#ef4444' : pct > 70 ? '#d4a017' : '#10b981');
    doc.rect(40, y + 4, barW, 10, 'F');
    doc.setTextColor('#000');
    y += 22;
  }

  doc.save(`fleet_budget_report_fy${data.fiscalYear}.pdf`);
}

// ═══════════════════════════════════════════════════════════════
// 10. FLEET VEHICLE REPLACEMENT PLAN REPORT (Feature 84)
// ═══════════════════════════════════════════════════════════════

export function generateFleetReplacementReport(data: {
  vehicles: Array<FleetVehicle & { replacement_year?: number; replacement_reason?: string; estimated_replacement_cost?: number; rp_priority?: string; rp_status?: string }>;
}): void {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  let y = headerStrip(doc, 'FLEET REPLACEMENT PLAN', `Projected Replacements`);
  const totalPages = Math.ceil(data.vehicles.length / 20);
  let page = 1; let rowIdx = 0;

  const headers = ['Unit #', 'Yr/Make/Model', 'Mileage', 'Repl Year', 'Priority', 'Est. Cost', 'Reason', 'Status'];
  const colW = [50, 150, 55, 55, 55, 65, 120, 60];
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setFillColor('#1a1a1a'); doc.setTextColor('#ffffff');
  doc.rect(40, y, pageW - 80, 18, 'F');
  let cx = 40;
  headers.forEach((h, i) => { doc.text(h, cx + 3, y + 13); cx += colW[i]; });
  y += 22; doc.setTextColor('#000');

  const sorted = [...data.vehicles].sort((a, b) => {
    const pOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    return (pOrder[a.rp_priority ?? 'medium'] ?? 2) - (pOrder[b.rp_priority ?? 'medium'] ?? 2);
  });

  for (const v of sorted) {
    if (y > pageH - 50) { footerStrip(doc, page, totalPages); doc.addPage(); page++; y = headerStrip(doc, 'FLEET REPLACEMENT PLAN (cont.)'); }
    const vals = [v.vehicle_number, `${v.year ?? ''} ${v.make ?? ''} ${v.model ?? ''}`.trim(), String(v.current_mileage ?? ''), String(v.replacement_year ?? 'N/A'), v.rp_priority ?? 'N/A', v.estimated_replacement_cost ? `$${v.estimated_replacement_cost.toLocaleString()}` : 'N/A', (v.replacement_reason ?? '').slice(0, 35), v.rp_status ?? 'N/A'];
    if (v.rp_priority === 'critical') doc.setTextColor('#ef4444');
    else if (v.rp_priority === 'high') doc.setTextColor('#d4a017');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); cx = 40;
    vals.forEach((val, i) => { doc.text(val, cx + 3, y + 12); cx += colW[i]; });
    doc.setTextColor('#000');
    y += 15; rowIdx++;
  }
  footerStrip(doc, page, totalPages);
  doc.save(`fleet_replacement_plan_${new Date().toISOString().slice(0, 10)}.pdf`);
}

// ═══════════════════════════════════════════════════════════════
// 11. FLEET DEPRECIATION REPORT (Feature 85)
// ═══════════════════════════════════════════════════════════════

export function generateFleetDepreciationReport(data: {
  vehicles: Array<FleetVehicle & { depreciation?: { purchase_price?: number; salvage_value?: number; useful_life_months?: number; monthly_depreciation?: number; accumulated_depreciation?: number; current_book_value?: number } | null }>;
}): void {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  let y = headerStrip(doc, 'FLEET DEPRECIATION SCHEDULE');
  const totalPages = Math.ceil(data.vehicles.length / 20);
  let page = 1; let rowIdx = 0;

  const totalBookValue = data.vehicles.reduce((s, v) => s + (v.depreciation?.current_book_value ?? 0), 0);
  const totalDepreciation = data.vehicles.reduce((s, v) => s + (v.depreciation?.accumulated_depreciation ?? 0), 0);
  const boxes: [string, string][] = [
    ['Vehicles', String(data.vehicles.length)],
    ['Total Book Value', `$${totalBookValue.toLocaleString()}`],
    ['Total Depreciation', `$${totalDepreciation.toLocaleString()}`],
  ];
  const boxW = (pageW - 80) / boxes.length;
  boxes.forEach((b, i) => drawGridBox(doc, 40 + i * boxW, y, boxW - 4, b[0], b[1]));
  y += 48;

  const headers = ['Unit #', 'Yr/Make/Model', 'Purchase $', 'Salvage $', 'Life (mo)', 'Mo Deprec.', 'Accum Deprec', 'Book Value'];
  const colW = [50, 145, 65, 55, 55, 65, 70, 65];
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setFillColor('#1a1a1a'); doc.setTextColor('#ffffff');
  doc.rect(40, y, pageW - 80, 18, 'F');
  let cx = 40;
  headers.forEach((h, i) => { doc.text(h, cx + 3, y + 13); cx += colW[i]; });
  y += 22; doc.setTextColor('#000');

  for (const v of data.vehicles) {
    if (y > pageH - 50) { footerStrip(doc, page, totalPages); doc.addPage(); page++; y = headerStrip(doc, 'FLEET DEPRECIATION (cont.)'); }
    const d = v.depreciation;
    const vals = [v.vehicle_number, `${v.year ?? ''} ${v.make ?? ''} ${v.model ?? ''}`.trim(), d?.purchase_price ? `$${d.purchase_price.toLocaleString()}` : 'N/A', d?.salvage_value ? `$${d.salvage_value.toLocaleString()}` : '$0', String(d?.useful_life_months ?? 'N/A'), d?.monthly_depreciation ? `$${Math.round(d.monthly_depreciation)}` : 'N/A', d?.accumulated_depreciation ? `$${Math.round(d.accumulated_depreciation).toLocaleString()}` : 'N/A', d?.current_book_value ? `$${Math.round(d.current_book_value).toLocaleString()}` : 'N/A'];
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); cx = 40;
    vals.forEach((val, i) => { doc.text(val, cx + 3, y + 12); cx += colW[i]; });
    y += 15; rowIdx++;
  }
  footerStrip(doc, page, totalPages);
  doc.save(`fleet_depreciation_report_${new Date().toISOString().slice(0, 10)}.pdf`);
}

// ═══════════════════════════════════════════════════════════════
// 12. FLEET KEY MANAGEMENT REPORT (Feature 86)
// ═══════════════════════════════════════════════════════════════

export function generateFleetKeyReport(data: {
  keys: Array<{ vehicle_number?: string; key_number?: string; key_type?: string; rfid_tag?: string; status?: string; current_holder?: string; last_checkout?: string; last_return?: string }>;
}): void {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  let y = headerStrip(doc, 'FLEET KEY MANAGEMENT REPORT');
  const totalPages = Math.ceil(data.keys.length / 25);
  let page = 1; let rowIdx = 0;

  const checkedOut = data.keys.filter(k => k.status === 'checked_out').length;
  const boxes: [string, string][] = [
    ['Total Keys', String(data.keys.length)],
    ['Checked Out', String(checkedOut)],
    ['Available', String(data.keys.length - checkedOut)],
    ['Lost', String(data.keys.filter(k => k.status === 'lost').length)],
  ];
  const boxW = (pageW - 80) / boxes.length;
  boxes.forEach((b, i) => drawGridBox(doc, 40 + i * boxW, y, boxW - 4, b[0], b[1]));
  y += 48;

  const headers = ['Unit #', 'Key #', 'Type', 'RFID', 'Status', 'Current Holder', 'Last Checkout', 'Last Return'];
  const colW = [55, 40, 55, 80, 60, 100, 90, 90];
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setFillColor('#1a1a1a'); doc.setTextColor('#ffffff');
  doc.rect(40, y, pageW - 80, 18, 'F');
  let cx = 40;
  headers.forEach((h, i) => { doc.text(h, cx + 3, y + 13); cx += colW[i]; });
  y += 22; doc.setTextColor('#000');

  for (const k of data.keys) {
    if (y > pageH - 50) { footerStrip(doc, page, totalPages); doc.addPage(); page++; y = headerStrip(doc, 'FLEET KEY MANAGEMENT (cont.)'); }
    const vals = [k.vehicle_number ?? 'N/A', k.key_number ?? '1', k.key_type ?? 'ignition', k.rfid_tag ?? 'N/A', k.status ?? 'N/A', k.current_holder ?? 'N/A', k.last_checkout?.slice(0, 16) ?? 'N/A', k.last_return?.slice(0, 16) ?? 'N/A'];
    if (k.status === 'checked_out') doc.setTextColor('#d4a017');
    else if (k.status === 'lost') doc.setTextColor('#ef4444');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); cx = 40;
    vals.forEach((val, i) => { doc.text(val, cx + 3, y + 12); cx += colW[i]; });
    doc.setTextColor('#000');
    y += 15; rowIdx++;
  }
  footerStrip(doc, page, totalPages);
  doc.save(`fleet_key_management_report_${new Date().toISOString().slice(0, 10)}.pdf`);
}

// ═══════════════════════════════════════════════════════════════
// 13. FLEET HEALTH SCORECARD PDF (Feature 87)
// ═══════════════════════════════════════════════════════════════

export function generateFleetScorecardReport(data: {
  total: number; active: number; in_maintenance: number; needing_service: number;
  expiring_insurance: number; expiring_registration: number; open_recalls: number;
  open_accidents: number; fuel_this_month: { cost: number; gallons: number } | null;
  maintenance_this_month: { cost: number; count: number } | null;
  avg_mpg: number | null; health_score: number;
}): void {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const pageW = doc.internal.pageSize.getWidth();
  let y = headerStrip(doc, 'FLEET HEALTH SCORECARD', `Score: ${data.health_score}/100`);

  // Health score gauge (text-based)
  doc.setFontSize(48); doc.setFont('helvetica', 'bold');
  const scoreColor = data.health_score >= 80 ? '#10b981' : data.health_score >= 60 ? '#d4a017' : '#ef4444';
  doc.setTextColor(scoreColor);
  doc.text(`${data.health_score}`, pageW / 2 - 25, y + 30);
  doc.setTextColor('#000');
  y += 50;

  const boxes: [string, string, boolean?][] = [
    ['Total Vehicles', String(data.total)],
    ['Active', String(data.active)],
    ['In Maintenance', String(data.in_maintenance), data.in_maintenance > 0],
    ['Needing Service', String(data.needing_service), data.needing_service > 0],
    ['Expiring Insurance', String(data.expiring_insurance), data.expiring_insurance > 0],
    ['Expiring Registration', String(data.expiring_registration), data.expiring_registration > 0],
    ['Open Recalls', String(data.open_recalls), data.open_recalls > 0],
    ['Open Accidents', String(data.open_accidents), data.open_accidents > 0],
    ['Fuel Cost (MTD)', `$${data.fuel_this_month?.cost?.toLocaleString() ?? 'N/A'}`],
    ['Fuel Gallons (MTD)', String(data.fuel_this_month?.gallons ?? 'N/A')],
    ['Maint. Cost (MTD)', `$${data.maintenance_this_month?.cost?.toLocaleString() ?? 'N/A'}`],
    ['Avg MPG', String(data.avg_mpg ?? 'N/A')],
  ];
  const boxW = (pageW - 80) / 4;
  boxes.forEach((b, i) => drawGridBox(doc, 40 + (i % 4) * boxW, y + Math.floor(i / 4) * 38, boxW - 4, b[0], b[1], b[2]));
  y += Math.ceil(boxes.length / 4) * 38 + 20;

  // Legend
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(RMPG_GRAY);
  doc.text('Score calculation: 100 - (needing_service*15 + expiring_insurance*10 + expiring_registration*10 + open_recalls*5 + open_accidents*10 + in_maintenance*5) / total', 40, y);

  doc.save(`fleet_health_scorecard_${new Date().toISOString().slice(0, 10)}.pdf`);
}

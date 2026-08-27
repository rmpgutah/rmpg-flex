// ═══════════════════════════════════════════════════════════════
// Fleet PDF Reports — consolidated generator (Features 75-89)
//
// Spillman Flex parity: FORM PS-206 style reports for every fleet
// sub-domain. All generators use the same header/footer pattern
// with NIBRS-style agency banner, vehicle quick-ref, and page
// numbering. Downloaded with deterministic filenames.
// ═══════════════════════════════════════════════════════════════

import jsPDF from 'jspdf';
import { parseTimestamp, safeDateStr, localToday } from '../../../utils/dateUtils';
import type { FleetVehicle, FleetFuelLog, FleetFuelSummary, FleetMaintenance, FleetInspection, FleetAssignment, FleetInsurancePolicy, FleetAnalytics } from '../../../types';
import { registerArialFont } from '../../../utils/pdf/fonts/registerArial';
import { formatEnumValue } from '../../../utils/formatters';

const RMPG_GRAY = '#888888';

// ── Shared helpers ──────────────────────────────────────────

function headerStrip(doc: jsPDF, title: string, subtitle?: string) {
  const m = 40; const w = doc.internal.pageSize.getWidth();
  let y = 40;
  doc.setFont('Arial', 'bold'); doc.setFontSize(16); doc.setTextColor('#000000');
  doc.text('RMPG FLEX — FLEET MANAGEMENT', m, y); y += 18;
  doc.setFontSize(12);
  doc.text(title, m, y);
  if (subtitle) {
    doc.setFont('Arial', 'normal'); doc.setFontSize(9); doc.setTextColor(RMPG_GRAY);
    doc.text(subtitle, w - m, y, { align: 'right' });
    doc.setTextColor('#000000');
  }
  y += 12;
  doc.setDrawColor(0); doc.setLineWidth(1.2); doc.line(m, y, w - m, y); y += 2;
  doc.setLineWidth(0.4); doc.line(m, y, w - m, y); y += 10;
  return y;
}

function footerStrip(doc: jsPDF, page: number, total: number) {
  const w = doc.internal.pageSize.getWidth(); const h = doc.internal.pageSize.getHeight();
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(RMPG_GRAY);
  doc.text(`Page ${page} of ${total}`, 40, h - 25);
  doc.text(`Generated ${new Date().toLocaleString('en-US', { timeZone: 'America/Denver', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`, 40, h - 14);
}

function vehicleSummaryBlock(doc: jsPDF, v: FleetVehicle, y: number): number {
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
  doc.text(`UNIT #${v.vehicle_number}  •  ${[v.year, v.make, v.model].filter(Boolean).join(' ')}  •  ${v.plate_number || 'N/A'}`, 40, y);
  return y + 24;
}

function drawGridBox(doc: jsPDF, x: number, y: number, w: number, label: string, value: string, highlight?: boolean) {
  doc.setDrawColor('#cccccc'); doc.setLineWidth(0.5);
  doc.rect(x, y, w, 32);
  if (highlight) { doc.setDrawColor(0); doc.setLineWidth(2); doc.line(x, y, x + w, y); doc.setLineWidth(0.5); }
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(RMPG_GRAY);
  doc.text(label, x + 5, y + 14);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor('#000');
  doc.text(value, x + 5, y + 27);
}

// ═══════════════════════════════════════════════════════════════
// 1. FLEET STATUS REPORT (Feature 75)
// ═══════════════════════════════════════════════════════════════

export function buildFleetStatusReport(data: {
  vehicles: FleetVehicle[];
  analytics: FleetAnalytics | null;
}): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  registerArialFont(doc); // Arial-only output (overrides helvetica/times/courier)
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  let y = headerStrip(doc, 'FLEET STATUS REPORT', `Total Units: ${data.vehicles.length}  •  Active: ${data.vehicles.filter(v => v.status === 'in_service').length}`);
  // REGRESSION-GUARD: Math.max(1,...) prevents "Page 1 of 0" on an empty fleet
  const totalPages = Math.max(1, Math.ceil(data.vehicles.length / 25));
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
  doc.setFont('Arial', 'bold'); doc.setFontSize(9); doc.setTextColor('#000000');
  doc.setDrawColor(150); doc.setLineWidth(0.5); doc.line(40, y + 16, pageW - 40, y + 16);
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
  return doc;
}

export function generateFleetStatusReport(data: {
  vehicles: FleetVehicle[];
  analytics: FleetAnalytics | null;
}): void {
  const doc = buildFleetStatusReport(data);
  doc.save(`fleet_status_report_${localToday()}.pdf`);
}

// ═══════════════════════════════════════════════════════════════
// 2. FLEET MAINTENANCE HISTORY REPORT (Feature 76)
// ═══════════════════════════════════════════════════════════════

export function buildFleetMaintenanceReport(data: {
  vehicle: FleetVehicle;
  records: FleetMaintenance[];
}): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  registerArialFont(doc); // Arial-only output (overrides helvetica/times/courier)
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
  doc.setFont('Arial', 'bold'); doc.setFontSize(9); doc.setTextColor('#000000');
  doc.setDrawColor(150); doc.setLineWidth(0.5); doc.line(40, y + 16, pageW - 40, y + 16);
  let cx = 40;
  headers.forEach((h, i) => { doc.text(h, cx + 3, y + 13); cx += colW[i]; });
  y += 22; doc.setTextColor('#000');

  for (const r of data.records) {
    if (y > pageH - 60) { footerStrip(doc, page, totalPages); doc.addPage(); page++; y = headerStrip(doc, 'MAINTENANCE HISTORY REPORT (cont.)'); }
    const vals = [safeDateStr(r.performed_at, ''), r.type ?? '', r.description?.slice(0, 40) ?? '', String(r.mileage_at_service ?? ''), `$${r.cost ?? 0}`, r.vendor?.slice(0, 20) ?? '', safeDateStr(r.next_due_date, '')];
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); cx = 40;
    vals.forEach((val, i) => { doc.text(val, cx + 3, y + 12); cx += colW[i]; });
    y += 15; rowIdx++;
  }

  footerStrip(doc, page, totalPages);
  return doc;
}

export function generateFleetMaintenanceReport(data: {
  vehicle: FleetVehicle;
  records: FleetMaintenance[];
}): void {
  const doc = buildFleetMaintenanceReport(data);
  doc.save(`fleet_maintenance_${data.vehicle.vehicle_number}_${localToday()}.pdf`);
}

// ═══════════════════════════════════════════════════════════════
// 3. FLEET COST ANALYSIS REPORT (Feature 77)
// ═══════════════════════════════════════════════════════════════

export function buildFleetCostReport(data: {
  vehicle: FleetVehicle;
  fuelLogs: FleetFuelLog[];
  fuelSummary: FleetFuelSummary | null;
  maintenanceRecords: FleetMaintenance[];
}): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  registerArialFont(doc); // Arial-only output (overrides helvetica/times/courier)
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

  return doc;
}

export function generateFleetCostReport(data: {
  vehicle: FleetVehicle;
  fuelLogs: FleetFuelLog[];
  fuelSummary: FleetFuelSummary | null;
  maintenanceRecords: FleetMaintenance[];
}): void {
  const doc = buildFleetCostReport(data);
  doc.save(`fleet_cost_analysis_${data.vehicle.vehicle_number}_${localToday()}.pdf`);
}

// ═══════════════════════════════════════════════════════════════
// 4. FLEET LIFECYCLE REPORT (Feature 78)
// ═══════════════════════════════════════════════════════════════

export function buildFleetLifecycleReport(data: {
  vehicle: FleetVehicle;
  fuelLogs: FleetFuelLog[];
  maintenanceRecords: FleetMaintenance[];
  inspections: FleetInspection[];
  assignments: FleetAssignment[];
}): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  registerArialFont(doc); // Arial-only output (overrides helvetica/times/courier)
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
  doc.setFont('Arial', 'bold'); doc.setFontSize(9); doc.setTextColor('#000000');
  doc.setDrawColor(150); doc.setLineWidth(0.5); doc.line(40, y + 16, pageW - 40, y + 16);
  let cx = 40;
  maintHeaders.forEach((h, i) => { doc.text(h, cx + 3, y + 13); cx += maintColW[i]; });
  y += 22; doc.setTextColor('#000');

  let rowIdx = 0;
  for (const r of data.maintenanceRecords) {
    if (y > pageH - 60) { footerStrip(doc, page, totalPages); doc.addPage(); page++; y = headerStrip(doc, 'VEHICLE LIFECYCLE REPORT (cont.)'); }
    const vals = [safeDateStr(r.performed_at, ''), r.type ?? '', (r.description ?? '').slice(0, 40), String(r.mileage_at_service ?? ''), `$${r.cost ?? 0}`, (r.vendor ?? '').slice(0, 20)];
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); cx = 40;
    vals.forEach((v, i) => { doc.text(v, cx + 3, y + 12); cx += maintColW[i]; });
    y += 15; rowIdx++;
  }

  footerStrip(doc, page, totalPages);
  return doc;
}

export function generateFleetLifecycleReport(data: {
  vehicle: FleetVehicle;
  fuelLogs: FleetFuelLog[];
  maintenanceRecords: FleetMaintenance[];
  inspections: FleetInspection[];
  assignments: FleetAssignment[];
}): void {
  const doc = buildFleetLifecycleReport(data);
  doc.save(`fleet_lifecycle_${data.vehicle.vehicle_number}_${localToday()}.pdf`);
}

// ═══════════════════════════════════════════════════════════════
// 5. FLEET COMPLIANCE REPORT (Feature 79)
// ═══════════════════════════════════════════════════════════════

export function buildFleetComplianceReport(data: {
  vehicles: FleetVehicle[];
}): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' });
  registerArialFont(doc); // Arial-only output (overrides helvetica/times/courier)
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  let y = headerStrip(doc, 'FLEET COMPLIANCE REPORT', `Generated: ${localToday()}`);
  const totalPages = Math.max(1, Math.ceil(data.vehicles.length / 20));
  let page = 1; let rowIdx = 0;

  // Count compliance issues
  const expiredIns = data.vehicles.filter(v => v.insurance_expiry && parseTimestamp(v.insurance_expiry) < new Date()).length;
  const expiredReg = data.vehicles.filter(v => v.registration_expiry && parseTimestamp(v.registration_expiry) < new Date()).length;
  const needingService = data.vehicles.filter(v => v.next_service_due && parseTimestamp(v.next_service_due) < new Date()).length;

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
  doc.setFont('Arial', 'bold'); doc.setFontSize(9); doc.setTextColor('#000000');
  doc.setDrawColor(150); doc.setLineWidth(0.5); doc.line(40, y + 16, pageW - 40, y + 16);
  let cx = 40;
  headers.forEach((h, i) => { doc.text(h, cx + 3, y + 13); cx += colW[i]; });
  y += 22; doc.setTextColor('#000');

  for (const v of data.vehicles) {
    if (y > pageH - 50) { footerStrip(doc, page, totalPages); doc.addPage(); page++; y = headerStrip(doc, 'FLEET COMPLIANCE REPORT (cont.)'); }
    const vals = [v.vehicle_number, `${v.year ?? ''} ${v.make ?? ''} ${v.model ?? ''}`.trim(), v.plate_number ?? '', v.status ?? '', v.insurance_expiry?.slice(0, 10) ?? '', v.registration_expiry?.slice(0, 10) ?? '', v.last_service_date?.slice(0, 10) ?? '', v.next_service_due?.slice(0, 10) ?? ''];
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); cx = 40;
    vals.forEach((val, i) => {
      const expiredDate = (i === 4 || i === 5 || i === 7) && val ? new Date(val) : null;
      const expired = !!expiredDate && !isNaN(expiredDate.getTime()) && expiredDate < new Date();
      if (expired) doc.setTextColor('#ef4444');
      doc.text(val, cx + 3, y + 12);
      if (expired) doc.setTextColor('#000');
      cx += colW[i];
    });
    y += 15; rowIdx++;
  }

  footerStrip(doc, page, totalPages);
  return doc;
}

export function generateFleetComplianceReport(data: {
  vehicles: FleetVehicle[];
}): void {
  const doc = buildFleetComplianceReport(data);
  doc.save(`fleet_compliance_report_${localToday()}.pdf`);
}

// ═══════════════════════════════════════════════════════════════
// 6. FLEET UTILIZATION REPORT (Feature 80)
// ═══════════════════════════════════════════════════════════════

export function buildFleetUtilizationReport(data: {
  vehicles: Array<FleetVehicle & { days_used?: number; miles_driven?: number; fuel_cost?: number; daily_avg_miles?: number }>;
  days?: number;
}): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' });
  registerArialFont(doc); // Arial-only output (overrides helvetica/times/courier)
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  let y = headerStrip(doc, 'FLEET UTILIZATION REPORT', `Last ${data.days ?? 30} Days`);
  const totalPages = Math.max(1, Math.ceil(data.vehicles.length / 22));
  let page = 1; let rowIdx = 0;

  const headers = ['Unit #', 'Yr/Make/Model', 'Days Used', 'Miles', 'Fuel Cost', 'Daily Avg Mi', 'Status'];
  const colW = [55, 160, 60, 60, 70, 70, 80];
  doc.setFont('Arial', 'bold'); doc.setFontSize(9); doc.setTextColor('#000000');
  doc.setDrawColor(150); doc.setLineWidth(0.5); doc.line(40, y + 16, pageW - 40, y + 16);
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
  return doc;
}

export function generateFleetUtilizationReport(data: {
  vehicles: Array<FleetVehicle & { days_used?: number; miles_driven?: number; fuel_cost?: number; daily_avg_miles?: number }>;
  days?: number;
}): void {
  const doc = buildFleetUtilizationReport(data);
  doc.save(`fleet_utilization_report_${localToday()}.pdf`);
}

// ═══════════════════════════════════════════════════════════════
// 7. FLEET FUEL CONSUMPTION REPORT (Feature 81)
// ═══════════════════════════════════════════════════════════════

export function buildFleetFuelConsumptionReport(data: {
  vehicles: Array<FleetVehicle & { total_gallons?: number; co2_kg?: number; co2_lbs?: number }>;
  totalGallons?: number;
  totalCo2?: number;
}): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' });
  registerArialFont(doc); // Arial-only output (overrides helvetica/times/courier)
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  let y = headerStrip(doc, 'FLEET FUEL CONSUMPTION & EMISSIONS REPORT');
  const totalPages = Math.max(1, Math.ceil(data.vehicles.length / 22));
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
  doc.setFont('Arial', 'bold'); doc.setFontSize(9); doc.setTextColor('#000000');
  doc.setDrawColor(150); doc.setLineWidth(0.5); doc.line(40, y + 16, pageW - 40, y + 16);
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
  return doc;
}

export function generateFleetFuelConsumptionReport(data: {
  vehicles: Array<FleetVehicle & { total_gallons?: number; co2_kg?: number; co2_lbs?: number }>;
  totalGallons?: number;
  totalCo2?: number;
}): void {
  const doc = buildFleetFuelConsumptionReport(data);
  doc.save(`fleet_fuel_consumption_report_${localToday()}.pdf`);
}

// ═══════════════════════════════════════════════════════════════
// 8. FLEET ACCIDENT REPORT (Feature 82)
// ═══════════════════════════════════════════════════════════════

export function buildFleetAccidentReport(data: {
  vehicle: FleetVehicle;
  accident: Record<string, unknown>;
}): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  registerArialFont(doc); // Arial-only output (overrides helvetica/times/courier)
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

  return doc;
}

export function generateFleetAccidentReport(data: {
  vehicle: FleetVehicle;
  accident: Record<string, unknown>;
}): void {
  const doc = buildFleetAccidentReport(data);
  doc.save(`fleet_accident_report_${data.vehicle.vehicle_number}_${localToday()}.pdf`);
}

// ═══════════════════════════════════════════════════════════════
// 9. FLEET BUDGET REPORT (Feature 83)
// ═══════════════════════════════════════════════════════════════

export function buildFleetBudgetReport(data: {
  fiscalYear: number;
  budgets: Array<{ category: string; allocated_amount: number; spent_amount: number }>;
}): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  registerArialFont(doc); // Arial-only output (overrides helvetica/times/courier)
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
    doc.text(formatEnumValue(b.category), 40, y);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    doc.text(`$${b.spent_amount.toLocaleString()} of $${b.allocated_amount.toLocaleString()} (${pct}%)`, 160, y);
    if (pct > 90) doc.setTextColor('#ef4444'); else if (pct > 70) doc.setTextColor('#d4a017'); else doc.setTextColor('#10b981');
    doc.setFillColor(pct > 90 ? '#ef4444' : pct > 70 ? '#d4a017' : '#10b981');
    doc.rect(40, y + 4, barW, 10, 'F');
    doc.setTextColor('#000');
    y += 22;
  }

  return doc;
}

export function generateFleetBudgetReport(data: {
  fiscalYear: number;
  budgets: Array<{ category: string; allocated_amount: number; spent_amount: number }>;
}): void {
  const doc = buildFleetBudgetReport(data);
  doc.save(`fleet_budget_report_fy${data.fiscalYear}.pdf`);
}

// ═══════════════════════════════════════════════════════════════
// 10. FLEET VEHICLE REPLACEMENT PLAN REPORT (Feature 84)
// ═══════════════════════════════════════════════════════════════

export function buildFleetReplacementReport(data: {
  vehicles: Array<FleetVehicle & { replacement_year?: number; replacement_reason?: string; estimated_replacement_cost?: number; rp_priority?: string; rp_status?: string }>;
}): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' });
  registerArialFont(doc); // Arial-only output (overrides helvetica/times/courier)
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  let y = headerStrip(doc, 'FLEET REPLACEMENT PLAN', `Projected Replacements`);
  const totalPages = Math.max(1, Math.ceil(data.vehicles.length / 20));
  let page = 1; let rowIdx = 0;

  const headers = ['Unit #', 'Yr/Make/Model', 'Mileage', 'Repl Year', 'Priority', 'Est. Cost', 'Reason', 'Status'];
  const colW = [50, 150, 55, 55, 55, 65, 120, 60];
  doc.setFont('Arial', 'bold'); doc.setFontSize(9); doc.setTextColor('#000000');
  doc.setDrawColor(150); doc.setLineWidth(0.5); doc.line(40, y + 16, pageW - 40, y + 16);
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
  return doc;
}

export function generateFleetReplacementReport(data: {
  vehicles: Array<FleetVehicle & { replacement_year?: number; replacement_reason?: string; estimated_replacement_cost?: number; rp_priority?: string; rp_status?: string }>;
}): void {
  const doc = buildFleetReplacementReport(data);
  doc.save(`fleet_replacement_plan_${localToday()}.pdf`);
}

// ═══════════════════════════════════════════════════════════════
// 11. FLEET DEPRECIATION REPORT (Feature 85)
// ═══════════════════════════════════════════════════════════════

export function buildFleetDepreciationReport(data: {
  vehicles: Array<FleetVehicle & { depreciation?: { purchase_price?: number; salvage_value?: number; useful_life_months?: number; monthly_depreciation?: number; accumulated_depreciation?: number; current_book_value?: number } | null }>;
}): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' });
  registerArialFont(doc); // Arial-only output (overrides helvetica/times/courier)
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  let y = headerStrip(doc, 'FLEET DEPRECIATION SCHEDULE');
  const totalPages = Math.max(1, Math.ceil(data.vehicles.length / 20));
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
  doc.setFont('Arial', 'bold'); doc.setFontSize(9); doc.setTextColor('#000000');
  doc.setDrawColor(150); doc.setLineWidth(0.5); doc.line(40, y + 16, pageW - 40, y + 16);
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
  return doc;
}

export function generateFleetDepreciationReport(data: {
  vehicles: Array<FleetVehicle & { depreciation?: { purchase_price?: number; salvage_value?: number; useful_life_months?: number; monthly_depreciation?: number; accumulated_depreciation?: number; current_book_value?: number } | null }>;
}): void {
  const doc = buildFleetDepreciationReport(data);
  doc.save(`fleet_depreciation_report_${localToday()}.pdf`);
}

// ═══════════════════════════════════════════════════════════════
// 12. FLEET KEY MANAGEMENT REPORT (Feature 86)
// ═══════════════════════════════════════════════════════════════

export function buildFleetKeyReport(data: {
  keys: Array<{ vehicle_number?: string; key_number?: string; key_type?: string; rfid_tag?: string; status?: string; current_holder?: string; last_checkout?: string; last_return?: string }>;
}): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' });
  registerArialFont(doc); // Arial-only output (overrides helvetica/times/courier)
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  let y = headerStrip(doc, 'FLEET KEY MANAGEMENT REPORT');
  const totalPages = Math.max(1, Math.ceil(data.keys.length / 25));
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
  doc.setFont('Arial', 'bold'); doc.setFontSize(9); doc.setTextColor('#000000');
  doc.setDrawColor(150); doc.setLineWidth(0.5); doc.line(40, y + 16, pageW - 40, y + 16);
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
  return doc;
}

export function generateFleetKeyReport(data: {
  keys: Array<{ vehicle_number?: string; key_number?: string; key_type?: string; rfid_tag?: string; status?: string; current_holder?: string; last_checkout?: string; last_return?: string }>;
}): void {
  const doc = buildFleetKeyReport(data);
  doc.save(`fleet_key_management_report_${localToday()}.pdf`);
}

// ═══════════════════════════════════════════════════════════════
// 13. FLEET HEALTH SCORECARD PDF (Feature 87)
// ═══════════════════════════════════════════════════════════════

export function buildFleetScorecardReport(data: {
  total: number; active: number; in_maintenance: number; needing_service: number;
  expiring_insurance: number; expiring_registration: number; open_recalls: number;
  open_accidents: number; fuel_this_month: { cost: number; gallons: number } | null;
  maintenance_this_month: { cost: number; count: number } | null;
  avg_mpg: number | null; health_score: number;
}): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  registerArialFont(doc); // Arial-only output (overrides helvetica/times/courier)
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

  return doc;
}

export function generateFleetScorecardReport(data: {
  total: number; active: number; in_maintenance: number; needing_service: number;
  expiring_insurance: number; expiring_registration: number; open_recalls: number;
  open_accidents: number; fuel_this_month: { cost: number; gallons: number } | null;
  maintenance_this_month: { cost: number; count: number } | null;
  avg_mpg: number | null; health_score: number;
}): void {
  const doc = buildFleetScorecardReport(data);
  doc.save(`fleet_health_scorecard_${localToday()}.pdf`);
}

// ═══════════════════════════════════════════════════════════════
// 14. FLEET PERSONNEL PRODUCTIVITY REPORT
// ═══════════════════════════════════════════════════════════════
// Shows assignment density, miles driven, and time-on-vehicle per
// officer. The classic "who is using which vehicle, and how much?"
// analysis — supports both internal fleet users and contracted officers.

interface PersonnelRow {
  officer_id?: string;
  officer_name?: string;
  call_sign?: string;
  vehicle_number?: string;
  vehicle_label?: string;
  total_assignments: number;
  total_miles: number;
  total_hours: number;
  active_assignments: number;
}

export function buildPersonnelProductivityReport(data: {
  rows: PersonnelRow[];
  totalOfficers?: number;
  totalMiles?: number;
  totalHours?: number;
  days?: number;
}): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' });
  registerArialFont(doc); // Arial-only output (overrides helvetica/times/courier)
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  let y = headerStrip(doc, 'PERSONNEL PRODUCTIVITY REPORT',
    `${data.rows.length} officers  •  ${data.days ?? 30}-day window  •  Generated ${new Date().toLocaleDateString('en-US', { timeZone: 'America/Denver' })}`);

  const totalPages = Math.max(1, Math.ceil(data.rows.length / 18));
  let page = 1;

  // Summary grid
  const boxes: [string, string, boolean?][] = [
    ['Officers', String(data.rows.length)],
    ['Total Miles', String(Math.round(data.totalMiles ?? 0)), true],
    ['Total Hours', String(Math.round(data.totalHours ?? 0))],
    ['Avg Miles / Officer', data.rows.length ? String(Math.round((data.totalMiles ?? 0) / data.rows.length)) : '0'],
    ['Avg Hours / Officer', data.rows.length ? String(Math.round((data.totalHours ?? 0) / data.rows.length)) : '0'],
  ];
  const boxW = (pageW - 80) / boxes.length;
  boxes.forEach((b, i) => drawGridBox(doc, 40 + i * boxW, y, boxW - 4, b[0], b[1], b[2]));
  y += 48;

  // Header
  const headers = ['Officer', 'Call Sign', 'Vehicles Used', 'Assignments', 'Active', 'Miles', 'Hours'];
  const colW = [180, 80, 150, 80, 60, 80, 80];
  doc.setFont('Arial', 'bold'); doc.setFontSize(9); doc.setTextColor('#000000');
  doc.setDrawColor(150); doc.setLineWidth(0.5); doc.line(40, y + 16, pageW - 40, y + 16);
  let cx = 40;
  headers.forEach((h, i) => { doc.text(h, cx + 3, y + 13); cx += colW[i]; });
  y += 22; doc.setTextColor('#000');

  for (const r of data.rows) {
    if (y > pageH - 50) { footerStrip(doc, page, totalPages); doc.addPage(); page++; y = headerStrip(doc, 'PERSONNEL PRODUCTIVITY (cont.)'); }
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); cx = 40;
    const vals = [
      r.officer_name || '-',
      r.call_sign || '-',
      r.vehicle_label || '-',
      String(r.total_assignments),
      String(r.active_assignments),
      r.total_miles.toLocaleString(),
      r.total_hours.toFixed(1),
    ];
    vals.forEach((val, i) => { doc.text(val, cx + 3, y + 12); cx += colW[i]; });
    y += 15;
  }

  footerStrip(doc, page, totalPages);
  return doc;
}

export function generatePersonnelProductivityReport(data: {
  rows: PersonnelRow[];
  totalOfficers?: number;
  totalMiles?: number;
  totalHours?: number;
  days?: number;
}): void {
  const doc = buildPersonnelProductivityReport(data);
  doc.save(`personnel_productivity_report_${localToday()}.pdf`);
}

// ═══════════════════════════════════════════════════════════════
// 15. FLEET INSPECTION ANALYSIS REPORT
// ═══════════════════════════════════════════════════════════════
// Pulls pass/fail rates, common item failures, and per-vehicle
// compliance. Helps managers spot vehicles with chronic issues.

interface InspectionAnalysisRow {
  vehicle_number: string;
  vehicle_label?: string;
  total: number;
  passed: number;
  failed: number;
  pass_rate: number;
  last_inspection_date?: string;
  last_result?: 'pass' | 'fail';
  common_failures?: string[];
}

export function buildInspectionAnalysisReport(data: {
  rows: InspectionAnalysisRow[];
  totalInspections?: number;
  overallPassRate?: number;
}): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  registerArialFont(doc); // Arial-only output (overrides helvetica/times/courier)
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  let y = headerStrip(doc, 'INSPECTION ANALYSIS REPORT',
    `${data.rows.length} vehicles  •  ${data.totalInspections ?? 0} inspections  •  Generated ${new Date().toLocaleDateString('en-US', { timeZone: 'America/Denver' })}`);
  const totalPages = Math.max(1, Math.ceil(data.rows.length / 22));
  let page = 1;

  // Summary
  const boxes: [string, string, boolean?][] = [
    ['Vehicles Inspected', String(data.rows.length)],
    ['Total Inspections', String(data.totalInspections ?? 0), true],
    ['Overall Pass Rate', `${(data.overallPassRate ?? 0).toFixed(1)}%`],
    ['Failing Vehicles', String(data.rows.filter(r => r.pass_rate < 80).length)],
  ];
  const boxW = (pageW - 80) / boxes.length;
  boxes.forEach((b, i) => drawGridBox(doc, 40 + i * boxW, y, boxW - 4, b[0], b[1], b[2]));
  y += 48;

  // Header
  const headers = ['Unit #', 'Vehicle', 'Inspections', 'Passed', 'Failed', 'Pass %', 'Last Date', 'Last Result'];
  const colW = [55, 130, 60, 50, 50, 55, 75, 60];
  doc.setFont('Arial', 'bold'); doc.setFontSize(9); doc.setTextColor('#000000');
  doc.setDrawColor(150); doc.setLineWidth(0.5); doc.line(40, y + 16, pageW - 40, y + 16);
  let cx = 40;
  headers.forEach((h, i) => { doc.text(h, cx + 3, y + 13); cx += colW[i]; });
  y += 22; doc.setTextColor('#000');

  for (const r of data.rows) {
    if (y > pageH - 50) { footerStrip(doc, page, totalPages); doc.addPage(); page++; y = headerStrip(doc, 'INSPECTION ANALYSIS (cont.)'); }
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); cx = 40;
    const resultColor = r.last_result === 'pass' ? [22, 163, 74] : r.last_result === 'fail' ? [239, 68, 68] : [0, 0, 0];
    const vals: Array<{ text: string; color?: [number, number, number] }> = [
      { text: r.vehicle_number },
      { text: r.vehicle_label || '-' },
      { text: String(r.total) },
      { text: String(r.passed) },
      { text: String(r.failed) },
      { text: `${r.pass_rate.toFixed(0)}%`, color: r.pass_rate >= 90 ? [22, 163, 74] : r.pass_rate >= 70 ? [245, 158, 11] : [239, 68, 68] },
      { text: r.last_inspection_date || '-' },
      { text: r.last_result?.toUpperCase() || '-', color: resultColor as [number, number, number] },
    ];
    vals.forEach((v, i) => {
      if (v.color) doc.setTextColor(v.color[0], v.color[1], v.color[2]);
      else doc.setTextColor(0, 0, 0);
      doc.text(v.text, cx + 3, y + 12);
      cx += colW[i];
    });
    y += 15;
  }

  // Common failure items table
  if (y > pageH - 90) { footerStrip(doc, page, totalPages); doc.addPage(); page++; y = headerStrip(doc, 'INSPECTION ANALYSIS (cont.)'); }
  const allFailures = new Map<string, number>();
  for (const r of data.rows) {
    for (const f of r.common_failures || []) {
      allFailures.set(f, (allFailures.get(f) ?? 0) + 1);
    }
  }
  if (allFailures.size > 0) {
    y += 10;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
    doc.text('MOST COMMON FAILURE ITEMS', 40, y);
    y += 4;
    doc.setDrawColor('#1a1a1a'); doc.setLineWidth(0.5);
    doc.line(40, y, pageW - 40, y);
    y += 14;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
    doc.text('Item', 40, y);
    doc.text('Count', 350, y);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    y += 12;
    const sortedFailures = [...allFailures].sort((a, b) => b[1] - a[1]);
    for (const [item, count] of sortedFailures) {
      if (y > pageH - 40) { footerStrip(doc, page, totalPages); doc.addPage(); page++; y = headerStrip(doc, 'INSPECTION ANALYSIS (cont.)'); }
      doc.text(item, 40, y);
      doc.text(String(count), 350, y);
      y += 12;
    }
  }

  footerStrip(doc, page, totalPages);
  return doc;
}

export function generateInspectionAnalysisReport(data: {
  rows: InspectionAnalysisRow[];
  totalInspections?: number;
  overallPassRate?: number;
}): void {
  const doc = buildInspectionAnalysisReport(data);
  doc.save(`fleet_inspection_analysis_${localToday()}.pdf`);
}

// ═══════════════════════════════════════════════════════════════
// 16. FLEET COST-PER-MILE BREAKDOWN REPORT
// ═══════════════════════════════════════════════════════════════
// Per-vehicle cost-per-mile analysis: total cost, miles, $/mi, MPG,
// ranking. The spreadsheet managers ask for first when justifying
// vehicle replacement.

interface CostPerMileRow {
  vehicle_number: string;
  vehicle_label?: string;
  year?: number;
  current_mileage: number;
  total_cost: number;
  fuel_cost: number;
  maintenance_cost: number;
  insurance_cost?: number;
  miles_driven?: number;
  cost_per_mile: number;
  mpg: number | null;
}

export function buildCostPerMileReport(data: {
  rows: CostPerMileRow[];
  fleetAverageCpm?: number;
  totalCost?: number;
}): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' });
  registerArialFont(doc); // Arial-only output (overrides helvetica/times/courier)
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  let y = headerStrip(doc, 'COST-PER-MILE ANALYSIS REPORT',
    `${data.rows.length} vehicles  •  Fleet Avg: $${(data.fleetAverageCpm ?? 0).toFixed(3)}/mi  •  Generated ${new Date().toLocaleDateString('en-US', { timeZone: 'America/Denver' })}`);
  const totalPages = Math.max(1, Math.ceil(data.rows.length / 18));
  let page = 1;

  // Summary
  const boxes: [string, string, boolean?][] = [
    ['Vehicles', String(data.rows.length)],
    ['Total Cost', `$${Math.round(data.totalCost ?? 0).toLocaleString()}`, true],
    ['Fleet Avg $/mi', `$${(data.fleetAverageCpm ?? 0).toFixed(3)}`],
    ['Most Expensive', data.rows.length ? `$${data.rows[0].cost_per_mile.toFixed(3)}/mi` : '-'],
    ['Most Efficient', data.rows.length ? `$${data.rows[data.rows.length - 1].cost_per_mile.toFixed(3)}/mi` : '-'],
  ];
  const boxW = (pageW - 80) / boxes.length;
  boxes.forEach((b, i) => drawGridBox(doc, 40 + i * boxW, y, boxW - 4, b[0], b[1], b[2]));
  y += 48;

  const headers = ['Rank', 'Unit #', 'Vehicle', 'Yr', 'Mileage', 'Total Cost', 'Fuel', 'Maint.', '$/Mile', 'MPG'];
  const colW = [40, 55, 180, 35, 70, 80, 70, 70, 60, 50];
  doc.setFont('Arial', 'bold'); doc.setFontSize(9); doc.setTextColor('#000000');
  doc.setDrawColor(150); doc.setLineWidth(0.5); doc.line(40, y + 16, pageW - 40, y + 16);
  let cx = 40;
  headers.forEach((h, i) => { doc.text(h, cx + 3, y + 13); cx += colW[i]; });
  y += 22; doc.setTextColor('#000');

  // Sort by cost_per_mile desc (most expensive first)
  const sorted = [...data.rows].sort((a, b) => b.cost_per_mile - a.cost_per_mile);
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    if (y > pageH - 50) { footerStrip(doc, page, totalPages); doc.addPage(); page++; y = headerStrip(doc, 'COST-PER-MILE (cont.)'); }
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); cx = 40;
    const vals = [
      String(i + 1),
      r.vehicle_number,
      r.vehicle_label || '-',
      String(r.year ?? '-'),
      r.current_mileage.toLocaleString(),
      `$${Math.round(r.total_cost).toLocaleString()}`,
      `$${Math.round(r.fuel_cost).toLocaleString()}`,
      `$${Math.round(r.maintenance_cost).toLocaleString()}`,
      `$${r.cost_per_mile.toFixed(3)}`,
      r.mpg != null ? r.mpg.toFixed(1) : '-',
    ];
    vals.forEach((val, j) => { doc.text(val, cx + 3, y + 12); cx += colW[j]; });
    y += 15;
  }

  footerStrip(doc, page, totalPages);
  return doc;
}

export function generateCostPerMileReport(data: {
  rows: CostPerMileRow[];
  fleetAverageCpm?: number;
  totalCost?: number;
}): void {
  const doc = buildCostPerMileReport(data);
  doc.save(`fleet_cost_per_mile_${localToday()}.pdf`);
}

// ═══════════════════════════════════════════════════════════════
// 17. FLEET MAINTENANCE FORECAST REPORT
// ═══════════════════════════════════════════════════════════════
// Vehicles due for service, ranked by urgency.  Shows days / miles
// remaining and historical cost-per-mile to flag expensive units.

interface MaintenanceForecastRow {
  vehicle_number: string;
  vehicle_label?: string;
  current_mileage: number;
  next_service_mileage: number;
  miles_until_service: number;
  avg_daily_miles: number;
  est_days_until_service: number | null;
  last_service_date?: string;
  last_service_cost?: number;
  urgency: 'overdue' | 'critical' | 'warning' | 'ok';
}

export function buildMaintenanceForecastReport(data: {
  rows: MaintenanceForecastRow[];
  overdueCount?: number;
  upcomingCount?: number;
}): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  registerArialFont(doc); // Arial-only output (overrides helvetica/times/courier)
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  let y = headerStrip(doc, 'MAINTENANCE FORECAST REPORT',
    `${data.rows.length} vehicles  •  ${data.overdueCount ?? 0} overdue  •  Generated ${new Date().toLocaleDateString('en-US', { timeZone: 'America/Denver' })}`);
  const totalPages = Math.max(1, Math.ceil(data.rows.length / 22));
  let page = 1;

  // Summary
  const boxes: [string, string, boolean?][] = [
    ['Vehicles', String(data.rows.length)],
    ['Overdue', String(data.overdueCount ?? data.rows.filter(r => r.urgency === 'overdue').length), true],
    ['Due in <7d', String(data.rows.filter(r => r.urgency === 'critical').length)],
    ['Due in <30d', String(data.rows.filter(r => r.urgency === 'warning').length)],
  ];
  const boxW = (pageW - 80) / boxes.length;
  boxes.forEach((b, i) => drawGridBox(doc, 40 + i * boxW, y, boxW - 4, b[0], b[1], b[2]));
  y += 48;

  const headers = ['Unit #', 'Vehicle', 'Current Mileage', 'Next Service', 'Miles Left', 'Avg Daily', 'Est Days', 'Urgency'];
  const colW = [50, 145, 80, 80, 60, 60, 50, 60];
  doc.setFont('Arial', 'bold'); doc.setFontSize(9); doc.setTextColor('#000000');
  doc.setDrawColor(150); doc.setLineWidth(0.5); doc.line(40, y + 16, pageW - 40, y + 16);
  let cx = 40;
  headers.forEach((h, i) => { doc.text(h, cx + 3, y + 13); cx += colW[i]; });
  y += 22; doc.setTextColor('#000');

  const urgencyOrder = { overdue: 0, critical: 1, warning: 2, ok: 3 };
  const sorted = [...data.rows].sort((a, b) =>
    (urgencyOrder[a.urgency] - urgencyOrder[b.urgency]) || (a.miles_until_service - b.miles_until_service),
  );
  for (const r of sorted) {
    if (y > pageH - 50) { footerStrip(doc, page, totalPages); doc.addPage(); page++; y = headerStrip(doc, 'MAINTENANCE FORECAST (cont.)'); }
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); cx = 40;
    const urgencyColor: [number, number, number] =
      r.urgency === 'overdue' ? [239, 68, 68]
      : r.urgency === 'critical' ? [245, 158, 11]
      : r.urgency === 'warning' ? [251, 191, 36]
      : [22, 163, 74];
    const urgencyLabel = r.urgency === 'overdue' ? 'OVERDUE' : r.urgency === 'critical' ? '< 7 DAYS' : r.urgency === 'warning' ? '< 30 DAYS' : 'OK';
    const vals: Array<{ text: string; color?: [number, number, number] }> = [
      { text: r.vehicle_number },
      { text: r.vehicle_label || '-' },
      { text: r.current_mileage.toLocaleString() },
      { text: r.next_service_mileage.toLocaleString() },
      { text: r.miles_until_service.toLocaleString() },
      { text: r.avg_daily_miles.toFixed(1) },
      { text: r.est_days_until_service?.toString() || '-' },
      { text: urgencyLabel, color: urgencyColor },
    ];
    vals.forEach((v, i) => {
      if (v.color) doc.setTextColor(v.color[0], v.color[1], v.color[2]);
      else doc.setTextColor(0, 0, 0);
      doc.text(v.text, cx + 3, y + 12);
      cx += colW[i];
    });
    y += 15;
  }

  footerStrip(doc, page, totalPages);
  return doc;
}

export function generateMaintenanceForecastReport(data: {
  rows: MaintenanceForecastRow[];
  overdueCount?: number;
  upcomingCount?: number;
}): void {
  const doc = buildMaintenanceForecastReport(data);
  doc.save(`fleet_maintenance_forecast_${localToday()}.pdf`);
}

// ═══════════════════════════════════════════════════════════════
// 18. FLEET COMPLIANCE AUDIT REPORT
// ═══════════════════════════════════════════════════════════════
// Single-pane audit: insurance, registration, inspections, recalls,
// overdue maintenance.  Color-coded urgency per item.

interface ComplianceRow {
  vehicle_number: string;
  vehicle_label?: string;
  insurance_status: 'valid' | 'expiring' | 'expired';
  insurance_expiry?: string;
  registration_status: 'valid' | 'expiring' | 'expired';
  registration_expiry?: string;
  inspection_status: 'valid' | 'expiring' | 'expired';
  inspection_expiry?: string;
  open_recalls: number;
  overdue_service: number;
  compliance_score: number;
}

export function buildComplianceAuditReport(data: {
  rows: ComplianceRow[];
  totalVehicles?: number;
  fullyCompliant?: number;
  issuesCount?: number;
}): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' });
  registerArialFont(doc); // Arial-only output (overrides helvetica/times/courier)
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  let y = headerStrip(doc, 'COMPLIANCE AUDIT REPORT',
    `${data.rows.length} vehicles  •  Generated ${new Date().toLocaleDateString('en-US', { timeZone: 'America/Denver' })}`);
  const totalPages = Math.max(1, Math.ceil(data.rows.length / 18));
  let page = 1;

  // Summary
  const avgScore = data.rows.length
    ? `${(data.rows.reduce((s, r) => s + r.compliance_score, 0) / data.rows.length).toFixed(0)}%`
    : 'N/A';
  const issuesCount = data.issuesCount ?? data.rows.length - (data.fullyCompliant ?? 0);
  const boxes: [string, string, boolean?][] = [
    ['Vehicles', String(data.rows.length)],
    ['Fully Compliant', String(data.fullyCompliant ?? 0), true],
    ['With Issues', String(issuesCount)],
    ['Avg Score', avgScore],
  ];
  const boxW = (pageW - 80) / boxes.length;
  boxes.forEach((b, i) => drawGridBox(doc, 40 + i * boxW, y, boxW - 4, b[0], b[1], b[2]));
  y += 48;

  const headers = ['Unit #', 'Vehicle', 'Insurance', 'Registration', 'Inspection', 'Recalls', 'Overdue Svc', 'Score'];
  const colW = [55, 165, 100, 100, 100, 55, 75, 50];
  doc.setFont('Arial', 'bold'); doc.setFontSize(9); doc.setTextColor('#000000');
  doc.setDrawColor(150); doc.setLineWidth(0.5); doc.line(40, y + 16, pageW - 40, y + 16);
  let cx = 40;
  headers.forEach((h, i) => { doc.text(h, cx + 3, y + 13); cx += colW[i]; });
  y += 22; doc.setTextColor('#000');

  const colorFor = (s: 'valid' | 'expiring' | 'expired'): [number, number, number] =>
    s === 'expired' ? [239, 68, 68] : s === 'expiring' ? [245, 158, 11] : [22, 163, 74];

  const sorted = [...data.rows].sort((a, b) => a.compliance_score - b.compliance_score);
  for (const r of sorted) {
    if (y > pageH - 50) { footerStrip(doc, page, totalPages); doc.addPage(); page++; y = headerStrip(doc, 'COMPLIANCE AUDIT (cont.)'); }
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); cx = 40;
    const insColor = colorFor(r.insurance_status);
    const regColor = colorFor(r.registration_status);
    const inspColor = colorFor(r.inspection_status);
    const insLabel = r.insurance_status === 'expired' ? 'EXPIRED' : r.insurance_status === 'expiring' ? `EXP ${r.insurance_expiry || ''}` : 'VALID';
    const regLabel = r.registration_status === 'expired' ? 'EXPIRED' : r.registration_status === 'expiring' ? `EXP ${r.registration_expiry || ''}` : 'VALID';
    const inspLabel = r.inspection_status === 'expired' ? 'EXPIRED' : r.inspection_status === 'expiring' ? `EXP ${r.inspection_expiry || ''}` : 'VALID';
    const scoreColor: [number, number, number] =
      r.compliance_score >= 90 ? [22, 163, 74]
      : r.compliance_score >= 70 ? [245, 158, 11]
      : [239, 68, 68];
    const vals: Array<{ text: string; color?: [number, number, number] }> = [
      { text: r.vehicle_number },
      { text: r.vehicle_label || '-' },
      { text: insLabel, color: insColor },
      { text: regLabel, color: regColor },
      { text: inspLabel, color: inspColor },
      { text: String(r.open_recalls) },
      { text: String(r.overdue_service) },
      { text: `${r.compliance_score}%`, color: scoreColor },
    ];
    vals.forEach((v, i) => {
      if (v.color) doc.setTextColor(v.color[0], v.color[1], v.color[2]);
      else doc.setTextColor(0, 0, 0);
      doc.text(v.text, cx + 3, y + 12);
      cx += colW[i];
    });
    y += 15;
  }

  // Sign-off block
  if (y > pageH - 80) { footerStrip(doc, page, totalPages); doc.addPage(); page++; y = headerStrip(doc, 'COMPLIANCE AUDIT (cont.)'); }
  y += 20;
  doc.setDrawColor('#1a1a1a'); doc.setLineWidth(0.5);
  doc.line(40, y, pageW - 40, y);
  y += 16;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
  doc.text('AUDIT CERTIFICATION', 40, y);
  y += 16;
  const sigColW = (pageW - 80 - 40) / 2;
  const drawSig = (label: string, xPos: number) => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(RMPG_GRAY);
    doc.text(label, xPos, y);
    doc.setDrawColor('#000'); doc.setLineWidth(0.5);
    doc.line(xPos, y + 22, xPos + 220, y + 22);
    doc.setFontSize(7);
    doc.text('Signature', xPos, y + 32);
    doc.line(xPos + 240, y + 22, xPos + 460, y + 22);
    doc.text('Date', xPos + 240, y + 32);
  };
  drawSig('AUDITOR', 40);
  drawSig('FLEET MANAGER', 40 + sigColW + 40);

  footerStrip(doc, page, totalPages);
  return doc;
}

export function generateComplianceAuditReport(data: {
  rows: ComplianceRow[];
  totalVehicles?: number;
  fullyCompliant?: number;
  issuesCount?: number;
}): void {
  const doc = buildComplianceAuditReport(data);
  doc.save(`fleet_compliance_audit_${localToday()}.pdf`);
}

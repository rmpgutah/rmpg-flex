// ═══════════════════════════════════════════════════════════════
// Nav Trip Report — horizontal PDF generator
//
// Mirrors the fleetFuelReport.ts structure exactly:
//   - Black & gold RMPG banner header
//   - Vehicle / officer / period quick-ref
//   - Summary grid (distance, duration, max speed, MPG, $/mi, etc.)
//   - Breakdowns (status, detected_by, vehicle, purpose)
//   - Entries table with route points
//
// Landscape orientation fits the wider route + breadcrumb columns
// without truncation, matching the user's "horizontal" layout request.
// ═══════════════════════════════════════════════════════════════

import jsPDF from 'jspdf';
import type { NavTrip } from '../types';
import { parseTimestamp } from './dateUtils';
import { registerArialFont } from './pdf/fonts/registerArial';

interface Args {
  trips: NavTrip[];
  officerName?: string;
  vehicleLabel?: string;
  periodLabel?: string;
}

const RMPG_GOLD = '#d4a017';
const RMPG_BLACK = '#0a0a0a';
const RMPG_GRAY = '#888888';
const STATUS_COLOR: Record<string, [number, number, number]> = {
  pending: [245, 158, 11],
  active: [34, 197, 94],
  completed: [59, 130, 246],
  cancelled: [107, 114, 128],
};

function fmt(n: number | null | undefined, digits = 1, prefix = ''): string {
  if (n == null || !Number.isFinite(n)) return '-';
  return `${prefix}${n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  // parseTimestamp interprets naive server strings as UTC (the app standard).
  // The pre-wave-3.1 code used new Date(iso.replace(' ', 'T')) which treated
  // UTC values as local time, skewing all trip timestamps by the user's
  // timezone offset (~6h in Mountain Time). (Wave 3.1)
  const ts = parseTimestamp(iso);
  if (!ts || isNaN(ts.getTime())) return iso;
  const d = ts;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/** Convert [lat, lng] list into a tiny ASCII polyline preview (visual hint on PDF) */
function routePolylinePreview(points?: Array<{ lat: number; lng: number }>): string {
  if (!points || points.length < 2) return '';
  // Use cardinal directions: N, NE, E, SE, S, SW, W, NW
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const segments: string[] = [];
  for (let i = 1; i < Math.min(points.length, 12); i++) {
    const a = points[i - 1];
    const b = points[i];
    const dLat = b.lat - a.lat;
    const dLng = b.lng - a.lng;
    const ang = Math.atan2(dLng, dLat) * 180 / Math.PI;
    const idx = Math.round(((ang + 360) % 360) / 45) % 8;
    segments.push(dirs[idx]);
  }
  return segments.join(' → ');
}

function headerStrip(doc: jsPDF, title: string, subtitle?: string): number {
  const m = 40;
  const w = doc.internal.pageSize.getWidth();
  doc.setFillColor(RMPG_BLACK);
  doc.rect(0, 0, w, 52, 'F');
  doc.setFillColor(RMPG_GOLD);
  doc.rect(0, 52, w, 3, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor('#ffffff');
  doc.text('RMPG FLEX — NAVIGATION', m, 26);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.text(title, m, 42);
  if (subtitle) {
    doc.setFontSize(9);
    doc.setTextColor(RMPG_GOLD);
    doc.text(subtitle, m, 50);
  }
  doc.setTextColor('#000000');
  return 70;
}

function footerStrip(doc: jsPDF, page: number, total: number) {
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(RMPG_GRAY);
  doc.text(`Page ${page} of ${total}`, 40, h - 25);
  doc.text(`Generated ${new Date().toLocaleString()}`, 40, h - 14);
  doc.text('CONFIDENTIAL — RMPG FLEX', w - 200, h - 14);
}

function drawGridBox(doc: jsPDF, x: number, y: number, w: number, h: number, label: string, value: string, highlight?: boolean) {
  doc.setDrawColor('#cccccc');
  doc.setLineWidth(0.5);
  doc.rect(x, y, w, h);
  if (highlight) {
    doc.setFillColor(RMPG_GOLD);
    doc.rect(x, y, w, 3, 'F');
  }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(RMPG_GRAY);
  doc.text(label, x + 6, y + 14);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor('#000');
  doc.text(value, x + 6, y + 30);
}

export function generateNavTripReport({ trips, officerName, vehicleLabel, periodLabel }: Args): void {
  // Landscape — wider page fits the breadcrumb + path summary columns
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' });
  registerArialFont(doc); // Arial-only output (overrides helvetica/times/courier)
  const marginX = 40;
  const pageW = doc.internal.pageSize.getWidth();   // 792pt
  const pageH = doc.internal.pageSize.getHeight(); // 612pt
  const innerW = pageW - marginX * 2;              // 712pt
  let y = 40;

  // ── Header ────────────────────────────────────────────────
  const subtitle = `${officerName ? `Officer: ${officerName}` : ''}${vehicleLabel ? `  •  ${vehicleLabel}` : ''}  •  Generated ${new Date().toLocaleDateString()}`;
  y = headerStrip(doc, 'NAV TRIP REPORT', subtitle);

  // Period / range
  const dates = trips.map(t => t.start_time).filter(Boolean).sort();
  const autoRange = dates.length >= 2
    ? `${dates[0].slice(0, 10)} to ${dates[dates.length - 1].slice(0, 10)}`
    : dates.length === 1 ? dates[0].slice(0, 10) : '(no trips)';
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Period: ${periodLabel || autoRange}`, marginX, y);
  y += 18;

  // ── Summary grid (5-up) ───────────────────────────────────
  const totalDistance = trips.reduce((s, t) => s + (t.distance_miles || 0), 0);
  const totalDuration = trips.reduce((s, t) => s + (t.duration_seconds || 0), 0);
  const maxSpeed = Math.max(0, ...trips.map(t => t.max_speed_mph || 0));
  const completedTrips = trips.filter(t => t.status === 'completed').length;
  const activeTrips = trips.filter(t => t.status === 'active').length;
  const totalBreadcrumbs = trips.reduce((s, t) => s + (t.route_points?.length || 0), 0);
  const autoDetected = trips.filter(t => t.detected_by === 'auto').length;
  const avgDistance = trips.length > 0 ? totalDistance / trips.length : 0;
  const avgDuration = trips.length > 0 ? totalDuration / trips.length : 0;

  const statBoxes: [string, string, boolean?][] = [
    ['Total Trips', `${trips.length}`],
    ['Total Distance', `${fmt(totalDistance, 1)} mi`, true],
    ['Total Duration', formatDuration(totalDuration)],
    ['Avg Trip Distance', `${fmt(avgDistance, 1)} mi`],
    ['Avg Trip Duration', formatDuration(avgDuration)],
    ['Max Speed', `${fmt(maxSpeed, 0)} mph`],
    ['Completed / Active', `${completedTrips} / ${activeTrips}`],
    ['Auto-Detected', `${autoDetected} of ${trips.length} (${trips.length ? Math.round((autoDetected / trips.length) * 100) : 0}%)`],
    ['Breadcrumbs Logged', `${totalBreadcrumbs.toLocaleString()}`],
  ];
  const boxW = (innerW - 8 * 4) / 5; // 5 columns, 4pt gap
  const boxH = 36;
  statBoxes.forEach((b, i) => {
    const col = i % 5;
    const row = Math.floor(i / 5);
    drawGridBox(doc, marginX + col * (boxW + 4), y + row * (boxH + 6), boxW, boxH, b[0], b[1], b[2]);
  });
  y += Math.ceil(statBoxes.length / 5) * (boxH + 6) + 8;

  // ── Breakdowns ────────────────────────────────────────────
  const n = (v: unknown): number => {
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    if (typeof v === 'string') { const p = parseFloat(v); return Number.isFinite(p) ? p : 0; }
    return 0;
  };
  const groupBy = (keyFn: (t: NavTrip) => string): Map<string, { count: number; dist: number; dur: number }> => {
    const m = new Map<string, { count: number; dist: number; dur: number }>();
    for (const t of trips) {
      const k = keyFn(t) || '(unspecified)';
      const a = m.get(k) ?? { count: 0, dist: 0, dur: 0 };
      a.count += 1;
      a.dist += n(t.distance_miles);
      a.dur += n(t.duration_seconds);
      m.set(k, a);
    }
    return m;
  };
  const grandDist = totalDistance || 1;

  const drawBreakdown = (
    title: string,
    rows: Array<{ label: string; count: number; dist: number; dur: number }>,
    opts: { showDist?: boolean; showDur?: boolean } = {},
  ) => {
    if (rows.length === 0) return;
    if (y > pageH - 90) { doc.addPage(); y = 40; }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(title, marginX, y);
    y += 4;
    doc.setDrawColor('#1a1a1a');
    doc.setLineWidth(0.5);
    doc.line(marginX, y, pageW - marginX, y);
    y += 14;
    doc.setFontSize(8);
    const cLabel = marginX;
    const cCount = marginX + 200;
    const cDist = marginX + 260;
    const cDur = marginX + 340;
    const cPct = marginX + 440;
    doc.setFont('helvetica', 'bold');
    doc.text('Category', cLabel, y);
    doc.text('Trips', cCount, y);
    if (opts.showDist !== false) doc.text('Distance', cDist, y);
    if (opts.showDur !== false) doc.text('Duration', cDur, y);
    doc.text('% of Miles', cPct, y);
    doc.setFont('helvetica', 'normal');
    y += 12;
    for (const r of rows) {
      if (y > pageH - 40) { doc.addPage(); y = 40; }
      doc.text(truncate(r.label, 28), cLabel, y);
      doc.text(String(r.count), cCount, y);
      if (opts.showDist !== false) doc.text(`${r.dist.toFixed(1)} mi`, cDist, y);
      if (opts.showDur !== false) doc.text(formatDuration(r.dur), cDur, y);
      doc.text(`${((r.dist / grandDist) * 100).toFixed(1)}%`, cPct, y);
      y += 12;
    }
    y += 8;
  };

  // Status breakdown
  drawBreakdown('TRIP STATUS BREAKDOWN',
    [...groupBy(t => t.status)]
      .map(([label, a]) => ({ label: label.toUpperCase(), ...a }))
      .sort((a, b) => b.count - a.count));

  // Detection method breakdown
  drawBreakdown('DETECTION METHOD',
    [...groupBy(t => t.detected_by || 'manual')]
      .map(([label, a]) => ({ label: label === 'auto' ? 'AUTO-DETECTED' : 'MANUAL', ...a }))
      .sort((a, b) => b.count - a.count));

  // Vehicle breakdown
  const vehRows = [...groupBy(t => {
    if (t.vehicle_number) return `${t.vehicle_number} — ${t.make || ''} ${t.model || ''}`.trim();
    return '(unassigned)';
  })]
    .map(([label, a]) => ({ label, ...a }))
    .sort((a, b) => b.dist - a.dist);
  if (vehRows.length > 0) drawBreakdown('BY VEHICLE', vehRows);

  // Purpose breakdown
  const purpRows = [...groupBy(t => t.purpose || '(unspecified)')]
    .map(([label, a]) => ({ label: label.toUpperCase(), ...a }))
    .sort((a, b) => b.count - a.count);
  if (purpRows.length > 0) drawBreakdown('TRIP PURPOSE', purpRows);

  // Daily activity
  const dailyMap = groupBy(t => (t.start_time || '').slice(0, 10));
  const dailyRows = [...dailyMap]
    .filter(([k]) => /^\d{4}-\d{2}-\d{2}$/.test(k))
    .map(([label, a]) => ({ label, ...a }))
    .sort((a, b) => (a.label < b.label ? -1 : 1));
  if (dailyRows.length > 0) {
    if (y > pageH - 90) { doc.addPage(); y = 40; }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('DAILY ACTIVITY', marginX, y);
    y += 4;
    doc.setDrawColor('#1a1a1a');
    doc.setLineWidth(0.5);
    doc.line(marginX, y, pageW - marginX, y);
    y += 14;
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text('Date', marginX, y);
    doc.text('Trips', marginX + 120, y);
    doc.text('Miles', marginX + 180, y);
    doc.text('Duration', marginX + 260, y);
    doc.setFont('helvetica', 'normal');
    y += 12;
    for (const r of dailyRows) {
      if (y > pageH - 40) { doc.addPage(); y = 40; }
      doc.text(r.label, marginX, y);
      doc.text(String(r.count), marginX + 120, y);
      doc.text(`${r.dist.toFixed(1)} mi`, marginX + 180, y);
      doc.text(formatDuration(r.dur), marginX + 260, y);
      y += 12;
    }
    y += 8;
  }

  // ── Entries table (landscape layout) ──────────────────────
  if (y > pageH - 90) { doc.addPage(); y = 40; }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(`TRIP ENTRIES (${trips.length})`, marginX, y);
  y += 4;
  doc.line(marginX, y, pageW - marginX, y);
  y += 14;

  // Landscape columns — extra width for path + breadcrumbs
  const colStart  = marginX;
  const colDur    = marginX + 105;
  const colDist   = marginX + 175;
  const colMph    = marginX + 235;
  const colVeh    = marginX + 290;
  const colStatus = marginX + 420;
  const colMode   = marginX + 490;
  const colPath   = marginX + 555;
  const colBC     = marginX + 680;

  doc.setFontSize(8);
  const drawHeader = (yy: number) => {
    doc.setFont('helvetica', 'bold');
    doc.text('Start', colStart, yy);
    doc.text('Duration', colDur, yy);
    doc.text('Distance', colDist, yy);
    doc.text('Max MPH', colMph, yy);
    doc.text('Vehicle / Unit', colVeh, yy);
    doc.text('Status', colStatus, yy);
    doc.text('Mode', colMode, yy);
    doc.text('Path', colPath, yy);
    doc.text('BC', colBC, yy);
    doc.setFont('helvetica', 'normal');
  };
  drawHeader(y);
  y += 12;

  for (const trip of trips) {
    if (y > pageH - 50) {
      doc.addPage();
      y = 40;
      drawHeader(y);
      y += 12;
    }
    doc.text(fmtDate(trip.start_time), colStart, y);
    doc.text(formatDuration(trip.duration_seconds), colDur, y);
    doc.text(trip.distance_miles != null ? `${trip.distance_miles.toFixed(1)} mi` : '-', colDist, y);
    doc.text(trip.max_speed_mph != null ? `${Math.round(trip.max_speed_mph)}` : '-', colMph, y);
    doc.text(truncate(
      trip.vehicle_number
        ? `${trip.vehicle_number} — ${trip.make || ''} ${trip.model || ''}`.trim()
        : (trip.unit_call_sign || '-'),
      24,
    ), colVeh, y);
    // Color-code status
    const statusColor = STATUS_COLOR[trip.status] || [0, 0, 0];
    doc.setTextColor(statusColor[0], statusColor[1], statusColor[2]);
    doc.setFont('helvetica', 'bold');
    doc.text((trip.status || '').toUpperCase(), colStatus, y);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(0, 0, 0);
    doc.text(trip.detected_by === 'auto' ? 'AUTO' : 'MANUAL', colMode, y);
    doc.setFontSize(7);
    doc.text(truncate(routePolylinePreview(trip.route_points) || '—', 30), colPath, y);
    doc.setFontSize(8);
    doc.text(String(trip.route_points?.length || 0), colBC, y);
    y += 13;
  }

  // ── Footer / signatures (landscape) ───────────────────────
  if (y > pageH - 80) { doc.addPage(); y = 40; }
  y += 20;
  doc.setDrawColor('#1a1a1a');
  doc.setLineWidth(0.5);
  doc.line(marginX, y, pageW - marginX, y);
  y += 20;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('CERTIFICATION & SIGNATURES', marginX, y);
  y += 16;

  const sigBlock = (label: string, xPos: number) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(RMPG_GRAY);
    doc.text(label, xPos, y);
    doc.setDrawColor('#000');
    doc.setLineWidth(0.5);
    doc.line(xPos, y + 22, xPos + 220, y + 22);
    doc.setFontSize(7);
    doc.text('Signature', xPos, y + 32);
    doc.line(xPos + 240, y + 22, xPos + 460, y + 22);
    doc.text('Date', xPos + 240, y + 32);
  };

  const sigColW = (innerW - 40) / 2;
  sigBlock('OFFICER', marginX);
  sigBlock('SUPERVISOR', marginX + sigColW + 40);

  // Page numbers
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    footerStrip(doc, p, total);
  }

  // ── Save ──────────────────────────────────────────────────
  const officerSlug = (officerName || 'officer').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase();
  const dateStr = new Date().toISOString().slice(0, 10);
  doc.save(`nav-trip-report-${officerSlug}-${dateStr}.pdf`);
}

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || !Number.isFinite(seconds)) return '-';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// ═══════════════════════════════════════════════════════════════
// 2. SINGLE-TRIP DETAIL PDF
// ═══════════════════════════════════════════════════════════════

/** Single trip in landscape: header, big stats, breadcrumb path table,
 *  start/end map data.  Mirrors the multi-trip report style but with
 *  one trip in focus and the route table given the full width. */
export function generateNavSingleTripReport({
  trip, officerName,
}: {
  trip: NavTrip;
  officerName?: string;
}): void {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' });
  registerArialFont(doc); // Arial-only output (overrides helvetica/times/courier)
  const marginX = 40;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const innerW = pageW - marginX * 2;
  let y = 40;

  const subtitle = officerName ? `Officer: ${officerName}` : '';
  y = headerStrip(doc, 'NAV TRIP — DETAIL', subtitle);

  // Trip identifier
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Trip ID: ${trip.id}`, marginX, y);
  doc.text(`Status: ${(trip.status || '').toUpperCase()}`, marginX + 200, y);
  doc.text(`Mode: ${trip.detected_by === 'auto' ? 'AUTO-DETECTED' : 'MANUAL'}`, marginX + 350, y);
  y += 18;

  // Stat row — 5 boxes
  const boxes: [string, string, boolean?][] = [
    ['Distance', `${fmt(trip.distance_miles, 2)} mi`, true],
    ['Duration', formatDuration(trip.duration_seconds)],
    ['Max Speed', `${fmt(trip.max_speed_mph, 0)} mph`],
    ['Breadcrumbs', `${(trip.route_points?.length || 0).toLocaleString()}`],
    ['Start Time', fmtDate(trip.start_time)],
  ];
  const boxW = (innerW - 4 * 4) / 5;
  const boxH = 40;
  boxes.forEach((b, i) => {
    drawGridBox(doc, marginX + i * (boxW + 4), y, boxW, boxH, b[0], b[1], b[2]);
  });
  y += boxH + 12;

  // Start / End panel
  const halfW = (innerW - 12) / 2;
  // Start
  doc.setDrawColor('#cccccc');
  doc.setLineWidth(0.5);
  doc.rect(marginX, y, halfW, 80);
  doc.setFillColor(RMPG_GOLD);
  doc.rect(marginX, y, halfW, 3, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(RMPG_GRAY);
  doc.text('START', marginX + 6, y + 14);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor('#000');
  doc.text(`Time: ${fmtDate(trip.start_time)}`, marginX + 6, y + 30);
  doc.text(`Lat/Lng: ${trip.start_lat.toFixed(5)}, ${trip.start_lng.toFixed(5)}`, marginX + 6, y + 46);
  doc.text(`Location: ${truncate(trip.start_location || '(reverse-geocoded)', 60)}`, marginX + 6, y + 62);
  if (trip.start_accuracy) doc.text(`Accuracy: ±${Math.round(trip.start_accuracy)}m`, marginX + 6, y + 74);

  // End
  const endX = marginX + halfW + 12;
  doc.rect(endX, y, halfW, 80);
  doc.setFillColor(RMPG_GOLD);
  doc.rect(endX, y, halfW, 3, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(RMPG_GRAY);
  doc.text('END', endX + 6, y + 14);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor('#000');
  if (trip.end_lat && trip.end_lng) {
    doc.text(`Time: ${fmtDate(trip.end_time)}`, endX + 6, y + 30);
    doc.text(`Lat/Lng: ${trip.end_lat.toFixed(5)}, ${trip.end_lng.toFixed(5)}`, endX + 6, y + 46);
    doc.text(`Location: ${truncate(trip.end_location || '(reverse-geocoded)', 60)}`, endX + 6, y + 62);
    if (trip.end_accuracy) doc.text(`Accuracy: ±${Math.round(trip.end_accuracy)}m`, endX + 6, y + 74);
  } else {
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(RMPG_GRAY);
    doc.text('Trip in progress…', endX + 6, y + 46);
  }
  y += 96;

  // Vehicle / unit panel
  doc.setDrawColor('#cccccc');
  doc.rect(marginX, y, innerW, 36);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(RMPG_GRAY);
  doc.text('VEHICLE / UNIT', marginX + 6, y + 14);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor('#000');
  if (trip.vehicle_number) {
    doc.text(`Vehicle: ${trip.vehicle_number} — ${trip.make || ''} ${trip.model || ''}`.trim(), marginX + 6, y + 30);
  }
  if (trip.unit_call_sign) {
    doc.text(`Unit: ${trip.unit_call_sign}`, marginX + 320, y + 30);
  }
  if (trip.purpose) {
    doc.text(`Purpose: ${trip.purpose.toUpperCase()}`, marginX + 480, y + 30);
  }
  y += 48;

  // Breadcrumb path table — full width
  const points = trip.route_points || [];
  if (points.length > 0) {
    if (y > pageH - 90) { doc.addPage(); y = 40; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
    doc.text(`BREADCRUMB PATH (${points.length} points)`, marginX, y);
    y += 4;
    doc.setDrawColor('#1a1a1a'); doc.setLineWidth(0.5);
    doc.line(marginX, y, pageW - marginX, y);
    y += 14;

    const cIdx = marginX;
    const cTime = marginX + 50;
    const cLat = marginX + 200;
    const cLng = marginX + 320;
    const cSpd = marginX + 440;
    const cHdg = marginX + 510;
    const cDir = marginX + 580;
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text('#', cIdx, y);
    doc.text('Time', cTime, y);
    doc.text('Latitude', cLat, y);
    doc.text('Longitude', cLng, y);
    doc.text('MPH', cSpd, y);
    doc.text('Heading', cHdg, y);
    doc.text('Bearing', cDir, y);
    doc.setFont('helvetica', 'normal');
    y += 12;

    // Sample at most 100 points evenly so the PDF doesn't bloat
    const sample = points.length > 100
      ? points.filter((_, i) => i % Math.ceil(points.length / 100) === 0)
      : points;

    let prevLat = sample[0]?.lat;
    let prevLng = sample[0]?.lng;
    for (let i = 0; i < sample.length; i++) {
      if (y > pageH - 40) { doc.addPage(); y = 40; }
      const p = sample[i];
      doc.text(String(i + 1), cIdx, y);
      doc.text(fmtDate(p.ts), cTime, y);
      doc.text(p.lat != null ? p.lat.toFixed(5) : '—', cLat, y);
      doc.text(p.lng != null ? p.lng.toFixed(5) : '—', cLng, y);
      if (p.speed != null) {
        // speed is m/s; convert to mph
        const mph = p.speed * 2.2369;
        doc.text(`${mph.toFixed(0)}`, cSpd, y);
      } else {
        doc.text('-', cSpd, y);
      }
      if (p.heading != null) {
        doc.text(`${Math.round(p.heading)}°`, cHdg, y);
        const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
        const idx = Math.round(((p.heading + 360) % 360) / 45) % 8;
        doc.text(dirs[idx], cDir, y);
      } else {
        doc.text('-', cHdg, y);
        doc.text('-', cDir, y);
      }
      y += 11;
    }

    if (sample.length < points.length) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8);
      doc.setTextColor(RMPG_GRAY);
      doc.text(`Showing ${sample.length} of ${points.length} points (sampled for length)`, marginX, y + 6);
      doc.setTextColor('#000');
      doc.setFont('helvetica', 'normal');
      y += 14;
    }
  }

  // Notes (if any)
  if (trip.notes) {
    if (y > pageH - 80) { doc.addPage(); y = 40; }
    y += 16;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
    doc.text('NOTES', marginX, y);
    y += 14;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    const lines = doc.splitTextToSize(trip.notes, innerW);
    doc.text(lines, marginX, y);
    y += lines.length * 12;
  }

  // Signature footer
  if (y > pageH - 80) { doc.addPage(); y = 40; }
  y += 16;
  doc.setDrawColor('#1a1a1a');
  doc.setLineWidth(0.5);
  doc.line(marginX, y, pageW - marginX, y);
  y += 16;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
  doc.text('CERTIFICATION', marginX, y);
  y += 16;
  const sigBlock = (label: string, xPos: number) => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(RMPG_GRAY);
    doc.text(label, xPos, y);
    doc.setDrawColor('#000'); doc.setLineWidth(0.5);
    doc.line(xPos, y + 22, xPos + 220, y + 22);
    doc.setFontSize(7);
    doc.text('Signature', xPos, y + 32);
    doc.line(xPos + 240, y + 22, xPos + 460, y + 22);
    doc.text('Date', xPos + 240, y + 32);
  };
  const sigColW = (innerW - 40) / 2;
  sigBlock('OFFICER', marginX);
  sigBlock('SUPERVISOR', marginX + sigColW + 40);

  // Page numbers
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    footerStrip(doc, p, total);
  }

  // Save
  const dateStr = parseTimestamp(trip.start_time).toISOString().slice(0, 10);
  const officerSlug = (officerName || 'officer').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase();
  doc.save(`nav-trip-${officerSlug}-${dateStr}-${trip.id}.pdf`);
}

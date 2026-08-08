// ═══════════════════════════════════════════════════════════════
// Nav Route Briefing — printable PRE-trip sheet (portrait)
//
// Mirrors navTripPdf.ts's conventions exactly (same header/footer
// strips, black & gold banner, drawGridBox stat boxes, Arial-only
// font override) but is a PRE-trip document: turn-by-turn steps,
// destination(s)/waypoints, and ETA computed by useNavGuidanceEngine
// BEFORE departure — not a post-trip breadcrumb report.
//
// Static map embedding follows the same call as recordPdfGenerator.ts /
// serveJobSheetPdfGenerator.ts: fetchLocationMapImage() from
// pdfStaticMap.ts, best-effort (the section is simply omitted on any
// failure — never blocks or throws).
// ═══════════════════════════════════════════════════════════════

import jsPDF from 'jspdf';
import { localToday } from './dateUtils';
import type { RouteInfo, RouteStep } from '../hooks/useMapRouting';
import type { NavWaypoint } from '../hooks/waypointAdvance';
import { fetchLocationMapImage } from './pdfStaticMap';
import { registerArialFont } from './pdf/fonts/registerArial';

const RMPG_GOLD = '#d4a017';
const RMPG_BLACK = '#0a0a0a';
const RMPG_GRAY = '#888888';

export interface NavBriefingArgs {
  /** Turn-by-turn route as currently held by useNavGuidanceEngine. */
  route: RouteInfo;
  /** Destination label ("450 S Main St") — mirrors NavigationPage's destLabel. */
  destinationLabel?: string | null;
  destLat?: number | null;
  destLng?: number | null;
  /** Origin (current position) — used only for the static map center when no
   *  destination coordinates are present, and for a "FROM" line. */
  originLat?: number | null;
  originLng?: number | null;
  /** Multi-stop waypoint list (empty for a single-destination route). */
  waypoints?: NavWaypoint[];
  officerName?: string;
  unitCallSign?: string | null;
}

function fmtDate(): string {
  return new Date().toLocaleString();
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
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

const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
function compass8(fromLat: number, fromLng: number, toLat: number, toLng: number): string {
  const dy = toLat - fromLat;
  const dx = (toLng - fromLng) * Math.cos((fromLat * Math.PI) / 180);
  const deg = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
  return dirs[Math.round(deg / 45) % 8];
}

/** Pure list-shaping helper (kept separate for unit testing): builds the
 *  ordered row list the turn-by-turn table renders — one row per step,
 *  running/cumulative distance included. */
export function buildBriefingSteps(steps: RouteStep[] | undefined): Array<{ n: number; instruction: string; distanceText: string }> {
  if (!steps || steps.length === 0) return [];
  return steps.map((s, i) => ({
    n: i + 1,
    instruction: s.instruction || 'Continue',
    distanceText: s.distanceText || '-',
  }));
}

/**
 * Build a printable PRE-trip route briefing: destination(s), ETA/distance,
 * full turn-by-turn list, and (best-effort) a static overview map. Portrait
 * orientation — this is a hand-carried briefing sheet, not a wide data table.
 * Returns the jsPDF document without saving it.
 */
export async function buildNavBriefingPdf({
  route, destinationLabel, destLat, destLng, originLat, originLng,
  waypoints, officerName, unitCallSign,
}: NavBriefingArgs): Promise<jsPDF> {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' });
  registerArialFont(doc); // Arial-only output (overrides helvetica/times/courier)
  const marginX = 40;
  const pageW = doc.internal.pageSize.getWidth();  // 612pt
  const pageH = doc.internal.pageSize.getHeight(); // 792pt
  const innerW = pageW - marginX * 2;
  let y = 40;

  const subtitle = `${officerName ? `Officer: ${officerName}` : ''}${unitCallSign ? `  •  Unit ${unitCallSign}` : ''}  •  Generated ${fmtDate()}`;
  y = headerStrip(doc, 'PRE-TRIP ROUTE BRIEFING', subtitle);

  // ── Destination line ─────────────────────────────────────
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Destination: ${destinationLabel || route.callNumber || '(unspecified)'}`, marginX, y);
  y += 18;

  // ── Summary stat boxes ────────────────────────────────────
  const boxes: [string, string, boolean?][] = [
    ['ETA', route.eta, true],
    ['Distance', route.distance],
    ['Turns', `${route.steps?.length ?? 0}`],
    ['Traffic', route.worstCongestion ? route.worstCongestion.toUpperCase() : 'UNKNOWN'],
  ];
  const boxW = (innerW - 3 * 6) / 4;
  const boxH = 40;
  boxes.forEach((b, i) => {
    drawGridBox(doc, marginX + i * (boxW + 6), y, boxW, boxH, b[0], b[1], b[2]);
  });
  y += boxH + 14;

  // ── Multi-stop waypoint list (only when this is a multi-stop route) ──
  if (waypoints && waypoints.length > 0) {
    if (y > pageH - 90) { doc.addPage(); y = 40; }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(`STOPS (${waypoints.length})`, marginX, y);
    y += 4;
    doc.setDrawColor('#1a1a1a');
    doc.setLineWidth(0.5);
    doc.line(marginX, y, pageW - marginX, y);
    y += 14;
    doc.setFontSize(9);
    for (let i = 0; i < waypoints.length; i++) {
      if (y > pageH - 40) { doc.addPage(); y = 40; }
      const wp = waypoints[i];
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(wp.completed ? '#22c55e' : '#000000');
      doc.text(`${i + 1}.`, marginX, y);
      doc.setFont('helvetica', 'normal');
      doc.text(truncate(wp.label || `Stop ${i + 1}`, 70), marginX + 20, y);
      doc.setTextColor(RMPG_GRAY);
      doc.setFontSize(8);
      doc.text(wp.completed ? 'COMPLETED' : 'PENDING', pageW - marginX - 60, y);
      doc.setFontSize(9);
      doc.setTextColor('#000000');
      y += 14;
    }
    y += 8;
  }

  // ── Static overview map (best-effort) ─────────────────────
  try {
    const mapLat = destLat ?? originLat;
    const mapLng = destLng ?? originLng;
    if (mapLat != null && mapLng != null) {
      const img = await fetchLocationMapImage({
        lat: destLat ?? undefined,
        lng: destLng ?? undefined,
        address: destinationLabel ?? undefined,
        widthPx: innerW,
        heightPx: 220,
        zoom: 13,
      });
      if (img) {
        if (y > pageH - 240) { doc.addPage(); y = 40; }
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.text('ROUTE OVERVIEW', marginX, y);
        y += 4;
        doc.setDrawColor('#1a1a1a');
        doc.setLineWidth(0.5);
        doc.line(marginX, y, pageW - marginX, y);
        y += 8;
        const drawH = 200;
        const drawW = innerW;
        doc.addImage(img.dataUrl, 'JPEG', marginX, y, drawW, drawH);
        doc.setDrawColor('#cccccc');
        doc.rect(marginX, y, drawW, drawH);
        y += drawH + 14;
        if (originLat != null && originLng != null && mapLat != null && mapLng != null) {
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(8);
          doc.setTextColor(RMPG_GRAY);
          doc.text(`Approx. bearing to destination: ${compass8(originLat, originLng, mapLat, mapLng)}`, marginX, y);
          doc.setTextColor('#000000');
          y += 14;
        }
      }
    }
  } catch {
    // Best-effort — the briefing is still useful without the map.
  }

  // ── Turn-by-turn table ─────────────────────────────────────
  const steps = buildBriefingSteps(route.steps);
  if (y > pageH - 90) { doc.addPage(); y = 40; }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(`TURN-BY-TURN (${steps.length})`, marginX, y);
  y += 4;
  doc.setDrawColor('#1a1a1a');
  doc.setLineWidth(0.5);
  doc.line(marginX, y, pageW - marginX, y);
  y += 14;

  const cIdx = marginX;
  const cInstr = marginX + 30;
  const cDist = pageW - marginX - 60;
  doc.setFontSize(8);
  const drawHeader = (yy: number) => {
    doc.setFont('helvetica', 'bold');
    doc.text('#', cIdx, yy);
    doc.text('Instruction', cInstr, yy);
    doc.text('Distance', cDist, yy);
    doc.setFont('helvetica', 'normal');
  };
  drawHeader(y);
  y += 12;

  doc.setFontSize(9);
  for (const s of steps) {
    if (y > pageH - 50) {
      doc.addPage();
      y = 40;
      doc.setFontSize(8);
      drawHeader(y);
      y += 12;
      doc.setFontSize(9);
    }
    doc.text(String(s.n), cIdx, y);
    const lines = doc.splitTextToSize(s.instruction, cDist - cInstr - 10);
    doc.text(lines, cInstr, y);
    doc.text(s.distanceText, cDist, y);
    y += Math.max(12, lines.length * 11);
  }

  if (steps.length === 0) {
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(RMPG_GRAY);
    doc.text('No turn-by-turn steps available for this route.', marginX, y);
    doc.setTextColor('#000000');
    doc.setFont('helvetica', 'normal');
    y += 14;
  }

  // ── Notes / acknowledgement ─────────────────────────────────
  if (y > pageH - 100) { doc.addPage(); y = 40; }
  y += 16;
  doc.setDrawColor('#1a1a1a');
  doc.setLineWidth(0.5);
  doc.line(marginX, y, pageW - marginX, y);
  y += 20;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('BRIEFED / ACKNOWLEDGED', marginX, y);
  y += 16;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(RMPG_GRAY);
  doc.text('Officer', marginX, y);
  doc.setDrawColor('#000');
  doc.setLineWidth(0.5);
  doc.line(marginX, y + 22, marginX + innerW, y + 22);
  doc.setFontSize(7);
  doc.text('Signature', marginX, y + 32);
  doc.text('Date', marginX + innerW - 100, y + 32);
  doc.setTextColor('#000000');

  // Page numbers
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    footerStrip(doc, p, total);
  }

  return doc;
}

/** Build the Nav Briefing PDF and immediately save it to disk (same
 *  filename/behaviour as before this function was split into a builder +
 *  saver). */
export async function generateNavBriefing(args: NavBriefingArgs): Promise<void> {
  const doc = await buildNavBriefingPdf(args);
  const officerSlug = (args.officerName || 'officer').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase();
  const dateStr = localToday();
  doc.save(`nav-briefing-${officerSlug}-${dateStr}.pdf`);
}

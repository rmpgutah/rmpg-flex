// ============================================================
// RMPG Flex — Trip Log PDF Report Generator
// Audit log of a unit's logged trips (call responses + patrol legs).
// One row per trip with type, call #, time window, distance, duration,
// mileage delta, max speed, and harsh-event tallies + a totals row.
//
// Mirrors patrolTrackingPdfGenerator.ts EXACTLY — same jsPDF engine,
// same shared helpers (pdfGenerator / pdfTokens / pdfAssets), same
// header bar + drawSectionHeader + drawColumnHeaders + zebra-striped
// table + footer + finalizePoliceReport save path. NO new PDF lib.
// ============================================================

import jsPDF from 'jspdf';
import { loadLogoDarkBase64, FORM_NUMBERS, FORM_REVISION } from './pdfAssets';
import {
  fetchPdfBranding, DEFAULT_PDF_BRANDING, sanitizePdfText,
  addSignatureBlock, checkPageBreak, addConfidentialWatermark, finalizePoliceReport,
} from './pdfGenerator';
import { COLOR, FONT, BORDER, SPACING, LAYOUT, PDF_VALUE_FONT, applyPrintTarget, topMarginY, type PrintTarget } from './pdfTokens';
import { localToday, parseTimestamp } from './dateUtils';
import {
  type Trip,
  tripLabel, tripMiles, tripMaxMph, tripDurationMin,
} from '../hooks/useTrips';

export interface TripLogPdfOptions {
  /** Report title — defaults to "TRIP LOG". */
  title?: string;
  /** Unit call-sign / id label for the header (e.g. "D19"). */
  unitLabel?: string;
  /** Officer label for the header. */
  officerLabel?: string;
  printTarget?: PrintTarget;
}

// ── Helpers ──────────────────────────────────────────────────

function fmtClock(isoStr: string | null): string {
  if (!isoStr) return '';
  try {
    const d = parseTimestamp(isoStr);
    return d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit' }) + ' '
      + d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
  } catch { return isoStr; }
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = (hex || '#303030').replace('#', '');
  return [
    parseInt(clean.substring(0, 2), 16) || 48,
    parseInt(clean.substring(2, 4), 16) || 48,
    parseInt(clean.substring(4, 6), 16) || 48,
  ];
}

/** Compact harsh-event tally: "A:n B:n C:n" (omits zero buckets; "—" when none). */
function harshTally(t: Trip): string {
  const parts: string[] = [];
  if (t.harsh_accel_count) parts.push(`A:${t.harsh_accel_count}`);
  if (t.harsh_brake_count) parts.push(`B:${t.harsh_brake_count}`);
  if (t.harsh_corner_count) parts.push(`C:${t.harsh_corner_count}`);
  return parts.length ? parts.join(' ') : '—';
}

/** "12345->12389" when both mileages present, else "—". */
function mileageDelta(t: Trip): string {
  if (t.start_mileage != null && t.end_mileage != null) {
    return `${Number(t.start_mileage).toLocaleString()}->${Number(t.end_mileage).toLocaleString()}`;
  }
  if (t.start_mileage != null) return `${Number(t.start_mileage).toLocaleString()}->`;
  return '—';
}

// ── PDF Generator ───────────────────────────────────────────

export async function generateTripLogPdf(trips: Trip[], opts: TripLogPdfOptions = {}): Promise<void> {
  try {
    const branding = await fetchPdfBranding();
    const primaryRgb = hexToRgb(branding.primary_color || DEFAULT_PDF_BRANDING.primary_color);
    const accentRgb = hexToRgb(branding.accent_color || DEFAULT_PDF_BRANDING.accent_color);
    const logoB64 = await loadLogoDarkBase64();

    const title = (opts.title || 'TRIP LOG').toUpperCase();
    const doc = new jsPDF('landscape', 'mm', 'letter');
    applyPrintTarget(doc, opts.printTarget ?? 'office');
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = LAYOUT.PAGE_MARGIN;
    const contentW = pageW - margin * 2;
    const reportDate = new Date().toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    });
    const formNum = FORM_NUMBERS['trip_log'] || 'FORM PS-211';

    let yPos: number = topMarginY(doc);

    addConfidentialWatermark(doc);
    // @ts-expect-error jsPDF GState — safety reset after watermark
    doc.setGState(new doc.GState({ opacity: 1.0 }));

    // Newest-first, then sort ascending by start time for a chronological log.
    const ordered = [...trips].sort((a, b) => {
      const ta = parseTimestamp(a.start_time).getTime();
      const tb = parseTimestamp(b.start_time).getTime();
      return ta - tb;
    });

    // Date range across the trips (oldest start → newest end/active).
    const firstStart = ordered.length ? ordered[0].start_time : null;
    const lastTrip = ordered.length ? ordered[ordered.length - 1] : null;
    const lastEnd = lastTrip ? (lastTrip.end_time || lastTrip.start_time) : null;

    // ── Page header bar (every page) + footer (every page) ──
    function addHeaderFooter(pageNum: number, totalPages: number) {
      // Dark header bar
      doc.setFillColor(...COLOR.BG_SECTION_HDR);
      doc.rect(0, 0, pageW, 14, 'F');
      if (logoB64) {
        try { doc.addImage(logoB64, 'PNG', margin, 2, 12, 10); } catch { /* ignore */ }
      }
      const textX = logoB64 ? margin + 14 : margin;
      doc.setTextColor(...COLOR.TEXT_INVERTED);
      doc.setFontSize(FONT.SIZE_SECTION_TITLE + 2);
      doc.setFont('helvetica', 'bold');
      doc.text(sanitizePdfText(branding.report_header_text).toUpperCase(), textX, 6);
      doc.setFontSize(FONT.SIZE_TABLE_HEADER);
      doc.setFont('helvetica', 'normal');
      doc.text('PATROL DIVISION', textX, 10);
      doc.setFontSize(FONT.SIZE_SECTION_TITLE);
      doc.text(`${title}  |  ${formNum}  |  ${FORM_REVISION}`, pageW - margin, 9, { align: 'right' });
      // Accent strip
      doc.setFillColor(...primaryRgb);
      doc.rect(0, 14, pageW / 2, 1, 'F');
      doc.setFillColor(...accentRgb);
      doc.rect(pageW / 2, 14, pageW / 2, 1, 'F');

      // Footer — pulled into the safe print zone (matches patrol-tracking).
      const footerH = 8;
      const SAFE_PRINT_EDGE_BOTTOM = 5;
      const footerY = pageH - footerH - SAFE_PRINT_EDGE_BOTTOM;
      doc.setFillColor(...COLOR.BG_FORM_CELL_LABEL);
      doc.rect(SAFE_PRINT_EDGE_BOTTOM, footerY, pageW - 2 * SAFE_PRINT_EDGE_BOTTOM, footerH, 'F');
      doc.setDrawColor(...COLOR.BORDER_TABLE);
      doc.setLineWidth(BORDER.TABLE_ROW);
      doc.line(SAFE_PRINT_EDGE_BOTTOM, footerY, pageW - SAFE_PRINT_EDGE_BOTTOM, footerY);
      doc.setTextColor(...COLOR.TEXT_MUTED);
      doc.setFontSize(FONT.SIZE_FOOTER_PRIMARY);
      doc.setFont(PDF_VALUE_FONT, 'bold');
      doc.text(sanitizePdfText(`${formNum}  |  INTERNAL USE ONLY  |  Page ${pageNum} of ${totalPages}`), margin, footerY + footerH / 2 + 0.5);
      doc.text(sanitizePdfText(`GENERATED: ${reportDate.toUpperCase()}`), pageW - margin, footerY + footerH / 2 + 0.5, { align: 'right' });
      doc.setTextColor(...COLOR.TEXT_PRIMARY);
    }

    // ── Section header bar — matches patrol-tracking / openAutoSection ──
    function drawSectionHeader(secTitle: string) {
      const barH = SPACING.SECTION_HEADER_H;
      doc.setFillColor(...COLOR.BG_SECTION_HDR);
      doc.rect(margin, yPos, contentW, barH, 'F');
      doc.setTextColor(...COLOR.TEXT_INVERTED);
      doc.setFontSize(FONT.SIZE_SECTION_TITLE);
      doc.setFont('helvetica', 'bold');
      const capH = FONT.SIZE_SECTION_TITLE * 0.35;
      doc.text(secTitle.toUpperCase(), margin + SPACING.CONTENT_INSET + 1, yPos + (barH + capH) / 2);
      doc.setFont(PDF_VALUE_FONT, 'normal');
      doc.setTextColor(...COLOR.TEXT_PRIMARY);
      yPos += barH + SPACING.SECTION_CONTENT_PAD;
    }

    // ── Table column headers — light slate fill, dark text (matches patrol) ──
    function drawColumnHeaders(cols: { label: string; w: number }[]) {
      yPos -= SPACING.SECTION_CONTENT_PAD;
      const hdrH = 5;
      doc.setFillColor(...COLOR.BG_TABLE_HDR_LIGHT);
      doc.rect(margin, yPos, contentW, hdrH, 'F');
      doc.setDrawColor(...COLOR.BORDER_TABLE);
      doc.setLineWidth(BORDER.TABLE_ROW);
      doc.rect(margin, yPos, contentW, hdrH);
      doc.setTextColor(...COLOR.TEXT_TABLE_HDR_LIGHT);
      doc.setFontSize(FONT.SIZE_TABLE_HEADER);
      doc.setFont('helvetica', 'bold');
      const capH = FONT.SIZE_TABLE_HEADER * 0.35;
      const textY = yPos + (hdrH + capH) / 2;
      let xOff = margin;
      for (const col of cols) {
        doc.text(col.label.toUpperCase(), xOff + 1, textY);
        xOff += col.w;
      }
      doc.setFont(PDF_VALUE_FONT, 'normal');
      doc.setTextColor(...COLOR.TEXT_PRIMARY);
      yPos += hdrH + 1;
    }

    function newPage() {
      doc.addPage();
      addConfidentialWatermark(doc);
      // @ts-expect-error jsPDF GState — safety reset after watermark
      doc.setGState(new doc.GState({ opacity: 1.0 }));
      yPos = topMarginY(doc) + 18; // after header + accent strip
    }

    function ensureSpace(needed: number) {
      if (yPos + needed > pageH - LAYOUT.FOOTER_HEIGHT - 5) newPage();
    }

    // Push first content below the page-1 header bar.
    yPos = topMarginY(doc) + 18;

    // ── Report Details ──────────────────────────────────
    drawSectionHeader('Report Details');
    doc.setTextColor(...COLOR.TEXT_PRIMARY);
    doc.setFontSize(FONT.SIZE_FIELD_VALUE);
    doc.setFont(PDF_VALUE_FONT, 'normal');

    const rangeLabel = firstStart
      ? `${fmtClock(firstStart).toUpperCase()} -- ${(lastTrip && lastTrip.status === 'active' && !lastTrip.end_time) ? 'ACTIVE' : fmtClock(lastEnd).toUpperCase()}`
      : 'N/A';
    const metaLines: [string, string][] = [
      ['UNIT:', (opts.unitLabel || 'N/A').toUpperCase()],
      ['OFFICER:', (opts.officerLabel || 'N/A').toUpperCase()],
      ['TRIPS LOGGED:', String(ordered.length)],
      ['REPORT PERIOD:', rangeLabel],
      ['GENERATED:', reportDate.toUpperCase()],
    ];
    for (const [label, value] of metaLines) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(FONT.SIZE_FIELD_LABEL);
      doc.setTextColor(...COLOR.TEXT_SECONDARY);
      doc.text(label, margin + 4, yPos);
      doc.setFont(PDF_VALUE_FONT, 'normal');
      doc.setFontSize(FONT.SIZE_FIELD_VALUE);
      doc.setTextColor(...COLOR.TEXT_PRIMARY);
      doc.text(sanitizePdfText(value), margin + 42, yPos);
      yPos += SPACING.FIELD_ROW_ADVANCE;
    }
    yPos += 4;

    // ── Trip Log table ──────────────────────────────────
    drawSectionHeader('Trip Log');

    const cols = [
      { label: 'Type', w: 30 },
      { label: 'Call #', w: 22 },
      { label: 'Start', w: 26 },
      { label: 'End', w: 26 },
      { label: 'Dist (mi)', w: 18 },
      { label: 'Dur (m)', w: 16 },
      { label: 'Mileage', w: 30 },
      { label: 'Max MPH', w: 18 },
      { label: 'Harsh (A/B/C)', w: 26 },
    ];
    const totalColW = cols.reduce((s, c) => s + c.w, 0);
    const scale = contentW / totalColW;
    cols.forEach((c) => { c.w = c.w * scale; });

    drawColumnHeaders(cols);

    doc.setFontSize(FONT.SIZE_TABLE_BODY);
    doc.setFont(PDF_VALUE_FONT, 'normal');

    let sumMiles = 0;
    let sumDurMin = 0;

    for (let i = 0; i < ordered.length; i++) {
      const t = ordered[i];
      ensureSpace(5);
      // If we wrapped to a fresh page, redraw the column headers.
      if (yPos === topMarginY(doc) + 18) drawColumnHeaders(cols);

      if (i % 2 === 0) {
        doc.setFillColor(...COLOR.BG_ZEBRA);
        doc.rect(margin, yPos, contentW, 4.2, 'F');
      }

      const mi = tripMiles(t);
      const durMin = tripDurationMin(t);
      sumMiles += mi;
      if (durMin != null) sumDurMin += durMin;

      const endLabel = t.end_time ? fmtClock(t.end_time).toUpperCase() : 'ACTIVE';

      const rowData = [
        tripLabel(t).toUpperCase(),
        (t.call_number || '—').toUpperCase(),
        fmtClock(t.start_time).toUpperCase(),
        endLabel,
        Number.isFinite(mi) ? mi.toFixed(1) : '—',
        durMin != null ? String(durMin) : '—',
        mileageDelta(t),
        String(tripMaxMph(t)),
        harshTally(t),
      ];

      doc.setTextColor(...COLOR.TEXT_PRIMARY);
      let xOff = margin;
      for (let ci = 0; ci < cols.length; ci++) {
        doc.text(sanitizePdfText(rowData[ci]), xOff + 1, yPos + 3, { maxWidth: cols[ci].w - 1.5 });
        xOff += cols[ci].w;
      }
      yPos += 4.5;
    }

    if (ordered.length === 0) {
      doc.setTextColor(...COLOR.TEXT_TERTIARY);
      doc.setFontSize(FONT.SIZE_TABLE_BODY);
      doc.text('No trips logged for this unit.', margin + 1, yPos + 3);
      yPos += 6;
    } else {
      // ── Totals row ──────────────────────────────────
      ensureSpace(6);
      doc.setDrawColor(...COLOR.BORDER_TABLE);
      doc.setLineWidth(BORDER.TABLE_ROW);
      doc.line(margin, yPos, margin + contentW, yPos);
      yPos += 1;
      doc.setFillColor(...COLOR.BG_TABLE_HDR_LIGHT);
      doc.rect(margin, yPos, contentW, 4.6, 'F');
      doc.setTextColor(...COLOR.TEXT_TABLE_HDR_LIGHT);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(FONT.SIZE_TABLE_HEADER);
      const totalsRow = [
        `TOTALS (${ordered.length})`,
        '',
        '',
        '',
        sumMiles.toFixed(1),
        String(sumDurMin),
        '',
        '',
        '',
      ];
      let txOff = margin;
      for (let ci = 0; ci < cols.length; ci++) {
        doc.text(totalsRow[ci], txOff + 1, yPos + 3.2, { maxWidth: cols[ci].w - 1.5 });
        txOff += cols[ci].w;
      }
      doc.setFont(PDF_VALUE_FONT, 'normal');
      doc.setTextColor(...COLOR.TEXT_PRIMARY);
      yPos += 6;
    }

    // ── Signature block ──────────────────────────────────
    yPos = checkPageBreak(doc, yPos, 30);
    yPos += 3;
    yPos = addSignatureBlock(doc, 'Reporting Officer', margin, yPos, contentW);

    // ── Headers/footers on all pages ─────────────────────
    const totalPages = doc.internal.pages.length - 1;
    for (let p = 1; p <= totalPages; p++) {
      doc.setPage(p);
      addHeaderFooter(p, totalPages);
    }

    // Encode form metadata in the trailing barcode (matches patrol-tracking).
    const barcodeId = `TRIP-${localToday().replace(/-/g, '')}-${(opts.unitLabel || 'ALL').replace(/\s+/g, '')}`;
    finalizePoliceReport(doc, {
      barcode: {
        formMetadata: {
          form: 'TRIP-LOG',
          caseNumber: barcodeId,
          agency: 'RMPG',
          agencyOri: 'UT0180100',
          reportDate: localToday(),
        },
      },
    });

    // ── Save ─────────────────────────────────────────────
    const dateStr = localToday().replace(/-/g, '');
    const unitSuffix = opts.unitLabel ? `_${opts.unitLabel.replace(/\s+/g, '')}` : '';
    const targetSuffix = opts.printTarget === 'mobile' ? '_mobile' : '';
    doc.save(`RMPG_Trip_Log${unitSuffix}_${dateStr}${targetSuffix}.pdf`);
  } catch (err) {
    console.error('Trip log PDF generation failed:', err);
    throw new Error(`Failed to generate trip log PDF: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }
}

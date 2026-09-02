// ============================================================
// RMPG Flex — Process Server Job Information Sheet (PS-300)
// Printable job packet carried by the PSO to the field;
// doubles as an internal filing record.
// ============================================================

import jsPDF from 'jspdf';
import {
  openAutoSection,
  closeAutoSection,
  addFieldPair,
  addSignatureBlock,
  addTableWithShading,
  addWrappedText,
  addPageFooter,
  checkPageBreak,
  setGenerationTimestamp,
  fetchPdfBranding,
  setActiveBranding,
  loadPdfAssets,
  setActiveFormKey,
  setActiveCaseNumber,
  setActiveSectionStyle,
  sanitizePdfText,
  finalizePoliceReport,
  stampGenerationTime,
} from './pdfGenerator';
import {
  LAYOUT, SPACING, FONT, COLOR, BORDER,
  getContentWidth, getFullFieldWidth,
  getLeftX, getRightColumnX, getHalfFieldWidth,
  getProportionalColumns, getCapHeight,
} from './pdfTokens';
import { drawNibrsHeader } from './pdfFormHelpers';
import { registerArialFont } from './pdf/fonts/registerArial';
import { addLocationMapSection } from './recordPdfGenerator';
import { toDisplayLabel } from './formatters';
import { localToday } from './dateUtils';

// ── Data Interface ───────────────────────────────────────────

export interface ServeJobSheetData {
  jobId: number;
  status: string;
  priority: string;
  deadline: string | null;
  timeWindow: string;
  serveDate: string | null;
  serviceInstructions: string | null;
  notes: string | null;
  recipientName: string;
  recipientAddress: string;
  recipientGps?: { lat: number; lng: number } | null;
  documentType: string;
  caseNumber: string | null;
  courtName: string | null;
  jurisdiction: string | null;
  clientName: string | null;
  attorneyName: string | null;
  officerName: string;
  officerBadge: string;
  attempts: Array<{
    number: number;
    date: string;
    time: string;
    type: string;
    result: string;
    officerName: string;
    notes: string;
    gpsLat: number | null;
    gpsLng: number | null;
  }>;
  skipTraces?: Array<{
    date: string;
    searchType: string;
    addressesFound: number;
    addressesTried: string[];
  }>;
}

// ── Priority labels ──────────────────────────────────────────

const PRIORITY_LABEL: Record<string, string> = {
  routine: 'ROUTINE',
  normal:  'NORMAL',
  rush:    'RUSH',
  urgent:  'URGENT',
};

const TIME_WINDOW_LABEL: Record<string, string> = {
  morning:   'MORNING (07:00-10:00)',
  afternoon: 'AFTERNOON (12:00-17:00)',
  evening:   'EVENING (17:00-21:00)',
  anytime:   'ANYTIME',
};

// ── Blank field-note lines ───────────────────────────────────

function addBlankLines(doc: jsPDF, y: number, count: number): number {
  const lx = getLeftX();
  const ffw = getFullFieldWidth(doc);
  const lineGap = 8;
  doc.setDrawColor(...COLOR.BORDER_FIELD_RULE);
  doc.setLineWidth(BORDER.SIGNATURE_LINE);
  for (let i = 0; i < count; i++) {
    const lineY = y + lineGap * i + lineGap;
    doc.line(lx, lineY, lx + ffw, lineY);
  }
  return y + lineGap * count + SPACING.SM;
}

// ── Main generator ───────────────────────────────────────────

export async function generateServeJobSheet(data: ServeJobSheetData): Promise<jsPDF> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
  registerArialFont(doc);

  await loadPdfAssets();
  const branding = await fetchPdfBranding();
  setActiveBranding(branding);
  setActiveSectionStyle('light');
  setActiveFormKey('PS-300');
  setActiveCaseNumber(data.caseNumber || `JOB-${data.jobId}`);
  stampGenerationTime();

  const lx = getLeftX();
  const rx = getRightColumnX(doc);
  const hfw = getHalfFieldWidth(doc);
  const ffw = getFullFieldWidth(doc);
  const qw = Math.floor(hfw / 2); // quarter width

  // Show both identifiers: agency job ref in the main case-number slot,
  // court case number (if present) as a supplemental field in section 3.
  const headerRef = `JOB-${data.jobId}`;
  setActiveCaseNumber(headerRef);
  let y = drawNibrsHeader(doc, {
    stateIdentifier: 'STATE OF UTAH',
    agencyName: 'ROCKY MOUNTAIN PROTECTIVE GROUP',
    formTitle: 'PROCESS SERVER JOB INFORMATION SHEET',
    caseNumber: headerRef,
    caseNumberLabel: 'AGENCY JOB #',
    formNumber: 'FORM PS-300',
  });

  // ── Section 1: Job Information ─────────────────────────────
  y = checkPageBreak(doc, y, 20);
  { const sec = openAutoSection(doc, '1. Job Information', y); y = sec.contentY;
    const r1a = addFieldPair(doc, 'Job ID', `JOB-${data.jobId}`, lx, y, qw);
    const r1b = addFieldPair(doc, 'Priority', PRIORITY_LABEL[data.priority] || (data.priority || 'N/A').toUpperCase(), lx + qw + SPACING.SM, y, qw);
    const r1c = addFieldPair(doc, 'Status', toDisplayLabel(data.status || 'N/A').toUpperCase(), rx, y, hfw);
    y = Math.max(r1a, r1b, r1c);
    const r2a = addFieldPair(doc, 'Serve Date', data.serveDate || 'Not yet served', lx, y, hfw);
    const r2b = addFieldPair(doc, 'Deadline', data.deadline || 'None', rx, y, hfw);
    y = Math.max(r2a, r2b);
    y = addFieldPair(doc, 'Preferred Time Window', TIME_WINDOW_LABEL[data.timeWindow] || (data.timeWindow || 'N/A').toUpperCase(), lx, y, ffw);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Section 2: Recipient Information ──────────────────────
  y = checkPageBreak(doc, y, 20);
  { const sec = openAutoSection(doc, '2. Recipient Information', y); y = sec.contentY;
    y = addFieldPair(doc, 'Recipient Name', data.recipientName, lx, y, ffw);
    y = addFieldPair(doc, 'Service Address', data.recipientAddress || 'N/A', lx, y, ffw);
    if (data.recipientGps) {
      y = addFieldPair(doc, 'GPS Coordinates', `${data.recipientGps.lat.toFixed(6)}, ${data.recipientGps.lng.toFixed(6)}`, lx, y, ffw);
    }
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Service-address map — same static-image + tactical-overlay treatment as
  // the CFS/property maps (reuses recordPdfGenerator's addLocationMapSection
  // rather than re-implementing the Mapbox Static Images call). Best-effort:
  // silently omitted if geocoding/the token/the network call fails, since
  // fetchLocationMapImage never throws.
  y = await addLocationMapSection(doc, {
    title: 'Service Address Map',
    lat: data.recipientGps?.lat ?? null,
    lng: data.recipientGps?.lng ?? null,
    address: data.recipientAddress,
    caption: data.recipientAddress,
    style: 'mapbox/streets-v12',
    zoom: 17,
  }, y);

  // ── Section 3: Document / Case Information ─────────────────
  y = checkPageBreak(doc, y, 20);
  { const sec = openAutoSection(doc, '3. Document / Case Information', y); y = sec.contentY;
    y = addFieldPair(doc, 'Document Type', data.documentType, lx, y, ffw);
    const r1a = addFieldPair(doc, 'Case Number', data.caseNumber || 'Not assigned', lx, y, hfw);
    const r1b = addFieldPair(doc, 'Jurisdiction', data.jurisdiction || 'N/A', rx, y, hfw);
    y = Math.max(r1a, r1b);
    y = addFieldPair(doc, 'Court Name', data.courtName || 'N/A', lx, y, ffw);
    const r2a = addFieldPair(doc, 'Client / Firm', data.clientName || 'N/A', lx, y, hfw);
    const r2b = addFieldPair(doc, 'Attorney', data.attorneyName || 'N/A', rx, y, hfw);
    y = Math.max(r2a, r2b);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Section 4: Service Instructions & Notes ────────────────
  if (data.serviceInstructions || data.notes) {
    y = checkPageBreak(doc, y, 20);
    const sec = openAutoSection(doc, '4. Service Instructions & Notes', y); y = sec.contentY;
    if (data.serviceInstructions) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(FONT.SIZE_FIELD_LABEL);
      doc.setTextColor(...COLOR.TEXT_SECONDARY);
      doc.text('SERVICE INSTRUCTIONS', lx, y + getCapHeight(FONT.SIZE_FIELD_LABEL));
      // addWrappedText treats its `y` as the first line's own BASELINE (it
      // has no leading capHeight offset like addFieldPair's value renderer
      // does), so advancing only SPACING.LG past the label's baseline left
      // the value's first line landing almost on top of it — the label and
      // "MUST ATTEMPT WITHIN 48 HOURS..." rendered on the same row (live PDF
      // 2026-08-08). Clear the value font's own cap height too.
      y += SPACING.LG + getCapHeight(FONT.SIZE_FIELD_VALUE ?? 9);
      y = addWrappedText(doc, sanitizePdfText(data.serviceInstructions), lx, y, ffw, FONT.SIZE_FIELD_VALUE ?? 9);
      y += SPACING.SM;
    }
    if (data.notes) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(FONT.SIZE_FIELD_LABEL);
      doc.setTextColor(...COLOR.TEXT_SECONDARY);
      doc.text('NOTES', lx, y + getCapHeight(FONT.SIZE_FIELD_LABEL));
      // Same first-line-baseline clearance fix as SERVICE INSTRUCTIONS above.
      y += SPACING.LG + getCapHeight(FONT.SIZE_FIELD_VALUE ?? 9);
      y = addWrappedText(doc, sanitizePdfText(data.notes), lx, y, ffw, FONT.SIZE_FIELD_VALUE ?? 9);
      y += SPACING.SM;
    }
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Section 5: Attempt History ─────────────────────────────
  y = checkPageBreak(doc, y, 30);
  { const sec = openAutoSection(doc, `5. Attempt History  (${data.attempts.length} recorded)`, y); y = sec.contentY;

    if (data.attempts.length === 0) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(FONT.SIZE_FIELD_VALUE ?? 9);
      doc.setTextColor(...COLOR.TEXT_TERTIARY);
      doc.text('No attempts recorded.', lx, y + getCapHeight(FONT.SIZE_FIELD_VALUE ?? 9));
      y += SPACING.LG + SPACING.SM;
    } else {
      const cols = getProportionalColumns(doc, [0.5, 1.5, 1, 1.2, 1.5, 1.5, 2.5]);
      const headers = [
        { label: '#',       x: cols[0] },
        { label: 'DATE',    x: cols[1] },
        { label: 'TIME',    x: cols[2] },
        { label: 'TYPE',    x: cols[3] },
        { label: 'RESULT',  x: cols[4] },
        { label: 'OFFICER', x: cols[5] },
        { label: 'NOTES',   x: cols[6] },
      ];
      const rows = data.attempts.map(a => [
        String(a.number),
        sanitizePdfText(a.date || '—'),
        sanitizePdfText(a.time || '—'),
        sanitizePdfText((a.type || '').toUpperCase()),
        sanitizePdfText(toDisplayLabel(a.result || '—').toUpperCase()),
        sanitizePdfText(a.officerName || '—'),
        sanitizePdfText(a.notes || ''),
      ]);
      y = addTableWithShading(doc, headers, rows, y, cols);
      y += SPACING.SM;

      // GPS sub-detail below the table for attempts that have coordinates
      const gpsAttempts = data.attempts.filter(a => a.gpsLat != null && a.gpsLng != null);
      if (gpsAttempts.length > 0) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(FONT.SIZE_FIELD_LABEL);
        doc.setTextColor(...COLOR.TEXT_SECONDARY);
        doc.text('GPS COORDINATES BY ATTEMPT', lx, y + getCapHeight(FONT.SIZE_FIELD_LABEL));
        y += SPACING.LG;
        for (const a of gpsAttempts) {
          doc.setFont('courier', 'normal');
          doc.setFontSize(FONT.SIZE_FIELD_VALUE ?? 9);
          doc.setTextColor(...COLOR.TEXT_PRIMARY);
          doc.text(
            `#${a.number}  ${a.gpsLat!.toFixed(6)}, ${a.gpsLng!.toFixed(6)}`,
            lx + SPACING.CONTENT_INSET,
            y + getCapHeight(FONT.SIZE_FIELD_VALUE ?? 9),
          );
          y += SPACING.MD;
        }
        y += SPACING.SM;
      }
    }
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Section 6: Skip Trace Results ─────────────────────────
  // Always rendered — skipping it entirely causes a 5→7 numbering gap on
  // the printed form, which looks like a missing page to the recipient.
  y = checkPageBreak(doc, y, 30);
  { const count = data.skipTraces?.length ?? 0;
    const sec = openAutoSection(doc, `6. Skip Trace Results  (${count} searches)`, y); y = sec.contentY;
    if (count > 0) {
      const cols = getProportionalColumns(doc, [1.5, 1.5, 0.7, 4]);
      const headers = [
        { label: 'DATE',      x: cols[0] },
        { label: 'SOURCE',    x: cols[1] },
        { label: '# ADDRS',   x: cols[2] },
        { label: 'ADDRESSES', x: cols[3] },
      ];
      const rows = data.skipTraces!.map(t => [
        sanitizePdfText(t.date || '—'),
        sanitizePdfText((t.searchType || '').toUpperCase()),
        String(t.addressesFound),
        sanitizePdfText(t.addressesTried.join('; ') || 'None'),
      ]);
      y = addTableWithShading(doc, headers, rows, y, cols);
      y += SPACING.SM;
    } else {
      doc.setFont('Arial', 'italic');
      doc.setFontSize(9);
      doc.setTextColor(120, 120, 120);
      doc.text('No skip trace searches recorded.', getLeftX(), y);
      y += 6;
    }
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Section 7: Field Notes (blank writing lines) ───────────
  y = checkPageBreak(doc, y, 50);
  { const sec = openAutoSection(doc, '7. Field Notes  (handwritten)', y); y = sec.contentY;
    y += SPACING.SM;
    y = addBlankLines(doc, y, 8);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Section 8: Certification ───────────────────────────────
  y = checkPageBreak(doc, y, 40);
  { const sec = openAutoSection(doc, '8. Service Officer Certification', y); y = sec.contentY;
    const certText =
      'I certify that the information above is accurate and complete to the best of my knowledge, ' +
      'and that I am a licensed or authorized process server acting in an official capacity for ' +
      'Rocky Mountain Protective Group.';
    y = addWrappedText(doc, certText, lx, y, ffw, FONT.SIZE_CERTIFICATION);
    y += SPACING.LG;

    const fy1 = addFieldPair(doc, 'Officer Name', data.officerName, lx, y, hfw, undefined, FONT.SIZE_FIELD_LABEL);
    const fy2 = addFieldPair(doc, 'Badge / License #', data.officerBadge || 'N/A', rx, y, hfw, undefined, FONT.SIZE_FIELD_LABEL);
    y = Math.max(fy1, fy2);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Signature block
  y = checkPageBreak(doc, y, 30);
  addSignatureBlock(doc, 'Process Server Signature', lx, y, ffw, {
    printedName: data.officerName,
    badgeNumber: data.officerBadge,
    date: '',
  });

  // Add page footers
  const totalPages = doc.internal.pages.length - 1;
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    addPageFooter(doc, i, totalPages, 'serve_job_sheet');
  }

  finalizePoliceReport(doc, {
    barcode: {
      formMetadata: {
        form: 'JOB-SHEET-PS-300',
        caseNumber: data.caseNumber || `JOB-${data.jobId}`,
        agency: 'RMPG',
        agencyOri: 'UT0180100',
        reportDate: localToday(),
        officer: data.officerName,
        badge: data.officerBadge,
      },
    },
  });

  return doc;
}

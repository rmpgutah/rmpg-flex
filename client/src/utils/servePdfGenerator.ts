// ============================================================
// RMPG Flex — Process Server PDF Generator
// Affidavit of Service, Affidavit of Non-Service, Service Log
// Reuses helpers from pdfGenerator.ts + pdfTokens.ts
// ============================================================

import jsPDF from 'jspdf';
import {
  addConfidentialWatermark,
  addReportHeader,
  openAutoSection,
  closeAutoSection,
  addFieldPair,
  addSignatureBlock,
  addTableWithShading,
  addWrappedText,
  setConfidentialWatermarkEnabled,
  addPageFooter,
  checkPageBreak,
  setGenerationTimestamp,
  fetchPdfBranding,
  setActiveBranding,
  loadPdfAssets,
  setActiveFormKey,
  setActiveCaseNumber,
  formSectionPageBreak,
  sanitizePdfText,
  finalizePoliceReport,
  resolveSectionAccentColor,
  fitPdfText,
  stampGenerationTime,
} from './pdfGenerator';
import { lookupPsoCode, formatCodeFull } from '../constants/processServiceCodes';
import {
  LAYOUT, SPACING, FONT, COLOR, BORDER,
  PDF_VALUE_FONT,
  getContentWidth, getFullFieldWidth,
  getLeftX, getRightColumnX, getHalfFieldWidth,
  getProportionalColumns, getCapHeight,
  applyPrintTarget, type PrintTarget,
} from './pdfTokens';
import { drawNibrsHeader } from './pdfFormHelpers';
import { registerArialFont } from './pdf/fonts/registerArial';
import { parseTimestamp } from './dateUtils';

// ── Data Interfaces ──────────────────────────────────────────

export interface AffidavitOfServiceData {
  courtName: string;
  caseNumber: string;
  jurisdiction: string;
  serverName: string;
  serverBadge: string;
  serverCompany: string;
  recipientName: string;
  recipientAddress: string;
  documentType: string;
  serviceDate: string;
  serviceTime: string;
  serviceMethod: 'personal' | 'substitute' | 'posting';
  gpsLat: number;
  gpsLng: number;
  substituteInfo?: { name: string; relationship: string; description: string };
  photos?: string[]; // base64 data URIs
  signature?: string; // base64 canvas data URI
}

export interface AffidavitOfNonServiceData {
  courtName: string;
  caseNumber: string;
  jurisdiction: string;
  serverName: string;
  serverBadge: string;
  recipientName: string;
  recipientAddress: string;
  documentType: string;
  attempts: Array<{
    number: number;
    date: string;
    time: string;
    gpsLat: number;
    gpsLng: number;
    result: string;
    notes: string;
    photos?: string[];
  }>;
  skipTraces?: Array<{
    date: string;
    searchType: string;
    addressesFound: number;
    addressesTried: string[];
  }>;
  signature?: string;
}

// A Notice of Attempt to Serve documents one or more UNSUCCESSFUL service
// attempts. Unlike the Affidavit of Non-Service (sworn + notarized, filed with
// the court), this is an unsworn professional notice left at the address or sent
// to the recipient/client — so it carries a notice statement + contact-for-
// service block instead of a perjury declaration and notary section.
export interface NoticeOfAttemptData {
  noticeDate: string;
  /**
   * The COURT case number (e.g. "2026-CA-000610") for field "5. Case Number".
   * Empty / undefined renders as N/A. This is NOT the agency's internal
   * reference — that goes in agencyRefNumber and prints in the header.
   */
  caseNumber: string;
  /**
   * The AGENCY's internal reference (CFS#, serve_queue JOB#, etc.). Renders
   * at the top-right of the NIBRS header under the "AGENCY REF #" label so
   * the recipient can quote it back when calling our office. Falls back to
   * caseNumber when not supplied (preserves the old behavior for callers
   * that haven't been updated).
   */
  agencyRefNumber?: string;
  courtName: string;
  jurisdiction: string;
  serverName: string;
  serverBadge: string;
  serverCompany?: string;
  serverPhone?: string;
  recipientName: string;
  recipientAddress: string;
  documentType: string;
  clientName?: string;
  attorneyName?: string;
  attempts: Array<{
    number: number;
    date: string;
    time: string;
    result: string;
    notes: string;
    gpsLat?: number | null;
    gpsLng?: number | null;
  }>;
  nextAttemptNote?: string;
  signature?: string;
}

export interface ServiceLogData {
  officerName: string;
  officerBadge: string;
  dateRange: { start: string; end: string };
  jobs: Array<{
    recipientName: string;
    address: string;
    documentType: string;
    clientName: string;
    attempts: number;
    result: string;
    timeSpent?: number; // minutes
  }>;
  totalMileage: number;
  routeEfficiency?: { planned: number; actual: number };
}

// ── Helper: Centered bold title ──────────────────────────────

function addCenteredTitle(doc: jsPDF, title: string, y: number, fontSize = FONT.SIZE_HEADER_TITLE): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(fontSize);
  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  doc.text(sanitizePdfText(title).toUpperCase(), pageWidth / 2, y, { align: 'center' });
  return y + fontSize * 0.5 + SPACING.LG;
}

// ── Helper: Notary section ───────────────────────────────────

function addNotarySection(doc: jsPDF, y: number): number {
  const cw = getContentWidth(doc);
  const lx = getLeftX();
  const boxH = 42; // Notary section fixed height

  y = checkPageBreak(doc, y, boxH + SPACING.LG);

  // Outer border
  doc.setDrawColor(...COLOR.BORDER_SECTION);
  doc.setLineWidth(BORDER.SECTION_OUTER);
  doc.rect(LAYOUT.PAGE_MARGIN, y, cw, boxH);

  // Filled gray header bar — matches openAutoSection's styling (2026-07-13
  // fix) so the notary block reads consistently with every other section
  // on the affidavit instead of the old flat black-text-and-rule look.
  const barH = SPACING.SECTION_HEADER_H;
  const notaryAccentRgb = resolveSectionAccentColor('NOTARY PUBLIC');
  doc.setFillColor(notaryAccentRgb[0], notaryAccentRgb[1], notaryAccentRgb[2]);
  doc.rect(LAYOUT.PAGE_MARGIN, y, cw, barH, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT.SIZE_SECTION_TITLE);
  doc.setTextColor(...COLOR.TEXT_INVERTED);
  doc.text('NOTARY PUBLIC', LAYOUT.PAGE_MARGIN + SPACING.CONTENT_INSET, y + (barH + getCapHeight(FONT.SIZE_SECTION_TITLE)) / 2);

  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  let ny = y + barH + SPACING.LG + 2;

  // Notary lines
  const lineX1 = lx;
  const lineX2 = LAYOUT.PAGE_MARGIN + cw - SPACING.CONTENT_INSET;
  const lineGap = 8; // Notary line spacing

  doc.setDrawColor(...COLOR.TEXT_PRIMARY);
  doc.setLineWidth(BORDER.SIGNATURE_LINE);

  // Notary Name line
  doc.line(lineX1, ny, lineX2, ny);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(FONT.SIZE_SIGNATURE_LABEL);
  doc.setTextColor(...COLOR.TEXT_TERTIARY);
  doc.text('NOTARY NAME', lineX1, ny + 3);
  ny += lineGap;

  // Commission # line
  doc.setDrawColor(...COLOR.TEXT_PRIMARY);
  doc.line(lineX1, ny, lineX2, ny);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(FONT.SIZE_SIGNATURE_LABEL);
  doc.setTextColor(...COLOR.TEXT_TERTIARY);
  doc.text('COMMISSION NUMBER / EXPIRATION', lineX1, ny + 3);
  ny += lineGap;

  // Date line
  doc.setDrawColor(...COLOR.TEXT_PRIMARY);
  doc.line(lineX1, ny, lineX2, ny);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(FONT.SIZE_SIGNATURE_LABEL);
  doc.setTextColor(...COLOR.TEXT_TERTIARY);
  doc.text('DATE', lineX1, ny + 3);

  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  return y + boxH + SPACING.SECTION_GAP;
}

// ── Helper: Embed photos ─────────────────────────────────────

function addPhotos(doc: jsPDF, photos: string[], y: number, label?: string): number {
  if (!photos || photos.length === 0) return y;

  const cw = getContentWidth(doc);
  const lx = getLeftX();
  const imgMaxW = cw - 2 * SPACING.CONTENT_INSET;
  const imgMaxH = 60; // Max attachment image height
  const photosPerPage = 3;

  for (let i = 0; i < photos.length; i++) {
    if (i > 0 && i % photosPerPage === 0) {
      // Already handled by checkPageBreak
    }

    y = checkPageBreak(doc, y, imgMaxH + SPACING.LG + 6);

    if (label && i === 0) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(FONT.SIZE_FIELD_LABEL);
      doc.setTextColor(...COLOR.TEXT_SECONDARY);
      doc.text(label.toUpperCase(), lx, y + 2);
      y += 4;
    }

    try {
      // Determine format from data URI
      const format = photos[i].includes('image/png') ? 'PNG' : 'JPEG';
      doc.addImage(photos[i], format, lx, y, imgMaxW, imgMaxH);

      // Border around image
      doc.setDrawColor(...COLOR.BORDER_FIELD);
      doc.setLineWidth(BORDER.FIELD);
      doc.rect(lx, y, imgMaxW, imgMaxH);
    } catch {
      // Fallback placeholder
      doc.setDrawColor(...COLOR.BORDER_FIELD);
      doc.setLineWidth(BORDER.FIELD);
      doc.rect(lx, y, imgMaxW, imgMaxH);
      doc.setFont(PDF_VALUE_FONT, 'normal');
      doc.setFontSize(FONT.SIZE_FIELD_LABEL);
      doc.setTextColor(...COLOR.TEXT_TERTIARY);
      doc.text('[Image unavailable]', lx + imgMaxW / 2, y + imgMaxH / 2, { align: 'center' });
    }

    // Caption
    doc.setFont(PDF_VALUE_FONT, 'normal');
    doc.setFontSize(FONT.SIZE_FIELD_LABEL);
    doc.setTextColor(...COLOR.TEXT_TERTIARY);
    doc.text(`Photo ${i + 1}`, lx, y + imgMaxH + 3);

    doc.setTextColor(...COLOR.TEXT_PRIMARY);
    y += imgMaxH + 6;
  }

  return y;
}

// ══════════════════════════════════════════════════════════════
// Template 1: Affidavit of Service
// ══════════════════════════════════════════════════════════════

export async function generateAffidavitOfService(data: AffidavitOfServiceData): Promise<jsPDF> {
  const branding = await fetchPdfBranding();
  setActiveBranding(branding);
  await loadPdfAssets();

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
  registerArialFont(doc); // Arial-only output (overrides helvetica/times/courier)
  setActiveFormKey('');
  stampGenerationTime();

  addConfidentialWatermark(doc);
  // @ts-expect-error jsPDF GState — safety reset after watermark
  doc.setGState(new doc.GState({ opacity: 1.0 }));

  const lx = getLeftX();
  const rx = getRightColumnX(doc);
  const hfw = getHalfFieldWidth(doc);
  const ffw = getFullFieldWidth(doc);

  setActiveCaseNumber(data.caseNumber);
  let y = drawNibrsHeader(doc, {
    stateIdentifier: 'STATE OF UTAH',
    agencyName: 'ROCKY MOUNTAIN PROTECTIVE GROUP',
    formTitle: 'AFFIDAVIT OF SERVICE',
    caseNumber: data.caseNumber,
    reportDate: data.serviceDate || '',
  });

  // ── Court Information ──
  y = checkPageBreak(doc, y, 15);
  { const sec = openAutoSection(doc, 'Court Information', y); y = sec.contentY;
    y = addFieldPair(doc, '1. Court Name', data.courtName, lx, y, ffw);
    const fy1 = addFieldPair(doc, '2. Case Number', data.caseNumber, lx, y, hfw);
    const fy2 = addFieldPair(doc, '3. Jurisdiction', data.jurisdiction, rx, y, hfw);
    y = Math.max(fy1, fy2);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Server Information ──
  y = checkPageBreak(doc, y, 15);
  { const sec = openAutoSection(doc, 'Server Information', y); y = sec.contentY;
    const fy1 = addFieldPair(doc, '4. Server Name', data.serverName, lx, y, hfw);
    const fy2 = addFieldPair(doc, '5. Badge / License #', data.serverBadge, rx, y, hfw);
    y = Math.max(fy1, fy2);
    y = addFieldPair(doc, '6. Company', data.serverCompany, lx, y, ffw);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Recipient Information ──
  y = checkPageBreak(doc, y, 15);
  { const sec = openAutoSection(doc, 'Recipient Information', y); y = sec.contentY;
    y = addFieldPair(doc, '7. Recipient Name', data.recipientName, lx, y, ffw);
    y = addFieldPair(doc, '8. Address', data.recipientAddress, lx, y, ffw);
    y = addFieldPair(doc, '9. Document Type Served', data.documentType, lx, y, ffw);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Service Details ──
  const methodLabel = data.serviceMethod === 'personal' ? 'Personal Service'
    : data.serviceMethod === 'substitute' ? 'Substitute Service'
    : 'Posting';
  y = checkPageBreak(doc, y, 15);
  { const sec = openAutoSection(doc, 'Service Details', y); y = sec.contentY;
    const fy1 = addFieldPair(doc, '10. Date of Service', data.serviceDate, lx, y, hfw);
    const fy2 = addFieldPair(doc, '11. Time', data.serviceTime, rx, y, hfw);
    y = Math.max(fy1, fy2);
    const fy3 = addFieldPair(doc, '12. Method', methodLabel, lx, y, hfw);
    const gpsText = (data.gpsLat != null && data.gpsLng != null)
      ? `${Number(data.gpsLat).toFixed(6)}, ${Number(data.gpsLng).toFixed(6)}`
      : 'N/A';
    const fy4 = addFieldPair(doc, '13. GPS', gpsText, rx, y, hfw);
    y = Math.max(fy3, fy4);
    if (data.serviceMethod === 'substitute' && data.substituteInfo) {
      const fy5 = addFieldPair(doc, '14. Substitute Name', data.substituteInfo.name, lx, y, hfw);
      const fy6 = addFieldPair(doc, '15. Relationship', data.substituteInfo.relationship, rx, y, hfw);
      y = Math.max(fy5, fy6);
      y = addFieldPair(doc, '16. Description', data.substituteInfo.description, lx, y, ffw);
    }
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Photos ──
  if (Array.isArray(data.photos) && data.photos.length > 0) {
    y = checkPageBreak(doc, y, 40);
    const sec = openAutoSection(doc, 'Service Photos', y);
    y = sec.contentY;
    y = addPhotos(doc, data.photos, y);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Signature Block ──
  y = checkPageBreak(doc, y, SPACING.SIGNATURE_BOX_H + SPACING.LG);
  y = addSignatureBlock(doc, 'Process Server Signature', lx, y, ffw, data.signature ? {
    signatureImage: data.signature,
    printedName: data.serverName,
    badgeNumber: data.serverBadge,
    date: data.serviceDate,
  } : {
    printedName: data.serverName,
    badgeNumber: data.serverBadge,
    date: data.serviceDate,
  });
  y += SPACING.SECTION_GAP;

  // ── Notary Section ──
  y = addNotarySection(doc, y);

  // ── Footer legal text ──
  y = checkPageBreak(doc, y, 10);
  doc.setFont(PDF_VALUE_FONT, 'normal');
  doc.setFontSize(FONT.SIZE_FOOTER_SECONDARY);
  doc.setTextColor(...COLOR.TEXT_TERTIARY);
  doc.text(
    'Pursuant to Utah Rules of Civil Procedure, Rule 4(d)',
    doc.internal.pageSize.getWidth() / 2,
    y,
    { align: 'center' },
  );

  // Add page footers to all pages
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    addPageFooter(doc, i, totalPages, 'serve_affidavit');
    if (i > 1) addConfidentialWatermark(doc);
  }

  finalizePoliceReport(doc, {
    barcode: {
      formMetadata: {
        form: 'AFFIDAVIT-SERVICE',
        caseNumber: data.caseNumber,
        agency: 'RMPG',
        agencyOri: 'UT0180100',
        reportDate: data.serviceDate,
        officer: data.serverName,
        badge: data.serverBadge,
      },
    },
  });

  return doc;
}

// ══════════════════════════════════════════════════════════════
// Template 2: Affidavit of Non-Service (Due Diligence)
// ══════════════════════════════════════════════════════════════

export async function generateAffidavitOfNonService(data: AffidavitOfNonServiceData): Promise<jsPDF> {
  const branding = await fetchPdfBranding();
  setActiveBranding(branding);
  await loadPdfAssets();

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
  registerArialFont(doc); // Arial-only output (overrides helvetica/times/courier)
  setActiveFormKey('');
  stampGenerationTime();

  addConfidentialWatermark(doc);
  // @ts-expect-error jsPDF GState — safety reset after watermark
  doc.setGState(new doc.GState({ opacity: 1.0 }));

  const lx = getLeftX();
  const rx = getRightColumnX(doc);
  const hfw = getHalfFieldWidth(doc);
  const ffw = getFullFieldWidth(doc);

  setActiveCaseNumber(data.caseNumber);
  let y = drawNibrsHeader(doc, {
    stateIdentifier: 'STATE OF UTAH',
    agencyName: 'ROCKY MOUNTAIN PROTECTIVE GROUP',
    formTitle: 'AFFIDAVIT OF DUE DILIGENCE / NON-SERVICE',
    caseNumber: data.caseNumber,
  });

  // ── Court Information ──
  y = checkPageBreak(doc, y, 15);
  { const sec = openAutoSection(doc, 'Court Information', y); y = sec.contentY;
    y = addFieldPair(doc, '1. Court Name', data.courtName, lx, y, ffw);
    const fy1 = addFieldPair(doc, '2. Case Number', data.caseNumber, lx, y, hfw);
    const fy2 = addFieldPair(doc, '3. Jurisdiction', data.jurisdiction, rx, y, hfw);
    y = Math.max(fy1, fy2);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Server Information ──
  y = checkPageBreak(doc, y, 15);
  { const sec = openAutoSection(doc, 'Server Information', y); y = sec.contentY;
    const fy1 = addFieldPair(doc, '4. Server Name', data.serverName, lx, y, hfw);
    const fy2 = addFieldPair(doc, '5. Badge / License #', data.serverBadge, rx, y, hfw);
    y = Math.max(fy1, fy2);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Recipient Information ──
  y = checkPageBreak(doc, y, 15);
  { const sec = openAutoSection(doc, 'Recipient Information', y); y = sec.contentY;
    y = addFieldPair(doc, '6. Recipient Name', data.recipientName, lx, y, ffw);
    y = addFieldPair(doc, '7. Address', data.recipientAddress, lx, y, ffw);
    y = addFieldPair(doc, '8. Document Type', data.documentType, lx, y, ffw);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Attempt History Table ──
  y = checkPageBreak(doc, y, 30);
  {
    const sec = openAutoSection(doc, 'Attempt History', y);
    y = sec.contentY;

    const cols = getProportionalColumns(doc, [1, 2, 1.5, 3, 2, 3]);
    const headers = [
      { label: '#', x: cols[0] },
      { label: 'DATE', x: cols[1] },
      { label: 'TIME', x: cols[2] },
      { label: 'GPS', x: cols[3] },
      { label: 'RESULT', x: cols[4] },
      { label: 'NOTES', x: cols[5] },
    ];
    const rows = data.attempts.map(a => [
      String(a.number),
      sanitizePdfText(a.date || '').toUpperCase(),
      withZone(sanitizePdfText(a.time || '').toUpperCase()),
      (a.gpsLat != null && a.gpsLng != null)
        ? `${Number(a.gpsLat).toFixed(4)}, ${Number(a.gpsLng).toFixed(4)}`
        : 'N/A',
      sanitizePdfText(a.result || '').toUpperCase(),
      sanitizePdfText(a.notes || '').toUpperCase(),
    ]);

    y = addTableWithShading(doc, headers, rows, y, cols);
    y += SPACING.SM;
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Photos from attempts ──
  for (const attempt of data.attempts) {
    if (attempt.photos && attempt.photos.length > 0) {
      y = checkPageBreak(doc, y, 40);
      const sec = openAutoSection(doc, `Attempt #${attempt.number} Photos`, y);
      y = sec.contentY;
      y = addPhotos(doc, attempt.photos, y, `Attempt #${attempt.number}`);
      y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
    }
  }

  // ── Skip Trace Summary ──
  if (Array.isArray(data.skipTraces) && data.skipTraces.length > 0) {
    y = checkPageBreak(doc, y, 30);
    const sec = openAutoSection(doc, 'Skip Trace Summary', y);
    y = sec.contentY;

    for (const trace of data.skipTraces) {
      y = checkPageBreak(doc, y, 20);
      const rowY = y;
      addFieldPair(doc, 'Date', trace.date, lx, rowY, hfw);
      y = addFieldPair(doc, 'Search Type', trace.searchType, rx, rowY, hfw);
      y += SPACING.SM;
      y = addFieldPair(doc, 'Addresses Found', String(trace.addressesFound), lx, y, hfw);
      y += SPACING.SM;

      if (trace.addressesTried.length > 0) {
        y = addFieldPair(doc, 'Addresses Tried', trace.addressesTried.map(a => sanitizePdfText(a)).join('; '), lx, y, ffw);
        y += SPACING.SM;
      }

      // Separator between traces
      if (data.skipTraces!.indexOf(trace) < data.skipTraces!.length - 1) {
        doc.setDrawColor(...COLOR.BORDER_TABLE);
        doc.setLineWidth(BORDER.TABLE_ROW);
        doc.line(lx, y, lx + ffw, y);
        y += SPACING.MD;
      }
    }

    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Declaration ──
  y = checkPageBreak(doc, y, 30);
  {
    const sec = openAutoSection(doc, 'Declaration', y);
    // addWrappedText draws at the text BASELINE, so the first line's ascender
    // sits ~2.5mm above contentY — pad past the black header band (matches the
    // psoNoticePdfGenerator fix, commit 3c0e68f9).
    y = sec.contentY + 3;

    const declarationText =
      'I, the undersigned, being duly sworn, do hereby declare under penalty of perjury that ' +
      'I have made diligent efforts to serve the above-named recipient with the specified documents. ' +
      'Despite multiple attempts at service at various times and dates as detailed in this affidavit, ' +
      'I was unable to effect service upon the intended recipient. The information contained herein is ' +
      'true and correct to the best of my knowledge and belief.';

    y = addWrappedText(doc, declarationText, lx, y, ffw, FONT.SIZE_FIELD_VALUE);
    y += SPACING.MD;
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Signature Block ──
  y = checkPageBreak(doc, y, SPACING.SIGNATURE_BOX_H + SPACING.LG);
  y = addSignatureBlock(doc, 'Process Server Signature', lx, y, ffw, data.signature ? {
    signatureImage: data.signature,
    printedName: data.serverName,
    badgeNumber: data.serverBadge,
  } : {
    printedName: data.serverName,
    badgeNumber: data.serverBadge,
  });
  y += SPACING.SECTION_GAP;

  // ── Notary Section ──
  y = addNotarySection(doc, y);

  // ── Footer legal text ──
  y = checkPageBreak(doc, y, 10);
  doc.setFont(PDF_VALUE_FONT, 'normal');
  doc.setFontSize(FONT.SIZE_FOOTER_SECONDARY);
  doc.setTextColor(...COLOR.TEXT_TERTIARY);
  doc.text(
    'Pursuant to Utah Rules of Civil Procedure, Rule 4(d)',
    doc.internal.pageSize.getWidth() / 2,
    y,
    { align: 'center' },
  );

  // Add page footers to all pages
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    addPageFooter(doc, i, totalPages, 'serve_non_service');
    if (i > 1) addConfidentialWatermark(doc);
  }

  finalizePoliceReport(doc, {
    barcode: {
      formMetadata: {
        form: 'AFFIDAVIT-NON-SERVICE',
        caseNumber: data.caseNumber,
        agency: 'RMPG',
        agencyOri: 'UT0180100',
        reportDate: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' }),
        officer: data.serverName,
        badge: data.serverBadge,
      },
    },
  });

  return doc;
}

// ══════════════════════════════════════════════════════════════
// Template 2b: Notice of Attempt to Serve (unsuccessful attempt notice)
// ══════════════════════════════════════════════════════════════

/**
 * Human-readable label for a serve_attempt result/reason code. Detects
 * structured PS codes (PS/15.05) first so the new code library wins over
 * legacy enum mapping; falls back to the historical enum labels below for
 * legacy attempts logged before migration 0143.
 */
export function serveResultLabel(result: string): string {
  // Structured code path — accept "PS/15.05" (uppercase or lowercase).
  const psCode = lookupPsoCode(result);
  if (psCode) return formatCodeFull(result);
  switch ((result || '').toLowerCase()) {
    case 'no_answer': return 'No answer at address';
    case 'refused': return 'Service refused';
    case 'wrong_address': return 'Incorrect / bad address';
    case 'moved': return 'Recipient has moved';
    case 'served': return 'Served';
    case 'other': return 'Other (see notes)';
    default: return result ? result.replace(/_/g, ' ') : 'Unsuccessful';
  }
}

export interface NoticeOfAttemptOptions {
  /** 'mobile' (default) renders for the Brother PJ-700/800 in-vehicle thermal
   *  printer: adds a 6mm top safe-zone so the leading-edge dead zone doesn't
   *  clip the NIBRS header. Notice of Attempt is generated and printed in the
   *  field by process servers, never from a desk laser printer, so this
   *  document always defaults to mobile — pass 'office' explicitly to
   *  override for the rare desk-print case. See RecordPdfOptions in
   *  recordPdfGenerator.ts for the same pattern used elsewhere. */
  printTarget?: PrintTarget;
}

/**
 * Stamp the display zone onto a printed attempt time.
 *
 * These documents are recipient- and court-facing, and a serve job routinely
 * spans jurisdictions -- the Clough notice, for instance, is a Utah address
 * served for a Queens County, NY case. A bare "07:35" on that page does not
 * say whether it means Mountain or Eastern, and the reader has no way to
 * resolve it. That ambiguity is the same one that produced the 6-hour
 * timestamp regression this column already suffered.
 *
 * Applied per row rather than in the column header so a row stays unambiguous
 * when read in isolation -- quoted into a filing, cropped, or photocopied.
 * Empty stays empty so the caller's EMPTY placeholder still applies.
 */
export function withZone(time: string): string {
  const t = (time || '').trim();
  if (!t) return '';
  return /\b(MT|MST|MDT|AM|PM)\b/.test(t) ? t : `${t} MT`;
}

export async function generateNoticeOfAttempt(data: NoticeOfAttemptData, options: NoticeOfAttemptOptions = {}): Promise<jsPDF> {
  const branding = await fetchPdfBranding();
  setActiveBranding(branding);
  await loadPdfAssets();

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
  registerArialFont(doc); // Arial-only output (overrides helvetica/times/courier)
  applyPrintTarget(doc, options.printTarget ?? 'mobile');
  setActiveFormKey('');
  stampGenerationTime();

  // The Notice of Attempt is RECIPIENT-facing. The diagonal CONFIDENTIAL
  // watermark used on internal police forms (affidavit, service log)
  // rotated through the body text at low opacity, producing a strikethrough
  // appearance on the first wrapped line of the disclaimer paragraph (the
  // letters of "CONFIDENTIAL" intersected the lowercase descenders). For
  // the recipient-facing notice we drop it — internal-use stamping happens
  // via the page-footer "INTERNAL USE ONLY" band and the corner barcode.

  const lx = getLeftX();
  const rx = getRightColumnX(doc);
  const hfw = getHalfFieldWidth(doc);
  const ffw = getFullFieldWidth(doc);

  // Header uses agencyRefNumber when supplied (the AGENCY's internal CFS
  // or job ref); falls back to caseNumber for back-compat with callers
  // that pre-date the agencyRefNumber field. Label switches accordingly
  // so the recipient knows whether they're looking at OUR reference vs
  // the court's case number.
  const headerRef = data.agencyRefNumber || data.caseNumber;
  setActiveCaseNumber(headerRef);
  let y = drawNibrsHeader(doc, {
    stateIdentifier: 'STATE OF UTAH',
    agencyName: 'ROCKY MOUNTAIN PROTECTIVE GROUP',
    formTitle: 'NOTICE OF ATTEMPT TO SERVE',
    caseNumber: headerRef,
    caseNumberLabel: data.agencyRefNumber ? 'AGENCY REF #' : 'CASE NUMBER',
  });

  // ── Notice Date ──
  y = checkPageBreak(doc, y, 12);
  y = addFieldPair(doc, 'Notice Date', data.noticeDate, lx, y, hfw);

  // ── Recipient / Service Address ──
  y = checkPageBreak(doc, y, 15);
  { const sec = openAutoSection(doc, 'Intended Recipient', y); y = sec.contentY;
    y = addFieldPair(doc, '1. Recipient Name', data.recipientName, lx, y, ffw);
    y = addFieldPair(doc, '2. Service Address', data.recipientAddress, lx, y, ffw);
    y = addFieldPair(doc, '3. Document(s) to Serve', data.documentType, lx, y, ffw);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Case Information ──
  y = checkPageBreak(doc, y, 15);
  { const sec = openAutoSection(doc, 'Case Information', y); y = sec.contentY;
    const fy1 = addFieldPair(doc, '4. Court', data.courtName, lx, y, hfw);
    // Field 5 prints the COURT case number, never the agency ref. When
    // operator hasn't entered a court case, render N/A — the agency CFS#
    // already shows in the header.
    const courtCaseDisplay = (data.caseNumber && data.caseNumber !== headerRef) ? data.caseNumber : 'N/A';
    const fy2 = addFieldPair(doc, '5. Case Number', courtCaseDisplay, rx, y, hfw);
    y = Math.max(fy1, fy2);
    // Hiring Party label: when both the attorney and the client are on
    // record, show both with role disambiguation ("Atty / Client") so the
    // recipient can identify the originating party. Falls back to whichever
    // single name exists, then 'N/A'.
    const hiringPartyLabel = (() => {
      if (data.attorneyName && data.clientName) {
        return `${data.attorneyName} (atty) for ${data.clientName}`;
      }
      return data.attorneyName || data.clientName || 'N/A';
    })();
    const gy1 = addFieldPair(doc, '6. Jurisdiction', data.jurisdiction, lx, y, hfw);
    const gy2 = addFieldPair(doc, '7. Hiring Party', hiringPartyLabel, rx, y, hfw);
    y = Math.max(gy1, gy2);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Attempt Record ──
  // One-page constraint: this notice is left at a door / mailed, so it must fit
  // a single sheet. Show only the most recent attempts (the Affidavit of
  // Non-Service carries the full history) and clamp note length.
  const MAX_NOTICE_ATTEMPTS = 6;
  const MAX_NOTE_CHARS = 90;
  y = checkPageBreak(doc, y, 30);
  {
    const sec = openAutoSection(doc, 'Record of Attempt(s)', y);
    y = sec.contentY;
    const cols = getProportionalColumns(doc, [1, 2, 1.5, 3, 3.5]);
    const headers = [
      { label: '#', x: cols[0] },
      { label: 'DATE', x: cols[1] },
      { label: 'TIME', x: cols[2] },
      { label: 'RESULT', x: cols[3] },
      { label: 'NOTES', x: cols[4] },
    ];
    const shown = data.attempts.slice(-MAX_NOTICE_ATTEMPTS);
    const omitted = data.attempts.length - shown.length;
    // Empty-cell convention: em-dash signals "no data captured" without
    // looking like accidental whitespace. The bridge (ServePage.handle-
    // NoticeOfAttempt) already falls back to created_at when attempt_at
    // is null; if both are missing we land here with an empty string.
    const EMPTY = '—';
    // Inline GPS coords next to the NOTES text so the legal record carries
    // on-scene verification without bloating the table into 6 columns
    // (the recipient-facing notice has to stay scannable). Decimal-degrees
    // with 4 places ≈ 11 m precision, enough to identify a parcel.
    const fmtGps = (lat?: number | null, lng?: number | null): string => {
      if (lat == null || lng == null) return '';
      return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    };
    let anyGps = false;
    const rows = shown.map(a => {
      const note = sanitizePdfText(a.notes || '');
      const gps = fmtGps(a.gpsLat, a.gpsLng);
      if (gps) anyGps = true;
      const noteCore = note
        ? (note.length > MAX_NOTE_CHARS ? `${note.slice(0, MAX_NOTE_CHARS - 1)}…` : note).toUpperCase()
        : '';
      const noteCell = [noteCore, gps && `GPS ${gps}`].filter(Boolean).join(' · ') || EMPTY;
      return [
        String(a.number),
        (sanitizePdfText(a.date || '').toUpperCase() || EMPTY),
        (withZone(sanitizePdfText(a.time || '').toUpperCase()) || EMPTY),
        sanitizePdfText(serveResultLabel(a.result)).toUpperCase(),
        noteCell,
      ];
    });
    y = addTableWithShading(doc, headers, rows, y, cols);
    if (omitted > 0) {
      doc.setFont(PDF_VALUE_FONT, 'italic');
      doc.setFontSize(FONT.SIZE_FOOTER_SECONDARY);
      doc.setTextColor(...COLOR.TEXT_TERTIARY);
      doc.text(
        `${omitted} earlier attempt(s) omitted for space — complete history available in the service log.`,
        lx, y + 3,
      );
      y += 5;
    }
    if (anyGps) {
      doc.setFont(PDF_VALUE_FONT, 'italic');
      doc.setFontSize(FONT.SIZE_FOOTER_SECONDARY);
      doc.setTextColor(...COLOR.TEXT_TERTIARY);
      doc.text(
        'GPS coordinates recorded on-scene for legal verification (WGS-84, decimal degrees).',
        lx, y + 3,
      );
      y += 5;
    }
    y += SPACING.SM;
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
    // Extra clearance before the next section's header bar — the table's own
    // last-row separator line sits right on top of closeAutoSection's gold
    // border (SECTION_BOTTOM_PAD + SECTION_GAP is only ~1.1mm), so without
    // this the two lines read as a doubled rule crammed against the
    // "IMPORTANT NOTICE" header bar below (2026-07-13 visual fix).
    y += SPACING.SM;
  }

  // ── Notice Statement ── (keep the whole block together — it must read as one unit)
  // 55 mm reservation covers lead-band + body + next-attempt + spacing at
  // 7 pt prose. Break BEFORE opening the section so the IMPORTANT NOTICE
  // header isn't orphaned at the bottom of one page with content on the next.
  y = checkPageBreak(doc, y, 55);
  {
    const sec = openAutoSection(doc, 'IMPORTANT NOTICE — ATTEMPTED SERVICE OF LEGAL DOCUMENTS', y);
    y = sec.contentY + 2;
    const company = data.serverCompany || 'Rocky Mountain Protective Group';
    const contact = data.serverPhone ? ` at ${data.serverPhone}` : ' at the number on file';
    const pageWidth = doc.internal.pageSize.getWidth();

    // ── Anti-simulation lead (Utah Code § 76-8-712) ──
    // Tinted background band immediately under the section header so the
    // lead line ANCHORS the section visually instead of floating between
    // unflanked rules. The prior "rule above / rule below" design read as
    // ambiguous — the rules were easy to miss, and on some renders ended
    // up looking like the lead had drifted to the bottom of the page.
    // A solid 8 mm gray band with the bold caps line centered inside it is
    // unambiguous: the lead is PART of the section, not after it.
    const bandH = 8;
    const bandY = y;
    // Light gray FILL only — no outline. The earlier design used a black
    // outline rect, but the band's BOTTOM outline rule (at bandY + bandH)
    // landed almost exactly on the top of the body paragraph's first line,
    // producing a strikethrough appearance on "Rocky Mountain Protective
    // Group, a private process service agency...". The 240/240/240 fill
    // by itself is enough callout — it already contrasts with the white
    // page and the dark IMPORTANT NOTICE header band above it.
    doc.setFillColor(240, 240, 240);
    doc.rect(lx, bandY, ffw, bandH, 'F');
    doc.setFont(PDF_VALUE_FONT, 'bold');
    doc.setFontSize(FONT.SIZE_FIELD_VALUE + 2);
    doc.setTextColor(...COLOR.TEXT_PRIMARY);
    const lead = 'THIS IS NOT A COURT ORDER, A SUMMONS, OR A DEMAND FOR PAYMENT.';
    // Center vertically inside the band: top + (band/2) + (cap-height/2).
    doc.text(lead, pageWidth / 2, bandY + bandH / 2 + 1.8, { align: 'center' });
    // Compact gap after the band — 7 pt body text doesn't need the full LG clearance.
    y = bandY + bandH + SPACING.SM;

    // ── Body prose in mixed case ──
    // ALL CAPS body text reads as shouting on a notice the subject must
    // ACTUALLY read. Police-form ALL-CAPS convention belongs on field
    // labels and table cells; the prose paragraphs here opt out via
    // preserveCase so the document reads as a professional legal notice
    // rather than a 1990s warrant printout. (The lead band above stays
    // caps deliberately — emphasis, not body.)
    // 7 pt keeps the two-paragraph block ~10 mm shorter than 8 pt while
    // remaining legible — critical for fitting all content on one page.
    const NOTICE_FONT = FONT.SIZE_FIELD_VALUE - 1;
    const noticeText =
      `${company}, a private process service agency, has attempted to deliver the legal document(s) ` +
      'identified above to you in connection with the referenced case. As shown in the record of ' +
      'attempt(s) above, delivery has not been completed. To arrange delivery at a date and time ' +
      `convenient to you, you may contact our office${contact}. You are not required to respond to ` +
      'this notice; however, arranging a time for delivery may prevent further attempts at this address.' +
      '\n\n' +
      'This notice was prepared and delivered by a private process server, not by a court or ' +
      'government agency. It does not create, waive, extend, or otherwise affect any deadline, ' +
      'right, or obligation arising from the underlying legal matter. Process service is performed ' +
      'pursuant to Utah Rule of Civil Procedure 4 and Utah Code § 78B-8-302.';
    y = addWrappedText(doc, noticeText, lx, y, ffw, NOTICE_FONT, { preserveCase: true });
    y += SPACING.XS;

    if (data.nextAttemptNote) {
      // Render the next-attempt sentence as a mixed-case italic call-out
      // below the disclaimer prose. The field-pair pattern (NEXT ATTEMPT
      // / WILL RETURN TUESDAY...) would force the value into ALL CAPS via
      // addFieldPair's sanitization — that conflicts with the professional
      // mixed-case body above it. Inline italic keeps the rhythm.
      doc.setFont(PDF_VALUE_FONT, 'bolditalic');
      doc.setFontSize(NOTICE_FONT);
      doc.setTextColor(...COLOR.TEXT_PRIMARY);
      doc.text('Next attempt:', lx, y);
      const labelW = doc.getTextWidth('Next attempt: ');
      doc.setFont(PDF_VALUE_FONT, 'italic');
      const noteLines: string[] = doc.splitTextToSize(
        sanitizePdfText(data.nextAttemptNote, { preserveCase: true }),
        ffw - labelW - 2,
      );
      doc.text(noteLines, lx + labelW, y);
      y += noteLines.length * 3.5 + 1.5;
    }
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── What To Do Next (recipient guidance) ──
  // Most recipients reading a "Notice of Attempt to Serve" have never seen
  // one before. The disclaimer block answers "what is this?"; this block
  // answers "what do I actually do now?" with three concrete numbered
  // actions. Helps prevent the two most common operator headaches: a
  // recipient ignoring the notice (and getting served at work) or
  // assuming it's a scam.
  y = checkPageBreak(doc, y, 30);
  {
    const sec = openAutoSection(doc, 'What To Do Next', y);
    y = sec.contentY + 2;
    const company = data.serverCompany || 'Rocky Mountain Protective Group';
    const phoneCue = data.serverPhone
      ? `at ${data.serverPhone}`
      : 'at the number printed on this notice';
    // 7 pt keeps the four-step block ~12 mm shorter than 8 pt.
    const STEP_FONT = FONT.SIZE_FIELD_VALUE - 1;
    const steps: string[] = [
      `Contact ${company} ${phoneCue} to arrange a convenient delivery time. A short call will prevent further visits to this address and may be more discreet than service at your workplace.`,
      'Verify this notice. If you would like to confirm it is genuine, call our office and reference the AGENCY REF # printed at the top of this notice — we will confirm the assigned process server and the underlying matter without requiring you to share any personal information.',
      'Read the underlying documents once delivered. The papers we have been engaged to deliver may contain time-sensitive deadlines. This notice does NOT extend, waive, or otherwise affect those deadlines.',
      'Do nothing only if you accept that further service attempts will be made at this address, including at times that may be inconvenient (early morning, evening, or weekend) and at locations associated with you (residence, workplace, or known third-party).',
    ];
    doc.setFont(PDF_VALUE_FONT, 'normal');
    doc.setFontSize(STEP_FONT);
    doc.setTextColor(...COLOR.TEXT_PRIMARY);
    steps.forEach((step, i) => {
      // Number prefix in bold, body in normal — readable hierarchy.
      const numLabel = `${i + 1}.`;
      doc.setFont(PDF_VALUE_FONT, 'bold');
      doc.text(numLabel, lx, y);
      const numW = doc.getTextWidth(numLabel) + 2;
      doc.setFont(PDF_VALUE_FONT, 'normal');
      y = addWrappedText(doc, step, lx + numW, y, ffw - numW, STEP_FONT, { preserveCase: true });
      y += SPACING.XS;
    });
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Server Signature (unsworn — this is a notice, not an affidavit) ──
  y = checkPageBreak(doc, y, SPACING.SIGNATURE_BOX_H + SPACING.LG);
  y = addSignatureBlock(doc, 'Process Server', lx, y, ffw, data.signature ? {
    signatureImage: data.signature,
    printedName: data.serverName,
    badgeNumber: data.serverBadge,
  } : {
    printedName: data.serverName,
    badgeNumber: data.serverBadge,
  });
  y += SPACING.SM;

  // ── Contact line (recipient-facing call-to-action) ──
  // Centered bold line immediately after the signature so the person at
  // the door can call without looking up the agency number.
  if (data.serverPhone) {
    y = checkPageBreak(doc, y, 8);
    const pageWidth = doc.internal.pageSize.getWidth();
    doc.setFont(PDF_VALUE_FONT, 'bold');
    doc.setFontSize(FONT.SIZE_FIELD_VALUE + 1);
    doc.setTextColor(...COLOR.TEXT_PRIMARY);
    const company = data.serverCompany || 'Rocky Mountain Protective Group';
    doc.text(`To arrange delivery, contact ${company}: ${data.serverPhone}`,
      pageWidth / 2, y + 3, { align: 'center' });
    y += 8;
  }
  y += SPACING.XS;

  // ── Footer legal text ──
  y = checkPageBreak(doc, y, 8);
  doc.setFont(PDF_VALUE_FONT, 'normal');
  doc.setFontSize(FONT.SIZE_FOOTER_SECONDARY);
  doc.setTextColor(...COLOR.TEXT_TERTIARY);
  doc.text(
    'Process service pursuant to Utah R. Civ. P. 4 and Utah Code § 78B-8-302 (registered private process server)',
    doc.internal.pageSize.getWidth() / 2, y, { align: 'center' },
  );

  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    addPageFooter(doc, i, totalPages, 'serve_notice_of_attempt');
    // Watermark intentionally omitted on the Notice of Attempt — it's
    // recipient-facing, and the diagonal CONFIDENTIAL caused strikethrough
    // appearance on the disclaimer paragraph's first line.
  }

  finalizePoliceReport(doc, {
    barcode: {
      formMetadata: {
        form: 'NOTICE-OF-ATTEMPT',
        caseNumber: data.caseNumber,
        agency: 'RMPG',
        agencyOri: 'UT0180100',
        reportDate: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' }),
        officer: data.serverName,
        badge: data.serverBadge,
      },
    },
  });

  return doc;
}

// ══════════════════════════════════════════════════════════════
// Template 3: Service Log Report
// ══════════════════════════════════════════════════════════════

export async function generateServiceLog(data: ServiceLogData): Promise<jsPDF> {
  const branding = await fetchPdfBranding();
  setActiveBranding(branding);
  await loadPdfAssets();

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
  registerArialFont(doc); // Arial-only output (overrides helvetica/times/courier)
  setActiveFormKey('');
  stampGenerationTime();

  addConfidentialWatermark(doc);
  // @ts-expect-error jsPDF GState — safety reset after watermark
  doc.setGState(new doc.GState({ opacity: 1.0 }));

  const lx = getLeftX();
  const rx = getRightColumnX(doc);
  const hfw = getHalfFieldWidth(doc);
  const ffw = getFullFieldWidth(doc);

  const dateRangeLabel = `${sanitizePdfText(data.dateRange.start)} -- ${sanitizePdfText(data.dateRange.end)}`;
  setActiveCaseNumber('');
  let y = drawNibrsHeader(doc, {
    stateIdentifier: 'STATE OF UTAH',
    agencyName: 'ROCKY MOUNTAIN PROTECTIVE GROUP',
    formTitle: 'SERVICE LOG REPORT',
    reportDate: dateRangeLabel,
  });

  // ── Officer Information ──
  y = checkPageBreak(doc, y, 15);
  { const sec = openAutoSection(doc, 'Officer Information', y); y = sec.contentY;
    const fy1 = addFieldPair(doc, '1. Officer Name', data.officerName, lx, y, hfw);
    const fy2 = addFieldPair(doc, '2. Badge #', data.officerBadge, rx, y, hfw);
    y = Math.max(fy1, fy2);
    y = addFieldPair(doc, '3. Date Range', dateRangeLabel, lx, y, ffw);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Summary Statistics ──
  const served = data.jobs.filter(j => (j.result || '').toLowerCase() === 'served').length;
  const failed = data.jobs.filter(j => ['failed', 'unable'].some(s => (j.result || '').toLowerCase().includes(s))).length;
  const pending = data.jobs.filter(j => (j.result || '').toLowerCase() === 'pending').length;

  y = checkPageBreak(doc, y, 15);
  { const sec = openAutoSection(doc, 'Summary Statistics', y); y = sec.contentY;
    const fy1 = addFieldPair(doc, '4. Total Jobs', String(data.jobs.length), lx, y, hfw);
    const fy2 = addFieldPair(doc, '5. Served', String(served), rx, y, hfw);
    y = Math.max(fy1, fy2);
    const fy3 = addFieldPair(doc, '6. Failed', String(failed), lx, y, hfw);
    const fy4 = addFieldPair(doc, '7. Pending', String(pending), rx, y, hfw);
    y = Math.max(fy3, fy4);
    y = addFieldPair(doc, '8. Miles Driven', data.totalMileage != null ? data.totalMileage.toFixed(1) : '0', lx, y, hfw);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Job Details Table ──
  y = checkPageBreak(doc, y, 30);
  {
    const sec = openAutoSection(doc, 'Job Details', y);
    y = sec.contentY;

    const cols = getProportionalColumns(doc, [3, 3, 2, 1.5, 2]);
    const headers = [
      { label: 'RECIPIENT', x: cols[0] },
      { label: 'ADDRESS', x: cols[1] },
      { label: 'DOC TYPE', x: cols[2] },
      { label: 'ATTEMPTS', x: cols[3] },
      { label: 'RESULT', x: cols[4] },
    ];

    // Group jobs by client name
    const clientGroups = new Map<string, typeof data.jobs>();
    for (const job of data.jobs) {
      const client = job.clientName || 'Unassigned';
      if (!clientGroups.has(client)) clientGroups.set(client, []);
      clientGroups.get(client)!.push(job);
    }

    const rows: string[][] = [];
    Array.from(clientGroups.entries()).forEach(([clientName, jobs]) => {
      // Group header row (bold client name spanning first column, rest empty)
      rows.push([`[${sanitizePdfText(clientName).toUpperCase()}]`, '', '', '', '']);
      for (const job of jobs) {
        rows.push([
          sanitizePdfText(job.recipientName || '').toUpperCase(),
          sanitizePdfText(job.address || '').toUpperCase(),
          sanitizePdfText(job.documentType || '').toUpperCase(),
          String(job.attempts),
          sanitizePdfText(job.result || '').toUpperCase(),
        ]);
      }
    });

    y = addTableWithShading(doc, headers, rows, y, cols);
    y += SPACING.SM;
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Route Efficiency ──
  if (data.routeEfficiency) {
    y = checkPageBreak(doc, y, 25);
    const sec = openAutoSection(doc, 'Route Efficiency', y);
    y = sec.contentY;
    const rowY = y;
    // Guard individual numeric members of routeEfficiency — the parent
    // object may be present but .planned/.actual can be null from sparse
    // data. .toFixed() on null throws TypeError. (Wave 3.1)
    addFieldPair(doc, 'Planned Mileage', data.routeEfficiency.planned != null ? data.routeEfficiency.planned.toFixed(1) : '0', lx, rowY, hfw);
    y = addFieldPair(doc, 'Actual Mileage', data.routeEfficiency.actual != null ? data.routeEfficiency.actual.toFixed(1) : '0', rx, rowY, hfw);
    y += SPACING.SM;

    const efficiency = data.routeEfficiency.planned > 0
      ? ((data.routeEfficiency.actual / data.routeEfficiency.planned) * 100).toFixed(1)
      : 'N/A';
    y = addFieldPair(doc, 'Efficiency', efficiency !== 'N/A' ? `${efficiency}%` : efficiency, lx, y, hfw);
    y += SPACING.SM;
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Add page footers to all pages
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    addPageFooter(doc, i, totalPages, 'service_log');
    if (i > 1) addConfidentialWatermark(doc);
  }

  finalizePoliceReport(doc, {
    barcode: {
      formMetadata: {
        form: 'SERVICE-LOG',
        caseNumber: `LOG-${(data.dateRange?.start || new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' })).replace(/-/g, '')}`,
        agency: 'RMPG',
        agencyOri: 'UT0180100',
        reportDate: data.dateRange?.end || new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' }),
        officer: data.officerName,
        badge: data.officerBadge,
      },
    },
  });

  return doc;
}


// ============================================================
// Acknowledgement of Service Form — four printed variations
//
// One generator, four titles: (Individual), (Co-Habitant), (Business),
// (Substitute Service). The variant is resolved on the signing page by
// resolveReceiptVariant() and arrives here already decided — this
// function renders what was signed, it does not re-derive it.
//
// This is the RECIPIENT's document, not the court's. Deliberately
// different from generateAffidavitOfService above:
//   * The affidavit is the SERVER's sworn statement to the court, with a
//     notary block. This is the RECIPIENT's acknowledgment, signed by
//     them, with no notary — a notary block on a form handed to a
//     defendant implies a solemnity it does not have.
//   * NO CONFIDENTIAL WATERMARK. Every other generator in this file
//     stamps one; this document is handed to a member of the public by
//     design, so marking their own copy confidential is both wrong and
//     intimidating.
//
// Attestations are printed VERBATIM from what the signer was shown
// (serve_receipts.attestations_json), not regenerated from current
// copy — otherwise editing the wording would silently rewrite what
// past signers appear to have agreed to.
//
// Prose blocks pass preserveCase: this is read by a member of the
// public, and the all-caps field convention used elsewhere reads as
// shouting in a paragraph.
// ============================================================

/** Company file / person served / hiring client. */
export type ReceiptCopy = 'company' | 'subject' | 'client';

export const RECEIPT_COPY_LABEL: Record<ReceiptCopy, string> = {
  company: 'Company Record',
  subject: 'Subject Copy',
  client: 'Client Copy',
};

/** Print order. The agency keeps the first sheet off the printer. */
export const RECEIPT_COPY_ORDER: ReceiptCopy[] = ['company', 'subject', 'client'];

export type ReceiptVariantKey = 'individual' | 'co_habitant' | 'business' | 'substitute';

export interface ReceiptAttestationLine {
  id: string;
  text: string;
  accepted: boolean;
}

export interface ReceiptOfServiceData {
  receiptId: number;
  /** e.g. "Acknowledgement of Service Form (Co-Habitant)". */
  formTitle: string;
  variant: ReceiptVariantKey;
  variantLabel: string;

  courtName: string;
  caseNumber: string;
  jurisdiction: string;
  plaintiffName: string;
  defendantName: string;
  documentType: string;

  serviceAddress: string;
  premisesType: string;
  serverName: string;
  serverBadge: string;
  agency: string;

  recipientName: string;
  recipientRelationship?: string;
  recipientJobTitle?: string;
  businessName?: string;
  recipientPhone?: string;
  /** Named individual or business the signer accepted on behalf of. */
  acceptingOnBehalfOf?: string;

  documents: Array<{ title: string; copies: number }>;
  attestations: ReceiptAttestationLine[];

  residesAtAddress: boolean;
  authorizedAgent: boolean;
  expectedDeliveryAt?: string;

  signedAt: string;           // ISO
  gps?: { lat: number; lng: number };
  signature?: string;         // base64 PNG data URL

  /**
   * Photographs taken at the moment of signature — the door, the
   * premises, the person if they consented.
   *
   * A proof of service is testimony about a place and a moment. A photo of
   * the door taken as it was signed answers "were you actually there?"
   * better than a coordinate pair does, and it is the question a contested
   * service turns on. Base64 data URIs, already downscaled by the caller.
   */
  photos?: string[];

  /**
   * Which of the three copies this render is.
   *
   * A completed service produces three sheets off the same instrument:
   * the agency's file copy, the copy left with the person served, and the
   * copy that goes back to the hiring client. They are the SAME document
   * — identical content, identical signature — distinguished only by the
   * designation stamp and the footer, because three sheets coming off a
   * roll printer are otherwise indistinguishable in a folder.
   */
  copy?: ReceiptCopy;

  /**
   * BLANK PAPER MODE.
   *
   * Renders the identical instrument with every SUBJECT-SUPPLIED value
   * replaced by a writable rule or a pair of tick boxes, so the person
   * being served can complete it by hand when they have no phone, no
   * signal, or no wish to scan anything. Case and party data stay
   * PRINTED — the officer knows those, and asking a defendant to
   * transcribe their own case number invites errors into a legal record.
   *
   * Deliberately the same function rather than a separate blank-form
   * generator: if the paper and the screen can drift, they will, and the
   * one place that must never happen is the wording of the declarations
   * a person signs.
   */
  blank?: boolean;

  /**
   * PNG data URL of the receipt QR, printed on the blank form so the
   * subject can abandon the paper and finish on their phone at any
   * point. Rendered client-side because Workers cannot rasterize.
   */
  qrDataUrl?: string;

  /**
   * Place of execution for the closing clause ("Executed at ... on ...").
   * Defaults to the address of service, which is correct in the ordinary
   * case; supplied separately only when the signature is taken somewhere
   * other than where the papers were left.
   */
  executionPlace?: string;

  /**
   * NOTE ON WHAT IS DELIBERATELY ABSENT: there is no perjury
   * declaration on this instrument. Utah Code section 78B-5-705 would
   * permit an unsworn one, and it would add weight — but it directly
   * contradicts the NOTICE paragraph this form leads with, and a
   * perjury warning presented to a defendant at their own door is a
   * substantive escalation, not a formatting choice. Adding it is a
   * business and legal decision, not a layout one.
   */

  /**
   * 'office' (default) targets a laser/inkjet. 'mobile' targets the
   * in-vehicle Brother PJ-700 roll printer the process server carries:
   * same letter width, but the leading edge has a mechanical dead zone,
   * so every top-anchored element shifts down by
   * LAYOUT.MOBILE_PRINTER_TOP_OFFSET. Applied via applyPrintTarget()
   * BEFORE the header is drawn — topHeaderY()/topMarginY() read the tag
   * off the doc, so tagging it afterwards silently does nothing.
   */
  printTarget?: PrintTarget;
}

const RECEIPT_TZ = 'America/Denver';

function receiptDateParts(iso: string): { date: string; time: string } {
  // parseTimestamp, NOT new Date(): signedAt arrives as a browser ISO
  // string from the signing page, but ALSO as a naive D1 timestamp
  // ("YYYY-MM-DD HH:MM:SS" from recipient_signed_at) when the officer
  // reprints a signed instrument from the vehicle. new Date() reads a
  // naive string as device-LOCAL, which would print the moment of
  // service ~6-7h off in Mountain Time — on the one document whose
  // whole purpose is proving when process was delivered.
  const d = iso ? parseTimestamp(iso) : new Date();  // new-date-ok: no-arg fallback is "now"
  return {
    date: d.toLocaleDateString('en-US', {
      timeZone: RECEIPT_TZ, month: 'short', day: 'numeric', year: 'numeric',
    }),
    time: d.toLocaleTimeString('en-US', {
      timeZone: RECEIPT_TZ, hour: '2-digit', minute: '2-digit', hour12: true,
    }),
  };
}



export async function generateReceiptOfService(data: ReceiptOfServiceData): Promise<jsPDF> {
  // No CONFIDENTIAL watermark: this document is handed to the person
  // served. try/finally because the flag is module state shared with
  // every other generator in the bundle — an early throw here would
  // silently un-watermark the next report the user prints.
  setConfidentialWatermarkEnabled(false);
  try {
    return await renderReceiptOfService(data);
  } finally {
    setConfidentialWatermarkEnabled(true);
  }
}


// ── Court furniture ─────────────────────────────────────────
//
// These helpers exist to make the instrument read as a court filing
// rather than as a printed web form. The conventions are not decorative:
// a clerk, an attorney, and a judge all scan a proof of service by
// looking for specific things in specific places, and meeting that
// expectation is what makes the document credible on sight.
//
// One convention is deliberately NOT met: serif type. Court filings are
// conventionally Times New Roman, but this codebase is Arial-only by
// standing decision (every generator calls registerArialFont, which
// overrides helvetica/times/courier). Changing that is a repo-wide call,
// not one to make inside a single form.

/** Centred court name and jurisdiction — the traditional opening of a
 *  filing, above the party caption. */
function drawCourtHeading(doc: jsPDF, y: number, courtName: string, jurisdiction: string): number {
  const cx = doc.internal.pageSize.getWidth() / 2;
  const cw = getContentWidth(doc);

  doc.setFont(PDF_VALUE_FONT, 'bold');
  doc.setFontSize(FONT.SIZE_SUBHEADER);
  doc.setTextColor(...COLOR.TEXT_PRIMARY);

  const l1 = doc.splitTextToSize(
    sanitizePdfText(`IN THE ${courtName || 'DISTRICT COURT'}`.toUpperCase()), cw,
  ) as string[];
  y = checkPageBreak(doc, y, l1.length * 3.4 + 7);
  y += 3;
  for (const l of l1) { doc.text(l, cx, y, { align: 'center' }); y += 3.4; }

  doc.setFont(PDF_VALUE_FONT, 'normal');
  doc.setFontSize(FONT.SIZE_SMALL_META);
  doc.setTextColor(...COLOR.TEXT_SECONDARY);
  doc.text(sanitizePdfText((jurisdiction || 'STATE OF UTAH').toUpperCase()), cx, y, { align: 'center' });

  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  return y + 2.5;
}

/**
 * Pleading caption in the conventional form: party names stacked at the
 * left, a column of close-parens as the divider, case information at the
 * right.
 *
 * The paren column is the point. A bordered two-cell table carries the
 * same information and reads as a form; the ")" gutter is what a lawyer
 * recognizes without reading a word, and it is the cheapest possible
 * signal that this document belongs in a case file.
 */
function drawPleadingCaption(
  doc: jsPDF,
  y: number,
  opts: { plaintiff: string; defendant: string; caseNumber: string; instrumentTitle: string },
): number {
  const lx = getLeftX();
  const cw = getContentWidth(doc);
  const leftW = cw * 0.50;
  const parenX = lx + leftW;
  const rightX = parenX + 4;
  const rightW = cw - leftW - 4;
  const lineH = 3.1;

  doc.setFont(PDF_VALUE_FONT, 'bold');
  doc.setFontSize(FONT.SIZE_FIELD_VALUE);
  const pLines = doc.splitTextToSize(sanitizePdfText(`${opts.plaintiff || 'PLAINTIFF'},`), leftW - 4) as string[];
  const dLines = doc.splitTextToSize(sanitizePdfText(`${opts.defendant || 'DEFENDANT'},`), leftW - 4) as string[];
  const tLines = doc.splitTextToSize(sanitizePdfText(opts.instrumentTitle.toUpperCase()), rightW) as string[];

  const leftRows = pLines.length + 1 + 1 + dLines.length + 1;  // + roles + "v."
  const rightRows = 2 + tLines.length + 1;
  const rows = Math.max(leftRows, rightRows);
  const blockH = rows * lineH + 2 + 1.6;  // + the two role-label clearances

  y = checkPageBreak(doc, y, blockH + SPACING.LG);

  // ── Left: the parties ──
  let ly = y + lineH;
  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  for (const l of pLines) { doc.text(l, lx, ly); ly += lineH; }
  doc.setFont(PDF_VALUE_FONT, 'normal');
  doc.setFontSize(FONT.SIZE_FIELD_LABEL);
  doc.setTextColor(...COLOR.TEXT_SECONDARY);
  doc.text('Plaintiff / Petitioner,', lx + 8, ly + 0.8); ly += lineH + 0.8;

  doc.setFont(PDF_VALUE_FONT, 'bold');
  doc.setFontSize(FONT.SIZE_FIELD_VALUE);
  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  doc.text('v.', lx + 4, ly); ly += lineH;

  for (const l of dLines) { doc.text(l, lx, ly); ly += lineH; }
  doc.setFont(PDF_VALUE_FONT, 'normal');
  doc.setFontSize(FONT.SIZE_FIELD_LABEL);
  doc.setTextColor(...COLOR.TEXT_SECONDARY);
  // +0.8mm. A multi-defendant caption wraps ("Chase Partners Ltd, Fontana
  // Business Center 2, SDP REIT LLC, ISAOA") and at a bare line height the
  // role label sat against the descenders above — circled as unreadable on
  // the 2026-07-27 service.
  doc.text('Defendant / Respondent.', lx + 8, ly + 0.8);

  // ── Divider: the paren gutter, one per row ──
  doc.setFont(PDF_VALUE_FONT, 'normal');
  doc.setFontSize(FONT.SIZE_FIELD_VALUE);
  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  for (let i = 0; i < rows; i++) doc.text(')', parenX, y + lineH + i * lineH);

  // ── Right: case number then instrument title ──
  let ry = y + lineH;
  doc.setFont(PDF_VALUE_FONT, 'bold');
  doc.setFontSize(FONT.SIZE_FIELD_VALUE);
  doc.text(`Case No. ${sanitizePdfText(opts.caseNumber || '—')}`, rightX, ry);
  ry += lineH * 2;

  for (const l of tLines) { doc.text(l, rightX, ry); ry += lineH; }

  return y + blockH + SPACING.SM;
}

/**
 * Centred, double-ruled instrument title.
 *
 * Redundant with the caption's right column by design — that redundancy
 * is the convention. The caption identifies the filing for the docket;
 * the centred title tells the person holding the paper what it is.
 */
function drawInstrumentTitle(
  doc: jsPDF, y: number, title: string, copy: ReceiptCopy | null = null,
): number {
  const cx = doc.internal.pageSize.getWidth() / 2;
  const lx = getLeftX();
  const cw = getContentWidth(doc);

  y = checkPageBreak(doc, y, 12);

  doc.setDrawColor(...COLOR.RULE_STRONG);
  doc.setLineWidth(BORDER.TABLE_OUTER);
  doc.line(lx, y, lx + cw, y);
  doc.setDrawColor(...COLOR.RULE_GOLD);
  doc.setLineWidth(BORDER.ACCENT_HEADER);
  doc.line(lx, y + 0.7, lx + cw, y + 0.7);

  y += 4.6;
  doc.setFont(PDF_VALUE_FONT, 'bold');
  doc.setFontSize(FONT.SIZE_SECTION_TITLE + 1);
  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  doc.text(sanitizePdfText(title.toUpperCase()), cx, y, { align: 'center' });

  // Copy designation rides the title's OWN baseline rather than claiming a
  // row below it. The band already reserves this line, so three sheets are
  // told apart at a glance for zero vertical cost — which matters on a
  // layout that fits a single roll-printer sheet by ~4mm.
  if (copy) {
    doc.setFontSize(FONT.SIZE_FIELD_LABEL);
    const label = RECEIPT_COPY_LABEL[copy].toUpperCase();
    const w = doc.getTextWidth(label) + 4;
    doc.setDrawColor(...COLOR.RULE_STRONG);
    doc.setLineWidth(BORDER.FIELD);
    doc.rect(lx + cw - w, y - 3, w, 4.2);
    doc.text(label, lx + cw - w + 2, y);
    doc.setFontSize(FONT.SIZE_SECTION_TITLE + 1);
  }

  y += 1.6;
  doc.setDrawColor(...COLOR.RULE_STRONG);
  doc.setLineWidth(BORDER.TABLE_OUTER);
  doc.line(lx, y, lx + cw, y);

  return y + SPACING.LG;
}

interface SubjectRow {
  label: string;
  value: string;
  /** Render a writable rule instead of the value (blank paper mode). */
  blank?: boolean;
}

/**
 * Subject panel — a person presented as a subject of record, not as a
 * scatter of numbered fields.
 *
 * This is the organizing idea of the whole instrument. A proof of
 * service is about two people: the party the process is FOR, and the
 * person who actually took it. Everything else is circumstance. Giving
 * each of them a titled panel with their name set large means the two
 * questions a reader arrives with — "who was served?" and "who signed
 * for them?" — are answered before any field is read.
 */
function drawSubjectPanel(
  doc: jsPDF,
  x: number, y: number, w: number,
  heading: string, name: string, capacity: string,
  rows: SubjectRow[],
  /** Draw to this exact height instead of the measured one. Pass the
   *  taller of a pair so the two panels align at the bottom. */
  forcedH?: number,
  /** Measure only — return the height without drawing anything. */
  measureOnly = false,
): number {
  const pad = 1.6;
  const rowH = 2.9;
  // Clearance ONLY after a value that wrapped. A two-line address set its
  // continuation against the label below — circled "2 lines" on the
  // 2026-07-27 service. Widening every row instead cost ~1mm per panel and
  // pushed the tightest variations onto a second sheet.
  const WRAP_CLEARANCE = 0.9;

  doc.setFont(PDF_VALUE_FONT, 'bold');
  doc.setFontSize(FONT.SIZE_SUBHEADER);
  const blankName = !name;
  const nameLines = blankName
    ? ['']
    : doc.splitTextToSize(sanitizePdfText(name), w - pad * 2) as string[];

  // Measure wrapped values up front — a row is as tall as its value.
  const labelW = w * 0.42;
  const valueW = w - labelW - pad * 2;
  doc.setFont(PDF_VALUE_FONT, 'bold');
  doc.setFontSize(FONT.SIZE_TABLE_BODY - 0.7);
  const wrapped = rows.map((r) => ({
    label: r.label,
    blank: !!r.blank,
    lines: r.blank
      ? ['']   // a rule is drawn instead; reserve exactly one row
      // Split on explicit newlines FIRST. A two-line address block is
      // authored, not incidental — wrapping it as one run would break it
      // mid-city, which is what "2 lines" was circling.
      : sanitizePdfText(r.value || '—').split('\n')
          .flatMap((seg) => doc.splitTextToSize(seg, valueW) as string[]),
  }));
  const rowsH = wrapped.reduce(
    (n, r) => n + Math.max(1, r.lines.length) * rowH + (r.lines.length > 1 ? WRAP_CLEARANCE : 0), 0);

  doc.setFont(PDF_VALUE_FONT, 'bold');
  doc.setFontSize(FONT.SIZE_SUBHEADER);
  doc.setFont(PDF_VALUE_FONT, 'normal');
  doc.setFontSize(FONT.SIZE_FIELD_LABEL);
  const capLines = capacity
    ? (doc.splitTextToSize(sanitizePdfText(capacity), w - pad * 2) as string[]).length : 0;
  doc.setFont(PDF_VALUE_FONT, 'bold');
  doc.setFontSize(FONT.SIZE_SUBHEADER);
  const bodyH = pad + nameLines.length * 3.4 + capLines * 2.4 + (capacity ? 0.4 : 0) + 1.4 + rowsH + pad;
  const boxH = forcedH ?? (SPACING.SECTION_HEADER_H + bodyH);
  if (measureOnly) return SPACING.SECTION_HEADER_H + bodyH;

  // Heading strip — same weight as an article header so the panels read
  // as peers of the numbered articles below, not as a callout.
  doc.setFillColor(...resolveSectionAccentColor('routine'));
  doc.rect(x, y, w, SPACING.SECTION_HEADER_H, 'F');
  doc.setFont(PDF_VALUE_FONT, 'bold');
  doc.setFontSize(FONT.SIZE_FIELD_LABEL);
  doc.setTextColor(255, 255, 255);
  doc.text(sanitizePdfText(heading.toUpperCase()), x + pad, y + SPACING.SECTION_HEADER_H - 1.5);

  doc.setDrawColor(...COLOR.BORDER_SECTION);
  doc.setLineWidth(BORDER.SECTION_OUTER);
  doc.rect(x, y, w, boxH);

  let ty = y + SPACING.SECTION_HEADER_H + pad + 2.6;
  doc.setFont(PDF_VALUE_FONT, 'bold');
  doc.setFontSize(FONT.SIZE_SUBHEADER);
  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  if (blankName) {
    doc.setDrawColor(...COLOR.BORDER_FIELD_RULE);
    doc.setLineWidth(BORDER.FIELD);
    doc.line(x + pad, ty + 0.6, x + w - pad, ty + 0.6);
    ty += 3.4;
  } else {
    for (const l of nameLines) { doc.text(l, x + pad, ty); ty += 3.4; }
  }

  if (capacity) {
    // WRAPPED. As a single doc.text this ran off the right edge of the
    // page on a real multi-entity caption.
    doc.setFont(PDF_VALUE_FONT, 'normal');
    doc.setFontSize(FONT.SIZE_FIELD_LABEL);
    doc.setTextColor(...COLOR.TEXT_SECONDARY);
    for (const cl of doc.splitTextToSize(sanitizePdfText(capacity), w - pad * 2) as string[]) {
      doc.text(cl, x + pad, ty);
      ty += 2.4;
    }
    ty += 0.4;
  }
  ty += 1.4;

  // Inline label/value rows against a fixed label column. The label may
  // be clipped (fixed strings we author); the VALUE wraps, because an
  // elided address or entity name is a defect, not a layout compromise.
  for (const r of wrapped) {
    doc.setFont(PDF_VALUE_FONT, 'normal');
    doc.setFontSize(FONT.SIZE_FIELD_LABEL);
    doc.setTextColor(...COLOR.TEXT_SECONDARY);
    doc.text(fitPdfText(doc, sanitizePdfText(r.label.toUpperCase()), labelW - 1), x + pad, ty);

    if (r.blank) {
      // Writable rule, inset so a pen has somewhere to sit above it.
      doc.setDrawColor(...COLOR.BORDER_FIELD_RULE);
      doc.setLineWidth(BORDER.FIELD);
      doc.line(x + pad + labelW, ty + 0.4, x + w - pad, ty + 0.4);
      ty += rowH;
    } else {
      doc.setFont(PDF_VALUE_FONT, 'bold');
      doc.setFontSize(FONT.SIZE_TABLE_BODY - 0.7);
      doc.setTextColor(...COLOR.TEXT_PRIMARY);
      for (const vl of r.lines) { doc.text(vl, x + pad + labelW, ty); ty += rowH; }
      if (r.lines.length > 1) ty += WRAP_CLEARANCE;
    }
  }

  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  return y + boxH;
}

/**
 * Baseline lead-in for a prose paragraph that starts a section.
 *
 * openAutoSection() returns contentY at the TOP EDGE of the content
 * area. addFieldPair() gets away with drawing straight at it because it
 * renders a small caps label first, whose own ascent clears the bar. A
 * raw addWrappedText() sets its BASELINE at y, so its first line lands
 * INSIDE the header bar and is clipped — which is exactly what the
 * "I am an adult over the age of eighteen" statement did on the first
 * render of every variant.
 */
function proseLeadIn(fontSize: number = FONT.SIZE_FIELD_VALUE): number {
  return fontSize * 0.36 + SPACING.MD;
}

/**
 * A numbered declaration paragraph, hanging-indent style.
 *
 * Replaces the `[X]` checkbox rows of the first draft. A checkbox list
 * reads as a form someone filled in; numbered paragraphs with a hanging
 * indent read as statements a person made — which is what these are,
 * and what a court is used to seeing. Numbering also gives anyone
 * disputing the service something to cite: "paragraph 3", not "the
 * third bullet".
 *
 * A DECLINED statement is still printed, struck through and annotated.
 * Silently omitting it would misrepresent the form the signer saw.
 */
function drawDeclaration(
  doc: jsPDF, n: number, text: string, accepted: boolean, y: number,
  blank = false,
): number {
  const lx = getLeftX();
  const ffw = getFullFieldWidth(doc);
  // Blank paper gets an initial box in the left gutter. Initialling each
  // statement individually is the paper equivalent of ticking it on the
  // phone — without it, one signature at the foot would be the only
  // evidence the signer saw seven separate declarations.
  const numW = blank ? 10 : 6;
  const lineH = FONT.SIZE_FIELD_VALUE * 0.42;

  doc.setFont(PDF_VALUE_FONT, 'normal');
  doc.setFontSize(FONT.SIZE_FIELD_VALUE);
  const lines = doc.splitTextToSize(sanitizePdfText(text), ffw - numW) as string[];
  y = checkPageBreak(doc, y, lines.length * lineH + 2);

  doc.setFont(PDF_VALUE_FONT, 'bold');
  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  doc.text(`${n}.`, lx, y);

  if (blank) {
    doc.setDrawColor(...COLOR.BORDER_FIELD);
    doc.setLineWidth(BORDER.CHECKBOX);
    doc.rect(lx + 4.5, y - 2.4, 3, 3);
    doc.setFont(PDF_VALUE_FONT, 'normal');
    doc.setFontSize(FONT.SIZE_FIELD_LABEL - 1.2);
    doc.setTextColor(...COLOR.TEXT_TERTIARY);
    doc.text('init.', lx + 4.4, y + 2.2);
    doc.setFontSize(FONT.SIZE_FIELD_VALUE);
  }

  doc.setFont(PDF_VALUE_FONT, 'normal');
  // Ternary inside the spread loses the tuple type — bind first.
  const bodyColor = accepted ? COLOR.TEXT_PRIMARY : COLOR.TEXT_TERTIARY;
  doc.setTextColor(bodyColor[0], bodyColor[1], bodyColor[2]);
  let ly = y;
  for (const l of lines) {
    doc.text(l, lx + numW, ly);
    if (!accepted && !blank) {
      // Struck through rather than dropped: the reader must be able to
      // see WHICH statement was put to the signer and declined.
      const w = doc.getTextWidth(l);
      doc.setDrawColor(...COLOR.TEXT_TERTIARY);
      doc.setLineWidth(0.2);
      doc.line(lx + numW, ly - 0.9, lx + numW + w, ly - 0.9);
    }
    ly += lineH;
  }

  if (!accepted && !blank) {
    doc.setFont(PDF_VALUE_FONT, 'bold');
    doc.setFontSize(FONT.SIZE_FIELD_LABEL);
    doc.setTextColor(...COLOR.TEXT_TERTIARY);
    doc.text('[ DECLINED - NOT AFFIRMED ]', lx + numW, ly);
    ly += lineH;
  }

  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  return ly + (blank ? 0.2 : SPACING.SM);
}

/** Barcode form key, so a scanned instrument reports its variation. */
const RECEIPT_FORM_KEY: Record<ReceiptVariantKey, string> = {
  individual: 'ACK-SERVICE-IND',
  co_habitant: 'ACK-SERVICE-COHAB',
  business: 'ACK-SERVICE-BUS',
  substitute: 'ACK-SERVICE-SUB',
};

/**
 * A field the subject fills in by hand: label in the normal position, a
 * writable rule where the value would be.
 *
 * addFieldPair() renders "N/A" for an empty value, which is right on a
 * report of established fact and exactly wrong on a form someone is
 * meant to complete — it reads as an instruction NOT to write there.
 */
function addWritableFieldPair(
  doc: jsPDF, label: string, x: number, y: number, width: number,
): number {
  // NOT addFieldPair with a blank value: it substitutes "N/A" for an
  // empty string, which on a form meant to be completed in ink reads as
  // an instruction not to write there. Matches addFieldPair's geometry
  // (2.7mm label height, 0.8mm inner pad) so blank and printed fields
  // sit on the same grid.
  const labelH = 2.7;
  const innerPad = 0.8;
  doc.setFont(PDF_VALUE_FONT, 'bold');
  doc.setFontSize(FONT.SIZE_FIELD_LABEL);
  doc.setTextColor(...COLOR.TEXT_SECONDARY);
  doc.text(sanitizePdfText(label.toUpperCase()), x + innerPad, y + 1.8);

  doc.setDrawColor(...COLOR.BORDER_FIELD_RULE);
  doc.setLineWidth(BORDER.FIELD);
  doc.line(x + innerPad, y + labelH + 1.6, x + width - innerPad, y + labelH + 1.6);
  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  return y + labelH + SPACING.FIELD_ROW_ADVANCE + 0.6;
}

/**
 * The moment of service, as printed.
 *
 * Empty on a BLANK form: when the officer prints one, the delivery has
 * not happened yet, and stamping the moment of PRINTING as the moment of
 * service would put a false fact on a legal record — the exact fact a
 * contested service turns on. The subject writes it, or the on-screen
 * flow captures it at signature.
 *
 * Exported so the rule can be asserted directly; it is not observable
 * from the rendered PDF, whose embedded font subset defeats text search.
 */
export function serviceMomentFor(
  data: Pick<ReceiptOfServiceData, 'blank' | 'signedAt'>,
): { date: string; time: string } {
  if (data.blank) return { date: '', time: '' };
  return receiptDateParts(data.signedAt);
}

/**
 * Does the defendant caption wrap?
 *
 * The honest predictor of overflow. A first attempt keyed on declaration
 * height, which measures ~40mm whether the defendant is "Jo Lee" or
 * "Chase Partners Ltd, Fontana Business Center 2, SDP REIT LLC, ISAOA" —
 * the party name is substituted into only two statements. What actually
 * grows is everything ABOVE: the caption wraps to a second line and both
 * subject panels carry the same name.
 */
function captionWraps(doc: jsPDF, defendant: string): boolean {
  doc.setFont(PDF_VALUE_FONT, 'bold');
  doc.setFontSize(FONT.SIZE_FIELD_VALUE);
  const captionCol = getContentWidth(doc) * 0.50 - 4;
  return (doc.splitTextToSize(sanitizePdfText(`${defendant},`), captionCol) as string[]).length > 1;
}

/**
 * Estimated height of the declarations, in mm, before anything is drawn.
 *
 * The only part of this instrument whose height genuinely varies is the
 * declarations, because the party name is substituted into two of them.
 * A one-word defendant gives seven single-line statements; "Chase
 * Partners Ltd, Fontana Business Center 2, SDP REIT LLC, ISAOA" wraps
 * two of them to three lines each and adds ~25mm.
 *
 * Measuring it first is what lets the renderer decide to be dense BEFORE
 * it starts drawing, rather than discovering the overflow at the
 * signature block when it is too late to do anything but break the page.
 */
function measureDeclarations(
  doc: jsPDF, attestations: ReceiptAttestationLine[], width: number, blank: boolean,
): number {
  doc.setFont(PDF_VALUE_FONT, 'normal');
  doc.setFontSize(FONT.SIZE_FIELD_VALUE);
  const lineH = FONT.SIZE_FIELD_VALUE * 0.42;
  return attestations.reduce((n, a) => {
    const lines = doc.splitTextToSize(sanitizePdfText(a.text), width - (blank ? 10 : 6)) as string[];
    return n + lines.length * lineH + (blank ? 0.2 : SPACING.SM)
      + (blank || a.accepted ? 0 : lineH);
  }, 0);
}

/**
 * Declarations tall enough that the instrument will not fit a sheet at
 * normal spacing. Measured against what the four standard variations
 * produce (~40mm); past this the page needs to be denser.
 */
const DENSE_THRESHOLD_MM = 52;

async function renderReceiptOfService(data: ReceiptOfServiceData): Promise<jsPDF> {
  const branding = await fetchPdfBranding();
  setActiveBranding(branding);
  await loadPdfAssets();

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
  // MUST precede drawNibrsHeader — the header helpers read the print
  // target off the doc to decide their top offset.
  applyPrintTarget(doc, data.printTarget ?? 'office');
  registerArialFont(doc);
  setActiveFormKey('');

  const { date: signedDate, time: signedTime } = serviceMomentFor(data);
  stampGenerationTime();

  const isIndividual = data.variant === 'individual';
  const isBusiness = data.variant === 'business';
  const blank = !!data.blank;
  const onBehalfOf = data.acceptingOnBehalfOf || data.defendantName || 'the named party';

  const lx = getLeftX();
  const rx = getRightColumnX(doc);
  const cw = getContentWidth(doc);
  const hfw = getHalfFieldWidth(doc);
  const ffw = getFullFieldWidth(doc);

  // Measure before drawing. When a long multi-entity caption inflates the
  // declarations, the page tightens rather than spilling — the reader
  // gets a denser single sheet instead of a second one carrying a
  // signature away from most of the form.
  const dense = !data.photos?.length
    && (captionWraps(doc, data.defendantName || '')
      || measureDeclarations(doc, data.attestations, ffw, blank) > DENSE_THRESHOLD_MM);
  const gap = (normal: number) => (dense ? normal * 0.5 : normal);

  setActiveCaseNumber(data.caseNumber);
  let y = drawNibrsHeader(doc, {
    stateIdentifier: 'STATE OF UTAH',
    agencyName: (data.agency || 'ROCKY MOUNTAIN PROTECTIVE GROUP').toUpperCase(),
    formTitle: 'CIVIL PROCESS RECORD',
    caseNumber: data.caseNumber,
    // On a blank, the service date does not exist yet; leaving it empty
    // renders a labelled but blank header cell that reads as a defect.
    // The issue date is true, and tells an officer how stale a form in
    // the glovebox is.
    reportDate: signedDate || (blank ? `ISSUED ${receiptDateParts(new Date().toISOString()).date}` : ''),
  });

  // ── Docket furniture: court heading, caption, instrument title ──
  y = drawCourtHeading(doc, y, data.courtName, data.jurisdiction);
  y = drawPleadingCaption(doc, y, {
    plaintiff: data.plaintiffName,
    defendant: data.defendantName,
    caseNumber: data.caseNumber,
    instrumentTitle: data.formTitle,
  });
  y = drawInstrumentTitle(doc, y, data.formTitle, blank ? null : (data.copy ?? null));


  // ── Notice to the person served ──
  // The one paragraph a signer must read before anything is asked of
  // them, in the identical wording used on the signing screen.
  y = checkPageBreak(doc, y, 14);
  y += gap(SPACING.LG);
  doc.setFont(PDF_VALUE_FONT, 'bold');
  y = addWrappedText(doc,
    'NOTICE: This instrument evidences delivery only. It is not an admission of any '
    + 'allegation, it is not agreement with the contents of the documents delivered, and it '
    + 'waives no right, defense, or deadline. Any time limit for responding is stated within '
    + 'the documents themselves.',
    lx, y, ffw, FONT.SIZE_FIELD_VALUE, { preserveCase: true });
  doc.setFont(PDF_VALUE_FONT, 'normal');
  y += gap(SPACING.MD);

  // ── Article I — the subjects ──
  //
  // Two people (or a person and an entity) are what this instrument is
  // about: the party the process is FOR, and whoever actually took it.
  // Presenting each as a titled subject with the name set large answers
  // the two questions a reader arrives with before any field is read.
  //
  // The panels are NOT symmetric, because the subjects are not the same
  // KIND of thing. A served business needs entity facts — what it is,
  // where it was served, who may accept for it. A served person needs
  // residence facts. Forcing both through one field list would leave
  // half of every panel reading "N/A".
  const gutter = 3;
  const panelW = (cw - gutter) / 2;

  const partyIsEntity = isBusiness;
  const partyRows: SubjectRow[] = partyIsEntity
    ? [
        // No "Entity served" row: the panel's name line IS the entity.
        { label: 'Place of service', value: data.serviceAddress },
        { label: 'Premises', value: data.premisesType || 'Business' },
        { label: 'Served via', value: 'Authorized agent' },
      ]
    : [
        { label: 'Place of service', value: data.serviceAddress },
        { label: 'Premises', value: data.premisesType || 'Residence' },
        { label: 'Served via', value: isIndividual ? 'Personal delivery' : data.variantLabel },
      ];

  // Only the ACCEPTOR's side blanks out. The party/entity panel stays
  // printed: the officer knows the case, and asking a defendant to
  // transcribe their own case caption invites errors into a legal record.
  const acceptorRows: SubjectRow[] = isIndividual
    ? [
        { label: 'Capacity', value: 'Party named' },
        { label: 'Telephone', value: data.recipientPhone || 'Not provided', blank },
        { label: 'Accepted', value: `${signedDate} ${signedTime}`, blank },
      ]
    : [
        { label: isBusiness ? 'Title' : 'Relationship', value: data.recipientJobTitle || data.recipientRelationship || 'Not stated', blank },
        { label: isBusiness ? 'Employed here' : 'Resides here', value: data.residesAtAddress ? 'Yes' : 'No', blank },
        // "Authorized" is omitted from the BLANK panel: declaration 2 is
        // the authority statement, which the subject initials. Asking
        // them to write Yes/No here as well means the same fact recorded
        // twice, in two hands, with the ever-present chance they
        // disagree — and the row it costs is what keeps the blank on one
        // sheet of PJ-700 roll. On a completed form it stays, because
        // there it is a rendered value, not a second question.
        ...(blank ? [] : [{ label: 'Authorized', value: data.authorizedAgent ? 'Yes' : 'No' }]),
        { label: 'Telephone', value: data.recipientPhone || 'Not provided', blank },
        { label: 'Delivery by', value: data.expectedDeliveryAt || 'Promptly', blank },
      ];

  {
    const reserve = SPACING.SECTION_HEADER_H + 26;
    y = checkPageBreak(doc, y, reserve);
    const startY = y;
    const hA = drawSubjectPanel(
      doc, lx, startY, panelW,
      partyIsEntity ? 'I(a).  Subject of Process / Entity' : 'I(a).  Subject of Process / Party Named',
      partyIsEntity ? onBehalfOf : (data.defendantName || onBehalfOf),
      partyIsEntity ? 'Business entity named in the process' : 'Defendant / Respondent named in the process',
      partyRows, undefined, true,
    );
    const hB = drawSubjectPanel(
      doc, lx + panelW + gutter, startY, panelW,
      'I(b).  Person Accepting Service',
      blank ? '' : data.recipientName,
      isIndividual
        ? 'Accepted personally'
        : `${data.variantLabel} accepting on behalf of the party named at left`,
      acceptorRows, undefined, true,
    );
    const panelH = Math.max(hA, hB);

    const aEnd = drawSubjectPanel(
      doc, lx, startY, panelW,
      partyIsEntity ? 'I(a).  Subject of Process / Entity' : 'I(a).  Subject of Process / Party Named',
      partyIsEntity ? onBehalfOf : (data.defendantName || onBehalfOf),
      partyIsEntity ? 'Business entity named in the process' : 'Defendant / Respondent named in the process',
      partyRows, panelH,
    );
    const bEnd = drawSubjectPanel(
      doc, lx + panelW + gutter, startY, panelW,
      'I(b).  Person Accepting Service',
      blank ? '' : data.recipientName,
      isIndividual
        ? 'Accepted personally'
        : `${data.variantLabel} accepting on behalf of the party named at left`,
      acceptorRows, panelH,
    );
    y = Math.max(aEnd, bEnd) + gap(SPACING.LG);
  }

  // ── Article II — particulars of service ──
  y = checkPageBreak(doc, y, 14);
  { const sec = openAutoSection(doc, 'II.  Particulars of Service', y); y = sec.contentY;
    if (blank) {
      // One row on paper, not two. There is no geolocation to record on
      // a hand-completed form — printing "Not captured on paper" spends
      // a field row saying nothing — and the server's name and badge
      // read fine together. The row this frees is what keeps a
      // four-document blank on a single sheet of PJ-700 roll.
      const a = addWritableFieldPair(doc, '1. Date and Time of Delivery', lx, y, hfw);
      const b = addFieldPair(doc, '2. Process Server / Badge',
        [data.serverName, data.serverBadge].filter(Boolean).join('  ·  '), rx, y, hfw);
      y = Math.max(a, b);
    } else if (dense) {
      // One row. Server and badge read fine together, and the geolocation
      // rides with them rather than claiming a row of its own — the row
      // this frees is what keeps a long-caption instrument on one sheet.
      const a = addFieldPair(doc, '1. Date and Time of Delivery', `${signedDate} at ${signedTime}`, lx, y, hfw);
      const b = addFieldPair(doc, '2. Process Server / Badge',
        [data.serverName, data.serverBadge].filter(Boolean).join('  ·  '), rx, y, hfw);
      y = Math.max(a, b);
      y = addFieldPair(doc, '3. Geolocation at Signature',
        data.gps ? `${data.gps.lat.toFixed(6)}, ${data.gps.lng.toFixed(6)}` : 'Not available',
        lx, y, ffw);
    } else {
      const a = addFieldPair(doc, '1. Date and Time of Delivery', `${signedDate} at ${signedTime}`, lx, y, hfw);
      const b = addFieldPair(doc, '2. Process Server', data.serverName, rx, y, hfw);
      y = Math.max(a, b);
      const c = addFieldPair(doc, '3. Badge / License No.', data.serverBadge, lx, y, hfw);
      const d = addFieldPair(doc, '4. Geolocation at Signature',
        data.gps ? `${data.gps.lat.toFixed(6)}, ${data.gps.lng.toFixed(6)}` : 'Not available',
        rx, y, hfw);
      y = Math.max(c, d);
    }
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Article III — schedule of documents ──
  // Itemized as a table rather than a sentence: a dispute over service
  // is almost always a dispute over WHICH papers changed hands, and a
  // row-per-document with a copy count is what answers that.
  y = checkPageBreak(doc, y, 26);
  {
    const cols = getProportionalColumns(doc, [0.10, 0.72, 0.18]);
    const rows = (data.documents.length
      ? data.documents
      : [{ title: data.documentType || 'Court documents', copies: 1 }]
    ).map((d, i) => [String(i + 1), sanitizePdfText(d.title), String(d.copies)]);

    // Header bar drawn explicitly. The table helper's `sectionTitle` is
    // consulted ONLY for its "... CONTINUED" banner on a page break, so
    // relying on it left this article with no visible number at all.
    doc.setFillColor(...resolveSectionAccentColor('routine'));
    doc.rect(lx, y, cw, SPACING.SECTION_HEADER_H, 'F');
    doc.setFont(PDF_VALUE_FONT, 'bold');
    doc.setFontSize(FONT.SIZE_SECTION_TITLE);
    doc.setTextColor(255, 255, 255);
    doc.text('III.  SCHEDULE OF DOCUMENTS DELIVERED', lx + 1.5, y + SPACING.SECTION_HEADER_H - 1.2);
    doc.setTextColor(...COLOR.TEXT_PRIMARY);
    y += SPACING.SECTION_HEADER_H;

    y = addTableWithShading(
      doc,
      [{ label: 'No.', x: cols[0] }, { label: 'Document Delivered', x: cols[1] }, { label: 'Copies', x: cols[2] }],
      rows, y, cols,
      { sectionTitle: 'III.  Schedule of Documents Delivered' },
    );
  }

  // ── Article IV — declarations ──
  // Reserve the declarations AND the execution block as one unit.
  //
  // A plain checkPageBreak only guarantees the declarations START on
  // this page — the signature then spills alone onto the next one. On a
  // roll printer that second page is a physically separate strip of
  // paper carrying nothing but a signature line, detached from the
  // statements it attests to. Whatever the recipient walks away with
  // must be self-contained, so the two move together or not at all.
  //
  // Measured, not guessed: splitTextToSize against the real font and
  // width, because the statement count and their wrapped line count
  // both vary by variant and by party-name length.
  doc.setFont(PDF_VALUE_FONT, 'normal');
  doc.setFontSize(FONT.SIZE_FIELD_VALUE);
  const declLineH = FONT.SIZE_FIELD_VALUE * 0.42;
  // SECTION_CONTENT_PAD is NOT added — openAutoSection's contentY
  // already sits past it, and proseLeadIn() is the extra baseline
  // clearance measured from that point.
  const declH = (a: ReceiptAttestationLine) =>
    (doc.splitTextToSize(sanitizePdfText(a.text), ffw - (blank ? 10 : 6)) as string[]).length * declLineH
    + (blank ? 0.2 : SPACING.SM) + (blank || a.accepted ? 0 : declLineH);

  let declBlockH = SPACING.SECTION_HEADER_H + proseLeadIn() + declLineH + SPACING.LG;
  for (const a of data.attestations) {
    const lines = doc.splitTextToSize(sanitizePdfText(a.text), ffw - 6) as string[];
    // `blank` forces every statement to render un-annotated, so the
    // declined line must NOT be budgeted for — see drawDeclaration.
    declBlockH += lines.length * declLineH + (blank ? 0.2 : SPACING.SM)
      + (blank || a.accepted ? 0 : declLineH);
  }
  const footnoteH = isIndividual ? 0 : 3 * (FONT.SIZE_FOOTER_SECONDARY * 0.42) + SPACING.MD;
  // The hand-off badge is part of the layout, not an overlay. Placing it
  // absolutely at the page foot worked while blank forms were short and
  // silently printed ON the signature block once they filled the sheet.
  const handoffH = blank && data.qrDataUrl ? 7 : 0;
  const executionH = (SPACING.XL + SPACING.MD) + declLineH + SPACING.LG
    + SPACING.SIGNATURE_BOX_H + SPACING.XL + footnoteH + handoffH + 3;
  // Dense only: reserve the TAIL, not the whole block.
  //
  // Reserving every declaration plus the signature moves all of Article IV
  // together — correct when it fits, and the reason page one sat 40% empty
  // when it does not. Keeping just the last statements with the signature
  // is the ordinary answer to a widow. Scoped to dense because an earlier
  // attempt applied it everywhere and regressed all four standard
  // variations; here the only cases affected are ones already spilling.
  if (dense) {
    const tailH = data.attestations.slice(-2).reduce((n, a) => n + declH(a), 0);
    y = checkPageBreak(doc, y, Math.min(declBlockH, 34) + tailH + executionH);
  } else {
    y = checkPageBreak(doc, y, declBlockH + executionH);
  }

  { const sec = openAutoSection(doc, 'IV.  Declarations of the Person Accepting Service', y);
    y = sec.contentY + proseLeadIn();

    doc.setFont(PDF_VALUE_FONT, 'normal');
    doc.setFontSize(FONT.SIZE_FIELD_VALUE);
    y = addWrappedText(doc,
      blank
        ? 'The undersigned states as follows. Initial each statement you affirm:'
        : `The undersigned, ${sanitizePdfText(data.recipientName)}, states as follows:`,
      lx, y, ffw, FONT.SIZE_FIELD_VALUE, { preserveCase: true });
    y += gap(SPACING.LG);

    data.attestations.forEach((a, i) => {
      // Before the first tail statement, reserve the tail AND the whole
      // execution block so the signature can never be split from what it
      // attests to.
      if (dense && i === data.attestations.length - 2) {
        const tailH = data.attestations.slice(-2).reduce((n, x) => n + declH(x), 0);
        y = checkPageBreak(doc, y, tailH + executionH);
      }
      y = drawDeclaration(doc, i + 1, a.text, blank ? true : a.accepted, y, blank);
    });
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Photographs ──
  // Placed after the schedule and before the declarations, so the page
  // reads chronologically: what was delivered, what it looked like, what
  // the recipient then stated. Never on a blank — there is nothing to
  // photograph before the encounter has happened.
  if (!blank && Array.isArray(data.photos) && data.photos.length > 0) {
    y = checkPageBreak(doc, y, 34);
    const sec = openAutoSection(doc, 'III(b).  Photographs at Signature', y);
    y = sec.contentY + SPACING.MD;
    // Two across. Bigger than a thumbnail so a door number is readable;
    // small enough that three photos do not claim a page of their own.
    const gap = 3;
    const w = (ffw - gap) / 2;
    const h = w * 0.62;
    let px = lx;
    for (let i = 0; i < Math.min(data.photos.length, 4); i++) {
      if (i > 0 && i % 2 === 0) { y += h + gap; px = lx; }
      try {
        doc.addImage(data.photos[i], 'JPEG', px, y, w, h);
        doc.setDrawColor(...COLOR.BORDER_FIELD);
        doc.setLineWidth(BORDER.IMAGE_FRAME);
        doc.rect(px, y, w, h);
      } catch { /* a corrupt frame must never cost the instrument */ }
      px += w + gap;
    }
    y += h + SPACING.MD;
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Article V — execution ──
  // closeAutoSection() draws its gold closing rule AT the y it returns,
  // so a single base unit of clearance put this baseline through it and
  // the clause rendered struck out. Clear the rule, then breathe.
  //
  // Deliberately NOT a perjury declaration — see the note on
  // ReceiptOfServiceData.
  y += gap(SPACING.XL) + SPACING.MD;
  doc.setFont(PDF_VALUE_FONT, 'normal');
  doc.setFontSize(FONT.SIZE_FIELD_VALUE);
  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  if (blank) {
    doc.text('Executed at', lx, y);
    const p1 = lx + doc.getTextWidth('Executed at ') + 1;
    const p2 = p1 + ffw * 0.46;
    doc.setDrawColor(...COLOR.BORDER_FIELD_RULE);
    doc.setLineWidth(BORDER.FIELD);
    doc.line(p1, y + 0.6, p2 - 2, y + 0.6);
    doc.text('on', p2, y);
    const p3 = p2 + doc.getTextWidth('on ') + 1;
    doc.line(p3, y + 0.6, lx + ffw, y + 0.6);
    y += 3.4;
  } else {
    y = addWrappedText(doc,
      // Flattened: the execution clause is a sentence, and a newline from
      // the two-line address block would break it mid-clause.
      `Executed at ${sanitizePdfText((data.executionPlace || data.serviceAddress || 'the place of service').replace(/\n/g, ', '))} `
      + `on ${signedDate} at ${signedTime}.`,
      lx, y, ffw, FONT.SIZE_FIELD_VALUE, { preserveCase: true });
  }
  y += SPACING.LG;

  // Role label names the SIGNER, not the server. The process server's
  // own sworn statement belongs on the affidavit filed with the court,
  // never on the copy the recipient walks away with.
  y = addSignatureBlock(
    doc,
    isIndividual
      ? 'V.  Signature of the Party Named'
      : `V.  Signature of the Person Accepting Service (${data.variantLabel})`,
    lx, y, ffw,
    {
      ...(data.signature ? { signatureImage: data.signature } : {}),
      printedName: blank ? '' : data.recipientName,
      // The middle sub-field defaults to BADGE NUMBER — correct on an
      // officer's signature, nonsense on a recipient's. Capacity is the
      // fact that actually matters here: it is the basis on which this
      // person was entitled to accept the papers at all.
      middleFieldLabel: isIndividual ? 'CAPACITY' : 'CAPACITY / RELATIONSHIP',
      // "Party named" is only true when the signer IS the party — never
      // when the process names a company. This printed "PARTY NAMED" for a
      // registered agent on 2026-07-27 and was corrected in pen.
      badgeNumber: blank
        ? ''
        : (data.recipientJobTitle || data.recipientRelationship
          || (isIndividual ? 'Party named' : data.variantLabel)),
      date: blank ? '' : `${signedDate} ${signedTime}`,
    },
  );

  y += SPACING.XL;

  // Authority note, set as a genuine footnote BELOW the signature. It
  // explains the rule the variation rests on; it is not something the
  // signer attests to, so keeping it inside Article IV both misread as
  // a declaration and made the must-stay-together block taller.
  const badge = blank && data.qrDataUrl ? 11 : 0;
  const footnoteTop = y;
  if (!isIndividual) {
    doc.setFont(PDF_VALUE_FONT, 'normal');
    doc.setTextColor(...COLOR.TEXT_TERTIARY);
    y = addWrappedText(doc,
      'Service upon a person other than the party named is permitted under Rule 4(d)(1) of '
      + 'the Utah Rules of Civil Procedure where the documents are left with a person of '
      + 'suitable age and discretion residing at the dwelling, or with an agent authorized '
      + 'to receive service at a place of business.',
      lx, y, ffw - (badge ? badge + 34 : 0), FONT.SIZE_FOOTER_SECONDARY, { preserveCase: true });
    y += SPACING.MD;
  }

  // ── Hand-off badge ──
  // The paper and the phone are the SAME instrument, not alternatives
  // the subject must commit to up front. Someone who starts writing and
  // then decides they would rather scan can do so at any point, and the
  // token is identical either way — so whichever route they finish by,
  // exactly one signed record exists.
  if (badge) {
    // Occupies the column the footnote just yielded, anchored to the
    // footnote's own top edge — so it costs only the height by which it
    // exceeds the footnote, not its full height.
    const qrX = lx + ffw - badge;
    doc.addImage(data.qrDataUrl as string, 'PNG', qrX, footnoteTop - 2.4, badge, badge);

    doc.setFont(PDF_VALUE_FONT, 'bold');
    doc.setFontSize(FONT.SIZE_FIELD_LABEL);
    doc.setTextColor(...COLOR.TEXT_PRIMARY);
    doc.text('PREFER YOUR PHONE?', qrX - 2, footnoteTop + 1.2, { align: 'right' });
    doc.setFont(PDF_VALUE_FONT, 'normal');
    doc.setFontSize(FONT.SIZE_FOOTER_SECONDARY);
    doc.setTextColor(...COLOR.TEXT_SECONDARY);
    doc.text('Scan to finish on-screen instead.', qrX - 2, footnoteTop + 4.2, { align: 'right' });
    doc.text('Only one signed record is created.', qrX - 2, footnoteTop + 6.8, { align: 'right' });
    doc.setTextColor(...COLOR.TEXT_PRIMARY);
    y = Math.max(y, footnoteTop - 2.4 + badge + SPACING.MD);
  }

  // NO checkPageBreak here. The reserve above already accounted for this
  // line, so a second break check can only do one thing: push a single
  // 5pt sentence onto a fresh sheet all by itself.
  doc.setFont(PDF_VALUE_FONT, 'normal');
  doc.setFontSize(FONT.SIZE_FOOTER_SECONDARY);
  doc.setTextColor(...COLOR.TEXT_TERTIARY);
  // Disposition line differs per copy: "retain this copy for your records"
  // is right for the person served and simply wrong on the agency file
  // copy or the sheet going back to the hiring client.
  const disposition = data.copy === 'company'
    ? 'Agency file copy - retain with the service record'
    : data.copy === 'client'
      ? 'Client copy - return with the proof of service'
      : 'Retain this copy for your records';
  doc.text(
    blank
      ? 'Utah R. Civ. P. 4(d)  ·  Complete in ink  ·  The process server retains the original; you keep a copy'
      : `Instrument No. ${data.receiptId}  ·  Utah R. Civ. P. 4(d)  ·  ${disposition}`,
    doc.internal.pageSize.getWidth() / 2, y, { align: 'center' },
  );

  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    // audienceLabel override: the default footer tag is "INTERNAL USE
    // ONLY", flatly contradictory on an instrument handed to the person
    // served. Same reasoning as the suppressed CONFIDENTIAL watermark.
    addPageFooter(doc, i, totalPages, 'serve_acknowledgement', {
      audienceLabel: blank
        ? 'FORM - COMPLETE BY HAND'
        : (data.copy ? RECEIPT_COPY_LABEL[data.copy].toUpperCase() : 'COPY FOR THE PERSON SERVED'),
    });
  }

  finalizePoliceReport(doc, {
    barcode: {
      // Scan-to-retrieve. A filed paper copy is otherwise a dead end: a
      // clerk holding it has a case number and a name and no way back to
      // the signed record, the GPS, or the attestation wording. The
      // instrument number is what makes the paper a pointer.
      //
      // Only on a SIGNED instrument. A blank has no record to retrieve,
      // and a barcode resolving to nothing is worse than none at all.
      ...(blank || !data.receiptId ? {} : { value: `RMPG-AOS:${data.receiptId}` }),
      formMetadata: {
        form: RECEIPT_FORM_KEY[data.variant],
        caseNumber: data.caseNumber,
        agency: 'RMPG',
        agencyOri: 'UT0180100',
        reportDate: signedDate,
        officer: data.serverName,
        badge: data.serverBadge,
      },
    },
  });

  return doc;
}

function sanitizePdfText(s: string): string { return String(s || "").replace(/[\x00-\x1F]/g, ""); }
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
  addPageFooter,
  checkPageBreak,
  setGenerationTimestamp,
  fetchPdfBranding,
  setActiveBranding,
  loadPdfAssets,
  setActiveFormKey,
  setActiveCaseNumber,

} from './pdfGenerator';
import {
  LAYOUT, SPACING, FONT, COLOR, BORDER,
  getContentWidth, getFullFieldWidth,
  getLeftX, getRightColumnX, getHalfFieldWidth,
  getProportionalColumns,
} from './pdfTokens';
import { drawNibrsHeader } from './pdfFormHelpers';

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

  // Header bar
  const barH = SPACING.SECTION_HEADER_H;
  doc.setFillColor(...COLOR.BG_SECTION_HDR);
  doc.rect(LAYOUT.PAGE_MARGIN, y, cw, barH, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT.SIZE_SECTION_TITLE);
  doc.setTextColor(...COLOR.TEXT_INVERTED);
  doc.text('NOTARY PUBLIC', LAYOUT.PAGE_MARGIN + SPACING.CONTENT_INSET + 1, y + barH / 2 + FONT.SIZE_SECTION_TITLE * 0.14);

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
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(FONT.SIZE_FIELD_LABEL);
      doc.setTextColor(...COLOR.TEXT_TERTIARY);
      doc.text('[Image unavailable]', lx + imgMaxW / 2, y + imgMaxH / 2, { align: 'center' });
    }

    // Caption
    doc.setFont('helvetica', 'normal');
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
  setActiveFormKey('');
  setGenerationTimestamp(new Date().toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }));

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
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // ── Server Information ──
  y = checkPageBreak(doc, y, 15);
  { const sec = openAutoSection(doc, 'Server Information', y); y = sec.contentY;
    const fy1 = addFieldPair(doc, '4. Server Name', data.serverName, lx, y, hfw);
    const fy2 = addFieldPair(doc, '5. Badge / License #', data.serverBadge, rx, y, hfw);
    y = Math.max(fy1, fy2);
    y = addFieldPair(doc, '6. Company', data.serverCompany, lx, y, ffw);
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // ── Recipient Information ──
  y = checkPageBreak(doc, y, 15);
  { const sec = openAutoSection(doc, 'Recipient Information', y); y = sec.contentY;
    y = addFieldPair(doc, '7. Recipient Name', data.recipientName, lx, y, ffw);
    y = addFieldPair(doc, '8. Address', data.recipientAddress, lx, y, ffw);
    y = addFieldPair(doc, '9. Document Type Served', data.documentType, lx, y, ffw);
    y = closeAutoSection(doc, sec.sectionY, y);
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
    const fy4 = addFieldPair(doc, '13. GPS', `${data.gpsLat.toFixed(6)}, ${data.gpsLng.toFixed(6)}`, rx, y, hfw);
    y = Math.max(fy3, fy4);
    if (data.serviceMethod === 'substitute' && data.substituteInfo) {
      const fy5 = addFieldPair(doc, '14. Substitute Name', data.substituteInfo.name, lx, y, hfw);
      const fy6 = addFieldPair(doc, '15. Relationship', data.substituteInfo.relationship, rx, y, hfw);
      y = Math.max(fy5, fy6);
      y = addFieldPair(doc, '16. Description', data.substituteInfo.description, lx, y, ffw);
    }
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // ── Photos ──
  if (data.photos && data.photos.length > 0) {
    y = checkPageBreak(doc, y, 40);
    const sec = openAutoSection(doc, 'Service Photos', y);
    y = sec.contentY;
    y = addPhotos(doc, data.photos, y);
    y = closeAutoSection(doc, sec.sectionY, y);
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
  doc.setFont('helvetica', 'italic');
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
  setActiveFormKey('');
  setGenerationTimestamp(new Date().toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }));

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
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // ── Server Information ──
  y = checkPageBreak(doc, y, 15);
  { const sec = openAutoSection(doc, 'Server Information', y); y = sec.contentY;
    const fy1 = addFieldPair(doc, '4. Server Name', data.serverName, lx, y, hfw);
    const fy2 = addFieldPair(doc, '5. Badge / License #', data.serverBadge, rx, y, hfw);
    y = Math.max(fy1, fy2);
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // ── Recipient Information ──
  y = checkPageBreak(doc, y, 15);
  { const sec = openAutoSection(doc, 'Recipient Information', y); y = sec.contentY;
    y = addFieldPair(doc, '6. Recipient Name', data.recipientName, lx, y, ffw);
    y = addFieldPair(doc, '7. Address', data.recipientAddress, lx, y, ffw);
    y = addFieldPair(doc, '8. Document Type', data.documentType, lx, y, ffw);
    y = closeAutoSection(doc, sec.sectionY, y);
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
      sanitizePdfText(a.time || '').toUpperCase(),
      `${a.gpsLat.toFixed(4)}, ${a.gpsLng.toFixed(4)}`,
      sanitizePdfText(a.result || '').toUpperCase(),
      sanitizePdfText(a.notes || '').toUpperCase(),
    ]);

    y = addTableWithShading(doc, headers, rows, y, cols);
    y += SPACING.SM;
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // ── Photos from attempts ──
  for (const attempt of data.attempts) {
    if (attempt.photos && attempt.photos.length > 0) {
      y = checkPageBreak(doc, y, 40);
      const sec = openAutoSection(doc, `Attempt #${attempt.number} Photos`, y);
      y = sec.contentY;
      y = addPhotos(doc, attempt.photos, y, `Attempt #${attempt.number}`);
      y = closeAutoSection(doc, sec.sectionY, y);
    }
  }

  // ── Skip Trace Summary ──
  if (data.skipTraces && data.skipTraces.length > 0) {
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

    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // ── Declaration ──
  y = checkPageBreak(doc, y, 30);
  {
    const sec = openAutoSection(doc, 'Declaration', y);
    y = sec.contentY;

    const declarationText =
      'I, the undersigned, being duly sworn, do hereby declare under penalty of perjury that ' +
      'I have made diligent efforts to serve the above-named recipient with the specified documents. ' +
      'Despite multiple attempts at service at various times and dates as detailed in this affidavit, ' +
      'I was unable to effect service upon the intended recipient. The information contained herein is ' +
      'true and correct to the best of my knowledge and belief.';

    y = addWrappedText(doc, declarationText, lx, y, ffw, FONT.SIZE_FIELD_VALUE);
    y += SPACING.MD;
    y = closeAutoSection(doc, sec.sectionY, y);
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
  doc.setFont('helvetica', 'italic');
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
  setActiveFormKey('');
  setGenerationTimestamp(new Date().toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }));

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
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // ── Summary Statistics ──
  const served = data.jobs.filter(j => j.result.toLowerCase() === 'served').length;
  const failed = data.jobs.filter(j => ['failed', 'unable'].some(s => j.result.toLowerCase().includes(s))).length;
  const pending = data.jobs.filter(j => j.result.toLowerCase() === 'pending').length;

  y = checkPageBreak(doc, y, 15);
  { const sec = openAutoSection(doc, 'Summary Statistics', y); y = sec.contentY;
    const fy1 = addFieldPair(doc, '4. Total Jobs', String(data.jobs.length), lx, y, hfw);
    const fy2 = addFieldPair(doc, '5. Served', String(served), rx, y, hfw);
    y = Math.max(fy1, fy2);
    const fy3 = addFieldPair(doc, '6. Failed', String(failed), lx, y, hfw);
    const fy4 = addFieldPair(doc, '7. Pending', String(pending), rx, y, hfw);
    y = Math.max(fy3, fy4);
    y = addFieldPair(doc, '8. Miles Driven', data.totalMileage.toFixed(1), lx, y, hfw);
    y = closeAutoSection(doc, sec.sectionY, y);
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
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // ── Route Efficiency ──
  if (data.routeEfficiency) {
    y = checkPageBreak(doc, y, 25);
    const sec = openAutoSection(doc, 'Route Efficiency', y);
    y = sec.contentY;
    const rowY = y;
    addFieldPair(doc, 'Planned Mileage', data.routeEfficiency.planned.toFixed(1), lx, rowY, hfw);
    y = addFieldPair(doc, 'Actual Mileage', data.routeEfficiency.actual.toFixed(1), rx, rowY, hfw);
    y += SPACING.SM;

    const efficiency = data.routeEfficiency.planned > 0
      ? ((data.routeEfficiency.actual / data.routeEfficiency.planned) * 100).toFixed(1)
      : 'N/A';
    y = addFieldPair(doc, 'Efficiency', efficiency !== 'N/A' ? `${efficiency}%` : efficiency, lx, y, hfw);
    y += SPACING.SM;
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // Add page footers to all pages
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    addPageFooter(doc, i, totalPages, 'service_log');
    if (i > 1) addConfidentialWatermark(doc);
  }

  return doc;
}

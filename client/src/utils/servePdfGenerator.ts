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
  getProportionalColumns, getCapHeight,
} from './pdfTokens';

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

function addCenteredTitle(doc: jsPDF, title: string, y: number, fontSize = 14): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(fontSize);
  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  doc.text(title, pageWidth / 2, y, { align: 'center' });
  // Reset font state so callers don't inherit bold/large size
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(FONT.SIZE_FIELD_VALUE);
  return y + fontSize * 0.5 + SPACING.LG;
}

// ── Helper: Notary section ───────────────────────────────────

function addNotarySection(doc: jsPDF, y: number): number {
  const cw = getContentWidth(doc);
  const lx = getLeftX();
  const boxH = 42;

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
  const notaryCap = getCapHeight(FONT.SIZE_SECTION_TITLE);
  doc.text('NOTARY PUBLIC', LAYOUT.PAGE_MARGIN + SPACING.CONTENT_INSET + 1, y + (barH + notaryCap) / 2);

  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  let ny = y + barH + SPACING.LG + SPACING.MD;

  // Notary lines
  const lineX1 = lx;
  const lineX2 = LAYOUT.PAGE_MARGIN + cw - SPACING.CONTENT_INSET;
  const lineGap = 8;
  const notaryLabelOffset = getCapHeight(FONT.SIZE_SIGNATURE_LABEL) + SPACING.SM;

  doc.setDrawColor(...COLOR.TEXT_PRIMARY);
  doc.setLineWidth(BORDER.SIGNATURE_LINE);

  // Notary Name line
  doc.line(lineX1, ny, lineX2, ny);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(FONT.SIZE_SIGNATURE_LABEL);
  doc.setTextColor(...COLOR.TEXT_TERTIARY);
  doc.text('NOTARY NAME', lineX1, ny + notaryLabelOffset);
  ny += lineGap;

  // Commission # line
  doc.setDrawColor(...COLOR.TEXT_PRIMARY);
  doc.line(lineX1, ny, lineX2, ny);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(FONT.SIZE_SIGNATURE_LABEL);
  doc.setTextColor(...COLOR.TEXT_TERTIARY);
  doc.text('COMMISSION NUMBER / EXPIRATION', lineX1, ny + notaryLabelOffset);
  ny += lineGap;

  // Date line
  doc.setDrawColor(...COLOR.TEXT_PRIMARY);
  doc.line(lineX1, ny, lineX2, ny);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(FONT.SIZE_SIGNATURE_LABEL);
  doc.setTextColor(...COLOR.TEXT_TERTIARY);
  doc.text('DATE', lineX1, ny + notaryLabelOffset);

  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  doc.setFontSize(FONT.SIZE_FIELD_VALUE);
  return y + boxH + SPACING.SECTION_GAP;
}

// ── Helper: Embed photos ─────────────────────────────────────

function addPhotos(doc: jsPDF, photos: string[], y: number, label?: string): number {
  if (!photos || photos.length === 0) return y;

  const cw = getContentWidth(doc);
  const lx = getLeftX();
  const imgMaxW = cw - 2 * SPACING.CONTENT_INSET;
  const imgMaxH = 60;
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
      doc.text(label.toUpperCase(), lx, y + getCapHeight(FONT.SIZE_FIELD_LABEL) + SPACING.SM);
      y += SPACING.CAUTION_PAD;
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
  let y = addReportHeader(doc, data.caseNumber, 'Affidavit of Service', 'routine', undefined, { useLogo: true });

  // Title
  y = addCenteredTitle(doc, 'AFFIDAVIT OF SERVICE', y + SPACING.MD);

  // ── Court Information ──
  {
    const sec = openAutoSection(doc, 'Court Information', y);
    y = sec.contentY;
    y = addFieldPair(doc, 'Court Name', data.courtName, lx, y, ffw);
    y += SPACING.SM;
    const rowY = y;
    addFieldPair(doc, 'Case Number', data.caseNumber, lx, rowY, hfw);
    y = addFieldPair(doc, 'Jurisdiction', data.jurisdiction, rx, rowY, hfw);
    y += SPACING.SM;
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Server Information ──
  y = checkPageBreak(doc, y, 25);
  {
    const sec = openAutoSection(doc, 'Server Information', y);
    y = sec.contentY;
    const rowY1 = y;
    addFieldPair(doc, 'Full Name', data.serverName, lx, rowY1, hfw);
    y = addFieldPair(doc, 'Badge / License #', data.serverBadge, rx, rowY1, hfw);
    y += SPACING.SM;
    y = addFieldPair(doc, 'Company', data.serverCompany, lx, y, ffw);
    y += SPACING.SM;
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Recipient Information ──
  y = checkPageBreak(doc, y, 25);
  {
    const sec = openAutoSection(doc, 'Recipient Information', y);
    y = sec.contentY;
    y = addFieldPair(doc, 'Recipient Name', data.recipientName, lx, y, ffw);
    y += SPACING.SM;
    y = addFieldPair(doc, 'Address', data.recipientAddress, lx, y, ffw);
    y += SPACING.SM;
    y = addFieldPair(doc, 'Document Type Served', data.documentType, lx, y, ffw);
    y += SPACING.SM;
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Service Details ──
  y = checkPageBreak(doc, y, 30);
  {
    const sec = openAutoSection(doc, 'Service Details', y);
    y = sec.contentY;
    const methodLabel = data.serviceMethod === 'personal' ? 'Personal Service'
      : data.serviceMethod === 'substitute' ? 'Substitute Service'
      : 'Posting';
    const r1y = y;
    addFieldPair(doc, 'Date of Service', data.serviceDate, lx, r1y, hfw);
    y = addFieldPair(doc, 'Time of Service', data.serviceTime, rx, r1y, hfw);
    y += SPACING.SM;
    const r2y = y;
    addFieldPair(doc, 'Method of Service', methodLabel, lx, r2y, hfw);
    y = addFieldPair(doc, 'GPS Coordinates', `${(data.gpsLat ?? 0).toFixed(6)}, ${(data.gpsLng ?? 0).toFixed(6)}`, rx, r2y, hfw);
    y += SPACING.SM;

    // Substitute service details
    if (data.serviceMethod === 'substitute' && data.substituteInfo) {
      y = addFieldPair(doc, 'Person Served (Substitute)', data.substituteInfo.name, lx, y, ffw);
      y += SPACING.SM;
      const r3y = y;
      addFieldPair(doc, 'Relationship', data.substituteInfo.relationship, lx, r3y, hfw);
      y = addFieldPair(doc, 'Physical Description', data.substituteInfo.description, rx, r3y, hfw);
      y += SPACING.SM;
    }

    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Photos ──
  if (data.photos && data.photos.length > 0) {
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
    addPageFooter(doc, i, totalPages);
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
  let y = addReportHeader(doc, data.caseNumber, 'Affidavit of Non-Service', 'routine', undefined, { useLogo: true });

  // Title
  y = addCenteredTitle(doc, 'AFFIDAVIT OF DUE DILIGENCE / NON-SERVICE', y + SPACING.MD);

  // ── Court Information ──
  {
    const sec = openAutoSection(doc, 'Court Information', y);
    y = sec.contentY;
    y = addFieldPair(doc, 'Court Name', data.courtName, lx, y, ffw);
    y += SPACING.SM;
    const rowY = y;
    addFieldPair(doc, 'Case Number', data.caseNumber, lx, rowY, hfw);
    y = addFieldPair(doc, 'Jurisdiction', data.jurisdiction, rx, rowY, hfw);
    y += SPACING.SM;
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Server Information ──
  y = checkPageBreak(doc, y, 20);
  {
    const sec = openAutoSection(doc, 'Server Information', y);
    y = sec.contentY;
    const rowY = y;
    addFieldPair(doc, 'Full Name', data.serverName, lx, rowY, hfw);
    y = addFieldPair(doc, 'Badge / License #', data.serverBadge, rx, rowY, hfw);
    y += SPACING.SM;
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Recipient Information ──
  y = checkPageBreak(doc, y, 25);
  {
    const sec = openAutoSection(doc, 'Recipient Information', y);
    y = sec.contentY;
    y = addFieldPair(doc, 'Recipient Name', data.recipientName, lx, y, ffw);
    y += SPACING.SM;
    y = addFieldPair(doc, 'Address', data.recipientAddress, lx, y, ffw);
    y += SPACING.SM;
    y = addFieldPair(doc, 'Document Type', data.documentType, lx, y, ffw);
    y += SPACING.SM;
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
    const rows = (data.attempts || []).map(a => [
      String(a.number),
      a.date,
      a.time,
      `${(a.gpsLat ?? 0).toFixed(4)}, ${(a.gpsLng ?? 0).toFixed(4)}`,
      a.result,
      a.notes,
    ]);

    y = addTableWithShading(doc, headers, rows, y, cols);
    y += SPACING.SM;
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Photos from attempts ──
  for (const attempt of (data.attempts || [])) {
    if (attempt.photos && attempt.photos.length > 0) {
      y = checkPageBreak(doc, y, 40);
      const sec = openAutoSection(doc, `Attempt #${attempt.number} Photos`, y);
      y = sec.contentY;
      y = addPhotos(doc, attempt.photos, y, `Attempt #${attempt.number}`);
      y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
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
        y = addFieldPair(doc, 'Addresses Tried', trace.addressesTried.join('; '), lx, y, ffw);
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
    y = sec.contentY;

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
  const sigDate = new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
  y = addSignatureBlock(doc, 'Process Server Signature', lx, y, ffw, data.signature ? {
    signatureImage: data.signature,
    printedName: data.serverName,
    badgeNumber: data.serverBadge,
    date: sigDate,
  } : {
    printedName: data.serverName,
    badgeNumber: data.serverBadge,
    date: sigDate,
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
    addPageFooter(doc, i, totalPages);
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

  const dateRangeLabel = `${data.dateRange.start} — ${data.dateRange.end}`;
  setActiveCaseNumber('');
  let y = addReportHeader(doc, '', 'Service Log Report', 'routine', undefined, { useLogo: true });

  // Title + date range subtitle
  y = addCenteredTitle(doc, 'SERVICE LOG REPORT', y + SPACING.MD);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(FONT.SIZE_FIELD_VALUE);
  doc.setTextColor(...COLOR.TEXT_SECONDARY);
  doc.text(dateRangeLabel, doc.internal.pageSize.getWidth() / 2, y - SPACING.SM, { align: 'center' });
  y += SPACING.MD;

  // ── Officer Information ──
  {
    const sec = openAutoSection(doc, 'Officer Information', y);
    y = sec.contentY;
    const rowY = y;
    addFieldPair(doc, 'Officer Name', data.officerName, lx, rowY, hfw);
    y = addFieldPair(doc, 'Badge #', data.officerBadge, rx, rowY, hfw);
    y += SPACING.SM;
    y = addFieldPair(doc, 'Date Range', dateRangeLabel, lx, y, ffw);
    y += SPACING.SM;
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Summary Statistics ──
  y = checkPageBreak(doc, y, 25);
  {
    const sec = openAutoSection(doc, 'Summary Statistics', y);
    y = sec.contentY;

    const served = data.jobs.filter(j => j.result.toLowerCase() === 'served').length;
    const failed = data.jobs.filter(j => ['failed', 'unable'].some(s => j.result.toLowerCase().includes(s))).length;
    const pending = data.jobs.filter(j => j.result.toLowerCase() === 'pending').length;

    // Use proportional columns for 5 stats
    const statCols = getProportionalColumns(doc, [1, 1, 1, 1, 1]);
    const statW = (ffw - 4 * SPACING.SM) / 5;

    const stats = [
      { label: 'Total Jobs', value: String(data.jobs.length) },
      { label: 'Served', value: String(served) },
      { label: 'Failed', value: String(failed) },
      { label: 'Pending', value: String(pending) },
      { label: 'Miles Driven', value: data.totalMileage.toFixed(1) },
    ];

    stats.forEach((stat, i) => {
      addFieldPair(doc, stat.label, stat.value, statCols[i], y, statW);
    });

    y += SPACING.FIELD_ROW_ADVANCE + SPACING.LG;
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
      rows.push([`[${clientName}]`, '', '', '', '']);
      for (const job of jobs) {
        rows.push([
          job.recipientName,
          job.address,
          job.documentType,
          String(job.attempts),
          job.result,
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
    addFieldPair(doc, 'Planned Mileage', data.routeEfficiency.planned.toFixed(1), lx, rowY, hfw);
    y = addFieldPair(doc, 'Actual Mileage', data.routeEfficiency.actual.toFixed(1), rx, rowY, hfw);
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
    addPageFooter(doc, i, totalPages);
    if (i > 1) addConfidentialWatermark(doc);
  }

  return doc;
}

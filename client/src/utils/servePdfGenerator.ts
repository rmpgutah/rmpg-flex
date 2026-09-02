// ============================================================
// RMPG Flex — Process Server PDF Generator
// Affidavit of Service, Affidavit of Non-Service, Service Log
// Reuses helpers from pdfGenerator.ts + pdfTokens.ts
// ============================================================

import jsPDF from 'jspdf';
import QRCode from 'qrcode';
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
  getActiveBranding,
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
  getRailX, getRailWidth,
} from './pdfTokens';
import { drawNibrsHeader } from './pdfFormHelpers';
import { registerArialFont } from './pdf/fonts/registerArial';
import { parseTimestamp } from './dateUtils';
import { toDisplayLabel } from './formatters';

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

function addNotarySection(doc: jsPDF, y: number, heading = 'JURAT'): number {
  const cw = getContentWidth(doc);
  const lx = getLeftX();
  // 42mm fitted the old three-bare-rules block. A real jurat carries a venue,
  // the subscribed-and-sworn clause, a notary signature, the commission
  // expiry and a seal box -- content that ended at ~41.8mm, so the commission
  // label landed ON the box border and the rule struck through the Rule 4(d)
  // citation drawn beneath it.
  // Content measures ~42mm (venue 13 + oath 11 + signature/commission 15 +
  // padding); 45 leaves 3mm clearance without over-reserving. At 48, plus a
  // 10mm citation reserve, the block asked for 60mm against ~57mm of
  // remaining page and pushed the JURAT alone onto a second sheet -- a jurat
  // separated from the affidavit it certifies is a standard rejection reason,
  // so the reserve has to be honest rather than generous.
  const boxH = 45;

  // +6 covers the single 5pt Rule 4(d) citation the callers draw immediately
  // after this block, so the two stay together instead of the citation
  // triggering a break of its own.
  y = checkPageBreak(doc, y, boxH + SPACING.LG + 6);

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
  doc.setFont(PDF_VALUE_FONT, 'bold');
  doc.setFontSize(FONT.SIZE_SECTION_TITLE);
  doc.setTextColor(...COLOR.TEXT_INVERTED);
  doc.text(heading, LAYOUT.PAGE_MARGIN + SPACING.CONTENT_INSET,
    y + (barH + getCapHeight(FONT.SIZE_SECTION_TITLE)) / 2);

  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  let ny = y + barH + SPACING.MD + 2;

  // ── Venue ──
  // A jurat is not three blank lines. It needs a VENUE (the state and county
  // where the oath was administered), the subscribed-and-sworn clause with
  // the date, the notary's signature, the commission expiry, and somewhere
  // for the seal. Utah R. Civ. P. 4(d) affidavits are routinely rejected for
  // a defective jurat, and the previous block -- NOTARY NAME / COMMISSION
  // NUMBER / DATE on bare rules -- had no venue and no oath language at all.
  const VEN_FONT = FONT.SIZE_FIELD_VALUE;
  doc.setFont(PDF_VALUE_FONT, 'normal');
  doc.setFontSize(VEN_FONT);
  const braceX = lx + 46;
  doc.text('STATE OF UTAH', lx, ny);
  doc.text(')', braceX, ny);
  doc.text(') ss.', braceX, ny + 4);
  doc.text('COUNTY OF', lx, ny + 8);
  doc.text(')', braceX, ny + 8);
  // Writable county rule — the county is where the oath is taken, which is
  // not necessarily the county of service.
  doc.setDrawColor(...COLOR.BORDER_FIELD_RULE);
  doc.setLineWidth(BORDER.FIELD);
  doc.line(lx + doc.getTextWidth('COUNTY OF ') + 1, ny + 8.6, braceX - 2, ny + 8.6);
  ny += 13;

  // ── Subscribed and sworn ──
  const rule = (x1: number, x2: number, yy: number) => {
    doc.setDrawColor(...COLOR.BORDER_FIELD_RULE);
    doc.setLineWidth(BORDER.FIELD);
    doc.line(x1, yy, x2, yy);
  };
  doc.setFont(PDF_VALUE_FONT, 'normal');
  doc.setFontSize(VEN_FONT);
  const p1 = 'Subscribed and sworn to before me this';
  doc.text(p1, lx, ny);
  let cx = lx + doc.getTextWidth(p1) + 2;
  rule(cx, cx + 12, ny + 0.6); cx += 14;                    // day
  doc.text('day of', cx, ny); cx += doc.getTextWidth('day of') + 2;
  rule(cx, cx + 34, ny + 0.6); cx += 36;                    // month
  doc.text(', 20', cx, ny); cx += doc.getTextWidth(', 20') + 1;
  rule(cx, cx + 10, ny + 0.6);                              // year
  doc.text('.', cx + 11, ny);
  ny += 11;

  // ── Notary signature, commission, and seal ──
  // Seal box on the right so the impression has a defined place to land and
  // cannot overprint the signature -- the single most common reason a
  // notarised affidavit comes back for correction.
  const sealW = 44;
  const sealX = LAYOUT.PAGE_MARGIN + cw - sealW;
  const sigW = sealX - lx - 8;

  rule(lx, lx + sigW, ny);
  doc.setFont(PDF_VALUE_FONT, 'normal');
  doc.setFontSize(FONT.SIZE_SIGNATURE_LABEL);
  doc.setTextColor(...COLOR.TEXT_TERTIARY);
  doc.text('SIGNATURE OF NOTARY PUBLIC', lx, ny + 2.8);

  const commY = ny + 7.5;
  rule(lx, lx + sigW, commY);
  doc.text('MY COMMISSION EXPIRES', lx, commY + 2.8);

  doc.setDrawColor(...COLOR.TEXT_TERTIARY);
  doc.setLineWidth(BORDER.FIELD);
  doc.rect(sealX, ny - 6.5, sealW, 17);
  doc.setFontSize(FONT.SIZE_SIGNATURE_LABEL);
  doc.setTextColor(...COLOR.TEXT_TERTIARY);
  doc.text('AFFIX NOTARY SEAL', sealX + sealW / 2, ny + 2.5, { align: 'center' });

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
    formTitle: 'CIVIL PROCESS RECORD',
    caseNumber: data.caseNumber,
    reportDate: data.serviceDate || '',
  });

  const INSTRUMENT_TITLE = 'AFFIDAVIT OF SERVICE';

  // Article numbers assigned as drawn -- Service Photos only renders when
  // photos exist, so a hard-coded sequence would leave a gap on most
  // affidavits and read as a missing article on a filed document.
  const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
  let article = 0;
  const art = (title: string) => `${ROMAN[article++]}. ${title}`;

  // ── Docket furniture ──
  // Same opening as the Civil Process Record so every instrument in a serve
  // file reads as one set: family header, court heading, pleading caption,
  // instrument title. The affidavits previously opened straight onto a flat
  // "COURT INFORMATION" strip of label-over-rule fields, which shared no
  // visual language with the Acknowledgement at all.
  y = drawCourtHeading(doc, y, data.courtName, data.jurisdiction);
  y = drawPleadingCaption(doc, y, {
    plaintiff: (data as { plaintiffName?: string }).plaintiffName || '',
    defendant: (data as { defendantName?: string }).defendantName || data.recipientName || '',
    caseNumber: data.caseNumber,
    instrumentTitle: INSTRUMENT_TITLE,
  });
  y = drawInstrumentTitle(doc, y, INSTRUMENT_TITLE);

  // Court, case number and jurisdiction are carried by the court heading and
  // the pleading caption above. The old COURT INFORMATION section restated
  // all three a third time, immediately beneath them -- the non-service
  // affidavit dropped it for the same reason when it was reformatted.

  // ── Server Information ──
  y = checkPageBreak(doc, y, 15);
  { const sec = openAutoSection(doc, art('Server Information'), y); y = sec.contentY;
    const fy1 = addFieldPair(doc, '1. Server Name', data.serverName, lx, y, hfw);
    const fy2 = addFieldPair(doc, '2. Badge / License #', data.serverBadge, rx, y, hfw);
    y = Math.max(fy1, fy2);
    y = addFieldPair(doc, '3. Company', data.serverCompany, lx, y, ffw);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Recipient Information ──
  y = checkPageBreak(doc, y, 15);
  { const sec = openAutoSection(doc, art('Recipient Information'), y); y = sec.contentY;
    y = addFieldPair(doc, '4. Recipient Name', data.recipientName, lx, y, ffw);
    y = addFieldPair(doc, '5. Address', data.recipientAddress, lx, y, ffw);
    y = addFieldPair(doc, '6. Document Type Served', data.documentType, lx, y, ffw);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Service Details ──
  const methodLabel = data.serviceMethod === 'personal' ? 'Personal Service'
    : data.serviceMethod === 'substitute' ? 'Substitute Service'
    : 'Posting';
  y = checkPageBreak(doc, y, 15);
  { const sec = openAutoSection(doc, art('Service Details'), y); y = sec.contentY;
    const fy1 = addFieldPair(doc, '7. Date of Service', data.serviceDate, lx, y, hfw);
    // Zone-labelled like every other time on these instruments. This is the
    // moment service was effected -- the single most consequential timestamp
    // on the document -- and it was the only one still printing bare.
    const fy2 = addFieldPair(doc, '8. Time', withZone(data.serviceTime || ''), rx, y, hfw);
    y = Math.max(fy1, fy2);
    const fy3 = addFieldPair(doc, '9. Method', methodLabel, lx, y, hfw);
    const gpsText = (data.gpsLat != null && data.gpsLng != null)
      ? `${Number(data.gpsLat).toFixed(6)}, ${Number(data.gpsLng).toFixed(6)}`
      : 'N/A';
    const fy4 = addFieldPair(doc, '10. GPS', gpsText, rx, y, hfw);
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
    const sec = openAutoSection(doc, art('Service Photos'), y);
    y = sec.contentY;
    y = addPhotos(doc, data.photos, y);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Signature Block ──
  y = checkPageBreak(doc, y, SPACING.SIGNATURE_BOX_H + SPACING.LG);
  const certification =
    'I declare under penalty of perjury that the foregoing is true and correct.';

  // The signature block's DATE/TIME column printed a bare date. On an
  // affidavit the attested moment is a date AND a time, and it carries a zone
  // like every other timestamp on the instrument.
  const serviceMoment = data.serviceTime
    ? withZone(`${data.serviceDate} ${data.serviceTime}`)
    : data.serviceDate;

  y = addSignatureBlock(doc, art('Process Server'), getRailX(), y, getRailWidth(doc), data.signature ? {
    signatureImage: data.signature,
    certification,
    printedName: data.serverName,
    badgeNumber: data.serverBadge,
    date: serviceMoment,
  } : {
    printedName: data.serverName,
    badgeNumber: data.serverBadge,
    date: serviceMoment,
    // Was omitted here, so an UNSIGNED affidavit -- the one printed for wet
    // signature, i.e. the common case -- rendered an empty box stating
    // nothing, while the signed variant carried the declaration.
    certification,
  });
  y += SPACING.SECTION_GAP;

  // ── Notary Section ──
  y = addNotarySection(doc, y, art('Jurat').toUpperCase());

  // ── Footer legal text ──
  // Reserved WITH the jurat above rather than on its own. A bare
  // checkPageBreak here exiled this single 5pt line onto a second sheet --
  // an otherwise blank page carrying nothing but a CONTINUED banner and one
  // citation, on a document that is filed with a court. The jurat's own
  // reserve already guarantees room for the block; this line rides with it.
  //
  // Cleared below the jurat's bottom border: at the section gap alone the
  // baseline landed ON the rule and the citation read as struck through.
  y += 3;
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

  tightLayout = false;

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
    formTitle: 'CIVIL PROCESS RECORD',
    caseNumber: data.caseNumber,
  });

  const INSTRUMENT_TITLE = 'AFFIDAVIT OF DUE DILIGENCE / NON-SERVICE';

  // Article numbers are ASSIGNED AS DRAWN, not hard-coded. Skip Trace only
  // renders when there is skip-trace data, so a fixed sequence printed
  // "I, II, III, V, VI" on every affidavit without it -- a gap that reads on
  // a filed document as a missing article rather than an absent one.
  const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
  let article = 0;
  const art = (title: string) => `${ROMAN[article++]}. ${title}`;

  // ── Docket furniture ──
  // Same opening as the Civil Process Record so every instrument in a serve
  // file reads as one set: family header, court heading, pleading caption,
  // instrument title. The affidavits previously opened straight onto a flat
  // "COURT INFORMATION" strip of label-over-rule fields, which shared no
  // visual language with the Acknowledgement at all.
  y = drawCourtHeading(doc, y, data.courtName, data.jurisdiction);
  y = drawPleadingCaption(doc, y, {
    plaintiff: (data as { plaintiffName?: string }).plaintiffName || '',
    defendant: (data as { defendantName?: string }).defendantName || data.recipientName || '',
    caseNumber: data.caseNumber,
    instrumentTitle: INSTRUMENT_TITLE,
  });
  y = drawInstrumentTitle(doc, y, INSTRUMENT_TITLE);

  // Court / case identification now lives in the caption above, so the old
  // COURT INFORMATION section would restate it verbatim three rows running.

  // ── Server Information ──
  y = checkPageBreak(doc, y, 15);
  { const sec = openAutoSection(doc, art('Server Information'), y); y = sec.contentY;
    const fy1 = addFieldPair(doc, '1. Server Name', data.serverName, lx, y, hfw);
    const fy2 = addFieldPair(doc, '2. Badge / License #', data.serverBadge, rx, y, hfw);
    y = Math.max(fy1, fy2);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Recipient Information ──
  y = checkPageBreak(doc, y, 15);
  { const sec = openAutoSection(doc, art('Recipient Information'), y); y = sec.contentY;
    y = addFieldPair(doc, '3. Recipient Name', data.recipientName, lx, y, ffw);
    y = addFieldPair(doc, '4. Address', data.recipientAddress, lx, y, ffw);
    y = addFieldPair(doc, '5. Document Type', data.documentType, lx, y, ffw);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Attempt History Table ──
  y = checkPageBreak(doc, y, 22);
  {
    const sec = openAutoSection(doc, art('Attempt History'), y);
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
    y = checkPageBreak(doc, y, 22);
    const sec = openAutoSection(doc, art('Skip Trace Summary'), y);
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
  y = checkPageBreak(doc, y, 22);
  {
    const sec = openAutoSection(doc, art('Declaration'), y);
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
  // Certification drawn INSIDE the signature row (see addSignatureBlock):
  // the block previously opened onto an empty ruled box with nothing stated
  // above it. Worded against the DECLARATION this affidavit already makes,
  // and it does not restate the name or badge printed in the row below.
  const certification =
    'I declare under penalty of perjury that the foregoing is true and correct.';

  y = addSignatureBlock(doc, art('Process Server'), getRailX(), y, getRailWidth(doc), data.signature ? {
    signatureImage: data.signature,
    certification,
    printedName: data.serverName,
    badgeNumber: data.serverBadge,
  } : {
    printedName: data.serverName,
    badgeNumber: data.serverBadge,
    certification,
  }, 11, 7);
  y += SPACING.SECTION_GAP;

  // ── Notary Section ──
  y = addNotarySection(doc, y, art('Jurat').toUpperCase());

  // ── Footer legal text ──
  // Reserved WITH the jurat above rather than on its own. A bare
  // checkPageBreak here exiled this single 5pt line onto a second sheet --
  // an otherwise blank page carrying nothing but a CONTINUED banner and one
  // citation, on a document that is filed with a court. The jurat's own
  // reserve already guarantees room for the block; this line rides with it.
  //
  // Cleared below the jurat's bottom border: at the section gap alone the
  // baseline landed ON the rule and the citation read as struck through.
  y += 3;
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

  tightLayout = false;

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
    default: return result ? toDisplayLabel(result) : 'Unsuccessful';
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
 *
 * AM/PM does NOT count as already-zoned. It disambiguates the HOUR, not the
 * zone: "07:35 AM" still does not say whether that is Mountain or Eastern,
 * which on a cross-jurisdiction serve is exactly the open question. Only a
 * real zone token suppresses the suffix.
 */
/**
 * Bucket an attempt time into the diligence window it falls in.
 *
 * Diligence on a serve job is written as time windows -- "1 attempt between
 * 7AM and 9AM, 1 between 9AM and 7PM, 1 between 7PM and 9PM" is a live
 * instruction on these jobs. Both the recipient and the court read the
 * attempt table to judge whether the server actually varied the hours or
 * knocked three times on the same afternoon, and until now that meant doing
 * the arithmetic in your head across a column of raw clock times.
 *
 * Boundaries follow the common early/day/evening split. Returns '' when the
 * time is absent or unparseable so the cell falls back to the table's
 * empty-cell convention rather than asserting a window that was not recorded.
 */
export function attemptWindow(time: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec((time || '').trim());
  if (!m) return '';
  let h = parseInt(m[1], 10);
  if (Number.isNaN(h)) return '';
  // Respect a 12-hour value if one was supplied.
  if (/\bPM\b/i.test(time) && h < 12) h += 12;
  if (/\bAM\b/i.test(time) && h === 12) h = 0;
  if (h < 9) return 'EARLY';
  if (h < 19) return 'DAY';
  return 'EVENING';
}

export function withZone(time: string): string {
  const t = (time || '').trim();
  if (!t) return '';
  return /\b(MT|MST|MDT)\b/.test(t) ? t : `${t} MT`;
}

export async function generateNoticeOfAttempt(data: NoticeOfAttemptData, options: NoticeOfAttemptOptions = {}): Promise<jsPDF> {
  const branding = await fetchPdfBranding();
  setActiveBranding(branding);
  await loadPdfAssets();

  // Defensive reset: a prior render that threw after setting tightLayout=true
  // would leave it set, causing this render to silently use compact spacing.
  // A stale true here is the only way the notice gets tight spacing without
  // actually being in a tight-fit scenario.
  tightLayout = false;

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
    formTitle: 'CIVIL PROCESS RECORD',
    caseNumber: headerRef,
    caseNumberLabel: data.agencyRefNumber ? 'AGENCY REF #' : 'CASE NUMBER',
    // The header box is a two-row table. Passing no reportDate left the
    // second row drawn but empty, which reads as a defect on a document
    // handed to a stranger. The notice date belongs there anyway -- it is
    // the same slot the Civil Process Record uses for its service date, so
    // the two instruments now open identically.
    reportDate: data.noticeDate,
  });

  // ── Docket furniture: court heading, then the instrument title bar ──
  // Matches the Civil Process Record so the two documents in a single serve
  // file read as one instrument set. No pleading caption: the Notice has no
  // plaintiff on record, and inventing one to fill a caption would put a
  // party on a legal document that nobody entered.
  y = drawCourtHeading(doc, y, data.courtName, data.jurisdiction);
  y = drawInstrumentTitle(doc, y, 'NOTICE OF ATTEMPT TO SERVE');

  // ── Status band ──
  // The operative fact of this instrument -- that service was ATTEMPTED and
  // NOT completed, and how many times -- was previously something the reader
  // had to infer by counting rows in the attempt table. On a document left at
  // a door, read once, standing up, the headline fact belongs at the top in
  // one line. Outlined rather than filled so it reads as a status stamp and
  // cannot be mistaken for the tinted advisory band further down.
  {
    const n = data.attempts.length;
    const bandH = 6.4;
    // Drawn on the RAIL (getRailX/getRailWidth), not lx/ffw — every other
    // full-bleed block on this page (section header bars, the I(a)/I(b)
    // panels, the signature block) shares that same left/right edge. This
    // band previously sat 1mm inset on both sides, reading as a wobble in
    // the page's left margin when the eye tracks straight down.
    // Light fill distinguishes this from plain bordered boxes elsewhere on
    // the page and gives the status stamp visual weight proportional to its
    // importance without competing with the tinted section headers.
    doc.setFillColor(242, 245, 249);
    doc.setDrawColor(...COLOR.TEXT_PRIMARY);
    doc.setLineWidth(BORDER.SECTION_OUTER);
    doc.rect(getRailX(), y, getRailWidth(doc), bandH, 'FD');
    doc.setFont(PDF_VALUE_FONT, 'bold');
    doc.setFontSize(FONT.SIZE_FIELD_VALUE + 1);
    doc.setTextColor(...COLOR.TEXT_PRIMARY);
    doc.text(
      `SERVICE NOT COMPLETED  ·  ${n} ATTEMPT${n === 1 ? '' : 'S'} MADE AT THIS ADDRESS`,
      doc.internal.pageSize.getWidth() / 2, y + bandH / 2 + 1.5, { align: 'center' },
    );
    y += bandH + SPACING.SM;
  }

  // ── Article I — who this concerns, and under what case ──
  // Two boxed panels, the same furniture the Civil Process Record uses for
  // I(a)/I(b). The flat label-over-rule fields these replace put the
  // recipient's name, the address, the court and the hiring party in one
  // undifferentiated column, so nothing signalled which facts were about the
  // READER and which were about the CASE. The box edge does that work.
  const courtCaseDisplay = (data.caseNumber && data.caseNumber !== headerRef) ? data.caseNumber : 'N/A';
  // When both attorney and client are present, split onto separate lines so
  // the combined string doesn't wrap mid-name in the narrow panel column.
  // "\n" is honoured by drawSubjectPanel's value-splitting logic.
  const hiringPartyLabel = (() => {
    if (data.attorneyName && data.clientName) {
      return `${data.attorneyName} (Atty)\n${data.clientName}`;
    }
    return data.attorneyName || data.clientName || 'N/A';
  })();

  y = checkPageBreak(doc, y, 24);
  {
    const gutter = SPACING.MD;
    // Panels sized from the rail and drawn from the rail. Sized from
    // getContentWidth but drawn from getLeftX, the pair ran a millimetre past
    // the right rail every section bar sits on.
    const railX = getRailX();
    const panelW = (getRailWidth(doc) - gutter) / 2;
    const startY = y;

    const recipientRows: SubjectRow[] = [
      { label: 'Service address', value: data.recipientAddress },
      { label: 'Document(s) to serve', value: data.documentType },
    ];
    const caseRows: SubjectRow[] = [
      { label: 'Case number', value: courtCaseDisplay },
      { label: 'Jurisdiction', value: data.jurisdiction },
      { label: 'Hiring party', value: hiringPartyLabel },
    ];

    // Two passes: measure both, then redraw at a shared height so the boxes
    // bottom out level. Same technique the Civil Process Record uses.
    const hA = drawSubjectPanel(doc, railX, startY, panelW, 'I(a).  Intended Recipient',
      data.recipientName, 'Person named in the process', recipientRows, undefined, true);
    const hB = drawSubjectPanel(doc, railX + panelW + gutter, startY, panelW, 'I(b).  Case Information',
      data.courtName, 'Court in which the matter is pending', caseRows, undefined, true);
    const panelH = Math.max(hA, hB);

    const aEnd = drawSubjectPanel(doc, railX, startY, panelW, 'I(a).  Intended Recipient',
      data.recipientName, 'Person named in the process', recipientRows, panelH);
    const bEnd = drawSubjectPanel(doc, railX + panelW + gutter, startY, panelW, 'I(b).  Case Information',
      data.courtName, 'Court in which the matter is pending', caseRows, panelH);
    y = Math.max(aEnd, bEnd) + SPACING.LG;
  }

  // ── Attempt Record ──
  // One-page constraint: this notice is left at a door / mailed, so it must fit
  // a single sheet. Show only the most recent attempts (the Affidavit of
  // Non-Service carries the full history) and clamp note length.
  const MAX_NOTICE_ATTEMPTS = 6;
  const MAX_NOTE_CHARS = 90;
  /** Combined note+GPS budget for a row that carries coordinates. */
  const GPS_ROW_NOTE_CHARS = 58;
  y = checkPageBreak(doc, y, 22);
  {
    const sec = openAutoSection(doc, 'II. Record of Attempt(s)', y);
    y = sec.contentY;
    // WINDOW is worth a column of its own: it is the field that shows whether
    // the attempts were actually spread across the day, which is the whole
    // point of a diligence requirement. Room comes out of NOTES, which is
    // already clamped to MAX_NOTE_CHARS.
    const cols = getProportionalColumns(doc, [0.8, 1.9, 1.5, 1.3, 2.8, 2.7]);
    const headers = [
      { label: '#', x: cols[0] },
      { label: 'DATE', x: cols[1] },
      { label: 'TIME', x: cols[2] },
      { label: 'WINDOW', x: cols[3] },
      { label: 'RESULT', x: cols[4] },
      { label: 'NOTES', x: cols[5] },
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
      // Budget the note against the GPS suffix rather than clamping it in
      // isolation. Clamped to a flat MAX_NOTE_CHARS and THEN having ~25
      // characters of coordinates appended, every row overflowed to an extra
      // line -- and half of live attempts carry GPS, so a three-attempt job
      // with coordinates printed on TWO sheets of PJ-700 roll. The second
      // sheet is the one that gets lost at the door.
      // When coordinates are present the whole cell is budgeted DOWN, not just
      // rebalanced: the coordinate token cannot break, so it forces an early
      // wrap and costs a full extra line per row no matter how the characters
      // are divided. Half of live attempts carry GPS, so this is the common
      // case, not the edge one.
      const gpsSuffix = gps ? ` · GPS ${gps}` : '';
      const cellBudget = gps ? GPS_ROW_NOTE_CHARS : MAX_NOTE_CHARS;
      const noteBudget = Math.max(12, cellBudget - gpsSuffix.length);
      const noteCore = note
        ? (note.length > noteBudget ? `${note.slice(0, Math.max(1, noteBudget - 1))}…` : note).toUpperCase()
        : '';
      const noteCell = `${noteCore}${gpsSuffix}` || EMPTY;
      return [
        String(a.number),
        (sanitizePdfText(a.date || '').toUpperCase() || EMPTY),
        (withZone(sanitizePdfText(a.time || '').toUpperCase()) || EMPTY),
        (attemptWindow(a.time || '') || EMPTY),
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
    // The standalone "GPS coordinates recorded on-scene for legal
    // verification (WGS-84, decimal degrees)" footnote is gone. It was
    // boilerplate explaining a format that is self-evident from the values,
    // it cost 5mm on an instrument that must fit ONE sheet, and the
    // coordinates themselves -- the substantive fact -- are unchanged in the
    // rows above.
    void anyGps;
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
  // 38 mm reservation covers lead-band + body + next-attempt + spacing at
  // 7 pt prose. Break BEFORE opening the section so the IMPORTANT NOTICE
  // header isn't orphaned at the bottom of one page with content on the next.
  y = checkPageBreak(doc, y, 38);
  {
    const sec = openAutoSection(doc, 'III. Important Notice — Attempted Service of Legal Documents', y);
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
    // Rail-aligned (see status band above) — was inset 1mm on both sides.
    doc.setFillColor(240, 240, 240);
    doc.rect(getRailX(), bandY, getRailWidth(doc), bandH, 'F');
    doc.setFont(PDF_VALUE_FONT, 'bold');
    doc.setFontSize(FONT.SIZE_FIELD_VALUE + 2);
    doc.setTextColor(...COLOR.TEXT_PRIMARY);
    const lead = 'THIS IS NOT A COURT ORDER, A SUMMONS, OR A DEMAND FOR PAYMENT.';
    // Center vertically inside the band: top + (band/2) + (cap-height/2).
    doc.text(lead, pageWidth / 2, bandY + bandH / 2 + 1.8, { align: 'center' });
    // Clearance after the band must clear the body paragraph's OWN ascender
    // height, not just separate the two baselines. addWrappedText's y is the
    // first line's baseline, so a bare SPACING.SM (0.5mm) gap put that
    // baseline only 0.5mm below the band's bottom edge — the 7pt body font's
    // ~2.5mm cap height then reached back UP into the gray fill, rendering
    // "Rocky Mountain Protective Group..." partially on top of the band's
    // last few pixels. 3mm clears the ascender with a hair of daylight left.
    y = bandY + bandH + 3.0;

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
      // Reformatted from an inline accent-barred sentence into a boxed
      // call-out: the label sits on its own line, bold caps, with the note
      // wrapped underneath inside a bordered box. This is the single most
      // ACTIONABLE line on the page — when the server is coming back — so it
      // gets the same boxed treatment as the SERVICE NOT COMPLETED status
      // band above, instead of reading as a footnote hanging off the
      // disclaimer prose.
      // Box drawn on the RAIL (getRailX/getRailWidth), matching the status
      // band, the disclaimer band above, and every other full-bleed block on
      // the page — not lx/ffw, which is inset 1mm on both sides.
      const boxX = getRailX();
      const boxW = getRailWidth(doc);
      const padX = SPACING.MD;
      const padY = 2.0;
      const lineH = 3.4;
      // "NEXT ATTEMPT" header strip sits in a mini-header bar — same visual
      // language as every section bar on the page so this call-out reads as
      // a structured element, not a floating label.
      const headerH = SPACING.SECTION_HEADER_H;
      doc.setFont(PDF_VALUE_FONT, 'bold');
      doc.setFontSize(NOTICE_FONT);
      const noteLines: string[] = doc.splitTextToSize(
        sanitizePdfText(data.nextAttemptNote, { preserveCase: true }),
        boxW - padX * 2,
      );
      const boxH = headerH + padY + noteLines.length * lineH + padY;
      y = checkPageBreak(doc, y, boxH + SPACING.SM);

      // Outer border
      doc.setDrawColor(...COLOR.TEXT_PRIMARY);
      doc.setLineWidth(BORDER.SECTION_OUTER);
      doc.rect(boxX, y, boxW, boxH);

      // Header strip — same accent as the subject panels' "routine" tier
      const naAccent = resolveSectionAccentColor('routine');
      doc.setFillColor(naAccent[0], naAccent[1], naAccent[2]);
      doc.rect(boxX, y, boxW, headerH, 'F');
      doc.setFont(PDF_VALUE_FONT, 'bold');
      doc.setFontSize(FONT.SIZE_FIELD_LABEL);
      doc.setTextColor(255, 255, 255);
      doc.text('NEXT ATTEMPT', boxX + padX, y + headerH - 1.4);

      const cy = y + headerH + padY + lineH * 0.7;
      doc.setFont(PDF_VALUE_FONT, 'italic');
      doc.setFontSize(NOTICE_FONT);
      doc.setTextColor(...COLOR.TEXT_SECONDARY);
      doc.text(noteLines, boxX + padX, cy);
      doc.setTextColor(...COLOR.TEXT_PRIMARY);

      y += boxH + SPACING.SM;
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
  y = checkPageBreak(doc, y, 22);
  {
    const sec = openAutoSection(doc, 'IV. What To Do Next', y);
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
  //
  // Reserve the certification line WITH the block: a signature that lands on
  // its own sheet, separated from the sentence it certifies, is worse than no
  // signature at all on a roll-printed instrument.
  //
  // Reserve the height ACTUALLY drawn, not the SIGNATURE_BOX_H default. That
  // constant is 24mm, sized for the 12/8 rows a desk-printed affidavit uses;
  // this block draws 4.5 role + 9 signature + 7 info = 20.5mm. Reserving the
  // default forced a page break the real content did not need -- the content
  // fit with room to spare and still landed on sheet two.
  //
  // 14mm gives a wet-signature line with room to write; 9mm was too tight
  // for a real pen signature on a PJ-700 thermal print.
  const SIG_ROW_H = 14;
  const SIG_INFO_H = 6;
  const sigBlockH = SPACING.SIGNATURE_ROLE_H + SIG_ROW_H + SIG_INFO_H;
  y = checkPageBreak(doc, y, sigBlockH + SPACING.LG);

  // Certification is worded against the ATTEMPT RECORD, not against service:
  // this instrument exists precisely because service did NOT occur, so an
  // affidavit-style "I certify service" line would be false on its face. It
  // deliberately does not restate the server's name or badge either -- both
  // print in the info row immediately below it.
  const certification = 'I certify that the attempt(s) recorded in Article II were made as stated, and that service was not completed.';

  y = addSignatureBlock(doc, 'V. Process Server', getRailX(), y, getRailWidth(doc), data.signature ? {
    signatureImage: data.signature,
    printedName: data.serverName,
    badgeNumber: data.serverBadge,
    certification,
  } : {
    printedName: data.serverName,
    badgeNumber: data.serverBadge,
    certification,
  },
  // Signature row trimmed from the 12mm default to 9mm. The default is
  // sized for a wet signature on a full desk-printed affidavit; on this
  // notice the row is mostly white, and the millimetres buy the
  // certification sentence above it without touching any content. Still
  // ample for the captured signature image, which fits to sigRowH - 3.5.
  // Info row trimmed alongside it: three short values, one line each.
  SIG_ROW_H, SIG_INFO_H);
  y += SPACING.SM;

  // ── Contact line (recipient-facing call-to-action) ──
  // Centered bold line immediately after the signature so the person at
  // the door can call without looking up the agency number.
  if (data.serverPhone) {
    y = checkPageBreak(doc, y, 6);
    const pageWidth = doc.internal.pageSize.getWidth();
    doc.setFont(PDF_VALUE_FONT, 'bold');
    doc.setFontSize(FONT.SIZE_FIELD_VALUE + 1);
    doc.setTextColor(...COLOR.TEXT_PRIMARY);
    const company = data.serverCompany || 'Rocky Mountain Protective Group';
    doc.text(`To arrange delivery, contact ${company}: ${data.serverPhone}`,
      pageWidth / 2, y + 2.5, { align: 'center' });
    y += 6;
  }
  y += SPACING.XS;

  // ── Footer legal text ──
  // Bumped from FONT.SIZE_FOOTER_SECONDARY (5pt) to 6.5pt and given a thin
  // rule above it — at 5pt this citation read as a stray caption rather
  // than the statutory authority line it is. Sentence case retained
  // throughout (only the proper nouns/section symbol are capitalized) so it
  // reads as a legal citation, not a shouted disclaimer.
  y = checkPageBreak(doc, y, 7);
  const footerCiteWidth = doc.internal.pageSize.getWidth();
  // Rule spans the RAIL (getRailX/getRailWidth), matching every other
  // full-bleed rule on the page — was lx/ffw, inset 1mm on both sides.
  doc.setDrawColor(...COLOR.RULE_STRONG);
  doc.setLineWidth(BORDER.TABLE_OUTER);
  doc.line(getRailX(), y - 2, getRailX() + getRailWidth(doc), y - 2);
  doc.setFont(PDF_VALUE_FONT, 'italic');
  doc.setFontSize(FONT.SIZE_FOOTER_SECONDARY + 1.5);
  doc.setTextColor(...COLOR.TEXT_SECONDARY);
  doc.text(
    'Process service pursuant to Utah R. Civ. P. 4 and Utah Code § 78B-8-302 (registered private process server).',
    footerCiteWidth / 2, y + 1.5, { align: 'center' },
  );
  doc.setTextColor(...COLOR.TEXT_PRIMARY);

  // ── Subject-facing QR code ──
  try {
    const verifyUrl = `https://rmpgutah.us/verify?ref=${encodeURIComponent(headerRef)}`;
    const qrDataUrl = await QRCode.toDataURL(verifyUrl, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 200,
    });
    const QR_SIZE = 22;
    const qrX = getRailX();
    const pageH = doc.internal.pageSize.getHeight();
    // addPageFooter places the accent line at pageH - 11 (SAFE_PRINT_EDGE_BOTTOM=8, offset=3).
    // Keep the "Scan to verify" label (3.5mm) + 2mm gap entirely above that line.
    const FOOTER_ACCENT_Y = pageH - 11;
    const QR_LABEL_H = 3.5;
    const qrY = FOOTER_ACCENT_Y - 2 - QR_LABEL_H - QR_SIZE;
    doc.addImage(qrDataUrl, 'PNG', qrX, qrY, QR_SIZE, QR_SIZE);
    doc.setFont(PDF_VALUE_FONT, 'normal');
    doc.setFontSize(FONT.SIZE_SIGNATURE_LABEL);
    doc.setTextColor(...COLOR.TEXT_TERTIARY);
    doc.text('Scan to verify', qrX + QR_SIZE / 2, qrY + QR_SIZE + 2.5, { align: 'center' });
    doc.setTextColor(...COLOR.TEXT_PRIMARY);
  } catch {
    // best-effort
  }

  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    addPageFooter(doc, i, totalPages, 'serve_notice_of_attempt');
    // Watermark intentionally omitted on the Notice of Attempt — it's
    // recipient-facing, and the diagonal CONFIDENTIAL caused strikethrough
    // appearance on the disclaimer paragraph's first line.
  }

  tightLayout = false;

  finalizePoliceReport(doc, {
    barcode: { disabled: true },
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
  y = checkPageBreak(doc, y, 22);
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
    y = checkPageBreak(doc, y, 18);
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

  tightLayout = false;

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
export interface ReceiptPhoto {
  /** base64 data URI, already downscaled by the caller. */
  image: string;
  /** ISO instant the frame was captured. Printed beneath the photograph. */
  capturedAt?: string;
  /** Short caption — "Front door", "Street view". */
  label?: string;
}

export type ReceiptCopy = 'company' | 'subject' | 'client';

export const RECEIPT_COPY_LABEL: Record<ReceiptCopy, string> = {
  company: 'Company Record',
  subject: 'Subject Copy',
  client: 'Client Copy',
};

/** Print order. The agency keeps the first sheet off the printer. */
export const RECEIPT_COPY_ORDER: ReceiptCopy[] = ['company', 'subject', 'client'];

/**
 * Check character for the scan-to-retrieve barcode. Mirrors
 * receiptBarcodeCheck in src/routes/serveReceipt.ts — the worker resolves
 * what this encodes, so the two must agree exactly.
 */
export function receiptBarcodeCheck(receiptId: number): string {
  const sum = String(receiptId).split('').reduce((n, d, i) => n + Number(d) * (i + 2), 0);
  return (sum % 36).toString(36).toUpperCase();
}

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

  // ── Recipient ID data (from barcode scan or manual entry) ──
  recipientGender?: string;
  recipientRace?: string;
  recipientHeight?: string;
  recipientWeight?: string;
  recipientHairColor?: string;
  recipientEyeColor?: string;
  recipientDlNumber?: string;
  recipientDlState?: string;
  recipientDlClass?: string;
  recipientDlExpiry?: string;
  recipientIsRealId?: boolean | null;
  idScanMethod?: 'barcode' | 'manual' | null;

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
   * service turns on.
   *
   * Each carries WHEN it was taken, because an undated photograph proves
   * far less than a dated one: without a timestamp it shows a door, not
   * that door at the moment of service, and opposing counsel gets to ask
   * when it was really taken. A plain string[] is still accepted for
   * callers that genuinely have no metadata.
   */
  photos?: Array<string | ReceiptPhoto>;

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
  const brandingBefore = getActiveBranding();
  try {
    return await renderReceiptOfService(data);
  } finally {
    setConfidentialWatermarkEnabled(true);
    // All three are module state shared with every other generator in the
    // bundle. Restoring the branding matters as much as the watermark:
    // leaving a section accent set would re-shade the next report the
    // user prints.
    setActiveBranding(brandingBefore);
    // tightLayout belongs here too. renderReceiptOfService sets it true and
    // clears it on its LAST line, with no try/finally in between — so any
    // throw partway through a ~470-line render left the flag stuck on for
    // the rest of the session, and every later PDF came out compressed.
    // The four sibling generators each defensively reset it on entry, which
    // is the tell that the leak was already known and patched per-caller;
    // that only ever covered those four, not anything added later.
    tightLayout = false;
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
function drawCourtHeading(
  doc: jsPDF, y: number, courtName: string, jurisdiction: string,
  copy: ReceiptCopy | null = null,
): number {
  const cx = doc.internal.pageSize.getWidth() / 2;
  const lx = getLeftX();
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

  // Copy designation rides the dead space beside the CENTRED court name.
  // It had its own band, which cost 6mm; before that it was boxed on the
  // instrument title's baseline, where a 4.2mm rectangle crossed a line
  // the NOTICE paragraph's ascenders reach into. Here it collides with
  // nothing and costs nothing.
  if (copy) {
    doc.setFont(PDF_VALUE_FONT, 'bold');
    doc.setFontSize(FONT.SIZE_FIELD_LABEL + 0.5);
    const label = RECEIPT_COPY_LABEL[copy].toUpperCase();
    const w = doc.getTextWidth(label) + 6;
    doc.setFillColor(...COLOR.RULE_STRONG);
    doc.rect(lx + cw - w, y - 5.4, w, 5, 'F');
    doc.setTextColor(255, 255, 255);
    doc.text(label, lx + cw - w + 3, y - 1.9);
  }

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
  doc.text('Plaintiff / Petitioner,', parenX - 3, ly + 0.8, { align: 'right' }); ly += lineH + 0.8;

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
  doc.text('Defendant / Respondent.', parenX - 3, ly + 0.8, { align: 'right' });

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
function drawInstrumentTitle(doc: jsPDF, y: number, title: string): number {
  const cx = doc.internal.pageSize.getWidth() / 2;

  // Filled gray banner instead of a double-ruled black-on-white line — this
  // matches the same gray header-bar language every numbered section (II,
  // III, IV, V) uses via openAutoSection/addSignatureBlock, so the
  // instrument title reads as the first header in that family rather than
  // a differently-styled caption sitting above it.
  //
  // Drawn on the RAIL (getRailX/getRailWidth) — those section header bars
  // are drawn at LAYOUT.PAGE_MARGIN across getContentWidth. This bar
  // previously used getLeftX() (PAGE_MARGIN + CONTENT_INSET) as its left
  // edge but the FULL getContentWidth() as its span, so it started 1mm
  // right of every header/panel/signature block below it and then
  // overshot the right rail by that same 1mm — the exact "sized from
  // getContentWidth but drawn from getLeftX" bug pdfTokens.ts warns about.
  const barH = SPACING.SECTION_HEADER_H + 0.5;
  y = checkPageBreak(doc, y, barH + SPACING.SM);

  const titleAccentRgb = resolveSectionAccentColor(title);
  doc.setFillColor(titleAccentRgb[0], titleAccentRgb[1], titleAccentRgb[2]);
  doc.rect(getRailX(), y, getRailWidth(doc), barH, 'F');

  doc.setFont('Arial', 'bold');
  doc.setFontSize(FONT.SIZE_SECTION_TITLE + 1);
  doc.setTextColor(...COLOR.TEXT_INVERTED);
  const capH = (FONT.SIZE_SECTION_TITLE + 1) * 0.35;
  doc.text(sanitizePdfText(title.toUpperCase()), cx, y + (barH + capH) / 2, { align: 'center' });

  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  return y + barH + (tightLayout ? SPACING.XS : SPACING.SM);
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
/** Set for the life of one render when the page is under fit pressure. */
let tightLayout = false;

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
  const pad = tightLayout ? 1.3 : 1.6;
  const rowH = tightLayout ? 2.6 : 2.9;
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
  // 0.38 gives values ~4% more space than 0.42 — enough to prevent a
  // long street address ("…STREET, SALT LAKE CITY, UT…") from splitting
  // mid-city-name. Labels are short fixed strings (≤ 20 chars at 5.5pt)
  // and fit comfortably at this ratio.
  const labelW = w * 0.38;
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

  // Slack handling: the two panels are drawn to a COMMON height, and the
  // shorter one has to spend the difference somewhere.
  //
  // Centring the whole body (the previous approach) kept the panel from
  // showing orphan white at the bottom, but it pushed the shorter panel's
  // label/value grid DOWN by slack/2 -- so I(a)'s SERVICE ADDRESS row no
  // longer sat on the same line as I(b)'s CASE NUMBER row. On a pair of
  // panels read side by side that misalignment is the thing the eye catches.
  //
  // Instead: keep the body TOP-aligned so both grids start on the same
  // baseline, and spend the slack as extra leading BETWEEN the shorter
  // panel's rows. Both panels now start level, bottom out level, and no
  // orphan block of white is left under either.
  const naturalH = SPACING.SECTION_HEADER_H + bodyH;
  const slack = Math.max(0, boxH - naturalH);
  const rowGapExtra = wrapped.length > 1 ? slack / (wrapped.length - 1) : 0;
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
  wrapped.forEach((r, ri) => {
    if (ri > 0) ty += rowGapExtra;   // spend the common-height slack here
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
  });

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
  // One shade for every article bar.
  //
  // resolveSectionAccentColor grades a header by KEYWORD — a heuristic
  // written for incident reports, where "SUBJECT" and "PERSON" genuinely
  // signal a more important block. Here the articles are peers, and those
  // words appear in Article I and Article IV by pure coincidence of legal
  // phrasing. The result was bars alternating dark, light, light, dark
  // down the page, implying an emphasis nobody intended.
  //
  // The documented branding override is the seam for exactly this. Set
  // for the life of this document and restored by the caller's finally.
  setActiveBranding({ ...branding, section_accent_color: '#5a5a5a' });
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
  // ── Fit tier, decided before anything is drawn ──
  //
  // Three independent things inflate this instrument, and the first
  // version of this only knew about one of them:
  //
  //   a wrapping caption   — a multi-entity defendant
  //   declined statements  — each adds a struck line plus an annotation
  //   photographs          — the largest single block on the page
  //
  // Photographs previously DISABLED density, which was backwards: the
  // page that most needs compressing was the one that got none.
  //
  // Tiers rather than a boolean, because the three can stack. `tight`
  // exists for the case where dense alone still overflows, and shrinks
  // things that cost legibility — so it is entered only when the
  // alternative is a second sheet, which costs more.
  const declH0 = measureDeclarations(doc, data.attestations, ffw, blank);
  const declinedCount = blank ? 0 : data.attestations.filter((a) => !a.accepted).length;
  const photoCount = data.photos?.length ?? 0;
  const pressure =
    (captionWraps(doc, data.defendantName || '') ? 1 : 0)
    + (declH0 > DENSE_THRESHOLD_MM ? 1 : 0)
    + (declinedCount > 0 ? 1 : 0)
    + (photoCount > 0 ? 2 : 0);   // photographs weigh double — ~40mm
  // ONE spacing scheme, for every variation and every copy.
  //
  // This began as tiers — normal, dense, tight — which meant the same
  // service printed at different densities depending on how long the
  // defendant's name happened to be. Two copies of one instrument then
  // looked like two different documents, and every content change landed
  // the whole set back on a knife edge measured in tenths of a
  // millimetre.
  //
  // The compressed spacing is now simply the design: it is what the
  // operator reviewed and accepted, it leaves every ordinary form real
  // headroom rather than 0.1mm, and it means a co-habitant service and a
  // four-entity business service are recognisably the same form.
  //
  // `pressure` survives for the one thing that genuinely must adapt:
  // photographs, which are laid three-across when the page is loaded and
  // two-across when it is not.
  const tight = pressure >= 1;
  const gap = (normal: number) => normal * 0.3;
  // Module-scoped for the panel helper, which cannot take another
  // parameter without threading it through two call sites for nothing.
  // The reset on the last line of this function is the HAPPY-PATH clear
  // only — it is not unconditional, despite how it reads. The guarantee
  // lives in generateReceiptOfService's finally, which is this function's
  // sole caller; do not rely on the tail assignment alone.
  tightLayout = true;

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
  y = drawCourtHeading(doc, y, data.courtName, data.jurisdiction,
    blank ? null : (data.copy ?? null));
  y = drawPleadingCaption(doc, y, {
    plaintiff: data.plaintiffName,
    defendant: data.defendantName,
    caseNumber: data.caseNumber,
    instrumentTitle: data.formTitle,
  });
  y = drawInstrumentTitle(doc, y, data.formTitle);


  // ── Notice to the person served ──
  // The one paragraph a signer must read before anything is asked of
  // them, in the identical wording used on the signing screen.
  // The NOTICE's baseline needs to clear its own ascenders below the
  // title rule, not merely sit a gap below it. Compressing this to a
  // fraction of a line put the rule through the top of the text.
  y = checkPageBreak(doc, y, 14);
  y += FONT.SIZE_FIELD_VALUE * 0.42 + gap(SPACING.MD);
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
        ...(data.gps
          ? [{ label: 'Geolocation', value: `${data.gps.lat.toFixed(5)}, ${data.gps.lng.toFixed(5)}` }]
          : []),
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
        { label: 'Accepted', value: withZone(`${signedDate} ${signedTime}`), blank },
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
    } else {
      // One row, and it keeps the column semantics an earlier change
      // established: the LEFT column is the moment of delivery, the RIGHT
      // column is who performed it. Badge now sits WITH the server it
      // identifies rather than beneath the date, and the geolocation has
      // moved to panel I(a) beside the place it corroborates — so neither
      // column mixes two unrelated facts.
      //
      // Geolocation is stated here only when there is NONE to show,
      // because its absence is itself worth recording.
      const a = addFieldPair(doc, '1. Date and Time of Delivery', `${signedDate} at ${signedTime}`, lx, y, hfw);
      const b = addFieldPair(doc, '2. Process Server / Badge',
        [data.serverName, data.serverBadge].filter(Boolean).join('  ·  '), rx, y, hfw);
      y = Math.max(a, b);
      if (!data.gps) {
        y = addFieldPair(doc, '3. Geolocation at Signature', 'Not available', lx, y, ffw);
      }
    }
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Article III — schedule of documents ──
  // Itemized as a table rather than a sentence: a dispute over service
  // is almost always a dispute over WHICH papers changed hands, and a
  // row-per-document with a copy count is what answers that.
  y = checkPageBreak(doc, y, 26);
  {
    // COPIES held 18% of the width for a single digit, leaving it stranded
    // far from the title it counts. Tightened so the document title -- the
    // field a service dispute actually turns on -- gets the room instead.
    const cols = getProportionalColumns(doc, [0.09, 0.79, 0.12]);
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
    doc.text('III. SCHEDULE OF DOCUMENTS DELIVERED', lx + 1.5, y + SPACING.SECTION_HEADER_H - 1.2);

    // Totals, right-aligned in the same bar. The per-row copy count answers
    // WHICH papers changed hands; this answers HOW MANY -- the other half of
    // the same dispute, and the half a reader would otherwise add up by hand.
    const docCount = rows.length;
    const copyCount = rows.reduce((n, r) => n + (parseInt(r[2], 10) || 0), 0);
    const totalLabel = `${docCount} DOCUMENT${docCount === 1 ? '' : 'S'}`
      + ` · ${copyCount} COP${copyCount === 1 ? 'Y' : 'IES'}`;
    doc.setFontSize(FONT.SIZE_FIELD_LABEL);
    doc.text(totalLabel, lx + cw - 1.5, y + SPACING.SECTION_HEADER_H - 1.2, { align: 'right' });

    doc.setTextColor(...COLOR.TEXT_PRIMARY);
    y += SPACING.SECTION_HEADER_H;

    y = addTableWithShading(
      doc,
      [{ label: 'No.', x: cols[0] }, { label: 'Document Delivered', x: cols[1] }, { label: 'Copies', x: cols[2] }],
      rows, y, cols,
      { sectionTitle: 'III. Schedule of Documents Delivered' },
    );

  }

  // ── Recipient Identification ──
  // Printed when the officer scanned or manually recorded the signer's ID.
  // The section is omitted entirely when no ID data was captured — a blank
  // section reading "N/A" on every line adds nothing and costs vertical space
  // on an instrument that must fit one sheet.
  const hasIdData = !blank && (data.recipientDlNumber || data.recipientGender || data.recipientHeight || data.idScanMethod);
  if (hasIdData) {
    y = checkPageBreak(doc, y, 18);
    const sec = openAutoSection(doc, 'Recipient Identification', y); y = sec.contentY;

    // Verification method
    if (data.idScanMethod) {
      const methodLabel = data.idScanMethod === 'barcode' ? 'Barcode scanned from ID' : 'Manually entered';
      y = addFieldPair(doc, 'ID Verification Method', methodLabel, lx, y, ffw);
    }

    // DL / ID number + issuing state
    if (data.recipientDlNumber || data.recipientDlState) {
      const dlA = addFieldPair(doc, 'DL / ID Number', data.recipientDlNumber || 'N/A', lx, y, hfw);
      const dlB = addFieldPair(doc, 'Issuing State', data.recipientDlState || 'N/A', rx, y, hfw);
      y = Math.max(dlA, dlB);
    }

    // DL class + expiry
    if (data.recipientDlClass || data.recipientDlExpiry) {
      const clA = addFieldPair(doc, 'DL Class', data.recipientDlClass || 'N/A', lx, y, hfw);
      const clB = addFieldPair(doc, 'DL Expiry', data.recipientDlExpiry || 'N/A', rx, y, hfw);
      y = Math.max(clA, clB);
    }

    // REAL ID status
    if (data.recipientIsRealId != null) {
      y = addFieldPair(doc, 'REAL ID', data.recipientIsRealId ? 'Yes' : 'No', lx, y, hfw);
    }

    // Physical description — single line summary
    const descParts = [
      data.recipientGender,
      data.recipientRace,
      data.recipientHeight,
      data.recipientWeight ? `${data.recipientWeight} lbs` : undefined,
      data.recipientHairColor ? `${data.recipientHairColor} hair` : undefined,
      data.recipientEyeColor ? `${data.recipientEyeColor} eyes` : undefined,
    ].filter(Boolean);
    if (descParts.length > 0) {
      y = addFieldPair(doc, 'Physical Description', descParts.join(', '), lx, y, ffw);
    }

    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
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
  const footnoteH = isIndividual ? 0 : 3 * (FONT.SIZE_SMALL_META * 0.42) + SPACING.LG;
  // The hand-off badge is part of the layout, not an overlay. Placing it
  // absolutely at the page foot worked while blank forms were short and
  // silently printed ON the signature block once they filled the sheet.
  const handoffH = blank && data.qrDataUrl ? 7 : 0;
  const executionH = (SPACING.XL + SPACING.MD) + declLineH + SPACING.LG
    + (SPACING.SIGNATURE_BOX_H - 3)
    + SPACING.XL + footnoteH + handoffH + 3;
  // Dense only: reserve the TAIL, not the whole block.
  //
  // Reserving every declaration plus the signature moves all of Article IV
  // together — correct when it fits, and the reason page one sat 40% empty
  // when it does not. Keeping just the last statements with the signature
  // is the ordinary answer to a widow. Scoped to dense because an earlier
  // attempt applied it everywhere and regressed all four standard
  // variations; here the only cases affected are ones already spilling.
  // Reserve the TAIL, not the whole block. Reserving every declaration
  // plus the signature moves all of Article IV together, which leaves a
  // page two-thirds empty when it does not fit. Keeping just the last
  // statements with the signature is the ordinary answer to a widow.
  const tailH = data.attestations.slice(-2).reduce((n, a) => n + declH(a), 0);
  y = checkPageBreak(doc, y, Math.min(declBlockH, 34) + tailH + executionH);

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
      if (i === data.attestations.length - 2) {
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
    // Three across when the page is under pressure, two otherwise. A
    // door number stays legible at either size; a second sheet does not
    // become less annoying.
    const across = tight ? 3 : 2;
    const gapX = 3;
    const capH = 2.6;   // caption strip under each frame
    const w = (ffw - gapX * (across - 1)) / across;
    const h = w * (tight ? 0.58 : 0.62);
    let px = lx;
    for (let i = 0; i < Math.min(data.photos.length, across); i++) {
      if (i > 0 && i % across === 0) { y += h + capH + gapX; px = lx; }
      const entry = data.photos[i];
      const photo: ReceiptPhoto = typeof entry === 'string' ? { image: entry } : entry;
      try {
        doc.addImage(photo.image, 'JPEG', px, y, w, h);
        doc.setDrawColor(...COLOR.BORDER_FIELD);
        doc.setLineWidth(BORDER.IMAGE_FRAME);
        doc.rect(px, y, w, h);
      } catch { /* a corrupt frame must never cost the instrument */ }

      // Caption beneath, not overlaid: a timestamp burned into the image
      // is unreadable against a dark doorway and cannot be selected or
      // searched in the filed PDF.
      const when = photo.capturedAt ? receiptDateParts(photo.capturedAt) : null;
      const caption = [photo.label, when && `${when.date} ${when.time}`]
        .filter(Boolean).join(' — ');
      if (caption) {
        doc.setFont(PDF_VALUE_FONT, 'normal');
        doc.setFontSize(FONT.SIZE_SMALL_META - 0.5);
        doc.setTextColor(...COLOR.TEXT_TERTIARY);
        doc.text(fitPdfText(doc, sanitizePdfText(caption), w), px, y + h + 2);
        doc.setTextColor(...COLOR.TEXT_PRIMARY);
      }
      px += w + gapX;
    }
    y += h + capH + SPACING.MD;
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Article V — execution ──
  // closeAutoSection() draws its gold closing rule AT the y it returns,
  // so a single base unit of clearance put this baseline through it and
  // the clause rendered struck out. Clear the rule, then breathe.
  //
  // Deliberately NOT a perjury declaration — see the note on
  // ReceiptOfServiceData.
  // closeAutoSection draws its rule AT the y it returns. The execution
  // clause needs a full line below it, not a compressed fraction — at
  // tight spacing the rule sat on the clause's ascenders.
  y += SPACING.XL;
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
      + `on ${withZone(`${signedDate} at ${signedTime}`)}.`,
      lx, y, ffw, FONT.SIZE_FIELD_VALUE, { preserveCase: true });
  }
  y += SPACING.MD;

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
      date: blank ? '' : withZone(`${signedDate} ${signedTime}`),
    },
  );

  y += SPACING.LG;

  // Authority note, set as a genuine footnote BELOW the signature. It
  // explains the rule the variation rests on; it is not something the
  // signer attests to, so keeping it inside Article IV both misread as
  // a declaration and made the must-stay-together block taller.
  const badge = blank && data.qrDataUrl ? 11 : 0;
  const footnoteTop = y;
  if (!isIndividual) {
    // 6pt, not 5. This is the authority the whole variation rests on, and
    // at footer size it was the least legible text on a document people
    // read in a hallway. It was also colliding with the instrument line
    // below it, because neither reserved space for the other.
    doc.setFont(PDF_VALUE_FONT, 'normal');
    doc.setTextColor(...COLOR.TEXT_TERTIARY);
    y = addWrappedText(doc,
      'Service upon a person other than the party named is permitted under Rule 4(d)(1) of '
      + 'the Utah Rules of Civil Procedure where the documents are left with a person of '
      + 'suitable age and discretion residing at the dwelling, or with an agent authorized '
      + 'to receive service at a place of business.',
      lx, y, ffw - (badge ? badge + 34 : 0), FONT.SIZE_SMALL_META, { preserveCase: true });
    y += SPACING.LG;
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

  tightLayout = false;

  finalizePoliceReport(doc, {
    barcode: {
      // Scan-to-retrieve. A filed paper copy is otherwise a dead end: a
      // clerk holding it has a case number and a name and no way back to
      // the signed record, the GPS, or the attestation wording. The
      // instrument number is what makes the paper a pointer.
      //
      // Only on a SIGNED instrument. A blank has no record to retrieve,
      // and a barcode resolving to nothing is worse than none at all.
      // Check character appended. `RMPG-AOS:4471` has no redundancy, so a
      // single misread digit resolves to a DIFFERENT REAL RECEIPT and the
      // clerk has no way to know. Mod-36 over the digits turns a silent
      // wrong answer into a refusal to resolve — the only acceptable
      // failure mode when the thing being looked up is a legal record.
      ...(blank || !data.receiptId
        ? {}
        : { value: `RMPG-AOS:${data.receiptId}-${receiptBarcodeCheck(data.receiptId)}` }),
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

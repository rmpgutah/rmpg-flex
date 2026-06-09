// ============================================================
// RMPG Flex — PSO Notice of Communication
//
// A RESPONDENT-FACING notice generated when a process-service /
// client-request attempt could not be completed. It is left at the
// door or handed to an occupant, so it is addressed TO the person
// being served (the respondent) — not to the contracting client.
// It tells the respondent that delivery of legal documents was
// attempted at their address, what was being delivered, when the
// attempt(s) occurred, and how to contact RMPG to arrange receipt.
//
// Internal dispatch details (billing codes, authorizations, client
// contact blocks, re-dispatch call numbers, attempt notes) are
// deliberately NOT printed — the contracting client appears only as
// a one-line "requested by" reference. For the sworn/affidavit serve
// documents use servePdfGenerator.ts (generateNoticeOfAttempt).
// Reuses the shared pdfGenerator.ts + pdfTokens.ts helpers like the
// rest of the suite.
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
  sanitizePdfText,
  finalizePoliceReport,
} from './pdfGenerator';
import {
  SPACING, FONT, COLOR,
  PDF_VALUE_FONT,
  getFullFieldWidth, getLeftX, getRightColumnX, getHalfFieldWidth,
  getProportionalColumns,
} from './pdfTokens';
import { drawNibrsHeader } from './pdfFormHelpers';

export interface NoticeOfCommunicationAttempt {
  number: number;
  date: string;
  time: string;
  /** Disposition / outcome of the attempt (e.g. "No Contact", "No Access"). */
  result: string;
  /** Internal attempt notes — kept in the payload but NOT printed on the respondent copy. */
  notes: string;
}

export interface NoticeOfCommunicationData {
  noticeDate: string;
  /** Originating CFS call number — printed as the RMPG reference number. */
  callNumber: string;
  /** Person being served (recipient/defendant). Falls back to occupant wording. */
  respondentName?: string;
  /** Court case number of the underlying legal matter, if known. */
  courtCaseNumber?: string;
  /** Issuing court of the underlying legal matter, if known. */
  courtName?: string;
  /** Contracting client / requestor — one-line reference only, not the addressee. */
  clientName: string;
  /** Contact person at the contracting client. Retained for compatibility — not printed. */
  clientContact?: string;
  /** Retained for compatibility — not printed on the respondent copy. */
  clientAddress?: string;
  /** Retained for compatibility — not printed on the respondent copy. */
  clientPhone?: string;
  /** What is being delivered (e.g. "Summons Service", "Subpoena Service"). */
  serviceType: string;
  /** The respondent's address — where delivery was attempted. */
  serviceAddress: string;
  /** Retained for compatibility — not printed on the respondent copy. */
  requestedWindow?: string;
  /** Retained for compatibility — internal, not printed on the respondent copy. */
  authorization?: string;
  /** Retained for compatibility — internal, not printed on the respondent copy. */
  billingCode?: string;
  /** One row per delivery attempt. */
  attempts: NoticeOfCommunicationAttempt[];
  /** Retained for compatibility — internal, not printed on the respondent copy. */
  redispatchCallNumber?: string;
  /** Scheduled next attempt window — printed so the respondent knows what to expect. */
  nextWindow?: string;
  officerName: string;
  officerBadge: string;
  officerPhone?: string;
  dispatchPhone?: string;
  signature?: string;
}

/** Human label for a PSO attempt disposition code/value. */
export function psoResultLabel(result: string): string {
  switch ((result || '').trim().toLowerCase()) {
    case 'no_contact':
    case 'no_answer':
    case 'negative contact': return 'No contact at location';
    case 'no_access':
    case 'ps no access': return 'Unable to access premises';
    case 'refused': return 'Access / service refused';
    case 'wrong_address': return 'Incorrect / bad address';
    case 'gtn':
    case 'gone_on_arrival': return 'Subject/condition gone on arrival';
    case 'unable_to_locate':
    case 'utl': return 'Unable to locate';
    case 'cancelled': return 'Cancelled by client';
    case 'completed': return 'Completed';
    // Process-service dispositions stored verbatim on the call ("PS Served",
    // "PS Non-Service", "PS Unknown", "PS Attempted") — map to readable
    // text instead of surfacing the raw code.
    case 'ps served':
    case 'served': return 'Served / completed';
    case 'ps sub-served':
    case 'ps sub served':
    case 'sub_served': return 'Delivered to co-resident / agent';
    case 'ps non-service':
    case 'ps non service':
    case 'non-service': return 'Unable to complete service';
    case 'ps attempted':
    case 'attempted': return 'Attempted — not completed';
    case 'ps unknown':
    case 'unknown': return 'Outcome pending';
    case 'other': return 'Other (see notes)';
    default: return result ? sanitizePdfText(result).replace(/_/g, ' ') : 'Service not completed';
  }
}

export async function generateNoticeOfCommunication(data: NoticeOfCommunicationData): Promise<jsPDF> {
  const branding = await fetchPdfBranding();
  setActiveBranding(branding);
  await loadPdfAssets();

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
  setActiveFormKey('');
  setGenerationTimestamp(new Date().toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }));

  // No CONFIDENTIAL watermark on this form — the copy is handed to (or
  // posted for) the respondent; it is their document, not an internal record.

  const lx = getLeftX();
  const rx = getRightColumnX(doc);
  const hfw = getHalfFieldWidth(doc);
  const ffw = getFullFieldWidth(doc);

  setActiveCaseNumber(data.callNumber);
  let y = drawNibrsHeader(doc, {
    stateIdentifier: 'STATE OF UTAH',
    agencyName: 'ROCKY MOUNTAIN PROTECTIVE GROUP',
    formTitle: 'NOTICE OF COMMUNICATION',
    formNumber: 'FORM PS-114',
    caseNumber: data.callNumber,
  });

  // ── Notice date / RMPG reference ──
  y = checkPageBreak(doc, y, 12);
  {
    const a = addFieldPair(doc, 'Notice Date', data.noticeDate, lx, y, hfw);
    const b = addFieldPair(doc, 'RMPG Reference No.', data.callNumber, rx, y, hfw);
    y = Math.max(a, b);
  }

  // ── Addressee — the respondent ──
  y = checkPageBreak(doc, y, 18);
  { const sec = openAutoSection(doc, 'To', y); y = sec.contentY;
    const addressee = data.respondentName && data.respondentName.trim()
      ? `${data.respondentName} (or current occupant)`
      : 'Occupant / Respondent at the address below';
    y = addFieldPair(doc, '1. Respondent', addressee, lx, y, ffw);
    y = addFieldPair(doc, '2. Service Address', data.serviceAddress, lx, y, ffw);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── The legal matter — what was being delivered ──
  y = checkPageBreak(doc, y, 18);
  { const sec = openAutoSection(doc, 'Re: Service of Legal Documents', y); y = sec.contentY;
    {
      const a = addFieldPair(doc, '3. Documents', (data.serviceType || 'Legal Documents').toUpperCase(), lx, y, hfw);
      const b = addFieldPair(doc, '4. Case No.', data.courtCaseNumber || 'See documents', rx, y, hfw);
      y = Math.max(a, b);
    }
    if (data.courtName) y = addFieldPair(doc, '5. Issuing Court', data.courtName, lx, y, ffw);
    // Contracting client appears as a single reference line only — no
    // address/phone/authorization internals on the respondent copy.
    y = addFieldPair(doc, data.courtName ? '6. Requested By' : '5. Requested By',
      data.clientName || 'On file', lx, y, ffw);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Attempt record — dates/times the respondent can verify ──
  y = checkPageBreak(doc, y, 30);
  {
    const sec = openAutoSection(doc, 'Record of Delivery Attempt(s)', y);
    y = sec.contentY;
    // No NOTES column — attempt notes are internal dispatch remarks the
    // respondent doesn't need (and shouldn't see).
    const cols = getProportionalColumns(doc, [1, 2.5, 2, 5.5]);
    const headers = [
      { label: '#', x: cols[0] },
      { label: 'DATE', x: cols[1] },
      { label: 'TIME', x: cols[2] },
      { label: 'OUTCOME', x: cols[3] },
    ];
    const rows = data.attempts.map(a => [
      String(a.number),
      sanitizePdfText(a.date || '').toUpperCase(),
      sanitizePdfText(a.time || '').toUpperCase(),
      sanitizePdfText(psoResultLabel(a.result)).toUpperCase(),
    ]);
    y = addTableWithShading(doc, headers, rows, y, cols);
    y += SPACING.SM;
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Notice statement — addressed to the respondent ──
  y = checkPageBreak(doc, y, 40);
  {
    const sec = openAutoSection(doc, 'Notice to Respondent', y);
    // addWrappedText draws at the text BASELINE — unlike addFieldPair it has
    // no built-in top padding, so the first line's ascender (~2.5mm at field
    // size) would clip into the black section band without this pad.
    y = sec.contentY + 3;
    const phone = data.dispatchPhone || data.officerPhone;
    const contact = phone ? `RMPG Dispatch at ${phone}` : 'RMPG Dispatch at the number listed on this notice';
    const docsLabel = (data.serviceType || 'legal documents').trim().toLowerCase();
    const docsPhrase = docsLabel.includes('document') ? docsLabel : `${docsLabel} documents`;
    const matter = data.courtCaseNumber
      ? ` in the matter referenced above (Case No. ${data.courtCaseNumber})`
      : ' in the matter referenced above';

    const para1 =
      'YOU ARE HEREBY NOTIFIED that Rocky Mountain Protective Group ("RMPG"), a licensed private ' +
      `security and process service agency, has been engaged to deliver ${docsPhrase} ` +
      `to you${matter}. As shown in the record above, delivery was attempted at the address listed ` +
      'on this notice but could not be completed at the time of the attempt(s).';
    const nextSentence = data.nextWindow
      ? ` A further delivery attempt is scheduled for ${data.nextWindow}.`
      : ' Further delivery attempts may be made.';
    const para2 =
      'The documents remain available for delivery to you. To arrange a convenient time and place to ' +
      `receive them, or to provide information that will assist with delivery, please contact ${contact}.` +
      nextSentence;
    const para3 =
      'This notice is provided for your information. It is not a court order and does not impose any ' +
      'obligation beyond those contained in the underlying documents. Delivery of legal process may ' +
      'also be completed by any other means permitted by law.';

    y = addWrappedText(doc, para1, lx, y, ffw, FONT.SIZE_FIELD_VALUE);
    y += SPACING.SM;
    y = addWrappedText(doc, para2, lx, y, ffw, FONT.SIZE_FIELD_VALUE);
    y += SPACING.SM;
    y = addWrappedText(doc, para3, lx, y, ffw, FONT.SIZE_FIELD_VALUE);
    y += SPACING.SM;
    if (data.dispatchPhone || data.officerPhone) {
      const a = addFieldPair(doc, 'Contact', data.dispatchPhone || data.officerPhone || '', lx, y, hfw);
      const b = data.nextWindow
        ? addFieldPair(doc, 'Next Attempt Window', data.nextWindow, rx, y, hfw)
        : y;
      y = Math.max(a, b);
    } else if (data.nextWindow) {
      y = addFieldPair(doc, 'Next Attempt Window', data.nextWindow, lx, y, hfw);
    }
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Serving officer (unsworn — informational notice) ──
  y = checkPageBreak(doc, y, SPACING.SIGNATURE_BOX_H + SPACING.LG);
  y = addSignatureBlock(doc, 'Serving Officer', lx, y, ffw, data.signature ? {
    signatureImage: data.signature,
    printedName: data.officerName,
    badgeNumber: data.officerBadge,
  } : {
    printedName: data.officerName,
    badgeNumber: data.officerBadge,
  });
  y += SPACING.SECTION_GAP;

  // ── Footer legal text ──
  y = checkPageBreak(doc, y, 10);
  y += 2; // clear the signature box bottom border (text draws at baseline)
  doc.setFont(PDF_VALUE_FONT, 'normal');
  doc.setFontSize(FONT.SIZE_FOOTER_SECONDARY);
  doc.setTextColor(...COLOR.TEXT_TERTIARY);
  doc.text(
    'Rocky Mountain Protective Group — Licensed Private Security, Utah Code Title 58, Chapter 63',
    doc.internal.pageSize.getWidth() / 2, y, { align: 'center' },
  );

  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    // Respondent-facing copy — never tag it "INTERNAL USE ONLY".
    addPageFooter(doc, i, totalPages, 'pso_notice_of_communication', { audienceLabel: 'RESPONDENT COPY' });
  }

  finalizePoliceReport(doc, {
    barcode: {
      formMetadata: {
        form: 'NOTICE-OF-COMMUNICATION',
        caseNumber: data.callNumber,
        agency: 'RMPG',
        agencyOri: 'UT0180100',
        reportDate: new Date().toISOString().slice(0, 10),
        officer: data.officerName,
        badge: data.officerBadge,
      },
    },
  });

  return doc;
}

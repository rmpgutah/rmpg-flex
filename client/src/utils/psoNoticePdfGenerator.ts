// ============================================================
// RMPG Flex — PSO Notice of Communication
//
// A client-facing notice generated when a PSO Client Request (a
// contracted protective-services dispatch — welfare check, property
// check, standby, escort, etc.) could NOT be completed on an attempt
// and is being re-dispatched. It documents the unsuccessful attempt(s)
// and informs the contracting client that the request has been
// rescheduled, with a contact-to-coordinate statement.
//
// This is NOT a process-service / legal document — no court, no
// perjury/notary clause. For legal serve attempts use
// servePdfGenerator.ts (generateNoticeOfAttempt). Reuses the shared
// pdfGenerator.ts + pdfTokens.ts helpers like the rest of the suite.
// ============================================================

import jsPDF from 'jspdf';
import {
  addConfidentialWatermark,
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
  notes: string;
}

export interface NoticeOfCommunicationData {
  noticeDate: string;
  /** Originating CFS call number of the failed attempt. */
  callNumber: string;
  /** Contracting client / requestor (the party the notice is addressed to). */
  clientName: string;
  /** Contact person at the contracting client (Attn line), if known. */
  clientContact?: string;
  clientAddress?: string;
  clientPhone?: string;
  /** Type of protective service requested (welfare check, property check, …). */
  serviceType: string;
  /** Where the service was to be performed. */
  serviceAddress: string;
  /** Requested service window / appointment, if any. */
  requestedWindow?: string;
  /** Client authorization / PO reference + billing code, if tracked. */
  authorization?: string;
  billingCode?: string;
  /** One row per unsuccessful attempt that triggered the re-dispatch. */
  attempts: NoticeOfCommunicationAttempt[];
  /** New call number created by the re-dispatch (if known). */
  redispatchCallNumber?: string;
  /** Scheduled next attempt window for the re-dispatch. */
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
    // "PS Non-Service", "PS Unknown", "PS Attempted") — map to client-readable
    // text instead of surfacing the raw code.
    case 'ps served':
    case 'served': return 'Served / completed';
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

  addConfidentialWatermark(doc);
  // @ts-expect-error jsPDF GState — safety reset after watermark
  doc.setGState(new doc.GState({ opacity: 1.0 }));

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

  // ── Notice Date / originating call ──
  y = checkPageBreak(doc, y, 12);
  {
    const a = addFieldPair(doc, 'Notice Date', data.noticeDate, lx, y, hfw);
    const b = addFieldPair(doc, 'Originating Call', data.callNumber, rx, y, hfw);
    y = Math.max(a, b);
  }

  // ── Client / addressee ──
  y = checkPageBreak(doc, y, 18);
  { const sec = openAutoSection(doc, 'Contracting Client', y); y = sec.contentY;
    const addressee = data.clientContact && data.clientContact.trim() && data.clientContact !== data.clientName
      ? `${data.clientName}  •  Attn: ${data.clientContact}`
      : data.clientName;
    y = addFieldPair(doc, '1. Client / Requestor', addressee, lx, y, ffw);
    if (data.clientAddress) y = addFieldPair(doc, '2. Client Address', data.clientAddress, lx, y, ffw);
    {
      const a = addFieldPair(doc, '3. Client Phone', data.clientPhone || 'On file', lx, y, hfw);
      const b = addFieldPair(doc, '4. Authorization / PO', data.authorization || 'N/A', rx, y, hfw);
      y = Math.max(a, b);
    }
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Requested service ──
  y = checkPageBreak(doc, y, 18);
  { const sec = openAutoSection(doc, 'Requested Service', y); y = sec.contentY;
    {
      const a = addFieldPair(doc, '5. Service Type', data.serviceType, lx, y, hfw);
      const b = addFieldPair(doc, '6. Requested Window', data.requestedWindow || 'As dispatched', rx, y, hfw);
      y = Math.max(a, b);
    }
    y = addFieldPair(doc, '7. Service Location', data.serviceAddress, lx, y, ffw);
    if (data.billingCode) y = addFieldPair(doc, '8. Billing Code', data.billingCode, lx, y, hfw);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Attempt record ──
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
    const rows = data.attempts.map(a => [
      String(a.number),
      sanitizePdfText(a.date || '').toUpperCase(),
      sanitizePdfText(a.time || '').toUpperCase(),
      sanitizePdfText(psoResultLabel(a.result)).toUpperCase(),
      sanitizePdfText(a.notes || '').toUpperCase(),
    ]);
    y = addTableWithShading(doc, headers, rows, y, cols);
    y += SPACING.SM;
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Notice statement ──
  y = checkPageBreak(doc, y, 34);
  {
    const sec = openAutoSection(doc, 'Notice', y);
    y = sec.contentY;
    const dispatch = data.dispatchPhone || data.officerPhone;
    const contact = dispatch ? ` at ${dispatch}` : ' at the dispatch number on file';
    const rescheduled = data.redispatchCallNumber
      ? `The request has been re-dispatched under call ${data.redispatchCallNumber}`
      : 'The request has been re-dispatched';
    const windowNote = data.nextWindow
      ? ` and a follow-up attempt is scheduled for ${data.nextWindow}.`
      : ' and a follow-up attempt has been scheduled.';
    const svc = (data.serviceType || 'requested').trim().toLowerCase();
    const noticeText =
      `This notice confirms that Rocky Mountain Protective Group attempted to fulfill the ${svc} request ` +
      `identified above on behalf of ${data.clientName || 'the contracting client'}. As ` +
      'detailed in the record of attempt(s) above, the requested service could not be completed at the time ' +
      `of the attempt. ${rescheduled}${windowNote} ` +
      `To confirm access, adjust the service window, or provide additional instructions, please contact our ` +
      `dispatch center${contact}. This notice is provided for service-coordination purposes and does not ` +
      'modify the terms of any service agreement in effect.';
    y = addWrappedText(doc, noticeText, lx, y, ffw, FONT.SIZE_FIELD_VALUE);
    y += SPACING.SM;
    if (data.nextWindow || data.redispatchCallNumber) {
      const a = addFieldPair(doc, 'Re-Dispatch Call', data.redispatchCallNumber || 'Pending', lx, y, hfw);
      const b = addFieldPair(doc, 'Next Attempt Window', data.nextWindow || 'To be scheduled', rx, y, hfw);
      y = Math.max(a, b);
    }
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Officer signature (unsworn — operational notice) ──
  y = checkPageBreak(doc, y, SPACING.SIGNATURE_BOX_H + SPACING.LG);
  y = addSignatureBlock(doc, 'Issuing Officer / Dispatcher', lx, y, ffw, data.signature ? {
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
    addPageFooter(doc, i, totalPages, 'pso_notice_of_communication');
    if (i > 1) addConfidentialWatermark(doc);
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

// ============================================================
// RMPG Flex — PSO Notice of Communication
//
// A RESPONDENT-FACING notice generated when a process-service /
// client-request attempt could not be completed. It is left at the
// door or handed to an occupant, so it is addressed TO the person
// being served (the respondent) — not to the contracting client.
//
// FORMAT: plain-paper court-style legal notice. Deliberately does NOT
// use the branded pdfGenerator/pdfTokens form suite (black section
// bands, gold rules, logos, barcodes) — this document is styled like
// something a process server would file with the court: white paper,
// black Times text, 1" margins, centered caption, formal body
// paragraphs, attempt record, declaration, and signature block.
//
// Internal dispatch details (billing codes, authorizations, client
// contact blocks, re-dispatch call numbers, attempt notes) are
// deliberately NOT printed — the contracting client appears only as
// a one-line "at the request of" reference. For the sworn/affidavit
// serve documents use servePdfGenerator.ts (generateNoticeOfAttempt).
// ============================================================

import jsPDF from 'jspdf';
import { sanitizePdfText } from './pdfGenerator';

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
  /** Originating CFS call number — printed as the agency reference number. */
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

// ── Plain court-document layout constants (US Letter, mm) ──
const PAGE_W = 215.9;
const PAGE_H = 279.4;
const MARGIN = 25.4;               // standard 1" legal margins all around
const CONTENT_W = PAGE_W - MARGIN * 2;
const BODY_PT = 12;                // court-standard 12 pt body
const SMALL_PT = 10;
const LINE_H = 6.2;                // ~1.45 line spacing at 12 pt (between single and 1.5)
const BOTTOM_Y = PAGE_H - MARGIN;  // last usable baseline

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * Mixed-case text cleaner for this document. The shared sanitizePdfText
 * ends with .toUpperCase() (police-form ALL-CAPS convention) — a court-style
 * notice is set in normal mixed case, so we normalize problem characters to
 * Latin-1 locally and deliberately do NOT uppercase.
 */
function cleanText(text: string): string {
  if (!text) return text;
  return text
    .replace(/\u2014/g, '-')    // em dash
    .replace(/\u2013/g, '-')    // en dash
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2026/g, '...')
    .replace(/\u00A0/g, ' ')    // non-breaking space
    .replace(/\u200B/g, '')     // zero-width space
    .replace(/[^\x00-\xFF]/g, '?');
}

/** "2026-06-08" → "June 8, 2026"; anything unparsable passes through. */
function legalDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((iso || '').trim());
  if (!m) return cleanText(iso || '');
  const month = MONTHS[parseInt(m[2], 10) - 1];
  return month ? `${month} ${parseInt(m[3], 10)}, ${m[1]}` : cleanText(iso);
}

export async function generateNoticeOfCommunication(data: NoticeOfCommunicationData): Promise<jsPDF> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
  doc.setTextColor(0, 0, 0);
  doc.setDrawColor(0, 0, 0);

  let y = MARGIN;

  const ensureSpace = (needed: number) => {
    if (y + needed > BOTTOM_Y) {
      doc.addPage();
      y = MARGIN;
    }
  };

  /** Wrapped body paragraph at the current y; advances and page-breaks per line. */
  const paragraph = (text: string, opts?: { size?: number; style?: string; indent?: number }) => {
    const size = opts?.size ?? BODY_PT;
    const indent = opts?.indent ?? 0;
    doc.setFont('times', opts?.style ?? 'normal');
    doc.setFontSize(size);
    const lines = doc.splitTextToSize(cleanText(text), CONTENT_W - indent) as string[];
    for (const line of lines) {
      ensureSpace(LINE_H);
      doc.text(line, MARGIN + indent, y);
      y += LINE_H;
    }
  };

  const centered = (text: string, opts?: { size?: number; style?: string }) => {
    ensureSpace(LINE_H);
    doc.setFont('times', opts?.style ?? 'normal');
    doc.setFontSize(opts?.size ?? BODY_PT);
    doc.text(cleanText(text), PAGE_W / 2, y, { align: 'center' });
    y += LINE_H;
  };

  // ── Caption — centered header block ──
  centered('STATE OF UTAH', { style: 'bold' });
  if (data.courtName) centered(data.courtName.toUpperCase(), { size: 11 });
  y += LINE_H * 0.5;

  centered('NOTICE OF ATTEMPTED SERVICE OF PROCESS', { style: 'bold', size: 13 });
  // Plain underline beneath the title, court-fashion.
  {
    const titleW = doc.getTextWidth('NOTICE OF ATTEMPTED SERVICE OF PROCESS');
    doc.setLineWidth(0.3);
    doc.line(PAGE_W / 2 - titleW / 2, y - LINE_H + 1.2, PAGE_W / 2 + titleW / 2, y - LINE_H + 1.2);
  }

  if (data.courtCaseNumber) centered(`Case No. ${data.courtCaseNumber}`, { size: 11 });
  centered(`Agency Reference No. ${data.callNumber}`, { size: 11 });
  y += LINE_H;

  // ── Date and addressee ──
  paragraph(`DATE OF NOTICE: ${data.noticeDate}`);
  y += LINE_H * 0.5;

  const addressee = data.respondentName && data.respondentName.trim()
    ? `${data.respondentName} (or current occupant)`
    : 'Occupant / Respondent';
  doc.setFont('times', 'bold');
  doc.setFontSize(BODY_PT);
  ensureSpace(LINE_H);
  doc.text('TO:', MARGIN, y);
  doc.setFont('times', 'normal');
  doc.text(cleanText(addressee), MARGIN + 14, y);
  y += LINE_H;
  {
    // Service address indented under the addressee, wrapped if long.
    doc.setFont('times', 'normal');
    const lines = doc.splitTextToSize(cleanText(data.serviceAddress || 'Address on file'), CONTENT_W - 14) as string[];
    for (const line of lines) {
      ensureSpace(LINE_H);
      doc.text(line, MARGIN + 14, y);
      y += LINE_H;
    }
  }
  y += LINE_H * 0.5;

  // RE: line — the legal matter, single line wrapped.
  {
    const docs = (data.serviceType || 'Legal Documents').toUpperCase();
    const reParts = [docs];
    if (data.courtCaseNumber) reParts.push(`Case No. ${data.courtCaseNumber}`);
    if (data.courtName) reParts.push(data.courtName);
    doc.setFont('times', 'bold');
    ensureSpace(LINE_H);
    doc.text('RE:', MARGIN, y);
    doc.setFont('times', 'normal');
    const lines = doc.splitTextToSize(cleanText(reParts.join(' — ')), CONTENT_W - 14) as string[];
    for (const line of lines) {
      ensureSpace(LINE_H);
      doc.text(line, MARGIN + 14, y);
      y += LINE_H;
    }
  }
  y += LINE_H * 0.75;

  // ── Body — formal notice paragraphs ──
  const phone = data.dispatchPhone || data.officerPhone;
  const contact = phone
    ? `Rocky Mountain Protective Group Dispatch at ${phone}`
    : 'Rocky Mountain Protective Group Dispatch at the telephone number set forth below';
  const docsLabel = (data.serviceType || 'legal documents').trim().toLowerCase();
  const docsPhrase = docsLabel.includes('document') ? docsLabel : `${docsLabel} documents`;
  const matter = data.courtCaseNumber
    ? ` in the matter referenced above (Case No. ${data.courtCaseNumber})`
    : ' in the matter referenced above';

  paragraph(
    'YOU ARE HEREBY NOTIFIED that Rocky Mountain Protective Group, a private security and ' +
    'process service agency licensed under Utah Code Title 58, Chapter 63, has been engaged ' +
    `at the request of ${data.clientName || 'the requesting party'} to effect delivery of ${docsPhrase} ` +
    `upon you${matter}. As set forth in the record below, delivery was attempted at the ` +
    'address stated above but could not be completed at the time of the attempt(s).',
  );
  y += LINE_H * 0.5;

  // ── Record of attempts — plain numbered list, court-style ──
  ensureSpace(LINE_H * 2);
  paragraph('RECORD OF SERVICE ATTEMPTS', { style: 'bold' });
  for (const a of data.attempts) {
    const when = [legalDate(a.date), a.time ? `at ${cleanText(a.time)} hours` : ''].filter(Boolean).join(', ');
    paragraph(
      `${a.number}.  ${when || 'Date and time of record'} — ${psoResultLabel(a.result)}.`,
      { indent: 8 },
    );
  }
  y += LINE_H * 0.5;

  const nextSentence = data.nextWindow
    ? ` A further attempt at delivery is scheduled for ${data.nextWindow}.`
    : ' Further attempts at delivery may be made.';
  paragraph(
    'The documents remain available for delivery to you. To arrange a time and place to receive ' +
    `them, or to provide information that will assist with delivery, contact ${contact}.` +
    nextSentence,
  );
  y += LINE_H * 0.5;

  paragraph(
    'This notice is informational. It is not a court order and imposes no obligation beyond ' +
    'those contained in the underlying documents. Service of process may also be completed by ' +
    'any other means permitted by law.',
  );
  y += LINE_H;

  // ── Declaration / attestation ──
  // Keep the declaration, DATED line, and signature block together as one
  // unit — never an orphaned signature at the top of a page.
  ensureSpace(100);
  paragraph('DECLARATION OF SERVER', { style: 'bold' });
  paragraph(
    `I, ${data.officerName || 'the undersigned'}, declare under criminal penalty under the law of ` +
    'Utah (Utah Code § 78B-18a-106) that I attempted service of the documents described above at ' +
    'the address stated herein on the date(s) and time(s) set forth above, and that the foregoing ' +
    'is true and correct.',
  );
  y += LINE_H;

  // ── Dated + signature block ──
  // Keep the whole block on one page: date line, optional signature image,
  // rule, and four identity lines.
  ensureSpace(LINE_H * 7 + 16);
  paragraph(`DATED this ${data.noticeDate}.`);
  y += LINE_H * 0.5;

  const SIG_W = 76;
  const sigX = PAGE_W - MARGIN - SIG_W;
  if (data.signature) {
    try {
      doc.addImage(data.signature, 'PNG', sigX + 4, y, SIG_W - 16, 12);
    } catch { /* bad/foreign image data — leave the line blank for wet signature */ }
  }
  y += 14;
  doc.setLineWidth(0.3);
  doc.line(sigX, y, sigX + SIG_W, y);
  y += 4.5;

  const sigLine = (text: string, style: 'normal' | 'italic' = 'normal') => {
    doc.setFont('times', style);
    doc.setFontSize(SMALL_PT);
    // Wrap within the signature column so long lines never run off the page.
    const lines = doc.splitTextToSize(cleanText(text), SIG_W) as string[];
    for (const line of lines) {
      doc.text(line, sigX, y);
      y += 4.8;
    }
  };
  sigLine(`${data.officerName || ''}${data.officerBadge ? `, Badge No. ${data.officerBadge}` : ''}`);
  sigLine('Rocky Mountain Protective Group');
  sigLine('Licensed Private Security', 'italic');
  sigLine('Utah Code Title 58, Chapter 63', 'italic');
  if (phone) sigLine(`Telephone: ${phone}`);

  // ── Plain page numbers, bottom center ──
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFont('times', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(0, 0, 0);
    doc.text(`Page ${i} of ${totalPages}`, PAGE_W / 2, PAGE_H - 12.7, { align: 'center' });
  }

  return doc;
}

// ============================================================
// RMPG Flex — Notice of Service Leave-Behind (PS-314)
// A two-page document left with the recipient at point of service.
//   Page 1: Service summary + what the recipient needs to know.
//   Page 2: Acknowledgement of receipt (dual-signature block).
// Does NOT modify the PS-300 Job Information Sheet.
// ============================================================

import jsPDF from 'jspdf';
import {
  openAutoSection,
  closeAutoSection,
  addFieldPair,
  addSignatureBlock,
  addWrappedText,
  addPageFooter,
  checkPageBreak,
  fetchPdfBranding,
  setActiveBranding,
  loadPdfAssets,
  setActiveFormKey,
  setActiveCaseNumber,
  setActiveSectionStyle,
  sanitizePdfText,
  stampGenerationTime,
} from './pdfGenerator';
import {
  SPACING, FONT,
  getFullFieldWidth,
  getLeftX, getRightColumnX, getHalfFieldWidth,
} from './pdfTokens';
import { drawNibrsHeader } from './pdfFormHelpers';
import { registerArialFont } from './pdf/fonts/registerArial';

// ── Data Interface ────────────────────────────────────────────

export interface LeaveBehindData {
  // Job identification
  jobId: number | string;
  caseNumber: string | null;
  documentType: string;
  courtName: string | null;
  jurisdiction: string | null;
  clientName: string | null;
  attorneyName: string | null;
  serviceInstructions: string | null;
  serveDate: string | null;

  // Recipient identity — always present
  recipientType: 'individual' | 'business' | null;
  recipientName: string;
  recipientAddress: string;

  // Business-specific (only when recipientType === 'business')
  businessName?: string | null;
  businessDba?: string | null;
  businessEin?: string | null;
  businessSosFiling?: string | null;
  businessStateOfInc?: string | null;
  registeredAgentName?: string | null;
  registeredAgentTitle?: string | null;
  registeredOfficeAddress?: string | null;

  // Serving officer
  officerName: string;
  officerBadge: string;
}

// ── Notice text ───────────────────────────────────────────────

const NOTICE_BODY =
  'You have been served with the above-referenced legal document(s) by an authorized ' +
  'officer of Rocky Mountain Protective Group acting under lawful authority. ' +
  'Receipt of these documents creates legal obligations that require timely action. ' +
  'Failure to respond within the required time may result in a default judgment or ' +
  'other adverse legal consequences. Contact the attorney or court listed above ' +
  'immediately for guidance on your next required steps and applicable deadlines.';

// General information bullet text — fills page 1 and gives recipients actionable guidance
const GENERAL_INFO_ITEMS = [
  'READ THE DOCUMENTS CAREFULLY. Review every page of the documents handed to you. ' +
    'The filing date, response deadline, and case number printed on those documents ' +
    'are the controlling dates — not the date of service.',
  'CONTACT AN ATTORNEY PROMPTLY. The attorney or law firm listed in Section 1 of this ' +
    'notice represents the opposing party and cannot give you legal advice. You should ' +
    'contact your own attorney or a legal aid organization as soon as possible.',
  'RESPOND BY THE DEADLINE. In Utah small claims and civil matters, failure to file a ' +
    'written response or appear at a scheduled hearing by the deadline may result in a ' +
    'default judgment being entered against you without further notice.',
  'KEEP THIS DOCUMENT. This notice is your record of service. Keep it with the served ' +
    'documents in a safe place. You may need it if you contest the service in court.',
  'UTAH LEGAL RESOURCES. Utah Courts Self-Help: utcourts.gov · Utah Legal Services: ' +
    'utahlegalservices.org · State Bar Lawyer Referral: utahbar.org',
];

// ── Header helper (shared across both pages) ─────────────────

function drawPageHeader(
  doc: jsPDF,
  jobId: number | string,
  caseNumber: string | null,
  pageTitle: string,
): number {
  setActiveCaseNumber(caseNumber || `JOB-${jobId}`);
  return drawNibrsHeader(doc, {
    stateIdentifier: 'STATE OF UTAH',
    agencyName: 'ROCKY MOUNTAIN PROTECTIVE GROUP',
    formTitle: pageTitle,
    formNumber: 'PS-314',
    caseNumber: caseNumber || `JOB-${jobId}`,
    caseNumberLabel: caseNumber ? 'CASE NUMBER' : 'AGENCY JOB #',
  });
}

// ── Footer helper ─────────────────────────────────────────────

function drawFooter(doc: jsPDF, pageNum: number, totalPages: number) {
  addPageFooter(doc, pageNum, totalPages, 'serve_leave_behind', {
    audienceLabel: 'NOTICE TO RECIPIENT',
  });
}

// ── Main generator ────────────────────────────────────────────

export async function generateServeLeaveBehin(data: LeaveBehindData): Promise<jsPDF> {
  const branding = await fetchPdfBranding();
  setActiveBranding(branding);
  await loadPdfAssets();

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
  registerArialFont(doc);

  setActiveSectionStyle('light');
  setActiveFormKey('serve_leave_behind');
  stampGenerationTime();

  const lx = getLeftX();
  const rx = getRightColumnX(doc);
  const hfw = getHalfFieldWidth(doc);
  const ffw = getFullFieldWidth(doc);
  const isBusiness = data.recipientType === 'business';

  // ─────────────────────────────────────────────────────────────
  // PAGE 1 — Notice of Service
  // ─────────────────────────────────────────────────────────────

  let y = drawPageHeader(doc, data.jobId, data.caseNumber, 'NOTICE OF SERVICE');

  // Section 1 — Service Details
  y = checkPageBreak(doc, y, 15);
  { const sec = openAutoSection(doc, '1. SERVICE DETAILS', y); y = sec.contentY;
    const fy1 = addFieldPair(doc, 'Document type', sanitizePdfText(data.documentType), lx, y, hfw);
    const fy2 = addFieldPair(doc, 'Case number', sanitizePdfText(data.caseNumber || ''), rx, y, hfw);
    y = Math.max(fy1, fy2);
    y = addFieldPair(doc, 'Court', sanitizePdfText(data.courtName || ''), lx, y, ffw);
    const fy3 = addFieldPair(doc, 'Jurisdiction', sanitizePdfText(data.jurisdiction || ''), lx, y, hfw);
    const fy4 = addFieldPair(doc, 'Serve date', sanitizePdfText(data.serveDate || ''), rx, y, hfw);
    y = Math.max(fy3, fy4);
    const fy5 = addFieldPair(doc, 'Attorney', sanitizePdfText(data.attorneyName || ''), lx, y, hfw);
    const fy6 = addFieldPair(doc, 'Client / firm', sanitizePdfText(data.clientName || ''), rx, y, hfw);
    y = Math.max(fy5, fy6);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Section 2 — Served Party (layout adapts to individual vs business)
  const typeLabel = isBusiness ? '2. SERVED PARTY — BUSINESS' : '2. SERVED PARTY — INDIVIDUAL';
  y = checkPageBreak(doc, y, 20);
  { const sec = openAutoSection(doc, typeLabel, y); y = sec.contentY;
    if (isBusiness) {
      y = addFieldPair(doc, 'Business legal name', sanitizePdfText(data.businessName || data.recipientName), lx, y, ffw);
      const fy1 = addFieldPair(doc, 'DBA', sanitizePdfText(data.businessDba || ''), lx, y, hfw);
      const fy2 = addFieldPair(doc, 'EIN', sanitizePdfText(data.businessEin || ''), rx, y, hfw);
      y = Math.max(fy1, fy2);
      const fy3 = addFieldPair(doc, 'SOS filing number', sanitizePdfText(data.businessSosFiling || ''), lx, y, hfw);
      const fy4 = addFieldPair(doc, 'State of incorporation', sanitizePdfText(data.businessStateOfInc || ''), rx, y, hfw);
      y = Math.max(fy3, fy4);
      const fy5 = addFieldPair(doc, 'Registered agent', sanitizePdfText(data.registeredAgentName || ''), lx, y, hfw);
      const fy6 = addFieldPair(doc, 'Agent title', sanitizePdfText(data.registeredAgentTitle || ''), rx, y, hfw);
      y = Math.max(fy5, fy6);
      y = addFieldPair(doc, 'Registered / principal office', sanitizePdfText(data.registeredOfficeAddress || data.recipientAddress), lx, y, ffw);
      y = addFieldPair(doc, 'Service method', 'Corp/SC / Registered Agent Service', lx, y, ffw);
    } else {
      y = addFieldPair(doc, 'Full name', sanitizePdfText(data.recipientName), lx, y, ffw);
      y = addFieldPair(doc, 'Address served', sanitizePdfText(data.recipientAddress), lx, y, ffw);
      y = addFieldPair(doc, 'Service method', 'Personal Service', lx, y, ffw);
    }
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Section 3 — Service Instructions (if present)
  if (data.serviceInstructions && data.serviceInstructions.trim()) {
    y = checkPageBreak(doc, y, 15);
    { const sec = openAutoSection(doc, '3. SERVICE INSTRUCTIONS', y); y = sec.contentY;
      y = addWrappedText(doc, sanitizePdfText(data.serviceInstructions), lx, y, ffw);
      y += SPACING.SM;
      y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
    }
  }

  // Required Action notice box — use openAutoSection/addWrappedText/closeAutoSection
  // so the header bar style matches every other section on the page.
  y = checkPageBreak(doc, y, 22);
  { const sec = openAutoSection(doc, 'REQUIRED ACTION — READ CAREFULLY', y); y = sec.contentY;
    y = addWrappedText(doc, NOTICE_BODY, lx, y, ffw);
    y += SPACING.SM;
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // General information — fills remainder of page 1 and gives recipients actionable guidance.
  // Without this section ~60% of page 1 is blank for simple individual service.
  y = checkPageBreak(doc, y, 20);
  { const sec = openAutoSection(doc, 'GENERAL INFORMATION', y); y = sec.contentY;
    for (let i = 0; i < GENERAL_INFO_ITEMS.length; i++) {
      y = checkPageBreak(doc, y, 10);
      // Bullet number
      doc.setFont('Arial', 'bold');
      doc.setFontSize(FONT.SIZE_FIELD_VALUE);
      doc.setTextColor(0, 0, 0);
      doc.text(`${i + 1}.`, lx, y);
      // Bullet text — inset 5mm from left to clear the number
      y = addWrappedText(doc, GENERAL_INFO_ITEMS[i], lx + 5, y, ffw - 5);
      y += SPACING.SM;
    }
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  drawFooter(doc, 1, 2);

  // ─────────────────────────────────────────────────────────────
  // PAGE 2 — Acknowledgement of Receipt
  // ─────────────────────────────────────────────────────────────

  doc.addPage();
  setActiveSectionStyle('light');
  y = drawPageHeader(doc, data.jobId, data.caseNumber, 'ACKNOWLEDGEMENT OF RECEIPT');

  // Intro statement
  y = checkPageBreak(doc, y, 20);
  const introText = isBusiness
    ? 'I, the undersigned authorized representative of the above-named business entity, acknowledge receipt of ' +
      'the above-referenced legal documents from an authorized officer of Rocky Mountain Protective Group on the ' +
      'date and time noted below. I confirm I am authorized to accept service on behalf of this entity.'
    : 'I, the undersigned, acknowledge receipt of the above-referenced legal documents from an authorized officer ' +
      'of Rocky Mountain Protective Group on the date and time noted below. I understand that receipt of these ' +
      'documents does not constitute admission of any legal obligation.';

  doc.setFont('Arial', 'normal');
  doc.setFontSize(FONT.SIZE_FIELD_VALUE);
  doc.setTextColor(0, 0, 0);
  const introEndY = addWrappedText(doc, introText, lx, y, ffw);
  y = introEndY + SPACING.MD;

  // Recipient acknowledgement block
  const recipLabel = isBusiness ? 'AUTHORIZED REPRESENTATIVE ACKNOWLEDGEMENT' : 'RECIPIENT ACKNOWLEDGEMENT';
  y = checkPageBreak(doc, y, 40);
  { const sec = openAutoSection(doc, recipLabel, y); y = sec.contentY;
    y = addFieldPair(doc, 'Printed name', '', lx, y, ffw);
    if (isBusiness) {
      const fy1 = addFieldPair(doc, 'Title / position', '', lx, y, hfw);
      const fy2 = addFieldPair(doc, 'On behalf of', sanitizePdfText(data.businessName || data.recipientName), rx, y, hfw);
      y = Math.max(fy1, fy2);
    }
    const fy3 = addFieldPair(doc, 'Date', '', lx, y, hfw);
    const fy4 = addFieldPair(doc, 'Time', '', rx, y, hfw);
    y = Math.max(fy3, fy4);
    y += SPACING.MD;
    y = addSignatureBlock(doc, 'Signature', lx, y, ffw);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Officer certification block
  y = checkPageBreak(doc, y, 40);
  { const sec = openAutoSection(doc, 'OFFICER CERTIFICATION', y); y = sec.contentY;
    const fy1 = addFieldPair(doc, 'Serving officer', sanitizePdfText(data.officerName), lx, y, hfw);
    const fy2 = addFieldPair(doc, 'Badge number', sanitizePdfText(data.officerBadge), rx, y, hfw);
    y = Math.max(fy1, fy2);
    const fy3 = addFieldPair(doc, 'Date served', '', lx, y, hfw);
    const fy4 = addFieldPair(doc, 'Time served', '', rx, y, hfw);
    y = Math.max(fy3, fy4);
    y += SPACING.MD;
    y = addSignatureBlock(doc, 'Officer signature', lx, y, ffw);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  drawFooter(doc, 2, 2);

  return doc;
}

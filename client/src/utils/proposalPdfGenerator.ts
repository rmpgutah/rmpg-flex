// ============================================================
// RMPG Flex — Proposal PDF Generator
// Professional security service proposal using shared PDF helpers
// ============================================================

import jsPDF from 'jspdf';
import {
  addReportHeader,
  openAutoSection,
  closeAutoSection,
  addFieldPair,
  addPageFooter,
  addConfidentialWatermark,
  addWrappedText,
  checkPageBreak,
  setGenerationTimestamp,
  fetchPdfBranding,
  setActiveBranding,
  setActiveFormKey,
  setActiveCaseNumber,
  loadPdfAssets,
} from './pdfGenerator';
import {
  LAYOUT, SPACING, FONT, COLOR,
  getContentWidth, getHalfWidth, getFullFieldWidth,
  getLeftX, getRightColumnX, getHalfFieldWidth,
} from './pdfTokens';

// ── Data interface ────────────────────────────────────────

interface ProposalPdfData {
  proposal_number: string;
  title: string;
  template_type?: string;
  stage?: string;
  // Client / lead info
  business_name?: string;
  contact_name?: string;
  contact_email?: string;
  contact_phone?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  // Financials
  monthly_value?: number;
  total_value?: number;
  billing_frequency?: string;
  contract_length_months?: number;
  // Dates
  valid_until?: string;
  proposed_start?: string;
  proposed_end?: string;
  created_at?: string;
  // Content
  scope_of_work?: string;
  terms?: string;
  description?: string;
  notes?: string;
}

function fmtCurrency(val?: number): string {
  if (!val && val !== 0) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);
}

function fmtDate(d?: string): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function toLabel(s?: string): string {
  if (!s) return '—';
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ── Main Generator ────────────────────────────────────────

export async function generateProposalPdf(data: ProposalPdfData): Promise<void> {
  const branding = await fetchPdfBranding();
  await loadPdfAssets();

  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  setGenerationTimestamp();
  setActiveBranding(branding);
  setActiveFormKey('PROP');
  setActiveCaseNumber(data.proposal_number);

  const leftX = getLeftX();
  const rightX = getRightColumnX();
  const contentW = getContentWidth();
  const halfW = getHalfWidth();
  const fieldW = getFullFieldWidth();
  const halfFieldW = getHalfFieldWidth();

  // ── Page 1: Header ────────────────────────────────

  let y = addReportHeader(doc, 'SECURITY SERVICE PROPOSAL', data.proposal_number);

  // ── Proposal Info Section ────────────────────────

  y = openAutoSection(doc, y, 'PROPOSAL DETAILS');

  y = addFieldPair(doc, y, leftX, rightX, halfFieldW,
    'Proposal #', data.proposal_number,
    'Date', fmtDate(data.created_at),
  );
  y = addFieldPair(doc, y, leftX, rightX, halfFieldW,
    'Service Type', toLabel(data.template_type),
    'Valid Until', fmtDate(data.valid_until),
  );
  y = addFieldPair(doc, y, leftX, rightX, halfFieldW,
    'Status', toLabel(data.stage),
    'Contract Length', data.contract_length_months ? `${data.contract_length_months} months` : '—',
  );

  y = closeAutoSection(doc, y);

  // ── Client / Lead Info ────────────────────────────

  y = openAutoSection(doc, y, 'PREPARED FOR');

  y = addFieldPair(doc, y, leftX, rightX, halfFieldW,
    'Company', data.business_name || '—',
    'Contact', data.contact_name || '—',
  );
  y = addFieldPair(doc, y, leftX, rightX, halfFieldW,
    'Email', data.contact_email || '—',
    'Phone', data.contact_phone || '—',
  );

  const fullAddr = [data.address, data.city, data.state, data.zip].filter(Boolean).join(', ');
  if (fullAddr) {
    y = addFieldPair(doc, y, leftX, rightX, halfFieldW,
      'Address', fullAddr,
      '', '',
    );
  }

  y = closeAutoSection(doc, y);

  // ── Financial Summary ────────────────────────────

  y = openAutoSection(doc, y, 'FINANCIAL SUMMARY');

  y = addFieldPair(doc, y, leftX, rightX, halfFieldW,
    'Monthly Rate', fmtCurrency(data.monthly_value),
    'Total Contract Value', fmtCurrency(data.total_value),
  );
  y = addFieldPair(doc, y, leftX, rightX, halfFieldW,
    'Billing Frequency', toLabel(data.billing_frequency),
    'Proposed Start', fmtDate(data.proposed_start),
  );
  if (data.proposed_end) {
    y = addFieldPair(doc, y, leftX, rightX, halfFieldW,
      'Proposed End', fmtDate(data.proposed_end),
      '', '',
    );
  }

  y = closeAutoSection(doc, y);

  // ── Scope of Work ────────────────────────────────

  if (data.scope_of_work) {
    y = checkPageBreak(doc, y, 120);
    y = openAutoSection(doc, y, 'SCOPE OF WORK');

    doc.setFont(FONT.BODY, 'normal');
    doc.setFontSize(FONT.SIZE_BODY);
    doc.setTextColor(...COLOR.TEXT_DARK);
    y = addWrappedText(doc, data.scope_of_work, leftX + SPACING.FIELD_PAD, y + 4, fieldW - SPACING.FIELD_PAD * 2, FONT.SIZE_BODY);
    y += SPACING.AFTER_FIELD;

    y = closeAutoSection(doc, y);
  }

  // ── Terms & Conditions ────────────────────────────

  if (data.terms) {
    y = checkPageBreak(doc, y, 120);
    y = openAutoSection(doc, y, 'TERMS & CONDITIONS');

    doc.setFont(FONT.BODY, 'normal');
    doc.setFontSize(FONT.SIZE_BODY);
    doc.setTextColor(...COLOR.TEXT_DARK);
    y = addWrappedText(doc, data.terms, leftX + SPACING.FIELD_PAD, y + 4, fieldW - SPACING.FIELD_PAD * 2, FONT.SIZE_BODY);
    y += SPACING.AFTER_FIELD;

    y = closeAutoSection(doc, y);
  }

  // ── Signature Block ────────────────────────────────

  y = checkPageBreak(doc, y, 160);
  y = openAutoSection(doc, y, 'AUTHORIZATION');

  y += 8;
  doc.setFont(FONT.BODY, 'normal');
  doc.setFontSize(FONT.SIZE_BODY);
  doc.setTextColor(...COLOR.TEXT_DARK);
  doc.text('By signing below, the parties agree to the terms and conditions outlined in this proposal.', leftX + SPACING.FIELD_PAD, y);
  y += 30;

  // Signature lines
  const sigLineW = halfW - 40;
  const sigY = y + 30;

  // Left: Client
  doc.setDrawColor(...COLOR.BORDER);
  doc.setLineWidth(0.5);
  doc.line(leftX + 10, sigY, leftX + 10 + sigLineW, sigY);
  doc.setFontSize(7);
  doc.setTextColor(...COLOR.TEXT_LIGHT);
  doc.text('Client Signature', leftX + 10, sigY + 10);
  doc.text('Date: _______________', leftX + 10, sigY + 22);

  // Right: RMPG
  doc.line(rightX, sigY, rightX + sigLineW, sigY);
  doc.text('RMPG Security Services', rightX, sigY + 10);
  doc.text('Date: _______________', rightX, sigY + 22);

  y = sigY + 40;
  y = closeAutoSection(doc, y);

  // ── Notes ────────────────────────────────────────

  if (data.notes) {
    y = checkPageBreak(doc, y, 80);
    y = openAutoSection(doc, y, 'ADDITIONAL NOTES');
    doc.setFont(FONT.BODY, 'italic');
    doc.setFontSize(FONT.SIZE_BODY);
    doc.setTextColor(...COLOR.TEXT_LIGHT);
    y = addWrappedText(doc, data.notes, leftX + SPACING.FIELD_PAD, y + 4, fieldW - SPACING.FIELD_PAD * 2, FONT.SIZE_BODY);
    y += SPACING.AFTER_FIELD;
    y = closeAutoSection(doc, y);
  }

  // ── Footer + Watermark ────────────────────────────

  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    addPageFooter(doc, i, pageCount);
    addConfidentialWatermark(doc);
  }

  // ── Save ────────────────────────────────────────────

  const filename = `Proposal_${data.proposal_number.replace(/[^a-zA-Z0-9-]/g, '_')}.pdf`;
  doc.save(filename);
}

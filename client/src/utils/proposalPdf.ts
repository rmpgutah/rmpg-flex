// ============================================================
// RMPG Flex — Proposal PDF Generator
// Professional proposal layout using shared PDF helpers + tokens
// Follows exact same pattern as invoicePdfGenerator.ts
// ============================================================

import jsPDF from 'jspdf';
import {
  hexToRgb,
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
  getActiveBranding,
  loadPdfAssets,
} from './pdfGenerator';
import {
  LAYOUT, SPACING, FONT, COLOR, BORDER,
  getContentWidth, getFullFieldWidth,
  getLeftX, getRightColumnX, getHalfFieldWidth, getQuarterWidth,
  getLineHeight, getCapHeight,
} from './pdfTokens';

// ── Helpers ──────────────────────────────────────────────────

function fmt(n: number | null | undefined): string {
  if (n == null) return '$0.00';
  return `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── PDF Generation ────────────────────────────────────────────

export async function generateProposalPdf(proposal: any, client: any): Promise<void> {
  const branding = await fetchPdfBranding();
  setActiveBranding(branding);
  await loadPdfAssets();
  setActiveFormKey('proposal');
  setActiveCaseNumber(proposal.proposal_number || 'PROP');
  setGenerationTimestamp(new Date().toLocaleString());

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const cw = getContentWidth(doc);
  const lx = getLeftX();
  const rx = getRightColumnX(doc);
  const hfw = getHalfFieldWidth(doc);
  const ffw = getFullFieldWidth(doc);
  const brand = getActiveBranding();
  const primaryRgb = hexToRgb(brand.primary_color);

  // ── Watermark ────────────────────────────────────────────
  addConfidentialWatermark(doc);

  // ── Header (same as invoice) ─────────────────────────────
  let y = addReportHeader(doc, proposal.proposal_number || 'PROPOSAL', 'Proposal', 'routine', undefined, { useLogo: true });

  // ── Proposal Information Section ─────────────────────────
  { const sec = openAutoSection(doc, 'Proposal Information', y); y = sec.contentY;
    const qw = getQuarterWidth(doc);
    addFieldPair(doc, 'Proposal Number', proposal.proposal_number || '', lx, y, qw);
    addFieldPair(doc, 'Status', (proposal.stage || 'draft').toUpperCase(), lx + qw + SPACING.MD, y, qw);
    addFieldPair(doc, 'Valid Until', proposal.valid_until ? String(proposal.valid_until).substring(0, 10) : '', lx + (qw + SPACING.MD) * 2, y, qw);
    y = addFieldPair(doc, 'Created', proposal.created_at ? String(proposal.created_at).substring(0, 10) : '', lx + (qw + SPACING.MD) * 3, y, qw);
    y = addFieldPair(doc, 'Title', proposal.title || '', lx, y, ffw);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Client Block ─────────────────────────────────────────
  { const sec = openAutoSection(doc, 'Prepared For', y); y = sec.contentY;
    const clientName = proposal.client_name || client?.name || client?.company_name || '';
    const clientAddress = client?.address || client?.billing_address || '';
    const clientContact = client?.contact_name || client?.primary_contact || '';
    const clientEmail = client?.email || client?.contact_email || '';
    y = addFieldPair(doc, 'Client Name', clientName, lx, y, ffw);
    if (clientAddress) {
      y = addFieldPair(doc, 'Address', clientAddress, lx, y, ffw);
    }
    if (clientContact || clientEmail) {
      addFieldPair(doc, 'Contact', clientContact, lx, y, hfw);
      y = addFieldPair(doc, 'Email', clientEmail, rx, y, hfw);
    }
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Scope of Work Section ────────────────────────────────
  { const sec = openAutoSection(doc, 'Scope of Work', y); y = sec.contentY;
    if (proposal.scope_of_work) {
      y = addWrappedText(doc, proposal.scope_of_work, lx, y, ffw, FONT.SIZE_FIELD_VALUE);
      y += SPACING.MD;
    } else {
      doc.setFontSize(FONT.SIZE_TABLE_BODY);
      doc.setTextColor(...COLOR.TEXT_TERTIARY);
      doc.text('No scope of work provided.', lx, y);
      doc.setTextColor(...COLOR.TEXT_PRIMARY);
      y += SPACING.XL;
    }
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Pricing Summary ───────────────────────────────────────
  y = checkPageBreak(doc, y, 25);

  const totX = pageWidth - LAYOUT.PAGE_MARGIN - 60;
  const totVX = pageWidth - LAYOUT.PAGE_MARGIN;

  const totalValue = proposal.total_value ?? 0;

  // Estimated value box
  const balBoxX = totX - 8;
  const balBoxW = totVX - balBoxX + 3;
  const balBoxH = FONT.SIZE_BALANCE_DUE + 3;

  doc.setDrawColor(primaryRgb[0], primaryRgb[1], primaryRgb[2]);
  doc.setLineWidth(BORDER.SECTION_OUTER);
  doc.rect(balBoxX, y - 2, balBoxW, balBoxH);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT.SIZE_BALANCE_DUE);
  doc.setTextColor(primaryRgb[0], primaryRgb[1], primaryRgb[2]);
  const valTextY = y - 2 + (balBoxH + getCapHeight(FONT.SIZE_BALANCE_DUE)) / 2;
  doc.text('ESTIMATED VALUE:', totX, valTextY, { align: 'right' });
  doc.text(fmt(totalValue), totVX, valTextY, { align: 'right' });
  y += balBoxH + SPACING.LG;

  doc.setDrawColor(...COLOR.TEXT_PRIMARY);

  // ── Terms Section ─────────────────────────────────────────
  if (proposal.terms) {
    y = checkPageBreak(doc, y, 20);
    const sec = openAutoSection(doc, 'Terms & Conditions', y); y = sec.contentY;
    y = addWrappedText(doc, proposal.terms, lx, y, ffw, FONT.SIZE_FIELD_VALUE);
    y += SPACING.MD;
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Signature Block ───────────────────────────────────────
  y = checkPageBreak(doc, y, 30);

  { const sec = openAutoSection(doc, 'Authorization', y); y = sec.contentY;

    // Signature line
    const sigLineY = y + 10;
    doc.setDrawColor(...COLOR.BORDER_FIELD);
    doc.setLineWidth(BORDER.SIGNATURE_LINE);

    // Authorized by
    const sigW = ffw * 0.55;
    doc.line(lx, sigLineY, lx + sigW, sigLineY);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(FONT.SIZE_FIELD_LABEL);
    doc.setTextColor(...COLOR.TEXT_SECONDARY);
    doc.text('AUTHORIZED BY', lx, sigLineY + 3);

    // Date
    const dateLineX = lx + sigW + SPACING.LG;
    const dateLineW = ffw * 0.35;
    doc.line(dateLineX, sigLineY, dateLineX + dateLineW, sigLineY);
    doc.text('DATE', dateLineX, sigLineY + 3);

    doc.setTextColor(...COLOR.TEXT_PRIMARY);
    y = sigLineY + 8;
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Footer on all pages ───────────────────────────────────
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    addPageFooter(doc, p, totalPages);
    if (p > 1) {
      addConfidentialWatermark(doc);
    }
  }

  // ── Save ──────────────────────────────────────────────────
  const fileName = `PROPOSAL-${proposal.proposal_number || 'DRAFT'}.pdf`;
  doc.save(fileName);
}

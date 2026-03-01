// ============================================================
// RMPG Flex — Invoice PDF Generator (v3 — Design Token Remodel)
// Professional invoice layout using shared PDF helpers + tokens
// Embedded agency seal, box-grid fields, form identifiers
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
  addTableWithShading,
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
  getContentWidth, getHalfWidth, getFullFieldWidth,
  getLeftX, getRightColumnX, getHalfFieldWidth, getQuarterWidth,
} from './pdfTokens';

// ── Data interface ────────────────────────────────────────

interface InvoicePdfData {
  invoice_number: string;
  status: string;
  client_name?: string;
  client_address?: string;
  contact_name?: string;
  contact_email?: string;
  contact_phone?: string;
  client_code?: string;
  tax_id?: string;
  period_start: string;
  period_end: string;
  issue_date?: string;
  due_date?: string;
  payment_terms?: string;
  billing_email?: string;
  billing_address?: string;
  subtotal: number;
  discount_amount: number;
  tax_amount: number;
  late_fee_amount: number;
  total: number;
  amount_paid: number;
  balance_due: number;
  notes?: string;
  created_by_name?: string;
  line_items?: Array<{
    line_type: string;
    description: string;
    quantity: number;
    unit_price: number;
    amount: number;
  }>;
  payments?: Array<{
    payment_date: string;
    amount: number;
    payment_method?: string;
    reference_number?: string;
    recorded_by_name?: string;
  }>;
}

function fmt(n: number | null | undefined): string {
  if (n == null) return '$0.00';
  return `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── PDF Generation ────────────────────────────────────────

export async function generateInvoicePdf(data: InvoicePdfData): Promise<jsPDF> {
  const branding = await fetchPdfBranding();
  setActiveBranding(branding);
  await loadPdfAssets();
  setActiveFormKey('invoice');
  setActiveCaseNumber(data.invoice_number);
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

  // ── Watermark ────────────────────────────────────────
  addConfidentialWatermark(doc);

  // ── Header with seal (same as all reports) ───────────
  let y = addReportHeader(doc, data.invoice_number, 'Invoice', 'routine');

  // ── Invoice Information Section (auto-sizing) ─────────
  { const sec = openAutoSection(doc, 'Invoice Information', y); y = sec.contentY;
    const qw = getQuarterWidth(doc);
    addFieldPair(doc, 'Invoice Number', data.invoice_number, lx, y, qw);
    addFieldPair(doc, 'Status', (data.status || 'draft').toUpperCase(), lx + qw + SPACING.MD, y, qw);
    addFieldPair(doc, 'Issue Date', data.issue_date?.substring(0, 10) || '', lx + (qw + SPACING.MD) * 2, y, qw);
    y = addFieldPair(doc, 'Due Date', data.due_date?.substring(0, 10) || '', lx + (qw + SPACING.MD) * 3, y, qw);
    addFieldPair(doc, 'Payment Terms', data.payment_terms || 'Net 30', lx, y, hfw);
    y = addFieldPair(doc, 'Billing Period', `${data.period_start?.substring(0, 10) || ''} to ${data.period_end?.substring(0, 10) || ''}`, rx, y, hfw);
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // ── Client Information Section (auto-sizing) ──────────
  { const sec = openAutoSection(doc, 'Client / Bill To', y); y = sec.contentY;
    y = addFieldPair(doc, 'Client Name', data.client_name || '', lx, y, ffw);
    y = addFieldPair(doc, 'Billing Address', data.billing_address || data.client_address || '', lx, y, ffw);
    addFieldPair(doc, 'Contact', data.contact_name || '', lx, y, hfw);
    y = addFieldPair(doc, 'Email', data.billing_email || data.contact_email || '', rx, y, hfw);
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // ── Line Items Table ─────────────────────────────────
  {
    const sec = openAutoSection(doc, 'Line Items', y);
    y = sec.contentY;

    const items = data.line_items || [];
    if (items.length > 0) {
      // Custom table for line items (needs right-aligned columns)
      const headerBg = hexToRgb(brand.header_bg_color);

      // Table header
      const cols = [
        { label: 'DESCRIPTION', x: lx, w: cw - SPACING.CONTENT_INSET * 2 - 66 },
        { label: 'QTY', x: pageWidth - LAYOUT.PAGE_MARGIN - 70, w: 15 },
        { label: 'RATE', x: pageWidth - LAYOUT.PAGE_MARGIN - 50, w: 22 },
        { label: 'AMOUNT', x: pageWidth - LAYOUT.PAGE_MARGIN - 25, w: 25 },
      ];

      // Helper to draw column headers
      const drawItemHeaders = (atY: number): number => {
        doc.setFillColor(headerBg[0], headerBg[1], headerBg[2]);
        doc.rect(LAYOUT.PAGE_MARGIN + 1, atY - 3, cw - 2, 6, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(FONT.SIZE_FIELD_LABEL);
        doc.setTextColor(...COLOR.TEXT_INVERTED);
        cols.forEach(c => {
          const isRight = c.label !== 'DESCRIPTION';
          doc.text(c.label, isRight ? c.x + c.w : c.x, atY, { align: isRight ? 'right' : 'left' });
        });
        return atY + 5;
      };

      y = drawItemHeaders(y);

      // Data rows
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(FONT.SIZE_FIELD_VALUE);
      for (let i = 0; i < items.length; i++) {
        // Page break check — re-draw headers on new page
        const prevPage = doc.getNumberOfPages();
        y = checkPageBreak(doc, y, 8);
        if (doc.getNumberOfPages() > prevPage) {
          y = drawItemHeaders(y);
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(FONT.SIZE_FIELD_VALUE);
        }

        const item = items[i];

        // Dynamic row height for multi-line descriptions
        const descLines = doc.splitTextToSize(item.description, cols[0].w - 2);
        const rowHeight = Math.max(descLines.length * LAYOUT.LINE_HEIGHT, LAYOUT.LINE_HEIGHT) + 1;

        // Alternating shading with dynamic height
        if (i % 2 === 0) {
          doc.setFillColor(...COLOR.BG_ZEBRA);
          doc.rect(LAYOUT.PAGE_MARGIN + 1, y - 3, cw - 2, rowHeight, 'F');
        }

        doc.setTextColor(30, 30, 30);
        doc.text(descLines, cols[0].x, y);
        doc.text(String(item.quantity), cols[1].x + cols[1].w, y, { align: 'right' });
        doc.text(fmt(item.unit_price), cols[2].x + cols[2].w, y, { align: 'right' });

        // Unified credit/debit colors from tokens
        const amtColor: [number, number, number] = item.amount < 0 ? [...COLOR.AMOUNT_CREDIT] : [30, 30, 30];
        doc.setTextColor(amtColor[0], amtColor[1], amtColor[2]);
        doc.text(fmt(item.amount), cols[3].x + cols[3].w, y, { align: 'right' });
        doc.setTextColor(30, 30, 30);

        y += rowHeight;

        // Row separator
        doc.setDrawColor(...COLOR.BORDER_TABLE);
        doc.setLineWidth(BORDER.TABLE_ROW);
        doc.line(LAYOUT.PAGE_MARGIN + 1, y - 0.5, pageWidth - LAYOUT.PAGE_MARGIN - 1, y - 0.5);
      }

      // Outer table border
      doc.setDrawColor(...COLOR.BORDER_OUTER);
      doc.setLineWidth(BORDER.TABLE_OUTER);
      doc.rect(LAYOUT.PAGE_MARGIN + 1, sec.contentY - 3, cw - 2, y - sec.contentY + 4);
    } else {
      doc.setFontSize(FONT.SIZE_TABLE_BODY);
      doc.setTextColor(...COLOR.TEXT_TERTIARY);
      doc.text('No line items', lx, y);
      doc.setTextColor(...COLOR.TEXT_PRIMARY);
      y += SPACING.XL;
    }

    doc.setDrawColor(...COLOR.TEXT_PRIMARY);
    y += SPACING.MD;
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // ── Totals Section ───────────────────────────────────
  y = checkPageBreak(doc, y, 45);

  const totX = pageWidth - LAYOUT.PAGE_MARGIN - 60;
  const totVX = pageWidth - LAYOUT.PAGE_MARGIN;
  const addTotal = (label: string, value: string, bold = false, color?: readonly [number, number, number]) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(bold ? FONT.SIZE_TOTAL_LABEL : FONT.SIZE_FIELD_VALUE);
    doc.setTextColor(...COLOR.TEXT_SECONDARY);
    doc.text(label, totX, y, { align: 'right' });
    doc.setTextColor(color ? color[0] : 30, color ? color[1] : 30, color ? color[2] : 30);
    doc.text(value, totVX, y, { align: 'right' });
    y += bold ? 6 : LAYOUT.LINE_HEIGHT;
  };

  addTotal('Subtotal:', fmt(data.subtotal));
  if (data.discount_amount > 0) addTotal('Discount:', `-${fmt(data.discount_amount)}`, false, COLOR.AMOUNT_CREDIT);
  if (data.late_fee_amount > 0) addTotal('Late Fee:', fmt(data.late_fee_amount), false, COLOR.AMOUNT_DEBIT);

  doc.setDrawColor(...COLOR.BORDER_FIELD);
  doc.setLineWidth(BORDER.FIELD);
  doc.line(totX - 5, y - 1, totVX, y - 1);
  y += SPACING.SM;

  addTotal('TOTAL:', fmt(data.total), true);
  if (data.amount_paid > 0) addTotal('Amount Paid:', `-${fmt(data.amount_paid)}`, false, COLOR.AMOUNT_CREDIT);

  // Balance due box
  doc.setDrawColor(primaryRgb[0], primaryRgb[1], primaryRgb[2]);
  doc.setLineWidth(BORDER.SECTION_OUTER);
  const balBoxX = totX - 8;
  const balBoxW = totVX - balBoxX + 3;
  doc.rect(balBoxX, y - 2, balBoxW, 9);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT.SIZE_BALANCE_DUE);
  doc.setTextColor(primaryRgb[0], primaryRgb[1], primaryRgb[2]);
  doc.text('BALANCE DUE:', totX, y + 4, { align: 'right' });
  doc.text(fmt(data.balance_due), totVX, y + 4, { align: 'right' });
  y += 14;

  doc.setDrawColor(...COLOR.TEXT_PRIMARY);

  // ── Payments Section ─────────────────────────────────
  const payments = data.payments || [];
  if (payments.length > 0) {
    y = checkPageBreak(doc, y, 25);

    const sec = openAutoSection(doc, 'Payment History', y);
    y = sec.contentY;

    const payColPositions = [LAYOUT.PAGE_MARGIN + 3, LAYOUT.PAGE_MARGIN + 30, LAYOUT.PAGE_MARGIN + 60, LAYOUT.PAGE_MARGIN + 100];
    const payHeaders = [
      { label: 'DATE', x: payColPositions[0] },
      { label: 'AMOUNT', x: payColPositions[1] },
      { label: 'METHOD', x: payColPositions[2] },
      { label: 'REFERENCE', x: payColPositions[3] },
    ];
    const payRows = payments.map(p => [
      p.payment_date?.substring(0, 10) || '',
      fmt(p.amount),
      p.payment_method || '',
      p.reference_number || '',
    ]);
    y = addTableWithShading(doc, payHeaders, payRows, y, payColPositions);

    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // ── Notes Section ────────────────────────────────────
  if (data.notes) {
    y = checkPageBreak(doc, y, 20);
    const sec = openAutoSection(doc, 'Notes', y);
    y = sec.contentY;
    doc.setFont('helvetica', 'normal');
    y = addWrappedText(doc, data.notes, lx, y, ffw, 9);
    y += SPACING.MD;
    y = closeAutoSection(doc, sec.sectionY, y);
  }

  // ── Footer on all pages ──────────────────────────────
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    addPageFooter(doc, p, totalPages);
    if (p > 1) {
      addConfidentialWatermark(doc);
    }
  }

  return doc;
}

// ── Print-friendly HTML ───────────────────────────────────

export function generatePrintableInvoiceHtml(data: InvoicePdfData): string {
  const items = data.line_items || [];
  const payments = data.payments || [];

  const lineItemRows = items.map(item => `
    <tr>
      <td style="padding: 6px 8px; border-bottom: 1px solid #ddd; font-size: 11px;">${item.description}</td>
      <td style="padding: 6px 8px; border-bottom: 1px solid #ddd; text-align: right; font-size: 11px;">${item.quantity}</td>
      <td style="padding: 6px 8px; border-bottom: 1px solid #ddd; text-align: right; font-size: 11px;">${fmt(item.unit_price)}</td>
      <td style="padding: 6px 8px; border-bottom: 1px solid #ddd; text-align: right; font-size: 11px; font-weight: bold; ${item.amount < 0 ? 'color: #00783c;' : ''}">${fmt(item.amount)}</td>
    </tr>
  `).join('');

  const paymentRows = payments.map(p => `
    <tr>
      <td style="padding: 4px 8px; font-size: 11px; border-bottom: 1px solid #eee;">${p.payment_date?.substring(0, 10) || ''}</td>
      <td style="padding: 4px 8px; font-size: 11px; color: #00783c; font-weight: bold; border-bottom: 1px solid #eee;">${fmt(p.amount)}</td>
      <td style="padding: 4px 8px; font-size: 11px; text-transform: uppercase; border-bottom: 1px solid #eee;">${p.payment_method || ''}</td>
      <td style="padding: 4px 8px; font-size: 11px; border-bottom: 1px solid #eee;">${p.reference_number || ''}</td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Invoice ${data.invoice_number}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #333; background: #fff; padding: 30px; max-width: 800px; margin: 0 auto; }
    @media print { body { padding: 0; } }
    .header { background: #303030; color: #fff; padding: 16px 20px; margin-bottom: 0; display: flex; align-items: center; gap: 14px; }
    .header img { width: 42px; height: 42px; border-radius: 50%; }
    .header-text h1 { font-size: 16px; margin-bottom: 1px; letter-spacing: 1px; }
    .header-text p { font-size: 10px; color: #d4a017; letter-spacing: 2px; text-transform: uppercase; }
    .accent-line { height: 3px; background: #d4a017; margin-bottom: 16px; }
    .section-bar { background: #303030; color: #fff; padding: 4px 10px; font-size: 10px; font-weight: bold; letter-spacing: 1px; text-transform: uppercase; margin-top: 16px; border: 2px solid #303030; }
    .section-body { border: 1px solid #ccc; border-top: none; padding: 12px; margin-bottom: 0; }
    .field-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px; }
    .field-box { border: 1px solid #ccc; padding: 4px 6px; min-height: 32px; }
    .field-box .label { font-size: 8px; text-transform: uppercase; color: #888; letter-spacing: 0.5px; }
    .field-box .value { font-size: 12px; color: #222; margin-top: 2px; }
    .invoice-title { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; }
    .invoice-title h2 { font-size: 24px; color: #bc1010; font-weight: 900; }
    .invoice-number { background: #bc1010; color: #fff; padding: 6px 16px; font-size: 13px; font-weight: bold; border: 2px solid #fff; outline: 2px solid #bc1010; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 0; }
    th { background: #303030; color: #fff; padding: 6px 8px; text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; }
    .totals { margin-left: auto; width: 280px; margin-top: 12px; }
    .totals tr td { padding: 3px 8px; font-size: 12px; }
    .totals .total-row { border-top: 2px solid #333; font-size: 14px; font-weight: bold; }
    .totals .balance-row { border: 2px solid #bc1010; font-size: 16px; font-weight: bold; color: #bc1010; }
    .notes { margin-top: 16px; padding: 12px; background: #f9f9f9; border: 1px solid #ccc; }
    .notes h3 { font-size: 9px; text-transform: uppercase; color: #888; margin-bottom: 6px; letter-spacing: 1px; }
    .notes p { font-size: 11px; }
    .footer { margin-top: 24px; padding-top: 8px; border-top: 2px solid #d4a017; font-size: 9px; color: #999; text-align: center; }
    .footer .form-num { font-weight: bold; color: #666; }
  </style>
</head>
<body>
  <div class="header">
    <img src="/rmpg-seal.png" alt="RMPG Seal" onerror="this.style.display='none'" />
    <div class="header-text">
      <h1>RMPG SECURITY SERVICES</h1>
      <p>Private Security</p>
    </div>
  </div>
  <div class="accent-line"></div>

  <div class="invoice-title">
    <h2>INVOICE</h2>
    <span class="invoice-number">${data.invoice_number}</span>
  </div>

  <div class="section-bar">SECTION 1 &mdash; INVOICE INFORMATION</div>
  <div class="section-body">
    <div class="field-grid">
      <div class="field-box"><div class="label">Invoice #</div><div class="value">${data.invoice_number}</div></div>
      <div class="field-box"><div class="label">Status</div><div class="value">${(data.status || 'draft').toUpperCase()}</div></div>
      <div class="field-box"><div class="label">Issue Date</div><div class="value">${data.issue_date?.substring(0, 10) || '&mdash;'}</div></div>
      <div class="field-box"><div class="label">Due Date</div><div class="value">${data.due_date?.substring(0, 10) || '&mdash;'}</div></div>
      <div class="field-box"><div class="label">Terms</div><div class="value">${data.payment_terms || 'Net 30'}</div></div>
      <div class="field-box"><div class="label">Period</div><div class="value">${data.period_start?.substring(0, 10)} to ${data.period_end?.substring(0, 10)}</div></div>
    </div>
  </div>

  <div class="section-bar">SECTION 2 &mdash; CLIENT / BILL TO</div>
  <div class="section-body">
    <div class="field-grid">
      <div class="field-box" style="grid-column: span 2;"><div class="label">Client Name</div><div class="value">${data.client_name || 'Client'}</div></div>
      <div class="field-box" style="grid-column: span 2;"><div class="label">Billing Address</div><div class="value">${data.billing_address || data.client_address || ''}</div></div>
      <div class="field-box"><div class="label">Contact</div><div class="value">${data.contact_name || ''}</div></div>
      <div class="field-box"><div class="label">Email</div><div class="value">${data.billing_email || data.contact_email || ''}</div></div>
    </div>
  </div>

  <div class="section-bar">SECTION 3 &mdash; LINE ITEMS</div>
  <div class="section-body" style="padding: 0;">
    <table>
      <thead>
        <tr>
          <th style="width: 55%;">Description</th>
          <th style="text-align: right; width: 10%;">Qty</th>
          <th style="text-align: right; width: 15%;">Rate</th>
          <th style="text-align: right; width: 20%;">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${lineItemRows || '<tr><td colspan="4" style="text-align: center; padding: 20px; color: #999;">No line items</td></tr>'}
      </tbody>
    </table>
  </div>

  <table class="totals">
    <tr><td style="text-align: right; color: #888;">Subtotal:</td><td style="text-align: right;">${fmt(data.subtotal)}</td></tr>
    ${data.discount_amount > 0 ? `<tr><td style="text-align: right; color: #00783c;">Discount:</td><td style="text-align: right; color: #00783c;">-${fmt(data.discount_amount)}</td></tr>` : ''}
    ${data.late_fee_amount > 0 ? `<tr><td style="text-align: right; color: #b40000;">Late Fee:</td><td style="text-align: right; color: #b40000;">${fmt(data.late_fee_amount)}</td></tr>` : ''}
    <tr class="total-row"><td style="text-align: right;">Total:</td><td style="text-align: right;">${fmt(data.total)}</td></tr>
    ${data.amount_paid > 0 ? `<tr><td style="text-align: right; color: #00783c;">Paid:</td><td style="text-align: right; color: #00783c;">-${fmt(data.amount_paid)}</td></tr>` : ''}
    <tr class="balance-row"><td style="text-align: right;">Balance Due:</td><td style="text-align: right;">${fmt(data.balance_due)}</td></tr>
  </table>

  ${payments.length > 0 ? `
    <div class="section-bar">SECTION 4 &mdash; PAYMENT HISTORY</div>
    <div class="section-body" style="padding: 0;">
      <table>
        <thead><tr><th>Date</th><th>Amount</th><th>Method</th><th>Reference</th></tr></thead>
        <tbody>${paymentRows}</tbody>
      </table>
    </div>
  ` : ''}

  ${data.notes ? `
    <div class="section-bar">NOTES</div>
    <div class="section-body"><p style="font-size: 11px;">${data.notes}</p></div>
  ` : ''}

  <div class="footer">
    <span class="form-num">FORM PS-301 | Rev. 2026-03</span> &mdash;
    LAW ENFORCEMENT SENSITIVE &mdash; CONFIDENTIAL<br />
    Generated on ${new Date().toLocaleString()} &mdash; ${data.invoice_number}
  </div>
</body>
</html>`;
}

/** Generate invoice PDF and return a blob URL for in-app preview */
export async function generateInvoicePdfBlobUrl(data: InvoicePdfData): Promise<string> {
  const doc = await generateInvoicePdf(data);
  const blob = doc.output('blob');
  return URL.createObjectURL(blob);
}

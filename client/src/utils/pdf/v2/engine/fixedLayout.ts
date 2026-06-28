// ============================================================
// fixedLayout — render a section whose fields are positioned by
// absolute (x, y, w, h) coordinates rather than the flowing
// sectioned layout. Used for forms that must replicate a real-world
// template (Utah Uniform Citation, Utah Traffic Crash Report).
// ============================================================
//
// Coordinate system:
//   The section's origin is (layout.leftX, layout.cursorY) at the
//   moment renderFixedLayoutSection runs. All FixedField (x, y) are
//   relative to that origin. After rendering, the layout cursor
//   advances by section.height — so a flowing section AFTER a
//   fixed-layout section continues correctly below it.
//
// Page management:
//   Fixed-layout is single-page. If the section's declared height
//   exceeds the remaining page space, we issue ONE pageBreakIfNeeded
//   so the whole section starts fresh on the next page. We do NOT
//   try to split a fixed-layout section across pages — that defeats
//   the point of fixed coordinates.

import type jsPDF from 'jspdf';
import type { LayoutEngine } from './layout';
import type { FixedLayoutSection, FixedField } from './types';
import { TYPOGRAPHY, RULE_WEIGHTS } from './style';

function valueAsString(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  if (typeof raw === 'boolean') return raw ? 'Yes' : 'No';
  return String(raw);
}

function setFont(doc: jsPDF, sizePt: number, bold: boolean): void {
  doc.setFont('helvetica', bold ? 'bold' : 'normal');
  doc.setFontSize(sizePt);
  doc.setTextColor(0, 0, 0);
}

function drawText<T>(
  doc: jsPDF, field: FixedField<T>, originX: number, originY: number, text: string,
): void {
  const x = originX + field.x;
  const y = originY + field.y;
  // Vertical centering in the field's box: place the text baseline at h - 1.5mm
  // (a small bottom padding so descenders don't graze the underline).
  const baselineY = y + field.h - 1.5;
  setFont(doc, field.fontSize ?? TYPOGRAPHY.fieldValue.size, !!field.bold);
  const truncated = doc.splitTextToSize(text, field.w - 1)[0] ?? text;
  const textX = field.align === 'center'
    ? x + field.w / 2
    : field.align === 'right'
    ? x + field.w - 1
    : x + 0.5;
  doc.text(truncated, textX, baselineY, { align: field.align ?? 'left' });
}

function drawCheckbox<T>(
  doc: jsPDF, field: FixedField<T>, originX: number, originY: number, checked: boolean,
): void {
  const x = originX + field.x;
  const y = originY + field.y;
  // Box is a 2.8mm square sitting at (x, y); label (if any) follows to the right.
  const boxSize = Math.min(2.8, field.h);
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.25);
  doc.rect(x, y, boxSize, boxSize);
  if (checked) {
    setFont(doc, field.fontSize ?? 8, true);
    doc.text('X', x + 0.5, y + boxSize - 0.5);
  }
  if (field.label) {
    setFont(doc, field.fontSize ?? TYPOGRAPHY.fieldLabel.size, false);
    doc.text(field.label, x + boxSize + 1.2, y + boxSize - 0.5);
  }
}

function drawUnderline<T>(
  doc: jsPDF, field: FixedField<T>, originX: number, originY: number, text: string,
): void {
  const x = originX + field.x;
  const y = originY + field.y;
  // Label (small caps, 6.5pt, 100/100/100 gray) above the line, value below.
  const labelHeight = field.label ? 2.4 : 0;
  if (field.label) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(80, 80, 80);
    doc.text(field.label.toUpperCase(), x + 0.5, y + 2.2);
  }
  // Value goes between label-end and field-bottom-minus-1.5 (for the underline).
  if (text) {
    setFont(doc, field.fontSize ?? TYPOGRAPHY.fieldValue.size, !!field.bold);
    const truncated = doc.splitTextToSize(text, field.w - 1)[0] ?? text;
    const textX = field.align === 'center'
      ? x + field.w / 2
      : field.align === 'right'
      ? x + field.w - 1
      : x + 0.5;
    doc.text(truncated, textX, y + field.h - 2.5, { align: field.align ?? 'left' });
  }
  // The form-fill line at field bottom.
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(RULE_WEIGHTS.fieldUnderline);
  doc.line(x, y + field.h - 1, x + field.w, y + field.h - 1);
  // Silence TypeScript on the unused labelHeight var — kept for future bottom-padding tweaks.
  void labelHeight;
}

function drawBox<T>(
  doc: jsPDF, field: FixedField<T>, originX: number, originY: number, text: string,
): void {
  const x = originX + field.x;
  const y = originY + field.y;
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.25);
  doc.rect(x, y, field.w, field.h);
  if (field.label) {
    // Label rendered top-left INSIDE the box (small uppercase, gray).
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6);
    doc.setTextColor(80, 80, 80);
    doc.text(field.label.toUpperCase(), x + 0.6, y + 2.1);
  }
  if (text) {
    setFont(doc, field.fontSize ?? TYPOGRAPHY.fieldValue.size, !!field.bold);
    const truncated = doc.splitTextToSize(text, field.w - 1.2)[0] ?? text;
    const textX = field.align === 'center'
      ? x + field.w / 2
      : field.align === 'right'
      ? x + field.w - 1
      : x + 0.8;
    const textY = field.label ? y + field.h - 1.5 : y + field.h - 1.5;
    doc.text(truncated, textX, textY, { align: field.align ?? 'left' });
  }
}

function drawSignatureField<T>(
  doc: jsPDF, field: FixedField<T>, originX: number, originY: number,
  value: string | { image?: string } | boolean | null | undefined,
): void {
  const x = originX + field.x;
  const y = originY + field.y;
  // Underline at bottom (where the signature sits visually).
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(RULE_WEIGHTS.fieldUnderline);
  doc.line(x, y + field.h - 1, x + field.w, y + field.h - 1);
  // 'X' marker at the bottom-left tells the signer where to put pen.
  setFont(doc, 9, true);
  doc.text('X', x + 0.5, y + field.h - 1.5);
  // Label (small) above the line.
  if (field.label) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(80, 80, 80);
    doc.text(field.label.toUpperCase(), x + 0.5, y + 2.2);
  }
  // Render the signature PNG inside the box if provided.
  if (value && typeof value === 'object' && 'image' in value && typeof value.image === 'string'
      && value.image.startsWith('data:image/')) {
    try {
      doc.addImage(value.image, 'PNG', x + 3.5, y + 2.5, field.w - 4, field.h - 4.5);
    } catch {
      /* ignore malformed image */
    }
  }
}

function drawLine<T>(doc: jsPDF, field: FixedField<T>, originX: number, originY: number): void {
  const x = originX + field.x;
  const y = originY + field.y;
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(RULE_WEIGHTS.sectionRule);
  doc.line(x, y, x + field.w, y + field.h);
}

function drawRect<T>(doc: jsPDF, field: FixedField<T>, originX: number, originY: number): void {
  const x = originX + field.x;
  const y = originY + field.y;
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(field.bold ? RULE_WEIGHTS.headerThick : RULE_WEIGHTS.sectionRule);
  doc.rect(x, y, field.w, field.h);
}

function drawLabel<T>(doc: jsPDF, field: FixedField<T>, originX: number, originY: number): void {
  const x = originX + field.x;
  const y = originY + field.y;
  if (!field.label) return;
  setFont(doc, field.fontSize ?? TYPOGRAPHY.fieldLabel.size, !!field.bold);
  const truncated = doc.splitTextToSize(field.label, field.w - 0.5)[0] ?? field.label;
  const textX = field.align === 'center'
    ? x + field.w / 2
    : field.align === 'right'
    ? x + field.w - 0.5
    : x + 0.5;
  doc.text(truncated, textX, y + field.h - 1.5, { align: field.align ?? 'left' });
}

function drawBarcode<T>(
  doc: jsPDF, field: FixedField<T>, originX: number, originY: number, text: string,
): void {
  // Simple Code128-style barcode approximation. Each character gets a
  // pattern of vertical bars at deterministic widths. This is not a real
  // Code128 implementation — it's a visual cue that mimics a barcode for
  // print + court intake; scanners reading the actual citation number
  // should rely on the human-readable text. A real barcode lib can swap
  // in here later without changing callers.
  if (!text) return;
  const x = originX + field.x;
  const y = originY + field.y;
  const barH = field.h - 2.5;        // leave ~2.5mm for the readable text below
  const usableW = field.w;
  // Quiet zone: 1mm at each side.
  const innerW = usableW - 2;
  const charCount = text.length || 1;
  // 6 bars per character, widths cycling through [0.3, 0.5, 0.2] mm — gives
  // a believable barcode density at typical citation widths.
  const barsPerChar = 6;
  const totalBars = charCount * barsPerChar;
  const barWidth = innerW / totalBars;
  doc.setFillColor(0, 0, 0);
  for (let i = 0; i < totalBars; i++) {
    const c = text.charCodeAt(Math.floor(i / barsPerChar)) ?? 32;
    // Bit-pattern-derived bar: draw when (c >> (i % 6)) & 1.
    if ((c >> (i % barsPerChar)) & 1) {
      doc.rect(x + 1 + i * barWidth, y, barWidth * 0.9, barH, 'F');
    }
  }
  // Human-readable text below the barcode.
  setFont(doc, 7, false);
  doc.text(text, x + usableW / 2, y + field.h - 0.5, { align: 'center' });
}

export function renderFixedLayoutSection<T>(
  doc: jsPDF,
  layout: LayoutEngine,
  section: FixedLayoutSection<T>,
  data: T,
): void {
  // Page-break before rendering if the whole section won't fit on the
  // current page. We never split a fixed-layout section.
  layout.pageBreakIfNeeded(section.height);
  const originX = layout.leftX;
  const originY = layout.cursorY;

  for (const field of section.fields) {
    if (field.visibleIf && !field.visibleIf(data)) continue;
    const raw = field.accessor ? field.accessor(data) : undefined;
    const text = typeof raw === 'string'
      ? raw
      : typeof raw === 'boolean'
      ? raw ? 'Yes' : 'No'
      : valueAsString(raw);
    switch (field.style) {
      case 'text':       drawText(doc, field, originX, originY, text); break;
      case 'box':        drawBox(doc, field, originX, originY, text); break;
      case 'underline':  drawUnderline(doc, field, originX, originY, text); break;
      case 'checkbox':   drawCheckbox(doc, field, originX, originY, !!raw); break;
      case 'signature':  drawSignatureField(doc, field, originX, originY, raw as any); break;
      case 'barcode':    drawBarcode(doc, field, originX, originY, text); break;
      case 'line':       drawLine(doc, field, originX, originY); break;
      case 'rect':       drawRect(doc, field, originX, originY); break;
      case 'label':      drawLabel(doc, field, originX, originY); break;
    }
  }

  layout.advance(section.height);
}

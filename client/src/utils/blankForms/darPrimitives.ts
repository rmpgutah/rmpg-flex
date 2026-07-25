// ============================================================
// RMPG Flex — Shared drawing primitives for the PS-106 field-form family
// (Daily Activity / Shift Report + the vehicle movement sheets A..E).
//
// Extracted from blankFormGenerator.ts when the vehicle movement sheets were
// added. The whole family shares one visual language — 8mm log rows sized for
// handwriting, 5mm field write-space, write-on rules DRAWN rather than typed
// as underscores (sanitizePdfText strips `_`), and a per-page identity strip
// so a separated sheet is never orphaned. One module is what keeps six forms
// from drifting apart.
//
// Separate module rather than living in blankFormGenerator.ts so the form
// modules can import these without an import cycle: blankFormGenerator imports
// the form generators, and the generators import these primitives.
// ============================================================

import jsPDF from 'jspdf';
import {
  COLOR, FONT, BORDER, LAYOUT, PDF_VALUE_FONT,
  getLeftX, getFullFieldWidth,
} from '../pdfTokens';
import { addCheckboxField, sanitizePdfText } from '../pdfGenerator';

/** Thin "whose sheet is this" strip for DAR pages 2+.
 *  Write-on rules are DRAWN, not typed as underscores — sanitizePdfText strips
 *  `_`, which silently collapsed an earlier underscore-based version into an
 *  unreadable run of labels ("OFFICER BADGE SHIFT DATE UNIT #"). */
export function addDarContinuationStrip(doc: jsPDF, formCode: string, page: number, total: number): void {
  const lx = getLeftX();
  const ffw = getFullFieldWidth(doc);
  const y = 11.5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT.SIZE_FIELD_LABEL);
  doc.setTextColor(...COLOR.TEXT_SECONDARY);
  doc.setDrawColor(...COLOR.BORDER_TABLE);
  doc.setLineWidth(BORDER.TABLE_ROW);

  doc.text(sanitizePdfText(formCode), lx, y);
  let x = lx + doc.getTextWidth(sanitizePdfText(formCode)) + 6;
  for (const [label, ruleW] of [['OFFICER', 38], ['BADGE', 16], ['SHIFT DATE', 24], ['UNIT #', 16]] as [string, number][]) {
    doc.text(label, x, y);
    const lw = doc.getTextWidth(label) + 2;
    doc.line(x + lw, y + 0.6, x + lw + ruleW, y + 0.6);
    x += lw + ruleW + 5;
  }
  doc.text(`PAGE ${page} OF ${total}`, lx + ffw, y, { align: 'right' });
  doc.line(lx, y + 2.6, lx + ffw, y + 2.6);
}

export function blankField(doc: jsPDF, label: string, x: number, y: number, w: number): number {
  const lineY = y + 5.5;
  // Label
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT.SIZE_FIELD_LABEL);
  doc.setTextColor(...COLOR.TEXT_SECONDARY);
  doc.text(label.toUpperCase(), x + 0.5, y + 2);
  // Underline for writing
  doc.setDrawColor(...COLOR.BORDER_TABLE);
  doc.setLineWidth(BORDER.TABLE_ROW);
  doc.line(x, lineY, x + w, lineY);
  return lineY + 2;
}

export function blankCheckbox(doc: jsPDF, label: string, x: number, y: number): number {
  return addCheckboxField(doc, label, false, x, y);
}

export const DAR_ROW_H = 8;        // log-table row height — sized for handwriting

export const DAR_FIELD_H = 9;      // labelled write-in field pitch

export const DAR_LINE_H = 7.5;     // narrative rule spacing

/** Page break if `need` mm won't fit above the footer zone. Safety net used
 *  inside the grid helpers; the DAR body itself uses deliberate page breaks. */
export function ensureRoom(doc: jsPDF, y: number, need: number): number {
  if (y + need > 248) { doc.addPage(); return LAYOUT.PAGE_MARGIN + 5; }
  return y;
}

/** Start a new page unconditionally.
 *
 *  The DAR assigns sections to pages by design instead of letting `ensureRoom`
 *  decide. With ~230mm indivisible blocks (the CFS grid) in the sequence,
 *  fit-if-you-can packing strands whatever small section precedes them: an
 *  earlier revision produced a page holding nothing but the 4-row Breaks table
 *  because the CFS grid behind it needed a full page. Deliberate breaks + each
 *  page's content sized to fill it is both denser and predictable. */
export function darPageBreak(doc: jsPDF): number {
  doc.addPage();
  return LAYOUT.PAGE_MARGIN + 5;
}

/** Labelled write-in field with a taller pen gap than `blankField`. */
export function darField(doc: jsPDF, label: string, x: number, y: number, w: number): number {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT.SIZE_FIELD_LABEL);
  doc.setTextColor(...COLOR.TEXT_SECONDARY);
  doc.text(sanitizePdfText(label).toUpperCase(), x + 0.5, y + 2);
  doc.setDrawColor(...COLOR.BORDER_TABLE);
  doc.setLineWidth(BORDER.TABLE_ROW);
  doc.line(x, y + 7, x + w, y + 7);
  return y + DAR_FIELD_H;
}

/** Row of `n` equal-width darFields. Returns the y below the row. */
export function darFieldRow(doc: jsPDF, lx: number, y: number, ffw: number, labels: string[]): number {
  const w = ffw / labels.length;
  labels.forEach((l, i) => darField(doc, l, lx + i * w, y, w - 2));
  return y + DAR_FIELD_H;
}

/** Small bold band used to separate phases inside a section. */
export function darBand(doc: jsPDF, label: string, lx: number, y: number): number {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT.SIZE_FIELD_LABEL);
  doc.setTextColor(...COLOR.TEXT_SECONDARY);
  doc.text(sanitizePdfText(label).toUpperCase(), lx + 0.5, y + 2.5);
  return y + 4;
}

/** Legend/help text under a log grid. */
export function darLegend(doc: jsPDF, lx: number, y: number, lines: string[]): number {
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(FONT.SIZE_SIGNATURE_LABEL);
  doc.setTextColor(...COLOR.TEXT_SECONDARY);
  lines.forEach((t, i) => doc.text(sanitizePdfText(t), lx, y + 3 + i * 3.2));
  return y + 3 + lines.length * 3.2;
}

/** Ruled writing area. */
export function darLines(doc: jsPDF, lx: number, y: number, ffw: number, count: number): number {
  doc.setDrawColor(...COLOR.BORDER_TABLE);
  doc.setLineWidth(BORDER.TABLE_ROW);
  for (let i = 0; i < count; i++) {
    doc.line(lx, y + DAR_LINE_H - 1, lx + ffw, y + DAR_LINE_H - 1);
    y += DAR_LINE_H;
  }
  return y;
}

/** Pre/post-trip inspection grid: each item gets an OK box and a DEFECT box.
 *  A single "inspection passed" checkbox records nothing useful when a vehicle
 *  is later found damaged; per-item OK/DEF is what makes the sheet evidence of
 *  what was actually looked at, and pairs the two ends of the shift so a new
 *  defect can be pinned to this officer's watch or ruled out. */
export function darInspectionGrid(doc: jsPDF, lx: number, y: number, ffw: number, items: string[], perRow = 4): number {
  const colW = ffw / perRow;
  const rowH = 5.6;
  const rows = Math.ceil(items.length / perRow);
  y = ensureRoom(doc, y, rows * rowH + 8);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT.SIZE_SIGNATURE_LABEL);
  doc.setTextColor(...COLOR.TEXT_SECONDARY);
  for (let c = 0; c < perRow; c++) {
    doc.text('OK', lx + c * colW + colW - 12.5, y + 1);
    doc.text('DEF', lx + c * colW + colW - 6, y + 1);
  }
  y += 2.5;

  items.forEach((item, i) => {
    const c = i % perRow;
    const r = Math.floor(i / perRow);
    const x = lx + c * colW;
    const yy = y + r * rowH;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...COLOR.TEXT_PRIMARY);
    doc.text(sanitizePdfText(item).toUpperCase(), x + 0.5, yy + 3);
    doc.setDrawColor(...COLOR.BORDER_TABLE);
    doc.setLineWidth(0.3);
    doc.rect(x + colW - 13, yy, 3.4, 3.4);
    doc.rect(x + colW - 6.5, yy, 3.4, 3.4);
  });
  return y + rows * rowH + 2;
}

/** Three boxed values with the operators printed between them, e.g.
 *  `IN - OUT = TOTAL`. A plain underline invites a guessed number; boxes with
 *  a visible operation make the arithmetic self-checking on review. */
export function darMathRow(
  doc: jsPDF, lx: number, y: number, ffw: number,
  labels: [string, string, string], ops: [string, string] = ['-', '='],
): number {
  const boxW = (ffw - 30) / 3;
  const boxH = 11;
  let x = lx;
  labels.forEach((label, i) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(FONT.SIZE_FIELD_LABEL);
    doc.setTextColor(...COLOR.TEXT_SECONDARY);
    doc.text(sanitizePdfText(label).toUpperCase(), x + 0.5, y + 2.5);
    doc.setDrawColor(...COLOR.TEXT_PRIMARY);
    doc.setLineWidth(i === 2 ? BORDER.SIGNATURE_LINE : BORDER.TABLE_ROW);
    doc.rect(x, y + 3.5, boxW, boxH);
    if (i < 2) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.setTextColor(...COLOR.TEXT_PRIMARY);
      doc.text(ops[i], x + boxW + 6, y + 11);
    }
    x += boxW + 15;
  });
  return y + boxH + 6;
}

/** The shift-mileage case of darMathRow: odometer IN - OUT = TOTAL MILES. */
export function darMileageMath(doc: jsPDF, lx: number, y: number, ffw: number): number {
  return darMathRow(doc, lx, y, ffw,
    ['Odometer IN (end)', 'Odometer OUT (start)', 'TOTAL MILES DRIVEN']);
}

/** Grid of small labelled write-in boxes for numeric shift tallies. */
export function blankTallyGrid(
  doc: jsPDF, lx: number, y: number, tw: number, labels: string[], perRow: number,
): number {
  const colW = tw / perRow;
  const boxW = colW - 2;
  const boxH = 8;
  const rowH = boxH + 6;
  const rows = Math.ceil(labels.length / perRow);
  y = ensureRoom(doc, y, rows * rowH + 2);
  labels.forEach((label, i) => {
    const col = i % perRow;
    const row = Math.floor(i / perRow);
    const x = lx + col * colW;
    const boxY = y + row * rowH;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(FONT.SIZE_FIELD_LABEL);
    doc.setTextColor(...COLOR.TEXT_SECONDARY);
    doc.text(sanitizePdfText(label).toUpperCase(), x + 0.5, boxY + 2.5);
    doc.setDrawColor(...COLOR.BORDER_TABLE);
    doc.setLineWidth(BORDER.TABLE_ROW);
    doc.rect(x, boxY + 3.5, boxW, boxH);
  });
  return y + rows * rowH + 1;
}

/** The 18 points inspected at both ends of a shift. Same list both times so the
 *  two grids can be read side by side. */
export const DAR_INSPECTION_ITEMS = [
  'Headlights / tail', 'Turn signals', 'Brake lights', 'Emergency lightbar',
  'Siren / PA', 'Horn', 'Brakes', 'Tires / pressure',
  'Wipers / washer', 'Mirrors', 'Windshield / glass', 'Seat belts',
  'Fluids / oil / coolant', 'Battery / charging', 'Body / paint damage', 'Interior condition',
  'Dashcam / ALPR', 'Spare / jack / tools',
];

/** Draw a multi-column log grid: zebra header + N empty body rows with column
 *  separators and an outer border. `cols` fracs should sum to ~1. Adds a page
 *  break first if the whole grid won't fit. Returns the y below the grid. */
export function blankLogTable(
  doc: jsPDF, lx: number, y: number, tw: number,
  cols: { label: string; frac: number }[], rows: number, rowH = 6,
): number {
  const headH = 5;
  if (y + headH + rows * rowH > 248) { doc.addPage(); y = LAYOUT.PAGE_MARGIN + 5; }
  const xs: number[] = []; let acc = 0;
  for (const c of cols) { xs.push(lx + acc * tw); acc += c.frac; }
  doc.setFillColor(...COLOR.BG_ZEBRA);
  doc.rect(lx, y, tw, headH, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(FONT.SIZE_FIELD_LABEL); doc.setTextColor(...COLOR.TEXT_SECONDARY);
  cols.forEach((c, i) => doc.text(c.label.toUpperCase(), xs[i] + 1.5, y + 3.3));
  doc.setDrawColor(...COLOR.BORDER_TABLE); doc.setLineWidth(BORDER.TABLE_ROW);
  const top = y;
  doc.line(lx, y + headH, lx + tw, y + headH);
  y += headH;
  for (let r = 0; r < rows; r++) { y += rowH; doc.line(lx, y, lx + tw, y); }
  for (let i = 1; i < cols.length; i++) doc.line(xs[i], top, xs[i], y);
  doc.line(lx, top, lx, y);
  doc.line(lx + tw, top, lx + tw, y);
  return y + 2;
}

/** Width `addCheckboxField` will consume for `label` (box + gap + text + trail).
 *  Mirrors the arithmetic in pdfGenerator.addCheckboxField's return value. */
export function checkboxWidth(doc: jsPDF, label: string): number {
  doc.setFont(PDF_VALUE_FONT, 'normal');
  doc.setFontSize(FONT.SIZE_FIELD_VALUE);
  return 3.2 + 1.5 + doc.getTextWidth(sanitizePdfText(label).toUpperCase()) + 3;
}

/** Draw a horizontal row of empty checkboxes, wrapping at the right margin.
 *  Measures BEFORE drawing: addCheckboxField paints on call, so deciding to
 *  wrap from its return value leaves a ghost copy of the label on the line
 *  above (the bug this replaced). */
export function blankCheckboxRow(doc: jsPDF, labels: string[], lx: number, y: number, maxX: number): number {
  let x = lx;
  for (const label of labels) {
    if (x > lx && x + checkboxWidth(doc, label) > maxX) { y += 6; x = lx; }
    x = blankCheckbox(doc, label, x, y);
  }
  return y + 6;
}

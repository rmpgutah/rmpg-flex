import type jsPDF from 'jspdf';
import type { LayoutEngine } from './layout';
import type {
  LabeledField, CheckboxField, NarrativeField, TableField, SignatureField, Width,
} from './types';
import { TYPOGRAPHY, RULE_WEIGHTS, SPACING } from './style';

// Font sizes are always in points regardless of doc unit.
const LABEL_FONT_SIZE = 7;
const VALUE_FONT_SIZE = 9;

// The rest are in the doc's native unit (mm for the renderer, pt for direct
// primitives tests — numeric thresholds in tests are tuned to either).
export const ROW_HEIGHT = 7;          // row height (mm) for labeled fields
const CHECKBOX_SIZE = 3;              // checkbox square side (mm)
const CHECKBOX_GAP = 38;              // horizontal gap between checkbox items (mm)
const NARRATIVE_LABEL_H = 4;
const NARRATIVE_LINE_H = 4;
const TABLE_ROW_H = 5;
const TABLE_HDR_H = 5;
const SIG_BLOCK_H = 22;
const SIG_WIDTH = 70;

function formatValue(raw: unknown): string {
  if (raw === null || raw === undefined || raw === '') return '—';
  if (typeof raw === 'boolean') return raw ? 'Yes' : 'No';
  if (raw instanceof Date) return raw.toISOString().split('T')[0];
  return String(raw);
}

function widthUnits(w: Width): number {
  switch (w) {
    case 'quarter': return 1;
    case 'third':   return 2;
    case 'half':    return 3;
    case 'full':    return 6;
  }
}

export class Primitives {
  constructor(private readonly doc: jsPDF, private readonly layout: LayoutEngine) {}

  /**
   * Draw a label + value cell. If `xOverride`/`widthOverride` are supplied,
   * the cell is drawn at that horizontal position/width WITHOUT advancing the
   * cursor — the caller (renderRow) is responsible for advancing once per row.
   * If omitted, draws full-width at the layout's leftX and advances ROW_HEIGHT.
   */
  labeledField<T>(spec: LabeledField<T>, data: T, xOverride?: number, widthOverride?: number): void {
    const positioned = xOverride !== undefined;
    if (!positioned) this.layout.pageBreakIfNeeded(SPACING.fieldRowHeight);
    const x = xOverride ?? this.layout.leftX;
    const width = widthOverride ?? (this.layout.rightX - this.layout.leftX);
    const y = this.layout.cursorY;
    const value = formatValue(spec.accessor(data));

    // Label — UPPERCASE BOLD on its own line (Spillman/Motorola convention).
    this.doc.setFont('helvetica', TYPOGRAPHY.fieldLabel.weight);
    this.doc.setFontSize(TYPOGRAPHY.fieldLabel.size);
    this.doc.setTextColor(0, 0, 0);
    const labelText = spec.label.toUpperCase();
    const labelMax = this.doc.splitTextToSize(labelText, width - 1)[0] ?? labelText;
    this.doc.text(labelMax, x, y);

    // Value — 9pt regular, 3.5mm below the label baseline.
    this.doc.setFont('helvetica', TYPOGRAPHY.fieldValue.weight);
    this.doc.setFontSize(TYPOGRAPHY.fieldValue.size);
    this.doc.setTextColor(0, 0, 0);
    const maxLine = this.doc.splitTextToSize(value, width - 1)[0] ?? value;
    this.doc.text(maxLine, x, y + 4);

    // Form-fill underline beneath the value spanning the field width.
    this.doc.setDrawColor(0, 0, 0);
    this.doc.setLineWidth(RULE_WEIGHTS.fieldUnderline);
    this.doc.line(x, y + 5, x + width, y + 5);

    if (!positioned) this.layout.advance(SPACING.fieldRowHeight);
  }

  checkboxRow<T>(specs: CheckboxField<T>[], data: T): void {
    this.layout.pageBreakIfNeeded(ROW_HEIGHT);
    const y = this.layout.cursorY;
    let x = this.layout.leftX;

    this.doc.setDrawColor(0, 0, 0);
    this.doc.setLineWidth(0.25);
    this.doc.setFont('helvetica', 'normal');
    this.doc.setFontSize(VALUE_FONT_SIZE);
    this.doc.setTextColor(0, 0, 0);

    for (const s of specs) {
      this.doc.rect(x, y - CHECKBOX_SIZE + 1, CHECKBOX_SIZE, CHECKBOX_SIZE);
      const checked = Boolean(s.accessor(data));
      if (checked) {
        this.doc.setFont('helvetica', 'bold');
        this.doc.text('X', x + 0.7, y);
        this.doc.setFont('helvetica', 'normal');
      }
      this.doc.text(s.label, x + CHECKBOX_SIZE + 1.5, y);
      x += CHECKBOX_GAP;
    }
    this.layout.advance(ROW_HEIGHT);
  }

  spacer(height: number): void {
    this.layout.advance(height);
  }

  narrative<T>(spec: NarrativeField<T>, data: T): void {
    const labelHeight = NARRATIVE_LABEL_H;
    const lineHeight = NARRATIVE_LINE_H;
    const text = String(spec.accessor(data) ?? '');
    const wrapWidth = this.layout.rightX - this.layout.leftX;

    this.layout.pageBreakIfNeeded(labelHeight + lineHeight);
    this.doc.setFont('helvetica', 'normal');
    this.doc.setFontSize(LABEL_FONT_SIZE);
    this.doc.setTextColor(100, 100, 100);
    this.doc.text(spec.label.toUpperCase(), this.layout.leftX, this.layout.cursorY);
    this.layout.advance(labelHeight);

    this.doc.setFontSize(VALUE_FONT_SIZE);
    this.doc.setTextColor(0, 0, 0);
    const lines = text ? (this.doc.splitTextToSize(text, wrapWidth) as string[]) : [];
    const minLines = spec.minLines ?? 0;
    const totalLines = Math.max(lines.length, minLines);

    for (let i = 0; i < totalLines; i++) {
      this.layout.pageBreakIfNeeded(lineHeight);
      if (i < lines.length) {
        this.doc.text(lines[i], this.layout.leftX, this.layout.cursorY);
      } else {
        this.doc.setDrawColor(200, 200, 200);
        this.doc.setLineWidth(0.1);
        this.doc.line(this.layout.leftX, this.layout.cursorY + 0.8,
                      this.layout.rightX, this.layout.cursorY + 0.8);
      }
      this.layout.advance(lineHeight);
    }
  }

  table<T>(spec: TableField<T>, data: T): void {
    const rows = spec.accessor(data) ?? [];

    // Section label (above table)
    this.layout.pageBreakIfNeeded(4 + 6 + 6);
    this.doc.setFont('helvetica', 'bold');
    this.doc.setFontSize(LABEL_FONT_SIZE);
    this.doc.setTextColor(0, 0, 0);
    this.doc.text(spec.label.toUpperCase(), this.layout.leftX, this.layout.cursorY);
    this.layout.advance(4);

    const tableWidth = this.layout.rightX - this.layout.leftX;
    const totalUnits = spec.columns.reduce((sum, c) => sum + widthUnits(c.width ?? 'full'), 0);
    let x = this.layout.leftX;
    const colStarts: number[] = [];
    const colWidths: number[] = [];
    for (const c of spec.columns) {
      const w = (widthUnits(c.width ?? 'full') / totalUnits) * tableWidth;
      colStarts.push(x);
      colWidths.push(w);
      x += w;
    }

    // Header band height & body row height (in doc units — doc is in mm in
    // renderer, pt in some tests; use ~5-6 unit baseline that works for both).
    const headerH = TABLE_HDR_H;
    const rowH = TABLE_ROW_H;
    const left = this.layout.leftX;

    // ── Header band: solid black fill, white UPPERCASE text ──
    const tableTop = this.layout.cursorY;
    this.doc.setFillColor(0, 0, 0);
    this.doc.rect(left, tableTop, tableWidth, headerH, 'F');

    this.doc.setFont('helvetica', TYPOGRAPHY.tableHeader.weight);
    this.doc.setFontSize(TYPOGRAPHY.tableHeader.size);
    this.doc.setTextColor(255, 255, 255);
    spec.columns.forEach((c, i) => {
      const headerText = (c.header || c.key).toUpperCase();
      this.doc.text(headerText, colStarts[i] + 1, tableTop + headerH - 1.5);
    });
    this.layout.advance(headerH);

    // ── Body rows: zebra-striped, black text ──
    this.doc.setFont('helvetica', TYPOGRAPHY.tableBody.weight);
    this.doc.setFontSize(TYPOGRAPHY.tableBody.size);
    this.doc.setTextColor(0, 0, 0);

    const bodyTop = this.layout.cursorY;
    if (rows.length === 0) {
      this.doc.setTextColor(150, 150, 150);
      this.doc.text('No records', left + 1, this.layout.cursorY + rowH - 1.5);
      this.layout.advance(rowH);
      this.doc.setTextColor(0, 0, 0);
    } else {
      for (let r = 0; r < rows.length; r++) {
        this.layout.pageBreakIfNeeded(rowH);
        const row = rows[r];
        const yRow = this.layout.cursorY;
        if (r % 2 === 1) {
          // 5% gray zebra (TONES.zebraRow #F5F5F5)
          this.doc.setFillColor(245, 245, 245);
          this.doc.rect(left, yRow, tableWidth, rowH, 'F');
        }
        spec.columns.forEach((c, i) => {
          const raw = (row as Record<string, unknown>)[c.key];
          const text = raw === null || raw === undefined ? '' : String(raw);
          const maxLine = this.doc.splitTextToSize(text, colWidths[i] - 2)[0] ?? '';
          this.doc.text(maxLine, colStarts[i] + 1, yRow + rowH - 1.5);
        });
        this.layout.advance(rowH);
      }
    }

    // ── Borders: 0.5pt black outer rect + column dividers + below-header line ──
    const bodyBottom = this.layout.cursorY;
    const totalH = bodyBottom - tableTop;
    this.doc.setLineWidth(RULE_WEIGHTS.tableBorder);
    this.doc.setDrawColor(0, 0, 0);
    this.doc.rect(left, tableTop, tableWidth, totalH);
    // Below-header separator
    this.doc.line(left, bodyTop, left + tableWidth, bodyTop);
    // Column dividers (skip first edge)
    for (let i = 1; i < spec.columns.length; i++) {
      this.doc.line(colStarts[i], tableTop, colStarts[i], tableTop + totalH);
    }

    // Reset text color for downstream callers
    this.doc.setTextColor(0, 0, 0);
  }

  signature<T>(spec: SignatureField<T>, data: T): void {
    const blockHeight = SIG_BLOCK_H;
    this.layout.pageBreakIfNeeded(blockHeight);
    const x = this.layout.leftX;
    const y = this.layout.cursorY;
    const sigData = spec.accessor(data);
    const sigWidth = SIG_WIDTH;

    this.doc.setFont('helvetica', 'normal');
    this.doc.setFontSize(LABEL_FONT_SIZE);
    this.doc.setTextColor(100, 100, 100);
    this.doc.text(spec.label.toUpperCase(), x, y);

    this.doc.setDrawColor(0, 0, 0);
    this.doc.setLineWidth(0.2);
    this.doc.line(x, y + 12, x + sigWidth, y + 12);

    if (sigData?.image?.startsWith('data:image/')) {
      try {
        this.doc.addImage(sigData.image, 'PNG', x + 1, y + 4, sigWidth - 2, 7);
      } catch {
        /* ignore malformed image */
      }
    }

    this.doc.setFontSize(VALUE_FONT_SIZE);
    this.doc.setTextColor(0, 0, 0);
    this.doc.text(`Printed name: ${sigData?.printedName ?? ''}`, x, y + 17);

    // Date label small + above the line (mirrors signature label pattern)
    this.doc.setFontSize(LABEL_FONT_SIZE);
    this.doc.setTextColor(100, 100, 100);
    this.doc.text('DATE', x + sigWidth + 8, y + 8);
    // Line for signer to write date on
    this.doc.setDrawColor(0, 0, 0);
    this.doc.setLineWidth(0.2);
    this.doc.line(x + sigWidth + 8, y + 12, x + sigWidth + 55, y + 12);
    // Pre-filled date value (if any) below the line
    if (sigData?.date) {
      this.doc.setFontSize(VALUE_FONT_SIZE);
      this.doc.setTextColor(0, 0, 0);
      this.doc.text(sigData.date, x + sigWidth + 8, y + 17);
    }

    this.layout.advance(blockHeight);
  }
}

export { widthUnits };

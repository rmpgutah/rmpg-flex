import type jsPDF from 'jspdf';
import type { LayoutEngine } from './layout';
import type {
  LabeledField, CheckboxField, NarrativeField, TableField, SignatureField, Width,
} from './types';

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
    if (!positioned) this.layout.pageBreakIfNeeded(ROW_HEIGHT);
    const x = xOverride ?? this.layout.leftX;
    const width = widthOverride ?? (this.layout.rightX - this.layout.leftX);
    const y = this.layout.cursorY;
    const value = formatValue(spec.accessor(data));

    this.doc.setFont('helvetica', 'normal');
    this.doc.setFontSize(LABEL_FONT_SIZE);
    this.doc.setTextColor(100, 100, 100);
    this.doc.text(spec.label.toUpperCase(), x, y);

    this.doc.setFontSize(VALUE_FONT_SIZE);
    this.doc.setTextColor(0, 0, 0);
    // Truncate value to fit the available width
    const maxLine = this.doc.splitTextToSize(value, width - 1)[0] ?? value;
    this.doc.text(maxLine, x, y + 4);

    // Thin rule under the value so the boxed field reads as a form cell
    this.doc.setDrawColor(180, 180, 180);
    this.doc.setLineWidth(0.1);
    this.doc.line(x, y + 5, x + width - 1, y + 5);

    if (!positioned) this.layout.advance(ROW_HEIGHT);
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
    const rowHeight = TABLE_ROW_H;
    const headerHeight = TABLE_HDR_H;
    const rows = spec.accessor(data) ?? [];
    const totalHeight = headerHeight + (rows.length || 1) * rowHeight;
    this.layout.pageBreakIfNeeded(totalHeight + 4);

    this.doc.setFont('helvetica', 'bold');
    this.doc.setFontSize(LABEL_FONT_SIZE);
    this.doc.setTextColor(100, 100, 100);
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

    this.doc.setFont('helvetica', 'bold');
    this.doc.setFontSize(8);
    this.doc.setTextColor(0, 0, 0);
    this.doc.setFillColor(230, 230, 230);
    this.doc.rect(this.layout.leftX, this.layout.cursorY, tableWidth, headerHeight, 'F');
    spec.columns.forEach((c, i) => {
      this.doc.text(c.header, colStarts[i] + 1, this.layout.cursorY + 3.5);
    });
    this.layout.advance(headerHeight);

    this.doc.setFont('helvetica', 'normal');
    this.doc.setFontSize(VALUE_FONT_SIZE);
    if (rows.length === 0) {
      this.doc.setTextColor(150, 150, 150);
      this.doc.text('No records', this.layout.leftX + 1, this.layout.cursorY + 3.5);
      this.layout.advance(rowHeight);
    } else {
      this.doc.setTextColor(0, 0, 0);
      for (const row of rows) {
        this.layout.pageBreakIfNeeded(rowHeight);
        spec.columns.forEach((c, i) => {
          const raw = (row as Record<string, unknown>)[c.key];
          const text = raw === null || raw === undefined ? '' : String(raw);
          const maxLine = this.doc.splitTextToSize(text, colWidths[i] - 2)[0] ?? '';
          this.doc.text(maxLine, colStarts[i] + 1, this.layout.cursorY + 3.5);
        });
        this.layout.advance(rowHeight);
      }
    }
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
    this.doc.text(`Date: ${sigData?.date ?? ''}`, x + sigWidth + 8, y + 12);
    this.doc.line(x + sigWidth + 8, y + 12, x + sigWidth + 55, y + 12);

    this.layout.advance(blockHeight);
  }
}

export { widthUnits };

import type jsPDF from 'jspdf';
import type { LayoutEngine } from './layout';
import type {
  LabeledField, CheckboxField, NarrativeField, TableField, SignatureField, Width,
} from './types';

const LABEL_FONT_SIZE = 7;
const VALUE_FONT_SIZE = 10;
const ROW_HEIGHT = 18;
const CHECKBOX_SIZE = 9;

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

  labeledField<T>(spec: LabeledField<T>, data: T): void {
    this.layout.pageBreakIfNeeded(ROW_HEIGHT);
    const x = this.layout.leftX;
    const y = this.layout.cursorY;
    const value = formatValue(spec.accessor(data));

    this.doc.setFont('helvetica', 'normal');
    this.doc.setFontSize(LABEL_FONT_SIZE);
    this.doc.setTextColor(100, 100, 100);
    this.doc.text(spec.label.toUpperCase(), x, y);

    this.doc.setFontSize(VALUE_FONT_SIZE);
    this.doc.setTextColor(0, 0, 0);
    this.doc.text(value, x, y + 10);

    this.layout.advance(ROW_HEIGHT);
  }

  checkboxRow<T>(specs: CheckboxField<T>[], data: T): void {
    this.layout.pageBreakIfNeeded(ROW_HEIGHT);
    const y = this.layout.cursorY;
    let x = this.layout.leftX;
    const gap = 110;

    this.doc.setDrawColor(0, 0, 0);
    this.doc.setLineWidth(0.75);
    this.doc.setFont('helvetica', 'normal');
    this.doc.setFontSize(VALUE_FONT_SIZE);
    this.doc.setTextColor(0, 0, 0);

    for (const s of specs) {
      this.doc.rect(x, y - CHECKBOX_SIZE + 1, CHECKBOX_SIZE, CHECKBOX_SIZE);
      const checked = Boolean(s.accessor(data));
      if (checked) {
        this.doc.setFont('helvetica', 'bold');
        this.doc.text('X', x + 2, y - 1);
        this.doc.setFont('helvetica', 'normal');
      }
      this.doc.text(s.label, x + CHECKBOX_SIZE + 4, y);
      x += gap;
    }
    this.layout.advance(ROW_HEIGHT);
  }

  spacer(height: number): void {
    this.layout.advance(height);
  }

  narrative<T>(spec: NarrativeField<T>, data: T): void {
    const labelHeight = 10;
    const lineHeight = 12;
    const text = String(spec.accessor(data) ?? '');
    const wrapWidth = this.layout.rightX - this.layout.leftX;

    this.layout.pageBreakIfNeeded(labelHeight + lineHeight);
    this.doc.setFont('helvetica', 'normal');
    this.doc.setFontSize(7);
    this.doc.setTextColor(100, 100, 100);
    this.doc.text(spec.label.toUpperCase(), this.layout.leftX, this.layout.cursorY);
    this.layout.advance(labelHeight);

    this.doc.setFontSize(10);
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
        this.doc.setLineWidth(0.25);
        this.doc.line(this.layout.leftX, this.layout.cursorY + 2,
                      this.layout.rightX, this.layout.cursorY + 2);
      }
      this.layout.advance(lineHeight);
    }
  }

  // Tasks 5–6 replace these stubs
  table<T>(_spec: TableField<T>, _data: T): void { this.layout.advance(40); }
  signature<T>(_spec: SignatureField<T>, _data: T): void { this.layout.advance(40); }
}

export { widthUnits };

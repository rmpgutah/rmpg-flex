import { describe, it, expect, beforeEach } from 'vitest';
import jsPDF from 'jspdf';
import { LayoutEngine } from '../layout';
import { Primitives } from '../primitives';
import type { LabeledField, CheckboxField, NarrativeField, TableField, SignatureField } from '../types';

describe('Primitives — labeledField', () => {
  let doc: jsPDF; let layout: LayoutEngine; let prims: Primitives;
  beforeEach(() => {
    doc = new jsPDF({ unit: 'pt', format: 'letter' });
    layout = new LayoutEngine(doc, { topMargin: 60, bottomMargin: 50, leftMargin: 40, rightMargin: 40 });
    prims = new Primitives(doc, layout);
  });

  it('renders a labeled field and advances cursor', () => {
    const before = layout.cursorY;
    const spec: LabeledField<{ name: string }> = { kind: 'labeled', label: 'Name', accessor: d => d.name };
    prims.labeledField(spec, { name: 'Jones' });
    expect(layout.cursorY).toBeGreaterThan(before);
  });

  it('renders em-dash for null values, never "undefined"', () => {
    const spec: LabeledField<{ name: string | null }> = { kind: 'labeled', label: 'Name', accessor: d => d.name };
    prims.labeledField(spec, { name: null });
    const output = doc.output('datauristring');
    expect(output.toLowerCase()).not.toContain('undefined');
  });

  it('renders em-dash for empty string values', () => {
    const spec: LabeledField<{ name: string }> = { kind: 'labeled', label: 'Name', accessor: d => d.name };
    prims.labeledField(spec, { name: '' });
    expect(layout.cursorY).toBeGreaterThan(60);
  });

  it('renders boolean true as Yes, false as No', () => {
    const spec: LabeledField<{ x: boolean }> = { kind: 'labeled', label: 'Flag', accessor: d => d.x };
    prims.labeledField(spec, { x: true });
    prims.labeledField(spec, { x: false });
    expect(layout.cursorY).toBeGreaterThan(60);
  });
});

describe('Primitives — checkboxRow', () => {
  let doc: jsPDF; let layout: LayoutEngine; let prims: Primitives;
  beforeEach(() => {
    doc = new jsPDF({ unit: 'pt', format: 'letter' });
    layout = new LayoutEngine(doc, { topMargin: 60, bottomMargin: 50, leftMargin: 40, rightMargin: 40 });
    prims = new Primitives(doc, layout);
  });

  it('renders a row of checkboxes with filled/unfilled states', () => {
    const specs: CheckboxField<{ a: boolean; b: boolean }>[] = [
      { kind: 'checkbox', label: 'A', accessor: d => d.a },
      { kind: 'checkbox', label: 'B', accessor: d => d.b },
    ];
    prims.checkboxRow(specs, { a: true, b: false });
    expect(layout.cursorY).toBeGreaterThan(60);
  });
});

describe('Primitives — spacer', () => {
  it('advances cursor by given height', () => {
    const doc = new jsPDF({ unit: 'pt', format: 'letter' });
    const layout = new LayoutEngine(doc, { topMargin: 60, bottomMargin: 50, leftMargin: 40, rightMargin: 40 });
    const prims = new Primitives(doc, layout);
    prims.spacer(20);
    expect(layout.cursorY).toBe(80);
  });
});

describe('Primitives — narrative', () => {
  let doc: jsPDF; let layout: LayoutEngine; let prims: Primitives;
  beforeEach(() => {
    doc = new jsPDF({ unit: 'pt', format: 'letter' });
    layout = new LayoutEngine(doc, { topMargin: 60, bottomMargin: 50, leftMargin: 40, rightMargin: 40 });
    prims = new Primitives(doc, layout);
  });

  it('wraps long narrative text within page width', () => {
    const before = layout.cursorY;
    const spec: NarrativeField<{ n: string }> = {
      kind: 'narrative', label: 'Narrative', accessor: d => d.n,
    };
    prims.narrative(spec, { n: 'A'.repeat(500) });
    expect(layout.cursorY).toBeGreaterThan(before + 20);
  });

  it('draws empty lines when narrative is shorter than minLines', () => {
    const before = layout.cursorY;
    const spec: NarrativeField<{ n?: string }> = {
      kind: 'narrative', label: 'Narrative', accessor: d => d.n, minLines: 5,
    };
    prims.narrative(spec, {});
    expect(layout.cursorY).toBeGreaterThan(before + 20);
  });
});

describe('Primitives — table', () => {
  let doc: jsPDF; let layout: LayoutEngine; let prims: Primitives;
  beforeEach(() => {
    doc = new jsPDF({ unit: 'pt', format: 'letter' });
    layout = new LayoutEngine(doc, { topMargin: 60, bottomMargin: 50, leftMargin: 40, rightMargin: 40 });
    prims = new Primitives(doc, layout);
  });

  it('renders header row + data rows, advances cursor proportional to rows', () => {
    const before = layout.cursorY;
    const spec: TableField<{ rows: Array<{ a: string; b: string }> }> = {
      kind: 'table', label: 'Test',
      columns: [
        { key: 'a', header: 'A', width: 'half' },
        { key: 'b', header: 'B', width: 'half' },
      ],
      accessor: d => d.rows,
    };
    prims.table(spec, { rows: [{ a: '1', b: '2' }, { a: '3', b: '4' }] });
    expect(layout.cursorY).toBeGreaterThan(before + 12);
  });

  it('renders "No records" placeholder when accessor returns empty array', () => {
    const spec: TableField<{ rows: Array<any> }> = {
      kind: 'table', label: 'Test',
      columns: [{ key: 'a', header: 'A', width: 'full' }],
      accessor: d => d.rows,
    };
    prims.table(spec, { rows: [] });
    expect(layout.cursorY).toBeGreaterThan(60);
  });
});

describe('Primitives — signature', () => {
  let doc: jsPDF; let layout: LayoutEngine; let prims: Primitives;
  beforeEach(() => {
    doc = new jsPDF({ unit: 'pt', format: 'letter' });
    layout = new LayoutEngine(doc, { topMargin: 60, bottomMargin: 50, leftMargin: 40, rightMargin: 40 });
    prims = new Primitives(doc, layout);
  });

  it('renders a signature block with printed name and date', () => {
    const spec: SignatureField<{ sig: { image?: string; printedName?: string; date?: string } }> = {
      kind: 'signature', label: 'Officer', accessor: d => d.sig,
    };
    prims.signature(spec, { sig: { printedName: 'JONES', date: '2026-04-14' } });
    expect(layout.cursorY).toBeGreaterThan(60);
  });

  it('renders empty signature block when accessor returns undefined', () => {
    const spec: SignatureField<{ sig?: any }> = {
      kind: 'signature', label: 'Officer', accessor: d => d.sig,
    };
    prims.signature(spec, {});
    expect(layout.cursorY).toBeGreaterThan(60);
  });
});

function getDocText(doc: jsPDF): string {
  const buf = new Uint8Array(doc.output('arraybuffer'));
  let text = '';
  for (const b of buf) text += String.fromCharCode(b);
  return text;
}

describe('labeledField (Spillman form-fill style)', () => {
  it('writes label in UPPERCASE and the value as-given', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    const layout = new LayoutEngine(doc, { topMargin: 30, bottomMargin: 18, leftMargin: 10, rightMargin: 10 });
    const prims = new Primitives(doc, layout);
    prims.labeledField({ kind: 'labeled', label: 'Full Name', accessor: () => 'Smith, Jane M.' }, {});
    const text = getDocText(doc);
    expect(text).toContain('FULL NAME');
    expect(text).toContain('Smith, Jane M.');
  });

  it('handles missing/null/empty values without crashing or rendering "undefined"', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    const layout = new LayoutEngine(doc, { topMargin: 30, bottomMargin: 18, leftMargin: 10, rightMargin: 10 });
    const prims = new Primitives(doc, layout);
    prims.labeledField({ kind: 'labeled', label: 'EMPTY', accessor: () => null }, {});
    prims.labeledField({ kind: 'labeled', label: 'EMPTY 2', accessor: () => '' }, {});
    prims.labeledField({ kind: 'labeled', label: 'EMPTY 3', accessor: () => undefined }, {});
    const text = getDocText(doc);
    // PDF object syntax legitimately uses the literal token `null` (e.g.
    // `/OpenAction [3 0 R /FitH null]`), so we only assert that the
    // text-rendering operator stream contains neither (Tj-wrapped) string.
    expect(text).not.toMatch(/\(undefined\) Tj/);
    expect(text).not.toMatch(/\(null\) Tj/);
  });

  it('advances the layout cursor when called without explicit x', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    const layout = new LayoutEngine(doc, { topMargin: 30, bottomMargin: 18, leftMargin: 10, rightMargin: 10 });
    const prims = new Primitives(doc, layout);
    const before = layout.cursorY;
    prims.labeledField({ kind: 'labeled', label: 'X', accessor: () => 'y' }, {});
    expect(layout.cursorY).toBeGreaterThan(before);
  });

  it('does NOT advance the cursor when called with explicit x (multi-column case)', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    const layout = new LayoutEngine(doc, { topMargin: 30, bottomMargin: 18, leftMargin: 10, rightMargin: 10 });
    const prims = new Primitives(doc, layout);
    const before = layout.cursorY;
    prims.labeledField(
      { kind: 'labeled', label: 'X', accessor: () => 'y' },
      {},
      50,
      40,
    );
    expect(layout.cursorY).toBe(before);
  });
});

describe('table (Spillman black-header zebra style)', () => {
  it('renders header text in UPPERCASE and emits all cell text', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    const layout = new LayoutEngine(doc, { topMargin: 30, bottomMargin: 18, leftMargin: 10, rightMargin: 10 });
    const prims = new Primitives(doc, layout);
    prims.table(
      {
        kind: 'table',
        label: 'TEST',
        columns: [
          { key: 'name', header: 'name' },
          { key: 'count', header: 'count' },
        ],
        accessor: () => [
          { name: 'apples', count: '5' },
          { name: 'oranges', count: '7' },
        ],
      },
      {},
    );
    const buf = new Uint8Array(doc.output('arraybuffer'));
    let text = '';
    for (const b of buf) text += String.fromCharCode(b);
    expect(text).toContain('NAME');
    expect(text).toContain('COUNT');
    expect(text).toContain('apples');
    expect(text).toContain('oranges');
  });

  it('handles empty rows array without crashing', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    const layout = new LayoutEngine(doc, { topMargin: 30, bottomMargin: 18, leftMargin: 10, rightMargin: 10 });
    const prims = new Primitives(doc, layout);
    expect(() => prims.table(
      { kind: 'table', label: 'EMPTY', columns: [{ key: 'k', header: 'K' }], accessor: () => [] },
      {},
    )).not.toThrow();
  });

  it('coerces null/undefined cell values to empty string', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    const layout = new LayoutEngine(doc, { topMargin: 30, bottomMargin: 18, leftMargin: 10, rightMargin: 10 });
    const prims = new Primitives(doc, layout);
    prims.table(
      { kind: 'table', label: 'NULLS', columns: [{ key: 'a', header: 'A' }], accessor: () => [{ a: null }, { a: undefined }] },
      {},
    );
    const buf = new Uint8Array(doc.output('arraybuffer'));
    let text = '';
    for (const b of buf) text += String.fromCharCode(b);
    expect(text).not.toMatch(/\(undefined\)\s*Tj/);
    expect(text).not.toMatch(/\(null\)\s*Tj/);
  });
});

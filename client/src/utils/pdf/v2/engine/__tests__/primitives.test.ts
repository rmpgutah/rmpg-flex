import { describe, it, expect, beforeEach } from 'vitest';
import jsPDF from 'jspdf';
import { LayoutEngine } from '../layout';
import { Primitives } from '../primitives';
import type { LabeledField, CheckboxField, NarrativeField } from '../types';

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
    expect(layout.cursorY).toBeGreaterThan(before + 40);
  });

  it('draws empty lines when narrative is shorter than minLines', () => {
    const before = layout.cursorY;
    const spec: NarrativeField<{ n?: string }> = {
      kind: 'narrative', label: 'Narrative', accessor: d => d.n, minLines: 5,
    };
    prims.narrative(spec, {});
    expect(layout.cursorY).toBeGreaterThan(before + 60);
  });
});

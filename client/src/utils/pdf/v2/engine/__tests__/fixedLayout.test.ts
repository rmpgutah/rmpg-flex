// ============================================================
// fixedLayout — renderer smoke tests
// ============================================================

import { describe, it, expect } from 'vitest';
import jsPDF from 'jspdf';
import { LayoutEngine } from '../layout';
import { renderFixedLayoutSection } from '../fixedLayout';
import type { FixedLayoutSection } from '../types';

interface Fix { name: string; checked: boolean }
const data: Fix = { name: 'Test User', checked: true };

function makeDoc(): { doc: jsPDF; layout: LayoutEngine } {
  const doc = new jsPDF({ unit: 'mm', format: 'letter' });
  const layout = new LayoutEngine(doc, {
    topMargin: 10, bottomMargin: 18, leftMargin: 10, rightMargin: 10,
  });
  return { doc, layout };
}

describe('renderFixedLayoutSection', () => {
  it('advances layout cursor by exactly section.height', () => {
    const { doc, layout } = makeDoc();
    const cursorBefore = layout.cursorY;
    const section: FixedLayoutSection<Fix> = {
      kind: 'fixed-layout',
      height: 25,
      fields: [
        { x: 0, y: 0, w: 50, h: 6, style: 'underline', label: 'Name', accessor: (d) => d.name },
      ],
    };
    renderFixedLayoutSection(doc, layout, section, data);
    expect(layout.cursorY - cursorBefore).toBe(25);
  });

  it('skips fields where visibleIf returns false', () => {
    const { doc, layout } = makeDoc();
    const section: FixedLayoutSection<Fix> = {
      kind: 'fixed-layout',
      height: 20,
      fields: [
        { x: 0, y: 0, w: 50, h: 6, style: 'text', accessor: (d) => d.name },
        { x: 0, y: 8, w: 50, h: 6, style: 'text', accessor: () => 'hidden', visibleIf: () => false },
      ],
    };
    // Just verify no throw — actual hiding is verified visually + at the
    // schema level (citationUtahMaster.test.ts checks visibleIf wiring).
    expect(() => renderFixedLayoutSection(doc, layout, section, data)).not.toThrow();
  });

  it('page-breaks BEFORE rendering when section is taller than remaining page', () => {
    const { doc, layout } = makeDoc();
    // Push cursor near the bottom (page height ~279mm, bottom margin 18, so
    // content limit ~261; set cursor to 250 → only 11mm left).
    layout.setCursor(250);
    const pagesBefore = layout.pageNumber;
    const section: FixedLayoutSection<Fix> = {
      kind: 'fixed-layout',
      height: 50,    // doesn't fit in remaining 11mm
      fields: [{ x: 0, y: 0, w: 50, h: 6, style: 'text', accessor: () => 'test' }],
    };
    renderFixedLayoutSection(doc, layout, section, data);
    expect(layout.pageNumber).toBe(pagesBefore + 1);
  });

  it('supports all 9 field styles without throwing', () => {
    const { doc, layout } = makeDoc();
    const section: FixedLayoutSection<Fix> = {
      kind: 'fixed-layout',
      height: 100,
      fields: [
        { x: 0,  y: 0,  w: 30, h: 6, style: 'text',      accessor: (d) => d.name },
        { x: 32, y: 0,  w: 30, h: 6, style: 'box',       accessor: (d) => d.name, label: 'Boxed' },
        { x: 64, y: 0,  w: 30, h: 6, style: 'underline', accessor: (d) => d.name, label: 'Lined' },
        { x: 0,  y: 8,  w: 30, h: 4, style: 'checkbox',  accessor: (d) => d.checked, label: 'Done' },
        { x: 32, y: 8,  w: 30, h: 8, style: 'signature', accessor: () => ({ image: undefined }), label: 'Sig' },
        { x: 64, y: 8,  w: 30, h: 10, style: 'barcode',  accessor: () => 'CIT-2026-0001' },
        { x: 0,  y: 20, w: 30, h: 0, style: 'line' },
        { x: 0,  y: 24, w: 30, h: 6, style: 'rect' },
        { x: 32, y: 24, w: 30, h: 6, style: 'label', label: 'STATIC' },
      ],
    };
    expect(() => renderFixedLayoutSection(doc, layout, section, data)).not.toThrow();
  });
});

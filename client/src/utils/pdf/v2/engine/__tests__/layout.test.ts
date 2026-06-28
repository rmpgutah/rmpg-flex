import { describe, it, expect } from 'vitest';
import jsPDF from 'jspdf';
import { LayoutEngine } from '../layout';

describe('LayoutEngine', () => {
  it('starts at top margin', () => {
    const doc = new jsPDF({ unit: 'pt', format: 'letter' });
    const layout = new LayoutEngine(doc, { topMargin: 60, bottomMargin: 50, leftMargin: 40, rightMargin: 40 });
    expect(layout.cursorY).toBe(60);
    expect(layout.pageNumber).toBe(1);
  });

  it('advances cursor on advance()', () => {
    const doc = new jsPDF({ unit: 'pt', format: 'letter' });
    const layout = new LayoutEngine(doc, { topMargin: 60, bottomMargin: 50, leftMargin: 40, rightMargin: 40 });
    layout.advance(100);
    expect(layout.cursorY).toBe(160);
  });

  it('adds a new page when requested height would overflow', () => {
    const doc = new jsPDF({ unit: 'pt', format: 'letter' });
    const layout = new LayoutEngine(doc, { topMargin: 60, bottomMargin: 50, leftMargin: 40, rightMargin: 40 });
    layout.advance(700);
    layout.pageBreakIfNeeded(50);
    expect(layout.pageNumber).toBe(2);
    expect(layout.cursorY).toBe(60);
  });

  it('reports usable content box', () => {
    const doc = new jsPDF({ unit: 'pt', format: 'letter' });
    const layout = new LayoutEngine(doc, { topMargin: 60, bottomMargin: 50, leftMargin: 40, rightMargin: 40 });
    expect(layout.leftX).toBe(40);
    expect(layout.rightX).toBe(612 - 40);
    expect(layout.contentHeight).toBe(792 - 60 - 50);
  });
});

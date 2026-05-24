// client/src/utils/pdf/v2/engine/__tests__/panel.test.ts
import { describe, it, expect } from 'vitest';
import jsPDF from 'jspdf';
import { Panel } from '../panel';

describe('Panel', () => {
  it('produces a LayoutEngine constrained to its bounds', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    const panel = new Panel({ left: 10, top: 30, width: 97.85, height: 230 }, doc);
    const layout = panel.layout();
    expect(layout.leftX).toBe(10);
    expect(layout.rightX).toBeCloseTo(107.85, 2);
    expect(layout.cursorY).toBe(30);
  });

  it('pageBreakIfNeeded fires when cursor would exceed panel bottom', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    const panel = new Panel({ left: 10, top: 30, width: 97.85, height: 50 }, doc);
    const layout = panel.layout();
    layout.advance(45);
    layout.pageBreakIfNeeded(10);
    // After break, cursor resets to panel.top (not page topMargin)
    expect(layout.cursorY).toBe(30);
    expect(doc.getNumberOfPages()).toBe(2);
  });

  it('two panels on the same page render independently', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    const left = new Panel({ left: 10, top: 30, width: 97.85, height: 230 }, doc);
    const right = new Panel({ left: 110.95, top: 30, width: 97.85, height: 230 }, doc);
    expect(left.layout().rightX).toBeLessThan(right.layout().leftX);
  });
});

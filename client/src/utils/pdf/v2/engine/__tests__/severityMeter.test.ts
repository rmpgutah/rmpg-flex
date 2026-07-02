import { describe, it, expect } from 'vitest';
import jsPDF from 'jspdf';
import { LayoutEngine } from '../layout';
import { drawSeverityMeter } from '../severityMeter';

describe('drawSeverityMeter', () => {
  it('advances the layout cursor', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    const layout = new LayoutEngine(doc, {
      topMargin: 20, bottomMargin: 18, leftMargin: 10, rightMargin: 10,
    });
    const before = layout.cursorY;
    drawSeverityMeter(doc, layout, { level: 3, max: 5 });
    expect(layout.cursorY).toBeGreaterThan(before);
  });

  it('draws exactly `max` filled/unfilled rectangle segments', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    const layout = new LayoutEngine(doc, {
      topMargin: 20, bottomMargin: 18, leftMargin: 10, rightMargin: 10,
    });
    drawSeverityMeter(doc, layout, { level: 2, max: 4 });
    const ops = doc.internal.pages[1].join('\n');
    // jsPDF emits one "re" (rect path) operator per rect(...,'F') call.
    expect((ops.match(/ re$/gm) ?? []).length).toBe(4);
  });

  it('renders the highest segment (level === max) in the escalated red tone', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    const layout = new LayoutEngine(doc, {
      topMargin: 20, bottomMargin: 18, leftMargin: 10, rightMargin: 10,
    });
    drawSeverityMeter(doc, layout, { level: 3, max: 3 });
    const ops = doc.internal.pages[1].join('\n');
    // Escalated red = rgb(212,30,30). 212/255=0.831373, 30/255=0.117647.
    // Precision note: prior tasks (2-5) established jsPDF emits 2-decimal
    // RGB values in this project's config (e.g. "0.17 0.26 0.34"), and
    // collapses R=G=B grayscale fills to a single-value "g"/"G" operator.
    // 212,30,30 has no equal channels, so expect a 3-value lowercase "rg"
    // fill operator at 2-decimal precision: "0.83 0.12 0.12 rg". If your
    // actual test run shows a different value, trust your empirical result
    // over this comment — but this is the expected outcome based on
    // established precedent.
    expect(ops).toContain('0.83 0.12 0.12 rg');
  });
});

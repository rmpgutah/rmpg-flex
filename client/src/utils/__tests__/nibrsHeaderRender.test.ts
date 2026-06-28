import { describe, it, expect } from 'vitest';
import jsPDF from 'jspdf';
import { drawNibrsHeader } from '../pdfFormHelpers';
import { setActiveSectionStyle } from '../pdfGenerator';

describe('drawNibrsHeader (redesigned classic gov/police header)', () => {
  it('embeds the Arial-compatible font and returns a sane content Y in light mode', () => {
    setActiveSectionStyle('light');
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
    const y = drawNibrsHeader(doc, {
      stateIdentifier: 'STATE OF UTAH',
      agencyName: 'ROCKY MOUNTAIN PROTECTIVE GROUP',
      formTitle: 'PERSON RECORD',
      formNumber: 'FORM PS-202',
      caseNumber: 'ZAMORA, CHRISTOPHER',
      caseNumberLabel: 'SUBJECT NAME',
      reportDate: '05/21/2026',
    });
    // Header consumed vertical space and left room for the body.
    expect(y).toBeGreaterThan(20);
    expect(y).toBeLessThan(45);
    // 'Arial' was registered on the document font list (not just helvetica).
    const fonts = Object.keys((doc as unknown as { getFontList: () => Record<string, unknown> }).getFontList());
    expect(fonts).toContain('Arial');
  });

  it('still renders in dark mode without throwing', () => {
    setActiveSectionStyle('dark');
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
    const y = drawNibrsHeader(doc, {
      stateIdentifier: 'STATE OF UTAH',
      agencyName: 'ROCKY MOUNTAIN PROTECTIVE GROUP',
      formTitle: 'INCIDENT REPORT',
      formNumber: 'FORM PS-101',
      caseNumber: 'INC-2026-001',
      reportDate: '05/21/2026',
    });
    expect(y).toBeGreaterThan(15);
    setActiveSectionStyle('light');
  });
});

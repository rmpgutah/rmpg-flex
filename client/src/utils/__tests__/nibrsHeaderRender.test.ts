import { describe, it, expect, afterEach, vi } from 'vitest';
import jsPDF from 'jspdf';
import { drawNibrsHeader } from '../pdfFormHelpers';
import { setActiveSectionStyle } from '../pdfGenerator';
import { clearImageCache } from '../pdfAssets';
import * as pdfAssets from '../pdfAssets';

// A 1x1 transparent PNG, base64-encoded — enough for jsPDF's addImage to
// accept without throwing; content doesn't matter for these tests, only
// that *some* image gets embedded.
const FAKE_SEAL_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

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

  describe('seal fallback (regression: no caller passes config.sealBase64 explicitly)', () => {
    afterEach(() => {
      clearImageCache();
    });

    it('draws no seal image when neither config nor the cache has one', () => {
      clearImageCache(); // ensure getCachedSealBase64() returns null
      setActiveSectionStyle('light');
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
      const addImageSpy = vi.spyOn(doc, 'addImage');
      drawNibrsHeader(doc, {
        stateIdentifier: 'STATE OF UTAH',
        agencyName: 'ROCKY MOUNTAIN PROTECTIVE GROUP',
        formTitle: 'PERSON RECORD',
        caseNumber: 'DOE, JOHN',
      });
      expect(addImageSpy).not.toHaveBeenCalled();
    });

    it('draws the seal from getCachedSealBase64() when config omits it (the real-world call pattern — no caller currently passes config.sealBase64)', () => {
      setActiveSectionStyle('light');
      const spy = vi.spyOn(pdfAssets, 'getCachedSealBase64').mockReturnValue(FAKE_SEAL_DATA_URL);
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
      const addImageSpy = vi.spyOn(doc, 'addImage');
      drawNibrsHeader(doc, {
        stateIdentifier: 'STATE OF UTAH',
        agencyName: 'ROCKY MOUNTAIN PROTECTIVE GROUP',
        formTitle: 'PERSON RECORD',
        caseNumber: 'DOE, JOHN',
        // sealBase64 deliberately omitted — matches every real call site
      });
      expect(addImageSpy).toHaveBeenCalledWith(FAKE_SEAL_DATA_URL, 'PNG', expect.any(Number), expect.any(Number), expect.any(Number), expect.any(Number));
      spy.mockRestore();
    });

    it('falls back to config.sealBase64 when explicitly provided (no cache dependency)', () => {
      setActiveSectionStyle('light');
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
      const addImageSpy = vi.spyOn(doc, 'addImage');
      drawNibrsHeader(doc, {
        stateIdentifier: 'STATE OF UTAH',
        agencyName: 'ROCKY MOUNTAIN PROTECTIVE GROUP',
        formTitle: 'PERSON RECORD',
        caseNumber: 'DOE, JOHN',
        sealBase64: FAKE_SEAL_DATA_URL,
      });
      expect(addImageSpy).toHaveBeenCalledWith(FAKE_SEAL_DATA_URL, 'PNG', expect.any(Number), expect.any(Number), expect.any(Number), expect.any(Number));
    });
  });
});

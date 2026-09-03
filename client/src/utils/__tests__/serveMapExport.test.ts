import { describe, it, expect, vi } from 'vitest';
import { exportServeMapSheet } from '../serveMapExport';

const { openPdfDocumentMock } = vi.hoisted(() => ({
  openPdfDocumentMock: vi.fn(),
}));

vi.mock('../openPdfDocument', () => ({
  openPdfDocument: openPdfDocumentMock,
  openPdfBlob: vi.fn(),
}));

vi.mock('jspdf', () => ({
  jsPDF: vi.fn(function () {
    return {
      setFontSize: vi.fn(),
      setFont: vi.fn(),
      setFillColor: vi.fn(),
      setTextColor: vi.fn(),
      setDrawColor: vi.fn(),
      setLineWidth: vi.fn(),
      text: vi.fn(),
      rect: vi.fn(),
      line: vi.fn(),
      addPage: vi.fn(),
      getTextWidth: vi.fn((t: string) => t.length * 2),
      save: vi.fn(),
      output: vi.fn(() => new Blob()),
      internal: {
        pageSize: {
          getWidth: vi.fn(() => 216),
          getHeight: vi.fn(() => 279),
        },
      },
    };
  }),
}));

vi.mock('../pdfGenerator', () => ({
  fetchPdfBranding: vi.fn(async () => ({})),
  setActiveBranding: vi.fn(),
  loadPdfAssets: vi.fn(async () => {}),
  setActiveFormKey: vi.fn(),
  setActiveCaseNumber: vi.fn(),
  addPageFooter: vi.fn(),
  stampGenerationTime: vi.fn(),
}));

vi.mock('../pdfFormHelpers', () => ({
  drawNibrsHeader: vi.fn(() => 30),
}));

describe('exportServeMapSheet', () => {
  it('saves a PDF with a name containing "serve-route-sheet"', async () => {
    await exportServeMapSheet([
      { id: 1, recipient_name: 'Jane Doe', recipient_address: '123 Main St', priority: 'urgent', deadline: '2026-08-01' },
    ]);
    expect(openPdfDocumentMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('serve-route-sheet'),
    );
  });

  it('handles an empty list without throwing', async () => {
    await expect(exportServeMapSheet([])).resolves.not.toThrow();
  });
});

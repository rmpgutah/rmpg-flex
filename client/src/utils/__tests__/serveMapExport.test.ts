import { describe, it, expect, vi } from 'vitest';
import { exportServeMapSheet } from '../serveMapExport';

const saveMock = vi.fn();
vi.mock('jspdf', () => ({
  jsPDF: vi.fn(function () {
    return {
      setFontSize: vi.fn(),
      setFont: vi.fn(),
      text: vi.fn(),
      save: saveMock,
    };
  }),
}));

describe('exportServeMapSheet', () => {
  it('saves a PDF with a name containing "serve-route-sheet"', async () => {
    await exportServeMapSheet([
      { id: 1, recipient_name: 'Jane Doe', recipient_address: '123 Main St', priority: 'urgent', deadline: '2026-08-01' },
    ]);
    expect(saveMock).toHaveBeenCalledWith(expect.stringContaining('serve-route-sheet'));
  });

  it('handles an empty list without throwing', async () => {
    await expect(exportServeMapSheet([])).resolves.not.toThrow();
  });
});

import { describe, it, expect } from 'vitest';
import { PRINT_WATERMARK_INK } from '../useMapPrintExport';

describe('useMapPrintExport', () => {
  it('watermarks with utilitarian silver, not banned gold', () => {
    expect(PRINT_WATERMARK_INK.toLowerCase()).not.toContain('d4a017');
    expect(PRINT_WATERMARK_INK).toBe('#c3ccd6');
  });
});

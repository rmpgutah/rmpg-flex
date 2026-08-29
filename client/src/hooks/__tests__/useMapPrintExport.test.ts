import { describe, it, expect } from 'vitest';
import { PRINT_WATERMARK_INK, formatPrintStamp } from '../useMapPrintExport';

describe('useMapPrintExport', () => {
  it('watermarks with utilitarian silver, not banned gold', () => {
    expect(PRINT_WATERMARK_INK.toLowerCase()).not.toContain('d4a017');
    expect(PRINT_WATERMARK_INK).toBe('#c3ccd6');
  });

  it('stamps America/Denver, not UTC', () => {
    expect(formatPrintStamp(new Date('2026-08-29T14:00:00Z'))).toMatch(/MT$/);
    expect(formatPrintStamp()).not.toContain('UTC');
  });
});

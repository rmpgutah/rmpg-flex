import { describe, it, expect } from 'vitest';
import { PRINT_SCALE, marginGuideRect } from '../renderGeometry';

describe('PRINT_SCALE', () => {
  it('renders at 150 DPI relative to pdfjs 72-DPI baseline', () => {
    expect(PRINT_SCALE).toBeCloseTo(150 / 72, 5);
  });
});

describe('marginGuideRect', () => {
  it('insets by the margin on all sides, scaled', () => {
    // 612x792pt US Letter, 36pt (0.5in) margin, 2x scale
    expect(marginGuideRect(612, 792, 36, 2)).toEqual({
      x: 72,
      y: 72,
      width: 1080,
      height: 1440,
    });
  });

  it('clamps to a zero-size rect when margins exceed the page', () => {
    expect(marginGuideRect(100, 100, 60, 1)).toEqual({ x: 60, y: 60, width: 0, height: 0 });
  });
});

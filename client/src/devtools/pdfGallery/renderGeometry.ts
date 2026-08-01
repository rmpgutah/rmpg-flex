// Pure render-geometry helpers with NO pdfjs dependency, kept deliberately
// separate from renderToCanvas.ts so unit tests can exercise them without
// pulling any pdfjs build into the vitest environment. renderToCanvas.ts
// re-exports these for any existing call site that imports them from there.

// pdfjs measures at 72 DPI; 150 DPI is the lowest scale at which 6pt
// form-label text is legible enough to judge clipping by eye.
export const PRINT_SCALE = 150 / 72;

export interface GuideRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function marginGuideRect(
  pageWidthPt: number,
  pageHeightPt: number,
  marginPt: number,
  scale: number,
): GuideRect {
  return {
    x: marginPt * scale,
    y: marginPt * scale,
    width: Math.max(0, (pageWidthPt - marginPt * 2) * scale),
    height: Math.max(0, (pageHeightPt - marginPt * 2) * scale),
  };
}

// Pure page-rotation geometry for annotation saving — no engine/PDF deps so it
// can be unit-tested in isolation (see __tests__/rotationGeometry.test.ts).

/** Normalize any page rotation to one of 0|90|180|270. */
export function normRotation(r: number | undefined): 0 | 90 | 180 | 270 {
  const v = (((r ?? 0) % 360) + 360) % 360;
  return (v === 90 || v === 180 || v === 270) ? v : 0;
}

/**
 * Rotation geometry for annotation drawing. A rotated page carries a /Rotate=R
 * attribute, so the viewer rotates the content R° clockwise for display, and
 * annotations are captured in that ROTATED display frame. To make an annotation
 * land where the user placed it, we draw it in the page's UNROTATED content
 * space under a CTM that is the inverse of the /Rotate transform.
 *
 * Given the unrotated content size W×H (points), returns:
 *   • dispH — the DISPLAYED page height (used for the top-left→bottom-left
 *     y-flip; W for 90/270 where the page is shown sideways, else H), and
 *   • ctm  — the affine matrix [a b c d e f] mapping displayed-frame coords
 *     (bottom-left origin) into content space. null for R=0 so the un-rotated
 *     path stays byte-identical.
 *
 * Matrices (derived + corner-verified in the test):
 *   90 : [0, 1,-1, 0, W, 0]   180: [-1, 0, 0,-1, W, H]   270: [0,-1, 1, 0, 0, H]
 */
export function rotationGeometry(R: 0 | 90 | 180 | 270, W: number, H: number):
  { dispH: number; ctm: [number, number, number, number, number, number] | null } {
  switch (R) {
    case 90:  return { dispH: W, ctm: [0, 1, -1, 0, W, 0] };
    case 180: return { dispH: H, ctm: [-1, 0, 0, -1, W, H] };
    case 270: return { dispH: W, ctm: [0, -1, 1, 0, 0, H] };
    default:  return { dispH: H, ctm: null };
  }
}

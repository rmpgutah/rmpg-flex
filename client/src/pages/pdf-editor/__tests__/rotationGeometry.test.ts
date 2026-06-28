import { describe, it, expect } from 'vitest';
import { normRotation, rotationGeometry } from '../rotationGeometry';

// Unrotated content size used across the corner-mapping checks.
const W = 600;
const H = 800;

/** Apply a PDF affine matrix [a b c d e f] to a point (u,v). */
function apply(ctm: [number, number, number, number, number, number], u: number, v: number): [number, number] {
  const [a, b, c, d, e, f] = ctm;
  return [a * u + c * v + e, b * u + d * v + f];
}

describe('normRotation', () => {
  it('normalizes to 0|90|180|270', () => {
    expect(normRotation(undefined)).toBe(0);
    expect(normRotation(0)).toBe(0);
    expect(normRotation(90)).toBe(90);
    expect(normRotation(450)).toBe(90);   // 450 % 360 = 90
    expect(normRotation(-90)).toBe(270);  // wraps positive
    expect(normRotation(360)).toBe(0);
    expect(normRotation(270)).toBe(270);
    expect(normRotation(45)).toBe(0);     // non-quadrant → 0 (no rotation handling)
  });
});

describe('rotationGeometry', () => {
  it('R=0 → no transform, displayed height = content height (byte-identical path)', () => {
    const g = rotationGeometry(0, W, H);
    expect(g.ctm).toBeNull();
    expect(g.dispH).toBe(H);
  });

  it('R=90/270 swap the displayed height to the content width', () => {
    expect(rotationGeometry(90, W, H).dispH).toBe(W);
    expect(rotationGeometry(270, W, H).dispH).toBe(W);
    expect(rotationGeometry(180, W, H).dispH).toBe(H);
  });

  // The four displayed-frame corners (bottom-left origin) must map to the
  // physically-correct content-space corners after the inverse-/Rotate CTM.
  // displayed dims: 90/270 → (H wide × W tall); 180 → (W wide × H tall).
  it('R=90 maps displayed corners to content space correctly', () => {
    const { ctm } = rotationGeometry(90, W, H);
    expect(ctm).not.toBeNull();
    const m = ctm!;
    expect(apply(m, 0, 0)).toEqual([W, 0]);     // disp BL → content bottom-right
    expect(apply(m, 0, W)).toEqual([0, 0]);     // disp TL → content bottom-left
    expect(apply(m, H, 0)).toEqual([W, H]);     // disp BR → content top-right
    expect(apply(m, H, W)).toEqual([0, H]);     // disp TR → content top-left
  });

  it('R=180 maps displayed corners to content space correctly', () => {
    const m = rotationGeometry(180, W, H).ctm!;
    expect(apply(m, 0, 0)).toEqual([W, H]);     // disp BL → content top-right
    expect(apply(m, W, 0)).toEqual([0, H]);     // disp BR → content top-left
    expect(apply(m, 0, H)).toEqual([W, 0]);     // disp TL → content bottom-right
    expect(apply(m, W, H)).toEqual([0, 0]);     // disp TR → content bottom-left
  });

  it('R=270 maps displayed corners to content space correctly', () => {
    const m = rotationGeometry(270, W, H).ctm!;
    expect(apply(m, 0, 0)).toEqual([0, H]);     // disp BL → content top-left
    expect(apply(m, H, 0)).toEqual([0, 0]);     // disp BR → content bottom-left
    expect(apply(m, 0, W)).toEqual([W, H]);     // disp TL → content top-right
    expect(apply(m, H, W)).toEqual([W, 0]);     // disp TR → content bottom-right
  });

  it('rotation is distance-preserving — unit displayed vectors stay unit length', () => {
    for (const R of [90, 180, 270] as const) {
      const [a, b, c, d] = rotationGeometry(R, W, H).ctm!;
      // columns of the linear part are orthonormal for a pure rotation
      expect(Math.hypot(a, b)).toBeCloseTo(1, 10);
      expect(Math.hypot(c, d)).toBeCloseTo(1, 10);
      expect(a * c + b * d).toBeCloseTo(0, 10); // orthogonal
    }
  });
});

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  computeSignatureRect,
  makeSignatureTransparent,
  SIGNATURE_OVERSHOOT,
} from '../signatureImage';

describe('computeSignatureRect', () => {
  afterEach(() => vi.restoreAllMocks());

  it('fits a wide image into a narrow box, preserving aspect ratio', () => {
    // 400x50 image (8:1) into a 100x40 box — width-constrained.
    const rect = computeSignatureRect({ width: 400, height: 50 }, { x: 10, y: 20, w: 100, h: 40 }, { overshoot: 0 });
    const maxW = 100;
    const expectedScale = maxW / 400;
    expect(rect.w).toBeCloseTo(400 * expectedScale, 5);
    expect(rect.h).toBeCloseTo(50 * expectedScale, 5);
    expect(rect.h).toBeLessThanOrEqual(40 + 1e-6);
  });

  it('fits a tall image into a wide box, preserving aspect ratio', () => {
    // 60x200 image (tall) into a 200x50 box — height-constrained.
    const rect = computeSignatureRect({ width: 60, height: 200 }, { x: 0, y: 0, w: 200, h: 50 }, { overshoot: 0 });
    const expectedScale = 50 / 200;
    expect(rect.h).toBeCloseTo(200 * expectedScale, 5);
    expect(rect.w).toBeCloseTo(60 * expectedScale, 5);
  });

  it('exact-fit image (same aspect ratio as box) fills the box with no overshoot', () => {
    const rect = computeSignatureRect({ width: 200, height: 50 }, { x: 5, y: 5, w: 200, h: 50 }, { overshoot: 0 });
    expect(rect.w).toBeCloseTo(200, 5);
    expect(rect.h).toBeCloseTo(50, 5);
    expect(rect.x).toBeCloseTo(5, 5);
    expect(rect.y).toBeCloseTo(5, 5);
  });

  it('applies the configured overshoot fraction beyond the box dimensions', () => {
    // Square image, square box — width- and height-constrained equally, so the
    // overshoot fraction directly scales the result up from the box's own size.
    const rect = computeSignatureRect(
      { width: 100, height: 100 },
      { x: 0, y: 0, w: 50, h: 50 },
      { overshoot: 0.2, align: 'left', anchor: 'top' },
    );
    expect(rect.w).toBeCloseTo(60, 5); // 50 * 1.2
    expect(rect.h).toBeCloseTo(60, 5);
  });

  it('defaults to SIGNATURE_OVERSHOOT when no overshoot option is given', () => {
    const rect = computeSignatureRect(
      { width: 100, height: 100 },
      { x: 0, y: 0, w: 50, h: 50 },
      { align: 'left', anchor: 'top' },
    );
    expect(rect.w).toBeCloseTo(50 * (1 + SIGNATURE_OVERSHOOT), 5);
  });

  it('clamps overshoot at the LEFT hard limit, shrinking rather than clipping', () => {
    const rect = computeSignatureRect(
      { width: 100, height: 20 },
      { x: 10, y: 0, w: 50, h: 20 },
      {
        overshoot: 0.5, // would push x well left of 10
        align: 'left',
        anchor: 'top',
        hardLimits: { x: 10, y: 0, w: 200, h: 200 },
      },
    );
    expect(rect.x).toBeGreaterThanOrEqual(10 - 1e-6);
  });

  it('clamps overshoot at the RIGHT hard limit, shrinking rather than clipping', () => {
    const rect = computeSignatureRect(
      { width: 100, height: 20 },
      { x: 0, y: 0, w: 50, h: 20 },
      {
        overshoot: 0.5,
        align: 'right',
        anchor: 'top',
        hardLimits: { x: 0, y: 0, w: 55, h: 200 },
      },
    );
    expect(rect.x + rect.w).toBeLessThanOrEqual(55 + 1e-6);
  });

  it('clamps overshoot at the TOP hard limit', () => {
    const rect = computeSignatureRect(
      { width: 20, height: 100 },
      { x: 0, y: 10, w: 20, h: 50 },
      {
        overshoot: 0.5,
        align: 'left',
        anchor: 'top',
        hardLimits: { x: 0, y: 10, w: 200, h: 200 },
      },
    );
    expect(rect.y).toBeGreaterThanOrEqual(10 - 1e-6);
  });

  it('clamps overshoot at the BOTTOM hard limit — never collides with the row below', () => {
    const rect = computeSignatureRect(
      { width: 20, height: 100 },
      { x: 0, y: 0, w: 20, h: 50 },
      {
        overshoot: 0.5,
        align: 'left',
        anchor: 'bottom',
        hardLimits: { x: 0, y: 0, w: 200, h: 55 },
      },
    );
    expect(rect.y + rect.h).toBeLessThanOrEqual(55 + 1e-6);
  });

  it('returns a zero-size rect for a degenerate (zero-width) natural image', () => {
    const rect = computeSignatureRect({ width: 0, height: 50 }, { x: 3, y: 4, w: 100, h: 40 });
    expect(rect.w).toBe(0);
    expect(rect.h).toBe(0);
    expect(rect.x).toBe(3);
    expect(rect.y).toBe(4);
  });

  it('returns a zero-size rect for a degenerate (zero-height) box', () => {
    const rect = computeSignatureRect({ width: 100, height: 50 }, { x: 1, y: 2, w: 100, h: 0 });
    expect(rect.w).toBe(0);
    expect(rect.h).toBe(0);
  });

  it('returns a zero-size rect for negative/NaN dimensions rather than propagating NaN', () => {
    const rect = computeSignatureRect({ width: NaN, height: 50 }, { x: 0, y: 0, w: 100, h: 40 });
    expect(rect.w).toBe(0);
    expect(rect.h).toBe(0);
    expect(Number.isNaN(rect.x)).toBe(false);
  });
});

describe('makeSignatureTransparent', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns the original data URL unchanged when it is not a data:image URL', async () => {
    const input = 'not-a-data-url';
    const result = await makeSignatureTransparent(input);
    expect(result).toBe(input);
  });

  it('returns the original data URL unchanged if image loading fails', async () => {
    const original = global.Image;
    class FailingImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_v: string) {
        queueMicrotask(() => this.onerror?.());
      }
    }
    // @ts-expect-error test stub
    global.Image = FailingImage;
    const input = 'data:image/png;base64,AAAA';
    const result = await makeSignatureTransparent(input);
    expect(result).toBe(input);
    global.Image = original;
  });

  it('returns the original data URL unchanged if canvas 2D context is unavailable', async () => {
    const original = global.Image;
    class OkImage {
      naturalWidth = 10;
      naturalHeight = 10;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_v: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    // @ts-expect-error test stub
    global.Image = OkImage;

    const getContextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(null as unknown as RenderingContext);

    const input = 'data:image/png;base64,AAAA';
    const result = await makeSignatureTransparent(input);
    expect(result).toBe(input);

    getContextSpy.mockRestore();
    global.Image = original;
  });
});

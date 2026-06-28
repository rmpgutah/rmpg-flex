// client/src/utils/redaction/blur.test.ts
import { describe, it, expect } from 'vitest';
import { pixelate } from './blur';

describe('pixelate', () => {
  it('replaces each block with its average so all pixels in a block match', () => {
    const px = new Uint8ClampedArray([0, 0, 0, 255, 100, 100, 100, 255, 100, 100, 100, 255, 200, 200, 200, 255]);
    pixelate(px, 2, 2, 2);
    const mean = Math.round((0 + 100 + 100 + 200) / 4);
    for (let i = 0; i < 16; i += 4) expect(px[i]).toBe(mean);
  });
  it('preserves alpha and never throws on block larger than the image', () => {
    const px = new Uint8ClampedArray([10, 20, 30, 128]);
    expect(() => pixelate(px, 1, 1, 8)).not.toThrow();
    expect(px[3]).toBe(128);
  });
});

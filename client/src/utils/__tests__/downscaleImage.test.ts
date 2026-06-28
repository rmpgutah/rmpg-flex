import { describe, it, expect } from 'vitest';
import { downscaleDims } from '../downscaleImage';

describe('downscaleDims', () => {
  it('caps the long edge at maxDim and keeps aspect ratio', () => {
    expect(downscaleDims(4000, 3000, 1280)).toEqual({ w: 1280, h: 960, scaled: true });
  });
  it('handles portrait', () => {
    expect(downscaleDims(3000, 4000, 1280)).toEqual({ w: 960, h: 1280, scaled: true });
  });
  it('never upscales', () => {
    expect(downscaleDims(800, 600, 1280)).toEqual({ w: 800, h: 600, scaled: false });
  });
});

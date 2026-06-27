import { describe, it, expect } from 'vitest';
import { plateBoxToFrame, bestPlate, type PlateDetection } from '../fastAlpr';

describe('plateBoxToFrame', () => {
  it('maps a plate box from a 1:1 crop to the same frame coordinates', () => {
    // Crop sits at (400, 300), same 200x150 size as the canvas → scale=1
    const canvas = { width: 200, height: 150 };
    const plate: PlateDetection = { x: 50, y: 90, w: 100, h: 30, score: 0.9 };
    const [fx, fy, fw, fh] = plateBoxToFrame(plate, [400, 300, 200, 150], canvas);
    expect(fx).toBe(450);  // 400 + 50
    expect(fy).toBe(390);  // 300 + 90
    expect(fw).toBe(100);
    expect(fh).toBe(30);
  });

  it('scales up when the canvas is smaller than the crop region', () => {
    // Vehicle occupies 400x300 in the frame but we drew into a 200x150 canvas → 2x scale
    const canvas = { width: 200, height: 150 };
    const plate: PlateDetection = { x: 40, y: 80, w: 80, h: 20, score: 0.85 };
    const [fx, fy, fw, fh] = plateBoxToFrame(plate, [100, 200, 400, 300], canvas);
    expect(fx).toBeCloseTo(100 + 40 * 2);   // 180
    expect(fy).toBeCloseTo(200 + 80 * 2);   // 360
    expect(fw).toBeCloseTo(80 * 2);          // 160
    expect(fh).toBeCloseTo(20 * 2);          // 40
  });

  it('handles a crop that starts at the frame origin', () => {
    const canvas = { width: 640, height: 480 };
    const plate: PlateDetection = { x: 200, y: 300, w: 120, h: 40, score: 0.95 };
    const [fx, fy] = plateBoxToFrame(plate, [0, 0, 640, 480], canvas);
    expect(fx).toBe(200);
    expect(fy).toBe(300);
  });
});

describe('bestPlate', () => {
  it('returns null for an empty array', () => {
    expect(bestPlate([])).toBeNull();
  });

  it('picks the highest-confidence detection', () => {
    const plates: PlateDetection[] = [
      { x: 0, y: 0, w: 50, h: 20, score: 0.72 },
      { x: 10, y: 5, w: 55, h: 22, score: 0.91 },
      { x: 5, y: 2, w: 48, h: 19, score: 0.65 },
    ];
    expect(bestPlate(plates)?.score).toBe(0.91);
  });

  it('returns the only element when given a single detection', () => {
    const p: PlateDetection = { x: 10, y: 20, w: 80, h: 25, score: 0.8 };
    expect(bestPlate([p])).toBe(p);
  });
});

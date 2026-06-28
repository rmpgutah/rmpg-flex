import { describe, it, expect } from 'vitest';
import { isPlausibleDetection, filterDetections } from './detectionFilter';
import type { Detection } from './drivingPrediction';

const W = 1280, H = 720;
const det = (bbox: [number, number, number, number], score = 0.7, cls = 'car'): Detection => ({ bbox, score, cls });

describe('isPlausibleDetection', () => {
  it('accepts a normal lower-frame vehicle with good score', () => {
    expect(isPlausibleDetection(det([500, 450, 200, 150]), W, H)).toBe(true);
  });
  it('rejects a low-confidence detection (night glare false positive)', () => {
    expect(isPlausibleDetection(det([500, 450, 200, 150], 0.3), W, H)).toBe(false);
  });
  it('rejects a box whose centre sits in the sky band (traffic lights / streetlights)', () => {
    expect(isPlausibleDetection(det([600, 20, 60, 40]), W, H)).toBe(false);
  });
  it('rejects a tiny speck (sub-meaningful distant blob)', () => {
    expect(isPlausibleDetection(det([600, 500, 8, 6]), W, H)).toBe(false);
  });
  it('rejects a frame-filling box (ego hood / glare wash)', () => {
    expect(isPlausibleDetection(det([50, 100, 1200, 600]), W, H)).toBe(false);
  });
  it('rejects an extreme-aspect sliver (light streak)', () => {
    expect(isPlausibleDetection(det([100, 500, 300, 10]), W, H)).toBe(false);
  });
});

describe('filterDetections', () => {
  it('keeps only the plausible detections', () => {
    const dets = [
      det([500, 450, 200, 150]),         // keep
      det([600, 20, 60, 40]),            // sky
      det([600, 500, 8, 6]),             // speck
      det([200, 470, 180, 140], 0.62),   // keep
    ];
    const out = filterDetections(dets, W, H);
    expect(out.length).toBe(2);
  });
  it('honors a stricter minScore override', () => {
    const dets = [det([500, 450, 200, 150], 0.52)];
    expect(filterDetections(dets, W, H, { minScore: 0.6 }).length).toBe(0);
  });
});

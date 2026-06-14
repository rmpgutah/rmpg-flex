import { describe, it, expect } from 'vitest';
import {
  captureSource, sourceLabel, confidenceBand, hitTone,
  normalizeDetection, detectionBoxes, captureMatches, filterCaptures, eventTypeOptions,
  type GalleryCapture,
} from '../alprOverlay';

const cap = (over: Partial<GalleryCapture> = {}): GalleryCapture => ({
  id: 1, plate: 'ABC123', state: 'UT', confidence: 0.92, accepted: true, alerted: false,
  source: 'dashcam', event_type: 'Hard_Brake', created_at: '2026-06-14 12:00:00',
  image_url: '/img', annotated_image_url: null, detections: [], ...over,
});

describe('alprOverlay — classification', () => {
  it('captureSource normalizes + defaults to manual', () => {
    expect(captureSource({ source: 'dashcam' })).toBe('dashcam');
    expect(captureSource({ source: 'FIELD' as any })).toBe('field');
    expect(captureSource({ source: null })).toBe('manual');
    expect(captureSource({ source: 'weird' })).toBe('manual');
  });
  it('sourceLabel renders short labels', () => {
    expect(sourceLabel('dashcam')).toBe('DASHCAM');
    expect(sourceLabel('field')).toBe('FIELD CAM');
    expect(sourceLabel('manual')).toBe('MANUAL');
  });
  it('confidenceBand respects the explicit accepted flag, then the 0.85 gate', () => {
    expect(confidenceBand(0.4, true)).toBe('high');   // accepted overrides
    expect(confidenceBand(0.99, false)).toBe('low');  // rejected overrides
    expect(confidenceBand(0.9, null)).toBe('high');
    expect(confidenceBand(0.5, null)).toBe('low');
    expect(confidenceBand(null, null)).toBe('low');
  });
  it('hitTone flags alerted captures', () => {
    expect(hitTone({ alerted: true })).toBe('hit');
    expect(hitTone({ alerted: false })).toBe('clean');
  });
});

describe('alprOverlay — detection geometry', () => {
  it('center+size pixel detection scales to fractions of the natural size', () => {
    const b = normalizeDetection({ x: 100, y: 50, width: 40, height: 20, class: 'plate', confidence: 0.9 }, 200, 100);
    expect(b).not.toBeNull();
    expect(b!.left).toBeCloseTo(0.4);   // (100-20)/200
    expect(b!.top).toBeCloseTo(0.4);    // (50-10)/100
    expect(b!.width).toBeCloseTo(0.2);  // 40/200
    expect(b!.height).toBeCloseTo(0.2); // 20/100
    expect(b!.label).toBe('plate');
  });
  it('already-fractional coords are passed through (natural size ignored)', () => {
    const b = normalizeDetection({ x1: 0.1, y1: 0.2, x2: 0.5, y2: 0.6 }, 1920, 1080);
    expect(b!.left).toBeCloseTo(0.1);
    expect(b!.width).toBeCloseTo(0.4);
    expect(b!.height).toBeCloseTo(0.4);
  });
  it('corner array bbox works', () => {
    const b = normalizeDetection({ bbox: [10, 10, 110, 60] }, 200, 100);
    expect(b!.left).toBeCloseTo(0.05);
    expect(b!.width).toBeCloseTo(0.5);
  });
  it('clamps boxes that spill past the image edge', () => {
    const b = normalizeDetection({ x: 195, y: 95, width: 40, height: 20 }, 200, 100);
    expect(b!.left + b!.width).toBeLessThanOrEqual(1.0001);
    expect(b!.top + b!.height).toBeLessThanOrEqual(1.0001);
  });
  it('returns null for unusable detections', () => {
    expect(normalizeDetection(null)).toBeNull();
    expect(normalizeDetection({ foo: 1 })).toBeNull();
    expect(normalizeDetection({ x: 0, y: 0, width: 0, height: 0 }, 100, 100)).toBeNull();
  });
  it('detectionBoxes drops the unusable ones', () => {
    const boxes = detectionBoxes([{ x: 50, y: 50, width: 10, height: 10 }, { junk: true }], 100, 100);
    expect(boxes).toHaveLength(1);
  });
});

describe('alprOverlay — filtering', () => {
  const set: GalleryCapture[] = [
    cap({ id: 1, source: 'dashcam', accepted: true, alerted: true, plate: 'ABC123', event_type: 'Hard_Brake', created_at: '2026-06-10 10:00:00' }),
    cap({ id: 2, source: 'field', accepted: false, alerted: false, plate: 'XYZ789', event_type: 'Manual', created_at: '2026-06-12 10:00:00' }),
    cap({ id: 3, source: 'manual', accepted: true, alerted: false, plate: 'ABC999', event_type: null, created_at: '2026-06-14 10:00:00' }),
  ];
  it('filters by source', () => {
    expect(filterCaptures(set, { source: 'dashcam' }).map((c) => c.id)).toEqual([1]);
    expect(filterCaptures(set, { source: 'all' })).toHaveLength(3);
  });
  it('filters by confidence band', () => {
    expect(filterCaptures(set, { band: 'high' }).map((c) => c.id)).toEqual([1, 3]);
    expect(filterCaptures(set, { band: 'low' }).map((c) => c.id)).toEqual([2]);
  });
  it('filters by hits', () => {
    expect(filterCaptures(set, { hits: 'hits' }).map((c) => c.id)).toEqual([1]);
  });
  it('filters by plate substring (normalized)', () => {
    expect(filterCaptures(set, { plate: 'abc' }).map((c) => c.id)).toEqual([1, 3]);
  });
  it('filters by date range', () => {
    expect(filterCaptures(set, { from: '2026-06-12 00:00:00' }).map((c) => c.id)).toEqual([2, 3]);
    expect(filterCaptures(set, { to: '2026-06-11 00:00:00' }).map((c) => c.id)).toEqual([1]);
  });
  it('combines filters (AND)', () => {
    expect(filterCaptures(set, { source: 'dashcam', hits: 'hits', band: 'high' }).map((c) => c.id)).toEqual([1]);
  });
  it('eventTypeOptions returns distinct sorted types', () => {
    expect(eventTypeOptions(set)).toEqual(['Hard_Brake', 'Manual']);
  });
});

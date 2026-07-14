// client/src/utils/redaction/regions.test.ts
import { describe, it, expect } from 'vitest';
import { iou, interpBox, activeRegionsAt, mergeSamples, type RedactionRegion, type DetectorSample } from './regions';

const region = (over: Partial<RedactionRegion>): RedactionRegion => ({
  id: 'r', kind: 'plate', keyframes: [{ t: 0, box: [0, 0, 0.2, 0.2] }], tStart: 0, tEnd: 1,
  style: 'blur', strength: 12, source: 'auto', enabled: true, ...over,
});

describe('iou', () => {
  it('is 1 for identical boxes and 0 for disjoint', () => {
    expect(iou([0, 0, 1, 1], [0, 0, 1, 1])).toBeCloseTo(1);
    expect(iou([0, 0, 0.1, 0.1], [0.9, 0.9, 0.1, 0.1])).toBe(0);
  });
});

describe('interpBox', () => {
  it('linearly interpolates between surrounding keyframes', () => {
    const r = region({ keyframes: [{ t: 0, box: [0, 0, 0.2, 0.2] }, { t: 2, box: [0.4, 0, 0.2, 0.2] }], tStart: 0, tEnd: 2 });
    expect(interpBox(r, 1)[0]).toBeCloseTo(0.2);
  });
  it('clamps to the nearest keyframe outside the span', () => {
    const r = region({ keyframes: [{ t: 1, box: [0.5, 0, 0.2, 0.2] }], tStart: 1, tEnd: 1 });
    expect(interpBox(r, 0)[0]).toBeCloseTo(0.5);
    expect(interpBox(r, 9)[0]).toBeCloseTo(0.5);
  });
});

describe('activeRegionsAt', () => {
  it('returns only enabled regions whose span covers t', () => {
    const rs = [region({ id: 'a', tStart: 0, tEnd: 1 }), region({ id: 'b', tStart: 2, tEnd: 3 }), region({ id: 'c', tStart: 0, tEnd: 5, enabled: false })];
    expect(activeRegionsAt(rs, 0.5).map((r) => r.id)).toEqual(['a']);
    expect(activeRegionsAt(rs, 2.5).map((r) => r.id)).toEqual(['b']);
  });
});

describe('mergeSamples', () => {
  it('groups overlapping consecutive same-kind samples into one keyframed region', () => {
    const s: DetectorSample[] = [
      { kind: 'face', box: [0.1, 0.1, 0.1, 0.1], t: 0 },
      { kind: 'face', box: [0.12, 0.1, 0.1, 0.1], t: 0.25 },
      { kind: 'face', box: [0.8, 0.8, 0.1, 0.1], t: 0.25 },
    ];
    const out = mergeSamples(s, { scanInterval: 1 });
    expect(out.length).toBe(2);
    const tracked = out.find((r) => r.keyframes.length === 2)!;
    expect(tracked.tStart).toBeCloseTo(0);
    expect(tracked.tEnd).toBeCloseTo(0.25);
  });

  it('pads a lone sample by the scan interval', () => {
    const out = mergeSamples([{ kind: 'plate', box: [0, 0, 0.2, 0.1], t: 1 }], { scanInterval: 1 });
    expect(out[0].tStart).toBeCloseTo(0.5);
    expect(out[0].tEnd).toBeCloseTo(1.5);
  });

  it('drops a lone short-lived single-keyframe region as noise', () => {
    // A single 0.25s-interval sample pads to tStart=-0.125/tEnd=0.375 (duration
    // 0.25s) by the existing "pad a lone sample" behavior — below the default
    // 0.4s noise threshold, so it should be dropped entirely.
    const out = mergeSamples([{ kind: 'plate', box: [0, 0, 0.2, 0.1], t: 0.25 }], { scanInterval: 0.25 });
    expect(out).toEqual([]);
  });

  it('keeps a multi-keyframe region even if its total duration is short', () => {
    // Two merged samples 0.25s apart — duration 0.25s, same as the dropped
    // case above, but this one has 2 keyframes (a real tracked detection,
    // not a single blip) so it must NOT be dropped by the noise filter.
    const s: DetectorSample[] = [
      { kind: 'face', box: [0.1, 0.1, 0.1, 0.1], t: 0 },
      { kind: 'face', box: [0.12, 0.1, 0.1, 0.1], t: 0.25 },
    ];
    const out = mergeSamples(s, { scanInterval: 0.25 });
    expect(out.length).toBe(1);
    expect(out[0].keyframes.length).toBe(2);
  });

  it('keeps a lone single-keyframe region at or above the noise duration threshold', () => {
    // A lone sample padded by a LARGER scanInterval clears the 0.4s default
    // threshold (pad is ±scanInterval/2, so scanInterval=1 → 1s duration).
    const out = mergeSamples([{ kind: 'plate', box: [0, 0, 0.2, 0.1], t: 1 }], { scanInterval: 1 });
    expect(out.length).toBe(1);
  });
});

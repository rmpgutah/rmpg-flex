import { describe, it, expect } from 'vitest';
import { parseDeepScanFrame, type RawDeepScanDetection } from '../src/utils/redactionDeepScan';

describe('parseDeepScanFrame', () => {
  it('converts valid detections into DetectorSamples at the given timestamp', () => {
    const raw: RawDeepScanDetection[] = [
      { kind: 'face', box: [0.1, 0.2, 0.15, 0.2], confidence: 0.9 },
      { kind: 'plate', box: [0.5, 0.6, 0.1, 0.05], confidence: 0.7 },
    ];
    const out = parseDeepScanFrame(raw, 12.5);
    expect(out).toEqual([
      { kind: 'face', box: [0.1, 0.2, 0.15, 0.2], t: 12.5 },
      { kind: 'plate', box: [0.5, 0.6, 0.1, 0.05], t: 12.5 },
    ]);
  });

  it('drops detections with a kind other than face or plate', () => {
    const raw = [{ kind: 'vehicle', box: [0.1, 0.1, 0.1, 0.1], confidence: 0.9 }] as unknown as RawDeepScanDetection[];
    expect(parseDeepScanFrame(raw, 1)).toEqual([]);
  });

  it('drops detections with out-of-range or degenerate normalized coordinates', () => {
    const raw: RawDeepScanDetection[] = [
      { kind: 'face', box: [-0.1, 0.2, 0.1, 0.1], confidence: 0.9 },   // negative x
      { kind: 'face', box: [0.9, 0.2, 0.3, 0.1], confidence: 0.9 },    // x+w > 1
      { kind: 'face', box: [0.1, 0.2, 0, 0.1], confidence: 0.9 },      // zero width
      { kind: 'face', box: [0.1, 0.2, 0.1, 0.1], confidence: 0.9 },    // valid — should survive
    ];
    const out = parseDeepScanFrame(raw, 1);
    expect(out).toEqual([{ kind: 'face', box: [0.1, 0.2, 0.1, 0.1], t: 1 }]);
  });

  it('drops detections below the confidence threshold', () => {
    const raw: RawDeepScanDetection[] = [
      { kind: 'face', box: [0.1, 0.1, 0.1, 0.1], confidence: 0.2 },
      { kind: 'face', box: [0.2, 0.2, 0.1, 0.1], confidence: 0.5 },
    ];
    const out = parseDeepScanFrame(raw, 1, 0.4);
    expect(out).toEqual([{ kind: 'face', box: [0.2, 0.2, 0.1, 0.1], t: 1 }]);
  });

  it('clamps confidence to [0,1] before applying the threshold, rather than dropping out-of-range values outright', () => {
    const raw: RawDeepScanDetection[] = [{ kind: 'plate', box: [0.1, 0.1, 0.1, 0.1], confidence: 5 }];
    expect(parseDeepScanFrame(raw, 1)).toEqual([{ kind: 'plate', box: [0.1, 0.1, 0.1, 0.1], t: 1 }]);
  });

  it('returns [] for an empty input array', () => {
    expect(parseDeepScanFrame([], 1)).toEqual([]);
  });

  it('skips malformed array elements (null, non-object) without throwing', () => {
    const raw = [null, { kind: 'face', box: [0.1, 0.1, 0.1, 0.1], confidence: 0.9 }, 'garbage', 42] as unknown as RawDeepScanDetection[];
    expect(() => parseDeepScanFrame(raw, 1)).not.toThrow();
    expect(parseDeepScanFrame(raw, 1)).toEqual([{ kind: 'face', box: [0.1, 0.1, 0.1, 0.1], t: 1 }]);
  });

  it('returns [] instead of throwing when detections is not an array', () => {
    expect(() => parseDeepScanFrame(null as any, 1)).not.toThrow();
    expect(parseDeepScanFrame(null as any, 1)).toEqual([]);
    expect(parseDeepScanFrame(undefined as any, 1)).toEqual([]);
    expect(parseDeepScanFrame({} as any, 1)).toEqual([]);
  });
});

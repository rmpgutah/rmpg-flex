import { describe, it, expect } from 'vitest';
import {
  computeThumb,
  scrollLeftFromThumb,
  scrollLeftFromTrackClick,
} from '../tabScrollbarGeometry';

describe('computeThumb', () => {
  it('reports not visible when the strip does not overflow', () => {
    expect(computeThumb({ scrollLeft: 0, scrollWidth: 500, clientWidth: 500, trackWidth: 500, minThumb: 28 }))
      .toEqual({ visible: false, thumbWidth: 0, thumbLeft: 0 });
    // content narrower than the viewport also counts as no-overflow
    expect(computeThumb({ scrollLeft: 0, scrollWidth: 400, clientWidth: 500, trackWidth: 500, minThumb: 28 }).visible)
      .toBe(false);
  });

  it('sizes the thumb proportionally and pins it left at scrollLeft 0', () => {
    const r = computeThumb({ scrollLeft: 0, scrollWidth: 1000, clientWidth: 500, trackWidth: 500, minThumb: 28 });
    expect(r).toEqual({ visible: true, thumbWidth: 250, thumbLeft: 0 });
  });

  it('pins the thumb flush-right at max scroll', () => {
    const r = computeThumb({ scrollLeft: 500, scrollWidth: 1000, clientWidth: 500, trackWidth: 500, minThumb: 28 });
    // maxThumbLeft = trackWidth(500) - thumbWidth(250) = 250
    expect(r.thumbLeft).toBe(250);
    expect(r.thumbLeft + r.thumbWidth).toBe(500);
  });

  it('places the thumb at the midpoint for a mid scroll', () => {
    const r = computeThumb({ scrollLeft: 250, scrollWidth: 1000, clientWidth: 500, trackWidth: 500, minThumb: 28 });
    expect(r.thumbLeft).toBe(125); // (250/500) * 250
  });

  it('enforces the minimum thumb width on very wide content', () => {
    const r = computeThumb({ scrollLeft: 0, scrollWidth: 10000, clientWidth: 500, trackWidth: 500, minThumb: 28 });
    expect(r.thumbWidth).toBe(28); // raw 25 floored up to 28
  });

  it('clamps thumbLeft so it never overruns the track', () => {
    const r = computeThumb({ scrollLeft: 9999, scrollWidth: 1000, clientWidth: 500, trackWidth: 500, minThumb: 28 });
    expect(r.thumbLeft).toBe(250); // clamped to maxThumbLeft, not beyond
  });
});

describe('scrollLeftFromThumb', () => {
  const base = { trackWidth: 500, thumbWidth: 250, scrollWidth: 1000, clientWidth: 500 };

  it('maps thumbLeft 0 to scrollLeft 0', () => {
    expect(scrollLeftFromThumb({ thumbLeft: 0, ...base })).toBe(0);
  });

  it('maps thumbLeft at the right edge to max scrollLeft', () => {
    expect(scrollLeftFromThumb({ thumbLeft: 250, ...base })).toBe(500);
  });

  it('is the inverse of computeThumb for a mid position', () => {
    expect(scrollLeftFromThumb({ thumbLeft: 125, ...base })).toBe(250);
  });

  it('clamps when the thumb is dragged past the end', () => {
    expect(scrollLeftFromThumb({ thumbLeft: 400, ...base })).toBe(500);
  });

  it('returns 0 when there is no room to scroll', () => {
    expect(scrollLeftFromThumb({ thumbLeft: 100, trackWidth: 500, thumbWidth: 500, scrollWidth: 500, clientWidth: 500 }))
      .toBe(0);
  });
});

describe('scrollLeftFromTrackClick', () => {
  const base = { trackWidth: 500, scrollWidth: 1000, clientWidth: 500 };

  it('centers the viewport on a mid-track click', () => {
    expect(scrollLeftFromTrackClick({ clickX: 250, ...base })).toBe(250);
  });

  it('clamps to 0 when clicking near the start', () => {
    expect(scrollLeftFromTrackClick({ clickX: 0, ...base })).toBe(0);
  });

  it('clamps to max when clicking near the end', () => {
    expect(scrollLeftFromTrackClick({ clickX: 500, ...base })).toBe(500);
  });
});

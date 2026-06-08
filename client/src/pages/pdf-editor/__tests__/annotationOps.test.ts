import { describe, it, expect } from 'vitest';
import {
  boundingBox,
  alignAnnotations,
  distributeAnnotations,
  matchSize,
} from '../annotationOps';
import type { Annotation } from '../types';

// Minimal annotation factory — only the geometry fields matter for these ops.
function rect(id: string, x: number, y: number, w = 10, h = 10, extra: Partial<Annotation> = {}): Annotation {
  return { id, type: 'rect', page: 1, x, y, w, h, ...extra } as Annotation;
}

const sel = (...ids: string[]) => new Set(ids);

describe('boundingBox', () => {
  it('encloses all boxes', () => {
    expect(boundingBox([{ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 5, w: 10, h: 30 }]))
      .toEqual({ x: 0, y: 0, w: 30, h: 35 });
  });
  it('returns null for empty input', () => {
    expect(boundingBox([])).toBeNull();
  });
});

describe('alignAnnotations', () => {
  const anns = [rect('a', 0, 0, 10, 10), rect('b', 50, 20, 30, 10), rect('c', 100, 40, 10, 10)];

  it('aligns left edges to the selection min-x', () => {
    const out = alignAnnotations(anns, sel('a', 'b', 'c'), 'left');
    expect(out.map((a) => a.x)).toEqual([0, 0, 0]);
  });

  it('aligns right edges so right side matches max', () => {
    const out = alignAnnotations(anns, sel('a', 'b', 'c'), 'right');
    // bb right edge = 110; each x = 110 - w
    expect(out.map((a) => a.x)).toEqual([100, 80, 100]);
  });

  it('centers horizontally within the bounding box', () => {
    const out = alignAnnotations(anns, sel('a', 'b', 'c'), 'hcenter');
    // bb: x=0 w=110 → center=55; x = 55 - w/2
    expect(out.find((a) => a.id === 'a')!.x).toBe(50);
    expect(out.find((a) => a.id === 'b')!.x).toBe(40);
  });

  it('aligns tops and bottoms', () => {
    expect(alignAnnotations(anns, sel('a', 'b', 'c'), 'top').map((a) => a.y)).toEqual([0, 0, 0]);
    const bottom = alignAnnotations(anns, sel('a', 'b', 'c'), 'bottom');
    expect(bottom.find((a) => a.id === 'a')!.y).toBe(40); // bb bottom 50 - h10
  });

  it('is a no-op for fewer than 2 movable selections', () => {
    expect(alignAnnotations(anns, sel('a'), 'left')).toBe(anns);
  });

  it('skips locked annotations', () => {
    const locked = [rect('a', 0, 0), rect('b', 50, 0, 10, 10, { locked: true })];
    const out = alignAnnotations(locked, sel('a', 'b'), 'left');
    // only 1 movable → no-op
    expect(out).toBe(locked);
  });
});

describe('distributeAnnotations', () => {
  it('equalises horizontal gaps, anchoring the extremes', () => {
    // three 10-wide boxes spanning x=0..100; middle should center the gaps
    const anns = [rect('a', 0, 0), rect('b', 40, 0), rect('c', 90, 0)];
    const out = distributeAnnotations(anns, sel('a', 'b', 'c'), 'horizontal');
    // span 0..100, total width 30, gap = (100-30)/2 = 35 → b at 0+10+35 = 45
    expect(out.find((a) => a.id === 'a')!.x).toBe(0);
    expect(out.find((a) => a.id === 'b')!.x).toBe(45);
    expect(out.find((a) => a.id === 'c')!.x).toBe(90);
  });

  it('is a no-op for fewer than 3', () => {
    const anns = [rect('a', 0, 0), rect('b', 40, 0)];
    expect(distributeAnnotations(anns, sel('a', 'b'), 'horizontal')).toBe(anns);
  });
});

describe('matchSize', () => {
  const anns = [rect('a', 0, 0, 10, 10), rect('b', 50, 0, 30, 40)];

  it('matches width to the anchor, leaving the anchor untouched', () => {
    const out = matchSize(anns, sel('a', 'b'), 'b', 'width');
    expect(out.find((a) => a.id === 'a')!.w).toBe(30);
    expect(out.find((a) => a.id === 'a')!.h).toBe(10); // unchanged
    expect(out.find((a) => a.id === 'b')!.w).toBe(30); // anchor unchanged
  });

  it('matches both dimensions', () => {
    const out = matchSize(anns, sel('a', 'b'), 'b', 'both');
    const a = out.find((x) => x.id === 'a')!;
    expect([a.w, a.h]).toEqual([30, 40]);
  });
});

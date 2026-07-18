import { describe, it, expect } from 'vitest';
import { normalizeDesktopLayout, serializeDesktopLayout } from './normalizeDesktopLayout';

describe('normalizeDesktopLayout', () => {
  it('upgrades a v1 flat icon-position array into the v2 shape', () => {
    const raw = JSON.stringify([{ path: '/dispatch', x: 20, y: 20 }, { path: '/map', x: 116, y: 20 }]);
    const layout = normalizeDesktopLayout(raw);
    expect(layout).toEqual({
      icons: [{ path: '/dispatch', x: 20, y: 20 }, { path: '/map', x: 116, y: 20 }],
      groups: [],
      iconSize: 'medium',
      viewMode: 'grid',
      sortMode: 'manual',
    });
  });

  it('passes through an already-v2-shape object, filling in any missing fields', () => {
    const raw = JSON.stringify({ icons: [{ path: '/records', x: 5, y: 5 }], iconSize: 'large' });
    const layout = normalizeDesktopLayout(raw);
    expect(layout).toEqual({
      icons: [{ path: '/records', x: 5, y: 5 }],
      groups: [],
      iconSize: 'large',
      viewMode: 'grid',
      sortMode: 'manual',
    });
  });

  it('returns an empty default layout for null, undefined, or invalid JSON', () => {
    const empty = { icons: [], groups: [], iconSize: 'medium', viewMode: 'grid', sortMode: 'manual' };
    expect(normalizeDesktopLayout(null)).toEqual(empty);
    expect(normalizeDesktopLayout(undefined)).toEqual(empty);
    expect(normalizeDesktopLayout('{not json')).toEqual(empty);
  });

  it('serializeDesktopLayout round-trips through normalizeDesktopLayout', () => {
    const layout = {
      icons: [{ path: '/dispatch', x: 1, y: 2 }],
      groups: [{ id: 'g1', label: 'Ops', x: 0, y: 0, w: 200, h: 100, memberPaths: ['/dispatch'] }],
      iconSize: 'small' as const,
      viewMode: 'list' as const,
      sortMode: 'alpha' as const,
    };
    expect(normalizeDesktopLayout(serializeDesktopLayout(layout))).toEqual(layout);
  });
});

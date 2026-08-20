import { describe, it, expect } from 'vitest';
import { LayoutDashboard, Map as MapIcon, Users } from 'lucide-react';
import { sortIconPositions, snapToGrid, nextAutoArrangeSlot } from './desktopLayoutOps';
import type { NavFunction } from '../data/navCatalog';

const ICONS: NavFunction[] = [
  { path: '/records', label: 'Records', icon: Users, description: 'r' },
  { path: '/dispatch', label: 'Dispatch', icon: LayoutDashboard, description: 'd' },
  { path: '/map', label: 'Live Map', icon: MapIcon, description: 'm' },
];

describe('sortIconPositions', () => {
  it('alpha mode lays out icons left-to-right, top-to-bottom by label', () => {
    const positions = sortIconPositions(ICONS, 'alpha', []);
    // Dispatch < Live Map < Records alphabetically
    expect(positions['/dispatch'].x).toBeLessThan(positions['/map'].x);
    expect(positions['/map'].x).toBeLessThan(positions['/records'].x);
    expect(positions['/dispatch'].y).toBe(positions['/map'].y);
  });

  it('usage mode orders by position in recentPaths (most-recent first), unlisted icons last', () => {
    const positions = sortIconPositions(ICONS, 'usage', ['/map', '/records']);
    expect(positions['/map'].x).toBeLessThan(positions['/records'].x);
    expect(positions['/records'].x).toBeLessThan(positions['/dispatch'].x); // not in recentPaths — last
  });
});

describe('snapToGrid', () => {
  it('rounds every position to the nearest 96px grid cell', () => {
    const snapped = snapToGrid({ '/dispatch': { x: 130, y: 47 }, '/map': { x: 10, y: 200 } });
    expect(snapped['/dispatch']).toEqual({ x: 96, y: 0 });
    expect(snapped['/map']).toEqual({ x: 0, y: 192 });
  });
});

describe('nextAutoArrangeSlot', () => {
  it('returns the first grid cell (20, 20) when nothing is occupied', () => {
    expect(nextAutoArrangeSlot({})).toEqual({ x: 20, y: 20 });
  });

  it('returns the next cell in row order when cells are occupied contiguously from the start', () => {
    const occupied = { a: { x: 20, y: 20 }, b: { x: 116, y: 20 } };
    expect(nextAutoArrangeSlot(occupied)).toEqual({ x: 212, y: 20 });
  });

  it('fills a gap left by a removed icon rather than appending after the last occupied cell', () => {
    // Cells 0 and 2 occupied (cell 1, at x=116,y=20, is a gap from an unpinned icon).
    const occupied = { a: { x: 20, y: 20 }, c: { x: 212, y: 20 } };
    expect(nextAutoArrangeSlot(occupied)).toEqual({ x: 116, y: 20 });
  });

  it('wraps to the next row after filling 6 columns (GRID_COLS)', () => {
    const occupied: Record<string, { x: number; y: number }> = {};
    for (let i = 0; i < 6; i++) occupied[`p${i}`] = { x: (i % 6) * 96 + 20, y: Math.floor(i / 6) * 96 + 20 };
    expect(nextAutoArrangeSlot(occupied)).toEqual({ x: 20, y: 116 });
  });
});

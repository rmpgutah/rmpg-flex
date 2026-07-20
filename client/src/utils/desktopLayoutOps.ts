import type { NavFunction } from '../data/navCatalog';

const GRID_COLS = 6;
const CELL_W = 96;
const CELL_H = 96;

function gridLayout(orderedPaths: string[]): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = {};
  orderedPaths.forEach((path, i) => {
    positions[path] = { x: (i % GRID_COLS) * CELL_W + 20, y: Math.floor(i / GRID_COLS) * CELL_H + 20 };
  });
  return positions;
}

export function sortIconPositions(
  icons: NavFunction[],
  mode: 'alpha' | 'usage',
  recentPaths: string[],
): Record<string, { x: number; y: number }> {
  if (mode === 'alpha') {
    const ordered = [...icons].sort((a, b) => a.label.localeCompare(b.label)).map(fn => fn.path);
    return gridLayout(ordered);
  }
  // usage: most-recently-used first (per recentPaths order), anything not in
  // recentPaths keeps its original catalog order at the end.
  const recentIndex = new Map(recentPaths.map((p, i) => [p, i]));
  const ordered = [...icons]
    .sort((a, b) => {
      const ai = recentIndex.has(a.path) ? recentIndex.get(a.path)! : Number.MAX_SAFE_INTEGER;
      const bi = recentIndex.has(b.path) ? recentIndex.get(b.path)! : Number.MAX_SAFE_INTEGER;
      return ai - bi;
    })
    .map(fn => fn.path);
  return gridLayout(ordered);
}

export function snapToGrid(positions: Record<string, { x: number; y: number }>): Record<string, { x: number; y: number }> {
  const snapped: Record<string, { x: number; y: number }> = {};
  for (const [path, pos] of Object.entries(positions)) {
    snapped[path] = { x: Math.round(pos.x / CELL_W) * CELL_W, y: Math.round(pos.y / CELL_H) * CELL_H };
  }
  return snapped;
}

export function nextAutoArrangeSlot(
  occupied: Record<string, { x: number; y: number }>,
): { x: number; y: number } {
  const taken = new Set(Object.values(occupied).map(pos => `${pos.x},${pos.y}`));
  for (let i = 0; ; i++) {
    const x = (i % GRID_COLS) * CELL_W + 20;
    const y = Math.floor(i / GRID_COLS) * CELL_H + 20;
    if (!taken.has(`${x},${y}`)) return { x, y };
  }
}

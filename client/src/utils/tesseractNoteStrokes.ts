export type NoteTool = 'highlight' | 'circle' | 'arrow';

export interface NoteStroke {
  tool: NoteTool;
  points: [number, number][];
  color: string;
  page?: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Highlight traces every pointer sample; circle/arrow keep origin + live end. */
export function appendStrokePoint(stroke: NoteStroke, p: Point): NoteStroke {
  if (stroke.tool === 'highlight') {
    const last = stroke.points[stroke.points.length - 1];
    if (last && last[0] === p.x && last[1] === p.y) return stroke;
    return { ...stroke, points: [...stroke.points, [p.x, p.y]] };
  }
  const origin = stroke.points[0] ?? [p.x, p.y];
  return { ...stroke, points: [origin, [p.x, p.y]] };
}

export function pct(n: number, total: number): number {
  if (!total) return 0;
  return (n / total) * 100;
}

export function ellipseFromPoints(a: [number, number], b: [number, number]): {
  cx: number; cy: number; rx: number; ry: number;
} {
  const cx = (a[0] + b[0]) / 2;
  const cy = (a[1] + b[1]) / 2;
  return { cx, cy, rx: Math.abs(b[0] - a[0]) / 2, ry: Math.abs(b[1] - a[1]) / 2 };
}

/** Arrowhead triangle in the same coordinate space as the stroke points. */
export function arrowHead(from: [number, number], to: [number, number], size = 14): [number, number][] {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const left: [number, number] = [to[0] - ux * size - uy * (size * 0.45), to[1] - uy * size + ux * (size * 0.45)];
  const right: [number, number] = [to[0] - ux * size + uy * (size * 0.45), to[1] - uy * size - ux * (size * 0.45)];
  return [to, left, right];
}

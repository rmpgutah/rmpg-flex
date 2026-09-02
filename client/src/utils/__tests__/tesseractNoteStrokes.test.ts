import { describe, test, expect } from 'vitest';
import { appendStrokePoint, arrowHead, ellipseFromPoints } from '../tesseractNoteStrokes';

describe('tesseract note strokes', () => {
  test('highlight appends every distinct point', () => {
    const start = { tool: 'highlight' as const, points: [[0, 0] as [number, number]], color: '#fff' };
    const next = appendStrokePoint(start, { x: 4, y: 5 });
    expect(next.points).toEqual([[0, 0], [4, 5]]);
  });

  test('circle and arrow keep only origin and live end', () => {
    const start = { tool: 'circle' as const, points: [[10, 10] as [number, number]], color: '#00f' };
    const mid = appendStrokePoint(start, { x: 20, y: 30 });
    const end = appendStrokePoint(mid, { x: 40, y: 50 });
    expect(end.points).toEqual([[10, 10], [40, 50]]);
  });

  test('ellipse is the bounding box of the two corners', () => {
    expect(ellipseFromPoints([0, 0], [20, 10])).toEqual({ cx: 10, cy: 5, rx: 10, ry: 5 });
  });

  test('arrowhead is a triangle pointing at the end', () => {
    const head = arrowHead([0, 0], [100, 0], 10);
    expect(head[0]).toEqual([100, 0]);
    expect(head[1][0]).toBeLessThan(100);
    expect(head[2][0]).toBeLessThan(100);
  });
});

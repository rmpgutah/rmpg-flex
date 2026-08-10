import { describe, test, expect } from 'vitest';
import { imageToNaturalCoords } from '../src/utils/tesseractImageCoords';

describe('imageToNaturalCoords', () => {
  test('identity when displayed at natural size', () => {
    const rect = { left: 0, top: 0, width: 800, height: 600 };
    const result = imageToNaturalCoords(rect, 800, 600, { x: 400, y: 300 });
    expect(result).toEqual({ x: 400, y: 300 });
  });

  test('scales up when displayed smaller than natural size', () => {
    // Image is natively 1600x1200 but rendered at 800x600 (half scale).
    const rect = { left: 0, top: 0, width: 800, height: 600 };
    const result = imageToNaturalCoords(rect, 1600, 1200, { x: 400, y: 300 });
    expect(result).toEqual({ x: 800, y: 600 });
  });

  test('accounts for the rect offset (image not at page origin)', () => {
    const rect = { left: 50, top: 20, width: 800, height: 600 };
    const result = imageToNaturalCoords(rect, 800, 600, { x: 450, y: 320 });
    // Point at (450,320) in PAGE coordinates, minus the (50,20) offset,
    // is (400,300) in the image's own display coordinates.
    expect(result).toEqual({ x: 400, y: 300 });
  });

  test('clamps out-of-bounds points to the image edges', () => {
    const rect = { left: 0, top: 0, width: 800, height: 600 };
    expect(imageToNaturalCoords(rect, 800, 600, { x: -10, y: 900 })).toEqual({ x: 0, y: 600 });
  });
});

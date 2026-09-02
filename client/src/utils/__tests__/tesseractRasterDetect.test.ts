import { describe, test, expect } from 'vitest';
import { isImageMime, isPdfBytes } from '../tesseractDocMime';

describe('tesseract pdf/image detection', () => {
  test('detects PDF from MIME or %PDF magic', () => {
    const magic = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
    expect(isPdfBytes(magic, 'application/octet-stream')).toBe(true);
    expect(isPdfBytes(new Uint8Array([0, 1, 2]), 'application/pdf')).toBe(true);
    expect(isPdfBytes(new Uint8Array([0, 1, 2]), 'image/png')).toBe(false);
  });

  test('detects image MIME types', () => {
    expect(isImageMime('image/jpeg')).toBe(true);
    expect(isImageMime('application/pdf')).toBe(false);
  });
});

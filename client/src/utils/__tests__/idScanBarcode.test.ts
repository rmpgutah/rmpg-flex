import { describe, it, expect } from 'vitest';
import { extractZxingText, LIVE_PDF417_CROP } from '../pdf417Payload';

describe('extractZxingText', () => {
  it('decodes latin-1 bytes including AAMVA record-separator', () => {
    const header = '@\n\x1e\rANSI 636040080002DLDAQ123456789';
    const bytes = new TextEncoder().encode(header); // UTF-8 happens to match latin-1 for this ASCII
    const latin = Uint8Array.from(header, (c) => c.charCodeAt(0));
    expect(extractZxingText({ isValid: false, bytes: latin })).toBe(header);
    expect(extractZxingText({ isValid: true, bytes })).toBe(header);
  });

  it('falls back to .text when bytes are empty', () => {
    const text = '@\n\x1e\rANSI 636040080002DLDAQ123456789';
    expect(extractZxingText({ isValid: false, text })).toBe(text);
  });

  it('rejects short junk even if ZXing marked it valid', () => {
    expect(extractZxingText({ isValid: true, text: 'hi' })).toBeNull();
    expect(extractZxingText(null)).toBeNull();
  });
});

describe('live PDF417 crop', () => {
  it('is a horizontal strip covering most of the frame width', () => {
    expect(LIVE_PDF417_CROP.wFrac).toBeGreaterThan(0.8);
    expect(LIVE_PDF417_CROP.hFrac).toBeLessThan(0.6);
    expect(LIVE_PDF417_CROP.yFrac).toBeLessThan(0.2);
  });
});

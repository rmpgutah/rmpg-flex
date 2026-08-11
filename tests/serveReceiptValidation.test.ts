import { describe, it, expect } from 'vitest';

describe('validPageImage', () => {
  it('accepts a JPEG data URL under 2MB', async () => {
    const { validPageImage } = await import('../src/routes/serveReceipt');
    // Build a minimal valid JPEG: FF D8 FF in base64 = /9j/
    const small = 'data:image/jpeg;base64,/9j/' + 'A'.repeat(200);
    expect(validPageImage(small)).toBe(true);
  });

  it('rejects a data URL over 2MB', async () => {
    const { validPageImage } = await import('../src/routes/serveReceipt');
    const big = 'data:image/jpeg;base64,/9j/' + 'A'.repeat(2_100_000);
    expect(validPageImage(big)).toBe(false);
  });

  it('rejects SVG (XSS vector)', async () => {
    const { validPageImage } = await import('../src/routes/serveReceipt');
    const svg = 'data:image/svg+xml;base64,' + btoa('<svg></svg>');
    expect(validPageImage(svg)).toBe(false);
  });

  it('rejects non-string input', async () => {
    const { validPageImage } = await import('../src/routes/serveReceipt');
    expect(validPageImage(null)).toBe(false);
    expect(validPageImage(42)).toBe(false);
    expect(validPageImage(undefined)).toBe(false);
  });
});

describe('validIdPhoto', () => {
  it('accepts a PNG data URL under 2MB', async () => {
    const { validIdPhoto } = await import('../src/routes/serveReceipt');
    // PNG magic: 89 50 4E 47 in base64 = iVBORw==
    const small = 'data:image/png;base64,iVBORw' + 'A'.repeat(200);
    expect(validIdPhoto(small)).toBe(true);
  });

  it('accepts a JPEG data URL under 2MB', async () => {
    const { validIdPhoto } = await import('../src/routes/serveReceipt');
    const small = 'data:image/jpeg;base64,/9j/' + 'A'.repeat(200);
    expect(validIdPhoto(small)).toBe(true);
  });

  it('rejects non-string input', async () => {
    const { validIdPhoto } = await import('../src/routes/serveReceipt');
    expect(validIdPhoto(null)).toBe(false);
    expect(validIdPhoto(42)).toBe(false);
  });

  it('rejects too-short payload', async () => {
    const { validIdPhoto } = await import('../src/routes/serveReceipt');
    const tiny = 'data:image/png;base64,iVBORw';
    expect(validIdPhoto(tiny)).toBe(false);
  });
});

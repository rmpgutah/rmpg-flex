import { describe, it, expect } from 'vitest';
import { extractGpsFromPhoto } from '../photoExif';

describe('extractGpsFromPhoto', () => {
  it('returns null for a non-image buffer', async () => {
    const buf = Buffer.from('not an image at all — just plain text');
    expect(await extractGpsFromPhoto(buf)).toBe(null);
  });

  it('returns null for an empty buffer', async () => {
    expect(await extractGpsFromPhoto(Buffer.alloc(0))).toBe(null);
  });

  it('returns null for a minimal JPEG with no EXIF block', async () => {
    // Smallest valid-enough JPEG header — SOI + EOI, no APP1/EXIF segment.
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    expect(await extractGpsFromPhoto(buf)).toBe(null);
  });

  it('does not throw on corrupted JPEG-like input', async () => {
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x00, 0x45, 0x78]);
    await expect(extractGpsFromPhoto(buf)).resolves.toBe(null);
  });
});

import { describe, it, expect } from 'vitest';
import { validateMp4Header, isDuplicateContent, formatRejectionReason } from '../src/utils/footage/integrity';

// Build a Uint8Array that LOOKS like a real MP4 ftyp box.
// MP4 ISO-BMFF starts with 4-byte big-endian size + 4-byte type 'ftyp' +
// 4-byte major brand + 4-byte minor version + compatible brands.
function fakeFtypBytes(majorBrand = 'isom'): Uint8Array {
  // size=32, type=ftyp, major=isom, minor=0x0200, compat=isom mp41
  const buf = new Uint8Array(32);
  // size
  buf[0] = 0; buf[1] = 0; buf[2] = 0; buf[3] = 32;
  // 'ftyp'
  buf[4] = 0x66; buf[5] = 0x74; buf[6] = 0x79; buf[7] = 0x70;
  // major brand
  for (let i = 0; i < 4; i++) buf[8 + i] = majorBrand.charCodeAt(i);
  return buf;
}

describe('validateMp4Header', () => {
  it('accepts a valid ftyp-prefixed MP4', () => {
    expect(validateMp4Header(fakeFtypBytes())).toBe(true);
  });

  it('accepts ftyp regardless of brand (isom / mp42 / qt / etc.)', () => {
    expect(validateMp4Header(fakeFtypBytes('mp42'))).toBe(true);
    expect(validateMp4Header(fakeFtypBytes('qt  '))).toBe(true);
  });

  it('rejects bytes too short to contain an ftyp box', () => {
    expect(validateMp4Header(new Uint8Array(0))).toBe(false);
    expect(validateMp4Header(new Uint8Array(4))).toBe(false);
    expect(validateMp4Header(new Uint8Array(7))).toBe(false); // need at least 8
  });

  it('rejects JSON error bodies served as binary (e.g. {"error":"..."})', () => {
    const json = new TextEncoder().encode('{"error":"Forbidden","code":403,"detail":"signed url expired"}');
    expect(validateMp4Header(json)).toBe(false);
  });

  it('rejects HTML error pages served as binary (e.g. CloudFront 403)', () => {
    const html = new TextEncoder().encode('<!DOCTYPE html><html><body>403 Forbidden</body></html>');
    expect(validateMp4Header(html)).toBe(false);
  });

  it('rejects bytes with right size but wrong type (e.g. "free" box at offset 4)', () => {
    const buf = new Uint8Array(32);
    buf[0] = 0; buf[1] = 0; buf[2] = 0; buf[3] = 8;
    buf[4] = 0x66; buf[5] = 0x72; buf[6] = 0x65; buf[7] = 0x65; // 'free'
    expect(validateMp4Header(buf)).toBe(false);
  });
});

describe('isDuplicateContent', () => {
  it('returns false when no prior chunks have the same hash', () => {
    expect(isDuplicateContent('abc123', [])).toBe(false);
    expect(isDuplicateContent('abc123', ['def456', 'ghi789'])).toBe(false);
  });

  it('returns true when the hash matches any existing chunk in the request', () => {
    expect(isDuplicateContent('abc123', ['abc123'])).toBe(true);
    expect(isDuplicateContent('abc123', ['def456', 'abc123', 'ghi789'])).toBe(true);
  });

  it('is case-sensitive (sha256 hex is normally lowercase)', () => {
    expect(isDuplicateContent('abc123', ['ABC123'])).toBe(false);
  });

  it('treats empty / null hash as never-duplicate (defensive)', () => {
    expect(isDuplicateContent('', ['abc123'])).toBe(false);
    expect(isDuplicateContent(null as unknown as string, ['abc123'])).toBe(false);
  });
});

describe('formatRejectionReason', () => {
  it('returns a stable, log-friendly string for the reject kind', () => {
    expect(formatRejectionReason('not_mp4')).toMatch(/not.*mp4/i);
    expect(formatRejectionReason('duplicate_content')).toMatch(/duplicate/i);
    expect(formatRejectionReason('size_mismatch')).toMatch(/size/i);
  });
});

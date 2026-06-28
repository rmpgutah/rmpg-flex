import { describe, it, expect } from 'vitest';
import { bytesToBase64 } from '../src/utils/anthropic';
import { sanitizeAttachmentName } from '../src/routes/pdfEngine';

describe('bytesToBase64', () => {
  it('encodes bytes to base64 (matches btoa for small input)', () => {
    const bytes = new Uint8Array([72, 105]); // "Hi"
    expect(bytesToBase64(bytes)).toBe('SGk=');
  });
  it('handles >32KB without overflow', () => {
    const big = new Uint8Array(40_000).fill(65); // 'A'
    const out = bytesToBase64(big);
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(50_000);
  });
});

describe('sanitizeAttachmentName', () => {
  it('builds a safe .pdf filename from a form type', () => {
    expect(sanitizeAttachmentName('FI-9/Use of Force')).toBe('FI-9_Use of Force.pdf');
  });
  it('falls back to document.pdf', () => {
    expect(sanitizeAttachmentName('')).toBe('document.pdf');
  });
});

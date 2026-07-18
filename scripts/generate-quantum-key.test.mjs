import { describe, it, expect } from 'vitest';
import { parseQrngResponse } from './generate-quantum-key.mjs';

describe('parseQrngResponse', () => {
  it('parses a valid response into a Uint8Array of the expected length', () => {
    const json = { success: true, data: [1, 2, 3, 4], length: 4, type: 'uint8' };
    const result = parseQrngResponse(json, 4);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(Array.from(result)).toEqual([1, 2, 3, 4]);
  });

  it('returns null when success is false', () => {
    const json = { success: false, data: [1, 2, 3, 4] };
    expect(parseQrngResponse(json, 4)).toBeNull();
  });

  it('returns null when data is missing', () => {
    expect(parseQrngResponse({ success: true }, 4)).toBeNull();
  });

  it('returns null when data length does not match expectedLength', () => {
    const json = { success: true, data: [1, 2, 3], length: 3, type: 'uint8' };
    expect(parseQrngResponse(json, 4)).toBeNull();
  });

  it('returns null when data contains an out-of-range value', () => {
    const json = { success: true, data: [1, 2, 3, 999], length: 4, type: 'uint8' };
    expect(parseQrngResponse(json, 4)).toBeNull();
  });

  it('returns null for null/undefined input', () => {
    expect(parseQrngResponse(null, 4)).toBeNull();
    expect(parseQrngResponse(undefined, 4)).toBeNull();
  });
});

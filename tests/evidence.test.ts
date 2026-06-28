import { describe, it, expect } from 'vitest';
import { normalizeClassification, validateManifest, evidenceNumber, shortHash } from '../src/utils/evidence';

describe('evidence utils', () => {
  it('normalizeClassification maps known + unknown', () => {
    expect(normalizeClassification('law enforcement sensitive')).toBe('LAW ENFORCEMENT SENSITIVE');
    expect(normalizeClassification('CONFIDENTIAL')).toBe('CONFIDENTIAL');
    expect(normalizeClassification('nonsense')).toBe('EVIDENCE');
    expect(normalizeClassification(null)).toBe('EVIDENCE');
  });

  it('validateManifest requires a hex digest', () => {
    expect(validateManifest({ sha256: 'a'.repeat(64) }).ok).toBe(true);
    expect(validateManifest({ sha256: 'ABCDEF0123456789' }).ok).toBe(true); // 16 chars
    expect(validateManifest({ sha256: 'abc' }).ok).toBe(false);             // too short
    expect(validateManifest({ sha256: 'xyz!' }).ok).toBe(false);            // non-hex
    expect(validateManifest({}).ok).toBe(false);
  });

  it('evidenceNumber zero-pads to 5', () => {
    expect(evidenceNumber(2026, 42)).toBe('26-EVD-00042');
    expect(evidenceNumber(2026, 123456)).toBe('26-EVD-123456');
    expect(evidenceNumber(2026, -1)).toBe('26-EVD-00000');
  });

  it('shortHash truncates + uppercases', () => {
    expect(shortHash('a1b2c3d4e5f60718abcdef')).toBe('A1B2C3D4E5F60718');
    expect(shortHash('')).toBe('');
    expect(shortHash(null)).toBe('');
  });
});

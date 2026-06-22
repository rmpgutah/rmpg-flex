import { describe, it, expect } from 'vitest';
import {
  PSO_CATEGORIES, PSO_CODES,
  lookupPsoCode, lookupPsoCategory, codesInCategory,
  codeToLegacyResult, codeToQueueStatus,
  formatCodeShort, formatCodeFull, dispositionToCode,
} from '../processServiceCodes';

describe('processServiceCodes — taxonomy invariants', () => {
  it('every category code is unique and 5-increment-spaced', () => {
    const codes = PSO_CATEGORIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of codes) {
      expect(c).toMatch(/^PS\/\d{2}$/);
      const n = parseInt(c.slice(3), 10);
      expect(n % 5).toBe(0);
    }
  });

  it('every PsoCode references an existing category', () => {
    const cats = new Set(PSO_CATEGORIES.map((c) => c.code));
    for (const c of PSO_CODES) {
      expect(cats.has(c.category)).toBe(true);
    }
  });

  it('every code is unique', () => {
    const codes = PSO_CODES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('every code maps to a valid legacy result enum', () => {
    const validResults = new Set(['served', 'sub_served', 'posted', 'no_answer',
      'refused', 'bad_address', 'moved', 'deceased', 'other']);
    for (const c of PSO_CODES) {
      expect(validResults.has(c.result)).toBe(true);
    }
  });

  it('every code maps to a valid queue outcome', () => {
    const validQueue = new Set(['served', 'attempted', 'failed', 'pending']);
    for (const c of PSO_CODES) {
      expect(validQueue.has(c.queueOutcome)).toBe(true);
    }
  });
});

describe('processServiceCodes — lookups', () => {
  it('finds known codes', () => {
    const c = lookupPsoCode('PS/15.05');
    expect(c).not.toBeNull();
    expect(c?.category).toBe('PS/15');
    expect(c?.label).toContain('Concealment');
  });

  it('returns null for unknown codes', () => {
    expect(lookupPsoCode('PS/99.99')).toBeNull();
    expect(lookupPsoCode('')).toBeNull();
    expect(lookupPsoCode(null)).toBeNull();
    expect(lookupPsoCode(undefined)).toBeNull();
  });

  it('finds categories', () => {
    expect(lookupPsoCategory('PS/15')?.label).toBe('Evasion of Service');
    expect(lookupPsoCategory('PS/99')).toBeNull();
  });

  it('lists all codes in a category', () => {
    const failed = codesInCategory('PS/00');
    expect(failed.length).toBeGreaterThan(5);
    failed.forEach((c) => expect(c.category).toBe('PS/00'));
  });
});

describe('processServiceCodes — formatting', () => {
  it('formats short and full', () => {
    expect(formatCodeShort('PS/05.01')).toBe('PS/05.01 PERSONAL');
    expect(formatCodeFull('PS/15.10')).toContain('PS/15.10');
    expect(formatCodeFull('PS/15.10')).toContain('Departed Upon Sight');
  });

  it('falls back gracefully on unknown', () => {
    expect(formatCodeShort('unknown')).toBe('UNKNOWN');
    expect(formatCodeFull('')).toBe('OTHER (SEE NOTES)');
  });

  it('flags malformed PS codes with an "Unrecognized code" suffix', () => {
    // "PS/085" looks like a code but doesn't match the library — the
    // recipient should see something coherent, not a bare malformed token.
    expect(formatCodeFull('PS/085')).toBe('PS/085 — Unrecognized code (see notes)');
    expect(formatCodeFull('ps/99')).toBe('PS/99 — Unrecognized code (see notes)');
  });

  it('passes free-text dispositions through without the suffix', () => {
    // Plain prose dispositions ("Cancelled", "PS Non-Service") aren't PS
    // codes — uppercase them as-is, no "Unrecognized code" suffix.
    expect(formatCodeFull('Cancelled')).toBe('CANCELLED');
    expect(formatCodeFull('PS Non-Service')).toBe('PS NON-SERVICE');
  });
});

describe('processServiceCodes — mapping helpers', () => {
  it('codeToLegacyResult covers expected codes', () => {
    expect(codeToLegacyResult('PS/05.01')).toBe('served');
    expect(codeToLegacyResult('PS/10.05')).toBe('sub_served');
    expect(codeToLegacyResult('PS/20.01')).toBe('posted');
    expect(codeToLegacyResult('PS/00.15')).toBe('moved');
    expect(codeToLegacyResult('unknown')).toBe('other');
  });

  it('codeToQueueStatus flips queue correctly', () => {
    expect(codeToQueueStatus('PS/05.01')).toBe('served');
    expect(codeToQueueStatus('PS/00.10')).toBe('failed');
    expect(codeToQueueStatus('PS/15.05')).toBe('attempted');
    expect(codeToQueueStatus('PS/45.01')).toBe('pending');
  });
});

describe('processServiceCodes — disposition adapter', () => {
  it('maps common legacy CFS dispositions to PS codes', () => {
    expect(dispositionToCode('PS Served')).toBe('PS/05.01');
    expect(dispositionToCode('PS Sub-Served')).toBe('PS/10.01');
    expect(dispositionToCode('PS No Access')).toBe('PS/00.05');
    expect(dispositionToCode('PS Evasive')).toBe('PS/15.01');
    expect(dispositionToCode('Cancelled')).toBe('PS/40.01');
    expect(dispositionToCode('Recalled')).toBe('PS/40.05');
  });

  it('returns null on unrecognized input', () => {
    expect(dispositionToCode('')).toBeNull();
    expect(dispositionToCode(null)).toBeNull();
    expect(dispositionToCode('xyz-noise')).toBeNull();
  });

  it('round-trips a structured code unchanged', () => {
    expect(dispositionToCode('PS/15.05')).toBe('PS/15.05');
  });
});

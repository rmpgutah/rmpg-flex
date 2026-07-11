import { describe, it, expect } from 'vitest';
import { parseCadCommand, findUnitByCallSign, findCallByNumber } from '../cadCommandLine';

describe('parseCadCommand', () => {
  it('returns null for empty input', () => {
    expect(parseCadCommand('')).toBeNull();
    expect(parseCadCommand('   ')).toBeNull();
  });

  it('parses ac (add call)', () => {
    expect(parseCadCommand('ac')).toEqual({ kind: 'ac' });
    expect(parseCadCommand('AC')).toEqual({ kind: 'ac' });
  });

  it('parses dc <unit> [call#] (dispatch call)', () => {
    expect(parseCadCommand('dc P12')).toEqual({ kind: 'dc', unit: 'P12', call: undefined });
    expect(parseCadCommand('dc p12 2026-000451')).toEqual({ kind: 'dc', unit: 'p12', call: '2026-000451' });
  });

  it('dc without a unit is unknown', () => {
    expect(parseCadCommand('dc')).toEqual({ kind: 'unknown', input: 'dc' });
  });

  it('parses uc <unit> (unit clear)', () => {
    expect(parseCadCommand('uc P12')).toEqual({ kind: 'uc', unit: 'P12' });
    expect(parseCadCommand('uc')).toEqual({ kind: 'unknown', input: 'uc' });
  });

  it('parses cc [call#] (clear call)', () => {
    expect(parseCadCommand('cc')).toEqual({ kind: 'cc', call: undefined });
    expect(parseCadCommand('cc 451')).toEqual({ kind: 'cc', call: '451' });
  });

  it('anything else is unknown', () => {
    expect(parseCadCommand('frobnicate 12')).toEqual({ kind: 'unknown', input: 'frobnicate 12' });
  });
});

describe('resolvers', () => {
  const units = [
    { id: '7', call_sign: 'P12' },
    { id: '9', call_sign: 'S3' },
  ] as any[];
  const calls = [
    { id: 'c1', call_number: '2026-000451' },
    { id: 'c2', call_number: '2026-000452' },
  ] as any[];

  it('findUnitByCallSign is case-insensitive', () => {
    expect(findUnitByCallSign(units, 'p12')?.id).toBe('7');
    expect(findUnitByCallSign(units, 'X1')).toBeUndefined();
  });

  it('findCallByNumber matches exact or numeric suffix', () => {
    expect(findCallByNumber(calls, '2026-000451')?.id).toBe('c1');
    expect(findCallByNumber(calls, '452')?.id).toBe('c2');
    expect(findCallByNumber(calls, '9999')).toBeUndefined();
  });
});

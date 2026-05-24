import { describe, it, expect } from 'vitest';
import { redactPII } from '../utils/emailRedactor';

describe('redactPII', () => {
  it('redacts SSN', () => {
    const r = redactPII('<p>SSN 123-45-6789 here</p>');
    expect(r.redacted).toContain('[REDACTED:SSN]');
    expect(r.diff.length).toBe(1);
  });
  it('redacts DOB like 01/15/1990', () => {
    const r = redactPII('<p>DOB 01/15/1990</p>');
    expect(r.redacted).toContain('[REDACTED:DOB]');
  });
  it('redacts phone in (801) 555-1234 format', () => {
    const r = redactPII('<p>Call (801) 555-1234</p>');
    expect(r.redacted).toContain('[REDACTED:PHONE]');
  });
  it('redacts Utah driver license', () => {
    const r = redactPII('<p>UT DL A1234567</p>');
    expect(r.redacted).toContain('[REDACTED:DL]');
  });
  it('returns unchanged html when nothing matches', () => {
    const r = redactPII('<p>hello world</p>');
    expect(r.redacted).toBe('<p>hello world</p>');
    expect(r.diff.length).toBe(0);
  });
  it('redacts multiple distinct types', () => {
    const r = redactPII('<p>SSN 111-22-3333 DOB 05/05/1980</p>');
    const types = new Set(r.diff.map(d => d.type));
    expect(types.has('SSN')).toBe(true);
    expect(types.has('DOB')).toBe(true);
  });
  it('handles empty/null input', () => {
    expect(redactPII('').diff).toEqual([]);
    expect(redactPII(null as any).diff).toEqual([]);
  });
});

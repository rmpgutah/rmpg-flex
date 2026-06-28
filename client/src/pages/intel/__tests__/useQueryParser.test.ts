import { describe, it, expect } from 'vitest';
import { parseQuery, toQueryParams } from '../useQueryParser';

describe('parseQuery', () => {
  it('extracts free text when no operators', () => {
    const p = parseQuery('hale vincent');
    expect(p.text).toBe('hale vincent');
    expect(p.flags).toEqual([]);
  });

  it('parses simple operators', () => {
    const p = parseQuery('plate:8XQ220 type:vehicle');
    expect(p.identifiers.plate).toBe('8XQ220');
    expect(p.type).toBe('vehicle');
    expect(p.text).toBe('');
  });

  it('parses quoted values for name and addr', () => {
    const p = parseQuery('name:"Hale Vincent" addr:"123 Main St"');
    expect(p.name).toBe('Hale Vincent');
    expect(p.addr).toBe('123 Main St');
  });

  it('accumulates multiple flags', () => {
    const p = parseQuery('flag:warrant flag:gang river');
    expect(p.flags.sort()).toEqual(['gang', 'warrant']);
    expect(p.text).toBe('river');
  });

  it('parses identifiers, dl, case, and date range', () => {
    const p = parseQuery('dob:1991-08-02 phone:5550101 vin:1FT dl:D12345 case:2026-001 since:2026-01-01 until:2026-06-01');
    expect(p.identifiers.dob).toBe('1991-08-02');
    expect(p.identifiers.phone).toBe('5550101');
    expect(p.identifiers.vin).toBe('1FT');
    expect(p.identifiers.dl).toBe('D12345');
    expect(p.identifiers.case).toBe('2026-001');
    expect(p.since).toBe('2026-01-01');
    expect(p.until).toBe('2026-06-01');
  });

  it('treats unknown key:value as free text', () => {
    const p = parseQuery('color:red ford');
    expect(p.text).toContain('color:red');
    expect(p.text).toContain('ford');
  });

  it('toQueryParams produces a flat param object for the API', () => {
    const p = parseQuery('name:"Jane Doe" flag:warrant type:person');
    const qp = toQueryParams(p);
    expect(qp.name).toBe('Jane Doe');
    expect(qp.flag).toBe('warrant');
    expect(qp.type).toBe('person');
  });
});

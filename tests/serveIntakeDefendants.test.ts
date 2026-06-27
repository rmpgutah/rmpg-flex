import { describe, it, expect } from 'vitest';
import { parseDefendants } from '../src/utils/serveIntakeDefendants';

describe('parseDefendants', () => {
  it('returns empty array for null/undefined/empty', () => {
    expect(parseDefendants(undefined)).toEqual([]);
    expect(parseDefendants('')).toEqual([]);
    expect(parseDefendants('   ')).toEqual([]);
  });

  it('returns single entry for one name with no separator', () => {
    const r = parseDefendants('John Smith');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ name: 'John Smith', is_business: false, split_confidence: 1.0 });
  });

  it("splits on ';' with confidence 1.0", () => {
    const r = parseDefendants('John Smith; Jane Doe');
    expect(r.map(d => d.name)).toEqual(['John Smith', 'Jane Doe']);
    expect(r.every(d => d.split_confidence === 1.0)).toBe(true);
  });

  it("splits on ' and ' (word boundaries) with confidence 0.8", () => {
    const r = parseDefendants('John Smith and Jane Doe');
    expect(r.map(d => d.name)).toEqual(['John Smith', 'Jane Doe']);
    expect(r[0].split_confidence).toBe(0.8);
  });

  it('splits on comma only when 3+ name-shaped tokens (conf 0.6)', () => {
    const r = parseDefendants('John Smith, Jane Doe, Bob Roe');
    expect(r).toHaveLength(3);
    expect(r[0].split_confidence).toBe(0.6);
  });

  it("treats 'Smith, John' (2-token surname-first) as ONE entry", () => {
    const r = parseDefendants('Smith, John');
    expect(r).toHaveLength(1);
    expect(r[0].name).toBe('Smith, John');
  });

  it('filters out business entries from a mixed list', () => {
    const r = parseDefendants('Acme LLC; John Smith');
    expect(r).toHaveLength(1);
    expect(r[0].name).toBe('John Smith');
    expect(r[0].is_business).toBe(false);
  });

  it('returns empty array when all entries are businesses', () => {
    const r = parseDefendants('Acme LLC; Beta Corp; Gamma Inc.');
    expect(r).toEqual([]);
  });

  it("strips 'et al.' and 'Defendant N:' labels", () => {
    const r1 = parseDefendants('John Smith et al.');
    expect(r1[0].name).toBe('John Smith');
    const r2 = parseDefendants('Defendant 1: John Smith; Defendant 2: Jane Doe');
    expect(r2.map(d => d.name)).toEqual(['John Smith', 'Jane Doe']);
  });

  it('splits on newline with confidence 0.5', () => {
    const r = parseDefendants('John Smith\nJane Doe');
    expect(r).toHaveLength(2);
    expect(r[0].split_confidence).toBe(0.5);
  });

  it('preserves raw_source on each entry for audit', () => {
    const r = parseDefendants('John Smith; Jane Doe');
    expect(r[0].raw_source).toBe('John Smith');
    expect(r[1].raw_source).toBe('Jane Doe');
  });

  it('detects business markers: LLC, Inc., Corp., Co., LLP, Trust, Estate of', () => {
    for (const tail of ['LLC', 'Inc.', 'Corp.', 'Co.', 'LLP', 'Trust']) {
      expect(parseDefendants(`Acme ${tail}`)).toEqual([]);
    }
    expect(parseDefendants('Estate of John Smith')).toEqual([]);
  });
});

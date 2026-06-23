import { describe, it, expect } from 'vitest';
import { runHeuristics } from '../src/utils/serveIntakeJudge';

const mkField = (value: string, confidence = 0.85) => ({ value, confidence });

describe('runHeuristics', () => {
  it("flags recipient_first_name not present in any raw text", () => {
    const r = runHeuristics(
      { recipient_first_name: mkField('Alice'), recipient_last_name: mkField('Smith') },
      [{ name: 'doc.pdf', text: 'Defendant: Bob Smith' }],
    );
    expect(r.recipient_first_name.ok).toBe(false);
    expect(r.recipient_first_name.reason).toMatch(/not found/i);
    expect(r.recipient_first_name.source).toBe('heuristic');
  });

  it("passes recipient_first_name when present (case-insensitive)", () => {
    const r = runHeuristics(
      { recipient_first_name: mkField('Alice') },
      [{ name: 'doc.pdf', text: 'DEFENDANT: alice smith' }],
    );
    expect(r.recipient_first_name.ok).toBe(true);
  });

  it("flags recipient_zip when not 5 or 9 digits", () => {
    const bad = runHeuristics(
      { recipient_zip: mkField('1234') },
      [{ name: 'doc.pdf', text: '1234' }],
    );
    expect(bad.recipient_zip.ok).toBe(false);

    const good5 = runHeuristics(
      { recipient_zip: mkField('84084') },
      [{ name: 'doc.pdf', text: '84084' }],
    );
    expect(good5.recipient_zip.ok).toBe(true);

    const good9 = runHeuristics(
      { recipient_zip: mkField('84084-1234') },
      [{ name: 'doc.pdf', text: '84084-1234' }],
    );
    expect(good9.recipient_zip.ok).toBe(true);
  });

  it("flags recipient_state that is not a real US 2-letter code", () => {
    const bad = runHeuristics(
      { recipient_state: mkField('XX') },
      [{ name: 'doc.pdf', text: 'XX' }],
    );
    expect(bad.recipient_state.ok).toBe(false);

    const good = runHeuristics(
      { recipient_state: mkField('UT') },
      [{ name: 'doc.pdf', text: 'UT' }],
    );
    expect(good.recipient_state.ok).toBe(true);
  });

  it("flags recipient_dob outside 1900..today", () => {
    const future = runHeuristics(
      { recipient_dob: mkField('2099-01-01') },
      [{ name: 'doc.pdf', text: '2099-01-01' }],
    );
    expect(future.recipient_dob.ok).toBe(false);

    const ancient = runHeuristics(
      { recipient_dob: mkField('1850-01-01') },
      [{ name: 'doc.pdf', text: '1850-01-01' }],
    );
    expect(ancient.recipient_dob.ok).toBe(false);

    const ok = runHeuristics(
      { recipient_dob: mkField('1985-03-15') },
      [{ name: 'doc.pdf', text: '1985-03-15' }],
    );
    expect(ok.recipient_dob.ok).toBe(true);
  });

  it('skips fields not present in input', () => {
    const r = runHeuristics({}, [{ name: 'doc.pdf', text: '' }]);
    expect(r).toEqual({});
  });

  it('flags recipient_address when no token appears in raw text', () => {
    const r = runHeuristics(
      { recipient_address: mkField('123 Imaginary Lane') },
      [{ name: 'doc.pdf', text: 'unrelated content here' }],
    );
    expect(r.recipient_address.ok).toBe(false);
  });
});

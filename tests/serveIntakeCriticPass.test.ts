import { describe, it, expect } from 'vitest';
import { applyCriticResults, needsCriticPass, TARGET_FIELDS, type ExtractedField } from '../src/utils/serveIntakeExtract';

function fieldsFrom(values: Record<string, string>, conf = 0.9): Record<string, ExtractedField> {
  const out: Record<string, ExtractedField> = {};
  for (const f of TARGET_FIELDS) out[f] = { value: values[f] ?? '', confidence: values[f] ? conf : 0 };
  return out;
}

describe('applyCriticResults', () => {
  it('overwrites only the fields the critic was asked about', () => {
    const base = fieldsFrom({ case_number: 'WRONG', court_name: 'KEEP' });
    const out = applyCriticResults(base, { case_number: { value: '900904528', confidence: 0.95 } });
    expect(out.case_number.value).toBe('900904528');
    expect(out.court_name.value).toBe('KEEP');
  });

  it('ignores a critic answer for a key that is not a target field', () => {
    // In production, criticExtract() only ever returns entries for the field
    // names it was explicitly asked about, so applyCriticResults never sees a
    // non-target key from the real call path. This exercises the same guard
    // directly: a key outside TARGET_FIELDS must never get merged in.
    const base = fieldsFrom({ case_number: 'A' });
    const out = applyCriticResults(base, { not_a_real_field: { value: 'bogus', confidence: 1 } } as any);
    expect((out as any).not_a_real_field).toBeUndefined();
    expect(out.case_number.value).toBe('A');
  });

  it('keeps the original when the critic returns an empty value', () => {
    const base = fieldsFrom({ case_number: 'ORIGINAL' });
    const out = applyCriticResults(base, { case_number: { value: '', confidence: 0 } });
    expect(out.case_number.value).toBe('ORIGINAL');
  });

  it('does not mutate its input', () => {
    const base = fieldsFrom({ case_number: 'A' });
    applyCriticResults(base, { case_number: { value: 'B', confidence: 1 } });
    expect(base.case_number.value).toBe('A');
  });
});

describe('needsCriticPass gating (cost discipline)', () => {
  it('returns nothing when every critical field is confident', () => {
    const f = fieldsFrom({ case_number: 'X', recipient_address: 'Y' }, 0.95);
    expect(needsCriticPass(f, [])).toEqual([]);
  });

  it('never exceeds the cap even when everything is doubtful', () => {
    const f = fieldsFrom({
      case_number: 'a', recipient_address: 'b', court_name: 'c',
      service_deadline: 'd', recipient_dob: 'e', recipient_phone: 'f', address_class: 'g',
    }, 0.1);
    expect(needsCriticPass(f, []).length).toBeLessThanOrEqual(5);
  });
});

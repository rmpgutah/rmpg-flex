import { describe, expect, it } from 'vitest';
import { TARGET_FIELDS, needsCriticPass } from '../src/utils/serveIntakeExtract';
import type { ExtractedField } from '../src/utils/serveIntakeExtract';

describe('attempt-sheet target fields', () => {
  it('includes prior_attempt_date, attempt_outcome, observer_id in TARGET_FIELDS', () => {
    expect(TARGET_FIELDS).toContain('prior_attempt_date');
    expect(TARGET_FIELDS).toContain('attempt_outcome');
    expect(TARGET_FIELDS).toContain('observer_id');
  });
});

describe('CRITIC_FIELDS enhancements', () => {
  function makeFields(overrides: Partial<Record<string, Partial<ExtractedField>>>): Record<string, ExtractedField> {
    return Object.fromEntries(
      TARGET_FIELDS.map((f) => [
        f,
        { value: overrides[f]?.value ?? '', confidence: overrides[f]?.confidence ?? 1 },
      ]),
    ) as Record<string, ExtractedField>;
  }

  it('includes recipient_last_name in critic candidates when low-confidence', () => {
    const fields = makeFields({ recipient_last_name: { value: 'Smith', confidence: 0.4 } });
    const candidates = needsCriticPass(fields, []);
    expect(candidates).toContain('recipient_last_name');
  });

  it('includes service_instructions in critic candidates when low-confidence', () => {
    const fields = makeFields({ service_instructions: { value: 'Call ahead', confidence: 0.3 } });
    const candidates = needsCriticPass(fields, []);
    expect(candidates).toContain('service_instructions');
  });

  it('does not include critic fields with blank value (blank = nothing to re-check)', () => {
    const fields = makeFields({
      recipient_last_name: { value: '', confidence: 0 },
      service_instructions: { value: '', confidence: 0 },
    });
    const candidates = needsCriticPass(fields, []);
    expect(candidates).not.toContain('recipient_last_name');
    expect(candidates).not.toContain('service_instructions');
  });

  it('still caps critic candidates at CRITIC_MAX_FIELDS=6', () => {
    // All critical fields low-confidence — should not exceed the cap.
    const fields = makeFields({
      recipient_last_name:   { value: 'A', confidence: 0.1 },
      recipient_first_name:  { value: 'B', confidence: 0.1 },
      case_number:           { value: 'C', confidence: 0.1 },
      court_name:            { value: 'D', confidence: 0.1 },
      recipient_address:     { value: 'E', confidence: 0.1 },
      service_deadline:      { value: '2026-10-01', confidence: 0.1 },
      recipient_dob:         { value: '1990-01-01', confidence: 0.1 },
      recipient_phone:       { value: '555-1234', confidence: 0.1 },
      service_instructions:  { value: 'F', confidence: 0.1 },
    });
    const candidates = needsCriticPass(fields, []);
    expect(candidates.length).toBeLessThanOrEqual(6);
  });
});

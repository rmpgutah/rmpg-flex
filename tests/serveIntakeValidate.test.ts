import { describe, it, expect } from 'vitest';
import { validateFields } from '../src/utils/serveIntakeValidate';
import { TARGET_FIELDS, type ExtractedField } from '../src/utils/serveIntakeExtract';

function fieldsFrom(values: Record<string, string>, conf = 0.9): Record<string, ExtractedField> {
  const out: Record<string, ExtractedField> = {};
  for (const f of TARGET_FIELDS) out[f] = { value: values[f] ?? '', confidence: values[f] ? conf : 0 };
  return out;
}

describe('validateFields', () => {
  it('flags a ZIP that does not belong to the stated state', () => {
    const r = validateFields(fieldsFrom({ recipient_state: 'UT', recipient_zip: '94304' }));
    expect(r.issues.some((i) => i.field === 'recipient_zip' && i.severity === 'error')).toBe(true);
  });

  it('accepts a ZIP consistent with the state', () => {
    const r = validateFields(fieldsFrom({ recipient_state: 'UT', recipient_zip: '84121' }));
    expect(r.issues.filter((i) => i.field === 'recipient_zip')).toHaveLength(0);
  });

  it('flags a phone without 10 digits', () => {
    const r = validateFields(fieldsFrom({ recipient_phone: '43598612' }));
    expect(r.issues.some((i) => i.field === 'recipient_phone')).toBe(true);
  });

  it('flags a service deadline in the past relative to the reference date', () => {
    const r = validateFields(fieldsFrom({ service_deadline: '2020-01-01' }), '2026-07-26T00:00:00Z');
    expect(r.issues.some((i) => i.field === 'service_deadline')).toBe(true);
  });

  it('lowers confidence on a field that failed validation', () => {
    const r = validateFields(fieldsFrom({ recipient_state: 'UT', recipient_zip: '94304' }));
    expect(r.adjusted.recipient_zip.confidence).toBeLessThan(0.9);
  });

  it('raises confidence on a field that passed every applicable check', () => {
    const r = validateFields(fieldsFrom({ recipient_state: 'UT', recipient_zip: '84121' }));
    expect(r.adjusted.recipient_zip.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('reports no issues for an empty field map', () => {
    const r = validateFields(fieldsFrom({}));
    expect(r.issues).toHaveLength(0);
  });
});

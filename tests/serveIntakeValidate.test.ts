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
    // fieldsFrom defaults confidence to 0.9, so a bare >= 0.9 assertion would
    // pass even if the reward() bonus were never applied. Pin the actual
    // post-bonus value (0.9 * CONFIDENCE_BONUS = 0.945) so this test can fail.
    expect(r.adjusted.recipient_zip.confidence).toBeCloseTo(0.9 * 1.05, 10);
    expect(r.adjusted.recipient_zip.confidence).toBeGreaterThan(0.9);
  });

  it('reports no issues for an empty field map', () => {
    const r = validateFields(fieldsFrom({}));
    expect(r.issues).toHaveLength(0);
  });

  describe('state ZIP prefix boundaries', () => {
    const passes = (state: string, zip: string) =>
      validateFields(fieldsFrom({ recipient_state: state, recipient_zip: zip })).issues.some(
        (i) => i.field === 'recipient_zip' && i.severity === 'error',
      ) === false;

    it('accepts California ZIPs up to the real 961xx ceiling (South Lake Tahoe)', () => {
      expect(passes('CA', '96150')).toBe(true);
      expect(passes('CA', '96162')).toBe(true);
    });

    it('accepts California ZIPs in the 960xx block (Redding)', () => {
      expect(passes('CA', '96001')).toBe(true);
      expect(passes('CA', '96099')).toBe(true);
    });

    it('rejects a ZIP just past the California ceiling (Hawaii territory)', () => {
      expect(passes('CA', '96701')).toBe(false); // 967xx = Hawaii
      expect(passes('CA', '96910')).toBe(false); // 969xx = Guam/Micronesia
    });

    it('accepts only the single real 889xx Nevada ZIP, not the block', () => {
      expect(passes('NV', '88901')).toBe(true);
      expect(passes('NV', '88999')).toBe(false);
      expect(passes('NV', '88950')).toBe(false);
    });

    it('rejects a ZIP just below the Nevada 889xx block', () => {
      expect(passes('NV', '88899')).toBe(false);
    });

    it('rejects a Nevada-looking ZIP in the 896xx prefix (not actually Nevada)', () => {
      // Regression for the range-shortcut bug: `89[3-8]` wrongly matched 896.
      expect(passes('NV', '89601')).toBe(false);
    });

    it('accepts a Nevada ZIP in the real 897xx prefix (Carson City)', () => {
      expect(passes('NV', '89701')).toBe(true);
    });

    it('accepts Idaho ZIPs across the full 832-838 range', () => {
      expect(passes('ID', '83201')).toBe(true);
      expect(passes('ID', '83877')).toBe(true);
    });

    it('rejects a ZIP just below the Idaho range (that block is Wyoming)', () => {
      expect(passes('ID', '83199')).toBe(false);
    });

    it('rejects Wyoming\'s 830-831 block when misclassified as Idaho', () => {
      expect(passes('ID', '83001')).toBe(false); // Jackson, WY
      expect(passes('ID', '83101')).toBe(false); // Kemmerer, WY
    });

    it('accepts Wyoming ZIPs including the 830-831 block', () => {
      expect(passes('WY', '82001')).toBe(true);
      expect(passes('WY', '83001')).toBe(true);
      expect(passes('WY', '83128')).toBe(true);
    });

    it('accepts Colorado ZIPs up to the real 816xx ceiling', () => {
      expect(passes('CO', '80001')).toBe(true);
      expect(passes('CO', '81600')).toBe(true);
    });

    it('rejects a ZIP just past the Colorado ceiling (unassigned block)', () => {
      expect(passes('CO', '81700')).toBe(false);
    });

    it('accepts Arizona ZIPs in each real sub-block', () => {
      expect(passes('AZ', '85001')).toBe(true); // Phoenix
      expect(passes('AZ', '85601')).toBe(true); // Wickenburg
      expect(passes('AZ', '85901')).toBe(true); // Casa Grande
      expect(passes('AZ', '86301')).toBe(true); // Prescott
    });

    it('rejects Arizona ZIPs that fall inside the real gaps', () => {
      expect(passes('AZ', '85401')).toBe(false); // 854xx gap
      expect(passes('AZ', '86101')).toBe(false); // 861xx gap
    });

    it('accepts Texas ZIPs including the 885xx Fort Bliss enclave', () => {
      expect(passes('TX', '75001')).toBe(true);
      expect(passes('TX', '79901')).toBe(true);
      expect(passes('TX', '88510')).toBe(true);
    });

    it('rejects a ZIP just past the Texas main block ceiling', () => {
      expect(passes('TX', '80001')).toBe(false);
    });
  });
});

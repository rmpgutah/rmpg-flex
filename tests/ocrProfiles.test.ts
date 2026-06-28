import { describe, it, expect } from 'vitest';
import {
  OCR_PROFILES, ID_CARD_FIELDS, PLATE_FIELDS,
  buildVisionUserPrompt, normalizeVision, profileFieldKeys,
} from '../src/utils/ocrProfiles';

describe('ocr profiles', () => {
  it('exposes the three concrete profiles', () => {
    expect(Object.keys(OCR_PROFILES).sort()).toEqual(['id_card', 'license_plate', 'serve_document']);
  });

  it('the user prompt names the profile field keys (so Claude returns them)', () => {
    const p = buildVisionUserPrompt('id_card');
    expect(p).toContain('id_number');
    expect(p).toContain('last_name');
    expect(p).toMatch(/JSON/i);
  });

  it('auto prompt asks Claude to classify among the known types', () => {
    const p = buildVisionUserPrompt('auto');
    expect(p).toContain('id_card');
    expect(p).toContain('license_plate');
    expect(p).toContain('serve_document');
  });
});

describe('normalizeVision', () => {
  it('coerces a Claude {value,confidence} field map into ExtractionResult, filling missing keys', () => {
    const parsed = {
      documentType: 'id_card',
      fields: {
        id_number: { value: '175989424', confidence: 0.98 },
        last_name: { value: 'NGUYEN' },
      },
      rawText: 'UTAH DRIVER LICENSE ...',
    };
    const r = normalizeVision(parsed, 'id_card', 'claude:test', 12);
    expect(r.success).toBe(true);
    expect(r.documentType).toBe('id_card');
    expect(r.fields.id_number.value).toBe('175989424');
    expect(r.fields.id_number.confidence).toBeCloseTo(0.98);
    expect(r.fields.last_name.confidence).toBeGreaterThan(0); // default applied
    // every profile field is present even when Claude omitted it
    for (const k of ID_CARD_FIELDS.map((f) => f.key)) expect(r.fields[k]).toBeDefined();
    expect(r.fields.eyes.value).toBe(''); // omitted → empty
    expect(r.model).toBe('claude:test');
    expect(r.ms).toBe(12);
  });

  it('coerces a bare-string field value (Claude sometimes drops the wrapper)', () => {
    const parsed = { documentType: 'license_plate', fields: { plate_number: 'ABC123', plate_state: 'UT' } };
    const r = normalizeVision(parsed, 'license_plate', 'm', 1);
    expect(r.fields.plate_number.value).toBe('ABC123');
    expect(r.fields.plate_state.value).toBe('UT');
  });

  it('clamps out-of-range confidence into [0,1]', () => {
    const parsed = { fields: { plate_number: { value: 'X', confidence: 5 } } };
    const r = normalizeVision(parsed, 'license_plate', 'm', 1);
    expect(r.fields.plate_number.confidence).toBe(1);
  });

  it('is unsuccessful when nothing was extracted', () => {
    const r = normalizeVision({}, 'id_card', 'm', 1);
    expect(r.success).toBe(false);
    expect(r.documentType).toBe('id_card');
  });

  it('on auto, honors the documentType Claude returned', () => {
    const r = normalizeVision({ documentType: 'license_plate', fields: { plate_number: 'P1' } }, 'auto', 'm', 1);
    expect(r.documentType).toBe('license_plate');
    expect(r.fields.plate_number.value).toBe('P1');
  });
});

describe('profileFieldKeys', () => {
  it('auto unions all profile keys so any returned field survives normalization', () => {
    const keys = profileFieldKeys('auto');
    expect(keys).toContain('id_number');     // id_card
    expect(keys).toContain('plate_number');  // license_plate
    expect(keys).toContain('case_number');   // serve_document
  });
});

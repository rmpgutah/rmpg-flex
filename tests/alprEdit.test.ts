import { describe, it, expect } from 'vitest';
import { normalizeCaptureEdit, describeEdit } from '../src/utils/alprEdit';

describe('normalizeCaptureEdit', () => {
  it('only touches keys present in the input', () => {
    const { values, errors } = normalizeCaptureEdit({ plate: 'abc123' });
    expect(errors).toEqual([]);
    expect(values).toEqual({ plate: 'ABC123' });
    expect(Object.prototype.hasOwnProperty.call(values, 'state')).toBe(false);
  });

  it('uppercases + strips spaces/hyphens from the plate', () => {
    expect(normalizeCaptureEdit({ plate: ' 6kj-3l8 ' }).values.plate).toBe('6KJ3L8');
  });

  it('rejects an out-of-range plate', () => {
    expect(normalizeCaptureEdit({ plate: 'A' }).errors[0].field).toBe('plate');
    expect(normalizeCaptureEdit({ plate: 'TOOLONGPLATE' }).errors[0].field).toBe('plate');
    expect(normalizeCaptureEdit({ plate: 'AB!2' }).errors[0].field).toBe('plate');
  });

  it('normalizes state to 2–3 uppercase letters, blank clears it', () => {
    expect(normalizeCaptureEdit({ state: 'ut' }).values.state).toBe('UT');
    expect(normalizeCaptureEdit({ state: '  ' }).values.state).toBeNull();
    expect(normalizeCaptureEdit({ state: 'UTAH' }).errors[0].field).toBe('state');
  });

  it('validates year window and clears on blank', () => {
    expect(normalizeCaptureEdit({ year: '2018' }, { maxYear: 2027 }).values.year).toBe(2018);
    expect(normalizeCaptureEdit({ year: '' }).values.year).toBeNull();
    expect(normalizeCaptureEdit({ year: 1800 }).errors[0].field).toBe('year');
    expect(normalizeCaptureEdit({ year: 3000 }, { maxYear: 2027 }).errors[0].field).toBe('year');
  });

  it('accepts known conditions, rejects unknown, clears on blank', () => {
    expect(normalizeCaptureEdit({ condition: 'Heavy' }).values.condition).toBe('heavy');
    expect(normalizeCaptureEdit({ condition: '' }).values.condition).toBeNull();
    expect(normalizeCaptureEdit({ condition: 'wrecked' }).errors[0].field).toBe('condition');
  });

  it('trims free-text attributes and nulls when empty', () => {
    const { values } = normalizeCaptureEdit({ make: ' Toyota ', model: '', color: 'Silver' });
    expect(values.make).toBe('Toyota');
    expect(values.model).toBeNull();
    expect(values.color).toBe('Silver');
  });

  it('caps long free text', () => {
    const long = 'x'.repeat(200);
    expect(normalizeCaptureEdit({ make: long }).values.make!.length).toBe(60);
    expect(normalizeCaptureEdit({ damage_summary: long }).values.damage_summary!.length).toBe(200);
  });

  it('collects multiple errors at once', () => {
    const { errors } = normalizeCaptureEdit({ plate: '!', state: 'NOPE', year: 50 });
    expect(errors.map((e) => e.field).sort()).toEqual(['plate', 'state', 'year']);
  });
});

describe('describeEdit', () => {
  it('lists only changed fields', () => {
    const before = { plate: 'KJH345', state: 'UT', make: null };
    const diff = describeEdit(before, { plate: 'KJH346', state: 'UT', make: 'Honda' });
    expect(diff).toContain('plate: KJH345 → KJH346');
    expect(diff).toContain('make: ∅ → Honda');
    expect(diff).not.toContain('state'); // unchanged
  });

  it('treats null and empty string as equal (no no-op clears)', () => {
    expect(describeEdit({ color: null }, { color: '' as any })).toBe('');
    expect(describeEdit({ color: '' }, { color: null })).toBe('');
  });
});

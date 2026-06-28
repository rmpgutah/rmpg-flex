import { describe, it, expect } from 'vitest';
import { formFromCapture, plateError, buildVerifyBody } from './captureEdit';

describe('formFromCapture', () => {
  it('maps both API shapes and uppercases plate/state', () => {
    const f = formFromCapture({ plate: 'kjh345', state: 'ut', vehicleType: 'sedan', damageSummary: 'dent' });
    expect(f.plate).toBe('KJH345');
    expect(f.state).toBe('UT');
    expect(f.vehicle_type).toBe('sedan');
    expect(f.damage_summary).toBe('dent');
  });

  it('renders nulls as empty strings', () => {
    const f = formFromCapture({ plate: 'AB1', state: null, make: null, year: null });
    expect(f.state).toBe('');
    expect(f.make).toBe('');
    expect(f.year).toBe('');
  });
});

describe('plateError', () => {
  it('accepts a valid plate', () => {
    expect(plateError('6kj-3l8')).toBeNull();
  });
  it('rejects too-short / too-long / non-alphanumeric', () => {
    expect(plateError('A')).not.toBeNull();
    expect(plateError('TOOLONGPLATE')).not.toBeNull();
    expect(plateError('AB!2')).not.toBeNull();
  });
});

describe('buildVerifyBody', () => {
  const base = formFromCapture({ plate: 'KJH345', state: 'UT', make: '', model: '', color: '', year: '', vehicle_type: '', condition: '', damage_summary: '' });

  it('returns only changed fields', () => {
    const edited = { ...base, plate: 'KJH346', make: 'Honda' };
    expect(buildVerifyBody(base, edited)).toEqual({ plate: 'KJH346', make: 'Honda' });
  });

  it('is empty when nothing changed (whitespace-insensitive)', () => {
    const edited = { ...base, make: '   ' };
    expect(buildVerifyBody(base, edited)).toEqual({});
  });

  it('normalizes plate + state casing in the diff', () => {
    const edited = { ...base, plate: ' kjh346 ', state: 'ca' };
    expect(buildVerifyBody(base, edited)).toEqual({ plate: 'KJH346', state: 'CA' });
  });
});

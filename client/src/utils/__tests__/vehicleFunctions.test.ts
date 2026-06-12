import { describe, it, expect } from 'vitest';
import * as V from '../vehicleFunctions';

const NOW = new Date(Date.UTC(2026, 5, 11));

describe('vehicleFunctions — VIN', () => {
  // Known-valid VINs (real check digits).
  const HONDA = '1HGCM82633A004352';   // check digit 3
  const FORD = '1FTFW1ET9DFC10312';    // 2013 F-150

  it('validates real VINs via ISO check digit', () => {
    expect(V.vinCheckDigit(HONDA)).toBe('3');
    expect(V.isValidVin(HONDA)).toBe(true);
    expect(V.isValidVin(FORD)).toBe(true);
    expect(V.isValidVin('1HGCM82633A004353')).toBe(false); // wrong check digit
    expect(V.isValidVin('1HGCM82633A00435')).toBe(false);  // too short
    expect(V.isValidVin('1HGCM8263OA004352')).toBe(false); // illegal 'O'
  });
  it('reports the validation error', () => {
    expect(V.vinValidationError(HONDA)).toBe('');
    expect(V.vinValidationError('1HGCM8263OA004352')).toMatch(/illegal/i);
    expect(V.vinValidationError('SHORT')).toMatch(/Length/);
  });
  it('decodes WMI / year / country', () => {
    const d = V.decodeVin(HONDA, NOW);
    expect(d.wmi).toBe('1HG');
    expect(d.country).toBe('United States');
    expect(d.modelYear).toBe(2003);  // year code '3' → 2003 (not future)
    expect(V.vinModelYear(FORD, NOW)).toBe(2013);
    expect(V.vinYearCode(2013)).toBe('D');
  });
  it('normalizes / masks / matches', () => {
    expect(V.normalizeVin(' 1hg cm82633a004352 ')).toBe(HONDA);
    expect(V.maskVin(HONDA)).toMatch(/^1HG•+4352$/);
    expect(V.vinsMatch(HONDA, '1hgcm82633a004352')).toBe(true);
    expect(V.looksLikeVin(HONDA)).toBe(true);
    expect(V.isVinChar('O')).toBe(false);
    expect(V.isVinChar('H')).toBe(true);
  });
});

describe('vehicleFunctions — plates', () => {
  it('validates per state', () => {
    expect(V.validatePlate('CA', '7ABC123')).toBe(true);  // CA: digit+3 letters+3 digits
    expect(V.validatePlate('CA', 'ABC1234')).toBe(false);
    expect(V.validatePlate('TX', 'ABC1234')).toBe(true);
    expect(V.validatePlate('UT', 'A12 3BC')).toBe(true);
  });
  it('normalizes / masks / matches', () => {
    expect(V.normalizePlate(' a-bc 123 ')).toBe('ABC123');
    expect(V.platesMatch('ABC123', 'abc-123')).toBe(true);
    expect(V.maskPlate('ABC123')).toBe('A••••3');
    expect(V.isNumericPlate('12345')).toBe(true);
    expect(V.candidateStatesForPlate('7ABC123')).toContain('CA');
  });
  it('splits combined state-plate', () => {
    expect(V.splitStatePlate('UT-ABC123')).toEqual({ state: 'UT', plate: 'ABC123' });
  });
});

describe('vehicleFunctions — NCIC codes', () => {
  it('expands color / make / body', () => {
    expect(V.expandColorCode('SIL')).toBe('Silver');
    expect(V.colorCodeFromName('Silver')).toBe('SIL');
    expect(V.parseTwoToneColor('BLK/WHI')).toEqual(['Black', 'White']);
    expect(V.expandMakeCode('TOYT')).toBe('Toyota');
    expect(V.makeCodeFromName('Toyota')).toBe('TOYT');
    expect(V.normalizeMake('toyota')).toBe('Toyota');
    expect(V.expandBodyStyle('SD')).toBe('Sedan');
    expect(V.isValidColorCode('SIL')).toBe(true);
    expect(V.isValidMakeCode('TOYT')).toBe(true);
  });
});

describe('vehicleFunctions — classification & registration', () => {
  it('age + classic + category', () => {
    expect(V.vehicleAge(2019, NOW)).toBe(7);
    expect(V.isClassicVehicle(1998, NOW)).toBe(true);
    expect(V.isClassicVehicle(2019, NOW)).toBe(false);
    expect(V.vehicleCategory('MC')).toBe('motorcycle');
    expect(V.vehicleCategory('PK')).toBe('light truck');
    expect(V.vehicleCategory('SD')).toBe('passenger');
    expect(V.isPlausibleModelYear(2019, NOW)).toBe(true);
    expect(V.isPlausibleModelYear(2099, NOW)).toBe(false);
    expect(V.modelYearDecade(2019)).toBe('2010s');
  });
  it('registration status', () => {
    expect(V.isRegistrationExpired('2025-01-01', NOW)).toBe(true);
    expect(V.registrationStatus('2025-01-01', 30, NOW)).toBe('expired');
    expect(V.registrationStatus('2026-06-20', 30, NOW)).toBe('expiring');
    expect(V.registrationStatus('2030-01-01', 30, NOW)).toBe('valid');
  });
  it('descriptor', () => {
    expect(V.vehicleDescriptor(2019, 'SIL', 'TOYT', 'SD')).toBe('2019 Silver Toyota Sedan');
  });
});

describe('vehicleFunctions — fleet units', () => {
  it('normalizes / formats / matches unit ids', () => {
    expect(V.normalizeUnitId('unit 12')).toBe('12');
    expect(V.normalizeUnitId('U-12')).toBe('12');
    expect(V.formatUnitId('12')).toBe('UNIT 12');
    expect(V.unitsMatch('Unit 12', 'U12')).toBe(true);
    expect(V.isValidUnitId('12')).toBe(true);
    expect(V.fleetVehicleLabel('12', 2019, 'FORD', 'UT', 'ABC123')).toContain('UNIT 12');
  });
  it('stolen-match + key', () => {
    expect(V.matchesStolenVehicle({ plate: 'ABC123' }, { plate: 'abc-123' })).toBe(true);
    expect(V.matchesStolenVehicle({ vin: '1HGCM82633A004352' }, { vin: '1hgcm82633a004352' })).toBe(true);
    expect(V.matchesStolenVehicle({ plate: 'XYZ' }, { plate: 'ABC' })).toBe(false);
    expect(V.vehicleKey({ vin: '1HGCM82633A004352' })).toBe('VIN:1HGCM82633A004352');
    expect(V.vehicleKey({ plate: 'ABC123', state: 'ut' })).toBe('PLATE:UT:ABC123');
  });
});

describe('vehicleFunctions — evaluateVehicle bridge', () => {
  it('derives the full set in one call', () => {
    const e = V.evaluateVehicle({
      vin: '1FTFW1ET9DFC10312', plate: 'ABC1234', state: 'TX', year: 2013,
      color: 'BLK', make: 'FORD', body_style: 'PK', registration_expiry: '2030-01-01', unit_id: '7',
    }, NOW);
    expect(e.vinValid).toBe(true);
    expect(e.decodedYear).toBe(2013);
    expect(e.yearMatches).toBe(true);
    expect(e.plateValid).toBe(true);
    expect(e.color).toBe('Black');
    expect(e.make).toBe('Ford');
    expect(e.bodyStyle).toBe('Pickup');
    expect(e.category).toBe('light truck');
    expect(e.age).toBe(13);
    expect(e.registration).toBe('valid');
    expect(e.unitLabel).toBe('UNIT 7');
    expect(e.descriptor).toContain('Ford');
    expect(e.key).toBe('VIN:1FTFW1ET9DFC10312');
  });
});

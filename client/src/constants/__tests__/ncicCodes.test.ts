import { describe, it, expect } from 'vitest';
import {
  encode, decode, fmtCoded, formatRaceEthnicity,
  normalizeHeight, normalizeWeight,
} from '../ncicCodes';

describe('person descriptor codes', () => {
  it('encodes stored race labels to NCIC codes', () => {
    expect(encode('RACE', 'White')).toBe('W');
    expect(encode('RACE', 'Black')).toBe('B');
    expect(encode('RACE', 'Native American')).toBe('I');
    expect(encode('RACE', 'Asian')).toBe('A');
    expect(encode('RACE', 'Pacific Islander')).toBe('A');
  });

  it('decodes a code back to its canonical label', () => {
    expect(decode('RACE', 'W')).toBe('White');
    expect(decode('SEX', 'M')).toBe('Male');
  });

  it('fmtCoded renders "CODE (LABEL)"', () => {
    expect(fmtCoded('RACE', 'White')).toBe('W (WHITE)');
    expect(fmtCoded('SEX', 'Female')).toBe('F (FEMALE)');
    expect(fmtCoded('EYE', 'Brown')).toBe('BRO (BROWN)');
    expect(fmtCoded('HAIR', 'Blonde')).toBe('BLN (BLOND)');
  });

  it('fmtCoded accepts a value already in code form', () => {
    expect(fmtCoded('RACE', 'W')).toBe('W (WHITE)');
  });

  it('fmtCoded returns empty string for empty input', () => {
    expect(fmtCoded('RACE', '')).toBe('');
    expect(fmtCoded('RACE', undefined as unknown as string)).toBe('');
  });

  it('falls back to the raw uppercased value when there is no code', () => {
    expect(fmtCoded('EYE', 'Amber')).toBe('AMBER');
    expect(encode('RACE', 'Klingon')).toBe('KLINGON');
  });

  it('treats Hispanic as ethnicity, not race', () => {
    expect(formatRaceEthnicity('Hispanic')).toEqual({ rac: 'U (UNKNOWN)', etn: 'H (HISPANIC)' });
    expect(formatRaceEthnicity('White')).toEqual({ rac: 'W (WHITE)', etn: null });
    expect(formatRaceEthnicity('')).toEqual({ rac: '', etn: null });
  });

  it('normalizes height to NCIC 3-digit feet-inches', () => {
    expect(normalizeHeight(`5'10"`)).toBe('510');
    expect(normalizeHeight('510')).toBe('510');
    expect(normalizeHeight('70in')).toBe('510');
    expect(normalizeHeight('6 ft 0 in')).toBe('600');
    expect(normalizeHeight('5 ft 10 in')).toBe('510');
    expect(normalizeHeight('6 ft 11 in')).toBe('611');
    expect(normalizeHeight('')).toBe('');
  });

  it('normalizes weight to NCIC 3-digit pounds', () => {
    expect(normalizeWeight('180')).toBe('180');
    expect(normalizeWeight('90')).toBe('090');
    expect(normalizeWeight('180 lbs')).toBe('180');
    expect(normalizeWeight(180)).toBe('180');
    expect(normalizeWeight('')).toBe('');
    expect(normalizeWeight('1234')).toBe('');
  });

  it('decode resolves a label input back to the canonical label', () => {
    expect(decode('RACE', 'White')).toBe('White');
    expect(decode('VMA', 'Toyota')).toBe('Toyota'); // resolves via real VMA table
  });

  it('does not treat non-Hispanic substrings as Hispanic', () => {
    expect(formatRaceEthnicity('Platinum')).toEqual({ rac: 'PLATINUM', etn: null });
  });
});

describe('vehicle codes', () => {
  it('encodes makes to NCIC VMA codes', () => {
    expect(encode('VMA', 'Toyota')).toBe('TOYT');
    expect(encode('VMA', 'Chevrolet')).toBe('CHEV');
    expect(encode('VMA', 'Ford')).toBe('FORD');
    expect(encode('VMA', 'Honda')).toBe('HOND');
    expect(encode('VMA', 'Mercedes-Benz')).toBe('MERZ');
  });
  it('fmtCoded renders vehicle make/color/style', () => {
    expect(fmtCoded('VMA', 'Toyota')).toBe('TOYT (TOYOTA)');
    expect(fmtCoded('VCO', 'Blue')).toBe('BLU (BLUE)');
    expect(fmtCoded('VST', 'Sedan (4-Door)')).toBe('4D (SEDAN 4-DOOR)');
    expect(fmtCoded('VST', 'Pickup Truck')).toBe('PK (PICKUP)');
  });
  it('maps compound colors', () => {
    expect(encode('VCO', 'Dark Blue')).toBe('DBL');
    expect(encode('VCO', 'Silver')).toBe('SIL');
    expect(encode('VCO', 'Maroon')).toBe('MAR');
  });
});

describe('geographic + DL codes', () => {
  it('decodes state codes to names and back', () => {
    expect(fmtCoded('STATE', 'UT')).toBe('UT (UTAH)');
    expect(encode('STATE', 'Utah')).toBe('UT');
    expect(fmtCoded('STATE', 'CA')).toBe('CA (CALIFORNIA)');
  });
  it('renders Utah DL classes', () => {
    expect(fmtCoded('DL_CLASS', 'D')).toBe('D (OPERATOR)');
    expect(fmtCoded('DL_CLASS', 'M')).toBe('M (MOTORCYCLE)');
    expect(encode('DL_CLASS', 'CDL-A')).toBe('A');
  });
  it('renders CDL endorsements', () => {
    expect(fmtCoded('DL_ENDORSEMENT', 'H')).toBe('H (HAZARDOUS MATERIALS)');
    expect(fmtCoded('DL_ENDORSEMENT', 'P')).toBe('P (PASSENGER)');
  });
});

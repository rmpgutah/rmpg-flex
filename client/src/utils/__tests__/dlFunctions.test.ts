import { describe, it, expect } from 'vitest';
import * as DL from '../dlFunctions';
import { parseAamva } from '../aamvaParser';

const NOW = new Date(Date.UTC(2026, 5, 11)); // 2026-06-11

describe('dlFunctions — jurisdiction & IIN', () => {
  it('maps IIN ↔ state', () => {
    expect(DL.iinToState('636040')).toBe('UT');
    expect(DL.stateToIin('UT')).toBe('636040');
    expect(DL.iinToState('000000')).toBe('');
  });
  it('classifies jurisdictions', () => {
    expect(DL.isUSState('UT')).toBe(true);
    expect(DL.isCanadianJurisdiction('ON')).toBe(true);
    expect(DL.isUSTerritory('PR')).toBe(true);
    expect(DL.isUSState('ON')).toBe(false);
  });
  it('normalizes free-form input', () => {
    expect(DL.normalizeJurisdiction('Utah')).toBe('UT');
    expect(DL.normalizeJurisdiction(' ut ')).toBe('UT');
    expect(DL.jurisdictionName('UT')).toBe('Utah');
    expect(DL.sameJurisdiction('Utah', 'UT')).toBe(true);
  });
  it('infers country + validates IIN', () => {
    expect(DL.jurisdictionCountry('UT')).toBe('USA');
    expect(DL.jurisdictionCountry('ON')).toBe('CAN');
    expect(DL.iinIssuerCountry('636040')).toBe('USA');
    expect(DL.isValidIin('636040')).toBe(true);
    expect(DL.isValidIin('63604')).toBe(false);
    expect(DL.jurisdictionCount()).toBeGreaterThan(50);
  });
});

describe('dlFunctions — DL number format', () => {
  it('validates per-jurisdiction', () => {
    expect(DL.validateDlNumber('CA', 'A1234567')).toBe(true);   // CA = letter + 7 digits
    expect(DL.validateDlNumber('CA', '12345678')).toBe(false);
    expect(DL.validateDlNumber('UT', '123456')).toBe(true);     // UT = 4-10 digits
    expect(DL.validateDlNumber('PA', '12345678')).toBe(true);   // PA = 8 digits
    expect(DL.validateDlNumber('PA', '1234')).toBe(false);
  });
  it('normalizes + masks + matches', () => {
    expect(DL.normalizeDlNumber(' a-12 34 ')).toBe('A1234');
    expect(DL.dlNumbersMatch('A1234', 'a-12-34')).toBe(true);
    expect(DL.maskDlNumber('123456789')).toMatch(/^12•+89$/);
    expect(DL.looksLikeDlNumber('A1234567')).toBe(true);
    expect(DL.isNumericOnlyDl('PA')).toBe(true);
    expect(DL.isNumericOnlyDl('CA')).toBe(false);
  });
  it('suggests candidate jurisdictions', () => {
    const cands = DL.candidateJurisdictionsForDl('A1234567');
    expect(cands).toContain('CA');
  });
});

describe('dlFunctions — dates', () => {
  it('parses + validates ISO', () => {
    expect(DL.isValidIsoDate('1985-01-15')).toBe(true);
    expect(DL.isValidIsoDate('bad')).toBe(false);
    expect(DL.daysBetweenIso('2026-01-01', '2026-01-31')).toBe(30);
  });
  it('computes expiry status', () => {
    expect(DL.isExpired('2025-01-15', NOW)).toBe(true);
    expect(DL.isExpired('2027-01-15', NOW)).toBe(false);
    expect(DL.daysUntilExpiry('2026-06-30', NOW)).toBe(19);
    expect(DL.isExpiringSoon('2026-06-30', 30, NOW)).toBe(true);
    expect(DL.expiryStatus('2025-01-15', 30, NOW)).toBe('expired');
    expect(DL.expiryStatus('2026-06-30', 30, NOW)).toBe('expiring');
    expect(DL.expiryStatus('2030-01-01', 30, NOW)).toBe('valid');
  });
  it('formats + converts AAMVA dates', () => {
    expect(DL.formatDateUS('1985-01-15')).toBe('01/15/1985');
    expect(DL.formatDateLong('1985-01-15')).toBe('January 15, 1985');
    expect(DL.aamvaDateToIso('01151985')).toBe('1985-01-15');
    expect(DL.isoToAamvaDate('1985-01-15')).toBe('19850115');
    expect(DL.addYearsIso('1985-01-15', 21)).toBe('2006-01-15');
  });
});

describe('dlFunctions — age & eligibility', () => {
  it('computes age with birthday correctness', () => {
    expect(DL.ageFromDob('1985-01-15', NOW)).toBe(41);
    expect(DL.ageFromDob('2008-07-01', NOW)).toBe(17); // birthday not yet reached
  });
  it('eligibility predicates', () => {
    expect(DL.isMinor('2010-01-15', NOW)).toBe(true);
    expect(DL.isUnder21('2006-12-25', NOW)).toBe(true);
    expect(DL.isOfDrinkingAge('1985-01-15', NOW)).toBe(true);
    expect(DL.canRentCarStandard('2003-01-01', NOW)).toBe(false);
    expect(DL.isSeniorDriver('1950-01-01', NOW)).toBe(true);
    expect(DL.ageBracket('1985-01-15', NOW)).toBe('25-64');
  });
  it('birthday math + flags', () => {
    expect(DL.turns21Iso('1985-01-15')).toBe('2006-01-15');
    expect(DL.daysUntilBirthday('1985-06-15', NOW)).toBe(4);
    const f = DL.eligibilityFlags('1985-01-15', NOW);
    expect(f.adult && f.drinking && !f.minor).toBe(true);
  });
});

describe('dlFunctions — physical descriptors', () => {
  it('height conversions', () => {
    expect(DL.heightToInches("5'10\"")).toBe(70);
    expect(DL.heightToInches('070 in')).toBe(70);
    expect(DL.heightToInches('178 cm')).toBe(70);
    expect(DL.heightToInches('510')).toBe(70);
    expect(DL.inchesToHeight(70)).toBe("5'10\"");
    expect(DL.formatHeight('178 cm')).toBe("5'10\"");
    expect(DL.inchesToCm(70)).toBe(178);
  });
  it('weight + colors + categories', () => {
    expect(DL.weightToLbs('82 kg')).toBe(181);
    expect(DL.lbsToKg(180)).toBe(82);
    expect(DL.eyeColorName('BRO')).toBe('Brown');
    expect(DL.hairColorName('BLK')).toBe('Black');
    expect(DL.heightCategory("6'2\"")).toBe('tall');
    expect(DL.isPlausibleHeight("5'10\"")).toBe(true);
    expect(DL.isPlausibleHeight('2\'00"')).toBe(false);
  });
});

describe('dlFunctions — codes', () => {
  it('expands + parses code sets', () => {
    expect(DL.expandRestriction('B')).toMatch(/Corrective lenses/);
    expect(DL.expandEndorsement('M')).toMatch(/Motorcycle/);
    expect(DL.expandClass('D')).toMatch(/regular operator/i);
    expect(DL.parseRestrictions('NONE')).toEqual([]);
    expect(DL.hasHazmat('H X')).toBe(true);
    expect(DL.hasMotorcycle('M', '')).toBe(true);
    expect(DL.requiresCorrectiveLenses('B')).toBe(true);
    expect(DL.hasPassengerEndorsement('P')).toBe(true);
    expect(DL.endorsementCount('M P')).toBe(2);
  });
});

describe('dlFunctions — compliance + quality + bridge', () => {
  const UTAH_V8 =
    '@\n\x1e\rANSI 636040080002DL00410250ZU02910010DLDAQ123456789\n' +
    'DCSSAMPLE\nDDEN\nDACJOHN\nDDFN\nDADQUINCY\nDDGN\n' +
    'DCAD\nDCBNONE\nDCDNONE\nDBD08242018\nDBB01151985\nDBA01152027\n' +
    'DBC1\nDAU070 in\nDAW180\nDAYBRO\nDAZBLK\n' +
    'DAG123 MAIN ST\nDAISALT LAKE CITY\nDAJUT\nDAK841010000  \n' +
    'DCF8360GVW0100\nDCGUSA\nDDAF\nDDB06062016\nDDK1\n\rZUZUA01\n';

  it('compliance labels', () => {
    const r = parseAamva(UTAH_V8);
    expect(DL.realIdStatus(r)).toBe('REAL ID compliant');
    expect(DL.documentTypeLabel(r)).toBe("Driver's License");
    expect(DL.complianceBadges(r)).toContain('REAL ID');
    expect(DL.complianceBadges(r)).toContain('DONOR');
  });
  it('quality + missing fields', () => {
    const r = parseAamva(UTAH_V8);
    expect(DL.missingCriticalFields(r)).toEqual([]);
    expect(DL.fieldCompleteness(r)).toBe(1);
    expect(DL.scanQualityScore(r)).toBeGreaterThanOrEqual(90);
    expect(DL.isUsableScan(r)).toBe(true);
    expect(DL.missingCriticalFields({ first_name: 'A' })).toContain('last_name');
  });
  it('evaluateDl single-call bridge returns full derived set', () => {
    const r = parseAamva(UTAH_V8);
    const e = DL.evaluateDl(r, NOW);
    expect(e.jurisdiction).toBe('UT');
    expect(e.jurisdictionName).toBe('Utah');
    expect(e.country).toBe('USA');
    expect(e.dlValid).toBe(true);
    expect(e.age).toBe(41);
    expect(e.eligibility.drinking).toBe(true);
    expect(e.height).toBe("5'10\"");
    expect(e.realId).toBe('REAL ID compliant');
    expect(e.usable).toBe(true);
    expect(e.summary).toContain('SAMPLE, JOHN');
    expect(e.expiry).toBe('valid');
  });
  it('subjectSummaryLine handles partial data', () => {
    expect(DL.subjectSummaryLine({ last_name: 'DOE', first_name: 'JANE' })).toContain('DOE, JANE');
  });
});

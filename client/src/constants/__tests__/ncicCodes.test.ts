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
  it('encodes newly added VMA codes from NIEM AutoCodeSimpleType', () => {
    // Verified against NIEM 5.0 AutoCodeSimpleType / MotorcycleCodeSimpleType
    expect(encode('VMA', 'Kawasaki')).toBe('KAWK');
    expect(encode('VMA', 'Yamaha')).toBe('YAMA');
    expect(encode('VMA', 'Harley')).toBe('HD');        // alias
    expect(encode('VMA', 'Freightliner')).toBe('FRHT');
    expect(encode('VMA', 'Peterbilt')).toBe('PTRB');
    expect(encode('VMA', 'Alfa Romeo')).toBe('ALFA');
    expect(encode('VMA', 'Kenworth')).toBe('KW');
  });
  it('decodes newly added VMA codes back to canonical labels', () => {
    expect(decode('VMA', 'KAWK')).toBe('Kawasaki');
    expect(decode('VMA', 'YAMA')).toBe('Yamaha');
    expect(decode('VMA', 'ALFA')).toBe('Alfa Romeo');
    expect(decode('VMA', 'FERR')).toBe('Ferrari');
    expect(decode('VMA', 'FRHT')).toBe('Freightliner');
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

  // ── New VCO color codes (NIEM 5.0 VCOCodeSimpleType) ─────
  it('decodes newly added NIEM VCO color codes', () => {
    expect(fmtCoded('VCO', 'AME')).toBe('AME (AMETHYST)');
    expect(fmtCoded('VCO', 'CAM')).toBe('CAM (CAMOUFLAGE)');
    expect(fmtCoded('VCO', 'COM')).toBe('COM (CHROME)');
    expect(fmtCoded('VCO', 'MVE')).toBe('MVE (MAUVE)');
    expect(fmtCoded('VCO', 'TPE')).toBe('TPE (TAUPE)');
  });
  it('encodes new VCO aliases', () => {
    expect(encode('VCO', 'Camo')).toBe('CAM');
    expect(encode('VCO', 'Taupe')).toBe('TPE');
    expect(encode('VCO', 'Mauve')).toBe('MVE');
    expect(encode('VCO', 'TEL')).toBe('TEA');  // TEL kept as alias for TEA (Teal)
  });

  // ── New VST body style codes (NIEM 4.2 VSTCodeSimpleType) ─
  it('decodes newly added NIEM VST body style codes', () => {
    expect(fmtCoded('VST', 'AM')).toBe('AM (AMBULANCE)');
    expect(fmtCoded('VST', 'MH')).toBe('MH (MOTOR HOME)');
    expect(fmtCoded('VST', 'SM')).toBe('SM (SNOWMOBILE)');
    expect(fmtCoded('VST', 'FB')).toBe('FB (FLATBED)');
    expect(fmtCoded('VST', 'DP')).toBe('DP (DUMP TRUCK)');
    expect(fmtCoded('VST', 'LM')).toBe('LM (LIMOUSINE)');
    expect(fmtCoded('VST', 'TN')).toBe('TN (TANKER)');
    expect(fmtCoded('VST', 'TT')).toBe('TT (TOW TRUCK)');
  });
  it('encodes new VST aliases', () => {
    expect(encode('VST', 'Motorhome')).toBe('MH');
    expect(encode('VST', 'Snowmobile')).toBe('SM');
    expect(encode('VST', 'Limo')).toBe('LM');
    expect(encode('VST', 'Flatbed')).toBe('FB');
    expect(encode('VST', 'Dump Truck')).toBe('DP');
    expect(encode('VST', 'Tanker')).toBe('TN');
    expect(encode('VST', 'Ambulance')).toBe('AM');
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

  // ── New Canadian province codes (NLETS / ISO 3166-2:CA) ──
  it('decodes all newly added Canadian provinces/territories', () => {
    expect(fmtCoded('STATE', 'SK')).toBe('SK (SASKATCHEWAN)');
    expect(fmtCoded('STATE', 'NB')).toBe('NB (NEW BRUNSWICK)');
    expect(fmtCoded('STATE', 'NL')).toBe('NL (NEWFOUNDLAND AND LABRADOR)');
    expect(fmtCoded('STATE', 'NS')).toBe('NS (NOVA SCOTIA)');
    expect(fmtCoded('STATE', 'NT')).toBe('NT (NORTHWEST TERRITORIES)');
    expect(fmtCoded('STATE', 'NU')).toBe('NU (NUNAVUT)');
    expect(fmtCoded('STATE', 'PE')).toBe('PE (PRINCE EDWARD ISLAND)');
    expect(fmtCoded('STATE', 'YT')).toBe('YT (YUKON)');
  });
  it('encodes Canadian province names to codes', () => {
    expect(encode('STATE', 'Saskatchewan')).toBe('SK');
    expect(encode('STATE', 'Yukon')).toBe('YT');
    expect(encode('STATE', 'PEI')).toBe('PE');  // alias
  });

  // ── New DL restriction codes (AAMVA A–Z) ─────────────────
  it('decodes AAMVA DL restriction codes A–Z', () => {
    expect(fmtCoded('DL_RESTRICTION', 'A')).toBe('A (CORRECTIVE LENSES)');
    expect(fmtCoded('DL_RESTRICTION', 'G')).toBe('G (DAYLIGHT ONLY)');
    expect(fmtCoded('DL_RESTRICTION', 'K')).toBe('K (CDL INTRASTATE ONLY)');
    expect(fmtCoded('DL_RESTRICTION', 'M')).toBe('M (NO CLASS A BUS)');
    expect(fmtCoded('DL_RESTRICTION', 'T')).toBe('T (IGNITION INTERLOCK)');
    expect(fmtCoded('DL_RESTRICTION', 'V')).toBe('V (MEDICAL VARIANCE)');
  });
  it('encodes DL restriction aliases', () => {
    expect(encode('DL_RESTRICTION', 'IID Required')).toBe('T');
    expect(encode('DL_RESTRICTION', 'Automatic Transmission Only')).toBe('E');
    expect(encode('DL_RESTRICTION', 'No Air Brakes')).toBe('L');
    expect(encode('DL_RESTRICTION', 'Daylight Only')).toBe('G');
  });
});

import { lookupOffense, fmtOffense, lookupAnyCode } from '../ncicCodes';

describe('offense codes', () => {
  it('looks up an exact offense', () => {
    const e = lookupOffense('Theft');
    expect(e?.utahStatute).toBe('76-6-404');
    expect(e?.severity).toBeTruthy();
    expect(e?.ncicCode).toMatch(/^\d{4}$/);
  });
  it('matches by keyword inside a longer charge string', () => {
    expect(lookupOffense('DUI - First Offense')?.utahStatute).toBe('41-6a-502');
    expect(lookupOffense('AGGRAVATED ASSAULT W/ WEAPON')?.utahStatute).toBe('76-5-103');
  });
  it('prefers the more specific offense', () => {
    expect(lookupOffense('Retail Theft')?.utahStatute).toBe('76-6-602');
  });
  it('fmtOffense annotates with statute, severity and NCIC code', () => {
    expect(fmtOffense('Theft')).toMatch(/^THEFT \(76-6-404 · .+ · NCIC \d{4}\)$/);
  });
  it('fmtOffense returns the raw charge when unmatched', () => {
    expect(fmtOffense('Jaywalking On Mars')).toBe('JAYWALKING ON MARS');
    expect(fmtOffense('')).toBe('');
  });
  it('does not let generic THEFT shadow IDENTITY THEFT', () => {
    expect(lookupOffense('Identity Theft')?.utahStatute).toBe('76-6-1102');
    expect(lookupOffense('Identity Theft')?.severity).toBe('F3');
  });

  // ── New comprehensive coverage tests ──────────────────────────

  it('aggravated robbery resolves to the agg-robbery statute not generic robbery', () => {
    expect(lookupOffense('Aggravated Robbery')?.utahStatute).toBe('76-6-302');
    expect(lookupOffense('Aggravated Robbery')?.severity).toBe('F1');
    // plain robbery falls back to second-degree statue
    expect(lookupOffense('Robbery')?.utahStatute).toBe('76-6-301');
    expect(lookupOffense('Robbery')?.severity).toBe('F2');
  });

  it('aggravated burglary resolves before generic burglary', () => {
    expect(lookupOffense('Aggravated Burglary')?.utahStatute).toBe('76-6-203');
    expect(lookupOffense('Aggravated Burglary')?.severity).toBe('F1');
    expect(lookupOffense('Burglary of a Vehicle')?.utahStatute).toBe('76-6-204');
    expect(lookupOffense('Burglary')?.utahStatute).toBe('76-6-202');
  });

  it('sexual offense entries resolve correctly', () => {
    expect(lookupOffense('Rape')?.utahStatute).toBe('76-5-402');
    expect(lookupOffense('Rape')?.severity).toBe('F1');
    expect(lookupOffense('Forcible Sodomy')?.utahStatute).toBe('76-5-403');
    expect(lookupOffense('Sexual Abuse of a Child')?.utahStatute).toBe('76-5-404.1');
    expect(lookupOffense('Unlawful Sexual Activity with a Minor')?.utahStatute).toBe('76-5-401');
    // RAPE OF A CHILD more specific than RAPE
    expect(lookupOffense('Rape of a Child')?.utahStatute).toBe('76-5-402.1');
  });

  it('controlled substance distribution entry resolves with correct severity', () => {
    expect(lookupOffense('Distribution of Controlled Substance')?.utahStatute).toBe('58-37-8(1)(a)');
    expect(lookupOffense('Distribution of Controlled Substance')?.severity).toBe('F2');
    expect(lookupOffense('Possession with Intent to Distribute')?.utahStatute).toBe('58-37-8(1)(a)');
    // generic possession is class A misdemeanor baseline
    expect(lookupOffense('Possession of Controlled Substance')?.severity).toBe('MA');
  });

  it('drug paraphernalia resolves to 58-37a-5', () => {
    expect(lookupOffense('Drug Paraphernalia Possession')?.utahStatute).toBe('58-37a-5');
  });

  it('weapons offenses resolve to correct statutes', () => {
    expect(lookupOffense('Felon in Possession of a Firearm')?.utahStatute).toBe('76-10-503');
    expect(lookupOffense('Felon in Possession of a Firearm')?.severity).toBe('F2');
    expect(lookupOffense('Discharge of Firearm from Vehicle')?.utahStatute).toBe('76-10-508');
    expect(lookupOffense('Concealed Weapon without Permit')?.utahStatute).toBe('76-10-504');
  });

  it('eluding resolves before generic failure to stop', () => {
    expect(lookupOffense('Eluding Officer')?.utahStatute).toBe('41-6a-210');
    expect(lookupOffense('Eluding')?.utahStatute).toBe('41-6a-210');
    expect(lookupOffense('Eluding')?.severity).toBe('F3');
  });

  it('hit and run with injury resolves before plain hit and run', () => {
    expect(lookupOffense('Hit and Run with Injury')?.ncicCode).toBe('5401');
    expect(lookupOffense('Hit and Run with Injury')?.severity).toBe('F3');
    expect(lookupOffense('Hit and Run')?.severity).toBe('MB'); // 41-6a-401.7: property-damage-only hit and run = class B misdemeanor
  });

  it('stalking resolves to 76-5-106.5', () => {
    expect(lookupOffense('Stalking')?.utahStatute).toBe('76-5-106.5');
    expect(lookupOffense('Stalking')?.ncicCode).toBe('1316');
  });

  it('communications fraud resolves before generic fraud', () => {
    expect(lookupOffense('Communications Fraud')?.utahStatute).toBe('76-10-1801');
    expect(lookupOffense('Communications Fraud')?.severity).toBe('F2');
    // plain fraud falls back to the generic fraud entry
    expect(lookupOffense('Fraud')?.utahStatute).toBe('76-6-405');
  });

  it('money laundering resolves correctly', () => {
    expect(lookupOffense('Money Laundering')?.utahStatute).toBe('76-10-1902');
    expect(lookupOffense('Money Laundering')?.severity).toBe('F2');
  });

  it('escape resolves to 76-8-309', () => {
    expect(lookupOffense('Escape from Custody')?.utahStatute).toBe('76-8-309');
    expect(lookupOffense('Escape from Custody')?.ncicCode).toBe('4901');
  });
});

describe('lookupAnyCode (QZ decoder)', () => {
  it('finds a make by label', () => {
    const hits = lookupAnyCode('Toyota');
    expect(hits).toContainEqual({ domain: 'VMA', code: 'TOYT', label: 'Toyota' });
  });
  it('finds a make by code', () => {
    const hits = lookupAnyCode('TOYT');
    expect(hits).toContainEqual({ domain: 'VMA', code: 'TOYT', label: 'Toyota' });
  });
  it('finds a single-letter code across domains', () => {
    const hits = lookupAnyCode('W');
    expect(hits).toContainEqual({ domain: 'RACE', code: 'W', label: 'White' });
  });
  it('returns empty for nonsense', () => {
    expect(lookupAnyCode('zzzqq')).toEqual([]);
  });
});

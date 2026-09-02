import { describe, it, expect } from 'vitest';
import { parseAamva, looksLikeAamva } from '../aamvaParser';

// Realistic AAMVA v8 payload (Utah-style) — structure per the AAMVA
// DL/ID Card Design Standard: header, subfile directory, DL subfile
// elements terminated by LF, then a jurisdiction (ZU) subfile.
const UTAH_V8 =
  '@\n\x1e\rANSI 636040080002DL00410250ZU02910010DLDAQ123456789\n' +
  'DCSSAMPLE\nDDEN\nDACJOHN\nDDFN\nDADQUINCY\nDDGN\n' +
  'DCAD\nDCBNONE\nDCDNONE\nDBD08242018\nDBB01151985\nDBA01152027\n' +
  'DBC1\nDAU070 in\nDAW180\nDAYBRO\nDAZBLK\n' +
  'DAG123 MAIN ST\nDAISALT LAKE CITY\nDAJUT\nDAK841010000  \n' +
  'DCF8360GVW0100\nDCGUSA\nDDAF\nDDB06062016\nDDK1\n' +
  '\rZUZUA01\n';

describe('looksLikeAamva', () => {
  it('accepts AAMVA payloads and rejects junk', () => {
    expect(looksLikeAamva(UTAH_V8)).toBe(true);
    expect(looksLikeAamva('hello world')).toBe(false);
    expect(looksLikeAamva('')).toBe(false);
  });

  it('accepts a glued DLDAQ body with no word-boundary before DAQ', () => {
    // Live cameras / AVFoundation often collapse record separators, leaving
    // `…10DLDAQ123…DCSSAMPLE` with no `\b` before DAQ. The old `/\bDAQ/`
    // gate rejected these as "not a driver license payload" after a successful
    // PDF417 decode.
    const glued = '@\n\x1e\rANSI 636040080002DL00410080ZU01210010DLDAQ123456789DCSSAMPLEDACJOHN';
    expect(looksLikeAamva(glued)).toBe(true);
    expect(parseAamva(glued).dl_number).toBe('123456789');
    expect(parseAamva(glued).last_name).toBe('SAMPLE');
    expect(parseAamva(glued).first_name).toBe('JOHN');
  });
});

describe('parseAamva — full field extraction', () => {
  const r = parseAamva(UTAH_V8);

  it('reads header (IIN, version, jurisdiction)', () => {
    expect(r.issuer_id).toBe('636040');
    expect(r.aamva_version).toBe(8);
    expect(r.dl_state).toBe('UT'); // via IIN registry
    expect(r.card_type).toBe('DL');
  });

  it('reads identity fields', () => {
    expect(r.last_name).toBe('SAMPLE');
    expect(r.first_name).toBe('JOHN');
    expect(r.middle_name).toBe('QUINCY');
    expect(r.date_of_birth).toBe('1985-01-15'); // MMDDCCYY → ISO
    expect(r.gender).toBe('Male');
  });

  it('reads physical descriptors with unit conversion', () => {
    expect(r.height).toBe('5\'10"'); // "070 in" → 5'10"
    expect(r.weight).toBe('180');
    expect(r.eye_color).toBe('Brown');
    expect(r.hair_color).toBe('Black');
  });

  it('reads address with zero plus-four ZIP cleanup', () => {
    expect(r.address).toBe('123 MAIN ST');
    expect(r.city).toBe('SALT LAKE CITY');
    expect(r.state).toBe('UT');
    expect(r.zip).toBe('84101'); // 841010000 → 84101
  });

  it('reads license fields and strips NONE filler', () => {
    expect(r.dl_number).toBe('123456789');
    expect(r.dl_class).toBe('D');
    expect(r.dl_expiry).toBe('2027-01-15');
    expect(r.dl_issue_date).toBe('2018-08-24');
    expect(r.dl_restrictions).toBe('');  // "NONE" → empty
    expect(r.dl_endorsements).toBe('');
  });

  it('reads compliance flags', () => {
    expect(r.is_real_id).toBe(true);   // DDA=F (fully compliant)
    expect(r.is_organ_donor).toBe(true);
    expect(r.document_discriminator).toBe('8360GVW0100');
    expect(r.country).toBe('USA');
  });

  it('preserves every raw element including jurisdiction subfile', () => {
    expect(r.raw_elements.DAQ).toBe('123456789');
    expect(r.raw_elements.ZUA).toBe('01');
  });

  it('does not bleed the next subfile into the last field when there is no separator between them', () => {
    // Real encoders don't guarantee a newline between the last field of one
    // subfile and the header of the next — they rely on the directory's
    // offset/length instead. Strip the "\n\r" between "DDK1" and "ZUZUA01"
    // (shifting the ZU directory offset by the same 2 bytes) to prove the
    // DL subfile's last field ("DDK") doesn't swallow the ZU subfile's bytes.
    const noSeparator = UTAH_V8
      .replace('ZU02910010', 'ZU02890010')
      .replace('DDK1\n\rZUZUA01\n', 'DDK1ZUZUA01\n');
    const r2 = parseAamva(noSeparator);
    expect(r2.raw_elements.DDK).toBe('1');
    expect(r2.raw_elements.ZUA).toBe('01');
    expect(r2.is_organ_donor).toBe(true);
  });
});

describe('parseAamva — version/format variants', () => {
  it('parses CCYYMMDD dates for Canada', () => {
    const can = '@\n\x1e\rANSI 636028080002DLDAQ9999\nDCSDOE\nDACJANE\nDBB19900230\nDBA20271231\nDBB19900115\nDCGCAN\n';
    const r = parseAamva(can.replace('DBB19900230\n', ''));
    expect(r.date_of_birth).toBe('1990-01-15');
    expect(r.dl_expiry).toBe('2027-12-31');
  });

  it('recovers CCYYMMDD encoded as if US when month is impossible', () => {
    const raw = '@\n\x1e\rANSI 636040080002DLDAQ1\nDCSX\nDACY\nDBB19850115\n';
    expect(parseAamva(raw).date_of_birth).toBe('1985-01-15');
  });

  it('parses v1 payloads (AAMVA prefix, DAA combined name, FII height)', () => {
    const v1 = '@\n\x1e\rAAMVA6360400102DLDAQ0123\nDAASAMPLE,JOHN,Q\nDBB19850115\nDAU510\nDBC1\n';
    const r = parseAamva(v1);
    expect(r.last_name).toBe('SAMPLE');
    expect(r.first_name).toBe('JOHN');
    expect(r.middle_name).toBe('Q');
    expect(r.date_of_birth).toBe('1985-01-15');
    expect(r.height).toBe('5\'10"');
  });

  it('converts metric height and weight', () => {
    const m = '@\n\x1e\rANSI 636028080002DLDAQ1\nDCSX\nDACY\nDAU178 cm\nDAX082\n';
    const r = parseAamva(m);
    expect(r.height).toBe('5\'10"');
    expect(r.weight).toBe('181');
  });

  it('throws on non-AAMVA text', () => {
    expect(() => parseAamva('just some text')).toThrow();
  });
});

describe('assessAamva — derived scan alerts', () => {
  const NOW = new Date(2026, 5, 11); // 2026-06-11

  const base = () => parseAamva(
    '@\n\x1e\rANSI 636040080002DLDAQ1\nDCSDOE\nDACJANE\nDBB01151990\nDBA01152027\n',
  );

  it('no alerts for a valid adult license', async () => {
    const { assessAamva } = await import('../aamvaParser');
    expect(assessAamva(base(), NOW)).toEqual([]);
  });

  it('flags an expired license as danger', async () => {
    const { assessAamva } = await import('../aamvaParser');
    const r = { ...base(), dl_expiry: '2025-01-15' };
    const alerts = assessAamva(r, NOW);
    expect(alerts.some(a => a.code === 'EXPIRED' && a.level === 'danger')).toBe(true);
  });

  it('warns when expiring within 30 days', async () => {
    const { assessAamva } = await import('../aamvaParser');
    const r = { ...base(), dl_expiry: '2026-06-30' };
    expect(assessAamva(r, NOW).some(a => a.code === 'EXPIRING' && a.level === 'warning')).toBe(true);
  });

  it('flags minors (danger) and under-21 (warning) with correct ages', async () => {
    const { assessAamva } = await import('../aamvaParser');
    expect(assessAamva({ ...base(), date_of_birth: '2010-01-15' }, NOW)
      .find(a => a.code === 'MINOR')?.message).toContain('age 16');
    expect(assessAamva({ ...base(), date_of_birth: '2006-12-25' }, NOW)
      .find(a => a.code === 'UNDER_21')?.message).toContain('age 19');
  });

  it('respects birthday-not-yet-reached when computing age', async () => {
    const { assessAamva } = await import('../aamvaParser');
    // 18th birthday is 2026-07-01 — still 17 on 2026-06-11
    expect(assessAamva({ ...base(), date_of_birth: '2008-07-01' }, NOW)
      .find(a => a.code === 'MINOR')?.message).toContain('age 17');
  });

  it('flags ID-only cards and temporary documents', async () => {
    const { assessAamva } = await import('../aamvaParser');
    const r = { ...base(), card_type: 'ID' as const, raw_elements: { ...base().raw_elements, DDD: '1' } };
    const codes = assessAamva(r, NOW).map(a => a.code);
    expect(codes).toContain('ID_CARD');
    expect(codes).toContain('LIMITED_DURATION');
  });
});

describe('describeAamva — English readout', () => {
  it('translates every element with code dictionaries', async () => {
    const { describeAamva } = await import('../aamvaParser');
    const r = parseAamva(
      '@\n\x1e\rANSI 636040080002DLDAQ123\nDCSDOE\nDACJANE\nDBB01151990\nDBC2\nDAU070 in\nDCAD\nDCBB\nDCDM\nDAYGRN\n',
    );
    const rows = describeAamva(r);
    const byCode = Object.fromEntries(rows.map(x => [x.code, x]));
    expect(byCode.DCB.english).toContain('Corrective lenses');
    expect(byCode.DCD.english).toContain('Motorcycle');
    expect(byCode.DCA.english).toContain('regular operator');
    expect(byCode.DBC.english).toBe('Female');
    expect(byCode.DAU.english).toBe('5\'10"');
    expect(byCode.DAY.english).toBe('Green');
    expect(byCode.DBB.english).toBe('1990-01-15');
    // every decoded element appears
    expect(rows.length).toBe(Object.keys(r.raw_elements).length);
  });
});

describe('formatLawEnforcement — NCIC/NLETS fielded output', () => {
  it('formats per NCIC conventions (NAM, CCYYMMDD dates, HGT digits, raw codes)', async () => {
    const { formatLawEnforcement, formatLeBlock } = await import('../aamvaParser');
    const r = parseAamva(UTAH_V8);
    const fields = formatLawEnforcement(r);
    const byTag = Object.fromEntries(fields.map(f => [f.tag, f.value]));
    expect(byTag.NAM).toBe('SAMPLE,JOHN QUINCY');
    expect(byTag.DOB).toBe('19850115');
    expect(byTag.SEX).toBe('M');
    expect(byTag.HGT).toBe('510');      // 5'10" → 510
    expect(byTag.WGT).toBe('180');
    expect(byTag.EYE).toBe('BRO');      // raw NCIC code, not "Brown"
    expect(byTag.HAI).toBe('BLK');
    expect(byTag.OLN).toBe('123456789');
    expect(byTag.OLS).toBe('UT');
    expect(byTag.EXP).toBe('20270115');
    expect(byTag.ZIP).toBe('84101');
    // empty fields omitted (restrictions were NONE)
    expect(byTag.RES).toBeUndefined();

    const block = formatLeBlock(r);
    expect(block).toContain('NAM /SAMPLE,JOHN QUINCY');
    expect(block).toContain('OLN /123456789');
  });

  it('maps non-binary sex to U and omits absent fields', async () => {
    const { formatLawEnforcement } = await import('../aamvaParser');
    const r = parseAamva('@\n\x1e\rANSI 636040080002DLDAQ77\nDCSDOE\nDACJANE\nDBC9\n');
    const byTag = Object.fromEntries(formatLawEnforcement(r).map(f => [f.tag, f.value]));
    expect(byTag.SEX).toBe('U');
    expect(byTag.HGT).toBeUndefined();
    expect(byTag.EXP).toBeUndefined();
  });
});

describe('parseAamva — additional AAMVA fields', () => {
  const raw = [
    '@\n\x1e\rANSI 636040090002DL00410278ZU03410024DLDAQ123456789',
    'DCSPETERSON',
    'DACANDREW',
    'DADSCOTT',
    'DBB01151990',
    'DBC1',
    'DAYBRN',
    'DAZBRO',
    'DAU510',
    'DAW180',
    'DAGTEST ST',
    'DAISLC',
    'DAJUT',
    'DAK84101',
    'DBA01152030',
    'DBD01152020',
    'DCINew York',
    'DCLW',
    'DAFMr',
    'DDB01152023',
    'DDC01152025',
    'DBI1',
    'DDD1',
    'DCJAUDIT123',
  ].join('\r');

  it('extracts place_of_birth from DCI', () => {
    const r = parseAamva(raw);
    expect(r.place_of_birth).toBe('New York');
  });

  it('extracts race from DCL', () => {
    const r = parseAamva(raw);
    expect(r.race).toBe('White');
  });

  it('extracts name_prefix from DAF', () => {
    const r = parseAamva(raw);
    expect(r.name_prefix).toBe('Mr');
  });

  it('extracts card_revision_date from DDB', () => {
    const r = parseAamva(raw);
    expect(r.card_revision_date).toBeTruthy();
  });

  it('extracts dl_hazmat_expiry from DDC', () => {
    const r = parseAamva(raw);
    expect(r.dl_hazmat_expiry).toBeTruthy();
  });

  it('extracts non_resident_indicator from DBI', () => {
    const r = parseAamva(raw);
    expect(r.non_resident_indicator).toBe(true);
  });

  it('extracts limited_duration_doc from DDD', () => {
    const r = parseAamva(raw);
    expect(r.limited_duration_doc).toBe(true);
  });

  it('extracts audit_info from DCJ', () => {
    const r = parseAamva(raw);
    expect(r.audit_info).toBe('AUDIT123');
  });
});

describe('plain-English helpers for stored records', () => {
  it('translates restriction codes to English (code preserved)', async () => {
    const { describeRestrictions } = await import('../aamvaParser');
    expect(describeRestrictions('B')).toBe('B — Corrective lenses required');
    // multi-code, comma-delimited
    expect(describeRestrictions('B,F')).toBe('B — Corrective lenses required; F — Outside mirror required');
  });

  it('translates endorsement and class codes to English', async () => {
    const { describeEndorsements, describeClass } = await import('../aamvaParser');
    expect(describeEndorsements('M')).toBe('M — Motorcycle');
    expect(describeClass('D')).toBe('Class D — regular operator license');
  });

  it('returns empty string for blank / filler values (not "None")', async () => {
    const { describeRestrictions, describeEndorsements, describeClass } = await import('../aamvaParser');
    expect(describeRestrictions('')).toBe('');
    expect(describeRestrictions('NONE')).toBe('');
    expect(describeEndorsements('UNK')).toBe('');
    expect(describeClass('')).toBe('');
  });

  it('passes already-translated values through unchanged (phone-relay round-trip)', async () => {
    const { describeRestrictions, describeClass } = await import('../aamvaParser');
    // An already-described value must not be re-mangled when re-saved.
    expect(describeRestrictions('B — Corrective lenses required')).toBe('B — Corrective lenses required');
    expect(describeClass('Class D — regular operator license')).toBe('Class D — regular operator license');
  });

  it('leaves unknown codes intact rather than dropping them', async () => {
    const { describeRestrictions } = await import('../aamvaParser');
    expect(describeRestrictions('Q')).toBe('Q');
  });
});

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

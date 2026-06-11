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

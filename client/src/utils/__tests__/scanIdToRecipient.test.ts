import { describe, it, expect } from 'vitest';
import { aamvaToScanResultObj, aamvaToServeOverrides } from '../scanIdToRecipient';
import type { AamvaResult } from '../aamvaParser';

function makeAamva(overrides: Partial<AamvaResult> = {}): AamvaResult {
  return {
    first_name: 'JANE', middle_name: 'Q', last_name: 'DOE', suffix: '',
    date_of_birth: '1990-05-14', gender: 'Female', height: "5'06\"", weight: '140',
    eye_color: 'Brown', hair_color: 'Black',
    address: '123 MAIN ST', address2: '', city: 'SALT LAKE CITY', state: 'UT', zip: '84101',
    dl_number: 'D1234567', dl_state: 'UT', dl_class: 'D', dl_expiry: '2028-05-14',
    dl_issue_date: '2020-05-14', dl_restrictions: 'B', dl_endorsements: '',
    country: 'USA', document_discriminator: 'ABC123', is_real_id: true,
    is_organ_donor: null, is_veteran: null, under_18_until: '', under_21_until: '',
    aamva_version: 9, issuer_id: '636040', card_type: 'DL', raw_elements: {},
    place_of_birth: '', race: '', name_prefix: '', card_revision_date: '',
    dl_hazmat_expiry: '', non_resident_indicator: false, limited_duration_doc: false,
    audit_info: '',
    ...overrides,
  };
}

describe('aamvaToScanResultObj', () => {
  it('maps AAMVA fields to the /records/from-dl-scan payload shape', () => {
    const out = aamvaToScanResultObj(makeAamva());
    expect(out.first_name).toBe('JANE');
    expect(out.last_name).toBe('DOE');
    expect(out.dl_number).toBe('D1234567');
    expect(out.dl_state).toBe('UT');
    expect(out.date_of_birth).toBe('1990-05-14');
    // dl_class/restrictions/endorsements go through the describe* translators
    expect(out.dl_class).toMatch(/Class D/);
    // Full-field-coverage additions
    expect(out.address2).toBe('');
    expect(out.is_real_id).toBe(true);
    expect(out.aamva_version).toBe(9);
    expect(out.issuer_id).toBe('636040');
    expect(out.raw_elements).toEqual({});
  });

  it('leaves restrictions/endorsements empty when not encoded', () => {
    const out = aamvaToScanResultObj(makeAamva({ dl_restrictions: '', dl_endorsements: '' }));
    expect(out.dl_restrictions).toBe('');
    expect(out.dl_endorsements).toBe('');
  });
});

describe('aamvaToServeOverrides', () => {
  it('maps AAMVA fields to ServeIntakePage recipient override keys', () => {
    const out = aamvaToServeOverrides(makeAamva());
    expect(out.recipient_first_name).toBe('JANE');
    expect(out.recipient_last_name).toBe('DOE');
    expect(out.recipient_middle_name).toBe('Q');
    expect(out.recipient_dob).toBe('1990-05-14');
    expect(out.recipient_address).toBe('123 MAIN ST');
    expect(out.recipient_city).toBe('SALT LAKE CITY');
    expect(out.recipient_state).toBe('UT');
    expect(out.recipient_zip).toBe('84101');
  });

  it('omits keys for empty AAMVA fields rather than writing blank strings', () => {
    const out = aamvaToServeOverrides(makeAamva({ middle_name: '' }));
    expect('recipient_middle_name' in out).toBe(false);
  });
});

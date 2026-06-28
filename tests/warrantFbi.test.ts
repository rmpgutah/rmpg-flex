import { describe, it, expect } from 'vitest';
import { normalizeFbiItem } from '../src/utils/warrantSources/adapters/fbi';

const ITEM = {
  uid: 'abc123', title: 'JOHN Q SMITH', description: 'Wire Fraud',
  subjects: ['Crimes Against Children'], aliases: ['Johnny S'],
  dates_of_birth_used: ['1985-04-12'], sex: 'Male', race: 'white',
  field_offices: ['saltlakecity'], warning_message: 'SHOULD BE CONSIDERED ARMED',
  images: [{ thumb: 'https://www.fbi.gov/x/thumb.jpg', large: 'https://www.fbi.gov/x/large.jpg' }],
  url: 'https://www.fbi.gov/wanted/x',
};

describe('normalizeFbiItem', () => {
  it('maps an FBI item to a RawWarrantHit', () => {
    const h = normalizeFbiItem(ITEM);
    expect(h.source_key).toBe('fbi-wanted');
    expect(h.warrant_id).toBe('abc123');
    expect(h.full_name).toBe('Smith, John Q'); // title "FIRST [M] LAST" → "Last, First M"
    expect(h.date_of_birth).toBe('1985-04-12');
    expect(h.charge_description).toContain('Wire Fraud');
    expect(h.state).toBe('US');
    expect(h.photo_url).toContain('thumb');
    expect(h.detail_url).toContain('fbi.gov');
  });
  it('tolerates missing optional fields', () => {
    const h = normalizeFbiItem({ uid: 'x', title: 'DOE' });
    expect(h.warrant_id).toBe('x');
    expect(h.date_of_birth).toBeNull();
  });
});

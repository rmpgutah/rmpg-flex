import { describe, it, expect } from 'vitest';
import { normalizeUtahCountyItem } from '../src/utils/warrantSources/adapters/utahCounty';

const ITEM = { id: 42, top_name: 'SMITH, JOHN Q', age: 40, charge_info: 'BURGLARY (F2) - Case 181813 - Bond $5000', photo_path: 'a.jpg', web_photo_path: '/api/mostWanted/imgProxy/a.jpg', added_on: '2024-06-01' };

describe('normalizeUtahCountyItem', () => {
  it('maps a Utah County mostWanted item to a RawWarrantHit', () => {
    const h = normalizeUtahCountyItem(ITEM);
    expect(h.source_key).toBe('utah-county-mostwanted');
    expect(h.warrant_id).toBe('42');
    expect(h.full_name).toBe('Smith, John Q');
    expect(h.age).toBe(40);
    expect(h.charge_description).toContain('BURGLARY');
    expect(h.state).toBe('UT');
    expect(h.photo_url).toContain('sheriff.utahcounty.gov');
  });
  it('tolerates a string id and missing fields', () => {
    const h = normalizeUtahCountyItem({ id: '7', top_name: 'DOE, JANE' });
    expect(h.warrant_id).toBe('7');
    expect(h.age).toBeNull();
    expect(h.photo_url).toBeNull();
  });
});

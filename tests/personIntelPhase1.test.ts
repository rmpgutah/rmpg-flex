import { describe, it, expect } from 'vitest';
import { queryPhase1 } from '../src/utils/personIntel/phase1';
import type { IntelSeed } from '../src/utils/personIntel/types';

function makeDb(rows: any[]): any {
  return {
    prepare: () => ({
      bind: () => ({
        all: async () => ({ results: rows }),
        first: async () => rows[0] ?? null,
      }),
    }),
  };
}

describe('queryPhase1', () => {
  it('returns empty source result on empty DB', async () => {
    const db = makeDb([]);
    const seed: IntelSeed = { name: 'John Doe' };
    const result = await queryPhase1(db, seed);
    expect(result.sourceName).toBe('InternalRecords');
    expect(result.phase).toBe(1);
    expect(result.status).toBe('success');
    expect(result.dataPoints).toHaveLength(0);
  });

  it('keeps a unique name-only internal hit as a lead', async () => {
    const db = makeDb([{
      full_name: 'John Doe', date_of_birth: '1990-01-01', first_name: 'John', last_name: 'Doe',
      address: '123 Main St', city: 'Salt Lake City', state: 'UT', zip: '84101',
    }]);
    const seed: IntelSeed = { name: 'John Doe' };
    const result = await queryPhase1(db, seed);
    expect(result.status).toBe('success');
    const addrPoints = result.dataPoints.filter(p => p.category === 'address');
    expect(addrPoints.length).toBeGreaterThan(0);
  });

  it('drops namesake internals when DOB is supplied and does not match', async () => {
    const db = makeDb([{
      full_name: 'John Doe', date_of_birth: '1980-01-01', first_name: 'John', last_name: 'Doe',
      address: '9 Other St', city: 'Provo', state: 'UT', zip: '84601',
    }]);
    const seed: IntelSeed = { name: 'John Doe', dob: '10/11/2001', age: 24, city: 'Salt Lake City', state: 'UT' };
    const result = await queryPhase1(db, seed);
    expect(result.dataPoints).toHaveLength(0);
  });

  it('keeps the John Doe whose DOB matches the seed', async () => {
    const db = makeDb([{
      full_name: 'John Doe', date_of_birth: '2001-10-11', first_name: 'John', last_name: 'Doe',
      address: '123 Main St', city: 'Salt Lake City', state: 'UT', zip: '84101',
    }]);
    const seed: IntelSeed = { name: 'John Doe', dob: '10/11/2001', city: 'Salt Lake City', state: 'UT' };
    const result = await queryPhase1(db, seed);
    expect(result.dataPoints.some(p => p.field === 'street' && p.value === '123 Main St')).toBe(true);
  });

  it('wraps phone numbers as phone data points', async () => {
    const db = makeDb([{ phone: '8015550001', full_name: 'Jane Smith' }]);
    const seed: IntelSeed = { phone: '8015550001' };
    const result = await queryPhase1(db, seed);
    const phonePoints = result.dataPoints.filter(p => p.category === 'phone');
    expect(phonePoints.length).toBeGreaterThan(0);
  });
});

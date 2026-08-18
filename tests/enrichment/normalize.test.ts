import { describe, it, expect } from 'vitest';
import { computeCacheKey } from '../../src/utils/enrichment/normalize';

describe('computeCacheKey', () => {
  it('is deterministic for the same seed', async () => {
    const seed = { first_name: 'John', last_name: 'Smith', dob: '1990-05-12' };
    const a = await computeCacheKey(seed);
    const b = await computeCacheKey(seed);
    expect(a).toBe(b);
  });

  it('is case-insensitive on name', async () => {
    const a = await computeCacheKey({ first_name: 'JOHN', last_name: 'SMITH', dob: '1990-05-12' });
    const b = await computeCacheKey({ first_name: 'john', last_name: 'smith', dob: '1990-05-12' });
    expect(a).toBe(b);
  });

  it('trims whitespace before hashing', async () => {
    const a = await computeCacheKey({ first_name: ' John ', last_name: ' Smith ', dob: '1990-05-12' });
    const b = await computeCacheKey({ first_name: 'John', last_name: 'Smith', dob: '1990-05-12' });
    expect(a).toBe(b);
  });

  it('produces different keys for different DOBs', async () => {
    const a = await computeCacheKey({ first_name: 'John', last_name: 'Smith', dob: '1990-05-12' });
    const b = await computeCacheKey({ first_name: 'John', last_name: 'Smith', dob: '1991-05-12' });
    expect(a).not.toBe(b);
  });

  it('handles missing DOB gracefully', async () => {
    const key = await computeCacheKey({ first_name: 'John', last_name: 'Smith' });
    expect(typeof key).toBe('string');
    expect(key.length).toBe(64); // hex SHA-256
  });
});

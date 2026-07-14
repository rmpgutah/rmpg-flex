import { describe, it, expect } from 'vitest';
import { resolveCountyFromAddress } from '../src/utils/parcel-lookup/router';

describe('resolveCountyFromAddress', () => {
  it('resolves Salt Lake County cities', () => {
    expect(resolveCountyFromAddress('123 Main St, Salt Lake City, UT 84101')).toBe('salt_lake');
    expect(resolveCountyFromAddress('456 State St, Sandy, UT 84070')).toBe('salt_lake');
    expect(resolveCountyFromAddress('789 900 E, West Jordan, UT')).toBe('salt_lake');
  });

  it('resolves Utah County cities', () => {
    expect(resolveCountyFromAddress('100 E Center St, American Fork, UT 84003')).toBe('utah');
    expect(resolveCountyFromAddress('200 N University Ave, Provo, UT 84601')).toBe('utah');
    expect(resolveCountyFromAddress('300 State St, Orem, UT')).toBe('utah');
  });

  it('resolves Summit County cities', () => {
    expect(resolveCountyFromAddress('50 Main St, Park City, UT 84060')).toBe('summit');
    expect(resolveCountyFromAddress('10 Rasmussen Rd, Coalville, UT')).toBe('summit');
  });

  it('resolves Tooele County cities', () => {
    expect(resolveCountyFromAddress('47 S Main St, Tooele, UT 84074')).toBe('tooele');
    expect(resolveCountyFromAddress('1 Center St, Grantsville, UT')).toBe('tooele');
  });

  it('falls back to ZIP prefix when no known city token matches', () => {
    expect(resolveCountyFromAddress('123 Some Rd, 84101')).toBe('salt_lake');
    expect(resolveCountyFromAddress('123 Some Rd, 84003')).toBe('utah');
    expect(resolveCountyFromAddress('123 Some Rd, 84060')).toBe('summit');
    expect(resolveCountyFromAddress('123 Some Rd, 84074')).toBe('tooele');
  });

  it('returns unsupported for Davis County and out-of-area addresses', () => {
    expect(resolveCountyFromAddress('1 Main St, Layton, UT 84041')).toBe('unsupported');
    expect(resolveCountyFromAddress('1 Main St, Bountiful, UT')).toBe('unsupported');
    expect(resolveCountyFromAddress('1 Main St, Anywhere, TX 75001')).toBe('unsupported');
  });

  it('returns unsupported for empty or garbage input', () => {
    expect(resolveCountyFromAddress('')).toBe('unsupported');
    expect(resolveCountyFromAddress('   ')).toBe('unsupported');
  });

  it('is case-insensitive on city names', () => {
    expect(resolveCountyFromAddress('1 Main St, PROVO, ut')).toBe('utah');
    expect(resolveCountyFromAddress('1 Main St, provo, UT')).toBe('utah');
  });
});

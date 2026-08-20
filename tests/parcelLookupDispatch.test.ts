import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/utils/sl-assessor/client', () => ({
  searchByAddress: vi.fn(async () => [{ parcel_number: 'SL-1', owner_of_record: null, situs_address: null, land_sqft: null, total_market_value: null, detail_url: 'https://sl.example/1' }]),
  getParcel: vi.fn(),
}));
vi.mock('../src/utils/utah-assessor/client', () => ({
  searchByAddress: vi.fn(async () => [{ parcel_number: 'UT-1', owner_of_record: null, situs_address: null, land_sqft: null, total_market_value: null, detail_url: 'https://utah.example/1' }]),
  getParcel: vi.fn(),
}));
vi.mock('../src/utils/summit-assessor/client', () => ({
  searchByAddress: vi.fn(async () => []),
  getParcel: vi.fn(),
}));
vi.mock('../src/utils/tooele-assessor/client', () => ({
  searchByAddress: vi.fn(async () => []),
  getParcel: vi.fn(),
}));

import { dispatchSearchByAddress, dispatchGetParcel } from '../src/utils/parcel-lookup/lookup';
import * as slClient from '../src/utils/sl-assessor/client';
import * as utahClient from '../src/utils/utah-assessor/client';

describe('parcel-lookup dispatch', () => {
  beforeEach(() => vi.clearAllMocks());

  it('routes a Salt Lake City address to the sl-assessor client', async () => {
    const results = await dispatchSearchByAddress({} as any, '100 Main St, Salt Lake City, UT 84101');
    expect(slClient.searchByAddress).toHaveBeenCalled();
    expect(utahClient.searchByAddress).not.toHaveBeenCalled();
    expect(results[0].parcel_number).toBe('SL-1');
  });

  it('routes a Utah County address to the utah-assessor client', async () => {
    const results = await dispatchSearchByAddress({} as any, '100 E Center St, American Fork, UT 84003');
    expect(utahClient.searchByAddress).toHaveBeenCalled();
    expect(slClient.searchByAddress).not.toHaveBeenCalled();
    expect(results[0].parcel_number).toBe('UT-1');
  });

  it('returns empty array with no client calls for an unsupported county (Davis)', async () => {
    const results = await dispatchSearchByAddress({} as any, '1 Main St, Layton, UT 84041');
    expect(results).toEqual([]);
    expect(slClient.searchByAddress).not.toHaveBeenCalled();
    expect(utahClient.searchByAddress).not.toHaveBeenCalled();
  });

  it('dispatchGetParcel routes by explicit county rather than re-deriving from an address', async () => {
    await dispatchGetParcel({} as any, 'UT-1', 'utah');
    expect(utahClient.getParcel).toHaveBeenCalledWith({}, 'UT-1');
  });
});

import { describe, it, expect } from 'vitest';
import { buildFleetioRequest } from '../src/utils/fleetio/client';

describe('buildFleetioRequest', () => {
  const cfg = {
    apiKey: 'tok_test_abc',
    accountToken: 'acct_xyz',
    apiBase: 'https://secure.fleetio.com/api/v1',
  };

  it('GET — joins path, adds dual auth + accept headers, no body', () => {
    const req = buildFleetioRequest({ method: 'GET', path: '/vehicles', config: cfg });
    expect(req.url).toBe('https://secure.fleetio.com/api/v1/vehicles');
    const h = Object.fromEntries(req.headers);
    expect(h['authorization']).toBe('Token tok_test_abc');
    expect(h['account-token']).toBe('acct_xyz');
    expect(h['accept']).toBe('application/json');
    expect(req.body).toBeUndefined();
  });

  it('POST — adds content-type, serializes body to JSON', () => {
    const req = buildFleetioRequest({
      method: 'POST',
      path: '/vehicles',
      config: cfg,
      body: { name: 'Unit 12', vin: 'ABC' },
    });
    expect(req.url).toBe('https://secure.fleetio.com/api/v1/vehicles');
    const h = Object.fromEntries(req.headers);
    expect(h['content-type']).toBe('application/json');
    expect(req.body).toBe('{"name":"Unit 12","vin":"ABC"}');
  });

  it('GET with query — encodes params, supports arrays and numbers', () => {
    const req = buildFleetioRequest({
      method: 'GET',
      path: '/vehicles',
      config: cfg,
      query: { page: 2, per_page: 50, 'q[vin_eq]': '1HGBH41JXMN109186' },
    });
    expect(req.url).toBe(
      'https://secure.fleetio.com/api/v1/vehicles?page=2&per_page=50&q%5Bvin_eq%5D=1HGBH41JXMN109186'
    );
  });

  it('normalizes a path that already starts with / (does not double-slash)', () => {
    const req = buildFleetioRequest({ method: 'GET', path: 'vehicles', config: cfg });
    expect(req.url).toBe('https://secure.fleetio.com/api/v1/vehicles');
  });

  it('drops undefined/null query values (does not serialize them)', () => {
    const req = buildFleetioRequest({
      method: 'GET',
      path: '/vehicles',
      config: cfg,
      query: { page: 1, archived: undefined, foo: null as unknown as undefined },
    });
    expect(req.url).toBe('https://secure.fleetio.com/api/v1/vehicles?page=1');
  });
});

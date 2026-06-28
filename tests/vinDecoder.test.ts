import { describe, it, expect } from 'vitest';
import {
  normalizeVin,
  normalizeVpicPayload,
  decodeViaNhtsa,
  VinFormatError,
  VinDecoderTimeoutError,
  VinDecoderHttpError,
  VinDecoderError,
  type VpicPayload,
} from '../src/utils/vinDecoder';

const FIXED_NOW = '2026-06-21T00:00:00.000Z';

describe('normalizeVin', () => {
  it('uppercases + trims a valid VIN', () => {
    // Sample VIN — a real public NHTSA example (Honda Accord).
    expect(normalizeVin(' 1HGcM82633a004352 ')).toBe('1HGCM82633A004352');
  });

  it('rejects non-strings', () => {
    expect(() => normalizeVin(null as unknown as string)).toThrow(VinFormatError);
    expect(() => normalizeVin(123 as unknown as string)).toThrow(VinFormatError);
  });

  it('rejects wrong length', () => {
    expect(() => normalizeVin('1HGCM82633A00435')).toThrow(VinFormatError);   // 16 chars
    expect(() => normalizeVin('1HGCM82633A0043522')).toThrow(VinFormatError); // 18 chars
  });

  it('rejects forbidden characters I, O, Q', () => {
    expect(() => normalizeVin('IHGCM82633A004352')).toThrow(VinFormatError);
    expect(() => normalizeVin('OHGCM82633A004352')).toThrow(VinFormatError);
    expect(() => normalizeVin('QHGCM82633A004352')).toThrow(VinFormatError);
  });

  it('rejects symbols / whitespace inside', () => {
    expect(() => normalizeVin('1HGCM82633A 04352')).toThrow(VinFormatError);
    expect(() => normalizeVin('1HGCM82633A-04352')).toThrow(VinFormatError);
  });
});

describe('normalizeVpicPayload', () => {
  const sample: VpicPayload = {
    Results: [
      { Variable: 'Make',                                  Value: 'TOYOTA' },
      { Variable: 'Model',                                 Value: 'CAMRY' },
      { Variable: 'Model Year',                            Value: '2022' },
      { Variable: 'Body Class',                            Value: 'Sedan/Saloon' },
      { Variable: 'Drive Type',                            Value: 'FWD/Front-Wheel Drive' },
      { Variable: 'Transmission Style',                    Value: 'Automatic' },
      { Variable: 'Engine Number of Cylinders',            Value: '4' },
      { Variable: 'Displacement (L)',                      Value: '2.5' },
      { Variable: 'Fuel Type - Primary',                   Value: 'Gasoline' },
      { Variable: 'Gross Vehicle Weight Rating From',      Value: '4500' },
      { Variable: 'Manufacturer Name',                     Value: 'TOYOTA MOTOR MFG' },
      { Variable: 'Plant Country',                         Value: 'UNITED STATES (USA)' },
      { Variable: 'Other Variable',                        Value: 'IGNORED' },
      { Variable: 'Empty Variable',                        Value: '' },
      { Variable: 'Null Variable',                         Value: null },
    ],
  };

  it('extracts and types the documented fields', () => {
    const out = normalizeVpicPayload(sample, '4T1B11HK0NU000000', FIXED_NOW);
    expect(out).toEqual({
      vin: '4T1B11HK0NU000000',
      make: 'TOYOTA',
      model: 'CAMRY',
      year: 2022,
      body_type: 'Sedan/Saloon',
      drivetrain: 'FWD/Front-Wheel Drive',
      transmission: 'Automatic',
      engine_cylinders: 4,
      displacement_l: 2.5,
      fuel_type: 'Gasoline',
      gvwr_lbs: 4500,
      manufacturer: 'TOYOTA MOTOR MFG',
      plant_country: 'UNITED STATES (USA)',
      source: 'nhtsa_vpic',
      fetched_at: FIXED_NOW,
    });
  });

  it('returns nulls when Results is empty or missing', () => {
    const empty = normalizeVpicPayload({ Results: [] }, '1HGCM82633A004352', FIXED_NOW);
    expect(empty.make).toBeNull();
    expect(empty.year).toBeNull();
    expect(empty.displacement_l).toBeNull();
    expect(empty.source).toBe('nhtsa_vpic');

    const noResults = normalizeVpicPayload({}, '1HGCM82633A004352', FIXED_NOW);
    expect(noResults.make).toBeNull();
  });

  it('skips empty-string + null values without crashing', () => {
    const sparse: VpicPayload = {
      Results: [
        { Variable: 'Make',  Value: 'FORD' },
        { Variable: 'Model', Value: '' },
        { Variable: 'Model Year', Value: null },
      ],
    };
    const out = normalizeVpicPayload(sparse, '1FAFP404XYW000000', FIXED_NOW);
    expect(out.make).toBe('FORD');
    expect(out.model).toBeNull();
    expect(out.year).toBeNull();
  });

  it('treats non-numeric numeric fields as null instead of NaN', () => {
    const bad: VpicPayload = {
      Results: [
        { Variable: 'Model Year', Value: 'not a year' },
        { Variable: 'Displacement (L)', Value: 'bad' },
        { Variable: 'Gross Vehicle Weight Rating From', Value: '' },
      ],
    };
    const out = normalizeVpicPayload(bad, '1FAFP404XYW000000', FIXED_NOW);
    expect(out.year).toBeNull();
    expect(out.displacement_l).toBeNull();
    expect(out.gvwr_lbs).toBeNull();
  });
});

describe('decodeViaNhtsa — HTTP + error paths', () => {
  const okPayload: VpicPayload = {
    Results: [
      { Variable: 'Make',       Value: 'TOYOTA' },
      { Variable: 'Model',      Value: 'CAMRY' },
      { Variable: 'Model Year', Value: '2022' },
    ],
  };

  it('happy path — fetches, decodes, returns typed shape', async () => {
    let capturedUrl = '';
    const fakeFetch = (async (url: string | URL | Request) => {
      capturedUrl = String(url);
      return new Response(JSON.stringify(okPayload), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;

    const out = await decodeViaNhtsa('4T1B11HK0NU000000', {
      fetchImpl: fakeFetch,
      nowIso: FIXED_NOW,
    });
    expect(capturedUrl).toBe('https://vpic.nhtsa.dot.gov/api/vehicles/decodevin/4T1B11HK0NU000000?format=json');
    expect(out.make).toBe('TOYOTA');
    expect(out.year).toBe(2022);
    expect(out.fetched_at).toBe(FIXED_NOW);
  });

  it('throws VinFormatError BEFORE the fetch on bad VIN', async () => {
    let fetchCalled = false;
    const sentinel = (async () => { fetchCalled = true; return new Response('', { status: 200 }); }) as unknown as typeof fetch;
    await expect(decodeViaNhtsa('bad', { fetchImpl: sentinel })).rejects.toBeInstanceOf(VinFormatError);
    expect(fetchCalled).toBe(false);
  });

  it('throws VinDecoderHttpError on non-2xx', async () => {
    const fakeFetch = (async () => new Response('upstream error', { status: 503 })) as unknown as typeof fetch;
    await expect(decodeViaNhtsa('1HGCM82633A004352', { fetchImpl: fakeFetch })).rejects.toMatchObject({
      name: 'VinDecoderHttpError',
      status: 503,
    });
  });

  it('throws VinDecoderTimeoutError when the fetch is aborted', async () => {
    const abortFetch = ((_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      })) as unknown as typeof fetch;

    await expect(decodeViaNhtsa('1HGCM82633A004352', {
      fetchImpl: abortFetch,
      timeoutMs: 5, // fire quickly
    })).rejects.toBeInstanceOf(VinDecoderTimeoutError);
  });

  it('wraps non-JSON responses in VinDecoderError', async () => {
    const fakeFetch = (async () => new Response('not json{', { status: 200 })) as unknown as typeof fetch;
    await expect(decodeViaNhtsa('1HGCM82633A004352', { fetchImpl: fakeFetch })).rejects.toBeInstanceOf(VinDecoderError);
  });

  it('respects apiBase override (trailing slash tolerant)', async () => {
    let capturedUrl = '';
    const fakeFetch = (async (url: string | URL | Request) => {
      capturedUrl = String(url);
      return new Response(JSON.stringify(okPayload), { status: 200 });
    }) as unknown as typeof fetch;
    await decodeViaNhtsa('1HGCM82633A004352', {
      fetchImpl: fakeFetch,
      apiBase: 'https://example.test/api/vehicles///',
    });
    expect(capturedUrl).toBe('https://example.test/api/vehicles/decodevin/1HGCM82633A004352?format=json');
  });
});

import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { adaCountyAdapter } from '../../src/utils/warrantSources/adapters/adaCounty';
import { natronaAdapter } from '../../src/utils/warrantSources/adapters/natrona';

const adaHtml = readFileSync(new URL('./fixtures/ada-county.html', import.meta.url), 'utf8');
const natronaHtml = readFileSync(new URL('./fixtures/natrona.html', import.meta.url), 'utf8');

const env = { DB: {} as unknown as D1Database };
const person = { id: 1, first_name: '', middle_name: null, last_name: 'SMITH', dob: null };

// The GET response that mints viewstate tokens + a session cookie. Shared by
// both adapters — the hidden-input names are identical ASP.NET WebForms tokens.
function getResponse(): Response {
  return new Response(
    '<input name="__VIEWSTATE" value="vs"><input name="__VIEWSTATEGENERATOR" value="g"><input name="__EVENTVALIDATION" value="ev">',
    { status: 200, headers: { 'set-cookie': 'ASP.NET_SessionId=abc; path=/' } },
  );
}

/** Build a 2-call stub: 1st (GET) → tokens; 2nd (POST) → the given body/status. */
function buildStub(postBody: string, postStatus = 200) {
  let call = 0;
  return vi.fn(async (_url: string, _init?: RequestInit) => {
    call++;
    if (call === 1) return getResponse();
    return new Response(postBody, { status: postStatus });
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('adaCountyAdapter', () => {
  it('exposes html-kind metadata', () => {
    expect(adaCountyAdapter.meta.kind).toBe('html');
    expect(adaCountyAdapter.meta.key).toBe('ada-county-id');
    expect(adaCountyAdapter.meta.state).toBe('ID');
    expect(adaCountyAdapter.meta.county).toBe('Ada');
  });

  it('does a 2-step GET→POST fetch and returns parsed hits', async () => {
    const stub = buildStub(adaHtml);
    vi.stubGlobal('fetch', stub);

    const hits = await adaCountyAdapter.fetchForPerson(person, env);

    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.source_key === 'ada-county-id')).toBe(true);
    expect(stub).toHaveBeenCalledTimes(2);

    // The 2nd (POST) call must carry the last name in its form body.
    const postInit = stub.mock.calls[1][1] as RequestInit;
    const body = String(postInit.body);
    expect(body).toContain('txtLastName');
    expect(body).toContain('SMITH');
  });

  it('threads the GET Set-Cookie into the POST Cookie header', async () => {
    const stub = buildStub(adaHtml);
    vi.stubGlobal('fetch', stub);
    await adaCountyAdapter.fetchForPerson(person, env);
    const postInit = stub.mock.calls[1][1] as RequestInit;
    const cookie = new Headers(postInit.headers).get('cookie');
    expect(cookie).toContain('ASP.NET_SessionId=abc');
  });

  it('throws on a non-OK POST status (circuit breaker engages)', async () => {
    vi.stubGlobal('fetch', buildStub('forbidden', 403));
    await expect(adaCountyAdapter.fetchForPerson(person, env)).rejects.toThrow();
  });

  it('returns [] on an empty / no-results POST body', async () => {
    vi.stubGlobal('fetch', buildStub('<html><body>No results</body></html>'));
    const hits = await adaCountyAdapter.fetchForPerson(person, env);
    expect(hits).toEqual([]);
  });
});

describe('natronaAdapter', () => {
  it('exposes html-kind metadata', () => {
    expect(natronaAdapter.meta.kind).toBe('html');
    expect(natronaAdapter.meta.key).toBe('natrona-county-wy');
    expect(natronaAdapter.meta.state).toBe('WY');
    expect(natronaAdapter.meta.county).toBe('Natrona');
  });

  it('does a 2-step GET→POST fetch and returns parsed hits', async () => {
    const stub = buildStub(natronaHtml);
    vi.stubGlobal('fetch', stub);

    const hits = await natronaAdapter.fetchForPerson(person, env);

    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.source_key === 'natrona-county-wy')).toBe(true);
    expect(stub).toHaveBeenCalledTimes(2);

    const postInit = stub.mock.calls[1][1] as RequestInit;
    const body = String(postInit.body);
    expect(body).toContain('txtNameSearch');
    expect(body).toContain('SMITH');
  });

  it('threads the GET Set-Cookie into the POST Cookie header', async () => {
    const stub = buildStub(natronaHtml);
    vi.stubGlobal('fetch', stub);
    await natronaAdapter.fetchForPerson(person, env);
    const postInit = stub.mock.calls[1][1] as RequestInit;
    const cookie = new Headers(postInit.headers).get('cookie');
    expect(cookie).toContain('ASP.NET_SessionId=abc');
  });

  it('throws on a non-OK POST status (circuit breaker engages)', async () => {
    vi.stubGlobal('fetch', buildStub('server error', 500));
    await expect(natronaAdapter.fetchForPerson(person, env)).rejects.toThrow();
  });

  it('returns [] on an empty / no-results POST body', async () => {
    vi.stubGlobal('fetch', buildStub('<html><body>Found 0 Warrants</body></html>'));
    const hits = await natronaAdapter.fetchForPerson(person, env);
    expect(hits).toEqual([]);
  });
});

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

    const hits = await adaCountyAdapter.fetchForPerson!(person, env);

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
    await adaCountyAdapter.fetchForPerson!(person, env);
    const postInit = stub.mock.calls[1][1] as RequestInit;
    const cookie = new Headers(postInit.headers).get('cookie');
    expect(cookie).toContain('ASP.NET_SessionId=abc');
  });

  it('throws on a non-OK POST status (circuit breaker engages)', async () => {
    vi.stubGlobal('fetch', buildStub('forbidden', 403));
    await expect(adaCountyAdapter.fetchForPerson!(person, env)).rejects.toThrow();
  });

  it('returns [] on an empty / no-results POST body', async () => {
    vi.stubGlobal('fetch', buildStub('<html><body>No results</body></html>'));
    const hits = await adaCountyAdapter.fetchForPerson!(person, env);
    expect(hits).toEqual([]);
  });
});

/**
 * Minimal first-page HTML with a DataPager "Next" link that parseNatronaPager
 * will detect, plus one valid result row.  Used by the pagination test so it
 * doesn't depend on the fixture file's pager markup.
 */
const NATRONA_PAGE1_WITH_NEXT = `
<span id="lblSearch">Found 10 Warrants containing the name 'SMITH'</span>
<div class="row myrow listview_backcolor1">
  <span id="Label4">John Smith</span>
  <span id="Label2">White</span>
  <span id="Label9">Male</span>
  <span id="Label14">42</span>
</div>
<div class="pager">
  <a class="PageNumber" href="javascript:__doPostBack(&#39;ctl00$MainContent$DataPager1$ctl02$ctl00&#39;,&#39;&#39;)">Next</a>
</div>`;

describe('natronaAdapter', () => {
  it('exposes html-kind metadata', () => {
    expect(natronaAdapter.meta.kind).toBe('html');
    expect(natronaAdapter.meta.key).toBe('natrona-county-wy');
    expect(natronaAdapter.meta.state).toBe('WY');
    expect(natronaAdapter.meta.county).toBe('Natrona');
  });

  it('does a GET→POST fetch and returns parsed hits', async () => {
    const stub = buildStub(natronaHtml);
    vi.stubGlobal('fetch', stub);

    const hits = await natronaAdapter.fetchForPerson!(person, env);

    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.source_key === 'natrona-county-wy')).toBe(true);
    // At minimum: GET + initial POST. May be more if fixture has a Next pager link.
    expect(stub.mock.calls.length).toBeGreaterThanOrEqual(2);

    const postInit = stub.mock.calls[1][1] as RequestInit;
    const body = String(postInit.body);
    expect(body).toContain('txtNameSearch');
    expect(body).toContain('SMITH');
  });

  it('follows DataPager Next link to a second page and deduplicates', async () => {
    const terminator = '<html><body>Found 0 Warrants</body></html>';
    let call = 0;
    const stub = vi.fn(async () => {
      call++;
      if (call === 1) return getResponse();
      if (call === 2) return new Response(NATRONA_PAGE1_WITH_NEXT, { status: 200 });
      return new Response(terminator, { status: 200 });
    });
    vi.stubGlobal('fetch', stub);

    const hits = await natronaAdapter.fetchForPerson!(person, env);

    // GET + page-1 POST (has Next) + page-2 POST (terminator, no Next)
    expect(stub).toHaveBeenCalledTimes(3);
    expect(hits.length).toBeGreaterThan(0);
    // The page-2 POST must carry __EVENTTARGET with the DataPager target
    const page2Init = stub.mock.calls[2][1] as RequestInit;
    const page2Body = String(page2Init.body);
    expect(page2Body).toContain('__EVENTTARGET');
    expect(page2Body).toContain('DataPager1');
  });

  it('threads the GET Set-Cookie into the POST Cookie header', async () => {
    const stub = buildStub(natronaHtml);
    vi.stubGlobal('fetch', stub);
    await natronaAdapter.fetchForPerson!(person, env);
    const postInit = stub.mock.calls[1][1] as RequestInit;
    const cookie = new Headers(postInit.headers).get('cookie');
    expect(cookie).toContain('ASP.NET_SessionId=abc');
  });

  it('throws on a non-OK POST status (circuit breaker engages)', async () => {
    vi.stubGlobal('fetch', buildStub('server error', 500));
    await expect(natronaAdapter.fetchForPerson!(person, env)).rejects.toThrow();
  });

  it('returns [] on an empty / no-results POST body', async () => {
    vi.stubGlobal('fetch', buildStub('<html><body>Found 0 Warrants</body></html>'));
    const hits = await natronaAdapter.fetchForPerson!(person, env);
    expect(hits).toEqual([]);
  });
});

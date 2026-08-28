import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  emailConnectRedirectUri,
  emailOauthRedirectUri,
  workerAppOrigin,
  oauthRedirectCandidates,
  exchangeAuthorizationCode,
  LEGACY_API_ORIGIN,
} from '../src/utils/appOrigin';

describe('OAuth redirect URIs', () => {
  it('defaults mailbox connect to the SPA host so the callback rides the zone proxy', () => {
    expect(emailConnectRedirectUri({})).toBe('https://rmpgutah.us/api/email/connect/callback');
    expect(emailConnectRedirectUri({})).not.toContain('api.rmpgutah.us');
  });

  it('honors APP_ORIGIN', () => {
    expect(workerAppOrigin({ APP_ORIGIN: 'https://www.rmpgutah.us/' })).toBe('https://www.rmpgutah.us');
    expect(emailOauthRedirectUri({ APP_ORIGIN: 'https://rmpgutah.us' }))
      .toBe('https://rmpgutah.us/api/email-oauth/callback');
  });

  it('uses the request host when it is a trusted production hostname', () => {
    expect(emailConnectRedirectUri({}, 'https://rmpgutah.us/api/email/connect/authorize'))
      .toBe('https://rmpgutah.us/api/email/connect/callback');
  });

  it('includes the legacy API hostname as a token-exchange fallback', () => {
    const uris = oauthRedirectCandidates({}, '/api/email/connect/callback', 'https://rmpgutah.us/api/email/connect/callback');
    expect(uris[0]).toBe('https://rmpgutah.us/api/email/connect/callback');
    expect(uris).toContain(`${LEGACY_API_ORIGIN}/api/email/connect/callback`);
  });
});

describe('exchangeAuthorizationCode', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('retries the next redirect_uri after invalid_grant', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{"error":"invalid_grant"}', { status: 400 }))
      .mockResolvedValueOnce(new Response('{"access_token":"ok"}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const out = await exchangeAuthorizationCode({
      tokenUrl: 'https://example.test/token',
      params: { code: 'abc', client_id: 'id', grant_type: 'authorization_code' },
      redirectUris: [
        'https://rmpgutah.us/api/email/connect/callback',
        'https://api.rmpgutah.us/api/email/connect/callback',
      ],
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.redirectUri).toBe('https://api.rmpgutah.us/api/email/connect/callback');
      expect(JSON.parse(out.body).access_token).toBe('ok');
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

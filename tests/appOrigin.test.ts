import { describe, it, expect, vi } from 'vitest';
import {
  emailConnectRedirectUri,
  emailOauthRedirectUri,
  exchangeAuthorizationCode,
  oauthRedirectCandidates,
  workerAppOrigin,
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

  it('includes legacy api host as a token-exchange fallback', () => {
    const uris = oauthRedirectCandidates({}, '/api/email/connect/callback');
    expect(uris).toContain('https://rmpgutah.us/api/email/connect/callback');
    expect(uris).toContain('https://api.rmpgutah.us/api/email/connect/callback');
  });

  it('prefers the stored redirect from authorize when provided', () => {
    const uris = oauthRedirectCandidates(
      {},
      '/api/email/connect/callback',
      'https://rmpgutah.us/api/email/connect/authorize',
      'https://api.rmpgutah.us/api/email/connect/callback',
    );
    expect(uris[0]).toBe('https://api.rmpgutah.us/api/email/connect/callback');
  });
});

describe('exchangeAuthorizationCode', () => {
  it('retries alternate redirect URIs until one succeeds', async () => {
    const seen: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (_url, init) => {
      const body = new URLSearchParams(String(init?.body));
      seen.push(body.get('redirect_uri') || '');
      if (body.get('redirect_uri') === 'https://api.rmpgutah.us/cb') {
        return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
    }) as typeof fetch;

    const result = await exchangeAuthorizationCode({
      tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      params: { client_id: 'x', client_secret: 'y', code: 'z', grant_type: 'authorization_code' },
      redirectUris: ['https://rmpgutah.us/cb', 'https://api.rmpgutah.us/cb'],
    });

    globalThis.fetch = originalFetch;
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.redirectUri).toBe('https://api.rmpgutah.us/cb');
    expect(seen).toEqual(['https://rmpgutah.us/cb', 'https://api.rmpgutah.us/cb']);
  });
});

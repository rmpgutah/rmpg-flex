import { describe, it, expect } from 'vitest';
import { emailConnectRedirectUri, emailOauthRedirectUri, workerAppOrigin } from '../src/utils/appOrigin';

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
});

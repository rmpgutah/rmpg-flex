/** SPA origin used for OAuth redirects that must ride rmpg-api-proxy. */
export const LEGACY_API_ORIGIN = 'https://api.rmpgutah.us';

export function workerAppOrigin(env: { APP_ORIGIN?: string }): string {
  return (env.APP_ORIGIN || 'https://rmpgutah.us').replace(/\/$/, '');
}

function originFromRequestUrl(requestUrl: string): string | null {
  try {
    const u = new URL(requestUrl);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.origin;
  } catch {
    return null;
  }
}

function isTrustedOauthHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === 'rmpgutah.us'
    || host === 'www.rmpgutah.us'
    || host === 'api.rmpgutah.us'
    || host.endsWith('.pages.dev')
  );
}

/** Distinct redirect_uri values to try on token exchange (authorize used one of these). */
export function oauthRedirectCandidates(
  env: { APP_ORIGIN?: string },
  path: string,
  requestUrl?: string,
  preferred?: string | null,
): string[] {
  const pathNorm = path.startsWith('/') ? path : `/${path}`;
  const out: string[] = [];
  const addUri = (uri: string | null | undefined) => {
    if (uri && !out.includes(uri)) out.push(uri);
  };
  const addOrigin = (origin: string | null | undefined) => {
    if (!origin) return;
    addUri(`${origin.replace(/\/$/, '')}${pathNorm}`);
  };
  addUri(preferred || null);
  const reqOrigin = requestUrl ? originFromRequestUrl(requestUrl) : null;
  if (reqOrigin) {
    try {
      if (isTrustedOauthHost(new URL(reqOrigin).hostname)) addOrigin(reqOrigin);
    } catch { /* ignore */ }
  }
  addOrigin(workerAppOrigin(env));
  addOrigin('https://www.rmpgutah.us');
  addOrigin(LEGACY_API_ORIGIN);
  return out;
}

export function emailConnectRedirectUri(env: { APP_ORIGIN?: string }, requestUrl?: string): string {
  return oauthRedirectCandidates(env, '/api/email/connect/callback', requestUrl)[0];
}

export function emailOauthRedirectUri(env: { APP_ORIGIN?: string }, requestUrl?: string): string {
  return oauthRedirectCandidates(env, '/api/email-oauth/callback', requestUrl)[0];
}

export function dialerOidcRedirectUri(
  env: { APP_ORIGIN?: string; DIALER_OIDC_REDIRECT_URI?: string },
  requestUrl?: string,
): string {
  const preferred = env.DIALER_OIDC_REDIRECT_URI || `${workerAppOrigin(env)}/api/oidc/dialer/callback`;
  return oauthRedirectCandidates(env, '/api/oidc/dialer/callback', requestUrl, preferred)[0];
}

export async function exchangeAuthorizationCode(opts: {
  tokenUrl: string;
  params: Record<string, string>;
  redirectUris: string[];
  timeoutMs?: number;
}): Promise<{ ok: true; body: string; redirectUri: string } | { ok: false; status: number; body: string }> {
  const uris = opts.redirectUris.filter(Boolean);
  let last = { status: 0, body: '' };
  for (const redirectUri of uris) {
    const res = await fetch(opts.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...opts.params, redirect_uri: redirectUri }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
    });
    const body = await res.text();
    if (res.ok) return { ok: true, body, redirectUri };
    last = { status: res.status, body };
  }
  return { ok: false, status: last.status || 400, body: last.body };
}

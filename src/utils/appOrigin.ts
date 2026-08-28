/** SPA origin used for OAuth redirects that must ride rmpg-api-proxy. */
export function workerAppOrigin(env: { APP_ORIGIN?: string }): string {
  return (env.APP_ORIGIN || 'https://rmpgutah.us').replace(/\/$/, '');
}

export function emailConnectRedirectUri(env: { APP_ORIGIN?: string }): string {
  return `${workerAppOrigin(env)}/api/email/connect/callback`;
}

export function emailOauthRedirectUri(env: { APP_ORIGIN?: string }): string {
  return `${workerAppOrigin(env)}/api/email-oauth/callback`;
}

// SSO config storage: reuses the SAME generic system_config key-value
// store the Email OAuth integration already uses (see readCfg/writeCfg
// in emailOauthCallback.ts and the generic PUT /api/admin/third-party-keys
// handler in admin.ts) -- no new config storage mechanism.
import type { D1Database } from '@cloudflare/workers-types';
import { query } from './db';

export const SSO_CONFIG_KEYS = {
  clientId: 'dial_connect_client_id',
  clientSecret: 'dial_connect_client_secret',
  issuer: 'dial_connect_issuer',
} as const;

export async function readSsoConfig(
  env: { DB: D1Database },
  keys: string[] = Object.values(SSO_CONFIG_KEYS),
): Promise<Record<string, string>> {
  const db = env.DB;
  const rows = await query<{ config_key: string; config_value: string }>(
    db,
    `SELECT config_key, config_value FROM system_config WHERE is_active = 1 AND config_key IN (${keys.map(() => '?').join(',')})`,
    ...keys,
  );
  const out: Record<string, string> = {};
  for (const r of rows) out[r.config_key] = r.config_value;
  return out;
}

// PKCE code_verifier per RFC 7636: 43-128 char unreserved-charset string.
export function generateCodeVerifier(): string {
  return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '');
}

export async function codeChallengeS256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

function base64UrlEncode(bytes: Uint8Array): string {
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

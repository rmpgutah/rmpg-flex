// Resolve Microsoft 365 / Azure AD app-registration credentials.
//
// Priority:
//   1. Worker env bindings (MS_EMAIL_CLIENT_ID / MS_EMAIL_CLIENT_SECRET /
//      MS_EMAIL_TENANT_ID) — set via wrangler.toml vars + wrangler secret put.
//   2. Encrypted rows in system_config (Admin → Email tab).
//
// Env bindings win so ops can provision credentials without a D1 round-trip
// and so a JWT_SECRET / EMAIL_CRED_KEY rotation cannot brick OAuth when the
// three values are still valid in Cloudflare secrets.

import type { Bindings } from '../types';
import { decryptSecret } from './emailCrypto';
import { queryFirst } from './db';

export type AzureEmailCredentials = {
  clientId: string;
  clientSecret: string;
  tenantId: string;
};

export type AzureEmailCredentialSource = 'env' | 'db';

const K = {
  clientId: 'ms_email_client_id',
  clientSecret: 'ms_email_client_secret',
  tenantId: 'ms_email_tenant_id',
} as const;

async function getCfg(db: D1Database, key: string): Promise<string | null> {
  const row = await queryFirst<{ config_value: string }>(
    db,
    "SELECT config_value FROM system_config WHERE config_key = ? AND category = 'integrations' AND is_active = 1 LIMIT 1",
    key,
  );
  return row?.config_value ?? null;
}

async function getCfgDecrypted(env: Bindings, key: string): Promise<string | null> {
  const v = await getCfg(env.DB, key);
  if (!v) return null;
  try {
    return await decryptSecret(env, v);
  } catch {
    return null;
  }
}

function trimEnv(v: string | undefined): string | null {
  const t = v?.trim();
  return t || null;
}

/** True when env bindings or DB rows supply a usable Azure AD registration. */
export async function isAzureEmailConfigured(env: Bindings): Promise<boolean> {
  const creds = await getAzureEmailCredentials(env);
  return creds !== null;
}

/** Partial credentials for authorize (client secret not required). */
export async function getAzureEmailIdentity(env: Bindings): Promise<Pick<AzureEmailCredentials, 'clientId' | 'tenantId'> | null> {
  const envClientId = trimEnv(env.MS_EMAIL_CLIENT_ID);
  const envTenantId = trimEnv(env.MS_EMAIL_TENANT_ID);
  if (envClientId && envTenantId) {
    return { clientId: envClientId, tenantId: envTenantId };
  }
  const clientId = await getCfgDecrypted(env, K.clientId);
  const tenantId = await getCfgDecrypted(env, K.tenantId);
  if (!clientId || !tenantId) return null;
  return { clientId, tenantId };
}

export async function getAzureEmailCredentials(
  env: Bindings,
): Promise<(AzureEmailCredentials & { source: AzureEmailCredentialSource }) | null> {
  const envClientId = trimEnv(env.MS_EMAIL_CLIENT_ID);
  const envClientSecret = trimEnv(env.MS_EMAIL_CLIENT_SECRET);
  const envTenantId = trimEnv(env.MS_EMAIL_TENANT_ID);
  if (envClientId && envClientSecret && envTenantId) {
    return {
      clientId: envClientId,
      clientSecret: envClientSecret,
      tenantId: envTenantId,
      source: 'env',
    };
  }

  const [clientId, clientSecret, tenantId] = await Promise.all([
    getCfgDecrypted(env, K.clientId),
    getCfgDecrypted(env, K.clientSecret),
    getCfgDecrypted(env, K.tenantId),
  ]);
  if (!clientId || !clientSecret || !tenantId) return null;
  return { clientId, clientSecret, tenantId, source: 'db' };
}

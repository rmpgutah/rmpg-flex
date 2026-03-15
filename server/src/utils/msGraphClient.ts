// ============================================================
// Microsoft Graph API Client
// ============================================================
// Handles OAuth2 authentication, token management, and API requests
// to Microsoft Graph (graph.microsoft.com) for email operations.
// Credentials are AES-256-GCM encrypted using JWT_SECRET.
// Follows the same pattern as clearPathGpsClient.ts.

import crypto from 'crypto';
import { getDb } from '../models/database';
import { localNow } from './timeUtils';
import config from '../config';
import { Client } from '@microsoft/microsoft-graph-client';

// ============================================================
// Encryption helpers (same pattern as clearPathGpsClient.ts)
// ============================================================

function deriveKey(): Buffer {
  return crypto.createHash('sha256').update(config.jwt.secret).digest();
}

function encrypt(plaintext: string): string {
  const key = deriveKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decrypt(stored: string): string {
  const key = deriveKey();
  const [ivHex, authTagHex, ciphertext] = stored.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// ============================================================
// Config helpers
// ============================================================

export const CONFIG_KEYS = {
  clientId: 'ms_email_client_id',
  clientSecret: 'ms_email_client_secret',
  tenantId: 'ms_email_tenant_id',
  accessToken: 'ms_email_access_token',
  refreshToken: 'ms_email_refresh_token',
  tokenExpiresAt: 'ms_email_token_expires_at',
  enabled: 'ms_email_enabled',
  pollInterval: 'ms_email_poll_interval',
  mailbox: 'ms_email_mailbox',
  smtpFallback: 'ms_email_smtp_fallback',
  smtpPassword: 'ms_email_smtp_password',
  lastSync: 'ms_email_last_sync',
  oauthState: 'ms_email_oauth_state',
  oauthInitiator: 'ms_email_oauth_initiator',
} as const;

export const GRAPH_SCOPES = [
  'https://graph.microsoft.com/Mail.ReadWrite',
  'https://graph.microsoft.com/Mail.Send',
  'https://graph.microsoft.com/MailboxSettings.ReadWrite',
  'offline_access',
];

export function getConfigValue(key: string): string | null {
  try {
    const db = getDb();
    const row = db.prepare(
      "SELECT config_value FROM system_config WHERE config_key = ? AND category = 'integrations' AND is_active = 1 LIMIT 1"
    ).get(key) as { config_value: string } | undefined;
    return row?.config_value || null;
  } catch { return null; }
}

export function getDecryptedValue(key: string): string | null {
  const val = getConfigValue(key);
  if (!val) return null;
  try { return decrypt(val); } catch { return null; }
}

export function setConfigValue(key: string, value: string, shouldEncrypt = false): void {
  const db = getDb();
  const now = localNow();
  const stored = shouldEncrypt ? encrypt(value) : value;

  db.prepare(
    "DELETE FROM system_config WHERE config_key = ? AND category = 'integrations'"
  ).run(key);

  db.prepare(
    "INSERT INTO system_config (config_key, config_value, category, sort_order, is_active, created_at, updated_at) VALUES (?, ?, 'integrations', 0, 1, ?, ?)"
  ).run(key, stored, now, now);
}

export function deleteConfigValue(key: string): void {
  const db = getDb();
  db.prepare(
    "DELETE FROM system_config WHERE config_key = ? AND category = 'integrations'"
  ).run(key);
}

// ============================================================
// OAuth2 Token Management (direct HTTP — no MSAL dependency)
// ============================================================
// We POST directly to Microsoft's token endpoint instead of using
// MSAL, because MSAL stores refresh tokens in its in-memory cache
// and doesn't return them in the response. On server restart the
// cache is lost and the refresh token is gone. Direct HTTP gives
// us the raw refresh_token so we can encrypt and persist it.

function getCredentials() {
  const clientId = getDecryptedValue(CONFIG_KEYS.clientId);
  const clientSecret = getDecryptedValue(CONFIG_KEYS.clientSecret);
  const tenantId = getDecryptedValue(CONFIG_KEYS.tenantId);

  if (!clientId || !clientSecret || !tenantId) {
    throw new Error('Microsoft email not configured — missing Azure AD credentials');
  }

  return { clientId, clientSecret, tenantId };
}

function tokenUrl(tenantId: string): string {
  return `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
}

/** Build the OAuth2 authorization URL for admin consent flow. */
export function getAuthorizationUrl(redirectUri: string): string {
  const clientId = getDecryptedValue(CONFIG_KEYS.clientId);
  const tenantId = getDecryptedValue(CONFIG_KEYS.tenantId);
  if (!clientId || !tenantId) throw new Error('Azure AD credentials not configured');

  // Generate CSRF state token
  const state = crypto.randomBytes(32).toString('hex');
  setConfigValue(CONFIG_KEYS.oauthState, state);

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: GRAPH_SCOPES.join(' '),
    state,
    prompt: 'consent',
  });

  return `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?${params.toString()}`;
}

/** Exchange authorization code for access + refresh tokens via direct HTTP POST. */
export async function exchangeCodeForTokens(code: string, redirectUri: string): Promise<void> {
  const { clientId, clientSecret, tenantId } = getCredentials();

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    scope: GRAPH_SCOPES.join(' '),
  });

  const res = await fetch(tokenUrl(tenantId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const data = await res.json();

  if (!res.ok) {
    const errMsg = data.error_description || data.error || 'Token exchange failed';
    throw new Error(`OAuth token exchange failed: ${errMsg}`);
  }

  // Store access token encrypted
  setConfigValue(CONFIG_KEYS.accessToken, data.access_token, true);

  // Store refresh token encrypted — this is the critical fix
  if (data.refresh_token) {
    setConfigValue(CONFIG_KEYS.refreshToken, data.refresh_token, true);
  }

  // Calculate expiry timestamp
  const expiresIn = data.expires_in || 3600;
  setConfigValue(CONFIG_KEYS.tokenExpiresAt, String(Date.now() + expiresIn * 1000));

  // Decode the JWT to extract the mailbox (UPN is in the token payload)
  let mailbox = '';
  try {
    const payload = JSON.parse(Buffer.from(data.access_token.split('.')[1], 'base64').toString());
    mailbox = payload.upn || payload.preferred_username || payload.unique_name || '';
  } catch { /* token decode is best-effort */ }

  if (mailbox) {
    setConfigValue(CONFIG_KEYS.mailbox, mailbox);
  }

  console.log(`[MSGraph] OAuth tokens acquired for ${mailbox || '(unknown mailbox)'}`);
}

/** Ensure we have a valid access token — refresh via direct HTTP POST if expired. */
export async function ensureValidToken(): Promise<string> {
  const expiresAt = getConfigValue(CONFIG_KEYS.tokenExpiresAt);
  const accessToken = getDecryptedValue(CONFIG_KEYS.accessToken);

  // Token still valid (5-min buffer)
  if (accessToken && expiresAt && Date.now() < parseInt(expiresAt, 10) - 300_000) {
    return accessToken;
  }

  // Need to refresh
  const refreshToken = getDecryptedValue(CONFIG_KEYS.refreshToken);
  if (!refreshToken) {
    throw new Error('Microsoft re-authorization required — no refresh token');
  }

  try {
    const { clientId, clientSecret, tenantId } = getCredentials();

    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      scope: GRAPH_SCOPES.join(' '),
    });

    const res = await fetch(tokenUrl(tenantId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    const data = await res.json();

    if (!res.ok) {
      const errMsg = data.error_description || data.error || 'Token refresh failed';
      throw new Error(errMsg);
    }

    // Store new access token
    setConfigValue(CONFIG_KEYS.accessToken, data.access_token, true);

    // Microsoft may rotate the refresh token — always store the latest
    if (data.refresh_token) {
      setConfigValue(CONFIG_KEYS.refreshToken, data.refresh_token, true);
    }

    const expiresIn = data.expires_in || 3600;
    setConfigValue(CONFIG_KEYS.tokenExpiresAt, String(Date.now() + expiresIn * 1000));

    return data.access_token;
  } catch (err: any) {
    console.error('[MSGraph] Token refresh failed:', err.message);
    throw new Error('Microsoft re-authorization required — token refresh failed');
  }
}

// ============================================================
// Graph API client
// ============================================================

/** Get an authenticated Microsoft Graph client. */
export async function getGraphClient(): Promise<Client> {
  const token = await ensureValidToken();

  return Client.init({
    authProvider: (done) => {
      done(null, token);
    },
  });
}

/** Test the Graph API connection by fetching the user profile. */
export async function testConnection(): Promise<{ success: boolean; mailbox?: string; error?: string }> {
  try {
    const client = await getGraphClient();
    const me = await client.api('/me').select('mail,displayName,userPrincipalName').get();
    const mailbox = me.mail || me.userPrincipalName || 'unknown';

    // Store the discovered mailbox
    setConfigValue(CONFIG_KEYS.mailbox, mailbox);

    return { success: true, mailbox };
  } catch (err: any) {
    return { success: false, error: err.message || 'Connection failed' };
  }
}

// ============================================================
// Status checks
// ============================================================

/** Check if Azure AD credentials are configured. */
export function isConfigured(): boolean {
  return !!(
    getConfigValue(CONFIG_KEYS.clientId) &&
    getConfigValue(CONFIG_KEYS.clientSecret) &&
    getConfigValue(CONFIG_KEYS.tenantId)
  );
}

/** Check if the integration is enabled. */
export function isEnabled(): boolean {
  return getConfigValue(CONFIG_KEYS.enabled) === 'true';
}

/** Check if OAuth2 authorization has been completed. */
export function isAuthorized(): boolean {
  return !!(
    getConfigValue(CONFIG_KEYS.accessToken) &&
    getConfigValue(CONFIG_KEYS.tokenExpiresAt)
  );
}

/** Get integration status summary. */
export function getStatus(): {
  configured: boolean;
  enabled: boolean;
  authorized: boolean;
  mailbox: string | null;
  lastSync: string | null;
  pollInterval: number;
  smtpFallback: boolean;
} {
  return {
    configured: isConfigured(),
    enabled: isEnabled(),
    authorized: isAuthorized(),
    mailbox: getConfigValue(CONFIG_KEYS.mailbox),
    lastSync: getConfigValue(CONFIG_KEYS.lastSync),
    pollInterval: parseInt(getConfigValue(CONFIG_KEYS.pollInterval) || '300', 10),
    smtpFallback: getConfigValue(CONFIG_KEYS.smtpFallback) === 'true',
  };
}

/** Clear cached auth state (called when credentials change). */
export function clearCachedAuth(): void {
  // No in-memory cache to clear with direct HTTP approach.
  // Kept for API compatibility — callers still invoke this after credential changes.
}

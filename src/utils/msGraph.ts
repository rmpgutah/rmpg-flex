// Microsoft Graph helper — refresh-token → access-token with KV caching.
// All /api/email read+write handlers go through getAccessToken().
//
// Caching: access tokens last ~1h. We cache for `expires_in - 60s` in KV
// under `email:access_token`. A single Worker isolate handles many
// requests per access-token lifetime, so this saves a network round-trip
// per request after the first.
//
// Failure model: if the refresh token is rejected (revoked in Azure,
// scope changed, etc.) we surface a typed error so the caller can
// return a clean 401 to the client instead of a 500.

import type { Env } from '../types';
import { getDb, query, execute } from './db';

const KEYS = {
  clientId: 'email_ms_client_id',
  clientSecret: 'email_ms_client_secret',
  tenantId: 'email_ms_tenant_id',
  refreshToken: 'email_ms_refresh_token',
} as const;

const KV_KEY = 'email:access_token';
const KV_REFRESH_KEY = 'email:refresh_token_cache';

export class GraphAuthError extends Error {
  constructor(message: string, public readonly status: number = 401) {
    super(message);
    this.name = 'GraphAuthError';
  }
}

export class GraphNotConfiguredError extends Error {
  constructor() {
    super('Email integration is not configured. Save credentials and authorize first.');
    this.name = 'GraphNotConfiguredError';
  }
}

async function readCreds(env: Env['Bindings']): Promise<{
  clientId: string; clientSecret: string; tenantId: string; refreshToken: string;
}> {
  const db = getDb(env);
  const keys = Object.values(KEYS);
  const rows = await query<{ config_key: string; config_value: string }>(
    db,
    `SELECT config_key, config_value FROM system_config WHERE is_active = 1 AND config_key IN (${keys.map(() => '?').join(',')})`,
    ...keys,
  );
  const m: Record<string, string> = {};
  for (const r of rows) m[r.config_key] = r.config_value;
  if (!m[KEYS.clientId] || !m[KEYS.clientSecret] || !m[KEYS.tenantId] || !m[KEYS.refreshToken]) {
    throw new GraphNotConfiguredError();
  }
  return {
    clientId: m[KEYS.clientId],
    clientSecret: m[KEYS.clientSecret],
    tenantId: m[KEYS.tenantId],
    refreshToken: m[KEYS.refreshToken],
  };
}

async function writeRefreshToken(env: Env['Bindings'], token: string): Promise<void> {
  const db = getDb(env);
  await execute(
    db,
    `UPDATE system_config SET config_value = ?, is_active = 1, updated_at = datetime('now','localtime') WHERE config_key = ?`,
    token, KEYS.refreshToken,
  );
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
}

async function exchangeRefreshToken(creds: {
  clientId: string; clientSecret: string; tenantId: string; refreshToken: string;
}): Promise<TokenResponse> {
  const res = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(creds.tenantId)}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: creds.refreshToken,
        // Empty scope = inherit whatever the refresh token already has,
        // which is what we want — Microsoft re-issues the same scope set.
      }),
    },
  );
  if (!res.ok) {
    const detail = await res.text();
    throw new GraphAuthError(`Token refresh failed (HTTP ${res.status}): ${detail.slice(0, 200)}`);
  }
  return res.json<TokenResponse>();
}

export async function getAccessToken(env: Env['Bindings']): Promise<string> {
  // Fast path — KV cache hit.
  const cached = await env.KV.get(KV_KEY);
  if (cached) return cached;
  // Slow path — exchange refresh token. Guard against concurrent
  // requests stampeding by checking once more after we have the creds.
  const creds = await readCreds(env);
  const second = await env.KV.get(KV_KEY);
  if (second) return second;
  const tok = await exchangeRefreshToken(creds);
  // Microsoft sometimes rotates the refresh token. Persist when it changes.
  if (tok.refresh_token && tok.refresh_token !== creds.refreshToken) {
    await writeRefreshToken(env, tok.refresh_token);
  }
  // Cache access_token with a 60s safety margin so we never serve a
  // token that expires mid-request.
  const ttl = Math.max(60, (tok.expires_in || 3600) - 60);
  await env.KV.put(KV_KEY, tok.access_token, { expirationTtl: ttl });
  return tok.access_token;
}

export async function invalidateAccessToken(env: Env['Bindings']): Promise<void> {
  await env.KV.delete(KV_KEY);
}

// ─── Graph fetch wrapper ──────────────────────────────────────
// Adds Authorization, handles 401 by clearing the cache and retrying
// once (in case the token expired between cache and use), surfaces
// Graph error bodies in throw messages.
export async function graphFetch(
  env: Env['Bindings'],
  path: string,
  init: RequestInit = {},
  retry = true,
): Promise<Response> {
  const token = await getAccessToken(env);
  const url = path.startsWith('http') ? path : `https://graph.microsoft.com/v1.0${path}`;
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const res = await fetch(url, { ...init, headers });
  if (res.status === 401 && retry) {
    await invalidateAccessToken(env);
    return graphFetch(env, path, init, false);
  }
  return res;
}

export async function graphJson<T>(
  env: Env['Bindings'],
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await graphFetch(env, path, init);
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.text()).slice(0, 400); } catch { /* ignore */ }
    throw new GraphAuthError(`Graph ${path} failed (HTTP ${res.status}): ${detail}`, res.status);
  }
  if (res.status === 204) return undefined as T;
  return res.json<T>();
}

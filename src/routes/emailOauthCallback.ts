// Public OAuth callback handler — split from /api/email because that
// prefix is auth-required and the user's browser is mid-redirect from
// microsoftonline.com with no Authorization header. Mounted at
// /api/email-oauth (auth: 'public'). The Azure AD app must list the
// redirect URI as exactly https://rmpgutah.us/api/email-oauth/callback
// (APP_ORIGIN), so the browser callback rides the zone proxy instead of
// the managed-challenge API hostname.
//
// Security note: this endpoint is unauthenticated by necessity. The
// boundary is the auth code itself — issued by Microsoft, single-use,
// short-lived, bound to our client_id+secret. An attacker without the
// client_secret cannot exchange a stolen code.

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';
import { exchangeAuthorizationCode, oauthRedirectCandidates, workerAppOrigin } from '../utils/appOrigin';

const oauth = new Hono<Env>();

const KEYS = {
  clientId: 'email_ms_client_id',
  clientSecret: 'email_ms_client_secret',
  tenantId: 'email_ms_tenant_id',
  refreshToken: 'email_ms_refresh_token',
  mailbox: 'email_mailbox',
  enabled: 'email_enabled',
} as const;

async function readCfg(db: D1Database): Promise<Record<string, string>> {
  const keys = Object.values(KEYS);
  const rows = await query<{ config_key: string; config_value: string }>(
    db,
    `SELECT config_key, config_value FROM system_config WHERE is_active = 1 AND config_key IN (${keys.map(() => '?').join(',')})`,
    ...keys,
  );
  const out: Record<string, string> = {};
  for (const r of rows) out[r.config_key] = r.config_value;
  return out;
}

async function writeCfg(db: D1Database, key: string, value: string): Promise<void> {
  const existing = await queryFirst<{ id: number }>(
    db, `SELECT id FROM system_config WHERE config_key = ? LIMIT 1`, key,
  );
  if (existing) {
    await execute(
      db,
      `UPDATE system_config SET config_value = ?, is_active = 1, updated_at = datetime('now') WHERE config_key = ?`,
      value, key,
    );
  } else {
    await execute(
      db,
      `INSERT INTO system_config (config_key, config_value, category, is_active, created_at, updated_at)
       VALUES (?, ?, 'email', 1, datetime('now'), datetime('now'))`,
      key, value,
    );
  }
}

oauth.get('/callback', async (c) => {
  const code = c.req.query('code');
  const errParam = c.req.query('error');
  const errDesc = c.req.query('error_description');
  const back = (status: 'authorized' | 'error', message?: string) => {
    const params = new URLSearchParams({ tab: 'email', status });
    if (message) params.set('message', message);
    return c.redirect(`${workerAppOrigin(c.env)}/admin?${params}`, 302);
  };
  if (errParam) return back('error', errDesc || errParam);
  if (!code) return back('error', 'Missing authorization code');
  try {
    const db = getDb(c.env);
    const cfg = await readCfg(db);
    if (!cfg[KEYS.clientId] || !cfg[KEYS.clientSecret] || !cfg[KEYS.tenantId]) {
      return back('error', 'Credentials were cleared mid-flow — re-enter and retry');
    }
    const exchanged = await exchangeAuthorizationCode({
      tokenUrl: `https://login.microsoftonline.com/${encodeURIComponent(cfg[KEYS.tenantId])}/oauth2/v2.0/token`,
      params: {
        client_id: cfg[KEYS.clientId],
        client_secret: cfg[KEYS.clientSecret],
        grant_type: 'authorization_code',
        code,
      },
      redirectUris: oauthRedirectCandidates(c.env, '/api/email-oauth/callback', c.req.url),
    });
    if (!exchanged.ok) {
      console.error('[EmailOAuth] token exchange failed:', exchanged.status, exchanged.body);
      return back('error', `Token exchange failed (HTTP ${exchanged.status})`);
    }
    const tok = JSON.parse(exchanged.body) as { access_token: string; refresh_token?: string };
    if (!tok.refresh_token) {
      return back('error', 'No refresh_token returned — ensure offline_access is in the requested scopes');
    }
    let mailbox: string | null = null;
    try {
      const meRes = await fetch('https://graph.microsoft.com/v1.0/me', {
        headers: { Authorization: `Bearer ${tok.access_token}` },
      });
      if (meRes.ok) {
        const me = await meRes.json<{ userPrincipalName?: string; mail?: string }>();
        mailbox = me.mail || me.userPrincipalName || null;
      }
    } catch { /* identity capture is best-effort */ }
    await writeCfg(db, KEYS.refreshToken, tok.refresh_token);
    if (mailbox) await writeCfg(db, KEYS.mailbox, mailbox);
    await writeCfg(db, KEYS.enabled, '1');
    return back('authorized');
  } catch (err) {
    console.error('[EmailOAuth] callback failed:', err);
    return back('error', err instanceof Error ? err.message : String(err));
  }
});

export default oauth;

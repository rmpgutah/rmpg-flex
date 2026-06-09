// /api/email — Microsoft 365 (Graph) integration.
//
// Phase 1 (this PR): admin configuration only.
//   GET    /status                       — connection status (JWT)
//   PUT    /admin/credentials            — save Azure clientId/clientSecret/tenantId
//   DELETE /admin/credentials            — clear creds + cached tokens
//   GET    /admin/oauth/authorize        — return Microsoft login URL
//   GET    /oauth/callback               — Microsoft redirect, exchanges code → tokens (PUBLIC)
//   POST   /admin/test-connection        — hit Graph /me with stored tokens
//   PUT    /admin/enable                 — toggle enabled + pollInterval
//   PUT    /admin/smtp-settings          — store SMTP app password (kept for parity; Workers can't open SMTP)
//   POST   /admin/sync-now               — Phase 2 stub
//
// Phase 2+ (next PR): /messages list/get, attachments, inline image proxy,
// Graph send (replaces SMTP — Workers can't open raw TCP), rules engine,
// autolinker, cron poller.
//
// Storage: legacy's `system_config` table with category='integrations'.
// Secrets (client_secret, access_token, refresh_token, smtp_password) are
// AES-GCM encrypted via src/utils/emailCrypto.ts before being written.

import { Hono } from 'hono';
import { authMiddleware, requireRole } from '../middleware/auth';
import { getDb, queryFirst, execute } from '../utils/db';
import { encryptSecret, decryptSecret } from '../utils/emailCrypto';
import type { Bindings, Variables } from '../types';

const email = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// ───────── Config-key namespace (matches legacy CONFIG_KEYS exactly) ─────────
const K = {
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

const GRAPH_SCOPES = [
  'https://graph.microsoft.com/Mail.ReadWrite',
  'https://graph.microsoft.com/Mail.Send',
  'https://graph.microsoft.com/MailboxSettings.ReadWrite',
  'offline_access',
];

// ───────── system_config helpers (category='integrations') ─────────
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

async function setCfg(db: D1Database, key: string, value: string): Promise<void> {
  // delete + insert mirrors legacy's idempotent write
  await execute(
    db,
    "DELETE FROM system_config WHERE config_key = ? AND category = 'integrations'",
    key,
  );
  await execute(
    db,
    "INSERT INTO system_config (config_key, config_value, category, sort_order, is_active, created_at, updated_at) VALUES (?, ?, 'integrations', 0, 1, datetime('now','localtime'), datetime('now','localtime'))",
    key,
    value,
  );
}

async function setCfgEncrypted(env: Bindings, key: string, value: string): Promise<void> {
  const enc = await encryptSecret(env, value);
  await setCfg(env.DB, key, enc);
}

async function delCfg(db: D1Database, key: string): Promise<void> {
  await execute(
    db,
    "DELETE FROM system_config WHERE config_key = ? AND category = 'integrations'",
    key,
  );
}

// ───────── Status shape consumed by AdminEmailTab ─────────
async function getStatus(env: Bindings) {
  const db = env.DB;
  const [clientId, tenantId, enabled, pollInterval, mailbox, refreshToken, smtpFallback, lastSync] = await Promise.all([
    getCfg(db, K.clientId),
    getCfg(db, K.tenantId),
    getCfg(db, K.enabled),
    getCfg(db, K.pollInterval),
    getCfg(db, K.mailbox),
    getCfg(db, K.refreshToken),
    getCfg(db, K.smtpFallback),
    getCfg(db, K.lastSync),
  ]);
  const clientSecret = await getCfg(db, K.clientSecret);
  const configured = !!(clientId && clientSecret && tenantId);
  const authorized = !!refreshToken;
  let cachedMessages = 0;
  try {
    const row = await queryFirst<{ c: number }>(db, 'SELECT COUNT(*) AS c FROM email_cache');
    cachedMessages = row?.c ?? 0;
  } catch { /* table may not exist yet — phase 2 */ }
  return {
    configured,
    enabled: enabled === 'true',
    authorized,
    mailbox: mailbox || null,
    lastSync: lastSync || null,
    pollInterval: pollInterval ? parseInt(pollInterval, 10) : 300,
    smtpFallback: smtpFallback === 'true',
    cachedMessages,
  };
}

// ═══════════════════════════════════════════════════════════════════
// PUBLIC: OAuth callback — Microsoft redirects here with ?code&state.
// MUST be declared BEFORE the auth middleware below.
// ═══════════════════════════════════════════════════════════════════
email.get('/oauth/callback', async (c) => {
  const url = new URL(c.req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const oauthErr = url.searchParams.get('error');
  if (oauthErr) return c.redirect(`/admin?tab=email&status=error&message=${encodeURIComponent(oauthErr)}`);
  if (!code || !state) return c.redirect('/admin?tab=email&status=error&message=Missing+code+or+state');

  // Verify CSRF state token
  const stored = await getCfg(c.env.DB, K.oauthState);
  if (!stored || stored !== state) {
    return c.redirect('/admin?tab=email&status=error&message=Invalid+state');
  }
  await delCfg(c.env.DB, K.oauthState);

  const clientId = await getCfgDecrypted(c.env, K.clientId);
  const clientSecret = await getCfgDecrypted(c.env, K.clientSecret);
  const tenantId = await getCfgDecrypted(c.env, K.tenantId);
  if (!clientId || !clientSecret || !tenantId) {
    return c.redirect('/admin?tab=email&status=error&message=Credentials+missing');
  }

  const redirectUri = `https://${url.host}/api/email/oauth/callback`;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    scope: GRAPH_SCOPES.join(' '),
  });

  try {
    const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(15_000),
    });
    const data = await res.json() as Record<string, unknown>;
    if (!res.ok) {
      const msg = String(data.error_description || data.error || 'Token exchange failed');
      return c.redirect(`/admin?tab=email&status=error&message=${encodeURIComponent(msg)}`);
    }

    await setCfgEncrypted(c.env, K.accessToken, String(data.access_token));
    if (data.refresh_token) {
      await setCfgEncrypted(c.env, K.refreshToken, String(data.refresh_token));
    }
    const expiresIn = Number(data.expires_in) || 3600;
    await setCfg(c.env.DB, K.tokenExpiresAt, String(Date.now() + expiresIn * 1000));

    // Decode the JWT's middle segment to recover the mailbox UPN
    let mailbox = '';
    try {
      const parts = String(data.access_token).split('.');
      if (parts.length >= 2) {
        const pad = parts[1].length % 4 === 0 ? '' : '='.repeat(4 - (parts[1].length % 4));
        const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/') + pad));
        mailbox = payload.upn || payload.preferred_username || payload.unique_name || '';
      }
    } catch { /* best-effort */ }
    if (mailbox) await setCfg(c.env.DB, K.mailbox, mailbox);

    if ((await getCfg(c.env.DB, K.enabled)) !== 'true') {
      await setCfg(c.env.DB, K.enabled, 'true');
    }
    return c.redirect('/admin?tab=email&status=authorized');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Token exchange failed';
    return c.redirect(`/admin?tab=email&status=error&message=${encodeURIComponent(msg)}`);
  }
});

// ═══════════════════════════════════════════════════════════════════
// Everything below requires a valid JWT.
// ═══════════════════════════════════════════════════════════════════
email.use('*', authMiddleware);

email.get('/status', async (c) => c.json(await getStatus(c.env)));

// ──────── Admin endpoints (admin role only) ────────
email.put('/admin/credentials', requireRole('admin'), async (c) => {
  const body = await c.req.json().catch(() => ({})) as { clientId?: string; clientSecret?: string; tenantId?: string };
  const { clientId, clientSecret, tenantId } = body;
  if (!clientId || !clientSecret || !tenantId) {
    return c.json({ error: 'All three Azure AD fields are required', code: 'ALL_THREE_AZURE_AD' }, 400);
  }
  await setCfgEncrypted(c.env, K.clientId, clientId);
  await setCfgEncrypted(c.env, K.clientSecret, clientSecret);
  await setCfgEncrypted(c.env, K.tenantId, tenantId);
  // Saving fresh creds invalidates any cached tokens
  await delCfg(c.env.DB, K.accessToken);
  await delCfg(c.env.DB, K.refreshToken);
  await delCfg(c.env.DB, K.tokenExpiresAt);
  await delCfg(c.env.DB, K.mailbox);
  return c.json({ success: true });
});

email.delete('/admin/credentials', requireRole('admin'), async (c) => {
  for (const key of Object.values(K)) {
    await delCfg(c.env.DB, key);
  }
  try { await execute(c.env.DB, 'DELETE FROM email_cache'); } catch { /* phase 2 */ }
  return c.json({ success: true });
});

email.get('/admin/oauth/authorize', requireRole('admin'), async (c) => {
  const clientId = await getCfgDecrypted(c.env, K.clientId);
  const tenantId = await getCfgDecrypted(c.env, K.tenantId);
  if (!clientId || !tenantId) {
    return c.json({ error: 'Azure AD credentials not configured yet', code: 'NOT_CONFIGURED' }, 400);
  }
  // CSRF state — stored in system_config so the callback (which has no
  // session) can verify it. Single-use; deleted on callback.
  const stateBytes = crypto.getRandomValues(new Uint8Array(32));
  let state = '';
  for (const b of stateBytes) state += b.toString(16).padStart(2, '0');
  await setCfg(c.env.DB, K.oauthState, state);

  const userId = c.get('userId');
  if (userId) await setCfg(c.env.DB, K.oauthInitiator, String(userId));

  const host = new URL(c.req.url).host;
  const redirectUri = `https://${host}/api/email/oauth/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: GRAPH_SCOPES.join(' '),
    state,
    prompt: 'consent',
  });
  const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?${params.toString()}`;
  return c.json({ url });
});

// Ensure a valid access token — refresh via direct POST if expired/near-expiry.
async function ensureValidToken(env: Bindings): Promise<string> {
  const accessToken = await getCfgDecrypted(env, K.accessToken);
  const expiresAtStr = await getCfg(env.DB, K.tokenExpiresAt);
  const expiresAt = expiresAtStr ? parseInt(expiresAtStr, 10) : 0;
  if (accessToken && expiresAt && Date.now() < expiresAt - 300_000) {
    return accessToken;
  }
  const refreshToken = await getCfgDecrypted(env, K.refreshToken);
  if (!refreshToken) throw new Error('Microsoft re-authorization required — no refresh token');

  const clientId = await getCfgDecrypted(env, K.clientId);
  const clientSecret = await getCfgDecrypted(env, K.clientSecret);
  const tenantId = await getCfgDecrypted(env, K.tenantId);
  if (!clientId || !clientSecret || !tenantId) {
    throw new Error('Azure AD credentials not configured');
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
    scope: GRAPH_SCOPES.join(' '),
  });
  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await res.json() as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(String(data.error_description || data.error || 'Token refresh failed'));
  }
  await setCfgEncrypted(env, K.accessToken, String(data.access_token));
  if (data.refresh_token) await setCfgEncrypted(env, K.refreshToken, String(data.refresh_token));
  const expiresIn = Number(data.expires_in) || 3600;
  await setCfg(env.DB, K.tokenExpiresAt, String(Date.now() + expiresIn * 1000));
  return String(data.access_token);
}

email.post('/admin/test-connection', requireRole('admin'), async (c) => {
  let graphResult: { success: boolean; mailbox?: string; error?: string };
  try {
    const token = await ensureValidToken(c.env);
    const res = await fetch('https://graph.microsoft.com/v1.0/me?$select=mail,displayName,userPrincipalName', {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Graph /me ${res.status}: ${text.slice(0, 200)}`);
    }
    const me = await res.json() as { mail?: string; userPrincipalName?: string };
    const mailbox = me.mail || me.userPrincipalName || 'unknown';
    if (mailbox && mailbox !== 'unknown') await setCfg(c.env.DB, K.mailbox, mailbox);
    graphResult = { success: true, mailbox };
  } catch (err: unknown) {
    graphResult = { success: false, error: err instanceof Error ? err.message : 'Connection failed' };
  }

  // SMTP not implementable on Workers (no raw TCP) — report disabled.
  const smtpFallback = await getCfg(c.env.DB, K.smtpFallback);
  const smtpResult = smtpFallback === 'true'
    ? { success: false, error: 'SMTP fallback not supported on Cloudflare Workers — use Graph send (Phase 2)' }
    : { success: false, error: 'SMTP fallback disabled' };

  return c.json({ graph: graphResult, smtp: smtpResult });
});

email.put('/admin/enable', requireRole('admin'), async (c) => {
  const body = await c.req.json().catch(() => ({})) as { enabled?: boolean; pollInterval?: number };
  if (body.enabled !== undefined) {
    await setCfg(c.env.DB, K.enabled, String(!!body.enabled));
  }
  if (body.pollInterval !== undefined) {
    const seconds = Math.max(60, Math.min(600, parseInt(String(body.pollInterval), 10) || 300));
    await setCfg(c.env.DB, K.pollInterval, String(seconds));
  }
  return c.json({ success: true, ...(await getStatus(c.env)) });
});

email.put('/admin/smtp-settings', requireRole('admin'), async (c) => {
  const body = await c.req.json().catch(() => ({})) as { enabled?: boolean; password?: string };
  if (body.enabled !== undefined) {
    await setCfg(c.env.DB, K.smtpFallback, String(!!body.enabled));
  }
  if (body.password) {
    await setCfgEncrypted(c.env, K.smtpPassword, body.password);
  }
  return c.json({ success: true });
});

// Phase 2 stub — returns a friendly "not yet" instead of 404 so the tab
// doesn't error after Authorize. Will be replaced by real Graph sync.
email.post('/admin/sync-now', requireRole('admin'), async (c) => {
  return c.json({ success: false, synced: 0, message: 'Inbox sync ships in Phase 2 — admin connection is configured.' });
});

export default email;

// /api/email — Microsoft 365 (Graph) integration.
//
// Phase 1 (admin configuration): admin credentials + SMTP fallback config.
//   GET    /status                       — connection status (JWT)
//   PUT    /admin/credentials            — save Azure clientId/clientSecret/tenantId
//   DELETE /admin/credentials            — clear creds + cached tokens
//   POST   /admin/test-connection        — hit Graph /me with stored tokens
//   PUT    /admin/enable                 — toggle enabled + pollInterval
//   PUT    /admin/smtp-settings          — store SMTP app password (kept for parity; Workers can't open SMTP)
//   POST   /admin/sync-now               — Phase 2 stub
//
// Phase 3 (per-user mailboxes, current): each operator connects their OWN
// mailbox — GET /connect/authorize, GET /connect/callback (PUBLIC),
// DELETE /connect. The Phase 1 singleton OAuth flow (GET /admin/oauth/authorize,
// GET /oauth/callback, GET /oauth/authorize) has been REMOVED — it wrote to
// the shared `ms_email_*` system_config keys, which nothing reads anymore
// except the one-time migrateSharedTokenToUserGraphTokens() best-effort
// migration. Leaving it live created a token-clobber race: a user who was
// also the recorded legacy oauth_initiator could connect fresh via /connect,
// then have the migration overwrite their new token with the stale shared
// one the first time runEmailPoll ran.
//
// Phase 2+: /messages list/get, attachments, inline image proxy, Graph send
// (replaces SMTP — Workers can't open raw TCP), rules engine, autolinker,
// cron poller.
//
// Storage: legacy's `system_config` table with category='integrations'.
// Secrets (client_secret, access_token, refresh_token, smtp_password) are
// AES-GCM encrypted via src/utils/emailCrypto.ts before being written.

import { Hono } from 'hono';
import { authMiddleware, requireRole } from '../middleware/auth';
import { getDb, queryFirst, query, execute, columnExists, queryInChunks } from '../utils/db';
import {
  parseAddrList, mapAttachments, buildSendPayload, totalAttachmentBytes, MAX_TOTAL_ATTACHMENT_BYTES,
  type SendAttachment, type SendInput,
} from '../utils/emailSend';
import { encryptSecret, decryptSecret } from '../utils/emailCrypto';
import { encryptField, decryptFieldIfEncrypted, EmailFieldEncryptionError } from '../utils/emailFieldCrypto';
import { auditEmailAction } from '../utils/emailAudit';
import { saveUserGraphToken, getUserGraphToken, deleteUserGraphToken, listConnectedUserIds } from '../utils/userGraphTokens';
import type { Bindings, Variables } from '../types';
import type { MiddlewareHandler } from 'hono';
import { rateLimitAllow } from '../utils/rateLimit';
import { emailConnectRedirectUri, exchangeAuthorizationCode, oauthRedirectCandidates, workerAppOrigin } from '../utils/appOrigin';
import { getAzureEmailCredentials, getAzureEmailIdentity, isAzureEmailConfigured } from '../utils/azureEmailCredentials';

import { log } from '../utils/logger';
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
  'https://graph.microsoft.com/Mail.ReadWrite', // implies Mail.Read
  'https://graph.microsoft.com/Mail.Send',
  'https://graph.microsoft.com/MailboxSettings.ReadWrite',
  'https://graph.microsoft.com/User.Read', // /me profile — used by test-connection
  'offline_access', // required for a refresh_token
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
  } catch (err) {
    log.error('getCfgDecrypted: failed to decrypt config key', { key }, err instanceof Error ? err : new Error(String(err)));
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
    "INSERT INTO system_config (config_key, config_value, category, sort_order, is_active, created_at, updated_at) VALUES (?, ?, 'integrations', 0, 1, datetime(\'now\'), datetime(\'now\'))",
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
  const [enabled, pollInterval, mailbox, refreshToken, smtpFallback, lastSync] = await Promise.all([
    getCfg(db, K.enabled),
    getCfg(db, K.pollInterval),
    getCfg(db, K.mailbox),
    getCfg(db, K.refreshToken),
    getCfg(db, K.smtpFallback),
    getCfg(db, K.lastSync),
  ]);
  const configured = await isAzureEmailConfigured(env);
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
    // EmailPage's enrollment gate reads `enrolled` — the org runs one shared
    // mailbox, so enrolled == the tenant OAuth grant being in place.
    enrolled: configured && authorized,
    mailbox: mailbox || null,
    lastSync: lastSync || null,
    pollInterval: pollInterval ? parseInt(pollInterval, 10) : 300,
    smtpFallback: smtpFallback === 'true',
    cachedMessages,
  };
}

// ═══════════════════════════════════════════════════════════════════
// Everything below requires a valid JWT.
// ═══════════════════════════════════════════════════════════════════
// All routes require JWT EXCEPT /connect/callback — Microsoft redirects
// the user's browser directly to it with ?code=...&state=..., so the
// request carries no Authorization header / no rmpg cookies. Auth-gating
// it would 401 every consent attempt. Hono's `email.use('*', mw)` runs
// the middleware on every matched route regardless of registration
// order, so we can't just register the callback first — we must
// explicitly skip auth on that path here.
// (The legacy singleton /oauth/callback used to have the same exemption —
// removed along with the rest of the Phase 1 singleton OAuth flow; see the
// header comment at the top of this file.)
email.use('*', async (c, next) => {
  const pathname = new URL(c.req.url).pathname;
  if (
    pathname === '/api/email/connect/callback' || pathname.endsWith('/connect/callback')
  ) {
    return next();
  }
  return authMiddleware(c, next);
});

// Per-user mailbox connect (Phase 3) — any authenticated user, not admin-gated.
// State is bound to the requesting user via a per-request system_config row
// (email_connect_state_<random> = userId), consumed atomically by the
// callback below — same CSRF pattern as the existing admin authorize flow,
// just keyed per-connection instead of a global singleton.
email.get('/connect/authorize', async (c) => {
  const userId = c.get('userId');
  const identity = await getAzureEmailIdentity(c.env);
  if (!identity) {
    return c.json({ error: 'Azure AD app registration is not configured yet — ask an admin to set it up', code: 'NOT_CONFIGURED' }, 400);
  }
  const { clientId, tenantId } = identity;
  const stateBytes = crypto.getRandomValues(new Uint8Array(32));
  let state = '';
  for (const b of stateBytes) state += b.toString(16).padStart(2, '0');
  const redirectUri = emailConnectRedirectUri(c.env, c.req.url);
  await setCfg(c.env.DB, `email_connect_state_${state}`, JSON.stringify({ userId, redirectUri }));

  // Same-origin on the SPA host so the Azure redirect rides rmpg-api-proxy
  // (WAF cookie already set) instead of api.rmpgutah.us (challenge host).
  // Token exchange retries api.rmpgutah.us if this tenant still has the old URI.
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

// Public: Microsoft redirects here with ?code&state after a per-user
// mailbox connect. Mirrors /oauth/callback's token-exchange structure but
// resolves the owning userId from the per-request state row instead of a
// singleton, and writes to user_graph_tokens instead of system_config.
email.get('/connect/callback', async (c) => {
  const spa = workerAppOrigin(c.env);
  const toEmail = (query: string) => c.redirect(`${spa}/email?${query}`);
  const url = new URL(c.req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const oauthErr = url.searchParams.get('error');
  if (oauthErr) {
    const KNOWN_OAUTH_ERRORS = new Set([
      'access_denied', 'invalid_request', 'unauthorized_client', 'invalid_grant',
      'unsupported_response_type', 'invalid_scope', 'server_error', 'temporarily_unavailable',
    ]);
    const safeErr = KNOWN_OAUTH_ERRORS.has(oauthErr) ? oauthErr : 'oauth_error';
    return toEmail(`connect_status=error&message=${encodeURIComponent(safeErr)}`);
  }
  if (!code || !state) return toEmail('connect_status=error&message=Missing+code+or+state');

  const stateKey = `email_connect_state_${state}`;
  const row = await queryFirst<{ config_value: string }>(
    c.env.DB,
    "SELECT config_value FROM system_config WHERE config_key = ? AND category = 'integrations' AND is_active = 1 LIMIT 1",
    stateKey,
  );
  if (!row) return toEmail('connect_status=error&message=Invalid+or+expired+state');
  const consumed = await execute(
    c.env.DB,
    "DELETE FROM system_config WHERE config_key = ? AND category = 'integrations'",
    stateKey,
  );
  if (((consumed?.meta?.changes as number | undefined) ?? 0) === 0) {
    return toEmail('connect_status=error&message=Invalid+state');
  }
  let userId = 0;
  let storedRedirect: string | undefined;
  try {
    const parsed = JSON.parse(row.config_value) as { userId?: unknown; redirectUri?: unknown };
    if (typeof parsed.userId === 'number') {
      userId = parsed.userId;
      if (typeof parsed.redirectUri === 'string') storedRedirect = parsed.redirectUri;
    }
  } catch { /* legacy: raw user id */ }
  if (!userId) userId = parseInt(row.config_value, 10);
  if (!userId) return toEmail('connect_status=error&message=Invalid+state');

  const creds = await getAzureEmailCredentials(c.env);
  if (!creds) {
    return toEmail('connect_status=error&message=Credentials+missing');
  }
  const { clientId, clientSecret, tenantId } = creds;

  const redirectUris = oauthRedirectCandidates(
    c.env,
    '/api/email/connect/callback',
    c.req.url,
    storedRedirect,
  );

  try {
    const exchanged = await exchangeAuthorizationCode({
      tokenUrl: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
      params: {
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        scope: GRAPH_SCOPES.join(' '),
      },
      redirectUris,
    });
    if (!exchanged.ok) {
      let msg = 'Token exchange failed';
      try {
        const data = JSON.parse(exchanged.body) as Record<string, unknown>;
        msg = String(data.error_description || data.error || msg);
      } catch { /* raw body */ }
      return toEmail(`connect_status=error&message=${encodeURIComponent(msg)}`);
    }
    const data = JSON.parse(exchanged.body) as Record<string, unknown>;

    let mailbox: string | undefined;
    try {
      const parts = String(data.access_token).split('.');
      if (parts.length >= 2) {
        const pad = parts[1].length % 4 === 0 ? '' : '='.repeat(4 - (parts[1].length % 4));
        const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/') + pad));
        mailbox = payload.upn || payload.preferred_username || payload.unique_name || undefined;
      }
    } catch { /* best-effort */ }

    // Enforce that the Microsoft account being connected matches the email
    // address assigned to this user in the RMPG users table. Email addresses
    // are case-insensitive (RFC 5321 §2.4) so compare lowercased.
    const userRow = await queryFirst<{ email: string | null }>(
      c.env.DB,
      'SELECT email FROM users WHERE id = ?',
      userId,
    );
    const assignedEmail = userRow?.email?.toLowerCase() ?? null;
    if (assignedEmail && mailbox && mailbox.toLowerCase() !== assignedEmail) {
      log.warn('email connect blocked: Microsoft account does not match assigned address', {
        userId,
        attempted: mailbox,
        assigned: assignedEmail,
      });
      return toEmail(`connect_status=error&message=${encodeURIComponent('That Microsoft account does not match your assigned email address')}`);
    }

    const expiresIn = Number(data.expires_in) || 3600;
    await saveUserGraphToken(c.env.DB, c.env, userId, {
      accessToken: String(data.access_token),
      refreshToken: data.refresh_token ? String(data.refresh_token) : '',
      expiresAt: Date.now() + expiresIn * 1000,
      mailbox,
    });

    return toEmail('connect_status=connected');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Token exchange failed';
    return toEmail(`connect_status=error&message=${encodeURIComponent(msg)}`);
  }
});

email.delete('/connect', async (c) => {
  const userId = c.get('userId');
  await deleteUserGraphToken(c.env.DB, userId);
  return c.json({ success: true });
});

email.get('/connect/status', async (c) => {
  const userId = c.get('userId');
  const [token, azureConfigured] = await Promise.all([
    getUserGraphToken(c.env.DB, c.env, userId),
    isAzureEmailConfigured(c.env),
  ]);
  return c.json({ connected: !!token, mailbox: token?.mailbox ?? null, azureConfigured });
});

// Send-family rate limit — separate from the generic apiRateLimit (600/5min,
// sized for read-heavy dispatch polling). A compromised session or a buggy
// client retry loop must not be able to burn through the org's single shared
// Graph mailbox's send quota or trip Microsoft's abuse detection.
const EMAIL_SEND_LIMIT = 20;
const EMAIL_SEND_WINDOW_SECONDS = 300;

export const emailSendRateLimit: MiddlewareHandler<{ Bindings: Bindings; Variables: Variables }> = async (c, next) => {
  const userId = c.get('userId') as number | undefined;
  if (userId == null) return next();
  const allowed = await rateLimitAllow(c.env.KV, `email-send:${userId}`, EMAIL_SEND_LIMIT, EMAIL_SEND_WINDOW_SECONDS);
  if (!allowed) {
    return c.json({ error: 'Too many emails sent. Slow down and try again shortly.', code: 'EMAIL_RATE_LIMITED' }, 429);
  }
  return next();
};

email.get('/status', async (c) => c.json(await getStatus(c.env)));

// ──────── Admin endpoints (admin role only) ────────
// Azure AD GUID shape — clientId and tenantId are always
// xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx (32 hex + 4 dashes).
// tenantId may also be 'common', 'organizations', or 'consumers' for
// public Microsoft endpoints, but in a single-tenant RMPG deploy it
// should be a GUID. Anything else is paste error.
const AZURE_GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SPECIAL_TENANTS = new Set(['common', 'organizations', 'consumers']);

email.put('/admin/credentials', requireRole('admin'), async (c) => {
  const body = await c.req.json().catch(() => ({})) as { clientId?: string; clientSecret?: string; tenantId?: string };
  const clientId = body.clientId?.trim();
  const clientSecret = body.clientSecret?.trim();
  const tenantId = body.tenantId?.trim();
  if (!clientId || !clientSecret || !tenantId) {
    return c.json({ error: 'All three Azure AD fields are required.', code: 'ALL_THREE_AZURE_AD' }, 400);
  }
  if (!AZURE_GUID_RE.test(clientId)) {
    return c.json({
      error: 'Application (Client) ID must be a GUID like xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx. Copy it from Azure Portal → App registrations → Overview.',
      code: 'CLIENT_ID_NOT_GUID',
    }, 400);
  }
  if (!AZURE_GUID_RE.test(tenantId) && !SPECIAL_TENANTS.has(tenantId.toLowerCase())) {
    return c.json({
      error: 'Directory (Tenant) ID must be a GUID, or one of: common, organizations, consumers. Copy it from Azure Portal → App registrations → Overview.',
      code: 'TENANT_ID_NOT_GUID',
    }, 400);
  }
  // Client secret VALUE is a short opaque string (~40 chars, includes
  // ~/_-). Reject the common mistake of pasting the secret ID (a GUID).
  if (AZURE_GUID_RE.test(clientSecret)) {
    return c.json({
      error: 'You pasted the Client Secret ID (a GUID). Paste the Secret VALUE instead — Azure shows it only once, right after you create the secret.',
      code: 'CLIENT_SECRET_LOOKS_LIKE_ID',
    }, 400);
  }
  if (clientSecret.length < 20) {
    return c.json({
      error: 'Client Secret looks too short. Paste the full secret VALUE from Azure (typically 40+ characters).',
      code: 'CLIENT_SECRET_TOO_SHORT',
    }, 400);
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

// Ensure a valid access token — refresh via direct POST if expired/near-expiry.
async function ensureValidToken(env: Bindings, userId: number): Promise<string> {
  const stored = await getUserGraphToken(env.DB, env, userId);
  if (!stored) throw new Error('Microsoft mailbox not connected — visit /email and click Connect');
  if (stored.accessToken && stored.expiresAt && Date.now() < stored.expiresAt - 300_000) {
    return stored.accessToken;
  }
  if (!stored.refreshToken) throw new Error('Microsoft re-authorization required — no refresh token');

  const creds = await getAzureEmailCredentials(env);
  if (!creds) {
    throw new Error('Azure AD credentials not configured');
  }
  const { clientId, clientSecret, tenantId } = creds;

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: stored.refreshToken,
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
  const expiresIn = Number(data.expires_in) || 3600;
  await saveUserGraphToken(env.DB, env, userId, {
    accessToken: String(data.access_token),
    refreshToken: data.refresh_token ? String(data.refresh_token) : stored.refreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
    mailbox: stored.mailbox ?? undefined,
  });
  return String(data.access_token);
}

email.post('/admin/test-connection', requireRole('admin'), async (c) => {
  const userId = c.get('userId');
  let graphResult: { success: boolean; mailbox?: string; error?: string };
  try {
    const token = await ensureValidToken(c.env, userId);
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

// ═══════════════════════════════════════════════════════════════════
// Phase 2 — Inbox read / send via Microsoft Graph
//
// All routes call Graph live with the tenant access token. We do not
// cache message bodies on Workers (no benefit on the request path; the
// authorized user has one mailbox, latency is dominated by Graph).
// Phase 3 will add a `email_messages` table + cron poller for offline
// + rule-engine support.
// ═══════════════════════════════════════════════════════════════════

async function graphFetch(env: Bindings, userId: number, path: string, init: RequestInit = {}): Promise<Response> {
  const token = await ensureValidToken(env, userId);
  const headers = new Headers(init.headers as HeadersInit | undefined);
  headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return fetch(`https://graph.microsoft.com/v1.0${path}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(20_000),
  });
}

// Graph message → client EmailMessage shape (camelCase, matches client/src/types/index.ts)
function mapMessage(m: Record<string, unknown>): Record<string, unknown> {
  const from = m.from as { emailAddress?: { address?: string; name?: string } } | undefined;
  const mapAddrs = (arr: unknown): Array<{ email: string; name?: string }> =>
    Array.isArray(arr)
      ? arr.map((r) => {
          const ea = (r as { emailAddress?: { address?: string; name?: string } }).emailAddress;
          return { email: ea?.address || '', name: ea?.name };
        })
      : [];
  const flag = m.flag as { flagStatus?: string } | undefined;
  return {
    id: m.id,
    conversationId: m.conversationId,
    subject: m.subject || '(No subject)',
    fromAddress: from?.emailAddress?.address || '',
    fromName: from?.emailAddress?.name || '',
    toAddresses: mapAddrs(m.toRecipients),
    ccAddresses: mapAddrs(m.ccRecipients),
    bodyPreview: m.bodyPreview || '',
    hasAttachments: !!m.hasAttachments,
    isRead: m.isRead !== false,
    isFlagged: flag?.flagStatus === 'flagged',
    importance: (m.importance as string) || 'normal',
    receivedAt: m.receivedDateTime,
    sentAt: m.sentDateTime,
  };
}

// Rewrite cid:XXX image refs in HTML body so the browser fetches them
// through our proxy (which carries the Bearer token, the browser doesn't).
function rewriteCidImages(html: string, messageId: string, attachments: Array<{ id: string; contentId?: string; isInline?: boolean }>): string {
  if (!html || !attachments.length) return html;
  const byCid = new Map<string, string>();
  for (const a of attachments) {
    if (a.contentId) byCid.set(a.contentId.toLowerCase(), a.id);
  }
  if (!byCid.size) return html;
  return html.replace(/src=("|')cid:([^"'<>]+)\1/gi, (match, q, cid) => {
    const aid = byCid.get(String(cid).toLowerCase());
    if (!aid) return match;
    return `src=${q}/api/email/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(aid)}?inline=1${q}`;
  });
}

// ─── Folders ──────────────────────────────────────────────────────
email.get('/folders', async (c) => {
  const userId = c.get('userId');
  try {
    const allFolders: unknown[] = [];
    let url: string | null = '/me/mailFolders?$select=id,displayName,parentFolderId,totalItemCount,unreadItemCount,childFolderCount&$top=100';
    // Paginate to collect ALL top-level folders (Graph caps at $top=100 per page)
    while (url) {
      const res = await graphFetch(c.env, userId, url);
      if (!res.ok) break;
      const data = await res.json() as { value?: unknown[]; '@odata.nextLink'?: string };
      if (data.value) allFolders.push(...data.value);
      url = data['@odata.nextLink'] ?? null;
      // Safety: strip the full Graph base URL so graphFetch re-prefixes it
      if (url && url.startsWith('https://')) {
        try { url = new URL(url).pathname + new URL(url).search; } catch { url = null; }
      }
    }
    return c.json(allFolders);
  } catch {
    return c.json([]);
  }
});

email.get('/folders/:id/children', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  try {
    const res = await graphFetch(c.env, userId, `/me/mailFolders/${encodeURIComponent(id)}/childFolders?$select=id,displayName,parentFolderId,totalItemCount,unreadItemCount,childFolderCount&$top=50`);
    if (!res.ok) return c.json([]);
    const data = await res.json() as { value?: unknown[] };
    return c.json(data.value || []);
  } catch {
    return c.json([]);
  }
});

// ─── Unread count ────────────────────────────────────────────────
email.get('/unread-count', async (c) => {
  const userId = c.get('userId');
  try {
    const res = await graphFetch(c.env, userId, '/me/mailFolders/inbox?$select=unreadItemCount');
    if (!res.ok) return c.json({ count: 0 });
    const data = await res.json() as { unreadItemCount?: number };
    return c.json({ count: data.unreadItemCount || 0 });
  } catch {
    return c.json({ count: 0 });
  }
});

// ─── Message list ────────────────────────────────────────────────
email.get('/messages', async (c) => {
  const userId = c.get('userId');
  const folder = c.req.query('folder') || 'inbox';
  // Accept Graph-native (top/skip) AND client pagination (page/per_page).
  const perPage = Math.max(1, Math.min(100, parseInt(c.req.query('per_page') || c.req.query('top') || '25', 10) || 25));
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10) || 1);
  const skip = c.req.query('skip') ? Math.max(0, parseInt(c.req.query('skip') || '0', 10)) : (page - 1) * perPage;
  const search = c.req.query('search') || c.req.query('q') || '';
  const select = 'id,conversationId,subject,from,toRecipients,ccRecipients,bodyPreview,hasAttachments,isRead,flag,importance,receivedDateTime,sentDateTime';
  const params = new URLSearchParams();
  params.set('$select', select);
  params.set('$orderby', 'receivedDateTime desc');
  params.set('$top', String(perPage));
  if (skip > 0) params.set('$skip', String(skip));
  // Escape backslash FIRST, then quotes, before embedding in the OData $search
  // quoted string (otherwise a value with `\` could break out of the literal).
  if (search) params.set('$search', `"${search.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);;
  try {
    const res = await graphFetch(
      c.env,
      userId,
      `/me/mailFolders/${encodeURIComponent(folder)}/messages?${params.toString()}`,
    );
    if (!res.ok) return c.json({ messages: [], hasMore: false });
    const data = await res.json() as { value?: Record<string, unknown>[] };
    const messages = (data.value || []).map(mapMessage);
    return c.json({ messages, hasMore: messages.length === perPage });
  } catch {
    return c.json({ messages: [], hasMore: false });
  }
});

// ─── Cached-message search (search-as-you-type) ──────────────────
// Searches the D1 email_messages cache (subject/from/preview LIKE).
// Returns raw snake_case rows — EmailPage maps them to camelCase.

// D1's LIKE operator silently stops matching once the pattern exceeds
// roughly 48-50 characters — not an error, just wrong (empty) results.
// Cap the raw query well under that so `%${q}%` (42 chars max) never
// approaches the boundary. See project memory: D1 LIKE 50-char pattern cap.
const MAX_EMAIL_SEARCH_QUERY_LEN = 40;

export function buildSearchLikePattern(rawQuery: string): string {
  const capped = rawQuery.slice(0, MAX_EMAIL_SEARCH_QUERY_LEN);
  return `%${capped.replace(/[%_]/g, ' ')}%`;
}

email.get('/messages/search', async (c) => {
  const userId = c.get('userId');
  const q = (c.req.query('q') || '').trim();
  if (q.length < 2) return c.json({ results: [] });
  const folder = (c.req.query('folder') || '').trim();
  const like = buildSearchLikePattern(q);
  try {
    // body_preview is stored encrypted (src/utils/emailFieldCrypto.ts) and
    // therefore cannot be LIKE-matched — search narrows to subject/sender.
    const params: unknown[] = [userId, like, like];
    let folderClause = '';
    if (folder && folder !== 'inbox') { folderClause = 'AND folder_id = ?'; params.push(folder); }
    const rows = await query<Record<string, unknown>>(
      c.env.DB,
      `SELECT graph_id, conversation_id, subject, from_address, from_name, body_preview,
              has_attachments, is_read, is_flagged, importance, received_at
         FROM email_messages
        WHERE owner_user_id = ?
          AND (subject LIKE ? OR from_address LIKE ?)
          ${folderClause}
        ORDER BY received_at DESC
        LIMIT 50`,
      ...params,
    );
    const results = await Promise.all(rows.map(async (r) => ({
      ...r,
      body_preview: await decryptFieldIfEncrypted(c.env, r.body_preview as string | null),
    })));
    return c.json({ results });
  } catch (err) {
    log.error('messages search failed', { userId }, err);
    return c.json({ results: [] });
  }
});

// ─── Single message (full body, with CID image rewriting) ────────
email.get('/messages/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  try {
    const [msgRes, attsRes] = await Promise.all([
      graphFetch(c.env, userId, `/me/messages/${encodeURIComponent(id)}?$select=id,conversationId,subject,from,toRecipients,ccRecipients,bodyPreview,body,hasAttachments,isRead,flag,importance,receivedDateTime,sentDateTime`),
      graphFetch(c.env, userId, `/me/messages/${encodeURIComponent(id)}/attachments?$select=id,name,contentType,size,isInline,contentId`),
    ]);
    if (!msgRes.ok) return c.json({ error: 'Message not found' }, msgRes.status as 404 | 500);
    const m = await msgRes.json() as Record<string, unknown>;
    const atts = attsRes.ok ? ((await attsRes.json() as { value?: Array<{ id: string; contentId?: string; isInline?: boolean }> }).value || []) : [];
    const out = mapMessage(m) as Record<string, unknown>;
    const body = m.body as { contentType?: string; content?: string } | undefined;
    let bodyHtml = body?.content || '';
    if (body?.contentType?.toLowerCase() === 'html') {
      bodyHtml = rewriteCidImages(bodyHtml, id, atts);
    }
    out.bodyHtml = bodyHtml;
    return c.json(out);
  } catch (err: unknown) {
    return c.json({ error: err instanceof Error ? err.message : 'Failed' }, 502);
  }
});

// ─── Attachments list ────────────────────────────────────────────
email.get('/messages/:id/attachments', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  try {
    const res = await graphFetch(c.env, userId, `/me/messages/${encodeURIComponent(id)}/attachments?$select=id,name,contentType,size,isInline,contentId`);
    if (!res.ok) return c.json([]);
    const data = await res.json() as { value?: Array<Record<string, unknown>> };
    const atts = (data.value || []).map((a) => ({
      id: a.id,
      name: a.name,
      contentType: a.contentType,
      size: a.size || 0,
      isInline: !!a.isInline,
      contentId: a.contentId,
    }));
    return c.json(atts);
  } catch {
    return c.json([]);
  }
});

// ─── Attachment binary proxy (Bearer kept server-side) ──────────
// Decodes Graph's base64 contentBytes and streams the raw bytes back.
// ?inline=1 → Content-Disposition: inline (used by rewritten <img>);
// otherwise attachment;filename=...
email.get('/messages/:id/attachments/:aid', async (c) => {
  const userId = c.get('userId');
  // Auth: this path matches authMiddleware's inline-CID media regex, so a
  // header-less GET with sig+exp reaches the handler unverified — which made
  // the department mailbox's attachments readable without a session using the
  // server-side Graph bearer. proxyEmailImages() appends the session token to
  // inline CID srcs, and the attachment click path uses apiFetchBlob (header),
  // so both real callers still work.
  const user = c.get('user') as { id?: number } | undefined;
  if (!user) return c.json({ error: 'Authentication required' }, 401);

  const id = c.req.param('id');
  const aid = c.req.param('aid');
  const inline = c.req.query('inline') === '1';
  try {
    const res = await graphFetch(c.env, userId, `/me/messages/${encodeURIComponent(id)}/attachments/${encodeURIComponent(aid)}`);
    if (!res.ok) return c.json({ error: 'Attachment not found' }, 404);
    const a = await res.json() as { name?: string; contentType?: string; contentBytes?: string };
    if (!a.contentBytes) return c.json({ error: 'Empty attachment' }, 404);
    const bin = atob(a.contentBytes);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const safeName = (a.name || 'attachment').replace(/[\r\n"]/g, '_');

    // `a.contentType` is chosen by whoever SENT the email — echoing it let an
    // external sender serve text/html from our own origin. Combined with the
    // viewer opening attachments in a blob: iframe (blob: inherits the creating
    // origin), that was arbitrary script execution as rmpgutah.us and theft of
    // the reader's session token. So: only render a type inline when it is one
    // we can prove is inert, and never let the browser sniff its way to HTML.
    const declared = (a.contentType || '').split(';')[0].trim().toLowerCase();
    const INLINE_SAFE = new Set([
      'application/pdf',
      'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp', 'image/tiff',
    ]);
    // image/svg+xml is deliberately absent — SVG is a script-bearing format.
    const canInline = inline && INLINE_SAFE.has(declared);
    const contentType = canInline ? declared : 'application/octet-stream';

    return new Response(bytes, {
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(bytes.length),
        // Anything not provably inert downloads instead of rendering.
        'Content-Disposition': canInline ? `inline; filename="${safeName}"` : `attachment; filename="${safeName}"`,
        'Cache-Control': 'private, max-age=300',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    });
  } catch (err: unknown) {
    return c.json({ error: err instanceof Error ? err.message : 'Failed' }, 502);
  }
});

// ─── Remote-image proxy (privacy: client IP never hits sender's CDN) ─
// Whitelist HTTPS only; bounded size; pass-through Content-Type. EmailPage
// rewrites <img src> through this when "load remote images" is enabled.
email.get('/image-proxy', async (c) => {
  // Auth: '/api/email/image-proxy' is in authMiddleware's media list, so a
  // header-less GET with sig+exp lands here unverified. Without this check
  // the endpoint was an UNAUTHENTICATED open proxy: any caller could make
  // the Worker fetch an arbitrary https host from Cloudflare's edge and use
  // the distinct 400/502/415 responses as a host/port enumeration oracle.
  // proxyEmailImages() in EmailPage.tsx appends the session token, so
  // requiring a session keeps remote-image loading working.
  const user = c.get('user') as { id?: number } | undefined;
  if (!user) return c.json({ error: 'Authentication required' }, 401);

  const raw = c.req.query('url');
  if (!raw) return c.json({ error: 'url required' }, 400);
  let url: URL;
  try { url = new URL(raw); } catch { return c.json({ error: 'bad url' }, 400); }
  if (url.protocol !== 'https:') return c.json({ error: 'https only' }, 400);
  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: 'image/*' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return c.json({ error: `upstream ${res.status}` }, 502);
    const ctRaw = (res.headers.get('Content-Type') || 'application/octet-stream').split(';')[0].trim();
    // SVG is script-bearing: block it explicitly even though it starts with 'image/'.
    const IMAGE_ALLOWLIST = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp', 'image/tiff']);
    if (!IMAGE_ALLOWLIST.has(ctRaw)) return c.json({ error: 'not an image' }, 415);
    // Enforce 8 MB cap even when Content-Length is absent (chunked upstream).
    const MAX = 8 * 1024 * 1024;
    const len = res.headers.get('Content-Length');
    if (len && parseInt(len, 10) > MAX) return c.json({ error: 'too large' }, 413);
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX) return c.json({ error: 'too large' }, 413);
    return new Response(buf, {
      headers: {
        'Content-Type': ctRaw,
        'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    });
  } catch (err: unknown) {
    return c.json({ error: err instanceof Error ? err.message : 'Failed' }, 502);
  }
});

// ─── Mark read / flag / move / delete ───────────────────────────
email.patch('/messages/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({})) as { isRead?: boolean; isFlagged?: boolean };
  const patch: Record<string, unknown> = {};
  if (body.isRead !== undefined) patch.isRead = !!body.isRead;
  if (body.isFlagged !== undefined) patch.flag = { flagStatus: body.isFlagged ? 'flagged' : 'notFlagged' };
  if (!Object.keys(patch).length) return c.json({ success: false, error: 'No fields to update' }, 400);
  try {
    const res = await graphFetch(c.env, userId, `/me/messages/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    if (!res.ok) return c.json({ success: false, error: `Graph ${res.status}` }, 502);
    return c.json({ success: true });
  } catch (err: unknown) {
    return c.json({ success: false, error: err instanceof Error ? err.message : 'Failed' }, 502);
  }
});

email.post('/messages/:id/move', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({})) as { folderId?: string };
  if (!body.folderId) return c.json({ error: 'folderId required' }, 400);
  try {
    const res = await graphFetch(c.env, userId, `/me/messages/${encodeURIComponent(id)}/move`, {
      method: 'POST',
      body: JSON.stringify({ destinationId: body.folderId }),
    });
    if (!res.ok) return c.json({ success: false, error: `Graph ${res.status}` }, 502);
    return c.json({ success: true });
  } catch (err: unknown) {
    return c.json({ success: false, error: err instanceof Error ? err.message : 'Failed' }, 502);
  }
});

email.delete('/messages/:id', async (c) => {
  const id = c.req.param('id');
  const userId = c.get('userId');
  const user = c.get('user') as { username?: string } | undefined;
  try {
    const res = await graphFetch(c.env, userId, `/me/messages/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const ok = res.ok || res.status === 404;
    await auditEmailAction(c.env, {
      userId, username: user?.username, action: 'delete',
      graphMessageId: id, status: ok ? 'sent' : 'failed',
      error: ok ? undefined : `Graph ${res.status}`,
    });
    if (!ok) return c.json({ success: false, error: `Graph ${res.status}` }, 502);
    return c.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed';
    await auditEmailAction(c.env, { userId, username: user?.username, action: 'delete', graphMessageId: id, status: 'failed', error: msg });
    return c.json({ success: false, error: msg }, 502);
  }
});

// ─── Send / reply / forward (Graph — replaces SMTP) ──────────────
// parseAddrList / mapAttachments / buildSendPayload + SendAttachment / SendInput
// now live in ../utils/emailSend (shared with the PDF-from-context handler).

// Runtime reconcile for the 0118 record-link columns (deploy migration step is
// continue-on-error; this guarantees the columns exist before we write them).
let _outboxRecordColsEnsured = false;
async function ensureOutboxRecordColumns(db: D1Database): Promise<boolean> {
  if (_outboxRecordColsEnsured) return true;
  try {
    if (!(await columnExists(db, 'email_outbox', 'record_type'))) {
      try { await execute(db, 'ALTER TABLE email_outbox ADD COLUMN record_type TEXT'); } catch { /* already exists */ }
      try { await execute(db, 'ALTER TABLE email_outbox ADD COLUMN record_id INTEGER'); } catch { /* already exists */ }
    }
    _outboxRecordColsEnsured = await columnExists(db, 'email_outbox', 'record_type');
  } catch {
    // email_outbox table not yet created; stay false so the next call retries
  }
  return _outboxRecordColsEnsured;
}

// Shared send core: enqueue to the durable outbox, attempt a synchronous Graph
// send, and on failure leave the row pending for the cron drain to retry.
// Used by both POST /send and the PDF-from-context handler.
// NOTE: opts.recordType AND opts.recordId must BOTH be non-null to link the
// send to a record — supplying only one silently omits the link.
export async function enqueueAndSend(
  env: Bindings,
  ownerUserId: number,
  payload: unknown,
  opts: { recordType?: string | null; recordId?: number | null } = {},
): Promise<{ outboxId: number; status: 'sent' | 'queued'; error?: string }> {
  const json = JSON.stringify(payload);
  const wantLink = opts.recordType != null && opts.recordId != null;
  const hasRecordCols = wantLink ? await ensureOutboxRecordColumns(env.DB) : false;

  const queued = hasRecordCols
    ? await execute(env.DB,
        "INSERT INTO email_outbox (owner_user_id, payload, status, record_type, record_id) VALUES (?, ?, 'pending', ?, ?)",
        ownerUserId, json, opts.recordType, opts.recordId)
    : await execute(env.DB,
        "INSERT INTO email_outbox (owner_user_id, payload, status) VALUES (?, ?, 'pending')",
        ownerUserId, json);
  const outboxId = queued.meta.last_row_id as number;

  try {
    const res = await graphFetch(env, ownerUserId, '/me/sendMail', { method: 'POST', body: json });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = `Graph ${res.status}: ${text.slice(0, 200)}`;
      await execute(env.DB,
        "UPDATE email_outbox SET attempts = 1, last_error = ?, next_attempt_at = datetime('now','+1 minute') WHERE id = ?",
        err, outboxId);
      return { outboxId, status: 'queued', error: err };
    }
    await execute(env.DB,
      "UPDATE email_outbox SET status = 'sent', sent_at = datetime(\'now\') WHERE id = ?",
      outboxId);
    return { outboxId, status: 'sent' };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed';
    await execute(env.DB,
      "UPDATE email_outbox SET attempts = 1, last_error = ?, next_attempt_at = datetime('now','+1 minute') WHERE id = ?",
      msg, outboxId);
    return { outboxId, status: 'queued', error: msg };
  }
}

email.post('/send', emailSendRateLimit, async (c) => {
  const userId = c.get('userId');
  const user = c.get('user') as { username?: string } | undefined;
  const body = await c.req.json().catch(() => ({})) as SendInput;
  const toAddrs = parseAddrList(body.to);
  if (!toAddrs.length) return c.json({ error: 'At least one recipient required' }, 400);
  const attBytes = totalAttachmentBytes(body.attachments);
  if (attBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
    return c.json({
      error: `Attachments total ${(attBytes / 1024 / 1024).toFixed(1)}MB, max ${MAX_TOTAL_ATTACHMENT_BYTES / 1024 / 1024}MB per message`,
      code: 'ATTACHMENTS_TOO_LARGE',
    }, 413);
  }
  const payload = buildSendPayload(body);
  const r = await enqueueAndSend(c.env, userId, payload);
  await auditEmailAction(c.env, {
    userId, username: user?.username, action: 'send',
    toAddresses: toAddrs.map((a) => a.emailAddress.address),
    ccAddresses: parseAddrList(body.cc).map((a) => a.emailAddress.address),
    subject: body.subject,
    status: r.status === 'sent' ? 'sent' : 'queued',
    error: r.error,
  });
  if (r.status === 'sent') return c.json({ success: true, outboxId: r.outboxId });
  return c.json({ success: false, queued: true, outboxId: r.outboxId, error: r.error }, 202);
});

// Outbox introspection for the EmailPage compose UI ("3 messages queued for retry")
email.get('/outbox', async (c) => {
  const userId = c.get('userId');
  const rows = await query(
    c.env.DB,
    "SELECT id, attempts, last_error, next_attempt_at, status, created_at, sent_at FROM email_outbox WHERE owner_user_id = ? AND status != 'sent' ORDER BY id DESC LIMIT 50",
    userId,
  );
  return c.json({ outbox: rows });
});

// Outbound PDFs/emails sent FROM a given record (case/incident/warrant/evidence).
// Reads the durable outbox by the 0118 record-link columns and parses each
// payload to a clean surface shape. Distinct from /links/by-entity, which lists
// INBOUND emails (email_links, keyed by Graph message-id).
email.get('/by-record', async (c) => {
  const recordType = c.req.query('recordType');
  const recordId = c.req.query('recordId');
  if (!recordType || !recordId) return c.json({ items: [] });
  if (!(await columnExists(c.env.DB, 'email_outbox', 'record_type'))) return c.json({ items: [] });

  const rows = await query<{
    id: number; owner_user_id: number; payload: string; status: string;
    created_at: string; sent_at: string | null; last_error: string | null;
    full_name: string | null; username: string | null;
  }>(c.env.DB,
    `SELECT o.id, o.owner_user_id, o.payload, o.status, o.created_at, o.sent_at, o.last_error,
            u.full_name, u.username
       FROM email_outbox o
       LEFT JOIN users u ON u.id = o.owner_user_id
      WHERE o.record_type = ? AND o.record_id = ?
      ORDER BY o.id DESC LIMIT 100`,
    recordType, Number(recordId));

  const items = rows.map((r) => {
    let to: string[] = []; let subject = ''; let attachmentName: string | null = null;
    try {
      const p = JSON.parse(r.payload) as {
        message?: {
          subject?: string;
          toRecipients?: Array<{ emailAddress?: { address?: string } }>;
          attachments?: Array<{ name?: string }>;
        };
      };
      to = (p.message?.toRecipients || []).map((x) => x.emailAddress?.address || '').filter(Boolean);
      subject = p.message?.subject || '';
      attachmentName = p.message?.attachments?.[0]?.name || null;
    } catch { /* leave defaults */ }
    return {
      outboxId: r.id, status: r.status, createdAt: r.created_at, sentAt: r.sent_at,
      error: r.last_error, sentByUserId: r.owner_user_id,
      sentBy: r.full_name || r.username || `user #${r.owner_user_id}`,
      to, subject, attachmentName,
    };
  });
  return c.json({ items });
});

// Outbound-email audit log for AdminPage (AdminEmailAuditTab).
// Derived from the durable email_outbox (the only place every send is
// recorded) JOINed to users — email_audit_log exists in schema but is
// never written, so reading it would always be empty. Returns a BARE
// ARRAY of AuditRow, role-gated to admin/manager/supervisor.
// Optional ?status=sent|failed filter.
email.get('/audit', requireRole('admin', 'manager', 'supervisor'), async (c) => {
  const statusFilter = c.req.query('status'); // 'sent' | 'failed' | undefined
  let where = '';
  if (statusFilter === 'sent') where = "WHERE o.status = 'sent'";
  else if (statusFilter === 'failed') where = "WHERE o.status != 'sent'";

  const rows = await query<{
    id: number; owner_user_id: number; payload: string; status: string;
    created_at: string; sent_at: string | null; last_error: string | null;
    username: string | null;
  }>(c.env.DB,
    `SELECT o.id, o.owner_user_id, o.payload, o.status, o.created_at, o.sent_at, o.last_error,
            u.username
       FROM email_outbox o
       LEFT JOIN users u ON u.id = o.owner_user_id
       ${where}
      ORDER BY o.id DESC LIMIT 200`,
  ).catch(() => [] as any[]); // table may not exist yet on a fresh DB

  const audit = rows.map((r) => {
    let to: string[] = []; let cc: string[] = []; let subject = '';
    try {
      const p = JSON.parse(r.payload) as {
        message?: {
          subject?: string;
          toRecipients?: Array<{ emailAddress?: { address?: string } }>;
          ccRecipients?: Array<{ emailAddress?: { address?: string } }>;
        };
      };
      to = (p.message?.toRecipients || []).map((x) => x.emailAddress?.address || '').filter(Boolean);
      cc = (p.message?.ccRecipients || []).map((x) => x.emailAddress?.address || '').filter(Boolean);
      subject = p.message?.subject || '';
    } catch { /* leave defaults */ }
    return {
      id: r.id,
      sent_by: r.owner_user_id,
      sent_by_username: r.username,
      to_addresses: JSON.stringify(to),
      cc_addresses: cc.length ? JSON.stringify(cc) : null,
      subject,
      template_id: null,
      graph_message_id: null,
      status: (r.status === 'sent' ? 'sent' : 'failed') as 'sent' | 'failed',
      error: r.last_error,
      sent_at: r.sent_at || r.created_at,
    };
  });
  return c.json(audit);
});

// Cron-drained: pop up-to-N pending rows whose next_attempt_at has
// passed, attempt Graph send, exponential-backoff on failure (1m → 5m
// → 30m → fail after 5 attempts). Exported for src/index.ts.
export async function drainEmailOutbox(env: Bindings): Promise<{ sent: number; failed: number; deferred: number }> {
  const rows = await query<{ id: number; payload: string; attempts: number; owner_user_id: number }>(
    env.DB,
    "SELECT id, payload, attempts, owner_user_id FROM email_outbox WHERE status = 'pending' AND next_attempt_at <= datetime(\'now\') ORDER BY id ASC LIMIT 10",
  );
  let sent = 0, failed = 0, deferred = 0;
  const BACKOFFS = ['+1 minute', '+5 minutes', '+30 minutes', '+2 hours', '+6 hours'];
  // Records the FINAL resolution ('sent' or 'failed') of a previously-queued
  // send. The initial /send handler already wrote a 'queued' row; this closes
  // it out once the retry loop actually succeeds or gives up for good.
  const auditResolution = async (row: { id: number; payload: string; owner_user_id: number }, status: 'sent' | 'failed', error?: string) => {
    try {
      const p = JSON.parse(row.payload) as {
        message?: {
          subject?: string;
          toRecipients?: Array<{ emailAddress?: { address?: string } }>;
          ccRecipients?: Array<{ emailAddress?: { address?: string } }>;
        };
      };
      const toAddresses = (p.message?.toRecipients || []).map((x) => x.emailAddress?.address || '').filter(Boolean);
      const ccAddresses = (p.message?.ccRecipients || []).map((x) => x.emailAddress?.address || '').filter(Boolean);
      const subject = p.message?.subject || '';
      const user = await queryFirst<{ username: string | null }>(env.DB, 'SELECT username FROM users WHERE id = ?', row.owner_user_id).catch(() => null);
      await auditEmailAction(env, {
        userId: row.owner_user_id, username: user?.username, action: 'send',
        toAddresses, ccAddresses, subject, status, error,
      });
    } catch (auditErr) {
      log.error('Failed to write drainEmailOutbox resolution audit row', { outboxId: row.id }, auditErr);
    }
  };
  for (const r of rows) {
    try {
      const res = await graphFetch(env, r.owner_user_id, '/me/sendMail', { method: 'POST', body: r.payload });
      if (res.ok) {
        await execute(env.DB, "UPDATE email_outbox SET status = 'sent', sent_at = datetime(\'now\') WHERE id = ?", r.id);
        await auditResolution(r, 'sent');
        sent++;
        continue;
      }
      const text = await res.text().catch(() => '');
      const attempts = r.attempts + 1;
      const err = `Graph ${res.status}: ${text.slice(0, 200)}`;
      if (attempts >= BACKOFFS.length) {
        await execute(env.DB, "UPDATE email_outbox SET status = 'failed', attempts = ?, last_error = ? WHERE id = ?", attempts, err, r.id);
        await auditResolution(r, 'failed', err);
        failed++;
      } else {
        await execute(
          env.DB,
          `UPDATE email_outbox SET attempts = ?, last_error = ?, next_attempt_at = datetime('now','${BACKOFFS[attempts]}') WHERE id = ?`,
          attempts, err, r.id,
        );
        deferred++;
      }
    } catch (err: unknown) {
      const attempts = r.attempts + 1;
      const msg = err instanceof Error ? err.message : 'send failed';
      if (attempts >= BACKOFFS.length) {
        await execute(env.DB, "UPDATE email_outbox SET status = 'failed', attempts = ?, last_error = ? WHERE id = ?", attempts, msg, r.id);
        await auditResolution(r, 'failed', msg);
        failed++;
      } else {
        await execute(
          env.DB,
          `UPDATE email_outbox SET attempts = ?, last_error = ?, next_attempt_at = datetime('now','${BACKOFFS[attempts]}') WHERE id = ?`,
          attempts, msg, r.id,
        );
        deferred++;
      }
    }
  }
  return { sent, failed, deferred };
}

email.post('/messages/:id/reply', emailSendRateLimit, async (c) => {
  const id = c.req.param('id');
  const userId = c.get('userId');
  const user = c.get('user') as { username?: string } | undefined;
  const body = await c.req.json().catch(() => ({})) as { body?: string; comment?: string };
  try {
    const res = await graphFetch(c.env, userId, `/me/messages/${encodeURIComponent(id)}/reply`, {
      method: 'POST',
      body: JSON.stringify({ comment: body.body || body.comment || '' }),
    });
    const ok = res.ok;
    await auditEmailAction(c.env, {
      userId, username: user?.username, action: 'reply',
      graphMessageId: id, status: ok ? 'sent' : 'failed',
      error: ok ? undefined : `Graph ${res.status}`,
    });
    if (!ok) return c.json({ success: false, error: `Graph ${res.status}` }, 502);
    return c.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed';
    await auditEmailAction(c.env, { userId, username: user?.username, action: 'reply', graphMessageId: id, status: 'failed', error: msg });
    return c.json({ success: false, error: msg }, 502);
  }
});

// ─── Per-user signature (stored in system_config) ───────────────
email.get('/signature', async (c) => {
  const userId = c.get('userId');
  const row = await queryFirst<{ config_value: string }>(
    c.env.DB,
    "SELECT config_value FROM system_config WHERE config_key = ? AND category = 'email' LIMIT 1",
    `email_signature_${userId}`,
  );
  return c.json({ signature: row?.config_value || '' });
});

email.put('/signature', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json().catch(() => ({})) as { signature?: string };
  const sig = (body.signature || '').slice(0, 5000);
  const key = `email_signature_${userId}`;
  await execute(c.env.DB, "DELETE FROM system_config WHERE config_key = ? AND category = 'email'", key);
  if (sig.trim()) {
    await execute(
      c.env.DB,
      "INSERT INTO system_config (config_key, config_value, category, sort_order, is_active, created_at, updated_at) VALUES (?, ?, 'email', 0, 1, datetime(\'now\'), datetime(\'now\'))",
      key,
      sig,
    );
  }
  return c.json({ success: true });
});

// ─── sync-now (real: counts inbox, stamps lastSync) ──────────────
email.post('/admin/sync-now', requireRole('admin'), async (c) => {
  const userId = c.get('userId');
  try {
    const res = await graphFetch(c.env, userId, '/me/mailFolders/inbox?$select=totalItemCount,unreadItemCount');
    if (!res.ok) {
      return c.json({ success: false, synced: 0, error: `Graph ${res.status}` }, 502);
    }
    const data = await res.json() as { totalItemCount?: number; unreadItemCount?: number };
    const now = new Date().toISOString();
    await setCfg(c.env.DB, K.lastSync, now);
    return c.json({
      success: true,
      synced: data.totalItemCount || 0,
      unread: data.unreadItemCount || 0,
      lastSync: now,
    });
  } catch (err: unknown) {
    return c.json({ success: false, error: err instanceof Error ? err.message : 'Failed' }, 502);
  }
});

// ═══════════════════════════════════════════════════════════════════
// Phase 3 — Rules engine, autolinker, cron poller
// ═══════════════════════════════════════════════════════════════════

interface RuleConditions {
  from?: string;          // case-insensitive substring by default
  subject?: string;       // case-insensitive substring by default
  hasAttachment?: 0 | 1;
  regex?: boolean;        // power-user toggle — treat from/subject as regex
}
interface RuleActions {
  markRead?: 1;
  flag?: 1;
  moveFolder?: string;    // Graph folder id (e.g. 'archive', 'deleteditems', or a custom id)
  categories?: string[];  // tags merged into email_messages.categories
}
interface RuleRow {
  id: number;
  owner_user_id: number;
  name: string;
  is_active: number;
  conditions: string;
  actions: string;
}

// Power-user rules may opt into raw-regex matching (cond.regex === true), which
// compiles a user-authored pattern and runs it against email text. A regex built
// from user input is a ReDoS / regex-injection vector (CWE-1333 / CWE-730): a
// crafted pattern such as (a+)+$ run over attacker-influenced subject/sender text
// can pin the Worker isolate's CPU. We bound BOTH sides of the match — the
// pattern length and the haystack length — which keeps worst-case backtracking
// well below a denial-of-service. Patterns over the cap are rejected (the rule
// simply doesn't match) rather than compiled. Mirrors the original
// emailRuleEngine limits that were dropped when this path was ported to the
// Worker.
const MAX_RULE_REGEX_LEN = 256;
const MAX_RULE_INPUT_LEN = 1024;

function safeRe(src: string): RegExp | null {
  if (src.length > MAX_RULE_REGEX_LEN) return null;
  try { return new RegExp(src, 'i'); } catch { return null; }
}

function matchRule(cond: RuleConditions, m: {
  from_address?: string | null; subject?: string | null; has_attachments?: number;
}): boolean {
  if (cond.from) {
    const f = (m.from_address || '').toLowerCase();
    if (cond.regex) {
      const re = safeRe(cond.from);
      if (!re || !re.test((m.from_address || '').slice(0, MAX_RULE_INPUT_LEN))) return false;
    } else if (!f.includes(cond.from.toLowerCase())) return false;
  }
  if (cond.subject) {
    if (cond.regex) {
      const re = safeRe(cond.subject);
      if (!re || !re.test((m.subject || '').slice(0, MAX_RULE_INPUT_LEN))) return false;
    } else {
      const s = (m.subject || '').toLowerCase();
      if (!s.includes(cond.subject.toLowerCase())) return false;
    }
  }
  if (cond.hasAttachment !== undefined) {
    if (!!(m.has_attachments) !== !!cond.hasAttachment) return false;
  }
  return true;
}

// Autolinker — scan body + subject for CFS numbers and Utah plates.
// CFS pattern: CFS##-##### (live: CFS26-00056).
// Plate pattern: Utah standard 3-digit + 3-letter (123ABC), 3-letter +
// 3-digit (ABC123), or 6-7 alnum personalized (RMPG1). To avoid false
// positives from acronyms (FBI, NYPD, USA), we only link plates that
// exist in vehicles_records.plate_number — the regex is the candidate
// generator, the DB is the gate.
const CFS_RE = /\bCFS\d{2}-\d{5}\b/gi;
const PLATE_CANDIDATES_RE = /\b(?:[A-Z]{1,3}\d{3,4}|\d{3,4}[A-Z]{1,3}|[A-Z0-9]{6,7})\b/g;

async function runAutolinker(
  db: D1Database,
  ownerUserId: number,
  msg: { graph_id: string; subject?: string | null; body_preview?: string | null; body_html?: string | null },
): Promise<number> {
  const hay = `${msg.subject || ''}\n${msg.body_preview || ''}\n${msg.body_html || ''}`;
  const seen = new Set<string>();
  let linked = 0;

  // CFS — pattern is unambiguous, link without DB confirmation.
  for (const match of hay.matchAll(CFS_RE)) {
    const ref = match[0].toUpperCase();
    if (seen.has(`cfs:${ref}`)) continue;
    seen.add(`cfs:${ref}`);
    const row = await queryFirst<{ id: number }>(db, 'SELECT id FROM calls_for_service WHERE call_number = ? LIMIT 1', ref);
    if (!row) continue;
    try {
      await execute(
        db,
        "INSERT OR IGNORE INTO email_links (message_graph_id, owner_user_id, entity_type, entity_id, entity_ref, source) VALUES (?, ?, 'cfs', ?, ?, 'autolinker')",
        msg.graph_id, ownerUserId, row.id, ref,
      );
      linked++;
    } catch { /* best-effort */ }
  }

  // Plates — generate candidates, dedupe, batch-check against vehicles_records.
  // The DB lookup is the false-positive filter; without it "MAY2025" or "PDF123"
  // would link as plates.
  const candidates = new Set<string>();
  for (const match of hay.toUpperCase().matchAll(PLATE_CANDIDATES_RE)) {
    const tok = match[0];
    if (tok.length < 5 || tok.length > 7) continue;
    candidates.add(tok);
  }
  if (candidates.size) {
    const cands = [...candidates];
    const hits = await queryInChunks<{ id: number; plate_number: string }>(
      db,
      cands,
      (placeholders) => `SELECT id, plate_number FROM vehicles_records WHERE plate_number IN (${placeholders}) LIMIT 50`,
    );
    for (const v of hits) {
      const ref = (v.plate_number || '').toUpperCase();
      if (!ref || seen.has(`plate:${ref}`)) continue;
      seen.add(`plate:${ref}`);
      try {
        await execute(
          db,
          "INSERT OR IGNORE INTO email_links (message_graph_id, owner_user_id, entity_type, entity_id, entity_ref, source) VALUES (?, ?, 'plate', ?, ?, 'autolinker')",
          msg.graph_id, ownerUserId, v.id, ref,
        );
        linked++;
      } catch { /* best-effort */ }
    }
  }
  return linked;
}

// One-time, best-effort migration (Phase 3): the single shared admin-owned
// token (owned by whoever is recorded in K.oauthInitiator) gets copied into
// user_graph_tokens for that same user, so they don't lose access on
// deploy day. Everyone else connects fresh via /connect/authorize.
// Guarded by a system_config flag so it only ever runs once. Never throws —
// worst case on failure is that one user reconnects manually, same as
// everyone else.
export async function migrateSharedTokenToUserGraphTokens(env: Bindings): Promise<void> {
  const alreadyMigrated = await getCfg(env.DB, 'email_phase3_migrated');
  if (alreadyMigrated === 'true') return;
  try {
    const initiator = await getCfg(env.DB, K.oauthInitiator);
    const userId = initiator ? parseInt(initiator, 10) : 0;
    if (userId) {
      const accessToken = await getCfgDecrypted(env, K.accessToken);
      const refreshToken = await getCfgDecrypted(env, K.refreshToken);
      const expiresAtStr = await getCfg(env.DB, K.tokenExpiresAt);
      const mailbox = await getCfg(env.DB, K.mailbox);
      if (accessToken && refreshToken && expiresAtStr) {
        await saveUserGraphToken(env.DB, env, userId, {
          accessToken,
          refreshToken,
          expiresAt: parseInt(expiresAtStr, 10),
          mailbox: mailbox ?? undefined,
        });
      }
    }
  } catch (err) {
    log.error('Phase 3 shared-token migration failed (best-effort, non-fatal)', {}, err);
  }
  await setCfg(env.DB, 'email_phase3_migrated', 'true');
}

// One pull cycle: list inbox newer than lastSync, upsert into email_messages,
// evaluate active rules, run autolinker, optionally apply Graph-side actions.
// Throttled by the caller via lastSync timestamp.
export async function runEmailPoll(env: Bindings, ctx?: ExecutionContext): Promise<{ scanned: number; upserted: number; ruleHits: number; linked: number; skipped: boolean; error?: string; perUser: Array<{ userId: number; scanned: number; upserted: number; ruleHits: number; linked: number; error?: string }> }> {
  await migrateSharedTokenToUserGraphTokens(env);
  // Phase 3: email is per-user opt-in (a user connecting their own mailbox
  // via /connect IS the enable signal), so a global ms_email_enabled toggle
  // is architecturally redundant now that there's no shared mailbox to
  // gate. Previously this flag had no UI writer after Task 6 removed the
  // admin panel that called PUT /admin/enable, which left the poller
  // permanently inert by default even after wiring the cron trigger.
  // listConnectedUserIds() below is the real gate: zero connected users
  // means zero work, same end result without a stale global switch.
  const userIds = await listConnectedUserIds(env.DB);
  if (!userIds.length) return { scanned: 0, upserted: 0, ruleHits: 0, linked: 0, skipped: true, error: 'no connected users', perUser: [] };

  let totalScanned = 0;
  let totalUpserted = 0;
  let totalRuleHits = 0;
  let totalLinked = 0;
  const perUser: Array<{ userId: number; scanned: number; upserted: number; ruleHits: number; linked: number; error?: string }> = [];

  // Poll each connected user's mailbox independently — one user's expired
  // token / Graph error / malformed data is caught here and does not stop
  // the others from being polled.
  for (const ownerUserId of userIds) {
    try {
      const res = await graphFetch(
        env,
        ownerUserId,
        `/me/mailFolders/inbox/messages?$select=id,conversationId,subject,from,toRecipients,ccRecipients,bodyPreview,hasAttachments,isRead,flag,importance,receivedDateTime,sentDateTime&$orderby=receivedDateTime desc&$top=50`,
      );
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const error = `Graph ${res.status}: ${text.slice(0, 150)}`;
        perUser.push({ userId: ownerUserId, scanned: 0, upserted: 0, ruleHits: 0, linked: 0, error });
        continue;
      }
      const data = await res.json() as { value?: Array<Record<string, unknown>> };
      const items = data.value || [];

      const rules = await query<RuleRow>(
        env.DB,
        'SELECT id, owner_user_id, name, is_active, conditions, actions FROM email_rules WHERE is_active = 1 AND (owner_user_id IS NULL OR owner_user_id = ?)',
        ownerUserId,
      );

      // Blocked-senders list (Phase 4) — matching mail is junked on arrival.
      // Entries are either a full address or '@domain.com' suffix.
      const blockedRows = await query<{ address: string }>(
        env.DB,
        'SELECT address FROM email_blocked_senders WHERE owner_user_id = ?',
        ownerUserId,
      ).catch(() => [] as Array<{ address: string }>);
      const blocked = blockedRows.map((b) => b.address.toLowerCase());
      const isBlocked = (addr: string | null): boolean => {
        if (!addr) return false;
        const a = addr.toLowerCase();
        return blocked.some((b) => (b.startsWith('@') ? a.endsWith(b) : a === b));
      };

      let upserted = 0;
      let ruleHits = 0;
      let linked = 0;

      for (const raw of items) {
        const from = raw.from as { emailAddress?: { address?: string; name?: string } } | undefined;
        const flag = raw.flag as { flagStatus?: string } | undefined;
        const m = {
          graph_id: String(raw.id),
          conversation_id: raw.conversationId as string | undefined,
          subject: (raw.subject as string) || null,
          from_address: from?.emailAddress?.address || null,
          from_name: from?.emailAddress?.name || null,
          to_addresses: JSON.stringify(raw.toRecipients || []),
          cc_addresses: JSON.stringify(raw.ccRecipients || []),
          body_preview: (raw.bodyPreview as string) || null,
          has_attachments: raw.hasAttachments ? 1 : 0,
          is_read: raw.isRead === false ? 0 : 1,
          is_flagged: flag?.flagStatus === 'flagged' ? 1 : 0,
          importance: (raw.importance as string) || 'normal',
          received_at: raw.receivedDateTime as string | undefined,
          sent_at: raw.sentDateTime as string | undefined,
        };

        // Blocked sender → straight to Junk, skip rules/autolinker.
        if (isBlocked(m.from_address)) {
          const mv = graphFetch(env, ownerUserId, `/me/messages/${encodeURIComponent(m.graph_id)}/move`, {
            method: 'POST', body: JSON.stringify({ destinationId: 'junkemail' }),
          }).catch(() => null);
          if (ctx) ctx.waitUntil(mv);
          continue;
        }

        // Evaluate rules, build categories + Graph patches.
        const cats = new Set<string>();
        let toMarkRead = false;
        let toFlag = false;
        let toMove: string | undefined;
        for (const r of rules) {
          let cond: RuleConditions; let acts: RuleActions;
          try { cond = JSON.parse(r.conditions); acts = JSON.parse(r.actions); }
          catch { continue; }
          if (!matchRule(cond, m)) continue;
          ruleHits++;
          if (acts.markRead) toMarkRead = true;
          if (acts.flag) toFlag = true;
          if (acts.moveFolder) toMove = acts.moveFolder;
          for (const t of acts.categories || []) cats.add(t);
        }

        const categories = cats.size ? JSON.stringify([...cats]) : null;

        try {
          const encryptedBodyPreview = m.body_preview ? await encryptField(env, m.body_preview) : m.body_preview;
          await execute(
            env.DB,
            `INSERT INTO email_messages
              (owner_user_id, graph_id, conversation_id, folder_id, subject, from_address, from_name, to_addresses, cc_addresses, body_preview, has_attachments, is_read, is_flagged, importance, categories, received_at, sent_at)
             VALUES (?, ?, ?, 'inbox', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(owner_user_id, graph_id) DO UPDATE SET
               is_read = excluded.is_read,
               is_flagged = excluded.is_flagged,
               categories = COALESCE(excluded.categories, email_messages.categories),
               body_preview = excluded.body_preview`,
            ownerUserId, m.graph_id, m.conversation_id ?? null, m.subject, m.from_address, m.from_name,
            m.to_addresses, m.cc_addresses, encryptedBodyPreview, m.has_attachments, m.is_read, m.is_flagged,
            m.importance, categories, m.received_at ?? null, m.sent_at ?? null,
          );
          upserted++;
        } catch (err) { log.error('email_messages upsert failed', { graphId: m.graph_id }, err); }

        // Apply Graph-side side effects (move/markRead/flag). Fire-and-forget
        // so a single failure can't stall the poll loop.
        if (toMarkRead || toFlag || toMove) {
          const patch: Record<string, unknown> = {};
          if (toMarkRead) patch.isRead = true;
          if (toFlag) patch.flag = { flagStatus: 'flagged' };
          const p = Object.keys(patch).length
            ? graphFetch(env, ownerUserId, `/me/messages/${encodeURIComponent(m.graph_id)}`, { method: 'PATCH', body: JSON.stringify(patch) }).catch(() => null)
            : Promise.resolve(null);
          const mv = toMove
            ? graphFetch(env, ownerUserId, `/me/messages/${encodeURIComponent(m.graph_id)}/move`, { method: 'POST', body: JSON.stringify({ destinationId: toMove }) }).catch(() => null)
            : Promise.resolve(null);
          if (ctx) ctx.waitUntil(Promise.all([p, mv]));
        }

        // Autolinker — only on rows we just inserted (cheap dedup via INSERT OR IGNORE).
        try { linked += await runAutolinker(env.DB, ownerUserId, m); } catch { /* best-effort */ }
      }

      await setCfg(env.DB, K.lastSync, new Date().toISOString());
      totalScanned += items.length;
      totalUpserted += upserted;
      totalRuleHits += ruleHits;
      totalLinked += linked;
      perUser.push({ userId: ownerUserId, scanned: items.length, upserted, ruleHits, linked });
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : 'poll failed';
      log.error('runEmailPoll: per-user poll failed', { userId: ownerUserId }, err);
      perUser.push({ userId: ownerUserId, scanned: 0, upserted: 0, ruleHits: 0, linked: 0, error });
    }
  }

  return { scanned: totalScanned, upserted: totalUpserted, ruleHits: totalRuleHits, linked: totalLinked, skipped: false, perUser };
}

// ─── Rules CRUD ─────────────────────────────────────────────────
email.get('/rules', async (c) => {
  const userId = c.get('userId');
  const rows = await query<RuleRow>(
    c.env.DB,
    'SELECT id, owner_user_id, name, is_active, conditions, actions FROM email_rules WHERE owner_user_id IS NULL OR owner_user_id = ? ORDER BY id DESC',
    userId,
  );
  return c.json({
    rules: rows.map((r) => ({
      id: r.id,
      name: r.name,
      isActive: !!r.is_active,
      conditions: safeParse(r.conditions),
      actions: safeParse(r.actions),
    })),
    total: rows.length,
  });
});

function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return {}; }
}

email.post('/rules', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json().catch(() => ({})) as { name?: string; conditions?: RuleConditions; actions?: RuleActions; isActive?: boolean };
  if (!body.name || !body.conditions || !body.actions) {
    return c.json({ error: 'name, conditions and actions are required' }, 400);
  }
  const r = await execute(
    c.env.DB,
    'INSERT INTO email_rules (name, conditions, actions, is_active, owner_user_id) VALUES (?, ?, ?, ?, ?)',
    body.name, JSON.stringify(body.conditions), JSON.stringify(body.actions),
    body.isActive === false ? 0 : 1, userId,
  );
  return c.json({ id: r.meta.last_row_id, success: true });
});

email.put('/rules/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const userId = c.get('userId');
  const body = await c.req.json().catch(() => ({})) as { name?: string; conditions?: RuleConditions; actions?: RuleActions; isActive?: boolean };
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (body.name !== undefined) { sets.push('name = ?'); vals.push(body.name); }
  if (body.conditions !== undefined) { sets.push('conditions = ?'); vals.push(JSON.stringify(body.conditions)); }
  if (body.actions !== undefined) { sets.push('actions = ?'); vals.push(JSON.stringify(body.actions)); }
  if (body.isActive !== undefined) { sets.push('is_active = ?'); vals.push(body.isActive ? 1 : 0); }
  if (!sets.length) return c.json({ success: true });
  sets.push("updated_at = datetime('now')");
  // Org-wide rules (owner_user_id IS NULL) require admin/manager to modify.
  const rule = await queryFirst<{ owner_user_id: number | null }>(c.env.DB, 'SELECT owner_user_id FROM email_rules WHERE id = ?', id);
  if (!rule) return c.json({ success: false, error: 'Not found' }, 404);
  const userRole = (c.get('user') as { role?: string } | undefined)?.role;
  if (rule.owner_user_id === null && !['admin', 'manager'].includes(userRole ?? '')) {
    return c.json({ error: 'Insufficient role to modify shared rule' }, 403);
  }
  const ownerId = rule.owner_user_id ?? userId;
  vals.push(id, ownerId);
  await execute(c.env.DB, `UPDATE email_rules SET ${sets.join(', ')} WHERE id = ? AND owner_user_id = ?`, ...vals);
  return c.json({ success: true });
});

email.delete('/rules/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const userId = c.get('userId');
  const rule = await queryFirst<{ owner_user_id: number | null }>(c.env.DB, 'SELECT owner_user_id FROM email_rules WHERE id = ?', id);
  if (!rule) return c.json({ success: true }); // already gone
  const userRole = (c.get('user') as { role?: string } | undefined)?.role;
  if (rule.owner_user_id === null && !['admin', 'manager'].includes(userRole ?? '')) {
    return c.json({ error: 'Insufficient role to delete shared rule' }, 403);
  }
  const ownerId = rule.owner_user_id ?? userId;
  await execute(c.env.DB, 'DELETE FROM email_rules WHERE id = ? AND owner_user_id = ?', id, ownerId);
  return c.json({ success: true });
});

email.post('/rules/test-match', async (c) => {
  const body = await c.req.json().catch(() => ({})) as {
    conditions?: RuleConditions;
    sample?: { from?: string; subject?: string; hasAttachment?: boolean };
  };
  if (!body.conditions || !body.sample) return c.json({ error: 'conditions and sample required' }, 400);
  const matches = matchRule(body.conditions, {
    from_address: body.sample.from,
    subject: body.sample.subject,
    has_attachments: body.sample.hasAttachment ? 1 : 0,
  });
  return c.json({ matches });
});

// Legacy link shape consumed by EmailPage's <EmailIncidentLinks>:
//   { id, email_graph_id, incident_id, call_id, warrant_id, person_id,
//     link_type, notes, linked_by, created_at }
// New shape (normalized): entity_type/entity_id/entity_ref/source.
// Adapter maps the canonical row → legacy view: entity_type='cfs'
// populates call_id (cfs IS a calls_for_service row), 'incident'/'warrant'/
// 'person' map directly. 'plate' and other types stay in entity_ref only.
interface LinkRow {
  id: number;
  message_graph_id: string;
  entity_type: string;
  entity_id: number | null;
  entity_ref: string | null;
  source: string;
  link_type: string | null;
  notes: string | null;
  created_at: string;
  created_by: number | null;
}

function toLegacyLink(r: LinkRow): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: r.id,
    email_graph_id: r.message_graph_id,
    incident_id: null,
    call_id: null,
    warrant_id: null,
    person_id: null,
    plate_ref: null,
    link_type: r.link_type || (r.source === 'autolinker' ? 'autolinker' : 'related'),
    notes: r.notes,
    linked_by: r.created_by,
    created_at: r.created_at,
    entity_type: r.entity_type,
    entity_id: r.entity_id,
    entity_ref: r.entity_ref,
    source: r.source,
  };
  switch (r.entity_type) {
    case 'cfs':      out.call_id = r.entity_id; break;
    case 'call':     out.call_id = r.entity_id; break;
    case 'incident': out.incident_id = r.entity_id; break;
    case 'warrant':  out.warrant_id = r.entity_id; break;
    case 'person':   out.person_id = r.entity_id; break;
    case 'plate':    out.plate_ref = r.entity_ref; break;
  }
  return out;
}

// ─── Links for a single message (autolinker output) ─────────────
// Returns the LEGACY array shape (top-level array) to stay compatible
// with the existing EmailPage <EmailIncidentLinks> component.
email.get('/links/:graphId', async (c) => {
  const graphId = c.req.param('graphId');
  const userId = c.get('userId');
  const rows = await query<LinkRow>(
    c.env.DB,
    `SELECT id, message_graph_id, entity_type, entity_id, entity_ref, source,
            link_type, notes, created_at, created_by
       FROM email_links
      WHERE message_graph_id = ? AND owner_user_id = ?
      ORDER BY id DESC`,
    graphId, userId,
  );
  return c.json(rows.map(toLegacyLink));
});

// Reverse lookup — emails linked to a record (CFS / incident / warrant /
// person). Accepts legacy aliases on :type ('call' → 'cfs'). Joins
// email_messages so the consumer can render subject/from/date without
// a second roundtrip.
email.get('/links/by-entity/:type/:id', async (c) => {
  const raw = c.req.param('type');
  const type = raw === 'call' ? 'cfs' : raw;
  const id = parseInt(c.req.param('id'), 10);
  const userId = c.get('userId');
  const rows = await query<LinkRow & {
    subject: string | null; from_address: string | null; from_name: string | null; received_at: string | null;
  }>(
    c.env.DB,
    `SELECT l.id, l.message_graph_id, l.entity_type, l.entity_id, l.entity_ref,
            l.source, l.link_type, l.notes, l.created_at, l.created_by,
            m.subject, m.from_address, m.from_name, m.received_at
       FROM email_links l
       LEFT JOIN email_messages m ON m.graph_id = l.message_graph_id AND m.owner_user_id = l.owner_user_id
      WHERE l.entity_type = ? AND l.entity_id = ? AND l.owner_user_id = ?
      ORDER BY l.id DESC`,
    type, id, userId,
  );
  return c.json({
    links: rows.map((r) => ({
      ...toLegacyLink(r),
      subject: r.subject,
      from_address: r.from_address,
      from_name: r.from_name,
      received_at: r.received_at,
    })),
  });
});

// Manual link — accepts BOTH:
//   Legacy (EmailIncidentLinks): { emailGraphId, incidentId|callId|warrantId|personId, linkType, notes }
//   Canonical:                   { messageGraphId, entityType, entityId, entityRef, notes, linkType }
email.post('/link', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;

  const graphId = (body.messageGraphId || body.emailGraphId) as string | undefined;
  if (!graphId) return c.json({ error: 'messageGraphId/emailGraphId required' }, 400);

  let entityType = body.entityType as string | undefined;
  let entityId = (body.entityId as number | undefined) ?? null;
  let entityRef = (body.entityRef as string | undefined) ?? null;

  // Legacy discrete columns → normalized.
  if (!entityType) {
    if (body.incidentId) { entityType = 'incident'; entityId = body.incidentId as number; }
    else if (body.callId) { entityType = 'cfs'; entityId = body.callId as number; }
    else if (body.warrantId) { entityType = 'warrant'; entityId = body.warrantId as number; }
    else if (body.personId) { entityType = 'person'; entityId = body.personId as number; }
  }
  if (!entityType) return c.json({ error: 'entityType (or one of incidentId/callId/warrantId/personId) required' }, 400);

  // If only an id was given for cfs, populate entity_ref with call_number for
  // human-readable display in record-page reverse lookups.
  if (entityType === 'cfs' && entityId && !entityRef) {
    const row = await queryFirst<{ call_number: string }>(c.env.DB, 'SELECT call_number FROM calls_for_service WHERE id = ?', entityId);
    if (row?.call_number) entityRef = row.call_number;
  }

  const linkType = (body.linkType as string | undefined) || null;
  const notes = (body.notes as string | undefined) || null;

  try {
    const r = await execute(
      c.env.DB,
      "INSERT INTO email_links (message_graph_id, owner_user_id, entity_type, entity_id, entity_ref, source, link_type, notes, created_by) VALUES (?, ?, ?, ?, ?, 'manual', ?, ?, ?)",
      graphId, userId, entityType, entityId, entityRef, linkType, notes, userId,
    );
    return c.json({ id: r.meta.last_row_id, success: true });
  } catch (err: unknown) {
    return c.json({ success: false, error: err instanceof Error ? err.message : 'failed' }, 500);
  }
});

email.delete('/link/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const userId = c.get('userId');
  await execute(c.env.DB, 'DELETE FROM email_links WHERE id = ? AND owner_user_id = ?', id, userId);
  return c.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════
// Phase 4 — Outlook parity
//
// Everything the desktop Outlook client does that Graph exposes:
// reply-all/forward, drafts, batch ops, folder CRUD, categories,
// focused inbox, conversation threads, message headers / raw MIME,
// snooze, schedule send, sweep, block sender, auto-replies (OOF),
// mailbox settings, people autocomplete. Local D1 tables back the
// features Graph has no API for (templates, schedule-send queue,
// snooze, block list) — see migrations/0089_email_outlook_parity.sql.
// ═══════════════════════════════════════════════════════════════════

// ─── Reply-all / Forward ─────────────────────────────────────────
email.post('/messages/:id/reply-all', emailSendRateLimit, async (c) => {
  const id = c.req.param('id');
  const userId = c.get('userId');
  const user = c.get('user') as { username?: string } | undefined;
  const body = await c.req.json().catch(() => ({})) as { body?: string; comment?: string };
  try {
    const res = await graphFetch(c.env, userId, `/me/messages/${encodeURIComponent(id)}/replyAll`, {
      method: 'POST',
      body: JSON.stringify({ comment: body.body || body.comment || '' }),
    });
    const ok = res.ok;
    await auditEmailAction(c.env, {
      userId, username: user?.username, action: 'reply_all',
      graphMessageId: id, status: ok ? 'sent' : 'failed',
      error: ok ? undefined : `Graph ${res.status}`,
    });
    if (!ok) return c.json({ success: false, error: `Graph ${res.status}` }, 502);
    return c.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed';
    await auditEmailAction(c.env, { userId, username: user?.username, action: 'reply_all', graphMessageId: id, status: 'failed', error: msg });
    return c.json({ success: false, error: msg }, 502);
  }
});

email.post('/messages/:id/forward', emailSendRateLimit, async (c) => {
  const id = c.req.param('id');
  const userId = c.get('userId');
  const user = c.get('user') as { username?: string } | undefined;
  const body = await c.req.json().catch(() => ({})) as { to?: string | string[]; body?: string; comment?: string };
  const toRecipients = parseAddrList(body.to);
  if (!toRecipients.length) return c.json({ error: 'At least one recipient required' }, 400);
  try {
    const res = await graphFetch(c.env, userId, `/me/messages/${encodeURIComponent(id)}/forward`, {
      method: 'POST',
      body: JSON.stringify({ comment: body.body || body.comment || '', toRecipients }),
    });
    const ok = res.ok;
    await auditEmailAction(c.env, {
      userId, username: user?.username, action: 'forward',
      toAddresses: toRecipients.map((r) => r.emailAddress.address),
      graphMessageId: id, status: ok ? 'sent' : 'failed',
      error: ok ? undefined : `Graph ${res.status}`,
    });
    if (!ok) return c.json({ success: false, error: `Graph ${res.status}` }, 502);
    return c.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed';
    await auditEmailAction(c.env, {
      userId, username: user?.username, action: 'forward',
      toAddresses: toRecipients.map((r) => r.emailAddress.address),
      graphMessageId: id, status: 'failed', error: msg,
    });
    return c.json({ success: false, error: msg }, 502);
  }
});

// ─── Batch operations (bulk toolbar) ─────────────────────────────
// Graph has no true batch message API on v1.0 for these verbs, so we
// fan out sequentially (selection is capped at the visible page, ≤100).
email.post('/messages/batch', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json().catch(() => ({})) as {
    action?: 'delete' | 'archive' | 'junk' | 'markRead' | 'markUnread' | 'flag' | 'unflag' | 'move';
    ids?: string[]; folderId?: string; categories?: string[];
  };
  const ids = (body.ids || []).slice(0, 100);
  if (!ids.length || !body.action) return c.json({ error: 'action and ids required' }, 400);
  let ok = 0; let failed = 0;
  for (const id of ids) {
    try {
      let res: Response;
      switch (body.action) {
        case 'delete':
          res = await graphFetch(c.env, userId, `/me/messages/${encodeURIComponent(id)}`, { method: 'DELETE' });
          break;
        case 'archive':
        case 'junk':
        case 'move': {
          const dest = body.action === 'archive' ? 'archive' : body.action === 'junk' ? 'junkemail' : body.folderId;
          if (!dest) { failed++; continue; }
          res = await graphFetch(c.env, userId, `/me/messages/${encodeURIComponent(id)}/move`, {
            method: 'POST', body: JSON.stringify({ destinationId: dest }),
          });
          break;
        }
        case 'markRead':
        case 'markUnread':
          res = await graphFetch(c.env, userId, `/me/messages/${encodeURIComponent(id)}`, {
            method: 'PATCH', body: JSON.stringify({ isRead: body.action === 'markRead' }),
          });
          break;
        case 'flag':
        case 'unflag':
          res = await graphFetch(c.env, userId, `/me/messages/${encodeURIComponent(id)}`, {
            method: 'PATCH', body: JSON.stringify({ flag: { flagStatus: body.action === 'flag' ? 'flagged' : 'notFlagged' } }),
          });
          break;
        default: failed++; continue;
      }
      if (res.ok || res.status === 404) ok++; else failed++;
    } catch { failed++; }
  }
  return c.json({ success: failed === 0, ok, failed });
});

// ─── Mark all read in a folder ───────────────────────────────────
email.post('/messages/mark-all-read', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json().catch(() => ({})) as { folder?: string };
  const folder = body.folder || 'inbox';
  try {
    let marked = 0;
    // Page through unread messages (cap 5 pages × 50 to bound Worker time)
    for (let i = 0; i < 5; i++) {
      const res = await graphFetch(c.env, userId, `/me/mailFolders/${encodeURIComponent(folder)}/messages?$filter=isRead eq false&$select=id&$top=50`);
      if (!res.ok) break;
      const data = await res.json() as { value?: Array<{ id: string }> };
      const items = data.value || [];
      if (!items.length) break;
      for (const m of items) {
        const r = await graphFetch(c.env, userId, `/me/messages/${encodeURIComponent(m.id)}`, {
          method: 'PATCH', body: JSON.stringify({ isRead: true }),
        });
        if (r.ok) marked++;
      }
      if (items.length < 50) break;
    }
    return c.json({ success: true, marked });
  } catch (err: unknown) {
    return c.json({ success: false, error: err instanceof Error ? err.message : 'Failed' }, 502);
  }
});

// ─── Folder CRUD + empty ─────────────────────────────────────────
email.post('/folders', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json().catch(() => ({})) as { displayName?: string; parentFolderId?: string };
  if (!body.displayName?.trim()) return c.json({ error: 'displayName required' }, 400);
  try {
    const path = body.parentFolderId
      ? `/me/mailFolders/${encodeURIComponent(body.parentFolderId)}/childFolders`
      : '/me/mailFolders';
    const res = await graphFetch(c.env, userId, path, {
      method: 'POST', body: JSON.stringify({ displayName: body.displayName.trim() }),
    });
    if (!res.ok) return c.json({ success: false, error: `Graph ${res.status}` }, 502);
    return c.json({ success: true, folder: await res.json() });
  } catch (err: unknown) {
    return c.json({ success: false, error: err instanceof Error ? err.message : 'Failed' }, 502);
  }
});

email.patch('/folders/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({})) as { displayName?: string };
  if (!body.displayName?.trim()) return c.json({ error: 'displayName required' }, 400);
  try {
    const res = await graphFetch(c.env, userId, `/me/mailFolders/${encodeURIComponent(id)}`, {
      method: 'PATCH', body: JSON.stringify({ displayName: body.displayName.trim() }),
    });
    if (!res.ok) return c.json({ success: false, error: `Graph ${res.status}` }, 502);
    return c.json({ success: true });
  } catch (err: unknown) {
    return c.json({ success: false, error: err instanceof Error ? err.message : 'Failed' }, 502);
  }
});

email.delete('/folders/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  try {
    const res = await graphFetch(c.env, userId, `/me/mailFolders/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) return c.json({ success: false, error: `Graph ${res.status}` }, 502);
    return c.json({ success: true });
  } catch (err: unknown) {
    return c.json({ success: false, error: err instanceof Error ? err.message : 'Failed' }, 502);
  }
});

// Empty a folder (Deleted Items / Junk). Pages deletes; bounded.
email.post('/folders/:id/empty', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  try {
    let deleted = 0;
    for (let i = 0; i < 5; i++) {
      const res = await graphFetch(c.env, userId, `/me/mailFolders/${encodeURIComponent(id)}/messages?$select=id&$top=50`);
      if (!res.ok) break;
      const data = await res.json() as { value?: Array<{ id: string }> };
      const items = data.value || [];
      if (!items.length) break;
      for (const m of items) {
        const r = await graphFetch(c.env, userId, `/me/messages/${encodeURIComponent(m.id)}`, { method: 'DELETE' });
        if (r.ok || r.status === 404) deleted++;
      }
      if (items.length < 50) break;
    }
    return c.json({ success: true, deleted });
  } catch (err: unknown) {
    return c.json({ success: false, error: err instanceof Error ? err.message : 'Failed' }, 502);
  }
});

// ─── Drafts (Graph-native, replaces localStorage-only drafts) ────
email.post('/drafts', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json().catch(() => ({})) as {
    to?: string | string[]; cc?: string | string[]; bcc?: string | string[];
    subject?: string; body?: string; isHtml?: boolean; attachments?: SendAttachment[]; importance?: string;
  };
  const attachments = mapAttachments(body.attachments);
  try {
    const res = await graphFetch(c.env, userId, '/me/messages', {
      method: 'POST',
      body: JSON.stringify({
        subject: body.subject || '',
        body: { contentType: body.isHtml === false ? 'Text' : 'HTML', content: body.body || '' },
        toRecipients: parseAddrList(body.to),
        ccRecipients: parseAddrList(body.cc),
        bccRecipients: parseAddrList(body.bcc),
        ...(attachments.length ? { attachments } : {}),
        importance: ['low', 'normal', 'high'].includes(body.importance || '') ? body.importance : 'normal',
      }),
    });
    if (!res.ok) return c.json({ success: false, error: `Graph ${res.status}` }, 502);
    const draft = await res.json() as { id?: string };
    return c.json({ success: true, id: draft.id });
  } catch (err: unknown) {
    return c.json({ success: false, error: err instanceof Error ? err.message : 'Failed' }, 502);
  }
});

email.patch('/drafts/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({})) as {
    to?: string | string[]; cc?: string | string[]; bcc?: string | string[];
    subject?: string; body?: string; isHtml?: boolean;
  };
  const patch: Record<string, unknown> = {};
  if (body.subject !== undefined) patch.subject = body.subject;
  if (body.body !== undefined) patch.body = { contentType: body.isHtml === false ? 'Text' : 'HTML', content: body.body };
  if (body.to !== undefined) patch.toRecipients = parseAddrList(body.to);
  if (body.cc !== undefined) patch.ccRecipients = parseAddrList(body.cc);
  if (body.bcc !== undefined) patch.bccRecipients = parseAddrList(body.bcc);
  if (!Object.keys(patch).length) return c.json({ success: true });
  try {
    const res = await graphFetch(c.env, userId, `/me/messages/${encodeURIComponent(id)}`, {
      method: 'PATCH', body: JSON.stringify(patch),
    });
    if (!res.ok) return c.json({ success: false, error: `Graph ${res.status}` }, 502);
    return c.json({ success: true });
  } catch (err: unknown) {
    return c.json({ success: false, error: err instanceof Error ? err.message : 'Failed' }, 502);
  }
});

email.post('/drafts/:id/send', emailSendRateLimit, async (c) => {
  const userId = c.get('userId');
  const user = c.get('user') as { username?: string } | undefined;
  const id = c.req.param('id');
  try {
    const res = await graphFetch(c.env, userId, `/me/messages/${encodeURIComponent(id)}/send`, { method: 'POST' });
    if (!res.ok) {
      const msg = `Graph ${res.status}`;
      await auditEmailAction(c.env, { userId, username: user?.username, action: 'send', graphMessageId: id, status: 'failed', error: msg });
      return c.json({ success: false, error: msg }, 502);
    }
    await auditEmailAction(c.env, { userId, username: user?.username, action: 'send', graphMessageId: id, status: 'sent' });
    return c.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed';
    await auditEmailAction(c.env, { userId, username: user?.username, action: 'send', graphMessageId: id, status: 'failed', error: msg }).catch(() => {});
    return c.json({ success: false, error: msg }, 502);
  }
});

// ─── Conversation thread view ────────────────────────────────────
email.get('/conversations/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  try {
    const params = new URLSearchParams();
    params.set('$filter', `conversationId eq '${id.replace(/'/g, "''")}'`);
    params.set('$select', 'id,conversationId,subject,from,toRecipients,ccRecipients,bodyPreview,hasAttachments,isRead,flag,importance,receivedDateTime,sentDateTime');
    params.set('$top', '50');
    const res = await graphFetch(c.env, userId, `/me/messages?${params.toString()}`);
    if (!res.ok) return c.json({ messages: [] });
    const data = await res.json() as { value?: Record<string, unknown>[] };
    const messages = (data.value || []).map(mapMessage)
      .sort((a, b) => String(a.receivedAt || '').localeCompare(String(b.receivedAt || '')));
    return c.json({ messages });
  } catch {
    return c.json({ messages: [] });
  }
});

// Threads list — groups the folder's latest page by conversationId.
// Consumed by EmailPage's thread view mode.
email.get('/threads', async (c) => {
  const userId = c.get('userId');
  const folder = c.req.query('folder') || 'inbox';
  const perPage = Math.max(1, Math.min(100, parseInt(c.req.query('per_page') || '25', 10) || 25));
  try {
    const params = new URLSearchParams();
    params.set('$select', 'id,conversationId,subject,from,toRecipients,ccRecipients,bodyPreview,hasAttachments,isRead,flag,importance,receivedDateTime,sentDateTime');
    params.set('$orderby', 'receivedDateTime desc');
    params.set('$top', String(Math.min(100, perPage * 3)));
    const res = await graphFetch(c.env, userId, `/me/mailFolders/${encodeURIComponent(folder)}/messages?${params.toString()}`);
    if (!res.ok) return c.json({ threads: [], hasMore: false });
    const data = await res.json() as { value?: Record<string, unknown>[] };
    const byConv = new Map<string, { latest: Record<string, unknown>; count: number; unread: number }>();
    for (const raw of data.value || []) {
      const m = mapMessage(raw);
      const key = String(m.conversationId || m.id);
      const cur = byConv.get(key);
      if (!cur) byConv.set(key, { latest: m, count: 1, unread: m.isRead ? 0 : 1 });
      else { cur.count++; if (!m.isRead) cur.unread++; }
    }
    const threads = [...byConv.values()].slice(0, perPage)
      .map((t) => ({ ...t.latest, threadCount: t.count, threadUnread: t.unread }));
    return c.json({ threads, hasMore: byConv.size > perPage });
  } catch {
    return c.json({ threads: [], hasMore: false });
  }
});

// ─── Message internet headers + raw MIME (.eml export) ──────────
email.get('/messages/:id/headers', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  try {
    const res = await graphFetch(c.env, userId, `/me/messages/${encodeURIComponent(id)}?$select=internetMessageId,internetMessageHeaders`);
    if (!res.ok) return c.json({ headers: [] });
    const data = await res.json() as { internetMessageId?: string; internetMessageHeaders?: Array<{ name: string; value: string }> };
    return c.json({ internetMessageId: data.internetMessageId || '', headers: data.internetMessageHeaders || [] });
  } catch {
    return c.json({ headers: [] });
  }
});

email.get('/messages/:id/raw', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  try {
    const res = await graphFetch(c.env, userId, `/me/messages/${encodeURIComponent(id)}/$value`);
    if (!res.ok) return c.json({ error: `Graph ${res.status}` }, 502);
    return new Response(res.body, {
      headers: {
        'Content-Type': 'message/rfc822',
        'Content-Disposition': `attachment; filename="message-${id.slice(0, 12).replace(/[^a-zA-Z0-9]/g, '')}.eml"`,
        'Cache-Control': 'private, max-age=300',
      },
    });
  } catch (err: unknown) {
    return c.json({ error: err instanceof Error ? err.message : 'Failed' }, 502);
  }
});

// ─── Categories (Outlook master categories + per-message assign) ─
email.get('/categories', async (c) => {
  const userId = c.get('userId');
  try {
    const res = await graphFetch(c.env, userId, '/me/outlook/masterCategories?$top=50');
    if (!res.ok) return c.json({ categories: [] });
    const data = await res.json() as { value?: Array<{ id: string; displayName: string; color: string }> };
    return c.json({ categories: data.value || [] });
  } catch {
    return c.json({ categories: [] });
  }
});

email.post('/categories', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json().catch(() => ({})) as { displayName?: string; color?: string };
  if (!body.displayName?.trim()) return c.json({ error: 'displayName required' }, 400);
  try {
    const res = await graphFetch(c.env, userId, '/me/outlook/masterCategories', {
      method: 'POST',
      body: JSON.stringify({ displayName: body.displayName.trim(), color: body.color || 'preset0' }),
    });
    if (!res.ok) return c.json({ success: false, error: `Graph ${res.status}` }, 502);
    return c.json({ success: true, category: await res.json() });
  } catch (err: unknown) {
    return c.json({ success: false, error: err instanceof Error ? err.message : 'Failed' }, 502);
  }
});

email.delete('/categories/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  try {
    const res = await graphFetch(c.env, userId, `/me/outlook/masterCategories/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) return c.json({ success: false, error: `Graph ${res.status}` }, 502);
    return c.json({ success: true });
  } catch (err: unknown) {
    return c.json({ success: false, error: err instanceof Error ? err.message : 'Failed' }, 502);
  }
});

email.patch('/messages/:id/categories', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({})) as { categories?: string[] };
  try {
    const res = await graphFetch(c.env, userId, `/me/messages/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ categories: (body.categories || []).slice(0, 20) }),
    });
    if (!res.ok) return c.json({ success: false, error: `Graph ${res.status}` }, 502);
    return c.json({ success: true });
  } catch (err: unknown) {
    return c.json({ success: false, error: err instanceof Error ? err.message : 'Failed' }, 502);
  }
});

// ─── Auto-categorize (heuristic, over the cached D1 inbox) ──────
// Tags messages by sender/subject patterns. Consumed by the toolbar's
// "Auto-categorize" button — { processed, categorized }.
const AUTO_CATEGORY_RULES: Array<{ cat: string; re: RegExp }> = [
  { cat: 'Alerts', re: /alert|alarm|warning|urgent|panic|emergency/i },
  { cat: 'Reports', re: /report|summary|statistics|monthly|weekly|daily brief/i },
  { cat: 'Court', re: /court|subpoena|hearing|docket|citation|summons/i },
  { cat: 'HR', re: /payroll|timesheet|benefits|pto|leave request|schedule/i },
  { cat: 'Vendors', re: /invoice|receipt|order|billing|payment|quote/i },
  { cat: 'Newsletters', re: /newsletter|unsubscribe|digest|bulletin/i },
];

email.post('/categorize/batch', async (c) => {
  const userId = c.get('userId');
  const rows = await query<{ graph_id: string; subject: string | null; from_address: string | null; categories: string | null }>(
    c.env.DB,
    "SELECT graph_id, subject, from_address, categories FROM email_messages WHERE owner_user_id = ? AND (categories IS NULL OR categories = '[]') ORDER BY id DESC LIMIT 100",
    userId,
  );
  let categorized = 0;
  for (const r of rows) {
    const hay = `${r.subject || ''} ${r.from_address || ''}`;
    const cats = AUTO_CATEGORY_RULES.filter((rule) => rule.re.test(hay)).map((rule) => rule.cat);
    if (!cats.length) continue;
    try {
      await execute(
        c.env.DB,
        'UPDATE email_messages SET categories = ? WHERE owner_user_id = ? AND graph_id = ?',
        JSON.stringify(cats), userId, r.graph_id,
      );
      // Mirror to Graph (best-effort, fire-and-forget pattern not needed — small batch)
      await graphFetch(c.env, userId, `/me/messages/${encodeURIComponent(r.graph_id)}`, {
        method: 'PATCH', body: JSON.stringify({ categories: cats }),
      }).catch(() => null);
      categorized++;
    } catch { /* best-effort */ }
  }
  return c.json({ processed: rows.length, categorized });
});

// ─── Focused Inbox (Graph inferenceClassification) ───────────────
email.patch('/messages/:id/focused', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({})) as { focused?: boolean };
  try {
    const res = await graphFetch(c.env, userId, `/me/messages/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ inferenceClassification: body.focused === false ? 'other' : 'focused' }),
    });
    if (!res.ok) return c.json({ success: false, error: `Graph ${res.status}` }, 502);
    return c.json({ success: true });
  } catch (err: unknown) {
    return c.json({ success: false, error: err instanceof Error ? err.message : 'Failed' }, 502);
  }
});

// ─── Sweep (delete/archive everything from a sender in a folder) ─
email.post('/sweep', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json().catch(() => ({})) as {
    fromAddress?: string; folder?: string; action?: 'delete' | 'archive' | 'junk'; keepLatest?: boolean;
  };
  const from = (body.fromAddress || '').trim();
  if (!from || !/@/.test(from)) return c.json({ error: 'fromAddress required' }, 400);
  const folder = body.folder || 'inbox';
  const dest = body.action === 'archive' ? 'archive' : body.action === 'junk' ? 'junkemail' : null;
  try {
    const params = new URLSearchParams();
    params.set('$filter', `from/emailAddress/address eq '${from.replace(/'/g, "''")}'`);
    params.set('$select', 'id,receivedDateTime');
    params.set('$top', '100');
    const res = await graphFetch(c.env, userId, `/me/mailFolders/${encodeURIComponent(folder)}/messages?${params.toString()}`);
    if (!res.ok) return c.json({ success: false, error: `Graph ${res.status}` }, 502);
    const data = await res.json() as { value?: Array<{ id: string; receivedDateTime?: string }> };
    let items = (data.value || []).sort((a, b) => String(b.receivedDateTime || '').localeCompare(String(a.receivedDateTime || '')));
    if (body.keepLatest && items.length) items = items.slice(1);
    let swept = 0;
    for (const m of items) {
      const r = dest
        ? await graphFetch(c.env, userId, `/me/messages/${encodeURIComponent(m.id)}/move`, { method: 'POST', body: JSON.stringify({ destinationId: dest }) })
        : await graphFetch(c.env, userId, `/me/messages/${encodeURIComponent(m.id)}`, { method: 'DELETE' });
      if (r.ok || r.status === 404) swept++;
    }
    return c.json({ success: true, swept });
  } catch (err: unknown) {
    return c.json({ success: false, error: err instanceof Error ? err.message : 'Failed' }, 502);
  }
});

// ─── Block sender / report junk-phishing ─────────────────────────
email.post('/block-sender', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json().catch(() => ({})) as { address?: string; reason?: string; messageId?: string };
  const address = (body.address || '').trim().toLowerCase();
  if (!address || (!address.includes('@'))) return c.json({ error: 'address required' }, 400);
  try {
    await execute(
      c.env.DB,
      'INSERT OR IGNORE INTO email_blocked_senders (owner_user_id, address, reason) VALUES (?, ?, ?)',
      userId, address, body.reason || 'blocked',
    );
  } catch (err: unknown) {
    log.error('POST /block-sender failed', { src: 'src/routes/email.ts' }, err);
    return c.json({ success: false, error: err instanceof Error ? err.message : 'Failed' }, 500);
  }
  // Optionally junk the reported message right away.
  if (body.messageId) {
    await graphFetch(c.env, userId, `/me/messages/${encodeURIComponent(body.messageId)}/move`, {
      method: 'POST', body: JSON.stringify({ destinationId: 'junkemail' }),
    }).catch(() => null);
  }
  return c.json({ success: true });
});

email.get('/blocked-senders', async (c) => {
  const userId = c.get('userId');
  const rows = await query(
    c.env.DB,
    'SELECT id, address, reason, created_at FROM email_blocked_senders WHERE owner_user_id = ? ORDER BY id DESC LIMIT 200',
    userId,
  );
  return c.json({ blocked: rows });
});

email.delete('/blocked-senders/:id', async (c) => {
  const userId = c.get('userId');
  await execute(c.env.DB, 'DELETE FROM email_blocked_senders WHERE id = ? AND owner_user_id = ?', parseInt(c.req.param('id'), 10), userId);
  return c.json({ success: true });
});

// ─── Snooze ──────────────────────────────────────────────────────
// Outlook-style: message moves out of the inbox (archive) until the
// snooze expires, then the cron moves it back + marks unread.
email.post('/messages/:id/snooze', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({})) as { until?: string };
  if (!body.until) return c.json({ error: 'until (ISO datetime) required' }, 400);
  // Always store UTC: parse the ISO string (offset-aware) and emit UTC.
  const untilDate = new Date(body.until);
  if (isNaN(untilDate.getTime())) return c.json({ error: 'until must be a valid ISO datetime' }, 400);
  const until = untilDate.toISOString().replace('T', ' ').slice(0, 19);
  try {
    const res = await graphFetch(c.env, userId, `/me/messages/${encodeURIComponent(id)}/move`, {
      method: 'POST', body: JSON.stringify({ destinationId: 'archive' }),
    });
    if (!res.ok) return c.json({ success: false, error: `Graph ${res.status}` }, 502);
    // Graph move RE-IDs the message — store the new id for the resurface.
    const moved = await res.json().catch(() => null) as { id?: string } | null;
    const newId = moved?.id || id;
    await execute(
      c.env.DB,
      `INSERT INTO email_snoozes (owner_user_id, message_graph_id, original_folder, snooze_until, status)
       VALUES (?, ?, 'inbox', ?, 'snoozed')
       ON CONFLICT(owner_user_id, message_graph_id) DO UPDATE SET snooze_until = excluded.snooze_until, status = 'snoozed'`,
      userId, newId, until,
    );
    return c.json({ success: true, newId });
  } catch (err: unknown) {
    return c.json({ success: false, error: err instanceof Error ? err.message : 'Failed' }, 502);
  }
});

email.get('/snoozed', async (c) => {
  const userId = c.get('userId');
  const rows = await query(
    c.env.DB,
    "SELECT id, message_graph_id, snooze_until, created_at FROM email_snoozes WHERE owner_user_id = ? AND status = 'snoozed' ORDER BY snooze_until ASC LIMIT 100",
    userId,
  );
  return c.json({ snoozed: rows });
});

email.delete('/snoozed/:id', async (c) => {
  const userId = c.get('userId');
  await execute(c.env.DB, "UPDATE email_snoozes SET status = 'cancelled' WHERE id = ? AND owner_user_id = ?", parseInt(c.req.param('id'), 10), userId);
  return c.json({ success: true });
});

// Cron: move expired snoozes back to the inbox, mark unread.
export async function resurfaceSnoozedEmails(env: Bindings): Promise<number> {
  const rows = await query<{ id: number; message_graph_id: string; original_folder: string; owner_user_id: number }>(
    env.DB,
    "SELECT id, message_graph_id, original_folder, owner_user_id FROM email_snoozes WHERE status = 'snoozed' AND snooze_until <= datetime(\'now\') LIMIT 20",
  ).catch(() => [] as Array<{ id: number; message_graph_id: string; original_folder: string; owner_user_id: number }>);
  let resurfaced = 0;
  for (const r of rows) {
    try {
      const res = await graphFetch(env, r.owner_user_id, `/me/messages/${encodeURIComponent(r.message_graph_id)}/move`, {
        method: 'POST', body: JSON.stringify({ destinationId: r.original_folder || 'inbox' }),
      });
      if (res.ok) {
        const moved = await res.json().catch(() => null) as { id?: string } | null;
        if (moved?.id) {
          await graphFetch(env, r.owner_user_id, `/me/messages/${encodeURIComponent(moved.id)}`, {
            method: 'PATCH', body: JSON.stringify({ isRead: false }),
          }).catch(() => null);
        }
        await execute(env.DB, "UPDATE email_snoozes SET status = 'resurfaced' WHERE id = ?", r.id);
        resurfaced++;
      } else if (res.status === 404) {
        log.warn('resurfaceSnoozedEmails: message 404 on move (deleted by retention/user), dismissing snooze', { userId: r.owner_user_id, messageId: r.message_graph_id });
        await execute(env.DB, "UPDATE email_snoozes SET status = 'resurfaced' WHERE id = ?", r.id);
      }
    } catch { /* retry next minute */ }
  }
  return resurfaced;
}

// ─── Templates CRUD (TemplatePicker has shipped client-side) ─────
email.get('/templates', async (c) => {
  const userId = c.get('userId');
  const rows = await query(
    c.env.DB,
    'SELECT id, name, category, subject, body, is_system FROM email_templates WHERE owner_user_id IS NULL OR owner_user_id = ? ORDER BY is_system DESC, name ASC LIMIT 200',
    userId,
  ).catch(() => []);
  return c.json(rows);
});

email.post('/templates', async (c) => {
  const userId = c.get('userId');
  const userRole = (c.get('user') as { role?: string } | undefined)?.role;
  const body = await c.req.json().catch(() => ({})) as { name?: string; category?: string; subject?: string; body?: string; shared?: boolean };
  if (!body.name?.trim()) return c.json({ error: 'name required' }, 400);
  // Only admins and managers can create org-wide shared templates.
  if (body.shared && !['admin', 'manager'].includes(userRole ?? '')) {
    return c.json({ error: 'Insufficient role to create shared template' }, 403);
  }
  const r = await execute(
    c.env.DB,
    'INSERT INTO email_templates (owner_user_id, name, category, subject, body) VALUES (?, ?, ?, ?, ?)',
    body.shared ? null : userId, body.name.trim(), body.category || 'general', body.subject || '', body.body || '',
  );
  return c.json({ success: true, id: r.meta.last_row_id });
});

email.put('/templates/:id', async (c) => {
  const userId = c.get('userId');
  const id = parseInt(c.req.param('id'), 10);
  const body = await c.req.json().catch(() => ({})) as { name?: string; category?: string; subject?: string; body?: string };
  const sets: string[] = []; const vals: unknown[] = [];
  if (body.name !== undefined) { sets.push('name = ?'); vals.push(body.name); }
  if (body.category !== undefined) { sets.push('category = ?'); vals.push(body.category); }
  if (body.subject !== undefined) { sets.push('subject = ?'); vals.push(body.subject); }
  if (body.body !== undefined) { sets.push('body = ?'); vals.push(body.body); }
  if (!sets.length) return c.json({ success: true });
  sets.push("updated_at = datetime('now')");
  vals.push(id, userId);
  await execute(c.env.DB, `UPDATE email_templates SET ${sets.join(', ')} WHERE id = ? AND (owner_user_id IS NULL OR owner_user_id = ?) AND is_system = 0`, ...vals);
  return c.json({ success: true });
});

email.delete('/templates/:id', async (c) => {
  const userId = c.get('userId');
  await execute(c.env.DB, 'DELETE FROM email_templates WHERE id = ? AND owner_user_id = ? AND is_system = 0', parseInt(c.req.param('id'), 10), userId);
  return c.json({ success: true });
});

// ─── Schedule send (queue in D1, cron drains) ────────────────────
email.post('/schedule', emailSendRateLimit, async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json().catch(() => ({})) as {
    to?: string | string[]; cc?: string | string[]; bcc?: string | string[];
    subject?: string; body?: string; isHtml?: boolean; scheduledAt?: string;
    attachments?: SendAttachment[]; importance?: string;
  };
  const to = parseAddrList(body.to).map((r) => r.emailAddress.address);
  if (!to.length) return c.json({ error: 'At least one recipient required' }, 400);
  if (!body.scheduledAt) return c.json({ error: 'scheduledAt required' }, 400);
  const attBytes = totalAttachmentBytes(body.attachments);
  if (attBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
    return c.json({
      error: `Attachments total ${(attBytes / 1024 / 1024).toFixed(1)}MB, max ${MAX_TOTAL_ATTACHMENT_BYTES / 1024 / 1024}MB per message`,
      code: 'ATTACHMENTS_TOO_LARGE',
    }, 413);
  }
  // Always store UTC: parse the ISO string (offset-aware) and emit UTC.
  const whenDate = new Date(body.scheduledAt);
  if (isNaN(whenDate.getTime())) return c.json({ error: 'scheduledAt must be a valid ISO datetime' }, 400);
  const when = whenDate.toISOString().replace('T', ' ').slice(0, 19);
  const cc = parseAddrList(body.cc).map((r) => r.emailAddress.address);
  const bcc = parseAddrList(body.bcc).map((r) => r.emailAddress.address);
  const encryptedTo = await encryptField(c.env, JSON.stringify(to));
  const encryptedCc = cc.length ? await encryptField(c.env, JSON.stringify(cc)) : null;
  const encryptedBcc = bcc.length ? await encryptField(c.env, JSON.stringify(bcc)) : null;
  const encryptedBody = await encryptField(c.env, body.body || '');
  const r = await execute(
    c.env.DB,
    `INSERT INTO email_scheduled (owner_user_id, to_addresses, cc_addresses, bcc_addresses, subject, body, is_html, importance, attachments, scheduled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    userId, encryptedTo, encryptedCc, encryptedBcc,
    body.subject || '', encryptedBody, body.isHtml === false ? 0 : 1,
    ['low', 'normal', 'high'].includes(body.importance || '') ? body.importance : 'normal',
    body.attachments?.length ? JSON.stringify(body.attachments.slice(0, 20)) : null,
    when,
  );
  return c.json({ success: true, id: r.meta.last_row_id });
});

email.get('/scheduled', async (c) => {
  const userId = c.get('userId');
  const rows = await query<{ id: number; to_addresses: string; subject: string; scheduled_at: string; status: string; created_at: string }>(
    c.env.DB,
    "SELECT id, to_addresses, subject, scheduled_at, status, created_at FROM email_scheduled WHERE owner_user_id = ? AND status != 'cancelled' ORDER BY scheduled_at ASC LIMIT 100",
    userId,
  ).catch(() => []);
  const decrypted = await Promise.all(rows.map(async (row) => ({
    ...row,
    to_addresses: await decryptFieldIfEncrypted(c.env, row.to_addresses),
  })));
  return c.json(decrypted);
});

email.delete('/scheduled/:id', async (c) => {
  const userId = c.get('userId');
  await execute(
    c.env.DB,
    "UPDATE email_scheduled SET status = 'cancelled' WHERE id = ? AND owner_user_id = ? AND status = 'pending'",
    parseInt(c.req.param('id'), 10), userId,
  );
  return c.json({ success: true });
});

// Cron: send due scheduled emails through the same durable-outbox path.
export async function drainScheduledEmails(env: Bindings): Promise<number> {
  const rows = await query<{
    id: number; owner_user_id: number; to_addresses: string; cc_addresses: string | null;
    bcc_addresses: string | null; subject: string; body: string; is_html: number;
    importance: string; attachments: string | null;
  }>(
    env.DB,
    "SELECT id, owner_user_id, to_addresses, cc_addresses, bcc_addresses, subject, body, is_html, importance, attachments FROM email_scheduled WHERE status = 'pending' AND scheduled_at <= datetime(\'now\') LIMIT 10",
  ).catch(() => [] as never[]);
  let queued = 0;
  for (const r of rows) {
    try {
      const decryptedBody = await decryptFieldIfEncrypted(env, r.body);
      const decryptedTo = await decryptFieldIfEncrypted(env, r.to_addresses);
      const decryptedCc = r.cc_addresses ? await decryptFieldIfEncrypted(env, r.cc_addresses) : null;
      const decryptedBcc = r.bcc_addresses ? await decryptFieldIfEncrypted(env, r.bcc_addresses) : null;
      const parse = (s: string | null): string[] => { try { return s ? JSON.parse(s) : []; } catch { return []; } };
      const atts = ((): SendAttachment[] => { try { return r.attachments ? JSON.parse(r.attachments) : []; } catch { return []; } })();
      const attachments = mapAttachments(atts);
      const payload = {
        message: {
          subject: r.subject || '(no subject)',
          body: { contentType: r.is_html ? 'HTML' : 'Text', content: decryptedBody || '' },
          toRecipients: parseAddrList(parse(decryptedTo)),
          ccRecipients: parseAddrList(parse(decryptedCc)),
          bccRecipients: parseAddrList(parse(decryptedBcc)),
          ...(attachments.length ? { attachments } : {}),
          importance: r.importance || 'normal',
        },
        saveToSentItems: true,
      };
      // Reuse the durable outbox so retries/backoff are uniform.
      await execute(
        env.DB,
        "INSERT INTO email_outbox (owner_user_id, payload, status) VALUES (?, ?, 'pending')",
        r.owner_user_id, JSON.stringify(payload),
      );
      await execute(env.DB, "UPDATE email_scheduled SET status = 'sent', sent_at = datetime(\'now\') WHERE id = ?", r.id);
      queued++;
    } catch (err: unknown) {
      if (err instanceof EmailFieldEncryptionError) {
        // KEK unset/bad — this is our failure, not the row's. Leave it
        // pending so the next cron tick retries once the KEK is fixed,
        // rather than permanently destroying a scheduled send.
        log.error('drainScheduledEmails: KEK failure, leaving row pending for retry', { id: r.id }, err);
        await execute(
          env.DB,
          "UPDATE email_scheduled SET status = 'pending' WHERE id = ?",
          r.id,
        ).catch(() => null);
        continue;
      }
      await execute(
        env.DB,
        "UPDATE email_scheduled SET status = 'failed', last_error = ? WHERE id = ?",
        err instanceof Error ? err.message : 'enqueue failed', r.id,
      ).catch(() => null);
    }
  }
  return queued;
}

// ─── Automatic replies (Out of Office) ───────────────────────────
email.get('/settings/auto-reply', async (c) => {
  const userId = c.get('userId');
  try {
    const res = await graphFetch(c.env, userId, '/me/mailboxSettings/automaticRepliesSetting');
    if (!res.ok) return c.json({ status: 'disabled' });
    return c.json(await res.json());
  } catch {
    return c.json({ status: 'disabled' });
  }
});

email.put('/settings/auto-reply', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json().catch(() => ({})) as {
    status?: 'disabled' | 'alwaysEnabled' | 'scheduled';
    internalReplyMessage?: string; externalReplyMessage?: string;
    scheduledStartDateTime?: string; scheduledEndDateTime?: string;
  };
  const setting: Record<string, unknown> = {
    status: body.status || 'disabled',
    internalReplyMessage: body.internalReplyMessage || '',
    externalReplyMessage: body.externalReplyMessage || body.internalReplyMessage || '',
    externalAudience: 'all',
  };
  if (body.status === 'scheduled' && body.scheduledStartDateTime && body.scheduledEndDateTime) {
    setting.scheduledStartDateTime = { dateTime: body.scheduledStartDateTime, timeZone: 'America/Denver' };
    setting.scheduledEndDateTime = { dateTime: body.scheduledEndDateTime, timeZone: 'America/Denver' };
  }
  try {
    const res = await graphFetch(c.env, userId, '/me/mailboxSettings', {
      method: 'PATCH',
      body: JSON.stringify({ automaticRepliesSetting: setting }),
    });
    if (!res.ok) return c.json({ success: false, error: `Graph ${res.status}` }, 502);
    return c.json({ success: true });
  } catch (err: unknown) {
    return c.json({ success: false, error: err instanceof Error ? err.message : 'Failed' }, 502);
  }
});

// ─── Mailbox settings (timezone, working hours) ──────────────────
email.get('/settings/mailbox', async (c) => {
  const userId = c.get('userId');
  try {
    const res = await graphFetch(c.env, userId, '/me/mailboxSettings?$select=timeZone,workingHours,dateFormat,timeFormat');
    if (!res.ok) return c.json({});
    return c.json(await res.json());
  } catch {
    return c.json({});
  }
});

// ─── People autocomplete (Graph relevance-ranked contacts) ───────
email.get('/people', async (c) => {
  const userId = c.get('userId');
  const q = (c.req.query('q') || '').trim();
  try {
    const params = new URLSearchParams();
    params.set('$select', 'displayName,scoredEmailAddresses');
    params.set('$top', '10');
    if (q) params.set('$search', `"${q.replace(/"/g, '')}"`);
    const res = await graphFetch(c.env, userId, `/me/people?${params.toString()}`);
    if (!res.ok) return c.json({ people: [] });
    const data = await res.json() as { value?: Array<{ displayName?: string; scoredEmailAddresses?: Array<{ address?: string }> }> };
    const people = (data.value || [])
      .map((p) => ({ name: p.displayName || '', email: p.scoredEmailAddresses?.[0]?.address || '' }))
      .filter((p) => p.email);
    return c.json({ people });
  } catch {
    return c.json({ people: [] });
  }
});

// ─── Contact autocomplete (compose To/Cc/Bcc) ────────────────────
// Graph /me/people first (relevance-ranked), padded with distinct
// senders from the local cache so it works even if Graph is slow/down.
email.get('/contacts/search', async (c) => {
  const userId = c.get('userId');
  const q = (c.req.query('q') || '').trim();
  if (q.length < 2) return c.json([]);
  const out: Array<{ email: string; name: string; source: string }> = [];
  const seen = new Set<string>();
  try {
    const params = new URLSearchParams({ $select: 'displayName,scoredEmailAddresses', $top: '8' });
    params.set('$search', `"${q.replace(/"/g, '')}"`);
    const res = await graphFetch(c.env, userId, `/me/people?${params.toString()}`);
    if (res.ok) {
      const data = await res.json() as { value?: Array<{ displayName?: string; scoredEmailAddresses?: Array<{ address?: string }> }> };
      for (const p of data.value || []) {
        const addr = (p.scoredEmailAddresses?.[0]?.address || '').toLowerCase();
        if (!addr || seen.has(addr)) continue;
        seen.add(addr);
        out.push({ email: addr, name: p.displayName || '', source: 'directory' });
      }
    }
  } catch { /* fall through to cache */ }
  try {
    const like = buildSearchLikePattern(q);
    const rows = await query<{ from_address: string; from_name: string | null }>(
      c.env.DB,
      `SELECT from_address, MAX(from_name) AS from_name FROM email_messages
        WHERE owner_user_id = ? AND from_address IS NOT NULL
          AND (from_address LIKE ? OR from_name LIKE ?)
        GROUP BY from_address LIMIT 8`,
      userId, like, like,
    );
    for (const r of rows) {
      const addr = (r.from_address || '').toLowerCase();
      if (!addr || seen.has(addr)) continue;
      seen.add(addr);
      out.push({ email: addr, name: r.from_name || '', source: 'recent' });
    }
  } catch { /* best-effort */ }
  return c.json(out.slice(0, 10));
});

// ─── Mailbox stats (storage panel: counts per well-known folder) ─
email.get('/mailbox-stats', async (c) => {
  const userId = c.get('userId');
  try {
    const res = await graphFetch(c.env, userId, '/me/mailFolders?$select=displayName,totalItemCount,unreadItemCount,sizeInBytes&$top=30');
    if (!res.ok) return c.json({ folders: [] });
    const data = await res.json() as { value?: unknown[] };
    return c.json({ folders: data.value || [] });
  } catch {
    return c.json({ folders: [] });
  }
});

export default email;

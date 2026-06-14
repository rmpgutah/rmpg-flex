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
import { getDb, queryFirst, query, execute, columnExists } from '../utils/db';
import {
  parseAddrList, mapAttachments, buildSendPayload,
  type SendAttachment, type SendInput,
} from '../utils/emailSend';
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
// PUBLIC: OAuth callback — Microsoft redirects here with ?code&state.
// MUST be declared BEFORE the auth middleware below.
// ═══════════════════════════════════════════════════════════════════
email.get('/oauth/callback', async (c) => {
  const url = new URL(c.req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const oauthErr = url.searchParams.get('error');
  if (oauthErr) {
    // This is a public endpoint — never reflect attacker-controllable text into
    // the redirect. Only pass through the standard OAuth error codes.
    const KNOWN_OAUTH_ERRORS = new Set([
      'access_denied', 'invalid_request', 'unauthorized_client', 'invalid_grant',
      'unsupported_response_type', 'invalid_scope', 'server_error', 'temporarily_unavailable',
    ]);
    const safeErr = KNOWN_OAUTH_ERRORS.has(oauthErr) ? oauthErr : 'oauth_error';
    return c.redirect(`/admin?tab=email&status=error&message=${encodeURIComponent(safeErr)}`);
  }
  if (!code || !state) return c.redirect('/admin?tab=email&status=error&message=Missing+code+or+state');

  // Verify CSRF state token — atomic compare-and-delete so a concurrent
  // replay of the same state can't pass between a SELECT and a DELETE.
  const consumed = await execute(
    c.env.DB,
    "DELETE FROM system_config WHERE config_key = ? AND config_value = ? AND category = 'integrations'",
    K.oauthState, state,
  );
  if (((consumed?.meta?.changes as number | undefined) ?? 0) === 0) {
    return c.redirect('/admin?tab=email&status=error&message=Invalid+state');
  }

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
// All routes require JWT EXCEPT /oauth/callback — Microsoft redirects
// the user's browser directly to it with ?code=...&state=..., so the
// request carries no Authorization header / no rmpg cookies. Auth-gating
// it would 401 every consent attempt. Hono's `email.use('*', mw)` runs
// the middleware on every matched route regardless of registration
// order, so we can't just register the callback first — we must
// explicitly skip auth on that path here.
email.use('*', async (c, next) => {
  const pathname = new URL(c.req.url).pathname;
  if (pathname === '/api/email/oauth/callback' || pathname.endsWith('/oauth/callback')) {
    return next();
  }
  return authMiddleware(c, next);
});

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

// ═══════════════════════════════════════════════════════════════════
// Phase 2 — Inbox read / send via Microsoft Graph
//
// All routes call Graph live with the tenant access token. We do not
// cache message bodies on Workers (no benefit on the request path; the
// authorized user has one mailbox, latency is dominated by Graph).
// Phase 3 will add a `email_messages` table + cron poller for offline
// + rule-engine support.
// ═══════════════════════════════════════════════════════════════════

async function graphFetch(env: Bindings, path: string, init: RequestInit = {}): Promise<Response> {
  const token = await ensureValidToken(env);
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
  try {
    const res = await graphFetch(c.env, '/me/mailFolders?$select=id,displayName,parentFolderId,totalItemCount,unreadItemCount,childFolderCount&$top=50');
    if (!res.ok) return c.json([]);
    const data = await res.json() as { value?: unknown[] };
    return c.json(data.value || []);
  } catch {
    return c.json([]);
  }
});

email.get('/folders/:id/children', async (c) => {
  const id = c.req.param('id');
  try {
    const res = await graphFetch(c.env, `/me/mailFolders/${encodeURIComponent(id)}/childFolders?$select=id,displayName,parentFolderId,totalItemCount,unreadItemCount,childFolderCount&$top=50`);
    if (!res.ok) return c.json([]);
    const data = await res.json() as { value?: unknown[] };
    return c.json(data.value || []);
  } catch {
    return c.json([]);
  }
});

// ─── Unread count ────────────────────────────────────────────────
email.get('/unread-count', async (c) => {
  try {
    const res = await graphFetch(c.env, '/me/mailFolders/inbox?$select=unreadItemCount');
    if (!res.ok) return c.json({ count: 0 });
    const data = await res.json() as { unreadItemCount?: number };
    return c.json({ count: data.unreadItemCount || 0 });
  } catch {
    return c.json({ count: 0 });
  }
});

// ─── Message list ────────────────────────────────────────────────
email.get('/messages', async (c) => {
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
  if (search) params.set('$search', `"${search.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
  try {
    const res = await graphFetch(
      c.env,
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
email.get('/messages/search', async (c) => {
  const userId = c.get('userId');
  const q = (c.req.query('q') || '').trim();
  if (q.length < 2) return c.json({ results: [] });
  const folder = (c.req.query('folder') || '').trim();
  const like = `%${q.replace(/[%_]/g, ' ')}%`;
  try {
    const params: unknown[] = [userId, like, like, like];
    let folderClause = '';
    if (folder && folder !== 'inbox') { folderClause = 'AND folder_id = ?'; params.push(folder); }
    const rows = await query(
      c.env.DB,
      `SELECT graph_id, conversation_id, subject, from_address, from_name, body_preview,
              has_attachments, is_read, is_flagged, importance, received_at
         FROM email_messages
        WHERE owner_user_id = ?
          AND (subject LIKE ? OR from_address LIKE ? OR body_preview LIKE ?)
          ${folderClause}
        ORDER BY received_at DESC
        LIMIT 50`,
      ...params,
    );
    return c.json({ results: rows });
  } catch {
    return c.json({ results: [] });
  }
});

// ─── Single message (full body, with CID image rewriting) ────────
email.get('/messages/:id', async (c) => {
  const id = c.req.param('id');
  try {
    const [msgRes, attsRes] = await Promise.all([
      graphFetch(c.env, `/me/messages/${encodeURIComponent(id)}?$select=id,conversationId,subject,from,toRecipients,ccRecipients,bodyPreview,body,hasAttachments,isRead,flag,importance,receivedDateTime,sentDateTime`),
      graphFetch(c.env, `/me/messages/${encodeURIComponent(id)}/attachments?$select=id,name,contentType,size,isInline,contentId`),
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
  const id = c.req.param('id');
  try {
    const res = await graphFetch(c.env, `/me/messages/${encodeURIComponent(id)}/attachments?$select=id,name,contentType,size,isInline,contentId`);
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
  const id = c.req.param('id');
  const aid = c.req.param('aid');
  const inline = c.req.query('inline') === '1';
  try {
    const res = await graphFetch(c.env, `/me/messages/${encodeURIComponent(id)}/attachments/${encodeURIComponent(aid)}`);
    if (!res.ok) return c.json({ error: 'Attachment not found' }, 404);
    const a = await res.json() as { name?: string; contentType?: string; contentBytes?: string };
    if (!a.contentBytes) return c.json({ error: 'Empty attachment' }, 404);
    const bin = atob(a.contentBytes);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const safeName = (a.name || 'attachment').replace(/[\r\n"]/g, '_');
    return new Response(bytes, {
      headers: {
        'Content-Type': a.contentType || 'application/octet-stream',
        'Content-Length': String(bytes.length),
        'Content-Disposition': inline ? `inline; filename="${safeName}"` : `attachment; filename="${safeName}"`,
        'Cache-Control': 'private, max-age=300',
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
    const ct = res.headers.get('Content-Type') || 'application/octet-stream';
    if (!ct.startsWith('image/')) return c.json({ error: 'not an image' }, 415);
    const len = res.headers.get('Content-Length');
    if (len && parseInt(len, 10) > 8 * 1024 * 1024) return c.json({ error: 'too large' }, 413);
    return new Response(res.body, {
      headers: {
        'Content-Type': ct,
        'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err: unknown) {
    return c.json({ error: err instanceof Error ? err.message : 'Failed' }, 502);
  }
});

// ─── Mark read / flag / move / delete ───────────────────────────
email.patch('/messages/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({})) as { isRead?: boolean; isFlagged?: boolean };
  const patch: Record<string, unknown> = {};
  if (body.isRead !== undefined) patch.isRead = !!body.isRead;
  if (body.isFlagged !== undefined) patch.flag = { flagStatus: body.isFlagged ? 'flagged' : 'notFlagged' };
  if (!Object.keys(patch).length) return c.json({ success: false, error: 'No fields to update' }, 400);
  try {
    const res = await graphFetch(c.env, `/me/messages/${encodeURIComponent(id)}`, {
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
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({})) as { folderId?: string };
  if (!body.folderId) return c.json({ error: 'folderId required' }, 400);
  try {
    const res = await graphFetch(c.env, `/me/messages/${encodeURIComponent(id)}/move`, {
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
  try {
    const res = await graphFetch(c.env, `/me/messages/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) return c.json({ success: false, error: `Graph ${res.status}` }, 502);
    return c.json({ success: true });
  } catch (err: unknown) {
    return c.json({ success: false, error: err instanceof Error ? err.message : 'Failed' }, 502);
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
    const res = await graphFetch(env, '/me/sendMail', { method: 'POST', body: json });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = `Graph ${res.status}: ${text.slice(0, 200)}`;
      await execute(env.DB,
        "UPDATE email_outbox SET attempts = 1, last_error = ?, next_attempt_at = datetime('now','localtime','+1 minute') WHERE id = ?",
        err, outboxId);
      return { outboxId, status: 'queued', error: err };
    }
    await execute(env.DB,
      "UPDATE email_outbox SET status = 'sent', sent_at = datetime('now','localtime') WHERE id = ?",
      outboxId);
    return { outboxId, status: 'sent' };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed';
    await execute(env.DB,
      "UPDATE email_outbox SET attempts = 1, last_error = ?, next_attempt_at = datetime('now','localtime','+1 minute') WHERE id = ?",
      msg, outboxId);
    return { outboxId, status: 'queued', error: msg };
  }
}

email.post('/send', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json().catch(() => ({})) as SendInput;
  if (!parseAddrList(body.to).length) return c.json({ error: 'At least one recipient required' }, 400);
  const payload = buildSendPayload(body);
  const r = await enqueueAndSend(c.env, userId, payload);
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

// Cron-drained: pop up-to-N pending rows whose next_attempt_at has
// passed, attempt Graph send, exponential-backoff on failure (1m → 5m
// → 30m → fail after 5 attempts). Exported for src/index.ts.
export async function drainEmailOutbox(env: Bindings): Promise<{ sent: number; failed: number; deferred: number }> {
  const refresh = await getCfgDecrypted(env, K.refreshToken);
  if (!refresh) return { sent: 0, failed: 0, deferred: 0 };

  const rows = await query<{ id: number; payload: string; attempts: number }>(
    env.DB,
    "SELECT id, payload, attempts FROM email_outbox WHERE status = 'pending' AND next_attempt_at <= datetime('now','localtime') ORDER BY id ASC LIMIT 10",
  );
  let sent = 0, failed = 0, deferred = 0;
  const BACKOFFS = ['+1 minute', '+5 minutes', '+30 minutes', '+2 hours', '+6 hours'];
  for (const r of rows) {
    try {
      const res = await graphFetch(env, '/me/sendMail', { method: 'POST', body: r.payload });
      if (res.ok) {
        await execute(env.DB, "UPDATE email_outbox SET status = 'sent', sent_at = datetime('now','localtime') WHERE id = ?", r.id);
        sent++;
        continue;
      }
      const text = await res.text().catch(() => '');
      const attempts = r.attempts + 1;
      const err = `Graph ${res.status}: ${text.slice(0, 200)}`;
      if (attempts >= BACKOFFS.length) {
        await execute(env.DB, "UPDATE email_outbox SET status = 'failed', attempts = ?, last_error = ? WHERE id = ?", attempts, err, r.id);
        failed++;
      } else {
        await execute(
          env.DB,
          `UPDATE email_outbox SET attempts = ?, last_error = ?, next_attempt_at = datetime('now','localtime','${BACKOFFS[attempts]}') WHERE id = ?`,
          attempts, err, r.id,
        );
        deferred++;
      }
    } catch (err: unknown) {
      const attempts = r.attempts + 1;
      const msg = err instanceof Error ? err.message : 'send failed';
      if (attempts >= BACKOFFS.length) {
        await execute(env.DB, "UPDATE email_outbox SET status = 'failed', attempts = ?, last_error = ? WHERE id = ?", attempts, msg, r.id);
        failed++;
      } else {
        await execute(
          env.DB,
          `UPDATE email_outbox SET attempts = ?, last_error = ?, next_attempt_at = datetime('now','localtime','${BACKOFFS[attempts]}') WHERE id = ?`,
          attempts, msg, r.id,
        );
        deferred++;
      }
    }
  }
  return { sent, failed, deferred };
}

email.post('/messages/:id/reply', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({})) as { body?: string; comment?: string };
  try {
    const res = await graphFetch(c.env, `/me/messages/${encodeURIComponent(id)}/reply`, {
      method: 'POST',
      body: JSON.stringify({ comment: body.body || body.comment || '' }),
    });
    if (!res.ok) return c.json({ success: false, error: `Graph ${res.status}` }, 502);
    return c.json({ success: true });
  } catch (err: unknown) {
    return c.json({ success: false, error: err instanceof Error ? err.message : 'Failed' }, 502);
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
      "INSERT INTO system_config (config_key, config_value, category, sort_order, is_active, created_at, updated_at) VALUES (?, ?, 'email', 0, 1, datetime('now','localtime'), datetime('now','localtime'))",
      key,
      sig,
    );
  }
  return c.json({ success: true });
});

// ─── sync-now (real: counts inbox, stamps lastSync) ──────────────
email.post('/admin/sync-now', requireRole('admin'), async (c) => {
  try {
    const res = await graphFetch(c.env, '/me/mailFolders/inbox?$select=totalItemCount,unreadItemCount');
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
    const placeholders = cands.map(() => '?').join(',');
    const hits = await query<{ id: number; plate_number: string }>(
      db,
      `SELECT id, plate_number FROM vehicles_records WHERE plate_number IN (${placeholders}) LIMIT 50`,
      ...cands,
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

// One pull cycle: list inbox newer than lastSync, upsert into email_messages,
// evaluate active rules, run autolinker, optionally apply Graph-side actions.
// Throttled by the caller via lastSync timestamp.
export async function runEmailPoll(env: Bindings, ctx?: ExecutionContext): Promise<{ scanned: number; upserted: number; ruleHits: number; linked: number; skipped: boolean; error?: string }> {
  const refresh = await getCfgDecrypted(env, K.refreshToken);
  if (!refresh) return { scanned: 0, upserted: 0, ruleHits: 0, linked: 0, skipped: true };
  const enabled = await getCfg(env.DB, K.enabled);
  if (enabled !== 'true') return { scanned: 0, upserted: 0, ruleHits: 0, linked: 0, skipped: true };

  const initiator = await getCfg(env.DB, K.oauthInitiator);
  const ownerUserId = initiator ? parseInt(initiator, 10) : 0;
  if (!ownerUserId) return { scanned: 0, upserted: 0, ruleHits: 0, linked: 0, skipped: true, error: 'no oauthInitiator' };

  try {
    const res = await graphFetch(
      env,
      `/me/mailFolders/inbox/messages?$select=id,conversationId,subject,from,toRecipients,ccRecipients,bodyPreview,hasAttachments,isRead,flag,importance,receivedDateTime,sentDateTime&$orderby=receivedDateTime desc&$top=50`,
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { scanned: 0, upserted: 0, ruleHits: 0, linked: 0, skipped: false, error: `Graph ${res.status}: ${text.slice(0, 150)}` };
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
        const mv = graphFetch(env, `/me/messages/${encodeURIComponent(m.graph_id)}/move`, {
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
          m.to_addresses, m.cc_addresses, m.body_preview, m.has_attachments, m.is_read, m.is_flagged,
          m.importance, categories, m.received_at ?? null, m.sent_at ?? null,
        );
        upserted++;
      } catch { /* upsert best-effort */ }

      // Apply Graph-side side effects (move/markRead/flag). Fire-and-forget
      // so a single failure can't stall the poll loop.
      if (toMarkRead || toFlag || toMove) {
        const patch: Record<string, unknown> = {};
        if (toMarkRead) patch.isRead = true;
        if (toFlag) patch.flag = { flagStatus: 'flagged' };
        const p = Object.keys(patch).length
          ? graphFetch(env, `/me/messages/${encodeURIComponent(m.graph_id)}`, { method: 'PATCH', body: JSON.stringify(patch) }).catch(() => null)
          : Promise.resolve(null);
        const mv = toMove
          ? graphFetch(env, `/me/messages/${encodeURIComponent(m.graph_id)}/move`, { method: 'POST', body: JSON.stringify({ destinationId: toMove }) }).catch(() => null)
          : Promise.resolve(null);
        if (ctx) ctx.waitUntil(Promise.all([p, mv]));
      }

      // Autolinker — only on rows we just inserted (cheap dedup via INSERT OR IGNORE).
      try { linked += await runAutolinker(env.DB, ownerUserId, m); } catch { /* best-effort */ }
    }

    await setCfg(env.DB, K.lastSync, new Date().toISOString());
    return { scanned: items.length, upserted, ruleHits, linked, skipped: false };
  } catch (err: unknown) {
    return { scanned: 0, upserted: 0, ruleHits: 0, linked: 0, skipped: false, error: err instanceof Error ? err.message : 'poll failed' };
  }
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
  sets.push("updated_at = datetime('now','localtime')");
  vals.push(id, userId);
  await execute(c.env.DB, `UPDATE email_rules SET ${sets.join(', ')} WHERE id = ? AND (owner_user_id IS NULL OR owner_user_id = ?)`, ...vals);
  return c.json({ success: true });
});

email.delete('/rules/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const userId = c.get('userId');
  await execute(c.env.DB, 'DELETE FROM email_rules WHERE id = ? AND (owner_user_id IS NULL OR owner_user_id = ?)', id, userId);
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
email.post('/messages/:id/reply-all', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({})) as { body?: string; comment?: string };
  try {
    const res = await graphFetch(c.env, `/me/messages/${encodeURIComponent(id)}/replyAll`, {
      method: 'POST',
      body: JSON.stringify({ comment: body.body || body.comment || '' }),
    });
    if (!res.ok) return c.json({ success: false, error: `Graph ${res.status}` }, 502);
    return c.json({ success: true });
  } catch (err: unknown) {
    return c.json({ success: false, error: err instanceof Error ? err.message : 'Failed' }, 502);
  }
});

email.post('/messages/:id/forward', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({})) as { to?: string | string[]; body?: string; comment?: string };
  const toRecipients = parseAddrList(body.to);
  if (!toRecipients.length) return c.json({ error: 'At least one recipient required' }, 400);
  try {
    const res = await graphFetch(c.env, `/me/messages/${encodeURIComponent(id)}/forward`, {
      method: 'POST',
      body: JSON.stringify({ comment: body.body || body.comment || '', toRecipients }),
    });
    if (!res.ok) return c.json({ success: false, error: `Graph ${res.status}` }, 502);
    return c.json({ success: true });
  } catch (err: unknown) {
    return c.json({ success: false, error: err instanceof Error ? err.message : 'Failed' }, 502);
  }
});

// ─── Batch operations (bulk toolbar) ─────────────────────────────
// Graph has no true batch message API on v1.0 for these verbs, so we
// fan out sequentially (selection is capped at the visible page, ≤100).
email.post('/messages/batch', async (c) => {
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
          res = await graphFetch(c.env, `/me/messages/${encodeURIComponent(id)}`, { method: 'DELETE' });
          break;
        case 'archive':
        case 'junk':
        case 'move': {
          const dest = body.action === 'archive' ? 'archive' : body.action === 'junk' ? 'junkemail' : body.folderId;
          if (!dest) { failed++; continue; }
          res = await graphFetch(c.env, `/me/messages/${encodeURIComponent(id)}/move`, {
            method: 'POST', body: JSON.stringify({ destinationId: dest }),
          });
          break;
        }
        case 'markRead':
        case 'markUnread':
          res = await graphFetch(c.env, `/me/messages/${encodeURIComponent(id)}`, {
            method: 'PATCH', body: JSON.stringify({ isRead: body.action === 'markRead' }),
          });
          break;
        case 'flag':
        case 'unflag':
          res = await graphFetch(c.env, `/me/messages/${encodeURIComponent(id)}`, {
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
  const body = await c.req.json().catch(() => ({})) as { folder?: string };
  const folder = body.folder || 'inbox';
  try {
    let marked = 0;
    // Page through unread messages (cap 5 pages × 50 to bound Worker time)
    for (let i = 0; i < 5; i++) {
      const res = await graphFetch(c.env, `/me/mailFolders/${encodeURIComponent(folder)}/messages?$filter=isRead eq false&$select=id&$top=50`);
      if (!res.ok) break;
      const data = await res.json() as { value?: Array<{ id: string }> };
      const items = data.value || [];
      if (!items.length) break;
      for (const m of items) {
        const r = await graphFetch(c.env, `/me/messages/${encodeURIComponent(m.id)}`, {
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
  const body = await c.req.json().catch(() => ({})) as { displayName?: string; parentFolderId?: string };
  if (!body.displayName?.trim()) return c.json({ error: 'displayName required' }, 400);
  try {
    const path = body.parentFolderId
      ? `/me/mailFolders/${encodeURIComponent(body.parentFolderId)}/childFolders`
      : '/me/mailFolders';
    const res = await graphFetch(c.env, path, {
      method: 'POST', body: JSON.stringify({ displayName: body.displayName.trim() }),
    });
    if (!res.ok) return c.json({ success: false, error: `Graph ${res.status}` }, 502);
    return c.json({ success: true, folder: await res.json() });
  } catch (err: unknown) {
    return c.json({ success: false, error: err instanceof Error ? err.message : 'Failed' }, 502);
  }
});

email.patch('/folders/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({})) as { displayName?: string };
  if (!body.displayName?.trim()) return c.json({ error: 'displayName required' }, 400);
  try {
    const res = await graphFetch(c.env, `/me/mailFolders/${encodeURIComponent(id)}`, {
      method: 'PATCH', body: JSON.stringify({ displayName: body.displayName.trim() }),
    });
    if (!res.ok) return c.json({ success: false, error: `Graph ${res.status}` }, 502);
    return c.json({ success: true });
  } catch (err: unknown) {
    return c.json({ success: false, error: err instanceof Error ? err.message : 'Failed' }, 502);
  }
});

email.delete('/folders/:id', async (c) => {
  const id = c.req.param('id');
  try {
    const res = await graphFetch(c.env, `/me/mailFolders/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) return c.json({ success: false, error: `Graph ${res.status}` }, 502);
    return c.json({ success: true });
  } catch (err: unknown) {
    return c.json({ success: false, error: err instanceof Error ? err.message : 'Failed' }, 502);
  }
});

// Empty a folder (Deleted Items / Junk). Pages deletes; bounded.
email.post('/folders/:id/empty', async (c) => {
  const id = c.req.param('id');
  try {
    let deleted = 0;
    for (let i = 0; i < 5; i++) {
      const res = await graphFetch(c.env, `/me/mailFolders/${encodeURIComponent(id)}/messages?$select=id&$top=50`);
      if (!res.ok) break;
      const data = await res.json() as { value?: Array<{ id: string }> };
      const items = data.value || [];
      if (!items.length) break;
      for (const m of items) {
        const r = await graphFetch(c.env, `/me/messages/${encodeURIComponent(m.id)}`, { method: 'DELETE' });
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
  const body = await c.req.json().catch(() => ({})) as {
    to?: string | string[]; cc?: string | string[]; bcc?: string | string[];
    subject?: string; body?: string; isHtml?: boolean; attachments?: SendAttachment[]; importance?: string;
  };
  const attachments = mapAttachments(body.attachments);
  try {
    const res = await graphFetch(c.env, '/me/messages', {
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
    const res = await graphFetch(c.env, `/me/messages/${encodeURIComponent(id)}`, {
      method: 'PATCH', body: JSON.stringify(patch),
    });
    if (!res.ok) return c.json({ success: false, error: `Graph ${res.status}` }, 502);
    return c.json({ success: true });
  } catch (err: unknown) {
    return c.json({ success: false, error: err instanceof Error ? err.message : 'Failed' }, 502);
  }
});

email.post('/drafts/:id/send', async (c) => {
  const id = c.req.param('id');
  try {
    const res = await graphFetch(c.env, `/me/messages/${encodeURIComponent(id)}/send`, { method: 'POST' });
    if (!res.ok) return c.json({ success: false, error: `Graph ${res.status}` }, 502);
    return c.json({ success: true });
  } catch (err: unknown) {
    return c.json({ success: false, error: err instanceof Error ? err.message : 'Failed' }, 502);
  }
});

// ─── Conversation thread view ────────────────────────────────────
email.get('/conversations/:id', async (c) => {
  const id = c.req.param('id');
  try {
    const params = new URLSearchParams();
    params.set('$filter', `conversationId eq '${id.replace(/'/g, "''")}'`);
    params.set('$select', 'id,conversationId,subject,from,toRecipients,ccRecipients,bodyPreview,hasAttachments,isRead,flag,importance,receivedDateTime,sentDateTime');
    params.set('$top', '50');
    const res = await graphFetch(c.env, `/me/messages?${params.toString()}`);
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
  const folder = c.req.query('folder') || 'inbox';
  const perPage = Math.max(1, Math.min(100, parseInt(c.req.query('per_page') || '25', 10) || 25));
  try {
    const params = new URLSearchParams();
    params.set('$select', 'id,conversationId,subject,from,toRecipients,ccRecipients,bodyPreview,hasAttachments,isRead,flag,importance,receivedDateTime,sentDateTime');
    params.set('$orderby', 'receivedDateTime desc');
    params.set('$top', String(Math.min(100, perPage * 3)));
    const res = await graphFetch(c.env, `/me/mailFolders/${encodeURIComponent(folder)}/messages?${params.toString()}`);
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
  const id = c.req.param('id');
  try {
    const res = await graphFetch(c.env, `/me/messages/${encodeURIComponent(id)}?$select=internetMessageId,internetMessageHeaders`);
    if (!res.ok) return c.json({ headers: [] });
    const data = await res.json() as { internetMessageId?: string; internetMessageHeaders?: Array<{ name: string; value: string }> };
    return c.json({ internetMessageId: data.internetMessageId || '', headers: data.internetMessageHeaders || [] });
  } catch {
    return c.json({ headers: [] });
  }
});

email.get('/messages/:id/raw', async (c) => {
  const id = c.req.param('id');
  try {
    const res = await graphFetch(c.env, `/me/messages/${encodeURIComponent(id)}/$value`);
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
  try {
    const res = await graphFetch(c.env, '/me/outlook/masterCategories?$top=50');
    if (!res.ok) return c.json({ categories: [] });
    const data = await res.json() as { value?: Array<{ id: string; displayName: string; color: string }> };
    return c.json({ categories: data.value || [] });
  } catch {
    return c.json({ categories: [] });
  }
});

email.post('/categories', async (c) => {
  const body = await c.req.json().catch(() => ({})) as { displayName?: string; color?: string };
  if (!body.displayName?.trim()) return c.json({ error: 'displayName required' }, 400);
  try {
    const res = await graphFetch(c.env, '/me/outlook/masterCategories', {
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
  const id = c.req.param('id');
  try {
    const res = await graphFetch(c.env, `/me/outlook/masterCategories/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) return c.json({ success: false, error: `Graph ${res.status}` }, 502);
    return c.json({ success: true });
  } catch (err: unknown) {
    return c.json({ success: false, error: err instanceof Error ? err.message : 'Failed' }, 502);
  }
});

email.patch('/messages/:id/categories', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({})) as { categories?: string[] };
  try {
    const res = await graphFetch(c.env, `/me/messages/${encodeURIComponent(id)}`, {
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
      await graphFetch(c.env, `/me/messages/${encodeURIComponent(r.graph_id)}`, {
        method: 'PATCH', body: JSON.stringify({ categories: cats }),
      }).catch(() => null);
      categorized++;
    } catch { /* best-effort */ }
  }
  return c.json({ processed: rows.length, categorized });
});

// ─── Focused Inbox (Graph inferenceClassification) ───────────────
email.patch('/messages/:id/focused', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({})) as { focused?: boolean };
  try {
    const res = await graphFetch(c.env, `/me/messages/${encodeURIComponent(id)}`, {
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
    const res = await graphFetch(c.env, `/me/mailFolders/${encodeURIComponent(folder)}/messages?${params.toString()}`);
    if (!res.ok) return c.json({ success: false, error: `Graph ${res.status}` }, 502);
    const data = await res.json() as { value?: Array<{ id: string; receivedDateTime?: string }> };
    let items = (data.value || []).sort((a, b) => String(b.receivedDateTime || '').localeCompare(String(a.receivedDateTime || '')));
    if (body.keepLatest && items.length) items = items.slice(1);
    let swept = 0;
    for (const m of items) {
      const r = dest
        ? await graphFetch(c.env, `/me/messages/${encodeURIComponent(m.id)}/move`, { method: 'POST', body: JSON.stringify({ destinationId: dest }) })
        : await graphFetch(c.env, `/me/messages/${encodeURIComponent(m.id)}`, { method: 'DELETE' });
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
    return c.json({ success: false, error: err instanceof Error ? err.message : 'Failed' }, 500);
  }
  // Optionally junk the reported message right away.
  if (body.messageId) {
    await graphFetch(c.env, `/me/messages/${encodeURIComponent(body.messageId)}/move`, {
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
  const until = body.until.replace('T', ' ').slice(0, 19);
  try {
    const res = await graphFetch(c.env, `/me/messages/${encodeURIComponent(id)}/move`, {
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
  const rows = await query<{ id: number; message_graph_id: string; original_folder: string }>(
    env.DB,
    "SELECT id, message_graph_id, original_folder FROM email_snoozes WHERE status = 'snoozed' AND snooze_until <= datetime('now','localtime') LIMIT 20",
  ).catch(() => [] as Array<{ id: number; message_graph_id: string; original_folder: string }>);
  let resurfaced = 0;
  for (const r of rows) {
    try {
      const res = await graphFetch(env, `/me/messages/${encodeURIComponent(r.message_graph_id)}/move`, {
        method: 'POST', body: JSON.stringify({ destinationId: r.original_folder || 'inbox' }),
      });
      if (res.ok) {
        const moved = await res.json().catch(() => null) as { id?: string } | null;
        if (moved?.id) {
          await graphFetch(env, `/me/messages/${encodeURIComponent(moved.id)}`, {
            method: 'PATCH', body: JSON.stringify({ isRead: false }),
          }).catch(() => null);
        }
        await execute(env.DB, "UPDATE email_snoozes SET status = 'resurfaced' WHERE id = ?", r.id);
        resurfaced++;
      } else if (res.status === 404) {
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
  const body = await c.req.json().catch(() => ({})) as { name?: string; category?: string; subject?: string; body?: string; shared?: boolean };
  if (!body.name?.trim()) return c.json({ error: 'name required' }, 400);
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
  sets.push("updated_at = datetime('now','localtime')");
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
email.post('/schedule', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json().catch(() => ({})) as {
    to?: string | string[]; cc?: string | string[]; bcc?: string | string[];
    subject?: string; body?: string; isHtml?: boolean; scheduledAt?: string;
    attachments?: SendAttachment[]; importance?: string;
  };
  const to = parseAddrList(body.to).map((r) => r.emailAddress.address);
  if (!to.length) return c.json({ error: 'At least one recipient required' }, 400);
  if (!body.scheduledAt) return c.json({ error: 'scheduledAt required' }, 400);
  const when = body.scheduledAt.replace('T', ' ').slice(0, 19);
  const cc = parseAddrList(body.cc).map((r) => r.emailAddress.address);
  const bcc = parseAddrList(body.bcc).map((r) => r.emailAddress.address);
  const r = await execute(
    c.env.DB,
    `INSERT INTO email_scheduled (owner_user_id, to_addresses, cc_addresses, bcc_addresses, subject, body, is_html, importance, attachments, scheduled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    userId, JSON.stringify(to), cc.length ? JSON.stringify(cc) : null, bcc.length ? JSON.stringify(bcc) : null,
    body.subject || '', body.body || '', body.isHtml === false ? 0 : 1,
    ['low', 'normal', 'high'].includes(body.importance || '') ? body.importance : 'normal',
    body.attachments?.length ? JSON.stringify(body.attachments.slice(0, 20)) : null,
    when,
  );
  return c.json({ success: true, id: r.meta.last_row_id });
});

email.get('/scheduled', async (c) => {
  const userId = c.get('userId');
  const rows = await query(
    c.env.DB,
    "SELECT id, to_addresses, subject, scheduled_at, status, created_at FROM email_scheduled WHERE owner_user_id = ? AND status != 'cancelled' ORDER BY scheduled_at ASC LIMIT 100",
    userId,
  ).catch(() => []);
  return c.json(rows);
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
    "SELECT id, owner_user_id, to_addresses, cc_addresses, bcc_addresses, subject, body, is_html, importance, attachments FROM email_scheduled WHERE status = 'pending' AND scheduled_at <= datetime('now','localtime') LIMIT 10",
  ).catch(() => [] as never[]);
  let queued = 0;
  for (const r of rows) {
    try {
      const parse = (s: string | null): string[] => { try { return s ? JSON.parse(s) : []; } catch { return []; } };
      const atts = ((): SendAttachment[] => { try { return r.attachments ? JSON.parse(r.attachments) : []; } catch { return []; } })();
      const attachments = mapAttachments(atts);
      const payload = {
        message: {
          subject: r.subject || '(no subject)',
          body: { contentType: r.is_html ? 'HTML' : 'Text', content: r.body || '' },
          toRecipients: parseAddrList(parse(r.to_addresses)),
          ccRecipients: parseAddrList(parse(r.cc_addresses)),
          bccRecipients: parseAddrList(parse(r.bcc_addresses)),
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
      await execute(env.DB, "UPDATE email_scheduled SET status = 'sent', sent_at = datetime('now','localtime') WHERE id = ?", r.id);
      queued++;
    } catch (err: unknown) {
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
  try {
    const res = await graphFetch(c.env, '/me/mailboxSettings/automaticRepliesSetting');
    if (!res.ok) return c.json({ status: 'disabled' });
    return c.json(await res.json());
  } catch {
    return c.json({ status: 'disabled' });
  }
});

email.put('/settings/auto-reply', async (c) => {
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
    const res = await graphFetch(c.env, '/me/mailboxSettings', {
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
  try {
    const res = await graphFetch(c.env, '/me/mailboxSettings?$select=timeZone,workingHours,dateFormat,timeFormat');
    if (!res.ok) return c.json({});
    return c.json(await res.json());
  } catch {
    return c.json({});
  }
});

// ─── People autocomplete (Graph relevance-ranked contacts) ───────
email.get('/people', async (c) => {
  const q = (c.req.query('q') || '').trim();
  try {
    const params = new URLSearchParams();
    params.set('$select', 'displayName,scoredEmailAddresses');
    params.set('$top', '10');
    if (q) params.set('$search', `"${q.replace(/"/g, '')}"`);
    const res = await graphFetch(c.env, `/me/people?${params.toString()}`);
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

// ─── Non-admin OAuth kickoff (EnrollmentBanner) ──────────────────
// Same flow as /admin/oauth/authorize but any authenticated user may
// (re)start consent for the shared org mailbox; creds stay admin-only.
// Returns { authorizationUrl } (the banner's expected key).
email.get('/oauth/authorize', async (c) => {
  const clientId = await getCfgDecrypted(c.env, K.clientId);
  const tenantId = await getCfgDecrypted(c.env, K.tenantId);
  if (!clientId || !tenantId) {
    return c.json({ error: 'Email is not configured yet — ask an administrator to set up Azure AD credentials in Admin → Integrations.', code: 'NOT_CONFIGURED' }, 400);
  }
  const stateBytes = crypto.getRandomValues(new Uint8Array(32));
  let state = '';
  for (const b of stateBytes) state += b.toString(16).padStart(2, '0');
  await setCfg(c.env.DB, K.oauthState, state);
  const userId = c.get('userId');
  if (userId) await setCfg(c.env.DB, K.oauthInitiator, String(userId));
  const host = new URL(c.req.url).host;
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: `https://${host}/api/email/oauth/callback`,
    scope: GRAPH_SCOPES.join(' '),
    state,
    prompt: 'consent',
  });
  const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?${params.toString()}`;
  return c.json({ authorizationUrl: url, url });
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
    const res = await graphFetch(c.env, `/me/people?${params.toString()}`);
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
    const like = `%${q.replace(/[%_]/g, ' ')}%`;
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
  try {
    const res = await graphFetch(c.env, '/me/mailFolders?$select=displayName,totalItemCount,unreadItemCount,sizeInBytes&$top=30');
    if (!res.ok) return c.json({ folders: [] });
    const data = await res.json() as { value?: unknown[] };
    return c.json({ folders: data.value || [] });
  } catch {
    return c.json({ folders: [] });
  }
});

export default email;

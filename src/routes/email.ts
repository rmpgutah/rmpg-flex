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
  if (search) params.set('$search', `"${search.replace(/"/g, '\\"')}"`);
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
function parseAddrList(raw: string): Array<{ emailAddress: { address: string } }> {
  return (raw || '')
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter((s) => s && /@/.test(s))
    .map((address) => ({ emailAddress: { address } }));
}

email.post('/send', async (c) => {
  const body = await c.req.json().catch(() => ({})) as {
    to?: string; cc?: string; bcc?: string; subject?: string; body?: string; isHtml?: boolean;
  };
  const toRecipients = parseAddrList(body.to || '');
  if (!toRecipients.length) return c.json({ error: 'At least one recipient required' }, 400);
  try {
    const res = await graphFetch(c.env, '/me/sendMail', {
      method: 'POST',
      body: JSON.stringify({
        message: {
          subject: body.subject || '(no subject)',
          body: {
            contentType: body.isHtml === false ? 'Text' : 'HTML',
            content: body.body || '',
          },
          toRecipients,
          ccRecipients: parseAddrList(body.cc || ''),
          bccRecipients: parseAddrList(body.bcc || ''),
        },
        saveToSentItems: true,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return c.json({ success: false, error: `Graph ${res.status}: ${text.slice(0, 200)}` }, 502);
    }
    return c.json({ success: true });
  } catch (err: unknown) {
    return c.json({ success: false, error: err instanceof Error ? err.message : 'Failed' }, 502);
  }
});

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

export default email;

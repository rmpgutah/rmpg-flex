// Email admin endpoints — Microsoft Graph credential storage + status.
// Backs client/src/pages/admin/AdminEmailTab.tsx.
//
// Storage model: A — plaintext in system_config (matches third-party
// keys precedent in admin.ts:680+; see project memory
// [[project-live-d1-schema-patches]]). The clientSecret + tokens are
// readable by anyone with D1 access; rotate from Azure AD if leaked.
//
// Endpoints implemented:
//   GET    /status               public-ish admin status (no secrets)
//   PUT    /admin/credentials    save Azure AD app credentials
//   DELETE /admin/credentials    clear creds + cached tokens
//   PUT    /admin/enable         toggle enabled + pollInterval
//   PUT    /admin/smtp-settings  toggle SMTP fallback + password
//   GET    /admin/oauth/authorize  → { url } to start consent flow
//   POST   /admin/test-connection  → { graph, smtp } health probes
//   POST   /admin/sync-now       501 — sync worker is Phase-2

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';
import { graphFetch, graphJson, GraphNotConfiguredError, GraphAuthError } from '../utils/msGraph';
import { syncEmail } from '../utils/emailSync';

const email = new Hono<Env>();

function requireRole(c: { get: (k: 'user') => { role: string } | undefined }, ...roles: string[]): string | null {
  const u = c.get('user');
  if (!u || !roles.includes(u.role)) return 'Insufficient role';
  return null;
}

// system_config keys we own. Centralised so a typo can't silently
// orphan a value in another category.
const KEYS = {
  clientId: 'email_ms_client_id',
  clientSecret: 'email_ms_client_secret',
  tenantId: 'email_ms_tenant_id',
  refreshToken: 'email_ms_refresh_token',
  mailbox: 'email_mailbox',
  enabled: 'email_enabled',
  pollInterval: 'email_poll_interval',
  smtpFallback: 'email_smtp_fallback',
  smtpPassword: 'email_smtp_password',
  lastSync: 'email_last_sync',
} as const;

type ConfigKey = typeof KEYS[keyof typeof KEYS];

async function readConfig(db: D1Database, keys: ConfigKey[]): Promise<Record<string, string>> {
  if (keys.length === 0) return {};
  const placeholders = keys.map(() => '?').join(',');
  const rows = await query<{ config_key: string; config_value: string }>(
    db,
    `SELECT config_key, config_value FROM system_config WHERE is_active = 1 AND config_key IN (${placeholders})`,
    ...keys,
  );
  const out: Record<string, string> = {};
  for (const r of rows) out[r.config_key] = r.config_value;
  return out;
}

async function writeConfig(db: D1Database, key: ConfigKey, value: string): Promise<void> {
  const existing = await queryFirst<{ id: number }>(
    db, `SELECT id FROM system_config WHERE config_key = ? LIMIT 1`, key,
  );
  if (existing) {
    await execute(
      db,
      `UPDATE system_config SET config_value = ?, is_active = 1, updated_at = datetime('now','localtime') WHERE config_key = ?`,
      value, key,
    );
  } else {
    await execute(
      db,
      `INSERT INTO system_config (config_key, config_value, category, is_active, created_at, updated_at)
       VALUES (?, ?, 'email', 1, datetime('now','localtime'), datetime('now','localtime'))`,
      key, value,
    );
  }
}

async function clearConfig(db: D1Database, key: ConfigKey): Promise<void> {
  await execute(
    db,
    `UPDATE system_config SET config_value = '', is_active = 0, updated_at = datetime('now','localtime') WHERE config_key = ?`,
    key,
  );
}

// ─── GET /status ─────────────────────────────────────────────
// Shape MUST match the EmailStatus interface in AdminEmailTab.tsx.
email.get('/status', async (c) => {
  try {
    const db = getDb(c.env);
    const cfg = await readConfig(db, [
      KEYS.clientId, KEYS.clientSecret, KEYS.tenantId,
      KEYS.refreshToken, KEYS.mailbox, KEYS.enabled,
      KEYS.pollInterval, KEYS.smtpFallback, KEYS.lastSync,
    ]);
    let cachedMessages = 0;
    try {
      const row = await queryFirst<{ n: number }>(db, `SELECT COUNT(*) AS n FROM email_messages`);
      cachedMessages = row?.n ?? 0;
    } catch { /* table may not exist yet */ }
    return c.json({
      configured: !!(cfg[KEYS.clientId] && cfg[KEYS.clientSecret] && cfg[KEYS.tenantId]),
      enabled: cfg[KEYS.enabled] === '1',
      authorized: !!cfg[KEYS.refreshToken],
      mailbox: cfg[KEYS.mailbox] || null,
      lastSync: cfg[KEYS.lastSync] || null,
      pollInterval: parseInt(cfg[KEYS.pollInterval] || '300', 10) || 300,
      smtpFallback: cfg[KEYS.smtpFallback] === '1',
      cachedMessages,
    });
  } catch (err) {
    console.error('[Email] status failed:', err);
    return c.json({ error: 'Failed to read status' }, 500);
  }
});

// ─── PUT /admin/credentials ──────────────────────────────────
email.put('/admin/credentials', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const body = await c.req.json<{ clientId?: string; clientSecret?: string; tenantId?: string }>();
    const clientId = (body.clientId || '').trim();
    const clientSecret = (body.clientSecret || '').trim();
    const tenantId = (body.tenantId || '').trim();
    if (!clientId || !clientSecret || !tenantId) {
      return c.json({ error: 'clientId, clientSecret, and tenantId are all required' }, 400);
    }
    const db = getDb(c.env);
    await writeConfig(db, KEYS.clientId, clientId);
    await writeConfig(db, KEYS.clientSecret, clientSecret);
    await writeConfig(db, KEYS.tenantId, tenantId);
    // Saving new creds invalidates any prior refresh token.
    await clearConfig(db, KEYS.refreshToken);
    return c.json({ success: true, message: 'Credentials saved. Click Authorize to grant mailbox access.' });
  } catch (err) {
    console.error('[Email] credentials save failed:', err);
    return c.json({ error: 'Failed to save credentials' }, 500);
  }
});

// ─── DELETE /admin/credentials ───────────────────────────────
email.delete('/admin/credentials', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    for (const k of [KEYS.clientId, KEYS.clientSecret, KEYS.tenantId, KEYS.refreshToken, KEYS.mailbox, KEYS.lastSync]) {
      await clearConfig(db, k);
    }
    try { await execute(db, `DELETE FROM email_messages`); } catch { /* table optional */ }
    return c.json({ success: true, message: 'Credentials and cached messages cleared' });
  } catch (err) {
    console.error('[Email] credentials clear failed:', err);
    return c.json({ error: 'Failed to clear credentials' }, 500);
  }
});

// ─── PUT /admin/enable — { enabled?, pollInterval? } ────────
email.put('/admin/enable', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const body = await c.req.json<{ enabled?: boolean; pollInterval?: number }>();
    const db = getDb(c.env);
    if (typeof body.enabled === 'boolean') {
      await writeConfig(db, KEYS.enabled, body.enabled ? '1' : '0');
    }
    if (typeof body.pollInterval === 'number' && body.pollInterval >= 30 && body.pollInterval <= 86400) {
      await writeConfig(db, KEYS.pollInterval, String(Math.floor(body.pollInterval)));
    }
    return c.json({ success: true });
  } catch (err) {
    console.error('[Email] enable update failed:', err);
    return c.json({ error: 'Failed to update' }, 500);
  }
});

// ─── PUT /admin/smtp-settings — { enabled, password? } ──────
email.put('/admin/smtp-settings', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const body = await c.req.json<{ enabled?: boolean; password?: string }>();
    const db = getDb(c.env);
    if (typeof body.enabled === 'boolean') {
      await writeConfig(db, KEYS.smtpFallback, body.enabled ? '1' : '0');
    }
    if (typeof body.password === 'string' && body.password.length > 0) {
      await writeConfig(db, KEYS.smtpPassword, body.password);
    }
    return c.json({ success: true });
  } catch (err) {
    console.error('[Email] smtp-settings update failed:', err);
    return c.json({ error: 'Failed to update' }, 500);
  }
});

// ─── GET /admin/oauth/authorize ─────────────────────────────
// Builds the Microsoft identity-platform consent URL. The
// redirect URI must EXACTLY match what's registered on the Azure
// AD app — we register `https://api.rmpgutah.us/api/email/admin/oauth/callback`.
// Scope choice: see the request below for your input.
email.get('/admin/oauth/authorize', async (c) => {
  try {
    const db = getDb(c.env);
    const cfg = await readConfig(db, [KEYS.clientId, KEYS.tenantId]);
    const clientId = cfg[KEYS.clientId];
    const tenantId = cfg[KEYS.tenantId];
    if (!clientId || !tenantId) {
      return c.json({ error: 'Save credentials before authorizing', code: 'NOT_CONFIGURED' }, 400);
    }
    const redirectUri = 'https://api.rmpgutah.us/api/email-oauth/callback';
    // Default scope set — covers personal + shared mailbox (e.g. dispatch@)
    // since RMPG runs CAD/RMS off a shared inbox. Tighten in chat if you want
    // read-only or drop shared.
    const scopes = [
      'offline_access',
      'https://graph.microsoft.com/Mail.ReadWrite',
      'https://graph.microsoft.com/Mail.Send',
      'https://graph.microsoft.com/Mail.Read.Shared',
      'https://graph.microsoft.com/User.Read',
    ].join(' ');
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      response_mode: 'query',
      scope: scopes,
      prompt: 'consent',
    });
    const url = `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/authorize?${params}`;
    return c.json({ url });
  } catch (err) {
    console.error('[Email] oauth authorize failed:', err);
    return c.json({ error: 'Failed to build authorize URL' }, 500);
  }
});

// ─── POST /admin/test-connection ────────────────────────────
// Pings Graph with the stored refresh token (if any). SMTP check
// is a 501 stub until we wire a real SMTP client.
email.post('/admin/test-connection', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  const out: { graph?: unknown; smtp?: unknown } = {};
  try {
    const me = await graphJson<{ userPrincipalName?: string; mail?: string }>(c.env, '/me');
    out.graph = { success: true, mailbox: me.mail || me.userPrincipalName || null };
  } catch (err) {
    if (err instanceof GraphNotConfiguredError) {
      out.graph = { success: false, error: 'Not authorized — click Authorize first' };
    } else {
      out.graph = { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
  out.smtp = { success: false, error: 'SMTP test not yet implemented' };
  return c.json(out);
});

// OAuth callback lives at /api/email-oauth/callback (public — see
// src/routes/emailOauthCallback.ts). Auth-gated prefix would 401 the
// mid-redirect browser, so we split it out.

// ─── POST /admin/sync-now ───────────────────────────────────
// Triggers an immediate delta-sync from Graph → email_messages.
// Same code path the 4h cron uses — just on-demand.
email.post('/admin/sync-now', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const result = await syncEmail(c.env);
    return c.json(result);
  } catch (err) {
    console.error('[Email] sync-now failed:', err);
    return c.json({ error: 'Sync failed', detail: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// ════════════════════════════════════════════════════════════
// Live-proxy endpoints for EmailPage. These hit Microsoft Graph
// in real time — no local mirror table. A Phase-2 sync worker
// would cache into D1 + flip these to read from cache.
// ════════════════════════════════════════════════════════════

// Translate Graph error → clean HTTP response.
function graphErrorResponse(c: { json: (body: unknown, status?: number) => Response }, err: unknown): Response {
  if (err instanceof GraphNotConfiguredError) {
    return c.json({ error: err.message, code: 'NOT_CONFIGURED' }, 412);
  }
  if (err instanceof GraphAuthError) {
    return c.json({ error: err.message, code: 'GRAPH_AUTH' }, err.status >= 400 && err.status < 600 ? err.status : 502);
  }
  console.error('[Email] Graph proxy error:', err);
  return c.json({ error: err instanceof Error ? err.message : String(err), code: 'GRAPH_FAIL' }, 502);
}

// Map a Graph message → client EmailMessage shape (see client/src/types/index.ts:754).
interface GraphRecipient { emailAddress: { address: string; name?: string } }
interface GraphMessage {
  id: string;
  conversationId?: string;
  subject?: string;
  from?: GraphRecipient;
  sender?: GraphRecipient;
  toRecipients?: GraphRecipient[];
  ccRecipients?: GraphRecipient[];
  bodyPreview?: string;
  body?: { contentType?: string; content?: string };
  hasAttachments?: boolean;
  isRead?: boolean;
  flag?: { flagStatus?: string };
  importance?: string;
  receivedDateTime?: string;
  sentDateTime?: string;
}

function mapMessage(m: GraphMessage) {
  const fromAddr = m.from?.emailAddress || m.sender?.emailAddress;
  return {
    id: m.id,
    conversationId: m.conversationId,
    subject: m.subject || '(no subject)',
    fromAddress: fromAddr?.address || '',
    fromName: fromAddr?.name || fromAddr?.address || '',
    toAddresses: (m.toRecipients || []).map((r) => ({ email: r.emailAddress.address, name: r.emailAddress.name })),
    ccAddresses: (m.ccRecipients || []).map((r) => ({ email: r.emailAddress.address, name: r.emailAddress.name })),
    bodyPreview: m.bodyPreview || '',
    bodyHtml: m.body?.contentType === 'html' ? m.body.content : (m.body?.content ? `<pre>${m.body.content}</pre>` : undefined),
    hasAttachments: !!m.hasAttachments,
    isRead: !!m.isRead,
    isFlagged: m.flag?.flagStatus === 'flagged',
    importance: (m.importance === 'low' || m.importance === 'high') ? m.importance : 'normal',
    receivedAt: m.receivedDateTime || '',
    sentAt: m.sentDateTime,
  };
}

// ─── GET /folders ────────────────────────────────────────────
// Returns top-level mail folders. Recurse via /folders/:id/children
// from the client when expanding.
email.get('/folders', async (c) => {
  try {
    const data = await graphJson<{ value: Array<{
      id: string; displayName: string; parentFolderId?: string;
      totalItemCount?: number; unreadItemCount?: number; childFolderCount?: number;
    }> }>(c.env, '/me/mailFolders?$top=50');
    return c.json(data.value.map((f) => ({
      id: f.id,
      displayName: f.displayName,
      parentFolderId: f.parentFolderId,
      totalItemCount: f.totalItemCount || 0,
      unreadItemCount: f.unreadItemCount || 0,
      childFolderCount: f.childFolderCount,
    })));
  } catch (err) {
    return graphErrorResponse(c, err);
  }
});

// ─── GET /folders/:id/children ───────────────────────────────
email.get('/folders/:id/children', async (c) => {
  const id = c.req.param('id');
  try {
    const data = await graphJson<{ value: Array<{
      id: string; displayName: string; parentFolderId?: string;
      totalItemCount?: number; unreadItemCount?: number; childFolderCount?: number;
    }> }>(c.env, `/me/mailFolders/${encodeURIComponent(id)}/childFolders?$top=50`);
    return c.json(data.value.map((f) => ({
      id: f.id,
      displayName: f.displayName,
      parentFolderId: f.parentFolderId,
      totalItemCount: f.totalItemCount || 0,
      unreadItemCount: f.unreadItemCount || 0,
      childFolderCount: f.childFolderCount,
    })));
  } catch (err) {
    return graphErrorResponse(c, err);
  }
});

// ─── GET /messages ───────────────────────────────────────────
// Query: folder=<id|inbox> limit=50 search=<text> skip=0
//
// Reads from email_messages cache when populated. Search and the
// non-inbox case still go live — Graph $search beats D1 LIKE, and
// the cache only mirrors the inbox.
email.get('/messages', async (c) => {
  const folder = c.req.query('folder') || 'inbox';
  const limitRaw = parseInt(c.req.query('limit') || '50', 10);
  const limit = Math.min(Math.max(limitRaw || 50, 1), 200);
  const skip = Math.max(parseInt(c.req.query('skip') || '0', 10) || 0, 0);
  const search = c.req.query('search');

  // FTS5 search path — when caller supplies ?search=…, query the
  // local FTS5 mirror instead of round-tripping Graph $search.
  // Falls through to live Graph if FTS errors (table missing,
  // bad query syntax, etc.) so the inbox search always works.
  if (search) {
    try {
      const db = getDb(c.env);
      // FTS5 query syntax — escape double-quotes by doubling, wrap as
      // a phrase to make user input behave like a forgiving substring.
      const ftsQuery = `"${search.replace(/"/g, '""')}"`;
      const rows = await query<{
        graph_id: string; conversation_id: string | null; subject: string;
        from_address: string | null; from_name: string | null;
        to_addresses: string | null; cc_addresses: string | null;
        body_preview: string | null;
        has_attachments: number; is_read: number; is_flagged: number;
        importance: string; received_at: string | null; sent_at: string | null;
      }>(
        db,
        `SELECT m.graph_id, m.conversation_id, m.subject, m.from_address, m.from_name,
                m.to_addresses, m.cc_addresses, m.body_preview,
                m.has_attachments, m.is_read, m.is_flagged, m.importance, m.received_at, m.sent_at
         FROM email_messages_fts fts
         JOIN email_messages m ON m.graph_id = fts.graph_id
         WHERE email_messages_fts MATCH ?
           AND m.deleted_at IS NULL
         ORDER BY m.received_at DESC
         LIMIT ?`,
        ftsQuery, limit,
      );
      if (rows.length > 0) {
        const parseAddrs = (json: string | null): Array<{ email: string; name?: string }> => {
          if (!json) return [];
          try { const v = JSON.parse(json); return Array.isArray(v) ? v : []; } catch { return []; }
        };
        return c.json({
          messages: rows.map((r) => ({
            id: r.graph_id,
            conversationId: r.conversation_id || undefined,
            subject: r.subject || '(no subject)',
            fromAddress: r.from_address || '',
            fromName: r.from_name || r.from_address || '',
            toAddresses: parseAddrs(r.to_addresses),
            ccAddresses: parseAddrs(r.cc_addresses),
            bodyPreview: r.body_preview || '',
            hasAttachments: !!r.has_attachments,
            isRead: !!r.is_read,
            isFlagged: !!r.is_flagged,
            importance: r.importance === 'low' || r.importance === 'high' ? r.importance : 'normal',
            receivedAt: r.received_at || '',
            sentAt: r.sent_at || undefined,
          })),
          hasMore: false,
          source: 'fts',
        });
      }
      // FTS hit nothing — fall through to live Graph so "search for a
      // very-recent message that hasn't been synced yet" still works.
    } catch (err) {
      console.error('[Email] FTS search failed, falling back to Graph:', err);
    }
  }

  // Cache path: inbox + no search. Otherwise fall through to live Graph.
  const useCache = !search && (folder === 'inbox');
  if (useCache) {
    try {
      const db = getDb(c.env);
      // Count first — if the cache is empty (pre-first-sync) bail to live.
      const count = await queryFirst<{ n: number }>(
        db, `SELECT COUNT(*) AS n FROM email_messages WHERE deleted_at IS NULL`,
      );
      if ((count?.n ?? 0) > 0) {
        const rows = await query<{
          graph_id: string; conversation_id: string | null; subject: string;
          from_address: string | null; from_name: string | null;
          to_addresses: string | null; cc_addresses: string | null;
          body_preview: string | null; body_html: string | null;
          has_attachments: number; is_read: number; is_flagged: number;
          importance: string; received_at: string | null; sent_at: string | null;
        }>(
          db,
          `SELECT graph_id, conversation_id, subject, from_address, from_name,
                  to_addresses, cc_addresses, body_preview, body_html,
                  has_attachments, is_read, is_flagged, importance, received_at, sent_at
           FROM email_messages
           WHERE deleted_at IS NULL
           ORDER BY received_at DESC
           LIMIT ? OFFSET ?`,
          limit, skip,
        );
        const parseAddrs = (json: string | null): Array<{ email: string; name?: string }> => {
          if (!json) return [];
          try { const v = JSON.parse(json); return Array.isArray(v) ? v : []; } catch { return []; }
        };
        return c.json({
          messages: rows.map((r) => ({
            id: r.graph_id,
            conversationId: r.conversation_id || undefined,
            subject: r.subject || '(no subject)',
            fromAddress: r.from_address || '',
            fromName: r.from_name || r.from_address || '',
            toAddresses: parseAddrs(r.to_addresses),
            ccAddresses: parseAddrs(r.cc_addresses),
            bodyPreview: r.body_preview || '',
            bodyHtml: r.body_html || undefined,
            hasAttachments: !!r.has_attachments,
            isRead: !!r.is_read,
            isFlagged: !!r.is_flagged,
            importance: r.importance === 'low' || r.importance === 'high' ? r.importance : 'normal',
            receivedAt: r.received_at || '',
            sentAt: r.sent_at || undefined,
          })),
          hasMore: rows.length === limit,
          source: 'cache',
        });
      }
    } catch (err) {
      // Don't fail the request on cache-read error — fall through to live.
      console.error('[Email] cache read failed, falling back to Graph:', err);
    }
  }

  // Live path.
  const selectFields = 'id,conversationId,subject,from,sender,toRecipients,ccRecipients,bodyPreview,hasAttachments,isRead,flag,importance,receivedDateTime,sentDateTime';
  let path: string;
  if (search) {
    path = `/me/mailFolders/${encodeURIComponent(folder)}/messages?$search="${encodeURIComponent(search)}"&$top=${limit}&$select=${selectFields}`;
  } else {
    path = `/me/mailFolders/${encodeURIComponent(folder)}/messages?$top=${limit}&$skip=${skip}&$orderby=receivedDateTime%20desc&$select=${selectFields}`;
  }
  try {
    const data = await graphJson<{ value: GraphMessage[]; '@odata.nextLink'?: string }>(c.env, path);
    return c.json({
      messages: data.value.map(mapMessage),
      hasMore: !!data['@odata.nextLink'],
      source: 'live',
    });
  } catch (err) {
    return graphErrorResponse(c, err);
  }
});

// ─── GET /messages/:id — full body + attachments meta ───────
email.get('/messages/:id', async (c) => {
  const id = c.req.param('id');
  try {
    const msg = await graphJson<GraphMessage>(c.env, `/me/messages/${encodeURIComponent(id)}`);
    return c.json(mapMessage(msg));
  } catch (err) {
    return graphErrorResponse(c, err);
  }
});

// ─── GET /messages/:id/attachments ──────────────────────────
email.get('/messages/:id/attachments', async (c) => {
  const id = c.req.param('id');
  try {
    const data = await graphJson<{ value: Array<{ id: string; name: string; contentType: string; size: number; isInline: boolean; contentId?: string }> }>(
      c.env, `/me/messages/${encodeURIComponent(id)}/attachments?$select=id,name,contentType,size,isInline,contentId`,
    );
    return c.json(data.value);
  } catch (err) {
    return graphErrorResponse(c, err);
  }
});

// ════════════════════════════════════════════════════════════
// Mutations — send, reply, mark, move, delete, batch
// ════════════════════════════════════════════════════════════

interface ComposeBody {
  to?: Array<string | { email: string; name?: string }>;
  cc?: Array<string | { email: string; name?: string }>;
  bcc?: Array<string | { email: string; name?: string }>;
  subject?: string;
  body?: string;
  bodyHtml?: string;
}

function toRecipients(list: ComposeBody['to']): Array<{ emailAddress: { address: string; name?: string } }> {
  if (!Array.isArray(list)) return [];
  return list
    .map((r) => (typeof r === 'string' ? { email: r.trim() } : r))
    .filter((r) => r && r.email)
    .map((r) => ({ emailAddress: { address: r.email, name: r.name } }));
}

// ─── POST /send ──────────────────────────────────────────────
// Body: ComposeBody + optional `template_id`. Every call writes an
// audit row (sent or failed) — failure to log MUST NOT fail the send
// (best-effort), since the message has already left.
email.post('/send', async (c) => {
  const user = c.get('user') as { id?: number; userId?: number; username?: string } | undefined;
  const senderId = user?.id ?? user?.userId ?? null;
  const senderUsername = user?.username ?? null;
  let body: ComposeBody & { template_id?: number } = {};
  try { body = await c.req.json(); } catch { /* malformed — fall through */ }
  const to = toRecipients(body.to);
  if (to.length === 0) return c.json({ error: 'At least one recipient is required' }, 400);
  const cc = toRecipients(body.cc);
  const messageBody = body.bodyHtml
    ? { contentType: 'HTML', content: body.bodyHtml }
    : { contentType: 'Text', content: body.body || '' };
  const subject = body.subject || '(no subject)';
  const payload = {
    message: {
      subject,
      body: messageBody,
      toRecipients: to,
      ccRecipients: cc,
      bccRecipients: toRecipients(body.bcc),
    },
    saveToSentItems: true,
  };

  const writeAudit = async (status: 'sent' | 'failed', error: string | null, graphMessageId: string | null) => {
    try {
      const db = getDb(c.env);
      await execute(
        db,
        `INSERT INTO email_audit_log
         (sent_by, sent_by_username, to_addresses, cc_addresses, subject, template_id, graph_message_id, status, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        senderId,
        senderUsername,
        JSON.stringify(to.map((r) => r.emailAddress.address)),
        cc.length ? JSON.stringify(cc.map((r) => r.emailAddress.address)) : null,
        subject,
        body.template_id ?? null,
        graphMessageId,
        status,
        error,
      );
    } catch (auditErr) {
      console.error('[Email] audit write failed:', auditErr);
    }
  };

  try {
    const res = await graphFetch(c.env, '/me/sendMail', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 400);
      await writeAudit('failed', `HTTP ${res.status}: ${detail}`, null);
      return c.json({ error: 'Send failed', detail }, 502);
    }
    // /me/sendMail returns 202 Accepted with no body — Graph queues the send
    // and doesn't return the message id. The audit row records the attempt.
    await writeAudit('sent', null, null);
    return c.json({ success: true });
  } catch (err) {
    await writeAudit('failed', err instanceof Error ? err.message : String(err), null);
    return graphErrorResponse(c, err);
  }
});

// ─── POST /messages/:id/reply ────────────────────────────────
email.post('/messages/:id/reply', async (c) => {
  const id = c.req.param('id');
  try {
    const body = await c.req.json<{ body?: string; bodyHtml?: string; replyAll?: boolean }>();
    const endpoint = body.replyAll ? 'replyAll' : 'reply';
    const payload = {
      comment: body.bodyHtml || body.body || '',
    };
    const res = await graphFetch(c.env, `/me/messages/${encodeURIComponent(id)}/${endpoint}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const detail = await res.text();
      return c.json({ error: 'Reply failed', detail: detail.slice(0, 400) }, 502);
    }
    return c.json({ success: true });
  } catch (err) {
    return graphErrorResponse(c, err);
  }
});

// ─── PATCH /messages/:id — isRead / isFlagged ────────────────
email.patch('/messages/:id', async (c) => {
  const id = c.req.param('id');
  try {
    const body = await c.req.json<{ isRead?: boolean; isFlagged?: boolean }>();
    const update: Record<string, unknown> = {};
    if (typeof body.isRead === 'boolean') update.isRead = body.isRead;
    if (typeof body.isFlagged === 'boolean') {
      update.flag = { flagStatus: body.isFlagged ? 'flagged' : 'notFlagged' };
    }
    if (Object.keys(update).length === 0) return c.json({ error: 'Nothing to update' }, 400);
    const res = await graphFetch(c.env, `/me/messages/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(update),
    });
    if (!res.ok) {
      const detail = await res.text();
      return c.json({ error: 'Update failed', detail: detail.slice(0, 400) }, 502);
    }
    return c.json({ success: true });
  } catch (err) {
    return graphErrorResponse(c, err);
  }
});

// ─── POST /messages/:id/move ─────────────────────────────────
email.post('/messages/:id/move', async (c) => {
  const id = c.req.param('id');
  try {
    const body = await c.req.json<{ folderId?: string }>();
    if (!body.folderId) return c.json({ error: 'folderId required' }, 400);
    // Graph uses well-known names: archive, deleteditems, inbox, junkemail,
    // sentitems, drafts. The client's "archive" maps directly.
    const destination = body.folderId === 'archive' ? 'archive' : body.folderId;
    const res = await graphFetch(c.env, `/me/messages/${encodeURIComponent(id)}/move`, {
      method: 'POST',
      body: JSON.stringify({ destinationId: destination }),
    });
    if (!res.ok) {
      const detail = await res.text();
      return c.json({ error: 'Move failed', detail: detail.slice(0, 400) }, 502);
    }
    return c.json({ success: true });
  } catch (err) {
    return graphErrorResponse(c, err);
  }
});

// ─── DELETE /messages/:id ────────────────────────────────────
email.delete('/messages/:id', async (c) => {
  const id = c.req.param('id');
  try {
    const res = await graphFetch(c.env, `/me/messages/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) {
      const detail = await res.text();
      return c.json({ error: 'Delete failed', detail: detail.slice(0, 400) }, 502);
    }
    return c.json({ success: true });
  } catch (err) {
    return graphErrorResponse(c, err);
  }
});

// ─── POST /messages/batch — action over many ids ────────────
// EmailPage uses this for select-many bulk ops (delete, mark read, etc.).
email.post('/messages/batch', async (c) => {
  try {
    const body = await c.req.json<{ action?: string; ids?: string[] }>();
    const action = body.action;
    const ids = Array.isArray(body.ids) ? body.ids.filter((s) => typeof s === 'string') : [];
    if (!action || ids.length === 0) return c.json({ error: 'action and ids[] required' }, 400);
    if (ids.length > 100) return c.json({ error: 'Max 100 ids per batch' }, 400);

    const ops = ids.map(async (id) => {
      const path = `/me/messages/${encodeURIComponent(id)}`;
      switch (action) {
        case 'markRead':
          return graphFetch(c.env, path, { method: 'PATCH', body: JSON.stringify({ isRead: true }) });
        case 'markUnread':
          return graphFetch(c.env, path, { method: 'PATCH', body: JSON.stringify({ isRead: false }) });
        case 'flag':
          return graphFetch(c.env, path, { method: 'PATCH', body: JSON.stringify({ flag: { flagStatus: 'flagged' } }) });
        case 'unflag':
          return graphFetch(c.env, path, { method: 'PATCH', body: JSON.stringify({ flag: { flagStatus: 'notFlagged' } }) });
        case 'delete':
          return graphFetch(c.env, path, { method: 'DELETE' });
        case 'archive':
          return graphFetch(c.env, `${path}/move`, { method: 'POST', body: JSON.stringify({ destinationId: 'archive' }) });
        default:
          throw new Error(`Unknown action: ${action}`);
      }
    });
    const results = await Promise.allSettled(ops);
    const succeeded = results.filter((r) => r.status === 'fulfilled' && (r.value as Response).ok).length;
    return c.json({ success: true, total: ids.length, succeeded, failed: ids.length - succeeded });
  } catch (err) {
    return graphErrorResponse(c, err);
  }
});

// ─── POST /messages/mark-all-read ────────────────────────────
email.post('/messages/mark-all-read', async (c) => {
  try {
    const body = await c.req.json<{ folder?: string }>();
    const folder = body.folder || 'inbox';
    // No native bulk in Graph — list unread, PATCH each.
    const list = await graphJson<{ value: Array<{ id: string }> }>(
      c.env, `/me/mailFolders/${encodeURIComponent(folder)}/messages?$filter=isRead%20eq%20false&$select=id&$top=200`,
    );
    await Promise.allSettled(list.value.map((m) =>
      graphFetch(c.env, `/me/messages/${encodeURIComponent(m.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ isRead: true }),
      }),
    ));
    return c.json({ success: true, marked: list.value.length });
  } catch (err) {
    return graphErrorResponse(c, err);
  }
});

// ─── Folder CRUD ─────────────────────────────────────────────
email.post('/folders', async (c) => {
  try {
    const body = await c.req.json<{ displayName?: string; parentFolderId?: string }>();
    if (!body.displayName) return c.json({ error: 'displayName required' }, 400);
    const path = body.parentFolderId
      ? `/me/mailFolders/${encodeURIComponent(body.parentFolderId)}/childFolders`
      : `/me/mailFolders`;
    const res = await graphFetch(c.env, path, {
      method: 'POST',
      body: JSON.stringify({ displayName: body.displayName }),
    });
    if (!res.ok) {
      const detail = await res.text();
      return c.json({ error: 'Folder create failed', detail: detail.slice(0, 400) }, 502);
    }
    return c.json(await res.json());
  } catch (err) {
    return graphErrorResponse(c, err);
  }
});

email.patch('/folders/:id', async (c) => {
  const id = c.req.param('id');
  try {
    const body = await c.req.json<{ displayName?: string }>();
    if (!body.displayName) return c.json({ error: 'displayName required' }, 400);
    const res = await graphFetch(c.env, `/me/mailFolders/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ displayName: body.displayName }),
    });
    if (!res.ok) {
      const detail = await res.text();
      return c.json({ error: 'Folder rename failed', detail: detail.slice(0, 400) }, 502);
    }
    return c.json({ success: true });
  } catch (err) {
    return graphErrorResponse(c, err);
  }
});

email.delete('/folders/:id', async (c) => {
  const id = c.req.param('id');
  try {
    const res = await graphFetch(c.env, `/me/mailFolders/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) {
      const detail = await res.text();
      return c.json({ error: 'Folder delete failed', detail: detail.slice(0, 400) }, 502);
    }
    return c.json({ success: true });
  } catch (err) {
    return graphErrorResponse(c, err);
  }
});

// ════════════════════════════════════════════════════════════
// Lightweight stubs — features the client UI calls but we
// don't yet back with real data. Returning the empty/null shape
// the page expects keeps it from logging warnings and lets
// users keep working with the real read/send flow.
// ════════════════════════════════════════════════════════════

email.get('/signature', async (c) => {
  try {
    const db = getDb(c.env);
    const userId = c.get('user' as never) as { id?: number; userId?: number } | undefined;
    const uid = userId?.id ?? userId?.userId;
    if (!uid) return c.json({ signature: '' });
    const row = await queryFirst<{ email_signature: string }>(
      db, `SELECT email_signature FROM users WHERE id = ? LIMIT 1`, uid,
    );
    return c.json({ signature: row?.email_signature || '' });
  } catch {
    return c.json({ signature: '' });
  }
});

email.put('/signature', async (c) => {
  try {
    const body = await c.req.json<{ signature?: string }>();
    const userId = c.get('user' as never) as { id?: number; userId?: number } | undefined;
    const uid = userId?.id ?? userId?.userId;
    if (!uid) return c.json({ error: 'Not authenticated' }, 401);
    const db = getDb(c.env);
    await execute(
      db,
      `UPDATE users SET email_signature = ? WHERE id = ?`,
      typeof body.signature === 'string' ? body.signature : '', uid,
    );
    return c.json({ success: true });
  } catch (err) {
    console.error('[Email] signature save failed:', err);
    return c.json({ error: 'Failed to save signature' }, 500);
  }
});

// ─── Email templates (migration 0082) ───────────────────────
// Response shape matches the EmailTemplate interface in EmailPage.tsx:
// { id, name, category, subject, body, is_system }. `body` aliases the
// `body_html` column; `is_system` is always 0 today (no system templates
// shipped yet) but the field is preserved so the client's filter UI works.
email.get('/templates', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<{
      id: number; name: string; subject: string; body_html: string;
      category: string | null;
    }>(db, `SELECT id, name, subject, body_html, category
            FROM email_templates ORDER BY name ASC LIMIT 500`);
    return c.json(rows.map((r) => ({
      id: r.id,
      name: r.name,
      category: r.category || 'general',
      subject: r.subject || '',
      body: r.body_html || '',
      is_system: 0,
    })));
  } catch (err) {
    console.error('[Email] templates list failed:', err);
    return c.json([]);
  }
});

email.post('/templates', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const body = await c.req.json<{ name?: string; subject?: string; body_html?: string; body?: string; category?: string }>();
    const name = (body.name || '').trim();
    if (!name) return c.json({ error: 'name is required' }, 400);
    const user = c.get('user') as { id?: number; userId?: number } | undefined;
    const uid = user?.id ?? user?.userId ?? null;
    const db = getDb(c.env);
    const html = body.body_html ?? body.body ?? '';
    const result = await db.prepare(
      `INSERT INTO email_templates (name, subject, body_html, category, created_by)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(name, body.subject || '', html, body.category || null, uid).run();
    return c.json({ success: true, id: result.meta.last_row_id });
  } catch (err) {
    console.error('[Email] template create failed:', err);
    return c.json({ error: 'Failed to create template' }, 500);
  }
});

email.patch('/templates/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  const id = parseInt(c.req.param('id'), 10);
  if (!id) return c.json({ error: 'Invalid id' }, 400);
  try {
    const body = await c.req.json<{ name?: string; subject?: string; body_html?: string; body?: string; category?: string | null }>();
    const sets: string[] = [];
    const args: unknown[] = [];
    if (typeof body.name === 'string') { sets.push('name = ?'); args.push(body.name.trim()); }
    if (typeof body.subject === 'string') { sets.push('subject = ?'); args.push(body.subject); }
    if (typeof body.body_html === 'string') { sets.push('body_html = ?'); args.push(body.body_html); }
    else if (typeof body.body === 'string') { sets.push('body_html = ?'); args.push(body.body); }
    if ('category' in body) { sets.push('category = ?'); args.push(body.category ?? null); }
    if (sets.length === 0) return c.json({ error: 'Nothing to update' }, 400);
    sets.push(`updated_at = datetime('now','localtime')`);
    args.push(id);
    const db = getDb(c.env);
    await execute(db, `UPDATE email_templates SET ${sets.join(', ')} WHERE id = ?`, ...args);
    return c.json({ success: true });
  } catch (err) {
    console.error('[Email] template update failed:', err);
    return c.json({ error: 'Failed to update template' }, 500);
  }
});

email.delete('/templates/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  const id = parseInt(c.req.param('id'), 10);
  if (!id) return c.json({ error: 'Invalid id' }, 400);
  try {
    const db = getDb(c.env);
    await execute(db, `DELETE FROM email_templates WHERE id = ?`, id);
    return c.json({ success: true });
  } catch (err) {
    console.error('[Email] template delete failed:', err);
    return c.json({ error: 'Failed to delete template' }, 500);
  }
});

// ─── Audit log read (admin/manager/supervisor only) ─────────
email.get('/audit', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const limit = Math.min(parseInt(c.req.query('limit') || '200', 10) || 200, 500);
    const status = c.req.query('status'); // 'sent' | 'failed' | undefined
    const db = getDb(c.env);
    const rows = status
      ? await query(db, `SELECT * FROM email_audit_log WHERE status = ? ORDER BY sent_at DESC LIMIT ?`, status, limit)
      : await query(db, `SELECT * FROM email_audit_log ORDER BY sent_at DESC LIMIT ?`, limit);
    return c.json(rows);
  } catch (err) {
    console.error('[Email] audit list failed:', err);
    return c.json([]);
  }
});
// ════════════════════════════════════════════════════════════
// Smart links — bind a Graph email to incident/call/warrant/person
// ════════════════════════════════════════════════════════════

const VALID_LINK_TYPES = new Set(['related', 'evidence', 'notification', 'correspondence']);

email.get('/links/:emailGraphId', async (c) => {
  const emailGraphId = c.req.param('emailGraphId');
  try {
    const db = getDb(c.env);
    const rows = await query(
      db,
      `SELECT id, email_graph_id, incident_id, call_id, warrant_id, person_id,
              link_type, notes, linked_by, created_at
       FROM email_links WHERE email_graph_id = ? ORDER BY created_at DESC LIMIT 200`,
      emailGraphId,
    );
    return c.json(rows);
  } catch (err) {
    console.error('[Email] link list failed:', err);
    return c.json([]);
  }
});

email.post('/link', async (c) => {
  try {
    const body = await c.req.json<{
      email_graph_id?: string;
      linkType?: string; link_type?: string;
      notes?: string;
      incidentId?: number; callId?: number; warrantId?: number; personId?: number;
    }>();
    const emailGraphId = (body.email_graph_id || '').trim();
    if (!emailGraphId) return c.json({ error: 'email_graph_id required' }, 400);
    const linkType = body.link_type || body.linkType || 'related';
    if (!VALID_LINK_TYPES.has(linkType)) {
      return c.json({ error: `link_type must be one of ${[...VALID_LINK_TYPES].join(', ')}` }, 400);
    }
    const incident = Number.isFinite(body.incidentId) ? body.incidentId! : null;
    const call = Number.isFinite(body.callId) ? body.callId! : null;
    const warrant = Number.isFinite(body.warrantId) ? body.warrantId! : null;
    const person = Number.isFinite(body.personId) ? body.personId! : null;
    if (incident == null && call == null && warrant == null && person == null) {
      return c.json({ error: 'At least one of incidentId, callId, warrantId, personId is required' }, 400);
    }
    const user = c.get('user') as { id?: number; userId?: number } | undefined;
    const uid = user?.id ?? user?.userId ?? null;
    const db = getDb(c.env);
    const result = await db.prepare(
      `INSERT INTO email_links (email_graph_id, incident_id, call_id, warrant_id, person_id, link_type, notes, linked_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(emailGraphId, incident, call, warrant, person, linkType, body.notes || null, uid).run();
    return c.json({ success: true, id: result.meta.last_row_id });
  } catch (err) {
    console.error('[Email] link create failed:', err);
    return c.json({ error: 'Failed to create link' }, 500);
  }
});

email.delete('/link/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (!id) return c.json({ error: 'Invalid id' }, 400);
  try {
    const db = getDb(c.env);
    await execute(db, `DELETE FROM email_links WHERE id = ?`, id);
    return c.json({ success: true });
  } catch (err) {
    console.error('[Email] link delete failed:', err);
    return c.json({ error: 'Failed to delete link' }, 500);
  }
});

// ════════════════════════════════════════════════════════════
// Batch categorize via Workers AI
// ════════════════════════════════════════════════════════════
// Pulls up to N uncategorized messages, asks a small Llama model to
// pick a label from a fixed taxonomy (no free-form output → predictable
// indices), and writes to email_categories.

const CATEGORY_TAXONOMY = [
  'complaint',
  'records-request',
  'vendor',
  'internal',
  'public-tip',
  'court',
  'recruiting',
  'spam',
  'other',
] as const;

email.post('/categorize/batch', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const url = new URL(c.req.url);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10) || 100, 200);
    const db = getDb(c.env);
    const rows = await query<{ graph_id: string; subject: string; body_preview: string | null; from_address: string | null }>(
      db,
      `SELECT m.graph_id, m.subject, m.body_preview, m.from_address
       FROM email_messages m
       LEFT JOIN email_categories ec ON ec.graph_id = m.graph_id
       WHERE m.deleted_at IS NULL AND ec.graph_id IS NULL
       ORDER BY m.received_at DESC LIMIT ?`,
      limit,
    );
    if (rows.length === 0) return c.json({ processed: 0, categorized: 0 });

    const model = '@cf/meta/llama-3.1-8b-instruct';
    const taxonomyList = CATEGORY_TAXONOMY.join(', ');
    let categorized = 0;

    // Sequential to stay polite to the AI quota; batch size capped above.
    for (const row of rows) {
      try {
        const prompt = `Classify this email into exactly one category from this list: ${taxonomyList}.
Reply with ONLY the category name, lowercase, no explanation.

From: ${row.from_address || 'unknown'}
Subject: ${row.subject || '(none)'}
Preview: ${(row.body_preview || '').slice(0, 500)}`;
        const ai = await c.env.AI.run(model, {
          messages: [
            { role: 'system', content: 'You are a single-word email classifier. Output one category name from the provided list.' },
            { role: 'user', content: prompt },
          ],
        }) as { response?: string };
        const raw = (ai.response || '').trim().toLowerCase().split(/\s+/)[0]?.replace(/[^a-z-]/g, '') || 'other';
        const category = (CATEGORY_TAXONOMY as readonly string[]).includes(raw) ? raw : 'other';
        await execute(
          db,
          `INSERT INTO email_categories (graph_id, category, model)
           VALUES (?, ?, ?)
           ON CONFLICT(graph_id) DO UPDATE SET
             category = excluded.category,
             model = excluded.model,
             categorized_at = datetime('now','localtime')`,
          row.graph_id, category, model,
        );
        categorized++;
      } catch (perRowErr) {
        console.error('[Email] categorize row failed:', row.graph_id, perRowErr);
      }
    }
    return c.json({ processed: rows.length, categorized });
  } catch (err) {
    console.error('[Email] categorize batch failed:', err);
    return c.json({ error: 'Categorize failed', detail: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// ════════════════════════════════════════════════════════════
// Scheduled send
// ════════════════════════════════════════════════════════════

interface ScheduleBody extends ComposeBody {
  scheduled_for?: string;          // ISO8601
}

email.post('/schedule', async (c) => {
  try {
    const body = await c.req.json<ScheduleBody>();
    const to = toRecipients(body.to);
    if (to.length === 0) return c.json({ error: 'At least one recipient is required' }, 400);
    if (!body.scheduled_for) return c.json({ error: 'scheduled_for (ISO8601) is required' }, 400);
    const when = new Date(body.scheduled_for);
    if (isNaN(when.getTime())) return c.json({ error: 'scheduled_for must be a valid ISO8601 timestamp' }, 400);
    if (when.getTime() < Date.now() + 30_000) {
      return c.json({ error: 'scheduled_for must be at least 30 seconds in the future' }, 400);
    }
    const cc = toRecipients(body.cc);
    const bcc = toRecipients(body.bcc);
    const user = c.get('user') as { id?: number; userId?: number; username?: string } | undefined;
    const uid = user?.id ?? user?.userId ?? null;
    const db = getDb(c.env);
    const result = await db.prepare(
      `INSERT INTO scheduled_emails
       (sender_id, sender_username, to_addresses, cc_addresses, bcc_addresses,
        subject, body_html, body_text, scheduled_for, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued')`,
    ).bind(
      uid,
      user?.username ?? null,
      JSON.stringify(to.map((r) => ({ email: r.emailAddress.address, name: r.emailAddress.name }))),
      cc.length ? JSON.stringify(cc.map((r) => ({ email: r.emailAddress.address, name: r.emailAddress.name }))) : null,
      bcc.length ? JSON.stringify(bcc.map((r) => ({ email: r.emailAddress.address, name: r.emailAddress.name }))) : null,
      body.subject || '(no subject)',
      body.bodyHtml || null,
      body.body || null,
      when.toISOString(),
    ).run();
    return c.json({ success: true, id: result.meta.last_row_id, scheduled_for: when.toISOString() });
  } catch (err) {
    console.error('[Email] schedule create failed:', err);
    return c.json({ error: 'Failed to schedule email' }, 500);
  }
});

email.get('/scheduled', async (c) => {
  try {
    const user = c.get('user') as { id?: number; userId?: number; role?: string } | undefined;
    const uid = user?.id ?? user?.userId ?? null;
    const isPrivileged = ['admin', 'manager', 'supervisor'].includes(user?.role || '');
    const db = getDb(c.env);
    const rows = isPrivileged
      ? await query(
          db,
          `SELECT id, sender_id, sender_username, to_addresses, cc_addresses, bcc_addresses,
                  subject, scheduled_for, status, attempts, last_error, sent_at, created_at
           FROM scheduled_emails WHERE status IN ('queued','failed') ORDER BY scheduled_for ASC LIMIT 500`,
        )
      : await query(
          db,
          `SELECT id, sender_id, sender_username, to_addresses, cc_addresses, bcc_addresses,
                  subject, scheduled_for, status, attempts, last_error, sent_at, created_at
           FROM scheduled_emails WHERE sender_id = ? AND status IN ('queued','failed') ORDER BY scheduled_for ASC LIMIT 200`,
          uid,
        );
    return c.json(rows);
  } catch (err) {
    console.error('[Email] scheduled list failed:', err);
    return c.json([]);
  }
});

email.delete('/scheduled/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (!id) return c.json({ error: 'Invalid id' }, 400);
  try {
    const user = c.get('user') as { id?: number; userId?: number; role?: string } | undefined;
    const uid = user?.id ?? user?.userId ?? null;
    const isPrivileged = ['admin', 'manager'].includes(user?.role || '');
    const db = getDb(c.env);
    // Owner or admin/manager can cancel; mark as cancelled rather than
    // hard-delete so the audit trail survives.
    const updated = isPrivileged
      ? await db.prepare(
          `UPDATE scheduled_emails SET status='cancelled', updated_at=datetime('now','localtime')
           WHERE id = ? AND status = 'queued'`,
        ).bind(id).run()
      : await db.prepare(
          `UPDATE scheduled_emails SET status='cancelled', updated_at=datetime('now','localtime')
           WHERE id = ? AND status = 'queued' AND sender_id = ?`,
        ).bind(id, uid).run();
    if (!updated.meta.changes) return c.json({ error: 'Not found or not cancellable' }, 404);
    return c.json({ success: true });
  } catch (err) {
    console.error('[Email] scheduled cancel failed:', err);
    return c.json({ error: 'Failed to cancel' }, 500);
  }
});

export default email;

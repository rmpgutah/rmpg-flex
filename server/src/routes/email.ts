// ============================================================
// Microsoft Email Routes
// ============================================================
// API routes for Microsoft 365 email integration:
// - Admin config (credentials, OAuth, SMTP fallback)
// - Inbox operations (list, read, send, reply, attachments)
// - OAuth2 callback (no JWT — CSRF state validated)

import { Router, Request, Response } from 'express';
import { authenticateToken, requireRole } from '../middleware/auth';
import { getDb } from '../models/database';
import { auditLog } from '../utils/auditLogger';
import { broadcast } from '../utils/websocket';
import { escapeLike, validateParamId, validateParamIdMiddleware } from '../middleware/sanitize';
import type { NextFunction } from 'express';

/** Validate Graph API string IDs (alphanumeric, hyphens, underscores, equals, plus). Blocks path traversal. */
function validateGraphId(req: Request, res: Response, next: NextFunction) {
  const id = req.params.id || req.params.aid;
  if (!id || !/^[A-Za-z0-9_=+\-]{10,250}$/.test(id as string)) {
    return res.status(400).json({ error: 'Invalid message ID', code: 'INVALID_MESSAGE_ID' });
  }
  next();
}
import { localNow } from '../utils/timeUtils';
import config from '../config';
import {
  CONFIG_KEYS,
  GRAPH_SCOPES,
  getConfigValue,
  setConfigValue,
  deleteConfigValue,
  getDecryptedValue,
  getAuthorizationUrl,
  exchangeCodeForTokens,
  getGraphClient,
  testConnection,
  getStatus,
  isConfigured,
  isEnabled,
  isAuthorized,
  clearCachedAuth,
} from '../utils/msGraphClient';
import { testSMTPConnection } from '../utils/smtpClient';
import { sendEmail } from '../utils/emailSender';
import { syncNow, restartEmailPoller } from '../utils/emailPoller';

const router = Router();

/** Convert plain text to a proper HTML email body.
 *  Escapes entities, converts basic markdown-like syntax,
 *  converts newlines to <br>, wraps in styled HTML document. */
function textToEmailHtml(text: string, signature?: string): string {
  let fullText = text || '';
  if (signature) {
    fullText += '\n\n--\n' + signature;
  }
  let escaped = fullText
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  // Basic markdown: **bold**, *italic*, [text](url)
  escaped = escaped.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  escaped = escaped.replace(/\*(.+?)\*/g, '<em>$1</em>');
  escaped = escaped.replace(/\[(.+?)\]\((.+?)\)/g, (_match, linkText, url) => {
    // Only allow safe URL schemes — block javascript:, data:, vbscript: etc.
    const trimmedUrl = (url || '').trim().toLowerCase();
    if (trimmedUrl.startsWith('http://') || trimmedUrl.startsWith('https://') || trimmedUrl.startsWith('mailto:')) {
      // Escape URL for safe insertion into href attribute — prevents attribute injection
      const safeUrl = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
      return `<a href="${safeUrl}" style="color:#1a5a9e;">${linkText}</a>`;
    }
    return `${linkText} (${url})`;
  });
  const bodyHtml = escaped.replace(/\n/g, '<br>');
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:16px;font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.5;color:#1a1a1a;">
${bodyHtml}
</body></html>`;
}

/** Get a user's email signature from system_config. */
function getUserSignature(userId: number): string | null {
  const db = getDb();
  const row = db.prepare("SELECT config_value FROM system_config WHERE config_key = ?").get(`email_signature_${userId}`) as { config_value: string } | undefined;
  return row?.config_value || null;
}

// ─── PUBLIC: OAuth callback (no JWT — redirect from Microsoft) ───

router.get('/oauth/callback', async (req: Request, res: Response) => {
  try {
    const { code, state, error, error_description } = req.query;

    if (error) {
      console.error('[OAuth] Microsoft returned error:', error, error_description);
      res.redirect('/admin?tab=email&status=error&message=Microsoft+authorization+failed');
      return;
    }

    if (!code || !state) {
      res.redirect('/admin?tab=email&status=error&message=Missing+code+or+state');
      return;
    }

    // Validate CSRF state
    const storedState = getConfigValue(CONFIG_KEYS.oauthState);
    if (!storedState || storedState !== String(state)) {
      res.redirect('/admin?tab=email&status=error&message=Invalid+state+token');
      return;
    }

    // Clear state to prevent replay
    deleteConfigValue(CONFIG_KEYS.oauthState);

    // Exchange code for tokens — use hardcoded production domain to prevent Host header injection
    const host = config.isProduction ? 'rmpgutah.us' : (req.get('host') || 'localhost:3001');
    const redirectUri = `https://${host}/api/email/oauth/callback`;
    await exchangeCodeForTokens(String(code), redirectUri);

    // Enable integration and start poller
    setConfigValue(CONFIG_KEYS.enabled, 'true');
    restartEmailPoller();

    console.log('[OAuth] Microsoft email authorized successfully');
    res.redirect('/admin?tab=email&status=authorized');
  } catch (err: any) {
    console.error('[OAuth] Token exchange failed:', err.message);
    res.redirect('/admin?tab=email&status=error&message=Token+exchange+failed');
  }
});

// ─── All remaining routes require JWT auth ───

router.use(authenticateToken);

// ============================================================
// USER ENDPOINTS (all authenticated users)
// ============================================================

// GET /api/email/status — Integration status
router.get('/status', (_req: Request, res: Response) => {
  try {
    const status = getStatus();
    const db = getDb();
    const cached = db.prepare('SELECT COUNT(*) as count FROM email_cache').get() as { count: number };
    res.json({ ...status, cachedMessages: cached?.count || 0 });
  } catch (err: any) {
    console.error('Email route error:', err.message);
    res.status(500).json({ error: 'Failed to email route', code: 'EMAIL_ROUTE_ERROR' });
  }
});

// GET /api/email/signature — Get current user's email signature
router.get('/signature', (req: Request, res: Response) => {
  try {
    const signature = getUserSignature(req.user!.userId);
    res.json({ signature: signature || '' });
  } catch (err: any) {
    console.error('Email route error:', err.message);
    res.status(500).json({ error: 'Failed to email route', code: 'EMAIL_ROUTE_ERROR' });
  }
});

// PUT /api/email/signature — Save current user's email signature
router.put('/signature', (req: Request, res: Response) => {
  try {
    const { signature } = req.body;
    if (signature !== undefined && typeof signature !== 'string') {
      res.status(400).json({ error: 'Signature must be a string', code: 'SIGNATURE_MUST_BE_A' });
      return;
    }
    if (signature && signature.length > 5000) {
      res.status(400).json({ error: 'Signature must be 5000 characters or less', code: 'SIGNATURE_MUST_BE_5000' });
      return;
    }
    const db = getDb();
    const key = `email_signature_${req.user!.userId}`;
    // Delete existing signature first, then insert if non-empty
    db.prepare("DELETE FROM system_config WHERE config_key = ?").run(key);
    if (signature && signature.trim()) {
      db.prepare("INSERT INTO system_config (config_key, config_value, category) VALUES (?, ?, 'email')")
        .run(key, signature.trim());
    }
    res.json({ success: true });
  } catch (err: any) {
    console.error('Email route error:', err.message);
    res.status(500).json({ error: 'Failed to email route', code: 'EMAIL_ROUTE_ERROR' });
  }
});

// GET /api/email/unread-count — Unread count (for nav badge)
router.get('/unread-count', (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const row = db.prepare(
      "SELECT COUNT(*) as count FROM email_cache WHERE folder_id = 'inbox' AND is_read = 0"
    ).get() as { count: number };
    res.json({ count: row?.count || 0 });
  } catch (err: any) {
    console.error('Email route error:', err.message);
    res.status(500).json({ error: 'Failed to email route', code: 'EMAIL_ROUTE_ERROR' });
  }
});

// GET /api/email/folders — List mailbox folders
router.get('/folders', async (req: Request, res: Response) => {
  try {
    if (!isAuthorized()) {
      res.json([]);
      return;
    }

    // Try live from Graph, fall back to cache
    try {
      const client = await getGraphClient();
      const result = await client
        .api('/me/mailFolders')
        .select('id,displayName,parentFolderId,totalItemCount,unreadItemCount,childFolderCount')
        .top(50)
        .get();
      res.json(result.value || []);
    } catch {
      // Fall back to cached
      const db = getDb();
      const folders = db.prepare('SELECT * FROM email_folders ORDER BY display_name').all();
      res.json(folders.map((f: any) => ({
        id: f.graph_id,
        displayName: f.display_name,
        parentFolderId: f.parent_folder_id,
        totalItemCount: f.total_count,
        unreadItemCount: f.unread_count,
      })));
    }
  } catch (err: any) {
    console.error('Email route error:', err.message);
    res.status(500).json({ error: 'Failed to email route', code: 'EMAIL_ROUTE_ERROR' });
  }
});

// GET /api/email/folders/:id/children — List child folders
router.get('/folders/:id/children', validateGraphId, async (req: Request, res: Response) => {
  try {
    if (!isAuthorized()) { res.json([]); return; }
    const client = await getGraphClient();
    const result = await client
      .api(`/me/mailFolders/${req.params.id}/childFolders`)
      .select('id,displayName,parentFolderId,totalItemCount,unreadItemCount,childFolderCount')
      .top(50)
      .get();
    res.json(result.value || []);
  } catch (err: any) {
    console.error('Email route error:', err.message);
    res.status(500).json({ error: 'Failed to email route', code: 'EMAIL_ROUTE_ERROR' });
  }
});

// POST /api/email/folders — Create a new folder
router.post('/folders', async (req: Request, res: Response) => {
  try {
    if (!isAuthorized()) { res.status(503).json({ error: 'Email not authorized', code: 'EMAIL_NOT_AUTHORIZED' }); return; }
    const { displayName, parentFolderId } = req.body;
    if (!displayName?.trim()) { res.status(400).json({ error: 'Folder name required', code: 'FOLDER_NAME_REQUIRED' }); return; }
    if (displayName.length > 256) { res.status(400).json({ error: 'Folder name must be 256 characters or less', code: 'FOLDER_NAME_MUST_BE' }); return; }
    if (parentFolderId && !/^[A-Za-z0-9_=+\-]{10,250}$/.test(parentFolderId)) {
      res.status(400).json({ error: 'Invalid parent folder ID', code: 'INVALID_PARENT_FOLDER_ID' }); return;
    }

    const client = await getGraphClient();
    const apiPath = parentFolderId
      ? `/me/mailFolders/${parentFolderId}/childFolders`
      : '/me/mailFolders';

    const folder = await client.api(apiPath).post({ displayName: displayName.trim() });
    auditLog(req, 'CREATE', 'email_folder', 0, JSON.stringify({ displayName, parentFolderId }));
    res.json(folder);
  } catch (err: any) {
    console.error('Email route error:', err.message);
    res.status(500).json({ error: 'Failed to email route', code: 'EMAIL_ROUTE_ERROR' });
  }
});

// PATCH /api/email/folders/:id — Rename a folder
router.patch('/folders/:id', validateGraphId, async (req: Request, res: Response) => {
  try {
    if (!isAuthorized()) { res.status(503).json({ error: 'Email not authorized', code: 'EMAIL_NOT_AUTHORIZED' }); return; }
    const { displayName } = req.body;
    if (!displayName?.trim()) { res.status(400).json({ error: 'Folder name required', code: 'FOLDER_NAME_REQUIRED' }); return; }

    const client = await getGraphClient();
    await client.api(`/me/mailFolders/${req.params.id}`).update({ displayName: displayName.trim() });
    auditLog(req, 'UPDATE', 'email_folder', 0, JSON.stringify({ folderId: req.params.id, displayName }));
    res.json({ success: true });
  } catch (err: any) {
    console.error('Email route error:', err.message);
    res.status(500).json({ error: 'Failed to email route', code: 'EMAIL_ROUTE_ERROR' });
  }
});

// DELETE /api/email/folders/:id — Delete a folder
router.delete('/folders/:id', validateGraphId, async (req: Request, res: Response) => {
  try {
    if (!isAuthorized()) { res.status(503).json({ error: 'Email not authorized', code: 'EMAIL_NOT_AUTHORIZED' }); return; }
    const client = await getGraphClient();
    await client.api(`/me/mailFolders/${req.params.id}`).delete();
    auditLog(req, 'DELETE', 'email_folder', 0, JSON.stringify({ folderId: req.params.id }));
    res.json({ success: true });
  } catch (err: any) {
    console.error('Email route error:', err.message);
    res.status(500).json({ error: 'Failed to email route', code: 'EMAIL_ROUTE_ERROR' });
  }
});

// GET /api/email/messages — List messages (paginated, filterable)
router.get('/messages', async (req: Request, res: Response) => {
  try {
    const {
      folder = 'inbox',
      page = '1',
      per_page = '25',
      search,
    } = req.query;

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const perPage = Math.min(50, Math.max(1, parseInt(per_page as string, 10) || 25));

    // Try live from Graph API
    if (isAuthorized()) {
      try {
        const client = await getGraphClient();
        // Sanitize folder ID to prevent path traversal in Graph API URL
        const safeFolder = String(folder).replace(/[^a-zA-Z0-9_-]/g, '');
        let apiPath = safeFolder === 'inbox'
          ? '/me/mailFolders/inbox/messages'
          : `/me/mailFolders/${safeFolder}/messages`;

        let query = client
          .api(apiPath)
          .select('id,conversationId,subject,from,toRecipients,ccRecipients,bodyPreview,hasAttachments,isRead,flag,importance,receivedDateTime,sentDateTime')
          .orderby('receivedDateTime desc')
          .top(perPage)
          .skip((pageNum - 1) * perPage);

        if (search) {
          // Sanitize search term — escape double quotes to prevent KQL injection
          const safeSearch = String(search).replace(/"/g, '\\"').slice(0, 200);
          query = query.search(`"${safeSearch}"`);
        }

        const result = await query.get();

        res.json({
          messages: (result.value || []).map((msg: any) => ({
            id: msg.id,
            conversationId: msg.conversationId,
            subject: msg.subject || '(No subject)',
            fromAddress: msg.from?.emailAddress?.address || '',
            fromName: msg.from?.emailAddress?.name || '',
            toAddresses: (msg.toRecipients || []).map((r: any) => ({
              email: r.emailAddress?.address,
              name: r.emailAddress?.name,
            })),
            ccAddresses: (msg.ccRecipients || []).map((r: any) => ({
              email: r.emailAddress?.address,
              name: r.emailAddress?.name,
            })),
            bodyPreview: msg.bodyPreview || '',
            hasAttachments: msg.hasAttachments || false,
            isRead: msg.isRead || false,
            isFlagged: msg.flag?.flagStatus === 'flagged',
            importance: msg.importance || 'normal',
            receivedAt: msg.receivedDateTime,
            sentAt: msg.sentDateTime,
          })),
          hasMore: !!(result['@odata.nextLink']),
        });
        return;
      } catch (err: any) {
        console.error('[Email] Graph message fetch failed, using cache:', err.message);
      }
    }

    // Fallback to cached messages
    const db = getDb();
    const conditions: string[] = [];
    const params: any[] = [];

    if (folder && folder !== 'all') {
      conditions.push('folder_id = ?');
      params.push(folder);
    }

    if (search) {
      conditions.push("(subject LIKE ? ESCAPE '\\' OR from_address LIKE ? ESCAPE '\\' OR from_name LIKE ? ESCAPE '\\' OR body_preview LIKE ? ESCAPE '\\')");
      const term = `%${escapeLike(String(search))}%`;
      params.push(term, term, term, term);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (pageNum - 1) * perPage;

    const total = (db.prepare(`SELECT COUNT(*) as count FROM email_cache ${where}`).get(...params) as any)?.count || 0;
    const rows = db.prepare(`SELECT * FROM email_cache ${where} ORDER BY received_at DESC LIMIT ? OFFSET ?`).all(...params, perPage, offset) as any[];

    const safeJsonParse = (str: string | null | undefined, fallback: any[] = []): any[] => {
      if (!str) return fallback;
      try { return JSON.parse(str); } catch { return fallback; }
    };

    res.json({
      messages: rows.map(r => ({
        id: r.graph_id,
        conversationId: r.conversation_id,
        subject: r.subject,
        fromAddress: r.from_address,
        fromName: r.from_name,
        toAddresses: safeJsonParse(r.to_addresses),
        ccAddresses: safeJsonParse(r.cc_addresses),
        bodyPreview: r.body_preview,
        hasAttachments: !!r.has_attachments,
        isRead: !!r.is_read,
        isFlagged: !!r.is_flagged,
        importance: r.importance,
        receivedAt: r.received_at,
        sentAt: r.sent_at,
      })),
      hasMore: offset + perPage < total,
      total,
    });
  } catch (err: any) {
    console.error('Email route error:', err.message);
    res.status(500).json({ error: 'Failed to email route', code: 'EMAIL_ROUTE_ERROR' });
  }
});

// POST /api/email/messages/batch — Batch operations on multiple messages
// IMPORTANT: Must be registered before /messages/:id to avoid Express treating "batch" as an ID
router.post('/messages/batch', async (req: Request, res: Response) => {
  try {
    if (!isAuthorized()) { res.status(503).json({ error: 'Email not authorized', code: 'EMAIL_NOT_AUTHORIZED' }); return; }

    const { action, ids } = req.body;
    if (!action || !Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: 'Action and ids[] required', code: 'ACTION_AND_IDS_REQUIRED' });
      return;
    }
    const VALID_BATCH_ACTIONS = ['delete', 'archive', 'markRead', 'markUnread'];
    if (!VALID_BATCH_ACTIONS.includes(action)) {
      res.status(400).json({ error: `Invalid action. Must be one of: ${VALID_BATCH_ACTIONS.join(', ')}` });
      return;
    }
    // Validate all IDs are valid Graph IDs
    for (const id of ids) {
      if (typeof id !== 'string' || !/^[A-Za-z0-9_=+\-]{10,250}$/.test(id)) {
        res.status(400).json({ error: 'Invalid message ID in batch', code: 'INVALID_MESSAGE_ID_IN' });
        return;
      }
    }

    const client = await getGraphClient();
    const db = getDb();
    let success = 0;
    let failed = 0;

    for (const id of ids.slice(0, 50)) {
      try {
        if (action === 'delete') {
          await client.api(`/me/messages/${id}/move`).post({ destinationId: 'deleteditems' });
          db.prepare('DELETE FROM email_cache WHERE graph_id = ?').run(id);
        } else if (action === 'archive') {
          await client.api(`/me/messages/${id}/move`).post({ destinationId: 'archive' });
          db.prepare('DELETE FROM email_cache WHERE graph_id = ?').run(id);
        } else if (action === 'markRead') {
          await client.api(`/me/messages/${id}`).update({ isRead: true });
          db.prepare('UPDATE email_cache SET is_read = 1 WHERE graph_id = ?').run(id);
        } else if (action === 'markUnread') {
          await client.api(`/me/messages/${id}`).update({ isRead: false });
          db.prepare('UPDATE email_cache SET is_read = 0 WHERE graph_id = ?').run(id);
        }
        success++;
      } catch {
        failed++;
      }
    }

    auditLog(req, 'BATCH_EMAIL', 'email', 0, JSON.stringify({ action, count: ids.length, success, failed }));
    res.json({ success, failed });
  } catch (err: any) {
    console.error('Email route error:', err.message);
    res.status(500).json({ error: 'Failed to email route', code: 'EMAIL_ROUTE_ERROR' });
  }
});

// POST /api/email/messages/mark-all-read — Mark all messages in a folder as read
router.post('/messages/mark-all-read', async (req: Request, res: Response) => {
  try {
    if (!isAuthorized()) { res.status(503).json({ error: 'Email not authorized', code: 'EMAIL_NOT_AUTHORIZED' }); return; }

    const { folder = 'inbox' } = req.body;
    // Validate folder ID to prevent injection
    if (typeof folder !== 'string' || folder.length > 250) {
      res.status(400).json({ error: 'Invalid folder', code: 'INVALID_FOLDER' }); return;
    }
    const client = await getGraphClient();
    const db = getDb();

    const unread = db.prepare(
      'SELECT graph_id FROM email_cache WHERE folder_id = ? AND is_read = 0'
    ).all(folder) as { graph_id: string }[];

    let success = 0;
    for (const row of unread.slice(0, 100)) {
      try {
        await client.api(`/me/messages/${row.graph_id}`).update({ isRead: true });
        success++;
      } catch { /* skip individual failures */ }
    }

    db.prepare('UPDATE email_cache SET is_read = 1 WHERE folder_id = ? AND is_read = 0').run(folder);

    auditLog(req, 'MARK_ALL_READ', 'email', 0, JSON.stringify({ folder, count: success }));
    res.json({ success: true, marked: success });
  } catch (err: any) {
    console.error('Email route error:', err.message);
    res.status(500).json({ error: 'Failed to email route', code: 'EMAIL_ROUTE_ERROR' });
  }
});

// GET /api/email/messages/:id — Full message with body
router.get('/messages/:id', validateGraphId, async (req: Request, res: Response) => {
  try {
    if (!isAuthorized()) {
      res.status(503).json({ error: 'Email not authorized', code: 'EMAIL_NOT_AUTHORIZED' });
      return;
    }

    const client = await getGraphClient();
    const msg = await client
      .api(`/me/messages/${req.params.id}`)
      .select('id,conversationId,subject,from,toRecipients,ccRecipients,body,bodyPreview,hasAttachments,isRead,flag,importance,receivedDateTime,sentDateTime')
      .get();

    // Mark as read in Graph
    if (!msg.isRead) {
      client.api(`/me/messages/${req.params.id}`).update({ isRead: true }).catch((err) => { console.error('[Email] Background operation failed:', err.message || err); });
      // Also update cache
      const db = getDb();
      db.prepare('UPDATE email_cache SET is_read = 1 WHERE graph_id = ?').run(req.params.id);
    }

    res.json({
      id: msg.id,
      conversationId: msg.conversationId,
      subject: msg.subject || '(No subject)',
      fromAddress: msg.from?.emailAddress?.address || '',
      fromName: msg.from?.emailAddress?.name || '',
      toAddresses: (msg.toRecipients || []).map((r: any) => ({
        email: r.emailAddress?.address,
        name: r.emailAddress?.name,
      })),
      ccAddresses: (msg.ccRecipients || []).map((r: any) => ({
        email: r.emailAddress?.address,
        name: r.emailAddress?.name,
      })),
      bodyHtml: msg.body?.content || '',
      bodyPreview: msg.bodyPreview || '',
      hasAttachments: msg.hasAttachments || false,
      isRead: true,
      isFlagged: msg.flag?.flagStatus === 'flagged',
      importance: msg.importance || 'normal',
      receivedAt: msg.receivedDateTime,
      sentAt: msg.sentDateTime,
    });
  } catch (err: any) {
    console.error('Email route error:', err.message);
    res.status(500).json({ error: 'Failed to email route', code: 'EMAIL_ROUTE_ERROR' });
  }
});

// GET /api/email/messages/:id/attachments — List attachments
router.get('/messages/:id/attachments', validateGraphId, async (req: Request, res: Response) => {
  try {
    if (!isAuthorized()) { res.status(503).json({ error: 'Email not authorized', code: 'EMAIL_NOT_AUTHORIZED' }); return; }

    const client = await getGraphClient();
    const result = await client
      .api(`/me/messages/${req.params.id}/attachments`)
      .select('id,name,contentType,size,isInline,contentId')
      .get();

    res.json((result.value || []).map((a: any) => ({
      id: a.id,
      name: a.name,
      contentType: a.contentType,
      size: a.size,
      isInline: a.isInline || false,
      contentId: a.contentId || a.id,
    })));
  } catch (err: any) {
    console.error('Email route error:', err.message);
    res.status(500).json({ error: 'Failed to email route', code: 'EMAIL_ROUTE_ERROR' });
  }
});

// GET /api/email/messages/:id/attachments/:aid — Download attachment
router.get('/messages/:id/attachments/:aid', validateGraphId, async (req: Request, res: Response) => {
  try {
    if (!isAuthorized()) { res.status(503).json({ error: 'Email not authorized', code: 'EMAIL_NOT_AUTHORIZED' }); return; }

    const client = await getGraphClient();
    const attachment = await client
      .api(`/me/messages/${req.params.id}/attachments/${req.params.aid}`)
      .get();

    const content = Buffer.from(attachment.contentBytes, 'base64');
    res.setHeader('Content-Type', attachment.contentType || 'application/octet-stream');
    const safeName = (attachment.name || 'attachment').replace(/[\r\n\0"]/g, '_');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    res.setHeader('Content-Length', content.length.toString());
    res.send(content);
  } catch (err: any) {
    console.error('Email route error:', err.message);
    res.status(500).json({ error: 'Failed to email route', code: 'EMAIL_ROUTE_ERROR' });
  }
});

// POST /api/email/send — Send new email (supports BCC + file attachments)
router.post('/send', async (req: Request, res: Response) => {
  try {
    const { to, cc, bcc, subject, body, attachments } = req.body;
    if (!to || !subject) {
      res.status(400).json({ error: 'To and subject are required', code: 'TO_AND_SUBJECT_ARE' });
      return;
    }
    if (typeof subject !== 'string' || subject.length > 998) {
      res.status(400).json({ error: 'Subject must be a string of 998 characters or less', code: 'SUBJECT_MUST_BE_A' });
      return;
    }
    if (body && typeof body !== 'string') {
      res.status(400).json({ error: 'Body must be a string', code: 'BODY_MUST_BE_A' });
      return;
    }
    if (body && body.length > 500000) {
      res.status(400).json({ error: 'Body too large (max 500KB)', code: 'BODY_TOO_LARGE_MAX' });
      return;
    }

    const toList = Array.isArray(to) ? to : [to];
    const ccList = cc ? (Array.isArray(cc) ? cc : [cc]) : undefined;
    const bccList = bcc ? (Array.isArray(bcc) ? bcc : [bcc]) : undefined;

    // Validate email addresses
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const allRecipients = [...toList, ...(ccList || []), ...(bccList || [])];
    if (allRecipients.length > 100) {
      res.status(400).json({ error: 'Too many recipients (max 100)', code: 'TOO_MANY_RECIPIENTS_MAX' });
      return;
    }
    for (const addr of allRecipients) {
      if (typeof addr !== 'string' || !emailRegex.test(addr.trim())) {
        res.status(400).json({ error: `Invalid email address: ${String(addr).slice(0, 50)}` });
        return;
      }
    }

    // Validate attachments
    if (attachments && (!Array.isArray(attachments) || attachments.length > 25)) {
      res.status(400).json({ error: 'Attachments must be an array of 25 or fewer items', code: 'ATTACHMENTS_MUST_BE_AN' });
      return;
    }

    const signature = getUserSignature(req.user!.userId);

    // Build attachment array from client-sent base64 data
    const emailAttachments = (attachments || []).map((att: { name: string; contentType: string; contentBytes: string }) => ({
      filename: att.name,
      content: Buffer.from(att.contentBytes, 'base64'),
      contentType: att.contentType || 'application/octet-stream',
    }));

    const sent = await sendEmail({
      to: toList,
      cc: ccList,
      bcc: bccList,
      subject,
      html: textToEmailHtml(body || '', signature || undefined),
      attachments: emailAttachments.length > 0 ? emailAttachments : undefined,
    });

    if (sent) {
      auditLog(req, 'SEND_EMAIL', 'email', 0, JSON.stringify({ to: toList, subject, attachmentCount: emailAttachments.length }));
      broadcast('admin', 'email:sent', { to: toList, subject });
      res.json({ success: true });
    } else {
      res.status(500).json({ error: 'Failed to send email', code: 'FAILED_TO_SEND_EMAIL' });
    }
  } catch (err: any) {
    console.error('Email route error:', err.message);
    res.status(500).json({ error: 'Failed to email route', code: 'EMAIL_ROUTE_ERROR' });
  }
});

// POST /api/email/messages/:id/reply — Reply to message
router.post('/messages/:id/reply', validateGraphId, async (req: Request, res: Response) => {
  try {
    if (!isAuthorized()) { res.status(503).json({ error: 'Email not authorized', code: 'EMAIL_NOT_AUTHORIZED' }); return; }

    const { body } = req.body;
    const client = await getGraphClient();
    const signature = getUserSignature(req.user!.userId);

    await client.api(`/me/messages/${req.params.id}/reply`).post({
      comment: textToEmailHtml(body || '', signature || undefined),
    });

    auditLog(req, 'REPLY_EMAIL', 'email', 0, JSON.stringify({ messageId: req.params.id }));
    res.json({ success: true });
  } catch (err: any) {
    console.error('Email route error:', err.message);
    res.status(500).json({ error: 'Failed to email route', code: 'EMAIL_ROUTE_ERROR' });
  }
});

// POST /api/email/messages/:id/reply-all — Reply all
router.post('/messages/:id/reply-all', validateGraphId, async (req: Request, res: Response) => {
  try {
    if (!isAuthorized()) { res.status(503).json({ error: 'Email not authorized', code: 'EMAIL_NOT_AUTHORIZED' }); return; }

    const { body } = req.body;
    const client = await getGraphClient();
    const signature = getUserSignature(req.user!.userId);

    await client.api(`/me/messages/${req.params.id}/replyAll`).post({
      comment: textToEmailHtml(body || '', signature || undefined),
    });

    auditLog(req, 'REPLY_ALL_EMAIL', 'email', 0, JSON.stringify({ messageId: req.params.id }));
    res.json({ success: true });
  } catch (err: any) {
    console.error('Email route error:', err.message);
    res.status(500).json({ error: 'Failed to email route', code: 'EMAIL_ROUTE_ERROR' });
  }
});

// POST /api/email/messages/:id/forward — Forward message
router.post('/messages/:id/forward', validateGraphId, async (req: Request, res: Response) => {
  try {
    if (!isAuthorized()) { res.status(503).json({ error: 'Email not authorized', code: 'EMAIL_NOT_AUTHORIZED' }); return; }

    const { to, body } = req.body;
    if (!to) { res.status(400).json({ error: 'Recipient required', code: 'RECIPIENT_REQUIRED' }); return; }

    const toList = Array.isArray(to) ? to : [to];
    const emailRegexFwd = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    for (const addr of toList) {
      if (typeof addr !== 'string' || !emailRegexFwd.test(addr.trim())) {
        res.status(400).json({ error: `Invalid email address: ${String(addr).slice(0, 50)}` }); return;
      }
    }
    if (toList.length > 50) { res.status(400).json({ error: 'Too many recipients (max 50)', code: 'TOO_MANY_RECIPIENTS_MAX' }); return; }
    const client = await getGraphClient();

    const signature = getUserSignature(req.user!.userId);
    await client.api(`/me/messages/${req.params.id}/forward`).post({
      comment: textToEmailHtml(body || '', signature || undefined),
      toRecipients: toList.map((email: string) => ({
        emailAddress: { address: email.trim() },
      })),
    });

    auditLog(req, 'FORWARD_EMAIL', 'email', 0, JSON.stringify({ messageId: req.params.id, to: toList }));
    res.json({ success: true });
  } catch (err: any) {
    console.error('Email route error:', err.message);
    res.status(500).json({ error: 'Failed to email route', code: 'EMAIL_ROUTE_ERROR' });
  }
});

// PATCH /api/email/messages/:id — Update message (read/unread, flag)
router.patch('/messages/:id', validateGraphId, async (req: Request, res: Response) => {
  try {
    if (!isAuthorized()) { res.status(503).json({ error: 'Email not authorized', code: 'EMAIL_NOT_AUTHORIZED' }); return; }

    const { isRead, isFlagged } = req.body;
    const client = await getGraphClient();

    const updates: any = {};
    if (isRead !== undefined) updates.isRead = isRead;
    if (isFlagged !== undefined) {
      updates.flag = { flagStatus: isFlagged ? 'flagged' : 'notFlagged' };
    }

    await client.api(`/me/messages/${req.params.id}`).update(updates);

    // Update cache
    const db = getDb();
    if (isRead !== undefined) {
      db.prepare('UPDATE email_cache SET is_read = ? WHERE graph_id = ?').run(isRead ? 1 : 0, req.params.id);
    }
    if (isFlagged !== undefined) {
      db.prepare('UPDATE email_cache SET is_flagged = ? WHERE graph_id = ?').run(isFlagged ? 1 : 0, req.params.id);
    }

    res.json({ success: true });
  } catch (err: any) {
    console.error('Email route error:', err.message);
    res.status(500).json({ error: 'Failed to email route', code: 'EMAIL_ROUTE_ERROR' });
  }
});

// DELETE /api/email/messages/:id — Move to trash
router.delete('/messages/:id', validateGraphId, async (req: Request, res: Response) => {
  try {
    if (!isAuthorized()) { res.status(503).json({ error: 'Email not authorized', code: 'EMAIL_NOT_AUTHORIZED' }); return; }

    const client = await getGraphClient();

    // Move to Deleted Items folder
    await client.api(`/me/messages/${req.params.id}/move`).post({
      destinationId: 'deleteditems',
    });

    // Remove from cache
    const db = getDb();
    db.prepare('DELETE FROM email_cache WHERE graph_id = ?').run(req.params.id);

    auditLog(req, 'DELETE_EMAIL', 'email', 0, JSON.stringify({ messageId: req.params.id }));
    res.json({ success: true });
  } catch (err: any) {
    console.error('Email route error:', err.message);
    res.status(500).json({ error: 'Failed to email route', code: 'EMAIL_ROUTE_ERROR' });
  }
});

// POST /api/email/messages/:id/move — Move to folder
router.post('/messages/:id/move', validateGraphId, async (req: Request, res: Response) => {
  try {
    if (!isAuthorized()) { res.status(503).json({ error: 'Email not authorized', code: 'EMAIL_NOT_AUTHORIZED' }); return; }

    const { folderId } = req.body;
    if (!folderId) { res.status(400).json({ error: 'Folder ID required', code: 'FOLDER_ID_REQUIRED' }); return; }

    const client = await getGraphClient();
    await client.api(`/me/messages/${req.params.id}/move`).post({
      destinationId: folderId,
    });

    // Update cache folder
    const db = getDb();
    db.prepare('UPDATE email_cache SET folder_id = ? WHERE graph_id = ?').run(folderId, req.params.id);

    res.json({ success: true });
  } catch (err: any) {
    console.error('Email route error:', err.message);
    res.status(500).json({ error: 'Failed to email route', code: 'EMAIL_ROUTE_ERROR' });
  }
});

// ============================================================
// EMAIL TEMPLATES
// ============================================================

// GET /api/email/templates — List all templates
router.get('/templates', (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const templates = db.prepare(`
      SELECT t.*, u.full_name as created_by_name
      FROM email_templates t
      LEFT JOIN users u ON t.created_by = u.id
      ORDER BY t.category, t.name
    
      LIMIT 1000
    `).all();
    res.json(templates);
  } catch (err: any) {
    console.error('Email route error:', err.message);
    res.status(500).json({ error: 'Failed to email route', code: 'EMAIL_ROUTE_ERROR' });
  }
});

// GET /api/email/templates/:id — Get single template
router.get('/templates/:id', validateParamIdMiddleware, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const template = db.prepare('SELECT * FROM email_templates WHERE id = ?').get(req.params.id);
    if (!template) { res.status(404).json({ error: 'Template not found', code: 'TEMPLATE_NOT_FOUND' }); return; }
    res.json(template);
  } catch (err: any) {
    console.error('Email route error:', err.message);
    res.status(500).json({ error: 'Failed to email route', code: 'EMAIL_ROUTE_ERROR' });
  }
});

// POST /api/email/templates — Create template
router.post('/templates', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { name, category, subject, body } = req.body;
    if (!name) { res.status(400).json({ error: 'Template name is required', code: 'TEMPLATE_NAME_IS_REQUIRED' }); return; }

    const result = db.prepare(`
      INSERT INTO email_templates (name, category, subject, body, created_by)
      VALUES (?, ?, ?, ?, ?)
    `).run(name, category || 'general', subject || '', body || '', req.user!.userId);

    auditLog(req, 'CREATE', 'email_template', Number(result.lastInsertRowid) as number, `Created template: ${name}`);
    res.json({ success: true, id: Number(result.lastInsertRowid) });
  } catch (err: any) {
    console.error('Email route error:', err.message);
    res.status(500).json({ error: 'Failed to email route', code: 'EMAIL_ROUTE_ERROR' });
  }
});

// PUT /api/email/templates/:id — Update template
router.put('/templates/:id', validateParamIdMiddleware, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { name, category, subject, body } = req.body;
    const now = localNow();

    const existing = db.prepare('SELECT id FROM email_templates WHERE id = ?').get(req.params.id);
    if (!existing) { res.status(404).json({ error: 'Template not found', code: 'TEMPLATE_NOT_FOUND' }); return; }

    db.prepare(`
      UPDATE email_templates SET name = ?, category = ?, subject = ?, body = ?, updated_at = ?
      WHERE id = ?
    `).run(name, category, subject, body, now, req.params.id);

    auditLog(req, 'UPDATE', 'email_template', parseInt(String(req.params.id), 10), `Updated template: ${name}`);
    res.json({ success: true });
  } catch (err: any) {
    console.error('Email route error:', err.message);
    res.status(500).json({ error: 'Failed to email route', code: 'EMAIL_ROUTE_ERROR' });
  }
});

// DELETE /api/email/templates/:id — Delete template
router.delete('/templates/:id', validateParamIdMiddleware, requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const template = db.prepare('SELECT * FROM email_templates WHERE id = ?').get(req.params.id) as any;
    if (!template) { res.status(404).json({ error: 'Template not found', code: 'TEMPLATE_NOT_FOUND' }); return; }
    // God Mode: admin bypass — can delete system templates
    if (template.is_system && req.user?.role !== 'admin') { res.status(400).json({ error: 'Cannot delete system templates', code: 'CANNOT_DELETE_SYSTEM_TEMPLATES' }); return; }
    if (template.is_system && req.user?.role === 'admin') {
      auditLog(req, 'ADMIN_OVERRIDE', 'email_template', parseInt(String(req.params.id), 10), `Admin God Mode: deleting system template ${template.name}`);
    }

    db.prepare('DELETE FROM email_templates WHERE id = ?').run(req.params.id);
    auditLog(req, 'DELETE', 'email_template', parseInt(String(req.params.id), 10), `Deleted template: ${template.name}`);
    res.json({ success: true });
  } catch (err: any) {
    console.error('Email route error:', err.message);
    res.status(500).json({ error: 'Failed to email route', code: 'EMAIL_ROUTE_ERROR' });
  }
});

// ============================================================
// CONTACT AUTOCOMPLETE
// ============================================================

// GET /api/email/contacts/search — Search users + persons for email recipients
router.get('/contacts/search', (req: Request, res: Response) => {
  try {
    const { q } = req.query;
    if (!q || String(q).trim().length < 2) {
      res.json([]);
      return;
    }

    const db = getDb();
    const query = `%${escapeLike(String(q).trim())}%`;
    const results: { name: string; email: string; type: string }[] = [];

    // Search users (internal contacts)
    const users = db.prepare(`
      SELECT full_name, email FROM users
      WHERE (full_name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' OR username LIKE ? ESCAPE '\\')
        AND email IS NOT NULL AND email != ''
        AND active = 1
      ORDER BY full_name LIMIT 10
    `).all(query, query, query) as { full_name: string; email: string }[];

    for (const u of users) {
      results.push({ name: u.full_name, email: u.email, type: 'user' });
    }

    // Search persons (external contacts)
    const persons = db.prepare(`
      SELECT first_name, last_name, email FROM persons
      WHERE (first_name || ' ' || last_name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\')
        AND email IS NOT NULL AND email != ''
        AND archived_at IS NULL
      ORDER BY last_name, first_name LIMIT 10
    `).all(query, query) as { first_name: string; last_name: string; email: string }[];

    for (const p of persons) {
      results.push({ name: `${p.first_name} ${p.last_name}`.trim(), email: p.email, type: 'person' });
    }

    // De-duplicate by email
    const seen = new Set<string>();
    const unique = results.filter(r => {
      const key = (r.email || '').toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    res.json(unique);
  } catch (err: any) {
    console.error('Email route error:', err.message);
    res.status(500).json({ error: 'Failed to email route', code: 'EMAIL_ROUTE_ERROR' });
  }
});

// ============================================================
// EMAIL-INCIDENT LINKING
// ============================================================

// POST /api/email/link — Link an email to an incident/call/warrant/person
router.post('/link', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { emailGraphId, incidentId, callId, warrantId, personId, linkType, notes } = req.body;
    if (!emailGraphId) { res.status(400).json({ error: 'Email ID is required', code: 'EMAIL_ID_IS_REQUIRED' }); return; }
    if (!incidentId && !callId && !warrantId && !personId) {
      res.status(400).json({ error: 'At least one link target is required', code: 'AT_LEAST_ONE_LINK' });
      return;
    }

    const result = db.prepare(`
      INSERT INTO email_incident_links (email_graph_id, incident_id, call_id, warrant_id, person_id, link_type, notes, linked_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(emailGraphId, incidentId || null, callId || null, warrantId || null, personId || null,
      linkType || 'related', notes || null, req.user!.userId);

    auditLog(req, 'CREATE', 'email_link', Number(result.lastInsertRowid) as number,
      `Linked email to ${incidentId ? `incident #${incidentId}` : callId ? `call #${callId}` : warrantId ? `warrant #${warrantId}` : `person #${personId}`}`);

    res.json({ success: true, id: Number(result.lastInsertRowid) });
  } catch (err: any) {
    console.error('Email route error:', err.message);
    res.status(500).json({ error: 'Failed to email route', code: 'EMAIL_ROUTE_ERROR' });
  }
});

// GET /api/email/links/:emailGraphId — Get links for an email
router.get('/links/:emailGraphId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const links = db.prepare(`
      SELECT el.*,
        i.incident_number as incident_case_number,
        c.call_number as call_number,
        p.first_name || ' ' || p.last_name as person_name,
        u.full_name as linked_by_name
      FROM email_incident_links el
      LEFT JOIN incidents i ON el.incident_id = i.id
      LEFT JOIN calls_for_service c ON el.call_id = c.id
      LEFT JOIN persons p ON el.person_id = p.id
      LEFT JOIN users u ON el.linked_by = u.id
      WHERE el.email_graph_id = ?
      ORDER BY el.created_at DESC
    
      LIMIT 1000
    `).all(String(req.params.emailGraphId));
    res.json(links);
  } catch (err: any) {
    console.error('Email route error:', err.message);
    res.status(500).json({ error: 'Failed to email route', code: 'EMAIL_ROUTE_ERROR' });
  }
});

// GET /api/email/links/incident/:incidentId — Get emails linked to an incident
router.get('/links/incident/:incidentId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const links = db.prepare(`
      SELECT el.*, ec.subject, ec.from_address, ec.from_name, ec.received_at, ec.body_preview,
        u.full_name as linked_by_name
      FROM email_incident_links el
      LEFT JOIN email_cache ec ON el.email_graph_id = ec.graph_id
      LEFT JOIN users u ON el.linked_by = u.id
      WHERE el.incident_id = ?
      ORDER BY ec.received_at DESC
    
      LIMIT 1000
    `).all(req.params.incidentId);
    res.json(links);
  } catch (err: any) {
    console.error('Email route error:', err.message);
    res.status(500).json({ error: 'Failed to email route', code: 'EMAIL_ROUTE_ERROR' });
  }
});

// DELETE /api/email/link/:id — Remove a link
router.delete('/link/:id', validateParamIdMiddleware, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM email_incident_links WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    console.error('Email route error:', err.message);
    res.status(500).json({ error: 'Failed to email route', code: 'EMAIL_ROUTE_ERROR' });
  }
});

// ============================================================
// SCHEDULED SENDS
// ============================================================

// POST /api/email/schedule — Schedule an email for later delivery
router.post('/schedule', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { to, cc, bcc, subject, body, attachments, scheduledAt } = req.body;
    if (!to || !subject || !scheduledAt) {
      res.status(400).json({ error: 'To, subject, and scheduledAt are required', code: 'TO_SUBJECT_AND_SCHEDULEDAT' });
      return;
    }

    const toList = Array.isArray(to) ? to : [to];

    const result = db.prepare(`
      INSERT INTO scheduled_emails (to_addresses, cc_addresses, bcc_addresses, subject, body, attachments, scheduled_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      JSON.stringify(toList),
      cc ? JSON.stringify(Array.isArray(cc) ? cc : [cc]) : null,
      bcc ? JSON.stringify(Array.isArray(bcc) ? bcc : [bcc]) : null,
      subject, body || '',
      attachments ? JSON.stringify(attachments) : null,
      scheduledAt, req.user!.userId
    );

    auditLog(req, 'SCHEDULE_EMAIL', 'email', Number(result.lastInsertRowid) as number,
      JSON.stringify({ to: toList, subject, scheduledAt }));

    res.json({ success: true, id: Number(result.lastInsertRowid) });
  } catch (err: any) {
    console.error('Email route error:', err.message);
    res.status(500).json({ error: 'Failed to email route', code: 'EMAIL_ROUTE_ERROR' });
  }
});

// GET /api/email/scheduled — List scheduled emails
router.get('/scheduled', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { status = 'pending' } = req.query;
    const rows = db.prepare(`
      SELECT se.*, u.full_name as created_by_name
      FROM scheduled_emails se
      LEFT JOIN users u ON se.created_by = u.id
      WHERE se.status = ? AND se.created_by = ?
      ORDER BY se.scheduled_at ASC
    
      LIMIT 1000
    `).all(String(status), req.user!.userId);
    res.json(rows);
  } catch (err: any) {
    console.error('Email route error:', err.message);
    res.status(500).json({ error: 'Failed to email route', code: 'EMAIL_ROUTE_ERROR' });
  }
});

// DELETE /api/email/scheduled/:id — Cancel a scheduled email
router.delete('/scheduled/:id', validateParamIdMiddleware, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const row = req.user?.role === 'admin'
      ? db.prepare('SELECT * FROM scheduled_emails WHERE id = ?').get(req.params.id) as any
      : db.prepare('SELECT * FROM scheduled_emails WHERE id = ? AND created_by = ?').get(req.params.id, req.user!.userId) as any;
    if (!row) { res.status(404).json({ error: 'Scheduled email not found', code: 'SCHEDULED_EMAIL_NOT_FOUND' }); return; }
    if (row.status !== 'pending' && req.user?.role !== 'admin') { res.status(400).json({ error: 'Can only cancel pending emails', code: 'CAN_ONLY_CANCEL_PENDING' }); return; }
    if (req.user?.role === 'admin' && row.status !== 'pending') {
      auditLog(req, 'ADMIN_OVERRIDE', 'scheduled_email', Number(req.params.id), `Admin God Mode: bypassed pending-only cancel restriction (status: ${row.status})`);
    }

    db.prepare("UPDATE scheduled_emails SET status = 'cancelled' WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    console.error('Email route error:', err.message);
    res.status(500).json({ error: 'Failed to email route', code: 'EMAIL_ROUTE_ERROR' });
  }
});

// ============================================================
// ADMIN ENDPOINTS
// ============================================================

// PUT /api/email/admin/credentials — Save Azure AD credentials
router.put('/admin/credentials', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const { clientId, clientSecret, tenantId } = req.body;
    if (!clientId || !clientSecret || !tenantId) {
      res.status(400).json({ error: 'All three Azure AD credentials are required', code: 'ALL_THREE_AZURE_AD' });
      return;
    }

    setConfigValue(CONFIG_KEYS.clientId, clientId, true);
    setConfigValue(CONFIG_KEYS.clientSecret, clientSecret, true);
    setConfigValue(CONFIG_KEYS.tenantId, tenantId, true);
    clearCachedAuth();

    auditLog(req, 'UPDATE', 'system_config', 0, 'ms_email_credentials_saved');
    res.json({ success: true });
  } catch (err: any) {
    console.error('Email route error:', err.message);
    res.status(500).json({ error: 'Failed to email route', code: 'EMAIL_ROUTE_ERROR' });
  }
});

// DELETE /api/email/admin/credentials — Clear all email config
router.delete('/admin/credentials', requireRole('admin'), (req: Request, res: Response) => {
  try {
    for (const key of Object.values(CONFIG_KEYS)) {
      deleteConfigValue(key);
    }
    clearCachedAuth();

    // Clear cached emails atomically
    const db = getDb();
    const clearCache = db.transaction(() => {
      db.prepare('DELETE FROM email_cache').run();
      db.prepare('DELETE FROM email_attachments').run();
      db.prepare('DELETE FROM email_folders').run();
    });
    clearCache();

    auditLog(req, 'DELETE', 'system_config', 0, 'ms_email_credentials_cleared');
    res.json({ success: true });
  } catch (err: any) {
    console.error('Email route error:', err.message);
    res.status(500).json({ error: 'Failed to email route', code: 'EMAIL_ROUTE_ERROR' });
  }
});

// GET /api/email/admin/oauth/authorize — Generate OAuth authorization URL
router.get('/admin/oauth/authorize', requireRole('admin'), (req: Request, res: Response) => {
  try {
    if (!isConfigured()) {
      res.status(400).json({ error: 'Azure AD credentials not configured yet', code: 'AZURE_AD_CREDENTIALS_NOT' });
      return;
    }

    // Store who initiated the OAuth flow
    setConfigValue(CONFIG_KEYS.oauthInitiator, String(req.user!.userId));

    // Always use https — req.protocol may report http incorrectly with https.createServer
    const redirectUri = `https://${req.get('host')}/api/email/oauth/callback`;
    const url = getAuthorizationUrl(redirectUri);

    auditLog(req, 'OAUTH_INITIATE', 'system_config', 0, 'ms_email_oauth_started');
    res.json({ url });
  } catch (err: any) {
    console.error('Email route error:', err.message);
    res.status(500).json({ error: 'Failed to email route', code: 'EMAIL_ROUTE_ERROR' });
  }
});

// POST /api/email/admin/test-connection — Test Graph API connection
router.post('/admin/test-connection', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const graphResult = await testConnection();
    const smtpResult = await testSMTPConnection().catch(() => ({ success: false, error: 'SMTP not configured' }));

    res.json({
      graph: graphResult,
      smtp: smtpResult,
    });
  } catch (err: any) {
    console.error('Email route error:', err.message);
    res.status(500).json({ error: 'Failed to email route', code: 'EMAIL_ROUTE_ERROR' });
  }
});

// PUT /api/email/admin/enable — Toggle enabled + poll interval
router.put('/admin/enable', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const { enabled, pollInterval } = req.body;

    if (enabled !== undefined) {
      setConfigValue(CONFIG_KEYS.enabled, String(!!enabled));
    }

    if (pollInterval !== undefined) {
      const seconds = Math.max(60, Math.min(600, parseInt(pollInterval, 10) || 300));
      setConfigValue(CONFIG_KEYS.pollInterval, String(seconds));
    }

    // Restart poller with new settings
    restartEmailPoller();

    auditLog(req, 'UPDATE', 'system_config', 0,
      JSON.stringify({ action: 'ms_email_settings_updated', enabled, pollInterval }));

    res.json({ success: true, ...getStatus() });
  } catch (err: any) {
    console.error('Email route error:', err.message);
    res.status(500).json({ error: 'Failed to email route', code: 'EMAIL_ROUTE_ERROR' });
  }
});

// PUT /api/email/admin/smtp-settings — Configure SMTP fallback
router.put('/admin/smtp-settings', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const { enabled, password } = req.body;

    if (enabled !== undefined) {
      setConfigValue(CONFIG_KEYS.smtpFallback, String(!!enabled));
    }

    if (password) {
      setConfigValue(CONFIG_KEYS.smtpPassword, password, true);
    }

    auditLog(req, 'UPDATE', 'system_config', 0, 'ms_email_smtp_settings_updated');
    res.json({ success: true });
  } catch (err: any) {
    console.error('Email route error:', err.message);
    res.status(500).json({ error: 'Failed to email route', code: 'EMAIL_ROUTE_ERROR' });
  }
});

// POST /api/email/admin/sync-now — Trigger immediate inbox sync
router.post('/admin/sync-now', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const result = await syncNow();
    res.json(result);
  } catch (err: any) {
    console.error('Email route error:', err.message);
    res.status(500).json({ error: 'Failed to email route', code: 'EMAIL_ROUTE_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// FEATURE 22: Email Flag/Star — Flag important emails for follow-up
// (Already exists via PATCH /messages/:id with isFlagged)
// Additional: Bulk flag endpoint and flagged list
// ════════════════════════════════════════════════════════════

router.get('/flagged', async (req: Request, res: Response) => {
  try {
    if (isAuthorized()) {
      try {
        const client = await getGraphClient();
        const result = await client
          .api('/me/messages')
          .filter("flag/flagStatus eq 'flagged'")
          .select('id,conversationId,subject,from,toRecipients,bodyPreview,hasAttachments,isRead,flag,importance,receivedDateTime')
          .orderby('receivedDateTime desc')
          .top(50)
          .get();

        res.json({
          messages: (result.value || []).map((msg: any) => ({
            id: msg.id,
            conversationId: msg.conversationId,
            subject: msg.subject || '(No subject)',
            fromAddress: msg.from?.emailAddress?.address || '',
            fromName: msg.from?.emailAddress?.name || '',
            bodyPreview: msg.bodyPreview || '',
            hasAttachments: msg.hasAttachments || false,
            isRead: msg.isRead || false,
            isFlagged: true,
            importance: msg.importance || 'normal',
            receivedAt: msg.receivedDateTime,
          })),
        });
        return;
      } catch { /* fall through to cache */ }
    }

    // Fallback to cache
    const db = getDb();
    const rows = db.prepare(
      'SELECT * FROM email_cache WHERE is_flagged = 1 ORDER BY received_at DESC LIMIT 50'
    ).all() as any[];

    res.json({
      messages: rows.map((r: any) => ({
        id: r.graph_id,
        conversationId: r.conversation_id,
        subject: r.subject,
        fromAddress: r.from_address,
        fromName: r.from_name,
        bodyPreview: r.body_preview,
        hasAttachments: !!r.has_attachments,
        isRead: !!r.is_read,
        isFlagged: true,
        importance: r.importance,
        receivedAt: r.received_at,
      })),
    });
  } catch (err: any) {
    console.error('Email route error:', err.message);
    res.status(500).json({ error: 'Failed to email route', code: 'EMAIL_ROUTE_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// FEATURE 23: Email Auto-Categorization
// Auto-tag emails based on keywords (incident, court, admin)
// ════════════════════════════════════════════════════════════

router.post('/categorize', (req: Request, res: Response) => {
  try {
    const { messageId, subject, bodyPreview } = req.body;
    if (!messageId) { res.status(400).json({ error: 'messageId is required', code: 'MESSAGEID_IS_REQUIRED' }); return; }

    const text = `${subject || ''} ${bodyPreview || ''}`.toLowerCase();

    const categories: string[] = [];
    const KEYWORD_MAP: Record<string, string[]> = {
      'incident': ['incident', 'report', 'crime', 'theft', 'assault', 'trespass', 'vandalism', 'burglary'],
      'court': ['court', 'subpoena', 'hearing', 'trial', 'arraignment', 'judge', 'prosecutor', 'defendant', 'verdict'],
      'admin': ['invoice', 'billing', 'payment', 'contract', 'renewal', 'schedule', 'payroll', 'hr', 'human resources'],
      'dispatch': ['dispatch', 'call', 'unit', 'respond', 'emergency', 'priority', 'code'],
      'serve': ['serve', 'process server', 'service of process', 'summons', 'writ', 'garnishment'],
      'training': ['training', 'certification', 'course', 'exam', 'qualification', 'continuing education'],
      'fleet': ['vehicle', 'fleet', 'maintenance', 'inspection', 'mileage', 'fuel'],
    };

    for (const [category, keywords] of Object.entries(KEYWORD_MAP)) {
      if (keywords.some(kw => text.includes(kw))) {
        categories.push(category);
      }
    }

    // Store categorization in cache
    if (categories.length > 0) {
      const db = getDb();
      db.prepare('UPDATE email_cache SET categories = ? WHERE graph_id = ?')
        .run(JSON.stringify(categories), messageId);
    }

    res.json({ messageId, categories });
  } catch (err: any) {
    console.error('Email categorize error:', err.message);
    res.status(500).json({ error: 'Failed to email categorize', code: 'EMAIL_CATEGORIZE_ERROR' });
  }
});

router.post('/categorize/batch', (req: Request, res: Response) => {
  try {
    const db = getDb();
    // Auto-categorize all uncategorized cached messages
    const uncategorized = db.prepare(
      "SELECT graph_id, subject, body_preview FROM email_cache WHERE categories IS NULL OR categories = '[]' LIMIT 200"
    ).all() as any[];

    const KEYWORD_MAP: Record<string, string[]> = {
      'incident': ['incident', 'report', 'crime', 'theft', 'assault', 'trespass'],
      'court': ['court', 'subpoena', 'hearing', 'trial', 'arraignment', 'judge'],
      'admin': ['invoice', 'billing', 'payment', 'contract', 'renewal', 'payroll'],
      'dispatch': ['dispatch', 'call', 'unit', 'respond', 'emergency'],
      'serve': ['serve', 'process server', 'summons', 'writ'],
      'training': ['training', 'certification', 'course', 'exam'],
      'fleet': ['vehicle', 'fleet', 'maintenance', 'inspection'],
    };

    let categorized = 0;
    for (const msg of uncategorized) {
      const text = `${msg.subject || ''} ${msg.body_preview || ''}`.toLowerCase();
      const categories: string[] = [];
      for (const [category, keywords] of Object.entries(KEYWORD_MAP)) {
        if (keywords.some(kw => text.includes(kw))) categories.push(category);
      }
      if (categories.length > 0) {
        db.prepare('UPDATE email_cache SET categories = ? WHERE graph_id = ?')
          .run(JSON.stringify(categories), msg.graph_id);
        categorized++;
      }
    }

    res.json({ processed: uncategorized.length, categorized });
  } catch (err: any) {
    console.error('Email batch categorize error:', err.message);
    res.status(500).json({ error: 'Failed to email batch categorize', code: 'EMAIL_BATCH_CATEGORIZE_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// FEATURE 25: Email Thread View
// Group emails by conversation thread
// ════════════════════════════════════════════════════════════

router.get('/threads', async (req: Request, res: Response) => {
  try {
    const { folder = 'inbox', page = '1', per_page = '25' } = req.query;
    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const perPage = Math.min(50, Math.max(1, parseInt(per_page as string, 10) || 25));

    if (isAuthorized()) {
      try {
        const client = await getGraphClient();
        const safeFolder = String(folder).replace(/[^a-zA-Z0-9_-]/g, '');
        const apiPath = safeFolder === 'inbox'
          ? '/me/mailFolders/inbox/messages'
          : `/me/mailFolders/${safeFolder}/messages`;

        const result = await client
          .api(apiPath)
          .select('id,conversationId,subject,from,toRecipients,bodyPreview,hasAttachments,isRead,flag,importance,receivedDateTime')
          .orderby('receivedDateTime desc')
          .top(perPage * 3) // Fetch more to group
          .skip((pageNum - 1) * perPage)
          .get();

        // Group by conversationId
        const threads: Record<string, any> = {};
        for (const msg of result.value || []) {
          const convId = msg.conversationId || msg.id;
          if (!threads[convId]) {
            threads[convId] = {
              conversationId: convId,
              subject: msg.subject || '(No subject)',
              messages: [],
              latestDate: msg.receivedDateTime,
              hasUnread: false,
              messageCount: 0,
            };
          }
          threads[convId].messages.push({
            id: msg.id,
            fromAddress: msg.from?.emailAddress?.address || '',
            fromName: msg.from?.emailAddress?.name || '',
            bodyPreview: msg.bodyPreview || '',
            isRead: msg.isRead || false,
            receivedAt: msg.receivedDateTime,
          });
          threads[convId].messageCount++;
          if (!msg.isRead) threads[convId].hasUnread = true;
          if (msg.receivedDateTime > threads[convId].latestDate) {
            threads[convId].latestDate = msg.receivedDateTime;
          }
        }

        const threadList = Object.values(threads)
          .sort((a: any, b: any) => new Date(b.latestDate).getTime() - new Date(a.latestDate).getTime())
          .slice(0, perPage);

        res.json({ threads: threadList, hasMore: Object.keys(threads).length > perPage });
        return;
      } catch { /* fall through */ }
    }

    // Fallback: group cached messages by conversation_id
    const db = getDb();
    const rows = db.prepare(`
      SELECT graph_id, conversation_id, subject, from_address, from_name,
        body_preview, is_read, is_flagged, received_at
      FROM email_cache
      WHERE folder_id = ?
      ORDER BY received_at DESC
      LIMIT ?
    `).all(folder, perPage * 3) as any[];

    const threads: Record<string, any> = {};
    for (const r of rows) {
      const convId = r.conversation_id || r.graph_id;
      if (!threads[convId]) {
        threads[convId] = {
          conversationId: convId,
          subject: r.subject || '(No subject)',
          messages: [],
          latestDate: r.received_at,
          hasUnread: false,
          messageCount: 0,
        };
      }
      threads[convId].messages.push({
        id: r.graph_id,
        fromAddress: r.from_address,
        fromName: r.from_name,
        bodyPreview: r.body_preview,
        isRead: !!r.is_read,
        receivedAt: r.received_at,
      });
      threads[convId].messageCount++;
      if (!r.is_read) threads[convId].hasUnread = true;
    }

    const threadList = Object.values(threads)
      .sort((a: any, b: any) => new Date(b.latestDate).getTime() - new Date(a.latestDate).getTime())
      .slice(0, perPage);

    res.json({ threads: threadList, hasMore: Object.keys(threads).length > perPage });
  } catch (err: any) {
    console.error('Email threads error:', err.message);
    res.status(500).json({ error: 'Failed to email threads', code: 'EMAIL_THREADS_ERROR' });
  }
});

// GET /api/email/thread/:conversationId — Get all messages in a thread
router.get('/thread/:conversationId', async (req: Request, res: Response) => {
  try {
    const convId = req.params.conversationId;
    if (!convId || convId.length > 250) { res.status(400).json({ error: 'Invalid conversation ID', code: 'INVALID_CONVERSATION_ID' }); return; }

    if (isAuthorized()) {
      try {
        const client = await getGraphClient();
        const result = await client
          .api('/me/messages')
          .filter(`conversationId eq '${(convId as string).replace(/'/g, "''")}'`)
          .select('id,conversationId,subject,from,toRecipients,ccRecipients,body,bodyPreview,hasAttachments,isRead,flag,importance,receivedDateTime,sentDateTime')
          .orderby('receivedDateTime asc')
          .top(50)
          .get();

        res.json({
          conversationId: convId,
          messages: (result.value || []).map((msg: any) => ({
            id: msg.id,
            subject: msg.subject || '(No subject)',
            fromAddress: msg.from?.emailAddress?.address || '',
            fromName: msg.from?.emailAddress?.name || '',
            toAddresses: (msg.toRecipients || []).map((r: any) => ({
              email: r.emailAddress?.address,
              name: r.emailAddress?.name,
            })),
            bodyHtml: msg.body?.content || '',
            bodyPreview: msg.bodyPreview || '',
            hasAttachments: msg.hasAttachments || false,
            isRead: msg.isRead || false,
            receivedAt: msg.receivedDateTime,
            sentAt: msg.sentDateTime,
          })),
        });
        return;
      } catch { /* fall through */ }
    }

    // Fallback to cache
    const db = getDb();
    const rows = db.prepare(
      'SELECT * FROM email_cache WHERE conversation_id = ? ORDER BY received_at ASC'
    ).all(convId) as any[];

    res.json({
      conversationId: convId,
      messages: rows.map((r: any) => ({
        id: r.graph_id,
        subject: r.subject,
        fromAddress: r.from_address,
        fromName: r.from_name,
        bodyPreview: r.body_preview,
        hasAttachments: !!r.has_attachments,
        isRead: !!r.is_read,
        receivedAt: r.received_at,
      })),
    });
  } catch (err: any) {
    console.error('Email thread error:', err.message);
    res.status(500).json({ error: 'Failed to email thread', code: 'EMAIL_THREAD_ERROR' });
  }
});


// ════════════════════════════════════════════════════════════
// Image Proxy — loads external email images through the server
// to bypass CORS/referrer restrictions on CDN-hosted content
// ════════════════════════════════════════════════════════════
router.get('/image-proxy', authenticateToken, async (req: Request, res: Response) => {
  try {
    const url = req.query.url as string;
    if (!url || typeof url !== 'string' || (!url.startsWith('http://') && !url.startsWith('https://'))) {
      res.status(400).json({ error: 'Valid http/https URL required' });
      return;
    }
    const parsed = new URL(url);
    if (['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(parsed.hostname) ||
        parsed.hostname.startsWith('10.') || parsed.hostname.startsWith('192.168.') || parsed.hostname.startsWith('172.')) {
      res.status(403).json({ error: 'Internal URLs not allowed' });
      return;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RMPG-Flex/1.0)', 'Accept': 'image/*,*/*;q=0.8' } });
    clearTimeout(timeout);
    if (!response.ok) { res.status(response.status).end(); return; }
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    if (!contentType.startsWith('image/')) { res.status(415).json({ error: 'Not an image' }); return; }
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const buffer = Buffer.from(await response.arrayBuffer());
    res.send(buffer);
  } catch (err: any) {
    if (err.name === 'AbortError') { res.status(504).json({ error: 'Image fetch timeout' }); }
    else { res.status(502).json({ error: 'Failed to fetch image' }); }
  }
});

export default router;

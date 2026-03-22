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
import { escapeLike, validateParamId } from '../middleware/sanitize';
import type { NextFunction } from 'express';

/** Validate Graph API string IDs (alphanumeric, hyphens, underscores, equals, plus). Blocks path traversal. */
function validateGraphId(req: Request, res: Response, next: NextFunction) {
  const id = req.params.id || req.params.aid;
  if (!id || !/^[A-Za-z0-9_=+\-]{10,250}$/.test(id)) {
    return res.status(400).json({ error: 'Invalid message ID' });
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
    const trimmedUrl = url.trim().toLowerCase();
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
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/email/signature — Get current user's email signature
router.get('/signature', (req: Request, res: Response) => {
  try {
    const signature = getUserSignature(req.user!.userId);
    res.json({ signature: signature || '' });
  } catch (err: any) {
    console.error('Email route error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/email/signature — Save current user's email signature
router.put('/signature', (req: Request, res: Response) => {
  try {
    const { signature } = req.body;
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
    res.status(500).json({ error: 'Internal server error' });
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
    res.status(500).json({ error: 'Internal server error' });
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
    res.status(500).json({ error: 'Internal server error' });
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
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/email/folders — Create a new folder
router.post('/folders', async (req: Request, res: Response) => {
  try {
    if (!isAuthorized()) { res.status(503).json({ error: 'Email not authorized' }); return; }
    const { displayName, parentFolderId } = req.body;
    if (!displayName?.trim()) { res.status(400).json({ error: 'Folder name required' }); return; }

    const client = await getGraphClient();
    const apiPath = parentFolderId
      ? `/me/mailFolders/${parentFolderId}/childFolders`
      : '/me/mailFolders';

    const folder = await client.api(apiPath).post({ displayName: displayName.trim() });
    auditLog(req, 'CREATE', 'email_folder', 0, JSON.stringify({ displayName, parentFolderId }));
    res.json(folder);
  } catch (err: any) {
    console.error('Email route error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/email/folders/:id — Rename a folder
router.patch('/folders/:id', validateGraphId, async (req: Request, res: Response) => {
  try {
    if (!isAuthorized()) { res.status(503).json({ error: 'Email not authorized' }); return; }
    const { displayName } = req.body;
    if (!displayName?.trim()) { res.status(400).json({ error: 'Folder name required' }); return; }

    const client = await getGraphClient();
    await client.api(`/me/mailFolders/${req.params.id}`).update({ displayName: displayName.trim() });
    auditLog(req, 'UPDATE', 'email_folder', 0, JSON.stringify({ folderId: req.params.id, displayName }));
    res.json({ success: true });
  } catch (err: any) {
    console.error('Email route error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/email/folders/:id — Delete a folder
router.delete('/folders/:id', validateGraphId, async (req: Request, res: Response) => {
  try {
    if (!isAuthorized()) { res.status(503).json({ error: 'Email not authorized' }); return; }
    const client = await getGraphClient();
    await client.api(`/me/mailFolders/${req.params.id}`).delete();
    auditLog(req, 'DELETE', 'email_folder', 0, JSON.stringify({ folderId: req.params.id }));
    res.json({ success: true });
  } catch (err: any) {
    console.error('Email route error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
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
      const term = `%${escapeLike(String(search).trim())}%`;
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
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/email/messages/batch — Batch operations on multiple messages
// IMPORTANT: Must be registered before /messages/:id to avoid Express treating "batch" as an ID
router.post('/messages/batch', async (req: Request, res: Response) => {
  try {
    if (!isAuthorized()) { res.status(503).json({ error: 'Email not authorized' }); return; }

    const { action, ids } = req.body;
    if (!action || !Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: 'Action and ids[] required' });
      return;
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
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/email/messages/mark-all-read — Mark all messages in a folder as read
router.post('/messages/mark-all-read', async (req: Request, res: Response) => {
  try {
    if (!isAuthorized()) { res.status(503).json({ error: 'Email not authorized' }); return; }

    const { folder = 'inbox' } = req.body;
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
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/email/messages/:id — Full message with body
router.get('/messages/:id', validateGraphId, async (req: Request, res: Response) => {
  try {
    if (!isAuthorized()) {
      res.status(503).json({ error: 'Email not authorized' });
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
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/email/messages/:id/attachments — List attachments
router.get('/messages/:id/attachments', validateGraphId, async (req: Request, res: Response) => {
  try {
    if (!isAuthorized()) { res.status(503).json({ error: 'Email not authorized' }); return; }

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
      contentId: a.contentId,
    })));
  } catch (err: any) {
    console.error('Email route error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/email/messages/:id/attachments/:aid — Download attachment
router.get('/messages/:id/attachments/:aid', validateGraphId, async (req: Request, res: Response) => {
  try {
    if (!isAuthorized()) { res.status(503).json({ error: 'Email not authorized' }); return; }

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
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/email/send — Send new email (supports BCC + file attachments)
router.post('/send', async (req: Request, res: Response) => {
  try {
    const { to, cc, bcc, subject, body, attachments } = req.body;
    if (!to || !subject) {
      res.status(400).json({ error: 'To and subject are required' });
      return;
    }

    const toList = Array.isArray(to) ? to : [to];
    const ccList = cc ? (Array.isArray(cc) ? cc : [cc]) : undefined;
    const bccList = bcc ? (Array.isArray(bcc) ? bcc : [bcc]) : undefined;

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
      res.json({ success: true });
    } else {
      res.status(500).json({ error: 'Failed to send email' });
    }
  } catch (err: any) {
    console.error('Email route error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/email/messages/:id/reply — Reply to message
router.post('/messages/:id/reply', validateGraphId, async (req: Request, res: Response) => {
  try {
    if (!isAuthorized()) { res.status(503).json({ error: 'Email not authorized' }); return; }

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
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/email/messages/:id/reply-all — Reply all
router.post('/messages/:id/reply-all', validateGraphId, async (req: Request, res: Response) => {
  try {
    if (!isAuthorized()) { res.status(503).json({ error: 'Email not authorized' }); return; }

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
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/email/messages/:id/forward — Forward message
router.post('/messages/:id/forward', validateGraphId, async (req: Request, res: Response) => {
  try {
    if (!isAuthorized()) { res.status(503).json({ error: 'Email not authorized' }); return; }

    const { to, body } = req.body;
    if (!to) { res.status(400).json({ error: 'Recipient required' }); return; }

    const toList = Array.isArray(to) ? to : [to];
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
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/email/messages/:id — Update message (read/unread, flag)
router.patch('/messages/:id', validateGraphId, async (req: Request, res: Response) => {
  try {
    if (!isAuthorized()) { res.status(503).json({ error: 'Email not authorized' }); return; }

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
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/email/messages/:id — Move to trash
router.delete('/messages/:id', validateGraphId, async (req: Request, res: Response) => {
  try {
    if (!isAuthorized()) { res.status(503).json({ error: 'Email not authorized' }); return; }

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
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/email/messages/:id/move — Move to folder
router.post('/messages/:id/move', validateGraphId, async (req: Request, res: Response) => {
  try {
    if (!isAuthorized()) { res.status(503).json({ error: 'Email not authorized' }); return; }

    const { folderId } = req.body;
    if (!folderId) { res.status(400).json({ error: 'Folder ID required' }); return; }

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
    res.status(500).json({ error: 'Internal server error' });
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
    `).all();
    res.json({ data: templates });
  } catch (err: any) {
    console.error('Email route error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/email/templates/:id — Get single template
router.get('/templates/:id', validateParamId, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const template = db.prepare('SELECT * FROM email_templates WHERE id = ?').get(req.params.id);
    if (!template) { res.status(404).json({ error: 'Template not found' }); return; }
    res.json(template);
  } catch (err: any) {
    console.error('Email route error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/email/templates — Create template
router.post('/templates', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { name, category, subject, body } = req.body;
    if (!name) { res.status(400).json({ error: 'Template name is required' }); return; }

    const result = db.prepare(`
      INSERT INTO email_templates (name, category, subject, body, created_by)
      VALUES (?, ?, ?, ?, ?)
    `).run(name, category || 'general', subject || '', body || '', req.user!.userId);

    auditLog(req, 'CREATE', 'email_template', Number(result.lastInsertRowid) as number, `Created template: ${name}`);
    res.json({ success: true, id: Number(result.lastInsertRowid) });
  } catch (err: any) {
    console.error('Email route error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/email/templates/:id — Update template
router.put('/templates/:id', validateParamId, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { name, category, subject, body } = req.body;
    const now = localNow();

    const existing = db.prepare('SELECT id FROM email_templates WHERE id = ?').get(req.params.id);
    if (!existing) { res.status(404).json({ error: 'Template not found' }); return; }

    db.prepare(`
      UPDATE email_templates SET name = ?, category = ?, subject = ?, body = ?, updated_at = ?
      WHERE id = ?
    `).run(name, category, subject, body, now, req.params.id);

    auditLog(req, 'UPDATE', 'email_template', parseInt(String(req.params.id), 10), `Updated template: ${name}`);
    res.json({ success: true });
  } catch (err: any) {
    console.error('Email route error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/email/templates/:id — Delete template
router.delete('/templates/:id', validateParamId, requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const template = db.prepare('SELECT * FROM email_templates WHERE id = ?').get(req.params.id) as any;
    if (!template) { res.status(404).json({ error: 'Template not found' }); return; }
    if (template.is_system) { res.status(400).json({ error: 'Cannot delete system templates' }); return; }

    db.prepare('DELETE FROM email_templates WHERE id = ?').run(req.params.id);
    auditLog(req, 'DELETE', 'email_template', parseInt(String(req.params.id), 10), `Deleted template: ${template.name}`);
    res.json({ success: true });
  } catch (err: any) {
    console.error('Email route error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
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
      res.json({ data: [] });
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
      const key = r.email.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    res.json({ data: unique });
  } catch (err: any) {
    console.error('Email route error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
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
    if (!emailGraphId) { res.status(400).json({ error: 'Email ID is required' }); return; }
    if (!incidentId && !callId && !warrantId && !personId) {
      res.status(400).json({ error: 'At least one link target is required' });
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
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/email/links/:emailGraphId — Get links for an email
router.get('/links/:emailGraphId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const links = db.prepare(`
      SELECT el.*,
        i.case_number as incident_case_number,
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
    `).all(String(req.params.emailGraphId));
    res.json({ data: links });
  } catch (err: any) {
    console.error('Email route error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
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
    `).all(req.params.incidentId);
    res.json({ data: links });
  } catch (err: any) {
    console.error('Email route error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/email/link/:id — Remove a link
router.delete('/link/:id', validateParamId, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM email_incident_links WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    console.error('Email route error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
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
      res.status(400).json({ error: 'To, subject, and scheduledAt are required' });
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
    res.status(500).json({ error: 'Internal server error' });
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
    `).all(String(status), req.user!.userId);
    res.json({ data: rows });
  } catch (err: any) {
    console.error('Email route error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/email/scheduled/:id — Cancel a scheduled email
router.delete('/scheduled/:id', validateParamId, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const row = db.prepare('SELECT * FROM scheduled_emails WHERE id = ? AND created_by = ?')
      .get(req.params.id, req.user!.userId) as any;
    if (!row) { res.status(404).json({ error: 'Scheduled email not found' }); return; }
    if (row.status !== 'pending') { res.status(400).json({ error: 'Can only cancel pending emails' }); return; }

    db.prepare("UPDATE scheduled_emails SET status = 'cancelled' WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    console.error('Email route error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
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
      res.status(400).json({ error: 'All three Azure AD credentials are required' });
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
    res.status(500).json({ error: 'Internal server error' });
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
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/email/admin/oauth/authorize — Generate OAuth authorization URL
router.get('/admin/oauth/authorize', requireRole('admin'), (req: Request, res: Response) => {
  try {
    if (!isConfigured()) {
      res.status(400).json({ error: 'Azure AD credentials not configured yet' });
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
    res.status(500).json({ error: 'Internal server error' });
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
    res.status(500).json({ error: 'Internal server error' });
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
    res.status(500).json({ error: 'Internal server error' });
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
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/email/admin/sync-now — Trigger immediate inbox sync
router.post('/admin/sync-now', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const result = await syncNow();
    res.json(result);
  } catch (err: any) {
    console.error('Email route error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

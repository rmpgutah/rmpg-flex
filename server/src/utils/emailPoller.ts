// ============================================================
// Microsoft Email Poller
// ============================================================
// Background service that syncs the Microsoft 365 mailbox inbox
// into the local email_cache table. Follows the start/stop
// pattern of clearPathGpsPoller.ts.

import { getDb } from '../models/database';
import { broadcast } from './websocket';
import { localNow } from './timeUtils';
import {
  getGraphClient,
  isConfigured,
  isEnabled,
  isAuthorized,
  getConfigValue,
  setConfigValue,
  CONFIG_KEYS,
} from './msGraphClient';
import { sendEmail } from './emailSender';
import { renderEmailMarkdown } from './emailMarkdown';
import { evaluateRulesForEmail } from './emailRuleEngine';
import { extractEntityReferences } from './emailAutoLinker';

function isAllowlistedSender(fromAddr: string): boolean {
  try {
    const raw = getConfigValue('email_autolink_allowlist') || '[]';
    const domains: string[] = JSON.parse(raw);
    const addr = (fromAddr || '').toLowerCase();
    return domains.some(d => {
      const dom = d.toLowerCase();
      if (dom.startsWith('.')) return addr.endsWith(dom);
      return addr.endsWith('@' + dom) || addr.endsWith('.' + dom);
    });
  } catch {
    return false;
  }
}
import { auditLogSystem } from './auditLogger';

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startEmailPoller(intervalMs?: number): void {
  if (intervalHandle) return; // Already running

  const pollMs = intervalMs ?? getPollIntervalMs();
  console.log(`[EmailPoller] Starting — every ${pollMs / 1000}s`);

  intervalHandle = setInterval(() => {
    syncInbox().catch(err => {
      console.error('[EmailPoller] Sync error:', err.message || err);
    });
  }, pollMs);
  intervalHandle.unref();

  // Initial sync after a delay (let server finish startup)
  setTimeout(() => {
    syncInbox().catch(err => {
      console.error('[EmailPoller] Initial sync error:', err.message || err);
    });
  }, 15_000);
}

export function stopEmailPoller(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    console.log('[EmailPoller] Stopped');
  }
}

export function restartEmailPoller(): void {
  stopEmailPoller();
  startEmailPoller();
}

function getPollIntervalMs(): number {
  const seconds = parseInt(getConfigValue(CONFIG_KEYS.pollInterval) || '300', 10);
  return Math.max(60, Math.min(600, seconds)) * 1000; // Clamp 1-10 minutes
}

/** Sync messages from a given folder into email_cache. */
async function syncFolder(client: any, folderName: string, folderId: string, limit: number): Promise<number> {
  const db = getDb();
  const now = localNow();

  const result = await client
    .api(`/me/mailFolders/${folderName}/messages`)
    .select('id,conversationId,subject,from,toRecipients,ccRecipients,bodyPreview,body,hasAttachments,isRead,flag,importance,receivedDateTime,sentDateTime')
    .orderby('receivedDateTime desc')
    .top(limit)
    .get();

  const messages = result.value || [];
  let newCount = 0;

  const upsert = db.prepare(`
    INSERT INTO email_cache (graph_id, conversation_id, folder_id, subject, from_address, from_name, to_addresses, cc_addresses, body_preview, body_html, has_attachments, is_read, is_flagged, importance, received_at, sent_at, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(graph_id) DO UPDATE SET
      is_read = excluded.is_read,
      is_flagged = excluded.is_flagged,
      folder_id = excluded.folder_id,
      synced_at = excluded.synced_at
  `);

  const checkExisting = db.prepare('SELECT id FROM email_cache WHERE graph_id = ?');
  const newIds: number[] = [];

  const tx = db.transaction(() => {
    for (const msg of messages) {
      const fromAddr = msg.from?.emailAddress?.address || '';
      const fromName = msg.from?.emailAddress?.name || '';
      const toAddrs = JSON.stringify((msg.toRecipients || []).map((r: any) => ({
        email: r.emailAddress?.address,
        name: r.emailAddress?.name,
      })));
      const ccAddrs = JSON.stringify((msg.ccRecipients || []).map((r: any) => ({
        email: r.emailAddress?.address,
        name: r.emailAddress?.name,
      })));
      const isFlagged = msg.flag?.flagStatus === 'flagged' ? 1 : 0;

      const existing = checkExisting.get(msg.id) as { id: number } | undefined;

      const info = upsert.run(
        msg.id,
        msg.conversationId || null,
        folderId,
        msg.subject || '(No subject)',
        fromAddr,
        fromName,
        toAddrs,
        ccAddrs,
        msg.bodyPreview || '',
        msg.body?.content || '',
        msg.hasAttachments ? 1 : 0,
        msg.isRead ? 1 : 0,
        isFlagged,
        msg.importance || 'normal',
        msg.receivedDateTime || now,
        msg.sentDateTime || null,
        now,
      );
      if (info.changes > 0) newCount++;
      if (!existing && info.lastInsertRowid) {
        newIds.push(Number(info.lastInsertRowid));
      }
    }
  });

  tx();

  // Rule evaluation runs OUTSIDE the transaction so a slow/broken rule
  // can't roll back the sync. Each rule has its own internal 50ms timeout.
  for (const id of newIds) {
    try {
      await evaluateRulesForEmail(db, id);
    } catch (err: any) {
      console.warn(`[EmailPoller] Rule eval failed for email #${id}:`, err.message);
    }

    // Auto-link inbound from allowlisted senders to existing CAD/RMS entities.
    try {
      const row = db.prepare(
        `SELECT graph_id, from_address, subject,
           COALESCE((SELECT body_text FROM email_cache_fts WHERE rowid = ec.id),'') as body_text
         FROM email_cache ec WHERE ec.id = ?`
      ).get(id) as any;
      if (row && isAllowlistedSender(row.from_address)) {
        const refs = extractEntityReferences(row.subject || '', row.body_text || '');
        for (const ref of refs) {
          db.prepare(
            `INSERT INTO email_links (email_graph_id, entity_type, entity_id, auto_linked, created_at)
             VALUES (?,?,?,1,?)`
          ).run(row.graph_id, ref.type, ref.id, localNow());
        }
      }
    } catch (err: any) {
      console.warn(`[EmailPoller] Auto-link failed for email #${id}:`, err.message);
    }
  }

  return newCount;
}

/** Sync inbox, sent items, drafts, and custom folders from Microsoft Graph. */
async function syncInbox(): Promise<void> {
  if (!isConfigured() || !isEnabled() || !isAuthorized()) return;

  try {
    const client = await getGraphClient();

    // Sync core folders: Inbox (100), Sent Items (50), Drafts (50)
    const inboxNew = await syncFolder(client, 'inbox', 'inbox', 100);
    try { await syncFolder(client, 'sentitems', 'sentitems', 50); } catch (e: any) { console.warn('[EmailPoller] sentitems sync failed:', e?.message); }
    try { await syncFolder(client, 'drafts', 'drafts', 50); } catch (e: any) { console.warn('[EmailPoller] drafts sync failed:', e?.message); }
    try { await syncFolder(client, 'deleteditems', 'deleteditems', 30); } catch (e: any) { console.warn('[EmailPoller] deleteditems sync failed:', e?.message); }
    try { await syncFolder(client, 'junkemail', 'junkemail', 20); } catch (e: any) { console.warn('[EmailPoller] junkemail sync failed:', e?.message); }
    try { await syncFolder(client, 'archive', 'archive', 50); } catch (e: any) { console.warn('[EmailPoller] archive sync failed:', e?.message); }

    // Sync custom user folders
    try {
      await syncCustomFolders(client);
    } catch (e: any) {
      console.warn('[EmailPoller] Custom folder sync failed:', e?.message);
    }

    // Sync folder counts
    await syncFolders(client);

    // Update last sync timestamp
    setConfigValue(CONFIG_KEYS.lastSync, localNow());

    if (inboxNew > 0) {
      const db = getDb();
      const unreadRow = db.prepare(
        "SELECT COUNT(*) as count FROM email_cache WHERE folder_id = 'inbox' AND is_read = 0"
      ).get() as { count: number };

      broadcast('email', 'email:new_messages', {
        newCount: inboxNew,
        unread: unreadRow?.count || 0,
      });
    }
  } catch (err: any) {
    if (err.message?.includes('re-authorization')) return;
    throw err;
  }

  // Process scheduled emails after each sync cycle
  try {
    await processScheduledEmails();
  } catch (err: any) {
    console.error('[EmailPoller] Scheduled email processing error:', err.message);
  }
}

/** Sync messages from custom (non-well-known) folders. */
async function syncCustomFolders(client: any): Promise<void> {
  const db = getDb();
  const wellKnown = new Set(['inbox', 'sentitems', 'drafts', 'deleteditems', 'junkemail', 'archive']);

  // Get all folders from cache
  const folders = db.prepare('SELECT graph_id, display_name FROM email_folders').all() as { graph_id: string; display_name: string }[];

  for (const folder of folders) {
    // Skip well-known folders (already synced above) — check by display name heuristic
    const normalizedName = folder.display_name.toLowerCase().replace(/\s+/g, '');
    if (wellKnown.has(normalizedName) ||
        normalizedName === 'sentmail' || normalizedName === 'deleteditems' ||
        normalizedName === 'conversationhistory' || normalizedName === 'outbox') continue;

    try {
      await syncFolder(client, folder.graph_id, folder.graph_id, 30);
    } catch (e: any) {
      console.warn(`[EmailPoller] Folder ${folder.graph_id} sync failed:`, e?.message);
    }
  }
}

/** Process scheduled emails that are due for delivery. */
async function processScheduledEmails(): Promise<void> {
  const db = getDb();
  const now = localNow();

  const due = db.prepare(`
    SELECT * FROM scheduled_emails
    WHERE status = 'pending' AND scheduled_at <= ?
    ORDER BY scheduled_at ASC
    LIMIT 10
  `).all(now) as {
    id: number; to_addresses: string; cc_addresses: string | null;
    bcc_addresses: string | null; subject: string; body: string;
    attachments: string | null; created_by: number;
  }[];

  if (due.length === 0) return;

  console.log(`[EmailPoller] Processing ${due.length} scheduled email(s)`);

  for (const email of due) {
    try {
      let toParsed: any, ccParsed: any, bccParsed: any;
      try {
        toParsed = JSON.parse(email.to_addresses);
        ccParsed = email.cc_addresses ? JSON.parse(email.cc_addresses) : undefined;
        bccParsed = email.bcc_addresses ? JSON.parse(email.bcc_addresses) : undefined;
      } catch (parseErr) {
        console.error(`[EmailPoller] Email #${email.id} has malformed address JSON — skipping`);
        db.prepare("UPDATE scheduled_emails SET status = 'failed', error_message = ? WHERE id = ?")
          .run('Malformed address JSON', email.id);
        continue;
      }
      const toList: string[] = Array.isArray(toParsed) ? toParsed : [String(toParsed)];
      const ccList: string[] | undefined = ccParsed ? (Array.isArray(ccParsed) ? ccParsed : [String(ccParsed)]) : undefined;
      const bccList: string[] | undefined = bccParsed ? (Array.isArray(bccParsed) ? bccParsed : [String(bccParsed)]) : undefined;

      // Get user signature
      const sigRow = db.prepare("SELECT config_value FROM system_config WHERE config_key = ?")
        .get(`email_signature_${email.created_by}`) as { config_value: string } | undefined;

      let bodyMarkdown = email.body;
      if (sigRow?.config_value) {
        bodyMarkdown += '\n\n--\n' + sigRow.config_value;
      }
      const bodyHtml = renderEmailMarkdown(bodyMarkdown);

      const sent = await sendEmail({
        to: toList,
        cc: ccList,
        bcc: bccList,
        subject: email.subject,
        html: bodyHtml,
      });

      if (sent.ok) {
        db.prepare("UPDATE scheduled_emails SET status = 'sent', sent_at = ? WHERE id = ?").run(localNow(), email.id);
        console.log(`[EmailPoller] Scheduled email #${email.id} sent to ${toList.join(', ')} via ${sent.transport}`);
        auditLogSystem(
          'SCHEDULED_DELIVERED' as any,
          'email' as any,
          `scheduled:${email.id}`,
          JSON.stringify({ to: toList, subject: email.subject, transport: sent.transport, messageId: sent.messageId || null }),
        );
      } else {
        const errMsg = `Send failed: ${sent.reason} — ${sent.detail}`;
        db.prepare("UPDATE scheduled_emails SET status = 'failed', error_message = ? WHERE id = ?").run(errMsg, email.id);
        console.error(`[EmailPoller] Scheduled email #${email.id} ${errMsg}`);
        auditLogSystem(
          'SCHEDULED_FAILED' as any,
          'email' as any,
          `scheduled:${email.id}`,
          errMsg,
        );
      }
    } catch (err: any) {
      const errMsg = err.message || 'Unknown error';
      db.prepare("UPDATE scheduled_emails SET status = 'failed', error_message = ? WHERE id = ?")
        .run(errMsg, email.id);
      console.error(`[EmailPoller] Scheduled email #${email.id} failed:`, err.message);
      auditLogSystem(
        'SCHEDULED_FAILED' as any,
        'email' as any,
        `scheduled:${email.id}`,
        errMsg,
      );
    }
  }
}

/** Sync mailbox folder list and counts. */
async function syncFolders(client: any): Promise<void> {
  try {
    const db = getDb();
    const now = localNow();

    const result = await client
      .api('/me/mailFolders')
      .select('id,displayName,parentFolderId,totalItemCount,unreadItemCount,childFolderCount')
      .top(50)
      .get();

    const folders = result.value || [];

    const upsert = db.prepare(`
      INSERT INTO email_folders (graph_id, display_name, parent_folder_id, total_count, unread_count, synced_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(graph_id) DO UPDATE SET
        display_name = excluded.display_name,
        total_count = excluded.total_count,
        unread_count = excluded.unread_count,
        synced_at = excluded.synced_at
    `);

    const tx = db.transaction(() => {
      for (const f of folders) {
        upsert.run(
          f.id,
          f.displayName || 'Unknown',
          f.parentFolderId || null,
          f.totalItemCount || 0,
          f.unreadItemCount || 0,
          now,
        );
      }
    });

    tx();
  } catch (err: any) {
    console.error('[EmailPoller] Folder sync error:', err.message);
  }
}

/** Force an immediate sync (called from admin route). */
export async function syncNow(): Promise<{ synced: number; error?: string }> {
  try {
    await syncInbox();
    const db = getDb();
    const row = db.prepare('SELECT COUNT(*) as count FROM email_cache').get() as { count: number };
    return { synced: row?.count || 0 };
  } catch (err: any) {
    return { synced: 0, error: err.message || 'Sync failed' };
  }
}

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
    }
  });

  tx();
  return newCount;
}

/** Sync inbox, sent items, and drafts from Microsoft Graph. */
async function syncInbox(): Promise<void> {
  if (!isConfigured() || !isEnabled() || !isAuthorized()) return;

  try {
    const client = await getGraphClient();

    // Sync Inbox (100), Sent Items (50), Drafts (50)
    const inboxNew = await syncFolder(client, 'inbox', 'inbox', 100);
    try { await syncFolder(client, 'sentitems', 'sentitems', 50); } catch { /* sent items may fail */ }
    try { await syncFolder(client, 'drafts', 'drafts', 50); } catch { /* drafts may fail */ }

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

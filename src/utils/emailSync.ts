// ⚠️ SUPERSEDED / NOT WIRED: the live email pipeline is runEmailPoll() in
// routes/email.ts (per-user owner_user_id cache). This module's upsertSQL is
// incompatible with the live email_messages schema (UNIQUE(owner_user_id,
// graph_id), owner_user_id NOT NULL) and nothing calls syncEmail(). Do not
// wire it back without fixing both.
// Microsoft Graph → D1 incremental sync for the inbox.
//
// Strategy: Graph's /me/mailFolders/inbox/messages/delta endpoint
// returns either a full page (first call) or only changed/new
// messages (subsequent calls), keyed by a deltaLink we persist in
// system_config. This is far cheaper than refetching the whole
// inbox on every cron — typical 4-hour delta is < 100 rows.
//
// Failure modes handled:
//   - No credentials / not authorized → returns early, logs nothing
//     (the cron must not spam logs for an unconfigured org).
//   - Graph 410 Gone on deltaLink → drop the saved link and re-sync.
//   - Per-message write failures → caught, counted, sync continues.

import { log } from './logger';
import type { Bindings } from '../types';
import { getDb, queryFirst, execute } from './db';
import { graphFetch, GraphNotConfiguredError } from './msGraph';

const KEYS = {
  deltaLink: 'email_delta_link',
  lastSync: 'email_last_sync',
  enabled: 'email_enabled',
} as const;

interface GraphRecipient { emailAddress: { address: string; name?: string } }
interface GraphDeltaMessage {
  id: string;
  '@removed'?: { reason: string };
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
  parentFolderId?: string;
}

const INITIAL_DELTA = '/me/mailFolders/inbox/messages/delta?$top=100';

async function readKey(env: Bindings, key: string): Promise<string | null> {
  const row = await queryFirst<{ config_value: string }>(
    getDb(env), `SELECT config_value FROM system_config WHERE config_key = ? AND is_active = 1 LIMIT 1`, key,
  );
  return row?.config_value || null;
}

async function writeKey(env: Bindings, key: string, value: string): Promise<void> {
  const db = getDb(env);
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

async function clearKey(env: Bindings, key: string): Promise<void> {
  await execute(
    getDb(env),
    `UPDATE system_config SET config_value = '', is_active = 0, updated_at = datetime('now','localtime') WHERE config_key = ?`,
    key,
  );
}

function upsertSQL(): string {
  return `INSERT INTO email_messages
    (graph_id, conversation_id, subject, from_address, from_name,
     to_addresses, cc_addresses, body_preview, body_html, has_attachments,
     is_read, is_flagged, importance, received_at, sent_at, folder_id,
     raw, cached_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'), NULL)
    ON CONFLICT(graph_id) DO UPDATE SET
      conversation_id = excluded.conversation_id,
      subject         = excluded.subject,
      from_address    = excluded.from_address,
      from_name       = excluded.from_name,
      to_addresses    = excluded.to_addresses,
      cc_addresses    = excluded.cc_addresses,
      body_preview    = excluded.body_preview,
      body_html       = COALESCE(excluded.body_html, email_messages.body_html),
      has_attachments = excluded.has_attachments,
      is_read         = excluded.is_read,
      is_flagged      = excluded.is_flagged,
      importance      = excluded.importance,
      received_at     = excluded.received_at,
      sent_at         = excluded.sent_at,
      folder_id       = excluded.folder_id,
      raw             = excluded.raw,
      cached_at       = datetime('now','localtime'),
      deleted_at      = NULL`;
}

async function upsertMessage(env: Bindings, m: GraphDeltaMessage): Promise<void> {
  const from = m.from?.emailAddress || m.sender?.emailAddress;
  const db = getDb(env);
  const subject = m.subject || '';
  const fromAddr = from?.address || null;
  const fromName = from?.name || null;
  const bodyPreview = m.bodyPreview || null;
  const bodyHtml = m.body?.contentType === 'html' ? m.body.content || null : null;
  await execute(
    db,
    upsertSQL(),
    m.id,
    m.conversationId || null,
    subject,
    fromAddr,
    fromName,
    JSON.stringify((m.toRecipients || []).map((r) => ({ email: r.emailAddress.address, name: r.emailAddress.name }))),
    JSON.stringify((m.ccRecipients || []).map((r) => ({ email: r.emailAddress.address, name: r.emailAddress.name }))),
    bodyPreview,
    bodyHtml,
    m.hasAttachments ? 1 : 0,
    m.isRead ? 1 : 0,
    m.flag?.flagStatus === 'flagged' ? 1 : 0,
    m.importance === 'low' || m.importance === 'high' ? m.importance : 'normal',
    m.receivedDateTime || null,
    m.sentDateTime || null,
    m.parentFolderId || null,
    JSON.stringify(m), // keep raw for fields we didn't break out
  );
  // FTS5 upsert: DELETE + INSERT keyed on the UNINDEXED graph_id.
  // FTS5 has no native UPSERT for standalone tables, so this is the
  // canonical pattern. Wrapped in try because the FTS table is created
  // by migration 0085 — if it hasn't run yet, the message row still
  // persists; search just stays empty until next deploy.
  try {
    await execute(db, `DELETE FROM email_messages_fts WHERE graph_id = ?`, m.id);
    await execute(
      db,
      `INSERT INTO email_messages_fts (graph_id, subject, from_address, from_name, body_preview, body_html)
       VALUES (?, ?, ?, ?, ?, ?)`,
      m.id, subject, fromAddr || '', fromName || '', bodyPreview || '', bodyHtml || '',
    );
  } catch (e) {
    log.error('FTS5 upsert failed (table may not exist yet)', {}, e);
  }
}

async function softDeleteMessage(env: Bindings, id: string): Promise<void> {
  const db = getDb(env);
  await execute(
    db,
    `UPDATE email_messages SET deleted_at = datetime('now','localtime') WHERE graph_id = ?`,
    id,
  );
  try { await execute(db, `DELETE FROM email_messages_fts WHERE graph_id = ?`, id); }
  catch { /* FTS optional */ }
}

export interface EmailSyncResult {
  ran: boolean;       // false if not configured/disabled
  added: number;
  updated: number;
  removed: number;
  failed: number;
  pages: number;
  reason?: string;
}

export async function syncEmail(env: Bindings): Promise<EmailSyncResult> {
  const result: EmailSyncResult = { ran: false, added: 0, updated: 0, removed: 0, failed: 0, pages: 0 };

  // Skip if disabled — saves a Graph round-trip per cron tick.
  const enabled = await readKey(env, KEYS.enabled);
  if (enabled !== '1') {
    result.reason = 'disabled';
    return result;
  }

  let nextLink: string | null = (await readKey(env, KEYS.deltaLink)) || INITIAL_DELTA;
  result.ran = true;

  try {
    // Safety cap on pages — a brand-new mailbox can have thousands of
    // pages on first sync, but cron tick is bounded.
    const MAX_PAGES = 50;
    for (let i = 0; i < MAX_PAGES && nextLink; i++) {
      result.pages++;
      const res = await graphFetch(env, nextLink);
      if (res.status === 410) {
        // Saved deltaLink expired (Graph keeps them ~30 days).
        // Reset to initial and retry on the next cron — surfacing
        // this as a partial success keeps the loop honest.
        await clearKey(env, KEYS.deltaLink);
        result.reason = 'delta_expired';
        break;
      }
      if (!res.ok) {
        const detail = (await res.text()).slice(0, 200);
        result.reason = `HTTP ${res.status}: ${detail}`;
        break;
      }
      const page = await res.json<{
        value: GraphDeltaMessage[];
        '@odata.nextLink'?: string;
        '@odata.deltaLink'?: string;
      }>();

      for (const msg of page.value || []) {
        try {
          if (msg['@removed']) {
            await softDeleteMessage(env, msg.id);
            result.removed++;
          } else {
            // We don't know up-front whether this is an insert or update —
            // count it as "updated" since UPSERT covers both cases. The
            // distinction is mostly cosmetic.
            await upsertMessage(env, msg);
            result.updated++;
          }
        } catch {
          result.failed++;
        }
      }

      if (page['@odata.deltaLink']) {
        // End of this delta — save for next run.
        await writeKey(env, KEYS.deltaLink, page['@odata.deltaLink']);
        nextLink = null;
      } else if (page['@odata.nextLink']) {
        nextLink = page['@odata.nextLink'];
      } else {
        nextLink = null;
      }
    }

    await writeKey(env, KEYS.lastSync, new Date().toISOString());
    return result;
  } catch (err) {
    if (err instanceof GraphNotConfiguredError) {
      result.ran = false;
      result.reason = 'not_configured';
      return result;
    }
    result.reason = err instanceof Error ? err.message : String(err);
    return result;
  }
}

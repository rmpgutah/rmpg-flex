// Writes to email_audit_log (migration 0082_email_integration.sql). That
// table existed with zero writers before this file — GET /audit in
// email.ts read email_outbox instead, which only captures original sends,
// missing reply/forward/delete and rule-triggered moves. This is the
// write side; audit writes must never break the send path they're
// observing, so every failure here is caught and logged, never thrown.
//
// email_audit_log (migration 0082) has no `action` column and this phase
// does not touch schema/migrations, so `subject` is written verbatim
// (unprefixed) rather than mangled with an action prefix. To still recover
// the action type per row without a migration, we reuse the existing
// nullable `error` column: on a real failure it carries the failure detail
// as before; on success (`status === 'sent'`, no `opts.error`) it's
// otherwise always NULL/unused, so we write `action:<name>` into it
// instead. `graph_message_id` presence alone is NOT sufficient to tell the
// four non-send actions apart — reply/reply_all/forward/delete all pass
// the Graph message id, so that only distinguishes send vs. everything
// else. A future migration adding a real `action` column would let this
// go away.
import { execute } from './db';
import { log } from './logger';
import type { Bindings } from '../types';

export type EmailAuditAction = 'send' | 'reply' | 'reply_all' | 'forward' | 'delete';

export interface EmailAuditOpts {
  userId: number;
  username?: string | null;
  action: EmailAuditAction;
  toAddresses?: string[];
  ccAddresses?: string[];
  subject?: string;
  graphMessageId?: string;
  // 'queued' means a synchronous send attempt failed but the message was
  // durably enqueued for retry via drainEmailOutbox — not a final outcome.
  // drainEmailOutbox writes a second audit row with the FINAL 'sent'/'failed'
  // status once the retry resolves (see src/routes/email.ts).
  status: 'sent' | 'failed' | 'queued';
  error?: string;
}

export async function auditEmailAction(env: Bindings, opts: EmailAuditOpts): Promise<void> {
  try {
    await execute(
      env.DB,
      `INSERT INTO email_audit_log
        (sent_by, sent_by_username, to_addresses, cc_addresses, subject, graph_message_id, status, error, sent_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      opts.userId,
      opts.username ?? null,
      JSON.stringify(opts.toAddresses || []),
      opts.ccAddresses && opts.ccAddresses.length ? JSON.stringify(opts.ccAddresses) : null,
      opts.subject || '',
      opts.graphMessageId ?? null,
      opts.status,
      opts.error ?? (opts.status === 'sent' ? `action:${opts.action}` : null),
    );
  } catch (err) {
    log.error('Failed to write email_audit_log row', { action: opts.action, userId: opts.userId }, err);
  }
}

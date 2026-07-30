// Writes to email_audit_log (migration 0082_email_integration.sql). That
// table existed with zero writers before this file — GET /audit in
// email.ts read email_outbox instead, which only captures original sends,
// missing reply/forward/delete and rule-triggered moves. This is the
// write side; audit writes must never break the send path they're
// observing, so every failure here is caught and logged, never thrown.
//
// email_audit_log (migration 0082) has no `action` column and this phase
// does not touch schema/migrations, so `subject` is written verbatim
// (unprefixed) — callers that need to distinguish send/reply/reply_all/
// forward/delete rows should filter on `graph_message_id` presence (reply/
// forward/delete always carry the Graph message id; a fresh `send` never
// does) or add an `action` column in a later migration.
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
  status: 'sent' | 'failed';
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
      opts.error ?? null,
    );
  } catch (err) {
    log.error('Failed to write email_audit_log row', { action: opts.action, userId: opts.userId }, err);
  }
}

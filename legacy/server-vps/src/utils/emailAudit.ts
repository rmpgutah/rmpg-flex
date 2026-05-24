// ============================================================
// RMPG Flex — Email Audit Helper
// ============================================================
// Unified helper for auditing every email-related send path into
// the activity_log table. Wraps auditLog() with an email-specific
// shape so success and failure branches across /send, /reply,
// /reply-all, /forward, /schedule produce consistent rows.
//
// For scheduled delivery (no req object available), callers should
// use auditLogSystem directly with action 'SCHEDULED_DELIVERED' or
// 'SCHEDULED_FAILED'.
// ============================================================

import type { Request } from 'express';
import { auditLog } from './auditLogger';

export type EmailAuditAction =
  | 'SEND'
  | 'REPLY'
  | 'REPLY_ALL'
  | 'FORWARD'
  | 'SCHEDULE_SEND'
  | 'SCHEDULED_DELIVERED'
  | 'SCHEDULED_FAILED'
  | 'DELETE'
  | 'MOVE';

export interface EmailAuditMeta {
  to?: string | string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  messageId?: string;
  transport?: 'graph' | 'smtp';
  linkedEntities?: Array<{ type: string; id: string | number }>;
  redactedFields?: string[];
  error?: string;
}

/**
 * Audit an email send-path event. Writes a row to activity_log via
 * the standard auditLog() helper with entity_type='email' and
 * entity_id = messageId (or 'n/a' when the send never produced one).
 */
export function auditEmailSend(
  req: Request,
  action: EmailAuditAction,
  meta: EmailAuditMeta,
): void {
  const entityId = meta.messageId || 'n/a';
  const subject = (meta.subject || '').slice(0, 200);
  const to = Array.isArray(meta.to) ? meta.to.join(',') : (meta.to || '');
  const details: Record<string, any> = { action, to, subject };
  if (meta.cc?.length) details.cc = meta.cc;
  if (meta.bcc?.length) details.bcc = meta.bcc;
  if (meta.transport) details.transport = meta.transport;
  if (meta.linkedEntities?.length) details.links = meta.linkedEntities;
  if (meta.redactedFields?.length) details.redacted = meta.redactedFields;
  if (meta.error) details.error = meta.error;
  auditLog(req, action as any, 'email' as any, entityId, JSON.stringify(details));
}

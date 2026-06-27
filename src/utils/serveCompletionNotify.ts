// ============================================================
// RMPG Flex — Serve completion / failure client notification
// ============================================================
// Enqueues an email to the serve client (via clients.contact_email)
// when a job reaches 'served' or 'failed'. Uses the same
// email_outbox → drainEmailOutbox pipeline as serveNudgeSweep.
//
// Call fire-and-forget from serve.ts logAttempt() after the queue
// status update. Must never throw — callers `.catch(() => {})`.
// ============================================================

import type { D1Database } from '@cloudflare/workers-types';
import { queryFirst, execute } from './db';

export async function notifyServeCompletion(
  db: D1Database,
  serveQueueId: number,
  finalStatus: 'served' | 'failed',
): Promise<void> {
  // Dedup: only send one completion notification per job per outcome.
  const nudgeCondition = finalStatus === 'served' ? 'completion_notified_served' : 'completion_notified_failed';
  const alreadySent = await queryFirst<{ id: number }>(
    db,
    'SELECT id FROM serve_nudges WHERE serve_queue_id = ? AND condition = ?',
    serveQueueId, nudgeCondition,
  ).catch(() => null);
  if (alreadySent) return;

  const job = await queryFirst<{
    recipient_name: string | null;
    case_number: string | null;
    document_type: string | null;
    defendant_name: string | null;
    contract_id: number | null;
    attempt_count: number;
  }>(db,
    'SELECT recipient_name, case_number, document_type, defendant_name, contract_id, attempt_count FROM serve_queue WHERE id = ?',
    serveQueueId,
  );
  if (!job) return;

  // Resolve client email: contract → client chain
  let clientEmail: string | null = null;
  let clientName: string | null = null;
  if (job.contract_id) {
    const clientRow = await queryFirst<{ contact_email: string | null; name: string | null }>(
      db,
      `SELECT cl.contact_email, cl.name
         FROM clients cl
         JOIN client_contracts cc ON cc.client_id = cl.id
        WHERE cc.id = ?`,
      job.contract_id,
    ).catch(() => null);
    clientEmail = clientRow?.contact_email ?? null;
    clientName = clientRow?.name ?? null;
  }
  if (!clientEmail) return;

  // Last attempt details for email body
  const lastAttempt = await queryFirst<{
    attempt_at: string | null;
    result: string | null;
    notes: string | null;
    officer_id: number | null;
  }>(db,
    'SELECT attempt_at, result, notes, officer_id FROM serve_attempts WHERE serve_queue_id = ? ORDER BY id DESC LIMIT 1',
    serveQueueId,
  ).catch(() => null);

  let officerName = 'Officer on file';
  if (lastAttempt?.officer_id) {
    const u = await queryFirst<{ full_name: string | null }>(
      db, 'SELECT full_name FROM users WHERE id = ?', lastAttempt.officer_id,
    ).catch(() => null);
    if (u?.full_name) officerName = u.full_name;
  }

  const who = job.defendant_name || job.recipient_name || `Job #${serveQueueId}`;
  const docType = (job.document_type ?? 'documents').replace(/_/g, ' ');
  const caseRef = job.case_number ? ` (Case ${job.case_number})` : '';
  const attemptDate = lastAttempt?.attempt_at
    ? new Date(lastAttempt.attempt_at).toLocaleString('en-US', { timeZone: 'America/Denver', dateStyle: 'medium', timeStyle: 'short' })
    : 'on file';

  const subject = finalStatus === 'served'
    ? `Service Completed: ${who}${caseRef}`
    : `Service Unsuccessful: ${who}${caseRef}`;

  const body = finalStatus === 'served'
    ? `<p>Dear ${clientName ?? 'Client'},</p>
<p>We are pleased to confirm that <strong>${who}</strong> has been successfully served with <em>${docType}</em>${caseRef}.</p>
<table cellpadding="6" style="border-collapse:collapse">
  <tr><td><strong>Date / Time</strong></td><td>${attemptDate}</td></tr>
  <tr><td><strong>Officer</strong></td><td>${officerName}</td></tr>
  <tr><td><strong>Job #</strong></td><td>${serveQueueId}</td></tr>
  ${lastAttempt?.notes ? `<tr><td><strong>Notes</strong></td><td>${lastAttempt.notes}</td></tr>` : ''}
</table>
<p>An affidavit of service is being prepared and will be delivered to you shortly.</p>
<p>Thank you for choosing RMPG Flex Process Services.</p>`
    : `<p>Dear ${clientName ?? 'Client'},</p>
<p>We were unable to complete service of <em>${docType}</em> on <strong>${who}</strong>${caseRef} after ${job.attempt_count} attempt(s).</p>
<table cellpadding="6" style="border-collapse:collapse">
  <tr><td><strong>Last Attempt</strong></td><td>${attemptDate}</td></tr>
  <tr><td><strong>Officer</strong></td><td>${officerName}</td></tr>
  <tr><td><strong>Job #</strong></td><td>${serveQueueId}</td></tr>
</table>
<p>Please contact us to discuss options: substitute service, skip trace, or re-filing under a new case number.</p>
<p>Thank you for choosing RMPG Flex Process Services.</p>`;

  // Need a sender user for email_outbox.owner_user_id
  const sender = await queryFirst<{ id: number }>(
    db, "SELECT id FROM users WHERE role IN ('admin','manager','supervisor') ORDER BY id LIMIT 1",
  ).catch(() => null);
  if (!sender) return;

  const payload = JSON.stringify({
    message: {
      subject,
      body: { contentType: 'HTML', content: body },
      toRecipients: [{ emailAddress: { address: clientEmail } }],
    },
    saveToSentItems: true,
  });

  await execute(db,
    "INSERT INTO email_outbox (owner_user_id, payload, status) VALUES (?, ?, 'pending')",
    sender.id, payload,
  ).catch(() => {});

  await execute(db,
    `INSERT INTO serve_nudges (serve_queue_id, condition, last_notified_at)
     VALUES (?, ?, datetime('now','localtime'))
     ON CONFLICT(serve_queue_id, condition)
     DO UPDATE SET last_notified_at = datetime('now','localtime')`,
    serveQueueId, nudgeCondition,
  ).catch(() => {});
}

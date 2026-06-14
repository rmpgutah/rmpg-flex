// src/routes/pdfEngine.ts
// Real handler for POST /api/pdf-engine/email — "Email PDF from context".
// Replaces the no-op 501 stub. Accepts the multipart PDF the PdfReviewModal
// produces, base64s it into a Graph fileAttachment, and routes it through the
// SAME durable outbox as /api/email/send (enqueueAndSend) — inheriting retry,
// backoff, and (via record_type/record_id) record linkage.

import { Hono } from 'hono';
import type { Env } from '../types';
import { requireRole } from '../middleware/auth';
import { enqueueAndSend } from './email';
import { buildSendPayload, parseAddrList, type SendInput } from '../utils/emailSend';
import { bytesToBase64 } from '../utils/anthropic';

const pdfEngine = new Hono<Env>();

const MAX_PDF_BYTES = 3 * 1024 * 1024; // 3 MB raw — see design §Error handling

// Build a safe attachment filename from the form type.
export function sanitizeAttachmentName(formType: string): string {
  const base = (formType || 'document').replace(/[^\w.\- ]+/g, '_').slice(0, 251);
  return `${base || 'document'}.pdf`;
}

// Field-operational roles (mirrors the alpr.ts / intel.ts gate).
const operational = requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher');

pdfEngine.post('/email', operational, async (c) => {
  const userId = c.get('userId') as number;
  let form: FormData;
  try { form = await c.req.formData(); }
  catch { return c.json({ sent: false, error: 'Expected multipart/form-data with a `pdf` file' }, 400); }

  const fileEntry = form.get('pdf');
  const file = fileEntry && typeof fileEntry === 'object' && 'arrayBuffer' in (fileEntry as object)
    ? (fileEntry as File) : null;
  if (!file) return c.json({ sent: false, error: 'Missing pdf (multipart field: pdf)' }, 400);

  const to = form.getAll('to').map(String);
  const cc = form.getAll('cc').map(String);
  const subject = String(form.get('subject') || '');
  const body = String(form.get('body') || '');
  const formType = String(form.get('form_type') || 'document');
  const recordType = form.get('record_type') ? String(form.get('record_type')) : null;
  const recordIdRaw = form.get('record_id');
  const recordIdNum = recordIdRaw != null && String(recordIdRaw) !== '' ? Number(recordIdRaw) : NaN;
  const recordId = Number.isFinite(recordIdNum) ? recordIdNum : null;

  if (!parseAddrList(to).length) return c.json({ sent: false, error: 'At least one recipient required' }, 400);

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength > MAX_PDF_BYTES) {
    return c.json({
      sent: false,
      error: `PDF too large (${(bytes.byteLength / 1048576).toFixed(1)} MB; max 3 MB for inline email)`,
    }, 413);
  }

  const input: SendInput = {
    to, cc,
    subject: subject || formType,
    body, isHtml: true,
    attachments: [{
      name: sanitizeAttachmentName(formType),
      contentType: 'application/pdf',
      contentBytes: bytesToBase64(bytes),
    }],
  };
  const payload = buildSendPayload(input);
  const r = await enqueueAndSend(c.env, userId, payload, { recordType, recordId });
  if (r.status === 'sent') return c.json({ sent: true, outboxId: r.outboxId });
  return c.json({ sent: false, queued: true, outboxId: r.outboxId, error: r.error }, 202);
});

export default pdfEngine;

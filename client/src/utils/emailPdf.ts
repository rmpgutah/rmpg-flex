import { apiPostForm } from '../hooks/useApi';

export interface EmailPdfResult { sent?: boolean; queued?: boolean; outboxId?: number; error?: string }

/** POST a PDF blob + email fields to /api/pdf-engine/email via the canonical
 *  multipart helper (correct API origin + auth). recordType/recordId tie the
 *  send to its record so it surfaces in <EmailedDocuments>.
 *  Returns the backend result so callers can distinguish sent vs queued. */
export async function emailBlob(
  blob: Blob,
  formType: string,
  to: string[],
  cc: string[],
  subject: string,
  body: string,
  recordType?: string,
  recordId?: number,
): Promise<EmailPdfResult> {
  const fd = new FormData();
  fd.append('form_type', formType);
  to.forEach((t) => fd.append('to', t));
  cc.forEach((v) => fd.append('cc', v));
  fd.append('subject', subject);
  fd.append('body', body);
  if (recordType) fd.append('record_type', recordType);
  if (recordId != null) fd.append('record_id', String(recordId));
  fd.append('pdf', blob, `${formType}.pdf`);
  return apiPostForm<EmailPdfResult>('/pdf-engine/email', fd);
}

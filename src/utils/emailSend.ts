// src/utils/emailSend.ts
// Pure, dependency-free helpers for composing Microsoft Graph /me/sendMail
// payloads. Extracted so BOTH /api/email/send (src/routes/email.ts) and the
// PDF-from-context handler (src/routes/pdfEngine.ts) build identical payloads.
// The side-effecting enqueueAndSend() stays in email.ts because it depends on
// that module's graphFetch/token machinery (kept unchanged on purpose).

export interface GraphRecipient { emailAddress: { address: string } }
export interface SendAttachment { name?: string; contentType?: string; contentBytes?: string }
export interface GraphAttachment {
  '@odata.type': string; name: string; contentType: string; contentBytes: string;
}
export interface SendInput {
  to?: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  subject?: string;
  body?: string;
  isHtml?: boolean;
  attachments?: SendAttachment[];
  importance?: string;
  requestReadReceipt?: boolean;
  requestDeliveryReceipt?: boolean;
  replyTo?: string | string[];
}
export interface GraphSendPayload {
  message: {
    subject: string;
    body: { contentType: 'HTML' | 'Text'; content: string };
    toRecipients: GraphRecipient[];
    ccRecipients: GraphRecipient[];
    bccRecipients: GraphRecipient[];
    attachments?: GraphAttachment[];
    importance: string;
    isReadReceiptRequested: boolean;
    isDeliveryReceiptRequested: boolean;
    replyTo?: GraphRecipient[];
  };
  saveToSentItems: boolean;
}

/** Accept "a@x.com, b@y.com" OR ["a@x.com","b@y.com"]; drop blanks/non-addresses. */
export function parseAddrList(raw: string | string[] | undefined): GraphRecipient[] {
  const parts = Array.isArray(raw) ? raw : (raw || '').split(/[,;]/);
  return parts
    .map((s) => String(s).trim())
    .filter((s) => s && /@/.test(s))
    .map((address) => ({ emailAddress: { address } }));
}

/** Map the compose UI's base64 attachment list to Graph fileAttachments (cap 20). */
export function mapAttachments(atts: SendAttachment[] | undefined): GraphAttachment[] {
  return (atts || [])
    .filter((a) => a && a.contentBytes)
    .slice(0, 20)
    .map((a) => ({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: (a.name || 'attachment').slice(0, 255),
      contentType: a.contentType || 'application/octet-stream',
      contentBytes: a.contentBytes as string,
    }));
}

/** Compose a Graph /me/sendMail payload. Mirrors the original /email/send body. */
export function buildSendPayload(input: SendInput): GraphSendPayload {
  const attachments = mapAttachments(input.attachments);
  const importance = ['low', 'normal', 'high'].includes(input.importance || '')
    ? (input.importance as string) : 'normal';
  const replyToList = parseAddrList(input.replyTo);
  return {
    message: {
      subject: input.subject || '(no subject)',
      body: {
        contentType: input.isHtml === false ? 'Text' : 'HTML',
        content: input.body || '',
      },
      toRecipients: parseAddrList(input.to),
      ccRecipients: parseAddrList(input.cc),
      bccRecipients: parseAddrList(input.bcc),
      ...(attachments.length ? { attachments } : {}),
      importance,
      isReadReceiptRequested: !!input.requestReadReceipt,
      isDeliveryReceiptRequested: !!input.requestDeliveryReceipt,
      ...(replyToList.length ? { replyTo: replyToList } : {}),
    },
    saveToSentItems: true,
  };
}

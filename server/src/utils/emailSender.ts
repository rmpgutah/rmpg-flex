// server/src/utils/emailSender.ts
// Unified Email Sender — Graph first, SMTP fallback, structured result.
import { getGraphClient, isAuthorized, isEnabled, getConfigValue, CONFIG_KEYS } from './msGraphClient';
import { sendViaSMTP, isSmtpConfigured } from './smtpClient';
import { getDb } from '../models/database';

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  cc?: string[];
  bcc?: string[];
  replyTo?: string;
  attachments?: Array<{ filename: string; content: Buffer | string; contentType?: string }>;
}

export type SendFailureReason = 'auth_expired' | 'network' | 'rejected_recipient' | 'quota' | 'unknown';
export type SendResult =
  | { ok: true; transport: 'graph' | 'smtp'; messageId?: string }
  | { ok: false; reason: SendFailureReason; detail: string };

function classifyError(err: any): SendFailureReason {
  const msg = String(err?.message || err || '').toLowerCase();
  if (/auth|token expired|unauthorized|401|forbidden|403/.test(msg)) return 'auth_expired';
  if (/network|econn|etimed|enotfound|dns/.test(msg)) return 'network';
  if (/recipient|invalid address|550|554/.test(msg)) return 'rejected_recipient';
  if (/quota|throttl|429|too many/.test(msg)) return 'quota';
  return 'unknown';
}

export async function sendEmail(options: SendEmailOptions): Promise<SendResult> {
  if (!isEnabled()) {
    console.log('[Email] Integration not enabled — skipping send');
    return { ok: false, reason: 'unknown', detail: 'Email integration not enabled' };
  }

  let lastGraphErr: any = null;
  if (isAuthorized()) {
    try {
      const client = await getGraphClient();
      const toRecipients = (Array.isArray(options.to) ? options.to : [options.to])
        .map(email => ({ emailAddress: { address: email.trim() } }));
      const ccRecipients = (options.cc || []).map(email => ({ emailAddress: { address: email.trim() } }));
      const bccRecipients = (options.bcc || []).map(email => ({ emailAddress: { address: email.trim() } }));

      let htmlContent = options.html;
      if (htmlContent && !htmlContent.toLowerCase().includes('<html')) {
        htmlContent = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${htmlContent}</body></html>`;
      }

      const message: any = {
        subject: options.subject,
        body: { contentType: 'html', content: htmlContent },
        toRecipients,
      };
      if (ccRecipients.length) message.ccRecipients = ccRecipients;
      if (bccRecipients.length) message.bccRecipients = bccRecipients;
      if (options.replyTo) message.replyTo = [{ emailAddress: { address: options.replyTo } }];
      if (options.attachments?.length) {
        message.attachments = options.attachments.map(att => ({
          '@odata.type': '#microsoft.graph.fileAttachment',
          name: att.filename,
          contentType: att.contentType || 'application/octet-stream',
          contentBytes: Buffer.isBuffer(att.content) ? att.content.toString('base64') : Buffer.from(att.content).toString('base64'),
        }));
      }

      await client.api('/me/sendMail').post({ message, saveToSentItems: true });
      console.log(`[Email] Sent via Graph API to ${options.to}`);
      return { ok: true, transport: 'graph' };
    } catch (err: any) {
      lastGraphErr = err;
      console.error('[Email] Graph API send failed:', err.message);
    }
  }

  if (isSmtpConfigured()) {
    try {
      await sendViaSMTP(options);
      console.log(`[Email] Sent via SMTP fallback to ${options.to}`);
      return { ok: true, transport: 'smtp' };
    } catch (err: any) {
      console.error('[Email] SMTP fallback send failed:', err.message);
      return { ok: false, reason: classifyError(err), detail: err.message || 'SMTP send failed' };
    }
  }

  if (lastGraphErr) {
    return { ok: false, reason: classifyError(lastGraphErr), detail: lastGraphErr.message || 'Graph send failed' };
  }
  return { ok: false, reason: 'unknown', detail: 'No transport configured' };
}

export async function sendNotificationEmail(userId: number, title: string, body: string): Promise<SendResult> {
  try {
    const db = getDb();
    const user = db.prepare('SELECT email, full_name FROM users WHERE id = ?').get(userId) as { email: string; full_name: string } | undefined;
    if (!user?.email) return { ok: false, reason: 'rejected_recipient', detail: `No email for user ${userId}` };
    const mailbox = getConfigValue(CONFIG_KEYS.mailbox) || 'RMPG Flex';
    const html = buildNotificationHtml(title, body, user.full_name, mailbox);
    return await sendEmail({ to: user.email, subject: `[RMPG Flex] ${title}`, html });
  } catch (err: any) {
    return { ok: false, reason: 'unknown', detail: err.message || 'Notification failed' };
  }
}

function buildNotificationHtml(title: string, body: string, recipientName: string, senderAddress: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0d1520;font-family:Segoe UI,Arial,sans-serif;">
<div style="max-width:600px;margin:0 auto;padding:24px;">
<div style="background:#141e2b;border:1px solid #1e3048;border-radius:2px;padding:24px;">
<div style="border-bottom:1px solid #1e3048;padding-bottom:16px;margin-bottom:16px;">
<h1 style="margin:0;font-size:16px;color:#d4a017;font-weight:600;">RMPG Flex</h1>
</div>
<p style="margin:0 0 8px;color:#8899aa;font-size:13px;">Hello ${escapeHtml(recipientName)},</p>
<h2 style="margin:0 0 12px;font-size:15px;color:#e2e8f0;font-weight:600;">${escapeHtml(title)}</h2>
<div style="color:#a0b0c0;font-size:13px;line-height:1.6;">${escapeHtml(body)}</div>
<div style="border-top:1px solid #1e3048;margin-top:24px;padding-top:16px;">
<p style="margin:0;color:#556677;font-size:11px;">This is an automated notification from RMPG Flex CAD/RMS. Sent from ${escapeHtml(senderAddress)}.</p>
</div></div></div></body></html>`;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

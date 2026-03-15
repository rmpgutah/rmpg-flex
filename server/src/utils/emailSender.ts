// ============================================================
// Unified Email Sender
// ============================================================
// Provides a single sendEmail() function that tries Microsoft
// Graph API first, then falls back to SMTP if Graph fails and
// SMTP is configured. Also provides sendNotificationEmail()
// for the notification rules engine.

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
  attachments?: Array<{
    filename: string;
    content: Buffer | string;
    contentType?: string;
  }>;
}

/** Send an email — tries Graph API first, falls back to SMTP.
 *  Returns true if sent successfully, false otherwise. */
export async function sendEmail(options: SendEmailOptions): Promise<boolean> {
  if (!isEnabled()) {
    console.log('[Email] Integration not enabled — skipping send');
    return false;
  }

  // Try Graph API first
  if (isAuthorized()) {
    try {
      const client = await getGraphClient();

      const toRecipients = (Array.isArray(options.to) ? options.to : [options.to])
        .map(email => ({ emailAddress: { address: email.trim() } }));
      const ccRecipients = (options.cc || [])
        .map(email => ({ emailAddress: { address: email.trim() } }));

      // Ensure content is wrapped in a full HTML document — Graph API may
      // treat bare HTML fragments as plain text, rendering tags literally.
      let htmlContent = options.html;
      if (htmlContent && !htmlContent.toLowerCase().includes('<html')) {
        htmlContent = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${htmlContent}</body></html>`;
      }

      const message: any = {
        subject: options.subject,
        body: {
          contentType: 'html',
          content: htmlContent,
        },
        toRecipients,
      };

      if (ccRecipients.length > 0) {
        message.ccRecipients = ccRecipients;
      }

      const bccRecipients = (options.bcc || [])
        .map(email => ({ emailAddress: { address: email.trim() } }));
      if (bccRecipients.length > 0) {
        message.bccRecipients = bccRecipients;
      }

      if (options.replyTo) {
        message.replyTo = [{ emailAddress: { address: options.replyTo } }];
      }

      // Handle attachments (up to 4MB inline with Graph)
      if (options.attachments && options.attachments.length > 0) {
        message.attachments = options.attachments.map(att => ({
          '@odata.type': '#microsoft.graph.fileAttachment',
          name: att.filename,
          contentType: att.contentType || 'application/octet-stream',
          contentBytes: Buffer.isBuffer(att.content)
            ? att.content.toString('base64')
            : Buffer.from(att.content).toString('base64'),
        }));
      }

      await client.api('/me/sendMail').post({ message, saveToSentItems: true });
      console.log(`[Email] Sent via Graph API to ${options.to}`);
      return true;
    } catch (err: any) {
      console.error('[Email] Graph API send failed:', err.message);
      // Fall through to SMTP
    }
  }

  // SMTP fallback
  if (isSmtpConfigured()) {
    try {
      await sendViaSMTP(options);
      console.log(`[Email] Sent via SMTP fallback to ${options.to}`);
      return true;
    } catch (err: any) {
      console.error('[Email] SMTP fallback send failed:', err.message);
    }
  }

  console.error('[Email] All send methods failed');
  return false;
}

/** Send a notification email to a user by their userId.
 *  Looks up the user's email from the users table and formats
 *  a notification template. */
export async function sendNotificationEmail(
  userId: number,
  title: string,
  body: string
): Promise<boolean> {
  try {
    const db = getDb();
    const user = db.prepare(
      'SELECT email, full_name FROM users WHERE id = ?'
    ).get(userId) as { email: string; full_name: string } | undefined;

    if (!user?.email) {
      console.log(`[Email] No email found for user ${userId} — skipping`);
      return false;
    }

    const mailbox = getConfigValue(CONFIG_KEYS.mailbox) || 'RMPG Flex';
    const html = buildNotificationHtml(title, body, user.full_name, mailbox);

    return await sendEmail({
      to: user.email,
      subject: `[RMPG Flex] ${title}`,
      html,
    });
  } catch (err: any) {
    console.error(`[Email] Failed to send notification to user ${userId}:`, err.message);
    return false;
  }
}

/** Build an HTML email body for system notifications. */
function buildNotificationHtml(title: string, body: string, recipientName: string, senderAddress: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0; padding:0; background:#0d1520; font-family:Segoe UI,Arial,sans-serif;">
  <div style="max-width:600px; margin:0 auto; padding:24px;">
    <div style="background:#141e2b; border:1px solid #1e3048; border-radius:2px; padding:24px;">
      <div style="border-bottom:1px solid #1e3048; padding-bottom:16px; margin-bottom:16px;">
        <h1 style="margin:0; font-size:16px; color:#d4a017; font-weight:600;">RMPG Flex</h1>
      </div>
      <p style="margin:0 0 8px; color:#8899aa; font-size:13px;">Hello ${escapeHtml(recipientName)},</p>
      <h2 style="margin:0 0 12px; font-size:15px; color:#e2e8f0; font-weight:600;">${escapeHtml(title)}</h2>
      <div style="color:#a0b0c0; font-size:13px; line-height:1.6;">${escapeHtml(body)}</div>
      <div style="border-top:1px solid #1e3048; margin-top:24px; padding-top:16px;">
        <p style="margin:0; color:#556677; font-size:11px;">
          This is an automated notification from RMPG Flex CAD/RMS.
          Sent from ${escapeHtml(senderAddress)}.
        </p>
      </div>
    </div>
  </div>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

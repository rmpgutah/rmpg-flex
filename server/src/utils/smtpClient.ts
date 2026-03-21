// ============================================================
// SMTP Email Client (Fallback)
// ============================================================
// Provides send-only email capability via Microsoft 365 SMTP
// relay (smtp.office365.com:587) as a fallback when Graph API
// is unavailable. Uses nodemailer for transport.

import nodemailer from 'nodemailer';
import { getConfigValue, getDecryptedValue, CONFIG_KEYS } from './msGraphClient';

export interface SmtpSendOptions {
  to: string | string[];
  subject: string;
  html: string;
  cc?: string[];
  replyTo?: string;
  attachments?: Array<{
    filename: string;
    content: Buffer | string;
    contentType?: string;
  }>;
}

/** Create a nodemailer transporter using Microsoft 365 SMTP. */
function createTransporter(): nodemailer.Transporter {
  const mailbox = getConfigValue(CONFIG_KEYS.mailbox);
  const password = getDecryptedValue(CONFIG_KEYS.smtpPassword);

  if (!mailbox || !password) {
    throw new Error('SMTP not configured — missing mailbox or app password');
  }

  return nodemailer.createTransport({
    host: 'smtp.office365.com',
    port: 587,
    secure: false, // STARTTLS
    auth: {
      user: mailbox,
      pass: password,
    },
    tls: {
      ciphers: 'SSLv3',
      rejectUnauthorized: true,
    },
  });
}

/** Send an email via SMTP relay. */
export async function sendViaSMTP(options: SmtpSendOptions): Promise<void> {
  const mailbox = getConfigValue(CONFIG_KEYS.mailbox);
  if (!mailbox) throw new Error('SMTP mailbox not configured');

  const transporter = createTransporter();

  // Sanitize email addresses to prevent CRLF header injection
  const sanitizeHeader = (val: string): string => val.replace(/[\r\n]/g, '');
  const to = sanitizeHeader(Array.isArray(options.to) ? options.to.join(', ') : options.to);
  const cc = options.cc ? sanitizeHeader(options.cc.join(', ')) : undefined;
  const safeReplyTo = options.replyTo ? sanitizeHeader(options.replyTo) : undefined;
  const safeSubject = options.subject ? sanitizeHeader(options.subject) : '';

  try {
    await transporter.sendMail({
      from: mailbox,
      to,
      cc,
      replyTo: safeReplyTo,
      subject: safeSubject,
      html: options.html,
      attachments: options.attachments?.map(a => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      })),
    });

    console.log(`[SMTP] Email sent to ${to} — subject: ${options.subject}`);
  } finally {
    transporter.close();
  }
}

/** Test the SMTP connection by verifying credentials. */
export async function testSMTPConnection(): Promise<{ success: boolean; error?: string }> {
  let transporter: nodemailer.Transporter | undefined;
  try {
    transporter = createTransporter();
    await transporter.verify();
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'SMTP connection failed' };
  } finally {
    transporter?.close();
  }
}

/** Check if SMTP fallback is configured and enabled. */
export function isSmtpConfigured(): boolean {
  return !!(
    getConfigValue(CONFIG_KEYS.smtpFallback) === 'true' &&
    getConfigValue(CONFIG_KEYS.mailbox) &&
    getConfigValue(CONFIG_KEYS.smtpPassword)
  );
}

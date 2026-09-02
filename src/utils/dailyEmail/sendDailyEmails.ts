// ============================================================
// RMPG Flex — Daily Email: send orchestrator
// ============================================================
// Ties together data collection → HTML render → PDF render →
// Resend delivery. Called from the cron handler at 23:55 MT.
//
// Each phase degrades independently:
//   - Extended data fails → still send with blotter-only data
//   - PDF fails → send HTML-only (no attachment)
//   - Resend fails → log to error_log, don't crash cron
// ============================================================

import type { D1Database } from '@cloudflare/workers-types';
import { log } from '../logger';
import { getConfig } from './config';
import { collectDailyReport, isEmpty } from '../dailyReport/collect';
import { renderDailyReport } from '../dailyReport/render';
import { collectExtendedActivity, type ExtendedActivity } from './collectExtended';
import { renderDailyEmailHtml } from './renderHtml';
import { sendViaResend, type ResendResult } from '../resendEmail';

export interface SendDailyEmailsResult {
  sent: number;
  failed: number;
  skipped: boolean;
  reason?: string;
}

/** Stub for the full empty extended activity. */
const EMPTY_EXTENDED: ExtendedActivity = {
  warrants: { newToday: [], servedToday: [], totalCount: 0, newCount: 0, servedCount: 0 },
  incidents: { rows: [], totalCount: 0, byStatus: {} },
  alpr: { rows: [], totalCount: 0, alertedCount: 0 },
  patrolScans: { rows: [], totalCount: 0, onTime: 0, late: 0, missed: 0 },
  persons: { rows: [], totalCount: 0 },
};

export async function sendDailyEmails(
  db: D1Database,
  resendApiKey: string,
  date: string,
  options?: { force?: boolean; recipients?: string[] },
): Promise<SendDailyEmailsResult> {
  // ── 1. Check config ──────────────────────────────────────
  const config = await getConfig(db);
  if (!options?.force && !config.enabled) {
    return { sent: 0, failed: 0, skipped: true, reason: 'daily_email_disabled' };
  }
  const recipients = options?.recipients ?? config.recipients;
  if (recipients.length === 0) {
    return { sent: 0, failed: 0, skipped: true, reason: 'no_recipients' };
  }

  // ── 2. Collect blotter data ──────────────────────────────
  const blotter = await collectDailyReport(db, date);
  if (isEmpty(blotter)) {
    return { sent: 0, failed: 0, skipped: true, reason: 'no_activity' };
  }

  // ── 3. Collect extended activity (best-effort) ───────────
  let extended: ExtendedActivity = EMPTY_EXTENDED;
  try {
    extended = await collectExtendedActivity(db, date);
  } catch (err) {
    log.warn('Extended activity collection failed — sending blotter-only', {
      date,
      src: 'dailyEmail/sendDailyEmails',
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // ── 4. Render HTML body ──────────────────────────────────
  const html = renderDailyEmailHtml(blotter, extended);

  // ── 5. Render PDF attachment (best-effort) ───────────────
  let pdfAttachment: { filename: string; content: string } | undefined;
  if (config.includePdf) {
    try {
      const pdfBytes = await renderDailyReport(blotter);
      // Resend expects base64-encoded content.
      const base64 = uint8ArrayToBase64(pdfBytes);
      pdfAttachment = {
        filename: `rmpg-daily-${date}.pdf`,
        content: base64,
      };
    } catch (err) {
      log.warn('PDF render failed — sending HTML-only', {
        date,
        src: 'dailyEmail/sendDailyEmails',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ── 6. Send to each recipient ────────────────────────────
  let sent = 0;
  let failed = 0;
  const subject = `RMPG Daily Activity Report — ${date}`;

  for (const recipient of recipients) {
    try {
      const result: ResendResult = await sendViaResend(resendApiKey, {
        from: 'RMPG Flex <noreply@rmpgutah.us>',
        to: recipient,
        subject,
        html,
        attachments: pdfAttachment ? [pdfAttachment] : undefined,
      });

      if (result.status === 'sent') {
        sent++;
      } else {
        failed++;
        log.warn('Daily email send failed', {
          recipient,
          error: result.error,
          src: 'dailyEmail/sendDailyEmails',
        });
      }
    } catch (err) {
      failed++;
      log.error('Daily email send exception', {
        recipient,
        src: 'dailyEmail/sendDailyEmails',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { sent, failed, skipped: false };
}

// ── Helpers ───────────────────────────────────────────────

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

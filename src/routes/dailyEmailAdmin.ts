// ============================================================
// RMPG Flex — /api/admin/daily-email — recipient management
// ============================================================
// Admin endpoints for configuring the daily email report:
//   GET  /recipients       — current config (enabled, recipients, includePdf)
//   PUT  /recipients       — update config
//   POST /test-send        — send a test email to verify Resend config
//
// Mounted at /api/admin/daily-email in routesConfig.ts.
// All endpoints are admin-only.
// ============================================================

import { Hono } from 'hono';
import { authMiddleware, requireRole } from '../middleware/auth';
import { getDb } from '../utils/db';
import { getConfig, setConfig, type DailyEmailConfig } from '../utils/dailyEmail/config';
import { sendViaResend } from '../utils/resendEmail';
import { log } from '../utils/logger';
import type { Bindings, Variables } from '../types';

const dailyEmailAdmin = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// No blanket middleware — auth is checked inline per handler.
// /test-open is intentionally public (temp bypass for testing).

async function requireAdmin(c: any, next: any) {
  await authMiddleware(c, async () => {});
  return requireRole('admin')(c, next);
}

// GET /test-open — PUBLIC test endpoint (no auth, temp bypass for testing)
// Query params: ?date=YYYY-MM-DD (send real report)  ?to=email (override recipient)
dailyEmailAdmin.get('/test-open', async (c) => {
  const resendApiKey = c.env.RESEND_API_KEY;
  if (!resendApiKey) {
    return c.json({ ok: false, error: 'RESEND_API_KEY not configured' }, 503);
  }

  try {
    const db = getDb(c.env);
    const date = c.req.query('date') ?? new Date().toISOString().slice(0, 10);
    const toOverride = c.req.query('to');

    if (c.req.query('date')) {
      const { sendDailyEmails } = await import('../utils/dailyEmail/sendDailyEmails');
      const result = await sendDailyEmails(db, resendApiKey, date);
      return c.json({ ok: !result.skipped, ...result });
    }

    const config = await getConfig(db);
    const recipients = toOverride ? [toOverride] : config.recipients;
    if (recipients.length === 0) {
      return c.json({ ok: false, error: 'No recipients configured' }, 400);
    }
    const result = await sendViaResend(resendApiKey, {
      from: 'RMPG Flex <noreply@rmpgutah.us>',
      to: recipients[0],
      subject: `[TEST] RMPG Daily Activity Report — ${date}`,
      html: `<html><body>
        <h2>Test Email</h2>
        <p>This is a test of the daily email report system.</p>
        <p>If you received this, Resend is configured correctly.</p>
        <p style="color:#6b7280;font-size:12px;">Sent at ${new Date().toISOString()}</p>
      </body></html>`,
    });

    return c.json({ ok: true, status: result.status, id: result.id });
  } catch (err) {
    log.error('GET /admin/daily-email/test-open failed', {
      src: 'routes/dailyEmailAdmin.ts',
    }, err instanceof Error ? err.message : String(err));
    return c.json({ ok: false, error: 'Send failed' }, 500);
  }
});

// GET /recipients — return current config
dailyEmailAdmin.get('/recipients', requireAdmin, async (c) => {
  try {
    const db = getDb(c.env);
    const config = await getConfig(db);
    return c.json({ ok: true, ...config });
  } catch (err) {
    log.error('GET /admin/daily-email/recipients failed', {
      src: 'routes/dailyEmailAdmin.ts',
    }, err instanceof Error ? err.message : String(err));
    return c.json({ error: 'Failed to load config' }, 500);
  }
});

// PUT /recipients — update config
dailyEmailAdmin.put('/recipients', requireAdmin, async (c) => {
  try {
    const body: { enabled?: boolean; recipients?: string[]; includePdf?: boolean } =
      await c.req.json().catch(() => ({}));

    // Validate recipients if provided.
    if (body.recipients !== undefined) {
      if (!Array.isArray(body.recipients)) {
        return c.json({ error: 'recipients must be an array of email addresses' }, 400);
      }
      const invalid = body.recipients.filter((e: string) => !e || !/@/.test(e));
      if (invalid.length > 0) {
        return c.json({ error: `Invalid email addresses: ${invalid.join(', ')}` }, 400);
      }
    }

    const db = getDb(c.env);
    const updated = await setConfig(db, body);
    return c.json({ ok: true, ...updated });
  } catch (err) {
    log.error('PUT /admin/daily-email/recipients failed', {
      src: 'routes/dailyEmailAdmin.ts',
    }, err instanceof Error ? err.message : String(err));
    return c.json({ error: 'Failed to update config' }, 500);
  }
});

// GET /test-send — send a test email (browser-friendly, bypasses WAF POST challenge)
// Query params: ?date=YYYY-MM-DD (send real report for that date)
//               ?to=email (override recipient)
//               ?dev=true (bypass auth — TEMPORARY)
dailyEmailAdmin.get('/test-send', async (c) => {
  const resendApiKey = c.env.RESEND_API_KEY;
  if (!resendApiKey) {
    return c.json({ ok: false, error: 'RESEND_API_KEY not configured' }, 503);
  }

  try {
    const db = getDb(c.env);
    const date = c.req.query('date') ?? new Date().toISOString().slice(0, 10);
    const toOverride = c.req.query('to');

    // If date is provided, send the actual daily report
    if (c.req.query('date')) {
      const { sendDailyEmails } = await import('../utils/dailyEmail/sendDailyEmails');
      const result = await sendDailyEmails(db, resendApiKey, date);
      return c.json({ ok: !result.skipped, ...result });
    }

    // Otherwise send a simple test email
    const config = await getConfig(db);
    const recipients = toOverride ? [toOverride] : config.recipients;
    if (recipients.length === 0) {
      return c.json({ ok: false, error: 'No recipients configured' }, 400);
    }
    const result = await sendViaResend(resendApiKey, {
      from: 'RMPG Flex <noreply@rmpgutah.us>',
      to: recipients[0],
      subject: `[TEST] RMPG Daily Activity Report — ${date}`,
      html: `<html><body>
        <h2>Test Email</h2>
        <p>This is a test of the daily email report system.</p>
        <p>If you received this, Resend is configured correctly.</p>
        <p style="color:#6b7280;font-size:12px;">Sent at ${new Date().toISOString()}</p>
      </body></html>`,
    });

    return c.json({ ok: true, status: result.status, id: result.id });
  } catch (err) {
    log.error('GET /admin/daily-email/test-send failed', {
      src: 'routes/dailyEmailAdmin.ts',
    }, err instanceof Error ? err.message : String(err));
    return c.json({ ok: false, error: 'Send failed' }, 500);
  }
});

// POST /test-send — send a test email
// Query params: ?date=YYYY-MM-DD (send real report for that date)
//               ?to=email (override recipient)
dailyEmailAdmin.post('/test-send', requireAdmin, async (c) => {
  const resendApiKey = c.env.RESEND_API_KEY;
  if (!resendApiKey) {
    return c.json({ ok: false, error: 'RESEND_API_KEY not configured' }, 503);
  }

  try {
    const db = getDb(c.env);
    const config = await getConfig(db);
    const date = c.req.query('date') ?? new Date().toISOString().slice(0, 10);
    const toOverride = c.req.query('to');
    const recipients = toOverride ? [toOverride] : config.recipients;

    if (recipients.length === 0) {
      return c.json({ ok: false, error: 'No recipients configured' }, 400);
    }

    // If date is provided, send the actual daily report
    if (c.req.query('date')) {
      const { sendDailyEmails } = await import('../utils/dailyEmail/sendDailyEmails');
      // Temporarily override recipients for this send
      if (toOverride) {
        const { setRecipients } = await import('../utils/dailyEmail/config');
        await setRecipients(db, [toOverride]);
      }
      const result = await sendDailyEmails(db, resendApiKey, date);
      // Restore original recipients if we overrode
      if (toOverride && config.recipients.length > 0) {
        const { setRecipients } = await import('../utils/dailyEmail/config');
        await setRecipients(db, config.recipients);
      }
      return c.json({ ok: !result.skipped, ...result });
    }

    // Otherwise send a simple test email
    const result = await sendViaResend(resendApiKey, {
      from: 'RMPG Flex <noreply@rmpgutah.us>',
      to: recipients[0],
      subject: `[TEST] RMPG Daily Activity Report — ${date}`,
      html: `<html><body>
        <h2>Test Email</h2>
        <p>This is a test of the daily email report system.</p>
        <p>If you received this, Resend is configured correctly.</p>
        <p style="color:#6b7280;font-size:12px;">Sent at ${new Date().toISOString()}</p>
      </body></html>`,
    });

    if (result.status === 'sent') {
      return c.json({ ok: true, message: `Test email sent to ${recipients[0]}` });
    } else {
      return c.json({ ok: false, error: result.error ?? 'Send failed' }, 500);
    }
  } catch (err) {
    log.error('POST /admin/daily-email/test-send failed', {
      src: 'routes/dailyEmailAdmin.ts',
    }, err instanceof Error ? err.message : String(err));
    return c.json({ error: 'Failed to send test email' }, 500);
  }
});

export default dailyEmailAdmin;

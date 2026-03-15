#!/usr/bin/env npx tsx
// One-off script to send update notification email after deployment.
// Usage: cd server && npx tsx ../scripts/send-update-email.ts
//
// Requires the server's database and email configuration to be available
// (run from the production VPS after deploy).

import { sendEmail } from '../server/src/utils/emailSender';

const RECIPIENT = 'chzamo@rmpgutah.us';
const SUBJECT = '[RMPG Flex] Development Update — March 15, 2026';

const HTML_BODY = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0; padding:0; background:#0d1520; font-family:Segoe UI,Arial,sans-serif;">
  <div style="max-width:640px; margin:0 auto; padding:24px;">
    <div style="background:#141e2b; border:1px solid #1e3048; border-radius:2px; padding:24px;">
      <div style="border-bottom:1px solid #1e3048; padding-bottom:16px; margin-bottom:16px;">
        <h1 style="margin:0; font-size:16px; color:#d4a017; font-weight:600;">RMPG Flex — Development Update</h1>
        <p style="margin:4px 0 0; color:#556677; font-size:12px;">March 15, 2026</p>
      </div>

      <p style="color:#a0b0c0; font-size:13px; line-height:1.6; margin:0 0 16px;">
        The following improvements have been applied to RMPG Flex:
      </p>

      <h2 style="margin:0 0 8px; font-size:14px; color:#4a9eff; font-weight:600;">1. Health Endpoint — Database Connectivity Check</h2>
      <p style="color:#8899aa; font-size:13px; line-height:1.5; margin:0 0 16px;">
        <strong style="color:#e2e8f0;">File:</strong> server/src/index.ts<br>
        The <code style="color:#d4a017;">/api/health</code> endpoint now verifies database connectivity
        by running a <code style="color:#d4a017;">SELECT 1</code> test query. If the database is unreachable,
        it returns HTTP 503 with status &quot;degraded&quot; instead of falsely reporting &quot;ok&quot;.
        Also now exposes server uptime and active WebSocket connection count.
      </p>

      <h2 style="margin:0 0 8px; font-size:14px; color:#4a9eff; font-weight:600;">2. Audit Log — Pagination Bounds &amp; Export Limits</h2>
      <p style="color:#8899aa; font-size:13px; line-height:1.5; margin:0 0 16px;">
        <strong style="color:#e2e8f0;">File:</strong> server/src/routes/audit.ts<br>
        Pagination is now clamped to 1–500 rows per page (prevents memory exhaustion via
        malicious <code style="color:#d4a017;">?limit=999999</code> requests). CSV export queries are
        capped at 50,000 rows maximum.
      </p>

      <h2 style="margin:0 0 8px; font-size:14px; color:#4a9eff; font-weight:600;">3. File Uploads — Audit Trail for Link Operations</h2>
      <p style="color:#8899aa; font-size:13px; line-height:1.5; margin:0 0 16px;">
        <strong style="color:#e2e8f0;">File:</strong> server/src/routes/uploads.ts<br>
        The <code style="color:#d4a017;">PUT /api/uploads/:fileId/link</code> route now writes to
        the activity log when a file is linked to an entity. Previously this operation
        had no audit trail, creating a compliance gap.
      </p>

      <h2 style="margin:0 0 8px; font-size:14px; color:#4a9eff; font-weight:600;">4. GPS Tracking — Audit Trail for Auto-Created Units</h2>
      <p style="color:#8899aa; font-size:13px; line-height:1.5; margin:0 0 16px;">
        <strong style="color:#e2e8f0;">File:</strong> server/src/routes/dispatch/gps.ts<br>
        When the GPS endpoint auto-creates a unit for a user, it now logs the event
        to the activity log. Admins can now see which units were auto-provisioned
        and by whom.
      </p>

      <div style="border-top:1px solid #1e3048; margin-top:24px; padding-top:16px;">
        <p style="margin:0; color:#556677; font-size:11px;">
          All changes verified: TypeScript compilation (0 errors), Vite build (success).<br>
          Branch: claude/eloquent-swartz | Commit: 8fe57f4<br>
          This is an automated notification from RMPG Flex CAD/RMS.
        </p>
      </div>
    </div>
  </div>
</body>
</html>`;

async function main() {
  console.log(`Sending update email to ${RECIPIENT}...`);
  const ok = await sendEmail({ to: RECIPIENT, subject: SUBJECT, html: HTML_BODY });
  if (ok) {
    console.log('Email sent successfully.');
  } else {
    console.error('Failed to send email. Check email configuration.');
    process.exit(1);
  }
}

main();

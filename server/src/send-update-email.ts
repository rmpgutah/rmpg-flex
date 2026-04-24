// One-off script to send update notification email.
// Usage: cd /opt/rmpg-flex/server && npx tsx src/send-update-email.ts

// Set timezone before anything else (matches index.ts)
process.env.TZ = process.env.SERVER_TIMEZONE || 'America/Denver';

import { initDatabase } from './models/database';
import { sendEmail } from './utils/emailSender';

// Initialize database so email config can be read from system_config table
initDatabase();

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

      <h2 style="margin:0 0 8px; font-size:14px; color:#4a9eff; font-weight:600;">1. IPED Forensics — Audit Trail Coverage</h2>
      <p style="color:#8899aa; font-size:13px; line-height:1.5; margin:0 0 16px;">
        <strong style="color:#e2e8f0;">File:</strong> server/src/routes/iped.ts<br>
        All IPED configuration changes (save, clear), job creation, job cancellation,
        hash set imports, and hash set removals now write to the audit/activity log.
        Previously these sensitive forensic operations had no audit trail, creating
        a compliance gap for digital evidence handling.
      </p>

      <h2 style="margin:0 0 8px; font-size:14px; color:#4a9eff; font-weight:600;">2. Forensic Lab — Audit Trail Coverage</h2>
      <p style="color:#8899aa; font-size:13px; line-height:1.5; margin:0 0 16px;">
        <strong style="color:#e2e8f0;">Files:</strong> server/src/routes/forensics.ts, server/src/utils/auditLogger.ts<br>
        Forensic case creation, updates, and deletions now write to the activity log
        with details including the lab case number and status changes. New audit action
        types (<code style="color:#d4a017;">forensic_case_created</code>,
        <code style="color:#d4a017;">forensic_case_updated</code>,
        <code style="color:#d4a017;">forensic_case_deleted</code>) and entity type
        (<code style="color:#d4a017;">forensic_case</code>) were added to the audit
        logger type system.
      </p>

      <h2 style="margin:0 0 8px; font-size:14px; color:#4a9eff; font-weight:600;">3. NCIC Terminal — Input Length Validation</h2>
      <p style="color:#8899aa; font-size:13px; line-height:1.5; margin:0 0 16px;">
        <strong style="color:#e2e8f0;">File:</strong> client/src/components/NcicQueryPanel.tsx<br>
        NCIC query input is now limited to 200 characters. Queries exceeding this limit
        display an error message and play the error tone. Both the embedded and slide-out
        panel inputs enforce a <code style="color:#d4a017;">maxLength</code> of 210
        characters at the HTML level as an additional safeguard.
      </p>

      <h2 style="margin:0 0 8px; font-size:14px; color:#4a9eff; font-weight:600;">4. Dispatch Notes — Length Validation</h2>
      <p style="color:#8899aa; font-size:13px; line-height:1.5; margin:0 0 16px;">
        <strong style="color:#e2e8f0;">File:</strong> client/src/pages/dispatch/DispatchPage.tsx<br>
        Dispatch call notes are now validated before submission: minimum 2 characters,
        maximum 2,000 characters. Both the mobile input and desktop textarea enforce
        <code style="color:#d4a017;">maxLength=2000</code> at the HTML level. Users
        receive toast notifications if validation fails.
      </p>

      <div style="border-top:1px solid #1e3048; margin-top:24px; padding-top:16px;">
        <p style="margin:0; color:#556677; font-size:11px;">
          All changes verified: TypeScript compilation (0 errors), Vite build (success).<br>
          Branch: main<br>
          This is an automated notification from RMPG Flex CAD/RMS.
        </p>
      </div>
    </div>
  </div>
</body>
</html>`;

async function main() {
  console.log(`Sending update email to ${RECIPIENT}...`);
  // CLI script — send as admin (user 1)
  const result = await sendEmail(1, { to: RECIPIENT, subject: SUBJECT, html: HTML_BODY });
  if (result.ok) {
    console.log(`Email sent successfully via ${result.transport}.`);
  } else {
    console.error(`Failed to send email (${result.reason}): ${result.detail}`);
    process.exit(1);
  }
}

main();

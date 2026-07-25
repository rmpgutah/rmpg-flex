import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Regression guard for the 2026-07-24 audit finding: the admin security panel
// (/api/admin/health/detailed -> loginStats) reported successful24h: 0 and
// failed24h: 0 permanently, while 11 real logins sat in the last 24h.
//
// Cause: it counted `audit_log WHERE action = 'login_success'` / 'login_failed'.
// Logins are actually recorded in `login_attempts` (username / ip_address /
// success / failure_reason / created_at). Nothing anywhere writes those two
// action strings — they existed ONLY in the queries looking for them, so the
// counters could never be anything but zero.
//
// Verified on live D1: the audit_log form returned 0 and the login_attempts
// form returned 11 for the same 24h window.
//
// This is a source-level scan rather than a unit test because the defect is a
// wrong table name inside a SQL string — there is no seam to assert on, and a
// mock-DB test would happily confirm whichever table the code names.
const adminSrc = readFileSync(join(__dirname, '..', 'src', 'routes', 'admin.ts'), 'utf8');

describe('admin login stats read the table logins are actually written to', () => {
  it('never counts audit_log rows by a login action name', () => {
    // Match the QUERY shape, not the bare strings — the fix's own explanatory
    // comment quotes them, and asserting on raw text flagged that comment.
    const sqlUse = /audit_log\s+WHERE\s+action\s*=\s*'login_(?:success|failed)'/i;
    expect(adminSrc).not.toMatch(sqlUse);
  });

  it('counts successes and failures from login_attempts.success', () => {
    const attempts = adminSrc.match(/FROM login_attempts[^`]*/g) ?? [];
    expect(attempts.length).toBeGreaterThanOrEqual(2);
    const joined = attempts.join('\n');
    expect(joined).toContain('COALESCE(success,0) = 1');
    expect(joined).toContain('COALESCE(success,0) = 0');
  });

  it('scopes both counters to the last 24 hours', () => {
    const attempts = adminSrc.match(/FROM login_attempts[^`]*/g) ?? [];
    for (const q of attempts) {
      expect(q).toContain("datetime('now','-1 day')");
    }
  });
});

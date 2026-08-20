-- Account lockout: failed_login_count + locked_until on users.
-- D1 lacks `ADD COLUMN IF NOT EXISTS`, so the boot reconciler
-- ensureAccountLockoutColumns() in src/utils/db.ts self-heals if this
-- migration doesn't reach live D1 (see CLAUDE.md "Migrations routinely
-- fail to reach live D1 silently").
-- See docs/superpowers/specs/2026-07-18-account-lockout-login-hardening-design.md
ALTER TABLE users ADD COLUMN failed_login_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN locked_until TEXT;

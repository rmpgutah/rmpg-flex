-- ============================================================
-- 0164: SSO opt-in flag for Dial Connect login
-- ============================================================
-- Per-user flag, admin-set. SSO login is rejected for any account
-- where this isn't 1, even if the email otherwise matches a Dial
-- Connect account (see src/routes/ssoAuth.ts callback handler).
ALTER TABLE users ADD COLUMN sso_enabled INTEGER DEFAULT 0;

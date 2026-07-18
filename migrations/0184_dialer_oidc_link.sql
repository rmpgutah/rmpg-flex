-- Dialer OIDC SSO login: links a Flex user to their `sub` claim from the
-- dialer.rmpgutah.us OIDC identity provider. Nullable — most users still
-- log in with username/password; this column is only populated the first
-- time a user successfully completes the "Sign in with Dialer" flow.
-- D1 lacks `ADD COLUMN IF NOT EXISTS`, so the boot reconciler
-- ensureDialerOidcColumns() in src/utils/db.ts self-heals if this migration
-- doesn't reach live D1 (see CLAUDE.md "Migrations routinely fail to reach
-- live D1 silently").
ALTER TABLE users ADD COLUMN dialer_oidc_sub TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_dialer_oidc_sub
  ON users(dialer_oidc_sub) WHERE dialer_oidc_sub IS NOT NULL;

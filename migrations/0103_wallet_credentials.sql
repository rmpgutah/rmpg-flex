-- 0103: Officer Wallet ID — digital badge / ID pass
-- (spec docs/superpowers/specs/2026-06-12-officer-wallet-id-design.md).
-- ⚠️ Apply directly to live D1 (785de7ae) after merge — deploy-time migration
-- apply is continue-on-error. Idempotent DDL.
--
-- NOTE: table is wallet_credentials (NOT officer_credentials — that name is
-- already taken by an unrelated live table holding officer professional
-- certifications: credential_type/issuing_authority/expiry_date, 4+ rows. Do
-- NOT touch it). Applied to live D1 2026-06-12.
--
-- One credential per officer. The users table already holds the displayed badge
-- fields (full_name/badge_number/rank/department/avatar_url/profile_image/status);
-- this table owns only credential lifecycle. Effective validity is computed at
-- verify time = (status = 'active' AND the officer's live users.status = 'active'),
-- so deactivating an officer auto-invalidates the badge with no separate revoke.
CREATE TABLE IF NOT EXISTS wallet_credentials (
  wallet_id   TEXT PRIMARY KEY,                 -- opaque unguessable id (uuid v4)
  user_id     INTEGER NOT NULL UNIQUE,          -- one credential per officer (users.id)
  status      TEXT NOT NULL DEFAULT 'active',   -- 'active' | 'revoked'
  issued_at   TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at  TEXT,
  revoked_by  INTEGER                           -- admin/manager users.id who revoked
);

CREATE INDEX IF NOT EXISTS idx_wallet_credentials_user ON wallet_credentials(user_id);

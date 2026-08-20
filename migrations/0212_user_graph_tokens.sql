-- Phase 3 of the email system upgrade: per-user Microsoft Graph OAuth grants,
-- replacing the single shared admin-owned tenant token. Encrypted via the
-- existing src/utils/emailCrypto.ts AES-GCM helpers (same class of secret as
-- the Azure client secret already encrypted that way) — NOT the Phase 2
-- per-value envelope crypto, which targets bulk cached message content.
CREATE TABLE IF NOT EXISTS user_graph_tokens (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  access_token_enc TEXT NOT NULL,
  refresh_token_enc TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  mailbox TEXT,
  connected_at TEXT NOT NULL DEFAULT (datetime('now'))
);

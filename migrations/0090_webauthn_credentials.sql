-- 0090 — webauthn_credentials (security keys: YubiKey / Touch ID / Windows
-- Hello). Schema mirrors the legacy VPS table consumed by
-- legacy/server-vps/src/routes/webauthn.ts, now served by the rewrite's
-- /api/auth/webauthn/* handlers (src/routes/auth.ts).
-- Also created directly on live D1 785de7ae on 2026-06-10.
CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  credential_id TEXT NOT NULL UNIQUE,   -- Base64URL credential id from the authenticator
  public_key TEXT NOT NULL,             -- Base64URL COSE public key
  counter INTEGER NOT NULL DEFAULT 0,   -- signature counter (clone detection)
  device_type TEXT,                     -- singleDevice | multiDevice
  backed_up INTEGER NOT NULL DEFAULT 0,
  transports TEXT,                      -- JSON array, e.g. ["usb","nfc"]
  name TEXT NOT NULL DEFAULT 'Security Key',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  last_used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_user ON webauthn_credentials(user_id);

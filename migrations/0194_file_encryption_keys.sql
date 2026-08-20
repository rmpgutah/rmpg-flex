-- 0194 — file_encryption_keys: envelope-encryption wrapped keys for R2 objects
-- protected by src/utils/encryptedR2.ts. Each row holds one file's AES-GCM-wrapped
-- Data Encryption Key (DEK), wrapped by the FILE_ENCRYPTION_KEK Worker secret.
-- Deleting a row ("crypto-shredding") permanently destroys that file's decryptability
-- without needing to guarantee the underlying R2 bytes are gone.
-- See docs/superpowers/specs/2026-07-18-file-encryption-at-rest-design.md.
CREATE TABLE IF NOT EXISTS file_encryption_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  r2_key TEXT NOT NULL UNIQUE,
  wrapped_dek TEXT NOT NULL,       -- base64 AES-GCM ciphertext of the DEK
  dek_iv TEXT NOT NULL,            -- base64, IV used to wrap the DEK
  file_iv TEXT NOT NULL,           -- base64, IV used to encrypt the file content itself
  algorithm_version TEXT NOT NULL, -- literal 'file-enc-v1' today
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

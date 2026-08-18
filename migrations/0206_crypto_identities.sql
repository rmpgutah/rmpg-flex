-- 0206 — crypto_identities: long-term org post-quantum crypto identities.
-- One row per logical identity. Secret halves are AES-256-GCM-wrapped by
-- RMPG_PQ_MASTER_KEY (stored as enc-v2:iv:ct strings) so leaking a D1 row
-- alone is not enough to recover the secret. Managed by src/utils/crypto/keystore.ts.
--
-- Identities:
--   'org-encryption' (kind='encryption') — hybrid KEM (X25519 + ML-KEM-768)
--       public_key = base64(PQ_KEM_PUB_LEN bytes); wrapped_secret = wrapped PQ_KEM_SEC_LEN bytes
--   'org-signing'  (kind='signing')      — Ed25519 + ML-DSA-65
--       public_key = base64(Ed25519 pub || ML-DSA-65 pub); wrapped_secret = wrapped (Ed25519 sec || ML-DSA-65 sec)
CREATE TABLE IF NOT EXISTS crypto_identities (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('encryption', 'signing')),
  public_key TEXT NOT NULL,        -- base64 (public material, stored in the clear)
  wrapped_secret TEXT NOT NULL,    -- enc-v2:iv:ct (secret material, AES-GCM-wrapped by RMPG_PQ_MASTER_KEY)
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_crypto_identities_kind ON crypto_identities (kind);
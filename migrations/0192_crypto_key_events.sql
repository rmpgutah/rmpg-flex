-- 0192 — crypto_key_events: automatic audit trail of when the PDF/evidence
-- signing key set (Ed25519 + ML-DSA-87 + SLH-DSA-256f, algorithm_version
-- 'pdf-sig-v2') changes. Populated by src/utils/pdfSign.ts's
-- getSigningKeys() the first time it derives a given key_id — INSERT OR
-- IGNORE makes this safe under concurrent isolate cold-starts racing to
-- log the same new key after a real secret rotation.
--
-- No operator-identity or QRNG-used columns: nothing observing this event
-- automatically can populate them. See
-- docs/superpowers/specs/2026-07-18-crypto-agility-audit-trail-design.md.
CREATE TABLE IF NOT EXISTS crypto_key_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key_id TEXT NOT NULL UNIQUE,
  algorithm_version TEXT NOT NULL,
  algorithms TEXT NOT NULL,        -- JSON array, e.g. ["Ed25519","ML-DSA-87","SLH-DSA-256f"]
  first_observed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_crypto_key_events_first_observed ON crypto_key_events(first_observed_at);

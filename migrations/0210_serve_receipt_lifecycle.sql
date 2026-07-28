-- ============================================================
-- 0210_serve_receipt_lifecycle.sql
--
-- Housekeeping on serve_receipts, from the same audit as 0209.
--
-- Idempotent DDL (D1 prod schema is dirty — see migrations/README.md).
-- ============================================================

-- ── Missing index on a column two handlers join through ──────
-- /email and /delivery both resolve a receipt by pairing its id with the
-- token that produced it, which means a scan of serve_receipts on every
-- call. Small today; this table grows one row per service, forever.
CREATE INDEX IF NOT EXISTS idx_serve_receipts_token
  ON serve_receipts(token_id);

-- ── An email that will never be delivered should say so ─────
-- email_status starts 'pending' and is resolved by a follow-up call from
-- the signing page. If that page closes first — the subject walks away,
-- the tab dies — nothing ever resolves it and the record claims a
-- delivery is in flight indefinitely. A sweeper ages them out, and this
-- index is what keeps that sweep from scanning the table.
CREATE INDEX IF NOT EXISTS idx_serve_receipts_email_pending
  ON serve_receipts(email_status, created_at)
  WHERE email_status = 'pending';

-- ── Normalise the completion channel ────────────────────────
-- The documented set is mobile | paper. The refusal path introduced
-- 'officer' without documenting it, so an undocumented third value was
-- already reaching production. 'refusal' names what actually happened —
-- the channel records HOW the record was made, and "an officer attested
-- to a refusal" is a different thing from "an officer typed it in".
--
-- Verified against live D1 before writing this: every existing row is
-- 'mobile', so this updates nothing today and exists to stop the value
-- landing from here on.
UPDATE serve_receipts SET completion_channel = 'refusal'
 WHERE completion_channel = 'officer';

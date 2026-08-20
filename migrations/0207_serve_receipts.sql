-- ============================================================
-- 0207_serve_receipts.sql
-- Recipient-signed Receipt of Service + Court Document Release
-- (substitute service) acknowledgment.
--
-- WHY A NEW TABLE (not serve_attempts.signature_data):
--   serve_attempts holds exactly ONE signature column and models the
--   OFFICER's attempt. Substitute service (Utah R. Civ. P. 4(d)(1)(B))
--   is signed by a DIFFERENT person than the named party, and the
--   legally operative fact is that person's agreement to deliver the
--   documents onward. That is a second party with its own identity,
--   competency attestation, and undertaking — none of which the single
--   signature column can express.
--
-- Two tables:
--   serve_receipt_tokens — single-use QR credential printed on the CFS
--                          report / run sheet before shift initiation.
--   serve_receipts       — the signed acknowledgment itself.
--
-- Idempotent DDL (D1 prod schema is dirty — see migrations/README.md).
-- ============================================================

-- ── Token: the QR credential ────────────────────────────────
-- Distinct from pso_qr_tokens (officer-facing, 5 scans, per CALL).
-- This one is recipient-facing, per SERVE JOB, and is BURNED on the
-- first successful signature so a receipt cannot be re-signed.
CREATE TABLE IF NOT EXISTS serve_receipt_tokens (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  serve_queue_id    INTEGER NOT NULL,
  token             TEXT NOT NULL UNIQUE,
  created_by        INTEGER,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  -- Absolute expiry. Printed sheets outlive their usefulness; a token
  -- found in a trash can 6 months later must not open a signable form.
  expires_at        TEXT,
  scans_used        INTEGER NOT NULL DEFAULT 0,
  max_scans         INTEGER NOT NULL DEFAULT 10,
  revoked_at        TEXT,
  -- Set once a receipt is signed against this token. Non-NULL == burned.
  used_receipt_id   INTEGER,
  used_at           TEXT,

  -- ── Officer MDT prefill ───────────────────────────────────
  -- What the process server recorded at the door BEFORE handing over
  -- the phone or the paper: who answered, whether it is a dwelling or a
  -- business, what was actually handed over.
  --
  -- Lives on the TOKEN, not on serve_queue, because it describes this
  -- one doorstep encounter. The same job can be attempted three times
  -- at three addresses with three different people answering.
  --
  -- It PRE-SELECTS the form variation and pre-fills the subject's form.
  -- It does not decide it: the attestations are the signer's own
  -- statements, so the signer's answers stay authoritative and any
  -- disagreement is recorded rather than overwritten
  -- (see serve_receipts.variant_conflict).
  prefill_json      TEXT,
  prefill_variant   TEXT,
  prefill_by        INTEGER,
  prefill_at        TEXT,
  FOREIGN KEY (serve_queue_id) REFERENCES serve_queue(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_serve_receipt_tokens_queue
  ON serve_receipt_tokens(serve_queue_id);
CREATE INDEX IF NOT EXISTS idx_serve_receipt_tokens_token
  ON serve_receipt_tokens(token);

-- ── The signed acknowledgment ───────────────────────────────
CREATE TABLE IF NOT EXISTS serve_receipts (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at                TEXT NOT NULL DEFAULT (datetime('now')),
  serve_queue_id            INTEGER NOT NULL,
  serve_attempt_id          INTEGER,
  token_id                  INTEGER,

  -- personal | substitute | posting | refused
  service_method            TEXT NOT NULL DEFAULT 'personal',

  -- ── Form variant ──────────────────────────────────────────
  -- individual | co_habitant | business | substitute
  --
  -- DERIVED, never free-typed: resolved from (who is signing, premises
  -- type, authority claimed) by resolveReceiptVariant(). Stored because
  -- the derivation rules will change and a receipt must always report
  -- the variant it was ACTUALLY issued under, not what today's rules
  -- would re-derive from the same inputs.
  form_variant              TEXT NOT NULL DEFAULT 'individual',
  -- Human-readable title as printed, e.g.
  -- "Acknowledgement of Service Form (Co-Habitant)".
  form_title                TEXT,
  -- The variation the OFFICER selected on the MDT before handing over
  -- the form, when they recorded a prefill. Kept alongside the derived
  -- one so a supervisor can see the officer's read of the doorstep.
  officer_variant           TEXT,
  -- 1 when the signer's own answers derived a different variation than
  -- the officer expected. Not an error — the officer is guessing from
  -- the doorstep and the signer knows the truth — but it is exactly the
  -- signal worth reviewing before an affidavit is filed.
  variant_conflict          INTEGER NOT NULL DEFAULT 0,
  -- How the instrument was completed: 'mobile' (QR) or 'paper'
  -- (transcribed by the officer from a hand-completed form).
  completion_channel        TEXT NOT NULL DEFAULT 'mobile',
  -- JSON array of { id, text, accepted } — the exact attestation
  -- sentences shown to this signer, captured VERBATIM. The wording is
  -- what they agreed to; re-rendering it later from current code would
  -- silently rewrite history if the copy is ever edited.
  attestations_json         TEXT,

  -- ── Who signed ────────────────────────────────────────────
  recipient_name            TEXT NOT NULL,
  -- defendant | co_resident | co_worker | registered_agent | other
  recipient_role            TEXT,
  recipient_relationship    TEXT,
  recipient_phone           TEXT,
  recipient_email           TEXT,
  -- Physical description, per affidavit convention (sex/race/age/ht/wt/hair).
  recipient_description     TEXT,
  -- Business variant: the entity served and the signer's role in it.
  business_name             TEXT,
  recipient_job_title       TEXT,
  recipient_id_type         TEXT,
  recipient_id_verified     INTEGER NOT NULL DEFAULT 0,
  -- Signer asserts they are 18+ / of suitable age and discretion.
  recipient_age_confirmed   INTEGER NOT NULL DEFAULT 0,

  -- ── Where ─────────────────────────────────────────────────
  service_address           TEXT,
  service_city              TEXT,
  service_state             TEXT,
  service_zip               TEXT,
  -- residence | business | other
  premises_type             TEXT,

  -- ── What was handed over ──────────────────────────────────
  -- JSON array of { title, copies } — the document inventory the
  -- recipient is acknowledging. Itemized, not a free-text blob, so the
  -- receipt PDF and any later dispute reference the same list.
  documents_json            TEXT,
  document_count            INTEGER NOT NULL DEFAULT 0,

  -- ── Substitute service: COURT DOCUMENT RELEASE ────────────
  -- Only meaningful when service_method = 'substitute'.
  sub_defendant_name        TEXT,
  -- Signer resides at / is employed at the address of service.
  sub_resides_at_address    INTEGER NOT NULL DEFAULT 0,
  sub_is_authorized_agent   INTEGER NOT NULL DEFAULT 0,
  -- The operative undertaking: agrees to deliver to the named party.
  sub_agrees_to_deliver     INTEGER NOT NULL DEFAULT 0,
  sub_expected_delivery_at  TEXT,
  sub_defendant_expected_at TEXT,
  -- Acknowledges the release language (failure to deliver may prejudice
  -- the named party's rights; documents are court process).
  sub_release_acknowledged  INTEGER NOT NULL DEFAULT 0,
  sub_declined_reason       TEXT,

  -- ── Attestations ──────────────────────────────────────────
  ack_received_documents    INTEGER NOT NULL DEFAULT 0,
  ack_notice_read           INTEGER NOT NULL DEFAULT 0,
  ack_information_true      INTEGER NOT NULL DEFAULT 0,

  -- ── Signatures (base64 PNG data URLs, as serve_attempts) ──
  recipient_signature       TEXT,
  recipient_signed_at       TEXT,
  server_signature          TEXT,
  server_name               TEXT,
  server_badge              TEXT,
  server_user_id            INTEGER,
  witness_name              TEXT,
  witness_signature         TEXT,

  -- ── Provenance ────────────────────────────────────────────
  latitude                  REAL,
  longitude                 REAL,
  accuracy_m                REAL,
  user_agent                TEXT,
  -- Hashed, never raw — this is a member of the public, not a user.
  ip_hash                   TEXT,

  -- ── Delivery of the recipient's copy ──────────────────────
  pdf_r2_key                TEXT,
  email_to                  TEXT,
  -- not_requested | pending | sent | failed | not_configured
  email_status              TEXT NOT NULL DEFAULT 'not_requested',
  email_sent_at             TEXT,
  email_error               TEXT,

  -- signed | voided
  status                    TEXT NOT NULL DEFAULT 'signed',
  voided_at                 TEXT,
  voided_by                 INTEGER,
  void_reason               TEXT,
  notes                     TEXT,

  FOREIGN KEY (serve_queue_id) REFERENCES serve_queue(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_serve_receipts_queue
  ON serve_receipts(serve_queue_id);
CREATE INDEX IF NOT EXISTS idx_serve_receipts_created
  ON serve_receipts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_serve_receipts_method
  ON serve_receipts(service_method);

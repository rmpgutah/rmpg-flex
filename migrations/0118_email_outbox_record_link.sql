-- Link outbound sends to their originating record (case / incident / warrant /
-- evidence) so "Email PDF from context" sends can be surfaced on that record.
-- D1 cannot IF NOT EXISTS an ADD COLUMN; src/routes/email.ts reconciles these at
-- runtime via columnExists() (ensureOutboxRecordColumns), and they must also be
-- applied directly to live D1 785de7ae after merge (deploy migration step is
-- continue-on-error). email_outbox is far below the 100-column cap.
ALTER TABLE email_outbox ADD COLUMN record_type TEXT;
ALTER TABLE email_outbox ADD COLUMN record_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_email_outbox_record
  ON email_outbox(record_type, record_id);

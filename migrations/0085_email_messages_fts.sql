-- FTS5 full-text index over the cached email_messages table.
-- Standalone (not content-linked) because email_messages.graph_id is
-- a TEXT primary key, not a rowid — content-rowid linkage would force
-- an integer surrogate key on the messages table.
--
-- The sync helper writes both tables in lockstep on UPSERT, and clears
-- the FTS row when a message is soft-deleted.

CREATE VIRTUAL TABLE IF NOT EXISTS email_messages_fts USING fts5(
  graph_id UNINDEXED,
  subject,
  from_address,
  from_name,
  body_preview,
  body_html,
  tokenize = 'porter unicode61 remove_diacritics 1'
);

-- Allow units to hold a queue of pending call assignments.
-- queued_call_ids: JSON array of call IDs waiting behind current_call_id.
-- When current_call_id clears the first queued call is auto-promoted.
ALTER TABLE units ADD COLUMN queued_call_ids TEXT NOT NULL DEFAULT '[]';

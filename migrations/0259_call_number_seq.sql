-- Atomic call-number sequence table (C2 fix).
-- Replaces the racy MAX(call_number)+1 pattern in calls.ts with an INSERT
-- whose AUTOINCREMENT id is guaranteed unique per row, even under concurrent
-- inserts from multiple Worker instances.
CREATE TABLE IF NOT EXISTS call_number_seq (
  id INTEGER PRIMARY KEY AUTOINCREMENT
);

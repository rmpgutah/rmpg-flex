-- Add against_user_id to hr_grievances so the "Against (Optional)" field in
-- GrievanceModal is persisted. The column was referenced in the UI from the
-- start but never created in the table.
ALTER TABLE hr_grievances ADD COLUMN against_user_id INTEGER REFERENCES users(id);

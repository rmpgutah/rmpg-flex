-- 0218_hr_benefits_align.sql
-- Follow-up to 0217. hr_benefits ALREADY EXISTED on live D1 — so 0217's
-- `CREATE TABLE IF NOT EXISTS` silently no-opped and live kept its original
-- shape, which lacks the two columns 0217 declared. That is the documented
-- IF-NOT-EXISTS trap: a CREATE that no-ops tells you nothing, and the mismatch
-- only surfaced when a real INSERT hit "table hr_benefits has no column named
-- notes". 0217 is already tracked in d1_migrations, and an applied migration
-- must never be edited, so the alignment lands here instead.
--
-- Also worth recording: the route comment claiming the Benefits handler was
-- "deferred until the hr_benefits table exists" was STALE. The table was there
-- the whole time; only the handlers were missing.
ALTER TABLE hr_benefits ADD COLUMN notes TEXT;
ALTER TABLE hr_benefits ADD COLUMN created_by INTEGER;

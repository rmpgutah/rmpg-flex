-- 0148: NSOPW photo storage + consolidation seeds.
-- ----------------------------------------------------
-- Persist the offender photograph as a faithful local copy in R2
-- (bucket = rmpg-flex-uploads, prefix = nsopw-photos/). NSOPW's
-- imageUri deep-links the source state's image host (FDLE / iCrimeWatch
-- / Megan's Law / etc.), which rotates on schedule changes. Once we've
-- matched the subject and persisted the record, we ALSO download and
-- store the photo so the RMPG-side record stays whole if upstream
-- 404s, blocks, or rotates the URL.
--
-- Columns added to national_sex_offenders:
--   local_photo_key    — R2 object key under UPLOADS bucket, e.g.
--                        nsopw-photos/UT/{nsopwOffenderId}-{hash}.jpg
--   local_photo_url    — Worker-served URL (/api/nsopw/photo/:id) when
--                        the photo has been downloaded successfully.
--   photo_fetched_at   — Last successful download timestamp.
--   photo_size_bytes   — Object size; lets the UI show "no thumb"
--                        gracefully when 0.
--   photo_content_type — MIME type from the upstream response.
--
-- D1 has no IF NOT EXISTS on ADD COLUMN; the Worker self-heals these
-- via ensureNsopwColumns() at runtime. Deploy step is continue-on-error.
--
-- 🔴 APPLY TO LIVE 785de7ae after merge.

ALTER TABLE national_sex_offenders ADD COLUMN local_photo_key TEXT;
ALTER TABLE national_sex_offenders ADD COLUMN local_photo_url TEXT;
ALTER TABLE national_sex_offenders ADD COLUMN photo_fetched_at TEXT;
ALTER TABLE national_sex_offenders ADD COLUMN photo_size_bytes INTEGER;
ALTER TABLE national_sex_offenders ADD COLUMN photo_content_type TEXT;

CREATE INDEX IF NOT EXISTS idx_nsopw_photo_fetched
  ON national_sex_offenders(photo_fetched_at);

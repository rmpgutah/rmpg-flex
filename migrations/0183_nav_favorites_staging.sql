-- Adds an is_staging flag to nav_favorites so officers can tag certain
-- saved destinations as parking/staging locations. D1 has no
-- ADD COLUMN IF NOT EXISTS, so this file documents the intended DDL;
-- the Worker self-heals via ensureNavFavoritesColumns() in src/utils/db.ts
-- (gated by columnExists()), mirroring the assessor-columns pattern.
ALTER TABLE nav_favorites ADD COLUMN is_staging INTEGER DEFAULT 0;

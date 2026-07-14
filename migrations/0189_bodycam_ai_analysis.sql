-- 0189_bodycam_ai_analysis.sql — AI object-detection/identification results
-- for bodycam_videos (weapon/vehicle/scene/force-indicator findings from
-- on-demand frame analysis). Idempotent; the route also reconciles this
-- column at runtime via columnExists() because deploy migration-apply is
-- continue-on-error. APPLY DIRECTLY TO LIVE D1 785de7ae AFTER MERGE
-- (scripts/apply-migration.sh).

ALTER TABLE bodycam_videos ADD COLUMN ai_analysis_json TEXT;

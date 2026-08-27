-- Normalize urgency_tier enum values to match the backend's applyUrgencyTier()
-- output ('standard' | 'tight' | 'critical'). Legacy values 'normal' and 'high'
-- were written by the old frontend enum and no longer match any <option> value,
-- so they silently show as "Auto" in the dropdown.
UPDATE serve_queue SET urgency_tier = 'standard' WHERE urgency_tier = 'normal';
UPDATE serve_queue SET urgency_tier = 'tight'    WHERE urgency_tier = 'high';

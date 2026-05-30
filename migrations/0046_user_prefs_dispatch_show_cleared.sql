-- 0046: add dispatch_show_cleared to user_preferences.
--
-- The client (UserPreferencesContext) reads/writes dispatch_show_cleared to
-- control whether cleared calls show in the dispatch "All" tab, but the column
-- was never added to the typed user_preferences table (the endpoint was a stub
-- until now). D1 does not support IF NOT EXISTS on ADD COLUMN; on re-apply this
-- statement fails harmlessly (deploy.yml runs migrations with continue-on-error,
-- and the Worker tolerates the existing column).
ALTER TABLE user_preferences ADD COLUMN dispatch_show_cleared INTEGER DEFAULT 0;

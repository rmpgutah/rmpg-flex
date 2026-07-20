-- migrations/0196_browser_bookmarks_history.sql
ALTER TABLE user_preferences ADD COLUMN browser_bookmarks_json TEXT;
ALTER TABLE user_preferences ADD COLUMN browser_history_json TEXT;

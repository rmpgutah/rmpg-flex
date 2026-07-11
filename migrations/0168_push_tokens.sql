-- Device push tokens for the RMPG Flex Connect iOS app.
-- The app's PushManager already computes an APNs device token on launch
-- but had nowhere to send it — no route or table existed anywhere on this
-- Worker to persist it, so registering for push has never actually reached
-- the server. This is registration/storage only; actually SENDING a push
-- via APNs requires an Apple Push Notification Auth Key (.p8) + Team ID +
-- Key ID provisioned as Worker secrets, which is a separate, later step.
CREATE TABLE IF NOT EXISTS push_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_token TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL DEFAULT 'ios',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_push_tokens_user_id ON push_tokens(user_id);

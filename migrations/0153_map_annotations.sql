CREATE TABLE IF NOT EXISTS map_annotations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT    NOT NULL,
  body        TEXT,
  color       TEXT    DEFAULT '#d4a017',
  icon        TEXT    DEFAULT 'pin',
  lat         REAL    NOT NULL,
  lng         REAL    NOT NULL,
  created_by  INTEGER REFERENCES users(id),
  call_id     INTEGER,
  expires_at  TEXT,
  is_active   INTEGER DEFAULT 1,
  created_at  TEXT    DEFAULT (datetime('now')),
  updated_at  TEXT    DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_map_annotations_active ON map_annotations(is_active);

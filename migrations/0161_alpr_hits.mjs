// ============================================================
// ALPR Leaks — D1 Migration
// ============================================================
// Creates the alpr_hits table for collecting license plate data
// from Motorola ALPR feeds.

export async function up(db: any) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS alpr_hits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT NOT NULL UNIQUE,
      system_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      make TEXT,
      model TEXT,
      color TEXT,
      license_plate TEXT NOT NULL,
      jpeg_data BLOB,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_alpr_hits_system_id ON alpr_hits(system_id);
    CREATE INDEX IF NOT EXISTS idx_alpr_hits_license_plate ON alpr_hits(license_plate);
    CREATE INDEX IF NOT EXISTS idx_alpr_hits_timestamp ON alpr_hits(timestamp DESC);
  `);
}

export async function down(db: any) {
  await db.exec(`
    DROP TABLE IF EXISTS alpr_hits;
  `);
}

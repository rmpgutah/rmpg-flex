// Shared by every test-workers/*.test.ts that exercises a route wired to
// src/utils/encryptedR2.ts. The Miniflare D1 pool starts empty (no
// migrations/*.sql applied) — ensureFileEncryptionKeysTable mirrors
// migrations/0194_file_encryption_keys.sql so putEncrypted/getDecrypted have
// somewhere to read/write wrapped keys, matching the pattern established in
// test-workers/fieldPhotosEncryption.test.ts (Phase 1).
import type { D1Database } from '@cloudflare/workers-types';

export const TEST_KEK = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i)));

export function envWithKek(env: Record<string, unknown>): Record<string, unknown> {
  return { ...env, FILE_ENCRYPTION_KEK: TEST_KEK };
}

export async function ensureFileEncryptionKeysTable(db: D1Database): Promise<void> {
  await db.prepare(`CREATE TABLE IF NOT EXISTS file_encryption_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    r2_key TEXT NOT NULL UNIQUE,
    wrapped_dek TEXT NOT NULL,
    dek_iv TEXT NOT NULL,
    file_iv TEXT NOT NULL,
    algorithm_version TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`).run();
}

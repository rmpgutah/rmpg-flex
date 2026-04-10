// ============================================================
// Test Database Helper
// Creates an isolated SQLite DB for integration tests. Each test
// file gets its own DB at /tmp/rmpg-test-<uuid>/rmpg-flex.db so
// tests can run in parallel without touching production data.
// ============================================================

import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import bcryptjs from 'bcryptjs';
import type Database from 'better-sqlite3';

/** Create a unique temp directory and set RMPG_DATA_DIR to point at it. */
export function setupTestDataDir(): string {
  const dir = path.join(os.tmpdir(), `rmpg-test-${crypto.randomBytes(8).toString('hex')}`);
  fs.mkdirSync(dir, { recursive: true });
  process.env.RMPG_DATA_DIR = dir;
  // Also need uploads dir for upload routes
  process.env.RMPG_UPLOADS_DIR = path.join(dir, 'uploads');
  fs.mkdirSync(process.env.RMPG_UPLOADS_DIR, { recursive: true });
  return dir;
}

/** Remove the temp data dir after tests finish. */
export function teardownTestDataDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Ignore errors — temp dir will be cleaned by OS eventually
  }
}

/** Create a test admin user with a known password. Call after initDatabase(). */
export function createTestAdmin(db: Database.Database, password = 'TestPassword1!'): {
  username: string;
  password: string;
  userId: number;
} {
  const hash = bcryptjs.hashSync(password, 4); // lower rounds for test speed
  const now = new Date().toISOString();
  // Replace the seeded admin or insert if missing
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get('test_admin') as { id: number } | undefined;
  if (existing) {
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0, totp_exempt = 1 WHERE id = ?').run(hash, existing.id);
    return { username: 'test_admin', password, userId: existing.id };
  }
  const result = db.prepare(`
    INSERT INTO users (username, password_hash, full_name, email, role, badge_number, phone, status, must_change_password, password_changed_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 0, ?, ?, ?)
  `).run('test_admin', hash, 'Test Admin', 'test@example.com', 'admin', 'T001', '555-0100', now, now, now);
  const userId = result.lastInsertRowid as number;
  // Exempt from 2FA enforcement for tests
  db.prepare('UPDATE users SET totp_exempt = 1 WHERE id = ?').run(userId);
  return { username: 'test_admin', password, userId };
}

/** Create a test officer user. */
export function createTestOfficer(db: Database.Database, password = 'OfficerPass1!'): {
  username: string;
  password: string;
  userId: number;
} {
  const hash = bcryptjs.hashSync(password, 4);
  const now = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO users (username, password_hash, full_name, email, role, badge_number, phone, status, must_change_password, password_changed_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 0, ?, ?, ?)
  `).run('test_officer', hash, 'Test Officer', 'officer@example.com', 'officer', 'T002', '555-0101', now, now, now);
  return { username: 'test_officer', password, userId: result.lastInsertRowid as number };
}

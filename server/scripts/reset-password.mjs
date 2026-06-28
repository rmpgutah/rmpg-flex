#!/usr/bin/env node
// ============================================================
// RMPG Flex — Password Reset Script
// Usage: node scripts/reset-password.mjs <username> [newPassword]
// If no password is provided, a random one is generated.
// ============================================================

import Database from 'better-sqlite3';
import bcryptjs from 'bcryptjs';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.RMPG_DATA_DIR || path.resolve(__dirname, '../data');
const DB_PATH = path.join(DATA_DIR, 'rmpg-flex.db');

const username = process.argv[2];
if (!username) {
  console.error('Usage: node scripts/reset-password.mjs <username> [newPassword]');
  process.exit(1);
}

const newPassword = process.argv[3] || crypto.randomBytes(12).toString('hex');

const db = new Database(DB_PATH);
const user = db.prepare('SELECT id, username, status, role FROM users WHERE username = ?').get(username);

if (!user) {
  console.error(`\n  ✗ User "${username}" not found in database.\n`);
  // List available users to help
  const users = db.prepare('SELECT username, role, status FROM users ORDER BY username').all();
  if (users.length) {
    console.log('  Available users:');
    users.forEach(u => console.log(`    - ${u.username} (${u.role}, ${u.status})`));
  }
  db.close();
  process.exit(1);
}

const hash = bcryptjs.hashSync(newPassword, 10);
const now = new Date().toISOString();
db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = ? WHERE id = ?').run(hash, now, user.id);
db.close();

console.log('');
console.log('╔══════════════════════════════════════════════════╗');
console.log(`║  Password reset for: ${username.padEnd(28)}║`);
console.log(`║  New password: ${newPassword.padEnd(34)}║`);
console.log('║  User will be prompted to change on next login. ║');
console.log('╚══════════════════════════════════════════════════╝');
console.log('');

import { getDb } from '../models/database';
import { localNow } from './timeUtils';
import { encryptToken, decryptToken } from './msGraphClient';

export interface UserTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  mailbox: string;
  scopes: string;
}

export function setUserTokens(userId: number, t: UserTokens): void {
  const db = getDb();
  const enrolledAt = localNow();
  db.prepare(
    `INSERT INTO user_graph_tokens (user_id, access_token_enc, refresh_token_enc, token_expires_at, mailbox, scopes, enrolled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       access_token_enc=excluded.access_token_enc,
       refresh_token_enc=excluded.refresh_token_enc,
       token_expires_at=excluded.token_expires_at,
       mailbox=excluded.mailbox,
       scopes=excluded.scopes`
  ).run(
    userId,
    encryptToken(t.accessToken),
    t.refreshToken ? encryptToken(t.refreshToken) : null,
    t.expiresAt,
    t.mailbox,
    t.scopes,
    enrolledAt,
  );
}

export function getUserTokens(userId: number): UserTokens | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM user_graph_tokens WHERE user_id = ?').get(userId) as any;
  if (!row) return null;
  try {
    return {
      accessToken: decryptToken(row.access_token_enc),
      refreshToken: row.refresh_token_enc ? decryptToken(row.refresh_token_enc) : null,
      expiresAt: row.token_expires_at,
      mailbox: row.mailbox || '',
      scopes: row.scopes || '',
    };
  } catch {
    return null;  // tampered/key-rotated → treat as not enrolled
  }
}

export function deleteUserTokens(userId: number): void {
  getDb().prepare('DELETE FROM user_graph_tokens WHERE user_id = ?').run(userId);
}

export function isUserEnrolled(userId: number): boolean {
  return getUserTokens(userId) !== null;
}

export function listEnrolledUserIds(): number[] {
  const rows = getDb().prepare('SELECT user_id FROM user_graph_tokens ORDER BY user_id').all() as { user_id: number }[];
  return rows.map(r => r.user_id);
}

export function markUserSynced(userId: number): void {
  getDb().prepare('UPDATE user_graph_tokens SET last_sync_at = ? WHERE user_id = ?').run(localNow(), userId);
}

export function markUserNeedsReauth(userId: number): void {
  getDb().prepare('UPDATE user_graph_tokens SET token_expires_at = 0 WHERE user_id = ?').run(userId);
}

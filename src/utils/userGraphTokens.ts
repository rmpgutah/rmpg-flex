// Per-user Microsoft Graph OAuth token storage (Phase 3 of the email
// upgrade: personal per-officer mailboxes, replacing the single shared
// admin-owned tenant grant). Encryption reuses emailCrypto.ts's AES-GCM
// helpers — same class of secret as the already-encrypted Azure client
// secret, not the bulk-content envelope crypto from Phase 2.
import { encryptSecret, decryptSecret } from './emailCrypto';

type CryptoEnv = { EMAIL_CRED_KEY?: string; JWT_SECRET: string };

export interface UserGraphTokenInput {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  mailbox?: string | null;
}

export interface UserGraphToken {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  mailbox: string | null;
}

export async function saveUserGraphToken(
  db: D1Database,
  env: CryptoEnv,
  userId: number,
  tokens: UserGraphTokenInput,
): Promise<void> {
  const accessEnc = await encryptSecret(env, tokens.accessToken);
  const refreshEnc = await encryptSecret(env, tokens.refreshToken);
  await db.prepare(
    `INSERT INTO user_graph_tokens (user_id, access_token_enc, refresh_token_enc, expires_at, mailbox, connected_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       access_token_enc = excluded.access_token_enc,
       refresh_token_enc = excluded.refresh_token_enc,
       expires_at = excluded.expires_at,
       mailbox = COALESCE(excluded.mailbox, user_graph_tokens.mailbox)`,
  ).bind(userId, accessEnc, refreshEnc, String(tokens.expiresAt), tokens.mailbox ?? null).run();
}

export async function getUserGraphToken(
  db: D1Database,
  env: CryptoEnv,
  userId: number,
): Promise<UserGraphToken | null> {
  const row = await db.prepare(
    'SELECT access_token_enc, refresh_token_enc, expires_at, mailbox FROM user_graph_tokens WHERE user_id = ?',
  ).bind(userId).first<{ access_token_enc: string; refresh_token_enc: string; expires_at: string; mailbox: string | null }>();
  if (!row) return null;
  return {
    accessToken: await decryptSecret(env, row.access_token_enc),
    refreshToken: await decryptSecret(env, row.refresh_token_enc),
    expiresAt: parseInt(row.expires_at, 10),
    mailbox: row.mailbox,
  };
}

export async function deleteUserGraphToken(db: D1Database, userId: number): Promise<void> {
  await db.prepare('DELETE FROM user_graph_tokens WHERE user_id = ?').bind(userId).run();
}

export async function listConnectedUserIds(db: D1Database): Promise<number[]> {
  const result = await db.prepare('SELECT user_id FROM user_graph_tokens').bind().all<{ user_id: number }>();
  return (result.results || []).map((r) => r.user_id);
}

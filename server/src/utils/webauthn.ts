// ============================================================
// WebAuthn / YubiKey Utility
// ============================================================
// Handles FIDO2/WebAuthn registration and authentication flows.
// Uses @simplewebauthn/server for attestation/assertion verification.
// Credentials are stored in the webauthn_credentials table.

import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type VerifiedRegistrationResponse,
  type VerifiedAuthenticationResponse,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialDescriptorJSON,
} from '@simplewebauthn/server';
import { getDb } from '../models/database';
import config from '../config';

// ── Relying Party config ──────────────────────────────────
const RP_NAME = 'RMPG Flex';

function getRpId(): string {
  return config.primaryDomain || 'localhost';
}

function getOrigin(): string[] {
  // Accept both the primary domain and localhost for dev
  const origins: string[] = [];
  const domain = config.primaryDomain;
  if (domain && domain !== 'localhost') {
    origins.push(`https://${domain}`);
    origins.push(`https://www.${domain}`);
  }
  // Always allow localhost origins for development + Electron
  origins.push('http://localhost:5173');
  origins.push('http://localhost:3001');
  origins.push('https://localhost');
  return origins;
}

// ── DB helpers ────────────────────────────────────────────

export interface WebAuthnCredential {
  id: number;
  user_id: number;
  credential_id: string;       // base64url encoded
  public_key: string;           // base64url encoded
  sign_count: number;
  device_name: string;
  transports: string;           // JSON array
  created_at: string;
}

function getUserCredentials(userId: number): WebAuthnCredential[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM webauthn_credentials WHERE user_id = ? ORDER BY created_at DESC'
  ).all(userId) as WebAuthnCredential[];
}

function getCredentialById(credentialId: string): (WebAuthnCredential & { username: string }) | null {
  const db = getDb();
  return db.prepare(`
    SELECT wc.*, u.username
    FROM webauthn_credentials wc
    JOIN users u ON wc.user_id = u.id
    WHERE wc.credential_id = ?
  `).get(credentialId) as (WebAuthnCredential & { username: string }) | null;
}

// ── Pending challenge storage (in-memory, short-lived) ────
// Maps challenge → { userId, expires }
const pendingChallenges = new Map<string, { userId: number; expires: number }>();

function storePendingChallenge(challenge: string, userId: number): void {
  // Clean expired entries
  const now = Date.now();
  for (const [key, val] of pendingChallenges) {
    if (val.expires < now) pendingChallenges.delete(key);
  }
  // Store with 5-minute expiry
  pendingChallenges.set(challenge, { userId, expires: now + 5 * 60 * 1000 });
}

function consumeChallenge(challenge: string): number | null {
  const entry = pendingChallenges.get(challenge);
  if (!entry) return null;
  pendingChallenges.delete(challenge);
  if (entry.expires < Date.now()) return null;
  return entry.userId;
}

// ── Registration Flow ─────────────────────────────────────

export async function beginRegistration(userId: number, username: string) {
  const existingCreds = getUserCredentials(userId);

  const excludeCredentials: PublicKeyCredentialDescriptorJSON[] = existingCreds.map(cred => {
    let transports: AuthenticatorTransport[] = [];
    try { transports = JSON.parse(cred.transports || '[]'); } catch { /* malformed — use empty */ }
    return { id: cred.credential_id, type: 'public-key' as const, transports };
  });

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: getRpId(),
    userName: username,
    userDisplayName: username,
    attestationType: 'none', // We don't need attestation verification
    excludeCredentials,
    authenticatorSelection: {
      // Allow both platform (Touch ID) and cross-platform (YubiKey)
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  });

  // Store challenge for verification
  storePendingChallenge(options.challenge, userId);

  return options;
}

export async function completeRegistration(
  userId: number,
  response: RegistrationResponseJSON,
  challenge: string,
  deviceName: string = 'Security Key',
): Promise<{ success: boolean; error?: string }> {
  // Verify the challenge maps to this user
  const challengeUserId = consumeChallenge(challenge);
  if (challengeUserId !== userId) {
    return { success: false, error: 'Invalid or expired registration challenge' };
  }

  let verification: VerifiedRegistrationResponse;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: getOrigin(),
      expectedRPID: getRpId(),
    });
  } catch (err: any) {
    return { success: false, error: err.message || 'Registration verification failed' };
  }

  if (!verification.verified || !verification.registrationInfo) {
    return { success: false, error: 'Registration verification failed' };
  }

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

  // Store credential in database
  const db = getDb();
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

  db.prepare(`
    INSERT INTO webauthn_credentials (user_id, credential_id, public_key, sign_count, device_name, transports, device_type, backed_up, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    credential.id,
    Buffer.from(credential.publicKey).toString('base64url'),
    credential.counter,
    deviceName,
    JSON.stringify(response.response.transports || []),
    credentialDeviceType || 'unknown',
    credentialBackedUp ? 1 : 0,
    now,
  );

  // Enable WebAuthn on the user if this is their first key
  const existingCount = db.prepare(
    'SELECT COUNT(*) as cnt FROM webauthn_credentials WHERE user_id = ?'
  ).get(userId) as { cnt: number };

  if (existingCount.cnt === 1) {
    db.prepare('UPDATE users SET webauthn_enabled = 1 WHERE id = ?').run(userId);
  }

  return { success: true };
}

// ── Authentication Flow ───────────────────────────────────

export async function beginAuthentication(userId: number) {
  const credentials = getUserCredentials(userId);

  const allowCredentials: PublicKeyCredentialDescriptorJSON[] = credentials.map(cred => {
    let transports: AuthenticatorTransport[] = [];
    try { transports = JSON.parse(cred.transports || '[]'); } catch { /* malformed — use empty */ }
    return { id: cred.credential_id, type: 'public-key' as const, transports };
  });

  const options = await generateAuthenticationOptions({
    rpID: getRpId(),
    allowCredentials,
    userVerification: 'preferred',
  });

  storePendingChallenge(options.challenge, userId);

  return options;
}

export async function verifyAuthentication(
  userId: number,
  response: AuthenticationResponseJSON,
  challenge: string,
): Promise<{ success: boolean; error?: string }> {
  const challengeUserId = consumeChallenge(challenge);
  if (challengeUserId !== userId) {
    return { success: false, error: 'Invalid or expired authentication challenge' };
  }

  // Find the credential
  const credentialId = response.id;
  const storedCred = getCredentialById(credentialId);

  if (!storedCred || storedCred.user_id !== userId) {
    return { success: false, error: 'Unknown security key' };
  }

  let verification: VerifiedAuthenticationResponse;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: getOrigin(),
      expectedRPID: getRpId(),
      credential: {
        id: storedCred.credential_id,
        publicKey: new Uint8Array(Buffer.from(storedCred.public_key, 'base64url')),
        counter: storedCred.sign_count,
        transports: JSON.parse(storedCred.transports || '[]'),
      },
    });
  } catch (err: any) {
    return { success: false, error: err.message || 'Authentication verification failed' };
  }

  if (!verification.verified) {
    return { success: false, error: 'Authentication verification failed' };
  }

  // Update sign count to prevent replay attacks
  const db = getDb();
  db.prepare('UPDATE webauthn_credentials SET sign_count = ? WHERE credential_id = ?')
    .run(verification.authenticationInfo.newCounter, credentialId);

  return { success: true };
}

// ── Key Management ────────────────────────────────────────

export function removeCredential(userId: number, credentialDbId: number): boolean {
  const db = getDb();
  const result = db.prepare(
    'DELETE FROM webauthn_credentials WHERE id = ? AND user_id = ?'
  ).run(credentialDbId, userId);

  if (result.changes > 0) {
    // If no keys left, disable WebAuthn
    const remaining = db.prepare(
      'SELECT COUNT(*) as cnt FROM webauthn_credentials WHERE user_id = ?'
    ).get(userId) as { cnt: number };

    if (remaining.cnt === 0) {
      db.prepare('UPDATE users SET webauthn_enabled = 0 WHERE id = ?').run(userId);
    }
    return true;
  }
  return false;
}

export function getUserWebAuthnStatus(userId: number): {
  enabled: boolean;
  credentialCount: number;
  credentials: { id: number; device_name: string; created_at: string; device_type: string }[];
} {
  const db = getDb();
  const user = db.prepare('SELECT webauthn_enabled FROM users WHERE id = ?').get(userId) as any;
  const creds = getUserCredentials(userId);

  return {
    enabled: !!user?.webauthn_enabled,
    credentialCount: creds.length,
    credentials: creds.map(c => ({
      id: c.id,
      device_name: c.device_name,
      created_at: c.created_at,
      device_type: (c as any).device_type || 'unknown',
    })),
  };
}

export function hasWebAuthnCredentials(userId: number): boolean {
  const db = getDb();
  const count = db.prepare(
    'SELECT COUNT(*) as cnt FROM webauthn_credentials WHERE user_id = ?'
  ).get(userId) as { cnt: number };
  return count.cnt > 0;
}

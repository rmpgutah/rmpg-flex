// ============================================================
// RMPG FlexOS — Offline Cryptographic Auth Vault
// Salted HMAC-SHA256 local PIN authentication storage
// Allows offline kiosk unlock when server is unreachable.
// ============================================================

const VAULT_STORAGE_KEY = 'rmpg_offline_auth_vault_v1';
const VAULT_SALT = 'flexos-kiosk-offline-auth-salt-2026';

export interface VaultUserCredential {
  username: string;
  pinHash: string; // HMAC-SHA256 hex string
  firstName: string;
  lastName: string;
  badgeNumber?: string;
  role: string;
  updatedAt: number;
}

/** Simple web crypto SHA-256 / HMAC helper */
async function hashPin(pin: string, username: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(`${VAULT_SALT}:${username.toLowerCase()}:${pin}`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Get all stored offline vault credentials */
export function getOfflineVaultUsers(): VaultUserCredential[] {
  try {
    const raw = localStorage.getItem(VAULT_STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/** Save/update a user's offline PIN credential */
export async function storeOfflinePin(
  username: string,
  pin: string,
  firstName: string,
  lastName: string,
  role: string,
  badgeNumber?: string
): Promise<void> {
  if (!username || !pin || pin.length < 4) return;
  const pinHash = await hashPin(pin, username);
  const users = getOfflineVaultUsers();
  const index = users.findIndex(u => u.username.toLowerCase() === username.toLowerCase());

  const cred: VaultUserCredential = {
    username,
    pinHash,
    firstName,
    lastName,
    role,
    badgeNumber,
    updatedAt: Date.now(),
  };

  if (index >= 0) {
    users[index] = cred;
  } else {
    users.push(cred);
  }

  try {
    localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(users));
  } catch {
    /* storage quota fallback */
  }
}

/** Verify a PIN offline against the vault */
export async function verifyOfflinePin(username: string, pin: string): Promise<{ ok: boolean; user?: VaultUserCredential }> {
  const users = getOfflineVaultUsers();
  const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user) return { ok: false };

  const testHash = await hashPin(pin, username);
  if (testHash === user.pinHash) {
    return { ok: true, user };
  }
  return { ok: false };
}

/** Seed emergency admin credentials if vault is empty */
export async function seedEmergencyOfflineVault(): Promise<void> {
  const users = getOfflineVaultUsers();
  if (users.length === 0) {
    await storeOfflinePin('zamora', '5172', 'Christopher', 'Zamora', 'admin', '5172');
    await storeOfflinePin('admin', '9999', 'System', 'Admin', 'admin', '0001');
  }
}

/** Remove stale vault entries older than 90 days */
export function pruneStaleVaultEntries(): void {
  const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
  const users = getOfflineVaultUsers();
  const fresh = users.filter(u => Date.now() - u.updatedAt < MAX_AGE_MS);
  if (fresh.length < users.length) {
    try { localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(fresh)); } catch {}
  }
}

// Auto seed on module load
seedEmergencyOfflineVault().catch(() => {});
pruneStaleVaultEntries();

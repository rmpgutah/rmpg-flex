// walletValidity — the single source of truth for whether an officer's digital
// ID is currently honourable. Effective validity requires BOTH the credential to
// be active AND the officer's live employment status to be active, so deactivating
// an officer (users.status != 'active') auto-invalidates their badge with no
// separate revoke step. Pure — the route handler supplies the two live values.

export type WalletValidityReason = 'ok' | 'revoked' | 'inactive_officer';

export interface WalletValidity {
  valid: boolean;
  reason: WalletValidityReason;
}

export function walletValidity(credentialStatus: string, officerStatus: string): WalletValidity {
  // Explicit admin revocation wins over (and is more informative than) an
  // incidental inactive employment status.
  if (credentialStatus !== 'active') return { valid: false, reason: 'revoked' };
  if (officerStatus !== 'active') return { valid: false, reason: 'inactive_officer' };
  return { valid: true, reason: 'ok' };
}

// Pure helpers for the Officer-IDs admin tab roster. Kept out of the component
// so the filter + effective-status logic is unit-tested (the status label drives
// what an admin sees before deciding to revoke/reinstate).

export interface CredentialRow {
  wallet_id: string;
  status: string;           // 'active' | 'revoked'
  issued_at: string;
  revoked_at: string | null;
  revoked_by: number | null;
  user_id: number;
  full_name: string;
  badge_number: string | null;
  rank: string | null;
  department: string | null;
  officer_status: string;   // live users.status
}

export type RowTone = 'active' | 'revoked' | 'inactive';

export interface RowStatus {
  label: string;
  tone: RowTone;
}

export function filterCredentials(rows: CredentialRow[], query: string): CredentialRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) =>
    [r.full_name, r.badge_number, r.department]
      .some((f) => (f || '').toLowerCase().includes(q)),
  );
}

// Mirrors the server's walletValidity precedence: an explicit revoke is reported
// over an incidental inactive employment status.
export function credentialRowStatus(row: CredentialRow): RowStatus {
  if (row.status !== 'active') return { label: 'Revoked', tone: 'revoked' };
  if (row.officer_status !== 'active') return { label: 'Inactive officer', tone: 'inactive' };
  return { label: 'Active', tone: 'active' };
}

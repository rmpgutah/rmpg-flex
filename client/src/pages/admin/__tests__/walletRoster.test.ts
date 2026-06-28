import { describe, it, expect } from 'vitest';
import { filterCredentials, credentialRowStatus, type CredentialRow } from '../walletRoster';

const rows: CredentialRow[] = [
  { wallet_id: 'w1', status: 'active', issued_at: '', revoked_at: null, revoked_by: null, user_id: 1, full_name: 'Christopher Zamora', badge_number: '5721', rank: 'Chief', department: 'Patrol', officer_status: 'active' },
  { wallet_id: 'w2', status: 'revoked', issued_at: '', revoked_at: '', revoked_by: 1, user_id: 2, full_name: 'Jane Doe', badge_number: '1099', rank: 'Officer', department: 'K9', officer_status: 'active' },
  { wallet_id: 'w3', status: 'active', issued_at: '', revoked_at: null, revoked_by: null, user_id: 3, full_name: 'John Smith', badge_number: '2034', rank: 'Sergeant', department: 'Patrol', officer_status: 'terminated' },
];

describe('filterCredentials', () => {
  it('returns all rows for an empty query', () => {
    expect(filterCredentials(rows, '')).toHaveLength(3);
    expect(filterCredentials(rows, '   ')).toHaveLength(3);
  });

  it('matches on name (case-insensitive)', () => {
    const r = filterCredentials(rows, 'zamora');
    expect(r).toHaveLength(1);
    expect(r[0].user_id).toBe(1);
  });

  it('matches on badge number', () => {
    expect(filterCredentials(rows, '1099')[0].user_id).toBe(2);
  });

  it('matches on department', () => {
    expect(filterCredentials(rows, 'patrol').map((r) => r.user_id)).toEqual([1, 3]);
  });

  it('returns nothing when there is no match', () => {
    expect(filterCredentials(rows, 'zzz')).toHaveLength(0);
  });
});

describe('credentialRowStatus', () => {
  it('Active when credential and officer are both active', () => {
    expect(credentialRowStatus(rows[0])).toEqual({ label: 'Active', tone: 'active' });
  });

  it('Revoked when the credential is revoked', () => {
    expect(credentialRowStatus(rows[1])).toEqual({ label: 'Revoked', tone: 'revoked' });
  });

  it('Inactive officer when the credential is active but the officer is not', () => {
    expect(credentialRowStatus(rows[2])).toEqual({ label: 'Inactive officer', tone: 'inactive' });
  });

  it('reports Revoked even if the officer is also inactive (revoke wins)', () => {
    expect(credentialRowStatus({ ...rows[1], officer_status: 'terminated' })).toEqual({ label: 'Revoked', tone: 'revoked' });
  });
});

import { describe, it, expect } from 'vitest';
import { isCompanyBrowserBlockedRole } from '../companyBrowserAccess';

describe('isCompanyBrowserBlockedRole', () => {
  it('blocks client_viewer and contract_manager', () => {
    expect(isCompanyBrowserBlockedRole('client_viewer')).toBe(true);
    expect(isCompanyBrowserBlockedRole('contract_manager')).toBe(true);
  });

  it('allows every other role', () => {
    expect(isCompanyBrowserBlockedRole('officer')).toBe(false);
    expect(isCompanyBrowserBlockedRole('admin')).toBe(false);
    expect(isCompanyBrowserBlockedRole('manager')).toBe(false);
    expect(isCompanyBrowserBlockedRole('dispatcher')).toBe(false);
    expect(isCompanyBrowserBlockedRole('supervisor')).toBe(false);
    expect(isCompanyBrowserBlockedRole('human_resources')).toBe(false);
  });

  it('allows undefined/empty role (fails open to "not blocked" — ProtectedRoute already requires authentication first)', () => {
    expect(isCompanyBrowserBlockedRole(undefined)).toBe(false);
    expect(isCompanyBrowserBlockedRole('')).toBe(false);
  });
});

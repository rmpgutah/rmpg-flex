import { describe, it, expect } from 'vitest';
import { resolveDispatchAccess } from '../dispatchAccess';
import type { UserRole } from '../../../types';

describe('resolveDispatchAccess', () => {
  it('redirects officer to /mdt (already has a purpose-built terminal)', () => {
    expect(resolveDispatchAccess('officer')).toEqual({ mode: 'redirect', to: '/mdt' });
  });

  it('redirects contract_manager/client_viewer/human_resources to the dashboard', () => {
    expect(resolveDispatchAccess('contract_manager')).toEqual({ mode: 'redirect', to: '/' });
    expect(resolveDispatchAccess('client_viewer')).toEqual({ mode: 'redirect', to: '/' });
    expect(resolveDispatchAccess('human_resources')).toEqual({ mode: 'redirect', to: '/' });
  });

  it('lets dispatcher/admin/manager/supervisor reach the full CAD board', () => {
    expect(resolveDispatchAccess('dispatcher')).toEqual({ mode: 'board' });
    expect(resolveDispatchAccess('admin')).toEqual({ mode: 'board' });
    expect(resolveDispatchAccess('manager')).toEqual({ mode: 'board' });
    expect(resolveDispatchAccess('supervisor')).toEqual({ mode: 'board' });
  });

  it('is a denylist — an unrecognized or missing role falls through to the board', () => {
    // Casts simulate a value the compiler wouldn't normally allow (a stale
    // role after a UserRole rename, an imperfectly-validated API response) —
    // the whole point of the denylist design is to stay safe at runtime
    // against exactly this.
    expect(resolveDispatchAccess('something_new' as UserRole)).toEqual({ mode: 'board' });
    expect(resolveDispatchAccess(undefined)).toEqual({ mode: 'board' });
    expect(resolveDispatchAccess('' as UserRole)).toEqual({ mode: 'board' });
  });
});

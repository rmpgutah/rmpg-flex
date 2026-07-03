import { describe, it, expect } from 'vitest';
import { resolveDispatchAccess } from '../dispatchAccess';

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
    expect(resolveDispatchAccess('something_new')).toEqual({ mode: 'board' });
    expect(resolveDispatchAccess(undefined)).toEqual({ mode: 'board' });
    expect(resolveDispatchAccess('')).toEqual({ mode: 'board' });
  });
});

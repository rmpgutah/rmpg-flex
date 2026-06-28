import { describe, it, expect } from 'vitest';
import { walletValidity } from '../src/utils/walletValidity';

describe('walletValidity', () => {
  it('is valid when the credential is active and the officer is active', () => {
    expect(walletValidity('active', 'active')).toEqual({ valid: true, reason: 'ok' });
  });

  it('is invalid (revoked) when the credential is revoked, regardless of officer status', () => {
    expect(walletValidity('revoked', 'active')).toEqual({ valid: false, reason: 'revoked' });
  });

  it('is invalid (inactive_officer) when the officer is not active even if the credential is active', () => {
    expect(walletValidity('active', 'inactive')).toEqual({ valid: false, reason: 'inactive_officer' });
    expect(walletValidity('active', 'terminated')).toEqual({ valid: false, reason: 'inactive_officer' });
    expect(walletValidity('active', 'suspended')).toEqual({ valid: false, reason: 'inactive_officer' });
  });

  it('reports revoked first when both the credential is revoked and the officer is inactive', () => {
    expect(walletValidity('revoked', 'terminated')).toEqual({ valid: false, reason: 'revoked' });
  });
});

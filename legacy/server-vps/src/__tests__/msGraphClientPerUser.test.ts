import { describe, it, expect, vi } from 'vitest';

vi.mock('../utils/userGraphTokens', () => ({
  getUserTokens: vi.fn(),
  setUserTokens: vi.fn(),
  markUserNeedsReauth: vi.fn(),
}));
vi.mock('../models/database', () => ({ getDb: () => ({ prepare: () => ({ get: () => null }) }) }));

import { ensureValidTokenForUser, isUserAuthorized } from '../utils/msGraphClient';
import * as userTokens from '../utils/userGraphTokens';

describe('ensureValidTokenForUser', () => {
  it('throws if user not enrolled', async () => {
    (userTokens.getUserTokens as any).mockReturnValue(null);
    await expect(ensureValidTokenForUser(1)).rejects.toThrow(/not enrolled/);
  });
  it('returns existing token if not expired', async () => {
    (userTokens.getUserTokens as any).mockReturnValue({
      accessToken: 'AAA', refreshToken: 'RRR', expiresAt: Date.now() + 600_000, mailbox: '', scopes: '',
    });
    const t = await ensureValidTokenForUser(1);
    expect(t).toBe('AAA');
  });
});

describe('isUserAuthorized', () => {
  it('true when tokens present and not expired (>0)', () => {
    (userTokens.getUserTokens as any).mockReturnValue({ accessToken: 'A', refreshToken: 'R', expiresAt: 9999, mailbox: '', scopes: '' });
    expect(isUserAuthorized(1)).toBe(true);
  });
  it('false when expiresAt is 0 (marked for reauth)', () => {
    (userTokens.getUserTokens as any).mockReturnValue({ accessToken: 'A', refreshToken: 'R', expiresAt: 0, mailbox: '', scopes: '' });
    expect(isUserAuthorized(1)).toBe(false);
  });
  it('false when no tokens', () => {
    (userTokens.getUserTokens as any).mockReturnValue(null);
    expect(isUserAuthorized(1)).toBe(false);
  });
});

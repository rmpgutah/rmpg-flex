import { describe, it, expect } from 'vitest';
import { signWalletToken, verifyWalletToken } from '../src/utils/walletToken';

const SECRET = 'test-secret-do-not-use-in-prod';
const WID = 'a1b2c3d4-0000-4000-8000-abcdefabcdef';

describe('walletToken', () => {
  it('signs then verifies a token round-trip, recovering the wallet id', async () => {
    const token = await signWalletToken(WID, SECRET, { nowSec: 1000, ttlSec: 60 });
    const res = await verifyWalletToken(token, SECRET, { nowSec: 1000 });
    expect(res.valid).toBe(true);
    expect(res.walletId).toBe(WID);
  });

  it('rejects a token whose signature was tampered with', async () => {
    const token = await signWalletToken(WID, SECRET, { nowSec: 1000, ttlSec: 60 });
    // flip the last char of the signature segment
    const parts = token.split('.');
    parts[2] = parts[2].slice(0, -1) + (parts[2].slice(-1) === 'A' ? 'B' : 'A');
    const res = await verifyWalletToken(parts.join('.'), SECRET, { nowSec: 1000 });
    expect(res.valid).toBe(false);
    expect(res.reason).toBe('bad_signature');
  });

  it('rejects a token whose wallet id was swapped (signature no longer matches)', async () => {
    const token = await signWalletToken(WID, SECRET, { nowSec: 1000, ttlSec: 60 });
    const parts = token.split('.');
    parts[0] = 'ffffffff-0000-4000-8000-ffffffffffff';
    const res = await verifyWalletToken(parts.join('.'), SECRET, { nowSec: 1000 });
    expect(res.valid).toBe(false);
    expect(res.reason).toBe('bad_signature');
  });

  it('rejects an expired token', async () => {
    const token = await signWalletToken(WID, SECRET, { nowSec: 1000, ttlSec: 60 });
    const res = await verifyWalletToken(token, SECRET, { nowSec: 1061 }); // 1s past exp
    expect(res.valid).toBe(false);
    expect(res.reason).toBe('expired');
  });

  it('rejects a malformed token', async () => {
    const res = await verifyWalletToken('not-a-valid-token', SECRET, { nowSec: 1000 });
    expect(res.valid).toBe(false);
    expect(res.reason).toBe('malformed');
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await signWalletToken(WID, SECRET, { nowSec: 1000, ttlSec: 60 });
    const res = await verifyWalletToken(token, 'a-different-secret', { nowSec: 1000 });
    expect(res.valid).toBe(false);
    expect(res.reason).toBe('bad_signature');
  });
});

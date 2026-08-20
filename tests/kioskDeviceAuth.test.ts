import { describe, it, expect, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import { authenticateDeviceToken } from '../src/middleware/kioskDeviceAuth';

function fakeDb(row: Record<string, unknown> | null) {
  return {
    prepare: () => ({
      bind: () => ({
        first: async () => row,
      }),
    }),
  } as unknown as D1Database;
}

describe('authenticateDeviceToken', () => {
  it('accepts a matching token for an active device', async () => {
    const token = 'test-token-abc123';
    const hash = await bcrypt.hash(token, 10);
    const db = fakeDb({ id: 'dev-1', label: 'Lobby kiosk 1', token_hash: hash, status: 'active' });
    const result = await authenticateDeviceToken(db, 'dev-1', token);
    expect(result).toEqual({ id: 'dev-1', label: 'Lobby kiosk 1' });
  });

  it('rejects a wrong token', async () => {
    const hash = await bcrypt.hash('correct-token', 10);
    const db = fakeDb({ id: 'dev-1', label: 'Lobby kiosk 1', token_hash: hash, status: 'active' });
    const result = await authenticateDeviceToken(db, 'dev-1', 'wrong-token');
    expect(result).toBeNull();
  });

  it('rejects a revoked device even with the correct token', async () => {
    const token = 'test-token-abc123';
    const hash = await bcrypt.hash(token, 10);
    const db = fakeDb({ id: 'dev-1', label: 'Lobby kiosk 1', token_hash: hash, status: 'revoked' });
    const result = await authenticateDeviceToken(db, 'dev-1', token);
    expect(result).toBeNull();
  });

  it('rejects an unknown device id', async () => {
    const db = fakeDb(null);
    const result = await authenticateDeviceToken(db, 'no-such-device', 'anything');
    expect(result).toBeNull();
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';
import config from '../../src/config';

// Mock getDb BEFORE importing authenticateToken so the middleware picks up the mock.
vi.mock('../../src/models/database', () => ({
  getDb: vi.fn(),
}));

import { authenticateToken } from '../../src/middleware/auth';
import { getDb } from '../../src/models/database';

const mockedGetDb = vi.mocked(getDb);

function makeToken(overrides: Record<string, any> = {}) {
  return jwt.sign(
    {
      userId: 1,
      username: 'officer1',
      role: 'officer',
      fullName: 'Officer One',
      sessionId: 'sess-abc',
      ...overrides,
    },
    config.jwt.secret,
    { algorithm: 'HS256', expiresIn: '5m' }
  );
}

function makeReqRes(token: string, ip = '10.0.0.1') {
  const req: any = {
    headers: { authorization: `Bearer ${token}` },
    ip,
  };
  const res: any = { statusCode: 200, _json: null };
  res.status = vi.fn((code: number) => { res.statusCode = code; return res; });
  res.json = vi.fn((data: any) => { res._json = data; return res; });
  const next = vi.fn();
  return { req, res, next };
}

describe('authenticateToken — DB error paths', () => {
  const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

  beforeEach(() => {
    mockedGetDb.mockReset();
    errSpy.mockClear();
    warnSpy.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('IP-binding: allows request through and logs when DB errors (fail-open, defense-in-depth)', () => {
    // First getDb() call is for IP binding → throw.
    // Second call is for lockdown (officer is not admin) → return a stub with no lockdown row.
    mockedGetDb
      .mockImplementationOnce(() => { throw new Error('schema drift: no such table: sessions'); })
      .mockImplementationOnce(() => ({
        prepare: () => ({ get: () => undefined }),
      }) as any);

    const { req, res, next } = makeReqRes(makeToken());
    authenticateToken(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('IP-binding check failed'),
      expect.stringContaining('schema drift')
    );
  });

  it('Lockdown: fails CLOSED with 503 when DB errors for non-admin', () => {
    // IP binding OK, lockdown lookup throws.
    mockedGetDb
      .mockImplementationOnce(() => ({
        prepare: () => ({ get: () => ({ ip_address: '10.0.0.1' }) }),
      }) as any)
      .mockImplementationOnce(() => { throw new Error('database is locked'); });

    const { req, res, next } = makeReqRes(makeToken());
    authenticateToken(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(503);
    expect(res._json).toEqual({
      error: 'Unable to verify system status',
      code: 'LOCKDOWN_CHECK_FAILED',
    });
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('Lockdown check DB error'),
      expect.stringContaining('database is locked')
    );
  });

  it('Lockdown: fails CLOSED with 503 when config_value is malformed JSON', () => {
    mockedGetDb
      .mockImplementationOnce(() => ({
        prepare: () => ({ get: () => ({ ip_address: '10.0.0.1' }) }),
      }) as any)
      .mockImplementationOnce(() => ({
        prepare: () => ({ get: () => ({ config_value: '{not-json' }) }),
      }) as any);

    const { req, res, next } = makeReqRes(makeToken());
    authenticateToken(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(503);
    expect(res._json).toEqual({
      error: 'System lockdown configuration is invalid',
      code: 'LOCKDOWN_CONFIG_INVALID',
    });
  });

  it('Lockdown: admin role bypasses lockdown check entirely (never touches DB on that path)', () => {
    // Only one getDb call — for IP binding.
    mockedGetDb.mockImplementationOnce(() => ({
      prepare: () => ({ get: () => ({ ip_address: '10.0.0.1' }) }),
    }) as any);

    const { req, res, next } = makeReqRes(makeToken({ role: 'admin' }));
    authenticateToken(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(mockedGetDb).toHaveBeenCalledTimes(1);
  });
});

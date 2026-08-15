import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@libsql/client/web', () => ({
  createClient: vi.fn(() => ({ execute: vi.fn() })),
}));

import {
  createTursoClient,
  initTursoSingleton,
  getTursoClient,
  setTursoClient,
} from '../src/utils/tursoClient';

describe('createTursoClient', () => {
  it('returns null when TURSO_URL is missing', () => {
    expect(createTursoClient({ TURSO_AUTH_TOKEN: 'token' })).toBeNull();
  });

  it('returns null when TURSO_AUTH_TOKEN is missing', () => {
    expect(createTursoClient({ TURSO_URL: 'libsql://example.turso.io' })).toBeNull();
  });

  it('returns null when both secrets are missing', () => {
    expect(createTursoClient({})).toBeNull();
  });

  it('returns a client when both secrets are present', () => {
    const client = createTursoClient({
      TURSO_URL: 'libsql://rmpg-flex-secondary-rmpg-utah.turso.io',
      TURSO_AUTH_TOKEN: 'test-token',
    });
    expect(client).not.toBeNull();
    expect(client).toHaveProperty('execute');
  });
});

describe('singleton', () => {
  beforeEach(() => setTursoClient(null));

  it('getTursoClient returns null before init', () => {
    expect(getTursoClient()).toBeNull();
  });

  it('initTursoSingleton sets client when secrets present', () => {
    initTursoSingleton({
      TURSO_URL: 'libsql://rmpg-flex-secondary-rmpg-utah.turso.io',
      TURSO_AUTH_TOKEN: 'test-token',
    });
    expect(getTursoClient()).not.toBeNull();
  });

  it('initTursoSingleton is idempotent — does not replace existing client', () => {
    const fake = { execute: vi.fn() } as any;
    setTursoClient(fake);
    initTursoSingleton({
      TURSO_URL: 'libsql://rmpg-flex-secondary-rmpg-utah.turso.io',
      TURSO_AUTH_TOKEN: 'new-token',
    });
    expect(getTursoClient()).toBe(fake);
  });

  it('setTursoClient(null) resets singleton', () => {
    initTursoSingleton({
      TURSO_URL: 'libsql://rmpg-flex-secondary-rmpg-utah.turso.io',
      TURSO_AUTH_TOKEN: 'test-token',
    });
    setTursoClient(null);
    expect(getTursoClient()).toBeNull();
  });
});

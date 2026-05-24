// Locks the logger's per-environment level contract:
//   - production: 'info' (capture operational events, drop debug)
//   - test:       'error' (silence intentional warn-path tests)
//   - dev:        'debug' (developer visibility)
//   - LOG_LEVEL env var always wins.

import { describe, it, expect } from 'vitest';
import { decideLogLevel } from '../logger';

describe('decideLogLevel', () => {
  it('defaults to debug in dev (no NODE_ENV)', () => {
    expect(decideLogLevel({} as any)).toBe('debug');
  });

  it('returns info in production', () => {
    expect(decideLogLevel({ NODE_ENV: 'production' } as any)).toBe('info');
  });

  it('returns error in test mode (NODE_ENV=test)', () => {
    expect(decideLogLevel({ NODE_ENV: 'test' } as any)).toBe('error');
  });

  it('detects test mode via VITEST env var even without NODE_ENV', () => {
    expect(decideLogLevel({ VITEST: 'true' } as any)).toBe('error');
  });

  it('LOG_LEVEL overrides every default', () => {
    expect(decideLogLevel({ NODE_ENV: 'test', LOG_LEVEL: 'debug' } as any)).toBe('debug');
    expect(decideLogLevel({ NODE_ENV: 'production', LOG_LEVEL: 'silent' } as any)).toBe('silent');
    expect(decideLogLevel({ LOG_LEVEL: 'trace' } as any)).toBe('trace');
  });

  it('treats VITEST as truthy regardless of value', () => {
    expect(decideLogLevel({ VITEST: '1' } as any)).toBe('error');
    expect(decideLogLevel({ VITEST: 'false' } as any)).toBe('error'); // any string is truthy
  });
});

import { describe, it, expect } from 'vitest';
import { pickWinner } from '../src/utils/syncConflict';

describe('pickWinner', () => {
  it('picks fz55 when its timestamp is newer', () => {
    expect(pickWinner('2026-08-15 10:00:00', '2026-08-15 09:00:00')).toBe('fz55');
  });

  it('picks cloudflare when its timestamp is newer', () => {
    expect(pickWinner('2026-08-15 08:00:00', '2026-08-15 09:00:00')).toBe('cloudflare');
  });

  it('returns equal when timestamps match', () => {
    expect(pickWinner('2026-08-15 09:00:00', '2026-08-15 09:00:00')).toBe('equal');
  });

  it('treats missing fz55 timestamp as oldest', () => {
    expect(pickWinner(null, '2026-08-15 09:00:00')).toBe('cloudflare');
  });

  it('treats missing cloud timestamp as oldest', () => {
    expect(pickWinner('2026-08-15 09:00:00', null)).toBe('fz55');
  });
});

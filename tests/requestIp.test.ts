import { describe, it, expect } from 'vitest';
import { clientIp } from '../src/utils/requestIp';

function fakeContext(headers: Record<string, string>) {
  return {
    req: {
      header: (name: string) => headers[name.toLowerCase()],
    },
  };
}

describe('clientIp', () => {
  it('returns CF-Connecting-IP when present', () => {
    expect(clientIp(fakeContext({ 'cf-connecting-ip': '1.2.3.4' }))).toBe('1.2.3.4');
  });

  it('prefers CF-Connecting-IP over x-forwarded-for', () => {
    expect(clientIp(fakeContext({
      'cf-connecting-ip': '1.2.3.4',
      'x-forwarded-for': '5.6.7.8, 9.10.11.12',
    }))).toBe('1.2.3.4');
  });

  it('takes the first x-forwarded-for entry', () => {
    expect(clientIp(fakeContext({ 'x-forwarded-for': '5.6.7.8, 9.10.11.12' }))).toBe('5.6.7.8');
  });

  it('falls back to x-real-ip', () => {
    expect(clientIp(fakeContext({ 'x-real-ip': '10.0.0.1' }))).toBe('10.0.0.1');
  });

  it('returns unknown when no headers are present', () => {
    expect(clientIp(fakeContext({}))).toBe('unknown');
  });
});

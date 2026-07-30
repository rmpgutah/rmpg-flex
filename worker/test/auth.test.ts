import { describe, it, expect } from 'vitest';
import { checkPassword, signCookieValue, verifyCookieValue } from '../src/auth';

describe('auth', () => {
  it('checkPassword accepts a matching password', () => {
    expect(checkPassword('correct-horse', 'correct-horse')).toBe(true);
  });

  it('checkPassword rejects a mismatched password', () => {
    expect(checkPassword('wrong', 'correct-horse')).toBe(false);
  });

  it('signs and verifies a cookie value with the same secret', async () => {
    const signed = await signCookieValue('test-secret');
    const valid = await verifyCookieValue(signed, 'test-secret');
    expect(valid).toBe(true);
  });

  it('rejects a cookie signed with a different secret', async () => {
    const signed = await signCookieValue('secret-a');
    const valid = await verifyCookieValue(signed, 'secret-b');
    expect(valid).toBe(false);
  });

  it('rejects an undefined cookie value', async () => {
    const valid = await verifyCookieValue(undefined, 'test-secret');
    expect(valid).toBe(false);
  });

  it('rejects a malformed cookie value', async () => {
    const valid = await verifyCookieValue('not-a-real-token', 'test-secret');
    expect(valid).toBe(false);
  });
});

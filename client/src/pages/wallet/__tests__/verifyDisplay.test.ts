import { describe, it, expect } from 'vitest';
import { verifyResultDisplay } from '../verifyDisplay';

describe('verifyResultDisplay', () => {
  it('shows a VALID banner for a valid active officer', () => {
    const d = verifyResultDisplay({ valid: true, reason: 'ok' });
    expect(d.tone).toBe('valid');
    expect(d.banner).toBe('VALID');
  });

  it('shows REVOKED distinctly (invalid) so the verifier knows the badge was pulled', () => {
    const d = verifyResultDisplay({ valid: false, reason: 'revoked' });
    expect(d.tone).toBe('invalid');
    expect(d.banner).toBe('REVOKED');
  });

  it('shows INACTIVE OFFICER when the officer is no longer active', () => {
    const d = verifyResultDisplay({ valid: false, reason: 'inactive_officer' });
    expect(d.tone).toBe('invalid');
    expect(d.banner).toBe('INACTIVE OFFICER');
  });

  it('asks to rescan when the QR token expired (stale screenshot), not "fake"', () => {
    const d = verifyResultDisplay({ valid: false, reason: 'expired' });
    expect(d.tone).toBe('expired');
    expect(d.banner.toLowerCase()).toContain('rescan');
  });

  it('treats forged/unknown tokens as NOT A VALID ID', () => {
    for (const reason of ['bad_signature', 'malformed', 'not_found', 'missing_token'] as const) {
      const d = verifyResultDisplay({ valid: false, reason });
      expect(d.tone).toBe('invalid');
      expect(d.banner).toBe('NOT A VALID ID');
    }
  });
});

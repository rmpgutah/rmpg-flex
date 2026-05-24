import { describe, it, expect } from 'vitest';
import {
  encryptSecret,
  decryptSecret,
  generateTotpSecret,
  verifyTotpToken,
  generateBackupCodes,
  hashBackupCode,
  verifyBackupCode,
} from '../../src/utils/totpService';

describe('totpService.ts', () => {
  describe('encryptSecret / decryptSecret', () => {
    it('round-trips a secret through encrypt then decrypt', () => {
      const original = 'JBSWY3DPEHPK3PXP';
      const { encrypted, iv, tag } = encryptSecret(original);
      const decrypted = decryptSecret(encrypted, iv, tag);
      expect(decrypted).toBe(original);
    });

    it('returns separate iv, tag, and encrypted hex strings', () => {
      const { encrypted, iv, tag } = encryptSecret('test-secret');
      // IV = 16 bytes = 32 hex chars
      expect(iv).toMatch(/^[0-9a-f]{32}$/);
      // Auth tag = 16 bytes = 32 hex chars
      expect(tag).toMatch(/^[0-9a-f]{32}$/);
      // Encrypted is non-empty hex
      expect(encrypted).toMatch(/^[0-9a-f]+$/);
    });

    it('produces different ciphertext for the same input (random IV)', () => {
      const secret = 'same-secret';
      const enc1 = encryptSecret(secret);
      const enc2 = encryptSecret(secret);
      expect(enc1.encrypted).not.toBe(enc2.encrypted);
      // Both decrypt to the same value
      expect(decryptSecret(enc1.encrypted, enc1.iv, enc1.tag)).toBe(secret);
      expect(decryptSecret(enc2.encrypted, enc2.iv, enc2.tag)).toBe(secret);
    });

    it('rejects a tampered auth tag', () => {
      const { encrypted, iv } = encryptSecret('important-secret');
      const fakeTag = '0'.repeat(32);
      expect(() => decryptSecret(encrypted, iv, fakeTag)).toThrow();
    });

    it('rejects tampered ciphertext', () => {
      const { encrypted, iv, tag } = encryptSecret('important-secret');
      const lastChar = encrypted.slice(-1);
      const flipped = lastChar === '0' ? '1' : '0';
      const tampered = encrypted.slice(0, -1) + flipped;
      expect(() => decryptSecret(tampered, iv, tag)).toThrow();
    });
  });

  describe('generateTotpSecret', () => {
    it('returns an OTPAuth.Secret and otpauth URI', () => {
      const { secret, uri } = generateTotpSecret('officer_smith');
      // OTPAuth.Secret has a base32 property
      expect(secret.base32).toMatch(/^[A-Z2-7]+=*$/);
      expect(uri).toContain('otpauth://totp/');
      expect(uri).toContain('officer_smith');
    });

    it('includes the issuer in the URI', () => {
      const { uri } = generateTotpSecret('admin');
      expect(uri).toContain('RMPG');
    });
  });

  describe('verifyTotpToken', () => {
    it('validates a correct TOTP code', () => {
      const { secret } = generateTotpSecret('testuser');
      const base32 = secret.base32;
      // Generate the current valid code
      const OTPAuth = require('otpauth');
      const totp = new OTPAuth.TOTP({
        secret: OTPAuth.Secret.fromBase32(base32),
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
      });
      const validCode = totp.generate();
      expect(verifyTotpToken(base32, validCode)).toBe(true);
    });

    it('rejects an invalid TOTP code', () => {
      const { secret } = generateTotpSecret('testuser');
      expect(verifyTotpToken(secret.base32, '000000')).toBe(false);
    });
  });

  describe('generateBackupCodes', () => {
    it('generates the requested number of codes', () => {
      const codes = generateBackupCodes(5);
      expect(codes).toHaveLength(5);
    });

    it('formats codes as XXXX-XXXX-XXXX (uppercase hex)', () => {
      const codes = generateBackupCodes(3);
      for (const code of codes) {
        expect(code).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
      }
    });

    it('generates unique codes', () => {
      const codes = generateBackupCodes(20);
      const unique = new Set(codes);
      expect(unique.size).toBe(20);
    });
  });

  // bcrypt rounds=12 hashing/verifying takes 200-500ms each on dev hw,
  // and adds up across 4 tests. Bump the per-test timeout so warm-CI
  // runs (where hash time spikes) don't flake the deploy gate.
  describe('hashBackupCode / verifyBackupCode', () => {
    it('hashes and verifies a code correctly', { timeout: 30000 }, () => {
      const code = 'ABCD-EF01';
      const hash = hashBackupCode(code);
      expect(verifyBackupCode(code, hash)).toBe(true);
    });

    it('rejects a wrong code', { timeout: 30000 }, () => {
      const hash = hashBackupCode('ABCD-EF01');
      expect(verifyBackupCode('ZZZZ-0000', hash)).toBe(false);
    });

    it('is dash-insensitive', { timeout: 30000 }, () => {
      const hash = hashBackupCode('ABCD-EF01');
      expect(verifyBackupCode('ABCDEF01', hash)).toBe(true);
    });

    it('is case-insensitive', { timeout: 30000 }, () => {
      const hash = hashBackupCode('ABCD-EF01');
      expect(verifyBackupCode('abcd-ef01', hash)).toBe(true);
    });

    it('produces bcrypt hashes', () => {
      const hash = hashBackupCode('TEST-CODE');
      expect(hash).toMatch(/^\$2[aby]\$/);
    });
  });
});

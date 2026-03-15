import { describe, it, expect } from 'vitest';
import {
  encryptSecret,
  decryptSecret,
  generateTotpSecret,
  verifyTotpCode,
  generateBackupCodes,
  verifyBackupCode,
} from '../../src/utils/totp';

describe('totp.ts', () => {
  describe('encryptSecret / decryptSecret', () => {
    it('round-trips a secret through encrypt then decrypt', () => {
      const original = 'JBSWY3DPEHPK3PXP';
      const encrypted = encryptSecret(original);
      const decrypted = decryptSecret(encrypted);
      expect(decrypted).toBe(original);
    });

    it('returns iv:authTag:ciphertext format', () => {
      const encrypted = encryptSecret('test-secret');
      const parts = encrypted.split(':');
      expect(parts).toHaveLength(3);
      // IV = 16 bytes = 32 hex chars
      expect(parts[0]).toMatch(/^[0-9a-f]{32}$/);
      // Auth tag = 16 bytes = 32 hex chars
      expect(parts[1]).toMatch(/^[0-9a-f]{32}$/);
      // Ciphertext is non-empty hex
      expect(parts[2]).toMatch(/^[0-9a-f]+$/);
    });

    it('produces different ciphertext for the same input (random IV)', () => {
      const secret = 'same-secret';
      const enc1 = encryptSecret(secret);
      const enc2 = encryptSecret(secret);
      expect(enc1).not.toBe(enc2);
      // But both decrypt to the same value
      expect(decryptSecret(enc1)).toBe(secret);
      expect(decryptSecret(enc2)).toBe(secret);
    });

    it('rejects tampered ciphertext', () => {
      const encrypted = encryptSecret('important-secret');
      const parts = encrypted.split(':');
      // Flip last hex char of the ciphertext
      const lastChar = parts[2].slice(-1);
      const flipped = lastChar === '0' ? '1' : '0';
      const tampered = `${parts[0]}:${parts[1]}:${parts[2].slice(0, -1)}${flipped}`;
      expect(() => decryptSecret(tampered)).toThrow();
    });

    it('rejects tampered auth tag', () => {
      const encrypted = encryptSecret('important-secret');
      const parts = encrypted.split(':');
      const tamperedTag = '0'.repeat(32);
      const tampered = `${parts[0]}:${tamperedTag}:${parts[2]}`;
      expect(() => decryptSecret(tampered)).toThrow();
    });

    it('rejects invalid format (missing parts)', () => {
      expect(() => decryptSecret('abc:def')).toThrow('Invalid encrypted secret format');
    });
  });

  describe('generateTotpSecret', () => {
    it('returns a base32 secret and otpauth URI', () => {
      const { secret, otpauthUrl } = generateTotpSecret('testuser');
      // Base32 characters only
      expect(secret).toMatch(/^[A-Z2-7]+=*$/);
      expect(secret.length).toBeGreaterThanOrEqual(16);
      expect(otpauthUrl).toContain('otpauth://totp/');
      expect(otpauthUrl).toContain('testuser');
      expect(otpauthUrl).toContain('RMPG%20Flex');
    });

    it('generates unique secrets for different calls', () => {
      const { secret: s1 } = generateTotpSecret('user1');
      const { secret: s2 } = generateTotpSecret('user2');
      expect(s1).not.toBe(s2);
    });
  });

  describe('verifyTotpCode', () => {
    it('validates a correct TOTP code', () => {
      const { secret } = generateTotpSecret('testuser');
      // Generate the current valid code using OTPAuth directly
      const OTPAuth = require('otpauth');
      const totp = new OTPAuth.TOTP({
        secret: OTPAuth.Secret.fromBase32(secret),
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
      });
      const validCode = totp.generate();
      expect(verifyTotpCode(secret, validCode)).toBe(true);
    });

    it('rejects an invalid TOTP code', () => {
      const { secret } = generateTotpSecret('testuser');
      expect(verifyTotpCode(secret, '000000')).toBe(false);
    });
  });

  describe('generateBackupCodes', () => {
    it('generates the requested number of codes', () => {
      const { plain, hashed } = generateBackupCodes(5);
      expect(plain).toHaveLength(5);
      expect(hashed).toHaveLength(5);
    });

    it('defaults to 10 codes', () => {
      const { plain } = generateBackupCodes();
      expect(plain).toHaveLength(10);
    });

    it('formats codes as XXXX-XXXX (uppercase hex)', () => {
      const { plain } = generateBackupCodes(3);
      for (const code of plain) {
        expect(code).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}$/);
      }
    });

    it('generates unique codes', () => {
      const { plain } = generateBackupCodes(10);
      const unique = new Set(plain);
      // Extremely unlikely to have duplicates with random bytes
      expect(unique.size).toBe(10);
    }, 30_000);

    it('produces hashes that are bcrypt strings', () => {
      const { hashed } = generateBackupCodes(2);
      for (const hash of hashed) {
        expect(hash).toMatch(/^\$2[aby]\$/);
      }
    });
  });

  describe('verifyBackupCode', () => {
    it('validates a correct backup code', () => {
      const { plain, hashed } = generateBackupCodes(3);
      const result = verifyBackupCode(plain[1], hashed);
      expect(result.valid).toBe(true);
      expect(result.remainingCodes).toHaveLength(2);
      // The used code's hash should be removed
      expect(result.remainingCodes).not.toContain(hashed[1]);
    });

    it('rejects an invalid code', () => {
      const { hashed } = generateBackupCodes(3);
      const result = verifyBackupCode('ZZZZ-ZZZZ', hashed);
      expect(result.valid).toBe(false);
      expect(result.remainingCodes).toHaveLength(3);
    });

    it('accepts codes with or without dashes', () => {
      const { plain, hashed } = generateBackupCodes(3);
      const codeNoDash = plain[0].replace('-', '');
      const result = verifyBackupCode(codeNoDash, hashed);
      expect(result.valid).toBe(true);
    });

    it('accepts lowercase codes', () => {
      const { plain, hashed } = generateBackupCodes(3);
      const result = verifyBackupCode(plain[0].toLowerCase(), hashed);
      expect(result.valid).toBe(true);
    });
  });
});

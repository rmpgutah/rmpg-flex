// ============================================================
// RMPG Flex — Post-quantum encryption subsystem: typed errors
// ------------------------------------------------------------
// Fail-closed typed errors mirroring the existing crypto utilities
// (FileEncryptionError in encryptedR2.ts, CpgCryptoError in cpgCrypto.ts).
// Surface these so callers can distinguish a missing-config failure
// (admin action needed: `wrangler secret put`) from a tampered-garbled
// ciphertext (possible attack / data corruption) without swallowing
// either into a generic Error.
// ============================================================

export class RmpgCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RmpgCryptoError';
  }
}

/** A required secret (RMPG_PQ_MASTER_KEY, JWT_SECRET, etc.) is unset or
 *  malformed. The operation refuses to run rather than silently degrading
 *  to an unencrypted or unsigned state. */
export class CryptoConfigError extends RmpgCryptoError {
  constructor(message: string) {
    super(message);
    this.name = 'CryptoConfigError';
  }
}

/** A ciphertext / signature / sealed frame is malformed, the wrong version,
 *  has been tampered with, or failed authenticated-association. */
export class CryptoVerificationError extends RmpgCryptoError {
  constructor(message: string) {
    super(message);
    this.name = 'CryptoVerificationError';
  }
}

export class KeyStoreError extends RmpgCryptoError {
  constructor(message: string) {
    super(message);
    this.name = 'KeyStoreError';
  }
}

export { RmpgCryptoError as default };
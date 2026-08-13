// ============================================================
// RMPG Flex — Post-quantum encryption subsystem (public surface)
// ------------------------------------------------------------
// Single import path for the whole PQ-capable encryption layer:
//   import { seal, open, hybridSign, hybridVerify,
//            encryptField, decryptField, ensureEncryptionIdentity } from
//     '../utils/crypto';
//
// What this layer IS: a composition of NIST-standardized, peer-reviewed
// primitives (AES-256-GCM, HKDF-SHA-256, X25519, Ed25519, ML-KEM-768,
// ML-DSA-65) into higher-level envelopes and signatures.
//
// What this layer is NOT: novel cryptography. Every algorithm below is a
// vetted standard; this module only assembles them with conservative
// fail-closed contracts.
// ============================================================

export type {
  RmpgCryptoError,
  CryptoConfigError,
  CryptoVerificationError,
  KeyStoreError,
} from './errors';

export {
  randomBytes,
  b64encode,
  b64decode,
  utf8,
  fromUtf8,
  hexEncode,
  hexDecode,
  concatBytes,
  constantTimeEqual,
  sha256,
  hkdf,
  importAesKey,
  aesGcmEncrypt,
  aesGcmDecrypt,
  importMasterKey,
} from './primitives';

export {
  PQ_HYBRID_KEM,
  PQ_SIGNER,
  CLASSIC_SIGNER,
  PQ_KEM_PUB_LEN,
  PQ_KEM_SEC_LEN,
  PQ_KEM_CT_LEN,
  ML_DSA_PUB_LEN,
  ML_DSA_SEC_LEN,
  ML_DSA_SIG_LEN,
  ED25519_SEC_LEN,
  ED25519_PUB_LEN,
  ED25519_SIG_LEN,
  kemKeygen,
  kemEncapsulate,
  kemDecapsulate,
  ed25519Keygen,
  ed25519Sign,
  ed25519Verify,
  mlDsaKeygen,
  mlDsaSign,
  mlDsaVerify,
  type KemKeyPair,
  type KemEncapsulation,
  type Ed25519KeyPair,
  type MlDsaKeyPair,
} from './postquantum';

export {
  seal,
  open,
  hybridSign,
  hybridVerify,
  hybridSigningKeygen,
  parseHybridSignature,
  type SealResult,
  type HybridSigningKeyPair,
  type HybridPublicKey,
  type ParsedHybridSignature,
} from './hybrid';

export {
  isEncrypted,
  encryptField,
  decryptField,
  encryptBytes,
  decryptBytes,
  wrapDek,
  unwrapDek,
} from './envelope';

export {
  ENCRYPTION_ID,
  SIGNING_ID,
  OFFICER_PREFIX,
  hasIdentity,
  ensureEncryptionIdentity,
  getEncryptionPublicKey,
  getEncryptionSecretKey,
  ensureSigningIdentity,
  loadSigningSecrets,
  getSigningPublicKey,
  listIdentities,
  rotateMasterKey,
  ensureOfficerEncryptionIdentity,
  getOfficerEncryptionPublicKey,
  getOfficerEncryptionSecretKey,
  ensureOfficerSigningIdentity,
  loadOfficerSigningSecrets,
  getOfficerSigningPublicKey,
  revokeOfficerIdentity,
  listOfficerIdentities,
  isOfficerIdentityId,
  userIdFromOfficerIdentityId,
  type EncryptionIdentity,
  type SigningIdentityKeys,
  type SigningPublicKey,
  type RotationResult,
} from './keystore';
# RMPG Flex — Post-Quantum Crypto Wire-Format & Interop Spec

**Status:** Active — `src/utils/crypto/hybrid.ts` (Worker), `client/src/utils/pqCrypto.ts` (browser)
**Date:** 2026-07-24
**Algorithms:** X25519 (RFC 7748) · ML-KEM-768 (FIPS 203) · Ed25519 (RFC 8032) · ML-DSA-65 (FIPS 204) · AES-256-GCM (FIPS 197 / SP 800-38D) · HKDF-SHA-256 (RFC 5869)

This document fixes the on-the-wire byte layouts so that a frame produced by
the officer's device (browser) is byte-identical to one produced by the Worker,
and vice-versa. It is the single source of truth for any external consumer
(another agency, a defense attorney's viewer, an archival tool) that needs to
open or verify RMPG Flex sealed evidence or hybrid signatures.

> **No novel cryptography.** Every primitive below is a NIST/RFC standard.
> This spec only fixes the *composition* and *framing*, which is where
> interop actually lives.

---

## 1. Sealed Box — `RMPGSEAL`

A sealed box is a hybrid KEM + AEAD construction. Anyone with the recipient's
**public** key can seal; only the holder of the recipient's **secret** key can
open. The KEM provides forward secrecy on the sender side (fresh randomness per
seal); AEAD provides confidentiality + integrity.

### 1.1 Construction

```
sharedSecret = ML-KEM-768_X25519.encapsulate(recipientPublicKey).sharedSecret
kemCT        = ML-KEM-768_X25519.encapsulate(recipientPublicKey).cipherText
cek          = HKDF-SHA-256(ikm=sharedSecret, salt=kemCT, info="RMPG-FLEX/hybrid-seal/v1", L=32)
{ iv, ciphertext } = AES-256-GCM(cek, plaintext, aad?)     // 12-byte fresh IV; 16-byte tag appended
frame = magic || version || kemCT || iv || ciphertext
```

- `kemCT` length = `ml_kem768_x25519.lengths.cipherText` = 1120 bytes (X25519 32 + ML-KEM-768 1088).
- `iv` length = 12 bytes.
- `ciphertext` length = `len(plaintext) + 16` (GCM auth tag).
- `aad` (caller-supplied, optional) is **authenticated but not stored in the frame** — callers MUST remember it and pass the same bytes to `open`. Typical use: bind a frame to a record id (`utf8("evidence:42")`) so it can't be replayed as evidence #43.

### 1.2 Frame layout

```
Offset  Length       Contents
0       7            Magic: ASCII "RMPGSEAL"  (0x52 0x4D 0x50 0x47 0x53 0x45 0x41 0x4C)
7       1            Version: 0x01
8       1120         kemCT  (hybrid KEM ciphertext)
1128    12           iv     (AES-GCM nonce)
1140    variable     ciphertext (plaintext-length + 16-byte GCM tag)
```

All integers are unsigned, no length prefixes for variable fields (frame end =
buffer end). Frames are binary; transport as base64 over JSON.

### 1.3 Open

```
sharedSecret = ML-KEM-768_X25519.decapsulate(kemCT, recipientSecretKey)
cek          = HKDF-SHA-256(sharedSecret, kemCT, "RMPG-FLEX/hybrid-seal/v1", 32)
plaintext    = AES-256-GCM.decrypt(cek, iv, ciphertext, aad?)
```

GCM tag mismatch → reject the entire frame. No partial decrypt ever surfaces.
Wrong recipient secret key → KEM decapsulation yields a (deterministic) wrong
shared secret → GCM fails → reject. No oracle about *which* half failed.

### 1.4 Versioning

`version` is a single byte. `0x01` is current. A future `0x02` MUST keep the
7-byte magic and 1-byte version at offsets 0 and 7, then may change everything
after. Openers MUST reject an unknown version rather than guessing its layout.

---

## 2. Hybrid Signature — `RMPGSIG`

A hybrid signature is Ed25519 **AND** ML-DSA-65 over the same message, with an
**AND** verification combiner: both halves must verify. This stays unforgeable
as long as *at least one* of {classical, post-quantum} assumptions holds against
the adversary — i.e. it is secure against a quantum adversary even if ML-DSA
were later broken, and against a classical adversary even if Ed25519 were broken.

### 2.1 Construction

```
edSig = Ed25519.sign(msg, edSecretKey)        // 64 bytes, deterministic
pqSig = ML-DSA-65.sign(msg, pqSecretKey)      // ~3309 bytes, randomized
sig   = magic || version || edSig || pqLen(be32) || pqSig
```

`pqLen` is the ML-DSA-65 signature length in bytes, encoded big-endian 32-bit
at offset `7+1+64`. (Ed25519 is fixed 64B so it needs no length prefix; ML-DSA
signatures are fixed-length per FIPS 204 but we carry the length for forward
compat with Falcon/SLH-DSA which are variable.)

### 2.2 Frame layout

```
Offset  Length       Contents
0       7            Magic: ASCII "RMPGSIG"
7       1            Version: 0x01
8       64           edSig  (Ed25519)
72      4            pqLen  (big-endian uint32, ML-DSA-65 sig length)
76      pqLen        pqSig  (ML-DSA-65)
```

### 2.3 Verify

```
parsed = parse(sig)                       // magic + version check, split edSig / pqSig
ok = Ed25519.verify(parsed.edSig, msg, edPublicKey)
     && ML-DSA-65.verify(parsed.pqSig, msg, pqPublicKey)   // AND
```

A well-formed but invalid signature returns `false`, never throws. A malformed
frame (bad magic, truncated, inconsistent `pqLen`) → reject as `false`/error
depending on caller policy; `hybridVerify` returns `false`.

### 2.4 Why AND not OR

For *signatures*, the threat is **forgery**. An adversary who can break *either*
scheme could forge under an OR combiner. AND requires breaking *both* schemes
to forge — strictly stronger. (For the KEM/sealed-box side the logic flips: a
*decryption* key recovery must break *both* schemes to decrypt past traffic, so
the hybrid KEM's implicit combiner is effectively OR-style on shared-secret
recovery. The two directions are asymmetric by design.)

---

## 3. Identities & keystorage

| Identity id        | kind        | public_key (base64)                         | wrapped_secret (enc-v2)               |
|--------------------|-------------|---------------------------------------------|---------------------------------------|
| `org-encryption`   | `encryption`| hybrid KEM pub (1120B)                      | hybrid KEM sec (~3.3KB), AES-GCM-wrapped |
| `org-signing`      | `signing`   | Ed25519 pub(32) ‖ ML-DSA-65 pub(~1958B)      | Ed25519 sec(32) ‖ ML-DSA-65 sec(~4032B), wrapped |
| `officer-<userId>` | `encryption`| as org-encryption                           | as org-encryption                    |
| `officer-<userId>` | `signing`   | as org-signing                              | as org-signing                       |

Secrets are wrapped by `RMPG_PQ_MASTER_KEY` (Worker secret, 32 bytes base64) as
`enc-v2:<b64 iv>:<b64 ct+tag>` (AES-256-GCM). Leaking a D1 row alone is not
sufficient to recover any secret.

### Symmetric envelope at-rest (`enc-v2`)

```
stored = "enc-v2:" || base64(iv[12]) || ":" || base64(AES-256-GCM(masterKey, plaintext, aad?))
```

Used for DB columns and config blobs. Independent of the sealed-box frame
(which is asymmetric). Both use AES-256-GCM; the envelope lacks the KEM hop
because the key is a shared Worker secret.

---

## 4. Rotation

`RMPG_PQ_MASTER_KEY` rotation re-wraps every `crypto_identities` secret under
the new KEK (see `rotateMasterKey`). The old key, once rotated, can be
destroyed — at that point any wrapped-DEK rows still keyed by it are
permanently unreadable (intentional crypto-shred). Rotation is atomic per D1
batch: either every row moves to the new key or none do.

`FILE_ENCRYPTION_KEK` (R2 object envelopes, `encryptedR2.ts`) is a **separate**
secret and rotates via its own path — rotating one does not touch the other.

---

## 5. Interop checklist for an external consumer

To **open** a `RMPGSEAL` frame you received from RMPG Flex:
1. Hold the recipient hybrid KEM **secret key** (1120+ bytes — only the org or the target officer has it, post-unwrapping).
2. Use `@noble/post-quantum`'s `ml_kem768_x25519` (or a FIPS-203 + RFC-7748 implementation of equal correctness).
3. Parse per §1.2; HKDF with info `RMPG-FLEX/hybrid-seal/v1`; AES-256-GCM decrypt.

To **verify** a `RMPGSIG` signature:
1. Hold the signer's Ed25519 public key (32B) and ML-DSA-65 public key (~1958B).
2. Parse per §2.2; verify both halves with a correct Ed25519 and ML-DSA-65 implementation; AND-combine.

Any deviation from these byte layouts is a different protocol and MUST NOT be
accepted as RMPG Flex evidence.

---

## 6. References

- FIPS 203 (ML-KEM, formerly Kyber)
- FIPS 204 (ML-DSA, formerly Dilithium)
- RFC 7748 (X25519), RFC 8032 (Ed25519)
- RFC 5869 (HKDF), FIPS 197 / SP 800-38D (AES-GCM)
- `@noble/post-quantum` hybrid preset `ml_kem768_x25519` (X-Wing-style)
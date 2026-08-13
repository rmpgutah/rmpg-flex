// ============================================================
// RMPG Flex — usePqSeal: client-side post-quantum sealing hook
// ------------------------------------------------------------
// Lets an officer's device seal evidence (a File, a JSON blob, a
// narrative) with the X25519+ML-KEM-768 hybrid KEM -> AES-256-GCM
// BEFORE the bytes ever leave the browser. The Worker receives only
// the opaque RMPGSEAL frame and persists it; not even a full compromise
// of the Worker runtime (sans the secret store) can recover the
// plaintext — only a holder of the unwrapped org/officer secret key
// can open() it.
//
// Flow:
//   1. fetch the org (or officer) recipient PUBLIC key once, cache in
//      a ref so a flurry of seal() calls in one session hits the net
//      once;
//   2. seal(plaintext, aad?) -> base64 frame, using pqCrypto.ts which
//      mirrors src/utils/crypto/hybrid.ts exactly (wire-compatible).
//
// The hook does NOT open() — opening is server-side (the secret key
// never reaches the browser). To open, POST the frame to /api/crypto/open
// (admin) which unwraps the recipient secret under RMPG_PQ_MASTER_KEY
// and returns the plaintext.
// ============================================================

import { useCallback, useRef, useState } from 'react';
import { apiFetch } from './useApi';
import { seal as pqSeal, b64encode, b64decode, looksLikeSealedFrame, utf8, hybridVerify } from '../utils/pqCrypto';

interface RecipientPublic {
  id: string;
  publicKey: string; // base64, hybrid KEM public key
  algorithm: string;
  signature?: string;         // base64 hybrid signature over the public key bytes
  signingPublicKey?: { ed25519: string; mlDsa65: string }; // base64
}

const SIGNING_KEY_PIN = 'rmpg_pq_signing_pub_pin';

export interface SealInput {
  /** Plaintext bytes to seal. */
  plaintext: Uint8Array;
  /** Optional authenticated-but-not-encrypted binding (e.g. `evidence:42`). */
  aad?: string;
}

export interface SealOutput {
  /** base64 RMPGSEAL frame, ready to POST to the Worker for at-rest storage. */
  frame: string;
  /** The recipient identity id the frame was sealed to. */
  recipientId: string;
}

export function usePqSeal() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recipientRef = useRef<RecipientPublic | null>(null);

  /** Fetch (and memoize) the org recipient public key. Pass an officer
   *  userId to seal to a specific officer instead of the org identity. */
  const ensureRecipient = useCallback(
    async (officerUserId?: number): Promise<RecipientPublic> => {
      if (recipientRef.current) return recipientRef.current;
      const endpoint = officerUserId
        ? `/crypto/officer/${officerUserId}/encryption/public`
        : '/crypto/identities/encryption/public';
      const r = await apiFetch<RecipientPublic>(endpoint);

      // MITM defense: verify the returned encryption public key is signed
      // by the org signing identity. If a MITM swapped the public key, they'd
      // need to also re-sign it (requires the signing secret, wrapped by
      // RMPG_PQ_MASTER_KEY). TOFU: pin the signing public key on first fetch.
      if (r.signature && r.signingPublicKey) {
        const pubBytes = b64decode(r.publicKey);
        const sigBytes = b64decode(r.signature);
        const edPub = b64decode(r.signingPublicKey.ed25519);
        const pqPub = b64decode(r.signingPublicKey.mlDsa65);
        const valid = hybridVerify(sigBytes, pubBytes, edPub, pqPub);
        if (!valid) {
          throw new Error('Encryption public key failed signature verification — possible MITM. Refusing to seal.');
        }
        // TOFU: pin the signing public key so a future MITM can't swap it.
        const pin = JSON.stringify(r.signingPublicKey);
        const stored = localStorage.getItem(SIGNING_KEY_PIN);
        if (stored && stored !== pin) {
          throw new Error('Signing public key changed since last fetch — possible MITM. Refusing to seal. Clear rmpg_pq_signing_pub_pin if the key was legitimately rotated.');
        }
        if (!stored) {
          localStorage.setItem(SIGNING_KEY_PIN, pin);
        }
      }
      // If no signature is present (signing identity not provisioned), seal
      // anyway but the caller should warn the officer that the key is unsigned.

      recipientRef.current = r;
      return r;
    },
    [],
  );

  /** Pre-warm the recipient cache (e.g. on page mount) so the first seal
   *  doesn't pay the fetch latency. Fails silently — the first seal will
   *  retry the fetch. */
  const prewarm = useCallback(
    async (officerUserId?: number): Promise<void> => {
      try { await ensureRecipient(officerUserId); } catch { /* lazy retry on seal */ }
    },
    [ensureRecipient],
  );

  /** Seal one payload. Returns a base64 RMPGSEAL frame. */
  const seal = useCallback(
    async (input: SealInput, officerUserId?: number): Promise<SealOutput> => {
      setIsLoading(true);
      setError(null);
      try {
        const recipient = await ensureRecipient(officerUserId);
        const aad = input.aad ? utf8(input.aad) : undefined;
        const { frame } = await pqSeal(input.plaintext, recipient.publicKey, aad);
        if (!looksLikeSealedFrame(frame)) {
          // Defensive: the local seal() should always produce a valid frame.
          throw new Error('local seal produced an invalid frame');
        }
        return { frame: b64encode(frame), recipientId: recipient.id };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Seal failed';
        setError(message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [ensureRecipient],
  );

  /** Convenience: seal a UTF-8 string (a JSON blob, a narrative). */
  const sealText = useCallback(
    async (text: string, aad?: string, officerUserId?: number): Promise<SealOutput> =>
      seal({ plaintext: utf8(text), aad }, officerUserId),
    [seal],
  );

  /** Convenience: seal a File (an evidence photo, a recording). Reads
   *  the whole file into memory — fine for typical evidence sizes; for
   *  very large media the caller should chunk first. */
  const sealFile = useCallback(
    async (file: File, aad?: string, officerUserId?: number): Promise<SealOutput> => {
      const buf = new Uint8Array(await file.arrayBuffer());
      return seal({ plaintext: buf, aad }, officerUserId);
    },
    [seal],
  );

  /** Decode a base64 frame back to bytes (for inspecting / forwarding).
   *  Does NOT decrypt — opening is server-side only. */
  const decodeFrame = useCallback((frameB64: string): Uint8Array => b64decode(frameB64), []);

  return { seal, sealText, sealFile, prewarm, decodeFrame, isLoading, error };
}

export default usePqSeal;
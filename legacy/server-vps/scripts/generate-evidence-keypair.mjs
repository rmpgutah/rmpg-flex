#!/usr/bin/env node
// ============================================================
// generate-evidence-keypair.mjs
// ============================================================
// Mints a fresh Ed25519 keypair for the dashcam-AI evidence
// signing chain. Outputs the two values as base64 strings, ready
// to drop into server/.env:
//
//   EVIDENCE_SIGNING_PRIVATE_KEY=<...>
//   EVIDENCE_SIGNING_PUBLIC_KEY=<...>
//
// Usage:
//   node server/scripts/generate-evidence-keypair.mjs
//
// IMPORTANT — handling private keys:
//   * Treat the private key as you would JWT_SECRET.
//   * Once committed to .env on the production VPS, NEVER rotate
//     unless you understand what it breaks: rotating the keypair
//     means evidence_hashes rows signed with the OLD private key
//     can still be verified with the OLD public key (preserved
//     in evidence_hashes.signer per row), but new rows are signed
//     with the new key. Keep both keys archived for audit.
//   * The public key is published to the DA as part of the
//     prosecutor export. Distributing it widely is fine — it's
//     for verification only, not signing.

import crypto from 'node:crypto';

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');

const pubB64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const privB64 = privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');

console.log('# Drop these into server/.env');
console.log('# Generated:', new Date().toISOString());
console.log();
console.log(`EVIDENCE_SIGNING_PUBLIC_KEY=${pubB64}`);
console.log(`EVIDENCE_SIGNING_PRIVATE_KEY=${privB64}`);
console.log();
console.log('# After saving, restart the server. New evidence_hashes rows will be');
console.log('# signed; older rows remain unsigned (audit will flag them).');

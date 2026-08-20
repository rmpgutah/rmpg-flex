import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { encryptField, decryptFieldIfEncrypted, EmailFieldEncryptionError } from '../src/utils/emailFieldCrypto';

const TEST_KEK = 'MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI=';

describe('email_scheduled body/recipients encryption contract', () => {
  it('body round-trips through encryptField/decryptFieldIfEncrypted', async () => {
    const env = { EMAIL_FIELD_ENCRYPTION_KEK: TEST_KEK };
    const original = 'Please review the attached warrant packet before Friday.';
    const stored = await encryptField(env, original);
    expect(await decryptFieldIfEncrypted(env, stored)).toBe(original);
  });

  it('to_addresses (JSON array as a string) round-trips', async () => {
    const env = { EMAIL_FIELD_ENCRYPTION_KEK: TEST_KEK };
    const original = JSON.stringify(['officer1@rmpgutah.us', 'officer2@rmpgutah.us']);
    const stored = await encryptField(env, original);
    const readBack = await decryptFieldIfEncrypted(env, stored);
    expect(JSON.parse(readBack)).toEqual(['officer1@rmpgutah.us', 'officer2@rmpgutah.us']);
  });
});

describe('POST /schedule and drainScheduledEmails wiring', () => {
  it('POST /schedule encrypts body/to_addresses/cc_addresses before the INSERT', () => {
    const src = readFileSync(new URL('../src/routes/email.ts', import.meta.url), 'utf-8');
    const handlerMatch = src.match(/email\.post\('\/schedule'[\s\S]*?\n}\);/);
    expect(handlerMatch).toBeTruthy();
    const handlerSrc = handlerMatch![0];
    expect(handlerSrc).toMatch(/encryptField/);
  });

  it('drainScheduledEmails decrypts before building the Graph payload', () => {
    const src = readFileSync(new URL('../src/routes/email.ts', import.meta.url), 'utf-8');
    const fnMatch = src.match(/export async function drainScheduledEmails[\s\S]*?\n}/);
    expect(fnMatch).toBeTruthy();
    const fnSrc = fnMatch![0];
    expect(fnSrc).toMatch(/decryptFieldIfEncrypted/);
  });
});

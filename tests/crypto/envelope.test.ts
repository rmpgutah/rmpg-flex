import { describe, it, expect } from 'vitest';
import {
  encryptField,
  decryptField,
  encryptBytes,
  decryptBytes,
  isEncrypted,
  wrapDek,
  unwrapDek,
  b64encode,
  randomBytes,
} from '../../src/utils/crypto';

const KEY = b64encode(randomBytes(32));

describe('symmetric envelope (data-at-rest)', () => {
  it('round-trips a UTF-8 field as enc-v2:iv:ct', async () => {
    const pt = 'SSN-like sensitive value 999-99-9999';
    const ct = await encryptField(pt, KEY);
    expect(ct.startsWith('enc-v3:')).toBe(true);
    expect(isEncrypted(ct)).toBe(true);
    expect(await decryptField(ct, KEY)).toBe(pt);
  });

  it('round-trips raw bytes', async () => {
    const pt = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const ct = await encryptBytes(pt, KEY);
    expect(await decryptBytes(ct, KEY)).toEqual(pt);
  });

  it('fails closed with the wrong master key', async () => {
    const ct = await encryptField('x', KEY);
    const other = b64encode(randomBytes(32));
    await expect(decryptField(ct, other)).rejects.toThrow();
  });

  it('is non-deterministic (fresh IV per call)', async () => {
    const a = await encryptField('same', KEY);
    const b = await encryptField('same', KEY);
    expect(a).not.toBe(b);
    expect(await decryptField(a, KEY)).toBe('same');
  });

  it('binds optional AAD on encrypt and decrypt', async () => {
    const ct = await encryptBytes(new TextEncoder().encode('v'), KEY, new TextEncoder().encode('aad-1'));
    await expect(decryptBytes(ct, KEY, new TextEncoder().encode('aad-1'))).resolves.toBeDefined();
    await expect(decryptBytes(ct, KEY, new TextEncoder().encode('aad-2'))).rejects.toThrow();
  });
});

describe('DEK wrap / unwrap (crypto-shredding primitive)', () => {
  it('wraps a fresh 32-byte DEK and unwraps it back', async () => {
    const { dek, wrapped } = await wrapDek(KEY);
    expect(dek.length).toBe(32);
    expect(isEncrypted(wrapped)).toBe(true);
    const back = await unwrapDek(KEY, wrapped);
    expect(back).toEqual(dek);
  });

  it('two wrapped DEKs are independent', async () => {
    const a = await wrapDek(KEY);
    const b = await wrapDek(KEY);
    expect(a.dek).not.toEqual(b.dek);
  });
});
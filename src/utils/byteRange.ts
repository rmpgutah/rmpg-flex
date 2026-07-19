// Serves an HTTP Range request out of an in-memory plaintext buffer. Used by
// routes that decrypt a whole object (via encryptedR2.ts's getDecrypted)
// before it can be range-served — AES-GCM ciphertext can't be range-fetched
// from R2 directly since the auth tag covers the whole ciphertext.
export function sliceByteRange(
  bytes: Uint8Array,
  range: { start: number; end: number } | null,
): { data: Uint8Array; start: number; end: number; total: number } {
  const total = bytes.length;
  if (!range) {
    return { data: bytes, start: 0, end: total - 1, total };
  }
  const start = Math.max(0, range.start);
  const end = range.end < 0 ? total - 1 : Math.min(range.end, total - 1);
  return { data: bytes.slice(start, end + 1), start, end, total };
}

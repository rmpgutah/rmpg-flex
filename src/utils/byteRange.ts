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

// ============================================================
// R2 range reads
// ============================================================
// R2's get() THROWS on every unsatisfiable range rather than returning null.
// Verified empirically against Miniflare/workerd (2026-08-02):
//
//   { offset: 10, length: -5 }      RangeError: Invalid range. Length (-5)...
//   { offset: >= size }             Error: get: The requested range is not
//   { offset: >= size, length: n }    satisfiable (10039)
//   { offset: n, length: 0 }        ... not satisfiable (10039)
//   { offset: n, length: > remaining }   OK — clamps to EOF
//
// So ANY route that forwards a client-supplied Range straight to R2 without
// catching turns a malformed request into an HTTP 500. That is a client
// error: it pollutes error_log and can trip alerting, and it tells the caller
// nothing it can act on. RFC 9110 wants 416 with "Content-Range: bytes
// */<size>" so the client learns the real length and can re-request.
//
// Two shapes reach R2 from a `bytes=start-end` header, and BOTH underflow:
//   start > end          e.g. "bytes=100-50"       -> negative length
//   start past EOF       e.g. "bytes=99999999999-" -> end clamps, start
//                                                     doesn't, so the clamp
//                                                     guards only one side
// Route the read through getR2Range() instead of calling bucket.get() with a
// client range directly.

/** True for the R2 errors that mean "this range can never be served". */
export function isUnsatisfiableRangeError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  // RangeError covers the negative/invalid length form; the 10039 code (and
  // its message) covers offset-past-EOF and zero-length.
  return err instanceof RangeError
    || err.message.includes('not satisfiable')
    || err.message.includes('10039')
    || err.message.includes('Invalid range');
}

export type R2RangeResult =
  /** Object found and the range (or whole body) is readable. */
  | { kind: 'ok'; obj: R2ObjectBody }
  /** No such object. Callers answer 404. */
  | { kind: 'missing' }
  /** Object exists but the range can't be served. Callers answer 416. */
  | { kind: 'unsatisfiable'; total: number | null };

/**
 * bucket.get() with a client-supplied range, mapping R2's throw-on-bad-range
 * into a value the caller can turn into a 416 instead of a 500.
 *
 * `total` on the unsatisfiable result comes from a head() issued ONLY on the
 * failure path, so the happy path still costs exactly one R2 operation. It is
 * null if that head also fails, in which case the caller should omit
 * Content-Range rather than emit a wrong one.
 */
export async function getR2Range(
  bucket: R2Bucket,
  key: string,
  range?: R2Range,
): Promise<R2RangeResult> {
  try {
    const obj = await bucket.get(key, range ? { range } : undefined);
    return obj ? { kind: 'ok', obj: obj as R2ObjectBody } : { kind: 'missing' };
  } catch (err) {
    if (!isUnsatisfiableRangeError(err)) throw err;
    let total: number | null = null;
    try {
      const head = await bucket.head(key);
      // A range against an object that isn't there is a 404, not a 416 —
      // "unsatisfiable" only means anything relative to a real length.
      if (!head) return { kind: 'missing' };
      total = head.size;
    } catch {
      total = null;
    }
    return { kind: 'unsatisfiable', total };
  }
}

/** Standard 416 body + headers. `total` null omits Content-Range. */
export function rangeNotSatisfiableInit(total: number | null): {
  body: { error: string };
  status: 416;
  headers: Record<string, string>;
} {
  const headers: Record<string, string> = { 'Accept-Ranges': 'bytes' };
  if (total !== null) headers['Content-Range'] = `bytes */${total}`;
  return { body: { error: 'range not satisfiable' }, status: 416, headers };
}

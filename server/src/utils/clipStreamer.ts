// ============================================================
// HTTP Range request parsing for evidence-clip streaming
// ============================================================
// Pure functions only — testable without the HTTP layer. The
// route handler in server/src/routes/drivingEvents.ts pulls
// these in to compute the right Content-Range and slice bytes
// from the StorageAdapter.

export interface RangeHeader {
  start: number | null;
  end: number | null;
}

export interface RangeSlice {
  start: number;
  end: number;
  length: number;
  partial: boolean;
  notSatisfiable?: boolean;
}

/**
 * Parse a single-range HTTP Range header per RFC 7233.
 * Returns null for missing/malformed/multi-range headers (we
 * don't bother with multipart/byteranges responses).
 */
export function parseRangeHeader(value: string | undefined | null): RangeHeader | null {
  if (!value) return null;

  // Multi-range — bail (server returns full content, browser falls
  // back to single-range request)
  if (value.includes(',')) return null;

  const m = value.match(/^bytes=(\d*)-(\d*)$/);
  if (!m) return null;

  const startStr = m[1];
  const endStr = m[2];

  if (startStr === '' && endStr === '') return null;

  const start = startStr === '' ? null : Number(startStr);
  const end = endStr === '' ? null : Number(endStr);

  if (start !== null && !Number.isInteger(start)) return null;
  if (end !== null && !Number.isInteger(end)) return null;

  return { start, end };
}

/**
 * Compute the actual byte slice given a parsed Range and the
 * total file size. Returns notSatisfiable=true when the range
 * is invalid relative to the file (route handler maps this to
 * HTTP 416).
 *
 *   bytes=0-99    file=1000  → start=0,   end=99,  partial=true
 *   bytes=100-    file=1000  → start=100, end=999, partial=true
 *   bytes=-500    file=1000  → start=500, end=999, partial=true (suffix)
 *   bytes=900-999 file=1000  → start=900, end=999, partial=true
 *   bytes=5000-   file=1000  → notSatisfiable=true
 *   no range      file=1000  → start=0,   end=999, partial=false
 */
export function computeRangeSlice(range: RangeHeader | null, fileSize: number): RangeSlice {
  if (!range) {
    return { start: 0, end: fileSize - 1, length: fileSize, partial: false };
  }

  let start: number;
  let end: number;

  if (range.start === null && range.end !== null) {
    // Suffix: bytes=-N → last N bytes
    const suffixLen = range.end;
    start = Math.max(0, fileSize - suffixLen);
    end = fileSize - 1;
  } else if (range.start !== null && range.end === null) {
    // Open-ended: bytes=N-
    start = range.start;
    end = fileSize - 1;
  } else if (range.start !== null && range.end !== null) {
    start = range.start;
    end = Math.min(range.end, fileSize - 1);
  } else {
    // Both null — shouldn't happen given parseRangeHeader, but defensive
    return { start: 0, end: fileSize - 1, length: fileSize, partial: false, notSatisfiable: true };
  }

  if (start >= fileSize || start < 0 || start > end) {
    return { start: 0, end: 0, length: 0, partial: true, notSatisfiable: true };
  }

  return {
    start,
    end,
    length: end - start + 1,
    partial: true,
  };
}

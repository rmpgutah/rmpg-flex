// src/utils/footage/integrity.ts
//
// Pure download-integrity helpers. The orchestrator's downloadAndPersist
// path uses these to ensure every chunk that lands in 'downloaded' status
// is (1) a real MP4 the player will actually decode, and (2) byte-content
// unique within its request (catches re-signed signed-URLs that point at
// the same underlying file — URL-level dedup misses these).
//
// Why pure: the validation rules are simple and deterministic; testing
// them in vitest avoids needing Miniflare for the integrity guarantees.

/** Returns true iff `bytes` look like a real MP4 (ISO Base Media File Format).
 *  All MP4s start with an 'ftyp' box: 4-byte big-endian size + 4-byte type
 *  'ftyp' + brand info. We just need the 4-char 'ftyp' marker at offset 4 —
 *  rejecting JSON/HTML error bodies served as binary, truncated downloads
 *  that lost their header, and any other non-MP4 bytes the vendor might
 *  hand us by mistake. */
export function validateMp4Header(bytes: Uint8Array): boolean {
  if (!bytes || bytes.length < 8) return false;
  return bytes[4] === 0x66 /* f */
      && bytes[5] === 0x74 /* t */
      && bytes[6] === 0x79 /* y */
      && bytes[7] === 0x70 /* p */;
}

/** True iff `newSha` exactly matches any hash in `existingShas`. Used to
 *  reject a freshly-downloaded chunk whose bytes are byte-identical to a
 *  chunk already stored for the same request — the case PR #1524's URL
 *  dedup misses when ClearPath re-signs the same underlying file. */
export function isDuplicateContent(newSha: string, existingShas: string[]): boolean {
  if (!newSha) return false;
  return existingShas.includes(newSha);
}

/** Log-friendly rejection reason. Stable strings so log scrapes and
 *  downstream dashboards can categorize without parsing English. */
export type RejectionKind = 'not_mp4' | 'duplicate_content' | 'size_mismatch';

export function formatRejectionReason(kind: RejectionKind): string {
  switch (kind) {
    case 'not_mp4':            return 'not a valid mp4 (ftyp missing)';
    case 'duplicate_content':  return 'duplicate content (sha256 matches another chunk)';
    case 'size_mismatch':      return 'size mismatch (truncated download)';
  }
}

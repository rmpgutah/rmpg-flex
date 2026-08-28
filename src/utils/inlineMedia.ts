/** Normalize browser-hostile audio MIME labels so <audio> / MediaSource can play. */
export function playbackContentType(mime: string | null | undefined, filename?: string | null): string {
  const m = (mime || '').trim().toLowerCase();
  const name = (filename || '').toLowerCase();
  if (m === 'audio/mp3' || m === 'audio/x-mpeg' || m === 'audio/x-mp3' || name.endsWith('.mp3')) {
    return 'audio/mpeg';
  }
  if (m === 'audio/x-wav' || name.endsWith('.wav')) return 'audio/wav';
  if (m === 'audio/x-ogg' || name.endsWith('.ogg')) return 'audio/ogg';
  return m || 'application/octet-stream';
}

export function isInlineAudio(mime: string | null | undefined, filename?: string | null): boolean {
  const type = playbackContentType(mime, filename);
  return type.startsWith('audio/');
}

export type ByteRange = { start: number; end: number };

/** Parse a single `bytes=start-end` Range. `null` = send the whole object. */
export function parseBytesRange(header: string | undefined | null, total: number): ByteRange | 'unsatisfiable' | null {
  if (!header || total <= 0) return null;
  const m = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!m) return null;
  const hasStart = m[1] !== '';
  const hasEnd = m[2] !== '';
  if (!hasStart && !hasEnd) return 'unsatisfiable';
  let start: number;
  let end: number;
  if (!hasStart) {
    const suffix = Number(m[2]);
    if (!Number.isFinite(suffix) || suffix <= 0) return 'unsatisfiable';
    start = Math.max(0, total - suffix);
    end = total - 1;
  } else {
    start = Number(m[1]);
    end = hasEnd ? Number(m[2]) : total - 1;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0) return 'unsatisfiable';
    if (end >= total) end = total - 1;
    if (start > end || start >= total) return 'unsatisfiable';
  }
  return { start, end };
}

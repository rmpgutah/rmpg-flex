// Thin wrapper over mp4box.js. Keeps the dependency boundary explicit
// so concat.ts stays deps-free. Exposes one async helper:
//   remuxMp4SegmentsToFmp4(segments) → { bytes, sha256 }
//
// All translation of mp4box's event-driven API into a Promise lives
// here. Callers (concat.ts:remuxMp4ToFmp4) deal in Uint8Array in,
// Uint8Array out + a sha256 string.
//
// mp4box v2.4.1 exports `createFile` as a named export (no default).

import { createFile } from 'mp4box';

export class Mp4BoxError extends Error {
  code: 'mp4box_parse_failed' | 'mp4box_no_tracks' | 'mp4box_segment_failed';
  constructor(code: Mp4BoxError['code'], message: string) {
    super(message);
    this.code = code;
    this.name = 'Mp4BoxError';
  }
}

export interface RemuxResult {
  bytes: Uint8Array;
  sha256: string;
}

export async function remuxMp4SegmentsToFmp4(segments: Uint8Array[]): Promise<RemuxResult> {
  if (segments.length === 0) {
    throw new Mp4BoxError('mp4box_no_tracks', 'no input segments');
  }

  // Output collector. mp4box emits an init segment + per-fragment buffers.
  const outChunks: Uint8Array[] = [];
  let readyFired = false;

  // Cast to `any` — mp4box's typed API is enormous and event-driven; the
  // wrapper boundary is the right place to keep `any` localized.
  const file = createFile() as any;

  await new Promise<void>((resolvePromise, rejectPromise) => {
    file.onError = (err: string) => {
      rejectPromise(new Mp4BoxError('mp4box_parse_failed', err));
    };
    file.onReady = (info: { tracks: Array<{ id: number }> }) => {
      readyFired = true;
      if (!info.tracks?.length) {
        rejectPromise(new Mp4BoxError('mp4box_no_tracks', 'no tracks'));
        return;
      }
      try {
        for (const t of info.tracks) {
          file.setSegmentOptions(t.id, null, { nbSamples: 100 });
        }
        // mp4box v2.4.x: default (`combined`) mode returns a single
        // { tracks, buffer } object; `per-track` returns an array of
        // { id, user, buffer }. We use `per-track` for a uniform iterable.
        const initSegs = file.initializeSegmentation('per-track');
        for (const s of initSegs) outChunks.push(new Uint8Array(s.buffer));
        file.start();
      } catch (err) {
        rejectPromise(new Mp4BoxError('mp4box_segment_failed', String(err)));
      }
    };
    file.onSegment = (_id: number, _user: unknown, buffer: ArrayBuffer) => {
      outChunks.push(new Uint8Array(buffer));
    };

    // mp4box requires each appended buffer to have a `fileStart` property.
    try {
      let offset = 0;
      for (const seg of segments) {
        const ab = seg.buffer.slice(
          seg.byteOffset,
          seg.byteOffset + seg.byteLength,
        ) as ArrayBuffer & { fileStart?: number };
        ab.fileStart = offset;
        file.appendBuffer(ab);
        offset += seg.byteLength;
      }
      file.flush();
      // If onReady never fired, mp4box silently failed to parse the input —
      // treat as a parse failure so callers get a typed error.
      if (!readyFired) {
        rejectPromise(
          new Mp4BoxError('mp4box_parse_failed', 'mp4box did not fire onReady'),
        );
        return;
      }
      resolvePromise();
    } catch (err) {
      rejectPromise(new Mp4BoxError('mp4box_segment_failed', String(err)));
    }
  });

  if (outChunks.length === 0) {
    throw new Mp4BoxError('mp4box_segment_failed', 'no output produced');
  }

  const totalLen = outChunks.reduce((s, b) => s + b.byteLength, 0);
  const bytes = new Uint8Array(totalLen);
  let pos = 0;
  for (const b of outChunks) {
    bytes.set(b, pos);
    pos += b.byteLength;
  }

  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const sha256 = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return { bytes, sha256 };
}

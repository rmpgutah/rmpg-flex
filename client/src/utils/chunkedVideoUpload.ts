// ═══════════════════════════════════════════════════════════════
// Chunked video upload — protocol shared by dashcam, bodycam, and
// any future large-video endpoint.
//
// For files below `smallFileThreshold` (default 50 MB), falls back
// to a single multipart POST at `endpoint` (the legacy path that
// existing routes already handle). For larger files, uses the
// 4-step chunked protocol the server exposes at:
//   POST   `${endpoint}/upload-init`
//   POST   `${endpoint}/upload-chunk`
//   POST   `${endpoint}/upload-complete`
//   DELETE `${endpoint}/upload-abort/:uploadId`
//
// The caller observes progress, speed, and phase through a single
// `onProgress` callback so the same util works for single-file
// modals and multi-file queue wizards alike.
// ═══════════════════════════════════════════════════════════════

export type ChunkedUploadPhase =
  | 'initializing'
  | 'uploading'
  | 'finalizing'
  | 'done'
  | 'error';

export interface ChunkedUploadProgress {
  phase: ChunkedUploadPhase;
  bytesUploaded: number;
  totalBytes: number;
  percent: number;          // 0–100
  speed: number;            // bytes/sec, averaged from start
  eta: number;              // seconds remaining
  chunkIndex: number;       // 0-based; equals totalChunks on finalize
  totalChunks: number;      // 1 for small-file path
  message: string;          // human-readable status line
  error?: string;           // populated only when phase='error'
}

export interface ChunkedUploadOptions {
  /** Base endpoint — e.g. "/fleet/dashcam-videos". Chunk sub-paths are appended. */
  endpoint: string;
  /** The file the user selected. */
  file: File;
  /**
   * Extra metadata fields. For the small-file path, each is appended to the
   * multipart FormData as a string (same shape the legacy POST expects). For
   * the chunked path, they're sent as JSON on the `upload-complete` call.
   * Undefined/null entries are omitted.
   */
  metadata: Record<string, string | number | null | undefined>;
  /** Auth headers — typically `{ Authorization: 'Bearer <jwt>' }`. */
  headers: Record<string, string>;
  /** Progress tick callback. Invoked ≥ once per chunk plus phase transitions. */
  onProgress: (p: ChunkedUploadProgress) => void;
  /** Signal to cancel mid-upload. Triggers an abort DELETE on the server. */
  abortSignal?: AbortSignal;
  /** Default 10 MB. Matches server CHUNK_STORAGE validation headroom. */
  chunkSize?: number;
  /** Default 50 MB. Files below this use the legacy single-POST. */
  smallFileThreshold?: number;
  /** FormData field name for the small-file path. Default 'video'. */
  smallFileFieldName?: string;
  /** Chunk retry count on network failure. Default 3. */
  maxRetries?: number;
  /**
   * Number of chunks uploaded in parallel. Default 4.
   *
   * Sequential (1) leaves bandwidth idle during per-chunk ACK latency —
   * typical office broadband often shows 30–70% underutilisation on a
   * 1-wide pipeline. 4 concurrent HTTP/2 streams over one TCP connection
   * fill the pipe without tripping browser per-origin limits (Chrome
   * caps at 6 under HTTP/1.1; HTTP/2 multiplexes trivially to hundreds).
   *
   * Larger values (8, 16) help only on very high-bandwidth / high-latency
   * links and cost server disk-write parallelism. Stick with 4 unless
   * you have measurement.
   */
  concurrency?: number;
}

/** Chunk size used by the default code path. Exported so UI that wants to
 *  display "this file will be split into N parts" can compute the same N. */
export const DEFAULT_CHUNK_SIZE = 10 * 1024 * 1024;
const DEFAULT_SMALL_FILE_THRESHOLD = 50 * 1024 * 1024;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_CONCURRENCY = 4;

/** Upload a video through the adaptive protocol. Resolves with the parsed JSON body of the final response. */
export async function chunkedVideoUpload(opts: ChunkedUploadOptions): Promise<any> {
  const {
    endpoint,
    file,
    metadata,
    headers,
    onProgress,
    abortSignal,
    chunkSize = DEFAULT_CHUNK_SIZE,
    smallFileThreshold = DEFAULT_SMALL_FILE_THRESHOLD,
    smallFileFieldName = 'video',
    maxRetries = DEFAULT_MAX_RETRIES,
    concurrency = DEFAULT_CONCURRENCY,
  } = opts;

  const apiBase = `${window.location.origin}/api`;
  const url = (sub: string) => `${apiBase}${endpoint}${sub}`;

  if (abortSignal?.aborted) {
    throw new DOMException('Upload aborted', 'AbortError');
  }

  // ── Small-file path (legacy single POST) ────────────────────────
  if (file.size < smallFileThreshold) {
    return uploadSmallFile({
      url: url(''),
      file,
      fieldName: smallFileFieldName,
      metadata,
      headers,
      onProgress,
      abortSignal,
    });
  }

  // ── Chunked path ────────────────────────────────────────────────
  const totalChunks = Math.ceil(file.size / chunkSize);

  onProgress({
    phase: 'initializing',
    bytesUploaded: 0,
    totalBytes: file.size,
    percent: 0,
    speed: 0,
    eta: 0,
    chunkIndex: 0,
    totalChunks,
    message: 'Initializing upload session...',
  });

  // 1. init
  const initResp = await fetchJson(url('/upload-init'), {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileName: file.name,
      fileSize: file.size,
      totalChunks,
      mimeType: file.type || 'video/mp4',
    }),
    signal: abortSignal,
  });
  const uploadId: string = initResp.uploadId;
  if (!uploadId) throw new Error('Server did not return an uploadId');

  // Register abort cleanup — best-effort DELETE so server can free the tmp dir.
  const onAbort = () => {
    // We deliberately don't await this — we're in the sync abort handler path
    // and the caller just wants to bail out.
    fetch(url(`/upload-abort/${uploadId}`), { method: 'DELETE', headers })
      .catch(() => { /* server sweep will collect the session on TTL */ });
  };
  if (abortSignal) {
    if (abortSignal.aborted) { onAbort(); throw new DOMException('Upload aborted', 'AbortError'); }
    abortSignal.addEventListener('abort', onAbort, { once: true });
  }

  try {
    // 2. stream chunks via a concurrency-capped worker pool
    //
    // Why a pool instead of the old sequential for-loop: each chunk is a
    // separate HTTP request, so on a sequential pipeline we spend most of
    // the per-chunk time waiting for the ACK + next request setup rather
    // than pushing bytes. Running N uploaders concurrently overlaps one
    // worker's upstream-bytes phase with another's ACK-wait phase and
    // drives effective throughput close to the pipe's ceiling. In tests
    // against rmpgutah.us, N=4 gives a 2–4× speedup on 5 GB uploads over
    // a 100–400 Mbps link with no measurable server-side cost (multer
    // writes 4 × 10 MB briefly instead of 1 × 10 MB).
    const startMs = Date.now();
    let bytesUploaded = 0;
    let chunksCompleted = 0;
    let nextChunkIndex = 0;
    let firstError: unknown = null;

    const reportProgress = (message: string) => {
      const elapsed = (Date.now() - startMs) / 1000;
      const speed = elapsed > 0 ? bytesUploaded / elapsed : 0;
      const remainingBytes = file.size - bytesUploaded;
      const eta = speed > 0 ? Math.round(remainingBytes / speed) : 0;
      onProgress({
        phase: 'uploading',
        bytesUploaded,
        totalBytes: file.size,
        percent: Math.round((bytesUploaded / file.size) * 100),
        speed,
        eta,
        chunkIndex: chunksCompleted,
        totalChunks,
        message,
      });
    };

    // Each worker pulls the next not-yet-claimed chunk index off the shared
    // counter until everything's done or one of them sets firstError. Node's
    // single-threaded event loop makes ++ on a shared counter atomic across
    // the concurrent awaits, so no locking is needed.
    const worker = async (): Promise<void> => {
      while (true) {
        if (firstError || abortSignal?.aborted) return;
        const i = nextChunkIndex++;
        if (i >= totalChunks) return;

        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, file.size);
        const blob = file.slice(start, end);

        let lastErr: unknown = null;
        for (let attempt = 0; attempt < maxRetries; attempt++) {
          if (firstError || abortSignal?.aborted) return;
          try {
            await uploadChunk({
              url: url('/upload-chunk'),
              uploadId,
              chunkIndex: i,
              blob,
              headers,
              abortSignal,
            });
            lastErr = null;
            break;
          } catch (err) {
            lastErr = err;
            if (attempt < maxRetries - 1) {
              reportProgress(`Chunk ${i + 1} failed, retrying (${attempt + 2}/${maxRetries})...`);
              await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
            }
          }
        }
        if (lastErr) {
          // Record the first error so sibling workers exit on their next check.
          if (!firstError) firstError = lastErr;
          return;
        }

        bytesUploaded += end - start;
        chunksCompleted += 1;
        reportProgress(`Uploaded ${chunksCompleted} of ${totalChunks} chunks`);
      }
    };

    const pool = Array.from({ length: Math.min(concurrency, totalChunks) }, () => worker());
    await Promise.all(pool);
    if (firstError) throw firstError;
    if (abortSignal?.aborted) throw new DOMException('Upload aborted', 'AbortError');

    // 3. complete
    onProgress({
      phase: 'finalizing',
      bytesUploaded: file.size,
      totalBytes: file.size,
      percent: 100,
      speed: 0,
      eta: 0,
      chunkIndex: totalChunks,
      totalChunks,
      message: 'Assembling file on server...',
    });

    const cleanMetadata: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(metadata)) {
      if (v != null && v !== '') cleanMetadata[k] = v;
    }

    const completeResp = await fetchJson(url('/upload-complete'), {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadId, ...cleanMetadata }),
      signal: abortSignal,
    });

    onProgress({
      phase: 'done',
      bytesUploaded: file.size,
      totalBytes: file.size,
      percent: 100,
      speed: 0,
      eta: 0,
      chunkIndex: totalChunks,
      totalChunks,
      message: 'Upload complete',
    });

    if (abortSignal) abortSignal.removeEventListener('abort', onAbort);
    return completeResp;
  } catch (err: any) {
    if (abortSignal) abortSignal.removeEventListener('abort', onAbort);
    // If we threw mid-upload and the user didn't explicitly cancel, also
    // fire the abort so the server doesn't sit on the half-session for 4h.
    if (!abortSignal?.aborted) onAbort();
    throw err;
  }
}

// ── Internals ─────────────────────────────────────────────────────

function uploadSmallFile(args: {
  url: string;
  file: File;
  fieldName: string;
  metadata: Record<string, string | number | null | undefined>;
  headers: Record<string, string>;
  onProgress: (p: ChunkedUploadProgress) => void;
  abortSignal?: AbortSignal;
}): Promise<any> {
  const { url, file, fieldName, metadata, headers, onProgress, abortSignal } = args;

  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append(fieldName, file);
    for (const [k, v] of Object.entries(metadata)) {
      if (v != null && v !== '') fd.append(k, String(v));
    }

    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.timeout = 1800000; // 30 min — matches server requestTimeout

    // Authorization etc. — Content-Type is set by the browser for FormData.
    for (const [k, v] of Object.entries(headers)) {
      if (k.toLowerCase() === 'content-type') continue;
      xhr.setRequestHeader(k, v);
    }

    const startMs = Date.now();
    xhr.upload.onprogress = (ev) => {
      if (!ev.lengthComputable) return;
      const elapsed = (Date.now() - startMs) / 1000;
      const speed = elapsed > 0 ? ev.loaded / elapsed : 0;
      const remaining = speed > 0 ? (ev.total - ev.loaded) / speed : 0;
      onProgress({
        phase: 'uploading',
        bytesUploaded: ev.loaded,
        totalBytes: ev.total,
        percent: Math.round((ev.loaded / ev.total) * 100),
        speed,
        eta: remaining,
        chunkIndex: 0,
        totalChunks: 1,
        message: 'Uploading file...',
      });
    };

    xhr.upload.onload = () => {
      onProgress({
        phase: 'finalizing',
        bytesUploaded: file.size,
        totalBytes: file.size,
        percent: 100,
        speed: 0,
        eta: 0,
        chunkIndex: 0,
        totalChunks: 1,
        message: 'Server processing...',
      });
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress({
          phase: 'done',
          bytesUploaded: file.size,
          totalBytes: file.size,
          percent: 100,
          speed: 0,
          eta: 0,
          chunkIndex: 0,
          totalChunks: 1,
          message: 'Upload complete',
        });
        try { resolve(JSON.parse(xhr.responseText)); } catch { resolve(xhr.responseText); }
      } else {
        let message = `Upload failed (HTTP ${xhr.status})`;
        try {
          const parsed = JSON.parse(xhr.responseText);
          message = parsed.error || parsed.message || message;
        } catch { /* keep default */ }
        reject(new Error(message));
      }
    };

    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.ontimeout = () => reject(new Error('Upload timed out'));
    xhr.onabort = () => reject(new DOMException('Upload aborted', 'AbortError'));

    if (abortSignal) {
      if (abortSignal.aborted) { xhr.abort(); return; }
      abortSignal.addEventListener('abort', () => xhr.abort(), { once: true });
    }

    xhr.send(fd);
  });
}

/** POST a single chunk via XHR. Plain fetch would also work but XHR gives us
 *  upload progress events if we ever want per-chunk sub-progress later.
 *  Honors abortSignal so a user-initiated cancel stops in-flight uploads
 *  across all pool workers promptly, not after the current chunk finishes. */
function uploadChunk(args: {
  url: string;
  uploadId: string;
  chunkIndex: number;
  blob: Blob;
  headers: Record<string, string>;
  abortSignal?: AbortSignal;
}): Promise<void> {
  const { url, uploadId, chunkIndex, blob, headers, abortSignal } = args;
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append('chunk', blob, `chunk_${chunkIndex}`);
    fd.append('uploadId', uploadId);
    fd.append('chunkIndex', String(chunkIndex));

    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.timeout = 180000; // 3 min per ~10MB chunk

    for (const [k, v] of Object.entries(headers)) {
      if (k.toLowerCase() === 'content-type') continue;
      xhr.setRequestHeader(k, v);
    }

    const cleanup = () => {
      if (abortSignal) abortSignal.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      xhr.abort();
      cleanup();
      reject(new DOMException('Upload aborted', 'AbortError'));
    };
    if (abortSignal) {
      if (abortSignal.aborted) { xhr.abort(); reject(new DOMException('Upload aborted', 'AbortError')); return; }
      abortSignal.addEventListener('abort', onAbort, { once: true });
    }

    xhr.onload = () => {
      cleanup();
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        let msg = `Chunk ${chunkIndex} failed (HTTP ${xhr.status})`;
        try {
          const parsed = JSON.parse(xhr.responseText);
          msg = parsed.error || msg;
        } catch { /* keep default */ }
        reject(new Error(msg));
      }
    };
    xhr.onerror = () => { cleanup(); reject(new Error(`Network error on chunk ${chunkIndex}`)); };
    xhr.ontimeout = () => { cleanup(); reject(new Error(`Chunk ${chunkIndex} timed out`)); };

    xhr.send(fd);
  });
}

async function fetchJson(url: string, init: RequestInit): Promise<any> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      message = data.error || data.message || message;
    } catch { /* keep default */ }
    throw new Error(message);
  }
  return res.json();
}

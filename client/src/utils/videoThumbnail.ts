// client/src/utils/videoThumbnail.ts
// Client-side thumbnail capture for body-cam uploads. No server transcoding —
// Workers can't run ffmpeg — so the browser grabs one frame via canvas after
// upload completes. Non-blocking: callers should treat a rejection as
// "no thumbnail" rather than an upload failure.

/** The fixed filename the upload endpoint expects for the multipart field. */
export function thumbnailFileName(_sourceFileName: string): string {
  return 'thumb.jpg';
}

/**
 * Load `file` into a hidden <video>, seek to ~1s (or 10% into very short
 * clips), and canvas-capture a JPEG frame. Resolves null if the browser
 * can't decode the file (unsupported codec, corrupt upload, etc.) — callers
 * must treat that as "skip the thumbnail", not an error.
 */
export async function captureVideoThumbnail(file: File): Promise<Blob | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    const url = URL.createObjectURL(file);
    video.src = url;

    const cleanup = () => { URL.revokeObjectURL(url); clearTimeout(timeoutId); };
    const fail = () => { cleanup(); resolve(null); };

    // Guard against a capture that never resolves (corrupt file that neither
    // errors nor fires loadedmetadata, or a seek that stalls indefinitely for
    // some codec/browser combo). 8s is generous for local metadata load + seek
    // but short enough not to block a caller waiting on this as a best-effort step.
    const timeoutId = setTimeout(fail, 8000);

    video.onloadedmetadata = () => {
      const seekTo = Math.min(1, Math.max(0.1, video.duration * 0.1));
      video.currentTime = Number.isFinite(seekTo) ? seekTo : 0;
    };
    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || 1280;
        canvas.height = video.videoHeight || 720;
        const ctx = canvas.getContext('2d');
        if (!ctx) return fail();
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => { cleanup(); resolve(blob); }, 'image/jpeg', 0.8);
      } catch {
        fail();
      }
    };
    video.onerror = fail;
  });
}

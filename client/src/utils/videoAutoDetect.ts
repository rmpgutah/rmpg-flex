// client/src/utils/videoAutoDetect.ts
// Client-side auto face/plate scan for a just-uploaded body-cam video.
// Reuses the SAME scanClip() engine RedactionStudio's manual "Scan" button
// calls — same lazy-loaded BlazeFace + COCO-SSD models, same cached-promise
// singletons, so a video uploaded from a page that never opened Redaction
// Studio still only pays the model-load cost once per browser session.
// Non-blocking: callers must treat a rejection/null as "skip detection",
// not an upload failure — same contract as videoThumbnail.ts.
import { scanClip } from './redaction/scanClip';
import type { RedactionRegion } from './redaction/regions';

const DETECTION_TIMEOUT_MS = 30000; // model load + full-clip scan can be slow

/**
 * Load `file` into a hidden <video>, run scanClip() against it, and resolve
 * the found regions (or null on any failure/timeout). Always revokes the
 * object URL it creates.
 */
export async function runAutoDetection(file: File): Promise<RedactionRegion[] | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    const url = URL.createObjectURL(file);
    video.src = url;

    let settled = false;
    const cleanup = () => { URL.revokeObjectURL(url); clearTimeout(timeoutId); };
    const finish = (result: RedactionRegion[] | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    const timeoutId = setTimeout(() => finish(null), DETECTION_TIMEOUT_MS);

    video.onloadedmetadata = async () => {
      try {
        const regions = await scanClip(video, { intervalSec: 0.5, includePeople: false });
        finish(regions);
      } catch {
        finish(null);
      }
    };
    video.onerror = () => finish(null);
  });
}

// ============================================================
// RMPG Flex — In-browser AI vehicle detector (lazy, CDN-loaded)
// ============================================================
// Loads TensorFlow.js COCO-SSD from a CDN *on demand* (kept out of the app
// bundle via a @vite-ignore dynamic import) and detects vehicles in a playing
// <video> frame so the forensic player can draw boxes that follow the vehicle.
// Everything degrades gracefully: if the model can't load (offline / blocked /
// slow), callers fall back to the telemetry-only overlays.
// ============================================================

import type { Detection } from './drivingPrediction';

const VEHICLE_CLASSES = new Set(['car', 'truck', 'bus', 'motorcycle']);
// COCO-SSD (lite_mobilenet_v2) + tfjs, bundled into one ESM module by esm.sh.
const CDN = 'https://esm.sh/@tensorflow-models/coco-ssd@2.2.3?bundle&target=es2020';

let modelPromise: Promise<unknown | null> | null = null;

export type DetectorStatus = 'idle' | 'loading' | 'ready' | 'unavailable';

/** Lazy-load (once) the COCO-SSD model. Resolves null on any failure. */
export function loadVehicleDetector(): Promise<unknown | null> {
  if (!modelPromise) {
    modelPromise = (async () => {
      try {
        const cocoSsd: any = await import(/* @vite-ignore */ CDN);
        return await cocoSsd.load({ base: 'lite_mobilenet_v2' });
      } catch (e) {
        console.warn('[ai-track] detector load failed — falling back to telemetry overlays', e);
        return null;
      }
    })();
  }
  return modelPromise;
}

/** Detect vehicles in the current video frame (natural px bboxes). [] on any issue. */
export async function detectVehicles(model: unknown, video: HTMLVideoElement, maxDet = 10, minScore = 0.4): Promise<Detection[]> {
  const m = model as { detect?: (v: HTMLVideoElement, n: number) => Promise<Array<{ bbox: number[]; class: string; score: number }>> };
  if (!m?.detect || video.readyState < 2 || !video.videoWidth) return [];
  try {
    const preds = await m.detect(video, maxDet);
    return preds
      .filter((p) => VEHICLE_CLASSES.has(p.class) && p.score >= minScore)
      .map((p) => ({ bbox: [p.bbox[0], p.bbox[1], p.bbox[2], p.bbox[3]] as Detection['bbox'], score: p.score, cls: p.class }));
  } catch {
    return [];
  }
}

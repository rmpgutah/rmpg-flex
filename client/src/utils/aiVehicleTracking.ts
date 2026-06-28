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
import { filterDetections } from './detectionFilter';

// Vehicles for ALPR + a pedestrian class for officer-safety coverage.
const VEHICLE_CLASSES = new Set(['car', 'truck', 'bus', 'motorcycle', 'bicycle', 'person']);
// Load the FULL tfjs (registers the WebGL/CPU compute backends) first, then
// COCO-SSD pinned (?deps) to the SAME tfjs-core instance so the backend the
// union package registered is visible to the model (avoids the classic
// "No backend found in registry" two-instances problem).
const TFJS_URL = 'https://esm.sh/@tensorflow/tfjs@4.22.0';
const COCO_URL = 'https://esm.sh/@tensorflow-models/coco-ssd@2.2.3?deps=@tensorflow/tfjs-core@4.22.0,@tensorflow/tfjs-converter@4.22.0';

let modelPromise: Promise<unknown | null> | null = null;

export type DetectorStatus = 'idle' | 'loading' | 'ready' | 'unavailable';

/** Lazy-load (once) the COCO-SSD model. Resolves null on any failure. */
export function loadVehicleDetector(): Promise<unknown | null> {
  if (!modelPromise) {
    modelPromise = (async () => {
      try {
        const tf: any = await import(/* @vite-ignore */ TFJS_URL);
        await tf.ready();                                  // initialize a compute backend (webgl)
        const cocoSsd: any = await import(/* @vite-ignore */ COCO_URL);
        return await cocoSsd.load({ base: 'lite_mobilenet_v2' });
      } catch (e) {
        console.warn('[ai-track] detector load failed — falling back to telemetry overlays', e);
        return null;
      }
    })();
  }
  return modelPromise;
}

/** Detect vehicles/people in the current video frame (natural px bboxes), with a
 *  night-safe plausibility gate (drops glare/light false-positives: low score,
 *  sky-band centres, specks, frame-fills, slivers). [] on any issue. */
export async function detectVehicles(model: unknown, video: HTMLVideoElement, maxDet = 10, minScore = 0.5): Promise<Detection[]> {
  const m = model as { detect?: (v: HTMLVideoElement, n: number) => Promise<Array<{ bbox: number[]; class: string; score: number }>> };
  if (!m?.detect || video.readyState < 2 || !video.videoWidth) return [];
  try {
    const preds = await m.detect(video, maxDet);
    const dets = preds
      .filter((p) => VEHICLE_CLASSES.has(p.class))
      .map((p) => ({ bbox: [p.bbox[0], p.bbox[1], p.bbox[2], p.bbox[3]] as Detection['bbox'], score: p.score, cls: p.class }));
    return filterDetections(dets, video.videoWidth, video.videoHeight, { minScore });
  } catch {
    return [];
  }
}

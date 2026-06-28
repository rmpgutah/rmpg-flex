// ============================================================
// RMPG Flex — Fast ALPR plate detector (lazy, CDN-loaded)
// ============================================================
// Lazy-loads @xenova/transformers from CDN and runs a HuggingFace
// license-plate detector model in the browser. Same degradation pattern as
// aiVehicleTracking.ts: if the model can't load (offline / blocked / slow),
// callers fall back to the heuristic plateRegion() sub-box.
//
// This gives W8: real plate BOUNDING BOXES instead of the heuristic lower-
// centre guess, so the PlateMagnifier inset and evidence crop lock onto the
// actual plate in the frame.
// ============================================================

// Model: YOLO-style license plate detector fine-tuned for global LP detection.
// MIT-licensed, ONNX-exported, served via HuggingFace transformers.js pipeline.
const TRANSFORMERS_URL = 'https://esm.sh/@xenova/transformers@2.17.2';
const LP_MODEL_ID = 'nickmuchi/yolos-small-finetuned-license-plate-detection';

export type PlateDetectorStatus = 'idle' | 'loading' | 'ready' | 'unavailable';

export interface PlateDetection {
  x: number; y: number; w: number; h: number; score: number;
}

// Singleton — loaded once per session.
let detectorPromise: Promise<unknown | null> | null = null;

/** Lazy-load (once) the plate detector pipeline. Resolves null on any failure. */
export function loadPlateDetector(): Promise<unknown | null> {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      try {
        const mod: any = await import(/* @vite-ignore */ TRANSFORMERS_URL);
        const { pipeline, env } = mod;
        env.allowLocalModels = false;
        // Force pure-WASM ONNX backend — avoids Node.js require('buffer'/'long') errors
        // that onnxruntime-web emits when loaded in a browser via esm.sh.
        if (env.backends?.onnx) env.backends.onnx.wasm.proxy = false;
        // quantized: false → loads onnx/model.onnx directly; the quantized
        // variant (model_quantized.onnx) doesn't exist in this HuggingFace repo
        // and causes a 404 that kills the pipeline() call entirely.
        return await pipeline('object-detection', LP_MODEL_ID, { revision: 'main', device: 'wasm', quantized: false });
      } catch (e) {
        console.warn('[fast-alpr] plate detector unavailable — falling back to heuristic plateRegion', e);
        return null;
      }
    })();
  }
  return detectorPromise;
}

/** Run plate detection on a canvas element.
 *  Returns array of plate boxes in canvas-space px coords (best-first by score). */
export async function detectPlateBboxes(model: unknown, canvas: HTMLCanvasElement): Promise<PlateDetection[]> {
  if (!model || !canvas.width || !canvas.height) return [];
  try {
    const detect = model as (
      input: HTMLCanvasElement,
      opts?: { threshold?: number },
    ) => Promise<Array<{ label: string; score: number; box: { xmin: number; ymin: number; xmax: number; ymax: number } }>>;
    const results = await detect(canvas, { threshold: 0.4 });
    const plates = results.filter(
      (r) => /licen|plate|LP/i.test(r.label),
    );
    return plates
      .map((r) => ({
        x: r.box.xmin, y: r.box.ymin,
        w: r.box.xmax - r.box.xmin,
        h: r.box.ymax - r.box.ymin,
        score: r.score,
      }))
      .sort((a, b) => b.score - a.score);
  } catch {
    return [];
  }
}

// ── Pure helpers (exported for tests) ───────────────────────────────────────

/** Map a plate box found inside a vehicle-crop canvas back to full-frame px coords.
 *
 *  @param plate       Detection box in canvas-space (px within the crop).
 *  @param vehicleCrop [cropX, cropY, cropW, cropH] of the region that was drawn
 *                     onto the canvas (full-frame natural px coordinates).
 *  @param canvas      The crop canvas used during detection (provides the scale).
 *  @returns           [x, y, w, h] in full-frame natural px.
 */
export function plateBoxToFrame(
  plate: PlateDetection,
  vehicleCrop: [number, number, number, number],
  canvas: { width: number; height: number },
): [number, number, number, number] {
  const [cropX, cropY, cropW, cropH] = vehicleCrop;
  const scaleX = cropW / canvas.width;
  const scaleY = cropH / canvas.height;
  return [
    cropX + plate.x * scaleX,
    cropY + plate.y * scaleY,
    plate.w * scaleX,
    plate.h * scaleY,
  ];
}

/** Pick the best plate from multiple detections (highest score).
 *  Returns null if no detections. Pure — no async, no side-effects. */
export function bestPlate(plates: PlateDetection[]): PlateDetection | null {
  if (!plates.length) return null;
  return plates.reduce((a, b) => (b.score > a.score ? b : a));
}

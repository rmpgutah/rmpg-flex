// client/src/utils/redaction/detectFaces.ts
// Lazy BlazeFace loader on the SAME tfjs runtime coco-ssd already pulls in
// (aiVehicleTracking.ts loads @tensorflow/tfjs first), so no second engine. Used
// by the redaction scan to find bystander faces. Degrades to [] on any failure.
import type { NormBox } from './regions';

const TFJS_URL = 'https://esm.sh/@tensorflow/tfjs@4.22.0';
const BLAZEFACE_URL = 'https://esm.sh/@tensorflow-models/blazeface@0.1.0?deps=@tensorflow/tfjs-core@4.22.0';
// Self-hosted BlazeFace weights (client/public/models/blazeface/{model.json,
// group1-shard1of1.bin}). blazeface.load() WITHOUT modelUrl defaults to
// https://tfhub.dev/... which is NOT in our CSP connect-src, so the weight
// fetch was silently blocked and faces never auto-detected (plates worked
// because coco-ssd pulls from storage.googleapis.com, which IS allowed).
// Passing modelUrl routes load() down loadGraphModel(modelUrl) — a same-origin
// ('self') request — so there is no third-party CDN at evidence-creation time.
const FACE_MODEL_URL = '/models/blazeface/model.json';

let modelPromise: Promise<unknown | null> | null = null;

export function loadFaceDetector(): Promise<unknown | null> {
  if (!modelPromise) {
    modelPromise = (async () => {
      try {
        const tf: any = await import(/* @vite-ignore */ TFJS_URL);
        await tf.ready();
        const blazeface: any = await import(/* @vite-ignore */ BLAZEFACE_URL);
        return await blazeface.load({ modelUrl: FACE_MODEL_URL });
      } catch (e) {
        console.warn('[redaction] face model load failed', e);
        return null;
      }
    })();
  }
  return modelPromise;
}

/** Detect faces in the current video frame → fractional boxes (padded 25% so the
 *  whole face/hairline is covered). [] on any issue. */
export async function detectFaces(model: unknown, video: HTMLVideoElement): Promise<NormBox[]> {
  const m = model as { estimateFaces?: (v: HTMLVideoElement, returnTensors: boolean) => Promise<Array<{ topLeft: [number, number]; bottomRight: [number, number] }>> };
  if (!m?.estimateFaces || video.readyState < 2 || !video.videoWidth) return [];
  try {
    const W = video.videoWidth, H = video.videoHeight;
    const faces = await m.estimateFaces(video, false);
    return faces.map((f) => {
      const [x1, y1] = f.topLeft, [x2, y2] = f.bottomRight;
      const w = x2 - x1, h = y2 - y1, padX = w * 0.25, padY = h * 0.25;
      const nx = Math.max(0, x1 - padX), ny = Math.max(0, y1 - padY);
      const nw = Math.min(W - nx, w + padX * 2), nh = Math.min(H - ny, h + padY * 2);
      return [nx / W, ny / H, nw / W, nh / H] as NormBox;
    });
  } catch { return []; }
}

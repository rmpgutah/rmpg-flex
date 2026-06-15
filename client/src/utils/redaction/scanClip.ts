// client/src/utils/redaction/scanClip.ts
// Seek through a clip at a fixed cadence, run vehicle/plate (coco-ssd) + face
// (blazeface) detection at each sample, and merge the samples into keyframed
// RedactionRegions. Reuses the existing detector + plateRegion geometry.
import { loadVehicleDetector, detectVehicles } from '../aiVehicleTracking';
import { plateRegion, clampBox } from '../drivingPrediction';
import { loadFaceDetector, detectFaces } from './detectFaces';
import { mergeSamples, normBox, type DetectorSample, type RedactionRegion, type NormBox } from './regions';

export interface ScanOpts { intervalSec?: number; includePeople?: boolean; onProgress?: (frac: number) => void }

function seekTo(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((res) => {
    const done = () => { video.removeEventListener('seeked', done); res(); };
    video.addEventListener('seeked', done);
    video.currentTime = Math.min(t, (video.duration || t) - 0.01);
  });
}

export async function scanClip(video: HTMLVideoElement, opts: ScanOpts = {}): Promise<RedactionRegion[]> {
  const interval = opts.intervalSec ?? 0.25;
  const W = video.videoWidth, H = video.videoHeight;
  const duration = video.duration || 0;
  if (!W || !H || !duration) return [];

  const [vehModel, faceModel] = await Promise.all([loadVehicleDetector(), loadFaceDetector()]);
  const wasPaused = video.paused; video.pause();
  try {
    const samples: DetectorSample[] = [];

    let t = 0;
    for (; t <= duration; t += interval) {
      await seekTo(video, t);
      if (vehModel) {
        const dets = await detectVehicles(vehModel, video, 16);
        for (const d of dets) {
          // d.bbox is pixel-space Box; normBox() divides it to fractional NormBox (cast is shape-only).
          if (d.cls === 'person') {
            if (opts.includePeople) samples.push({ kind: 'person', box: normBox(d.bbox as NormBox, W, H), t });
          } else {
            const pr = clampBox(plateRegion(d.bbox as NormBox), W, H);
            samples.push({ kind: 'plate', box: normBox(pr as NormBox, W, H), t });
          }
        }
      }
      if (faceModel) {
        const faces = await detectFaces(faceModel, video);
        for (const f of faces) samples.push({ kind: 'face', box: f, t });
      }
      opts.onProgress?.(Math.min(1, t / duration));
    }
    return mergeSamples(samples, { scanInterval: interval });
  } finally {
    if (!wasPaused) video.play().catch(() => {});
  }
}

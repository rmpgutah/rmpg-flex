// ============================================================
// RMPG Flex — Cloudflare Workers AI plate reader
// ============================================================
// Reads a license plate (and basic vehicle attributes) from an image using the
// FREE Workers AI vision model (@cf/meta/llama-3.2-11b-vision-instruct) via the
// existing `license_plate` OCR profile — NO Roboflow, NO serverless credits, no
// per-scan billing. One call returns plate + state + make/model/color/year +
// confidence, so the old two-stage Roboflow fast→enrich flow collapses into one.
//
// Tradeoff vs Roboflow (accepted when choosing "Cloudflare only"): the vision
// model reads the single most prominent plate in the frame, not every vehicle.
// For dashcam frames + most on-scene shots that's exactly one plate; true
// multi-vehicle-in-one-frame capture is the feature given up.
// ============================================================

import { extractVisionWorkersAI } from './visionExtract';
import { cleanPlate } from './roboflowAlpr';
import type { ExtractionResult } from './serveIntakeExtract';

export interface CloudflarePlateResult {
  plate: string | null;
  state: string | null;
  make: string | null;
  model: string | null;
  color: string | null;
  year: number | null;
  plateType: string | null;
  bodyStyle: string | null;
  confidence: number | null;   // plate-field confidence (0..1), the acceptance signal
  model_id: string;            // which engine produced this
  ms: number;
}

const str = (f?: { value: string }): string | null => {
  const v = (f?.value ?? '').trim();
  return v ? v : null;
};

/** Pure: map a license_plate ExtractionResult to a CloudflarePlateResult.
 *  Exported for unit tests (no I/O). */
export function plateResultFromExtraction(r: ExtractionResult | null): CloudflarePlateResult | null {
  if (!r) return null;
  const f = (r.fields || {}) as Record<string, { value: string; confidence: number }>;
  const rawPlate = str(f.plate_number);
  if (!rawPlate) return null;
  const plate = cleanPlate(rawPlate);
  if (!plate) return null;
  const yearStr = str(f.vehicle_year);
  const year = yearStr && /^\d{4}$/.test(yearStr) ? Number(yearStr) : null;
  // Prefer the plate field's own confidence; fall back to the overall doc score.
  const plateConf = typeof f.plate_number?.confidence === 'number' ? f.plate_number.confidence
    : (typeof r.confidence === 'number' ? r.confidence : null);
  return {
    plate,
    state: str(f.plate_state),
    make: str(f.vehicle_make),
    model: str(f.vehicle_model),
    color: str(f.vehicle_color),
    year,
    plateType: str(f.plate_type),
    bodyStyle: str(f.vehicle_body),
    confidence: plateConf,
    model_id: r.model || 'workers-ai',
    ms: r.ms ?? 0,
  };
}

/** Read a plate from image bytes on Workers AI. Returns null on no-plate / error
 *  (Workers AI path swallows errors and returns null). */
export async function readPlateCloudflare(
  env: { AI: Ai },
  imageBytes: Uint8Array,
  mediaType = 'image/jpeg',
): Promise<CloudflarePlateResult | null> {
  const extraction = await extractVisionWorkersAI(env, imageBytes, mediaType, 'license_plate');
  return plateResultFromExtraction(extraction);
}

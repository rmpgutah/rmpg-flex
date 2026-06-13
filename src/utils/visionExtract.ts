// visionExtract — the dynamic, profile-driven Claude-vision OCR engine.
// One Claude call per image: with sel='auto' Claude classifies the document AND
// extracts its fields; with a concrete profile it extracts that type only.
// Returns the shared ExtractionResult (see ocrProfiles.normalizeVision), or null
// when the Anthropic key is absent / the call errors, so callers can fall back to
// the Workers-AI vision path.

import { getAnthropicKey, getClaudeModel, callClaude, bytesToBase64 } from './anthropic';
import { tryParseModelJson, type ExtractionResult } from './serveIntakeExtract';
import {
  buildVisionUserPrompt, visionSystemPrompt, normalizeVision,
  type OcrProfileSelector,
} from './ocrProfiles';

const MAX_VISION_BYTES = 4 * 1024 * 1024; // mirror the serve-intake vision cap

export async function extractVision(
  env: { DB: D1Database },
  imageBytes: Uint8Array,
  mediaType: string,
  sel: OcrProfileSelector,
): Promise<ExtractionResult | null> {
  if (imageBytes.byteLength === 0 || imageBytes.byteLength > MAX_VISION_BYTES) return null;
  const key = await getAnthropicKey(env);
  if (!key) return null;
  const started = Date.now();
  const model = await getClaudeModel(env);
  try {
    const text = await callClaude(key, {
      system: visionSystemPrompt(),
      text: buildVisionUserPrompt(sel),
      image: { base64: bytesToBase64(imageBytes), mediaType: mediaType || 'image/jpeg' },
      model,
      maxTokens: 2048,
    });
    const parsed = tryParseModelJson({ response: text });
    return normalizeVision(parsed, sel, `claude:${model}`, Date.now() - started);
  } catch {
    return null;
  }
}

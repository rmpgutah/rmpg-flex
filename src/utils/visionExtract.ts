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
const WORKERS_VISION_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct';

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

/**
 * Profile-aware OCR on the FREE Workers-AI vision model (llama-3.2-11b-vision).
 * Same profile prompts/normalizer as the Claude path, so id_card / license_plate /
 * serve_document all work without an Anthropic balance — lower accuracy than Claude,
 * but functional. Used as the fallback when extractVision (Claude) returns null.
 * Requires the Meta-Llama license to be accepted (POST /api/ocr/accept-llama-license).
 */
export async function extractVisionWorkersAI(
  env: { AI: Ai },
  imageBytes: Uint8Array,
  mediaType: string,
  sel: OcrProfileSelector,
): Promise<ExtractionResult | null> {
  if (imageBytes.byteLength === 0 || imageBytes.byteLength > MAX_VISION_BYTES) return null;
  const started = Date.now();
  try {
    const out: any = await env.AI.run(WORKERS_VISION_MODEL as any, {
      image: Array.from(imageBytes),
      prompt: `${visionSystemPrompt()}\n\n${buildVisionUserPrompt(sel)}`,
      max_tokens: 2048,
      temperature: 0.1,
    } as any);
    const parsed = tryParseModelJson(out);
    return normalizeVision(parsed, sel, `workers-ai:${WORKERS_VISION_MODEL}`, Date.now() - started);
  } catch {
    return null;
  }
}

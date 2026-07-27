// ============================================================
// RMPG Flex — Serve Intake neuron accounting
// ============================================================
// Workers AI includes 10,000 Neurons/day free. Above that, Workers Paid
// bills $0.011/1,000 Neurons. That is cents per packet, but it must be a
// conscious decision rather than a surprise — so every intake logs its
// estimated consumption.
//
// Rates verified against https://developers.cloudflare.com/workers-ai/platform/pricing/
// on 2026-07-26. Re-verify when adding a model; Cloudflare revises these.
// Model ids match the constants exported from serveIntakeExtract.ts
// (TEXT_MODEL_LEGACY/TEXT_MODEL_SCOUT/VISION_MODEL_LEGACY/VISION_MODEL_MOONDREAM)
// plus mistral/gemma, which the A/B harness (Task 8) can also select.
// ============================================================

export const MODEL_NEURON_RATES: Record<string, { inPerM: number; outPerM: number }> = {
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast': { inPerM: 26668, outPerM: 204805 },
  '@cf/meta/llama-4-scout-17b-16e-instruct': { inPerM: 24545, outPerM: 77273 },
  '@cf/meta/llama-3.2-11b-vision-instruct': { inPerM: 4410, outPerM: 61493 },
  '@cf/moondream/moondream3.1-9B-A2B': { inPerM: 27273, outPerM: 90909 },
  '@cf/mistralai/mistral-small-3.1-24b-instruct': { inPerM: 31876, outPerM: 50488 },
  '@cf/google/gemma-3-12b-it': { inPerM: 31371, outPerM: 50560 },
};

export const FREE_NEURONS_PER_DAY = 10_000;

// Unknown models (notably Claude — `claude:…` — which is billed through the
// Anthropic API, not Workers AI Neurons) return 0 rather than throwing, so
// callers can log unconditionally without a model allow-list check first.
export function estimateNeurons(model: string, inTokens: number, outTokens: number): number {
  const rate = MODEL_NEURON_RATES[model];
  if (!rate) return 0;
  return Math.round(
    (inTokens / 1_000_000) * rate.inPerM + (outTokens / 1_000_000) * rate.outPerM,
  );
}

// A single collected document, as far as the neuron estimate cares. Deliberately
// narrow — callers project their real per-doc bookkeeping down to this shape
// rather than this module reaching into route-level types.
export interface PacketDocNeuronInput {
  // The model that actually ran (or would have) — read from the extraction
  // result, not a hardcoded default, since extraction can itself fall back.
  model: string;
  // Chars actually sent to the model for this doc (already capped by the
  // caller, e.g. PER_DOC_CAP) — used as the chars/4 token proxy.
  textLength: number;
  // Positive fact: true only if this doc's extraction call was actually
  // invoked. False for any doc that never reached the model (unsupported
  // file type, file read/store error, insufficient text to bother calling).
  // Do NOT derive this from an engine-label string match — that is exactly
  // what under- and over-counted phantom cost before this field existed.
  modelCalled: boolean;
  // Vision documents are excluded on purpose: their model input is the image
  // itself, not text, and there is no documented image→token conversion to
  // estimate from. Fabricating one would be worse than omitting it.
  isVision: boolean;
}

// Sums the estimated neuron cost for one intake packet, counting only
// documents that actually reached the model. See PacketDocNeuronInput above
// for what "actually reached the model" and "vision" mean here.
export function estimatePacketNeurons(docs: PacketDocNeuronInput[]): number {
  let total = 0;
  for (const d of docs) {
    if (d.isVision || !d.modelCalled) continue;
    total += estimateNeurons(d.model, Math.ceil(d.textLength / 4), 512);
  }
  return total;
}

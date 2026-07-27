import { describe, it, expect } from 'vitest';
import { estimateNeurons, MODEL_NEURON_RATES } from '../src/utils/serveIntakeNeurons';

describe('estimateNeurons', () => {
  it('computes cost from the published per-million rates', () => {
    // Scout: 24,545/M in, 77,273/M out. 8000 in + 1500 out.
    const n = estimateNeurons('@cf/meta/llama-4-scout-17b-16e-instruct', 8000, 1500);
    expect(n).toBeGreaterThan(280);
    expect(n).toBeLessThan(340);
  });

  it('shows the legacy 70B costing more for the same packet', () => {
    const scout = estimateNeurons('@cf/meta/llama-4-scout-17b-16e-instruct', 8000, 1500);
    const legacy = estimateNeurons('@cf/meta/llama-3.3-70b-instruct-fp8-fast', 8000, 1500);
    expect(legacy).toBeGreaterThan(scout);
  });

  it('returns 0 for an unknown model rather than throwing', () => {
    expect(estimateNeurons('@cf/unknown/model', 1000, 100)).toBe(0);
  });

  it('publishes rates for every model the pipeline can select', () => {
    for (const m of [
      '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      '@cf/meta/llama-4-scout-17b-16e-instruct',
      '@cf/meta/llama-3.2-11b-vision-instruct',
      '@cf/moondream/moondream3.1-9B-A2B',
      '@cf/mistralai/mistral-small-3.1-24b-instruct',
    ]) {
      expect(MODEL_NEURON_RATES[m]).toBeDefined();
    }
  });
});

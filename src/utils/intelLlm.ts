// src/utils/intelLlm.ts
// Engine ladder for the Intel AI Analyst (Claude → OpenAI → free Workers AI),
// returning whether a paid AI or the free fallback produced the answer so the
// UI can flag a free-tier fallback.
//
// Why this exists: the Intel AI routes (/ask, /extract, /summarize) only guarded
// `if (!key)`. When the Anthropic key was present but the account was out of
// credit, callClaude threw and the route returned a hard 502 — the Intel AI
// Analyst was simply broken, even though free Workers AI could answer. The
// callAi router handles the full fallback chain; this seam preserves the
// pre-existing engine-reporting contract for the UI (paid vs free).

import { callAi } from './callAi';

export type IntelEngine = 'claude' | 'workers-ai';

// Free fallback model — same one Deep Research falls back to.
export const INTEL_WORKERS_AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

export interface IntelLlmEnv { DB: D1Database; AI: Ai; }
export interface IntelLlmOpts { system?: string; text: string; maxTokens?: number; model?: string; }
export interface IntelLlmResult { text: string; engine: IntelEngine }

/**
 * Run an Intel AI prompt through the callAi router (Claude → OpenAI →
 * Workers AI). The engine field collapses callAi's provider into the
 * legacy 'claude' | 'workers-ai' contract the UI expects: paid AI
 * (claude or openai) reports as 'claude'; free Workers AI reports as
 * 'workers-ai' so the free-tier-fallback badge still triggers.
 */
export async function runIntelLLM(env: IntelLlmEnv, opts: IntelLlmOpts): Promise<IntelLlmResult> {
  const { system, text, maxTokens = 1024 } = opts;
  try {
    const r = await callAi(env, { system, text, maxTokens });
    // Empty paid-AI response → not useful to downstream parsers (parseExtract,
    // citationsFrom). Retry on Workers AI explicitly. Preserves the original
    // "engine: workers-ai when paid was empty" contract that intelAi routes
    // depended on; otherwise an empty paid reply would silently break /ask
    // and /extract without surfacing the free-fallback badge to the UI.
    if (r.provider !== 'workers-ai' && (!r.text || !r.text.trim())) {
      const free = await callAi(env, { system, text, maxTokens, providers: ['workers-ai'] });
      return { text: free.text || '', engine: 'workers-ai' };
    }
    const engine: IntelEngine = r.provider === 'workers-ai' ? 'workers-ai' : 'claude';
    return { text: r.text || '', engine };
  } catch {
    return { text: '', engine: 'workers-ai' };
  }
}

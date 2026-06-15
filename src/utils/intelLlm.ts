// src/utils/intelLlm.ts
// Engine ladder for the Intel AI Analyst (Claude → free Workers AI), returning
// WHICH engine produced the answer so the UI can flag a free-tier fallback.
//
// Why this exists: the Intel AI routes (/ask, /extract, /summarize) only guarded
// `if (!key)`. When the Anthropic key was present but the account was out of
// credit, callClaude threw and the route returned a hard 502 — the Intel AI
// Analyst was simply broken, even though free Workers AI could answer. Deep
// Research already degrades gracefully (researchEngine.runResearchLLM); this is
// the same pattern, factored into one testable seam that also reports the engine.

import { getAnthropicKey, getClaudeModel, callClaude } from './anthropic';

export type IntelEngine = 'claude' | 'workers-ai';

// Free fallback model — same one Deep Research falls back to.
export const INTEL_WORKERS_AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

export interface IntelLlmEnv { DB: D1Database; AI: Ai; }
export interface IntelLlmOpts { system?: string; text: string; maxTokens?: number; model?: string; }
export interface IntelLlmResult { text: string; engine: IntelEngine }

/**
 * Run an Intel AI prompt through Claude when a working key is configured, else
 * (no key OR a failed/empty Claude call) fall through to free Workers AI. Never
 * throws on primary-engine failure — always returns an answer + the engine used.
 * Mirrors researchEngine.runResearchLLM so the codebase has ONE fallback pattern.
 */
export async function runIntelLLM(env: IntelLlmEnv, opts: IntelLlmOpts): Promise<IntelLlmResult> {
  const { system, text, maxTokens = 1024 } = opts;
  const key = await getAnthropicKey(env);
  if (key) {
    try {
      const model = opts.model || (await getClaudeModel(env));
      const out = await callClaude(key, { system, text, maxTokens, model });
      if (out && out.trim()) return { text: out, engine: 'claude' };
      // empty Claude response → fall through to Workers AI rather than return ''
    } catch { /* out of credit / invalid key / transient → fall through */ }
  }
  const messages: { role: string; content: string }[] = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: text });
  const r: any = await env.AI.run(INTEL_WORKERS_AI_MODEL as any, { messages, max_tokens: maxTokens } as any);
  // Workers AI auto-parses JSON when the prompt elicits it: `response` can come
  // back as an object/array, not a string. Re-serialize so the callers' parsers
  // (parseExtract/citationsFrom) get a string — mirrors runResearchLLM.
  const resp = r?.response;
  const out = typeof resp === 'string'
    ? resp
    : resp != null && typeof resp === 'object' ? JSON.stringify(resp) : '';
  return { text: out, engine: 'workers-ai' };
}

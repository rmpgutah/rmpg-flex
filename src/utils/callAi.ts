// callAi — smart-fallback AI router. Tries providers in order
// (default: Claude → OpenAI → Workers AI), falling back on missing
// keys or recoverable errors (401, 402, 429-credit, 5xx). Does NOT
// fall back on 400 (bad request) or 429-without-credit-hint (transient
// rate limit) — those propagate so callers see real bugs.
//
// Consumers should prefer callAi() over callClaude() directly so the
// fallback chain works automatically when admins rotate keys.

import { getAnthropicKey, getClaudeModel, callClaude, diagnoseAnthropicError } from './anthropic';
import { getOpenAiKey, getOpenAiModel, callOpenAi, diagnoseOpenAiError } from './openai';

export type AiProvider = 'claude' | 'openai' | 'workers-ai';

export interface AiCallOpts {
  system?: string;
  text: string;
  image?: { base64: string; mediaType: string };
  maxTokens?: number;
  /** Restrict / reorder providers. Default: ['claude','openai','workers-ai']. */
  providers?: AiProvider[];
}

export interface AiCallResult {
  text: string;
  provider: AiProvider;
  model: string;
  /** True when an earlier provider in the chain was skipped or failed. */
  fellBack: boolean;
}

interface CallAiEnv { DB: D1Database; AI: Ai; }

const DEFAULT_CHAIN: AiProvider[] = ['claude', 'openai', 'workers-ai'];

function isFallbackable(provider: AiProvider, err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const { status } = provider === 'claude'
    ? diagnoseAnthropicError(msg)
    : provider === 'openai'
      ? diagnoseOpenAiError(msg)
      : { status: null };
  if (status === null) return false;
  if (status === 401 || status === 403) return true;
  if (status === 402) return true;
  if (status === 429) {
    return /(credit|balance|fund|billing|quota|exceeded)/i.test(msg);
  }
  if (status >= 500) return true;
  return false;
}

async function runProvider(
  provider: AiProvider,
  env: CallAiEnv,
  opts: AiCallOpts,
): Promise<{ text: string; model: string }> {
  if (provider === 'claude') {
    const key = await getAnthropicKey(env);
    if (!key) throw new Error('Anthropic key not configured');
    const model = await getClaudeModel(env);
    const text = await callClaude(key, { system: opts.system, text: opts.text, image: opts.image, model, maxTokens: opts.maxTokens });
    return { text, model };
  }
  if (provider === 'openai') {
    const key = await getOpenAiKey(env);
    if (!key) throw new Error('OpenAI key not configured');
    const model = await getOpenAiModel(env);
    const text = await callOpenAi(key, { system: opts.system, text: opts.text, image: opts.image, model, maxTokens: opts.maxTokens });
    return { text, model };
  }
  // workers-ai — always present, no key check
  const model = opts.image
    ? '@cf/meta/llama-3.2-11b-vision-instruct'
    : '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
  const aiOpts: any = opts.image
    ? {
        messages: [
          ...(opts.system ? [{ role: 'system', content: opts.system }] : []),
          { role: 'user', content: [
            { type: 'image_url', image_url: { url: `data:${opts.image.mediaType};base64,${opts.image.base64}` } },
            { type: 'text', text: opts.text },
          ] },
        ],
        max_tokens: opts.maxTokens ?? 2048,
      }
    : {
        messages: [
          ...(opts.system ? [{ role: 'system', content: opts.system }] : []),
          { role: 'user', content: opts.text },
        ],
        max_tokens: opts.maxTokens ?? 2048,
      };
  const r: any = await env.AI.run(model as any, aiOpts);
  const text = typeof r === 'string' ? r : (r?.response || r?.choices?.[0]?.message?.content || '');
  return { text: String(text), model };
}

/**
 * Run the AI fallback chain. Returns the first provider's successful response,
 * or the first non-fallbackable error. Throws only when no provider in the
 * chain can answer.
 */
export async function callAi(env: CallAiEnv, opts: AiCallOpts): Promise<AiCallResult> {
  const chain = opts.providers && opts.providers.length > 0 ? opts.providers : DEFAULT_CHAIN;
  const errors: Array<{ provider: AiProvider; message: string }> = [];
  for (let i = 0; i < chain.length; i++) {
    const provider = chain[i];
    try {
      const { text, model } = await runProvider(provider, env, opts);
      return { text, provider, model, fellBack: i > 0 };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({ provider, message: msg });
      const last = i === chain.length - 1;
      const isKeyMissing = /key not configured/i.test(msg);
      if (!isKeyMissing && !isFallbackable(provider, err)) {
        throw err;
      }
      if (last) {
        throw new Error(`callAi: all providers failed — ${errors.map(e => `${e.provider}: ${e.message.slice(0,80)}`).join(' | ')}`);
      }
    }
  }
  throw new Error('callAi: empty provider chain');
}

/**
 * Convenience wrapper for vision calls. Identical to callAi(), but signals
 * intent at the call site that an image is being processed (and ensures
 * TypeScript treats the image as required).
 */
export async function callAiVision(
  env: CallAiEnv,
  opts: AiCallOpts & { image: { base64: string; mediaType: string } },
): Promise<AiCallResult> {
  return callAi(env, opts);
}

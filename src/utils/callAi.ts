// callAi — smart-fallback AI router. Tries providers in order
// (default: Claude → OpenAI → Workers AI), falling back on missing
// keys or recoverable errors (401, 402, 429-credit, 5xx). Does NOT
// fall back on 400 (bad request) or 429-without-credit-hint (transient
// rate limit) — those propagate so callers see real bugs.
//
// Consumers should prefer callAi() over callClaude() directly so the
// fallback chain works automatically when admins rotate keys.
//
// ── Cooldown circuit breaker ─────────────────────────────────────
// A paid provider that's out of credit (or has a revoked/misscoped key)
// fails the SAME way on every single call — but without a breaker every
// OCR/extraction request still pays the round-trip to find that out
// before falling back to Workers AI. Found live 2026-07-02: both the
// configured Anthropic AND OpenAI keys were exhausted, so every serve-
// intake scan was silently eating two dead HTTP calls (extra latency)
// before ever reaching the free model. Once a call fails in a way that
// won't self-heal within minutes (bad key, no permission, exhausted
// credit/quota), we cache that in KV for COOLDOWN_TTL_SECONDS so the
// next call skips straight past it — no extra network call, no wasted
// tokens. Best-effort: KV is optional and any KV error is swallowed, so
// this can never turn into a new failure mode of its own.

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

// KV is optional here (not every caller/test wires one up) — every KV
// operation below degrades to "not cooling down" / "don't record" rather
// than throwing when it's absent.
interface CallAiEnv { DB: D1Database; AI: Ai; KV?: KVNamespace; }

const DEFAULT_CHAIN: AiProvider[] = ['claude', 'openai', 'workers-ai'];

const COOLDOWN_TTL_SECONDS = 600; // 10 minutes — long enough to stop hammering a dead key, short enough to notice a top-up promptly.
const cooldownKey = (provider: AiProvider) => `ai_provider_down:${provider}`;

async function getCooldownReason(kv: KVNamespace | undefined, provider: AiProvider): Promise<string | null> {
  if (!kv) return null;
  try { return await kv.get(cooldownKey(provider)); } catch { return null; }
}

/** Read-only peek at a provider's cooldown state, for admin health checks — does
 *  not spend an API call (unlike an actual health probe). Null = not cooling down. */
export async function getProviderCooldownReason(kv: KVNamespace | undefined, provider: AiProvider): Promise<string | null> {
  return getCooldownReason(kv, provider);
}

async function setCooldown(kv: KVNamespace | undefined, provider: AiProvider, reason: string): Promise<void> {
  if (!kv) return;
  try {
    await kv.put(cooldownKey(provider), reason.slice(0, 200), { expirationTtl: COOLDOWN_TTL_SECONDS });
  } catch { /* best-effort — a KV write failure must never block the AI call it's tracking */ }
}

// A failure worth a cooldown is one that will keep failing on every retry
// until a human intervenes (bad/revoked key, no model permission, exhausted
// credit or quota) — as opposed to a transient blip (plain rate limit, 5xx)
// that might succeed on the very next request. Mirrors the credit-hint
// detection in isFallbackable() but is intentionally narrower: we only want
// to suppress calls we're confident are dead, not ones that are just having
// a bad moment.
function isPersistentFailure(provider: AiProvider, err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const { status } = provider === 'claude' ? diagnoseAnthropicError(msg) : diagnoseOpenAiError(msg);
  if (status === 401 || status === 403 || status === 402) return true;
  if (status === 400 || status === 429) {
    return /(credit|balance|fund|billing|quota|exceeded)/i.test(msg);
  }
  return false;
}

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
  // Anthropic returns HTTP 400 (not 402) for low-credit accounts in some
  // tiers, with the credit hint in the body. OpenAI's 400 is always a real
  // request bug. So gate 400-fallback on the credit hint.
  if (status === 400) {
    return /(credit|balance|fund|billing|quota|exceeded)/i.test(msg);
  }
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
  const raw = typeof r === 'string' ? r : (r?.response ?? r?.choices?.[0]?.message?.content ?? '');
  // Workers AI auto-parses JSON responses for prompts that elicit JSON
  // (expand/extract/verify). Downstream parsers run JSON.parse on strings,
  // so re-serialize objects/arrays defensively instead of String()-coercing
  // (which would join arrays with commas — the "expand crash" of [a,b]→"a,b").
  let text: string;
  if (typeof raw === 'string') text = raw;
  else if (raw == null) text = '';
  else if (typeof raw === 'object') text = JSON.stringify(raw);
  else text = String(raw);
  return { text, model };
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
    const last = i === chain.length - 1;

    // Workers AI has no key/billing state to cool down — only gate claude/openai.
    if (provider !== 'workers-ai') {
      const cooldownReason = await getCooldownReason(env.KV, provider);
      if (cooldownReason) {
        errors.push({ provider, message: `skipped — cooling down (${cooldownReason})` });
        if (last) {
          throw new Error(`callAi: all providers failed — ${errors.map(e => `${e.provider}: ${e.message.slice(0,80)}`).join(' | ')}`);
        }
        continue;
      }
    }

    try {
      const { text, model } = await runProvider(provider, env, opts);
      return { text, provider, model, fellBack: i > 0 };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({ provider, message: msg });
      const isKeyMissing = /key not configured/i.test(msg);
      if (provider !== 'workers-ai' && !isKeyMissing && isPersistentFailure(provider, err)) {
        await setCooldown(env.KV, provider, msg.slice(0, 150));
      }
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

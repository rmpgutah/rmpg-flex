// ============================================================
// configuredAi — call whichever AI provider the admin panel selected
// ============================================================
// The AI Settings dashboard (AIProvidersPanel / AICapabilitiesPanel) lets an
// admin pick a provider and store its key in system_config under
// `ai.config` + `ai.provider.<name>`. Until now nothing read that selection at
// request time: every /api/ai endpoint hard-coded env.AI (Workers AI), so the
// panel's provider dropdown was decorative.
//
// This module is the seam that honours it. It is deliberately NOT a second
// copy of src/utils/callAi.ts — that router serves OCR/extraction on the
// Claude -> OpenAI -> Workers AI chain with a KV circuit breaker, and its
// provider set (claude) does not overlap the panel's (groq/gemini/openai/
// ollama). Keep them separate; merging them would force one caller's provider
// list onto the other.
//
// Invariants:
//   - An external provider with NO stored key is never queued. Calling it
//     unauthenticated just buys a guaranteed 401 round-trip.
//   - `ollama` is never queued at all. It lives on localhost/LAN and
//     Cloudflare Workers cannot reach private network space — see
//     isPrivateHost(). The admin panel surfaces that limitation separately.
//   - The chain is never empty. If nothing resolves, workers-ai is appended
//     regardless of autoFallback, because an empty chain would turn an
//     "admin mis-configured a key" into a 500 on the officer's request.
// ============================================================

import { log } from './logger';

export type ConfiguredProviderName = 'workers-ai' | 'openai' | 'groq' | 'gemini' | 'ollama';

/** Providers the AI Settings panel can store a key for. */
export const EXTERNAL_PROVIDERS: ConfiguredProviderName[] = ['openai', 'groq', 'gemini', 'ollama'];

export const WORKERS_AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

const DEFAULT_MODELS: Record<ConfiguredProviderName, string> = {
  'workers-ai': WORKERS_AI_MODEL,
  openai: 'gpt-4o-mini',
  groq: 'llama-3.3-70b-versatile',
  gemini: 'gemini-1.5-flash',
  ollama: 'llama3',
};

export interface ProviderConfig {
  name: ConfiguredProviderName;
  model: string;
  apiKey?: string;
  baseUrl?: string;
}

/** Shape of one `ai.provider.<name>` row, as the admin panel saves it. */
export interface StoredProviderConfig {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  url?: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ConfiguredAiResult {
  content: string;
  provider: ConfiguredProviderName;
  model: string;
  latencyMs: number;
  /** True when an earlier provider in the chain was tried and failed. */
  fellBack: boolean;
}

export interface ConfiguredAiOpts {
  messages: ChatMessage[];
  system?: string;
  temperature?: number;
  maxTokens?: number;
  /** Per-provider request timeout. A stuck provider must not hang the request. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Hosts a Cloudflare Worker can never reach. Ollama's default deployment is
 * localhost:11434, so a configured Ollama provider is an architectural
 * dead end rather than a transient failure — we detect it up front and give
 * the admin an honest message instead of a misleading timeout.
 */
export function isPrivateHost(hostname: string): boolean {
  if (!hostname) return false;
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' || h === '::1') return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(h)) return true;
  if (h.endsWith('.local')) return true;
  return false;
}

/**
 * Order the providers to try, primary first, `workers-ai` last.
 *
 * `autoFallback === false` means "do not silently use a different paid
 * provider than the one I chose" — it does NOT mean "fail the request", so a
 * chain that would otherwise be empty still ends at the free Workers AI model.
 */
export function buildProviderChain(
  primary: string,
  autoFallback: boolean,
  stored: Partial<Record<string, StoredProviderConfig>>,
): ProviderConfig[] {
  const usable = (name: ConfiguredProviderName): ProviderConfig | null => {
    if (name === 'workers-ai') return { name, model: WORKERS_AI_MODEL };
    // Never queue Ollama: unreachable from the Workers runtime by design.
    if (name === 'ollama') return null;
    const cfg = stored[name];
    const apiKey = cfg?.apiKey?.trim();
    if (!apiKey) return null;
    return {
      name,
      model: cfg?.model?.trim() || DEFAULT_MODELS[name],
      apiKey,
      baseUrl: cfg?.baseUrl?.trim() || undefined,
    };
  };

  const chain: ProviderConfig[] = [];
  const seen = new Set<ConfiguredProviderName>();
  const push = (p: ProviderConfig | null) => {
    if (!p || seen.has(p.name)) return;
    seen.add(p.name);
    chain.push(p);
  };

  const requested = (primary || 'workers-ai') as ConfiguredProviderName;
  push(usable(requested));

  if (autoFallback) {
    for (const name of EXTERNAL_PROVIDERS) push(usable(name));
  }

  // Terminal fallback. Unconditional when nothing else resolved (see doc above).
  if (autoFallback || chain.length === 0) push(usable('workers-ai'));

  return chain;
}

/** Absolute URL for one provider's chat-completion endpoint. */
export function providerEndpoint(p: ProviderConfig): string {
  if (p.name === 'gemini') {
    const base = (p.baseUrl || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
    return `${base}/models/${p.model}:generateContent`;
  }
  const fallbackBase = p.name === 'groq'
    ? 'https://api.groq.com/openai/v1'
    : 'https://api.openai.com/v1';
  const base = (p.baseUrl || fallbackBase).replace(/\/+$/, '');
  return `${base}/chat/completions`;
}

/** Pull the assistant text out of whichever response envelope came back. */
export function extractProviderText(provider: ConfiguredProviderName, json: unknown): string {
  if (!json || typeof json !== 'object') return '';
  const j = json as Record<string, any>;
  if (provider === 'gemini') {
    const parts = j.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) return '';
    return parts.map((p: any) => (typeof p?.text === 'string' ? p.text : '')).join('').trim();
  }
  if (provider === 'workers-ai') {
    return typeof j.response === 'string' ? j.response.trim() : '';
  }
  const content = j.choices?.[0]?.message?.content;
  return typeof content === 'string' ? content.trim() : '';
}

function buildRequest(p: ProviderConfig, opts: ConfiguredAiOpts): { url: string; init: RequestInit } {
  const url = providerEndpoint(p);
  if (p.name === 'gemini') {
    return {
      // Gemini takes the key as a header rather than a query param so it never
      // lands in a proxy/access log as part of the URL.
      url,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': p.apiKey ?? '' },
        body: JSON.stringify({
          ...(opts.system ? { system_instruction: { parts: [{ text: opts.system }] } } : {}),
          contents: opts.messages.map((m) => ({
            // Gemini has no 'system' role in contents, and calls the model turn 'model'.
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
          })),
          generationConfig: {
            temperature: opts.temperature ?? 0.7,
            maxOutputTokens: opts.maxTokens ?? 1024,
          },
        }),
      },
    };
  }
  return {
    url,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.apiKey ?? ''}` },
      body: JSON.stringify({
        model: p.model,
        messages: [
          ...(opts.system ? [{ role: 'system', content: opts.system }] : []),
          ...opts.messages,
        ],
        temperature: opts.temperature ?? 0.7,
        max_tokens: opts.maxTokens ?? 1024,
      }),
    },
  };
}

async function runOne(
  env: { AI: Ai },
  p: ProviderConfig,
  opts: ConfiguredAiOpts,
): Promise<string> {
  if (p.name === 'workers-ai') {
    // The binding is absent in the Miniflare test pool and on any environment
    // deployed without `[ai]` in wrangler.toml. Say so, rather than letting a
    // "cannot read properties of undefined (reading 'run')" reach the admin.
    if (!env?.AI) throw new Error('Workers AI binding is not available on this environment');
    const res = await (env.AI as Ai).run(p.model as any, {
      messages: [
        ...(opts.system ? [{ role: 'system', content: opts.system }] : []),
        ...opts.messages,
      ],
      ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
      ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
    } as any);
    return extractProviderText('workers-ai', res);
  }

  const { url, init } = buildRequest(p, opts);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`${p.name} HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    const json = await res.json().catch(() => null);
    return extractProviderText(p.name, json);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Try each provider in order; return the first that yields non-empty text.
 *
 * An empty 200 counts as a failure — a provider that answers with "" has not
 * answered, and returning it would surface as a blank chat bubble with no
 * error for the admin to act on.
 */
export async function callConfiguredAi(
  env: { AI: Ai },
  chain: ProviderConfig[],
  opts: ConfiguredAiOpts,
): Promise<ConfiguredAiResult> {
  if (!chain.length) throw new Error('callConfiguredAi: no AI provider available');

  const started = Date.now();
  const errors: string[] = [];

  for (let i = 0; i < chain.length; i++) {
    const p = chain[i];
    try {
      const content = await runOne(env, p, opts);
      if (!content) throw new Error(`${p.name} returned an empty response`);
      return {
        content,
        provider: p.name,
        model: p.model,
        latencyMs: Date.now() - started,
        fellBack: i > 0,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`${p.name}: ${message.slice(0, 160)}`);
      log.warn('[configuredAi] provider failed', { provider: p.name, model: p.model, message });
    }
  }

  throw new Error(`callConfiguredAi: all AI providers failed — ${errors.join(' | ')}`);
}

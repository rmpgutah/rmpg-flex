import { describe, it, expect, beforeEach, vi } from 'vitest';
import { callAi } from '../src/utils/callAi';

// ── Test harness — minimal env stub ─────────────────────────────
// Build an env whose `DB.prepare(...).bind(...).first()` returns the
// configured fake row for a config_key query. The DB shape matches
// the D1 API surface our utils use via queryFirst().

function makeDb(configKeys: Record<string, string | null>): D1Database {
  const firstFor = (sql: string) => async () => {
    const m = /config_key = '([^']+)'/.exec(sql);
    const key = m?.[1];
    if (!key) return null;
    const v = configKeys[key];
    return v ? { config_value: v } : null;
  };
  return {
    prepare: (sql: string) => {
      const first = firstFor(sql);
      const all = async () => ({ results: [] });
      const run = async () => ({ success: true });
      return {
        first,
        all,
        run,
        bind: (..._args: any[]) => ({ first, all, run }),
      };
    },
  } as unknown as D1Database;
}

function makeWorkersAi(reply: string = 'workers-ai-reply') {
  return {
    run: vi.fn(async (_model: string, _opts: any) => ({ response: reply })),
  } as unknown as Ai;
}

function makeEnv(opts: { keys?: Record<string, string | null>; aiReply?: string } = {}) {
  return {
    DB: makeDb(opts.keys || {}),
    AI: makeWorkersAi(opts.aiReply),
  } as any;
}

// ── Tests ───────────────────────────────────────────────────────

describe('callAi router', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('uses Claude when its key is present and call succeeds', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ content: [{ type: 'text', text: 'claude-reply' }] }),
      { status: 200 },
    ));
    const env = makeEnv({ keys: { anthropic_api_key: 'sk-ant-test', openai_api_key: 'sk-test' } });

    const result = await callAi(env, { text: 'hi' });
    expect(result.text).toBe('claude-reply');
    expect(result.provider).toBe('claude');
    expect(result.fellBack).toBe(false);
  });

  it('falls back to OpenAI when Claude key is missing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ choices: [{ message: { content: 'openai-reply' } }] }),
      { status: 200 },
    ));
    const env = makeEnv({ keys: { openai_api_key: 'sk-test' } });

    const result = await callAi(env, { text: 'hi' });
    expect(result.text).toBe('openai-reply');
    expect(result.provider).toBe('openai');
    expect(result.fellBack).toBe(true);
  });

  it('falls back to OpenAI when Claude returns 401', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock.mockResolvedValueOnce(new Response('Invalid API key', { status: 401 }));
    fetchMock.mockResolvedValueOnce(new Response(
      JSON.stringify({ choices: [{ message: { content: 'openai-rescue' } }] }),
      { status: 200 },
    ));
    const env = makeEnv({ keys: { anthropic_api_key: 'sk-ant-bad', openai_api_key: 'sk-test' } });

    const result = await callAi(env, { text: 'hi' });
    expect(result.provider).toBe('openai');
    expect(result.text).toBe('openai-rescue');
  });

  it('falls back to OpenAI when Claude returns 429 with quota hint', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock.mockResolvedValueOnce(new Response('You exceeded your quota', { status: 429 }));
    fetchMock.mockResolvedValueOnce(new Response(
      JSON.stringify({ choices: [{ message: { content: 'openai-rescue' } }] }),
      { status: 200 },
    ));
    const env = makeEnv({ keys: { anthropic_api_key: 'sk-ant-broke', openai_api_key: 'sk-test' } });

    const result = await callAi(env, { text: 'hi' });
    expect(result.provider).toBe('openai');
  });

  it('falls back to Workers AI when both paid keys are missing', async () => {
    const env = makeEnv({ keys: {}, aiReply: 'llama-reply' });
    const result = await callAi(env, { text: 'hi' });
    expect(result.provider).toBe('workers-ai');
    expect(result.text).toBe('llama-reply');
    expect(result.fellBack).toBe(true);
  });

  it('does NOT fall back on Claude 400 (bad request, no credit hint — propagates)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('invalid prompt format', { status: 400 }));
    const env = makeEnv({ keys: { anthropic_api_key: 'sk-ant-test', openai_api_key: 'sk-test' } });

    await expect(callAi(env, { text: 'hi' })).rejects.toThrow(/Anthropic 400/);
  });

  it('DOES fall back on Claude 400 with credit-balance hint (Anthropic returns 400 for low credit)', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock.mockResolvedValueOnce(new Response('{"error":"credit balance too low"}', { status: 400 }));
    fetchMock.mockResolvedValueOnce(new Response(
      JSON.stringify({ choices: [{ message: { content: 'openai-rescue' } }] }),
      { status: 200 },
    ));
    const env = makeEnv({ keys: { anthropic_api_key: 'sk-ant-broke', openai_api_key: 'sk-test' } });

    const result = await callAi(env, { text: 'hi' });
    expect(result.provider).toBe('openai');
    expect(result.text).toBe('openai-rescue');
  });

  it('respects an explicit providers list', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ choices: [{ message: { content: 'openai-only' } }] }),
      { status: 200 },
    ));
    const env = makeEnv({ keys: { anthropic_api_key: 'sk-ant-test', openai_api_key: 'sk-test' } });

    const result = await callAi(env, { text: 'hi', providers: ['openai'] });
    expect(result.provider).toBe('openai');
    expect(result.fellBack).toBe(false);
  });
});

// ── Cooldown circuit breaker ─────────────────────────────────────
// Regression coverage for the 2026-07-02 finding: both configured paid keys
// were exhausted in production, and every OCR call was silently paying for
// two dead HTTP round-trips before falling back to Workers AI. A provider
// whose failure looks permanent (bad key / no credit / no quota) should be
// skipped WITHOUT a network call once it's been marked down.

function makeKv(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
  } as unknown as KVNamespace;
}

describe('callAi cooldown circuit breaker', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('marks Claude down after a credit-exhaustion failure and skips it on the next call', async () => {
    const kv = makeKv();
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    // First call: Claude 400 credit error, OpenAI rescues.
    fetchMock.mockResolvedValueOnce(new Response('{"error":"credit balance too low"}', { status: 400 }));
    fetchMock.mockResolvedValueOnce(new Response(
      JSON.stringify({ choices: [{ message: { content: 'openai-rescue-1' } }] }), { status: 200 },
    ));
    const env = { ...makeEnv({ keys: { anthropic_api_key: 'sk-ant-broke', openai_api_key: 'sk-test' } }), KV: kv };

    const first = await callAi(env, { text: 'hi' });
    expect(first.provider).toBe('openai');
    expect(fetchMock).toHaveBeenCalledTimes(2); // Claude attempted once, then OpenAI.
    expect(kv.put).toHaveBeenCalledWith('ai_provider_down:claude', expect.any(String), expect.objectContaining({ expirationTtl: expect.any(Number) }));

    // Second call: Claude should be skipped entirely (no fetch for it) — only
    // one fetch call total, straight to OpenAI.
    fetchMock.mockClear();
    fetchMock.mockResolvedValueOnce(new Response(
      JSON.stringify({ choices: [{ message: { content: 'openai-rescue-2' } }] }), { status: 200 },
    ));
    const second = await callAi(env, { text: 'hi again' });
    expect(second.provider).toBe('openai');
    expect(fetchMock).toHaveBeenCalledTimes(1); // Claude skipped — no wasted round-trip.
  });

  it('does not cool down on a transient (non-credit) failure', async () => {
    const kv = makeKv();
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock.mockResolvedValueOnce(new Response('Internal error', { status: 503 }));
    fetchMock.mockResolvedValueOnce(new Response(
      JSON.stringify({ choices: [{ message: { content: 'openai-rescue' } }] }), { status: 200 },
    ));
    const env = { ...makeEnv({ keys: { anthropic_api_key: 'sk-ant-test', openai_api_key: 'sk-test' } }), KV: kv };

    await callAi(env, { text: 'hi' });
    expect(kv.put).not.toHaveBeenCalled();
  });

  it('works fine with no KV bound at all (existing callers unaffected)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ content: [{ type: 'text', text: 'claude-reply' }] }), { status: 200 },
    ));
    const env = makeEnv({ keys: { anthropic_api_key: 'sk-ant-test' } }); // no KV property at all
    const result = await callAi(env, { text: 'hi' });
    expect(result.provider).toBe('claude');
  });
});

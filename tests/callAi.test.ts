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

  it('does NOT fall back on Claude 400 (bad request — propagates)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Bad request', { status: 400 }));
    const env = makeEnv({ keys: { anthropic_api_key: 'sk-ant-test', openai_api_key: 'sk-test' } });

    await expect(callAi(env, { text: 'hi' })).rejects.toThrow(/Anthropic 400/);
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

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { env } from 'cloudflare:test';
import app, { isModelAllowed } from '../src/index';
import { signCookieValue } from '../src/auth';
import { createConversation, getMessages } from '../src/db';

const AUTH_SECRET = 'test-cookie-secret';

function testEnv(overrides: Record<string, unknown> = {}) {
  return {
    DB: env.DB,
    OPENROUTER_API_KEY: 'test-key',
    GEMINI_API_KEY: 'test-gemini-key',
    BRAVE_API_KEY: 'test-brave-key',
    KIMI_CONNECT_PASSWORD: 'pw',
    AUTH_COOKIE_SECRET: AUTH_SECRET,
    ENABLE_KIMI_K3: 'false',
    ...overrides,
  };
}

async function authHeaders(): Promise<Record<string, string>> {
  const value = await signCookieValue(AUTH_SECRET);
  return {
    'Content-Type': 'application/json',
    Cookie: `kimi_connect_auth=${value}`,
  };
}

describe('route mounting (C1)', () => {
  it('serves health at plain /api/health (subdomain routing, no path prefix)', async () => {
    const res = await app.request('http://localhost/api/health', {}, testEnv());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('404s on a /kimi-connect-prefixed path, since the Worker is routed on its own subdomain now', async () => {
    const res = await app.request('http://localhost/kimi-connect/api/health', {}, testEnv());
    expect(res.status).toBe(404);
  });
});

describe('isModelAllowed (I1)', () => {
  it('allows all seven free models regardless of the flag', () => {
    for (const m of [
      'inclusionai/ling-3.0-flash:free',
      'poolside/laguna-xs-2.1:free',
      'cohere/north-mini-code:free',
      'nvidia/nemotron-3-ultra-550b-a55b:free',
      'nvidia/nemotron-3-super-120b-a12b:free',
      'google/gemma-4-26b-a4b-it:free',
      'openai/gpt-oss-20b:free',
    ]) {
      expect(isModelAllowed(m, 'false')).toBe(true);
    }
  });

  it('blocks kimi-k3 unless ENABLE_KIMI_K3 is exactly "true"', () => {
    expect(isModelAllowed('moonshotai/kimi-k3', 'false')).toBe(false);
    expect(isModelAllowed('moonshotai/kimi-k3', undefined)).toBe(false);
    expect(isModelAllowed('moonshotai/kimi-k3', 'true')).toBe(true);
  });

  it('blocks arbitrary models', () => {
    expect(isModelAllowed('openai/o3-pro', 'true')).toBe(false);
  });

  it('allows the three Gemini models regardless of the flag', () => {
    for (const m of ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite']) {
      expect(isModelAllowed(m, 'false')).toBe(true);
    }
  });
});

describe('POST /messages model allowlist (I1)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM messages');
    await env.DB.exec('DELETE FROM conversations');
    vi.restoreAllMocks();
  });

  it('rejects a model outside the allowlist with 400 and persists nothing', async () => {
    const convo = await createConversation(env.DB);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const res = await app.request(
      `http://localhost/api/conversations/${convo.id}/messages`,
      {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ content: 'hi', model: 'openai/gpt-4o' }),
      },
      testEnv()
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'model not allowed' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await getMessages(env.DB, convo.id)).toHaveLength(0);
  });

  it('rejects kimi-k3 when ENABLE_KIMI_K3 is false', async () => {
    const convo = await createConversation(env.DB);
    const res = await app.request(
      `http://localhost/api/conversations/${convo.id}/messages`,
      {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ content: 'hi', model: 'moonshotai/kimi-k3' }),
      },
      testEnv()
    );
    expect(res.status).toBe(400);
  });

  it('accepts an allowlisted model (proceeds to the stream)', async () => {
    const convo = await createConversation(env.DB);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                'data: {"choices":[{"delta":{"content":"hello"},"finish_reason":"stop"}]}\n\n'
              )
            );
            controller.close();
          },
        }),
        { status: 200 }
      )
    );
    const res = await app.request(
      `http://localhost/api/conversations/${convo.id}/messages`,
      {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ content: 'hi', model: 'inclusionai/ling-3.0-flash:free' }),
      },
      testEnv()
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
    await res.text();
  });

  it('rejects an unauthenticated request before touching the model', async () => {
    const convo = await createConversation(env.DB);
    const res = await app.request(
      `http://localhost/api/conversations/${convo.id}/messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'hi', model: 'deepseek/deepseek-r1:free' }),
      },
      testEnv()
    );
    expect(res.status).toBe(401);
  });

  it('routes a Gemini model to the Gemini endpoint with GEMINI_API_KEY', async () => {
    const convo = await createConversation(env.DB);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                'data: {"choices":[{"delta":{"content":"hi"},"finish_reason":"stop"}]}\n\n'
              )
            );
            controller.close();
          },
        }),
        { status: 200 }
      )
    );
    const res = await app.request(
      `http://localhost/api/conversations/${convo.id}/messages`,
      {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ content: 'hi', model: 'gemini-3.5-flash' }),
      },
      testEnv({ GEMINI_API_KEY: 'test-gemini-key' })
    );
    expect(res.status).toBe(200);
    await res.text();
    const [calledUrl, calledInit] = fetchSpy.mock.calls[0];
    expect(String(calledUrl)).toBe('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
    expect((calledInit as RequestInit).headers).toMatchObject({ Authorization: 'Bearer test-gemini-key' });
  });

  it('routes an OpenRouter model to the OpenRouter endpoint with OPENROUTER_API_KEY', async () => {
    const convo = await createConversation(env.DB);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                'data: {"choices":[{"delta":{"content":"hi"},"finish_reason":"stop"}]}\n\n'
              )
            );
            controller.close();
          },
        }),
        { status: 200 }
      )
    );
    const res = await app.request(
      `http://localhost/api/conversations/${convo.id}/messages`,
      {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ content: 'hi', model: 'nvidia/nemotron-3-ultra-550b-a55b:free' }),
      },
      testEnv()
    );
    expect(res.status).toBe(200);
    await res.text();
    const [calledUrl, calledInit] = fetchSpy.mock.calls[0];
    expect(String(calledUrl)).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect((calledInit as RequestInit).headers).toMatchObject({ Authorization: 'Bearer test-key' });
  });

  it('errors without persisting when a tool_call delta arrives with no id', async () => {
    const convo = await createConversation(env.DB);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"web_search","arguments":"{\\"query\\":\\"hi\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n'
              )
            );
            controller.close();
          },
        }),
        { status: 200 }
      )
    );
    const res = await app.request(
      `http://localhost/api/conversations/${convo.id}/messages`,
      {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ content: 'hi', model: 'nvidia/nemotron-3-ultra-550b-a55b:free' }),
      },
      testEnv()
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('event: error');
    expect(text).toContain('incomplete tool call');
    // Only the original user message — nothing corrupt was persisted.
    expect(await getMessages(env.DB, convo.id)).toHaveLength(1);
  });
});

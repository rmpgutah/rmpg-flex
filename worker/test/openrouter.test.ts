import { describe, it, expect, vi } from 'vitest';
import { buildOpenRouterRequest, streamChatCompletion, OpenRouterError } from '../src/openrouter';
import type { Message } from '../src/db';

const sampleMessages: Message[] = [
  { id: '1', role: 'user', content: 'Hello', model: null, created_at: 1 },
];

describe('buildOpenRouterRequest', () => {
  it('targets the OpenRouter chat completions endpoint', () => {
    const { url } = buildOpenRouterRequest(sampleMessages, 'deepseek/deepseek-r1:free');
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
  });

  it('sends the requested model and stream:true', () => {
    const { init } = buildOpenRouterRequest(sampleMessages, 'deepseek/deepseek-r1:free');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('deepseek/deepseek-r1:free');
    expect(body.stream).toBe(true);
  });

  it('maps message history to role/content pairs only', () => {
    const { init } = buildOpenRouterRequest(sampleMessages, 'deepseek/deepseek-r1:free');
    const body = JSON.parse(init.body as string);
    expect(body.messages).toEqual([{ role: 'user', content: 'Hello' }]);
  });
});

describe('streamChatCompletion', () => {
  it('returns the response body stream on success', async () => {
    const fakeStream = new ReadableStream();
    const fetchImpl = vi.fn().mockResolvedValue(new Response(fakeStream, { status: 200 }));
    const result = await streamChatCompletion('test-key', sampleMessages, 'deepseek/deepseek-r1:free', fetchImpl);
    expect(result).toBeInstanceOf(ReadableStream);
  });

  it('throws OpenRouterError on a non-2xx response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('rate limited', { status: 429 }));
    await expect(
      streamChatCompletion('test-key', sampleMessages, 'deepseek/deepseek-r1:free', fetchImpl)
    ).rejects.toThrow(OpenRouterError);
  });

  it('throws OpenRouterError with clear message when 2xx response has no body', async () => {
    const responseWithoutBody = new Response(null, { status: 200 });
    const fetchImpl = vi.fn().mockResolvedValue(responseWithoutBody);
    const error = await expect(
      streamChatCompletion('test-key', sampleMessages, 'deepseek/deepseek-r1:free', fetchImpl)
    ).rejects.toThrow(OpenRouterError);
    // Verify the error message indicates this is not a normal API error
    await expect(
      streamChatCompletion('test-key', sampleMessages, 'deepseek/deepseek-r1:free', fetchImpl)
    ).rejects.toThrow('no body');
  });
});

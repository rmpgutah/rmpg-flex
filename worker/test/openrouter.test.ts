import { describe, it, expect, vi } from 'vitest';
import {
  buildOpenRouterRequest,
  streamChatCompletion,
  mapMessagesToApi,
  OpenRouterError,
} from '../src/openrouter';
import type { Message } from '../src/db';

const textMessage: Message = {
  id: '1',
  role: 'user',
  content: 'Hello',
  content_type: 'text',
  model: null,
  tool_name: null,
  tool_call_id: null,
  tool_calls: null,
  created_at: 1,
};

const partsMessage: Message = {
  id: '2',
  role: 'user',
  content: JSON.stringify([{ type: 'text', text: 'describe this' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } }]),
  content_type: 'parts',
  model: null,
  tool_name: null,
  tool_call_id: null,
  tool_calls: null,
  created_at: 2,
};

const toolMessage: Message = {
  id: '3',
  role: 'tool',
  content: JSON.stringify({ results: [] }),
  content_type: 'text',
  model: null,
  tool_name: 'web_search',
  tool_call_id: 'call_abc',
  tool_calls: null,
  created_at: 3,
};


const assistantToolCallsMessage: Message = {
  id: '4',
  role: 'assistant',
  content: '',
  content_type: 'text',
  model: 'deepseek/deepseek-r1:free',
  tool_name: null,
  tool_call_id: null,
  tool_calls: JSON.stringify([
    { id: 'call_abc', type: 'function', function: { name: 'web_search', arguments: '{"query":"kimi"}' } },
  ]),
  created_at: 4,
};

const malformedPartsMessage: Message = {
  id: '5',
  role: 'user',
  content: 'not json {{{',
  content_type: 'parts',
  model: null,
  tool_name: null,
  tool_calls: null,
  tool_call_id: null,
  created_at: 5,
};

describe('mapMessagesToApi', () => {
  it('maps a text message to role/content', () => {
    expect(mapMessagesToApi([textMessage])).toEqual([{ role: 'user', content: 'Hello' }]);
  });

  it('maps a parts message by parsing its JSON content', () => {
    const [mapped] = mapMessagesToApi([partsMessage]);
    expect(mapped.role).toBe('user');
    expect(mapped.content).toEqual([
      { type: 'text', text: 'describe this' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } },
    ]);
  });

  it('includes tool_calls on an assistant message that requested tools', () => {
    const [mapped] = mapMessagesToApi([assistantToolCallsMessage]);
    expect(mapped.role).toBe('assistant');
    expect(mapped.tool_calls).toEqual([
      { id: 'call_abc', type: 'function', function: { name: 'web_search', arguments: '{"query":"kimi"}' } },
    ]);
  });

  it('replays an assistant tool_calls message before its tool result', () => {
    const mapped = mapMessagesToApi([assistantToolCallsMessage, toolMessage]);
    expect(mapped[0].tool_calls).toBeDefined();
    expect(mapped[1]).toEqual({
      role: 'tool',
      tool_call_id: 'call_abc',
      content: JSON.stringify({ results: [] }),
    });
  });

  it('omits tool_calls for assistant messages without any', () => {
    const [mapped] = mapMessagesToApi([{ ...assistantToolCallsMessage, tool_calls: null }]);
    expect(mapped.tool_calls).toBeUndefined();
  });

  it('falls back to plain text instead of throwing on malformed parts content', () => {
    expect(() => mapMessagesToApi([malformedPartsMessage])).not.toThrow();
    const [mapped] = mapMessagesToApi([malformedPartsMessage]);
    expect(mapped.content).toBe('not json {{{');
  });

  it('ignores malformed tool_calls JSON rather than throwing', () => {
    const [mapped] = mapMessagesToApi([{ ...assistantToolCallsMessage, tool_calls: 'nope {' }]);
    expect(mapped.tool_calls).toBeUndefined();
  });

  it('maps a tool message to role tool with tool_call_id', () => {
    expect(mapMessagesToApi([toolMessage])).toEqual([
      { role: 'tool', tool_call_id: 'call_abc', content: JSON.stringify({ results: [] }) },
    ]);
  });
});

describe('buildOpenRouterRequest', () => {
  const apiMessages = mapMessagesToApi([textMessage]);

  it('targets the OpenRouter chat completions endpoint', () => {
    const { url } = buildOpenRouterRequest(apiMessages, 'deepseek/deepseek-r1:free');
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
  });

  it('sends the requested model and stream:true', () => {
    const { init } = buildOpenRouterRequest(apiMessages, 'deepseek/deepseek-r1:free');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('deepseek/deepseek-r1:free');
    expect(body.stream).toBe(true);
  });

  it('omits tools when none are provided', () => {
    const { init } = buildOpenRouterRequest(apiMessages, 'deepseek/deepseek-r1:free');
    const body = JSON.parse(init.body as string);
    expect(body.tools).toBeUndefined();
  });

  it('includes tools and tool_choice auto when tools are provided', () => {
    const tools = [{ type: 'function' as const, function: { name: 'web_search', description: 'search', parameters: {} } }];
    const { init } = buildOpenRouterRequest(apiMessages, 'deepseek/deepseek-r1:free', tools);
    const body = JSON.parse(init.body as string);
    expect(body.tools).toEqual(tools);
    expect(body.tool_choice).toBe('auto');
  });
});

describe('streamChatCompletion', () => {
  const apiMessages = mapMessagesToApi([textMessage]);

  it('returns the response body stream on success', async () => {
    const fakeStream = new ReadableStream();
    const fetchImpl = vi.fn().mockResolvedValue(new Response(fakeStream, { status: 200 }));
    const result = await streamChatCompletion('test-key', apiMessages, 'deepseek/deepseek-r1:free', undefined, undefined, fetchImpl);
    expect(result).toBeInstanceOf(ReadableStream);
  });

  it('throws OpenRouterError on a non-2xx response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('rate limited', { status: 429 }));
    await expect(
      streamChatCompletion('test-key', apiMessages, 'deepseek/deepseek-r1:free', undefined, undefined, fetchImpl)
    ).rejects.toThrow(OpenRouterError);
  });

  it('throws a distinct OpenRouterError on a 2xx response with no body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    await expect(
      streamChatCompletion('test-key', apiMessages, 'deepseek/deepseek-r1:free', undefined, undefined, fetchImpl)
    ).rejects.toThrow(/no body/);
  });

  it('passes tools through to the request when provided', async () => {
    const fakeStream = new ReadableStream();
    const fetchImpl = vi.fn().mockResolvedValue(new Response(fakeStream, { status: 200 }));
    const tools = [{ type: 'function' as const, function: { name: 'web_search', description: 'search', parameters: {} } }];
    await streamChatCompletion('test-key', apiMessages, 'deepseek/deepseek-r1:free', tools, undefined, fetchImpl);
    const callBody = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(callBody.tools).toEqual(tools);
  });
});

describe('provider selection', () => {
  const apiMessages = mapMessagesToApi([textMessage]);

  it('defaults to the OpenRouter URL when no provider is given', () => {
    const { url } = buildOpenRouterRequest(apiMessages, 'some-model');
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
  });

  it('targets the Gemini OpenAI-compatible endpoint when provider is gemini', () => {
    const { url } = buildOpenRouterRequest(apiMessages, 'gemini-3.5-flash', undefined, 'gemini');
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
  });

  it('streamChatCompletion sends the request to the Gemini endpoint when provider is gemini', async () => {
    const fakeStream = new ReadableStream();
    const fetchImpl = vi.fn().mockResolvedValue(new Response(fakeStream, { status: 200 }));
    await streamChatCompletion('gemini-key', apiMessages, 'gemini-3.5-flash', undefined, 'gemini', fetchImpl);
    const [calledUrl] = fetchImpl.mock.calls[0];
    expect(String(calledUrl)).toBe('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
  });

  it('streamChatCompletion still defaults to OpenRouter when provider is omitted', async () => {
    const fakeStream = new ReadableStream();
    const fetchImpl = vi.fn().mockResolvedValue(new Response(fakeStream, { status: 200 }));
    await streamChatCompletion('or-key', apiMessages, 'some-model', undefined, undefined, fetchImpl);
    const [calledUrl] = fetchImpl.mock.calls[0];
    expect(String(calledUrl)).toBe('https://openrouter.ai/api/v1/chat/completions');
  });
});

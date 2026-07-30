import type { Message } from './db';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

export class OpenRouterError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type ApiMessage = {
  role: string;
  content?: unknown;
  tool_calls?: unknown;
  tool_call_id?: string;
};

export type ToolDefinition = {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

function safeParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function safeParseParts(raw: string): unknown {
  const parsed = safeParseJson(raw);
  return parsed === undefined ? raw : parsed;
}

export function mapMessagesToApi(messages: Message[]): ApiMessage[] {
  return messages.map((m) => {
    if (m.role === 'tool') {
      return { role: 'tool', tool_call_id: m.tool_call_id ?? undefined, content: m.content };
    }
    const base: ApiMessage =
      m.content_type === 'parts'
        ? // A malformed `parts` row must not throw and kill the whole request:
          // fall back to treating the stored content as plain text.
          { role: m.role, content: safeParseParts(m.content) }
        : { role: m.role, content: m.content };

    if (m.role === 'assistant' && m.tool_calls) {
      const toolCalls = safeParseJson(m.tool_calls);
      if (Array.isArray(toolCalls)) {
        return { ...base, tool_calls: toolCalls };
      }
    }
    return base;
  });
}

export function buildOpenRouterRequest(
  apiMessages: ApiMessage[],
  model: string,
  tools?: ToolDefinition[]
): { url: string; init: RequestInit } {
  const body: Record<string, unknown> = {
    model,
    stream: true,
    messages: apiMessages,
  };
  if (tools && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }
  return {
    url: OPENROUTER_URL,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  };
}

export async function streamChatCompletion(
  apiKey: string,
  apiMessages: ApiMessage[],
  model: string,
  tools?: ToolDefinition[],
  fetchImpl: typeof fetch = fetch
): Promise<ReadableStream<Uint8Array>> {
  const { url, init } = buildOpenRouterRequest(apiMessages, model, tools);
  const response = await fetchImpl(url, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${apiKey}` },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => 'unknown error');
    throw new OpenRouterError(response.status, text);
  }
  if (!response.body) {
    const text = await response.text().catch(() => 'unknown error');
    throw new OpenRouterError(response.status, `OpenRouter returned a 2xx response with no body: ${text}`);
  }

  return response.body;
}

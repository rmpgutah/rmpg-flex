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

export function mapMessagesToApi(messages: Message[]): ApiMessage[] {
  return messages.map((m) => {
    if (m.role === 'tool') {
      return { role: 'tool', tool_call_id: m.tool_call_id ?? undefined, content: m.content };
    }
    if (m.content_type === 'parts') {
      return { role: m.role, content: JSON.parse(m.content) };
    }
    return { role: m.role, content: m.content };
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

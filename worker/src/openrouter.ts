import type { Message } from './db';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

export class OpenRouterError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function buildOpenRouterRequest(
  messages: Message[],
  model: string
): { url: string; init: RequestInit } {
  return {
    url: OPENROUTER_URL,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: true,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      }),
    },
  };
}

export async function streamChatCompletion(
  apiKey: string,
  messages: Message[],
  model: string,
  fetchImpl: typeof fetch = fetch
): Promise<ReadableStream<Uint8Array>> {
  const { url, init } = buildOpenRouterRequest(messages, model);
  const response = await fetchImpl(url, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${apiKey}` },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => 'unknown error');
    throw new OpenRouterError(response.status, text);
  }

  if (!response.body) {
    throw new OpenRouterError(response.status, 'OpenRouter returned a 2xx response with no body');
  }

  return response.body;
}

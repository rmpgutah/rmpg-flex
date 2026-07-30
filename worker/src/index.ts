import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import {
  createConversation,
  listConversations,
  getConversation,
  getMessages,
  addMessage,
} from './db';
import { checkPassword, signCookieValue, verifyCookieValue } from './auth';
import { streamChatCompletion, mapMessagesToApi, OpenRouterError, type ApiMessage } from './openrouter';
import { webSearchToolDefinition, executeWebSearch } from './tools/webSearch';

export type Env = {
  DB: D1Database;
  OPENROUTER_API_KEY: string;
  BRAVE_API_KEY: string;
  KIMI_CONNECT_PASSWORD: string;
  AUTH_COOKIE_SECRET: string;
  ENABLE_KIMI_K3: string;
};

const COOKIE_NAME = 'kimi_connect_auth';

// Routed on its own subdomain (kimi-connect.rmpgutah.us/api/*, see
// wrangler.toml) rather than a path prefix on the apex domain, so no
// basePath is needed here — routes resolve at plain `/api/...`.
const app = new Hono<{ Bindings: Env }>();

const FREE_MODELS = [
  'inclusionai/ling-3.0-flash:free',
  'poolside/laguna-xs-2.1:free',
  'cohere/north-mini-code:free',
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
  'google/gemma-4-26b-a4b-it:free',
  'openai/gpt-oss-20b:free',
] as const;
const KIMI_K3_MODEL = 'moonshotai/kimi-k3';

export function isModelAllowed(model: string, enableKimiK3: string | undefined): boolean {
  if ((FREE_MODELS as readonly string[]).includes(model)) return true;
  return model === KIMI_K3_MODEL && enableKimiK3 === 'true';
}

app.get('/api/health', (c) => c.json({ ok: true }));

app.post('/api/auth', async (c) => {
  const { password } = await c.req.json<{ password: string }>();
  if (!checkPassword(password, c.env.KIMI_CONNECT_PASSWORD)) {
    return c.json({ error: 'incorrect password' }, 401);
  }
  const cookieValue = await signCookieValue(c.env.AUTH_COOKIE_SECRET);
  setCookie(c, COOKIE_NAME, cookieValue, {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
  return c.json({ ok: true });
});

app.use('/api/conversations/*', async (c, next) => {
  const cookieValue = getCookie(c, COOKIE_NAME);
  const valid = await verifyCookieValue(cookieValue, c.env.AUTH_COOKIE_SECRET);
  if (!valid) return c.json({ error: 'unauthorized' }, 401);
  await next();
});
app.use('/api/conversations', async (c, next) => {
  const cookieValue = getCookie(c, COOKIE_NAME);
  const valid = await verifyCookieValue(cookieValue, c.env.AUTH_COOKIE_SECRET);
  if (!valid) return c.json({ error: 'unauthorized' }, 401);
  await next();
});

app.get('/api/conversations', async (c) => {
  const conversations = await listConversations(c.env.DB);
  return c.json({ conversations });
});

app.post('/api/conversations', async (c) => {
  const conversation = await createConversation(c.env.DB);
  return c.json({ conversation });
});

app.get('/api/conversations/:id', async (c) => {
  const id = c.req.param('id');
  const conversation = await getConversation(c.env.DB, id);
  if (!conversation) return c.json({ error: 'not found' }, 404);
  const messages = await getMessages(c.env.DB, id);
  return c.json({ conversation, messages });
});

type StreamTurn = {
  contentText: string;
  toolCalls: Array<{ id: string; name: string; args: string }>;
  finishReason: string | null;
};

async function consumeAndForward(
  upstream: ReadableStream<Uint8Array>,
  forward: (chunk: Uint8Array) => Promise<void>
): Promise<StreamTurn> {
  const reader = upstream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let contentText = '';
  const toolCallsByIndex = new Map<number, { id: string; name: string; args: string }>();
  let finishReason: string | null = null;

  function processLine(line: string) {
    if (!line.startsWith('data: ') || line === 'data: [DONE]') return;
    try {
      const parsed = JSON.parse(line.slice('data: '.length));
      const delta = parsed.choices?.[0]?.delta;
      if (delta?.content) contentText += delta.content;
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls as Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }>) {
          const existing = toolCallsByIndex.get(tc.index) ?? { id: '', name: '', args: '' };
          if (tc.id) existing.id = tc.id;
          if (tc.function?.name) existing.name = tc.function.name;
          if (tc.function?.arguments) existing.args += tc.function.arguments;
          toolCallsByIndex.set(tc.index, existing);
        }
      }
      if (parsed.choices?.[0]?.finish_reason) finishReason = parsed.choices[0].finish_reason;
    } catch {
      // ignore malformed line
    }
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    await forward(value);
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) processLine(line);
  }
  buffer += decoder.decode();
  for (const line of buffer.split('\n')) processLine(line);

  return { contentText, toolCalls: Array.from(toolCallsByIndex.values()), finishReason };
}

app.post('/api/conversations/:id/messages', async (c) => {
  const id = c.req.param('id');
  const conversation = await getConversation(c.env.DB, id);
  if (!conversation) return c.json({ error: 'not found' }, 404);

  const body = await c.req.json<{ content: string; model: string; contentType?: 'text' | 'parts' }>();

  // Server-side allowlist: the frontend's disabled-option gate is trivially
  // bypassable with a raw request, and an arbitrary model is a billing risk.
  if (!isModelAllowed(body.model, c.env.ENABLE_KIMI_K3)) {
    return c.json({ error: 'model not allowed' }, 400);
  }

  await addMessage(c.env.DB, {
    conversationId: id,
    role: 'user',
    content: body.content,
    contentType: body.contentType ?? 'text',
  });

  const dbHistory = await getMessages(c.env.DB, id);
  const db = c.env.DB;
  const apiKey = c.env.OPENROUTER_API_KEY;
  const braveApiKey = c.env.BRAVE_API_KEY;
  const model = body.model;

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  async function writeSSE(event: string, data: unknown) {
    await writer.write(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
  }

  (async () => {
    try {
      let apiMessages: ApiMessage[] = mapMessagesToApi(dbHistory);
      let iterations = 0;
      let finalText = '';
      // Distinguishes a genuine final answer (which may legitimately be empty)
      // from exhausting the tool-iteration cap.
      let gotFinalAnswer = false;

      while (iterations < 5) {
        iterations++;
        const upstream = await streamChatCompletion(apiKey, apiMessages, model, [webSearchToolDefinition]);
        const turn = await consumeAndForward(upstream, (chunk) => writer.write(chunk));

        if (turn.toolCalls.length > 0 && turn.finishReason === 'tool_calls') {
          const toolCallsPayload = turn.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.name, arguments: tc.args },
          }));

          apiMessages = [
            ...apiMessages,
            {
              role: 'assistant',
              content: turn.contentText || null,
              tool_calls: toolCallsPayload,
            },
          ];

          // Persist the assistant tool_calls message BEFORE the tool result rows:
          // without it, replayed history has role:'tool' messages with no matching
          // preceding assistant message and OpenRouter 400s on every later turn.
          await addMessage(db, {
            conversationId: id,
            role: 'assistant',
            content: turn.contentText || '',
            model,
            toolCalls: JSON.stringify(toolCallsPayload),
          });

          for (const tc of turn.toolCalls) {
            let query = '';
            try {
              query = JSON.parse(tc.args || '{}').query ?? '';
            } catch {
              query = '';
            }
            await writeSSE('tool_call', { name: tc.name, query });

            const result =
              tc.name === 'web_search'
                ? await executeWebSearch(braveApiKey, query)
                : { error: `unknown tool ${tc.name}` };
            const resultText = JSON.stringify(result);

            await addMessage(db, {
              conversationId: id,
              role: 'tool',
              content: resultText,
              toolName: tc.name,
              toolCallId: tc.id,
            });
            apiMessages = [...apiMessages, { role: 'tool', tool_call_id: tc.id, content: resultText }];
          }
          continue;
        }

        finalText = turn.contentText;
        gotFinalAnswer = true;
        break;
      }

      if (gotFinalAnswer) {
        await addMessage(db, { conversationId: id, role: 'assistant', content: finalText, model });
      } else {
        await writeSSE('error', { message: 'Tool use limit reached' });
      }
      await writer.write(encoder.encode('data: [DONE]\n\n'));
    } catch (err) {
      const message = err instanceof OpenRouterError ? err.message : 'unknown error';
      await writeSSE('error', { message });
    } finally {
      await writer.close();
    }
  })();

  return new Response(readable, {
    headers: { 'Content-Type': 'text/event-stream' },
  });
});

export default app;

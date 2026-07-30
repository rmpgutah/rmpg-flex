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
import { streamChatCompletion, OpenRouterError } from './openrouter';

export type Env = {
  DB: D1Database;
  OPENROUTER_API_KEY: string;
  KIMI_CONNECT_PASSWORD: string;
  AUTH_COOKIE_SECRET: string;
  ENABLE_KIMI_K3: string;
};

const COOKIE_NAME = 'kimi_connect_auth';

const app = new Hono<{ Bindings: Env }>();

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

app.post('/api/conversations/:id/messages', async (c) => {
  const id = c.req.param('id');
  const conversation = await getConversation(c.env.DB, id);
  if (!conversation) return c.json({ error: 'not found' }, 404);

  const { content, model } = await c.req.json<{ content: string; model: string }>();
  await addMessage(c.env.DB, { conversationId: id, role: 'user', content });

  const history = await getMessages(c.env.DB, id);

  let upstream: ReadableStream<Uint8Array>;
  try {
    upstream = await streamChatCompletion(c.env.OPENROUTER_API_KEY, history, model);
  } catch (err) {
    const message = err instanceof OpenRouterError ? err.message : 'unknown error';
    return new Response(`event: error\ndata: ${JSON.stringify({ message })}\n\n`, {
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }

  const db = c.env.DB;
  let fullReply = '';
  const decoder = new TextDecoder();

  const tee = upstream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        fullReply += decoder.decode(chunk, { stream: true });
        controller.enqueue(chunk);
      },
      async flush() {
        const textChunks = fullReply
          .split('\n')
          .filter((line) => line.startsWith('data: ') && line !== 'data: [DONE]')
          .map((line) => {
            try {
              const parsed = JSON.parse(line.slice('data: '.length));
              return parsed.choices?.[0]?.delta?.content ?? '';
            } catch {
              return '';
            }
          })
          .join('');
        if (textChunks) {
          await addMessage(db, { conversationId: id, role: 'assistant', content: textChunks, model });
        }
      },
    })
  );

  return new Response(tee, {
    headers: { 'Content-Type': 'text/event-stream' },
  });
});

export default app;

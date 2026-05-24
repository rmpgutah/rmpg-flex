import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { D1Db } from '../worker-middleware/d1Helpers';
import { localNow } from '../worker-middleware/timeUtils';

export function mountAiRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  // GET /api/ai/status
  api.get('/status', async (c) => {
    return c.json({ provider: 'ollama', connected: false, model: 'qwen2.5:3b', note: 'AI requires local Ollama instance or desktop app' });
  });

  // POST /api/ai/analyze — Analyze text with AI
  api.post('/analyze', requireRole('admin', 'manager', 'supervisor', 'dispatcher'), async (c) => {
    return c.json({ error: 'AI analysis requires local Ollama instance', code: 'AI_NOT_AVAILABLE' }, 503);
  });

  // POST /api/ai/narrative — Generate narrative text
  api.post('/narrative', requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'), async (c) => {
    return c.json({ error: 'AI narrative generation requires local Ollama instance', code: 'AI_NOT_AVAILABLE' }, 503);
  });

  // POST /api/ai/smart-search
  api.post('/smart-search', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), async (c) => {
    return c.json({ error: 'AI smart search requires local Ollama instance', code: 'AI_NOT_AVAILABLE' }, 503);
  });

  // ─── Dev Chat ───────────────────────────────────────────
  const devChat = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  devChat.use('/*', authenticateToken);
  devChat.use('/*', requireRole('admin'));

  // POST /api/ai/dev-chat/chat
  devChat.post('/chat', async (c) => {
    const { message, sessionId, context } = await c.req.json();
    if (!message || !sessionId) return c.json({ error: 'message and sessionId required' }, 400);

    const db = new D1Db(c.env.DB);
    await db.prepare(`INSERT INTO ai_dev_chat (session_id, role, content) VALUES (?, 'user', ?)`).run(sessionId, message);

    try {
      const ollamaUrl = (c.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/+$/, '');
      const ollamaResp = await fetch(`${ollamaUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: c.env.AI_MODEL || 'qwen2.5:3b',
          messages: [
            { role: 'system', content: 'You are the RMPG Flex AI assistant for a police CAD/RMS system.' },
            { role: 'user', content: context ? `${context}\n\n${message}` : message },
          ],
          stream: false,
          options: { temperature: 0.4, num_predict: 2048 },
        }),
        signal: AbortSignal.timeout(60000),
      });

      if (!ollamaResp.ok) throw new Error(`Ollama returned ${ollamaResp.status}`);

      const data = await ollamaResp.json() as any;
      const response = data.message?.content || '';

      await db.prepare(`INSERT INTO ai_dev_chat (session_id, role, content) VALUES (?, 'assistant', ?)`).run(sessionId, response);
      return c.json({ response });
    } catch {
      await db.prepare(`INSERT INTO ai_dev_chat (session_id, role, content) VALUES (?, 'assistant', 'AI service unavailable')`).run(sessionId);
      return c.json({ error: 'AI chat requires local Ollama instance', code: 'AI_NOT_AVAILABLE' }, 503);
    }
  });

  // POST /api/ai/dev-chat/chat/stream — SSE streaming
  devChat.post('/chat/stream', async (c) => {
    const { message, sessionId, context } = await c.req.json();
    if (!message || !sessionId) return c.json({ error: 'message and sessionId required' }, 400);

    const db = new D1Db(c.env.DB);
    await db.prepare(`INSERT INTO ai_dev_chat (session_id, role, content) VALUES (?, 'user', ?)`).run(sessionId, message);

    try {
      const ollamaUrl = (c.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/+$/, '');
      const ollamaResp = await fetch(`${ollamaUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: c.env.AI_MODEL || 'qwen2.5:3b',
          messages: [
            { role: 'system', content: 'You are the RMPG Flex AI assistant for a police CAD/RMS system.' },
            { role: 'user', content: context ? `${context}\n\n${message}` : message },
          ],
          stream: true,
          options: { temperature: 0.4, num_predict: 2048 },
        }),
        signal: AbortSignal.timeout(120000),
      });

      if (!ollamaResp.ok) throw new Error(`Ollama returned ${ollamaResp.status}`);

      c.header('Content-Type', 'text/event-stream');
      c.header('Cache-Control', 'no-cache');
      c.header('Connection', 'keep-alive');

      const writable = (c as any).stream?.writable;
      if (!writable) return c.json({ error: 'Streaming not available' }, 500);

      let fullResponse = '';
      const reader = ollamaResp.body?.getReader();
      if (reader) {
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n').filter(Boolean);
          for (const line of lines) {
            try {
              const parsed = JSON.parse(line);
              const content = parsed.message?.content || parsed.response || '';
              if (content) {
                fullResponse += content;
                writable.write(new TextEncoder().encode(`data: ${JSON.stringify({ content })}\n\n`));
              }
              if (parsed.done) {
                writable.write(new TextEncoder().encode(`data: [DONE]\n\n`));
              }
            } catch { /* skip parse errors */ }
          }
        }
      }

      await db.prepare(`INSERT INTO ai_dev_chat (session_id, role, content) VALUES (?, 'assistant', ?)`).run(sessionId, fullResponse);
      return c.newResponse(null, { status: 200 });
    } catch {
      return c.json({ error: 'AI chat stream requires local Ollama instance', code: 'AI_NOT_AVAILABLE' }, 503);
    }
  });

  // GET /api/ai/dev-chat/history
  devChat.get('/history', async (c) => {
    const db = new D1Db(c.env.DB);
    const sessions = await db.prepare(
      'SELECT DISTINCT session_id, MIN(created_at) as created_at, MAX(created_at) as last_message FROM ai_dev_chat GROUP BY session_id ORDER BY last_message DESC LIMIT 50'
    ).all();
    return c.json(sessions);
  });

  // GET /api/ai/dev-chat/history/:sessionId
  devChat.get('/history/:sessionId', async (c) => {
    const db = new D1Db(c.env.DB);
    const sessionId = c.req.param('sessionId');
    const messages = await db.prepare(
      'SELECT id, role, content, created_at FROM ai_dev_chat WHERE session_id = ? ORDER BY id ASC'
    ).all(sessionId);
    return c.json(messages);
  });

  // DELETE /api/ai/dev-chat/history/:sessionId
  devChat.delete('/history/:sessionId', async (c) => {
    const db = new D1Db(c.env.DB);
    const sessionId = c.req.param('sessionId');
    await db.prepare('DELETE FROM ai_dev_chat WHERE session_id = ?').run(sessionId);
    return c.json({ success: true });
  });

  app.route('/api/ai/dev-chat', devChat);

  app.route('/api/ai', api);
}

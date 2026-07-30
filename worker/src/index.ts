import { Hono } from 'hono';

export type Env = {
  DB: D1Database;
  OPENROUTER_API_KEY: string;
  KIMI_CONNECT_PASSWORD: string;
  AUTH_COOKIE_SECRET: string;
  ENABLE_KIMI_K3: string;
};

const app = new Hono<{ Bindings: Env }>();

app.get('/api/health', (c) => c.json({ ok: true }));

export default app;

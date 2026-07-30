# kimi-connect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a password-protected, multi-conversation chat web app deployed on Cloudflare (Worker API + D1, Pages frontend), using free-tier OpenRouter models by default with a flagged path to Kimi K3.

**Architecture:** A Hono-based Cloudflare Worker exposes `/api/*` routes backed by a D1 database (`conversations`, `messages` tables) and proxies streamed chat completions to OpenRouter. A separate React (Vite) app on Cloudflare Pages renders the UI and talks to the Worker as same-origin requests under `/kimi-connect/api/*`.

**Tech Stack:** TypeScript, Hono, Cloudflare Workers, Cloudflare D1, Vitest, React 18 + Vite, Cloudflare Pages, `wrangler`.

## Global Constraints

- Secrets (`OPENROUTER_API_KEY`, `KIMI_CONNECT_PASSWORD`, `AUTH_COOKIE_SECRET`) are Worker secrets via `wrangler secret put`, never committed. Local dev uses `.dev.vars` (gitignored).
- `ENABLE_KIMI_K3` Worker var defaults to `false`; when `false` the frontend renders `moonshotai/kimi-k3` disabled in the model dropdown.
- No file uploads, vision input, or tool calling in v1.
- No signup flow — single shared password via `/api/auth`.
- Apps publish under one zone: Worker at `rmpgutah.us/kimi-connect/api/*`, Pages at `rmpgutah.us/kimi-connect/*`.
- D1 schema exactly as specified in the design doc (`conversations`, `messages` tables, see Task 2).

---

## File Structure

```
kimi-connect/
├── worker/
│   ├── src/
│   │   ├── index.ts        # Hono app, route wiring
│   │   ├── db.ts            # D1 query helpers
│   │   ├── auth.ts          # password check + cookie sign/verify
│   │   └── openrouter.ts    # request shaping + streaming call
│   ├── schema.sql
│   ├── test/
│   │   ├── db.test.ts
│   │   ├── auth.test.ts
│   │   └── openrouter.test.ts
│   ├── wrangler.toml
│   ├── package.json
│   └── tsconfig.json
└── frontend/
    ├── src/
    │   ├── main.tsx
    │   ├── App.tsx
    │   ├── api.ts            # fetch wrappers for Worker API
    │   └── components/
    │       ├── PasswordGate.tsx
    │       ├── Sidebar.tsx
    │       └── ChatPane.tsx
    ├── index.html
    ├── vite.config.ts
    ├── package.json
    └── tsconfig.json
```

---

### Task 1: Worker project scaffolding + D1 schema

**Files:**
- Create: `worker/package.json`
- Create: `worker/tsconfig.json`
- Create: `worker/wrangler.toml`
- Create: `worker/schema.sql`
- Create: `worker/src/index.ts`
- Create: `worker/.dev.vars` (gitignored, local-only placeholder values)
- Create: `worker/.gitignore`

**Interfaces:**
- Produces: a deployable Hono app skeleton (`GET /api/health` → `{ ok: true }`) and a D1 database bound as `env.DB`, so later tasks can write against `env.DB` without re-deriving bindings.

- [ ] **Step 1: Create `worker/package.json`**

```json
{
  "name": "kimi-connect-worker",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest run"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20260101.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "wrangler": "^4.0.0"
  },
  "dependencies": {
    "hono": "^4.6.0"
  }
}
```

- [ ] **Step 2: Create `worker/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "types": ["@cloudflare/workers-types", "vitest/globals"],
    "strict": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Create `worker/schema.sql`**

```sql
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT 'New chat',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  model TEXT,
  created_at INTEGER NOT NULL
);
```

- [ ] **Step 4: Create `worker/wrangler.toml`**

```toml
name = "kimi-connect-worker"
main = "src/index.ts"
compatibility_date = "2026-07-30"

[[d1_databases]]
binding = "DB"
database_name = "kimi-connect-db"
database_id = "REPLACE_AFTER_WRANGLER_D1_CREATE"

[vars]
ENABLE_KIMI_K3 = "false"

[[routes]]
pattern = "rmpgutah.us/kimi-connect/api/*"
zone_name = "rmpgutah.us"
```

Note: `database_id` is a placeholder. It gets filled in once `wrangler d1 create kimi-connect-db` is run against the user's real Cloudflare account — that's an infra step requiring their credentials, called out again in Task 9.

- [ ] **Step 5: Create `worker/.gitignore`**

```
node_modules/
.dev.vars
.wrangler/
dist/
```

- [ ] **Step 6: Create `worker/.dev.vars` (local dev only, gitignored)**

```
OPENROUTER_API_KEY=sk-or-placeholder
KIMI_CONNECT_PASSWORD=devpassword
AUTH_COOKIE_SECRET=dev-cookie-secret-change-me
```

- [ ] **Step 7: Create `worker/src/index.ts` with a health route**

```typescript
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
```

- [ ] **Step 8: Install dependencies**

Run: `cd worker && npm install`
Expected: installs without error, creates `node_modules/` and `package-lock.json`.

- [ ] **Step 9: Verify the skeleton runs**

Run: `cd worker && npm run dev`
Expected: wrangler starts a local dev server (Ctrl+C to stop after confirming `curl http://localhost:8787/api/health` returns `{"ok":true}`).

- [ ] **Step 10: Commit**

```bash
git add worker/
git commit -m "chore: scaffold Cloudflare Worker with Hono and D1 schema"
```

---

### Task 2: D1 query helpers (`db.ts`)

**Files:**
- Create: `worker/src/db.ts`
- Test: `worker/test/db.test.ts`

**Interfaces:**
- Consumes: `D1Database` binding (`env.DB`) from Task 1.
- Produces (used by Task 5's routes):
  - `createConversation(db: D1Database): Promise<{ id: string; title: string; created_at: number; updated_at: number }>`
  - `listConversations(db: D1Database): Promise<Array<{ id: string; title: string; created_at: number; updated_at: number }>>` — ordered by `updated_at` descending.
  - `getConversation(db: D1Database, id: string): Promise<{ id: string; title: string; created_at: number; updated_at: number } | null>`
  - `getMessages(db: D1Database, conversationId: string): Promise<Array<{ id: string; role: 'user' | 'assistant'; content: string; model: string | null; created_at: number }>>` — ordered by `created_at` ascending.
  - `addMessage(db: D1Database, params: { conversationId: string; role: 'user' | 'assistant'; content: string; model?: string }): Promise<void>` — also updates the parent conversation's `updated_at`, and if this is the conversation's first user message, sets `title` to the first 60 characters of `content`.

- [ ] **Step 1: Write the failing tests**

```typescript
// worker/test/db.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import {
  createConversation,
  listConversations,
  getConversation,
  getMessages,
  addMessage,
} from '../src/db';

describe('db helpers', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM messages');
    await env.DB.exec('DELETE FROM conversations');
  });

  it('creates a conversation with default title', async () => {
    const convo = await createConversation(env.DB);
    expect(convo.title).toBe('New chat');
    expect(convo.id).toBeTruthy();
  });

  it('lists conversations newest-updated first', async () => {
    const a = await createConversation(env.DB);
    const b = await createConversation(env.DB);
    await addMessage(env.DB, { conversationId: a.id, role: 'user', content: 'hello a' });
    const list = await listConversations(env.DB);
    expect(list[0].id).toBe(a.id);
    expect(list[1].id).toBe(b.id);
  });

  it('getConversation returns null for unknown id', async () => {
    const result = await getConversation(env.DB, 'nonexistent');
    expect(result).toBeNull();
  });

  it('addMessage sets title from first user message', async () => {
    const convo = await createConversation(env.DB);
    await addMessage(env.DB, { conversationId: convo.id, role: 'user', content: 'What is Kimi K3?' });
    const updated = await getConversation(env.DB, convo.id);
    expect(updated?.title).toBe('What is Kimi K3?');
  });

  it('addMessage does not overwrite title on later messages', async () => {
    const convo = await createConversation(env.DB);
    await addMessage(env.DB, { conversationId: convo.id, role: 'user', content: 'first message' });
    await addMessage(env.DB, { conversationId: convo.id, role: 'assistant', content: 'a reply', model: 'test-model' });
    await addMessage(env.DB, { conversationId: convo.id, role: 'user', content: 'second message' });
    const updated = await getConversation(env.DB, convo.id);
    expect(updated?.title).toBe('first message');
  });

  it('getMessages returns messages in chronological order', async () => {
    const convo = await createConversation(env.DB);
    await addMessage(env.DB, { conversationId: convo.id, role: 'user', content: 'one' });
    await addMessage(env.DB, { conversationId: convo.id, role: 'assistant', content: 'two', model: 'test-model' });
    const messages = await getMessages(env.DB, convo.id);
    expect(messages.map((m) => m.content)).toEqual(['one', 'two']);
  });
});
```

- [ ] **Step 2: Add Vitest Workers pool config so `cloudflare:test` and `env.DB` work**

Create `worker/vitest.config.ts`:

```typescript
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          d1Databases: { DB: 'kimi-connect-db' },
        },
      },
    },
  },
});
```

Add `@cloudflare/vitest-pool-workers` to `worker/package.json` devDependencies (`^0.6.0`), then run `cd worker && npm install`.

- [ ] **Step 3: Apply schema to the local test D1 instance and run tests to verify they fail**

Run: `cd worker && npx wrangler d1 execute kimi-connect-db --local --file=./schema.sql`
Run: `cd worker && npm test`
Expected: FAIL with "Cannot find module '../src/db'" (file doesn't exist yet).

- [ ] **Step 4: Implement `worker/src/db.ts`**

```typescript
export type Conversation = {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
};

export type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  model: string | null;
  created_at: number;
};

function newId(): string {
  return crypto.randomUUID();
}

export async function createConversation(db: D1Database): Promise<Conversation> {
  const id = newId();
  const now = Date.now();
  await db
    .prepare('INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .bind(id, 'New chat', now, now)
    .run();
  return { id, title: 'New chat', created_at: now, updated_at: now };
}

export async function listConversations(db: D1Database): Promise<Conversation[]> {
  const result = await db
    .prepare('SELECT id, title, created_at, updated_at FROM conversations ORDER BY updated_at DESC')
    .all<Conversation>();
  return result.results;
}

export async function getConversation(db: D1Database, id: string): Promise<Conversation | null> {
  const row = await db
    .prepare('SELECT id, title, created_at, updated_at FROM conversations WHERE id = ?')
    .bind(id)
    .first<Conversation>();
  return row ?? null;
}

export async function getMessages(db: D1Database, conversationId: string): Promise<Message[]> {
  const result = await db
    .prepare('SELECT id, role, content, model, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC')
    .bind(conversationId)
    .all<Message>();
  return result.results;
}

export async function addMessage(
  db: D1Database,
  params: { conversationId: string; role: 'user' | 'assistant'; content: string; model?: string }
): Promise<void> {
  const id = newId();
  const now = Date.now();

  await db
    .prepare('INSERT INTO messages (id, conversation_id, role, content, model, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, params.conversationId, params.role, params.content, params.model ?? null, now)
    .run();

  const isFirstUserMessage =
    params.role === 'user' &&
    (
      await db
        .prepare("SELECT COUNT(*) as count FROM messages WHERE conversation_id = ? AND role = 'user'")
        .bind(params.conversationId)
        .first<{ count: number }>()
    )?.count === 1;

  if (isFirstUserMessage) {
    const title = params.content.slice(0, 60);
    await db
      .prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?')
      .bind(title, now, params.conversationId)
      .run();
  } else {
    await db
      .prepare('UPDATE conversations SET updated_at = ? WHERE id = ?')
      .bind(now, params.conversationId)
      .run();
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd worker && npm test`
Expected: PASS, all 6 tests green.

- [ ] **Step 6: Commit**

```bash
git add worker/
git commit -m "feat: add D1 query helpers for conversations and messages"
```

---

### Task 3: Auth (password check + signed cookie)

**Files:**
- Create: `worker/src/auth.ts`
- Test: `worker/test/auth.test.ts`

**Interfaces:**
- Consumes: `env.KIMI_CONNECT_PASSWORD`, `env.AUTH_COOKIE_SECRET` from Task 1's `Env` type.
- Produces (used by Task 5's routes):
  - `checkPassword(input: string, expected: string): boolean`
  - `signCookieValue(secret: string): Promise<string>` — returns a value like `valid.<hmac-hex>`.
  - `verifyCookieValue(value: string | undefined, secret: string): Promise<boolean>`

- [ ] **Step 1: Write the failing tests**

```typescript
// worker/test/auth.test.ts
import { describe, it, expect } from 'vitest';
import { checkPassword, signCookieValue, verifyCookieValue } from '../src/auth';

describe('auth', () => {
  it('checkPassword accepts a matching password', () => {
    expect(checkPassword('correct-horse', 'correct-horse')).toBe(true);
  });

  it('checkPassword rejects a mismatched password', () => {
    expect(checkPassword('wrong', 'correct-horse')).toBe(false);
  });

  it('signs and verifies a cookie value with the same secret', async () => {
    const signed = await signCookieValue('test-secret');
    const valid = await verifyCookieValue(signed, 'test-secret');
    expect(valid).toBe(true);
  });

  it('rejects a cookie signed with a different secret', async () => {
    const signed = await signCookieValue('secret-a');
    const valid = await verifyCookieValue(signed, 'secret-b');
    expect(valid).toBe(false);
  });

  it('rejects an undefined cookie value', async () => {
    const valid = await verifyCookieValue(undefined, 'test-secret');
    expect(valid).toBe(false);
  });

  it('rejects a malformed cookie value', async () => {
    const valid = await verifyCookieValue('not-a-real-token', 'test-secret');
    expect(valid).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd worker && npm test`
Expected: FAIL with "Cannot find module '../src/auth'".

- [ ] **Step 3: Implement `worker/src/auth.ts`**

```typescript
export function checkPassword(input: string, expected: string): boolean {
  return input === expected;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function signCookieValue(secret: string): Promise<string> {
  const payload = 'valid';
  const mac = await hmacHex(secret, payload);
  return `${payload}.${mac}`;
}

export async function verifyCookieValue(value: string | undefined, secret: string): Promise<boolean> {
  if (!value) return false;
  const [payload, mac] = value.split('.');
  if (!payload || !mac) return false;
  const expectedMac = await hmacHex(secret, payload);
  return mac === expectedMac && payload === 'valid';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd worker && npm test`
Expected: PASS, all 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add worker/
git commit -m "feat: add password check and signed auth cookie helpers"
```

---

### Task 4: OpenRouter client (`openrouter.ts`)

**Files:**
- Create: `worker/src/openrouter.ts`
- Test: `worker/test/openrouter.test.ts`

**Interfaces:**
- Consumes: `env.OPENROUTER_API_KEY`; `Message[]` type from Task 2's `db.ts`.
- Produces (used by Task 5's routes):
  - `buildOpenRouterRequest(messages: Message[], model: string): { url: string; init: RequestInit }` — pure function, easy to unit test without network.
  - `streamChatCompletion(apiKey: string, messages: Message[], model: string, fetchImpl?: typeof fetch): Promise<ReadableStream<Uint8Array>>` — calls OpenRouter, returns the raw SSE body stream on success, throws `OpenRouterError` (exported class with `.status` and `.message`) on non-2xx response.

- [ ] **Step 1: Write the failing tests**

```typescript
// worker/test/openrouter.test.ts
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
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd worker && npm test`
Expected: FAIL with "Cannot find module '../src/openrouter'".

- [ ] **Step 3: Implement `worker/src/openrouter.ts`**

```typescript
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

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => 'unknown error');
    throw new OpenRouterError(response.status, text);
  }

  return response.body;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd worker && npm test`
Expected: PASS, all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add worker/
git commit -m "feat: add OpenRouter streaming chat completion client"
```

---

### Task 5: Wire up Worker routes

**Files:**
- Modify: `worker/src/index.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–4 (`db.ts`, `auth.ts`, `openrouter.ts`).
- Produces: the full `/api/*` surface described in the design doc, ready for the frontend (Tasks 6–8) to call.

- [ ] **Step 1: Replace `worker/src/index.ts` with full route wiring**

```typescript
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
```

- [ ] **Step 2: Manually verify the full flow locally**

Run: `cd worker && npm run dev`, then in another terminal:

```bash
curl -X POST http://localhost:8787/api/auth -H 'Content-Type: application/json' -d '{"password":"devpassword"}' -c /tmp/cookies.txt
curl -X POST http://localhost:8787/api/conversations -b /tmp/cookies.txt
```

Expected: first call returns `{"ok":true}` and sets a cookie; second call returns a new conversation JSON object. (The `/messages` streaming endpoint needs a real `OPENROUTER_API_KEY` in `.dev.vars` to fully verify — replace the placeholder with a real free-tier key before testing that route, or defer full verification to Task 9's deployment check.)

- [ ] **Step 3: Commit**

```bash
git add worker/
git commit -m "feat: wire up auth, conversations, and streaming chat routes"
```

---

### Task 6: Frontend scaffolding + password gate

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/tsconfig.json`
- Create: `frontend/index.html`
- Create: `frontend/src/main.tsx`
- Create: `frontend/src/App.tsx`
- Create: `frontend/src/api.ts`
- Create: `frontend/src/components/PasswordGate.tsx`
- Create: `frontend/.gitignore`

**Interfaces:**
- Consumes: `POST /api/auth` from Task 5.
- Produces (used by Tasks 7–8): `api.ts` exports `apiFetch(path: string, init?: RequestInit): Promise<Response>` — wraps `fetch` with `credentials: 'include'` and the `/kimi-connect/api` prefix, so later components never hardcode the base path.

- [ ] **Step 1: Create `frontend/package.json`**

```json
{
  "name": "kimi-connect-frontend",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.6.0",
    "vite": "^5.4.0"
  }
}
```

- [ ] **Step 2: Create `frontend/vite.config.ts`**

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/kimi-connect/',
  plugins: [react()],
  server: {
    proxy: {
      '/kimi-connect/api': {
        target: 'http://localhost:8787',
        rewrite: (path) => path.replace(/^\/kimi-connect\/api/, '/api'),
      },
    },
  },
});
```

- [ ] **Step 3: Create `frontend/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Create `frontend/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>kimi-connect</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Create `frontend/src/api.ts`**

```typescript
const API_BASE = '/kimi-connect/api';

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
}
```

- [ ] **Step 6: Create `frontend/src/components/PasswordGate.tsx`**

```tsx
import { useState } from 'react';
import { apiFetch } from '../api';

export function PasswordGate({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await apiFetch('/auth', {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      onSuccess();
    } else {
      setError('Incorrect password');
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
      />
      <button type="submit">Enter</button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
```

- [ ] **Step 7: Create `frontend/src/App.tsx`**

```tsx
import { useState } from 'react';
import { PasswordGate } from './components/PasswordGate';

export function App() {
  const [authenticated, setAuthenticated] = useState(false);

  if (!authenticated) {
    return <PasswordGate onSuccess={() => setAuthenticated(true)} />;
  }

  return <div>Authenticated — chat UI goes here (Tasks 7–8)</div>;
}
```

- [ ] **Step 8: Create `frontend/src/main.tsx`**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

- [ ] **Step 9: Create `frontend/.gitignore`**

```
node_modules/
dist/
```

- [ ] **Step 10: Install and manually verify**

Run: `cd frontend && npm install && npm run dev`
Expected: dev server starts; visiting it shows a password field. With the Worker also running (`cd worker && npm run dev` in another terminal) and the real `.dev.vars` password, submitting the correct password flips to the "Authenticated" placeholder text; wrong password shows "Incorrect password".

- [ ] **Step 11: Commit**

```bash
git add frontend/
git commit -m "feat: scaffold React frontend with password gate"
```

---

### Task 7: Sidebar + conversation list

**Files:**
- Create: `frontend/src/components/Sidebar.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `apiFetch` from Task 6; `GET /api/conversations`, `POST /api/conversations` from Task 5.
- Produces (used by Task 8): `Sidebar` calls `onSelect(conversationId: string)` when a conversation is clicked and `onSelect(newId)` after creating one, so `App.tsx` can track `activeConversationId` and pass it to `ChatPane`.

- [ ] **Step 1: Create `frontend/src/components/Sidebar.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { apiFetch } from '../api';

type Conversation = { id: string; title: string; updated_at: number };

export function Sidebar({
  activeId,
  onSelect,
}: {
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  const [conversations, setConversations] = useState<Conversation[]>([]);

  async function refresh() {
    const res = await apiFetch('/conversations');
    const data = await res.json<{ conversations: Conversation[] }>();
    setConversations(data.conversations);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleNewChat() {
    const res = await apiFetch('/conversations', { method: 'POST' });
    const data = await res.json<{ conversation: Conversation }>();
    await refresh();
    onSelect(data.conversation.id);
  }

  return (
    <nav>
      <button onClick={handleNewChat}>New chat</button>
      <ul>
        {conversations.map((c) => (
          <li key={c.id}>
            <button
              aria-current={c.id === activeId}
              onClick={() => onSelect(c.id)}
            >
              {c.title}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
```

- [ ] **Step 2: Wire `Sidebar` into `frontend/src/App.tsx`**

```tsx
import { useState } from 'react';
import { PasswordGate } from './components/PasswordGate';
import { Sidebar } from './components/Sidebar';

export function App() {
  const [authenticated, setAuthenticated] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  if (!authenticated) {
    return <PasswordGate onSuccess={() => setAuthenticated(true)} />;
  }

  return (
    <div style={{ display: 'flex' }}>
      <Sidebar activeId={activeId} onSelect={setActiveId} />
      <main>{activeId ? `Chat pane for ${activeId} goes here (Task 8)` : 'Select or start a chat'}</main>
    </div>
  );
}
```

- [ ] **Step 3: Manually verify**

Run both dev servers as in Task 6, log in, click "New chat" — expect a new entry to appear in the sidebar and the main area to show its id. Click between multiple created conversations and confirm the highlighted/active one updates.

- [ ] **Step 4: Commit**

```bash
git add frontend/
git commit -m "feat: add conversation sidebar with create/select"
```

---

### Task 8: Chat pane with streaming + model dropdown

**Files:**
- Create: `frontend/src/components/ChatPane.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `apiFetch` from Task 6; `GET /api/conversations/:id`, `POST /api/conversations/:id/messages` (SSE) from Task 5; `activeId` from Task 7.
- Produces: nothing further consumed by later tasks — this is the last app-logic task.

- [ ] **Step 1: Create `frontend/src/components/ChatPane.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { apiFetch } from '../api';

type Message = { id: string; role: 'user' | 'assistant'; content: string };

const FREE_MODELS = [
  { id: 'deepseek/deepseek-r1:free', label: 'DeepSeek R1 (free)' },
  { id: 'meta-llama/llama-3.3-70b-instruct:free', label: 'Llama 3.3 70B (free)' },
  { id: 'qwen/qwen-2.5-72b-instruct:free', label: 'Qwen 2.5 72B (free)' },
];
const KIMI_K3_MODEL = { id: 'moonshotai/kimi-k3', label: 'Kimi K3 (paid)' };

export function ChatPane({ conversationId, enableKimiK3 }: { conversationId: string; enableKimiK3: boolean }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [model, setModel] = useState(FREE_MODELS[0].id);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch(`/conversations/${conversationId}`)
      .then((res) => res.json<{ messages: Message[] }>())
      .then((data) => setMessages(data.messages));
  }, [conversationId]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || streaming) return;
    setError(null);

    const userMessage: Message = { id: crypto.randomUUID(), role: 'user', content: input };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setStreaming(true);

    const assistantId = crypto.randomUUID();
    setMessages((prev) => [...prev, { id: assistantId, role: 'assistant', content: '' }]);

    const res = await apiFetch(`/conversations/${conversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content: userMessage.content, model }),
    });

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.startsWith('event: error')) {
          setError('Something went wrong, try again or pick a different model.');
          continue;
        }
        if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
        try {
          const parsed = JSON.parse(line.slice('data: '.length));
          const delta: string = parsed.choices?.[0]?.delta?.content ?? '';
          if (delta) {
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + delta } : m))
            );
          }
        } catch {
          // ignore malformed lines
        }
      }
    }

    setStreaming(false);
  }

  return (
    <div>
      <select value={model} onChange={(e) => setModel(e.target.value)}>
        {FREE_MODELS.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
        <option value={KIMI_K3_MODEL.id} disabled={!enableKimiK3}>
          {KIMI_K3_MODEL.label}
        </option>
      </select>

      <ul>
        {messages.map((m) => (
          <li key={m.id}>
            <strong>{m.role}:</strong> {m.content}
          </li>
        ))}
      </ul>

      {error && <p role="alert">{error}</p>}

      <form onSubmit={handleSend}>
        <input value={input} onChange={(e) => setInput(e.target.value)} disabled={streaming} />
        <button type="submit" disabled={streaming}>
          Send
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Wire `ChatPane` into `frontend/src/App.tsx`**

```tsx
import { useState } from 'react';
import { PasswordGate } from './components/PasswordGate';
import { Sidebar } from './components/Sidebar';
import { ChatPane } from './components/ChatPane';

const ENABLE_KIMI_K3 = false;

export function App() {
  const [authenticated, setAuthenticated] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  if (!authenticated) {
    return <PasswordGate onSuccess={() => setAuthenticated(true)} />;
  }

  return (
    <div style={{ display: 'flex' }}>
      <Sidebar activeId={activeId} onSelect={setActiveId} />
      <main>
        {activeId ? (
          <ChatPane conversationId={activeId} enableKimiK3={ENABLE_KIMI_K3} />
        ) : (
          'Select or start a chat'
        )}
      </main>
    </div>
  );
}
```

Note: `ENABLE_KIMI_K3` is hardcoded `false` here for v1 simplicity, matching the design's default. Flipping it later (once the user funds a paid balance) is a one-line change, as specified.

- [ ] **Step 3: Manually verify end-to-end**

With both dev servers running and a real `OPENROUTER_API_KEY` set in `worker/.dev.vars`, log in, start a new chat, pick a free model, send a message, and confirm the reply streams in token-by-token. Refresh the page and confirm the conversation and its messages reload from D1. Try the wrong-password case again to confirm it still rejects correctly.

- [ ] **Step 4: Commit**

```bash
git add frontend/
git commit -m "feat: add chat pane with streaming responses and model picker"
```

---

### Task 9: Deployment (Cloudflare infra + secrets)

**Files:**
- Modify: `worker/wrangler.toml`
- Create: `docs/superpowers/plans/2026-07-30-kimi-connect-deploy-notes.md` (a short runbook, not code)

**Interfaces:**
- Consumes: everything from Tasks 1–8.
- Produces: a live deployment. This task requires the user's own Cloudflare credentials/account access and cannot be scripted end-to-end by an agent — it's presented as an explicit runbook.

- [ ] **Step 1: Create the D1 database and capture its id**

Run: `cd worker && npx wrangler d1 create kimi-connect-db`
Expected output includes a `database_id` — copy it.

- [ ] **Step 2: Update `worker/wrangler.toml` with the real `database_id`**

Replace the `REPLACE_AFTER_WRANGLER_D1_CREATE` placeholder from Task 1 with the id captured in Step 1.

- [ ] **Step 3: Apply schema to the remote D1 database**

Run: `cd worker && npx wrangler d1 execute kimi-connect-db --remote --file=./schema.sql`
Expected: confirms the two tables were created remotely.

- [ ] **Step 4: Set Worker secrets**

```bash
cd worker
npx wrangler secret put OPENROUTER_API_KEY
npx wrangler secret put KIMI_CONNECT_PASSWORD
npx wrangler secret put AUTH_COOKIE_SECRET
```

Each prompts interactively for the value — enter a real OpenRouter API key, a real chosen password, and a random long string (e.g. output of `openssl rand -hex 32`) respectively.

- [ ] **Step 5: Deploy the Worker**

Run: `cd worker && npm run deploy`
Expected: deploy succeeds and reports the Worker is live, routed at `rmpgutah.us/kimi-connect/api/*` per the `[[routes]]` block in `wrangler.toml` (requires `rmpgutah.us` to already be an active zone on this Cloudflare account — confirm in the dashboard if the route fails to attach).

- [ ] **Step 6: Build and deploy the frontend to Cloudflare Pages**

Run: `cd frontend && npm run build`
Then either connect the `frontend/` directory to a Cloudflare Pages project via the dashboard (Git integration) or run `npx wrangler pages deploy dist --project-name=kimi-connect-frontend`. Configure the Pages project's custom domain/route as `rmpgutah.us/kimi-connect/*` in the Cloudflare dashboard so it serves alongside the Worker's `/kimi-connect/api/*` route on the same zone.

- [ ] **Step 7: Verify the live deployment**

Visit `https://rmpgutah.us/kimi-connect/` in a browser, enter the real password, start a chat, and confirm a streamed response comes back from a free model.

- [ ] **Step 8: Write the deploy runbook doc and commit**

Create `docs/superpowers/plans/2026-07-30-kimi-connect-deploy-notes.md` summarizing Steps 1–7 above (as a checklist, for re-running after future changes), then:

```bash
git add worker/wrangler.toml docs/superpowers/plans/2026-07-30-kimi-connect-deploy-notes.md
git commit -m "chore: finalize D1 binding id and add deploy runbook"
```

---

## Self-Review Notes

- **Spec coverage:** auth (Task 3, 5), D1 schema exactly as specified (Task 1 `schema.sql`), all 5 API routes (Task 5), sidebar + multi-conversation UX (Task 7), streaming chat pane + model dropdown with disabled Kimi K3 entry (Task 8), error handling for wrong password / OpenRouter failures / D1 write issues (Task 5's route logic — D1 failure in `addMessage`'s `flush()` is unhandled by design, matching the spec's stated trade-off that the user still sees the streamed text even if the final persist fails), secrets management (Task 9), deployment under `rmpgutah.us/kimi-connect` (Task 1 routes + Task 9). All spec sections have a corresponding task.
- **Type consistency:** `Message` type defined in Task 2 (`db.ts`) is reused as-is by Task 4 (`openrouter.ts`) and Task 5 (`index.ts`); `Env` type defined in Task 1 is extended, not redefined, in Task 5.
- **Placeholder scan:** the only literal placeholder is `REPLACE_AFTER_WRANGLER_D1_CREATE` in Task 1's `wrangler.toml`, which is explicitly called out as intentional (filled in by Task 9's infra step, not fillable by a coding task since it requires the user's real Cloudflare account).

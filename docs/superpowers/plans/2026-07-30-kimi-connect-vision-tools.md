# kimi-connect Vision + Tool Calling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the already-complete kimi-connect Worker backend (Tasks 1-5 of the base plan) with vision (image attachments) and a generic tool-calling loop (with web search as the first real tool), then build the frontend (originally planned but not yet started) with these capabilities included from the start.

**Architecture:** D1's `messages` table gains `content_type`, `tool_name`, `tool_call_id` columns and a `tool` role. `worker/src/openrouter.ts` is refactored to work with plain OpenRouter-shaped API messages (`ApiMessage[]`) instead of DB rows directly, with a new `mapMessagesToApi` helper bridging the two. The `/api/conversations/:id/messages` route becomes a bounded loop (max 5 iterations) that calls OpenRouter, detects tool-call vs. final-answer responses, executes tools server-side, and persists only the human-visible artifacts (tool announcement + result, final answer) to D1.

**Tech Stack:** Same as base plan (TypeScript, Hono, Cloudflare Workers/D1, Vitest, React 18 + Vite, Cloudflare Pages) plus the Brave Search API for the web search tool.

## Global Constraints

- Since no deployment has happened yet (base plan's Task 9 never ran), `worker/schema.sql` and `worker/migrations/0001_init.sql` are edited in place — no data-preserving migration script is needed.
- `worker/schema.sql` and `worker/migrations/0001_init.sql` must stay in sync (per the existing drift-guard comments from the base plan's Task 2) — every schema change in this plan touches both files identically.
- New secret: `BRAVE_API_KEY` (Worker secret via `wrangler secret put`), server-side only, never sent to the frontend.
- Tool-call loop caps at 5 iterations; on exceeding the cap, emit `event: error` with message `"Tool use limit reached"` and stop, per the design addendum.
- Model capability flags (`vision`, `tools`) in the frontend default to `false` unless explicitly confirmed — no guessing which OpenRouter free models support what.
- Image uploads capped at 5MB client-side, rejected with an inline error before sending.
- All work happens in the existing worktree `/Users/rmpgutah/Kimi.ai-worktrees/kimi-connect`, branch `kimi-connect` — same as the base plan's Tasks 1-5.

---

## File Structure (new/changed vs. base plan)

```
worker/
├── schema.sql                    # MODIFIED: content_type, tool_name, tool_call_id columns; role CHECK extended
├── migrations/0001_init.sql      # MODIFIED: mirrors schema.sql (test-only)
├── src/
│   ├── db.ts                     # MODIFIED: Message type + addMessage/getMessages extended
│   ├── openrouter.ts             # MODIFIED: ApiMessage type, mapMessagesToApi, tools param
│   ├── index.ts                  # MODIFIED: /messages route becomes a tool-calling loop
│   └── tools/
│       └── webSearch.ts          # NEW: Brave Search API tool
├── test/
│   ├── db.test.ts                # MODIFIED: new columns covered
│   ├── openrouter.test.ts        # MODIFIED: new ApiMessage-based signature
│   └── webSearch.test.ts         # NEW
frontend/                          # NEW (none of this existed before this plan)
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── api.ts
│   └── components/
│       ├── PasswordGate.tsx
│       ├── Sidebar.tsx
│       └── ChatPane.tsx           # includes vision attach + tool_call rendering from the start
```

---

### Task 6: D1 schema extension for tool/vision support

**Files:**
- Modify: `worker/schema.sql`
- Modify: `worker/migrations/0001_init.sql`
- Modify: `worker/src/db.ts`
- Modify: `worker/test/db.test.ts`

**Interfaces:**
- Consumes: existing `db.ts` functions from the base plan's Task 2.
- Produces (used by Task 7): extended `Message` type with `content_type: 'text' | 'parts'`, `tool_name: string | null`, `tool_call_id: string | null`; `addMessage` accepts optional `contentType`, `toolName`, `toolCallId` params (all defaulting so existing call sites remain valid).

- [ ] **Step 1: Update `worker/schema.sql`**

Replace its contents with:

```sql
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT 'New chat',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- NOTE: this DDL is duplicated in migrations/0001_init.sql (test-only, used by
-- vitest-pool-workers' isolated Miniflare storage). If you change this file,
-- update migrations/0001_init.sql to match, and vice versa.
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  content TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'text' CHECK (content_type IN ('text', 'parts')),
  model TEXT,
  tool_name TEXT,
  tool_call_id TEXT,
  created_at INTEGER NOT NULL
);
```

- [ ] **Step 2: Update `worker/migrations/0001_init.sql`** with the identical `messages` table definition (same columns, same CHECK constraints) plus its own existing test-only header comment and the `conversations` table — mirror `schema.sql` exactly except for the file-specific header comments already present from the base plan's Task 2 fix round.

- [ ] **Step 3: Write the failing tests** (append to `worker/test/db.test.ts`, keep all existing tests as-is)

```typescript
// Add these to the existing describe('db helpers', ...) block in worker/test/db.test.ts
it('addMessage defaults content_type to text and nullable tool fields to null', async () => {
  const convo = await createConversation(env.DB);
  await addMessage(env.DB, { conversationId: convo.id, role: 'user', content: 'hello' });
  const messages = await getMessages(env.DB, convo.id);
  expect(messages[0].content_type).toBe('text');
  expect(messages[0].tool_name).toBeNull();
  expect(messages[0].tool_call_id).toBeNull();
});

it('addMessage stores a tool message with tool_name and tool_call_id', async () => {
  const convo = await createConversation(env.DB);
  await addMessage(env.DB, {
    conversationId: convo.id,
    role: 'tool',
    content: JSON.stringify({ results: [] }),
    toolName: 'web_search',
    toolCallId: 'call_abc123',
  });
  const messages = await getMessages(env.DB, convo.id);
  expect(messages[0].role).toBe('tool');
  expect(messages[0].tool_name).toBe('web_search');
  expect(messages[0].tool_call_id).toBe('call_abc123');
});

it('addMessage stores content_type parts for structured content', async () => {
  const convo = await createConversation(env.DB);
  const parts = JSON.stringify([{ type: 'text', text: 'describe this' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } }]);
  await addMessage(env.DB, { conversationId: convo.id, role: 'user', content: parts, contentType: 'parts' });
  const messages = await getMessages(env.DB, convo.id);
  expect(messages[0].content_type).toBe('parts');
  expect(JSON.parse(messages[0].content)).toHaveLength(2);
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd worker && npx wrangler d1 execute kimi-connect-db --local --file=./schema.sql` (re-applies the updated schema to the local dev D1 instance), then `npm test`.
Expected: FAIL — `content_type`/`tool_name`/`tool_call_id` are `undefined` on returned rows (columns not yet selected/typed in `db.ts`), and the `tool` role insert fails the old CHECK constraint if `db.ts`/schema weren't fully updated together. Confirm the failure is about missing columns/type, not an unrelated error.

- [ ] **Step 5: Implement the `worker/src/db.ts` changes**

Replace the `Message` type and `addMessage`/`getMessages` functions with:

```typescript
export type Message = {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  content_type: 'text' | 'parts';
  model: string | null;
  tool_name: string | null;
  tool_call_id: string | null;
  created_at: number;
};

export async function getMessages(db: D1Database, conversationId: string): Promise<Message[]> {
  const result = await db
    .prepare(
      'SELECT id, role, content, content_type, model, tool_name, tool_call_id, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC'
    )
    .bind(conversationId)
    .all<Message>();
  return result.results;
}

export async function addMessage(
  db: D1Database,
  params: {
    conversationId: string;
    role: 'user' | 'assistant' | 'tool';
    content: string;
    contentType?: 'text' | 'parts';
    model?: string;
    toolName?: string;
    toolCallId?: string;
  }
): Promise<void> {
  const id = newId();
  const now = Date.now();
  const contentType = params.contentType ?? 'text';

  await db
    .prepare(
      'INSERT INTO messages (id, conversation_id, role, content, content_type, model, tool_name, tool_call_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .bind(
      id,
      params.conversationId,
      params.role,
      params.content,
      contentType,
      params.model ?? null,
      params.toolName ?? null,
      params.toolCallId ?? null,
      now
    )
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

`createConversation`, `listConversations`, and `getConversation` are unchanged — leave them as-is.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd worker && npm test`
Expected: PASS, all tests green (existing db/auth/openrouter tests plus the 3 new ones from Step 3).

- [ ] **Step 7: Commit**

```bash
git add worker/schema.sql worker/migrations/0001_init.sql worker/src/db.ts worker/test/db.test.ts
git commit -m "feat: extend D1 schema and db helpers for tool and vision messages"
```

---

### Task 7: OpenRouter client refactor (ApiMessage + tools param)

**Files:**
- Modify: `worker/src/openrouter.ts`
- Modify: `worker/test/openrouter.test.ts`

**Interfaces:**
- Consumes: `Message` type from Task 6's `db.ts`.
- Produces (used by Tasks 8-9):
  - `export type ApiMessage = { role: string; content?: unknown; tool_calls?: unknown; tool_call_id?: string }`
  - `export type ToolDefinition = { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }`
  - `mapMessagesToApi(messages: Message[]): ApiMessage[]`
  - `buildOpenRouterRequest(apiMessages: ApiMessage[], model: string, tools?: ToolDefinition[]): { url: string; init: RequestInit }` — **signature changed**: first param is now `ApiMessage[]`, not `Message[]`.
  - `streamChatCompletion(apiKey: string, apiMessages: ApiMessage[], model: string, tools?: ToolDefinition[], fetchImpl?: typeof fetch): Promise<ReadableStream<Uint8Array>>` — **signature changed**: `apiMessages` is `ApiMessage[]`; `tools` is a new 4th param inserted before `fetchImpl` (previously the 4th param).
  - `OpenRouterError` — unchanged.

This is a breaking signature change from the base plan's Task 4/5. Task 9 (this plan) is the only caller that needs updating in `index.ts`.

- [ ] **Step 1: Write the failing tests** (replace `worker/test/openrouter.test.ts` entirely)

```typescript
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
  created_at: 3,
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
    const result = await streamChatCompletion('test-key', apiMessages, 'deepseek/deepseek-r1:free', undefined, fetchImpl);
    expect(result).toBeInstanceOf(ReadableStream);
  });

  it('throws OpenRouterError on a non-2xx response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('rate limited', { status: 429 }));
    await expect(
      streamChatCompletion('test-key', apiMessages, 'deepseek/deepseek-r1:free', undefined, fetchImpl)
    ).rejects.toThrow(OpenRouterError);
  });

  it('throws a distinct OpenRouterError on a 2xx response with no body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    await expect(
      streamChatCompletion('test-key', apiMessages, 'deepseek/deepseek-r1:free', undefined, fetchImpl)
    ).rejects.toThrow(/no body/);
  });

  it('passes tools through to the request when provided', async () => {
    const fakeStream = new ReadableStream();
    const fetchImpl = vi.fn().mockResolvedValue(new Response(fakeStream, { status: 200 }));
    const tools = [{ type: 'function' as const, function: { name: 'web_search', description: 'search', parameters: {} } }];
    await streamChatCompletion('test-key', apiMessages, 'deepseek/deepseek-r1:free', tools, fetchImpl);
    const callBody = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(callBody.tools).toEqual(tools);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd worker && npm test`
Expected: FAIL — `mapMessagesToApi` doesn't exist yet, and `buildOpenRouterRequest`/`streamChatCompletion` still have the old `Message[]`-based signature.

- [ ] **Step 3: Implement `worker/src/openrouter.ts`** (replace entirely)

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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd worker && npm test`
Expected: PASS, all tests green.

- [ ] **Step 5: Commit**

```bash
git add worker/src/openrouter.ts worker/test/openrouter.test.ts
git commit -m "refactor: OpenRouter client works with ApiMessage[] and accepts tools param"
```

---

### Task 8: Web search tool (Brave Search API)

**Files:**
- Create: `worker/src/tools/webSearch.ts`
- Test: `worker/test/webSearch.test.ts`

**Interfaces:**
- Consumes: `ToolDefinition` type from Task 7's `openrouter.ts`.
- Produces (used by Task 9):
  - `webSearchToolDefinition: ToolDefinition`
  - `executeWebSearch(apiKey: string, query: string, fetchImpl?: typeof fetch): Promise<WebSearchResult>` where `WebSearchResult = { results: Array<{ title: string; url: string; snippet: string }> } | { error: string }` — never throws.

- [ ] **Step 1: Write the failing tests**

```typescript
// worker/test/webSearch.test.ts
import { describe, it, expect, vi } from 'vitest';
import { executeWebSearch, webSearchToolDefinition } from '../src/tools/webSearch';

describe('webSearchToolDefinition', () => {
  it('declares a function tool named web_search with a query parameter', () => {
    expect(webSearchToolDefinition.type).toBe('function');
    expect(webSearchToolDefinition.function.name).toBe('web_search');
    expect(webSearchToolDefinition.function.parameters).toMatchObject({
      type: 'object',
      properties: { query: expect.any(Object) },
      required: ['query'],
    });
  });
});

describe('executeWebSearch', () => {
  it('returns up to 5 mapped results on success', async () => {
    const braveResponse = {
      web: {
        results: Array.from({ length: 8 }, (_, i) => ({
          title: `Result ${i}`,
          url: `https://example.com/${i}`,
          description: `Snippet ${i}`,
        })),
      },
    };
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(braveResponse), { status: 200 })
    );
    const result = await executeWebSearch('test-key', 'kimi k3', fetchImpl);
    expect('results' in result && result.results).toHaveLength(5);
    expect('results' in result && result.results[0]).toEqual({
      title: 'Result 0',
      url: 'https://example.com/0',
      snippet: 'Snippet 0',
    });
  });

  it('sends the query and API key to Brave', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ web: { results: [] } }), { status: 200 })
    );
    await executeWebSearch('test-key', 'kimi k3', fetchImpl);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain('q=kimi%20k3');
    expect(init.headers['X-Subscription-Token']).toBe('test-key');
  });

  it('returns an error shape on a non-2xx response, never throws', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('rate limited', { status: 429 }));
    const result = await executeWebSearch('test-key', 'kimi k3', fetchImpl);
    expect('error' in result).toBe(true);
  });

  it('returns an error shape on a network failure, never throws', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'));
    const result = await executeWebSearch('test-key', 'kimi k3', fetchImpl);
    expect('error' in result).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd worker && npm test`
Expected: FAIL with "Cannot find module '../src/tools/webSearch'".

- [ ] **Step 3: Implement `worker/src/tools/webSearch.ts`**

```typescript
import type { ToolDefinition } from '../openrouter';

export const webSearchToolDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'web_search',
    description: 'Search the web for current information and return the top results.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query' },
      },
      required: ['query'],
    },
  },
};

export type WebSearchResult =
  | { results: Array<{ title: string; url: string; snippet: string }> }
  | { error: string };

type BraveResponse = {
  web?: { results?: Array<{ title: string; url: string; description: string }> };
};

export async function executeWebSearch(
  apiKey: string,
  query: string,
  fetchImpl: typeof fetch = fetch
): Promise<WebSearchResult> {
  try {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`;
    const response = await fetchImpl(url, {
      headers: { Accept: 'application/json', 'X-Subscription-Token': apiKey },
    });

    if (!response.ok) {
      return { error: `Brave Search API returned status ${response.status}` };
    }

    const data = (await response.json()) as BraveResponse;
    const results = (data.web?.results ?? []).slice(0, 5).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.description,
    }));
    return { results };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'unknown error calling Brave Search' };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd worker && npm test`
Expected: PASS, all tests green.

- [ ] **Step 5: Commit**

```bash
git add worker/src/tools/webSearch.ts worker/test/webSearch.test.ts
git commit -m "feat: add Brave Search web_search tool"
```

---

### Task 9: Tool-calling loop route rewrite

**Files:**
- Modify: `worker/src/index.ts`

**Interfaces:**
- Consumes: `mapMessagesToApi`, `ApiMessage`, `streamChatCompletion`, `OpenRouterError` from Task 7; `webSearchToolDefinition`, `executeWebSearch` from Task 8; extended `addMessage`/`getMessages` from Task 6.
- Produces: the same `/api/*` route surface as the base plan's Task 5, but `/messages` now runs the tool-calling loop and emits an additional `event: tool_call` SSE frame (`{ name: string; query: string }`) that Task 12's frontend consumes.
- Consumes `env.BRAVE_API_KEY` — add it to the `Env` type.

- [ ] **Step 1: Replace the `/api/conversations/:id/messages` handler and imports in `worker/src/index.ts`**

Replace the top imports and the `Env` type:

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
```

Keep `COOKIE_NAME`, `app`, the `/api/health`, `/api/auth`, the two auth middleware `app.use` blocks, `GET /api/conversations`, `POST /api/conversations`, and `GET /api/conversations/:id` handlers exactly as they are — none of those change.

Replace the `POST /api/conversations/:id/messages` handler (and everything after it, up to but not including `export default app;`) with:

```typescript
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

      while (iterations < 5) {
        iterations++;
        const upstream = await streamChatCompletion(apiKey, apiMessages, model, [webSearchToolDefinition]);
        const turn = await consumeAndForward(upstream, (chunk) => writer.write(chunk));

        if (turn.toolCalls.length > 0 && turn.finishReason === 'tool_calls') {
          apiMessages = [
            ...apiMessages,
            {
              role: 'assistant',
              content: turn.contentText || null,
              tool_calls: turn.toolCalls.map((tc) => ({
                id: tc.id,
                type: 'function',
                function: { name: tc.name, arguments: tc.args },
              })),
            },
          ];

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
        break;
      }

      if (finalText) {
        await addMessage(db, { conversationId: id, role: 'assistant', content: finalText, model });
      } else if (iterations >= 5) {
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
```

Note: this route no longer returns early with a synchronous error-frame `Response` on `streamChatCompletion` failure (the base plan's Task 5 behavior) — the try/catch is now inside the async IIFE and writes an `event: error` SSE frame through the same stream, since the loop can fail on any iteration, not just the first. This is an intentional, necessary change from the base plan's simpler single-call version; the frontend's existing `event: error` handling (planned in Task 12) works the same way regardless of which iteration produced it.

- [ ] **Step 2: Manually verify locally**

Run: `cd worker && npm run dev`, then with real `OPENROUTER_API_KEY` and `BRAVE_API_KEY` values temporarily set in `.dev.vars` (do not commit them):

```bash
curl -X POST http://localhost:8787/api/auth -H 'Content-Type: application/json' -d '{"password":"devpassword"}' -c /tmp/cookies.txt
CONVO_ID=$(curl -s -X POST http://localhost:8787/api/conversations -b /tmp/cookies.txt | python3 -c 'import json,sys;print(json.load(sys.stdin)["conversation"]["id"])')
curl -N -X POST "http://localhost:8787/api/conversations/$CONVO_ID/messages" -b /tmp/cookies.txt -H 'Content-Type: application/json' -d '{"content":"Hello, no tools needed, just say hi.","model":"deepseek/deepseek-r1:free"}'
```

Expected: SSE stream with `data: {...}` content-delta frames and a final `data: [DONE]`, no `tool_call` events, for a prompt that doesn't need search. If real keys aren't available in this environment, note in the report that full live verification (especially the tool-call path, which needs a genuinely tool-capable model) is deferred to Task 13's deployment check, and instead run the full `npm test` suite to confirm no regressions in the unit-tested pieces (Tasks 6-8).

Also confirm `cd worker && npm test` still passes in full (no regressions from Tasks 1-8).

- [ ] **Step 3: Commit**

```bash
git add worker/src/index.ts
git commit -m "feat: rewrite /messages route as a bounded tool-calling loop"
```

---

### Task 10: Frontend scaffolding + password gate

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
- Consumes: `POST /api/auth` from Task 9 (unchanged from base plan).
- Produces (used by Tasks 11-12): `api.ts` exports `apiFetch(path: string, init?: RequestInit): Promise<Response>`.

This task is identical to the base plan's Task 6 — no vision/tools changes apply here, since auth and scaffolding are unaffected by this addendum.

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

  return <div>Authenticated — chat UI goes here (Tasks 11-12)</div>;
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
Expected: dev server starts; visiting it shows a password field. With the Worker also running (`cd worker && npm run dev`) and the real `.dev.vars` password, submitting the correct password flips to the "Authenticated" placeholder text; wrong password shows "Incorrect password".

- [ ] **Step 11: Commit**

```bash
git add frontend/
git commit -m "feat: scaffold React frontend with password gate"
```

---

### Task 11: Sidebar + conversation list

**Files:**
- Create: `frontend/src/components/Sidebar.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `apiFetch` from Task 10; `GET /api/conversations`, `POST /api/conversations` from Task 9 (unchanged from base plan).
- Produces (used by Task 12): `Sidebar` calls `onSelect(conversationId: string)`.

Identical to the base plan's Task 7 — unaffected by this addendum.

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
            <button aria-current={c.id === activeId} onClick={() => onSelect(c.id)}>
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
      <main>{activeId ? `Chat pane for ${activeId} goes here (Task 12)` : 'Select or start a chat'}</main>
    </div>
  );
}
```

- [ ] **Step 3: Manually verify**

Run both dev servers as in Task 10, log in, click "New chat" — expect a new entry in the sidebar and the main area to show its id. Click between multiple created conversations and confirm the active one updates.

- [ ] **Step 4: Commit**

```bash
git add frontend/
git commit -m "feat: add conversation sidebar with create/select"
```

---

### Task 12: Chat pane with streaming, vision, and tool-call rendering

**Files:**
- Create: `frontend/src/components/ChatPane.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `apiFetch` from Task 10; `GET /api/conversations/:id`, `POST /api/conversations/:id/messages` (SSE, now with `event: tool_call` frames) from Task 9; `activeId` from Task 11.
- Produces: nothing further consumed by later tasks.

This merges the base plan's Task 8 (streaming chat pane) with the vision attach UI and tool-call rendering from the design addendum, so the chat pane is built once with these capabilities from the start rather than retrofitted.

- [ ] **Step 1: Create `frontend/src/components/ChatPane.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../api';

type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

type Message = {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  content_type: 'text' | 'parts';
};

type ModelOption = { id: string; label: string; vision: boolean; tools: boolean };

const FREE_MODELS: ModelOption[] = [
  { id: 'deepseek/deepseek-r1:free', label: 'DeepSeek R1 (free)', vision: false, tools: false },
  { id: 'meta-llama/llama-3.3-70b-instruct:free', label: 'Llama 3.3 70B (free)', vision: false, tools: false },
  { id: 'qwen/qwen-2.5-72b-instruct:free', label: 'Qwen 2.5 72B (free)', vision: false, tools: false },
];
const KIMI_K3_MODEL: ModelOption = { id: 'moonshotai/kimi-k3', label: 'Kimi K3 (paid)', vision: true, tools: true };

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function ChatPane({ conversationId, enableKimiK3 }: { conversationId: string; enableKimiK3: boolean }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<string[]>([]);
  const [model, setModel] = useState(FREE_MODELS[0].id);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toolStatus, setToolStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const allModels = [...FREE_MODELS, KIMI_K3_MODEL];
  const selectedModel = allModels.find((m) => m.id === model) ?? FREE_MODELS[0];

  useEffect(() => {
    apiFetch(`/conversations/${conversationId}`)
      .then((res) => res.json<{ messages: Message[] }>())
      .then((data) => setMessages(data.messages));
    setAttachments([]);
    setToolStatus(null);
  }, [conversationId]);

  async function handleFiles(files: FileList | null) {
    if (!files || !selectedModel.vision) return;
    setError(null);
    for (const file of Array.from(files)) {
      if (file.size > MAX_IMAGE_BYTES) {
        setError(`"${file.name}" is over 5MB and was not attached.`);
        continue;
      }
      const dataUrl = await fileToDataUrl(file);
      setAttachments((prev) => [...prev, dataUrl]);
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    if (!selectedModel.vision) return;
    const items = Array.from(e.clipboardData.items).filter((item) => item.type.startsWith('image/'));
    if (items.length === 0) return;
    const files = items.map((item) => item.getAsFile()).filter((f): f is File => f !== null);
    const list = new DataTransfer();
    files.forEach((f) => list.items.add(f));
    handleFiles(list.files);
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if ((!input.trim() && attachments.length === 0) || streaming) return;
    setError(null);
    setToolStatus(null);

    const contentType: 'text' | 'parts' = attachments.length > 0 ? 'parts' : 'text';
    const outgoingContent: string =
      contentType === 'parts'
        ? JSON.stringify([
            ...(input.trim() ? [{ type: 'text', text: input } as ContentPart] : []),
            ...attachments.map((url) => ({ type: 'image_url', image_url: { url } }) as ContentPart),
          ])
        : input;

    const userMessage: Message = { id: crypto.randomUUID(), role: 'user', content: outgoingContent, content_type: contentType };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setAttachments([]);
    setStreaming(true);

    const assistantId = crypto.randomUUID();
    setMessages((prev) => [...prev, { id: assistantId, role: 'assistant', content: '', content_type: 'text' }]);

    const res = await apiFetch(`/conversations/${conversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content: outgoingContent, model, contentType }),
    });

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let currentEvent: string | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice('event: '.length);
          continue;
        }
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice('data: '.length);

        if (currentEvent === 'error') {
          try {
            const parsed = JSON.parse(raw);
            setError(parsed.message ?? 'Something went wrong, try again or pick a different model.');
          } catch {
            setError('Something went wrong, try again or pick a different model.');
          }
          currentEvent = null;
          continue;
        }

        if (currentEvent === 'tool_call') {
          try {
            const parsed = JSON.parse(raw);
            setToolStatus(`🔍 Searching the web for "${parsed.query}"…`);
          } catch {
            // ignore malformed tool_call frame
          }
          currentEvent = null;
          continue;
        }

        if (raw === '[DONE]') {
          setToolStatus(null);
          currentEvent = null;
          continue;
        }

        try {
          const parsed = JSON.parse(raw);
          const delta: string = parsed.choices?.[0]?.delta?.content ?? '';
          if (delta) {
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + delta } : m))
            );
          }
        } catch {
          // ignore malformed lines (including our own non-content event data lines)
        }
        currentEvent = null;
      }
    }

    setStreaming(false);
    setToolStatus(null);
  }

  function renderContent(m: Message) {
    if (m.content_type === 'text') return <span>{m.content}</span>;
    try {
      const parts = JSON.parse(m.content) as ContentPart[];
      return (
        <>
          {parts.map((p, i) =>
            p.type === 'text' ? (
              <span key={i}>{p.text}</span>
            ) : (
              <img key={i} src={p.image_url.url} alt="attachment" style={{ maxWidth: 200, display: 'block' }} />
            )
          )}
        </>
      );
    } catch {
      return <span>{m.content}</span>;
    }
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
            <strong>{m.role}:</strong> {renderContent(m)}
          </li>
        ))}
        {toolStatus && <li aria-live="polite">{toolStatus}</li>}
      </ul>

      {error && <p role="alert">{error}</p>}

      <form onSubmit={handleSend}>
        {attachments.length > 0 && (
          <div>
            {attachments.map((url, i) => (
              <span key={i}>
                <img src={url} alt="pending attachment" style={{ maxWidth: 60, maxHeight: 60 }} />
                <button type="button" onClick={() => setAttachments((prev) => prev.filter((_, idx) => idx !== i))}>
                  remove
                </button>
              </span>
            ))}
          </div>
        )}
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onPaste={handlePaste}
          disabled={streaming}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          disabled={streaming || !selectedModel.vision}
          onChange={(e) => handleFiles(e.target.files)}
        />
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

- [ ] **Step 3: Manually verify end-to-end**

With both dev servers running and real `OPENROUTER_API_KEY`/`BRAVE_API_KEY` set in `worker/.dev.vars`:
1. Log in, start a new chat, pick a free model, send a text message, confirm it streams in.
2. Confirm the image-attach file input is disabled for the default (non-vision) free models, matching `vision: false`.
3. Send a prompt likely to trigger a search (e.g. "search the web for today's date") against a tools-capable model if one is available; confirm the "🔍 Searching the web for…" status renders during the tool call and the final answer incorporates it. If no tools-capable free model is available to test against live, note this in the report and rely on Tasks 7-9's unit/integration coverage instead.
4. Refresh the page and confirm the full conversation — including any tool-result messages — reloads correctly from D1.

- [ ] **Step 4: Commit**

```bash
git add frontend/
git commit -m "feat: add chat pane with streaming, vision attachments, and tool-call rendering"
```

---

### Task 13: Deployment (Cloudflare infra + secrets)

**Files:**
- Modify: `worker/wrangler.toml`
- Create: `docs/superpowers/plans/2026-07-30-kimi-connect-deploy-notes.md`

**Interfaces:**
- Consumes: everything from Tasks 1-12.
- Produces: a live deployment. Requires the user's own Cloudflare and Brave accounts/credentials — presented as an explicit runbook, not scriptable end-to-end by an agent.

- [ ] **Step 1: Create the D1 database and capture its id**

Run: `cd worker && npx wrangler d1 create kimi-connect-db`
Copy the printed `database_id`.

- [ ] **Step 2: Update `worker/wrangler.toml`** — replace the `REPLACE_AFTER_WRANGLER_D1_CREATE` placeholder with the real id from Step 1.

- [ ] **Step 3: Apply schema to the remote D1 database**

Run: `cd worker && npx wrangler d1 execute kimi-connect-db --remote --file=./schema.sql`
Expected: confirms `conversations` and `messages` (with the extended columns from Task 6) were created remotely.

- [ ] **Step 4: Set Worker secrets**

```bash
cd worker
npx wrangler secret put OPENROUTER_API_KEY
npx wrangler secret put BRAVE_API_KEY
npx wrangler secret put KIMI_CONNECT_PASSWORD
npx wrangler secret put AUTH_COOKIE_SECRET
```

`BRAVE_API_KEY` comes from a free-tier Brave Search API signup (api.search.brave.com) — the user must create this account and key themselves.

- [ ] **Step 5: Deploy the Worker**

Run: `cd worker && npm run deploy`
Expected: deploy succeeds, routed at `rmpgutah.us/kimi-connect/api/*` (requires `rmpgutah.us` to already be an active zone on this Cloudflare account).

- [ ] **Step 6: Build and deploy the frontend to Cloudflare Pages**

Run: `cd frontend && npm run build`
Then connect `frontend/` to a Cloudflare Pages project (dashboard Git integration) or run `npx wrangler pages deploy dist --project-name=kimi-connect-frontend`. Configure the Pages project's route as `rmpgutah.us/kimi-connect/*` in the Cloudflare dashboard.

- [ ] **Step 7: Verify the live deployment**

Visit `https://rmpgutah.us/kimi-connect/` in a browser, log in, start a chat, confirm a streamed response from a free model, and confirm an image attachment + a web-search-triggering prompt both work against whichever models you've confirmed support them.

- [ ] **Step 8: Write the deploy runbook doc and commit**

Create `docs/superpowers/plans/2026-07-30-kimi-connect-deploy-notes.md` summarizing Steps 1-7 as a checklist, then:

```bash
git add worker/wrangler.toml docs/superpowers/plans/2026-07-30-kimi-connect-deploy-notes.md
git commit -m "chore: finalize D1 binding id and add deploy runbook"
```

---

## Self-Review Notes

- **Spec coverage:** schema extension (Task 6), OpenRouter client refactor with `tools` param (Task 7), web search tool (Task 8), bounded tool-calling loop with SSE `tool_call` events (Task 9), full frontend including vision attach UI, capability flags, and tool-call rendering (Tasks 10-12), deployment with the new `BRAVE_API_KEY` secret (Task 13). All addendum design sections have a corresponding task.
- **Type consistency:** `Message` type extended once in Task 6 and reused as-is by Task 7 (`mapMessagesToApi`) and Task 9 (`getMessages`/`addMessage` calls); `ApiMessage`/`ToolDefinition` defined in Task 7, reused by Task 8 (`ToolDefinition` import) and Task 9 (`ApiMessage`, `mapMessagesToApi`, `streamChatCompletion` with the new `tools` param position); `ModelOption` and SSE event handling in Task 12 match the exact `tool_call`/`error`/`[DONE]` frame shapes Task 9 emits.
- **Breaking-change flag:** Task 7 explicitly calls out that `buildOpenRouterRequest`/`streamChatCompletion`'s signatures change from the base plan's Task 4 (`Message[]` → `ApiMessage[]`, new `tools` param inserted before `fetchImpl`) and that Task 9 is the only downstream caller needing the update — no silent breakage of already-reviewed code.
- **Placeholder scan:** the only literal placeholder is `REPLACE_AFTER_WRANGLER_D1_CREATE` in Task 13, already present in `wrangler.toml` from the base plan and explicitly infra-only (requires the user's real Cloudflare account).

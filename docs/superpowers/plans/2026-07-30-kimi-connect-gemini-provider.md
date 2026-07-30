# kimi-connect Gemini Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Google Gemini as a second, provider-agnostic model source alongside OpenRouter, exposing three free, natively vision-capable Gemini models.

**Architecture:** `worker/src/openrouter.ts` generalizes from a hardcoded OpenRouter URL to a small provider table keyed by `'openrouter' | 'gemini'`. `worker/src/index.ts`'s model allowlist changes from a flat string array to `{id, provider}` pairs so the server (never the client) resolves which upstream/key a model uses. The frontend dropdown gains the three Gemini models with `vision: true`.

## Global Constraints

- `provider` parameters default to `'openrouter'` on `buildOpenRouterRequest`/`streamChatCompletion` so all existing call sites and tests (which don't pass a provider) keep working unchanged.
- New secret `GEMINI_API_KEY`, Worker secret only, never sent to the frontend.
- The client never chooses which provider/upstream a request hits — only a model id, resolved against the server-side allowlist.
- New Gemini models: `gemini-3.6-flash`, `gemini-3.5-flash`, `gemini-3.5-flash-lite`, all `vision: true, tools: true`.
- Work happens in the existing worktree `/Users/rmpgutah/Kimi.ai-worktrees/kimi-connect`, branch `kimi-connect`.

---

## File Structure

```
worker/src/openrouter.ts   # MODIFIED: provider table, provider param on build/stream functions
worker/src/index.ts        # MODIFIED: FREE_MODELS as {id,provider} pairs, GEMINI_API_KEY in Env, route picks apiKey by provider
worker/test/openrouter.test.ts  # MODIFIED: new tests for provider selection
worker/test/routes.test.ts      # MODIFIED: new tests for isModelAllowed resolving Gemini models
frontend/src/components/ChatPane.tsx  # MODIFIED: add 3 Gemini models to FREE_MODELS
```

---

### Task 1: Provider table in `openrouter.ts`

**Files:**
- Modify: `worker/src/openrouter.ts`
- Modify: `worker/test/openrouter.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces (used by Task 2): `export type Provider = 'openrouter' | 'gemini';` and updated signatures:
  - `buildOpenRouterRequest(apiMessages: ApiMessage[], model: string, tools?: ToolDefinition[], provider?: Provider): { url: string; init: RequestInit }` — `provider` defaults to `'openrouter'`.
  - `streamChatCompletion(apiKey: string, apiMessages: ApiMessage[], model: string, tools?: ToolDefinition[], provider?: Provider, fetchImpl?: typeof fetch): Promise<ReadableStream<Uint8Array>>` — `provider` inserted as the 5th param (before `fetchImpl`, which shifts to 6th), defaulting to `'openrouter'`.

- [ ] **Step 1: Write the failing tests** (append to `worker/test/openrouter.test.ts`, inside a new `describe` block — do not modify existing tests, since they rely on the default `provider` and must keep passing unchanged)

```typescript
// Add to worker/test/openrouter.test.ts, alongside existing imports/fixtures
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
```

Also add `Provider` to the existing top-of-file import from `../src/openrouter`:

```typescript
import {
  buildOpenRouterRequest,
  streamChatCompletion,
  mapMessagesToApi,
  OpenRouterError,
  type Provider,
} from '../src/openrouter';
```

(`Provider` is imported here only so the test file typechecks if you choose to annotate a variable with it; if you don't end up using the type directly, omit it from the import rather than leaving an unused import.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd worker && npm test`
Expected: FAIL — `buildOpenRouterRequest`/`streamChatCompletion` don't yet accept a `provider` argument, so the Gemini-targeting tests get the OpenRouter URL instead.

- [ ] **Step 3: Implement the provider table in `worker/src/openrouter.ts`**

Replace the top of the file (imports through `OPENROUTER_URL`) with:

```typescript
import type { Message } from './db';

export type Provider = 'openrouter' | 'gemini';

const PROVIDER_CONFIG: Record<Provider, { baseUrl: string }> = {
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1/chat/completions' },
  gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions' },
};
```

Replace `buildOpenRouterRequest` with:

```typescript
export function buildOpenRouterRequest(
  apiMessages: ApiMessage[],
  model: string,
  tools?: ToolDefinition[],
  provider: Provider = 'openrouter'
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
    url: PROVIDER_CONFIG[provider].baseUrl,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  };
}
```

Replace `streamChatCompletion` with:

```typescript
export async function streamChatCompletion(
  apiKey: string,
  apiMessages: ApiMessage[],
  model: string,
  tools?: ToolDefinition[],
  provider: Provider = 'openrouter',
  fetchImpl: typeof fetch = fetch
): Promise<ReadableStream<Uint8Array>> {
  const { url, init } = buildOpenRouterRequest(apiMessages, model, tools, provider);
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

Leave `OpenRouterError`, `ApiMessage`, `ToolDefinition`, `safeParseJson`, `safeParseParts`, and `mapMessagesToApi` exactly as they are — none of them change.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd worker && npm test`
Expected: PASS, all tests green — including the pre-existing tests that call `streamChatCompletion` with only 4 positional args (`apiKey, apiMessages, model, fetchImpl`-shaped calls become invalid under the new signature only if they pass a 5th positional arg expecting it to be `fetchImpl`; check the existing test file for any such call and fix it to pass `undefined` for `tools`/`provider` as needed, or pass `fetchImpl` by the correct new 6th position — read the existing test file first to confirm exact call shapes before assuming no changes are needed).

- [ ] **Step 5: Commit**

```bash
git add worker/src/openrouter.ts worker/test/openrouter.test.ts
git commit -m "feat: generalize openrouter.ts into a provider table (OpenRouter + Gemini)"
```

---

### Task 2: Model allowlist gains provider resolution + Gemini models

**Files:**
- Modify: `worker/src/index.ts`
- Modify: `worker/test/routes.test.ts`

**Interfaces:**
- Consumes: `Provider` type, updated `streamChatCompletion` signature from Task 1.
- Produces: `Env` type gains `GEMINI_API_KEY: string`. `isModelAllowed` and the `/messages` route now resolve a `Provider` per model, used to pick the correct API key and pass `provider` through to `streamChatCompletion`.

- [ ] **Step 1: Write the failing tests** (append to `worker/test/routes.test.ts`)

```typescript
// Add to the existing describe('isModelAllowed (I1)', ...) block
it('allows the three Gemini models regardless of the flag', () => {
  for (const m of ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite']) {
    expect(isModelAllowed(m, 'false')).toBe(true);
  }
});
```

Also add a new test verifying the route actually uses the Gemini key/endpoint for a Gemini model — add this as a new `it` inside the existing `describe('POST /messages model allowlist (I1)', ...)` block:

```typescript
it('routes a Gemini model to the Gemini endpoint with GEMINI_API_KEY', async () => {
  const convo = await createConversation(env.DB);
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              'data: {"choices":[{"delta":{"content":"hi"},"finish_reason":"stop"}]}\n\n'
            )
          );
          controller.close();
        },
      }),
      { status: 200 }
    )
  );
  const res = await app.request(
    `http://localhost/api/conversations/${convo.id}/messages`,
    {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({ content: 'hi', model: 'gemini-3.5-flash' }),
    },
    testEnv({ GEMINI_API_KEY: 'test-gemini-key' })
  );
  expect(res.status).toBe(200);
  await res.text();
  const [calledUrl, calledInit] = fetchSpy.mock.calls[0];
  expect(String(calledUrl)).toBe('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
  expect((calledInit as RequestInit).headers).toMatchObject({ Authorization: 'Bearer test-gemini-key' });
});
```

Also update `testEnv` at the top of the file to include a default `GEMINI_API_KEY`:

```typescript
function testEnv(overrides: Record<string, unknown> = {}) {
  return {
    DB: env.DB,
    OPENROUTER_API_KEY: 'test-key',
    GEMINI_API_KEY: 'test-gemini-key',
    BRAVE_API_KEY: 'test-brave-key',
    KIMI_CONNECT_PASSWORD: 'pw',
    AUTH_COOKIE_SECRET: AUTH_SECRET,
    ENABLE_KIMI_K3: 'false',
    ...overrides,
  };
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd worker && npm test`
Expected: FAIL — Gemini model ids aren't in the allowlist yet, and the route doesn't know about `GEMINI_API_KEY` or provider-based routing.

- [ ] **Step 3: Implement the changes in `worker/src/index.ts`**

Replace the imports and `Env` type at the top:

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
import { streamChatCompletion, mapMessagesToApi, OpenRouterError, type ApiMessage, type Provider } from './openrouter';
import { webSearchToolDefinition, executeWebSearch } from './tools/webSearch';

export type Env = {
  DB: D1Database;
  OPENROUTER_API_KEY: string;
  GEMINI_API_KEY: string;
  BRAVE_API_KEY: string;
  KIMI_CONNECT_PASSWORD: string;
  AUTH_COOKIE_SECRET: string;
  ENABLE_KIMI_K3: string;
};
```

Replace the `FREE_MODELS`/`KIMI_K3_MODEL`/`isModelAllowed` block with:

```typescript
type ModelEntry = { id: string; provider: Provider };

const FREE_MODELS: ModelEntry[] = [
  { id: 'inclusionai/ling-3.0-flash:free', provider: 'openrouter' },
  { id: 'poolside/laguna-xs-2.1:free', provider: 'openrouter' },
  { id: 'cohere/north-mini-code:free', provider: 'openrouter' },
  { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', provider: 'openrouter' },
  { id: 'nvidia/nemotron-3-super-120b-a12b:free', provider: 'openrouter' },
  { id: 'google/gemma-4-26b-a4b-it:free', provider: 'openrouter' },
  { id: 'openai/gpt-oss-20b:free', provider: 'openrouter' },
  { id: 'gemini-3.6-flash', provider: 'gemini' },
  { id: 'gemini-3.5-flash', provider: 'gemini' },
  { id: 'gemini-3.5-flash-lite', provider: 'gemini' },
];
const KIMI_K3_MODEL: ModelEntry = { id: 'moonshotai/kimi-k3', provider: 'openrouter' };

function resolveModel(model: string, enableKimiK3: string | undefined): ModelEntry | null {
  const found = FREE_MODELS.find((m) => m.id === model);
  if (found) return found;
  if (model === KIMI_K3_MODEL.id && enableKimiK3 === 'true') return KIMI_K3_MODEL;
  return null;
}

export function isModelAllowed(model: string, enableKimiK3: string | undefined): boolean {
  return resolveModel(model, enableKimiK3) !== null;
}
```

In the `/api/conversations/:id/messages` handler, replace the allowlist-check block and the `apiKey`/`model` setup:

```typescript
  const body = await c.req.json<{ content: string; model: string; contentType?: 'text' | 'parts' }>();

  // Server-side allowlist: the frontend's disabled-option gate is trivially
  // bypassable with a raw request, and an arbitrary model is a billing risk.
  const resolvedModel = resolveModel(body.model, c.env.ENABLE_KIMI_K3);
  if (!resolvedModel) {
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
  const apiKey = resolvedModel.provider === 'gemini' ? c.env.GEMINI_API_KEY : c.env.OPENROUTER_API_KEY;
  const braveApiKey = c.env.BRAVE_API_KEY;
  const model = resolvedModel.id;
  const provider = resolvedModel.provider;
```

And update the `streamChatCompletion` call inside the loop to pass `provider`:

```typescript
        const upstream = await streamChatCompletion(apiKey, apiMessages, model, [webSearchToolDefinition], provider);
```

Everything else in the handler (the tool-call loop body, persistence, SSE writing) stays exactly as it is — only the allowlist resolution, `apiKey` selection, and the `streamChatCompletion` call signature change.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd worker && npm test`
Expected: PASS, all tests green.

- [ ] **Step 5: Run typecheck**

Run: `cd worker && npx tsc --noEmit`
Expected: clean (no new errors).

- [ ] **Step 6: Commit**

```bash
git add worker/src/index.ts worker/test/routes.test.ts
git commit -m "feat: resolve model provider server-side, add 3 Gemini models to allowlist"
```

---

### Task 3: Frontend — add Gemini models to the dropdown

**Files:**
- Modify: `frontend/src/components/ChatPane.tsx`

**Interfaces:**
- Consumes: nothing new (no frontend code needs to know about providers — that's resolved server-side per Task 2's design).
- Produces: nothing consumed by later tasks — this is the last code task.

- [ ] **Step 1: Add the three Gemini models to `FREE_MODELS` in `frontend/src/components/ChatPane.tsx`**

Find the existing `FREE_MODELS` array and add these three entries (position doesn't matter functionally, but consider putting them first or grouped together for discoverability since they're the only genuinely vision-capable free options):

```typescript
const FREE_MODELS: ModelOption[] = [
  { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash (free, vision)', vision: true, tools: true },
  { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash (free, vision)', vision: true, tools: true },
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite (free, vision)', vision: true, tools: true },
  { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', label: 'Nemotron 3 Ultra 550B (free)', vision: false, tools: true },
  { id: 'nvidia/nemotron-3-super-120b-a12b:free', label: 'Nemotron 3 Super 120B (free)', vision: false, tools: true },
  { id: 'google/gemma-4-26b-a4b-it:free', label: 'Gemma 4 26B (free, vision)', vision: true, tools: true },
  { id: 'openai/gpt-oss-20b:free', label: 'GPT-OSS 20B (free)', vision: false, tools: true },
  { id: 'inclusionai/ling-3.0-flash:free', label: 'Ling 3.0 Flash (free)', vision: false, tools: false },
  { id: 'poolside/laguna-xs-2.1:free', label: 'Laguna XS 2.1 (free)', vision: false, tools: true },
  { id: 'cohere/north-mini-code:free', label: 'North Mini Code (free)', vision: false, tools: true },
];
```

(This replaces the array's current 7 entries with the same 7 plus the 3 new Gemini ones at the front — 10 total. `useState(FREE_MODELS[0].id)` further down the file automatically makes `gemini-3.6-flash` the new default selected model, which is fine — it's now the first, most-capable, vision-enabled free option.)

- [ ] **Step 2: Run typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Manually verify the dropdown**

Run `cd worker && npm run dev` and `cd frontend && npm run dev`, log in, start a chat, confirm the model dropdown lists all 10 models with Gemini's three at the top, and confirm the image-attach button is enabled when a Gemini (or Gemma) model is selected. Full send/response verification needs a real `GEMINI_API_KEY`, which isn't available in this environment — defer that to Task 4's deployment check.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/ChatPane.tsx
git commit -m "feat: add 3 free Gemini vision models to the model dropdown"
```

---

### Task 4: Deployment — GEMINI_API_KEY secret + redeploy + smoke test

**Files:**
- None (infra-only task).

**Interfaces:**
- Consumes: everything from Tasks 1-3.
- Produces: a live deployment with Gemini support. Requires the user's own Google AI Studio account — cannot be scripted by an agent past the point of needing a real key.

- [ ] **Step 1: Get a free Gemini API key**

Sign up / log in at [aistudio.google.com](https://aistudio.google.com), go to API keys, create a new key. This step needs the user directly — an agent cannot create the Google account or click through the consent flow.

- [ ] **Step 2: Set the Worker secret**

```bash
cd worker
npx wrangler secret put GEMINI_API_KEY
```

Paste the key from Step 1 when prompted.

- [ ] **Step 3: Deploy the Worker**

```bash
npm run deploy
```

- [ ] **Step 4: Build and deploy the frontend**

```bash
cd ../frontend
npm run build
npx wrangler pages deploy dist --project-name=kimi-connect-frontend --commit-dirty=true
```

- [ ] **Step 5: Smoke test against the real deployment**

Visit the live app, log in, and specifically verify the addendum's stated risk:
1. Send a plain-text message to `gemini-3.5-flash` — confirm streaming works.
2. Attach an image and send to a Gemini model — confirm real vision works (the first genuinely free, verified vision path in the app).
3. Prompt something that should trigger `web_search` against a Gemini model — confirm the tool-call loop's SSE `tool_call` frame renders and the final answer correctly incorporates the search result. This is the step most likely to reveal a format mismatch between Gemini's OpenAI-compatibility layer and OpenRouter's streaming shape — if it breaks, that's a follow-up bug to file, not something to silently paper over.

- [ ] **Step 6: Update the deploy runbook**

Add a short section to `docs/superpowers/plans/2026-07-30-kimi-connect-deploy-notes.md` noting the `GEMINI_API_KEY` secret step for future reference, then:

```bash
git add docs/superpowers/plans/2026-07-30-kimi-connect-deploy-notes.md
git commit -m "docs: add GEMINI_API_KEY to the deploy runbook"
```

---

## Self-Review Notes

- **Spec coverage:** provider table (Task 1), server-side provider resolution + Gemini models in the allowlist (Task 2), frontend dropdown (Task 3), secret + deploy + the addendum's stated tool-call-streaming risk explicitly smoke-tested (Task 4). All spec sections covered.
- **Backward compatibility:** Task 1 explicitly calls out that `provider` defaults preserve every existing call site's behavior, and Step 4 tells the implementer to check the existing test file for any positional-arg mismatches introduced by inserting `provider` before `fetchImpl` — this is the one place a careless transcription could silently break Task 1-9's already-reviewed code, so it's flagged rather than assumed safe.
- **Type consistency:** `Provider` type defined once in Task 1, reused by Task 2's `ModelEntry`/`resolveModel`/route handler and Task 1's own test file. No redefinition.
- **Placeholder scan:** none — Task 4's credential step is explicitly infra-only and requires the user's real Google account, same pattern as the base plan's D1/Brave signup steps.

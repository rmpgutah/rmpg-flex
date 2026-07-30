# kimi-connect — Internal Chat System Design

## Purpose

A personal, password-protected chat web app deployed on Cloudflare, using
free-tier LLMs via OpenRouter (with a documented, one-line path to switch to
Kimi K3 later once the user is willing/able to pay for it). Built to explore
chatting with Kimi-family models without incurring API cost today.

## Non-goals

- No multi-tenant user accounts / signup flow — single shared password.
- No support for arbitrary paid models by default — the model picker only
  lists free-tier OpenRouter models, with `moonshotai/kimi-k3` present but
  disabled behind a feature flag.
- No file uploads, vision input, or tool calling in v1.
- No automated e2e test suite — manual verification is sufficient for a
  personal tool.

## Architecture

Two independently deployed Cloudflare projects sharing one domain to avoid
CORS entirely:

- **Cloudflare Worker** (Hono framework) — serves all API routes under
  `rmpgutah.us/kimi-connect/api/*`, backed by a D1 database.
- **Cloudflare Pages** — serves the React frontend under
  `rmpgutah.us/kimi-connect/*`.

Both are configured as routes on the same `rmpgutah.us` zone (already on
Cloudflare), so the frontend can call `/kimi-connect/api/...` as same-origin
requests.

```
Browser
  │
  ├─ GET  /kimi-connect/*           → Cloudflare Pages (React app)
  │
  └─ *    /kimi-connect/api/*       → Cloudflare Worker
                                         │
                                         ├─ D1 (conversations, messages)
                                         └─ OpenRouter API (chat completions)
```

## Components

### Worker API (Hono)

| Route | Method | Purpose |
|---|---|---|
| `/api/auth` | POST | Check shared password, set signed HTTP-only cookie |
| `/api/conversations` | GET | List conversations (id, title, updated_at), newest first |
| `/api/conversations` | POST | Create a new empty conversation, return its id |
| `/api/conversations/:id` | GET | Fetch a conversation's full message history |
| `/api/conversations/:id/messages` | POST | Append a user message, stream back the assistant reply (SSE) |

All routes except `/api/auth` require the signed cookie; missing/invalid
cookie → 401.

### D1 Schema

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

Conversation `title` is set from the first user message (truncated), set
once at creation of the second row (first user message), never re-derived.

### Frontend (React, on Pages)

- **Password gate**: shown if the auth cookie is missing/invalid; posts to
  `/api/auth`, redirects into the app on success.
- **Sidebar**: list of conversations (from `GET /api/conversations`), a
  "New chat" button, click-to-switch.
- **Chat pane**: message list + input box + model dropdown. Dropdown lists
  a small hardcoded set of OpenRouter free models (e.g. DeepSeek R1 free,
  Llama 3.3 70B free, Qwen free) plus `moonshotai/kimi-k3` rendered
  disabled/grayed with a tooltip explaining it requires a paid OpenRouter
  balance.
- Sends messages to `POST /api/conversations/:id/messages`, renders the
  SSE stream token-by-token into the assistant bubble as it arrives.

## Data Flow

1. User types a message and hits send.
2. Frontend POSTs `{ content, model }` to
   `/api/conversations/:id/messages`.
3. Worker inserts the user message row into D1 immediately.
4. Worker loads the full message history for that conversation from D1,
   calls OpenRouter's `/chat/completions` with `stream: true`.
5. Worker relays the SSE stream back to the frontend as it arrives.
6. Frontend appends streamed tokens to the assistant bubble live.
7. Once the stream ends, Worker inserts the complete assistant message
   into D1 (with the `model` used).

## Error Handling

- **Auth**: wrong password → `401` with a generic "incorrect password"
  message (no lockout/rate-limit in v1 — out of scope for a personal tool
  behind a private domain).
- **OpenRouter failures** (rate limit, model unavailable, network error):
  the Worker catches the failure and emits a single SSE `error` event; the
  frontend renders it as a distinct error bubble ("Something went wrong,
  try again or pick a different model") rather than crashing the chat.
  The user's own message row (already saved in step 3) is preserved either
  way.
- **D1 write failure on final assistant-message save**: logged via
  `console.error` (visible in `wrangler tail` / Cloudflare dashboard); the
  user still sees the full streamed response in their browser even though
  it won't persist on reload. Acceptable trade-off for v1 — a lost
  in-flight write shouldn't erase an answer the user already received.

## Secrets & Configuration

- `OPENROUTER_API_KEY` — Worker secret (`wrangler secret put`).
- `KIMI_CONNECT_PASSWORD` — Worker secret, the shared password.
- `AUTH_COOKIE_SECRET` — Worker secret, used to sign the auth cookie.
- `ENABLE_KIMI_K3` — Worker var, boolean flag (default `false`) gating
  whether `moonshotai/kimi-k3` is selectable in the model dropdown. Flip to
  `true` once the user has funded an OpenRouter/Moonshot balance.

None of these are committed to the repo; local dev uses `.dev.vars`
(gitignored).

## Testing

- Vitest unit tests for: D1 query helpers (conversation/message CRUD), auth
  cookie sign/verify logic, and the OpenRouter request-shaping function.
- Manual click-through in the browser (create conversation, send message,
  switch conversation, refresh and confirm persistence, wrong-password
  case) before considering a milestone done.
- No automated e2e suite — out of scope for a personal tool.

## Deployment

- `wrangler deploy` for the Worker, `wrangler pages deploy` (or Pages Git
  integration) for the frontend.
- Both projects attached to the `rmpgutah.us` zone via Cloudflare route
  configuration, publishing at `rmpgutah.us/kimi-connect`.

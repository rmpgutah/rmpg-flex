# kimi-connect — Vision + Tool Calling Addendum

## Purpose

Extend the base kimi-connect chat system (already implemented: Tasks 1-5,
Worker backend complete) with two capabilities the original design
explicitly deferred: image attachments (vision) and tool calling. This
addendum supersedes the original design doc's Non-goals line "No file
uploads, vision input, or tool calling in v1."

Per explicit user decision: build the plumbing now so it's ready for
advanced/paid models (e.g. Kimi K3, once funded), even though today's
free-tier models may only partially support these features. One real tool
is implemented now — web search — rather than leaving tool-calling as
inert scaffolding.

## Non-goals

- No tools beyond web search in this addendum (more can be added later;
  the tool-calling loop is generic enough to support it).
- No verified, curated list of which specific OpenRouter free models
  support vision/tools — the frontend ships a conservative capability flag
  per model (default `false` unless the user has confirmed otherwise) and
  the user corrects it as they learn which models actually support what.
- No image editing/generation — attachment is read-only input to the model.
- No file types beyond images (no PDFs, audio, video) in this addendum.

## Schema Changes

```sql
ALTER TABLE messages ADD COLUMN content_type TEXT NOT NULL DEFAULT 'text'
  CHECK (content_type IN ('text', 'parts'));
```

- `role` CHECK constraint extends from `('user', 'assistant')` to
  `('user', 'assistant', 'tool')`.
- When `content_type = 'text'`, `content` is a plain string exactly as
  today — no behavior change for existing text-only messages.
- When `content_type = 'parts'`, `content` is a JSON-serialized array of
  parts: `[{ type: 'text', text: string } | { type: 'image_url', image_url: { url: string } }]`
  (the `image_url.url` is a `data:` URI — images are never uploaded to
  separate storage in this addendum, they're stored inline in D1 as
  base64; large images will bloat row size, an accepted trade-off given
  this is a low-volume personal tool).
- `role = 'tool'` messages store the tool's result as `content_type = 'text'`
  JSON-stringified result, plus reuse the existing (nullable) `model`
  column is NOT used for tool rows; instead a new nullable `tool_name TEXT`
  column identifies which tool produced the result:

```sql
ALTER TABLE messages ADD COLUMN tool_name TEXT;
```

Since D1 (SQLite) doesn't support multiple `ALTER TABLE ... ADD COLUMN`
statements with new CHECK constraints on `role` in one statement, and
SQLite CHECK constraints can't be altered post-creation, the migration
approach is: create a new `messages_v2` table with the updated schema,
copy existing rows (`content_type` defaults to `'text'`, `tool_name` to
`NULL`), drop `messages`, rename `messages_v2` to `messages`. Full SQL is
specified in the implementation plan, not here — this doc fixes the target
end-state schema, not the migration mechanics.

## OpenRouter Client Changes (`worker/src/openrouter.ts`)

- `buildOpenRouterRequest` gains an optional third parameter,
  `tools?: ToolDefinition[]`, included in the request body as `tools` (and
  `tool_choice: 'auto'`) when provided.
- Message-to-API-shape mapping changes: a `parts`-type message maps its
  `content` array directly (already in OpenRouter's expected shape); a
  `tool`-type message maps to `{ role: 'tool', tool_call_id, content }` —
  `tool_call_id` is threaded through from the assistant's prior
  `tool_calls` response, persisted alongside the tool message (new
  nullable `tool_call_id TEXT` column, added in the same `messages_v2`
  migration above).
- `streamChatCompletion` behavior is unchanged when `tools` is omitted
  (existing callers/tests keep working); when the model's streamed
  response includes `tool_calls` instead of `content` deltas, the Worker
  route (not this module) is responsible for detecting that and driving
  the loop — `openrouter.ts` stays a thin, stateless request/response
  layer per its existing design.

## Tool-Calling Loop (Worker route)

New file `worker/src/tools/webSearch.ts`:
- `webSearchToolDefinition: ToolDefinition` — the OpenRouter/OpenAI-style
  function-calling schema: `{ type: 'function', function: { name: 'web_search', description, parameters: { query: string } } }`.
- `executeWebSearch(apiKey: string, query: string, fetchImpl?): Promise<{ results: Array<{ title: string; url: string; snippet: string }> } | { error: string }>` —
  calls the Brave Search API (`https://api.search.brave.com/res/v1/web/search`),
  returns a small structured result set (top 5 results) or an `{ error }`
  shape on failure (never throws — the route always gets something to feed
  back to the model).

Route logic in `worker/src/index.ts`'s `/messages` handler becomes a loop
(replacing the current single-call logic):

1. Call `streamChatCompletion` with the accumulated history and
   `tools: [webSearchToolDefinition]`.
2. If the response is a final text answer: stream it to the client exactly
   as today, persist it, done.
3. If the response includes `tool_calls`: for each call, emit an SSE
   `event: tool_call` frame (`{ name, arguments }`) so the frontend can
   show "Searching the web for '<query>'…", execute `executeWebSearch`,
   persist a `role: 'tool'` message with the result and matching
   `tool_call_id`, then loop back to step 1 with the updated history.
4. Cap the loop at 5 iterations to prevent runaway tool-call chains;
   on hitting the cap, emit an SSE `event: error` frame ("Tool use limit
   reached") and stop.

## Vision Input (Frontend)

`frontend/src/components/ChatPane.tsx` gains:
- An attach button (file input, `accept="image/*"`) and a paste-event
  listener on the message textarea that extracts image data from
  clipboard items.
- Attached images render as thumbnails above the input box before
  sending, removable individually.
- On send, each image is read via `FileReader.readAsDataURL` (base64
  `data:` URI) and included as `image_url` parts alongside the text part
  in the outgoing message; the message is sent with a `contentType: 'parts'`
  flag so the Worker knows to store/forward it as structured content.
- A per-model `vision: boolean` capability flag (added to the existing
  `FREE_MODELS` array and `KIMI_K3_MODEL` entry) disables the attach
  button when the selected model doesn't declare vision support. Per the
  Non-goals section, these flags start conservative (`false`) except where
  the user has explicitly confirmed a model supports it.

## Tool-Call Rendering (Frontend)

The SSE stream-reading loop in `ChatPane.tsx` gains a case for
`event: tool_call`: renders a distinct, visually subdued message bubble
("🔍 Searching the web for '...'") between the user's message and the
eventual assistant reply, using the same `role: 'tool'` message type
loaded from `GET /api/conversations/:id` on reload (so tool-use history
persists across refreshes, not just live streams).

## Secrets

- `BRAVE_API_KEY` — new Worker secret (`wrangler secret put`), server-side
  only, never exposed to the frontend.

## Error Handling

- Brave API failure (rate limit, network, invalid key): `executeWebSearch`
  returns `{ error: string }` rather than throwing; this is fed back to
  the model as the tool result, letting the model decide how to respond
  (e.g., "search unavailable, answering from general knowledge") rather
  than crashing the exchange. Matches the base design's principle that
  upstream failures degrade gracefully into the conversation rather than
  erroring out.
- Tool-loop iteration cap (5) prevents infinite loops from a
  misbehaving/adversarial model driving unbounded Brave API spend.
- Oversized image uploads: capped client-side at 5MB per image (rejected
  with an inline error before sending) — D1 has row-size practical limits,
  and this is a personal tool, not a document-processing pipeline.

## Testing

- Unit tests for `executeWebSearch` (mocked fetch): success shape, Brave
  API error shape, network failure shape.
- Unit tests for the extended `buildOpenRouterRequest`: `tools` param
  included when provided, `parts`-type messages mapped correctly,
  `tool`-type messages mapped with `tool_call_id`.
- Unit tests for the `messages_v2` migration SQL against a D1 test
  instance: existing text messages preserved with `content_type = 'text'`
  after migration, new columns nullable/defaulted correctly.
- Manual click-through: attach an image and send (confirm it renders and
  round-trips on reload), trigger a web search via a prompt like "search
  for X" against a tool-capable model and confirm the search step renders
  and the final answer incorporates results.
- No automated e2e test for the full tool loop against the real Brave API
  (out of scope, consistent with the base design's "no automated e2e
  suite" decision) — mocked-fetch unit tests plus manual verification.

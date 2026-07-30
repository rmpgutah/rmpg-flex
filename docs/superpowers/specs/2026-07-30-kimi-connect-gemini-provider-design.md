# kimi-connect — Gemini Provider Addendum

## Purpose

Add Google Gemini as a second model provider alongside OpenRouter, since
Gemini offers a genuine free tier with natively multimodal (vision-capable)
models and an OpenAI-compatible endpoint. This lets the app offer a real
free vision option without waiting on OpenRouter's free-tier vision models
to appear, and establishes a provider-agnostic pattern for adding further
providers later without redesigning the request layer again.

## Non-goals

- No Groq or other provider in this pass — this addendum is Gemini-only;
  the provider table is designed to make a future addition mechanical, but
  no other provider is implemented here.
- No per-provider tool-calling verification beyond a manual smoke test —
  if Gemini's OpenAI-compatibility layer diverges from OpenRouter's on
  streamed tool-call deltas, that's logged as a known risk and fixed in a
  follow-up if it actually surfaces, not preemptively engineered around.
- No UI provider switcher separate from the model dropdown — provider is
  an implementation detail derived server-side from the chosen model, not
  a user-facing concept.

## Architecture

`worker/src/openrouter.ts` generalizes from a single hardcoded
`OPENROUTER_URL` to a small provider table:

```typescript
type Provider = 'openrouter' | 'gemini';

const PROVIDER_CONFIG: Record<Provider, { baseUrl: string }> = {
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1/chat/completions' },
  gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions' },
};
```

`buildOpenRouterRequest` and `streamChatCompletion` both gain a `provider`
parameter (defaulting to `'openrouter'` for backward compatibility with
existing call sites and tests) and select the base URL and API key
accordingly. The file keeps its existing name in this addendum to avoid a
disruptive rename mid-project; a rename to something like `llm.ts` is a
reasonable future cleanup, not required here.

## Model Allowlist Changes

`worker/src/index.ts`'s `FREE_MODELS` changes shape from a flat string
array to an array of `{ id: string; provider: Provider }` pairs, so
`isModelAllowed` and the route handler can look up the correct provider
for a given model id server-side — the client never dictates which
upstream/key is used, only which model id (already validated against the
allowlist).

New entries:

| id | provider | vision | tools |
|---|---|---|---|
| `gemini-3.6-flash` | gemini | true | true |
| `gemini-3.5-flash` | gemini | true | true |
| `gemini-3.5-flash-lite` | gemini | true | true |

(`tools: true` because Gemini's OpenAI-compatible endpoint supports
function calling; this is asserted from Google's documentation, not yet
verified live against our specific tool-loop implementation — see Testing.)

## Secrets

- `GEMINI_API_KEY` — new Worker secret (`wrangler secret put`), obtained
  free from Google AI Studio, server-side only.

## Frontend Changes

`frontend/src/components/ChatPane.tsx`'s `ModelOption` type and
`FREE_MODELS` array gain the three Gemini entries with `vision: true`,
enabling the image-attach button for these models — the first free,
verified-working vision option in the app.

## Error Handling

No new error-handling design beyond what already exists: a request to an
unconfigured/failing provider surfaces through the same
`OpenRouterError` → SSE `event: error` path already in place, since
Gemini's OpenAI-compatible endpoint returns errors in a broadly similar
shape (non-2xx status + JSON body). If Gemini's error body shape turns out
to diverge enough to produce a confusing message, that's a follow-up fix,
not blocking this addendum.

## Testing

- Unit tests for the provider table: `buildOpenRouterRequest`/
  `streamChatCompletion` target the correct base URL and use the correct
  API key per provider (mocked fetch, as with existing tests).
- Unit test confirming `isModelAllowed` correctly resolves provider for
  both OpenRouter and Gemini model ids.
- Manual smoke test post-deploy: send a plain-text message to
  `gemini-3.5-flash`, confirm streaming works; attach an image and send to
  a Gemini model, confirm vision works; trigger the web-search tool
  against a Gemini model, confirm the tool-call loop's SSE frames and
  final answer come through correctly — this last one is the addendum's
  stated risk (tool-call streaming format may diverge) and is the most
  important manual check before considering Gemini support solid.

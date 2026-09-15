# Dispatcher Command Engine — design

**Date:** 2026-09-14
**Status:** approved under stated assumptions (autonomous session; no operator available to answer questions)

## Goal

Let a dispatcher drive the CAD from one input surface — the typed CAD command line
or live voice — using *any* phrasing, for *any* CAD operation their role permits:
create and edit calls (every editable field), assign / dispatch / clear / hold /
prioritise, change unit status, issue BOLOs, run record checks, and navigate the
console. "Zero limitation on the command" means the engine never answers
"Unknown command" to a well-formed request; it either executes it, asks one
clarifying question, or asks for a one-word confirmation on an irreversible write.

## What already exists (and stays)

| Layer | File | Keep? |
|---|---|---|
| Typed CAD verbs (`NC`, `AS`, `CL`, …) | `client/src/utils/cadCommandParser.ts` | Yes — fast path, unchanged semantics. |
| Command bar UI | `client/src/components/CadCommandLine.tsx` | Yes — gains a confirmation turn. |
| Voice state machine (Web Speech) | `client/src/utils/voiceChannel.ts` | Yes — its dead `/api/voice/parse` and `/api/voice/command` fallbacks are replaced. |
| Radio dialogue persona (Workers AI) | `src/routes/voice.ts` `/dialogue`, `src/utils/aiDispatcher.ts` | Yes — still the conversational reply engine for non-command speech. |
| CAD write helpers | `src/utils/dispatcherAwareness.ts` `runLookup` | Reused for record checks. |
| AI provider chain | `src/utils/callAi.ts` (Claude → OpenAI → Workers AI) | Reused for planning. |

## Architecture

```
typed text ──► cadCommandParser (verb match?) ──yes──► existing verb handler
                       │ no
                       ▼
voice text ──► POST /api/dispatcher/command  { text, source, context }
                       │
        ┌──────────────┴──────────────┐
        │ 1. rules.ts  (deterministic │  regex intents — works with AI down)
        │ 2. planner.ts (callAi JSON) │  free-form → tool calls
        └──────────────┬──────────────┘
                       ▼
             catalog.ts  validate tool params (zod), RBAC per tool
             resolve.ts  call numbers → ids, call signs → unit ids (DB, fuzzy)
             compile.ts  tool call → { http step | client action }
                       ▼
       { reply, intent, steps[], client_actions[], needs_confirmation, confirm_token, log_id }
                       ▼
   client dispatcherCommandClient.ts executes http steps with the user's JWT
   (RBAC, validation, audit_log and WebSocket broadcasts all fire in the
   existing routes), applies client actions, speaks/prints the reply, then
   POST /api/dispatcher/command/:id/result records the outcome.
```

**Why the client executes the HTTP steps.** Every CAD write already has a
hardened Hono route (disposition required to clear, 100-column allowlist on
`PUT /calls/:id`, vehicle-maintenance guard on assign, WS broadcast). Re-implementing
those in a server-side executor would fork that logic. A Worker cannot fetch its
own hostname, and importing the root app into a route is circular. So the server
*plans and compiles* to concrete `{method, path, body}` steps against an allowlist
of route patterns, and the client *executes* them exactly as the typed verbs
already do via `apiFetch`. Role enforcement is therefore identical to clicking
the UI.

## Components

### `src/utils/dispatcherCommand/catalog.ts`
Typed tool registry. Each tool: `name`, `description` (what the planner sees),
zod `params`, `destructive: boolean`, `roles: string[]`. v1 tools:

Writes: `create_call`, `update_call_fields` (any column in the exported
`UPDATABLE_CALL_COLUMNS_BASE/EXT` sets), `set_call_status`, `assign_units`,
`unassign_unit`, `hold_call`, `resume_call`, `set_priority`, `add_note`,
`set_unit_status`, `create_bolo`, `redispatch`.
Reads: `lookup_record` (plate/person/warrant/premise/vin via `runLookup`),
`call_status`, `closest_unit`, `list_pending`, `list_units`.
Console: `select_call`, `open_new_call`, `open_ncic`, `navigate`, `help`.

### `src/utils/dispatcherCommand/rules.ts`
Pure regex intent matcher for the highest-frequency phrasings ("assign 12 to
42", "clear 42 unfounded", "put 12 on scene", "priority 1 on 42", "note on 42:
…", "new call <type> at <addr>", "hold 42", "where is 12"). Returns tool calls or
`null`. Runs first so the engine still works when no AI provider is reachable.

### `src/utils/dispatcherCommand/planner.ts`
Builds the system prompt from the catalog plus a live awareness snapshot
(pending calls, unit statuses, selected call), calls `callAi`, and parses the
JSON `{ intent, reply, tool_calls[], clarify? }`. Parsing is pure and tested;
malformed output degrades to a `clarify` turn, never a crash.

### `src/utils/dispatcherCommand/resolve.ts`
DB resolvers: call by exact number, numeric suffix, or the client's selected
call; unit by call sign (exact → prefix → Levenshtein ≤ 2). Ambiguity returns a
`clarify` result listing candidates.

### `src/utils/dispatcherCommand/compile.ts`
Pure mapping tool call → `HttpStep { method, path, body, summary, destructive }`
or `ClientAction`. Route patterns are allowlisted; anything else is rejected.

### `src/routes/dispatcherCommand.ts` — `/api/dispatcher` (auth required, `client_viewer` excluded)
- `POST /command` body `{ text, source: 'typed'|'speech', context: { selected_call_number?, unit? }, confirm_token? }`.
- `POST /command/:id/result` body `{ steps: [{ index, ok, status, summary }] }`.
- `GET /command/recent` (supervisor+) last 100 log rows.

Confirmation: when any step is `destructive` and `system_config
dispatcher_command_confirm_destructive` ≠ `'0'`, the response carries
`needs_confirmation: true` and a `confirm_token` (KV, 90 s). The client replies
`Y`/`YES`/`CONFIRM` (typed) or "confirm / affirmative / yes" (spoken) and re-posts
with the token; the cached plan is returned with `confirmed: true`. Anything else
cancels.

### Schema — `migrations/0289_dispatcher_command_log.sql`
`dispatcher_command_log(id, user_id, source, input_text, intent, provider, model,
plan_json, status, results_json, latency_ms, created_at)`. Also reconciled at
runtime via `columnExists`/`CREATE TABLE IF NOT EXISTS` in the route.

### Client
- `client/src/utils/dispatcherCommandClient.ts`: `runDispatcherCommand(text, ctx)`
  → posts, executes steps, applies client actions, posts results; returns
  `{ reply, ok, clientActions, needsConfirmation }`. Holds the pending confirm
  token in module state.
- `cadCommandParser.ts` default branch: after the 10-code checks, call
  `runDispatcherCommand`; return `action: { type: 'ai_command', … }`.
- `CadCommandLine.tsx`: show `reply`; on `needs_confirmation` show the prompt and
  route the next line through the confirm path.
- `DispatchPage.tsx`: handle `ai_command` — apply client actions (select call,
  open new-call modal prefilled, open NCIC, navigate), `fetchData()`, speak reply.
- `voiceChannel.ts`: replace the `/api/voice/parse` + `/api/voice/command`
  fallbacks with `runDispatcherCommand(text, …, 'speech')`. Order: quick match →
  command engine → dialogue persona (for chatter/unclear).

## Error handling
- AI unavailable: rules matcher still runs; otherwise `clarify` with a hint to
  use a typed verb. Never a 500.
- Unresolvable call/unit: `clarify` naming candidates.
- Step failure mid-plan: stop, report which steps ran, log `status='partial'`.
- Malformed planner JSON: `clarify`.

## Testing
- `tests/dispatcherCommandRules.test.ts` — regex intents.
- `tests/dispatcherCommandPlanner.test.ts` — JSON parse/validation/degradation.
- `tests/dispatcherCommandCompile.test.ts` — tool → step mapping, allowlist, destructive flag, column allowlist for `update_call_fields`.
- `test-workers/dispatcherCommandRoute.test.ts` — Miniflare: RBAC, confirmation token round-trip, log row written, no-AI path.
- `client/src/utils/__tests__/dispatcherCommandClient.test.ts` — step execution order, confirm flow, result posting.

## Stated assumptions (operator may override)
1. "Zero limitation" applies to *phrasing* and *reachable operations*, not to
   RBAC or the D1 column allowlist. Roles still gate writes.
2. Irreversible writes (clear/close/cancel a call, unassign, redispatch) require
   one confirmation turn by default; `system_config`
   `dispatcher_command_confirm_destructive='0'` turns that off.
3. The radio `/dialogue` persona remains the reply engine for non-command
   speech; the command engine handles anything that is an instruction.
4. Server-side audio transcription paths (VoiceHubDO) are out of scope; the
   browser Web Speech transcript is the voice input.

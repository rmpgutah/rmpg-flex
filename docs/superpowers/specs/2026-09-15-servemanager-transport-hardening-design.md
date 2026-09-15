# ServeManager integration — transport hardening & poll-cursor repair

**Date:** 2026-09-15
**Scope:** `src/utils/serveManagerClient.ts`, `src/utils/serveManagerPoller.ts`
**Tests:** `tests/serveManagerFetch.test.ts` (19 cases)

## Why this is scoped the way it is

The original ask was "review and fully integrate with all of what ServeManager
offers." `www.servemanager.com` is blocked by this organization's egress policy
(`EGRESS_BLOCKED` from the agent proxy), so the API reference could not be read
from the working session. Building against endpoints whose paths and payload
shapes cannot be verified would mean inventing them.

This change therefore covers **only defects provable from the code as it stood**
— transport behaviour and poll bookkeeping — and deliberately does **not** add
any new ServeManager resource. Resource families the integration still does not
touch (clients/companies, court cases, invoices, employees, job create/update)
remain out of scope until the spec is reachable.

### Currently integrated endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/account` | GET | connection test |
| `/jobs` | GET | cursor-paginated poll (`per_page=100`, `updated_since`) |
| `/jobs/{id}` | GET | fresh single-job fetch |
| `/jobs/{id}/attempts` | POST | push RMPG attempt outbound |
| `/jobs/{id}/documents` | POST | multipart affidavit/receipt upload |
| `/documents/{id}/download` | GET | authenticated binary proxy |
| webhook receiver | POST | HMAC-SHA256 over base64 body |

---

## Repair book

### 1. Silent pagination truncation → permanent job loss

- **Issue.** Jobs stopped appearing in the dispatch queue with no error anywhere:
  a green poll reporting `{synced: N}` while jobs visible in ServeManager were
  never created as calls.
- **Root cause.** `fetchRecentJobs` capped its `links.next` walk at
  `MAX_PAGES = 20` (2,000 jobs) and, on hitting the cap, returned the truncated
  list **indistinguishably from a complete one**. `pollServeManagerJobs` then
  advanced `servemanager_last_poll_at` to `datetime('now')`. Because
  `updated_since` only ever moves forward, every job past the cap fell outside
  all future windows and could never be fetched again.
- **Resolution.** `fetchRecentJobs` now returns
  `{ jobs, complete, watermark, error }`. `complete` is false when the cap is
  reached with `links.next` still set; the poller refuses to advance the
  watermark in that case and returns the error. The cap was also raised to
  `SM_MAX_PAGES = 100` (10,000 jobs), so it is a loop guard rather than an
  operating limit.
- **Prevention.** `tests/serveManagerFetch.test.ts` pins `complete === false` at
  the cap, asserts the partial jobs are still returned, and asserts
  `SM_MAX_PAGES >= 100`.

### 2. Every transport failure collapsed to `[]`

- **Issue.** "ServeManager is down" and "no new jobs" produced identical output:
  `{synced: 0, callsCreated: 0}` with no `error` field. An expired API key could
  sit unnoticed indefinitely.
- **Root cause.** `fetchRecentJobs` wrapped the whole walk in a `try/catch` that
  returned a bare `[]`, discarding both the cause and any jobs already read. The
  poller's `if (jobs.length === 0) return {synced: 0}` early-exit then reported
  success.
- **Resolution.** Failures propagate as `error` on the result and are logged via
  the structured logger (`log.error`, was `console.error`). A mid-walk failure
  returns the jobs already read **plus** the error — every downstream write is an
  idempotent upsert, so processing the partial batch is strictly better than
  discarding it, provided the watermark is held back (it is).
- **Prevention.** Tests cover partial-failure, key-unavailable, and
  genuinely-empty cases as three distinguishable outcomes.

### 3. No timeout, no retry, no 429 handling

- **Issue.** A hung ServeManager connection stalled the cron Worker until the
  runtime killed it, taking the whole poll cycle with it.
- **Root cause.** `smGet` was a bare `fetch()` with no `AbortController`, no
  retry, and no rate-limit handling — the only integration client in the repo
  without them (Fleet.io, Roboflow and CarsXE all have the full set).
- **Resolution.** New `smRequest` seam: 30 s `AbortController` timeout, bounded
  retries with exponential backoff on 5xx/408/425, and typed errors
  (`ServeManagerConfigError`, `ServeManagerTimeoutError`,
  `ServeManagerHttpError`, `ServeManagerRateLimitError`). Two invariants carried
  over from the Fleet.io adapter for the same reasons:
  - **POST is never retried.** ServeManager exposes no idempotency-key header,
    so replaying a POST whose response was lost double-creates the attempt or
    document.
  - **429 is never retried in-band.** It raises
    `ServeManagerRateLimitError` (carrying `retry-after`) so the caller backs off
    on ServeManager's schedule instead of burning the retry budget.
  - **401/403/404 fail fast.** Retrying a bad credential only delays the
    operator seeing the real problem.
- **Prevention.** Tests cover retry-then-succeed, retry exhaustion, no-retry on
  401, no-retry on POST, 429 typing with `retryAfterSeconds`, abort→timeout
  mapping, and the Basic-auth header shape (key as username, empty password).

### 4. Poll cursor advanced to wall-clock `now()` instead of the data watermark

- **Issue.** Occasional jobs were never picked up, with no pattern and no error.
- **Root cause.** The cycle stamped `servemanager_last_poll_at` with
  `datetime('now')` **after** doing all its work. A cycle takes real time
  (multi-page fetch plus a write per job); any job ServeManager updated inside
  that window carries an `updated_at` earlier than the stamped `now()`, so it
  landed in a gap no future `updated_since` window could cover.
- **Resolution.** The watermark is now `maxUpdatedAt(jobs)` — the latest
  `updated_at` actually observed in the batch. Re-reading the boundary job next
  cycle is harmless (upserts are idempotent); missing it is not. When the batch
  carries no usable timestamp the watermark is left untouched rather than
  guessed.
- **Prevention.** `maxUpdatedAt` is a pure exported function with tests covering
  missing/unparseable values, the empty case, and — importantly — comparison by
  **instant rather than lexicographically**, since ServeManager timestamps carry
  a zone offset and string ordering picks the wrong winner across zones.

### 5. `process_type` permanently contradicted its own source

- **Issue.** A cached job whose documents changed in ServeManager (e.g. a
  subpoena added) kept showing `process_type = 'other'` forever.
- **Root cause.** `cacheJob`'s UPDATE branch refreshed `documents_json` but
  omitted `process_type` and `recipient_description`, although both were written
  on INSERT. `process_type` is *derived from* `documents_json`, so the two
  columns diverged permanently after the first document change. The branch's own
  comment claimed it refreshed "ALL mutable fields".
- **Resolution.** Both columns are now refreshed on UPDATE, `process_type` from
  the same `guessProcessType(job.documents)` value the INSERT path uses.
- **Prevention.** The divergence is called out in a comment at the site, since
  the failure mode is "a derived column silently disagreeing with its input"
  rather than anything a type or a constraint would catch.

---

## Backward compatibility

`fetchRecentJobs` changed its return type from `SmJob[]` to
`FetchRecentJobsResult`. It has exactly one caller
(`src/utils/serveManagerPoller.ts`), updated in the same change.
`pollServeManagerJobs` keeps its existing return shape and merely populates the
already-declared optional `error` field more often, so its four callers
(`src/index.ts` cron, three routes in `src/routes/serveManagerRoutes.ts`) are
unaffected.

No schema change; no migration required.

## Verification

| Gate | Result |
|---|---|
| `npm run typecheck` | clean |
| `npx vitest run` | 439 files, 4226 passed, 1 skipped |
| `npm run test:worker` (Miniflare) | 127 files, 720 passed |
| `npx vitest run tests/serveManagerFetch.test.ts` | 19 passed |

No client files were touched.

# Group J: Child-Process & Network Hardening

Branch: `claude/desktop-hardening-group-j-childproc-network`, based on latest `main` (`580790ca1c`, includes Group I's merged core work).

This is the **last** group in the 10-group Electron desktop-shell hardening
program (spec: `docs/superpowers/specs/2026-07-18-desktop-shell-functions-and-hardening-design.md`,
Section 2, functions #41-50, `desktop/security/childProcessGuard.js`).

## Grounding (read before starting any task)

- `desktop/main.js`'s `recon:tool-spawn` handler (~line 2295) spawns
  `RECON_TOOLS[toolId].command` with a PATH built from a fixed list of
  install directories + `argv` from `tool.buildArgs(args)` (already
  sanitized by Group G's `sanitizeReconToolArgs`) + `env: {...process.env,
  PATH: pathParts.join(':')}` — the child inherits the FULL parent
  environment (spec item #41's stated gap), spread first so only `PATH`
  is overridden.
- `recon:check-binary` (~line 2347) takes a renderer-supplied `binary`
  string, validates it against `/^[a-zA-Z0-9._+-]+$/` (blocks path
  traversal/shell metacharacters but NOT an arbitrary binary NAME — any
  alphanumeric string is accepted, no allowlist against `RECON_TOOLS`'
  known command names or the install directory) before `spawnSync('command',
  ['-v', binary], ...)`.
- `recon:tool-terminal` (~line 2378) and several other `spawn(...,
  {detached: true, stdio: 'ignore'}).unref()` call sites throughout
  `main.js` are fire-and-forget interactive terminal launches (visible TTY
  windows) — these are a different risk shape than `recon:tool-spawn`'s
  piped/monitored child (no stdout/stderr capture to gate, no `toolSessions`
  tracking) and are explicitly OUT OF SCOPE for #41-43 (env/timeout/
  concurrency) unless a task's own investigation finds a clean, low-risk way
  to extend coverage — don't force it.
- `geo:ip-locate` (~line 2915) POSTs to a hardcoded
  `https://www.googleapis.com/geolocation/v1/geolocate` URL (not
  renderer-influenced — already effectively "pinned" by being a literal
  string, not a variable), no request timeout, and uses `data.location.lat`/
  `.lng` directly with no shape validation before returning them as
  `latitude`/`longitude` to the renderer.
- `offline:api` (~line 2955) doesn't touch the network directly — routes
  through `offlineRouter.handle(method, path, body)` (local SQLite only).
  `offline:trigger-sync` (~line 3064) calls `syncManager.pullAll()`, which
  internally does `net.request({...REMOTE_SERVER_URL...})` — `REMOTE_SERVER_URL`
  is a `const` computed once at module load from `DEV_MODE` (main.js line
  ~69), not renderer-influenced, but neither `offline:trigger-sync` nor
  `syncManager.js`'s internal `net.request` calls (in `pullTable`/`pushAll`/
  `refreshAndRetry`, and the health-check at main.js line 605) have an
  explicit timeout — a hung request blocks that call indefinitely.
- `desktop/security/sessionHardening.js` (Group F) already has
  `assertSecureElectronDefaults(app)` — checks `app.commandLine.hasSwitch(...)`
  against a fixed `INSECURE_COMMAND_LINE_SWITCHES` list
  (`disable-web-security`, `allow-file-access-from-files`,
  `allow-running-insecure-content`, `ignore-certificate-errors`), called
  unconditionally at startup (main.js ~line 3407), logs violations via
  `console.error` but never blocks launch. **This substantially overlaps
  with spec item #49 (`disableInsecureElectronFlags`)** — Task 9 must
  investigate this overlap first (see Task 9 below) rather than assuming
  a from-scratch reimplementation is needed.
- No `desktop/security/childProcessGuard.js` file exists yet — this group
  creates it (per the spec's stated file placement), NOT another addition
  to `sessionAuth.js` (that file is Group I's, already closed out).
- IPC audit-logging (#48) has no existing precedent in this codebase beyond
  the structured JSON logger pattern documented in the root `CLAUDE.md` for
  the Worker (`src/utils/logger.ts`) — that's a different runtime
  (Cloudflare Workers) with no direct desktop equivalent; Task 8 designs a
  minimal local-file-based analog from scratch, scoped down to exactly the
  4 named IPC channels the spec calls out (PIN generation, recon spawn,
  backup import/export, shortcut registration) rather than a general
  logging framework.

## Scope decisions

- New module: `desktop/security/childProcessGuard.js`, following the same
  DI-testable pure-function-first convention established across Groups
  F/H/I (functions that need a real dependency — e.g. a live child-process
  handle, `fs`, a timer — take it as an explicit parameter; the actual
  `require()`/spawn happens only at the real call site in `main.js`).
- `enforceChildProcessTimeout`/`capConcurrentChildProcesses` apply
  specifically to `recon:tool-spawn`'s tracked, piped children (the
  existing `toolSessions` Map already tracks live child handles by
  session id — both functions build on that, not a new tracking
  structure).
- `pinOutboundApiHost`/`timeoutAllIpcNetworkCalls` are applied at the
  specific `net.request(...)` call sites identified in Grounding above —
  `geo:ip-locate`, `syncManager.js`'s 3 `net.request` sites, and the
  main.js:605 health-check — not a generic network-interceptor (Electron's
  `session.webRequest` hooks are for renderer-originated requests, not
  main-process `net.request` calls the app itself makes; those must be
  gated per-call-site).
- `selfTestHardeningOnStartup` (#50, final task) is a read-only diagnostic
  — it calls into existing exported checks from Groups F/G/H/I's modules
  (e.g. `assertSecureElectronDefaults`, `auditIpcHandlerRegistry`, a
  safeStorage-migration-done check from `secretsStore.js` if one exists)
  plus this group's own new checks, aggregates pass/fail, logs a summary,
  and NEVER blocks startup — matches the spec's explicit Error Handling
  section requirement.
- Per the spec's own Guardrails section, `sandbox: true` for renderer
  processes is explicitly out of scope for this entire 10-group program —
  don't attempt it under `sandboxChildProcessEnv` (#41 is about the CHILD
  PROCESS environment `recon:tool-spawn` spawns, an entirely different
  thing from Electron's renderer `sandbox` option).

## Tasks

### Task 1: `sandboxChildProcessEnv`

**Files:** `desktop/security/childProcessGuard.js` (new), its test file (new), `desktop/main.js`

- `buildSandboxedChildEnv(baseEnv, pathParts)` — pure. Returns a minimal
  env object for a spawned recon tool child: `{ PATH: pathParts.join(':'),
  HOME: baseEnv.HOME, USER: baseEnv.USER, LANG: baseEnv.LANG }` (only the
  handful of vars a CLI tool typically needs to run correctly — NOT a
  spread of the full parent `process.env`, which today leaks
  `GOOGLE_API_KEY`, any other secrets, shell config, etc. into the child).
  Skip any key not present in `baseEnv` (don't inject `undefined` values).
  Document the exact rationale for each included key.
- Wire into `recon:tool-spawn`'s `spawn(tool.command, argv, { env: ... })`
  call — replace `{ ...process.env, PATH: pathParts.join(':') }` with
  `buildSandboxedChildEnv(process.env, pathParts)`.
- TDD: given a full env-like object with extra/sensitive keys, confirm
  only the allowlisted keys appear in the result; confirm PATH is always
  present and correct; confirm a missing optional key (e.g. no `LANG` set)
  is simply omitted, not `undefined`.
- **Risk to flag for the reviewer**: some recon tools may genuinely need
  an env var beyond this minimal set to function (e.g. a tool-specific
  config path). If `recon:tool-spawn`'s existing tools break under this
  change, that's a real regression — the task's implementer should note
  in their report whether they found any `RECON_TOOLS` entry whose
  `buildArgs`/known CLI behavior implies a dependency on an env var beyond
  `PATH`/`HOME`/`USER`/`LANG`, and flag it rather than silently guessing.

### Task 2: `enforceChildProcessTimeout`

**Files:** `desktop/security/childProcessGuard.js`, its test file, `desktop/main.js`

- `scheduleChildProcessTimeout(child, timeoutMs, killFn)` — takes a live
  child-process-shaped object (`{kill: fn}`) and a `setTimeout`-shaped
  function as DI, schedules a hard kill after `timeoutMs` if the child is
  still running; returns the timer handle so the caller can `clearTimeout`
  it in the child's own `exit` handler (no leaked timer after natural
  exit). Pick a reasonable default (document your choice — something in
  the 5-15 minute range is typical for a recon/network tool; too short
  breaks legitimate long-running scans, too long doesn't meaningfully cap
  risk).
- Wire into `recon:tool-spawn`: after `spawn(...)`, call
  `scheduleChildProcessTimeout(child, DEFAULT_TIMEOUT_MS, setTimeout)`,
  clear it in the existing `child.on('exit', ...)` handler.
- TDD with a fake timer (`setTimeout`-shaped stub you control, not real
  wall-clock waits) and a fake child (`{kill: spy}`): confirm `kill` is
  called after the timeout fires; confirm clearing the returned handle
  before the timeout fires prevents the kill.

### Task 3: `capConcurrentChildProcesses`

**Files:** `desktop/security/childProcessGuard.js`, its test file, `desktop/main.js`

- `isAtConcurrencyLimit(activeCount, maxConcurrent)` — pure, trivial
  (`activeCount >= maxConcurrent`) — but the task's real content is
  wiring: `recon:tool-spawn` already has `toolSessions` (a `Map` of
  live children) — before spawning, check `isAtConcurrencyLimit(
  toolSessions.size, MAX_CONCURRENT_TOOLS)` and return `{ok:false,
  error:'too many concurrent recon tools running'}` without spawning if
  at the limit. Pick and document a reasonable `MAX_CONCURRENT_TOOLS`
  default (e.g. 3-5).
- TDD: the pure function is trivial to test directly; also add an
  integration-style test if feasible (or note why not, matching this
  codebase's established pattern of skipping `main.js`-layer IPC tests
  where no test harness exists for `guardedHandle`).

### Task 4: `validateBinaryPathBeforeSpawn`

**Files:** `desktop/security/childProcessGuard.js`, its test file, `desktop/main.js`

- `isAllowedBinaryName(binary, allowedCommands)` — pure. `allowedCommands`
  is the set of known tool command names (derive from `Object.values(
  RECON_TOOLS).map(t => t.command)` at the real call site — don't
  hardcode a duplicate list in `childProcessGuard.js`). Returns `true`
  only if `binary` exactly matches one of `allowedCommands` (combine with
  the EXISTING `/^[a-zA-Z0-9._+-]+$/` regex check already in
  `recon:check-binary` — keep that check too, this is an additional
  allowlist layer, not a replacement).
- Wire into `recon:check-binary`: after the existing regex check, also
  require `isAllowedBinaryName(binary, knownCommands)`.
- TDD: a binary name matching a known `RECON_TOOLS` command → true; a
  syntactically-valid-but-unknown binary name (e.g. `'curl'` if not a
  registered tool) → false, even though it'd pass the existing regex.
- **Investigate first**: read `RECON_TOOLS`' actual definition in
  `main.js` to confirm every entry has a `.command` field suitable for
  this allowlist, and confirm `recon:check-binary`'s existing callers
  (search the renderer side if easily reachable, or just note the IPC
  contract) don't rely on checking arbitrary non-tool binaries for some
  other legitimate reason — if they do, escalate rather than silently
  breaking that use case.

### Task 5: `pinOutboundApiHost`

**Files:** `desktop/security/childProcessGuard.js`, its test file, `desktop/main.js`, `desktop/syncManager.js`

- `isAllowedApiHost(url, allowedHosts)` — pure. Parses `url` via the
  `URL` constructor (fail closed — any unparseable URL is NOT allowed),
  checks `.hostname` against `allowedHosts` (exact match, not substring —
  avoid a `endsWith`/`includes` check that a crafted subdomain could
  bypass).
- Wire into `geo:ip-locate` (host: `www.googleapis.com`) and
  `syncManager.js`'s `net.request` call sites (host: derived from
  `REMOTE_SERVER_URL`, computed once) — call `isAllowedApiHost` on the
  URL before issuing the request; on failure, don't make the request,
  return an error. Since none of these URLs are actually renderer-
  influenced today (all are `const`/literal), this task's value is a
  regression guard (matching Group I Task 8's `assertWebPreferencesNotWeaker`
  self-check pattern) — document this explicitly, don't overstate it as
  closing an active vulnerability.
- TDD: allowed host exact match → true; a crafted subdomain
  (`evil.googleapis.com.attacker.com` or similar) → false; unparseable
  URL → false.

### Task 6: `verifyIpLocateResponseShape`

**Files:** `desktop/security/childProcessGuard.js`, its test file, `desktop/main.js`

- `parseIpLocateResponse(rawBody)` — pure. `JSON.parse`s `rawBody` (fail
  closed — invalid JSON → `{ok:false}`), validates the shape has
  `location.lat`/`location.lng` as finite numbers (not `NaN`, not a
  string, not missing) and returns a normalized `{ok:true, latitude,
  longitude, accuracy}` (default `accuracy` to a safe fallback like 5000
  if absent/invalid, matching the existing handler's own fallback logic —
  read it first). On any shape violation: `{ok:false, error:'malformed
  geolocation response'}`.
- Wire into `geo:ip-locate`: replace the current inline
  `JSON.parse(body)` + direct `data.location.lat`/`.lng` access with a
  call to `parseIpLocateResponse(body)`.
- TDD: well-formed response → correct parse; missing `location` → false;
  `lat`/`lng` as strings or `NaN` → false; extra unexpected fields present
  → still parses correctly (don't over-constrain).

### Task 7: `timeoutAllIpcNetworkCalls`

**Files:** `desktop/security/childProcessGuard.js`, its test file, `desktop/main.js`, `desktop/syncManager.js`

- `withRequestTimeout(requestPromise, timeoutMs, timeoutFn)` — DI-testable
  wrapper: races `requestPromise` against a `timeoutFn`-scheduled
  rejection, cleans up the timer either way (no leaked timer on the
  request-wins path). Pick and document a reasonable default (e.g. 15-30s
  for interactive IPC-triggered network calls — long enough for a slow
  but real connection, short enough the renderer isn't blocked
  indefinitely).
- Wire into `geo:ip-locate`'s `net.request` Promise and
  `offline:trigger-sync`'s `syncManager.pullAll()` call (per the spec's
  explicit naming of both) — and, if the implementer's investigation of
  Task 5 already touched `syncManager.js`'s other `net.request` sites,
  extend the same timeout there too for consistency (your call, document
  the decision either way).
- TDD: request resolves before timeout → resolves normally, timer
  cleared; request never resolves and timeout fires first → rejects with
  a clear timeout error.

### Task 8: `logSecurityRelevantIpcCalls`

**Files:** `desktop/security/childProcessGuard.js`, its test file, `desktop/main.js`, `desktop/pinManager.js` (or wherever `generatePinForUser` lives)

- `formatSecurityAuditLine(event)` — pure. Takes `{channel, timestamp,
  userId, outcome, detail}`-shaped input, returns a single-line
  JSON-stringified log entry (NOT the Worker's `src/utils/logger.ts` —
  this is a local, desktop-only analog scoped to exactly what's needed
  here, no shared code with the Worker's structured logger since they run
  in entirely different runtimes).
- `appendSecurityAuditLog(line, fsModule, logFilePath)` — DI-testable
  (fake `fs` in tests), appends the line to a local log file (use
  `getLogsDirectory()`/`appendToLogFile()` from `desktop/systemInfo.js`
  Group A already built, if their signatures fit — don't duplicate log-
  file-path logic if a reusable helper already exists there; investigate
  first).
- Wire into exactly the 4 spec-named channels: PIN generation
  (`offline:generate-pin`), recon spawn (`recon:tool-spawn`), backup
  import/export (Group B's `fs:export-backup`/`fs:import-backup` or
  equivalent — grep for the actual channel names), and shortcut
  registration (Group D's `device:register-global-shortcut` or
  equivalent — grep for the actual channel name). Log outcome
  (success/denied/error) and a minimal non-sensitive detail (e.g. tool
  id, NOT the actual PIN value or secret content).
- TDD: format function output is valid JSON with expected fields;
  `appendSecurityAuditLog` correctly appends via the fake fs, doesn't
  overwrite prior lines.
- **Investigate first**: find the actual current channel names for
  backup import/export and shortcut registration (the spec's prose names
  may not match the real IPC channel string exactly) before wiring.

### Task 9: `disableInsecureElectronFlags`

**Files:** `desktop/security/childProcessGuard.js` or extend
`desktop/security/sessionHardening.js` (see investigation below), test
file, `desktop/main.js`

- **Investigate first, this task has real overlap with existing work**:
  Group F's `assertSecureElectronDefaults(app)` (in
  `sessionHardening.js`) already checks `app.commandLine.hasSwitch(...)`
  against `INSECURE_COMMAND_LINE_SWITCHES` and is already called
  unconditionally at startup (main.js ~line 3407), logging violations via
  `console.error` without blocking. Determine: does this already fully
  satisfy spec item #49, or is there a genuine gap? Candidate gaps to
  check: (a) does the existing check only run in some code paths, or
  truly unconditionally regardless of `app.isPackaged`? (spec explicitly
  says "in a packaged build" — check whether that's a meaningful
  distinction here, since dev builds are EXPECTED to sometimes have debug
  flags); (b) is `INSECURE_COMMAND_LINE_SWITCHES`'s list exhaustive, or
  missing any flag the spec's "etc." implies (e.g.
  `--remote-debugging-port`, `--allow-insecure-localhost`); (c) should a
  detected violation in a PACKAGED build specifically escalate beyond a
  console.error (e.g. into the audit log from Task 8, or a more visible
  startup warning)?
- If a genuine, additive gap is found: extend `assertSecureElectronDefaults`
  (or add a small new function in `childProcessGuard.js` that composes
  with it — your call based on what's cleanest) to close it. If NO
  genuine gap is found beyond what Group F already built: do NOT force a
  duplicate reimplementation — instead, wire the EXISTING
  `assertSecureElectronDefaults` result into whatever Task 10's
  `selfTestHardeningOnStartup` aggregates (a legitimate, valuable outcome
  for this task: confirming and integrating existing coverage rather than
  padding with redundant code). Document your finding either way in the
  task report — this is exactly the kind of task where NEEDS_CONTEXT-style
  honest investigation matters more than forced net-new code.

### Task 10: `selfTestHardeningOnStartup`

**Files:** `desktop/security/childProcessGuard.js`, its test file, `desktop/main.js`

- `runHardeningSelfTest(checks)` — pure aggregator. `checks` is an array
  of `{name, fn}` pairs; runs each `fn()` (wrapped in try/catch — a
  throwing check is itself a failure, not a crash), collects
  `{name, ok, detail}` results, returns `{allPassed: boolean, results:
  [...]}`. Never throws itself.
- Wire into `main.js`'s startup sequence (near the existing
  `assertSecureElectronDefaults`/`auditIpcHandlerRegistry` calls): build
  a `checks` array covering — `assertSecureElectronDefaults(app)` (Group
  F), `auditIpcHandlerRegistry(...)` (Group G, already exists,
  currently DEV_MODE-gated — decide whether to also run it here
  unconditionally as part of this aggregate, or respect its existing
  DEV_MODE gate; document the choice), a safeStorage-migration-done check
  if `secretsStore.js` (Group H) exports one (investigate — if none
  exists, skip rather than inventing one, that's out of this task's
  scope), and any of THIS group's own checks that make sense as a
  startup self-test (e.g. confirming `childProcessGuard.js`'s own exports
  are all present/callable — a lightweight "module loaded correctly"
  sanity check, not much more). Log a single aggregate summary line
  (pass/fail count) via `console.log`/`console.error`, and if Task 8's
  audit logger exists by the time this task runs, also append the full
  result set there. **Never blocks app launch on any failure** — this is
  the spec's explicit, non-negotiable requirement (see the spec's Error
  Handling section) — no `process.exit`, no thrown error propagating out
  of the startup sequence.
- TDD: `runHardeningSelfTest` with all-passing fake checks → `allPassed:
  true`; with one throwing fake check → that check's result is `ok:
  false` with a captured error detail, `allPassed: false`, but the
  function itself doesn't throw; with an empty `checks` array →
  `allPassed: true` (vacuously, nothing failed).

### Task 11: Final verification pass

**Files:** none (verification only)

- Full desktop test suite passes (Node ABI rebuild, `npm test`, restore
  Electron ABI after).
- `node --check` on every touched/new file.
- No duplicate `require(...)` of `./security/childProcessGuard` or any
  other module across all files touched this group.
- Update the progress ledger, mark Group J complete.
- This is the FINAL group of the 10-group program — after this group's
  final whole-branch review, push + PR, the entire program is complete.

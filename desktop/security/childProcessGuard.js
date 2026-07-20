// ============================================================
// RMPG Flex — Child Process & Network Guard
// Hardening helpers for the desktop shell's recon-tool child
// processes (`recon:tool-spawn` et al.) and the small number of
// main-process `net.request` call sites (IP geolocation, offline
// sync). Follows the same DI-testable pure-function convention as
// Groups F/H/I's sessionHardening.js/secretsStore.js/sessionAuth.js:
// anything needing a live dependency (a spawned child handle, `fs`,
// a timer) takes it as an explicit parameter — the real require()/
// spawn only happens at the call site in main.js.
// ============================================================

'use strict';

/**
 * Builds a minimal, sandboxed environment object for a spawned recon
 * tool child process. Today's `recon:tool-spawn` handler spreads the
 * FULL parent `process.env` into the child (`{ ...process.env, PATH:
 * ... }`), which leaks `GOOGLE_API_KEY`, any other integration
 * secrets, shell config, and anything else this Electron main process
 * happens to have in its environment into a third-party CLI tool
 * (nmap, sqlmap, sherlock, etc.) whose output is streamed back to the
 * renderer. This function instead allowlists only the handful of vars
 * a CLI tool typically needs to run correctly:
 *
 *   - PATH: so the child (and any tool it shells out to) can find
 *     its own dependencies. Always built fresh from `pathParts` —
 *     never taken from `baseEnv.PATH` — since the caller has already
 *     assembled the exact install-directory search list this recon
 *     tool should be allowed to resolve against.
 *   - HOME: many CLI tools (subfinder, nuclei, sqlmap, python-based
 *     tools like sherlock/theharvester/holehe) read their own config/
 *     cache from `$HOME/.config/...` or a venv rooted under `$HOME`;
 *     omitting it breaks otherwise-working installs.
 *   - USER: some tools/log lines reference the invoking user; cheap
 *     to keep, no secret value.
 *   - LANG: locale-dependent output formatting/encoding (e.g. UTF-8
 *     handling in tool output) can misbehave without it on some
 *     systems.
 *
 * Any of HOME/USER/LANG absent from `baseEnv` is fully omitted from
 * the result (never set to `undefined` — an `undefined` env value is
 * a foot-gun some child_process/OS layers treat inconsistently, and
 * `'KEY' in result` should reliably mean "this var will be set").
 *
 * Pure — does not mutate `baseEnv` or `pathParts`.
 *
 * @param {NodeJS.ProcessEnv} baseEnv - source environment to allowlist from (e.g. `process.env`)
 * @param {string[]} pathParts - ordered list of directories to join into PATH
 * @returns {{PATH: string, HOME?: string, USER?: string, LANG?: string}}
 */
function buildSandboxedChildEnv(baseEnv, pathParts) {
  const safeBaseEnv = baseEnv || {};
  const safePathParts = pathParts || [];

  const env = { PATH: safePathParts.join(':') };

  if (safeBaseEnv.HOME !== undefined) env.HOME = safeBaseEnv.HOME;
  if (safeBaseEnv.USER !== undefined) env.USER = safeBaseEnv.USER;
  if (safeBaseEnv.LANG !== undefined) env.LANG = safeBaseEnv.LANG;

  return env;
}

/**
 * Default hard-kill timeout for a spawned recon tool child process, in
 * milliseconds. `recon:tool-spawn` streams a third-party CLI tool's
 * stdout/stderr back to the renderer for the lifetime of the process —
 * with no cap, a hung or misbehaving tool (bad flags causing an
 * interactive prompt, a network scan against an unreachable target that
 * never times out on its own, etc.) keeps its child process — and the
 * renderer-visible session — alive indefinitely.
 *
 * Set to 10 minutes: long enough that a real nmap/sqlmap/subfinder-style
 * scan against a normal target range has ample time to finish (these
 * tools' own internal timeouts and typical scan scopes in this recon
 * toolset complete in well under that), but short enough that a hung or
 * runaway process doesn't sit around consuming resources / holding a
 * `toolSessions` slot indefinitely. Sits in the middle of the brief's
 * suggested 5-15 minute range rather than either edge.
 */
const DEFAULT_CHILD_PROCESS_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Milliseconds to wait after an unhonored SIGTERM before escalating to
 * SIGKILL — matches the existing escalation delay used by the
 * `recon:term-kill` IPC handler in main.js, so both timeout paths behave
 * consistently.
 */
const SIGKILL_ESCALATION_DELAY_MS = 1500;

/**
 * Schedules a hard kill of `child` after `timeoutMs` if it is still
 * running at that point. `killFn` is a `setTimeout`-shaped dependency
 * (`killFn(callback, delayMs) -> handle`) — the real call site passes
 * the global `setTimeout`; tests pass a fake that records the callback
 * instead of waiting on real wall-clock time.
 *
 * On timeout, sends SIGTERM first (a graceful request), then schedules a
 * SIGKILL escalation `SIGKILL_ESCALATION_DELAY_MS` later if the child
 * hasn't actually exited by then — a process that's genuinely hung (stuck
 * on a prompt, wedged in a syscall, or one that traps SIGTERM) is exactly
 * the failure mode this timeout exists to guard against, and SIGTERM
 * alone doesn't guarantee it actually terminates.
 *
 * The escalation check deliberately does NOT use `child.killed` — Node
 * sets that flag synchronously once `kill()` successfully SENDS a signal,
 * not once the process has actually terminated (see Node's own docs on
 * `ChildProcess.killed`), so `!child.killed` is false almost immediately
 * after the SIGTERM call above and would make this escalation branch
 * effectively dead code against exactly the hung-process case it exists
 * for. Instead this checks `exitCode`/`signalCode`, which Node only sets
 * once the process has genuinely exited (via the real `'exit'` event
 * internally) — still both `null` means still running.
 *
 * Returns the handle `killFn` produced for the INITIAL timeout, so the
 * caller can `clearTimeout` it (with the matching real `clearTimeout`)
 * from the child's own `exit` handler — a child that exits naturally
 * before the timeout elapses must not leave a dangling timer. (The
 * escalation timer, if scheduled, is not returned — it's a fire-and-forget
 * check-and-kill, harmless if it runs after the child has already exited
 * some other way.)
 *
 * @param {{kill: Function, exitCode?: number|null, signalCode?: string|null}} child - live child-process-shaped handle
 * @param {number} timeoutMs - milliseconds to wait before the initial SIGTERM
 * @param {Function} killFn - setTimeout-shaped scheduler (DI)
 * @returns {*} the timer handle returned by killFn for the initial timeout
 */
function scheduleChildProcessTimeout(child, timeoutMs, killFn) {
  return killFn(() => {
    child.kill('SIGTERM');
    killFn(() => {
      const stillRunning = child.exitCode == null && child.signalCode == null;
      if (stillRunning) {
        try {
          child.kill('SIGKILL');
        } catch {
          /* ignore — child may have exited between the check and the kill */
        }
      }
    }, SIGKILL_ESCALATION_DELAY_MS);
  }, timeoutMs);
}

/**
 * Resolves the hard-kill timeout to use for a given recon tool: the
 * tool's own `timeoutMs` override if it declares one, else `defaultMs`.
 *
 * Most `RECON_TOOLS` entries (WHOIS/CVE lookups, ARP scans, quick
 * top-100-port nmap scans, etc.) finish in well under
 * `DEFAULT_CHILD_PROCESS_TIMEOUT_MS`, but a handful of legitimately
 * long-running scans — e.g. `nmap-full`'s full 65535-TCP-port
 * `-p- -sV` sweep, which commonly takes 15-40+ minutes against a real
 * host, especially one with many open services or a firewall that
 * drops rather than rejects probes — would be killed mid-scan under
 * completely normal conditions by the one-size-fits-all default. A
 * per-tool override lets a slow-but-legitimate tool get the runway it
 * actually needs without raising the timeout for every other tool
 * (which would just make a genuinely hung fast tool sit around longer).
 *
 * Any non-positive or non-numeric override is treated as absent and
 * falls back to `defaultMs` — a tool entry with `timeoutMs: 0` (or a
 * typo'd string) should not accidentally disable the safety net.
 *
 * @param {{timeoutMs?: number}} tool - a `RECON_TOOLS[toolId]` entry
 * @param {number} defaultMs - fallback timeout (e.g. `DEFAULT_CHILD_PROCESS_TIMEOUT_MS`)
 * @returns {number} the timeout to pass to `scheduleChildProcessTimeout`
 */
function resolveChildProcessTimeoutMs(tool, defaultMs) {
  const override = tool && tool.timeoutMs;
  return typeof override === 'number' && override > 0 ? override : defaultMs;
}

/**
 * Maximum number of recon tool child processes allowed to run
 * concurrently (tracked via `toolSessions.size` in main.js — one entry
 * per live child spawned by `recon:tool-spawn`). Without a cap, a user
 * (or a compromised/misbehaving renderer) can fire off spawn requests
 * back-to-back — each one already rate-limited individually, but rate
 * limiting alone doesn't bound how many long-running scans pile up at
 * once, e.g. several 10-minute nmap/sqlmap-class scans stacking up and
 * competing for CPU/network/file-descriptor budget on the operator's
 * machine, or simply making it impossible to tell which of N streaming
 * output panes belongs to which scan.
 *
 * Set to 4: high enough that a working investigator can run a couple
 * of tools side-by-side (e.g. a WHOIS lookup alongside a longer nmap
 * scan) without hitting the limit during normal use, but low enough to
 * keep a runaway or accidental burst of spawns from consuming unbounded
 * system resources. Sits in the middle of the brief's suggested 3-5
 * range rather than either edge, mirroring the same reasoning used for
 * `DEFAULT_CHILD_PROCESS_TIMEOUT_MS` above.
 */
const MAX_CONCURRENT_TOOLS = 4;

/**
 * Pure predicate: is `activeCount` already at (or past) `maxConcurrent`?
 * Used by `recon:tool-spawn` to reject a new spawn request before it
 * touches `child_process.spawn` at all, rather than spawning and then
 * trying to walk it back.
 *
 * `activeCount >= maxConcurrent` — deliberately `>=` rather than `>` so
 * that a `maxConcurrent` of 0 (an edge case, e.g. tooling temporarily
 * disabled) rejects every request regardless of `activeCount`, including
 * zero.
 *
 * @param {number} activeCount - current number of live child processes (e.g. `toolSessions.size`)
 * @param {number} maxConcurrent - the configured concurrency cap
 * @returns {boolean} true if a new spawn should be rejected
 */
function isAtConcurrencyLimit(activeCount, maxConcurrent) {
  return activeCount >= maxConcurrent;
}

/**
 * Pure predicate: is `binary` an exact match for one of `allowedCommands`?
 *
 * Used as an additional allowlist layer on top of the `recon:check-binary`
 * IPC handler's existing `/^[a-zA-Z0-9._+-]+$/` shape check in main.js. The
 * regex only rules out shell metacharacters/path separators — it happily
 * accepts any syntactically clean word (`'wget'`, `'nc'`, `'python3'`, an
 * arbitrary typo) and lets the handler run `command -v <binary>` against
 * it, which leaks a bit of information about what's installed on the
 * operator's machine to anything that can reach the IPC channel. This
 * predicate narrows that down to only the binaries this recon toolset
 * actually knows about, without touching the regex check (kept as-is —
 * this is an additional layer, not a replacement).
 *
 * `allowedCommands` is intentionally NOT owned by this module — the real
 * call site in main.js derives it live from the `RECON_TOOLS` registry
 * (each tool's `.command`, plus any secondary binary names a tool
 * legitimately depends on — see the `checkBinary` field added to
 * `RECON_TOOLS['gobuster-dir']` and the existing `requiresInstall` field
 * used by several entries) so this stays in sync automatically as tools
 * are added/removed/renamed, instead of drifting against a second
 * hardcoded list living in this file.
 *
 * Exact match only (no prefix/substring matching) — `allowedCommands`
 * is expected to be a small, known-good set, so there is no reason to
 * accept anything looser.
 *
 * @param {*} binary - the binary name requested via `recon:check-binary`
 * @param {Iterable<string>} allowedCommands - known-good command names (e.g. a Set or array)
 * @returns {boolean} true only if `binary` is a non-empty string present in `allowedCommands`
 */
function isAllowedBinaryName(binary, allowedCommands) {
  if (!binary || typeof binary !== 'string') return false;
  if (!allowedCommands) return false;
  // Works for both Set and Array inputs without requiring a specific type.
  for (const candidate of allowedCommands) {
    if (candidate === binary) return true;
  }
  return false;
}

/**
 * Pure predicate: does `url`'s hostname exactly match one of
 * `allowedHosts`?
 *
 * Regression-guard framing (matches Group I Task 8's
 * `assertWebPreferencesNotWeaker` self-check pattern): every call site
 * this is wired into today (`geo:ip-locate`'s hardcoded Google
 * geolocation URL, `syncManager.js`'s requests built from
 * `REMOTE_SERVER_URL`) already builds its request URL from a `const`/
 * module-scoped literal, never from renderer-supplied input — so this
 * function is NOT closing an active vulnerability. Its value is as a
 * defense-in-depth tripwire: if a future change accidentally threads
 * renderer-influenced data into one of these URLs (or a copy/paste
 * mistake points a request at the wrong host), this check fails the
 * request instead of silently sending it somewhere unintended.
 *
 * Parses `url` via the `URL` constructor and fails closed — any
 * unparseable input (malformed URL, missing protocol, non-string,
 * `null`/`undefined`) returns `false` rather than throwing, so a caller
 * can safely gate a request on this function's result without its own
 * try/catch.
 *
 * Hostname comparison is EXACT match only — deliberately not
 * `endsWith`/`includes`/any substring check, which a crafted subdomain
 * like `www.googleapis.com.attacker.com` (a real, resolvable hostname
 * where `www.googleapis.com` is merely a leading label, not the actual
 * domain) or `evil.googleapis.com` (a subdomain of the real domain, but
 * not the specific pinned host) could bypass. Similarly, stuffing the
 * allowed hostname into a query string or path of an unrelated host
 * (`https://evil.com/?host=www.googleapis.com`) is correctly rejected
 * since only `.hostname` is ever inspected, never the full URL string.
 *
 * This function intentionally does NOT check `.protocol` — host-pinning
 * and protocol-enforcement are separate concerns, and the existing
 * `isSecureUpdateFeedUrl` check in `sessionHardening.js` (Group F) is
 * this codebase's established precedent for protocol validation. Don't
 * duplicate that here; a caller that also needs a protocol guarantee
 * should compose both checks.
 *
 * @param {*} url - the outbound request URL to validate
 * @param {Iterable<string>} allowedHosts - known-good hostnames (e.g. a Set or array)
 * @returns {boolean} true only if `url` parses and its hostname exactly matches an allowed host
 */
function isAllowedApiHost(url, allowedHosts) {
  if (!allowedHosts) return false;

  let hostname;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return false;
  }

  for (const candidate of allowedHosts) {
    if (candidate === hostname) return true;
  }
  return false;
}

/**
 * Parses and validates the body of a `geo:ip-locate` response (the Google
 * Geolocation API's `POST /geolocation/v1/geolocate` payload) — pure, no
 * I/O. Used by the `geo:ip-locate` IPC handler in `main.js` in place of an
 * inline `JSON.parse(body)` + direct `data.location.lat`/`.lng` access,
 * so a malformed or unexpected response body can never propagate a
 * non-numeric/NaN coordinate into the renderer's map/location UI.
 *
 * Fails closed in two ways:
 *  1. Invalid JSON — `JSON.parse` throwing is caught, never propagated.
 *  2. Valid JSON but the wrong shape — `location` missing, not an object,
 *     or `location.lat`/`location.lng` not finite numbers (a string like
 *     `"37.7"`, `null`, `NaN`, `Infinity`, or simply absent all fail via
 *     `Number.isFinite`, which is the one existence+type+finiteness check
 *     that also correctly *accepts* a legitimate `0` coordinate — a naive
 *     `data.location.lat || ...` fallback would incorrectly treat `0` as
 *     missing).
 *
 * Both cases return `{ok:false, error:'malformed geolocation response'}`
 * rather than throwing, so the caller can branch on `.ok` without its own
 * try/catch. This intentionally does not attempt to distinguish "the API
 * returned a structured error" (e.g. `{error:{message:'...'}}`) from
 * "the API returned garbage" — both are shape violations from this
 * function's point of view; the caller's own error path already covers
 * surfacing an API-provided message where one exists.
 *
 * On success, extra/unexpected fields alongside a valid `location` are
 * ignored rather than rejected — this validates the response is *usable*,
 * not an exact-schema match. `accuracy` is read from the top-level
 * `data.accuracy` field (matching the pre-existing handler's own
 * `data.accuracy || 5000` fallback, which is itself matching the actual
 * Google Geolocation API response shape — `accuracy` is a sibling of
 * `location`, not nested under it) and defaults to `5000` meters when
 * absent or falsy.
 *
 * @param {string} rawBody - the raw HTTP response body text
 * @returns {{ok:true, latitude:number, longitude:number, accuracy:number}|{ok:false, error:string}}
 */
function parseIpLocateResponse(rawBody) {
  let data;
  try {
    data = JSON.parse(rawBody);
  } catch {
    return { ok: false, error: 'malformed geolocation response' };
  }

  const location = data && typeof data === 'object' ? data.location : undefined;
  if (
    !location ||
    typeof location !== 'object' ||
    !Number.isFinite(location.lat) ||
    !Number.isFinite(location.lng)
  ) {
    return { ok: false, error: 'malformed geolocation response' };
  }

  return {
    ok: true,
    latitude: location.lat,
    longitude: location.lng,
    accuracy: data.accuracy || 5000,
  };
}

/**
 * Default bound for a single, interactive, IPC-triggered `net.request`
 * round trip (`geo:ip-locate`'s Google geolocation lookup, and
 * `syncManager.js`'s token-refresh request) — see `withRequestTimeout`
 * below.
 *
 * Set to 20 seconds: comfortably past what a slow-but-real mobile/cellular
 * connection needs for one small JSON request/response, but short enough
 * that a renderer waiting on the IPC round trip (e.g. a login flow blocked
 * on token refresh, or the geolocation fallback) isn't left hanging for
 * anywhere close to a minute when the far end has actually gone dark —
 * sits in the middle of the brief's suggested 15-30s range rather than
 * either edge, mirroring the reasoning already used for
 * `DEFAULT_CHILD_PROCESS_TIMEOUT_MS`/`MAX_CONCURRENT_TOOLS` above.
 */
const DEFAULT_IPC_REQUEST_TIMEOUT_MS = 20 * 1000;

/**
 * Bound for `offline:trigger-sync`'s call to `syncManager.pullAll()`.
 *
 * Unlike `geo:ip-locate`'s single `net.request`, `pullAll()` is a
 * sequential loop over every entry in `PULL_INTERVALS` (9 tables as of
 * this writing), each pulled via `serverFetch`/`pullTable`, which already
 * carries its own internal 15s per-request timeout+abort
 * (`syncManager.js`'s `serverFetch`). A single-request-sized bound applied
 * to the whole loop would false-positive-timeout a legitimate multi-table
 * sync well before it could finish under normal (if slow) conditions.
 *
 * Set to 60 seconds: enough headroom for several sequential per-table
 * pulls (each individually bounded at 15s) to complete even on a slow
 * connection, while still giving the "sync now" IPC call a hard ceiling
 * so a user who manually triggers a sync during a genuine outage isn't
 * left waiting indefinitely for the renderer promise to settle. (The
 * underlying `pullAll()` call keeps running in the background past this
 * timeout if it hasn't returned yet — this bounds only how long the IPC
 * handler waits on it, not the sync engine's own internal locking, which
 * already force-releases a stuck lock after `SYNC_LOCK_TIMEOUT` (60s) via
 * `acquireSyncLock()`.)
 */
const OFFLINE_TRIGGER_SYNC_TIMEOUT_MS = 60 * 1000;

/**
 * Races `requestPromise` against a `timeoutFn`-scheduled rejection,
 * bounding how long an interactive, IPC-triggered network call can leave
 * its handler (and the renderer awaiting the IPC round trip) hanging.
 * DI-testable: `timeoutFn` is a `setTimeout`-shaped dependency
 * (`timeoutFn(callback, delayMs) -> handle`) — real call sites pass the
 * global `setTimeout`; tests pass a fake that records the callback/delay
 * instead of waiting on real wall-clock time.
 *
 * Whichever side settles first wins, and the timer is always cleaned up
 * afterwards via the real global `clearTimeout` (paired with whatever
 * handle `timeoutFn` returned) — never left dangling:
 *
 *  - Request wins (resolves or rejects before the timeout fires): the
 *    pending timer is cleared immediately, so it never fires later and
 *    can't leak a dangling handle that keeps the event loop alive or
 *    fires a stray, ignored rejection well after the caller has already
 *    moved on.
 *  - Timeout wins (the timer fires before the request settles): this
 *    function rejects with a distinct, clearly-labeled timeout `Error`
 *    (not a generic/ambiguous one) so callers can tell "the server never
 *    answered in time" apart from "the server answered with an error."
 *    If `requestPromise` eventually does settle after that, its result is
 *    silently discarded — `Promise`s can only settle once, so this
 *    function's own `.then` handler runs (as it must, since it's always
 *    attached — an unattached rejection handler is how you get an
 *    "unhandled rejection" warning) but has no further effect because
 *    this outer promise already settled.
 *
 * Calling `clearTimeout` on whatever `timerHandle` a fake `timeoutFn`
 * returns in tests is harmless — the real global `clearTimeout` silently
 * no-ops on a value it doesn't recognize as one of its own timer ids,
 * exactly like calling it twice on an already-cleared real timer.
 *
 * @param {Promise<*>} requestPromise - the in-flight network request to bound
 * @param {number} timeoutMs - milliseconds to wait before timing out
 * @param {Function} timeoutFn - setTimeout-shaped scheduler (DI)
 * @returns {Promise<*>} resolves/rejects with `requestPromise`'s outcome, or rejects with a timeout Error if the timer fires first
 */
function withRequestTimeout(requestPromise, timeoutMs, timeoutFn) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const timerHandle = timeoutFn(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`Request timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    requestPromise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timerHandle);
        resolve(value);
      },
      (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timerHandle);
        reject(err);
      }
    );
  });
}

/**
 * Formats a single security-relevant IPC audit event as a single-line,
 * JSON-stringified log entry — a fresh, minimal, desktop-only analog to
 * the Worker's structured `src/utils/logger.ts` (which runs in an
 * entirely different runtime, Cloudflare Workers vs Electron's Node main
 * process, and shares no code with this module by design).
 *
 * Pure — does not read the clock or touch the filesystem itself; the
 * caller supplies `timestamp` (or leaves it out, in which case this
 * function fills in `new Date().toISOString()` so every emitted line is
 * still timestamped without every call site having to remember to do it).
 *
 * `detail` MUST be pre-scrubbed by the caller to a minimal, non-sensitive
 * shape (e.g. a tool id, a target user id, a filename) — this function
 * does no redaction of its own; it is a formatter, not a sanitizer. See
 * the call sites wired in main.js for what's actually logged at each of
 * the 4 security-relevant channels this was built for.
 *
 * @param {{channel?: string, timestamp?: string, userId?: string, outcome?: string, detail?: object}} event
 * @returns {string} a single line (no embedded newline) of valid JSON
 */
function formatSecurityAuditLine(event) {
  const safeEvent = event || {};
  return JSON.stringify({
    channel: safeEvent.channel ?? null,
    timestamp: safeEvent.timestamp || new Date().toISOString(),
    userId: safeEvent.userId ?? null,
    outcome: safeEvent.outcome ?? null,
    detail: safeEvent.detail ?? null,
  });
}

/**
 * Appends one already-formatted `line` (see `formatSecurityAuditLine`) to
 * `logFilePath`, DI-testable via `fsModule` (tests pass a fake
 * `{appendFileSync}`; the real call site passes Node's `fs`).
 *
 * Deliberately does NOT reuse `systemInfo.js`'s `appendToLogFile` — that
 * helper prepends its own `[<ISO timestamp>] ` prefix ahead of the
 * message, which would break the "single line of valid JSON" contract
 * `formatSecurityAuditLine` establishes (the audit log is meant to be
 * parsed line-by-line as JSON, e.g. by a future log-shipping/ingestion
 * step — a `[timestamp] {...}` line isn't valid JSON on its own). This
 * function instead calls `fsModule.appendFileSync` directly with exactly
 * the line plus a trailing newline, mirroring `appendToLogFile`'s own
 * append-only (never-overwrite) semantics without its formatting.
 *
 * @param {string} line - a pre-formatted line, e.g. from `formatSecurityAuditLine`
 * @param {{appendFileSync: Function}} fsModule - fs-shaped dependency (DI)
 * @param {string} logFilePath - absolute path to the security audit log file
 */
function appendSecurityAuditLog(line, fsModule, logFilePath) {
  fsModule.appendFileSync(logFilePath, `${line}\n`);
}

module.exports = {
  buildSandboxedChildEnv,
  DEFAULT_CHILD_PROCESS_TIMEOUT_MS,
  scheduleChildProcessTimeout,
  resolveChildProcessTimeoutMs,
  MAX_CONCURRENT_TOOLS,
  isAtConcurrencyLimit,
  isAllowedBinaryName,
  isAllowedApiHost,
  parseIpLocateResponse,
  DEFAULT_IPC_REQUEST_TIMEOUT_MS,
  OFFLINE_TRIGGER_SYNC_TIMEOUT_MS,
  withRequestTimeout,
  formatSecurityAuditLine,
  appendSecurityAuditLog,
};

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

module.exports = {
  buildSandboxedChildEnv,
  DEFAULT_CHILD_PROCESS_TIMEOUT_MS,
  scheduleChildProcessTimeout,
  resolveChildProcessTimeoutMs,
  MAX_CONCURRENT_TOOLS,
  isAtConcurrencyLimit,
  isAllowedBinaryName,
};

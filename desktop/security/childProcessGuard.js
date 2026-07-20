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

module.exports = {
  buildSandboxedChildEnv,
  DEFAULT_CHILD_PROCESS_TIMEOUT_MS,
  scheduleChildProcessTimeout,
};

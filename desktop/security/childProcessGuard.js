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

module.exports = {
  buildSandboxedChildEnv,
};

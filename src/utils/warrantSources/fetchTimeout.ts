// Shared fetch-with-timeout for warrant source adapters.
//
// 2026-07-22 incident: the 4-hourly cron-driven full-list scan
// (runAllSourceScans → runFullListLeg, which iterates every enabled
// config-driven source SERIALLY in one invocation) silently stopped
// producing any scraper_runs rows or error_log entries for 2+ weeks.
// configRegistry.ts's socrata/arcgis/text-family fetches and
// pdfText.ts's fetchPdfText had no AbortController — a `try/catch`
// only catches a REJECTED fetch (network error, non-2xx handled
// explicitly), not one that never settles at all. One unresponsive
// external endpoint (a dead PDF server, a rate-limiting ArcGIS/Socrata
// host) hangs the entire serial loop indefinitely; the Workers runtime
// eventually force-kills the invocation when its execution budget runs
// out, with no exception ever reaching any .catch() handler — exactly
// the "zero errors, zero successes" signature this incident showed.
// Every warrantSources fetch() must go through this so a slow/dead
// source degrades one adapter instead of stalling the whole cron.

const DEFAULT_TIMEOUT_MS = 15_000;

export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

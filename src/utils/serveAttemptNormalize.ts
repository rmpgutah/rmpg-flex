// Coerce process-server attempt payloads so Dispatch + Serve + mobile
// clients agree on result enums and arrival timestamps.

const ATTEMPT_RESULT_ALIASES: Record<string, string> = {
  wrong_address: 'bad_address',
  on_scene: 'onscene',
};

/** Map UI/legacy result strings onto serve_attempts CHECK values. */
export function coerceAttemptResult(raw: unknown, fallback: string, allowed: Set<string>): string {
  const s = typeof raw === 'string' ? raw.trim() : '';
  const mapped = ATTEMPT_RESULT_ALIASES[s] ?? s;
  return allowed.has(mapped) ? mapped : fallback;
}

const RESULT_TO_PS: Record<string, string> = {
  no_answer: 'PS/00.01',
  refused: 'PS/00.25',
  other: 'PS/00.99',
};

/** Non-terminal failed reasons only — never auto-fail/close a job. */
export function defaultPsCodeForResult(result: string | null | undefined): string | null {
  if (!result) return null;
  return RESULT_TO_PS[result] ?? null;
}

/** Accept camelCase (web) or snake_case (iOS JSONEncoder.convertToSnakeCase). */
export function parseArrivedAtIso(body: Record<string, unknown>): string | undefined {
  const raw = body.arrivedAt ?? body.arrived_at;
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return undefined;
  return new Date(ms).toISOString();
}

/** Stamp CFS on-scene duration from onscene_at → now (write-once). */
export const STAMP_ONSCENE_DURATION_SQL = `onscene_duration_seconds = CASE
  WHEN onscene_at IS NOT NULL AND (onscene_duration_seconds IS NULL OR onscene_duration_seconds = 0)
  THEN CAST((julianday(datetime('now')) - julianday(onscene_at)) * 86400 AS INTEGER)
  ELSE onscene_duration_seconds
END`;

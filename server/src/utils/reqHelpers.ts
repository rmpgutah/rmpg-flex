// Express 5 types req.params[x] and req.query[x] as `string | string[]`
// (arrays arise from duplicate query keys, e.g. ?tag=a&tag=b). Most of
// our route code assumes `string` and ignores the array case — these
// helpers coerce defensively: array → first element → fallback.
//
// Use these at the READ site, not as blanket `as string` casts, so the
// coercion is visible in the call.
//
//   const id = paramStr(req.params.id);              // '' if missing
//   const page = paramNum(req.query.page, 1);        // 1 if missing/NaN
//   const name = paramStr(req.query.name, 'Unknown');

export function paramStr(
  value: unknown,
  fallback = ''
): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return fallback;
}

export function paramNum(
  value: unknown,
  fallback = 0
): number {
  const s = paramStr(value);
  if (!s) return fallback;
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
}

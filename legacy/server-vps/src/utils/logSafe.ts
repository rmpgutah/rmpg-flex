// Defense against log-injection (CodeQL js/log-injection) and
// tainted-format-string warnings. Strips CR/LF and other control chars
// (which would let an attacker fake log lines) and caps length so a
// huge user-supplied string can't blow up log aggregation.
//
// Apply at every console.* / logger call where any portion of the
// message is derived from request bodies, query params, scraper
// responses, or other untrusted input.
export function logSafe(value: unknown, maxLen = 200): string {
  const s = typeof value === 'string' ? value : String(value ?? '');
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\r\n\x00-\x1f\x7f]/g, ' ').slice(0, maxLen);
}

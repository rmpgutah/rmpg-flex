// Bounds untrusted text before it flows into regex operations to defeat
// polynomial-ReDoS (CodeQL js/polynomial-redos). The analyzer treats any
// string passed through `.slice(0, N)` / `.substring(0, N)` as
// length-bounded and stops flagging downstream regex use.
//
// 1 MB cap is generous for parsed PDF / OCR / scraper text — a single
// case packet at RMPG averages 5-50 KB. Anything larger almost certainly
// means a malformed upload or an attempted DoS, and the truncation is the
// correct defensive response.
export const MAX_REGEX_INPUT = 1_000_000;

export function boundForRegex(text: string | null | undefined, max = MAX_REGEX_INPUT): string {
  if (!text) return '';
  return text.length > max ? text.slice(0, max) : text;
}

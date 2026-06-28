// Shared ASP.NET WebForms postback helper for HTML warrant-source adapters.
//
// Both Ada County (ID) and Natrona County (WY) are classic ASP.NET WebForms
// sites: a search is a full-page POSTBACK that REQUIRES the per-session
// __VIEWSTATE / __EVENTVALIDATION tokens minted by a fresh GET. So every query
// is a 2-request dance:
//   1. GET the page  → scrape hidden-input tokens + capture Set-Cookie.
//   2. POST the form (same URL, same cookie jar) with those tokens + the
//      search fields, then hand the response body to the source's parser.
//
// This module is PURE of persistence and source-specific knowledge — it only
// builds + executes the request flow. The caller supplies the extra form
// fields and the parse function.

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';

const REQUEST_TIMEOUT_MS = 15_000;

/** Hidden-input names we attempt to thread GET→POST. Absent ones are skipped. */
const VIEWSTATE_FIELDS = [
  '__VIEWSTATE',
  '__VIEWSTATEGENERATOR',
  '__EVENTVALIDATION',
  '__VIEWSTATEENCRYPTED',
  '__SCROLLPOSITIONX',
  '__SCROLLPOSITIONY',
] as const;

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Extract one hidden-input value by name. Tolerant of attribute order and of
 * single/double/unquoted value quoting. Returns null if the input is absent.
 *
 * Matches e.g. `<input type="hidden" name="__VIEWSTATE" id="..." value="..." />`
 * with the `value` attribute appearing before OR after `name`.
 */
export function extractHidden(html: string, name: string): string | null {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Find the <input ...> tag that carries this exact name, in either attr order.
  const tagRe = new RegExp(`<input\\b[^>]*\\bname=["']?${esc}["']?[^>]*>`, 'i');
  const tag = html.match(tagRe);
  if (!tag) return null;
  const valRe = /\bvalue=("([^"]*)"|'([^']*)'|([^\s"'>]*))/i;
  const v = tag[0].match(valRe);
  if (!v) return null;
  // Capture group depends on the quoting style used.
  const raw = v[2] ?? v[3] ?? v[4] ?? '';
  return raw;
}

/** Pull the first Set-Cookie name=value pairs into a single Cookie header value. */
function extractCookies(res: Response): string {
  // Workers/undici expose all Set-Cookie via getSetCookie(); fall back to .get().
  const headers = res.headers as Headers & { getSetCookie?: () => string[] };
  let setCookies: string[] = [];
  if (typeof headers.getSetCookie === 'function') {
    setCookies = headers.getSetCookie();
  } else {
    const single = res.headers.get('set-cookie');
    if (single) setCookies = [single];
  }
  // Keep only the `name=value` (drop attributes like path/expires/HttpOnly).
  const pairs = setCookies
    .map((c) => c.split(';')[0].trim())
    .filter(Boolean);
  return pairs.join('; ');
}

export interface AspNetPostbackOptions {
  /** The search-page URL (GET + POST both hit it). */
  url: string;
  /** Extra form fields beyond the viewstate tokens (e.g. txtLastName, button trigger). */
  fields: Record<string, string>;
}

/**
 * Run the 2-step ASP.NET postback flow and return the POST response BODY.
 *
 * THROWS on a non-OK POST status (e.g. 403/500) so the orchestrator's per-source
 * try/catch records the error and the circuit breaker engages. A 404 / empty
 * body is NOT special-cased here — it returns the (empty-ish) body and lets the
 * caller's parser yield `[]`, which is the correct "no hits" signal.
 *
 * The GET status is intentionally not asserted: even a non-200 GET may still
 * carry usable hidden inputs, and a hard failure surfaces at the POST instead.
 */
export async function aspNetPostback(opts: AspNetPostbackOptions): Promise<string> {
  // --- Step 1: GET to mint tokens + cookies ---
  const getRes = await fetchWithTimeout(opts.url, {
    method: 'GET',
    headers: { accept: 'text/html', 'user-agent': USER_AGENT },
  });
  const page = await getRes.text();
  const cookie = extractCookies(getRes);

  // --- Build the POST form body: viewstate tokens (when present) + fields. ---
  const form = new URLSearchParams();
  for (const name of VIEWSTATE_FIELDS) {
    const val = extractHidden(page, name);
    if (val != null) form.set(name, val);
  }
  for (const [k, v] of Object.entries(opts.fields)) form.set(k, v);

  const headers: Record<string, string> = {
    accept: 'text/html',
    'user-agent': USER_AGENT,
    'content-type': 'application/x-www-form-urlencoded',
  };
  if (cookie) headers.cookie = cookie;

  // --- Step 2: POST the postback. ---
  const postRes = await fetchWithTimeout(opts.url, {
    method: 'POST',
    headers,
    body: form.toString(),
  });

  if (!postRes.ok) {
    // Transport-level failure → throw so the circuit breaker engages.
    throw new Error(`ASP.NET postback to ${opts.url} failed: HTTP ${postRes.status}`);
  }

  return postRes.text();
}

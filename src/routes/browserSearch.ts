// ============================================================
// RMPG Flex — Proprietary Browser Search
// ============================================================
// Mounted at /api/browser-search (PUBLIC — no auth header on
// headless Chrome navigations). Returns a full branded HTML
// search results page served entirely from rmpgutah.us.
//
// Search data: DuckDuckGo Instant Answer API (GET /search?q=&format=json,
// no API key, ToS-allowed for non-commercial / intranet use) proxied
// server-side so no third-party domain appears in the browser.
// Results are rendered into RMPG-branded HTML on the Worker.
//
// Rate: one upstream fetch per user query. No caching (results are
// time-sensitive). If upstream is unreachable, returns an empty results
// page rather than an error.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';

const browserSearch = new Hono<Env>();

interface DdgResult {
  Text: string;
  FirstURL: string;
}

interface DdgResponse {
  Heading?: string;
  AbstractText?: string;
  AbstractURL?: string;
  RelatedTopics?: Array<{ Text?: string; FirstURL?: string; Topics?: DdgResult[] }>;
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderPage(query: string, results: { title: string; url: string; snippet: string }[]): string {
  const q = escHtml(query);
  const rows = results
    .map(
      (r) => `
      <div class="result">
        <a class="result-title" href="${escHtml(r.url)}">${escHtml(r.title)}</a>
        <div class="result-url">${escHtml(r.url)}</div>
        <div class="result-snippet">${escHtml(r.snippet)}</div>
      </div>`,
    )
    .join('');

  const empty =
    results.length === 0
      ? '<p class="no-results">No results found for this query.</p>'
      : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>RMPG Search — ${q}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
       background:#1a2b3c;color:#e8eef4;min-height:100vh;padding:0 0 48px}
  header{background:#22405f;border-bottom:1px solid #2d5a82;padding:14px 24px;
         display:flex;align-items:center;gap:16px;position:sticky;top:0;z-index:10}
  .logo{font-size:13px;font-weight:700;letter-spacing:.06em;color:#c3ccd6;
        white-space:nowrap}
  .logo span{color:#d9bd72}
  form{display:flex;flex:1;gap:8px;max-width:720px}
  input[name=q]{flex:1;padding:7px 12px;border:1px solid #2d5a82;border-radius:2px;
                background:#1a2b3c;color:#e8eef4;font-size:13px;outline:none}
  input[name=q]:focus{border-color:#4a8ab5}
  button{padding:7px 16px;background:#2d5a82;border:none;border-radius:2px;
         color:#e8eef4;font-size:13px;cursor:pointer;white-space:nowrap}
  button:hover{background:#3a6f9e}
  .count{font-size:11px;color:#8fa3b8;padding:12px 24px 4px}
  .results{padding:0 24px;max-width:768px}
  .result{padding:16px 0;border-bottom:1px solid #1e3348}
  .result:last-child{border-bottom:none}
  .result-title{font-size:15px;color:#7eb8e8;text-decoration:none;display:block;
                margin-bottom:2px}
  .result-title:hover{text-decoration:underline}
  .result-url{font-size:11px;color:#5a8fa8;margin-bottom:4px;
              word-break:break-all}
  .result-snippet{font-size:13px;color:#b0c4d8;line-height:1.5}
  .no-results{padding:24px 0;color:#8fa3b8;font-size:14px}
  footer{position:fixed;bottom:0;left:0;right:0;text-align:center;
         font-size:10px;color:#3a5a78;padding:6px;
         background:#162130;border-top:1px solid #1e3348}
</style>
</head>
<body>
<header>
  <div class="logo">Rocky Mountain <span>Protective Group</span></div>
  <form action="/api/browser-search" method="get">
    <input name="q" type="search" value="${q}" autocomplete="off" autofocus>
    <button type="submit">Search</button>
  </form>
</header>
${results.length > 0 ? `<div class="count">${results.length} result${results.length === 1 ? '' : 's'} for &ldquo;${q}&rdquo;</div>` : ''}
<div class="results">
  ${empty}${rows}
</div>
<footer>Rocky Mountain Protective Group &mdash; Internal Search &mdash; Confidential</footer>
</body>
</html>`;
}

browserSearch.get('/', async (c) => {
  const query = (c.req.query('q') ?? '').trim();

  if (!query) {
    return c.html(renderPage('', []), 200);
  }

  let results: { title: string; url: string; snippet: string }[] = [];

  try {
    const ddgUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1&skip_disambig=1`;
    const res = await fetch(ddgUrl, {
      headers: { 'User-Agent': 'RMPG-Flex/1.0 (internal; +https://rmpgutah.us)' },
      signal: AbortSignal.timeout(6000),
    });

    if (res.ok) {
      const data = (await res.json()) as DdgResponse;

      // Abstract answer (Instant Answer block)
      if (data.AbstractText && data.AbstractURL) {
        results.push({
          title: data.Heading ?? query,
          url: data.AbstractURL,
          snippet: data.AbstractText,
        });
      }

      // Related topics (organic results)
      if (Array.isArray(data.RelatedTopics)) {
        for (const item of data.RelatedTopics) {
          if (item.Text && item.FirstURL) {
            // Extract a clean title from "Title — description" format DDG uses
            const dash = item.Text.indexOf(' - ');
            results.push({
              title: dash > 0 ? item.Text.slice(0, dash) : item.Text.slice(0, 80),
              url: item.FirstURL,
              snippet: dash > 0 ? item.Text.slice(dash + 3) : item.Text,
            });
          } else if (Array.isArray(item.Topics)) {
            // Nested topic groups
            for (const sub of item.Topics) {
              if (sub.Text && sub.FirstURL) {
                const dash = sub.Text.indexOf(' - ');
                results.push({
                  title: dash > 0 ? sub.Text.slice(0, dash) : sub.Text.slice(0, 80),
                  url: sub.FirstURL,
                  snippet: dash > 0 ? sub.Text.slice(dash + 3) : sub.Text,
                });
              }
            }
          }
        }
      }

      results = results.slice(0, 20);
    }
  } catch {
    // Upstream unreachable — serve empty results page, do not surface error
  }

  return c.html(renderPage(query, results), 200);
});

export default browserSearch;

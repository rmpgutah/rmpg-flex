// ============================================================
// RMPG Flex — live web search + page extraction for knowledge answers
// ------------------------------------------------------------
// Provider chain (first configured wins, all Worker-safe, no npm SDKs):
//   1. Firecrawl (FIRECRAWL_API_KEY) — /v1/search with inline markdown,
//      backfilled by /v1/scrape for the top hits. Best quality (JS pages).
//   2. Keyless fallback — DuckDuckGo HTML results parsed server-side, then
//      each top page fetched directly and reduced to readable text via
//      HTMLRewriter. Works today with zero configuration; static pages only.
//
// Consumers: src/routes/knowledge.ts (/ask with web modes). Everything here
// is best-effort — a provider failure yields [] rather than throwing, so an
// internal-docs answer is never blocked by the public internet.
// ============================================================

import { firecrawlSearch, firecrawlScrape, type FcSearchResult } from './firecrawl';

export interface WebSource {
  url: string;
  title: string;
  snippet: string;
  /** Extracted page text (markdown or plain), truncated to MAX_PAGE_CHARS. */
  content: string;
  provider: 'firecrawl' | 'duckduckgo';
}

export interface WebSearchEnv { FIRECRAWL_API_KEY?: string; }

export const MAX_PAGE_CHARS = 6000;
const UA = 'RMPG-Flex/1.0 (internal knowledge assistant; +https://rmpgutah.us)';

/** Hosts we never fetch from the Worker (SSRF / private-range guard). */
const BLOCKED_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[?::1\]?$|169\.254\.)/i;

export function isFetchableUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    if (BLOCKED_HOST.test(u.hostname)) return false;
    return true;
  } catch { return false; }
}

export function webConfigured(env: WebSearchEnv): 'firecrawl' | 'duckduckgo' {
  return env.FIRECRAWL_API_KEY ? 'firecrawl' : 'duckduckgo';
}

// ── DuckDuckGo HTML results (keyless) ─────────────────────────────────
// html.duckduckgo.com returns server-rendered results; each hit is an
// <a class="result__a" href="…">title</a> with a sibling
// <a class="result__snippet">…</a>. Links are wrapped in a /l/?uddg= redirect.

export function parseDdgHtml(html: string, limit: number): Array<{ url: string; title: string; snippet: string }> {
  const out: Array<{ url: string; title: string; snippet: string }> = [];
  const seen = new Set<string>();
  // Pass 1: locate every result anchor with its offset. Pass 2: the snippet is
  // whatever result__snippet element sits between this anchor and the next one.
  const anchorRe = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const anchors: Array<{ href: string; title: string; start: number; end: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html))) anchors.push({ href: m[1], title: m[2], start: m.index, end: anchorRe.lastIndex });
  const snippetRe = /<(?:a|div|span)[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div|span)>/;
  for (let i = 0; i < anchors.length && out.length < limit; i++) {
    let href = decodeEntities(anchors[i].href);
    const uddg = href.match(/[?&]uddg=([^&]+)/);
    if (uddg) { try { href = decodeURIComponent(uddg[1]); } catch { /* keep raw */ } }
    if (href.startsWith('//')) href = `https:${href}`;
    if (!isFetchableUrl(href) || seen.has(href)) continue;
    // DDG ad slots point at duckduckgo.com/y.js — skip.
    if (/duckduckgo\.com\/y\.js/i.test(href)) continue;
    seen.add(href);
    const between = html.slice(anchors[i].end, i + 1 < anchors.length ? anchors[i + 1].start : undefined);
    const sn = between.match(snippetRe);
    out.push({
      url: href,
      title: decodeEntities(stripTags(anchors[i].title)).trim().slice(0, 200),
      snippet: decodeEntities(stripTags(sn?.[1] ?? '')).trim().slice(0, 400),
    });
  }
  return out;
}

async function ddgSearch(query: string, limit: number, timeoutMs: number) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=us-en`;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) return [];
  return parseDdgHtml(await res.text(), limit);
}

// ── Page text extraction (keyless path) ───────────────────────────────

/** Fetch a page and reduce it to readable text. Drops nav/script/style,
 *  keeps headings + paragraphs + list items + table cells. */
export async function fetchPageText(url: string, timeoutMs = 8000): Promise<string> {
  if (!isFetchableUrl(url)) return '';
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5' },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'follow',
  });
  if (!res.ok) return '';
  const ctype = res.headers.get('content-type') || '';
  if (/application\/(pdf|octet-stream)|image\//i.test(ctype)) return '';
  if (/text\/plain|application\/json/i.test(ctype)) return (await res.text()).slice(0, MAX_PAGE_CHARS);
  return htmlToText(await res.text()).slice(0, MAX_PAGE_CHARS);
}

/** HTML → text with light structure. Pure string ops so it is unit-testable. */
export function htmlToText(html: string): string {
  let s = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|nav|footer|header|aside|form|iframe)[\s\S]*?<\/\1>/gi, ' ');
  s = s.replace(/<(h[1-6])[^>]*>/gi, '\n\n## ').replace(/<\/(h[1-6])>/gi, '\n');
  s = s.replace(/<(p|div|section|article|li|tr|br|blockquote|pre)[^>]*>/gi, '\n').replace(/<\/(td|th)>/gi, ' | ');
  s = stripTags(s);
  s = decodeEntities(s);
  return s.replace(/[ \t]+/g, ' ').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function stripTags(s: string): string { return s.replace(/<[^>]+>/g, ''); }
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
}

// ── Public entry point ────────────────────────────────────────────────

export interface WebSearchOpts {
  /** Search hits to consider (default 5). */
  limit?: number;
  /** How many hits to fetch full content for (default 3). */
  fetchTop?: number;
  timeoutMs?: number;
}

/** Search the web and return sources with extracted content. Never throws. */
export async function webSearch(env: WebSearchEnv, query: string, opts: WebSearchOpts = {}): Promise<WebSource[]> {
  const { limit = 5, fetchTop = 3, timeoutMs = 9000 } = opts;
  const q = query.trim();
  if (!q) return [];
  try {
    if (env.FIRECRAWL_API_KEY) {
      const hits: FcSearchResult[] = await firecrawlSearch(env, q, { limit, scrape: true, timeoutMs: timeoutMs * 2 });
      const top = hits.filter((h) => isFetchableUrl(h.url)).slice(0, limit);
      const contents = await Promise.all(top.map(async (h, i) => {
        if (h.markdown) return h.markdown.slice(0, MAX_PAGE_CHARS);
        if (i >= fetchTop) return '';
        try { return (await firecrawlScrape(env, h.url, { timeoutMs })).slice(0, MAX_PAGE_CHARS); } catch { return ''; }
      }));
      return top.map((h, i) => ({ url: h.url, title: h.title || h.url, snippet: h.description || '', content: contents[i] || h.description || '', provider: 'firecrawl' as const }));
    }
    const hits = await ddgSearch(q, limit, timeoutMs);
    const contents = await Promise.all(hits.map(async (h, i) => {
      if (i >= fetchTop) return '';
      try { return await fetchPageText(h.url, timeoutMs); } catch { return ''; }
    }));
    return hits.map((h, i) => ({ ...h, content: contents[i] || h.snippet, provider: 'duckduckgo' as const }));
  } catch {
    return [];
  }
}

/** Heuristic: does this question want live/external information? Used by the
 *  'auto' web mode so purely internal SOP questions never hit the internet. */
const WEB_INTENT = /\b(latest|current|today|tonight|now|recent|news|update[sd]?|202\d|statute|utah code|u\.?c\.?a\.?|urcp|urcrp|rules? (of|\d+)|rule of (civil|criminal|appellate|juvenile) procedure|court (fee|rule|holiday|hours)|website|online|google|look ?up|search the web|price|cost|weather|address|phone number|hours|who is|what (is|does) the (law|rule|statute|penalty)|legislat|bill|sheriff|county|city of|state of utah|dmv|dopl|bci|case law|opinion|federal|irs|osha|ftc|fcra|hipaa)\b/i;
export function wantsWeb(question: string): boolean { return WEB_INTENT.test(question); }

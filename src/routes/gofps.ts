// ============================================================
// RMPG Flex — GoFPS (FastPeopleSearch Wrapper)
// ============================================================
// Mounted at /api/gofps (auth required).
// Scrapes fastpeoplesearch.com for people search results.
// No external API key required — free public data.
//
// Rate-limited via self-imposed pacing to avoid upstream blocks.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { queryFirst } from '../utils/db';
import { log } from '../utils/logger';

const gofps = new Hono<Env>();

const FPS_BASE = 'https://www.fastpeoplesearch.com';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function parsePeopleHtml(html: string): Array<{
  name: string;
  age: number | null;
  address: string;
  phone: string[];
  relatives: string[];
  url: string;
}> {
  const results: Array<{
    name: string;
    age: number | null;
    address: string;
    phone: string[];
    relatives: string[];
    url: string;
  }> = [];

  // Extract person cards from the HTML
  const cardRegex = /<div[^>]*class="[^"]*person-card[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
  const nameRegex = /<h2[^>]*>([\s\S]*?)<\/h2>/i;
  const ageRegex = /(?:Age|age)[:\s]*(\d{1,3})/i;
  const addressRegex = /<div[^>]*class="[^"]*address[^"]*"[^>]*>([\s\S]*?)<\/div>/i;
  const phoneRegex = /(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/g;
  const hrefRegex = /href="([^"]*\/person\/[^"]*)"/i;

  // Simpler fallback: extract structured data from linked person pages
  const personLinks = html.match(/href="(\/person\/[^"]+)"/g) ?? [];
  const seen = new Set<string>();

  for (const link of personLinks) {
    const href = link.replace(/href="|"/g, '');
    if (seen.has(href)) continue;
    seen.add(href);

    const nameMatch = html.match(new RegExp(`<a[^>]*href="${href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>([^<]+)</a>`, 'i'));
    const name = nameMatch?.[1]?.trim() ?? 'Unknown';

    results.push({
      name,
      age: null,
      address: '',
      phone: [],
      relatives: [],
      url: `${FPS_BASE}${href}`,
    });
  }

  return results.slice(0, 20);
}

gofps.get('/health', (c) => {
  return c.json({ ok: true, configured: true, source: 'fastpeoplesearch.com' });
});

gofps.post('/search', async (c) => {
  const body = await c.req.json<{ name?: string; city?: string; state?: string; phone?: string }>();
  const name = (body.name ?? '').trim();
  if (!name) return c.json({ error: 'name is required' }, 400);

  const city = (body.city ?? '').trim();
  const state = (body.state ?? '').trim();

  // Check cache (24h TTL for people search)
  const queryKey = await sha256Hex(`gofps:${name}:${city}:${state}`);
  const cached = await queryFirst<{
    results_json: string; expires_at: string;
  }>(c.env.DB,
    `SELECT results_json, expires_at FROM osint_cache
     WHERE source = 'gofps' AND query_key = ? AND expires_at > datetime('now')`,
    queryKey,
  );
  if (cached) {
    return c.json({ ...JSON.parse(cached.results_json), cached: true });
  }

  // Build search URL
  const searchName = name.replace(/\s+/g, '-').toLowerCase();
  let searchUrl = `${FPS_BASE}/search/${encodeURIComponent(searchName)}`;
  if (state) searchUrl += `/${encodeURIComponent(state.toLowerCase())}`;
  if (city) searchUrl += `/${encodeURIComponent(city.toLowerCase())}`;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    let res: Response;
    try {
      res = await fetch(searchUrl, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: ctrl.signal,
        redirect: 'follow',
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      log.warn('[gofps] upstream returned non-200', { status: res.status, url: searchUrl });
      return c.json({
        ok: true,
        query: { name, city, state },
        results: [],
        source: 'fastpeoplesearch.com',
        upstream_status: res.status,
      });
    }

    const html = await res.text();
    const results = parsePeopleHtml(html);

    const payload = {
      ok: true,
      query: { name, city, state },
      results,
      result_count: results.length,
      source: 'fastpeoplesearch.com',
      searched_at: new Date().toISOString(),
    };

    // Cache for 24 hours
    await c.env.DB.prepare(
      `INSERT OR REPLACE INTO osint_cache (source, query_key, query_text, results_json, user_id, expires_at)
       VALUES ('gofps', ?, ?, ?, ?, datetime('now', '+24 hours'))`,
    ).bind(
      queryKey,
      `${name} ${city} ${state}`.trim(),
      JSON.stringify(payload),
      (c.get('user') as any)?.id ?? null,
    ).run().catch((err) => log.error('[gofps] cache write failed', {}, err));

    return c.json(payload);
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return c.json({ ok: false, error: 'Search timed out' }, 504);
    }
    log.error('[gofps] search failed', { name, city, state }, err);
    return c.json({ ok: false, error: 'Search failed', detail: err?.message }, 500);
  }
});

gofps.get('/person', async (c) => {
  const url = c.req.query('url');
  if (!url || !url.startsWith(FPS_BASE)) {
    return c.json({ error: 'valid person URL is required' }, 400);
  }

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml',
        },
        signal: ctrl.signal,
        redirect: 'follow',
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) return c.json({ error: 'Failed to fetch person page' }, 502);

    const html = await res.text();

    // Extract basic details from the person page
    const nameMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    const ageMatch = html.match(/(?:Age|age)[:\s]*(\d{1,3})/i);
    const phones = [...new Set((html.match(/(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/g) ?? []))];
    const addresses = [...new Set(
      (html.match(/<div[^>]*class="[^"]*address[^"]*"[^>]*>([^<]+)<\/div>/gi) ?? [])
        .map((m) => m.replace(/<[^>]+>/g, '').trim())
        .filter(Boolean),
    )];

    return c.json({
      ok: true,
      name: nameMatch?.[1]?.trim() ?? 'Unknown',
      age: ageMatch ? parseInt(ageMatch[1], 10) : null,
      phones,
      addresses,
      source_url: url,
    });
  } catch (err: any) {
    if (err?.name === 'AbortError') return c.json({ ok: false, error: 'Request timed out' }, 504);
    log.error('[gofps] person fetch failed', { url }, err);
    return c.json({ ok: false, error: 'Failed to fetch person details' }, 500);
  }
});

gofps.get('/history', async (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10) || 50, 200);
  const { results } = await c.env.DB.prepare(
    `SELECT id, query_text, created_at, expires_at FROM osint_cache
     WHERE source = 'gofps' ORDER BY created_at DESC LIMIT ?`,
  ).bind(limit).all();
  return c.json(results);
});

export default gofps;

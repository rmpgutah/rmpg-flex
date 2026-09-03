// ============================================================
// RMPG Flex — GoSearch (Username OSINT)
// ============================================================
// Mounted at /api/gosearch (auth required).
// Searches 300+ websites for a username's digital footprint.
// Checks HudsonRock + ProxyNova leaked credential databases.
// Optional BreachDirectory API key for deeper breach lookups.
//
// Requires secret (optional): BREACHDIRECTORY_API_KEY
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { queryFirst } from '../utils/db';
import { requireRole } from '../middleware/auth';
import { log } from '../utils/logger';

const gosearch = new Hono<Env>();

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

// Sites to check — subset of GoSearch's 300+ targets, prioritized for
// security/law enforcement relevance. The full GoSearch list is in
// github.com/ibnaleem/gosearch.
const SITES = [
  { name: 'GitHub', url: 'https://github.com/{username}', check: 'login' },
  { name: 'Twitter/X', url: 'https://x.com/{username}', check: 'not_found' },
  { name: 'Instagram', url: 'https://www.instagram.com/{username}/', check: 'login' },
  { name: 'Reddit', url: 'https://www.reddit.com/user/{username}', check: 'sorry' },
  { name: 'LinkedIn', url: 'https://www.linkedin.com/in/{username}', check: 'login' },
  { name: 'Facebook', url: 'https://www.facebook.com/{username}', check: 'login' },
  { name: 'YouTube', url: 'https://www.youtube.com/@{username}', check: 'playability' },
  { name: 'TikTok', url: 'https://www.tiktok.com/@{username}', check: 'login' },
  { name: 'Pinterest', url: 'https://www.pinterest.com/{username}/', check: 'login' },
  { name: 'Tumblr', url: 'https://{username}.tumblr.com', check: 'not_found' },
  { name: 'Medium', url: 'https://medium.com/@{username}', check: 'is-404' },
  { name: 'Dev.to', url: 'https://dev.to/{username}', check: 'not_found' },
  { name: 'Keybase', url: 'https://keybase.io/{username}', check: 'not_found' },
  { name: 'Gravatar', url: 'https://en.gravatar.com/{username}', check: 'profile' },
  { name: 'Telegram', url: 'https://t.me/{username}', check: 'tgme_page' },
  { name: 'Mastodon', url: 'https://mastodon.social/@{username}', check: 'not_found' },
  { name: 'Twitch', url: 'https://www.twitch.tv/{username}', check: 'login' },
  { name: 'Steam', url: 'https://steamcommunity.com/id/{username}', check: 'login' },
  { name: 'HackerRank', url: 'https://www.hackerrank.com/{username}', check: 'not_found' },
  { name: 'GitLab', url: 'https://gitlab.com/{username}', check: 'login' },
];

function getBreachDirKey(env: Record<string, unknown>): string | undefined {
  return (env.BREACHDIRECTORY_API_KEY as string | undefined)?.trim() || undefined;
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function checkSite(
  username: string,
  site: { name: string; url: string; check: string },
  signal: AbortSignal,
): Promise<{ site: string; url: string; found: boolean; status: number }> {
  const url = site.url.replace(/\{username\}/g, username);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal,
      redirect: 'follow',
    });
    const status = res.status;

    // Basic heuristic: 200 = likely found, 404 = not found, 302 to login = uncertain
    let found = false;
    if (status === 200) {
      const text = await res.text().catch(() => '');
      // Some sites return 200 with "not found" messages
      found = !text.includes('not_found') && !text.includes('is-404');
    } else if (status === 302 || status === 301) {
      found = false; // redirect likely to login
    }

    return { site: site.name, url, found, status };
  } catch {
    return { site: site.name, url, found: false, status: 0 };
  }
}

async function checkHudsonRock(username: string, signal: AbortSignal): Promise<{
  breaches: Array<{ domain: string; count: number }>;
  total: number;
}> {
  try {
    const res = await fetch(
      `https://cavalier.hudsonrock.com/api/json/v2/osint-tools/search-by-username?username=${encodeURIComponent(username)}`,
      { headers: { 'User-Agent': USER_AGENT }, signal },
    );
    if (!res.ok) return { breaches: [], total: 0 };
    const data = await res.json() as { stealer_sessions?: Array<{ domain: string }> };
    const sessions = data.stealer_sessions ?? [];
    // Aggregate by domain
    const domainMap = new Map<string, number>();
    for (const s of sessions) {
      domainMap.set(s.domain, (domainMap.get(s.domain) ?? 0) + 1);
    }
    const breaches = [...domainMap.entries()]
      .map(([domain, count]) => ({ domain, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 50);
    return { breaches, total: sessions.length };
  } catch {
    return { breaches: [], total: 0 };
  }
}

async function checkProxyNova(username: string, signal: AbortSignal): Promise<{
  breaches: number;
  source: string;
}> {
  try {
    const res = await fetch(
      `https://www.proxynova.com/tools/comb/?q=${encodeURIComponent(username)}`,
      { headers: { 'User-Agent': USER_AGENT }, signal },
    );
    if (!res.ok) return { breaches: 0, source: 'proxynova' };
    const text = await res.text();
    // Look for breach count indicators in the response
    const countMatch = text.match(/(\d[\d,]+)\s*(?:results?|records?|leaks?)/i);
    return {
      breaches: countMatch ? parseInt(countMatch[1].replace(/,/g, ''), 10) : 0,
      source: 'proxynova',
    };
  } catch {
    return { breaches: 0, source: 'proxynova' };
  }
}

async function checkBreachDirectory(username: string, apiKey: string, signal: AbortSignal): Promise<{
  found: boolean;
  breaches: Array<{ domain: string; count: number }>;
  total: number;
}> {
  try {
    const res = await fetch(
      `https://breachdirectory.p.rapidapi.com/threats/getthreatbydomain?term=${encodeURIComponent(username)}`,
      {
        headers: {
          'X-RapidAPI-Key': apiKey,
          'X-RapidAPI-Host': 'breachdirectory.p.rapidapi.com',
        },
        signal,
      },
    );
    if (!res.ok) return { found: false, breaches: [], total: 0 };
    const data = await res.json() as { threats?: Array<{ domain: string; count?: number }> };
    const threats = data.threats ?? [];
    return {
      found: threats.length > 0,
      breaches: threats.map((t) => ({ domain: t.domain, count: t.count ?? 1 })),
      total: threats.reduce((sum, t) => sum + (t.count ?? 1), 0),
    };
  } catch {
    return { found: false, breaches: [], total: 0 };
  }
}

gosearch.get('/health', (c) => {
  const configured = Boolean(getBreachDirKey(c.env as Record<string, unknown>));
  return c.json({ ok: true, configured, source: 'gosearch-aggregate' });
});

gosearch.post('/search', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), async (c) => {
  const body = await c.req.json<{ username?: string; check_breaches?: boolean }>();
  const username = (body.username ?? '').trim();
  if (!username) return c.json({ error: 'username is required' }, 400);

  // Check cache (6h TTL — usernames change faster than people)
  const queryKey = await sha256Hex(`gosearch:${username}`);
  const cached = await queryFirst<{
    results_json: string; expires_at: string;
  }>(c.env.DB,
    `SELECT results_json, expires_at FROM osint_cache
     WHERE source = 'gosearch' AND query_key = ? AND expires_at > datetime('now')`,
    queryKey,
  );
  if (cached) {
    try {
      return c.json({ ...JSON.parse(cached.results_json), cached: true });
    } catch {
      // Malformed cache entry — fall through to a fresh lookup
    }
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);

  try {
    // Run site checks in parallel batches of 5
    const siteResults: Array<{ site: string; url: string; found: boolean; status: number }> = [];
    for (let i = 0; i < SITES.length; i += 5) {
      const batch = SITES.slice(i, i + 5);
      const batchResults = await Promise.all(
        batch.map((s) => checkSite(username, s, ctrl.signal)),
      );
      siteResults.push(...batchResults);
    }

    const foundSites = siteResults.filter((r) => r.found);

    // Credential breach checks (parallel)
    const [hudsonRock, proxynova] = await Promise.all([
      checkHudsonRock(username, ctrl.signal),
      checkProxyNova(username, ctrl.signal),
    ]);

    // Optional BreachDirectory
    let breachDir: { found: boolean; breaches: Array<{ domain: string; count: number }>; total: number } = {
      found: false, breaches: [], total: 0,
    };
    if (body.check_breaches) {
      const apiKey = getBreachDirKey(c.env as Record<string, unknown>);
      if (apiKey) {
        breachDir = await checkBreachDirectory(username, apiKey, ctrl.signal);
      }
    }

    const payload = {
      ok: true,
      username,
      profiles: {
        found: foundSites.length,
        total_checked: siteResults.length,
        sites: foundSites.map((r) => ({ name: r.site, url: r.url })),
        details: siteResults,
      },
      breaches: {
        hudson_rock: hudsonRock,
        proxynova,
        breach_directory: breachDir,
      },
      searched_at: new Date().toISOString(),
    };

    // Cache for 6 hours
    await c.env.DB.prepare(
      `INSERT OR REPLACE INTO osint_cache (source, query_key, query_text, results_json, user_id, expires_at)
       VALUES ('gosearch', ?, ?, ?, ?, datetime('now', '+6 hours'))`,
    ).bind(
      queryKey,
      username,
      JSON.stringify(payload),
      (c.get('user') as any)?.id ?? null,
    ).run().catch((err) => log.error('[gosearch] cache write failed', {}, err));

    return c.json(payload);
  } catch (err: any) {
    if (err?.name === 'AbortError') return c.json({ ok: false, error: 'Search timed out' }, 504);
    log.error('[gosearch] search failed', { username }, err);
    return c.json({ ok: false, error: 'Search failed', detail: err?.message }, 500);
  } finally {
    clearTimeout(timer);
  }
});

gosearch.get('/history', requireRole('admin', 'manager', 'supervisor', 'officer'), async (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10) || 50, 200);
  const { results } = await c.env.DB.prepare(
    `SELECT id, query_text, created_at, expires_at FROM osint_cache
     WHERE source = 'gosearch' ORDER BY created_at DESC LIMIT ?`,
  ).bind(limit).all();
  return c.json(results);
});

export default gosearch;

// ============================================================
// Multi-State Warrant Scraper
// ============================================================
// Scrapes active warrant / most-wanted lists from county sheriff
// websites across UT, CO, WY, ID, NV, AZ, NM, MT + federal (FBI). Also extracts
// warrant-related bookings from existing arrest_records.
//
// Complements the existing Utah-only warrants.utah.gov live-search
// (utahWarrantScraper.ts) by providing scheduled bulk scraping of
// county-published warrant pages across all configured states.
//
// Architecture (mirrors jailRosterScraper.ts):
//   - warrant_scraper_config table for source configuration
//   - scraped_warrants table for unified warrant cache
//   - Per-source parsers implement WarrantParser interface
//   - Circuit breaker + exponential backoff for failed sources
//   - Cross-links against persons table
//   - Scheduler: per-source configurable intervals
// ============================================================

import { createHash } from 'node:crypto';
import { getDb } from '../models/database';
import { localNow } from './timeUtils';
import { startRun, completeRun, failRun } from './scraperRunner';
import { Semaphore } from './semaphore';

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

// ── Constants ───────────────────────────────────────────────

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const REQUEST_TIMEOUT_MS = 20_000;
const CIRCUIT_BREAKER_THRESHOLD = 15;     // Higher threshold — many sites are flaky
const STARTUP_DELAY_MS = 60_000;          // 60s after boot (let jail roster start first)

// Concurrency cap — limits parallel HTTP fetches across all warrant sources
// to prevent boot-storm socket exhaustion and WAF correlation.
const FETCH_CONCURRENCY = 5;
const fetchSemaphore = new Semaphore(FETCH_CONCURRENCY);
const BACKOFF_BASE_MS = 2 * 60 * 60_000;  // 2 hours base
const BACKOFF_MAX_MS = 48 * 60 * 60_000;  // 48 hour cap
const STAGGER_DELAY_MS = 5_000;           // 5s between source starts

// Tier-based scheduling
const TIER_INTERVALS_MS: Record<number, number> = {
  1: 30 * 60_000,    // 30 min — critical
  2: 90 * 60_000,    // 90 min — high
  3: 180 * 60_000,   // 180 min — normal (default)
  4: 360 * 60_000,   // 360 min — low
};

function resolveInterval(config: WarrantSourceConfig): number {
  if (config.scrape_interval_minutes && config.scrape_interval_minutes > 0) {
    return config.scrape_interval_minutes * 60_000; // explicit override (back-compat)
  }
  const priority = config.priority ?? 3;
  return TIER_INTERVALS_MS[priority] ?? TIER_INTERVALS_MS[3];
}

function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function resolveJitterMs(sourceKey: string): number {
  // Deterministic 0-20 minute offset based on source_key hash
  return (simpleHash(sourceKey) % 1200) * 1000;
}

// ── Interfaces ──────────────────────────────────────────────

export interface WarrantEntry {
  warrant_id: string;
  full_name: string;
  first_name: string;
  last_name: string;
  middle_name: string;
  date_of_birth: string;
  age: number | null;
  gender: string;
  race: string;
  city: string;
  state: string;
  warrant_type: string;       // arrest, bench, search, civil, fugitive
  case_number: string;
  court_name: string;
  issue_date: string;
  charge_description: string;
  bail_amount: string;
  offense_level: string;      // felony, misdemeanor, etc.
  photo_url: string;
  detail_url: string;
}

interface WarrantParser {
  sourceKey: string;
  parseWarrants(content: string): WarrantEntry[];
}

interface WarrantSourceConfig {
  id: number;
  source_key: string;
  display_name: string;
  source_url: string | null;
  source_type: string;
  state: string;
  county: string | null;
  enabled: number;
  scrape_interval_minutes: number;
  last_scrape_at: string | null;
  consecutive_errors: number;
  circuit_broken: number;
  priority?: number;
  content_hash?: string | null;
  content_hash_updated_at?: string | null;
  etag?: string | null;
  last_modified?: string | null;
  last_success_at?: string | null;
  avg_parse_count?: number | null;
  p95_latency_ms?: number | null;
  jitter_seed?: number | null;
}

// ── Scheduler state ─────────────────────────────────────────

const sourceIntervals = new Map<string, ReturnType<typeof setInterval>>();
const backoffTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
const backoffAttempts = new Map<string, number>();
let startupTimeout: ReturnType<typeof setTimeout> | null = null;

// ── HTTP helpers ────────────────────────────────────────────

// Rotate User-Agents to avoid fingerprinting
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
];

function getRandomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

export interface FetchResult {
  body: string;
  status: number;
  etag: string | null;
  lastModified: string | null;
  bytes: number;
}

async function fetchPage(
  url: string,
  opts: { retries?: number; etag?: string | null; lastModified?: string | null } = {},
): Promise<FetchResult> {
  const retries = opts.retries ?? 3;
  const domain = new URL(url).hostname;
  const isApiEndpoint = domain.startsWith('api.') || url.includes('/api/');
  let lastErr: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      // API endpoints get minimal headers (no browser fingerprint needed)
      const headers: Record<string, string> = isApiEndpoint ? {
        'User-Agent': getRandomUA(),
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
      } : {
        'User-Agent': getRandomUA(),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Connection': 'keep-alive',
        'Referer': `https://www.google.com/search?q=${encodeURIComponent(domain)}+warrants`,
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'cross-site',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
        'sec-ch-ua': '"Chromium";v="131", "Not_A Brand";v="24"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
      };

      // Conditional request headers (If-None-Match / If-Modified-Since) — phase 2
      if (opts.etag) headers['If-None-Match'] = opts.etag;
      if (opts.lastModified) headers['If-Modified-Since'] = opts.lastModified;

      const res = await fetch(url, {
        headers,
        signal: controller.signal,
        redirect: 'follow',
      });
      clearTimeout(timeout);

      // 304 Not Modified — short-circuit success, no body to parse
      if (res.status === 304) {
        return { body: '', status: 304, etag: null, lastModified: null, bytes: 0 };
      }

      // 404 = page moved/restructured — permanent, don't retry
      if (res.status === 404) throw new Error(`HTTP_PERMANENT_404`);
      // 403 = blocked — might work with retry after delay
      if (res.status === 403 && attempt < retries) {
        await sleep(3000 * (attempt + 1));
        continue;
      }
      // 429 = rate limited — honor Retry-After header
      if (res.status === 429 && attempt < retries) {
        const retryAfter = parseInt(res.headers.get('retry-after') || '10', 10);
        await sleep(retryAfter * 1000);
        continue;
      }
      // 5xx / 408 = server error — retry with exponential backoff
      if ((res.status >= 500 || res.status === 408) && attempt < retries) {
        const backoff = Math.min(1000 * Math.pow(2, attempt), 8000) + Math.floor(Math.random() * 500);
        await sleep(backoff);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP_${res.status}`);

      const body = await res.text();
      return {
        body,
        status: res.status,
        etag: res.headers.get('etag'),
        lastModified: res.headers.get('last-modified'),
        bytes: body.length,
      };
    } catch (e: any) {
      clearTimeout(timeout);
      lastErr = e as Error;
      // Don't retry permanent errors or already-classified 4xx errors
      if (e?.message?.startsWith('HTTP_PERMANENT_') || e?.message?.startsWith('HTTP_4')) throw e;
      // Retry on network errors (timeout, DNS, connection reset) with exponential backoff
      if (attempt < retries) {
        const backoff = Math.min(1000 * Math.pow(2, attempt), 8000) + Math.floor(Math.random() * 500);
        await sleep(backoff);
        continue;
      }
      throw e;
    }
  }
  throw lastErr ?? new Error('fetchPage: max retries exceeded');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Name splitter ───────────────────────────────────────────

function splitName(fullName: string): { first: string; middle: string; last: string } {
  const cleaned = (fullName || '').trim();
  if (!cleaned) return { first: '', middle: '', last: '' };
  if (cleaned.includes(',')) {
    const [last, rest] = cleaned.split(',', 2).map(s => s.trim());
    const parts = (rest || '').split(/\s+/);
    return { first: parts[0] || '', middle: parts.slice(1).join(' '), last };
  }
  const parts = cleaned.split(/\s+/);
  if (parts.length === 1) return { first: parts[0], middle: '', last: '' };
  if (parts.length === 2) return { first: parts[0], middle: '', last: parts[1] };
  return { first: parts[0], middle: parts.slice(1, -1).join(' '), last: parts[parts.length - 1] };
}

function stripHtml(html: string): string {
  if (!html) return '';
  return html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#\d+;/g, '').trim();
}

// ════════════════════════════════════════════════════════════
//  GENERIC WARRANT PAGE PARSER
// ════════════════════════════════════════════════════════════
// Most sheriff warrant pages list wanted persons in HTML tables
// or card-style divs. This generic parser handles common patterns.

// ── Phase 3: WAF / block page detection ────────────────────
// Distinguish "site is blocking us" from "parser broken" so the
// dashboard can classify failures accurately. Small bodies are
// treated as suspicious because real warrant pages are never tiny.

function detectBlockPage(html: string): string | null {
  if (!html || html.length < 200) return 'response_too_small';
  if (/Just a moment\.\.\.|Attention Required|cf-browser-verification|cf-chl-bypass/i.test(html)) {
    return 'cloudflare_challenge';
  }
  if (/Access Denied|You don['’]t have permission|Request blocked/i.test(html)) {
    return 'access_denied';
  }
  if (/<title>403/i.test(html)) return 'http_403_wrapper';
  return null;
}

// ── Phase 3: Parser fallback cascade ────────────────────────
// When a registered custom parser returns 0 results or throws,
// fall back to the generic parser; if that also fails, a last-
// ditch all-caps name extraction runs. Drift signals are logged
// when tier 1 fails so the dashboard can surface parser rot.

export interface ParseResult {
  entries: WarrantEntry[];
  parserUsed: 'custom' | 'generic' | 'fallback';
  driftSignal?: string;
}

export function parseWithFallback(config: WarrantSourceConfig, html: string): ParseResult {
  const customParser = WARRANT_PARSERS[config.source_key];

  if (customParser) {
    try {
      const entries = customParser.parseWarrants(html);
      if (entries.length > 0) {
        return { entries, parserUsed: 'custom' };
      }
      // Custom returned 0 — log drift and try generic
      return { ...runGeneric(config.source_key, html), driftSignal: 'custom_zero_results' };
    } catch (err) {
      const msg = (err as Error).message || 'unknown';
      return { ...runGeneric(config.source_key, html), driftSignal: `custom_threw:${msg.substring(0, 80)}` };
    }
  }

  return runGeneric(config.source_key, html);
}

function runGeneric(sourceKey: string, html: string): ParseResult {
  try {
    const generic = createGenericWarrantParser(sourceKey);
    const entries = generic.parseWarrants(html);
    if (entries.length > 0) {
      return { entries, parserUsed: 'generic' };
    }
  } catch { /* fall through to all-caps extraction */ }

  // Tier 3: last-ditch all-caps name extraction
  const names = extractAllCapsNames(html);
  return {
    entries: names.map(n => createBlankEntry(n)),
    parserUsed: 'fallback',
  };
}

function extractAllCapsNames(html: string): string[] {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const matches = text.match(/\b[A-Z]{2,}(?:,\s*[A-Z]{2,})?(?:\s+[A-Z]{2,})?\b/g) || [];
  const uniq = new Set<string>();
  for (const m of matches) {
    if (m.length >= 5 && m.length <= 60) uniq.add(m.trim());
  }
  return Array.from(uniq).slice(0, 50);
}

function createBlankEntry(name: string): WarrantEntry {
  const parts = name.includes(',') ? name.split(',').map(s => s.trim()) : name.split(/\s+/);
  const [last = '', first = ''] = parts;
  return {
    warrant_id: '', full_name: name, first_name: first, last_name: last, middle_name: '',
    date_of_birth: '', age: null, gender: '', race: '', city: '', state: '',
    warrant_type: 'unknown', case_number: '', court_name: '', issue_date: '',
    charge_description: '', bail_amount: '', offense_level: '', photo_url: '',
    detail_url: '',
  };
}

function createGenericWarrantParser(sourceKey: string): WarrantParser {
  return {
    sourceKey,
    parseWarrants(html: string): WarrantEntry[] {
      const entries: WarrantEntry[] = [];
      const stateCode = sourceKey.split('_')[0]?.toUpperCase() || '';

      // Strategy 1: Look for table rows with warrant data
      const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      let match: RegExpExecArray | null;
      let tableRows = 0;

      while ((match = rowRegex.exec(html)) !== null) {
        const rowHtml = match[1];
        const cells: string[] = [];
        const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        let tdMatch: RegExpExecArray | null;
        while ((tdMatch = tdRe.exec(rowHtml)) !== null) {
          cells.push(stripHtml(tdMatch[1]));
        }
        if (cells.length < 2) continue;

        // Skip header rows
        if (cells[0].match(/^(Name|Inmate|Defendant|Subject|Warrant|#|ID)$/i)) continue;

        tableRows++;

        // Try to extract name and warrant info from cells
        let nameCell = '';
        let charges = '';
        let caseNum = '';
        let warrantType = '';
        let issueDate = '';
        let bail = '';

        for (const cell of cells) {
          if (!nameCell && cell.match(/[A-Z]{2,}/i) && (cell.includes(',') || cell.includes(' '))) {
            if (!cell.match(/^\d/) && cell.length > 3 && cell.length < 60) {
              nameCell = cell;
            }
          } else if (cell.match(/\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}/)) {
            issueDate = cell;
          } else if (cell.match(/\$([\d,.]+)/) || cell.match(/^\$?\d{1,3}(,\d{3})*(\.\d{2})?$/)) {
            bail = cell;
          } else if (cell.match(/(warrant|bench|arrest|fugitive|FTA|failure)/i)) {
            warrantType = cell;
          } else if (cell.match(/(case|CR|CF|MC|CV|DR)-?\d/i) || cell.match(/^\d{2,4}-[A-Z]{1,3}-\d+$/i)) {
            caseNum = cell;
          } else if (cell.length > 10 && !charges) {
            charges = cell;
          }
        }

        if (!nameCell) continue;

        const { first, middle, last } = splitName(nameCell);
        const wId = `${sourceKey}-${last}-${first}-${caseNum || issueDate || tableRows}`.replace(/[^a-zA-Z0-9-]/g, '').substring(0, 80);

        entries.push({
          warrant_id: wId,
          full_name: nameCell,
          first_name: first,
          last_name: last,
          middle_name: middle,
          date_of_birth: '',
          age: null,
          gender: '',
          race: '',
          city: '',
          state: stateCode,
          warrant_type: warrantType || 'arrest',
          case_number: caseNum,
          court_name: '',
          issue_date: issueDate,
          charge_description: charges,
          bail_amount: bail,
          offense_level: '',
          photo_url: '',
          detail_url: '',
        });
      }

      // Strategy 2: Card/div patterns with warrant/wanted/person/suspect class
      if (entries.length === 0) {
        const cardRegex = /<(?:div|article|section|li)[^>]*class="[^"]*(?:wanted|warrant|card|person|suspect|fugitive|offender|inmate|most-wanted|mostwanted)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|article|section|li)>/gi;
        let cardMatch: RegExpExecArray | null;
        let cardIdx = 0;

        while ((cardMatch = cardRegex.exec(html)) !== null) {
          const cardHtml = cardMatch[1];
          cardIdx++;

          const nameMatch = cardHtml.match(/<(?:h[1-6]|strong|b|a)[^>]*>([\s\S]*?)<\/(?:h[1-6]|strong|b|a)>/i);
          if (!nameMatch) continue;

          const nameText = stripHtml(nameMatch[1]);
          if (nameText.length < 3 || nameText.length > 60) continue;
          // Skip non-name content (dates, numbers, navigation text)
          if (/^\d|^(read|more|view|click|page|next|prev|back|home)/i.test(nameText)) continue;

          const imgMatch = cardHtml.match(/<img[^>]+src="([^"]+)"/i);
          const photoUrl = imgMatch ? imgMatch[1] : '';
          const linkMatch = cardHtml.match(/<a[^>]+href="([^"]+)"/i);
          const detailUrl = linkMatch ? linkMatch[1] : '';

          const descText = stripHtml(cardHtml.replace(nameMatch[0], ''));
          const chargeMatch = descText.match(/(?:charge|offense|crime|wanted for|warrant)[:\s]*(.+?)(?:\.|$)/i);

          const { first, middle, last } = splitName(nameText);
          const wId = `${sourceKey}-${last}-${first}-${cardIdx}`.replace(/[^a-zA-Z0-9-]/g, '').substring(0, 80);

          entries.push({
            warrant_id: wId, full_name: nameText, first_name: first, last_name: last, middle_name: middle,
            date_of_birth: '', age: null, gender: '', race: '', city: '', state: stateCode,
            warrant_type: 'arrest', case_number: '', court_name: '', issue_date: '',
            charge_description: chargeMatch ? chargeMatch[1].trim() : '',
            bail_amount: '', offense_level: '', photo_url: photoUrl, detail_url: detailUrl,
          });
        }
      }

      // Strategy 3: WordPress / CMS article patterns (post titles as names)
      if (entries.length === 0) {
        const articleRegex = /<article[^>]*>([\s\S]*?)<\/article>/gi;
        let artMatch: RegExpExecArray | null;
        let artIdx = 0;

        while ((artMatch = articleRegex.exec(html)) !== null) {
          const artHtml = artMatch[1];
          artIdx++;

          const titleMatch = artHtml.match(/<h[2-4][^>]*>\s*(?:<a[^>]*href="([^"]*)"[^>]*>)?([\s\S]*?)(?:<\/a>)?<\/h[2-4]>/i);
          if (!titleMatch) continue;

          const nameText = stripHtml(titleMatch[2]);
          // Filter: name must look like a person's name (at least 2 words, not an article title)
          if (nameText.length < 5 || nameText.length > 60) continue;
          if (nameText.split(/\s+/).length < 2) continue;
          if (/^(armed|robbery|homicide|shooting|burglary|theft|assault|update|news|press|notice|release)/i.test(nameText)) continue;

          const imgMatch = artHtml.match(/<img[^>]+src="([^"]+)"/i);
          const contentMatch = artHtml.match(/<div[^>]*class="[^"]*(?:entry-content|excerpt|summary|description)[^"]*"[^>]*>([\s\S]*?)<\/div>/i);

          const { first, middle, last } = splitName(nameText);
          const wId = `${sourceKey}-${last}-${first}-${artIdx}`.replace(/[^a-zA-Z0-9-]/g, '').substring(0, 80);

          entries.push({
            warrant_id: wId, full_name: nameText, first_name: first, last_name: last, middle_name: middle,
            date_of_birth: '', age: null, gender: '', race: '', city: '', state: stateCode,
            warrant_type: 'fugitive', case_number: '', court_name: '', issue_date: '',
            charge_description: contentMatch ? stripHtml(contentMatch[2]).substring(0, 300) : '',
            bail_amount: '', offense_level: '', photo_url: imgMatch?.[1] || '', detail_url: titleMatch[1] || '',
          });
        }
      }

      // Strategy 4: Links containing names in "LAST, FIRST" format (common warrant list pattern)
      if (entries.length === 0) {
        const linkRegex = /<a[^>]*href="([^"]*)"[^>]*>([^<]+)<\/a>/gi;
        let linkMatch: RegExpExecArray | null;
        let linkIdx = 0;
        const namePattern = /^([A-Z][A-Z'-]+),\s*([A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+)?)/;

        while ((linkMatch = linkRegex.exec(html)) !== null) {
          const linkText = linkMatch[2].trim();
          const nameCheck = namePattern.exec(linkText);
          if (!nameCheck) continue;
          linkIdx++;

          const fullName = linkText;
          const { first, middle, last } = splitName(fullName);
          if (!last || !first) continue;
          const wId = `${sourceKey}-${last}-${first}-${linkIdx}`.replace(/[^a-zA-Z0-9-]/g, '').substring(0, 80);

          entries.push({
            warrant_id: wId, full_name: fullName, first_name: first, last_name: last, middle_name: middle,
            date_of_birth: '', age: null, gender: '', race: '', city: '', state: stateCode,
            warrant_type: 'arrest', case_number: '', court_name: '', issue_date: '',
            charge_description: '', bail_amount: '', offense_level: '',
            photo_url: '', detail_url: linkMatch[1] || '',
          });
        }
      }

      // Strategy 5: All-caps names in page content (fallback for plain text lists)
      if (entries.length === 0) {
        const pageText = stripHtml(html);
        const nameRegex = /\b([A-Z][A-Z'-]{1,20}),\s+([A-Z][A-Za-z'-]+(?:\s+[A-Z]\.?)?(?:\s+[A-Z][A-Za-z'-]+)?)\b/g;
        let textMatch: RegExpExecArray | null;
        let textIdx = 0;
        const seen = new Set<string>();

        while ((textMatch = nameRegex.exec(pageText)) !== null) {
          const last = textMatch[1];
          const rest = textMatch[2];
          // Skip common false positives
          if (/^(COUNTY|STATE|CITY|OFFICE|DEPARTMENT|SHERIFF|POLICE|COURT|PAGE|HOME)/i.test(last)) continue;
          const fullName = `${last}, ${rest}`;
          if (seen.has(fullName.toLowerCase())) continue;
          seen.add(fullName.toLowerCase());
          textIdx++;

          const { first, middle, last: ln } = splitName(fullName);
          if (!ln || !first) continue;
          const wId = `${sourceKey}-${ln}-${first}-${textIdx}`.replace(/[^a-zA-Z0-9-]/g, '').substring(0, 80);

          entries.push({
            warrant_id: wId, full_name: fullName, first_name: first, last_name: ln, middle_name: middle,
            date_of_birth: '', age: null, gender: '', race: '', city: '', state: stateCode,
            warrant_type: 'arrest', case_number: '', court_name: '', issue_date: '',
            charge_description: '', bail_amount: '', offense_level: '',
            photo_url: '', detail_url: '',
          });
        }
      }

      return entries;
    },
  };
}


// ════════════════════════════════════════════════════════════
//  ARREST RECORD WARRANT EXTRACTOR
// ════════════════════════════════════════════════════════════
// Mines existing arrest_records for warrant-related bookings.
// This is the highest-ROI source because we already have this data.

const WARRANT_CHARGE_PATTERNS = [
  /\bwarrant\b/i,
  /\bFTA\b/,                          // Failure to Appear
  /\bfailure to appear\b/i,
  /\bbench\s*warrant\b/i,
  /\bfugitive\b/i,
  /\bbail\s*(?:jump|skip|violation)\b/i,
  /\bextradition\b/i,
  /\bparole\s*violation\b/i,
  /\bprobation\s*violation\b/i,
  /\bout of county\b.*\bwarrant\b/i,
  /\bhold for\b/i,
  /\bdetainer\b/i,
];

function extractWarrantsFromArrestRecords(): WarrantEntry[] {
  const db = getDb();
  const entries: WarrantEntry[] = [];

  try {
    // Get all active arrest records with their charges
    const records = db.prepare(`
      SELECT id, full_name, first_name, last_name, middle_name,
             date_of_birth, gender, race, charges, booking_date,
             county, state, bail_amount, booking_number, agency
      FROM arrest_records
      WHERE status = 'active'
        AND charges IS NOT NULL AND charges != '' AND charges != '[]'
      ORDER BY booking_date DESC
    `).all() as {
      id: number; full_name: string; first_name: string; last_name: string;
      middle_name: string; date_of_birth: string; gender: string; race: string;
      charges: string; booking_date: string; county: string; state: string;
      bail_amount: string; booking_number: string; agency: string;
    }[];

    for (const rec of records) {
      let chargesArr: string[] = [];
      try {
        const parsed = JSON.parse(rec.charges);
        chargesArr = Array.isArray(parsed) ? parsed : [String(parsed)];
      } catch {
        chargesArr = [rec.charges];
      }

      // Check each charge for warrant patterns
      const warrantCharges = chargesArr.filter(charge =>
        WARRANT_CHARGE_PATTERNS.some(pattern => pattern.test(charge))
      );

      if (warrantCharges.length === 0) continue;

      // Determine warrant type from charge text
      let warrantType = 'arrest';
      const chargeText = warrantCharges.join(' ').toLowerCase();
      if (chargeText.includes('bench') || chargeText.includes('fta') || chargeText.includes('failure to appear')) {
        warrantType = 'bench';
      } else if (chargeText.includes('fugitive') || chargeText.includes('extradition')) {
        warrantType = 'fugitive';
      } else if (chargeText.includes('parole') || chargeText.includes('probation')) {
        warrantType = 'parole_violation';
      }

      const wId = `arrest-${rec.id}-${rec.booking_number || rec.booking_date}`.replace(/[^a-zA-Z0-9-]/g, '').substring(0, 80);

      entries.push({
        warrant_id: wId,
        full_name: rec.full_name || `${rec.first_name} ${rec.last_name}`.trim(),
        first_name: rec.first_name || '',
        last_name: rec.last_name || '',
        middle_name: rec.middle_name || '',
        date_of_birth: rec.date_of_birth || '',
        age: null,
        gender: rec.gender || '',
        race: rec.race || '',
        city: '',
        state: rec.state || 'UT',
        warrant_type: warrantType,
        case_number: rec.booking_number || '',
        court_name: rec.agency || '',
        issue_date: rec.booking_date || '',
        charge_description: warrantCharges.join('; '),
        bail_amount: rec.bail_amount || '',
        offense_level: '',
        photo_url: '',
        detail_url: '',
      });
    }
  } catch (err) {
    console.error('[Warrant Scraper] Arrest record extraction error:', (err as Error).message);
  }

  return entries;
}


// ════════════════════════════════════════════════════════════
//  SPECIFIC STATE/COUNTY PARSERS
// ════════════════════════════════════════════════════════════

// ── El Paso County, CO ──────────────────────────────────────
// Sheriff publishes active warrants list

const elPasoCoWarrantParser: WarrantParser = {
  sourceKey: 'co_el_paso_warrants',
  parseWarrants(html: string): WarrantEntry[] {
    const entries: WarrantEntry[] = [];
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let match: RegExpExecArray | null;

    while ((match = rowRegex.exec(html)) !== null) {
      const cells: string[] = [];
      const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      let tdMatch: RegExpExecArray | null;
      while ((tdMatch = tdRe.exec(match[1])) !== null) {
        cells.push(stripHtml(tdMatch[1]));
      }
      if (cells.length < 2) continue;
      if (cells[0].match(/^(Name|Defendant|Subject|Last)$/i)) continue;

      let nameCell = '';
      let charges = '';
      let caseNum = '';
      let warrantType = '';
      let issueDate = '';
      let bail = '';
      let dob = '';

      for (const cell of cells) {
        if (!nameCell && cell.includes(',') && cell.match(/[A-Z]/i) && cell.length > 3) {
          nameCell = cell;
        } else if (cell.match(/\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}/) && !issueDate) {
          if (!dob && cell.match(/\b(19|20)\d{2}/)) dob = cell;
          else issueDate = cell;
        } else if (cell.match(/\$[\d,.]+/)) {
          bail = cell;
        } else if (cell.match(/(warrant|bench|arrest|FTA)/i)) {
          warrantType = cell;
        } else if (cell.length > 5 && !charges) {
          charges = cell;
        }
      }
      if (!nameCell) continue;

      const { first, middle, last } = splitName(nameCell);
      const wId = `epc-${last}-${first}-${caseNum || entries.length}`.replace(/[^a-zA-Z0-9-]/g, '');

      entries.push({
        warrant_id: wId, full_name: nameCell, first_name: first, last_name: last,
        middle_name: middle, date_of_birth: dob, age: null, gender: '', race: '',
        city: '', state: 'CO', warrant_type: warrantType || 'arrest',
        case_number: caseNum, court_name: 'El Paso County Court',
        issue_date: issueDate, charge_description: charges, bail_amount: bail,
        offense_level: '', photo_url: '', detail_url: '',
      });
    }
    return entries;
  },
};

// ── Clark County / LVMPD, NV ────────────────────────────────
// LVMPD publishes most wanted suspects

const lvmpdWarrantParser: WarrantParser = {
  sourceKey: 'nv_clark_warrants',
  parseWarrants(html: string): WarrantEntry[] {
    const entries: WarrantEntry[] = [];

    // LVMPD uses a card-based layout for wanted suspects
    const generic = createGenericWarrantParser('nv_clark_warrants');
    const genericResults = generic.parseWarrants(html);
    if (genericResults.length > 0) return genericResults;

    // Fallback: look for structured content with suspect names
    const nameRegex = /<(?:h[2-4]|strong|span)[^>]*class="[^"]*(?:name|title|suspect)[^"]*"[^>]*>([\s\S]*?)<\/(?:h[2-4]|strong|span)>/gi;
    let match: RegExpExecArray | null;
    let idx = 0;

    while ((match = nameRegex.exec(html)) !== null) {
      const nameText = stripHtml(match[1]);
      if (nameText.length < 3 || nameText.length > 60) continue;
      idx++;

      const { first, middle, last } = splitName(nameText);
      entries.push({
        warrant_id: `lvmpd-${last}-${first}-${idx}`.replace(/[^a-zA-Z0-9-]/g, ''),
        full_name: nameText, first_name: first, last_name: last, middle_name: middle,
        date_of_birth: '', age: null, gender: '', race: '', city: 'Las Vegas',
        state: 'NV', warrant_type: 'arrest', case_number: '', court_name: 'LVMPD',
        issue_date: '', charge_description: '', bail_amount: '', offense_level: '',
        photo_url: '', detail_url: '',
      });
    }
    return entries;
  },
};

// ── Maricopa County / MCSO, AZ ──────────────────────────────
// MCSO publishes "Most Wanted" list

const mcsoWarrantParser: WarrantParser = {
  sourceKey: 'az_maricopa_warrants',
  parseWarrants(html: string): WarrantEntry[] {
    const entries: WarrantEntry[] = [];

    // MCSO most wanted uses card-style with images
    const cardRegex = /<(?:div|li|article)[^>]*class="[^"]*(?:wanted|most-wanted|card|mugshot|person)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|li|article)>/gi;
    let match: RegExpExecArray | null;
    let idx = 0;

    while ((match = cardRegex.exec(html)) !== null) {
      idx++;
      const card = match[1];

      // Name from heading/strong
      const nameMatch = card.match(/<(?:h[1-6]|strong|b|span[^>]*class="[^"]*name)[^>]*>([\s\S]*?)<\/(?:h[1-6]|strong|b|span)>/i);
      if (!nameMatch) continue;
      const nameText = stripHtml(nameMatch[1]);
      if (nameText.length < 3 || nameText.length > 60) continue;

      // Image
      const imgMatch = card.match(/<img[^>]+src="([^"]+)"/i);
      const photo = imgMatch ? imgMatch[1] : '';

      // Description/charges
      const descMatch = card.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
      const desc = descMatch ? stripHtml(descMatch[1]) : '';

      const { first, middle, last } = splitName(nameText);
      entries.push({
        warrant_id: `mcso-${last}-${first}-${idx}`.replace(/[^a-zA-Z0-9-]/g, ''),
        full_name: nameText, first_name: first, last_name: last, middle_name: middle,
        date_of_birth: '', age: null, gender: '', race: '', city: 'Phoenix',
        state: 'AZ', warrant_type: 'arrest', case_number: '', court_name: 'MCSO',
        issue_date: '', charge_description: desc, bail_amount: '', offense_level: '',
        photo_url: photo, detail_url: '',
      });
    }

    // If card pattern didn't match, try generic
    if (entries.length === 0) {
      return createGenericWarrantParser('az_maricopa_warrants').parseWarrants(html);
    }
    return entries;
  },
};


// ── FBI Wanted API (Federal) ───────────────────────────────
// Fully public JSON API — best structured source available

const fbiWantedParser: WarrantParser = {
  sourceKey: 'federal_fbi_wanted',
  parseWarrants(content: string): WarrantEntry[] {
    try {
      const data = JSON.parse(content);
      const items = data.items || [];
      return items.map((item: any) => {
        const fullName = (item.title || '').trim();
        const { first, middle, last } = splitName(fullName);
        return {
          warrant_id: item.uid || `fbi-${(item['@id'] || '').split('/').pop() || ''}`,
          full_name: fullName,
          first_name: first,
          last_name: last,
          middle_name: middle,
          date_of_birth: item.dates_of_birth_used?.[0] || '',
          age: item.age_range ? parseInt(item.age_range) : null,
          gender: item.sex || '',
          race: item.race || '',
          city: '',
          state: 'US',
          warrant_type: item.person_classification === 'Main' ? 'fugitive' : 'arrest',
          case_number: item.ncic || '',
          court_name: 'Federal — FBI',
          issue_date: item.publication || '',
          charge_description: item.description
            ? stripHtml(item.description).substring(0, 500)
            : (item.caution ? stripHtml(item.caution).substring(0, 500) : ''),
          bail_amount: item.reward_text || '',
          offense_level: 'felony',
          photo_url: item.images?.[0]?.large || item.images?.[0]?.thumb || '',
          detail_url: item.url || '',
        };
      });
    } catch {
      return [];
    }
  },
};

// ── Washoe County / Secret Witness (Reno NV) ──────────────
// WordPress blog with card layout

const washoeWarrantParser: WarrantParser = {
  sourceKey: 'nv_washoe_warrants',
  parseWarrants(html: string): WarrantEntry[] {
    const entries: WarrantEntry[] = [];
    const postPattern = /<article[^>]*>[\s\S]*?<\/article>/gi;
    const posts = html.match(postPattern) || [];

    for (const post of posts) {
      const titleMatch = post.match(/<h2[^>]*class="[^"]*entry-title[^"]*"[^>]*>\s*<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
      const contentMatch = post.match(/<div[^>]*class="[^"]*entry-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
      const imgMatch = post.match(/<img[^>]*src="([^"]*)"[^>]*/i);

      if (!titleMatch) continue;

      const fullName = stripHtml(titleMatch[2]);
      if (fullName.length < 3 || fullName.length > 80) continue;
      const detailUrl = titleMatch[1] || '';
      const content = contentMatch ? stripHtml(contentMatch[1]).substring(0, 500) : '';
      const photoUrl = imgMatch?.[1] || '';

      const { first, middle, last } = splitName(fullName);
      entries.push({
        warrant_id: `sw-${fullName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}`.substring(0, 80),
        full_name: fullName,
        first_name: first,
        last_name: last,
        middle_name: middle,
        date_of_birth: '',
        age: null,
        gender: '',
        race: '',
        city: 'Reno',
        state: 'NV',
        warrant_type: 'fugitive',
        case_number: '',
        court_name: 'Washoe County',
        issue_date: '',
        charge_description: content,
        bail_amount: '',
        offense_level: content.toLowerCase().includes('felon') ? 'felony' : 'misdemeanor',
        photo_url: photoUrl,
        detail_url: detailUrl,
      });
    }
    return entries;
  },
};

// ── Pima County / 88-CRIME (Tucson AZ) ────────────────────
// WordPress card/grid layout for wanted fugitives

const pimaWarrantParser: WarrantParser = {
  sourceKey: 'az_pima_warrants',
  parseWarrants(html: string): WarrantEntry[] {
    const entries: WarrantEntry[] = [];
    const postPattern = /<article[^>]*>[\s\S]*?<\/article>/gi;
    const posts = html.match(postPattern) || [];

    for (const post of posts) {
      const titleMatch = post.match(/<h[23][^>]*>\s*<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
      const imgMatch = post.match(/<img[^>]*src="([^"]*)"[^>]*/i);
      const contentMatch = post.match(/<div[^>]*class="[^"]*(?:entry-content|excerpt)[^"]*"[^>]*>([\s\S]*?)<\/div>/i);

      if (!titleMatch) continue;

      const fullName = stripHtml(titleMatch[2]);
      // Skip non-person entries (e.g., "Armed Robbery at..." or "Homicide on...")
      if (/^(armed|robbery|homicide|shooting|burglary|theft|assault)/i.test(fullName)) continue;
      if (fullName.length < 3 || fullName.length > 80) continue;

      const detailUrl = titleMatch[1] || '';
      const content = contentMatch ? stripHtml(contentMatch[1]).substring(0, 500) : '';
      const photoUrl = imgMatch?.[1] || '';

      const { first, middle, last } = splitName(fullName);
      entries.push({
        warrant_id: `88c-${fullName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}`.substring(0, 80),
        full_name: fullName,
        first_name: first,
        last_name: last,
        middle_name: middle,
        date_of_birth: '',
        age: null,
        gender: '',
        race: '',
        city: 'Tucson',
        state: 'AZ',
        warrant_type: 'fugitive',
        case_number: '',
        court_name: 'Pima County',
        issue_date: '',
        charge_description: content,
        bail_amount: '',
        offense_level: content.toLowerCase().includes('felon') ? 'felony' : 'misdemeanor',
        photo_url: photoUrl,
        detail_url: detailUrl,
      });
    }
    return entries;
  },
};

// ── Metro Denver Crime Stoppers (CO) ───────────────────────
// CMS-based layout with wanted person cards

const denverCrimeStoppersParser: WarrantParser = {
  sourceKey: 'co_denver_warrants',
  parseWarrants(html: string): WarrantEntry[] {
    const entries: WarrantEntry[] = [];

    // Try WordPress article pattern first
    const postPattern = /<article[^>]*>[\s\S]*?<\/article>/gi;
    const posts = html.match(postPattern) || [];

    for (const post of posts) {
      const titleMatch = post.match(/<h[2-4][^>]*>\s*<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
      const imgMatch = post.match(/<img[^>]*src="([^"]*)"[^>]*/i);
      const contentMatch = post.match(/<div[^>]*class="[^"]*(?:entry-content|excerpt|summary)[^"]*"[^>]*>([\s\S]*?)<\/div>/i);

      if (!titleMatch) continue;

      const fullName = stripHtml(titleMatch[2]);
      // Skip non-person titles (incident descriptions, case numbers, etc.)
      if (/^(armed|robbery|homicide|shooting|burglary|theft|assault|case|incident)/i.test(fullName)) continue;
      if (fullName.length < 3 || fullName.length > 80) continue;

      const detailUrl = titleMatch[1] || '';
      const content = contentMatch ? stripHtml(contentMatch[1]).substring(0, 500) : '';
      const photoUrl = imgMatch?.[1] || '';

      const { first, middle, last } = splitName(fullName);
      entries.push({
        warrant_id: `mdcs-${fullName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}`.substring(0, 80),
        full_name: fullName,
        first_name: first,
        last_name: last,
        middle_name: middle,
        date_of_birth: '',
        age: null,
        gender: '',
        race: '',
        city: 'Denver',
        state: 'CO',
        warrant_type: 'fugitive',
        case_number: '',
        court_name: 'Metro Denver Crime Stoppers',
        issue_date: '',
        charge_description: content,
        bail_amount: '',
        offense_level: content.toLowerCase().includes('felon') ? 'felony' : 'misdemeanor',
        photo_url: photoUrl,
        detail_url: detailUrl,
      });
    }

    // Fallback to generic card pattern if no articles matched
    if (entries.length === 0) {
      return createGenericWarrantParser('co_denver_warrants').parseWarrants(html);
    }
    return entries;
  },
};

// ── Flathead County MT ─────────────────────────────────────
// Clean HTML table layout at apps.flathead.mt.gov

const flatheadWarrantParser: WarrantParser = {
  sourceKey: 'mt_flathead_warrants',
  parseWarrants(html: string): WarrantEntry[] {
    const entries: WarrantEntry[] = [];

    // Flathead uses <div class="warrant-entry"> cards with:
    //   <div class="warrant-name"><p>LAST, <span>FIRST MIDDLE</span></p></div>
    //   <div class="warrant-stat"><h6>Age:</h6><p>25</p></div>
    //   <div class="warrant-stat"><h6>Last Known Location:</h6><p>Kalispell, MT</p></div>
    //   <div class="img_mug" style="...url('image_thumb_script.php?f=...')..."></div>
    const entryRegex = /<a[^>]*class="warrant-link"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    let match: RegExpExecArray | null;

    while ((match = entryRegex.exec(html)) !== null) {
      const detailUrl = match[1] || '';
      const cardHtml = match[2];

      // Extract name: "LAST, <span class="lighten-text">FIRST MIDDLE</span>"
      const nameMatch = cardHtml.match(/<div[^>]*class="warrant-name"[^>]*>[\s\S]*?<p>\s*([\s\S]*?)\s*<\/p>/i);
      if (!nameMatch) continue;
      const nameRaw = stripHtml(nameMatch[1]);
      if (nameRaw.length < 3 || nameRaw.length > 80) continue;

      // Extract age
      const ageMatch = cardHtml.match(/<h6>Age:<\/h6>\s*<p>\s*(\d+)\s*<\/p>/i);
      const age = ageMatch ? parseInt(ageMatch[1]) : null;

      // Extract city/location
      const locMatch = cardHtml.match(/<h6>Last Known Location:<\/h6>\s*<p>\s*([\s\S]*?)\s*<\/p>/i);
      const location = locMatch ? stripHtml(locMatch[1]) : '';

      // Extract mugshot
      const imgMatch = cardHtml.match(/url\('([^']+)'\)/i);
      const photoUrl = imgMatch ? `https://apps.flathead.mt.gov/warrants/${imgMatch[1]}` : '';

      const { first, middle, last } = splitName(nameRaw);
      const wId = `fhc-${last}-${first}-${entries.length}`.replace(/[^a-zA-Z0-9-]/g, '').substring(0, 80);

      entries.push({
        warrant_id: wId,
        full_name: nameRaw,
        first_name: first,
        last_name: last,
        middle_name: middle,
        date_of_birth: '',
        age,
        gender: '',
        race: '',
        city: location || 'Flathead County',
        state: 'MT',
        warrant_type: 'arrest',
        case_number: '',
        court_name: 'Flathead County',
        issue_date: '',
        charge_description: '',
        bail_amount: '',
        offense_level: '',
        photo_url: photoUrl,
        detail_url: detailUrl ? `https://apps.flathead.mt.gov/warrants/${detailUrl}` : '',
      });
    }
    return entries;
  },
};


// ── LAPD Most Wanted (CA) ────────────────────────────────────
const lapdWarrantParser: WarrantParser = {
  sourceKey: 'ca_los_angeles_warrants',
  parseWarrants(html: string): WarrantEntry[] {
    const entries: WarrantEntry[] = [];
    const postPattern = /<article[^>]*>[\s\S]*?<\/article>/gi;
    const posts = html.match(postPattern) || [];
    for (const post of posts) {
      const titleMatch = post.match(/<h[23][^>]*>\s*<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
      const imgMatch = post.match(/<img[^>]*src="([^"]*)"[^>]*/i);
      const contentMatch = post.match(/<div[^>]*class="[^"]*(?:entry-content|excerpt)[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
      if (!titleMatch) continue;
      const fullName = stripHtml(titleMatch[2]);
      if (/^(armed|robbery|homicide|shooting|burglary)/i.test(fullName)) continue;
      const { first, middle, last } = splitName(fullName);
      entries.push({ warrant_id: `lapd-${last}-${first}`.toLowerCase().replace(/[^a-z0-9-]/g, ''), full_name: fullName, first_name: first, last_name: last, middle_name: middle, date_of_birth: '', age: null, gender: '', race: '', city: 'Los Angeles', state: 'CA', warrant_type: 'fugitive', case_number: '', court_name: 'LAPD', issue_date: '', charge_description: stripHtml(contentMatch?.[1] || '').substring(0, 500), bail_amount: '', offense_level: 'felony', photo_url: imgMatch?.[1] || '', detail_url: titleMatch[1] || '' });
    }
    return entries;
  },
};

// ── Cook County Sheriff (IL) ─────────────────────────────────
const cookCountyWarrantParser: WarrantParser = {
  sourceKey: 'il_cook_warrants',
  parseWarrants(html: string): WarrantEntry[] {
    const entries: WarrantEntry[] = [];
    const cardPattern = /<div[^>]*class="[^"]*(?:wanted|fugitive|most-wanted)[^"]*"[^>]*>[\s\S]*?(?:<\/div>\s*){2,}/gi;
    const cards = html.match(cardPattern) || [];
    for (const card of cards) {
      const nameMatch = card.match(/<(?:h[234]|strong|b)[^>]*>([\s\S]*?)<\/(?:h[234]|strong|b)>/i);
      const imgMatch = card.match(/<img[^>]*src="([^"]*)"[^>]*/i);
      const textContent = stripHtml(card);
      if (!nameMatch) continue;
      const fullName = stripHtml(nameMatch[1]);
      if (fullName.length < 3 || fullName.length > 60) continue;
      const { first, middle, last } = splitName(fullName);
      const chargeMatch = textContent.match(/(?:charge|wanted for|crime)[:\s]*([\s\S]{5,200}?)(?:\.|$)/i);
      entries.push({ warrant_id: `cook-${last}-${first}`.toLowerCase().replace(/[^a-z0-9-]/g, ''), full_name: fullName, first_name: first, last_name: last, middle_name: middle, date_of_birth: '', age: null, gender: '', race: '', city: 'Chicago', state: 'IL', warrant_type: 'fugitive', case_number: '', court_name: 'Cook County Sheriff', issue_date: '', charge_description: chargeMatch?.[1]?.trim() || textContent.substring(0, 300), bail_amount: '', offense_level: textContent.toLowerCase().includes('felon') ? 'felony' : 'misdemeanor', photo_url: imgMatch?.[1] || '', detail_url: '' });
    }
    return entries;
  },
};

// ── NJ State Police Wanted ───────────────────────────────────
const njspWarrantParser: WarrantParser = {
  sourceKey: 'nj_essex_warrants',
  parseWarrants(html: string): WarrantEntry[] {
    const entries: WarrantEntry[] = [];
    // NJSP uses a structured list with suspect details
    const itemPattern = /<li[^>]*class="[^"]*(?:wanted|suspect|fugitive)[^"]*"[^>]*>[\s\S]*?<\/li>/gi;
    const items = html.match(itemPattern) || [];
    for (const item of items) {
      const nameMatch = item.match(/<(?:h[234]|strong|a)[^>]*>([\s\S]*?)<\/(?:h[234]|strong|a)>/i);
      const imgMatch = item.match(/<img[^>]*src="([^"]*)"[^>]*/i);
      const linkMatch = item.match(/<a[^>]*href="([^"]*)"[^>]*/i);
      if (!nameMatch) continue;
      const fullName = stripHtml(nameMatch[1]);
      if (fullName.length < 3) continue;
      const { first, middle, last } = splitName(fullName);
      entries.push({ warrant_id: `njsp-${last}-${first}`.toLowerCase().replace(/[^a-z0-9-]/g, ''), full_name: fullName, first_name: first, last_name: last, middle_name: middle, date_of_birth: '', age: null, gender: '', race: '', city: '', state: 'NJ', warrant_type: 'fugitive', case_number: '', court_name: 'NJ State Police', issue_date: '', charge_description: stripHtml(item).substring(0, 500), bail_amount: '', offense_level: 'felony', photo_url: imgMatch?.[1] || '', detail_url: linkMatch?.[1] || '' });
    }
    // Fallback to generic if structured pattern fails
    if (entries.length === 0) return createGenericWarrantParser('nj_essex_warrants').parseWarrants(html);
    return entries;
  },
};

// ── NYPD Most Wanted ─────────────────────────────────────────
const nypdWarrantParser: WarrantParser = {
  sourceKey: 'ny_new_york_warrants',
  parseWarrants(html: string): WarrantEntry[] {
    const entries: WarrantEntry[] = [];
    const cardPattern = /<(?:article|div)[^>]*class="[^"]*(?:card|wanted|suspect|person)[^"]*"[^>]*>[\s\S]*?<\/(?:article|div)>/gi;
    const cards = html.match(cardPattern) || [];
    for (const card of cards) {
      const nameMatch = card.match(/<(?:h[234]|strong)[^>]*>([\s\S]*?)<\/(?:h[234]|strong)>/i);
      const imgMatch = card.match(/<img[^>]*src="([^"]*)"[^>]*/i);
      const linkMatch = card.match(/<a[^>]*href="([^"]*)"[^>]*/i);
      if (!nameMatch) continue;
      const fullName = stripHtml(nameMatch[1]);
      if (fullName.length < 3 || fullName.length > 80) continue;
      if (/^(crime|reward|tip|case)/i.test(fullName)) continue;
      const { first, middle, last } = splitName(fullName);
      const text = stripHtml(card);
      entries.push({ warrant_id: `nypd-${last}-${first}`.toLowerCase().replace(/[^a-z0-9-]/g, ''), full_name: fullName, first_name: first, last_name: last, middle_name: middle, date_of_birth: '', age: null, gender: '', race: '', city: 'New York', state: 'NY', warrant_type: 'fugitive', case_number: '', court_name: 'NYPD', issue_date: '', charge_description: text.substring(0, 400), bail_amount: '', offense_level: 'felony', photo_url: imgMatch?.[1] || '', detail_url: linkMatch?.[1] || '' });
    }
    if (entries.length === 0) return createGenericWarrantParser('ny_new_york_warrants').parseWarrants(html);
    return entries;
  },
};

// ── Philadelphia PD Most Wanted ──────────────────────────────
const phillyWarrantParser: WarrantParser = {
  sourceKey: 'pa_philadelphia_warrants',
  parseWarrants(html: string): WarrantEntry[] {
    const entries: WarrantEntry[] = [];
    const cardPattern = /<(?:article|div)[^>]*class="[^"]*(?:wanted|fugitive|card|suspect)[^"]*"[^>]*>[\s\S]*?<\/(?:article|div)>/gi;
    const cards = html.match(cardPattern) || [];
    for (const card of cards) {
      const nameMatch = card.match(/<(?:h[234]|strong)[^>]*>([\s\S]*?)<\/(?:h[234]|strong)>/i);
      const imgMatch = card.match(/<img[^>]*src="([^"]*)"[^>]*/i);
      const linkMatch = card.match(/<a[^>]*href="([^"]*)"[^>]*/i);
      if (!nameMatch) continue;
      const fullName = stripHtml(nameMatch[1]);
      if (fullName.length < 3 || /^(crime|reward|tip)/i.test(fullName)) continue;
      const { first, middle, last } = splitName(fullName);
      entries.push({ warrant_id: `ppd-${last}-${first}`.toLowerCase().replace(/[^a-z0-9-]/g, ''), full_name: fullName, first_name: first, last_name: last, middle_name: middle, date_of_birth: '', age: null, gender: '', race: '', city: 'Philadelphia', state: 'PA', warrant_type: 'fugitive', case_number: '', court_name: 'Philadelphia PD', issue_date: '', charge_description: stripHtml(card).substring(0, 400), bail_amount: '', offense_level: 'felony', photo_url: imgMatch?.[1] || '', detail_url: linkMatch?.[1] || '' });
    }
    if (entries.length === 0) return createGenericWarrantParser('pa_philadelphia_warrants').parseWarrants(html);
    return entries;
  },
};

// ── Houston Crime Stoppers (TX) ──────────────────────────────
const houstonWarrantParser: WarrantParser = {
  sourceKey: 'tx_harris_warrants',
  parseWarrants(html: string): WarrantEntry[] {
    const entries: WarrantEntry[] = [];
    const articlePattern = /<article[^>]*>[\s\S]*?<\/article>/gi;
    const articles = html.match(articlePattern) || [];
    for (const article of articles) {
      const titleMatch = article.match(/<h[23][^>]*>\s*<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
      const imgMatch = article.match(/<img[^>]*src="([^"]*)"[^>]*/i);
      if (!titleMatch) continue;
      const fullName = stripHtml(titleMatch[2]);
      if (fullName.length < 3 || /^(armed|robbery|homicide|shooting)/i.test(fullName)) continue;
      const { first, middle, last } = splitName(fullName);
      entries.push({ warrant_id: `htx-${last}-${first}`.toLowerCase().replace(/[^a-z0-9-]/g, ''), full_name: fullName, first_name: first, last_name: last, middle_name: middle, date_of_birth: '', age: null, gender: '', race: '', city: 'Houston', state: 'TX', warrant_type: 'fugitive', case_number: '', court_name: 'Houston Crime Stoppers', issue_date: '', charge_description: stripHtml(article).substring(0, 400), bail_amount: '', offense_level: 'felony', photo_url: imgMatch?.[1] || '', detail_url: titleMatch[1] || '' });
    }
    if (entries.length === 0) return createGenericWarrantParser('tx_harris_warrants').parseWarrants(html);
    return entries;
  },
};

// ── Massachusetts Most Wanted ────────────────────────────────
const maWarrantParser: WarrantParser = {
  sourceKey: 'ma_suffolk_warrants',
  parseWarrants(html: string): WarrantEntry[] {
    const entries: WarrantEntry[] = [];
    // Mass.gov uses structured content blocks
    const blockPattern = /<(?:article|li|div)[^>]*class="[^"]*(?:wanted|person|fugitive|listing-item)[^"]*"[^>]*>[\s\S]*?<\/(?:article|li|div)>/gi;
    const blocks = html.match(blockPattern) || [];
    for (const block of blocks) {
      const nameMatch = block.match(/<(?:h[234]|strong|a)[^>]*>([\s\S]*?)<\/(?:h[234]|strong|a)>/i);
      const imgMatch = block.match(/<img[^>]*src="([^"]*)"[^>]*/i);
      const linkMatch = block.match(/<a[^>]*href="([^"]*)"[^>]*/i);
      if (!nameMatch) continue;
      const fullName = stripHtml(nameMatch[1]);
      if (fullName.length < 3 || fullName.length > 80) continue;
      const { first, middle, last } = splitName(fullName);
      entries.push({ warrant_id: `ma-${last}-${first}`.toLowerCase().replace(/[^a-z0-9-]/g, ''), full_name: fullName, first_name: first, last_name: last, middle_name: middle, date_of_birth: '', age: null, gender: '', race: '', city: 'Boston', state: 'MA', warrant_type: 'fugitive', case_number: '', court_name: 'Massachusetts', issue_date: '', charge_description: stripHtml(block).substring(0, 400), bail_amount: '', offense_level: 'felony', photo_url: imgMatch?.[1] || '', detail_url: linkMatch?.[1] || '' });
    }
    if (entries.length === 0) return createGenericWarrantParser('ma_suffolk_warrants').parseWarrants(html);
    return entries;
  },
};

// ── Miami-Dade Crime Stoppers (FL) ───────────────────────────
const miamiWarrantParser: WarrantParser = {
  sourceKey: 'fl_miami_warrants',
  parseWarrants(html: string): WarrantEntry[] {
    const entries: WarrantEntry[] = [];
    const articlePattern = /<article[^>]*>[\s\S]*?<\/article>/gi;
    const articles = html.match(articlePattern) || [];
    for (const article of articles) {
      const titleMatch = article.match(/<h[23][^>]*>\s*(?:<a[^>]*href="([^"]*)"[^>]*>)?([\s\S]*?)(?:<\/a>)?<\/h[23]>/i);
      const imgMatch = article.match(/<img[^>]*src="([^"]*)"[^>]*/i);
      if (!titleMatch) continue;
      const fullName = stripHtml(titleMatch[2]);
      if (fullName.length < 3 || /^(armed|robbery|homicide)/i.test(fullName)) continue;
      const { first, middle, last } = splitName(fullName);
      entries.push({ warrant_id: `mia-${last}-${first}`.toLowerCase().replace(/[^a-z0-9-]/g, ''), full_name: fullName, first_name: first, last_name: last, middle_name: middle, date_of_birth: '', age: null, gender: '', race: '', city: 'Miami', state: 'FL', warrant_type: 'fugitive', case_number: '', court_name: 'Miami-Dade Crime Stoppers', issue_date: '', charge_description: stripHtml(article).substring(0, 400), bail_amount: '', offense_level: 'felony', photo_url: imgMatch?.[1] || '', detail_url: titleMatch[1] || '' });
    }
    if (entries.length === 0) return createGenericWarrantParser('fl_miami_warrants').parseWarrants(html);
    return entries;
  },
};


// ════════════════════════════════════════════════════════════
//  PAGINATED SOURCES — sources that need multiple page fetches
// ════════════════════════════════════════════════════════════

const FLATHEAD_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const PAGINATED_SOURCES: Record<string, string[]> = {
  mt_flathead_warrants: FLATHEAD_LETTERS.map(l => `https://apps.flathead.mt.gov/warrants/warrants_list.php?letter=${l}`),
};


// ════════════════════════════════════════════════════════════
//  PARSER REGISTRY
// ════════════════════════════════════════════════════════════

const WARRANT_PARSERS: Record<string, WarrantParser> = {
  // Original 3
  co_el_paso_warrants: elPasoCoWarrantParser,
  nv_clark_warrants: lvmpdWarrantParser,
  az_maricopa_warrants: mcsoWarrantParser,
  // Federal + Mountain West
  federal_fbi_wanted: fbiWantedParser,
  fed_fbi_wanted: fbiWantedParser,  // DB key alias
  nv_washoe_warrants: washoeWarrantParser,
  az_pima_warrants: pimaWarrantParser,
  co_denver_warrants: denverCrimeStoppersParser,
  mt_flathead_warrants: flatheadWarrantParser,
  // Major metro / state parsers
  ca_los_angeles_warrants: lapdWarrantParser,
  il_cook_warrants: cookCountyWarrantParser,
  nj_essex_warrants: njspWarrantParser,
  ny_new_york_warrants: nypdWarrantParser,
  pa_philadelphia_warrants: phillyWarrantParser,
  tx_harris_warrants: houstonWarrantParser,
  ma_suffolk_warrants: maWarrantParser,
  fl_miami_warrants: miamiWarrantParser,
  // All other sources use createGenericWarrantParser() as fallback
};


// ════════════════════════════════════════════════════════════
//  UPSERT + CROSS-LINKING
// ════════════════════════════════════════════════════════════

function upsertWarrants(sourceKey: string, entries: WarrantEntry[]): { inserted: number; updated: number } {
  const db = getDb();
  const now = localNow();
  let inserted = 0;
  let updated = 0;

  const checkStmt = db.prepare(
    'SELECT id FROM scraped_warrants WHERE source_key = ? AND warrant_id = ?'
  );

  // Only insert warrants for persons who exist in our database.
  // Match by first_name + last_name (case-insensitive).
  // If DOB is available, require it to match for higher confidence.
  const matchPersonStmt = db.prepare(`
    SELECT id FROM persons
    WHERE LOWER(first_name) = LOWER(?) AND LOWER(last_name) = LOWER(?)
    LIMIT 1
  `);
  const matchPersonDobStmt = db.prepare(`
    SELECT id FROM persons
    WHERE LOWER(first_name) = LOWER(?) AND LOWER(last_name) = LOWER(?) AND dob = ?
    LIMIT 1
  `);

  const insertStmt = db.prepare(`
    INSERT INTO scraped_warrants
      (source_key, warrant_id, full_name, first_name, last_name, middle_name,
       date_of_birth, age, gender, race, city, state, warrant_type,
       case_number, court_name, issue_date, charge_description, bail_amount,
       offense_level, photo_url, detail_url, status, first_seen_at, last_seen_at,
       person_id, dob_verified)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
  `);

  const updateStmt = db.prepare(`
    UPDATE scraped_warrants SET
      full_name = ?, first_name = ?, last_name = ?, middle_name = ?,
      date_of_birth = ?, age = ?, gender = ?, race = ?, city = ?,
      charge_description = ?, bail_amount = ?,
      photo_url = CASE WHEN ? != '' THEN ? ELSE photo_url END,
      status = 'active', last_seen_at = ?, cleared_at = NULL
    WHERE source_key = ? AND warrant_id = ?
  `);

  const txn = db.transaction(() => {
    for (const entry of entries) {
      // Check if this warrant already exists (always update existing records)
      const existing = checkStmt.get(sourceKey, entry.warrant_id);
      if (existing) {
        updateStmt.run(
          entry.full_name, entry.first_name, entry.last_name, entry.middle_name,
          entry.date_of_birth, entry.age, entry.gender, entry.race, entry.city,
          entry.charge_description, entry.bail_amount,
          entry.photo_url, entry.photo_url,
          now, sourceKey, entry.warrant_id
        );
        updated++;
      } else {
        // Only INSERT new warrants if the person exists in our database
        let personId: number | null = null;
        let dobVerified = 0;

        if (entry.first_name && entry.last_name) {
          // Try DOB match first (higher confidence)
          if (entry.date_of_birth) {
            const dobMatch = matchPersonDobStmt.get(entry.first_name, entry.last_name, entry.date_of_birth) as any;
            if (dobMatch) { personId = dobMatch.id; dobVerified = 1; }
          }
          // Fall back to name-only match
          if (!personId) {
            const nameMatch = matchPersonStmt.get(entry.first_name, entry.last_name) as any;
            if (nameMatch) { personId = nameMatch.id; dobVerified = 0; }
          }
        }

        // Store ALL warrants (national search needs full dataset)
        // person_id is set if matched to a local person (for alerts)

        insertStmt.run(
          sourceKey, entry.warrant_id, entry.full_name, entry.first_name, entry.last_name,
          entry.middle_name, entry.date_of_birth, entry.age, entry.gender, entry.race,
          entry.city, entry.state, entry.warrant_type, entry.case_number, entry.court_name,
          entry.issue_date, entry.charge_description, entry.bail_amount, entry.offense_level,
          entry.photo_url, entry.detail_url, now, now, personId, dobVerified
        );
        inserted++;
      }
    }
  });

  txn();
  return { inserted, updated };
}

/**
 * Mark warrants that no longer appear in the scrape as "cleared".
 */
function detectClearedWarrants(sourceKey: string, currentWarrantIds: string[]): number {
  const db = getDb();
  const now = localNow();

  if (currentWarrantIds.length === 0) return 0;

  // Get all currently active warrants for this source
  const activeWarrants = db.prepare(
    "SELECT warrant_id FROM scraped_warrants WHERE source_key = ? AND status = 'active'"
  ).all(sourceKey) as { warrant_id: string }[];

  const currentSet = new Set(currentWarrantIds);
  let cleared = 0;

  const clearStmt = db.prepare(
    'UPDATE scraped_warrants SET status = ?, cleared_at = ? WHERE source_key = ? AND warrant_id = ?'
  );

  for (const active of activeWarrants) {
    if (!currentSet.has(active.warrant_id)) {
      clearStmt.run('cleared', now, sourceKey, active.warrant_id);
      cleared++;
    }
  }

  return cleared;
}

/**
 * Cross-link scraped warrants with persons in the database.
 * Uses DOB verification when available for higher-confidence matches.
 * Sets dob_verified=1 when DOB matches, providing a confidence indicator.
 */
function crossLinkWarrants(): void {
  const db = getDb();
  try {
    // Find scraped warrants without a person_id that match a known person
    const unlinked = db.prepare(`
      SELECT sw.id, sw.first_name, sw.last_name, sw.date_of_birth, sw.age
      FROM scraped_warrants sw
      WHERE sw.person_id IS NULL
        AND sw.first_name IS NOT NULL AND sw.first_name != ''
        AND sw.last_name IS NOT NULL AND sw.last_name != ''
    `).all() as { id: number; first_name: string; last_name: string; date_of_birth: string; age: number | null }[];

    const updateWithDob = db.prepare('UPDATE scraped_warrants SET person_id = ?, dob_verified = 1 WHERE id = ?');
    const updateWithoutDob = db.prepare('UPDATE scraped_warrants SET person_id = ?, dob_verified = 0 WHERE id = ?');
    let linkedDob = 0;
    let linkedName = 0;

    for (const sw of unlinked) {
      let person: { id: number; dob: string | null } | undefined;
      let dobVerified = false;

      // Strategy 1: Exact DOB match (highest confidence)
      if (sw.date_of_birth) {
        person = db.prepare(`
          SELECT id, dob FROM persons
          WHERE UPPER(first_name) = UPPER(?) AND UPPER(last_name) = UPPER(?)
          AND dob = ? AND archived_at IS NULL
          LIMIT 1
        `).get(sw.first_name, sw.last_name, sw.date_of_birth) as { id: number; dob: string | null } | undefined;

        if (person) dobVerified = true;
      }

      // Strategy 2: Age-based DOB verification (warrant has age, person has DOB)
      if (!person && sw.age != null) {
        const candidates = db.prepare(`
          SELECT id, dob FROM persons
          WHERE UPPER(first_name) = UPPER(?) AND UPPER(last_name) = UPPER(?)
          AND dob IS NOT NULL AND dob != ''
          AND archived_at IS NULL
        `).all(sw.first_name, sw.last_name) as { id: number; dob: string }[];

        for (const cand of candidates) {
          const candDob = new Date(cand.dob);
          if (isNaN(candDob.getTime())) continue;
          const now = new Date();
          const expectedAge = now.getFullYear() - candDob.getFullYear();
          // Allow ±1 year tolerance for age matching
          if (Math.abs(expectedAge - sw.age) <= 1) {
            person = cand;
            dobVerified = true;
            break;
          }
        }
      }

      // Strategy 3: Name-only match (lowest confidence — no DOB verification)
      if (!person) {
        person = db.prepare(`
          SELECT id, dob FROM persons
          WHERE UPPER(first_name) = UPPER(?) AND UPPER(last_name) = UPPER(?)
          AND archived_at IS NULL
          LIMIT 1
        `).get(sw.first_name, sw.last_name) as { id: number; dob: string | null } | undefined;
      }

      if (person) {
        if (dobVerified) {
          updateWithDob.run(person.id, sw.id);
          linkedDob++;
        } else {
          updateWithoutDob.run(person.id, sw.id);
          linkedName++;
        }
      }
    }

    if (linkedDob > 0 || linkedName > 0) {
      console.log(`[Warrant Scraper] Cross-linked ${linkedDob + linkedName} warrants (${linkedDob} DOB-verified, ${linkedName} name-only)`);
    }
  } catch (err) {
    console.error('[Warrant Scraper] Cross-link error:', (err as Error).message);
  }
}


// ════════════════════════════════════════════════════════════
//  SCRAPE ENGINE
// ════════════════════════════════════════════════════════════

function getSourceConfigs(): WarrantSourceConfig[] {
  const db = getDb();
  return db.prepare('SELECT * FROM warrant_scraper_config ORDER BY source_key').all() as WarrantSourceConfig[];
}

function getSourceConfig(sourceKey: string): WarrantSourceConfig | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM warrant_scraper_config WHERE source_key = ?').get(sourceKey) as WarrantSourceConfig | undefined;
}

/**
 * Scrape warrants from a single source.
 */
async function scrapeSource(sourceKey: string): Promise<{
  records_found: number;
  inserted: number;
  updated: number;
  cleared: number;
  status?: number;
  unchanged?: boolean;
  newHash?: string | null;
  etag?: string | null;
  lastModified?: string | null;
  parserUsed?: 'custom' | 'generic' | 'fallback';
  driftSignal?: string;
}> {
  const config = getSourceConfig(sourceKey);
  if (!config) throw new Error(`Unknown warrant source: ${sourceKey}`);

  // Handle arrest record extraction (special case — no HTTP fetch)
  if (config.source_type === 'arrest_extract') {
    console.log(`[Warrant Scraper] Extracting warrant-related bookings from arrest records...`);
    const entries = extractWarrantsFromArrestRecords();
    const { inserted, updated } = upsertWarrants(sourceKey, entries);
    crossLinkWarrants();

    console.log(`[Warrant Scraper] Arrest extraction: ${entries.length} found, ${inserted} new, ${updated} updated`);
    return { records_found: entries.length, inserted, updated, cleared: 0 };
  }

  // Handle sources with no URL or marked as 'none'
  if (config.source_type === 'none' || !config.source_url) {
    return { records_found: 0, inserted: 0, updated: 0, cleared: 0 };
  }

  // API sources without a dedicated parser (like Utah warrants.utah.gov)
  // are handled by utahWarrantScraper — skip them here.
  // API sources WITH a registered parser (e.g. FBI API) get fetched + parsed normally.
  if (config.source_type === 'api' && !WARRANT_PARSERS[sourceKey]) {
    return { records_found: 0, inserted: 0, updated: 0, cleared: 0 };
  }

  // Get parser (specific or generic fallback)
  const parser = WARRANT_PARSERS[sourceKey] || createGenericWarrantParser(sourceKey);

  // Paginated sources: fetch multiple pages and concatenate results
  // Content hashing / conditional fetch is DISABLED for paginated sources to
  // preserve existing multi-page semantics (each page may have its own etag).
  const paginatedUrls = PAGINATED_SOURCES[sourceKey];
  let entries: WarrantEntry[];

  if (paginatedUrls) {
    entries = [];
    for (const pageUrl of paginatedUrls) {
      try {
        const pageResult = await fetchPage(pageUrl);
        const pageEntries = parser.parseWarrants(pageResult.body);
        entries.push(...pageEntries);
        // Small delay between pages to avoid rate limiting
        await sleep(1500);
      } catch (e: any) {
        // Skip individual page errors, continue with others
        if (e?.message === 'HTTP_PERMANENT_404') continue;
        // Only fail if ALL pages fail
      }
    }

    const { inserted, updated } = upsertWarrants(sourceKey, entries);
    const cleared = detectClearedWarrants(sourceKey, entries.map(e => e.warrant_id));
    crossLinkWarrants();
    return { records_found: entries.length, inserted, updated, cleared };
  }

  // Single page source — use conditional fetch + content hash short-circuit
  const fetchResult = await fetchPage(config.source_url, {
    etag: config.etag ?? null,
    lastModified: config.last_modified ?? null,
  });

  // 304 Not Modified — skip parsing entirely
  if (fetchResult.status === 304) {
    return {
      records_found: 0,
      inserted: 0,
      updated: 0,
      cleared: 0,
      status: 304,
    };
  }

  // Compute body hash and compare to stored content_hash.
  // If unchanged, skip parsing (same records already present).
  const newHash = sha256(fetchResult.body);
  if (config.content_hash && newHash === config.content_hash) {
    return {
      records_found: 0,
      inserted: 0,
      updated: 0,
      cleared: 0,
      status: fetchResult.status,
      unchanged: true,
      newHash,
      etag: fetchResult.etag,
      lastModified: fetchResult.lastModified,
    };
  }

  // Phase 3: detect WAF / block pages BEFORE parsing so failure reasons
  // are classified accurately (dashboard distinguishes "blocked" from "parser broken").
  const blockReason = detectBlockPage(fetchResult.body);
  if (blockReason) {
    throw new Error(`BLOCKED:${blockReason}`);
  }

  // Phase 3: parser fallback cascade (custom → generic → all-caps)
  const parseResult = parseWithFallback(config, fetchResult.body);
  entries = parseResult.entries;
  if (parseResult.driftSignal) {
    console.warn(`[Warrant Scraper] Drift signal for ${sourceKey}: ${parseResult.driftSignal}`);
  }

  const { inserted, updated } = upsertWarrants(sourceKey, entries);
  const cleared = detectClearedWarrants(sourceKey, entries.map(e => e.warrant_id));

  // Cross-link with persons
  crossLinkWarrants();

  return {
    records_found: entries.length,
    inserted,
    updated,
    cleared,
    status: fetchResult.status,
    newHash,
    etag: fetchResult.etag,
    lastModified: fetchResult.lastModified,
    parserUsed: parseResult.parserUsed,
    driftSignal: parseResult.driftSignal,
  };
}


// ════════════════════════════════════════════════════════════
//  SYNC ORCHESTRATOR
// ════════════════════════════════════════════════════════════

async function syncSource(sourceKey: string): Promise<void> {
  const db = getDb();
  const config = getSourceConfig(sourceKey);
  if (!config || !config.enabled || config.circuit_broken) {
    // Record skipped runs for circuit-broken sources so metrics show them
    if (config && config.circuit_broken) {
      try {
        const skipRunId = startRun({ source_key: sourceKey });
        completeRun(skipRunId, { skipped_reason: 'circuit_broken' });
      } catch (e) {
        console.warn(`[Warrant Scraper] Failed to record skip run for ${sourceKey}:`, (e as Error).message);
      }
    }
    return;
  }

  let runId: number | null = null;
  try {
    runId = startRun({ source_key: sourceKey, priority: config.priority });
  } catch (e) {
    console.warn(`[Warrant Scraper] Failed to start run for ${sourceKey}:`, (e as Error).message);
  }

  try {
    console.log(`[Warrant Scraper] ── ${config.display_name} ──`);
    await fetchSemaphore.acquire();
    let result;
    try {
      result = await scrapeSource(sourceKey);
    } finally {
      fetchSemaphore.release();
    }

    // Success — reset error counter
    db.prepare(`
      UPDATE warrant_scraper_config
      SET last_scrape_at = ?, consecutive_errors = 0, circuit_broken = 0
      WHERE source_key = ?
    `).run(localNow(), sourceKey);

    backoffAttempts.delete(sourceKey);

    // Phase 2: persist content_hash / etag / last_modified for conditional requests
    // on next cycle. Only update when scrapeSource returned a new hash (i.e. cache miss
    // where parsing actually ran, OR content_unchanged case where we still want to
    // refresh content_hash_updated_at / etag / last_modified metadata).
    if (result.newHash) {
      try {
        db.prepare(`
          UPDATE warrant_scraper_config
          SET content_hash = ?, content_hash_updated_at = ?, etag = ?, last_modified = ?
          WHERE source_key = ?
        `).run(
          result.newHash,
          localNow(),
          result.etag ?? null,
          result.lastModified ?? null,
          sourceKey,
        );
      } catch (e) {
        console.warn(`[Warrant Scraper] Failed to persist content_hash for ${sourceKey}:`, (e as Error).message);
      }
    }

    if (runId !== null) {
      try {
        // Record skip runs for cache hits (304 or content_unchanged) so metrics
        // reflect the short-circuit.
        if (result.status === 304) {
          completeRun(runId, {
            http_status: 304,
            skipped_reason: 'not_modified',
            parser_used: WARRANT_PARSERS[sourceKey] ? 'custom' : 'generic',
          });
        } else if (result.unchanged) {
          completeRun(runId, {
            http_status: result.status ?? 200,
            skipped_reason: 'content_unchanged',
            parser_used: WARRANT_PARSERS[sourceKey] ? 'custom' : 'generic',
          });
        } else {
          completeRun(runId, {
            http_status: result.status ?? 200,
            // parsed_count is the raw parser output (pre-dedupe). For distinct counts, use inserted_count + updated_count.
            parsed_count: result.records_found,
            inserted_count: result.inserted,
            updated_count: result.updated,
            // Phase 3: actual parser used (custom → generic → fallback cascade)
            parser_used: result.parserUsed ?? (WARRANT_PARSERS[sourceKey] ? 'custom' : 'generic'),
          });
        }
      } catch (e) {
        console.warn(`[Warrant Scraper] Failed to complete run for ${sourceKey}:`, (e as Error).message);
      }
    }

    if (result.status === 304) {
      console.log(`[Warrant Scraper] ${config.display_name}: 304 Not Modified — skipped parse`);
    } else if (result.unchanged) {
      console.log(`[Warrant Scraper] ${config.display_name}: content unchanged (hash match) — skipped parse`);
    } else {
      console.log(`[Warrant Scraper] ${config.display_name}: ${result.records_found} found, ${result.inserted} new, ${result.updated} updated, ${result.cleared} cleared`);
    }

  } catch (err) {
    if (runId !== null) {
      try {
        failRun(runId, { error_message: (err as Error).message });
      } catch (e) {
        console.warn(`[Warrant Scraper] Failed to record failed run for ${sourceKey}:`, (e as Error).message);
      }
    }
    const errMsg = (err as Error).message || 'unknown error';

    // Permanent errors (404 = page gone) — disable source, don't circuit break
    if (errMsg === 'HTTP_PERMANENT_404') {
      console.warn(`[Warrant Scraper] ${config.display_name}: page not found (404) — disabling source`);
      db.prepare('UPDATE warrant_scraper_config SET enabled = 0, last_error = ? WHERE source_key = ?').run('Page not found (404)', sourceKey);
      const interval = sourceIntervals.get(sourceKey);
      if (interval) { clearInterval(interval); sourceIntervals.delete(sourceKey); }
      return;
    }

    // Transient errors — increment counter
    const shortErr = errMsg.replace(/https?:\/\/[^\s]+/g, '...').substring(0, 100);
    console.error(`[Warrant Scraper] ${config.display_name}: ${shortErr}`);

    db.prepare(`
      UPDATE warrant_scraper_config
      SET consecutive_errors = consecutive_errors + 1, last_error = ?
      WHERE source_key = ?
    `).run(shortErr, sourceKey);

    const errResult = db.prepare('SELECT consecutive_errors FROM warrant_scraper_config WHERE source_key = ?').get(sourceKey) as { consecutive_errors: number } | undefined;
    const errorCount = errResult?.consecutive_errors ?? 1;

    if (errorCount >= CIRCUIT_BREAKER_THRESHOLD) {
      console.warn(`[Warrant Scraper] CIRCUIT BREAKER: ${config.display_name} (${errorCount} errors)`);

      db.prepare('UPDATE warrant_scraper_config SET circuit_broken = 1 WHERE source_key = ?').run(sourceKey);

      const interval = sourceIntervals.get(sourceKey);
      if (interval) { clearInterval(interval); sourceIntervals.delete(sourceKey); }

      // Exponential backoff recovery
      const attempt = (backoffAttempts.get(sourceKey) || 0) + 1;
      backoffAttempts.set(sourceKey, attempt);
      const backoffMs = Math.min(BACKOFF_BASE_MS * Math.pow(2, attempt - 1), BACKOFF_MAX_MS);
      const backoffHours = (backoffMs / 3_600_000).toFixed(1);

      console.log(`[Warrant Scraper] Recovery for ${config.display_name} in ${backoffHours}h`);

      const recoveryTimeout = setTimeout(() => {
        db.prepare('UPDATE warrant_scraper_config SET consecutive_errors = 0, circuit_broken = 0 WHERE source_key = ?').run(sourceKey);
        scheduleSource(sourceKey);
      }, backoffMs);

      if (recoveryTimeout.unref) recoveryTimeout.unref();
      backoffTimeouts.set(sourceKey, recoveryTimeout);
    }
  }
}


// ════════════════════════════════════════════════════════════
//  SCHEDULER
// ════════════════════════════════════════════════════════════

function scheduleSource(sourceKey: string): void {
  // Clear existing interval
  const existing = sourceIntervals.get(sourceKey);
  if (existing) {
    clearInterval(existing);
    sourceIntervals.delete(sourceKey);
  }

  const config = getSourceConfig(sourceKey);
  if (!config || !config.enabled || config.circuit_broken) return;

  const intervalMs = resolveInterval(config);
  const jitterMs = resolveJitterMs(sourceKey);

  // Initial scrape delayed by deterministic jitter so boot storm spreads over 20 min
  const initialTimer = setTimeout(() => {
    syncSource(sourceKey).catch(err => {
      console.error(`[Warrant Scraper] Initial scrape error for ${sourceKey}:`, (err as Error).message);
    });
  }, jitterMs);
  if (initialTimer.unref) initialTimer.unref();

  // Schedule recurring
  const interval = setInterval(() => {
    syncSource(sourceKey).catch(err => {
      console.error(`[Warrant Scraper] Scrape error for ${sourceKey}:`, (err as Error).message);
    });
  }, intervalMs);

  if (interval.unref) interval.unref();
  sourceIntervals.set(sourceKey, interval);
}

export function scheduleWarrantScraper(): void {
  console.log('[Warrant Scraper] Multi-state warrant scraper initializing...');

  startupTimeout = setTimeout(async () => {
    const configs = getSourceConfigs();
    const enabled = configs.filter(c => c.enabled);
    const disabled = configs.length - enabled.length;

    console.log(`[Warrant Scraper] ${enabled.length} sources enabled, ${disabled} disabled`);

    for (const config of enabled) {
      if (config.circuit_broken) {
        // Schedule recovery with backoff
        const attempt = (backoffAttempts.get(config.source_key) || 0) + 1;
        backoffAttempts.set(config.source_key, attempt);
        const backoffMs = Math.min(BACKOFF_BASE_MS * Math.pow(2, attempt - 1), BACKOFF_MAX_MS);

        console.log(`[Warrant Scraper] ${config.display_name} circuit-broken — recovery in ${(backoffMs / 3_600_000).toFixed(1)}h`);

        const timeout = setTimeout(() => {
          const db = getDb();
          db.prepare('UPDATE warrant_scraper_config SET consecutive_errors = 0, circuit_broken = 0 WHERE source_key = ?')
            .run(config.source_key);
          scheduleSource(config.source_key);
        }, backoffMs);

        if (timeout.unref) timeout.unref();
        backoffTimeouts.set(config.source_key, timeout);
      } else {
        scheduleSource(config.source_key);
      }

      // Stagger starts to avoid burst
      await sleep(3000);
    }
  }, STARTUP_DELAY_MS);

  if (startupTimeout.unref) startupTimeout.unref();
}

export function stopWarrantScraper(): void {
  if (startupTimeout) {
    clearTimeout(startupTimeout);
    startupTimeout = null;
  }
  for (const [, interval] of sourceIntervals) clearInterval(interval);
  sourceIntervals.clear();
  for (const [, timeout] of backoffTimeouts) clearTimeout(timeout);
  backoffTimeouts.clear();
  backoffAttempts.clear();
}


// ════════════════════════════════════════════════════════════
//  PUBLIC API — For routes
// ════════════════════════════════════════════════════════════

/**
 * Search scraped warrants by name.
 */
export function searchScrapedWarrants(query: string, options?: {
  state?: string;
  status?: string;
  limit?: number;
  offset?: number;
}): { data: any[]; total: number } {
  const db = getDb();
  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;

  const parts = query.trim().split(/[\s,]+/).filter(Boolean);
  if (parts.length === 0) return { data: [], total: 0 };

  let where = 'WHERE 1=1';
  const params: any[] = [];

  if (parts.length >= 2) {
    where += ' AND ((UPPER(sw.first_name) LIKE UPPER(?) AND UPPER(sw.last_name) LIKE UPPER(?)) OR (UPPER(sw.first_name) LIKE UPPER(?) AND UPPER(sw.last_name) LIKE UPPER(?)))';
    params.push(`%${parts[0]}%`, `%${parts[1]}%`, `%${parts[1]}%`, `%${parts[0]}%`);
  } else {
    where += ' AND (UPPER(sw.first_name) LIKE UPPER(?) OR UPPER(sw.last_name) LIKE UPPER(?) OR UPPER(sw.full_name) LIKE UPPER(?))';
    params.push(`%${parts[0]}%`, `%${parts[0]}%`, `%${parts[0]}%`);
  }

  if (options?.state) {
    where += ' AND sw.state = ?';
    params.push(options.state);
  }
  if (options?.status) {
    where += ' AND sw.status = ?';
    params.push(options.status);
  }

  // COUNT query uses the same table alias for consistency with the WHERE clause
  const total = (db.prepare(`SELECT COUNT(*) as count FROM scraped_warrants sw ${where}`).get(...params) as any).count;
  const data = db.prepare(`
    SELECT sw.*, wsc.display_name as source_display_name
    FROM scraped_warrants sw
    LEFT JOIN warrant_scraper_config wsc ON sw.source_key = wsc.source_key
    ${where}
    ORDER BY sw.last_seen_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  return { data, total };
}

/**
 * Get all active warrants (for dashboard/alerts).
 */
export function getActiveScrapedWarrants(options?: {
  state?: string;
  limit?: number;
}): any[] {
  const db = getDb();
  const limit = options?.limit ?? 200;

  let where = "WHERE sw.status = 'active'";
  const params: any[] = [];

  if (options?.state) {
    where += ' AND sw.state = ?';
    params.push(options.state);
  }

  return db.prepare(`
    SELECT sw.*, wsc.display_name as source_display_name
    FROM scraped_warrants sw
    LEFT JOIN warrant_scraper_config wsc ON sw.source_key = wsc.source_key
    ${where}
    ORDER BY sw.last_seen_at DESC
    LIMIT ?
  `).all(...params, limit);
}

/**
 * Get warrant scraper status for all sources.
 */
export function getWarrantScraperStatus(): any[] {
  const db = getDb();

  const configs = db.prepare('SELECT * FROM warrant_scraper_config ORDER BY state, source_key').all() as WarrantSourceConfig[];

  return configs.map(c => {
    const activeCount = (db.prepare(
      "SELECT COUNT(*) as count FROM scraped_warrants WHERE source_key = ? AND status = 'active'"
    ).get(c.source_key) as any)?.count ?? 0;

    const totalCount = (db.prepare(
      'SELECT COUNT(*) as count FROM scraped_warrants WHERE source_key = ?'
    ).get(c.source_key) as any)?.count ?? 0;

    return {
      ...c,
      active_warrants: activeCount,
      total_warrants: totalCount,
      auto_recovering: backoffTimeouts.has(c.source_key),
      backoff_attempt: backoffAttempts.get(c.source_key) || 0,
    };
  });
}

/**
 * Get warrant stats summary across all sources.
 */
export function getWarrantScraperStats(): {
  total_active: number;
  total_cleared: number;
  total_sources: number;
  enabled_sources: number;
  by_state: Record<string, number>;
  by_type: Record<string, number>;
} {
  const db = getDb();

  const active = (db.prepare("SELECT COUNT(*) as c FROM scraped_warrants WHERE status = 'active'").get() as any).c;
  const cleared = (db.prepare("SELECT COUNT(*) as c FROM scraped_warrants WHERE status = 'cleared'").get() as any).c;
  const totalSources = (db.prepare('SELECT COUNT(*) as c FROM warrant_scraper_config').get() as any).c;
  const enabledSources = (db.prepare('SELECT COUNT(*) as c FROM warrant_scraper_config WHERE enabled = 1').get() as any).c;

  const byState: Record<string, number> = {};
  const stateRows = db.prepare("SELECT state, COUNT(*) as c FROM scraped_warrants WHERE status = 'active' GROUP BY state").all() as { state: string; c: number }[];
  for (const row of stateRows) byState[row.state] = row.c;

  const byType: Record<string, number> = {};
  const typeRows = db.prepare("SELECT warrant_type, COUNT(*) as c FROM scraped_warrants WHERE status = 'active' GROUP BY warrant_type").all() as { warrant_type: string; c: number }[];
  for (const row of typeRows) byType[row.warrant_type] = row.c;

  return { total_active: active, total_cleared: cleared, total_sources: totalSources, enabled_sources: enabledSources, by_state: byState, by_type: byType };
}

/**
 * Manually trigger a scrape for a specific source.
 */
export async function manualScrapeSource(sourceKey: string): Promise<any> {
  return scrapeSource(sourceKey);
}

/**
 * Reset errors and re-enable a warrant source.
 */
export function resetWarrantSourceErrors(sourceKey: string): void {
  const db = getDb();
  db.prepare('UPDATE warrant_scraper_config SET consecutive_errors = 0, circuit_broken = 0 WHERE source_key = ?').run(sourceKey);

  // Clear backoff state
  const timeout = backoffTimeouts.get(sourceKey);
  if (timeout) {
    clearTimeout(timeout);
    backoffTimeouts.delete(sourceKey);
  }
  backoffAttempts.delete(sourceKey);

  // Restart scheduler
  scheduleSource(sourceKey);
}

/**
 * Enable/disable a warrant source.
 */
export function setWarrantSourceEnabled(sourceKey: string, enabled: boolean): void {
  const db = getDb();
  db.prepare('UPDATE warrant_scraper_config SET enabled = ? WHERE source_key = ?').run(enabled ? 1 : 0, sourceKey);

  if (enabled) {
    scheduleSource(sourceKey);
  } else {
    const interval = sourceIntervals.get(sourceKey);
    if (interval) {
      clearInterval(interval);
      sourceIntervals.delete(sourceKey);
    }
  }
}

/**
 * Check if a specific person has active scraped warrants.
 */
export function checkPersonWarrants(personId: number): any[] {
  const db = getDb();
  return db.prepare(`
    SELECT sw.*, wsc.display_name as source_display_name
    FROM scraped_warrants sw
    LEFT JOIN warrant_scraper_config wsc ON sw.source_key = wsc.source_key
    WHERE sw.person_id = ? AND sw.status = 'active'
    ORDER BY sw.last_seen_at DESC
  `).all(personId);
}

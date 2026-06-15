# Overwatch Deep Research Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real Firecrawl-powered async deep-research pipeline to the Overwatch (CRM) module that fans out a subject into research angles, searches+scrapes the web, extracts structured findings, adversarially verifies them, and synthesizes a cited report — with findings linkable to records and re-runnable as scheduled monitors.

**Architecture:** A Worker route (`/api/deep-research`) creates a D1 job row and hands it to a `DeepResearchDO` Durable Object whose `alarm()` runs one pipeline stage per tick (resumable, rate-limited, survives multi-minute runs). Pure logic (Firecrawl parsing, LLM-output parsing, trust derivation) lives in unit-tested util modules; the DO orchestrates them. The client polls job status and renders sources, trust-scored findings, and the report in a new Overwatch tab.

**Tech Stack:** Cloudflare Workers + Hono, D1, Durable Objects (`new_sqlite_classes`), Workers AI + Anthropic Claude (existing ladder), Firecrawl v1 REST, React 18 + Vite + Tailwind, vitest.

Spec: `docs/superpowers/specs/2026-06-15-overwatch-deep-research-design.md`

---

## File Structure

**Worker (create):**
- `migrations/0122_deep_research.sql` — 4 new tables
- `src/utils/firecrawl.ts` — Worker-safe Firecrawl v1 REST client + pure parsers
- `src/utils/researchEngine.ts` — LLM ladder + pure output parsers + trust derivation
- `src/utils/researchPrompts.ts` — pure prompt builders
- `src/durable-objects/DeepResearchDO.ts` — alarm-driven stage machine
- `src/routes/deepResearch.ts` — REST surface
- `tests/firecrawl.test.ts`, `tests/researchEngine.test.ts`, `tests/researchPrompts.test.ts`

**Worker (modify):**
- `src/types.ts` — add `FIRECRAWL_API_KEY?` + `DEEP_RESEARCH` to `Bindings`
- `src/index.ts` — export `DeepResearchDO`
- `src/routesConfig.ts` — mount `/api/deep-research`
- `wrangler.toml` — DO binding + `[[migrations]]` tag

**Client (create):**
- `client/src/components/crm/DeepResearchTab.tsx`

**Client (modify):**
- `client/src/pages/CrmPage.tsx` — register the `deepresearch` section
- `client/public/sw.js` — bump `CACHE_NAME`

---

## Task 1: D1 migration (schema)

**Files:**
- Create: `migrations/0122_deep_research.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 0122_deep_research.sql — Overwatch Deep Research: jobs, sources, findings, runs.
-- All new tables (well under D1's 100-column cap). Idempotent.

CREATE TABLE IF NOT EXISTS deep_research_jobs (
  id TEXT PRIMARY KEY,
  org_id INTEGER,
  created_by INTEGER,
  subject TEXT NOT NULL,
  subject_type TEXT NOT NULL DEFAULT 'topic',
  context TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  stage_detail TEXT,
  progress INTEGER NOT NULL DEFAULT 0,
  angles_json TEXT,
  report_md TEXT,
  error TEXT,
  source_count INTEGER NOT NULL DEFAULT 0,
  finding_count INTEGER NOT NULL DEFAULT 0,
  linked_entity_type TEXT,
  linked_entity_id INTEGER,
  monitor_interval_days INTEGER,
  next_run_at TEXT,
  last_run_at TEXT,
  run_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_drj_org ON deep_research_jobs(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_drj_monitor ON deep_research_jobs(monitor_interval_days, next_run_at);

CREATE TABLE IF NOT EXISTS research_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  run_no INTEGER NOT NULL DEFAULT 1,
  url TEXT NOT NULL,
  title TEXT,
  description TEXT,
  angle TEXT,
  scraped INTEGER NOT NULL DEFAULT 0,
  markdown_excerpt TEXT,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rsrc_job ON research_sources(job_id, run_no);

CREATE TABLE IF NOT EXISTS research_findings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  run_no INTEGER NOT NULL DEFAULT 1,
  org_id INTEGER,
  finding_type TEXT NOT NULL DEFAULT 'fact',
  title TEXT NOT NULL,
  detail TEXT,
  confidence REAL NOT NULL DEFAULT 0,
  trust REAL NOT NULL DEFAULT 0,
  verdict TEXT NOT NULL DEFAULT 'uncertain',
  source_urls_json TEXT,
  status TEXT NOT NULL DEFAULT 'proposed',
  entity_ref_type TEXT,
  entity_ref_id INTEGER,
  is_delta INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rfind_job ON research_findings(job_id, run_no);

CREATE TABLE IF NOT EXISTS research_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  run_no INTEGER NOT NULL,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  new_findings INTEGER NOT NULL DEFAULT 0,
  changed_findings INTEGER NOT NULL DEFAULT 0,
  source_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_rrun_job ON research_runs(job_id, run_no);
```

- [ ] **Step 2: Apply locally and verify**

Run: `npm run migrate:local`
Expected: applies without error.

Run: `npx wrangler d1 execute rmpg-flex --local --command "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'research_%' OR name='deep_research_jobs';"`
Expected: lists `deep_research_jobs`, `research_sources`, `research_findings`, `research_runs`.

- [ ] **Step 3: Commit**

```bash
git add migrations/0122_deep_research.sql
git commit -m "feat(deep-research): D1 schema for jobs/sources/findings/runs"
```

---

## Task 2: Bindings (types only)

**Files:**
- Modify: `src/types.ts` (in the `Bindings` type, near `MAPBOX_ACCESS_TOKEN`)

- [ ] **Step 1: Add the two bindings**

In `src/types.ts`, inside `export type Bindings = { ... }`, add after the `MAPBOX_ACCESS_TOKEN?: string;` line:

```typescript
  // Firecrawl API key (secret, optional). When set, /api/deep-research runs
  // real web search+scrape; unset → the route returns 503. Set via
  // `wrangler secret put FIRECRAWL_API_KEY` (local dev: .dev.vars).
  FIRECRAWL_API_KEY?: string;
```

And after the `WELFARE_WATCH: DurableObjectNamespace;` line, add:

```typescript
  // DeepResearchDO namespace — one instance per research job; alarm-driven
  // pipeline (expand → search → extract → verify → synthesize) + scheduled
  // monitors. See src/durable-objects/DeepResearchDO.ts.
  DEEP_RESEARCH: DurableObjectNamespace;
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS (adding optional/typed fields breaks nothing yet).

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat(deep-research): add FIRECRAWL_API_KEY + DEEP_RESEARCH bindings"
```

---

## Task 3: Firecrawl client

**Files:**
- Create: `src/utils/firecrawl.ts`
- Test: `tests/firecrawl.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/firecrawl.test.ts
import { describe, it, expect } from 'vitest';
import { parseSearchResponse, parseScrapeResponse } from '../src/utils/firecrawl';

describe('parseSearchResponse', () => {
  it('maps v1 data items and keeps inline markdown', () => {
    const json = { success: true, data: [
      { url: 'https://a.com', title: 'A', description: 'da', markdown: '# A' },
      { url: 'https://b.com', title: 'B', description: 'db' },
    ] };
    const out = parseSearchResponse(json);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ url: 'https://a.com', title: 'A', description: 'da', markdown: '# A' });
    expect(out[1].markdown).toBeUndefined();
  });
  it('drops malformed items and tolerates missing data', () => {
    expect(parseSearchResponse({})).toEqual([]);
    expect(parseSearchResponse({ data: [{ title: 'no url' }, null, 5] })).toEqual([]);
  });
});

describe('parseScrapeResponse', () => {
  it('pulls data.markdown, empty string otherwise', () => {
    expect(parseScrapeResponse({ data: { markdown: 'hi' } })).toBe('hi');
    expect(parseScrapeResponse({ data: {} })).toBe('');
    expect(parseScrapeResponse(null)).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/firecrawl.test.ts`
Expected: FAIL — cannot find module `../src/utils/firecrawl`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/utils/firecrawl.ts
// Worker-safe Firecrawl v1 REST client (no `firecrawl` npm SDK — it pulls
// node:* deps that break on Workers, same constraint as roboflowAlpr.ts).
// Verified live 2026-06-15: POST /v1/search → { success, data:[{url,title,
// description,markdown?}], id }. With scrapeOptions, markdown is inline.

const FIRECRAWL_BASE = 'https://api.firecrawl.dev/v1';

export class FirecrawlConfigError extends Error {
  constructor(msg = 'FIRECRAWL_API_KEY not set') { super(msg); this.name = 'FirecrawlConfigError'; }
}
export class FirecrawlTimeoutError extends Error {
  constructor(msg: string) { super(msg); this.name = 'FirecrawlTimeoutError'; }
}
export class FirecrawlHttpError extends Error {
  constructor(public status: number, msg: string) { super(msg); this.name = 'FirecrawlHttpError'; }
}

export interface FirecrawlEnv { FIRECRAWL_API_KEY?: string; }
export interface FcSearchResult { url: string; title: string; description: string; markdown?: string; }

/** Pure: map a v1 /search envelope to typed results, dropping malformed rows. */
export function parseSearchResponse(json: any): FcSearchResult[] {
  const data = Array.isArray(json?.data) ? json.data : [];
  return data
    .filter((d: any) => d && typeof d.url === 'string')
    .map((d: any) => {
      const r: FcSearchResult = {
        url: d.url,
        title: typeof d.title === 'string' ? d.title : '',
        description: typeof d.description === 'string' ? d.description : '',
      };
      if (typeof d.markdown === 'string') r.markdown = d.markdown;
      return r;
    });
}

/** Pure: pull markdown out of a v1 /scrape envelope. */
export function parseScrapeResponse(json: any): string {
  const md = json?.data?.markdown;
  return typeof md === 'string' ? md : '';
}

function apiKey(env: FirecrawlEnv): string {
  const k = (env.FIRECRAWL_API_KEY || '').trim();
  if (!k) throw new FirecrawlConfigError();
  return k;
}

async function fcFetch(env: FirecrawlEnv, path: string, body: unknown, timeoutMs: number): Promise<any> {
  const key = apiKey(env);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${FIRECRAWL_BASE}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new FirecrawlHttpError(res.status, txt.slice(0, 200));
    }
    return await res.json();
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new FirecrawlTimeoutError(`Firecrawl timeout after ${timeoutMs}ms`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function withRetry<T>(fn: () => Promise<T>, retries = 2, backoffMs = 800): Promise<T> {
  let last: unknown;
  for (let i = 0; i <= retries; i++) {
    try { return await fn(); }
    catch (e) {
      last = e;
      // Don't retry config errors or 4xx (client) HTTP errors.
      if (e instanceof FirecrawlConfigError) throw e;
      if (e instanceof FirecrawlHttpError && e.status < 500) throw e;
      if (i < retries) await new Promise((r) => setTimeout(r, backoffMs * (i + 1)));
    }
  }
  throw last;
}

export async function firecrawlSearch(
  env: FirecrawlEnv,
  query: string,
  opts: { limit?: number; scrape?: boolean; timeoutMs?: number } = {},
): Promise<FcSearchResult[]> {
  const { limit = 5, scrape = true, timeoutMs = 30000 } = opts;
  const body: any = { query, limit };
  if (scrape) body.scrapeOptions = { formats: ['markdown'] };
  const json = await withRetry(() => fcFetch(env, '/search', body, timeoutMs));
  return parseSearchResponse(json);
}

export async function firecrawlScrape(
  env: FirecrawlEnv,
  url: string,
  opts: { timeoutMs?: number } = {},
): Promise<string> {
  const { timeoutMs = 30000 } = opts;
  const json = await withRetry(() => fcFetch(env, '/scrape', { url, formats: ['markdown'] }, timeoutMs));
  return parseScrapeResponse(json);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/firecrawl.test.ts`
Expected: PASS (5 assertions).

- [ ] **Step 5: Commit**

```bash
git add src/utils/firecrawl.ts tests/firecrawl.test.ts
git commit -m "feat(deep-research): Worker-safe Firecrawl v1 client + parsers"
```

---

## Task 4: Research engine (LLM ladder + parsers + trust)

**Files:**
- Create: `src/utils/researchEngine.ts`
- Test: `tests/researchEngine.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/researchEngine.test.ts
import { describe, it, expect } from 'vitest';
import {
  parseJsonLoose, parseAngles, parseFindings, parseVerdict,
  deriveTrust, numberCitations, mergeAngles,
} from '../src/utils/researchEngine';

describe('parseJsonLoose', () => {
  it('parses fenced json (the open_ai@v4 fence bug)', () => {
    expect(parseJsonLoose('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
  it('parses leading-prose json and returns null on garbage', () => {
    expect(parseJsonLoose('Here: [1,2]')).toEqual([1, 2]);
    expect(parseJsonLoose('not json')).toBeNull();
  });
});

describe('parseAngles', () => {
  it('reads {angles:[...]}, dedupes case-insensitively, caps', () => {
    const out = parseAngles('{"angles":["Criminal","criminal","Business","News","X","Y","Z"]}', 6);
    expect(out).toEqual(['Criminal', 'Business', 'News', 'X', 'Y', 'Z']);
  });
  it('falls back to bullet lines', () => {
    expect(parseAngles('- one\n- two')).toEqual(['one', 'two']);
  });
});

describe('mergeAngles', () => {
  it('puts seed angles first, dedupes, caps', () => {
    expect(mergeAngles(['Seed'], ['seed', 'Other'], 6)).toEqual(['Seed', 'Other']);
  });
});

describe('parseFindings', () => {
  it('normalizes type, clamps confidence, filters bad urls', () => {
    const out = parseFindings('{"findings":[{"finding_type":"bogus","title":"T","detail":"D","confidence":2,"source_urls":["https://a",5]}]}');
    expect(out[0].finding_type).toBe('fact');
    expect(out[0].confidence).toBe(1);
    expect(out[0].source_urls).toEqual(['https://a']);
  });
});

describe('parseVerdict', () => {
  it('classifies', () => {
    expect(parseVerdict('{"verdict":"refuted"}')).toBe('refuted');
    expect(parseVerdict('SUPPORTED by source 1')).toBe('supported');
    expect(parseVerdict('hmm not sure')).toBe('uncertain');
  });
});

describe('deriveTrust', () => {
  it('refuted floors near zero', () => {
    expect(deriveTrust({ confidence: 0.99, sourceCount: 5, verdict: 'refuted' })).toBeLessThan(0.1);
  });
  it('single source caps at 0.85 even at confidence 1', () => {
    expect(deriveTrust({ confidence: 1, sourceCount: 1, verdict: 'supported' })).toBeCloseTo(0.85, 2);
  });
  it('consensus raises, uncertain halves-ish', () => {
    expect(deriveTrust({ confidence: 0.8, sourceCount: 3, verdict: 'supported' })).toBeGreaterThan(0.8);
    expect(deriveTrust({ confidence: 0.8, sourceCount: 1, verdict: 'uncertain' })).toBeLessThan(0.6);
  });
});

describe('numberCitations', () => {
  it('assigns [n] per unique url in order', () => {
    const m = numberCitations(['u1', 'u2', 'u1', 'u3']);
    expect(m.get('u1')).toBe(1);
    expect(m.get('u2')).toBe(2);
    expect(m.get('u3')).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/researchEngine.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the implementation**

```typescript
// src/utils/researchEngine.ts
// LLM engine ladder (Claude → Workers AI free) + PURE parsers and the derived
// trust model. Trust is DERIVED (consensus + verification), never the model's
// raw self-reported confidence — mirrors captureTrust()/OCR-trust.
import { getAnthropicKey, getClaudeModel, callClaude } from './anthropic';

export interface ResearchEnv { DB: D1Database; AI: Ai; }
const WORKERS_AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

export interface LlmOpts { system?: string; user: string; maxTokens?: number; }

/** Claude if a system_config key exists, else free Workers AI. Never throws on
 *  engine failure of the primary — falls through to Workers AI. */
export async function runResearchLLM(env: ResearchEnv, opts: LlmOpts): Promise<string> {
  const { system, user, maxTokens = 2048 } = opts;
  const key = await getAnthropicKey(env);
  if (key) {
    try {
      const model = await getClaudeModel(env);
      const text = await callClaude(key, { system, text: user, maxTokens, model });
      if (text && text.trim()) return text;
    } catch { /* fall through to Workers AI */ }
  }
  const messages: { role: string; content: string }[] = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: user });
  const r: any = await env.AI.run(WORKERS_AI_MODEL as any, { messages, max_tokens: maxTokens } as any);
  return typeof r?.response === 'string' ? r.response : '';
}

function clamp01(n: number): number { return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0; }

/** Pure: tolerant JSON parse — strips markdown fences + leading prose. */
export function parseJsonLoose<T = any>(text: string): T | null {
  if (!text) return null;
  let s = String(text).trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.search(/[[{]/);
  if (start > 0) s = s.slice(start);
  try { return JSON.parse(s) as T; } catch { return null; }
}

/** Pure: parse 3-6 angle strings from an LLM reply. */
export function parseAngles(text: string, max = 6): string[] {
  const j = parseJsonLoose<any>(text);
  let arr: any[] = [];
  if (Array.isArray(j)) arr = j;
  else if (j && Array.isArray(j.angles)) arr = j.angles;
  else arr = String(text).split('\n').map((l) => l.replace(/^[-*\d.\s]+/, '').trim());
  return dedupeCap(arr.map((x) => String(x).trim()).filter(Boolean), max);
}

/** Pure: seed angles first, then expanded; dedupe case-insensitively, cap. */
export function mergeAngles(seed: string[], expanded: string[], max = 6): string[] {
  return dedupeCap([...seed, ...expanded].map((x) => String(x).trim()).filter(Boolean), max);
}

function dedupeCap(items: string[], max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of items) {
    const k = it.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(it);
    if (out.length >= max) break;
  }
  return out;
}

export const FINDING_TYPES = ['entity', 'risk_flag', 'fact', 'relationship', 'contact', 'asset', 'timeline'] as const;
export type FindingType = typeof FINDING_TYPES[number];
export interface RawFinding { finding_type: FindingType; title: string; detail: string; confidence: number; source_urls: string[]; }

/** Pure: parse structured findings, normalizing type + clamping confidence. */
export function parseFindings(text: string): RawFinding[] {
  const j = parseJsonLoose<any>(text);
  const arr = Array.isArray(j) ? j : Array.isArray(j?.findings) ? j.findings : [];
  return arr
    .filter((f: any) => f && typeof f.title === 'string')
    .map((f: any) => ({
      finding_type: (FINDING_TYPES as readonly string[]).includes(f.finding_type) ? f.finding_type : 'fact',
      title: String(f.title).slice(0, 300),
      detail: typeof f.detail === 'string' ? f.detail : '',
      confidence: clamp01(Number(f.confidence)),
      source_urls: Array.isArray(f.source_urls) ? f.source_urls.filter((u: any) => typeof u === 'string') : [],
    }));
}

export type Verdict = 'supported' | 'uncertain' | 'refuted';

/** Pure: classify a verification reply. */
export function parseVerdict(text: string): Verdict {
  const j = parseJsonLoose<any>(text);
  const v = String(j?.verdict ?? text).toLowerCase();
  if (v.includes('refut')) return 'refuted';
  if (v.includes('support')) return 'supported';
  return 'uncertain';
}

/** Pure: DERIVED trust. Single-source claims cap at 0.85; each extra
 *  corroborating source adds (diminishing, max +0.15); uncertain ×0.6;
 *  refuted floored. */
export function deriveTrust(opts: { confidence: number; sourceCount: number; verdict: Verdict }): number {
  const { confidence, sourceCount, verdict } = opts;
  if (verdict === 'refuted') return 0.05;
  const base = Math.min(clamp01(confidence), 0.85);
  const consensus = Math.min(0.15, Math.max(0, sourceCount - 1) * 0.07);
  let t = base + consensus;
  if (verdict === 'uncertain') t *= 0.6;
  return Math.max(0.05, Math.min(1, t));
}

/** Pure: [n] per unique url in first-seen order. */
export function numberCitations(urls: string[]): Map<string, number> {
  const m = new Map<string, number>();
  let n = 1;
  for (const u of urls) if (!m.has(u)) m.set(u, n++);
  return m;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/researchEngine.test.ts`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add src/utils/researchEngine.ts tests/researchEngine.test.ts
git commit -m "feat(deep-research): LLM ladder + output parsers + derived trust"
```

---

## Task 5: Prompt builders

**Files:**
- Create: `src/utils/researchPrompts.ts`
- Test: `tests/researchPrompts.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/researchPrompts.test.ts
import { describe, it, expect } from 'vitest';
import { anglePrompt, extractPrompt, verifyPrompt, synthesisPrompt } from '../src/utils/researchPrompts';

describe('anglePrompt', () => {
  it('includes subject, type, and type-specific guidance', () => {
    const { system, user } = anglePrompt('Jane Doe', 'person', 'tip line');
    expect(system).toMatch(/angles/i);
    expect(user).toContain('Jane Doe');
    expect(user).toContain('person');
    expect(user).toContain('tip line');
    expect(user).toMatch(/criminal/i);
  });
  it('falls back to topic guidance for unknown type', () => {
    expect(anglePrompt('X', 'weird').user).toMatch(/overview/i);
  });
});

describe('extractPrompt', () => {
  it('embeds the subject and numbered sources, truncating long markdown', () => {
    const { user } = extractPrompt('ACME', [{ url: 'https://a', markdown: 'x'.repeat(9000) }]);
    expect(user).toContain('ACME');
    expect(user).toContain('https://a');
    expect(user.length).toBeLessThan(6000); // 4000-char cap applied
  });
});

describe('verifyPrompt', () => {
  it('includes the claim and evidence', () => {
    const { user } = verifyPrompt({ title: 'T', detail: 'D' }, [{ url: 'https://a', markdown: 'ev' }]);
    expect(user).toContain('T');
    expect(user).toContain('ev');
  });
});

describe('synthesisPrompt', () => {
  it('lists findings with trust and numbered sources', () => {
    const { user } = synthesisPrompt('ACME',
      [{ title: 'F', detail: 'd', trust: 0.9, citations: [1] }],
      [{ n: 1, url: 'https://a', title: 'A' }]);
    expect(user).toContain('ACME');
    expect(user).toContain('[1]');
    expect(user).toContain('https://a');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/researchPrompts.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the implementation**

```typescript
// src/utils/researchPrompts.ts
// Pure prompt builders for each pipeline stage. Kept separate so prompts can be
// tuned without touching orchestration. ANGLE_GUIDE is the operator-tunable knob.

export interface Prompt { system?: string; user: string; }

export const ANGLE_GUIDE: Record<string, string> = {
  person: 'identity & aliases; criminal/legal history; business & employment; social & online presence; news mentions; known associates',
  business: 'ownership & registration; licensing & violations; litigation; reputation & reviews; key people; news & filings',
  address: 'ownership & property records; occupants; incident history; nearby risks; permits & violations',
  vehicle: 'registration & title; sightings; associated persons; theft/lien status',
  lead: 'company profile; decision-makers; budget & buying signals; incumbent vendors; recent news',
  competitor: 'services & pricing; clients & contracts; staffing; reputation; recent news',
  topic: 'overview; key facts; risks & criticism; primary sources',
};

export function anglePrompt(subject: string, subjectType: string, context?: string): Prompt {
  const system = 'You are an investigative research planner for a law-enforcement records system. '
    + 'Given a subject, produce 3-6 DISTINCT research angles that together give broad coverage. '
    + 'Return JSON only: {"angles":["...","..."]}. No prose.';
  const hint = ANGLE_GUIDE[subjectType] || ANGLE_GUIDE.topic;
  const user = `Subject: ${subject}\nType: ${subjectType}\n`
    + (context ? `Context: ${context}\n` : '')
    + `Dimensions to consider: ${hint}.`;
  return { system, user };
}

export function extractPrompt(subject: string, sources: { url: string; markdown: string }[]): Prompt {
  const system = 'You extract structured findings from web sources for an investigative dossier. '
    + 'Return JSON only: {"findings":[{"finding_type":"entity|risk_flag|fact|relationship|contact|asset|timeline",'
    + '"title":"short","detail":"one or two sentences","confidence":0.0-1.0,"source_urls":["urls that support this"]}]}. '
    + 'Only include findings grounded in the provided sources. No prose.';
  const body = sources
    .map((s, i) => `--- SOURCE ${i + 1}: ${s.url} ---\n${(s.markdown || '').slice(0, 4000)}`)
    .join('\n\n');
  const user = `Subject of research: ${subject}\n\nSources:\n${body}`;
  return { system, user };
}

export function verifyPrompt(finding: { title: string; detail: string }, sources: { url: string; markdown: string }[]): Prompt {
  const system = 'You are a skeptical fact-checker. Decide whether the claim is supported by the evidence. '
    + 'Default to "uncertain" when evidence is thin and "refuted" when it contradicts. '
    + 'Return JSON only: {"verdict":"supported|uncertain|refuted","reason":"..."}.';
  const body = sources
    .map((s, i) => `--- SOURCE ${i + 1}: ${s.url} ---\n${(s.markdown || '').slice(0, 3000)}`)
    .join('\n\n');
  const user = `Claim: ${finding.title} — ${finding.detail}\n\nEvidence:\n${body}`;
  return { system, user };
}

export function synthesisPrompt(
  subject: string,
  findings: { title: string; detail: string; trust: number; citations: number[] }[],
  sources: { n: number; url: string; title: string }[],
): Prompt {
  const system = 'You write a concise investigative research report in Markdown using ONLY the verified '
    + 'findings provided. Cite sources inline as [n]. Note where trust is low. End with a "## Sources" '
    + 'list mapping each [n] to its URL. Do not invent facts.';
  const fb = findings
    .map((f) => `- (${Math.round(f.trust * 100)}% trust) ${f.title}: ${f.detail} ${f.citations.map((c) => `[${c}]`).join('')}`)
    .join('\n');
  const sb = sources.map((s) => `[${s.n}] ${s.title} — ${s.url}`).join('\n');
  const user = `Subject: ${subject}\n\nVerified findings:\n${fb}\n\nSources:\n${sb}`;
  return { system, user };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/researchPrompts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/researchPrompts.ts tests/researchPrompts.test.ts
git commit -m "feat(deep-research): pure prompt builders for each stage"
```

> **[Optional — Christopher]** `ANGLE_GUIDE` in `researchPrompts.ts` and the trust weights in `deriveTrust` (Task 4) are the two domain knobs. If you have a preferred set of investigative angles per subject type, or a stricter trust curve, tune those constants — the rest of the pipeline is agnostic to them.

---

## Task 6: DeepResearchDO (alarm stage machine)

**Files:**
- Create: `src/durable-objects/DeepResearchDO.ts`
- Modify: `src/index.ts` (export), `wrangler.toml` (binding + migration tag)

There is no Worker integration-test harness in this repo (CLAUDE.md: "typecheck only"), and the pure logic the DO calls is already unit-tested in Tasks 3–5. The DO is verified by `npm run typecheck` + the live smoke in Task 10.

- [ ] **Step 1: Write the DO**

```typescript
// src/durable-objects/DeepResearchDO.ts
// One instance per research job. alarm() runs ONE pipeline stage per tick so a
// multi-minute run never blows a single request's CPU/subrequest budget and is
// resumable. The same alarm reschedules scheduled monitors. SQLite-backed
// (new_sqlite_classes) — free-plan compatible, like WelfareWatchDO.
// A DO constructor receives the RAW bindings object — that is the `Bindings`
// type. `Env` in this codebase is the Hono context wrapper ({ Bindings,
// Variables }) used by routes, NOT what a DO gets.
import type { Bindings } from '../types';
import { execute } from '../utils/db';
import { firecrawlSearch, firecrawlScrape, FirecrawlConfigError } from '../utils/firecrawl';
import {
  runResearchLLM, parseAngles, mergeAngles, parseFindings, parseVerdict,
  deriveTrust, numberCitations, type Verdict, type RawFinding,
} from '../utils/researchEngine';
import { anglePrompt, extractPrompt, verifyPrompt, synthesisPrompt } from '../utils/researchPrompts';

const MAX_ANGLES = 6;
const MAX_SOURCES_PER_ANGLE = 5;
const MAX_TOTAL_SOURCES = 25;
const EXTRACT_BATCH = 5;
const VERIFY_CONFIDENCE_FLOOR = 0.5;
const VERIFY_TYPES = new Set(['risk_flag', 'entity', 'relationship']);
const STAGE_GAP_MS = 500;

type Stage = 'expand' | 'search' | 'extract' | 'verify' | 'synthesize' | 'done';
interface SourceRec { url: string; title: string; description: string; markdown: string; angle: string }
interface FindingRec extends RawFinding { verdict: Verdict; trust: number; status: 'proposed' | 'dismissed' }
interface JobMeta {
  jobId: string; orgId: number | null; subject: string; subjectType: string;
  context: string; seedAngles: string[]; monitorIntervalDays: number | null; runNo: number;
}
interface DOState { meta: JobMeta; stage: Stage; angles: string[]; sources: SourceRec[]; findings: FindingRec[] }

function nowIso(): string { return new Date().toISOString(); }

export class DeepResearchDO {
  state: DurableObjectState;
  env: Bindings;
  constructor(state: DurableObjectState, env: Bindings) { this.state = state; this.env = env; }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/start')) {
      const meta = (await request.json()) as JobMeta;
      const init: DOState = { meta, stage: 'expand', angles: [], sources: [], findings: [] };
      await this.state.storage.put('s', init);
      await this.state.storage.setAlarm(Date.now() + STAGE_GAP_MS);
      return Response.json({ ok: true });
    }
    return new Response('not found', { status: 404 });
  }

  private async update(fields: Record<string, unknown>): Promise<void> {
    const cols = Object.keys(fields);
    if (!cols.length) return;
    const set = cols.map((c) => `${c} = ?`).join(', ');
    const vals = cols.map((c) => fields[c]);
    await execute(this.env.DB, `UPDATE deep_research_jobs SET ${set}, updated_at = datetime('now') WHERE id = ?`, ...vals, (await this.s()).meta.jobId);
  }

  private async s(): Promise<DOState> {
    return (await this.state.storage.get<DOState>('s'))!;
  }

  async alarm(): Promise<void> {
    const st = await this.state.storage.get<DOState>('s');
    if (!st) return;
    try {
      switch (st.stage) {
        case 'expand': await this.expand(st); break;
        case 'search': await this.search(st); break;
        case 'extract': await this.extract(st); break;
        case 'verify': await this.verify(st); break;
        case 'synthesize': await this.synthesize(st); break;
        default: return;
      }
      await this.state.storage.put('s', st);
      // Stage methods mutate st.stage by reference; tsc narrows it away from
      // 'done' after the switch, so widen back to Stage for the guard.
      if ((st.stage as Stage) !== 'done') await this.state.storage.setAlarm(Date.now() + STAGE_GAP_MS);
    } catch (e: any) {
      const msg = e instanceof FirecrawlConfigError ? 'FIRECRAWL_API_KEY not set' : String(e?.message || e).slice(0, 300);
      await this.update({ status: 'error', error: msg, stage_detail: `Failed at ${st.stage}` });
    }
  }

  private async expand(st: DOState): Promise<void> {
    const { system, user } = anglePrompt(st.meta.subject, st.meta.subjectType, st.meta.context);
    const text = await runResearchLLM(this.env, { system, user, maxTokens: 512 });
    st.angles = mergeAngles(st.meta.seedAngles, parseAngles(text, MAX_ANGLES), MAX_ANGLES);
    st.stage = 'search';
    await this.update({ status: 'searching', progress: 20, angles_json: JSON.stringify(st.angles), stage_detail: `Planned ${st.angles.length} angles` });
  }

  private async search(st: DOState): Promise<void> {
    const out: SourceRec[] = [];
    const seen = new Set<string>();
    for (const angle of st.angles) {
      if (out.length >= MAX_TOTAL_SOURCES) break;
      let results: Awaited<ReturnType<typeof firecrawlSearch>> = [];
      try { results = await firecrawlSearch(this.env, `${st.meta.subject} ${angle}`, { limit: MAX_SOURCES_PER_ANGLE, scrape: true }); }
      catch (e) { if (e instanceof FirecrawlConfigError) throw e; /* else skip this angle */ }
      for (const r of results) {
        if (seen.has(r.url) || out.length >= MAX_TOTAL_SOURCES) continue;
        seen.add(r.url);
        out.push({ url: r.url, title: r.title, description: r.description, markdown: r.markdown || '', angle });
      }
    }
    // Backfill markdown for high-value sources the search didn't inline.
    for (const s of out) {
      if (!s.markdown) { try { s.markdown = await firecrawlScrape(this.env, s.url); } catch { /* leave empty */ } }
    }
    st.sources = out;
    st.stage = 'extract';
    for (const s of out) {
      await execute(this.env.DB,
        `INSERT INTO research_sources (job_id, run_no, url, title, description, angle, scraped, markdown_excerpt) VALUES (?,?,?,?,?,?,?,?)`,
        st.meta.jobId, st.meta.runNo, s.url, s.title, s.description, s.angle, s.markdown ? 1 : 0, s.markdown.slice(0, 2000));
    }
    await this.update({ status: 'extracting', progress: 50, source_count: out.length, stage_detail: `Collected ${out.length} sources` });
  }

  private async extract(st: DOState): Promise<void> {
    const withMd = st.sources.filter((s) => s.markdown && s.markdown.length > 100);
    const raw: RawFinding[] = [];
    for (let i = 0; i < withMd.length; i += EXTRACT_BATCH) {
      const batch = withMd.slice(i, i + EXTRACT_BATCH);
      const { system, user } = extractPrompt(st.meta.subject, batch);
      const text = await runResearchLLM(this.env, { system, user, maxTokens: 2048 });
      raw.push(...parseFindings(text));
    }
    st.findings = raw.map((f) => ({ ...f, verdict: 'uncertain' as Verdict, trust: 0, status: 'proposed' as const }));
    st.stage = 'verify';
    await this.update({ status: 'verifying', progress: 70, finding_count: st.findings.length, stage_detail: `Extracted ${st.findings.length} findings` });
  }

  private async verify(st: DOState): Promise<void> {
    const md = new Map(st.sources.map((s) => [s.url, s.markdown]));
    for (const f of st.findings) {
      const impactful = f.confidence >= VERIFY_CONFIDENCE_FLOOR || VERIFY_TYPES.has(f.finding_type);
      let verdict: Verdict = 'supported';
      if (impactful) {
        const srcs = f.source_urls.map((u) => ({ url: u, markdown: md.get(u) || '' })).filter((s) => s.markdown);
        if (srcs.length) {
          try { const { system, user } = verifyPrompt(f, srcs); verdict = parseVerdict(await runResearchLLM(this.env, { system, user, maxTokens: 256 })); }
          catch { verdict = 'uncertain'; }
        } else { verdict = 'uncertain'; }
      }
      f.verdict = verdict;
      f.trust = deriveTrust({ confidence: f.confidence, sourceCount: new Set(f.source_urls).size, verdict });
      f.status = verdict === 'refuted' ? 'dismissed' : 'proposed';
      await execute(this.env.DB,
        `INSERT INTO research_findings (job_id, run_no, org_id, finding_type, title, detail, confidence, trust, verdict, source_urls_json, status) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        st.meta.jobId, st.meta.runNo, st.meta.orgId, f.finding_type, f.title, f.detail, f.confidence, f.trust, f.verdict, JSON.stringify(f.source_urls), f.status);
    }
    st.stage = 'synthesize';
    await this.update({ status: 'synthesizing', progress: 85, stage_detail: 'Verified findings' });
  }

  private async synthesize(st: DOState): Promise<void> {
    const kept = st.findings.filter((f) => f.status !== 'dismissed');
    const allUrls: string[] = [];
    for (const f of kept) for (const u of f.source_urls) allUrls.push(u);
    const cite = numberCitations(allUrls);
    const reportSources = [...cite.entries()].map(([url, n]) => {
      const s = st.sources.find((x) => x.url === url);
      return { n, url, title: s?.title || url };
    });
    const reportFindings = kept.map((f) => ({
      title: f.title, detail: f.detail, trust: f.trust,
      citations: [...new Set(f.source_urls.map((u) => cite.get(u)).filter((n): n is number => !!n))],
    }));
    let report = '';
    try {
      const { system, user } = synthesisPrompt(st.meta.subject, reportFindings, reportSources);
      report = await runResearchLLM(this.env, { system, user, maxTokens: 3000 });
    } catch { /* leave report empty; findings still persisted */ }
    if (!report.trim()) {
      report = `# ${st.meta.subject}\n\n${kept.map((f) => `- **${f.title}** — ${f.detail}`).join('\n')}\n\n## Sources\n${reportSources.map((s) => `[${s.n}] ${s.url}`).join('\n')}`;
    }
    await execute(this.env.DB,
      `INSERT INTO research_runs (job_id, run_no, finished_at, new_findings, source_count) VALUES (?,?,datetime('now'),?,?)`,
      st.meta.jobId, st.meta.runNo, kept.length, st.sources.length);
    st.stage = 'done';
    const monitor = st.meta.monitorIntervalDays;
    const nextRun = monitor ? new Date(Date.now() + monitor * 86400000).toISOString() : null;
    await this.update({
      status: 'done', progress: 100, report_md: report, last_run_at: nowIso(),
      run_count: st.meta.runNo, next_run_at: nextRun, stage_detail: 'Complete',
    });
    if (monitor && nextRun) {
      // Re-run as a monitor: bump run_no and restart the pipeline at the alarm.
      const next: DOState = { ...st, meta: { ...st.meta, runNo: st.meta.runNo + 1 }, stage: 'expand', angles: [], sources: [], findings: [] };
      await this.state.storage.put('s', next);
      await this.state.storage.setAlarm(Date.parse(nextRun));
    }
  }
}
```

- [ ] **Step 2: Register the DO export in `src/index.ts`**

Change the existing line 25 import block + line 45 export. Add the import next to the other DO imports:

```typescript
import { DeepResearchDO } from './durable-objects/DeepResearchDO';
```

And add `DeepResearchDO` to the export on line 45:

```typescript
export { WelfareWatchDO, VoiceHubDO, AlertHubDO, PdfToolsContainer, DeepResearchDO };
```

- [ ] **Step 3: Add the DO binding + migration tag in `wrangler.toml`**

After the `[[durable_objects.bindings]]` block for `ALERT_HUB` (the one with `class_name = "AlertHubDO"`), add:

```toml
[[durable_objects.bindings]]
name = "DEEP_RESEARCH"
class_name = "DeepResearchDO"
```

After the last existing `[[migrations]]` block (`tag = "v3-alerthub"`), add:

```toml
[[migrations]]
tag = "v4-deepresearch"
new_sqlite_classes = ["DeepResearchDO"]
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/durable-objects/DeepResearchDO.ts src/index.ts wrangler.toml
git commit -m "feat(deep-research): DeepResearchDO alarm stage machine + binding"
```

---

## Task 7: Route + mount

**Files:**
- Create: `src/routes/deepResearch.ts`
- Modify: `src/routesConfig.ts`

- [ ] **Step 1: Write the route**

```typescript
// src/routes/deepResearch.ts
import { Hono } from 'hono';
import type { Env } from '../types';
import { query, queryFirst, execute } from '../utils/db';

const deepResearch = new Hono<Env>();

function actorId(c: { get: (k: 'user') => any }): number | null {
  const u = c.get('user');
  return u?.user_id ?? u?.userId ?? u?.id ?? null;
}
function orgId(c: { get: (k: 'user') => any }): number | null {
  const u = c.get('user');
  return u?.org_id ?? u?.orgId ?? null;
}

deepResearch.get('/health', (c) => c.json({ configured: !!(c.env.FIRECRAWL_API_KEY || '').trim() }));

deepResearch.post('/', async (c): Promise<Response> => {
  if (!(c.env.FIRECRAWL_API_KEY || '').trim()) {
    return c.json({ error: 'Firecrawl not configured' }, 503);
  }
  const body = await c.req.json().catch(() => ({} as any));
  const subject = String(body.subject || '').trim();
  if (!subject) return c.json({ error: 'subject required' }, 400);
  const subjectType = String(body.subject_type || 'topic');
  const context = String(body.context || '');
  const seedAngles: string[] = Array.isArray(body.seed_angles) ? body.seed_angles.map(String) : [];
  const monitorIntervalDays = Number.isFinite(body.monitor_interval_days) && body.monitor_interval_days > 0
    ? Math.floor(body.monitor_interval_days) : null;
  const link = body.link && body.link.entity_type ? body.link : null;
  const id = crypto.randomUUID();
  const org = orgId(c);
  const uid = actorId(c);

  await execute(c.env.DB,
    `INSERT INTO deep_research_jobs (id, org_id, created_by, subject, subject_type, context, status, progress, monitor_interval_days, linked_entity_type, linked_entity_id, run_count) VALUES (?,?,?,?,?,?, 'queued', 0, ?,?,?, 1)`,
    id, org, uid, subject, subjectType, context, monitorIntervalDays,
    link?.entity_type ?? null, link?.entity_id ?? null);

  await execute(c.env.DB,
    `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details, created_at) VALUES (?,?,?,?,?, datetime('now'))`,
    uid, 'deep_research.create', 'deep_research_job', null, JSON.stringify({ id, subject, subjectType }));

  const stub = c.env.DEEP_RESEARCH.get(c.env.DEEP_RESEARCH.idFromName(id));
  await stub.fetch('https://do/start', {
    method: 'POST',
    body: JSON.stringify({ jobId: id, orgId: org, subject, subjectType, context, seedAngles, monitorIntervalDays, runNo: 1 }),
  });
  return c.json({ id }, 201);
});

deepResearch.get('/jobs', async (c): Promise<Response> => {
  const org = orgId(c);
  const monitor = c.req.query('monitor');
  const subjectType = c.req.query('subject_type');
  let sql = `SELECT id, subject, subject_type, status, progress, stage_detail, source_count, finding_count, monitor_interval_days, run_count, linked_entity_type, linked_entity_id, created_at, updated_at FROM deep_research_jobs WHERE (org_id = ? OR org_id IS NULL)`;
  const binds: unknown[] = [org];
  if (monitor === '1') sql += ` AND monitor_interval_days IS NOT NULL`;
  if (subjectType) { sql += ` AND subject_type = ?`; binds.push(subjectType); }
  sql += ` ORDER BY created_at DESC LIMIT 100`;
  return c.json(await query(c.env.DB, sql, ...binds));
});

deepResearch.get('/jobs/:id', async (c): Promise<Response> => {
  const id = c.req.param('id');
  const job = await queryFirst(c.env.DB, `SELECT * FROM deep_research_jobs WHERE id = ?`, id);
  if (!job) return c.json({ error: 'not found' }, 404);
  const sources = await query(c.env.DB, `SELECT id, run_no, url, title, description, angle, scraped FROM research_sources WHERE job_id = ? ORDER BY run_no DESC, id ASC`, id);
  const findings = await query(c.env.DB, `SELECT id, run_no, finding_type, title, detail, confidence, trust, verdict, source_urls_json, status, entity_ref_type, entity_ref_id, is_delta FROM research_findings WHERE job_id = ? ORDER BY run_no DESC, trust DESC`, id);
  return c.json({ job, sources, findings });
});

deepResearch.post('/jobs/:id/rerun', async (c): Promise<Response> => {
  const id = c.req.param('id');
  const job = await queryFirst<any>(c.env.DB, `SELECT * FROM deep_research_jobs WHERE id = ?`, id);
  if (!job) return c.json({ error: 'not found' }, 404);
  const runNo = (job.run_count || 1) + 1;
  await execute(c.env.DB, `UPDATE deep_research_jobs SET status='queued', progress=0, run_count=?, updated_at=datetime('now') WHERE id=?`, runNo, id);
  const stub = c.env.DEEP_RESEARCH.get(c.env.DEEP_RESEARCH.idFromName(id));
  await stub.fetch('https://do/start', {
    method: 'POST',
    body: JSON.stringify({ jobId: id, orgId: job.org_id, subject: job.subject, subjectType: job.subject_type, context: job.context || '', seedAngles: [], monitorIntervalDays: job.monitor_interval_days, runNo }),
  });
  return c.json({ ok: true, run_no: runNo });
});

deepResearch.put('/jobs/:id/monitor', async (c): Promise<Response> => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({} as any));
  const days = Number.isFinite(body.monitor_interval_days) && body.monitor_interval_days > 0 ? Math.floor(body.monitor_interval_days) : null;
  const next = days ? new Date(Date.now() + days * 86400000).toISOString() : null;
  await execute(c.env.DB, `UPDATE deep_research_jobs SET monitor_interval_days=?, next_run_at=?, updated_at=datetime('now') WHERE id=?`, days, next, id);
  return c.json({ ok: true, monitor_interval_days: days });
});

deepResearch.delete('/jobs/:id', async (c): Promise<Response> => {
  const id = c.req.param('id');
  await execute(c.env.DB, `DELETE FROM research_findings WHERE job_id = ?`, id);
  await execute(c.env.DB, `DELETE FROM research_sources WHERE job_id = ?`, id);
  await execute(c.env.DB, `DELETE FROM research_runs WHERE job_id = ?`, id);
  await execute(c.env.DB, `DELETE FROM deep_research_jobs WHERE id = ?`, id);
  return c.json({ ok: true });
});

deepResearch.post('/findings/:id/confirm', async (c): Promise<Response> => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({} as any));
  const refType = body.entity_ref_type ? String(body.entity_ref_type) : null;
  const refId = Number.isFinite(body.entity_ref_id) ? Math.floor(body.entity_ref_id) : null;
  await execute(c.env.DB, `UPDATE research_findings SET status='confirmed', entity_ref_type=?, entity_ref_id=? WHERE id=?`, refType, refId, id);
  await execute(c.env.DB,
    `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details, created_at) VALUES (?,?,?,?,?, datetime('now'))`,
    actorId(c), 'deep_research.confirm_finding', 'research_finding', id, JSON.stringify({ refType, refId }));
  return c.json({ ok: true });
});

deepResearch.post('/findings/:id/dismiss', async (c): Promise<Response> => {
  const id = c.req.param('id');
  await execute(c.env.DB, `UPDATE research_findings SET status='dismissed' WHERE id=?`, id);
  return c.json({ ok: true });
});

export default deepResearch;
```

- [ ] **Step 2: Mount the route in `src/routesConfig.ts`**

Add the import near the other route imports (top of file, alongside `crm`):

```typescript
import deepResearch from './routes/deepResearch';
```

Add the mount entry next to the `/api/crm` entry in the routes array:

```typescript
  { prefix: '/api/deep-research', router: deepResearch, auth: 'required' },
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/routes/deepResearch.ts src/routesConfig.ts
git commit -m "feat(deep-research): /api/deep-research route + mount"
```

---

## Task 8: Client — Deep Research tab component

**Files:**
- Create: `client/src/components/crm/DeepResearchTab.tsx`

This component follows the existing CRM tab patterns: `apiFetch`, `PanelTitleBar`, `IconButton` (with `aria-label`), theme tokens (no hardcoded hex), 2px radius.

- [ ] **Step 1: Write the component**

```tsx
// client/src/components/crm/DeepResearchTab.tsx
// Overwatch → Deep Research: launch a Firecrawl-powered deep research job,
// poll its async pipeline, and review trust-scored findings + a cited report.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Telescope, Loader2, RefreshCw, Trash2, ExternalLink, ShieldCheck, AlertTriangle,
  Search, Plus, X, CheckCircle, Eye,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { useToast } from '../ToastProvider';
import PanelTitleBar from '../PanelTitleBar';
import { safeDateTimeStr } from '../../utils/dateUtils';

interface JobRow {
  id: string; subject: string; subject_type: string; status: string; progress: number;
  stage_detail: string | null; source_count: number; finding_count: number;
  monitor_interval_days: number | null; run_count: number; created_at: string;
}
interface Finding {
  id: number; finding_type: string; title: string; detail: string; confidence: number;
  trust: number; verdict: string; source_urls_json: string | null; status: string; is_delta: number;
}
interface SourceRow { id: number; url: string; title: string; description: string; angle: string; scraped: number }
interface JobDetail { job: JobRow & { report_md: string | null; error: string | null; angles_json: string | null }; sources: SourceRow[]; findings: Finding[] }

const SUBJECT_TYPES = ['person', 'business', 'address', 'vehicle', 'lead', 'competitor', 'topic'];
const ACTIVE = new Set(['queued', 'expanding', 'searching', 'scraping', 'extracting', 'verifying', 'synthesizing', 'monitoring']);

function TrustBadge({ trust, verdict }: { trust: number; verdict: string }) {
  const pct = Math.round(trust * 100);
  const cls = verdict === 'refuted' || trust < 0.4 ? 'text-red-400 border-red-700/50'
    : trust < 0.7 ? 'text-amber-400 border-amber-700/50' : 'text-emerald-400 border-emerald-700/50';
  return (
    <span className={`text-[8px] font-mono font-bold px-1.5 py-0.5 border tabular-nums ${cls}`} style={{ borderRadius: '2px' }}>
      {pct}% · {verdict}
    </span>
  );
}

export default function DeepResearchTab() {
  const { addToast } = useToast();
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [subject, setSubject] = useState('');
  const [subjectType, setSubjectType] = useState('person');
  const [context, setContext] = useState('');
  const [seedAngles, setSeedAngles] = useState<string[]>([]);
  const [angleDraft, setAngleDraft] = useState('');
  const [monitorDays, setMonitorDays] = useState<number | ''>('');
  const [submitting, setSubmitting] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadJobs = useCallback(async () => {
    try { setJobs(await apiFetch<JobRow[]>('/deep-research/jobs')); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    apiFetch<{ configured: boolean }>('/deep-research/health').then((d) => setConfigured(d.configured)).catch(() => setConfigured(false));
    loadJobs();
  }, [loadJobs]);

  const loadDetail = useCallback(async (id: string) => {
    try { setDetail(await apiFetch<JobDetail>(`/deep-research/jobs/${id}`)); } catch { /* ignore */ }
  }, []);

  // Poll the active job while it's running.
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (!activeId) return;
    loadDetail(activeId);
    pollRef.current = setInterval(() => {
      loadDetail(activeId);
      setDetail((d) => {
        if (d && !ACTIVE.has(d.job.status)) { if (pollRef.current) clearInterval(pollRef.current); loadJobs(); }
        return d;
      });
    }, 2500);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [activeId, loadDetail, loadJobs]);

  const addAngle = () => {
    const a = angleDraft.trim();
    if (a && !seedAngles.includes(a)) setSeedAngles([...seedAngles, a]);
    setAngleDraft('');
  };

  const submit = async () => {
    if (!subject.trim()) { addToast('Enter a subject', 'error'); return; }
    setSubmitting(true);
    try {
      const r = await apiFetch<{ id: string }>('/deep-research', {
        method: 'POST',
        body: JSON.stringify({
          subject: subject.trim(), subject_type: subjectType, context: context.trim(),
          seed_angles: seedAngles, monitor_interval_days: monitorDays || undefined,
        }),
      });
      addToast('Research started', 'success');
      setSubject(''); setContext(''); setSeedAngles([]); setMonitorDays('');
      setActiveId(r.id);
      loadJobs();
    } catch (e: any) {
      addToast(e?.message?.includes('503') ? 'Firecrawl not configured' : 'Failed to start research', 'error');
    } finally { setSubmitting(false); }
  };

  const confirmFinding = async (f: Finding) => {
    try { await apiFetch(`/deep-research/findings/${f.id}/confirm`, { method: 'POST', body: JSON.stringify({}) }); if (activeId) loadDetail(activeId); addToast('Finding confirmed', 'success'); }
    catch { addToast('Failed', 'error'); }
  };
  const dismissFinding = async (f: Finding) => {
    try { await apiFetch(`/deep-research/findings/${f.id}/dismiss`, { method: 'POST', body: JSON.stringify({}) }); if (activeId) loadDetail(activeId); }
    catch { addToast('Failed', 'error'); }
  };
  const rerun = async (id: string) => {
    try { await apiFetch(`/deep-research/jobs/${id}/rerun`, { method: 'POST', body: JSON.stringify({}) }); setActiveId(id); addToast('Re-running', 'success'); }
    catch { addToast('Failed', 'error'); }
  };
  const del = async (id: string) => {
    if (!window.confirm('Delete this research job?')) return;
    try { await apiFetch(`/deep-research/jobs/${id}`, { method: 'DELETE' }); if (activeId === id) { setActiveId(null); setDetail(null); } loadJobs(); }
    catch { addToast('Failed', 'error'); }
  };

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="DEEP RESEARCH" icon={Telescope} />

      {configured === false && (
        <div className="flex items-center gap-2 text-amber-400 text-xs border border-amber-700/50 bg-amber-900/20 p-2" style={{ borderRadius: '2px' }}>
          <AlertTriangle className="w-4 h-4" /> Firecrawl is not configured — set FIRECRAWL_API_KEY to enable research.
        </div>
      )}

      {/* New research form */}
      <div className="bg-surface-raised border border-rmpg-700 p-3 space-y-2" style={{ borderRadius: '2px' }}>
        <div className="flex gap-2 flex-wrap">
          <input
            id="dr-subject" value={subject} onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject (name, business, address, plate, topic…)"
            className="flex-1 min-w-[220px] bg-surface-base border border-rmpg-700 text-white text-xs px-2 py-1.5" style={{ borderRadius: '2px' }} />
          <select value={subjectType} onChange={(e) => setSubjectType(e.target.value)}
            className="bg-surface-base border border-rmpg-700 text-white text-xs px-2 py-1.5" style={{ borderRadius: '2px' }}>
            {SUBJECT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <input value={context} onChange={(e) => setContext(e.target.value)} placeholder="Context / why you're researching (optional)"
          className="w-full bg-surface-base border border-rmpg-700 text-white text-xs px-2 py-1.5" style={{ borderRadius: '2px' }} />
        <div className="flex gap-2 items-center flex-wrap">
          <input value={angleDraft} onChange={(e) => setAngleDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addAngle(); } }}
            placeholder="Add a seed angle (optional)" className="flex-1 min-w-[180px] bg-surface-base border border-rmpg-700 text-white text-xs px-2 py-1.5" style={{ borderRadius: '2px' }} />
          <button type="button" onClick={addAngle} aria-label="Add angle" className="text-rmpg-400 hover:text-white"><Plus className="w-4 h-4" /></button>
          <label className="text-[10px] text-rmpg-400 flex items-center gap-1">Monitor every
            <input type="number" min={1} value={monitorDays} onChange={(e) => setMonitorDays(e.target.value ? Number(e.target.value) : '')}
              className="w-14 bg-surface-base border border-rmpg-700 text-white text-xs px-1 py-1 ml-1" style={{ borderRadius: '2px' }} /> days
          </label>
        </div>
        {seedAngles.length > 0 && (
          <div className="flex gap-1 flex-wrap">
            {seedAngles.map((a) => (
              <span key={a} className="text-[9px] bg-rmpg-800 text-rmpg-300 px-1.5 py-0.5 flex items-center gap-1" style={{ borderRadius: '2px' }}>
                {a}<button type="button" aria-label={`Remove ${a}`} onClick={() => setSeedAngles(seedAngles.filter((x) => x !== a))}><X className="w-3 h-3" /></button>
              </span>
            ))}
          </div>
        )}
        <button type="button" onClick={submit} disabled={submitting || configured === false}
          className="flex items-center gap-1.5 bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white text-xs font-semibold px-3 py-1.5" style={{ borderRadius: '2px' }}>
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />} Start Deep Research
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Jobs list */}
        <div className="space-y-1.5">
          <div className="text-[10px] font-semibold text-rmpg-400 uppercase">Research Jobs</div>
          {jobs.length === 0 && <div className="text-[11px] text-rmpg-500">No jobs yet.</div>}
          {jobs.map((j) => (
            <div key={j.id} onClick={() => setActiveId(j.id)}
              className={`cursor-pointer border p-2 ${activeId === j.id ? 'border-brand-500 bg-surface-raised' : 'border-rmpg-700 bg-surface-base'}`} style={{ borderRadius: '2px' }}>
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs text-white font-semibold truncate">{j.subject}</div>
                <span className="text-[8px] text-rmpg-400 uppercase">{j.subject_type}</span>
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-[9px] text-rmpg-400">{ACTIVE.has(j.status) ? `${j.stage_detail || j.status} (${j.progress}%)` : j.status}</span>
                <div className="flex items-center gap-1">
                  {j.monitor_interval_days ? <span className="text-[8px] text-blue-400 flex items-center gap-0.5"><Eye className="w-3 h-3" />{j.monitor_interval_days}d</span> : null}
                  <button type="button" aria-label="Re-run" onClick={(e) => { e.stopPropagation(); rerun(j.id); }} className="text-rmpg-400 hover:text-white"><RefreshCw className="w-3 h-3" /></button>
                  <button type="button" aria-label="Delete" onClick={(e) => { e.stopPropagation(); del(j.id); }} className="text-rmpg-400 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Detail */}
        <div className="lg:col-span-2 space-y-3">
          {!detail && <div className="text-[11px] text-rmpg-500">Select a job to view findings.</div>}
          {detail && (
            <>
              <div className="bg-surface-raised border border-rmpg-700 p-2" style={{ borderRadius: '2px' }}>
                <div className="flex items-center gap-2">
                  {ACTIVE.has(detail.job.status) && <Loader2 className="w-4 h-4 animate-spin text-brand-400" />}
                  <span className="text-xs text-white font-semibold">{detail.job.subject}</span>
                  <span className="text-[9px] text-rmpg-400 ml-auto">{detail.job.stage_detail || detail.job.status} · {detail.job.progress}%</span>
                </div>
                {detail.job.error && <div className="text-[10px] text-red-400 mt-1">{detail.job.error}</div>}
              </div>

              {/* Findings */}
              {detail.findings.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-[10px] font-semibold text-rmpg-400 uppercase">Findings ({detail.findings.length})</div>
                  {detail.findings.map((f) => (
                    <div key={f.id} className={`border p-2 ${f.status === 'dismissed' ? 'opacity-50 border-rmpg-800' : 'border-rmpg-700'} bg-surface-base`} style={{ borderRadius: '2px' }}>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[8px] uppercase text-rmpg-500">{f.finding_type}</span>
                        <TrustBadge trust={f.trust} verdict={f.verdict} />
                        {f.is_delta ? <span className="text-[8px] text-blue-400">NEW</span> : null}
                        <span className="text-xs text-white font-semibold">{f.title}</span>
                        {f.status !== 'dismissed' && (
                          <span className="ml-auto flex items-center gap-1">
                            <button type="button" aria-label="Confirm finding" onClick={() => confirmFinding(f)} className="text-emerald-400 hover:text-emerald-300"><CheckCircle className="w-3.5 h-3.5" /></button>
                            <button type="button" aria-label="Dismiss finding" onClick={() => dismissFinding(f)} className="text-rmpg-400 hover:text-red-400"><X className="w-3.5 h-3.5" /></button>
                          </span>
                        )}
                        {f.status === 'confirmed' && <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 ml-auto" />}
                      </div>
                      {f.detail && <div className="text-[11px] text-rmpg-300 mt-1">{f.detail}</div>}
                    </div>
                  ))}
                </div>
              )}

              {/* Report */}
              {detail.job.report_md && (
                <div className="bg-surface-raised border border-rmpg-700 p-3" style={{ borderRadius: '2px' }}>
                  <div className="text-[10px] font-semibold text-rmpg-400 uppercase mb-1">Report</div>
                  <pre className="text-[11px] text-rmpg-200 whitespace-pre-wrap font-sans">{detail.job.report_md}</pre>
                </div>
              )}

              {/* Sources */}
              {detail.sources.length > 0 && (
                <div className="space-y-1">
                  <div className="text-[10px] font-semibold text-rmpg-400 uppercase">Sources ({detail.sources.length})</div>
                  {detail.sources.map((s, i) => (
                    <a key={s.id} href={s.url} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-[10px] text-blue-400 hover:text-blue-300 truncate">
                      <span className="text-rmpg-500">[{i + 1}]</span><ExternalLink className="w-3 h-3 shrink-0" />
                      <span className="truncate">{s.title || s.url}</span>
                    </a>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck the client**

Run: `cd client && npx tsc --noEmit && cd ..`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/crm/DeepResearchTab.tsx
git commit -m "feat(deep-research): Overwatch Deep Research tab component"
```

---

## Task 9: Wire the tab into Overwatch + SW bump

**Files:**
- Modify: `client/src/pages/CrmPage.tsx`
- Modify: `client/public/sw.js`

- [ ] **Step 1: Register the section in `CrmPage.tsx`**

Add the import next to the other CRM tab imports (near line 39):

```tsx
import DeepResearchTab from '../components/crm/DeepResearchTab';
```

Add `'deepresearch'` to the `CrmSection` union type (the line beginning `type CrmSection =`):

```tsx
type CrmSection = 'dashboard' | 'clients' | 'properties' | 'contacts' | 'invoices' | 'tasks' | 'leads' | 'proposals' | 'reports' | 'webintel' | 'competitors' | 'firecrawl' | 'deepresearch';
```

Add a SECTIONS entry right after the `firecrawl` entry (near line 74) — import `Telescope` from `lucide-react` at the top of the file if not already imported:

```tsx
  { id: 'deepresearch', label: 'Deep Research', icon: Telescope },
```

Add the render branch right after the `firecrawl` render line (near line 522):

```tsx
        {activeSection === 'deepresearch' && <DeepResearchTab />}
```

- [ ] **Step 2: Bump the service worker cache**

In `client/public/sw.js`, find the `CACHE_NAME` line and increment it to the next version (e.g. if it reads `v969`, set `v970`).

Run: `grep -n "CACHE_NAME" client/public/sw.js`
Expected: shows the new version.

- [ ] **Step 3: Typecheck + build the client**

Run: `cd client && npx tsc --noEmit && npx vite build && cd ..`
Expected: both PASS (build emits `client/dist`).

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/CrmPage.tsx client/public/sw.js
git commit -m "feat(deep-research): wire Deep Research tab into Overwatch + SW bump"
```

---

## Task 10: Full verification + live smoke + PR

- [ ] **Step 1: Full worker test + typecheck**

Run: `npm run typecheck && npx vitest run`
Expected: typecheck PASS; all suites green (including the 3 new test files).

- [ ] **Step 2: Client typecheck + build**

Run: `cd client && npx tsc --noEmit && npx vite build && cd ..`
Expected: PASS.

- [ ] **Step 3: Local live smoke (real Firecrawl key from .dev.vars)**

Start the Worker: `npm run dev` (separate shell), then in another shell:

```bash
# 1. Auth — obtain a JWT the same way the client does (login endpoint), export as $TOKEN.
# 2. Confirm key is seen:
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8787/api/deep-research/health
#    expect {"configured":true}
# 3. Create a job:
JOB=$(curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"subject":"Rocky Mountain Protective Group Salt Lake City","subject_type":"business"}' \
  http://localhost:8787/api/deep-research | sed 's/.*"id":"\([^"]*\)".*/\1/')
echo "job=$JOB"
# 4. Poll until status=done (DO advances one stage every ~0.5s; allow ~1-2 min):
for i in $(seq 1 40); do sleep 5; curl -s -H "Authorization: Bearer $TOKEN" \
  http://localhost:8787/api/deep-research/jobs/$JOB | head -c 300; echo; done
```

Expected: status walks `expanding → searching → extracting → verifying → synthesizing → done`, ending with non-empty `report_md`, ≥1 source, ≥1 finding with a derived `trust`.

> If `env.AI.run` is unavailable in local `wrangler dev` without remote AI, run `npm run dev` with `--remote` or set an `anthropic_api_key` in local `system_config` so the LLM ladder has an engine. Note the result in the PR.

- [ ] **Step 4: Push branch + open PR**

```bash
git push -u origin feat/overwatch-deep-research
gh pr create --title "Overwatch Deep Research: Firecrawl pipeline + findings" \
  --body "$(cat <<'EOF'
## Summary
Real Firecrawl-powered deep research in the Overwatch (CRM) module, replacing the stubbed Firecrawl endpoints. Async DO-driven pipeline: angle expansion → fan-out search+scrape → structured finding extraction → adversarial verification → cited synthesis. Findings carry DERIVED trust (consensus + verification, not raw model confidence), link to records, and jobs can run as scheduled monitors.

## Post-merge (REQUIRED)
- [ ] Apply `migrations/0122_deep_research.sql` directly to live D1 `rmpg-flex` (785de7ae) — deploy apply is continue-on-error.
- [ ] `wrangler secret put FIRECRAWL_API_KEY` on the production Worker.
- [ ] Verify in a real browser (WAF managed-challenge blocks curl on non-/api/health).

## Tests
- New: tests/firecrawl.test.ts, tests/researchEngine.test.ts, tests/researchPrompts.test.ts
- Local live smoke against real Firecrawl key documented in the plan.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR opens; `pr-tests.yml` runs worker-typecheck, client-typecheck, client-tests, client-build, and the column-cap check (no ALTER on watched tables → passes).

---

## Self-Review Notes (completed during planning)

- **Spec coverage:** §3 architecture → Tasks 3–7; §4 data model → Task 1; §5 stages → Task 6; §6 API → Task 7; §7 UI → Tasks 8–9; §8 security (503/auth/audit/caps) → Tasks 6–7; §9 testing → Tasks 3–5,10; §10 rollout → Task 10. ✓
- **Type consistency:** `runResearchLLM`/`parseAngles`/`mergeAngles`/`parseFindings`/`parseVerdict`/`deriveTrust`/`numberCitations` signatures match between Task 4 (definition) and Task 6 (use). `firecrawlSearch`/`firecrawlScrape` match Task 3 ↔ Task 6. DO binding `DEEP_RESEARCH` + class `DeepResearchDO` consistent across Tasks 2/6/7. Route paths in Task 7 match the client calls in Task 8. ✓
- **No placeholders:** every code step contains full code; no TBD/TODO. ✓
- **Known runtime caveat (not a gap):** Workers AI in local `wrangler dev` may require `--remote`; documented in Task 10 Step 3.
```

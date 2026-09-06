// Client for the RMPG Flex documentation knowledge base (/api/knowledge) —
// SOPs, runbooks, guides and forms indexed in the Cloudflare AI Search
// instance "flex-search". Distinct from knowledgeBase.ts, which searches
// RECORDS (calls, persons, warrants…) via /api/knowledge-base.
//
// The Worker route (src/routes/knowledge.ts) is a same-origin façade over the
// AI Search binding, so this works identically in the SPA, the Electron
// desktop and Flex Kiosk Mode with the normal Flex JWT.

import { apiFetch } from '../hooks/useApi';

export interface DocChunk {
  text: string;
  score: number;
  /** Human-readable document name (object key with folders stripped). */
  source: string;
  key: string;
}

export interface DocCitation {
  source: string;
  key: string;
  score: number;
}

export type WebMode = 'off' | 'auto' | 'on';

export interface WebCitation {
  tag: string;
  url: string;
  title: string;
  snippet: string;
  provider: 'firecrawl' | 'duckduckgo';
}

export interface AskResponse {
  answer: string;
  citations: DocCitation[];
  results: DocChunk[];
  /** Live web sources used (hybrid mode). Empty for docs-only answers. */
  web?: WebCitation[];
  /** 'docs' | 'hybrid' | 'docs+web-unavailable' */
  mode?: string;
  web_provider?: string;
  provider?: string;
  model?: string;
  /** Present when the Worker has no FLEX_SEARCH binding (dev/preview). */
  skipped?: boolean;
}

export interface SearchResponse {
  query: string;
  results: DocChunk[];
  citations: DocCitation[];
  skipped?: boolean;
}

export const MAX_QUESTION_CHARS = 2000;

/** Ask a natural-language question; returns a cited answer. Throws on transport error. */
export async function askFlexDocs(question: string, opts: { maxResults?: number; web?: WebMode } = {}): Promise<AskResponse> {
  const q = question.trim().slice(0, MAX_QUESTION_CHARS);
  const { maxResults = 10, web = 'auto' } = opts;
  return apiFetch<AskResponse>('/knowledge/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: q, max_results: maxResults, web }),
    // Hybrid answers fetch live pages + run the LLM chain — allow up to 90s.
    timeoutMs: 90_000,
  });
}

/** Raw chunk search (no generation) — fast, for "show me the passage" use. */
export async function searchFlexDocs(query: string, maxResults = 10): Promise<SearchResponse> {
  const q = query.trim().slice(0, MAX_QUESTION_CHARS);
  return apiFetch<SearchResponse>('/knowledge/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q, max_results: maxResults }),
    timeoutMs: 30_000,
  });
}

/** Turn a stored object key like "RMPG-Evidence-Handling-SOP.md" into a title. */
export function docTitle(keyOrSource: string): string {
  const base = keyOrSource.split('/').pop() || keyOrSource;
  return base
    .replace(/\.(md|pdf|docx?|txt)$/i, '')
    .replace(/[-_]+/g, ' ')
    .trim();
}

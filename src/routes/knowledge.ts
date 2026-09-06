// ============================================================
// RMPG Flex — Knowledge base (Cloudflare AI Search "flex-search")
// ------------------------------------------------------------
// Same-origin façade over the AI Search instance so every Flex surface
// (SPA, Electron desktop, Flex Kiosk Mode, FlexOS) can query the RMPG
// knowledge base without CORS / authorized-host concerns and behind the
// normal Flex JWT. The instance itself is configured in the dashboard
// (system prompt, retrieval tuning, public endpoint at
// https://intel.rmpgutah.us for MCP clients); this route just proxies.
//
//   GET  /health            -> {configured, instance}
//   POST /search {query}    -> {query, results:[{text, score, source, key}]}
//   POST /ask    {question} -> {answer, citations:[{source, key, score}], results}
//                              (or {messages:[...]} for multi-turn)
//
// Binding: `[[ai_search]] binding = "FLEX_SEARCH" instance_name = "flex-search"`
// in wrangler.toml. Unbound (e.g. a preview env) -> 200 {skipped:true} via
// notConfigured() rather than a 5xx, matching the rest of the codebase.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { requireRole } from '../middleware/auth';
import { notConfigured } from '../utils/notConfigured';
import { log } from '../utils/logger';

const knowledge = new Hono<Env>();

// Internal staff only — the KB includes engineering + SOP material that the
// external contract_manager / client_viewer roles must not see.
const READ_ROLES = ['admin', 'manager', 'supervisor', 'officer', 'dispatcher', 'human_resources'];
knowledge.use('/search', requireRole(...READ_ROLES));
knowledge.use('/ask', requireRole(...READ_ROLES));

const INSTANCE = 'flex-search';
const MAX_QUERY_CHARS = 2000;
const MAX_RESULTS_CAP = 30;

type Chunk = AiSearchSearchResponse['chunks'][number];

interface KbResult {
  text: string;
  score: number;
  /** Human-readable source name (object key with any folder prefix stripped). */
  source: string;
  key: string;
  metadata?: Record<string, unknown>;
}

function toResult(ch: Chunk): KbResult {
  const key = ch.item?.key ?? '';
  return {
    text: ch.text,
    score: ch.score,
    source: key.split('/').pop() || key || 'unknown',
    key,
    metadata: ch.item?.metadata,
  };
}

/** Deduplicated citations (one per source document), best score first. */
function citationsFrom(chunks: Chunk[]): Array<{ source: string; key: string; score: number }> {
  const best = new Map<string, { source: string; key: string; score: number }>();
  for (const ch of chunks) {
    const r = toResult(ch);
    const cur = best.get(r.key);
    if (!cur || r.score > cur.score) best.set(r.key, { source: r.source, key: r.key, score: r.score });
  }
  return [...best.values()].sort((a, b) => b.score - a.score);
}

function clampResults(n: unknown, fallback = 10): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.floor(n) : fallback;
  return Math.min(Math.max(v, 1), MAX_RESULTS_CAP);
}

knowledge.get('/health', (c) => {
  const configured = Boolean(c.env.FLEX_SEARCH);
  return c.json({ configured, instance: INSTANCE, provider: 'cloudflare-ai-search' });
});

knowledge.post('/search', async (c) => {
  const search = c.env.FLEX_SEARCH;
  if (!search) return notConfigured(c, 'FLEX_SEARCH (AI Search binding)');

  const body = await c.req.json<{ query?: string; max_results?: number }>().catch(() => ({} as { query?: string; max_results?: number }));
  const query = (body.query ?? '').toString().trim();
  if (!query) return c.json({ error: 'query is required' }, 400);
  if (query.length > MAX_QUERY_CHARS) return c.json({ error: `query exceeds ${MAX_QUERY_CHARS} characters` }, 400);

  try {
    const res = await search.search({
      query,
      ai_search_options: { retrieval: { max_num_results: clampResults(body.max_results) } },
    } as AiSearchSearchRequest);
    return c.json({
      query: res.search_query ?? query,
      results: (res.chunks ?? []).map(toResult),
      citations: citationsFrom(res.chunks ?? []),
    });
  } catch (err) {
    log.error('knowledge.search failed', { err: String(err) });
    return c.json({ error: 'Knowledge search failed' }, 502);
  }
});

knowledge.post('/ask', async (c) => {
  const search = c.env.FLEX_SEARCH;
  if (!search) return notConfigured(c, 'FLEX_SEARCH (AI Search binding)');

  const body = await c.req
    .json<{ question?: string; messages?: Array<{ role: string; content: string }>; max_results?: number }>()
    .catch(() => ({} as { question?: string; messages?: Array<{ role: string; content: string }>; max_results?: number }));

  let messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  if (Array.isArray(body.messages) && body.messages.length) {
    messages = body.messages
      .filter((m) => m && typeof m.content === 'string' && ['user', 'assistant', 'system'].includes(m.role))
      .map((m) => ({ role: m.role as 'user' | 'assistant' | 'system', content: m.content.slice(0, MAX_QUERY_CHARS) }));
  } else {
    const question = (body.question ?? '').toString().trim();
    if (!question) return c.json({ error: 'question (or messages[]) is required' }, 400);
    if (question.length > MAX_QUERY_CHARS) return c.json({ error: `question exceeds ${MAX_QUERY_CHARS} characters` }, 400);
    messages = [{ role: 'user', content: question }];
  }
  if (!messages.length) return c.json({ error: 'no valid messages' }, 400);

  try {
    const res = await search.chatCompletions({
      messages,
      ai_search_options: { retrieval: { max_num_results: clampResults(body.max_results) } },
    } as AiSearchChatCompletionsRequest);
    const answer = res.choices?.[0]?.message?.content ?? '';
    const chunks = res.chunks ?? [];
    return c.json({
      answer,
      citations: citationsFrom(chunks),
      results: chunks.map(toResult),
      model: res.model,
    });
  } catch (err) {
    log.error('knowledge.ask failed', { err: String(err) });
    return c.json({ error: 'Knowledge answer failed' }, 502);
  }
});

export default knowledge;

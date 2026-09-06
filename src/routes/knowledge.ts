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
//   POST /ask    {question, web?} -> {answer, citations:[...], results, web:[...], mode}
//                 web: 'off' (docs only, AI Search generation) | 'auto' (default:
//                 adds live web search when the question looks external or the
//                 docs return little) | 'on' (always search the web too).
//                 With web sources the answer is generated through callAi
//                 (Claude → OpenAI → Workers AI) over BOTH internal chunks and
//                 fetched pages, internal docs preferred, every claim cited.
//                 (or {messages:[...]} for multi-turn — docs-only path)
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
import { callAi } from '../utils/callAi';
import { webSearch, wantsWeb, webConfigured, type WebSource } from '../utils/webSearch';

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
  return c.json({
    configured, instance: INSTANCE, provider: 'cloudflare-ai-search',
    web: { provider: webConfigured(c.env), modes: ['off', 'auto', 'on'] },
  });
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

type WebMode = 'off' | 'auto' | 'on';
function parseWebMode(v: unknown): WebMode {
  if (v === true || v === 'on' || v === 'always') return 'on';
  if (v === false || v === 'off' || v === 'none') return 'off';
  return 'auto';
}

const HYBRID_SYSTEM = `You are RMPG Flex, the internal knowledge assistant for Rocky Mountain Protective Group, LLC (RMPG), a Utah process-service and protective-services company. You answer for staff on the Flex web app, Flex Kiosk Mode terminals and AI clients.

You are given two kinds of context, each item numbered:
- INTERNAL RMPG DOCUMENTS [I1], [I2], … — SOPs, runbooks, guides, forms, engineering specs. These are authoritative for anything about RMPG procedures, systems, forms and policies.
- WEB SOURCES [W1], [W2], … — live pages fetched from the public internet. Use them for external facts: statutes and court rules, agency contacts, current events, vendor documentation, general knowledge.

Rules:
1. Prefer internal documents whenever they answer the question. Use web sources to fill gaps, supply current external facts, or confirm details — and say when a web source disagrees with an internal document.
2. Cite every factual claim inline with its tag, e.g. "…within 120 days [I2][W1]". Never cite a tag that is not in the context. Do not invent sources, URLs, statutes, fees, deadlines or procedures.
3. If neither context answers the question, say so plainly and suggest what to check (team, system, or official site). Do not guess.
4. Be direct and operational: answer first, then steps. Numbered steps for procedures; short paragraphs otherwise. Keep it under ~250 words unless asked for detail. Kiosk-friendly — no wide tables.
5. Legal / court-procedure content must be reported exactly as the source states it, with its date where present, and recommend confirming with a supervisor or counsel when the source may be superseded.
6. Never repeat SSNs, full dates of birth, financial account numbers or other personal identifiers found in any source.
7. Respond in the user's language; default US English.`;

function buildHybridPrompt(question: string, internal: Chunk[], web: WebSource[]): string {
  const parts: string[] = [];
  parts.push('QUESTION:\n' + question.trim());
  parts.push('\nINTERNAL RMPG DOCUMENTS:');
  if (!internal.length) parts.push('(none matched)');
  internal.forEach((ch, i) => {
    const r = toResult(ch);
    parts.push(`[I${i + 1}] ${r.source}\n${ch.text.trim().slice(0, 2500)}`);
  });
  parts.push('\nWEB SOURCES:');
  if (!web.length) parts.push('(none)');
  web.forEach((w, i) => {
    parts.push(`[W${i + 1}] ${w.title}\nURL: ${w.url}\n${(w.content || w.snippet).trim().slice(0, 3500)}`);
  });
  parts.push('\nAnswer the QUESTION using the rules. Cite with [I#]/[W#] tags.');
  return parts.join('\n\n');
}

knowledge.post('/ask', async (c) => {
  const search = c.env.FLEX_SEARCH;
  if (!search) return notConfigured(c, 'FLEX_SEARCH (AI Search binding)');

  type AskBody = { question?: string; messages?: Array<{ role: string; content: string }>; max_results?: number; web?: unknown };
  const body = await c.req.json<AskBody>().catch(() => ({} as AskBody));
  const webMode = parseWebMode(body.web);
  const maxResults = clampResults(body.max_results);

  // ── Multi-turn (messages[]) — docs-only path via AI Search generation ──
  if (Array.isArray(body.messages) && body.messages.length) {
    const messages = body.messages
      .filter((m) => m && typeof m.content === 'string' && ['user', 'assistant', 'system'].includes(m.role))
      .map((m) => ({ role: m.role as 'user' | 'assistant' | 'system', content: m.content.slice(0, MAX_QUERY_CHARS) }));
    if (!messages.length) return c.json({ error: 'no valid messages' }, 400);
    try {
      const res = await search.chatCompletions({ messages, ai_search_options: { retrieval: { max_num_results: maxResults } } } as AiSearchChatCompletionsRequest);
      const chunks = res.chunks ?? [];
      return c.json({ answer: res.choices?.[0]?.message?.content ?? '', citations: citationsFrom(chunks), results: chunks.map(toResult), web: [], mode: 'docs', model: res.model });
    } catch (err) {
      log.error('knowledge.ask (messages) failed', { err: String(err) });
      return c.json({ error: 'Knowledge answer failed' }, 502);
    }
  }

  const question = (body.question ?? '').toString().trim();
  if (!question) return c.json({ error: 'question (or messages[]) is required' }, 400);
  if (question.length > MAX_QUERY_CHARS) return c.json({ error: `question exceeds ${MAX_QUERY_CHARS} characters` }, 400);

  try {
    // 1. Internal retrieval (always).
    const internalRes = await search.search({ query: question, ai_search_options: { retrieval: { max_num_results: maxResults } } } as AiSearchSearchRequest);
    const internal = internalRes.chunks ?? [];

    // 2. Decide on web. 'auto' → external-looking question OR thin internal hit.
    const useWeb = webMode === 'on' || (webMode === 'auto' && (wantsWeb(question) || internal.length < 3));

    // 3. Docs-only → let AI Search generate (uses the instance system prompt).
    if (!useWeb) {
      const res = await search.chatCompletions({
        messages: [{ role: 'user', content: question }],
        ai_search_options: { retrieval: { max_num_results: maxResults } },
      } as AiSearchChatCompletionsRequest);
      const chunks = res.chunks ?? internal;
      return c.json({ answer: res.choices?.[0]?.message?.content ?? '', citations: citationsFrom(chunks), results: chunks.map(toResult), web: [], mode: 'docs', model: res.model });
    }

    // 4. Hybrid — fetch the web, fuse both contexts through callAi.
    const web = await webSearch(c.env, question, { limit: 5, fetchTop: 3 });
    const prompt = buildHybridPrompt(question, internal.slice(0, 8), web);
    const ai = await callAi(c.env, { system: HYBRID_SYSTEM, text: prompt, maxTokens: 1200 });
    const answer = (ai.text || '').trim();

    return c.json({
      answer: answer || 'No answer could be generated from the available sources.',
      citations: citationsFrom(internal.slice(0, 8)),
      results: internal.slice(0, 8).map(toResult),
      web: web.map((w, i) => ({ tag: `W${i + 1}`, url: w.url, title: w.title, snippet: w.snippet, provider: w.provider })),
      mode: web.length ? 'hybrid' : 'docs+web-unavailable',
      web_provider: webConfigured(c.env),
      model: ai.model,
      provider: ai.provider,
    });
  } catch (err) {
    log.error('knowledge.ask failed', { err: String(err) });
    return c.json({ error: 'Knowledge answer failed' }, 502);
  }
});

export default knowledge;

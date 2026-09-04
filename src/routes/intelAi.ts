// ============================================================
// RMPG Flex — Intel AI engine
// ------------------------------------------------------------
// Claude-powered intelligence over the existing FTS intel_index +
// dossiers. Gated on the configured anthropic_api_key (Admin → API
// Integrations); returns 503 when unset so the UI degrades cleanly.
//
//   POST /ask        {question}                  -> {answer, citations, sources}
//   POST /extract    {text}                      -> {data:{persons,vehicles,locations,links}}
//   POST /summarize  {label, sections}           -> {summary}
//
// `ask` pulls its own context from intel_index (server-side search).
// `extract`/`summarize` take client-supplied context (the narrative /
// the dossier the client already loaded) — no extra schema coupling.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query } from '../utils/db';
import { requireRole } from '../middleware/auth';
import { getAnthropicKey, getClaudeModel, callClaude } from '../utils/anthropic';
import { runIntelLLM } from '../utils/intelLlm';
import { notConfigured } from '../utils/notConfigured';
import {
  ASK_SYSTEM, buildAskPrompt, citationsFrom,
  EXTRACT_SYSTEM, buildExtractPrompt, parseExtract,
  SUMMARY_SYSTEM, buildSummaryPrompt, type IntelHitLite,
} from '../utils/intelAi';

const intelAi = new Hono<Env>();

// /ask runs a server-side FTS query over the WHOLE intel_index and returns
// snippets + citations with no clearance scoping; /extract and /summarize run
// the LLM over intel the caller supplies. All three are CJIS intelligence
// surfaces and must exclude the external contract_manager / client_viewer
// roles, matching intel.ts's `operational` gate. (/health stays open — it only
// reports whether the AI key is configured.)
const operational = requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher');
intelAi.use('/ask', operational);
intelAi.use('/extract', operational);
intelAi.use('/summarize', operational);

/** Top FTS hits from intel_index for the question (LIKE fallback if absent). */
async function topHits(db: ReturnType<typeof getDb>, q: string, limit = 12): Promise<IntelHitLite[]> {
  const terms = q.replace(/[^\w\s]/g, ' ').trim().split(/\s+/).filter(Boolean);
  const fts = terms.map((t) => `${t}*`).join(' OR ');
  if (fts) {
    try {
      const rows = await query<any>(
        db,
        `SELECT entity_type AS type, entity_id AS id, label,
                snippet(intel_index, 3, '[', ']', '…', 12) AS snippet
         FROM intel_index WHERE intel_index MATCH ? ORDER BY bm25(intel_index) LIMIT ?`,
        fts, limit,
      );
      if (rows.length) return rows.map((r) => ({ type: r.type, id: Number(r.id), label: r.label, snippet: r.snippet }));
    } catch { /* index absent → LIKE fallback */ }
  }
  const like = `%${q.slice(0, 48).replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
  const rows = await query<any>(
    db,
    `SELECT id, (first_name || ' ' || last_name) AS label FROM persons
      WHERE (first_name || ' ' || last_name) LIKE ? ESCAPE '\' LIMIT ?`,
    like, limit,
  ).catch(() => [] as any[]);
  return rows.map((r) => ({ type: 'person', id: Number(r.id), label: r.label }));
}

// POST /ask — natural-language question answered from the index, with citations.
intelAi.post('/ask', async (c): Promise<Response> => {
  const body = await c.req.json<{ question?: string }>().catch(() => ({}) as { question?: string });
  const question = (body.question || '').trim();
  if (!question) return c.json({ error: 'question required' }, 400);

  try {
    // topHits hits D1/FTS — keep it inside the try so a DB/index error
    // returns a structured JSON error instead of an uncaught throw (which
    // the Worker would otherwise surface as an opaque 502).
    const hits = await topHits(getDb(c.env), question);
    // runIntelLLM falls back to free Workers AI when Claude is absent or out of
    // credit, and reports which engine answered so the UI can flag a free-tier
    // reply — no more hard 503/502 just because the account is unfunded.
    const { text: reply, engine } = await runIntelLLM(c.env, {
      system: ASK_SYSTEM, text: buildAskPrompt(question, hits), maxTokens: 1024,
    });
    return c.json({ answer: reply, citations: citationsFrom(reply, hits), sources: hits, engine });
  } catch (err: any) {
    // Only reached on a non-LLM failure now (e.g. the FTS query) — the LLM call
    // degrades to Workers AI rather than throwing.
    const detail = String(err?.message || err).slice(0, 200);
    return c.json({ error: `AI request failed: ${detail}`, detail }, 502);
  }
});

// POST /extract — pull structured entities + links out of a narrative.
intelAi.post('/extract', async (c): Promise<Response> => {
  const body = await c.req.json<{ text?: string }>().catch(() => ({}) as { text?: string });
  const text = (body.text || '').trim();
  if (!text) return c.json({ error: 'text required' }, 400);
  try {
    const { text: reply, engine } = await runIntelLLM(c.env, {
      system: EXTRACT_SYSTEM, text: buildExtractPrompt(text), maxTokens: 1024,
    });
    return c.json({ data: parseExtract(reply), engine });
  } catch (err: any) {
    return c.json({ error: 'AI request failed', detail: String(err?.message).slice(0, 200) }, 502);
  }
});

// POST /summarize — Claude dossier summary from client-supplied record sections.
intelAi.post('/summarize', async (c): Promise<Response> => {
  const key = await getAnthropicKey(c.env);
  if (!key) return notConfigured(c, 'anthropic_api_key_unset', { error: 'AI is not configured (set anthropic_api_key)', code: 'NO_AI_KEY' });
  const body = await c.req.json<{ label?: string; sections?: Record<string, any[]> }>()
    .catch(() => ({}) as { label?: string; sections?: Record<string, any[]> });
  const label = (body.label || '').trim() || 'Subject';
  const sections = body.sections || {};
  if (!Object.values(sections).some((v) => Array.isArray(v) && v.length > 0)) {
    return c.json({ error: 'no record sections to summarize' }, 400);
  }
  try {
    const { text: reply, engine } = await runIntelLLM(c.env, {
      system: SUMMARY_SYSTEM, text: buildSummaryPrompt(label, sections), maxTokens: 512,
    });
    return c.json({ summary: reply.trim(), engine });
  } catch (err: any) {
    return c.json({ error: 'AI request failed', detail: String(err?.message).slice(0, 200) }, 502);
  }
});

// GET /health[?test=1] — is the AI engine live? Cheap by default (just reports
// whether the key is configured + the model). ?test=1 does a tiny live call so
// the operator can confirm the key is VALID and the account has credit, without
// burning credit on every page load.
intelAi.get('/health', async (c): Promise<Response> => {
  const key = await getAnthropicKey(c.env);
  const model = await getClaudeModel(c.env);
  if (!key) return c.json({ configured: false, model, ok: false, detail: 'anthropic_api_key not set' });
  if (c.req.query('test') !== '1') return c.json({ configured: true, model, ok: null });
  try {
    const reply = await callClaude(key, { text: 'Reply with the single word: OK', model, maxTokens: 4 });
    return c.json({ configured: true, model, ok: /ok/i.test(reply), reply: reply.slice(0, 40) });
  } catch (err: any) {
    return c.json({ configured: true, model, ok: false, detail: String(err?.message).slice(0, 200) });
  }
});

export default intelAi;

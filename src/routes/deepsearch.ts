// ============================================================
// RMPG Flex — DeepSearch MCP (Gemini 2.5 Flash Deepsearch)
// ============================================================
// Mounted at /api/deepsearch (auth required).
// Calls the Gemini 2.5 Flash Deepsearch model for deep web search.
// Falls back gracefully when GEMINI_API_KEY is unset.
//
// Requires secret: GEMINI_API_KEY (set via wrangler secret put)
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { queryFirst } from '../utils/db';
import { log } from '../utils/logger';

const deepsearch = new Hono<Env>();

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta';

function getApiKey(env: Record<string, unknown>): string | undefined {
  return (env.GEMINI_API_KEY as string | undefined)?.trim() || undefined;
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

deepsearch.get('/health', (c) => {
  const configured = Boolean(getApiKey(c.env as Record<string, unknown>));
  return c.json({ ok: true, configured, source: 'gemini-2.5-flash' });
});

deepsearch.post('/search', async (c) => {
  const apiKey = getApiKey(c.env as Record<string, unknown>);
  if (!apiKey) {
    return c.json({ ok: false, code: 'not_configured', message: 'GEMINI_API_KEY not set' }, 200);
  }

  const body = await c.req.json<{ query: string; site?: string; timeout_ms?: number }>();
  const query = (body.query ?? '').trim();
  if (!query) return c.json({ error: 'query is required' }, 400);

  const timeoutMs = Math.min(body.timeout_ms ?? 30_000, 60_000);

  // Check cache
  const queryKey = await sha256Hex(`deepsearch:${query}:${body.site ?? ''}`);
  const cached = await queryFirst<{
    results_json: string; expires_at: string;
  }>(c.env.DB,
    `SELECT results_json, expires_at FROM osint_cache
     WHERE source = 'deepsearch' AND query_key = ? AND expires_at > datetime('now')`,
    queryKey,
  );
  if (cached) {
    return c.json({ ...JSON.parse(cached.results_json), cached: true });
  }

  // Build prompt — instruct Gemini to perform a deep search
  const searchPrompt = body.site
    ? `Search specifically on ${body.site} for: ${query}. Return comprehensive results with titles, URLs, and summaries.`
    : `Perform a deep web search for: ${query}. Return comprehensive results with titles, URLs, and summaries. Focus on authoritative, recent sources.`;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(
        `${GEMINI_API}/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: searchPrompt }] }],
            tools: [{ googleSearch: {} }],
            generationConfig: {
              temperature: 0.1,
              maxOutputTokens: 8192,
            },
          }),
          signal: ctrl.signal,
        },
      );
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => 'unknown');
      log.error('[deepsearch] Gemini API error', { status: res.status, errText });
      return c.json({ ok: false, error: `Gemini API returned ${res.status}`, detail: errText }, 502);
    }

    const data = await res.json() as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
        groundingMetadata?: {
          groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
          groundingSupports?: Array<{ segment?: { text?: string }; groundingChunkIndices?: number[] }>;
        };
      }>;
    };

    const candidate = data.candidates?.[0];
    const text = candidate?.content?.parts?.map((p) => p.text ?? '').join('\n') ?? '';
    const chunks = candidate?.groundingMetadata?.groundingChunks ?? [];
    const supports = candidate?.groundingMetadata?.groundingSupports ?? [];

    // Build structured results from grounding metadata
    const results = chunks.map((chunk, i) => {
      const support = supports.find((s) => s.groundingChunkIndices?.includes(i));
      return {
        url: chunk.web?.uri ?? '',
        title: chunk.web?.title ?? '',
        snippet: support?.segment?.text ?? '',
      };
    }).filter((r) => r.url);

    const payload = {
      ok: true,
      query,
      answer: text,
      sources: results,
      source_count: results.length,
      searched_at: new Date().toISOString(),
    };

    // Cache for 1 hour
    await c.env.DB.prepare(
      `INSERT OR REPLACE INTO osint_cache (source, query_key, query_text, results_json, user_id, expires_at)
       VALUES ('deepsearch', ?, ?, ?, ?, datetime('now', '+1 hour'))`,
    ).bind(
      queryKey,
      query,
      JSON.stringify(payload),
      (c.get('user') as any)?.id ?? null,
    ).run().catch((err) => log.error('[deepsearch] cache write failed', {}, err));

    return c.json(payload);
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return c.json({ ok: false, error: 'Search timed out' }, 504);
    }
    log.error('[deepsearch] search failed', { query }, err);
    return c.json({ ok: false, error: 'Search failed', detail: err?.message }, 500);
  }
});

deepsearch.get('/history', async (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10) || 50, 200);
  const { results } = await c.env.DB.prepare(
    `SELECT id, query_text, created_at, expires_at FROM osint_cache
     WHERE source = 'deepsearch' ORDER BY created_at DESC LIMIT ?`,
  ).bind(limit).all();
  return c.json(results);
});

export default deepsearch;

// ============================================================
// /api/ai — Dispatch AI (Workers AI)
// ============================================================
// Real GPS-aware dispatch intelligence backed by the account's Workers
// AI binding (env.AI). Two working endpoints:
//   POST /ai/suggest-units  — rank available units by LIVE fresh GPS,
//                             then LLM-pick + justify the best responders.
//   POST /ai/analyze        — safety briefing / flags / severity for a call.
//
// The dashboard GETs (/config /status /stats /health /activity) report the
// Workers-AI provider so the admin AI panels render an enabled state. Usage
// metering (/stats, /activity) is still a stub — wiring an ai_activity_log
// is a follow-up; those return zeros/empty rather than 404.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst } from '../utils/db';
import { requireRole } from '../middleware/auth';
import {
  rankUnitsForCall, suggestUnits, analyzeCall, narrativeAssist, smartSearch,
  GPS_FRESH_WINDOW_S, type RawUnit, type CallContext,
} from '../utils/dispatchAi';

const ai = new Hono<Env>();

const READ_ROLES = ['admin', 'manager', 'supervisor', 'officer', 'dispatcher'];

ai.get('/config', (c) => c.json({
  provider: 'workers-ai',
  autoFallback: true,
  features: {
    callAnalysis: true,
    narrativeAssist: true,
    smartSearch: true,
    unitSuggestions: true,
    safetyBriefings: true,
    dataCleanup: false,
    systemMonitoring: false,
  },
  providers: {
    'workers-ai': { model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' },
    groq:   { apiKey: '', model: '' },
    gemini: { apiKey: '', model: '' },
    openai: { apiKey: '', model: '', baseUrl: '' },
    ollama: { url: '', model: '' },
  },
}));

ai.get('/stats', (c) => c.json({
  requestsToday: 0,
  requestsThisWeek: 0,
  requestsThisMonth: 0,
  avgResponseMs: 0,
  cacheHitRate: 0,
  totalRequests: 0,
}));

ai.get('/status', (c) => c.json({
  provider: 'workers-ai',
  available: true,
  model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  providers: [{ name: 'workers-ai', available: true, model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' }],
}));

ai.get('/health', (c) => c.json({
  ok: true,
  status: 'ready',
  providers: ['workers-ai'],
  message: 'Workers AI dispatch intelligence enabled',
}));

ai.get('/activity', (c) => c.json([] as Array<{
  id: number; task_type: string; provider: string; latency_ms: number;
  status: string; prompt_preview: string; created_at: string;
}>));

ai.get('/dev-chat/history', (c) => c.json([]));

// ============================================================
// GET /ai/test/:provider — connectivity probe (admin/manager)
// ============================================================
// AIProvidersPanel + AICommandCenterPanel render a "Test" button per
// configured external provider (groq/gemini/openai/ollama). The button
// expects `{ ok, latencyMs, error? }` — the TestResult contract in
// AISharedComponents.tsx. Prior to this handler the endpoint 404'd, so
// the panel's per-provider connectivity indicator was permanently red.
//
// Implementation: fire a single low-cost HTTP probe to each provider's
// /models endpoint (or /api/tags for Ollama) with the saved API key.
// 200 response → ok:true. Anything else → ok:false + error. 8s timeout
// per probe so a stuck provider can't hang the admin tab. The key lives
// in system_config under `ai.provider.<name>` (set by the panel's Save).
// If no key is configured, return a clear "No API key configured" error
// rather than throwing on the missing Authorization header.
//
// Ollama lives on localhost or a LAN address; CF Workers cannot reach
// private network space. Detect that and return a clear honest error
// instead of a misleading timeout — the panel surfaces the message
// straight to the admin so they understand the architectural limit.
const KNOWN_PROVIDERS = new Set(['groq', 'gemini', 'openai', 'ollama']);
const PROBE_TIMEOUT_MS = 8000;
function isPrivateHost(hostname: string): boolean {
  if (!hostname) return false;
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' || h === '::1') return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(h)) return true;
  if (h.endsWith('.local')) return true;
  return false;
}

ai.get('/test/:provider', requireRole('admin', 'manager'), async (c): Promise<Response> => {
  const provider = c.req.param('provider') ?? '';
  if (!provider || !KNOWN_PROVIDERS.has(provider)) {
    return c.json({ ok: false, latencyMs: 0, error: `Unknown provider "${provider}"` }, 400);
  }

  // Load this provider's saved config from system_config. The Save handler
  // stores each provider's settings as one JSON-encoded row under
  // `ai.provider.<name>`. Missing row → empty object → "no key configured".
  let cfg: { apiKey?: string; url?: string; baseUrl?: string; model?: string } = {};
  try {
    const db = getDb(c.env);
    const row = await queryFirst<{ config_value: string }>(db,
      `SELECT config_value FROM system_config
       WHERE config_key = ? AND is_active = 1
       ORDER BY id DESC LIMIT 1`,
      `ai.provider.${provider}`);
    if (row?.config_value) {
      try { cfg = JSON.parse(row.config_value) ?? {}; } catch { /* leave empty */ }
    }
  } catch { /* DB unavailable — treat as no config */ }

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), PROBE_TIMEOUT_MS);
  const start = Date.now();
  try {
    let res: Response;
    switch (provider) {
      case 'groq': {
        if (!cfg.apiKey) throw new Error('No API key configured for Groq');
        res = await fetch('https://api.groq.com/openai/v1/models', {
          headers: { Authorization: `Bearer ${cfg.apiKey}` },
          signal: ctl.signal,
        });
        break;
      }
      case 'gemini': {
        if (!cfg.apiKey) throw new Error('No API key configured for Gemini');
        res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(cfg.apiKey)}`,
          { signal: ctl.signal });
        break;
      }
      case 'openai': {
        if (!cfg.apiKey) throw new Error('No API key configured for OpenAI');
        const rawBase = cfg.baseUrl && /^https?:\/\//i.test(cfg.baseUrl) ? cfg.baseUrl : 'https://api.openai.com/v1';
        const base = rawBase.replace(/\/$/, '');
        res = await fetch(`${base}/models`, {
          headers: { Authorization: `Bearer ${cfg.apiKey}` },
          signal: ctl.signal,
        });
        break;
      }
      case 'ollama': {
        const url = cfg.url && /^https?:\/\//i.test(cfg.url) ? cfg.url : 'http://localhost:11434';
        let host = '';
        try { host = new URL(url).hostname; } catch { /* leave empty */ }
        if (!host || isPrivateHost(host)) {
          throw new Error('Ollama at private/local address is not reachable from Cloudflare Workers — configure a public URL or run a tunnel');
        }
        res = await fetch(`${url.replace(/\/$/, '')}/api/tags`, { signal: ctl.signal });
        break;
      }
      default:
        throw new Error(`Unknown provider "${provider}"`);
    }
    if (!res.ok) {
      throw new Error(`Provider returned HTTP ${res.status}`);
    }
    return c.json({ ok: true, latencyMs: Date.now() - start });
  } catch (err) {
    const msg = (err as Error).name === 'AbortError'
      ? `Provider did not respond within ${PROBE_TIMEOUT_MS}ms`
      : ((err as Error).message || 'Probe failed');
    return c.json({ ok: false, latencyMs: Date.now() - start, error: msg });
  } finally {
    clearTimeout(timer);
  }
});

// ─── POST /ai/suggest-units ─────────────────────────────────
// Body: { callId } (server fetches fresh-GPS units) OR { call, units }.
// Returns LLM-picked suggestions + the deterministic candidate ranking.
ai.post('/suggest-units', requireRole(...READ_ROLES), async (c) => {
  try {
    const body = await c.req.json().catch(() => ({} as any));
    const db = getDb(c.env);

    let call: CallContext | null = null;
    let units: RawUnit[] = [];

    if (body.callId != null) {
      const id = parseInt(String(body.callId), 10);
      const row = await queryFirst<{ id: number; call_number: string | null; incident_type: string | null; priority: string | null; location_address: string | null; latitude: number | null; longitude: number | null }>(
        db, 'SELECT id, call_number, incident_type, priority, location_address, latitude, longitude FROM calls_for_service WHERE id = ?', id);
      if (!row) return c.json({ error: 'Call not found', code: 'CALL_NOT_FOUND' }, 404);
      if (row.latitude == null || row.longitude == null) {
        return c.json({ callId: id, suggestions: [], candidates: [], reason: 'NO_CALL_GPS' });
      }
      call = { ...row, latitude: row.latitude, longitude: row.longitude, flags: [] };
      units = await query<RawUnit>(db, `
        SELECT u.id, u.call_sign, u.status, u.latitude, u.longitude, u.gps_updated_at,
               usr.full_name AS officer_name
        FROM units u LEFT JOIN users usr ON usr.id = u.officer_id
        WHERE u.status IN ('available', 'on_patrol', 'dispatched')
          AND u.latitude IS NOT NULL AND u.longitude IS NOT NULL
      `);
    } else if (body.call && body.call.latitude != null && body.call.longitude != null) {
      call = body.call as CallContext;
      units = Array.isArray(body.units) ? (body.units as RawUnit[]) : [];
    } else {
      return c.json({ error: 'Provide callId or call{latitude,longitude}', code: 'BAD_INPUT' }, 400);
    }

    const candidates = rankUnitsForCall(call, units, GPS_FRESH_WINDOW_S, 8);
    const ai_result = await suggestUnits(c.env.AI, call, candidates);

    return c.json({
      callId: call.id ?? null,
      provider: ai_result.provider,
      fallback: ai_result.fallback,
      freshWindowSeconds: GPS_FRESH_WINDOW_S,
      suggestions: ai_result.suggestions,
      candidates,
    });
  } catch (err) {
    console.error('[ai] suggest-units error', err);
    return c.json({ error: 'Failed to suggest units', code: 'SUGGEST_ERR' }, 500);
  }
});

// ─── POST /ai/analyze ───────────────────────────────────────
// Body: { callId } OR { incident_type, priority, location_address, latitude,
// longitude, flags }. Returns a safety briefing + flags + severity.
ai.post('/analyze', requireRole(...READ_ROLES), async (c) => {
  try {
    const body = await c.req.json().catch(() => ({} as any));
    const db = getDb(c.env);
    let call: CallContext;

    if (body.callId != null) {
      const id = parseInt(String(body.callId), 10);
      const row = await queryFirst<{ id: number; incident_type: string | null; priority: string | null; location_address: string | null; latitude: number | null; longitude: number | null }>(
        db, 'SELECT id, incident_type, priority, location_address, latitude, longitude FROM calls_for_service WHERE id = ?', id);
      if (!row) return c.json({ error: 'Call not found', code: 'CALL_NOT_FOUND' }, 404);
      call = { ...row, latitude: row.latitude ?? 0, longitude: row.longitude ?? 0, flags: [] };
    } else {
      call = {
        incident_type: body.incident_type ?? null,
        priority: body.priority ?? null,
        location_address: body.location_address ?? null,
        latitude: Number(body.latitude) || 0,
        longitude: Number(body.longitude) || 0,
        flags: Array.isArray(body.flags) ? body.flags.map(String) : [],
      };
    }

    const analysis = await analyzeCall(c.env.AI, call);
    return c.json(analysis);
  } catch (err) {
    console.error('[ai] analyze error', err);
    return c.json({ error: 'Failed to analyze call', code: 'ANALYZE_ERR' }, 500);
  }
});

// ─── POST /ai/narrative ─────────────────────────────────────
// Body: { notes, incident_type?, location_address? }
// Returns a plain-text narrative paragraph drafted from the caller's
// notes + context. Powers the NarrativeAssist client component.
ai.post('/narrative', requireRole(...READ_ROLES), async (c) => {
  try {
    const body = await c.req.json().catch(() => ({} as any));
    if (!body.notes || typeof body.notes !== 'string' || body.notes.trim().length < 10) {
      return c.json({ error: 'At least 10 characters of notes required', code: 'NARR_SHORT' }, 400);
    }
    const result = await narrativeAssist(
      c.env.AI,
      body.notes,
      body.incident_type,
      body.location_address,
    );
    return c.json({
      narrative: result.narrative,
      provider: result.provider,
      fallback: result.fallback,
    });
  } catch (err) {
    console.error('[ai] narrative error', err);
    return c.json({ error: 'Failed to generate narrative', code: 'NARR_ERR' }, 500);
  }
});

// ─── POST /ai/smart-search ───────────────────────────────────
// Body: { query, searchType }
// Parses a natural-language search string into structured DB-column
// filters. Powers the AISearchButton client component.
ai.post('/smart-search', requireRole(...READ_ROLES), async (c) => {
  try {
    const body = await c.req.json().catch(() => ({} as any));
    if (!body.query || typeof body.query !== 'string' || !body.query.trim()) {
      return c.json({ error: 'Search query required', code: 'SEARCH_NO_QUERY' }, 400);
    }
    const searchType = String(body.searchType || 'persons');
    if (!['persons', 'vehicles', 'incidents'].includes(searchType)) {
      return c.json({ error: 'searchType must be persons, vehicles, or incidents', code: 'SEARCH_BAD_TYPE' }, 400);
    }
    const result = await smartSearch(c.env.AI, body.query, searchType);
    return c.json({
      available: !result.fallback,
      filters: result.filters,
      provider: result.provider,
      fallback: result.fallback,
    });
  } catch (err) {
    console.error('[ai] smart-search error', err);
    return c.json({ error: 'Failed to parse search query', code: 'SEARCH_ERR' }, 500);
  }
});

// ─── POST /ai/refine ─────────────────────────────────────────
// Body: { text: string, action: string }
// AI-powered document text refinement for law enforcement writing.
// Actions map to domain-specific system prompts.
ai.post('/refine', requireRole(...READ_ROLES), async (c) => {
  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  const action = typeof body.action === 'string' ? body.action.trim() : '';
  if (!text || text.length < 5) {
    return c.json({ error: 'Text is required (min 5 chars)', code: 'REFINE_NO_TEXT' }, 400);
  }
  if (text.length > 8000) {
    return c.json({ error: 'Text too long (max 8000 chars)', code: 'REFINE_TOO_LONG' }, 400);
  }

  const SYSTEM_PROMPTS: Record<string, string> = {
    'improve-clarity':
      'You are a law enforcement writing editor. Rewrite the provided text to be clearer, more direct, and easier to understand while preserving all factual content and legal significance. Use plain, precise language. Return only the rewritten text with no commentary.',
    'formal-legal-tone':
      'You are a legal writing specialist. Rewrite the provided text in a formal legal tone appropriate for court filings, sworn affidavits, and official law enforcement records. Use precise legal terminology. Return only the rewritten text with no commentary.',
    'probable-cause':
      'You are a law enforcement legal writing specialist. Rewrite the provided text to strengthen the articulation of probable cause. Emphasize specific articulable facts, the officer\'s training and experience, and how observed facts connect to criminal activity. Use language that meets the Fourth Amendment probable cause standard. Return only the rewritten text with no commentary.',
    'first-person':
      'You are a law enforcement report editor. Rewrite the provided text in first-person active voice (I observed, I contacted, I placed), past tense, as if written by the responding officer. Maintain all factual accuracy. Return only the rewritten text with no commentary.',
    'summarize':
      'You are a law enforcement records specialist. Write a concise summary (2-4 sentences) of the key facts and outcome described in the provided text, suitable for a case synopsis or brief. Return only the summary with no commentary.',
    'expand':
      'You are a law enforcement report writing assistant. Expand the provided text with additional detail, context, and professional narrative language typical of thorough police reports. Add relevant detail without inventing facts — use placeholder brackets like [detail] for specifics the officer should fill in. Return only the expanded text with no commentary.',
    'brevity':
      'You are a law enforcement writing editor. Rewrite the provided text to be more concise while preserving all legally significant facts and details. Remove redundancy, passive voice, and filler phrases. Return only the concise rewrite with no commentary.',
    'miranda-check':
      'You are a law enforcement legal compliance specialist. Review the provided Miranda rights advisement text and rewrite it to ensure it meets the standard Miranda warning requirements (right to remain silent, statements may be used against them, right to an attorney, right to appointed counsel). Make it clear, complete, and legally sufficient. Return only the corrected advisement text with no commentary.',
  };

  const systemPrompt = SYSTEM_PROMPTS[action];
  if (!systemPrompt) {
    return c.json({ error: `Unknown action: ${action}`, code: 'REFINE_BAD_ACTION' }, 400);
  }

  try {
    const response = await (c.env.AI as Ai).run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text },
      ],
    }) as { response?: string };
    const result = response?.response?.trim() ?? '';
    if (!result) return c.json({ error: 'AI returned empty response', code: 'REFINE_EMPTY' }, 500);
    return c.json({ result, action });
  } catch (err) {
    console.error('[ai] refine error', err);
    return c.json({ error: 'Failed to refine text', code: 'REFINE_ERR' }, 500);
  }
});

export default ai;

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
import { getDb, query, queryFirst, execute } from '../utils/db';
import { requireRole } from '../middleware/auth';
import { ACTIVE_CALL_WHERE } from '../utils/callStatus';
import { log } from '../utils/logger';
import {
  rankUnitsForCall, suggestUnits, analyzeCall, narrativeAssist, smartSearch,
  GPS_FRESH_WINDOW_S, type RawUnit, type CallContext,
} from '../utils/dispatchAi';

const ai = new Hono<Env>();

const READ_ROLES = ['admin', 'manager', 'supervisor', 'officer', 'dispatcher'];

// ── Config storage helpers (system_config, category 'integrations') ──
// Same DELETE-then-INSERT upsert pattern used by clearpathGps.ts/traccar.ts
// — system_config's UNIQUE is the composite (config_key, config_value), not
// config_key alone, so ON CONFLICT(config_key) throws.
async function getConfigValue(db: D1Database, key: string): Promise<string | null> {
  try {
    const row = await queryFirst<{ config_value: string }>(db,
      "SELECT config_value FROM system_config WHERE config_key = ? AND category = 'integrations' AND is_active = 1 LIMIT 1",
      key);
    return row?.config_value ?? null;
  } catch { return null; }
}
async function setConfigValue(db: D1Database, key: string, value: string): Promise<void> {
  await execute(db, "DELETE FROM system_config WHERE config_key = ? AND category = 'integrations'", key);
  await execute(db,
    "INSERT INTO system_config (config_key, config_value, category, is_active) VALUES (?, ?, 'integrations', 1)",
    key, value);
}
async function getJsonConfig<T>(db: D1Database, key: string, fallback: T): Promise<T> {
  const raw = await getConfigValue(db, key);
  if (!raw) return fallback;
  try { return { ...fallback, ...JSON.parse(raw) }; } catch { return fallback; }
}

// Shared Workers-AI model — single source of truth for all endpoints in this
// file.  Aligns with dispatchAi.ts LLM_MODEL.  When the admin panel stores a
// custom model in ai.config, callers can read it; these two hard-coded sites
// are the fallback for endpoints that predate the config system.
const WORKERS_AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

const DEFAULT_FEATURES = {
  callAnalysis: true, narrativeAssist: true, smartSearch: true,
  unitSuggestions: true, safetyBriefings: true, dataCleanup: false, systemMonitoring: false,
};
const DEFAULT_PROVIDERS_META = {
  groq: { model: '' }, gemini: { model: '' },
  openai: { model: '', baseUrl: '' }, ollama: { url: '', model: '' },
};

// GET /ai/config — real saved config. Per-provider API keys read from
// `ai.provider.<name>` (the same rows GET /ai/test/:provider already reads)
// but MASKED (never echoed back in plaintext) — the panel's own dirty-check
// treats a masked value as "unchanged" (`!groqKey.includes('•')`).
ai.get('/config', async (c) => {
  const db = getDb(c.env);
  const top = await getJsonConfig(db, 'ai.config', {
    provider: 'workers-ai', autoFallback: true, features: DEFAULT_FEATURES,
  });
  const providers: Record<string, any> = { 'workers-ai': { model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' } };
  for (const name of ['groq', 'gemini', 'openai', 'ollama']) {
    const raw = await getConfigValue(db, `ai.provider.${name}`);
    let cfg: Record<string, unknown> = {};
    try { cfg = raw ? JSON.parse(raw) : {}; } catch { cfg = {}; }
    providers[name] = {
      ...(DEFAULT_PROVIDERS_META as any)[name],
      ...cfg,
      apiKey: cfg.apiKey ? '••••••••' : '',
    };
  }
  return c.json({ ...top, providers });
});

// PUT /ai/config — save top-level provider/autoFallback/features + each
// provider's model/url/baseUrl config. An apiKey is only overwritten when
// the client sends a real (non-masked) value — AIProvidersPanel already
// strips the masked placeholder before sending, but this is defense in
// depth against ever persisting the mask string itself as a "key".
ai.put('/config', requireRole('admin', 'manager'), async (c) => {
  try {
    const db = getDb(c.env);
    const body = await c.req.json<{
      provider?: string; autoFallback?: boolean; features?: Record<string, boolean>;
      providers?: Record<string, { apiKey?: string; model?: string; baseUrl?: string; url?: string }>;
    }>().catch(() => ({} as Record<string, never>));

    const existingTop = await getJsonConfig(db, 'ai.config', { provider: 'workers-ai', autoFallback: true, features: DEFAULT_FEATURES });
    const nextTop = {
      provider: body.provider ?? existingTop.provider,
      autoFallback: body.autoFallback ?? existingTop.autoFallback,
      features: { ...existingTop.features, ...(body.features || {}) },
    };
    await setConfigValue(db, 'ai.config', JSON.stringify(nextTop));

    if (body.providers) {
      for (const [name, incoming] of Object.entries(body.providers)) {
        if (!['groq', 'gemini', 'openai', 'ollama'].includes(name)) continue;
        const raw = await getConfigValue(db, `ai.provider.${name}`);
        let existing: Record<string, unknown> = {};
        try { existing = raw ? JSON.parse(raw) : {}; } catch { existing = {}; }
        const next: Record<string, unknown> = { ...existing };
        if (incoming.model !== undefined) next.model = incoming.model;
        if (incoming.baseUrl !== undefined) next.baseUrl = incoming.baseUrl;
        if (incoming.url !== undefined) next.url = incoming.url;
        if (incoming.apiKey && !incoming.apiKey.includes('•')) next.apiKey = incoming.apiKey;
        await setConfigValue(db, `ai.provider.${name}`, JSON.stringify(next));
      }
    }
    return c.json({ success: true, config: { ...nextTop, providers: body.providers || {} } });
  } catch (err) {
    log.error('PUT /config failed', { src: 'ai.ts' }, err as Error);
    return c.json({ error: 'Failed to save AI config' }, 500);
  }
});

// GET/PUT /ai/behavior — flat JSON blob (response style, tone, safety
// filter, rate limits) consumed by AIBehaviorPanel.
ai.get('/behavior', async (c) => {
  const db = getDb(c.env);
  return c.json(await getJsonConfig(db, 'ai.behavior', {
    responseStyle: 'balanced', tone: 'professional', safetyFilter: 'moderate',
    rateLimit: 25, maxConcurrent: 3, requestTimeout: 120, autoRetry: true, retryCount: 2,
  }));
});
ai.put('/behavior', requireRole('admin', 'manager'), async (c) => {
  try {
    const db = getDb(c.env);
    const body = await c.req.json().catch(() => ({}));
    await setConfigValue(db, 'ai.behavior', JSON.stringify(body));
    return c.json({ success: true });
  } catch (err) {
    log.error('PUT /behavior failed', { src: 'src/routes/ai.ts' }, err);
    return c.json({ error: 'Failed to save behavior config' }, 500);
  }
});

// GET/PUT /ai/master-config — system prompt, chain mode, task routing
// rules, provider priority. Consumed by AIMasterConfigPanel,
// AIProvidersPanel (priority) and AICapabilitiesPanel (routing).
ai.get('/master-config', async (c) => {
  const db = getDb(c.env);
  return c.json(await getJsonConfig(db, 'ai.master-config', {
    masterPrompt: '', chainMode: false,
    routingRules: {} as Record<string, { provider: string }>,
    providerPriority: ['groq', 'gemini', 'openai', 'ollama'],
  }));
});
ai.put('/master-config', requireRole('admin', 'manager'), async (c) => {
  try {
    const db = getDb(c.env);
    const body = await c.req.json().catch(() => ({}));
    const existing = await getJsonConfig(db, 'ai.master-config', {
      masterPrompt: '', chainMode: false, routingRules: {}, providerPriority: ['groq', 'gemini', 'openai', 'ollama'],
    });
    const merged = { ...existing, ...body, routingRules: { ...existing.routingRules, ...(body as any).routingRules } };
    await setConfigValue(db, 'ai.master-config', JSON.stringify(merged));
    return c.json({ success: true });
  } catch (err) {
    log.error('PUT /master-config failed', { src: 'src/routes/ai.ts' }, err);
    return c.json({ error: 'Failed to save master config' }, 500);
  }
});

// GET/PUT /ai/model-params — default sampling params + per-feature overrides.
ai.get('/model-params', async (c) => {
  const db = getDb(c.env);
  return c.json(await getJsonConfig(db, 'ai.model-params', {
    defaultParams: { temperature: 0.7, maxTokens: 1024, topP: 0.9, repeatPenalty: 1.0 },
    featureParams: {} as Record<string, Record<string, number | null>>,
  }));
});
ai.put('/model-params', requireRole('admin', 'manager'), async (c) => {
  try {
    const db = getDb(c.env);
    const body = await c.req.json().catch(() => ({}));
    await setConfigValue(db, 'ai.model-params', JSON.stringify(body));
    return c.json({ success: true });
  } catch (err) {
    log.error('PUT /model-params failed', { src: 'src/routes/ai.ts' }, err);
    return c.json({ error: 'Failed to save model params' }, 500);
  }
});

// ── Model tuning presets (ai_model_presets, migration 0199) ──
ai.get('/presets', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db,
      'SELECT id, name, temperature, max_tokens AS maxTokens, top_p AS topP, repeat_penalty AS repeatPenalty FROM ai_model_presets ORDER BY id DESC');
    return c.json(rows);
  } catch { return c.json([]); }
});
ai.post('/presets', requireRole('admin', 'manager'), async (c) => {
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number | undefined;
    const body = await c.req.json<{ name?: string; temperature?: number; maxTokens?: number; topP?: number; repeatPenalty?: number }>().catch(() => ({} as Record<string, never>));
    if (!body.name?.trim()) return c.json({ error: 'name is required' }, 400);
    const r = await execute(db,
      'INSERT INTO ai_model_presets (name, temperature, max_tokens, top_p, repeat_penalty, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      body.name.trim(), body.temperature ?? 0.7, body.maxTokens ?? 1024, body.topP ?? 0.9, body.repeatPenalty ?? 1.0, userId ?? null);
    return c.json({ success: true, id: r.meta.last_row_id });
  } catch (err) {
    log.error('POST /presets failed', { src: 'src/routes/ai.ts' }, err);
    return c.json({ error: 'Failed to save preset' }, 500);
  }
});
ai.delete('/presets/:id', requireRole('admin', 'manager'), async (c) => {
  try {
    const db = getDb(c.env);
    await execute(db, 'DELETE FROM ai_model_presets WHERE id = ?', c.req.param('id'));
    return c.json({ success: true });
  } catch (err) {
    log.error('DELETE /presets/:id failed', { src: 'src/routes/ai.ts' }, err);
    return c.json({ error: 'Failed to delete preset' }, 500);
  }
});

// ── Prompt templates (ai_prompt_templates, migration 0199) ──
ai.get('/templates', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query(db, 'SELECT * FROM ai_prompt_templates ORDER BY category, name');
    return c.json(rows);
  } catch { return c.json([]); }
});
ai.post('/templates', requireRole('admin', 'manager'), async (c) => {
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number | undefined;
    const body = await c.req.json<{ name?: string; category?: string; system_prompt?: string; user_message?: string }>().catch(() => ({} as Record<string, never>));
    if (!body.name?.trim()) return c.json({ error: 'name is required' }, 400);
    const r = await execute(db,
      'INSERT INTO ai_prompt_templates (name, category, system_prompt, user_message, created_by) VALUES (?, ?, ?, ?, ?)',
      body.name.trim(), body.category || 'general', body.system_prompt || '', body.user_message || '', userId ?? null);
    return c.json({ success: true, id: r.meta.last_row_id });
  } catch (err) {
    log.error('POST /templates failed', { src: 'src/routes/ai.ts' }, err);
    return c.json({ error: 'Failed to save template' }, 500);
  }
});
ai.put('/templates/:id', requireRole('admin', 'manager'), async (c) => {
  try {
    const db = getDb(c.env);
    const body = await c.req.json<{ name?: string; category?: string }>().catch(() => ({} as Record<string, never>));
    const sets: string[] = []; const vals: unknown[] = [];
    if (body.name !== undefined) { sets.push('name = ?'); vals.push(body.name); }
    if (body.category !== undefined) { sets.push('category = ?'); vals.push(body.category); }
    if (!sets.length) return c.json({ success: true });
    sets.push("updated_at = datetime('now')");
    vals.push(c.req.param('id'));
    await execute(db, `UPDATE ai_prompt_templates SET ${sets.join(', ')} WHERE id = ?`, ...vals);
    return c.json({ success: true });
  } catch (err) {
    log.error('PUT /templates/:id failed', { src: 'src/routes/ai.ts' }, err);
    return c.json({ error: 'Failed to update template' }, 500);
  }
});
ai.delete('/templates/:id', requireRole('admin', 'manager'), async (c) => {
  try {
    const db = getDb(c.env);
    await execute(db, 'DELETE FROM ai_prompt_templates WHERE id = ?', c.req.param('id'));
    return c.json({ success: true });
  } catch (err) {
    log.error('DELETE /templates/:id failed', { src: 'src/routes/ai.ts' }, err);
    return c.json({ error: 'Failed to delete template' }, 500);
  }
});

// POST /ai/prompt-test — real Workers AI call (AIPromptWorkshopPanel's
// "Run"/"Compare" buttons). Mirrors the ai.run() pattern already used by
// suggest-units/analyze/narrative in src/utils/dispatchAi.ts.
ai.post('/prompt-test', requireRole('admin', 'manager', 'supervisor'), async (c) => {
  try {
    const body = await c.req.json<{ systemPrompt?: string; userMessage?: string; temperature?: number | null }>().catch(() => ({} as Record<string, never>));
    const messages: { role: string; content: string }[] = [];
    if (body.systemPrompt?.trim()) messages.push({ role: 'system', content: body.systemPrompt.trim() });
    if (body.userMessage?.trim()) messages.push({ role: 'user', content: body.userMessage.trim() });
    if (messages.length === 0) return c.json({ error: 'systemPrompt or userMessage is required' }, 400);

    const start = Date.now();
    const res = (await c.env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: messages as never,
      max_tokens: 512,
      temperature: typeof body.temperature === 'number' ? body.temperature : 0.7,
    } as never)) as { response?: string };
    return c.json({ content: res?.response || '', latencyMs: Date.now() - start });
  } catch (err) {
    log.error('[AI] prompt-test failed', { src: 'ai.ts' }, err as Error);
    return c.json({ error: err instanceof Error ? err.message : 'Prompt test failed' }, 500);
  }
});

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

// GET /ai/health — real D1-derived health snapshot. Consumed by BOTH
// AICommandCenterPanel (server.uptime_hours/memory_rss_mb, websocket.
// active_connections tiles) and AIIntelligencePanel (the fuller report) —
// both want the SAME rich shape, so the old flat {ok,status,providers,
// message} stub was actually wrong for both, not just one. Workers has no
// process/host metrics (uptime, RSS, live WS connection count), so those
// stay 0 rather than fabricated — same honest-when-unavailable pattern as
// admin.ts's system-overview endpoint.
ai.get('/health', async (c) => {
  try {
    const db = getDb(c.env);
    const cnt = async (sql: string) => (await queryFirst<{ n: number }>(db, sql).catch(() => null))?.n ?? 0;
    const tblSizeRow = await queryFirst<{ page_count: number; page_size: number }>(db,
      'PRAGMA page_count').catch(() => null);
    const pageSizeRow = await queryFirst<{ page_size: number }>(db, 'PRAGMA page_size').catch(() => null);
    const sizeMb = ((tblSizeRow?.page_count ?? 0) * (pageSizeRow?.page_size ?? 4096)) / (1024 * 1024);
    const [calls, persons, units] = await Promise.all([
      cnt(`SELECT COUNT(*) AS n FROM calls_for_service WHERE ${ACTIVE_CALL_WHERE}`),
      cnt('SELECT COUNT(*) AS n FROM persons'),
      cnt('SELECT COUNT(*) AS n FROM units'),
    ]);
    const issues: string[] = [];
    if (!c.env.AI) issues.push('Workers AI binding is not available on this environment');
    return c.json({
      ok: true,
      status: issues.length ? 'degraded' : 'ready',
      server: { uptime_hours: 0, memory_rss_mb: 0 },
      database: { size_mb: Math.round(sizeMb * 100) / 100, integrity: 'ok', record_counts: { calls_for_service: calls, persons, units } },
      websocket: { active_connections: 0 },
      ai: { provider: 'workers-ai', available: !!c.env.AI },
      issues,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    log.error('[AI] health check failed', { src: 'ai.ts' }, err as Error);
    return c.json({ ok: false, status: 'error', issues: ['Health check failed'], timestamp: new Date().toISOString() });
  }
});

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
    log.error('[ai] suggest-units error', { src: 'ai.ts' }, err as Error);
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
    log.error('[ai] analyze error', { src: 'ai.ts' }, err as Error);
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
    log.error('[ai] narrative error', { src: 'ai.ts' }, err as Error);
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
    log.error('[ai] smart-search error', { src: 'ai.ts' }, err as Error);
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
    const response = await (c.env.AI as Ai).run(WORKERS_AI_MODEL, {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text },
      ],
    }) as { response?: string };
    const result = response?.response?.trim() ?? '';
    if (!result) return c.json({ error: 'AI returned empty response', code: 'REFINE_EMPTY' }, 500);
    return c.json({ result, action });
  } catch (err) {
    log.error('[ai] refine error', { src: 'ai.ts' }, err as Error);
    return c.json({ error: 'Failed to refine text', code: 'REFINE_ERR' }, 500);
  }
});

// ─── POST /ai/extract-fields ──────────────────────────────────
// Body: { text: string }
// Extracts structured fields (caller_name, location, description, person names)
// from freeform narrative text using AI. Returns a JSON object with field keys
// the client can auto-populate into dispatch/citation/incident forms.
ai.post('/extract-fields', requireRole(...READ_ROLES), async (c) => {
  try {
    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text || text.length < 20) {
      return c.json({ error: 'Text must be at least 20 characters', code: 'TEXT_TOO_SHORT' }, 400);
    }
    if (text.length > 10000) {
      return c.json({ error: 'Text must be at most 10,000 characters', code: 'TEXT_TOO_LONG' }, 400);
    }
    const systemPrompt = `You are a police CAD field extractor. From the narrative text, extract structured fields.
Return ONLY valid JSON with these keys (use null for missing fields):
{
  "caller_name": "full name of the caller/reporting party",
  "caller_phone": "phone number if mentioned",
  "location_address": "street address or intersection",
  "description": "one-sentence summary of the incident",
  "persons_mentioned": ["array of full names mentioned"],
  "vehicle_plates": ["array of license plates mentioned"],
  "incident_type": "best matching CAD incident type (lowercase, underscores)",
  "weapons_mentioned": true/false,
  "injuries_mentioned": true/false
}`;
    const ai = c.env.AI as any;
    if (!ai) return c.json({ result: null, error: 'AI not configured' }, 503);
    const res = await ai.run(WORKERS_AI_MODEL, {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text.slice(0, 3000) },
      ],
      max_tokens: 500,
      temperature: 0.1,
    }) as { response?: string };
    const result = res?.response?.trim() ?? '';
    if (!result) return c.json({ result: null, error: null });
    // Parse JSON — AI may wrap in code fences
    const cleaned = result.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    return c.json({ result: JSON.parse(cleaned), source: 'ai' });
  } catch (err) {
    log.error('[ai] extract-fields error', { src: 'ai.ts' }, err as Error);
    return c.json({ result: null, error: 'Extraction failed' }, 500);
  }
});

// ── Data cleanup scan/fix (AIIntelligencePanel) ──────────────
// Real D1 queries against calls_for_service/units — no AI call involved
// despite living under /api/ai; the panel's name is aspirational, the
// detection heuristics below are plain SQL using the same open-status set
// already established elsewhere — now sourced from utils/callStatus so there is
// exactly one definition of "still on the active board".
const OPEN_CALL_STATUSES_SQL = ACTIVE_CALL_WHERE;
const STALE_CALL_HOURS = 12;

ai.get('/cleanup/scan', requireRole('admin', 'manager', 'supervisor'), async (c) => {
  try {
    const db = getDb(c.env);
    const staleCalls = await query<{ call_id: number; call_number: string; incident_type: string; status: string; hours_in_status: number }>(db, `
      SELECT id AS call_id, call_number, incident_type, status,
             CAST((julianday('now') - julianday(COALESCE(updated_at, created_at))) * 24 AS INTEGER) AS hours_in_status
      FROM calls_for_service
      WHERE ${OPEN_CALL_STATUSES_SQL}
        AND (julianday('now') - julianday(COALESCE(updated_at, created_at))) * 24 > ${STALE_CALL_HOURS}
      ORDER BY hours_in_status DESC LIMIT 50
    `);
    const orphanedUnits = await query<{ unit_id: number; call_sign: string; status: string }>(db, `
      SELECT id AS unit_id, call_sign, status
      FROM units
      WHERE status NOT IN ('available','off_duty','out_of_service') AND current_call_id IS NULL
      ORDER BY call_sign LIMIT 50
    `);
    const incompleteRows = await query<{ call_id: number; call_number: string; disposition: string | null; incident_type: string | null }>(db, `
      SELECT id AS call_id, call_number, disposition, incident_type
      FROM calls_for_service
      WHERE status IN ('cleared','closed') AND (disposition IS NULL OR disposition = '' OR incident_type IS NULL OR incident_type = '')
      ORDER BY id DESC LIMIT 50
    `);
    const incompleteRecords = incompleteRows.map((r) => ({
      call_id: r.call_id, call_number: r.call_number,
      missing_fields: [
        ...(!r.disposition ? ['disposition'] : []),
        ...(!r.incident_type ? ['incident_type'] : []),
      ],
    }));

    return c.json({
      totalIssues: staleCalls.length + orphanedUnits.length + incompleteRecords.length,
      staleCalls: { count: staleCalls.length, items: staleCalls },
      orphanedUnits: { count: orphanedUnits.length, items: orphanedUnits },
      incompleteRecords: { count: incompleteRecords.length, items: incompleteRecords },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    log.error('[AI] cleanup/scan failed', { src: 'ai.ts' }, err as Error);
    return c.json({ totalIssues: 0, staleCalls: { count: 0, items: [] }, orphanedUnits: { count: 0, items: [] }, incompleteRecords: { count: 0, items: [] }, timestamp: new Date().toISOString() });
  }
});

ai.post('/cleanup/fix', requireRole('admin', 'manager', 'supervisor'), async (c) => {
  try {
    const db = getDb(c.env);
    const body = await c.req.json<{ type?: string; id?: number | string; action?: string }>().catch(() => ({} as Record<string, never>));
    const id = Number(body.id);
    if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);

    if (body.type === 'stale_call') {
      if (body.action === 'clear') {
        await execute(db, `UPDATE calls_for_service SET status = 'cleared', updated_at = datetime('now') WHERE id = ?`, id);
      } else if (body.action === 'close') {
        await execute(db, `UPDATE calls_for_service SET status = 'closed', updated_at = datetime('now') WHERE id = ?`, id);
      } else if (body.action === 'escalate') {
        await execute(db, `UPDATE calls_for_service SET priority = 'P1', updated_at = datetime('now') WHERE id = ?`, id);
      } else {
        return c.json({ error: `Unknown action "${body.action}" for stale_call` }, 400);
      }
    } else if (body.type === 'orphaned_unit') {
      if (body.action !== 'reset') return c.json({ error: `Unknown action "${body.action}" for orphaned_unit` }, 400);
      await execute(db, `UPDATE units SET status = 'available', current_call_id = NULL, updated_at = datetime('now') WHERE id = ?`, id);
    } else {
      return c.json({ error: `Unknown cleanup type "${body.type}"` }, 400);
    }
    return c.json({ success: true });
  } catch (err) {
    log.error('[AI] cleanup/fix failed', { src: 'ai.ts' }, err as Error);
    return c.json({ error: 'Fix failed' }, 500);
  }
});

export default ai;

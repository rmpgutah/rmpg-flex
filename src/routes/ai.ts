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
  rankUnitsForCall, suggestUnits, analyzeCall, narrativeAssist, smartSearch, type NarrativeLengthTarget,
  GPS_FRESH_WINDOW_S, type RawUnit, type CallContext,
} from '../utils/dispatchAi';
import { getAiUsageStats, getAiActivity, logAiActivity } from '../utils/aiActivity';
import {
  buildProviderChain, callConfiguredAi, EXTERNAL_PROVIDERS,
  type ChatMessage, type StoredProviderConfig,
} from '../utils/configuredAi';

const ai = new Hono<Env>();

const READ_ROLES = ['admin', 'manager', 'supervisor', 'officer', 'dispatcher'];

// ── Usage metering ───────────────────────────────────────────
// Every AI-consuming endpoint records one ai_activity_log row, which is what
// GET /stats and GET /activity read. Done as middleware rather than eight
// hand-edited handlers so a new AI endpoint only has to add its path here,
// and so no handler's success path can silently forget to meter.
//
// Keyed by the sub-path BELOW /api/ai. Dev chat is deliberately absent: it
// meters itself with the resolved provider/model, and metering it here too
// would double-count every turn.
const METERED_PATHS: Record<string, string> = {
  '/suggest-units': 'suggest-units',
  '/analyze': 'analyze',
  '/narrative': 'narrative',
  '/smart-search': 'smart-search',
  '/refine': 'refine',
  '/extract-fields': 'extract-fields',
  '/prompt-test': 'prompt-test',
  '/cleanup/scan': 'cleanup-scan',
  '/cleanup/fix': 'cleanup-fix',
};

/** Body keys that hold the user's actual prompt, in priority order. */
const PROMPT_KEYS = ['message', 'notes', 'query', 'text', 'prompt', 'user_message'];

ai.use('*', async (c, next) => {
  // c.req.path is the FULL mounted path; strip the mount prefix to match the
  // table above. Anything not listed passes through unmetered.
  const sub = c.req.path.replace(/^\/api\/ai/, '') || '/';
  const taskType = METERED_PATHS[sub];
  if (!taskType) return next();

  // Parse the body BEFORE the handler. Hono caches the parsed body on the
  // request, so the handler's own c.req.json() gets the cached value rather
  // than a second (already-consumed) read.
  let prompt: string | null = null;
  if ((c.req.header('content-type') ?? '').includes('application/json')) {
    try {
      const body = await c.req.json<Record<string, unknown>>();
      for (const k of PROMPT_KEYS) {
        if (typeof body?.[k] === 'string' && (body[k] as string).trim()) { prompt = body[k] as string; break; }
      }
    } catch { /* malformed body — the handler will reject it; still worth metering */ }
  }

  const started = Date.now();
  await next();

  const status = c.res?.status ?? 500;
  await logAiActivity(getDb(c.env), {
    taskType,
    latencyMs: Date.now() - started,
    status: status >= 400 ? 'error' : 'success',
    prompt,
    error: status >= 400 ? `HTTP ${status}` : null,
    userId: (c.get('userId') as number | undefined) ?? null,
  }, safeExecutionCtx(c));
});

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
  } catch (err) { log.error('GET failed', { src: 'src/routes/ai.ts' }, err); return c.json({ error: 'Failed' }, 500); }
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
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
    const db = getDb(c.env);
    const r = await execute(db, 'DELETE FROM ai_model_presets WHERE id = ?', id);
    if (!r.meta.changes) return c.json({ error: 'Not found' }, 404);
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
  } catch (err) { log.error('GET failed', { src: 'src/routes/ai.ts' }, err); return c.json({ error: 'Failed' }, 500); }
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
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
    const db = getDb(c.env);
    const body = await c.req.json<{ name?: string; category?: string }>().catch(() => ({} as Record<string, never>));
    const sets: string[] = []; const vals: unknown[] = [];
    if (body.name !== undefined) { sets.push('name = ?'); vals.push(body.name); }
    if (body.category !== undefined) { sets.push('category = ?'); vals.push(body.category); }
    if (!sets.length) return c.json({ success: true });
    sets.push("updated_at = datetime('now')");
    vals.push(id);
    const r = await execute(db, `UPDATE ai_prompt_templates SET ${sets.join(', ')} WHERE id = ?`, ...vals);
    if (!r.meta.changes) return c.json({ error: 'Not found' }, 404);
    return c.json({ success: true });
  } catch (err) {
    log.error('PUT /templates/:id failed', { src: 'src/routes/ai.ts' }, err);
    return c.json({ error: 'Failed to update template' }, 500);
  }
});
ai.delete('/templates/:id', requireRole('admin', 'manager'), async (c) => {
  try {
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
    const db = getDb(c.env);
    const r = await execute(db, 'DELETE FROM ai_prompt_templates WHERE id = ?', id);
    if (!r.meta.changes) return c.json({ error: 'Not found' }, 404);
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

// GET /ai/stats — real counters derived from ai_activity_log (migration
// 0291). Was a hardcoded all-zeros object, which made AdminAISettingsTab's
// usage tiles permanently read "0" no matter how much AI traffic ran.
// Degrades to zeros (never 500s) when the table is unavailable.
ai.get('/stats', async (c) => c.json(await getAiUsageStats(getDb(c.env))));

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

// GET /ai/activity — real recent-call feed for AIActivityPanel and the
// AICommandCenterPanel ticker. `limit` is clamped inside getAiActivity().
ai.get('/activity', async (c) => {
  const limit = Number.parseInt(c.req.query('limit') ?? '25', 10);
  return c.json(await getAiActivity(getDb(c.env), Number.isFinite(limit) ? limit : 25));
});

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
// Body: { notes, incident_type?, location_address?, context_type? }
// context_type: 'serve_attempt' | 'dispatch_narrative' | 'incident' (default)
// Returns a plain-text narrative paragraph drafted from the caller's
// notes + context. Powers the NarrativeAssist client component.
ai.post('/narrative', requireRole(...READ_ROLES), async (c) => {
  try {
    const body = await c.req.json().catch(() => ({} as any));
    if (!body.notes || typeof body.notes !== 'string' || body.notes.trim().length < 10) {
      return c.json({ error: 'At least 10 characters of notes required', code: 'NARR_SHORT' }, 400);
    }
    const contextType = typeof body.context_type === 'string' ? body.context_type : 'incident';
    const VALID_LENGTHS: NarrativeLengthTarget[] = ['brief', 'standard', 'detailed', 'full_report'];
    const lengthTarget: NarrativeLengthTarget =
      VALID_LENGTHS.includes(body.length_target as NarrativeLengthTarget)
        ? (body.length_target as NarrativeLengthTarget)
        : 'standard';
    const paragraphGuidance = typeof body.paragraph_guidance === 'string'
      ? body.paragraph_guidance.slice(0, 1000)
      : undefined;
    const result = await narrativeAssist(
      c.env.AI,
      body.notes,
      body.incident_type,
      body.location_address,
      contextType as 'serve_attempt' | 'dispatch_narrative' | 'incident',
      lengthTarget,
      paragraphGuidance,
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
        await execute(db, `UPDATE calls_for_service SET status = 'cleared', updated_at = datetime(\'now\') WHERE id = ?`, id);
      } else if (body.action === 'close') {
        await execute(db, `UPDATE calls_for_service SET status = 'closed', updated_at = datetime(\'now\') WHERE id = ?`, id);
      } else if (body.action === 'escalate') {
        await execute(db, `UPDATE calls_for_service SET priority = 'P1', updated_at = datetime(\'now\') WHERE id = ?`, id);
      } else {
        return c.json({ error: `Unknown action "${body.action}" for stale_call` }, 400);
      }
    } else if (body.type === 'orphaned_unit') {
      if (body.action !== 'reset') return c.json({ error: `Unknown action "${body.action}" for orphaned_unit` }, 400);
      await execute(db, `UPDATE units SET status = 'available', current_call_id = NULL, updated_at = datetime(\'now\') WHERE id = ?`, id);
    } else {
      return c.json({ error: `Unknown cleanup type "${body.type}"` }, 400);
    }
    return c.json({ success: true });
  } catch (err) {
    log.error('[AI] cleanup/fix failed', { src: 'ai.ts' }, err as Error);
    return c.json({ error: 'Fix failed' }, 500);
  }
});

// ============================================================
// AI Dev Chat — POST /dev-chat/chat, POST /dev-chat/chat/stream,
//               GET /dev-chat/history[/:sessionId], DELETE /dev-chat/history/:id
// ============================================================
// AIDevChatPanel.tsx has called these four endpoints since it shipped; none of
// them existed, so the panel's entire chat function 404'd — including its own
// "fall back to non-streaming" path, which called the other missing endpoint.
//
// Provider: whichever one the admin selected in AIProvidersPanel, resolved per
// request from system_config via resolveDevChatChain() and executed by
// src/utils/configuredAi.ts. Workers AI is the terminal fallback.
//
// Scoping: every read and delete is filtered by user_id. These transcripts can
// contain operational CAD detail, so one admin does not get to read another's
// session — an unknown id and someone else's id both return 404 so the
// endpoint never confirms that a session it won't show you exists.
//
// Storage tables live in migration 0291_ai_activity_log.sql and are reconciled
// at runtime (below) so a deploy that lands ahead of the migration degrades to
// a clean error instead of 500ing every request.
// ============================================================

/**
 * Hono THROWS on `c.executionCtx` when there is no ExecutionContext -- route-level
 * tests drive handlers via app.request(), which has none -- so optional chaining
 * does not help: the getter throws before the `?.` is ever evaluated.
 * Same guard as src/routes/alpr.ts:577.
 */
function safeExecutionCtx(c: any): { waitUntil(p: Promise<unknown>): void } | undefined {
  try { return c.executionCtx; } catch { return undefined; }
}

const DEV_CHAT_SYSTEM_PROMPT = [
  'You are the RMPG Flex engineering assistant, embedded in the admin console of a',
  'police CAD/RMS running on Cloudflare Workers (Hono + D1) with a React 18 + Vite SPA.',
  'Answer questions about the system concisely and concretely.',
  'You have NO access to the repository, the filesystem, or live records — reason only',
  'from the conversation and any context block the operator supplies. If you do not know',
  'something, say so plainly rather than inventing a file path, table, or endpoint.',
].join(' ');

/** Max prior turns replayed to the provider. Keeps the prompt bounded. */
const DEV_CHAT_HISTORY_TURNS = 12;
const DEV_CHAT_MAX_MESSAGE = 8000;

let devChatTablesReady = false;
async function ensureDevChatTables(db: D1Database): Promise<boolean> {
  if (devChatTablesReady) return true;
  try {
    await execute(db, `CREATE TABLE IF NOT EXISTS ai_dev_chat_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_key TEXT NOT NULL UNIQUE,
      user_id INTEGER,
      title TEXT,
      message_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')))`);
    await execute(db, `CREATE TABLE IF NOT EXISTS ai_dev_chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      provider TEXT,
      latency_ms INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
    devChatTablesReady = true;
    return true;
  } catch (err) {
    log.error('[ai] dev-chat table reconcile failed', { src: 'ai.ts' }, err as Error);
    return false;
  }
}

/**
 * Resolve the provider chain from the admin panel's saved configuration.
 * This is what makes AIProvidersPanel's dropdown actually mean something —
 * before this, every endpoint hard-coded Workers AI.
 */
async function resolveDevChatChain(db: D1Database) {
  const top = await getJsonConfig(db, 'ai.config', {
    provider: 'workers-ai', autoFallback: true, features: DEFAULT_FEATURES,
  });
  const stored: Record<string, StoredProviderConfig> = {};
  for (const name of EXTERNAL_PROVIDERS) {
    const raw = await getConfigValue(db, `ai.provider.${name}`);
    if (!raw) continue;
    try { stored[name] = JSON.parse(raw) as StoredProviderConfig; } catch { /* malformed row — treat as unconfigured */ }
  }
  return buildProviderChain(String(top.provider ?? 'workers-ai'), top.autoFallback !== false, stored);
}

interface DevChatInput { message: string; sessionKey: string; context?: string; }

/** Shared validation for both the streaming and non-streaming handlers. */
function readDevChatBody(body: Record<string, unknown>):
  { ok: true; value: DevChatInput } | { ok: false; error: string; code: string } {
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) return { ok: false, error: 'A message is required', code: 'CHAT_NO_MESSAGE' };
  if (message.length > DEV_CHAT_MAX_MESSAGE) {
    return { ok: false, error: `Message too long (max ${DEV_CHAT_MAX_MESSAGE} chars)`, code: 'CHAT_TOO_LONG' };
  }
  const sessionKey = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
  if (!sessionKey) return { ok: false, error: 'A sessionId is required', code: 'CHAT_NO_SESSION' };
  const context = typeof body.context === 'string' && body.context.trim() ? body.context.trim() : undefined;
  return { ok: true, value: { message, sessionKey, context } };
}

/** Upsert the session row and return its numeric id. */
async function openDevChatSession(db: D1Database, sessionKey: string, userId: number | null, firstMessage: string): Promise<number | null> {
  const existing = await queryFirst<{ id: number }>(db,
    'SELECT id FROM ai_dev_chat_sessions WHERE session_key = ? LIMIT 1', sessionKey);
  if (existing) return existing.id;
  await execute(db,
    `INSERT OR IGNORE INTO ai_dev_chat_sessions (session_key, user_id, title) VALUES (?, ?, ?)`,
    sessionKey, userId, firstMessage.slice(0, 120));
  const row = await queryFirst<{ id: number }>(db,
    'SELECT id FROM ai_dev_chat_sessions WHERE session_key = ? LIMIT 1', sessionKey);
  return row?.id ?? null;
}

async function appendDevChatMessage(
  db: D1Database, sessionId: number, role: 'user' | 'assistant',
  content: string, provider?: string | null, latencyMs?: number | null,
): Promise<void> {
  await execute(db,
    `INSERT INTO ai_dev_chat_messages (session_id, role, content, provider, latency_ms)
     VALUES (?, ?, ?, ?, ?)`,
    sessionId, role, content, provider ?? null, latencyMs ?? null);
  await execute(db,
    `UPDATE ai_dev_chat_sessions
        SET message_count = message_count + 1, updated_at = datetime('now')
      WHERE id = ?`, sessionId);
}

async function loadDevChatContext(db: D1Database, sessionId: number): Promise<ChatMessage[]> {
  const rows = await query<{ role: string; content: string }>(db,
    `SELECT role, content FROM ai_dev_chat_messages
      WHERE session_id = ? ORDER BY id DESC LIMIT ?`,
    sessionId, DEV_CHAT_HISTORY_TURNS);
  return rows.reverse().map((r) => ({
    role: r.role === 'assistant' ? 'assistant' as const : 'user' as const,
    content: r.content,
  }));
}

/**
 * Everything both handlers share: validate, persist the user turn, call the
 * chain, persist the answer, meter it. Returns a discriminated result so the
 * streaming handler can emit an error frame where the JSON handler returns a
 * status code.
 */
async function runDevChatTurn(c: any, input: DevChatInput): Promise<
  { ok: true; content: string; provider: string; latencyMs: number }
  | { ok: false; error: string; status: number; code: string }
> {
  const db = getDb(c.env);
  const userId = (c.get('userId') as number | undefined) ?? null;

  if (!(await ensureDevChatTables(db))) {
    return { ok: false, error: 'Dev chat storage is unavailable', status: 503, code: 'CHAT_STORAGE_UNAVAILABLE' };
  }

  const sessionId = await openDevChatSession(db, input.sessionKey, userId, input.message);
  if (sessionId == null) {
    return { ok: false, error: 'Could not open chat session', status: 500, code: 'CHAT_SESSION_FAILED' };
  }

  // Load prior turns BEFORE appending this one, then append — so the model
  // sees the history exactly once, not with the current message duplicated.
  const history = await loadDevChatContext(db, sessionId);
  await appendDevChatMessage(db, sessionId, 'user', input.message);

  const messages: ChatMessage[] = [
    ...history,
    {
      role: 'user',
      content: input.context
        ? `${input.message}\n\n--- operator-supplied context ---\n${input.context}`
        : input.message,
    },
  ];

  const started = Date.now();
  try {
    const chain = await resolveDevChatChain(db);
    const result = await callConfiguredAi(c.env, chain, {
      messages,
      system: DEV_CHAT_SYSTEM_PROMPT,
      maxTokens: 2048,
      temperature: 0.4,
    });
    await appendDevChatMessage(db, sessionId, 'assistant', result.content, result.provider, result.latencyMs);
    await logAiActivity(db, {
      taskType: 'dev-chat', provider: result.provider, model: result.model,
      latencyMs: result.latencyMs, status: result.fellBack ? 'fallback' : 'success',
      prompt: input.message, userId,
    }, safeExecutionCtx(c));
    return { ok: true, content: result.content, provider: result.provider, latencyMs: result.latencyMs };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error('[ai] dev-chat provider failure', { src: 'ai.ts', sessionKey: input.sessionKey }, err as Error);
    await logAiActivity(db, {
      taskType: 'dev-chat', latencyMs: Date.now() - started, status: 'error',
      prompt: input.message, error: message, userId,
    }, safeExecutionCtx(c));
    return { ok: false, error: message, status: 502, code: 'CHAT_PROVIDER_FAILED' };
  }
}

ai.post('/dev-chat/chat', requireRole('admin', 'manager'), async (c) => {
  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
  const parsed = readDevChatBody(body);
  if (!parsed.ok) return c.json({ error: parsed.error, code: parsed.code }, 400);

  const result = await runDevChatTurn(c, parsed.value);
  if (!result.ok) return c.json({ error: result.error, code: result.code }, result.status as 500);
  return c.json({ content: result.content, provider: result.provider, latencyMs: result.latencyMs });
});

// Streaming variant. The provider calls are not themselves streamed (neither
// env.AI.run nor the panel's fallback path needs token-level streaming to be
// correct), so this emits the completed answer in chunks at a readable cadence
// and then a `done` frame. That matches exactly what AIDevChatPanel parses:
// `data: {"token": "..."}` frames, then `data: {"done": true, "latencyMs": n}`,
// with `data: {"error": "..."}` on failure. A 400 is returned as ordinary JSON
// (not a stream) so the panel's `!response.ok` branch can read it.
const STREAM_CHUNK_CHARS = 24;

ai.post('/dev-chat/chat/stream', requireRole('admin', 'manager'), async (c) => {
  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
  const parsed = readDevChatBody(body);
  if (!parsed.ok) return c.json({ error: parsed.error, code: parsed.code }, 400);
  const input = parsed.value;

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const send = (payload: unknown) => writer.write(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));

  const pump = (async () => {
    try {
      await send({ thinking: true });
      const result = await runDevChatTurn(c, input);
      if (!result.ok) {
        await send({ error: result.error });
        await send({ done: true, latencyMs: 0 });
        return;
      }
      await send({ thinking_done: true });
      for (let i = 0; i < result.content.length; i += STREAM_CHUNK_CHARS) {
        await send({ token: result.content.slice(i, i + STREAM_CHUNK_CHARS) });
      }
      await send({ done: true, latencyMs: result.latencyMs, provider: result.provider });
    } catch (err) {
      log.error('[ai] dev-chat stream failed', { src: 'ai.ts' }, err as Error);
      await send({ error: err instanceof Error ? err.message : 'Stream failed' }).catch(() => {});
      await send({ done: true, latencyMs: 0 }).catch(() => {});
    } finally {
      await writer.close().catch(() => { /* client already disconnected */ });
    }
  })();

  // Keep the isolate alive until the stream is fully written even if the
  // response object is returned first.
  safeExecutionCtx(c)?.waitUntil(pump);

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
});

// GET /dev-chat/history — session list for the panel's sidebar.
ai.get('/dev-chat/history', requireRole('admin', 'manager'), async (c) => {
  const db = getDb(c.env);
  const userId = (c.get('userId') as number | undefined) ?? null;
  if (!(await ensureDevChatTables(db))) return c.json([]);
  try {
    const rows = await query<{
      session_id: string; started_at: string; message_count: number;
      first_message: string | null; last_message: string | null;
    }>(db, `
      SELECT s.session_key AS session_id,
             s.created_at  AS started_at,
             s.message_count,
             (SELECT m.content FROM ai_dev_chat_messages m
               WHERE m.session_id = s.id AND m.role = 'user'
               ORDER BY m.id ASC LIMIT 1)  AS first_message,
             (SELECT m.content FROM ai_dev_chat_messages m
               WHERE m.session_id = s.id
               ORDER BY m.id DESC LIMIT 1) AS last_message
        FROM ai_dev_chat_sessions s
       WHERE s.user_id IS ?
       ORDER BY s.updated_at DESC
       LIMIT 50`, userId);
    return c.json(rows.map((r) => ({
      session_id: r.session_id,
      started_at: r.started_at,
      message_count: r.message_count,
      first_message: r.first_message ?? '',
      last_message: r.last_message ?? '',
    })));
  } catch (err) {
    log.error('[ai] dev-chat history failed', { src: 'ai.ts' }, err as Error);
    return c.json([]);
  }
});

// GET /dev-chat/history/:sessionId — one transcript.
ai.get('/dev-chat/history/:sessionId', requireRole('admin', 'manager'), async (c) => {
  const db = getDb(c.env);
  const userId = (c.get('userId') as number | undefined) ?? null;
  const sessionKey = c.req.param('sessionId') ?? '';
  if (!(await ensureDevChatTables(db))) return c.json({ error: 'Not found', code: 'CHAT_NOT_FOUND' }, 404);

  const session = await queryFirst<{ id: number }>(db,
    'SELECT id FROM ai_dev_chat_sessions WHERE session_key = ? AND user_id IS ? LIMIT 1',
    sessionKey, userId);
  // Someone else's session and a nonexistent one answer identically, so this
  // never confirms the existence of a transcript the caller may not read.
  if (!session) return c.json({ error: 'Not found', code: 'CHAT_NOT_FOUND' }, 404);

  const rows = await query<{ id: number; role: string; content: string; latency_ms: number | null; created_at: string }>(db,
    `SELECT id, role, content, latency_ms, created_at
       FROM ai_dev_chat_messages WHERE session_id = ? ORDER BY id ASC LIMIT 500`, session.id);
  return c.json(rows);
});

// DELETE /dev-chat/history/:sessionId — drop a transcript.
ai.delete('/dev-chat/history/:sessionId', requireRole('admin', 'manager'), async (c) => {
  const db = getDb(c.env);
  const userId = (c.get('userId') as number | undefined) ?? null;
  const sessionKey = c.req.param('sessionId') ?? '';
  if (!(await ensureDevChatTables(db))) return c.json({ error: 'Not found', code: 'CHAT_NOT_FOUND' }, 404);

  const session = await queryFirst<{ id: number }>(db,
    'SELECT id FROM ai_dev_chat_sessions WHERE session_key = ? AND user_id IS ? LIMIT 1',
    sessionKey, userId);
  if (!session) return c.json({ error: 'Not found', code: 'CHAT_NOT_FOUND' }, 404);

  // Messages first: if the second statement fails, orphaned messages are worse
  // than an empty session row (D1 has no cascade here).
  await execute(db, 'DELETE FROM ai_dev_chat_messages WHERE session_id = ?', session.id);
  await execute(db, 'DELETE FROM ai_dev_chat_sessions WHERE id = ?', session.id);
  return c.json({ success: true });
});

export default ai;
